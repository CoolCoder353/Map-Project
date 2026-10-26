# Android Auto Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Android Auto (car module) tests fast to run, floor-protected for coverage, complete for the untested code, and backed by an opt-in emulator launch check.

**Architecture:** Keep `infra/scripts/test-android-native.sh` as the single entry, split into prepare and run phases with a stamp. JaCoCo is configured in the module's `build.gradle`. The emulator check reuses `infra/scripts/android-emulator.sh`.

**Tech Stack:** sh, Docker, Gradle, JaCoCo, Robolectric, Vitest (script tests), adb.

**Spec:** `docs/superpowers/specs/2026-10-27-android-auto-testing-design.md`

## Global Constraints

- Every change passes `pnpm check`; no test is skipped, deleted or weakened; floors only go up.
- Each task is one commit on `master`; no branches. Commit message: short subject, then prose on what was wrong and why the change fixes it, ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- `CI=true` for pnpm in non-interactive shells. Don't run pnpm, Jest or Vitest while `pnpm test:android` runs (it swaps `node_modules`).
- `pnpm test:android:dhu` is not part of `pnpm check`.
- Docs stay current: `docs/testing.md`, `docs/verification.md`, `docs/development.md`.

## Review Focus

- Stamp is stale after `pnpm-lock.yaml`, `apps/mobile/app.json` or the module `build.gradle` changes: prepare must re-run.
- No stamp (fresh clone, CI): prepare must run, never skip.
- A failing test must still restore this machine's `node_modules` and exit non-zero.
- `-- --tests` with no match must fail, not pass silently.
- No `/dev/kvm` or no emulator: the smoke prints a skip and exits 0, and does not tick the checklist.

---

### Task 1: Faster inner loop

**Files:**
- Modify: `infra/scripts/test-android-native.sh`
- Create: `apps/mobile/test/androidTestScript.test.ts`
- Modify: `docs/testing.md`, `docs/development.md`

**Interfaces:**
- Produces: `pnpm test:android [-- <gradle test args>]`, e.g. `-- --tests '*HomeScreenTest'`. The args are appended to `./gradlew :wayfinder-car:testDebugUnitTest`.
- Produces: stamp file `apps/mobile/android/.prepare-stamp` holding a sha256 of `pnpm-lock.yaml`, `apps/mobile/app.json` and the module's `android/build.gradle`.

- [ ] **Step 1: Write failing tests in `androidTestScript.test.ts`** (same style as `buildScript.test.ts`): `is valid shell`; `passes extra arguments to the Gradle test task` (script text contains `"$@"` after `testDebugUnitTest`); `skips prepare only when the stamp matches` (script text compares the stamp and wraps `expo prebuild` in that condition); `keeps the Gradle cache in a named volume`; `restores node_modules after a failure` (the restore block sits outside the `|| status=$?` path, as today).
- [ ] **Step 2:** `npx vitest run apps/mobile/test/androidTestScript.test.ts`. Expect FAIL on the new assertions.
- [ ] **Step 3: Edit the script.** Compute the stamp with `sha256sum` over the three files. Run install and prebuild inside the container only when `apps/mobile/android/.prepare-stamp` is missing or differs, and write it after a successful prepare. Pass `"$@"` through `sh -c '...' _ "$@"` to Gradle. Add `-v wayfinder-gradle-cache:/root/.gradle`. Add `--tests` handling note: Gradle already fails on no match.
- [ ] **Step 4:** Rerun the Vitest file; expect PASS. Then run `CI=true pnpm test:android -- --tests '*HomeScreenTest'` twice. Expect: first prepares and passes; second skips prepare and is much faster.
- [ ] **Step 5:** Document the commands in `docs/testing.md` (commands table) and `docs/development.md`. Run `CI=true pnpm test` and commit.

### Task 2: Kotlin coverage floor

**Files:**
- Modify: `apps/mobile/modules/wayfinder-car/android/build.gradle`, `infra/scripts/test-android-native.sh`, `docs/testing.md`, `.gitignore`

