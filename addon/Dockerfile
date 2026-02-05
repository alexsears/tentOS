ARG BUILD_FROM
FROM ${BUILD_FROM}

# Install system dependencies
RUN apk add --no-cache \
    python3 \
    py3-pip \
    nodejs \
    npm \
    sqlite \
    nginx \
    && rm -rf /var/cache/apk/*

# Create app user for non-root execution
RUN addgroup -g 1000 app && adduser -u 1000 -G app -s /bin/sh -D app

# Set working directory
WORKDIR /app

# Copy backend requirements and install
COPY app/backend/requirements.txt /app/backend/
RUN pip3 install --no-cache-dir -r /app/backend/requirements.txt

# Copy frontend and build
COPY app/frontend /app/frontend
WORKDIR /app/frontend
RUN npm ci && npm run build

# Copy backend
WORKDIR /app
COPY app/backend /app/backend
COPY app/shared /app/shared

# Copy run script and nginx config
COPY run.sh /
COPY nginx.conf /etc/nginx/nginx.conf
RUN chmod a+x /run.sh

# Create data directory
RUN mkdir -p /data && chown -R app:app /data

# Expose port
EXPOSE 8099

CMD [ "/run.sh" ]
