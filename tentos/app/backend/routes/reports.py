"""Reports and history API routes with downsampling support."""
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, HTTPException, Request, Query
from sqlalchemy import select, func, and_, text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db, SensorHistory

logger = logging.getLogger(__name__)
router = APIRouter()


def get_bucket_seconds(time_range_hours: int) -> int:
    """Determine appropriate bucket size based on time range."""
    if time_range_hours <= 24:
        return 300  # 5 minutes
    elif time_range_hours <= 72:
        return 900  # 15 minutes
    elif time_range_hours <= 168:  # 7 days
        return 1800  # 30 minutes
    elif time_range_hours <= 720:  # 30 days
        return 3600  # 1 hour
    else:
        return 21600  # 6 hours


def downsample_data(data: list, max_points: int = 500) -> list:
    """Downsample data to max_points using LTTB-like algorithm."""
    if len(data) <= max_points:
        return data

    # Simple bucket averaging for downsampling
    bucket_size = len(data) // max_points
    result = []

    for i in range(0, len(data), bucket_size):
        bucket = data[i:i + bucket_size]
        if bucket:
            avg_value = sum(p["value"] for p in bucket) / len(bucket)
            min_value = min(p["value"] for p in bucket)
            max_value = max(p["value"] for p in bucket)
            # Use middle timestamp of bucket
            mid_idx = len(bucket) // 2
            result.append({
                "timestamp": bucket[mid_idx]["timestamp"],
                "value": round(avg_value, 2),
                "min": round(min_value, 2),
                "max": round(max_value, 2)
            })

    return result


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
    """
    Get historical sensor data with automatic downsampling.

    Returns aggregated data optimized for charting with min/max bands.
    """
    state_manager = request.app.state.state_manager
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

    async for session in get_db():
        result_data = {}

        for sensor_type in sensor_list:
            # Query raw data
            query = select(SensorHistory).where(
                and_(
                    SensorHistory.tent_id == tent_id,
                    SensorHistory.sensor_type == sensor_type,
                    SensorHistory.timestamp >= start_time,
                    SensorHistory.timestamp <= end_time
                )
            ).order_by(SensorHistory.timestamp)

            result = await session.execute(query)
            records = result.scalars().all()

            # Convert to list of dicts
            data = [
                {
                    "timestamp": r.timestamp.isoformat(),
                    "value": r.value
                }
                for r in records
            ]

            # Downsample if needed
            if len(data) > max_points:
                data = downsample_data(data, max_points)

            result_data[sensor_type] = data

        # Calculate statistics for each sensor
        stats = {}
        for sensor_type, data in result_data.items():
            if data:
                values = [p["value"] for p in data]
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
            "stats": stats
        }


@router.get("/summary/{tent_id}")
async def get_summary(
    tent_id: str,
    request: Request,
    range: str = Query(default="24h")
):
    """Get summary statistics for a tent over a time range."""
    state_manager = request.app.state.state_manager
    tent = state_manager.get_tent(tent_id)
    if not tent:
        raise HTTPException(status_code=404, detail="Tent not found")

    now = datetime.now(timezone.utc)
    range_map = {
        "1h": timedelta(hours=1),
        "6h": timedelta(hours=6),
        "24h": timedelta(hours=24),
        "7d": timedelta(days=7),
        "30d": timedelta(days=30)
    }
    delta = range_map.get(range, timedelta(hours=24))
    start_time = now - delta

    async for session in get_db():
        # Get aggregated stats per sensor
        query = select(
            SensorHistory.sensor_type,
            func.min(SensorHistory.value).label("min_value"),
            func.max(SensorHistory.value).label("max_value"),
            func.avg(SensorHistory.value).label("avg_value"),
            func.count(SensorHistory.id).label("count")
        ).where(
            and_(
                SensorHistory.tent_id == tent_id,
                SensorHistory.timestamp >= start_time
            )
        ).group_by(SensorHistory.sensor_type)

        result = await session.execute(query)
        rows = result.all()

        summary = {}
        for row in rows:
            summary[row.sensor_type] = {
                "min": round(row.min_value, 2) if row.min_value else None,
                "max": round(row.max_value, 2) if row.max_value else None,
                "avg": round(row.avg_value, 2) if row.avg_value else None,
                "samples": row.count
            }

        return {
            "tent_id": tent_id,
            "range": range,
            "from": start_time.isoformat(),
            "to": now.isoformat(),
            "summary": summary
        }


