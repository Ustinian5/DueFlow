# DueFlow 设计文档

## 1. 项目定位

DueFlow 是一个个人 DDL 信息自动化平台。它面向学生、实习生和普通个人用户，将课程通知、邮件正文、PDF、Markdown、群公告和 Webhook 推送等非结构化信息统一收入 Inbox，再自动抽取任务、截止时间、提交物、风险点，并生成倒排计划和日历文件。

项目不是通用聊天机器人，而是一个有明确工作流的 Agent 系统：

```text
收集信息 → 理解信息 → 提取任务 → 规划日程 → 检查风险 → 导出结果
```

当前版本聚焦 DDL 和任务规划场景，最终效果是一个可本地运行、可展示、可复现的个人自动化平台。

## 2. 设计目标

1. 实用：解决真实 DDL 遗漏、通知整理和任务拆解问题。
2. 平台化：支持多源输入、统一 Inbox、自动处理流水线和导出。
3. 可展示：通过网页展示输入、抽取、计划、风险和导出结果。
4. 可复现：示例数据、mock 模式、环境配置和启动命令完整。
5. 可验证：所有关键结论保留原文依据，降低大模型幻觉风险。
6. 可扩展：模型、输入源、导出器均通过统一接口扩展。

## 3. 核心用户流程

```text
用户输入通知或文件
  ↓
系统创建 InboxItem
  ↓
解析文本并计算内容哈希
  ↓
检测重复内容
  ↓
调用 LLM 抽取任务和 DDL
  ↓
写入 TaskItem
  ↓
日程规划 Agent 生成 PlanItem
  ↓
风险检查 Agent 生成 RiskItem
  ↓
用户在控制台查看
  ↓
导出 todo.md / plan.md / summary.md / calendar.ics
```

## 4. 功能范围

### 4.1 P0：必须完成

P0 是课程项目的核心交付，必须保证可运行、可展示、可复现。

- Streamlit 控制台
- 手动粘贴文本
- 上传 `.txt`、`.md`、`.pdf`
- 扫描本地 `inbox/` 文件夹
- FastAPI Webhook 接入
- SQLite 本地数据库
- 内容去重
- LLM 结构化抽取
- mock 模式
- 倒排计划生成
- 风险提醒
- 导出 `todo.md`
- 导出 `plan.md`
- 导出 `calendar.ics`
- 示例数据和 README 复现说明

### 4.2 P1：高完成度增强

P1 用于提高使用体验和提交完整度。

- 按今天、本周、全部、风险任务筛选
- 多模型配置和切换
- 任务状态更新
- 导出任务总结 Markdown
- README 转 PDF
- 基础测试覆盖

### 4.3 P2：可选扩展

P2 不影响课程项目主交付。

- IMAP 邮箱读取
- 邮件附件解析
- OCR 截图识别
- Google Calendar / Outlook 写入
- 飞书、钉钉、企业微信接入
- 长期记忆和个人偏好
- 移动端提醒

## 5. 模块设计

### 5.1 输入模块

输入模块负责将不同来源转换为统一的 `InboxItem`。

来源类型：

- `manual`：用户手动粘贴
- `upload`：网页上传文件
- `folder`：本地 `inbox/` 扫描
- `webhook`：外部系统推送
- `email`：IMAP 邮箱读取

P0 实现 `manual`、`upload`、`folder`、`webhook`。P2 实现 `email`。

### 5.2 内容解析模块

内容解析模块只负责把输入转换为纯文本，不做任务理解。

- `.txt`：直接读取
- `.md`：直接读取 Markdown 源文本
- `.pdf`：优先使用 `pdfplumber`，失败时使用 `pypdf`
- Webhook：读取 JSON 字段 `title`、`content`、`source`
- 邮件：读取标题、正文、发件人和时间

解析失败时，InboxItem 状态设为 `failed`，并记录错误信息。

### 5.3 去重模块

系统对清洗后的文本计算 SHA-256 哈希。

规则：

- 哈希完全相同：标记为重复，不重复抽取。
- 标题不同但正文相同：仍视为重复。
- 重复项保留在 Inbox 中，但不生成新的 TaskItem。

### 5.4 LLM Provider

`LLMProvider` 提供统一接口：

```text
generate_json(system_prompt, user_prompt, schema_name) -> dict
```

支持 provider：

- `mock`
- `deepseek`
- `kimi`
- `zhipu`
- `qwen`

默认必须支持 `mock`，保证没有 API Key 也能完成演示。真实模型只要求配置一个即可运行。

### 5.5 结构化抽取 Agent

抽取 Agent 将原文转换为 TaskItem。

输出字段：

- `title`
- `description`
- `deadline`
- `deadline_confidence`
- `deliverables`
- `submit_method`
- `location`
- `priority`
- `source_quote`
- `missing_info`

硬性规则：

1. 模型必须只输出 JSON。
2. 不允许编造截止时间。
3. 模糊时间必须标记为 `deadline_confidence: low`。
4. 每个任务必须带 `source_quote`。
5. 原文没有的信息必须放入 `missing_info`。

### 5.6 日程规划 Agent

规划 Agent 根据任务和当前日期生成倒排计划。

输入：

- 当前日期
- TaskItem
- 已有 PlanItem
- 用户默认工作节奏

输出：

- milestone
- todo
- review
- final_check
- submit

规划规则：

