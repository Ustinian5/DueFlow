from __future__ import annotations

from datetime import date

from .database import Database
from .extractors import extract_tasks
from .llm_provider import LLMProvider, get_llm_provider
from .planner import generate_plan
from .risk_checker import check_risks


def process_pending_inbox(
    database: Database,
    provider: LLMProvider | None = None,
    today: date | None = None,
) -> dict[str, int]:
    resolved_provider = provider or get_llm_provider()
    counters = {"processed": 0, "failed": 0, "skipped": 0, "tasks": 0, "plans": 0, "risks": 0}

    for item in database.list_inbox_items():
        if item.status == "duplicate":
            counters["skipped"] += 1
            continue
        if item.status != "pending":
            continue
        try:
            tasks = extract_tasks(item, resolved_provider)
            for task in tasks:
                database.insert_task(task)
                counters["tasks"] += 1
                plans = generate_plan(task, today=today)
                for plan in plans:
                    database.insert_plan_item(plan)
                    counters["plans"] += 1
                risks = check_risks(task, plans, today=today)
                for risk in risks:
                    database.insert_risk(risk)
                    counters["risks"] += 1
            database.update_inbox_status(item.id, "processed")
            counters["processed"] += 1
        except Exception as exc:
            database.update_inbox_status(item.id, "failed", str(exc))
            counters["failed"] += 1
    return counters
