from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import platform
import sqlite3
import sys
import tempfile
from typing import Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from src.calendar_exporter import export_calendar_ics
from src.config import load_settings
from src.database import SCHEMA_VERSION, Database
from src.extractors import extract_tasks
from src.inbox import InboxService
from src.llm_provider import get_llm_provider
from src.models import TaskItem
from src.parsers import SUPPORTED_EXTENSIONS, is_supported_file, parse_file
from src.pet_state import derive_pet_state
from src.planner import generate_plan
from src.report_exporter import export_plan_markdown, export_summary_markdown, export_todo_markdown
from src.risk_checker import check_risks


DESKTOP_API_VERSION = "0.2.0"
DIAGNOSTICS_RETENTION_LIMIT = 10
DEFAULT_MAX_TEXT_INTAKE_CHARS = 200_000
DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024
UPLOAD_READ_CHUNK_BYTES = 1024 * 1024


class TextIntakePayload(BaseModel):
    title: str = "Untitled"
    content: str
    source_type: str = "manual"
    auto_extract: bool = True


class TaskDraftPayload(BaseModel):
    title: str
    description: str = ""
    deadline: Optional[str] = None
    deadline_confidence: str = "low"
    deliverables: list[str] = Field(default_factory=list)
    submit_method: Optional[str] = None
    location: Optional[str] = None
    priority: str = "medium"
    source_quote: str = ""
    missing_info: list[str] = Field(default_factory=list)


class ConfirmTasksPayload(BaseModel):
    inbox_item_id: str
    tasks: list[TaskDraftPayload]


class TaskStatusPayload(BaseModel):
    status: str


class TaskUpdatePayload(BaseModel):
    title: str
    description: str = ""
    deadline: Optional[str] = None
    deadline_confidence: str = "low"
    deliverables: list[str] = Field(default_factory=list)
    submit_method: Optional[str] = None
    location: Optional[str] = None
    priority: str = "medium"
    source_quote: str = ""
    missing_info: list[str] = Field(default_factory=list)
    status: str = "todo"


class RestoreDatabasePayload(BaseModel):
    file_name: str
    confirm: str


