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
    assert 'BASE_NAME="DueFlow-Desktop_${VERSION}_${ARCH}"' in package_script
    assert 'BASE_NAME="DueFlow-Desktop_${VERSION}_${ARCH}_${STAMP}"' not in package_script
    assert '--created-at "$STAMP"' in package_script
    assert 'const BACKEND_SIDECAR_NAME: &str = "dueflow-backend";' in rust_source
    assert '"bundled_sidecar"' in rust_source


def test_ci_builds_and_publishes_both_macos_preview_architectures() -> None:
    workflow = (ROOT / ".github/workflows/test.yml").read_text()

    assert "workflow_dispatch:" in workflow
    assert "macos-preview:" in workflow
    assert "runner: macos-15\n            arch: arm64" in workflow
    assert "runner: macos-15-intel\n            arch: x86_64" in workflow
    assert "startsWith(github.ref, 'refs/heads/codex/release-')" in workflow
    assert "startsWith(github.ref, 'refs/tags/v')" in workflow
    assert "python scripts/desktop_backend_entry.py --host 127.0.0.1 --port 8000" in workflow
    assert "npm run release:mac" in workflow
    assert "manifest[\"preflight\"][\"summary\"][\"error\"] == 0" in workflow
    assert "actions/upload-artifact@v7" in workflow
    assert "actions/download-artifact@v8" in workflow
    assert 'assert {manifest["arch"] for manifest in manifests} == {"arm64", "x86_64"}' in workflow
    assert "needs: [python, desktop, tauri, macos-preview]" in workflow
    assert "contents: write" in workflow
    assert "gh release create" in workflow
    assert 'if [[ "$GITHUB_REF_NAME" == *-* ]]' in workflow
    assert "IS_PRERELEASE=true" in workflow
    assert "IS_PRERELEASE=false" in workflow
    assert "--prerelease" in workflow
    assert "-F prerelease=false" in workflow
    assert "-F prerelease=true" in workflow
    assert "-F make_latest=false" in workflow
    assert "-F make_latest=true" in workflow
    assert "--latest=false" in workflow
    assert "--latest" in workflow
    assert "--verify-tag" in workflow
