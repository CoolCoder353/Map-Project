#!/bin/sh
# Restore the latest (or given) restic snapshot into the running db container.
set -eu
cd "$(dirname "$0")/.."
SNAPSHOT="${1:-latest}"
TMP="$(mktemp -d)"
restic restore "$SNAPSHOT" --tag wayfinder-db --target "$TMP"
DUMP="$(find "$TMP" -name 'wayfinder-*.dump' | sort | tail -1)"
echo "Restoring $DUMP"
docker compose exec -T db pg_restore -U wayfinder -d wayfinder --clean --if-exists < "$DUMP"
rm -rf "$TMP"
