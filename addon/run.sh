#!/usr/bin/with-contenv bashio

# Get config values
LOG_LEVEL=$(bashio::config 'log_level')
export LOG_LEVEL

# Get supervisor token for HA API access
export SUPERVISOR_TOKEN="${SUPERVISOR_TOKEN}"
export HASSIO_TOKEN="${HASSIO_TOKEN:-$SUPERVISOR_TOKEN}"

# Get ingress entry point
export INGRESS_PATH=$(bashio::addon.ingress_entry)

# Set HA URL - use internal supervisor URL
export HA_URL="http://supervisor/core"

bashio::log.info "Starting TentOS..."
bashio::log.info "Log level: ${LOG_LEVEL}"
bashio::log.info "Ingress path: ${INGRESS_PATH}"

# Initialize database if needed
cd /app/backend
python3 -c "from database import init_db; init_db()"

# Start nginx for static files
nginx

# Start FastAPI backend
exec python3 -m uvicorn main:app \
    --host 0.0.0.0 \
    --port 8099 \
    --log-level "${LOG_LEVEL}" \
    --no-access-log
