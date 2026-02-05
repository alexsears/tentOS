"""Tent Garden Manager - FastAPI Backend"""
import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from database import init_db, get_db
from ha_client import HAClient
from routes import tents, events, alerts, system, config, automations
from state_manager import StateManager
from automation import AutomationEngine

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper()),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Global state
ha_client: HAClient | None = None
state_manager: StateManager | None = None
automation_engine: AutomationEngine | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifecycle."""
    global ha_client, state_manager, automation_engine

    logger.info("Initializing Tent Garden Manager...")

    # Initialize database
    await init_db()

    # Initialize HA client
    ha_client = HAClient()
    app.state.ha_client = ha_client

    # Initialize automation engine
    automation_engine = AutomationEngine(ha_client)
    app.state.automation_engine = automation_engine

    # Initialize state manager with automation engine
    state_manager = StateManager(ha_client, automation_engine)
    app.state.state_manager = state_manager

    # Connect to Home Assistant
    try:
        await ha_client.connect()
        logger.info("Connected to Home Assistant")

        # Start state subscription and automation engine
        asyncio.create_task(state_manager.start())
        asyncio.create_task(automation_engine.start())
    except Exception as e:
        logger.error(f"Failed to connect to Home Assistant: {e}")

    yield

    # Cleanup
    logger.info("Shutting down...")
    if automation_engine:
        await automation_engine.stop()
    if state_manager:
        await state_manager.stop()
    if ha_client:
        await ha_client.disconnect()


app = FastAPI(
    title="Tent Garden Manager",
    description="Monitor and automate indoor grow tents",
    version="1.0.0",
    lifespan=lifespan,
    root_path=os.environ.get("INGRESS_PATH", "")
)

# CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(tents.router, prefix="/api/tents", tags=["tents"])
app.include_router(events.router, prefix="/api/events", tags=["events"])
app.include_router(alerts.router, prefix="/api/alerts", tags=["alerts"])
app.include_router(system.router, prefix="/api/system", tags=["system"])
app.include_router(config.router, prefix="/api/config", tags=["config"])
app.include_router(automations.router, prefix="/api/automations", tags=["automations"])


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "ha_connected": ha_client.connected if ha_client else False
    }


@app.websocket("/api/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time updates."""
    await websocket.accept()

    if not state_manager:
        await websocket.close(code=1011, reason="State manager not initialized")
        return

    # Add client to broadcast list
    state_manager.add_websocket_client(websocket)

    try:
        # Send initial snapshot of all tents
        import json
        initial_data = {
            "type": "initial_state",
            "tents": state_manager.get_all_tents()
        }
        await websocket.send_text(json.dumps(initial_data))

        while True:
            # Keep connection alive, handle incoming messages
            data = await websocket.receive_text()
            msg = json.loads(data) if data else {}

            # Handle client commands
            if msg.get("type") == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
            elif msg.get("type") == "get_tent":
                tent_id = msg.get("tent_id")
                tent = state_manager.get_tent(tent_id)
                if tent:
                    await websocket.send_text(json.dumps({
                        "type": "tent_state",
                        "tent_id": tent_id,
                        "data": tent.to_dict()
                    }))

            logger.debug(f"Received WS message: {data}")
    except WebSocketDisconnect:
        state_manager.remove_websocket_client(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        state_manager.remove_websocket_client(websocket)
