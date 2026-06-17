# DueFlow Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build DueFlow as a local personal automation platform that ingests notices, extracts DDL tasks with an LLM, generates plans and risks, and exports Markdown and ICS files.

**Architecture:** The system uses Streamlit as the main console, SQLite as local persistence, FastAPI for Webhook ingestion, and a small Python core under `src/`. The core is split into focused modules for config, database, parsing, inbox management, LLM calls, extraction, planning, risk checking, and exporting.

**Tech Stack:** Python, Streamlit, FastAPI, SQLite, OpenAI-compatible LLM APIs, pdfplumber or pypdf, ics, python-dotenv, pytest.

---

## File Structure

- Create: `requirements.txt` for Python dependencies.
- Create: `.env.example` for API and app configuration.
- Create: `app.py` for the Streamlit console.
- Create: `api/webhook.py` for Webhook ingestion.
- Create: `src/config.py` for environment loading.
- Create: `src/database.py` for SQLite setup and repositories.
- Create: `src/models.py` for dataclasses and validation helpers.
- Create: `src/parsers.py` for text, Markdown and PDF parsing.
- Create: `src/inbox.py` for Inbox creation, scanning and deduplication.
- Create: `src/llm_provider.py` for mock and real model calls.
- Create: `src/extractors.py` for structured task extraction.
- Create: `src/planner.py` for reverse schedule generation.
- Create: `src/risk_checker.py` for deterministic risk rules.
- Create: `src/calendar_exporter.py` for `.ics` output.
- Create: `src/report_exporter.py` for Markdown exports.
- Create: `examples/course_project_notice.md` for the main demo.
- Create: `examples/email_sample.txt` for email-like input.
- Create: `examples/competition_notice.md` for a second DDL scenario.
- Create: `tests/` with focused unit tests for every core module.

## Task 1: Project Skeleton

**Files:**
- Create: `requirements.txt`
- Create: `.env.example`
- Create: `src/__init__.py`
- Create: `api/__init__.py`
- Create: `examples/`
- Create: `inbox/`
- Create: `exports/`

- [ ] Create the directory structure.
- [ ] Add dependencies: `streamlit`, `fastapi`, `uvicorn`, `python-dotenv`, `openai`, `pdfplumber`, `pypdf`, `ics`, `pytest`.
- [ ] Add `.env.example` with `LLM_PROVIDER=mock`, `LLM_API_KEY=`, `LLM_BASE_URL=`, `LLM_MODEL=`, `DATABASE_PATH=dueflow.db`.
- [ ] Run `python -m pytest` and confirm the empty test run does not fail because of import errors.
- [ ] Commit with message `chore: initialize project structure`.

## Task 2: Data Models and Database

**Files:**
- Create: `src/models.py`
- Create: `src/database.py`
- Create: `tests/test_database.py`

- [ ] Define `InboxItem`, `TaskItem`, `PlanItem`, `RiskItem`, and `ExportRecord` as dataclasses.
- [ ] Create SQLite tables for inbox items, tasks, plan items, risks and export records.
- [ ] Implement repository functions for insert, list, update status and lookup by content hash.
- [ ] Write tests that insert one inbox item, one task, one plan item and one risk.
- [ ] Run `pytest tests/test_database.py -v`; expected result: all tests pass.
- [ ] Commit with message `feat: add sqlite data layer`.

## Task 3: Parsers and Inbox

**Files:**
- Create: `src/parsers.py`
- Create: `src/inbox.py`
- Create: `tests/test_parsers.py`
- Create: `tests/test_inbox.py`

- [ ] Implement `.txt` and `.md` parsing by reading UTF-8 text.
- [ ] Implement `.pdf` parsing with `pdfplumber`, then fallback to `pypdf`.
- [ ] Implement content normalization and SHA-256 hashing.
- [ ] Implement manual text ingestion.
- [ ] Implement file upload ingestion.
- [ ] Implement local `inbox/` folder scan.
- [ ] Write tests for text parsing, Markdown parsing, hashing and duplicate detection.
- [ ] Run `pytest tests/test_parsers.py tests/test_inbox.py -v`; expected result: all tests pass.
- [ ] Commit with message `feat: add inbox ingestion and parsers`.

## Task 4: LLM Provider

**Files:**
- Create: `src/config.py`
- Create: `src/llm_provider.py`
- Create: `tests/test_llm_provider.py`

- [ ] Load configuration from `.env`.
- [ ] Implement `MockLLMProvider` with deterministic JSON for the course project example.
- [ ] Implement `OpenAICompatibleProvider` using base URL, API key and model from config.
- [ ] Implement `get_llm_provider()` that returns mock when `LLM_PROVIDER=mock`.
- [ ] Write tests proving mock mode returns valid JSON with a task title, deadline and source quote.
- [ ] Run `pytest tests/test_llm_provider.py -v`; expected result: all tests pass.
- [ ] Commit with message `feat: add llm provider abstraction`.

