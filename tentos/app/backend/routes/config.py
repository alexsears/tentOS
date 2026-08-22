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
    control_settings: dict = {}
    growth_stage: dict = {}


class AppConfig(BaseModel):
    """Full application configuration."""
    version: str = "1.0"
    tents: list[TentConfig] = []
    hiddenEntities: list[str] = []
    hiddenGroups: list[str] = []
    customNames: dict = {}


def _load_tents_from_options() -> list[TentConfig]:
    """Load tent configs from HA addon options.json."""
    options_path = Path("/data/options.json")
    if not options_path.exists():
        return []
    try:
        with open(options_path) as f:
            options = json.load(f)
        tents = []
        for t in options.get("tents", []):
            tent_id = t.get("name", "").lower().replace(" ", "_")
            tents.append(TentConfig(
                id=tent_id,
                name=t.get("name", ""),
                description=t.get("description", ""),
                sensors=t.get("sensors", {}),
                actuators=t.get("actuators", {}),
                targets=t.get("targets", {}),
                schedules=t.get("schedules", {}),
                notifications=t.get("notifications", {"enabled": True}),
                control_settings=t.get("control_settings", {}),
                growth_stage=t.get("growth_stage", {}),
            ))
        return tents
    except Exception as e:
        logger.error(f"Failed to load options.json: {e}")
        return []


def _has_value(val) -> bool:
    """Check if a sensor/actuator slot value is non-empty."""
    if isinstance(val, list):
        return any(v for v in val)
    return bool(val)


def load_config() -> AppConfig:
    """Load configuration from file.

    Merges options.json (HA addon config) with config.json (Settings UI).
    options.json provides base tent entity assignments.
    config.json overrides per-slot when it has non-empty values (user edits via Settings UI).
    App settings (hiddenEntities, hiddenGroups, customNames) come from config.json.
    """
    # Load app-level config from config.json
    app_config = None
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH) as f:
                data = json.load(f)
                app_config = AppConfig(**data)
        except Exception as e:
            logger.error(f"Failed to load config: {e}")

    # Load tents from options.json (HA addon config)
    options_tents = _load_tents_from_options()

    if app_config and options_tents:
        # Merge: options.json as base, config.json overrides per-slot
        config_tent_map = {t.id: t for t in app_config.tents}
        merged_tents = []
        for opt_tent in options_tents:
            cfg_tent = config_tent_map.get(opt_tent.id)
            if cfg_tent:
                # Merge sensors: config.json overrides per-slot
                for key, val in (cfg_tent.sensors or {}).items():
                    if _has_value(val):
                        opt_tent.sensors[key] = val
                # Merge actuators: config.json overrides per-slot
                for key, val in (cfg_tent.actuators or {}).items():
                    if _has_value(val):
                        opt_tent.actuators[key] = val
                # Keep targets/schedules from config.json if they have data
                if cfg_tent.targets:
                    opt_tent.targets = cfg_tent.targets
                if cfg_tent.schedules:
                    opt_tent.schedules = cfg_tent.schedules
                if cfg_tent.control_settings:
                    opt_tent.control_settings = cfg_tent.control_settings
                if cfg_tent.growth_stage:
                    opt_tent.growth_stage = cfg_tent.growth_stage
            merged_tents.append(opt_tent)
        app_config.tents = merged_tents
        return app_config

    if app_config:
        # config.json exists but no options.json tents
        if not app_config.tents:
            app_config.tents = options_tents
        return app_config

    return AppConfig(tents=options_tents)


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


TARGET_FIELDS = (
    "temp_day_min", "temp_day_max",
    "temp_night_min", "temp_night_max",
    "humidity_day_min", "humidity_day_max",
    "humidity_night_min", "humidity_night_max",
)


class TargetsUpdate(BaseModel):
    """Target ranges for a tent, in Celsius and percent."""
    temp_day_min: Optional[float] = None
    temp_day_max: Optional[float] = None
    temp_night_min: Optional[float] = None
    temp_night_max: Optional[float] = None
    humidity_day_min: Optional[float] = None
    humidity_day_max: Optional[float] = None
    humidity_night_min: Optional[float] = None
    humidity_night_max: Optional[float] = None


@router.put("/tents/{tent_id}/targets")
async def update_tent_targets(tent_id: str, targets: TargetsUpdate, request: Request):
    """Set the alert and score targets for one tent.

    Alerts and the environment score already read these; until now nothing in
    the UI could write them, so every installation ran on the built-in defaults.
    """
    values = {k: v for k, v in targets.model_dump().items() if v is not None}

    for kind in ("temp_day", "temp_night", "humidity_day", "humidity_night"):
        low, high = values.get(f"{kind}_min"), values.get(f"{kind}_max")
        if low is not None and high is not None and low >= high:
            raise HTTPException(
                status_code=400,
                detail=f"{kind.replace('_', ' ')} minimum must be below its maximum",
            )

    for key in ("humidity_day_min", "humidity_day_max", "humidity_night_min", "humidity_night_max"):
        if key in values and not (0 <= values[key] <= 100):
            raise HTTPException(status_code=400, detail=f"{key} must be between 0 and 100")

    config = load_config()
    for tent in config.tents:
        # The builder writes ids like tent_1770268610132 while the running state
        # manager keys tents by a slug of the name, and the UI knows the latter.
        slug = (tent.name or "").lower().replace(" ", "_")
        if tent.id == tent_id or slug == tent_id:
            tent.targets = values
            if not save_config(config):
                raise HTTPException(status_code=500, detail="Failed to save targets")

            state_manager = getattr(request.app.state, "state_manager", None)
            if state_manager:
                try:
                    await state_manager.reload_config()
                except Exception as e:
                    logger.warning(f"Failed to reload state manager: {e}")
            return {"success": True, "targets": values}

    raise HTTPException(status_code=404, detail="Tent not found")


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
