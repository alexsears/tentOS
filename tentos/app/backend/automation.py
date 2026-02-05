"""Automation rules engine for tent control."""
import asyncio
import json
import logging
from datetime import datetime, timezone, timedelta
from enum import Enum
from pathlib import Path
from typing import Any, Optional
from pydantic import BaseModel

logger = logging.getLogger(__name__)

RULES_PATH = Path("/data/automation_rules.json")


class TriggerType(str, Enum):
    SENSOR_ABOVE = "sensor_above"
    SENSOR_BELOW = "sensor_below"
    SENSOR_RANGE = "sensor_range"
    SCHEDULE = "schedule"


class ActionType(str, Enum):
    TURN_ON = "turn_on"
    TURN_OFF = "turn_off"
    SET_SPEED = "set_speed"


class AutomationRule(BaseModel):
    """A single automation rule."""
    id: str
    name: str
    enabled: bool = True
    tent_id: str

    # Trigger
    trigger_type: TriggerType
    trigger_sensor: Optional[str] = None  # temperature, humidity, vpd, co2
    trigger_value: Optional[float] = None
    trigger_value_max: Optional[float] = None  # For range triggers
    trigger_schedule_on: Optional[str] = None  # HH:MM
    trigger_schedule_off: Optional[str] = None

    # Action
    action_type: ActionType
    action_actuator: str  # light, exhaust_fan, etc.
    action_value: Optional[int] = None  # For set_speed

    # Safety
    hysteresis: float = 0.5  # Prevent rapid toggling
    min_on_duration: int = 60  # Minimum seconds to stay on
    min_off_duration: int = 60  # Minimum seconds to stay off
    cooldown: int = 30  # Seconds between actions


class RuleState:
    """Runtime state for a rule."""
    def __init__(self):
        self.last_triggered: Optional[datetime] = None
        self.last_action: Optional[str] = None
        self.last_action_time: Optional[datetime] = None
        self.triggered = False


