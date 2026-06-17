# DueFlow 演示说明

## 演示目标

展示 DueFlow 如何把课程通知、比赛公告、实习邮件等非结构化信息自动转成任务、DDL、倒排计划、风险提醒和导出文件。

## 演示前准备

```bash
conda activate dueflow
python -m pytest
python scripts\run_demo.py
python -m streamlit run app.py
python -m uvicorn api.webhook:app --reload
```

本机固定环境可使用：

```bash
D:\conda_envs\dueflow\python.exe -m pytest
D:\conda_envs\dueflow\python.exe scripts\run_demo.py
D:\conda_envs\dueflow\python.exe -m streamlit run app.py
D:\conda_envs\dueflow\python.exe -m uvicorn api.webhook:app --reload
```

## 演示流程

1. 打开 Streamlit 控制台，展示顶部指标区：Inbox、任务、计划项、风险、高风险。
2. 在 Inbox 中粘贴 `examples/course_project_notice.md` 的内容。
3. 点击“处理 pending Inbox”，展示自动抽取出的课程项目任务。
4. 切到 Tasks 页面，展示任务卡片、截止时间、提交物、优先级、状态更新。
5. 切到 Plan 页面，展示全部计划、本周计划和风险任务筛选。
6. 切到 Risks 页面，展示风险卡片和建议动作。
7. 切到 Exports 页面，导出 `todo.md`、`plan.md`、`summary.md`、`calendar.ics`。
8. 用 Webhook 模拟外部通知：

```bash
curl -X POST "http://127.0.0.1:8000/webhook/inbox?process=true" ^
  -H "Content-Type: application/json" ^
  -d "{\"title\":\"课程通知\",\"content\":\"请在 2026-06-30 23:59 前提交 README PDF。\"}"
```

9. 展示 `exports/submission_report.md` 和 `README.pdf`，说明项目可复现。

## 建议截图

- `docs/images/01-dashboard.png`：Streamlit 顶部指标和 Inbox。
- `docs/images/02-tasks.png`：任务卡片和状态更新。
- `docs/images/03-plan-risk.png`：计划卡片和风险任务筛选。
- `docs/images/04-exports.png`：导出结果和文件列表。

## 评分点对应

- 大模型 API：`LLMProvider` 支持 OpenAI-compatible API，mock 模式保证无 Key 可复现。
- Agent：抽取 Agent、规划 Agent、风险检查 Agent 串成自动化流水线。
- 实用性：解决课程、比赛、实习邮件中的 DDL 管理问题。
- 可展示：Streamlit 控制台、Webhook、导出文件均可现场展示。
- 可复现：conda 环境、测试、示例数据、README PDF、提交报告齐全。
