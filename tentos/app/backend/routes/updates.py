"""Update management API routes."""
import logging
import os
import yaml
import aiohttp
from fastapi import APIRouter, HTTPException, Request

logger = logging.getLogger(__name__)
router = APIRouter()

# HA Supervisor API
SUPERVISOR_TOKEN = os.environ.get("SUPERVISOR_TOKEN")
SUPERVISOR_API = "http://supervisor"

# GitHub repo for version checking
GITHUB_REPO = "alexsears/tentOS"

# Cache the addon slug
_addon_slug = None

# Cache for changelog (refreshed every 5 minutes)
_changelog_cache = {"commits": [], "timestamp": 0}
CHANGELOG_CACHE_TTL = 300  # 5 minutes


async def fetch_recent_commits(limit: int = 15) -> list[dict]:
    """Fetch recent commits from GitHub as changelog entries."""
    import time
    global _changelog_cache

    # Check cache
    now = time.time()
    if _changelog_cache["commits"] and (now - _changelog_cache["timestamp"]) < CHANGELOG_CACHE_TTL:
        return _changelog_cache["commits"]

    try:
        async with aiohttp.ClientSession() as session:
            url = f"https://api.github.com/repos/{GITHUB_REPO}/commits?per_page={limit}"
            headers = {"Accept": "application/vnd.github.v3+json"}
            async with session.get(url, headers=headers) as resp:
                if resp.status == 200:
                    commits = await resp.json()
                    changelog = []
                    for commit in commits:
                        commit_data = commit.get("commit", {})
                        message = commit_data.get("message", "").split("\n")[0]  # First line only
                        author = commit_data.get("author", {}).get("name", "Unknown")
                        date = commit_data.get("author", {}).get("date", "")
                        sha = commit.get("sha", "")[:7]

                        # Skip merge commits and bot commits
                        if message.startswith("Merge ") or "bot" in author.lower():
                            continue

                        changelog.append({
                            "sha": sha,
                            "message": message,
                            "author": author,
                            "date": date
                        })

                    _changelog_cache = {"commits": changelog, "timestamp": now}
                    return changelog
    except Exception as e:
        logger.debug(f"Failed to fetch commits: {e}")

    return []


def format_changelog(commits: list[dict]) -> str:
    """Format commit list as readable changelog text."""
    if not commits:
        return ""

    lines = ["## Recent Changes\n"]
    for commit in commits[:10]:  # Limit to 10 most recent
        date = commit.get("date", "")[:10]  # YYYY-MM-DD
        message = commit.get("message", "")
        sha = commit.get("sha", "")
        lines.append(f"- **{date}** `{sha}` {message}")

    return "\n".join(lines)


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


def parse_version(version_str: str) -> tuple:
    """Parse version string into comparable tuple."""
    try:
        # Remove 'v' prefix if present
        v = version_str.lstrip("v")
        # Split by dots and convert to integers
        parts = v.split(".")
        return tuple(int(p) for p in parts)
    except (ValueError, AttributeError):
        return (0, 0, 0)


def is_newer_version(latest: str, current: str) -> bool:
    """Check if latest version is newer than current."""
    return parse_version(latest) > parse_version(current)


async def get_supervisor_headers():
    """Get headers for Supervisor API calls."""
    if not SUPERVISOR_TOKEN:
        raise HTTPException(status_code=503, detail="Not running as HA add-on")
    return {"Authorization": f"Bearer {SUPERVISOR_TOKEN}"}


