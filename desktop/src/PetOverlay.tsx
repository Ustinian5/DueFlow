import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import { AlertTriangle, CalendarDays, ClipboardPaste, EyeOff, Loader2, Maximize2, X } from "lucide-react";
import { fetchOverview, intakeFile } from "./api";
import { emitIntakeToMain, listenForDesktopNotice } from "./desktopBridge";
import { dueFlowEvents } from "./eventBus";
import { appendDropFailureRetryHint, summarizeIntakeError, summarizeIntakeResponse } from "./intakeFeedback";
import type { IntakeFeedback } from "./intakeFeedback";
import {
  auditLocalPetAppearances,
  builtInPetManifest,
  loadLocalPetAppearancePreferences,
  loadLocalPetAppearanceScan,
  resolveActivePetAppearance,
  resolvePetAsset,
} from "./petManifest";
import type { PetAppearanceManifest } from "./petManifest";
import type { PetActionId } from "./petRuntime";
import { cancelQueuedPetAction, derivePetRuntimeSnapshot, enqueuePetAction } from "./petRuntime";
import { notifyFromOverview } from "./reminders";
import type { IntakeResponse, Overview } from "./types";

type ActionMessage = { text: string; tone: "info" | "warning" };

type RecentIntakeTarget = {
  response: IntakeResponse;
  targetView: "today" | "inbox";
  highlightInboxItemId?: string;
  actionLabel: string;
};

