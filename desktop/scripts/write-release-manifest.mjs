import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const options = parseArgs(process.argv.slice(2));

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await writeReleaseManifest(options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}

export async function writeReleaseManifest({
  manifestOut,
  preflightSummary,
  version,
  arch,
  createdAt,
  bundle,
  sha256,
  bytes,
  backend,
  backendSha256,
  backendBytes,
  backendSelfCheck,
}) {
  requireOption(manifestOut, "--manifest-out");
  requireOption(version, "--version");
  requireOption(arch, "--arch");
  requireOption(createdAt, "--created-at");
  requireOption(bundle, "--bundle");
  requireOption(sha256, "--sha256");
  requireOption(bytes, "--bytes");
  requireOption(backend, "--backend");
  requireOption(backendSha256, "--backend-sha256");
  requireOption(backendBytes, "--backend-bytes");
  requireOption(backendSelfCheck, "--backend-self-check");
  validateBundleName(bundle);
  validateSha256(sha256);
  validateBackendName(backend);
  validateSha256(backendSha256);

  const manifest = {
    product: "DueFlow Desktop",
    version,
    arch,
    created_at: createdAt,
    bundle,
    sha256,
    bytes: parseBytes(bytes),
    signed: false,
    notarized: false,
    integrity: {
      code_directory: "ad-hoc",
      codesign_verified: true,
      verification_command: "codesign --verify --deep --strict",
      backend_support_directory: "Contents/Resources/.dueflow-backend",
      backend_runtime_link: "Contents/Frameworks",
    },
    backend: {
      bundled: true,
      file: backend,
      runtime_directory: "../Frameworks",
      sha256: backendSha256,
      bytes: parseBytes(backendBytes),
      self_check: await readBackendSelfCheck(backendSelfCheck),
    },
    preflight: await readPreflightSummary(preflightSummary),
  };

  await mkdir(dirname(manifestOut), { recursive: true });
  await writeFile(manifestOut, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
  return manifest;
}

async function readBackendSelfCheck(path) {
  if (!path || !existsSync(path)) throw new Error("Release manifest bundled backend self-check file is missing.");
  const payload = JSON.parse(await readFile(path, "utf-8"));
  if (
    !payload ||
    payload.service !== "dueflow-backend" ||
    payload.status !== "ok" ||
    !Array.isArray(payload.required_routes)
  ) {
    throw new Error("Release manifest bundled backend self-check is invalid.");
  }
  const requiredRoutes = [
    "/desktop/about",
    "/desktop/health",
    "/desktop/overview",
    "/desktop/self-check",
  ];
  if (!requiredRoutes.every((route) => payload.required_routes.includes(route))) {
    throw new Error("Release manifest bundled backend self-check is missing required routes.");
  }
  return payload;
}

async function readPreflightSummary(path) {
  if (!path || !existsSync(path)) return null;
  const payload = JSON.parse(await readFile(path, "utf-8"));
  validatePreflightSummary(payload);
  return payload;
}

function validatePreflightSummary(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Release manifest preflight summary must be a JSON object.");
  if (!["ok", "warning", "error"].includes(payload.status)) throw new Error("Release manifest preflight summary has an invalid status.");
  if (!payload.summary || typeof payload.summary.ok !== "number" || typeof payload.summary.warning !== "number" || typeof payload.summary.error !== "number") {
    throw new Error("Release manifest preflight summary is missing counts.");
  }
  if (typeof payload.schema_version !== "number" || typeof payload.supported_schema_version !== "number") {
    throw new Error("Release manifest preflight summary is missing schema versions.");
  }
  if (
    !payload.capabilities ||
    payload.capabilities.database_backup !== true ||
    payload.capabilities.database_restore !== true ||
    payload.capabilities.diagnostics_export !== true
  ) {
    throw new Error("Release manifest preflight summary is missing required support capabilities.");
  }
  if (
    !payload.capabilities.limits ||
    !Number.isInteger(payload.capabilities.limits.max_text_chars) ||
    payload.capabilities.limits.max_text_chars <= 0 ||
    !Number.isInteger(payload.capabilities.limits.max_upload_bytes) ||
    payload.capabilities.limits.max_upload_bytes <= 0
  ) {
    throw new Error("Release manifest preflight summary is missing positive desktop intake limits.");
  }
}

function parseBytes(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Release manifest bytes must be a positive integer: ${value}`);
  return parsed;
}

function validateBundleName(value) {
  if (!value.endsWith(".app.zip")) throw new Error(`Release manifest bundle must point to an app zip: ${value}`);
}

function validateBackendName(value) {
  if (!/^dueflow-backend(?:\.exe)?$/.test(value)) {
    throw new Error(`Release manifest backend must be the packaged DueFlow sidecar: ${value}`);
  }
}

function validateSha256(value) {
  if (!/^[a-fA-F0-9]{64}$/.test(value)) throw new Error(`Release manifest sha256 must be a 64-character hex digest: ${value}`);
}

function requireOption(value, flag) {
  if (!value) throw new Error(`Missing required release manifest option: ${flag}`);
}

function parseArgs(args) {
  const parsed = {
    manifestOut: null,
    preflightSummary: null,
    version: null,
    arch: null,
    createdAt: null,
    bundle: null,
    sha256: null,
    bytes: null,
    backend: null,
    backendSha256: null,
    backendBytes: null,
    backendSelfCheck: null,
  };

  const keys = {
    "--manifest-out": "manifestOut",
    "--preflight-summary": "preflightSummary",
    "--version": "version",
    "--arch": "arch",
    "--created-at": "createdAt",
    "--bundle": "bundle",
    "--sha256": "sha256",
    "--bytes": "bytes",
    "--backend": "backend",
    "--backend-sha256": "backendSha256",
    "--backend-bytes": "backendBytes",
    "--backend-self-check": "backendSelfCheck",
  };

  for (let index = 0; index < args.length; index += 1) {
    const key = keys[args[index]];
    if (key) {
      parsed[key] = args[index + 1] ?? null;
      index += 1;
    }
  }
  return parsed;
}
