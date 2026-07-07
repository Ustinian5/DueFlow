import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from api.webhook import create_app


class WebhookTests(unittest.TestCase):
    def test_webhook_inserts_inbox_item_and_rejects_empty_content(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = create_app(Path(tmp) / "dueflow.db")
            client = TestClient(app)

            self.assertEqual(client.get("/health").json(), {"status": "ok"})

            bad = client.post("/webhook/inbox", json={"title": "bad", "content": " "})
            self.assertEqual(bad.status_code, 400)

            created = client.post(
                "/webhook/inbox",
                json={"title": "课程通知", "content": "请在 2026-06-30 23:59 前提交 README PDF。"},
            )
            self.assertEqual(created.status_code, 200)
            self.assertEqual(created.json()["source_type"], "webhook")
            self.assertEqual(created.json()["status"], "pending")


if __name__ == "__main__":
    unittest.main()
