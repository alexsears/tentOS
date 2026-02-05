"""System API routes."""
import json
import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from config import settings, load_tents_config

logger = logging.getLogger(__name__)
router = APIRouter()


class ConfigUpdate(BaseModel):
    """Request model for config updates."""
    tents: Optional[list] = None


@router.get("/config")
async def get_config():
    """Get current configuration."""
    tents = load_tents_config()
    return {
        "log_level": settings.log_level,
        "tents": [
            {
                "id": t.id,
                "name": t.name,
                "description": t.description,
                "sensors": t.sensors,
                "actuators": t.actuators,
                "targets": t.targets,
                "schedules": t.schedules,
                "notifications": t.notifications
            }
            for t in tents
        ]
    }


@router.get("/status")
async def get_status(request: Request):
    """Get system status."""
    ha_client = request.app.state.ha_client
    state_manager = request.app.state.state_manager

    return {
        "ha_connected": ha_client.connected if ha_client else False,
        "tents_loaded": len(state_manager.tents) if state_manager else 0,
        "entities_mapped": len(state_manager.entity_to_tent) if state_manager else 0,
        "ws_clients": len(state_manager.ws_clients) if state_manager else 0
    }


@router.get("/entities")
async def list_entities(request: Request, domain: Optional[str] = None):
    """List available HA entities for mapping."""
    ha_client = request.app.state.ha_client

    if not ha_client or not ha_client.connected:
        raise HTTPException(status_code=503, detail="Not connected to Home Assistant")

    try:
        states = await ha_client.get_states()

        entities = []
        for state in states:
            entity_id = state.get("entity_id", "")
            entity_domain = entity_id.split(".")[0] if "." in entity_id else ""

            if domain and entity_domain != domain:
                continue

            entities.append({
                "entity_id": entity_id,
                "domain": entity_domain,
                "friendly_name": state.get("attributes", {}).get("friendly_name", entity_id),
                "state": state.get("state"),
                "unit": state.get("attributes", {}).get("unit_of_measurement")
            })

        # Sort by domain then name
        entities.sort(key=lambda x: (x["domain"], x["friendly_name"]))

        return {"entities": entities, "count": len(entities)}

    except Exception as e:
        logger.error(f"Failed to list entities: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/entity/{entity_id:path}")
async def get_entity(entity_id: str, request: Request):
    """Get details for a specific entity."""
    ha_client = request.app.state.ha_client

    if not ha_client or not ha_client.connected:
        raise HTTPException(status_code=503, detail="Not connected to Home Assistant")

    try:
        state = await ha_client.get_state(entity_id)
        if not state:
            raise HTTPException(status_code=404, detail="Entity not found")

        return {
            "entity_id": entity_id,
            "state": state.get("state"),
            "attributes": state.get("attributes", {}),
            "last_changed": state.get("last_changed"),
            "last_updated": state.get("last_updated")
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get entity: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/vpd-chart")
async def get_vpd_chart_data():
    """Get VPD chart reference data."""
    # VPD ranges for reference (generic, no crop-specific advice)
    return {
        "ranges": [
            {"min": 0.0, "max": 0.4, "label": "Low", "color": "#3498db"},
            {"min": 0.4, "max": 0.8, "label": "Early Growth", "color": "#2ecc71"},
            {"min": 0.8, "max": 1.2, "label": "Optimal", "color": "#27ae60"},
            {"min": 1.2, "max": 1.6, "label": "Late Growth", "color": "#f1c40f"},
            {"min": 1.6, "max": 2.5, "label": "High", "color": "#e74c3c"},
        ],
        "formula": "VPD = SVP × (1 - RH/100), where SVP = 0.6108 × exp(17.27 × T / (T + 237.3))",
        "units": "kPa"
    }
