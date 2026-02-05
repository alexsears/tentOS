"""Automation rules API routes."""
import logging
import re
from typing import Optional
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from automation import AutomationRule, TriggerType, ActionType

logger = logging.getLogger(__name__)
router = APIRouter()


def get_tent_entity_ids(tent) -> set[str]:
    """Get all entity IDs configured for a tent."""
    entity_ids = set()

    # Sensors
    for sensor_type, val in (tent.config.sensors or {}).items():
        if isinstance(val, list):
            entity_ids.update(e for e in val if e)
        elif val:
            entity_ids.add(val)

    # Actuators
    for actuator_type, val in (tent.config.actuators or {}).items():
        if isinstance(val, list):
            entity_ids.update(e for e in val if e)
        elif val:
            entity_ids.add(val)

    return entity_ids


def automation_references_entities(automation: dict, entity_ids: set[str], config: dict = None) -> bool:
    """Check if an automation references any of the entities."""
    # First, check if we have the automation config with triggers/actions
    if config:
        config_str = str(config).lower()
        for entity_id in entity_ids:
            if entity_id.lower() in config_str:
                return True

    # Fallback: check automation name/id for entity keywords
    auto_id = automation.get("entity_id", "")
    auto_name = automation.get("attributes", {}).get("friendly_name", "")
    search_text = f"{auto_id} {auto_name}".lower()

    for entity_id in entity_ids:
        # Direct entity ID match
        if entity_id.lower() in search_text:
            return True
        # Extract key parts from entity ID
        parts = entity_id.replace(".", "_").split("_")
        meaningful_parts = [p for p in parts if len(p) > 2 and p not in ("sensor", "switch", "fan", "light", "binary")]
        for part in meaningful_parts:
            if part.lower() in search_text:
                return True

    return False


async def get_automation_configs(ha_client, automations: list) -> dict:
    """Fetch configs for all automations to check entity references."""
    configs = {}
    for auto in automations:
        entity_id = auto.get("entity_id", "")
        if entity_id.startswith("automation."):
            auto_id = entity_id.replace("automation.", "")
            try:
                config = await ha_client.get_automation_config(auto_id)
                if config:
                    configs[entity_id] = config
            except Exception:
                pass  # Config not available
    return configs


class RuleCreate(BaseModel):
    """Request model for creating a rule."""
    name: str
    enabled: bool = True
    tent_id: str
    trigger_type: TriggerType
    trigger_sensor: Optional[str] = None
    trigger_value: Optional[float] = None
    trigger_value_max: Optional[float] = None
    trigger_schedule_on: Optional[str] = None
    trigger_schedule_off: Optional[str] = None
    action_type: ActionType
    action_actuator: str
    action_value: Optional[int] = None
    hysteresis: float = 0.5
    min_on_duration: int = 60
    min_off_duration: int = 60
    cooldown: int = 30


@router.get("")
async def list_rules(request: Request, tent_id: Optional[str] = None):
    """List all automation rules."""
    engine = request.app.state.automation_engine
    if not engine:
        raise HTTPException(status_code=503, detail="Automation engine not available")

    if tent_id:
        rules = engine.get_rules_for_tent(tent_id)
    else:
        rules = list(engine.rules.values())

    return {
        "rules": [r.model_dump() for r in rules],
        "count": len(rules)
    }


# ==================== Home Assistant Automations ====================
# NOTE: These must be defined BEFORE /{rule_id} to avoid route conflicts


@router.get("/ha/debug")
async def debug_ha_automations(request: Request):
    """Debug endpoint to see raw HA automation data."""
    ha_client = request.app.state.ha_client
    import aiohttp

    result = {
        "ha_url": ha_client.rest_url,
        "token_set": bool(ha_client.token),
        "dev_mode": ha_client._dev_mode,
        "connected": ha_client.connected
    }

    try:
        headers = {"Authorization": f"Bearer {ha_client.token}"}
        url = f"{ha_client.rest_url}/states"

        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers) as resp:
                result["status_code"] = resp.status
                if resp.status == 200:
                    states = await resp.json()
                    automations = [s for s in states if s.get("entity_id", "").startswith("automation.")]
                    result["total_states"] = len(states)
                    result["automations_found"] = len(automations)
                    result["automation_ids"] = [a.get("entity_id") for a in automations[:10]]
                else:
                    result["error"] = await resp.text()
    except Exception as e:
        result["exception"] = str(e)

    return result


