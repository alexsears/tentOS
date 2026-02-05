"""Event logging API routes."""
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, and_, desc
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db, Event

logger = logging.getLogger(__name__)
router = APIRouter()


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
