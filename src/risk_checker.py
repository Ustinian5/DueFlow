from __future__ import annotations

from datetime import date, datetime

from .models import PlanItem, RiskItem, TaskItem


def check_risks(task: TaskItem, plans: list[PlanItem], today: date | None = None) -> list[RiskItem]:
    current = today or date.today()
    risks: list[RiskItem] = []

    if not task.deadline or task.deadline_confidence == "low":
        risks.append(
            RiskItem(
                task_id=task.id,
                risk_type="missing_deadline",
                severity="high",
                message="任务没有明确截止时间。",
                suggestion="优先确认截止时间，再生成具体日程。",
            )
        )
    else:
        deadline_date = _parse_date(task.deadline)
        if deadline_date and (deadline_date - current).days <= 3:
            risks.append(
                RiskItem(
                    task_id=task.id,
                    risk_type="deadline_too_close",
                    severity="high",
                    message="任务截止时间很近。",
                    suggestion="减少非必要步骤，优先完成最小可提交版本。",
                )
            )

    if not task.submit_method:
        risks.append(
            RiskItem(
                task_id=task.id,
                risk_type="missing_submit_method",
                severity="medium",
                message="任务缺少提交方式。",
                suggestion="从原通知或课程平台确认提交入口。",
            )
        )

    if not task.deliverables:
        risks.append(
            RiskItem(
                task_id=task.id,
                risk_type="missing_deliverable",
                severity="medium",
                message="任务缺少明确提交物。",
                suggestion="补充需要提交的文件、链接或材料清单。",
            )
        )

    if task.deadline and not any(plan.type == "final_check" for plan in plans):
        risks.append(
            RiskItem(
                task_id=task.id,
                risk_type="missing_final_check",
                severity="medium",
                message="计划中没有最终检查步骤。",
                suggestion="在截止日前一天增加提交物和链接检查。",
            )
        )

    joined = " ".join(task.deliverables + task.missing_info + [task.description])
    if any(keyword in joined for keyword in ("注册", "报名", "申请", "审核", "API Key", "权限")):
        risks.append(
            RiskItem(
                task_id=task.id,
                risk_type="external_dependency",
                severity="medium",
                message="任务包含外部依赖。",
                suggestion="尽早处理注册、权限申请或外部审核。",
            )
        )
    return risks


def _parse_date(value: str) -> date | None:
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d", "%Y/%m/%d %H:%M", "%Y/%m/%d"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(value).date()
    except ValueError:
        return None
