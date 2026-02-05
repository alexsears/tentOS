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

    # Collect all entity IDs we need to query
    entity_map = {}  # entity_id -> sensor_type
    for sensor_type in sensor_list:
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
        temp_data = {d["timestamp"][:16]: d["value"] for d in result_data.get("temperature", [])}
        hum_data = {d["timestamp"][:16]: d["value"] for d in result_data.get("humidity", [])}

        for ts, temp in temp_data.items():
            if ts in hum_data:
                humidity = hum_data[ts]
                # VPD calculation (temp in Celsius)
                temp_c = temp if temp < 50 else (temp - 32) * 5/9
                svp = 0.6108 * math.exp((17.27 * temp_c) / (temp_c + 237.3))
                vpd = svp * (1 - humidity / 100)
                vpd_data.append({
                    "timestamp": ts,
                    "value": round(vpd, 2)
                })

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

    return {
        "tent_id": tent_id,
        "tent_name": tent.config.name,
        "range": range,
        "from": start_time.isoformat(),
        "to": end_time.isoformat(),
        "data": result_data,
        "stats": stats,
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
