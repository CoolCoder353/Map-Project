#!/bin/sh
# Renders the Wayfinder logo into the PNGs the apps need. The source of truth is
# apps/web/public/logo-mark.svg (the whole mark) and infra/logo/adaptive-*.svg (Android's
# adaptive-icon layers, drawn inside its safe zone). Needs rsvg-convert (librsvg).
set -eu
cd "$(dirname "$0")/../.."
MARK=apps/web/public/logo-mark.svg
OUT=apps/mobile/assets/icons
WEB=apps/web/public
rsvg-convert -w 1024 -h 1024 "$MARK" -o "$OUT/icon.png"
rsvg-convert -w 512 -h 512 "$MARK" -o "$OUT/play-store-icon.png"
rsvg-convert -w 432 -h 432 infra/logo/adaptive-foreground.svg -o "$OUT/adaptive-foreground.png"
rsvg-convert -w 432 -h 432 infra/logo/adaptive-monochrome.svg -o "$OUT/adaptive-monochrome.png"
rsvg-convert -w 180 -h 180 "$MARK" -o "$WEB/apple-touch-icon.png"
rsvg-convert -w 192 -h 192 "$MARK" -o "$WEB/icon-192.png"
rsvg-convert -w 512 -h 512 "$MARK" -o "$WEB/icon-512.png"
