#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$DESKTOP_DIR/.." && pwd)"
PYTHON_BIN="${DUEFLOW_PYTHON:-python}"

if ! "$PYTHON_BIN" -c 'import PyInstaller' >/dev/null 2>&1; then
  echo "PyInstaller is required. Install requirements-release.txt in the active Conda environment." >&2
  exit 2
fi

TARGET_TRIPLE="$(rustc --print host-tuple 2>/dev/null || rustc -Vv | awk '/^host:/ {print $2}')"
if [[ -z "$TARGET_TRIPLE" || ! "$TARGET_TRIPLE" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "Could not determine a valid Rust target triple." >&2
  exit 2
fi

OUTPUT_PATH="${1:-$DESKTOP_DIR/src-tauri/binaries/dueflow-backend-$TARGET_TRIPLE}"
SUPPORT_OUTPUT_PATH="$(dirname "$OUTPUT_PATH")/.dueflow-backend"
BUILD_ROOT="$DESKTOP_DIR/.sidecar-build/$TARGET_TRIPLE"
DIST_DIR="$BUILD_ROOT/dist"
WORK_DIR="$BUILD_ROOT/work"
SPEC_DIR="$BUILD_ROOT/spec"

rm -rf "$BUILD_ROOT" "$OUTPUT_PATH" "$SUPPORT_OUTPUT_PATH"
mkdir -p "$DIST_DIR" "$WORK_DIR" "$SPEC_DIR" "$(dirname "$OUTPUT_PATH")"

"$PYTHON_BIN" -m PyInstaller \
  --noconfirm \
  --clean \
  --onedir \
  --contents-directory .dueflow-backend \
  --name dueflow-backend \
  --paths "$PROJECT_ROOT" \
  --distpath "$DIST_DIR" \
  --workpath "$WORK_DIR" \
  --specpath "$SPEC_DIR" \
  --hidden-import uvicorn.logging \
  --hidden-import uvicorn.loops.auto \
  --hidden-import uvicorn.protocols.http.auto \
  --hidden-import uvicorn.protocols.websockets.auto \
  --hidden-import uvicorn.lifespan.on \
  --exclude-module IPython \
  --exclude-module matplotlib \
  --exclude-module pandas \
  --exclude-module pyarrow \
  --exclude-module pytest \
  "$PROJECT_ROOT/scripts/desktop_backend_entry.py"

cp "$DIST_DIR/dueflow-backend/dueflow-backend" "$OUTPUT_PATH"
cp -R "$DIST_DIR/dueflow-backend/.dueflow-backend" "$SUPPORT_OUTPUT_PATH"
chmod 755 "$OUTPUT_PATH"

SELF_CHECK_JSON="$("$OUTPUT_PATH" --self-check)"
printf '%s' "$SELF_CHECK_JSON" | "$PYTHON_BIN" -c '
import json, sys
payload = json.load(sys.stdin)
assert payload["service"] == "dueflow-backend"
assert payload["status"] == "ok"
assert "/desktop/health" in payload["required_routes"]
'

echo "SIDECAR_PATH=$OUTPUT_PATH"
echo "SIDECAR_SUPPORT_PATH=$SUPPORT_OUTPUT_PATH"
echo "SIDECAR_TARGET=$TARGET_TRIPLE"
echo "SIDECAR_SHA256=$(shasum -a 256 "$OUTPUT_PATH" | awk '{print $1}')"
echo "SIDECAR_BYTES=$(stat -f%z "$OUTPUT_PATH")"
echo "SIDECAR_SELF_CHECK=$SELF_CHECK_JSON"
