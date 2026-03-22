use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Component, Path, PathBuf};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use image::{ImageBuffer, Rgba, RgbaImage};

use crate::ugdm::components::{
    AnimationDef, AudioComponent, CameraComponent, CollisionComponent, CollisionOffset, Components,
    InputComponent, LogicComponent, MugenAnimationFrame, MugenCollisionBox, PhysicsComponent, Pivot,
    SpriteComponent, TilemapComponent, Velocity,
};
use crate::ugdm::entities::{
    BuildConfig, CollisionMap, Entity, PaletteEntry, PatchAuditEntry, Project, Resolution, Scene,
    SceneLayer, TemplateMetadata, CURRENT_SCHEMA_VERSION,
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

/// Número máximo de tentativas em operações de I/O sujeitas a sharing violation (antivírus/Windows).
const FILE_IO_RETRY_ATTEMPTS: u32 = 5;
/// Intervalo entre tentativas (ms). Padrão para antivírus no Windows.
const FILE_IO_RETRY_DELAY_MS: u64 = 50;

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MugenCandidateKind {
    Character,
    Stage,
    Screenpack,
}

#[derive(Debug, Clone)]
struct MugenCandidate {
    kind: MugenCandidateKind,
    root_dir: PathBuf,
    def_path: PathBuf,
    display_name: String,
}

#[derive(Debug, Clone)]
pub struct MugenImportReport {
    pub primary_scene: Scene,
    pub imported_scenes: usize,
    pub skipped_sources: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ExternalImportReport {
    pub primary_scene: Scene,
    pub imported_scenes: usize,
    pub skipped_sources: Vec<String>,
}

#[derive(Debug, Clone, Default)]
struct MugenIniSection {
    name: String,
    entries: HashMap<String, String>,
}

#[derive(Debug, Clone)]
struct MugenAirFrame {
    group: i32,
    image: i32,
    axis_x: i32,
    axis_y: i32,
    duration: i32,
    flags: Vec<String>,
    clsn1: Vec<MugenCollisionBox>,
    clsn2: Vec<MugenCollisionBox>,
}

#[derive(Debug, Clone, Default)]
struct MugenAirAction {
    action_no: i32,
    loop_start: Option<u32>,
    frames: Vec<MugenAirFrame>,
}

#[derive(Debug, Clone)]
struct MugenSffSprite {
    group: i32,
    image: i32,
    axis: Pivot,
    pixels: RgbaImage,
}

#[derive(Debug, Clone)]
struct MugenSound {
    group: i32,
    sound_no: i32,
    payload: Vec<u8>,
}

#[derive(Debug, Clone)]
struct MugenCharacterAtlas {
    image: RgbaImage,
    frame_indices: HashMap<(i32, i32), u32>,
    cell_width: u32,
    cell_height: u32,
    pivot: Pivot,
}

type MugenSpriteKey = (i32, i32);
type MugenSpritePathMatch = (MugenSpriteKey, PathBuf);

#[derive(Debug, Clone)]
struct GodotExtResource {
    _resource_type: String,
    path: String,
}

#[derive(Debug, Clone)]
struct GodotNode {
    name: String,
    node_type: String,
    _parent: String,
    properties: HashMap<String, String>,
}

#[derive(Debug, Clone)]
struct GodotSceneParse {
    ext_resources: HashMap<String, GodotExtResource>,
    nodes: Vec<GodotNode>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SgdkAssetMaterialization {
    Copy,
    LinkOrCopy,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct LegacySgdkIndex {
    pub host_root: String,
    pub source_files: Vec<String>,
    pub header_files: Vec<String>,
    pub manifest_files: Vec<String>,
    pub resource_files: Vec<String>,
    pub output_files: Vec<String>,
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

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub struct ExternalImportProfileSummary {
    pub id: String,
    pub name: String,
    pub family: String,
    pub description: String,
    pub source_engine: String,
    pub support_status: String,
    pub supported_levels: Vec<String>,
    pub recommended_target: String,
    pub experimental: bool,
    pub importable: bool,
    pub mega_drive_only: bool,
}

#[derive(Debug, Clone, Copy)]
struct ExternalImportProfileDefinition {
    id: &'static str,
    name: &'static str,
    family: &'static str,
    description: &'static str,
    source_engine: &'static str,
    support_status: &'static str,
    supported_levels: &'static [&'static str],
    recommended_target: &'static str,
    experimental: bool,
    importable: bool,
    mega_drive_only: bool,
}

const EXTERNAL_IMPORT_PROFILES: &[ExternalImportProfileDefinition] = &[
    ExternalImportProfileDefinition {
        id: "sgdk",
        name: "SGDK",
        family: "16-bit",
        description: "Importa manifests .res, assets, cena base e audio de projetos SGDK externos.",
        source_engine: "sgdk",
        support_status: "Experimental",
        supported_levels: &["L1", "L2", "L3"],
        recommended_target: "megadrive",
        experimental: true,
        importable: true,
        mega_drive_only: true,
    },
    ExternalImportProfileDefinition {
        id: "mugen",
        name: "MUGEN",
        family: "Fighting",
        description: "Importa personagem, stage e screenpack via DEF/AIR com assets visuais e sonoros reais.",
        source_engine: "mugen",
        support_status: "Experimental",
        supported_levels: &["L1", "L2", "L3"],
        recommended_target: "megadrive",
        experimental: true,
        importable: true,
        mega_drive_only: true,
    },
    ExternalImportProfileDefinition {
        id: "ikemen_go",
        name: "Ikemen GO",
        family: "Fighting",
        description: "Usa a mesma base de importacao MUGEN para colecoes IKEMEN GO compatíveis.",
        source_engine: "ikemen_go",
        support_status: "Experimental",
        supported_levels: &["L1", "L2", "L3"],
        recommended_target: "megadrive",
        experimental: true,
        importable: true,
        mega_drive_only: true,
    },
    ExternalImportProfileDefinition {
        id: "godot",
        name: "Godot 2D",
        family: "2D scene-tree",
        description: "Importa Sprite2D, Camera2D e AudioStreamPlayer de cenas .tscn; nos complexos permanecem sinalizados como experimentais.",
        source_engine: "godot",
        support_status: "Experimental",
        supported_levels: &["L1", "L2", "L3"],
        recommended_target: "megadrive",
        experimental: true,
        importable: true,
        mega_drive_only: true,
    },
    ExternalImportProfileDefinition {
        id: "gamemaker",
        name: "GameMaker Studio 2",
        family: "2D room-based",
        description: "Roadmap: rooms, sprites e sounds em formato .yyp/.yy.",
        source_engine: "gamemaker",
        support_status: "Parcial",
        supported_levels: &["L1"],
        recommended_target: "megadrive",
        experimental: true,
        importable: false,
        mega_drive_only: true,
    },
    ExternalImportProfileDefinition {
        id: "construct",
        name: "Construct",
        family: "2D event-sheet",
        description: "Roadmap: layouts, sprites e audio com logica convertida apenas por hints.",
        source_engine: "construct",
        support_status: "Parcial",
        supported_levels: &["L1"],
        recommended_target: "megadrive",
        experimental: true,
        importable: false,
        mega_drive_only: true,
    },
    ExternalImportProfileDefinition {
        id: "rpg_maker",
        name: "RPG Maker",
        family: "Data-driven RPG",
        description: "Roadmap: mapas, tilesets, audio e eventos skeleton.",
        source_engine: "rpg_maker",
        support_status: "Parcial",
        supported_levels: &["L1"],
        recommended_target: "megadrive",
        experimental: true,
        importable: false,
        mega_drive_only: true,
    },
    ExternalImportProfileDefinition {
        id: "unity_2d",
        name: "Unity 2D",
        family: "General 2D",
        description: "Planejado para projetos 2D com serializacao em texto habilitada.",
        source_engine: "unity_2d",
        support_status: "Nao suportado",
        supported_levels: &[],
        recommended_target: "megadrive",
        experimental: true,
        importable: false,
        mega_drive_only: true,
    },
    ExternalImportProfileDefinition {
        id: "paper2d_bridge",
        name: "Paper2D / Unreal",
        family: "Exporter bridge",
        description: "Nao ha leitura nativa nesta wave; o caminho planejado e um pacote intermediario exportado.",
        source_engine: "paper2d_bridge",
        support_status: "Nao suportado",
        supported_levels: &[],
        recommended_target: "megadrive",
        experimental: true,
        importable: false,
        mega_drive_only: true,
    },
];

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
        layers: None,
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

pub fn list_external_import_profiles() -> Vec<ExternalImportProfileSummary> {
    EXTERNAL_IMPORT_PROFILES
        .iter()
        .map(|profile| ExternalImportProfileSummary {
            id: profile.id.to_string(),
            name: profile.name.to_string(),
            family: profile.family.to_string(),
            description: profile.description.to_string(),
            source_engine: profile.source_engine.to_string(),
            support_status: profile.support_status.to_string(),
            supported_levels: profile
                .supported_levels
                .iter()
                .map(|level| (*level).to_string())
                .collect(),
            recommended_target: profile.recommended_target.to_string(),
            experimental: profile.experimental,
            importable: profile.importable,
            mega_drive_only: profile.mega_drive_only,
        })
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
        "platformer_gm" => seed_platformer_gm_template(project_dir, &donor),
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
        &platformer_tilemap_prefab_with_dims(donor_dims.tilemap_width, donor_dims.tilemap_height),
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

pub fn seed_platformer_gm_template(
    project_dir: &Path,
    donor_path: &Path,
) -> Result<Scene, LoadError> {
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
        &platformer_tilemap_prefab_with_dims(donor_dims.tilemap_width, donor_dims.tilemap_height),
    )?;
    save_graph_asset(
        project_dir,
        "graphs/platformer_player_logic.json",
        &platformer_logic_graph_with_sound(jump_source.exists()),
    )?;

    let scene = platformer_gm_seed_scene();
    save_scene(project_dir, DEFAULT_ENTRY_SCENE, &scene)?;
    Ok(scene)
}

pub fn import_sgdk_project(project_dir: &Path, sgdk_path: &Path) -> Result<Scene, LoadError> {
    validate_sgdk_project_path(sgdk_path)?;
    let resources = load_sgdk_resources(sgdk_path)?;
    import_sgdk_resources_into_scene(
        project_dir,
        sgdk_path,
        &resources,
        SgdkAssetMaterialization::Copy,
        "Imported SGDK Project",
    )
}

pub fn import_legacy_sgdk_project(
    sgdk_root: &Path,
    project_name_override: Option<&str>,
) -> Result<PathBuf, LoadError> {
    let index = scan_legacy_sgdk_project(sgdk_root)?;
    let overlay_dir = sgdk_root.join("rds");
    if overlay_dir.join("project.rds").is_file() {
        write_legacy_sgdk_index(&overlay_dir, &index)?;
        return Ok(overlay_dir);
    }

    let project_name = project_name_override
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .or_else(|| {
            sgdk_root
                .file_name()
                .map(|name| name.to_string_lossy().trim().to_string())
                .filter(|name| !name.is_empty())
        })
        .unwrap_or_else(|| "Projeto SGDK Legado".to_string());

    create_project_skeleton(&overlay_dir, &project_name, "megadrive")?;

    let resources = load_sgdk_resources_if_present(sgdk_root)?;
    if resources
        .iter()
        .any(|resource| sgdk_asset_destination(&resource.kind, &resource.asset_path).is_some())
    {
        import_sgdk_resources_into_scene(
            &overlay_dir,
            sgdk_root,
            &resources,
            SgdkAssetMaterialization::LinkOrCopy,
            "Legacy SGDK Overlay",
        )?;
    }

    stamp_project_metadata(
        &overlay_dir,
        "legacy_sgdk_overlay".to_string(),
        "1.0.0".to_string(),
        "external_sgdk".to_string(),
        sgdk_root.to_string_lossy().to_string(),
        Some("sgdk".to_string()),
        Some("legacy_sgdk_overlay_v1".to_string()),
    )?;
    write_legacy_sgdk_index(&overlay_dir, &index)?;
    Ok(overlay_dir)
}

fn import_sgdk_resources_into_scene(
    project_dir: &Path,
    sgdk_path: &Path,
    resources: &[SgdkResourceEntry],
    materialization: SgdkAssetMaterialization,
    scene_name: &str,
) -> Result<Scene, LoadError> {
    let mut scene = canonical_scene(DEFAULT_SCENE_ID, Some(scene_name.to_string()));
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

        materialize_sgdk_asset(
            &source_path,
            &project_dir.join(&destination),
            materialization,
        )?;

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
                    display_name: Some(resource.name.clone()),
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
                        display_name: Some(resource.name.clone()),
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
            display_name: Some("Audio Bank".to_string()),
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
            display_name: Some("Main Camera".to_string()),
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

fn materialize_sgdk_asset(
    source: &Path,
    destination: &Path,
    materialization: SgdkAssetMaterialization,
) -> Result<(), LoadError> {
    match materialization {
        SgdkAssetMaterialization::Copy => copy_template_asset(source, destination),
        SgdkAssetMaterialization::LinkOrCopy => link_or_copy_template_asset(source, destination),
    }
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

fn external_import_profile_definition(
    profile_id: &str,
) -> Result<&'static ExternalImportProfileDefinition, LoadError> {
    EXTERNAL_IMPORT_PROFILES
        .iter()
        .find(|profile| profile.id == profile_id)
        .ok_or_else(|| {
            LoadError(format!(
                "Perfil de importacao externa '{}' nao esta registrado.",
                profile_id
            ))
        })
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

fn link_or_copy_template_asset(source: &Path, destination: &Path) -> Result<(), LoadError> {
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

    if destination.exists() {
        fs::remove_file(destination).map_err(|error| {
            LoadError(format!(
                "Nao foi possivel limpar o asset projetado '{}': {}",
                destination.display(),
                error
            ))
        })?;
    }

    if fs::hard_link(source, destination).is_ok() {
        return Ok(());
    }

    copy_template_asset(source, destination)
}

fn load_sgdk_resources_if_present(sgdk_path: &Path) -> Result<Vec<SgdkResourceEntry>, LoadError> {
    match find_sgdk_manifest_paths(sgdk_path) {
        Ok(paths) if !paths.is_empty() => load_sgdk_resources(sgdk_path),
        Ok(_) => Ok(Vec::new()),
        Err(_) => Ok(Vec::new()),
    }
}

fn scan_legacy_sgdk_project(sgdk_root: &Path) -> Result<LegacySgdkIndex, LoadError> {
    if !sgdk_root.is_dir() {
        return Err(LoadError(format!(
            "Projeto SGDK legado invalido: '{}' nao e um diretorio.",
            sgdk_root.display()
        )));
    }

    let mut source_files =
        collect_recursive_files_by_extension(sgdk_root, &["c", "s", "asm"], &["rds"])?;
    let mut header_files = collect_recursive_files_by_extension(sgdk_root, &["h"], &["rds"])?;
    let manifest_files = load_manifest_paths_if_present(sgdk_root)?;
    let resource_files = collect_recursive_files(sgdk_root.join("res"), sgdk_root)?;
    let output_files = collect_recursive_files(sgdk_root.join("out"), sgdk_root)?;

    source_files.sort();
    source_files.dedup();
    header_files.sort();
    header_files.dedup();

    let has_legacy_markers = !source_files.is_empty()
        || !header_files.is_empty()
        || !manifest_files.is_empty()
        || sgdk_root.join("src").is_dir()
        || sgdk_root.join("res").is_dir()
        || sgdk_root.join("inc").is_dir()
        || sgdk_root.join("out").is_dir()
        || sgdk_root.join("main.c").is_file();
    if !has_legacy_markers {
        return Err(LoadError(format!(
            "Diretorio '{}' nao parece um projeto SGDK legado nem um workspace RDS valido.",
            sgdk_root.display()
        )));
    }

    Ok(LegacySgdkIndex {
        host_root: sgdk_root.to_string_lossy().to_string(),
        source_files,
        header_files,
        manifest_files,
        resource_files,
        output_files,
    })
}

fn load_manifest_paths_if_present(sgdk_root: &Path) -> Result<Vec<String>, LoadError> {
    match find_sgdk_manifest_paths(sgdk_root) {
        Ok(paths) => {
            let mut manifests = paths
                .into_iter()
                .filter_map(|path| {
                    path.strip_prefix(sgdk_root)
                        .ok()
                        .map(normalize_relative_path)
                })
                .collect::<Vec<_>>();
            manifests.sort();
            manifests.dedup();
            Ok(manifests)
        }
        Err(_) => Ok(Vec::new()),
    }
}

fn collect_recursive_files_by_extension(
    root: &Path,
    allowed_extensions: &[&str],
    excluded_first_segments: &[&str],
) -> Result<Vec<String>, LoadError> {
    let mut collected = Vec::new();
    collect_recursive_files_inner(root, root, &mut collected, &|path, relative| {
        let first_segment = relative.split('/').next().unwrap_or_default();
        if excluded_first_segments
            .iter()
            .any(|segment| first_segment.eq_ignore_ascii_case(segment))
        {
            return false;
        }

        path.extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| {
                allowed_extensions
                    .iter()
                    .any(|expected| extension.eq_ignore_ascii_case(expected))
            })
    })?;
    Ok(collected)
}

fn collect_recursive_files(dir: PathBuf, root: &Path) -> Result<Vec<String>, LoadError> {
    let mut collected = Vec::new();
    collect_recursive_files_inner(&dir, root, &mut collected, &|_, _| true)?;
    Ok(collected)
}

fn collect_recursive_files_inner(
    current_dir: &Path,
    root: &Path,
    collected: &mut Vec<String>,
    include: &dyn Fn(&Path, &str) -> bool,
) -> Result<(), LoadError> {
    if !current_dir.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(current_dir).map_err(|error| {
        LoadError(format!(
            "Nao foi possivel ler diretorio legado '{}': {}",
            current_dir.display(),
            error
        ))
    })? {
        let entry = entry.map_err(|error| {
            LoadError(format!(
                "Nao foi possivel ler entrada em '{}': {}",
                current_dir.display(),
                error
            ))
        })?;
        let path = entry.path();
        if path.is_dir() {
            collect_recursive_files_inner(&path, root, collected, include)?;
            continue;
        }

        let Ok(relative) = path.strip_prefix(root) else {
            continue;
        };
        let normalized = normalize_relative_path(relative);
        if include(&path, &normalized) {
            collected.push(normalized);
        }
    }

    Ok(())
}

fn normalize_relative_path(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(segment) => Some(segment.to_string_lossy().to_string()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn write_legacy_sgdk_index(overlay_dir: &Path, index: &LegacySgdkIndex) -> Result<(), LoadError> {
    let index_path = overlay_dir.join("legacy_sgdk_index.json");
    let serialized = serde_json::to_string_pretty(index).map_err(|error| {
        LoadError(format!(
            "Nao foi possivel serializar o indice SGDK legado '{}': {}",
            index_path.display(),
            error
        ))
    })?;
    fs::write(&index_path, serialized).map_err(|error| {
        LoadError(format!(
            "Nao foi possivel salvar o indice SGDK legado '{}': {}",
            index_path.display(),
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
        display_name: None,
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
        display_name: None,
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
        display_name: None,
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
            display_name: Some("Tilemap".to_string()),
            prefab: Some("platformer_tilemap.json".to_string()),
            transform: crate::ugdm::entities::Transform { x: 0, y: 0 },
            components: Components::default(),
        },
        Entity {
            entity_id: "player".to_string(),
            display_name: Some("Player".to_string()),
            prefab: Some("platformer_player.json".to_string()),
            transform: crate::ugdm::entities::Transform { x: 48, y: 120 },
            components: Components::default(),
        },
        Entity {
            entity_id: "main_camera".to_string(),
            display_name: Some("Main Camera".to_string()),
            prefab: Some("platformer_camera.json".to_string()),
            transform: crate::ugdm::entities::Transform { x: 0, y: 0 },
            components: Components::default(),
        },
    ];
    scene
}

fn platformer_gm_seed_scene() -> Scene {
    let mut scene = canonical_scene(DEFAULT_SCENE_ID, Some("Platformer GameMaker".to_string()));
    scene.palettes = vec![PaletteEntry {
        slot: 0,
        colors: vec![
            "#080C14".to_string(), // Deep background
            "#1D4ED8".to_string(), // Blue
            "#15803D".to_string(), // Green
            "#F1F5F9".to_string(), // White
        ],
    }];

    // Configure 5 layers: BACKGROUND, MIDGROUND, FOREGROUND, INSTANCES, COLLISIONS
    scene.layers = Some(vec![
        SceneLayer {
            id: "layer_bg".to_string(),
            name: "BACKGROUND".to_string(),
            kind: "background".to_string(),
            visible: true,
            locked: false,
            depth: 0,
            entity_ids: Vec::new(),
        },
        SceneLayer {
            id: "layer_mid".to_string(),
            name: "MIDGROUND".to_string(),
            kind: "tile".to_string(),
            visible: true,
            locked: false,
            depth: 1,
            entity_ids: vec!["tilemap_bg".to_string()],
        },
        SceneLayer {
            id: "layer_fore".to_string(),
            name: "FOREGROUND".to_string(),
            kind: "tile".to_string(),
            visible: true,
            locked: false,
            depth: 2,
            entity_ids: Vec::new(),
        },
        SceneLayer {
            id: "layer_instances".to_string(),
            name: "INSTANCES".to_string(),
            kind: "sprite".to_string(),
            visible: true,
            locked: false,
            depth: 3,
            entity_ids: vec!["player".to_string(), "main_camera".to_string()],
        },
        SceneLayer {
            id: "layer_collisions".to_string(),
            name: "COLLISIONS".to_string(),
            kind: "object".to_string(),
            visible: true,
            locked: false,
            depth: 4,
            entity_ids: Vec::new(),
        },
    ]);

    scene.entities = vec![
        Entity {
            entity_id: "tilemap_bg".to_string(),
            display_name: Some("Tilemap".to_string()),
            prefab: Some("platformer_tilemap.json".to_string()),
            transform: crate::ugdm::entities::Transform { x: 0, y: 0 },
            components: Components::default(),
        },
        Entity {
            entity_id: "player".to_string(),
            display_name: Some("Player".to_string()),
            prefab: Some("platformer_player.json".to_string()),
            transform: crate::ugdm::entities::Transform { x: 48, y: 120 },
            components: Components::default(),
        },
        Entity {
            entity_id: "main_camera".to_string(),
            display_name: Some("Main Camera".to_string()),
            prefab: Some("platformer_camera.json".to_string()),
            transform: crate::ugdm::entities::Transform { x: 0, y: 0 },
            components: Components::default(),
        },
    ];

    scene.collision_map = Some(platformer_gm_collision_data());
    scene
}

fn platformer_gm_collision_data() -> CollisionMap {
    // Standard 40x28 grid for 320x224 res (8x8 tiles)
    let width = 40;
    let height = 28;
    let mut data = vec![0; (width * height) as usize];

    // Seed a simple ground platform at the bottom (lines 26 and 27)
    for x in 0..width {
        let idx = (26 * width + x) as usize;
        if idx < data.len() {
            data[idx] = 1;
        }
        let idx_last = (27 * width + x) as usize;
        if idx_last < data.len() {
            data[idx_last] = 1;
        }
    }

    CollisionMap {
        tile_width: 8,
        tile_height: 8,
        width,
        height,
        data,
    }
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

pub fn import_mugen_project(
    project_dir: &Path,
    mugen_path: &Path,
) -> Result<MugenImportReport, LoadError> {
    if !mugen_path.exists() {
        return Err(LoadError(format!(
            "Projeto MUGEN indisponivel: '{}' nao existe.",
            mugen_path.display()
        )));
    }

    let candidates = scan_mugen_candidates(mugen_path)?;
    if candidates.is_empty() {
        return Err(LoadError(format!(
            "Nenhum modelo MUGEN suportado foi encontrado em '{}'. Use uma pasta de personagem, stage ou screenpack.",
            mugen_path.display()
        )));
    }

    let mut imported = Vec::new();
    let mut skipped = Vec::new();

    for candidate in candidates {
        match import_mugen_candidate(project_dir, &candidate) {
            Ok(mut scenes) => imported.append(&mut scenes),
            Err(error) => skipped.push(format!("{}: {}", candidate.display_name, error)),
        }
    }

    if imported.is_empty() {
        return Err(LoadError(format!(
            "Nao foi possivel importar nenhum modelo MUGEN valido de '{}'. {}",
            mugen_path.display(),
            skipped.join(" | ")
        )));
    }

    let primary_scene = imported.remove(0);
    save_scene(project_dir, DEFAULT_ENTRY_SCENE, &primary_scene)?;
    for scene in imported.iter() {
        let scene_id = next_scene_id(project_dir, &scene.scene_id);
        let scene_path = format!("scenes/{}.json", scene_id);
        let mut extra_scene = scene.clone();
        extra_scene.scene_id = scene_id.clone();
        if extra_scene.display_name.is_none() {
            extra_scene.display_name = Some(scene_id);
        }
        save_scene(project_dir, &scene_path, &extra_scene)?;
    }
    set_entry_scene(project_dir, DEFAULT_ENTRY_SCENE)?;

    Ok(MugenImportReport {
        primary_scene,
        imported_scenes: 1 + imported.len(),
        skipped_sources: skipped,
    })
}

fn import_mugen_candidate(project_dir: &Path, candidate: &MugenCandidate) -> Result<Vec<Scene>, LoadError> {
    match candidate.kind {
        MugenCandidateKind::Character => import_mugen_character_candidate(project_dir, candidate)
            .map(|scene| vec![scene]),
        MugenCandidateKind::Stage => import_mugen_stage_candidate(project_dir, candidate)
            .map(|scene| vec![scene]),
        MugenCandidateKind::Screenpack => import_mugen_screenpack_candidate(project_dir, candidate),
    }
}

fn scan_mugen_candidates(root: &Path) -> Result<Vec<MugenCandidate>, LoadError> {
    let mut direct = detect_mugen_candidates_in_root(root)?;
    if !direct.is_empty() {
        direct.sort_by(|left, right| left.display_name.cmp(&right.display_name));
        return Ok(direct);
    }

    let mut nested = Vec::new();
    for child in sorted_directory_entries(root)? {
        if child.is_dir() {
            nested.extend(detect_mugen_candidates_in_root(&child)?);
        }
    }
    nested.sort_by(|left, right| left.display_name.cmp(&right.display_name));
    Ok(nested)
}

fn detect_mugen_candidates_in_root(root: &Path) -> Result<Vec<MugenCandidate>, LoadError> {
    if root.join("data").join("system.def").is_file() {
        let def_path = root.join("data").join("system.def");
        let display_name = read_text_lossy(&def_path)
            .ok()
            .and_then(|content| mugen_info_name(&content))
            .or_else(|| {
                root.file_name()
                    .map(|value| value.to_string_lossy().trim().to_string())
                    .filter(|value| !value.is_empty())
            })
            .unwrap_or_else(|| "Screenpack".to_string());
        return Ok(vec![MugenCandidate {
            kind: MugenCandidateKind::Screenpack,
            root_dir: root.to_path_buf(),
            def_path,
            display_name,
        }]);
    }

    let mut def_files = sorted_directory_entries(root)?
        .into_iter()
        .filter(|path| {
            path.is_file()
                && path
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("def"))
        })
        .collect::<Vec<_>>();
    def_files.sort();

    let mut stage_candidates = Vec::new();
    let mut character_candidates = Vec::new();

    for def_path in def_files {
        let content = read_text_lossy(&def_path)?;
        let lowered = content.to_ascii_lowercase();
        if lowered.contains("[bgdef]") || lowered.contains("[stageinfo]") {
            let display_name = mugen_info_name(&content)
                .or_else(|| def_path.file_stem().map(|value| value.to_string_lossy().to_string()))
                .unwrap_or_else(|| "Stage".to_string());
            stage_candidates.push(MugenCandidate {
                kind: MugenCandidateKind::Stage,
                root_dir: root.to_path_buf(),
                def_path,
                display_name,
            });
            continue;
        }

        let sections = parse_mugen_ini(&content);
        let Some(files_section) = find_section(&sections, "files") else {
            continue;
        };
        if files_section.entries.contains_key("sprite") && files_section.entries.contains_key("anim") {
            let folder_name = root
                .file_name()
                .map(|value| value.to_string_lossy().trim().to_string())
                .filter(|value| !value.is_empty());
            let stem = def_path
                .file_stem()
                .map(|value| value.to_string_lossy().trim().to_string())
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "character".to_string());
            let display_name = mugen_info_name(&content)
                .or(folder_name.clone())
                .unwrap_or_else(|| stem.clone());
            let score = mugen_character_def_score(&stem, folder_name.as_deref());
            character_candidates.push((score, MugenCandidate {
                kind: MugenCandidateKind::Character,
                root_dir: root.to_path_buf(),
                def_path,
                display_name,
            }));
        }
    }

    if !stage_candidates.is_empty() {
        return Ok(stage_candidates);
    }

    if character_candidates.is_empty() {
        return Ok(Vec::new());
    }

    character_candidates.sort_by(|left, right| right.0.cmp(&left.0));
    Ok(vec![character_candidates.remove(0).1])
}

fn sorted_directory_entries(root: &Path) -> Result<Vec<PathBuf>, LoadError> {
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    let mut entries = fs::read_dir(root)
        .map_err(|error| {
            LoadError(format!(
                "Nao foi possivel listar '{}': {}",
                root.display(),
                error
            ))
        })?
        .filter_map(|entry| entry.ok().map(|value| value.path()))
        .collect::<Vec<_>>();
    entries.sort();
    Ok(entries)
}

fn read_text_lossy(path: &Path) -> Result<String, LoadError> {
    let bytes = fs::read(path).map_err(|error| {
        LoadError(format!(
            "Nao foi possivel ler '{}': {}",
            path.display(),
            error
        ))
    })?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn parse_mugen_ini(content: &str) -> Vec<MugenIniSection> {
    let mut sections = Vec::new();
    let mut current: Option<MugenIniSection> = None;

    for raw_line in content.lines() {
        let trimmed = strip_mugen_comment(raw_line);
        if trimmed.is_empty() {
            continue;
        }

        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            if let Some(section) = current.take() {
                sections.push(section);
            }
            current = Some(MugenIniSection {
                name: trimmed[1..trimmed.len() - 1].trim().to_string(),
                entries: HashMap::new(),
            });
            continue;
        }

        if let Some((key, value)) = trimmed.split_once('=') {
            let section = current.get_or_insert_with(MugenIniSection::default);
            section.entries.insert(
                key.trim().to_ascii_lowercase(),
                value.trim().trim_matches('"').trim().to_string(),
            );
        }
    }

    if let Some(section) = current {
        sections.push(section);
    }

    sections
}

fn find_section<'a>(sections: &'a [MugenIniSection], name: &str) -> Option<&'a MugenIniSection> {
    sections
        .iter()
        .find(|section| section.name.eq_ignore_ascii_case(name))
}

fn strip_mugen_comment(line: &str) -> String {
    line.split(';').next().unwrap_or_default().trim().to_string()
}

fn mugen_info_name(content: &str) -> Option<String> {
    let sections = parse_mugen_ini(content);
    let info = find_section(&sections, "info")?;
    info.entries
        .get("displayname")
        .or_else(|| info.entries.get("name"))
        .map(|value| value.trim().trim_matches('"').trim().to_string())
        .filter(|value| !value.is_empty())
}

fn mugen_character_def_score(stem: &str, folder_name: Option<&str>) -> i32 {
    let lowered = stem.to_ascii_lowercase();
    let mut score = 0;
    if let Some(folder_name) = folder_name {
        let folder = folder_name.to_ascii_lowercase();
        if lowered == folder {
            score += 100;
        }
        if lowered.contains(&folder) {
            score += 50;
        }
    }
    if lowered == "command" || lowered.ends_with("command") {
        score -= 200;
    }
    if lowered.contains("master") || lowered.contains("normal") || lowered.contains("violent") {
        score -= 40;
    }
    score
}

fn parse_mugen_air(content: &str) -> Vec<MugenAirAction> {
    let mut actions = Vec::new();
    let mut current: Option<MugenAirAction> = None;
    let mut default_clsn1 = Vec::new();
    let mut default_clsn2 = Vec::new();
    let mut pending_clsn1 = Vec::new();
    let mut pending_clsn2 = Vec::new();

    for raw_line in content.lines() {
        let trimmed = strip_mugen_comment(raw_line);
        if trimmed.is_empty() {
            continue;
        }

        if let Some(action_no) = parse_begin_action(&trimmed) {
            if let Some(action) = current.take() {
                actions.push(action);
            }
            current = Some(MugenAirAction {
                action_no,
                loop_start: None,
                frames: Vec::new(),
            });
            default_clsn1.clear();
            default_clsn2.clear();
            pending_clsn1.clear();
            pending_clsn2.clear();
            continue;
        }

        let Some(action) = current.as_mut() else {
            continue;
        };

        if trimmed.eq_ignore_ascii_case("loopstart") {
            action.loop_start = Some(action.frames.len() as u32);
            continue;
        }

        if trimmed.to_ascii_lowercase().starts_with("clsn1default") {
            default_clsn1.clear();
            continue;
        }
        if trimmed.to_ascii_lowercase().starts_with("clsn2default") {
            default_clsn2.clear();
            continue;
        }
        if trimmed.to_ascii_lowercase().starts_with("clsn1:") {
            pending_clsn1.clear();
            continue;
        }
        if trimmed.to_ascii_lowercase().starts_with("clsn2:") {
            pending_clsn2.clear();
            continue;
        }

        if let Some(collision) = parse_mugen_collision_line(&trimmed, "clsn1") {
            if pending_clsn1.is_empty() && action.frames.is_empty() {
                default_clsn1.push(collision);
            } else {
                pending_clsn1.push(collision);
            }
            continue;
        }
        if let Some(collision) = parse_mugen_collision_line(&trimmed, "clsn2") {
            if pending_clsn2.is_empty() && action.frames.is_empty() {
                default_clsn2.push(collision);
            } else {
                pending_clsn2.push(collision);
            }
            continue;
        }

        if let Some(frame) = parse_mugen_air_frame_line(&trimmed) {
            action.frames.push(MugenAirFrame {
                group: frame.group,
                image: frame.image,
                axis_x: frame.axis_x,
                axis_y: frame.axis_y,
                duration: frame.duration,
                flags: frame.flags,
                clsn1: if pending_clsn1.is_empty() {
                    default_clsn1.clone()
                } else {
                    pending_clsn1.clone()
                },
                clsn2: if pending_clsn2.is_empty() {
                    default_clsn2.clone()
                } else {
                    pending_clsn2.clone()
                },
            });
            pending_clsn1.clear();
            pending_clsn2.clear();
        }
    }

    if let Some(action) = current {
        actions.push(action);
    }

    actions
}

fn parse_begin_action(line: &str) -> Option<i32> {
    let lowered = line.to_ascii_lowercase();
    if !lowered.starts_with("[begin action") || !lowered.ends_with(']') {
        return None;
    }
    let inner = line
        .trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .trim();
    inner
        .split_whitespace()
        .last()
        .and_then(|value| value.parse::<i32>().ok())
}

fn parse_mugen_collision_line(line: &str, prefix: &str) -> Option<MugenCollisionBox> {
    let lowered = line.to_ascii_lowercase();
    if !lowered.starts_with(prefix) || !lowered.contains('=') {
        return None;
    }
    let (_, values) = line.split_once('=')?;
    let numbers = values
        .split(',')
        .filter_map(|value| value.trim().parse::<i32>().ok())
        .collect::<Vec<_>>();
    if numbers.len() != 4 {
        return None;
    }
    Some(MugenCollisionBox {
        x1: numbers[0],
        y1: numbers[1],
        x2: numbers[2],
        y2: numbers[3],
    })
}

fn parse_mugen_air_frame_line(line: &str) -> Option<MugenAirFrame> {
    let parts = line
        .split(',')
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    if parts.len() < 5 {
        return None;
    }
    let group = parts[0].parse::<i32>().ok()?;
    let image = parts[1].parse::<i32>().ok()?;
    let axis_x = parts[2].parse::<i32>().ok()?;
    let axis_y = parts[3].parse::<i32>().ok()?;
    let duration = parts[4].parse::<i32>().ok()?;
    let flags = parts[5..]
        .iter()
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_uppercase())
        .collect::<Vec<_>>();
    Some(MugenAirFrame {
        group,
        image,
        axis_x,
        axis_y,
        duration,
        flags,
        clsn1: Vec::new(),
        clsn2: Vec::new(),
    })
}

fn import_mugen_character_candidate(
    project_dir: &Path,
    candidate: &MugenCandidate,
) -> Result<Scene, LoadError> {
    let def_content = read_text_lossy(&candidate.def_path)?;
    let sections = parse_mugen_ini(&def_content);
    let files = find_section(&sections, "files").ok_or_else(|| {
        LoadError(format!(
            "Character '{}' nao possui secao [Files] valida.",
            candidate.def_path.display()
        ))
    })?;

    let anim_rel = files.entries.get("anim").ok_or_else(|| {
        LoadError(format!(
            "Character '{}' nao define arquivo AIR em [Files].",
            candidate.def_path.display()
        ))
    })?;
    let sprite_rel = files.entries.get("sprite").ok_or_else(|| {
        LoadError(format!(
            "Character '{}' nao define arquivo SFF em [Files].",
            candidate.def_path.display()
        ))
    })?;
    let anim_path = candidate.root_dir.join(anim_rel);
    let sprite_path = candidate.root_dir.join(sprite_rel);
    let actions = parse_mugen_air(&read_text_lossy(&anim_path)?);
    if actions.is_empty() {
        return Err(LoadError(format!(
            "Arquivo AIR '{}' nao possui actions importaveis.",
            anim_path.display()
        )));
    }

    let requested_refs = collect_mugen_action_refs(&actions);
    let extracted_sprites = load_mugen_sprite_assets(&sprite_path, &requested_refs)?;
    if extracted_sprites.is_empty() {
        return Err(LoadError(format!(
            "Nenhum sprite referenciado pelo AIR foi encontrado em '{}' nem em work/*_sff.",
            sprite_path.display()
        )));
    }

    let atlas = compose_mugen_character_atlas(&extracted_sprites)?;
    let character_slug = sgdk_entity_id(&candidate.display_name);
    let atlas_asset = format!("assets/sprites/mugen_{}_atlas.png", character_slug);
    save_rgba_image(&project_dir.join(&atlas_asset), &atlas.image)?;

    let mut animations = mugen_actions_to_animation_defs(&actions, &atlas.frame_indices);
    if let Some(idle) = animations.get("action_0").cloned() {
        animations.insert("idle".to_string(), idle);
    }

    let mut scene = canonical_scene(
        &sgdk_entity_id(&candidate.display_name),
        Some(candidate.display_name.clone()),
    );
    let entity_id = sgdk_entity_id(&candidate.display_name);
    scene.entities.push(Entity {
        entity_id: entity_id.clone(),
        display_name: Some(candidate.display_name.clone()),
        prefab: None,
        transform: crate::ugdm::entities::Transform { x: 96, y: 96 },
        components: Components {
            sprite: Some(SpriteComponent {
                asset: atlas_asset,
                frame_width: atlas.cell_width,
                frame_height: atlas.cell_height,
                pivot: Some(atlas.pivot.clone()),
                palette_slot: 0,
                animations,
                priority: "foreground".to_string(),
                meta_sprite: atlas.cell_width > 32 || atlas.cell_height > 32,
            }),
            collision: mugen_collision_component_from_actions(&actions),
            logic: Some(LogicComponent {
                graph: Some(imported_mugen_idle_logic_graph(&entity_id)),
                graph_ref: None,
                variables: HashMap::new(),
            }),
            ..Components::default()
        },
    });

    let audio_sfx = files
        .entries
        .get("sound")
        .map(|path| candidate.root_dir.join(path))
        .filter(|path| path.is_file())
        .and_then(|snd_path| load_mugen_sounds(&snd_path).ok())
        .map(|sounds| save_mugen_sounds(project_dir, &character_slug, &sounds))
        .transpose()?
        .unwrap_or_default();
    if !audio_sfx.is_empty() {
        scene.entities.push(mugen_audio_bank_entity("audio_bank", audio_sfx, None));
    }

    scene.entities.push(Entity {
        entity_id: "main_camera".to_string(),
        display_name: Some("Main Camera".to_string()),
        prefab: None,
        transform: crate::ugdm::entities::Transform { x: 0, y: 0 },
        components: Components {
            camera: Some(CameraComponent {
                follow_entity: Some(entity_id),
                offset_x: 0,
                offset_y: 0,
            }),
            ..Components::default()
        },
    });

    Ok(scene)
}

fn import_mugen_stage_candidate(
    project_dir: &Path,
    candidate: &MugenCandidate,
) -> Result<Scene, LoadError> {
    let content = read_text_lossy(&candidate.def_path)?;
    let sections = parse_mugen_ini(&content);
    let stage_slug = sgdk_entity_id(&candidate.display_name);
    let mut scene = canonical_scene(&stage_slug, Some(candidate.display_name.clone()));

    if let Some(loose_background) = discover_loose_background_image(&candidate.root_dir, &candidate.def_path) {
        let asset_rel = format!(
            "assets/tilesets/{}_bg{}",
            stage_slug,
            loose_background
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| format!(".{}", value))
                .unwrap_or_else(|| ".png".to_string())
        );
        copy_template_asset(&loose_background, &project_dir.join(&asset_rel))?;
        scene.entities.push(static_mugen_sprite_entity(
            "bg_0",
            candidate.display_name.as_str(),
            &asset_rel,
            &project_dir.join(&asset_rel),
            0,
            0,
        )?);
    } else {
        let bg_sections = sections
            .iter()
            .filter(|section| {
                let lowered = section.name.to_ascii_lowercase();
                lowered.starts_with("bg ") && lowered != "bgdef"
            })
            .cloned()
            .collect::<Vec<_>>();
        let bgdef = find_section(&sections, "bgdef").ok_or_else(|| {
            LoadError(format!(
                "Stage '{}' nao possui [BGdef].",
                candidate.def_path.display()
            ))
        })?;
        let spr_rel = bgdef.entries.get("spr").ok_or_else(|| {
            LoadError(format!(
                "Stage '{}' nao define sprite archive em [BGdef].",
                candidate.def_path.display()
            ))
        })?;
        let actions = parse_mugen_air(&content);
        let refs = collect_stage_sprite_refs(&bg_sections, &actions);
        let sprites = load_mugen_sprite_assets(&candidate.root_dir.join(spr_rel), &refs)?;
        for (index, section) in bg_sections.iter().enumerate() {
            if let Some((group, image)) = stage_section_sprite_ref(section, &actions) {
                let Some(sprite) = sprites.get(&(group, image)) else {
                    continue;
                };
                let asset_rel = format!(
                    "assets/tilesets/{}_bg_{}_{}_{}.png",
                    stage_slug, index, group, image
                );
                save_rgba_image(&project_dir.join(&asset_rel), &sprite.pixels)?;
                let (x, y) = parse_pair_i32(section.entries.get("start").map(String::as_str))
                    .unwrap_or((0, 0));
                scene.entities.push(static_mugen_sprite_entity(
                    &format!("bg_{}", index),
                    section.name.as_str(),
                    &asset_rel,
                    &project_dir.join(&asset_rel),
                    x,
                    y,
                )?);
            }
        }
    }

    if let Some(bgm_path) = resolve_mugen_music_path(
        candidate.root_dir.as_path(),
        find_section(&sections, "music").and_then(|section| section.entries.get("bgmusic")),
    ) {
        let ext = bgm_path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("bin");
        let asset_rel = format!("assets/audio/{}_bgm.{}", stage_slug, ext);
        copy_template_asset(&bgm_path, &project_dir.join(&asset_rel))?;
        scene.entities.push(mugen_audio_bank_entity(
            "audio_bank",
            HashMap::new(),
            Some(asset_rel),
        ));
    }

    if scene.entities.is_empty() {
        return Err(LoadError(format!(
            "Stage '{}' nao produziu assets importaveis nesta wave experimental.",
            candidate.display_name
        )));
    }
    Ok(scene)
}

fn import_mugen_screenpack_candidate(
    project_dir: &Path,
    candidate: &MugenCandidate,
) -> Result<Vec<Scene>, LoadError> {
    let content = read_text_lossy(&candidate.def_path)?;
    let sections = parse_mugen_ini(&content);
    let data_root = candidate
        .def_path
        .parent()
        .ok_or_else(|| LoadError("system.def invalido: diretorio pai ausente.".to_string()))?;
    let files = find_section(&sections, "files").ok_or_else(|| {
        LoadError(format!(
            "Screenpack '{}' nao possui [Files].",
            candidate.def_path.display()
        ))
    })?;
    let spr_rel = files.entries.get("spr").ok_or_else(|| {
        LoadError(format!(
            "Screenpack '{}' nao define system.sff em [Files].",
            candidate.def_path.display()
        ))
    })?;
    let sprite_archive = data_root.join(spr_rel);

    let title_sections = sections
        .iter()
        .filter(|section| section.name.to_ascii_lowercase().starts_with("titlebg "))
        .cloned()
        .collect::<Vec<_>>();
    let select_sections = sections
        .iter()
        .filter(|section| section.name.to_ascii_lowercase().starts_with("selectbg "))
        .cloned()
        .collect::<Vec<_>>();

    let mut refs = collect_stage_sprite_refs(&title_sections, &[]);
    refs.extend(collect_stage_sprite_refs(&select_sections, &[]));
    let extracted = if !refs.is_empty() {
        load_mugen_sprite_assets(&sprite_archive, &refs)?
    } else {
        HashMap::new()
    };

    let mut scenes = Vec::new();
    let mut scene_errors = Vec::new();
    if !title_sections.is_empty() {
        let title_bgm = resolve_mugen_music_path(
            data_root,
            find_section(&sections, "music").and_then(|music| music.entries.get("title.bgm")),
        );
        match build_mugen_visual_scene(
            project_dir,
            &format!("{} Title", candidate.display_name),
            &title_sections,
            &extracted,
            title_bgm.as_ref(),
            "title",
        ) {
            Ok(scene) => scenes.push(scene),
            Err(error) => scene_errors.push(format!("title: {}", error)),
        }
    }
    if !select_sections.is_empty() {
        let select_bgm = resolve_mugen_music_path(
            data_root,
            find_section(&sections, "music").and_then(|music| music.entries.get("select.bgm")),
        );
        match build_mugen_visual_scene(
            project_dir,
            &format!("{} Select", candidate.display_name),
            &select_sections,
            &extracted,
            select_bgm.as_ref(),
            "select",
        ) {
            Ok(scene) => scenes.push(scene),
            Err(error) => scene_errors.push(format!("select: {}", error)),
        }
    }

    if scenes.is_empty() {
        return Err(LoadError(format!(
            "Screenpack '{}' nao possui BGs importaveis suportados nesta wave. {}",
            candidate.display_name,
            scene_errors.join(" | ")
        )));
    }

    Ok(scenes)
}

fn build_mugen_visual_scene(
    project_dir: &Path,
    display_name: &str,
    sections: &[MugenIniSection],
    extracted_sprites: &HashMap<(i32, i32), MugenSffSprite>,
    music_path: Option<&PathBuf>,
    asset_prefix: &str,
) -> Result<Scene, LoadError> {
    let mut scene = canonical_scene(&sgdk_entity_id(display_name), Some(display_name.to_string()));
    let scene_slug = sgdk_entity_id(display_name);

    for (index, section) in sections.iter().enumerate() {
        if let Some((group, image)) = stage_section_sprite_ref(section, &[]) {
            let Some(sprite) = extracted_sprites.get(&(group, image)) else {
                continue;
            };
            let asset_rel = format!(
                "assets/tilesets/{}_{}_{}_{}_{}.png",
                scene_slug, asset_prefix, index, group, image
            );
            save_rgba_image(&project_dir.join(&asset_rel), &sprite.pixels)?;
            let (x, y) =
                parse_pair_i32(section.entries.get("start").map(String::as_str)).unwrap_or((0, 0));
            scene.entities.push(static_mugen_sprite_entity(
                &format!("{}_{}", asset_prefix, index),
                section.name.as_str(),
                &asset_rel,
                &project_dir.join(&asset_rel),
                x,
                y,
            )?);
        }
    }

    if let Some(music_path) = music_path {
        if music_path.is_file() {
            let ext = music_path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("bin");
            let asset_rel = format!("assets/audio/{}_{}.{}", scene_slug, asset_prefix, ext);
            copy_template_asset(music_path, &project_dir.join(&asset_rel))?;
            scene.entities.push(mugen_audio_bank_entity(
                "audio_bank",
                HashMap::new(),
                Some(asset_rel),
            ));
        }
    }

    if !scene
        .entities
        .iter()
        .any(|entity| entity.components.sprite.is_some() || entity.components.tilemap.is_some())
    {
        return Err(LoadError(format!(
            "Cena '{}' nao gerou nenhum asset visual importavel.",
            display_name
        )));
    }

    Ok(scene)
}

fn static_mugen_sprite_entity(
    entity_id: &str,
    display_name: &str,
    asset_rel: &str,
    asset_abs: &Path,
    x: i32,
    y: i32,
) -> Result<Entity, LoadError> {
    let (width, height) = image::image_dimensions(asset_abs).unwrap_or((32, 32));
    Ok(Entity {
        entity_id: entity_id.to_string(),
        display_name: Some(display_name.to_string()),
        prefab: None,
        transform: crate::ugdm::entities::Transform { x, y },
        components: Components {
            sprite: Some(SpriteComponent {
                asset: asset_rel.to_string(),
                frame_width: width,
                frame_height: height,
                pivot: None,
                palette_slot: 0,
                animations: HashMap::new(),
                priority: "background".to_string(),
                meta_sprite: width > 32 || height > 32,
            }),
            ..Components::default()
        },
    })
}

fn mugen_audio_bank_entity(
    entity_id: &str,
    sfx: HashMap<String, String>,
    bgm: Option<String>,
) -> Entity {
    Entity {
        entity_id: entity_id.to_string(),
        display_name: Some("Audio Bank".to_string()),
        prefab: None,
        transform: crate::ugdm::entities::Transform { x: 0, y: 0 },
        components: Components {
            audio: Some(AudioComponent { sfx, bgm }),
            ..Components::default()
        },
    }
}

fn collect_mugen_action_refs(actions: &[MugenAirAction]) -> HashSet<(i32, i32)> {
    actions
        .iter()
        .flat_map(|action| action.frames.iter().map(|frame| (frame.group, frame.image)))
        .collect()
}

fn mugen_actions_to_animation_defs(
    actions: &[MugenAirAction],
    frame_indices: &HashMap<(i32, i32), u32>,
) -> HashMap<String, AnimationDef> {
    let mut animations = HashMap::new();
    for action in actions {
        let frames = action
            .frames
            .iter()
            .filter_map(|frame| frame_indices.get(&(frame.group, frame.image)).copied())
            .collect::<Vec<_>>();
        if frames.is_empty() {
            continue;
        }
        let durations = action
            .frames
            .iter()
            .map(|frame| frame.duration.max(1))
            .collect::<Vec<_>>();
        let positive = durations.iter().copied().filter(|value| *value > 0).collect::<Vec<_>>();
        let avg = if positive.is_empty() {
            1.0
        } else {
            positive.iter().sum::<i32>() as f32 / positive.len() as f32
        };
        let fps = (60.0 / avg.max(1.0)).round().clamp(1.0, 60.0) as u32;
        let mugen_frames = action
            .frames
            .iter()
            .map(|frame| MugenAnimationFrame {
                group: frame.group,
                image: frame.image,
                axis: Some(Pivot {
                    x: frame.axis_x,
                    y: frame.axis_y,
                }),
                duration: frame.duration,
                flags: frame.flags.clone(),
                clsn1: frame.clsn1.clone(),
                clsn2: frame.clsn2.clone(),
            })
            .collect::<Vec<_>>();
        animations.insert(
            format!("action_{}", action.action_no),
            AnimationDef {
                frames,
                fps,
                looping: action.loop_start.is_some(),
                frame_durations: Some(durations),
                loop_start: action.loop_start,
                mugen_frames: Some(mugen_frames),
            },
        );
    }
    animations
}

fn mugen_collision_component_from_actions(actions: &[MugenAirAction]) -> Option<CollisionComponent> {
    let boxes = actions
        .iter()
        .find(|action| action.action_no == 0)
        .and_then(|action| action.frames.first())
        .map(|frame| frame.clsn2.as_slice())
        .or_else(|| {
            actions
                .iter()
                .flat_map(|action| action.frames.iter())
                .find(|frame| !frame.clsn2.is_empty())
                .map(|frame| frame.clsn2.as_slice())
        })?;
    if boxes.is_empty() {
        return None;
    }

    let min_x = boxes.iter().map(|entry| entry.x1.min(entry.x2)).min()?;
    let min_y = boxes.iter().map(|entry| entry.y1.min(entry.y2)).min()?;
    let max_x = boxes.iter().map(|entry| entry.x1.max(entry.x2)).max()?;
    let max_y = boxes.iter().map(|entry| entry.y1.max(entry.y2)).max()?;

    Some(CollisionComponent {
        shape: "aabb".to_string(),
        width: (max_x - min_x).unsigned_abs().max(1),
        height: (max_y - min_y).unsigned_abs().max(1),
        offset: Some(CollisionOffset { x: min_x, y: min_y }),
        solid: true,
        layer: Some("player".to_string()),
        collides_with: vec!["enemy".to_string(), "stage".to_string()],
    })
}

fn imported_mugen_idle_logic_graph(entity_id: &str) -> String {
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
                "outputs": [{ "id": "exec", "label": ">", "kind": "exec" }],
                "params": {}
            },
            {
                "id": "idle_anim",
                "type": "sprite_anim",
                "label": "Set Animation",
                "x": 260,
                "y": 80,
                "inputs": [{ "id": "exec", "label": ">", "kind": "exec" }],
                "outputs": [{ "id": "exec", "label": ">", "kind": "exec" }],
                "params": { "target": entity_id, "anim": "idle" }
            }
        ],
        "edges": [
            {
                "id": "edge_start_idle",
                "fromNode": "start",
                "fromPort": "exec",
                "toNode": "idle_anim",
                "toPort": "exec"
            }
        ]
    })
    .to_string()
}

