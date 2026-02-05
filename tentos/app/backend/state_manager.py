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


def calculate_vpd(temp_c: float, humidity: float) -> float:
    """
    Calculate Vapor Pressure Deficit (VPD) in kPa.

    Formula: VPD = SVP * (1 - RH/100)
    Where SVP (Saturation Vapor Pressure) = 0.6108 * exp(17.27 * T / (T + 237.3))

    Args:
        temp_c: Temperature in Celsius
        humidity: Relative humidity (0-100)

    Returns:
        VPD in kPa
    """
    if humidity <= 0 or humidity > 100:
        return 0.0

    # Saturation vapor pressure (Tetens formula)
    svp = 0.6108 * math.exp((17.27 * temp_c) / (temp_c + 237.3))

    # VPD calculation
    vpd = svp * (1 - humidity / 100)

    return round(vpd, 2)


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
        self.environment_score: int = 0
        self.alerts: list[dict] = []
        self.last_updated: datetime | None = None

    def update_sensor(self, sensor_type: str, value: Any, unit: str | None = None):
        """Update a sensor value."""
        self.sensors[sensor_type] = {
            "value": value,
            "unit": unit,
            "updated": datetime.now(timezone.utc).isoformat()
        }
        self._recalculate()

    def update_actuator(self, actuator_type: str, state: str, attributes: dict | None = None):
        """Update an actuator state."""
        self.actuators[actuator_type] = {
            "state": state,
            "attributes": attributes or {},
            "updated": datetime.now(timezone.utc).isoformat()
        }

    def _recalculate(self):
        """Recalculate derived values."""
        self.last_updated = datetime.now(timezone.utc)

        # Calculate VPD if we have temp and humidity
        temp_data = self.sensors.get("temperature", {})
        humidity_data = self.sensors.get("humidity", {})

        if temp_data.get("value") is not None and humidity_data.get("value") is not None:
            temp = float(temp_data["value"])
            humidity = float(humidity_data["value"])
            self.vpd = calculate_vpd(temp, humidity)

        # Calculate environment score
        sensor_values = {k: v.get("value") for k, v in self.sensors.items()}
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
            "environment_score": self.environment_score,
            "alerts": self.alerts,
            "last_updated": self.last_updated.isoformat() if self.last_updated else None,
            "targets": self.config.targets,
            "schedules": self.config.schedules
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

            # Map sensors
            for sensor_type, entity_id in config.sensors.items():
                if entity_id:
                    self.entity_to_tent[entity_id] = (config.id, "sensor", sensor_type)

            # Map actuators
            for actuator_type, entity_id in config.actuators.items():
                if entity_id:
                    self.entity_to_tent[entity_id] = (config.id, "actuator", actuator_type)

        logger.info(f"Loaded {len(self.tents)} tent configurations")

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
            tent.update_sensor(item_type, value, unit)

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

                # Temperature alert
                temp_data = tent.sensors.get("temperature", {})
                temp = temp_data.get("value")
                if temp is not None and notifications.get("alert_temp_out_of_range", True):
                    temp_min = targets.get("temp_day_min", 18)
                    temp_max = targets.get("temp_day_max", 30)
                    if temp < temp_min or temp > temp_max:
                        alerts.append({
                            "type": "temp_out_of_range",
                            "severity": "warning",
                            "message": f"Temperature {temp}°C is outside range ({temp_min}-{temp_max}°C)"
                        })

                # Humidity alert
                hum_data = tent.sensors.get("humidity", {})
                humidity = hum_data.get("value")
                if humidity is not None and notifications.get("alert_humidity_out_of_range", True):
                    hum_min = targets.get("humidity_day_min", 40)
                    hum_max = targets.get("humidity_day_max", 70)
                    if humidity < hum_min or humidity > hum_max:
                        alerts.append({
                            "type": "humidity_out_of_range",
                            "severity": "warning",
                            "message": f"Humidity {humidity}% is outside range ({hum_min}-{hum_max}%)"
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
