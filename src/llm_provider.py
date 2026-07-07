from __future__ import annotations

import json
import re
from typing import Any, Protocol

from .config import Settings, load_settings


class LLMProvider(Protocol):
    def generate_json(self, system_prompt: str, user_prompt: str, schema_name: str) -> dict[str, Any]:
        ...


class MockLLMProvider:
    def generate_json(self, system_prompt: str = "", user_prompt: str = "", schema_name: str = "task_extraction") -> dict[str, Any]:
        text = user_prompt or ""
        deadline = _extract_deadline(text)
        if "机器学习" in text or "README" in text or "GitHub" in text:
            return {
                "tasks": [
                    {
                        "title": "机器学习导论期末项目提交",
                        "description": "完成大模型或 Agent 应用，开源代码并提交 README PDF。",
                        "deadline": deadline or "2026-06-30 23:59",
                        "deadline_confidence": "high" if deadline else "medium",
                        "deliverables": ["GitHub 或 Hugging Face 开源代码", "README.md", "README PDF"],
                        "submit_method": "课程平台提交",
                        "location": None,
                        "priority": "high",
                        "source_quote": "代码开源在 GitHub 或 Hugging Face，编写 README.md 并转换成 PDF 提交",
                        "missing_info": [],
                    }
                ]
            }
        if deadline:
            return {
                "tasks": [
                    {
                        "title": "处理通知任务",
                        "description": text[:160],
                        "deadline": deadline,
                        "deadline_confidence": "high",
                        "deliverables": [],
                        "submit_method": None,
                        "location": None,
                        "priority": "medium",
                        "source_quote": text[:120],
                        "missing_info": ["提交物", "提交方式"],
                    }
                ]
            }
        return {
            "tasks": [
                {
                    "title": "未命名 DDL",
                    "description": text[:160],
                    "deadline": None,
                    "deadline_confidence": "low",
                    "deliverables": [],
                    "submit_method": None,
                    "location": None,
                    "priority": "medium",
                    "source_quote": text[:120],
                    "missing_info": ["截止时间", "提交方式"],
                }
            ]
        }


class OpenAICompatibleProvider:
    def __init__(self, settings: Settings) -> None:
        if not settings.llm_api_key:
            raise ValueError("LLM_API_KEY is required for real model providers")
        if not settings.llm_model:
            raise ValueError("LLM_MODEL is required for real model providers")
        self.settings = settings

    def generate_json(self, system_prompt: str, user_prompt: str, schema_name: str) -> dict[str, Any]:
        try:
            from openai import OpenAI  # type: ignore
        except ModuleNotFoundError as exc:
            raise RuntimeError("Install openai to use real LLM providers") from exc

        client = OpenAI(api_key=self.settings.llm_api_key, base_url=self.settings.llm_base_url or None)
        response = client.chat.completions.create(
            model=self.settings.llm_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
        )
        content = response.choices[0].message.content or "{}"
        return extract_json_object(content)


def get_llm_provider(settings: Settings | None = None) -> LLMProvider:
    resolved = settings or load_settings()
    if resolved.llm_provider == "mock":
        return MockLLMProvider()
    return OpenAICompatibleProvider(resolved)


def extract_json_object(content: str) -> dict[str, Any]:
    cleaned = content.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", cleaned, flags=re.DOTALL)
    if fenced:
        cleaned = fenced.group(1)
    elif not cleaned.startswith("{"):
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start >= 0 and end > start:
            cleaned = cleaned[start : end + 1]
    return json.loads(cleaned)


def _extract_deadline(text: str) -> str | None:
    patterns = [
        r"(20\d{2})[-/年](\d{1,2})[-/月](\d{1,2})日?\s*(\d{1,2}:\d{2})?",
        r"(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2}:\d{2})?",
    ]
    first = re.search(patterns[0], text)
    if first:
        year, month, day, time = first.groups()
        return f"{int(year):04d}-{int(month):02d}-{int(day):02d} {time or '23:59'}"
    second = re.search(patterns[1], text)
    if second:
        month, day, time = second.groups()
        return f"2026-{int(month):02d}-{int(day):02d} {time or '23:59'}"
    return None