def create_app(
    database_path: str | Path | None = None,
    export_path: str | Path | None = None,
    inbox_path: str | Path | None = None,
) -> FastAPI:
    settings = load_settings()
    database_root = Path(database_path or settings.database_path)
    inbox_root = Path(inbox_path or settings.inbox_path)
    export_root = Path(export_path or settings.export_path)
    inbox_root.mkdir(parents=True, exist_ok=True)
    export_root.mkdir(parents=True, exist_ok=True)
    database = Database(database_root)
    database.initialize()
    inbox_service = InboxService(database)
    api = FastAPI(title="DueFlow Desktop Local API", version=DESKTOP_API_VERSION)
    api.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://127.0.0.1:5173",
            "http://localhost:5173",
            "tauri://localhost",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @api.get("/desktop/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": "desktop"}

    @api.get("/desktop/about")
    def about() -> dict:
        return _build_about(database, settings, database_root, inbox_root, export_root)

    @api.get("/desktop/config")
    def config() -> dict:
        return {
            "database_path": str(database_root),
            "inbox_path": str(inbox_root),
            "export_path": str(export_root),
            "llm_provider": settings.llm_provider,
            "ocr_mode": _ocr_mode(),
            "ocr_command_configured": bool(os.getenv("DUEFLOW_OCR_COMMAND", "").strip()),
            "supported_file_types": sorted(SUPPORTED_EXTENSIONS),
            "limits": _desktop_intake_limits(),
        }

    @api.get("/desktop/self-check")
    def self_check() -> dict:
        return _run_self_check(database, settings, database_root, inbox_root, export_root)

    @api.get("/desktop/diagnostics")
    def diagnostics() -> dict:
        return _build_diagnostics(database, settings, database_root, inbox_root, export_root)

    @api.post("/desktop/diagnostics/export")
    def export_diagnostics() -> dict:
        try:
            report = _build_diagnostics(database, settings, database_root, inbox_root, export_root)
            path = _write_diagnostics_report(report, export_root)
            return {
                "kind": "diagnostics_json",
                "file_name": path.name,
                "file_path": str(path),
                "download_url": f"/desktop/diagnostics/files/{path.name}",
                "bytes": path.stat().st_size,
                "created_at": report["generated_at"],
            }
        except OSError as exc:
            raise HTTPException(status_code=500, detail=f"diagnostics export failed: {exc}") from exc

    @api.get("/desktop/diagnostics/files/{file_name}")
    def download_diagnostics(file_name: str) -> FileResponse:
        if not _is_safe_diagnostics_file_name(file_name):
            raise HTTPException(status_code=404, detail="diagnostics file not found")
        path = export_root / "diagnostics" / file_name
        if not path.exists() or not path.is_file():
            raise HTTPException(status_code=404, detail="diagnostics file not found")
        return FileResponse(path, media_type="application/json", filename=path.name)

    @api.get("/desktop/overview")
    def overview() -> dict:
        inbox_items = database.list_inbox_items()
        tasks = database.list_tasks()
        plans = database.list_plan_items()
        risks = database.list_risks()
        pending_count = sum(1 for item in inbox_items if item.status == "pending")
        return {
            "inbox": _dump_inbox_items(inbox_items),
            "tasks": [_dump(task) for task in tasks],
            "plans": [_dump(plan) for plan in plans],
            "risks": [_dump(risk) for risk in risks],
            "pet_state": _dump(derive_pet_state(tasks, risks, pending_count)),
        }

    @api.get("/desktop/pet/state")
    def pet_state() -> dict:
        inbox_items = database.list_inbox_items()
        tasks = database.list_tasks()
        risks = database.list_risks()
        pending_count = sum(1 for item in inbox_items if item.status == "pending")
        return _dump(derive_pet_state(tasks, risks, pending_count))

    @api.post("/desktop/exports/{export_type}")
    def create_export(export_type: str) -> dict:
        tasks = database.list_tasks()
        plans = database.list_plan_items()
        risks = database.list_risks()

        if export_type == "todo":
            path = export_todo_markdown(tasks, export_root / "todo.md")
            record_type = "todo_md"
        elif export_type == "plan":
            path = export_plan_markdown(tasks, plans, risks, export_root / "plan.md")
            record_type = "plan_md"
        elif export_type == "summary":
            path = export_summary_markdown(tasks, plans, risks, export_root / "summary.md")
            record_type = "summary_md"
        elif export_type == "calendar":
            path = export_calendar_ics(plans, export_root / "calendar.ics")
            record_type = "calendar_ics"
        else:
            raise HTTPException(status_code=400, detail=f"unsupported export type: {export_type}")

        database.insert_export_record(record_type, str(path))
        return {
            "export_type": export_type,
            "file_name": path.name,
            "file_path": str(path),
            "download_url": f"/desktop/exports/files/{path.name}",
        }

    @api.get("/desktop/exports/files/{file_name}")
    def download_export(file_name: str) -> FileResponse:
        allowed_files = {"todo.md", "plan.md", "summary.md", "calendar.ics"}
        if file_name not in allowed_files:
            raise HTTPException(status_code=404, detail="export file not found")
        path = export_root / file_name
        if not path.exists():
            raise HTTPException(status_code=404, detail="export file not found")
        media_type = "text/calendar" if path.suffix == ".ics" else "text/markdown"
        return FileResponse(path, media_type=media_type, filename=path.name)

    @api.post("/desktop/database/backup")
    def create_database_backup() -> dict:
        try:
            return _create_database_backup(database, export_root)
        except sqlite3.Error as exc:
            raise HTTPException(status_code=500, detail=f"database backup failed: {exc}") from exc
        except OSError as exc:
            raise HTTPException(status_code=500, detail=f"backup path unavailable: {exc}") from exc

    @api.get("/desktop/database/backups")
    def list_database_backups() -> dict:
        try:
            return {"backups": _list_database_backups(export_root)}
        except OSError as exc:
            raise HTTPException(status_code=500, detail=f"backup path unavailable: {exc}") from exc

    @api.get("/desktop/database/backups/{file_name}")
    def download_database_backup(file_name: str) -> FileResponse:
        if not _is_safe_backup_file_name(file_name):
            raise HTTPException(status_code=404, detail="database backup not found")
        path = export_root / "backups" / file_name
        if not path.exists() or not path.is_file():
            raise HTTPException(status_code=404, detail="database backup not found")
        return FileResponse(path, media_type="application/x-sqlite3", filename=path.name)

    @api.post("/desktop/database/restore")
    def restore_database_backup(payload: RestoreDatabasePayload) -> dict:
        if payload.confirm != "RESTORE":
            raise HTTPException(status_code=400, detail="restore confirmation is required")
        try:
            backup_path = _resolve_database_backup_path(export_root, payload.file_name)
            _validate_database_backup(backup_path)
            safety_backup = _create_database_backup(database, export_root, label="pre-restore")
            _restore_database_from_backup(database, backup_path)
            database.initialize()
            return {
                "status": "restored",
                "restored_from": _database_backup_payload(backup_path),
                "safety_backup": safety_backup,
            }
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="database backup not found") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except sqlite3.Error as exc:
            raise HTTPException(status_code=500, detail=f"database restore failed: {exc}") from exc
        except OSError as exc:
            raise HTTPException(status_code=500, detail=f"backup path unavailable: {exc}") from exc

    @api.post("/desktop/intake/text")
    def intake_text(payload: TextIntakePayload) -> dict:
        if not payload.content.strip():
            raise HTTPException(status_code=400, detail="content is required")
        max_text_chars = _max_text_intake_chars()
        if len(payload.content) > max_text_chars:
            raise HTTPException(
                status_code=413,
                detail=f"text intake is too large: max {max_text_chars} characters",
            )

        item = inbox_service.add_text(payload.source_type, payload.title, payload.content)
        extracted_tasks: list[TaskItem] = []
        if payload.auto_extract and item.status == "pending":
            extracted_tasks = _extract_or_fail(database, item, get_llm_provider(settings))
            if extracted_tasks:
                _commit_extracted_tasks(database, item.id, extracted_tasks)
            else:
                database.update_inbox_status(item.id, "failed", "没有识别到明确 DDL")

        return {
            "inbox_item": _dump_inbox_item(database.get_inbox_item(item.id) or item, database.list_inbox_items()),
            "extracted_tasks": [_dump(task) for task in extracted_tasks],
            "requires_confirmation": False,
            "pet_state": _dump(derive_pet_state(database.list_tasks(), database.list_risks(), _pending_count(database))),
        }

    @api.post("/desktop/intake/file")
    async def intake_file(file: UploadFile = File(...), auto_extract: bool = True) -> dict:
        filename = file.filename or "upload.txt"
        suffix = Path(filename).suffix.lower()
        if not is_supported_file(filename):
            raise HTTPException(status_code=400, detail=f"unsupported file type: {suffix or 'unknown'}")

        try:
            content = await _read_upload_limited(file, _max_upload_bytes())
        except ValueError as exc:
            raise HTTPException(status_code=413, detail=str(exc)) from exc
        if not content:
            raise HTTPException(status_code=400, detail="uploaded file is empty")

        temp_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                tmp.write(content)
                temp_path = Path(tmp.name)
            item = inbox_service.add_text("upload", filename, parse_file(temp_path))
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"file parsing failed: {exc}") from exc
        finally:
            if temp_path is not None:
                temp_path.unlink(missing_ok=True)

        extracted_tasks: list[TaskItem] = []
        if auto_extract and item.status == "pending":
            extracted_tasks = _extract_or_fail(database, item, get_llm_provider(settings))
            if extracted_tasks:
                _commit_extracted_tasks(database, item.id, extracted_tasks)
            else:
                database.update_inbox_status(item.id, "failed", "没有识别到明确 DDL")

        return {
            "inbox_item": _dump_inbox_item(database.get_inbox_item(item.id) or item, database.list_inbox_items()),
            "extracted_tasks": [_dump(task) for task in extracted_tasks],
            "requires_confirmation": False,
            "pet_state": _dump(derive_pet_state(database.list_tasks(), database.list_risks(), _pending_count(database))),
        }

    @api.post("/desktop/inbox/{inbox_item_id}/extract")
    def extract_inbox_item(inbox_item_id: str) -> dict:
        item = database.get_inbox_item(inbox_item_id)
        if item is None:
            raise HTTPException(status_code=404, detail="inbox item not found")
        if item.status == "duplicate":
            raise HTTPException(status_code=409, detail="duplicate inbox item cannot be extracted")
        if item.status == "processed":
            raise HTTPException(status_code=409, detail="processed inbox item has already created tasks")
        if item.status == "failed":
            database.update_inbox_status(item.id, "pending")
            refreshed = database.get_inbox_item(inbox_item_id)
            if refreshed is not None:
                item = refreshed

        extracted_tasks = _extract_or_fail(database, item, get_llm_provider(settings))
        if extracted_tasks:
            _commit_extracted_tasks(database, item.id, extracted_tasks)
        else:
            database.update_inbox_status(item.id, "failed", "没有识别到明确 DDL")

        return {
            "inbox_item": _dump_inbox_item(database.get_inbox_item(item.id) or item, database.list_inbox_items()),
            "extracted_tasks": [_dump(task) for task in extracted_tasks],
            "requires_confirmation": False,
            "pet_state": _dump(derive_pet_state(database.list_tasks(), database.list_risks(), _pending_count(database))),
        }

    @api.post("/desktop/tasks/confirm")
    def confirm_tasks(payload: ConfirmTasksPayload) -> dict:
        inbox_item = database.get_inbox_item(payload.inbox_item_id)
        if inbox_item is None:
            raise HTTPException(status_code=404, detail="inbox item not found")
        if inbox_item.status == "duplicate":
            raise HTTPException(status_code=409, detail="duplicate inbox item cannot create tasks")
        if inbox_item.status == "processed":
            raise HTTPException(status_code=409, detail="processed inbox item has already created tasks")
        if not payload.tasks:
            raise HTTPException(status_code=400, detail="at least one task is required")

        inserted_tasks: list[TaskItem] = []
        inserted_plans = []
        inserted_risks = []
        for draft in payload.tasks:
            task = _task_from_draft(payload.inbox_item_id, draft)
            database.insert_task(task)
            inserted_tasks.append(task)
            plans = generate_plan(task)
            for plan in plans:
                database.insert_plan_item(plan)
                inserted_plans.append(plan)
            risks = check_risks(task, plans)
            for risk in risks:
                database.insert_risk(risk)
                inserted_risks.append(risk)

        database.update_inbox_status(payload.inbox_item_id, "processed")
        return {
            "tasks": [_dump(task) for task in inserted_tasks],
            "plans": [_dump(plan) for plan in inserted_plans],
            "risks": [_dump(risk) for risk in inserted_risks],
            "summary": {
                "tasks": len(inserted_tasks),
                "plans": len(inserted_plans),
                "risks": len(inserted_risks),
            },
            "pet_state": _dump(derive_pet_state(database.list_tasks(), database.list_risks(), _pending_count(database))),
        }

    @api.patch("/desktop/tasks/{task_id}/status")
    def update_task_status(task_id: str, payload: TaskStatusPayload) -> dict:
        if database.get_task(task_id) is None:
            raise HTTPException(status_code=404, detail="task not found")
        try:
            database.update_task_status(task_id, payload.status)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        task = database.get_task(task_id)
        return {
            "task": _dump(task),
            "pet_state": _dump(derive_pet_state(database.list_tasks(), database.list_risks(), _pending_count(database))),
        }

    @api.put("/desktop/tasks/{task_id}")
    def update_task(task_id: str, payload: TaskUpdatePayload) -> dict:
        existing = database.get_task(task_id)
        if existing is None:
            raise HTTPException(status_code=404, detail="task not found")
        if payload.status not in {"todo", "doing", "done", "archived"}:
            raise HTTPException(status_code=400, detail=f"Unsupported task status: {payload.status}")

        task = TaskItem(
            id=existing.id,
            inbox_item_id=existing.inbox_item_id,
            title=payload.title.strip() or "未命名 DDL",
            description=payload.description,
            deadline=payload.deadline,
            deadline_confidence=payload.deadline_confidence or ("low" if not payload.deadline else "medium"),
            deliverables=payload.deliverables,
            submit_method=payload.submit_method,
            location=payload.location,
            priority=payload.priority or "medium",
            source_quote=payload.source_quote,
            missing_info=payload.missing_info,
            status=payload.status,
            created_at=existing.created_at,
        )
        if not task.deadline:
            task.deadline_confidence = "low"

        database.update_task(task)
        database.delete_plan_items_for_task(task.id)
        database.delete_risks_for_task(task.id)

        plans = generate_plan(task)
        inserted_plans = []
        for plan in plans:
            database.insert_plan_item(plan)
            inserted_plans.append(plan)
        risks = check_risks(task, plans)
        inserted_risks = []
        for risk in risks:
            database.insert_risk(risk)
            inserted_risks.append(risk)

        return {
            "task": _dump(task),
            "plans": [_dump(plan) for plan in inserted_plans],
            "risks": [_dump(risk) for risk in inserted_risks],
            "pet_state": _dump(derive_pet_state(database.list_tasks(), database.list_risks(), _pending_count(database))),
        }

    return api


