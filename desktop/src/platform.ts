import { invoke } from "@tauri-apps/api/core";

export function isTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

export async function invokeDesktopCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) {
    throw new Error("当前不在 Tauri 桌面运行时中。");
  }
  return invoke<T>(command, args);
}
