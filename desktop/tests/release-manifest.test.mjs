import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeReleaseManifest } from "../scripts/write-release-manifest.mjs";

const tempDir = await mkdtemp(join(tmpdir(), "dueflow-release-manifest-"));

try {
  await testWritesTraceableManifest();
  await testWritesNullPreflightWhenSkipped();
  await testRejectsInvalidSha();
  await testRejectsPreflightWithoutLimits();
  console.log("release manifest tests passed");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

async function testWritesTraceableManifest() {
  const preflightPath = join(tempDir, "preflight.json");
  const manifestPath = join(tempDir, "release", "DueFlow.manifest.json");
  const preflight = {
    generated_at: "2026-07-07T00:00:00.000Z",
    status: "ok",
    summary: { ok: 7, warning: 0, error: 0 },
    api_version: "0.1.0",
    schema_version: 1,
      supported_schema_version: 1,
      platform: "Darwin",
      python_version: "3.11.0",
      capabilities: {
        database_backup: true,
        database_restore: true,
        diagnostics_export: true,
        limits: {
          max_text_chars: 200000,
          max_upload_bytes: 26214400,
        },
      },
    };
  await writeFile(preflightPath, `${JSON.stringify(preflight)}\n`, "utf-8");

  const manifest = await writeReleaseManifest({
    manifestOut: manifestPath,
    preflightSummary: preflightPath,
    version: "0.1.0",
    arch: "arm64",
    createdAt: "20260707T000000Z",
    bundle: "DueFlow-Desktop_0.1.0_arm64_20260707T000000Z.app.zip",
    sha256: "a".repeat(64),
    bytes: "4096",
  });
  const persisted = JSON.parse(await readFile(manifestPath, "utf-8"));

  assert.deepEqual(persisted, manifest);
  assert.equal(persisted.product, "DueFlow Desktop");
  assert.equal(persisted.bytes, 4096);
  assert.equal(persisted.signed, false);
  assert.equal(persisted.notarized, false);
  assert.deepEqual(persisted.preflight, preflight);
}

async function testWritesNullPreflightWhenSkipped() {
  const manifestPath = join(tempDir, "skip", "DueFlow.manifest.json");

  await writeReleaseManifest({
    manifestOut: manifestPath,
    preflightSummary: join(tempDir, "missing-preflight.json"),
    version: "0.1.0",
    arch: "x64",
    createdAt: "20260707T010000Z",
    bundle: "DueFlow-Desktop_0.1.0_x64_20260707T010000Z.app.zip",
    sha256: "b".repeat(64),
    bytes: "2048",
  });
  const persisted = JSON.parse(await readFile(manifestPath, "utf-8"));

  assert.equal(persisted.preflight, null);
  assert.equal(persisted.bytes, 2048);
}

async function testRejectsInvalidSha() {
  await assert.rejects(
    () =>
      writeReleaseManifest({
        manifestOut: join(tempDir, "invalid", "DueFlow.manifest.json"),
        preflightSummary: null,
        version: "0.1.0",
        arch: "arm64",
        createdAt: "20260707T020000Z",
        bundle: "DueFlow-Desktop_0.1.0_arm64_20260707T020000Z.app.zip",
        sha256: "not-a-sha",
        bytes: "1024",
      }),
    /sha256/,
  );
}

async function testRejectsPreflightWithoutLimits() {
  const preflightPath = join(tempDir, "preflight-missing-limits.json");
  await writeFile(
    preflightPath,
    `${JSON.stringify({
      status: "ok",
      summary: { ok: 7, warning: 0, error: 0 },
      schema_version: 1,
      supported_schema_version: 1,
      capabilities: {
        database_backup: true,
        database_restore: true,
        diagnostics_export: true,
      },
    })}\n`,
    "utf-8",
  );

  await assert.rejects(
    () =>
      writeReleaseManifest({
        manifestOut: join(tempDir, "missing-limits", "DueFlow.manifest.json"),
        preflightSummary: preflightPath,
        version: "0.1.0",
        arch: "arm64",
        createdAt: "20260707T030000Z",
        bundle: "DueFlow-Desktop_0.1.0_arm64_20260707T030000Z.app.zip",
        sha256: "c".repeat(64),
        bytes: "1024",
      }),
    /intake limits/,
  );
}
