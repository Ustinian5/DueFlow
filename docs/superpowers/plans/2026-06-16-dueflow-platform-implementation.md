# DueFlow Platform Implementation Plan Archive

This document archives the first implementation plan for DueFlow. It is kept as historical context only. The current product direction is the desktop-first assistant described in [README.md](../../../README.md), [docs/desktop_pet_product_plan.md](../../desktop_pet_product_plan.md), [docs/desktop_api.md](../../desktop_api.md), and [docs/desktop_release.md](../../desktop_release.md).

## Original Scope

The initial implementation focused on a local personal automation platform that:

- ingests notices into a unified Inbox;
- extracts DDL tasks with a mock or OpenAI-compatible LLM provider;
- generates reverse plans and risk checks;
- exports Markdown and calendar files;
- exposes Streamlit and webhook surfaces for demonstration.

That foundation remains in the codebase, but it is no longer the whole product surface.

## Current Direction

DueFlow has moved to a desktop-first architecture:

- Python core and FastAPI desktop API;
- Tauri 2 desktop shell;
- React workbench;
- transparent always-on-top desktop pet overlay;
- local pet appearance manifests;
- declarative local skill manifests;
- backup, restore, diagnostics and release tooling;
- OpenPets used only as an architecture reference.

## Verification Sources

Use the maintained verification gates instead of this archive:

- `python -m pytest`
- `cd desktop && npm run build`
- `cd desktop && npm run test:runtime`
- `cd desktop && npm run test:smoke`
- `cd desktop && npm run test:preflight`
- `cd desktop && npm run test:release-manifest`
- `cd desktop/src-tauri && cargo fmt --check`
- `cd desktop/src-tauri && cargo check`
- `cd desktop/src-tauri && cargo test`

Release readiness is tracked in [docs/release_checklist.md](../../release_checklist.md).
