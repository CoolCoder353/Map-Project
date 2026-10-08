# Deploying to a small server

For a server too small to build images or map data itself: about 2 GB RAM and 10 GB disk, behind a proxy that terminates HTTPS. The live example is `maps.paulsjones.com` (host `maps`), serving **Queensland only**.

Everything heavy happens on a bigger machine: Docker images, the OSM import (graph, tiles, places). `infra/scripts/deploy-small.sh` streams the results over SSH.

**Access:** `ssh root@maps` from the build machine (key-based). The checkout is `/opt/wayfinder`, and compose commands there always take both files:

```bash
cd /opt/wayfinder/infra && docker compose -f docker-compose.yml -f docker-compose.small.yml ps
```

## What runs on the server

`docker compose -f docker-compose.yml -f docker-compose.small.yml`:

| Service | Memory (measured) | Notes |
|---|---|---|
| graphhopper | ~1.05 GB | Graph memory-mapped (`MMAP`), 1 GB heap; 512 MB thrashes in garbage collection on isochrones |
| db | ~220 MB | `shared_buffers=128MB` |
| api | ~90 MB | |
| worker | ~70 MB | Slim image: no Java, Planetiler or osmium; map refreshes refused (`OSM_REFRESH_ENABLED=false`) |
| web (Caddy) | ~20 MB | Plain HTTP on `HTTP_PORT` (8080); the proxy does HTTPS |

Disk: about 2.2 GB of images, 0.6 GB of map data (Queensland graph 355 MB, tiles 264 MB), about 0.4 GB of database, plus the OS.

`infra/.env` on the server (created with generated secrets; readable by root only):

```
PUBLIC_URL=https://maps.paulsjones.com
SITE_ADDRESS=http://:8080
HTTP_PORT=8080
ACME_EMAIL=admin@localhost          # unused behind the proxy
POSTGRES_PASSWORD=…                 # change inside Postgres first; see operations.md
JWT_SECRET=…
```

`PUBLIC_URL` makes the API hand out `https://` tile and style URLs whatever the proxy forwards. Caddy trusts `X-Forwarded-For` and `X-Forwarded-Proto` from private-range addresses, so rate limits apply per visitor. If the proxy connects from a public address, add that address to `trusted_proxies` in `infra/caddy/Caddyfile`.

## Building a region's map data (on the big machine)

Queensland is cut from the Australia extract using its own boundary, then run through the normal pipeline into a separate volume and a throwaway database:

```bash
# 1. cut Queensland (needs the Australia extract in wayfinder_osmdata)
docker volume create wayfinder_qlddata
docker run --rm -v wayfinder_osmdata:/src:ro -v wayfinder_qlddata:/data --entrypoint sh wayfinder-worker -c '
  set -e; mkdir -p /data/osm /data/sources
  osmium tags-filter --overwrite /src/osm/australia-latest.osm.pbf r/ISO3166-2=AU-QLD -o /tmp/b.pbf
  osmium export --overwrite --geometry-types=polygon /tmp/b.pbf -o /tmp/b.geojson
  node -e "const fs=require(\"fs\"),fc=JSON.parse(fs.readFileSync(\"/tmp/b.geojson\"));fs.writeFileSync(\"/data/osm/qld.geojson\",JSON.stringify({type:\"FeatureCollection\",features:fc.features.filter(f=>f.properties[\"ISO3166-2\"]===\"AU-QLD\").slice(0,1)}))"
  TS=$(osmium fileinfo -g header.option.osmosis_replication_timestamp /src/osm/australia-latest.osm.pbf)
  osmium extract --overwrite -s smart --set-bounds -p /data/osm/qld.geojson /src/osm/australia-latest.osm.pbf \
    --output-header=osmosis_replication_timestamp="$TS" -o /data/osm/australia-latest.osm.pbf
  cp -r /src/sources/. /data/sources/'

# 2. a throwaway database for the places import
docker run -d --name wf-qld-db --network wayfinder_default -e POSTGRES_USER=wayfinder \
  -e POSTGRES_PASSWORD=qld-build-only -e POSTGRES_DB=wayfinder postgres:17-bookworm
docker run --rm --network wayfinder_default -e DATABASE_URL=postgres://wayfinder:qld-build-only@wf-qld-db:5432/wayfinder \
  -e JWT_SECRET=build-only-build-only-build-only-0000 wayfinder-api node dist/cli.js migrate

# 3. graph, tiles and places (~12 min)
docker run --rm --network wayfinder_default -v wayfinder_qlddata:/data \
  -e DATABASE_URL=postgres://wayfinder:qld-build-only@wf-qld-db:5432/wayfinder -e DATA_DIR=/data \
  -e GRAPHHOPPER_IMPORT_HEAP=8g -e PLANETILER_HEAP=6g wayfinder-worker node dist/refresh-cli.js graph tiles places
```

The extract keeps the pipeline's file name (`australia-latest.osm.pbf`) and tiles name (`australia.pmtiles`), so nothing else needs to change. For another state, swap `AU-QLD` for its ISO code (`AU-NSW`, `AU-VIC`, …).

## Shipping

The build database (`wf-qld-db`) must be running for the `places` step: `docker start wf-qld-db`.

```bash
infra/scripts/deploy-small.sh images   # builds and loads api, worker (slim), web, graphhopper
infra/scripts/deploy-small.sh data     # graph + tiles; swapped in beside the live data, then GraphHopper restarts
infra/scripts/deploy-small.sh places   # search data + data date (needs the server stack running)
```

Each step checks free disk space on the server first. Configuration (compose files, Caddyfile, GraphHopper config) comes from the server's git checkout, `/opt/wayfinder`, so bring it up to date too. If the commits are on GitHub:

