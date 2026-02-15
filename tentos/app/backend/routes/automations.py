"""Home Assistant Automation API routes."""
import logging
import time
from typing import Optional
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()


# Category definitions for grouping automations
CATEGORIES = {
    "light": {
        "name": "Lighting",
        "icon": "💡",
        "keywords": ["light", "lamp", "led", "hps", "grow_light"],
        "order": 1
    },
    "climate": {
        "name": "Climate Control",
        "icon": "🌡️",
        "keywords": ["temp", "heat", "cool", "ac", "hvac", "climate"],
        "order": 2
    },
    "exhaust": {
        "name": "Ventilation",
        "icon": "🌀",
        "keywords": ["exhaust", "intake", "vent", "airflow"],
        "order": 3
    },
    "humidity": {
        "name": "Humidity",
        "icon": "💧",
        "keywords": ["humid", "dehumid", "mist", "fog"],
        "order": 4
    },
    "circulation": {
        "name": "Air Circulation",
        "icon": "🔄",
        "keywords": ["circulation", "oscillat", "clip_fan", "tower_fan"],
        "order": 5
    },
    "water": {
        "name": "Irrigation",
        "icon": "🚿",
        "keywords": ["water", "pump", "irrigation", "drip", "reservoir", "drain"],
        "order": 6
    },
    "co2": {
        "name": "CO2",
        "icon": "🫧",
        "keywords": ["co2", "carbon"],
        "order": 7
    },
    "other": {
        "name": "Other",
        "icon": "⚙️",
        "keywords": [],
        "order": 99
    }
}


# Tags for automation characteristics
TAGS = {
    "schedule": {"name": "Schedule", "icon": "🕐", "color": "blue"},
    "threshold": {"name": "Threshold", "icon": "📊", "color": "purple"},
    "sensor": {"name": "Sensor", "icon": "📡", "color": "cyan"},
    "state": {"name": "State", "icon": "🔄", "color": "orange"},
    "sun": {"name": "Sun", "icon": "🌅", "color": "yellow"},
    "motion": {"name": "Motion", "icon": "🚶", "color": "green"},
    "multi": {"name": "Multi-trigger", "icon": "⚡", "color": "red"},
}


def get_automation_tags(automation: dict, config: dict = None) -> list[str]:
    """Determine tags for an automation based on its triggers."""
    tags = []

    if not config:
        # Try to infer from name/id
        entity_id = automation.get("entity_id", "").lower()
        name = automation.get("attributes", {}).get("friendly_name", "").lower()
        text = f"{entity_id} {name}"

        if any(w in text for w in ["schedule", "time", "daily", "morning", "night"]):
            tags.append("schedule")
        if any(w in text for w in ["temp", "humid", "above", "below", "threshold"]):
            tags.append("threshold")
        return tags

    # Parse triggers from config
    triggers = config.get("trigger", [])
    if not isinstance(triggers, list):
        triggers = [triggers]

    if len(triggers) > 2:
        tags.append("multi")

    trigger_types = set()
    for trigger in triggers:
        platform = trigger.get("platform", "")
        trigger_types.add(platform)

        if platform == "time":
            tags.append("schedule")
        elif platform == "numeric_state":
            tags.append("threshold")
        elif platform == "state":
            # Check if it's a sensor
            entity = trigger.get("entity_id", "")
            if "sensor." in str(entity) or "binary_sensor." in str(entity):
                tags.append("sensor")
            else:
                tags.append("state")
        elif platform == "sun":
            tags.append("sun")
        elif platform in ("motion", "occupancy"):
            tags.append("motion")

    # Deduplicate while preserving order
    seen = set()
    unique_tags = []
    for tag in tags:
        if tag not in seen:
            seen.add(tag)
            unique_tags.append(tag)

    return unique_tags


def categorize_automation(automation: dict, config: dict = None) -> str:
    """Determine the category of an automation based on its config and name."""
    entity_id = automation.get("entity_id", "")
    friendly_name = automation.get("attributes", {}).get("friendly_name", "")
    search_text = f"{entity_id} {friendly_name}".lower()

    # For TentOS automations, parse the template type from entity_id
    if "tentos_" in entity_id:
        if "light" in entity_id or "light_schedule" in entity_id:
            return "light"
        if "exhaust" in entity_id or "high_temp" in entity_id:
            return "exhaust"
        if "humid" in entity_id:
            return "humidity"
        if "heater" in entity_id or "low_temp" in entity_id:
            return "climate"
        if "circulation" in entity_id:
            return "circulation"
        if "water" in entity_id or "pump" in entity_id:
            return "water"

    # Check config for target entities
    if config:
        config_str = str(config).lower()
        # Check each category's keywords
        for cat_id, cat_info in CATEGORIES.items():
            if cat_id == "other":
                continue
            for keyword in cat_info["keywords"]:
                if keyword in config_str:
                    return cat_id

    # Fallback: check automation name/id for keywords
    for cat_id, cat_info in CATEGORIES.items():
        if cat_id == "other":
            continue
        for keyword in cat_info["keywords"]:
            if keyword in search_text:
                return cat_id

    return "other"


