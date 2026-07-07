import assert from "node:assert/strict";
import { DESKTOP_INTAKE_EVENT, DESKTOP_NOTICE_EVENT, emitIntakeToMain, emitNoticeToPet, listenForDesktopIntake, listenForDesktopNotice } from "../src/desktopBridge";
import type { DueFlowEventMap } from "../src/eventBus";
import { appendDropFailureRetryHint, summarizeIntakeError, summarizeIntakeResponse } from "../src/intakeFeedback";
import {
  auditLocalPetAppearances,
  builtInPetManifest,
  clearLocalPetAssetUrlCache,
  describePetAppearanceManifest,
  getPetLicenseAcceptanceRecord,
  hasAcceptedPetLicense,
  loadLocalPetAppearancePreferences,
  materializeLocalPetAppearance,
  openLocalPetAppearanceDirectory,
  resolveActivePetAppearance,
  resolveLocalPetThumbnailAsset,
  resolvePetAsset,
  setLocalPetAppearanceSelected,
  validatePetAppearanceManifest,
} from "../src/petManifest";
import {
  cancelQueuedPetAction,
  classifyPetActionFailure,
  derivePetRuntimeSnapshot,
  enqueuePetAction,
  loadPetActionPolicyPreferences,
  resetPetActionPolicyPreferences,
  resetPetActionRuntimeState,
  resolvePetActionDescriptor,
  runPetAction,
  setPetActionPolicyPreference,
} from "../src/petRuntime";
import { notifyFromNotice, resetSystemNoticePermissionCache, shouldSendSystemNotice } from "../src/systemNotice";
import {
  auditLocalSkillScan,
  builtInSkillManifests,
  describeSkillManifest,
  listVisibleSkillActions,
  loadLocalSkillPreferences,
  openLocalSkillDirectory,
  setLocalSkillEnabled,
  summarizeSkillRegistry,
  summarizeVisibleSkillActions,
  validateSkillManifest,
} from "../src/skillRegistry";
import type { SkillManifest } from "../src/skillRegistry";
import type { IntakeResponse, Overview } from "../src/types";

const overview = {
  inbox: [],
  tasks: [
    { id: "t1", status: "todo" },
    { id: "t2", status: "done" },
    { id: "t3", status: "archived" },
  ],
  plans: [],
  risks: [
    { id: "r1", severity: "high" },
    { id: "r2", severity: "medium" },
  ],
  pet_state: {
    state: "deadline_near",
    mood: "focused",
    message: "还有 DDL 要处理。",
    severity: "high",
  },
} as Overview;

const snapshot = derivePetRuntimeSnapshot(overview);
assert.equal(snapshot.label, "DDL 接近");
assert.equal(snapshot.message, "还有 DDL 要处理。");
assert.equal(snapshot.pendingTasks, 1);
assert.equal(snapshot.highRiskCount, 1);
assert.equal(snapshot.severityClass, "high");

