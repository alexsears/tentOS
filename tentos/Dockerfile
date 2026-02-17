ARG BUILD_FROM
FROM ${BUILD_FROM}

# Install system dependencies
RUN apk add --no-cache \
    python3 \
    py3-pip \
    nodejs \
    npm \
    sqlite \
    nginx

# Set working directory
WORKDIR /app

# Copy backend requirements and install
COPY app/backend/requirements.txt /app/backend/
RUN pip3 install --no-cache-dir --break-system-packages -r /app/backend/requirements.txt

# Bust Docker cache when version changes (BUILD_VERSION passed by Supervisor)
ARG BUILD_VERSION
RUN echo "Building TentOS ${BUILD_VERSION}"

# Copy frontend and build
COPY app/frontend /app/frontend
WORKDIR /app/frontend
RUN npm install && npm run build

# Copy backend
WORKDIR /app
COPY app/backend /app/backend
COPY app/shared /app/shared

# Copy config.yaml for version info (to root where code expects it)
COPY config.yaml /config.yaml

# Copy run script and nginx config
COPY run.sh /
COPY nginx.conf /etc/nginx/nginx.conf
RUN chmod a+x /run.sh

# Create data directory
RUN mkdir -p /data

# Expose port
EXPOSE 8099

CMD [ "/run.sh" ]