def _task_from_draft(inbox_item_id: str, draft: TaskDraftPayload) -> TaskItem:
    deadline_confidence = draft.deadline_confidence or ("low" if not draft.deadline else "medium")
    if not draft.deadline:
        deadline_confidence = "low"
    return TaskItem(
        inbox_item_id=inbox_item_id,
        title=draft.title.strip() or "未命名 DDL",
        description=draft.description,
        deadline=draft.deadline,
        deadline_confidence=deadline_confidence,
        deliverables=draft.deliverables,
        submit_method=draft.submit_method,
        location=draft.location,
        priority=draft.priority or "medium",
        source_quote=draft.source_quote,
        missing_info=draft.missing_info,
    )


def _commit_extracted_tasks(database: Database, inbox_item_id: str, tasks: list[TaskItem]) -> dict:
    inserted_tasks: list[TaskItem] = []
    inserted_plans = []
    inserted_risks = []
    for task in tasks:
        database.insert_task(task)
        inserted_tasks.append(task)
        plans = generate_plan(task)
        for plan in plans:
            database.insert_plan_item(plan)
            inserted_plans.append(plan)
        risks = check_risks(task, plans)
        for risk in risks:
            database.insert_risk(risk)
            inserted_risks.append(risk)

    database.update_inbox_status(inbox_item_id, "processed")
    return {
        "tasks": inserted_tasks,
        "plans": inserted_plans,
        "risks": inserted_risks,
        "summary": {
            "tasks": len(inserted_tasks),
            "plans": len(inserted_plans),
            "risks": len(inserted_risks),
        },
    }