const waitingSnapshot = derivePetRuntimeSnapshot(null, true);
assert.equal(waitingSnapshot.label, "等待确认");
assert.equal(waitingSnapshot.message, "正在连接本地服务...");
const noTaskSnapshot = derivePetRuntimeSnapshot({
  inbox: [],
  tasks: [],
  plans: [],
  risks: [],
  pet_state: {
    state: "no_task",
    mood: "relaxed",
    message: "今天暂时没有 DDL。",
    severity: "normal",
  },
} as Overview);
assert.equal(noTaskSnapshot.label, "休息中");
assert.equal(noTaskSnapshot.stateClass, "no_task");
assert.equal(noTaskSnapshot.pendingTasks, 0);
assert.equal(noTaskSnapshot.highRiskCount, 0);
const missingInfoSnapshot = derivePetRuntimeSnapshot({
  inbox: [],
  tasks: [
    { id: "missing-1", status: "todo" },
    { id: "missing-2", status: "done" },
  ],
  plans: [],
  risks: [],
  pet_state: {
    state: "missing_info",
    mood: "confused",
    message: "有 1 个任务信息还不完整。",
    severity: "normal",
  },
} as Overview);
assert.equal(missingInfoSnapshot.label, "信息不完整");
assert.equal(missingInfoSnapshot.stateClass, "missing_info");
assert.equal(missingInfoSnapshot.pendingTasks, 1);
const overdueSnapshot = derivePetRuntimeSnapshot({
  inbox: [],
  tasks: [{ id: "late-1", status: "todo" }],
  plans: [],
  risks: [{ id: "risk-late", severity: "high" }],
  pet_state: {
    state: "overdue",
    mood: "urgent",
    message: "有 1 个任务已经逾期，需要马上处理。",
    severity: "high",
  },
} as Overview);
assert.equal(overdueSnapshot.label, "已经逾期");
assert.equal(overdueSnapshot.stateClass, "overdue");
assert.equal(overdueSnapshot.severityClass, "high");
assert.equal(overdueSnapshot.pendingTasks, 1);
assert.equal(overdueSnapshot.highRiskCount, 1);
assert.equal(resolvePetAsset("deadline_near"), builtInPetManifest.assets.default);
assert.equal(
  resolvePetAsset("deadline_near", {
    ...builtInPetManifest,
    assets: { default: "default.svg", states: { deadline_near: "near.svg" } },
  }),
  "near.svg",
);

resetPetActionPolicyPreferences();
let actionPolicies = setPetActionPolicyPreference("open-main", { cooldownMs: 2_500, retryCount: 2 }, {});
assert.equal(resolvePetActionDescriptor("open-main", actionPolicies)?.cooldownMs, 2_500);
assert.equal(resolvePetActionDescriptor("open-main", actionPolicies)?.retryCount, 2);
assert.deepEqual(loadPetActionPolicyPreferences(), actionPolicies);
actionPolicies = setPetActionPolicyPreference("open-main", { cooldownMs: 99_999, retryCount: 99 }, actionPolicies);
assert.equal(resolvePetActionDescriptor("open-main", actionPolicies)?.cooldownMs, 10_000);
assert.equal(resolvePetActionDescriptor("open-main", actionPolicies)?.retryCount, 3);

const validPetManifest = {
  id: "local.pet",
  displayName: "Local Pet",
  author: "DueFlow Tester",
  version: "1.0.0",
  license: "CC-BY-4.0",
  source: "local",
  defaultScale: 1.2,
  dimensions: { width: 160, height: 180 },
  thumbnail: "thumb.png",
  assets: {
    default: "idle.svg",
    states: {
      deadline_near: "near.webp",
      task_done: "done.apng",
    },
  },
};
const validPetValidation = validatePetAppearanceManifest(validPetManifest);
assert.equal(validPetValidation.ok, true);
assert.deepEqual(validPetValidation.errors, []);
const validPetDetails = describePetAppearanceManifest(validPetManifest);
assert.equal(validPetDetails?.id, "local.pet");
assert.equal(validPetDetails?.dimensions, "160 x 180");
assert.equal(validPetDetails?.assetCount, 4);

const unsafePetValidation = validatePetAppearanceManifest({
  ...validPetManifest,
  id: "Unsafe Pet",
  license: "unknown",
  assets: {
    default: "https://example.com/pet.svg",
    states: {
      idle: "../idle.svg",
      dancing: "dance.svg",
    },
  },
});
assert.equal(unsafePetValidation.ok, false);
assert.ok(unsafePetValidation.errors.some((error) => error.includes("stable lowercase")));
assert.ok(unsafePetValidation.errors.some((error) => error.includes("local relative path")));
assert.ok(unsafePetValidation.errors.some((error) => error.includes("inside the pet package")));
assert.ok(unsafePetValidation.errors.some((error) => error.includes("Unsupported pet state")));
assert.ok(unsafePetValidation.warnings.some((warning) => warning.includes("license")));

