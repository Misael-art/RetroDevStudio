use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::ugdm::components::{
    AudioComponent, CameraComponent, CollisionComponent, Components, InputComponent,
    LogicComponent, PhysicsComponent, SpriteComponent, TilemapComponent, Velocity,
};
use crate::ugdm::entities::{
    BuildConfig, Entity, PaletteEntry, PatchAuditEntry, Project, Resolution, Scene,
    TemplateMetadata, CURRENT_SCHEMA_VERSION,
};
#[cfg(test)]
use crate::ugdm::entities::{RetroFXConfig, RetroFXParallaxLayer, RetroFXRasterLine};

pub const UGDM_VERSION: &str = "1.0.0";
pub const LEGACY_SCHEMA_VERSION: &str = "1.0.0";
pub const DEFAULT_ENTRY_SCENE: &str = "scenes/main.json";
pub const DEFAULT_SCENE_ID: &str = "main";
pub const ONBOARDING_SPRITE_ASSET: &str = "assets/sprites/onboarding_player.ppm";
pub const ONBOARDING_SPRITE_SIZE: u32 = 16;
pub const PLATFORMER_PLAYER_ASSET: &str = "assets/sprites/platformer_player.png";
pub const PLATFORMER_TILESET_ASSET: &str = "assets/tilesets/platformer_level.png";
pub const PLATFORMER_JUMP_ASSET: &str = "assets/audio/jump.wav";
const TEMPLATE_REGISTRY_JSON: &str = include_str!("../../../data/template_registry.json");

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub struct SceneInfo {
    pub path: String,
    pub scene_id: String,
    pub display_name: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct TemplateRegistry {
    version: String,
    templates: Vec<TemplateRegistryEntry>,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct TemplateRegistryEntry {
    id: String,
    name: String,
    description: String,
    genre: String,
    difficulty: String,
    #[serde(default)]
    features: Vec<String>,
    source_kind: String,
    recommended_target: String,
    experimental: bool,
    default_donor_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SgdkResourceEntry {
    kind: String,
    name: String,
    asset_path: String,
    params: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub struct ProjectTemplateSummary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub genre: String,
    pub difficulty: String,
    pub features: Vec<String>,
    pub source_kind: String,
    pub recommended_target: String,
    pub experimental: bool,
    pub available: bool,
    pub availability_reason: Option<String>,
    pub default_donor_path: Option<String>,
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
        return Err(LoadError(
            "project.rds: campo 'name' nao pode ser vazio.".into(),
        ));
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
        template_metadata: None,
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
        collision_map: None,
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
        fs::create_dir_all(&dir)
            .map_err(|e| LoadError(format!("Nao foi possivel criar '{}': {}", dir.display(), e)))?;
    }

    let scene = canonical_scene(DEFAULT_SCENE_ID, Some("Main Scene".to_string()));
    save_project(project_dir, &project)?;
    save_scene(project_dir, &project.entry_scene, &scene)?;

    Ok(project)
}

pub fn list_project_templates() -> Result<Vec<ProjectTemplateSummary>, LoadError> {
    let registry = template_registry()?;
    if registry.version.trim().is_empty() {
        return Err(LoadError(
            "data/template_registry.json invalido: campo 'version' nao pode ser vazio.".to_string(),
        ));
    }

    registry
        .templates
        .into_iter()
        .map(|entry| Ok(project_template_summary(&entry)))
        .collect()
}

pub fn seed_project_template(
    project_dir: &Path,
    template_id: &str,
    target: &str,
    donor_path: Option<&Path>,
) -> Result<Scene, LoadError> {
    match template_id {
        "empty" => return load_scene(project_dir, DEFAULT_ENTRY_SCENE),
        "starter_guided" => return seed_onboarding_template(project_dir, target),
        _ => {}
    }

    if target != "megadrive" {
        return Err(LoadError(
            "Templates SGDK experimentais estao disponiveis apenas para Mega Drive nesta wave."
                .to_string(),
        ));
    }

    let donor = resolved_template_donor_path(template_id, donor_path)?;
    match template_id {
        "platformer_seed" => seed_platformer_template(project_dir, &donor),
        _ => import_sgdk_project(project_dir, &donor),
    }
}

struct DonorDimensions {
    sprite_frame_width: u32,
    sprite_frame_height: u32,
    tilemap_width: u32,
    tilemap_height: u32,
}

fn extract_donor_dimensions(donor_path: &Path) -> DonorDimensions {
    let mut dims = DonorDimensions {
        sprite_frame_width: 24,
        sprite_frame_height: 24,
        tilemap_width: 64,
        tilemap_height: 64,
    };

    let resources = load_sgdk_resources(donor_path).unwrap_or_default();

    for resource in &resources {
        if resource.kind.as_str() == "SPRITE" {
            let width_tiles = resource
                .params
                .first()
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(3);
            let height_tiles = resource
                .params
                .get(1)
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(width_tiles);
            dims.sprite_frame_width = width_tiles.saturating_mul(8).max(8);
            dims.sprite_frame_height = height_tiles.saturating_mul(8).max(8);
            break;
        }
    }

    for resource in &resources {
        if matches!(resource.kind.as_str(), "TILESET" | "MAP" | "IMAGE") {
            let source = sgdk_resource_source_path(donor_path, &resource.asset_path);
            if source.is_file() {
                if let Ok(data) = fs::read(&source) {
                    if let Some((w, h)) = png_dimensions(&data) {
                        dims.tilemap_width = (w / 8).max(1);
                        dims.tilemap_height = (h / 8).max(1);
                        break;
                    }
                }
            }
        }
    }

    dims
}

fn png_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    if data.len() < 24 {
        return None;
    }
    let png_signature: [u8; 8] = [137, 80, 78, 71, 13, 10, 26, 10];
    if data[..8] != png_signature {
        return None;
    }
    let width = u32::from_be_bytes([data[16], data[17], data[18], data[19]]);
    let height = u32::from_be_bytes([data[20], data[21], data[22], data[23]]);
    Some((width, height))
}

fn tilemap_dims_from_source(source_path: &Path) -> (u32, u32) {
    if source_path.is_file() {
        if let Ok(data) = fs::read(source_path) {
            if let Some((w, h)) = png_dimensions(&data) {
                return ((w / 8).max(1), (h / 8).max(1));
            }
        }
    }
    (64, 64)
}

pub fn seed_platformer_template(project_dir: &Path, donor_path: &Path) -> Result<Scene, LoadError> {
    validate_platformer_donor_path(donor_path)?;

    let donor_dims = extract_donor_dimensions(donor_path);

    copy_template_asset(
        &donor_path.join("res").join("images").join("player.png"),
        &project_dir.join(PLATFORMER_PLAYER_ASSET),
    )?;
    copy_template_asset(
        &donor_path.join("res").join("images").join("level.png"),
        &project_dir.join(PLATFORMER_TILESET_ASSET),
    )?;

    let jump_source = donor_path.join("res").join("sound").join("jump.wav");
    if jump_source.exists() {
        copy_template_asset(&jump_source, &project_dir.join(PLATFORMER_JUMP_ASSET))?;
    }

    save_prefab_entity(
        project_dir,
        "platformer_player.json",
        &platformer_player_prefab_with_dims(
            jump_source.exists(),
            donor_dims.sprite_frame_width,
            donor_dims.sprite_frame_height,
        ),
    )?;
    save_prefab_entity(
        project_dir,
        "platformer_camera.json",
        &platformer_camera_prefab(),
    )?;
    save_prefab_entity(
        project_dir,
        "platformer_tilemap.json",
        &platformer_tilemap_prefab_with_dims(
            donor_dims.tilemap_width,
            donor_dims.tilemap_height,
        ),
    )?;
    save_graph_asset(
        project_dir,
        "graphs/platformer_player_logic.json",
        &platformer_logic_graph_with_sound(jump_source.exists()),
    )?;

    let scene = platformer_seed_scene();
    save_scene(project_dir, DEFAULT_ENTRY_SCENE, &scene)?;
    Ok(scene)
}

pub fn import_sgdk_project(project_dir: &Path, sgdk_path: &Path) -> Result<Scene, LoadError> {
    validate_sgdk_project_path(sgdk_path)?;
    let resources = load_sgdk_resources(sgdk_path)?;

    let mut scene = canonical_scene(DEFAULT_SCENE_ID, Some("Imported SGDK Project".to_string()));
    let mut imported_tilemaps = HashSet::new();
    let mut audio_sfx = HashMap::new();
    let mut audio_bgm: Option<String> = None;
    let mut first_sprite_id: Option<String> = None;
    let mut tilemap_entities = Vec::new();
    let mut sprite_entities = Vec::new();

    for resource in resources {
        let Some(destination) = sgdk_asset_destination(&resource.kind, &resource.asset_path) else {
            continue;
        };

        let source_path = sgdk_resource_source_path(sgdk_path, &resource.asset_path);
        if !source_path.is_file() {
            if resource.kind == "VGM" {
                continue;
            }
            return Err(LoadError(format!(
                "Recurso SGDK '{}' aponta para asset inexistente '{}'.",
                resource.name,
                source_path.display()
            )));
        }

        copy_template_asset(&source_path, &project_dir.join(&destination))?;

        match resource.kind.as_str() {
            "SPRITE" => {
                let width_tiles = resource
                    .params
                    .first()
                    .and_then(|value| value.parse::<u32>().ok())
                    .unwrap_or(2);
                let height_tiles = resource
                    .params
                    .get(1)
                    .and_then(|value| value.parse::<u32>().ok())
                    .unwrap_or(width_tiles);
                let entity_id = sgdk_entity_id(&resource.name);
                let is_primary_sprite = first_sprite_id.is_none();
                if first_sprite_id.is_none() {
                    first_sprite_id = Some(entity_id.clone());
                }
                let frame_w = width_tiles.saturating_mul(8).max(8);
                let frame_h = height_tiles.saturating_mul(8).max(8);
                let is_meta = frame_w > 32 || frame_h > 32;
                sprite_entities.push(Entity {
                    entity_id,
                    prefab: None,
                    transform: crate::ugdm::entities::Transform { x: 32, y: 32 },
                    components: Components {
                        sprite: Some(SpriteComponent {
                            asset: destination,
                            frame_width: frame_w,
                            frame_height: frame_h,
                            pivot: None,
                            palette_slot: 0,
                            animations: HashMap::new(),
                            priority: "foreground".to_string(),
                            meta_sprite: is_meta,
                        }),
                        logic: is_primary_sprite.then(|| LogicComponent {
                            graph: Some(imported_sprite_logic_graph(&resource.name)),
                            graph_ref: None,
                            variables: HashMap::new(),
                        }),
                        ..Components::default()
                    },
                });
            }
            "IMAGE" | "TILESET" | "TILEMAP" | "MAP" => {
                if imported_tilemaps.insert(destination.clone()) {
                    let (mw, mh) = tilemap_dims_from_source(&source_path);
                    tilemap_entities.push(Entity {
                        entity_id: format!("{}_tilemap", sgdk_entity_id(&resource.name)),
                        prefab: None,
                        transform: crate::ugdm::entities::Transform { x: 0, y: 0 },
                        components: Components {
                            tilemap: Some(TilemapComponent {
                                tileset: destination,
                                map_width: mw,
                                map_height: mh,
                                scroll_x: 0,
                                scroll_y: 0,
                            }),
                            ..Components::default()
                        },
                    });
                }
            }
            "WAV" | "PCM" => {
                audio_sfx.insert(resource.name.clone(), destination);
            }
            "XGM" | "XGM2" => {
                if audio_bgm.is_none() {
                    audio_bgm = Some(destination);
                }
            }
            _ => {}
        }
    }

    scene.entities.extend(tilemap_entities);
    scene.entities.extend(sprite_entities);

    if !audio_sfx.is_empty() || audio_bgm.is_some() {
        scene.entities.push(Entity {
            entity_id: "audio_bank".to_string(),
            prefab: None,
            transform: crate::ugdm::entities::Transform { x: 0, y: 0 },
            components: Components {
                audio: Some(AudioComponent {
                    sfx: audio_sfx,
                    bgm: audio_bgm,
                }),
                ..Components::default()
            },
        });
    }

    if let Some(follow_entity) = first_sprite_id {
        scene.entities.push(Entity {
            entity_id: "main_camera".to_string(),
            prefab: None,
            transform: crate::ugdm::entities::Transform { x: 0, y: 0 },
            components: Components {
                camera: Some(CameraComponent {
                    follow_entity: Some(follow_entity),
                    offset_x: 0,
                    offset_y: 0,
                }),
                ..Components::default()
            },
        });
    }

    save_scene(project_dir, DEFAULT_ENTRY_SCENE, &scene)?;
    Ok(scene)
}

fn template_registry() -> Result<TemplateRegistry, LoadError> {
    serde_json::from_str(TEMPLATE_REGISTRY_JSON).map_err(|error| {
        LoadError(format!(
            "data/template_registry.json invalido (erro de parsing JSON): {}",
            error
        ))
    })
}

fn template_registry_entry(template_id: &str) -> Result<TemplateRegistryEntry, LoadError> {
    template_registry()?
        .templates
        .into_iter()
        .find(|entry| entry.id == template_id)
        .ok_or_else(|| {
            LoadError(format!(
                "Template '{}' nao encontrado em data/template_registry.json.",
                template_id
            ))
        })
}

fn resolved_template_donor_path(
    template_id: &str,
    donor_path: Option<&Path>,
) -> Result<PathBuf, LoadError> {
    if let Some(donor_path) = donor_path {
        return Ok(donor_path.to_path_buf());
    }

    let entry = template_registry_entry(template_id)?;
    entry.default_donor_path.map(PathBuf::from).ok_or_else(|| {
        LoadError(format!(
            "O template '{}' nao possui donor path padrao configurado.",
            template_id
        ))
    })
}

fn project_template_summary(entry: &TemplateRegistryEntry) -> ProjectTemplateSummary {
    let (available, availability_reason) = template_availability(entry);

    ProjectTemplateSummary {
        id: entry.id.clone(),
        name: entry.name.clone(),
        description: entry.description.clone(),
        genre: entry.genre.clone(),
        difficulty: entry.difficulty.clone(),
        features: entry.features.clone(),
        source_kind: entry.source_kind.clone(),
        recommended_target: entry.recommended_target.clone(),
        experimental: entry.experimental,
        available,
        availability_reason,
        default_donor_path: entry.default_donor_path.clone(),
    }
}

fn template_availability(entry: &TemplateRegistryEntry) -> (bool, Option<String>) {
    match entry.source_kind.as_str() {
        "builtin" => (true, None),
        "external_sgdk" => {
            let Some(donor_path) = entry.default_donor_path.as_deref() else {
                return (
                    false,
                    Some("Template externo sem donor path padrao configurado.".to_string()),
                );
            };

            match entry.id.as_str() {
                "platformer_seed" => match validate_platformer_donor_path(Path::new(donor_path)) {
                    Ok(()) => (true, None),
                    Err(error) => (false, Some(error.to_string())),
                },
                _ => match validate_sgdk_project_path(Path::new(donor_path)) {
                    Ok(()) => (true, None),
                    Err(error) => (false, Some(error.to_string())),
                },
            }
        }
        other => (
            false,
            Some(format!(
                "source_kind '{}' nao suportado pelo registry atual.",
                other
            )),
        ),
    }
}

fn validate_platformer_donor_path(donor_path: &Path) -> Result<(), LoadError> {
    if !donor_path.exists() {
        return Err(LoadError(format!(
            "Template Plataforma indisponivel: donor path '{}' nao existe.",
            donor_path.display()
        )));
    }

    let player = donor_path.join("res").join("images").join("player.png");
    if !player.is_file() {
        return Err(LoadError(format!(
            "Template Plataforma indisponivel: asset obrigatorio '{}' nao foi encontrado.",
            player.display()
        )));
    }

    let level = donor_path.join("res").join("images").join("level.png");
    if !level.is_file() {
        return Err(LoadError(format!(
            "Template Plataforma indisponivel: asset obrigatorio '{}' nao foi encontrado.",
            level.display()
        )));
    }

    Ok(())
}

fn copy_template_asset(source: &Path, destination: &Path) -> Result<(), LoadError> {
    let parent = destination.parent().ok_or_else(|| {
        LoadError(format!(
            "Destino de asset '{}' nao possui diretorio pai valido.",
            destination.display()
        ))
    })?;
    fs::create_dir_all(parent).map_err(|error| {
        LoadError(format!(
            "Nao foi possivel criar o diretorio '{}' para importar assets: {}",
            parent.display(),
            error
        ))
    })?;
    fs::copy(source, destination).map_err(|error| {
        LoadError(format!(
            "Nao foi possivel copiar '{}' para '{}': {}",
            source.display(),
            destination.display(),
            error
        ))
    })?;
    Ok(())
}

fn tokenize_sgdk_resource_line(line: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;

    for character in line.chars() {
        match character {
            '"' => {
                in_quotes = !in_quotes;
            }
            '#' if !in_quotes => {
                break;
            }
            ' ' | '\t' if !in_quotes => {
                if !current.is_empty() {
                    tokens.push(current.clone());
                    current.clear();
                }
            }
            _ => current.push(character),
        }
    }

    if !current.is_empty() {
        tokens.push(current);
    }

    tokens
}

fn parse_sgdk_manifest(manifest: &str) -> Vec<SgdkResourceEntry> {
    manifest
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                return None;
            }

            let tokens = tokenize_sgdk_resource_line(trimmed);
            if tokens.len() < 3 {
                return None;
            }

            Some(SgdkResourceEntry {
                kind: tokens[0].to_ascii_uppercase(),
                name: tokens[1].clone(),
                asset_path: tokens[2].replace('\\', "/"),
                params: tokens[3..].to_vec(),
            })
        })
        .collect()
}

