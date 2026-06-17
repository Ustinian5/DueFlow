from __future__ import annotations

from pathlib import Path

from .models import PlanItem


def export_calendar_ics(plans: list[PlanItem], path: str | Path) -> Path:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//DueFlow//DDL Planner//CN",
        "CALSCALE:GREGORIAN",
    ]
    for plan in plans:
        if not plan.date:
            continue
        event_date = plan.date.replace("-", "")
        lines.extend(
            [
                "BEGIN:VEVENT",
                f"UID:{plan.id}@dueflow.local",
                f"DTSTAMP:{event_date}T000000Z",
                f"DTSTART;VALUE=DATE:{event_date}",
                f"SUMMARY:{_escape(plan.title)}",
                f"DESCRIPTION:{_escape(plan.description)}",
                "END:VEVENT",
            ]
        )
    lines.append("END:VCALENDAR")
    target.write_text("\r\n".join(lines), encoding="utf-8")
    return target


def _escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace(",", "\\,").replace(";", "\\;").replace("\n", "\\n")