const petAudit = auditLocalPetAppearances({
  directory: "/tmp/dueflow-pets",
  entries: [
    {
      file_name: "valid.pet.json",
      path: "/tmp/dueflow-pets/valid.pet.json",
      manifest: validPetManifest,
      error: null,
    },
    {
      file_name: "broken.pet.json",
      path: "/tmp/dueflow-pets/broken.pet.json",
      manifest: null,
      error: "invalid JSON",
    },
  ],
});
assert.equal(petAudit[0].validation.ok, true);
assert.equal(petAudit[0].details?.displayName, "Local Pet");
assert.equal(petAudit[1].validation.ok, false);
clearLocalPetAssetUrlCache();
const resolvedPetAssetPaths: string[] = [];
const petUrlResolver = (path: string) => {
  resolvedPetAssetPaths.push(path);
  return `asset://${path}`;
};
const materializedPet = materializeLocalPetAppearance(petAudit[0], petUrlResolver);
assert.equal(materializedPet?.source, "local");
assert.equal(materializedPet?.assets.default, "asset:///tmp/dueflow-pets/idle.svg");
assert.equal(materializedPet?.assets.states?.deadline_near, "asset:///tmp/dueflow-pets/near.webp");
assert.equal(materializedPet?.thumbnail, "asset:///tmp/dueflow-pets/thumb.png");
assert.equal(resolveLocalPetThumbnailAsset(petAudit[0], petUrlResolver), "asset:///tmp/dueflow-pets/thumb.png");
assert.equal(resolvedPetAssetPaths.filter((path) => path.endsWith("/thumb.png")).length, 1);
let petPreferences = setLocalPetAppearanceSelected(
  "/tmp/dueflow-pets/valid.pet.json",
  true,
  { selectedPath: null, acceptedLicensePaths: [], acceptedLicenses: [] },
  "CC-BY-4.0",
  "2026-07-07T08:00:00.000Z",
);
assert.equal(petPreferences.selectedPath, "/tmp/dueflow-pets/valid.pet.json");
assert.equal(hasAcceptedPetLicense("/tmp/dueflow-pets/valid.pet.json", petPreferences), true);
assert.deepEqual(getPetLicenseAcceptanceRecord("/tmp/dueflow-pets/valid.pet.json", petPreferences), {
  path: "/tmp/dueflow-pets/valid.pet.json",
  license: "CC-BY-4.0",
  acceptedAt: "2026-07-07T08:00:00.000Z",
});
assert.deepEqual(loadLocalPetAppearancePreferences(), petPreferences);
const activeLocalPet = resolveActivePetAppearance(petAudit, petPreferences, petUrlResolver);
assert.equal(activeLocalPet.manifest.id, "local.pet");
assert.equal(activeLocalPet.sourcePath, "/tmp/dueflow-pets/valid.pet.json");
petPreferences = setLocalPetAppearanceSelected("/tmp/dueflow-pets/missing.pet.json", false, petPreferences);
const missingLocalPet = resolveActivePetAppearance(petAudit, petPreferences, petUrlResolver);
assert.equal(missingLocalPet.manifest.id, builtInPetManifest.id);
assert.ok(missingLocalPet.fallbackReason?.includes("不存在"));
const legacyAcceptedPreferences = loadLocalPetAppearancePreferences();
localStorage.setItem("dueflow.localPetAppearancePreferences.v1", JSON.stringify({
  selectedPath: "/tmp/dueflow-pets/valid.pet.json",
  acceptedLicensePaths: ["/tmp/dueflow-pets/valid.pet.json"],
}));
const migratedLegacyPreferences = loadLocalPetAppearancePreferences();
assert.equal(hasAcceptedPetLicense("/tmp/dueflow-pets/valid.pet.json", migratedLegacyPreferences), true);
assert.equal(getPetLicenseAcceptanceRecord("/tmp/dueflow-pets/valid.pet.json", migratedLegacyPreferences)?.acceptedAt, null);
localStorage.setItem("dueflow.localPetAppearancePreferences.v1", JSON.stringify(legacyAcceptedPreferences));