@router.get("/compare")
async def compare_periods(
    request: Request,
    tent_id: str,
    sensor: str = Query(default="temperature"),
    period1_start: str = Query(..., description="Period 1 start (ISO)"),
    period1_end: str = Query(..., description="Period 1 end (ISO)"),
    period2_start: str = Query(..., description="Period 2 start (ISO)"),
    period2_end: str = Query(..., description="Period 2 end (ISO)")
):
    """Compare two time periods for a sensor."""
    state_manager = request.app.state.state_manager
    tent = state_manager.get_tent(tent_id)
    if not tent:
        raise HTTPException(status_code=404, detail="Tent not found")

    try:
        p1_start = datetime.fromisoformat(period1_start.replace('Z', '+00:00'))
        p1_end = datetime.fromisoformat(period1_end.replace('Z', '+00:00'))
        p2_start = datetime.fromisoformat(period2_start.replace('Z', '+00:00'))
        p2_end = datetime.fromisoformat(period2_end.replace('Z', '+00:00'))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")

    async for session in get_db():
        async def get_period_stats(start, end):
            query = select(
                func.min(SensorHistory.value).label("min_value"),
                func.max(SensorHistory.value).label("max_value"),
                func.avg(SensorHistory.value).label("avg_value"),
                func.count(SensorHistory.id).label("count")
            ).where(
                and_(
                    SensorHistory.tent_id == tent_id,
                    SensorHistory.sensor_type == sensor,
                    SensorHistory.timestamp >= start,
                    SensorHistory.timestamp <= end
                )
            )
            result = await session.execute(query)
            row = result.one()
            return {
                "min": round(row.min_value, 2) if row.min_value else None,
                "max": round(row.max_value, 2) if row.max_value else None,
                "avg": round(row.avg_value, 2) if row.avg_value else None,
                "samples": row.count
            }

        period1_stats = await get_period_stats(p1_start, p1_end)
        period2_stats = await get_period_stats(p2_start, p2_end)

        # Calculate differences
        diff = {}
        if period1_stats["avg"] and period2_stats["avg"]:
            diff["avg"] = round(period2_stats["avg"] - period1_stats["avg"], 2)
            diff["avg_pct"] = round((diff["avg"] / period1_stats["avg"]) * 100, 1) if period1_stats["avg"] != 0 else 0

        return {
            "tent_id": tent_id,
            "sensor": sensor,
            "period1": {
                "from": period1_start,
                "to": period1_end,
                "stats": period1_stats
            },
            "period2": {
                "from": period2_start,
                "to": period2_end,
                "stats": period2_stats
            },
            "difference": diff
        }


@router.get("/export/{tent_id}")
async def export_data(
    tent_id: str,
    request: Request,
    format: str = Query(default="csv", description="Export format: csv or json"),
    sensors: str = Query(default="temperature,humidity,vpd"),
    range: str = Query(default="7d")
):
    """Export historical data for download."""
    from fastapi.responses import Response

    state_manager = request.app.state.state_manager
    tent = state_manager.get_tent(tent_id)
    if not tent:
        raise HTTPException(status_code=404, detail="Tent not found")

    now = datetime.now(timezone.utc)
    range_map = {
        "24h": timedelta(hours=24),
        "7d": timedelta(days=7),
        "30d": timedelta(days=30),
        "90d": timedelta(days=90)
    }
    delta = range_map.get(range, timedelta(days=7))
    start_time = now - delta

    sensor_list = [s.strip() for s in sensors.split(",")]

    async for session in get_db():
        query = select(SensorHistory).where(
            and_(
                SensorHistory.tent_id == tent_id,
                SensorHistory.sensor_type.in_(sensor_list),
                SensorHistory.timestamp >= start_time
            )
        ).order_by(SensorHistory.timestamp, SensorHistory.sensor_type)

        result = await session.execute(query)
        records = result.scalars().all()

        if format == "csv":
            # Build CSV
            lines = ["timestamp,sensor_type,value"]
            for r in records:
                lines.append(f"{r.timestamp.isoformat()},{r.sensor_type},{r.value}")

            content = "\n".join(lines)
            filename = f"{tent_id}_{range}_{datetime.now().strftime('%Y%m%d')}.csv"

            return Response(
                content=content,
                media_type="text/csv",
                headers={"Content-Disposition": f"attachment; filename={filename}"}
            )
        else:
            # JSON format
            data = [
                {
                    "timestamp": r.timestamp.isoformat(),
                    "sensor_type": r.sensor_type,
                    "value": r.value
                }
                for r in records
            ]
            return {"tent_id": tent_id, "range": range, "records": len(data), "data": data}
