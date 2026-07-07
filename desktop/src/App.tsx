import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, RefObject } from "react";
import { isPermissionGranted } from "@tauri-apps/plugin-notification";
import {
  AlertTriangle,
  Check,
  ClipboardPaste,
  Clock3,
  Download,
  FileText,
  Loader2,
  Pencil,
  RefreshCw,
  Settings as SettingsIcon,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";
import {
  createDatabaseBackup,
  createDiagnosticsExport,
  createExport,
  extractInboxItem,
  fetchAbout,
  fetchConfig,
  fetchDatabaseBackups,
  fetchOverview,
  fetchSelfCheck,
  intakeFile,
  intakeText,
  resolveDownloadUrl,
  restoreDatabaseBackup,
  updateTask,
  updateTaskStatus,
} from "./api";
import { emitNoticeToPet, listenForDesktopIntake, listenForDesktopNavigate } from "./desktopBridge";
import { dueFlowEvents, QUICK_INPUT_TAURI_EVENT } from "./eventBus";
import { summarizeIntakeResponse } from "./intakeFeedback";
import { startWindowDrag } from "./windowDrag";
import {
  auditLocalPetAppearances,
  builtInPetManifest,
  getPetLicenseAcceptanceRecord,
  hasAcceptedPetLicense,
  importLocalPetAppearance,
  loadLocalPetAppearancePreferences,
  loadLocalPetAppearanceScan,
  materializeLocalPetAppearance,
  openLocalPetAppearanceDirectory,
  resolveActivePetAppearance,
  resolveLocalPetThumbnailAsset,
  resolvePetAsset,
  setLocalPetAppearanceSelected,
} from "./petManifest";
import type { LocalPetAppearanceAuditEntry, LocalPetAppearancePreferenceState, LocalPetAppearanceScanResult, PetLicenseAcceptanceRecord } from "./petManifest";
import {
  derivePetRuntimeSnapshot,
  loadPetActionPolicyPreferences,
  petActionDescriptors,
  resetPetActionPolicyPreferences,
  resolvePetActionDescriptor,
  runPetAction,
  setPetActionPolicyPreference,
} from "./petRuntime";
import type { PetActionId, PetActionPolicyPreferences } from "./petRuntime";
import { invokeDesktopCommand, isTauriRuntime } from "./platform";
import { notifyFromOverview } from "./reminders";
import { notifyFromNotice } from "./systemNotice";
import {
  auditLocalSkillScan,
  describeSkillManifest,
  listVisibleSkillActions,
  loadLocalSkillPreferences,
  loadLocalSkillScan,
  openLocalSkillDirectory,
  setLocalSkillEnabled,
  summarizeSkillRegistry,
  summarizeVisibleSkillActions,
} from "./skillRegistry";
import type { LocalSkillAuditEntry, LocalSkillPreferenceState, LocalSkillScanResult, VisibleSkillAction } from "./skillRegistry";
import type { BackendStatus, DatabaseBackupResult, DesktopAbout, DesktopConfig, DiagnosticsExportResult, ExportResult, IntakeResponse, Overview, PlanItem, RiskItem, SelfCheckResult, TaskItem } from "./types";

type ViewKey = "schedule" | "control";

const sourceOptions = [
  { value: "manual", label: "手动输入" },
  { value: "clipboard", label: "剪贴板" },
  { value: "screenshot", label: "截图文字" },
  { value: "upload", label: "文件内容" },
];

export function App() {
  const surfaceRole: ViewKey = new URLSearchParams(window.location.search).get("view") === "control" ? "control" : "schedule";
  const isControlSurface = surfaceRole === "control";
  const [overview, setOverview] = useState<Overview | null>(null);
  const [activeView, setActiveView] = useState<ViewKey>(surfaceRole);
  const [title, setTitle] = useState("课程通知");
  const [content, setContent] = useState("");
  const [sourceType, setSourceType] = useState("manual");
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTasks, setEditingTasks] = useState<TaskItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [exportResults, setExportResults] = useState<Record<string, ExportResult>>({});
  const [exportingType, setExportingType] = useState<string | null>(null);
  const [databaseBackup, setDatabaseBackup] = useState<DatabaseBackupResult | null>(null);
  const [databaseBackups, setDatabaseBackups] = useState<DatabaseBackupResult[]>([]);
  const [isBackingUpDatabase, setIsBackingUpDatabase] = useState(false);
  const [restoringDatabaseFileName, setRestoringDatabaseFileName] = useState<string | null>(null);
  const [diagnosticsExport, setDiagnosticsExport] = useState<DiagnosticsExportResult | null>(null);
  const [isExportingDiagnostics, setIsExportingDiagnostics] = useState(false);
  const [config, setConfig] = useState<DesktopConfig | null>(null);
  const [about, setAbout] = useState<DesktopAbout | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [selfCheck, setSelfCheck] = useState<SelfCheckResult | null>(null);
  const [selfCheckError, setSelfCheckError] = useState<string | null>(null);
  const [highlightedInboxItemId, setHighlightedInboxItemId] = useState<string | null>(null);
  const [isConfigLoading, setIsConfigLoading] = useState(false);
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null);
  const [backendStatusError, setBackendStatusError] = useState<string | null>(null);
  const [scheduleSurfaceMode, setScheduleSurfaceMode] = useState<string>("floating");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const contentInputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const bodyClass = isControlSurface ? "control-body" : "schedule-body";
    document.body.classList.add(bodyClass);
    return () => document.body.classList.remove(bodyClass);
  }, [isControlSurface]);

  function applyOverviewSnapshot(nextOverview: Overview, source: "initial" | "refresh" | "intake" | "confirm" | "edit" | "status" | "export") {
    setOverview(nextOverview);
    dueFlowEvents.publish("overview.updated", { overview: nextOverview, source });
  }

  useEffect(() => {
    let isCancelled = false;

    async function loadInitialOverview() {
      while (!isCancelled) {
        try {
          const nextOverview = await fetchOverview();
          if (!isCancelled) {
            applyOverviewSnapshot(nextOverview, "initial");
            setError(null);
          }
          return;
        } catch {
          if (!isCancelled) {
            setError("正在等待 DueFlow 本地服务启动...");
          }
          await delay(1500);
        }
      }
    }

    void loadInitialOverview();
    void refreshConfig();
    void refreshBackendStatus();
    void refreshScheduleSurfaceMode();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const unsubscribeQuickInput = dueFlowEvents.subscribe("app.quick-input", () => {
      focusQuickInput();
    });

    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        dueFlowEvents.publish("app.quick-input", { source: "keyboard" });
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    if (isTauriRuntime()) {
      void import("@tauri-apps/api/event")
        .then(({ listen }) => listen(QUICK_INPUT_TAURI_EVENT, () => dueFlowEvents.publish("app.quick-input", { source: "tray" })))
        .then((cleanup) => {
          unlisten = cleanup;
        })
        .catch(() => {
          unlisten = undefined;
        });
    }

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      unsubscribeQuickInput();
      if (unlisten) {
        void unlisten();
      }
    };
  }, []);

  useEffect(() => dueFlowEvents.subscribe("overview.updated", ({ overview: nextOverview }) => {
    void notifyFromOverview(nextOverview);
  }), []);

  useEffect(() => dueFlowEvents.subscribe("notice.show", ({ message }) => {
    setNotice(message);
  }), []);

  useEffect(() => dueFlowEvents.subscribe("notice.show", ({ message, tone }) => {
    void emitNoticeToPet({ message, tone });
  }), []);

  useEffect(() => dueFlowEvents.subscribe("notice.show", (payload) => {
    void notifyFromNotice(payload);
  }), []);

  useEffect(() => {
    let unlistenDesktopIntake: (() => void) | undefined;

    void listenForDesktopIntake(({ response, targetView, highlightInboxItemId }) => {
      setActiveView(targetView ?? (response.extracted_tasks.length ? "schedule" : "control"));
      setHighlightedInboxItemId(highlightInboxItemId ?? response.inbox_item.id);
      setError(null);
      setNotice(null);
      setEditingTaskId(null);
      setEditingTasks([]);
      void applyIntakeResponse(response, "没有识别到明确 DDL，可在控制中心查看原始输入。", { preserveView: true });
    }).then((cleanup) => {
      unlistenDesktopIntake = cleanup;
    });

    return () => {
      unlistenDesktopIntake?.();
    };
  }, []);

  useEffect(() => {
    let unlistenDesktopNavigate: (() => void) | undefined;

    void listenForDesktopNavigate(({ targetView }) => {
      setActiveView(targetView);
      setEditingTaskId(null);
      setEditingTasks([]);
      setError(null);
      setNotice(null);
    }).then((cleanup) => {
      unlistenDesktopNavigate = cleanup;
    });

    return () => {
      unlistenDesktopNavigate?.();
    };
  }, []);

  async function refresh(source: "refresh" | "intake" | "confirm" | "edit" | "status" | "export" = "refresh") {
    setError(null);
    try {
      applyOverviewSnapshot(await fetchOverview(), source);
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法连接 DueFlow 本地服务");
    }
  }

  async function refreshConfig() {
    setIsConfigLoading(true);
    setConfigError(null);
    setSelfCheckError(null);
    try {
      const [nextConfig, nextAbout, nextSelfCheck, nextBackups] = await Promise.all([
        fetchConfig(),
        fetchAbout(),
        fetchSelfCheck(),
        fetchDatabaseBackups(),
      ]);
      setConfig(nextConfig);
      setAbout(nextAbout);
      setSelfCheck(nextSelfCheck);
      setDatabaseBackups(nextBackups.backups);
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : "无法读取本地配置");
      setSelfCheckError(err instanceof Error ? err.message : "无法运行本地自检");
    } finally {
      setIsConfigLoading(false);
    }
  }

  async function refreshBackendStatus() {
    if (!isTauriRuntime()) {
      setBackendStatus(null);
      setBackendStatusError("浏览器开发态无法读取 Tauri 后端启动状态。");
      return;
    }
    setBackendStatusError(null);
    try {
      setBackendStatus(await invokeDesktopCommand<BackendStatus>("get_backend_status"));
    } catch (err) {
      setBackendStatusError(err instanceof Error ? err.message : "无法读取后端启动状态");
    }
  }

  async function refreshScheduleSurfaceMode() {
    if (!isTauriRuntime()) {
      setScheduleSurfaceMode("browser");
      return;
    }
    try {
      setScheduleSurfaceMode(await invokeDesktopCommand<string>("get_schedule_surface_mode"));
    } catch {
      setScheduleSurfaceMode("floating");
    }
  }

  function expandScheduleSurface() {
    if (scheduleSurfaceMode !== "windows_drawer") return;
    void invokeDesktopCommand<void>("expand_schedule_window");
  }

  function collapseScheduleSurface() {
    if (scheduleSurfaceMode !== "windows_drawer") return;
    void invokeDesktopCommand<void>("collapse_schedule_window");
  }

  async function openControlCenter() {
    if (isTauriRuntime()) {
      await invokeDesktopCommand<void>("show_control_center");
      return;
    }
    setActiveView("control");
  }

  function focusQuickInput() {
    setActiveView("schedule");
    setEditingTaskId(null);
    setEditingTasks([]);
    dueFlowEvents.publish("notice.show", { message: "快速输入已就绪。", tone: "info" });
    window.setTimeout(() => contentInputRef.current?.focus(), 80);
  }

  async function applyIntakeResponse(response: IntakeResponse, emptyMessage: string, options: { preserveView?: boolean } = {}) {
    setOverview((current) => (current ? { ...current, pet_state: response.pet_state } : current));
    setHighlightedInboxItemId(response.inbox_item.id);
    if (response.extracted_tasks.length > 0) {
      setContent("");
      setNotice(null);
      if (!options.preserveView) setActiveView("schedule");
      dueFlowEvents.publish("notice.show", { message: `已自动加入 ${response.extracted_tasks.length} 条 DDL。`, tone: "success" });
      await refresh("confirm");
      return;
    }

    if (!options.preserveView) setActiveView("control");
    const feedback = summarizeIntakeResponse(response);
    dueFlowEvents.publish("notice.show", {
      message: response.inbox_item.status === "pending" ? emptyMessage : feedback.message,
      tone: feedback.tone,
    });
    await refresh("intake");
  }

  async function handleExtract() {
    setIsLoading(true);
    setError(null);
    setNotice(null);
    try {
      const response = await intakeText({
        title,
        content,
        source_type: sourceType,
        auto_extract: true,
      });
      await applyIntakeResponse(response, "没有识别到明确 DDL，请补充截止时间或提交要求。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "抽取失败");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleFile(file: File) {
    setIsLoading(true);
    setError(null);
    setNotice(null);
    try {
      const response = await intakeFile(file, true);
      await applyIntakeResponse(response, "文件已记录，但没有识别到明确 DDL。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "文件识别失败");
    } finally {
      setIsLoading(false);
      setIsDraggingFile(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function handleExtractInbox(inboxItemId: string) {
    setIsLoading(true);
    setError(null);
    setNotice(null);
    try {
      const response = await extractInboxItem(inboxItemId);
      await applyIntakeResponse(response, "这个输入没有识别到明确 DDL。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Inbox 抽取失败");
    } finally {
      setIsLoading(false);
    }
  }

  function focusInboxItem(inboxItemId: string) {
    setActiveView("control");
    setHighlightedInboxItemId(inboxItemId);
  }

  function beginEditTask(task: TaskItem) {
    setNotice(null);
    setEditingTaskId(task.id);
    setEditingTasks([{ ...task, deliverables: [...task.deliverables], missing_info: [...task.missing_info] }]);
  }

  async function handleSaveEdit() {
    if (!editingTaskId || editingTasks.length === 0) return;
    setIsLoading(true);
    setError(null);
    try {
      await updateTask(editingTaskId, editingTasks[0]);
      setEditingTaskId(null);
      setEditingTasks([]);
      dueFlowEvents.publish("notice.show", { message: "任务已更新，计划和风险已重新计算。", tone: "success" });
      await refresh("edit");
    } catch (err) {
      setError(err instanceof Error ? err.message : "任务更新失败");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleStatus(taskId: string, status: string) {
    setError(null);
    try {
      await updateTaskStatus(taskId, status);
      await refresh("status");
    } catch (err) {
      setError(err instanceof Error ? err.message : "状态更新失败");
    }
  }

  async function handleExport(exportType: string) {
    setError(null);
    setNotice(null);
    setExportingType(exportType);
    try {
      const result = await createExport(exportType);
      setExportResults((current) => ({ ...current, [exportType]: result }));
      dueFlowEvents.publish("notice.show", { message: `${result.file_name} 已生成，可以下载或在本地 exports 目录查看。`, tone: "success" });
      await refresh("export");
    } catch (err) {
      setError(err instanceof Error ? err.message : "导出失败");
    } finally {
      setExportingType(null);
    }
  }

  async function handleDatabaseBackup() {
    setError(null);
    setNotice(null);
    setIsBackingUpDatabase(true);
    try {
      const result = await createDatabaseBackup();
      setDatabaseBackup(result);
      setDatabaseBackups((current) => [result, ...current.filter((item) => item.file_name !== result.file_name)]);
      dueFlowEvents.publish("notice.show", { message: `${result.file_name} 已生成，可以下载或在本地 backups 目录查看。`, tone: "success" });
      await refreshConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : "数据库备份失败");
    } finally {
      setIsBackingUpDatabase(false);
    }
  }

  async function handleDatabaseRestore(fileName: string) {
    const confirmed = window.confirm(`恢复数据库会用 ${fileName} 覆盖当前数据。恢复前会自动生成一个当前数据库备份。是否继续？`);
    if (!confirmed) return;
    setError(null);
    setNotice(null);
    setRestoringDatabaseFileName(fileName);
    try {
      const result = await restoreDatabaseBackup(fileName);
      setDatabaseBackup(result.safety_backup);
      dueFlowEvents.publish("notice.show", {
        message: `已从 ${result.restored_from.file_name} 恢复数据库，恢复前备份为 ${result.safety_backup.file_name}。`,
        tone: "success",
      });
      await Promise.all([refresh("refresh"), refreshConfig()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "数据库恢复失败");
    } finally {
      setRestoringDatabaseFileName(null);
    }
  }

  async function handleDiagnosticsExport() {
    setError(null);
    setNotice(null);
    setIsExportingDiagnostics(true);
    try {
      const result = await createDiagnosticsExport();
      setDiagnosticsExport(result);
      dueFlowEvents.publish("notice.show", { message: `${result.file_name} 已生成，可以下载用于排障。`, tone: "success" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "诊断报告导出失败");
    } finally {
      setIsExportingDiagnostics(false);
    }
  }

  const tasks = overview?.tasks ?? [];
  const plans = overview?.plans ?? [];
  const risks = overview?.risks ?? [];
  const todayPlans = useMemo(() => plans.filter((plan) => plan.date === todayKey()), [plans]);
  const weekPlans = useMemo(() => plans.filter((plan) => isWithinDays(plan.date, 7)), [plans]);
  const activeTasks = tasks.filter((task) => task.status !== "done" && task.status !== "archived");
  const highRisks = risks.filter((risk) => risk.severity === "high");

  return (
    <main
      className={`shell ${scheduleSurfaceMode} ${isControlSurface ? "control-surface" : "schedule-surface"}`}
      onMouseEnter={expandScheduleSurface}
      onMouseLeave={collapseScheduleSurface}
    >
      <section className="workspace">
        <header className="topbar" onPointerDown={(event) => void startWindowDrag(event)}>
          <div data-tauri-drag-region>
            <h1>{activeView === "schedule" ? "DDL 清单" : "控制中心"}</h1>
            <p>{activeView === "schedule" ? "只显示最需要关注的截止事项。" : "必要设置、少量修正和基础排错。"}</p>
          </div>
          <div className="topbar-actions">
            {!isControlSurface && (
              <button className="icon-button" onClick={() => void openControlCenter()} title="控制中心">
                <SettingsIcon size={18} />
              </button>
            )}
            <button className="icon-button" onClick={() => void refresh("refresh")} title="刷新">
              <RefreshCw size={18} />
            </button>
          </div>
        </header>

        {error && (
          <div className="error-banner">
            <AlertTriangle size={18} />
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <div className="notice-banner">
            <ShieldCheck size={18} />
            <span>{notice}</span>
          </div>
        )}

        <section className="content-grid compact-product">
          <div className="primary-column">
            {editingTaskId && (
              <TaskEditPanel
                tasks={editingTasks}
                inboxTitle="编辑任务"
                isLoading={isLoading}
                onTasksChange={setEditingTasks}
                onSave={() => void handleSaveEdit()}
                onCancel={() => {
                  setEditingTaskId(null);
                  setEditingTasks([]);
                }}
              />
            )}
            <ViewPanel
              activeView={activeView}
              tasks={tasks}
              plans={plans}
              risks={risks}
              inbox={overview?.inbox ?? []}
              highlightedInboxItemId={highlightedInboxItemId}
              isLoading={isLoading}
              exportingType={exportingType}
              exportResults={exportResults}
              databaseBackup={databaseBackup}
              databaseBackups={databaseBackups}
              isBackingUpDatabase={isBackingUpDatabase}
              restoringDatabaseFileName={restoringDatabaseFileName}
              diagnosticsExport={diagnosticsExport}
              isExportingDiagnostics={isExportingDiagnostics}
              config={config}
              about={about}
              configError={configError}
              selfCheck={selfCheck}
              selfCheckError={selfCheckError}
              backendStatus={backendStatus}
              backendStatusError={backendStatusError}
              isConfigLoading={isConfigLoading}
              onOpenControlCenter={() => void openControlCenter()}
              onExtractInbox={(inboxItemId) => void handleExtractInbox(inboxItemId)}
              onFocusInboxItem={focusInboxItem}
              onEditTask={beginEditTask}
              onExport={(exportType) => void handleExport(exportType)}
              onDatabaseBackup={() => void handleDatabaseBackup()}
              onDatabaseRestore={(fileName) => void handleDatabaseRestore(fileName)}
              onDiagnosticsExport={() => void handleDiagnosticsExport()}
              onRefreshConfig={() => {
                void refreshConfig();
                void refreshBackendStatus();
              }}
              onStatus={(taskId, status) => void handleStatus(taskId, status)}
            />
            {activeView === "schedule" && !isControlSurface && (
              <IntakePanel
                title={title}
                content={content}
                sourceType={sourceType}
                isLoading={isLoading}
                isDraggingFile={isDraggingFile}
                fileInputRef={fileInputRef}
                contentInputRef={contentInputRef}
                onTitleChange={setTitle}
                onContentChange={setContent}
                onSourceChange={setSourceType}
                onExtract={() => void handleExtract()}
                onFile={(file) => void handleFile(file)}
                onFileDrag={setIsDraggingFile}
              />
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

function PetPanel({ overview }: { overview: Overview | null }) {
  const pet = derivePetRuntimeSnapshot(overview);
  const petAsset = resolvePetAsset(pet.stateClass, builtInPetManifest);
  return (
    <section className={`pet-panel ${pet.severityClass}`}>
      <div className={`pet-avatar ${pet.stateClass}`}>
        <img src={petAsset} alt="DueFlow 桌宠" />
      </div>
      <div className="pet-bubble">
        <strong>{overview ? pet.label : "连接中"}</strong>
        <span>{overview ? pet.message : "正在读取本地日程状态。"}</span>
      </div>
    </section>
  );
}

function IntakePanel(props: {
  title: string;
  content: string;
  sourceType: string;
  isLoading: boolean;
  isDraggingFile: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  contentInputRef: RefObject<HTMLTextAreaElement | null>;
  onTitleChange: (value: string) => void;
  onContentChange: (value: string) => void;
  onSourceChange: (value: string) => void;
  onExtract: () => void;
  onFile: (file: File) => void;
  onFileDrag: (value: boolean) => void;
}) {
  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    props.onFileDrag(false);
    const file = event.dataTransfer.files.item(0);
    if (file) {
      props.onFile(file);
    }
  }

  return (
    <section className="panel intake-panel">
      <div className="panel-title">
        <div>
          <h2>快速添加</h2>
          <p>粘贴文字或拖入文件，系统会自动识别并加入日程。</p>
        </div>
        <ClipboardPaste size={22} />
      </div>
      <div className="input-row">
        <input value={props.title} onChange={(event) => props.onTitleChange(event.target.value)} placeholder="标题" />
        <select value={props.sourceType} onChange={(event) => props.onSourceChange(event.target.value)}>
          {sourceOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <textarea
        ref={props.contentInputRef}
        value={props.content}
        onChange={(event) => props.onContentChange(event.target.value)}
        placeholder="把课程通知、比赛公告、邮件正文或截图识别文字粘贴到这里。"
      />
      <div
        className={props.isDraggingFile ? "file-drop active" : "file-drop"}
        onDragOver={(event) => {
          event.preventDefault();
          props.onFileDrag(true);
        }}
        onDragLeave={() => props.onFileDrag(false)}
        onDrop={handleDrop}
      >
        <UploadCloud size={22} />
        <div>
          <strong>拖拽文件到这里</strong>
          <span>.txt / .md / .pdf / 截图图片会自动识别 DDL。</span>
        </div>
        <button type="button" className="secondary-action" onClick={() => props.fileInputRef.current?.click()}>
          选择文件
        </button>
        <input
          ref={props.fileInputRef}
          type="file"
          accept=".txt,.md,.pdf,.png,.jpg,.jpeg,.webp,.tif,.tiff,text/plain,text/markdown,application/pdf,image/png,image/jpeg,image/webp,image/tiff"
          hidden
          onChange={(event) => {
            const file = event.target.files?.item(0);
            if (file) {
              props.onFile(file);
            }
          }}
        />
      </div>
      <button className="primary-action" onClick={props.onExtract} disabled={props.isLoading || !props.content.trim()}>
        {props.isLoading ? <Loader2 className="spin" size={18} /> : <FileText size={18} />}
        <span>快速添加</span>
      </button>
    </section>
  );
}

function TaskEditPanel(props: {
  tasks: TaskItem[];
  inboxTitle: string;
  isLoading: boolean;
  onTasksChange: (tasks: TaskItem[]) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  function updateTask(index: number, patch: Partial<TaskItem>) {
    props.onTasksChange(props.tasks.map((task, itemIndex) => (itemIndex === index ? { ...task, ...patch } : task)));
  }

  return (
    <section className="panel task-edit-panel">
      <div className="panel-title">
        <div>
          <h2>编辑任务</h2>
          <p>{props.inboxTitle}</p>
        </div>
        <ShieldCheck size={22} />
      </div>

      {props.tasks.map((task, index) => (
        <div className="task-editor" key={`${task.title}-${index}`}>
          <label>
            任务名称
            <input value={task.title} onChange={(event) => updateTask(index, { title: event.target.value })} />
          </label>
          <label>
            描述
            <textarea
              className="compact-textarea"
              value={task.description}
              onChange={(event) => updateTask(index, { description: event.target.value })}
              placeholder="任务背景、目标或范围"
            />
          </label>
          <div className="input-row">
            <label>
              截止时间
              <input
                value={task.deadline ?? ""}
                onChange={(event) => updateTask(index, { deadline: event.target.value || null })}
                placeholder="2026-06-30 23:59"
              />
            </label>
            <label>
              截止时间置信度
              <select
                value={task.deadline_confidence}
                onChange={(event) => updateTask(index, { deadline_confidence: event.target.value })}
              >
                <option value="high">high</option>
                <option value="medium">medium</option>
                <option value="low">low</option>
              </select>
            </label>
          </div>
          <div className="input-row">
            <label>
              优先级
              <select value={task.priority} onChange={(event) => updateTask(index, { priority: event.target.value })}>
                <option value="high">high</option>
                <option value="medium">medium</option>
                <option value="low">low</option>
              </select>
            </label>
            <label>
              地点/平台
              <input
                value={task.location ?? ""}
                onChange={(event) => updateTask(index, { location: event.target.value || null })}
                placeholder="课程平台 / GitHub / 线下地点"
              />
            </label>
          </div>
          <label>
            提交物
            <input
              value={task.deliverables.join("、")}
              onChange={(event) => updateTask(index, { deliverables: splitList(event.target.value) })}
              placeholder="README.md、PDF、代码仓库"
            />
          </label>
          <label>
            提交方式
            <input
              value={task.submit_method ?? ""}
              onChange={(event) => updateTask(index, { submit_method: event.target.value || null })}
            />
          </label>
          <label>
            缺失信息
            <input
              value={task.missing_info.join("、")}
              onChange={(event) => updateTask(index, { missing_info: splitList(event.target.value) })}
              placeholder="截止时间、提交方式、提交物"
            />
          </label>
          <label>
            状态
            <select value={task.status} onChange={(event) => updateTask(index, { status: event.target.value })}>
              <option value="todo">todo</option>
              <option value="doing">doing</option>
              <option value="done">done</option>
              <option value="archived">archived</option>
            </select>
          </label>
          <label>
            原文依据
            <textarea
              className="compact-textarea"
              value={task.source_quote}
              onChange={(event) => updateTask(index, { source_quote: event.target.value })}
            />
          </label>
        </div>
      ))}

      <div className="action-row">
        <button className="secondary-action" onClick={props.onCancel}>
          取消
        </button>
        <button className="primary-action" onClick={props.onSave} disabled={props.isLoading || props.tasks.length === 0}>
          <Check size={18} />
          <span>保存</span>
        </button>
      </div>
    </section>
  );
}

function ViewPanel(props: {
  activeView: ViewKey;
  tasks: TaskItem[];
  plans: PlanItem[];
  risks: RiskItem[];
  inbox: Overview["inbox"];
  highlightedInboxItemId: string | null;
  isLoading: boolean;
  exportingType: string | null;
  exportResults: Record<string, ExportResult>;
  databaseBackup: DatabaseBackupResult | null;
  databaseBackups: DatabaseBackupResult[];
  isBackingUpDatabase: boolean;
  restoringDatabaseFileName: string | null;
  diagnosticsExport: DiagnosticsExportResult | null;
  isExportingDiagnostics: boolean;
  config: DesktopConfig | null;
  about: DesktopAbout | null;
  configError: string | null;
  selfCheck: SelfCheckResult | null;
  selfCheckError: string | null;
  backendStatus: BackendStatus | null;
  backendStatusError: string | null;
  isConfigLoading: boolean;
  onOpenControlCenter: () => void;
  onExtractInbox: (inboxItemId: string) => void;
  onFocusInboxItem: (inboxItemId: string) => void;
  onEditTask: (task: TaskItem) => void;
  onExport: (exportType: string) => void;
  onDatabaseBackup: () => void;
  onDatabaseRestore: (fileName: string) => void;
  onDiagnosticsExport: () => void;
  onRefreshConfig: () => void;
  onStatus: (taskId: string, status: string) => void;
}) {
  const highlightedInboxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (props.activeView !== "control" || !props.highlightedInboxItemId) return;
    const timer = window.setTimeout(() => {
      highlightedInboxRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [props.activeView, props.highlightedInboxItemId]);

  if (props.activeView === "control") {
    return (
      <ControlCenterPanel
        tasks={props.tasks}
        inbox={props.inbox}
        highlightedInboxItemId={props.highlightedInboxItemId}
        highlightedInboxRef={highlightedInboxRef}
        isLoading={props.isLoading}
        config={props.config}
        about={props.about}
        configError={props.configError}
        selfCheck={props.selfCheck}
        selfCheckError={props.selfCheckError}
        backendStatus={props.backendStatus}
        backendStatusError={props.backendStatusError}
        onEditTask={props.onEditTask}
        onExtractInbox={props.onExtractInbox}
        onFocusInboxItem={props.onFocusInboxItem}
        onRefreshConfig={props.onRefreshConfig}
        onStatus={props.onStatus}
      />
    );
  }

  return (
    <ScheduleList tasks={props.tasks} onOpenControlCenter={props.onOpenControlCenter} onStatus={props.onStatus} />
  );
}

function ScheduleList({
  tasks,
  onOpenControlCenter,
  onStatus,
}: {
  tasks: TaskItem[];
  onOpenControlCenter: () => void;
  onStatus: (taskId: string, status: string) => void;
}) {
  const ddlItems = tasks
    .filter((task) => task.status !== "done" && task.status !== "archived")
    .map((task) => ({ task, meta: deriveDdlMeta(task) }))
    .sort((left, right) => right.meta.score - left.meta.score)
    .slice(0, 6);

  return (
    <section className="panel schedule-panel">
      <PanelHeading title="极简 DDL 清单" subtitle="按紧急程度和重要性排序。" />
      <div className="ddl-list">
        {ddlItems.map(({ task, meta }) => (
          <article className={`ddl-item ${meta.tone}`} key={task.id} onClick={onOpenControlCenter}>
            <div className="ddl-title">
              <strong>{shortTitle(task.title)}</strong>
              <span className="importance-pill">{importanceLabel(task.priority)}</span>
            </div>
            <time>{formatDeadline(task.deadline)}</time>
            <span className="remaining-time">{meta.remainingLabel}</span>
            <button
              className="complete-check"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onStatus(task.id, "done");
              }}
              title="完成"
            >
              <Check size={15} />
            </button>
          </article>
        ))}
        {!ddlItems.length && <EmptyState text="当前没有需要关注的 DDL。" />}
      </div>
      {tasks.filter((task) => task.status !== "done" && task.status !== "archived").length > 6 && (
        <button className="schedule-more" type="button" onClick={onOpenControlCenter}>更多事项在控制中心查看</button>
      )}
    </section>
  );
}

function ControlCenterPanel({
  tasks,
  inbox,
  highlightedInboxItemId,
  highlightedInboxRef,
  isLoading,
  config,
  about,
  configError,
  selfCheck,
  selfCheckError,
  backendStatus,
  backendStatusError,
  onEditTask,
  onExtractInbox,
  onFocusInboxItem,
  onRefreshConfig,
  onStatus,
}: {
  tasks: TaskItem[];
  inbox: Overview["inbox"];
  highlightedInboxItemId: string | null;
  highlightedInboxRef: RefObject<HTMLDivElement | null>;
  isLoading: boolean;
  config: DesktopConfig | null;
  about: DesktopAbout | null;
  configError: string | null;
  selfCheck: SelfCheckResult | null;
  selfCheckError: string | null;
  backendStatus: BackendStatus | null;
  backendStatusError: string | null;
  onEditTask: (task: TaskItem) => void;
  onExtractInbox: (inboxItemId: string) => void;
  onFocusInboxItem: (inboxItemId: string) => void;
  onRefreshConfig: () => void;
  onStatus: (taskId: string, status: string) => void;
}) {
  const activeTasks = tasks.filter((task) => task.status !== "done" && task.status !== "archived");
  const recentInbox = inbox.slice(0, 5);

  return (
    <div className="control-center">
      <section className="panel">
        <PanelHeading title="事件修正" subtitle="只在自动结果不符合预期时使用。" />
        <div className="row-list">
          {activeTasks.slice(0, 8).map((task) => (
            <div className="data-row compact-event-row" key={task.id}>
              <div className="row-main">
                <strong>{shortTitle(task.title)}</strong>
                <span>{importanceLabel(task.priority)} / {formatDeadline(task.deadline)} / {deriveDdlMeta(task).remainingLabel}</span>
              </div>
              <span className="compact-actions">
                <button className="row-action" onClick={() => onEditTask(task)}>
                  <Pencil size={15} />
                  修正
                </button>
                <button className="row-action" onClick={() => onStatus(task.id, "done")}>
                  <Check size={15} />
                  完成
                </button>
              </span>
            </div>
          ))}
          {!activeTasks.length && <EmptyState text="没有需要修正的事件。" />}
        </div>
      </section>

      <section className="panel">
        <PanelHeading title="原始输入" subtitle="保留最近输入，便于重新识别或排查。" />
        <div className="row-list">
          {recentInbox.map((item) => (
            <div
              className={item.id === highlightedInboxItemId ? "data-row inbox-row highlighted" : "data-row inbox-row"}
              key={item.id}
              ref={item.id === highlightedInboxItemId ? highlightedInboxRef : undefined}
            >
              <div className="row-main">
                <div className="row-title-line">
                  <strong>{item.title}</strong>
                  <span className={`status-pill ${item.status}`}>{inboxStatusLabel(item.status)}</span>
                </div>
                <span>{item.source_type} / {item.received_at}</span>
                <p>{item.content.slice(0, 96)}</p>
                {item.error_message && <small className="row-error">{item.error_message}</small>}
              </div>
              {item.status === "pending" || item.status === "failed" ? (
                <button className="row-action" disabled={isLoading} onClick={() => onExtractInbox(item.id)}>
                  {isLoading ? <Loader2 className="spin" size={15} /> : <FileText size={15} />}
                  重新识别
                </button>
              ) : item.status === "duplicate" && item.duplicate_of ? (
                <button className="row-action" type="button" onClick={() => onFocusInboxItem(item.duplicate_of!.id)}>
                  原始
                </button>
              ) : null}
            </div>
          ))}
          {!recentInbox.length && <EmptyState text="暂无原始输入。" />}
        </div>
      </section>

      <section className="panel control-status-panel">
        <PanelHeading title="基础状态" subtitle="只显示影响日常使用的必要状态。" />
        <div className="settings-grid compact-control-grid">
          <section className="settings-card">
            <div className="settings-card-title">
              <strong>服务</strong>
              <button className="row-action" onClick={onRefreshConfig}>
                <RefreshCw size={15} />
                刷新
              </button>
            </div>
            <StatusLine label="API" value={configError ? "异常" : config ? "正常" : "读取中"} tone={configError ? "danger" : "normal"} />
            <StatusLine label="模型" value={config?.llm_provider ?? "-"} />
            <StatusLine label="OCR" value={ocrModeLabel(config?.ocr_mode)} tone={config?.ocr_mode === "unavailable" ? "danger" : "normal"} />
            {configError && <p className="settings-error">{configError}</p>}
          </section>
          <section className="settings-card">
            <div className="settings-card-title">
              <strong>桌面</strong>
            </div>
            <StatusLine label="快捷键" value="CommandOrControl+Shift+D" />
            <StatusLine label="后端" value={backendStatusLabel(backendStatus?.state, backendStatusError)} tone={backendStatusError ? "danger" : "normal"} />
            <StatusLine label="版本" value={about?.api_version ?? "-"} />
            {(backendStatusError || selfCheckError) && <p className="settings-error">{backendStatusError ?? selfCheckError}</p>}
          </section>
          <section className="settings-card">
            <div className="settings-card-title">
              <strong>数据与隐私</strong>
            </div>
            <StatusLine label="本地自检" value={selfCheck ? selfCheckStatusLabel(selfCheck) : "读取中"} tone={selfCheck?.status === "error" ? "danger" : "normal"} />
            <StatusLine label="数据位置" value={config?.database_path ? "本机存储" : "-"} />
            <p className="settings-note">输入和日程默认保存在本机。复杂备份和诊断不放入日常入口。</p>
          </section>
        </div>
      </section>
    </div>
  );
}

function SettingsPanel({
  config,
  about,
  configError,
  selfCheck,
  selfCheckError,
  databaseBackup,
  databaseBackups,
  isBackingUpDatabase,
  restoringDatabaseFileName,
  diagnosticsExport,
  isExportingDiagnostics,
  backendStatus,
  backendStatusError,
  isLoading,
  onDatabaseBackup,
  onDatabaseRestore,
  onDiagnosticsExport,
  onRefresh,
}: {
  config: DesktopConfig | null;
  about: DesktopAbout | null;
  configError: string | null;
  selfCheck: SelfCheckResult | null;
  selfCheckError: string | null;
  databaseBackup: DatabaseBackupResult | null;
  databaseBackups: DatabaseBackupResult[];
  isBackingUpDatabase: boolean;
  restoringDatabaseFileName: string | null;
  diagnosticsExport: DiagnosticsExportResult | null;
  isExportingDiagnostics: boolean;
  backendStatus: BackendStatus | null;
  backendStatusError: string | null;
  isLoading: boolean;
  onDatabaseBackup: () => void;
  onDatabaseRestore: (fileName: string) => void;
  onDiagnosticsExport: () => void;
  onRefresh: () => void;
}) {
  const [notificationState, setNotificationState] = useState<string>("checking");
  const [localSkillScan, setLocalSkillScan] = useState<LocalSkillScanResult | null>(null);
  const [localSkillError, setLocalSkillError] = useState<string | null>(null);
  const [isLocalSkillLoading, setIsLocalSkillLoading] = useState(false);
  const [localSkillPreferences, setLocalSkillPreferences] = useState<LocalSkillPreferenceState>(() => loadLocalSkillPreferences());
  const [expandedLocalSkillPath, setExpandedLocalSkillPath] = useState<string | null>(null);
  const [actionSourceFilter, setActionSourceFilter] = useState<"all" | "builtin" | "local">("all");
  const [localPetScan, setLocalPetScan] = useState<LocalPetAppearanceScanResult | null>(null);
  const [localPetError, setLocalPetError] = useState<string | null>(null);
  const [isLocalPetLoading, setIsLocalPetLoading] = useState(false);
  const [importingLocalPetPath, setImportingLocalPetPath] = useState<string | null>(null);
  const [expandedLocalPetPath, setExpandedLocalPetPath] = useState<string | null>(null);
  const [localPetPreferences, setLocalPetPreferences] = useState<LocalPetAppearancePreferenceState>(() => loadLocalPetAppearancePreferences());
  const [petActionPolicies, setPetActionPolicies] = useState<PetActionPolicyPreferences>(() => loadPetActionPolicyPreferences());

  useEffect(() => {
    let isCancelled = false;

    async function loadNotificationState() {
      if (!isTauriRuntime()) {
        setNotificationState("browser-dev");
        return;
      }
      try {
        const granted = await isPermissionGranted();
        if (!isCancelled) {
          setNotificationState(granted ? "granted" : "not-granted");
        }
      } catch {
        if (!isCancelled) {
          setNotificationState("unavailable");
        }
      }
    }

    void loadNotificationState();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    async function loadSkills() {
      setIsLocalSkillLoading(true);
      setLocalSkillError(null);
      try {
        const scan = await loadLocalSkillScan();
        if (!isCancelled) {
          setLocalSkillScan(scan);
        }
      } catch (err) {
        if (!isCancelled) {
          setLocalSkillError(err instanceof Error ? err.message : "无法扫描本地技能目录");
        }
      } finally {
        if (!isCancelled) {
          setIsLocalSkillLoading(false);
        }
      }
    }

    void loadSkills();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    async function loadPets() {
      setIsLocalPetLoading(true);
      setLocalPetError(null);
      try {
        const scan = await loadLocalPetAppearanceScan();
        if (!isCancelled) {
          setLocalPetScan(scan);
        }
      } catch (err) {
        if (!isCancelled) {
          setLocalPetError(err instanceof Error ? err.message : "无法扫描本地桌宠形象目录");
        }
      } finally {
        if (!isCancelled) {
          setIsLocalPetLoading(false);
        }
      }
    }

    void loadPets();

    return () => {
      isCancelled = true;
    };
  }, []);

  const skillSummary = summarizeSkillRegistry();
  const localSkillAudit = localSkillScan ? auditLocalSkillScan(localSkillScan, localSkillPreferences) : [];
  const invalidLocalSkillCount = localSkillAudit.filter((entry) => !entry.validation.ok).length;
  const enabledLocalSkillCount = localSkillAudit.filter((entry) => entry.enabled).length;
  const disabledLocalSkillCount = localSkillAudit.filter((entry) => entry.disabledByUser).length;
  const visibleActions = listVisibleSkillActions(localSkillAudit);
  const visibleActionSummary = summarizeVisibleSkillActions(visibleActions);
  const filteredVisibleActions = visibleActions.filter((action) => actionSourceFilter === "all" || action.source === actionSourceFilter);
  const localPetAudit = localPetScan ? auditLocalPetAppearances(localPetScan) : [];
  const validLocalPetCount = localPetAudit.filter((entry) => entry.validation.ok).length;
  const invalidLocalPetCount = localPetAudit.filter((entry) => !entry.validation.ok).length;
  const petWarningCount = localPetAudit.reduce((count, entry) => count + entry.validation.warnings.length, 0);
  const activePetAppearance = resolveActivePetAppearance(localPetAudit, localPetPreferences);

  async function refreshLocalSkills() {
    setIsLocalSkillLoading(true);
    setLocalSkillError(null);
    try {
      setLocalSkillScan(await loadLocalSkillScan());
    } catch (err) {
      setLocalSkillError(err instanceof Error ? err.message : "无法扫描本地技能目录");
    } finally {
      setIsLocalSkillLoading(false);
    }
  }

  async function openSkillsDirectory() {
    setLocalSkillError(null);
    try {
      await openLocalSkillDirectory();
      dueFlowEvents.publish("notice.show", { message: "本地技能目录已打开。", tone: "info" });
    } catch (err) {
      setLocalSkillError(err instanceof Error ? err.message : "无法打开本地技能目录");
    }
  }

  async function refreshLocalPets() {
    setIsLocalPetLoading(true);
    setLocalPetError(null);
    try {
      setLocalPetScan(await loadLocalPetAppearanceScan());
    } catch (err) {
      setLocalPetError(err instanceof Error ? err.message : "无法扫描本地桌宠形象目录");
    } finally {
      setIsLocalPetLoading(false);
    }
  }

  async function openPetsDirectory() {
    setLocalPetError(null);
    try {
      await openLocalPetAppearanceDirectory();
      dueFlowEvents.publish("notice.show", { message: "本地桌宠形象目录已打开。", tone: "info" });
    } catch (err) {
      setLocalPetError(err instanceof Error ? err.message : "无法打开本地桌宠形象目录");
    }
  }

  async function useLocalPetAppearance(entry: LocalPetAppearanceAuditEntry) {
    if (!entry.validation.ok) {
      dueFlowEvents.publish("notice.show", { message: "该桌宠形象校验失败，不能启用。", tone: "warning" });
      return;
    }
    setImportingLocalPetPath(entry.path);
    setLocalPetError(null);
    try {
      const imported = await importLocalPetAppearance(entry.path);
      setLocalPetPreferences((current) => setLocalPetAppearanceSelected(imported.path, true, current, entry.details?.license ?? null));
      setLocalPetScan(await loadLocalPetAppearanceScan());
      dueFlowEvents.publish("notice.show", { message: `${entry.details?.displayName || entry.file_name} 已导入并设为当前桌宠形象。`, tone: "success" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "无法导入本地桌宠形象";
      setLocalPetError(message);
      dueFlowEvents.publish("notice.show", { message, tone: "warning" });
    } finally {
      setImportingLocalPetPath(null);
    }
  }

  function resetPetAppearance() {
    setLocalPetPreferences((current) => setLocalPetAppearanceSelected(null, false, current));
    dueFlowEvents.publish("notice.show", { message: "已回退到内置桌宠形象。", tone: "info" });
  }

  function updateLocalSkillEnabled(path: string, enabled: boolean) {
    setLocalSkillPreferences((current) => setLocalSkillEnabled(path, enabled, current));
    dueFlowEvents.publish("notice.show", { message: enabled ? "本地 manifest 已启用。" : "本地 manifest 已禁用。", tone: "info" });
  }

  async function executeVisibleAction(action: VisibleSkillAction) {
    if (!action.executable || !action.actionId) {
      dueFlowEvents.publish("notice.show", { message: "本地 manifest 动作当前只读展示，不会执行第三方代码。", tone: "warning" });
      return;
    }

    const result = await runPetAction(action.actionId as PetActionId, { policyPreferences: petActionPolicies });
    if (result.ok) {
      dueFlowEvents.publish("notice.show", { message: `${action.title || action.id} 已执行。`, tone: "success" });
    }
  }

  function updatePetActionPolicy(actionId: PetActionId, patch: { cooldownMs?: number; retryCount?: number }) {
    setPetActionPolicies((current) => setPetActionPolicyPreference(actionId, patch, current));
    dueFlowEvents.publish("notice.show", { message: "桌宠动作策略已更新。", tone: "info" });
  }

  function resetPetActionPolicies() {
    setPetActionPolicies(resetPetActionPolicyPreferences());
    dueFlowEvents.publish("notice.show", { message: "桌宠动作策略已恢复默认。", tone: "info" });
  }

  return (
    <div className="settings-grid">
      <section className="settings-card">
        <div className="settings-card-title">
          <strong>本地服务</strong>
          <button className="row-action" onClick={onRefresh} disabled={isLoading}>
            {isLoading ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}
            刷新
          </button>
        </div>
        <StatusLine label="API" value={configError ? "异常" : config ? "正常" : "读取中"} tone={configError ? "danger" : "normal"} />
        {configError && <p className="settings-error">{configError}</p>}
        <StatusLine label="LLM Provider" value={config?.llm_provider ?? "-"} />
        <StatusLine
          label="本地自检"
          value={selfCheck ? selfCheckStatusLabel(selfCheck) : selfCheckError ? "失败" : "读取中"}
          tone={selfCheck?.status === "error" || selfCheckError ? "danger" : "normal"}
        />
        {selfCheckError && <p className="settings-error">{selfCheckError}</p>}
      </section>

      <section className="settings-card">
        <div className="settings-card-title">
          <strong>版本信息</strong>
          <button className="row-action" onClick={onDiagnosticsExport} disabled={isExportingDiagnostics || !about}>
            {isExportingDiagnostics ? <Loader2 className="spin" size={15} /> : <Download size={15} />}
            导出诊断
          </button>
        </div>
        <StatusLine label="API" value={about?.api_version ?? "-"} />
        <StatusLine label="Schema" value={about ? `${about.schema_version} / ${about.supported_schema_version}` : "-"} />
        <StatusLine label="Python" value={about?.python_version ?? "-"} />
        <StatusLine label="平台" value={about?.platform ?? "-"} />
        <StatusLine label="备份恢复" value={about?.capabilities.database_backup && about.capabilities.database_restore ? "可用" : "-"} />
        {diagnosticsExport && (
          <div className="export-result">
            <span>{diagnosticsExport.file_name}</span>
            <a href={resolveDownloadUrl(diagnosticsExport.download_url)} download={diagnosticsExport.file_name}>
              下载诊断
            </a>
          </div>
        )}
      </section>

      <section className="settings-card">
        <div className="settings-card-title">
          <strong>后端启动</strong>
        </div>
        <StatusLine
          label="状态"
          value={backendStatusLabel(backendStatus?.state, backendStatusError)}
          tone={backendStatus?.state === "error" || backendStatusError ? "danger" : "normal"}
        />
        <StatusLine label="来源" value={backendSourceLabel(backendStatus?.source)} />
        <StatusLine label="地址" value={backendStatus ? `${backendStatus.host}:${backendStatus.port}` : "-"} />
        {backendStatus?.command && <PathLine label="命令" value={backendStatus.command} />}
        {(backendStatus?.error || backendStatusError) && <p className="settings-error">{backendStatus?.error ?? backendStatusError}</p>}
      </section>

      <section className="settings-card">
        <div className="settings-card-title">
          <strong>数据目录</strong>
          <button className="row-action" onClick={onDatabaseBackup} disabled={isBackingUpDatabase || !config}>
            {isBackingUpDatabase ? <Loader2 className="spin" size={15} /> : <Download size={15} />}
            备份数据库
          </button>
        </div>
        <PathLine label="数据库" value={config?.database_path} />
        <PathLine label="Inbox" value={config?.inbox_path} />
        <PathLine label="导出" value={config?.export_path} />
        {databaseBackup && (
          <div className="export-result backup-result">
            <span>{databaseBackup.file_name}</span>
            <a href={resolveDownloadUrl(databaseBackup.download_url)} download={databaseBackup.file_name}>
              下载备份
            </a>
          </div>
        )}
        {databaseBackups.length > 0 && (
          <div className="backup-list">
            {databaseBackups.slice(0, 5).map((backup) => (
              <div className="backup-row" key={backup.file_name}>
                <div>
                  <strong>{backup.file_name}</strong>
                  <span>{formatFileSize(backup.bytes)} · {formatDateTime(backup.created_at)}</span>
                </div>
                <span className="backup-actions">
                  <a href={resolveDownloadUrl(backup.download_url)} download={backup.file_name}>
                    下载
                  </a>
                  <button className="text-action" onClick={() => onDatabaseRestore(backup.file_name)} disabled={Boolean(restoringDatabaseFileName)}>
                    {restoringDatabaseFileName === backup.file_name ? <Loader2 className="spin" size={13} /> : <RefreshCw size={13} />}
                    恢复
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
        {selfCheck && (
          <div className="self-check-list">
            {selfCheck.checks.slice(0, 7).map((check) => (
              <div className={`self-check-row ${check.status}`} key={check.id}>
                <strong>{check.label}</strong>
                <span>{check.message}</span>
                {check.path && <code>{check.path}</code>}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="settings-card">
        <div className="settings-card-title">
          <strong>输入能力</strong>
        </div>
        <StatusLine label="OCR" value={ocrModeLabel(config?.ocr_mode)} tone={config?.ocr_mode === "unavailable" ? "danger" : "normal"} />
        <StatusLine label="自定义 OCR" value={config?.ocr_command_configured ? "已配置" : "未配置"} />
        <StatusLine label="文本上限" value={config ? `${config.limits.max_text_chars.toLocaleString()} 字符` : "-"} />
        <StatusLine label="文件上限" value={config ? formatFileSize(config.limits.max_upload_bytes) : "-"} />
        <div className="file-type-list">
          {(config?.supported_file_types ?? []).map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-title">
          <strong>桌面能力</strong>
          <button className="row-action" onClick={() => void refreshLocalSkills()} disabled={isLocalSkillLoading}>
            {isLocalSkillLoading ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}
            技能扫描
          </button>
        </div>
        <StatusLine label="快捷输入" value="CommandOrControl+Shift+D" />
        <StatusLine label="系统通知" value={notificationLabel(notificationState)} tone={notificationState === "unavailable" ? "danger" : "normal"} />
        <StatusLine label="桌宠窗口" value="已启用" />
        <StatusLine label="桌宠形象" value={`${builtInPetManifest.displayName} ${builtInPetManifest.version}`} />
        <StatusLine label="本地技能" value={`${skillSummary.enabled}/${skillSummary.total} 启用，${skillSummary.actionCount} 个动作`} />
        <StatusLine label="可见动作" value={`${visibleActionSummary.total} 个，${visibleActionSummary.localReadOnly} 个本地只读`} />
        <StatusLine label="外部代码" value={skillSummary.externalCodeAllowed ? "允许" : "禁用"} tone={skillSummary.externalCodeAllowed ? "danger" : "normal"} />
        <StatusLine
          label="插件目录"
          value={localSkillScan ? `${enabledLocalSkillCount} 启用 / ${disabledLocalSkillCount} 禁用 / ${invalidLocalSkillCount} 异常` : localSkillError ? "扫描失败" : "扫描中"}
          tone={localSkillError || invalidLocalSkillCount ? "danger" : "normal"}
        />
        {localSkillScan && <PathLine label="目录" value={localSkillScan.directory} />}
        <button className="secondary-action" type="button" onClick={() => void openSkillsDirectory()}>
          打开插件目录
        </button>
        {localSkillError && <p className="settings-error">{localSkillError}</p>}
        <div className="local-skill-list">
          {localSkillAudit.slice(0, 5).map((entry) => (
            <LocalSkillAuditRow
              key={entry.path}
              entry={entry}
              expanded={expandedLocalSkillPath === entry.path}
              onToggleExpanded={() => setExpandedLocalSkillPath((current) => (current === entry.path ? null : entry.path))}
              onToggleEnabled={() => updateLocalSkillEnabled(entry.path, !entry.enabled)}
            />
          ))}
        </div>
        <div className="file-type-list">
          {skillSummary.permissions.map((item) => (
            <span key={item}>{skillPermissionLabel(item)}</span>
          ))}
        </div>
        <div className="action-filter-row" role="group" aria-label="可见动作来源筛选">
          <button className={actionSourceFilter === "all" ? "filter active" : "filter"} type="button" onClick={() => setActionSourceFilter("all")}>全部</button>
          <button className={actionSourceFilter === "builtin" ? "filter active" : "filter"} type="button" onClick={() => setActionSourceFilter("builtin")}>内置</button>
          <button className={actionSourceFilter === "local" ? "filter active" : "filter"} type="button" onClick={() => setActionSourceFilter("local")}>本地</button>
        </div>
        <div className="visible-action-list">
          {filteredVisibleActions.slice(0, 6).map((action) => (
            <VisibleActionRow key={`${action.source}:${action.skillId}:${action.id}`} action={action} onExecute={() => void executeVisibleAction(action)} />
          ))}
        </div>
        <div className="settings-card-title compact">
          <strong>动作策略</strong>
          <button className="row-action" type="button" onClick={resetPetActionPolicies}>
            重置
          </button>
        </div>
        <div className="visible-action-list">
          {petActionDescriptors.map((action) => (
            <PetActionPolicyRow
              key={action.id}
              actionId={action.id}
              policies={petActionPolicies}
              onUpdate={updatePetActionPolicy}
            />
          ))}
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-title">
          <strong>桌宠形象</strong>
          <button className="row-action" onClick={() => void refreshLocalPets()} disabled={isLocalPetLoading}>
            {isLocalPetLoading ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}
            形象扫描
          </button>
        </div>
        <StatusLine label="当前形象" value={`${activePetAppearance.manifest.displayName} ${activePetAppearance.manifest.version}`} />
        <StatusLine label="来源" value={activePetAppearance.sourcePath ? "本地形象" : "内置形象"} />
        <StatusLine label="授权" value={activePetAppearance.manifest.license} />
        <StatusLine
          label="本地形象"
          value={localPetScan ? `${validLocalPetCount} 有效 / ${invalidLocalPetCount} 异常 / ${petWarningCount} 警告` : localPetError ? "扫描失败" : "扫描中"}
          tone={localPetError || invalidLocalPetCount || petWarningCount ? "danger" : "normal"}
        />
        {activePetAppearance.fallbackReason && <p className="settings-error">{activePetAppearance.fallbackReason}</p>}
        {localPetScan && <PathLine label="目录" value={localPetScan.directory} />}
        <div className="settings-action-row">
          <button className="secondary-action" type="button" onClick={() => void openPetsDirectory()}>
            打开形象目录
          </button>
          {activePetAppearance.sourcePath && (
            <button className="secondary-action" type="button" onClick={resetPetAppearance}>
              回退内置
            </button>
          )}
        </div>
        {localPetError && <p className="settings-error">{localPetError}</p>}
        <div className="local-skill-list">
          {localPetAudit.slice(0, 5).map((entry) => (
            <LocalPetAppearanceRow
              key={entry.path}
              entry={entry}
              expanded={expandedLocalPetPath === entry.path}
              selected={activePetAppearance.sourcePath === entry.path}
              licenseAccepted={hasAcceptedPetLicense(entry.path, localPetPreferences)}
              licenseAcceptance={getPetLicenseAcceptanceRecord(entry.path, localPetPreferences)}
              importing={importingLocalPetPath === entry.path}
              onToggleExpanded={() => setExpandedLocalPetPath((current) => (current === entry.path ? null : entry.path))}
              onUse={() => void useLocalPetAppearance(entry)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function VisibleActionRow({ action, onExecute }: { action: VisibleSkillAction; onExecute: () => void }) {
  return (
    <div className="visible-action-row">
      <div>
        <strong>{action.title || action.id}</strong>
        <span>{action.skillName} / {action.source === "builtin" ? (action.executable ? "内置可执行" : "内置声明") : "本地只读"}</span>
        <small>{action.description || "无描述"}</small>
        <div className="visible-action-permissions">
          {action.permissions.length ? action.permissions.map((permission) => <span key={permission}>{skillPermissionLabel(permission)}</span>) : <span>无权限</span>}
        </div>
      </div>
      {action.executable ? (
        <button className="row-action" type="button" onClick={onExecute}>
          执行
        </button>
      ) : (
        <span className="readonly-badge">{action.source === "local" ? "只读" : "声明"}</span>
      )}
    </div>
  );
}

function PetActionPolicyRow({
  actionId,
  policies,
  onUpdate,
}: {
  actionId: PetActionId;
  policies: PetActionPolicyPreferences;
  onUpdate: (actionId: PetActionId, patch: { cooldownMs?: number; retryCount?: number }) => void;
}) {
  const descriptor = resolvePetActionDescriptor(actionId, policies);
  if (!descriptor) return null;
  const cooldownStep = 250;
  return (
    <div className="visible-action-row">
      <div>
        <strong>{descriptor.title}</strong>
        <span>{desktopPermissionCopy(descriptor.requiresDesktopRuntime)}</span>
        <small>{descriptor.description}</small>
      </div>
      <div className="policy-stepper" aria-label={`${descriptor.title}动作策略`}>
        <button className="row-action" type="button" onClick={() => onUpdate(actionId, { cooldownMs: descriptor.cooldownMs - cooldownStep })}>
          -冷却
        </button>
        <span>{descriptor.cooldownMs}ms</span>
        <button className="row-action" type="button" onClick={() => onUpdate(actionId, { cooldownMs: descriptor.cooldownMs + cooldownStep })}>
          +冷却
        </button>
        <button className="row-action" type="button" onClick={() => onUpdate(actionId, { retryCount: descriptor.retryCount - 1 })}>
          -重试
        </button>
        <span>{descriptor.retryCount} 次</span>
        <button className="row-action" type="button" onClick={() => onUpdate(actionId, { retryCount: descriptor.retryCount + 1 })}>
          +重试
        </button>
      </div>
    </div>
  );
}

function LocalSkillAuditRow({
  entry,
  expanded,
  onToggleExpanded,
  onToggleEnabled,
}: {
  entry: LocalSkillAuditEntry;
  expanded: boolean;
  onToggleExpanded: () => void;
  onToggleEnabled: () => void;
}) {
  const details = describeSkillManifest(entry.manifest);
  return (
    <div className="local-skill-item">
      <div className="local-skill-row">
        <p className={entry.validation.ok ? "settings-note" : "settings-error"}>
          {entry.file_name}: {entry.validation.ok ? (entry.enabled ? "已启用" : "已禁用") : entry.validation.errors[0]}
        </p>
        <div className="local-skill-actions">
          <button className="row-action" type="button" onClick={onToggleExpanded}>
            {expanded ? "收起" : "详情"}
          </button>
          {entry.validation.ok && (
            <button className="row-action" type="button" onClick={onToggleEnabled}>
              {entry.enabled ? "禁用" : "启用"}
            </button>
          )}
        </div>
      </div>
      {expanded && (
        <div className="local-skill-detail">
          <PathLine label="来源" value={entry.path} />
          {details ? (
            <>
              <StatusLine label="名称" value={details.displayName || "-"} />
              <StatusLine label="ID" value={details.id || "-"} />
              <StatusLine label="版本/作者" value={`${details.version || "-"} / ${details.author || "-"}`} />
              <StatusLine label="来源类型" value={details.source || "-"} />
              <StatusLine label="Manifest 状态" value={details.manifestEnabled ? "声明启用" : "声明禁用"} />
              <StatusLine label="外部代码" value={details.allowExternalCode ? "允许" : "禁用"} tone={details.allowExternalCode ? "danger" : "normal"} />
              <div className="file-type-list">
                {details.permissions.length ? details.permissions.map((item) => <span key={item}>{skillPermissionLabel(item)}</span>) : <span>无权限声明</span>}
              </div>
              <div className="local-skill-actions-list">
                {details.actions.length ? (
                  details.actions.map((action) => (
                    <div className="local-skill-action-detail" key={action.id}>
                      <strong>{action.title || action.id || "未命名动作"}</strong>
                      <span>{action.description || "无描述"}</span>
                      <small>{action.actionId ? `绑定：${action.actionId}` : "无动作绑定"} / {action.permissions.map(skillPermissionLabel).join("、") || "无权限"}</small>
                    </div>
                  ))
                ) : (
                  <p className="settings-note">没有声明动作。</p>
                )}
              </div>
            </>
          ) : (
            <p className="settings-error">{entry.error ?? "manifest 不是 JSON 对象。"}</p>
          )}
          {!entry.validation.ok && (
            <div className="local-skill-errors">
              {entry.validation.errors.map((error) => (
                <p className="settings-error" key={error}>{error}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LocalPetAppearanceRow({
  entry,
  expanded,
  selected,
  licenseAccepted,
  licenseAcceptance,
  importing,
  onToggleExpanded,
  onUse,
}: {
  entry: LocalPetAppearanceAuditEntry;
  expanded: boolean;
  selected: boolean;
  licenseAccepted: boolean;
  licenseAcceptance: PetLicenseAcceptanceRecord | null;
  importing: boolean;
  onToggleExpanded: () => void;
  onUse: () => void;
}) {
  const previewManifest = materializeLocalPetAppearance(entry);
  const previewAsset = resolveLocalPetThumbnailAsset(entry) ?? (previewManifest ? resolvePetAsset("idle", previewManifest) : null);
  const status = entry.validation.ok
    ? entry.validation.warnings.length
      ? `${entry.validation.warnings.length} 个警告`
      : "可导入"
    : entry.validation.errors[0];
  return (
    <div className="local-skill-item">
      <div className="local-skill-row">
        <p className={entry.validation.ok && !entry.validation.warnings.length ? "settings-note" : "settings-error"}>
          {entry.file_name}: {status}
        </p>
        <div className="local-skill-actions">
          <button className="row-action" type="button" onClick={onToggleExpanded}>
            {expanded ? "收起" : "详情"}
          </button>
          {entry.validation.ok && (
            <button className="row-action" type="button" onClick={onUse} disabled={selected || importing}>
              {importing ? (
                <>
                  <Loader2 className="spin" size={14} />
                  启用中
                </>
              ) : selected ? "当前" : licenseAccepted ? "启用" : "确认授权并启用"}
            </button>
          )}
        </div>
      </div>
      {expanded && (
        <div className="local-skill-detail">
          <PathLine label="来源" value={entry.path} />
          {entry.details ? (
            <>
              {previewAsset && (
                <div className="pet-appearance-preview">
                  <img src={previewAsset} alt={`${entry.details.displayName || entry.file_name} 预览`} />
                  <span>{selected ? "当前使用" : "预览"}</span>
                </div>
              )}
              <StatusLine label="名称" value={entry.details.displayName || "-"} />
              <StatusLine label="ID" value={entry.details.id || "-"} />
              <StatusLine label="版本/作者" value={`${entry.details.version || "-"} / ${entry.details.author || "-"}`} />
              <StatusLine label="授权" value={entry.details.license || "-"} />
              <StatusLine label="来源" value={entry.source === "active" ? "受控副本" : "本地目录"} />
              <StatusLine label="授权确认" value={formatPetLicenseAcceptance(licenseAcceptance, licenseAccepted)} tone={licenseAccepted ? "normal" : "danger"} />
              {licenseAcceptance?.license && <StatusLine label="确认授权" value={licenseAcceptance.license} />}
              <StatusLine label="尺寸" value={entry.details.dimensions ?? "未声明"} />
              <StatusLine label="缩放" value={entry.details.defaultScale === null ? "-" : String(entry.details.defaultScale)} />
              <StatusLine label="资产数" value={`${entry.details.assetCount}`} />
              <div className="file-type-list">
                {entry.details.states.length ? entry.details.states.map((state) => <span key={state}>{petStateLabel(state)}</span>) : <span>仅默认形象</span>}
              </div>
              {entry.details.thumbnail && <PathLine label="缩略图" value={entry.details.thumbnail} />}
            </>
          ) : (
            <p className="settings-error">{entry.error ?? "manifest 不是 JSON 对象。"}</p>
          )}
          {entry.validation.warnings.map((warning) => (
            <p className="settings-error" key={warning}>{warning}</p>
          ))}
          {!entry.validation.ok && (
            <div className="local-skill-errors">
              {entry.validation.errors.map((error) => (
                <p className="settings-error" key={error}>{error}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusLine({ label, value, tone = "normal" }: { label: string; value: string; tone?: "normal" | "danger" }) {
  return (
    <div className="status-line">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

function PathLine({ label, value }: { label: string; value?: string }) {
  return (
    <div className="path-line">
      <span>{label}</span>
      <code>{value ?? "-"}</code>
    </div>
  );
}

function FocusPanel({
  tasks,
  plans,
  risks,
  onEditTask,
}: {
  tasks: TaskItem[];
  plans: PlanItem[];
  risks: RiskItem[];
  onEditTask: (task: TaskItem) => void;
}) {
  const urgent = tasks
    .filter((task) => task.deadline)
    .sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)))
    .slice(0, 3);
  return (
    <section className="panel focus-panel">
      <PanelHeading title="焦点" subtitle="桌宠会优先关注这些事项。" />
      <div className="focus-block">
        <strong>最近 DDL</strong>
        {urgent.length ? (
          urgent.map((task) => (
            <div className="mini-task" key={task.id}>
              <span>{task.title}</span>
              <small>{task.deadline}</small>
              <button onClick={() => onEditTask(task)}>
                <Pencil size={14} />
                编辑
              </button>
            </div>
          ))
        ) : (
          <p>暂无明确 DDL。</p>
        )}
      </div>
      <div className="focus-block">
        <strong>本周计划密度</strong>
        <div className="density-bar">
          <span style={{ width: `${Math.min(100, plans.length * 12)}%` }} />
        </div>
        <p>{plans.length} 个计划项</p>
      </div>
      <div className="focus-block">
        <strong>风险摘要</strong>
        <p>{risks.length ? `${risks.length} 个风险需要处理` : "当前没有风险记录。"}</p>
      </div>
    </section>
  );
}

function PlanTimeline({
  plans,
  tasks,
  onEditTask,
  onStatus,
}: {
  plans: PlanItem[];
  tasks: TaskItem[];
  onEditTask: (task: TaskItem) => void;
  onStatus: (taskId: string, status: string) => void;
}) {
  if (!plans.length) {
    return <EmptyState text="当前视图没有计划项。" />;
  }
  return (
    <div className="timeline">
      {plans.map((plan) => {
        const task = tasks.find((item) => item.id === plan.task_id);
        return (
          <article className={`timeline-item ${plan.type}`} key={plan.id}>
            <time>{plan.date ?? "待定"}</time>
            <div>
              <strong>{plan.title}</strong>
              <p>{plan.description}</p>
              {task && (
                <div className="task-meta">
                  <span>{task.priority}</span>
                  <span>{task.status}</span>
                  <button onClick={() => onEditTask(task)}>
                    <Pencil size={15} />
                    编辑
                  </button>
                  {task.status !== "done" && (
                    <button onClick={() => onStatus(task.id, "done")}>
                      <Check size={15} />
                      完成
                    </button>
                  )}
                </div>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function CalendarStrip({ plans }: { plans: PlanItem[] }) {
  const days = Array.from({ length: 14 }, (_, index) => addDays(index));
  return (
    <div className="calendar-strip">
      {days.map((date) => {
        const dayPlans = plans.filter((plan) => plan.date === date);
        return (
          <div className={dayPlans.length ? "day-cell has-plan" : "day-cell"} key={date}>
            <strong>{date.slice(5)}</strong>
            <span>{weekday(date)}</span>
            <div className="day-dots">
              {dayPlans.slice(0, 4).map((plan) => (
                <i key={plan.id} className={plan.type} title={plan.title} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ExportGrid({
  exportingType,
  results,
  onExport,
}: {
  exportingType: string | null;
  results: Record<string, ExportResult>;
  onExport: (exportType: string) => void;
}) {
  const exportItems = [
    { type: "todo", title: "Todo Markdown", description: "任务清单，适合快速查看 DDL 和提交物。" },
    { type: "plan", title: "Plan Markdown", description: "完整计划，包含任务、倒排计划和风险建议。" },
    { type: "summary", title: "Summary Markdown", description: "统计摘要，适合阶段复盘或提交说明。" },
    { type: "calendar", title: "Calendar ICS", description: "标准日历文件，可导入系统日历。" },
  ];

  return (
    <div className="export-grid">
      {exportItems.map((item) => {
        const result = results[item.type];
        const isExporting = exportingType === item.type;
        return (
          <article className="export-card" key={item.type}>
            <div>
              <strong>{item.title}</strong>
              <p>{item.description}</p>
            </div>
            <button className="primary-action" disabled={Boolean(exportingType)} onClick={() => onExport(item.type)}>
              {isExporting ? <Loader2 className="spin" size={18} /> : <Download size={18} />}
              <span>{isExporting ? "生成中" : "生成"}</span>
            </button>
            {result && (
              <div className="export-result">
                <span>{result.file_name}</span>
                <a href={resolveDownloadUrl(result.download_url)} download={result.file_name}>
                  下载
                </a>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function RiskList({ risks, tasks }: { risks: RiskItem[]; tasks: TaskItem[] }) {
  if (!risks.length) return <EmptyState text="当前没有风险记录。" />;
  return (
    <div className="row-list">
      {risks.map((risk) => {
        const task = tasks.find((item) => item.id === risk.task_id);
        return (
          <div className={`risk-row ${risk.severity}`} key={risk.id}>
            <strong>{risk.severity.toUpperCase()} / {risk.risk_type}</strong>
            <span>{task?.title ?? "未关联任务"}</span>
            <p>{risk.message} {risk.suggestion}</p>
          </div>
        );
      })}
    </div>
  );
}

function Metric({ label, value, tone = "normal" }: { label: string; value: number; tone?: "normal" | "danger" }) {
  return (
    <div className={`metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PanelHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="panel-heading">
      <h2>{title}</h2>
      <p>{subtitle}</p>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>;
}

function splitList(value: string): string[] {
  return value
    .split(/[、,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function deriveDdlMeta(task: TaskItem): { tone: "danger" | "urgent" | "normal"; remainingLabel: string; score: number } {
  const priorityScore = priorityWeight(task.priority);
  const deadlineTime = parseDeadlineTime(task.deadline);
  if (!deadlineTime) {
    return { tone: "normal", remainingLabel: "时间待定", score: priorityScore };
  }

  const now = Date.now();
  const diffMs = deadlineTime - now;
  const diffHours = Math.ceil(diffMs / 3_600_000);
  const diffDays = Math.ceil(diffMs / 86_400_000);

  if (diffMs <= 0) {
    return { tone: "danger", remainingLabel: "已逾期", score: 10_000 + priorityScore };
  }
  if (diffHours <= 24) {
    return { tone: "danger", remainingLabel: `剩余 ${Math.max(diffHours, 1)} 小时`, score: 8_000 + priorityScore + (24 - diffHours) };
  }
  if (diffDays <= 3) {
    return { tone: "urgent", remainingLabel: `剩余 ${diffDays} 天`, score: 5_000 + priorityScore + (3 - diffDays) };
  }
  return { tone: "normal", remainingLabel: `剩余 ${diffDays} 天`, score: Math.max(0, 1_000 - diffDays) + priorityScore };
}

function priorityWeight(priority: string): number {
  if (priority === "high") return 300;
  if (priority === "medium") return 150;
  return 50;
}

function importanceLabel(priority: string): string {
  if (priority === "high") return "高";
  if (priority === "medium") return "中";
  return "低";
}

function shortTitle(value: string): string {
  return value.length > 16 ? `${value.slice(0, 15)}...` : value;
}

function formatDeadline(value: string | null): string {
  const timestamp = parseDeadlineTime(value);
  if (!timestamp) return "时间待定";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function parseDeadlineTime(value: string | null): number | null {
  if (!value) return null;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const timestamp = new Date(normalized).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function addDays(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function isWithinDays(value: string | null, days: number): boolean {
  if (!value) return false;
  const current = new Date(todayKey()).getTime();
  const target = new Date(value).getTime();
  const diff = Math.floor((target - current) / 86_400_000);
  return diff >= 0 && diff <= days;
}

function weekday(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(new Date(value));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function ocrModeLabel(value?: string): string {
  const labels: Record<string, string> = {
    custom_command: "自定义命令",
    macos_vision: "macOS Vision",
    unavailable: "不可用",
  };
  return value ? labels[value] ?? value : "-";
}

function notificationLabel(value: string): string {
  const labels: Record<string, string> = {
    checking: "检查中",
    granted: "已授权",
    "not-granted": "待授权",
    unavailable: "不可用",
    "browser-dev": "浏览器开发态",
  };
  return labels[value] ?? value;
}

function skillPermissionLabel(value: string): string {
  const labels: Record<string, string> = {
    "pet.action": "桌宠动作",
    "desktop.window": "桌面窗口",
    "intake.file": "文件输入",
    "notify.notice": "提示事件",
  };
  return labels[value] ?? value;
}

function desktopPermissionCopy(requiresDesktopRuntime: boolean): string {
  return requiresDesktopRuntime ? "需要桌面窗口控制权限" : "可在浏览器开发态触发";
}

function formatPetLicenseAcceptance(record: PetLicenseAcceptanceRecord | null, accepted: boolean): string {
  if (!accepted) return "未确认";
  if (!record?.acceptedAt) return "已确认（旧记录）";
  return `已确认 ${formatDateTime(record.acceptedAt)}`;
}

function petStateLabel(value: string): string {
  const labels: Record<string, string> = {
    no_task: "无任务",
    processing: "处理中",
    idle: "空闲",
    missing_info: "信息不完整",
    deadline_near: "DDL 接近",
    overdue: "已逾期",
    task_done: "任务完成",
  };
  return labels[value] ?? value;
}

function selfCheckStatusLabel(result: SelfCheckResult): string {
  if (result.status === "error") return `${result.summary.error} 异常 / ${result.summary.warning} 警告`;
  if (result.status === "warning") return `${result.summary.ok} 正常 / ${result.summary.warning} 警告`;
  return `${result.summary.ok} 项正常`;
}

function backendStatusLabel(value?: string, error?: string | null): string {
  if (error) return "读取失败";
  const labels: Record<string, string> = {
    ready: "已就绪",
    starting: "启动中",
    skipped: "已跳过",
    error: "启动失败",
  };
  return value ? labels[value] ?? value : "-";
}

function backendSourceLabel(value?: string): string {
  const labels: Record<string, string> = {
    managed_process: "桌面壳启动",
    existing_service: "复用已有服务",
    env: "环境变量控制",
    autostart: "自动启动",
  };
  return value ? labels[value] ?? value : "-";
}

function inboxStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: "待处理",
    processed: "已入库",
    duplicate: "重复",
    failed: "失败",
  };
  return labels[status] ?? status;
}
