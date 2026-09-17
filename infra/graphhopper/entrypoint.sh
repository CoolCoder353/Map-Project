#!/bin/sh
# Runs GraphHopper on /data/graphhopper/graph-current and restarts it whenever the worker's
# refresh pipeline swaps in a new graph (signalled by /data/graphhopper/graph-version).
set -u
GH_DIR=/data/graphhopper
HEAP="${GRAPHHOPPER_HEAP:-8g}"
version() { cat "$GH_DIR/graph-version" 2>/dev/null || echo none; }

while [ ! -d "$GH_DIR/graph-current" ]; do
  echo "Waiting for a graph at $GH_DIR/graph-current (run an OSM refresh from the admin dashboard)..."
  sleep 30
done

while true; do
  current=$(version)
  echo "Starting GraphHopper (graph version $current)"
  java -Xmx"$HEAP" -Xms"$HEAP" -XX:+UseParallelGC -jar /opt/graphhopper/graphhopper-web.jar server /opt/graphhopper/config.yml &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    sleep 30
    if [ "$(version)" != "$current" ]; then
      echo "New graph detected; restarting"
      kill "$pid"
      wait "$pid"
      break
    fi
  done
  wait "$pid" 2>/dev/null
  sleep 2
done