fn find_sgdk_manifest_paths(sgdk_path: &Path) -> Result<Vec<PathBuf>, LoadError> {
    let direct = sgdk_path.join("resources.res");
    if direct.is_file() {
        return Ok(vec![direct]);
    }

    let canonical = sgdk_path.join("res").join("resources.res");
    if canonical.is_file() {
        return Ok(vec![canonical]);
    }

    let res_dir = sgdk_path.join("res");
    if res_dir.is_dir() {
        let mut manifests = Vec::new();
        for entry in fs::read_dir(&res_dir).map_err(|error| {
            LoadError(format!(
                "Nao foi possivel listar manifests SGDK em '{}': {}",
                res_dir.display(),
                error
            ))
        })? {
            let entry = entry.map_err(|error| {
                LoadError(format!(
                    "Nao foi possivel ler manifesto SGDK em '{}': {}",
                    res_dir.display(),
                    error
                ))
            })?;
            let path = entry.path();
            if path
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("res"))
            {
                manifests.push(path);
            }
        }
        manifests.sort();
        if !manifests.is_empty() {
            return Ok(manifests);
        }
    }

    Err(LoadError(format!(
        "Projeto SGDK invalido: nenhum manifesto .res foi encontrado em '{}'.",
        sgdk_path.display()
    )))
}

