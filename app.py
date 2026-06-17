from __future__ import annotations

import tempfile
from pathlib import Path

import streamlit as st

from src.calendar_exporter import export_calendar_ics
from src.config import load_settings
from src.database import Database
from src.inbox import InboxService
from src.llm_provider import get_llm_provider
from src.pipeline import process_pending_inbox
from src.report_exporter import export_plan_markdown, export_summary_markdown, export_todo_markdown


@st.cache_resource
def get_services() -> tuple[Database, InboxService]:
    settings = load_settings()
    database = Database(settings.database_path)
    database.initialize()
    return database, InboxService(database)


def main() -> None:
    st.set_page_config(page_title="DueFlow", page_icon="⏱", layout="wide")
    settings = load_settings()
    database, inbox_service = get_services()

    st.title("DueFlow")
    st.caption("个人 DDL 信息自动化平台")

    inbox_items = database.list_inbox_items()
    tasks_snapshot = database.list_tasks()
    plans_snapshot = database.list_plan_items()
    risks_snapshot = database.list_risks()
    metric_cols = st.columns(5)
    metric_cols[0].metric("Inbox", len(inbox_items))
    metric_cols[1].metric("任务", len(tasks_snapshot))
    metric_cols[2].metric("计划项", len(plans_snapshot))
    metric_cols[3].metric("风险", len(risks_snapshot))
    metric_cols[4].metric("高风险", sum(1 for risk in risks_snapshot if risk.severity == "high"))

    inbox_tab, tasks_tab, plan_tab, risks_tab, exports_tab = st.tabs(["Inbox", "Tasks", "Plan", "Risks", "Exports"])

    with inbox_tab:
        st.subheader("新增信息")
        title = st.text_input("标题", value="课程通知")
        content = st.text_area("通知内容", height=180)
        col_a, col_b = st.columns(2)
        with col_a:
            if st.button("加入 Inbox", use_container_width=True):
                if content.strip():
                    item = inbox_service.add_manual(title, content)
                    st.success(f"已加入 Inbox：{item.status}")
                else:
                    st.warning("请输入通知内容。")
        with col_b:
            if st.button("扫描本地 inbox/", use_container_width=True):
                items = inbox_service.scan_folder(settings.inbox_path)
                st.success(f"扫描完成，新增记录 {len(items)} 条。")

        uploaded = st.file_uploader("上传 .txt / .md / .pdf", type=["txt", "md", "pdf"])
        if uploaded and st.button("处理上传文件"):
            suffix = Path(uploaded.name).suffix.lower()
            if suffix in {".txt", ".md"}:
                text = uploaded.getvalue().decode("utf-8", errors="ignore")
                item = inbox_service.add_text("upload", uploaded.name, text)
            else:
                with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                    tmp.write(uploaded.getvalue())
                    tmp_path = Path(tmp.name)
                item = inbox_service.add_file(tmp_path, source_type="upload")
                tmp_path.unlink(missing_ok=True)
            st.success(f"上传已加入 Inbox：{item.status}")

        st.divider()
        if st.button("处理 pending Inbox", type="primary"):
            provider = get_llm_provider(settings)
            result = process_pending_inbox(database, provider)
            st.success(f"处理完成：{result}")

        st.subheader("Inbox 记录")
        st.dataframe([item.__dict__ for item in database.list_inbox_items()], use_container_width=True)

    with tasks_tab:
        st.subheader("任务")
        tasks = database.list_tasks()
        if tasks:
            task_names = {task.id: task.title for task in tasks}
            selected_task_id = st.selectbox("选择任务", [task.id for task in tasks], format_func=lambda item_id: task_names[item_id])
            selected_status = st.selectbox("更新状态", ["todo", "doing", "done", "archived"])
            if st.button("保存任务状态"):
                database.update_task_status(selected_task_id, selected_status)
                st.success("任务状态已更新。")
                st.rerun()
            st.divider()
            for task in tasks[:8]:
                with st.container(border=True):
                    left, right = st.columns([3, 1])
                    left.markdown(f"### {task.title}")
                    left.caption(task.description or task.source_quote)
                    left.write(f"**截止时间**：{task.deadline or '待确认'}")
                    left.write(f"**提交物**：{'、'.join(task.deliverables) if task.deliverables else '待确认'}")
                    right.metric("优先级", task.priority)
                    right.metric("状态", task.status)
                    right.write(f"置信度：{task.deadline_confidence}")
        st.dataframe([task.__dict__ for task in database.list_tasks()], use_container_width=True)

    with plan_tab:
        st.subheader("计划")
        plans = database.list_plan_items()
        risks = database.list_risks()
        risk_task_ids = {risk.task_id for risk in risks}
        view = st.segmented_control("视图", ["全部", "今天", "本周", "风险任务"], default="全部")
        filtered_plans = _filter_plans(plans, view, risk_task_ids)
        for plan in filtered_plans[:10]:
            with st.container(border=True):
                st.markdown(f"**{plan.get('date') or '待确认'} · {plan.get('title')}**")
                st.caption(f"{plan.get('type')} / {plan.get('status')}")
                st.write(plan.get("description"))
        st.dataframe(filtered_plans, use_container_width=True)

    with risks_tab:
        st.subheader("风险")
        risks = database.list_risks()
        for risk in risks[:10]:
            with st.container(border=True):
                st.markdown(f"**{risk.severity.upper()} · {risk.risk_type}**")
                st.write(risk.message)
                st.caption(f"建议：{risk.suggestion}")
        st.dataframe([risk.__dict__ for risk in risks], use_container_width=True)

    with exports_tab:
        st.subheader("导出")
        export_dir = Path(settings.export_path)
        tasks = database.list_tasks()
        plans = database.list_plan_items()
        risks = database.list_risks()
        c1, c2, c3, c4 = st.columns(4)
        with c1:
            if st.button("导出 todo.md", use_container_width=True):
                path = export_todo_markdown(tasks, export_dir / "todo.md")
                database.insert_export_record("todo_md", str(path))
                st.success(str(path))
        with c2:
            if st.button("导出 plan.md", use_container_width=True):
                path = export_plan_markdown(tasks, plans, risks, export_dir / "plan.md")
                database.insert_export_record("plan_md", str(path))
                st.success(str(path))
        with c3:
            if st.button("导出 calendar.ics", use_container_width=True):
                path = export_calendar_ics(plans, export_dir / "calendar.ics")
                database.insert_export_record("calendar_ics", str(path))
                st.success(str(path))
        with c4:
            if st.button("导出 summary.md", use_container_width=True):
                path = export_summary_markdown(tasks, plans, risks, export_dir / "summary.md")
                database.insert_export_record("summary_md", str(path))
                st.success(str(path))
        st.dataframe([record.__dict__ for record in database.list_export_records()], use_container_width=True)


def _filter_plans(plans, view: str, risk_task_ids=None):
    from datetime import date, timedelta

    risk_task_ids = risk_task_ids or set()
    today = date.today()
    rows = []
    for plan in plans:
        if view == "风险任务" and plan.task_id not in risk_task_ids:
            continue
        if view == "今天" and plan.date != today.isoformat():
            continue
        if view == "本周" and plan.date:
            plan_date = date.fromisoformat(plan.date)
            if not (today <= plan_date <= today + timedelta(days=7)):
                continue
        rows.append(plan.__dict__)
    return rows


if __name__ == "__main__":
    main()
