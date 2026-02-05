"""Alert API routes."""
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select, and_, desc
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db, Alert
from state_manager import StateManager

logger = logging.getLogger(__name__)
router = APIRouter()


def get_state_manager(request: Request) -> StateManager:
    """Get state manager from app state."""
    return request.app.state.state_manager


class AcknowledgeRequest(BaseModel):
    """Request model for acknowledging an alert."""
    user: Optional[str] = None


@router.get("")
async def list_alerts(
    tent_id: Optional[str] = None,
    active_only: bool = True,
    state_manager: StateManager = Depends(get_state_manager)
):
    """List all current alerts."""
    # Get live alerts from state manager
    all_alerts = []

    for tid, tent in state_manager.tents.items():
        if tent_id and tid != tent_id:
            continue

        for alert in tent.alerts:
            all_alerts.append({
                "tent_id": tid,
                "tent_name": tent.config.name,
                **alert
            })

    # Also get persisted alerts from database
    async for session in get_db():
        query = select(Alert)

        if tent_id:
            query = query.where(Alert.tent_id == tent_id)
        if active_only:
            query = query.where(Alert.resolved_at.is_(None))

        query = query.order_by(desc(Alert.created_at))

        result = await session.execute(query)
        db_alerts = result.scalars().all()

        for alert in db_alerts:
            all_alerts.append({
                "id": alert.id,
                "tent_id": alert.tent_id,
                "type": alert.alert_type,
                "severity": alert.severity,
                "message": alert.message,
                "created_at": alert.created_at.isoformat(),
                "acknowledged_at": alert.acknowledged_at.isoformat() if alert.acknowledged_at else None,
                "acknowledged_by": alert.acknowledged_by,
                "persisted": True
            })

    return {"alerts": all_alerts, "count": len(all_alerts)}


@router.get("/summary")
async def alerts_summary(state_manager: StateManager = Depends(get_state_manager)):
    """Get alert summary counts."""
    critical = 0
    warning = 0
    info = 0

    for tent in state_manager.tents.values():
        for alert in tent.alerts:
            severity = alert.get("severity", "warning")
            if severity == "critical":
                critical += 1
            elif severity == "warning":
                warning += 1
            else:
                info += 1

    return {
        "critical": critical,
        "warning": warning,
        "info": info,
        "total": critical + warning + info
    }


@router.post("/{alert_id}/acknowledge")
async def acknowledge_alert(alert_id: int, request_data: AcknowledgeRequest):
    """Acknowledge an alert."""
    async for session in get_db():
        result = await session.execute(
            select(Alert).where(Alert.id == alert_id)
        )
        alert = result.scalar_one_or_none()

        if not alert:
            raise HTTPException(status_code=404, detail="Alert not found")

        alert.acknowledged_at = datetime.now(timezone.utc)
        alert.acknowledged_by = request_data.user

        await session.commit()

        return {"success": True, "message": "Alert acknowledged"}


@router.post("/{alert_id}/resolve")
async def resolve_alert(alert_id: int):
    """Resolve an alert."""
    async for session in get_db():
        result = await session.execute(
            select(Alert).where(Alert.id == alert_id)
        )
        alert = result.scalar_one_or_none()

        if not alert:
            raise HTTPException(status_code=404, detail="Alert not found")

        alert.resolved_at = datetime.now(timezone.utc)

        await session.commit()

        return {"success": True, "message": "Alert resolved"}
