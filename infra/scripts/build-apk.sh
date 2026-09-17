#!/bin/sh
# Build a signed release APK inside Docker (no local Android SDK needed).
# Usage: EXPO_PUBLIC_API_URL=https://maps.example.com infra/scripts/build-apk.sh
# Signing: put your keystore at infra/android/release.keystore and set
#   ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD.
# Without a keystore a debug-signed APK is produced (fine for sideloading to friends).
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IMAGE="${ANDROID_BUILD_IMAGE:-reactnativecommunity/react-native-android:latest}"
: "${EXPO_PUBLIC_API_URL:?set EXPO_PUBLIC_API_URL to your server, e.g. https://maps.example.com}"

docker run --rm -t \
  -v "$ROOT":/workspace -w /workspace \
  -e EXPO_PUBLIC_API_URL -e CI=1 \
  -e ANDROID_KEYSTORE_PASSWORD -e ANDROID_KEY_ALIAS -e ANDROID_KEY_PASSWORD \
  "$IMAGE" sh -c '
    set -eu
    corepack enable >/dev/null 2>&1 || npm install -g pnpm@11.26.0
    pnpm install --frozen-lockfile
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