const unacceptedLocalPet = resolveActivePetAppearance(petAudit, { selectedPath: "/tmp/dueflow-pets/valid.pet.json", acceptedLicensePaths: [], acceptedLicenses: [] }, petUrlResolver);
assert.equal(unacceptedLocalPet.manifest.id, builtInPetManifest.id);
assert.ok(unacceptedLocalPet.fallbackReason?.includes("授权"));

resetPetActionPolicyPreferences();

type RuntimeEvent = {
  type: keyof DueFlowEventMap;
  payload: DueFlowEventMap[keyof DueFlowEventMap];
};

const events: RuntimeEvent[] = [];
const publish = <K extends keyof DueFlowEventMap>(type: K, payload: DueFlowEventMap[K]) => {
  events.push({ type, payload });
};
let currentTimeMs = Date.parse("2026-07-06T08:00:00.000Z");
const fixedNow = () => new Date(currentTimeMs);
const sleepNow = async (delayMs: number) => {
  currentTimeMs += delayMs;
};

resetPetActionRuntimeState();
const quickInputResult = await runPetAction("quick-input", {
  isDesktopRuntime: () => false,
  publish,
  now: fixedNow,
  sleep: sleepNow,
});
assert.equal(quickInputResult.ok, true);
assert.equal(quickInputResult.attempts, 1);
assert.deepEqual(events.map((event) => event.type), ["pet.action.started", "app.quick-input", "notice.show", "pet.action.finished"]);

events.length = 0;
resetPetActionRuntimeState();
const openMainResult = await runPetAction("open-main", {
  isDesktopRuntime: () => false,
  publish,
  now: fixedNow,
  sleep: sleepNow,
});
assert.equal(openMainResult.ok, false);
assert.equal(openMainResult.attempts, 1);
assert.equal(openMainResult.errorKind, "desktop_unavailable");
assert.equal(openMainResult.retryable, false);
assert.deepEqual(events.map((event) => event.type), ["pet.action.started", "pet.action.failed", "notice.show"]);
const openMainFailedEvent = events.find((event) => event.type === "pet.action.failed");
assert.equal(openMainFailedEvent && "errorKind" in openMainFailedEvent.payload ? openMainFailedEvent.payload.errorKind : null, "desktop_unavailable");

events.length = 0;
resetPetActionRuntimeState();
const invokedCommands: string[] = [];
const toggleResult = await runPetAction("toggle-pet", {
  isDesktopRuntime: () => true,
  invokeCommand: async (command) => {
    invokedCommands.push(command);
  },
  publish,
  now: fixedNow,
  sleep: sleepNow,
});
assert.equal(toggleResult.ok, true);
assert.equal(toggleResult.attempts, 1);
assert.deepEqual(invokedCommands, ["toggle_pet_window"]);
assert.deepEqual(events.map((event) => event.type), ["pet.action.started", "pet.action.finished"]);

events.length = 0;
resetPetActionRuntimeState();
let transientAttempt = 0;
const transientResult = await runPetAction("open-main", {
  isDesktopRuntime: () => true,
  invokeCommand: async () => {
    transientAttempt += 1;
    if (transientAttempt === 1) throw new Error("window command temporarily unavailable");
  },
  publish,
  now: fixedNow,
  sleep: sleepNow,
});
assert.equal(transientResult.ok, true);
assert.equal(transientResult.attempts, 2);
const retryEvent = events.find((event) => event.type === "pet.action.retrying");
assert.equal(retryEvent && "errorKind" in retryEvent.payload ? retryEvent.payload.errorKind : null, "transient_desktop");

