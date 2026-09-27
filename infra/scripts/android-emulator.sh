#!/bin/sh
# A local Android emulator for testing the app, with no window (drive it with adb).
# Usage: infra/scripts/android-emulator.sh setup|start|stop|install [apk]
#   setup    one-off: JDK 21, Android command-line tools, emulator and an Android 16 image under
#            ~/Android (about 6 GB), and a Pixel 7 device called "wayfinder"
#   start    boot it in the background and wait until Android is ready
#   stop     shut it down
#   install  install an APK (default dist/wayfinder.apk) and open the app
# Needs hardware virtualisation (/dev/kvm): SVM or VT-x switched on in the BIOS.
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ANDROID_DIR="${ANDROID_DIR:-$HOME/Android}"
export JAVA_HOME="${JAVA_HOME:-$ANDROID_DIR/jdk}"
export ANDROID_HOME="${ANDROID_HOME:-$ANDROID_DIR/Sdk}"
AVD=wayfinder
IMAGE="system-images;android-36;google_apis;x86_64"
CMDLINE_TOOLS_VERSION=13114758 # keep in step with infra/docker/android.Dockerfile
ADB="$ANDROID_HOME/platform-tools/adb"
LOG="${TMPDIR:-/tmp}/wayfinder-emulator.log"

setup() {
  [ -r /dev/kvm ] || { echo "No /dev/kvm: switch on SVM (AMD) or VT-x (Intel) in the BIOS." >&2; exit 1; }
  tmp="$(mktemp -d)"
  if [ ! -x "$JAVA_HOME/bin/java" ]; then
    mkdir -p "$JAVA_HOME"
    curl -fsSL -o "$tmp/jdk.tar.gz" "https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jdk/hotspot/normal/eclipse"
    tar -xzf "$tmp/jdk.tar.gz" -C "$JAVA_HOME" --strip-components=1
  fi
  if [ ! -x "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" ]; then
    mkdir -p "$ANDROID_HOME/cmdline-tools"
    curl -fsSL -o "$tmp/clt.zip" "https://dl.google.com/android/repository/commandlinetools-linux-${CMDLINE_TOOLS_VERSION}_latest.zip"
    unzip -q "$tmp/clt.zip" -d "$tmp"
    mv "$tmp/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
  fi
  rm -rf "$tmp"
  sdk="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
  yes | "$sdk" --licenses > /dev/null 2>&1 || true
  # The image download is large and occasionally fails mid-transfer; sdkmanager resumes on retry.
  for _ in 1 2 3; do
    "$sdk" --install platform-tools emulator "$IMAGE" > /dev/null 2>&1 || true
    [ -f "$ANDROID_HOME/system-images/android-36/google_apis/x86_64/system.img" ] && [ -x "$ADB" ] && break
  done
  [ -x "$ADB" ] || { echo "SDK install failed; rerun setup." >&2; exit 1; }
  echo no | "$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" create avd -n "$AVD" -k "$IMAGE" -d pixel_7 --force > /dev/null
  cfg="$HOME/.android/avd/$AVD.avd/config.ini"
  sed -i -e '/^hw.ramSize=/d' -e '/^hw.keyboard=/d' -e '/^disk.dataPartition.path=/d' "$cfg"
  printf 'hw.ramSize=4096\nhw.keyboard=yes\n' >> "$cfg"
  sed -i 's/^disk.dataPartition.size=.*/disk.dataPartition.size=8G/' "$cfg"
  echo "Ready. Start it with: infra/scripts/android-emulator.sh start"
}

start() {
  if "$ADB" devices | grep -q '^emulator-'; then echo "Already running."; return; fi
  nohup "$ANDROID_HOME/emulator/emulator" -avd "$AVD" -no-window -no-audio -no-boot-anim \
    -gpu swiftshader_indirect > "$LOG" 2>&1 &
  "$ADB" wait-for-device
  i=0
  until [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; do
    i=$((i + 1)); [ $i -gt 100 ] && { echo "Didn't finish booting; see $LOG" >&2; exit 1; }
    sleep 3
  done
  echo "Booted (log: $LOG)."
}

case "${1:-}" in
  setup) setup ;;
  start) start ;;
  stop) "$ADB" emu kill ;;
  install)
    "$ADB" install -r "${2:-$ROOT/dist/wayfinder.apk}"
    "$ADB" shell monkey -p app.wayfinder.maps -c android.intent.category.LAUNCHER 1 > /dev/null 2>&1
    ;;
  *) echo "usage: $0 setup|start|stop|install [apk]" >&2; exit 1 ;;
esac
