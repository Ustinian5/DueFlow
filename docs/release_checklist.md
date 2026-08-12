# DueFlow Release Checklist

Use this checklist before publishing a GitHub release, handing off a local build, or tagging a public milestone.

## Automated Gates

- [ ] `conda run -n dueflow python -m pytest`
- [ ] `conda run -n dueflow python -m pytest tests/test_standalone_release.py`
- [ ] `cd desktop && npm run build`
- [ ] `cd desktop && npm run test:runtime`
- [ ] `cd desktop && npm run test:smoke`
- [ ] `cd desktop && npm run test:preflight`
- [ ] `cd desktop && npm run test:release-manifest`
- [ ] `cd desktop && npm run build:sidecar`
- [ ] `cd desktop/src-tauri && conda run -n dueflow cargo fmt --check`
- [ ] `cd desktop/src-tauri && conda run -n dueflow cargo check`
- [ ] `cd desktop/src-tauri && conda run -n dueflow cargo test`
- [ ] `bash -n desktop/scripts/package-macos-app.sh`
- [ ] The GitHub Actions `macOS preview (arm64)` and `macOS preview (x86_64)` jobs pass on a `codex/release-*` validation branch or manual dispatch.

## Desktop Manual Smoke

- [ ] Start the desktop API and run `cd desktop && npm run tauri:dev`.
- [ ] Confirm the lightweight schedule surface and control center open separately, and Settings self-check has no `error` items.
- [ ] Drag a sample `.txt`, `.md`, `.pdf`, or OCR-ready image onto the pet window.
- [ ] Confirm the pet bubble reports processing and success/failure clearly.
- [ ] Confirm the schedule surface updates automatically without a task-confirmation step.
- [ ] Mark a task done and verify the pet count/status updates.
- [ ] Create a database backup from Settings and verify it appears in the backup list.
- [ ] Export diagnostics and verify it does not contain raw Inbox text or task titles.
- [ ] Import or switch a local pet appearance, then roll back to the built-in pet.
- [ ] Verify the system notification permission flow on the target OS.
- [ ] Extract the release zip into a clean temporary directory, launch the `.app`, and confirm it reaches a healthy local API without a source checkout, Python, or Conda on the runtime path.

## Open Source Hygiene

- [ ] `README.md`, `README.pdf`, `LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SUPPORT.md`, `PRIVACY.md`, `SECURITY.md` and `.env.example` are current.
- [ ] `.gitignore` excludes `.env`, local databases, Inbox files, generated diagnostics, backups, frontend build output, release artifacts, `node_modules`, Rust `target`, and `reference/`.
- [ ] `.github/dependabot.yml` covers GitHub Actions, Python, npm and Cargo manifests.
- [ ] `reference/openpets` is not committed and DueFlow does not depend on OpenPets packages, code, assets or Electron runtime.
- [ ] `desktop/src-tauri/tauri.conf.json` uses an explicit CSP and only allows local API/Tauri asset sources.
- [ ] Desktop intake limits are documented and `GET /desktop/config` reports the active text/upload limits.
- [ ] `pyproject.toml`, `requirements.txt`, `requirements-release.txt`, `environment.yml`, `desktop/package-lock.json` and `desktop/src-tauri/Cargo.lock` are in sync with the implemented code.
- [ ] Generated release artifacts under `desktop/release/` are not committed unless intentionally attached to a GitHub release outside the source tree.

## Distribution Boundary

- [ ] Local macOS packaging uses `cd desktop && npm run release:mac`.
- [ ] The generated `.sha256` file verifies with `(cd desktop/release && shasum -a 256 -c *.sha256)`.
- [ ] The extracted app contains executable `Contents/MacOS/dueflow-backend` and its private `Contents/Frameworks` runtime; `dueflow-backend --self-check` returns `status=ok` with all required desktop routes.
- [ ] The release manifest records the preflight summary plus the bundled backend SHA256, byte size, and self-check result.
- [ ] The bundled backend SHA256 and byte size match the extracted release artifact exactly.
- [ ] A tagged developer prerelease contains exactly two `.app.zip` files, two `.sha256` files, and two `.manifest.json` files covering `arm64` and `x86_64`.
- [ ] If publishing beyond local development, complete Developer ID signing, notarization, stapling, and any DMG packaging outside the unsigned local path.
