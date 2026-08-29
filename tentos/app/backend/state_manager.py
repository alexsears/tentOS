"""State manager for tent monitoring and alerts."""
import asyncio
import json
import logging
import math
from datetime import datetime, timezone, timedelta
from typing import Any

from fastapi import WebSocket
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from config import load_tents_config, TentConfig
from database import async_session, Alert, Event, SensorHistory, Override
from ha_client import HAClient

logger = logging.getLogger(__name__)


def fahrenheit_to_celsius(f: float) -> float:
    """Convert Fahrenheit to Celsius."""
    return (f - 32) * 5 / 9


def is_temperature_sensor_type(sensor_type: str) -> bool:
    """Return whether a slot is the canonical or a numbered temperature slot."""
    return sensor_type == "temperature" or (
        sensor_type.startswith("temperature_")
        and sensor_type.removeprefix("temperature_").isdigit()
    )


def calculate_vpd(temp: float, humidity: float) -> float:
    """
    Calculate Vapor Pressure Deficit (VPD) in kPa.

    Formula: VPD = SVP * (1 - RH/100)
    Where SVP (Saturation Vapor Pressure) = 0.6108 * exp(17.27 * T / (T + 237.3))

    Args:
        temp: Temperature (auto-detects if Fahrenheit and converts)
        humidity: Relative humidity (0-100)

    Returns:
        VPD in kPa (typical range 0.4-1.6 for plants)
    """
    if humidity <= 0 or humidity > 100:
        return 0.0

    # Auto-detect Fahrenheit: grow tent temps over 50C (122F) are unrealistic
    # Typical range: 60-85F (15-30C)
    temp_c = temp
    if temp > 50:
        temp_c = fahrenheit_to_celsius(temp)

    # Saturation vapor pressure (Tetens formula)
    svp = 0.6108 * math.exp((17.27 * temp_c) / (temp_c + 237.3))

    # VPD calculation
    vpd = svp * (1 - humidity / 100)

    return round(vpd, 1)


