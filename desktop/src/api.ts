import type { DatabaseBackupResult, DatabaseRestoreResult, DesktopAbout, DesktopConfig, DiagnosticsExportResult, ExportResult, IntakeResponse, Overview, SelfCheckResult, TaskItem } from "./types";

const API_BASE = import.meta.env.VITE_DUEFLOW_API_BASE ?? "http://127.0.0.1:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(error.detail ?? response.statusText);
  }
  return response.json() as Promise<T>;
}

export function fetchOverview(): Promise<Overview> {
  return request<Overview>("/desktop/overview");
}

export function fetchConfig(): Promise<DesktopConfig> {
  return request<DesktopConfig>("/desktop/config");
}

export function fetchAbout(): Promise<DesktopAbout> {
  return request<DesktopAbout>("/desktop/about");
}

export function fetchSelfCheck(): Promise<SelfCheckResult> {
  return request<SelfCheckResult>("/desktop/self-check");
}

export function extractInboxItem(inboxItemId: string): Promise<IntakeResponse> {
  return request<IntakeResponse>(`/desktop/inbox/${inboxItemId}/extract`, {
    method: "POST",
  });
}

export function intakeText(payload: {
  title: string;
  content: string;
  source_type: string;
  auto_extract: boolean;
}): Promise<IntakeResponse> {
  return request<IntakeResponse>("/desktop/intake/text", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function intakeFile(file: File, autoExtract = true): Promise<IntakeResponse> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(`${API_BASE}/desktop/intake/file?auto_extract=${autoExtract ? "true" : "false"}`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(error.detail ?? response.statusText);
  }
  return response.json() as Promise<IntakeResponse>;
}

export function confirmTasks(payload: {
  inbox_item_id: string;
  tasks: TaskItem[];
}): Promise<{ tasks: TaskItem[]; summary: { tasks: number; plans: number; risks: number } }> {
  return request("/desktop/tasks/confirm", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateTaskStatus(taskId: string, status: string): Promise<{ task: TaskItem }> {
  return request(`/desktop/tasks/${taskId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export function updateTask(taskId: string, task: TaskItem): Promise<{ task: TaskItem }> {
  return request(`/desktop/tasks/${taskId}`, {
    method: "PUT",
    body: JSON.stringify(task),
  });
}

export function createExport(exportType: string): Promise<ExportResult> {
  return request<ExportResult>(`/desktop/exports/${exportType}`, {
    method: "POST",
  });
}

export function createDatabaseBackup(): Promise<DatabaseBackupResult> {
  return request<DatabaseBackupResult>("/desktop/database/backup", {
    method: "POST",
  });
}

export function fetchDatabaseBackups(): Promise<{ backups: DatabaseBackupResult[] }> {
  return request<{ backups: DatabaseBackupResult[] }>("/desktop/database/backups");
}

export function restoreDatabaseBackup(fileName: string): Promise<DatabaseRestoreResult> {
  return request<DatabaseRestoreResult>("/desktop/database/restore", {
    method: "POST",
    body: JSON.stringify({ file_name: fileName, confirm: "RESTORE" }),
  });
}

export function createDiagnosticsExport(): Promise<DiagnosticsExportResult> {
  return request<DiagnosticsExportResult>("/desktop/diagnostics/export", {
    method: "POST",
  });
}

export function resolveDownloadUrl(downloadUrl: string): string {
  return `${API_BASE}${downloadUrl}`;
}
