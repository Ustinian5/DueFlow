from __future__ import annotations

from pathlib import Path

from .database import Database
from .models import InboxItem
from .parsers import content_hash, is_supported_file, normalize_content, parse_file


class InboxService:
    def __init__(self, database: Database) -> None:
        self.database = database

    def add_manual(self, title: str, content: str) -> InboxItem:
        return self._create_item("manual", title, content)

    def add_text(self, source_type: str, title: str, content: str) -> InboxItem:
        return self._create_item(source_type, title, content)

    def add_webhook(self, title: str, content: str, source: str | None = None) -> InboxItem:
        display_title = title or source or "Webhook notice"
        return self._create_item("webhook", display_title, content)

    def add_file(self, path: str | Path, source_type: str = "upload") -> InboxItem:
        file_path = Path(path)
        return self._create_item(source_type, file_path.name, parse_file(file_path))

    def scan_folder(self, folder: str | Path = "inbox") -> list[InboxItem]:
        root = Path(folder)
        root.mkdir(parents=True, exist_ok=True)
        items: list[InboxItem] = []
        for path in sorted(root.iterdir()):
            if path.is_file() and is_supported_file(path):
                items.append(self.add_file(path, source_type="folder"))
        return items

    def _create_item(self, source_type: str, title: str, content: str) -> InboxItem:
        normalized = normalize_content(content)
        digest = content_hash(normalized)
        existing = self.database.find_inbox_by_hash(digest)
        item = InboxItem(
            source_type=source_type,
            title=title.strip() or "Untitled",
            content=normalized,
            content_hash=digest,
            status="duplicate" if existing else "pending",
        )
        return self.database.insert_inbox_item(item)
