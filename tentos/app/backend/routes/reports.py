"""Reports and history API routes - pulls from Home Assistant history."""
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, HTTPException, Request, Query
from fastapi.responses import Response

from state_manager import fahrenheit_to_celsius, is_temperature_sensor_type

logger = logging.getLogger(__name__)
router = APIRouter()


def downsample_data(data: list, max_points: int = 500) -> list:
    """Downsample data to max_points using bucket averaging."""
    if len(data) <= max_points:
        return data

    bucket_size = len(data) // max_points
    result = []

    for i in range(0, len(data), bucket_size):
        bucket = data[i:i + bucket_size]
        if bucket:
            values = [p["value"] for p in bucket if p.get("value") is not None]
            if values:
                avg_value = sum(values) / len(values)
                min_value = min(values)
                max_value = max(values)
                mid_idx = len(bucket) // 2
                result.append({
                    "timestamp": bucket[mid_idx]["timestamp"],
                    "value": round(avg_value, 2),
                    "min": round(min_value, 2),
                    "max": round(max_value, 2)
                })

    return result


def get_entity_ids_for_sensor(tent, sensor_type: str) -> list[str]:
    """Get all entity IDs for a sensor type from tent config."""
    entity_ids = tent.config.sensors.get(sensor_type)
    if not entity_ids:
        return []
    if isinstance(entity_ids, list):
        return [e for e in entity_ids if e]
    return [entity_ids] if entity_ids else []


def get_light_entity_ids(tent) -> list[str]:
    """Get all light entity IDs from tent expanded slot mapping."""
    entities = []
    for slot, entity_id in tent.slot_to_entity.items():
        if slot == "light" or slot.startswith("light_"):
            entities.append(entity_id)
    return entities


def _parse_ts(value: str):
    """ISO timestamp -> aware datetime, or None when it will not parse."""
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def extract_light_periods(history_data: list, start_time=None, end_time=None) -> list[dict]:
    """Convert one entity's HA state history into on periods for the chart shading.

    The window bounds clamp the periods: HA reports the state at the start of the
    window as its first row, so a light that was already on shades from the window
    start, and a light still on at the end shades right up to the window end.
    """
    if not history_data:
        return []

    end_time = end_time or datetime.now(timezone.utc)
    periods = []
    current_start = None

    for state in sorted(history_data, key=lambda x: x.get("last_changed") or x.get("last_updated") or ""):
        timestamp = _parse_ts(state.get("last_changed") or state.get("last_updated"))
        if timestamp is None:
            continue
        if start_time is not None and timestamp < start_time:
            timestamp = start_time
        raw = str(state.get("state") or "").lower()
        if raw in ("unavailable", "unknown", ""):
            # A dropout is not a switch-off; keep whatever the light was doing
            continue
        is_on = raw in ON_STATES

        if is_on and current_start is None:
            current_start = timestamp
        elif not is_on and current_start is not None:
            if timestamp > current_start:
                periods.append({"start": current_start, "end": timestamp})
            current_start = None

    if current_start is not None and end_time > current_start:
        periods.append({"start": current_start, "end": end_time})

    return periods


def merge_light_periods(periods: list[dict]) -> list[dict]:
    """Union overlapping on periods (a tent with two lights shades once, not twice)."""
    ordered = sorted((p for p in periods if p.get("start") and p.get("end")), key=lambda p: p["start"])
    merged: list[dict] = []
    for period in ordered:
        if merged and period["start"] <= merged[-1]["end"]:
            if period["end"] > merged[-1]["end"]:
                merged[-1]["end"] = period["end"]
        else:
            merged.append({"start": period["start"], "end": period["end"]})
    return merged


