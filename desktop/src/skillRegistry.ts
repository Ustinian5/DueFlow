import { petActionDescriptors } from "./petRuntime";
import { invokeDesktopCommand, isTauriRuntime } from "./platform";

export type SkillPermission =
  | "pet.action"
  | "desktop.window"
  | "intake.file"
  | "notify.notice";

export type SkillActionManifest = {
  id: string;
  title: string;
  description: string;
  permissions: SkillPermission[];
  actionId?: string;
};

export type SkillManifest = {
  id: string;
  displayName: string;
  version: string;
  author: string;
  source: "builtin" | "local";
  enabled: boolean;
  allowExternalCode: false;
  permissions: SkillPermission[];
  actions: SkillActionManifest[];
};

export type SkillValidationResult = {
  ok: boolean;
  errors: string[];
};

export type SkillRegistrySummary = {
  total: number;
  enabled: number;
  actionCount: number;
  permissions: SkillPermission[];
  externalCodeAllowed: boolean;
};

export type LocalSkillManifestEntry = {
  file_name: string;
  path: string;
  manifest: unknown | null;
  error: string | null;
};

export type LocalSkillScanResult = {
  directory: string;
  entries: LocalSkillManifestEntry[];
};

export type LocalSkillAuditEntry = LocalSkillManifestEntry & {
  validation: SkillValidationResult;
  enabled: boolean;
  disabledByUser: boolean;
};

export type LocalSkillPreferenceState = {
  disabledPaths: string[];
};

export type SkillActionDetails = {
  id: string;
  title: string;
  description: string;
  actionId: string | null;
  permissions: string[];
};

export type SkillManifestDetails = {
  id: string;
  displayName: string;
  version: string;
  author: string;
  source: string;
  manifestEnabled: boolean;
  allowExternalCode: boolean | null;
  permissions: string[];
  actions: SkillActionDetails[];
};

export type VisibleSkillAction = SkillActionDetails & {
  skillId: string;
  skillName: string;
  source: "builtin" | "local";
  executable: boolean;
  localPath?: string;
};

const LOCAL_SKILL_PREFERENCES_KEY = "dueflow.localSkillPreferences.v1";

const allowedPermissions: ReadonlySet<SkillPermission> = new Set([
  "pet.action",
  "desktop.window",
  "intake.file",
  "notify.notice",
]);

const allowedActionIds = new Set([...petActionDescriptors.map((action) => action.id), "pet-drop-file"]);
const executableActionIds: ReadonlySet<string> = new Set(petActionDescriptors.map((action) => action.id));
const idPattern = /^[a-z0-9][a-z0-9._-]{1,63}$/;

export const builtInSkillManifests: SkillManifest[] = [
  {
    id: "dueflow-core-pet-actions",
    displayName: "DueFlow Core Pet Actions",
    version: "1.0.0",
    author: "DueFlow",
    source: "builtin",
    enabled: true,
    allowExternalCode: false,
    permissions: ["pet.action", "desktop.window", "notify.notice"],
    actions: petActionDescriptors.map((action) => ({
      id: `pet.${action.id}`,
      title: action.title,
      description: action.description,
      permissions: action.requiresDesktopRuntime ? ["pet.action", "desktop.window"] : ["pet.action", "notify.notice"],
      actionId: action.id,
    })),
  },
  {
    id: "dueflow-core-intake",
    displayName: "DueFlow Core Intake",
    version: "1.0.0",
    author: "DueFlow",
    source: "builtin",
    enabled: true,
    allowExternalCode: false,
    permissions: ["intake.file", "desktop.window", "notify.notice"],
    actions: [
      {
        id: "intake.pet-drop-file",
        title: "桌宠文件拖拽识别",
        description: "拖文件到桌宠后自动识别 DDL 并加入日程。",
        permissions: ["intake.file", "desktop.window", "notify.notice"],
        actionId: "pet-drop-file",
      },
    ],
  },
];