**Interfaces:**
- Produces: Gradle task `:wayfinder-car:jacocoCarCoverageVerification`, run after the tests by the script, plus an HTML report copied to `apps/mobile/coverage-android/`.
- Consumes: Task 1's argument pass-through (verification is skipped when `--tests` is given, because a partial run can't meet the floor).

- [ ] **Step 1:** Add the `jacoco` plugin and a `jacocoCarCoverageReport` task (HTML and XML) over `testDebugUnitTest` with class excludes for generated code (`**/R.class`, `**/BuildConfig.*`) and `bridge/ReactBoot*` only.
- [ ] **Step 2:** Run the full `CI=true pnpm test:android`; read the line and branch figures from the report.
- [ ] **Step 3:** Add `jacocoCarCoverageVerification` with line and branch minimums just under those figures. Verify the failure path by temporarily raising a minimum above the figure; expect a non-zero exit and restored `node_modules`. Revert the temporary value.
- [ ] **Step 4:** Copy the report to `apps/mobile/coverage-android/` and gitignore it. List each exclusion with its reason, and the floors, in `docs/testing.md`. Commit.

### Task 3: Gap tests

**Files:**
- Create: Kotlin tests under `apps/mobile/modules/wayfinder-car/android/src/test/java/app/wayfinder/car/` for the lowest-coverage classes in the Task 2 report (expected `WayfinderSession`, `map/CarMapRenderer`, `WayfinderCarAppService`).
- Modify: `build.gradle` floors, `docs/testing.md` feature map

**Interfaces:**
- Consumes: `FakeCarApi`, `Samples`, `TestKit.TestCarContext`.

- [ ] **Step 1:** From the report, list every class under 70% line coverage and choose the ones holding user-visible behaviour. Skip trivial getters.
- [ ] **Step 2:** For each, write a test named for the behaviour (e.g. `session starts on Home when the phone app is stopped`) and run it with `-- --tests '*<Class>Test'`. Where a test passes at once, confirm it can fail by breaking the code briefly.
- [ ] **Step 3:** Rerun the full suite, raise the floors to just under the new figures, update the feature map row for Android Auto, and commit per class group.

### Task 4: Emulator launch check

**Files:**
- Create: `infra/scripts/test-android-dhu.sh`
- Modify: `package.json` (`"test:android:dhu": "sh infra/scripts/test-android-dhu.sh"`), `apps/mobile/test/androidTestScript.test.ts`, `docs/verification.md`, `docs/testing.md`

**Interfaces:**
- Consumes: `infra/scripts/android-emulator.sh start|install|stop`, and the debug APK.
- Produces: exit 0 on pass or on a skip (`skipped: no KVM` or `skipped: emulator not set up`), non-zero on failure.

- [ ] **Step 1: Write failing script tests:** `is valid shell`; `skips with exit 0 when /dev/kvm is unreadable` (run the script with `WF_KVM_PATH=/nonexistent`, expect stdout containing `skipped: no KVM` and status 0); `is not part of pnpm check`.
- [ ] **Step 2:** Run the file; expect FAIL.
- [ ] **Step 3:** Write the script. Skip checks first. Then start the emulator and install the APK. Launch the car app through the Desktop Head Unit (`adb shell am start` of the DHU service, or the DHU binary if the SDK ships it; check `~/Android/Sdk/extras/google/auto`). Poll up to 5 s for the Home screen, via `uiautomator dump` text or the DHU log. Fail with the log tail if it never appears. Always stop the emulator on exit.
- [ ] **Step 4:** Rerun the Vitest file; expect PASS. If `android-emulator.sh setup` has been run, run `pnpm test:android:dhu` for real. Only tick the matching box in `docs/verification.md`, with the date, if it passed here; otherwise say in that file that the script exists but is unrun.
- [ ] **Step 5:** Document the command in `docs/testing.md`. Run the full `pnpm check`. Commit and push.

## Self-review

Spec coverage: loop (Task 1), floor (Task 2), gaps (Task 3), emulator (Task 4), docs updated in each task. Names are consistent: `.prepare-stamp`, `jacocoCarCoverageVerification`, `test:android:dhu`. Risks from the spec (KVM, first coverage figure, debug build only) are handled in Tasks 2 and 4.
