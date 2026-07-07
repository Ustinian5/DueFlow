import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(scriptDir, "..");
const repoRoot = resolve(desktopDir, "..");
const tempRoot = await mkdtemp(join(tmpdir(), "dueflow-desktop-smoke-"));
const apiPort = await reservePort();
const apiBase = `http://127.0.0.1:${apiPort}`;
const smokeAssignmentText = "机器学习导论期末项目：请在2026-07-30 23:59前提交README PDF和GitHub代码，课程平台提交。";
let apiProcess = null;

try {
  validateTauriConfig();
  apiProcess = await startIsolatedApi();
  await waitForApi();
  await runApiSmoke();
  console.log("DueFlow desktop smoke passed.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  if (apiProcess) {
    apiProcess.kill("SIGTERM");
    await waitForExit(apiProcess, 2_000).catch(() => apiProcess.kill("SIGKILL"));
  }
  await rm(tempRoot, { recursive: true, force: true });
}

function validateTauriConfig() {
  const config = JSON.parse(readText(join(desktopDir, "src-tauri", "tauri.conf.json")));
  const capabilities = JSON.parse(readText(join(desktopDir, "src-tauri", "capabilities", "default.json")));
  assertEqual(config.productName, "DueFlow Desktop", "Tauri productName changed unexpectedly.");
  assertEqual(config.build?.beforeBuildCommand, "npm run build", "Tauri beforeBuildCommand must run frontend build.");
  assertEqual(config.build?.frontendDist, "../dist", "Tauri frontendDist must point to the Vite build output.");
  const csp = config.app?.security?.csp;
  assert(typeof csp === "string" && csp.includes("default-src 'self'"), "Tauri CSP must be explicit and self-scoped.");
  assert(csp.includes("object-src 'none'"), "Tauri CSP must disable plugin/object embedding.");
  assert(!csp.includes("'unsafe-eval'"), "Tauri CSP must not allow unsafe eval.");

  const windows = new Map((config.app?.windows ?? []).map((window) => [window.label, window]));
  const mainWindow = windows.get("main");
  const controlWindow = windows.get("control");
  const petWindow = windows.get("pet");
  assert(mainWindow, "Tauri main window is missing.");
  assert(controlWindow, "Tauri control window is missing.");
  assert(petWindow, "Tauri pet window is missing.");
  assert(mainWindow.width <= 520 && mainWindow.height <= 700, "Main schedule window should stay compact.");
  assertEqual(mainWindow.alwaysOnTop, true, "Main schedule window should behave like a lightweight desktop surface.");
  assertEqual(mainWindow.decorations, false, "Main schedule window should be frameless.");
  assertEqual(mainWindow.transparent, true, "Main schedule window should support translucent component styling.");
  assertEqual(mainWindow.skipTaskbar, true, "Main schedule window should behave like a drawer/widget surface.");
  assertEqual(controlWindow.url, "index.html?view=control", "Control center must use a separate window route.");
  assertEqual(controlWindow.visible, false, "Control center should not open until requested.");
  assertEqual(controlWindow.decorations, true, "Control center should behave like a normal utility window.");
  assertEqual(controlWindow.skipTaskbar, false, "Control center should be independently discoverable.");
  assertEqual(petWindow.url, "index.html?view=pet", "Pet window must load the pet overlay route.");
  assertEqual(petWindow.alwaysOnTop, true, "Pet window must remain visible as a desktop companion.");
  assertEqual(petWindow.decorations, false, "Pet window should be frameless.");
  assertEqual(petWindow.transparent, true, "Pet window should preserve transparent overlay rendering.");
  assertEqual(petWindow.skipTaskbar, true, "Pet window should stay out of the taskbar.");

  const allowedWindows = new Set(capabilities.windows ?? []);
  assert(allowedWindows.has("main") && allowedWindows.has("control") && allowedWindows.has("pet"), "Tauri capability must include main, control and pet windows.");
  const permissions = new Set(capabilities.permissions ?? []);
  for (const permission of ["core:default", "opener:default", "notification:default"]) {
    assert(permissions.has(permission), `Tauri default capability is missing ${permission}.`);
  }
}

