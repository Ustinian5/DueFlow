from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Settings:
    llm_provider: str = "mock"
    llm_api_key: str = ""
    llm_base_url: str = ""
    llm_model: str = ""
    database_path: str = "dueflow.db"
    inbox_path: str = "inbox"
    export_path: str = "exports"


def load_dotenv(path: str | Path = ".env") -> None:
    env_path = Path(path)
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def load_settings(path: str | Path = ".env") -> Settings:
    load_dotenv(path)
    return Settings(
        llm_provider=os.getenv("LLM_PROVIDER", "mock").lower(),
        llm_api_key=os.getenv("LLM_API_KEY", ""),
        llm_base_url=os.getenv("LLM_BASE_URL", ""),
        llm_model=os.getenv("LLM_MODEL", ""),
        database_path=os.getenv("DATABASE_PATH", "dueflow.db"),
        inbox_path=os.getenv("INBOX_PATH", "inbox"),
        export_path=os.getenv("EXPORT_PATH", "exports"),
    )
