from __future__ import annotations

from datetime import date, datetime, timedelta

from .models import PlanItem, TaskItem


def generate_plan(task: TaskItem, today: date | None = None) -> list[PlanItem]:
    current = today or date.today()
    deadline_date = _parse_deadline_date(task.deadline)
    if deadline_date is None or task.deadline_confidence == "low":
        return [
            PlanItem(
                task_id=task.id,
                date=None,
                title=f"确认任务信息：{task.title}",
                description="确认截止时间、提交方式和提交物后再生成具体日程。",
                type="confirm",
            )
        ]

    if deadline_date <= current:
        return [
            PlanItem(task_id=task.id, date=current.isoformat(), title=f"立即处理：{task.title}", description=task.description, type="todo"),
            PlanItem(task_id=task.id, date=current.isoformat(), title=f"提交：{task.title}", description=task.submit_method or "按原通知要求提交", type="submit"),
        ]

    days = (deadline_date - current).days
    plan: list[PlanItem] = []
    start_date = current + timedelta(days=1)
    final_check_date = max(current, deadline_date - timedelta(days=1))

    plan.append(
        PlanItem(
            task_id=task.id,
            date=start_date.isoformat(),
            title=f"启动任务：{task.title}",
            description="阅读原始通知，确认范围、提交物和时间安排。",
            type="milestone",
        )
    )

    deliverables = task.deliverables or ["主要提交物"]
    available_days = max(1, days - 2)
    for index, deliverable in enumerate(deliverables[:4], start=1):
        offset = min(available_days, max(1, round(index * available_days / (len(deliverables[:4]) + 1))))
        work_date = min(final_check_date - timedelta(days=1), current + timedelta(days=offset))
        plan.append(
            PlanItem(
                task_id=task.id,
                date=work_date.isoformat(),
                title=f"完成提交物：{deliverable}",
                description=f"推进并检查 {deliverable}。",
                type="todo",
            )
        )

    review_date = max(start_date, final_check_date - timedelta(days=2))
    plan.append(
        PlanItem(
            task_id=task.id,
            date=review_date.isoformat(),
            title=f"阶段复查：{task.title}",
            description="检查任务进度、遗漏项和外部依赖。",
            type="review",
        )
    )
    plan.append(
        PlanItem(
            task_id=task.id,
            date=final_check_date.isoformat(),
            title=f"最终检查：{task.title}",
            description="检查提交物、格式、链接、文件命名和提交入口。",
            type="final_check",
        )
    )
    plan.append(
        PlanItem(
            task_id=task.id,
            date=deadline_date.isoformat(),
            title=f"提交：{task.title}",
            description=task.submit_method or "按原通知要求提交。",
            type="submit",
        )
    )
    return sorted(plan, key=lambda item: (item.date or "9999-12-31", item.type))


def _parse_deadline_date(value: str | None) -> date | None:
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
