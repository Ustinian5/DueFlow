from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
from uuid import uuid4


def new_id() -> str:
    return str(uuid4())


def now_iso() -> str:
    return datetime.now().replace(microsecond=0).isoformat(sep=" ")


@dataclass
class InboxItem:
    source_type: str
    title: str
    content: str
    id: str = field(default_factory=new_id)
    content_hash: str = ""
    received_at: str = field(default_factory=now_iso)
    status: str = "pending"
    error_message: Optional[str] = None


@dataclass
class TaskItem:
    inbox_item_id: str
    title: str
    description: str
    deadline: Optional[str]
    deadline_confidence: str
    deliverables: list[str]
    submit_method: Optional[str]
    priority: str
    source_quote: str
    id: str = field(default_factory=new_id)
    location: Optional[str] = None
    missing_info: list[str] = field(default_factory=list)
    status: str = "todo"
    created_at: str = field(default_factory=now_iso)


@dataclass
class PlanItem:
    task_id: str
    date: Optional[str]
    title: str
    description: str
    type: str
    id: str = field(default_factory=new_id)
    status: str = "todo"


@dataclass
class RiskItem:
    task_id: str
    risk_type: str
    severity: str
    message: str
    suggestion: str
    id: str = field(default_factory=new_id)
    created_at: str = field(default_factory=now_iso)


@dataclass
class ExportRecord:
    export_type: str
    file_path: str
    id: str = field(default_factory=new_id)
    created_at: str = field(default_factory=now_iso)
