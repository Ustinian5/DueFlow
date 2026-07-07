import { isTauriRuntime } from "./platform";

type WindowDragEvent = {
  button: number;
  target: EventTarget | null;
  preventDefault: () => void;
};

export async function startWindowDrag(event: WindowDragEvent): Promise<void> {
  if (event.button !== 0 || !isTauriRuntime()) return;
  if (isInteractiveTarget(event.target)) return;
  event.preventDefault();
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().startDragging();
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("button,input,textarea,select,a,[data-no-window-drag]"));
}
