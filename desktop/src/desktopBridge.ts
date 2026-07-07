import { isTauriRuntime } from "./platform";
import type { IntakeResponse } from "./types";

export const DESKTOP_NOTICE_EVENT = "dueflow://notice";
export const DESKTOP_INTAKE_EVENT = "dueflow://intake";

export type DesktopNoticePayload = {
  message: string;
  tone: "info" | "success" | "warning";
  source: "main" | "pet";
};

export type DesktopIntakePayload = {
  response: IntakeResponse;
  source: "pet-drop";
  targetView?: "today" | "inbox";
  highlightInboxItemId?: string;
};

export async function emitNoticeToPet(payload: Omit<DesktopNoticePayload, "source">): Promise<void> {
  if (!isTauriRuntime()) return;
  const { emitTo } = await import("@tauri-apps/api/event");
  await emitTo<DesktopNoticePayload>("pet", DESKTOP_NOTICE_EVENT, { ...payload, source: "main" });
}

export async function listenForDesktopNotice(handler: (payload: DesktopNoticePayload) => void): Promise<() => void> {
  if (!isTauriRuntime()) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  return listen<DesktopNoticePayload>(DESKTOP_NOTICE_EVENT, (event) => handler(event.payload));
}

export async function emitIntakeToMain(
  response: IntakeResponse,
  options: Pick<DesktopIntakePayload, "targetView" | "highlightInboxItemId"> = {},
): Promise<void> {
  if (!isTauriRuntime()) return;
  const { emitTo } = await import("@tauri-apps/api/event");
  await emitTo<DesktopIntakePayload>("main", DESKTOP_INTAKE_EVENT, { response, source: "pet-drop", ...options });
}

export async function listenForDesktopIntake(handler: (payload: DesktopIntakePayload) => void): Promise<() => void> {
  if (!isTauriRuntime()) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  return listen<DesktopIntakePayload>(DESKTOP_INTAKE_EVENT, (event) => handler(event.payload));
}
