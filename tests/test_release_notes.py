from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
NOTES = ROOT / ".github" / "release-notes" / "v0.1.4.md"
WORKFLOW = ROOT / ".github" / "workflows" / "release-notes.yml"


def test_v014_release_notes_have_complete_conversion_path() -> None:
    body = NOTES.read_text(encoding="utf-8")

    required = [
        "# DueFlow v0.1.4",
        "https://ustinian5.github.io/DueFlow/#demo",
        "https://github.com/Ustinian5/DueFlow",
        "brew install --cask ustinian5/dueflow/dueflow",
        "DueFlow-Desktop_0.1.4_arm64.app.zip",
        "DueFlow-Desktop_0.1.4_x86_64.app.zip",
        "DueFlow-Desktop_0.1.4_arm64.app.zip.sha256",
        "DueFlow-Desktop_0.1.4_x86_64.app.zip.sha256",
        "DueFlow-Desktop_0.1.4_arm64.manifest.json",
        "DueFlow-Desktop_0.1.4_x86_64.manifest.json",
        "unsigned and not notarized developer preview",
        "conda run -n dueflow python scripts/run_demo.py",
        "processed=3 tasks=3 plans=17 risks=5",
        "https://github.com/Ustinian5/DueFlow/issues/new/choose",
    ]

    for value in required:
        assert value in body

    assert body.count("releases/download/v0.1.4/") == 6
    assert "without signup, an API key, or an upload" in body
    assert "Star" in body


def test_release_notes_sync_is_narrow_and_self_verifying() -> None:
    workflow = WORKFLOW.read_text(encoding="utf-8")

    required = [
        "branches: [main]",
        '".github/release-notes/v0.1.4.md"',
        '".github/workflows/release-notes.yml"',
        "workflow_dispatch:",
        "permissions:\n  contents: write",
        "group: dueflow-release-notes-v0.1.4",
        "uses: actions/checkout@v7",
        "RELEASE_TAG: v0.1.4",
        "GH_TOKEN: ${{ github.token }}",
        'gh release edit "$RELEASE_TAG"',
        '--notes-file "$NOTES_PATH"',
        'gh release view "$RELEASE_TAG"',
        'test "$actual" = "$expected"',
        "RELEASE_NOTES_RESULT=tag=$RELEASE_TAG;body_verified=true",
    ]

    for value in required:
        assert value in workflow

    assert "pull_request:" not in workflow
    assert "issues: write" not in workflow
    assert "actions: write" not in workflow