@router.get("/check")
async def check_for_updates():
    """Check for updates via GitHub raw config (most accurate) with Supervisor fallback."""
    current = get_current_version()

    # Always check GitHub raw config.yaml first - it's the source of truth
    try:
        async with aiohttp.ClientSession() as session:
            config_url = f"https://raw.githubusercontent.com/{GITHUB_REPO}/master/tentos/config.yaml"
            async with session.get(config_url) as resp:
                if resp.status == 200:
                    config_text = await resp.text()
                    config_data = yaml.safe_load(config_text)
                    latest_version = config_data.get("version", "")

                    if latest_version:
                        update_available = is_newer_version(latest_version, current)

                        # Fetch recent commits as changelog
                        commits = await fetch_recent_commits()
                        changelog = format_changelog(commits)

                        return {
                            "current_version": current,
                            "latest_version": latest_version,
                            "update_available": update_available,
                            "release_notes": changelog,
                            "commits": commits[:10],  # Include raw commit data too
                            "source": "github",
                            "repo_url": f"https://github.com/{GITHUB_REPO}"
                        }
    except Exception as e:
        logger.debug(f"GitHub raw check failed: {e}")

    # Fallback to Supervisor API (may have cached/stale version info)
    try:
        headers = await get_supervisor_headers()
        slug = await get_addon_slug()

        async with aiohttp.ClientSession() as session:
            info_url = f"{SUPERVISOR_API}/addons/{slug}/info"
            async with session.get(info_url, headers=headers) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    addon_info = data.get("data", {})
                    latest = addon_info.get("version_latest", current)
                    update_available = addon_info.get("update_available", False)

                    # Double-check with version comparison
                    if not update_available and latest:
                        update_available = is_newer_version(latest, current)

                    # Still fetch changelog from GitHub commits
                    commits = await fetch_recent_commits()
                    changelog = format_changelog(commits)

                    return {
                        "current_version": current,
                        "latest_version": latest,
                        "update_available": update_available,
                        "release_notes": changelog,
                        "commits": commits[:10],
                        "source": "supervisor",
                        "repo_url": f"https://github.com/{GITHUB_REPO}"
                    }
    except Exception as e:
        logger.debug(f"Supervisor check failed: {e}")

    # Also try GitHub releases API (for repos that use releases)
    try:
        async with aiohttp.ClientSession() as session:
            url = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
            async with session.get(url) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    latest_version = data.get("tag_name", "").lstrip("v")
                    release_notes = data.get("body", "")
                    published_at = data.get("published_at")

                    update_available = latest_version and is_newer_version(latest_version, current)
                    return {
                        "current_version": current,
                        "latest_version": latest_version or current,
                        "update_available": update_available,
                        "release_notes": release_notes,
                        "published_at": published_at,
                        "source": "github_releases",
                        "repo_url": f"https://github.com/{GITHUB_REPO}"
                    }
    except Exception as e:
        logger.debug(f"GitHub releases check failed: {e}")

    return {
        "current_version": current,
        "update_available": False,
        "message": "Could not check for updates"
    }


@router.post("/refresh")
async def refresh_store():
    """Refresh the add-on store to check for updates."""
    try:
        headers = await get_supervisor_headers()

        async with aiohttp.ClientSession() as session:
            # Reload the add-on store (refreshes all repositories)
            reload_url = f"{SUPERVISOR_API}/store/reload"
            logger.info("Refreshing add-on store...")
            async with session.post(reload_url, headers=headers) as resp:
                if resp.status == 200:
                    return {"success": True, "message": "Add-on store refreshed"}
                else:
                    error_text = await resp.text()
                    logger.error(f"Store reload failed: {resp.status} - {error_text}")
                    raise HTTPException(
                        status_code=resp.status,
                        detail=f"Failed to refresh store: {error_text}"
                    )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Refresh error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/update")
