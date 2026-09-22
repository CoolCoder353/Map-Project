#!/bin/sh
# Build a signed release APK inside Docker (no local Android SDK needed).
# Usage: EXPO_PUBLIC_API_URL=https://maps.example.com infra/scripts/build-apk.sh
# Signing: infra/android/release.keystore with its passwords in infra/android/keystore.env
# (both kept out of git) are used automatically. Keep them: an update only installs over an
# existing app when it is signed with the same key.
# Without a keystore each build is signed with a throwaway debug key, so updates need the app
# to be uninstalled first (which loses the offline queue and sign-in).
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IMAGE="${ANDROID_BUILD_IMAGE:-wayfinder-android-build}"
if [ -f "$ROOT/infra/android/keystore.env" ]; then
  . "$ROOT/infra/android/keystore.env"
  export ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS ANDROID_KEY_PASSWORD
fi
: "${EXPO_PUBLIC_API_URL:?set EXPO_PUBLIC_API_URL to your server, e.g. https://maps.example.com}"

# Build the Android SDK image on first use (accepts the Android SDK licences).
if [ -z "${ANDROID_BUILD_IMAGE:-}" ] && ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "Building $IMAGE (one-off, downloads the Android SDK and NDK)..."
  docker build -t "$IMAGE" -f "$ROOT/infra/docker/android.Dockerfile" "$ROOT/infra"
fi

# The container runs as root on your checkout: keep pnpm's store in a volume (not the repo) and
# hand every file it touched back to you when it exits, even on failure.
docker run --rm -t \
  -v "$ROOT":/workspace -w /workspace \
  -v wayfinder-apk-pnpm-store:/pnpm-store \
  -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
  -e EXPO_PUBLIC_API_URL -e CI=1 \
  -e GRADLE_OPTS="-Dorg.gradle.jvmargs=-Xmx6g -XX:MaxMetaspaceSize=1g" \
  -e ANDROID_KEYSTORE_PASSWORD -e ANDROID_KEY_ALIAS -e ANDROID_KEY_PASSWORD \
  "$IMAGE" sh -c '
    set -eu
    trap "chown -hR \"\$HOST_UID:\$HOST_GID\" /workspace/node_modules /workspace/apps /workspace/packages /workspace/dist /workspace/.gradle-docker 2>/dev/null || true" EXIT
    command -v pnpm >/dev/null 2>&1 || npm install -g pnpm@11.26.0
    pnpm install --frozen-lockfile --store-dir /pnpm-store
    cd apps/mobile
    npx expo prebuild --platform android --clean
    cd android
    if [ -f /workspace/infra/android/release.keystore ]; then
      ./gradlew assembleRelease \
        -Pandroid.injected.signing.store.file=/workspace/infra/android/release.keystore \
        -Pandroid.injected.signing.store.password="$ANDROID_KEYSTORE_PASSWORD" \
        -Pandroid.injected.signing.key.alias="$ANDROID_KEY_ALIAS" \
        -Pandroid.injected.signing.key.password="$ANDROID_KEY_PASSWORD"
    else
      ./gradlew assembleRelease
    fi
    mkdir -p /workspace/dist
    cp app/build/outputs/apk/release/app-release.apk /workspace/dist/wayfinder.apk
  '
echo "APK: $ROOT/dist/wayfinder.apk"