- 截止日前至少安排一次最终检查。
- 多提交物任务必须拆成多个步骤。
- DDL 少于 3 天时标记为紧急。
- 没有明确 DDL 的任务不生成具体日期，只生成待确认事项。

### 5.7 风险检查 Agent

风险检查 Agent 输出 RiskItem。

风险类型：

- `deadline_too_close`
- `missing_deadline`
- `missing_submit_method`
- `missing_deliverable`
- `schedule_conflict`
- `missing_final_check`
- `external_dependency`

每条风险必须包含：

- 风险描述
- 触发原因
- 建议动作
- 严重程度

### 5.8 导出模块

导出模块负责把数据库中的任务和计划转换为文件。

P0 导出：

- `exports/todo.md`
- `exports/plan.md`
- `exports/calendar.ics`

P1 导出：

- `exports/summary.md`
- `exports/submission_report.md`
- `README.pdf`

## 6. 数据模型

### 6.1 InboxItem

```json
{
  "id": "string",
  "source_type": "manual | upload | folder | webhook | email",
  "title": "string",
  "content": "string",
  "content_hash": "string",
  "received_at": "datetime",
  "status": "pending | processed | duplicate | failed",
  "error_message": "string | null"
}
```

### 6.2 TaskItem

```json
{
  "id": "string",
  "inbox_item_id": "string",
  "title": "string",
  "description": "string",
  "deadline": "datetime | null",
  "deadline_confidence": "high | medium | low",
  "deliverables": ["string"],
  "submit_method": "string | null",
  "location": "string | null",
  "priority": "high | medium | low",
  "source_quote": "string",
  "missing_info": ["string"],
  "status": "todo | doing | done | archived",
  "created_at": "datetime"
}
```

### 6.3 PlanItem

```json
{
  "id": "string",
  "task_id": "string",
  "date": "date | null",
  "title": "string",
  "description": "string",
  "type": "milestone | todo | review | final_check | submit | confirm",
  "status": "todo | done"
}
```

### 6.4 RiskItem

```json
{
  "id": "string",
  "task_id": "string",
  "risk_type": "string",
  "severity": "high | medium | low",
  "message": "string",
  "suggestion": "string",
  "created_at": "datetime"
}
```

### 6.5 ExportRecord

```json
{
  "id": "string",
  "export_type": "todo_md | plan_md | calendar_ics | summary_md | pdf",
  "file_path": "string",
  "created_at": "datetime"
}
```

## 7. 页面设计

Streamlit 控制台包含五个页面或标签：

1. Inbox：新增文本、上传文件、扫描文件夹、查看处理状态。
2. Tasks：查看任务、DDL、提交物、原文依据和状态。
3. Plan：查看倒排计划，按今天、本周、全部筛选。
4. Risks：查看风险提醒和建议动作。
5. Exports：生成并下载 Markdown 和 ICS 文件。

页面重点是可展示，不做复杂视觉效果。

## 8. 错误处理

必须处理以下情况：

- API Key 未配置：自动切换或提示使用 mock 模式。
- LLM 返回非 JSON：重试一次，失败后记录错误。
- PDF 无法解析：标记失败并提示换文本输入。
- Webhook 参数缺失：返回 400。
- 重复内容：标记 duplicate，不重复生成任务。
- 没有明确 DDL：生成待确认任务，不编造日期。

## 9. 测试要求

至少覆盖：

- 文本哈希和去重
- `.txt` / `.md` 解析
- mock LLM 抽取
- JSON 输出校验
- 倒排计划生成
- 风险规则
- Markdown 导出
- ICS 导出

推荐命令：

```bash
pytest
streamlit run app.py
uvicorn api.webhook:app --reload
```

## 10. 演示方案

演示输入：

- 机器学习导论课程期末项目说明
- 比赛报名通知
- 实习面试邮件样例
- PDF 课程公告

演示流程：

1. 在 Streamlit 中粘贴课程项目说明。
2. 系统生成 InboxItem。
3. 抽取任务、DDL、提交物和原文依据。
4. 生成倒排计划。
5. 发现 README PDF、GitHub 开源、API Key 配置等风险。
6. 上传 PDF 通知并重复处理。
7. 扫描 `inbox/` 文件夹。
8. 使用 Webhook 推送一条通知。
9. 导出 `todo.md`、`plan.md`、`summary.md`、`calendar.ics`、`submission_report.md`。

## 11. 课程评分匹配

- 大模型 API：通过 `LLMProvider` 调用至少一个真实模型。
- Agent 应用：抽取 Agent、规划 Agent、风险检查 Agent 形成完整流水线。
- 实用性：解决学生和个人用户真实 DDL 管理痛点。
- 可展示：Streamlit 页面能完整演示自动化过程。
- 可复现：mock 模式、示例数据、启动命令和测试齐全。
- 开源友好：目录结构清晰，无需账号系统和云服务即可运行。

## 12. 最终交付清单

- GitHub 或 Hugging Face 开源仓库
- 完整源码
- `README.md`
- `README.pdf`
- `.env.example`
- `requirements.txt`
- 示例输入文件
- 示例导出文件
- 截图或演示说明
- 测试命令和结果说明

## 13. 明确不做

当前版本不做：

- 用户账号系统
- 多人协作
- 自动读取微信或 QQ
- 移动端 App
- 真实推送通知
- 直接写入 Google Calendar 或 Outlook
- 复杂工作流编排

这些功能会显著增加开发和演示风险，不纳入本课程项目主线。
