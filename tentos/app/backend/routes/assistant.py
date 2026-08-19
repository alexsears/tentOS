"""TentOS-scoped AI assistant, voice transcription, and confirmed actions."""

import json
import logging
import secrets
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Optional

import aiohttp
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from config import settings
from database import Alert, Event, SensorHistory, async_session
from routes.config import SLOT_DEFINITIONS, load_config, save_config
from state_manager import is_temperature_sensor_type

logger = logging.getLogger(__name__)
router = APIRouter()

CONTEXT_HOURS = 24
MAX_MESSAGE_LENGTH = 1500
MAX_AUDIO_BYTES = 10 * 1024 * 1024
SESSION_TTL_SECONDS = 2 * 60 * 60
ACTION_TTL_SECONDS = 5 * 60
MAX_TOOL_ROUNDS = 3

_conversations: dict[str, dict[str, Any]] = {}
_pending_actions: dict[str, dict[str, Any]] = {}
_rate_buckets: dict[str, list[float]] = defaultdict(list)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=MAX_MESSAGE_LENGTH)
    session_id: Optional[str] = Field(default=None, max_length=128)


class ActionDecisionRequest(BaseModel):
    session_id: str = Field(min_length=8, max_length=128)


def _clean_expired_state() -> None:
    now = time.time()
    for session_id, data in list(_conversations.items()):
        if now - data.get("updated_at", 0) > SESSION_TTL_SECONDS:
            _conversations.pop(session_id, None)
    for token, action in list(_pending_actions.items()):
        if now - action.get("created_at", 0) > ACTION_TTL_SECONDS:
            _pending_actions.pop(token, None)


def _check_rate_limit(key: str, limit: int, window_seconds: int = 60) -> None:
    now = time.time()
    recent = [stamp for stamp in _rate_buckets[key] if now - stamp < window_seconds]
    if len(recent) >= limit:
        raise HTTPException(status_code=429, detail="Too many assistant requests. Wait a moment and try again.")
    recent.append(now)
    _rate_buckets[key] = recent


def _get_session_id(value: Optional[str]) -> str:
    candidate = (value or "").strip()
    if 8 <= len(candidate) <= 128 and all(ch.isalnum() or ch in "-_" for ch in candidate):
        return candidate
    return secrets.token_urlsafe(18)


def _safe_json(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False, default=str)


def _extract_response_text(response: dict) -> str:
    pieces: list[str] = []
    for item in response.get("output", []):
        if item.get("type") != "message":
            continue
        for content in item.get("content", []):
            if content.get("type") == "output_text" and content.get("text"):
                pieces.append(content["text"].strip())
    return "\n".join(piece for piece in pieces if piece).strip()


def _sensor_stats(
    rows: list[SensorHistory], legacy_temperature_unit: str = "unknown"
) -> dict[str, dict[str, dict[str, Any]]]:
    grouped: dict[str, dict[str, list[SensorHistory]]] = defaultdict(lambda: defaultdict(list))
    for row in rows:
        grouped[row.tent_id][row.sensor_type].append(row)

    result: dict[str, dict[str, dict[str, Any]]] = {}
    for tent_id, sensors in grouped.items():
        result[tent_id] = {}
        for sensor_type, records in sensors.items():
            records.sort(key=lambda row: row.timestamp)
            value_records = [(float(row.value), row) for row in records]
            ambiguous_samples = 0
            if is_temperature_sensor_type(sensor_type):
                normalized = []
                for value, row in value_records:
                    unit = str(getattr(row, "unit", None) or "").strip().lower()
                    if unit in {"°c", "c", "celsius"}:
                        normalized.append((value, row))
                    elif unit in {"°f", "f", "fahrenheit"}:
                        normalized.append((round((value - 32) * 5 / 9, 2), row))
                    elif sensor_type == "temperature" and legacy_temperature_unit == "C":
                        normalized.append((value, row))
                    elif sensor_type == "temperature" and legacy_temperature_unit == "F":
                        normalized.append((round((value - 32) * 5 / 9, 2), row))
                    else:
                        ambiguous_samples += 1
                value_records = normalized

            if not value_records:
                result[tent_id][sensor_type] = {
                    "unit": "°C" if is_temperature_sensor_type(sensor_type) else None,
                    "samples": 0,
                    "ambiguous_samples": ambiguous_samples,
                    "status": "unavailable: legacy temperature samples have no configured unit",
                }
                continue

            values = [value for value, _row in value_records]
            included_records = [row for _value, row in value_records]
            summary = {
                "min": round(min(values), 2),
                "max": round(max(values), 2),
                "average": round(sum(values) / len(values), 2),
                "latest": round(values[-1], 2),
                "unit": {
                    "humidity": "%",
                    "vpd": "kPa",
                }.get(sensor_type, "°C" if is_temperature_sensor_type(sensor_type) else None),
                "samples": len(values),
                "first_sample": included_records[0].timestamp.isoformat(),
                "last_sample": included_records[-1].timestamp.isoformat(),
            }
            if ambiguous_samples:
                summary["ambiguous_samples_ignored"] = ambiguous_samples
            result[tent_id][sensor_type] = summary
    return result