# Templates for common grow tent automations
AUTOMATION_TEMPLATES = {
    "high_temp_exhaust": {
        "name": "High Temp → Exhaust Fan",
        "icon": "🌡️",
        "description": "Turn on exhaust fan when temperature exceeds threshold",
        "sensor_type": "temperature",
        "actuator_type": "exhaust_fan",
        "trigger_type": "numeric_state",
        "above": 28,
        "below": None,
    },
    "low_temp_heater": {
        "name": "Low Temp → Heater",
        "icon": "🔥",
        "description": "Turn on heater when temperature drops below threshold",
        "sensor_type": "temperature",
        "actuator_type": "heater",
        "trigger_type": "numeric_state",
        "above": None,
        "below": 18,
    },
    "high_humidity_dehumidifier": {
        "name": "High Humidity → Dehumidifier",
        "icon": "🏜️",
        "description": "Turn on dehumidifier when humidity exceeds threshold",
        "sensor_type": "humidity",
        "actuator_type": "dehumidifier",
        "trigger_type": "numeric_state",
        "above": 70,
        "below": None,
    },
    "low_humidity_humidifier": {
        "name": "Low Humidity → Humidifier",
        "icon": "💧",
        "description": "Turn on humidifier when humidity drops below threshold",
        "sensor_type": "humidity",
        "actuator_type": "humidifier",
        "trigger_type": "numeric_state",
        "above": None,
        "below": 50,
    },
    "light_schedule": {
        "name": "Light Schedule",
        "icon": "💡",
        "description": "Turn lights on/off on a schedule (e.g., 18/6 for veg)",
        "sensor_type": None,
        "actuator_type": "light",
        "trigger_type": "time",
        "time_on": "06:00:00",
        "time_off": "00:00:00",
    },
    "circulation_fan_with_lights": {
        "name": "Circulation Fan with Lights",
        "icon": "🔄",
        "description": "Run circulation fan when lights are on",
        "sensor_type": None,
        "actuator_type": "circulation_fan",
        "trigger_type": "state",
        "trigger_entity_type": "light",
    },
    "high_vpd_humidifier": {
        "name": "High VPD → Humidifier",
        "icon": "🎯",
        "description": "Turn on humidifier when VPD exceeds threshold (plants stressed)",
        "sensor_type": "vpd",
        "actuator_type": "humidifier",
        "trigger_type": "numeric_state",
        "above": 1.4,
        "below": None,
        "requires": ["temperature", "humidity"],  # VPD needs both
    },
    "low_vpd_dehumidifier": {
        "name": "Low VPD → Dehumidifier",
        "icon": "🎯",
        "description": "Turn on dehumidifier when VPD drops too low (mold risk)",
        "sensor_type": "vpd",
        "actuator_type": "dehumidifier",
        "trigger_type": "numeric_state",
        "above": None,
        "below": 0.8,
        "requires": ["temperature", "humidity"],
    },
    "watering_schedule": {
        "name": "Watering Schedule",
        "icon": "🚿",
        "description": "Run water pump on a schedule",
        "sensor_type": None,
        "actuator_type": "water_pump",
        "trigger_type": "time",
        "time_on": "08:00:00",
        "time_off": "08:05:00",  # 5 min watering
    },
    "high_temp_ac": {
        "name": "High Temp → A/C",
        "icon": "❄️",
        "description": "Turn on A/C when temperature exceeds threshold",
        "sensor_type": "temperature",
        "actuator_type": "ac",
        "trigger_type": "numeric_state",
        "above": 28,
        "below": None,
    },
}


# Preset bundles - collections of templates for quick setup
PRESET_BUNDLES = {
    "veg_basic": {
        "name": "Veg Tent Basic",
        "icon": "🌱",
        "description": "Light schedule (18/6) + temp control + humidity control",
        "templates": ["light_schedule", "high_temp_exhaust", "low_humidity_humidifier"],
        "config_overrides": {
            "light_schedule": {"time_on": "06:00:00", "time_off": "00:00:00"},  # 18/6
        }
    },
    "flower_basic": {
        "name": "Flower Tent Basic",
        "icon": "🌸",
        "description": "Light schedule (12/12) + temp control + humidity control",
        "templates": ["light_schedule", "high_temp_exhaust", "high_humidity_dehumidifier"],
        "config_overrides": {
            "light_schedule": {"time_on": "06:00:00", "time_off": "18:00:00"},  # 12/12
            "high_humidity_dehumidifier": {"above": 55},  # Lower for flower
        }
    },
    "vpd_control": {
        "name": "VPD Control",
        "icon": "🎯",
        "description": "Maintain optimal VPD range with humidifier/dehumidifier",
        "templates": ["high_vpd_humidifier", "low_vpd_dehumidifier"],
        "config_overrides": {}
    },
    "full_climate": {
        "name": "Full Climate Control",
        "icon": "🌡️",
        "description": "Complete temp + humidity + circulation management",
        "templates": ["high_temp_exhaust", "low_temp_heater", "high_humidity_dehumidifier",
                     "low_humidity_humidifier", "circulation_fan_with_lights"],
        "config_overrides": {}
    },
}