events.length = 0;
resetPetActionRuntimeState();
let policyAttempt = 0;
const policyRetryResult = await runPetAction("open-main", {
  isDesktopRuntime: () => true,
  policyPreferences: { "open-main": { retryCount: 2, cooldownMs: 0 } },
  invokeCommand: async () => {
    policyAttempt += 1;
    if (policyAttempt < 3) throw new Error("window command temporarily unavailable");
  },
  publish,
  now: fixedNow,
  sleep: sleepNow,
});
assert.equal(policyRetryResult.ok, true);
assert.equal(policyRetryResult.attempts, 3);

events.length = 0;
resetPetActionRuntimeState();
const permissionResult = await runPetAction("open-main", {
  isDesktopRuntime: () => true,
  invokeCommand: async () => {
    throw new Error("permission denied by window plugin");
  },
  publish,
  now: fixedNow,
  sleep: sleepNow,
});
assert.equal(permissionResult.ok, false);
assert.equal(permissionResult.attempts, 1);
assert.equal(permissionResult.errorKind, "permission_denied");
assert.equal(permissionResult.retryable, false);
assert.deepEqual(events.map((event) => event.type), ["pet.action.started", "pet.action.failed", "notice.show"]);

events.length = 0;
resetPetActionRuntimeState();
await runPetAction("toggle-pet", {
  isDesktopRuntime: () => true,
  invokeCommand: async (command) => {
    invokedCommands.push(command);
  },
  publish,
  now: fixedNow,
  sleep: sleepNow,
});
events.length = 0;
const cooldownResult = await runPetAction("toggle-pet", {
  isDesktopRuntime: () => true,
  invokeCommand: async (command) => {
    invokedCommands.push(command);
  },
  publish,
  now: fixedNow,
  sleep: sleepNow,
});
assert.equal(cooldownResult.ok, false);
assert.equal(cooldownResult.blocked, true);
assert.equal(cooldownResult.reason, "cooldown");
assert.equal(cooldownResult.attempts, 0);
assert.deepEqual(events.map((event) => event.type), ["pet.action.blocked", "notice.show"]);

events.length = 0;
resetPetActionRuntimeState();
let releaseCommand: (() => void) | null = null;
const firstAction = runPetAction("toggle-pet", {
  isDesktopRuntime: () => true,
  invokeCommand: async () => {
    await new Promise<void>((resolve) => {
      releaseCommand = resolve;
    });
  },
  publish,
  now: fixedNow,
  sleep: sleepNow,
});
await Promise.resolve();
const busyResult = await runPetAction("toggle-pet", {
  isDesktopRuntime: () => true,
  publish,
  now: fixedNow,
  sleep: sleepNow,
});
assert.equal(busyResult.ok, false);
assert.equal(busyResult.reason, "busy");
assert.ok(events.some((event) => event.type === "pet.action.blocked"));
releaseCommand?.();
assert.equal((await firstAction).ok, true);

events.length = 0;
resetPetActionRuntimeState();
invokedCommands.length = 0;
let releaseQueuedCommand: (() => void) | null = null;
const firstQueuedAction = enqueuePetAction("toggle-pet", {
  requestId: "queue-first",
  isDesktopRuntime: () => true,
  invokeCommand: async (command) => {
    invokedCommands.push(command);
    await new Promise<void>((resolve) => {
      releaseQueuedCommand = resolve;
    });
  },
  publish,
  now: fixedNow,
  sleep: sleepNow,
});
await Promise.resolve();
const secondQueuedAction = enqueuePetAction("open-main", {
  requestId: "queue-second",
  isDesktopRuntime: () => true,
  invokeCommand: async (command) => {
    invokedCommands.push(command);
  },
  publish,
  now: fixedNow,
  sleep: sleepNow,
});
assert.ok(events.some((event) => event.type === "pet.action.queued" && "requestId" in event.payload && event.payload.requestId === "queue-second"));
releaseQueuedCommand?.();
assert.equal((await firstQueuedAction.result).ok, true);
assert.equal((await secondQueuedAction.result).ok, true);
assert.deepEqual(invokedCommands, ["toggle_pet_window", "show_main_window"]);
assert.ok(events.some((event) => event.type === "pet.action.started" && "requestId" in event.payload && event.payload.requestId === "queue-second"));

