use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::ugdm::entities::{
    BuildConfig,
    Entity,
    PaletteEntry,
    Project,
    Resolution,
    Scene,
    CURRENT_SCHEMA_VERSION,
};
#[cfg(test)]
use crate::ugdm::entities::{RetroFXConfig, RetroFXParallaxLayer, RetroFXRasterLine};

pub const UGDM_VERSION: &str = "1.0.0";
pub const DEFAULT_ENTRY_SCENE: &str = "scenes/main.json";
pub const DEFAULT_SCENE_ID: &str = "main";

#[derive(Debug)]
pub struct LoadError(pub String);

impl std::fmt::Display for LoadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for LoadError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TargetSpec {
    pub target: &'static str,
    pub resolution_width: u32,
    pub resolution_height: u32,
    pub palette_mode: &'static str,
    pub rom_extensions: &'static [&'static str],
}

impl TargetSpec {
    pub fn resolution(self) -> Resolution {
        Resolution {
            width: self.resolution_width,
            height: self.resolution_height,
        }
    }
}

pub fn target_spec(target: &str) -> Result<TargetSpec, LoadError> {
    match target {
        "megadrive" => Ok(TargetSpec {
            target: "megadrive",
            resolution_width: 320,
            resolution_height: 224,
            palette_mode: "4x16",
            rom_extensions: &["md", "bin", "gen"],
        }),
        "snes" => Ok(TargetSpec {
            target: "snes",
            resolution_width: 256,
            resolution_height: 224,
            palette_mode: "8x16",
            rom_extensions: &["sfc", "smc"],
        }),
        other => Err(LoadError(format!(
            "project.rds: target '{}' nao reconhecido. Valores aceitos: 'megadrive', 'snes'.",
            other
        ))),
    }
}

pub fn default_build_config() -> BuildConfig {
    BuildConfig {
        output_dir: "build/".to_string(),
        optimization: "size".to_string(),
    }
}

pub fn canonical_project(project_name: &str, target: &str) -> Result<Project, LoadError> {
    let trimmed_name = project_name.trim();
    if trimmed_name.is_empty() {
        return Err(LoadError("project.rds: campo 'name' nao pode ser vazio.".into()));
    }

    let spec = target_spec(target)?;

    Ok(Project {
        rds_version: UGDM_VERSION.to_string(),
        schema_version: CURRENT_SCHEMA_VERSION.to_string(),
        name: trimmed_name.to_string(),
        target: spec.target.to_string(),
        resolution: spec.resolution(),
        fps: 60,
        palette_mode: spec.palette_mode.to_string(),
        entry_scene: DEFAULT_ENTRY_SCENE.to_string(),
        build: Some(default_build_config()),
    })
}

pub fn canonical_scene(scene_id: &str, display_name: Option<String>) -> Scene {
    Scene {
        scene_id: scene_id.trim().to_string(),
        schema_version: Some(CURRENT_SCHEMA_VERSION.to_string()),
        display_name,
        background_layers: Vec::new(),
        entities: Vec::new(),
        palettes: Vec::new(),
        retrofx: None,
    }
}

pub fn create_project_skeleton(
    project_dir: &Path,
    project_name: &str,
    target: &str,
) -> Result<Project, LoadError> {
    let project = canonical_project(project_name, target)?;

    for dir in [
        project_dir.to_path_buf(),
        project_dir.join("scenes"),
        project_dir.join("assets"),
        project_dir.join("assets").join("sprites"),
        project_dir.join("assets").join("tilesets"),
        project_dir.join("assets").join("audio"),
        project_dir.join("prefabs"),
        project_dir.join("graphs"),
    ] {
        fs::create_dir_all(&dir).map_err(|e| {
            LoadError(format!("Nao foi possivel criar '{}': {}", dir.display(), e))
        })?;
    }

    let scene = canonical_scene(DEFAULT_SCENE_ID, Some("Main Scene".to_string()));
    save_project(project_dir, &project)?;
    save_scene(project_dir, &project.entry_scene, &scene)?;

    Ok(project)
}