def get_tent_entity_ids(tent) -> set[str]:
    """Get all entity IDs configured for a tent.

    Works with both TentState objects (tent.config.sensors) and TentConfig objects (tent.sensors).
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


def automation_references_entities(automation: dict, entity_ids: set[str], config: dict = None) -> bool:
    """Check if an automation references any of the given entities.

    Matches by exact entity_id in the automation config or automation entity_id/name.
    Also matches tentos_ prefixed automations.
    """
    auto_id = automation.get("entity_id", "")

    # TentOS-created automations always belong to tent
    if "tentos_" in auto_id:
        return True

    # Check automation config for exact entity references
    if config:
        config_str = str(config).lower()
        for entity_id in entity_ids:
            if entity_id.lower() in config_str:
                return True

    return False


async def get_automation_configs(ha_client, automations: list) -> dict:
    """Fetch configs for automations to check entity references."""
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
                pass
    return configs


# ==================== Templates ====================

@router.get("/templates")
async def list_templates(request: Request):
    """List available automation templates."""
    state_manager = request.app.state.state_manager
    tents = list(state_manager.tents.values())  # Get TentState objects directly

    # For each template, check which tents have the required entities
    templates_with_availability = []
    for template_id, template in AUTOMATION_TEMPLATES.items():
        available_tents = []
        for tent in tents:
            sensors = tent.config.sensors or {}
            actuators = tent.config.actuators or {}

            # Check if tent has required sensor
            has_sensor = True
            if template.get("sensor_type"):
                sensor_val = sensors.get(template["sensor_type"])
                has_sensor = bool(sensor_val if not isinstance(sensor_val, list) else any(sensor_val))

            # Check if tent has required actuator
            actuator_val = actuators.get(template["actuator_type"])
            has_actuator = bool(actuator_val if not isinstance(actuator_val, list) else any(actuator_val))

            # For "with lights" template, check for light
            if template.get("trigger_entity_type") == "light":
                light_val = actuators.get("light")
                has_sensor = bool(light_val if not isinstance(light_val, list) else any(light_val))

            if has_sensor and has_actuator:
                available_tents.append({"id": tent.config.id, "name": tent.config.name})

        templates_with_availability.append({
            "id": template_id,
            **template,
            "available_tents": available_tents
        })

    return {"templates": templates_with_availability}


class TemplateApply(BaseModel):
    """Request to apply a template."""
    tent_id: str
    threshold: Optional[float] = None  # For numeric triggers
    time_on: Optional[str] = None  # For schedule triggers
    time_off: Optional[str] = None


@router.post("/templates/{template_id}/apply")
async def apply_template(template_id: str, data: TemplateApply, request: Request):
    """Create an HA automation from a template."""
    if template_id not in AUTOMATION_TEMPLATES:
        raise HTTPException(status_code=404, detail="Template not found")

    template = AUTOMATION_TEMPLATES[template_id]
    ha_client = request.app.state.ha_client
    state_manager = request.app.state.state_manager

    tent = state_manager.get_tent(data.tent_id)
    if not tent:
        raise HTTPException(status_code=404, detail="Tent not found")

    sensors = tent.config.sensors or {}
    actuators = tent.config.actuators or {}

    # Get the actual entity IDs
    def get_entity(mapping, key):
        val = mapping.get(key)
        if isinstance(val, list):
            return val[0] if val else None
        return val

    actuator_entity = get_entity(actuators, template["actuator_type"])
    if not actuator_entity:
        raise HTTPException(status_code=400, detail=f"Tent has no {template['actuator_type']} configured")

    # Build the automation config
    auto_id = f"tentos_{tent.id}_{template_id}_{int(time.time())}"
    alias = f"[TentOS] {tent.name} - {template['name']}"

    if template["trigger_type"] == "numeric_state":
        sensor_entity = get_entity(sensors, template["sensor_type"])
        if not sensor_entity:
            raise HTTPException(status_code=400, detail=f"Tent has no {template['sensor_type']} sensor configured")

        threshold = data.threshold or template.get("above") or template.get("below")

        trigger = {
            "platform": "numeric_state",
            "entity_id": sensor_entity,
        }
        if template.get("above"):
            trigger["above"] = data.threshold or template["above"]
            action_service = "turn_on"
        else:
            trigger["below"] = data.threshold or template["below"]
            action_service = "turn_on"

        # Add a second trigger to turn off (with hysteresis)
        off_trigger = {
            "platform": "numeric_state",
            "entity_id": sensor_entity,
        }
        hysteresis = 2 if template["sensor_type"] == "temperature" else 5
        if template.get("above"):
            off_trigger["below"] = trigger["above"] - hysteresis
        else:
            off_trigger["above"] = trigger["below"] + hysteresis

        config = {
            "id": auto_id,
            "alias": alias,
            "description": f"Created by TentOS: {template['description']}",
            "mode": "single",
            "trigger": [
                {**trigger, "id": "on"},
                {**off_trigger, "id": "off"}
            ],
            "action": [
                {
                    "choose": [
                        {
                            "conditions": [{"condition": "trigger", "id": "on"}],
                            "sequence": [{"service": f"homeassistant.turn_on", "target": {"entity_id": actuator_entity}}]
                        },
                        {
                            "conditions": [{"condition": "trigger", "id": "off"}],
                            "sequence": [{"service": f"homeassistant.turn_off", "target": {"entity_id": actuator_entity}}]
                        }
                    ]
                }
            ]
        }

    elif template["trigger_type"] == "time":
        time_on = data.time_on or template.get("time_on", "06:00:00")
        time_off = data.time_off or template.get("time_off", "00:00:00")

        config = {
            "id": auto_id,
            "alias": alias,
            "description": f"Created by TentOS: {template['description']}",
            "mode": "single",
            "trigger": [
                {"platform": "time", "at": time_on, "id": "on"},
                {"platform": "time", "at": time_off, "id": "off"}
            ],
            "action": [
                {
                    "choose": [
                        {
                            "conditions": [{"condition": "trigger", "id": "on"}],
                            "sequence": [{"service": "homeassistant.turn_on", "target": {"entity_id": actuator_entity}}]
                        },
                        {
                            "conditions": [{"condition": "trigger", "id": "off"}],
                            "sequence": [{"service": "homeassistant.turn_off", "target": {"entity_id": actuator_entity}}]
                        }
                    ]
                }
            ]
        }

    elif template["trigger_type"] == "state":
        # For "with lights" type - follow another entity's state
        trigger_entity = get_entity(actuators, template["trigger_entity_type"])
        if not trigger_entity:
            raise HTTPException(status_code=400, detail=f"Tent has no {template['trigger_entity_type']} configured")

        config = {
            "id": auto_id,
            "alias": alias,
            "description": f"Created by TentOS: {template['description']}",
            "mode": "single",
            "trigger": [
                {"platform": "state", "entity_id": trigger_entity, "to": "on", "id": "on"},
                {"platform": "state", "entity_id": trigger_entity, "to": "off", "id": "off"}
            ],
            "action": [
                {
                    "choose": [
                        {
                            "conditions": [{"condition": "trigger", "id": "on"}],
                            "sequence": [{"service": "homeassistant.turn_on", "target": {"entity_id": actuator_entity}}]
                        },
                        {
                            "conditions": [{"condition": "trigger", "id": "off"}],
                            "sequence": [{"service": "homeassistant.turn_off", "target": {"entity_id": actuator_entity}}]
                        }
                    ]
                }
            ]
        }
    else:
        raise HTTPException(status_code=400, detail="Unknown trigger type")

    try:
        result = await ha_client.create_automation(config)
        return {
            "success": True,
            "automation_id": auto_id,
            "entity_id": f"automation.{auto_id}",
            "alias": alias
        }
    except Exception as e:
        logger.error(f"Failed to create automation: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== Bundles ====================

@router.get("/bundles")
async def list_bundles(request: Request):
    """List available automation bundles."""
    state_manager = request.app.state.state_manager
    tents = list(state_manager.tents.values())  # Get TentState objects directly

    bundles_with_availability = []
    for bundle_id, bundle in PRESET_BUNDLES.items():
        available_tents = []
        for tent in tents:
            # Check if tent has all required entities for all templates in bundle
            can_apply = True
            for template_id in bundle["templates"]:
                template = AUTOMATION_TEMPLATES.get(template_id)
                if not template:
                    continue

                sensors = tent.config.sensors or {}
                actuators = tent.config.actuators or {}

                # Check sensor
                if template.get("sensor_type"):
                    if template["sensor_type"] == "vpd":
                        # VPD needs both temp and humidity
                        has_temp = bool(sensors.get("temperature"))
                        has_humid = bool(sensors.get("humidity"))
                        if not (has_temp and has_humid):
                            can_apply = False
                            break
                    else:
                        sensor_val = sensors.get(template["sensor_type"])
                        if not bool(sensor_val if not isinstance(sensor_val, list) else any(sensor_val)):
                            can_apply = False
                            break

                # Check actuator
                actuator_val = actuators.get(template["actuator_type"])
                if not bool(actuator_val if not isinstance(actuator_val, list) else any(actuator_val)):
                    can_apply = False
                    break

            if can_apply:
                available_tents.append({"id": tent.config.id, "name": tent.config.name})

        bundles_with_availability.append({
            "id": bundle_id,
            **bundle,
            "available_tents": available_tents
        })

    return {"bundles": bundles_with_availability}


class BundleApply(BaseModel):
    """Request to apply a bundle."""
    tent_id: str


@router.post("/bundles/{bundle_id}/apply")
async def apply_bundle(bundle_id: str, data: BundleApply, request: Request):
    """Apply a bundle of automations to a tent."""
    if bundle_id not in PRESET_BUNDLES:
        raise HTTPException(status_code=404, detail="Bundle not found")

    bundle = PRESET_BUNDLES[bundle_id]
    results = []
    errors = []

    for template_id in bundle["templates"]:
        try:
            # Get any config overrides
            overrides = bundle.get("config_overrides", {}).get(template_id, {})

            # Build apply data
            apply_data = TemplateApply(tent_id=data.tent_id)
            if "above" in overrides or "below" in overrides:
                apply_data.threshold = overrides.get("above") or overrides.get("below")
            if "time_on" in overrides:
                apply_data.time_on = overrides["time_on"]
            if "time_off" in overrides:
                apply_data.time_off = overrides["time_off"]

            result = await apply_template(template_id, apply_data, request)
            results.append(result)
        except Exception as e:
            errors.append({"template": template_id, "error": str(e)})

    return {
        "success": len(errors) == 0,
        "created": results,
        "errors": errors,
        "bundle": bundle["name"]
    }


# ==================== Suggestions & Conflicts ====================

@router.get("/suggestions")
async def get_suggestions(request: Request):
    """Get automation suggestions based on tent configs vs existing automations."""
    ha_client = request.app.state.ha_client
    state_manager = request.app.state.state_manager

    tents = list(state_manager.tents.values())  # Get TentState objects directly
    all_automations = await ha_client.get_automations()
    configs = await get_automation_configs(ha_client, all_automations)

    suggestions = []

    for tent in tents:
        tent_entities = get_tent_entity_ids(tent)
        sensors = tent.config.sensors or {}
        actuators = tent.config.actuators or {}

        # Find automations that reference this tent's entities
        tent_automations = []
        for auto in all_automations:
            config = configs.get(auto.get("entity_id"))
            if automation_references_entities(auto, tent_entities, config):
                tent_automations.append(auto)

        # Check each template to see if it's missing
        for template_id, template in AUTOMATION_TEMPLATES.items():
            # Check if tent has required entities
            has_sensor = True
            if template.get("sensor_type"):
                if template["sensor_type"] == "vpd":
                    has_sensor = bool(sensors.get("temperature")) and bool(sensors.get("humidity"))
                else:
                    sensor_val = sensors.get(template["sensor_type"])
                    has_sensor = bool(sensor_val if not isinstance(sensor_val, list) else any(sensor_val))

            actuator_val = actuators.get(template["actuator_type"])
            has_actuator = bool(actuator_val if not isinstance(actuator_val, list) else any(actuator_val))

            if not has_sensor or not has_actuator:
                continue  # Tent can't use this template

            # Check if an automation already exists for this scenario
            already_exists = False
            for auto in tent_automations:
                auto_name = (auto.get("entity_id", "") + auto.get("attributes", {}).get("friendly_name", "")).lower()
                # Check for TentOS-created automation
                if f"tentos_{tent.config.id}_{template_id}" in auto_name:
                    already_exists = True
                    break
                # Check for keywords that suggest this automation exists
                template_keywords = [template["actuator_type"].replace("_", "")]
                if template.get("sensor_type"):
                    template_keywords.append(template["sensor_type"])
                if all(kw in auto_name for kw in template_keywords):
                    already_exists = True
                    break

            if not already_exists:
                suggestions.append({
                    "tent_id": tent.config.id,
                    "tent_name": tent.config.name,
                    "template_id": template_id,
                    "template": template,
                    "reason": f"You have {template.get('sensor_type') or 'the trigger'} and {template['actuator_type'].replace('_', ' ')} but no automation connecting them"
                })

    return {"suggestions": suggestions, "count": len(suggestions)}


@router.get("/conflicts")
async def detect_conflicts(request: Request):
    """Detect potentially conflicting automations."""
    ha_client = request.app.state.ha_client
    state_manager = request.app.state.state_manager

    all_automations = await ha_client.get_automations()
    configs = await get_automation_configs(ha_client, all_automations)

    conflicts = []

    # Build a list of automations with their triggers and actions
    parsed_automations = []
    for auto in all_automations:
        config = configs.get(auto.get("entity_id"))
        if not config:
            continue

        triggers = config.get("trigger", [])
        if not isinstance(triggers, list):
            triggers = [triggers]

        actions = config.get("action", [])

        # Extract target entities from actions
        target_entities = set()
        for action in actions:
            if isinstance(action, dict):
                target = action.get("target", {})
                if isinstance(target, dict):
                    entity = target.get("entity_id")
                    if entity:
                        if isinstance(entity, list):
                            target_entities.update(entity)
                        else:
                            target_entities.add(entity)
                # Check in choose blocks
                for choice in action.get("choose", []):
                    for seq in choice.get("sequence", []):
                        if isinstance(seq, dict):
                            target = seq.get("target", {})
                            if isinstance(target, dict):
                                entity = target.get("entity_id")
                                if entity:
                                    target_entities.add(entity)

        # Extract trigger thresholds
        trigger_thresholds = []
        for trigger in triggers:
            platform = trigger.get("platform")
            entity = trigger.get("entity_id")
            above = trigger.get("above")
            below = trigger.get("below")
            if platform == "numeric_state" and entity:
                trigger_thresholds.append({
                    "entity": entity,
                    "above": above,
                    "below": below
                })

        parsed_automations.append({
            "automation": auto,
            "targets": target_entities,
            "triggers": trigger_thresholds
        })

    # Check for conflicts
    for i, auto1 in enumerate(parsed_automations):
        for auto2 in parsed_automations[i+1:]:
            # Check if they control the same entity
            shared_targets = auto1["targets"] & auto2["targets"]
            if not shared_targets:
                continue

            # Check for threshold conflicts
            for t1 in auto1["triggers"]:
                for t2 in auto2["triggers"]:
                    if t1["entity"] == t2["entity"]:
                        # Check for overlapping ranges
                        # e.g., one triggers above 60, another triggers below 65
                        if t1.get("above") and t2.get("below"):
                            if t1["above"] < t2["below"]:
                                conflicts.append({
                                    "type": "threshold_overlap",
                                    "automation1": auto1["automation"]["entity_id"],
                                    "automation2": auto2["automation"]["entity_id"],
                                    "shared_targets": list(shared_targets),
                                    "detail": f"Both trigger on {t1['entity']}: one above {t1['above']}, one below {t2['below']} - may oscillate",
                                    "severity": "warning"
                                })
                        if t2.get("above") and t1.get("below"):
                            if t2["above"] < t1["below"]:
                                conflicts.append({
                                    "type": "threshold_overlap",
                                    "automation1": auto1["automation"]["entity_id"],
                                    "automation2": auto2["automation"]["entity_id"],
                                    "shared_targets": list(shared_targets),
                                    "detail": f"Both trigger on {t1['entity']}: one above {t2['above']}, one below {t1['below']} - may oscillate",
                                    "severity": "warning"
                                })

    return {"conflicts": conflicts, "count": len(conflicts)}


# ==================== Missing Entity Suggestions ====================

# Define what entities enable which templates
ENTITY_AUTOMATION_MAP = {
    "sensors": {
        "temperature": {
            "label": "Temperature Sensor",
            "icon": "🌡️",
            "enables": ["high_temp_exhaust", "low_temp_heater", "high_vpd_humidifier", "low_vpd_dehumidifier"],
            "description": "Enable temperature-based automations"
        },
        "humidity": {
            "label": "Humidity Sensor",
            "icon": "💧",
            "enables": ["high_humidity_dehumidifier", "low_humidity_humidifier", "high_vpd_humidifier", "low_vpd_dehumidifier"],
            "description": "Enable humidity-based automations"
        },
        "co2": {
            "label": "CO2 Sensor",
            "icon": "🫧",
            "enables": [],
            "description": "Monitor CO2 levels (coming soon: CO2 automations)"
        },
    },
    "actuators": {
        "light": {
            "label": "Grow Light",
            "icon": "💡",
            "enables": ["light_schedule", "circulation_fan_with_lights"],
            "description": "Enable light scheduling and light-triggered automations"
        },
        "exhaust_fan": {
            "label": "Exhaust Fan",
            "icon": "🌀",
            "enables": ["high_temp_exhaust"],
            "description": "Cool your tent when temperature rises"
        },
        "circulation_fan": {
            "label": "Circulation Fan",
            "icon": "🔄",
            "enables": ["circulation_fan_with_lights"],
            "description": "Run with lights for air movement"
        },
        "humidifier": {
            "label": "Humidifier",
            "icon": "💨",
            "enables": ["low_humidity_humidifier", "high_vpd_humidifier"],
            "description": "Increase humidity when too low"
        },
        "dehumidifier": {
            "label": "Dehumidifier",
            "icon": "🏜️",
            "enables": ["high_humidity_dehumidifier", "low_vpd_dehumidifier"],
            "description": "Reduce humidity when too high"
        },
        "heater": {
            "label": "Heater",
            "icon": "🔥",
            "enables": ["low_temp_heater"],
            "description": "Heat your tent when temperature drops"
        },
        "water_pump": {
            "label": "Water Pump",
            "icon": "🚿",
            "enables": ["watering_schedule"],
            "description": "Automate watering on a schedule"
        },
    }
}


@router.get("/entity-suggestions")
async def get_entity_suggestions(request: Request):
    """Get suggestions for entities that could be added to enable more automations."""
    state_manager = request.app.state.state_manager
    tents = list(state_manager.tents.values())

    all_suggestions = []

    for tent in tents:
        sensors = tent.config.sensors or {}
        actuators = tent.config.actuators or {}
        tent_suggestions = []

        # Check sensors
        for sensor_type, info in ENTITY_AUTOMATION_MAP["sensors"].items():
            sensor_val = sensors.get(sensor_type)
            has_sensor = bool(sensor_val if not isinstance(sensor_val, list) else any(sensor_val))

            if not has_sensor and info["enables"]:
                # Find which templates would be enabled
                enabled_templates = []
                for template_id in info["enables"]:
                    template = AUTOMATION_TEMPLATES.get(template_id)
                    if template:
                        # Check if tent has the OTHER required entities for this template
                        would_work = True
                        if template.get("actuator_type"):
                            actuator_val = actuators.get(template["actuator_type"])
                            if not bool(actuator_val if not isinstance(actuator_val, list) else any(actuator_val)):
                                would_work = False
                        if would_work:
                            enabled_templates.append({
                                "id": template_id,
                                "name": template["name"],
                                "icon": template["icon"]
                            })

                if enabled_templates:
                    tent_suggestions.append({
                        "type": "sensor",
                        "slot": sensor_type,
                        "label": info["label"],
                        "icon": info["icon"],
                        "description": info["description"],
                        "enables_count": len(enabled_templates),
                        "enables": enabled_templates
                    })

        # Check actuators
        for actuator_type, info in ENTITY_AUTOMATION_MAP["actuators"].items():
            actuator_val = actuators.get(actuator_type)
            has_actuator = bool(actuator_val if not isinstance(actuator_val, list) else any(actuator_val))

            if not has_actuator and info["enables"]:
                # Find which templates would be enabled
                enabled_templates = []
                for template_id in info["enables"]:
                    template = AUTOMATION_TEMPLATES.get(template_id)
                    if template:
                        # Check if tent has the required sensor for this template
                        would_work = True
                        if template.get("sensor_type"):
                            if template["sensor_type"] == "vpd":
                                would_work = bool(sensors.get("temperature")) and bool(sensors.get("humidity"))
                            else:
                                sensor_val = sensors.get(template["sensor_type"])
                                would_work = bool(sensor_val if not isinstance(sensor_val, list) else any(sensor_val))
                        # For "with lights" type, check if tent has lights
                        if template.get("trigger_entity_type") == "light":
                            light_val = actuators.get("light")
                            would_work = bool(light_val if not isinstance(light_val, list) else any(light_val))

                        if would_work:
                            enabled_templates.append({
                                "id": template_id,
                                "name": template["name"],
                                "icon": template["icon"]
                            })

                if enabled_templates:
                    tent_suggestions.append({
                        "type": "actuator",
                        "slot": actuator_type,
                        "label": info["label"],
                        "icon": info["icon"],
                        "description": info["description"],
                        "enables_count": len(enabled_templates),
                        "enables": enabled_templates
                    })

        if tent_suggestions:
            # Sort by number of automations enabled (most valuable first)
            tent_suggestions.sort(key=lambda x: -x["enables_count"])
            all_suggestions.append({
                "tent_id": tent.config.id,
                "tent_name": tent.config.name,
                "suggestions": tent_suggestions
            })

    return {"suggestions": all_suggestions}


# ==================== Bulk Operations ====================

class BulkOperation(BaseModel):
    """Request for bulk automation operations."""
    entity_ids: list[str]


@router.post("/bulk/enable")
async def bulk_enable(data: BulkOperation, request: Request):
    """Enable multiple automations at once."""
    ha_client = request.app.state.ha_client
    results = []
    errors = []

    for entity_id in data.entity_ids:
        try:
            if not entity_id.startswith("automation."):
                entity_id = f"automation.{entity_id}"
            await ha_client.call_service(
                "automation", "turn_on",
                target={"entity_id": entity_id}
            )
            results.append(entity_id)
        except Exception as e:
            errors.append({"entity_id": entity_id, "error": str(e)})

    return {"success": len(errors) == 0, "enabled": results, "errors": errors}


@router.post("/bulk/disable")
async def bulk_disable(data: BulkOperation, request: Request):
    """Disable multiple automations at once."""
    ha_client = request.app.state.ha_client
    results = []
    errors = []

    for entity_id in data.entity_ids:
        try:
            if not entity_id.startswith("automation."):
                entity_id = f"automation.{entity_id}"
            await ha_client.call_service(
                "automation", "turn_off",
                target={"entity_id": entity_id}
            )
            results.append(entity_id)
        except Exception as e:
            errors.append({"entity_id": entity_id, "error": str(e)})

    return {"success": len(errors) == 0, "disabled": results, "errors": errors}


@router.post("/bulk/trigger")
async def bulk_trigger(data: BulkOperation, request: Request):
    """Trigger multiple automations at once."""
    ha_client = request.app.state.ha_client
    results = []
    errors = []

    for entity_id in data.entity_ids:
        try:
            if not entity_id.startswith("automation."):
                entity_id = f"automation.{entity_id}"
            await ha_client.call_service(
                "automation", "trigger",
                target={"entity_id": entity_id}
            )
            results.append(entity_id)
        except Exception as e:
            errors.append({"entity_id": entity_id, "error": str(e)})

    return {"success": len(errors) == 0, "triggered": results, "errors": errors}


# ==================== History ====================

@router.get("/history")
async def get_history(request: Request, hours: int = 24, entity_id: Optional[str] = None):
    """Get automation trigger history from Home Assistant."""
    ha_client = request.app.state.ha_client

    try:
        # Get automation states which include last_triggered
        automations = await ha_client.get_automations()

        history = []
        for auto in automations:
            if entity_id and auto.get("entity_id") != entity_id:
                continue

            last_triggered = auto.get("attributes", {}).get("last_triggered")
            if last_triggered:
                history.append({
                    "entity_id": auto.get("entity_id"),
                    "friendly_name": auto.get("attributes", {}).get("friendly_name"),
                    "last_triggered": last_triggered,
                    "state": auto.get("state")
                })

        # Sort by last_triggered, most recent first
        history.sort(key=lambda x: x["last_triggered"] or "", reverse=True)

        return {"history": history, "count": len(history)}

    except Exception as e:
        logger.error(f"Failed to get automation history: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== HA Automations ====================

@router.get("/categories")
async def list_categories():
    """List available automation categories."""
    return {
        "categories": [
            {"id": k, **{key: v[key] for key in ["name", "icon", "order"]}}
            for k, v in sorted(CATEGORIES.items(), key=lambda x: x[1]["order"])
        ]
    }


@router.get("")
async def list_ha_automations(
    request: Request,
    tent_id: Optional[str] = None,
    show_all: bool = True,
    categorize: bool = True
):
    """List Home Assistant automations with optional categorization."""
    ha_client = request.app.state.ha_client
    state_manager = request.app.state.state_manager

    try:
        all_automations = await ha_client.get_automations()
    except Exception as e:
        logger.error(f"Failed to fetch HA automations: {e}")
        raise HTTPException(status_code=503, detail=f"Failed to fetch automations: {str(e)}")

    # Fetch configs for categorization
    configs = {}
    if categorize:
        try:
            configs = await get_automation_configs(ha_client, all_automations)
        except Exception as e:
            logger.warning(f"Could not fetch automation configs for categorization: {e}")

    # Add category and tags to each automation
    for auto in all_automations:
        config = configs.get(auto.get("entity_id"))
        auto["category"] = categorize_automation(auto, config)
        auto["tags"] = get_automation_tags(auto, config)

    # Filter by tent if requested
    if tent_id and not show_all:
        tent = state_manager.get_tent(tent_id)
        if not tent:
            raise HTTPException(status_code=404, detail="Tent not found")

        entity_ids = get_tent_entity_ids(tent)
        filtered = []
        for a in all_automations:
            config = configs.get(a.get("entity_id"))
            if automation_references_entities(a, entity_ids, config):
                filtered.append(a)

        all_automations = filtered

    # Group by category
    by_category = {}
    for auto in all_automations:
        cat = auto.get("category", "other")
        if cat not in by_category:
            by_category[cat] = []
        by_category[cat].append(auto)

    # Sort categories by order
    sorted_categories = sorted(
        by_category.items(),
        key=lambda x: CATEGORIES.get(x[0], {}).get("order", 99)
    )

    return {
        "automations": all_automations,
        "by_category": dict(sorted_categories),
        "categories": {k: {"name": v["name"], "icon": v["icon"]} for k, v in CATEGORIES.items()},
        "tags": {k: {"name": v["name"], "icon": v["icon"], "color": v["color"]} for k, v in TAGS.items()},
        "count": len(all_automations)
    }


@router.get("/{entity_id:path}/config")
async def get_automation_config(entity_id: str, request: Request):
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


@router.post("/{entity_id:path}/trigger")
async def trigger_automation(entity_id: str, request: Request):
    """Manually trigger a Home Assistant automation."""
    ha_client = request.app.state.ha_client

    if not entity_id.startswith("automation."):
        entity_id = f"automation.{entity_id}"

    try:
        result = await ha_client.call_service(
            "automation", "trigger",
            target={"entity_id": entity_id}
        )
        return {"success": True, "result": result}
    except Exception as e:
        logger.error(f"Failed to trigger automation {entity_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{entity_id:path}/toggle")
async def toggle_automation(entity_id: str, request: Request):
    """Enable/disable a Home Assistant automation."""
    ha_client = request.app.state.ha_client

    if not entity_id.startswith("automation."):
        entity_id = f"automation.{entity_id}"

    try:
        result = await ha_client.call_service(
            "automation", "toggle",
            target={"entity_id": entity_id}
        )
        return {"success": True, "result": result}
    except Exception as e:
        logger.error(f"Failed to toggle automation {entity_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{entity_id:path}")
async def delete_automation(entity_id: str, request: Request):
    """Delete a Home Assistant automation."""
    ha_client = request.app.state.ha_client
    auto_id = entity_id.replace("automation.", "")

    try:
        result = await ha_client.delete_automation(auto_id)
        return {"success": True, "result": result}
    except Exception as e:
        logger.error(f"Failed to delete automation {entity_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class HAAutomationCreate(BaseModel):
    """Request model for creating an HA automation."""
    alias: str
    description: Optional[str] = ""
    mode: str = "single"
    triggers: list
    conditions: Optional[list] = []
    actions: list


@router.post("/create")
async def create_automation(automation: HAAutomationCreate, request: Request):
    """Create a new Home Assistant automation (advanced)."""
    ha_client = request.app.state.ha_client

    try:
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
        result = await ha_client.create_automation(config)
        return {"success": True, "automation_id": auto_id, "result": result}
    except Exception as e:
        logger.error(f"Failed to create automation: {e}")
        raise HTTPException(status_code=500, detail=str(e))
