"""Camera proxy routes - securely streams camera feeds through HA API."""
import logging
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
import aiohttp

from config import settings

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/{tent_id}/{entity_id:path}/snapshot")
async def get_camera_snapshot(tent_id: str, entity_id: str, request: Request):
    """
    Get a camera snapshot image, proxied through HA API.

    Security: This endpoint requires HA ingress authentication and uses
    the supervisor token to fetch from HA - no direct camera URLs are exposed.
    """
    state_manager = request.app.state.state_manager
    ha_client = request.app.state.ha_client

    # Verify tent exists and camera is configured
    tent = state_manager.get_tent(tent_id)
    if not tent:
        raise HTTPException(status_code=404, detail="Tent not found")

    # Verify the entity is configured for this tent
    configured_cameras = tent.config.sensors.get("camera", [])
    if isinstance(configured_cameras, str):
        configured_cameras = [configured_cameras]

    if entity_id not in configured_cameras:
        raise HTTPException(status_code=403, detail="Camera not configured for this tent")

    # Proxy the request to HA
    url = f"{settings.ha_url}/api/camera_proxy/{entity_id}"
    headers = {"Authorization": f"Bearer {settings.ha_token}"}

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers) as resp:
                if resp.status != 200:
                    raise HTTPException(status_code=resp.status, detail="Failed to fetch camera image")

                content = await resp.read()
                content_type = resp.headers.get("Content-Type", "image/jpeg")

                return StreamingResponse(
                    iter([content]),
                    media_type=content_type,
                    headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
                )
    except aiohttp.ClientError as e:
        logger.error(f"Camera proxy error: {e}")
        raise HTTPException(status_code=502, detail="Failed to connect to camera")


@router.get("/{tent_id}/{entity_id:path}/stream")
async def get_camera_stream(tent_id: str, entity_id: str, request: Request):
    """
    Get a camera MJPEG stream, proxied through HA API.

    Security: This endpoint requires HA ingress authentication and uses
    the supervisor token to fetch from HA - no direct camera URLs are exposed.
    """
    state_manager = request.app.state.state_manager
    ha_client = request.app.state.ha_client

    # Verify tent exists and camera is configured
    tent = state_manager.get_tent(tent_id)
    if not tent:
        raise HTTPException(status_code=404, detail="Tent not found")

    # Verify the entity is configured for this tent
    configured_cameras = tent.config.sensors.get("camera", [])
    if isinstance(configured_cameras, str):
        configured_cameras = [configured_cameras]

    if entity_id not in configured_cameras:
        raise HTTPException(status_code=403, detail="Camera not configured for this tent")

    # Proxy the MJPEG stream from HA
    url = f"{settings.ha_url}/api/camera_proxy_stream/{entity_id}"
    headers = {"Authorization": f"Bearer {settings.ha_token}"}

    async def stream_camera():
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=None)) as resp:
                    if resp.status != 200:
                        return

                    async for chunk in resp.content.iter_any():
                        yield chunk
        except Exception as e:
            logger.error(f"Camera stream error: {e}")

    return StreamingResponse(
        stream_camera(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
    )