pub fn save_project(project_dir: &Path, project: &Project) -> Result<(), LoadError> {
    let project = migrate_project(project.clone());
    validate_project(&project)?;
    write_json(project_dir.join("project.rds"), &project)
}

pub fn save_scene(project_dir: &Path, scene_path: &str, scene: &Scene) -> Result<(), LoadError> {
    validate_scene_path(scene_path)?;
    let scene = migrate_scene(scene.clone());
    validate_scene(&scene)?;
    write_json(project_dir.join(scene_path), &scene)
}

pub fn update_project_target(project_dir: &Path, target: &str) -> Result<Project, LoadError> {
    let mut project = load_project(project_dir)?;
    let spec = target_spec(target)?;

    project.target = spec.target.to_string();
    project.resolution = spec.resolution();
    project.palette_mode = spec.palette_mode.to_string();

    save_project(project_dir, &project)?;
    Ok(project)
}

/// Le e desserializa o arquivo `project.rds` de um diretorio de projeto.
pub fn load_project(project_dir: &Path) -> Result<Project, LoadError> {
    let rds_path = project_dir.join("project.rds");

    let content = fs::read_to_string(&rds_path).map_err(|e| {
        LoadError(format!(
            "Nao foi possivel ler '{}': {}",
            rds_path.display(),
            e
        ))
    })?;

    let project: Project = serde_json::from_str(&content).map_err(|e| {
        LoadError(format!(
            "project.rds invalido (erro de parsing JSON): {}",
            e
        ))
    })?;
    let project = migrate_project(project);

    validate_project(&project)?;
    Ok(project)
}

/// Le e desserializa um arquivo de cena (ex: `scenes/level_01.json`).
pub fn load_scene(project_dir: &Path, scene_path: &str) -> Result<Scene, LoadError> {
    validate_scene_path(scene_path)?;

    let full_path = project_dir.join(scene_path);

    let content = fs::read_to_string(&full_path).map_err(|e| {
        LoadError(format!(
            "Nao foi possivel ler cena '{}': {}",
            full_path.display(),
            e
        ))
    })?;

    let scene: Scene = serde_json::from_str(&content).map_err(|e| {
        LoadError(format!(
            "Cena '{}' invalida (erro de parsing JSON): {}",
            scene_path, e
        ))
    })?;
    let scene = migrate_scene(scene);

    validate_scene(&scene)?;
    Ok(scene)
}

pub fn resolve_prefabs(project_dir: &Path, scene: &Scene) -> Result<Scene, LoadError> {
    let entities = scene
        .entities
        .iter()
        .map(|entity| {
            let mut stack = Vec::new();
            resolve_entity_prefab(project_dir, entity, &mut stack)
        })
        .collect::<Result<Vec<_>, _>>()?;

    Ok(Scene {
        entities,
        ..scene.clone()
    })
}

pub fn migrate_project(mut project: Project) -> Project {
    let schema_version = normalized_project_schema_version(&project).to_string();
    if project.schema_version.trim().is_empty() {
        project.schema_version = schema_version.clone();
    }
    if let Some(warning) = schema_warning_message("project.rds", &schema_version) {
        eprintln!("{warning}");
    }
    project
}

pub fn migrate_scene(mut scene: Scene) -> Scene {
    let schema_version = normalized_scene_schema_version(&scene).to_string();
    if scene
        .schema_version
        .as_deref()
        .map(str::trim)
        .unwrap_or_default()
        .is_empty()
    {
        scene.schema_version = Some(schema_version.clone());
    }
    if let Some(warning) = schema_warning_message("scene", &schema_version) {
        eprintln!("{warning}");
    }
    scene
}

