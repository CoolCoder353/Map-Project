#!/bin/sh
# Run the Android Auto module's Kotlin tests (apps/mobile/modules/wayfinder-car) in the Android
# build image; no local Android SDK needed. Like build-apk.sh it prebuilds the native project, so
# it takes over node_modules while it runs and puts them back at the end, whether or not the tests
# pass.
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IMAGE="${ANDROID_BUILD_IMAGE:-wayfinder-android-build}"

if [ -z "${ANDROID_BUILD_IMAGE:-}" ] && ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "Building $IMAGE (one-off, downloads the Android SDK and NDK)..."
  docker build -t "$IMAGE" -f "$ROOT/infra/docker/android.Dockerfile" "$ROOT/infra"
fi

status=0
docker run --rm -t \
  -v "$ROOT":/workspace -w /workspace \
  -v wayfinder-apk-pnpm-store:/pnpm-store \
  -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" -e CI=1 \
  -e GRADLE_OPTS="-Dorg.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1g" \
  "$IMAGE" sh -c '
    set -eu
    trap "chown -hR \"\$HOST_UID:\$HOST_GID\" /workspace/node_modules /workspace/apps /workspace/packages /workspace/.gradle-docker 2>/dev/null || true" EXIT
    command -v pnpm >/dev/null 2>&1 || npm install -g pnpm@11.26.0
    pnpm install --frozen-lockfile --store-dir /pnpm-store
    cd apps/mobile
    npx expo prebuild --platform android --clean
    cd android
    ./gradlew :wayfinder-car:testDebugUnitTest
  ' || status=$?

# The container installed node_modules against its own store; put this machine's back.
if command -v pnpm >/dev/null 2>&1 && grep -q '"storeDir": "/pnpm-store' "$ROOT/node_modules/.modules.yaml" 2>/dev/null; then
  (cd "$ROOT" && CI=true pnpm install --frozen-lockfile >/dev/null)
fi
exit "$status"
