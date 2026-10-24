FROM node:22-alpine

LABEL org.opencontainers.image.source="https://github.com/CodeChris-89/KitCatalogue"
LABEL org.opencontainers.image.description="KitCatalogue container image"

# su-exec and tzdata for customizable user permissions (PUID/PGID) and timezone support
RUN apk add --no-cache su-exec tzdata

WORKDIR /app

COPY package.json ./
COPY server ./server
COPY public ./public
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /data

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    PUID=1000 \
    PGID=1000 \
    TZ=UTC

VOLUME ["/data"]

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
