# DueFlow Desktop Local API

This document describes the local API for the desktop shell and pet overlay.

Product direction note: the current product requirement is pet-first and schedule-first. Dragged content should automatically generate or update editable schedule items without a task-confirmation step. The control center is reserved for necessary settings, small corrections and basic troubleshooting.

Run it with:

```bash
conda activate dueflow
python -m uvicorn api.desktop:app --reload
```

Default base URL:

```text
http://127.0.0.1:8000
```

Run the desktop frontend in development mode:

```bash
cd desktop
npm install
npm run dev
```

Default frontend URL:

```text
http://127.0.0.1:5173
```

Run the Tauri desktop shell in development mode:

```bash
cd desktop
npm run tauri:dev
```

The shell opens two windows:

- `main`: the lightweight DDL schedule surface and compact control center.
- `pet`: a transparent, always-on-top desktop pet overlay rendered from `index.html?view=pet`.

Run the desktop smoke gate before release handoff:

```bash
cd desktop
npm run test:smoke
```

The smoke gate starts an isolated local API with temporary data paths, validates the Tauri window configuration, and exercises the core desktop workflow through HTTP: file intake, duplicate detection, task generation or update, status update, exports, backup, restore and diagnostics export. It also checks that diagnostics output omits raw Inbox text and task titles.

The pet overlay polls `/desktop/overview`, shows active task and high-risk counts, can be dragged from its transparent window, and exposes quick actions for interaction, schedule access and hiding the pet. The tray icon also provides Open DueFlow, Show/Hide Pet, and Quit actions.

The control center includes only the operational settings and diagnostics needed for a quick local assistant: local API health, backend autostart status, backend source, host/port, data paths, LLM provider, OCR mode, supported upload types, notification permission state, quick-input shortcut, local self-check results, a one-click SQLite database backup action, and recent database backups.

Recent backups can also be restored from Settings. Restore is intentionally explicit: the frontend asks for confirmation, the API only accepts safe backup file names from the backup directory, validates SQLite integrity and core tables, creates a fresh pre-restore safety backup, then restores the selected snapshot.

The SQLite database uses `PRAGMA user_version` as the schema marker. The current schema version is `1`; initialization runs a small migration runner for `0 -> 1`, idempotently ensures v1 tables exist, refuses databases from newer app versions, self-check validates the active version, and restore rejects backups whose schema version does not match the running app.

For support and diagnostics, `GET /desktop/about` returns a machine-readable version and capability summary. The Settings view displays the same API version, schema version, Python version, platform and backup/restore availability.

Quick input can be opened from anywhere with the global shortcut:

```text
CommandOrControl+Shift+D
```

The shortcut opens the `main` window and focuses the quick input text area. In browser development mode, the same shortcut works while the frontend tab is focused. Override it with `DUEFLOW_QUICK_INPUT_SHORTCUT` if the default conflicts with another application.

The desktop shell also uses native system notifications through the Tauri notification plugin. Notifications are triggered when:

- a task is overdue;
- a task is due today;
- a task is due within 3 days;
- high-risk records exist;
- generated schedule items need attention because information is missing or confidence is low.

The frontend requests notification permission once, stores reminder deduplication keys in `localStorage`, and avoids repeating the same reminder more than once per day. `notice.show` warning events are also bridged to native system notifications with a 5-minute deduplication window. Routine info and success notices remain in-app by default unless a caller explicitly marks the notice as system-visible.

The main workbench forwards `notice.show` events to the pet window through the Tauri window event `dueflow://notice` and uses the same event as the source for selected system notifications. This keeps success, warning and quick-input feedback visible even when the main workbench is behind other windows. Pet actions use a shared runtime lifecycle with `queued`, `cancelled`, `started`, `retrying`, `finished`, `failed`, and `blocked` events. Built-in actions are serialized through a single pet action queue, queued actions can be cancelled before execution, completed actions apply short cooldowns, and cooldown or busy states surface through the same notice channel. Failed actions include an `errorKind` (`desktop_unavailable`, `permission_denied`, `transient_desktop`, or `unknown`) plus a `retryable` flag; desktop runtime and permission failures fail immediately, while transient desktop command failures retry where appropriate. The Settings view exposes local per-action policy controls for cooldown and retry count, clamps values to safe ranges, and shows the permission scope for each built-in action before the user executes it.

The pet window accepts file drops as the primary intake entry point. Dropped files should reuse `POST /desktop/intake/file`, refresh the local overview, automatically generate or update schedule items when DDL information is recognized, and surface success or failure through the pet bubble. Duplicate, failed, or no-result inputs should remain visible through source records so users can inspect or retry them. The pet bubble should keep the latest successful drop target and expose a direct action button to open the updated schedule item or source record.

