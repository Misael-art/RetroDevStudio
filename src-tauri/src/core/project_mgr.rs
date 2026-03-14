use std::collections::{HashMap, HashSet};
use std::cmp::Ordering;
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::ugdm::components::{
    Components,
    LogicComponent,
    SpriteComponent,
};
use crate::ugdm::entities::{
    BuildConfig,
    Entity,
    PaletteEntry,
    PatchAuditEntry,
    Project,
    Resolution,
    Scene,
    CURRENT_SCHEMA_VERSION,
};
#[cfg(test)]
use crate::ugdm::entities::{RetroFXConfig, RetroFXParallaxLayer, RetroFXRasterLine};

pub const UGDM_VERSION: &str = "1.0.0";
pub const LEGACY_SCHEMA_VERSION: &str = "1.0.0";
pub const DEFAULT_ENTRY_SCENE: &str = "scenes/main.json";
pub const DEFAULT_SCENE_ID: &str = "main";
pub const ONBOARDING_SPRITE_ASSET: &str = "assets/sprites/onboarding_player.ppm";
pub const ONBOARDING_SPRITE_SIZE: u32 = 16;

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub struct SceneInfo {
    pub path: String,
    pub scene_id: String,
    pub display_name: String,
}

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
        artifact_prefix: "game".to_string(),
        patch_audit_log: Vec::new(),
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

pub fn list_scenes(project_dir: &Path) -> Result<Vec<SceneInfo>, LoadError> {
    let scenes_dir = project_dir.join("scenes");
    if !scenes_dir.exists() {
        return Ok(Vec::new());
    }

    let mut scenes = Vec::new();
    for entry in fs::read_dir(&scenes_dir).map_err(|error| {
        LoadError(format!(
            "Nao foi possivel listar cenas em '{}': {}",
            scenes_dir.display(),
            error
        ))
    })? {
        let entry = entry.map_err(|error| {
            LoadError(format!(
                "Nao foi possivel iterar diretorio de cenas '{}': {}",
                scenes_dir.display(),
                error
            ))
        })?;
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|extension| extension.to_str()) != Some("json")
        {
            continue;
        }

        let file_name = entry.file_name().to_string_lossy().to_string();
        let relative_path = format!("scenes/{}", file_name);
        let scene = load_scene(project_dir, &relative_path)?;
        scenes.push(scene_info(&relative_path, &scene));
    }

    scenes.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(scenes)
}

