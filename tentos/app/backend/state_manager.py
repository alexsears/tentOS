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
        "stage": "unknown",
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
    if result["stage"] == "unknown":
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
        self.vpd: float | None = None
        self.avg_temperature: float | None = None
        self.avg_humidity: float | None = None
        self.environment_score: int = 0
        self.alerts: list[dict] = []
        self.last_updated: datetime | None = None
        self.growth_stage: dict = {}
        self._update_growth_stage()

    def _update_growth_stage(self):
        """Update growth stage info from config and schedules."""
        growth_stage_config = getattr(self.config, 'growth_stage', None) or {}
        self.growth_stage = infer_growth_stage(self.config.schedules, growth_stage_config)

    def update_sensor(self, sensor_type: str, value: Any, unit: str | None = None, entity_id: str | None = None):
        """Update a sensor value. For multi-entity slots, averages all values.

        Temperature values are normalized to Celsius for consistent storage and VPD calculation.
        """
        now = datetime.now(timezone.utc).isoformat()

        # Normalize temperature to Celsius
        if sensor_type == "temperature" and value is not None:
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
            except (ValueError, TypeError):
                pass

        if sensor_type in self.sensors and entity_id:
            # Multi-entity: store per-entity values and average
            existing = self.sensors[sensor_type]
            if "_entities" not in existing:
                existing["_entities"] = {}
            existing["_entities"][entity_id] = value
            # Average all entity values
            values = [v for v in existing["_entities"].values() if v is not None]
            existing["value"] = round(sum(values) / len(values), 1) if values else None
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

    def update_actuator(self, actuator_type: str, state: str, attributes: dict | None = None):
        """Update an actuator state."""
        self.actuators[actuator_type] = {
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
        self.last_updated = datetime.now(timezone.utc)

        # Get averaged temp and humidity from multiple sensors
        avg_temp = self._get_averaged_value("temperature")
        avg_humidity = self._get_averaged_value("humidity")

        # Store averaged values for display
        self.avg_temperature = avg_temp
        self.avg_humidity = avg_humidity

        # Calculate VPD using averaged values
        if avg_temp is not None and avg_humidity is not None:
            self.vpd = calculate_vpd(avg_temp, avg_humidity)

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

            # Map actuators (handle both single entity_id and arrays)
            for actuator_type, entity_ids in config.actuators.items():
                if isinstance(entity_ids, list):
                    for entity_id in entity_ids:
                        if entity_id:
                            self.entity_to_tent[entity_id] = (config.id, "actuator", actuator_type)
                elif entity_ids:
                    self.entity_to_tent[entity_ids] = (config.id, "actuator", actuator_type)

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
        self._running = True
        self._load_config()

        # Subscribe to HA state changes
        await self.ha_client.subscribe_state_changes(self._on_state_change)

        # Load initial states
        await self._load_initial_states()

        # Start background tasks
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

        message = json.dumps({
            "type": "tent_update",
            "tent_id": tent_id,
            "data": tent.to_dict()
        })

        disconnected = []
        for ws in self.ws_clients:
            try:
                await ws.send_text(message)
            except Exception:
                disconnected.append(ws)

        for ws in disconnected:
            self.ws_clients.remove(ws)

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
        async with async_session() as session:
            for tent_id, tent in self.tents.items():
                alerts = []
                targets = tent.config.targets
                notifications = tent.config.notifications

                if not notifications.get("enabled", True):
                    continue

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

                tent.alerts = alerts

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
                                value=numeric_value
                            )
                            session.add(record)
                        except (ValueError, TypeError):
                            pass

                # Also record VPD
                if tent.vpd is not None:
                    record = SensorHistory(
                        tent_id=tent_id,
                        sensor_type="vpd",
                        value=tent.vpd
                    )
                    session.add(record)

            await session.commit()

    def get_tent(self, tent_id: str) -> TentState | None:
        """Get tent state by ID."""
        return self.tents.get(tent_id)

    def get_all_tents(self) -> list[dict]:
        """Get all tent states."""
        return [tent.to_dict() for tent in self.tents.values()]