async def fetch_light_periods(ha_client, light_entities: list[str], start_time, end_time) -> list[dict]:
    """On periods for a tent's lights across the window, as ISO strings.

    Every light entity is queried; their periods are unioned so a two-light tent
    gives one band per photoperiod. A light with no recorded history in the window
    (never toggled, recorder excluded it) falls back to its current state, so a
    light that is simply on all day still shades the whole chart.
    """
    entities = [e for e in (light_entities or []) if e]
    if not entities:
        return []

    by_entity: dict[str, list] = {e: [] for e in entities}
    try:
        history = await ha_client.get_history(entities, start_time.isoformat(), end_time.isoformat())
    except Exception as e:
        logger.error(f"Failed to get light history for {entities}: {e}")
        history = []

    for entity_history in history or []:
        if not entity_history:
            continue
        entity_id = entity_history[0].get("entity_id")
        if entity_id in by_entity:
            by_entity[entity_id] = entity_history

    periods: list[dict] = []
    for entity_id, entity_history in by_entity.items():
        if entity_history:
            periods.extend(extract_light_periods(entity_history, start_time, end_time))
            continue
        # No rows: use the live state for the whole window
        try:
            current = await ha_client.get_state(entity_id)
        except Exception:
            current = None
        raw = str((current or {}).get("state") or "").lower()
        if raw in ON_STATES:
            periods.append({"start": start_time, "end": end_time})

    return [
        {"start": p["start"].isoformat(), "end": p["end"].isoformat()}
        for p in merge_light_periods(periods)
    ]


RANGE_MAP = {
    "1h": timedelta(hours=1),
    "6h": timedelta(hours=6),
    "12h": timedelta(hours=12),
    "24h": timedelta(hours=24),
    "3d": timedelta(days=3),
    "7d": timedelta(days=7),
    "14d": timedelta(days=14),
    "30d": timedelta(days=30),
    "90d": timedelta(days=90),
}

# States that count as "on" when graphing a switch/binary entity as a step chart
ON_STATES = {"on", "true", "1", "open", "home", "playing", "heat", "cool", "dry", "fan_only", "auto"}