```bash
ssh root@maps "cd /opt/wayfinder && git pull --ff-only"
```

If they aren't pushed yet, send them as a bundle (replace `<last-deployed>` with the commit the server is on, from `git log -1` there):

```bash
git bundle create /tmp/wf.bundle <last-deployed>..HEAD master && scp /tmp/wf.bundle root@maps:/tmp/ && ssh root@maps "cd /opt/wayfinder && git fetch /tmp/wf.bundle master:refs/remotes/bundle/master && git merge --ff-only refs/remotes/bundle/master"
```

Then restart onto the new images. The API applies any new migrations as it starts:

```bash
cd /opt/wayfinder/infra && docker compose -f docker-compose.yml -f docker-compose.small.yml up -d
```

Finish with `verify:stack` and `verify:mobile` (below).

First admin (then invite people from the dashboard):

```bash
cd /opt/wayfinder/infra && docker compose -f docker-compose.yml -f docker-compose.small.yml exec api node dist/cli.js bootstrap-admin you@example.com
```

## Refreshing the map data

Monthly, or whenever you like: refresh Australia on the big machine (Admin → Jobs & data, or `refresh-cli.js`), re-run steps 1 and 3 above, then `deploy-small.sh data` and `deploy-small.sh places`. The server keeps serving throughout. Routing restarts for about a minute when the new graph goes in, and search is briefly empty while places load (about 20 s).

## Keeping the phone app in step

The Android app and the server move together: the app is built from the same checkout. After a
release that changes the API's shape — the coverage switch from hexagons to roads did — install
the new APK, because an older build reads fields that no longer exist.

```bash
EXPO_PUBLIC_API_URL=https://maps.paulsjones.com infra/scripts/build-apk.sh
VERIFY_REGION=qld API_URL=https://maps.paulsjones.com EMAIL=… PASSWORD=… pnpm verify:mobile
```

The address is baked into the APK at build time and is what the app talks to, so pass the real
one. The script refuses a documentation address and checks the finished file points where you
meant; `verify:mobile` then proves the server still answers everything the app asks for. The
checks before a build, and how to test the file before sharing it, are in
[build-android.md](build-android.md).

## What is deployed now

Queensland (OSM 2026-09-16), 892,695 places, on a 2 GB / 14 GB VM: about 1.5 GB RAM and 5.6 GB disk in use. Code from 2026-10-08 (`330316f`: the 5–7 October feedback fixes; migration 008, saved places), deployed with `deploy-small.sh images` and `git pull` on the server. Checked read-only against the live graph: a new route from Ironbark Street heading north (the dead end of the 5 October reroute loop) starts "Turn around when you can", and the Boundary Road roundabout's exit 1 carries its angle (154°); `/api/health` reports database and routing up and `/api/saved-places` asks for a sign-in. `verify:stack` and `verify:mobile` were not run (they need an admin and a throwaway account's passwords). Before that, code from 2026-10-04 (`84f250e`: the public contact WeaponryAndResourcesGame@gmail.com on `/privacy` and `/delete-account`), deployed through a git bundle; checked that both pages show the new address and `/api/health` reports database and routing up. `verify:stack` and `verify:mobile` were not run for this deploy, which changed only the web pages. Before that, code from 2026-10-01 (the 28-29 September feedback fixes: one trip per drive, every stretch of a road kept, roundabout exits, reroutes that start the way you're going, addresses found in their suburb; migration 007), deployed through a git bundle and checked read-only against the live graph and places: a U-turn round the Waterloo Street roundabout reads "exit 4" wherever a detour's stop lands on it, a reroute heading north carries on to the roundabout instead of turning back, and contact-style addresses resolve in the named suburb. The reporter's 14 duplicate trips were soft-deleted and coverage rebuilt for every user; a database dump from before is at `/root/wayfinder-before-2026-10-01-fixes.sql.gz` (all but `places`). Before that, code from 2026-09-28 (explore without U-turns, speed limits on routes), checked by running the deployed routing against the live graph and places, read-only: detours on four Brisbane-area trips with no U-turns, and car loops offered from Cleveland, Carindale and Toowoomba at 20, 30 and 60 minutes, except Toowoomba at 30 (no loop there fits the time). Caddy sees the proxy at 192.168.50.34 and takes the forwarded client IP and `https` from it.

## Checking it

```bash
VERIFY_REGION=qld API_URL=https://maps.paulsjones.com ADMIN_EMAIL=… ADMIN_PASSWORD=… pnpm verify:stack
```

```bash
VERIFY_REGION=qld API_URL=https://maps.paulsjones.com EMAIL=… PASSWORD=… pnpm verify:mobile
```

`VERIFY_REGION=qld` matters: the default tests Canberra, which this server has no map for. `verify:mobile` records a short trip and a feedback item, so use a throwaway account and delete it afterwards.

Live on 2026-09-23 against `https://maps.paulsjones.com`: all 19 `verify:stack` checks and all 15 `verify:mobile` checks pass. Search takes about 100 ms, fastest routes about 100 ms, and Discover about 7 s (its isochrone is the slow part with a memory-mapped graph). Explore finds nothing for Brisbane to the Gold Coast within 45 minutes extra: every road that differs from the M1 costs more than that.

## Open items

Found on the live server and not yet dealt with (checked 2026-09-27):

- **No backups.** There is no cron entry for `infra/scripts/backup.sh`, so the database (accounts,
  trips, feedback) exists only on this VM. Set one up as in
  [operations.md](operations.md#daily--weekly), pointing at storage off the VM.
- **The Docker API listens unauthenticated on `127.0.0.1:2375`.** Only local processes can reach
  it, but any of them can control every container, which is root on the host. Unless something
  needs it, remove the `tcp://` host from the Docker daemon's configuration.
