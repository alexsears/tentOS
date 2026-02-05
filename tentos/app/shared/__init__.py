"""Shared utilities and constants."""

VERSION = "1.0.0"

# Event types
EVENT_TYPES = [
    "watering",
    "refill",
    "filter_change",
    "solution_change",
    "maintenance",
    "note"
]

# Alert severities
SEVERITY_INFO = "info"
SEVERITY_WARNING = "warning"
SEVERITY_CRITICAL = "critical"

# Alert types
ALERT_TYPES = [
    "temp_out_of_range",
    "humidity_out_of_range",
    "leak_detected",
    "reservoir_low",
    "device_unavailable",
    "schedule_drift"
]