export function PetOverlay() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [isWaiting, setIsWaiting] = useState(true);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [queuedActions, setQueuedActions] = useState<Array<{ requestId: string; actionId: string; title: string }>>([]);
  const [actionMessage, setActionMessage] = useState<ActionMessage | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [petManifest, setPetManifest] = useState<PetAppearanceManifest>(builtInPetManifest);
  const [recentIntakeTarget, setRecentIntakeTarget] = useState<RecentIntakeTarget | null>(null);
  const [dropFailureCount, setDropFailureCount] = useState(0);
  const lastPetFallbackReasonRef = useRef<string | null>(null);

  useEffect(() => {
    document.body.classList.add("pet-body");
    return () => document.body.classList.remove("pet-body");
  }, []);

  useEffect(() => {
    let isCancelled = false;

    async function load() {
      try {
        const nextOverview = await fetchOverview();
        if (!isCancelled) {
          setOverview(nextOverview);
          setIsWaiting(false);
          void notifyFromOverview(nextOverview);
        }
      } catch {
        if (!isCancelled) {
          setIsWaiting(true);
        }
      }
    }

    void load();
    const timer = window.setInterval(() => void load(), 10_000);

    return () => {
      isCancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    async function loadPetAppearance() {
      try {
        const scan = await loadLocalPetAppearanceScan();
        const preferences = loadLocalPetAppearancePreferences();
        const active = resolveActivePetAppearance(auditLocalPetAppearances(scan), preferences);
        if (!isCancelled) {
          setPetManifest(active.manifest);
          if (active.fallbackReason && active.fallbackReason !== lastPetFallbackReasonRef.current) {
            lastPetFallbackReasonRef.current = active.fallbackReason;
            setActionMessage({ text: active.fallbackReason, tone: "warning" });
          } else if (!active.fallbackReason) {
            lastPetFallbackReasonRef.current = null;
          }
        }
      } catch {
        if (!isCancelled) {
          setPetManifest(builtInPetManifest);
        }
      }
    }

    void loadPetAppearance();
    const timer = window.setInterval(() => void loadPetAppearance(), 5_000);

    return () => {
      isCancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let clearTimer: number | undefined;

    const clearLater = (delayMs = 3200) => {
      if (clearTimer) window.clearTimeout(clearTimer);
      clearTimer = window.setTimeout(() => setActionMessage(null), delayMs);
    };

    const showMessage = (text: string, tone: "info" | "warning", delayMs?: number) => {
      setActionMessage({ text, tone });
      clearLater(delayMs);
    };

    const unsubscribeQueued = dueFlowEvents.subscribe("pet.action.queued", ({ requestId, actionId, title, position }) => {
      setQueuedActions((current) => {
        if (current.some((item) => item.requestId === requestId)) return current;
        return [...current, { requestId, actionId, title }];
      });
      showMessage(`${title}已加入队列，第 ${position} 个执行。`, "info", 2400);
    });
    const unsubscribeCancelled = dueFlowEvents.subscribe("pet.action.cancelled", ({ requestId, title }) => {
      setQueuedActions((current) => current.filter((item) => item.requestId !== requestId));
      showMessage(`${title}已取消。`, "info", 2200);
    });
    const unsubscribeStarted = dueFlowEvents.subscribe("pet.action.started", ({ actionId, requestId, title }) => {
      setActiveAction(actionId);
      if (requestId) {
        setQueuedActions((current) => current.filter((item) => item.requestId !== requestId));
      }
      setActionMessage({ text: `${title}中...`, tone: "info" });
    });
    const unsubscribeFinished = dueFlowEvents.subscribe("pet.action.finished", ({ actionId, title }) => {
      setActiveAction((current) => (current === actionId ? null : current));
      showMessage(`${title}完成`, "info");
    });
    const unsubscribeRetrying = dueFlowEvents.subscribe("pet.action.retrying", ({ actionId, title, nextAttempt }) => {
      setActiveAction(actionId);
      setActionMessage({ text: `${title}失败，正在进行第 ${nextAttempt} 次尝试...`, tone: "warning" });
    });
    const unsubscribeFailed = dueFlowEvents.subscribe("pet.action.failed", ({ actionId, error }) => {
      setActiveAction((current) => (current === actionId ? null : current));
      showMessage(error, "warning");
    });
    const unsubscribeBlocked = dueFlowEvents.subscribe("pet.action.blocked", ({ message }) => {
      showMessage(message, "warning", 2400);
    });
    let unlistenDesktopNotice: (() => void) | undefined;
    void listenForDesktopNotice(({ message, tone }) => {
      showMessage(message, tone === "success" ? "info" : tone);
    }).then((cleanup) => {
      unlistenDesktopNotice = cleanup;
    });

    return () => {
      if (clearTimer) window.clearTimeout(clearTimer);
      unsubscribeQueued();
      unsubscribeCancelled();
      unsubscribeStarted();
      unsubscribeFinished();
      unsubscribeRetrying();
      unsubscribeFailed();
      unsubscribeBlocked();
      unlistenDesktopNotice?.();
    };
  }, []);

  const pet = derivePetRuntimeSnapshot(overview, isWaiting);
  const petAsset = resolvePetAsset(pet.stateClass, petManifest);
  const bubbleText = actionMessage?.text ?? pet.message;

  return (
    <main
      className={`pet-overlay ${pet.severityClass} ${isDraggingFile ? "dragging-file" : ""}`}
      data-tauri-drag-region
      onDragOver={(event) => handleDragOver(event, setIsDraggingFile)}
      onDragLeave={(event) => handleDragLeave(event, setIsDraggingFile)}
      onDrop={(event) => void handleDrop(
        event,
        dropFailureCount,
        setIsDraggingFile,
        setOverview,
        setIsWaiting,
        setActionMessage,
        setRecentIntakeTarget,
        setDropFailureCount,
      )}
    >
      <section className="pet-stage" data-tauri-drag-region>
        <div className={`floating-pet ${pet.stateClass}`} data-tauri-drag-region>
          <img src={petAsset} alt="DueFlow 桌宠" draggable={false} data-tauri-drag-region />
        </div>
        <div
          className={`floating-bubble ${actionMessage?.tone ?? ""} ${recentIntakeTarget ? "actionable" : ""}`}
          data-tauri-drag-region={recentIntakeTarget ? undefined : true}
        >
          <strong>{overview ? pet.label : "启动中"}</strong>
          <span>{bubbleText}</span>
          {recentIntakeTarget && (
            <button
              className="bubble-action"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                void focusRecentIntake(recentIntakeTarget);
              }}
            >
              <Maximize2 size={13} />
              {recentIntakeTarget.actionLabel}
            </button>
          )}
        </div>
      </section>

      <section className="pet-quick-status">
        <div>
          <CalendarDays size={15} />
          <span>{pet.pendingTasks}</span>
        </div>
        <div className={pet.highRiskCount ? "danger" : ""}>
          <AlertTriangle size={15} />
          <span>{pet.highRiskCount}</span>
        </div>
      </section>

      <section className="pet-actions">
        <button title="打开 DueFlow" disabled={activeAction === "open-main"} onClick={() => handlePetAction("open-main")}>
          {activeAction === "open-main" || isWaiting ? <Loader2 className="spin" size={16} /> : <Maximize2 size={16} />}
        </button>
        <button title="快速输入" disabled={activeAction === "quick-input"} onClick={() => handlePetAction("quick-input")}>
          {activeAction === "quick-input" ? <Loader2 className="spin" size={16} /> : <ClipboardPaste size={16} />}
        </button>
        <button title="隐藏桌宠" disabled={activeAction === "toggle-pet"} onClick={() => handlePetAction("toggle-pet")}>
          {activeAction === "toggle-pet" ? <Loader2 className="spin" size={16} /> : <EyeOff size={16} />}
        </button>
      </section>
      {queuedActions.length > 0 && (
        <button className="pet-queue-cancel" type="button" onClick={() => cancelQueuedPetAction(queuedActions[0].requestId)}>
          <X size={14} />
          取消等待：{queuedActions[0].title}{queuedActions.length > 1 ? ` +${queuedActions.length - 1}` : ""}
        </button>
      )}
    </main>
  );
}

