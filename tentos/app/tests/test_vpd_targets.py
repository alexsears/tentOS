"""The humidity window a VPD band implies, and publishing it to Home Assistant."""
import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))

from state_manager import calculate_vpd  # noqa: E402
from vpd_targets import (  # noqa: E402
    RH_CEILING_LIMIT,
    VpdTargetPublisher,
    helper_ids,
    humidity_window,
    rh_for_vpd,
)


class TestInverse:
    def test_rh_for_vpd_round_trips_through_the_vpd_calc(self):
        """The inverse must land back on the band it was asked for."""
        for temp in (20.0, 24.0, 28.0, 32.9):
            for target in (0.8, 1.0, 1.2):
                rh = rh_for_vpd(temp, target)
                assert abs(calculate_vpd(temp, rh) - target) <= 0.01

    def test_more_humidity_means_less_vpd(self):
        assert rh_for_vpd(25, 0.8) > rh_for_vpd(25, 1.2)

    def test_a_hotter_tent_needs_more_humidity_for_the_same_vpd(self):
        assert rh_for_vpd(33, 1.0) > rh_for_vpd(25, 1.0)


class TestWindow:
    def test_mother_flower_band_at_its_running_temperature(self):
        """0.8-1.0 kPa at 32.9 C is reachable, and well under the mould line.

        Read as AIR VPD this band looked like it needed 80%+ RH and was dismissed
        as impossible. As leaf VPD it is 70-72%.
        """
        floor, target = humidity_window(32.9, 0.8, 1.0)
        assert (floor, target) == (69.9, 73.9) or (69 <= floor <= 71 and 72 <= target <= 75)
        assert target <= RH_CEILING_LIMIT

    def test_floor_is_drier_than_target(self):
        floor, target = humidity_window(26.0, 0.8, 1.0)
        assert floor < target

    def test_band_order_does_not_matter(self):
        assert humidity_window(26.0, 1.0, 0.8) == humidity_window(26.0, 0.8, 1.0)

    def test_never_asks_for_more_than_the_mould_line(self):
        """A very hot tent cannot be humidified into its band; clamp, never exceed."""
        floor, target = humidity_window(40.0, 0.8, 1.0)
        assert target <= RH_CEILING_LIMIT
        assert floor <= RH_CEILING_LIMIT


class FakeClient:
    def __init__(self, existing=()):
        self.existing = set(existing)
        self.calls = []

    async def get_state(self, entity_id):
        return {"entity_id": entity_id, "state": "50"} if entity_id in self.existing else None

    async def call_service(self, domain, service, data=None, target=None):
        self.calls.append((domain, service, data))
        return {}


def tent(temp=32.9, band={"min": 0.8, "max": 1.0}):
    return SimpleNamespace(
        growth_stage={"stage": "flower", "vpd_target": band} if band else {},
        sensors={"temperature": {"value": temp, "unit": "C"}},
    )


def run(publisher):
    asyncio.run(publisher.tick())


class TestPublisher:
    def test_writes_both_helpers_when_they_exist(self):
        client = FakeClient(helper_ids("mother"))
        sm = SimpleNamespace(tents={"mother": tent()})
        run(VpdTargetPublisher(client, sm))

        assert [c[2]["entity_id"] for c in client.calls] == list(helper_ids("mother"))
        assert all(c[:2] == ("input_number", "set_value") for c in client.calls)
        floor, target = (c[2]["value"] for c in client.calls)
        assert floor < target

    def test_inert_until_the_helpers_are_created(self):
        """Shipping this must not change a tent that has no helpers."""
        client = FakeClient()
        sm = SimpleNamespace(tents={"mother": tent()})
        run(VpdTargetPublisher(client, sm))
        assert client.calls == []

    def test_skips_a_tent_with_no_band_or_no_reading(self):
        client = FakeClient(helper_ids("mother"))
        sm = SimpleNamespace(tents={"mother": tent(band=None)})
        run(VpdTargetPublisher(client, sm))
        assert client.calls == []

        sm = SimpleNamespace(tents={"mother": SimpleNamespace(
            growth_stage={"vpd_target": {"min": 0.8, "max": 1.0}}, sensors={})})
        run(VpdTargetPublisher(client, sm))
        assert client.calls == []

    def test_does_not_rewrite_an_unchanged_window(self):
        client = FakeClient(helper_ids("mother"))
        sm = SimpleNamespace(tents={"mother": tent()})
        publisher = VpdTargetPublisher(client, sm)
        run(publisher)
        first = len(client.calls)
        run(publisher)
        assert len(client.calls) == first

    def test_follows_the_tent_when_temperature_moves(self):
        client = FakeClient(helper_ids("mother"))
        t = tent(temp=26.0)
        sm = SimpleNamespace(tents={"mother": t})
        publisher = VpdTargetPublisher(client, sm)
        run(publisher)
        cool = [c[2]["value"] for c in client.calls]

        client.calls.clear()
        t.sensors["temperature"]["value"] = 33.0
        run(publisher)
        hot = [c[2]["value"] for c in client.calls]

        assert hot and hot[0] > cool[0]      # a hotter tent needs more humidity

    def test_fahrenheit_readings_are_converted(self):
        client_c = FakeClient(helper_ids("mother"))
        run(VpdTargetPublisher(client_c, SimpleNamespace(tents={"mother": tent(temp=26.0)})))

        client_f = FakeClient(helper_ids("mother"))
        run(VpdTargetPublisher(client_f, SimpleNamespace(tents={"mother": tent(temp=78.8)})))

        assert [c[2]["value"] for c in client_f.calls] == [c[2]["value"] for c in client_c.calls]
