from __future__ import annotations

from pathlib import Path
import re
import tomllib


ROOT = Path(__file__).resolve().parents[1]
CASK = ROOT / "Casks/dueflow.rb"


def test_homebrew_cask_tracks_verified_stable_release() -> None:
    cask = CASK.read_text()
    project = tomllib.loads((ROOT / "pyproject.toml").read_text())
    version = project["project"]["version"]

    assert re.search(rf'^  version "{re.escape(version)}"$', cask, re.MULTILINE)
    assert 'arch arm: "arm64", intel: "x86_64"' in cask
    assert (
        'sha256 arm:   "a05ef5a8724e80f3de1c64b499112b293f998f984e5207b6f668d156c33d347b"'
        in cask
    )
    assert (
        'intel: "d874667ff10be1c7a112f0a76d4371a809a87c194ff20d2db9395211d63cf1df"'
        in cask
    )
    assert "DueFlow-Desktop_#{version}_#{arch}.app.zip" in cask
    assert "depends_on :macos" in cask
    assert 'app "DueFlow Desktop.app"' in cask


def test_homebrew_install_path_is_documented_without_bypassing_quarantine() -> None:
    readme = (ROOT / "README.md").read_text()
    chinese_readme = (ROOT / "README.zh-CN.md").read_text()
    cask = CASK.read_text()

    for document in (readme, chinese_readme):
        assert "brew tap ustinian5/dueflow https://github.com/Ustinian5/DueFlow.git" in document
        assert "brew install --cask ustinian5/dueflow/dueflow" in document
        assert "--no-quarantine" not in document

    assert "ad-hoc sealed but not Developer ID signed or notarized" in cask
    assert "System Settings > Privacy & Security" in cask


def test_homebrew_cask_keeps_app_data_cleanup_explicit() -> None:
    cask = CASK.read_text()

    assert 'zap trash: [' in cask
    for path in [
        "~/Library/Application Support/com.dueflow.desktop",
        "~/Library/Caches/com.dueflow.desktop",
        "~/Library/Preferences/com.dueflow.desktop.plist",
        "~/Library/Saved Application State/com.dueflow.desktop.savedState",
    ]:
        assert path in cask
