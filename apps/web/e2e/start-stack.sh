#!/bin/sh
# Boots an isolated stack for Playwright: PGlite (fresh), demo seed, fake GraphHopper, API, Vite.
set -eu
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
export PGLITE_DIR="$ROOT/data/e2e-pglite" PGLITE_PORT=55433
rm -rf "$PGLITE_DIR"
DB_URL="postgres://postgres:postgres@127.0.0.1:55433/postgres"
pids=""
cleanup() { for p in $pids; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

pnpm -s dev:db & pids="$pids $!"
for i in $(seq 1 60); do (echo > /dev/tcp/127.0.0.1/55433) 2>/dev/null && break || sleep 0.5; done 2>/dev/null || true
sleep 2
DATABASE_URL="$DB_URL" pnpm -s seed:demo
PORT=8990 pnpm -s dev:fake-gh & pids="$pids $!"
(cd apps/api && DATABASE_URL="$DB_URL" JWT_SECRET=e2e-secret-e2e-secret-e2e-secret-0000 PORT=3100 TRUST_PROXY=true \
  GRAPHHOPPER_URL=http://127.0.0.1:8990 CORS_ORIGINS=http://localhost:5174 PUBLIC_WEB_URL=http://localhost:5174 \
  RATE_LIMIT_PER_MIN=100000 AUTH_RATE_LIMIT_PER_MIN=100000 LOG_LEVEL=warn \
  pnpm -s exec tsx --conditions=development src/server.ts) & pids="$pids $!"
cd apps/web
WAYFINDER_API=http://127.0.0.1:3100 exec pnpm -s exec vite --port 5174 --strictPort
