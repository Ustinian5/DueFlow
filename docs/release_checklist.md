# DueFlow Release Checklist

Use this checklist before publishing a GitHub release, handing off a local build, or tagging a public milestone.

## Automated Gates

- [ ] `python -m pytest`
- [ ] `cd desktop && npm run build`
- [ ] `cd desktop && npm run test:runtime`
- [ ] `cd desktop && npm run test:smoke`
- [ ] `cd desktop && npm run test:preflight`
- [ ] `cd desktop && npm run test:release-manifest`
- [ ] `cd desktop/src-tauri && cargo fmt --check`
- [ ] `cd desktop/src-tauri && cargo check`
- [ ] `cd desktop/src-tauri && cargo test`
- [ ] `bash -n desktop/scripts/package-macos-app.sh`

## Desktop Manual Smoke

- [ ] Start the desktop API and run `cd desktop && npm run tauri:dev`.
- [ ] Confirm the main workbench opens and Settings self-check has no `error` items.
- [ ] Drag a sample `.txt`, `.md`, `.pdf`, or OCR-ready image onto the pet window.
- [ ] Confirm the pet bubble opens the main window and highlights the matching draft or Inbox item.
- [ ] Confirm extracted drafts are not persisted until the user explicitly confirms them.
- [ ] Mark a task done and verify the pet count/status updates.
- [ ] Create a database backup from Settings and verify it appears in the backup list.
- [ ] Export diagnostics and verify it does not contain raw Inbox text or task titles.
- [ ] Import or switch a local pet appearance, then roll back to the built-in pet.
- [ ] Verify the system notification permission flow on the target OS.

## Open Source Hygiene

- [ ] `README.md`, `README.pdf`, `LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SUPPORT.md`, `PRIVACY.md`, `SECURITY.md` and `.env.example` are current.
- [ ] `.gitignore` excludes `.env`, local databases, Inbox files, generated diagnostics, backups, frontend build output, release artifacts, `node_modules`, Rust `target`, and `reference/`.
- [ ] `.github/dependabot.yml` covers GitHub Actions, Python, npm and Cargo manifests.
- [ ] `reference/openpets` is not committed and DueFlow does not depend on OpenPets packages, code, assets or Electron runtime.
- [ ] `desktop/src-tauri/tauri.conf.json` uses an explicit CSP and only allows local API/Tauri asset sources.
- [ ] Desktop intake limits are documented and `GET /desktop/config` reports the active text/upload limits.
- [ ] `pyproject.toml`, `requirements.txt`, `environment.yml`, `desktop/package-lock.json` and `desktop/src-tauri/Cargo.lock` are in sync with the implemented code.
- [ ] Generated release artifacts under `desktop/release/` are not committed unless intentionally attached to a GitHub release outside the source tree.

## Distribution Boundary

- [ ] Local macOS packaging uses `cd desktop && npm run release:mac`.
- [ ] The generated `.sha256` file verifies with `shasum -a 256 -c desktop/release/*.sha256`.
- [ ] The release manifest records the preflight summary.
- [ ] If publishing beyond local development, complete Developer ID signing, notarization, stapling, and any DMG packaging outside the unsigned local path.
