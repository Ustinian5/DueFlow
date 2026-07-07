# Changelog

All notable DueFlow changes should be documented here.

This project follows a pragmatic pre-1.0 process: entries are grouped by the date or milestone they are prepared for, and public release tags should copy the relevant section into GitHub Releases.

## Unreleased

### Added

- Tauri desktop shell with main workbench and transparent always-on-top pet overlay.
- Desktop pet file-drop intake, bubble feedback, main-window navigation and Inbox highlighting.
- Local desktop API with confirmation-first intake, overview, pet state, exports, self-check, about, diagnostics, database backup and restore.
- System notification bridge for deadline warnings and selected desktop notices.
- Local pet runtime with action queueing, cancellation, cooldown, retry classification and user-tunable policies.
- Manifest-first local pet appearance registry with license confirmation, managed import, thumbnail preview, staging and rollback.
- Read-only local skill manifest registry with permission validation and non-executable action listing.
- Desktop release scripts, preflight checks, release manifest generation and isolated desktop smoke tests.
- GitHub-ready documentation: README, contribution guide, security policy, release checklist, issue templates and CI.

### Changed

- README now presents the desktop app as the primary product surface while keeping CLI, Streamlit and webhook paths available for development and demos.
- OpenPets usage is documented as architecture reference only, with no runtime dependency or copied assets.

### Security

- Diagnostics omit raw Inbox text, task titles, source quotes and extracted descriptions.
- `.gitignore` excludes local secrets, databases, Inbox files, backups, diagnostics, build outputs, release artifacts and the `reference/` directory.

## 0.1.0

Initial local DDL automation prototype:

- Unified Inbox, deduplication and SQLite persistence.
- Text, Markdown, PDF and webhook intake.
- Mock and OpenAI-compatible LLM provider abstraction.
- Task extraction, reverse planning, risk checks and Markdown/ICS exports.
- Streamlit workbench and command-line demo.
- Python test suite and MIT license.
