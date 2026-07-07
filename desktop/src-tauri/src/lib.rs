use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    env,
    net::{SocketAddr, TcpStream},
    path::{Component, Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, Runtime, State,
};
use tauri_plugin_global_shortcut::ShortcutState;

const QUICK_INPUT_EVENT: &str = "dueflow://quick-input";
const MAX_SKILL_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_PET_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_PET_ASSET_BYTES: u64 = 8 * 1024 * 1024;

struct BackendProcess {
    child: Mutex<Option<Child>>,
}

struct BackendState {
    status: Mutex<BackendStatus>,
}

#[derive(Clone, Debug, Serialize)]
struct BackendStatus {
    state: String,
    source: String,
    host: String,
    port: u16,
    database_path: String,
    inbox_path: String,
    export_path: String,
    command: Option<String>,
    error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
struct LocalSkillManifestEntry {
    file_name: String,
    path: String,
    manifest: Option<Value>,
    error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
struct LocalSkillScanResult {
    directory: String,
    entries: Vec<LocalSkillManifestEntry>,
}

#[derive(Clone, Debug, Serialize)]
struct LocalPetManifestEntry {
    file_name: String,
    path: String,
    source: String,
    manifest: Option<Value>,
    error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
struct LocalPetScanResult {
    directory: String,
    entries: Vec<LocalPetManifestEntry>,
}

#[derive(Clone, Debug, Serialize)]
struct LocalPetImportResult {
    directory: String,
    path: String,
    file_name: String,
}

#[derive(Clone, Debug, Deserialize)]
struct PetImportManifest {
    id: String,
    #[serde(rename = "displayName")]
    display_name: String,
    author: String,
    version: String,
    license: String,
    #[serde(rename = "defaultScale")]
    default_scale: f64,
    thumbnail: Option<String>,
    assets: PetImportAssets,
}

#[derive(Clone, Debug, Deserialize)]
struct PetImportAssets {
    default: String,
    states: Option<std::collections::BTreeMap<String, String>>,
}

struct BackendLaunch {
    child: Option<Child>,
    status: BackendStatus,
}

impl BackendStatus {
    fn new(
        paths: &BackendPaths,
        state: impl Into<String>,
        source: impl Into<String>,
        host: &str,
        port: u16,
        command: Option<String>,
        error: Option<String>,
    ) -> Self {
        Self {
            state: state.into(),
            source: source.into(),
            host: host.to_string(),
            port,
            database_path: paths.database_path.display().to_string(),
            inbox_path: paths.inbox_path.display().to_string(),
            export_path: paths.export_path.display().to_string(),
            command,
            error,
        }
    }

    fn error(paths: &BackendPaths, error: String) -> Self {
        Self::new(
            paths,
            "error",
            "autostart",
            "127.0.0.1",
            8000,
            None,
            Some(error),
        )
    }
}

#[derive(Clone, Debug)]
struct BackendPaths {
    database_path: PathBuf,
    inbox_path: PathBuf,
    export_path: PathBuf,
}

impl BackendPaths {
    fn from_app<R: Runtime>(app: &tauri::App<R>) -> Result<Self, String> {
        let root = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("failed to resolve app data dir: {error}"))?;
        let paths = Self {
            database_path: root.join("dueflow.db"),
            inbox_path: root.join("inbox"),
            export_path: root.join("exports"),
        };
        paths.ensure_dirs()?;
        Ok(paths)
    }

    fn from_project_root_fallback() -> Self {
        Self {
            database_path: PathBuf::from("dueflow.db"),
            inbox_path: PathBuf::from("inbox"),
            export_path: PathBuf::from("exports"),
        }
    }

    fn ensure_dirs(&self) -> Result<(), String> {
        if let Some(parent) = self.database_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("failed to create database directory: {error}"))?;
        }
        std::fs::create_dir_all(&self.inbox_path)
            .map_err(|error| format!("failed to create inbox directory: {error}"))?;
        std::fs::create_dir_all(&self.export_path)
            .map_err(|error| format!("failed to create export directory: {error}"))?;
        Ok(())
    }
}

