#!/bin/sh
# First-time setup on the server. Requires infra/.env.
set -eu
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Create infra/.env from .env.example first"; exit 1; }
[ -d map-assets/fonts ] || ./scripts/fetch-fonts.sh
docker compose build
docker compose up -d db
docker compose up -d api worker web graphhopper
echo "Create the first admin:"
echo "  docker compose exec api node dist/cli.js bootstrap-admin you@example.com"
echo "Then sign in, open /admin → Jobs & pipeline, and trigger an OSM refresh (first build takes 1–2 hours)."
