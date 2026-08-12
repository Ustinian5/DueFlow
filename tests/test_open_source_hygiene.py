from __future__ import annotations

import json
import re
import subprocess
import tomllib
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
MARKDOWN_LINK_PATTERN = re.compile(r"(?<!!)\[[^\]]+\]\(([^)]+)\)")
SECRET_VALUE_PATTERNS = [
    re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b"),
    re.compile(r"(?i)\b(?:api[_-]?key|secret|token|password)\b\s*[:=]\s*[\"'][A-Za-z0-9_./+=-]{20,}[\"']"),
    re.compile(r"(?im)^[A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*\s*=\s*[A-Za-z0-9_./+=-]{20,}\s*$"),
]
SECRET_SCAN_SKIP_SUFFIXES = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".ico",
    ".icns",
    ".pdf",
    ".db",
    ".ics",
    ".lock",
}


def read_text(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def git_tracked_files_or_skip() -> set[str]:
    result = subprocess.run(
        ["git", "ls-files"], cwd=ROOT, check=False, capture_output=True, text=True
    )
    if result.returncode != 0:
        pytest.skip("requires Git metadata; GitHub source archives contain tracked files only")
    return set(result.stdout.splitlines())


def requirement_name(requirement: str) -> str:
    return re.split(r"[<>=!~\[]", requirement.strip(), maxsplit=1)[0].lower()


def test_required_open_source_files_exist() -> None:
    required_files = [
        "README.md",
        "CHANGELOG.md",
        "ROADMAP.md",
        "LICENSE",
        "CONTRIBUTING.md",
        "CODE_OF_CONDUCT.md",
        "SUPPORT.md",
        "PRIVACY.md",
        "SECURITY.md",
        ".gitattributes",
        "requirements.txt",
        "pyproject.toml",
        "environment.yml",
        "desktop/package.json",
        "desktop/package-lock.json",
        "desktop/src-tauri/Cargo.toml",
        "desktop/src-tauri/Cargo.lock",
        ".env.example",
        ".gitignore",
        ".github/workflows/test.yml",
        ".github/dependabot.yml",
        ".github/PULL_REQUEST_TEMPLATE.md",
        ".github/ISSUE_TEMPLATE/bug_report.md",
        ".github/ISSUE_TEMPLATE/feature_request.md",
        ".github/ISSUE_TEMPLATE/config.yml",
        "docs/desktop_api.md",
        "docs/demo.md",
        "docs/desktop_release.md",
        "docs/release_checklist.md",
        "docs/openpets_reference_notes.md",
    ]

    missing = [path for path in required_files if not (ROOT / path).is_file()]

    assert missing == []


def test_markdown_relative_links_resolve_to_existing_files() -> None:
    ignored_parts = {".git", "node_modules", "reference", "target", "dist", "release"}
    missing_links: list[str] = []

    for path in sorted(ROOT.rglob("*.md")):
        if any(part in ignored_parts for part in path.relative_to(ROOT).parts):
            continue
        text = path.read_text(encoding="utf-8")
        for match in MARKDOWN_LINK_PATTERN.finditer(text):
            target = match.group(1).strip()
            if not target or target.startswith(("#", "http://", "https://", "mailto:")):
                continue
            target = target.split("#", 1)[0]
            if target.startswith("<") and target.endswith(">"):
                target = target[1:-1]
            if not target:
                continue
            if not (path.parent / target).resolve().exists():
                missing_links.append(f"{path.relative_to(ROOT)} -> {target}")

    assert missing_links == []


def test_openpets_is_documented_as_reference_only() -> None:
    readme = read_text("README.md")
    notes = read_text("docs/openpets_reference_notes.md")
    roadmap = read_text("ROADMAP.md")

    assert "DueFlow does not depend on OpenPets" in readme
    assert "OpenPets 只作为架构样板" in notes
    assert "不引入 OpenPets" in notes
    assert "不复用 OpenPets" in notes
    assert "Importing or depending on OpenPets" in roadmap


def test_runtime_manifests_do_not_depend_on_openpets_or_electron() -> None:
    package_json = json.loads(read_text("desktop/package.json"))
    dependency_names = set(package_json.get("dependencies", {})) | set(package_json.get("devDependencies", {}))

    forbidden_node_dependencies = {"electron", "openpets", "@openpets/core", "@openpets/plugin-sdk"}
    assert dependency_names.isdisjoint(forbidden_node_dependencies)

    cargo_toml = read_text("desktop/src-tauri/Cargo.toml").lower()
    requirements = read_text("requirements.txt").lower()
    environment = read_text("environment.yml").lower()
    for forbidden in ["openpets", "electron"]:
        assert forbidden not in cargo_toml
        assert forbidden not in requirements
        assert forbidden not in environment


def test_desktop_runtime_manifests_have_open_source_metadata() -> None:
    package_json = json.loads(read_text("desktop/package.json"))
    cargo_toml = read_text("desktop/src-tauri/Cargo.toml")

    assert package_json["license"] == "MIT"
    assert package_json["homepage"] == "https://github.com/Ustinian5/DueFlow#readme"
    assert package_json["repository"]["url"] == "git+https://github.com/Ustinian5/DueFlow.git"
    assert package_json["repository"]["directory"] == "desktop"
    assert package_json["bugs"]["url"] == "https://github.com/Ustinian5/DueFlow/issues"

    for expected in [
        'license = "MIT"',
        'homepage = "https://github.com/Ustinian5/DueFlow#readme"',
        'repository = "https://github.com/Ustinian5/DueFlow"',
        'readme = "../../README.md"',
    ]:
        assert expected in cargo_toml


def test_python_project_metadata_matches_open_source_identity() -> None:
    pyproject = read_text("pyproject.toml")
    readme = read_text("README.md")
    checklist = read_text("docs/release_checklist.md")

    for expected in [
        'name = "dueflow"',
        'version = "0.1.1"',
        'license = { text = "MIT" }',
        'Homepage = "https://github.com/Ustinian5/DueFlow#readme"',
        'Repository = "https://github.com/Ustinian5/DueFlow"',
        'Issues = "https://github.com/Ustinian5/DueFlow/issues"',
        "[tool.setuptools.packages.find]",
    ]:
        assert expected in pyproject

    assert 'python -m pip install -e ".[dev]"' in readme
    assert "pyproject.toml" in checklist


def test_python_dependency_manifests_stay_in_sync() -> None:
    requirements = [
        line.strip()
        for line in read_text("requirements.txt").splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]
    pyproject = tomllib.loads(read_text("pyproject.toml"))
    runtime_dependencies = pyproject["project"]["dependencies"]
    dev_dependencies = pyproject["project"]["optional-dependencies"]["dev"]
    environment = read_text("environment.yml")

    requirement_names = {requirement_name(item) for item in requirements}
    runtime_names = {requirement_name(item) for item in runtime_dependencies}
    dev_names = {requirement_name(item) for item in dev_dependencies}

    assert runtime_names == requirement_names - dev_names
    assert dev_names == {"pytest"}
    assert "- -r requirements.txt" in environment


def test_package_lock_root_matches_desktop_package_manifest() -> None:
    package_json = json.loads(read_text("desktop/package.json"))
    package_lock = json.loads(read_text("desktop/package-lock.json"))
    lock_root = package_lock["packages"][""]

    assert lock_root["name"] == package_json["name"]
    assert lock_root["version"] == package_json["version"]
    assert lock_root["dependencies"] == package_json["dependencies"]
    assert lock_root["devDependencies"] == package_json["devDependencies"]


def test_product_versions_stay_in_sync() -> None:
    pyproject = tomllib.loads(read_text("pyproject.toml"))
    package_json = json.loads(read_text("desktop/package.json"))
    tauri_config = json.loads(read_text("desktop/src-tauri/tauri.conf.json"))
    cargo_manifest = tomllib.loads(read_text("desktop/src-tauri/Cargo.toml"))

    versions = {
        pyproject["project"]["version"],
        package_json["version"],
        tauri_config["version"],
        cargo_manifest["package"]["version"],
    }

    assert versions == {"0.1.1"}


def test_tauri_security_policy_is_explicit_and_local_first() -> None:
    tauri_config = json.loads(read_text("desktop/src-tauri/tauri.conf.json"))
    csp = tauri_config["app"]["security"]["csp"]

    assert isinstance(csp, str)
    assert "default-src 'self'" in csp
    assert "script-src 'self'" in csp
    assert "connect-src 'self' http://127.0.0.1:* http://localhost:*" in csp
    assert "object-src 'none'" in csp
    assert "frame-ancestors 'none'" in csp
    assert "'unsafe-eval'" not in csp


def test_desktop_upload_dependency_is_declared() -> None:
    requirements = read_text("requirements.txt")

    assert "python-multipart" in requirements


def test_desktop_intake_limits_are_documented() -> None:
    env_example = read_text(".env.example")
    desktop_api = read_text("docs/desktop_api.md")
    checklist = read_text("docs/release_checklist.md")
    privacy = read_text("PRIVACY.md")

    for expected in ["DUEFLOW_MAX_TEXT_CHARS", "DUEFLOW_MAX_UPLOAD_MB"]:
        assert expected in env_example
        assert expected in desktop_api

    assert "HTTP `413`" in desktop_api
    assert "Desktop intake limits" in checklist
    assert "25 MiB" in privacy


def test_gitignore_excludes_local_private_and_generated_artifacts() -> None:
    gitignore = set(line.strip() for line in read_text(".gitignore").splitlines() if line.strip() and not line.startswith("#"))
    required_patterns = {
        ".env",
        "*.db",
        "*.db-shm",
        "*.db-wal",
        "inbox/",
        "exports/backups/",
        "exports/diagnostics/",
        "desktop/node_modules/",
        "desktop/dist/",
        "desktop/release/",
        "desktop/src-tauri/target/",
        "*.egg-info/",
        "reference/",
    }

    assert required_patterns.issubset(gitignore)


def test_git_tracked_files_exclude_private_and_generated_artifacts() -> None:
    tracked_files = git_tracked_files_or_skip()
    allowed_generated_examples = {
        "README.pdf",
        "docs/images/.gitkeep",
        "docs/images/01-dashboard.png",
        "exports/calendar.ics",
        "exports/plan.md",
        "exports/submission_report.md",
        "exports/summary.md",
        "exports/todo.md",
        "inbox/.gitkeep",
    }
    forbidden_tracked = []

    for path in tracked_files - allowed_generated_examples:
        if (
            path == ".env"
            or path.startswith("reference/")
            or path.startswith("desktop/node_modules/")
            or path.startswith("desktop/dist/")
            or path.startswith("desktop/release/")
            or path.startswith("desktop/src-tauri/target/")
            or "__pycache__/" in path
            or path.endswith((".pyc", ".db", ".db-shm", ".db-wal"))
            or ".egg-info/" in path
        ):
            forbidden_tracked.append(path)

    assert sorted(forbidden_tracked) == []


def test_git_tracked_text_files_do_not_contain_obvious_secret_values() -> None:
    findings = []

    for raw_path in git_tracked_files_or_skip():
        path = ROOT / raw_path
        if not path.exists():
            continue
        if path.suffix.lower() in SECRET_SCAN_SKIP_SUFFIXES:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for pattern in SECRET_VALUE_PATTERNS:
            if pattern.search(text):
                findings.append(raw_path)
                break

    assert sorted(findings) == []


def test_gitattributes_marks_generated_media_as_binary() -> None:
    gitattributes = read_text(".gitattributes")

    for expected in ["*.pdf binary", "*.png binary", "*.jpg binary", "*.jpeg binary"]:
        assert expected in gitattributes


def test_github_workflow_runs_python_desktop_and_tauri_gates() -> None:
    workflow = read_text(".github/workflows/test.yml")

    for expected in [
        "python -m pytest",
        "python -m pip install --dry-run .",
        "npm run build",
        "npm run test:runtime",
        "npm run test:smoke",
        "npm run test:preflight",
        "npm run test:release-manifest",
        "cargo fmt --check",
        "cargo check",
        "cargo test",
    ]:
        assert expected in workflow


def test_release_scripts_validate_desktop_intake_limits() -> None:
    preflight = read_text("desktop/scripts/run-preflight.mjs")
    smoke = read_text("desktop/scripts/run-desktop-smoke.mjs")
    manifest = read_text("desktop/scripts/write-release-manifest.mjs")

    for expected in ["max_text_chars", "max_upload_bytes", "positive desktop intake limits"]:
        assert expected in preflight
        assert expected in manifest

    for expected in ["max_text_chars", "max_upload_bytes", "Tauri CSP"]:
        assert expected in smoke


def test_github_templates_route_private_data_and_security_reports() -> None:
    config = read_text(".github/ISSUE_TEMPLATE/config.yml")
    bug_report = read_text(".github/ISSUE_TEMPLATE/bug_report.md")
    feature_request = read_text(".github/ISSUE_TEMPLATE/feature_request.md")
    pull_request = read_text(".github/PULL_REQUEST_TEMPLATE.md")

    assert "blank_issues_enabled: false" in config
    assert "SECURITY.md" in config
    assert "PRIVACY.md" in config
    assert "PRIVACY.md" in bug_report
    assert "SECURITY.md" in bug_report
    assert "Security considerations" in feature_request
    assert "Privacy/security impact" in pull_request


def test_dependabot_covers_project_dependency_manifests() -> None:
    dependabot = read_text(".github/dependabot.yml")

    for expected in ['package-ecosystem: "github-actions"', 'package-ecosystem: "pip"', 'package-ecosystem: "npm"', 'package-ecosystem: "cargo"']:
        assert expected in dependabot

    for expected in ['directory: "/"', 'directory: "/desktop"', 'directory: "/desktop/src-tauri"']:
        assert expected in dependabot


def test_release_checklist_covers_manual_and_distribution_boundaries() -> None:
    checklist = read_text("docs/release_checklist.md")

    for expected in [
        "Desktop Manual Smoke",
        "Drag a sample",
        "Import or switch a local pet appearance",
        "system notification permission",
        "Open Source Hygiene",
        "explicit CSP",
        "does not depend on OpenPets",
        "Developer ID signing",
        "notarization",
    ]:
        assert expected in checklist


def test_changelog_and_roadmap_describe_public_project_status() -> None:
    changelog = read_text("CHANGELOG.md")
    roadmap = read_text("ROADMAP.md")

    for expected in ["Unreleased", "0.1.1", "0.1.0", "Tauri desktop shell", "Diagnostics omit raw Inbox text"]:
        assert expected in changelog

    for expected in ["Current Focus", "Near-Term Improvements", "Non-Goals For Now", "pet-first"]:
        assert expected in roadmap


def test_support_and_conduct_docs_set_public_collaboration_expectations() -> None:
    support = read_text("SUPPORT.md")
    conduct = read_text("CODE_OF_CONDUCT.md")

    for expected in ["Bug Reports", "Feature Requests", "Security Issues", "Do not include API keys"]:
        assert expected in support

    for expected in ["Expected Behavior", "Unacceptable Behavior", "Reporting", "Enforcement"]:
        assert expected in conduct


def test_privacy_doc_covers_local_first_data_boundaries() -> None:
    privacy = read_text("PRIVACY.md")
    readme = read_text("README.md")
    checklist = read_text("docs/release_checklist.md")

    for expected in ["local-first", "LLM_PROVIDER=mock", "Model Providers", "Diagnostics", "DUEFLOW_OCR_COMMAND", "Synthetic demo outputs"]:
        assert expected in privacy

    assert "PRIVACY.md" in readme
    assert "PRIVACY.md" in checklist


def test_demo_guide_is_desktop_first_and_portable() -> None:
    demo = read_text("docs/demo.md")

    for expected in ["Desktop Demo", "npm run tauri:dev", "python -m uvicorn api.desktop:app", "OpenPets is a reference only"]:
        assert expected in demo

    for forbidden in ["D:\\", "scripts\\run_demo.py", "^", "网页控制台"]:
        assert forbidden not in demo


def test_product_requirements_are_current_product_source() -> None:
    requirements = read_text("docs/product_requirements.md")
    readme = read_text("README.md")

    for expected in ["桌宠负责交互入口", "日程表负责轻量展示", "控制中心负责必要设置和少量修正", "拖入内容后不设置人工确认步骤"]:
        assert expected in requirements

    for forbidden in ["desktop_pet_product_plan.md", "desktop_pet_closed_loop.md", "docs/design.md", "Legacy product plan", "Legacy design notes"]:
        assert forbidden not in readme
