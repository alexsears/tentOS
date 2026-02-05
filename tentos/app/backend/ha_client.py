"""Home Assistant WebSocket and REST API client."""
import asyncio
import json
import logging
import random
from datetime import datetime, timedelta
from typing import Any, Callable
import aiohttp
import websockets
from websockets.exceptions import ConnectionClosed

from config import settings

logger = logging.getLogger(__name__)


class HAClient:
    """Client for communicating with Home Assistant."""

    def __init__(self):
        self.ws_url = settings.ha_url.replace("http", "ws") + "/api/websocket"
        self.rest_url = settings.ha_url + "/api"
        self.token = settings.ha_token
        self.ws: websockets.WebSocketClientProtocol | None = None
        self.message_id = 0
        self.connected = False
        self.state_callbacks: list[Callable] = []
        self._pending_responses: dict[int, asyncio.Future] = {}
        self._receive_task: asyncio.Task | None = None
        self._dev_mode = settings.is_dev_mode
        self._mock_states: dict[str, dict] = {}

    async def connect(self):
        """Connect to Home Assistant WebSocket API."""
        if self._dev_mode:
            logger.info("Running in dev mode - using mock data")
            self.connected = True
            self._init_mock_states()
            # Start mock state updates
            self._receive_task = asyncio.create_task(self._mock_state_loop())
            return

        await self._real_connect()

    def _init_mock_states(self):
        """Initialize mock states for dev mode."""
        self._mock_states = {
            "sensor.veg_tent_temperature": {"state": "24.5", "attributes": {"unit_of_measurement": "°C"}},
            "sensor.veg_tent_humidity": {"state": "65", "attributes": {"unit_of_measurement": "%"}},
            "sensor.flower_tent_temperature": {"state": "23.0", "attributes": {"unit_of_measurement": "°C"}},
            "sensor.flower_tent_humidity": {"state": "52", "attributes": {"unit_of_measurement": "%"}},
            "switch.veg_tent_light": {"state": "on", "attributes": {}},
            "switch.veg_tent_exhaust": {"state": "on", "attributes": {}},
            "switch.flower_tent_light": {"state": "on", "attributes": {}},
            "switch.flower_tent_exhaust": {"state": "off", "attributes": {}},
        }

    async def _mock_state_loop(self):
        """Simulate state changes in dev mode."""
        while self.connected:
            await asyncio.sleep(5)  # Update every 5 seconds
            # Simulate small temperature/humidity changes
            for entity_id, state in self._mock_states.items():
                if "temperature" in entity_id:
                    current = float(state["state"])
                    state["state"] = str(round(current + random.uniform(-0.5, 0.5), 1))
                elif "humidity" in entity_id:
                    current = float(state["state"])
                    new_val = current + random.uniform(-2, 2)
                    state["state"] = str(round(max(30, min(90, new_val)), 0))

                # Trigger callbacks
                for callback in self.state_callbacks:
                    try:
                        await callback({
                            "entity_id": entity_id,
                            "new_state": {"entity_id": entity_id, **state},
                            "old_state": None
                        })
                    except Exception as e:
                        logger.error(f"Mock callback error: {e}")

    async def _real_connect(self):
        """Connect to Home Assistant WebSocket API."""
        try:
            headers = {"Authorization": f"Bearer {self.token}"}
            self.ws = await websockets.connect(
                self.ws_url,
                extra_headers=headers,
                ping_interval=30,
                ping_timeout=10
            )

            # Handle auth required message
            auth_required = await self.ws.recv()
            auth_msg = json.loads(auth_required)

            if auth_msg.get("type") == "auth_required":
                # Send auth
                await self.ws.send(json.dumps({
                    "type": "auth",
                    "access_token": self.token
                }))

                auth_result = await self.ws.recv()
                result = json.loads(auth_result)

                if result.get("type") == "auth_ok":
                    self.connected = True
                    logger.info("Authenticated with Home Assistant")
                    # Start receive loop
                    self._receive_task = asyncio.create_task(self._receive_loop())
                else:
                    raise Exception(f"Auth failed: {result}")
            elif auth_msg.get("type") == "auth_ok":
                self.connected = True
                self._receive_task = asyncio.create_task(self._receive_loop())

        except Exception as e:
            logger.error(f"Failed to connect to HA: {e}")
            self.connected = False
            raise

    async def disconnect(self):
        """Disconnect from Home Assistant."""
        self.connected = False
        if self._receive_task:
            self._receive_task.cancel()
        if self.ws:
            await self.ws.close()

    async def _receive_loop(self):
        """Background task to receive WebSocket messages."""
        try:
            while self.connected and self.ws:
                message = await self.ws.recv()
                data = json.loads(message)
                await self._handle_message(data)
        except ConnectionClosed:
            logger.warning("WebSocket connection closed")
            self.connected = False
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Receive loop error: {e}")
            self.connected = False

    async def _handle_message(self, data: dict):
        """Handle incoming WebSocket message."""
        msg_type = data.get("type")
        msg_id = data.get("id")

        # Handle response to our request
        if msg_id and msg_id in self._pending_responses:
            self._pending_responses[msg_id].set_result(data)
            return

        # Handle state changed events
        if msg_type == "event" and data.get("event", {}).get("event_type") == "state_changed":
            event_data = data["event"]["data"]
            for callback in self.state_callbacks:
                try:
                    await callback(event_data)
                except Exception as e:
                    logger.error(f"State callback error: {e}")

    async def _send_command(self, command: dict, timeout: float = 10.0) -> dict:
        """Send command and wait for response."""
        if not self.ws or not self.connected:
            raise Exception("Not connected to Home Assistant")

        self.message_id += 1
        command["id"] = self.message_id

        future = asyncio.get_event_loop().create_future()
        self._pending_responses[self.message_id] = future

        await self.ws.send(json.dumps(command))

        try:
            result = await asyncio.wait_for(future, timeout=timeout)
            return result
        finally:
            self._pending_responses.pop(self.message_id, None)

    async def subscribe_state_changes(self, callback: Callable):
        """Subscribe to state change events."""
        self.state_callbacks.append(callback)

        if self._dev_mode:
            logger.info("Dev mode: registered state callback")
            return

        # Send subscription request
        result = await self._send_command({
            "type": "subscribe_events",
            "event_type": "state_changed"
        })

        if not result.get("success"):
            raise Exception(f"Failed to subscribe: {result}")

        logger.info("Subscribed to state changes")

    async def get_states(self) -> list[dict]:
        """Get all current states."""
        if self._dev_mode:
            return [
                {"entity_id": eid, **data}
                for eid, data in self._mock_states.items()
            ]

        result = await self._send_command({"type": "get_states"})
        if result.get("success"):
            return result.get("result", [])
        return []

    async def get_state(self, entity_id: str) -> dict | None:
        """Get state for a specific entity."""
        if self._dev_mode:
            state = self._mock_states.get(entity_id)
            if state:
                return {"entity_id": entity_id, **state}
            return None

        states = await self.get_states()
        for state in states:
            if state.get("entity_id") == entity_id:
                return state
        return None

    async def call_service(
        self,
        domain: str,
        service: str,
        service_data: dict | None = None,
        target: dict | None = None
    ) -> dict:
        """Call a Home Assistant service."""
        if self._dev_mode:
            logger.info(f"Dev mode: call_service {domain}.{service} -> {target}")
            return {"success": True}

        command = {
            "type": "call_service",
            "domain": domain,
            "service": service,
        }

        if service_data:
            command["service_data"] = service_data
        if target:
            command["target"] = target

        result = await self._send_command(command)
        return result

    async def turn_on(self, entity_id: str, **kwargs):
        """Turn on an entity."""
        if self._dev_mode:
            if entity_id in self._mock_states:
                self._mock_states[entity_id]["state"] = "on"
            logger.info(f"Dev mode: turn_on {entity_id}")
            return {"success": True}

        domain = entity_id.split(".")[0]
        return await self.call_service(
            domain,
            "turn_on",
            service_data=kwargs if kwargs else None,
            target={"entity_id": entity_id}
        )

    async def turn_off(self, entity_id: str):
        """Turn off an entity."""
        if self._dev_mode:
            if entity_id in self._mock_states:
                self._mock_states[entity_id]["state"] = "off"
            logger.info(f"Dev mode: turn_off {entity_id}")
            return {"success": True}

        domain = entity_id.split(".")[0]
        return await self.call_service(
            domain,
            "turn_off",
            target={"entity_id": entity_id}
        )

    async def set_fan_speed(self, entity_id: str, percentage: int):
        """Set fan speed percentage."""
        return await self.call_service(
            "fan",
            "set_percentage",
            service_data={"percentage": percentage},
            target={"entity_id": entity_id}
        )

    # REST API methods for history
    async def get_history(
        self,
        entity_ids: list[str],
        start_time: str,
        end_time: str | None = None
    ) -> list:
        """Get history from HA REST API."""
        if self._dev_mode:
            return self._generate_mock_history(entity_ids, start_time, end_time)

        headers = {"Authorization": f"Bearer {self.token}"}
        params = {"filter_entity_id": ",".join(entity_ids)}

        if end_time:
            params["end_time"] = end_time

        url = f"{self.rest_url}/history/period/{start_time}"

        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers, params=params) as resp:
                if resp.status == 200:
                    return await resp.json()
                else:
                    logger.error(f"History API error: {resp.status}")
                    return []

    async def get_automations(self) -> list[dict]:
        """Get all HA automations via REST API."""
        if self._dev_mode:
            return self._generate_mock_automations()

        headers = {"Authorization": f"Bearer {self.token}"}
        url = f"{self.rest_url}/states"

        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers) as resp:
                if resp.status == 200:
                    states = await resp.json()
                    # Filter to automation entities only
                    return [s for s in states if s.get("entity_id", "").startswith("automation.")]
                else:
                    logger.error(f"States API error: {resp.status}")
                    return []

    async def get_automation_config(self, automation_id: str) -> dict | None:
        """Get the configuration/triggers for a specific automation."""
        if self._dev_mode:
            return None

        headers = {"Authorization": f"Bearer {self.token}"}
        # The config API endpoint
        url = f"{self.rest_url}/config/automation/config/{automation_id}"

        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers) as resp:
                if resp.status == 200:
                    return await resp.json()
                return None

    def _generate_mock_automations(self) -> list[dict]:
        """Generate mock automations for dev mode."""
        return [
            {
                "entity_id": "automation.veg_tent_lights_on",
                "state": "on",
                "attributes": {
                    "friendly_name": "Veg Tent Lights On",
                    "last_triggered": "2024-01-15T06:00:00",
                    "mode": "single",
                    "current": 0
                }
            },
            {
                "entity_id": "automation.veg_tent_lights_off",
                "state": "on",
                "attributes": {
                    "friendly_name": "Veg Tent Lights Off",
                    "last_triggered": "2024-01-15T00:00:00",
                    "mode": "single",
                    "current": 0
                }
            },
            {
                "entity_id": "automation.flower_tent_high_temp_alert",
                "state": "on",
                "attributes": {
                    "friendly_name": "Flower Tent High Temp Alert",
                    "last_triggered": None,
                    "mode": "single",
                    "current": 0
                }
            }
        ]

    def _generate_mock_history(self, entity_ids: list[str], start_time: str, end_time: str | None) -> list:
        """Generate mock history data for dev mode."""
        from datetime import datetime, timedelta
        import random

        result = []
        now = datetime.now()

        for entity_id in entity_ids:
            history = []
            # Generate 24 hours of data, one point every 5 minutes
            for i in range(288):
                ts = now - timedelta(minutes=i * 5)

                if "temperature" in entity_id:
                    # Simulate day/night cycle
                    hour = ts.hour
                    base = 24 if 6 <= hour <= 18 else 20
                    value = base + random.uniform(-2, 2)
                elif "humidity" in entity_id:
                    hour = ts.hour
                    base = 55 if 6 <= hour <= 18 else 65
                    value = base + random.uniform(-5, 5)
                else:
                    value = random.choice(["on", "off"])

                history.append({
                    "entity_id": entity_id,
                    "state": str(round(value, 1)) if isinstance(value, float) else value,
                    "last_changed": ts.isoformat()
                })

            result.append(history[::-1])  # Reverse to chronological order

        return result
