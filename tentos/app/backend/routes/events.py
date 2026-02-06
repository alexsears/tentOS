"""Event logging API routes."""
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select, and_, desc
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db, Event

logger = logging.getLogger(__name__)
router = APIRouter()


def get_tent_entity_ids(tent) -> set[str]:
    """Get all entity IDs configured for a tent.

    Works with TentState objects (tent.config.sensors) and TentConfig objects (tent.sensors).
    """
    entity_ids = set()

    # Handle TentState object (has .config attribute)
    if hasattr(tent, 'config'):
        sensors = tent.config.sensors or {}
        actuators = tent.config.actuators or {}
    # Handle TentConfig object (direct .sensors attribute)
    elif hasattr(tent, 'sensors'):
        sensors = tent.sensors or {}
        actuators = getattr(tent, 'actuators', {}) or {}
    else:
        return entity_ids

    for sensor_type, val in sensors.items():
        if isinstance(val, list):
            entity_ids.update(e for e in val if e)
        elif val:
            entity_ids.add(val)
    for actuator_type, val in actuators.items():
        if isinstance(val, list):
            entity_ids.update(e for e in val if e)
        elif val:
            entity_ids.add(val)
    return entity_ids


class EventCreate(BaseModel):
    """Request model for creating an event."""
    tent_id: str
    event_type: str  # watering, refill, filter_change, solution_change, maintenance, note
    notes: Optional[str] = None
    user: Optional[str] = None
    data: Optional[dict] = None


class EventResponse(BaseModel):
    """Response model for an event."""
    id: int
    tent_id: str
    event_type: str
    timestamp: str
    notes: Optional[str]
    user: Optional[str]


@router.post("")
async def create_event(event_data: EventCreate):
    """Log a manual event."""
    import json

    async for session in get_db():
        event = Event(
            tent_id=event_data.tent_id,
            event_type=event_data.event_type,
            notes=event_data.notes,
            user=event_data.user,
            data=json.dumps(event_data.data) if event_data.data else None
        )
        session.add(event)
        await session.commit()
        await session.refresh(event)

        return {
            "id": event.id,
            "tent_id": event.tent_id,
            "event_type": event.event_type,
            "timestamp": event.timestamp.isoformat(),
            "notes": event.notes,
            "user": event.user
        }


@router.get("")
async def list_events(
    tent_id: Optional[str] = None,
    event_type: Optional[str] = None,
    limit: int = 50,
    offset: int = 0
):
    """List events with optional filtering."""
    async for session in get_db():
        query = select(Event)

        if tent_id:
            query = query.where(Event.tent_id == tent_id)
        if event_type:
            query = query.where(Event.event_type == event_type)

        query = query.order_by(desc(Event.timestamp)).limit(limit).offset(offset)

        result = await session.execute(query)
        events = result.scalars().all()

        return {
            "events": [
                {
                    "id": e.id,
                    "tent_id": e.tent_id,
                    "event_type": e.event_type,
                    "timestamp": e.timestamp.isoformat(),
                    "notes": e.notes,
                    "user": e.user
                }
                for e in events
            ],
            "limit": limit,
            "offset": offset
        }


@router.get("/types")
async def get_event_types():
    """Get available event types."""
    return {
        "types": [
            {"id": "watering", "label": "Watering", "icon": "water"},
            {"id": "refill", "label": "Reservoir Refill", "icon": "bucket"},
            {"id": "filter_change", "label": "Filter Change", "icon": "air-filter"},
            {"id": "solution_change", "label": "Solution Change", "icon": "flask"},
            {"id": "maintenance", "label": "Maintenance", "icon": "wrench"},
            {"id": "note", "label": "Note", "icon": "note"},
        ]
    }


# ==================== Home Assistant Entity History ====================
# NOTE: This route MUST be before /{event_id} to avoid route conflicts