fn validate_sgdk_project_path(sgdk_path: &Path) -> Result<(), LoadError> {
    if !sgdk_path.exists() {
        return Err(LoadError(format!(
            "Projeto SGDK indisponivel: donor path '{}' nao existe.",
            sgdk_path.display()
        )));
    }

    let manifest_paths = find_sgdk_manifest_paths(sgdk_path)?;
    let resources = load_sgdk_resources(sgdk_path)?;
    if resources.is_empty() {
        return Err(LoadError(format!(
            "Projeto SGDK invalido: nenhum manifesto .res em '{}' possui recursos importaveis.",
            sgdk_path.display()
        )));
    }

    if !resources
        .iter()
        .any(|resource| sgdk_asset_destination(&resource.kind, &resource.asset_path).is_some())
    {
        let manifests = manifest_paths
            .iter()
            .map(|path| path.display().to_string())
            .collect::<Vec<_>>()
            .join(", ");
        return Err(LoadError(format!(
            "Projeto SGDK invalido: os manifestos '{}' nao possuem recursos suportados para importacao.",
            manifests
        )));
    }

    Ok(())
}

fn load_sgdk_resources(sgdk_path: &Path) -> Result<Vec<SgdkResourceEntry>, LoadError> {
    let manifest_paths = find_sgdk_manifest_paths(sgdk_path)?;
    let mut resources = Vec::new();

    for manifest_path in manifest_paths {
        let manifest = fs::read_to_string(&manifest_path).map_err(|error| {
            LoadError(format!(
                "Nao foi possivel ler manifesto SGDK '{}': {}",
                manifest_path.display(),
                error
            ))
        })?;
        resources.extend(parse_sgdk_manifest(&manifest));
    }

    Ok(resources)
}

fn sgdk_resource_source_path(sgdk_path: &Path, asset_path: &str) -> PathBuf {
    let normalized = asset_path.replace('\\', "/");
    let relative = PathBuf::from(&normalized);
    let under_res = sgdk_path.join("res").join(&relative);
    if under_res.exists() {
        under_res
    } else {
        sgdk_path.join(relative)
    }
}

fn sgdk_asset_destination(kind: &str, asset_path: &str) -> Option<String> {
    let filename = Path::new(asset_path)
        .file_name()
        .and_then(|value| value.to_str())
        .map(str::to_string)?;

    match kind {
        "SPRITE" => Some(format!("assets/sprites/{}", filename)),
        "IMAGE" | "TILESET" | "TILEMAP" | "MAP" | "PALETTE" => {
            Some(format!("assets/tilesets/{}", filename))
        }
        "WAV" | "PCM" | "XGM" | "XGM2" => Some(format!("assets/audio/{}", filename)),
        "VGM" => None,
        _ => None,
    }
}

fn sgdk_entity_id(name: &str) -> String {
    let mut id = String::new();
    for character in name.chars() {
        if character.is_ascii_alphanumeric() {
            id.push(character.to_ascii_lowercase());
        } else if character == '_' || character == '-' {
            id.push('_');
        }
    }
    if id.is_empty() {
        "resource".to_string()
    } else {
        id
    }
}

fn save_prefab_entity(
    project_dir: &Path,
    prefab_name: &str,
    entity: &Entity,
) -> Result<(), LoadError> {
    let prefab_path = project_dir.join("prefabs").join(prefab_name);
    let parent = prefab_path.parent().ok_or_else(|| {
        LoadError(format!(
            "Prefab '{}' nao possui diretorio pai valido.",
            prefab_path.display()
        ))
    })?;
    fs::create_dir_all(parent).map_err(|error| {
        LoadError(format!(
            "Nao foi possivel criar o diretorio '{}' para salvar prefab: {}",
            parent.display(),
            error
        ))
    })?;
    let serialized = serde_json::to_string_pretty(entity).map_err(|error| {
        LoadError(format!(
            "Nao foi possivel serializar prefab '{}': {}",
            prefab_name, error
        ))
    })?;
    fs::write(&prefab_path, serialized).map_err(|error| {
        LoadError(format!(
            "Nao foi possivel salvar prefab '{}' em '{}': {}",
            prefab_name,
            prefab_path.display(),
            error
        ))
    })?;
    Ok(())
}

fn save_graph_asset(
    project_dir: &Path,
    graph_ref: &str,
    graph_json: &str,
) -> Result<(), LoadError> {
    let graph_path = graph_write_path(project_dir, graph_ref)?;
    let parent = graph_path.parent().ok_or_else(|| {
        LoadError(format!(
            "Graph '{}' nao possui diretorio pai valido.",
            graph_path.display()
        ))
    })?;
    fs::create_dir_all(parent).map_err(|error| {
        LoadError(format!(
            "Nao foi possivel criar o diretorio '{}' para salvar graph: {}",
            parent.display(),
            error
        ))
    })?;
    fs::write(&graph_path, graph_json).map_err(|error| {
        LoadError(format!(
            "Nao foi possivel salvar graph '{}' em '{}': {}",
            graph_ref,
            graph_path.display(),
            error
        ))
    })?;
    Ok(())
}

fn platformer_player_prefab_with_dims(
    has_jump_sound: bool,
    frame_width: u32,
    frame_height: u32,
) -> Entity {
    Entity {
        entity_id: "platformer_player_prefab".to_string(),
        prefab: None,
        transform: crate::ugdm::entities::Transform { x: 48, y: 120 },
        components: Components {
            sprite: Some(SpriteComponent {
                asset: PLATFORMER_PLAYER_ASSET.to_string(),
                frame_width,
                frame_height,
                pivot: None,
                palette_slot: 0,
                animations: HashMap::new(),
                priority: "foreground".to_string(),
                meta_sprite: false,
            }),
            collision: Some(CollisionComponent {
                shape: "aabb".to_string(),
                width: frame_width,
                height: frame_height.saturating_mul(2),
                offset: None,
                solid: true,
                layer: Some("player".to_string()),
                collides_with: vec!["ground".to_string()],
            }),
            input: Some(InputComponent {
                device: "joypad1".to_string(),
                mapping: HashMap::from([
                    ("jump".to_string(), "BUTTON_A".to_string()),
                    ("move_left".to_string(), "DPAD_LEFT".to_string()),
                    ("move_right".to_string(), "DPAD_RIGHT".to_string()),
                ]),
            }),
            physics: Some(PhysicsComponent {
                gravity: true,
                gravity_strength: 6,
                max_velocity: Some(Velocity { x: 32, y: 96 }),
                friction: 1,
                bounce: 0,
            }),
            audio: Some(AudioComponent {
                sfx: if has_jump_sound {
                    HashMap::from([("jump".to_string(), PLATFORMER_JUMP_ASSET.to_string())])
                } else {
                    HashMap::new()
                },
                bgm: None,
            }),
            logic: Some(LogicComponent {
                graph: None,
                graph_ref: Some("graphs/platformer_player_logic.json".to_string()),
                variables: HashMap::new(),
            }),
            ..Components::default()
        },
    }
}

fn platformer_camera_prefab() -> Entity {
    Entity {
        entity_id: "platformer_camera_prefab".to_string(),
        prefab: None,
        transform: crate::ugdm::entities::Transform { x: 0, y: 0 },
        components: Components {
            camera: Some(CameraComponent {
                follow_entity: Some("player".to_string()),
                offset_x: 0,
                offset_y: 0,
            }),
            ..Components::default()
        },
    }
}

fn platformer_tilemap_prefab_with_dims(map_width: u32, map_height: u32) -> Entity {
    Entity {
        entity_id: "platformer_tilemap_prefab".to_string(),
        prefab: None,
        transform: crate::ugdm::entities::Transform { x: 0, y: 0 },
        components: Components {
            tilemap: Some(TilemapComponent {
                tileset: PLATFORMER_TILESET_ASSET.to_string(),
                map_width,
                map_height,
                scroll_x: 0,
                scroll_y: 0,
            }),
            ..Components::default()
        },
    }
}

