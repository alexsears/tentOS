"""Publish the humidity window a tent's VPD band implies, for HA to act on.

A VPD band is not a humidity setpoint: the RH that satisfies it moves with
temperature. Hand-written Home Assistant automations therefore carry fixed RH
numbers that were right for one temperature and drift out of the band as the
tent warms. Mother ran a 60-68% dry-back written for a veg tent and, once
flipped to flower, needed 70-72% at its own running temperature to sit inside
the 0.8-1.0 kPa flower band.

This module recomputes that window every tick from the live temperature and
writes it into two per-tent input_number helpers. The automation reads the
helpers instead of literals, so the setpoints follow the tent.

It is inert until those helpers exist. A tent with no helpers, no VPD band or
no live temperature is skipped silently, so shipping this changes nothing until
the helpers are deliberately created.
"""
import asyncio
import logging
import math

logger = logging.getLogger(__name__)

CHECK_INTERVAL_SECONDS = 60

# Never drive a tent outside this, whatever the band asks for. The upper bound
# is the mould line: no grow tent should be pushed past it to satisfy a number.
RH_FLOOR_LIMIT = 35.0
RH_CEILING_LIMIT = 75.0


def svp(temp_c: float) -> float:
    """Saturation vapour pressure in kPa (Tetens)."""
    return 0.6108 * math.exp((17.27 * temp_c) / (temp_c + 237.3))


def rh_for_vpd(temp_c: float, vpd_kpa: float, leaf_offset_c: float = 2.0) -> float:
    """Relative humidity that yields this leaf VPD at this air temperature.

    The inverse of calculate_vpd: VPD = SVP(leaf) - SVP(air) * RH/100, so
    RH = (SVP(leaf) - VPD) / SVP(air) * 100. Result is clamped to 0-100; callers
    clamp again to their own safe operating range.
    """
    svp_air = svp(temp_c)
    if svp_air <= 0:
        return 0.0
    rh = (svp(temp_c - leaf_offset_c) - float(vpd_kpa)) / svp_air * 100.0
    return max(0.0, min(100.0, rh))


def humidity_window(temp_c: float, vpd_min: float, vpd_max: float) -> tuple[float, float]:
    """The (floor, target) RH pair for a VPD band at this temperature.

    Higher humidity means lower VPD, so the DRIEST allowed VPD (vpd_max) gives
    the humidity FLOOR, below which the tent is too dry, and the most humid
    allowed VPD (vpd_min) gives the target to stop at. Both are clamped to the
    safe operating range, which can collapse the window at extreme temperatures;
    callers must treat floor >= target as "band unreachable here".
    """
    floor = rh_for_vpd(temp_c, max(vpd_min, vpd_max))
    target = rh_for_vpd(temp_c, min(vpd_min, vpd_max))
    clamp = lambda v: round(max(RH_FLOOR_LIMIT, min(RH_CEILING_LIMIT, v)), 1)
    return clamp(floor), clamp(target)


def helper_ids(tent_id: str) -> tuple[str, str]:
    """Entity ids of the (floor, target) helpers for a tent."""
    return (
        f"input_number.tentos_{tent_id}_rh_floor",
        f"input_number.tentos_{tent_id}_rh_target",
    )


class VpdTargetPublisher:
    """Background loop writing each tent's humidity window into HA helpers."""

    def __init__(self, ha_client, state_manager):
        self.ha_client = ha_client
        self.state_manager = state_manager
        self._running = False
        self._task: asyncio.Task | None = None
        self._last: dict[str, tuple[float, float]] = {}

    async def start(self):
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info("VPD target publisher started")

    async def stop(self):
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
                logger.error(f"VPD target publisher tick error: {e}")
            await asyncio.sleep(CHECK_INTERVAL_SECONDS)

    async def tick(self, only_tent_id: str | None = None):
        for tent_id, tent in list(self.state_manager.tents.items()):
            if only_tent_id and tent_id != only_tent_id:
                continue
            try:
                await self._publish(tent_id, tent)
            except Exception as e:
                logger.warning(f"Tent {tent_id}: could not publish VPD window: {e}")

    async def _publish(self, tent_id, tent):
        band = ((tent.growth_stage or {}).get("vpd_target")) if hasattr(tent, "growth_stage") else None
        if not band:
            return
        vpd_min, vpd_max = band.get("min"), band.get("max")
        if vpd_min is None or vpd_max is None:
            return

        reading = (tent.sensors or {}).get("temperature") or {}
        temp_c = reading.get("value")
        if temp_c is None:
            return
        if temp_c > 50:                     # same Fahrenheit heuristic as the VPD calc
            temp_c = (float(temp_c) - 32) * 5.0 / 9.0

        floor, target = humidity_window(float(temp_c), float(vpd_min), float(vpd_max))
        if self._last.get(tent_id) == (floor, target):
            return                          # nothing moved, do not spam the bus

        floor_id, target_id = helper_ids(tent_id)
        for entity_id, value in ((floor_id, floor), (target_id, target)):
            if not await self._helper_exists(entity_id):
                return                      # helpers not created for this tent yet
            await self.ha_client.call_service(
                "input_number", "set_value",
                {"entity_id": entity_id, "value": value},
            )
        self._last[tent_id] = (floor, target)
        logger.info(f"Tent {tent_id}: humidity window {floor}-{target}% at {temp_c:.1f}C")

    async def _helper_exists(self, entity_id: str) -> bool:
        state = await self.ha_client.get_state(entity_id)
        return bool(state) and state.get("state") not in (None, "unavailable", "unknown")
