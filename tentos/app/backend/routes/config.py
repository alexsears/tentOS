"""Configuration API routes for visual tent builder."""
import json
import logging
import shutil
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()

CONFIG_PATH = Path("/data/config.json")
CONFIG_BACKUP_PATH = Path("/data/config.backup.json")

# Slot definitions with compatibility rules
SLOT_DEFINITIONS = {
    "sensors": {
        "temperature": {
            "label": "Temperature",
            "required": True,
            "multiple": True,
            "domains": ["sensor"],
            "device_classes": ["temperature"],
            "icon": "🌡️"
        },
        "humidity": {
            "label": "Humidity",
            "required": True,
            "multiple": True,
            "domains": ["sensor"],
            "device_classes": ["humidity"],
            "icon": "💧"
        },
        "co2": {
            "label": "CO2 Sensor",
            "required": False,
            "domains": ["sensor"],
            "device_classes": ["carbon_dioxide"],
            "icon": "🫧"
        },
        "light_level": {
            "label": "Light Sensor",
            "required": False,
            "domains": ["sensor"],
            "device_classes": ["illuminance"],
            "icon": "☀️"
        },
        "reservoir_level": {
            "label": "Reservoir Level",
            "required": False,
            "domains": ["sensor"],
            "device_classes": ["volume", "distance", None],
            "icon": "🪣"
        },
        "leak_sensor": {
            "label": "Leak Sensor",
            "required": False,
            "domains": ["binary_sensor"],
            "device_classes": ["moisture", "water"],
            "icon": "🚨"
        },
        "power_usage": {
            "label": "Power Monitor",
            "required": False,
            "domains": ["sensor"],
            "device_classes": ["power", "energy"],
            "icon": "⚡"
        },
        "camera": {
            "label": "Camera",
            "required": False,
            "multiple": True,
            "domains": ["camera"],
            "device_classes": [None],
            "icon": "📷"
        }
    },
    "actuators": {
        "light": {
            "label": "Grow Lights",
            "required": False,
            "multiple": True,
            "domains": ["switch", "light"],
            "device_classes": [None],
            "icon": "💡"
        },
        "exhaust_fan": {
            "label": "Exhaust Fans",
            "required": False,
            "multiple": True,
            "domains": ["fan", "switch"],
            "device_classes": [None],
            "icon": "🌀"
        },
        "circulation_fan": {
            "label": "Circulation Fans",
            "required": False,
            "multiple": True,
            "domains": ["fan", "switch"],
            "device_classes": [None],
            "icon": "🔄"
        },
        "humidifier": {
            "label": "Humidifier",
            "required": False,
            "domains": ["switch", "humidifier"],
            "device_classes": [None],
            "icon": "💨"
        },
        "dehumidifier": {
            "label": "Dehumidifier",
            "required": False,
            "domains": ["switch"],
            "device_classes": [None],
            "icon": "🏜️"
        },
        "heater": {
            "label": "Heater",
            "required": False,
            "domains": ["switch", "climate"],
            "device_classes": [None],
            "icon": "🔥"
        },
        "ac": {
            "label": "A/C",
            "required": False,
            "domains": ["switch", "climate"],
            "device_classes": [None],
            "icon": "❄️"
        },
        "water_pump": {
            "label": "Water Pumps",
            "required": False,
            "multiple": True,
            "domains": ["switch"],
            "device_classes": [None],
            "icon": "🚿"
        },
        "drain_pump": {
            "label": "Drain Pump",
            "required": False,
            "domains": ["switch"],
            "device_classes": [None],
            "icon": "🔽"
        }
    }
}

DEFAULT_TARGETS = {
    "temp_day_min": 22,
    "temp_day_max": 28,
    "temp_night_min": 18,
    "temp_night_max": 24,
    "humidity_day_min": 50,
    "humidity_day_max": 70,
    "humidity_night_min": 50,
    "humidity_night_max": 65
}

DEFAULT_SCHEDULES = {
    "photoperiod_on": "06:00",
    "photoperiod_off": "22:00"
}


class TentConfig(BaseModel):
    """Tent configuration model."""
    id: str
    name: str
    description: Optional[str] = ""
    sensors: dict = {}
    actuators: dict = {}
    targets: dict = {}
    schedules: dict = {}
    notifications: dict = {"enabled": True}


class AppConfig(BaseModel):
    """Full application configuration."""
    version: str = "1.0"
    tents: list[TentConfig] = []
    hiddenEntities: list[str] = []
    hiddenGroups: list[str] = []
    customNames: dict = {}


def load_config() -> AppConfig:
    """Load configuration from file."""
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH) as f:
                data = json.load(f)
                return AppConfig(**data)
        except Exception as e:
            logger.error(f"Failed to load config: {e}")
    return AppConfig()


