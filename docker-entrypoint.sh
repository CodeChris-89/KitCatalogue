#!/bin/sh
set -e

DATA_DIR="${DATA_DIR:-/data}"
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

mkdir -p "$DATA_DIR/uploads/photos" "$DATA_DIR/uploads/manuals"

# If running as root inside the container, adjust ownership of /data to configured PUID:PGID (default 1000:1000)
if [ "$(id -u)" = "0" ]; then
  chown -R "${PUID}:${PGID}" "$DATA_DIR" /app
  exec su-exec "${PUID}:${PGID}" node --no-warnings server/index.js
else
  exec node --no-warnings server/index.js
fi
