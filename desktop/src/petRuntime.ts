import { dueFlowEvents } from "./eventBus";
import type { DueFlowEventMap } from "./eventBus";
import { invokeDesktopCommand, isTauriRuntime } from "./platform";
import type { Overview, PetState } from "./types";

export type PetActionId = "open-main" | "quick-input" | "toggle-pet";

export type PetActionDescriptor = {
  id: PetActionId;
  title: string;
  description: string;
  requiresDesktopRuntime: boolean;
  cooldownMs: number;
  retryCount: number;
  retryDelayMs: number;
};

export type PetActionPolicy = {
  cooldownMs: number;
  retryCount: number;
};

export type PetActionPolicyPreferences = Partial<Record<PetActionId, Partial<PetActionPolicy>>>;

export type PetRuntimeSnapshot = {
  label: string;
  message: string;
  stateClass: string;
  severityClass: string;
  pendingTasks: number;
  highRiskCount: number;
};

export type PetActionResult = {
  ok: boolean;
  error?: string;
  blocked?: boolean;
  cancelled?: boolean;
  reason?: "busy" | "cooldown" | "cancelled";
  errorKind?: PetActionErrorKind;
  retryable?: boolean;
  attempts: number;
  retryAfterMs?: number;
};

export type PetActionErrorKind = "desktop_unavailable" | "permission_denied" | "transient_desktop" | "unknown";

type PetActionFailure = {
  message: string;
  kind: PetActionErrorKind;
  retryable: boolean;
};

type PetRuntimeEventPublisher = <K extends keyof DueFlowEventMap>(type: K, payload: DueFlowEventMap[K]) => void;

export type PetActionRunnerOptions = {
  isDesktopRuntime?: () => boolean;
  invokeCommand?: (command: string) => Promise<void>;
  publish?: PetRuntimeEventPublisher;
  now?: () => Date;
  sleep?: (delayMs: number) => Promise<void>;
  skipCooldown?: boolean;
  requestId?: string;
  policyPreferences?: PetActionPolicyPreferences;
};

type PetActionRuntimeState = {
  inFlight: boolean;
  lastFinishedAtMs?: number;
};

type QueuedPetAction = {
  requestId: string;
  actionId: PetActionId;
  title: string;
  options: PetActionRunnerOptions;
  resolve: (result: PetActionResult) => void;
};

export type PetActionRequest = {
  requestId: string;
  result: Promise<PetActionResult>;
};

const actionRuntimeState = new Map<PetActionId, PetActionRuntimeState>();
const actionQueue: QueuedPetAction[] = [];
let isQueueDraining = false;
let actionRequestCounter = 0;

const PET_ACTION_POLICY_PREFERENCES_KEY = "dueflow.petActionPolicyPreferences.v1";
const MIN_COOLDOWN_MS = 0;
const MAX_COOLDOWN_MS = 10_000;
const MIN_RETRY_COUNT = 0;
const MAX_RETRY_COUNT = 3;

export const PET_STATE_LABELS: Record<string, string> = {
  no_task: "休息中",
  processing: "等待确认",
  idle: "陪伴中",
  missing_info: "信息不完整",
  deadline_near: "DDL 接近",
  overdue: "已经逾期",
  task_done: "完成得不错",
};

export const petActionDescriptors: PetActionDescriptor[] = [
  {
    id: "open-main",
    title: "打开 DueFlow",
    description: "显示主工作台窗口。",
    requiresDesktopRuntime: true,
    cooldownMs: 1_000,
    retryCount: 1,
    retryDelayMs: 250,
  },
  {
    id: "quick-input",
    title: "快速输入",
    description: "打开主窗口并聚焦 DDL 输入框。",
    requiresDesktopRuntime: false,
    cooldownMs: 800,
    retryCount: 0,
    retryDelayMs: 0,
  },
  {
    id: "toggle-pet",
    title: "隐藏桌宠",
    description: "切换桌宠悬浮窗口显示状态。",
    requiresDesktopRuntime: true,
    cooldownMs: 1_200,
    retryCount: 1,
    retryDelayMs: 250,
  },
];