pub fn create_scene(project_dir: &Path, display_name: Option<&str>) -> Result<SceneInfo, LoadError> {
    let project = load_project(project_dir)?;
    let label = display_name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("New Scene");
    let scene_id = next_scene_id(project_dir, label);
    let scene_path = format!("scenes/{}.json", scene_id);
    let scene = if onboarding_sprite_path(project_dir).exists() {
        starter_scene(&scene_id, label.to_string(), &project.target)
    } else {
        canonical_scene(&scene_id, Some(label.to_string()))
    };
    save_scene(project_dir, &scene_path, &scene)?;
    Ok(scene_info(&scene_path, &scene))
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

pub fn seed_onboarding_template(
    project_dir: &Path,
    target: &str,
) -> Result<Scene, LoadError> {
    let sprite_absolute_path = onboarding_sprite_path(project_dir);

    fs::write(&sprite_absolute_path, onboarding_sprite_ppm()).map_err(|error| {
        LoadError(format!(
            "Nao foi possivel criar sprite placeholder '{}': {}",
            sprite_absolute_path.display(),
            error
        ))
    })?;
    let scene = starter_scene(
        DEFAULT_SCENE_ID,
        match target {
            "snes" => "SNES Starter Scene".to_string(),
            _ => "Mega Drive Starter Scene".to_string(),
        },
        target,
    );

    save_scene(project_dir, DEFAULT_ENTRY_SCENE, &scene)?;
    Ok(scene)
}

pub fn set_entry_scene(project_dir: &Path, scene_path: &str) -> Result<Project, LoadError> {
    validate_scene_path(scene_path)?;
    let _scene = load_scene(project_dir, scene_path)?;
    let mut project = load_project(project_dir)?;
    project.entry_scene = scene_path.to_string();
    save_project(project_dir, &project)?;
    Ok(project)
}

pub fn append_patch_audit_entry(
    project_dir: &Path,
    entry: PatchAuditEntry,
) -> Result<Project, LoadError> {
    let mut project = load_project(project_dir)?;
    let build = project.build.get_or_insert_with(default_build_config);
    build.patch_audit_log.push(entry);
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

    let project_json: serde_json::Value = serde_json::from_str(&content).map_err(|e| {
        LoadError(format!(
            "project.rds invalido (erro de parsing JSON): {}",
            e
        ))
    })?;
    let project_json = migrate_project_value(project_json)?;
    let project: Project = serde_json::from_value(project_json).map_err(|e| {
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

    let scene_json: serde_json::Value = serde_json::from_str(&content).map_err(|e| {
        LoadError(format!(
            "Cena '{}' invalida (erro de parsing JSON): {}",
            scene_path, e
        ))
    })?;
    let scene_json = migrate_scene_value(scene_json)?;
    let scene: Scene = serde_json::from_value(scene_json).map_err(|e| {
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
    let schema_version = normalize_schema_version(
        normalized_project_schema_version(&project),
        CURRENT_SCHEMA_VERSION,
    );
    project.schema_version = schema_version.clone();
    if let Some(build) = project.build.as_mut() {
        if build.artifact_prefix.trim().is_empty() {
            build.artifact_prefix = default_build_config().artifact_prefix;
        }
    }
    if let Some(warning) = schema_warning_message("project.rds", &schema_version) {
        eprintln!("{warning}");
    }
    project
}

pub fn migrate_scene(mut scene: Scene) -> Scene {
    let schema_version = normalize_schema_version(
        normalized_scene_schema_version(&scene),
        CURRENT_SCHEMA_VERSION,
    );
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
    normalize_onboarding_scene(&mut scene);
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
        LEGACY_SCHEMA_VERSION
    } else {
        version
    }
}

fn onboarding_sprite_path(project_dir: &Path) -> PathBuf {
    project_dir.join("assets").join("sprites").join("onboarding_player.ppm")
}

fn starter_scene(scene_id: &str, display_name: String, _target: &str) -> Scene {
    let logic_graph = onboarding_logic_graph();
    let mut scene = canonical_scene(scene_id, Some(display_name));
    scene.palettes = vec![PaletteEntry {
        slot: 0,
        colors: vec![
            "#102030".to_string(),
            "#2E8B57".to_string(),
            "#F9E2AF".to_string(),
            "#FFFFFF".to_string(),
        ],
    }];
    scene.entities = vec![Entity {
        entity_id: "player".to_string(),
        prefab: None,
        transform: crate::ugdm::entities::Transform { x: 48, y: 64 },
        components: Components {
            sprite: Some(SpriteComponent {
                asset: ONBOARDING_SPRITE_ASSET.to_string(),
                frame_width: ONBOARDING_SPRITE_SIZE,
                frame_height: ONBOARDING_SPRITE_SIZE,
                pivot: None,
                palette_slot: 0,
                animations: HashMap::new(),
                priority: "foreground".to_string(),
            }),
            logic: Some(LogicComponent {
                graph: Some(logic_graph),
                variables: HashMap::new(),
            }),
            ..Components::default()
        },
    }];
    scene
}

fn normalized_scene_schema_version(scene: &Scene) -> &str {
    scene
        .schema_version
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(LEGACY_SCHEMA_VERSION)
}

fn schema_warning_message(scope: &str, version: &str) -> Option<String> {
    if version == CURRENT_SCHEMA_VERSION {
        return None;
    }

    match compare_semver(version, CURRENT_SCHEMA_VERSION) {
        Some(Ordering::Greater) => Some(format!(
            "{}: schema_version '{}' mais nova que o app '{}'. Aplicando migracao pass-through conservadora.",
            scope, version, CURRENT_SCHEMA_VERSION
        )),
        _ => Some(format!(
            "{}: schema_version '{}' desconhecida ou sem migracao disponivel. Aplicando migracao pass-through.",
            scope, version
        )),
    }
}

fn migrate_project_value(mut value: serde_json::Value) -> Result<serde_json::Value, LoadError> {
    let mut version = schema_version_from_value(&value, LEGACY_SCHEMA_VERSION);

    loop {
        match compare_semver(&version, CURRENT_SCHEMA_VERSION) {
            Some(Ordering::Equal) => break,
            Some(Ordering::Greater) => {
                if let Some(warning) = schema_warning_message("project.rds", &version) {
                    eprintln!("{warning}");
                }
                break;
            }
            _ => {}
        }

        value = match version.as_str() {
            "1.0.0" => migrate_project_1_0_0_to_1_1_0(value)?,
            "1.1.0" => migrate_project_1_1_0_to_1_2_0(value)?,
            _ => {
                if let Some(warning) = schema_warning_message("project.rds", &version) {
                    eprintln!("{warning}");
                }
                break;
            }
        };

        version = schema_version_from_value(&value, CURRENT_SCHEMA_VERSION);
    }

    Ok(value)
}

fn migrate_scene_value(mut value: serde_json::Value) -> Result<serde_json::Value, LoadError> {
    let mut version = schema_version_from_value(&value, LEGACY_SCHEMA_VERSION);

    loop {
        match compare_semver(&version, CURRENT_SCHEMA_VERSION) {
            Some(Ordering::Equal) => break,
            Some(Ordering::Greater) => {
                if let Some(warning) = schema_warning_message("scene", &version) {
                    eprintln!("{warning}");
                }
                break;
            }
            _ => {}
        }

        value = match version.as_str() {
            "1.0.0" => migrate_scene_1_0_0_to_1_1_0(value)?,
            "1.1.0" => migrate_scene_1_1_0_to_1_2_0(value)?,
            _ => {
                if let Some(warning) = schema_warning_message("scene", &version) {
                    eprintln!("{warning}");
                }
                break;
            }
        };

        version = schema_version_from_value(&value, CURRENT_SCHEMA_VERSION);
    }

    Ok(value)
}

fn migrate_project_1_0_0_to_1_1_0(
    mut value: serde_json::Value,
) -> Result<serde_json::Value, LoadError> {
    let object = value
        .as_object_mut()
        .ok_or_else(|| LoadError("project.rds invalido: raiz JSON deve ser um objeto.".into()))?;
    object.insert(
        "schema_version".to_string(),
        serde_json::Value::String("1.1.0".to_string()),
    );
    if let Some(build) = object.get_mut("build").and_then(serde_json::Value::as_object_mut) {
        build
            .entry("artifact_prefix".to_string())
            .or_insert_with(|| serde_json::Value::String("game".to_string()));
    }
    Ok(value)
}

fn migrate_project_1_1_0_to_1_2_0(
    mut value: serde_json::Value,
) -> Result<serde_json::Value, LoadError> {
    let object = value
        .as_object_mut()
        .ok_or_else(|| LoadError("project.rds invalido: raiz JSON deve ser um objeto.".into()))?;
    object.insert(
        "schema_version".to_string(),
        serde_json::Value::String("1.2.0".to_string()),
    );
    if let Some(build) = object.get_mut("build").and_then(serde_json::Value::as_object_mut) {
        build
            .entry("patch_audit_log".to_string())
            .or_insert_with(|| serde_json::Value::Array(Vec::new()));
    }
    Ok(value)
}

fn migrate_scene_1_0_0_to_1_1_0(
    mut value: serde_json::Value,
) -> Result<serde_json::Value, LoadError> {
    let object = value
        .as_object_mut()
        .ok_or_else(|| LoadError("scene invalida: raiz JSON deve ser um objeto.".into()))?;
    object.insert(
        "schema_version".to_string(),
        serde_json::Value::String("1.1.0".to_string()),
    );
    Ok(value)
}

fn migrate_scene_1_1_0_to_1_2_0(
    mut value: serde_json::Value,
) -> Result<serde_json::Value, LoadError> {
    let object = value
        .as_object_mut()
        .ok_or_else(|| LoadError("scene invalida: raiz JSON deve ser um objeto.".into()))?;
    object.insert(
        "schema_version".to_string(),
        serde_json::Value::String("1.2.0".to_string()),
    );
    Ok(value)
}

fn schema_version_from_value(value: &serde_json::Value, fallback: &str) -> String {
    value
        .get("schema_version")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .unwrap_or(fallback)
        .to_string()
}

fn normalize_schema_version(version: &str, fallback: &str) -> String {
    match compare_semver(version, fallback) {
        Some(Ordering::Less) | None if version.trim().is_empty() => fallback.to_string(),
        Some(Ordering::Less) => fallback.to_string(),
        _ => version.to_string(),
    }
}

fn compare_semver(left: &str, right: &str) -> Option<Ordering> {
    fn parse(value: &str) -> Option<(u32, u32, u32)> {
        let mut parts = value.split('.');
        let major = parts.next()?.parse().ok()?;
        let minor = parts.next()?.parse().ok()?;
        let patch = parts.next()?.parse().ok()?;
        if parts.next().is_some() {
            return None;
        }
        Some((major, minor, patch))
    }

    Some(parse(left)?.cmp(&parse(right)?))
}

fn scene_info(scene_path: &str, scene: &Scene) -> SceneInfo {
    SceneInfo {
        path: scene_path.to_string(),
        scene_id: scene.scene_id.clone(),
        display_name: scene
            .display_name
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| scene.scene_id.clone()),
    }
}

fn next_scene_id(project_dir: &Path, seed: &str) -> String {
    let base = slugify_scene_id(seed);
    let mut candidate = base.clone();
    let mut suffix = 2usize;

    while project_dir
        .join("scenes")
        .join(format!("{}.json", candidate))
        .exists()
    {
        candidate = format!("{}_{}", base, suffix);
        suffix += 1;
    }

    candidate
}

fn normalize_asset_path(path: &str) -> String {
    path.replace('\\', "/")
}

fn is_onboarding_sprite_asset(path: &str) -> bool {
    normalize_asset_path(path).eq_ignore_ascii_case(ONBOARDING_SPRITE_ASSET)
}

fn onboarding_logic_graph() -> String {
    serde_json::json!({
        "version": 1,
        "nodes": [
            {
                "id": "start",
                "type": "event_start",
                "label": "On Start",
                "x": 40,
                "y": 80,
                "inputs": [],
                "outputs": [
                    { "id": "exec", "label": "->", "kind": "exec" }
                ],
                "params": {}
            },
            {
                "id": "move",
                "type": "sprite_move",
                "label": "Move Sprite",
                "x": 240,
                "y": 80,
                "inputs": [
                    { "id": "exec", "label": "->", "kind": "exec" },
                    { "id": "dx", "label": "dx", "kind": "data", "dataType": "int" },
                    { "id": "dy", "label": "dy", "kind": "data", "dataType": "int" }
                ],
                "outputs": [
                    { "id": "exec", "label": "->", "kind": "exec" }
                ],
                "params": {
                    "target": "player",
                    "dx": 1,
                    "dy": 0
                }
            }
        ],
        "edges": [
            {
                "id": "edge_start_move",
                "fromNode": "start",
                "fromPort": "exec",
                "toNode": "move",
                "toPort": "exec"
            }
        ]
    })
    .to_string()
}

fn repair_onboarding_logic_graph(serialized: &str) -> Option<String> {
    let mut graph = serde_json::from_str::<serde_json::Value>(serialized).ok()?;
    let root = graph.as_object_mut()?;
    let nodes = root.get("nodes")?.as_array()?;
    let edges = root.get("edges")?.as_array()?;
    if !edges.is_empty() {
        return None;
    }

    let start_id = nodes.iter().find_map(|node| {
        let node_obj = node.as_object()?;
        (node_obj.get("type")?.as_str()? == "event_start")
            .then(|| node_obj.get("id")?.as_str())
            .flatten()
            .map(str::to_string)
    })?;
    let move_id = nodes.iter().find_map(|node| {
        let node_obj = node.as_object()?;
        (node_obj.get("type")?.as_str()? == "sprite_move")
            .then(|| node_obj.get("id")?.as_str())
            .flatten()
            .map(str::to_string)
    })?;

    root.insert(
        "version".to_string(),
        root.get("version").cloned().unwrap_or_else(|| serde_json::json!(1)),
    );
    root.insert(
        "edges".to_string(),
        serde_json::json!([
            {
                "id": "edge_start_move",
                "fromNode": start_id,
                "fromPort": "exec",
                "toNode": move_id,
                "toPort": "exec"
            }
        ]),
    );

    serde_json::to_string(&graph).ok()
}

fn normalize_onboarding_scene(scene: &mut Scene) {
    for entity in &mut scene.entities {
        let Some(sprite) = entity.components.sprite.as_mut() else {
            continue;
        };
        if !is_onboarding_sprite_asset(&sprite.asset) {
            continue;
        }

        sprite.frame_width = ONBOARDING_SPRITE_SIZE;
        sprite.frame_height = ONBOARDING_SPRITE_SIZE;

        if let Some(logic) = entity.components.logic.as_mut() {
            if let Some(graph) = logic.graph.as_mut() {
                if let Some(repaired) = repair_onboarding_logic_graph(graph) {
                    *graph = repaired;
                }
            }
        }
    }
}

fn onboarding_sprite_ppm() -> String {
    let mut lines = vec!["P3".to_string(), "16 16".to_string(), "255".to_string()];
    for y in 0..16 {
        let mut row = Vec::with_capacity(16);
        for x in 0..16 {
            let color = if x == 0 || y == 0 || x == 15 || y == 15 {
                "16 32 48"
            } else if ((x == 4 || x == 11) && (5..=6).contains(&y)) || (y == 11 && (5..=10).contains(&x)) {
                "249 226 175"
            } else if (x == 5 || x == 10) && (5..=6).contains(&y) {
                "255 255 255"
            } else {
                "46 139 87"
            };
            row.push(color);
        }
        lines.push(row.join(" "));
    }
    format!("{}\n", lines.join("\n"))
}

fn slugify_scene_id(value: &str) -> String {
    let mut slug = String::new();
    let mut previous_was_separator = false;

    for ch in value.trim().chars() {
        let normalized = ch.to_ascii_lowercase();
        if normalized.is_ascii_alphanumeric() {
            slug.push(normalized);
            previous_was_separator = false;
        } else if !previous_was_separator {
            slug.push('_');
            previous_was_separator = true;
        }
    }

    let trimmed = slug.trim_matches('_');
    if trimmed.is_empty() {
        "scene".to_string()
    } else {
        trimmed.to_string()
    }
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

    if build.artifact_prefix.trim().is_empty() {
        return Err(LoadError(
            "project.rds: build.artifact_prefix nao pode ser vazio.".into(),
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
    fn migration_chain_upgrades_project_schema_1_0_0_to_1_1_0() {
        let project_dir = temp_dir("schema-chain");
        fs::create_dir_all(project_dir.join("scenes")).expect("create scenes dir");

        let legacy_project = serde_json::json!({
            "rds_version": UGDM_VERSION,
            "schema_version": "1.0.0",
            "name": "Schema Chain",
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
            "schema_version": "1.0.0",
            "display_name": "Main Scene",
            "background_layers": [],
            "entities": [],
            "palettes": []
        });

        fs::write(project_dir.join("project.rds"), legacy_project.to_string())
            .expect("write project");
        fs::write(project_dir.join("scenes").join("main.json"), legacy_scene.to_string())
            .expect("write scene");

        let project = load_project(&project_dir).expect("load migrated project");
        let scene = load_scene(&project_dir, "scenes/main.json").expect("load migrated scene");

        assert_eq!(project.schema_version, CURRENT_SCHEMA_VERSION);
        assert_eq!(
            project.build.as_ref().map(|build| build.artifact_prefix.as_str()),
            Some("game")
        );
        assert_eq!(
            project
                .build
                .as_ref()
                .map(|build| build.patch_audit_log.len()),
            Some(0)
        );
        assert_eq!(scene.schema_version.as_deref(), Some(CURRENT_SCHEMA_VERSION));

        let _ = fs::remove_dir_all(project_dir);
    }

    #[test]
    fn migration_chain_upgrades_project_schema_1_1_0_to_1_2_0() {
        let project_dir = temp_dir("migration-1-1-0-to-1-2-0");
        fs::create_dir_all(project_dir.join("scenes")).expect("create scenes dir");

        let project_v1_1 = serde_json::json!({
            "rds_version": UGDM_VERSION,
            "schema_version": "1.1.0",
            "name": "Compliance Upgrade",
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
                "optimization": "size",
                "artifact_prefix": "audit"
            }
        });
        let scene_v1_1 = serde_json::json!({
            "scene_id": DEFAULT_SCENE_ID,
            "schema_version": "1.1.0",
            "display_name": "Main Scene",
            "background_layers": [],
            "entities": [],
            "palettes": []
        });

        fs::write(project_dir.join("project.rds"), project_v1_1.to_string())
            .expect("write project");
        fs::write(project_dir.join("scenes").join("main.json"), scene_v1_1.to_string())
            .expect("write scene");

        let project = load_project(&project_dir).expect("load migrated project");
        let scene = load_scene(&project_dir, "scenes/main.json").expect("load migrated scene");

        assert_eq!(project.schema_version, CURRENT_SCHEMA_VERSION);
        assert_eq!(
            project.build.as_ref().map(|build| build.artifact_prefix.as_str()),
            Some("audit")
        );
        assert_eq!(
            project
                .build
                .as_ref()
                .map(|build| build.patch_audit_log.len()),
            Some(0)
        );
        assert_eq!(scene.schema_version.as_deref(), Some(CURRENT_SCHEMA_VERSION));

        let _ = fs::remove_dir_all(project_dir);
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
    fn list_scenes_returns_canonical_scene_catalog() {
        let project_dir = temp_dir("list-scenes");
        create_project_skeleton(&project_dir, "Scene Catalog", "megadrive")
            .expect("create canonical project");
        let bonus_scene = canonical_scene("bonus_stage", Some("Bonus Stage".to_string()));
        save_scene(&project_dir, "scenes/bonus_stage.json", &bonus_scene)
            .expect("save bonus scene");

        let scenes = list_scenes(&project_dir).expect("list project scenes");
        let paths = scenes.iter().map(|scene| scene.path.as_str()).collect::<Vec<_>>();

        assert_eq!(paths, vec!["scenes/bonus_stage.json", "scenes/main.json"]);
        assert_eq!(scenes[0].scene_id, "bonus_stage");
        assert_eq!(scenes[0].display_name, "Bonus Stage");
        assert_eq!(scenes[1].scene_id, DEFAULT_SCENE_ID);

        let _ = fs::remove_dir_all(project_dir);
    }

    #[test]
    fn list_scenes_returns_empty_when_directory_is_missing() {
        let project_dir = temp_dir("list-scenes-empty");

        assert!(list_scenes(&project_dir).expect("list empty scenes").is_empty());

        let _ = fs::remove_dir_all(project_dir);
    }

    #[test]
    fn create_scene_seeds_starter_scene_when_onboarding_asset_exists() {
        let project_dir = temp_dir("create-scene-starter");
        create_project_skeleton(&project_dir, "Starter Scenes", "megadrive")
            .expect("create canonical project");
        seed_onboarding_template(&project_dir, "megadrive").expect("seed onboarding project");

        let created = create_scene(&project_dir, Some("Teste"))
            .expect("create scene with starter content");
        let scene = load_scene(&project_dir, &created.path).expect("load created scene");

        assert_eq!(scene.display_name.as_deref(), Some("Teste"));
        assert_eq!(scene.entities.len(), 1);
        assert_eq!(scene.entities[0].entity_id, "player");
        assert_eq!(
            scene.entities[0]
                .components
                .sprite
                .as_ref()
                .map(|sprite| sprite.asset.as_str()),
            Some(ONBOARDING_SPRITE_ASSET)
        );
        assert!(
            scene.entities[0]
                .components
                .logic
                .as_ref()
                .and_then(|logic| logic.graph.as_ref())
                .is_some_and(|graph| graph.contains("\"fromNode\":\"start\""))
        );

        let _ = fs::remove_dir_all(project_dir);
    }

    #[test]
    fn set_entry_scene_repoints_project_to_selected_scene() {
        let project_dir = temp_dir("entry-scene");
        create_project_skeleton(&project_dir, "Entry Scene", "megadrive")
            .expect("create canonical project");
        let bonus_scene = canonical_scene("bonus_stage", Some("Bonus Stage".to_string()));
        save_scene(&project_dir, "scenes/bonus_stage.json", &bonus_scene)
            .expect("save bonus scene");

        let updated = set_entry_scene(&project_dir, "scenes/bonus_stage.json")
            .expect("update entry scene");
        let reloaded = load_project(&project_dir).expect("reload project");

        assert_eq!(updated.entry_scene, "scenes/bonus_stage.json");
        assert_eq!(reloaded.entry_scene, "scenes/bonus_stage.json");

        let _ = fs::remove_dir_all(project_dir);
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
            project.build.as_ref().map(|build| build.artifact_prefix.as_str()),
            Some("game")
        );
        assert_eq!(
            scene.schema_version.as_deref(),
            Some(CURRENT_SCHEMA_VERSION)
        );

        let _ = fs::remove_dir_all(project_dir);
    }

    #[test]
    fn migrate_scene_repairs_onboarding_placeholder_and_starter_edge() {
        let mut scene = canonical_scene(DEFAULT_SCENE_ID, Some("Main Scene".to_string()));
        scene.entities = vec![Entity {
            entity_id: "player".to_string(),
            prefab: None,
            transform: crate::ugdm::entities::Transform { x: 104, y: 88 },
            components: Components {
                sprite: Some(SpriteComponent {
                    asset: ONBOARDING_SPRITE_ASSET.to_string(),
                    frame_width: 64,
                    frame_height: 56,
                    pivot: None,
                    palette_slot: 0,
                    animations: HashMap::new(),
                    priority: "foreground".to_string(),
                }),
                logic: Some(LogicComponent {
                    graph: Some(
                        serde_json::json!({
                            "version": 1,
                            "nodes": [
                                { "id": "node_1", "type": "event_start", "params": {} },
                                {
                                    "id": "node_2",
                                    "type": "sprite_move",
                                    "params": { "target": "player", "dx": 0, "dy": 0 }
                                }
                            ],
                            "edges": []
                        })
                        .to_string(),
                    ),
                    variables: HashMap::new(),
                }),
                ..Components::default()
            },
        }];

        let migrated = migrate_scene(scene);
        let sprite = migrated.entities[0]
            .components
            .sprite
            .as_ref()
            .expect("onboarding sprite");
        let graph = migrated.entities[0]
            .components
            .logic
            .as_ref()
            .and_then(|logic| logic.graph.as_ref())
            .expect("starter graph");

        assert_eq!(sprite.frame_width, ONBOARDING_SPRITE_SIZE);
        assert_eq!(sprite.frame_height, ONBOARDING_SPRITE_SIZE);
        assert!(graph.contains("\"fromNode\":\"node_1\""));
        assert!(graph.contains("\"toNode\":\"node_2\""));
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

        assert!(project_warning.contains("mais nova que o app"));
        assert!(scene_warning.contains("mais nova que o app"));
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