async function startIsolatedApi() {
  const launcherPath = join(tempRoot, "dueflow_smoke_api.py");
  const databasePath = join(tempRoot, "dueflow-smoke.db");
  const inboxPath = join(tempRoot, "inbox");
  const exportPath = join(tempRoot, "exports");
  await writeFile(
    launcherPath,
    [
      "import uvicorn",
      "from api.desktop import create_app",
      `app = create_app(database_path=${JSON.stringify(databasePath)}, inbox_path=${JSON.stringify(inboxPath)}, export_path=${JSON.stringify(exportPath)})`,
      `uvicorn.run(app, host="127.0.0.1", port=${apiPort}, log_level="warning")`,
      "",
    ].join("\n"),
    "utf-8",
  );

  const python = resolvePythonCommand();
  const child = spawn(python, [launcherPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      LLM_PROVIDER: "mock",
      DATABASE_PATH: databasePath,
      INBOX_PATH: inboxPath,
      EXPORT_PATH: exportPath,
      PYTHONPATH: [repoRoot, process.env.PYTHONPATH].filter(Boolean).join(delimiter),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.once("error", (error) => {
    process.exitCode = 1;
    console.error(`DueFlow smoke could not start Python command ${python}: ${error.message}`);
  });
  child.stdout.on("data", (chunk) => process.stdout.write(`[smoke-api] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[smoke-api] ${chunk}`));
  child.once("exit", (code, signal) => {
    if (code !== null && code !== 0 && process.exitCode !== 1) {
      console.error(`DueFlow smoke API exited early with code ${code}.`);
    } else if (signal && signal !== "SIGTERM") {
      console.error(`DueFlow smoke API exited with signal ${signal}.`);
    }
  });
  return child;
}

function resolvePythonCommand() {
  const candidates = [
    process.env.DUEFLOW_SMOKE_PYTHON,
    process.env.PYTHON,
    "python3",
    "python",
  ].filter(Boolean);
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"], { encoding: "utf-8" });
    if (result.status === 0) return candidate;
  }
  throw new Error("DueFlow smoke could not find a Python interpreter. Set DUEFLOW_SMOKE_PYTHON or PYTHON.");
}

async function waitForApi() {
  const deadline = Date.now() + 15_000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const health = await fetchJson("/desktop/health");
      assertEqual(health.status, "ok", "Desktop API health status is not ok.");
      return;
    } catch (error) {
      lastError = error;
      await sleep(250);
    }
  }
  throw new Error(`Desktop smoke could not reach isolated API at ${apiBase}: ${lastError instanceof Error ? lastError.message : lastError}`);
}

