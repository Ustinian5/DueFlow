from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime

from .models import RiskItem, TaskItem


@dataclass
class PetState:
    state: str
    mood: str
    message: str
    severity: str = "normal"


def derive_pet_state(
    tasks: list[TaskItem],
    risks: list[RiskItem],
    pending_inbox_count: int = 0,
    today: date | None = None,
) -> PetState:
    current = today or date.today()
    active_tasks = [task for task in tasks if task.status not in {"done", "archived"}]

    if pending_inbox_count:
        return PetState(
            state="processing",
            mood="thinking",
            message=f"还有 {pending_inbox_count} 条新信息等你确认。",
        )

    overdue = [task for task in active_tasks if _deadline_date(task.deadline) and _deadline_date(task.deadline) < current]
    if overdue:
        return PetState(
            state="overdue",
            mood="serious",
            message=f"有 {len(overdue)} 个任务已经逾期，需要马上处理。",
            severity="high",
        )

    high_risks = [risk for risk in risks if risk.severity == "high"]
    if high_risks:
        return PetState(
            state="deadline_near",
            mood="worried",
            message=f"发现 {len(high_risks)} 个高风险 DDL。",
            severity="high",
        )

    missing_info = [
        task
        for task in active_tasks
        if task.deadline_confidence == "low" or task.missing_info or not task.submit_method or not task.deliverables
    ]
    if missing_info:
        return PetState(
            state="missing_info",
            mood="confused",
            message=f"有 {len(missing_info)} 个任务信息还不完整。",
            severity="medium",
        )

    due_soon = [
        task
        for task in active_tasks
        if _deadline_date(task.deadline) and 0 <= (_deadline_date(task.deadline) - current).days <= 3
    ]
    if due_soon:
        return PetState(
            state="deadline_near",
            mood="worried",
            message=f"未来 3 天有 {len(due_soon)} 个 DDL。",
            severity="medium",
        )

    if active_tasks:
        return PetState(
            state="idle",
            mood="calm",
            message=f"当前有 {len(active_tasks)} 个待办任务。",
        )

    if tasks:
        return PetState(
            state="task_done",
            mood="happy",
            message="当前任务都处理完了。",
        )

    return PetState(
        state="no_task",
        mood="relaxed",
        message="现在没有 DDL，可以休息一下。",
    )


def _deadline_date(value: str | None) -> date | None:
    if not value:
        return None
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d", "%Y/%m/%d %H:%M", "%Y/%m/%d"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(value).date()
    except ValueError:
        return None