fn platformer_seed_scene() -> Scene {
    let mut scene = canonical_scene(DEFAULT_SCENE_ID, Some("Platformer Seed".to_string()));
    scene.palettes = vec![PaletteEntry {
        slot: 0,
        colors: vec![
            "#0F172A".to_string(),
            "#1D4ED8".to_string(),
            "#22C55E".to_string(),
            "#F8FAFC".to_string(),
        ],
    }];
    scene.entities = vec![
        Entity {
            entity_id: "tilemap_bg".to_string(),
            prefab: Some("platformer_tilemap.json".to_string()),
            transform: crate::ugdm::entities::Transform { x: 0, y: 0 },
            components: Components::default(),
        },
        Entity {
            entity_id: "player".to_string(),
            prefab: Some("platformer_player.json".to_string()),
            transform: crate::ugdm::entities::Transform { x: 48, y: 120 },
            components: Components::default(),
        },
        Entity {
            entity_id: "main_camera".to_string(),
            prefab: Some("platformer_camera.json".to_string()),
            transform: crate::ugdm::entities::Transform { x: 0, y: 0 },
            components: Components::default(),
        },
    ];
    scene
}

#[cfg(test)]
fn platformer_logic_graph() -> String {
    platformer_logic_graph_with_sound(true)
}

fn platformer_logic_graph_with_sound(has_jump_sound: bool) -> String {
    let mut nodes = vec![
        serde_json::json!({
            "id": "start",
            "type": "event_start",
            "label": "On Start",
            "x": 48,
            "y": 48,
            "inputs": [],
            "outputs": [{ "id": "exec", "label": ">", "kind": "exec" }],
            "params": {}
        }),
        serde_json::json!({
            "id": "move_player",
            "type": "sprite_move",
            "label": "Move Sprite",
            "x": 228,
            "y": 32,
            "inputs": [{ "id": "exec", "label": ">", "kind": "exec" }],
            "outputs": [{ "id": "exec", "label": ">", "kind": "exec" }],
            "params": { "target": "player", "dx": 2, "dy": 0 }
        }),
        serde_json::json!({
            "id": "follow_camera",
            "type": "move_camera",
            "label": "Move Camera",
            "x": 408,
            "y": 32,
            "inputs": [{ "id": "exec", "label": ">", "kind": "exec" }],
            "outputs": [{ "id": "exec", "label": ">", "kind": "exec" }],
            "params": { "target": "main_camera", "x": 0, "y": 0 }
        }),
    ];
    let mut edges = vec![
        serde_json::json!({
            "id": "edge_start_move",
            "fromNode": "start",
            "fromPort": "exec",
            "toNode": "move_player",
            "toPort": "exec"
        }),
        serde_json::json!({
            "id": "edge_move_camera",
            "fromNode": "move_player",
            "fromPort": "exec",
            "toNode": "follow_camera",
            "toPort": "exec"
        }),
    ];

    if has_jump_sound {
        nodes.push(serde_json::json!({
            "id": "jump_sound",
            "type": "action_sound",
            "label": "Play Sound",
            "x": 588,
            "y": 32,
            "inputs": [{ "id": "exec", "label": ">", "kind": "exec" }],
            "outputs": [{ "id": "exec", "label": ">", "kind": "exec" }],
            "params": { "sfx": "jump" }
        }));
        edges.push(serde_json::json!({
            "id": "edge_camera_sound",
            "fromNode": "follow_camera",
            "fromPort": "exec",
            "toNode": "jump_sound",
            "toPort": "exec"
        }));
    }

    serde_json::json!({
        "version": 1,
        "nodes": nodes,
        "edges": edges
    })
    .to_string()
}

fn imported_sprite_logic_graph(resource_name: &str) -> String {
    let target = sgdk_entity_id(resource_name);
    serde_json::json!({
        "version": 1,
        "nodes": [
            {
                "id": "start",
                "type": "event_start",
                "label": "On Start",
                "x": 48,
                "y": 48,
                "inputs": [],
                "outputs": [{ "id": "exec", "label": ">", "kind": "exec" }],
                "params": {}
            },
            {
                "id": "move_sprite",
                "type": "sprite_move",
                "label": "Move Sprite",
                "x": 228,
                "y": 48,
                "inputs": [{ "id": "exec", "label": ">", "kind": "exec" }],
                "outputs": [{ "id": "exec", "label": ">", "kind": "exec" }],
                "params": { "target": target, "dx": 2, "dy": 0 }
            }
        ],
        "edges": [
            {
                "id": "edge_start_move",
                "fromNode": "start",
                "fromPort": "exec",
                "toNode": "move_sprite",
                "toPort": "exec"
            }
        ]
    })
    .to_string()
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
        if !path.is_file()
            || path.extension().and_then(|extension| extension.to_str()) != Some("json")
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

pub fn create_scene(
    project_dir: &Path,
    display_name: Option<&str>,
) -> Result<SceneInfo, LoadError> {
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

pub fn seed_onboarding_template(project_dir: &Path, target: &str) -> Result<Scene, LoadError> {
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

pub fn stamp_project_template_metadata(
    project_dir: &Path,
    template_id: &str,
    donor_path: Option<&Path>,
) -> Result<Project, LoadError> {
    let registry = template_registry()?;
    let entry = registry
        .templates
        .into_iter()
        .find(|entry| entry.id == template_id)
        .ok_or_else(|| {
            LoadError(format!(
                "Template '{}' nao encontrado em data/template_registry.json.",
                template_id
            ))
        })?;
    let source_path = donor_path
        .map(|path| path.to_string_lossy().to_string())
        .or(entry.default_donor_path.clone())
        .unwrap_or_else(|| "builtin".to_string());

    stamp_project_metadata(
        project_dir,
        entry.id,
        registry.version,
        entry.source_kind,
        source_path,
    )
}

pub fn stamp_imported_sgdk_metadata(
    project_dir: &Path,
    source_path: &Path,
) -> Result<Project, LoadError> {
    stamp_project_metadata(
        project_dir,
        "imported_sgdk".to_string(),
        "1.0.0".to_string(),
        "imported_sgdk".to_string(),
        source_path.to_string_lossy().to_string(),
    )
}

fn stamp_project_metadata(
    project_dir: &Path,
    template_id: String,
    template_version: String,
    source_kind: String,
    source_path: String,
) -> Result<Project, LoadError> {
    let mut project = load_project(project_dir)?;
    let imported_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| LoadError(format!("Relogio do sistema invalido: {}", error)))?
        .as_millis();

    project.template_metadata = Some(TemplateMetadata {
        template_id,
        template_version,
        source_kind,
        source_path,
        imported_at_ms,
    });
    save_project(project_dir, &project)?;
    Ok(project)
}

/// Procura `project.rds` no diretorio fornecido e, se nao encontrar,
/// busca em subdiretorios de primeiro nivel com prioridade para `rds/`.
/// Retorna o diretorio que contem o `project.rds` encontrado.
pub fn discover_project_rds(dir: &Path) -> Result<PathBuf, LoadError> {
    // 1. Caminho canonico: project.rds na raiz
    if dir.join("project.rds").is_file() {
        return Ok(dir.to_path_buf());
    }

    // 2. Overlay preferencial: rds/project.rds
    let rds_subdir = dir.join("rds");
    if rds_subdir.join("project.rds").is_file() {
        return Ok(rds_subdir);
    }

    // 3. Busca em subdiretorios de primeiro nivel
    let entries = fs::read_dir(dir).map_err(|e| {
        LoadError(format!(
            "Nao foi possivel ler diretorio '{}': {}",
            dir.display(),
            e
        ))
    })?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() && path.join("project.rds").is_file() {
            return Ok(path);
        }
    }

    Err(LoadError(format!(
        "project.rds nao encontrado em '{}' nem em seus subdiretorios imediatos.",
        dir.display()
    )))
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
            let resolved_entity = resolve_entity_prefab(project_dir, entity, &mut stack)?;
            resolve_entity_logic_graph(project_dir, &resolved_entity)
        })
        .collect::<Result<Vec<_>, _>>()?;

    Ok(Scene {
        entities,
        ..scene.clone()
    })
}