fn compose_mugen_character_atlas(
    sprites: &HashMap<(i32, i32), MugenSffSprite>,
) -> Result<MugenCharacterAtlas, LoadError> {
    if sprites.is_empty() {
        return Err(LoadError(
            "Nao ha sprites suficientes para compor atlas MUGEN.".to_string(),
        ));
    }

    let mut ordered = sprites.values().cloned().collect::<Vec<_>>();
    ordered.sort_by(|left, right| {
        left.group
            .cmp(&right.group)
            .then(left.image.cmp(&right.image))
    });

    let anchor_x = ordered.iter().map(|sprite| sprite.axis.x).max().unwrap_or(0).max(0) as u32;
    let anchor_y = ordered.iter().map(|sprite| sprite.axis.y).max().unwrap_or(0).max(0) as u32;
    let cell_width = ordered
        .iter()
        .map(|sprite| {
            anchor_x + sprite.pixels.width().saturating_sub(sprite.axis.x.max(0) as u32)
        })
        .max()
        .unwrap_or(32)
        .max(1);
    let cell_height = ordered
        .iter()
        .map(|sprite| {
            anchor_y + sprite.pixels.height().saturating_sub(sprite.axis.y.max(0) as u32)
        })
        .max()
        .unwrap_or(32)
        .max(1);
    let count = ordered.len() as f32;
    let cols = count.sqrt().ceil().max(1.0) as u32;
    let rows = (ordered.len() as u32).div_ceil(cols);
    let mut atlas = ImageBuffer::from_pixel(cols * cell_width, rows * cell_height, Rgba([0, 0, 0, 0]));
    let mut frame_indices = HashMap::new();

    for (index, sprite) in ordered.iter().enumerate() {
        let index_u32 = index as u32;
        let cell_x = (index_u32 % cols) * cell_width;
        let cell_y = (index_u32 / cols) * cell_height;
        let offset_x = cell_x + anchor_x.saturating_sub(sprite.axis.x.max(0) as u32);
        let offset_y = cell_y + anchor_y.saturating_sub(sprite.axis.y.max(0) as u32);
        for y in 0..sprite.pixels.height() {
            for x in 0..sprite.pixels.width() {
                atlas.put_pixel(offset_x + x, offset_y + y, *sprite.pixels.get_pixel(x, y));
            }
        }
        frame_indices.insert((sprite.group, sprite.image), index_u32);
    }

    Ok(MugenCharacterAtlas {
        image: atlas,
        frame_indices,
        cell_width,
        cell_height,
        pivot: Pivot {
            x: anchor_x as i32,
            y: anchor_y as i32,
        },
    })
}