def infer_growth_stage(schedules: dict, growth_stage_config: dict = None) -> dict:
    """
    Infer growth stage from light schedule.

    - 12 hours of light = Flower
    - 16+ hours of light = Veg
    - 13-15 hours = Transition/Unknown

    Returns dict with stage, flower_week, inferred, etc.
    """
    result = {
        "stage": "veg",  # Default to veg when nothing configured
        "inferred": True,
        "light_hours": None,
        "flower_week": None,
        "flower_start_date": None,
        "vpd_target": {"min": 0.8, "max": 1.2}  # Default VPD
    }

    # Check if manually set
    if growth_stage_config:
        if growth_stage_config.get("stage"):
            result["stage"] = growth_stage_config["stage"]
            result["inferred"] = False
        if growth_stage_config.get("flower_start_date"):
            result["flower_start_date"] = growth_stage_config["flower_start_date"]
            # Calculate flower week
            try:
                start = datetime.fromisoformat(growth_stage_config["flower_start_date"].replace('Z', '+00:00'))
                now = datetime.now(timezone.utc)
                days = (now - start).days
                result["flower_week"] = max(1, min(12, (days // 7) + 1))
            except (ValueError, TypeError):
                pass

    # Try to infer from photoperiod if not manually set
    if result["inferred"]:
        on_time = schedules.get("photoperiod_on")
        off_time = schedules.get("photoperiod_off")

        if on_time and off_time:
            try:
                # Parse times (HH:MM format)
                on_hour, on_min = map(int, on_time.split(":"))
                off_hour, off_min = map(int, off_time.split(":"))

                # Calculate light hours
                on_minutes = on_hour * 60 + on_min
                off_minutes = off_hour * 60 + off_min

                if off_minutes > on_minutes:
                    light_minutes = off_minutes - on_minutes
                else:
                    light_minutes = (24 * 60 - on_minutes) + off_minutes

                light_hours = light_minutes / 60
                result["light_hours"] = round(light_hours, 1)

                if light_hours <= 12.5:
                    result["stage"] = "flower"
                elif light_hours >= 16:
                    result["stage"] = "veg"
                else:
                    result["stage"] = "transition"

            except (ValueError, TypeError):
                pass

    # Set VPD targets based on flower week
    if result["stage"] == "flower" and result["flower_week"]:
        week = result["flower_week"]
        if week <= 2:
            # Transition to flower - lower VPD
            result["vpd_target"] = {"min": 0.8, "max": 1.0}
        elif week <= 6:
            # Stretch/early flower - medium VPD
            result["vpd_target"] = {"min": 1.0, "max": 1.2}
        elif week <= 10:
            # Bulk/ripen - higher VPD
            result["vpd_target"] = {"min": 1.2, "max": 1.5}
        else:
            # Flush - lower VPD
            result["vpd_target"] = {"min": 1.0, "max": 1.2}
    elif result["stage"] == "veg":
        # Veg - lower VPD for leaf development
        result["vpd_target"] = {"min": 0.8, "max": 1.0}

    return result


def calculate_environment_score(tent_state: dict, targets: dict) -> int:
    """
    Calculate environment score (0-100) based on how well readings match targets.

    Args:
        tent_state: Current sensor readings
        targets: Target ranges from config

    Returns:
        Score from 0-100
    """
    scores = []

    # Temperature score
    temp = tent_state.get("temperature")
    if temp is not None:
        temp_min = targets.get("temp_day_min", 18)
        temp_max = targets.get("temp_day_max", 28)
        if temp_min <= temp <= temp_max:
            scores.append(100)
        else:
            # Calculate how far out of range
            if temp < temp_min:
                deviation = temp_min - temp
            else:
                deviation = temp - temp_max
            # Lose 10 points per degree out of range
            scores.append(max(0, 100 - deviation * 10))

    # Humidity score
    humidity = tent_state.get("humidity")
    if humidity is not None:
        hum_min = targets.get("humidity_day_min", 40)
        hum_max = targets.get("humidity_day_max", 70)
        if hum_min <= humidity <= hum_max:
            scores.append(100)
        else:
            if humidity < hum_min:
                deviation = hum_min - humidity
            else:
                deviation = humidity - hum_max
            scores.append(max(0, 100 - deviation * 2))

    # VPD score (ideal range 0.8-1.2 kPa for most plants)
    vpd = tent_state.get("vpd")
    if vpd is not None:
        if 0.8 <= vpd <= 1.2:
            scores.append(100)
        elif 0.4 <= vpd <= 1.6:
            scores.append(75)
        else:
            scores.append(50)

    if not scores:
        return 0

    return int(sum(scores) / len(scores))


class TentState:
    """Current state for a single tent."""

    def __init__(self, config: TentConfig):
        self.config = config
        self.sensors: dict[str, Any] = {}
        self.actuators: dict[str, Any] = {}
        self.slot_to_entity: dict[str, str] = {}
        self.vpd: float | None = None
        self.avg_temperature: float | None = None
        self.avg_humidity: float | None = None
        self.environment_score: int = 0
        self.alerts: list[dict] = []
        self.last_updated: datetime | None = None
        self.growth_stage: dict = {}
        self._build_actuator_slots()
        self._update_growth_stage()

    def _build_actuator_slots(self):
        """Expand multi-entity actuator arrays into numbered slots.

        e.g. exhaust_fan: [fan.a, fan.b] becomes:
          slot_to_entity["exhaust_fan"] = "fan.a"
          slot_to_entity["exhaust_fan_2"] = "fan.b"
        """
        for actuator_type, entity_ids in self.config.actuators.items():
            if isinstance(entity_ids, list):
                for idx, entity_id in enumerate(entity_ids):
                    if entity_id:
                        slot = actuator_type if idx == 0 else f"{actuator_type}_{idx + 1}"
                        self.slot_to_entity[slot] = entity_id
            elif entity_ids:
                self.slot_to_entity[actuator_type] = entity_ids

    def _update_growth_stage(self):
        """Update growth stage info from config and schedules."""
        growth_stage_config = getattr(self.config, 'growth_stage', None) or {}
        self.growth_stage = infer_growth_stage(self.config.schedules, growth_stage_config)

    def update_sensor(self, sensor_type: str, value: Any, unit: str | None = None, entity_id: str | None = None):
        """Update a sensor value. For multi-entity slots, averages all values.

        Temperature values are normalized to Celsius for consistent storage and VPD calculation.
        """
        observed_at = datetime.now(timezone.utc)
        now = observed_at.isoformat()

        # Normalize temperature to Celsius
        if is_temperature_sensor_type(sensor_type) and value is not None:
            try:
                temp_val = float(value)
                # Detect Fahrenheit: via unit attribute OR heuristic (grow temps > 50°C are unrealistic)
                is_fahrenheit = (
                    (unit and "f" in unit.lower()) or
                    (unit is None and temp_val > 50)
                )
                if is_fahrenheit:
                    value = round(fahrenheit_to_celsius(temp_val), 1)
                else:
                    value = round(temp_val, 1)
                # Values exposed by TentOS and written to history are always Celsius,
                # regardless of the Home Assistant entity's source unit.
                unit = "°C"
            except (ValueError, TypeError):
                pass

        if sensor_type in self.sensors and entity_id:
            # Multi-entity: store per-entity values and average
            existing = self.sensors[sensor_type]
            if "_entities" not in existing:
                existing["_entities"] = {}
            existing["_entities"][entity_id] = value
            # Average the numeric entities only. Some slots are not numbers at
            # all (a camera reports "recording") and any sensor can report
            # "unavailable", and summing those raised a TypeError that killed
            # the state update and its WebSocket broadcast for the whole tent.
            numeric = [
                v for v in existing["_entities"].values()
                if isinstance(v, (int, float)) and math.isfinite(v)
            ]
            if numeric:
                existing["value"] = round(sum(numeric) / len(numeric), 1)
            else:
                # Nothing to average: show the most recent raw state instead
                existing["value"] = value
            existing["updated"] = now
        else:
            # First entity for this sensor type
            self.sensors[sensor_type] = {
                "value": value,
                "unit": unit,
                "updated": now,
                "_entities": {entity_id: value} if entity_id else {}
            }
        self._recalculate()
        if isinstance(value, (int, float)) and math.isfinite(value):
            # Freshness is about usable measurements, not merely a recent HA
            # state transition. "unavailable", "unknown", camera states, NaN,
            # and infinity must not make a tent look live.
            self.last_updated = observed_at

    def update_actuator(self, actuator_type: str, state: str, attributes: dict | None = None):
        """Update an actuator state."""
        self.actuators[actuator_type] = {
            "entity_id": self.slot_to_entity.get(actuator_type),
            "state": state,
            "attributes": attributes or {},
            "updated": datetime.now(timezone.utc).isoformat()
        }

    def _get_averaged_value(self, sensor_type: str) -> float | None:
        """Get averaged value for sensors (handles arrays of entities)."""
        values = []
        # The sensor data is stored by entity_id, not slot type
        # We need to check all sensors that match this type
        data = self.sensors.get(sensor_type, {})
        if isinstance(data, dict) and data.get("value") is not None:
            try:
                values.append(float(data["value"]))
            except (ValueError, TypeError):
                pass
        # Also check for _values array (multiple sensors)
        if isinstance(data, dict) and data.get("values"):
            for v in data["values"]:
                if v is not None:
                    try:
                        values.append(float(v))
                    except (ValueError, TypeError):
                        pass
        if values:
            return round(sum(values) / len(values), 1)
        return None

    def _recalculate(self):
        """Recalculate derived values."""
        # Get averaged temp and humidity from multiple sensors
        avg_temp = self._get_averaged_value("temperature")
        avg_humidity = self._get_averaged_value("humidity")

        # Store averaged values for display
        self.avg_temperature = avg_temp
        self.avg_humidity = avg_humidity

        # Calculate VPD using averaged values
        if avg_temp is not None and avg_humidity is not None:
            self.vpd = calculate_vpd(avg_temp, avg_humidity)
        else:
            self.vpd = None

        # Calculate environment score using averaged values
        sensor_values = {k: v.get("value") for k, v in self.sensors.items()}
        sensor_values["temperature"] = avg_temp  # Use averaged temp
        sensor_values["humidity"] = avg_humidity  # Use averaged humidity
        sensor_values["vpd"] = self.vpd
        self.environment_score = calculate_environment_score(sensor_values, self.config.targets)

    def to_dict(self) -> dict:
        """Convert to dictionary for API response."""
        return {
            "id": self.config.id,
            "name": self.config.name,
            "description": self.config.description,
            "sensors": self.sensors,
            "actuators": self.actuators,
            "vpd": self.vpd,
            "avg_temperature": self.avg_temperature,
            "avg_humidity": self.avg_humidity,
            "environment_score": self.environment_score,
            "alerts": self.alerts,
            "last_updated": self.last_updated.isoformat() if self.last_updated else None,
            "targets": self.config.targets,
            "schedules": self.config.schedules,
            "growth_stage": self.growth_stage,
            "control_settings": getattr(self.config, 'control_settings', None) or {}
        }


class StateManager:
    """Manages state for all tents and handles alerts."""

    def __init__(self, ha_client: HAClient, automation_engine=None):
        self.ha_client = ha_client
        self.automation_engine = automation_engine
        self.tents: dict[str, TentState] = {}
        self.entity_to_tent: dict[str, tuple[str, str, str]] = {}  # entity_id -> (tent_id, category, type)
        self.ws_clients: list[WebSocket] = []
        self._running = False
        self._alert_check_task: asyncio.Task | None = None
        self._history_task: asyncio.Task | None = None
        # Muted alert keys ("<tent_id>:<type>") and when the mute lapses. Alerts
        # are recomputed from live readings, so they carry no database id and
        # could not be acknowledged at all before this.
        self.muted_alerts: dict[str, datetime] = {}

    def _load_config(self):
        """Load tent configurations and build entity mappings."""
        configs = load_tents_config()

        for config in configs:
            self.tents[config.id] = TentState(config)

            # Map sensors (handle both single entity_id and arrays)
            for sensor_type, entity_ids in config.sensors.items():
                if isinstance(entity_ids, list):
                    for entity_id in entity_ids:
                        if entity_id:
                            self.entity_to_tent[entity_id] = (config.id, "sensor", sensor_type)
                elif entity_ids:
                    self.entity_to_tent[entity_ids] = (config.id, "sensor", sensor_type)

            # Map actuators using expanded slots (e.g. exhaust_fan, exhaust_fan_2)
            tent_state = self.tents[config.id]
            for slot, entity_id in tent_state.slot_to_entity.items():
                self.entity_to_tent[entity_id] = (config.id, "actuator", slot)

        logger.info(f"Loaded {len(self.tents)} tent configurations")

    async def reload_config(self):
        """Reload tent configurations (call after config changes)."""
        logger.info("Reloading tent configurations...")

        # Clear existing mappings
        self.tents.clear()
        self.entity_to_tent.clear()

        # Reload from file
        self._load_config()

        # Reload states from HA
        await self._load_initial_states()

        # Broadcast full state to all clients
        for tent_id in self.tents:
            await self._broadcast_update(tent_id)

        logger.info(f"Reloaded {len(self.tents)} tents")

    async def start(self):
        """Start the state manager."""
        if self._running:
            return
        self._load_config()

        # Subscribe to HA state changes
        await self.ha_client.subscribe_state_changes(self._on_state_change)

        # Load initial states
        await self._load_initial_states()

        # Start background tasks
        self._running = True
        self._alert_check_task = asyncio.create_task(self._alert_check_loop())
        self._history_task = asyncio.create_task(self._history_record_loop())

    async def stop(self):
        """Stop the state manager."""
        self._running = False
        if self._alert_check_task:
            self._alert_check_task.cancel()
        if self._history_task:
            self._history_task.cancel()

    async def _load_initial_states(self):
        """Load initial states for all mapped entities."""
        states = await self.ha_client.get_states()

        for state in states:
            entity_id = state.get("entity_id")
            if entity_id in self.entity_to_tent:
                await self._process_state_update(entity_id, state)

        logger.info("Loaded initial states")

    async def _on_state_change(self, event_data: dict):
        """Handle state change event from HA."""
        entity_id = event_data.get("entity_id")
        new_state = event_data.get("new_state")

        if entity_id in self.entity_to_tent and new_state:
            await self._process_state_update(entity_id, new_state)

    async def _process_state_update(self, entity_id: str, state: dict):
        """Process a state update for a mapped entity."""
        tent_id, category, item_type = self.entity_to_tent[entity_id]
        tent = self.tents.get(tent_id)

        if not tent:
            return

        state_value = state.get("state")
        attributes = state.get("attributes", {})

        if category == "sensor":
            # Try to parse numeric value
            try:
                value = float(state_value)
            except (ValueError, TypeError):
                value = state_value

            unit = attributes.get("unit_of_measurement")
            tent.update_sensor(item_type, value, unit, entity_id)

            # Trigger automation rules for sensor updates
            if self.automation_engine and isinstance(value, (int, float)):
                try:
                    await self.automation_engine.evaluate_sensor_rules(
                        tent_id, item_type, value, tent.config
                    )
                    # Also evaluate VPD-based rules if temp or humidity changed
                    if item_type in ("temperature", "humidity") and tent.vpd is not None:
                        await self.automation_engine.evaluate_sensor_rules(
                            tent_id, "vpd", tent.vpd, tent.config
                        )
                except Exception as e:
                    logger.error(f"Automation rule evaluation error: {e}")

        elif category == "actuator":
            tent.update_actuator(item_type, state_value, attributes)

        # Broadcast update to WebSocket clients
        await self._broadcast_update(tent_id)

    async def _broadcast_update(self, tent_id: str):
        """Broadcast tent update to all WebSocket clients."""
        tent = self.tents.get(tent_id)
        if not tent:
            return

        await self._broadcast_message({
            "type": "tent_update",
            "tent_id": tent_id,
            "data": tent.to_dict()
        })

    async def _broadcast_message(self, payload: dict):
        """Broadcast one JSON payload and discard disconnected clients."""
        message = json.dumps(payload)
        disconnected = []
        for ws in self.ws_clients:
            try:
                await ws.send_text(message)
            except Exception:
                disconnected.append(ws)

        for ws in disconnected:
            self.ws_clients.remove(ws)

    def get_alert_summary(self) -> dict:
        """Return the live alert counts used by the header and API."""
        summary = {"critical": 0, "warning": 0, "info": 0, "total": 0}
        for tent in self.tents.values():
            for alert in tent.alerts:
                severity = alert.get("severity", "warning")
                bucket = severity if severity in summary and severity != "total" else "info"
                summary[bucket] += 1
                summary["total"] += 1
        return summary

    async def broadcast_alert_state(self, tent_ids: list[str]):
        """Push changed tent alerts and the installation-wide count together."""
        for tent_id in dict.fromkeys(tent_ids):
            await self._broadcast_update(tent_id)
        await self._broadcast_message({
            "type": "alert_summary",
            "data": self.get_alert_summary(),
        })

    def add_websocket_client(self, ws: WebSocket):
        """Add a WebSocket client."""
        self.ws_clients.append(ws)

    def remove_websocket_client(self, ws: WebSocket):
        """Remove a WebSocket client."""
        if ws in self.ws_clients:
            self.ws_clients.remove(ws)

    async def _alert_check_loop(self):
        """Periodically check for alert conditions."""
        while self._running:
            try:
                await self._check_alerts()
                await asyncio.sleep(60)  # Check every minute
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Alert check error: {e}")
                await asyncio.sleep(60)

    async def _check_alerts(self):
        """Check all tents for alert conditions."""
        changed_tent_ids = []
        for tent_id, tent in self.tents.items():
            alerts = []
            targets = tent.config.targets
            notifications = tent.config.notifications

            if notifications.get("enabled", True):

                # Temperature alert (values stored in Celsius)
                temp_data = tent.sensors.get("temperature", {})
                temp = temp_data.get("value")
                if temp is not None and notifications.get("alert_temp_out_of_range", True):
                    temp_min = targets.get("temp_day_min", 18)
                    temp_max = targets.get("temp_day_max", 30)
                    if temp < temp_min or temp > temp_max:
                        # Round to 1 decimal for display
                        temp_display = round(temp, 1)
                        alerts.append({
                            "type": "temp_out_of_range",
                            "severity": "warning",
                            "message": f"Temperature {temp_display}°C is outside range ({temp_min}-{temp_max}°C)",
                            "value": temp_display,
                            "unit": "C",
                            "range_min": temp_min,
                            "range_max": temp_max
                        })

                # Humidity alert
                hum_data = tent.sensors.get("humidity", {})
                humidity = hum_data.get("value")
                if humidity is not None and notifications.get("alert_humidity_out_of_range", True):
                    hum_min = targets.get("humidity_day_min", 40)
                    hum_max = targets.get("humidity_day_max", 70)
                    if humidity < hum_min or humidity > hum_max:
                        # Round to 1 decimal for display
                        hum_display = round(humidity, 1)
                        alerts.append({
                            "type": "humidity_out_of_range",
                            "severity": "warning",
                            "message": f"Humidity {hum_display}% is outside range ({hum_min}-{hum_max}%)",
                            "value": hum_display,
                            "range_min": hum_min,
                            "range_max": hum_max
                        })

                # Leak sensor alert
                leak_data = tent.sensors.get("leak_sensor", {})
                if leak_data.get("value") in ["on", "wet", "detected", True]:
                    if notifications.get("alert_leak_detected", True):
                        alerts.append({
                            "type": "leak_detected",
                            "severity": "critical",
                            "message": "Water leak detected!"
                        })

                # Reservoir low alert
                reservoir_data = tent.sensors.get("reservoir_level", {})
                reservoir = reservoir_data.get("value")
                if reservoir is not None and notifications.get("alert_reservoir_low", True):
                    try:
                        if float(reservoir) < 20:
                            alerts.append({
                                "type": "reservoir_low",
                                "severity": "warning",
                                "message": f"Reservoir level low ({reservoir}%)"
                            })
                    except (ValueError, TypeError):
                        pass

            next_alerts = self._apply_mutes(tent_id, alerts)
            if tent.alerts != next_alerts:
                tent.alerts = next_alerts
                changed_tent_ids.append(tent_id)

        if changed_tent_ids:
            await self.broadcast_alert_state(changed_tent_ids)

    async def refresh_alerts(self):
        """Recompute alerts immediately after an explicit alert-state change."""
        await self._check_alerts()

    def mute_alert(self, key: str, hours: float = 8) -> datetime:
        """Silence one alert until it lapses or the condition clears."""
        until = datetime.now(timezone.utc) + timedelta(hours=max(0.25, min(72, hours)))
        self.muted_alerts[key] = until
        for tent_id, tent in self.tents.items():
            tent.alerts = [a for a in tent.alerts if f"{tent_id}:{a.get('type')}" != key]
        return until

    def unmute_alert(self, key: str):
        self.muted_alerts.pop(key, None)

    def _apply_mutes(self, tent_id: str, alerts: list) -> list:
        """Drop muted alerts, and forget mutes whose condition has cleared."""
        now = datetime.now(timezone.utc)
        firing = {f"{tent_id}:{a.get('type')}" for a in alerts}

        for key, until in list(self.muted_alerts.items()):
            if until <= now:
                del self.muted_alerts[key]
            elif key.startswith(f"{tent_id}:") and key not in firing:
                # Condition resolved on its own; a later recurrence is news again
                del self.muted_alerts[key]

        return [
            {**a, "key": f"{tent_id}:{a.get('type')}"}
            for a in alerts
            if f"{tent_id}:{a.get('type')}" not in self.muted_alerts
        ]

    async def _history_record_loop(self):
        """Periodically record sensor history."""
        while self._running:
            try:
                await self._record_history()
                await asyncio.sleep(300)  # Record every 5 minutes
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"History record error: {e}")
                await asyncio.sleep(300)

    async def _record_history(self):
        """Record current sensor values to history."""
        async with async_session() as session:
            for tent_id, tent in self.tents.items():
                for sensor_type, sensor_data in tent.sensors.items():
                    value = sensor_data.get("value")
                    if value is not None:
                        try:
                            numeric_value = float(value)
                            record = SensorHistory(
                                tent_id=tent_id,
                                sensor_type=sensor_type,
                                value=numeric_value,
                                unit=sensor_data.get("unit"),
                            )
                            session.add(record)
                        except (ValueError, TypeError):
                            pass

                # Also record VPD
                if tent.vpd is not None:
                    record = SensorHistory(
                        tent_id=tent_id,
                        sensor_type="vpd",
                        value=tent.vpd,
                        unit="kPa",
                    )
                    session.add(record)

            await session.commit()

    def get_tent(self, tent_id: str) -> TentState | None:
        """Get tent state by ID."""
        return self.tents.get(tent_id)

    def get_all_tents(self) -> list[dict]:
        """Get all tent states."""
        return [tent.to_dict() for tent in self.tents.values()]
