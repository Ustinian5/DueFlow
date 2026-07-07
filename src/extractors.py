from __future__ import annotations

from typing import Any

from .llm_provider import LLMProvider
from .models import InboxItem, TaskItem


EXTRACTION_SYSTEM_PROMPT = """你是 DueFlow 的结构化抽取 Agent。只输出 JSON。
要求：
1. 不允许编造截止时间。
2. 原文没有明确截止时间时 deadline 必须为 null，deadline_confidence 必须为 low。
3. 每个任务必须包含 source_quote。
4. 原文没有的信息放入 missing_info。
"""


def extract_tasks(inbox_item: InboxItem, provider: LLMProvider) -> list[TaskItem]:
    payload = provider.generate_json(EXTRACTION_SYSTEM_PROMPT, inbox_item.content, "task_extraction")
    raw_tasks = payload.get("tasks", payload if isinstance(payload, list) else [payload])
    tasks: list[TaskItem] = []
    for raw in raw_tasks:
        if not isinstance(raw, dict):
            continue
        tasks.append(_task_from_payload(inbox_item.id, raw))
    return tasks


def _task_from_payload(inbox_item_id: str, raw: dict[str, Any]) -> TaskItem:
    deadline = raw.get("deadline")
    confidence = raw.get("deadline_confidence") or ("low" if not deadline else "medium")
    if not deadline:
        confidence = "low"
    return TaskItem(
        inbox_item_id=inbox_item_id,
        title=str(raw.get("title") or "未命名 DDL"),
        description=str(raw.get("description") or ""),
        deadline=deadline,
        deadline_confidence=str(confidence),
        deliverables=[str(item) for item in raw.get("deliverables") or []],
        submit_method=raw.get("submit_method"),
        location=raw.get("location"),
        priority=str(raw.get("priority") or "medium"),
        source_quote=str(raw.get("source_quote") or ""),
        missing_info=[str(item) for item in raw.get("missing_info") or []],
    )
