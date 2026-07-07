import defaultPetAsset from "./assets/pet.svg";
import { convertFileSrc } from "@tauri-apps/api/core";
import { invokeDesktopCommand, isTauriRuntime } from "./platform";

export type PetAssetState =
  | "no_task"
  | "processing"
  | "idle"
  | "missing_info"
  | "deadline_near"
  | "overdue"
  | "task_done";

export type PetAppearanceManifest = {
  id: string;
  displayName: string;
  author: string;
  version: string;
  license: string;
  defaultScale: number;
  source?: "builtin" | "local";
  dimensions?: {
    width: number;
    height: number;
  };
  thumbnail?: string;
  assets: {
    default: string;
    states?: Partial<Record<PetAssetState, string>>;
  };
};

export type PetAppearanceValidationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

export type LocalPetAppearanceManifestEntry = {
  file_name: string;
  path: string;
  source?: "library" | "active";
  manifest: unknown | null;
  error: string | null;
};

export type LocalPetAppearanceScanResult = {
  directory: string;
  entries: LocalPetAppearanceManifestEntry[];
};

export type LocalPetAppearanceImportResult = {
  directory: string;
  path: string;
  file_name: string;
};

export type LocalPetAppearanceAuditEntry = LocalPetAppearanceManifestEntry & {
  validation: PetAppearanceValidationResult;
  details: PetAppearanceManifestDetails | null;
};

export type LocalPetAppearancePreferenceState = {
  selectedPath: string | null;
  acceptedLicensePaths: string[];
  acceptedLicenses: PetLicenseAcceptanceRecord[];
};

export type PetLicenseAcceptanceRecord = {
  path: string;
  license: string | null;
  acceptedAt: string | null;
};

export type PetAppearanceManifestDetails = {
  id: string;
  displayName: string;
  author: string;
  version: string;
  license: string;
  defaultScale: number | null;
  dimensions: string | null;
  assetCount: number;
  states: string[];
  thumbnail: string | null;
};

export type ActivePetAppearance = {
  manifest: PetAppearanceManifest;
  sourcePath: string | null;
  fallbackReason: string | null;
};

export const builtInPetManifest: PetAppearanceManifest = {
  id: "dueflow-default",
  displayName: "DueFlow Default",
  author: "DueFlow",
  version: "1.0.0",
  license: "Project asset",
  defaultScale: 1,
  source: "builtin",
  assets: {
    default: defaultPetAsset,
  },
};

const LOCAL_PET_APPEARANCE_PREFERENCES_KEY = "dueflow.localPetAppearancePreferences.v1";
const petIdPattern = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const validPetStates: ReadonlySet<string> = new Set([
  "no_task",
  "processing",
  "idle",
  "missing_info",
  "deadline_near",
  "overdue",
  "task_done",
]);
const allowedAssetExtensions = new Set([".svg", ".png", ".webp", ".gif", ".apng"]);
const localPetAssetUrlCache = new Map<string, string>();

export function resolvePetAsset(state: string | undefined, manifest: PetAppearanceManifest = builtInPetManifest): string {
  if (!state) return manifest.assets.default;
  return manifest.assets.states?.[state as PetAssetState] ?? manifest.assets.default;
}

export function loadLocalPetAppearancePreferences(): LocalPetAppearancePreferenceState {
  if (!hasUsableLocalStorage()) return emptyLocalPetAppearancePreferences();
  try {
    const raw = localStorage.getItem(LOCAL_PET_APPEARANCE_PREFERENCES_KEY);
    if (!raw) return emptyLocalPetAppearancePreferences();
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) return emptyLocalPetAppearancePreferences();
    const legacyPaths = Array.isArray(parsed.acceptedLicensePaths) ? parsed.acceptedLicensePaths.filter((item): item is string => typeof item === "string") : [];
    const records = Array.isArray(parsed.acceptedLicenses)
      ? parsed.acceptedLicenses.filter(isLicenseAcceptanceRecord).map((record) => ({
          path: record.path,
          license: record.license ?? null,
          acceptedAt: record.acceptedAt ?? null,
        }))
      : [];
    const recordPaths = new Set(records.map((record) => record.path));
    const migratedRecords = [
      ...records,
      ...legacyPaths.filter((path) => !recordPaths.has(path)).map((path) => ({ path, license: null, acceptedAt: null })),
    ];
    const acceptedLicensePaths = [...new Set([...legacyPaths, ...migratedRecords.map((record) => record.path)])].sort();
    return {
      selectedPath: typeof parsed.selectedPath === "string" ? parsed.selectedPath : null,
      acceptedLicensePaths,
      acceptedLicenses: migratedRecords.sort((left, right) => left.path.localeCompare(right.path)),
    };
  } catch {
    return emptyLocalPetAppearancePreferences();
  }
}

