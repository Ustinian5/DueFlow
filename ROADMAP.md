# Roadmap

This roadmap explains the intended direction for DueFlow without over-promising dates. The project is local-first, desktop-oriented and confirmation-first.

## Current Focus

- Keep the Tauri desktop workbench and pet overlay stable for local use.
- Maintain reliable release gates for Python, React, Tauri, smoke tests and open-source hygiene.
- Keep OpenPets as reference material only, not as a runtime dependency.
- Preserve local user data safety through backup, restore, diagnostics privacy and explicit confirmation before task creation.

## Near-Term Improvements

- Add a real Tauri window-level smoke workflow that can run on a developer machine with visible UI.
- Improve screenshot capture ergonomics beyond file drag-and-drop, including a native shortcut flow.
- Add sample local pet appearance packages for testing and documentation, using original DueFlow-owned assets only.
- Expand documentation for real model provider setup and OCR command examples.
- Add richer diagnostics around failed OCR, model-provider errors and desktop backend autostart failures.

## Later Ideas

- Calendar provider integrations after local ICS export remains stable.
- Optional WebSocket or event-stream updates from the desktop API to reduce polling.
- A stricter local plugin model if DueFlow ever supports executable third-party skills.
- Cross-platform signed installers after macOS local packaging, signing and notarization are stable.
- More task views such as week calendar, workload heatmap and deadline clustering.

## Non-Goals For Now

- Hosted multi-user service.
- Cloud sync.
- Account system.
- Automatic reading of private messaging apps.
- Importing or depending on OpenPets code, assets, plugins or build chain.