def _resolve_window(range: str, from_time: Optional[str], to_time: Optional[str]):
    """Resolve a (start, end) UTC window from either a named range or explicit bounds."""
    now = datetime.now(timezone.utc)
    if from_time and to_time:
        try:
            start = datetime.fromisoformat(from_time.replace("Z", "+00:00"))
            end = datetime.fromisoformat(to_time.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format")
        return start, end
    return now - RANGE_MAP.get(range, timedelta(hours=24)), now


@router.get("/entity-history")
async def get_entity_history(
    request: Request,
    entity_id: str = Query(..., description="Any Home Assistant entity ID"),
    range: str = Query(default="24h", description="Time range: 1h, 6h, 12h, 24h, 3d, 7d, 14d, 30d, 90d"),
    from_time: Optional[str] = Query(default=None, description="Custom start time (ISO format)"),
    to_time: Optional[str] = Query(default=None, description="Custom end time (ISO format)"),
    max_points: int = Query(default=500, description="Max data points"),
):
    """Get history for any single HA entity, numeric or on/off.

    Powers click-through from a reading anywhere in the UI to its graph on Reports.
    Unlike /history/{tent_id} this is not limited to configured tent sensor slots.
    """
    ha_client = request.app.state.ha_client
    start_time, end_time = _resolve_window(range, from_time, to_time)

    try:
        ha_history = await ha_client.get_history(
            [entity_id], start_time.isoformat(), end_time.isoformat()
        )
    except Exception as e:
        logger.error(f"Failed to get entity history for {entity_id}: {e}")
        raise HTTPException(status_code=502, detail="Home Assistant history unavailable")

    entity_history = ha_history[0] if ha_history else []

    # Current state gives us the friendly name / unit even when history is empty
    friendly_name = entity_id
    unit = None
    device_class = None
    try:
        current = await ha_client.get_state(entity_id)
        if current:
            attrs = current.get("attributes", {}) or {}
            friendly_name = attrs.get("friendly_name") or entity_id
            unit = attrs.get("unit_of_measurement")
            device_class = attrs.get("device_class")
    except Exception:
        pass

    numeric = []
    states = []
    non_numeric = 0

    for state in entity_history:
        timestamp = state.get("last_changed") or state.get("last_updated")
        raw = state.get("state")
        if not timestamp:
            continue
        if unit is None:
            unit = (state.get("attributes", {}) or {}).get("unit_of_measurement") or unit
        if raw in ("unavailable", "unknown", None, ""):
            states.append({"timestamp": timestamp, "state": raw or "unknown", "on": None})
            continue
        try:
            numeric.append({"timestamp": timestamp, "value": round(float(raw), 2)})
        except (ValueError, TypeError):
            non_numeric += 1
            states.append({
                "timestamp": timestamp,
                "state": raw,
                "on": str(raw).lower() in ON_STATES,
            })

    # A trailing point at "now" keeps step charts from ending mid-window
    kind = "numeric" if len(numeric) >= non_numeric and numeric else ("state" if states else "empty")

    stats = None
    if kind == "numeric":
        numeric.sort(key=lambda x: x["timestamp"])
        if len(numeric) > max_points:
            numeric = downsample_data(numeric, max_points)
        values = [p["value"] for p in numeric]
        if values:
            stats = {
                "min": round(min(values), 2),
                "max": round(max(values), 2),
                "avg": round(sum(values) / len(values), 2),
                "current": values[-1],
                "points": len(numeric),
            }
    elif kind == "state":
        states.sort(key=lambda x: x["timestamp"])
        on_states = [s for s in states if s.get("on") is not None]
        stats = {
            "changes": len(on_states),
            "current": states[-1]["state"] if states else None,
            "points": len(states),
        }
        # Duty cycle: how much of the window this entity spent on
        if on_states:
            on_seconds = 0.0
            for i, entry in enumerate(on_states):
                try:
                    t0 = datetime.fromisoformat(entry["timestamp"].replace("Z", "+00:00"))
                except ValueError:
                    continue
                if i + 1 < len(on_states):
                    try:
                        t1 = datetime.fromisoformat(on_states[i + 1]["timestamp"].replace("Z", "+00:00"))
                    except ValueError:
                        continue
                else:
                    t1 = end_time
                if entry["on"]:
                    on_seconds += max(0.0, (t1 - t0).total_seconds())
            window = max(1.0, (end_time - start_time).total_seconds())
            stats["on_percent"] = round(100 * on_seconds / window, 1)
            stats["on_hours"] = round(on_seconds / 3600, 2)

    # Lights-on shading: if this entity belongs to a tent, shade that tent's photoperiod
    light_entities: list[str] = []
    state_manager = getattr(request.app.state, "state_manager", None)
    if state_manager is not None:
        membership = getattr(state_manager, "entity_to_tent", {}).get(entity_id)
        if membership:
            tent = state_manager.get_tent(membership[0])
            if tent:
                light_entities = get_light_entity_ids(tent)
    light_periods = await fetch_light_periods(ha_client, light_entities, start_time, end_time)

    return {
        "entity_id": entity_id,
        "friendly_name": friendly_name,
        "unit": unit,
        "device_class": device_class,
        "kind": kind,
        "range": range,
        "from": start_time.isoformat(),
        "to": end_time.isoformat(),
        "data": numeric if kind == "numeric" else [],
        "states": states if kind == "state" else [],
        "stats": stats,
        "light_entities": light_entities,
        "light_periods": light_periods,
        "source": "home_assistant",
    }


@router.get("/history/{tent_id}")
async def get_history(
    tent_id: str,
    request: Request,
    sensors: str = Query(default="temperature,humidity,vpd", description="Comma-separated sensor types"),
    range: str = Query(default="24h", description="Time range: 1h, 6h, 24h, 7d, 30d, 90d"),
    from_time: Optional[str] = Query(default=None, description="Custom start time (ISO format)"),
    to_time: Optional[str] = Query(default=None, description="Custom end time (ISO format)"),
    max_points: int = Query(default=500, description="Max data points per sensor")
):
    """Get historical sensor data from Home Assistant."""
    state_manager = request.app.state.state_manager
    ha_client = request.app.state.ha_client
    tent = state_manager.get_tent(tent_id)

    if not tent:
        raise HTTPException(status_code=404, detail="Tent not found")

    # Parse time range
    now = datetime.now(timezone.utc)

    if from_time and to_time:
        try:
            start_time = datetime.fromisoformat(from_time.replace('Z', '+00:00'))
            end_time = datetime.fromisoformat(to_time.replace('Z', '+00:00'))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format")
    else:
        range_map = {
            "1h": timedelta(hours=1),
            "6h": timedelta(hours=6),
            "12h": timedelta(hours=12),
            "24h": timedelta(hours=24),
            "3d": timedelta(days=3),
            "7d": timedelta(days=7),
            "14d": timedelta(days=14),
            "30d": timedelta(days=30),
            "90d": timedelta(days=90)
        }
        delta = range_map.get(range, timedelta(hours=24))
        start_time = now - delta
        end_time = now

    sensor_list = [s.strip() for s in sensors.split(",")]
    result_data = {}
    stats = {}

    # VPD is calculated from temp + humidity, so ensure both are fetched
    fetch_list = list(sensor_list)
    if "vpd" in fetch_list:
        if "temperature" not in fetch_list:
            fetch_list.append("temperature")
        if "humidity" not in fetch_list:
            fetch_list.append("humidity")

    # Collect all entity IDs we need to query
    entity_map = {}  # entity_id -> sensor_type
    for sensor_type in fetch_list:
        if sensor_type == "vpd":
            continue  # VPD is calculated, not a direct sensor
        entity_ids = get_entity_ids_for_sensor(tent, sensor_type)
        for eid in entity_ids:
            entity_map[eid] = sensor_type

    if entity_map:
        # Query HA history API
        try:
            ha_history = await ha_client.get_history(
                list(entity_map.keys()),
                start_time.isoformat(),
                end_time.isoformat()
            )

            # Process HA history response - it's a list of lists, one per entity
            for entity_history in ha_history:
                if not entity_history:
                    continue

                entity_id = entity_history[0].get("entity_id") if entity_history else None
                if not entity_id or entity_id not in entity_map:
                    continue

                sensor_type = entity_map[entity_id]

                # Convert to our format
                is_temp = is_temperature_sensor_type(sensor_type)
                data = []
                for state in entity_history:
                    try:
                        value = float(state.get("state", 0))
                        timestamp = state.get("last_changed") or state.get("last_updated")
                        if timestamp and value is not None:
                            if is_temp:
                                unit = (state.get("attributes") or {}).get("unit_of_measurement")
                                # Same rule the state manager uses: trust the unit
                                # attribute, and fall back to the fact that a grow
                                # tent is never above 50 C
                                if (unit and "f" in unit.lower()) or (not unit and value > 50):
                                    value = fahrenheit_to_celsius(value)
                            data.append({
                                "timestamp": timestamp,
                                "value": round(value, 2)
                            })
                    except (ValueError, TypeError):
                        continue  # Skip non-numeric states

                if data:
                    # If we already have data for this sensor type, merge it
                    if sensor_type in result_data:
                        result_data[sensor_type].extend(data)
                    else:
                        result_data[sensor_type] = data

        except Exception as e:
            logger.error(f"Failed to get HA history: {e}")

    # Sort and downsample each sensor's data
    for sensor_type in result_data:
        result_data[sensor_type].sort(key=lambda x: x["timestamp"])
        if len(result_data[sensor_type]) > max_points:
            result_data[sensor_type] = downsample_data(result_data[sensor_type], max_points)

    # Calculate VPD from temperature and humidity if both available
    if "vpd" in sensor_list and "temperature" in result_data and "humidity" in result_data:
        import math
        vpd_data = []
        # Temperature and humidity are sampled independently, so they are paired
        # on the minute. The full timestamp is carried through: emitting the
        # truncated key dropped the UTC offset and every viewer's browser then
        # read the VPD series as local time, shifting it by their offset.
        temp_data = {}
        for d in result_data.get("temperature", []):
            temp_data[d["timestamp"][:16]] = (d["value"], d["timestamp"])
        hum_data = {d["timestamp"][:16]: d["value"] for d in result_data.get("humidity", [])}

        for ts, (temp, full_ts) in temp_data.items():
            if ts in hum_data:
                humidity = hum_data[ts]
                # VPD calculation (temp in Celsius)
                temp_c = temp if temp < 50 else (temp - 32) * 5/9
                svp = 0.6108 * math.exp((17.27 * temp_c) / (temp_c + 237.3))
                vpd = svp * (1 - humidity / 100)
                vpd_data.append({
                    "timestamp": full_ts,
                    "value": round(vpd, 2)
                })

        vpd_data.sort(key=lambda p: p["timestamp"])

        if vpd_data:
            result_data["vpd"] = vpd_data

    # Calculate statistics
    for sensor_type, data in result_data.items():
        if data:
            values = [p["value"] for p in data if p.get("value") is not None]
            if values:
                stats[sensor_type] = {
                    "min": round(min(values), 2),
                    "max": round(max(values), 2),
                    "avg": round(sum(values) / len(values), 2),
                    "current": round(values[-1], 2) if values else None,
                    "points": len(data)
                }

    # Remove helper sensors that were only fetched for VPD calculation
    for extra in ("temperature", "humidity"):
        if extra not in sensor_list and extra in result_data:
            del result_data[extra]
        if extra not in sensor_list and extra in stats:
            del stats[extra]

    # Lights-on periods for the chart shading, merged across every light in the tent
    light_entities = get_light_entity_ids(tent)
    light_periods = await fetch_light_periods(ha_client, light_entities, start_time, end_time)

    units = {}
    for sensor_type in result_data:
        if is_temperature_sensor_type(sensor_type):
            units[sensor_type] = "°C"
        elif sensor_type == "humidity":
            units[sensor_type] = "%"
        elif sensor_type == "vpd":
            units[sensor_type] = "kPa"
        elif sensor_type == "co2":
            units[sensor_type] = "ppm"

    return {
        "tent_id": tent_id,
        "tent_name": tent.config.name,
        "range": range,
        "units": units,
        "from": start_time.isoformat(),
        "to": end_time.isoformat(),
        "data": result_data,
        "stats": stats,
        "light_entities": light_entities,
        "light_periods": light_periods,
        "source": "home_assistant"
    }


@router.get("/export/{tent_id}")
async def export_data(
    tent_id: str,
    request: Request,
    format: str = Query(default="csv", description="Export format: csv or json"),
    sensors: str = Query(default="temperature,humidity,vpd"),
    range: str = Query(default="7d")
):
    """Export historical data from Home Assistant."""
    # Use the history endpoint to get data
    history = await get_history(
        tent_id=tent_id,
        request=request,
        sensors=sensors,
        range=range,
        from_time=None,   # calling the handler directly means the Query()
        to_time=None,     # defaults are objects, not None
        max_points=10000  # Higher limit for export
    )

    if format == "csv":
        lines = ["timestamp,sensor_type,value"]
        for sensor_type, data in history["data"].items():
            for point in data:
                lines.append(f"{point['timestamp']},{sensor_type},{point['value']}")

        content = "\n".join(lines)
        filename = f"{tent_id}_{range}_{datetime.now().strftime('%Y%m%d')}.csv"

        return Response(
            content=content,
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    else:
        return history