pub fn sync_external_graph_refs(
    project_dir: &Path,
    source_scene: &mut Scene,
    resolved_scene: &Scene,
) -> Result<(), LoadError> {
    for source_entity in &mut source_scene.entities {
        let Some(source_logic) = source_entity.components.logic.as_mut() else {
            continue;
        };

        let Some(graph_ref) = source_logic
            .graph_ref
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };

        let resolved_logic = resolved_scene
            .entities
            .iter()
            .find(|entity| entity.entity_id == source_entity.entity_id)
            .and_then(|entity| entity.components.logic.as_ref());

        let Some(graph_json) = resolved_logic
            .and_then(|logic| logic.graph.as_deref())
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };

        let full_path = graph_write_path(project_dir, graph_ref)?;
        if let Some(parent) = full_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                LoadError(format!(
                    "Nao foi possivel criar diretorio para graph_ref '{}': {}",
                    graph_ref, error
                ))
            })?;
        }
        fs::write(&full_path, graph_json).map_err(|error| {
            LoadError(format!(
                "Nao foi possivel escrever graph_ref '{}' para entidade '{}': {}",
                graph_ref, source_entity.entity_id, error
            ))
        })?;
        source_logic.graph = None;
    }

    Ok(())
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
    scene.schema_version = Some(schema_version.clone());
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
        return Err(LoadError(
            "project.rds: campo 'name' nao pode ser vazio.".into(),
        ));
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
            spec.target, spec.palette_mode, project.palette_mode
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
    project_dir
        .join("assets")
        .join("sprites")
        .join("onboarding_player.ppm")
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
                meta_sprite: false,
            }),
            logic: Some(LogicComponent {
                graph: Some(logic_graph),
                graph_ref: None,
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
            "1.2.0" => migrate_project_1_2_0_to_1_3_0(value)?,
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
            "1.2.0" => migrate_scene_1_2_0_to_1_3_0(value)?,
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
    if let Some(build) = object
        .get_mut("build")
        .and_then(serde_json::Value::as_object_mut)
    {
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
    if let Some(build) = object
        .get_mut("build")
        .and_then(serde_json::Value::as_object_mut)
    {
        build
            .entry("patch_audit_log".to_string())
            .or_insert_with(|| serde_json::Value::Array(Vec::new()));
    }
    Ok(value)
}

fn migrate_project_1_2_0_to_1_3_0(
    mut value: serde_json::Value,
) -> Result<serde_json::Value, LoadError> {
    let object = value
        .as_object_mut()
        .ok_or_else(|| LoadError("project.rds invalido: raiz JSON deve ser um objeto.".into()))?;
    object.insert(
        "schema_version".to_string(),
        serde_json::Value::String("1.3.0".to_string()),
    );
    object
        .entry("template_metadata".to_string())
        .or_insert(serde_json::Value::Null);
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

fn migrate_scene_1_2_0_to_1_3_0(
    mut value: serde_json::Value,
) -> Result<serde_json::Value, LoadError> {
    let object = value
        .as_object_mut()
        .ok_or_else(|| LoadError("scene invalida: raiz JSON deve ser um objeto.".into()))?;
    object.insert(
        "schema_version".to_string(),
        serde_json::Value::String("1.3.0".to_string()),
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
        root.get("version")
            .cloned()
            .unwrap_or_else(|| serde_json::json!(1)),
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
            } else if ((x == 4 || x == 11) && (5..=6).contains(&y))
                || (y == 11 && (5..=10).contains(&x))
            {
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
        return Err(LoadError(
            "scene: campo 'scene_id' nao pode ser vazio.".into(),
        ));
    }

    ensure_unique_ids(
        "entity_id",
        scene
            .entities
            .iter()
            .map(|entity| entity.entity_id.as_str()),
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

    if path.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
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
    let Some(prefab_ref) = entity
        .prefab
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
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
        return Err(LoadError(
            "scene: campo 'prefab' nao pode ser vazio.".into(),
        ));
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

fn resolve_entity_logic_graph(project_dir: &Path, entity: &Entity) -> Result<Entity, LoadError> {
    let Some(logic) = entity.components.logic.as_ref() else {
        return Ok(entity.clone());
    };

    let Some(graph_ref) = logic
        .graph_ref
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(entity.clone());
    };

    if logic
        .graph
        .as_deref()
        .is_some_and(|graph| !graph.trim().is_empty())
    {
        return Ok(entity.clone());
    }

    let full_path = graph_path(project_dir, graph_ref)?;
    let content = fs::read_to_string(&full_path).map_err(|error| {
        LoadError(format!(
            "Nao foi possivel ler graph_ref '{}' para entidade '{}': {}",
            graph_ref, entity.entity_id, error
        ))
    })?;

    let mut resolved_entity = entity.clone();
    if let Some(resolved_logic) = resolved_entity.components.logic.as_mut() {
        resolved_logic.graph = Some(content);
    }

    Ok(resolved_entity)
}

fn graph_path(project_dir: &Path, graph_ref: &str) -> Result<PathBuf, LoadError> {
    let relative = normalize_graph_ref(graph_ref)?;
    let full_path = project_dir.join("graphs").join(&relative);

    if !full_path.exists() {
        return Err(LoadError(format!(
            "Graph '{}' nao encontrado em '{}'.",
            graph_ref,
            full_path.display()
        )));
    }

    Ok(full_path)
}

fn graph_write_path(project_dir: &Path, graph_ref: &str) -> Result<PathBuf, LoadError> {
    let relative = normalize_graph_ref(graph_ref)?;
    Ok(project_dir.join("graphs").join(relative))
}

fn normalize_graph_ref(graph_ref: &str) -> Result<PathBuf, LoadError> {
    let trimmed = graph_ref.trim();
    if trimmed.is_empty() {
        return Err(LoadError(
            "scene: campo 'graph_ref' nao pode ser vazio.".into(),
        ));
    }

    let relative = PathBuf::from(trimmed);
    if relative.is_absolute()
        || relative.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(LoadError(format!(
            "Graph ref '{}' deve usar caminho relativo dentro de 'graphs/'.",
            graph_ref
        )));
    }

    if let Ok(stripped) = relative.strip_prefix("graphs") {
        let normalized = stripped.to_path_buf();
        if normalized.as_os_str().is_empty() {
            return Err(LoadError(format!(
                "Graph ref '{}' deve usar caminho relativo dentro de 'graphs/'.",
                graph_ref
            )));
        }
        return Ok(normalized);
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
            LoadError(format!(
                "Nao foi possivel criar '{}': {}",
                parent.display(),
                e
            ))
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
        let temp_wide: Vec<u16> = temp_path.as_os_str().encode_wide().chain(Some(0)).collect();

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

    fn write_platformer_donor_fixture(dir: &Path, with_jump: bool) {
        fs::create_dir_all(dir.join("res").join("images")).expect("create donor image dir");
        fs::create_dir_all(dir.join("res").join("sound")).expect("create donor sound dir");
        fs::create_dir_all(dir.join("out")).expect("create donor out dir");
        fs::create_dir_all(dir.join("src")).expect("create donor src dir");
        fs::create_dir_all(dir.join("inc")).expect("create donor inc dir");
        fs::create_dir_all(dir.join("src").join("boot")).expect("create donor boot dir");

        image::RgbaImage::from_pixel(48, 72, image::Rgba([255, 196, 0, 255]))
            .save(dir.join("res").join("images").join("player.png"))
            .expect("write player png");
        image::RgbaImage::from_pixel(64, 64, image::Rgba([48, 145, 255, 255]))
            .save(dir.join("res").join("images").join("level.png"))
            .expect("write level png");
        fs::write(
            dir.join("res").join("resources.res"),
            "SPRITE  player_sprite  \"images/player.png\"  3 3  FAST 5\n\
             TILESET level_tileset  \"images/level.png\"  FAST ALL\n",
        )
        .expect("write resources.res");
        if with_jump {
            fs::write(
                dir.join("res").join("sound").join("jump.wav"),
                minimal_wav_bytes(),
            )
            .expect("write jump asset");
        }
        fs::write(
            dir.join("res").join("sound").join("sonic2Emerald.vgm"),
            b"forbidden-vgm",
        )
        .expect("write forbidden vgm");
        fs::write(dir.join("out").join("rom.bin"), b"forbidden-rom").expect("write rom.bin");
        fs::write(dir.join("out").join("symbol.txt"), b"forbidden-symbol")
            .expect("write symbol.txt");
        fs::write(dir.join("src").join("main.c"), b"int main(void){return 0;}")
            .expect("write main.c");
        fs::write(dir.join("inc").join("player.h"), b"void player(void);").expect("write player.h");
        fs::write(dir.join("src").join("boot").join("sega.s"), b"boot").expect("write boot source");
    }

    fn write_generic_sgdk_donor_fixture(dir: &Path) {
        fs::create_dir_all(dir.join("res").join("images")).expect("create donor image dir");
        fs::create_dir_all(dir.join("res").join("maps")).expect("create donor map dir");
        fs::create_dir_all(dir.join("res").join("sound")).expect("create donor sound dir");
        fs::create_dir_all(dir.join("out")).expect("create donor out dir");
        fs::create_dir_all(dir.join("src")).expect("create donor src dir");
        fs::create_dir_all(dir.join("inc")).expect("create donor inc dir");
        fs::create_dir_all(dir.join("boot")).expect("create donor boot dir");

        image::RgbaImage::from_pixel(32, 32, image::Rgba([0, 220, 120, 255]))
            .save(dir.join("res").join("images").join("hero.png"))
            .expect("write hero sprite");
        image::RgbaImage::from_pixel(128, 128, image::Rgba([32, 64, 180, 255]))
            .save(dir.join("res").join("maps").join("stage.png"))
            .expect("write stage image");
        fs::write(
            dir.join("res").join("sound").join("jump.wav"),
            minimal_wav_bytes(),
        )
        .expect("write wav");
        fs::write(dir.join("res").join("sound").join("theme.xgm"), b"xgm-data").expect("write xgm");
        fs::write(
            dir.join("res").join("sound").join("forbidden.vgm"),
            b"vgm-data",
        )
        .expect("write vgm");
        fs::write(
            dir.join("res").join("resources.res"),
            [
                "SPRITE hero images/hero.png 4 4 FAST 0",
                "IMAGE stage maps/stage.png NONE",
                "WAV jump sound/jump.wav 22050",
                "XGM theme sound/theme.xgm",
                "VGM forbidden sound/forbidden.vgm",
            ]
            .join("\n"),
        )
        .expect("write resources.res");
        fs::write(dir.join("out").join("rom.bin"), b"forbidden-rom").expect("write rom");
        fs::write(dir.join("src").join("main.c"), b"int main(void){return 0;}")
            .expect("write main");
        fs::write(dir.join("inc").join("game.h"), b"void game(void);").expect("write header");
        fs::write(dir.join("boot").join("startup.s"), b"boot").expect("write boot");
    }

    fn write_split_sgdk_donor_fixture(dir: &Path) {
        fs::create_dir_all(dir.join("res").join("sprite")).expect("create donor sprite dir");
        fs::create_dir_all(dir.join("res").join("stages")).expect("create donor stages dir");
        fs::create_dir_all(dir.join("res").join("sound")).expect("create donor sound dir");
        fs::create_dir_all(dir.join("out")).expect("create donor out dir");
        fs::create_dir_all(dir.join("src")).expect("create donor src dir");
        fs::create_dir_all(dir.join("inc")).expect("create donor inc dir");
        fs::create_dir_all(dir.join("boot")).expect("create donor boot dir");

        image::RgbaImage::from_pixel(32, 32, image::Rgba([255, 150, 48, 255]))
            .save(dir.join("res").join("sprite").join("hero.png"))
            .expect("write split hero sprite");
        image::RgbaImage::from_pixel(128, 128, image::Rgba([32, 96, 196, 255]))
            .save(dir.join("res").join("stages").join("forest.png"))
            .expect("write split stage image");
        fs::write(
            dir.join("res").join("sound").join("jump.wav"),
            minimal_wav_bytes(),
        )
        .expect("write split wav");
        fs::write(
            dir.join("res").join("sound").join("theme.xgm2"),
            b"xgm2-data",
        )
        .expect("write split xgm2");
        fs::write(
            dir.join("res").join("sound").join("forbidden.vgm"),
            b"vgm-data",
        )
        .expect("write split vgm");
        fs::write(
            dir.join("res").join("sprites.res"),
            "SPRITE hero sprite/hero.png 4 4 FAST 0",
        )
        .expect("write sprites.res");
        fs::write(
            dir.join("res").join("stages.res"),
            "IMAGE forest stages/forest.png NONE",
        )
        .expect("write stages.res");
        fs::write(
            dir.join("res").join("audio.res"),
            [
                "WAV jump sound/jump.wav 22050",
                "XGM2 theme sound/theme.xgm2",
                "VGM forbidden sound/forbidden.vgm",
            ]
            .join("\n"),
        )
        .expect("write audio.res");
        fs::write(dir.join("out").join("rom.bin"), b"forbidden-rom").expect("write split rom");
        fs::write(dir.join("src").join("main.c"), b"int main(void){return 0;}")
            .expect("write split main");
        fs::write(dir.join("inc").join("game.h"), b"void game(void);").expect("write split header");
        fs::write(dir.join("boot").join("startup.s"), b"boot").expect("write split boot");
    }

    fn minimal_wav_bytes() -> Vec<u8> {
        vec![
            82, 73, 70, 70, 36, 0, 0, 0, 87, 65, 86, 69, 102, 109, 116, 32, 16, 0, 0, 0, 1, 0, 1,
            0, 68, 172, 0, 0, 68, 172, 0, 0, 1, 0, 8, 0, 100, 97, 116, 97, 0, 0, 0, 0,
        ]
    }

    #[test]
    fn canonical_project_matches_megadrive_schema() {
        let project = canonical_project("Dummy", "megadrive").expect("canonical project");

        assert_eq!(project.rds_version, UGDM_VERSION);
        assert_eq!(project.schema_version, CURRENT_SCHEMA_VERSION);
        assert_eq!(project.target, "megadrive");
        assert_eq!(
            project.resolution,
            Resolution {
                width: 320,
                height: 224
            }
        );
        assert_eq!(project.palette_mode, "4x16");
        assert_eq!(project.entry_scene, DEFAULT_ENTRY_SCENE);
        assert_eq!(project.build, Some(default_build_config()));
    }

    #[test]
    fn list_project_templates_reads_registry_and_builtin_entries_are_available() {
        let templates = list_project_templates().expect("list templates");
        let ids = templates
            .iter()
            .map(|template| template.id.as_str())
            .collect::<Vec<_>>();

        assert_eq!(
            ids,
            vec![
                "empty",
                "starter_guided",
                "platformer_seed",
                "rpg_seed",
                "fighter_seed",
                "racing_seed",
                "action_seed",
            ]
        );
        assert!(
            templates
                .iter()
                .find(|template| template.id == "empty")
                .expect("empty template")
                .available
        );
        assert!(
            templates
                .iter()
                .find(|template| template.id == "starter_guided")
                .expect("starter template")
                .available
        );
    }

    #[test]
    fn external_platformer_template_reports_unavailable_when_required_asset_is_missing() {
        let donor_dir = temp_dir("platformer-donor-missing");
        fs::create_dir_all(donor_dir.join("res").join("images")).expect("create donor images");
        fs::write(
            donor_dir.join("res").join("images").join("player.png"),
            b"fake-player",
        )
        .expect("write donor player");

        let error = validate_platformer_donor_path(&donor_dir).expect_err("missing level asset");
        assert!(error.to_string().contains("level.png"));

        let _ = fs::remove_dir_all(donor_dir);
    }

    #[test]
    fn seed_platformer_template_copies_only_allowed_assets() {
        let donor_dir = temp_dir("platformer-donor");
        let project_dir = temp_dir("platformer-project");
        create_project_skeleton(&project_dir, "Platformer Seed", "megadrive")
            .expect("create project skeleton");
        write_platformer_donor_fixture(&donor_dir, true);

        let scene = seed_platformer_template(&project_dir, &donor_dir).expect("seed platformer");
        let player = project_dir.join(PLATFORMER_PLAYER_ASSET);
        let level = project_dir.join(PLATFORMER_TILESET_ASSET);
        let jump = project_dir.join(PLATFORMER_JUMP_ASSET);

        assert!(player.is_file());
        assert!(level.is_file());
        assert!(jump.is_file());
        assert_eq!(scene.entities.len(), 3);
        assert_eq!(
            scene.entities[0].prefab.as_deref(),
            Some("platformer_tilemap.json")
        );
        assert_eq!(
            scene.entities[1].prefab.as_deref(),
            Some("platformer_player.json")
        );
        assert_eq!(
            scene.entities[2].prefab.as_deref(),
            Some("platformer_camera.json")
        );
        assert!(project_dir
            .join("prefabs")
            .join("platformer_player.json")
            .is_file());
        assert!(project_dir
            .join("prefabs")
            .join("platformer_camera.json")
            .is_file());
        assert!(project_dir
            .join("prefabs")
            .join("platformer_tilemap.json")
            .is_file());
        assert!(project_dir
            .join("graphs")
            .join("platformer_player_logic.json")
            .is_file());
        assert!(!project_dir.join("out").exists());
        assert!(!project_dir.join("src").exists());
        assert!(!project_dir.join("inc").exists());
        assert!(!project_dir
            .join("assets")
            .join("audio")
            .join("sonic2Emerald.vgm")
            .exists());

        let _ = fs::remove_dir_all(donor_dir);
        let _ = fs::remove_dir_all(project_dir);
    }

    #[test]
    fn resolve_prefabs_loads_logic_graph_from_graph_ref() {
        let project_dir = temp_dir("graph-ref-resolve");
        create_project_skeleton(&project_dir, "Graph Ref Resolve", "megadrive")
            .expect("create project skeleton");
        save_graph_asset(
            &project_dir,
            "graphs/player_logic.json",
            &platformer_logic_graph(),
        )
        .expect("save graph asset");

        let scene = Scene {
            scene_id: "main".to_string(),
            schema_version: Some(CURRENT_SCHEMA_VERSION.to_string()),
            display_name: Some("Main".to_string()),
            background_layers: Vec::new(),
            entities: vec![Entity {
                entity_id: "player".to_string(),
                prefab: None,
                transform: crate::ugdm::entities::Transform { x: 0, y: 0 },
                components: Components {
                    logic: Some(LogicComponent {
                        graph: None,
                        graph_ref: Some("graphs/player_logic.json".to_string()),
                        variables: HashMap::new(),
                    }),
                    ..Components::default()
                },
            }],
            palettes: Vec::new(),
            retrofx: None,
            collision_map: None,
        };

        let resolved = resolve_prefabs(&project_dir, &scene).expect("resolve graph ref");

        assert!(resolved.entities[0]
            .components
            .logic
            .as_ref()
            .and_then(|logic| logic.graph.as_ref())
            .is_some_and(|graph| graph.contains("\"event_start\"")));

        let _ = fs::remove_dir_all(project_dir);
    }

    #[test]
    fn sync_external_graph_refs_writes_graph_file_and_keeps_scene_externalized() {
        let project_dir = temp_dir("graph-ref-sync");
        create_project_skeleton(&project_dir, "Graph Ref Sync", "megadrive")
            .expect("create project skeleton");

        let mut source_scene = Scene {
            scene_id: "main".to_string(),
            schema_version: Some(CURRENT_SCHEMA_VERSION.to_string()),
            display_name: Some("Main".to_string()),
            background_layers: Vec::new(),
            entities: vec![Entity {
                entity_id: "player".to_string(),
                prefab: None,
                transform: crate::ugdm::entities::Transform { x: 0, y: 0 },
                components: Components {
                    logic: Some(LogicComponent {
                        graph: Some("{\"stale\":true}".to_string()),
                        graph_ref: Some("graphs/player_logic.json".to_string()),
                        variables: HashMap::new(),
                    }),
                    ..Components::default()
                },
            }],
            palettes: Vec::new(),
            retrofx: None,
            collision_map: None,
        };
        let resolved_scene = Scene {
            entities: vec![Entity {
                entity_id: "player".to_string(),
                prefab: None,
                transform: crate::ugdm::entities::Transform { x: 0, y: 0 },
                components: Components {
                    logic: Some(LogicComponent {
                        graph: Some(platformer_logic_graph()),
                        graph_ref: Some("graphs/player_logic.json".to_string()),
                        variables: HashMap::new(),
                    }),
                    ..Components::default()
                },
            }],
            ..source_scene.clone()
        };

        sync_external_graph_refs(&project_dir, &mut source_scene, &resolved_scene)
            .expect("sync external graphs");

        let saved_graph = fs::read_to_string(project_dir.join("graphs").join("player_logic.json"))
            .expect("read saved graph");
        assert!(saved_graph.contains("\"event_start\""));
        assert_eq!(
            source_scene.entities[0]
                .components
                .logic
                .as_ref()
                .and_then(|logic| logic.graph.as_ref()),
            None
        );
        assert_eq!(
            source_scene.entities[0]
                .components
                .logic
                .as_ref()
                .and_then(|logic| logic.graph_ref.as_deref()),
            Some("graphs/player_logic.json")
        );

        let _ = fs::remove_dir_all(project_dir);
    }

    #[test]
    fn parse_sgdk_manifest_extracts_kind_name_path_and_params() {
        let manifest = r#"
            SPRITE hero "images/hero.png" 4 4 FAST 0
            IMAGE stage maps/stage.png NONE
            WAV jump sound/jump.wav 22050
            # comment
            VGM forbidden sound/forbidden.vgm
        "#;

        let resources = parse_sgdk_manifest(manifest);

        assert_eq!(resources.len(), 4);
        assert_eq!(resources[0].kind, "SPRITE");
        assert_eq!(resources[0].name, "hero");
        assert_eq!(resources[0].asset_path, "images/hero.png");
        assert_eq!(resources[0].params, vec!["4", "4", "FAST", "0"]);
        assert_eq!(resources[1].kind, "IMAGE");
        assert_eq!(resources[2].kind, "WAV");
        assert_eq!(resources[3].kind, "VGM");
    }

    #[test]
    fn import_sgdk_project_copies_supported_assets_and_skips_forbidden_outputs() {
        let donor_dir = temp_dir("sgdk-import-donor");
        let project_dir = temp_dir("sgdk-import-project");
        create_project_skeleton(&project_dir, "Imported SGDK", "megadrive")
            .expect("create project skeleton");
        write_generic_sgdk_donor_fixture(&donor_dir);

        let scene = import_sgdk_project(&project_dir, &donor_dir).expect("import sgdk project");

        assert!(project_dir
            .join("assets")
            .join("sprites")
            .join("hero.png")
            .is_file());
        assert!(project_dir
            .join("assets")
            .join("tilesets")
            .join("stage.png")
            .is_file());
        assert!(project_dir
            .join("assets")
            .join("audio")
            .join("jump.wav")
            .is_file());
        assert!(project_dir
            .join("assets")
            .join("audio")
            .join("theme.xgm")
            .is_file());
        assert!(!project_dir
            .join("assets")
            .join("audio")
            .join("forbidden.vgm")
            .exists());
        assert!(!project_dir.join("src").exists());
        assert!(!project_dir.join("inc").exists());
        assert!(!project_dir.join("out").exists());
        assert_eq!(scene.entities.len(), 4);
        assert!(scene.entities.iter().any(|entity| entity
            .components
            .sprite
            .as_ref()
            .is_some_and(|sprite| sprite.asset == "assets/sprites/hero.png")));
        assert!(scene.entities.iter().any(|entity| {
            entity
                .components
                .tilemap
                .as_ref()
                .is_some_and(|tilemap| tilemap.tileset == "assets/tilesets/stage.png")
        }));
        assert!(scene.entities.iter().any(|entity| {
            entity.components.audio.as_ref().is_some_and(|audio| {
                audio.sfx.get("jump") == Some(&"assets/audio/jump.wav".to_string())
                    && audio.bgm.as_deref() == Some("assets/audio/theme.xgm")
            })
        }));
        assert!(scene
            .entities
            .iter()
            .any(|entity| entity.entity_id == "main_camera"));
        let primary_sprite = scene
            .entities
            .iter()
            .find(|entity| entity.entity_id == "hero")
            .expect("primary sprite");
        assert!(primary_sprite
            .components
            .logic
            .as_ref()
            .and_then(|logic| logic.graph.as_deref())
            .is_some_and(|graph| graph.contains("\"event_start\"")));

        let _ = fs::remove_dir_all(donor_dir);
        let _ = fs::remove_dir_all(project_dir);
    }

    #[test]
    fn import_sgdk_project_combines_split_manifests_and_keeps_visual_entities_in_front_of_audio() {
        let donor_dir = temp_dir("sgdk-split-import-donor");
        let project_dir = temp_dir("sgdk-split-import-project");
        create_project_skeleton(&project_dir, "Imported Split SGDK", "megadrive")
            .expect("create project skeleton");
        write_split_sgdk_donor_fixture(&donor_dir);

        validate_sgdk_project_path(&donor_dir).expect("validate split sgdk donor");
        let scene =
            import_sgdk_project(&project_dir, &donor_dir).expect("import split sgdk project");

        assert!(project_dir
            .join("assets")
            .join("sprites")
            .join("hero.png")
            .is_file());
        assert!(project_dir
            .join("assets")
            .join("tilesets")
            .join("forest.png")
            .is_file());
        assert!(project_dir
            .join("assets")
            .join("audio")
            .join("jump.wav")
            .is_file());
        assert!(project_dir
            .join("assets")
            .join("audio")
            .join("theme.xgm2")
            .is_file());
        assert!(!project_dir
            .join("assets")
            .join("audio")
            .join("forbidden.vgm")
            .exists());
        assert!(scene
            .entities
            .first()
            .and_then(|entity| entity.components.tilemap.as_ref())
            .is_some());
        assert!(scene
            .entities
            .get(1)
            .and_then(|entity| entity.components.sprite.as_ref())
            .is_some());
        assert!(scene
            .entities
            .iter()
            .any(|entity| entity.entity_id == "audio_bank"));
        let hero = scene
            .entities
            .iter()
            .find(|entity| entity.entity_id == "hero")
            .expect("imported hero");
        assert!(hero
            .components
            .logic
            .as_ref()
            .and_then(|logic| logic.graph.as_deref())
            .is_some_and(|graph| graph.contains("\"sprite_move\"")));
        assert!(scene.entities.iter().any(|entity| {
            entity
                .components
                .audio
                .as_ref()
                .is_some_and(|audio| audio.bgm.as_deref() == Some("assets/audio/theme.xgm2"))
        }));

        let _ = fs::remove_dir_all(donor_dir);
        let _ = fs::remove_dir_all(project_dir);
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
        fs::write(
            project_dir.join("scenes").join("main.json"),
            legacy_scene.to_string(),
        )
        .expect("write scene");

        let project = load_project(&project_dir).expect("load migrated project");
        let scene = load_scene(&project_dir, "scenes/main.json").expect("load migrated scene");

        assert_eq!(project.schema_version, CURRENT_SCHEMA_VERSION);
        assert_eq!(
            project
                .build
                .as_ref()
                .map(|build| build.artifact_prefix.as_str()),
            Some("game")
        );
        assert_eq!(
            project
                .build
                .as_ref()
                .map(|build| build.patch_audit_log.len()),
            Some(0)
        );
        assert_eq!(
            scene.schema_version.as_deref(),
            Some(CURRENT_SCHEMA_VERSION)
        );

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
        fs::write(
            project_dir.join("scenes").join("main.json"),
            scene_v1_1.to_string(),
        )
        .expect("write scene");

        let project = load_project(&project_dir).expect("load migrated project");
        let scene = load_scene(&project_dir, "scenes/main.json").expect("load migrated scene");

        assert_eq!(project.schema_version, CURRENT_SCHEMA_VERSION);
        assert_eq!(
            project
                .build
                .as_ref()
                .map(|build| build.artifact_prefix.as_str()),
            Some("audit")
        );
        assert_eq!(
            project
                .build
                .as_ref()
                .map(|build| build.patch_audit_log.len()),
            Some(0)
        );
        assert_eq!(
            scene.schema_version.as_deref(),
            Some(CURRENT_SCHEMA_VERSION)
        );

        let _ = fs::remove_dir_all(project_dir);
    }

    #[test]
    fn migration_chain_upgrades_project_schema_1_2_0_to_1_3_0() {
        let project_dir = temp_dir("migration-1-2-0-to-1-3-0");
        fs::create_dir_all(project_dir.join("scenes")).expect("create scenes dir");

        let project_v1_2 = serde_json::json!({
            "rds_version": UGDM_VERSION,
            "schema_version": "1.2.0",
            "name": "Template Metadata Upgrade",
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
                "artifact_prefix": "game",
                "patch_audit_log": []
            }
        });
        let scene_v1_2 = serde_json::json!({
            "scene_id": DEFAULT_SCENE_ID,
            "schema_version": "1.2.0",
            "display_name": "Main Scene",
            "background_layers": [],
            "entities": [],
            "palettes": []
        });

        fs::write(project_dir.join("project.rds"), project_v1_2.to_string())
            .expect("write project");
        fs::write(
            project_dir.join("scenes").join("main.json"),
            scene_v1_2.to_string(),
        )
        .expect("write scene");

        let project = load_project(&project_dir).expect("load migrated project");

        assert_eq!(project.schema_version, CURRENT_SCHEMA_VERSION);
        assert!(project.template_metadata.is_none());

        let _ = fs::remove_dir_all(project_dir);
    }

    #[test]
    fn load_project_accepts_canonical_megadrive_fixture() {
        let project = load_project(&fixture_dir("megadrive_dummy")).expect("load fixture");
        let scene =
            load_scene(&fixture_dir("megadrive_dummy"), &project.entry_scene).expect("load scene");

        assert_eq!(project.schema_version, CURRENT_SCHEMA_VERSION);
        assert_eq!(project.target, "megadrive");
        assert_eq!(
            project.resolution,
            Resolution {
                width: 320,
                height: 224
            }
        );
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
        let scene =
            load_scene(&fixture_dir("snes_dummy"), &project.entry_scene).expect("load scene");

        assert_eq!(project.schema_version, CURRENT_SCHEMA_VERSION);
        assert_eq!(project.target, "snes");
        assert_eq!(
            project.resolution,
            Resolution {
                width: 256,
                height: 224
            }
        );
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
        let paths = scenes
            .iter()
            .map(|scene| scene.path.as_str())
            .collect::<Vec<_>>();

        assert_eq!(paths, vec!["scenes/bonus_stage.json", "scenes/main.json"]);
        assert_eq!(scenes[0].scene_id, "bonus_stage");
        assert_eq!(scenes[0].display_name, "Bonus Stage");
        assert_eq!(scenes[1].scene_id, DEFAULT_SCENE_ID);

        let _ = fs::remove_dir_all(project_dir);
    }

    #[test]
    fn list_scenes_returns_empty_when_directory_is_missing() {
        let project_dir = temp_dir("list-scenes-empty");

        assert!(list_scenes(&project_dir)
            .expect("list empty scenes")
            .is_empty());

        let _ = fs::remove_dir_all(project_dir);
    }

    #[test]
    fn create_scene_seeds_starter_scene_when_onboarding_asset_exists() {
        let project_dir = temp_dir("create-scene-starter");
        create_project_skeleton(&project_dir, "Starter Scenes", "megadrive")
            .expect("create canonical project");
        seed_onboarding_template(&project_dir, "megadrive").expect("seed onboarding project");

        let created =
            create_scene(&project_dir, Some("Teste")).expect("create scene with starter content");
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
        assert!(scene.entities[0]
            .components
            .logic
            .as_ref()
            .and_then(|logic| logic.graph.as_ref())
            .is_some_and(|graph| graph.contains("\"fromNode\":\"start\"")));

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

        let updated =
            set_entry_scene(&project_dir, "scenes/bonus_stage.json").expect("update entry scene");
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
            project
                .build
                .as_ref()
                .map(|build| build.artifact_prefix.as_str()),
            Some("game")
        );
        assert!(project.template_metadata.is_none());
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
                meta_sprite: false,
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
                    graph_ref: None,
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
            template_metadata: None,
        };
        let scene = Scene {
            scene_id: DEFAULT_SCENE_ID.to_string(),
            schema_version: Some("9.9.9".to_string()),
            display_name: Some("Main Scene".to_string()),
            background_layers: Vec::new(),
            entities: Vec::new(),
            palettes: Vec::new(),
            retrofx: None,
            collision_map: None,
        };

        let project_warning =
            schema_warning_message("project.rds", normalized_project_schema_version(&project))
                .expect("project warning");
        let scene_warning =
            schema_warning_message("scene", normalized_scene_schema_version(&scene))
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
            physics
                .max_velocity
                .as_ref()
                .map(|velocity| (velocity.x, velocity.y)),
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
        assert_eq!(
            scene,
            canonical_scene(DEFAULT_SCENE_ID, Some("Main Scene".to_string()))
        );
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
        let reloaded =
            load_scene(&project_dir, &project.entry_scene).expect("reload retrofx scene");

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
        assert_eq!(
            reloaded.resolution,
            Resolution {
                width: 256,
                height: 224
            }
        );
        assert_eq!(reloaded.palette_mode, "8x16");

        let _ = fs::remove_dir_all(project_dir);
    }

    #[test]
    fn save_project_replaces_existing_file_without_leaking_temp_files() {
        let project_dir = temp_dir("atomic-save");
        let mut project = canonical_project("Atomic Test", "megadrive").expect("canonical project");

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
            load_project(&project_dir)
                .expect("load updated project")
                .name,
            "Atomic Test Updated"
        );

        let _ = fs::remove_dir_all(project_dir);
    }

    // ── discover_project_rds tests ──────────────────────────────────────

    #[test]
    fn discover_project_rds_at_root() {
        let dir = temp_dir("discover-root");
        create_project_skeleton(&dir, "Root Project", "megadrive")
            .expect("create skeleton");

        let found = discover_project_rds(&dir).expect("should find at root");
        assert_eq!(found, dir);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn discover_project_rds_in_rds_subdir() {
        let dir = temp_dir("discover-rds");
        let rds_dir = dir.join("rds");
        create_project_skeleton(&rds_dir, "Overlay Project", "megadrive")
            .expect("create skeleton in rds/");

        let found = discover_project_rds(&dir).expect("should find in rds/");
        assert_eq!(found, rds_dir);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn discover_project_rds_in_arbitrary_subdir() {
        let dir = temp_dir("discover-arb");
        let sub = dir.join("myproject");
        create_project_skeleton(&sub, "Sub Project", "snes")
            .expect("create skeleton in subdir");

        let found = discover_project_rds(&dir).expect("should find in subdir");
        assert_eq!(found, sub);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn discover_project_rds_root_has_priority() {
        let dir = temp_dir("discover-prio");
        create_project_skeleton(&dir, "Root Wins", "megadrive")
            .expect("create root skeleton");
        let rds_dir = dir.join("rds");
        create_project_skeleton(&rds_dir, "Overlay Loses", "megadrive")
            .expect("create rds/ skeleton");

        let found = discover_project_rds(&dir).expect("should find root first");
        assert_eq!(found, dir);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn discover_project_rds_empty_dir_fails() {
        let dir = temp_dir("discover-empty");

        let result = discover_project_rds(&dir);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("project.rds nao encontrado"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn discover_project_rds_prefers_rds_over_other_subdir() {
        let dir = temp_dir("discover-rds-prio");
        // Create both rds/ and another subdir with project.rds
        let rds_dir = dir.join("rds");
        create_project_skeleton(&rds_dir, "RDS Overlay", "megadrive")
            .expect("create rds/ skeleton");
        let other_dir = dir.join("zzz_other");
        create_project_skeleton(&other_dir, "Other", "megadrive")
            .expect("create other skeleton");

        let found = discover_project_rds(&dir).expect("should find rds/ first");
        assert_eq!(found, rds_dir);

        let _ = fs::remove_dir_all(&dir);
    }
}