class AutomationEngine:
    """Engine to evaluate and execute automation rules."""

    def __init__(self, ha_client):
        self.ha_client = ha_client
        self.rules: dict[str, AutomationRule] = {}
        self.rule_states: dict[str, RuleState] = {}
        self._running = False
        self._schedule_task: Optional[asyncio.Task] = None

    def load_rules(self):
        """Load rules from file."""
        if RULES_PATH.exists():
            try:
                with open(RULES_PATH) as f:
                    data = json.load(f)
                    for rule_data in data.get("rules", []):
                        rule = AutomationRule(**rule_data)
                        self.rules[rule.id] = rule
                        self.rule_states[rule.id] = RuleState()
                logger.info(f"Loaded {len(self.rules)} automation rules")
            except Exception as e:
                logger.error(f"Failed to load rules: {e}")

    def save_rules(self):
        """Save rules to file."""
        try:
            data = {"rules": [r.model_dump() for r in self.rules.values()]}
            RULES_PATH.parent.mkdir(parents=True, exist_ok=True)
            with open(RULES_PATH, "w") as f:
                json.dump(data, f, indent=2)
            logger.info("Saved automation rules")
        except Exception as e:
            logger.error(f"Failed to save rules: {e}")

    def add_rule(self, rule: AutomationRule):
        """Add or update a rule."""
        self.rules[rule.id] = rule
        if rule.id not in self.rule_states:
            self.rule_states[rule.id] = RuleState()
        self.save_rules()

    def remove_rule(self, rule_id: str):
        """Remove a rule."""
        if rule_id in self.rules:
            del self.rules[rule_id]
            self.rule_states.pop(rule_id, None)
            self.save_rules()

    def get_rules_for_tent(self, tent_id: str) -> list[AutomationRule]:
        """Get all rules for a tent."""
        return [r for r in self.rules.values() if r.tent_id == tent_id]

    async def start(self):
        """Start the automation engine."""
        self._running = True
        self.load_rules()
        self._schedule_task = asyncio.create_task(self._schedule_loop())
        logger.info("Automation engine started")

    async def stop(self):
        """Stop the automation engine."""
        self._running = False
        if self._schedule_task:
            self._schedule_task.cancel()

    async def _schedule_loop(self):
        """Check schedule-based rules periodically."""
        while self._running:
            try:
                await self._check_schedules()
                await asyncio.sleep(60)  # Check every minute
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Schedule loop error: {e}")
                await asyncio.sleep(60)

    async def _check_schedules(self):
        """Check schedule-based rules."""
        now = datetime.now()
        current_time = now.strftime("%H:%M")

        for rule_id, rule in self.rules.items():
            if not rule.enabled or rule.trigger_type != TriggerType.SCHEDULE:
                continue

            state = self.rule_states[rule_id]

            # Check if it's time to turn on
            if rule.trigger_schedule_on == current_time:
                if state.last_action != "on":
                    await self._execute_action(rule, "on")

            # Check if it's time to turn off
            elif rule.trigger_schedule_off == current_time:
                if state.last_action != "off":
                    await self._execute_action(rule, "off")

    async def evaluate_sensor_rules(
        self,
        tent_id: str,
        sensor_type: str,
        value: float,
        tent_config: Any
    ):
        """Evaluate sensor-based rules when a sensor value changes."""
        for rule_id, rule in self.rules.items():
            if not rule.enabled:
                continue
            if rule.tent_id != tent_id:
                continue
            if rule.trigger_sensor != sensor_type:
                continue

            state = self.rule_states[rule_id]
            now = datetime.now(timezone.utc)

            # Check cooldown
            if state.last_action_time:
                elapsed = (now - state.last_action_time).total_seconds()
                if elapsed < rule.cooldown:
                    continue

            should_trigger = False
            action = None

            if rule.trigger_type == TriggerType.SENSOR_ABOVE:
                threshold = rule.trigger_value
                hysteresis = rule.hysteresis

                if value > threshold and not state.triggered:
                    should_trigger = True
                    action = "on" if rule.action_type == ActionType.TURN_ON else "off"
                    state.triggered = True
                elif value < (threshold - hysteresis) and state.triggered:
                    should_trigger = True
                    action = "off" if rule.action_type == ActionType.TURN_ON else "on"
                    state.triggered = False

            elif rule.trigger_type == TriggerType.SENSOR_BELOW:
                threshold = rule.trigger_value
                hysteresis = rule.hysteresis

                if value < threshold and not state.triggered:
                    should_trigger = True
                    action = "on" if rule.action_type == ActionType.TURN_ON else "off"
                    state.triggered = True
                elif value > (threshold + hysteresis) and state.triggered:
                    should_trigger = True
                    action = "off" if rule.action_type == ActionType.TURN_ON else "on"
                    state.triggered = False

            elif rule.trigger_type == TriggerType.SENSOR_RANGE:
                min_val = rule.trigger_value
                max_val = rule.trigger_value_max

                if value < min_val and not state.triggered:
                    # Below range - trigger action
                    should_trigger = True
                    action = "on" if rule.action_type == ActionType.TURN_ON else "off"
                    state.triggered = True
                elif value > max_val and not state.triggered:
                    # Above range - trigger action
                    should_trigger = True
                    action = "on" if rule.action_type == ActionType.TURN_ON else "off"
                    state.triggered = True
                elif min_val <= value <= max_val and state.triggered:
                    # Back in range - reverse action
                    should_trigger = True
                    action = "off" if rule.action_type == ActionType.TURN_ON else "on"
                    state.triggered = False

            if should_trigger and action:
                # Check min duration constraints
                if state.last_action_time and state.last_action:
                    elapsed = (now - state.last_action_time).total_seconds()
                    if state.last_action == "on" and elapsed < rule.min_on_duration:
                        continue
                    if state.last_action == "off" and elapsed < rule.min_off_duration:
                        continue

                await self._execute_action(rule, action, tent_config)

    async def _execute_action(
        self,
        rule: AutomationRule,
        action: str,
        tent_config: Any = None
    ):
        """Execute an automation action."""
        state = self.rule_states[rule.id]

        # Get entity ID from tent config
        entity_id = None
        if tent_config:
            entity_id = tent_config.actuators.get(rule.action_actuator)

        if not entity_id:
            logger.warning(f"No entity for actuator {rule.action_actuator} in rule {rule.id}")
            return

        try:
            if action == "on":
                if rule.action_type == ActionType.SET_SPEED and rule.action_value:
                    await self.ha_client.set_fan_speed(entity_id, rule.action_value)
                else:
                    await self.ha_client.turn_on(entity_id)
            else:
                await self.ha_client.turn_off(entity_id)

            state.last_action = action
            state.last_action_time = datetime.now(timezone.utc)
            state.last_triggered = datetime.now(timezone.utc)

            logger.info(f"Automation rule '{rule.name}' executed: {rule.action_actuator} -> {action}")

        except Exception as e:
            logger.error(f"Failed to execute rule '{rule.name}': {e}")

    def get_rule_status(self, rule_id: str) -> dict:
        """Get current status of a rule."""
        rule = self.rules.get(rule_id)
        state = self.rule_states.get(rule_id)

        if not rule or not state:
            return {}

        return {
            "rule_id": rule_id,
            "enabled": rule.enabled,
            "triggered": state.triggered,
            "last_action": state.last_action,
            "last_action_time": state.last_action_time.isoformat() if state.last_action_time else None,
            "last_triggered": state.last_triggered.isoformat() if state.last_triggered else None
        }
