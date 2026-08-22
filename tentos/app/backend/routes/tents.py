"""Tent API routes."""
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db, SensorHistory, Override, Event
from state_manager import StateManager
import watering

logger = logging.getLogger(__name__)
router = APIRouter()


def iso_utc(value: datetime) -> str:
    """Serialise a stored timestamp as explicit UTC.

    Rows are written with datetime.now(timezone.utc) but SQLite drops the
    offset, so a bare isoformat() comes back naive and every browser reads it
    as local time. Charts were an offset out because of it.
    """
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


class ActionRequest(BaseModel):
    """Request model for tent actions."""
    action: str  # toggle_light, set_fan, run_watering, set_override, clear_overrides, acknowledge_alert
    entity_type: Optional[str] = None  # light, exhaust_fan, etc.
    value: Optional[str | int | bool] = None
    duration_minutes: Optional[int] = None
    notes: Optional[str] = None


class OverrideRequest(BaseModel):
    """Request model for setting override."""
    entity_type: str
    state: str  # on, off, auto
    duration_minutes: int = 60


class ControlSettingsRequest(BaseModel):
    """Request model for control settings."""
    order: Optional[list[str]] = None
    labels: Optional[dict[str, str]] = None
    icons: Optional[dict[str, str]] = None


class FlipToFlowerRequest(BaseModel):
    """Request model for flipping to flower."""
    create_light_automation: bool = True
    light_on_time: str = "06:00"
    light_off_time: str = "18:00"


class LightCycleRequest(BaseModel):
    """Request model for setting a tent's light cycle (photoperiod)."""
    mode: str  # veg | flower
    photoperiod_hours: float  # veg: 12-24, flower: 6-12
    on_time: str = "06:00"  # lights-on time HH:MM
    enabled: bool = True  # whether TentOS actively switches the light


def get_state_manager(request: Request) -> StateManager:
    """Get state manager from app state."""
    return request.app.state.state_manager


@router.get("")
async def list_tents(state_manager: StateManager = Depends(get_state_manager)):
    """List all tents with summary status."""
    return {"tents": state_manager.get_all_tents()}


@router.get("/{tent_id}")
async def get_tent(
    tent_id: str,
    state_manager: StateManager = Depends(get_state_manager)
):
    """Get detailed status for a specific tent."""
    tent = state_manager.get_tent(tent_id)
    if not tent:
        raise HTTPException(status_code=404, detail="Tent not found")
    return tent.to_dict()