export function setLocalPetAppearanceSelected(
  path: string | null,
  acceptLicense: boolean,
  current: LocalPetAppearancePreferenceState = loadLocalPetAppearancePreferences(),
  license?: string | null,
  acceptedAt = new Date().toISOString(),
): LocalPetAppearancePreferenceState {
  const accepted = new Set(current.acceptedLicensePaths);
  const records = new Map(current.acceptedLicenses.map((record) => [record.path, record]));
  if (path && acceptLicense) accepted.add(path);
  if (path && acceptLicense) {
    records.set(path, { path, license: license ?? null, acceptedAt });
  }
  const next = {
    selectedPath: path,
    acceptedLicensePaths: [...accepted].sort(),
    acceptedLicenses: [...records.values()].sort((left, right) => left.path.localeCompare(right.path)),
  };
  persistLocalPetAppearancePreferences(next);
  return next;
}

export function hasAcceptedPetLicense(path: string, preferences: LocalPetAppearancePreferenceState): boolean {
  return preferences.acceptedLicensePaths.includes(path) || preferences.acceptedLicenses.some((record) => record.path === path);
}

export function getPetLicenseAcceptanceRecord(
  path: string,
  preferences: LocalPetAppearancePreferenceState,
): PetLicenseAcceptanceRecord | null {
  return preferences.acceptedLicenses.find((record) => record.path === path) ?? (preferences.acceptedLicensePaths.includes(path) ? { path, license: null, acceptedAt: null } : null);
}

