import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const defaultApiBase = "http://127.0.0.1:8000";

const options = parseArgs(process.argv.slice(2));
const strictWarnings = process.env.DUEFLOW_PREFLIGHT_STRICT_WARNINGS === "1";

try {
  const apiBase = process.env.DUEFLOW_PREFLIGHT_API_BASE ?? defaultApiBase;
  const result = options.fixture
    ? JSON.parse(await readFile(options.fixture, "utf-8"))
    : await fetchJson(apiBase, "/desktop/self-check", "self-check");
  const about = options.aboutFixture
    ? JSON.parse(await readFile(options.aboutFixture, "utf-8"))
    : await fetchJson(apiBase, "/desktop/about", "about");

  validateSelfCheckPayload(result);
  validateAboutPayload(about);
  printSelfCheck(result);
  printAbout(about);

  if (result.summary.error > 0 || result.status === "error") {
    console.error("DueFlow preflight failed: self-check contains error items.");
    process.exit(1);
  }
  if (about.schema_version !== about.supported_schema_version) {
    console.error(`DueFlow preflight failed: schema version ${about.schema_version} does not match supported version ${about.supported_schema_version}.`);
    process.exit(1);
  }
  if (strictWarnings && result.summary.warning > 0) {
    console.error("DueFlow preflight failed: warnings are treated as errors by DUEFLOW_PREFLIGHT_STRICT_WARNINGS=1.");
    process.exit(1);
  }
  if (options.jsonOut) {
    await writePreflightSummary(options.jsonOut, result, about);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}

async function fetchJson(apiBase, path, label) {
  const url = `${apiBase.replace(/\/$/, "")}${path}`;
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(`DueFlow preflight could not reach ${url}. Start the local desktop API before release, or set DUEFLOW_SKIP_PREFLIGHT=1 for development-only builds. ${error instanceof Error ? error.message : error}`);
  }

  if (!response.ok) {
    throw new Error(`DueFlow preflight ${label} request failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function validateSelfCheckPayload(payload) {
  if (!payload || typeof payload !== "object") throw new Error("DueFlow preflight received an invalid self-check payload.");
  if (!["ok", "warning", "error"].includes(payload.status)) throw new Error("DueFlow preflight payload has an invalid status.");
  if (!payload.summary || typeof payload.summary.error !== "number" || typeof payload.summary.warning !== "number" || typeof payload.summary.ok !== "number") {
    throw new Error("DueFlow preflight payload is missing summary counts.");
  }
  if (!Array.isArray(payload.checks)) throw new Error("DueFlow preflight payload is missing checks.");
}

function validateAboutPayload(payload) {
  if (!payload || typeof payload !== "object") throw new Error("DueFlow preflight received an invalid about payload.");
  if (payload.service !== "desktop") throw new Error("DueFlow preflight about payload has an invalid service.");
  if (typeof payload.api_version !== "string" || !payload.api_version) throw new Error("DueFlow preflight about payload is missing api_version.");
  if (typeof payload.schema_version !== "number" || typeof payload.supported_schema_version !== "number") {
    throw new Error("DueFlow preflight about payload is missing schema version fields.");
  }
  if (!payload.paths || typeof payload.paths.database !== "string") throw new Error("DueFlow preflight about payload is missing data paths.");
  if (
    !payload.capabilities ||
    payload.capabilities.database_backup !== true ||
    payload.capabilities.database_restore !== true ||
    payload.capabilities.diagnostics_export !== true
  ) {
    throw new Error("DueFlow preflight about payload is missing required support capabilities.");
  }
  validateIntakeLimits(payload.capabilities.limits);
}

function validateIntakeLimits(limits) {
  if (
    !limits ||
    !Number.isInteger(limits.max_text_chars) ||
    limits.max_text_chars <= 0 ||
    !Number.isInteger(limits.max_upload_bytes) ||
    limits.max_upload_bytes <= 0
  ) {
    throw new Error("DueFlow preflight about payload is missing positive desktop intake limits.");
  }
}

function printSelfCheck(result) {
  console.log(`DueFlow preflight: ${result.status} (${result.summary.ok} ok, ${result.summary.warning} warning, ${result.summary.error} error)`);
  for (const check of result.checks) {
    const label = check.label || check.id || "unknown";
    const status = check.status || "unknown";
    const message = check.message || "";
    const path = check.path ? ` [${check.path}]` : "";
    console.log(`- ${status.toUpperCase()} ${label}: ${message}${path}`);
  }
}

function printAbout(about) {
  console.log(`DueFlow about: API ${about.api_version}, schema ${about.schema_version}/${about.supported_schema_version}, Python ${about.python_version || "unknown"}`);
  console.log(`- Platform: ${about.platform || "unknown"}`);
  console.log(`- Database: ${about.paths.database}`);
  console.log(
    `- Capabilities: backup=${about.capabilities.database_backup ? "yes" : "no"}, restore=${about.capabilities.database_restore ? "yes" : "no"}, diagnostics=${about.capabilities.diagnostics_export ? "yes" : "no"}`,
  );
  console.log(
    `- Intake limits: text=${about.capabilities.limits.max_text_chars} chars, upload=${formatBytes(about.capabilities.limits.max_upload_bytes)}`,
  );
}

async function writePreflightSummary(path, selfCheck, about) {
  const summary = {
    generated_at: new Date().toISOString(),
    status: selfCheck.status,
    summary: selfCheck.summary,
    api_version: about.api_version,
    schema_version: about.schema_version,
    supported_schema_version: about.supported_schema_version,
    platform: about.platform || null,
    python_version: about.python_version || null,
    capabilities: {
      database_backup: about.capabilities.database_backup === true,
      database_restore: about.capabilities.database_restore === true,
      diagnostics_export: about.capabilities.diagnostics_export === true,
      limits: {
        max_text_chars: about.capabilities.limits.max_text_chars,
        max_upload_bytes: about.capabilities.limits.max_upload_bytes,
      },
    },
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(summary, null, 2)}\n`, "utf-8");
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${Math.round((bytes / 1024 / 1024) * 10) / 10} MiB`;
  if (bytes >= 1024) return `${Math.round((bytes / 1024) * 10) / 10} KiB`;
  return `${bytes} B`;
}

function parseArgs(args) {
  const parsed = { fixture: null, aboutFixture: null, jsonOut: null };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--fixture") {
      parsed.fixture = args[index + 1] ?? null;
      index += 1;
    } else if (args[index] === "--about-fixture") {
      parsed.aboutFixture = args[index + 1] ?? null;
      index += 1;
    } else if (args[index] === "--json-out") {
      parsed.jsonOut = args[index + 1] ?? null;
      index += 1;
    }
  }
  return parsed;
}
