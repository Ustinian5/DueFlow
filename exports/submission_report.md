# DueFlow 课程提交报告

## 项目简介

DueFlow 是一个个人 DDL 信息自动化平台，支持多源输入、LLM 结构化抽取、倒排计划、风险检查和文件导出。

## 核心功能

- 统一 Inbox：手动输入、文件上传、本地文件夹扫描、Webhook。
- Agent 流水线：任务抽取、日程规划、风险检查。
- 可复现导出：todo.md、plan.md、summary.md、calendar.ics、README.pdf。
- 本地运行：SQLite 持久化，mock 模式无需 API Key。

## 验证结果

- demo: processed=3 tasks=3 plans=17 risks=5
- exports: todo.md, plan.md, summary.md, calendar.ics

## 课程要求对应

- 调用大模型 API：通过 OpenAI-compatible Provider 支持真实模型。
- Agent 应用：抽取、规划、风险检查形成完整自动化流水线。
- 实用性：解决课程、比赛、实习等通知中的 DDL 整理问题。
- 可展示：Streamlit 控制台和导出文件可直接演示。
- 可复现：提供 conda 环境、测试、示例数据和 mock 模式。