export function validatePetAppearanceManifest(manifest: unknown): PetAppearanceValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isRecord(manifest)) {
    return { ok: false, errors: ["Pet manifest must be a JSON object."], warnings };
  }

  const id = typeof manifest.id === "string" ? manifest.id : "";
  const displayName = typeof manifest.displayName === "string" ? manifest.displayName : "";
  const author = typeof manifest.author === "string" ? manifest.author : "";
  const version = typeof manifest.version === "string" ? manifest.version : "";
  const license = typeof manifest.license === "string" ? manifest.license : "";
  const source = manifest.source;
  const defaultScale = manifest.defaultScale;
  const dimensions = manifest.dimensions;
  const thumbnail = manifest.thumbnail;
  const assets = manifest.assets;

  if (!petIdPattern.test(id)) errors.push("Pet id must be a stable lowercase id.");
  if (!displayName.trim()) errors.push("Pet displayName is required.");
  if (!author.trim()) errors.push("Pet author is required.");
  if (!version.trim()) errors.push("Pet version is required.");
  if (!license.trim()) {
    errors.push("Pet license is required.");
  } else if (/^(unknown|todo|tbd|none)$/i.test(license.trim())) {
    warnings.push("Pet license should be explicit before distribution.");
  }
  if (source !== undefined && source !== "local" && source !== "builtin") errors.push("Pet source must be local or builtin.");
  if (typeof defaultScale !== "number" || !Number.isFinite(defaultScale) || defaultScale <= 0 || defaultScale > 3) {
    errors.push("Pet defaultScale must be a number between 0 and 3.");
  }

  if (dimensions !== undefined) {
    if (!isRecord(dimensions)) {
      errors.push("Pet dimensions must be an object.");
    } else {
      const width = dimensions.width;
      const height = dimensions.height;
      if (typeof width !== "number" || !Number.isInteger(width) || width < 32 || width > 512) errors.push("Pet dimensions.width must be an integer from 32 to 512.");
      if (typeof height !== "number" || !Number.isInteger(height) || height < 32 || height > 512) errors.push("Pet dimensions.height must be an integer from 32 to 512.");
    }
  } else {
    warnings.push("Pet dimensions are not declared; default overlay sizing will be used.");
  }

  if (thumbnail !== undefined) validateAssetPath(thumbnail, "thumbnail", errors);
  if (!isRecord(assets)) {
    errors.push("Pet assets must be an object.");
  } else {
    validateAssetPath(assets.default, "assets.default", errors);
    if (assets.states !== undefined) {
      if (!isRecord(assets.states)) {
        errors.push("Pet assets.states must be an object.");
      } else {
        for (const [state, value] of Object.entries(assets.states)) {
          if (!validPetStates.has(state)) errors.push(`Unsupported pet state asset: ${state}`);
          validateAssetPath(value, `assets.states.${state}`, errors);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function auditLocalPetAppearances(scan: LocalPetAppearanceScanResult): LocalPetAppearanceAuditEntry[] {
  return scan.entries.map((entry) => {
    const validation = entry.manifest ? validatePetAppearanceManifest(entry.manifest) : { ok: false, errors: [entry.error ?? "Pet manifest could not be read."], warnings: [] };
    return {
      ...entry,
      validation,
      details: entry.manifest ? describePetAppearanceManifest(entry.manifest) : null,
    };
  });
}

export function describePetAppearanceManifest(manifest: unknown): PetAppearanceManifestDetails | null {
  if (!isRecord(manifest)) return null;
  const assets = isRecord(manifest.assets) ? manifest.assets : {};
  const states = isRecord(assets.states) ? Object.keys(assets.states).sort() : [];
  const dimensions = isRecord(manifest.dimensions) && Number.isFinite(manifest.dimensions.width) && Number.isFinite(manifest.dimensions.height)
    ? `${manifest.dimensions.width} x ${manifest.dimensions.height}`
    : null;
  return {
    id: typeof manifest.id === "string" ? manifest.id : "",
    displayName: typeof manifest.displayName === "string" ? manifest.displayName : "",
    author: typeof manifest.author === "string" ? manifest.author : "",
    version: typeof manifest.version === "string" ? manifest.version : "",
    license: typeof manifest.license === "string" ? manifest.license : "",
    defaultScale: typeof manifest.defaultScale === "number" && Number.isFinite(manifest.defaultScale) ? manifest.defaultScale : null,
    dimensions,
    assetCount: 1 + states.length + (typeof manifest.thumbnail === "string" ? 1 : 0),
    states,
    thumbnail: typeof manifest.thumbnail === "string" ? manifest.thumbnail : null,
  };
}

export function materializeLocalPetAppearance(
  entry: LocalPetAppearanceAuditEntry,
  assetUrlResolver: (absolutePath: string) => string = convertFileSrc,
): PetAppearanceManifest | null {
  if (!entry.validation.ok || !isRecord(entry.manifest)) return null;
  const parsed = parsePetAppearanceManifest(entry.manifest);
  if (!parsed) return null;
  const baseDir = getParentDirectory(entry.path);
  const states: Partial<Record<PetAssetState, string>> = {};
  for (const [state, value] of Object.entries(parsed.assets.states ?? {})) {
    states[state as PetAssetState] = resolveCachedLocalPetAssetUrl(joinLocalAssetPath(baseDir, value), assetUrlResolver);
  }
  return {
    ...parsed,
    source: "local",
    thumbnail: parsed.thumbnail ? resolveCachedLocalPetAssetUrl(joinLocalAssetPath(baseDir, parsed.thumbnail), assetUrlResolver) : undefined,
    assets: {
      default: resolveCachedLocalPetAssetUrl(joinLocalAssetPath(baseDir, parsed.assets.default), assetUrlResolver),
      states,
    },
  };
}

export function resolveLocalPetThumbnailAsset(
  entry: LocalPetAppearanceAuditEntry,
  assetUrlResolver: (absolutePath: string) => string = convertFileSrc,
): string | null {
  if (!entry.validation.ok || !isRecord(entry.manifest)) return null;
  const parsed = parsePetAppearanceManifest(entry.manifest);
  if (!parsed?.thumbnail) return null;
  return resolveCachedLocalPetAssetUrl(joinLocalAssetPath(getParentDirectory(entry.path), parsed.thumbnail), assetUrlResolver);
}

export function clearLocalPetAssetUrlCache() {
  localPetAssetUrlCache.clear();
}

export function resolveActivePetAppearance(
  auditEntries: LocalPetAppearanceAuditEntry[],
  preferences: LocalPetAppearancePreferenceState,
  assetUrlResolver: (absolutePath: string) => string = convertFileSrc,
): ActivePetAppearance {
  if (!preferences.selectedPath) {
    return { manifest: builtInPetManifest, sourcePath: null, fallbackReason: null };
  }
  const entry = auditEntries.find((item) => item.path === preferences.selectedPath);
  if (!entry) {
    return { manifest: builtInPetManifest, sourcePath: null, fallbackReason: "已选择的本地形象不存在，已回退内置形象。" };
  }
  if (!entry.validation.ok) {
    return { manifest: builtInPetManifest, sourcePath: null, fallbackReason: "已选择的本地形象校验失败，已回退内置形象。" };
  }
  if (!hasAcceptedPetLicense(entry.path, preferences)) {
    return { manifest: builtInPetManifest, sourcePath: null, fallbackReason: "已选择的本地形象尚未确认授权，已回退内置形象。" };
  }
  const manifest = materializeLocalPetAppearance(entry, assetUrlResolver);
  if (!manifest) {
    return { manifest: builtInPetManifest, sourcePath: null, fallbackReason: "已选择的本地形象无法加载，已回退内置形象。" };
  }
  return { manifest, sourcePath: entry.path, fallbackReason: null };
}

export async function loadLocalPetAppearanceScan(): Promise<LocalPetAppearanceScanResult> {
  if (!isTauriRuntime()) {
    throw new Error("浏览器开发态无法扫描本地桌宠形象目录，请在 Tauri 桌面壳中使用。");
  }
  return invokeDesktopCommand<LocalPetAppearanceScanResult>("scan_local_pet_manifests");
}

export async function importLocalPetAppearance(manifestPath: string): Promise<LocalPetAppearanceImportResult> {
  if (!isTauriRuntime()) {
    throw new Error("浏览器开发态无法导入本地桌宠形象，请在 Tauri 桌面壳中使用。");
  }
  return invokeDesktopCommand<LocalPetAppearanceImportResult>("import_local_pet_appearance", { manifestPath });
}

export async function openLocalPetAppearanceDirectory(): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("浏览器开发态无法打开本地桌宠形象目录，请在 Tauri 桌面壳中使用。");
  }
  await invokeDesktopCommand<void>("open_local_pets_directory");
}

function persistLocalPetAppearancePreferences(next: LocalPetAppearancePreferenceState) {
  if (!hasUsableLocalStorage()) return;
  localStorage.setItem(LOCAL_PET_APPEARANCE_PREFERENCES_KEY, JSON.stringify(next));
}

function hasUsableLocalStorage(): boolean {
  return typeof localStorage !== "undefined" && typeof localStorage.getItem === "function" && typeof localStorage.setItem === "function";
}

function emptyLocalPetAppearancePreferences(): LocalPetAppearancePreferenceState {
  return { selectedPath: null, acceptedLicensePaths: [], acceptedLicenses: [] };
}

function isLicenseAcceptanceRecord(value: unknown): value is PetLicenseAcceptanceRecord {
  return isRecord(value) &&
    typeof value.path === "string" &&
    (typeof value.license === "string" || value.license === null || value.license === undefined) &&
    (typeof value.acceptedAt === "string" || value.acceptedAt === null || value.acceptedAt === undefined);
}

function parsePetAppearanceManifest(manifest: Record<string, unknown>): PetAppearanceManifest | null {
  const assets = isRecord(manifest.assets) ? manifest.assets : null;
  if (!assets || typeof assets.default !== "string") return null;
  const states = isRecord(assets.states)
    ? Object.fromEntries(
        Object.entries(assets.states).filter((entry): entry is [PetAssetState, string] => validPetStates.has(entry[0]) && typeof entry[1] === "string"),
      )
    : undefined;
  const dimensions = isRecord(manifest.dimensions) && typeof manifest.dimensions.width === "number" && typeof manifest.dimensions.height === "number"
    ? { width: manifest.dimensions.width, height: manifest.dimensions.height }
    : undefined;

  return {
    id: typeof manifest.id === "string" ? manifest.id : "",
    displayName: typeof manifest.displayName === "string" ? manifest.displayName : "",
    author: typeof manifest.author === "string" ? manifest.author : "",
    version: typeof manifest.version === "string" ? manifest.version : "",
    license: typeof manifest.license === "string" ? manifest.license : "",
    defaultScale: typeof manifest.defaultScale === "number" ? manifest.defaultScale : 1,
    source: manifest.source === "builtin" || manifest.source === "local" ? manifest.source : "local",
    dimensions,
    thumbnail: typeof manifest.thumbnail === "string" ? manifest.thumbnail : undefined,
    assets: {
      default: assets.default,
      states,
    },
  };
}

function getParentDirectory(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return "";
  return normalized.slice(0, index);
}

function joinLocalAssetPath(baseDir: string, relativePath: string): string {
  const trimmedBase = baseDir.replace(/[\\/]+$/, "");
  const trimmedRelative = relativePath.replace(/^[\\/]+/, "");
  return trimmedBase ? `${trimmedBase}/${trimmedRelative}` : trimmedRelative;
}

function resolveCachedLocalPetAssetUrl(absolutePath: string, assetUrlResolver: (absolutePath: string) => string): string {
  const cached = localPetAssetUrlCache.get(absolutePath);
  if (cached) return cached;
  const resolved = assetUrlResolver(absolutePath);
  localPetAssetUrlCache.set(absolutePath, resolved);
  return resolved;
}

function validateAssetPath(value: unknown, label: string, errors: string[]) {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`Pet ${label} is required.`);
    return;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    errors.push(`Pet ${label} must be a local relative path.`);
    return;
  }
  if (value.startsWith("/") || value.startsWith("\\") || value.includes("..") || value.includes("\0")) {
    errors.push(`Pet ${label} must stay inside the pet package.`);
  }
  const lower = value.toLowerCase();
  if (![...allowedAssetExtensions].some((extension) => lower.endsWith(extension))) {
    errors.push(`Pet ${label} must use one of ${[...allowedAssetExtensions].join(", ")}.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
