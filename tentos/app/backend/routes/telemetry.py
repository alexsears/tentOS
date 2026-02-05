"""Anonymous install counter - pings once per unique install."""
import logging
import os
import platform
import uuid
import aiohttp
from datetime import datetime, timezone
from sqlalchemy import select

from database import TelemetrySettings, async_session

logger = logging.getLogger(__name__)

TELEMETRY_ENDPOINT = "https://tentos-telemetry.asears2.workers.dev/ping"


def get_current_version():
    """Get current TentOS version."""
    import yaml
    config_paths = ["/config.yaml", os.path.join(os.path.dirname(__file__), "../../config.yaml")]
    for path in config_paths:
        try:
            with open(path) as f:
                return yaml.safe_load(f).get("version", "unknown")
        except:
            continue
    return "unknown"


async def ping_install():
    """Send one-time anonymous install ping. Called on first startup only."""
    try:
        async with async_session() as session:
            # Check if we've already pinged
            result = await session.execute(select(TelemetrySettings).limit(1))
            existing = result.scalar_one_or_none()

            if existing and existing.last_ping:
                # Already pinged, skip
                return

            # Generate or get install ID
            if existing:
                install_id = existing.install_id
            else:
                install_id = str(uuid.uuid4())[:12]
                existing = TelemetrySettings(
                    install_id=install_id,
                    opted_in=True,  # Not used anymore
                    version=get_current_version(),
                    arch=platform.machine()
                )
                session.add(existing)

            # Send ping
            data = {
                "id": install_id,
                "event": "install",
                "version": get_current_version(),
                "arch": platform.machine(),
                "timestamp": datetime.now(timezone.utc).isoformat()
            }

            async with aiohttp.ClientSession() as http:
                async with http.post(
                    TELEMETRY_ENDPOINT,
                    json=data,
                    timeout=aiohttp.ClientTimeout(total=5)
                ) as resp:
                    if resp.status == 200:
                        existing.last_ping = datetime.now(timezone.utc)
                        await session.commit()
                        logger.info(f"Install ping sent: {install_id}")
                    else:
                        logger.debug(f"Install ping failed: {resp.status}")

    except Exception as e:
        logger.debug(f"Install ping error: {e}")
