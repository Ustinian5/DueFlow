from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from collections.abc import Iterator
from typing import Optional

from .models import ExportRecord, InboxItem, PlanItem, RiskItem, TaskItem


class Database:
    def __init__(self, path: str | Path = "dueflow.db") -> None:
        self.path = Path(path)

    def _connect(self) -> sqlite3.Connection:
        if self.path.parent != Path("."):
            self.path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return conn

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = self._connect()
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def initialize(self) -> None:
        with self.connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS inbox_items (
                    id TEXT PRIMARY KEY,
                    source_type TEXT NOT NULL,
                    title TEXT NOT NULL,
                    content TEXT NOT NULL,
                    content_hash TEXT NOT NULL,
                    received_at TEXT NOT NULL,
                    status TEXT NOT NULL,
                    error_message TEXT
                );

                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY,
                    inbox_item_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    description TEXT NOT NULL,
                    deadline TEXT,
                    deadline_confidence TEXT NOT NULL,
                    deliverables TEXT NOT NULL,
                    submit_method TEXT,
                    location TEXT,
                    priority TEXT NOT NULL,
                    source_quote TEXT NOT NULL,
                    missing_info TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS plan_items (
                    id TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL,
                    date TEXT,
                    title TEXT NOT NULL,
                    description TEXT NOT NULL,
                    type TEXT NOT NULL,
                    status TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS risks (
                    id TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL,
                    risk_type TEXT NOT NULL,
                    severity TEXT NOT NULL,
                    message TEXT NOT NULL,
                    suggestion TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS export_records (
                    id TEXT PRIMARY KEY,
                    export_type TEXT NOT NULL,
                    file_path TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                """
            )

    def insert_inbox_item(self, item: InboxItem) -> InboxItem:
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO inbox_items (
                    id, source_type, title, content, content_hash,
                    received_at, status, error_message
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item.id,
                    item.source_type,
                    item.title,
                    item.content,
                    item.content_hash,
                    item.received_at,
                    item.status,
                    item.error_message,
                ),
            )
        return item

    def find_inbox_by_hash(self, content_hash: str) -> Optional[InboxItem]:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM inbox_items WHERE content_hash = ? ORDER BY received_at LIMIT 1",
                (content_hash,),
            ).fetchone()
        return self._row_to_inbox(row) if row else None

    def list_inbox_items(self) -> list[InboxItem]:
        with self.connect() as conn:
            rows = conn.execute("SELECT * FROM inbox_items ORDER BY received_at, id").fetchall()
        return [self._row_to_inbox(row) for row in rows]

    def update_inbox_status(self, item_id: str, status: str, error_message: str | None = None) -> None:
        with self.connect() as conn:
            conn.execute(
                "UPDATE inbox_items SET status = ?, error_message = ? WHERE id = ?",
                (status, error_message, item_id),
            )

    def insert_task(self, task: TaskItem) -> TaskItem:
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO tasks (
                    id, inbox_item_id, title, description, deadline,
                    deadline_confidence, deliverables, submit_method, location,
                    priority, source_quote, missing_info, status, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    task.id,
                    task.inbox_item_id,
                    task.title,
                    task.description,
                    task.deadline,
                    task.deadline_confidence,
                    json.dumps(task.deliverables, ensure_ascii=False),
                    task.submit_method,
                    task.location,
                    task.priority,
                    task.source_quote,
                    json.dumps(task.missing_info, ensure_ascii=False),
                    task.status,
                    task.created_at,
                ),
            )
        return task

    def list_tasks(self) -> list[TaskItem]:
        with self.connect() as conn:
            rows = conn.execute("SELECT * FROM tasks ORDER BY created_at, id").fetchall()
        return [self._row_to_task(row) for row in rows]

    def update_task_status(self, task_id: str, status: str) -> None:
        if status not in {"todo", "doing", "done", "archived"}:
            raise ValueError(f"Unsupported task status: {status}")
        with self.connect() as conn:
            conn.execute("UPDATE tasks SET status = ? WHERE id = ?", (status, task_id))

    def insert_plan_item(self, item: PlanItem) -> PlanItem:
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO plan_items (id, task_id, date, title, description, type, status)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (item.id, item.task_id, item.date, item.title, item.description, item.type, item.status),
            )
        return item

    def list_plan_items(self) -> list[PlanItem]:
        with self.connect() as conn:
            rows = conn.execute("SELECT * FROM plan_items ORDER BY date IS NULL, date, id").fetchall()
        return [self._row_to_plan(row) for row in rows]

    def insert_risk(self, risk: RiskItem) -> RiskItem:
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO risks (id, task_id, risk_type, severity, message, suggestion, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (risk.id, risk.task_id, risk.risk_type, risk.severity, risk.message, risk.suggestion, risk.created_at),
            )
        return risk

    def list_risks(self) -> list[RiskItem]:
        with self.connect() as conn:
            rows = conn.execute("SELECT * FROM risks ORDER BY created_at, id").fetchall()
        return [self._row_to_risk(row) for row in rows]

    def insert_export_record(self, export_type: str, file_path: str) -> ExportRecord:
        record = ExportRecord(export_type=export_type, file_path=file_path)
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO export_records (id, export_type, file_path, created_at) VALUES (?, ?, ?, ?)",
                (record.id, record.export_type, record.file_path, record.created_at),
            )
        return record

    def list_export_records(self) -> list[ExportRecord]:
        with self.connect() as conn:
            rows = conn.execute("SELECT * FROM export_records ORDER BY created_at, id").fetchall()
        return [ExportRecord(id=row["id"], export_type=row["export_type"], file_path=row["file_path"], created_at=row["created_at"]) for row in rows]

    @staticmethod
    def _row_to_inbox(row: sqlite3.Row) -> InboxItem:
        return InboxItem(
            id=row["id"],
            source_type=row["source_type"],
            title=row["title"],
            content=row["content"],
            content_hash=row["content_hash"],
            received_at=row["received_at"],
            status=row["status"],
            error_message=row["error_message"],
        )

    @staticmethod
    def _row_to_task(row: sqlite3.Row) -> TaskItem:
        return TaskItem(
            id=row["id"],
            inbox_item_id=row["inbox_item_id"],
            title=row["title"],
            description=row["description"],
            deadline=row["deadline"],
            deadline_confidence=row["deadline_confidence"],
            deliverables=json.loads(row["deliverables"]),
            submit_method=row["submit_method"],
            location=row["location"],
            priority=row["priority"],
            source_quote=row["source_quote"],
            missing_info=json.loads(row["missing_info"]),
            status=row["status"],
            created_at=row["created_at"],
        )

    @staticmethod
    def _row_to_plan(row: sqlite3.Row) -> PlanItem:
        return PlanItem(
            id=row["id"],
            task_id=row["task_id"],
            date=row["date"],
            title=row["title"],
            description=row["description"],
            type=row["type"],
            status=row["status"],
        )

    @staticmethod
    def _row_to_risk(row: sqlite3.Row) -> RiskItem:
        return RiskItem(
            id=row["id"],
            task_id=row["task_id"],
            risk_type=row["risk_type"],
            severity=row["severity"],
            message=row["message"],
            suggestion=row["suggestion"],
            created_at=row["created_at"],
        )
