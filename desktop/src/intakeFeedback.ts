import type { IntakeResponse } from "./types";

export type IntakeFeedback = {
  message: string;
  tone: "info" | "warning";
  targetView: "schedule" | "control";
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
      message: `已识别 ${response.extracted_tasks.length} 个 DDL，正在加入日程。`,
      tone: "info",
      targetView: "schedule",
      highlightInboxItemId: inboxId,
      actionLabel: "看日程",
    };
  }

  if (response.inbox_item.status === "duplicate") {
    return {
      message: "这份内容已处理过，不会重复生成日程。",
      tone: "warning",
      targetView: "control",
      highlightInboxItemId: inboxId,
      actionLabel: "看记录",
    };
  }

  if (response.inbox_item.status === "failed") {
    const message = response.inbox_item.error_message || "文件解析或识别失败。";
    return {
      message: `${message} 可在控制中心重试。`,
      tone: "warning",
      targetView: "control",
      highlightInboxItemId: inboxId,
      actionLabel: "看记录",
    };
  }

  return {
    message: "没有识别到明确 DDL，可在控制中心查看输入记录。",
    tone: "warning",
    targetView: "control",
    highlightInboxItemId: inboxId,
    actionLabel: "看记录",
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