fn discover_loose_background_image(root_dir: &Path, def_path: &Path) -> Option<PathBuf> {
    let stem = def_path.file_stem()?.to_string_lossy().to_ascii_lowercase();
    sorted_directory_entries(root_dir)
        .ok()?
        .into_iter()
        .find(|path| {
            path.is_file()
                && path
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .is_some_and(|extension| {
                        ["png", "bmp", "jpg", "jpeg"]
                            .iter()
                            .any(|expected| extension.eq_ignore_ascii_case(expected))
                    })
                && path
                    .file_stem()
                    .map(|value| value.to_string_lossy().to_ascii_lowercase())
                    .is_some_and(|candidate| candidate == stem)
        })
}

fn resolve_mugen_music_path(root_dir: &Path, value: Option<&String>) -> Option<PathBuf> {
    let raw = value?.trim();
    if raw.is_empty() {
        return None;
    }
    let direct = root_dir.join(raw);
    if direct.is_file() {
        return Some(direct);
    }
    let relative = raw
        .strip_prefix("data/")
        .or_else(|| raw.strip_prefix("data\\"))
        .unwrap_or(raw);
    let fallback = root_dir.join(relative);
    fallback.is_file().then_some(fallback)
}

fn collect_stage_sprite_refs(
    sections: &[MugenIniSection],
    actions: &[MugenAirAction],
) -> HashSet<(i32, i32)> {
    sections
        .iter()
        .filter_map(|section| stage_section_sprite_ref(section, actions))
        .collect()
}

