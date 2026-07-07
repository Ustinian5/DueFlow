import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const outdir = await mkdtemp(join(tmpdir(), "dueflow-runtime-tests-"));
const outfile = join(outdir, "pet-runtime.test.mjs");

try {
  installMemoryLocalStorage();
  await build({
    entryPoints: ["tests/pet-runtime.test.ts"],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    loader: { ".svg": "file" },
    logLevel: "silent",
    plugins: [
      {
        name: "tauri-core-stub",
        setup(buildApi) {
          buildApi.onResolve({ filter: /^@tauri-apps\/api\/core$/ }, () => ({
            path: "tauri-core-stub",
            namespace: "tauri-core-stub",
          }));
          buildApi.onResolve({ filter: /^@tauri-apps\/api\/event$/ }, () => ({
            path: "tauri-event-stub",
            namespace: "tauri-event-stub",
          }));
          buildApi.onResolve({ filter: /^@tauri-apps\/plugin-notification$/ }, () => ({
            path: "tauri-notification-stub",
            namespace: "tauri-notification-stub",
          }));
          buildApi.onLoad({ filter: /.*/, namespace: "tauri-core-stub" }, () => ({
            contents: [
              "export async function invoke() { throw new Error('Tauri invoke is unavailable in runtime tests.'); }",
              "export function convertFileSrc(path) { return `asset://${path}`; }",
            ].join("\n"),
            loader: "js",
          }));
          buildApi.onLoad({ filter: /.*/, namespace: "tauri-event-stub" }, () => ({
            contents: [
              "export async function emitTo() {}",
              "export async function listen() { return () => undefined; }",
            ].join("\n"),
            loader: "js",
          }));
          buildApi.onLoad({ filter: /.*/, namespace: "tauri-notification-stub" }, () => ({
            contents: [
              "export async function isPermissionGranted() { return false; }",
              "export async function requestPermission() { return 'denied'; }",
              "export function sendNotification() {}",
            ].join("\n"),
            loader: "js",
          }));
        },
      },
    ],
  });

  await import(pathToFileURL(outfile).href);
} finally {
  await rm(outdir, { recursive: true, force: true });
}

function installMemoryLocalStorage() {
  const store = new Map();
  const storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key) {
      return store.has(String(key)) ? store.get(String(key)) : null;
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key) {
      store.delete(String(key));
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
  };

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    enumerable: true,
    value: storage,
    writable: true,
  });
}
