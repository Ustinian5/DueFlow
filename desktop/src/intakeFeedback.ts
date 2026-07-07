import type { IntakeResponse } from "./types";

export type IntakeFeedback = {
  message: string;
  tone: "info" | "warning";
  targetView: "today" | "inbox";
  highlightInboxItemId?: string;
  actionLabel: string;
};

export type IntakeErrorFeedback = {
  message: string;
  tone: "warning";
  reason: "unsupported" | "empty" | "parse" | "network" | "unknown";
};

export function summarizeIntakeResponse(response: IntakeResponse): IntakeFeedback {
  const inboxId = response.inbox_item.id;
  if (response.extracted_tasks.length > 0) {
    return {
      message: `识别到 ${response.extracted_tasks.length} 个任务草稿，请到主窗口确认。`,
      tone: "info",
      targetView: "today",
      highlightInboxItemId: inboxId,
      actionLabel: "查看草稿",
    };
  }

  if (response.inbox_item.status === "duplicate") {
    return {
      message: "这份内容与已有 Inbox 记录重复，已保留去重记录，不会重复生成任务。",
      tone: "warning",
      targetView: "inbox",
      highlightInboxItemId: inboxId,
      actionLabel: "定位 Inbox",
    };
  }

  if (response.inbox_item.status === "failed") {
    const message = response.inbox_item.error_message || "文件已进入 Inbox，但解析或抽取失败，请在 Inbox 查看原因。";
    return {
      message: `${message} 可在 Inbox 点击重试。`,
      tone: "warning",
      targetView: "inbox",
      highlightInboxItemId: inboxId,
      actionLabel: "定位 Inbox",
    };
  }

  return {
    message: "文件已进入 Inbox，但没有识别到可确认任务。可在 Inbox 中补充信息后重新抽取。",
    tone: "warning",
    targetView: "inbox",
    highlightInboxItemId: inboxId,
    actionLabel: "定位 Inbox",
  };
}

export function appendDropFailureRetryHint(message: string, failureCount: number): string {
  const normalizedCount = Math.max(1, Math.floor(failureCount));
  return `${message} 本轮第 ${normalizedCount} 次失败，可修正文件后重新拖入。`;
}

export function summarizeIntakeError(error: unknown): IntakeErrorFeedback {
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw || "文件识别失败";
  const lower = message.toLowerCase();

  if (lower.includes("unsupported file type")) {
    return {
      message: "暂不支持这种文件类型，请改用 PDF、图片、Markdown 或文本文件。",
      tone: "warning",
      reason: "unsupported",
    };
  }
  if (lower.includes("uploaded file is empty")) {
    return {
      message: "文件是空的，没有可识别内容。",
      tone: "warning",
      reason: "empty",
    };
  }
  if (lower.includes("file parsing failed")) {
    return {
      message: `文件解析失败：${message.replace(/^file parsing failed:\s*/i, "")}`,
      tone: "warning",
      reason: "parse",
    };
  }
  if (lower.includes("failed to fetch") || lower.includes("networkerror") || lower.includes("无法连接")) {
    return {
      message: "无法连接 DueFlow 本地服务，请确认桌面后端已经启动。",
      tone: "warning",
      reason: "network",
    };
  }

  return { message, tone: "warning", reason: "unknown" };
}
