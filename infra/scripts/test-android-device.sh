#!/bin/sh
# Checks the built APK on a local emulator (infra/scripts/android-emulator.sh): it installs, the
# phone app starts and stays up, and Android can find the car app service and the "navigate to"
# filter that Android Auto looks for. It does not draw Home on a head unit: that needs the Android
# Auto app on the phone, which this emulator image doesn't have (docs/verification.md).
# Usage: test-android-device.sh [apk]   (default dist/wayfinder.apk, or $WF_APK)
# Exits 0 with "skipped: ..." when it can't run here (no /dev/kvm, no APK, no emulator set up).
# Not part of pnpm check.
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ANDROID_DIR="${ANDROID_DIR:-$HOME/Android}"
export ANDROID_DIR
ANDROID_HOME="${ANDROID_HOME:-$ANDROID_DIR/Sdk}"
ADB="$ANDROID_HOME/platform-tools/adb"
EMULATOR_SH="$ROOT/infra/scripts/android-emulator.sh"
APK="${1:-${WF_APK:-$ROOT/dist/wayfinder.apk}}"
PKG=app.wayfinder.maps

[ -r "${WF_KVM_PATH:-/dev/kvm}" ] || { echo "skipped: no KVM (switch on SVM or VT-x in the BIOS)"; exit 0; }
[ -e "$APK" ] || { echo "skipped: no APK at $APK (build one: docs/build-android.md)"; exit 0; }
if [ ! -x "$ANDROID_HOME/emulator/emulator" ] || [ ! -x "$ADB" ] || [ ! -d "$HOME/.android/avd/wayfinder.avd" ]; then
  echo "skipped: emulator not set up (run: infra/scripts/android-emulator.sh setup)"
  exit 0
fi

STARTED_IT=0
if ! "$ADB" devices | grep -q '^emulator-'; then
  sh "$EMULATOR_SH" start
  STARTED_IT=1
fi
trap '[ "$STARTED_IT" = 1 ] && sh "$EMULATOR_SH" stop >/dev/null 2>&1 || true' EXIT

fail() { echo "FAIL: $1" >&2; exit 1; }

"$ADB" install -r "$APK" >/dev/null || fail "the APK didn't install"

# Android Auto finds the car app by these, so they have to resolve on a device, not only be in the manifest.
"$ADB" shell cmd package query-services --brief -a androidx.car.app.CarAppService -c androidx.car.app.category.NAVIGATION \
  | grep -q "$PKG/app.wayfinder.car.WayfinderCarAppService" || fail "the car app service isn't registered for Android Auto"
"$ADB" shell cmd package query-activities --brief -a androidx.car.app.action.NAVIGATE -c android.intent.category.DEFAULT -d "geo:-27.47,153.03" \
  | grep -q "$PKG/app.wayfinder.car.nav.NavigateActivity" || fail "nothing answers a geo: navigate request"

"$ADB" logcat -b crash -c
"$ADB" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 5
[ -n "$("$ADB" shell pidof "$PKG" | tr -d '\r')" ] || fail "the app isn't running 5 s after it was opened"
if "$ADB" logcat -b crash -d | grep -q "FATAL EXCEPTION"; then
  "$ADB" logcat -b crash -d | tail -20 >&2
  fail "the app crashed on start"
fi
echo "ok: installed, car service and navigate filter found, app running after 5 s"
