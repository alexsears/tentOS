"""Home Assistant WebSocket and REST API client."""
import asyncio
import json
import logging
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

    async def connect(self):
        """Connect to Home Assistant WebSocket API."""
        try:
            headers = {"Authorization": f"Bearer {self.token}"}
            self.ws = await websockets.connect(
                self.ws_url,
                additional_headers=headers,
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
        result = await self._send_command({"type": "get_states"})
        if result.get("success"):
            return result.get("result", [])
        return []

    async def get_state(self, entity_id: str) -> dict | None:
        """Get state for a specific entity."""
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
        domain = entity_id.split(".")[0]
        return await self.call_service(
            domain,
            "turn_on",
            service_data=kwargs if kwargs else None,
            target={"entity_id": entity_id}
        )

    async def turn_off(self, entity_id: str):
        """Turn off an entity."""
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
