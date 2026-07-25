"""Per-tent light cycle scheduler.

Enforces the configured photoperiod (veg/flower) by switching the tent's
grow-light entities in Home Assistant. Runs as a background loop next to
the StateManager and respects active manual overrides stored in the DB.

Pure helpers (parse/format/compute/validate/desired state) live at module
level with no heavy imports so tests can import them directly.
"""
import asyncio
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# Allowed photoperiod ranges (hours of light per day) per growth mode
PHOTOPERIOD_BOUNDS = {
    "veg": (12.0, 24.0),
    "flower": (6.0, 12.0),
}

# Common presets: veg 18/6, flower 12/12
PHOTOPERIOD_PRESETS = {
    "veg": 18.0,
    "flower": 12.0,
}

CHECK_INTERVAL_SECONDS = 60


def parse_hhmm(value: str) -> int:
    """Parse 'HH:MM' into minutes since midnight. Raises ValueError."""
    if not value or not isinstance(value, str):
        raise ValueError(f"Invalid time: {value!r}")
    parts = value.split(":")
    if len(parts) < 2:
        raise ValueError(f"Invalid time: {value!r}")
    hour, minute = int(parts[0]), int(parts[1])
    if not (0 <= hour < 24 and 0 <= minute < 60):
        raise ValueError(f"Invalid time: {value!r}")
    return hour * 60 + minute


def format_hhmm(minutes: int) -> str:
    """Format minutes since midnight as 'HH:MM' (wraps past 24h)."""
    minutes = int(minutes) % (24 * 60)
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def compute_off_time(on_time: str, hours: float) -> str:
    """Compute the lights-off time from lights-on time + photoperiod hours."""
    return format_hhmm(parse_hhmm(on_time) + round(hours * 60))


def duration_hours_from_times(on_time: str, off_time: str) -> float:
    """Photoperiod hours between lights-on and lights-off: (off - on) mod 24h.

    Equal times mean the light is on the full 24 hours, never 0.
    Mirrors the frontend day-bar editor logic.
    """
    minutes = (parse_hhmm(off_time) - parse_hhmm(on_time)) % (24 * 60)
    return (minutes or 24 * 60) / 60


LIGHT_CYCLE_AUTOMATION_DESCRIPTION = (
    "Managed by TentOS light cycle. Edits will be overwritten."
)


def light_cycle_automation_ids(tent_id: str) -> tuple[str, str]:
    """Config-entry ids of the backup HA automations for a tent (on, off)."""
    return (
        f"tentos_light_cycle_{tent_id}_on",
        f"tentos_light_cycle_{tent_id}_off",
    )


def build_light_cycle_automations(
    tent_id: str,
    tent_name: str,
    on_time: str,
    off_time: str,
    light_entities: list[str],
) -> list[dict]:
    """Build the pair of backup HA automation configs for a tent's light cycle.

    Pure function. Returns [on_config, off_config]:
    - tentos_light_cycle_<tent_id>_on: time trigger at on_time, turns lights on
    - tentos_light_cycle_<tent_id>_off: time trigger at off_time, turns lights off

    Uses homeassistant.turn_on/turn_off so mixed switch./light. entities work.
    These are a belt-and-suspenders backup: the in-app scheduler is primary and
    self-corrects drift; these fire at the boundaries even if the add-on is down.
    """
    if not light_entities:
        raise ValueError("light_entities must not be empty")
    parse_hhmm(on_time)
    parse_hhmm(off_time)

    # Single entity as plain string, list otherwise (matches flip-to-flower)
    target_ids = light_entities[0] if len(light_entities) == 1 else list(light_entities)
    on_id, off_id = light_cycle_automation_ids(tent_id)

    return [
        {
            "id": on_id,
            "alias": f"{tent_name} Light Cycle On (TentOS)",
            "description": LIGHT_CYCLE_AUTOMATION_DESCRIPTION,
            "mode": "single",
            "trigger": [{"platform": "time", "at": on_time + ":00"}],
            "action": [
                {
                    "service": "homeassistant.turn_on",
                    "target": {"entity_id": target_ids},
                }
            ],
        },
        {
            "id": off_id,
            "alias": f"{tent_name} Light Cycle Off (TentOS)",
            "description": LIGHT_CYCLE_AUTOMATION_DESCRIPTION,
            "mode": "single",
            "trigger": [{"platform": "time", "at": off_time + ":00"}],
            "action": [
                {
                    "service": "homeassistant.turn_off",
                    "target": {"entity_id": target_ids},
                }
            ],
        },
    ]


async def sync_light_cycle_automations(
    ha_client,
    tent_id: str,
    tent_name: str,
    enabled: bool,
    on_time: str,
    off_time: str,
    light_entities: list[str],
):
    """Create/update or delete the backup HA automations for a tent.

    enabled + lights configured: upsert both automations to match the schedule.
    Otherwise: delete both if they exist. Idempotent: existence is checked via
    the HA automation config API (keyed by config id) before choosing
    create vs update / delete vs skip. Raises on write failure.
    """
    on_id, off_id = light_cycle_automation_ids(tent_id)

    if enabled and light_entities:
        configs = build_light_cycle_automations(
            tent_id, tent_name, on_time, off_time, light_entities
        )
        for config in configs:
            existing = await ha_client.get_automation_config(config["id"])
            if existing:
                await ha_client.update_automation(config["id"], config)
                logger.info(f"Updated backup automation {config['id']}")
            else:
                await ha_client.create_automation(config)
                logger.info(f"Created backup automation {config['id']}")
    else:
        for auto_id in (on_id, off_id):
            existing = await ha_client.get_automation_config(auto_id)
            if existing:
                await ha_client.delete_automation(auto_id)
                logger.info(f"Deleted backup automation {auto_id}")


