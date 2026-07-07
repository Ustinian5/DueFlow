export type InboxItem = {
  id: string;
  source_type: string;
  title: string;
  content: string;
  content_hash: string;
  received_at: string;
  status: string;
  error_message: string | null;
  duplicate_of: {
    id: string;
    title: string;
    received_at: string;
    status: string;
  } | null;
};

export type TaskItem = {
  id: string;
  inbox_item_id: string;
  title: string;
  description: string;
  deadline: string | null;
  deadline_confidence: string;
  deliverables: string[];
  submit_method: string | null;
  location: string | null;
  priority: string;
  source_quote: string;
  missing_info: string[];
  status: string;
  created_at: string;
};

export type PlanItem = {
  id: string;
  task_id: string;
  date: string | null;
  title: string;
  description: string;
  type: string;
  status: string;
};

export type RiskItem = {
  id: string;
  task_id: string;
  risk_type: string;
  severity: string;
  message: string;
  suggestion: string;
  created_at: string;
};

export type PetState = {
  state: string;
  mood: string;
  message: string;
  severity: string;
};

export type Overview = {
  inbox: InboxItem[];
  tasks: TaskItem[];
  plans: PlanItem[];
  risks: RiskItem[];
  pet_state: PetState;
};

export type IntakeResponse = {
  inbox_item: InboxItem;
  extracted_tasks: TaskItem[];
  requires_confirmation: boolean;
  pet_state: PetState;
};

export type ExportResult = {
  export_type: string;
  file_name: string;
  file_path: string;
  download_url: string;
};

export type DatabaseBackupResult = {
  kind: "sqlite_backup";
  file_name: string;
  file_path: string;
  download_url: string;
  bytes: number;
  created_at: string;
};

export type DatabaseRestoreResult = {
  status: "restored";
  restored_from: DatabaseBackupResult;
  safety_backup: DatabaseBackupResult;
};

export type DiagnosticsExportResult = {
  kind: "diagnostics_json";
  file_name: string;
  file_path: string;
  download_url: string;
  bytes: number;
  created_at: string;
};

export type DesktopConfig = {
  database_path: string;
  inbox_path: string;
  export_path: string;
  llm_provider: string;
  ocr_mode: string;
  ocr_command_configured: boolean;
  supported_file_types: string[];
  limits: {
    max_text_chars: number;
    max_upload_bytes: number;
  };
};

export type DesktopAbout = {
  service: string;
  api_version: string;
  schema_version: number;
  supported_schema_version: number;
  platform: string;
  python_version: string;
  paths: {
    database: string;
    inbox: string;
    exports: string;
  };
  capabilities: {
    llm_provider: string;
    ocr_mode: string;
    ocr_command_configured: boolean;
    supported_file_types: string[];
    database_backup: boolean;
    database_restore: boolean;
    diagnostics_export: boolean;
    limits: {
      max_text_chars: number;
      max_upload_bytes: number;
    };
  };
};

export type SelfCheckResult = {
  status: "ok" | "warning" | "error";
  summary: {
    ok: number;
    warning: number;
    error: number;
  };
  checks: Array<{
    id: string;
    label: string;
    status: "ok" | "warning" | "error";
    message: string;
    path?: string;
  }>;
};

export type BackendStatus = {
  state: string;
  source: string;
  host: string;
  port: number;
  database_path: string;
  inbox_path: string;
  export_path: string;
  command: string | null;
  error: string | null;
};