fn stage_section_sprite_ref(
    section: &MugenIniSection,
    actions: &[MugenAirAction],
) -> Option<(i32, i32)> {
    if let Some(spriteno) = section.entries.get("spriteno") {
        return parse_pair_i32(Some(spriteno));
    }
    if let Some(actionno) = section.entries.get("actionno").and_then(|value| value.parse::<i32>().ok()) {
        return actions
            .iter()
            .find(|action| action.action_no == actionno)
            .and_then(|action| action.frames.first())
            .map(|frame| (frame.group, frame.image));
    }
    None
}

fn parse_pair_i32(value: Option<&str>) -> Option<(i32, i32)> {
    let value = value?;
    let numbers = value
        .split(',')
        .filter_map(|entry| entry.trim().parse::<i32>().ok())
        .collect::<Vec<_>>();
    (numbers.len() >= 2).then_some((numbers[0], numbers[1]))
}

fn save_mugen_sounds(
    project_dir: &Path,
    prefix: &str,
    sounds: &[MugenSound],
) -> Result<HashMap<String, String>, LoadError> {
    let mut mapping = HashMap::new();
    for sound in sounds {
        if !sound.payload.starts_with(b"RIFF") {
            continue;
        }
        let asset_rel = format!(
            "assets/audio/{}_snd_{}_{}.wav",
            prefix, sound.group, sound.sound_no
        );
        let destination = project_dir.join(&asset_rel);
        let parent = destination.parent().ok_or_else(|| {
            LoadError(format!(
                "Destino de audio '{}' nao possui diretorio pai valido.",
                destination.display()
            ))
        })?;
        fs::create_dir_all(parent).map_err(|error| {
            LoadError(format!(
                "Nao foi possivel criar o diretorio '{}' para audio MUGEN: {}",
                parent.display(),
                error
            ))
        })?;
        fs::write(&destination, &sound.payload).map_err(|error| {
            LoadError(format!(
                "Nao foi possivel salvar audio '{}' em '{}': {}",
                prefix,
                destination.display(),
                error
            ))
        })?;
        mapping.insert(
            format!("snd_{}_{}", sound.group, sound.sound_no),
            asset_rel,
        );
    }
    Ok(mapping)
}

fn load_mugen_sounds(path: &Path) -> Result<Vec<MugenSound>, LoadError> {
    if path.is_file() && fs::read(path).is_ok_and(|bytes| bytes.starts_with(b"ElecbyteSnd")) {
        let decoded = extract_mugen_snd_v1(path)?;
        if !decoded.is_empty() {
            return Ok(decoded);
        }
    }
    Ok(Vec::new())
}