/// Validacoes semanticas do Project (alem do parsing JSON).
pub fn validate_project(project: &Project) -> Result<(), LoadError> {
    if project.rds_version != UGDM_VERSION {
        return Err(LoadError(format!(
            "project.rds: rds_version '{}' incompatível. Esperado '{}'.",
            project.rds_version, UGDM_VERSION
        )));
    }

    if project.name.trim().is_empty() {
        return Err(LoadError("project.rds: campo 'name' nao pode ser vazio.".into()));
    }

    let spec = target_spec(&project.target)?;
    let expected_resolution = spec.resolution();
    if project.resolution != expected_resolution {
        return Err(LoadError(format!(
            "project.rds: resolution invalida para '{}'. Esperado {}x{}, recebido {}x{}.",
            spec.target,
            expected_resolution.width,
            expected_resolution.height,
            project.resolution.width,
            project.resolution.height
        )));
    }

    if project.palette_mode != spec.palette_mode {
        return Err(LoadError(format!(
            "project.rds: palette_mode invalido para '{}'. Esperado '{}', recebido '{}'.",
            spec.target,
            spec.palette_mode,
            project.palette_mode
        )));
    }

    if project.fps != 50 && project.fps != 60 {
        return Err(LoadError(format!(
            "project.rds: fps '{}' invalido. Use 60 (NTSC) ou 50 (PAL).",
            project.fps
        )));
    }

    validate_scene_path(&project.entry_scene)?;

    if let Some(build) = &project.build {
        validate_build_config(build)?;
    }

    Ok(())
}

fn normalized_project_schema_version(project: &Project) -> &str {
    let version = project.schema_version.trim();
    if version.is_empty() {
        CURRENT_SCHEMA_VERSION
    } else {
        version
    }
}

fn normalized_scene_schema_version(scene: &Scene) -> &str {
    scene
        .schema_version
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(CURRENT_SCHEMA_VERSION)
}

fn schema_warning_message(scope: &str, version: &str) -> Option<String> {
    (version != CURRENT_SCHEMA_VERSION).then(|| {
        format!(
            "{}: schema_version '{}' desconhecida. Aplicando migracao pass-through.",
            scope, version
        )
    })
}

pub fn validate_scene(scene: &Scene) -> Result<(), LoadError> {
    if scene.scene_id.trim().is_empty() {
        return Err(LoadError("scene: campo 'scene_id' nao pode ser vazio.".into()));
    }

    ensure_unique_ids(
        "entity_id",
        scene.entities.iter().map(|entity| entity.entity_id.as_str()),
    )?;
    ensure_unique_ids(
        "layer_id",
        scene
            .background_layers
            .iter()
            .map(|layer| layer.layer_id.as_str()),
    )?;

    let mut seen_palette_slots = HashSet::new();
    for PaletteEntry { slot, .. } in &scene.palettes {
        if !seen_palette_slots.insert(*slot) {
            return Err(LoadError(format!(
                "scene '{}': slot de paleta duplicado: {}.",
                scene.scene_id, slot
            )));
        }
    }

    Ok(())
}

fn validate_build_config(build: &BuildConfig) -> Result<(), LoadError> {
    if build.output_dir.trim().is_empty() {
        return Err(LoadError(
            "project.rds: build.output_dir nao pode ser vazio.".into(),
        ));
    }

    match build.optimization.as_str() {
        "size" | "speed" | "debug" => Ok(()),
        other => Err(LoadError(format!(
            "project.rds: build.optimization '{}' invalido. Use 'size', 'speed' ou 'debug'.",
            other
        ))),
    }
}

fn validate_scene_path(scene_path: &str) -> Result<(), LoadError> {
    let trimmed = scene_path.trim();
    if trimmed.is_empty() {
        return Err(LoadError(
            "project.rds: 'entry_scene' nao pode ser vazio.".into(),
        ));
    }

    let path = Path::new(trimmed);
    if path.is_absolute() {
        return Err(LoadError(format!(
            "project.rds: caminho '{}' deve ser relativo ao projeto.",
            trimmed
        )));
    }

    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir | Component::RootDir | Component::Prefix(_)))
    {
        return Err(LoadError(format!(
            "project.rds: caminho '{}' nao pode sair da raiz do projeto.",
            trimmed
        )));
    }

    match path.components().next() {
        Some(Component::Normal(segment)) if segment == "scenes" => {}
        _ => {
            return Err(LoadError(format!(
                "project.rds: entry_scene '{}' deve ficar dentro de 'scenes/'.",
                trimmed
            )))
        }
    }

    if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
        return Err(LoadError(format!(
            "project.rds: entry_scene '{}' deve apontar para um arquivo .json.",
            trimmed
        )));
    }

    Ok(())
}

