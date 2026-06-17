from __future__ import annotations

from datetime import date
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.calendar_exporter import export_calendar_ics
from src.database import Database
from src.inbox import InboxService
from src.llm_provider import MockLLMProvider
from src.pipeline import process_pending_inbox
from src.report_exporter import export_plan_markdown, export_submission_report, export_summary_markdown, export_todo_markdown


def main() -> None:
    root = ROOT
    db_path = root / "dueflow_demo.db"
    export_dir = root / "exports"
    if db_path.exists():
        db_path.unlink()

    database = Database(db_path)
    database.initialize()
    inbox = InboxService(database)

    for example in sorted((root / "examples").glob("*.*")):
        inbox.add_file(example, source_type="folder")

    result = process_pending_inbox(database, MockLLMProvider(), today=date(2026, 6, 16))
    tasks = database.list_tasks()
    plans = database.list_plan_items()
    risks = database.list_risks()

    todo_path = export_todo_markdown(tasks, export_dir / "todo.md")
    plan_path = export_plan_markdown(tasks, plans, risks, export_dir / "plan.md")
    summary_path = export_summary_markdown(tasks, plans, risks, export_dir / "summary.md")
    calendar_path = export_calendar_ics(plans, export_dir / "calendar.ics")
    report_path = export_submission_report(
        export_dir / "submission_report.md",
        "DueFlow",
        {
            "demo": f"processed={result['processed']} tasks={len(tasks)} plans={len(plans)} risks={len(risks)}",
            "exports": "todo.md, plan.md, summary.md, calendar.ics",
        },
    )

    print("DueFlow demo completed")
    print(f"processed={result['processed']} tasks={len(tasks)} plans={len(plans)} risks={len(risks)}")
    print(f"todo={todo_path}")
    print(f"plan={plan_path}")
    print(f"summary={summary_path}")
    print(f"calendar={calendar_path}")
    print(f"submission_report={report_path}")


if __name__ == "__main__":
    main()
