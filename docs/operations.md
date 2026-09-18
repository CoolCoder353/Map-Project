# Operations runbook

Everything runs from `infra/docker-compose.yml` on one server. Run `docker compose` commands from the `infra` directory.

## Daily / weekly

| Task | How |
|---|---|
| Check health | Admin → Overview (API, database, routing engine, worker, map data freshness) |
| Check errors | Admin → Errors (last 30 days, grouped) |
| Check jobs | Admin → Jobs & data (queues, failed jobs with retry) |
| Backups | Cron `infra/scripts/backup.sh` (see below) |

Set a cron entry on the host:

```bash
0 3 * * * RESTIC_REPOSITORY=/mnt/backup/wayfinder RESTIC_PASSWORD_FILE=/root/restic-pass /srv/wayfinder/infra/scripts/backup.sh >> /var/log/wayfinder-backup.log 2>&1
```

Test a restore at least once: `infra/scripts/restore.sh latest` on a staging copy — an untested backup is not a backup.

## Map data refresh

The worker refreshes OpenStreetMap data monthly (`OSM_REFRESH_CRON`, UTC), and admins can start one from **Admin → Jobs & data → Refresh map data**.

What it does, in order: download the Australia extract (~1 GB, md5-checked) → read its data date → build the GraphHopper graph into `graph-next` → build Planetiler vector tiles → import places/POIs into a staging table → swap all three in.

- Routing keeps serving the old graph until the swap; GraphHopper then restarts itself (it watches `/data/graphhopper/graph-version`) and is unavailable for a minute or two.
- The API notices a new tiles file within 30 seconds.
- Expect 1–2 hours and up to ~16 GB of RAM (`GRAPHHOPPER_IMPORT_HEAP`, `PLANETILER_HEAP` in `infra/.env`). On a smaller server, lower both and expect it to take longer.
- Watch progress in the dashboard's run log, or:

```bash
docker compose logs -f worker
```

If a step fails, the run is marked failed, the log tail is kept, and the **live data is untouched** — the new graph and tiles only replace the old ones after every step succeeds. Running the refresh again reuses a graph and tiles already built from the same extract, so a retry after a late failure takes minutes, not hours.

### Running only some steps

After an update that changes how places are imported (search data), rebuild just the places, which takes about 7 minutes, instead of the whole refresh:

```bash
docker compose run --rm --no-deps worker node dist/refresh-cli.js places
```

Steps are `download`, `graph`, `tiles` and `places`; name any combination. The run shows up in the dashboard like any other.

### What the places import records

Every place gets a suburb, state and postcode for search suggestions ("Main Street · Queanbeyan NSW 2620"):
- **State and suburb** come from OSM administrative boundaries: states are admin level 4, suburbs and localities are levels 9 and 10. A tagged `addr:suburb` wins. Without a boundary, the place takes `addr:city`, then the nearest suburb or town within about 5 km.
- **Postcode** comes from `addr:postcode`, or else the postcode most of the suburb's addresses use. Suburbs with no addresses mapped in OSM (for example Richardson, ACT) have no postcode to learn, so none is shown.
- **Businesses** keep their type (`shop=supermarket`), brand and `opening_hours`. Hours are shown as "Open until 9 pm" in the place's own time zone.

## Verifying a deployment

```bash
API_URL=https://maps.example.com ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=... pnpm verify:stack
```

Checks health, map style, tiles, glyphs, search, reverse geocoding, fastest/explore/round-trip routing and discover against the real graph.

Performance for a heavy user (50,000 visited hexagons):

```bash
DATABASE_URL=postgres://wayfinder:...@localhost:5432/wayfinder GRAPHHOPPER_URL=http://localhost:8989 pnpm bench:explore 50000 20
```

## User feedback

Off by default. An admin turns it on under **Admin → App settings → User feedback**. People then see **Send feedback** in the web account menu and in Android Settings, within a minute. Reports arrive under **Admin → Feedback**: `dev` can read them, and `admin` can set a status, keep private notes and delete. Opening, changing and deleting a report are audited. Each person can send 5 reports an hour; screenshots are capped at 2 MB. Reports are deleted with the account when it is purged.

## Accounts

```bash
docker compose exec api node dist/cli.js bootstrap-admin you@example.com   # first admin, or promote
docker compose exec api node dist/cli.js create-invite 3 user             # invite codes
docker compose exec api node dist/cli.js reset-link you@example.com       # one-time reset link
```

There is no email service: password reset links are generated in the dashboard (**Users → Password reset link**) or by the CLI, and you send them yourself.

## Upgrading

```bash
git pull
docker compose build
docker compose up -d
```

Database migrations run automatically when the API and worker start. Both are safe to restart at any time; in-flight jobs are retried.

## Rotating secrets

- `JWT_SECRET`: change it in `infra/.env` and `docker compose up -d api`. Everyone is signed out (access tokens stop verifying; refresh tokens still work until the next sign-in, so also run *Sign out everywhere* for any account you're worried about).
- `POSTGRES_PASSWORD`: change the password inside Postgres first (`ALTER ROLE wayfinder PASSWORD '…'`), then update `.env` and recreate api/worker.

## Data and privacy

- Raw GPS points live in `track_points`; the host disk should be encrypted (LUKS).
- Users can export (`Settings → Download my data`) and delete their own account.
- Deleted users and trips are restorable for 7 days (**Admin → Recently deleted**), then a daily job removes them permanently.
- Every admin view of another person's data is recorded in the append-only audit log. The database role cannot update or delete audit rows (a trigger blocks it).
- Logs and metrics never contain coordinates, tokens or emails; error messages are scrubbed before storage.

## Troubleshooting

**Map is blank, routing returns 503**
The graph or tiles are missing. Check Admin → Overview → Map data, then run a refresh. GraphHopper waits for `/data/graphhopper/graph-current` and logs that it is waiting.

**`EACCES: permission denied, mkdir '/data/osm'`**
The `osmdata` volume was created before the worker image set ownership of `/data`. Fix:

```bash
docker compose down
docker volume rm wayfinder_osmdata
docker compose build worker && docker compose up -d
```

(A fresh named volume inherits the ownership baked into the image, so the worker can write to it.)

**Worker shows as down in the dashboard**
It writes a heartbeat every minute. Check `docker compose logs worker`; if the database was unreachable the worker exits and Docker restarts it.

**Coverage looks wrong for one person**
Admin → the user → *Rebuild coverage*. This recomputes their hexagons from their remaining trips (it runs automatically after a trip is deleted, restored or has its mode changed).

**A background job keeps failing**
Admin → Jobs & data shows the error output; fix the cause and press Retry. `process-tracks` and `rebuild-coverage` are safe to retry; they are idempotent.

**Explore routes are slow**
Check Admin → Performance → Routing (p95 per kind) and Routing engine calls. Explore makes several routing requests per response; heavy users mean bigger visited-area polygons. `bench:explore` reproduces it with a synthetic 50k-cell user.

**Disk filling up**
`/data` holds the OSM extract (~1 GB), the graph (a few GB), tiles (a few GB) and Planetiler sources/temp. `docker compose exec worker du -sh /data/*`. Old graphs are kept as `graph-previous` for one generation, and Planetiler temp files can be deleted between runs.