impl Drop for BackendProcess {
    fn drop(&mut self) {
        if let Ok(mut child_guard) = self.child.lock() {
            if let Some(mut child) = child_guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

pub fn run() {
    let quick_input_shortcut = env::var("DUEFLOW_QUICK_INPUT_SHORTCUT")
        .unwrap_or_else(|_| "CommandOrControl+Shift+D".to_string());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcuts([quick_input_shortcut.as_str()])
                .expect("invalid DueFlow quick input shortcut")
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        let _ = focus_quick_input(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            show_main_window,
            expand_schedule_window,
            collapse_schedule_window,
            get_schedule_surface_mode,
            toggle_pet_window,
            focus_quick_input_window,
            get_backend_status,
            scan_local_skill_manifests,
            open_local_skills_directory,
            scan_local_pet_manifests,
            import_local_pet_appearance,
            open_local_pets_directory
        ])
        .setup(|app| {
            let backend_paths = match BackendPaths::from_app(app) {
                Ok(paths) => paths,
                Err(error) => {
                    eprintln!("DueFlow data directory setup failed: {error}");
                    BackendPaths::from_project_root_fallback()
                }
            };

            match ensure_backend(&backend_paths) {
                Ok(launch) => {
                    app.manage(BackendState {
                        status: Mutex::new(launch.status),
                    });
                    if launch.child.is_some() {
                        app.manage(BackendProcess {
                            child: Mutex::new(launch.child),
                        });
                    }
                }
                Err(error) => {
                    eprintln!("DueFlow backend autostart failed: {error}");
                    app.manage(BackendState {
                        status: Mutex::new(BackendStatus::error(&backend_paths, error)),
                    });
                }
            }
            setup_tray(app.handle())?;
            let _ = initialize_schedule_surface(app.handle());
            Ok(())
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open_main" => {
                let _ = show_main(app);
            }
            "quick_input" => {
                let _ = focus_quick_input(app);
            }
            "toggle_pet" => {
                let _ = toggle_pet(app);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = show_main(tray.app_handle());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running DueFlow Desktop");
}

#[tauri::command]
fn show_main_window(app: AppHandle) -> Result<(), String> {
    show_main(&app)
}

#[tauri::command]
fn expand_schedule_window(app: AppHandle) -> Result<(), String> {
    if schedule_surface_mode() == "windows_drawer" {
        position_schedule_surface(&app, false)
    } else {
        show_floating_schedule_surface(&app)
    }
}

#[tauri::command]
fn collapse_schedule_window(app: AppHandle) -> Result<(), String> {
    if schedule_surface_mode() == "windows_drawer" {
        position_schedule_surface(&app, true)
    } else {
        Ok(())
    }
}

#[tauri::command]
fn get_schedule_surface_mode() -> String {
    schedule_surface_mode().to_string()
}

#[tauri::command]
fn toggle_pet_window(app: AppHandle) -> Result<(), String> {
    toggle_pet(&app)
}

#[tauri::command]
fn focus_quick_input_window(app: AppHandle) -> Result<(), String> {
    focus_quick_input(&app)
}

#[tauri::command]
fn get_backend_status(state: State<BackendState>) -> Result<BackendStatus, String> {
    state
        .status
        .lock()
        .map(|status| status.clone())
        .map_err(|error| format!("backend status lock poisoned: {error}"))
}

#[tauri::command]
fn scan_local_skill_manifests(app: AppHandle) -> Result<LocalSkillScanResult, String> {
    let skill_dir = resolve_skill_dir(&app)?;
    std::fs::create_dir_all(&skill_dir)
        .map_err(|error| format!("failed to create skills directory: {error}"))?;

    let mut entries = Vec::new();
    for item in std::fs::read_dir(&skill_dir)
        .map_err(|error| format!("failed to read skills directory: {error}"))?
    {
        let item = match item {
            Ok(value) => value,
            Err(error) => {
                entries.push(LocalSkillManifestEntry {
                    file_name: "<unknown>".to_string(),
                    path: skill_dir.display().to_string(),
                    manifest: None,
                    error: Some(format!("failed to read directory entry: {error}")),
                });
                continue;
            }
        };
        let path = item.path();
        if let Some(manifest_path) = resolve_skill_manifest_path(&path) {
            entries.push(read_skill_manifest(&manifest_path));
        }
    }

    entries.sort_by(|left, right| left.file_name.cmp(&right.file_name));
    Ok(LocalSkillScanResult {
        directory: skill_dir.display().to_string(),
        entries,
    })
}

#[tauri::command]
fn open_local_skills_directory(app: AppHandle) -> Result<(), String> {
    let skill_dir = resolve_skill_dir(&app)?;
    std::fs::create_dir_all(&skill_dir)
        .map_err(|error| format!("failed to create skills directory: {error}"))?;
    open_directory(&skill_dir)
}

#[tauri::command]
fn scan_local_pet_manifests(app: AppHandle) -> Result<LocalPetScanResult, String> {
    let pet_dir = resolve_pet_dir(&app)?;
    let active_pet_dir = resolve_active_pet_dir(&app)?;
    std::fs::create_dir_all(&pet_dir)
        .map_err(|error| format!("failed to create pets directory: {error}"))?;
    std::fs::create_dir_all(&active_pet_dir)
        .map_err(|error| format!("failed to create active pets directory: {error}"))?;

    let mut entries = Vec::new();
    append_pet_manifest_entries(&pet_dir, "library", &mut entries)?;
    append_pet_manifest_entries(&active_pet_dir, "active", &mut entries)?;

    entries.sort_by(|left, right| left.file_name.cmp(&right.file_name));
    Ok(LocalPetScanResult {
        directory: pet_dir.display().to_string(),
        entries,
    })
}

#[tauri::command]
fn import_local_pet_appearance(
    app: AppHandle,
    manifest_path: String,
) -> Result<LocalPetImportResult, String> {
    let pet_dir = resolve_pet_dir(&app)?;
    let active_pet_dir = resolve_active_pet_dir(&app)?;
    std::fs::create_dir_all(&pet_dir)
        .map_err(|error| format!("failed to create pets directory: {error}"))?;
    std::fs::create_dir_all(&active_pet_dir)
        .map_err(|error| format!("failed to create active pets directory: {error}"))?;

    let source_manifest = PathBuf::from(manifest_path);
    let canonical_manifest = source_manifest
        .canonicalize()
        .map_err(|error| format!("failed to resolve pet manifest path: {error}"))?;
    let canonical_pet_dir = pet_dir
        .canonicalize()
        .map_err(|error| format!("failed to resolve pets directory: {error}"))?;
    if !canonical_manifest.starts_with(&canonical_pet_dir) {
        return Err("pet appearance imports must come from the local pets directory".to_string());
    }

    import_pet_appearance_from_manifest(&canonical_manifest, &canonical_pet_dir, &active_pet_dir)
}

fn import_pet_appearance_from_manifest(
    canonical_manifest: &Path,
    canonical_pet_dir: &Path,
    active_pet_dir: &Path,
) -> Result<LocalPetImportResult, String> {
    if !canonical_manifest.starts_with(canonical_pet_dir) {
        return Err("pet appearance imports must come from the local pets directory".to_string());
    }

    let metadata = std::fs::metadata(&canonical_manifest)
        .map_err(|error| format!("failed to read pet manifest metadata: {error}"))?;
    if metadata.len() > MAX_PET_MANIFEST_BYTES {
        return Err(format!(
            "pet manifest is too large: {} bytes, max {} bytes",
            metadata.len(),
            MAX_PET_MANIFEST_BYTES
        ));
    }

    let content = std::fs::read_to_string(canonical_manifest)
        .map_err(|error| format!("failed to read pet manifest: {error}"))?;
    let manifest: Value = serde_json::from_str(&content)
        .map_err(|error| format!("invalid pet manifest JSON: {error}"))?;
    let import_manifest: PetImportManifest = serde_json::from_value(manifest.clone())
        .map_err(|error| format!("invalid pet manifest shape: {error}"))?;
    validate_pet_import_manifest(&import_manifest)?;

    let source_dir = canonical_manifest
        .parent()
        .ok_or_else(|| "pet manifest must have a parent directory".to_string())?;
    let target_name = format!(
        "{}-{}",
        sanitize_pet_path_segment(&import_manifest.id),
        sanitize_pet_path_segment(&import_manifest.version)
    );
    let target_dir = active_pet_dir.join(target_name);
    let staging_dir = active_pet_dir.join(format!(
        ".staging-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| format!("system clock error: {error}"))?
            .as_millis()
    ));

    if staging_dir.exists() {
        std::fs::remove_dir_all(&staging_dir)
            .map_err(|error| format!("failed to clear pet staging directory: {error}"))?;
    }
    std::fs::create_dir_all(&staging_dir)
        .map_err(|error| format!("failed to create pet staging directory: {error}"))?;

    let copy_result = copy_pet_assets(&import_manifest, source_dir, &staging_dir)
        .and_then(|_| write_pet_manifest_copy(&manifest, &staging_dir));
    if let Err(error) = copy_result {
        let _ = std::fs::remove_dir_all(&staging_dir);
        return Err(error);
    }

    if target_dir.exists() {
        std::fs::remove_dir_all(&target_dir)
            .map_err(|error| format!("failed to replace active pet directory: {error}"))?;
    }
    std::fs::rename(&staging_dir, &target_dir)
        .map_err(|error| format!("failed to activate imported pet appearance: {error}"))?;

    let active_manifest = target_dir.join("pet.json");
    Ok(LocalPetImportResult {
        directory: target_dir.display().to_string(),
        path: active_manifest.display().to_string(),
        file_name: "pet.json".to_string(),
    })
}

#[tauri::command]
fn open_local_pets_directory(app: AppHandle) -> Result<(), String> {
    let pet_dir = resolve_pet_dir(&app)?;
    std::fs::create_dir_all(&pet_dir)
        .map_err(|error| format!("failed to create pets directory: {error}"))?;
    open_directory(&pet_dir)
}

fn resolve_skill_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data dir: {error}"))?
        .join("skills"))
}

fn resolve_pet_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data dir: {error}"))?
        .join("pets"))
}