events.length = 0;
resetPetActionRuntimeState();
invokedCommands.length = 0;
let releaseCancelCommand: (() => void) | null = null;
const cancelFirstAction = enqueuePetAction("toggle-pet", {
  requestId: "cancel-first",
  isDesktopRuntime: () => true,
  invokeCommand: async (command) => {
    invokedCommands.push(command);
    await new Promise<void>((resolve) => {
      releaseCancelCommand = resolve;
    });
  },
  publish,
  now: fixedNow,
  sleep: sleepNow,
});
await Promise.resolve();
const cancelSecondAction = enqueuePetAction("open-main", {
  requestId: "cancel-second",
  isDesktopRuntime: () => true,
  invokeCommand: async (command) => {
    invokedCommands.push(command);
  },
  publish,
  now: fixedNow,
  sleep: sleepNow,
});
assert.equal(cancelQueuedPetAction("cancel-second", { publish, now: fixedNow }), true);
const cancelledResult = await cancelSecondAction.result;
assert.equal(cancelledResult.ok, false);
assert.equal(cancelledResult.cancelled, true);
assert.equal(cancelledResult.reason, "cancelled");
releaseCancelCommand?.();
assert.equal((await cancelFirstAction.result).ok, true);
assert.deepEqual(invokedCommands, ["toggle_pet_window"]);
assert.ok(events.some((event) => event.type === "pet.action.cancelled" && "requestId" in event.payload && event.payload.requestId === "cancel-second"));

const desktopUnavailable = classifyPetActionFailure(new Error("当前不在桌面运行时中，无法执行该桌宠动作。"));
assert.equal(desktopUnavailable.kind, "desktop_unavailable");
assert.equal(desktopUnavailable.retryable, false);
const deniedFailure = classifyPetActionFailure(new Error("Permission denied"));
assert.equal(deniedFailure.kind, "permission_denied");
assert.equal(deniedFailure.retryable, false);

assert.equal(DESKTOP_NOTICE_EVENT, "dueflow://notice");
assert.equal(DESKTOP_INTAKE_EVENT, "dueflow://intake");
await emitNoticeToPet({ message: "hello", tone: "info" });
await emitIntakeToMain({
  inbox_item: { id: "inbox-1" },
  extracted_tasks: [],
  requires_confirmation: false,
  pet_state: overview.pet_state,
} as IntakeResponse);
await emitIntakeToMain(
  {
    inbox_item: { id: "inbox-2" },
    extracted_tasks: [],
    requires_confirmation: false,
    pet_state: overview.pet_state,
  } as IntakeResponse,
  { targetView: "inbox", highlightInboxItemId: "inbox-2" },
);
const unlistenNotice = await listenForDesktopNotice(() => undefined);
const unlistenIntake = await listenForDesktopIntake(() => undefined);
assert.equal(typeof unlistenNotice, "function");
assert.equal(typeof unlistenIntake, "function");

assert.equal(shouldSendSystemNotice({ message: "普通提示", tone: "info" }), false);
assert.equal(shouldSendSystemNotice({ message: "需要处理", tone: "warning" }), true);
assert.equal(shouldSendSystemNotice({ message: "导出完成", tone: "success", system: true }), true);
assert.equal(shouldSendSystemNotice({ message: "隐藏提示", tone: "warning", system: false }), false);

