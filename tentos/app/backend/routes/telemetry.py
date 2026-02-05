"""Anonymous telemetry API routes."""
import logging
import os
import platform
import uuid
import aiohttp
from datetime import datetime, timezone
from fastapi import APIRouter, Request
from pydantic import BaseModel
from sqlalchemy import select

from database import TelemetrySettings, async_session

logger = logging.getLogger(__name__)
router = APIRouter()

# Telemetry endpoint - set this to your own endpoint to collect stats
# Example: Cloudflare Worker, Vercel serverless, or any simple counter API
TELEMETRY_ENDPOINT = os.environ.get(
    "TELEMETRY_ENDPOINT",
    "https://tentos-telemetry.asears2.workers.dev/ping"
)


def get_current_version():
    """Get current TentOS version."""
    import yaml
    config_paths = ["/config.yaml", os.path.join(os.path.dirname(__file__), "../../config.yaml")]
    for path in config_paths:
        try:
            with open(path) as f:
                config = yaml.safe_load(f)
                return config.get("version", "unknown")
        except FileNotFoundError:
            continue
    return "unknown"


async def get_or_create_install_id() -> tuple[str, bool]:
    """Get existing install ID or create a new one."""
    async with async_session() as session:
        result = await session.execute(select(TelemetrySettings).limit(1))
        settings = result.scalar_one_or_none()

        if settings:
            return settings.install_id, settings.opted_in

        # Create new install ID
        install_id = str(uuid.uuid4())[:16]
        new_settings = TelemetrySettings(
            install_id=install_id,
            opted_in=False,
            version=get_current_version(),
            arch=platform.machine()
        )
        session.add(new_settings)
        await session.commit()
        return install_id, False


async def send_telemetry_ping(install_id: str, event: str = "ping"):
    """Send anonymous telemetry ping."""
    if not TELEMETRY_ENDPOINT:
        return

    try:
        data = {
            "id": install_id,
            "event": event,
            "version": get_current_version(),
            "arch": platform.machine(),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

        async with aiohttp.ClientSession() as session:
            async with session.post(
                TELEMETRY_ENDPOINT,
                json=data,
                timeout=aiohttp.ClientTimeout(total=5)
            ) as resp:
                if resp.status == 200:
                    logger.debug(f"Telemetry ping sent: {event}")
                else:
                    logger.debug(f"Telemetry ping failed: {resp.status}")
    except Exception as e:
        logger.debug(f"Telemetry error: {e}")


@router.get("/status")
async def get_telemetry_status():
    """Get current telemetry opt-in status."""
    install_id, opted_in = await get_or_create_install_id()
    return {
        "opted_in": opted_in,
        "install_id": install_id[:8] + "..."  # Show partial ID for transparency
    }


class OptInRequest(BaseModel):
    opted_in: bool


@router.post("/opt-in")
async def set_telemetry_opt_in(request: OptInRequest):
    """Set telemetry opt-in preference."""
    async with async_session() as session:
        result = await session.execute(select(TelemetrySettings).limit(1))
        settings = result.scalar_one_or_none()

        if not settings:
            install_id = str(uuid.uuid4())[:16]
            settings = TelemetrySettings(
                install_id=install_id,
                opted_in=request.opted_in,
                version=get_current_version(),
                arch=platform.machine()
            )
            session.add(settings)
        else:
            settings.opted_in = request.opted_in
            settings.version = get_current_version()

        await session.commit()
        install_id = settings.install_id

    # Send ping if opting in
    if request.opted_in:
        await send_telemetry_ping(install_id, "opt_in")

    return {"success": True, "opted_in": request.opted_in}


@router.post("/ping")
async def manual_ping():
    """Send a telemetry ping if opted in."""
    install_id, opted_in = await get_or_create_install_id()

    if not opted_in:
        return {"success": False, "message": "Telemetry not enabled"}

    await send_telemetry_ping(install_id, "manual_ping")

    # Update last ping time
    async with async_session() as session:
        result = await session.execute(select(TelemetrySettings).limit(1))
        settings = result.scalar_one_or_none()
        if settings:
            settings.last_ping = datetime.now(timezone.utc)
            await session.commit()

    return {"success": True, "message": "Ping sent"}


async def startup_telemetry_ping():
    """Send startup ping if opted in. Called from main.py on startup."""
    try:
        install_id, opted_in = await get_or_create_install_id()
        if opted_in:
            await send_telemetry_ping(install_id, "startup")
            logger.info("Telemetry startup ping sent")
    except Exception as e:
        logger.debug(f"Startup telemetry error: {e}")