function handlePetAction(actionId: PetActionId) {
  void enqueuePetAction(actionId).result;
}

async function focusRecentIntake(target: RecentIntakeTarget) {
  await enqueuePetAction("open-main").result;
  await emitIntakeToMain(target.response, { targetView: target.targetView, highlightInboxItemId: target.highlightInboxItemId });
}

function handleDragOver(event: DragEvent<HTMLElement>, setIsDraggingFile: (value: boolean) => void) {
  if (!event.dataTransfer.types.includes("Files")) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  setIsDraggingFile(true);
}

function handleDragLeave(event: DragEvent<HTMLElement>, setIsDraggingFile: (value: boolean) => void) {
  if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
  event.preventDefault();
  setIsDraggingFile(false);
}

async function handleDrop(
  event: DragEvent<HTMLElement>,
  dropFailureCount: number,
  setIsDraggingFile: (value: boolean) => void,
  setOverview: (value: Overview) => void,
  setIsWaiting: (value: boolean) => void,
  setActionMessage: (value: ActionMessage | null) => void,
  setRecentIntakeTarget: (value: RecentIntakeTarget | null) => void,
  setDropFailureCount: (value: number) => void,
) {
  event.preventDefault();
  setIsDraggingFile(false);
  const file = event.dataTransfer.files.item(0);
  if (!file) return;

  setActionMessage({ text: "正在识别拖入的文件...", tone: "info" });
  setRecentIntakeTarget(null);
  try {
    const response = await intakeFile(file, true);
    const nextOverview = await fetchOverview();
    const feedback = summarizeIntakeResponse(response);
    const target = buildRecentIntakeTarget(response, feedback);
    setOverview(nextOverview);
    setIsWaiting(false);
    setDropFailureCount(0);
    setActionMessage({ text: feedback.message, tone: feedback.tone });
    setRecentIntakeTarget(target);
    await focusRecentIntake(target);
  } catch (error) {
    const feedback = summarizeIntakeError(error);
    const nextFailureCount = dropFailureCount + 1;
    setDropFailureCount(nextFailureCount);
    setRecentIntakeTarget(null);
    setActionMessage({ text: appendDropFailureRetryHint(feedback.message, nextFailureCount), tone: "warning" });
  }
}

function buildRecentIntakeTarget(response: IntakeResponse, feedback: IntakeFeedback): RecentIntakeTarget {
  return {
    response,
    targetView: feedback.targetView,
    highlightInboxItemId: feedback.highlightInboxItemId,
    actionLabel: feedback.actionLabel,
  };
}