async function runApiSmoke() {
  const about = await fetchJson("/desktop/about");
  assertEqual(about.service, "desktop", "Desktop about service mismatch.");
  assertEqual(about.schema_version, about.supported_schema_version, "Desktop API schema version mismatch.");
  assertEqual(about.capabilities?.database_backup, true, "Desktop API must report database backup capability.");
  assertEqual(about.capabilities?.database_restore, true, "Desktop API must report database restore capability.");
  assertEqual(about.capabilities?.diagnostics_export, true, "Desktop API must report diagnostics export capability.");
  assert(about.capabilities?.limits?.max_text_chars > 0, "Desktop API must report a positive text intake limit.");
  assert(about.capabilities?.limits?.max_upload_bytes > 0, "Desktop API must report a positive upload limit.");

  const config = await fetchJson("/desktop/config");
  assertEqual(config.limits?.max_text_chars, about.capabilities.limits.max_text_chars, "Config and about text intake limits should match.");
  assertEqual(config.limits?.max_upload_bytes, about.capabilities.limits.max_upload_bytes, "Config and about upload limits should match.");

  const selfCheck = await fetchJson("/desktop/self-check");
  assert(selfCheck.summary?.error === 0 && selfCheck.status !== "error", "Desktop self-check must not contain error items.");

  const initialOverview = await fetchJson("/desktop/overview");
  assertEqual(initialOverview.tasks.length, 0, "Smoke database should start empty.");

  const intake = await postFile(
    "/desktop/intake/file?auto_extract=true",
    "assignment.txt",
    smokeAssignmentText,
  );
  assert(intake.inbox_item?.id, "File intake must create an Inbox item.");
  assert(intake.extracted_tasks.length > 0, "Mock LLM should extract at least one task from the smoke assignment.");
  assertEqual(intake.requires_confirmation, false, "Extracted tasks should be persisted without a confirmation step.");
  assertEqual(intake.inbox_item.status, "processed", "Recognized DDL should mark the source Inbox item as processed.");

  const duplicate = await postFile(
    "/desktop/intake/file?auto_extract=true",
    "assignment-copy.txt",
    smokeAssignmentText,
  );
  assertEqual(duplicate.inbox_item.status, "duplicate", "Repeated file intake should be marked duplicate.");
  assert(duplicate.inbox_item.duplicate_of?.id === intake.inbox_item.id, "Duplicate Inbox item should reference the original item.");

  const overviewAfterConfirm = await fetchJson("/desktop/overview");
  assertEqual(overviewAfterConfirm.tasks.length, intake.extracted_tasks.length, "Overview should include automatically persisted tasks.");
  assert(overviewAfterConfirm.plans.length > 0, "Overview should include generated plans.");
  assert(["idle", "deadline_near", "missing_info", "overdue"].includes(overviewAfterConfirm.pet_state.state), "Pet state after automatic intake is unexpected.");

  const firstTaskId = overviewAfterConfirm.tasks[0].id;
  const statusUpdate = await patchJson(`/desktop/tasks/${firstTaskId}/status`, { status: "done" });
  assertEqual(statusUpdate.task.status, "done", "Task status update did not persist.");

  for (const exportType of ["todo", "plan", "summary", "calendar"]) {
    const exported = await postJson(`/desktop/exports/${exportType}`, {});
    assertEqual(exported.export_type, exportType, `Export ${exportType} returned the wrong type.`);
    assert(exported.download_url, `Export ${exportType} must include a download URL.`);
  }

  const backup = await postJson("/desktop/database/backup", {});
  assertEqual(backup.kind, "sqlite_backup", "Database backup kind mismatch.");
  assert(backup.bytes > 0, "Database backup must contain bytes.");
  const backups = await fetchJson("/desktop/database/backups");
  assert(backups.backups.some((item) => item.file_name === backup.file_name), "Created backup should appear in backup list.");

  const archivedUpdate = await patchJson(`/desktop/tasks/${firstTaskId}/status`, { status: "archived" });
  assertEqual(archivedUpdate.task.status, "archived", "Task archive mutation before restore did not persist.");
  const restore = await postJson("/desktop/database/restore", { file_name: backup.file_name, confirm: "RESTORE" });
  assertEqual(restore.status, "restored", "Database restore did not report restored status.");
  const restoredOverview = await fetchJson("/desktop/overview");
  const restoredTask = restoredOverview.tasks.find((task) => task.id === firstTaskId);
  assertEqual(restoredTask?.status, "done", "Database restore should recover the backed-up task status.");

  const diagnostics = await postJson("/desktop/diagnostics/export", {});
  assertEqual(diagnostics.kind, "diagnostics_json", "Diagnostics export kind mismatch.");
  assert(diagnostics.bytes > 0, "Diagnostics export must contain bytes.");
  const diagnosticsPayload = await fetchJson(diagnostics.download_url);
  const diagnosticsText = JSON.stringify(diagnosticsPayload);
  assert(!diagnosticsText.includes(smokeAssignmentText), "Diagnostics export must not include raw Inbox text.");
  assert(!diagnosticsText.includes(intake.extracted_tasks[0].title), "Diagnostics export must not include task titles.");
}

async function postFile(path, filename, text) {
  const formData = new FormData();
  formData.append("file", new Blob([text], { type: "text/plain" }), filename);
  return fetchJson(path, { method: "POST", body: formData });
}

function fetchJson(path, init = undefined) {
  return fetch(`${apiBase}${path}`, init).then(async (response) => {
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status} ${response.statusText} for ${path}: ${body}`);
    }
    return response.json();
  });
}

function postJson(path, body) {
  return fetchJson(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patchJson(path, body) {
  return fetchJson(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  await new Promise((resolvePromise, reject) => server.close((error) => (error ? reject(error) : resolvePromise())));
  if (!port) throw new Error("Could not reserve a local port for desktop smoke API.");
  return port;
}

function readText(path) {
  return readFileSync(path, "utf-8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message} Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`);
  }
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error("process did not exit before timeout")), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolvePromise();
    });
  });
}
