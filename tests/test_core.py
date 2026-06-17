import json
import tempfile
import unittest
from datetime import date
from pathlib import Path

from src.database import Database
from src.extractors import extract_tasks
from src.inbox import InboxService
from src.llm_provider import MockLLMProvider
from src.models import InboxItem, TaskItem
from src.parsers import content_hash, normalize_content, parse_file
from src.planner import generate_plan
from src.risk_checker import check_risks
from src.report_exporter import export_plan_markdown, export_summary_markdown, export_todo_markdown
from src.calendar_exporter import export_calendar_ics


class ParserTests(unittest.TestCase):
    def test_parse_text_and_markdown_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            txt = root / "notice.txt"
            md = root / "notice.md"
            txt.write_text("DDL: Friday 23:59", encoding="utf-8")
            md.write_text("# Notice\nSubmit README.pdf", encoding="utf-8")

            self.assertEqual(parse_file(txt), "DDL: Friday 23:59")
            self.assertIn("Submit README.pdf", parse_file(md))

    def test_normalized_hash_ignores_outer_whitespace(self):
        left = content_hash("  Submit project\n")
        right = content_hash("Submit project")
        self.assertEqual(left, right)
        self.assertEqual(normalize_content(" A\r\nB "), "A\nB")


class DatabaseAndInboxTests(unittest.TestCase):
    def test_inbox_deduplicates_by_content_hash(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = Database(Path(tmp) / "dueflow.db")
            db.initialize()
            service = InboxService(db)

            first = service.add_manual("Course notice", "Submit report by June 30")
            second = service.add_manual("Copied notice", " Submit report by June 30 ")

            self.assertEqual(first.status, "pending")
            self.assertEqual(second.status, "duplicate")
            self.assertEqual(len(db.list_inbox_items()), 2)
            self.assertEqual(db.list_inbox_items()[1].content_hash, first.content_hash)

    def test_database_persists_tasks_plans_risks_and_exports(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = Database(Path(tmp) / "dueflow.db")
            db.initialize()
            inbox = InboxItem(source_type="manual", title="Notice", content="Submit")
            task = TaskItem(
                inbox_item_id=inbox.id,
                title="Submit project",
                description="Submit project files",
                deadline="2026-06-30 23:59",
                deadline_confidence="high",
                deliverables=["README.md"],
                submit_method="GitHub",
                priority="high",
                source_quote="Submit project files",
            )

            db.insert_inbox_item(inbox)
            db.insert_task(task)
            plans = generate_plan(task, today=date(2026, 6, 16))
            for plan in plans:
                db.insert_plan_item(plan)
            risks = check_risks(task, plans, today=date(2026, 6, 16))
            for risk in risks:
                db.insert_risk(risk)
            db.insert_export_record("todo_md", "exports/todo.md")
            db.update_task_status(task.id, "done")

            self.assertEqual(db.list_tasks()[0].title, "Submit project")
            self.assertEqual(db.list_tasks()[0].status, "done")
            self.assertTrue(any(plan.type == "final_check" for plan in db.list_plan_items()))
            self.assertEqual(db.list_export_records()[0].export_type, "todo_md")


class AgentPipelineTests(unittest.TestCase):
    def test_mock_extraction_returns_grounded_course_project_task(self):
        inbox = InboxItem(
            source_type="manual",
            title="ML project",
            content="代码开源在 GitHub 或 Hugging Face，编写 README.md 并转换成 PDF 提交，截止时间 2026-06-30 23:59。",
        )

        tasks = extract_tasks(inbox, MockLLMProvider())

        self.assertEqual(len(tasks), 1)
        self.assertEqual(tasks[0].title, "机器学习导论期末项目提交")
        self.assertEqual(tasks[0].deadline, "2026-06-30 23:59")
        self.assertIn("README.md", tasks[0].deliverables)
        self.assertIn("代码开源", tasks[0].source_quote)

    def test_planner_generates_final_check_before_deadline(self):
        task = TaskItem(
            inbox_item_id="inbox-1",
            title="Submit course project",
            description="Submit source code and README PDF",
            deadline="2026-06-30 23:59",
            deadline_confidence="high",
            deliverables=["source code", "README PDF"],
            submit_method="course platform",
            priority="high",
            source_quote="Submit source code and README PDF by 2026-06-30 23:59",
        )

        plans = generate_plan(task, today=date(2026, 6, 16))

        self.assertTrue(any(item.type == "final_check" for item in plans))
        self.assertTrue(any(item.type == "submit" for item in plans))
        self.assertLess(
            next(item.date for item in plans if item.type == "final_check"),
            next(item.date for item in plans if item.type == "submit"),
        )

    def test_missing_deadline_generates_confirm_plan_and_risk(self):
        task = TaskItem(
            inbox_item_id="inbox-1",
            title="Prepare application",
            description="Prepare materials",
            deadline=None,
            deadline_confidence="low",
            deliverables=[],
            submit_method=None,
            priority="medium",
            source_quote="Prepare application materials",
        )

        plans = generate_plan(task, today=date(2026, 6, 16))
        risks = check_risks(task, plans, today=date(2026, 6, 16))

        self.assertEqual(plans[0].type, "confirm")
        self.assertTrue(any(risk.risk_type == "missing_deadline" for risk in risks))
        self.assertTrue(any(risk.risk_type == "missing_submit_method" for risk in risks))


class ExportTests(unittest.TestCase):
    def test_exports_markdown_and_calendar_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            task = TaskItem(
                inbox_item_id="inbox-1",
                title="Submit course project",
                description="Submit files",
                deadline="2026-06-30 23:59",
                deadline_confidence="high",
                deliverables=["README.md"],
                submit_method="GitHub",
                priority="high",
                source_quote="Submit files",
            )
            plans = generate_plan(task, today=date(2026, 6, 16))
            risks = check_risks(task, plans, today=date(2026, 6, 16))

            todo_path = export_todo_markdown([task], root / "todo.md")
            plan_path = export_plan_markdown([task], plans, risks, root / "plan.md")
            summary_path = export_summary_markdown([task], plans, risks, root / "summary.md")
            ics_path = export_calendar_ics(plans, root / "calendar.ics")

            self.assertIn("Submit course project", todo_path.read_text(encoding="utf-8"))
            self.assertIn("风险", plan_path.read_text(encoding="utf-8"))
            self.assertIn("任务总数：1", summary_path.read_text(encoding="utf-8"))
            self.assertIn("BEGIN:VCALENDAR", ics_path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
