import tempfile
import unittest
from datetime import date
from pathlib import Path

from src.database import Database
from src.inbox import InboxService
from src.llm_provider import MockLLMProvider
from src.pipeline import process_pending_inbox


class PipelineTests(unittest.TestCase):
    def test_process_pending_inbox_creates_tasks_plans_and_risks(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = Database(Path(tmp) / "dueflow.db")
            db.initialize()
            service = InboxService(db)
            service.add_manual(
                "Course notice",
                "代码开源在 GitHub 或 Hugging Face，编写 README.md 并转换成 PDF 提交，截止时间 2026-06-30 23:59。",
            )

            result = process_pending_inbox(db, MockLLMProvider(), today=date(2026, 6, 16))

            self.assertEqual(result["processed"], 1)
            self.assertEqual(len(db.list_tasks()), 1)
            self.assertTrue(db.list_plan_items())
            self.assertTrue(all(item.status == "processed" for item in db.list_inbox_items()))


if __name__ == "__main__":
    unittest.main()