def _actuator_history_summary(history: list[list[dict]], entity_map: dict[str, dict]) -> list[dict]:
    summaries = []
    for entity_history in history or []:
        if not entity_history:
            continue
        entity_id = entity_history[0].get("entity_id", "")
        meta = entity_map.get(entity_id)
        if not meta:
            continue
        transitions = []
        previous = None
        for entry in entity_history:
            state = entry.get("state")
            if state in (None, "unknown", "unavailable") or state == previous:
                previous = state
                continue
            transitions.append({
                "state": state,
                "timestamp": entry.get("last_changed") or entry.get("last_updated"),
            })
            previous = state
        summaries.append({
            **meta,
            "entity_id": entity_id,
            "transition_count": max(0, len(transitions) - 1),
            "transitions": transitions[-20:],
        })
    return summaries


async def _build_tentos_context(request: Request, hours: int = CONTEXT_HOURS) -> dict:
    state_manager = request.app.state.state_manager
    ha_client = request.app.state.ha_client
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=hours)
    tents = state_manager.get_all_tents()

    async with async_session() as session:
        sensor_result = await session.execute(
            select(SensorHistory)
            .where(SensorHistory.timestamp >= cutoff)
            .order_by(SensorHistory.timestamp)
        )
        event_result = await session.execute(
            select(Event)
            .where(Event.timestamp >= cutoff)
            .order_by(Event.timestamp.desc())
            .limit(100)
        )
        alert_result = await session.execute(
            select(Alert)
            .where(Alert.resolved_at.is_(None))
            .order_by(Alert.created_at.desc())
            .limit(100)
        )
        sensor_rows = list(sensor_result.scalars().all())
        event_rows = list(event_result.scalars().all())
        alert_rows = list(alert_result.scalars().all())

    entity_map: dict[str, dict] = {}
    for tent in state_manager.tents.values():
        for slot, entity_id in tent.slot_to_entity.items():
            entity_map[entity_id] = {
                "tent_id": tent.config.id,
                "tent_name": tent.config.name,
                "actuator": slot,
            }

    actuator_history = []
    if entity_map:
        try:
            raw_history = await ha_client.get_history(
                list(entity_map), cutoff.isoformat(), now.isoformat()
            )
            actuator_history = _actuator_history_summary(raw_history, entity_map)
        except Exception as exc:
            logger.warning("Assistant could not load actuator history: %s", exc)

    live_alerts = []
    for tent in state_manager.tents.values():
        for alert in tent.alerts:
            live_alerts.append({
                "tent_id": tent.config.id,
                "tent_name": tent.config.name,
                **alert,
            })

    return {
        "scope": "TentOS only",
        "generated_at": now.isoformat(),
        "window": {"hours": hours, "from": cutoff.isoformat(), "to": now.isoformat()},
        "tents": tents,
        "sensor_statistics": _sensor_stats(
            sensor_rows, settings.assistant_legacy_temperature_unit
        ),
        "equipment_history": actuator_history,
        "events": [
            {
                "tent_id": row.tent_id,
                "type": row.event_type,
                "timestamp": row.timestamp.isoformat(),
                "notes": row.notes,
                "user": row.user,
            }
            for row in event_rows
        ],
        "active_alerts": live_alerts + [
            {
                "id": row.id,
                "tent_id": row.tent_id,
                "type": row.alert_type,
                "severity": row.severity,
                "message": row.message,
                "created_at": row.created_at.isoformat(),
                "acknowledged_at": row.acknowledged_at.isoformat() if row.acknowledged_at else None,
            }
            for row in alert_rows
        ],
    }


