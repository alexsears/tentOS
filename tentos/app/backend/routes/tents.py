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

logger = logging.getLogger(__name__)
router = APIRouter()


class ActionRequest(BaseModel):
    """Request model for tent actions."""
    action: str  # toggle_light, set_fan, run_watering, set_override, acknowledge_alert
    entity_type: Optional[str] = None  # light, exhaust_fan, etc.
    value: Optional[str | int | bool] = None
    duration_minutes: Optional[int] = None
    notes: Optional[str] = None


class OverrideRequest(BaseModel):
    """Request model for setting override."""
    entity_type: str
    state: str  # on, off, auto
    duration_minutes: int = 60


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
            entity_id = tent.config.actuators.get("light")
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
            entity_id = tent.config.actuators.get(fan_type)
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
            entity_id = tent.config.actuators.get("water_pump")
            if not entity_id:
                raise HTTPException(status_code=400, detail="No water pump configured")

            # Turn on briefly (default 30 seconds)
            duration = action_request.duration_minutes or 1
            await ha_client.turn_on(entity_id)

            # Log the event
            async with get_db().__anext__() as session:
                event = Event(
                    tent_id=tent_id,
                    event_type="watering",
                    notes=action_request.notes or f"Manual watering for {duration} min"
                )
                session.add(event)
                await session.commit()

            return {"success": True, "message": "Watering started", "duration_minutes": duration}

        elif action == "set_override":
            if not action_request.entity_type:
                raise HTTPException(status_code=400, detail="entity_type required")

            entity_id = tent.config.actuators.get(action_request.entity_type)
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

        elif action == "turn_on":
            entity_type = action_request.entity_type
            if not entity_type:
                raise HTTPException(status_code=400, detail="entity_type required")

            entity_id = tent.config.actuators.get(entity_type)
            if not entity_id:
                raise HTTPException(status_code=400, detail=f"No {entity_type} configured")

            await ha_client.turn_on(entity_id)
            return {"success": True, "message": f"{entity_type} turned on"}

        elif action == "turn_off":
            entity_type = action_request.entity_type
            if not entity_type:
                raise HTTPException(status_code=400, detail="entity_type required")

            entity_id = tent.config.actuators.get(entity_type)
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
                "timestamp": record.timestamp.isoformat(),
                "value": record.value
            })

        return {"tent_id": tent_id, "range": range, "history": history}