@router.post("/{tent_id}/actions")
async def tent_action(
    tent_id: str,
    action_request: ActionRequest,
    request: Request,
    state_manager: StateManager = Depends(get_state_manager)
):
    """Perform an action on a tent."""
    tent = state_manager.get_tent(tent_id)
    if not tent:
        raise HTTPException(status_code=404, detail="Tent not found")

    ha_client = request.app.state.ha_client
    action = action_request.action

    try:
        if action == "toggle_light":
            entity_id = tent.slot_to_entity.get("light")
            if not entity_id:
                raise HTTPException(status_code=400, detail="No light entity configured")

            current_state = tent.actuators.get("light", {}).get("state", "off")
            if current_state == "on":
                await ha_client.turn_off(entity_id)
            else:
                await ha_client.turn_on(entity_id)

            return {"success": True, "message": f"Light toggled"}

        elif action == "set_fan":
            fan_type = action_request.entity_type or "exhaust_fan"
            entity_id = tent.slot_to_entity.get(fan_type)
            if not entity_id:
                raise HTTPException(status_code=400, detail=f"No {fan_type} entity configured")

            if action_request.value is not None:
                percentage = int(action_request.value)
                if percentage == 0:
                    await ha_client.turn_off(entity_id)
                else:
                    await ha_client.set_fan_speed(entity_id, percentage)
            else:
                # Toggle
                current_state = tent.actuators.get(fan_type, {}).get("state", "off")
                if current_state == "on":
                    await ha_client.turn_off(entity_id)
                else:
                    await ha_client.turn_on(entity_id)

            return {"success": True, "message": f"{fan_type} updated"}

        elif action == "run_watering":
            entity_id = tent.slot_to_entity.get("water_pump")
            if not entity_id:
                raise HTTPException(status_code=400, detail="No water pump configured")

            # The controller owns the timer that turns the pump back off, and
            # records the run so a restart mid-run cannot strand it on.
            duration = await watering.start(
                ha_client, tent_id, entity_id, action_request.duration_minutes or 1
            )

            if action_request.notes:
                async with get_db().__anext__() as session:
                    session.add(Event(
                        tent_id=tent_id,
                        event_type="watering",
                        notes=action_request.notes,
                    ))
                    await session.commit()

            return {
                "success": True,
                "message": f"Watering started, stopping in {duration} min",
                "duration_minutes": duration,
                "entity_id": entity_id,
            }

        elif action == "set_override":
            if not action_request.entity_type:
                raise HTTPException(status_code=400, detail="entity_type required")

            entity_id = tent.slot_to_entity.get(action_request.entity_type)
            if not entity_id:
                raise HTTPException(status_code=400, detail=f"No {action_request.entity_type} configured")

            override_state = action_request.value or "on"
            duration = action_request.duration_minutes or 60

            # Apply the override
            if override_state == "on":
                await ha_client.turn_on(entity_id)
            elif override_state == "off":
                await ha_client.turn_off(entity_id)
            # "auto" just removes override, handled below

            # Store override in database
            async for session in get_db():
                # Remove existing override
                result = await session.execute(
                    select(Override).where(
                        and_(
                            Override.tent_id == tent_id,
                            Override.entity_id == entity_id
                        )
                    )
                )
                existing = result.scalar_one_or_none()
                if existing:
                    await session.delete(existing)

                if override_state != "auto":
                    override = Override(
                        tent_id=tent_id,
                        entity_id=entity_id,
                        override_state=override_state,
                        expires_at=datetime.now(timezone.utc) + timedelta(minutes=duration)
                    )
                    session.add(override)

                await session.commit()

            return {"success": True, "message": f"Override set to {override_state} for {duration} min"}

        elif action == "clear_overrides":
            # The UI offers this as "Clear Overrides", plural, but the old call
            # site only ever cleared the light slot.
            async for session in get_db():
                result = await session.execute(
                    select(Override).where(Override.tent_id == tent_id)
                )
                overrides = result.scalars().all()
                cleared = [o.entity_id for o in overrides]
                for override in overrides:
                    await session.delete(override)
                await session.commit()
                break

            return {
                "success": True,
                "message": f"Cleared {len(cleared)} override(s)" if cleared else "No overrides to clear",
                "cleared": cleared,
            }

        elif action == "turn_on":
            entity_type = action_request.entity_type
            if not entity_type:
                raise HTTPException(status_code=400, detail="entity_type required")

            entity_id = tent.slot_to_entity.get(entity_type)
            if not entity_id:
                raise HTTPException(status_code=400, detail=f"No {entity_type} configured")

            await ha_client.turn_on(entity_id)
            return {"success": True, "message": f"{entity_type} turned on"}

        elif action == "turn_off":
            entity_type = action_request.entity_type
            if not entity_type:
                raise HTTPException(status_code=400, detail="entity_type required")

            entity_id = tent.slot_to_entity.get(entity_type)
            if not entity_id:
                raise HTTPException(status_code=400, detail=f"No {entity_type} configured")

            await ha_client.turn_off(entity_id)
            return {"success": True, "message": f"{entity_type} turned off"}

        else:
            raise HTTPException(status_code=400, detail=f"Unknown action: {action}")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Action failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{tent_id}/actuators/{slot}/toggle")
