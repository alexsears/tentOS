#!/usr/bin/with-contenv bashio

# Get config values
LOG_LEVEL=$(bashio::config 'log_level')
export LOG_LEVEL

# Get supervisor token for HA API access
export SUPERVISOR_TOKEN="${SUPERVISOR_TOKEN}"
export HASSIO_TOKEN="${HASSIO_TOKEN:-$SUPERVISOR_TOKEN}"

# Get ingress entry point
if bashio::supervisor.ping; then
    export INGRESS_PATH=$(bashio::addon.ingress_entry)
    export HA_URL="http://supervisor/core"
else
    export INGRESS_PATH=""
    export HA_URL="http://localhost:8123"
fi

bashio::log.info "Starting TentOS..."
bashio::log.info "Log level: ${LOG_LEVEL}"
bashio::log.info "Ingress path: ${INGRESS_PATH}"

# Initialize database
cd /app/backend
python3 -c "from database import init_db; import asyncio; asyncio.run(init_db())" || true

# Start nginx in background for static files
nginx &

# Start FastAPI backend
exec python3 -m uvicorn main:app \
    --host 127.0.0.1 \
    --port 8100 \
    --log-level "${LOG_LEVEL}"
