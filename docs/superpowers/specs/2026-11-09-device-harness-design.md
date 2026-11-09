# Device harness: design

Date: 2026-11-09

## Purpose

Claude (and anyone else) needs to see and drive the Android app and its Android Auto car app the
way a person would: take screenshots of the phone and the car screen, tap and type, set where the
phone and car think they are, and replay a drive. Today that is loose `adb` commands in
`docs/development.md`, the car side has never been run (every box in the Desktop Head Unit
checklist in `docs/verification.md` is open), and nothing about it is tested.

Success: `pnpm device …` commands that do each of those things on the user's phone with the
Desktop Head Unit (DHU), or on the local emulator for phone-only work, without any risk to the
user's account and data, their phone, or the beta testers' shared data.

## Findings (spike, 2026-11-09)

- **Android Auto does not run on an emulator.** On the Android 16 Google Play emulator image
  Android Auto is a stub (`1.2.551000-stub`) and Play refuses the update ("This app isn't
  compatible with your device anymore"). Google documents the DHU only with a real phone. The one
  community recipe for an emulator roots it with Magisk and sideloads Android Auto from APK
  mirrors through an installer that pretends to be Play, with Xposed modules; rejected as fragile
  and untrusted. The Android Automotive OS emulator tests a different host, not Android Auto.
- **The DHU runs here** (`extras;google;auto` 2.0, with Arch's `libc++` installed) and its console,
  read from stdin, has what the harness needs: `screenshot file.png`, `tap x y`,
  `location lat long [accuracy] [altitude] [speed] [bearing]`, `day`/`night`, `keycode …`,
  `restrict none|all`, and `--headless`.
- **The car's location is separate from the phone's.** The car app reads the car's own GPS
  through `CarHardwareManager` (`CarLocation.kt`), which the DHU's `location` command sets, and
  falls back to the phone's.
- **The live server is shared with the beta testers.** Learned road speeds (`road-speeds.ts`) and
  waits at lights (`light-timing.ts`) combine drives from two or more people. Navigation records a
  trip whether or not tracking is on, so a replayed drive from a second account would count as a
  second person agreeing, and change routes the testers get.
- **The app's upload queue isn't tied to an account.** Recorded points wait in a local SQLite
  queue (`tracking/queue.ts`, `sqliteStore.ts`) with no account on them, and signing out
  (`lib/session.tsx`) doesn't touch it. Points recorded on one account and not yet uploaded are
  sent under whichever account signs in next. With the harness, a replayed drive could land in
  the user's own trips and coverage; the same happens to any tester who switches accounts.

## Decisions

- Car side: the user's real phone over USB with the DHU. Phone-only work can also use the
  existing headless emulator (`infra/scripts/android-emulator.sh`).
- Interface: a CLI, `pnpm device <command>`, called through Bash; screenshots are written as PNGs
  and their paths printed. No MCP server.
- Server: the live server (`maps.coolcodertech.com`), the same one the beta testers use.
- App: the normal Wayfinder app (`app.wayfinder.maps`) as installed from Play. No separate build.
- Account: a test account the user creates and signs in on that app before handing the phone
  over; Claude never handles its password. The harness signs it out when testing ends.

## Accounts

- **A "test account" flag on users** (new). Migration `011_test_accounts.sql` adds
  `users.test_account boolean NOT NULL DEFAULT false`. The road-speed and light-timing jobs leave
  out drives by test accounts, exactly as they already leave out deleted and disabled accounts, so
  replayed drives never reach anyone else's routes. The account keeps the ordinary `admin` role,
  so it can see everything an admin can; every existing role check is unchanged.
- Admins set the flag on the user's page in `/admin` (a "Test account" switch, saying its drives
  don't count towards learned speeds or light timings), through the existing user `PATCH`, with an
  audit entry `user.test_account_change`. The admin user list and detail show it. The shared
  schemas, `docs/api.md` and the admin copy are updated.
- **The user creates the account** (for example `claude-harness@…`), makes it an admin, switches
  on Test account, and signs it in on the Wayfinder app on the phone before handing it over, and
  in the browser pane for admin checks. Claude never sees, stores or types its password.
- **Signed out when testing ends.** `pnpm device down` (and Ctrl-C or a crash, best effort) signs
  the test account out through the app's own Sign out, leaving the sign-in screen for the user to
  sign back in to their own account. If it can't, `down` says plainly that the phone is still
  signed in to the test account.
- `.harness/config.json` (git-ignored) holds the test account's email and the registered phone's
  serial; no secrets.

## Upload queue tied to the account (app fix)

- Each queued point records the account it was recorded under (a new column in the SQLite queue,
  added by the store's own schema upgrade; points already queued before the upgrade belong to
  whoever is signed in when it runs). Sync only claims and uploads the signed-in account's points.
  Another account's points wait until that account signs in again on the phone.
- Signing out first tries to upload what is queued for the account leaving (so nothing is held
  back when there's signal), then signs out as now.
- Ships in the next release to internal testing (`pnpm play upload`, internal track only). Until
  the phone has that version, the harness refuses `drive` and `gps` on the phone (it reads the
  installed version code), as the fake drive could otherwise reach the user's account.

## Safeguards

1. **Fixed set of phone commands.** The harness only ever sends: screenshot, UI dump, `input`
   tap/text/keyevent/swipe, read logcat, start Wayfinder, read its installed version, the location
   test-provider commands, and `forward` for the DHU. It never installs or uninstalls anything on
   a real phone (the Play build stays; installing is for the emulator only). There
   is no raw shell passthrough to a real phone, and nothing like `pm clear`, `rm`, `reboot` or
   `settings put`. Every adb call goes through one builder; a test checks no command outside the
   list can be produced.
2. **Never the wrong device.** A real phone must be registered once (`pnpm device register
   <serial>`); with an unregistered phone, or several devices and none named, every command
   refuses. Emulators need no registration.
3. **Taps only in Wayfinder.** Before each phone tap, type, key or swipe the harness reads the
   foreground app and refuses unless it is `app.wayfinder.maps` or one of a short list of
   Android dialogs the app causes (location and notification permission prompts). The refusal
   names what is in front. Car taps: the harness checks that the car's foreground app is Wayfinder,
   so a tap never lands in Android Auto's dialler or messages. How to read that reliably is
   the first thing the plan checks; if there is no reliable signal, car taps are not built and the
   user is asked before going further.
4. **Fake GPS always switched off.** `down`, Ctrl-C, and a crash all remove the phone's test
   location provider and revoke the shell's mock-location permission; `gps reset` does it on
   demand. The car's location only exists while the DHU runs, and `down` stops the DHU.
5. **Only ever the test account.** At `up`, and again before every tap, type, `gps` and `drive`,
   the harness checks the app is signed in to the email in `.harness/config.json` (read from the
   app's account screen at `up`, then tracked: a sign-out or sign-in seen on screen stops the
   harness until `up` checks again). Signed in to anything else, including the user's own
   account, every command but `shot`, `ui`, `logs` and `down` refuses. The test account's drives
   never reach shared data (above), and the queue fix keeps them out of the user's account.
6. **Screenshots stay local.** They go under `.harness/shots/`, which git ignores.
7. **Reversible phone changes only.** Android Auto developer settings and head unit server, and
   the shell's mock-location permission, each listed in the docs with how to undo it.
8. **Admin is look-only.** The harness has no admin commands. Claude uses the admin pages in the
   browser pane to check things, and asks the user before changing anything there (settings,
   users, invites, feedback), each time, because it is the testers' server.

## Commands

| Command | Does |
|---|---|
| `register <serial>` / `devices` | Register the phone; list devices and which are allowed |
| `up [--emulator] [--car] [--window]` | Check the device, the app's version and the signed-in account, open Wayfinder; with `--car`, `adb forward` and start the DHU (headless unless `--window`) |
| `install <apk>` | Emulator only: install an APK built for it |
| `shot phone\|car [--out f.png]` | Screenshot; prints the path |
| `ui` | Compact list of what is on the phone screen: text, id, centre point |
| `tap <text>` / `tap <x> <y>` / `tap car <x> <y>` | Tap by visible text or position |
| `type <text>`, `key back\|home\|enter`, `swipe x1 y1 x2 y2` | Text and keys on the phone |
| `gps <lon> <lat> [--phone\|--car]` / `gps reset` | Set both locations (or one); coordinates are `[lon, lat]` |
| `drive <route.gpx\|.geojson> [--speed kmh]` | Replay a route: a fix a second along it at that speed, to the phone and the car, with speed and bearing |
| `car day\|night\|key <code>\|restrict on\|off` | DHU console |
| `logs` | Crashes and app/car logs since the last call |
| `down` | Sign the test account out, remove test GPS and port rules, stop the DHU (and an emulator the harness started) |

- Phone GPS: on the emulator `adb emu geo fix`; on a phone Android's test location provider
  (`cmd location providers add-test-provider` / `set-test-provider-location`, after
  `appops set com.android.shell android:mock_location allow`). Checked on the user's phone early
  in the plan; if it doesn't work there, phone GPS on the phone is dropped and the car's location
  alone is used.
- DHU control: the harness starts the DHU with its stdin on a FIFO under `.harness/` and writes
  console commands to it; `shot car` sends `screenshot` and waits for the file.
- One sample route, Brisbane CBD to Mt Coot-tha Lookout, is checked in as GeoJSON for `drive`.

## Code

- `scripts/device/`: `cli.ts` (argument parsing, dispatch), `adb.ts` (the one command builder and
  device selection), `guard.ts` (foreground and account checks), `ui.ts` (uiautomator XML to
  elements, text to tap point), `route.ts` (GPX/GeoJSON reading, points at a speed with bearing),
  `dhu.ts` (start, FIFO, commands), `session.ts` (state in `.harness/`, cleanup on every exit).
  Each takes a runner, so tests use a fake adb and DHU.
- `pnpm device` in the root `package.json`; `.harness/` in `.gitignore`.
- The server change is ordinary repo code (migration, `packages/core` services, API route,
  shared schema, admin page) and follows the existing patterns for user role and disabled.

## Testing

- Server: integration tests (PGlite) that a test account's drives are left out of road speeds and
  light timings while another account's same drives count; the admin `PATCH` sets and clears the
  flag with an audit entry, and a non-admin can't. Web component test for the switch.
- Mobile (Jest): points are queued under the signed-in account; sync uploads only that account's
  points and leaves another's waiting until it signs in again; points from before the upgrade go
  to the signed-in account; sign-out uploads first and still signs out offline. One test fails
  without the fix: a point recorded on account A and uploaded after B signs in reaches B.
- Harness (Vitest, `scripts/test/device/`, in `pnpm check`, with `scripts/device/**` under a
  coverage floor): command builder never emits a disallowed command; device selection refuses
  unregistered phones and ambiguous sets; guard refuses taps outside Wayfinder and drives on
  any account but the configured one, and on a phone app version without the queue fix; `down`
  signs out only the test account; UI dump parsing and tap-by-text (including text that isn't
  there or appears twice); route reading and spacing (one point, very short, a GPX with
  timestamps, bearing on each leg); cleanup
  runs on `down`, on an error, and on SIGINT; `install` refuses another package.
- On the device (not in `pnpm check`, needs the phone): one run through `up --car`, `shot` of
  both screens, `tap` by text, `gps`, a short `drive` with the car's directions following, and
  `down` leaving the app signed out, no test provider (`cmd location providers list`) and no DHU.
  Recorded in
  `docs/verification.md`, with any Android Auto checklist items it actually covered ticked and dated.

## Docs

- `docs/development.md`: a "Device harness" section replacing the loose adb table: setup (DHU,
  `libc++`, Android Auto developer settings, register the phone, build and sign in the harness
  app), commands, safeguards, and how to undo the phone changes.
- `docs/testing.md` feature map (test accounts, the queue fix, the harness), `docs/api.md` (user `PATCH`), `docs/architecture.md` (test
  accounts in the learning jobs), `docs/verification.md`.

## Out of scope

- Running Android Auto on an emulator, an MCP server, video recording, planning routes inside the
  harness, other users' phones.
- Leaving test accounts out of usage metrics on the admin dashboard; they still count there.

## Cleanup

- The `wayfinder-play` emulator made during the spike has the user's Google account signed in.
  Delete it and its image (`system-images;android-36;google_apis_playstore;x86_64`, about 1.5 GB)
  once the user confirms.
