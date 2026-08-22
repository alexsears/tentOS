"""Tests for the tent history and export routes.

Two bugs these cover:
  - VPD points were emitted with a truncated timestamp, so the series lost its
    UTC offset and every browser drew it shifted by the viewer's offset.
  - Export called the history handler directly without the optional query
    params, so FastAPI's Query defaults reached datetime parsing and every
    export returned a 500.
"""
import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))

from routes.reports import export_data, get_history  # noqa: E402


def iso(minutes_ago, second=0):
    stamp = datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)
    return stamp.replace(second=second, microsecond=0).isoformat()


class FakeHAClient:
    """Returns one temperature and one humidity reading per requested minute."""

    def __init__(self, stamps):
        self.stamps = stamps

    async def get_history(self, entity_ids, start_time, end_time=None):
        series = []
        for entity_id in entity_ids:
            if "temp" in entity_id:
                series.append([
                    {"entity_id": entity_id, "state": "24.0", "last_changed": s}
                    for s in self.stamps
                ])
            elif "hum" in entity_id:
                series.append([
                    {"entity_id": entity_id, "state": "60.0", "last_changed": s}
                    for s in self.stamps
                ])
            else:
                series.append([])
        return series


class FakeTent:
    def __init__(self):
        self.config = SimpleNamespace(
            name="Flower",
            sensors={
                "temperature": ["sensor.flower_temp"],
                "humidity": ["sensor.flower_hum"],
            },
        )
        self.slot_to_entity = {}


def make_request(stamps):
    tent = FakeTent()
    state_manager = SimpleNamespace(get_tent=lambda tent_id: tent, tents={"flower": tent})
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(
        ha_client=FakeHAClient(stamps),
        state_manager=state_manager,
    )))


def call_history(stamps, **kwargs):
    params = dict(
        tent_id="flower",
        request=make_request(stamps),
        sensors="temperature,humidity,vpd",
        range="24h",
        from_time=None,
        to_time=None,
        max_points=500,
    )
    params.update(kwargs)
    return asyncio.run(get_history(**params))


def test_vpd_points_keep_their_timezone():
    stamps = [iso(30), iso(20), iso(10)]

    result = call_history(stamps)

    vpd = result["data"]["vpd"]
    assert vpd, "expected a VPD series"
    for point in vpd:
        # A naive timestamp is read as local time by the browser, which is the
        # bug: every VPD point must carry an explicit offset.
        parsed = datetime.fromisoformat(point["timestamp"])
        assert parsed.tzinfo is not None, point["timestamp"]


def test_vpd_shares_the_timestamps_of_the_readings_it_came_from():
    stamps = [iso(30), iso(20), iso(10)]

    result = call_history(stamps)

    temp_stamps = {p["timestamp"] for p in result["data"]["temperature"]}
    vpd_stamps = {p["timestamp"] for p in result["data"]["vpd"]}
    assert vpd_stamps <= temp_stamps


def test_vpd_series_is_ordered():
    stamps = [iso(10), iso(30), iso(20)]

    result = call_history(stamps)

    vpd_stamps = [p["timestamp"] for p in result["data"]["vpd"]]
    assert vpd_stamps == sorted(vpd_stamps)


def test_csv_export_returns_data_rather_than_a_500():
    stamps = [iso(30), iso(20)]

    response = asyncio.run(export_data(
        tent_id="flower",
        request=make_request(stamps),
        format="csv",
        sensors="temperature,humidity,vpd",
        range="24h",
    ))

    body = response.body.decode()
    assert body.splitlines()[0] == "timestamp,sensor_type,value"
    assert "temperature" in body


def test_json_export_returns_data_rather_than_a_500():
    stamps = [iso(30), iso(20)]

    response = asyncio.run(export_data(
        tent_id="flower",
        request=make_request(stamps),
        format="json",
        sensors="temperature,humidity",
        range="24h",
    ))

    assert response is not None