export function derivePetRuntimeSnapshot(overview: Overview | null, isWaiting = false): PetRuntimeSnapshot {
  const pet: PetState = overview?.pet_state ?? {
    state: "processing",
    mood: "neutral",
    message: "正在连接本地服务...",
    severity: "normal",
  };

  const pendingTasks = overview?.tasks.filter((task) => task.status !== "done" && task.status !== "archived").length ?? 0;
  const highRiskCount = overview?.risks.filter((risk) => risk.severity === "high").length ?? 0;
  const stateClass = isWaiting ? "processing" : pet.state;

  return {
    label: PET_STATE_LABELS[stateClass] ?? stateClass,
    message: isWaiting ? "正在连接本地服务..." : pet.message,
    stateClass,
    severityClass: pet.severity,
    pendingTasks,
    highRiskCount,
  };
}

export async function runPetAction(actionId: PetActionId, options: PetActionRunnerOptions = {}): Promise<PetActionResult> {
  const descriptor = resolvePetActionDescriptor(actionId, options.policyPreferences ?? loadPetActionPolicyPreferences());
  const title = descriptor?.title ?? actionId;
  const publish = options.publish ?? dueFlowEvents.publish.bind(dueFlowEvents);
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? ((delayMs: number) => new Promise<void>((resolve) => globalThis.setTimeout(resolve, delayMs)));
  const runtimeAvailable = options.isDesktopRuntime ?? isTauriRuntime;
  const invokeCommand = options.invokeCommand ?? ((command: string) => invokeDesktopCommand<void>(command));
  const maxAttempts = (descriptor?.retryCount ?? 0) + 1;
  const state = getActionRuntimeState(actionId);
  const startedAtMs = now().getTime();
  const requestId = options.requestId;

  if (state.inFlight) {
    const message = `${title}正在执行，请稍候。`;
    publish("pet.action.blocked", { actionId, title, requestId, reason: "busy", message, blockedAt: now().toISOString() });
    publish("notice.show", { message, tone: "warning" });
    return { ok: false, blocked: true, reason: "busy", error: message, attempts: 0 };
  }

  const cooldownMs = descriptor?.cooldownMs ?? 0;
  const retryAfterMs = !options.skipCooldown && state.lastFinishedAtMs ? Math.max(0, cooldownMs - (startedAtMs - state.lastFinishedAtMs)) : 0;
  if (retryAfterMs > 0) {
    const message = `${title}刚执行过，${formatCooldown(retryAfterMs)}后再试。`;
    publish("pet.action.blocked", { actionId, title, requestId, reason: "cooldown", message, retryAfterMs, blockedAt: now().toISOString() });
    publish("notice.show", { message, tone: "warning" });
    return { ok: false, blocked: true, reason: "cooldown", error: message, attempts: 0, retryAfterMs };
  }

  state.inFlight = true;
  let attempts = 0;

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      attempts = attempt;
      publish("pet.action.started", { actionId, title, requestId, startedAt: now().toISOString(), attempt, maxAttempts });
      try {
        await executePetAction(actionId, descriptor, runtimeAvailable, invokeCommand, publish);
        state.lastFinishedAtMs = now().getTime();
        publish("pet.action.finished", { actionId, title, requestId, finishedAt: now().toISOString(), attempt });
        return { ok: true, attempts };
      } catch (error) {
        const failure = classifyPetActionFailure(error, descriptor);
        if (failure.retryable && attempt < maxAttempts) {
          const retryAt = new Date(now().getTime() + (descriptor?.retryDelayMs ?? 0)).toISOString();
          publish("pet.action.retrying", { actionId, title, requestId, error: failure.message, errorKind: failure.kind, attempt, nextAttempt: attempt + 1, retryAt });
          await sleep(descriptor?.retryDelayMs ?? 0);
          continue;
        }
        publish("pet.action.failed", { actionId, title, requestId, error: failure.message, errorKind: failure.kind, retryable: failure.retryable, failedAt: now().toISOString(), attempt, maxAttempts });
        publish("notice.show", { message: `${title}失败：${failure.message}`, tone: "warning" });
        return { ok: false, error: failure.message, errorKind: failure.kind, retryable: failure.retryable, attempts };
      }
    }
    return { ok: false, error: `${title}未执行。`, attempts };
  } finally {
    state.inFlight = false;
  }
}