Desktop skills are registered through a local declarative manifest registry. Current skills are built in, use a fixed permission whitelist (`pet.action`, `desktop.window`, `intake.file`, `notify.notice`), and explicitly disallow external code execution. The Settings view shows the enabled skill count, action count, permission labels, and external-code status.

The desktop shell also scans the app data `skills/` directory in read-only mode. It recognizes either `skills/<name>/skill.json`, `skills/skill.json`, or `skills/*.skill.json`, caps each manifest at 64 KiB, parses JSON, and returns the raw manifest plus read/parse errors to the frontend. The frontend reuses the same registry validation and only reports audit status; it does not execute plugin code. The Settings view can refresh the scan, open this fixed skills directory, enable or disable local manifests through frontend preferences without editing the manifest files, and expand each manifest to inspect path, metadata, permissions, actions, and validation errors. Enabled, valid local manifest actions are merged into the visible action list as read-only, non-executable actions. The visible action list can be filtered by source, shows action permission labels, and only built-in actions bound to DueFlow pet commands are executable.

The desktop shell scans the app data `pets/` directory and the managed `pets-active/` directory. It recognizes either `pets/<name>/pet.json`, `pets/pet.json`, or `pets/*.pet.json`, caps each manifest at 64 KiB, parses JSON, and sends the raw manifest to the frontend for validation. The pet appearance registry validates stable ids, display metadata, author, version, explicit license, scale, optional dimensions, thumbnail, default asset, state assets, supported state names, local relative asset paths, and safe image extensions (`.svg`, `.png`, `.webp`, `.gif`, `.apng`). The Settings view can refresh the scan, open the fixed `pets/` drop directory, preview each valid local pet with its declared thumbnail when available, inspect errors and license warnings, confirm the license, import a valid local pet into `pets-active/<id>-<version>/`, and roll back to the built-in pet. License confirmation records include the managed manifest path, accepted license text and acceptance timestamp while remaining backward-compatible with older path-only preferences. Import copies only manifest-declared local image assets, rejects URL/absolute/parent-traversal paths, rejects unsupported extensions and oversize assets, and uses a staging directory before replacing the active copy. The frontend caches resolved local pet asset URLs for thumbnails and runtime assets. The pet overlay resolves the selected managed manifest into Tauri file URLs and falls back to the built-in pet if the selected manifest disappears, fails validation, or has not had its license confirmed; the first runtime fallback reason is surfaced in the pet bubble so the user knows why the custom pet was rolled back.

The Tauri shell auto-starts the local API if `127.0.0.1:8000` is not already listening. By default it runs:

```bash
conda run -n dueflow python -m uvicorn api.desktop:app --host 127.0.0.1 --port 8000
```

When the shell starts the API, it sets persistent local data paths under the platform app data directory:

- `DATABASE_PATH`: `DueFlow Desktop/dueflow.db`
- `INBOX_PATH`: `DueFlow Desktop/inbox`
- `EXPORT_PATH`: `DueFlow Desktop/exports`

This keeps user data out of the repository or application bundle. Use `GET /desktop/config` to inspect the actual resolved paths at runtime.

Useful overrides:

- `DUEFLOW_PROJECT_ROOT`: absolute path to the repository root when the app cannot infer it.
- `DUEFLOW_BACKEND_CMD`: full shell command used to start the local API.
- `DUEFLOW_API_HOST`: host checked by the shell, default `127.0.0.1`.
- `DUEFLOW_API_PORT`: port checked by the shell, default `8000`.
- `DUEFLOW_OCR_COMMAND`: custom OCR command for image intake. Use `{path}` as the image path placeholder.
- `DUEFLOW_SKIP_BACKEND_AUTOSTART=1`: disables backend autostart.

Build the desktop app bundle:

```bash
cd desktop
npm run tauri:build
```

Build a local distributable zip package:

```bash
cd desktop
npm run release:mac
```

See [desktop_release.md](desktop_release.md) for release verification, signing and notarization notes.

Current bundle target is the macOS `.app` bundle:

```text
desktop/src-tauri/target/release/bundle/macos/DueFlow Desktop.app
```

DMG packaging, code signing and notarization are release-distribution work and should be enabled after the app identity and signing assets are finalized.

The desktop shell expects the local API to be running at `http://127.0.0.1:8000` for now:

```bash
conda activate dueflow
python -m uvicorn api.desktop:app --host 127.0.0.1 --port 8000
```

