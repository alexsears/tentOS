"""Reports and history API routes - pulls from Home Assistant history."""
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, HTTPException, Request, Query
from fastapi.responses import Response

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


def extract_light_periods(history_data: list) -> list[dict]:
    """Convert light state history to on/off periods for chart overlay."""
    if not history_data:
        return []

    periods = []
    current_period = None

    for state in sorted(history_data, key=lambda x: x.get("last_changed", "")):
        timestamp = state.get("last_changed") or state.get("last_updated")
        is_on = state.get("state", "").lower() in ("on", "true", "1", "playing")

        if is_on and current_period is None:
            # Light turned on - start new period
            current_period = {"start": timestamp, "end": None}
        elif not is_on and current_period is not None:
            # Light turned off - end current period
            current_period["end"] = timestamp
            periods.append(current_period)
            current_period = None

    # If light is still on, end period at current time
    if current_period is not None:
        current_period["end"] = datetime.now(timezone.utc).isoformat()
        periods.append(current_period)

    return periods


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
                data = []
                for state in entity_history:
                    try:
                        value = float(state.get("state", 0))
                        timestamp = state.get("last_changed") or state.get("last_updated")
                        if timestamp and value is not None:
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

    # Fetch light state history for overlay
    light_periods = []
    light_entities = get_light_entity_ids(tent)
    if light_entities:
        try:
            light_history = await ha_client.get_history(
                light_entities,
                start_time.isoformat(),
                end_time.isoformat()
            )
            # Process light history to extract on/off periods
            for entity_history in light_history:
                if entity_history:
                    periods = extract_light_periods(entity_history)
                    light_periods.extend(periods)
        except Exception as e:
            logger.error(f"Failed to get light history: {e}")

    return {
        "tent_id": tent_id,
        "tent_name": tent.config.name,
        "range": range,
        "from": start_time.isoformat(),
        "to": end_time.isoformat(),
        "data": result_data,
        "stats": stats,
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