def _pending_count(database: Database) -> int:
    return sum(1 for item in database.list_inbox_items() if item.status == "pending")


def _build_about(database: Database, settings, database_root: Path, inbox_root: Path, export_root: Path) -> dict:
    return {
        "service": "desktop",
        "api_version": DESKTOP_API_VERSION,
        "schema_version": database.schema_version(),
        "supported_schema_version": SCHEMA_VERSION,
        "platform": platform.platform(),
        "python_version": sys.version.split()[0],
        "paths": {
            "database": str(database_root),
            "inbox": str(inbox_root),
            "exports": str(export_root),
        },
        "capabilities": {
            "llm_provider": settings.llm_provider,
            "ocr_mode": _ocr_mode(),
            "ocr_command_configured": bool(os.getenv("DUEFLOW_OCR_COMMAND", "").strip()),
            "supported_file_types": sorted(SUPPORTED_EXTENSIONS),
            "database_backup": True,
            "database_restore": True,
            "diagnostics_export": True,
            "limits": _desktop_intake_limits(),
        },
    }


def _run_self_check(database: Database, settings, database_root: Path, inbox_root: Path, export_root: Path) -> dict:
    checks = [
        _check_directory_writable(database_root.parent, "database_directory", "数据库目录"),
        _check_database(database),
        _check_database_schema(database),
        _check_directory_writable(inbox_root, "inbox_directory", "Inbox 目录"),
        _check_directory_writable(export_root, "export_directory", "导出目录"),
        _check_llm_config(settings),
        _check_ocr_config(),
    ]
    summary = {
        "ok": sum(1 for check in checks if check["status"] == "ok"),
        "warning": sum(1 for check in checks if check["status"] == "warning"),
        "error": sum(1 for check in checks if check["status"] == "error"),
    }
    status = "error" if summary["error"] else "warning" if summary["warning"] else "ok"
    return {"status": status, "summary": summary, "checks": checks}


