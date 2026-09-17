#!/bin/sh
# Download the Noto Sans glyph PBFs used by the map style into infra/map-assets/fonts.
set -eu
DIR="$(cd "$(dirname "$0")/.." && pwd)/map-assets/fonts"
mkdir -p "$DIR"
TMP="$(mktemp -d)"
curl -fL -o "$TMP/noto-sans.zip" https://github.com/openmaptiles/fonts/releases/download/v2.0/noto-sans.zip
unzip -q -o "$TMP/noto-sans.zip" -d "$DIR"
rm -rf "$TMP"
ls "$DIR"