def save_config(config: AppConfig) -> bool:
    """Save configuration atomically with backup."""
    try:
        # Backup existing config
        if CONFIG_PATH.exists():
            shutil.copy(CONFIG_PATH, CONFIG_BACKUP_PATH)

        # Write new config atomically
        temp_path = CONFIG_PATH.with_suffix(".tmp")
        with open(temp_path, "w") as f:
            json.dump(config.model_dump(), f, indent=2)

        temp_path.rename(CONFIG_PATH)
        logger.info("Configuration saved successfully")
        return True
    except Exception as e:
        logger.error(f"Failed to save config: {e}")
        return False


@router.get("/slots")
async def get_slot_definitions():
    """Get slot definitions for the tent builder."""
    return SLOT_DEFINITIONS


@router.get("")
async def get_config():
    """Get current configuration."""
    config = load_config()
    return config.model_dump()


@router.put("")
async def update_config(config: AppConfig, request: Request):
    """Update and save configuration."""
    if save_config(config):
        # Reload state manager to pick up new config
        state_manager = getattr(request.app.state, "state_manager", None)
        if state_manager:
            try:
                await state_manager.reload_config()
            except Exception as e:
                logger.warning(f"Failed to reload state manager: {e}")
        return {"success": True, "message": "Configuration saved"}
    raise HTTPException(status_code=500, detail="Failed to save configuration")


@router.post("/tents")
async def create_tent(tent: TentConfig, request: Request):
    """Create a new tent."""
    config = load_config()

    # Check for duplicate ID
    if any(t.id == tent.id for t in config.tents):
        raise HTTPException(status_code=400, detail="Tent ID already exists")

    # Apply defaults
    if not tent.targets:
        tent.targets = DEFAULT_TARGETS.copy()
    if not tent.schedules:
        tent.schedules = DEFAULT_SCHEDULES.copy()

    config.tents.append(tent)

    if save_config(config):
        # Reload state manager to pick up new config
        state_manager = getattr(request.app.state, "state_manager", None)
        if state_manager:
            try:
                await state_manager.reload_config()
            except Exception as e:
                logger.warning(f"Failed to reload state manager: {e}")
        return {"success": True, "tent": tent.model_dump()}
    raise HTTPException(status_code=500, detail="Failed to save tent")


@router.put("/tents/{tent_id}")
async def update_tent(tent_id: str, tent: TentConfig, request: Request):
    """Update an existing tent."""
    config = load_config()

    for i, t in enumerate(config.tents):
        if t.id == tent_id:
            config.tents[i] = tent
            if save_config(config):
                # Reload state manager to pick up new entity mappings
                state_manager = getattr(request.app.state, "state_manager", None)
                if state_manager:
                    try:
                        await state_manager.reload_config()
                    except Exception as e:
                        logger.warning(f"Failed to reload state manager: {e}")
                return {"success": True, "tent": tent.model_dump()}
            raise HTTPException(status_code=500, detail="Failed to save tent")

    raise HTTPException(status_code=404, detail="Tent not found")


@router.delete("/tents/{tent_id}")
async def delete_tent(tent_id: str, request: Request):
    """Delete a tent."""
    config = load_config()

    original_len = len(config.tents)
    config.tents = [t for t in config.tents if t.id != tent_id]

    if len(config.tents) == original_len:
        raise HTTPException(status_code=404, detail="Tent not found")

    if save_config(config):
        # Reload state manager to remove deleted tent
        state_manager = getattr(request.app.state, "state_manager", None)
        if state_manager:
            try:
                await state_manager.reload_config()
            except Exception as e:
                logger.warning(f"Failed to reload state manager: {e}")
        return {"success": True, "message": "Tent deleted"}
    raise HTTPException(status_code=500, detail="Failed to delete tent")


@router.post("/validate")
async def validate_config(config: AppConfig, request: Request):
    """Validate configuration without saving."""
    ha_client = request.app.state.ha_client
    errors = []
    warnings = []

    # Get current HA states to validate entities exist
    try:
        states = await ha_client.get_states() if ha_client and ha_client.connected else []
        entity_ids = {s.get("entity_id") for s in states}
    except Exception:
        entity_ids = set()

    for tent in config.tents:
        # Check required slots
        if not tent.sensors.get("temperature"):
            warnings.append(f"Tent '{tent.name}': Missing temperature sensor")
        if not tent.sensors.get("humidity"):
            warnings.append(f"Tent '{tent.name}': Missing humidity sensor")

        # Check entities exist
        for slot_type, entity_id in tent.sensors.items():
            if entity_id and entity_ids and entity_id not in entity_ids:
                errors.append(f"Tent '{tent.name}': Entity '{entity_id}' not found in Home Assistant")

        for slot_type, entity_id in tent.actuators.items():
            if entity_id and entity_ids and entity_id not in entity_ids:
                errors.append(f"Tent '{tent.name}': Entity '{entity_id}' not found in Home Assistant")

    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings
    }