def _build_diagnostics(database: Database, settings, database_root: Path, inbox_root: Path, export_root: Path) -> dict:
    inbox_items = database.list_inbox_items()
    tasks = database.list_tasks()
    plans = database.list_plan_items()
    risks = database.list_risks()
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "about": _build_about(database, settings, database_root, inbox_root, export_root),
        "self_check": _run_self_check(database, settings, database_root, inbox_root, export_root),
        "counts": {
            "inbox": _count_by_status(inbox_items),
            "tasks": _count_by_status(tasks),
            "plans": {"total": len(plans)},
            "risks": {
                "total": len(risks),
                "high": sum(1 for risk in risks if risk.severity == "high"),
                "medium": sum(1 for risk in risks if risk.severity == "medium"),
                "low": sum(1 for risk in risks if risk.severity == "low"),
            },
            "exports": {"total": len(database.list_export_records())},
        },
        "latest_backups": _list_database_backups(export_root)[:5],
    }


def _count_by_status(items) -> dict:
    counts = {"total": len(items)}
    for item in items:
        status = getattr(item, "status", "unknown") or "unknown"
        counts[status] = counts.get(status, 0) + 1
    return counts


def _write_diagnostics_report(report: dict, export_root: Path) -> Path:
    diagnostics_dir = export_root / "diagnostics"
    diagnostics_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = _next_diagnostics_report_path(diagnostics_dir, timestamp)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    _prune_diagnostics_reports(diagnostics_dir, keep=DIAGNOSTICS_RETENTION_LIMIT, preserve=path)
    return path


