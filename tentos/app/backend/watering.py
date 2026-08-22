"""Timed watering runs.

The manual watering action used to call turn_on and return, so a pump started
from the UI ran until something else stopped it. Every run now owns a timer that
turns the pump back off, and the run is recorded as an override row so a restart
mid-run does not strand a pump in the on state.
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, delete, select

from database import async_session, Event, Override

logger = logging.getLogger(__name__)

# Overrides written by a watering run, so they can be told apart from the manual
# overrides a person sets from the UI.
CREATED_BY = "watering"

# A watering run is a short burst. Anything longer is a scheduling job, not a
# button press, and an unbounded value here is exactly the failure being fixed.
MAX_MINUTES = 60

# Tracks in-flight runs so a second press does not stack a second timer on the
# same pump. Keyed by entity_id.
_runs: dict[str, asyncio.Task] = {}


def clamp_minutes(minutes) -> int:
    """Coerce a requested duration into a sane number of minutes."""
    try:
        value = int(minutes)
    except (TypeError, ValueError):
        return 1
    return max(1, min(MAX_MINUTES, value))


async def _log(tent_id: str, notes: str, event_type: str = "watering"):
    try:
        async with async_session() as session:
            session.add(Event(tent_id=tent_id, event_type=event_type, notes=notes))
            await session.commit()
    except Exception as e:
        logger.error(f"Failed to log watering event for {tent_id}: {e}")


async def _record_run(tent_id: str, entity_id: str, ends_at: datetime):
    """Persist the run so a restart can find a pump that is still on."""
    try:
        async with async_session() as session:
            await session.execute(
                delete(Override).where(
                    and_(Override.entity_id == entity_id, Override.created_by == CREATED_BY)
                )
            )
            session.add(Override(
                tent_id=tent_id,
                entity_id=entity_id,
                override_state="on",
                expires_at=ends_at,
                created_by=CREATED_BY,
            ))
            await session.commit()
    except Exception as e:
        logger.error(f"Failed to record watering run for {entity_id}: {e}")


async def _clear_run(entity_id: str):
    try:
        async with async_session() as session:
            await session.execute(
                delete(Override).where(
                    and_(Override.entity_id == entity_id, Override.created_by == CREATED_BY)
                )
            )
            await session.commit()
    except Exception as e:
        logger.error(f"Failed to clear watering run for {entity_id}: {e}")


async def _run(ha_client, tent_id: str, entity_id: str, minutes: int):
    """Wait out the run, then stop the pump whatever happened in between."""
    try:
        await asyncio.sleep(minutes * 60)
    except asyncio.CancelledError:
        # Cancelled means shutdown or a replacement run; still stop the pump.
        pass
    finally:
        try:
            await ha_client.turn_off(entity_id)
            await _log(tent_id, f"Watering finished: turned OFF {entity_id} after {minutes} min")
        except Exception as e:
            logger.error(f"Failed to stop watering on {entity_id}: {e}")
            await _log(
                tent_id,
                f"Watering FAILED to stop {entity_id} after {minutes} min: {e}",
                event_type="alert",
            )
        finally:
            await _clear_run(entity_id)
            _runs.pop(entity_id, None)


async def start(ha_client, tent_id: str, entity_id: str, minutes) -> int:
    """Turn a pump on and guarantee something turns it back off.

    Returns the duration actually used, in minutes.
    """
    minutes = clamp_minutes(minutes)

    existing = _runs.pop(entity_id, None)
    if existing and not existing.done():
        existing.cancel()  # its finally block stops the pump; a fresh timer follows

    await ha_client.turn_on(entity_id)
    ends_at = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    await _record_run(tent_id, entity_id, ends_at)
    await _log(tent_id, f"Watering started: turned ON {entity_id} for {minutes} min")

    _runs[entity_id] = asyncio.create_task(_run(ha_client, tent_id, entity_id, minutes))
    return minutes


async def recover_stranded(ha_client):
    """Turn off any pump left on by a run whose timer died with the process."""
    try:
        async with async_session() as session:
            result = await session.execute(
                select(Override).where(Override.created_by == CREATED_BY)
            )
            stranded = result.scalars().all()
    except Exception as e:
        logger.error(f"Failed to look up stranded watering runs: {e}")
        return

    for override in stranded:
        try:
            await ha_client.turn_off(override.entity_id)
            logger.warning(f"Stopped stranded watering run on {override.entity_id}")
            await _log(
                override.tent_id,
                f"Watering recovered on startup: turned OFF {override.entity_id}",
            )
        except Exception as e:
            logger.error(f"Failed to stop stranded pump {override.entity_id}: {e}")
        await _clear_run(override.entity_id)


async def stop_all():
    """Cancel in-flight runs at shutdown; each one stops its own pump."""
    for entity_id, task in list(_runs.items()):
        if not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        _runs.pop(entity_id, None)