fn save_rgba_image(path: &Path, image: &RgbaImage) -> Result<(), LoadError> {
    let parent = path.parent().ok_or_else(|| {
        LoadError(format!(
            "Destino de imagem '{}' nao possui diretorio pai valido.",
            path.display()
        ))
    })?;
    fs::create_dir_all(parent).map_err(|error| {
        LoadError(format!(
            "Nao foi possivel criar o diretorio '{}' para imagem MUGEN: {}",
            parent.display(),
            error
        ))
    })?;
    image.save(path).map_err(|error| {
        LoadError(format!(
            "Nao foi possivel salvar imagem '{}' em '{}': {}",
            path.file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("asset"),
            path.display(),
            error
        ))
    })
}

fn mugen_sff_is_v1(path: &Path) -> Result<bool, LoadError> {
    let bytes = fs::read(path).map_err(|error| {
        LoadError(format!(
            "Nao foi possivel ler SFF '{}': {}",
            path.display(),
            error
        ))
    })?;
    Ok(bytes.starts_with(b"ElecbyteSpr")
        && read_le_u8(&bytes, 15).unwrap_or_default() == 1)
}

fn load_mugen_sprite_assets(
    archive_path: &Path,
    requested: &HashSet<(i32, i32)>,
) -> Result<HashMap<(i32, i32), MugenSffSprite>, LoadError> {
    if archive_path.is_file() && mugen_sff_is_v1(archive_path)? {
        let decoded = extract_mugen_sff_v1(archive_path, requested)?;
        if !decoded.is_empty() {
            return Ok(decoded);
        }
    }
    extract_mugen_work_sprites(archive_path, requested)
}

fn extract_mugen_work_sprites(
    archive_path: &Path,
    requested: &HashSet<(i32, i32)>,
) -> Result<HashMap<(i32, i32), MugenSffSprite>, LoadError> {
    let mut extracted = HashMap::new();
    for directory in mugen_work_sprite_directories(archive_path) {
        if !directory.is_dir() {
            continue;
        }
        for ((group, image), sprite_path) in mugen_requested_sprite_paths(&directory, requested)? {
            let pixels = image::open(&sprite_path)
                .map_err(|error| {
                    LoadError(format!(
                        "Nao foi possivel abrir sprite MUGEN extraido '{}': {}",
                        sprite_path.display(),
                        error
                    ))
                })?
                .to_rgba8();
            extracted.insert(
                (group, image),
                MugenSffSprite {
                    group,
                    image,
                    axis: Pivot { x: 0, y: 0 },
                    pixels,
                },
            );
        }
        if !extracted.is_empty() {
            break;
        }
    }
    Ok(extracted)
}

fn mugen_requested_sprite_paths(
    directory: &Path,
    requested: &HashSet<(i32, i32)>,
) -> Result<Vec<MugenSpritePathMatch>, LoadError> {
    let mut matches = Vec::new();
    for entry in fs::read_dir(directory).map_err(|error| {
        LoadError(format!(
            "Nao foi possivel listar sprites MUGEN extraidos em '{}': {}",
            directory.display(),
            error
        ))
    })? {
        let path = entry
            .map_err(|error| {
                LoadError(format!(
                    "Nao foi possivel iterar sprites MUGEN extraidos em '{}': {}",
                    directory.display(),
                    error
                ))
            })?
            .path();
        if !path.is_file() {
            continue;
        }
        let Some(extension) = path.extension().and_then(|value| value.to_str()) else {
            continue;
        };
        if !["png", "bmp", "jpg", "jpeg"]
            .iter()
            .any(|expected| extension.eq_ignore_ascii_case(expected))
        {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|value| value.to_str()) else {
            continue;
        };
        let Some((group, image)) = parse_mugen_sprite_file_stem(stem) else {
            continue;
        };
        if requested.is_empty() || requested.contains(&(group, image)) {
            matches.push(((group, image), path));
        }
    }
    matches.sort_by(|left, right| left.0.cmp(&right.0));
    Ok(matches)
}

fn parse_mugen_sprite_file_stem(stem: &str) -> Option<(i32, i32)> {
    let normalized = stem.replace('_', "-");
    let (group, image) = normalized.split_once('-')?;
    Some((group.trim().parse::<i32>().ok()?, image.trim().parse::<i32>().ok()?))
}

fn mugen_work_sprite_directories(archive_path: &Path) -> Vec<PathBuf> {
    let Some(parent) = archive_path.parent() else {
        return Vec::new();
    };
    let stem = archive_path
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "sprites".to_string());
    let mut directories = Vec::new();
    for base in [
        parent.join("work").join(format!("{}_sff", stem)),
        parent.join(format!("{}_sff", stem)),
    ] {
        directories.push(base.join("sd"));
        directories.push(base.join("hd"));
        directories.push(base);
    }
    directories
}

fn extract_mugen_sff_v1(
    path: &Path,
    requested: &HashSet<(i32, i32)>,
) -> Result<HashMap<(i32, i32), MugenSffSprite>, LoadError> {
    let bytes = fs::read(path).map_err(|error| {
        LoadError(format!(
            "Nao foi possivel ler SFF '{}': {}",
            path.display(),
            error
        ))
    })?;
    if !bytes.starts_with(b"ElecbyteSpr") {
        return Err(LoadError(format!(
            "Arquivo '{}' nao e um SFF Elecbyte valido.",
            path.display()
        )));
    }
    if read_le_u8(&bytes, 15).unwrap_or_default() != 1 {
        return Err(LoadError(format!(
            "SFF '{}' usa versao nao suportada nesta wave (apenas v1).",
            path.display()
        )));
    }

    let image_count = read_le_u32(&bytes, 20).unwrap_or(0) as usize;
    let subheader_offset = read_le_u32(&bytes, 24).unwrap_or(512) as usize;
    let subheader_size = read_le_u32(&bytes, 28).unwrap_or(32).max(32) as usize;
    let mut cursor = subheader_offset;
    let mut decoded = Vec::<Option<(Pivot, RgbaImage)>>::new();
    let mut extracted = HashMap::new();

    for _ in 0..image_count.max(1) {
        if cursor == 0 || cursor + subheader_size > bytes.len() {
            break;
        }
        let next_offset = read_le_u32(&bytes, cursor).unwrap_or(0) as usize;
        let length = read_le_u32(&bytes, cursor + 4).unwrap_or(0) as usize;
        let axis = Pivot {
            x: read_le_i16(&bytes, cursor + 8).unwrap_or(0) as i32,
            y: read_le_i16(&bytes, cursor + 10).unwrap_or(0) as i32,
        };
        let group = read_le_u16(&bytes, cursor + 12).unwrap_or(0) as i32;
        let image = read_le_u16(&bytes, cursor + 14).unwrap_or(0) as i32;
        let linked_index = read_le_u16(&bytes, cursor + 16).unwrap_or(0) as usize;

        let decoded_entry = if length > 0 {
            let data_start = cursor + subheader_size;
            let data_end = data_start.saturating_add(length);
            if data_end > bytes.len() {
                return Err(LoadError(format!(
                    "SFF '{}' possui sprite truncado em group={}, image={}.",
                    path.display(),
                    group,
                    image
                )));
            }
            let rgba = decode_mugen_pcx(&bytes[data_start..data_end])?;
            Some((axis.clone(), rgba))
        } else if linked_index > 0 {
            decoded
                .get(linked_index)
                .and_then(|value| value.as_ref().cloned())
        } else {
            None
        };

        if let Some((stored_axis, stored_pixels)) = decoded_entry.clone() {
            if requested.is_empty() || requested.contains(&(group, image)) {
                extracted.insert(
                    (group, image),
                    MugenSffSprite {
                        group,
                        image,
                        axis: stored_axis,
                        pixels: stored_pixels,
                    },
                );
            }
        }
        decoded.push(decoded_entry);

        if next_offset == 0 {
            break;
        }
        cursor = next_offset;
    }

    Ok(extracted)
}

fn extract_mugen_snd_v1(path: &Path) -> Result<Vec<MugenSound>, LoadError> {
    let bytes = fs::read(path).map_err(|error| {
        LoadError(format!(
            "Nao foi possivel ler SND '{}': {}",
            path.display(),
            error
        ))
    })?;
    if !bytes.starts_with(b"ElecbyteSnd") {
        return Err(LoadError(format!(
            "Arquivo '{}' nao e um SND Elecbyte valido.",
            path.display()
        )));
    }
    let mut cursor = read_le_u32(&bytes, 20).unwrap_or(512) as usize;
    let mut sounds = Vec::new();

    while cursor > 0 && cursor + 16 <= bytes.len() {
        let next_offset = read_le_u32(&bytes, cursor).unwrap_or(0) as usize;
        let length = read_le_u32(&bytes, cursor + 4).unwrap_or(0) as usize;
        let group = read_le_u32(&bytes, cursor + 8).unwrap_or(0) as i32;
        let sound_no = read_le_u32(&bytes, cursor + 12).unwrap_or(0) as i32;
        let data_start = cursor + 16;
        let data_end = data_start.saturating_add(length);
        if data_end > bytes.len() {
            break;
        }
        sounds.push(MugenSound {
            group,
            sound_no,
            payload: bytes[data_start..data_end].to_vec(),
        });
        if next_offset == 0 {
            break;
        }
        cursor = next_offset;
    }

    Ok(sounds)
}

fn decode_mugen_pcx(bytes: &[u8]) -> Result<RgbaImage, LoadError> {
    if bytes.len() < 128 + 769 {
        return Err(LoadError(
            "PCX MUGEN invalido: arquivo pequeno demais.".to_string(),
        ));
    }
    if bytes[0] != 0x0A || bytes[2] != 1 || bytes[3] != 8 {
        return Err(LoadError(
            "PCX MUGEN invalido: apenas PCX RLE 8bpp sao suportados nesta wave.".to_string(),
        ));
    }

    let xmin = read_le_u16(bytes, 4).unwrap_or(0) as u32;
    let ymin = read_le_u16(bytes, 6).unwrap_or(0) as u32;
    let xmax = read_le_u16(bytes, 8).unwrap_or(0) as u32;
    let ymax = read_le_u16(bytes, 10).unwrap_or(0) as u32;
    let width = xmax.saturating_sub(xmin) + 1;
    let height = ymax.saturating_sub(ymin) + 1;
    let color_planes = read_le_u8(bytes, 65).unwrap_or(1).max(1) as usize;
    let bytes_per_line = read_le_u16(bytes, 66).unwrap_or(width as u16) as usize;
    if bytes[bytes.len() - 769] != 0x0C {
        return Err(LoadError(
            "PCX MUGEN invalido: palette 8-bit ausente.".to_string(),
        ));
    }

    let pixel_data_end = bytes.len() - 769;
    let decoded_stride = bytes_per_line * color_planes;
    let expected = decoded_stride * height as usize;
    let mut decoded = Vec::with_capacity(expected);
    let mut index = 128usize;
    while decoded.len() < expected && index < pixel_data_end {
        let value = bytes[index];
        index += 1;
        if value & 0xC0 == 0xC0 {
            if index >= pixel_data_end {
                break;
            }
            let run = (value & 0x3F) as usize;
            let repeated = bytes[index];
            index += 1;
            for _ in 0..run {
                decoded.push(repeated);
            }
        } else {
            decoded.push(value);
        }
    }
    decoded.resize(expected, 0);

    let palette = &bytes[bytes.len() - 768..];
    let mut image = ImageBuffer::from_pixel(width, height, Rgba([0, 0, 0, 0]));
    for y in 0..height as usize {
        let row_start = y * decoded_stride;
        for x in 0..width as usize {
            let palette_index = decoded[row_start + x] as usize;
            let color_offset = palette_index * 3;
            let rgba = if color_offset + 2 < palette.len() {
                let alpha = if palette_index == 0 { 0 } else { 255 };
                Rgba([
                    palette[color_offset],
                    palette[color_offset + 1],
                    palette[color_offset + 2],
                    alpha,
                ])
            } else {
                Rgba([0, 0, 0, 0])
            };
            image.put_pixel(x as u32, y as u32, rgba);
        }
    }
    Ok(image)
}

fn read_le_u8(bytes: &[u8], offset: usize) -> Option<u8> {
    bytes.get(offset).copied()
}

fn read_le_u16(bytes: &[u8], offset: usize) -> Option<u16> {
    let slice = bytes.get(offset..offset + 2)?;
    Some(u16::from_le_bytes([slice[0], slice[1]]))
}

fn read_le_i16(bytes: &[u8], offset: usize) -> Option<i16> {
    let slice = bytes.get(offset..offset + 2)?;
    Some(i16::from_le_bytes([slice[0], slice[1]]))
}