def _next_diagnostics_report_path(diagnostics_dir: Path, timestamp: str) -> Path:
    existing_indices = []
    for path in diagnostics_dir.iterdir():
        if not path.is_file() or not _is_safe_diagnostics_file_name(path.name):
            continue
        existing_timestamp, index, _ = _diagnostics_report_sort_key(path)
        if existing_timestamp == timestamp:
            existing_indices.append(index)
    if not existing_indices:
        return diagnostics_dir / f"dueflow-diagnostics-{timestamp}.json"
    return diagnostics_dir / f"dueflow-diagnostics-{timestamp}-{max(existing_indices) + 1}.json"


def _prune_diagnostics_reports(diagnostics_dir: Path, keep: int, preserve: Path) -> None:
    reports = [
        path
        for path in diagnostics_dir.iterdir()
        if path.is_file() and path != preserve and _is_safe_diagnostics_file_name(path.name)
    ]
    reports.sort(key=_diagnostics_report_sort_key, reverse=True)
    keep_existing = max(0, keep - 1)
    for path in reports[keep_existing:]:
        path.unlink(missing_ok=True)


def _diagnostics_report_sort_key(path: Path) -> tuple[str, int, int]:
    stem = path.name.removesuffix(".json").removeprefix("dueflow-diagnostics-")
    timestamp, separator, suffix = stem.rpartition("-")
    if separator and suffix.isdigit():
        return (timestamp, int(suffix), path.stat().st_mtime_ns)
    return (stem, 1, path.stat().st_mtime_ns)


def _check_directory_writable(path: Path, check_id: str, label: str) -> dict:
    try:
        path.mkdir(parents=True, exist_ok=True)
        probe = path / ".dueflow_write_test"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
        return {
            "id": check_id,
            "label": label,
            "status": "ok",
            "message": "目录可写。",
            "path": str(path),
        }
    except Exception as exc:
        return {
            "id": check_id,
            "label": label,
            "status": "error",
            "message": f"目录不可写：{exc}",
            "path": str(path),
        }


def _check_database(database: Database) -> dict:
    try:
        with database.connect() as conn:
            result = conn.execute("PRAGMA quick_check").fetchone()
        value = result[0] if result else "unknown"
        return {
            "id": "database_integrity",
            "label": "数据库完整性",
            "status": "ok" if value == "ok" else "error",
            "message": "SQLite quick_check 正常。" if value == "ok" else f"SQLite quick_check 返回：{value}",
            "path": str(database.path),
        }
    except Exception as exc:
        return {
            "id": "database_integrity",
            "label": "数据库完整性",
            "status": "error",
            "message": f"数据库检查失败：{exc}",
            "path": str(database.path),
        }