async def toggle_actuator(
    tent_id: str,
    slot: str,
    request: Request,
    state_manager: StateManager = Depends(get_state_manager)
):
    """Toggle an actuator on/off."""
    tent = state_manager.get_tent(tent_id)
    if not tent:
        raise HTTPException(status_code=404, detail="Tent not found")

    entity_id = tent.slot_to_entity.get(slot)
    if not entity_id:
        raise HTTPException(status_code=400, detail=f"No {slot} configured")

    ha_client = request.app.state.ha_client
    current_state = tent.actuators.get(slot, {}).get("state", "off")

    try:
        if current_state in ["on", "playing", "open"]:
            await ha_client.turn_off(entity_id)
            new_state = "off"
        else:
            await ha_client.turn_on(entity_id)
            new_state = "on"

        return {"success": True, "slot": slot, "new_state": new_state}

    except Exception as e:
        logger.error(f"Toggle failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{tent_id}/history")
async def get_tent_history(
    tent_id: str,
    range: str = "24h",  # 24h, 7d, 30d
    sensor: Optional[str] = None,
    state_manager: StateManager = Depends(get_state_manager)
):
    """Get sensor history for a tent."""
    tent = state_manager.get_tent(tent_id)
    if not tent:
        raise HTTPException(status_code=404, detail="Tent not found")

    # Calculate time range
    now = datetime.now(timezone.utc)
    if range == "24h":
        start_time = now - timedelta(hours=24)
    elif range == "7d":
        start_time = now - timedelta(days=7)
    elif range == "30d":
        start_time = now - timedelta(days=30)
    else:
        start_time = now - timedelta(hours=24)

    async for session in get_db():
        query = select(SensorHistory).where(
            and_(
                SensorHistory.tent_id == tent_id,
                SensorHistory.timestamp >= start_time
            )
        )

        if sensor:
            query = query.where(SensorHistory.sensor_type == sensor)

        query = query.order_by(SensorHistory.timestamp)

        result = await session.execute(query)
        records = result.scalars().all()

        # Group by sensor type
        history = {}
        for record in records:
            if record.sensor_type not in history:
                history[record.sensor_type] = []
            history[record.sensor_type].append({
                "timestamp": iso_utc(record.timestamp),
                "value": record.value
            })

        return {"tent_id": tent_id, "range": range, "history": history}


@router.put("/{tent_id}/control-settings")
async def update_control_settings(
    tent_id: str,
    settings: ControlSettingsRequest,
    request: Request,
    state_manager: StateManager = Depends(get_state_manager)
):
    """Update control customization settings for a tent."""
    tent = state_manager.get_tent(tent_id)
    if not tent:
        raise HTTPException(status_code=404, detail="Tent not found")

    try:
        # Load current config
        from config import load_addon_config, save_addon_config
        config = load_addon_config()

        # Find the tent in config
        tent_idx = None
        for i, t in enumerate(config.get("tents", [])):
            # Match by name since config uses name, not id
            if t.get("name") == tent.config.name:
                tent_idx = i
                break

        if tent_idx is None:
            raise HTTPException(status_code=404, detail="Tent not found in config")

        # Update control_settings
        if "control_settings" not in config["tents"][tent_idx]:
            config["tents"][tent_idx]["control_settings"] = {}

        cs = config["tents"][tent_idx]["control_settings"]

        if settings.order is not None:
            cs["order"] = settings.order
        if settings.labels is not None:
            cs["labels"] = settings.labels
        if settings.icons is not None:
            cs["icons"] = settings.icons

        # Save config
        save_addon_config(config)

        # Reload config in state manager
        await state_manager.reload_config()

        return {"success": True, "control_settings": cs}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update control settings: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{tent_id}/light-cycle")