fn ensure_unique_ids<'a>(
    field_name: &str,
    ids: impl Iterator<Item = &'a str>,
) -> Result<(), LoadError> {
    let mut seen = HashSet::new();

    for id in ids {
        if id.trim().is_empty() {
            return Err(LoadError(format!(
                "scene: campo '{}' nao pode ser vazio.",
                field_name
            )));
        }

        if !seen.insert(id.to_string()) {
            return Err(LoadError(format!(
                "scene: '{}' duplicado: '{}'.",
                field_name, id
            )));
        }
    }

    Ok(())
}

fn resolve_entity_prefab(
    project_dir: &Path,
    entity: &Entity,
    stack: &mut Vec<String>,
) -> Result<Entity, LoadError> {
    let Some(prefab_ref) = entity.prefab.as_deref().map(str::trim).filter(|value| !value.is_empty())
    else {
        return Ok(entity.clone());
    };

    if stack.iter().any(|entry| entry == prefab_ref) {
        return Err(LoadError(format!(
            "Prefab '{}' referencia um ciclo: {} -> {}.",
            prefab_ref,
            stack.join(" -> "),
            prefab_ref
        )));
    }

    stack.push(prefab_ref.to_string());
    let prefab_path = prefab_path(project_dir, prefab_ref)?;
    let prefab_entity = load_prefab_entity(&prefab_path)?;
    let resolved_prefab = resolve_entity_prefab(project_dir, &prefab_entity, stack)?;
    stack.pop();

    merge_entities(&resolved_prefab, entity)
}

fn prefab_path(project_dir: &Path, prefab_ref: &str) -> Result<PathBuf, LoadError> {
    let relative = normalize_prefab_ref(prefab_ref)?;
    let full_path = project_dir.join("prefabs").join(&relative);

    if !full_path.exists() {
        return Err(LoadError(format!(
            "Prefab '{}' nao encontrado em '{}'.",
            prefab_ref,
            full_path.display()
        )));
    }

    Ok(full_path)
}

fn normalize_prefab_ref(prefab_ref: &str) -> Result<PathBuf, LoadError> {
    let trimmed = prefab_ref.trim();
    if trimmed.is_empty() {
        return Err(LoadError("scene: campo 'prefab' nao pode ser vazio.".into()));
    }

    let mut relative = PathBuf::from(trimmed);
    if relative.extension().is_none() {
        relative.set_extension("json");
    }

    if relative.is_absolute()
        || relative.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(LoadError(format!(
            "Prefab '{}' deve usar caminho relativo dentro de 'prefabs/'.",
            prefab_ref
        )));
    }

    Ok(relative)
}

fn load_prefab_entity(prefab_path: &Path) -> Result<Entity, LoadError> {
    let content = fs::read_to_string(prefab_path).map_err(|error| {
        LoadError(format!(
            "Nao foi possivel ler prefab '{}': {}",
            prefab_path.display(),
            error
        ))
    })?;

    serde_json::from_str::<Entity>(&content).map_err(|error| {
        LoadError(format!(
            "Prefab '{}' invalido (erro de parsing JSON): {}",
            prefab_path.display(),
            error
        ))
    })
}

fn merge_entities(base: &Entity, overrides: &Entity) -> Result<Entity, LoadError> {
    let mut merged = serde_json::to_value(base).map_err(|error| {
        LoadError(format!(
            "Nao foi possivel serializar prefab '{}' para merge: {}",
            base.entity_id, error
        ))
    })?;
    let mut override_value = serde_json::to_value(overrides).map_err(|error| {
        LoadError(format!(
            "Nao foi possivel serializar entidade '{}' para merge: {}",
            overrides.entity_id, error
        ))
    })?;

    prune_null_fields(&mut override_value);
    deep_merge_json(&mut merged, override_value);
    serde_json::from_value(merged).map_err(|error| {
        LoadError(format!(
            "Nao foi possivel reconstruir entidade '{}' apos merge de prefab: {}",
            overrides.entity_id, error
        ))
    })
}

