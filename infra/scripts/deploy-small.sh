#!/bin/sh
# Ship Wayfinder to a small server that can't build images or map data itself
# (see docs/deploy-small-server.md). Everything is built on this machine and streamed over SSH.
#
#   infra/scripts/deploy-small.sh images   # build and load api, worker (slim), web, graphhopper
#   infra/scripts/deploy-small.sh data     # routing graph + vector tiles from DATA_VOLUME
#   infra/scripts/deploy-small.sh places   # search data from the build database BUILD_DB
#   infra/scripts/deploy-small.sh all
#
# Settings (environment):
#   DEPLOY_HOST   ssh target                          (default root@maps)
#   DEPLOY_DIR    checkout on the server              (default /opt/wayfinder)
#   DATA_VOLUME   local volume holding the built data (default wayfinder_qlddata)
#   BUILD_DB      local Postgres container with the built places (default wf-qld-db)
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOST="${DEPLOY_HOST:-root@maps}"
DIR="${DEPLOY_DIR:-/opt/wayfinder}"
DATA_VOLUME="${DATA_VOLUME:-wayfinder_qlddata}"
BUILD_DB="${BUILD_DB:-wf-qld-db}"
DC="docker compose -f docker-compose.yml -f docker-compose.small.yml"
IMAGES="wayfinder-api wayfinder-worker-slim wayfinder-web wayfinder-graphhopper"

remote() { ssh -o BatchMode=yes "$HOST" "$@"; }

free_mb() { remote "df -Pm /var/lib/docker | awk 'NR==2 {print \$4}'"; }

need_space() { # need_space <MB> <what>
  have=$(free_mb)
  if [ "$have" -lt "$1" ]; then
    echo "Not enough disk on $HOST for $2: $have MB free, about $1 MB needed." >&2
    exit 1
  fi
}

images() {
  echo "== building images"
  # Building needs no real settings, but the compose files insist the variables exist.
  (cd "$ROOT/infra" && POSTGRES_PASSWORD=build JWT_SECRET=build-only-build-only-build-only-0000 \
    SITE_ADDRESS=build ACME_EMAIL=build PUBLIC_URL=http://build $DC build api worker web graphhopper) >/dev/null
  size=$(docker image inspect $IMAGES --format '{{.Size}}' | awk '{s += $1} END {printf "%d", s / 1048576}')
  need_space $((size + 500)) "images (${size} MB)"
  echo "== sending images (${size} MB unpacked)"
  docker save $IMAGES | gzip -1 | remote 'gunzip | docker load'
  remote 'docker image prune -f >/dev/null'
}

data() {
  size=$(docker run --rm -v "$DATA_VOLUME":/d:ro alpine du -sm /d/graphhopper/graph-current /d/tiles/australia.pmtiles | awk '{s += $1} END {print s}')
  need_space $((size + 300)) "map data (${size} MB)"
  echo "== sending graph and tiles (${size} MB)"
  remote "docker volume create wayfinder_osmdata >/dev/null"
  # Unpack beside the live data, then swap, so routing keeps working until the new graph is in.
  docker run --rm -v "$DATA_VOLUME":/d:ro alpine tar -C /d -cf - graphhopper/graph-current tiles/australia.pmtiles \
    | gzip -1 \
    | remote "docker run --rm -i -v wayfinder_osmdata:/d alpine sh -c '
        set -e
        rm -rf /d/incoming && mkdir -p /d/incoming /d/graphhopper /d/tiles
        gunzip | tar -C /d/incoming -xf -
        rm -rf /d/graphhopper/graph-old
        [ -d /d/graphhopper/graph-current ] && mv /d/graphhopper/graph-current /d/graphhopper/graph-old
        mv /d/incoming/graphhopper/graph-current /d/graphhopper/graph-current
        mv /d/incoming/tiles/australia.pmtiles /d/tiles/australia.pmtiles
        date +%s > /d/graphhopper/graph-version
        rm -rf /d/incoming /d/graphhopper/graph-old
        chown -R 1000:1000 /d'"
}

places() {
  echo "== sending places"
  date=$(docker exec "$BUILD_DB" psql -U wayfinder -d wayfinder -At -c "SELECT value #>> '{}' FROM app_state WHERE key = 'osm.dataDate'")
  docker exec "$BUILD_DB" pg_dump -U wayfinder -d wayfinder --data-only -t places -Fc \
    | remote "cd $DIR/infra && $DC exec -T db sh -c 'psql -q -U wayfinder -d wayfinder -c \"TRUNCATE places\" && pg_restore -U wayfinder -d wayfinder --data-only --single-transaction'"
  remote "cd $DIR/infra && $DC exec -T db psql -q -U wayfinder -d wayfinder -c \"
    INSERT INTO app_state (key, value) VALUES ('osm.dataDate', to_jsonb('$date'::text))
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
    ANALYZE places;\""
  echo "   places: $(remote "cd $DIR/infra && $DC exec -T db psql -U wayfinder -d wayfinder -At -c 'SELECT count(*) FROM places'"), data date $date"
}

case "${1:-}" in
  images) images ;;
  data) data ;;
  places) places ;;
  all) images; data; places ;;
  *) sed -n '2,15p' "$0"; exit 1 ;;
esac
