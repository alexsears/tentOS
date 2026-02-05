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
from routes import tents, events, alerts, system
from state_manager import StateManager

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper()),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Global state
ha_client: HAClient | None = None
state_manager: StateManager | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifecycle."""
    global ha_client, state_manager

    logger.info("Initializing Tent Garden Manager...")

    # Initialize database
    await init_db()

    # Initialize HA client
    ha_client = HAClient()
    app.state.ha_client = ha_client

    # Initialize state manager
    state_manager = StateManager(ha_client)
    app.state.state_manager = state_manager

    # Connect to Home Assistant
    try:
        await ha_client.connect()
        logger.info("Connected to Home Assistant")

        # Start state subscription
        asyncio.create_task(state_manager.start())
    except Exception as e:
        logger.error(f"Failed to connect to Home Assistant: {e}")

    yield

    # Cleanup
    logger.info("Shutting down...")
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
        while True:
            # Keep connection alive, handle incoming messages
            data = await websocket.receive_text()
            # Handle client messages if needed (e.g., subscribe to specific tent)
            logger.debug(f"Received WS message: {data}")
    except WebSocketDisconnect:
        state_manager.remove_websocket_client(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        state_manager.remove_websocket_client(websocket)