const noticeStorage = new Map<string, string>();
const storage = {
  getItem: (key: string) => noticeStorage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    noticeStorage.set(key, value);
  },
};
const sentNotifications: Array<{ title: string; body: string; sound?: string }> = [];
resetSystemNoticePermissionCache();
const noticeDeps = {
  isDesktopRuntime: () => true,
  isPermissionGranted: async () => true,
  requestPermission: async () => "granted" as const,
  sendNotification: (options: { title: string; body: string; sound?: string }) => {
    sentNotifications.push(options);
  },
  storage,
  now: () => new Date("2026-07-07T08:00:00.000Z"),
};
assert.equal(await notifyFromNotice({ message: "导入失败", tone: "warning" }, noticeDeps), true);
assert.equal(await notifyFromNotice({ message: "导入失败", tone: "warning" }, noticeDeps), false);
assert.equal(sentNotifications.length, 1);
assert.equal(sentNotifications[0].title, "DueFlow 需要注意");
assert.equal(sentNotifications[0].body, "导入失败");
assert.equal(sentNotifications[0].sound, "Ping");
assert.equal(await notifyFromNotice({ message: "普通提示", tone: "info" }, noticeDeps), false);
assert.equal(await notifyFromNotice({ message: "后台已准备", tone: "info", system: true }, { ...noticeDeps, now: () => new Date("2026-07-07T08:06:00.000Z") }), true);
assert.equal(sentNotifications.length, 2);

const intakeDraftFeedback = summarizeIntakeResponse({
  inbox_item: { id: "draft-inbox", status: "pending" },
  extracted_tasks: [{ id: "task-1" }],
  requires_confirmation: true,
  pet_state: overview.pet_state,
} as IntakeResponse);
assert.equal(intakeDraftFeedback.targetView, "today");
assert.equal(intakeDraftFeedback.highlightInboxItemId, "draft-inbox");
assert.equal(intakeDraftFeedback.actionLabel, "查看草稿");
const duplicateFeedback = summarizeIntakeResponse({
  inbox_item: { id: "duplicate-inbox", status: "duplicate" },
  extracted_tasks: [],
  requires_confirmation: false,
  pet_state: overview.pet_state,
} as IntakeResponse);
assert.equal(duplicateFeedback.targetView, "inbox");
assert.equal(duplicateFeedback.tone, "warning");
assert.equal(duplicateFeedback.actionLabel, "定位 Inbox");
const failedFeedback = summarizeIntakeResponse({
  inbox_item: { id: "failed-inbox", status: "failed", error_message: "OCR 未识别到文字" },
  extracted_tasks: [],
  requires_confirmation: false,
  pet_state: overview.pet_state,
} as IntakeResponse);
assert.equal(failedFeedback.targetView, "inbox");
assert.ok(failedFeedback.message.includes("可在 Inbox 点击重试"));
assert.equal(failedFeedback.actionLabel, "定位 Inbox");
const emptyFeedback = summarizeIntakeResponse({
  inbox_item: { id: "empty-inbox", status: "pending" },
  extracted_tasks: [],
  requires_confirmation: false,
  pet_state: overview.pet_state,
} as IntakeResponse);
assert.equal(emptyFeedback.targetView, "inbox");
assert.ok(emptyFeedback.message.includes("重新抽取"));
assert.equal(summarizeIntakeError(new Error("unsupported file type: .zip")).reason, "unsupported");
assert.equal(summarizeIntakeError(new Error("uploaded file is empty")).reason, "empty");
assert.equal(summarizeIntakeError(new Error("file parsing failed: bad pdf")).reason, "parse");
assert.equal(summarizeIntakeError(new Error("Failed to fetch")).reason, "network");
assert.equal(appendDropFailureRetryHint("文件解析失败", 2), "文件解析失败 本轮第 2 次失败，可修正文件后重新拖入。");

const skillSummary = summarizeSkillRegistry();
assert.equal(skillSummary.total, 2);
assert.equal(skillSummary.enabled, 2);
assert.equal(skillSummary.externalCodeAllowed, false);
assert.ok(skillSummary.actionCount >= 4);
assert.deepEqual(validateSkillManifest(builtInSkillManifests[0]).errors, []);