export function resolvePetActionDescriptor(
  actionId: PetActionId,
  preferences: PetActionPolicyPreferences = loadPetActionPolicyPreferences(),
): PetActionDescriptor | undefined {
  const descriptor = petActionDescriptors.find((item) => item.id === actionId);
  if (!descriptor) return undefined;
  const policy = preferences[actionId];
  if (!policy) return descriptor;
  return {
    ...descriptor,
    cooldownMs: sanitizeCooldownMs(policy.cooldownMs, descriptor.cooldownMs),
    retryCount: sanitizeRetryCount(policy.retryCount, descriptor.retryCount),
  };
}

export function loadPetActionPolicyPreferences(): PetActionPolicyPreferences {
  if (!hasUsableLocalStorage()) return {};
  try {
    const raw = localStorage.getItem(PET_ACTION_POLICY_PREFERENCES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) return {};
    const next: PetActionPolicyPreferences = {};
    for (const descriptor of petActionDescriptors) {
      const policy = parsed[descriptor.id];
      if (!isRecord(policy)) continue;
      next[descriptor.id] = {
        cooldownMs: sanitizeCooldownMs(policy.cooldownMs, descriptor.cooldownMs),
        retryCount: sanitizeRetryCount(policy.retryCount, descriptor.retryCount),
      };
    }
    return next;
  } catch {
    return {};
  }
}

export function setPetActionPolicyPreference(
  actionId: PetActionId,
  patch: Partial<PetActionPolicy>,
  current: PetActionPolicyPreferences = loadPetActionPolicyPreferences(),
): PetActionPolicyPreferences {
  const descriptor = petActionDescriptors.find((item) => item.id === actionId);
  if (!descriptor) return current;
  const existing = current[actionId] ?? {};
  const merged = {
    cooldownMs: sanitizeCooldownMs(patch.cooldownMs ?? existing.cooldownMs, descriptor.cooldownMs),
    retryCount: sanitizeRetryCount(patch.retryCount ?? existing.retryCount, descriptor.retryCount),
  };
  const next = { ...current, [actionId]: merged };
  persistPetActionPolicyPreferences(next);
  return next;
}

export function resetPetActionPolicyPreferences(): PetActionPolicyPreferences {
  persistPetActionPolicyPreferences({});
  return {};
}

export function classifyPetActionFailure(error: unknown, descriptor?: PetActionDescriptor): PetActionFailure {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (message.includes("不在桌面运行时") || normalized.includes("not in tauri") || normalized.includes("desktop runtime")) {
    return { message, kind: "desktop_unavailable", retryable: false };
  }
  if (
    normalized.includes("permission") ||
    normalized.includes("denied") ||
    normalized.includes("forbidden") ||
    message.includes("权限") ||
    message.includes("拒绝")
  ) {
    return { message, kind: "permission_denied", retryable: false };
  }
  if (descriptor?.requiresDesktopRuntime) {
    return { message, kind: "transient_desktop", retryable: true };
  }
  return { message, kind: "unknown", retryable: true };
}

