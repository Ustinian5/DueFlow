import type { Overview } from "./types";

export const QUICK_INPUT_TAURI_EVENT = "dueflow://quick-input";

export type QuickInputSource = "keyboard" | "tray" | "pet" | "internal";

export type DueFlowEventMap = {
  "app.quick-input": { source: QuickInputSource };
  "overview.updated": { overview: Overview; source: "initial" | "refresh" | "intake" | "confirm" | "edit" | "status" | "export" | "pet" };
  "notice.show": { message: string; tone: "info" | "success" | "warning"; key?: string; system?: boolean };
  "pet.action.queued": { actionId: string; title: string; requestId: string; queuedAt: string; position: number };
  "pet.action.cancelled": { actionId: string; title: string; requestId: string; cancelledAt: string; reason: "user" };
  "pet.action.started": { actionId: string; title: string; requestId?: string; startedAt: string; attempt: number; maxAttempts: number };
  "pet.action.retrying": { actionId: string; title: string; requestId?: string; error: string; errorKind: "desktop_unavailable" | "permission_denied" | "transient_desktop" | "unknown"; attempt: number; nextAttempt: number; retryAt: string };
  "pet.action.finished": { actionId: string; title: string; requestId?: string; finishedAt: string; attempt: number };
  "pet.action.failed": { actionId: string; title: string; requestId?: string; error: string; errorKind: "desktop_unavailable" | "permission_denied" | "transient_desktop" | "unknown"; retryable: boolean; failedAt: string; attempt: number; maxAttempts: number };
  "pet.action.blocked": { actionId: string; title: string; requestId?: string; reason: "busy" | "cooldown"; message: string; retryAfterMs?: number; blockedAt: string };
};

type EventHandler<K extends keyof DueFlowEventMap> = (payload: DueFlowEventMap[K]) => void;

class DueFlowEventBus {
  private readonly subscribers = new Map<keyof DueFlowEventMap, Set<(payload: unknown) => void>>();

  publish<K extends keyof DueFlowEventMap>(type: K, payload: DueFlowEventMap[K]): void {
    for (const handler of this.subscribers.get(type) ?? []) {
      try {
        handler(payload);
      } catch {
        // Event subscribers are isolated so one failed plugin-like consumer cannot break the shell.
      }
    }
  }

  subscribe<K extends keyof DueFlowEventMap>(type: K, handler: EventHandler<K>): () => void {
    let handlers = this.subscribers.get(type);
    if (!handlers) {
      handlers = new Set();
      this.subscribers.set(type, handlers);
    }

    const wrapped = handler as (payload: unknown) => void;
    handlers.add(wrapped);

    return () => {
      handlers?.delete(wrapped);
      if (handlers?.size === 0) {
        this.subscribers.delete(type);
      }
    };
  }
}

export const dueFlowEvents = new DueFlowEventBus();