def _check_database_schema(database: Database) -> dict:
    expected_tables = {"inbox_items", "tasks", "plan_items", "risks", "export_records"}
    try:
        with database.connect() as conn:
            rows = conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
            version_row = conn.execute("PRAGMA user_version").fetchone()
        tables = {row["name"] for row in rows}
        missing = sorted(expected_tables - tables)
        version = int(version_row[0]) if version_row else 0
        if missing:
            status = "error"
            message = f"缺少表：{', '.join(missing)}"
        elif version != SCHEMA_VERSION:
            status = "error"
            message = f"Schema version {version} 与当前版本 {SCHEMA_VERSION} 不匹配。"
        else:
            status = "ok"
            message = f"核心数据表已就绪，schema version {version}。"
        return {
            "id": "database_schema",
            "label": "数据库表结构",
            "status": status,
            "message": message,
            "path": str(database.path),
        }
    except Exception as exc:
        return {
            "id": "database_schema",
            "label": "数据库表结构",
            "status": "error",
            "message": f"表结构检查失败：{exc}",
            "path": str(database.path),
        }


def _check_llm_config(settings) -> dict:
    if settings.llm_provider == "mock":
        return {
            "id": "llm_provider",
            "label": "LLM Provider",
            "status": "warning",
            "message": "当前使用 mock provider，适合演示和本地测试；上线使用真实模型时需要配置 API Key。",
        }
    if not settings.llm_api_key:
        return {
            "id": "llm_provider",
            "label": "LLM Provider",
            "status": "error",
            "message": f"{settings.llm_provider} 未配置 LLM_API_KEY。",
        }
    return {
        "id": "llm_provider",
        "label": "LLM Provider",
        "status": "ok",
        "message": f"{settings.llm_provider} 已配置。",
    }


def _check_ocr_config() -> dict:
    mode = _ocr_mode()
    if mode == "unavailable":
        return {
            "id": "ocr",
            "label": "OCR",
            "status": "warning",
            "message": "当前环境没有可用 OCR；图片截图输入会失败，文本/PDF/Markdown 不受影响。",
        }
    return {
        "id": "ocr",
        "label": "OCR",
        "status": "ok",
        "message": f"OCR 模式：{mode}。",
    }


def _desktop_intake_limits() -> dict:
    return {
        "max_text_chars": _max_text_intake_chars(),
        "max_upload_bytes": _max_upload_bytes(),
    }


def _max_text_intake_chars() -> int:
    return _positive_int_env("DUEFLOW_MAX_TEXT_CHARS", DEFAULT_MAX_TEXT_INTAKE_CHARS)


def _max_upload_bytes() -> int:
    explicit_bytes = os.getenv("DUEFLOW_MAX_UPLOAD_BYTES", "").strip()
    if explicit_bytes:
        return _positive_int_env("DUEFLOW_MAX_UPLOAD_BYTES", DEFAULT_MAX_UPLOAD_BYTES)

    megabytes = os.getenv("DUEFLOW_MAX_UPLOAD_MB", "").strip()
    if megabytes:
        try:
            value = int(float(megabytes) * 1024 * 1024)
        except ValueError:
            return DEFAULT_MAX_UPLOAD_BYTES
        return value if value > 0 else DEFAULT_MAX_UPLOAD_BYTES

    return DEFAULT_MAX_UPLOAD_BYTES


def _positive_int_env(name: str, default: int) -> int:
    value = os.getenv(name, "").strip()
    if not value:
        return default
    try:
        parsed = int(value)
    except ValueError:
        return default
    return parsed if parsed > 0 else default


async def _read_upload_limited(file: UploadFile, max_bytes: int) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(UPLOAD_READ_CHUNK_BYTES)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise ValueError(f"uploaded file is too large: max {max_bytes} bytes")
        chunks.append(chunk)
    return b"".join(chunks)


def _create_database_backup(database: Database, export_root: Path, label: str | None = None) -> dict:
    backup_dir = export_root / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    created_at = datetime.now(timezone.utc)
    suffix = f"-{label}" if label else ""
    stem = f"dueflow-backup-{created_at.strftime('%Y%m%dT%H%M%SZ')}{suffix}"
    file_name = f"{stem}.db"
    backup_path = backup_dir / file_name
    index = 2
    while backup_path.exists():
        file_name = f"{stem}-{index}.db"
        backup_path = backup_dir / file_name
        index += 1

    with database.connect() as source_conn:
        with sqlite3.connect(backup_path) as backup_conn:
            source_conn.backup(backup_conn)

    return _database_backup_payload(backup_path, created_at)