fn deep_merge_json(base: &mut serde_json::Value, overrides: serde_json::Value) {
    match (base, overrides) {
        (serde_json::Value::Object(base_map), serde_json::Value::Object(override_map)) => {
            for (key, value) in override_map {
                if let Some(existing) = base_map.get_mut(&key) {
                    deep_merge_json(existing, value);
                } else {
                    base_map.insert(key, value);
                }
            }
        }
        (base_slot, override_value) => {
            *base_slot = override_value;
        }
    }
}

fn prune_null_fields(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            map.retain(|_, child| {
                prune_null_fields(child);
                !child.is_null()
            });
        }
        serde_json::Value::Array(items) => {
            for item in items {
                prune_null_fields(item);
            }
        }
        _ => {}
    }
}

fn write_json<T: serde::Serialize>(path: impl AsRef<Path>, value: &T) -> Result<(), LoadError> {
    let path = path.as_ref();

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            LoadError(format!("Nao foi possivel criar '{}': {}", parent.display(), e))
        })?;
    }

    let json = serde_json::to_string_pretty(value).map_err(|e| {
        LoadError(format!(
            "Nao foi possivel serializar '{}': {}",
            path.display(),
            e
        ))
    })?;

    write_text_atomically(path, &json)
}

fn write_text_atomically(path: &Path, contents: &str) -> Result<(), LoadError> {
    let temp_path = temp_path_for(path);
    let mut file = File::create(&temp_path).map_err(|e| {
        LoadError(format!(
            "Nao foi possivel criar arquivo temporario '{}': {}",
            temp_path.display(),
            e
        ))
    })?;

    if let Err(error) = file
        .write_all(contents.as_bytes())
        .and_then(|_| file.sync_all())
    {
        let _ = fs::remove_file(&temp_path);
        return Err(LoadError(format!(
            "Nao foi possivel gravar '{}': {}",
            path.display(),
            error
        )));
    }

    drop(file);
    replace_file_atomically(&temp_path, path)?;
    sync_parent_dir(path).map_err(|e| {
        LoadError(format!(
            "Nao foi possivel sincronizar diretorio de '{}': {}",
            path.display(),
            e
        ))
    })
}

fn temp_path_for(path: &Path) -> PathBuf {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("temp");
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();

    parent.join(format!(
        ".{}.tmp-{}-{}",
        file_name,
        std::process::id(),
        nonce
    ))
}

fn replace_file_atomically(temp_path: &Path, destination: &Path) -> Result<(), LoadError> {
    #[cfg(windows)]
    {
        replace_file_atomically_windows(temp_path, destination)?;
    }

    #[cfg(not(windows))]
    {
        fs::rename(temp_path, destination).map_err(|e| {
            let _ = fs::remove_file(temp_path);
            LoadError(format!(
                "Nao foi possivel substituir '{}': {}",
                destination.display(),
                e
            ))
        })?;
    }

    Ok(())
}