fn read_le_u32(bytes: &[u8], offset: usize) -> Option<u32> {
    let slice = bytes.get(offset..offset + 4)?;
    Some(u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

pub fn import_external_project(
    project_dir: &Path,
    profile_id: &str,
    source_path: &Path,
) -> Result<ExternalImportReport, LoadError> {
    let profile = external_import_profile_definition(profile_id)?;
    if !profile.importable {
        return Err(LoadError(format!(
            "O perfil '{}' ainda nao esta importavel nesta wave (status: {}).",
            profile.name, profile.support_status
        )));
    }

    match profile.id {
        "sgdk" => import_sgdk_project(project_dir, source_path).map(|scene| ExternalImportReport {
            primary_scene: scene,
            imported_scenes: 1,
            skipped_sources: Vec::new(),
        }),
        "mugen" | "ikemen_go" => {
            let report = import_mugen_project(project_dir, source_path)?;
            Ok(ExternalImportReport {
                primary_scene: report.primary_scene,
                imported_scenes: report.imported_scenes,
                skipped_sources: report.skipped_sources,
            })
        }
        "godot" => import_godot_project(project_dir, source_path),
        _ => Err(LoadError(format!(
            "O perfil '{}' ainda nao possui adapter canonico.",
            profile.name
        ))),
    }
}

pub fn stamp_imported_external_profile_metadata(
    project_dir: &Path,
    profile_id: &str,
    source_path: &Path,
) -> Result<Project, LoadError> {
    let profile = external_import_profile_definition(profile_id)?;
    let (template_id, template_version, source_kind, import_profile) = match profile.id {
        "sgdk" => (
            "imported_sgdk".to_string(),
            "1.0.0".to_string(),
            "imported_sgdk".to_string(),
            "sgdk_manifest_v1".to_string(),
        ),
        "mugen" => (
            "imported_mugen".to_string(),
            "1.0.0".to_string(),
            "imported_mugen".to_string(),
            "mugen_def_air_v1".to_string(),
        ),
        "ikemen_go" => (
            "imported_ikemen_go".to_string(),
            "1.0.0".to_string(),
            "imported_ikemen_go".to_string(),
            "ikemen_go_mugen_v1".to_string(),
        ),
        "godot" => (
            "imported_godot".to_string(),
            "1.0.0".to_string(),
            "imported_godot".to_string(),
            "godot_tscn_v1".to_string(),
        ),
        _ => (
            format!("imported_{}", profile.source_engine),
            "1.0.0".to_string(),
            "imported_external".to_string(),
            format!("{}_v1", profile.source_engine),
        ),
    };

    stamp_external_import_metadata(
        project_dir,
        template_id,
        template_version,
        source_kind,
        profile.source_engine.to_string(),
        import_profile,
        source_path,
    )
}

pub fn import_godot_project(
    project_dir: &Path,
    godot_path: &Path,
) -> Result<ExternalImportReport, LoadError> {
    validate_godot_project_path(godot_path)?;
    let scene_path = detect_godot_primary_scene_path(godot_path)?;
    let content = read_text_lossy(&scene_path)?;
    let parsed = parse_godot_scene(&content)?;
    let scene_display_name = scene_path
        .file_stem()
        .map(|value| value.to_string_lossy().trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "Godot Scene".to_string());
    let GodotSceneParse {
        ext_resources,
        nodes,
    } = parsed;

    let mut scene = canonical_scene(DEFAULT_SCENE_ID, Some(scene_display_name));

    let mut entity_ids = HashSet::new();
    let mut first_sprite_id: Option<String> = None;
    let mut audio_sfx = HashMap::new();
    let mut audio_bgm: Option<String> = None;
    let mut pending_cameras = Vec::new();
    let mut asset_cache: HashMap<PathBuf, String> = HashMap::new();
    let mut skipped = Vec::new();

    for node in nodes {
        match node.node_type.as_str() {
            "Sprite2D" => {
                let Some(texture_ref) = node.properties.get("texture") else {
                    skipped.push(format!("{}: Sprite2D sem textura.", node.name));
                    continue;
                };
                let Some(texture_id) = godot_ext_resource_id(texture_ref) else {
                    skipped.push(format!("{}: referencia de textura Godot nao suportada.", node.name));
                    continue;
                };
                let Some(texture_resource) = ext_resources.get(&texture_id) else {
                    skipped.push(format!(
                        "{}: ExtResource '{}' nao encontrada para Sprite2D.",
                        node.name, texture_id
                    ));
                    continue;
                };
                let texture_source = resolve_godot_resource_path(godot_path, &texture_resource.path);
                if !texture_source.is_file() {
                    skipped.push(format!(
                        "{}: textura '{}' nao encontrada no projeto Godot.",
                        node.name,
                        texture_source.display()
                    ));
                    continue;
                }

                let asset = materialize_external_file(
                    project_dir,
                    godot_path,
                    &texture_source,
                    "sprites",
                    "godot",
                    &mut asset_cache,
                )?;
                let (frame_width, frame_height) =
                    image::image_dimensions(&texture_source).unwrap_or((32, 32));
                let entity_id = unique_entity_id(&mut entity_ids, &node.name, "sprite");
                if first_sprite_id.is_none() {
                    first_sprite_id = Some(entity_id.clone());
                }
                let (x, y) = parse_godot_position(node.properties.get("position"));
                scene.entities.push(Entity {
                    entity_id,
                    display_name: Some(node.name.clone()),
                    prefab: None,
                    transform: crate::ugdm::entities::Transform { x, y },
                    components: Components {
                        sprite: Some(SpriteComponent {
                            asset,
                            frame_width: frame_width.max(1),
                            frame_height: frame_height.max(1),
                            pivot: None,
                            palette_slot: 0,
                            animations: HashMap::new(),
                            priority: "foreground".to_string(),
                            meta_sprite: frame_width > 32 || frame_height > 32,
                        }),
                        ..Components::default()
                    },
                });
            }
            "Camera2D" => {
                let entity_id = unique_entity_id(&mut entity_ids, &node.name, "camera");
                let (x, y) = parse_godot_position(node.properties.get("position"));
                pending_cameras.push((entity_id, node.name, x, y));
            }
            "AudioStreamPlayer" | "AudioStreamPlayer2D" => {
                let Some(stream_ref) = node.properties.get("stream") else {
                    skipped.push(format!("{}: player de audio sem stream.", node.name));
                    continue;
                };
                let Some(stream_id) = godot_ext_resource_id(stream_ref) else {
                    skipped.push(format!("{}: referencia de audio Godot nao suportada.", node.name));
                    continue;
                };
                let Some(stream_resource) = ext_resources.get(&stream_id) else {
                    skipped.push(format!(
                        "{}: ExtResource '{}' nao encontrada para audio.",
                        node.name, stream_id
                    ));
                    continue;
                };
                let audio_source = resolve_godot_resource_path(godot_path, &stream_resource.path);
                if !audio_source.is_file() {
                    skipped.push(format!(
                        "{}: audio '{}' nao encontrado no projeto Godot.",
                        node.name,
                        audio_source.display()
                    ));
                    continue;
                }

                let asset = materialize_external_file(
                    project_dir,
                    godot_path,
                    &audio_source,
                    "audio",
                    "godot",
                    &mut asset_cache,
                )?;
                if node.node_type == "AudioStreamPlayer" && audio_bgm.is_none() {
                    audio_bgm = Some(asset);
                } else {
                    audio_sfx.insert(slugify_scene_id(&node.name), asset);
                }
            }
            "AnimatedSprite2D" | "TileMap" | "TileMapLayer" => {
                skipped.push(format!(
                    "{}: no '{}' ainda nao possui conversao nativa nesta wave.",
                    node.name, node.node_type
                ));
            }
            _ => {}
        }
    }

    for (entity_id, display_name, x, y) in pending_cameras {
        scene.entities.push(Entity {
            entity_id,
            display_name: Some(display_name),
            prefab: None,
            transform: crate::ugdm::entities::Transform { x, y },
            components: Components {
                camera: Some(CameraComponent {
                    follow_entity: first_sprite_id.clone(),
                    offset_x: 0,
                    offset_y: 0,
                }),
                ..Components::default()
            },
        });
    }

    if !audio_sfx.is_empty() || audio_bgm.is_some() {
        let entity_id = unique_entity_id(&mut entity_ids, "audio_bank", "audio");
        scene.entities.push(Entity {
            entity_id,
            display_name: Some("Godot Audio Bank".to_string()),
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

    if first_sprite_id.is_some()
        && !scene
            .entities
            .iter()
            .any(|entity| entity.components.camera.is_some())
    {
        scene.entities.push(Entity {
            entity_id: unique_entity_id(&mut entity_ids, "main_camera", "camera"),
            display_name: Some("Main Camera".to_string()),
            prefab: None,
            transform: crate::ugdm::entities::Transform { x: 0, y: 0 },
            components: Components {
                camera: Some(CameraComponent {
                    follow_entity: first_sprite_id,
                    offset_x: 0,
                    offset_y: 0,
                }),
                ..Components::default()
            },
        });
    }

    save_scene(project_dir, DEFAULT_ENTRY_SCENE, &scene)?;
    Ok(ExternalImportReport {
        primary_scene: scene,
        imported_scenes: 1,
        skipped_sources: skipped,
    })
}

fn validate_godot_project_path(godot_path: &Path) -> Result<(), LoadError> {
    if !godot_path.is_dir() {
        return Err(LoadError(format!(
            "Projeto Godot invalido: '{}' nao e um diretorio.",
            godot_path.display()
        )));
    }

    if godot_path.join("project.godot").is_file() {
        return Ok(());
    }

    let scenes =
        collect_recursive_files_by_extension(godot_path, &["tscn"], &[".godot", "addons", "import", "rds"])?;
    if scenes.is_empty() {
        return Err(LoadError(format!(
            "Projeto Godot invalido: nenhum arquivo 'project.godot' ou '.tscn' encontrado em '{}'.",
            godot_path.display()
        )));
    }

    Ok(())
}

fn detect_godot_primary_scene_path(godot_path: &Path) -> Result<PathBuf, LoadError> {
    let project_file = godot_path.join("project.godot");
    if project_file.is_file() {
        let content = read_text_lossy(&project_file)?;
        if let Some(scene_res_path) = find_godot_project_main_scene(&content) {
            let scene_path = resolve_godot_resource_path(godot_path, &scene_res_path);
            if scene_path.is_file() {
                return Ok(scene_path);
            }
        }
    }

    let mut scenes =
        collect_recursive_files_by_extension(godot_path, &["tscn"], &[".godot", "addons", "import", "rds"])?;
    scenes.sort();
    let first_scene = scenes.into_iter().next().ok_or_else(|| {
        LoadError(format!(
            "Projeto Godot invalido: nenhum '.tscn' importavel encontrado em '{}'.",
            godot_path.display()
        ))
    })?;
    Ok(godot_path.join(PathBuf::from(first_scene)))
}

fn find_godot_project_main_scene(content: &str) -> Option<String> {
    let mut current_section = String::new();
    for raw_line in content.lines() {
        let trimmed = raw_line.trim();
        if trimmed.is_empty() || trimmed.starts_with(';') || trimmed.starts_with('#') {
            continue;
        }
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            current_section = trimmed[1..trimmed.len() - 1].trim().to_string();
            continue;
        }
        if current_section.eq_ignore_ascii_case("application") {
            let (key, value) = trimmed.split_once('=')?;
            if key.trim().eq_ignore_ascii_case("run/main_scene") {
                return godot_string_value(value.trim());
            }
        }
    }
    None
}

fn parse_godot_scene(content: &str) -> Result<GodotSceneParse, LoadError> {
    let mut ext_resources = HashMap::new();
    let mut nodes = Vec::new();
    let mut current_kind: Option<String> = None;
    let mut current_attrs = HashMap::new();
    let mut current_props = HashMap::new();

    let flush_section =
        |kind: &Option<String>,
         attrs: &HashMap<String, String>,
         props: &HashMap<String, String>,
         ext_resources: &mut HashMap<String, GodotExtResource>,
         nodes: &mut Vec<GodotNode>| {
            let Some(kind) = kind.as_deref() else {
                return;
            };
            match kind {
                "ext_resource" => {
                    let Some(id) = attrs.get("id").cloned() else {
                        return;
                    };
                    let Some(path) = attrs.get("path").cloned() else {
                        return;
                    };
                    ext_resources.insert(
                        id,
                        GodotExtResource {
                            _resource_type: attrs.get("type").cloned().unwrap_or_default(),
                            path,
                        },
                    );
                }
                "node" => {
                    let Some(name) = attrs.get("name").cloned() else {
                        return;
                    };
                    let Some(node_type) = attrs.get("type").cloned() else {
                        return;
                    };
                    nodes.push(GodotNode {
                        name,
                        node_type,
                        _parent: attrs
                            .get("parent")
                            .cloned()
                            .unwrap_or_else(|| ".".to_string()),
                        properties: props.clone(),
                    });
                }
                _ => {}
            }
        };

    for raw_line in content.lines() {
        let trimmed = raw_line.trim();
        if trimmed.is_empty() || trimmed.starts_with(';') || trimmed.starts_with('#') {
            continue;
        }

        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            flush_section(
                &current_kind,
                &current_attrs,
                &current_props,
                &mut ext_resources,
                &mut nodes,
            );
            let (kind, attrs) = parse_godot_section_header(trimmed)?;
            current_kind = Some(kind);
            current_attrs = attrs;
            current_props = HashMap::new();
            continue;
        }

        if let Some((key, value)) = trimmed.split_once('=') {
            current_props.insert(key.trim().to_string(), value.trim().to_string());
        }
    }

    flush_section(
        &current_kind,
        &current_attrs,
        &current_props,
        &mut ext_resources,
        &mut nodes,
    );

    Ok(GodotSceneParse {
        ext_resources,
        nodes,
    })
}

fn parse_godot_section_header(line: &str) -> Result<(String, HashMap<String, String>), LoadError> {
    let inner = line
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .ok_or_else(|| LoadError(format!("Cabecalho Godot invalido: '{}'.", line)))?;
    let mut chars = inner.chars().peekable();
    let mut kind = String::new();
    while let Some(&ch) = chars.peek() {
        if ch.is_whitespace() {
            break;
        }
        kind.push(ch);
        chars.next();
    }

    while chars.peek().is_some_and(|ch| ch.is_whitespace()) {
        chars.next();
    }

    let mut attrs = HashMap::new();
    while chars.peek().is_some() {
        let mut key = String::new();
        while let Some(&ch) = chars.peek() {
            if ch == '=' || ch.is_whitespace() {
                break;
            }
            key.push(ch);
            chars.next();
        }
        while chars.peek().is_some_and(|ch| ch.is_whitespace()) {
            chars.next();
        }
        if chars.peek() != Some(&'=') {
            while chars.peek().is_some_and(|ch| ch.is_whitespace()) {
                chars.next();
            }
            if chars.peek().is_none() {
                break;
            }
            continue;
        }
        chars.next();
        while chars.peek().is_some_and(|ch| ch.is_whitespace()) {
            chars.next();
        }

        let mut value = String::new();
        if chars.peek() == Some(&'"') {
            chars.next();
            for ch in chars.by_ref() {
                if ch == '"' {
                    break;
                }
                value.push(ch);
            }
        } else {
            while let Some(&ch) = chars.peek() {
                if ch.is_whitespace() {
                    break;
                }
                value.push(ch);
                chars.next();
            }
        }

        if !key.trim().is_empty() {
            attrs.insert(key.trim().to_string(), value.trim().to_string());
        }

        while chars.peek().is_some_and(|ch| ch.is_whitespace()) {
            chars.next();
        }
    }

    if kind.trim().is_empty() {
        return Err(LoadError(format!("Cabecalho Godot sem tipo: '{}'.", line)));
    }

    Ok((kind.trim().to_string(), attrs))
}

fn resolve_godot_resource_path(root: &Path, value: &str) -> PathBuf {
    let trimmed = value.trim().trim_matches('"');
    let relative = trimmed.trim_start_matches("res://");
    root.join(PathBuf::from(relative.replace('/', "\\")))
}

fn godot_ext_resource_id(value: &str) -> Option<String> {
    let marker = "ExtResource(\"";
    let rest = value.split_once(marker)?.1;
    let id = rest.split('"').next()?.trim();
    if id.is_empty() {
        None
    } else {
        Some(id.to_string())
    }
}

fn godot_string_value(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if let Some(content) = trimmed
        .strip_prefix("&\"")
        .and_then(|value| value.strip_suffix('"'))
    {
        return Some(content.to_string());
    }
    if let Some(content) = trimmed
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
    {
        return Some(content.to_string());
    }
    None
}

fn parse_godot_position(value: Option<&String>) -> (i32, i32) {
    let Some(value) = value else {
        return (0, 0);
    };
    let Some(open) = value.find('(') else {
        return (0, 0);
    };
    let Some(close) = value.rfind(')') else {
        return (0, 0);
    };
    let values = value[open + 1..close]
        .split(',')
        .map(|part| part.trim().parse::<f32>().ok())
        .collect::<Vec<_>>();
    let x = values
        .first()
        .and_then(|value| *value)
        .unwrap_or(0.0)
        .round() as i32;
    let y = values
        .get(1)
        .and_then(|value| *value)
        .unwrap_or(0.0)
        .round() as i32;
    (x, y)
}

fn materialize_external_file(
    project_dir: &Path,
    source_root: &Path,
    source_path: &Path,
    bucket: &str,
    prefix: &str,
    cache: &mut HashMap<PathBuf, String>,
) -> Result<String, LoadError> {
    if let Some(destination) = cache.get(source_path) {
        return Ok(destination.clone());
    }

    let relative = source_path.strip_prefix(source_root).unwrap_or(source_path);
    let mut relative_without_ext = relative.to_path_buf();
    relative_without_ext.set_extension("");
    let slug = slugify_scene_id(&normalize_relative_path(&relative_without_ext));
    let extension = source_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "bin".to_string());
    let destination = format!("assets/{}/{}_{}.{}", bucket, prefix, slug, extension);
    copy_template_asset(source_path, &project_dir.join(&destination))?;
    cache.insert(source_path.to_path_buf(), destination.clone());
    Ok(destination)
}

fn unique_entity_id(existing: &mut HashSet<String>, seed: &str, fallback_prefix: &str) -> String {
    let mut base = slugify_scene_id(seed);
    if base == "scene" {
        base = fallback_prefix.to_string();
    }
    if existing.insert(base.clone()) {
        return base;
    }

    let mut index = 2u32;
    loop {
        let candidate = format!("{}_{}", base, index);
        if existing.insert(candidate.clone()) {
            return candidate;
        }
        index = index.saturating_add(1);
    }
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
        None,
        None,
    )
}

pub fn stamp_imported_sgdk_metadata(
    project_dir: &Path,
    source_path: &Path,
) -> Result<Project, LoadError> {
    stamp_external_import_metadata(
        project_dir,
        "imported_sgdk".to_string(),
        "1.0.0".to_string(),
        "imported_sgdk".to_string(),
        "sgdk".to_string(),
        "sgdk_manifest_v1".to_string(),
        source_path,
    )
}

pub fn stamp_imported_mugen_metadata(
    project_dir: &Path,
    source_path: &Path,
) -> Result<Project, LoadError> {
    stamp_external_import_metadata(
        project_dir,
        "imported_mugen".to_string(),
        "1.0.0".to_string(),
        "imported_mugen".to_string(),
        "mugen".to_string(),
        "mugen_def_air_v1".to_string(),
        source_path,
    )
}

pub fn stamp_external_import_metadata(
    project_dir: &Path,
    template_id: String,
    template_version: String,
    source_kind: String,
    source_engine: String,
    import_profile: String,
    source_path: &Path,
) -> Result<Project, LoadError> {
    stamp_project_metadata(
        project_dir,
        template_id,
        template_version,
        source_kind,
        source_path.to_string_lossy().to_string(),
        Some(source_engine),
        Some(import_profile),
    )
}

fn stamp_project_metadata(
    project_dir: &Path,
    template_id: String,
    template_version: String,
    source_kind: String,
    source_path: String,
    source_engine: Option<String>,
    import_profile: Option<String>,
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
        source_engine,
        import_profile,
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

pub fn load_legacy_sgdk_index(project_dir: &Path) -> Result<Option<LegacySgdkIndex>, LoadError> {
    let index_path = project_dir.join("legacy_sgdk_index.json");
    if !index_path.is_file() {
        return Ok(None);
    }

    let raw = fs::read_to_string(&index_path).map_err(|error| {
        LoadError(format!(
            "Nao foi possivel ler o indice SGDK legado '{}': {}",
            index_path.display(),
            error
        ))
    })?;

    let index = serde_json::from_str::<LegacySgdkIndex>(&raw).map_err(|error| {
        LoadError(format!(
            "Indice SGDK legado invalido em '{}': {}",
            index_path.display(),
            error
        ))
    })?;

    Ok(Some(index))
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
        display_name: Some("Player".to_string()),
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
            "1.3.0" => migrate_project_1_3_0_to_1_4_0(value)?,
            "1.4.0" => migrate_project_1_4_0_to_1_5_0(value)?,
            "1.5.0" => migrate_project_1_5_0_to_1_6_0(value)?,
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
            "1.3.0" => migrate_scene_1_3_0_to_1_4_0(value)?,
            "1.4.0" => migrate_scene_1_4_0_to_1_5_0(value)?,
            "1.5.0" => migrate_scene_1_5_0_to_1_6_0(value)?,
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

fn migrate_project_1_3_0_to_1_4_0(
    mut value: serde_json::Value,
) -> Result<serde_json::Value, LoadError> {
    let object = value
        .as_object_mut()
        .ok_or_else(|| LoadError("project.rds invalido: raiz JSON deve ser um objeto.".into()))?;
    object.insert(
        "schema_version".to_string(),
        serde_json::Value::String("1.4.0".to_string()),
    );
    Ok(value)
}

fn migrate_project_1_4_0_to_1_5_0(
    mut value: serde_json::Value,
) -> Result<serde_json::Value, LoadError> {
    let object = value
        .as_object_mut()
        .ok_or_else(|| LoadError("project.rds invalido: raiz JSON deve ser um objeto.".into()))?;
    object.insert(
        "schema_version".to_string(),
        serde_json::Value::String("1.5.0".to_string()),
    );
    Ok(value)
}

fn migrate_project_1_5_0_to_1_6_0(
    mut value: serde_json::Value,
) -> Result<serde_json::Value, LoadError> {
    let object = value
        .as_object_mut()
        .ok_or_else(|| LoadError("project.rds invalido: raiz JSON deve ser um objeto.".into()))?;
    object.insert(
        "schema_version".to_string(),
        serde_json::Value::String("1.6.0".to_string()),
    );
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

fn migrate_scene_1_3_0_to_1_4_0(
    mut value: serde_json::Value,
) -> Result<serde_json::Value, LoadError> {
    let object = value
        .as_object_mut()
        .ok_or_else(|| LoadError("scene invalida: raiz JSON deve ser um objeto.".into()))?;
    object.insert(
        "schema_version".to_string(),
        serde_json::Value::String("1.4.0".to_string()),
    );
    object
        .entry("collision_map".to_string())
        .or_insert(serde_json::Value::Null);
    Ok(value)
}

fn migrate_scene_1_4_0_to_1_5_0(
    mut value: serde_json::Value,
) -> Result<serde_json::Value, LoadError> {
    let object = value
        .as_object_mut()
        .ok_or_else(|| LoadError("scene invalida: raiz JSON deve ser um objeto.".into()))?;
    object.insert(
        "schema_version".to_string(),
        serde_json::Value::String("1.5.0".to_string()),
    );
    object
        .entry("layers".to_string())
        .or_insert(serde_json::Value::Null);
    Ok(value)
}

fn migrate_scene_1_5_0_to_1_6_0(
    mut value: serde_json::Value,
) -> Result<serde_json::Value, LoadError> {
    let object = value
        .as_object_mut()
        .ok_or_else(|| LoadError("scene invalida: raiz JSON deve ser um objeto.".into()))?;
    object.insert(
        "schema_version".to_string(),
        serde_json::Value::String("1.6.0".to_string()),
    );

    let Some(entities) = object
        .get_mut("entities")
        .and_then(serde_json::Value::as_array_mut)
    else {
        return Ok(value);
    };

    for entity in entities {
        let Some(entity_object) = entity.as_object_mut() else {
            continue;
        };

        let current_display_name = entity_object
            .get("display_name")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|entry| !entry.is_empty())
            .map(str::to_string);

        let prefab_value = entity_object
            .get("prefab")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|entry| !entry.is_empty())
            .map(str::to_string);

        entity_object
            .entry("display_name".to_string())
            .or_insert(serde_json::Value::Null);

        if current_display_name.is_none() {
            if let Some(prefab) = prefab_value {
                if prefab_value_looks_like_legacy_display_name(&prefab) {
                    entity_object.insert(
                        "display_name".to_string(),
                        serde_json::Value::String(prefab),
                    );
                    entity_object.insert("prefab".to_string(), serde_json::Value::Null);
                }
            }
        }
    }

    Ok(value)
}

fn prefab_value_looks_like_legacy_display_name(prefab_ref: &str) -> bool {
    let trimmed = prefab_ref.trim();
    if trimmed.is_empty() {
        return false;
    }

    trimmed.contains(char::is_whitespace)
        || trimmed.chars().any(|ch| ch.is_ascii_uppercase())
        || trimmed
            .chars()
            .any(|ch| !(ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '/' | '.')))
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

    write_text_atomically_with_retry(path, &json)
}

fn write_text_atomically_with_retry(path: &Path, contents: &str) -> Result<(), LoadError> {
    let mut last_error = None;
    for attempt in 1..=FILE_IO_RETRY_ATTEMPTS {
        match write_text_atomically_once(path, contents) {
            Ok(()) => return Ok(()),
            Err(e) => {
                let is_retriable = is_retriable_atomic_write_error(&e);
                last_error = Some(e);
                if attempt < FILE_IO_RETRY_ATTEMPTS && is_retriable {
                    thread::sleep(Duration::from_millis(FILE_IO_RETRY_DELAY_MS));
                    continue;
                }
                return Err(last_error.expect("atomic write error"));
            }
        }
    }
    last_error.map_or_else(
        || {
            Err(LoadError(
                "Falha desconhecida em write_text_atomically.".into(),
            ))
        },
        Err,
    )
}

fn is_retriable_atomic_write_error(error: &LoadError) -> bool {
    error.0.contains("os error 5")
        || error.0.contains("os error 32")
        || error.0.contains("Access is denied")
        || error.0.contains("Acesso negado")
        || error.0.contains("Sharing")
}

fn write_text_atomically_once(path: &Path, contents: &str) -> Result<(), LoadError> {
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
    const MOVEFILE_REPLACE_EXISTING: u32 = 0x0000_0001;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x0000_0008;

    unsafe extern "system" {
        fn ReplaceFileW(
            lp_replaced_file_name: *const u16,
            lp_replacement_file_name: *const u16,
            lp_backup_file_name: *const u16,
            dw_replace_flags: u32,
            lp_exclude: *mut core::ffi::c_void,
            lp_reserved: *mut core::ffi::c_void,
        ) -> Bool;
        fn MoveFileExW(
            lp_existing_file_name: *const u16,
            lp_new_file_name: *const u16,
            dw_flags: u32,
        ) -> Bool;
    }

    let destination_wide: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let temp_wide: Vec<u16> = temp_path.as_os_str().encode_wide().chain(Some(0)).collect();

    if destination.exists() {
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

        let replace_error = io::Error::last_os_error();
        let moved = unsafe {
            MoveFileExW(
                temp_wide.as_ptr(),
                destination_wide.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        };
        if moved != 0 {
            return Ok(());
        }

        let move_error = io::Error::last_os_error();
        let _ = fs::remove_file(temp_path);
        return Err(LoadError(format!(
            "Nao foi possivel substituir '{}': {}. Fallback MoveFileExW tambem falhou: {}",
            destination.display(),
            replace_error,
            move_error
        )));
    }

    let moved = unsafe {
        MoveFileExW(
            temp_wide.as_ptr(),
            destination_wide.as_ptr(),
            MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved != 0 {
        return Ok(());
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
    use crate::ugdm::components::AnimationDef;
    use crate::ugdm::entities::Transform;
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

    fn read_legacy_index(overlay_dir: &Path) -> LegacySgdkIndex {
        let raw = fs::read_to_string(overlay_dir.join("legacy_sgdk_index.json"))
            .expect("read legacy index");
        serde_json::from_str(&raw).expect("parse legacy index")
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

    fn write_test_png(path: &Path, width: u32, height: u32, rgba: [u8; 4]) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create png parent");
        }
        image::RgbaImage::from_pixel(width, height, image::Rgba(rgba))
            .save(path)
            .expect("write png");
    }

    fn write_godot_fixture(root: &Path) {
        fs::create_dir_all(root.join("art")).expect("create godot art dir");
        fs::create_dir_all(root.join("audio")).expect("create godot audio dir");
        write_test_png(&root.join("art").join("hero.png"), 24, 32, [96, 220, 180, 255]);
        fs::write(root.join("audio").join("jump.wav"), minimal_wav_bytes())
            .expect("write godot wav");
        fs::write(
            root.join("project.godot"),
            [
                "[application]",
                "config/name=\"Godot Fixture\"",
                "run/main_scene=\"res://main.tscn\"",
            ]
            .join("\n"),
        )
        .expect("write project.godot");
        fs::write(
            root.join("main.tscn"),
            [
                "[gd_scene load_steps=3 format=3]",
                "[ext_resource type=\"Texture2D\" path=\"res://art/hero.png\" id=\"1\"]",
                "[ext_resource type=\"AudioStream\" path=\"res://audio/jump.wav\" id=\"2\"]",
                "[node name=\"Main\" type=\"Node2D\"]",
                "[node name=\"Hero\" type=\"Sprite2D\" parent=\".\"]",
                "position = Vector2(24, 40)",
                "texture = ExtResource(\"1\")",
                "[node name=\"Camera\" type=\"Camera2D\" parent=\".\"]",
                "position = Vector2(8, 12)",
                "[node name=\"Jump\" type=\"AudioStreamPlayer2D\" parent=\".\"]",
                "stream = ExtResource(\"2\")",
                "[node name=\"LegacyAnim\" type=\"AnimatedSprite2D\" parent=\".\"]",
                "position = Vector2(0, 0)",
            ]
            .join("\n"),
        )
        .expect("write main.tscn");
    }

    fn write_mugen_character_fixture(root: &Path) {
        fs::create_dir_all(root.join("work").join("hero_sff").join("sd"))
            .expect("create mugen character work dir");
        fs::write(
            root.join("hero.def"),
            [
                "[Info]",
                "name = \"Hero MUGEN\"",
                "",
                "[Files]",
                "anim = hero.air",
                "sprite = hero.sff",
                "",
            ]
            .join("\n"),
        )
        .expect("write mugen character def");
        fs::write(
            root.join("hero.air"),
            [
                "[Begin Action 0]",
                "Clsn2Default: 1",
                "Clsn2[0] = -8, -16, 8, 0",
                "0, 0, 0, 0, 4",
                "Loopstart",
                "0, 0, 0, 0, 4",
            ]
            .join("\n"),
        )
        .expect("write mugen air");
        write_test_png(
            &root.join("work").join("hero_sff").join("sd").join("0-0.png"),
            32,
            48,
            [240, 120, 32, 255],
        );
    }

    fn write_mugen_stage_fixture(root: &Path) {
        fs::create_dir_all(root).expect("create mugen stage dir");
        fs::write(
            root.join("stage.def"),
            [
                "[Info]",
                "name = \"Downtown Stage\"",
                "",
                "[BGdef]",
                "spr = stage.sff",
                "",
                "[BG 0]",
                "type = normal",
                "spriteno = 0,0",
                "start = 12, 24",
                "",
                "[Music]",
                "bgmusic = theme.mp3",
            ]
            .join("\n"),
        )
        .expect("write mugen stage def");
        write_test_png(&root.join("stage.png"), 160, 96, [32, 96, 200, 255]);
        fs::write(root.join("theme.mp3"), b"fake-mp3").expect("write mugen stage music");
    }

    fn write_mugen_screenpack_fixture(root: &Path) {
        let data_root = root.join("data");
        fs::create_dir_all(data_root.join("work").join("system_sff").join("sd"))
            .expect("create mugen screenpack work dir");
        fs::write(
            data_root.join("system.def"),
            [
                "[Info]",
                "name = \"Retro Screenpack\"",
                "",
                "[Files]",
                "spr = system.sff",
                "",
                "[Music]",
                "title.bgm = title.mp3",
                "select.bgm = select.mp3",
                "",
                "[TitleBGdef]",
                "",
                "[TitleBG 0]",
                "type = normal",
                "spriteno = 0,0",
                "start = 0,0",
                "",
                "[SelectBGdef]",
                "",
                "[SelectBG 0]",
                "type = normal",
                "spriteno = 1,0",
                "start = 4,8",
            ]
            .join("\n"),
        )
        .expect("write mugen system.def");
        write_test_png(
            &data_root
                .join("work")
                .join("system_sff")
                .join("sd")
                .join("0-0.png"),
            128,
            64,
            [128, 40, 200, 255],
        );
        write_test_png(
            &data_root
                .join("work")
                .join("system_sff")
                .join("sd")
                .join("1-0.png"),
            128,
            64,
            [40, 180, 200, 255],
        );
        fs::write(data_root.join("title.mp3"), b"title-mp3").expect("write title bgm");
        fs::write(data_root.join("select.mp3"), b"select-mp3").expect("write select bgm");
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
                "platformer_gm",
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
    fn list_external_import_profiles_exposes_support_matrix() {
        let profiles = list_external_import_profiles();

        assert!(profiles.iter().any(|profile| {
            profile.id == "sgdk"
                && profile.importable
                && profile.support_status == "Experimental"
        }));
        assert!(profiles.iter().any(|profile| {
            profile.id == "mugen"
                && profile.importable
                && profile.source_engine == "mugen"
        }));
        assert!(profiles.iter().any(|profile| {
            profile.id == "ikemen_go"
                && profile.importable
                && profile.source_engine == "ikemen_go"
        }));
        assert!(profiles.iter().any(|profile| {
            profile.id == "godot"
                && profile.importable
                && profile.supported_levels == vec!["L1", "L2", "L3"]
        }));
        assert!(profiles.iter().any(|profile| {
            profile.id == "gamemaker"
                && !profile.importable
                && profile.support_status == "Parcial"
        }));
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
                display_name: None,
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
            layers: None,
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
                display_name: None,
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
            layers: None,
        };
        let resolved_scene = Scene {
            entities: vec![Entity {
                entity_id: "player".to_string(),
                display_name: None,
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
    fn import_mugen_project_builds_native_scenes_from_character_stage_and_screenpack_roots() {
        let donor_root = temp_dir("mugen-import-root");
        let project_dir = temp_dir("mugen-import-project");
        create_project_skeleton(&project_dir, "Imported MUGEN", "megadrive")
            .expect("create project skeleton");

        write_mugen_character_fixture(&donor_root.join("Hero"));
        write_mugen_stage_fixture(&donor_root.join("Downtown"));
        write_mugen_screenpack_fixture(&donor_root.join("Retro"));

        let report = import_mugen_project(&project_dir, &donor_root).expect("import mugen project");
        let scenes = list_scenes(&project_dir).expect("list imported scenes");

        assert_eq!(report.imported_scenes, 4);
        assert!(report.skipped_sources.is_empty());
        assert_eq!(scenes.len(), 4);

        let loaded_scenes = scenes
            .iter()
            .map(|scene| load_scene(&project_dir, &scene.path).expect("load imported scene"))
            .collect::<Vec<_>>();

        let character_scene = loaded_scenes
            .iter()
            .find(|scene| scene.display_name.as_deref() == Some("Hero MUGEN"))
            .expect("character scene");
        let character = character_scene
            .entities
            .iter()
            .find(|entity| entity.entity_id == "heromugen")
            .expect("hero entity");
        assert!(character
            .components
            .sprite
            .as_ref()
            .is_some_and(|sprite| sprite.asset.ends_with("mugen_heromugen_atlas.png")));
        assert!(character
            .components
            .logic
            .as_ref()
            .and_then(|logic| logic.graph.as_deref())
            .is_some_and(|graph| graph.contains("\"sprite_anim\"")));
        assert!(character
            .components
            .collision
            .as_ref()
            .is_some_and(|collision| collision.layer.as_deref() == Some("player")));

        let stage_scene = loaded_scenes
            .iter()
            .find(|scene| scene.display_name.as_deref() == Some("Downtown Stage"))
            .expect("stage scene");
        assert!(stage_scene.entities.iter().any(|entity| entity
            .components
            .sprite
            .as_ref()
            .is_some_and(|sprite| sprite.asset.ends_with("downtownstage_bg.png"))));
        assert!(stage_scene.entities.iter().any(|entity| entity
            .components
            .audio
            .as_ref()
            .is_some_and(|audio| audio.bgm.as_deref() == Some("assets/audio/downtownstage_bgm.mp3"))));

        let title_scene = loaded_scenes
            .iter()
            .find(|scene| scene.display_name.as_deref() == Some("Retro Screenpack Title"))
            .expect("title scene");
        assert!(title_scene.entities.iter().any(|entity| entity
            .components
            .sprite
            .as_ref()
            .is_some_and(|sprite| sprite.asset.contains("_title_"))));

        let select_scene = loaded_scenes
            .iter()
            .find(|scene| scene.display_name.as_deref() == Some("Retro Screenpack Select"))
            .expect("select scene");
        assert!(select_scene.entities.iter().any(|entity| entity
            .components
            .sprite
            .as_ref()
            .is_some_and(|sprite| sprite.asset.contains("_select_"))));

        let _ = fs::remove_dir_all(project_dir);
        let _ = fs::remove_dir_all(donor_root);
    }

    #[test]
    fn import_godot_project_creates_native_scene_with_sprite_audio_camera_and_skips() {
        let donor_root = temp_dir("godot-import-root");
        let project_dir = temp_dir("godot-import-project");
        create_project_skeleton(&project_dir, "Imported Godot", "megadrive")
            .expect("create project skeleton");
        write_godot_fixture(&donor_root);

        let report = import_godot_project(&project_dir, &donor_root).expect("import godot project");
        let scene = load_scene(&project_dir, DEFAULT_ENTRY_SCENE).expect("load imported godot scene");

        assert_eq!(report.imported_scenes, 1);
        assert!(report
            .skipped_sources
            .iter()
            .any(|entry| entry.contains("AnimatedSprite2D")));
        assert!(scene.entities.iter().any(|entity| {
            entity
                .components
                .sprite
                .as_ref()
                .is_some_and(|sprite| sprite.asset == "assets/sprites/godot_art_hero.png")
        }));
        assert!(scene.entities.iter().any(|entity| {
            entity
                .components
                .audio
                .as_ref()
                .is_some_and(|audio| {
                    audio
                        .sfx
                        .values()
                        .any(|asset| asset == "assets/audio/godot_audio_jump.wav")
                })
        }));
        assert!(scene.entities.iter().any(|entity| {
            entity.components.camera.as_ref().is_some_and(|camera| {
                camera
                    .follow_entity
                    .as_deref()
                    .is_some_and(|target| target == "hero")
            })
        }));
        assert!(project_dir
            .join("assets")
            .join("sprites")
            .join("godot_art_hero.png")
            .is_file());
        assert!(project_dir
            .join("assets")
            .join("audio")
            .join("godot_audio_jump.wav")
            .is_file());

        let project = stamp_imported_external_profile_metadata(&project_dir, "godot", &donor_root)
            .expect("stamp godot metadata");
        let metadata = project.template_metadata.expect("template metadata");
        assert_eq!(metadata.source_kind, "imported_godot");
        assert_eq!(metadata.source_engine.as_deref(), Some("godot"));
        assert_eq!(metadata.import_profile.as_deref(), Some("godot_tscn_v1"));

        let _ = fs::remove_dir_all(project_dir);
        let _ = fs::remove_dir_all(donor_root);
    }

    #[test]
    #[ignore = "host-local validation against repo sample roots"]
    fn import_mugen_project_supports_repo_sample_roots_when_present() {
        let repo_root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("workspace root")
            .to_path_buf();
        let sample_roots = [
            repo_root.join("data").join("character air"),
            repo_root.join("data").join("background air"),
            repo_root.join("data").join("screenpack air"),
        ];

        for sample_root in sample_roots {
            if !sample_root.is_dir() {
                eprintln!("[mugen-sample-skip] {}", sample_root.display());
                continue;
            }

            let project_dir = temp_dir("mugen-sample-project");
            create_project_skeleton(&project_dir, "Repo Sample MUGEN", "megadrive")
                .expect("create sample project skeleton");

            let report =
                import_mugen_project(&project_dir, &sample_root).expect("import repo sample root");
            assert!(report.imported_scenes > 0, "{}", sample_root.display());

            let _ = fs::remove_dir_all(project_dir);
        }
    }

    #[test]
    fn import_legacy_sgdk_project_creates_overlay_for_main_c_only_workspace() {
        let legacy_dir = temp_dir("legacy-overlay-main-c");
        fs::create_dir_all(legacy_dir.join("src")).expect("create legacy src");
        fs::create_dir_all(legacy_dir.join("inc")).expect("create legacy inc");
        fs::write(
            legacy_dir.join("src").join("main.c"),
            b"int main(void){return 0;}",
        )
        .expect("write legacy main.c");
        fs::write(legacy_dir.join("inc").join("game.h"), b"void game(void);")
            .expect("write legacy header");

        let overlay_dir = import_legacy_sgdk_project(&legacy_dir, Some("Legacy Wrapper"))
            .expect("wrap legacy project");
        println!("[legacy-main-c] overlay={}", overlay_dir.display());

        let project = load_project(&overlay_dir).expect("load overlay project");
        let scene = load_scene(&overlay_dir, DEFAULT_ENTRY_SCENE).expect("load overlay scene");
        let index = read_legacy_index(&overlay_dir);

        assert_eq!(project.name, "Legacy Wrapper");
        assert_eq!(
            project
                .template_metadata
                .as_ref()
                .map(|metadata| metadata.source_kind.as_str()),
            Some("external_sgdk")
        );
        assert!(overlay_dir.join("project.rds").is_file());
        assert!(legacy_dir.join("src").join("main.c").is_file());
        assert!(scene.entities.is_empty());
        assert!(index.source_files.iter().any(|path| path == "src/main.c"));
        assert!(index.header_files.iter().any(|path| path == "inc/game.h"));

        let _ = fs::remove_dir_all(legacy_dir);
    }

    #[test]
    fn import_legacy_sgdk_project_materializes_assets_and_writes_index() {
        let legacy_dir = temp_dir("legacy-overlay-full");
        write_generic_sgdk_donor_fixture(&legacy_dir);

        let overlay_dir =
            import_legacy_sgdk_project(&legacy_dir, None).expect("wrap populated legacy project");
        println!("[legacy-full] overlay={}", overlay_dir.display());

        let project = load_project(&overlay_dir).expect("load overlay project");
        let scene = load_scene(&overlay_dir, DEFAULT_ENTRY_SCENE).expect("load overlay scene");
        let index = read_legacy_index(&overlay_dir);

        assert_eq!(
            project
                .template_metadata
                .as_ref()
                .map(|metadata| metadata.template_id.as_str()),
            Some("legacy_sgdk_overlay")
        );
        assert!(overlay_dir
            .join("assets")
            .join("sprites")
            .join("hero.png")
            .is_file());
        assert!(overlay_dir
            .join("assets")
            .join("tilesets")
            .join("stage.png")
            .is_file());
        assert!(overlay_dir
            .join("assets")
            .join("audio")
            .join("jump.wav")
            .is_file());
        assert!(scene
            .entities
            .iter()
            .any(|entity| entity.entity_id == "hero"));
        assert!(scene
            .entities
            .iter()
            .any(|entity| entity.entity_id == "main_camera"));
        assert!(index
            .manifest_files
            .iter()
            .any(|path| path == "res/resources.res"));
        assert!(index.output_files.iter().any(|path| path == "out/rom.bin"));
        assert!(index.source_files.iter().any(|path| path == "src/main.c"));

        let _ = fs::remove_dir_all(legacy_dir);
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
    fn migration_chain_upgrades_scene_schema_1_5_0_to_1_6_0_and_promotes_legacy_display_name() {
        let project_dir = temp_dir("migration-1-5-0-to-1-6-0");
        fs::create_dir_all(project_dir.join("scenes")).expect("create scenes dir");

        let scene_v1_5 = serde_json::json!({
            "scene_id": DEFAULT_SCENE_ID,
            "schema_version": "1.5.0",
            "display_name": "Main Scene",
            "background_layers": [],
            "entities": [
                {
                    "entity_id": "boss",
                    "prefab": "Hero Boss",
                    "transform": { "x": 32, "y": 48 },
                    "components": {}
                },
                {
                    "entity_id": "player",
                    "prefab": "platformer_player.json",
                    "transform": { "x": 48, "y": 120 },
                    "components": {}
                }
            ],
            "palettes": [],
            "collision_map": null,
            "layers": null
        });

        fs::write(
            project_dir.join("scenes").join("main.json"),
            scene_v1_5.to_string(),
        )
        .expect("write scene");

        let scene = load_scene(&project_dir, "scenes/main.json").expect("load migrated scene");

        assert_eq!(
            scene.schema_version.as_deref(),
            Some(CURRENT_SCHEMA_VERSION)
        );
        assert_eq!(scene.entities[0].display_name.as_deref(), Some("Hero Boss"));
        assert!(scene.entities[0].prefab.is_none());
        assert_eq!(
            scene.entities[1].display_name.as_deref(),
            None,
            "valid prefab refs should keep display_name empty by default"
        );
        assert_eq!(
            scene.entities[1].prefab.as_deref(),
            Some("platformer_player.json")
        );

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
            display_name: Some("Player".to_string()),
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
            layers: None,
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
    fn save_and_load_scene_preserves_sprite_animation_payload() {
        let project_dir = temp_dir("sprite-animations");
        let project = create_project_skeleton(&project_dir, "Sprite Anim Save", "megadrive")
            .expect("create canonical project");
        let mut scene = canonical_scene(DEFAULT_SCENE_ID, Some("Main Scene".to_string()));
        scene.entities.push(Entity {
            entity_id: "hero".to_string(),
            display_name: Some("Hero".to_string()),
            prefab: None,
            transform: Transform { x: 32, y: 48 },
            components: Components {
                sprite: Some(SpriteComponent {
                    asset: "assets/sprites/hero.png".to_string(),
                    frame_width: 16,
                    frame_height: 16,
                    pivot: None,
                    palette_slot: 0,
                    animations: HashMap::from([
                        (
                            "idle".to_string(),
                            AnimationDef {
                                frames: vec![0],
                                fps: 6,
                                looping: true,
                                frame_durations: None,
                                loop_start: None,
                                mugen_frames: None,
                            },
                        ),
                        (
                            "run".to_string(),
                            AnimationDef {
                                frames: vec![1, 2, 3],
                                fps: 12,
                                looping: true,
                                frame_durations: None,
                                loop_start: None,
                                mugen_frames: None,
                            },
                        ),
                    ]),
                    priority: "foreground".to_string(),
                    meta_sprite: false,
                }),
                ..Components::default()
            },
        });

        save_scene(&project_dir, &project.entry_scene, &scene).expect("save animated scene");
        let reloaded =
            load_scene(&project_dir, &project.entry_scene).expect("reload animated scene");

        let sprite = reloaded
            .entities
            .iter()
            .find(|entity| entity.entity_id == "hero")
            .and_then(|entity| entity.components.sprite.as_ref())
            .expect("reloaded sprite");
        assert_eq!(sprite.frame_width, 16);
        assert_eq!(sprite.frame_height, 16);
        assert_eq!(
            sprite.animations.get("idle"),
            Some(&AnimationDef {
                frames: vec![0],
                fps: 6,
                looping: true,
                frame_durations: None,
                loop_start: None,
                mugen_frames: None,
            })
        );
        assert_eq!(
            sprite.animations.get("run"),
            Some(&AnimationDef {
                frames: vec![1, 2, 3],
                fps: 12,
                looping: true,
                frame_durations: None,
                loop_start: None,
                mugen_frames: None,
            })
        );

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
        create_project_skeleton(&dir, "Root Project", "megadrive").expect("create skeleton");

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
        create_project_skeleton(&sub, "Sub Project", "snes").expect("create skeleton in subdir");

        let found = discover_project_rds(&dir).expect("should find in subdir");
        assert_eq!(found, sub);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn discover_project_rds_root_has_priority() {
        let dir = temp_dir("discover-prio");
        create_project_skeleton(&dir, "Root Wins", "megadrive").expect("create root skeleton");
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
        create_project_skeleton(&other_dir, "Other", "megadrive").expect("create other skeleton");

        let found = discover_project_rds(&dir).expect("should find rds/ first");
        assert_eq!(found, rds_dir);

        let _ = fs::remove_dir_all(&dir);
    }
}
