import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { isTauriRuntime } from "./platform";
import type { DueFlowEventMap } from "./eventBus";

export type SystemNoticePayload = DueFlowEventMap["notice.show"] & {
  key?: string;
  system?: boolean;
};

type SystemNoticeDependencies = {
  isDesktopRuntime?: () => boolean;
  isPermissionGranted?: () => Promise<boolean>;
  requestPermission?: () => Promise<"granted" | "denied" | "prompt" | "prompt-with-rationale">;
  sendNotification?: (options: { id: number; title: string; body: string; group: string; autoCancel: boolean; sound?: string }) => void;
  storage?: StorageLike;
  now?: () => Date;
};

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

const NOTICE_SENT_KEY = "dueflow.notice.system.sent.v1";
const PERMISSION_REQUESTED_KEY = "dueflow.notification.permission.requested";
const NOTICE_DEDUP_MS = 5 * 60 * 1000;
const NOTICE_RETENTION_MS = 24 * 60 * 60 * 1000;

let permissionReady: boolean | null = null;
let permissionRequest: Promise<boolean> | null = null;

export async function notifyFromNotice(payload: SystemNoticePayload, deps: SystemNoticeDependencies = {}): Promise<boolean> {
  const runtime = deps.isDesktopRuntime ?? isTauriRuntime;
  if (!runtime()) return false;
  if (!shouldSendSystemNotice(payload)) return false;

  const storage = deps.storage ?? defaultStorage();
  if (!storage) return false;
  const now = deps.now ?? (() => new Date());
  const dedupKey = noticeDedupKey(payload);
  const sent = readSentMap(storage);
  const previous = sent[dedupKey] ? new Date(sent[dedupKey]).getTime() : 0;
  const nowDate = now();
  if (previous && nowDate.getTime() - previous < NOTICE_DEDUP_MS) return false;

  const permissionGranted = await ensureNoticePermission(deps);
  if (!permissionGranted) return false;

  sent[dedupKey] = nowDate.toISOString();
  writeSentMap(storage, sent, nowDate);
  const title = payload.tone === "warning" ? "DueFlow 需要注意" : "DueFlow";
  const sound = payload.tone === "warning" ? "Ping" : undefined;
  (deps.sendNotification ?? sendNotification)({
    id: notificationId(`notice:${dedupKey}`),
    title,
    body: payload.message,
    group: "dueflow-notice",
    autoCancel: true,
    sound,
  });
  return true;
}

export function shouldSendSystemNotice(payload: SystemNoticePayload): boolean {
  if (payload.system === false) return false;
  if (!payload.message.trim()) return false;
  if (payload.system === true) return true;
  return payload.tone === "warning";
}

export function resetSystemNoticePermissionCache() {
  permissionReady = null;
  permissionRequest = null;
}

async function ensureNoticePermission(deps: SystemNoticeDependencies): Promise<boolean> {
  if (permissionReady !== null) return permissionReady;
  if (permissionRequest) return permissionRequest;

  const storage = deps.storage ?? defaultStorage();
  permissionRequest = (async () => {
    try {
      let granted = await (deps.isPermissionGranted ?? isPermissionGranted)();
      if (!granted && storage && !storage.getItem(PERMISSION_REQUESTED_KEY)) {
        storage.setItem(PERMISSION_REQUESTED_KEY, new Date().toISOString());
        granted = (await (deps.requestPermission ?? requestPermission)()) === "granted";
      }
      permissionReady = granted;
      return granted;
    } catch {
      permissionReady = false;
      return false;
    } finally {
      permissionRequest = null;
    }
  })();

  return permissionRequest;
}

function noticeDedupKey(payload: SystemNoticePayload): string {
  return payload.key ?? `${payload.tone}:${payload.message.trim()}`;
}

function readSentMap(storage: StorageLike): Record<string, string> {
  try {
    const value = storage.getItem(NOTICE_SENT_KEY);
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

function writeSentMap(storage: StorageLike, sent: Record<string, string>, now: Date) {
  const cutoff = now.getTime() - NOTICE_RETENTION_MS;
  const compacted = Object.fromEntries(Object.entries(sent).filter(([, value]) => new Date(value).getTime() >= cutoff));
  storage.setItem(NOTICE_SENT_KEY, JSON.stringify(compacted));
}

function defaultStorage(): StorageLike | null {
  return typeof localStorage !== "undefined" ? localStorage : null;
}

function notificationId(key: string): number {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}
