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
BACKEND_SELF_CHECK_PATH="$DESKTOP_DIR/.dueflow-backend-self-check.json"
BACKEND_FILE_NAME="dueflow-backend"

TARGET_TRIPLE="$(rustc --print host-tuple 2>/dev/null || rustc -Vv | awk '/^host:/ {print $2}')"
if [[ -z "$TARGET_TRIPLE" || ! "$TARGET_TRIPLE" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "Could not determine a valid Rust target triple." >&2
  exit 2
fi
BACKEND_BUILD_PATH="$DESKTOP_DIR/src-tauri/binaries/dueflow-backend-$TARGET_TRIPLE"
BACKEND_SUPPORT_BUILD_PATH="$DESKTOP_DIR/src-tauri/binaries/.dueflow-backend"
BACKEND_APP_PATH="$APP_PATH/Contents/MacOS/$BACKEND_FILE_NAME"
BACKEND_SUPPORT_APP_PATH="$APP_PATH/Contents/Frameworks"

cd "$DESKTOP_DIR"
rm -f "$PREFLIGHT_SUMMARY_PATH" "$BACKEND_SELF_CHECK_PATH"
trap 'rm -f "$PREFLIGHT_SUMMARY_PATH" "$BACKEND_SELF_CHECK_PATH"' EXIT
if [[ "${DUEFLOW_SKIP_PREFLIGHT:-0}" != "1" ]]; then
  node scripts/run-preflight.mjs --json-out "$PREFLIGHT_SUMMARY_PATH"
else
  echo "Skipping DueFlow preflight because DUEFLOW_SKIP_PREFLIGHT=1"
fi

bash scripts/build-backend-sidecar.sh "$BACKEND_BUILD_PATH"
npm run tauri:build

if [[ ! -d "$APP_PATH" ]]; then
  echo "Expected app bundle not found: $APP_PATH" >&2
  exit 1
fi

install -m 755 "$BACKEND_BUILD_PATH" "$BACKEND_APP_PATH"
mkdir -p "$BACKEND_SUPPORT_APP_PATH"
cp -R "$BACKEND_SUPPORT_BUILD_PATH/." "$BACKEND_SUPPORT_APP_PATH/"
"$BACKEND_APP_PATH" --self-check >"$BACKEND_SELF_CHECK_PATH"
BACKEND_SHA="$(shasum -a 256 "$BACKEND_APP_PATH" | awk '{print $1}')"
BACKEND_SIZE="$(stat -f%z "$BACKEND_APP_PATH")"

rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"

(
  cd "$(dirname "$APP_PATH")"
  COPYFILE_DISABLE=1 ditto -c -k --norsrc --noextattr --noqtn --noacl --keepParent "$APP_NAME" "$ZIP_PATH"
)

(
  cd "$RELEASE_DIR"
  shasum -a 256 "$(basename "$ZIP_PATH")" >"$(basename "$SHA_PATH")"
)

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
  --bytes "$ZIP_SIZE" \
  --backend "$BACKEND_FILE_NAME" \
  --backend-sha256 "$BACKEND_SHA" \
  --backend-bytes "$BACKEND_SIZE" \
  --backend-self-check "$BACKEND_SELF_CHECK_PATH"

echo "Release bundle: $ZIP_PATH"
echo "SHA256: $ZIP_SHA"
echo "Manifest: $MANIFEST_PATH"
echo "Bundled backend: $BACKEND_APP_PATH"
echo "Bundled backend support: $BACKEND_SUPPORT_APP_PATH"
echo "Bundled backend SHA256: $BACKEND_SHA"
