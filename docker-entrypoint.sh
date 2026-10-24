#!/bin/sh
set -e

DATA_DIR="${DATA_DIR:-/data}"
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

# Create directories safely without failing on restricted parent mounts
mkdir -p "$DATA_DIR/uploads/photos" "$DATA_DIR/uploads/manuals" 2>/dev/null || true

# If running as root inside the container, adjust ownership and run under configured PUID:PGID
if [ "$(id -u)" = "0" ]; then
  # Non-fatal chown: avoid crashing on FUSE mounts, NFS, SMB, or FAT32 where chown is not permitted
  chown -R "${PUID}:${PGID}" "$DATA_DIR" 2>/dev/null || true
  chown -R "${PUID}:${PGID}" /app 2>/dev/null || true

  # Ensure group exists in /etc/group
  if ! getent group "$PGID" >/dev/null 2>&1; then
    addgroup -g "$PGID" -S appgroup 2>/dev/null || true
  fi

  # Ensure user exists in /etc/passwd
  if ! getent passwd "$PUID" >/dev/null 2>&1; then
    TARGET_GROUP="$(getent group "$PGID" | cut -d: -f1)"
    [ -z "$TARGET_GROUP" ] && TARGET_GROUP="$PGID"
    adduser -u "$PUID" -G "$TARGET_GROUP" -s /bin/sh -D -H appuser 2>/dev/null || true
  fi

  exec su-exec "${PUID}:${PGID}" node --no-warnings server/index.js
else
  exec node --no-warnings server/index.js
fi
