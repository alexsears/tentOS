"""Update management API routes."""
import logging
import os
import yaml
import aiohttp
from fastapi import APIRouter, HTTPException

logger = logging.getLogger(__name__)
router = APIRouter()

# HA Supervisor API
SUPERVISOR_TOKEN = os.environ.get("SUPERVISOR_TOKEN")
SUPERVISOR_API = "http://supervisor"
ADDON_SLUG = "local_tentos"  # Local add-on slug

# GitHub repo for version checking
GITHUB_REPO = "alexsears/tentOS"


def get_current_version():
    """Read version from config.yaml."""
    config_paths = [
        "/config.yaml",  # In container
        os.path.join(os.path.dirname(__file__), "../../../config.yaml"),  # Dev
    ]
    for path in config_paths:
        try:
            with open(path) as f:
                config = yaml.safe_load(f)
                return config.get("version", "unknown")
        except FileNotFoundError:
            continue
    return "unknown"


async def get_supervisor_headers():
    """Get headers for Supervisor API calls."""
    if not SUPERVISOR_TOKEN:
        raise HTTPException(status_code=503, detail="Not running as HA add-on")
    return {"Authorization": f"Bearer {SUPERVISOR_TOKEN}"}


@router.get("/check")
async def check_for_updates():
    """Check GitHub for newer versions."""
    try:
        async with aiohttp.ClientSession() as session:
            # Get latest release from GitHub
            url = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
            async with session.get(url) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    latest_version = data.get("tag_name", "").lstrip("v")
                    release_notes = data.get("body", "")
                    published_at = data.get("published_at")

                    current = get_current_version()
                    return {
                        "current_version": current,
                        "latest_version": latest_version or current,
                        "update_available": latest_version and latest_version != current,
                        "release_notes": release_notes,
                        "published_at": published_at,
                        "repo_url": f"https://github.com/{GITHUB_REPO}"
                    }
                elif resp.status == 404:
                    # No releases yet, check commits
                    commits_url = f"https://api.github.com/repos/{GITHUB_REPO}/commits?per_page=1"
                    async with session.get(commits_url) as commits_resp:
                        if commits_resp.status == 200:
                            commits = await commits_resp.json()
                            if commits:
                                latest_sha = commits[0]["sha"][:7]
                                latest_date = commits[0]["commit"]["committer"]["date"]
                                latest_msg = commits[0]["commit"]["message"].split("\n")[0]

                                return {
                                    "current_version": get_current_version(),
                                    "latest_commit": latest_sha,
                                    "latest_commit_date": latest_date,
                                    "latest_commit_message": latest_msg,
                                    "update_available": True,  # Assume updates if checking commits
                                    "repo_url": f"https://github.com/{GITHUB_REPO}"
                                }

        return {
            "current_version": get_current_version(),
            "update_available": False,
            "message": "Could not check for updates"
        }

    except Exception as e:
        logger.error(f"Update check failed: {e}")
        return {
            "current_version": get_current_version(),
            "update_available": False,
            "error": str(e)
        }


@router.post("/rebuild")
async def rebuild_addon():
    """Trigger add-on rebuild via Supervisor API."""
    try:
        headers = await get_supervisor_headers()

        async with aiohttp.ClientSession() as session:
            # First, try to get add-on info to confirm we can access Supervisor
            info_url = f"{SUPERVISOR_API}/addons/{ADDON_SLUG}/info"
            async with session.get(info_url, headers=headers) as resp:
                if resp.status != 200:
                    # Try alternate slug formats
                    for slug in ["local_tentos", "tentos", "a]_tentos"]:
                        info_url = f"{SUPERVISOR_API}/addons/{slug}/info"
                        async with session.get(info_url, headers=headers) as alt_resp:
                            if alt_resp.status == 200:
                                ADDON_SLUG = slug
                                break

            # Trigger rebuild
            rebuild_url = f"{SUPERVISOR_API}/addons/{ADDON_SLUG}/rebuild"
            async with session.post(rebuild_url, headers=headers) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return {
                        "success": True,
                        "message": "Rebuild started. The add-on will restart automatically.",
                        "data": data
                    }
                else:
                    error_text = await resp.text()
                    logger.error(f"Rebuild failed: {resp.status} - {error_text}")
                    raise HTTPException(
                        status_code=resp.status,
                        detail=f"Supervisor API error: {error_text}"
                    )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Rebuild error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/restart")
async def restart_addon():
    """Restart the add-on (faster than rebuild, but won't pull new code)."""
    try:
        headers = await get_supervisor_headers()

        async with aiohttp.ClientSession() as session:
            restart_url = f"{SUPERVISOR_API}/addons/{ADDON_SLUG}/restart"
            async with session.post(restart_url, headers=headers) as resp:
                if resp.status == 200:
                    return {
                        "success": True,
                        "message": "Restart initiated. Reconnect in a few seconds."
                    }
                else:
                    error_text = await resp.text()
                    raise HTTPException(status_code=resp.status, detail=error_text)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Restart error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/info")
async def get_addon_info():
    """Get add-on info from Supervisor."""
    try:
        headers = await get_supervisor_headers()

        async with aiohttp.ClientSession() as session:
            info_url = f"{SUPERVISOR_API}/addons/{ADDON_SLUG}/info"
            async with session.get(info_url, headers=headers) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    addon_data = data.get("data", {})
                    return {
                        "name": addon_data.get("name"),
                        "version": addon_data.get("version"),
                        "state": addon_data.get("state"),
                        "update_available": addon_data.get("update_available"),
                        "repository": addon_data.get("repository"),
                        "build": addon_data.get("build")
                    }
                else:
                    return {"error": "Could not get add-on info", "status": resp.status}

    except Exception as e:
        return {"error": str(e), "version": get_current_version()}
