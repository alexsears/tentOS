"""Automation rules API routes."""
import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from automation import AutomationRule, TriggerType, ActionType

logger = logging.getLogger(__name__)
router = APIRouter()


class RuleCreate(BaseModel):
    """Request model for creating a rule."""
    name: str
    enabled: bool = True
    tent_id: str
    trigger_type: TriggerType
    trigger_sensor: Optional[str] = None
    trigger_value: Optional[float] = None
    trigger_value_max: Optional[float] = None
    trigger_schedule_on: Optional[str] = None
    trigger_schedule_off: Optional[str] = None
    action_type: ActionType
    action_actuator: str
    action_value: Optional[int] = None
    hysteresis: float = 0.5
    min_on_duration: int = 60
    min_off_duration: int = 60
    cooldown: int = 30


@router.get("")
async def list_rules(request: Request, tent_id: Optional[str] = None):
    """List all automation rules."""
    engine = request.app.state.automation_engine
    if not engine:
        raise HTTPException(status_code=503, detail="Automation engine not available")

    if tent_id:
        rules = engine.get_rules_for_tent(tent_id)
    else:
        rules = list(engine.rules.values())

    return {
        "rules": [r.model_dump() for r in rules],
        "count": len(rules)
    }


@router.get("/{rule_id}")
async def get_rule(rule_id: str, request: Request):
    """Get a specific rule with its current status."""
    engine = request.app.state.automation_engine
    if not engine:
        raise HTTPException(status_code=503, detail="Automation engine not available")

    rule = engine.rules.get(rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")

    status = engine.get_rule_status(rule_id)
    return {
        "rule": rule.model_dump(),
        "status": status
    }


@router.post("")
async def create_rule(rule_data: RuleCreate, request: Request):
    """Create a new automation rule."""
    engine = request.app.state.automation_engine
    if not engine:
        raise HTTPException(status_code=503, detail="Automation engine not available")

    # Generate unique ID
    import time
    rule_id = f"rule_{int(time.time() * 1000)}"

    rule = AutomationRule(
        id=rule_id,
        **rule_data.model_dump()
    )

    engine.add_rule(rule)

    return {"success": True, "rule": rule.model_dump()}


@router.put("/{rule_id}")
async def update_rule(rule_id: str, rule_data: RuleCreate, request: Request):
    """Update an existing rule."""
    engine = request.app.state.automation_engine
    if not engine:
        raise HTTPException(status_code=503, detail="Automation engine not available")

    if rule_id not in engine.rules:
        raise HTTPException(status_code=404, detail="Rule not found")

    rule = AutomationRule(
        id=rule_id,
        **rule_data.model_dump()
    )

    engine.add_rule(rule)

    return {"success": True, "rule": rule.model_dump()}


@router.delete("/{rule_id}")
async def delete_rule(rule_id: str, request: Request):
    """Delete a rule."""
    engine = request.app.state.automation_engine
    if not engine:
        raise HTTPException(status_code=503, detail="Automation engine not available")

    if rule_id not in engine.rules:
        raise HTTPException(status_code=404, detail="Rule not found")

    engine.remove_rule(rule_id)

    return {"success": True, "message": "Rule deleted"}


@router.post("/{rule_id}/enable")
async def enable_rule(rule_id: str, request: Request):
    """Enable a rule."""
    engine = request.app.state.automation_engine
    if not engine:
        raise HTTPException(status_code=503, detail="Automation engine not available")

    rule = engine.rules.get(rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")

    rule.enabled = True
    engine.save_rules()

    return {"success": True, "enabled": True}


@router.post("/{rule_id}/disable")
async def disable_rule(rule_id: str, request: Request):
    """Disable a rule."""
    engine = request.app.state.automation_engine
    if not engine:
        raise HTTPException(status_code=503, detail="Automation engine not available")

    rule = engine.rules.get(rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")

    rule.enabled = False
    engine.save_rules()

    return {"success": True, "enabled": False}


# Preset templates for common automations
RULE_TEMPLATES = {
    "high_temp_exhaust": {
        "name": "High Temp - Turn On Exhaust",
        "trigger_type": "sensor_above",
        "trigger_sensor": "temperature",
        "trigger_value": 28,
        "action_type": "turn_on",
        "action_actuator": "exhaust_fan",
        "hysteresis": 1.0
    },
    "low_humidity_humidifier": {
        "name": "Low Humidity - Turn On Humidifier",
        "trigger_type": "sensor_below",
        "trigger_sensor": "humidity",
        "trigger_value": 50,
        "action_type": "turn_on",
        "action_actuator": "humidifier",
        "hysteresis": 5
    },
    "high_humidity_dehumidifier": {
        "name": "High Humidity - Turn On Dehumidifier",
        "trigger_type": "sensor_above",
        "trigger_sensor": "humidity",
        "trigger_value": 70,
        "action_type": "turn_on",
        "action_actuator": "dehumidifier",
        "hysteresis": 5
    },
    "high_vpd_humidifier": {
        "name": "High VPD - Turn On Humidifier",
        "trigger_type": "sensor_above",
        "trigger_sensor": "vpd",
        "trigger_value": 1.4,
        "action_type": "turn_on",
        "action_actuator": "humidifier",
        "hysteresis": 0.2
    },
    "light_schedule": {
        "name": "Light Schedule (18/6)",
        "trigger_type": "schedule",
        "trigger_schedule_on": "06:00",
        "trigger_schedule_off": "00:00",
        "action_type": "turn_on",
        "action_actuator": "light"
    }
}


@router.get("/templates/list")
async def list_templates():
    """List available rule templates."""
    return {"templates": RULE_TEMPLATES}


@router.post("/templates/{template_id}/apply")
async def apply_template(template_id: str, tent_id: str, request: Request):
    """Apply a template to create a new rule."""
    engine = request.app.state.automation_engine
    if not engine:
        raise HTTPException(status_code=503, detail="Automation engine not available")

    if template_id not in RULE_TEMPLATES:
        raise HTTPException(status_code=404, detail="Template not found")

    template = RULE_TEMPLATES[template_id]

    import time
    rule_id = f"rule_{int(time.time() * 1000)}"

    rule = AutomationRule(
        id=rule_id,
        tent_id=tent_id,
        enabled=True,
        **template
    )

    engine.add_rule(rule)

    return {"success": True, "rule": rule.model_dump()}