async def log_light_event(tent_id: str, notes: str):
    """Record a light_schedule event in the activity log."""
    try:
        from database import async_session, Event

        async with async_session() as session:
            session.add(Event(
                tent_id=tent_id,
                event_type="light_schedule",
                notes=notes,
                user="tentos",
            ))
            await session.commit()
    except Exception as e:
        logger.warning(f"Failed to log light schedule event: {e}")


def validate_light_cycle(mode: str, hours: float) -> None:
    """Validate mode + photoperiod hours against per-mode bounds.

    veg: 12-24h light/day, flower: 6-12h light/day. Raises ValueError.
    """
    if mode not in PHOTOPERIOD_BOUNDS:
        raise ValueError(f"mode must be one of {sorted(PHOTOPERIOD_BOUNDS)}")
    lo, hi = PHOTOPERIOD_BOUNDS[mode]
    if not (lo <= float(hours) <= hi):
        raise ValueError(
            f"{mode} photoperiod must be between {lo:g} and {hi:g} hours, got {hours:g}"
        )


def desired_light_state(now_minutes: int, on_time: str, hours: float) -> bool:
    """Whether the light should be ON at now_minutes (minutes since local midnight)."""
    hours = float(hours)
    if hours >= 24:
        return True
    if hours <= 0:
        return False
    on_minutes = parse_hhmm(on_time)
    off_minutes = (on_minutes + round(hours * 60)) % (24 * 60)
    if on_minutes < off_minutes:
        return on_minutes <= now_minutes < off_minutes
    # Wraps past midnight (e.g. on 18:00 for 18h -> off 12:00)
    return now_minutes >= on_minutes or now_minutes < off_minutes


class LightScheduler:
    """Background loop that keeps tent lights in sync with their light cycle."""

    def __init__(self, ha_client, state_manager):
        self.ha_client = ha_client
        self.state_manager = state_manager
        self._running = False
        self._task: asyncio.Task | None = None

    async def start(self):
        """Start the scheduler loop."""
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info("Light scheduler started")

    async def stop(self):
        """Stop the scheduler loop."""
        self._running = False
        if self._task:
            self._task.cancel()
            self._task = None

    async def _loop(self):
        while self._running:
            try:
                await self.tick()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Light scheduler tick error: {e}")
            await asyncio.sleep(CHECK_INTERVAL_SECONDS)

    async def tick(self, only_tent_id: str | None = None):
        """Evaluate every tent's light cycle and switch lights that are wrong.

        Uses local wall-clock time (HA add-on containers inherit the host TZ).
        Only issues a command when the actuator's reported state is a definite
        mismatch ('on'/'off'), so unknown/unavailable entities are never spammed.
        Entities with an active manual override are left alone.
        """
        now = datetime.now()
        now_minutes = now.hour * 60 + now.minute

        for tent_id, tent in list(self.state_manager.tents.items()):
            if only_tent_id and tent_id != only_tent_id:
                continue

            schedules = tent.config.schedules or {}
            cycle = schedules.get("light_cycle") or {}
            if not cycle.get("enabled"):
                continue

            on_time = cycle.get("on_time") or schedules.get("photoperiod_on") or "06:00"
            try:
                hours = float(cycle.get("photoperiod_hours"))
                desired = desired_light_state(now_minutes, on_time, hours)
            except (TypeError, ValueError) as e:
                logger.warning(f"Tent {tent_id}: invalid light cycle config: {e}")
                continue

            light_slots = {
                slot: entity_id
                for slot, entity_id in tent.slot_to_entity.items()
                if slot == "light" or slot.startswith("light_")
            }
            if not light_slots:
                continue

            overridden = await self._active_override_entities(
                tent_id, list(light_slots.values())
            )

            for slot, entity_id in light_slots.items():
                if entity_id in overridden:
                    continue
                actual = (tent.actuators.get(slot) or {}).get("state")
                if actual not in ("on", "off"):
                    continue  # unknown/unavailable — don't fight it
                try:
                    if desired and actual == "off":
                        await self.ha_client.turn_on(entity_id)
                        await self._log_event(
                            tent_id,
                            f"Light schedule: turned ON {entity_id} "
                            f"({cycle.get('mode', '?')} {hours:g}h, on at {on_time})"
                        )
                    elif not desired and actual == "on":
                        await self.ha_client.turn_off(entity_id)
                        await self._log_event(
                            tent_id,
                            f"Light schedule: turned OFF {entity_id} "
                            f"({cycle.get('mode', '?')} {hours:g}h, on at {on_time})"
                        )
                except Exception as e:
                    logger.error(f"Tent {tent_id}: failed to switch {entity_id}: {e}")

    async def _active_override_entities(
        self, tent_id: str, entity_ids: list[str]
    ) -> set[str]:
        """Return the subset of entity_ids with an active manual override."""
        try:
            from sqlalchemy import select, and_, or_
            from database import async_session, Override

            async with async_session() as session:
                result = await session.execute(
                    select(Override.entity_id).where(
                        and_(
                            Override.tent_id == tent_id,
                            Override.entity_id.in_(entity_ids),
                            or_(
                                Override.expires_at.is_(None),
                                Override.expires_at > datetime.now(timezone.utc),
                            ),
                        )
                    )
                )
                return {row[0] for row in result.all()}
        except Exception as e:
            logger.warning(f"Override lookup failed for {tent_id}: {e}")
            return set()

    async def _log_event(self, tent_id: str, notes: str):
        """Record a light_schedule event in the activity log."""
        await log_light_event(tent_id, notes)
