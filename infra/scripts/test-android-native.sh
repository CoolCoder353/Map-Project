#!/bin/sh
# Run the Android Auto module's Kotlin tests (apps/mobile/modules/wayfinder-car) in the Android
# build image; no local Android SDK needed. Like build-apk.sh it prebuilds the native project, so
# it takes over node_modules while it runs and puts them back at the end, whether or not the tests
# pass.
# Usage: test-android-native.sh [gradle test args], e.g. --tests '*HomeScreenTest'
# The install and prebuild only run when the lockfile, app.json or the car module's build.gradle
# changed since the last run (apps/mobile/android/.prepare-stamp); Gradle's cache is kept in
# .gradle-docker. With a filter, only those tests run.
set -eu
[ "${1:-}" = -- ] && shift
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IMAGE="${ANDROID_BUILD_IMAGE:-wayfinder-android-build}"

if [ -z "${ANDROID_BUILD_IMAGE:-}" ] && ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "Building $IMAGE (one-off, downloads the Android SDK and NDK)..."
  docker build -t "$IMAGE" -f "$ROOT/infra/docker/android.Dockerfile" "$ROOT/infra"
fi

STAMP="$(cat "$ROOT/pnpm-lock.yaml" "$ROOT/apps/mobile/app.json" \
  "$ROOT/apps/mobile/modules/wayfinder-car/android/build.gradle" | sha256sum | cut -d' ' -f1)"

status=0
docker run --rm -t \
  -v "$ROOT":/workspace -w /workspace \
  -v wayfinder-apk-pnpm-store:/pnpm-store \
  -e STAMP="$STAMP" -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" -e CI=1 \
  -e GRADLE_OPTS="-Dorg.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1g" \
  "$IMAGE" sh -c '
    set -eu
    trap "chown -hR \"\$HOST_UID:\$HOST_GID\" /workspace/node_modules /workspace/apps /workspace/packages /workspace/.gradle-docker 2>/dev/null || true" EXIT
    command -v pnpm >/dev/null 2>&1 || npm install -g pnpm@11.26.0
    if [ "$(cat apps/mobile/android/.prepare-stamp 2>/dev/null)" != "$STAMP" ]; then
      pnpm install --frozen-lockfile --store-dir /pnpm-store
      (cd apps/mobile && npx expo prebuild --platform android --clean)
      echo "$STAMP" > apps/mobile/android/.prepare-stamp
    fi
    cd apps/mobile/android
    rc=0
    if [ "$#" -eq 0 ]; then
      # A full run also checks the coverage floor (wayfinder-car/android/build.gradle).
      ./gradlew :wayfinder-car:testDebugUnitTest :wayfinder-car:jacocoCarCoverageVerification || rc=$?
    else
      ./gradlew :wayfinder-car:testDebugUnitTest "$@" || rc=$?
    fi
    report=/workspace/apps/mobile/modules/wayfinder-car/android/build/reports/jacoco/jacocoCarCoverageReport/html
    if [ -d "$report" ]; then
      rm -rf /workspace/apps/mobile/coverage-android
      cp -r "$report" /workspace/apps/mobile/coverage-android
    fi
    exit "$rc"
  ' _ "$@" || status=$?

# The container installed node_modules against its own store; put this machine's back.
if command -v pnpm >/dev/null 2>&1 && grep -q '"storeDir": "/pnpm-store' "$ROOT/node_modules/.modules.yaml" 2>/dev/null; then
  (cd "$ROOT" && CI=true pnpm install --frozen-lockfile >/dev/null)
fi
exit "$status"
