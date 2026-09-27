#!/bin/bash
# Builds "Agentic Grove.app" into ~/Applications, so the Grove can live in the Dock.
#
# No packaging tool on purpose. The main process uses nothing but Electron and Node's own
# modules, so an app is just the Electron that `npm install` already downloaded, renamed, given
# the logo, with the built code inside it. Real packaging (signing, notarising, a DMG) is phase
# four; this is the smallest honest thing that puts an icon in the Dock today.
#
# It is a snapshot: after changing the code, run `npm run app` again to update it.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NAME="Agentic Grove"
DEST="$HOME/Applications/$NAME.app"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cd "$ROOT"

echo "1/4  Building the app code"
npx vite build --logLevel warn

echo "2/4  Cutting the icon from assets/logo.png"
swift scripts/make-icon.swift assets/logo.png "$WORK/icon.png"
ICONSET="$WORK/AppIcon.iconset"
mkdir "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z $size $size "$WORK/icon.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  sips -z $((size * 2)) $((size * 2)) "$WORK/icon.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$WORK/AppIcon.icns"

echo "3/4  Assembling $NAME.app"
APP="$WORK/$NAME.app"
cp -R node_modules/electron/dist/Electron.app "$APP"
RES="$APP/Contents/Resources"
cp "$WORK/AppIcon.icns" "$RES/electron.icns"
rm -f "$RES/default_app.asar"
mkdir -p "$RES/app"
cp -R dist dist-electron "$RES/app/"
# The menu-bar icon is read from disk by the main process, so it ships beside the code.
mkdir -p "$RES/app/assets"
cp -R assets/tray "$RES/app/assets/"
# Only what Electron needs to find and start the code.
cat > "$RES/app/package.json" <<JSON
{ "name": "agentic-grove", "productName": "$NAME", "version": "$(node -p "require('./package.json').version")", "type": "module", "main": "dist-electron/main.js" }
JSON

PLIST="$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleName $NAME" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName $NAME" "$PLIST" 2>/dev/null ||
  /usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string $NAME" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.adiezc.agentic-grove" "$PLIST"

# Changing anything inside a signed app breaks its signature, and Apple Silicon refuses to run
# broken ones. An ad-hoc signature is enough for your own machine; it is not a release signature.
codesign --force --deep --sign - "$APP" 2>/dev/null

echo "4/4  Installing to $DEST"
mkdir -p "$HOME/Applications"
rm -rf "$DEST"
mv "$APP" "$DEST"
# Nudge Finder and the Dock to pick up the new icon rather than a cached one.
touch "$DEST"

echo "Done. Open it with:  open \"$DEST\""
