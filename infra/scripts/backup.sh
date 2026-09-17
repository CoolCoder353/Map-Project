#!/bin/sh
# Nightly database backup: pg_dump (custom format) into a restic repository.
# Usage (cron on the host): RESTIC_REPOSITORY=... RESTIC_PASSWORD_FILE=... infra/scripts/backup.sh
set -eu
cd "$(dirname "$0")/.."
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
docker compose exec -T db pg_dump -U wayfinder -d wayfinder -Fc > "/tmp/wayfinder-$STAMP.dump"
restic backup --tag wayfinder-db "/tmp/wayfinder-$STAMP.dump"
rm -f "/tmp/wayfinder-$STAMP.dump"
restic forget --tag wayfinder-db --keep-daily 14 --keep-weekly 8 --keep-monthly 12 --prune
