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

# GitHub repo for version checking
GITHUB_REPO = "alexsears/tentOS"

# Cache the addon slug
_addon_slug = None


async def get_addon_slug():
    """Get our addon slug from Supervisor."""
    global _addon_slug
    if _addon_slug:
        return _addon_slug

    headers = await get_supervisor_headers()

    # Try to get slug from hostname or environment
    hostname = os.environ.get("HOSTNAME", "")
    if hostname:
        _addon_slug = hostname.replace("-", "_")
        return _addon_slug

    # Try common slug patterns
    async with aiohttp.ClientSession() as session:
        for slug in ["c3032025_tentos", "local_tentos", "tentos"]:
            url = f"{SUPERVISOR_API}/addons/{slug}/info"
            async with session.get(url, headers=headers) as resp:
                if resp.status == 200:
                    _addon_slug = slug
                    logger.info(f"Found addon slug: {slug}")
                    return slug

    _addon_slug = "local_tentos"
    return _addon_slug


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


@router.post("/update")
async def update_addon():
    """Update the add-on to latest version via Supervisor API."""
    try:
        headers = await get_supervisor_headers()
        slug = await get_addon_slug()

        async with aiohttp.ClientSession() as session:
            # Trigger update (pulls latest and rebuilds)
            update_url = f"{SUPERVISOR_API}/addons/{slug}/update"
            logger.info(f"Triggering update for {slug}")
            async with session.post(update_url, headers=headers) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return {
                        "success": True,
                        "message": "Update started. The add-on will restart with the new version.",
                        "data": data
                    }
                else:
                    error_text = await resp.text()
                    logger.error(f"Update failed: {resp.status} - {error_text}")
                    raise HTTPException(
                        status_code=resp.status,
                        detail=f"Supervisor API error: {error_text}"
                    )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Update error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/rebuild")
async def rebuild_addon():
    """Trigger add-on rebuild via Supervisor API."""
    try:
        headers = await get_supervisor_headers()
        slug = await get_addon_slug()

        async with aiohttp.ClientSession() as session:
            # Trigger rebuild
            rebuild_url = f"{SUPERVISOR_API}/addons/{slug}/rebuild"
            logger.info(f"Triggering rebuild for {slug}")
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
        slug = await get_addon_slug()

        async with aiohttp.ClientSession() as session:
            restart_url = f"{SUPERVISOR_API}/addons/{slug}/restart"
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
        slug = await get_addon_slug()

        async with aiohttp.ClientSession() as session:
            info_url = f"{SUPERVISOR_API}/addons/{slug}/info"
            async with session.get(info_url, headers=headers) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    addon_data = data.get("data", {})
                    return {
                        "name": addon_data.get("name"),
                        "version": addon_data.get("version"),
                        "version_latest": addon_data.get("version_latest"),
                        "state": addon_data.get("state"),
                        "update_available": addon_data.get("update_available"),
                        "repository": addon_data.get("repository"),
                        "slug": slug
                    }
                else:
                    return {"error": "Could not get add-on info", "status": resp.status}

    except Exception as e:
        return {"error": str(e), "version": get_current_version()}