@router.get("/ha")
async def list_ha_automations(
    request: Request,
    tent_id: Optional[str] = None,
    show_all: bool = False
):
    """List Home Assistant automations, optionally filtered by tent."""
    ha_client = request.app.state.ha_client
    state_manager = request.app.state.state_manager

    try:
        all_automations = await ha_client.get_automations()
    except Exception as e:
        logger.error(f"Failed to fetch HA automations: {e}")
        raise HTTPException(status_code=503, detail=f"Failed to fetch automations: {str(e)}")

    # If no tent filter or show_all, return all
    if not tent_id or show_all:
        return {
            "automations": all_automations,
            "count": len(all_automations),
            "filtered": False
        }

    # Get the tent and its entities
    tent = state_manager.get_tent(tent_id)
    if not tent:
        raise HTTPException(status_code=404, detail="Tent not found")

    entity_ids = get_tent_entity_ids(tent)

    # Try to get automation configs for better matching
    try:
        configs = await get_automation_configs(ha_client, all_automations)
    except Exception as e:
        logger.warning(f"Could not fetch automation configs: {e}")
        configs = {}

    # Filter automations that reference any of the tent's entities
    related = []
    for a in all_automations:
        config = configs.get(a.get("entity_id"))
        if automation_references_entities(a, entity_ids, config):
            related.append(a)

    # If no matches found, return all with a flag
    if not related:
        return {
            "automations": all_automations,
            "count": len(all_automations),
            "filtered": False,
            "no_matches": True,
            "tent_id": tent_id,
            "tent_entities": list(entity_ids),
            "message": "No automations found referencing tent entities. Showing all automations."
        }

    return {
        "automations": related,
        "count": len(related),
        "filtered": True,
        "tent_id": tent_id,
        "tent_entities": list(entity_ids)
    }


@router.post("/ha/{entity_id:path}/trigger")
async def trigger_ha_automation(entity_id: str, request: Request):
    """Manually trigger a Home Assistant automation."""
    ha_client = request.app.state.ha_client

    if not entity_id.startswith("automation."):
        entity_id = f"automation.{entity_id}"

    try:
        result = await ha_client.call_service(
            "automation",
            "trigger",
            target={"entity_id": entity_id}
        )
        return {"success": True, "result": result}
    except Exception as e:
        logger.error(f"Failed to trigger automation {entity_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/ha/{entity_id:path}/toggle")