fn resolve_active_pet_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data dir: {error}"))?
        .join("pets-active"))
}

fn append_pet_manifest_entries(
    directory: &Path,
    source: &str,
    entries: &mut Vec<LocalPetManifestEntry>,
) -> Result<(), String> {
    for item in std::fs::read_dir(directory)
        .map_err(|error| format!("failed to read pets directory: {error}"))?
    {
        let item = match item {
            Ok(value) => value,
            Err(error) => {
                entries.push(LocalPetManifestEntry {
                    file_name: "<unknown>".to_string(),
                    path: directory.display().to_string(),
                    source: source.to_string(),
                    manifest: None,
                    error: Some(format!("failed to read directory entry: {error}")),
                });
                continue;
            }
        };
        let path = item.path();
        if let Some(manifest_path) = resolve_pet_manifest_path(&path) {
            entries.push(read_pet_manifest(&manifest_path, source));
        }
    }
    Ok(())
}

fn resolve_skill_manifest_path(path: &Path) -> Option<PathBuf> {
    if path.is_dir() {
        let manifest_path = path.join("skill.json");
        if manifest_path.is_file() {
            return Some(manifest_path);
        }
        return None;
    }

    let file_name = path.file_name()?.to_string_lossy();
    if file_name == "skill.json" || file_name.ends_with(".skill.json") {
        return Some(path.to_path_buf());
    }
    None
}