async def update_light_cycle(
    tent_id: str,
    cycle: LightCycleRequest,
    request: Request,
    state_manager: StateManager = Depends(get_state_manager)
):
    """Set a tent's light cycle: veg/flower mode, photoperiod hours, lights-on time.

    Persists photoperiod_on/photoperiod_off (plus the light_cycle block) into the
    tent's schedules and syncs growth_stage. When enabled, the backend
    LightScheduler switches the tent's light entities to match.
    """
    tent = state_manager.get_tent(tent_id)
    if not tent:
        raise HTTPException(status_code=404, detail="Tent not found")

    from light_scheduler import validate_light_cycle, compute_off_time, parse_hhmm

    try:
        parse_hhmm(cycle.on_time)
        validate_light_cycle(cycle.mode, cycle.photoperiod_hours)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    off_time = compute_off_time(cycle.on_time, cycle.photoperiod_hours)

    try:
        from config import load_addon_config, save_addon_config
        config = load_addon_config()

        # Find the tent in config (config uses name, not id)
        tent_idx = None
        for i, t in enumerate(config.get("tents", [])):
            if t.get("name") == tent.config.name:
                tent_idx = i
                break

        if tent_idx is None:
            raise HTTPException(status_code=404, detail="Tent not found in config")

        tent_cfg = config["tents"][tent_idx]
        schedules = tent_cfg.setdefault("schedules", {})
        schedules["photoperiod_on"] = cycle.on_time
        schedules["photoperiod_off"] = off_time
        schedules["light_cycle"] = {
            "mode": cycle.mode,
            "photoperiod_hours": cycle.photoperiod_hours,
            "on_time": cycle.on_time,
            "enabled": cycle.enabled,
        }

        # Keep growth stage in sync with the selected mode
        growth_stage = tent_cfg.setdefault("growth_stage", {})
        previous_stage = growth_stage.get("stage")
        growth_stage["stage"] = cycle.mode
        if cycle.mode == "flower" and previous_stage != "flower":
            growth_stage["flower_start_date"] = datetime.now(timezone.utc).isoformat()
        elif cycle.mode == "veg":
            growth_stage["flower_start_date"] = None

        save_addon_config(config)
        await state_manager.reload_config()

        # Apply immediately so the light snaps to the new schedule
        applied_now = False
        light_scheduler = getattr(request.app.state, "light_scheduler", None)
        if light_scheduler and cycle.enabled:
            try:
                await light_scheduler.tick(only_tent_id=tent_id)
                applied_now = True
            except Exception as e:
                logger.warning(f"Immediate light cycle apply failed: {e}")

        # Belt-and-suspenders: sync native HA backup automations that flip the
        # lights at the schedule boundaries even if the add-on is stopped.
        # The in-app scheduler stays primary; both derive from the same saved
        # schedule so they cannot disagree. Failure here never blocks the save.
        from light_scheduler import sync_light_cycle_automations, log_light_event

        warning = None
        try:
            fresh_tent = state_manager.get_tent(tent_id)
            light_entities = [
                entity_id
                for slot, entity_id in (fresh_tent.slot_to_entity if fresh_tent else {}).items()
                if slot == "light" or slot.startswith("light_")
            ]
            await sync_light_cycle_automations(
                request.app.state.ha_client,
                tent_id,
                tent.config.name,
                cycle.enabled,
                cycle.on_time,
                off_time,
                light_entities,
            )
        except Exception as e:
            logger.error(f"Failed to sync backup light automations: {e}")
            warning = (
                "Schedule saved, but the backup Home Assistant automations "
                f"could not be updated: {e}"
            )
            try:
                await log_light_event(tent_id, warning)
            except Exception:
                pass

        return {
            "success": True,
            "light_cycle": schedules["light_cycle"],
            "photoperiod_on": cycle.on_time,
            "photoperiod_off": off_time,
            "applied_now": applied_now,
            "warning": warning,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update light cycle: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{tent_id}/flip-to-flower")
async def flip_to_flower(
    tent_id: str,
    flip_request: FlipToFlowerRequest,
    request: Request,
    state_manager: StateManager = Depends(get_state_manager)
):
    """Flip a tent from veg to flower stage."""
    tent = state_manager.get_tent(tent_id)
    if not tent:
        raise HTTPException(status_code=404, detail="Tent not found")

    try:
        from config import load_addon_config, save_addon_config
        config = load_addon_config()
        ha_client = request.app.state.ha_client

        # Find the tent in config
        tent_idx = None
        for i, t in enumerate(config.get("tents", [])):
            if t.get("name") == tent.config.name:
                tent_idx = i
                break

        if tent_idx is None:
            raise HTTPException(status_code=404, detail="Tent not found in config")

        # Update growth_stage
        if "growth_stage" not in config["tents"][tent_idx]:
            config["tents"][tent_idx]["growth_stage"] = {}

        now = datetime.now(timezone.utc)
        config["tents"][tent_idx]["growth_stage"]["stage"] = "flower"
        config["tents"][tent_idx]["growth_stage"]["flower_start_date"] = now.isoformat()

        # Update schedules for 12/12
        if "schedules" not in config["tents"][tent_idx]:
            config["tents"][tent_idx]["schedules"] = {}

        config["tents"][tent_idx]["schedules"]["photoperiod_on"] = flip_request.light_on_time
        config["tents"][tent_idx]["schedules"]["photoperiod_off"] = flip_request.light_off_time

        # Save config
        save_addon_config(config)

        # Create light automation if requested
        automation_id = None
        if flip_request.create_light_automation:
            # Collect ALL light entities (light, light_2, light_3, ...)
            light_entities = [
                eid for slot, eid in tent.slot_to_entity.items()
                if slot == "light" or slot.startswith("light_")
            ]

            if light_entities:
                auto_id = f"tentos_{tent_id}_flower_light"
                # Use single entity string if only one, else list
                target_ids = light_entities[0] if len(light_entities) == 1 else light_entities
                # Determine service domain from first entity
                svc_domain = "light" if "light." in light_entities[0] else "switch"

                # Create automation config
                auto_config = {
                    "id": auto_id,
                    "alias": f"{tent.config.name} Flower Light Schedule (12/12)",
                    "description": f"Auto-created by TentOS for flower stage - 12 hours on",
                    "mode": "single",
                    "trigger": [
                        {
                            "platform": "time",
                            "at": flip_request.light_on_time + ":00"
                        },
                        {
                            "platform": "time",
                            "at": flip_request.light_off_time + ":00"
                        }
                    ],
                    "action": [
                        {
                            "choose": [
                                {
                                    "conditions": [
                                        {
                                            "condition": "time",
                                            "after": flip_request.light_on_time + ":00",
                                            "before": flip_request.light_off_time + ":00"
                                        }
                                    ],
                                    "sequence": [
                                        {
                                            "service": f"{svc_domain}.turn_on",
                                            "target": {"entity_id": target_ids}
                                        }
                                    ]
                                }
                            ],
                            "default": [
                                {
                                    "service": f"{svc_domain}.turn_off",
                                    "target": {"entity_id": target_ids}
                                }
                            ]
                        }
                    ]
                }

                try:
                    await ha_client.create_automation(auto_config)
                    automation_id = auto_id
                except Exception as e:
                    logger.warning(f"Failed to create light automation: {e}")

        # Reload config in state manager
        await state_manager.reload_config()

        return {
            "success": True,
            "message": "Flipped to flower stage",
            "flower_start_date": now.isoformat(),
            "automation_created": automation_id
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to flip to flower: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{tent_id}/reset-to-veg")
async def reset_to_veg(
    tent_id: str,
    request: Request,
    state_manager: StateManager = Depends(get_state_manager)
):
    """Reset a tent back to veg stage."""
    tent = state_manager.get_tent(tent_id)
    if not tent:
        raise HTTPException(status_code=404, detail="Tent not found")

    try:
        from config import load_addon_config, save_addon_config
        config = load_addon_config()

        # Find the tent in config
        tent_idx = None
        for i, t in enumerate(config.get("tents", [])):
            if t.get("name") == tent.config.name:
                tent_idx = i
                break

        if tent_idx is None:
            raise HTTPException(status_code=404, detail="Tent not found in config")

        # Update growth_stage
        if "growth_stage" not in config["tents"][tent_idx]:
            config["tents"][tent_idx]["growth_stage"] = {}

        config["tents"][tent_idx]["growth_stage"]["stage"] = "veg"
        config["tents"][tent_idx]["growth_stage"]["flower_start_date"] = None

        # Save config
        save_addon_config(config)

        # Reload config in state manager
        await state_manager.reload_config()

        return {"success": True, "message": "Reset to veg stage"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to reset to veg: {e}")
        raise HTTPException(status_code=500, detail=str(e))
