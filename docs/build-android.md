# Building the Android app

The Android app is shared as a file, `dist/wayfinder.apk`, that people install by hand
([install-android.md](install-android.md) is the guide to send with it). This page is how to make
that file. You need Docker and nothing else: the Android SDK lives in a build image.

## Before you build

1. **The checks pass.** A crash that reaches a phone stays there until the next APK is shared.
   ```bash
   pnpm lint && pnpm typecheck && pnpm test && pnpm test:mobile && CI=true pnpm test:android
   ```
2. **Native modules match the Expo SDK.** A module from another SDK compiles, passes every test
   (Jest fakes native modules), and then kills the app on launch. The 2026-09-23 APK did exactly
   this with `expo-contacts`.
   ```bash
   cd apps/mobile && npx expo install --check
   ```
   A package on a different major version from `expo` (57) is the dangerous kind: install the
   version it names. Patch updates, and the test tools `jest` and `@types/jest`, are fine.
3. **The server is ready for this app.** The app is built from the same checkout as the server.
   If the API changed shape, deploy the server first
   ([deploy-small-server.md](deploy-small-server.md) for the live one), because the new app reads
   fields an older server doesn't send.
4. **The signing key is there:** `infra/android/release.keystore`, with its passwords in
   `infra/android/keystore.env`. Neither is in git; keep a copy somewhere safe. The build signs with
   it automatically. Android only installs an update over an app signed with the same key, so
   without it the build falls back to a throwaway debug key, and everyone has to uninstall first,
   losing their sign-in and any points not yet uploaded.
5. **Optional: give the build a new version.** `version` in `apps/mobile/app.config.ts` is what
   feedback reports come tagged with. Bump it (and `versionCode`) so a report says which build it
   came from.

## Build it

For the live server:

```bash
EXPO_PUBLIC_API_URL=https://maps.paulsjones.com infra/scripts/build-apk.sh
```

For another deployment, use the address its people will use, for example
`https://maps.your-group.org`. The address is **baked into the app**, pre-filled on the sign-in
screen, and it's where every request goes, so it has to be the real one.

What happens:

- The first build creates the `wayfinder-android-build` Docker image (JDK, Android SDK and NDK;
  several GB, one-off). Later builds reuse it.
- Inside the container: `pnpm install`, `expo prebuild` (regenerates `apps/mobile/android/`, which
  is not in git), then Gradle builds and signs a release APK. About 10 minutes.
- **It takes over `node_modules` while it runs.** Don't run pnpm, tests or dev servers until it
  finishes; it puts `node_modules` back at the end. If a build is interrupted, run
  `CI=true pnpm install`.
- **It overwrites `dist/wayfinder.apk`.** Copy the old file elsewhere first if you want to keep it.
- It refuses documentation addresses (`example.com`, `your-server`), refuses `http://` unless
  `ALLOW_HTTP=1`, and reads the address back out of the finished APK. The last line confirms it:
  ```
  APK: /…/dist/wayfinder.apk (server: https://maps.paulsjones.com)
  ```

Every build setting is listed in [configuration.md](configuration.md#android-build-infrascriptsbuild-apksh).

## Check it before sharing

1. **It opens.** Install it on the emulator ([development.md](development.md#emulator)) and look
   for a crash:
   ```bash
   infra/scripts/android-emulator.sh install
   ```
   ```bash
   ~/Android/Sdk/platform-tools/adb logcat -d | grep -E "FATAL|AndroidRuntime: "
   ```
   The sign-in screen should show the server's app name (for example "Sign in to PathFinder"),
   which proves the app reached the server. A build for the live server talks to real users' data,
   so look, but don't sign in with a real account or create anything there.
2. **The server answers everything the app asks for**, checked against the app's schemas. Use a
   throwaway account: it records five points and one feedback item.
   ```bash
   VERIFY_REGION=qld API_URL=https://maps.paulsjones.com EMAIL=… PASSWORD=… pnpm verify:mobile
   ```

To try a change end to end without touching real data, build against the local stack instead.
`10.0.2.2` is this machine as the emulator sees it:

```bash
EXPO_PUBLIC_API_URL=http://10.0.2.2:3000 ALLOW_HTTP=1 infra/scripts/build-apk.sh
```

That build only works on the emulator and accepts unencrypted traffic. Move it out of `dist/`
when you're done, so it can't be shared by mistake.

## Trying it in a car

Without a car, use Google's Desktop Head Unit (DHU):

1. Install it with the Android SDK tools: `sdkmanager "extras;google;auto"` (and `platform-tools`
   for `adb`).
2. On the phone: turn on Android Auto's developer settings and **Unknown sources**
   ([install-android.md](install-android.md), section 6), then in the **⋮** menu choose **Start
   head unit server**.
3. Connect the phone by USB with USB debugging on, then:

   ```bash
   adb forward tcp:5277 tcp:5277
   ```

   ```bash
   $ANDROID_HOME/extras/google/auto/desktop-head-unit
   ```

Type `day` or `night` in the DHU console to switch modes. For a drive without driving, replay a
GPX track with a mock-location app set in the phone's developer options.

## Share it

Send `dist/wayfinder.apk` (about 158 MB) with [install-android.md](install-android.md): a shared
drive or chat works, but email usually blocks APKs. A new build installs straight over the old
one, keeping people's sign-in, trips and settings, as long as it's signed with the same key.
Record the release in [verification.md](verification.md).

## When it goes wrong

| Symptom | Cause and fix |
|---|---|
| The app closes as soon as it opens; logcat shows `NoClassDefFoundError` or `NoSuchMethodError` | A native module from another Expo SDK. `npx expo install --check` in `apps/mobile`, install what it asks for, rebuild |
| Every screen says "Can't reach …" | Built with the wrong address. The last line of the build output shows the address baked in |
| "App not installed" when updating | Signed with a different key than the installed app: the keystore was missing or changed. Rebuild with the original, or have people uninstall first |
| Gradle runs out of memory | `build-apk.sh` passes `GRADLE_OPTS` (`-Xmx6g`); the machine needs that much free |
| `pnpm` errors or missing packages after a build | The build was interrupted before handing back `node_modules`: `CI=true pnpm install` |