fn resolve_pet_manifest_path(path: &Path) -> Option<PathBuf> {
    if path.is_dir() {
        let manifest_path = path.join("pet.json");
        if manifest_path.is_file() {
            return Some(manifest_path);
        }
        return None;
    }

    let file_name = path.file_name()?.to_string_lossy();
    if file_name == "pet.json" || file_name.ends_with(".pet.json") {
        return Some(path.to_path_buf());
    }
    None
}

fn read_skill_manifest(path: &Path) -> LocalSkillManifestEntry {
    let file_name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "<unknown>".to_string());
    let path_label = path.display().to_string();
    let metadata = match std::fs::metadata(path) {
        Ok(value) => value,
        Err(error) => {
            return LocalSkillManifestEntry {
                file_name,
                path: path_label,
                manifest: None,
                error: Some(format!("failed to read metadata: {error}")),
            };
        }
    };

    if metadata.len() > MAX_SKILL_MANIFEST_BYTES {
        return LocalSkillManifestEntry {
            file_name,
            path: path_label,
            manifest: None,
            error: Some(format!(
                "manifest is too large: {} bytes, max {} bytes",
                metadata.len(),
                MAX_SKILL_MANIFEST_BYTES
            )),
        };
    }

    match std::fs::read_to_string(path) {
        Ok(content) => match serde_json::from_str::<Value>(&content) {
            Ok(manifest) => LocalSkillManifestEntry {
                file_name,
                path: path_label,
                manifest: Some(manifest),
                error: None,
            },
            Err(error) => LocalSkillManifestEntry {
                file_name,
                path: path_label,
                manifest: None,
                error: Some(format!("invalid JSON: {error}")),
            },
        },
        Err(error) => LocalSkillManifestEntry {
            file_name,
            path: path_label,
            manifest: None,
            error: Some(format!("failed to read manifest: {error}")),
        },
    }
}

fn read_pet_manifest(path: &Path, source: &str) -> LocalPetManifestEntry {
    let file_name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "<unknown>".to_string());
    let path_label = path.display().to_string();
    let metadata = match std::fs::metadata(path) {
        Ok(value) => value,
        Err(error) => {
            return LocalPetManifestEntry {
                file_name,
                path: path_label,
                source: source.to_string(),
                manifest: None,
                error: Some(format!("failed to read metadata: {error}")),
            };
        }
    };

    if metadata.len() > MAX_PET_MANIFEST_BYTES {
        return LocalPetManifestEntry {
            file_name,
            path: path_label,
            source: source.to_string(),
            manifest: None,
            error: Some(format!(
                "manifest is too large: {} bytes, max {} bytes",
                metadata.len(),
                MAX_PET_MANIFEST_BYTES
            )),
        };
    }

    match std::fs::read_to_string(path) {
        Ok(content) => match serde_json::from_str::<Value>(&content) {
            Ok(manifest) => LocalPetManifestEntry {
                file_name,
                path: path_label,
                source: source.to_string(),
                manifest: Some(manifest),
                error: None,
            },
            Err(error) => LocalPetManifestEntry {
                file_name,
                path: path_label,
                source: source.to_string(),
                manifest: None,
                error: Some(format!("invalid JSON: {error}")),
            },
        },
        Err(error) => LocalPetManifestEntry {
            file_name,
            path: path_label,
            source: source.to_string(),
            manifest: None,
            error: Some(format!("failed to read manifest: {error}")),
        },
    }
}

