import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from api.desktop import create_app
from src.database import SCHEMA_VERSION, Database


class DesktopApiTests(unittest.TestCase):
    def test_desktop_api_cors_is_limited_to_local_app_origins(self):
        with tempfile.TemporaryDirectory() as tmp:
            client = TestClient(create_app(Path(tmp) / "dueflow.db"))

            allowed = client.options(
                "/desktop/health",
                headers={
                    "Origin": "http://127.0.0.1:5173",
                    "Access-Control-Request-Method": "GET",
                },
            )
            self.assertEqual(allowed.status_code, 200)
            self.assertEqual(allowed.headers.get("access-control-allow-origin"), "http://127.0.0.1:5173")

            disallowed = client.options(
                "/desktop/health",
                headers={
                    "Origin": "https://example.com",
                    "Access-Control-Request-Method": "GET",
                },
            )
            self.assertEqual(disallowed.status_code, 400)
            self.assertIsNone(disallowed.headers.get("access-control-allow-origin"))

    def test_desktop_api_reports_and_enforces_intake_size_limits(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch.dict(
                "os.environ",
                {
                    "DUEFLOW_MAX_TEXT_CHARS": "16",
                    "DUEFLOW_MAX_UPLOAD_BYTES": "8",
                },
                clear=False,
            ):
                client = TestClient(create_app(Path(tmp) / "dueflow.db"))

                config = client.get("/desktop/config")
                self.assertEqual(config.status_code, 200)
                self.assertEqual(config.json()["limits"]["max_text_chars"], 16)
                self.assertEqual(config.json()["limits"]["max_upload_bytes"], 8)

                text = client.post(
                    "/desktop/intake/text",
                    json={"title": "过长文本", "content": "0123456789abcdefg", "auto_extract": False},
                )
                self.assertEqual(text.status_code, 413)
                self.assertIn("text intake is too large", text.json()["detail"])

                upload = client.post(
                    "/desktop/intake/file",
                    files={"file": ("notice.md", b"012345678", "text/markdown")},
                )
                self.assertEqual(upload.status_code, 413)
                self.assertIn("uploaded file is too large", upload.json()["detail"])

    def test_file_intake_extracts_supported_upload_and_rejects_unsupported_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            client = TestClient(create_app(Path(tmp) / "dueflow.db"))

            upload = client.post(
                "/desktop/intake/file",
                files={
                    "file": (
                        "notice.md",
                        "代码开源在 GitHub，编写 README.md 并转换成 PDF 提交，截止时间 2026-06-30 23:59。",
                        "text/markdown",
                    )
                },
            )
            self.assertEqual(upload.status_code, 200)
            payload = upload.json()
            self.assertEqual(payload["inbox_item"]["source_type"], "upload")
            self.assertEqual(payload["inbox_item"]["title"], "notice.md")
            self.assertFalse(payload["requires_confirmation"])
            self.assertEqual(len(payload["extracted_tasks"]), 1)
            self.assertEqual(payload["inbox_item"]["status"], "processed")
            self.assertEqual(len(client.get("/desktop/overview").json()["tasks"]), 1)

            unsupported = client.post(
                "/desktop/intake/file",
                files={"file": ("notice.docx", b"not supported", "application/octet-stream")},
            )
            self.assertEqual(unsupported.status_code, 400)
            self.assertIn("unsupported file type", unsupported.json()["detail"])

    def test_image_intake_uses_ocr_then_persists_schedule(self):
        with tempfile.TemporaryDirectory() as tmp:
            client = TestClient(create_app(Path(tmp) / "dueflow.db"))

            with patch.dict(
                "os.environ",
                {"DUEFLOW_OCR_COMMAND": "printf '代码开源在 GitHub，编写 README.md 并转换成 PDF 提交，截止时间 2026-07-31 23:59。'"},
                clear=False,
            ):
                upload = client.post(
                    "/desktop/intake/file",
                    files={"file": ("screenshot.png", b"fake image content", "image/png")},
                )

            self.assertEqual(upload.status_code, 200)
            payload = upload.json()
            self.assertEqual(payload["inbox_item"]["source_type"], "upload")
            self.assertEqual(payload["inbox_item"]["title"], "screenshot.png")
            self.assertFalse(payload["requires_confirmation"])
            self.assertEqual(payload["extracted_tasks"][0]["deadline"], "2026-07-31 23:59")

    def test_text_intake_extracts_and_persists_schedule_without_confirmation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            app = create_app(root / "dueflow.db", root / "exports", root / "inbox")
            client = TestClient(app)

            health = client.get("/desktop/health")
            self.assertEqual(health.status_code, 200)
            self.assertEqual(health.json()["service"], "desktop")

            about = client.get("/desktop/about")
            self.assertEqual(about.status_code, 200)
            about_payload = about.json()
            self.assertEqual(about_payload["service"], "desktop")
            self.assertEqual(about_payload["schema_version"], SCHEMA_VERSION)
            self.assertEqual(about_payload["supported_schema_version"], SCHEMA_VERSION)
            self.assertEqual(about_payload["paths"]["database"], str(root / "dueflow.db"))
            self.assertTrue(about_payload["capabilities"]["database_backup"])
            self.assertTrue(about_payload["capabilities"]["database_restore"])
            self.assertTrue(about_payload["capabilities"]["diagnostics_export"])
            self.assertIn(".png", about_payload["capabilities"]["supported_file_types"])

            config = client.get("/desktop/config")
            self.assertEqual(config.status_code, 200)
            self.assertEqual(config.json()["database_path"], str(root / "dueflow.db"))
            self.assertEqual(config.json()["export_path"], str(root / "exports"))
            self.assertEqual(config.json()["inbox_path"], str(root / "inbox"))
            self.assertIn(config.json()["ocr_mode"], {"custom_command", "macos_vision", "unavailable"})
            self.assertIn(".png", config.json()["supported_file_types"])
            self.assertTrue((root / "exports").is_dir())
            self.assertTrue((root / "inbox").is_dir())

            self_check = client.get("/desktop/self-check")
            self.assertEqual(self_check.status_code, 200)
            self_check_payload = self_check.json()
            self.assertIn(self_check_payload["status"], {"ok", "warning"})
            self.assertEqual(self_check_payload["summary"]["error"], 0)
            check_ids = {check["id"] for check in self_check_payload["checks"]}
            self.assertIn("database_integrity", check_ids)
            self.assertIn("database_schema", check_ids)
            self.assertIn("inbox_directory", check_ids)
            self.assertIn("export_directory", check_ids)
            schema_check = next(check for check in self_check_payload["checks"] if check["id"] == "database_schema")
            self.assertIn(f"schema version {SCHEMA_VERSION}", schema_check["message"])
            self.assertFalse((root / "exports" / ".dueflow_write_test").exists())
            self.assertFalse((root / "inbox" / ".dueflow_write_test").exists())

            intake = client.post(
                "/desktop/intake/text",
                json={
                    "title": "课程项目通知",
                    "content": "代码开源在 GitHub，编写 README.md 并转换成 PDF 提交，截止时间 2026-06-30 23:59。",
                    "source_type": "clipboard",
                    "auto_extract": True,
                },
            )
            self.assertEqual(intake.status_code, 200)
            payload = intake.json()
            self.assertEqual(payload["inbox_item"]["status"], "processed")
            self.assertEqual(payload["inbox_item"]["source_type"], "clipboard")
            self.assertFalse(payload["requires_confirmation"])
            self.assertEqual(len(payload["extracted_tasks"]), 1)

            extracted_task = payload["extracted_tasks"][0]
            overview = client.get("/desktop/overview").json()
            self.assertEqual(len(overview["tasks"]), 1)
            self.assertEqual(overview["inbox"][0]["status"], "processed")
            self.assertTrue(any(plan["type"] == "submit" for plan in overview["plans"]))

            duplicate_confirm = client.post(
                "/desktop/tasks/confirm",
                json={"inbox_item_id": payload["inbox_item"]["id"], "tasks": [extracted_task]},
            )
            self.assertEqual(duplicate_confirm.status_code, 409)

    def test_duplicate_inbox_response_links_original_record(self):
        with tempfile.TemporaryDirectory() as tmp:
            client = TestClient(create_app(Path(tmp) / "dueflow.db"))
            content = "代码开源在 GitHub，编写 README.md 并转换成 PDF 提交，截止时间 2026-07-31 23:59。"

            first = client.post(
                "/desktop/intake/text",
                json={"title": "原始通知", "content": content, "auto_extract": False},
            )
            self.assertEqual(first.status_code, 200)
            first_id = first.json()["inbox_item"]["id"]

            duplicate = client.post(
                "/desktop/intake/text",
                json={"title": "重复通知", "content": f" {content} ", "auto_extract": True},
            )
            self.assertEqual(duplicate.status_code, 200)
            duplicate_payload = duplicate.json()
            self.assertEqual(duplicate_payload["inbox_item"]["status"], "duplicate")
            self.assertEqual(duplicate_payload["inbox_item"]["duplicate_of"]["id"], first_id)
            self.assertEqual(duplicate_payload["inbox_item"]["duplicate_of"]["title"], "原始通知")
            self.assertFalse(duplicate_payload["requires_confirmation"])

            overview = client.get("/desktop/overview").json()
            duplicate_row = next(item for item in overview["inbox"] if item["status"] == "duplicate")
            self.assertEqual(duplicate_row["duplicate_of"]["id"], first_id)

    def test_pending_inbox_item_can_be_extracted_later_then_auto_persisted(self):
        with tempfile.TemporaryDirectory() as tmp:
            client = TestClient(create_app(Path(tmp) / "dueflow.db"))

            intake = client.post(
                "/desktop/intake/text",
                json={
                    "title": "稍后处理",
                    "content": "代码开源在 GitHub，编写 README.md 并转换成 PDF 提交，截止时间 2026-07-31 23:59。",
                    "auto_extract": False,
                },
            )
            self.assertEqual(intake.status_code, 200)
            inbox_id = intake.json()["inbox_item"]["id"]
            self.assertFalse(intake.json()["requires_confirmation"])

            extracted = client.post(f"/desktop/inbox/{inbox_id}/extract")
            self.assertEqual(extracted.status_code, 200)
            extracted_payload = extracted.json()
            self.assertFalse(extracted_payload["requires_confirmation"])
            self.assertEqual(len(extracted_payload["extracted_tasks"]), 1)
            self.assertIn("pet_state", extracted_payload)

            overview = client.get("/desktop/overview").json()
            self.assertEqual(len(overview["tasks"]), 1)
            self.assertEqual(overview["inbox"][0]["status"], "processed")

            processed_extract = client.post(f"/desktop/inbox/{inbox_id}/extract")
            self.assertEqual(processed_extract.status_code, 409)

    def test_failed_inbox_item_can_be_retried(self):
        with tempfile.TemporaryDirectory() as tmp:
            database_path = Path(tmp) / "dueflow.db"
            client = TestClient(create_app(database_path))

            intake = client.post(
                "/desktop/intake/text",
                json={
                    "title": "重试处理",
                    "content": "代码开源在 GitHub，编写 README.md 并转换成 PDF 提交，截止时间 2026-07-31 23:59。",
                    "auto_extract": False,
                },
            )
            self.assertEqual(intake.status_code, 200)
            inbox_id = intake.json()["inbox_item"]["id"]

            database = Database(database_path)
            database.update_inbox_status(inbox_id, "failed", "temporary extraction failure")

            retried = client.post(f"/desktop/inbox/{inbox_id}/extract")
            self.assertEqual(retried.status_code, 200)
            retried_payload = retried.json()
            self.assertFalse(retried_payload["requires_confirmation"])
            self.assertEqual(len(retried_payload["extracted_tasks"]), 1)
            overview = client.get("/desktop/overview").json()
            self.assertEqual(overview["inbox"][0]["status"], "processed")
            self.assertIsNone(overview["inbox"][0]["error_message"])

    def test_pet_state_reports_missing_info_for_incomplete_tasks(self):
        with tempfile.TemporaryDirectory() as tmp:
            client = TestClient(create_app(Path(tmp) / "dueflow.db"))

            intake = client.post(
                "/desktop/intake/text",
                json={
                    "title": "模糊通知",
                    "content": "请尽快准备申请材料，提交方式后续通知。",
                    "auto_extract": False,
                },
            )
            self.assertEqual(intake.status_code, 200)
            self.assertEqual(client.get("/desktop/pet/state").json()["state"], "processing")

            inbox_id = intake.json()["inbox_item"]["id"]
            confirm = client.post(
                "/desktop/tasks/confirm",
                json={
                    "inbox_item_id": inbox_id,
                    "tasks": [
                        {
                            "title": "准备申请材料",
                            "description": "准备申请材料，提交方式不明确。",
                            "deadline": None,
                            "deadline_confidence": "low",
                            "deliverables": [],
                            "submit_method": None,
                            "priority": "medium",
                            "source_quote": "请尽快准备申请材料",
                            "missing_info": ["截止时间", "提交物", "提交方式"],
                        }
                    ],
                },
            )
            self.assertEqual(confirm.status_code, 200)
            self.assertEqual(confirm.json()["pet_state"]["state"], "deadline_near")
            self.assertEqual(confirm.json()["pet_state"]["severity"], "high")

    def test_task_status_update_validates_status_and_refreshes_pet_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            client = TestClient(create_app(Path(tmp) / "dueflow.db"))

            intake = client.post(
                "/desktop/intake/text",
                json={
                    "title": "课程通知",
                    "content": "请在 2026-06-30 23:59 前提交 README PDF。",
                    "auto_extract": True,
                },
            ).json()
            task = client.get("/desktop/overview").json()["tasks"][0]

            bad = client.patch(f"/desktop/tasks/{task['id']}/status", json={"status": "unknown"})
            self.assertEqual(bad.status_code, 400)

            done = client.patch(f"/desktop/tasks/{task['id']}/status", json={"status": "done"})
            self.assertEqual(done.status_code, 200)
            self.assertEqual(done.json()["task"]["status"], "done")
            self.assertIn("pet_state", done.json())

    def test_task_update_replans_and_rechecks_risks(self):
        with tempfile.TemporaryDirectory() as tmp:
            client = TestClient(create_app(Path(tmp) / "dueflow.db"))

            intake = client.post(
                "/desktop/intake/text",
                json={
                    "title": "课程通知",
                    "content": "请在 2026-06-30 23:59 前提交 README PDF。",
                    "auto_extract": True,
                },
            ).json()
            task = client.get("/desktop/overview").json()["tasks"][0]

            updated = client.put(
                f"/desktop/tasks/{task['id']}",
                json={
                    "title": "更新后的课程项目",
                    "description": "补充展示海报和演示视频。",
                    "deadline": "2026-08-31 23:59",
                    "deadline_confidence": "high",
                    "deliverables": ["展示海报 PDF", "演示视频"],
                    "submit_method": "课程平台提交",
                    "location": "课程平台",
                    "priority": "high",
                    "source_quote": "请在 2026-08-31 23:59 前提交展示海报 PDF 和演示视频",
                    "missing_info": [],
                    "status": "doing",
                },
            )
            self.assertEqual(updated.status_code, 200)
            payload = updated.json()
            self.assertEqual(payload["task"]["title"], "更新后的课程项目")
            self.assertEqual(payload["task"]["status"], "doing")
            self.assertTrue(any(plan["type"] == "final_check" for plan in payload["plans"]))
            self.assertFalse(any(risk["risk_type"] == "missing_deliverable" for risk in payload["risks"]))

            overview = client.get("/desktop/overview").json()
            self.assertEqual(len([plan for plan in overview["plans"] if plan["task_id"] == task["id"]]), len(payload["plans"]))

            bad = client.put(
                f"/desktop/tasks/{task['id']}",
                json={**payload["task"], "status": "invalid"},
            )
            self.assertEqual(bad.status_code, 400)

    def test_exports_generate_downloadable_files_and_reject_unknown_types(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            client = TestClient(create_app(root / "dueflow.db", root / "exports"))

            client.post(
                "/desktop/intake/text",
                json={
                    "title": "课程通知",
                    "content": "请在 2026-07-31 23:59 前提交 README PDF。",
                    "auto_extract": True,
                },
            )

            for export_type, file_name in {
                "todo": "todo.md",
                "plan": "plan.md",
                "summary": "summary.md",
                "calendar": "calendar.ics",
            }.items():
                response = client.post(f"/desktop/exports/{export_type}")
                self.assertEqual(response.status_code, 200)
                payload = response.json()
                self.assertEqual(payload["file_name"], file_name)
                self.assertTrue(Path(payload["file_path"]).exists())

                download = client.get(payload["download_url"])
                self.assertEqual(download.status_code, 200)
                self.assertTrue(download.content)

            bad = client.post("/desktop/exports/unknown")
            self.assertEqual(bad.status_code, 400)

    def test_database_backup_creates_downloadable_sqlite_snapshot(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            client = TestClient(create_app(root / "dueflow.db", root / "exports", root / "inbox"))

            intake = client.post(
                "/desktop/intake/text",
                json={
                    "title": "备份前通知",
                    "content": "请在 2026-07-31 23:59 前提交 README PDF。",
                    "auto_extract": False,
                },
            )
            self.assertEqual(intake.status_code, 200)

            response = client.post("/desktop/database/backup")
            self.assertEqual(response.status_code, 200)
            payload = response.json()
            backup_path = Path(payload["file_path"])
            self.assertEqual(payload["kind"], "sqlite_backup")
            self.assertTrue(payload["file_name"].startswith("dueflow-backup-"))
            self.assertTrue(payload["file_name"].endswith(".db"))
            self.assertEqual(payload["download_url"], f"/desktop/database/backups/{payload['file_name']}")
            self.assertTrue(backup_path.exists())
            self.assertGreater(payload["bytes"], 0)

            download = client.get(payload["download_url"])
            self.assertEqual(download.status_code, 200)
            self.assertTrue(download.content)

            with sqlite3.connect(backup_path) as conn:
                inbox_count = conn.execute("SELECT COUNT(*) FROM inbox_items").fetchone()[0]
                integrity = conn.execute("PRAGMA quick_check").fetchone()[0]
            self.assertEqual(inbox_count, 1)
            self.assertEqual(integrity, "ok")

            second = client.post("/desktop/database/backup")
            self.assertEqual(second.status_code, 200)
            self.assertNotEqual(second.json()["file_name"], payload["file_name"])
            ignored = root / "exports" / "backups" / "manual-copy.sqlite"
            ignored.write_text("not listed", encoding="utf-8")
            backup_list = client.get("/desktop/database/backups")
            self.assertEqual(backup_list.status_code, 200)
            listed_names = [item["file_name"] for item in backup_list.json()["backups"]]
            self.assertIn(payload["file_name"], listed_names)
            self.assertIn(second.json()["file_name"], listed_names)
            self.assertNotIn("manual-copy.sqlite", listed_names)

            traversal = client.get("/desktop/database/backups/../dueflow.db")
            self.assertEqual(traversal.status_code, 404)

    def test_diagnostics_report_exports_safe_support_summary(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            client = TestClient(create_app(root / "dueflow.db", root / "exports", root / "inbox"))

            intake = client.post(
                "/desktop/intake/text",
                json={
                    "title": "敏感课程通知",
                    "content": "这里包含不应出现在诊断报告里的原始 DDL 内容。",
                    "auto_extract": False,
                },
            )
            self.assertEqual(intake.status_code, 200)
            backup = client.post("/desktop/database/backup")
            self.assertEqual(backup.status_code, 200)

            diagnostics = client.get("/desktop/diagnostics")
            self.assertEqual(diagnostics.status_code, 200)
            payload = diagnostics.json()
            self.assertIn("generated_at", payload)
            self.assertEqual(payload["about"]["schema_version"], SCHEMA_VERSION)
            self.assertEqual(payload["counts"]["inbox"]["total"], 1)
            self.assertEqual(payload["counts"]["inbox"]["pending"], 1)
            self.assertEqual(payload["latest_backups"][0]["file_name"], backup.json()["file_name"])
            serialized = json.dumps(payload, ensure_ascii=False)
            self.assertNotIn("敏感课程通知", serialized)
            self.assertNotIn("原始 DDL 内容", serialized)

            exported = client.post("/desktop/diagnostics/export")
            self.assertEqual(exported.status_code, 200)
            exported_payload = exported.json()
            self.assertEqual(exported_payload["kind"], "diagnostics_json")
            self.assertTrue(exported_payload["file_name"].startswith("dueflow-diagnostics-"))
            self.assertTrue(Path(exported_payload["file_path"]).exists())
            download = client.get(exported_payload["download_url"])
            self.assertEqual(download.status_code, 200)
            downloaded_payload = json.loads(download.content.decode("utf-8"))
            self.assertEqual(downloaded_payload["counts"]["inbox"]["total"], 1)

    def test_diagnostics_export_prunes_old_dueflow_reports_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            client = TestClient(create_app(root / "dueflow.db", root / "exports", root / "inbox"))
            diagnostics_dir = root / "exports" / "diagnostics"
            diagnostics_dir.mkdir(parents=True, exist_ok=True)
            manual_file = diagnostics_dir / "manual-notes.json"
            manual_file.write_text("keep", encoding="utf-8")

            created_names = []
            for _ in range(12):
                response = client.post("/desktop/diagnostics/export")
                self.assertEqual(response.status_code, 200)
                created_names.append(response.json()["file_name"])

            dueflow_reports = sorted(path.name for path in diagnostics_dir.glob("dueflow-diagnostics-*.json"))
            self.assertEqual(len(dueflow_reports), 10)
            self.assertTrue(manual_file.exists())
            self.assertNotIn(created_names[0], dueflow_reports)
            self.assertIn(created_names[-1], dueflow_reports)

    def test_database_restore_validates_backup_and_creates_safety_snapshot(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            client = TestClient(create_app(root / "dueflow.db", root / "exports", root / "inbox"))

            first = client.post(
                "/desktop/intake/text",
                json={
                    "title": "恢复前数据",
                    "content": "请在 2026-07-31 23:59 前提交 README PDF。",
                    "auto_extract": False,
                },
            )
            self.assertEqual(first.status_code, 200)

            backup = client.post("/desktop/database/backup")
            self.assertEqual(backup.status_code, 200)
            backup_name = backup.json()["file_name"]

            second = client.post(
                "/desktop/intake/text",
                json={
                    "title": "应被恢复移除的数据",
                    "content": "请在 2026-08-31 23:59 前提交演示视频。",
                    "auto_extract": False,
                },
            )
            self.assertEqual(second.status_code, 200)
            self.assertEqual(len(client.get("/desktop/overview").json()["inbox"]), 2)

            missing_confirm = client.post("/desktop/database/restore", json={"file_name": backup_name, "confirm": ""})
            self.assertEqual(missing_confirm.status_code, 400)

            restored = client.post("/desktop/database/restore", json={"file_name": backup_name, "confirm": "RESTORE"})
            self.assertEqual(restored.status_code, 200)
            restored_payload = restored.json()
            self.assertEqual(restored_payload["status"], "restored")
            self.assertEqual(restored_payload["restored_from"]["file_name"], backup_name)
            self.assertTrue(Path(restored_payload["safety_backup"]["file_path"]).exists())
            self.assertIn("pre-restore", restored_payload["safety_backup"]["file_name"])

            overview = client.get("/desktop/overview").json()
            self.assertEqual(len(overview["inbox"]), 1)
            self.assertEqual(overview["inbox"][0]["title"], "恢复前数据")
            self.assertEqual(client.get("/desktop/self-check").json()["summary"]["error"], 0)

            listed_names = [item["file_name"] for item in client.get("/desktop/database/backups").json()["backups"]]
            self.assertIn(restored_payload["safety_backup"]["file_name"], listed_names)

    def test_database_restore_rejects_backup_with_mismatched_schema_version(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            client = TestClient(create_app(root / "dueflow.db", root / "exports", root / "inbox"))
            backup = client.post("/desktop/database/backup")
            self.assertEqual(backup.status_code, 200)
            backup_path = Path(backup.json()["file_path"])
            with sqlite3.connect(backup_path) as conn:
                conn.execute("PRAGMA user_version = 999")

            restored = client.post(
                "/desktop/database/restore",
                json={"file_name": backup.json()["file_name"], "confirm": "RESTORE"},
            )
            self.assertEqual(restored.status_code, 400)
            self.assertIn("schema version", restored.json()["detail"])


if __name__ == "__main__":
    unittest.main()