const unsafeSkill = {
  ...builtInSkillManifests[0],
  id: "Unsafe Skill",
  allowExternalCode: true,
  permissions: ["pet.action", "filesystem.write"],
  actions: [
    {
      id: "unsafe.exec",
      title: "Unsafe",
      description: "Should not pass.",
      permissions: ["filesystem.write"],
      actionId: "shell.exec",
    },
  ],
} as unknown as SkillManifest;
const unsafeValidation = validateSkillManifest(unsafeSkill);
assert.equal(unsafeValidation.ok, false);
assert.ok(unsafeValidation.errors.some((error) => error.includes("External code")));
assert.ok(unsafeValidation.errors.some((error) => error.includes("Unsupported skill permission")));
assert.ok(unsafeValidation.errors.some((error) => error.includes("Unsupported action binding")));

const localAudit = auditLocalSkillScan({
  directory: "/tmp/dueflow-skills",
  entries: [
    {
      file_name: "valid.skill.json",
      path: "/tmp/dueflow-skills/valid.skill.json",
      manifest: { ...builtInSkillManifests[0], id: "local.valid", source: "local" },
      error: null,
    },
    {
      file_name: "invalid.skill.json",
      path: "/tmp/dueflow-skills/invalid.skill.json",
      manifest: { ...builtInSkillManifests[0], id: "Invalid Skill", source: "local" },
      error: null,
    },
    {
      file_name: "broken.skill.json",
      path: "/tmp/dueflow-skills/broken.skill.json",
      manifest: null,
      error: "invalid JSON",
    },
  ],
});
assert.equal(localAudit[0].validation.ok, true);
assert.equal(localAudit[0].enabled, true);
assert.equal(localAudit[1].validation.ok, false);
assert.equal(localAudit[2].validation.ok, false);
const disabledPreferences = setLocalSkillEnabled("/tmp/dueflow-skills/valid.skill.json", false, { disabledPaths: [] });
assert.deepEqual(loadLocalSkillPreferences(), disabledPreferences);
const disabledAudit = auditLocalSkillScan(
  {
    directory: "/tmp/dueflow-skills",
    entries: [localAudit[0]],
  },
  disabledPreferences,
);
assert.equal(disabledAudit[0].enabled, false);
assert.equal(disabledAudit[0].disabledByUser, true);
assert.deepEqual(setLocalSkillEnabled("/tmp/dueflow-skills/valid.skill.json", true, disabledPreferences), { disabledPaths: [] });
const describedSkill = describeSkillManifest(localAudit[0].manifest);
assert.equal(describedSkill?.id, "local.valid");
assert.equal(describedSkill?.actions.length, builtInSkillManifests[0].actions.length);
assert.ok(describedSkill?.permissions.includes("pet.action"));
assert.equal(describeSkillManifest(null), null);
const visibleActions = listVisibleSkillActions(localAudit);
const visibleSummary = summarizeVisibleSkillActions(visibleActions);
assert.ok(visibleSummary.total > builtInSkillManifests[0].actions.length);
assert.ok(visibleSummary.executable >= builtInSkillManifests[0].actions.length);
assert.ok(visibleSummary.localReadOnly >= builtInSkillManifests[0].actions.length);
assert.ok(visibleActions.some((action) => action.source === "local" && action.executable === false && action.localPath?.endsWith("valid.skill.json")));
assert.ok(visibleActions.some((action) => action.source === "builtin" && action.actionId === "open-main" && action.executable));
assert.ok(visibleActions.some((action) => action.source === "builtin" && action.actionId === "pet-drop-file" && !action.executable));
await assert.rejects(() => openLocalSkillDirectory(), /浏览器开发态/);
await assert.rejects(() => openLocalPetAppearanceDirectory(), /浏览器开发态/);