fn copy_pet_assets(
    manifest: &PetImportManifest,
    source_dir: &Path,
    staging_dir: &Path,
) -> Result<(), String> {
    let mut assets = vec![manifest.assets.default.as_str()];
    if let Some(thumbnail) = manifest.thumbnail.as_deref() {
        assets.push(thumbnail);
    }
    if let Some(states) = &manifest.assets.states {
        for (state, value) in states {
            validate_pet_state_name(state)?;
            assets.push(value);
        }
    }

    assets.sort_unstable();
    assets.dedup();

    for asset in assets {
        let relative = validate_pet_asset_path(asset)?;
        let source = source_dir.join(&relative);
        let metadata = std::fs::metadata(&source)
            .map_err(|error| format!("failed to read pet asset metadata for {asset}: {error}"))?;
        if !metadata.is_file() {
            return Err(format!("pet asset is not a file: {asset}"));
        }
        if metadata.len() > MAX_PET_ASSET_BYTES {
            return Err(format!(
                "pet asset is too large: {asset} is {} bytes, max {} bytes",
                metadata.len(),
                MAX_PET_ASSET_BYTES
            ));
        }

        let destination = staging_dir.join(&relative);
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                format!("failed to create pet asset directory for {asset}: {error}")
            })?;
        }
        std::fs::copy(&source, &destination)
            .map_err(|error| format!("failed to copy pet asset {asset}: {error}"))?;
    }
    Ok(())
}

fn validate_pet_import_manifest(manifest: &PetImportManifest) -> Result<(), String> {
    validate_pet_id(&manifest.id)?;
    if manifest.display_name.trim().is_empty() {
        return Err("pet displayName is required".to_string());
    }
    if manifest.author.trim().is_empty() {
        return Err("pet author is required".to_string());
    }
    if manifest.version.trim().is_empty() {
        return Err("pet version is required".to_string());
    }
    if manifest.license.trim().is_empty() {
        return Err("pet license is required".to_string());
    }
    if !manifest.default_scale.is_finite()
        || manifest.default_scale <= 0.0
        || manifest.default_scale > 3.0
    {
        return Err("pet defaultScale must be a number between 0 and 3".to_string());
    }
    if let Some(states) = &manifest.assets.states {
        for state in states.keys() {
            validate_pet_state_name(state)?;
        }
    }
    Ok(())
}

fn write_pet_manifest_copy(manifest: &Value, staging_dir: &Path) -> Result<(), String> {
    let content = serde_json::to_string_pretty(manifest)
        .map_err(|error| format!("failed to serialize pet manifest: {error}"))?;
    std::fs::write(staging_dir.join("pet.json"), format!("{content}\n"))
        .map_err(|error| format!("failed to write active pet manifest: {error}"))
}

fn validate_pet_state_name(value: &str) -> Result<(), String> {
    if matches!(
        value,
        "no_task"
            | "processing"
            | "idle"
            | "missing_info"
            | "deadline_near"
            | "overdue"
            | "task_done"
    ) {
        Ok(())
    } else {
        Err(format!("unsupported pet state asset: {value}"))
    }
}

fn validate_pet_id(value: &str) -> Result<(), String> {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return Err("pet id is required".to_string());
    };
    if !first.is_ascii_lowercase() && !first.is_ascii_digit() {
        return Err("pet id must start with a lowercase letter or digit".to_string());
    }
    if value.len() < 2 || value.len() > 64 {
        return Err("pet id must be 2 to 64 characters".to_string());
    }
    if !value.chars().all(|character| {
        character.is_ascii_lowercase()
            || character.is_ascii_digit()
            || matches!(character, '.' | '_' | '-')
    }) {
        return Err(
            "pet id must only contain lowercase letters, digits, dot, underscore, or hyphen"
                .to_string(),
        );
    }
    Ok(())
}

fn sanitize_pet_path_segment(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || matches!(character, '.' | '_' | '-')
            {
                character
            } else {
                '-'
            }
        })
        .collect()
}

fn validate_pet_asset_path(value: &str) -> Result<PathBuf, String> {
    if value.trim().is_empty() {
        return Err("pet asset path is required".to_string());
    }
    if value.contains('\0') {
        return Err("pet asset path contains an invalid null byte".to_string());
    }
    if looks_like_url_or_scheme(value) {
        return Err(format!("pet asset must be a local relative path: {value}"));
    }

    let path = Path::new(value);
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(segment) => normalized.push(segment),
            _ => {
                return Err(format!(
                    "pet asset must stay inside the pet package: {value}"
                ))
            }
        }
    }
    if normalized.as_os_str().is_empty() {
        return Err("pet asset path is required".to_string());
    }

    let extension = normalized
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "svg" | "png" | "webp" | "gif" | "apng") {
        return Err(format!("pet asset uses an unsupported extension: {value}"));
    }
    Ok(normalized)
}

