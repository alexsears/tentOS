"""Stored history timestamps must go out as explicit UTC.

Rows are written with datetime.now(timezone.utc), but SQLite drops the offset,
so a bare isoformat() came back naive and browsers read it as local time. The
tent detail charts were an offset out because of it.
"""
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))

from routes.tents import iso_utc  # noqa: E402


def test_naive_stored_timestamp_is_tagged_utc():
    stored = datetime(2026, 8, 22, 18, 19, 50)  # what SQLite hands back

    out = iso_utc(stored)

    parsed = datetime.fromisoformat(out)
    assert parsed.tzinfo is not None
    assert parsed.utcoffset().total_seconds() == 0
    assert parsed.hour == 18 and parsed.minute == 19


def test_aware_timestamp_is_left_alone():
    stored = datetime(2026, 8, 22, 18, 19, 50, tzinfo=timezone.utc)

    assert datetime.fromisoformat(iso_utc(stored)) == stored