#[cfg(windows)]
fn replace_file_atomically_windows(temp_path: &Path, destination: &Path) -> Result<(), LoadError> {
    use std::os::windows::ffi::OsStrExt;

    type Bool = i32;

    unsafe extern "system" {
        fn ReplaceFileW(
            lp_replaced_file_name: *const u16,
            lp_replacement_file_name: *const u16,
            lp_backup_file_name: *const u16,
            dw_replace_flags: u32,
            lp_exclude: *mut core::ffi::c_void,
            lp_reserved: *mut core::ffi::c_void,
        ) -> Bool;
    }

    if destination.exists() {
        let destination_wide: Vec<u16> = destination
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect();
        let temp_wide: Vec<u16> = temp_path
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect();

        let replaced = unsafe {
            ReplaceFileW(
                destination_wide.as_ptr(),
                temp_wide.as_ptr(),
                std::ptr::null(),
                0,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };

        if replaced != 0 {
            return Ok(());
        }

        let error = io::Error::last_os_error();
        let _ = fs::remove_file(temp_path);
        return Err(LoadError(format!(
            "Nao foi possivel substituir '{}': {}",
            destination.display(),
            error
        )));
    }

    fs::rename(temp_path, destination).map_err(|e| {
        let _ = fs::remove_file(temp_path);
        LoadError(format!(
            "Nao foi possivel gravar '{}': {}",
            destination.display(),
            e
        ))
    })
}

#[cfg(unix)]
fn sync_parent_dir(path: &Path) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        File::open(parent)?.sync_all()?;
    }
    Ok(())
}

