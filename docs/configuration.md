# Configuration

Every setting, where it is read, and its default. Deployments set these in `infra/.env`, which
Docker Compose passes on; copy [`infra/.env.example`](../infra/.env.example) to start.

## `infra/.env` (Docker Compose)

| Variable | Needed | Used for |
|---|---|---|
| `SITE_ADDRESS` | yes | The domain Caddy serves, e.g. `maps.your-group.org`. Behind a proxy that does HTTPS, `http://:8080` |
| `ACME_EMAIL` | yes | Let's Encrypt contact. Unused behind a proxy, but must be set |
| `POSTGRES_PASSWORD` | yes | Database password. Only applied when the database volume is first created; see [operations.md](operations.md#rotating-secrets) to change it |
| `JWT_SECRET` | yes | Signs access tokens; at least 32 characters (`openssl rand -base64 48`) |
| `GRAPHHOPPER_HEAP` | no | Routing engine heap when serving (default `8g`; `1g` on the 2 GB server) |
| `GRAPHHOPPER_IMPORT_HEAP` | no | Heap for building the graph (default `12g`) |
| `PLANETILER_HEAP` | no | Heap for building tiles (default `8g`) |
| `OSM_REFRESH_CRON` | no | Monthly refresh schedule, UTC (default `0 3 2 * *`); empty disables it |
| `LOG_LEVEL` | no | `info` by default |
| `PUBLIC_URL` | small server | The public `https://` address when a proxy terminates HTTPS. Used for the API's absolute URLs, CORS and links (`docker-compose.small.yml`) |
| `HTTP_PORT` | small server | Host port Caddy listens on behind the proxy (default `8080`) |

## API (`apps/api/src/config.ts`)

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | — (required) | |
| `JWT_SECRET` | — (required) | At least 32 characters |
| `NODE_ENV` | `development` | |
| `HOST` / `PORT` | `0.0.0.0` / `3000` | |
| `GRAPHHOPPER_URL` | `http://localhost:8989` | |
| `PUBLIC_WEB_URL` | `http://localhost:5173` | Used in invite and password-reset links |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma separated |
| `COOKIE_SECURE` | `false` | `true` in production (HTTPS only) |
| `TRUST_PROXY` | `false` | Take the client IP and protocol from `X-Forwarded-*`. Set it behind Caddy |
| `PUBLIC_ORIGIN` | unset | Origin for the absolute URLs in the map style. Unset, it is taken from each request. Set it behind a proxy: Android needs absolute `https://` URLs |
| `PMTILES_PATH` | `./data/australia.pmtiles` | The tiles file; the API picks up a new one within 30 s |
| `MAP_ASSETS_DIR` | `../../infra/map-assets` | Fonts and sprites for the style |
| `LOG_LEVEL` | `info` | |
| `RATE_LIMIT_PER_MIN` | `600` | Per client IP |
| `AUTH_RATE_LIMIT_PER_MIN` | `10` | Sign-in, register, token refresh and password reset |

## Worker (`apps/worker/src/config.ts`)

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | — (required) | |
| `GRAPHHOPPER_URL` | `http://localhost:8989` | |
| `DATA_DIR` | `/data` | Extract, graph, tiles, Planetiler sources |
| `OSM_PBF_URL` | Geofabrik Australia | The extract to download |
| `OSM_REFRESH_CRON` | `0 3 2 * *` | Empty disables the schedule |
| `OSM_REFRESH_ENABLED` | `true` | `false` on a server too small to build map data; refreshes are then refused |
| `OSM_REFRESH_SKIP` | empty | Steps to skip, comma separated |
| `GRAPHHOPPER_JAR` / `GRAPHHOPPER_CONFIG` | `/opt/graphhopper/…` | Inside the worker image |
| `GRAPHHOPPER_IMPORT_HEAP` | `12g` | |
| `PLANETILER_JAR` / `PLANETILER_HEAP` | `/opt/planetiler/planetiler.jar` / `8g` | |
| `DISK_PATH` | `/` | Disk reported on the dashboard |
| `LOG_LEVEL` | `info` | |

## Android build (`infra/scripts/build-apk.sh`)

How to build, check and share the app: [build-android.md](build-android.md).

| Variable | Needed | Notes |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | yes | The server the app talks to, **baked into the APK**. Must be `https://`, and not a documentation address: the script refuses `example.com` and checks the finished APK |
| `ALLOW_HTTP` | no | `1` allows an `http://` server, for a test build only |
| `APP_DISPLAY_NAME` | no | Home-screen name (default `Wayfinder`). The in-app name comes from the server |
| `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | no | Read from `infra/android/keystore.env` when present. Keep the keystore: an update only installs over an app signed with the same key |

## Scripts

| Variable | Used by | Notes |
|---|---|---|
| `API_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `VERIFY_REGION` | `pnpm verify:stack` | Any account works; `VERIFY_REGION` is `act` (default) or `qld` |
| `API_URL`, `EMAIL`, `PASSWORD`, `VERIFY_REGION` | `pnpm verify:mobile` | Records five points and one feedback item: use a throwaway account |
| `DATABASE_URL`, `GRAPHHOPPER_URL` | `pnpm seed:demo`, `pnpm bench:explore` | `seed:demo` refuses `NODE_ENV=production` |
| `PGLITE_DIR`, `PGLITE_PORT` | `pnpm dev:db` | Where the dev database lives (default `./data/pglite`) and its port (default `55432`) |
| `TEST_DATABASE_URL` | `pnpm test:integration` | Real Postgres instead of in-process PGlite |
| `GRAPHHOPPER_LIVE_URL` | `pnpm test:integration` | Adds tests against a real routing graph |
| `CAPTURE` | web e2e | `1` captures design-review screenshots |
| `DEPLOY_HOST`, `DEPLOY_DIR`, `DATA_VOLUME`, `BUILD_DB` | `infra/scripts/deploy-small.sh` | Defaults `root@maps`, `/opt/wayfinder`, `wayfinder_qlddata`, `wf-qld-db` |
