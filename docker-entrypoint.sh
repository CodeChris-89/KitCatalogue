#!/bin/sh
set -e

DATA_DIR="${DATA_DIR:-/data}"
PUID="${PUID:-99}"
PGID="${PGID:-100}"

mkdir -p "$DATA_DIR/uploads/photos" "$DATA_DIR/uploads/manuals"

# If running as root inside the container, adjust ownership of /data to Unraid's PUID:PGID (default 99:100)
if [ "$(id -u)" = "0" ]; then
  chown -R "${PUID}:${PGID}" "$DATA_DIR" /app
  exec su-exec "${PUID}:${PGID}" node --no-warnings server/index.js
else
  exec node --no-warnings server/index.js
fi