def _instructions(context: dict) -> str:
    tent_ids = [tent.get("id") for tent in context.get("tents", [])]
    return f"""You are the TentOS assistant inside the user's private grow-tent app.

Scope:
- Your scope is TentOS only.
- Answer only from the TentOS context supplied below. Do not use web search, general personal context, or knowledge about Alex outside TentOS.
- "the tents", "my tents", and similar phrases mean all configured TentOS tents: {tent_ids}.
- Resolve informal tent references from configured tent names and IDs. If a reference is genuinely ambiguous, ask one brief question.
- For a last-24-hours summary, cover each tent, important min/max/average changes, current state versus targets, alerts, equipment changes, and logged care events. Say when history is sparse or absent.
- TentOS normalizes all current and historical temperature values in the context to Celsius. When reporting temperature, give Fahrenheit first and Celsius in parentheses, calculating Fahrenheit from the Celsius value. Never reuse a source entity's old unit label.
- Never invent a reading, event, diagnosis, or action result. Distinguish observed data from suggestions.
- Keep spoken replies concise and natural. Lead with what matters.
- Reply in plain text with short lines. Do not use Markdown markers such as **, #, or backticks.

Actions:
- You may only propose actions using the provided TentOS tools.
- Propose an action only when the user explicitly asks to change equipment or log an event. Questions and summaries are read-only.
- Every tool creates a pending confirmation; it does not execute the action. Tell the user to confirm the exact action shown in TentOS.
- Never claim a pending action already happened.
- When the user says "add {{entity}} to {{tent}}", search Home Assistant with find_home_assistant_entities, resolve the exact entity, then propose its TentOS sensor or actuator role. Use the friendly name, entity ID, domain, and device class to infer the role. Ask one brief question when multiple matches or roles are plausible.
- Adding an HA entity to a TentOS tent is supported only through propose_add_entity_to_tent and still requires confirmation.
- Water pumps, schedule edits, automation edits, alert acknowledgement, and actions outside the supplied tools are unavailable in this first version. Say so plainly.

Current TentOS context ({CONTEXT_HOURS} hours):
{_safe_json(context)}"""