The local API enables CORS for:

- `http://127.0.0.1:5173`
- `http://localhost:5173`
- `tauri://localhost`

Desktop intake has explicit local resource limits. Defaults are 200,000 characters for pasted text and 25 MiB for a single uploaded file. Override them with:

- `DUEFLOW_MAX_TEXT_CHARS`
- `DUEFLOW_MAX_UPLOAD_BYTES`
- `DUEFLOW_MAX_UPLOAD_MB`

The active limits are exposed through `GET /desktop/config` and `GET /desktop/about`. Oversize text or files return HTTP `413`.

## Design Contract

The desktop product should keep the common path short. Dragged files, pasted text, screenshot text and quick input should be processed automatically:

```text
intake text/file/screenshot
  -> extract DDL items
  -> persist recognized schedule items automatically
  -> generate plan/risk records
  -> refresh pet state and the lightweight DDL list
  -> allow small corrections from the control center when needed
```

The frontend should not show a task confirmation panel in the normal product flow. The API keeps `requires_confirmation` and `POST /desktop/tasks/confirm` only for backward compatibility with older clients.

## Endpoints

### Health

```http
GET /desktop/health
```

Response:

```json
{
  "status": "ok",
  "service": "desktop"
}
```

### Config

```http
GET /desktop/config
```

Returns runtime paths and provider selection:

```json
{
  "database_path": "/Users/example/Library/Application Support/com.dueflow.desktop/dueflow.db",
  "inbox_path": "/Users/example/Library/Application Support/com.dueflow.desktop/inbox",
  "export_path": "/Users/example/Library/Application Support/com.dueflow.desktop/exports",
  "llm_provider": "mock",
  "limits": {
    "max_text_chars": 200000,
    "max_upload_bytes": 26214400
  }
}
```

### About

```http
GET /desktop/about
```

Response:

```json
{
  "service": "desktop",
  "api_version": "0.2.0",
  "schema_version": 1,
  "supported_schema_version": 1,
  "platform": "macOS-15.0-arm64-arm-64bit",
  "python_version": "3.11.15",
  "paths": {
    "database": "/Users/example/Library/Application Support/com.dueflow.desktop/dueflow.db",
    "inbox": "/Users/example/Library/Application Support/com.dueflow.desktop/inbox",
    "exports": "/Users/example/Library/Application Support/com.dueflow.desktop/exports"
  },
  "capabilities": {
    "llm_provider": "mock",
    "ocr_mode": "macos_vision",
    "ocr_command_configured": false,
    "supported_file_types": [".md", ".pdf", ".png", ".txt"],
    "database_backup": true,
    "database_restore": true,
    "diagnostics_export": true
  }
}
```

### Diagnostics

```http
GET /desktop/diagnostics
```

Returns a support-oriented JSON summary with `about`, `self_check`, aggregate counts and the latest database backups. It intentionally avoids raw Inbox content, task titles, source quotes and extracted task descriptions.

```http
POST /desktop/diagnostics/export
```

Writes the same summary to `exports/diagnostics/dueflow-diagnostics-*.json`. DueFlow keeps the latest 10 generated diagnostics reports and prunes older files with the same `dueflow-diagnostics-*.json` naming pattern.

Response:

```json
{
  "kind": "diagnostics_json",
  "file_name": "dueflow-diagnostics-20260707T120000Z.json",
  "file_path": "exports/diagnostics/dueflow-diagnostics-20260707T120000Z.json",
  "download_url": "/desktop/diagnostics/files/dueflow-diagnostics-20260707T120000Z.json",
  "bytes": 4096,
  "created_at": "2026-07-07T12:00:00+00:00"
}
```

```http
GET /desktop/diagnostics/files/{file_name}
```

Only files named `dueflow-diagnostics-*.json` under `exports/diagnostics/` are served.

### Self Check

```http
GET /desktop/self-check
```

Runs local readiness checks for desktop release quality:

- database directory write access
- SQLite `quick_check`
- required table presence and current schema version
- Inbox directory write access
- export directory write access
- LLM provider configuration
- OCR availability

Response:

```json
{
  "status": "warning",
  "summary": { "ok": 5, "warning": 2, "error": 0 },
  "checks": [
    {
      "id": "database_integrity",
      "label": "数据库完整性",
      "status": "ok",
      "message": "SQLite quick_check 正常。",
      "path": "/Users/example/Library/Application Support/com.dueflow.desktop/dueflow.db"
    }
  ]
}
```

### Overview

```http
GET /desktop/overview
```