fn looks_like_url_or_scheme(value: &str) -> bool {
    let Some(colon_index) = value.find(':') else {
        return false;
    };
    let slash_index = value.find('/').unwrap_or(value.len());
    let backslash_index = value.find('\\').unwrap_or(value.len());
    if colon_index > slash_index.min(backslash_index) {
        return false;
    }
    let scheme = &value[..colon_index];
    let mut chars = scheme.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    first.is_ascii_alphabetic()
        && chars.all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '+' | '-' | '.')
        })
}

fn open_directory(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(path);
        command
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("explorer");
        command.arg(path);
        command
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(path);
        command
    };

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("failed to open skills directory: {error}"))
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let open_main = MenuItem::with_id(app, "open_main", "打开日程", true, None::<&str>)?;
    let quick_input = MenuItem::with_id(app, "quick_input", "快速输入", true, None::<&str>)?;
    let toggle_pet = MenuItem::with_id(app, "toggle_pet", "显示/隐藏桌宠", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_main, &quick_input, &toggle_pet, &quit])?;

    let mut tray = TrayIconBuilder::with_id("dueflow")
        .tooltip("DueFlow Desktop")
        .menu(&menu)
        .show_menu_on_left_click(false);
    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }
    tray.build(app)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_pet_appearance_into_active_directory() {
        let root = test_temp_dir("pet-import-success");
        let pet_dir = root.join("pets");
        let active_dir = root.join("pets-active");
        let source_dir = pet_dir.join("local");
        std::fs::create_dir_all(source_dir.join("states")).unwrap();
        std::fs::create_dir_all(&active_dir).unwrap();
        std::fs::write(source_dir.join("idle.svg"), "<svg>idle</svg>").unwrap();
        std::fs::write(source_dir.join("thumb.png"), "thumb").unwrap();
        std::fs::write(source_dir.join("states").join("near.webp"), "near").unwrap();
        let manifest_path = source_dir.join("pet.json");
        write_test_pet_manifest(
            &manifest_path,
            serde_json::json!({
                "id": "local.pet",
                "displayName": "Local Pet",
                "author": "DueFlow Test",
                "version": "1.0.0",
                "license": "CC-BY-4.0",
                "defaultScale": 1.0,
                "thumbnail": "thumb.png",
                "assets": {
                    "default": "idle.svg",
                    "states": {
                        "deadline_near": "states/near.webp"
                    }
                }
            }),
        );

        let canonical_manifest = manifest_path.canonicalize().unwrap();
        let canonical_pet_dir = pet_dir.canonicalize().unwrap();
        let result = import_pet_appearance_from_manifest(
            &canonical_manifest,
            &canonical_pet_dir,
            &active_dir,
        )
        .unwrap();
        let active_manifest = PathBuf::from(result.path);

        assert_eq!(result.file_name, "pet.json");
        assert_eq!(
            active_manifest.parent().unwrap().file_name().unwrap(),
            "local.pet-1.0.0"
        );
        assert!(active_manifest.is_file());
        assert_eq!(
            std::fs::read_to_string(active_manifest.parent().unwrap().join("idle.svg")).unwrap(),
            "<svg>idle</svg>"
        );
        assert_eq!(
            std::fs::read_to_string(active_manifest.parent().unwrap().join("thumb.png")).unwrap(),
            "thumb"
        );
        assert_eq!(
            std::fs::read_to_string(
                active_manifest
                    .parent()
                    .unwrap()
                    .join("states")
                    .join("near.webp")
            )
            .unwrap(),
            "near"
        );

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_pet_import_preserves_existing_active_copy() {
        let root = test_temp_dir("pet-import-rollback");
        let pet_dir = root.join("pets");
        let active_dir = root.join("pets-active");
        let source_dir = pet_dir.join("local");
        let existing_dir = active_dir.join("local.pet-1.0.0");
        std::fs::create_dir_all(&source_dir).unwrap();
        std::fs::create_dir_all(&existing_dir).unwrap();
        std::fs::write(existing_dir.join("pet.json"), "old manifest").unwrap();
        std::fs::write(existing_dir.join("idle.svg"), "old idle").unwrap();
        std::fs::write(source_dir.join("idle.svg"), "new idle").unwrap();
        let manifest_path = source_dir.join("pet.json");
        write_test_pet_manifest(
            &manifest_path,
            serde_json::json!({
                "id": "local.pet",
                "displayName": "Local Pet",
                "author": "DueFlow Test",
                "version": "1.0.0",
                "license": "CC-BY-4.0",
                "defaultScale": 1.0,
                "assets": {
                    "default": "idle.svg",
                    "states": {
                        "deadline_near": "missing.webp"
                    }
                }
            }),
        );

        let canonical_manifest = manifest_path.canonicalize().unwrap();
        let canonical_pet_dir = pet_dir.canonicalize().unwrap();
        let error = import_pet_appearance_from_manifest(
            &canonical_manifest,
            &canonical_pet_dir,
            &active_dir,
        )
        .unwrap_err();

        assert!(error.contains("missing.webp"));
        assert_eq!(
            std::fs::read_to_string(existing_dir.join("pet.json")).unwrap(),
            "old manifest"
        );
        assert_eq!(
            std::fs::read_to_string(existing_dir.join("idle.svg")).unwrap(),
            "old idle"
        );
        assert!(!std::fs::read_dir(&active_dir).unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".staging-")));

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_pet_imports_outside_local_pet_directory() {
        let root = test_temp_dir("pet-import-boundary");
        let pet_dir = root.join("pets");
        let active_dir = root.join("pets-active");
        let outside_dir = root.join("outside");
        std::fs::create_dir_all(&pet_dir).unwrap();
        std::fs::create_dir_all(&active_dir).unwrap();
        std::fs::create_dir_all(&outside_dir).unwrap();
        let manifest_path = outside_dir.join("pet.json");
        write_test_pet_manifest(
            &manifest_path,
            serde_json::json!({
                "id": "outside.pet",
                "displayName": "Outside Pet",
                "author": "DueFlow Test",
                "version": "1.0.0",
                "license": "CC-BY-4.0",
                "defaultScale": 1.0,
                "assets": {
                    "default": "idle.svg"
                }
            }),
        );

        let error = import_pet_appearance_from_manifest(
            &manifest_path.canonicalize().unwrap(),
            &pet_dir.canonicalize().unwrap(),
            &active_dir,
        )
        .unwrap_err();

        assert!(error.contains("local pets directory"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn validates_safe_pet_asset_paths() {
        assert_eq!(
            validate_pet_asset_path("states/idle.svg").unwrap(),
            PathBuf::from("states").join("idle.svg")
        );
        assert_eq!(
            validate_pet_asset_path("thumb.apng").unwrap(),
            PathBuf::from("thumb.apng")
        );
    }

    #[test]
    fn rejects_unsafe_pet_asset_paths() {
        assert!(validate_pet_asset_path("https://example.com/pet.svg").is_err());
        assert!(validate_pet_asset_path("../pet.svg").is_err());
        assert!(validate_pet_asset_path("/tmp/pet.svg").is_err());
        assert!(validate_pet_asset_path("states/pet.txt").is_err());
    }

    #[test]
    fn validates_pet_ids_for_active_directory_names() {
        assert!(validate_pet_id("dueflow.default").is_ok());
        assert!(validate_pet_id("DueFlow").is_err());
        assert!(validate_pet_id("x").is_err());
        assert_eq!(
            sanitize_pet_path_segment("dueflow.default-1"),
            "dueflow.default-1"
        );
    }

    fn test_temp_dir(label: &str) -> PathBuf {
        let id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path =
            env::temp_dir().join(format!("dueflow-tauri-{label}-{}-{id}", std::process::id()));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn write_test_pet_manifest(path: &Path, manifest: Value) {
        std::fs::write(
            path,
            format!("{}\n", serde_json::to_string_pretty(&manifest).unwrap()),
        )
        .unwrap();
    }
}

fn show_main(app: &AppHandle) -> Result<(), String> {
    if schedule_surface_mode() == "windows_drawer" {
        position_schedule_surface(app, false)
    } else {
        show_floating_schedule_surface(app)
    }
}

fn focus_quick_input(app: &AppHandle) -> Result<(), String> {
    show_main(app)?;
    app.emit_to("main", QUICK_INPUT_EVENT, ())
        .map_err(|error| error.to_string())
}

fn initialize_schedule_surface(app: &AppHandle) -> Result<(), String> {
    match schedule_surface_mode() {
        "windows_drawer" => position_schedule_surface(app, true),
        _ => Ok(()),
    }
}

fn show_floating_schedule_surface(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is not available".to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}

fn position_schedule_surface(app: &AppHandle, collapsed: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is not available".to_string())?;
    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or(window
            .primary_monitor()
            .map_err(|error| error.to_string())?)
        .ok_or_else(|| "no monitor is available for schedule window".to_string())?;
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let window_size = window.outer_size().map_err(|error| error.to_string())?;
    let visible_strip = 14_i32;
    let margin = 18_i32;
    let window_width = window_size.width as i32;
    let window_height = window_size.height as i32;
    let monitor_x = monitor_position.x;
    let monitor_y = monitor_position.y;
    let monitor_width = monitor_size.width as i32;
    let monitor_height = monitor_size.height as i32;

    let (x, y) = match schedule_surface_mode() {
        "windows_drawer" if collapsed => (
            monitor_x + monitor_width - visible_strip,
            monitor_y + ((monitor_height - window_height) / 2).max(margin),
        ),
        "windows_drawer" => (
            monitor_x + monitor_width - window_width - margin,
            monitor_y + ((monitor_height - window_height) / 2).max(margin),
        ),
        _ => (
            monitor_x + monitor_width - window_width - margin,
            monitor_y + margin,
        ),
    };

    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    if !collapsed {
        window.set_focus().map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn schedule_surface_mode() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows_drawer"
    } else {
        "floating"
    }
}

fn toggle_pet(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("pet")
        .ok_or_else(|| "pet window is not available".to_string())?;
    let is_visible = window.is_visible().map_err(|error| error.to_string())?;
    if is_visible {
        window.hide().map_err(|error| error.to_string())
    } else {
        window.show().map_err(|error| error.to_string())
    }
}

fn ensure_backend(paths: &BackendPaths) -> Result<BackendLaunch, String> {
    let host = env::var("DUEFLOW_API_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port = env::var("DUEFLOW_API_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(8000);

    if env_flag("DUEFLOW_SKIP_BACKEND_AUTOSTART") {
        return Ok(BackendLaunch {
            child: None,
            status: BackendStatus::new(paths, "skipped", "env", &host, port, None, None),
        });
    }

    if backend_ready(&host, port) {
        return Ok(BackendLaunch {
            child: None,
            status: BackendStatus::new(paths, "ready", "existing_service", &host, port, None, None),
        });
    }

    let project_root = find_project_root()
        .ok_or_else(|| "could not find project root containing api/desktop.py".to_string())?;
    let backend_command = env::var("DUEFLOW_BACKEND_CMD").unwrap_or_else(|_| {
        format!(
            "exec conda run -n dueflow python -m uvicorn api.desktop:app --host {host} --port {port}"
        )
    });
    let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    let mut child = Command::new(shell)
        .arg("-lc")
        .arg(&backend_command)
        .current_dir(project_root)
        .env("DATABASE_PATH", &paths.database_path)
        .env("INBOX_PATH", &paths.inbox_path)
        .env("EXPORT_PATH", &paths.export_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("failed to spawn backend process: {error}"))?;

    for _ in 0..30 {
        if backend_ready(&host, port) {
            return Ok(BackendLaunch {
                child: Some(child),
                status: BackendStatus::new(
                    paths,
                    "ready",
                    "managed_process",
                    &host,
                    port,
                    Some(backend_command),
                    None,
                ),
            });
        }
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!(
                "backend process exited before becoming ready: {status}"
            ));
        }
        thread::sleep(Duration::from_millis(500));
    }

    Ok(BackendLaunch {
        child: Some(child),
        status: BackendStatus::new(
            paths,
            "starting",
            "managed_process",
            &host,
            port,
            Some(backend_command),
            Some("backend process is still starting after readiness timeout".to_string()),
        ),
    })
}

fn backend_ready(host: &str, port: u16) -> bool {
    let address = format!("{host}:{port}");
    let Ok(socket_address) = address.parse::<SocketAddr>() else {
        return false;
    };
    TcpStream::connect_timeout(&socket_address, Duration::from_millis(250)).is_ok()
}

fn find_project_root() -> Option<PathBuf> {
    if let Ok(root) = env::var("DUEFLOW_PROJECT_ROOT") {
        let path = PathBuf::from(root);
        if is_project_root(&path) {
            return Some(path);
        }
    }

    let mut candidates = Vec::new();
    if let Ok(current_dir) = env::current_dir() {
        candidates.push(current_dir);
    }
    if let Ok(executable) = env::current_exe() {
        if let Some(parent) = executable.parent() {
            candidates.push(parent.to_path_buf());
        }
    }
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")));

    candidates
        .into_iter()
        .find_map(|candidate| find_project_root_from(&candidate))
}

fn find_project_root_from(start: &Path) -> Option<PathBuf> {
    for ancestor in start.ancestors() {
        if is_project_root(ancestor) {
            return Some(ancestor.to_path_buf());
        }
    }
    None
}

fn is_project_root(path: &Path) -> bool {
    path.join("api/desktop.py").is_file() && path.join("desktop/package.json").is_file()
}

fn env_flag(name: &str) -> bool {
    env::var(name)
        .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
        .unwrap_or(false)
}