TOOLS = [
    {
        "type": "function",
        "name": "find_home_assistant_entities",
        "description": "Search Home Assistant entities by friendly name or entity ID before adding one to TentOS. This is read-only.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Friendly name or entity ID words supplied by the user."},
            },
            "required": ["query"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "propose_actuator_change",
        "description": "Propose turning one configured TentOS actuator on or off. The user must confirm before it runs.",
        "parameters": {
            "type": "object",
            "properties": {
                "tent_id": {"type": "string", "description": "Exact configured TentOS tent ID."},
                "actuator": {"type": "string", "description": "Exact configured actuator slot such as light, exhaust_fan, or humidifier."},
                "state": {"type": "string", "enum": ["on", "off"]},
            },
            "required": ["tent_id", "actuator", "state"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "propose_fan_speed",
        "description": "Propose setting one configured TentOS fan to a percentage. The user must confirm before it runs.",
        "parameters": {
            "type": "object",
            "properties": {
                "tent_id": {"type": "string", "description": "Exact configured TentOS tent ID."},
                "actuator": {"type": "string", "description": "Exact configured fan actuator slot."},
                "percentage": {"type": "integer", "minimum": 0, "maximum": 100},
            },
            "required": ["tent_id", "actuator", "percentage"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "propose_event_log",
        "description": "Propose logging a TentOS care event. The user must confirm before it is saved.",
        "parameters": {
            "type": "object",
            "properties": {
                "tent_id": {"type": "string", "description": "Exact configured TentOS tent ID."},
                "event_type": {
                    "type": "string",
                    "enum": ["watering", "refill", "filter_change", "solution_change", "maintenance", "note"],
                },
                "notes": {"type": "string", "description": "Short factual note for the TentOS event log."},
            },
            "required": ["tent_id", "event_type", "notes"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function",
        "name": "propose_add_entity_to_tent",
        "description": "Propose adding one exact Home Assistant entity to a TentOS tent slot. Search first. The user must confirm before config changes.",
        "parameters": {
            "type": "object",
            "properties": {
                "tent_id": {"type": "string", "description": "Exact configured TentOS tent ID."},
                "entity_id": {"type": "string", "description": "Exact Home Assistant entity ID returned by the search tool."},
                "category": {"type": "string", "enum": ["sensors", "actuators"]},
                "role": {
                    "type": "string",
                    "enum": [
                        "temperature", "humidity", "co2", "light_level", "reservoir_level", "leak_sensor", "power_usage", "camera",
                        "light", "exhaust_fan", "circulation_fan", "humidifier", "dehumidifier", "heater", "ac", "water_pump", "drain_pump"
                    ],
                    "description": "TentOS slot that describes what this entity does in the tent.",
                },
            },
            "required": ["tent_id", "entity_id", "category", "role"],
            "additionalProperties": False,
        },
        "strict": True,
    },
]


def _entity_payload(state: dict, state_manager) -> dict:
    entity_id = state.get("entity_id", "")
    attrs = state.get("attributes", {}) or {}
    assignment = state_manager.entity_to_tent.get(entity_id)
    return {
        "entity_id": entity_id,
        "friendly_name": attrs.get("friendly_name", entity_id),
        "domain": entity_id.split(".", 1)[0] if "." in entity_id else "",
        "device_class": attrs.get("device_class"),
        "state": state.get("state"),
        "unit": attrs.get("unit_of_measurement"),
        "already_assigned": {
            "tent_id": assignment[0], "category": assignment[1], "role": assignment[2]
        } if assignment else None,
    }


async def _find_home_assistant_entities(query: str, request: Request) -> dict:
    query = query.strip().casefold()
    if not query:
        return {"ok": False, "error": "An entity name or ID is required."}
    ha_client = request.app.state.ha_client
    state_manager = request.app.state.state_manager
    try:
        states = await ha_client.get_states()
    except Exception:
        return {"ok": False, "error": "Home Assistant entities are unavailable right now."}

    words = [word for word in query.replace("_", " ").replace(".", " ").split() if word]
    matches = []
    supported_domains = {
        domain
        for category in SLOT_DEFINITIONS.values()
        for definition in category.values()
        for domain in definition.get("domains", [])
    }
    for state in states:
        payload = _entity_payload(state, state_manager)
        if payload["domain"] not in supported_domains:
            continue
        name = str(payload["friendly_name"] or "").casefold()
        entity_id = payload["entity_id"].casefold()
        haystack = f"{name} {entity_id.replace('_', ' ').replace('.', ' ')}"
        if query == name or query == entity_id:
            score = 100
        elif query in name or query in entity_id:
            score = 75
        elif words and all(word in haystack for word in words):
            score = 55
        elif words and any(word in haystack for word in words):
            score = 20
        else:
            continue
        matches.append((score, payload))
    matches.sort(key=lambda item: (-item[0], item[1]["friendly_name"].casefold()))
    return {"ok": True, "query": query, "matches": [payload for _, payload in matches[:8]]}


def _slot_compatible(category: str, role: str, entity: dict) -> bool:
    definition = SLOT_DEFINITIONS.get(category, {}).get(role)
    if not definition or entity["domain"] not in definition.get("domains", []):
        return False
    allowed_classes = definition.get("device_classes", [])
    return not allowed_classes or None in allowed_classes or entity.get("device_class") in allowed_classes


async def _create_pending_action(name: str, arguments: dict, request: Request, session_id: str) -> dict:
    state_manager = request.app.state.state_manager
    tent_id = str(arguments.get("tent_id", ""))
    tent = state_manager.get_tent(tent_id)
    if not tent:
        return {"ok": False, "error": f"Tent '{tent_id}' is not configured."}

    action: dict[str, Any]
    if name == "propose_actuator_change":
        actuator = str(arguments.get("actuator", ""))
        state = str(arguments.get("state", ""))
        if actuator.startswith(("water_pump", "drain_pump")):
            return {"ok": False, "error": "Water and drain pump control is unavailable through TentOS AI."}
        entity_id = tent.slot_to_entity.get(actuator)
        if not entity_id:
            return {"ok": False, "error": f"{tent.config.name} has no configured '{actuator}' actuator."}
        if state not in ("on", "off"):
            return {"ok": False, "error": "State must be on or off."}
        action = {
            "kind": "actuator_change",
            "tent_id": tent_id,
            "tent_name": tent.config.name,
            "actuator": actuator,
            "entity_id": entity_id,
            "state": state,
            "summary": f"Turn {tent.config.name} {actuator.replace('_', ' ')} {state}",
        }
    elif name == "propose_fan_speed":
        actuator = str(arguments.get("actuator", ""))
        entity_id = tent.slot_to_entity.get(actuator)
        try:
            percentage = int(arguments.get("percentage"))
        except (TypeError, ValueError):
            return {"ok": False, "error": "Fan percentage must be a number from 0 to 100."}
        if not entity_id or not (actuator.startswith("exhaust_fan") or actuator.startswith("circulation_fan")):
            return {"ok": False, "error": f"{tent.config.name} has no configured fan named '{actuator}'."}
        if not entity_id.startswith("fan."):
            return {"ok": False, "error": "Percentage control is available only for Home Assistant fan entities."}
        if not 0 <= percentage <= 100:
            return {"ok": False, "error": "Fan percentage must be from 0 to 100."}
        action = {
            "kind": "fan_speed",
            "tent_id": tent_id,
            "tent_name": tent.config.name,
            "actuator": actuator,
            "entity_id": entity_id,
            "percentage": percentage,
            "summary": f"Set {tent.config.name} {actuator.replace('_', ' ')} to {percentage}%",
        }
    elif name == "propose_event_log":
        event_type = str(arguments.get("event_type", ""))
        notes = str(arguments.get("notes", "")).strip()[:500]
        allowed = {"watering", "refill", "filter_change", "solution_change", "maintenance", "note"}
        if event_type not in allowed or not notes:
            return {"ok": False, "error": "The event type or note is invalid."}
        action = {
            "kind": "event_log",
            "tent_id": tent_id,
            "tent_name": tent.config.name,
            "event_type": event_type,
            "notes": notes,
            "summary": f"Log {event_type.replace('_', ' ')} for {tent.config.name}: {notes}",
        }
    elif name == "propose_add_entity_to_tent":
        entity_id = str(arguments.get("entity_id", "")).strip()
        category = str(arguments.get("category", ""))
        role = str(arguments.get("role", ""))
        if category not in ("sensors", "actuators") or role not in SLOT_DEFINITIONS.get(category, {}):
            return {"ok": False, "error": "That TentOS entity role is invalid."}
        state = await request.app.state.ha_client.get_state(entity_id)
        if not state:
            return {"ok": False, "error": f"Home Assistant entity '{entity_id}' was not found."}
        entity = _entity_payload(state, state_manager)
        if not _slot_compatible(category, role, entity):
            return {
                "ok": False,
                "error": f"{entity_id} ({entity['domain']}/{entity.get('device_class')}) is not compatible with TentOS {category}.{role}.",
            }
        assignment = entity.get("already_assigned")
        if assignment:
            return {
                "ok": False,
                "error": f"{entity_id} is already assigned to {assignment['tent_id']} as {assignment['role']}.",
            }
        current = getattr(tent.config, category, {}).get(role)
        multiple = bool(SLOT_DEFINITIONS[category][role].get("multiple"))
        replacing = current if current and not multiple else None
        friendly_name = entity["friendly_name"]
        summary = f"Add {friendly_name} ({entity_id}) to {tent.config.name} as {role.replace('_', ' ')}"
        if replacing:
            summary = f"Replace {tent.config.name} {role.replace('_', ' ')} ({replacing}) with {friendly_name} ({entity_id})"
        action = {
            "kind": "add_entity",
            "tent_id": tent_id,
            "tent_name": tent.config.name,
            "entity_id": entity_id,
            "friendly_name": friendly_name,
            "category": category,
            "role": role,
            "multiple": multiple,
            "replaces_entity": replacing,
            "summary": summary,
        }
    else:
        return {"ok": False, "error": "That TentOS action is not supported."}

    token = secrets.token_urlsafe(18)
    action.update({"token": token, "session_id": session_id, "created_at": time.time()})
    _pending_actions[token] = action
    return {
        "ok": True,
        "status": "pending_confirmation",
        "token": token,
        "summary": action["summary"],
        "message": "The action has not run. The user must confirm it in TentOS.",
    }


async def _openai_response(payload: dict) -> dict:
    api_key = settings.assistant_api_key
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="TentOS AI is not configured. Add openai_api_key to the TentOS add-on configuration and restart it.",
        )

    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    timeout = aiohttp.ClientTimeout(total=75)
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post("https://api.openai.com/v1/responses", headers=headers, json=payload) as response:
                data = await response.json(content_type=None)
                if response.status >= 400:
                    message = data.get("error", {}).get("message", "OpenAI request failed")
                    logger.error("TentOS assistant provider error %s: %s", response.status, message)
                    raise HTTPException(status_code=502, detail="The TentOS assistant could not get a model response.")
                return data
    except HTTPException:
        raise
    except (aiohttp.ClientError, TimeoutError) as exc:
        logger.error("TentOS assistant provider unavailable: %s", exc)
        raise HTTPException(status_code=502, detail="The TentOS assistant is temporarily unavailable.") from exc


async def _run_assistant(request: Request, session_id: str, message: str) -> tuple[str, list[dict]]:
    context = await _build_tentos_context(request)
    session = _conversations.setdefault(session_id, {"history": [], "updated_at": time.time()})
    history = session["history"][-12:]
    input_items = [*history, {"role": "user", "content": message}]
    pending: list[dict] = []

    for _ in range(MAX_TOOL_ROUNDS):
        response = await _openai_response({
            "model": settings.assistant_model,
            "instructions": _instructions(context),
            "input": input_items,
            "tools": TOOLS,
            "tool_choice": "auto",
            "store": False,
            "reasoning": {"effort": "low"},
            "text": {"verbosity": "low"},
            "max_output_tokens": 700,
        })
        function_calls = [item for item in response.get("output", []) if item.get("type") == "function_call"]
        if not function_calls:
            reply = _extract_response_text(response)
            if not reply:
                raise HTTPException(status_code=502, detail="The TentOS assistant returned an empty response.")
            session["history"] = [
                *history,
                {"role": "user", "content": message},
                {"role": "assistant", "content": reply},
            ][-12:]
            session["updated_at"] = time.time()
            return reply, pending

        input_items.extend(response.get("output", []))
        for call in function_calls:
            try:
                arguments = json.loads(call.get("arguments") or "{}")
            except json.JSONDecodeError:
                arguments = {}
            if call.get("name") == "find_home_assistant_entities":
                result = await _find_home_assistant_entities(str(arguments.get("query", "")), request)
            else:
                result = await _create_pending_action(call.get("name", ""), arguments, request, session_id)
            if result.get("status") == "pending_confirmation":
                action = _pending_actions[result["token"]]
                pending.append({
                    "token": result["token"],
                    "summary": action["summary"],
                    "kind": action["kind"],
                    "expires_in_seconds": ACTION_TTL_SECONDS,
                })
            input_items.append({
                "type": "function_call_output",
                "call_id": call.get("call_id"),
                "output": _safe_json(result),
            })

    raise HTTPException(status_code=502, detail="The TentOS assistant attempted too many actions at once.")


async def _log_assistant_action(action: dict, entity_id: Optional[str] = None) -> None:
    async with async_session() as session:
        session.add(Event(
            tent_id=action["tent_id"],
            event_type="assistant_action",
            notes=action["summary"],
            user="TentOS AI",
            data=_safe_json({"kind": action["kind"], "entity_id": entity_id}),
        ))
        await session.commit()


@router.get("/status")
async def assistant_status():
    """Return assistant readiness without ever returning credentials."""
    return {
        "configured": bool(settings.assistant_api_key),
        "model": settings.assistant_model if settings.assistant_api_key else None,
        "context": "TentOS only",
        "context_hours": CONTEXT_HOURS,
        "actions_require_confirmation": True,
        "voice_input": True,
        "voice_output": True,
    }


@router.post("/chat")
async def assistant_chat(chat: ChatRequest, request: Request):
    """Answer a TentOS-only question or create confirmed action proposals."""
    _clean_expired_state()
    session_id = _get_session_id(chat.session_id)
    client_host = request.client.host if request.client else "local"
    _check_rate_limit(f"chat:{client_host}:{session_id}", 20)
    message = chat.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message is required.")
    reply, pending = await _run_assistant(request, session_id, message)
    return {
        "reply": reply,
        "session_id": session_id,
        "pending_actions": pending,
        "context": "TentOS only",
        "context_hours": CONTEXT_HOURS,
    }


@router.post("/transcribe")
async def assistant_transcribe(request: Request):
    """Transcribe a short voice message without exposing the provider key."""
    client_host = request.client.host if request.client else "local"
    _check_rate_limit(f"transcribe:{client_host}", 12)
    content_type = request.headers.get("content-type", "audio/webm").split(";", 1)[0].strip().lower()
    allowed_types = {
        "audio/webm": "voice.webm",
        "audio/mp4": "voice.m4a",
        "audio/mpeg": "voice.mp3",
        "audio/wav": "voice.wav",
        "audio/x-wav": "voice.wav",
        "audio/aac": "voice.aac",
        "audio/ogg": "voice.ogg",
    }
    filename = allowed_types.get(content_type)
    if not filename:
        raise HTTPException(status_code=415, detail="Unsupported audio format.")
    body = await request.body()
    if not body or len(body) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Voice message must be under 10 MB.")

    api_key = settings.assistant_api_key
    if not api_key:
        raise HTTPException(status_code=503, detail="TentOS AI is not configured.")
    form = aiohttp.FormData()
    form.add_field("model", settings.openai_transcription_model)
    form.add_field("file", body, filename=filename, content_type=content_type)
    timeout = aiohttp.ClientTimeout(total=75)
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(
                "https://api.openai.com/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {api_key}"},
                data=form,
            ) as response:
                data = await response.json(content_type=None)
                if response.status >= 400:
                    logger.error("TentOS transcription provider error %s", response.status)
                    raise HTTPException(status_code=502, detail="TentOS could not transcribe that recording.")
                text = str(data.get("text", "")).strip()
                if not text:
                    raise HTTPException(status_code=422, detail="No speech was detected.")
                return {"text": text}
    except HTTPException:
        raise
    except (aiohttp.ClientError, TimeoutError) as exc:
        logger.error("TentOS transcription unavailable: %s", exc)
        raise HTTPException(status_code=502, detail="TentOS transcription is temporarily unavailable.") from exc


@router.post("/actions/{token}/confirm")
async def confirm_action(token: str, decision: ActionDecisionRequest, request: Request):
    """Execute exactly one previously proposed TentOS action after confirmation."""
    _clean_expired_state()
    action = _pending_actions.get(token)
    if not action:
        raise HTTPException(status_code=404, detail="This action expired or no longer exists.")
    if not secrets.compare_digest(action["session_id"], decision.session_id):
        raise HTTPException(status_code=403, detail="This action belongs to a different assistant session.")
    # Claim the token before the first await so concurrent confirmations cannot
    # execute the same physical or database action twice.
    action = _pending_actions.pop(token, None)
    if not action:
        raise HTTPException(status_code=409, detail="This action is already being processed.")

    state_manager = request.app.state.state_manager
    ha_client = request.app.state.ha_client
    tent = state_manager.get_tent(action["tent_id"])
    if not tent:
        raise HTTPException(status_code=404, detail="The tent is no longer configured.")

    try:
        if action["kind"] == "actuator_change":
            entity_id = tent.slot_to_entity.get(action["actuator"])
            if not entity_id or entity_id != action.get("entity_id"):
                raise HTTPException(status_code=409, detail="That actuator changed after this proposal. Ask TentOS again.")
            if action["state"] == "on":
                await ha_client.turn_on(entity_id)
            else:
                await ha_client.turn_off(entity_id)
            await _log_assistant_action(action, entity_id)
        elif action["kind"] == "fan_speed":
            entity_id = tent.slot_to_entity.get(action["actuator"])
            if not entity_id or entity_id != action.get("entity_id"):
                raise HTTPException(status_code=409, detail="That fan changed after this proposal. Ask TentOS again.")
            if action["percentage"] == 0:
                await ha_client.turn_off(entity_id)
            else:
                await ha_client.set_fan_speed(entity_id, action["percentage"])
            await _log_assistant_action(action, entity_id)
        elif action["kind"] == "event_log":
            async with async_session() as session:
                session.add(Event(
                    tent_id=action["tent_id"],
                    event_type=action["event_type"],
                    notes=action["notes"],
                    user="TentOS AI",
                ))
                await session.commit()
        elif action["kind"] == "add_entity":
            state = await ha_client.get_state(action["entity_id"])
            if not state:
                raise HTTPException(status_code=409, detail="That Home Assistant entity no longer exists.")
            entity = _entity_payload(state, state_manager)
            assignment = entity.get("already_assigned")
            if assignment:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"That entity is now assigned to {assignment['tent_id']} "
                        f"as {assignment['role']}. Ask TentOS to find it again."
                    ),
                )
            if not _slot_compatible(action["category"], action["role"], entity):
                raise HTTPException(status_code=409, detail="That entity is no longer compatible with the proposed TentOS slot.")

            config = load_config()
            config_tent = next((item for item in config.tents if item.id == action["tent_id"]), None)
            if not config_tent:
                raise HTTPException(status_code=409, detail="That tent is no longer in the TentOS configuration.")
            slots = getattr(config_tent, action["category"])
            if action["multiple"]:
                current = slots.get(action["role"], [])
                values = list(current) if isinstance(current, list) else ([current] if current else [])
                if action["entity_id"] in values:
                    raise HTTPException(status_code=409, detail="That entity is already configured in this TentOS slot.")
                values.append(action["entity_id"])
                slots[action["role"]] = values
            else:
                current = slots.get(action["role"])
                if current != action.get("replaces_entity"):
                    raise HTTPException(
                        status_code=409,
                        detail="That TentOS slot changed after this proposal. Ask TentOS to add the entity again.",
                    )
                slots[action["role"]] = action["entity_id"]
            if not save_config(config):
                raise HTTPException(status_code=500, detail="TentOS could not save the updated tent configuration.")
            await state_manager.reload_config()
            await _log_assistant_action(action, action["entity_id"])
        else:
            raise HTTPException(status_code=400, detail="Unsupported TentOS action.")
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Confirmed TentOS action failed: %s", exc)
        raise HTTPException(status_code=502, detail="Home Assistant could not complete that action.") from exc

    return {"success": True, "message": action["summary"], "executed": True}


@router.post("/actions/{token}/cancel")
async def cancel_action(token: str, decision: ActionDecisionRequest):
    """Discard a pending TentOS action."""
    action = _pending_actions.get(token)
    if not action:
        return {"success": True, "cancelled": False}
    if not secrets.compare_digest(action["session_id"], decision.session_id):
        raise HTTPException(status_code=403, detail="This action belongs to a different assistant session.")
    _pending_actions.pop(token, None)
    return {"success": True, "cancelled": True}