Returns the current desktop dashboard payload:

- inbox records
- tasks
- plan items
- risks
- derived pet state

### Pet State

```http
GET /desktop/pet/state
```

Returns the state that should drive the pet overlay.

Example:

```json
{
  "state": "deadline_near",
  "mood": "worried",
  "message": "发现 1 个高风险 DDL。",
  "severity": "high"
}
```

Current state values:

- `no_task`
- `processing`
- `idle`
- `missing_info`
- `deadline_near`
- `overdue`
- `task_done`

### Text Intake

```http
POST /desktop/intake/text
```

Request:

```json
{
  "title": "课程项目通知",
  "content": "代码开源在 GitHub，编写 README.md 并转换成 PDF 提交，截止时间 2026-06-30 23:59。",
  "source_type": "clipboard",
  "auto_extract": true
}
```

`source_type` can be used by desktop clients to distinguish:

- `manual`
- `clipboard`
- `screenshot`
- `upload`
- `folder`
- `webhook`

Response includes an `inbox_item` and zero or more `extracted_tasks`. When DDL information is recognized, these tasks are already persisted to the schedule and the source Inbox item is marked `processed`. `requires_confirmation` remains in the response for compatibility and should be `false` in the current product flow.

### File Intake

```http
POST /desktop/intake/file?auto_extract=true
Content-Type: multipart/form-data
```

Supported file types:

- `.txt`
- `.md`
- `.pdf`
- `.png`
- `.jpg` / `.jpeg`
- `.webp`
- `.tif` / `.tiff`

The uploaded file is parsed into text, inserted into Inbox with `source_type: "upload"`, and optionally extracted into schedule items. Image files are OCR'd first. The OCR resolver uses:

1. `DUEFLOW_OCR_COMMAND` when provided.
2. macOS Vision through the system Swift runtime on macOS.

Example custom OCR command:

```bash
DUEFLOW_OCR_COMMAND="tesseract {path} stdout -l chi_sim+eng"
```

The response shape matches `POST /desktop/intake/text`:

```json
{
  "inbox_item": {
    "source_type": "upload",
    "title": "notice.md",
    "status": "processed"
  },
  "extracted_tasks": [
    {
      "title": "提交课程项目 README 和 PDF",
      "deadline": "2026-06-30 23:59",
      "priority": "high"
    }
  ],
  "requires_confirmation": false,
  "pet_state": {
    "state": "deadline_near",
    "mood": "worried",
    "message": "已加入 1 条 DDL。",
    "severity": "normal"
  }
}
```

Unsupported or empty files return `400`.

### Extract Existing Inbox Item

```http
POST /desktop/inbox/{inbox_item_id}/extract
```

Runs extraction for an existing Inbox item and automatically persists recognized schedule items.

Use this when a pending Inbox item should be processed, when a failed Inbox item should be retried, or when the desktop frontend reloads after an intake response was already lost. Retrying a failed Inbox item clears its previous error before extraction; if extraction fails again, the item returns to `failed` with the new error.

Duplicate Inbox items are returned with `duplicate_of` metadata containing the original Inbox id, title, received time and status. The Inbox UI should show this relationship and provide a direct jump to the original record.

The endpoint rejects:

- duplicate Inbox items
- already processed Inbox items

### Generate Schedule Items

Target behavior for intake endpoints:

1. Insert or update schedule items automatically when DDL information is recognized.
2. Generate plan items.
3. Generate risk records.
4. Mark the source Inbox item as `processed` or `needs_attention`.
5. Return refreshed pet state and the affected schedule item ids.

Already processed source records should be deduplicated to prevent duplicate schedule creation. Low-confidence or incomplete extraction should still produce an editable schedule/source record when possible, with attention flags instead of blocking on a separate task-confirmation step.

### Update Task Status

```http
PATCH /desktop/tasks/{task_id}/status
```

Request:

```json
{
  "status": "done"
}
```

Allowed statuses:

- `todo`
- `doing`
- `done`
- `archived`

Response includes the updated task and refreshed pet state.

### Update Task

```http
PUT /desktop/tasks/{task_id}
```

Updates a schedule task and recalculates its plan items and risks.

Request:

```json
{
  "title": "更新后的课程项目",
  "description": "补充展示海报和演示视频。",
  "deadline": "2026-08-31 23:59",
  "deadline_confidence": "high",
  "deliverables": ["展示海报 PDF", "演示视频"],
  "submit_method": "课程平台提交",
  "location": "课程平台",
  "priority": "high",
  "source_quote": "请在 2026-08-31 23:59 前提交展示海报 PDF 和演示视频",
  "missing_info": [],
  "status": "doing"
}
```

