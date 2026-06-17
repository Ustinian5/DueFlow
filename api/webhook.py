from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from src.config import load_settings
from src.database import Database
from src.inbox import InboxService
from src.llm_provider import get_llm_provider
from src.pipeline import process_pending_inbox


class WebhookPayload(BaseModel):
    title: str = "Webhook notice"
    content: str
    source: str | None = None


def create_app(database_path: str | Path | None = None) -> FastAPI:
    settings = load_settings()
    database = Database(database_path or settings.database_path)
    database.initialize()
    inbox_service = InboxService(database)
    api = FastAPI(title="DueFlow Webhook API", version="0.1.0")

    @api.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @api.post("/webhook/inbox")
    def create_inbox_item(payload: WebhookPayload, process: bool = False) -> dict:
        if not payload.content.strip():
            raise HTTPException(status_code=400, detail="content is required")
        item = inbox_service.add_webhook(payload.title, payload.content, payload.source)
        result = {"id": item.id, "status": item.status, "source_type": item.source_type}
        if process and item.status == "pending":
            result["process_result"] = process_pending_inbox(database, get_llm_provider(settings))
        elif process:
            result["process_result"] = {"processed": 0, "failed": 0, "skipped": 1, "tasks": 0, "plans": 0, "risks": 0}
        return result

    return api


app = create_app()
