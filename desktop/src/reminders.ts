import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { isTauriRuntime } from "./platform";
import type { Overview, RiskItem, TaskItem } from "./types";

type ReminderCandidate = {
  key: string;
  title: string;
  body: string;
  severity: "normal" | "medium" | "high";
};

const SENT_KEY = "dueflow.notification.sent.v1";
let permissionReady: boolean | null = null;
let permissionRequest: Promise<boolean> | null = null;

export async function notifyFromOverview(overview: Overview): Promise<void> {
  if (!isTauriRuntime()) return;

  const permissionGranted = await ensureNotificationPermission();
  if (!permissionGranted) return;

  const sent = readSentMap();
  const candidates = buildReminderCandidates(overview);

  for (const candidate of candidates) {
    if (sent[candidate.key]) continue;
    sent[candidate.key] = new Date().toISOString();
    writeSentMap(sent);
    sendNotification({
      id: notificationId(candidate.key),
      title: candidate.title,
      body: candidate.body,
      group: "dueflow-ddl",
      autoCancel: true,
      sound: candidate.severity === "high" ? "Ping" : undefined,
    });
  }
}

export function buildReminderCandidates(overview: Overview, now = new Date()): ReminderCandidate[] {
  const dayKey = toDateKey(now);
  const activeTasks = overview.tasks.filter((task) => task.status !== "done" && task.status !== "archived");
  const candidates: ReminderCandidate[] = [];

  const pendingInbox = overview.inbox.filter((item) => item.status === "pending");
  if (pendingInbox.length) {
    candidates.push({
      key: `inbox:${dayKey}:${pendingInbox.map((item) => item.id).join(",")}`,
      title: "DueFlow 有新信息待确认",
      body: `${pendingInbox.length} 条 Inbox 内容还没有确认生成任务。`,
      severity: "medium",
    });
  }

  for (const task of activeTasks) {
    const deadlineDate = parseDeadline(task.deadline);
    if (!deadlineDate) continue;

    const diffDays = dayDiff(now, deadlineDate);
    if (diffDays < 0) {
      candidates.push(taskReminder(task, `overdue:${dayKey}:${task.id}`, "DDL 已逾期", "请尽快处理或调整计划。", "high"));
    } else if (diffDays === 0) {
      candidates.push(taskReminder(task, `due-today:${dayKey}:${task.id}`, "今天有 DDL 截止", "建议优先完成最终检查和提交。", "high"));
    } else if (diffDays <= 3) {
      candidates.push(
        taskReminder(task, `due-soon:${dayKey}:${task.id}`, `${diffDays} 天后有 DDL`, "桌宠已把它列为近期关注事项。", "medium"),
      );
    }
  }

  for (const risk of overview.risks.filter((item) => item.severity === "high")) {
    const task = overview.tasks.find((item) => item.id === risk.task_id);
    candidates.push(riskReminder(risk, task, dayKey));
  }

  return candidates.slice(0, 5);
}

function taskReminder(
  task: TaskItem,
  key: string,
  title: string,
  suffix: string,
  severity: "medium" | "high",
): ReminderCandidate {
  const deadline = task.deadline ? `截止：${task.deadline}` : "截止时间待确认";
  return {
    key,
    title,
    body: `${task.title}。${deadline}。${suffix}`,
    severity,
  };
}

function riskReminder(risk: RiskItem, task: TaskItem | undefined, dayKey: string): ReminderCandidate {
  return {
    key: `risk:${dayKey}:${risk.id}`,
    title: "DueFlow 发现高风险 DDL",
    body: `${task?.title ?? "未关联任务"}：${risk.message} ${risk.suggestion}`.trim(),
    severity: "high",
  };
}

async function ensureNotificationPermission(): Promise<boolean> {
  if (permissionReady !== null) return permissionReady;
  if (permissionRequest) return permissionRequest;

  permissionRequest = (async () => {
    try {
      let granted = await isPermissionGranted();
      if (!granted && !localStorage.getItem("dueflow.notification.permission.requested")) {
        localStorage.setItem("dueflow.notification.permission.requested", new Date().toISOString());
        granted = (await requestPermission()) === "granted";
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

function readSentMap(): Record<string, string> {
  try {
    const value = localStorage.getItem(SENT_KEY);
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

function writeSentMap(sent: Record<string, string>) {
  const cutoff = Date.now() - 7 * 86_400_000;
  const compacted = Object.fromEntries(Object.entries(sent).filter(([, value]) => new Date(value).getTime() >= cutoff));
  localStorage.setItem(SENT_KEY, JSON.stringify(compacted));
}

function notificationId(key: string): number {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function parseDeadline(value: string | null): Date | null {
  if (!value) return null;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dayDiff(now: Date, target: Date): number {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const end = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  return Math.floor((end - start) / 86_400_000);
}

function toDateKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