On success, the API:

1. Updates the task record.
2. Deletes old plan items for that task.
3. Regenerates plan items.
4. Deletes old risks for that task.
5. Rechecks risks.
6. Returns refreshed pet state.

### Create Export

```http
POST /desktop/exports/{export_type}
```

Supported `export_type` values:

- `todo`
- `plan`
- `summary`
- `calendar`

Response:

```json
{
  "export_type": "calendar",
  "file_name": "calendar.ics",
  "file_path": "exports/calendar.ics",
  "download_url": "/desktop/exports/files/calendar.ics"
}
```

The API also records each export in `export_records`.

### Download Export

```http
GET /desktop/exports/files/{file_name}
```

Supported files:

- `todo.md`
- `plan.md`
- `summary.md`
- `calendar.ics`

### Create Database Backup

```http
POST /desktop/database/backup
```

Creates a consistent SQLite snapshot using the SQLite backup API and writes it to `exports/backups/`.

Response:

```json
{
  "kind": "sqlite_backup",
  "file_name": "dueflow-backup-20260706T120000Z.db",
  "file_path": "exports/backups/dueflow-backup-20260706T120000Z.db",
  "download_url": "/desktop/database/backups/dueflow-backup-20260706T120000Z.db",
  "bytes": 32768,
  "created_at": "2026-07-06T12:00:00+00:00"
}
```

### Download Database Backup

```http
GET /desktop/database/backups/{file_name}
```

Only files named `dueflow-backup-*.db` under `exports/backups/` are served.

### List Database Backups

```http
GET /desktop/database/backups
```

Response:

```json
{
  "backups": [
    {
      "kind": "sqlite_backup",
      "file_name": "dueflow-backup-20260706T120000Z.db",
      "file_path": "exports/backups/dueflow-backup-20260706T120000Z.db",
      "download_url": "/desktop/database/backups/dueflow-backup-20260706T120000Z.db",
      "bytes": 32768,
      "created_at": "2026-07-06T12:00:00+00:00"
    }
  ]
}
```

Only safe DueFlow backup files are listed, ordered newest first.

### Restore Database Backup

```http
POST /desktop/database/restore
```

Request:

```json
{
  "file_name": "dueflow-backup-20260706T120000Z.db",
  "confirm": "RESTORE"
}
```

The API rejects missing confirmation, unsafe file names, missing files, backups that fail `PRAGMA quick_check`, backups missing core DueFlow tables, and backups whose schema version does not match the running app. Before replacing the current database, it creates a normal backup named like `dueflow-backup-20260706T120030Z-pre-restore.db`.

Response:

```json
{
  "status": "restored",
  "restored_from": {
    "kind": "sqlite_backup",
    "file_name": "dueflow-backup-20260706T120000Z.db",
    "file_path": "exports/backups/dueflow-backup-20260706T120000Z.db",
    "download_url": "/desktop/database/backups/dueflow-backup-20260706T120000Z.db",
    "bytes": 32768,
    "created_at": "2026-07-06T12:00:00+00:00"
  },
  "safety_backup": {
    "kind": "sqlite_backup",
    "file_name": "dueflow-backup-20260706T120030Z-pre-restore.db",
    "file_path": "exports/backups/dueflow-backup-20260706T120030Z-pre-restore.db",
    "download_url": "/desktop/database/backups/dueflow-backup-20260706T120030Z-pre-restore.db",
    "bytes": 32768,
    "created_at": "2026-07-06T12:00:30+00:00"
  }
}
```

## Frontend Integration Notes

The pet overlay should poll or subscribe to the desktop API state in early versions. Later versions can add WebSocket push events.

Recommended UI behavior:

- Call `POST /desktop/intake/text` after clipboard or quick-input capture.
- Call `POST /desktop/intake/file` after file picker or drag-and-drop.
- In the control center, call `POST /desktop/inbox/{id}/extract` for pending items that should be processed or failed items that should be retried.
- Scroll highlighted source records into view after desktop pet intake events.
- In Settings, call `POST /desktop/database/backup` before risky local upgrades or manual data migration.
- In Settings, call `POST /desktop/database/restore` only after explicit user confirmation; refresh overview and settings after success.
- Do not show a task confirmation panel for normal intake.
- Refresh `/desktop/overview` after intake, retry, correction or status updates.
- Use `/desktop/pet/state` to drive pet expression and bubble text.
- Use the Exports view to call `POST /desktop/exports/{type}`, then download from `download_url`.
