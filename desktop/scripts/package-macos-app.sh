#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_NAME="DueFlow Desktop.app"
APP_PATH="$DESKTOP_DIR/src-tauri/target/release/bundle/macos/$APP_NAME"
RELEASE_DIR="$DESKTOP_DIR/release"

VERSION="$(node -p "require('./package.json').version")"
ARCH="$(uname -m)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BASE_NAME="DueFlow-Desktop_${VERSION}_${ARCH}_${STAMP}"
ZIP_PATH="$RELEASE_DIR/${BASE_NAME}.app.zip"
SHA_PATH="$ZIP_PATH.sha256"
MANIFEST_PATH="$RELEASE_DIR/${BASE_NAME}.manifest.json"
PREFLIGHT_SUMMARY_PATH="$DESKTOP_DIR/.dueflow-preflight-summary.json"

cd "$DESKTOP_DIR"
rm -f "$PREFLIGHT_SUMMARY_PATH"
if [[ "${DUEFLOW_SKIP_PREFLIGHT:-0}" != "1" ]]; then
  node scripts/run-preflight.mjs --json-out "$PREFLIGHT_SUMMARY_PATH"
else
  echo "Skipping DueFlow preflight because DUEFLOW_SKIP_PREFLIGHT=1"
fi
npm run tauri:build

if [[ ! -d "$APP_PATH" ]]; then
  echo "Expected app bundle not found: $APP_PATH" >&2
  exit 1
fi

rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"

(
  cd "$(dirname "$APP_PATH")"
  COPYFILE_DISABLE=1 ditto -c -k --norsrc --noextattr --noqtn --noacl --keepParent "$APP_NAME" "$ZIP_PATH"
)

shasum -a 256 "$ZIP_PATH" | tee "$SHA_PATH" >/dev/null

ZIP_SIZE="$(stat -f%z "$ZIP_PATH")"
ZIP_SHA="$(awk '{print $1}' "$SHA_PATH")"

node scripts/write-release-manifest.mjs \
  --manifest-out "$MANIFEST_PATH" \
  --preflight-summary "$PREFLIGHT_SUMMARY_PATH" \
  --version "$VERSION" \
  --arch "$ARCH" \
  --created-at "$STAMP" \
  --bundle "$(basename "$ZIP_PATH")" \
  --sha256 "$ZIP_SHA" \
  --bytes "$ZIP_SIZE"

rm -f "$PREFLIGHT_SUMMARY_PATH"

echo "Release bundle: $ZIP_PATH"
echo "SHA256: $ZIP_SHA"
echo "Manifest: $MANIFEST_PATH"
