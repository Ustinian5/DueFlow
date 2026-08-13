# Changelog

All notable DueFlow changes should be documented here.

This project follows a pragmatic pre-1.0 process: entries are grouped by the date or milestone they are prepared for, and public release tags should copy the relevant section into GitHub Releases.

## [Unreleased]

No changes yet.

## [0.1.4] - 2026-08-13

### Fixed

- The standalone backend is now injected before a final ad-hoc app-bundle seal, fixing the invalid resource envelope produced when v0.1.3 modified the Tauri bundle after signing.
- Backend support files now live under `Contents/Resources/.dueflow-backend`, with a compatibility symlink at `Contents/Frameworks` for the PyInstaller launcher.

### Distribution

- Packaging now runs strict `codesign --verify --deep --strict` validation before archiving, and CI verifies the extracted archive again on both native macOS architectures.
- v0.1.4 remains an unsigned, unnotarized developer preview; its manifest explicitly records the verified ad-hoc seal and backend runtime layout.

## [0.1.3] - 2026-08-13

### Fixed

- Plain semantic-version tags now publish as the repository's latest GitHub release, while suffixed tags such as `v0.1.3-rc.1` remain prereleases.
- Re-running a tagged publisher now reconciles the release title, latest flag, and prerelease flag instead of only replacing assets.

### Distribution

- v0.1.3 keeps the verified native Apple Silicon and Intel self-contained bundles. They remain unsigned and unnotarized developer builds with explicit checksums, manifests, bundled-backend self-checks, and preflight evidence.

## [0.1.2] - 2026-08-13

### Added

- GitHub Actions now builds and verifies native self-contained macOS previews on both Apple Silicon (`arm64`) and Intel (`x86_64`) runners.
- Tagged `v*` builds publish both app archives, architecture-specific checksums, and manifests only after Python, desktop, Rust, preflight, sidecar, and digest gates pass.

### Changed

- Release archives now use stable `DueFlow-Desktop_<version>_<arch>.app.zip` names while retaining the UTC build time inside each manifest, enabling durable direct-download links from the README and project site.
- English and Simplified Chinese project surfaces now expose separate Apple Silicon and Intel download paths.
- GitHub Actions dependencies use their Node 24-compatible major releases, and the desktop dependency lock passes the high-severity npm audit gate.

### Distribution

- v0.1.2 is an unsigned, unnotarized developer preview. Both native architecture bundles include the loopback-only backend and require neither Python nor Conda at runtime.

## [0.1.1] - 2026-08-13

### Fixed

- Git-aware hygiene checks now skip with an explicit reason when Git metadata is absent, so GitHub source archives run the applicable test suite instead of failing on `git ls-files`.

## [0.1.0] - 2026-08-13

DueFlow's first public source release establishes the local-first deadline workflow, desktop companion, and reproducible development gates.

### Added

- Unified Inbox, deduplication, and SQLite persistence.
- Text, Markdown, PDF, OCR-ready image, file-drop, and webhook intake.
- Mock and OpenAI-compatible LLM provider abstraction.
- Task extraction, reverse planning, risk checks, reminders, and Markdown/ICS exports.
- Streamlit workbench and deterministic command-line demo.
- Tauri desktop shell with main workbench and transparent always-on-top pet overlay.
- Desktop pet file-drop intake, bubble feedback, main-window navigation and Inbox highlighting.
- Local desktop API with confirmation-first intake, overview, pet state, exports, self-check, about, diagnostics, database backup and restore.
- System notification bridge for deadline warnings and selected desktop notices.
- Local pet runtime with action queueing, cancellation, cooldown, retry classification and user-tunable policies.
- Manifest-first local pet appearance registry with license confirmation, managed import, thumbnail preview, staging and rollback.
- Read-only local skill manifest registry with permission validation and non-executable action listing.
- Desktop release scripts, preflight checks, release manifest generation and isolated desktop smoke tests.
- GitHub-ready documentation: README, contribution guide, security policy, release checklist, issue templates and CI.
- Python, React/TypeScript, and Rust test gates in GitHub Actions.

### Changed

- README now presents the desktop app as the primary product surface while keeping CLI, Streamlit and webhook paths available for development and demos.
- OpenPets usage is documented as architecture reference only, with no runtime dependency or copied assets.

### Security

- Diagnostics omit raw Inbox text, task titles, source quotes and extracted descriptions.
- `.gitignore` excludes local secrets, databases, Inbox files, backups, diagnostics, build outputs, release artifacts and the `reference/` directory.

### Distribution

- This tag is a source release; GitHub provides the automatically generated source archives.
- The repository documents an unsigned local macOS `.app` packaging path for development and review.
- Public macOS binary distribution remains gated on Developer ID signing, notarization, and stapling.

[Unreleased]: https://github.com/Ustinian5/DueFlow/compare/v0.1.4...HEAD
[0.1.4]: https://github.com/Ustinian5/DueFlow/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/Ustinian5/DueFlow/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Ustinian5/DueFlow/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Ustinian5/DueFlow/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Ustinian5/DueFlow/releases/tag/v0.1.0
