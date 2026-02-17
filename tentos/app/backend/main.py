"""Tent Garden Manager - FastAPI Backend"""
import asyncio
import logging
import os
import yaml
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from config import settings


def get_version():
    """Read version from config.yaml."""
    config_paths = [
        "/app/config.yaml",  # Docker container path
        os.path.join(os.path.dirname(__file__), "../../config.yaml"),  # Local dev
        "/config.yaml",
    ]
    for path in config_paths:
        try:
            with open(path) as f:
                config = yaml.safe_load(f)
                version = config.get("version", "1.0.0")
                logging.info(f"Loaded version {version} from {path}")
                return version
        except FileNotFoundError:
            continue
        except Exception as e:
            logging.warning(f"Error reading {path}: {e}")
            continue
    logging.warning("Could not find config.yaml, using default version")
    return "1.0.0"
from database import init_db, get_db
from ha_client import HAClient
from routes import tents, events, alerts, system, config, automations, reports, updates, camera, chat
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

        # Send one-time install ping
        from routes.telemetry import ping_install
        asyncio.create_task(ping_install())
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
    version=get_version(),
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
app.include_router(reports.router, prefix="/api/reports", tags=["reports"])
app.include_router(updates.router, prefix="/api/updates", tags=["updates"])
app.include_router(camera.router, prefix="/api/camera", tags=["camera"])
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "version": get_version(),
        "ha_connected": ha_client.connected if ha_client else False
    }


@app.get("/api/debug/climate")
async def debug_climate():
    """Debug page for Climate - bypasses frontend caching."""
    from fastapi.responses import HTMLResponse
    from routes.config import load_config
    import json as json_mod

    cfg = load_config()
    tents_data = []
    if state_manager:
        for tent in state_manager.tents.values():
            tents_data.append({
                "id": tent.id,
                "name": tent.name,
                "avg_temperature": getattr(tent, 'avg_temperature', None),
                "avg_humidity": getattr(tent, 'avg_humidity', None),
                "vpd": getattr(tent, 'vpd', None),
                "sensors": {k: str(v) for k, v in (getattr(tent, 'sensors', {}) or {}).items()},
                "actuators": {k: str(v) for k, v in (getattr(tent, 'actuators', {}) or {}).items()},
            })

    config_dump = cfg.model_dump()
    version = get_version()

    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>TentOS Climate Debug</title>
<style>body{{font-family:monospace;background:#111;color:#eee;padding:20px}}
h1{{color:#facc15}}h2{{color:#4ade80;margin-top:20px}}
pre{{background:#1a1a2e;padding:10px;border-radius:5px;overflow-x:auto;white-space:pre-wrap}}
.ok{{color:#4ade80}}.bad{{color:#ef4444}}</style></head>
<body>
<h1>TentOS Climate Debug v{version}</h1>
<p>This page is served directly by the backend — no frontend caching.</p>

<h2>Config Tents ({len(config_dump.get('tents', []))})</h2>
<pre>{json_mod.dumps(config_dump.get('tents', []), indent=2)}</pre>

<h2>Live Tents from StateManager ({len(tents_data)})</h2>
<pre>{json_mod.dumps(tents_data, indent=2)}</pre>

<h2>Hidden Entities</h2>
<pre>{json_mod.dumps(config_dump.get('hiddenEntities', []), indent=2)}</pre>

<h2>Full Config</h2>
<pre>{json_mod.dumps(config_dump, indent=2)}</pre>
</body></html>"""

    return HTMLResponse(content=html, headers={
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0"
    })


async def handle_chat_message(websocket: WebSocket, msg: dict, state_manager):
    """Handle incoming chat message via WebSocket."""
    from routes.chat import (
        check_rate_limit, sanitize_content, generate_display_name,
        is_developer, broadcast_chat_message
    )
    from database import get_db, ChatMessage, ChatUser
    from sqlalchemy import select

    session_id = msg.get("session_id", "")
    content = msg.get("content", "")

    if not session_id or not content:
        await websocket.send_text(json.dumps({
            "type": "chat_error",
            "error": "Missing session_id or content"
        }))
        return

    # Rate limit
    if not check_rate_limit(session_id):
        await websocket.send_text(json.dumps({
            "type": "chat_error",
            "error": "Rate limited. Wait a moment."
        }))
        return

    # Sanitize
    content = sanitize_content(content)
    if not content:
        return

    async for db_session in get_db():
        # Get or create user
        result = await db_session.execute(
            select(ChatUser).where(ChatUser.session_id == session_id)
        )
        user = result.scalar_one_or_none()

        if not user:
            user = ChatUser(session_id=session_id)
            db_session.add(user)
            await db_session.commit()
            await db_session.refresh(user)

        # Check if banned
        if user.is_banned:
            await websocket.send_text(json.dumps({
                "type": "chat_error",
                "error": "You have been banned from chat"
            }))
            return

        # Create message
        display_name = generate_display_name(session_id, user.nickname)
        dev = is_developer(user.ha_user_name)

        message = ChatMessage(
            session_id=session_id,
            ha_user_id=user.ha_user_id,
            ha_user_name=user.ha_user_name,
            display_name=display_name,
            content=content,
            is_developer=dev
        )
        db_session.add(message)
        await db_session.commit()
        await db_session.refresh(message)

        # Broadcast to all clients
        msg_data = {
            "id": message.id,
            "display_name": message.display_name,
            "content": message.content,
            "timestamp": message.timestamp.isoformat(),
            "is_developer": message.is_developer
        }

        disconnected = await broadcast_chat_message(state_manager.ws_clients, msg_data)
        for ws in disconnected:
            state_manager.ws_clients.remove(ws)


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
            elif msg.get("type") == "chat_message":
                # Handle real-time chat message
                await handle_chat_message(websocket, msg, state_manager)

            logger.debug(f"Received WS message: {data}")
    except WebSocketDisconnect:
        state_manager.remove_websocket_client(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        state_manager.remove_websocket_client(websocket)
