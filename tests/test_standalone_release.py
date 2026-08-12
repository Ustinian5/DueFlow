from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]


def test_desktop_backend_entry_self_check_uses_temp_data() -> None:
    result = subprocess.run(
        [sys.executable, "scripts/desktop_backend_entry.py", "--self-check"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(result.stdout)

    assert payload["service"] == "dueflow-backend"
    assert payload["status"] == "ok"
    assert payload["required_routes"] == [
        "/desktop/about",
        "/desktop/health",
        "/desktop/overview",
        "/desktop/self-check",
    ]


def test_desktop_backend_entry_rejects_non_loopback_bind() -> None:
    result = subprocess.run(
        [sys.executable, "scripts/desktop_backend_entry.py", "--host", "0.0.0.0"],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode != 0
    assert "only binds to loopback hosts" in result.stderr


def test_release_packaging_embeds_verified_sidecar() -> None:
    build_script = (ROOT / "desktop/scripts/build-backend-sidecar.sh").read_text()
    package_script = (ROOT / "desktop/scripts/package-macos-app.sh").read_text()
    rust_source = (ROOT / "desktop/src-tauri/src/lib.rs").read_text()

    assert "python -m PyInstaller" not in build_script
    assert '"$PYTHON_BIN" -m PyInstaller' in build_script
    assert "--self-check" in build_script
    assert "--contents-directory .dueflow-backend" in build_script
    assert 'BACKEND_FILE_NAME="dueflow-backend"' in package_script
    assert 'Contents/MacOS/$BACKEND_FILE_NAME' in package_script
    assert 'Contents/Frameworks' in package_script
    assert "BACKEND_SHA" in package_script
    assert 'const BACKEND_SIDECAR_NAME: &str = "dueflow-backend";' in rust_source
    assert '"bundled_sidecar"' in rust_source
