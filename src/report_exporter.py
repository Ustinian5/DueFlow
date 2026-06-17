from __future__ import annotations

from pathlib import Path

from .models import PlanItem, RiskItem, TaskItem


def export_todo_markdown(tasks: list[TaskItem], path: str | Path) -> Path:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    lines = ["# DueFlow Todo", ""]
    for task in tasks:
        deadline = task.deadline or "待确认"
        deliverables = "、".join(task.deliverables) if task.deliverables else "待确认"
        lines.extend(
            [
                f"## {task.title}",
                "",
                f"- 截止时间：{deadline}",
                f"- 优先级：{task.priority}",
                f"- 提交方式：{task.submit_method or '待确认'}",
                f"- 提交物：{deliverables}",
                f"- 状态：{task.status}",
                f"- 原文依据：{task.source_quote}",
                "",
            ]
        )
    target.write_text("\n".join(lines), encoding="utf-8")
    return target


def export_plan_markdown(tasks: list[TaskItem], plans: list[PlanItem], risks: list[RiskItem], path: str | Path) -> Path:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    task_map = {task.id: task for task in tasks}
    lines = ["# DueFlow Plan", ""]
    for task in tasks:
        lines.extend([f"## {task.title}", "", f"- 截止时间：{task.deadline or '待确认'}", ""])
        task_plans = [plan for plan in plans if plan.task_id == task.id]
        if task_plans:
            lines.append("### 计划")
            for plan in task_plans:
                lines.append(f"- [{plan.date or '待确认'}] {plan.title}：{plan.description}")
            lines.append("")
        task_risks = [risk for risk in risks if risk.task_id == task.id]
        lines.append("### 风险")
        if task_risks:
            for risk in task_risks:
                lines.append(f"- {risk.severity.upper()} / {risk.risk_type}：{risk.message} 建议：{risk.suggestion}")
        else:
            lines.append("- 暂无风险")
        lines.append("")

    orphan_risks = [risk for risk in risks if risk.task_id not in task_map]
    if orphan_risks:
        lines.extend(["## 未关联风险", ""])
        for risk in orphan_risks:
            lines.append(f"- {risk.message} 建议：{risk.suggestion}")
    target.write_text("\n".join(lines), encoding="utf-8")
    return target


def export_summary_markdown(tasks: list[TaskItem], plans: list[PlanItem], risks: list[RiskItem], path: str | Path) -> Path:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    done_count = sum(1 for task in tasks if task.status == "done")
    high_risks = [risk for risk in risks if risk.severity == "high"]
    dated_plans = [plan for plan in plans if plan.date]
    lines = [
        "# DueFlow Summary",
        "",
        f"- 任务总数：{len(tasks)}",
        f"- 已完成任务：{done_count}",
        f"- 计划项总数：{len(plans)}",
        f"- 已排期计划项：{len(dated_plans)}",
        f"- 风险总数：{len(risks)}",
        f"- 高风险数量：{len(high_risks)}",
        "",
        "## 任务概览",
        "",
    ]
    for task in tasks:
        lines.append(f"- {task.title}：{task.status}，截止时间 {task.deadline or '待确认'}")
    lines.extend(["", "## 风险概览", ""])
    if risks:
        for risk in risks:
            lines.append(f"- {risk.severity.upper()} / {risk.risk_type}：{risk.message}")
    else:
        lines.append("- 暂无风险")
    target.write_text("\n".join(lines), encoding="utf-8")
    return target


def export_submission_report(output_path: str | Path, project_name: str, verification: dict[str, str]) -> Path:
    target = Path(output_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        f"# {project_name} 课程提交报告",
        "",
        "## 项目简介",
        "",
        f"{project_name} 是一个个人 DDL 信息自动化平台，支持多源输入、LLM 结构化抽取、倒排计划、风险检查和文件导出。",
        "",
        "## 核心功能",
        "",
        "- 统一 Inbox：手动输入、文件上传、本地文件夹扫描、Webhook。",
        "- Agent 流水线：任务抽取、日程规划、风险检查。",
        "- 可复现导出：todo.md、plan.md、summary.md、calendar.ics、README.pdf。",
        "- 本地运行：SQLite 持久化，mock 模式无需 API Key。",
        "",
        "## 验证结果",
        "",
    ]
    for key, value in verification.items():
        lines.append(f"- {key}: {value}")
    lines.extend(
        [
            "",
            "## 课程要求对应",
            "",
            "- 调用大模型 API：通过 OpenAI-compatible Provider 支持真实模型。",
            "- Agent 应用：抽取、规划、风险检查形成完整自动化流水线。",
            "- 实用性：解决课程、比赛、实习等通知中的 DDL 整理问题。",
            "- 可展示：Streamlit 控制台和导出文件可直接演示。",
            "- 可复现：提供 conda 环境、测试、示例数据和 mock 模式。",
        ]
    )
    target.write_text("\n".join(lines), encoding="utf-8")
    return target