## Task 5: Structured Extraction

**Files:**
- Create: `src/extractors.py`
- Create: `tests/test_extractors.py`

- [ ] Define the extraction prompt requiring strict JSON output.
- [ ] Parse and validate LLM output into `TaskItem`.
- [ ] Reject invented dates by allowing `deadline=None` and `deadline_confidence=low`.
- [ ] Preserve `source_quote`.
- [ ] Store extraction failure in the inbox item status.
- [ ] Write tests for successful extraction and missing-deadline extraction.
- [ ] Run `pytest tests/test_extractors.py -v`; expected result: all tests pass.
- [ ] Commit with message `feat: add ddl extraction agent`.

## Task 6: Planner and Risk Checker

**Files:**
- Create: `src/planner.py`
- Create: `src/risk_checker.py`
- Create: `tests/test_planner.py`
- Create: `tests/test_risk_checker.py`

- [ ] Implement reverse planning from deadline to today.
- [ ] Generate `milestone`, `todo`, `review`, `final_check`, and `submit` plan items.
- [ ] Generate `confirm` items when deadline is missing.
- [ ] Implement deterministic risk rules for missing deadline, close deadline, missing submit method, missing deliverables and missing final check.
- [ ] Write tests for a normal course-project task and a missing-deadline task.
- [ ] Run `pytest tests/test_planner.py tests/test_risk_checker.py -v`; expected result: all tests pass.
- [ ] Commit with message `feat: add planning and risk agents`.

## Task 7: Exporters

**Files:**
- Create: `src/report_exporter.py`
- Create: `src/calendar_exporter.py`
- Create: `tests/test_report_exporter.py`
- Create: `tests/test_calendar_exporter.py`

- [ ] Export tasks to `exports/todo.md`.
- [ ] Export plans and risks to `exports/plan.md`.
- [ ] Export dated plan items to `exports/calendar.ics`.
- [ ] Record generated files in `ExportRecord`.
- [ ] Write tests that assert exported files exist and contain expected task titles.
- [ ] Run `pytest tests/test_report_exporter.py tests/test_calendar_exporter.py -v`; expected result: all tests pass.
- [ ] Commit with message `feat: add markdown and calendar exports`.

## Task 8: Streamlit Console

**Files:**
- Create: `app.py`
- Modify: `src/inbox.py`
- Modify: `src/extractors.py`
- Modify: `src/planner.py`
- Modify: `src/risk_checker.py`
- Modify: `src/report_exporter.py`

- [ ] Build Inbox page with manual text input, file upload and folder scan button.
- [ ] Build Tasks page showing title, deadline, confidence, deliverables, status and source quote.
- [ ] Build Plan page showing today, this week and all plan items.
- [ ] Build Risks page showing severity, message and suggestion.
- [ ] Build Exports page with buttons for Markdown and ICS generation.
- [ ] Add a single "Process pending inbox" action that runs extraction, planning and risk checking.
- [ ] Run `streamlit run app.py`; expected result: the console starts without import errors.
- [ ] Commit with message `feat: add streamlit console`.

## Task 9: Webhook API

**Files:**
- Create: `api/webhook.py`
- Create: `tests/test_webhook.py`

- [ ] Add `POST /webhook/inbox` accepting `title`, `content`, and optional `source`.
- [ ] Validate missing content and return HTTP 400.
- [ ] Insert valid payloads as `source_type=webhook`.
- [ ] Add `GET /health` returning `{"status": "ok"}`.
- [ ] Run `uvicorn api.webhook:app --reload`; expected result: the API starts.
- [ ] Run `pytest tests/test_webhook.py -v`; expected result: all tests pass.
- [ ] Commit with message `feat: add webhook ingestion`.

## Task 10: Examples, README and Final Verification

**Files:**
- Create: `examples/course_project_notice.md`
- Create: `examples/email_sample.txt`
- Create: `examples/competition_notice.md`
- Modify: `README.md`
- Modify: `docs/design.md`

- [ ] Add three realistic example inputs.
- [ ] Update README with setup, `.env`, mock mode, real model mode, Streamlit start, Webhook start, test command and demo flow.
- [ ] Run the full test suite with `pytest`; expected result: all tests pass.
- [ ] Run Streamlit and process `examples/course_project_notice.md`; expected result: task, plan, risk and exports are generated.
- [ ] Generate README PDF for submission.
- [ ] Commit with message `docs: finalize dueflow submission docs`.

## Acceptance Criteria

- The project runs locally with `LLM_PROVIDER=mock`.
- At least one real LLM provider can be configured through `.env`.
- Streamlit can demonstrate the full pipeline from input to export.
- Webhook can insert an Inbox item.
- `todo.md`, `plan.md`, and `calendar.ics` can be generated.
- Tests cover database, parsing, inbox, mock LLM, extraction, planning, risk checking and exports.
- README explains how to reproduce the demo.
