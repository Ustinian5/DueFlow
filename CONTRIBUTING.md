# Contributing to DueFlow

Thanks for considering a contribution. DueFlow is a local-first desktop assistant, so changes should preserve user data safety, explicit confirmation before task creation, and clear runtime boundaries between the Python API, Tauri shell and React frontend.

## Development Setup

Python:

```bash
conda env create -f environment.yml
conda activate dueflow
```

Desktop:

```bash
cd desktop
npm install
```

Rust/Tauri:

```bash
rustup update stable
```

Linux systems may need GTK/WebKit packages for Tauri checks. The GitHub Actions workflow lists the current package set.

## Verification Gates

Run the relevant subset while developing, and run the full set before opening a pull request:

```bash
python -m pytest

cd desktop
npm run build
npm run test:runtime
npm run test:smoke
npm run test:preflight
npm run test:release-manifest

cd src-tauri
cargo fmt --check
cargo check
cargo test
```

`python -m pytest` also runs open-source hygiene checks for required repository files, `.gitignore` privacy coverage, declared upload dependencies, CI gate coverage and the OpenPets reference-only boundary.

## Project Boundaries

- Do not commit `.env`, API keys, local databases, Inbox files, diagnostics containing private data, or packaged release artifacts.
- Do not add OpenPets as a dependency, copy OpenPets source, or reuse OpenPets assets. It is only an architectural reference.
- Keep model output behind explicit user confirmation before creating committed tasks.
- Keep local skill manifests declarative and non-executable unless a future permission model explicitly supports execution.
- Keep local pet appearance imports manifest-first, bounded to the app data pet directory, and rollback-safe.

## Pull Request Expectations

- Explain the user-facing behavior change.
- Note any schema, API or release-process changes.
- Add or update tests for behavior that can regress.
- Update docs when commands, setup steps, data paths or desktop behavior change.
- Keep unrelated refactors out of feature or bug-fix pull requests.

## Commit Hygiene

Generated outputs may be useful as examples, but avoid committing local runtime artifacts:

- `.env`
- `*.db`, `*.db-shm`, `*.db-wal`
- `inbox/`
- `desktop/dist/`
- `desktop/release/`
- `desktop/src-tauri/target/`
- `desktop/node_modules/`

## Release Changes

If a change affects packaging or local readiness, update:

- `docs/desktop_release.md`
- `desktop/scripts/run-preflight.mjs`
- `desktop/scripts/run-desktop-smoke.mjs`
- `desktop/scripts/write-release-manifest.mjs`

Release packaging should remain reproducible without private signing credentials. Signing, notarization and DMG publishing require project-owned credentials and should be documented separately from the local development path.
