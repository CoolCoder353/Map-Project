# Android Auto testing: design

Date: 2026-10-27

## Purpose

The Android Auto car app (`apps/mobile/modules/wayfinder-car`) is tested by Robolectric Kotlin
tests run through `pnpm test:android`. The rest of the repo has coverage floors, fast single-file
runs and a feature map; the car tests have gaps against that standard. Success means a car change
can be tested in seconds, loses coverage visibly rather than silently, and has its launch checked
on an emulator when one is available.

## Findings

- Jest and Vitest have coverage floors. The Kotlin tests have none, although `docs/testing.md`
  says `pnpm check` runs "the Android tests with theirs".
- Every `pnpm test:android` run does `pnpm install` and `expo prebuild --clean` in Docker, then
  every test. There is no way to run one test class.
- The Desktop Head Unit checklist in `docs/verification.md` has never been run, and nothing
  automates any of it.

## Scope

Four steps, each its own commit on `master`, each with `pnpm check` passing.

### 1. Faster inner loop

- Split `infra/scripts/test-android-native.sh` into prepare (install, `expo prebuild`) and run
  (Gradle). Skip prepare when a stamp of the lockfile, `apps/mobile/app.json` and the module's
  `build.gradle` matches the last prepare.
- Accept Gradle test filters: `pnpm test:android -- --tests '*HomeScreenTest'`.
- Keep the Gradle cache in a Docker volume.
- `pnpm check` runs the full path, with a forced prepare when the stamp is missing.
- Test: a script test (`apps/mobile/test/buildScript.test.ts` style) that the filter argument is
  passed through and the stamp logic skips and re-runs correctly.

### 2. Kotlin coverage floor

- Add JaCoCo to `wayfinder-car/android/build.gradle`, with a verification rule just under the
  measured figure (line and branch), failing the run below it.
- HTML report to `apps/mobile/coverage-android/`.
- Exclusions: generated code and the React boot glue only, each listed and justified in
  `docs/testing.md`.
- Floors only go up (testing.md rule).

### 3. Gap tests

- Use the report to find untested car code (expected: `WayfinderSession`, `CarMapRenderer`,
  `ReactBoot`, `WayfinderCarAppService`). Add Robolectric tests with `FakeCarApi`, `Samples` and
  `TestKit`, then raise the floor to match.
- Update the feature map in `docs/testing.md`.

### 4. Emulator smoke (opt-in)

- `pnpm test:android:dhu`: boot an emulator with the Desktop Head Unit, install a debug APK,
  assert the car app starts and shows Home within 5 s.
- Not part of `pnpm check`: it needs KVM and an emulator image.
- Prints "skipped: no KVM" and exits 0 where unavailable.
- Automates the first item of the `docs/verification.md` head-unit checklist. The box is ticked
  only if it actually ran and passed here.

## Assumptions and risks

- `/dev/kvm` may be missing on this machine; step 4 would then be written but not run, and
  `verification.md` says so.
- The first JaCoCo figure may be lower than expected; the floor is set to what is measured.
- The APK's server address must be real; the smoke uses a debug build and no live server.

## Docs to update

`docs/testing.md` (commands table, coverage section, feature map), `docs/verification.md`,
`docs/development.md` if the commands change.