async def toggle_ha_automation(entity_id: str, request: Request):
    """Enable/disable a Home Assistant automation."""
    ha_client = request.app.state.ha_client

    if not entity_id.startswith("automation."):
        entity_id = f"automation.{entity_id}"

    try:
        result = await ha_client.call_service(
            "automation",
            "toggle",
            target={"entity_id": entity_id}
        )
        return {"success": True, "result": result}
    except Exception as e:
        logger.error(f"Failed to toggle automation {entity_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class HAAutomationCreate(BaseModel):
    """Request model for creating/updating an HA automation."""
    alias: str  # Friendly name
    description: Optional[str] = ""
    mode: str = "single"  # single, restart, queued, parallel
    triggers: list  # List of trigger configs
    conditions: Optional[list] = []
    actions: list  # List of action configs


@router.post("/ha/create")
async def create_ha_automation(automation: HAAutomationCreate, request: Request):
    """Create a new Home Assistant automation."""
    ha_client = request.app.state.ha_client

    try:
        # Generate a unique ID
        import time
        auto_id = f"tentos_{int(time.time())}"

        config = {
            "id": auto_id,
            "alias": automation.alias,
            "description": automation.description,
            "mode": automation.mode,
            "trigger": automation.triggers,
            "condition": automation.conditions or [],
            "action": automation.actions
        }

        # Use HA config API to create automation
        result = await ha_client.create_automation(config)

        return {"success": True, "automation_id": auto_id, "result": result}
    except Exception as e:
        logger.error(f"Failed to create automation: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/ha/{automation_id}/update")
async def update_ha_automation(automation_id: str, automation: HAAutomationCreate, request: Request):
    """Update an existing Home Assistant automation."""
    ha_client = request.app.state.ha_client

    try:
        config = {
            "id": automation_id,
            "alias": automation.alias,
            "description": automation.description,
            "mode": automation.mode,
            "trigger": automation.triggers,
            "condition": automation.conditions or [],
            "action": automation.actions
        }

        result = await ha_client.update_automation(automation_id, config)

        return {"success": True, "result": result}
    except Exception as e:
        logger.error(f"Failed to update automation {automation_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/ha/{entity_id:path}")
async def delete_ha_automation(entity_id: str, request: Request):
    """Delete a Home Assistant automation."""
    ha_client = request.app.state.ha_client

    # Extract automation ID from entity_id
    auto_id = entity_id.replace("automation.", "")

    try:
        result = await ha_client.delete_automation(auto_id)
        return {"success": True, "result": result}
    except Exception as e:
        logger.error(f"Failed to delete automation {entity_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/ha/{entity_id:path}/config")
async def get_ha_automation_config(entity_id: str, request: Request):
    """Get the configuration of a Home Assistant automation."""
    ha_client = request.app.state.ha_client

    auto_id = entity_id.replace("automation.", "")

    try:
        config = await ha_client.get_automation_config(auto_id)
        if not config:
            raise HTTPException(status_code=404, detail="Automation config not found")
        return {"automation_id": auto_id, "config": config}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get automation config {entity_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== TentOS Rules ====================


@router.get("/{rule_id}")
async def get_rule(rule_id: str, request: Request):
    """Get a specific rule with its current status."""
    engine = request.app.state.automation_engine
    if not engine:
        raise HTTPException(status_code=503, detail="Automation engine not available")

    rule = engine.rules.get(rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")

    status = engine.get_rule_status(rule_id)
    return {
        "rule": rule.model_dump(),
        "status": status
    }


@router.post("")
async def create_rule(rule_data: RuleCreate, request: Request):
    """Create a new automation rule."""
    engine = request.app.state.automation_engine
    if not engine:
        raise HTTPException(status_code=503, detail="Automation engine not available")

    # Generate unique ID
    import time
    rule_id = f"rule_{int(time.time() * 1000)}"

    rule = AutomationRule(
        id=rule_id,
        **rule_data.model_dump()
    )

    engine.add_rule(rule)

    return {"success": True, "rule": rule.model_dump()}


@router.put("/{rule_id}")
async def update_rule(rule_id: str, rule_data: RuleCreate, request: Request):
    """Update an existing rule."""
    engine = request.app.state.automation_engine
    if not engine:
        raise HTTPException(status_code=503, detail="Automation engine not available")

    if rule_id not in engine.rules:
        raise HTTPException(status_code=404, detail="Rule not found")

    rule = AutomationRule(
        id=rule_id,
        **rule_data.model_dump()
    )

    engine.add_rule(rule)

    return {"success": True, "rule": rule.model_dump()}


@router.delete("/{rule_id}")
async def delete_rule(rule_id: str, request: Request):
    """Delete a rule."""
    engine = request.app.state.automation_engine
    if not engine:
        raise HTTPException(status_code=503, detail="Automation engine not available")

    if rule_id not in engine.rules:
        raise HTTPException(status_code=404, detail="Rule not found")

    engine.remove_rule(rule_id)

    return {"success": True, "message": "Rule deleted"}


@router.post("/{rule_id}/enable")
async def enable_rule(rule_id: str, request: Request):
    """Enable a rule."""
    engine = request.app.state.automation_engine
    if not engine:
        raise HTTPException(status_code=503, detail="Automation engine not available")

    rule = engine.rules.get(rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")

    rule.enabled = True
    engine.save_rules()

    return {"success": True, "enabled": True}


@router.post("/{rule_id}/disable")
async def disable_rule(rule_id: str, request: Request):
    """Disable a rule."""
    engine = request.app.state.automation_engine
    if not engine:
        raise HTTPException(status_code=503, detail="Automation engine not available")

    rule = engine.rules.get(rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")

    rule.enabled = False
    engine.save_rules()

    return {"success": True, "enabled": False}


# Preset templates for common automations
RULE_TEMPLATES = {
    "high_temp_exhaust": {
        "name": "High Temp - Turn On Exhaust",
        "trigger_type": "sensor_above",
        "trigger_sensor": "temperature",
        "trigger_value": 28,
        "action_type": "turn_on",
        "action_actuator": "exhaust_fan",
        "hysteresis": 1.0
    },
    "low_humidity_humidifier": {
        "name": "Low Humidity - Turn On Humidifier",
        "trigger_type": "sensor_below",
        "trigger_sensor": "humidity",
        "trigger_value": 50,
        "action_type": "turn_on",
        "action_actuator": "humidifier",
        "hysteresis": 5
    },
    "high_humidity_dehumidifier": {
        "name": "High Humidity - Turn On Dehumidifier",
        "trigger_type": "sensor_above",
        "trigger_sensor": "humidity",
        "trigger_value": 70,
        "action_type": "turn_on",
        "action_actuator": "dehumidifier",
        "hysteresis": 5
    },
    "high_vpd_humidifier": {
        "name": "High VPD - Turn On Humidifier",
        "trigger_type": "sensor_above",
        "trigger_sensor": "vpd",
        "trigger_value": 1.4,
        "action_type": "turn_on",
        "action_actuator": "humidifier",
        "hysteresis": 0.2
    },
    "light_schedule": {
        "name": "Light Schedule (18/6)",
        "trigger_type": "schedule",
        "trigger_schedule_on": "06:00",
        "trigger_schedule_off": "00:00",
        "action_type": "turn_on",
        "action_actuator": "light"
    }
}


@router.get("/templates/list")
async def list_templates():
    """List available rule templates."""
    return {"templates": RULE_TEMPLATES}


@router.post("/templates/{template_id}/apply")
async def apply_template(template_id: str, tent_id: str, request: Request):
    """Apply a template to create a new rule."""
    engine = request.app.state.automation_engine
    if not engine:
        raise HTTPException(status_code=503, detail="Automation engine not available")

    if template_id not in RULE_TEMPLATES:
        raise HTTPException(status_code=404, detail="Template not found")

    template = RULE_TEMPLATES[template_id]

    import time
    rule_id = f"rule_{int(time.time() * 1000)}"

    rule = AutomationRule(
        id=rule_id,
        tent_id=tent_id,
        enabled=True,
        **template
    )

    engine.add_rule(rule)

    return {"success": True, "rule": rule.model_dump()}


