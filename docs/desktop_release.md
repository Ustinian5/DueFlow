# DueFlow Desktop Release Guide

This document describes the current reproducible local release path for the macOS desktop app.

For a maintainer-oriented checklist that combines automated gates, manual desktop smoke checks, open-source hygiene and distribution boundaries, see [release_checklist.md](release_checklist.md).

## Build A Local Release

From the desktop package:

```bash
cd desktop
npm run release:mac
```

The script runs `npm run preflight`, then `npm run tauri:build`, verifies the generated `.app` bundle, and creates:

- `desktop/release/DueFlow-Desktop_<version>_<arch>_<timestamp>.app.zip`
- `desktop/release/*.sha256`
- `desktop/release/*.manifest.json`

The manifest is written by `desktop/scripts/write-release-manifest.mjs`. It records product name, version, architecture, timestamp, bundle file, SHA256, byte size, signing/notarization flags, and the preflight summary used for the build.

`npm run preflight` calls the running local API at `GET /desktop/self-check` and `GET /desktop/about`. It fails the release when any self-check item has `status: "error"`, when the active database schema version does not match the supported schema version reported by `about`, or when required support capabilities such as backup, restore, and diagnostics export are missing. Warnings are printed but allowed by default. Useful overrides:

- `DUEFLOW_PREFLIGHT_API_BASE=http://127.0.0.1:8000`: use a different local API base URL.
- `DUEFLOW_PREFLIGHT_STRICT_WARNINGS=1`: treat warnings as release failures.
- `DUEFLOW_SKIP_PREFLIGHT=1 npm run release:mac`: skip preflight for development-only local packaging.

When `npm run release:mac` runs preflight, the release manifest embeds a compact `preflight` object containing self-check counts, API/schema versions, platform, Python version and support capabilities. When `DUEFLOW_SKIP_PREFLIGHT=1` is used, this field is `null`.

## Current Distribution Boundary

The current release script intentionally ships a zipped `.app` bundle instead of DMG because DMG packaging, Developer ID signing, and Apple notarization require release credentials and signing assets.

Current manifest flags:

```json
{
  "signed": false,
  "notarized": false
}
```

Before public distribution, complete:

1. Configure a Developer ID Application certificate.
2. Sign the app bundle and any bundled sidecar binaries.
3. Notarize the signed artifact with Apple.
4. Staple the notarization ticket.
5. Re-enable DMG packaging if desired.
6. Update the release manifest flags to `true` after verification.

## Verification Gates

Run these before publishing a local build:

```bash
python -m pytest
cd desktop
npm run build
npm run test:runtime
npm run test:smoke
npm run test:preflight
npm run test:release-manifest
npm run preflight
cd src-tauri
cargo fmt --check
cargo check
cargo test
cd ..
npm run release:mac
```

`npm run test:smoke` starts an isolated local desktop API with a temporary database, validates the Tauri main/pet window configuration, and runs the core HTTP workflow: file intake, duplicate detection, task confirmation, task status update, exports, database backup, restore and diagnostics export. It also asserts that diagnostics output does not include raw Inbox text or task titles. It does not mutate the user's real app data.

`cargo test` covers the Tauri shell's local pet import safety boundaries, including manifest source confinement, declared asset copying, thumbnail/state asset inclusion, and rollback behavior when an import fails after a previous active copy exists.

Before handing off a build, open Settings in the desktop app and confirm the local self-check has no `error` items. `warning` items are acceptable for development builds when they are expected, such as `LLM_PROVIDER=mock` or OCR being unavailable. Use the Settings database backup action to create a fresh SQLite snapshot before local upgrades, migration testing, or handoff of a machine that already has real user data. Restore testing should use the Settings restore action, which validates the selected backup and creates a pre-restore safety backup before replacing the active database. The release script enforces the same error gate automatically. The remaining manual window check should focus on actual Tauri rendering and OS integration: drag a sample file onto the pet, confirm the draft in the main window, switch a local pet appearance from Settings, and verify the system notification permission flow.

Database schema compatibility is tracked with SQLite `PRAGMA user_version`. The current schema version is `1`; startup refuses databases from newer app versions, and self-check plus restore validation fail when a local database or selected backup does not match the running app schema.

The migration runner currently supports `0 -> 1` and idempotently repairs missing v1 tables for databases already marked as version `1`. Future schema changes should add explicit version steps instead of mutating the v1 migration.

For support handoff, use the Settings diagnostics export or call `POST /desktop/diagnostics/export`. The diagnostics JSON records the API version, active and supported schema versions, Python version, platform, data paths, self-check output, aggregate counts and recent backups without including raw Inbox text or task titles.
The app keeps the latest 10 generated diagnostics JSON files and only prunes files matching `dueflow-diagnostics-*.json`.

Pytest warning policy is centralized in `pytest.ini`. It only suppresses the known Starlette/httpx TestClient compatibility warning so release logs stay readable while unrelated warnings still surface.

Verify the release zip:

```bash
shasum -a 256 -c desktop/release/*.sha256
```

The built app uses the platform app data directory for persistent data when launched through the Tauri shell. Use the in-app Settings view or `GET /desktop/config` to verify runtime paths. Database backups are written under the configured export directory at `backups/dueflow-backup-*.db`; the Settings view lists recent backups so handoff testers can confirm a fresh recovery point exists.
