import json
import tempfile
import unittest
import warnings
from pathlib import Path

warnings.filterwarnings("ignore", message="Using `httpx` with `starlette.testclient` is deprecated.*")

from fastapi.testclient import TestClient

from api.webhook import create_app
from src.llm_provider import extract_json_object
from src.parsers import parse_file
from src.report_exporter import export_submission_report


class HighCompletionTests(unittest.TestCase):
    def test_webhook_can_auto_process_notice(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = create_app(Path(tmp) / "dueflow.db")
            client = TestClient(app)

            response = client.post(
                "/webhook/inbox?process=true",
                json={
                    "title": "课程项目通知",
                    "content": "代码开源在 GitHub，编写 README.md 并转换成 PDF 提交，截止时间 2026-06-30 23:59。",
                },
            )

            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertEqual(payload["source_type"], "webhook")
            self.assertEqual(payload["process_result"]["processed"], 1)
            self.assertGreaterEqual(payload["process_result"]["tasks"], 1)

    def test_extract_json_object_accepts_markdown_fenced_json(self):
        content = """模型输出如下：
```json
{"tasks": [{"title": "提交 README", "deadline": "2026-06-30 23:59"}]}
```
"""

        parsed = extract_json_object(content)

        self.assertEqual(parsed["tasks"][0]["title"], "提交 README")

    def test_pdf_parser_reads_generated_pdf_text(self):
        with tempfile.TemporaryDirectory() as tmp:
            pdf_path = Path(tmp) / "notice.pdf"
            from reportlab.pdfgen import canvas

            pdf = canvas.Canvas(str(pdf_path))
            pdf.drawString(72, 720, "Submit README PDF before 2026-06-30 23:59")
            pdf.save()

            text = parse_file(pdf_path)

            self.assertIn("Submit README PDF", text)

    def test_submission_report_contains_project_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            report_path = export_submission_report(
                output_path=Path(tmp) / "submission_report.md",
                project_name="DueFlow",
                verification={
                    "tests": "10 passed",
                    "demo": "processed=3 tasks=3 plans=17 risks=5",
                },
            )

            content = report_path.read_text(encoding="utf-8")
            self.assertIn("DueFlow", content)
            self.assertIn("10 passed", content)
            self.assertIn("processed=3", content)


if __name__ == "__main__":
    unittest.main()