export function enqueuePetAction(actionId: PetActionId, options: PetActionRunnerOptions = {}): PetActionRequest {
  const descriptor = petActionDescriptors.find((item) => item.id === actionId);
  const title = descriptor?.title ?? actionId;
  const publish = options.publish ?? dueFlowEvents.publish.bind(dueFlowEvents);
  const now = options.now ?? (() => new Date());
  const requestId = options.requestId ?? nextActionRequestId();
  const shouldPublishQueued = isQueueDraining || actionQueue.length > 0;
  const result = new Promise<PetActionResult>((resolve) => {
    actionQueue.push({
      requestId,
      actionId,
      title,
      options: { ...options, requestId },
      resolve,
    });
  });

  if (shouldPublishQueued) {
    const position = actionQueue.length + (isQueueDraining ? 1 : 0);
    publish("pet.action.queued", { actionId, title, requestId, queuedAt: now().toISOString(), position });
  }
  void drainPetActionQueue();

  return { requestId, result };
}

export function cancelQueuedPetAction(
  requestId: string,
  options: Pick<PetActionRunnerOptions, "publish" | "now"> = {},
): boolean {
  const index = actionQueue.findIndex((item) => item.requestId === requestId);
  if (index < 0) return false;
  const [item] = actionQueue.splice(index, 1);
  const publish = options.publish ?? item.options.publish ?? dueFlowEvents.publish.bind(dueFlowEvents);
  const now = options.now ?? item.options.now ?? (() => new Date());
  publish("pet.action.cancelled", { actionId: item.actionId, title: item.title, requestId, cancelledAt: now().toISOString(), reason: "user" });
  item.resolve({ ok: false, cancelled: true, reason: "cancelled", attempts: 0 });
  return true;
}

export function resetPetActionRuntimeState() {
  actionRuntimeState.clear();
  actionQueue.splice(0);
  isQueueDraining = false;
  actionRequestCounter = 0;
}

function getActionRuntimeState(actionId: PetActionId) {
  const existing = actionRuntimeState.get(actionId);
  if (existing) return existing;
  const next: PetActionRuntimeState = { inFlight: false };
  actionRuntimeState.set(actionId, next);
  return next;
}

async function executePetAction(
  actionId: PetActionId,
  descriptor: PetActionDescriptor | undefined,
  runtimeAvailable: () => boolean,
  invokeCommand: (command: string) => Promise<void>,
  publish: PetRuntimeEventPublisher,
) {
  if (descriptor?.requiresDesktopRuntime && !runtimeAvailable()) {
    throw new Error("当前不在桌面运行时中，无法执行该桌宠动作。");
  }

  if (actionId === "quick-input") {
    if (runtimeAvailable()) {
      await invokeCommand("focus_quick_input_window");
    }
    publish("app.quick-input", { source: "pet" });
    publish("notice.show", { message: "快速输入已就绪。", tone: "info" });
  } else if (actionId === "open-main") {
    await invokeCommand("show_main_window");
  } else {
    await invokeCommand("toggle_pet_window");
  }
}

async function drainPetActionQueue() {
  if (isQueueDraining) return;
  isQueueDraining = true;

  try {
    while (actionQueue.length) {
      const item = actionQueue.shift();
      if (!item) continue;
      item.resolve(await runPetAction(item.actionId, item.options));
    }
  } finally {
    isQueueDraining = false;
  }
}

function nextActionRequestId() {
  actionRequestCounter += 1;
  return `pet-action-${Date.now().toString(36)}-${actionRequestCounter}`;
}

function persistPetActionPolicyPreferences(next: PetActionPolicyPreferences) {
  if (!hasUsableLocalStorage()) return;
  localStorage.setItem(PET_ACTION_POLICY_PREFERENCES_KEY, JSON.stringify(next));
}

function sanitizeCooldownMs(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(MAX_COOLDOWN_MS, Math.max(MIN_COOLDOWN_MS, Math.round(value)));
}

function sanitizeRetryCount(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(MAX_RETRY_COUNT, Math.max(MIN_RETRY_COUNT, Math.round(value)));
}

function hasUsableLocalStorage(): boolean {
  return typeof localStorage !== "undefined" && typeof localStorage.getItem === "function" && typeof localStorage.setItem === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatCooldown(delayMs: number) {
  if (delayMs < 1_000) return "片刻";
  return `${Math.ceil(delayMs / 1_000)} 秒`;
}
