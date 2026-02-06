"""Home Assistant Automation API routes."""
import logging
import time
from typing import Optional
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()


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
}


def get_tent_entity_ids(tent) -> set[str]:
    """Get all entity IDs configured for a tent."""
    entity_ids = set()
    for sensor_type, val in (tent.config.sensors or {}).items():
        if isinstance(val, list):
            entity_ids.update(e for e in val if e)
        elif val:
            entity_ids.add(val)
    for actuator_type, val in (tent.config.actuators or {}).items():
        if isinstance(val, list):
            entity_ids.update(e for e in val if e)
        elif val:
            entity_ids.add(val)
    return entity_ids


def automation_references_entities(automation: dict, entity_ids: set[str], config: dict = None) -> bool:
    """Check if an automation references any of the given entities."""
    if config:
        config_str = str(config).lower()
        for entity_id in entity_ids:
            if entity_id.lower() in config_str:
                return True

    auto_id = automation.get("entity_id", "")
    auto_name = automation.get("attributes", {}).get("friendly_name", "")
    search_text = f"{auto_id} {auto_name}".lower()

    for entity_id in entity_ids:
        if entity_id.lower() in search_text:
            return True
        parts = entity_id.replace(".", "_").split("_")
        meaningful_parts = [p for p in parts if len(p) > 2 and p not in ("sensor", "switch", "fan", "light", "binary")]
        for part in meaningful_parts:
            if part.lower() in search_text:
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
    tents = state_manager.get_all_tents()

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
                available_tents.append({"id": tent.id, "name": tent.name})

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


# ==================== HA Automations ====================

@router.get("")
async def list_ha_automations(
    request: Request,
    tent_id: Optional[str] = None,
    show_all: bool = True
):
    """List Home Assistant automations."""
    ha_client = request.app.state.ha_client
    state_manager = request.app.state.state_manager

    try:
        all_automations = await ha_client.get_automations()
    except Exception as e:
        logger.error(f"Failed to fetch HA automations: {e}")
        raise HTTPException(status_code=503, detail=f"Failed to fetch automations: {str(e)}")

    if not tent_id or show_all:
        return {
            "automations": all_automations,
            "count": len(all_automations),
            "filtered": False
        }

    tent = state_manager.get_tent(tent_id)
    if not tent:
        raise HTTPException(status_code=404, detail="Tent not found")

    entity_ids = get_tent_entity_ids(tent)

    try:
        configs = await get_automation_configs(ha_client, all_automations)
    except Exception as e:
        logger.warning(f"Could not fetch automation configs: {e}")
        configs = {}

    related = []
    for a in all_automations:
        config = configs.get(a.get("entity_id"))
        if automation_references_entities(a, entity_ids, config):
            related.append(a)

    if not related:
        return {
            "automations": all_automations,
            "count": len(all_automations),
            "filtered": False,
            "no_matches": True
        }

    return {
        "automations": related,
        "count": len(related),
        "filtered": True,
        "tent_id": tent_id
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
