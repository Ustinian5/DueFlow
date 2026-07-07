# DueFlow Demo Guide

This guide shows the current pet-first DueFlow workflow: drag content to the desktop pet, extract DDL information, automatically generate the schedule, review the result and export local artifacts.

## Demo Goal

Show that DueFlow can turn course notices, competition announcements, internship emails, screenshots or files into editable schedule items, reverse plans, risk checks and exportable schedule files, with the desktop pet acting as the always-available intake surface.

## Preparation

Use the mock model provider for a reproducible demo without API keys:

```bash
conda activate dueflow
cp .env.example .env
python -m pytest
```

Install and verify the desktop shell:

```bash
cd desktop
npm install
npm run build
npm run test:runtime
npm run test:smoke
cd ..
```

Generate the CLI demo exports if you want static output files for the walkthrough:

```bash
python scripts/run_demo.py
python scripts/export_readme_pdf.py
```

## Desktop Demo

Start the local desktop API:

```bash
python -m uvicorn api.desktop:app --host 127.0.0.1 --port 8000
```

In a second terminal, start the Tauri shell:

```bash
cd desktop
npm run tauri:dev
```

Walkthrough:

1. Show the transparent always-on-top `pet` window and the independent schedule surface.
2. Drag `examples/course_project_notice.md`, a `.txt` file, a `.md` file, a PDF, or an image file onto the pet.
3. Show the pet bubble feedback and the generated schedule item.
4. Open the schedule surface and review or adjust the generated task.
5. Show Today, Week, Calendar, Risks and Inbox/source views in the schedule surface.
6. Mark a task done and verify the pet count/status updates.
7. Open Settings and run self-check.
8. Create a database backup.
9. Export diagnostics and confirm that raw Inbox text and task titles are not included.
10. If a local pet appearance package is available, import it, validate the manifest, switch to it, then roll back to the built-in appearance.

## Optional API And Webhook Demo

Run the webhook API:

```bash
python -m uvicorn api.webhook:app --host 127.0.0.1 --port 8000
```

Post a sample notice:

```bash
curl -X POST "http://127.0.0.1:8000/webhook/inbox?process=true" \
  -H "Content-Type: application/json" \
  -d '{"title":"课程通知","content":"请在 2026-06-30 23:59 前提交 README PDF。"}'
```

The webhook route is useful for demonstrating external intake, while the desktop API remains the primary local app interface.

## Optional Streamlit Console

The legacy Streamlit console can still demonstrate the core pipeline:

```bash
python -m streamlit run app.py
```

Use it to show Inbox, task, plan, risk and export data without launching the full desktop shell. The desktop app is the primary product surface.

## Static Artifacts To Show

- `exports/todo.md`
- `exports/plan.md`
- `exports/summary.md`
- `exports/calendar.ics`
- `exports/submission_report.md`
- `README.pdf`

These can be regenerated with `python scripts/run_demo.py` and `python scripts/export_readme_pdf.py`.

## Suggested Screenshots

- `docs/images/01-dashboard.png`: desktop workbench overview.
- `docs/images/02-pet-drop.png`: pet drag-and-drop intake and bubble feedback.
- `docs/images/03-tasks.png`: generated task cards, schedule display and status update.
- `docs/images/04-plan-risk.png`: plan timeline and risk filters.
- `docs/images/05-exports.png`: exports, self-check, backup or diagnostics.

## Talking Points

- Local-first: database, Inbox, exports, backups and diagnostics stay on the user's machine by default.
- Confirmation-first: model output must be reviewed before it becomes a committed task.
- Desktop interaction: the pet provides low-friction drag-and-drop intake and status feedback.
- OpenPets boundary: OpenPets is a reference only; DueFlow uses its own Tauri/Python/React implementation.
- Reproducibility: mock provider, conda environment, smoke tests, release checks, sample data and README PDF are included.