@router.get("/ha-history")
async def get_ha_entity_history(
    request: Request,
    tent_id: Optional[str] = None,
    hours: int = 24,
    entity_id: Optional[str] = None
):
    """Get Home Assistant entity state change history for tent entities."""
    ha_client = request.app.state.ha_client
    state_manager = request.app.state.state_manager

    try:
        # Determine which entities to fetch history for
        entity_ids = []

        if entity_id:
            # Specific entity requested
            entity_ids = [entity_id]
        elif tent_id:
            # Get entities for specific tent
            tent = state_manager.get_tent(tent_id)
            if tent:
                entity_ids = list(get_tent_entity_ids(tent))
        else:
            # Get entities for all tents
            for tent in state_manager.tents.values():
                entity_ids.extend(get_tent_entity_ids(tent))

        if not entity_ids:
            return {"events": [], "count": 0, "message": "No tent entities configured"}

        # Calculate time range
        end_time = datetime.now(timezone.utc)
        start_time = end_time - timedelta(hours=hours)

        # Fetch history from HA
        history_data = await ha_client.get_history(
            entity_ids=entity_ids,
            start_time=start_time.isoformat(),
            end_time=end_time.isoformat()
        )

        # Flatten and format the history into events
        events = []
        for entity_history in history_data:
            if not entity_history:
                continue

            prev_state = None
            for state_entry in entity_history:
                current_state = state_entry.get("state")
                entity = state_entry.get("entity_id", "")
                timestamp = state_entry.get("last_changed")

                # Skip unchanged states or unavailable
                if current_state == prev_state or current_state in ("unavailable", "unknown"):
                    prev_state = current_state
                    continue

                # Determine event type based on entity domain
                domain = entity.split(".")[0] if "." in entity else ""
                friendly_name = state_entry.get("attributes", {}).get("friendly_name", entity)

                # Create descriptive event
                if domain in ("switch", "light", "fan"):
                    if current_state == "on":
                        description = f"{friendly_name} turned on"
                        event_type = "device_on"
                    elif current_state == "off":
                        description = f"{friendly_name} turned off"
                        event_type = "device_off"
                    else:
                        description = f"{friendly_name} → {current_state}"
                        event_type = "state_change"
                elif domain == "sensor":
                    unit = state_entry.get("attributes", {}).get("unit_of_measurement", "")
                    description = f"{friendly_name}: {current_state}{unit}"
                    event_type = "sensor_reading"
                elif domain == "binary_sensor":
                    description = f"{friendly_name} → {current_state}"
                    event_type = "sensor_trigger"
                else:
                    description = f"{friendly_name} → {current_state}"
                    event_type = "state_change"

                events.append({
                    "entity_id": entity,
                    "friendly_name": friendly_name,
                    "state": current_state,
                    "prev_state": prev_state,
                    "timestamp": timestamp,
                    "event_type": event_type,
                    "description": description,
                    "domain": domain
                })

                prev_state = current_state

        # Sort by timestamp descending (most recent first)
        events.sort(key=lambda x: x.get("timestamp", ""), reverse=True)

        # Filter to significant events only (state changes, not continuous readings)
        # For sensors, only keep changes above a threshold
        filtered_events = []
        sensor_last_values = {}

        for event in events:
            if event["domain"] == "sensor":
                entity = event["entity_id"]
                try:
                    current_val = float(event["state"])
                    if entity in sensor_last_values:
                        # Only include if changed by more than threshold
                        threshold = 0.5 if "temp" in entity.lower() else 2.0
                        if abs(current_val - sensor_last_values[entity]) < threshold:
                            continue
                    sensor_last_values[entity] = current_val
                except (ValueError, TypeError):
                    pass  # Non-numeric sensor, include it

            filtered_events.append(event)

        return {
            "events": filtered_events[:200],  # Limit to 200 most recent
            "count": len(filtered_events),
            "total_raw": len(events),
            "entity_ids": list(entity_ids),
            "hours": hours
        }

    except Exception as e:
        logger.error(f"Failed to fetch HA history: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== Individual Event Routes ====================
# NOTE: These MUST be after /ha-history and /types to avoid route conflicts

@router.get("/{event_id}")
async def get_event(event_id: int):
    """Get a specific event."""
    async for session in get_db():
        result = await session.execute(
            select(Event).where(Event.id == event_id)
        )
        event = result.scalar_one_or_none()

        if not event:
            raise HTTPException(status_code=404, detail="Event not found")

        return {
            "id": event.id,
            "tent_id": event.tent_id,
            "event_type": event.event_type,
            "timestamp": event.timestamp.isoformat(),
            "notes": event.notes,
            "user": event.user,
            "data": event.data
        }


@router.delete("/{event_id}")
async def delete_event(event_id: int):
    """Delete an event."""
    async for session in get_db():
        result = await session.execute(
            select(Event).where(Event.id == event_id)
        )
        event = result.scalar_one_or_none()

        if not event:
            raise HTTPException(status_code=404, detail="Event not found")

        await session.delete(event)
        await session.commit()

        return {"success": True, "message": "Event deleted"}