def _restore_database_from_backup(database: Database, backup_path: Path) -> None:
    with sqlite3.connect(backup_path) as source_conn:
        with database.connect() as target_conn:
            source_conn.backup(target_conn)


def _validate_database_backup(backup_path: Path) -> None:
    with sqlite3.connect(f"file:{backup_path}?mode=ro", uri=True) as conn:
        result = conn.execute("PRAGMA quick_check").fetchone()
        if not result or result[0] != "ok":
            raise ValueError(f"SQLite quick_check failed for backup: {result[0] if result else 'unknown'}")
        rows = conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
        version_row = conn.execute("PRAGMA user_version").fetchone()
    tables = {row[0] for row in rows}
    expected_tables = {"inbox_items", "tasks", "plan_items", "risks", "export_records"}
    missing = sorted(expected_tables - tables)
    if missing:
        raise ValueError(f"backup is missing required tables: {', '.join(missing)}")
    version = int(version_row[0]) if version_row else 0
    if version != SCHEMA_VERSION:
        raise ValueError(f"backup schema version {version} does not match current version {SCHEMA_VERSION}")


def _list_database_backups(export_root: Path) -> list[dict]:
    backup_dir = export_root / "backups"
    if not backup_dir.exists():
        return []
    backups = [
        _database_backup_payload(path)
        for path in backup_dir.iterdir()
        if path.is_file() and _is_safe_backup_file_name(path.name)
    ]
    return sorted(backups, key=lambda item: item["created_at"], reverse=True)


def _resolve_database_backup_path(export_root: Path, file_name: str) -> Path:
    if not _is_safe_backup_file_name(file_name):
        raise FileNotFoundError(file_name)
    path = export_root / "backups" / file_name
    if not path.exists() or not path.is_file():
        raise FileNotFoundError(file_name)
    return path


def _database_backup_payload(path: Path, created_at: datetime | None = None) -> dict:
    created = created_at or datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
    return {
        "kind": "sqlite_backup",
        "file_name": path.name,
        "file_path": str(path),
        "download_url": f"/desktop/database/backups/{path.name}",
        "bytes": path.stat().st_size,
        "created_at": created.isoformat(),
    }


def _is_safe_backup_file_name(file_name: str) -> bool:
    if "/" in file_name or "\\" in file_name:
        return False
    return file_name.startswith("dueflow-backup-") and file_name.endswith(".db")


def _is_safe_diagnostics_file_name(file_name: str) -> bool:
    if "/" in file_name or "\\" in file_name:
        return False
    return file_name.startswith("dueflow-diagnostics-") and file_name.endswith(".json")


def _extract_or_fail(database: Database, item, provider) -> list[TaskItem]:
    try:
        return extract_tasks(item, provider)
    except Exception as exc:
        database.update_inbox_status(item.id, "failed", str(exc))
        raise HTTPException(status_code=500, detail=f"task extraction failed: {exc}") from exc


def _dump(value) -> dict | None:
    if value is None:
        return None
    return asdict(value)


def _dump_inbox_items(items) -> list[dict]:
    return [_dump_inbox_item(item, items) for item in items]


def _dump_inbox_item(item, items) -> dict:
    payload = asdict(item)
    original = _find_original_inbox_item(item, items)
    payload["duplicate_of"] = (
        {
            "id": original.id,
            "title": original.title,
            "received_at": original.received_at,
            "status": original.status,
        }
        if original
        else None
    )
    return payload


def _find_original_inbox_item(item, items):
    if item.status != "duplicate":
        return None
    for candidate in items:
        if candidate.id != item.id and candidate.content_hash == item.content_hash and candidate.status != "duplicate":
            return candidate
    for candidate in items:
        if candidate.id != item.id and candidate.content_hash == item.content_hash:
            return candidate
    return None


def _ocr_mode() -> str:
    if os.getenv("DUEFLOW_OCR_COMMAND", "").strip():
        return "custom_command"
    if platform.system() == "Darwin":
        return "macos_vision"
    return "unavailable"


app = create_app()