export function validateSkillManifest(manifest: unknown): SkillValidationResult {
  const errors: string[] = [];
  if (!isRecord(manifest)) {
    return { ok: false, errors: ["Skill manifest must be a JSON object."] };
  }

  const id = typeof manifest.id === "string" ? manifest.id : "";
  const displayName = typeof manifest.displayName === "string" ? manifest.displayName : "";
  const version = typeof manifest.version === "string" ? manifest.version : "";
  const source = manifest.source;
  const enabled = manifest.enabled;
  const allowExternalCode = manifest.allowExternalCode;
  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  const actions = Array.isArray(manifest.actions) ? manifest.actions : [];

  if (!idPattern.test(id)) errors.push("Skill id must be a stable lowercase id.");
  if (!displayName.trim()) errors.push("Skill displayName is required.");
  if (!version.trim()) errors.push("Skill version is required.");
  if (source !== "builtin" && source !== "local") errors.push("Skill source must be builtin or local.");
  if (typeof enabled !== "boolean") errors.push("Skill enabled must be boolean.");
  if (allowExternalCode !== false) errors.push("External code execution is not allowed.");
  if (!Array.isArray(manifest.permissions)) errors.push("Skill permissions must be an array.");
  if (!Array.isArray(manifest.actions)) errors.push("Skill actions must be an array.");

  for (const permission of permissions) {
    if (!allowedPermissions.has(permission)) errors.push(`Unsupported skill permission: ${permission}`);
  }

  const actionIds = new Set<string>();
  for (const action of actions) {
    if (!isRecord(action)) {
      errors.push("Skill action must be a JSON object.");
      continue;
    }

    const actionId = typeof action.id === "string" ? action.id : "";
    const actionTitle = typeof action.title === "string" ? action.title : "";
    const binding = typeof action.actionId === "string" ? action.actionId : undefined;
    const actionPermissions = Array.isArray(action.permissions) ? action.permissions : [];

    if (!idPattern.test(actionId)) errors.push(`Invalid action id: ${String(action.id)}`);
    if (actionIds.has(actionId)) errors.push(`Duplicate action id: ${actionId}`);
    actionIds.add(actionId);
    if (!actionTitle.trim()) errors.push(`Action title is required: ${actionId}`);
    if (binding && !allowedActionIds.has(binding)) errors.push(`Unsupported action binding: ${binding}`);
    if (!Array.isArray(action.permissions)) errors.push(`Action permissions must be an array: ${actionId}`);
    for (const permission of actionPermissions) {
      if (!permissions.includes(permission)) errors.push(`Action ${actionId} uses undeclared permission: ${permission}`);
      if (!allowedPermissions.has(permission)) errors.push(`Unsupported action permission: ${permission}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function listEnabledSkillManifests(manifests: SkillManifest[] = builtInSkillManifests): SkillManifest[] {
  return manifests.filter((manifest) => manifest.enabled && validateSkillManifest(manifest).ok);
}

export function summarizeSkillRegistry(manifests: SkillManifest[] = builtInSkillManifests): SkillRegistrySummary {
  const enabledManifests = listEnabledSkillManifests(manifests);
  const permissions = new Set<SkillPermission>();
  for (const manifest of enabledManifests) {
    for (const permission of manifest.permissions) permissions.add(permission);
  }

  return {
    total: manifests.length,
    enabled: enabledManifests.length,
    actionCount: enabledManifests.reduce((count, manifest) => count + manifest.actions.length, 0),
    permissions: [...permissions].sort(),
    externalCodeAllowed: enabledManifests.some((manifest) => manifest.allowExternalCode),
  };
}

export function listVisibleSkillActions(localAudit: LocalSkillAuditEntry[] = []): VisibleSkillAction[] {
  const builtInActions = listEnabledSkillManifests().flatMap((manifest) =>
    manifest.actions.map((action) => ({
      id: action.id,
      title: action.title,
      description: action.description,
      actionId: action.actionId ?? null,
      permissions: action.permissions,
      skillId: manifest.id,
      skillName: manifest.displayName,
      source: "builtin" as const,
      executable: Boolean(action.actionId && executableActionIds.has(action.actionId)),
    })),
  );

  const localActions = localAudit.flatMap((entry) => {
    if (!entry.enabled || !entry.validation.ok) return [];
    const details = describeSkillManifest(entry.manifest);
    if (!details) return [];
    return details.actions.map((action) => ({
      ...action,
      skillId: details.id,
      skillName: details.displayName || details.id,
      source: "local" as const,
      executable: false,
      localPath: entry.path,
    }));
  });

  return [...builtInActions, ...localActions].sort((left, right) => `${left.source}:${left.id}`.localeCompare(`${right.source}:${right.id}`));
}

export function summarizeVisibleSkillActions(actions: VisibleSkillAction[]) {
  return {
    total: actions.length,
    executable: actions.filter((action) => action.executable).length,
    localReadOnly: actions.filter((action) => action.source === "local" && !action.executable).length,
  };
}

export function auditLocalSkillScan(scan: LocalSkillScanResult, preferences: LocalSkillPreferenceState = { disabledPaths: [] }): LocalSkillAuditEntry[] {
  const disabledPaths = new Set(preferences.disabledPaths);
  return scan.entries.map((entry) => ({
    ...entry,
    validation: entry.manifest ? validateSkillManifest(entry.manifest) : { ok: false, errors: [entry.error ?? "Skill manifest could not be read."] },
    enabled: entry.manifest ? manifestEnabled(entry.manifest) && !disabledPaths.has(entry.path) && validateSkillManifest(entry.manifest).ok : false,
    disabledByUser: disabledPaths.has(entry.path),
  }));
}

export function describeSkillManifest(manifest: unknown): SkillManifestDetails | null {
  if (!isRecord(manifest)) return null;
  return {
    id: stringField(manifest.id),
    displayName: stringField(manifest.displayName),
    version: stringField(manifest.version),
    author: stringField(manifest.author),
    source: stringField(manifest.source),
    manifestEnabled: manifest.enabled === true,
    allowExternalCode: typeof manifest.allowExternalCode === "boolean" ? manifest.allowExternalCode : null,
    permissions: arrayOfStrings(manifest.permissions),
    actions: Array.isArray(manifest.actions)
      ? manifest.actions.filter(isRecord).map((action) => ({
          id: stringField(action.id),
          title: stringField(action.title),
          description: stringField(action.description),
          actionId: typeof action.actionId === "string" ? action.actionId : null,
          permissions: arrayOfStrings(action.permissions),
        }))
      : [],
  };
}

export async function loadLocalSkillScan(): Promise<LocalSkillScanResult> {
  if (!isTauriRuntime()) {
    return { directory: "浏览器开发态不可用", entries: [] };
  }
  return invokeDesktopCommand<LocalSkillScanResult>("scan_local_skill_manifests");
}

export async function openLocalSkillDirectory(): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("浏览器开发态无法打开本地技能目录。");
  }
  await invokeDesktopCommand<void>("open_local_skills_directory");
}

export function loadLocalSkillPreferences(): LocalSkillPreferenceState {
  if (!hasLocalStorage()) return { disabledPaths: [] };
  try {
    const raw = localStorage.getItem(LOCAL_SKILL_PREFERENCES_KEY);
    if (!raw) return { disabledPaths: [] };
    const parsed = JSON.parse(raw);
    return normalizeLocalSkillPreferences(parsed);
  } catch {
    return { disabledPaths: [] };
  }
}

export function setLocalSkillEnabled(path: string, enabled: boolean, current = loadLocalSkillPreferences()): LocalSkillPreferenceState {
  const disabledPaths = new Set(current.disabledPaths);
  if (enabled) {
    disabledPaths.delete(path);
  } else {
    disabledPaths.add(path);
  }
  const next = { disabledPaths: [...disabledPaths].sort() };
  saveLocalSkillPreferences(next);
  return next;
}

function saveLocalSkillPreferences(preferences: LocalSkillPreferenceState) {
  if (!hasLocalStorage()) return;
  localStorage.setItem(LOCAL_SKILL_PREFERENCES_KEY, JSON.stringify(preferences));
}

function normalizeLocalSkillPreferences(value: unknown): LocalSkillPreferenceState {
  if (!isRecord(value) || !Array.isArray(value.disabledPaths)) return { disabledPaths: [] };
  return {
    disabledPaths: value.disabledPaths.filter((item): item is string => typeof item === "string").sort(),
  };
}

function manifestEnabled(manifest: unknown): boolean {
  return isRecord(manifest) && manifest.enabled === true;
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function hasLocalStorage(): boolean {
  return typeof localStorage !== "undefined" && typeof localStorage.getItem === "function" && typeof localStorage.setItem === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