#[cfg(not(unix))]
fn sync_parent_dir(_path: &Path) -> io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fixture_dir(name: &str) -> std::path::PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("fixtures")
            .join("projects")
            .join(name)
    }

    fn temp_dir(prefix: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "retro-dev-studio-{}-{}-{}",
            prefix,
            std::process::id(),
            nonce
        ));
        fs::create_dir_all(&path).expect("failed to create temp test dir");
        path
    }

    #[test]
    fn canonical_project_matches_megadrive_schema() {
        let project = canonical_project("Dummy", "megadrive").expect("canonical project");

        assert_eq!(project.rds_version, UGDM_VERSION);
        assert_eq!(project.schema_version, CURRENT_SCHEMA_VERSION);
        assert_eq!(project.target, "megadrive");
        assert_eq!(project.resolution, Resolution { width: 320, height: 224 });
        assert_eq!(project.palette_mode, "4x16");
        assert_eq!(project.entry_scene, DEFAULT_ENTRY_SCENE);
        assert_eq!(project.build, Some(default_build_config()));
    }

    #[test]
    fn load_project_accepts_canonical_megadrive_fixture() {
        let project = load_project(&fixture_dir("megadrive_dummy")).expect("load fixture");
        let scene = load_scene(&fixture_dir("megadrive_dummy"), &project.entry_scene)
            .expect("load scene");

        assert_eq!(project.schema_version, CURRENT_SCHEMA_VERSION);
        assert_eq!(project.target, "megadrive");
        assert_eq!(project.resolution, Resolution { width: 320, height: 224 });
        assert_eq!(project.palette_mode, "4x16");
        assert_eq!(scene.scene_id, DEFAULT_SCENE_ID);
        assert_eq!(
            scene.schema_version.as_deref(),
            Some(CURRENT_SCHEMA_VERSION)
        );
    }

    #[test]
    fn load_project_accepts_canonical_snes_fixture() {
        let project = load_project(&fixture_dir("snes_dummy")).expect("load fixture");
        let scene = load_scene(&fixture_dir("snes_dummy"), &project.entry_scene)
            .expect("load scene");

        assert_eq!(project.schema_version, CURRENT_SCHEMA_VERSION);
        assert_eq!(project.target, "snes");
        assert_eq!(project.resolution, Resolution { width: 256, height: 224 });
        assert_eq!(project.palette_mode, "8x16");
        assert_eq!(scene.scene_id, DEFAULT_SCENE_ID);
        assert_eq!(
            scene.schema_version.as_deref(),
            Some(CURRENT_SCHEMA_VERSION)
        );
    }

    #[test]
    fn load_legacy_fixture_without_schema_version_is_backward_compatible() {
        let project_dir = temp_dir("legacy-schema-version");
        fs::create_dir_all(project_dir.join("scenes")).expect("create scenes dir");

        let legacy_project = serde_json::json!({
            "rds_version": UGDM_VERSION,
            "name": "Legacy Schema Project",
            "target": "megadrive",
            "resolution": {
                "width": 320,
                "height": 224
            },
            "fps": 60,
            "palette_mode": "4x16",
            "entry_scene": "scenes/main.json",
            "build": {
                "output_dir": "build/",
                "optimization": "size"
            }
        });
        let legacy_scene = serde_json::json!({
            "scene_id": DEFAULT_SCENE_ID,
            "display_name": "Main Scene",
            "background_layers": [],
            "entities": [],
            "palettes": []
        });

        fs::write(project_dir.join("project.rds"), legacy_project.to_string())
            .expect("write legacy project");
        fs::write(
            project_dir.join("scenes").join("main.json"),
            legacy_scene.to_string(),
        )
        .expect("write legacy scene");

        let project = load_project(&project_dir).expect("load legacy project");
        let scene = load_scene(&project_dir, "scenes/main.json").expect("load legacy scene");

        assert_eq!(project.schema_version, CURRENT_SCHEMA_VERSION);
        assert_eq!(
            scene.schema_version.as_deref(),
            Some(CURRENT_SCHEMA_VERSION)
        );

        let _ = fs::remove_dir_all(project_dir);
    }

    #[test]
    fn unknown_schema_version_produces_warning_message() {
        let project = Project {
            rds_version: UGDM_VERSION.to_string(),
            schema_version: "9.9.9".to_string(),
            name: "Unknown Schema".to_string(),
            target: "megadrive".to_string(),
            resolution: Resolution {
                width: 320,
                height: 224,
            },
            fps: 60,
            palette_mode: "4x16".to_string(),
            entry_scene: DEFAULT_ENTRY_SCENE.to_string(),
            build: Some(default_build_config()),
        };
        let scene = Scene {
            scene_id: DEFAULT_SCENE_ID.to_string(),
            schema_version: Some("9.9.9".to_string()),
            display_name: Some("Main Scene".to_string()),
            background_layers: Vec::new(),
            entities: Vec::new(),
            palettes: Vec::new(),
            retrofx: None,
        };

        let project_warning = schema_warning_message(
            "project.rds",
            normalized_project_schema_version(&project),
        )
        .expect("project warning");
        let scene_warning = schema_warning_message(
            "scene",
            normalized_scene_schema_version(&scene),
        )
        .expect("scene warning");

        assert!(project_warning.contains("schema_version '9.9.9' desconhecida"));
        assert!(scene_warning.contains("schema_version '9.9.9' desconhecida"));
    }

    #[test]
    fn resolve_prefabs_merges_template_with_scene_overrides() {
        let project_dir = fixture_dir("prefab_dummy");
        let project = load_project(&project_dir).expect("load prefab fixture");
        let scene = load_scene(&project_dir, &project.entry_scene).expect("load prefab scene");

        let resolved = resolve_prefabs(&project_dir, &scene).expect("resolve prefabs");
        let entity = resolved.entities.first().expect("resolved entity");
        let sprite = entity
            .components
            .sprite
            .as_ref()
            .expect("sprite inherited from prefab");
        let physics = entity
            .components
            .physics
            .as_ref()
            .expect("physics merged from prefab");

        assert_eq!(entity.entity_id, "hero_instance");
        assert_eq!(entity.prefab.as_deref(), Some("hero.json"));
        assert_eq!(entity.transform.x, 48);
        assert_eq!(entity.transform.y, 80);
        assert_eq!(sprite.asset, "assets/sprites/hero.png");
        assert_eq!(sprite.frame_width, 16);
        assert_eq!(physics.gravity, false);
        assert_eq!(physics.gravity_strength, 3);
        assert_eq!(physics.friction, 4);
        assert_eq!(
            physics.max_velocity.as_ref().map(|velocity| (velocity.x, velocity.y)),
            Some((64, 32))
        );
    }

    #[test]
    fn legacy_new_project_shape_is_rejected() {
        let project_dir = temp_dir("legacy-schema");
        let legacy_json = serde_json::json!({
            "name": "Legacy Project",
            "version": "1.0.0",
            "target": "megadrive",
            "fps": 60,
            "entry_scene": "scenes/main.json"
        });

        fs::write(project_dir.join("project.rds"), legacy_json.to_string())
            .expect("write legacy project");

        let error = load_project(&project_dir).expect_err("legacy schema should fail");
        assert!(
            error
                .to_string()
                .contains("project.rds invalido (erro de parsing JSON)"),
            "unexpected error: {error}"
        );

        let _ = fs::remove_dir_all(project_dir);
    }

    #[test]
    fn create_project_skeleton_writes_canonical_files() {
        let project_dir = temp_dir("create-project");
        let created = create_project_skeleton(&project_dir, "Meu Projeto", "megadrive")
            .expect("create canonical project");
        let loaded = load_project(&project_dir).expect("load project");
        let scene = load_scene(&project_dir, DEFAULT_ENTRY_SCENE).expect("load scene");

        assert_eq!(created, loaded);
        assert_eq!(scene, canonical_scene(DEFAULT_SCENE_ID, Some("Main Scene".to_string())));
        assert!(project_dir.join("assets").join("sprites").exists());
        assert!(project_dir.join("assets").join("tilesets").exists());
        assert!(project_dir.join("assets").join("audio").exists());
        assert!(project_dir.join("prefabs").exists());
        assert!(project_dir.join("graphs").exists());

        let _ = fs::remove_dir_all(project_dir);
    }

    #[test]
    fn save_and_load_scene_preserves_retrofx_config() {
        let project_dir = temp_dir("retrofx-scene");
        let project = create_project_skeleton(&project_dir, "RetroFX Save", "megadrive")
            .expect("create canonical project");
        let mut scene = canonical_scene(DEFAULT_SCENE_ID, Some("Main Scene".to_string()));
        scene.retrofx = Some(RetroFXConfig {
            parallax_layers: vec![RetroFXParallaxLayer {
                id: "p0".to_string(),
                name: "BG1".to_string(),
                speed_x: 2,
                speed_y: 0,
                enabled: true,
            }],
            raster_lines: vec![RetroFXRasterLine {
                id: "r0".to_string(),
                scanline: 96,
                offset_x: 6,
                enabled: true,
            }],
        });

        save_scene(&project_dir, &project.entry_scene, &scene).expect("save retrofx scene");
        let reloaded = load_scene(&project_dir, &project.entry_scene).expect("reload retrofx scene");

        assert_eq!(reloaded.retrofx, scene.retrofx);

        let _ = fs::remove_dir_all(project_dir);
    }

    #[test]
    fn update_project_target_rewrites_resolution_and_palette_mode() {
        let project_dir = temp_dir("switch-target");
        create_project_skeleton(&project_dir, "Switch Test", "megadrive")
            .expect("create canonical project");

        let updated = update_project_target(&project_dir, "snes").expect("switch target");
        let reloaded = load_project(&project_dir).expect("reload project");

        assert_eq!(updated, reloaded);
        assert_eq!(reloaded.target, "snes");
        assert_eq!(reloaded.resolution, Resolution { width: 256, height: 224 });
        assert_eq!(reloaded.palette_mode, "8x16");

        let _ = fs::remove_dir_all(project_dir);
    }

    #[test]
    fn save_project_replaces_existing_file_without_leaking_temp_files() {
        let project_dir = temp_dir("atomic-save");
        let mut project = canonical_project("Atomic Test", "megadrive")
            .expect("canonical project");

        save_project(&project_dir, &project).expect("initial save");
        project.name = "Atomic Test Updated".to_string();
        save_project(&project_dir, &project).expect("second save");

        let file_names: Vec<String> = fs::read_dir(&project_dir)
            .expect("read project dir")
            .map(|entry| {
                entry
                    .expect("dir entry")
                    .file_name()
                    .to_string_lossy()
                    .to_string()
            })
            .collect();

        assert!(file_names.iter().any(|name| name == "project.rds"));
        assert!(
            file_names.iter().all(|name| !name.contains(".tmp-")),
            "temp files leaked: {:?}",
            file_names
        );
        assert_eq!(
            load_project(&project_dir).expect("load updated project").name,
            "Atomic Test Updated"
        );

        let _ = fs::remove_dir_all(project_dir);
    }
}