async def update_addon():
    """Update the add-on to latest version via Supervisor API."""
    try:
        headers = await get_supervisor_headers()
        slug = await get_addon_slug()

        async with aiohttp.ClientSession() as session:
            # First refresh the store to get latest version info
            reload_url = f"{SUPERVISOR_API}/store/reload"
            logger.info("Refreshing add-on store before update...")
            async with session.post(reload_url, headers=headers) as reload_resp:
                if reload_resp.status != 200:
                    logger.warning(f"Store reload returned {reload_resp.status}, continuing anyway")

            # Check if this is a local addon
            info_url = f"{SUPERVISOR_API}/addons/{slug}/info"
            async with session.get(info_url, headers=headers) as info_resp:
                is_local = False
                update_available = False
                if info_resp.status == 200:
                    info_data = await info_resp.json()
                    addon_info = info_data.get("data", {})
                    repo = addon_info.get("repository", "")
                    is_local = not repo or "local" in str(repo).lower()
                    update_available = addon_info.get("update_available", False)
                    logger.info(f"Addon {slug}: repository={repo}, is_local={is_local}, update_available={update_available}")

            if is_local:
                # For local addons, use rebuild
                logger.info(f"Local addon detected, using rebuild for {slug}")
                rebuild_url = f"{SUPERVISOR_API}/addons/{slug}/rebuild"
                async with session.post(rebuild_url, headers=headers) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        return {
                            "success": True,
                            "message": "Rebuild started. The add-on will restart.",
                            "data": data
                        }
                    else:
                        error_text = await resp.text()
                        logger.error(f"Rebuild failed: {resp.status} - {error_text}")
                        raise HTTPException(
                            status_code=resp.status,
                            detail=f"Rebuild failed: {error_text}"
                        )
            else:
                # For repository addons, use update
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
                        # If 403, give helpful message about permissions
                        if resp.status == 403:
                            raise HTTPException(
                                status_code=403,
                                detail="Permission denied. Please reinstall the add-on to enable update permissions, or update from the HA Add-ons page."
                            )
                        raise HTTPException(
                            status_code=resp.status,
                            detail=f"Update failed: {error_text}"
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


@router.post("/auto-update")
async def auto_update():
    """One-click auto-update: refresh store, check for updates, update if available.

    This endpoint can be called by Home Assistant automations to keep TentOS updated.
    Example HA automation trigger: call rest_command.tentos_auto_update
    """
    try:
        headers = await get_supervisor_headers()
        slug = await get_addon_slug()
        current = get_current_version()

        async with aiohttp.ClientSession() as session:
            # Step 1: Refresh the add-on store
            logger.info("Auto-update: Refreshing add-on store...")
            reload_url = f"{SUPERVISOR_API}/store/reload"
            async with session.post(reload_url, headers=headers) as resp:
                if resp.status != 200:
                    logger.warning(f"Store reload returned {resp.status}")

            # Step 2: Check for updates via GitHub (most accurate)
            update_available = False
            latest_version = current

            try:
                config_url = f"https://raw.githubusercontent.com/{GITHUB_REPO}/master/tentos/config.yaml"
                async with session.get(config_url) as resp:
                    if resp.status == 200:
                        config_text = await resp.text()
                        config_data = yaml.safe_load(config_text)
                        latest_version = config_data.get("version", current)
                        update_available = is_newer_version(latest_version, current)
                        logger.info(f"GitHub check: current={current}, latest={latest_version}, update={update_available}")
            except Exception as e:
                logger.debug(f"GitHub check failed: {e}")

            # Fallback: Check Supervisor API
            if not update_available:
                info_url = f"{SUPERVISOR_API}/addons/{slug}/info"
                async with session.get(info_url, headers=headers) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        addon_info = data.get("data", {})
                        update_available = addon_info.get("update_available", False)
                        latest_version = addon_info.get("version_latest", current)

            # Step 3: Update if available
            if update_available:
                logger.info(f"Auto-update: Update available ({current} -> {latest_version}), updating...")

                # Check if local addon
                info_url = f"{SUPERVISOR_API}/addons/{slug}/info"
                async with session.get(info_url, headers=headers) as info_resp:
                    is_local = False
                    if info_resp.status == 200:
                        info_data = await info_resp.json()
                        repo = info_data.get("data", {}).get("repository", "")
                        is_local = not repo or "local" in str(repo).lower()

                if is_local:
                    rebuild_url = f"{SUPERVISOR_API}/addons/{slug}/rebuild"
                    async with session.post(rebuild_url, headers=headers) as resp:
                        if resp.status == 200:
                            return {
                                "success": True,
                                "action": "rebuild",
                                "current_version": current,
                                "latest_version": latest_version,
                                "message": f"Rebuild started. Updating from {current} to {latest_version}."
                            }
                        else:
                            error_text = await resp.text()
                            return {
                                "success": False,
                                "action": "rebuild_failed",
                                "error": error_text
                            }
                else:
                    update_url = f"{SUPERVISOR_API}/addons/{slug}/update"
                    async with session.post(update_url, headers=headers) as resp:
                        if resp.status == 200:
                            return {
                                "success": True,
                                "action": "update",
                                "current_version": current,
                                "latest_version": latest_version,
                                "message": f"Update started. Updating from {current} to {latest_version}."
                            }
                        else:
                            error_text = await resp.text()
                            return {
                                "success": False,
                                "action": "update_failed",
                                "error": error_text
                            }
            else:
                logger.info(f"Auto-update: Already on latest version ({current})")
                return {
                    "success": True,
                    "action": "none",
                    "current_version": current,
                    "latest_version": latest_version,
                    "message": "Already running the latest version."
                }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Auto-update error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/create-webhook")
async def create_webhook_automation(request: Request):
    """Create an HA automation that updates TentOS when triggered via webhook.

    After creating, trigger updates with:
      curl -X POST http://homeassistant.local:8123/api/webhook/tentos_auto_update
    """
    try:
        slug = await get_addon_slug()

        config = {
            "id": "tentos_auto_update_webhook",
            "alias": "[TentOS] Auto-Update on Push",
            "description": "Automatically updates TentOS addon when triggered via webhook after a git push",
            "mode": "single",
            "trigger": [
                {
                    "platform": "webhook",
                    "webhook_id": "tentos_auto_update",
                    "allowed_methods": ["POST"],
                    "local_only": False
                }
            ],
            "action": [
                {"delay": {"seconds": 90}},
                {"service": "hassio.addon_update", "data": {"addon": slug}}
            ]
        }

        ha_client = request.app.state.ha_client
        result = await ha_client.create_automation(config)

        if result.get("success"):
            return {
                "success": True,
                "webhook_url": "/api/webhook/tentos_auto_update",
                "addon_slug": slug,
                "message": "Webhook automation created. Trigger with: curl -X POST http://<ha-url>:8123/api/webhook/tentos_auto_update"
            }
        else:
            raise HTTPException(status_code=500, detail="Failed to create automation in HA")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Create webhook error: {e}")
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


@router.get("/changelog")
async def get_changelog(limit: int = 15):
    """Get recent commits as changelog."""
    commits = await fetch_recent_commits(limit)
    changelog = format_changelog(commits)

    return {
        "changelog": changelog,
        "commits": commits,
        "count": len(commits)
    }
