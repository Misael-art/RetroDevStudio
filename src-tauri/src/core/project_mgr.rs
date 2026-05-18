use std::cmp::Ordering;
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Component, Path, PathBuf};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use image::{ImageBuffer, Rgba, RgbaImage};

use crate::ugdm::components::{
    AnimationDef, AudioComponent, CameraComponent, CollisionComponent, CollisionOffset, Components,
    ImportedLogicSemantics, InputComponent, LogicComponent, MugenAnimationFrame, MugenCollisionBox,
    PhysicsComponent, Pivot, SpriteComponent, TilemapComponent, Velocity,
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
const MANUAL_SGDK_DONOR_REQUIRED_MESSAGE: &str =
    "Requer uma pasta doadora SGDK escolhida manualmente neste host.";

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

/// Fonte descartada durante o import SGDK com motivo rastreavel.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct SgdkSkippedSource {
    /// Descricao legivel da origem (ex.: `VGM forbidden`).
    pub source: String,
    /// Classe canonica do skip: `UnsupportedKind`, `MissingAsset`, `ForbiddenFormat`.
    pub reason: String,
    /// Mensagem humana adicional.
    pub detail: String,
}

/// Mapeamento explicito entre recurso SGDK e asset canonico emitido.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct SgdkImportMapping {
    pub resource_kind: String,
    pub resource_name: String,
    pub source_relative: String,
    pub destination: String,
}

/// Sumario das origens do doador SGDK consumidas nesta importacao.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default, PartialEq, Eq)]
pub struct SgdkSourceSummary {
    /// Caminho solicitado pelo utilizador/wizard para o donor SGDK.
    pub donor_root: String,
    /// Caminho efetivo usado para ler manifests/assets apos resolver wrappers `.mddev`.
    pub effective_root: String,
    /// `direct` | `mddev_sgdk_root` | `mddev_reference_redirect`.
    pub resolution_kind: String,
    pub resolution_warnings: Vec<String>,
    pub resolution_suggestions: Vec<String>,
    pub manifests: Vec<String>,
    pub resources_total: usize,
    pub resources_accepted: usize,
    pub resources_skipped: usize,
    pub fingerprint: String,
}

/// Cena extra derivada do doador SGDK alem da primaria.
///
/// A Fase B separa por tilemap anchor: cada `IMAGE`/`TILESET`/`MAP`/`TILEMAP`
/// extra alem do primeiro vira sua propria cena canonica sob `scenes/<slug>.json`.
#[derive(Debug, Clone)]
pub struct SgdkImportedSceneDescriptor {
    pub scene_id: String,
    pub display_name: String,
    pub scene_path: String,
    pub entity_count: usize,
    pub tilemap_cells: usize,
    pub tilemap_unique_tiles: u32,
}

/// Relatorio rico do importador SGDK.
///
/// Expoe paridade com `ExternalImportReport`/`MugenImportReport` e adiciona
/// fallbacks explicitos e sumario do doador para rastreabilidade completa.
#[derive(Debug, Clone)]
pub struct SgdkImportReport {
    pub primary_scene: Scene,
    pub imported_scenes: usize,
    pub skipped_sources: Vec<SgdkSkippedSource>,
    pub warnings: Vec<String>,
    pub fallbacks: Vec<String>,
    pub source_summary: SgdkSourceSummary,
    /// Caminho relativo do ledger `.rds/imports/sgdk/*.json` escrito.
    pub manifest_path: Option<String>,
    /// Caminho relativo da cena primaria no projeto (sempre populado).
    pub primary_scene_path: String,
    /// Cenas adicionais criadas quando o doador possui multiplos tilemap anchors.
    pub additional_scenes: Vec<SgdkImportedSceneDescriptor>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
struct SgdkImportLedgerHistoryEntry {
    timestamp_unix: u64,
    fingerprint: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq, Default)]
struct SgdkImportLedgerScene {
    scene_id: String,
    display_name: String,
    scene_path: String,
    role: String,
    entity_count: usize,
    tilemap_cells: usize,
    tilemap_unique_tiles: u32,
}

/// Auditoria Fase C (animacoes + collision_map) persistida no ledger `sgdk-import/v4+` (campo `phase_c`).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq, Default)]
struct SgdkImportLedgerPhaseC {
    /// Ex.: `nonzero_tile_index` quando collision_map foi derivado do tilemap canonico.
    #[serde(default)]
    collision_derivation_rule: Option<String>,
    #[serde(default)]
    primary_collision_solid_cells: Option<u64>,
    #[serde(default)]
    primary_sprite_animation_rows: Option<u32>,
    #[serde(default)]
    primary_sprite_animation_names: Vec<String>,
}

/// Auditoria Fase D (padroes main.c + ficheiros de grafo por sprite).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq, Default)]
struct SgdkImportLedgerPhaseD {
    /// Grupos de tokens observados no scan textual agregado (legacy: iniciado em `src/main.c`).
    #[serde(default)]
    detected_main_c_token_groups: Vec<String>,
    /// Ficheiros C/H do doador efetivamente lidos no scan controlado (paths relativos ao root SGDK).
    #[serde(default)]
    donor_logic_scanned_paths: Vec<String>,
    /// `graph_ref` persistidos (paths `graphs/sgdk_import_<entity>.json`).
    #[serde(default)]
    logic_graph_refs: Vec<String>,
    /// Heuristica de classe de gameplay quando sinais sao combinados (nao e certificacao).
    #[serde(default)]
    heuristic_gameplay_class: Option<String>,
    /// Chamadas `func(` observadas num TU cujo corpo/prototipo foi noutro ficheiro escaneado (heuristica).
    #[serde(default)]
    cross_unit_function_refs: Vec<String>,
    /// Sprites com linha SPR_* no mesmo texto que o identificador do recurso (`entity_id@rel`).
    #[serde(default)]
    entity_spr_local_signal_hits: Vec<String>,
    /// Familias de playback de audio detectadas no scan textual (`audio_xgm`, `audio_snd_xgm`,
    /// `audio_snd_pcm`, `audio_psg`). Heuristica textual, nao substitui analise semantica.
    #[serde(default)]
    detected_audio_apis: Vec<String>,
    #[serde(default)]
    entity_trace: Vec<SgdkImportLedgerPhaseDEntityTrace>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq, Default)]
struct SgdkSourceEvidence {
    rel_path: String,
    line: usize,
    kind: String,
    subject: String,
    snippet: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq, Default)]
struct SgdkImportLedgerPhaseDEntityTrace {
    entity_id: String,
    graph_ref: String,
    #[serde(default)]
    source_refs: Vec<SgdkSourceEvidence>,
    confidence: String,
    applied_class: String,
    #[serde(default)]
    entity_role: String,
    #[serde(default)]
    role_reason: String,
    #[serde(default)]
    driver_functions: Vec<String>,
    #[serde(default)]
    source_paths: Vec<String>,
    #[serde(default)]
    rules_hit: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
struct SgdkImportLedger {
    schema_version: String,
    scene_id: String,
    donor_root: String,
    #[serde(default)]
    effective_root: String,
    #[serde(default)]
    resolution_kind: String,
    donor_basename: String,
    fingerprint: String,
    last_imported_at_unix: u64,
    manifests: Vec<String>,
    mappings: Vec<SgdkImportMapping>,
    skipped_sources: Vec<SgdkSkippedSource>,
    warnings: Vec<String>,
    fallbacks: Vec<String>,
    history: Vec<SgdkImportLedgerHistoryEntry>,
    #[serde(default)]
    scenes: Vec<SgdkImportLedgerScene>,
    #[serde(default)]
    phase_c: SgdkImportLedgerPhaseC,
    #[serde(default)]
    phase_d: SgdkImportLedgerPhaseD,
}

const SGDK_IMPORT_LEDGER_SCHEMA: &str = "sgdk-import/v4";
const SGDK_IMPORT_LEDGER_DIR: &str = ".rds/imports/sgdk";

#[derive(Debug, Clone, PartialEq, Eq)]
struct SgdkResolvedImportRoot {
    requested_root: PathBuf,
    effective_root: PathBuf,
    resolution_kind: String,
    warnings: Vec<String>,
    suggestions: Vec<String>,
}

#[derive(Debug, Clone, serde::Deserialize, Default)]
struct MddevProjectMeta {
    #[serde(default)]
    sgdk_root: Option<String>,
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    build_policy: Option<String>,
    #[serde(default)]
    notes: Option<String>,
}

/// `graph_ref` estável por entidade: um ficheiro JSON por `entity_id` (slug SGDK).
fn sgdk_import_sprite_logic_graph_ref(entity_id: &str) -> String {
    format!("graphs/sgdk_import_{}.json", entity_id.trim())
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

#[derive(Debug, Clone)]
struct ConstructObjectType {
    name: String,
    plugin_id: String,
    display_asset: Option<PathBuf>,
    audio_assets: Vec<PathBuf>,
}

#[derive(Debug, Clone)]
struct ConstructLayoutInstance {
    object_name: String,
    x: i32,
    y: i32,
}

#[derive(Debug, Clone)]
struct RpgMakerEventCommand {
    code: i32,
    parameters: Vec<serde_json::Value>,
}

#[derive(Debug, Clone)]
struct OpenBorModelAsset {
    name: String,
    display_asset: Option<PathBuf>,
    audio_assets: Vec<PathBuf>,
    logic_hints: Vec<String>,
}

#[derive(Debug, Clone)]
struct OpenBorLevelAsset {
    name: String,
    background_asset: Option<PathBuf>,
    music_asset: Option<PathBuf>,
    logic_hints: Vec<String>,
}

struct ImportedSpriteEntitySpec {
    entity_id: String,
    display_name: String,
    asset: String,
    source_path: PathBuf,
    x: i32,
    y: i32,
    input: Option<InputComponent>,
    physics: Option<PhysicsComponent>,
    logic_hints: Vec<String>,
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
        description: "Importa layouts, sprites, tile backgrounds e audio de projetos em pasta, preservando event sheets como hints explicitos.",
        source_engine: "construct",
        support_status: "Experimental",
        supported_levels: &["L1", "L2", "L3"],
        recommended_target: "megadrive",
        experimental: true,
        importable: true,
        mega_drive_only: true,
    },
    ExternalImportProfileDefinition {
        id: "rpg_maker",
        name: "RPG Maker",
        family: "Data-driven RPG",
        description: "Importa mapas, tilesets, audio e eventos baseados em JSON, preservando comandos como hints.",
        source_engine: "rpg_maker",
        support_status: "Experimental",
        supported_levels: &["L1", "L2", "L3"],
        recommended_target: "megadrive",
        experimental: true,
        importable: true,
        mega_drive_only: true,
    },
    ExternalImportProfileDefinition {
        id: "openbor",
        name: "OpenBOR",
        family: "Beat'em up",
        description: "Importa modelos, estagios e audio de modulos OpenBOR com hints explicitos de logica.",
        source_engine: "openbor",
        support_status: "Experimental",
        supported_levels: &["L1", "L2", "L3"],
        recommended_target: "megadrive",
        experimental: true,
        importable: true,
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
        _ => import_sgdk_project(project_dir, &donor).map(|report| report.primary_scene),
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

/// Resultado da extracao de celulas a partir de um PNG de tileset/mapa SGDK.
///
/// Reconstroi `cells[]` canonico via deduplicacao 8x8:
/// - cada tile 8x8 vira uma entrada do dicionario
/// - tiles totalmente transparentes viram `0` (vazio) em `cells[]`
/// - demais tiles recebem indice 1-based dentro do dicionario
///
/// Esse caminho cobre o caso mais comum em SGDK: o "map" e uma PNG monolitica onde a
/// colocacao ja esta embutida (um grande "background bake"). Para projetos com .tmx
/// dedicado ou `.map` binario, a reconstrucao fica como fallback explicito no report.
struct ExtractedSgdkTilemap {
    map_width: u32,
    map_height: u32,
    cells: Vec<u32>,
    unique_tiles: u32,
}

fn extract_sgdk_tilemap_cells(source_path: &Path) -> Option<ExtractedSgdkTilemap> {
    let img = image::open(source_path).ok()?;
    let rgba = img.to_rgba8();
    let w = rgba.width();
    let h = rgba.height();
    if w < 8 || h < 8 || w % 8 != 0 || h % 8 != 0 {
        return None;
    }
    let tiles_x = w / 8;
    let tiles_y = h / 8;
    // Reconstrucao so agrega valor se houver mais de um tile no eixo maior.
    if tiles_x == 0 || tiles_y == 0 || (tiles_x == 1 && tiles_y == 1) {
        return None;
    }

    let row_stride = (w as usize) * 4;
    let pixels = rgba.as_raw();
    let mut dict: HashMap<[u8; 256], u32> = HashMap::new();
    let mut cells: Vec<u32> = Vec::with_capacity((tiles_x * tiles_y) as usize);
    let mut next_index: u32 = 1;

    for ty in 0..tiles_y {
        for tx in 0..tiles_x {
            let mut tile_bytes = [0u8; 256]; // 8x8 pixels * 4 bytes RGBA
            for py in 0..8u32 {
                let src_y = (ty * 8 + py) as usize;
                let src_x = (tx * 8) as usize;
                let src_offset = src_y * row_stride + src_x * 4;
                let dst_offset = (py as usize) * 32;
                tile_bytes[dst_offset..dst_offset + 32]
                    .copy_from_slice(&pixels[src_offset..src_offset + 32]);
            }
            let fully_transparent = tile_bytes.chunks_exact(4).all(|px| px[3] == 0);
            if fully_transparent {
                cells.push(0);
                continue;
            }
            let idx = *dict.entry(tile_bytes).or_insert_with(|| {
                let current = next_index;
                next_index = next_index.saturating_add(1);
                current
            });
            cells.push(idx);
        }
    }

    if cells.iter().all(|cell| *cell == 0) {
        // PNG totalmente transparente: reconstrucao nao adiciona sinal util.
        return None;
    }

    Some(ExtractedSgdkTilemap {
        map_width: tiles_x,
        map_height: tiles_y,
        cells,
        unique_tiles: dict.len() as u32,
    })
}

/// Resultado da Fase C para um recurso SPRITE (dimensoes de quadro + animacoes).
struct SgdkSpriteSheetDerived {
    frame_width: u32,
    frame_height: u32,
    animations: HashMap<String, AnimationDef>,
    notes: Vec<String>,
}

/// Leitura leve dos ficheiros C/H do doador para a Fase D (sem parser C completo).
#[derive(Debug, Clone, Default)]
struct SgdkDonorLogicScan {
    joy_read_detected: bool,
    map_scroll_h_detected: bool,
    map_scroll_v_detected: bool,
    busy_loop_detected: bool,
    vblank_sync_detected: bool,
    spr_engine_detected: bool,
    /// Chamadas de playback XGM (`XGM_startPlay`/`XGM_setLoopNumber`/`XGM2_startPlay`).
    audio_xgm_detected: bool,
    /// Chamadas de playback PCM via SND_* (`SND_startPlay_PCM`/`SND_PCM_startPlay`/`SND_startPlay_4PCM`).
    audio_snd_pcm_detected: bool,
    /// Chamadas de bridge SND para XGM (`SND_startPlay_XGM`/`SND_PAL_startPlay_XGM`).
    audio_snd_xgm_detected: bool,
    /// Chamadas diretas ao gerador PSG (`PSG_setEnvelope`/`PSG_setFrequency`).
    audio_psg_detected: bool,
    /// Paths relativos ao root do doador (ex.: `src/main.c`, `src/player_control.c`).
    donor_logic_scanned_paths: Vec<String>,
    /// Texto fonte por path relativo (apenas ficheiros efetivamente visitados pelo scan).
    source_text_by_rel: HashMap<String, String>,
    function_symbols: Vec<SgdkCLiteFunctionSymbol>,
    function_calls: Vec<SgdkCLiteFunctionCall>,
    source_evidence: Vec<SgdkSourceEvidence>,
    cross_unit_function_refs: Vec<String>,
}

#[derive(Debug, Clone, Default)]
struct SgdkCLiteFunctionSymbol {
    name: String,
    rel_path: String,
    start_line: usize,
    end_line: usize,
    is_prototype: bool,
}

#[derive(Debug, Clone, Default)]
struct SgdkCLiteFunctionCall {
    caller: Option<String>,
    callee: String,
    rel_path: String,
    line: usize,
    snippet: String,
}

impl SgdkDonorLogicScan {
    fn map_scroll_any(&self) -> bool {
        self.map_scroll_h_detected || self.map_scroll_v_detected
    }

    fn ledger_token_groups(&self) -> Vec<String> {
        let mut v = Vec::new();
        if self.joy_read_detected {
            v.push("joy_read".to_string());
        }
        if self.map_scroll_h_detected {
            v.push("map_scroll_h".to_string());
        }
        if self.map_scroll_v_detected {
            v.push("map_scroll_v".to_string());
        }
        if self.busy_loop_detected {
            v.push("busy_loop".to_string());
        }
        if self.vblank_sync_detected {
            v.push("vblank_sync".to_string());
        }
        if self.spr_engine_detected {
            v.push("spr_engine".to_string());
        }
        for family in self.detected_audio_apis() {
            v.push(family);
        }
        v
    }

    /// Familias de audio materializadas no scan textual (ordenadas, deduplicadas).
    /// Usado tanto em `ledger_token_groups` como em `phase_d.detected_audio_apis`.
    fn detected_audio_apis(&self) -> Vec<String> {
        let mut v = Vec::new();
        if self.audio_xgm_detected {
            v.push("audio_xgm".to_string());
        }
        if self.audio_snd_xgm_detected {
            v.push("audio_snd_xgm".to_string());
        }
        if self.audio_snd_pcm_detected {
            v.push("audio_snd_pcm".to_string());
        }
        if self.audio_psg_detected {
            v.push("audio_psg".to_string());
        }
        v
    }

    /// Existe qualquer sinal textual de playback de audio no agregado do doador?
    fn audio_playback_any(&self) -> bool {
        self.audio_xgm_detected
            || self.audio_snd_xgm_detected
            || self.audio_snd_pcm_detected
            || self.audio_psg_detected
    }

    fn register_function_symbol(&mut self, symbol: SgdkCLiteFunctionSymbol, snippet: &str) {
        self.source_evidence.push(SgdkSourceEvidence {
            rel_path: symbol.rel_path.clone(),
            line: symbol.start_line,
            kind: "function_def".to_string(),
            subject: symbol.name.clone(),
            snippet: normalize_source_snippet(snippet),
        });
        self.function_symbols.push(symbol);
    }

    fn register_callsite(&mut self, call: SgdkCLiteFunctionCall) {
        if call.callee == "JOY_readJoypad" || call.callee == "JOY_read" {
            self.joy_read_detected = true;
        }
        if call.callee == "MAP_scrollH" {
            self.map_scroll_h_detected = true;
        }
        if call.callee == "MAP_scrollV" {
            self.map_scroll_v_detected = true;
        }
        if call.callee == "SYS_doVBlankProcess"
            || call.callee == "VDP_waitVSync"
            || call.callee == "VDP_waitDMACompletion"
        {
            self.vblank_sync_detected = true;
        }
        if call.callee == "SPR_addSprite"
            || call.callee == "SPR_setPosition"
            || call.callee == "SPR_update"
            || call.callee == "SPR_init"
        {
            self.spr_engine_detected = true;
        }
        if call.callee.starts_with("XGM_") || call.callee.starts_with("XGM2_") {
            self.audio_xgm_detected = true;
        }
        if call.callee == "SND_startPlay_XGM"
            || call.callee == "SND_PAL_startPlay_XGM"
            || call.callee == "SND_NTSC_startPlay_XGM"
        {
            self.audio_snd_xgm_detected = true;
        }
        if call.callee == "SND_startPlay_PCM"
            || call.callee == "SND_PCM_startPlay"
            || call.callee == "SND_startPlay_4PCM"
            || call.callee == "SND_startPlay_2ADPCM"
        {
            self.audio_snd_pcm_detected = true;
        }
        if call.callee.starts_with("PSG_") {
            self.audio_psg_detected = true;
        }
        let is_sgdk_api = looks_like_sgdk_macro_api_identifier(&call.callee)
            || call.callee.starts_with("XGM_")
            || call.callee.starts_with("XGM2_")
            || call.callee.starts_with("SND_")
            || call.callee.starts_with("PSG_");
        self.source_evidence.push(SgdkSourceEvidence {
            rel_path: call.rel_path.clone(),
            line: call.line,
            kind: if is_sgdk_api {
                "sgdk_api_call".to_string()
            } else {
                "function_call".to_string()
            },
            subject: call.callee.clone(),
            snippet: normalize_source_snippet(&call.snippet),
        });
        self.function_calls.push(call);
    }

    /// Heuristica agregada em todos os ficheiros visitados (ordem: casos mais especificos primeiro).
    fn heuristic_gameplay_class(&self) -> Option<String> {
        if self.joy_read_detected
            && self.spr_engine_detected
            && self.map_scroll_any()
            && self.close_range_combat_signal_detected()
        {
            return Some("hybrid_action_scroll_signals".to_string());
        }
        if self.map_scroll_v_detected && self.joy_read_detected && self.spr_engine_detected {
            return Some("shmup_vertical_signals".to_string());
        }
        if self.joy_read_detected && self.spr_engine_detected && self.map_scroll_h_detected {
            return Some("run_and_gun_horizontal_signals".to_string());
        }
        if self.joy_read_detected
            && self.spr_engine_detected
            && !self.map_scroll_any()
            && self.close_range_combat_signal_detected()
        {
            return Some("beat_em_up_close_range_signals".to_string());
        }
        if self.map_scroll_v_detected && !self.map_scroll_h_detected && !self.joy_read_detected {
            return Some("vertical_scroller_signals".to_string());
        }
        if self.joy_read_detected && self.map_scroll_h_detected {
            return Some("platformer_horizontal_scroller_signals".to_string());
        }
        None
    }

    fn primary_graph_materialization_class(&self) -> Option<&'static str> {
        match self.heuristic_gameplay_class().as_deref() {
            Some("hybrid_action_scroll_signals") => Some("hybrid_action_scroll_signals"),
            Some("shmup_vertical_signals") => Some("shmup_vertical_signals"),
            Some("run_and_gun_horizontal_signals") => Some("run_and_gun_horizontal_signals"),
            Some("beat_em_up_close_range_signals") => Some("beat_em_up_close_range_signals"),
            Some("platformer_horizontal_scroller_signals") => {
                Some("platformer_horizontal_scroller_signals")
            }
            _ => None,
        }
    }

    /// Heuristica de materializacao de grafo para sprite primario ou secundario com SPR_* local ao recurso.
    fn graph_materialization_class_for_sprite_role(
        &self,
        is_primary_sprite: bool,
        secondary_local_spr: bool,
    ) -> Option<&'static str> {
        if is_primary_sprite || secondary_local_spr {
            self.primary_graph_materialization_class()
        } else {
            None
        }
    }

    fn close_range_combat_signal_detected(&self) -> bool {
        const CLOSE_RANGE_KEYWORDS: [&str; 8] = [
            "punch", "kick", "combo", "guard", "melee", "fight", "combat", "round",
        ];
        let mut corpus: Vec<String> = self
            .function_symbols
            .iter()
            .map(|symbol| symbol.name.to_ascii_lowercase())
            .collect();
        for call in &self.function_calls {
            if let Some(caller) = &call.caller {
                corpus.push(caller.to_ascii_lowercase());
            }
            corpus.push(call.callee.to_ascii_lowercase());
            corpus.push(call.snippet.to_ascii_lowercase());
        }
        corpus.extend(
            self.source_evidence
                .iter()
                .map(|evidence| evidence.snippet.to_ascii_lowercase()),
        );
        corpus.into_iter().any(|text| {
            CLOSE_RANGE_KEYWORDS
                .iter()
                .any(|keyword| text.contains(keyword))
        })
    }

    fn function_symbol_for_line(
        &self,
        rel_path: &str,
        line: usize,
    ) -> Option<&SgdkCLiteFunctionSymbol> {
        self.function_symbols.iter().find(|symbol| {
            !symbol.is_prototype
                && symbol.rel_path == rel_path
                && line >= symbol.start_line
                && line <= symbol.end_line
        })
    }

    fn entity_driver_functions(&self, resource_name: &str, is_primary_sprite: bool) -> Vec<String> {
        let direct_refs = self.entity_resource_source_refs(resource_name);
        let mut names: Vec<String> = direct_refs
            .iter()
            .filter_map(|evidence| {
                self.function_symbol_for_line(&evidence.rel_path, evidence.line)
                    .map(|symbol| symbol.name.clone())
            })
            .collect();
        if names.is_empty()
            && is_primary_sprite
            && self
                .function_symbols
                .iter()
                .any(|symbol| !symbol.is_prototype && symbol.name == "main")
        {
            names.push("main".to_string());
        }

        let mut expanded = names.clone();
        for name in &names {
            for call in &self.function_calls {
                if call.callee == *name {
                    if let Some(caller) = call.caller.as_deref() {
                        expanded.push(caller.to_string());
                    }
                }
            }
        }
        if is_primary_sprite {
            for call in &self.function_calls {
                let is_driver_call = matches!(
                    call.callee.as_str(),
                    "JOY_readJoypad"
                        | "JOY_read"
                        | "MAP_scrollH"
                        | "MAP_scrollV"
                        | "SPR_update"
                        | "SPR_init"
                );
                if is_driver_call {
                    if let Some(caller) = call.caller.as_deref() {
                        expanded.push(caller.to_string());
                    }
                }
            }
        }

        expanded.retain(|name| !name.is_empty());
        expanded.sort();
        expanded.dedup();
        expanded
    }

    fn source_paths_for_functions(&self, function_names: &[String]) -> Vec<String> {
        let function_name_set: HashSet<&str> =
            function_names.iter().map(|name| name.as_str()).collect();
        let mut paths: Vec<String> = self
            .function_symbols
            .iter()
            .filter(|symbol| {
                !symbol.is_prototype && function_name_set.contains(symbol.name.as_str())
            })
            .map(|symbol| symbol.rel_path.clone())
            .collect();
        for call in &self.function_calls {
            if function_name_set.contains(call.callee.as_str())
                || call
                    .caller
                    .as_deref()
                    .is_some_and(|caller| function_name_set.contains(caller))
            {
                paths.push(call.rel_path.clone());
            }
        }
        paths.sort();
        paths.dedup();
        paths
    }

    fn entity_semantic_profile(
        &self,
        resource_name: &str,
        is_primary_sprite: bool,
        secondary_local_spr: bool,
    ) -> SgdkPhaseDEntitySemanticProfile {
        let direct_refs = self.entity_resource_source_refs(resource_name);
        let driver_functions = self.entity_driver_functions(resource_name, is_primary_sprite);
        let mut source_paths: Vec<String> = direct_refs
            .iter()
            .map(|evidence| evidence.rel_path.clone())
            .collect();
        source_paths.extend(self.source_paths_for_functions(&driver_functions));
        if source_paths.is_empty() && is_primary_sprite {
            source_paths.extend(self.donor_logic_scanned_paths.clone());
        }
        source_paths.sort();
        source_paths.dedup();

        let entity_id = sgdk_entity_id(resource_name).to_ascii_lowercase();
        let resource_corpus = vec![resource_name.to_ascii_lowercase(), entity_id];
        let mut corpus = resource_corpus.clone();
        corpus.extend(
            driver_functions
                .iter()
                .map(|name| name.to_ascii_lowercase()),
        );
        corpus.extend(direct_refs.iter().map(|evidence| {
            format!(
                "{} {} {}",
                evidence.subject.to_ascii_lowercase(),
                evidence.kind.to_ascii_lowercase(),
                evidence.snippet.to_ascii_lowercase()
            )
        }));
        let has_keywords = |keywords: &[&str]| {
            corpus
                .iter()
                .any(|text| keywords.iter().any(|keyword| text.contains(keyword)))
        };
        let resource_has_keywords = |keywords: &[&str]| {
            resource_corpus
                .iter()
                .any(|text| keywords.iter().any(|keyword| text.contains(keyword)))
        };

        let mut audit_flags = Vec::new();
        let gameplay_class = self.heuristic_gameplay_class();
        let (entity_role, role_reason) = if is_primary_sprite && self.joy_read_detected {
            audit_flags.push("primary_sprite".to_string());
            audit_flags.push("joy_input_anchor".to_string());
            (
                "player_avatar".to_string(),
                "sprite primario com leitura JOY_* no agregado do doador".to_string(),
            )
        } else if resource_has_keywords(&["foe", "enemy", "boss", "guard", "opponent", "rival"]) {
            audit_flags.push("enemy_resource_signal".to_string());
            (
                "enemy_actor".to_string(),
                "nome do recurso/entidade sugere papel de oponente mesmo quando a funcao condutora e compartilhada".to_string(),
            )
        } else if resource_has_keywords(&["player", "hero", "protagon", "avatar"]) {
            audit_flags.push("player_resource_signal".to_string());
            (
                "player_avatar".to_string(),
                "nome do recurso/entidade sugere papel de jogador".to_string(),
            )
        } else if has_keywords(&["foe", "enemy", "boss", "guard", "opponent", "rival"]) {
            audit_flags.push("enemy_name_signal".to_string());
            (
                "enemy_actor".to_string(),
                "recurso associado a sinais lexicais de oponente/inimigo".to_string(),
            )
        } else if has_keywords(&["player", "hero", "protagon", "avatar"]) {
            audit_flags.push("player_name_signal".to_string());
            (
                "player_avatar".to_string(),
                "nome do recurso ou das funcoes sugere papel de jogador".to_string(),
            )
        } else if has_keywords(&["shot", "bullet", "projectile", "laser", "missile", "weapon"]) {
            audit_flags.push("projectile_signal".to_string());
            if matches!(
                gameplay_class.as_deref(),
                Some("shmup_vertical_signals")
                    | Some("run_and_gun_horizontal_signals")
                    | Some("hybrid_action_scroll_signals")
            ) {
                audit_flags.push("projectile_gameplay_fit".to_string());
            }
            (
                "projectile_actor".to_string(),
                "recurso associado a sinais lexicais de tiro/projetil".to_string(),
            )
        } else if has_keywords(&["punch", "kick", "combo", "fight", "combat", "fighter"]) {
            audit_flags.push("close_range_signal".to_string());
            if matches!(
                gameplay_class.as_deref(),
                Some("beat_em_up_close_range_signals") | Some("hybrid_action_scroll_signals")
            ) {
                audit_flags.push("close_range_gameplay_fit".to_string());
            }
            (
                "fighter_actor".to_string(),
                "texto escaneado sugere combate corpo-a-corpo ligado a esta entidade".to_string(),
            )
        } else if resource_has_keywords(&[
            "hud", "score", "health", "lifebar", "gauge", "font", "ui_",
        ]) {
            audit_flags.push("hud_resource_signal".to_string());
            (
                "hud_actor".to_string(),
                "nome do recurso ou corpus sugere HUD/interface (heuristica lexical)".to_string(),
            )
        } else if secondary_local_spr {
            audit_flags.push("secondary_local_spr_signal".to_string());
            (
                "support_actor".to_string(),
                "sprite secundario com linha SPR_* local ao recurso".to_string(),
            )
        } else {
            (
                "generic_imported_sprite".to_string(),
                "sem sinal lexical forte alem do scan agregado; sprite mantido como importado generico"
                    .to_string(),
            )
        };
        if !direct_refs.is_empty() {
            audit_flags.push("direct_entity_bind".to_string());
        }
        if driver_functions.len() > 1 {
            audit_flags.push("multi_function_driver".to_string());
        }
        audit_flags.sort();
        audit_flags.dedup();

        SgdkPhaseDEntitySemanticProfile {
            entity_role,
            role_reason,
            driver_functions,
            source_paths,
            audit_flags,
        }
    }

    fn compute_cross_unit_function_refs(&mut self) {
        let mut def_site: HashMap<String, String> = HashMap::new();
        let mut proto_site: HashMap<String, String> = HashMap::new();
        for symbol in &self.function_symbols {
            if symbol.is_prototype {
                proto_site
                    .entry(symbol.name.clone())
                    .or_insert_with(|| symbol.rel_path.clone());
            } else {
                def_site
                    .entry(symbol.name.clone())
                    .or_insert_with(|| symbol.rel_path.clone());
            }
        }
        let mut seen = HashSet::new();
        let mut refs = Vec::new();
        for call in &self.function_calls {
            let def_rel = def_site
                .get(&call.callee)
                .or_else(|| proto_site.get(&call.callee));
            let Some(def_rel) = def_rel else {
                continue;
            };
            if *def_rel == call.rel_path {
                continue;
            }
            let line = format!(
                "call `{}(` em '{}' linha {} (caller={}) -> definicao textual em '{}'",
                call.callee,
                call.rel_path,
                call.line,
                call.caller.as_deref().unwrap_or("global"),
                def_rel
            );
            if seen.insert(line.clone()) {
                refs.push(line);
            }
        }
        refs.sort();
        self.cross_unit_function_refs = refs;
    }

    fn entity_resource_spr_touch_rel(&self, resource_name: &str) -> Option<String> {
        self.entity_resource_source_refs(resource_name)
            .into_iter()
            .map(|ev| ev.rel_path)
            .next()
    }

    fn entity_resource_source_refs(&self, resource_name: &str) -> Vec<SgdkSourceEvidence> {
        let entity_id = sgdk_entity_id(resource_name);
        if entity_id.len() < 2 {
            return Vec::new();
        }
        let mut refs = Vec::new();
        let mut rel_keys: Vec<String> = self.source_text_by_rel.keys().cloned().collect();
        rel_keys.sort();
        for rel in rel_keys {
            let Some(src) = self.source_text_by_rel.get(&rel) else {
                continue;
            };
            for (line_idx, raw_line) in src.lines().enumerate() {
                let line = strip_cpp_line_comment(raw_line).trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                let has_spr_api = line.contains("SPR_addSprite")
                    || line.contains("SPR_setPosition")
                    || line.contains("SPR_update")
                    || line.contains("SPR_init");
                if !has_spr_api {
                    continue;
                }
                if c_token_boundary_substring(line, &entity_id) {
                    refs.push(SgdkSourceEvidence {
                        rel_path: rel.clone(),
                        line: line_idx + 1,
                        kind: "entity_bind".to_string(),
                        subject: entity_id.clone(),
                        snippet: normalize_source_snippet(line),
                    });
                }
            }
        }
        refs.sort_by(|a, b| {
            a.rel_path
                .cmp(&b.rel_path)
                .then_with(|| a.line.cmp(&b.line))
        });
        refs
    }

    fn generic_phase_d_evidence(&self, limit: usize) -> Vec<SgdkSourceEvidence> {
        let mut list = self.source_evidence.clone();
        list.sort_by(|a, b| {
            a.rel_path
                .cmp(&b.rel_path)
                .then_with(|| a.line.cmp(&b.line))
                .then_with(|| a.kind.cmp(&b.kind))
        });
        list.into_iter().take(limit).collect()
    }
}

fn strip_cpp_line_comment(line: &str) -> &str {
    line.find("//").map(|idx| &line[..idx]).unwrap_or(line)
}

fn is_sgdk_c_keyword(name: &str) -> bool {
    matches!(
        name,
        "if" | "while"
            | "for"
            | "switch"
            | "return"
            | "case"
            | "else"
            | "do"
            | "sizeof"
            | "break"
            | "continue"
    )
}

fn looks_like_sgdk_macro_api_identifier(name: &str) -> bool {
    name.starts_with("SPR_")
        || name.starts_with("MAP_")
        || name.starts_with("JOY_")
        || name.starts_with("VDP_")
        || name.starts_with("SYS_")
}

fn c_token_boundary_substring(haystack: &str, needle: &str) -> bool {
    if needle.len() < 2 {
        return false;
    }
    for (idx, _) in haystack.match_indices(needle) {
        let before = haystack[..idx].chars().last();
        let after = haystack[idx + needle.len()..].chars().next();
        let before_ok = before.is_none_or(|c| !c.is_ascii_alphanumeric() && c != '_');
        let after_ok = after.is_none_or(|c| !c.is_ascii_alphanumeric() && c != '_');
        if before_ok && after_ok {
            return true;
        }
    }
    false
}

fn normalize_source_snippet(raw_line: &str) -> String {
    let mut snippet = raw_line.trim().replace('\t', " ");
    if snippet.len() > 140 {
        snippet.truncate(140);
    }
    snippet
}

fn sanitize_c_source_for_scan(source: &str) -> String {
    let mut out = String::with_capacity(source.len());
    let chars: Vec<char> = source.chars().collect();
    let mut idx = 0usize;
    let mut in_line_comment = false;
    let mut in_block_comment = false;
    let mut in_string = false;
    let mut in_char = false;
    while idx < chars.len() {
        let ch = chars[idx];
        let next = chars.get(idx + 1).copied();
        if in_line_comment {
            if ch == '\n' {
                in_line_comment = false;
                out.push('\n');
            } else {
                out.push(' ');
            }
            idx += 1;
            continue;
        }
        if in_block_comment {
            if ch == '*' && next == Some('/') {
                out.push(' ');
                out.push(' ');
                in_block_comment = false;
                idx += 2;
                continue;
            }
            if ch == '\n' {
                out.push('\n');
            } else {
                out.push(' ');
            }
            idx += 1;
            continue;
        }
        if in_string {
            if ch == '\\' {
                out.push(' ');
                if next.is_some() {
                    out.push(' ');
                    idx += 2;
                } else {
                    idx += 1;
                }
                continue;
            }
            if ch == '"' {
                in_string = false;
            }
            out.push(if ch == '\n' { '\n' } else { ' ' });
            idx += 1;
            continue;
        }
        if in_char {
            if ch == '\\' {
                out.push(' ');
                if next.is_some() {
                    out.push(' ');
                    idx += 2;
                } else {
                    idx += 1;
                }
                continue;
            }
            if ch == '\'' {
                in_char = false;
            }
            out.push(if ch == '\n' { '\n' } else { ' ' });
            idx += 1;
            continue;
        }
        if ch == '/' && next == Some('/') {
            in_line_comment = true;
            out.push(' ');
            out.push(' ');
            idx += 2;
            continue;
        }
        if ch == '/' && next == Some('*') {
            in_block_comment = true;
            out.push(' ');
            out.push(' ');
            idx += 2;
            continue;
        }
        if ch == '"' {
            in_string = true;
            out.push(' ');
            idx += 1;
            continue;
        }
        if ch == '\'' {
            in_char = true;
            out.push(' ');
            idx += 1;
            continue;
        }
        out.push(ch);
        idx += 1;
    }
    out
}

fn collect_c_line_function_calls(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let bytes = line.as_bytes();
    let mut idx = 0usize;
    while idx < bytes.len() {
        let ch = bytes[idx] as char;
        if !(ch.is_ascii_alphabetic() || ch == '_') {
            idx += 1;
            continue;
        }
        let start = idx;
        idx += 1;
        while idx < bytes.len() {
            let c = bytes[idx] as char;
            if c.is_ascii_alphanumeric() || c == '_' {
                idx += 1;
            } else {
                break;
            }
        }
        let ident = &line[start..idx];
        let mut look = idx;
        while look < bytes.len() && (bytes[look] as char).is_ascii_whitespace() {
            look += 1;
        }
        if look < bytes.len() && bytes[look] as char == '(' && !is_sgdk_c_keyword(ident) {
            out.push(ident.to_string());
        }
    }
    out
}

fn collect_sgdk_c_function_symbols(rel_path: &str, source: &str) -> Vec<SgdkCLiteFunctionSymbol> {
    let mut symbols = Vec::new();
    let lines: Vec<&str> = source.lines().collect();
    let mut line_idx = 0usize;
    while line_idx < lines.len() {
        let line = lines[line_idx].trim();
        if line.is_empty() || line.starts_with('#') {
            line_idx += 1;
            continue;
        }
        let Some(name) = extract_sgdk_line_function_def_name(line) else {
            line_idx += 1;
            continue;
        };
        let is_prototype = line.trim_end().ends_with(';');
        let mut end_line = line_idx + 1;
        if !is_prototype && line.contains('{') {
            let mut depth = 0i32;
            let mut cursor = line_idx;
            let mut found_open = false;
            while cursor < lines.len() {
                for ch in lines[cursor].chars() {
                    if ch == '{' {
                        depth += 1;
                        found_open = true;
                    } else if ch == '}' && found_open {
                        depth -= 1;
                        if depth <= 0 {
                            end_line = cursor + 1;
                            break;
                        }
                    }
                }
                if found_open && depth <= 0 {
                    break;
                }
                cursor += 1;
            }
        }
        symbols.push(SgdkCLiteFunctionSymbol {
            name,
            rel_path: rel_path.to_string(),
            start_line: line_idx + 1,
            end_line,
            is_prototype,
        });
        line_idx += 1;
    }
    symbols
}

/// Extrai nome de funcao apenas quando a linha parece definicao/prototipo (heuristica conservadora).
fn extract_sgdk_line_function_def_name(line: &str) -> Option<String> {
    if line.contains("typedef") {
        return None;
    }
    let work = if let Some(brace) = line.find('{') {
        line[..brace].trim()
    } else if line.ends_with(';') {
        line.trim_end_matches(';').trim()
    } else {
        return None;
    };
    let open = work.find('(')?;
    let before = work[..open].trim();
    let tokens: Vec<&str> = before.split_whitespace().collect();
    if tokens.len() < 2 {
        return None;
    }
    let name = tokens.last()?.trim_start_matches('*').to_string();
    if name.is_empty() {
        return None;
    }
    if !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return None;
    }
    if is_sgdk_c_keyword(&name) {
        return None;
    }
    if looks_like_sgdk_macro_api_identifier(&name) {
        return None;
    }
    if name.chars().all(|c| c.is_ascii_uppercase() || c == '_') && name.len() > 3 {
        return None;
    }
    Some(name)
}

fn sgdk_donor_rel_path(sgdk_root: &Path, file: &Path) -> Option<String> {
    let rel = file.strip_prefix(sgdk_root).ok()?;
    let s = rel.to_string_lossy().replace('\\', "/");
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

/// Extrai apenas `#include "local.h"` (nao processa includes de sistema `<>`).
fn extract_sgdk_quoted_includes(source: &str) -> Vec<String> {
    let mut out = Vec::new();
    for raw_line in source.lines() {
        let line = raw_line.trim_start();
        if !line.starts_with('#') {
            continue;
        }
        let mut rest = line[1..].trim_start();
        if !rest.starts_with("include") {
            continue;
        }
        rest = rest["include".len()..].trim_start();
        let Some(inner) = rest.strip_prefix('"') else {
            continue;
        };
        let Some(end) = inner.find('"') else {
            continue;
        };
        let inc = inner[..end].trim();
        if inc.is_empty() {
            continue;
        }
        out.push(inc.to_string());
    }
    out
}

fn resolve_sgdk_quoted_include_path(
    sgdk_root: &Path,
    from_file: &Path,
    include_lit: &str,
) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(parent) = from_file.parent() {
        candidates.push(parent.join(include_lit));
    }
    candidates.push(sgdk_root.join("src").join(include_lit));
    candidates.push(sgdk_root.join("inc").join(include_lit));
    if include_lit.contains('/') || include_lit.contains('\\') {
        candidates.push(sgdk_root.join(include_lit));
    }
    candidates.into_iter().find(|p| p.is_file())
}

fn scan_sgdk_donor_logic_scan(sgdk_path: &Path) -> SgdkDonorLogicScan {
    let mut scan = SgdkDonorLogicScan::default();
    let main_c = sgdk_path.join("src").join("main.c");
    if !main_c.is_file() {
        return scan;
    }

    const MAX_SCANNED_FILES: usize = 18;
    let mut queue: VecDeque<PathBuf> = VecDeque::new();
    let mut visited: HashSet<String> = HashSet::new();
    queue.push_back(main_c);

    while let Some(abs_path) = queue.pop_front() {
        if visited.len() >= MAX_SCANNED_FILES {
            break;
        }
        let visit_key = abs_path.to_string_lossy().to_string();
        if !abs_path.is_file() || !visited.insert(visit_key) {
            continue;
        }

        let Ok(text) = fs::read_to_string(&abs_path) else {
            continue;
        };
        let sanitized = sanitize_c_source_for_scan(&text);
        if let Some(rel) = sgdk_donor_rel_path(sgdk_path, &abs_path) {
            scan.donor_logic_scanned_paths.push(rel.clone());
            scan.source_text_by_rel.insert(rel.clone(), text.clone());
            if sanitized.contains("while(1)")
                || sanitized.contains("while (1)")
                || sanitized.contains("while(true)")
                || sanitized.contains("while (true)")
                || sanitized.contains("for(;;)")
                || sanitized.contains("for (;;)")
            {
                scan.busy_loop_detected = true;
            }
            let symbols = collect_sgdk_c_function_symbols(&rel, &sanitized);
            for symbol in symbols {
                let source_line = text
                    .lines()
                    .nth(symbol.start_line.saturating_sub(1))
                    .unwrap_or_default();
                scan.register_function_symbol(symbol, source_line);
            }
            let source_lines: Vec<&str> = text.lines().collect();
            let sanitized_lines: Vec<&str> = sanitized.lines().collect();
            for (line_idx, sanitized_line) in sanitized_lines.iter().enumerate() {
                let source_line = source_lines.get(line_idx).copied().unwrap_or_default();
                for callee in collect_c_line_function_calls(sanitized_line) {
                    let caller = scan
                        .function_symbols
                        .iter()
                        .find(|sym| {
                            !sym.is_prototype
                                && sym.rel_path == rel
                                && (line_idx + 1) >= sym.start_line
                                && (line_idx + 1) <= sym.end_line
                        })
                        .map(|sym| sym.name.clone());
                    scan.register_callsite(SgdkCLiteFunctionCall {
                        caller,
                        callee,
                        rel_path: rel.clone(),
                        line: line_idx + 1,
                        snippet: source_line.to_string(),
                    });
                }
            }
        }

        for inc in extract_sgdk_quoted_includes(&text) {
            let base_name = Path::new(&inc)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(inc.as_str());
            if base_name.eq_ignore_ascii_case("genesis.h")
                || base_name.eq_ignore_ascii_case("types.h")
                || base_name.eq_ignore_ascii_case("sprite_eng.h")
            {
                continue;
            }
            if let Some(resolved) = resolve_sgdk_quoted_include_path(sgdk_path, &abs_path, &inc) {
                let res_key = resolved.to_string_lossy().to_string();
                if !visited.contains(&res_key) {
                    queue.push_back(resolved.clone());
                }
                if inc.to_ascii_lowercase().ends_with(".h") {
                    if let Some(stem) = Path::new(&inc).file_stem().and_then(|s| s.to_str()) {
                        let companion_c = resolved
                            .parent()
                            .unwrap_or(sgdk_path)
                            .join(format!("{stem}.c"));
                        if companion_c.is_file() {
                            let ck = companion_c.to_string_lossy().to_string();
                            if !visited.contains(&ck) {
                                queue.push_back(companion_c);
                            }
                        }
                    }
                }
            }
        }
    }

    scan.donor_logic_scanned_paths.sort();
    scan.donor_logic_scanned_paths.dedup();
    scan.compute_cross_unit_function_refs();
    scan.source_evidence.sort_by(|a, b| {
        a.rel_path
            .cmp(&b.rel_path)
            .then_with(|| a.line.cmp(&b.line))
            .then_with(|| a.kind.cmp(&b.kind))
            .then_with(|| a.subject.cmp(&b.subject))
    });
    scan.source_evidence.dedup_by(|a, b| {
        a.rel_path == b.rel_path
            && a.line == b.line
            && a.kind == b.kind
            && a.subject == b.subject
            && a.snippet == b.snippet
    });
    scan
}

fn is_sgdk_rescomp_compression_token(token: &str) -> bool {
    let u = token.trim().to_ascii_uppercase();
    matches!(
        u.as_str(),
        "BEST" | "AUTO" | "NONE" | "APLIB" | "FAST" | "LZ4W"
    ) || matches!(token.trim(), "-1" | "0" | "1" | "2")
}

fn parse_sgdk_sprite_axis_extent(token: &str, axis_px: u32) -> Result<u32, String> {
    let t = token.trim();
    if t.is_empty() {
        return Err("parametro vazio".into());
    }
    let bytes = t.as_bytes();
    let last = *bytes.last().unwrap_or(&b'0');
    if last == b'p' || last == b'P' {
        let num: u32 = t[..bytes.len() - 1]
            .parse()
            .map_err(|_| "largura/altura em px invalida".to_string())?;
        if num == 0 || !num.is_multiple_of(8) {
            return Err("dimensao em px deve ser multiplo de 8".into());
        }
        Ok(num)
    } else if last == b'f' || last == b'F' {
        let frames: u32 = t[..bytes.len() - 1]
            .parse()
            .map_err(|_| "contagem de frames 'f' invalida".to_string())?;
        if frames == 0 {
            return Err("contagem de frames deve ser > 0".into());
        }
        if !axis_px.is_multiple_of(frames) {
            return Err(format!(
                "eixo de imagem {} nao divisivel por {} frames",
                axis_px, frames
            ));
        }
        Ok(axis_px / frames)
    } else {
        let tiles: u32 = t
            .parse()
            .map_err(|_| "dimensao em tiles invalida (use inteiro ou sufixo p/f)".to_string())?;
        Ok(tiles.saturating_mul(8).max(8))
    }
}

fn parse_sgdk_sprite_compression_time_ticks(params: &[String]) -> (u32, Option<String>) {
    let mut idx = 2usize;
    if params.len() <= idx {
        return (0, None);
    }
    if is_sgdk_rescomp_compression_token(&params[idx]) {
        let label = params[idx].clone();
        idx += 1;
        if params.len() <= idx {
            return (0, Some(label));
        }
        let time_raw = &params[idx];
        if time_raw.starts_with("[[") {
            return (0, Some(label));
        }
        let ticks: u32 = time_raw.parse().unwrap_or(0);
        return (ticks, Some(label));
    }
    let ticks: u32 = params[idx].parse().unwrap_or(0);
    (ticks, None)
}

fn derive_sgdk_sprite_sheet_from_rescomp_png(
    png_path: &Path,
    resource_name: &str,
    params: &[String],
) -> SgdkSpriteSheetDerived {
    let mut notes = Vec::new();
    let legacy_tiles_w = || {
        params
            .first()
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(2)
            .saturating_mul(8)
            .max(8)
    };
    let legacy_tiles_h = || {
        params
            .get(1)
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or_else(|| {
                params
                    .first()
                    .and_then(|v| v.parse::<u32>().ok())
                    .unwrap_or(2)
            })
            .saturating_mul(8)
            .max(8)
    };
    if params.len() < 2 {
        notes.push(format!(
            "sprite '{}': linha .res sem width/height completos; usando heuristica legacy em tiles.",
            resource_name
        ));
        return SgdkSpriteSheetDerived {
            frame_width: legacy_tiles_w(),
            frame_height: legacy_tiles_h(),
            animations: HashMap::new(),
            notes,
        };
    }
    let (img_w, img_h) = match image::image_dimensions(png_path) {
        Ok(v) => v,
        Err(e) => {
            notes.push(format!(
                "sprite '{}': falha ao ler dimensoes do PNG ({}); usando heuristica legacy em tiles.",
                resource_name, e
            ));
            return SgdkSpriteSheetDerived {
                frame_width: legacy_tiles_w(),
                frame_height: legacy_tiles_h(),
                animations: HashMap::new(),
                notes,
            };
        }
    };
    let frame_w = match parse_sgdk_sprite_axis_extent(&params[0], img_w) {
        Ok(v) => v,
        Err(msg) => {
            notes.push(format!(
                "sprite '{}': width '{}' invalido ({}); fallback legacy em tiles.",
                resource_name, params[0], msg
            ));
            return SgdkSpriteSheetDerived {
                frame_width: legacy_tiles_w(),
                frame_height: legacy_tiles_h(),
                animations: HashMap::new(),
                notes,
            };
        }
    };
    let frame_h = match parse_sgdk_sprite_axis_extent(&params[1], img_h) {
        Ok(v) => v,
        Err(msg) => {
            notes.push(format!(
                "sprite '{}': height '{}' invalido ({}); fallback legacy em tiles.",
                resource_name, params[1], msg
            ));
            return SgdkSpriteSheetDerived {
                frame_width: legacy_tiles_w(),
                frame_height: legacy_tiles_h(),
                animations: HashMap::new(),
                notes,
            };
        }
    };
    if frame_w == 0
        || frame_h == 0
        || !img_w.is_multiple_of(frame_w)
        || !img_h.is_multiple_of(frame_h)
    {
        notes.push(format!(
            "sprite '{}': sheet {}x{} nao alinha com frame {}x{}; animacoes nao derivadas (fallback legacy em tiles).",
            resource_name, img_w, img_h, frame_w, frame_h
        ));
        return SgdkSpriteSheetDerived {
            frame_width: legacy_tiles_w(),
            frame_height: legacy_tiles_h(),
            animations: HashMap::new(),
            notes,
        };
    }
    let frames_x = img_w / frame_w;
    let rows = img_h / frame_h;
    let (time_ticks, _compression) = parse_sgdk_sprite_compression_time_ticks(params);
    let fps = if time_ticks > 0 {
        60u32.saturating_div(time_ticks.max(1)).max(1)
    } else {
        notes.push(format!(
            "sprite '{}': timer SGDK=0 (sem auto-advance no hardware); fps=8 apenas para preview no editor.",
            resource_name
        ));
        8
    };
    let mut animations = HashMap::new();
    for row in 0..rows {
        let anim_name = if rows == 1 {
            "default".to_string()
        } else {
            format!("sheet_row_{}", row)
        };
        let frame_indices: Vec<u32> = (0..frames_x).map(|col| row * frames_x + col).collect();
        let looping = frame_indices.len() > 1 && time_ticks > 0;
        animations.insert(
            anim_name,
            AnimationDef {
                frames: frame_indices,
                fps,
                looping,
                frame_durations: None,
                loop_start: None,
                mugen_frames: None,
            },
        );
    }
    notes.push(format!(
        "sprite '{}': animacoes derivadas da grelha rescomp ({} fileira(s), {} quadro(s) por fileira); ver SGDK rescomp SPRITE.",
        resource_name, rows, frames_x
    ));
    SgdkSpriteSheetDerived {
        frame_width: frame_w,
        frame_height: frame_h,
        animations,
        notes,
    }
}

fn derive_sgdk_scene_collision_map_from_tile_cells(
    cells: &[u32],
    map_width: u32,
    map_height: u32,
) -> Option<(CollisionMap, String)> {
    let expected = map_width.checked_mul(map_height)? as usize;
    if cells.len() != expected || expected == 0 {
        return None;
    }
    let data: Vec<u8> = cells
        .iter()
        .map(|c| if *c == 0 { 0u8 } else { 1u8 })
        .collect();
    let solid = data.iter().filter(|&&v| v != 0).count() as u64;
    let note = format!(
        "Fase C: collision_map derivado por regra rastreavel: solido onde indice de tile != 0, livre onde == 0 (indice 0 = tile totalmente transparente em extract_sgdk_tilemap_cells); grade {}x{} tiles, {} celulas solidas.",
        map_width, map_height, solid
    );
    Some((
        CollisionMap {
            tile_width: 8,
            tile_height: 8,
            width: map_width,
            height: map_height,
            data,
        },
        note,
    ))
}

fn imported_sprite_logic_graph_phase_d(
    resource_name: &str,
    scan: &SgdkDonorLogicScan,
    is_primary_sprite: bool,
    secondary_local_spr: bool,
    semantic_profile: &SgdkPhaseDEntitySemanticProfile,
) -> String {
    let target = sgdk_entity_id(resource_name);
    let mat_class =
        scan.graph_materialization_class_for_sprite_role(is_primary_sprite, secondary_local_spr);
    let materialize_fire = matches!(
        mat_class,
        Some("shmup_vertical_signals") | Some("run_and_gun_horizontal_signals")
    );
    let move_label = match semantic_profile.entity_role.as_str() {
        "player_avatar" => "Move Player",
        "enemy_actor" => "Advance Enemy",
        "projectile_actor" => "Move Projectile",
        "support_actor" => "Move Support",
        "fighter_actor" => "Step Fighter",
        _ => "Move Sprite",
    };
    let (mv_dx, mv_dy) = match (mat_class, semantic_profile.entity_role.as_str()) {
        (Some("shmup_vertical_signals"), "enemy_actor") => (0, 2),
        (Some("shmup_vertical_signals"), "projectile_actor") => (0, -4),
        (Some("shmup_vertical_signals"), _) => (0, -2),
        (Some("beat_em_up_close_range_signals"), "enemy_actor") => (-1, 0),
        (Some("beat_em_up_close_range_signals"), "projectile_actor") => (3, 0),
        (Some("beat_em_up_close_range_signals"), _) => (1, 0),
        (_, "enemy_actor") => (-1, 0),
        (_, "projectile_actor") => (4, 0),
        _ => (2, 0),
    };
    let start = serde_json::json!({
        "id": "start",
        "type": "event_start",
        "label": "On Start",
        "x": 48,
        "y": 48,
        "inputs": [],
        "outputs": [{ "id": "exec", "label": ">", "kind": "exec" }],
        "params": {}
    });
    let move_sprite = serde_json::json!({
        "id": "move_sprite",
        "type": "sprite_move",
        "label": move_label,
        "x": 228,
        "y": 48,
        "inputs": [{ "id": "exec", "label": ">", "kind": "exec" }],
        "outputs": [{ "id": "exec", "label": ">", "kind": "exec" }],
        "params": { "target": target, "dx": mv_dx, "dy": mv_dy }
    });
    let mut nodes: Vec<serde_json::Value> = vec![start, move_sprite];
    let mut edges: Vec<serde_json::Value> = vec![serde_json::json!({
        "id": "edge_start_move",
        "fromNode": "start",
        "fromPort": "exec",
        "toNode": "move_sprite",
        "toPort": "exec"
    })];
    let mut tail_node = "move_sprite";
    if materialize_fire {
        let sfx_label = match (mat_class, semantic_profile.entity_role.as_str()) {
            (Some("shmup_vertical_signals"), "enemy_actor") => "Disparo inimigo (heuristica shmup)",
            (Some("shmup_vertical_signals"), _) => "Disparo (heuristica shmup)",
            (Some("run_and_gun_horizontal_signals"), "enemy_actor") => {
                "Cobertura inimiga (heuristica run-and-gun)"
            }
            (Some("run_and_gun_horizontal_signals"), _) => "Disparo (heuristica run-and-gun)",
            (_, "projectile_actor") => "Tiro materializado (heuristica)",
            _ => "Disparo (heuristica)",
        };
        nodes.push(serde_json::json!({
            "id": "fire_hint",
            "type": "action_sound",
            "label": sfx_label,
            "x": 228,
            "y": 168,
            "inputs": [{ "id": "exec", "label": ">", "kind": "exec" }],
            "outputs": [{ "id": "exec", "label": ">", "kind": "exec" }],
            "params": { "sfx": "fire" }
        }));
        edges.push(serde_json::json!({
            "id": "edge_move_fire",
            "fromNode": "move_sprite",
            "fromPort": "exec",
            "toNode": "fire_hint",
            "toPort": "exec"
        }));
        tail_node = "fire_hint";
    }
    if scan.map_scroll_any() {
        let (dx, dy, label_suffix) = if scan.map_scroll_v_detected && !scan.map_scroll_h_detected {
            (0, -1, "MAP_scrollV")
        } else if scan.map_scroll_h_detected && !scan.map_scroll_v_detected {
            (-1, 0, "MAP_scrollH")
        } else {
            (-1, -1, "MAP_scrollH+V")
        };
        let scroll_label = format!("Scroll Tilemap ({label_suffix})");
        nodes.push(serde_json::json!({
            "id": "scroll_bg",
            "type": "scroll_tilemap",
            "label": scroll_label,
            "x": 408,
            "y": 48,
            "inputs": [{ "id": "exec", "label": ">", "kind": "exec" }],
            "outputs": [{ "id": "exec", "label": ">", "kind": "exec" }],
            "params": { "layer": "BG_A", "dx": dx, "dy": dy }
        }));
        edges.push(serde_json::json!({
            "id": "edge_tail_scroll",
            "fromNode": tail_node,
            "fromPort": "exec",
            "toNode": "scroll_bg",
            "toPort": "exec"
        }));
        tail_node = "scroll_bg";
    }

    // Bloco E (sprint): padroes uteis adicionais por *papel* da entidade — o grafo inicial deixa de ser apenas
    // start -> move (+ fire opcional) + scroll; cada role recebe um no terminal encadeado com semantica propria.
    let (role_node_id, role_node) = match semantic_profile.entity_role.as_str() {
        "player_avatar" => (
            "role_player_idle_anim",
            serde_json::json!({
                "id": "role_player_idle_anim",
                "type": "sprite_anim",
                "label": "Anim jogador (idle/walk — heuristica de papel)",
                "x": 588,
                "y": 168,
                "inputs": [{ "id": "exec", "label": ">", "kind": "exec" }],
                "outputs": [{ "id": "exec", "label": ">", "kind": "exec" }],
                "params": { "target": target, "anim": "idle" }
            }),
        ),
        "enemy_actor" => (
            "role_enemy_threat_sound",
            serde_json::json!({
                "id": "role_enemy_threat_sound",
                "type": "action_sound",
                "label": "Zona de perigo / contato (inimigo)",
                "x": 588,
                "y": 168,
                "inputs": [{ "id": "exec", "label": ">", "kind": "exec" }],
                "outputs": [{ "id": "exec", "label": ">", "kind": "exec" }],
                "params": { "sfx": "hit" }
            }),
        ),
        "support_actor" => (
            "role_support_parallax_hint",
            serde_json::json!({
                "id": "role_support_parallax_hint",
                "type": "effect_parallax",
                "label": "Parallax de cenario (apoio / vfx leve)",
                "x": 588,
                "y": 168,
                "inputs": [{ "id": "exec", "label": ">", "kind": "exec" }],
                "outputs": [{ "id": "exec", "label": ">", "kind": "exec" }],
                "params": { "layer": "BG_A", "speed_x": 1, "speed_y": 0 }
            }),
        ),
        "fighter_actor" => (
            "role_fighter_melee_sound",
            serde_json::json!({
                "id": "role_fighter_melee_sound",
                "type": "action_sound",
                "label": "Impacto corpo-a-corpo (lutador)",
                "x": 588,
                "y": 168,
                "inputs": [{ "id": "exec", "label": ">", "kind": "exec" }],
                "outputs": [{ "id": "exec", "label": ">", "kind": "exec" }],
                "params": { "sfx": "hit" }
            }),
        ),
        "projectile_actor" => (
            "role_projectile_trail_anim",
            serde_json::json!({
                "id": "role_projectile_trail_anim",
                "type": "sprite_anim",
                "label": "Anim projetil (trajetoria — heuristica)",
                "x": 588,
                "y": 168,
                "inputs": [{ "id": "exec", "label": ">", "kind": "exec" }],
                "outputs": [{ "id": "exec", "label": ">", "kind": "exec" }],
                "params": { "target": target, "anim": "fly" }
            }),
        ),
        "hud_actor" => (
            "role_hud_scroll_tick",
            serde_json::json!({
                "id": "role_hud_scroll_tick",
                "type": "scroll_tilemap",
                "label": "Scroll leve sincronizado com HUD (heuristica)",
                "x": 588,
                "y": 168,
                "inputs": [{ "id": "exec", "label": ">", "kind": "exec" }],
                "outputs": [{ "id": "exec", "label": ">", "kind": "exec" }],
                "params": { "layer": "BG_A", "dx": 0, "dy": -1 }
            }),
        ),
        _ => (
            "role_generic_import_marker",
            serde_json::json!({
                "id": "role_generic_import_marker",
                "type": "var_set",
                "label": "Marcador de import generico (sprite)",
                "x": 588,
                "y": 168,
                "inputs": [{ "id": "exec", "label": ">", "kind": "exec" }],
                "outputs": [{ "id": "exec", "label": ">", "kind": "exec" }],
                "params": { "var_name": "imported_sprite_flag", "value": 1 }
            }),
        ),
    };
    nodes.push(role_node);
    edges.push(serde_json::json!({
        "id": "edge_tail_role_pattern",
        "fromNode": tail_node,
        "fromPort": "exec",
        "toNode": role_node_id,
        "toPort": "exec"
    }));

    serde_json::json!({
        "version": 1,
        "nodes": nodes,
        "edges": edges
    })
    .to_string()
}

#[derive(Debug, Clone, Default)]
struct SgdkPhaseDEntityResult {
    graph_ref: String,
    source_refs: Vec<SgdkSourceEvidence>,
    confidence: String,
    applied_class: String,
    entity_role: String,
    role_reason: String,
    driver_functions: Vec<String>,
    source_paths: Vec<String>,
    rules_hit: Vec<String>,
}

#[derive(Debug, Clone, Default)]
struct SgdkPhaseDEntitySemanticProfile {
    entity_role: String,
    role_reason: String,
    driver_functions: Vec<String>,
    source_paths: Vec<String>,
    audit_flags: Vec<String>,
}

fn append_position_audit(entity: &mut Entity, flag: &str, detail: &str) {
    let Some(logic) = entity.components.logic.as_mut() else {
        return;
    };
    if let Some(semantics) = logic.imported_semantics.as_mut() {
        if !semantics.audit_flags.iter().any(|item| item == flag) {
            semantics.audit_flags.push(flag.to_string());
            semantics.audit_flags.sort();
            semantics.audit_flags.dedup();
        }
    }
    if !logic.logic_hints.iter().any(|hint| hint == detail) {
        logic.logic_hints.push(detail.to_string());
    }
}

fn sprite_role_priority(entity: &Entity) -> i32 {
    let role = entity
        .components
        .logic
        .as_ref()
        .and_then(|logic| logic.imported_semantics.as_ref())
        .map(|semantics| semantics.entity_role.as_str())
        .unwrap_or("");
    match role {
        "player_avatar" => 0,
        "fighter_actor" => 1,
        "enemy_actor" => 2,
        "hud_actor" => 3,
        "support_actor" => 4,
        "projectile_actor" => 5,
        _ => 6,
    }
}

fn needs_sgdk_authoring_staging_layout(sprite_entities: &[Entity]) -> bool {
    if sprite_entities.len() <= 1 {
        return false;
    }
    let mut counts: HashMap<(i32, i32), usize> = HashMap::new();
    let mut min_x = i32::MAX;
    let mut min_y = i32::MAX;
    let mut max_x = i32::MIN;
    let mut max_y = i32::MIN;
    for entity in sprite_entities {
        *counts
            .entry((entity.transform.x, entity.transform.y))
            .or_insert(0) += 1;
        min_x = min_x.min(entity.transform.x);
        min_y = min_y.min(entity.transform.y);
        max_x = max_x.max(entity.transform.x);
        max_y = max_y.max(entity.transform.y);
    }
    let unique_positions = counts.len();
    let max_stack = counts.values().copied().max().unwrap_or(0);
    if (unique_positions == 1 && max_stack > 1) || max_stack >= 4 {
        return true;
    }

    // Cenas densas podem chegar com múltiplas coordenadas, mas ainda assim
    // concentradas demais para autoria (ex.: variações mínimas em torno de 32,32).
    // Tratamos como não-operacional quando muitos sprites ocupam uma área reduzida.
    let dense_count = sprite_entities.len();
    let spread_w = (max_x - min_x).abs().max(1);
    let spread_h = (max_y - min_y).abs().max(1);
    let area = spread_w.saturating_mul(spread_h);
    dense_count >= 10 && area <= (320 * 224 / 3)
}

fn sgdk_role_lane_base_y(entity: &Entity) -> i32 {
    let role = entity
        .components
        .logic
        .as_ref()
        .and_then(|logic| logic.imported_semantics.as_ref())
        .map(|semantics| semantics.entity_role.as_str())
        .unwrap_or("");
    match role {
        "player_avatar" => 88,
        "fighter_actor" => 120,
        "enemy_actor" => 152,
        "hud_actor" => 200,
        "support_actor" => 48,
        "projectile_actor" => 32,
        _ => 176,
    }
}

fn apply_sgdk_authoring_staging_layout(sprite_entities: &mut [Entity]) -> usize {
    if !needs_sgdk_authoring_staging_layout(sprite_entities) {
        for entity in sprite_entities.iter_mut() {
            append_position_audit(
                entity,
                "position:inferred",
                "Fase D: posicao mantida como inferencia de importacao; o donor SGDK nao forneceu coordenadas confiaveis de cena para esta entidade.",
            );
        }
        return 0;
    }

    sprite_entities.sort_by(|left, right| {
        sprite_role_priority(left)
            .cmp(&sprite_role_priority(right))
            .then_with(|| {
                left.display_name
                    .as_deref()
                    .unwrap_or(left.entity_id.as_str())
                    .cmp(
                        right
                            .display_name
                            .as_deref()
                            .unwrap_or(right.entity_id.as_str()),
                    )
            })
    });

    let mut staged = 0usize;
    let slots_per_page = 4usize;
    let lanes_per_page = 2usize;
    let lane_gap = 28i32;
    for (index, entity) in sprite_entities.iter_mut().enumerate() {
        let page = index / (slots_per_page * lanes_per_page);
        let page_slot = index % (slots_per_page * lanes_per_page);
        let column = page_slot % slots_per_page;
        let lane = page_slot / slots_per_page;
        entity.transform.x = 48 + (column as i32 * 64) + (page as i32 * 320);
        entity.transform.y = sgdk_role_lane_base_y(entity) + (lane as i32 * lane_gap);
        append_position_audit(
            entity,
            "position:staging_layout",
            "Fase D: cena importada abriu em staging de autoria porque o donor SGDK nao oferece coordenadas de cena confiaveis; reposicione a entidade quando quiser consolidar o layout real.",
        );
        staged += 1;
    }

    staged
}

fn apply_sgdk_phase_d_to_sprite_entity(
    project_dir: &Path,
    entity: &mut Entity,
    resource_name: &str,
    scan: &SgdkDonorLogicScan,
    is_primary_sprite: bool,
    secondary_local_spr: bool,
) -> Result<SgdkPhaseDEntityResult, LoadError> {
    let mut phase_d_result = SgdkPhaseDEntityResult::default();
    let Some(logic) = entity.components.logic.as_mut() else {
        return Ok(phase_d_result);
    };
    let semantic_profile =
        scan.entity_semantic_profile(resource_name, is_primary_sprite, secondary_local_spr);
    let graph_ref = sgdk_import_sprite_logic_graph_ref(&entity.entity_id);
    let graph_json = imported_sprite_logic_graph_phase_d(
        resource_name,
        scan,
        is_primary_sprite,
        secondary_local_spr,
        &semantic_profile,
    );
    let graph_path = graph_write_path(project_dir, &graph_ref)?;
    if let Some(parent) = graph_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            LoadError(format!(
                "Fase D: nao foi possivel criar diretorio para graph_ref '{}': {}",
                graph_ref, error
            ))
        })?;
    }
    fs::write(&graph_path, &graph_json).map_err(|error| {
        LoadError(format!(
            "Fase D: nao foi possivel gravar NodeGraph canônico em '{}': {}",
            graph_path.display(),
            error
        ))
    })?;
    logic.graph = None;
    logic.graph_ref = Some(graph_ref.clone());
    logic.graph_origin = Some("imported_ref".to_string());
    let mat_class =
        scan.graph_materialization_class_for_sprite_role(is_primary_sprite, secondary_local_spr);
    let confidence = if matches!(
        mat_class,
        Some("run_and_gun_horizontal_signals")
            | Some("shmup_vertical_signals")
            | Some("hybrid_action_scroll_signals")
    ) {
        "high"
    } else if matches!(
        mat_class,
        Some("platformer_horizontal_scroller_signals") | Some("beat_em_up_close_range_signals")
    ) || secondary_local_spr
    {
        "medium"
    } else {
        "low"
    };
    let mut external_source_refs = semantic_profile.source_paths.clone();
    if is_primary_sprite {
        external_source_refs.extend(scan.donor_logic_scanned_paths.clone());
    }
    if external_source_refs.is_empty() {
        external_source_refs.extend(scan.donor_logic_scanned_paths.clone());
    }
    for rel in external_source_refs {
        logic.external_source_refs.push(rel);
    }
    logic.external_source_refs.sort();
    logic.external_source_refs.dedup();
    logic.imported_semantics = Some(ImportedLogicSemantics {
        source: "sgdk_phase_d".to_string(),
        gameplay_class: mat_class.unwrap_or("").to_string(),
        entity_role: semantic_profile.entity_role.clone(),
        confidence: confidence.to_string(),
        role_reason: semantic_profile.role_reason.clone(),
        driver_functions: semantic_profile.driver_functions.clone(),
        source_paths: semantic_profile.source_paths.clone(),
        audit_flags: semantic_profile.audit_flags.clone(),
    });
    let mut evidence_refs = scan.entity_resource_source_refs(resource_name);
    if evidence_refs.is_empty() {
        evidence_refs = scan.generic_phase_d_evidence(8);
    }
    for ev in evidence_refs.iter().take(4) {
        logic.logic_hints.push(format!(
            "Fase D evid: {}:{} {} {} | {}",
            ev.rel_path, ev.line, ev.kind, ev.subject, ev.snippet
        ));
    }
    logic.logic_hints.push(format!(
        "Fase D: papel importado desta entidade: '{}' ({})",
        semantic_profile.entity_role, semantic_profile.role_reason
    ));
    if !semantic_profile.driver_functions.is_empty() {
        logic.logic_hints.push(format!(
            "Fase D: funcoes condutoras inferidas para esta entidade: {}.",
            semantic_profile.driver_functions.join(", ")
        ));
    }
    if !semantic_profile.source_paths.is_empty() {
        logic.logic_hints.push(format!(
            "Fase D: external_source_refs prioriza caminho(s) com sinal direto desta entidade: {}.",
            semantic_profile.source_paths.join(", ")
        ));
    }
    if is_primary_sprite {
        let scan_src_hint = if scan.donor_logic_scanned_paths.len() > 1 {
            format!(
                "Fase D: scan textual agregado em {} ficheiro(s) do doador: {}.",
                scan.donor_logic_scanned_paths.len(),
                scan.donor_logic_scanned_paths.join(", ")
            )
        } else {
            "Fase D: scan textual limitado ao(s) ficheiro(s) listado(s) em external_source_refs."
                .into()
        };
        logic.logic_hints.push(scan_src_hint);
        if scan.joy_read_detected {
            logic.logic_hints.push(
                "Fase D: padraio JOY_readJoypad/JOY_read reconhecido no agregado do doador; InputComponent materializado no sprite primario.".into(),
            );
        }
        if scan.map_scroll_h_detected {
            logic.logic_hints.push(
                "Fase D: padraio MAP_scrollH reconhecido; scroll horizontal encadeado em scroll_tilemap.".into(),
            );
        }
        if scan.map_scroll_v_detected {
            logic.logic_hints.push(
                "Fase D: padraio MAP_scrollV reconhecido; scroll vertical encadeado em scroll_tilemap.".into(),
            );
        }
        if scan.busy_loop_detected {
            logic.logic_hints.push(
                "Fase D: laco infinito (while(1)/while(true/for(;;)) observado no agregado do doador — semantica tipica de loop de gameplay SGDK.".into(),
            );
        }
        if scan.vblank_sync_detected {
            logic.logic_hints.push(
                "Fase D: sincronismo vertical (SYS_doVBlankProcess/VDP_waitVSync/VDP_waitDMACompletion) observado no agregado do doador.".into(),
            );
        }
        if scan.spr_engine_detected {
            logic.logic_hints.push(
                "Fase D: API de sprites SGDK (SPR_addSprite/SPR_setPosition/SPR_update/SPR_init) observada — padrao plataforma/run-and-gun/shmup com update por frame.".into(),
            );
        }
        if let Some(class) = scan.heuristic_gameplay_class() {
            logic.logic_hints.push(format!(
                "Fase D: heuristica de classe de gameplay (nao certificada): '{}'.",
                class
            ));
        }
        if !scan.joy_read_detected && !scan.map_scroll_any() {
            logic.logic_hints.push(
                "Fase D: nenhum padrao distintivo (JOY_* / MAP_scroll*) no agregado do doador; grafo base mantido.".into(),
            );
        }
        if matches!(
            scan.primary_graph_materialization_class(),
            Some("run_and_gun_horizontal_signals")
                | Some("shmup_vertical_signals")
                | Some("hybrid_action_scroll_signals")
        ) {
            logic.logic_hints.push(
                "Fase D: heuristica de alta confianca — stencil extra (movimento + action_sound 'fire') materializado no grafo do sprite primario.".into(),
            );
            if scan.audio_playback_any() {
                let families = scan.detected_audio_apis().join(", ");
                logic.logic_hints.push(format!(
                    "Fase D: stencil 'fire_hint' tem apoio textual — familia(s) de audio detectada(s) no doador: {}. Evidencia heuristica, nao e decodificacao semantica.",
                    families
                ));
            } else {
                logic.logic_hints.push(
                    "Fase D: stencil 'fire_hint' materializado sem evidencia textual de playback (nenhuma chamada XGM_*/SND_*/PSG_* no agregado do doador) — marcar como hipotese no editor canonico."
                        .into(),
                );
            }
        } else if scan.audio_playback_any() {
            let families = scan.detected_audio_apis().join(", ");
            logic.logic_hints.push(format!(
                "Fase D: familia(s) de audio detectada(s) no doador sem classe de gameplay de alta confianca: {}. Sinal registrado no ledger sem materializar stencil extra.",
                families
            ));
        }
        logic.logic_hints.push(
            "Fase D: codigo SGDK original permanece em C externo; graph canônico nao e round-trip textual."
                .into(),
        );
        logic.logic_hints.push(format!(
            "Fase D: grafo desta entidade persistido em '{}' (reimport sobrescreve o mesmo ficheiro).",
            graph_ref
        ));
        if scan.joy_read_detected {
            entity.components.input = Some(InputComponent {
                device: "joypad_1".into(),
                mapping: HashMap::from([
                    ("move_left".into(), "DPAD_LEFT".into()),
                    ("move_right".into(), "DPAD_RIGHT".into()),
                    ("jump".into(), "BUTTON_C".into()),
                ]),
            });
        }
    } else {
        logic.logic_hints.push(
            "Fase D: padroes globais de src/main.c estao detalhados no sprite primario e no ledger.phase_d; esta entidade partilha o mesmo scan textual.".into(),
        );
        logic.logic_hints.push(format!(
            "Fase D: grafo desta entidade persistido em '{}'.",
            graph_ref
        ));
        if secondary_local_spr {
            if let Some(rel) = scan.entity_resource_spr_touch_rel(resource_name) {
                logic.logic_hints.push(format!(
                    "Fase D: linha SPR_* no doador ('{}') partilha identificador '{}' com este recurso — materializacao de stencil alinhada ao scan (nao e comportamento C original).",
                    rel,
                    sgdk_entity_id(resource_name)
                ));
            }
        }
    }
    let mut rules_hit = Vec::new();
    if scan.joy_read_detected {
        rules_hit.push("joy_read".to_string());
    }
    if scan.map_scroll_h_detected {
        rules_hit.push("map_scroll_h".to_string());
    }
    if scan.map_scroll_v_detected {
        rules_hit.push("map_scroll_v".to_string());
    }
    if scan.spr_engine_detected {
        rules_hit.push("spr_engine".to_string());
    }
    if secondary_local_spr {
        rules_hit.push("secondary_local_spr_signal".to_string());
    }
    if is_primary_sprite {
        rules_hit.push("primary_sprite".to_string());
    }
    if !semantic_profile.entity_role.is_empty() {
        rules_hit.push(format!("entity_role:{}", semantic_profile.entity_role));
    };
    phase_d_result.graph_ref = graph_ref;
    phase_d_result.source_refs = evidence_refs;
    phase_d_result.confidence = confidence.to_string();
    phase_d_result.applied_class = mat_class
        .map(|c| match c {
            "hybrid_action_scroll_signals" => "hybrid_action",
            "run_and_gun_horizontal_signals" => "run_and_gun",
            "shmup_vertical_signals" => "shmup",
            "beat_em_up_close_range_signals" => "beat_em_up",
            "platformer_horizontal_scroller_signals" => "platformer",
            _ => "none",
        })
        .unwrap_or("none")
        .to_string();
    phase_d_result.entity_role = semantic_profile.entity_role;
    phase_d_result.role_reason = semantic_profile.role_reason;
    phase_d_result.driver_functions = semantic_profile.driver_functions;
    phase_d_result.source_paths = semantic_profile.source_paths.clone();
    phase_d_result.rules_hit = rules_hit;
    Ok(phase_d_result)
}

/// Agrupamento canonico de camadas de editor para cenas importadas do SGDK.
///
/// A Fase B materializa apenas o que foi observado no doador: nao inventamos
/// parallax/HUD quando nao ha sinal estrutural para isso. As camadas emitidas sao:
/// - `background` (kind=`tile`): entidades com `TilemapComponent`
/// - `gameplay` (kind=`sprite`): entidades com `SpriteComponent` + camera
/// - `audio_objects` (kind=`object`): audio bank (opcional)
fn derive_sgdk_scene_layers(
    tilemap_entity_ids: &[String],
    sprite_entity_ids: &[String],
    camera_entity_ids: &[String],
    audio_entity_ids: &[String],
) -> Option<Vec<SceneLayer>> {
    let mut layers: Vec<SceneLayer> = Vec::new();

    if !tilemap_entity_ids.is_empty() {
        layers.push(SceneLayer {
            id: "layer_background".to_string(),
            name: "Cenario / Background".to_string(),
            kind: "tile".to_string(),
            visible: true,
            locked: false,
            depth: 0,
            entity_ids: tilemap_entity_ids.to_vec(),
        });
    }

    if !sprite_entity_ids.is_empty() || !camera_entity_ids.is_empty() {
        let mut entity_ids = Vec::with_capacity(sprite_entity_ids.len() + camera_entity_ids.len());
        entity_ids.extend(sprite_entity_ids.iter().cloned());
        entity_ids.extend(camera_entity_ids.iter().cloned());
        layers.push(SceneLayer {
            id: "layer_gameplay".to_string(),
            name: "Gameplay".to_string(),
            kind: "sprite".to_string(),
            visible: true,
            locked: false,
            depth: 10,
            entity_ids,
        });
    }

    if !audio_entity_ids.is_empty() {
        layers.push(SceneLayer {
            id: "layer_audio_objects".to_string(),
            name: "Audio".to_string(),
            kind: "object".to_string(),
            visible: true,
            locked: true,
            depth: 20,
            entity_ids: audio_entity_ids.to_vec(),
        });
    }

    if layers.is_empty() {
        None
    } else {
        Some(layers)
    }
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

pub fn import_sgdk_project(
    project_dir: &Path,
    sgdk_path: &Path,
) -> Result<SgdkImportReport, LoadError> {
    let resolved_root = resolve_sgdk_import_root(sgdk_path)?;
    validate_sgdk_project_path(&resolved_root.effective_root)?;
    let resources = load_sgdk_resources(&resolved_root.effective_root)?;
    import_sgdk_resources_into_scene(
        project_dir,
        sgdk_path,
        &resolved_root,
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
        let legacy_resolved_root = SgdkResolvedImportRoot {
            requested_root: sgdk_root.to_path_buf(),
            effective_root: sgdk_root.to_path_buf(),
            resolution_kind: "direct".to_string(),
            warnings: Vec::new(),
            suggestions: Vec::new(),
        };
        import_sgdk_resources_into_scene(
            &overlay_dir,
            sgdk_root,
            &legacy_resolved_root,
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

struct SgdkTilemapMaterialization {
    entity: Entity,
    entity_id: String,
    display_name: String,
    cells_count: usize,
    unique_tiles: u32,
    had_cells: bool,
}

#[allow(clippy::too_many_arguments)]
fn build_sgdk_tilemap_entity(
    resource: &SgdkResourceEntry,
    destination: &str,
    source_path: &Path,
    fallbacks: &mut Vec<String>,
) -> SgdkTilemapMaterialization {
    let hud_overlay_hint = sgdk_resource_hud_overlay_hint(resource);
    let base_entity_id = format!("{}_tilemap", sgdk_entity_id(&resource.name));
    let entity_id = if hud_overlay_hint {
        format!("hud_{}", base_entity_id)
    } else {
        base_entity_id
    };
    let display_name = resource.name.clone();

    let (map_width, map_height, cells, unique_tiles, had_cells) = match extract_sgdk_tilemap_cells(
        source_path,
    ) {
        Some(extracted) => (
            extracted.map_width,
            extracted.map_height,
            extracted.cells,
            extracted.unique_tiles,
            true,
        ),
        None => {
            let (mw, mh) = tilemap_dims_from_source(source_path);
            fallbacks.push(format!(
                "tilemap '{}': cells[] vazio (PNG indisponivel, <8x8 ou totalmente transparente).",
                resource.name
            ));
            (mw, mh, Vec::new(), 0, false)
        }
    };
    let cells_count = cells.len();

    let entity = Entity {
        entity_id: entity_id.clone(),
        display_name: Some(display_name.clone()),
        prefab: None,
        transform: crate::ugdm::entities::Transform { x: 0, y: 0 },
        components: Components {
            tilemap: Some(TilemapComponent {
                tileset: destination.to_string(),
                map_width,
                map_height,
                scroll_x: 0,
                scroll_y: 0,
                cells,
            }),
            logic: if hud_overlay_hint {
                Some(LogicComponent {
                    graph: None,
                    graph_ref: None,
                    graph_origin: None,
                    logic_hints: vec!["sgdk_import:hud_overlay".to_string()],
                    external_source_refs: Vec::new(),
                    imported_semantics: None,
                    variables: HashMap::new(),
                })
            } else {
                None
            },
            ..Components::default()
        },
    };

    SgdkTilemapMaterialization {
        entity,
        entity_id,
        display_name,
        cells_count,
        unique_tiles,
        had_cells,
    }
}

fn sgdk_scene_slug_from_display(display: &str) -> String {
    let mut slug = String::new();
    for ch in display.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
        } else if ch == '_' || ch == '-' || ch == ' ' {
            slug.push('_');
        }
    }
    let trimmed = slug.trim_matches('_').to_string();
    if trimmed.is_empty() {
        "scene".to_string()
    } else {
        trimmed
    }
}

fn import_sgdk_resources_into_scene(
    project_dir: &Path,
    requested_sgdk_path: &Path,
    resolved_root: &SgdkResolvedImportRoot,
    resources: &[SgdkResourceEntry],
    materialization: SgdkAssetMaterialization,
    scene_name: &str,
) -> Result<SgdkImportReport, LoadError> {
    let sgdk_path = resolved_root.effective_root.as_path();
    let mut imported_tilemaps: HashSet<String> = HashSet::new();
    let mut audio_sfx: HashMap<String, String> = HashMap::new();
    let mut audio_bgm: Option<String> = None;
    let mut first_sprite_id: Option<String> = None;
    let mut tilemap_slots: Vec<SgdkTilemapMaterialization> = Vec::new();
    let mut sprite_entities: Vec<Entity> = Vec::new();

    let mut skipped_sources: Vec<SgdkSkippedSource> = Vec::new();
    let mut warnings: Vec<String> = resolved_root.warnings.clone();
    let mut fallbacks: Vec<String> = Vec::new();
    let mut mappings: Vec<SgdkImportMapping> = Vec::new();

    for resource in resources {
        let Some(destination) = sgdk_asset_destination(&resource.kind, &resource.asset_path) else {
            let reason = match resource.kind.as_str() {
                "VGM" => "ForbiddenFormat",
                _ => "UnsupportedKind",
            };
            skipped_sources.push(SgdkSkippedSource {
                source: format!("{} {}", resource.kind, resource.name),
                reason: reason.to_string(),
                detail: format!(
                    "Recurso '{}' do tipo '{}' nao possui destino canonico no importador SGDK.",
                    resource.name, resource.kind
                ),
            });
            continue;
        };

        let source_path = sgdk_resource_source_path(sgdk_path, &resource.asset_path);
        if !source_path.is_file() {
            if resource.kind == "VGM" {
                skipped_sources.push(SgdkSkippedSource {
                    source: format!("{} {}", resource.kind, resource.name),
                    reason: "MissingAsset".to_string(),
                    detail: format!(
                        "Asset VGM '{}' nao foi localizado no doador; recurso ignorado.",
                        source_path.display()
                    ),
                });
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

        let source_relative = source_path
            .strip_prefix(sgdk_path)
            .ok()
            .map(normalize_relative_path)
            .unwrap_or_else(|| source_path.display().to_string());

        mappings.push(SgdkImportMapping {
            resource_kind: resource.kind.clone(),
            resource_name: resource.name.clone(),
            source_relative,
            destination: destination.clone(),
        });

        match resource.kind.as_str() {
            "SPRITE" => {
                let entity_id = sgdk_entity_id(&resource.name);
                if first_sprite_id.is_none() {
                    first_sprite_id = Some(entity_id.clone());
                }
                let derived = derive_sgdk_sprite_sheet_from_rescomp_png(
                    &source_path,
                    &resource.name,
                    &resource.params,
                );
                for note in &derived.notes {
                    fallbacks.push(note.clone());
                }
                if derived.animations.is_empty() {
                    fallbacks.push(format!(
                        "sprite '{}': animations vazias apos derivacao (parametros ou PNG incompativeis com rescomp SPRITE).",
                        resource.name
                    ));
                }
                let is_meta = derived.frame_width > 32 || derived.frame_height > 32;
                let hud_overlay_hint = sgdk_resource_hud_overlay_hint(resource);
                sprite_entities.push(Entity {
                    entity_id,
                    display_name: Some(resource.name.clone()),
                    prefab: None,
                    transform: crate::ugdm::entities::Transform { x: 32, y: 32 },
                    components: Components {
                        sprite: Some(SpriteComponent {
                            asset: destination,
                            frame_width: derived.frame_width,
                            frame_height: derived.frame_height,
                            pivot: None,
                            palette_slot: 0,
                            animations: derived.animations,
                            priority: if hud_overlay_hint {
                                "ui_overlay".to_string()
                            } else {
                                "foreground".to_string()
                            },
                            meta_sprite: is_meta,
                        }),
                        logic: Some(LogicComponent {
                            graph: Some(imported_sprite_logic_graph(&resource.name)),
                            graph_ref: None,
                            graph_origin: None,
                            logic_hints: if hud_overlay_hint {
                                vec![
                                    "sgdk_import:hud_overlay".to_string(),
                                    "sgdk_import:canonical_hud_signal".to_string(),
                                ]
                            } else {
                                Vec::new()
                            },
                            external_source_refs: Vec::new(),
                            imported_semantics: None,
                            variables: HashMap::new(),
                        }),
                        ..Components::default()
                    },
                });
            }
            "IMAGE" | "TILESET" | "TILEMAP" | "MAP" => {
                if imported_tilemaps.insert(destination.clone()) {
                    let slot = build_sgdk_tilemap_entity(
                        resource,
                        &destination,
                        &source_path,
                        &mut fallbacks,
                    );
                    tilemap_slots.push(slot);
                } else {
                    warnings.push(format!(
                        "Tilemap '{}' reusa destino '{}' ja importado; entidade nao duplicada.",
                        resource.name, destination
                    ));
                }
            }
            "WAV" | "PCM" => {
                audio_sfx.insert(resource.name.clone(), destination);
            }
            "XGM" | "XGM2" => {
                if audio_bgm.is_none() {
                    audio_bgm = Some(destination);
                } else {
                    warnings.push(format!(
                        "BGM '{}' ignorada: projeto ja possui trilha principal materializada.",
                        resource.name
                    ));
                }
            }
            other => {
                warnings.push(format!(
                    "Recurso SGDK '{}' de tipo '{}' materializado como asset generico.",
                    resource.name, other
                ));
            }
        }
    }

    let donor_logic_scan = scan_sgdk_donor_logic_scan(sgdk_path);
    let mut phase_d_ledger = SgdkImportLedgerPhaseD {
        detected_main_c_token_groups: donor_logic_scan.ledger_token_groups(),
        donor_logic_scanned_paths: donor_logic_scan.donor_logic_scanned_paths.clone(),
        heuristic_gameplay_class: donor_logic_scan.heuristic_gameplay_class(),
        logic_graph_refs: Vec::new(),
        cross_unit_function_refs: donor_logic_scan.cross_unit_function_refs.clone(),
        entity_spr_local_signal_hits: Vec::new(),
        detected_audio_apis: donor_logic_scan.detected_audio_apis(),
        entity_trace: Vec::new(),
    };
    for ent in &sprite_entities {
        let resource_name = ent
            .display_name
            .clone()
            .unwrap_or_else(|| ent.entity_id.clone());
        if let Some(rel) = donor_logic_scan.entity_resource_spr_touch_rel(&resource_name) {
            let hit = format!("{}@{}", sgdk_entity_id(&resource_name), rel);
            phase_d_ledger.entity_spr_local_signal_hits.push(hit);
        }
    }
    phase_d_ledger.entity_spr_local_signal_hits.sort();
    phase_d_ledger.entity_spr_local_signal_hits.dedup();
    for (idx, ent) in sprite_entities.iter_mut().enumerate() {
        let resource_name = ent
            .display_name
            .clone()
            .unwrap_or_else(|| ent.entity_id.clone());
        let secondary_local_spr = idx != 0
            && donor_logic_scan
                .entity_resource_spr_touch_rel(&resource_name)
                .is_some();
        let phase_d_entity = apply_sgdk_phase_d_to_sprite_entity(
            project_dir,
            ent,
            &resource_name,
            &donor_logic_scan,
            idx == 0,
            secondary_local_spr,
        )?;
        if !phase_d_entity.graph_ref.is_empty() {
            phase_d_ledger
                .logic_graph_refs
                .push(phase_d_entity.graph_ref.clone());
            phase_d_ledger
                .entity_trace
                .push(SgdkImportLedgerPhaseDEntityTrace {
                    entity_id: ent.entity_id.clone(),
                    graph_ref: phase_d_entity.graph_ref,
                    source_refs: phase_d_entity.source_refs,
                    confidence: phase_d_entity.confidence,
                    applied_class: phase_d_entity.applied_class,
                    entity_role: phase_d_entity.entity_role,
                    role_reason: phase_d_entity.role_reason,
                    driver_functions: phase_d_entity.driver_functions,
                    source_paths: phase_d_entity.source_paths,
                    rules_hit: phase_d_entity.rules_hit,
                });
        }
    }
    phase_d_ledger.logic_graph_refs.sort();
    phase_d_ledger.logic_graph_refs.dedup();
    phase_d_ledger
        .entity_trace
        .sort_by(|a, b| a.entity_id.cmp(&b.entity_id));
    let staged_sprite_count = apply_sgdk_authoring_staging_layout(&mut sprite_entities);
    if staged_sprite_count > 0 {
        fallbacks.push(format!(
            "authoring_staging: {} sprite(s) redistribuidos em shelf/lane de autoria porque o donor SGDK nao forneceu coordenadas confiaveis de cena; cada entidade foi marcada com audit_flag 'position:staging_layout'.",
            staged_sprite_count
        ));
    } else if !sprite_entities.is_empty() {
        fallbacks.push(
            "authoring_position: importacao SGDK manteve posicoes inferidas do bootstrap atual; entidades permanecem marcadas com audit_flag 'position:inferred' enquanto nao houver coordenadas reais do donor."
                .to_string(),
        );
    }

    // -- cena primaria: primeiro tilemap + todos os sprites + audio + camera
    let mut primary_scene = canonical_scene(DEFAULT_SCENE_ID, Some(scene_name.to_string()));
    let mut primary_tilemap_ids: Vec<String> = Vec::new();
    let mut primary_sprite_ids: Vec<String> = Vec::new();
    let mut primary_camera_ids: Vec<String> = Vec::new();
    let mut primary_audio_ids: Vec<String> = Vec::new();

    let mut tilemap_iter = tilemap_slots.into_iter();
    let primary_tilemap = tilemap_iter.next();
    let extra_tilemaps: Vec<SgdkTilemapMaterialization> = tilemap_iter.collect();

    let primary_tilemap_stats = primary_tilemap
        .as_ref()
        .map(|slot| (slot.cells_count, slot.unique_tiles, slot.had_cells));

    if let Some(slot) = primary_tilemap {
        primary_tilemap_ids.push(slot.entity_id.clone());
        primary_scene.entities.push(slot.entity);
    }

    for entity in sprite_entities.drain(..) {
        primary_sprite_ids.push(entity.entity_id.clone());
        primary_scene.entities.push(entity);
    }

    if !audio_sfx.is_empty() || audio_bgm.is_some() {
        let audio_id = "audio_bank".to_string();
        primary_audio_ids.push(audio_id.clone());
        primary_scene.entities.push(Entity {
            entity_id: audio_id,
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

    if let Some(follow_entity) = first_sprite_id.clone() {
        let camera_id = "main_camera".to_string();
        primary_camera_ids.push(camera_id.clone());
        primary_scene.entities.push(Entity {
            entity_id: camera_id,
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

    primary_scene.layers = derive_sgdk_scene_layers(
        &primary_tilemap_ids,
        &primary_sprite_ids,
        &primary_camera_ids,
        &primary_audio_ids,
    );

    let mut phase_c_ledger = SgdkImportLedgerPhaseC::default();
    if let Some(tid) = primary_tilemap_ids.first() {
        if let Some(ent) = primary_scene
            .entities
            .iter()
            .find(|entity| entity.entity_id == *tid)
        {
            if let Some(tm) = ent.components.tilemap.as_ref() {
                if tm.cells.is_empty() {
                    fallbacks.push(
                        "Fase C: collision_map nao derivado (tilemap primario com cells[] vazio)."
                            .into(),
                    );
                } else if let Some((cmap, note)) = derive_sgdk_scene_collision_map_from_tile_cells(
                    &tm.cells,
                    tm.map_width,
                    tm.map_height,
                ) {
                    phase_c_ledger.collision_derivation_rule = Some("nonzero_tile_index".into());
                    phase_c_ledger.primary_collision_solid_cells =
                        Some(cmap.data.iter().filter(|&&value| value != 0).count() as u64);
                    primary_scene.collision_map = Some(cmap);
                    fallbacks.push(note);
                }
            }
        }
    } else {
        fallbacks
            .push("Fase C: collision_map nao derivado (cena primaria sem tilemap anchor).".into());
    }

    if let Some(sid) = primary_sprite_ids.first() {
        if let Some(ent) = primary_scene
            .entities
            .iter()
            .find(|entity| &entity.entity_id == sid)
        {
            if let Some(sprite) = ent.components.sprite.as_ref() {
                phase_c_ledger.primary_sprite_animation_rows = Some(sprite.animations.len() as u32);
                phase_c_ledger.primary_sprite_animation_names =
                    sprite.animations.keys().cloned().collect();
            }
        }
    }

    save_scene(project_dir, DEFAULT_ENTRY_SCENE, &primary_scene)?;

    // -- cenas adicionais: cada tilemap anchor extra vira sua propria cena canonica
    let mut additional_scene_descriptors: Vec<SgdkImportedSceneDescriptor> = Vec::new();
    let mut additional_ledger_entries: Vec<SgdkImportLedgerScene> = Vec::new();
    let mut used_slugs: HashSet<String> = HashSet::new();
    used_slugs.insert(DEFAULT_SCENE_ID.to_string());

    for slot in extra_tilemaps {
        let base_slug = sgdk_scene_slug_from_display(&slot.display_name);
        let mut scene_id = base_slug.clone();
        let mut disambiguator = 2u32;
        while !used_slugs.insert(scene_id.clone()) {
            scene_id = format!("{}_{}", base_slug, disambiguator);
            disambiguator += 1;
        }
        let scene_path = format!("scenes/{}.json", scene_id);
        let mut extra_scene =
            canonical_scene(&scene_id, Some(format!("{} (SGDK)", slot.display_name)));
        let tilemap_ids = vec![slot.entity_id.clone()];
        let extra_collision = slot.entity.components.tilemap.as_ref().and_then(|tm| {
            if tm.cells.is_empty() {
                None
            } else {
                derive_sgdk_scene_collision_map_from_tile_cells(
                    &tm.cells,
                    tm.map_width,
                    tm.map_height,
                )
            }
        });
        extra_scene.entities.push(slot.entity);
        if let Some((cmap, note)) = extra_collision {
            extra_scene.collision_map = Some(cmap);
            fallbacks.push(format!("Fase C [{}]: {}", scene_id, note));
        }
        extra_scene.layers = derive_sgdk_scene_layers(&tilemap_ids, &[], &[], &[]);
        save_scene(project_dir, &scene_path, &extra_scene)?;

        let descriptor = SgdkImportedSceneDescriptor {
            scene_id: scene_id.clone(),
            display_name: slot.display_name.clone(),
            scene_path: scene_path.clone(),
            entity_count: extra_scene.entities.len(),
            tilemap_cells: slot.cells_count,
            tilemap_unique_tiles: slot.unique_tiles,
        };
        additional_ledger_entries.push(SgdkImportLedgerScene {
            scene_id,
            display_name: slot.display_name,
            scene_path,
            role: "secondary_tilemap".to_string(),
            entity_count: extra_scene.entities.len(),
            tilemap_cells: slot.cells_count,
            tilemap_unique_tiles: slot.unique_tiles,
        });
        additional_scene_descriptors.push(descriptor);
    }

    let manifest_paths = find_sgdk_manifest_paths(sgdk_path).unwrap_or_default();
    let manifests_relative: Vec<String> = manifest_paths
        .iter()
        .map(|path| {
            path.strip_prefix(sgdk_path)
                .ok()
                .map(normalize_relative_path)
                .unwrap_or_else(|| path.display().to_string())
        })
        .collect();
    let fingerprint = compute_sgdk_donor_fingerprint(sgdk_path, &manifest_paths);
    let resources_total = resources.len();
    let resources_accepted = mappings.len();
    let resources_skipped = skipped_sources.len();

    let source_summary = SgdkSourceSummary {
        donor_root: requested_sgdk_path.to_string_lossy().to_string(),
        effective_root: sgdk_path.to_string_lossy().to_string(),
        resolution_kind: resolved_root.resolution_kind.clone(),
        resolution_warnings: resolved_root.warnings.clone(),
        resolution_suggestions: resolved_root.suggestions.clone(),
        manifests: manifests_relative.clone(),
        resources_total,
        resources_accepted,
        resources_skipped,
        fingerprint: fingerprint.clone(),
    };

    let primary_cells_count = primary_tilemap_stats
        .map(|(count, _, _)| count)
        .unwrap_or(0);
    let primary_unique_tiles = primary_tilemap_stats
        .map(|(_, unique, _)| unique)
        .unwrap_or(0);
    let primary_had_cells = primary_tilemap_stats
        .map(|(_, _, had)| had)
        .unwrap_or(false);
    if primary_had_cells {
        // emitido apenas como nota informativa em warnings? Nao — sucesso fica implicito.
    }

    let primary_ledger_entry = SgdkImportLedgerScene {
        scene_id: primary_scene.scene_id.clone(),
        display_name: primary_scene
            .display_name
            .clone()
            .unwrap_or_else(|| scene_name.to_string()),
        scene_path: DEFAULT_ENTRY_SCENE.to_string(),
        role: "primary".to_string(),
        entity_count: primary_scene.entities.len(),
        tilemap_cells: primary_cells_count,
        tilemap_unique_tiles: primary_unique_tiles,
    };
    let mut ledger_scenes: Vec<SgdkImportLedgerScene> =
        Vec::with_capacity(1 + additional_ledger_entries.len());
    ledger_scenes.push(primary_ledger_entry);
    ledger_scenes.extend(additional_ledger_entries);

    let manifest_path = write_sgdk_import_ledger(
        project_dir,
        requested_sgdk_path,
        sgdk_path,
        &resolved_root.resolution_kind,
        &primary_scene.scene_id,
        &fingerprint,
        &manifests_relative,
        &mappings,
        &skipped_sources,
        &warnings,
        &fallbacks,
        &ledger_scenes,
        &phase_c_ledger,
        &phase_d_ledger,
    )?;

    let imported_scenes = 1 + additional_scene_descriptors.len();

    Ok(SgdkImportReport {
        primary_scene,
        imported_scenes,
        skipped_sources,
        warnings,
        fallbacks,
        source_summary,
        manifest_path: Some(manifest_path),
        primary_scene_path: DEFAULT_ENTRY_SCENE.to_string(),
        additional_scenes: additional_scene_descriptors,
    })
}

fn sgdk_donor_slug(donor_path: &Path) -> String {
    let raw = donor_path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "donor".to_string());
    let mut slug = String::new();
    for character in raw.chars() {
        if character.is_ascii_alphanumeric() {
            slug.push(character.to_ascii_lowercase());
        } else {
            slug.push('_');
        }
    }
    let trimmed = slug.trim_matches('_').to_string();
    if trimmed.is_empty() {
        "donor".to_string()
    } else {
        trimmed
    }
}

fn compute_sgdk_donor_fingerprint(donor_path: &Path, manifest_paths: &[PathBuf]) -> String {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();

    let mut entries: Vec<(String, u64, u128)> = Vec::new();
    for path in manifest_paths {
        let rel = path
            .strip_prefix(donor_path)
            .ok()
            .map(normalize_relative_path)
            .unwrap_or_else(|| path.display().to_string());
        let (size, mtime_ms) = match fs::metadata(path) {
            Ok(metadata) => {
                let size = metadata.len();
                let mtime = metadata
                    .modified()
                    .ok()
                    .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                    .map(|duration| duration.as_millis())
                    .unwrap_or(0);
                (size, mtime)
            }
            Err(_) => (0, 0),
        };
        entries.push((rel, size, mtime_ms));
    }
    entries.sort();

    for (rel, size, mtime_ms) in entries {
        rel.hash(&mut hasher);
        size.hash(&mut hasher);
        mtime_ms.hash(&mut hasher);
    }

    format!("{:016x}", hasher.finish())
}

#[allow(clippy::too_many_arguments)]
fn write_sgdk_import_ledger(
    project_dir: &Path,
    donor_path: &Path,
    effective_root: &Path,
    resolution_kind: &str,
    scene_id: &str,
    fingerprint: &str,
    manifests: &[String],
    mappings: &[SgdkImportMapping],
    skipped_sources: &[SgdkSkippedSource],
    warnings: &[String],
    fallbacks: &[String],
    scenes: &[SgdkImportLedgerScene],
    phase_c: &SgdkImportLedgerPhaseC,
    phase_d: &SgdkImportLedgerPhaseD,
) -> Result<String, LoadError> {
    let ledger_dir = project_dir.join(SGDK_IMPORT_LEDGER_DIR);
    fs::create_dir_all(&ledger_dir).map_err(|error| {
        LoadError(format!(
            "Nao foi possivel criar diretorio de ledger SGDK '{}': {}",
            ledger_dir.display(),
            error
        ))
    })?;

    let donor_basename = donor_path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "donor".to_string());
    let slug = sgdk_donor_slug(donor_path);
    let file_name = format!("{}.json", slug);
    let ledger_path = ledger_dir.join(&file_name);
    let relative = format!("{}/{}", SGDK_IMPORT_LEDGER_DIR, file_name);

    let now_unix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);

    let mut history: Vec<SgdkImportLedgerHistoryEntry> = Vec::new();
    if ledger_path.is_file() {
        if let Ok(existing) = fs::read_to_string(&ledger_path) {
            if let Ok(prev) = serde_json::from_str::<SgdkImportLedger>(&existing) {
                history = prev.history.clone();
                // Preserva a fotografia anterior se o fingerprint mudou.
                if prev.fingerprint != fingerprint
                    && !history
                        .iter()
                        .any(|entry| entry.fingerprint == prev.fingerprint)
                {
                    history.push(SgdkImportLedgerHistoryEntry {
                        timestamp_unix: prev.last_imported_at_unix,
                        fingerprint: prev.fingerprint.clone(),
                    });
                }
            }
        }
    }

    let ledger = SgdkImportLedger {
        schema_version: SGDK_IMPORT_LEDGER_SCHEMA.to_string(),
        scene_id: scene_id.to_string(),
        donor_root: donor_path.to_string_lossy().to_string(),
        effective_root: effective_root.to_string_lossy().to_string(),
        resolution_kind: resolution_kind.to_string(),
        donor_basename,
        fingerprint: fingerprint.to_string(),
        last_imported_at_unix: now_unix,
        manifests: manifests.to_vec(),
        mappings: mappings.to_vec(),
        skipped_sources: skipped_sources.to_vec(),
        warnings: warnings.to_vec(),
        fallbacks: fallbacks.to_vec(),
        history,
        scenes: scenes.to_vec(),
        phase_c: phase_c.clone(),
        phase_d: phase_d.clone(),
    };

    let serialized = serde_json::to_string_pretty(&ledger).map_err(|error| {
        LoadError(format!(
            "Nao foi possivel serializar ledger SGDK '{}': {}",
            ledger_path.display(),
            error
        ))
    })?;
    fs::write(&ledger_path, serialized).map_err(|error| {
        LoadError(format!(
            "Nao foi possivel salvar ledger SGDK '{}': {}",
            ledger_path.display(),
            error
        ))
    })?;

    Ok(relative)
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
            "O template '{}' requer uma pasta doadora SGDK escolhida manualmente neste host.",
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
                return (true, Some(MANUAL_SGDK_DONOR_REQUIRED_MESSAGE.to_string()));
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

fn collapse_relative_components(path: &Path) -> PathBuf {
    let mut collapsed = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(segment) => collapsed.push(segment),
            Component::ParentDir => {
                collapsed.pop();
            }
            Component::CurDir => {}
            Component::RootDir | Component::Prefix(_) => {}
        }
    }
    collapsed
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

fn sgdk_root_has_manifest(path: &Path) -> bool {
    let direct = path.join("resources.res");
    if direct.is_file() {
        return true;
    }
    let canonical = path.join("res").join("resources.res");
    if canonical.is_file() {
        return true;
    }
    let res_dir = path.join("res");
    if !res_dir.is_dir() {
        return false;
    }
    let Ok(entries) = fs::read_dir(res_dir) else {
        return false;
    };
    entries.flatten().any(|entry| {
        let p = entry.path();
        p.is_file()
            && p.extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("res"))
    })
}

fn extract_backticked_segments(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut inside = false;
    for ch in text.chars() {
        if ch == '`' {
            if inside {
                let trimmed = current.trim();
                if !trimmed.is_empty() {
                    out.push(trimmed.to_string());
                }
                current.clear();
                inside = false;
            } else {
                inside = true;
            }
            continue;
        }
        if inside {
            current.push(ch);
        }
    }
    out
}

fn normalize_declared_path_token(token: &str) -> Option<String> {
    // Nao remover `(` `)` `[` `]` dos extremos: pastas do corpus (e Windows) podem
    // incluir marcadores tipo `[PLATAFORMA]` no nome; trim_matches com `]` corromperia
    // o token (ex.: perdia o `]` final e o path deixava de existir).
    let trimmed = token
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .trim_matches('`')
        .trim_matches(|c: char| matches!(c, ',' | ';' | ':'));
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed.starts_with('.') {
        return Some(trimmed.to_string());
    }
    None
}

fn collect_declared_wrapper_paths(mddev: &MddevProjectMeta, root: &Path) -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    let mut seen = HashSet::new();
    let mut declared: Vec<String> = Vec::new();

    if let Some(value) = mddev.sgdk_root.as_ref() {
        declared.push(value.clone());
    }

    // Apenas `sgdk_root` e segmentos entre backticks em `notes` (sem split por whitespace:
    // caminhos Windows com espacos quebrariam em tokens invalidos como `../PlatformerEngine`).
    if let Some(notes) = mddev.notes.as_ref() {
        declared.extend(extract_backticked_segments(notes));
    }

    let readme_path = root.join("README.md");
    if let Ok(readme) = fs::read_to_string(&readme_path) {
        declared.extend(extract_backticked_segments(&readme));
    }

    for raw in declared {
        let Some(token) = normalize_declared_path_token(&raw) else {
            continue;
        };
        let path = {
            let p = PathBuf::from(&token);
            if p.is_absolute() {
                p
            } else {
                root.join(p)
            }
        };
        let key = path.to_string_lossy().to_string();
        if seen.insert(key) {
            candidates.push(path);
        }
    }

    candidates
}

fn canonicalize_existing_path(path: &Path) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

fn load_mddev_project_meta(root: &Path) -> Result<Option<MddevProjectMeta>, LoadError> {
    let mddev_path = root.join(".mddev").join("project.json");
    if !mddev_path.is_file() {
        return Ok(None);
    }
    let content = fs::read_to_string(&mddev_path).map_err(|error| {
        LoadError(format!(
            "Nao foi possivel ler metadata .mddev em '{}': {}",
            mddev_path.display(),
            error
        ))
    })?;
    let parsed = serde_json::from_str::<MddevProjectMeta>(&content).map_err(|error| {
        LoadError(format!(
            "Metadata .mddev invalida em '{}': {}",
            mddev_path.display(),
            error
        ))
    })?;
    Ok(Some(parsed))
}

fn resolve_sgdk_import_root(requested_root: &Path) -> Result<SgdkResolvedImportRoot, LoadError> {
    let requested_root = requested_root.to_path_buf();
    let requested_canonical = canonicalize_existing_path(&requested_root);
    let mut queue: VecDeque<(PathBuf, usize, bool)> = VecDeque::new();
    let mut visited: HashSet<String> = HashSet::new();
    let mut buildable_candidates: Vec<PathBuf> = Vec::new();
    let mut suggestions: Vec<String> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();

    queue.push_back((requested_root.clone(), 0, false));

    while let Some((current, depth, inherited_reference)) = queue.pop_front() {
        if depth > 2 {
            continue;
        }
        let current = canonicalize_existing_path(&current);
        let current_key = current.to_string_lossy().to_string();
        if !visited.insert(current_key) {
            continue;
        }
        if !current.is_dir() {
            continue;
        }

        let mddev = load_mddev_project_meta(&current)?;
        let is_reference_wrapper = mddev
            .as_ref()
            .map(|meta| {
                let is_reference = meta
                    .kind
                    .as_deref()
                    .map(|kind| kind.eq_ignore_ascii_case("REFERENCE"))
                    .unwrap_or(false);
                let disabled = meta
                    .build_policy
                    .as_deref()
                    .map(|policy| policy.eq_ignore_ascii_case("disabled"))
                    .unwrap_or(false);
                is_reference || disabled
            })
            .unwrap_or(false);
        let has_manifest = sgdk_root_has_manifest(&current);

        if has_manifest && (!is_reference_wrapper || current == requested_canonical) {
            buildable_candidates.push(current.clone());
            continue;
        }

        let mut declared_paths = Vec::new();
        if let Some(meta) = mddev.as_ref() {
            declared_paths = collect_declared_wrapper_paths(meta, &current);
        }
        for candidate in declared_paths {
            let candidate = canonicalize_existing_path(&candidate);
            suggestions.push(candidate.to_string_lossy().to_string());
            if sgdk_root_has_manifest(&candidate) {
                buildable_candidates.push(candidate);
            } else if depth < 2 && candidate.is_dir() {
                queue.push_back((
                    candidate,
                    depth + 1,
                    inherited_reference || is_reference_wrapper,
                ));
            }
        }
    }

    buildable_candidates.sort();
    buildable_candidates.dedup();
    suggestions.sort();
    suggestions.dedup();

    if buildable_candidates.len() == 1 {
        let effective_root = buildable_candidates[0].clone();
        let resolution_kind = if effective_root == requested_canonical {
            "direct"
        } else {
            let requested_meta = load_mddev_project_meta(&requested_root)?;
            let requested_is_reference = requested_meta
                .as_ref()
                .map(|meta| {
                    meta.kind
                        .as_deref()
                        .map(|kind| kind.eq_ignore_ascii_case("REFERENCE"))
                        .unwrap_or(false)
                        || meta
                            .build_policy
                            .as_deref()
                            .map(|policy| policy.eq_ignore_ascii_case("disabled"))
                            .unwrap_or(false)
                })
                .unwrap_or(false);
            if requested_is_reference {
                "mddev_reference_redirect"
            } else {
                "mddev_sgdk_root"
            }
        };
        if resolution_kind != "direct" {
            warnings.push(format!(
                "SGDK root resolvido de '{}' para '{}' via {}.",
                requested_root.display(),
                effective_root.display(),
                resolution_kind
            ));
        }
        return Ok(SgdkResolvedImportRoot {
            requested_root,
            effective_root,
            resolution_kind: resolution_kind.to_string(),
            warnings,
            suggestions,
        });
    }

    if buildable_candidates.is_empty() {
        let suggestion_text = if suggestions.is_empty() {
            "Sem candidatos declarados em .mddev/README.".to_string()
        } else {
            format!("Sugestoes declaradas: {}", suggestions.join(" ; "))
        };
        return Err(LoadError(format!(
            "Projeto SGDK invalido: nenhum manifesto .res foi encontrado em '{}' nem nos caminhos declarados por wrappers (.mddev/README). {}",
            requested_root.display(),
            suggestion_text
        )));
    }

    Err(LoadError(format!(
        "Projeto SGDK ambiguo: multiplos candidatos buildaveis foram encontrados a partir de '{}'. Escolha explicitamente uma raiz SGDK com .res. Candidatos: {}",
        requested_root.display(),
        buildable_candidates
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
            .join(" | ")
    )))
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

fn sgdk_resource_hud_overlay_hint(resource: &SgdkResourceEntry) -> bool {
    let mut signal = String::new();
    signal.push_str(&resource.name.to_lowercase());
    signal.push(' ');
    signal.push_str(&resource.asset_path.to_lowercase());
    signal.push(' ');
    signal.push_str(&resource.kind.to_lowercase());
    signal.push(' ');
    signal.push_str(&resource.params.join(" ").to_lowercase());
    signal.contains("hud")
        || signal.contains("ui_")
        || signal.contains("ui/")
        || signal.contains("overlay")
        || signal.contains("status")
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
                graph_origin: None,
                logic_hints: Vec::new(),
                external_source_refs: Vec::new(),
                imported_semantics: None,
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
                cells: Vec::new(),
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

fn import_mugen_candidate(
    project_dir: &Path,
    candidate: &MugenCandidate,
) -> Result<Vec<Scene>, LoadError> {
    match candidate.kind {
        MugenCandidateKind::Character => {
            import_mugen_character_candidate(project_dir, candidate).map(|scene| vec![scene])
        }
        MugenCandidateKind::Stage => {
            import_mugen_stage_candidate(project_dir, candidate).map(|scene| vec![scene])
        }
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
                .or_else(|| {
                    def_path
                        .file_stem()
                        .map(|value| value.to_string_lossy().to_string())
                })
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
        if files_section.entries.contains_key("sprite")
            && files_section.entries.contains_key("anim")
        {
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
            character_candidates.push((
                score,
                MugenCandidate {
                    kind: MugenCandidateKind::Character,
                    root_dir: root.to_path_buf(),
                    def_path,
                    display_name,
                },
            ));
        }
    }

    if !stage_candidates.is_empty() {
        return Ok(stage_candidates);
    }

    if character_candidates.is_empty() {
        return Ok(Vec::new());
    }

    character_candidates.sort_by_key(|candidate| std::cmp::Reverse(candidate.0));
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
    line.split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_string()
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

fn collect_mugen_character_logic_hints(
    root_dir: &Path,
    files: &MugenIniSection,
) -> Result<Vec<String>, LoadError> {
    let mut hints = Vec::new();
    let mut seen_paths = HashSet::new();
    let mut seen_hints = HashSet::new();

    for (key, relative) in &files.entries {
        let lowered_key = key.to_ascii_lowercase();
        if !matches!(
            lowered_key.as_str(),
            "cmd" | "cns" | "st" | "stcommon" | "state"
        ) && !lowered_key.starts_with("st")
        {
            continue;
        }
        let path = root_dir.join(relative);
        if !path.is_file() {
            continue;
        }
        let normalized_path = path.to_string_lossy().to_string();
        if !seen_paths.insert(normalized_path) {
            continue;
        }

        let content = read_text_lossy(&path)?;
        let relative_label = path
            .strip_prefix(root_dir)
            .ok()
            .map(normalize_relative_path)
            .unwrap_or_else(|| path.display().to_string());
        hints.push(format!(
            "Arquivo MUGEN '{}' preservado como hint explicito.",
            relative_label
        ));

        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with(';') {
                continue;
            }
            let lowered = trimmed.to_ascii_lowercase();
            let candidate = if lowered.starts_with("[command") {
                Some("Define comandos de input em CMD.".to_string())
            } else if lowered.contains("changestate") {
                Some("Usa ChangeState para trocar estados.".to_string())
            } else if lowered.contains("hitdef") {
                Some("Usa HitDef para ataques/dano.".to_string())
            } else if lowered.contains("velset") || lowered.contains("veladd") {
                Some("Controla velocidade com VelSet/VelAdd.".to_string())
            } else if lowered.contains("posadd") || lowered.contains("posset") {
                Some("Ajusta posicao com PosAdd/PosSet.".to_string())
            } else if lowered.contains("playsnd") {
                Some("Aciona audio com PlaySnd.".to_string())
            } else if lowered.contains("helper") {
                Some("Usa Helper para entidades auxiliares.".to_string())
            } else if lowered.starts_with("name =") {
                Some(format!("Comando MUGEN {}.", trimmed))
            } else {
                None
            };

            if let Some(candidate) = candidate {
                let lowered_candidate = candidate.to_ascii_lowercase();
                if seen_hints.insert(lowered_candidate) {
                    hints.push(candidate);
                }
            }
            if hints.len() >= 10 {
                return Ok(hints);
            }
        }
    }

    Ok(hints)
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
    let logic_hints = collect_mugen_character_logic_hints(&candidate.root_dir, files)?;
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
            logic: Some(imported_logic_component(
                Some(imported_mugen_idle_logic_graph(&entity_id)),
                logic_hints,
            )),
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
        scene
            .entities
            .push(mugen_audio_bank_entity("audio_bank", audio_sfx, None));
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

    if let Some(loose_background) =
        discover_loose_background_image(&candidate.root_dir, &candidate.def_path)
    {
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
    let mut scene = canonical_scene(
        &sgdk_entity_id(display_name),
        Some(display_name.to_string()),
    );
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
        let positive = durations
            .iter()
            .copied()
            .filter(|value| *value > 0)
            .collect::<Vec<_>>();
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

fn mugen_collision_component_from_actions(
    actions: &[MugenAirAction],
) -> Option<CollisionComponent> {
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

    let anchor_x = ordered
        .iter()
        .map(|sprite| sprite.axis.x)
        .max()
        .unwrap_or(0)
        .max(0) as u32;
    let anchor_y = ordered
        .iter()
        .map(|sprite| sprite.axis.y)
        .max()
        .unwrap_or(0)
        .max(0) as u32;
    let cell_width = ordered
        .iter()
        .map(|sprite| {
            anchor_x
                + sprite
                    .pixels
                    .width()
                    .saturating_sub(sprite.axis.x.max(0) as u32)
        })
        .max()
        .unwrap_or(32)
        .max(1);
    let cell_height = ordered
        .iter()
        .map(|sprite| {
            anchor_y
                + sprite
                    .pixels
                    .height()
                    .saturating_sub(sprite.axis.y.max(0) as u32)
        })
        .max()
        .unwrap_or(32)
        .max(1);
    let count = ordered.len() as f32;
    let cols = count.sqrt().ceil().max(1.0) as u32;
    let rows = (ordered.len() as u32).div_ceil(cols);
    let mut atlas =
        ImageBuffer::from_pixel(cols * cell_width, rows * cell_height, Rgba([0, 0, 0, 0]));
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
    if let Some(actionno) = section
        .entries
        .get("actionno")
        .and_then(|value| value.parse::<i32>().ok())
    {
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
        mapping.insert(format!("snd_{}_{}", sound.group, sound.sound_no), asset_rel);
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
    Ok(bytes.starts_with(b"ElecbyteSpr") && read_le_u8(&bytes, 15).unwrap_or_default() == 1)
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
    matches.sort_by_key(|candidate| candidate.0);
    Ok(matches)
}

fn parse_mugen_sprite_file_stem(stem: &str) -> Option<(i32, i32)> {
    let normalized = stem.replace('_', "-");
    let (group, image) = normalized.split_once('-')?;
    Some((
        group.trim().parse::<i32>().ok()?,
        image.trim().parse::<i32>().ok()?,
    ))
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
        "sgdk" => {
            import_sgdk_project(project_dir, source_path).map(|report| ExternalImportReport {
                primary_scene: report.primary_scene,
                imported_scenes: report.imported_scenes,
                skipped_sources: report
                    .skipped_sources
                    .into_iter()
                    .map(|skipped| {
                        format!(
                            "[{}] {}: {}",
                            skipped.reason, skipped.source, skipped.detail
                        )
                    })
                    .collect(),
            })
        }
        "mugen" | "ikemen_go" => {
            let report = import_mugen_project(project_dir, source_path)?;
            Ok(ExternalImportReport {
                primary_scene: report.primary_scene,
                imported_scenes: report.imported_scenes,
                skipped_sources: report.skipped_sources,
            })
        }
        "godot" => import_godot_project(project_dir, source_path),
        "construct" => import_construct_project(project_dir, source_path),
        "rpg_maker" => import_rpg_maker_project(project_dir, source_path),
        "openbor" => import_openbor_project(project_dir, source_path),
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
        "construct" => (
            "imported_construct".to_string(),
            "1.0.0".to_string(),
            "imported_construct".to_string(),
            "construct_folder_v1".to_string(),
        ),
        "rpg_maker" => (
            "imported_rpg_maker".to_string(),
            "1.0.0".to_string(),
            "imported_rpg_maker".to_string(),
            "rpg_maker_data_json_v1".to_string(),
        ),
        "openbor" => (
            "imported_openbor".to_string(),
            "1.0.0".to_string(),
            "imported_openbor".to_string(),
            "openbor_module_v1".to_string(),
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
    let mut node_logic = HashMap::new();

    for node in &nodes {
        let Some(script_path) = godot_node_script_path(godot_path, node, &ext_resources) else {
            continue;
        };
        let script = read_text_lossy(&script_path)?;
        let (mut hints, input, physics) = analyze_godot_script(&script);
        let script_label = script_path
            .strip_prefix(godot_path)
            .ok()
            .map(normalize_relative_path)
            .unwrap_or_else(|| script_path.display().to_string());
        hints.insert(
            0,
            format!("Script Godot preservado como hint: {}.", script_label),
        );
        node_logic.insert(node.name.clone(), (hints, input, physics));
    }

    for node in nodes {
        let inherited_logic = node_logic.get(&node.name).cloned().or_else(|| {
            node._parent
                .split('/')
                .next_back()
                .filter(|candidate| !candidate.trim().is_empty() && *candidate != ".")
                .and_then(|candidate| node_logic.get(candidate).cloned())
        });
        match node.node_type.as_str() {
            "Sprite2D" | "AnimatedSprite2D" => {
                let texture_source = if node.node_type == "Sprite2D" {
                    if let Some(texture_ref) = node.properties.get("texture") {
                        let Some(texture_id) = godot_ext_resource_id(texture_ref) else {
                            skipped.push(format!(
                                "{}: referencia de textura Godot nao suportada.",
                                node.name
                            ));
                            continue;
                        };
                        let Some(texture_resource) = ext_resources.get(&texture_id) else {
                            skipped.push(format!(
                                "{}: ExtResource '{}' nao encontrada para Sprite2D.",
                                node.name, texture_id
                            ));
                            continue;
                        };
                        resolve_godot_resource_path(godot_path, &texture_resource.path)
                    } else if let Some(asset) =
                        godot_node_visual_asset_path(godot_path, &node, &ext_resources)
                    {
                        asset
                    } else {
                        skipped.push(format!("{}: Sprite2D sem textura.", node.name));
                        continue;
                    }
                } else if let Some(asset) =
                    godot_node_visual_asset_path(godot_path, &node, &ext_resources)
                {
                    asset
                } else {
                    skipped.push(format!(
                        "{}: AnimatedSprite2D sem atlas/frames importaveis nesta wave.",
                        node.name
                    ));
                    continue;
                };

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
                let entity_id = unique_entity_id(&mut entity_ids, &node.name, "sprite");
                if first_sprite_id.is_none() {
                    first_sprite_id = Some(entity_id.clone());
                }
                let (x, y) = parse_godot_position(node.properties.get("position"));
                let (mut logic_hints, input, physics) =
                    inherited_logic.unwrap_or_else(|| (Vec::new(), None, None));
                if node.node_type == "AnimatedSprite2D" {
                    logic_hints.push(
                        "AnimatedSprite2D importado como sprite estatico; frames e playback permanecem como hints."
                            .to_string(),
                    );
                }
                scene
                    .entities
                    .push(imported_sprite_entity(ImportedSpriteEntitySpec {
                        entity_id,
                        display_name: node.name.clone(),
                        asset,
                        source_path: texture_source,
                        x,
                        y,
                        input,
                        physics,
                        logic_hints,
                    }));
            }
            "Camera2D" => {
                let entity_id = unique_entity_id(&mut entity_ids, &node.name, "camera");
                let (x, y) = parse_godot_position(node.properties.get("position"));
                pending_cameras.push((entity_id, node.name, x, y));
            }
            "TileMap" | "TileMapLayer" => {
                let Some(tileset_source) =
                    godot_node_visual_asset_path(godot_path, &node, &ext_resources)
                else {
                    skipped.push(format!(
                        "{}: {} sem tileset visual importavel nesta wave.",
                        node.name, node.node_type
                    ));
                    continue;
                };
                let asset = materialize_external_file(
                    project_dir,
                    godot_path,
                    &tileset_source,
                    "tilesets",
                    "godot",
                    &mut asset_cache,
                )?;
                let entity_id = unique_entity_id(&mut entity_ids, &node.name, "tilemap");
                let (x, y) = parse_godot_position(node.properties.get("position"));
                scene.entities.push(imported_tilemap_entity(
                    entity_id,
                    node.name.clone(),
                    asset,
                    &tileset_source,
                    x,
                    y,
                ));
            }
            "AudioStreamPlayer" | "AudioStreamPlayer2D" => {
                let Some(stream_ref) = node.properties.get("stream") else {
                    skipped.push(format!("{}: player de audio sem stream.", node.name));
                    continue;
                };
                let Some(stream_id) = godot_ext_resource_id(stream_ref) else {
                    skipped.push(format!(
                        "{}: referencia de audio Godot nao suportada.",
                        node.name
                    ));
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
            _ => {}
        }
    }

    for (entity_id, display_name, x, y) in pending_cameras {
        let mut entity = imported_camera_entity(entity_id, display_name, first_sprite_id.clone());
        entity.transform = crate::ugdm::entities::Transform { x, y };
        scene.entities.push(entity);
    }

    if !audio_sfx.is_empty() || audio_bgm.is_some() {
        let entity_id = unique_entity_id(&mut entity_ids, "audio_bank", "audio");
        scene.entities.push(external_audio_bank_entity(
            &entity_id,
            "Godot Audio Bank",
            audio_sfx,
            audio_bgm,
        ));
    }

    if first_sprite_id.is_some()
        && !scene
            .entities
            .iter()
            .any(|entity| entity.components.camera.is_some())
    {
        scene.entities.push(imported_camera_entity(
            unique_entity_id(&mut entity_ids, "main_camera", "camera"),
            "Main Camera".to_string(),
            first_sprite_id,
        ));
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

    let scenes = collect_recursive_files_by_extension(
        godot_path,
        &["tscn"],
        &[".godot", "addons", "import", "rds"],
    )?;
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

    let mut scenes = collect_recursive_files_by_extension(
        godot_path,
        &["tscn"],
        &[".godot", "addons", "import", "rds"],
    )?;
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

    let flush_section = |kind: &Option<String>,
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

fn godot_node_script_path(
    root: &Path,
    node: &GodotNode,
    ext_resources: &HashMap<String, GodotExtResource>,
) -> Option<PathBuf> {
    let script_ref = node.properties.get("script")?;
    let script_id = godot_ext_resource_id(script_ref)?;
    let resource = ext_resources.get(&script_id)?;
    let script_path = resolve_godot_resource_path(root, &resource.path);
    script_path.is_file().then_some(script_path)
}

fn godot_node_visual_asset_path(
    root: &Path,
    node: &GodotNode,
    ext_resources: &HashMap<String, GodotExtResource>,
) -> Option<PathBuf> {
    node.properties.values().find_map(|value| {
        let resource_id = godot_ext_resource_id(value)?;
        let resource = ext_resources.get(&resource_id)?;
        let asset_path = resolve_godot_resource_path(root, &resource.path);
        (asset_path.is_file()
            && asset_path
                .to_str()
                .is_some_and(string_looks_like_visual_asset))
        .then_some(asset_path)
    })
}

fn analyze_godot_script(
    script: &str,
) -> (
    Vec<String>,
    Option<InputComponent>,
    Option<PhysicsComponent>,
) {
    let lowered = script.to_ascii_lowercase();
    let mut hints = Vec::new();
    let mut mapping = HashMap::new();

    if lowered.contains("_physics_process") {
        hints.push("Godot script define _physics_process(delta).".to_string());
    } else if lowered.contains("_process") {
        hints.push("Godot script define _process(delta).".to_string());
    }

    if lowered.contains("input.is_action_pressed(\"ui_left\")")
        || lowered.contains("input.is_action_pressed('ui_left')")
    {
        mapping.insert("move_left".to_string(), "DPAD_LEFT".to_string());
        hints.push("Mapeado input Godot ui_left -> move_left.".to_string());
    }
    if lowered.contains("input.is_action_pressed(\"ui_right\")")
        || lowered.contains("input.is_action_pressed('ui_right')")
    {
        mapping.insert("move_right".to_string(), "DPAD_RIGHT".to_string());
        hints.push("Mapeado input Godot ui_right -> move_right.".to_string());
    }
    if lowered.contains("input.is_action_pressed(\"ui_up\")")
        || lowered.contains("input.is_action_pressed('ui_up')")
    {
        mapping.insert("move_up".to_string(), "DPAD_UP".to_string());
        hints.push("Mapeado input Godot ui_up -> move_up.".to_string());
    }
    if lowered.contains("input.is_action_pressed(\"ui_down\")")
        || lowered.contains("input.is_action_pressed('ui_down')")
    {
        mapping.insert("move_down".to_string(), "DPAD_DOWN".to_string());
        hints.push("Mapeado input Godot ui_down -> move_down.".to_string());
    }
    if lowered.contains("input.is_action_just_pressed(\"ui_accept\")")
        || lowered.contains("input.is_action_just_pressed('ui_accept')")
        || lowered.contains("input.is_action_just_pressed(\"jump\")")
        || lowered.contains("input.is_action_just_pressed('jump')")
        || lowered.contains("jump_velocity")
    {
        mapping.insert("jump".to_string(), "BUTTON_A".to_string());
        hints.push("Mapeado input Godot de salto/accept -> jump.".to_string());
    }

    if lowered.contains("move_and_slide") {
        hints.push("Script Godot usa move_and_slide; mantido como hint explicito.".to_string());
    }
    if lowered.contains(".play(") || lowered.contains("animatedsprite2d") {
        hints.push("Script Godot aciona animacoes via play().".to_string());
    }
    if lowered.contains("velocity.y +=") || lowered.contains("gravity") {
        hints.push("Script Godot aplica gravidade/velocidade vertical.".to_string());
    }
    if lowered.contains("position.x +=")
        || lowered.contains("position.x -=")
        || lowered.contains("velocity.x")
    {
        hints.push("Script Godot atualiza deslocamento horizontal.".to_string());
    }

    let input = (!mapping.is_empty()).then_some(InputComponent {
        device: "joypad1".to_string(),
        mapping,
    });
    let physics = (lowered.contains("velocity.y +=")
        || lowered.contains("gravity")
        || lowered.contains("jump_velocity"))
    .then_some(PhysicsComponent {
        gravity: true,
        gravity_strength: 6,
        max_velocity: Some(Velocity { x: 32, y: 96 }),
        friction: 1,
        bounce: 0,
    });

    (hints, input, physics)
}

fn validate_construct_project_path(construct_path: &Path) -> Result<(), LoadError> {
    if !construct_path.is_dir() {
        return Err(LoadError(format!(
            "Projeto Construct invalido: '{}' nao e um diretorio.",
            construct_path.display()
        )));
    }

    let has_project_file = construct_path.join("project.c3proj").is_file()
        || construct_path.join("project.caproj").is_file()
        || !collect_recursive_files_by_extension(
            construct_path,
            &["c3proj", "caproj"],
            &["export", "rds", "node_modules"],
        )?
        .is_empty();
    let has_layouts =
        !collect_recursive_files_by_extension(&construct_path.join("layouts"), &["json"], &[])?
            .is_empty();
    let has_objects =
        !collect_recursive_files_by_extension(&construct_path.join("objectTypes"), &["json"], &[])?
            .is_empty();
    if has_project_file || has_layouts || has_objects {
        return Ok(());
    }

    Err(LoadError(format!(
        "Projeto Construct invalido: nenhum project.c3proj, layout ou objectType encontrado em '{}'.",
        construct_path.display()
    )))
}

fn detect_construct_primary_layout_path(construct_path: &Path) -> Result<PathBuf, LoadError> {
    let mut layouts =
        collect_recursive_files_by_extension(&construct_path.join("layouts"), &["json"], &[])?;
    layouts.sort();
    let first = layouts.into_iter().next().ok_or_else(|| {
        LoadError(format!(
            "Projeto Construct invalido: nenhum layout JSON encontrado em '{}'.",
            construct_path.display()
        ))
    })?;
    Ok(construct_path
        .join("layouts")
        .join(first.replace('/', "\\")))
}

fn parse_construct_object_type(root: &Path, path: &Path) -> Result<ConstructObjectType, LoadError> {
    let value = read_json_lossy(path)?;
    let name = find_first_json_string_for_keys(&value, &["name", "objectName", "typeName"])
        .or_else(|| {
            path.file_stem()
                .map(|stem| stem.to_string_lossy().trim().to_string())
                .filter(|stem| !stem.is_empty())
        })
        .unwrap_or_else(|| "construct_object".to_string());
    let plugin_id =
        find_first_json_string_for_keys(&value, &["plugin-id", "pluginId", "plugin", "type"])
            .unwrap_or_else(|| "sprite".to_string());
    let current_dir = path.parent().unwrap_or(root);
    let strings = json_strings(&value);
    let display_asset = strings.iter().find_map(|candidate| {
        string_looks_like_visual_asset(candidate)
            .then(|| resolve_external_asset_candidate(root, current_dir, candidate))
            .flatten()
    });
    let audio_assets = dedupe_paths(
        strings
            .iter()
            .filter(|candidate| string_looks_like_audio_asset(candidate))
            .filter_map(|candidate| resolve_external_asset_candidate(root, current_dir, candidate))
            .collect(),
    );
    Ok(ConstructObjectType {
        name,
        plugin_id,
        display_asset,
        audio_assets,
    })
}

fn load_construct_object_types(
    construct_path: &Path,
) -> Result<HashMap<String, ConstructObjectType>, LoadError> {
    let mut result = HashMap::new();
    let mut paths =
        collect_recursive_files_by_extension(&construct_path.join("objectTypes"), &["json"], &[])?;
    paths.sort();
    for relative in paths {
        let full_path = construct_path
            .join("objectTypes")
            .join(relative.replace('/', "\\"));
        let object_type = parse_construct_object_type(construct_path, &full_path)?;
        result.insert(object_type.name.clone(), object_type);
    }
    Ok(result)
}

fn construct_collect_layout_instances(
    value: &serde_json::Value,
    sink: &mut Vec<ConstructLayoutInstance>,
) {
    match value {
        serde_json::Value::Object(entries) => {
            let object_name = entries
                .get("objectName")
                .and_then(serde_json::Value::as_str)
                .or_else(|| entries.get("type").and_then(serde_json::Value::as_str))
                .or_else(|| entries.get("name").and_then(serde_json::Value::as_str))
                .or_else(|| {
                    entries
                        .get("objectType")
                        .and_then(serde_json::Value::as_str)
                })
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            let x = entries.get("x").and_then(json_value_to_i32).or_else(|| {
                entries
                    .get("worldInfo")
                    .and_then(|info| info.get("x"))
                    .and_then(json_value_to_i32)
            });
            let y = entries.get("y").and_then(json_value_to_i32).or_else(|| {
                entries
                    .get("worldInfo")
                    .and_then(|info| info.get("y"))
                    .and_then(json_value_to_i32)
            });
            if let (Some(object_name), Some(x), Some(y)) = (object_name, x, y) {
                sink.push(ConstructLayoutInstance { object_name, x, y });
            }
            for child in entries.values() {
                construct_collect_layout_instances(child, sink);
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                construct_collect_layout_instances(item, sink);
            }
        }
        _ => {}
    }
}

fn construct_event_sheet_hints(construct_path: &Path) -> Result<Vec<String>, LoadError> {
    let mut hints = Vec::new();
    let mut seen = HashSet::new();
    let mut paths =
        collect_recursive_files_by_extension(&construct_path.join("eventSheets"), &["json"], &[])?;
    paths.sort();
    for relative in paths.into_iter().take(3) {
        let full_path = construct_path
            .join("eventSheets")
            .join(relative.replace('/', "\\"));
        let json = read_json_lossy(&full_path)?;
        let label = Path::new(&relative)
            .file_stem()
            .map(|stem| stem.to_string_lossy().to_string())
            .unwrap_or_else(|| relative.clone());
        hints.push(format!(
            "Construct event sheet '{}' preservada como hint explicito.",
            label
        ));
        for text in json_strings(&json) {
            let lowered = text.to_ascii_lowercase();
            if text.trim().is_empty()
                || string_looks_like_visual_asset(&text)
                || string_looks_like_audio_asset(&text)
                || !["jump", "move", "attack", "spawn", "audio", "music", "event"]
                    .iter()
                    .any(|keyword| lowered.contains(keyword))
            {
                continue;
            }
            if seen.insert(lowered) {
                hints.push(format!("Construct hint: {}.", text.trim()));
            }
            if hints.len() >= 8 {
                return Ok(hints);
            }
        }
    }
    Ok(hints)
}

pub fn import_construct_project(
    project_dir: &Path,
    construct_path: &Path,
) -> Result<ExternalImportReport, LoadError> {
    validate_construct_project_path(construct_path)?;
    let layout_path = detect_construct_primary_layout_path(construct_path)?;
    let layout_json = read_json_lossy(&layout_path)?;
    let object_types = load_construct_object_types(construct_path)?;
    let event_sheet_hints = construct_event_sheet_hints(construct_path)?;

    let scene_name = layout_path
        .file_stem()
        .map(|stem| stem.to_string_lossy().trim().to_string())
        .filter(|stem| !stem.is_empty())
        .unwrap_or_else(|| "Construct Layout".to_string());
    let mut scene = canonical_scene(DEFAULT_SCENE_ID, Some(scene_name));
    let mut entity_ids = HashSet::new();
    let mut asset_cache = HashMap::new();
    let mut first_sprite_id: Option<String> = None;
    let mut skipped = Vec::new();
    let mut logic_assigned = false;

    let mut layout_instances = Vec::new();
    construct_collect_layout_instances(&layout_json, &mut layout_instances);
    let mut seen_instances = HashSet::new();
    for instance in layout_instances {
        let key = format!("{}:{}:{}", instance.object_name, instance.x, instance.y);
        if !seen_instances.insert(key) {
            continue;
        }
        let Some(object_type) = object_types.get(&instance.object_name) else {
            continue;
        };
        let Some(display_asset) = object_type.display_asset.as_ref() else {
            continue;
        };

        let entity_id = unique_entity_id(&mut entity_ids, &instance.object_name, "construct");
        let asset = materialize_external_file(
            project_dir,
            construct_path,
            display_asset,
            if object_type.plugin_id.to_ascii_lowercase().contains("tile") {
                "tilesets"
            } else {
                "sprites"
            },
            "construct",
            &mut asset_cache,
        )?;
        if object_type.plugin_id.to_ascii_lowercase().contains("tile") {
            scene.entities.push(imported_tilemap_entity(
                entity_id,
                object_type.name.clone(),
                asset,
                display_asset,
                instance.x,
                instance.y,
            ));
            continue;
        }
        let mut logic_hints = Vec::new();
        if !logic_assigned && !event_sheet_hints.is_empty() {
            logic_hints.extend(event_sheet_hints.clone());
            logic_assigned = true;
        }
        if first_sprite_id.is_none() {
            first_sprite_id = Some(entity_id.clone());
        }
        scene
            .entities
            .push(imported_sprite_entity(ImportedSpriteEntitySpec {
                entity_id,
                display_name: object_type.name.clone(),
                asset,
                source_path: display_asset.clone(),
                x: instance.x,
                y: instance.y,
                input: None,
                physics: None,
                logic_hints,
            }));
    }

    if first_sprite_id.is_none() {
        let mut fallback_x = 32;
        for object_type in object_types.values() {
            let Some(display_asset) = object_type.display_asset.as_ref() else {
                continue;
            };
            let entity_id = unique_entity_id(&mut entity_ids, &object_type.name, "construct");
            let asset = materialize_external_file(
                project_dir,
                construct_path,
                display_asset,
                "sprites",
                "construct",
                &mut asset_cache,
            )?;
            let mut logic_hints = Vec::new();
            if !logic_assigned && !event_sheet_hints.is_empty() {
                logic_hints.extend(event_sheet_hints.clone());
                logic_assigned = true;
            }
            if first_sprite_id.is_none() {
                first_sprite_id = Some(entity_id.clone());
            }
            scene
                .entities
                .push(imported_sprite_entity(ImportedSpriteEntitySpec {
                    entity_id,
                    display_name: object_type.name.clone(),
                    asset,
                    source_path: display_asset.clone(),
                    x: fallback_x,
                    y: 96,
                    input: None,
                    physics: None,
                    logic_hints,
                }));
            fallback_x += 48;
        }
    }

    let mut audio_sources = object_types
        .values()
        .flat_map(|object_type| object_type.audio_assets.clone())
        .collect::<Vec<_>>();
    for relative in collect_recursive_files_by_extension(
        construct_path,
        &["wav", "ogg", "mp3", "m4a", "flac"],
        &["export", "rds", "node_modules"],
    )? {
        audio_sources.push(construct_path.join(relative.replace('/', "\\")));
    }
    let mut sfx = HashMap::new();
    let mut bgm = None;
    for source in dedupe_paths(audio_sources) {
        if !source.is_file() {
            continue;
        }
        let asset = materialize_external_file(
            project_dir,
            construct_path,
            &source,
            "audio",
            "construct",
            &mut asset_cache,
        )?;
        let name = source
            .file_stem()
            .and_then(|stem| stem.to_str())
            .map(str::to_string)
            .unwrap_or_else(|| "audio".to_string());
        if bgm.is_none()
            && ["bgm", "music", "theme", "track"]
                .iter()
                .any(|key| name.to_ascii_lowercase().contains(key))
        {
            bgm = Some(asset);
        } else {
            sfx.insert(slugify_scene_id(&name), asset);
        }
    }
    if !sfx.is_empty() || bgm.is_some() {
        let audio_id = unique_entity_id(&mut entity_ids, "audio_bank", "audio");
        scene.entities.push(external_audio_bank_entity(
            &audio_id,
            "Construct Audio Bank",
            sfx,
            bgm,
        ));
    }

    if let Some(follow_entity) = first_sprite_id {
        scene.entities.push(imported_camera_entity(
            unique_entity_id(&mut entity_ids, "main_camera", "camera"),
            "Main Camera".to_string(),
            Some(follow_entity),
        ));
    } else if scene.entities.is_empty() {
        skipped.push(
            "Nenhum sprite/layout visual foi materializado do projeto Construct.".to_string(),
        );
    }

    save_scene(project_dir, DEFAULT_ENTRY_SCENE, &scene)?;
    Ok(ExternalImportReport {
        primary_scene: scene,
        imported_scenes: 1,
        skipped_sources: skipped,
    })
}

fn validate_rpg_maker_project_path(rpg_path: &Path) -> Result<(), LoadError> {
    if !rpg_path.is_dir() {
        return Err(LoadError(format!(
            "Projeto RPG Maker invalido: '{}' nao e um diretorio.",
            rpg_path.display()
        )));
    }
    let data_dir = rpg_path.join("data");
    if data_dir.join("MapInfos.json").is_file()
        || !collect_recursive_files_by_extension(&data_dir, &["json"], &[])?.is_empty()
    {
        return Ok(());
    }

    Err(LoadError(format!(
        "Projeto RPG Maker invalido: pasta 'data' com JSONs canonicos nao encontrada em '{}'.",
        rpg_path.display()
    )))
}

fn detect_rpg_maker_primary_map(rpg_path: &Path) -> Result<(PathBuf, String), LoadError> {
    let data_dir = rpg_path.join("data");
    let map_infos_path = data_dir.join("MapInfos.json");
    if map_infos_path.is_file() {
        let value = read_json_lossy(&map_infos_path)?;
        let mut candidates = Vec::new();
        match value {
            serde_json::Value::Array(items) => {
                for item in items {
                    let Some(id) = item.get("id").and_then(json_value_to_i32) else {
                        continue;
                    };
                    let name = item
                        .get("name")
                        .and_then(serde_json::Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .unwrap_or("Map")
                        .to_string();
                    candidates.push((id, name));
                }
            }
            serde_json::Value::Object(entries) => {
                for (key, item) in entries {
                    let id = item
                        .get("id")
                        .and_then(json_value_to_i32)
                        .or_else(|| key.parse::<i32>().ok());
                    let Some(id) = id else {
                        continue;
                    };
                    let name = item
                        .get("name")
                        .and_then(serde_json::Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .unwrap_or("Map")
                        .to_string();
                    candidates.push((id, name));
                }
            }
            _ => {}
        }
        candidates.sort_by_key(|(id, _)| *id);
        if let Some((map_id, name)) = candidates.into_iter().find(|(id, _)| *id > 0) {
            let path = data_dir.join(format!("Map{:03}.json", map_id));
            if path.is_file() {
                return Ok((path, name));
            }
        }
    }

    let mut maps = collect_recursive_files_by_extension(&data_dir, &["json"], &[])?;
    maps.retain(|path| {
        Path::new(path)
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("Map") && name != "MapInfos.json")
    });
    maps.sort();
    let first = maps.into_iter().next().ok_or_else(|| {
        LoadError(format!(
            "Projeto RPG Maker invalido: nenhum arquivo MapXXX.json encontrado em '{}'.",
            data_dir.display()
        ))
    })?;
    let path = data_dir.join(first.replace('/', "\\"));
    let name = path
        .file_stem()
        .map(|stem| stem.to_string_lossy().to_string())
        .unwrap_or_else(|| "RPG Map".to_string());
    Ok((path, name))
}

fn parse_rpg_maker_event_commands(value: &serde_json::Value) -> Vec<RpgMakerEventCommand> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let code = entry.get("code").and_then(json_value_to_i32)?;
            let parameters = entry
                .get("parameters")
                .and_then(serde_json::Value::as_array)
                .cloned()
                .unwrap_or_default();
            Some(RpgMakerEventCommand { code, parameters })
        })
        .collect()
}

fn rpg_maker_command_hint(command: &RpgMakerEventCommand) -> Option<String> {
    let first_param_label = command
        .parameters
        .iter()
        .find_map(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let label = match command.code {
        101 | 401 => "mostra dialogo",
        111 => "executa condicao",
        117 => "chama common event",
        201 => "transfere jogador",
        205 => "move rota",
        230 => "espera frames",
        241 => "toca BGM",
        245 => "toca BGS",
        250 => "toca SE",
        301 => "inicia batalha",
        355 | 655 => "executa script",
        _ => return None,
    };
    Some(match first_param_label {
        Some(parameter) => format!("Evento RPG Maker {}: {}.", label, parameter),
        None => format!("Evento RPG Maker {}.", label),
    })
}

pub fn import_rpg_maker_project(
    project_dir: &Path,
    rpg_path: &Path,
) -> Result<ExternalImportReport, LoadError> {
    validate_rpg_maker_project_path(rpg_path)?;
    let (map_path, map_name) = detect_rpg_maker_primary_map(rpg_path)?;
    let map_json = read_json_lossy(&map_path)?;
    let mut scene = canonical_scene(DEFAULT_SCENE_ID, Some(map_name));
    let mut entity_ids = HashSet::new();
    let mut asset_cache = HashMap::new();
    let mut skipped = Vec::new();
    let mut first_sprite_id: Option<String> = None;

    let parallax_name = map_json
        .get("parallaxName")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let mut tilemap_source = parallax_name.as_deref().and_then(|name| {
        resolve_named_asset(rpg_path, &["img/parallaxes"], name, &["png", "bmp", "jpg"])
    });
    if tilemap_source.is_none() {
        let tileset_name = map_json
            .get("tilesetId")
            .and_then(json_value_to_i32)
            .and_then(|tileset_id| {
                let tilesets =
                    read_json_lossy(&rpg_path.join("data").join("Tilesets.json")).ok()?;
                tilesets
                    .as_array()
                    .and_then(|items| {
                        items.iter().find(|item| {
                            item.get("id").and_then(json_value_to_i32) == Some(tileset_id)
                        })
                    })
                    .and_then(|item| {
                        item.get("tilesetNames")
                            .and_then(serde_json::Value::as_array)
                            .and_then(|items| items.iter().find_map(serde_json::Value::as_str))
                            .map(str::to_string)
                    })
            });
        tilemap_source = tileset_name.as_deref().and_then(|name| {
            resolve_named_asset(rpg_path, &["img/tilesets"], name, &["png", "bmp", "jpg"])
        });
    }
    if let Some(source) = tilemap_source {
        let asset = materialize_external_file(
            project_dir,
            rpg_path,
            &source,
            "tilesets",
            "rpgmaker",
            &mut asset_cache,
        )?;
        scene.entities.push(imported_tilemap_entity(
            unique_entity_id(&mut entity_ids, "map_background", "tilemap"),
            "Map Background".to_string(),
            asset,
            &source,
            0,
            0,
        ));
    }

    let events = map_json
        .get("events")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default();
    for event in events {
        let Some(event_object) = event.as_object() else {
            continue;
        };
        let event_name = event_object
            .get("name")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("RPG Event")
            .to_string();
        let event_x = event_object
            .get("x")
            .and_then(json_value_to_i32)
            .unwrap_or(0)
            * 32;
        let event_y = event_object
            .get("y")
            .and_then(json_value_to_i32)
            .unwrap_or(0)
            * 32;
        let pages = event_object
            .get("pages")
            .and_then(serde_json::Value::as_array)
            .cloned()
            .unwrap_or_default();
        let character_name = pages.iter().find_map(|page| {
            page.get("image")
                .and_then(|image| image.get("characterName"))
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        });
        let Some(character_name) = character_name else {
            continue;
        };
        let Some(source) = resolve_named_asset(
            rpg_path,
            &["img/characters"],
            &character_name,
            &["png", "bmp", "jpg"],
        ) else {
            skipped.push(format!(
                "{}: character sprite '{}' nao encontrado.",
                event_name, character_name
            ));
            continue;
        };
        let asset = materialize_external_file(
            project_dir,
            rpg_path,
            &source,
            "sprites",
            "rpgmaker",
            &mut asset_cache,
        )?;
        let entity_id = unique_entity_id(&mut entity_ids, &event_name, "event");
        if first_sprite_id.is_none() {
            first_sprite_id = Some(entity_id.clone());
        }
        let mut logic_hints = vec![format!(
            "Evento RPG Maker '{}' preservado como entidade editavel.",
            event_name
        )];
        let commands = pages
            .iter()
            .flat_map(|page| {
                parse_rpg_maker_event_commands(page.get("list").unwrap_or(&serde_json::Value::Null))
            })
            .collect::<Vec<_>>();
        for command in &commands {
            if let Some(hint) = rpg_maker_command_hint(command) {
                logic_hints.push(hint);
            }
            if logic_hints.len() >= 8 {
                break;
            }
        }
        scene
            .entities
            .push(imported_sprite_entity(ImportedSpriteEntitySpec {
                entity_id,
                display_name: event_name,
                asset,
                source_path: source,
                x: event_x,
                y: event_y,
                input: None,
                physics: None,
                logic_hints,
            }));
    }

    if first_sprite_id.is_none() {
        let mut characters = collect_recursive_files_by_extension(
            &rpg_path.join("img").join("characters"),
            &["png", "bmp", "jpg"],
            &[],
        )?;
        characters.sort();
        if let Some(relative) = characters.into_iter().next() {
            let source = rpg_path
                .join("img")
                .join("characters")
                .join(relative.replace('/', "\\"));
            let asset = materialize_external_file(
                project_dir,
                rpg_path,
                &source,
                "sprites",
                "rpgmaker",
                &mut asset_cache,
            )?;
            let entity_id = unique_entity_id(&mut entity_ids, "player", "sprite");
            first_sprite_id = Some(entity_id.clone());
            scene
                .entities
                .push(imported_sprite_entity(ImportedSpriteEntitySpec {
                    entity_id,
                    display_name: "Player".to_string(),
                    asset,
                    source_path: source,
                    x: 64,
                    y: 96,
                    input: None,
                    physics: None,
                    logic_hints: vec![
                        "Sprite RPG Maker importado sem eventos; comandos permanecem externos."
                            .to_string(),
                    ],
                }));
        }
    }

    let map_bgm = map_json
        .get("bgm")
        .and_then(|bgm| bgm.get("name"))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let mut bgm_asset = map_bgm.as_deref().and_then(|name| {
        resolve_named_asset(
            rpg_path,
            &["audio/bgm"],
            name,
            &["ogg", "m4a", "mp3", "wav"],
        )
    });
    if bgm_asset.is_none() {
        let mut bgm_files = collect_recursive_files_by_extension(
            &rpg_path.join("audio").join("bgm"),
            &["ogg", "m4a", "mp3", "wav"],
            &[],
        )?;
        bgm_files.sort();
        bgm_asset = bgm_files.into_iter().next().map(|relative| {
            rpg_path
                .join("audio")
                .join("bgm")
                .join(relative.replace('/', "\\"))
        });
    }
    let mut sfx = HashMap::new();
    let bgm = if let Some(source) = bgm_asset {
        Some(materialize_external_file(
            project_dir,
            rpg_path,
            &source,
            "audio",
            "rpgmaker",
            &mut asset_cache,
        )?)
    } else {
        None
    };
    for relative in collect_recursive_files_by_extension(
        &rpg_path.join("audio").join("se"),
        &["ogg", "m4a", "mp3", "wav"],
        &[],
    )? {
        let source = rpg_path
            .join("audio")
            .join("se")
            .join(relative.replace('/', "\\"));
        let asset = materialize_external_file(
            project_dir,
            rpg_path,
            &source,
            "audio",
            "rpgmaker",
            &mut asset_cache,
        )?;
        let name = source
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or("se");
        sfx.insert(slugify_scene_id(name), asset);
        if sfx.len() >= 8 {
            break;
        }
    }
    if !sfx.is_empty() || bgm.is_some() {
        let audio_id = unique_entity_id(&mut entity_ids, "audio_bank", "audio");
        scene.entities.push(external_audio_bank_entity(
            &audio_id,
            "RPG Maker Audio Bank",
            sfx,
            bgm,
        ));
    }

    if let Some(follow_entity) = first_sprite_id {
        scene.entities.push(imported_camera_entity(
            unique_entity_id(&mut entity_ids, "main_camera", "camera"),
            "Main Camera".to_string(),
            Some(follow_entity),
        ));
    }

    save_scene(project_dir, DEFAULT_ENTRY_SCENE, &scene)?;
    Ok(ExternalImportReport {
        primary_scene: scene,
        imported_scenes: 1,
        skipped_sources: skipped,
    })
}

fn validate_openbor_project_path(openbor_path: &Path) -> Result<(), LoadError> {
    if !openbor_path.is_dir() {
        return Err(LoadError(format!(
            "Projeto OpenBOR invalido: '{}' nao e um diretorio.",
            openbor_path.display()
        )));
    }

    if openbor_path.join("data").join("chars").is_dir()
        || openbor_path.join("data").join("levels").is_dir()
        || openbor_path.join("chars").is_dir()
        || openbor_path.join("levels").is_dir()
        || openbor_path.join("models.txt").is_file()
        || openbor_path.join("levels.txt").is_file()
    {
        return Ok(());
    }

    Err(LoadError(format!(
        "Projeto OpenBOR invalido: nenhum diretorio 'chars/levels' ou manifest models/levels encontrado em '{}'.",
        openbor_path.display()
    )))
}

fn parse_openbor_model_file(root: &Path, path: &Path) -> Result<OpenBorModelAsset, LoadError> {
    let content = read_text_lossy(path)?;
    let mut name = path
        .file_stem()
        .map(|stem| stem.to_string_lossy().trim().to_string())
        .filter(|stem| !stem.is_empty())
        .unwrap_or_else(|| "openbor_model".to_string());
    let mut display_asset = None;
    let mut audio_assets = Vec::new();
    let mut logic_hints = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with(';') {
            continue;
        }
        let lowered = trimmed.to_ascii_lowercase();
        let parts = trimmed.split_whitespace().collect::<Vec<_>>();
        if parts.len() >= 2 && parts[0].eq_ignore_ascii_case("name") {
            name = parts[1..].join(" ");
        }
        for token in &parts[1..] {
            if display_asset.is_none() && string_looks_like_visual_asset(token) {
                display_asset =
                    resolve_external_asset_candidate(root, path.parent().unwrap_or(root), token);
            }
            if string_looks_like_audio_asset(token) {
                if let Some(audio_asset) =
                    resolve_external_asset_candidate(root, path.parent().unwrap_or(root), token)
                {
                    audio_assets.push(audio_asset);
                }
            }
        }
        for keyword in [
            "anim",
            "attack",
            "jump",
            "spawnframe",
            "followanim",
            "combostep",
            "sound",
        ] {
            if lowered.starts_with(keyword) {
                logic_hints.push(format!("Modelo OpenBOR usa comando '{}'.", keyword));
                break;
            }
        }
    }

    if display_asset.is_none() {
        display_asset = resolve_named_asset(
            root,
            &["data/chars", "chars", "data/sprites", "sprites"],
            &name,
            &["png", "gif", "bmp", "jpg"],
        );
    }

    Ok(OpenBorModelAsset {
        name,
        display_asset,
        audio_assets: dedupe_paths(audio_assets),
        logic_hints,
    })
}

fn load_openbor_model_assets(openbor_path: &Path) -> Result<Vec<OpenBorModelAsset>, LoadError> {
    let mut model_paths = Vec::new();
    for directory in [
        openbor_path.join("data").join("chars"),
        openbor_path.join("chars"),
    ] {
        for relative in collect_recursive_files_by_extension(&directory, &["txt"], &[])? {
            model_paths.push(directory.join(relative.replace('/', "\\")));
        }
    }
    for manifest in [
        openbor_path.join("data").join("models.txt"),
        openbor_path.join("models.txt"),
    ] {
        if !manifest.is_file() {
            continue;
        }
        let content = read_text_lossy(&manifest)?;
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with(';') {
                continue;
            }
            if let Some(candidate) = resolve_external_asset_candidate(
                openbor_path,
                manifest.parent().unwrap_or(openbor_path),
                trimmed,
            ) {
                model_paths.push(candidate);
            }
        }
    }
    let model_paths = dedupe_paths(model_paths);
    let mut assets = Vec::new();
    for path in model_paths {
        if path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("txt"))
        {
            assets.push(parse_openbor_model_file(openbor_path, &path)?);
        }
    }
    Ok(assets)
}

fn parse_openbor_level_file(root: &Path, path: &Path) -> Result<OpenBorLevelAsset, LoadError> {
    let content = read_text_lossy(path)?;
    let mut name = path
        .file_stem()
        .map(|stem| stem.to_string_lossy().trim().to_string())
        .filter(|stem| !stem.is_empty())
        .unwrap_or_else(|| "openbor_level".to_string());
    let mut background_asset = None;
    let mut music_asset = None;
    let mut logic_hints = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with(';') {
            continue;
        }
        let lowered = trimmed.to_ascii_lowercase();
        let parts = trimmed.split_whitespace().collect::<Vec<_>>();
        if parts.len() >= 2 && parts[0].eq_ignore_ascii_case("name") {
            name = parts[1..].join(" ");
        }
        for token in &parts[1..] {
            if background_asset.is_none() && string_looks_like_visual_asset(token) {
                background_asset =
                    resolve_external_asset_candidate(root, path.parent().unwrap_or(root), token);
            }
            if music_asset.is_none() && string_looks_like_audio_asset(token) {
                music_asset =
                    resolve_external_asset_candidate(root, path.parent().unwrap_or(root), token);
            }
        }
        for keyword in ["spawn", "boss", "wait", "branch", "hole", "wall", "music"] {
            if lowered.starts_with(keyword) {
                logic_hints.push(format!("Estagio OpenBOR usa comando '{}'.", keyword));
                break;
            }
        }
    }

    Ok(OpenBorLevelAsset {
        name,
        background_asset,
        music_asset,
        logic_hints,
    })
}

fn load_openbor_level_assets(openbor_path: &Path) -> Result<Vec<OpenBorLevelAsset>, LoadError> {
    let mut level_paths = Vec::new();
    for directory in [
        openbor_path.join("data").join("levels"),
        openbor_path.join("levels"),
    ] {
        for relative in collect_recursive_files_by_extension(&directory, &["txt"], &[])? {
            level_paths.push(directory.join(relative.replace('/', "\\")));
        }
    }
    for manifest in [
        openbor_path.join("data").join("levels.txt"),
        openbor_path.join("levels.txt"),
    ] {
        if !manifest.is_file() {
            continue;
        }
        let content = read_text_lossy(&manifest)?;
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with(';') {
                continue;
            }
            if let Some(candidate) = resolve_external_asset_candidate(
                openbor_path,
                manifest.parent().unwrap_or(openbor_path),
                trimmed,
            ) {
                level_paths.push(candidate);
            }
        }
    }
    let level_paths = dedupe_paths(level_paths);
    let mut levels = Vec::new();
    for path in level_paths {
        if path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("txt"))
        {
            levels.push(parse_openbor_level_file(openbor_path, &path)?);
        }
    }
    Ok(levels)
}

pub fn import_openbor_project(
    project_dir: &Path,
    openbor_path: &Path,
) -> Result<ExternalImportReport, LoadError> {
    validate_openbor_project_path(openbor_path)?;
    let models = load_openbor_model_assets(openbor_path)?;
    let levels = load_openbor_level_assets(openbor_path)?;
    let scene_name = levels
        .first()
        .map(|level| level.name.clone())
        .unwrap_or_else(|| "OpenBOR Stage".to_string());
    let mut scene = canonical_scene(DEFAULT_SCENE_ID, Some(scene_name));
    let mut entity_ids = HashSet::new();
    let mut asset_cache = HashMap::new();
    let mut skipped = Vec::new();
    let mut first_sprite_id: Option<String> = None;
    let mut audio_sfx = HashMap::new();
    let mut bgm = None;

    if let Some(level) = levels.first() {
        if let Some(background) = &level.background_asset {
            let asset = materialize_external_file(
                project_dir,
                openbor_path,
                background,
                "tilesets",
                "openbor",
                &mut asset_cache,
            )?;
            scene.entities.push(imported_tilemap_entity(
                unique_entity_id(&mut entity_ids, "stage_background", "tilemap"),
                format!("{} Background", level.name),
                asset,
                background,
                0,
                0,
            ));
        }
        if let Some(music) = &level.music_asset {
            bgm = Some(materialize_external_file(
                project_dir,
                openbor_path,
                music,
                "audio",
                "openbor",
                &mut asset_cache,
            )?);
        }
    }

    let mut sprite_x = 64;
    for model in &models {
        let Some(display_asset) = model.display_asset.as_ref() else {
            skipped.push(format!(
                "{}: modelo OpenBOR sem asset visual resolvido.",
                model.name
            ));
            continue;
        };
        let asset = materialize_external_file(
            project_dir,
            openbor_path,
            display_asset,
            "sprites",
            "openbor",
            &mut asset_cache,
        )?;
        let entity_id = unique_entity_id(&mut entity_ids, &model.name, "fighter");
        if first_sprite_id.is_none() {
            first_sprite_id = Some(entity_id.clone());
        }
        let mut logic_hints = model.logic_hints.clone();
        if let Some(level) = levels.first() {
            logic_hints.extend(level.logic_hints.clone());
        }
        scene
            .entities
            .push(imported_sprite_entity(ImportedSpriteEntitySpec {
                entity_id,
                display_name: model.name.clone(),
                asset,
                source_path: display_asset.clone(),
                x: sprite_x,
                y: 112,
                input: Some(InputComponent {
                    device: "joypad1".to_string(),
                    mapping: HashMap::from([
                        ("move_left".to_string(), "DPAD_LEFT".to_string()),
                        ("move_right".to_string(), "DPAD_RIGHT".to_string()),
                        ("attack".to_string(), "BUTTON_B".to_string()),
                        ("jump".to_string(), "BUTTON_A".to_string()),
                    ]),
                }),
                physics: Some(PhysicsComponent {
                    gravity: true,
                    gravity_strength: 6,
                    max_velocity: Some(Velocity { x: 32, y: 96 }),
                    friction: 1,
                    bounce: 0,
                }),
                logic_hints,
            }));
        sprite_x += 56;

        for source in &model.audio_assets {
            let asset = materialize_external_file(
                project_dir,
                openbor_path,
                source,
                "audio",
                "openbor",
                &mut asset_cache,
            )?;
            let name = source
                .file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or("sfx");
            audio_sfx.insert(slugify_scene_id(name), asset);
        }
    }

    if !audio_sfx.is_empty() || bgm.is_some() {
        let audio_id = unique_entity_id(&mut entity_ids, "audio_bank", "audio");
        scene.entities.push(external_audio_bank_entity(
            &audio_id,
            "OpenBOR Audio Bank",
            audio_sfx,
            bgm,
        ));
    }

    if let Some(follow_entity) = first_sprite_id {
        scene.entities.push(imported_camera_entity(
            unique_entity_id(&mut entity_ids, "main_camera", "camera"),
            "Main Camera".to_string(),
            Some(follow_entity),
        ));
    }

    save_scene(project_dir, DEFAULT_ENTRY_SCENE, &scene)?;
    Ok(ExternalImportReport {
        primary_scene: scene,
        imported_scenes: 1,
        skipped_sources: skipped,
    })
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
    let mut relative_without_ext = collapse_relative_components(relative);
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

fn read_json_lossy(path: &Path) -> Result<serde_json::Value, LoadError> {
    let content = read_text_lossy(path)?;
    serde_json::from_str(&content)
        .map_err(|error| LoadError(format!("JSON invalido em '{}': {}", path.display(), error)))
}

fn collect_json_strings(value: &serde_json::Value, sink: &mut Vec<String>) {
    match value {
        serde_json::Value::String(text) => sink.push(text.clone()),
        serde_json::Value::Array(items) => {
            for item in items {
                collect_json_strings(item, sink);
            }
        }
        serde_json::Value::Object(entries) => {
            for value in entries.values() {
                collect_json_strings(value, sink);
            }
        }
        _ => {}
    }
}

fn json_strings(value: &serde_json::Value) -> Vec<String> {
    let mut strings = Vec::new();
    collect_json_strings(value, &mut strings);
    strings
}

fn find_first_json_string_for_keys(value: &serde_json::Value, keys: &[&str]) -> Option<String> {
    match value {
        serde_json::Value::Object(entries) => {
            for key in keys {
                if let Some(found) = entries.get(*key).and_then(serde_json::Value::as_str) {
                    let trimmed = found.trim();
                    if !trimmed.is_empty() {
                        return Some(trimmed.to_string());
                    }
                }
            }
            entries
                .values()
                .find_map(|entry| find_first_json_string_for_keys(entry, keys))
        }
        serde_json::Value::Array(items) => items
            .iter()
            .find_map(|entry| find_first_json_string_for_keys(entry, keys)),
        _ => None,
    }
}

fn asset_extension(value: &str) -> Option<String> {
    let trimmed = value.trim().trim_matches('"').trim_matches('\'');
    let extension = Path::new(trimmed)
        .extension()
        .and_then(|candidate| candidate.to_str())?;
    let lowered = extension.to_ascii_lowercase();
    (!lowered.is_empty()).then_some(lowered)
}

fn string_looks_like_visual_asset(value: &str) -> bool {
    asset_extension(value).is_some_and(|extension| {
        ["png", "bmp", "jpg", "jpeg", "gif", "webp", "ppm"]
            .iter()
            .any(|allowed| extension == *allowed)
    })
}

fn string_looks_like_audio_asset(value: &str) -> bool {
    asset_extension(value).is_some_and(|extension| {
        ["wav", "ogg", "mp3", "m4a", "flac", "xgm", "pcm"]
            .iter()
            .any(|allowed| extension == *allowed)
    })
}

fn resolve_external_asset_candidate(root: &Path, current_dir: &Path, raw: &str) -> Option<PathBuf> {
    let trimmed = raw.trim().trim_matches('"').trim_matches('\'');
    if trimmed.is_empty() || trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return None;
    }
    let normalized = trimmed
        .replace("res://", "")
        .replace('\\', "/")
        .trim_start_matches("./")
        .trim_start_matches('/')
        .to_string();
    if normalized.is_empty() {
        return None;
    }

    let relative = PathBuf::from(normalized.replace('/', "\\"));
    let candidates = [
        current_dir.join(&relative),
        root.join(&relative),
        root.join("data").join(&relative),
        root.join("audio").join(&relative),
        root.join("img").join(&relative),
    ];

    candidates.into_iter().find(|candidate| candidate.is_file())
}

fn dedupe_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    let mut ordered = Vec::new();
    for path in paths {
        let key = path.to_string_lossy().to_string();
        if seen.insert(key) {
            ordered.push(path);
        }
    }
    ordered
}

fn imported_logic_component(graph: Option<String>, logic_hints: Vec<String>) -> LogicComponent {
    LogicComponent {
        graph,
        graph_ref: None,
        graph_origin: None,
        logic_hints,
        external_source_refs: Vec::new(),
        imported_semantics: None,
        variables: HashMap::new(),
    }
}

fn external_audio_bank_entity(
    entity_id: &str,
    display_name: &str,
    sfx: HashMap<String, String>,
    bgm: Option<String>,
) -> Entity {
    Entity {
        entity_id: entity_id.to_string(),
        display_name: Some(display_name.to_string()),
        prefab: None,
        transform: crate::ugdm::entities::Transform { x: 0, y: 0 },
        components: Components {
            audio: Some(AudioComponent { sfx, bgm }),
            ..Components::default()
        },
    }
}

fn imported_sprite_entity(spec: ImportedSpriteEntitySpec) -> Entity {
    let ImportedSpriteEntitySpec {
        entity_id,
        display_name,
        asset,
        source_path,
        x,
        y,
        input,
        physics,
        logic_hints,
    } = spec;

    let (frame_width, frame_height) = image::image_dimensions(&source_path).unwrap_or((32, 32));
    let has_logic = !logic_hints.is_empty() || input.is_some() || physics.is_some();
    let logic = has_logic.then(|| {
        imported_logic_component(Some(imported_sprite_logic_graph(&entity_id)), logic_hints)
    });

    Entity {
        entity_id: entity_id.clone(),
        display_name: Some(display_name),
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
            input,
            physics,
            logic,
            ..Components::default()
        },
    }
}

fn imported_tilemap_entity(
    entity_id: String,
    display_name: String,
    asset: String,
    source_path: &Path,
    x: i32,
    y: i32,
) -> Entity {
    let (map_width, map_height) = tilemap_dims_from_source(source_path);
    Entity {
        entity_id,
        display_name: Some(display_name),
        prefab: None,
        transform: crate::ugdm::entities::Transform { x, y },
        components: Components {
            tilemap: Some(TilemapComponent {
                tileset: asset,
                map_width,
                map_height,
                scroll_x: 0,
                scroll_y: 0,
                cells: Vec::new(),
            }),
            ..Components::default()
        },
    }
}

fn imported_camera_entity(
    entity_id: String,
    display_name: String,
    follow_entity: Option<String>,
) -> Entity {
    Entity {
        entity_id,
        display_name: Some(display_name),
        prefab: None,
        transform: crate::ugdm::entities::Transform { x: 0, y: 0 },
        components: Components {
            camera: Some(CameraComponent {
                follow_entity,
                offset_x: 0,
                offset_y: 0,
            }),
            ..Components::default()
        },
    }
}

fn json_value_to_i32(value: &serde_json::Value) -> Option<i32> {
    match value {
        serde_json::Value::Number(number) => number.as_f64().map(|value| value.round() as i32),
        serde_json::Value::String(text) => text
            .trim()
            .parse::<f32>()
            .ok()
            .map(|value| value.round() as i32),
        _ => None,
    }
}

fn resolve_named_asset(
    root: &Path,
    directories: &[&str],
    base_name: &str,
    extensions: &[&str],
) -> Option<PathBuf> {
    let trimmed = base_name.trim().trim_matches('"').trim_matches('\'');
    if trimmed.is_empty() {
        return None;
    }

    if string_looks_like_visual_asset(trimmed) || string_looks_like_audio_asset(trimmed) {
        return resolve_external_asset_candidate(root, root, trimmed);
    }

    directories
        .iter()
        .flat_map(|directory| {
            extensions.iter().map(move |extension| {
                root.join(directory)
                    .join(format!("{}.{}", trimmed, extension))
            })
        })
        .find(|candidate| candidate.is_file())
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
        source_logic.graph_origin = Some("user_edited_ref".to_string());
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
                graph_origin: None,
                logic_hints: Vec::new(),
                external_source_refs: Vec::new(),
                imported_semantics: None,
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
        if resolved_logic.graph_origin.is_none() {
            resolved_logic.graph_origin = Some("imported_ref".to_string());
        }
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

    fn validation_artifact_dir(name: &str) -> std::path::PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target-test")
            .join("validation")
            .join(name)
    }

    fn write_rgba_ppm(path: &Path, width: u32, height: u32, rgba: &[u8]) {
        let mut bytes = format!("P6\n{} {}\n255\n", width, height).into_bytes();
        for px in rgba.chunks_exact(4) {
            bytes.extend_from_slice(&px[..3]);
        }
        fs::write(path, bytes).expect("write ppm artifact");
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

        let mut hero_sheet = image::RgbaImage::new(64, 16);
        for frame in 0u32..4 {
            let r = 40 + frame * 45;
            let g = 120 - frame * 20;
            let b = 200u32;
            for y in 0u32..16 {
                for x in 0u32..16 {
                    hero_sheet.put_pixel(
                        frame * 16 + x,
                        y,
                        image::Rgba([r as u8, g as u8, b as u8, 255]),
                    );
                }
            }
        }
        hero_sheet
            .save(dir.join("res").join("images").join("hero.png"))
            .expect("write hero sprite sheet");
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
        image::RgbaImage::from_pixel(16, 16, image::Rgba([200, 50, 50, 255]))
            .save(dir.join("res").join("images").join("foe.png"))
            .expect("write foe sprite");
        fs::write(
            dir.join("res").join("resources.res"),
            [
                "SPRITE hero images/hero.png 2 2 FAST 5",
                "SPRITE foe images/foe.png 2 2 NONE 4",
                "IMAGE stage maps/stage.png NONE",
                "WAV jump sound/jump.wav 22050",
                "XGM theme sound/theme.xgm",
                "VGM forbidden sound/forbidden.vgm",
            ]
            .join("\n"),
        )
        .expect("write resources.res");
        fs::write(dir.join("out").join("rom.bin"), b"forbidden-rom").expect("write rom");
        fs::write(
            dir.join("src").join("main.c"),
            b"#include <genesis.h>\nint main(void) {\n    while (1) {\n        u16 joy = JOY_readJoypad(JOY_1);\n        MAP_scrollH(BG_B, 1);\n        SPR_update();\n        SYS_doVBlankProcess();\n    }\n    return 0;\n}\n",
        )
        .expect("write main");
        fs::write(dir.join("inc").join("game.h"), b"void game(void);").expect("write header");
        fs::write(dir.join("boot").join("startup.s"), b"boot").expect("write boot");
    }

    /// Doador com `main.c` + `player_control.c`: sinais run-and-gun repartidos (MAP_scrollH no main; JOY/SPR_* no .c satelite).
    fn write_sgdk_multifile_run_and_gun_donor(dir: &Path) {
        write_generic_sgdk_donor_fixture(dir);
        fs::write(
            dir.join("src").join("main.c"),
            b"#include <genesis.h>\n#include \"player_control.h\"\n\
int main(void) {\n    while (1) {\n        MAP_scrollH(BG_B, 1);\n        player_tick();\n        SYS_doVBlankProcess();\n    }\n    return 0;\n}\n",
        )
        .expect("write main multifile rg");
        fs::write(
            dir.join("src").join("player_control.h"),
            b"#ifndef PLAYER_CONTROL_H\n#define PLAYER_CONTROL_H\nvoid player_tick(void);\n#endif\n",
        )
        .expect("player_control.h");
        fs::write(
            dir.join("src").join("player_control.c"),
            b"#include <genesis.h>\n#include \"player_control.h\"\n\
void player_tick(void) {\n    u16 joy = JOY_readJoypad(JOY_1);\n    (void)joy;\n    /* Fixture RDS: SPR_* na mesma linha que identificador do recurso secundario 'foe'. */\n\
    (void)SPR_addSprite(&foe_palette, &foe, 32, 32, TILE_ATTR(PAL0, 0, FALSE, FALSE));\n\
    SPR_update();\n}\n",
        )
        .expect("player_control.c");
    }

    /// Doador com scroll vertical no main e entrada/tiro em ficheiros incluidos (shmup vertical).
    fn write_sgdk_multifile_shmup_donor(dir: &Path) {
        write_generic_sgdk_donor_fixture(dir);
        fs::write(
            dir.join("src").join("main.c"),
            b"#include <genesis.h>\n#include \"input_sys.h\"\n#include \"weapons.h\"\n\
int main(void) {\n    SPR_init();\n    while (1) {\n        MAP_scrollV(BG_A, 1);\n        input_poll();\n        weapons_tick();\n        SYS_doVBlankProcess();\n    }\n    return 0;\n}\n",
        )
        .expect("write main shmup");
        fs::write(
            dir.join("src").join("input_sys.h"),
            b"#ifndef INPUT_SYS_H\n#define INPUT_SYS_H\nvoid input_poll(void);\n#endif\n",
        )
        .expect("input_sys.h");
        fs::write(
            dir.join("src").join("input_sys.c"),
            b"#include <genesis.h>\n#include \"input_sys.h\"\n\
void input_poll(void) {\n    u16 joy = JOY_readJoypad(JOY_1);\n    (void)joy;\n}\n",
        )
        .expect("input_sys.c");
        fs::write(
            dir.join("src").join("weapons.h"),
            b"#ifndef WEAPONS_H\n#define WEAPONS_H\nvoid weapons_tick(void);\n#endif\n",
        )
        .expect("weapons.h");
        fs::write(
            dir.join("src").join("weapons.c"),
            b"#include <genesis.h>\n#include \"weapons.h\"\n\
void weapons_tick(void) {\n    SPR_addSprite(&spr_shot, FIX16(10), FIX16(20), TILE_ATTR(PAL0, 0, 0, 0));\n}\n",
        )
        .expect("weapons.c");
    }

    /// Doador de combate proximo: JOY + SPR_* sem scroll, com funcs nomeadas por punch/combo.
    fn write_sgdk_beatemup_close_range_donor(dir: &Path) {
        write_generic_sgdk_donor_fixture(dir);
        fs::write(
            dir.join("src").join("main.c"),
            b"#include <genesis.h>\n#include \"combat.h\"\n#include \"enemy_ai.h\"\n\
int main(void) {\n    SPR_init();\n    while (1) {\n        u16 joy = JOY_readJoypad(JOY_1);\n        (void)joy;\n        player_punch_tick();\n        enemy_combo_tick();\n        SPR_update();\n        SYS_doVBlankProcess();\n    }\n    return 0;\n}\n",
        )
        .expect("write beatemup main");
        fs::write(
            dir.join("src").join("combat.h"),
            b"#ifndef COMBAT_H\n#define COMBAT_H\nvoid player_punch_tick(void);\n#endif\n",
        )
        .expect("combat.h");
        fs::write(
            dir.join("src").join("combat.c"),
            b"#include <genesis.h>\n#include \"combat.h\"\n\
void player_punch_tick(void) {\n    SPR_setPosition(&hero, 48, 40);\n}\n",
        )
        .expect("combat.c");
        fs::write(
            dir.join("src").join("enemy_ai.h"),
            b"#ifndef ENEMY_AI_H\n#define ENEMY_AI_H\nvoid enemy_combo_tick(void);\n#endif\n",
        )
        .expect("enemy_ai.h");
        fs::write(
            dir.join("src").join("enemy_ai.c"),
            b"#include <genesis.h>\n#include \"enemy_ai.h\"\n\
void enemy_combo_tick(void) {\n    SPR_setPosition(&foe, 80, 40);\n}\n",
        )
        .expect("enemy_ai.c");
    }

    /// Doador hibrido: JOY + SPR + scroll H/V + sinais de combate proximo.
    fn write_sgdk_multifile_hybrid_action_scroll_donor(dir: &Path) {
        write_generic_sgdk_donor_fixture(dir);
        fs::write(
            dir.join("src").join("main.c"),
            b"#include <genesis.h>\n#include \"hybrid_combat.h\"\n\
int main(void) {\n    SPR_init();\n    while (1) {\n        u16 joy = JOY_readJoypad(JOY_1);\n        (void)joy;\n        MAP_scrollH(BG_B, 1);\n        MAP_scrollV(BG_A, 1);\n        hybrid_combo_tick();\n        SPR_update();\n        SYS_doVBlankProcess();\n    }\n    return 0;\n}\n",
        )
        .expect("write hybrid main");
        fs::write(
            dir.join("src").join("hybrid_combat.h"),
            b"#ifndef HYBRID_COMBAT_H\n#define HYBRID_COMBAT_H\nvoid hybrid_combo_tick(void);\n#endif\n",
        )
        .expect("hybrid_combat.h");
        fs::write(
            dir.join("src").join("hybrid_combat.c"),
            b"#include <genesis.h>\n#include \"hybrid_combat.h\"\n\
void hybrid_combo_tick(void) {\n    SPR_setPosition(&hero, 48, 40);\n    SPR_setPosition(&foe, 88, 40);\n    /* close-range cues */\n    (void)\"punch\";\n    (void)\"combo\";\n}\n",
        )
        .expect("hybrid_combat.c");
    }

    fn write_sgdk_semantic_scan_noise_donor(dir: &Path) {
        write_generic_sgdk_donor_fixture(dir);
        fs::write(
            dir.join("src").join("main.c"),
            b"#include <genesis.h>\n#include \"player_tick.h\"\n\
int main(void) {\n\
    const char* fake = \"SPR_addSprite(ignored) MAP_scrollV(ignored)\";\n\
    (void)fake;\n\
    // JOY_readJoypad(JOY_1) em comentario nao deve virar sinal real.\n\
    while (1) {\n\
        MAP_scrollH(BG_A, 1);\n\
        tick_player();\n\
        SYS_doVBlankProcess();\n\
    }\n\
    return 0;\n\
}\n",
        )
        .expect("write noise main");
        fs::write(
            dir.join("src").join("player_tick.h"),
            b"#ifndef PLAYER_TICK_H\n#define PLAYER_TICK_H\nvoid tick_player(void);\n#endif\n",
        )
        .expect("player_tick.h");
        fs::write(
            dir.join("src").join("player_tick.c"),
            b"#include <genesis.h>\n#include \"player_tick.h\"\n\
void tick_player(void) {\n\
    u16 joy = JOY_readJoypad(JOY_1);\n\
    (void)joy;\n\
    SPR_setPosition(&hero, 10, 20);\n\
}\n",
        )
        .expect("player_tick.c");
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

    fn write_mddev_project_json(
        root: &Path,
        kind: &str,
        build_policy: &str,
        sgdk_root: Option<&str>,
        notes: Option<&str>,
    ) {
        fs::create_dir_all(root.join(".mddev")).expect("create .mddev dir");
        let sgdk_root_line = sgdk_root
            .map(|value| format!(",\n  \"sgdk_root\": \"{}\"", value.replace('\\', "\\\\")))
            .unwrap_or_default();
        let notes_line = notes
            .map(|value| {
                format!(
                    ",\n  \"notes\": \"{}\"",
                    value.replace('\\', "\\\\").replace('"', "\\\"")
                )
            })
            .unwrap_or_default();
        let content = format!(
            "{{\n  \"schema_version\": 1,\n  \"display_name\": \"Fixture\",\n  \"project_root\": \".\",\n  \"layout\": \"flat\",\n  \"platform\": \"GEN\",\n  \"kind\": \"{kind}\",\n  \"build_policy\": \"{build_policy}\"{sgdk_root_line}{notes_line}\n}}\n"
        );
        fs::write(root.join(".mddev").join("project.json"), content)
            .expect("write .mddev/project.json");
    }

    fn write_godot_fixture(root: &Path) {
        fs::create_dir_all(root.join("art")).expect("create godot art dir");
        fs::create_dir_all(root.join("audio")).expect("create godot audio dir");
        write_test_png(
            &root.join("art").join("hero.png"),
            24,
            32,
            [96, 220, 180, 255],
        );
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
            &root
                .join("work")
                .join("hero_sff")
                .join("sd")
                .join("0-0.png"),
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
        let platformer = templates
            .iter()
            .find(|template| template.id == "platformer_seed")
            .expect("platformer template");
        assert!(platformer.available);
        assert_eq!(platformer.default_donor_path, None);
        assert_eq!(
            platformer.availability_reason.as_deref(),
            Some(MANUAL_SGDK_DONOR_REQUIRED_MESSAGE)
        );
    }

    #[test]
    fn resolved_template_donor_path_requires_manual_selection_when_registry_has_no_default() {
        let error = resolved_template_donor_path("platformer_seed", None)
            .expect_err("platformer_seed should require a manual donor path");

        assert!(error
            .to_string()
            .contains("requer uma pasta doadora SGDK escolhida manualmente"));
    }

    #[test]
    fn list_external_import_profiles_exposes_support_matrix() {
        let profiles = list_external_import_profiles();

        assert!(profiles.iter().any(|profile| {
            profile.id == "sgdk" && profile.importable && profile.support_status == "Experimental"
        }));
        assert!(profiles.iter().any(|profile| {
            profile.id == "mugen" && profile.importable && profile.source_engine == "mugen"
        }));
        assert!(profiles.iter().any(|profile| {
            profile.id == "ikemen_go" && profile.importable && profile.source_engine == "ikemen_go"
        }));
        assert!(profiles.iter().any(|profile| {
            profile.id == "godot"
                && profile.importable
                && profile.supported_levels == vec!["L1", "L2", "L3"]
        }));
        assert!(profiles.iter().any(|profile| {
            profile.id == "gamemaker" && !profile.importable && profile.support_status == "Parcial"
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
    fn stamp_project_template_metadata_marks_external_sgdk_source_kind_even_without_donor() {
        let project = temp_dir("stamp-template-metadata-external-sgdk");
        create_project_skeleton(&project, "Stamp Template Metadata", "megadrive")
            .expect("skeleton");

        let stamped = stamp_project_template_metadata(&project, "platformer_seed", None)
            .expect("stamp project template metadata");
        let metadata = stamped
            .template_metadata
            .as_ref()
            .expect("template metadata after stamp");

        assert_eq!(metadata.source_kind, "external_sgdk");
        assert_eq!(
            metadata.source_path, "builtin",
            "sem donor/default_donor_path, source_path deve ser 'builtin'"
        );

        let _ = fs::remove_dir_all(&project);
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
                        graph_origin: None,
                        logic_hints: Vec::new(),
                        external_source_refs: Vec::new(),
                        imported_semantics: None,
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
                        graph_origin: None,
                        logic_hints: Vec::new(),
                        external_source_refs: Vec::new(),
                        imported_semantics: None,
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
                        graph_origin: None,
                        logic_hints: Vec::new(),
                        external_source_refs: Vec::new(),
                        imported_semantics: None,
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

        let report = import_sgdk_project(&project_dir, &donor_dir).expect("import sgdk project");
        let scene = &report.primary_scene;

        assert!(project_dir
            .join("assets")
            .join("sprites")
            .join("hero.png")
            .is_file());
        assert!(project_dir
            .join("assets")
            .join("sprites")
            .join("foe.png")
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
        assert_eq!(report.imported_scenes, 1);
        assert_eq!(scene.entities.len(), 5);
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
        assert_eq!(
            primary_sprite
                .components
                .logic
                .as_ref()
                .and_then(|l| l.graph_ref.as_deref()),
            Some("graphs/sgdk_import_hero.json")
        );
        let hero_graph =
            fs::read_to_string(project_dir.join("graphs").join("sgdk_import_hero.json"))
                .expect("hero graph file");
        assert!(hero_graph.contains("\"event_start\""));
        let foe = scene
            .entities
            .iter()
            .find(|entity| entity.entity_id == "foe")
            .expect("foe sprite");
        assert_eq!(
            foe.components
                .logic
                .as_ref()
                .and_then(|l| l.graph_ref.as_deref()),
            Some("graphs/sgdk_import_foe.json")
        );
        assert!(project_dir
            .join("graphs")
            .join("sgdk_import_foe.json")
            .is_file());

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
        let report =
            import_sgdk_project(&project_dir, &donor_dir).expect("import split sgdk project");
        let scene = &report.primary_scene;

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
        assert_eq!(
            hero.components
                .logic
                .as_ref()
                .and_then(|l| l.graph_ref.as_deref()),
            Some("graphs/sgdk_import_hero.json")
        );
        let hero_graph =
            fs::read_to_string(project_dir.join("graphs").join("sgdk_import_hero.json"))
                .expect("hero graph");
        assert!(hero_graph.contains("\"sprite_move\""));
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
    fn import_sgdk_project_report_exposes_rich_fields_and_persists_ledger() {
        let donor_dir = temp_dir("sgdk-report-donor");
        let project_dir = temp_dir("sgdk-report-project");
        create_project_skeleton(&project_dir, "SGDK Report", "megadrive")
            .expect("create project skeleton");
        write_generic_sgdk_donor_fixture(&donor_dir);

        let report = import_sgdk_project(&project_dir, &donor_dir).expect("import sgdk report");

        // Relatorio rico: primary_scene + contagens + sumario com fingerprint.
        assert_eq!(report.imported_scenes, 1);
        assert!(!report.source_summary.fingerprint.is_empty());
        assert_eq!(
            report.source_summary.donor_root,
            donor_dir.to_string_lossy().to_string()
        );
        assert!(report.source_summary.resources_total >= 6);
        assert!(report.source_summary.resources_accepted >= 5);
        assert_eq!(
            report.source_summary.resources_skipped,
            report.skipped_sources.len()
        );

        // VGM aparece como skipped explicito rastreavel.
        assert!(
            report.skipped_sources.iter().any(
                |skipped| skipped.reason == "ForbiddenFormat" && skipped.source.contains("VGM")
            ),
            "skipped_sources deve conter VGM como ForbiddenFormat: {:?}",
            report.skipped_sources
        );

        // Fase B: tilemap de 128x128 px reconstroi cells[] via deduplicacao 8x8.
        let primary_tilemap = report
            .primary_scene
            .entities
            .iter()
            .find_map(|entity| entity.components.tilemap.as_ref())
            .expect("cena primaria deve ter tilemap");
        assert!(
            !primary_tilemap.cells.is_empty(),
            "Fase B: cells[] do tilemap primario deve ser populado: {:?}",
            primary_tilemap.cells.len()
        );
        assert_eq!(
            primary_tilemap.cells.len() as u32,
            primary_tilemap.map_width * primary_tilemap.map_height,
            "cells[] deve ter map_width * map_height entradas"
        );
        // Fase B: nenhum fallback 'cells[] vazio' quando reconstrucao teve sucesso.
        assert!(
            !report
                .fallbacks
                .iter()
                .any(|fallback| fallback.contains("cells[] vazio")),
            "Fase B: fallback 'cells[] vazio' so deve aparecer quando reconstrucao falha, nao para PNG 128x128 valido: {:?}",
            report.fallbacks
        );
        // Fase C: sprite com folha 64x16 e frame 16x16 deve materializar animacao `default`.
        let hero = report
            .primary_scene
            .entities
            .iter()
            .find(|e| e.entity_id == "hero")
            .expect("hero entity");
        let sprite = hero.components.sprite.as_ref().expect("sprite");
        assert!(
            sprite.animations.contains_key("default"),
            "animacao default esperada: {:?}",
            sprite.animations.keys().collect::<Vec<_>>()
        );
        assert_eq!(sprite.frame_width, 16);
        assert_eq!(sprite.frame_height, 16);
        // Fase C: collision_map na cena primaria a partir de cells[].
        let cmap = report
            .primary_scene
            .collision_map
            .as_ref()
            .expect("collision_map derivado do tilemap");
        assert_eq!(cmap.width, primary_tilemap.map_width);
        assert_eq!(cmap.height, primary_tilemap.map_height);
        assert!(cmap.data.iter().any(|v| *v != 0));
        // Fase D: padraio JOY + MAP_scroll no main.c -> input + hints + external ref.
        let logic = hero.components.logic.as_ref().expect("logic");
        assert!(
            logic
                .external_source_refs
                .iter()
                .any(|r| r.contains("main.c")),
            "external_source_refs: {:?}",
            logic.external_source_refs
        );
        assert!(hero.components.input.is_some());
        assert!(
            logic
                .logic_hints
                .iter()
                .any(|h| h.contains("JOY_readJoypad") || h.contains("JOY_read")),
            "hints Fase D: {:?}",
            logic.logic_hints
        );
        assert_eq!(
            logic.graph_ref.as_deref(),
            Some("graphs/sgdk_import_hero.json"),
            "Fase D deve materializar graph_ref canônico por entidade"
        );
        assert!(
            logic.graph.is_none(),
            "grafo inline deve ficar vazio quando externalizado em graph_ref"
        );
        let disk_graph =
            fs::read_to_string(project_dir.join("graphs").join("sgdk_import_hero.json"))
                .expect("ler graphs/sgdk_import_hero.json");
        assert!(
            disk_graph.contains("scroll_tilemap"),
            "grafo em disco deve encadear scroll_tilemap quando MAP_scroll* detectado"
        );
        assert!(
            disk_graph.contains("action_sound") && disk_graph.contains("fire_hint"),
            "run-and-gun de alta confianca deve materializar stencil de disparo (action_sound): {}",
            disk_graph
        );
        assert!(
            logic
                .logic_hints
                .iter()
                .any(|h| h.contains("laco infinito") || h.contains("while(1)")),
            "hints devem mencionar loop de gameplay observado: {:?}",
            logic.logic_hints
        );
        assert!(
            logic.logic_hints.iter().any(|h| h.contains("SPR_")),
            "hints devem mencionar API SPR_*: {:?}",
            logic.logic_hints
        );
        // Fase B: SceneLayer coerentes derivadas das entidades presentes.
        let layers = report
            .primary_scene
            .layers
            .as_ref()
            .expect("cena primaria deve ter layers canonicos");
        assert!(
            layers.iter().any(|l| l.kind == "tile"),
            "layer de background/tile esperado: {:?}",
            layers
        );
        assert!(
            layers.iter().any(|l| l.kind == "sprite"),
            "layer de gameplay/sprite esperado: {:?}",
            layers
        );

        // Manifesto persistido em .rds/imports/sgdk/<slug>.json.
        let manifest_rel = report
            .manifest_path
            .as_deref()
            .expect("manifest_path presente no relatorio");
        assert!(manifest_rel.starts_with(".rds/imports/sgdk/"));
        let manifest_abs = project_dir.join(manifest_rel);
        assert!(
            manifest_abs.is_file(),
            "ledger SGDK deve existir em disco: {}",
            manifest_abs.display()
        );

        let raw = fs::read_to_string(&manifest_abs).expect("read ledger");
        let ledger: SgdkImportLedger = serde_json::from_str(&raw).expect("parse ledger json");
        assert_eq!(ledger.schema_version, SGDK_IMPORT_LEDGER_SCHEMA);
        assert_eq!(ledger.fingerprint, report.source_summary.fingerprint);
        assert_eq!(ledger.scene_id, report.primary_scene.scene_id);
        assert!(!ledger.mappings.is_empty());
        assert!(ledger
            .mappings
            .iter()
            .any(|mapping| mapping.destination == "assets/sprites/hero.png"));
        assert!(ledger
            .mappings
            .iter()
            .any(|mapping| mapping.destination == "assets/sprites/foe.png"));
        assert!(ledger
            .mappings
            .iter()
            .any(|mapping| mapping.resource_kind == "XGM" || mapping.resource_kind == "XGM2"));
        assert!(
            ledger
                .skipped_sources
                .iter()
                .any(|skipped| skipped.reason == "ForbiddenFormat"),
            "ledger deve preservar skipped_sources"
        );
        assert!(ledger.history.is_empty());
        assert!(ledger
            .phase_d
            .detected_main_c_token_groups
            .contains(&"joy_read".to_string()));
        assert!(ledger
            .phase_d
            .logic_graph_refs
            .contains(&"graphs/sgdk_import_hero.json".to_string()));
        assert!(ledger
            .phase_d
            .logic_graph_refs
            .contains(&"graphs/sgdk_import_foe.json".to_string()));
        assert_eq!(
            ledger.phase_d.heuristic_gameplay_class.as_deref(),
            Some("run_and_gun_horizontal_signals")
        );
        assert_eq!(
            ledger.phase_d.donor_logic_scanned_paths,
            vec!["src/main.c".to_string()]
        );
        let hero_trace = ledger
            .phase_d
            .entity_trace
            .iter()
            .find(|trace| trace.entity_id == "hero")
            .expect("entity trace hero");
        assert_eq!(hero_trace.graph_ref, "graphs/sgdk_import_hero.json");
        assert_eq!(hero_trace.applied_class, "run_and_gun");
        assert_eq!(hero_trace.confidence, "high");
        assert!(
            !hero_trace.source_refs.is_empty(),
            "entity trace precisa registrar evidencias por entidade"
        );
        assert!(
            hero_trace
                .source_refs
                .iter()
                .all(|ev| !ev.rel_path.is_empty() && ev.line >= 1 && !ev.kind.is_empty()),
            "source_refs precisam manter rel_path/line/kind preenchidos: {:?}",
            hero_trace.source_refs
        );

        let _ = fs::remove_dir_all(donor_dir);
        let _ = fs::remove_dir_all(project_dir);
    }

    #[test]
    fn sgdk_phase_d_multifile_scan_merges_run_and_gun_signals() {
        let donor_dir = temp_dir("sgdk-mf-rg-donor");
        let project_dir = temp_dir("sgdk-mf-rg-proj");
        create_project_skeleton(&project_dir, "SGDK MF RG", "megadrive").expect("skel");
        write_sgdk_multifile_run_and_gun_donor(&donor_dir);
        let report = import_sgdk_project(&project_dir, &donor_dir).expect("import");
        let hero = report
            .primary_scene
            .entities
            .iter()
            .find(|e| e.entity_id == "hero")
            .expect("hero");
        let foe = report
            .primary_scene
            .entities
            .iter()
            .find(|e| e.entity_id == "foe")
            .expect("foe");
        let logic = hero.components.logic.as_ref().expect("logic");
        assert!(
            logic
                .external_source_refs
                .contains(&"src/main.c".to_string())
                && logic
                    .external_source_refs
                    .contains(&"src/player_control.c".to_string()),
            "external_source_refs devem listar main + satelite: {:?}",
            logic.external_source_refs
        );
        let hero_semantics = logic
            .imported_semantics
            .as_ref()
            .expect("hero imported_semantics");
        assert_eq!(hero_semantics.source, "sgdk_phase_d");
        assert_eq!(hero_semantics.entity_role, "player_avatar");
        assert!(
            hero_semantics
                .driver_functions
                .iter()
                .any(|driver| driver == "player_tick"),
            "driver_functions hero precisam mencionar player_tick: {:?}",
            hero_semantics.driver_functions
        );
        let foe_semantics = foe
            .components
            .logic
            .as_ref()
            .and_then(|logic| logic.imported_semantics.as_ref())
            .expect("foe imported_semantics");
        assert_eq!(foe_semantics.entity_role, "enemy_actor");
        let manifest_rel = report.manifest_path.as_deref().expect("manifest");
        let ledger: SgdkImportLedger = serde_json::from_str(
            &fs::read_to_string(project_dir.join(manifest_rel)).expect("read ledger"),
        )
        .expect("parse ledger");
        assert_eq!(
            ledger.phase_d.heuristic_gameplay_class.as_deref(),
            Some("run_and_gun_horizontal_signals")
        );
        let disk_graph =
            fs::read_to_string(project_dir.join("graphs").join("sgdk_import_hero.json"))
                .expect("read hero graph");
        assert!(
            disk_graph.contains("\"dx\":2") || disk_graph.contains("\"dx\": 2"),
            "run-and-gun horizontal mantem deslocamento no eixo X: {}",
            disk_graph
        );
        assert!(disk_graph.contains("fire_hint"), "{}", disk_graph);
        let hero_trace = ledger
            .phase_d
            .entity_trace
            .iter()
            .find(|trace| trace.entity_id == "hero")
            .expect("hero trace");
        assert_eq!(hero_trace.entity_role, "player_avatar");
        assert!(
            hero_trace
                .driver_functions
                .iter()
                .any(|driver| driver == "player_tick"),
            "trace hero precisa registrar funcoes condutoras: {:?}",
            hero_trace.driver_functions
        );
        assert!(
            ledger
                .phase_d
                .cross_unit_function_refs
                .iter()
                .any(|line| line.contains("player_tick")),
            "ledger.phase_d.cross_unit_function_refs deve registrar chamada player_tick entre TU: {:?}",
            ledger.phase_d.cross_unit_function_refs
        );
        assert!(
            ledger
                .phase_d
                .entity_spr_local_signal_hits
                .iter()
                .any(|h| h.starts_with("foe@")),
            "ledger.phase_d.entity_spr_local_signal_hits deve marcar SPR_* local ao recurso foe: {:?}",
            ledger.phase_d.entity_spr_local_signal_hits
        );
        let foe_graph = fs::read_to_string(project_dir.join("graphs").join("sgdk_import_foe.json"))
            .expect("read foe graph");
        assert!(
            foe_graph.contains("fire_hint"),
            "sprite secundario com SPR_* local partilha stencil run-and-gun quando a classe global e forte: {}",
            foe_graph
        );
        let _ = fs::remove_dir_all(&donor_dir);
        let _ = fs::remove_dir_all(&project_dir);
    }

    #[test]
    fn sgdk_phase_d_semantic_scan_ignores_comments_and_strings_and_tracks_cross_tu_calls() {
        let donor_dir = temp_dir("sgdk-semantic-noise-d");
        let project_dir = temp_dir("sgdk-semantic-noise-p");
        create_project_skeleton(&project_dir, "SGDK Semantic Noise", "megadrive").expect("skel");
        write_sgdk_semantic_scan_noise_donor(&donor_dir);

        let report = import_sgdk_project(&project_dir, &donor_dir).expect("import");
        let manifest_rel = report.manifest_path.as_deref().expect("manifest");
        let ledger: SgdkImportLedger = serde_json::from_str(
            &fs::read_to_string(project_dir.join(manifest_rel)).expect("read ledger"),
        )
        .expect("parse ledger");

        assert!(
            !ledger
                .phase_d
                .detected_main_c_token_groups
                .iter()
                .any(|token| token == "map_scroll_v"),
            "map_scroll_v nao pode ser inferido a partir de string literal: {:?}",
            ledger.phase_d.detected_main_c_token_groups
        );
        assert!(
            ledger
                .phase_d
                .cross_unit_function_refs
                .iter()
                .any(|line| line.contains("tick_player")),
            "cross TU deve rastrear tick_player entre TUs: {:?}",
            ledger.phase_d.cross_unit_function_refs
        );
        let hero_trace = ledger
            .phase_d
            .entity_trace
            .iter()
            .find(|trace| trace.entity_id == "hero")
            .expect("hero trace");
        assert!(
            hero_trace
                .source_refs
                .iter()
                .any(|ev| ev.kind == "entity_bind"
                    || ev.kind == "function_call"
                    || ev.kind == "sgdk_api_call"),
            "entity trace precisa carregar evidencias semanticas: {:?}",
            hero_trace.source_refs
        );

        let _ = fs::remove_dir_all(&donor_dir);
        let _ = fs::remove_dir_all(&project_dir);
    }

    /// Doador sem API SPR_* no agregado: JOY + MAP_scrollH (sinal platformer, nao run-and-gun).
    fn write_sgdk_platformer_horizontal_scan_donor(dir: &Path) {
        write_generic_sgdk_donor_fixture(dir);
        fs::write(
            dir.join("src").join("main.c"),
            b"#include <genesis.h>\n\
int main(void) {\n    while (1) {\n        u16 joy = JOY_readJoypad(JOY_1);\n        (void)joy;\n        MAP_scrollH(BG_B, 1);\n        SYS_doVBlankProcess();\n    }\n    return 0;\n}\n",
        )
        .expect("write main platformer scan");
    }

    #[test]
    fn sgdk_phase_d_platformer_horizontal_scan_fixture_class() {
        let donor_dir = temp_dir("sgdk-plat-scan-d");
        let project_dir = temp_dir("sgdk-plat-scan-p");
        create_project_skeleton(&project_dir, "SGDK Plat Scan", "megadrive").expect("skel");
        write_sgdk_platformer_horizontal_scan_donor(&donor_dir);
        let report = import_sgdk_project(&project_dir, &donor_dir).expect("import");
        let manifest_abs = project_dir.join(report.manifest_path.as_deref().expect("manifest"));
        let ledger: SgdkImportLedger =
            serde_json::from_str(&fs::read_to_string(&manifest_abs).expect("read")).expect("parse");
        assert_eq!(
            ledger.phase_d.heuristic_gameplay_class.as_deref(),
            Some("platformer_horizontal_scroller_signals")
        );
        let hero_trace = ledger
            .phase_d
            .entity_trace
            .iter()
            .find(|trace| trace.entity_id == "hero")
            .expect("hero trace");
        assert_eq!(hero_trace.applied_class, "platformer");
        assert_eq!(hero_trace.confidence, "medium");
        let disk_graph =
            fs::read_to_string(project_dir.join("graphs").join("sgdk_import_hero.json"))
                .expect("read graph");
        assert!(
            !disk_graph.contains("fire_hint"),
            "platformer horizontal sem classe alta nao materializa fire_hint: {}",
            disk_graph
        );
        let _ = fs::remove_dir_all(&donor_dir);
        let _ = fs::remove_dir_all(&project_dir);
    }

    #[test]
    fn sgdk_phase_d_beatemup_close_range_fixture_assigns_roles() {
        let donor_dir = temp_dir("sgdk-beat-d");
        let project_dir = temp_dir("sgdk-beat-p");
        create_project_skeleton(&project_dir, "SGDK Beat", "megadrive").expect("skel");
        write_sgdk_beatemup_close_range_donor(&donor_dir);
        let report = import_sgdk_project(&project_dir, &donor_dir).expect("import");
        let manifest_abs = project_dir.join(report.manifest_path.as_deref().expect("manifest"));
        let ledger: SgdkImportLedger =
            serde_json::from_str(&fs::read_to_string(&manifest_abs).expect("read")).expect("parse");
        assert_eq!(
            ledger.phase_d.heuristic_gameplay_class.as_deref(),
            Some("beat_em_up_close_range_signals")
        );
        let hero = report
            .primary_scene
            .entities
            .iter()
            .find(|entity| entity.entity_id == "hero")
            .expect("hero");
        let foe = report
            .primary_scene
            .entities
            .iter()
            .find(|entity| entity.entity_id == "foe")
            .expect("foe");
        let hero_semantics = hero
            .components
            .logic
            .as_ref()
            .and_then(|logic| logic.imported_semantics.as_ref())
            .expect("hero imported_semantics");
        assert_eq!(hero_semantics.entity_role, "player_avatar");
        assert_eq!(
            hero_semantics.gameplay_class,
            "beat_em_up_close_range_signals"
        );
        assert!(
            hero_semantics
                .audit_flags
                .iter()
                .any(|flag| flag == "position:staging_layout"),
            "hero precisa marcar staging de autoria quando a cena abre sem coordenadas confiaveis: {:?}",
            hero_semantics.audit_flags
        );
        let foe_semantics = foe
            .components
            .logic
            .as_ref()
            .and_then(|logic| logic.imported_semantics.as_ref())
            .expect("foe imported_semantics");
        assert_eq!(foe_semantics.entity_role, "enemy_actor");
        assert_ne!(
            (hero.transform.x, hero.transform.y),
            (foe.transform.x, foe.transform.y),
            "staging de autoria nao pode manter sprites densos empilhados"
        );
        let hero_trace = ledger
            .phase_d
            .entity_trace
            .iter()
            .find(|trace| trace.entity_id == "hero")
            .expect("hero trace");
        assert_eq!(hero_trace.applied_class, "beat_em_up");
        assert_eq!(hero_trace.entity_role, "player_avatar");
        assert!(
            hero_trace
                .driver_functions
                .iter()
                .any(|driver| driver == "player_punch_tick"),
            "hero trace precisa registrar player_punch_tick: {:?}",
            hero_trace.driver_functions
        );
        let foe_trace = ledger
            .phase_d
            .entity_trace
            .iter()
            .find(|trace| trace.entity_id == "foe")
            .expect("foe trace");
        assert_eq!(foe_trace.applied_class, "beat_em_up");
        assert_eq!(foe_trace.entity_role, "enemy_actor");
        let hero_graph =
            fs::read_to_string(project_dir.join("graphs").join("sgdk_import_hero.json"))
                .expect("read hero graph");
        assert!(
            hero_graph.contains("Move Player"),
            "grafo do heroi deve deixar o papel explicito: {}",
            hero_graph
        );
        assert!(
            !hero_graph.contains("fire_hint"),
            "combate proximo nao deve materializar fire_hint por padrao: {}",
            hero_graph
        );
        let foe_graph = fs::read_to_string(project_dir.join("graphs").join("sgdk_import_foe.json"))
            .expect("read foe graph");
        assert!(
            foe_graph.contains("\"dx\":-1") || foe_graph.contains("\"dx\": -1"),
            "inimigo de combate proximo deve materializar deslocamento proprio: {}",
            foe_graph
        );
        assert!(
            hero_graph.contains("role_player_idle_anim"),
            "grafo do jogador deve encadear no especifico de papel (sprite_anim): {}",
            hero_graph
        );
        assert!(
            foe_graph.contains("role_enemy_threat_sound"),
            "grafo do inimigo deve encadear no especifico de papel (acao/zona): {}",
            foe_graph
        );
        let _ = fs::remove_dir_all(&donor_dir);
        let _ = fs::remove_dir_all(&project_dir);
    }

    #[test]
    fn sgdk_phase_d_hybrid_action_scroll_fixture_materializes_hybrid_class() {
        let donor_dir = temp_dir("sgdk-hybrid-d");
        let project_dir = temp_dir("sgdk-hybrid-p");
        create_project_skeleton(&project_dir, "SGDK Hybrid", "megadrive").expect("skel");
        write_sgdk_multifile_hybrid_action_scroll_donor(&donor_dir);
        let report = import_sgdk_project(&project_dir, &donor_dir).expect("import");
        let manifest_abs = project_dir.join(report.manifest_path.as_deref().expect("manifest"));
        let ledger: SgdkImportLedger =
            serde_json::from_str(&fs::read_to_string(&manifest_abs).expect("read")).expect("parse");
        assert_eq!(
            ledger.phase_d.heuristic_gameplay_class.as_deref(),
            Some("hybrid_action_scroll_signals")
        );
        let hero_trace = ledger
            .phase_d
            .entity_trace
            .iter()
            .find(|trace| trace.entity_id == "hero")
            .expect("hero trace");
        assert_eq!(hero_trace.applied_class, "hybrid_action");
        assert!(
            hero_trace
                .source_paths
                .iter()
                .any(|path| path.contains("hybrid_combat.c")),
            "hybrid trace deve manter source_paths diretos: {:?}",
            hero_trace.source_paths
        );

        let _ = fs::remove_dir_all(&donor_dir);
        let _ = fs::remove_dir_all(&project_dir);
    }

    #[test]
    fn sgdk_phase_d_resolve_prefabs_hydrates_secondary_graph_ref() {
        let donor_dir = temp_dir("sgdk-resolve-sec-d");
        let project_dir = temp_dir("sgdk-resolve-sec-p");
        create_project_skeleton(&project_dir, "SGDK Resolve Sec", "megadrive").expect("skel");
        write_sgdk_multifile_run_and_gun_donor(&donor_dir);
        let report = import_sgdk_project(&project_dir, &donor_dir).expect("import");
        let resolved =
            resolve_prefabs(&project_dir, &report.primary_scene).expect("resolve prefabs");
        let foe = resolved
            .entities
            .iter()
            .find(|e| e.entity_id == "foe")
            .expect("foe entity");
        let graph_json = foe
            .components
            .logic
            .as_ref()
            .and_then(|l| l.graph.as_deref())
            .expect("grafo resolvido a partir de graph_ref");
        assert!(
            graph_json.contains("fire_hint"),
            "secundario com SPR local deve resolver stencil: {}",
            graph_json
        );
        let _ = fs::remove_dir_all(&donor_dir);
        let _ = fs::remove_dir_all(&project_dir);
    }

    #[test]
    fn sgdk_phase_d_multifile_scan_detects_shmup_vertical_signals() {
        let donor_dir = temp_dir("sgdk-mf-shmup-d");
        let project_dir = temp_dir("sgdk-mf-shmup-p");
        create_project_skeleton(&project_dir, "SGDK MF Shmup", "megadrive").expect("skel");
        write_sgdk_multifile_shmup_donor(&donor_dir);
        let report = import_sgdk_project(&project_dir, &donor_dir).expect("import");
        let manifest_abs = project_dir.join(report.manifest_path.as_deref().expect("manifest"));
        let ledger: SgdkImportLedger =
            serde_json::from_str(&fs::read_to_string(&manifest_abs).expect("read")).expect("parse");
        assert_eq!(
            ledger.phase_d.heuristic_gameplay_class.as_deref(),
            Some("shmup_vertical_signals")
        );
        assert!(ledger.phase_d.donor_logic_scanned_paths.len() >= 3);
        assert!(ledger
            .phase_d
            .donor_logic_scanned_paths
            .iter()
            .any(|p| p.contains("input_sys.c")));
        let disk_graph =
            fs::read_to_string(project_dir.join("graphs").join("sgdk_import_hero.json"))
                .expect("read graph");
        assert!(
            disk_graph.contains("\"dy\":-2"),
            "shmup: movimento vertical heuristico: {}",
            disk_graph
        );
        assert!(disk_graph.contains("fire_hint"), "{}", disk_graph);
        assert!(
            disk_graph.contains("role_player_idle_anim"),
            "shmup: jogador deve receber no de papel encadeado: {}",
            disk_graph
        );
        let _ = fs::remove_dir_all(&donor_dir);
        let _ = fs::remove_dir_all(&project_dir);
    }

    #[test]
    fn import_sgdk_project_reimport_keeps_ledger_stable_and_no_history_growth() {
        let donor_dir = temp_dir("sgdk-reimport-donor");
        let project_dir = temp_dir("sgdk-reimport-project");
        create_project_skeleton(&project_dir, "SGDK Reimport", "megadrive")
            .expect("create project skeleton");
        write_generic_sgdk_donor_fixture(&donor_dir);

        let first = import_sgdk_project(&project_dir, &donor_dir).expect("import sgdk first pass");
        let manifest_rel = first
            .manifest_path
            .as_deref()
            .expect("first import emits manifest")
            .to_string();
        let manifest_abs = project_dir.join(&manifest_rel);
        let first_raw = fs::read_to_string(&manifest_abs).expect("read first ledger");
        let first_ledger: SgdkImportLedger =
            serde_json::from_str(&first_raw).expect("parse first ledger");

        // Reimport com doador inalterado: fingerprint estavel e history nao cresce.
        let second =
            import_sgdk_project(&project_dir, &donor_dir).expect("import sgdk second pass");
        assert_eq!(
            second.source_summary.fingerprint,
            first.source_summary.fingerprint
        );
        let second_raw = fs::read_to_string(&manifest_abs).expect("read second ledger");
        let second_ledger: SgdkImportLedger =
            serde_json::from_str(&second_raw).expect("parse second ledger");
        assert_eq!(second_ledger.fingerprint, first_ledger.fingerprint);
        assert_eq!(
            second_ledger.history.len(),
            0,
            "reimport com fingerprint igual nao deve crescer history: {:?}",
            second_ledger.history
        );
        assert_eq!(
            second_ledger.mappings.len(),
            first_ledger.mappings.len(),
            "mappings estaveis entre runs"
        );

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
            .is_some_and(
                |audio| audio.bgm.as_deref() == Some("assets/audio/downtownstage_bgm.mp3")
            )));

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
        let scene =
            load_scene(&project_dir, DEFAULT_ENTRY_SCENE).expect("load imported godot scene");

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
            entity.components.audio.as_ref().is_some_and(|audio| {
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
                    graph_origin: None,
                    logic_hints: Vec::new(),
                    external_source_refs: Vec::new(),
                    imported_semantics: None,
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

    fn write_construct_fixture(root: &Path) {
        let layouts = root.join("layouts");
        let object_types = root.join("objectTypes");
        fs::create_dir_all(&layouts).expect("create construct layouts dir");
        fs::create_dir_all(&object_types).expect("create construct objectTypes dir");
        fs::create_dir_all(root.join("sprites")).expect("create construct sprites dir");
        fs::write(
            root.join("project.c3proj"),
            "{\"name\":\"Construct Fixture\"}",
        )
        .expect("write project.c3proj");
        write_test_png(
            &root.join("sprites").join("hero.png"),
            32,
            32,
            [200, 80, 120, 255],
        );
        fs::write(
            object_types.join("hero.json"),
            "{\"name\":\"Hero\",\"plugin-id\":\"Sprite\",\"image\":\"sprites/hero.png\"}",
        )
        .expect("write construct object type");
        fs::write(
            layouts.join("main.json"),
            "{\"name\":\"Main Layout\",\"instances\":[{\"objectName\":\"Hero\",\"x\":48,\"y\":72}]}",
        )
        .expect("write construct layout");
    }

    fn write_rpg_maker_fixture(root: &Path) {
        let data_dir = root.join("data");
        let tilesets_dir = root.join("img").join("tilesets");
        fs::create_dir_all(&data_dir).expect("create rpgmaker data dir");
        fs::create_dir_all(&tilesets_dir).expect("create rpgmaker tilesets dir");
        write_test_png(&tilesets_dir.join("Field.png"), 64, 48, [64, 160, 96, 255]);
        fs::write(
            data_dir.join("MapInfos.json"),
            "[{\"id\":1,\"name\":\"Field\",\"parentId\":0}]",
        )
        .expect("write rpgmaker MapInfos");
        fs::write(
            data_dir.join("Tilesets.json"),
            "[{\"id\":1,\"tilesetNames\":[\"Field\"]}]",
        )
        .expect("write rpgmaker Tilesets");
        fs::write(
            data_dir.join("Map001.json"),
            "{\"tilesetId\":1,\"events\":[]}",
        )
        .expect("write rpgmaker Map001");
    }

    fn write_openbor_fixture(root: &Path) {
        let chars_dir = root.join("data").join("chars").join("hero");
        fs::create_dir_all(&chars_dir).expect("create openbor chars dir");
        fs::create_dir_all(root.join("data").join("levels")).expect("create openbor levels dir");
        write_test_png(&chars_dir.join("hero.png"), 48, 64, [220, 200, 40, 255]);
        fs::write(
            chars_dir.join("hero.txt"),
            [
                "name Hero",
                "type player",
                "gfxshadow 0",
                "load hero.png",
                "anim idle",
                "  offset 0 0",
                "  delay 10",
                "  frame hero.png",
            ]
            .join("\n"),
        )
        .expect("write openbor model");
        fs::write(
            root.join("data").join("levels").join("stage1.txt"),
            [
                "name Stage 1",
                "music data/music/theme.mod",
                "background data/bgs/stage1.png",
            ]
            .join("\n"),
        )
        .expect("write openbor level");
    }

    fn count_files_in(dir: &Path) -> usize {
        fs::read_dir(dir)
            .map(|iter| {
                iter.filter_map(|entry| entry.ok())
                    .filter(|entry| entry.path().is_file())
                    .count()
            })
            .unwrap_or(0)
    }

    #[test]
    fn smoke_import_construct_project_builds_scene_and_is_idempotent() {
        let donor = temp_dir("smoke-construct-donor");
        let project = temp_dir("smoke-construct-project");
        create_project_skeleton(&project, "Construct Smoke", "megadrive")
            .expect("create project skeleton");
        write_construct_fixture(&donor);

        let first =
            import_construct_project(&project, &donor).expect("import construct first pass");
        assert!(
            !first.primary_scene.entities.is_empty(),
            "construct import produced entities"
        );
        let sprites_dir = project.join("assets").join("sprites");
        let first_asset_count = count_files_in(&sprites_dir);
        assert!(first_asset_count >= 1, "at least one sprite materialized");

        let second =
            import_construct_project(&project, &donor).expect("import construct second pass");
        assert_eq!(
            second.primary_scene.entities.len(),
            first.primary_scene.entities.len(),
            "re-import does not duplicate entities"
        );
        assert_eq!(
            count_files_in(&sprites_dir),
            first_asset_count,
            "re-import does not duplicate sprite files"
        );

        let _ = fs::remove_dir_all(&donor);
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn smoke_import_rpg_maker_project_builds_scene_and_is_idempotent() {
        let donor = temp_dir("smoke-rpgmaker-donor");
        let project = temp_dir("smoke-rpgmaker-project");
        create_project_skeleton(&project, "RPG Maker Smoke", "megadrive")
            .expect("create project skeleton");
        write_rpg_maker_fixture(&donor);

        let first =
            import_rpg_maker_project(&project, &donor).expect("import rpg_maker first pass");
        assert!(
            !first.primary_scene.entities.is_empty(),
            "rpg_maker import produced entities from tileset"
        );
        let tilesets_dir = project.join("assets").join("tilesets");
        let first_asset_count = count_files_in(&tilesets_dir);
        assert!(first_asset_count >= 1, "at least one tileset materialized");

        let second =
            import_rpg_maker_project(&project, &donor).expect("import rpg_maker second pass");
        assert_eq!(
            second.primary_scene.entities.len(),
            first.primary_scene.entities.len(),
            "re-import keeps entity count stable"
        );
        assert_eq!(
            count_files_in(&tilesets_dir),
            first_asset_count,
            "re-import does not duplicate tileset files"
        );

        let _ = fs::remove_dir_all(&donor);
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn smoke_import_openbor_project_builds_scene_and_is_idempotent() {
        let donor = temp_dir("smoke-openbor-donor");
        let project = temp_dir("smoke-openbor-project");
        create_project_skeleton(&project, "OpenBOR Smoke", "megadrive")
            .expect("create project skeleton");
        write_openbor_fixture(&donor);

        let first = import_openbor_project(&project, &donor).expect("import openbor first pass");
        assert!(
            !first.primary_scene.entities.is_empty(),
            "openbor import produced entities from hero model"
        );
        let sprites_dir = project.join("assets").join("sprites");
        let first_asset_count = count_files_in(&sprites_dir);
        assert!(first_asset_count >= 1, "at least one sprite materialized");

        let second = import_openbor_project(&project, &donor).expect("import openbor second pass");
        assert_eq!(
            second.primary_scene.entities.len(),
            first.primary_scene.entities.len(),
            "re-import keeps entity count stable"
        );
        assert_eq!(
            count_files_in(&sprites_dir),
            first_asset_count,
            "re-import does not duplicate sprite files"
        );

        let _ = fs::remove_dir_all(&donor);
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn smoke_import_ikemen_go_reuses_mugen_adapter_without_losing_assets() {
        let donor = temp_dir("smoke-ikemen-donor");
        let project = temp_dir("smoke-ikemen-project");
        create_project_skeleton(&project, "Ikemen Smoke", "megadrive")
            .expect("create project skeleton");
        write_mugen_character_fixture(&donor);

        let report =
            import_mugen_project(&project, &donor).expect("import ikemen via mugen adapter");
        assert!(
            report.imported_scenes >= 1,
            "ikemen_go reuses mugen adapter and produces at least one scene"
        );
        assert!(
            !report.primary_scene.entities.is_empty(),
            "primary scene has entities from mugen fixture"
        );

        let _ = fs::remove_dir_all(&donor);
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn smoke_import_sgdk_project_is_idempotent() {
        let donor = temp_dir("smoke-sgdk-donor");
        let project = temp_dir("smoke-sgdk-project");
        create_project_skeleton(&project, "SGDK Smoke", "megadrive")
            .expect("create project skeleton");
        write_generic_sgdk_donor_fixture(&donor);

        let first = import_sgdk_project(&project, &donor).expect("import sgdk first pass");
        let first_len = first.primary_scene.entities.len();
        let second = import_sgdk_project(&project, &donor).expect("import sgdk second pass");
        assert_eq!(
            second.primary_scene.entities.len(),
            first_len,
            "sgdk re-import keeps entity count stable"
        );
        assert_eq!(
            first.source_summary.fingerprint, second.source_summary.fingerprint,
            "sgdk re-import keeps donor fingerprint stable"
        );

        let _ = fs::remove_dir_all(&donor);
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn smoke_import_mugen_project_is_idempotent() {
        let donor = temp_dir("smoke-mugen-donor");
        let project = temp_dir("smoke-mugen-project");
        create_project_skeleton(&project, "MUGEN Smoke", "megadrive")
            .expect("create project skeleton");
        write_mugen_character_fixture(&donor);

        let first = import_mugen_project(&project, &donor).expect("import mugen first pass");
        let second = import_mugen_project(&project, &donor).expect("import mugen second pass");
        assert_eq!(
            second.imported_scenes, first.imported_scenes,
            "mugen re-import keeps imported_scenes stable"
        );

        let _ = fs::remove_dir_all(&donor);
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn smoke_import_godot_project_is_idempotent() {
        let donor = temp_dir("smoke-godot-donor");
        let project = temp_dir("smoke-godot-project");
        create_project_skeleton(&project, "Godot Smoke", "megadrive")
            .expect("create project skeleton");
        write_godot_fixture(&donor);

        let first = import_godot_project(&project, &donor).expect("import godot first pass");
        let second = import_godot_project(&project, &donor).expect("import godot second pass");
        assert_eq!(
            second.primary_scene.entities.len(),
            first.primary_scene.entities.len(),
            "godot re-import keeps entity count stable"
        );

        let _ = fs::remove_dir_all(&donor);
        let _ = fs::remove_dir_all(&project);
    }

    // ============================================================================
    // Sessao B - Hardening Inicial dos Importadores Preservados
    //
    // 18 testes cobrindo tres classes de prova por importador preservado:
    //   - *_handles_empty_project_dir (7): diretorio donor 100% vazio.
    //   - *_handles_missing_root_artifact (7): donor com arquivos auxiliares mas
    //     sem o artefato-raiz que o validador exige.
    //   - *_handles_lossy_text_or_unicode_paths (4 - godot/construct/rpg_maker/
    //     openbor): variantes plausiveis em Windows com BOM/CRLF e caminhos
    //     Unicode reais.
    //
    // Nenhum importador e promovido: so aumenta evidencia local. ikemen_go usa
    // o dispatcher `import_external_project` para preservar a identidade do
    // perfil mesmo quando o adapter MUGEN eh reaproveitado.
    // ============================================================================

    fn list_project_artifact_files(project: &Path) -> Vec<PathBuf> {
        let mut out = Vec::new();
        for sub in ["scenes", "assets"] {
            let root = project.join(sub);
            if !root.is_dir() {
                continue;
            }
            let mut stack = vec![root];
            while let Some(dir) = stack.pop() {
                let Ok(iter) = fs::read_dir(&dir) else {
                    continue;
                };
                for entry in iter.flatten() {
                    let path = entry.path();
                    if path.is_dir() {
                        stack.push(path);
                    } else if path.is_file() {
                        if let Ok(rel) = path.strip_prefix(project) {
                            out.push(rel.to_path_buf());
                        }
                    }
                }
            }
        }
        out.sort();
        out
    }

    fn assert_no_import_side_effects(project: &Path, baseline: &[PathBuf], context: &str) {
        let after = list_project_artifact_files(project);
        assert_eq!(
            baseline,
            after.as_slice(),
            "{}: failed import must not change scenes/ or assets/",
            context
        );
    }

    // ---- Sessao B: diretorio vazio (7 testes) ----

    #[test]
    fn sgdk_handles_empty_project_dir() {
        let donor = temp_dir("session-b-sgdk-empty-donor");
        let project = temp_dir("session-b-sgdk-empty-project");
        create_project_skeleton(&project, "SGDK Empty Dir", "megadrive")
            .expect("create project skeleton");
        let baseline = list_project_artifact_files(&project);

        let err = import_sgdk_project(&project, &donor).expect_err("empty sgdk donor must fail");
        assert!(
            err.0.contains("SGDK") || err.0.contains("sgdk"),
            "sgdk error should mention SGDK, got: {}",
            err.0
        );
        assert_no_import_side_effects(&project, &baseline, "sgdk empty dir");

        let _ = fs::remove_dir_all(&donor);
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn mugen_handles_empty_project_dir() {
        let donor = temp_dir("session-b-mugen-empty-donor");
        let project = temp_dir("session-b-mugen-empty-project");
        create_project_skeleton(&project, "MUGEN Empty Dir", "megadrive")
            .expect("create project skeleton");
        let baseline = list_project_artifact_files(&project);

        let err = import_mugen_project(&project, &donor).expect_err("empty mugen donor must fail");
        assert!(
            err.0.to_lowercase().contains("mugen"),
            "mugen error should mention MUGEN, got: {}",
            err.0
        );
        assert_no_import_side_effects(&project, &baseline, "mugen empty dir");

        let _ = fs::remove_dir_all(&donor);
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn ikemen_go_handles_empty_project_dir_via_dispatcher() {
        let donor = temp_dir("session-b-ikemen-empty-donor");
        let project = temp_dir("session-b-ikemen-empty-project");
        create_project_skeleton(&project, "Ikemen Empty Dir", "megadrive")
            .expect("create project skeleton");
        let baseline = list_project_artifact_files(&project);

        // Dispatcher canonico: preserva identidade do perfil ikemen_go.
        let err = import_external_project(&project, "ikemen_go", &donor)
            .expect_err("empty ikemen_go donor must fail via dispatcher");
        assert!(
            err.0.to_lowercase().contains("mugen"),
            "ikemen_go falls back to MUGEN adapter message, got: {}",
            err.0
        );
        assert_no_import_side_effects(&project, &baseline, "ikemen_go empty dir");

        // Identidade do perfil permanece intacta apos falha.
        let profile = external_import_profile_definition("ikemen_go")
            .expect("ikemen_go profile remains registered");
        assert_eq!(profile.id, "ikemen_go");
        assert_eq!(profile.source_engine, "ikemen_go");

        let _ = fs::remove_dir_all(&donor);
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn godot_handles_empty_project_dir() {
        let donor = temp_dir("session-b-godot-empty-donor");
        let project = temp_dir("session-b-godot-empty-project");
        create_project_skeleton(&project, "Godot Empty Dir", "megadrive")
            .expect("create project skeleton");
        let baseline = list_project_artifact_files(&project);

        let err = import_godot_project(&project, &donor).expect_err("empty godot donor must fail");
        assert!(
            err.0.to_lowercase().contains("godot"),
            "godot error should mention Godot, got: {}",
            err.0
        );
        assert_no_import_side_effects(&project, &baseline, "godot empty dir");

        let _ = fs::remove_dir_all(&donor);
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn construct_handles_empty_project_dir() {
        let donor = temp_dir("session-b-construct-empty-donor");
        let project = temp_dir("session-b-construct-empty-project");
        create_project_skeleton(&project, "Construct Empty Dir", "megadrive")
            .expect("create project skeleton");
        let baseline = list_project_artifact_files(&project);

        let err = import_construct_project(&project, &donor)
            .expect_err("empty construct donor must fail");
        assert!(
            err.0.to_lowercase().contains("construct"),
            "construct error should mention Construct, got: {}",
            err.0
        );
        assert_no_import_side_effects(&project, &baseline, "construct empty dir");

        let _ = fs::remove_dir_all(&donor);
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn rpg_maker_handles_empty_project_dir() {
        let donor = temp_dir("session-b-rpgmaker-empty-donor");
        let project = temp_dir("session-b-rpgmaker-empty-project");
        create_project_skeleton(&project, "RPG Maker Empty Dir", "megadrive")
            .expect("create project skeleton");
        let baseline = list_project_artifact_files(&project);

        let err = import_rpg_maker_project(&project, &donor)
            .expect_err("empty rpg maker donor must fail");
        assert!(
            err.0.to_lowercase().contains("rpg maker") || err.0.to_lowercase().contains("rpgmaker"),
            "rpg maker error should mention RPG Maker, got: {}",
            err.0
        );
        assert_no_import_side_effects(&project, &baseline, "rpg_maker empty dir");

        let _ = fs::remove_dir_all(&donor);
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn openbor_handles_empty_project_dir() {
        let donor = temp_dir("session-b-openbor-empty-donor");
        let project = temp_dir("session-b-openbor-empty-project");
        create_project_skeleton(&project, "OpenBOR Empty Dir", "megadrive")
            .expect("create project skeleton");
        let baseline = list_project_artifact_files(&project);

        let err =
            import_openbor_project(&project, &donor).expect_err("empty openbor donor must fail");
        assert!(
            err.0.to_lowercase().contains("openbor"),
            "openbor error should mention OpenBOR, got: {}",
            err.0
        );
        assert_no_import_side_effects(&project, &baseline, "openbor empty dir");

        let _ = fs::remove_dir_all(&donor);
        let _ = fs::remove_dir_all(&project);
    }

    // ---- Sessao B: artefato raiz ausente (7 testes) ----

    #[test]
    fn sgdk_handles_missing_root_artifact() {
        let donor = temp_dir("session-b-sgdk-missing-donor");
        let project = temp_dir("session-b-sgdk-missing-project");
        create_project_skeleton(&project, "SGDK Missing Root", "megadrive")
            .expect("create project skeleton");
        // Donor tem arte/audio mas nao tem nenhum manifesto .res na raiz nem em res/.
        fs::create_dir_all(donor.join("res").join("images")).expect("create res dir");
        write_test_png(
            &donor.join("res").join("images").join("hero.png"),
            16,
            16,
            [255, 0, 0, 255],
        );
        fs::write(donor.join("README.txt"), "legacy project without manifest")
            .expect("write readme");
        let baseline = list_project_artifact_files(&project);

        let err = import_sgdk_project(&project, &donor)
            .expect_err("sgdk donor without .res manifest must fail");
        assert!(
            err.0.contains(".res") || err.0.to_lowercase().contains("manifesto"),
            "sgdk error should mention missing manifest, got: {}",
            err.0
        );
        assert_no_import_side_effects(&project, &baseline, "sgdk missing root");

        let _ = fs::remove_dir_all(&donor);
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn sgdk_resolver_follows_mddev_reference_chain_to_upstream_root() {
        let donor = temp_dir("sgdk-resolve-wrapper-chain");
        let project = temp_dir("sgdk-resolve-wrapper-project");
        create_project_skeleton(&project, "SGDK Resolve Wrapper", "megadrive").expect("skel");

        let alias_root = donor.join("PlatformerEngineAlias");
        let toolkit_root = donor.join("PlatformerEngine Toolkit");
        let variant_root = toolkit_root.join("variants").join("PlatformerEngine Core");
        let upstream_root = toolkit_root.join("upstream").join("PlatformerEngine");

        write_generic_sgdk_donor_fixture(&upstream_root);
        write_mddev_project_json(
            &variant_root,
            "ENGINE",
            "enabled",
            Some("../../upstream/PlatformerEngine"),
            Some("Variant wrapper SGDK root"),
        );
        fs::write(
            variant_root.join("README.md"),
            "Wrapper de variante: upstream em `../../upstream/PlatformerEngine`.",
        )
        .expect("write variant README");

        write_mddev_project_json(
            &alias_root,
            "REFERENCE",
            "disabled",
            None,
            Some("Use `../PlatformerEngine Toolkit/variants/PlatformerEngine Core`."),
        );
        fs::write(
            alias_root.join("README.md"),
            "Alias legado. Use `../PlatformerEngine Toolkit/variants/PlatformerEngine Core`.",
        )
        .expect("write alias README");

        let resolved = resolve_sgdk_import_root(&alias_root).expect("resolve wrapper chain");
        assert_eq!(resolved.resolution_kind, "mddev_reference_redirect");
        assert_eq!(
            resolved.effective_root,
            canonicalize_existing_path(&upstream_root)
        );

        let report = import_sgdk_project(&project, &alias_root).expect("import via wrapper chain");
        assert_eq!(
            report.source_summary.resolution_kind,
            "mddev_reference_redirect"
        );
        assert_eq!(
            canonicalize_existing_path(Path::new(&report.source_summary.effective_root)),
            canonicalize_existing_path(&upstream_root)
        );
        assert_eq!(
            report.source_summary.donor_root,
            alias_root.to_string_lossy().to_string()
        );
        assert!(report.imported_scenes >= 1);

        let _ = fs::remove_dir_all(&donor);
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn sgdk_resolver_fails_when_reference_declares_multiple_buildable_candidates() {
        let donor = temp_dir("sgdk-resolve-ambiguous");
        let project = temp_dir("sgdk-resolve-ambiguous-project");
        create_project_skeleton(&project, "SGDK Resolve Ambiguous", "megadrive").expect("skel");

        let alias_root = donor.join("Alias");
        let candidate_a = donor.join("candidate_a");
        let candidate_b = donor.join("candidate_b");

        write_generic_sgdk_donor_fixture(&candidate_a);
        write_generic_sgdk_donor_fixture(&candidate_b);

        write_mddev_project_json(
            &alias_root,
            "REFERENCE",
            "disabled",
            None,
            Some("Candidatos: `../candidate_a` e `../candidate_b`."),
        );
        fs::write(
            alias_root.join("README.md"),
            "Escolha manualmente: `../candidate_a` ou `../candidate_b`.",
        )
        .expect("write alias README");

        let err = import_sgdk_project(&project, &alias_root)
            .expect_err("ambiguous wrapper must not auto-select");
        assert!(
            err.0.to_lowercase().contains("ambiguo")
                || err.0.to_lowercase().contains("multiplos candidatos"),
            "error must explain ambiguity: {}",
            err.0
        );
        assert!(
            err.0.contains("candidate_a") && err.0.contains("candidate_b"),
            "error must list concrete suggestions/candidates: {}",
            err.0
        );

        let _ = fs::remove_dir_all(&donor);
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn sgdk_resolver_prefers_requested_disabled_root_when_it_has_manifest() {
        let donor = temp_dir("sgdk-resolve-disabled-local-root");
        write_generic_sgdk_donor_fixture(&donor);
        write_mddev_project_json(
            &donor,
            "ESTUDO",
            "disabled",
            Some("."),
            Some("Build original disabled, but RDS can import the local canonical root."),
        );

        let resolved = resolve_sgdk_import_root(&donor).expect("resolve disabled local root");
        assert_eq!(resolved.resolution_kind, "direct");
        assert_eq!(resolved.effective_root, canonicalize_existing_path(&donor));

        let _ = fs::remove_dir_all(&donor);
    }

    #[test]
    fn sgdk_normalize_declared_path_preserves_brackets_in_corpus_style_names() {
        let raw =
            "../PlatformerEngine Toolkit [VER.1.0] [SGDK 211] [GEN] [COLLECTION] [PLATAFORMA]";
        let normalized = normalize_declared_path_token(raw).expect("token");
        assert!(
            normalized.ends_with("[PLATAFORMA]"),
            "path token must keep trailing bracket segment: {}",
            normalized
        );
    }

    #[test]
    fn mugen_handles_missing_root_artifact() {
        let donor = temp_dir("session-b-mugen-missing-donor");
        let project = temp_dir("session-b-mugen-missing-project");
        create_project_skeleton(&project, "MUGEN Missing Root", "megadrive")
            .expect("create project skeleton");
        // Tem sprite PNG, mas nenhum .def (nem system.def), entao scan_mugen_candidates fica vazio.
        fs::create_dir_all(donor.join("sprites")).expect("create sprites dir");
        write_test_png(
            &donor.join("sprites").join("hero.png"),
            16,
            16,
            [0, 255, 0, 255],
        );
        let baseline = list_project_artifact_files(&project);

        let err =
            import_mugen_project(&project, &donor).expect_err("mugen donor without .def must fail");
        assert!(
            err.0.to_lowercase().contains("mugen"),
            "mugen error should mention MUGEN, got: {}",
            err.0
        );
        assert_no_import_side_effects(&project, &baseline, "mugen missing root");

        let _ = fs::remove_dir_all(&donor);
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn ikemen_go_handles_missing_root_artifact_via_dispatcher() {
        let donor = temp_dir("session-b-ikemen-missing-donor");
        let project = temp_dir("session-b-ikemen-missing-project");
        create_project_skeleton(&project, "Ikemen Missing Root", "megadrive")
            .expect("create project skeleton");
        fs::create_dir_all(donor.join("work")).expect("create work dir");
        write_test_png(
            &donor.join("work").join("sprite.png"),
            16,
            16,
            [0, 0, 255, 255],
        );
        let baseline = list_project_artifact_files(&project);

        let err = import_external_project(&project, "ikemen_go", &donor)
            .expect_err("ikemen_go dispatch without .def must fail");
        assert!(
            err.0.to_lowercase().contains("mugen"),
            "ikemen_go via dispatcher surfaces MUGEN error, got: {}",
            err.0
        );
        assert_no_import_side_effects(&project, &baseline, "ikemen_go missing root");

        let profile =
            external_import_profile_definition("ikemen_go").expect("ikemen_go profile intact");
        assert_eq!(profile.id, "ikemen_go");

        let _ = fs::remove_dir_all(&donor);
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn godot_handles_missing_root_artifact() {
        let donor = temp_dir("session-b-godot-missing-donor");
        let project = temp_dir("session-b-godot-missing-project");
        create_project_skeleton(&project, "Godot Missing Root", "megadrive")
            .expect("create project skeleton");
        // Arte presente mas nenhum project.godot nem .tscn.
        fs::create_dir_all(donor.join("art")).expect("create art dir");
        write_test_png(
            &donor.join("art").join("hero.png"),
            16,
            16,
            [40, 40, 200, 255],
        );
        fs::write(donor.join("README.md"), "No project.godot here").expect("write readme");
        let baseline = list_project_artifact_files(&project);

        let err = import_godot_project(&project, &donor)
            .expect_err("godot donor without project.godot/.tscn must fail");
        assert!(
            err.0.contains("project.godot") || err.0.contains(".tscn"),
            "godot error should mention missing project file or .tscn, got: {}",
            err.0
        );
        assert_no_import_side_effects(&project, &baseline, "godot missing root");

        let _ = fs::remove_dir_all(&donor);
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn construct_handles_missing_root_artifact() {
        let donor = temp_dir("session-b-construct-missing-donor");
        let project = temp_dir("session-b-construct-missing-project");
        create_project_skeleton(&project, "Construct Missing Root", "megadrive")
            .expect("create project skeleton");
        // Tem pasta sprites/ mas nao tem project.c3proj, layouts/ nem objectTypes/.
        fs::create_dir_all(donor.join("sprites")).expect("create sprites dir");
        write_test_png(
            &donor.join("sprites").join("hero.png"),
            16,
            16,
            [200, 40, 40, 255],
        );
        let baseline = list_project_artifact_files(&project);

        let err = import_construct_project(&project, &donor)
            .expect_err("construct donor without project file/layouts/objectTypes must fail");
        assert!(
            err.0.to_lowercase().contains("construct"),
            "construct error should mention Construct, got: {}",
            err.0
        );
        assert_no_import_side_effects(&project, &baseline, "construct missing root");

        let _ = fs::remove_dir_all(&donor);
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn rpg_maker_handles_missing_root_artifact() {
        let donor = temp_dir("session-b-rpgmaker-missing-donor");
        let project = temp_dir("session-b-rpgmaker-missing-project");
        create_project_skeleton(&project, "RPG Maker Missing Root", "megadrive")
            .expect("create project skeleton");
        // Tem img/ mas nao tem data/ com JSONs canonicos.
        fs::create_dir_all(donor.join("img").join("tilesets")).expect("create img dir");
        write_test_png(
            &donor.join("img").join("tilesets").join("Field.png"),
            32,
            32,
            [16, 180, 32, 255],
        );
        let baseline = list_project_artifact_files(&project);

        let err = import_rpg_maker_project(&project, &donor)
            .expect_err("rpg maker donor without data/*.json must fail");
        assert!(
            err.0.to_lowercase().contains("rpg maker")
                || err.0.to_lowercase().contains("rpgmaker")
                || err.0.contains("data"),
            "rpg maker error should mention data folder or RPG Maker, got: {}",
            err.0
        );
        assert_no_import_side_effects(&project, &baseline, "rpg_maker missing root");

        let _ = fs::remove_dir_all(&donor);
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn openbor_handles_missing_root_artifact() {
        let donor = temp_dir("session-b-openbor-missing-donor");
        let project = temp_dir("session-b-openbor-missing-project");
        create_project_skeleton(&project, "OpenBOR Missing Root", "megadrive")
            .expect("create project skeleton");
        // Tem algum arquivo, mas nenhum data/chars, data/levels, chars/, levels/,
        // models.txt nem levels.txt.
        fs::create_dir_all(donor.join("docs")).expect("create docs dir");
        fs::write(
            donor.join("docs").join("notes.txt"),
            "miscellaneous content",
        )
        .expect("write notes");
        let baseline = list_project_artifact_files(&project);

        let err = import_openbor_project(&project, &donor)
            .expect_err("openbor donor without chars/levels must fail");
        assert!(
            err.0.to_lowercase().contains("openbor"),
            "openbor error should mention OpenBOR, got: {}",
            err.0
        );
        assert_no_import_side_effects(&project, &baseline, "openbor missing root");

        let _ = fs::remove_dir_all(&donor);
        let _ = fs::remove_dir_all(&project);
    }

    // ---- Sessao B: leitura tolerante a BOM/CRLF/Unicode (4 testes) ----

    #[test]
    fn godot_handles_lossy_text_or_unicode_paths() {
        let donor = temp_dir("session-b-godot-lossy-donor");
        let project = temp_dir("session-b-godot-lossy-project");
        create_project_skeleton(&project, "Godot Lossy", "megadrive")
            .expect("create project skeleton");
        // Arte sob caminho com caractere Unicode NFC (portatil em NTFS).
        fs::create_dir_all(donor.join("arte_acao")).expect("create unicode art dir");
        write_test_png(
            &donor.join("arte_acao").join("herói.png"),
            24,
            32,
            [200, 50, 80, 255],
        );
        // project.godot com BOM UTF-8 + CRLF.
        let mut godot_ini = String::from("\u{FEFF}");
        godot_ini.push_str(
            &[
                "[application]",
                "config/name=\"Godot Lossy\"",
                "run/main_scene=\"res://main.tscn\"",
            ]
            .join("\r\n"),
        );
        fs::write(donor.join("project.godot"), godot_ini)
            .expect("write project.godot with BOM+CRLF");
        // tscn com CRLF explicito referenciando o asset Unicode.
        let tscn = [
            "[gd_scene load_steps=2 format=3]",
            "[ext_resource type=\"Texture2D\" path=\"res://arte_acao/herói.png\" id=\"1\"]",
            "[node name=\"Main\" type=\"Node2D\"]",
            "[node name=\"Heroi\" type=\"Sprite2D\" parent=\".\"]",
            "position = Vector2(16, 24)",
            "texture = ExtResource(\"1\")",
        ]
        .join("\r\n");
        fs::write(donor.join("main.tscn"), tscn).expect("write main.tscn with CRLF");

        let report =
            import_godot_project(&project, &donor).expect("godot tolerates BOM/CRLF/unicode paths");
        assert!(
            !report.primary_scene.entities.is_empty(),
            "godot scene preserves entities despite lossy text"
        );

        let _ = fs::remove_dir_all(&donor);
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn construct_handles_lossy_text_or_unicode_paths() {
        let donor = temp_dir("session-b-construct-lossy-donor");
        let project = temp_dir("session-b-construct-lossy-project");
        create_project_skeleton(&project, "Construct Lossy", "megadrive")
            .expect("create project skeleton");
        let layouts = donor.join("layouts");
        let object_types = donor.join("objectTypes");
        let sprites = donor.join("sprites_acao");
        fs::create_dir_all(&layouts).expect("create layouts dir");
        fs::create_dir_all(&object_types).expect("create objectTypes dir");
        fs::create_dir_all(&sprites).expect("create unicode sprites dir");
        write_test_png(&sprites.join("herói.png"), 32, 32, [180, 40, 40, 255]);
        fs::write(
            donor.join("project.c3proj"),
            "{\"name\":\"Herói Construct\"}",
        )
        .expect("write project.c3proj");
        // JSON com CRLF + nome Unicode em valores (serde_json aceita CRLF como whitespace).
        fs::write(
            object_types.join("hero.json"),
            "{\r\n  \"name\": \"Herói\",\r\n  \"plugin-id\": \"Sprite\",\r\n  \"image\": \"sprites_acao/herói.png\"\r\n}",
        )
        .expect("write object type with CRLF");
        fs::write(
            layouts.join("main.json"),
            "{\r\n  \"name\": \"Ação Principal\",\r\n  \"instances\": [\r\n    { \"objectName\": \"Herói\", \"x\": 32, \"y\": 48 }\r\n  ]\r\n}",
        )
        .expect("write layout with CRLF");

        let report = import_construct_project(&project, &donor)
            .expect("construct tolerates CRLF JSON and unicode strings");
        assert_eq!(report.imported_scenes, 1);

        let _ = fs::remove_dir_all(&donor);
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn rpg_maker_handles_lossy_text_or_unicode_paths() {
        let donor = temp_dir("session-b-rpgmaker-lossy-donor");
        let project = temp_dir("session-b-rpgmaker-lossy-project");
        create_project_skeleton(&project, "RPG Maker Lossy", "megadrive")
            .expect("create project skeleton");
        let data_dir = donor.join("data");
        let tilesets_dir = donor.join("img").join("tilesets_acao");
        fs::create_dir_all(&data_dir).expect("create data dir");
        fs::create_dir_all(&tilesets_dir).expect("create unicode tilesets dir");
        write_test_png(
            &tilesets_dir.join("Campo_é.png"),
            48,
            48,
            [30, 150, 60, 255],
        );
        // JSON com CRLF e nomes Unicode no conteudo.
        fs::write(
            data_dir.join("MapInfos.json"),
            "[\r\n  { \"id\": 1, \"name\": \"Vila Ação\", \"parentId\": 0 }\r\n]",
        )
        .expect("write MapInfos with CRLF");
        fs::write(
            data_dir.join("Tilesets.json"),
            "[\r\n  { \"id\": 1, \"tilesetNames\": [\"tilesets_acao/Campo_é\"] }\r\n]",
        )
        .expect("write Tilesets with CRLF");
        fs::write(
            data_dir.join("Map001.json"),
            "{\r\n  \"tilesetId\": 1,\r\n  \"events\": []\r\n}",
        )
        .expect("write Map001 with CRLF");

        let report = import_rpg_maker_project(&project, &donor)
            .expect("rpg maker tolerates CRLF JSON and unicode strings");
        assert_eq!(report.imported_scenes, 1);

        let _ = fs::remove_dir_all(&donor);
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn openbor_handles_lossy_text_or_unicode_paths() {
        let donor = temp_dir("session-b-openbor-lossy-donor");
        let project = temp_dir("session-b-openbor-lossy-project");
        create_project_skeleton(&project, "OpenBOR Lossy", "megadrive")
            .expect("create project skeleton");
        // Chars dir com nome Unicode.
        let chars_dir = donor.join("data").join("chars").join("herói");
        fs::create_dir_all(&chars_dir).expect("create unicode chars dir");
        fs::create_dir_all(donor.join("data").join("levels")).expect("create levels dir");
        write_test_png(&chars_dir.join("hero.png"), 32, 48, [240, 200, 30, 255]);
        // hero.txt com BOM UTF-8 + CRLF + nome Unicode.
        let mut hero_txt = String::from("\u{FEFF}");
        hero_txt.push_str(
            &[
                "name Herói Ação",
                "type player",
                "gfxshadow 0",
                "load hero.png",
                "anim idle",
                "  offset 0 0",
                "  delay 10",
                "  frame hero.png",
            ]
            .join("\r\n"),
        );
        fs::write(chars_dir.join("hero.txt"), hero_txt).expect("write hero.txt BOM+CRLF");
        // Level com CRLF.
        fs::write(
            donor.join("data").join("levels").join("stage_acao.txt"),
            [
                "name Fase Ação",
                "music data/music/tema.mod",
                "background data/bgs/stage.png",
            ]
            .join("\r\n"),
        )
        .expect("write level with CRLF");

        let report = import_openbor_project(&project, &donor)
            .expect("openbor tolerates BOM/CRLF and unicode paths");
        assert_eq!(report.imported_scenes, 1);

        let _ = fs::remove_dir_all(&donor);
        let _ = fs::remove_dir_all(&project);
    }

    // ────────────────────────────────────────────────────────────────────────
    // Fase B - SGDK Real-World Import: multi-scene, cells[] real, SceneLayer
    // ────────────────────────────────────────────────────────────────────────

    /// Pinta um PNG 128x128 com 4 quadrantes de 64x64 de cores distintas.
    /// Garante reconstrucao de `cells[]` com tiles duplicados (um por quadrante) e
    /// um dicionario nao-trivial (8 blocos unicos por quadrante repetidos).
    fn write_diverse_tilemap_png(dir: &Path, filename: &str) -> std::path::PathBuf {
        fs::create_dir_all(dir).expect("tilemap parent");
        let path = dir.join(filename);
        let mut img = image::RgbaImage::new(128, 128);
        for y in 0..128u32 {
            for x in 0..128u32 {
                let qx = x / 64;
                let qy = y / 64;
                let base: [u8; 4] = match (qx, qy) {
                    (0, 0) => [40, 180, 220, 255],
                    (1, 0) => [220, 80, 60, 255],
                    (0, 1) => [80, 220, 120, 255],
                    _ => [200, 180, 40, 255],
                };
                // Desenha um grid fino dentro do quadrante para garantir mais de
                // um tile unico por quadrante durante a dedup 8x8.
                let in_grid = (x % 8 == 0) || (y % 8 == 0);
                let rgba = if in_grid {
                    [base[0] / 2, base[1] / 2, base[2] / 2, 255]
                } else {
                    base
                };
                img.put_pixel(x, y, image::Rgba(rgba));
            }
        }
        img.save(&path).expect("write diverse tilemap png");
        path
    }

    /// Doador SGDK com 3 manifests anchor (tilemap) distintos -> 3 cenas canonicas.
    fn write_multi_scene_sgdk_donor_fixture(dir: &Path) {
        fs::create_dir_all(dir.join("res").join("images")).expect("create images dir");
        fs::create_dir_all(dir.join("res").join("maps")).expect("create maps dir");
        fs::create_dir_all(dir.join("res").join("sound")).expect("create sound dir");

        // Sprite compartilhado na cena primaria.
        image::RgbaImage::from_pixel(32, 32, image::Rgba([255, 120, 40, 255]))
            .save(dir.join("res").join("images").join("hero.png"))
            .expect("write hero sprite");
        // 3 tilemaps distintos.
        write_diverse_tilemap_png(&dir.join("res").join("maps"), "level1.png");
        write_diverse_tilemap_png(&dir.join("res").join("maps"), "level2.png");
        write_diverse_tilemap_png(&dir.join("res").join("maps"), "boss_arena.png");
        // Audio compartilhado.
        fs::write(
            dir.join("res").join("sound").join("jump.wav"),
            minimal_wav_bytes(),
        )
        .expect("write wav");
        fs::write(dir.join("res").join("sound").join("theme.xgm"), b"xgm").expect("write xgm");

        fs::write(
            dir.join("res").join("resources.res"),
            [
                "SPRITE hero images/hero.png 4 4 FAST 0",
                "MAP Level_1 maps/level1.png NONE",
                "MAP Level_2 maps/level2.png NONE",
                "IMAGE boss_arena maps/boss_arena.png NONE",
                "WAV jump sound/jump.wav 22050",
                "XGM theme sound/theme.xgm",
            ]
            .join("\n"),
        )
        .expect("write resources.res");
    }

    #[test]
    fn sgdk_phase_b_import_populates_tilemap_cells_from_png() {
        let donor = temp_dir("sgdk-phaseb-cells-donor");
        let project = temp_dir("sgdk-phaseb-cells-project");
        create_project_skeleton(&project, "SGDK Phase B Cells", "megadrive")
            .expect("create project skeleton");
        // Reutiliza a fixture generica: stage.png e 128x128 => 16x16 tiles = 256 cells.
        write_generic_sgdk_donor_fixture(&donor);

        let report = import_sgdk_project(&project, &donor).expect("import sgdk phase b cells");

        let tilemap = report
            .primary_scene
            .entities
            .iter()
            .find_map(|e| e.components.tilemap.as_ref())
            .expect("primary scene must contain tilemap entity");
        assert_eq!(tilemap.map_width, 16);
        assert_eq!(tilemap.map_height, 16);
        assert_eq!(tilemap.cells.len(), 16 * 16);
        assert!(
            tilemap.cells.iter().any(|cell| *cell > 0),
            "cells[] deve ter pelo menos um indice > 0 para PNG nao-trivial"
        );
        // Como a stage.png e cor solida, apos dedup teremos 1 tile unico
        // e todos os 256 cells apontando para indice 1.
        assert!(
            tilemap.cells.iter().all(|cell| *cell == 0 || *cell == 1),
            "cells[] deve conter apenas indices validos do dicionario"
        );

        let _ = fs::remove_dir_all(&donor);
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn sgdk_phase_b_import_builds_multi_scene_when_multiple_tilemap_anchors_exist() {
        let donor = temp_dir("sgdk-phaseb-multi-donor");
        let project = temp_dir("sgdk-phaseb-multi-project");
        create_project_skeleton(&project, "SGDK Phase B Multi", "megadrive")
            .expect("create project skeleton");
        write_multi_scene_sgdk_donor_fixture(&donor);

        let report =
            import_sgdk_project(&project, &donor).expect("import sgdk phase b multi-scene");

        // 3 tilemap anchors => 1 primary + 2 secondary = 3 scenes total.
        assert_eq!(
            report.imported_scenes,
            3,
            "doador com 3 tilemap anchors deve gerar 3 cenas ({} primary + {} additional)",
            1,
            report.additional_scenes.len()
        );
        assert_eq!(report.additional_scenes.len(), 2);

        // A cena primaria nao colapsa tudo em scenes/main.json: agora carrega
        // apenas o primeiro tilemap + sprites + audio + camera.
        let tilemap_count_primary = report
            .primary_scene
            .entities
            .iter()
            .filter(|e| e.components.tilemap.is_some())
            .count();
        assert_eq!(
            tilemap_count_primary, 1,
            "cena primaria deve ter exatamente 1 tilemap entity apos multi-scene split"
        );

        // primary_scene_path continua ancorado em scenes/main.json (sem colapso nem
        // renomeacao silenciosa quando ha varios tilemaps).
        assert_eq!(
            report.primary_scene_path, "scenes/main.json",
            "a cena primaria deve sempre mapear para scenes/main.json"
        );

        // Cada cena secundaria persistida em scenes/<slug>.json com 1 tilemap.
        for descriptor in &report.additional_scenes {
            // Todos os campos do descriptor devem estar preenchidos com dados reais.
            assert!(
                !descriptor.scene_id.trim().is_empty(),
                "descriptor.scene_id vazio para {}",
                descriptor.display_name
            );
            assert!(
                !descriptor.display_name.trim().is_empty(),
                "descriptor.display_name vazio para {}",
                descriptor.scene_id
            );
            assert!(descriptor.scene_path.starts_with("scenes/"));
            assert!(descriptor.scene_path.ends_with(".json"));
            assert_ne!(
                descriptor.scene_path, "scenes/main.json",
                "cena secundaria nao pode colidir com scenes/main.json"
            );
            // Uma cena secundaria tem apenas o tilemap entity.
            assert!(
                descriptor.entity_count >= 1,
                "descriptor.entity_count deve contar ao menos o tilemap entity"
            );
            // cells[] reais -> tilemap_cells > 0, tilemap_unique_tiles > 0.
            assert!(
                descriptor.tilemap_cells > 0,
                "descriptor.tilemap_cells deve ser > 0 quando PNG permite reconstrucao"
            );
            assert!(
                descriptor.tilemap_unique_tiles > 0,
                "descriptor.tilemap_unique_tiles deve ser > 0 quando PNG permite reconstrucao"
            );

            let abs = project.join(&descriptor.scene_path);
            assert!(
                abs.is_file(),
                "cena secundaria deve existir em disco: {}",
                abs.display()
            );
            let secondary: Scene =
                serde_json::from_str(&fs::read_to_string(&abs).expect("read secondary scene"))
                    .expect("parse secondary scene");
            // scene_id do descriptor bate com o arquivo persistido.
            assert_eq!(secondary.scene_id, descriptor.scene_id);
            let tilemap_entities: Vec<_> = secondary
                .entities
                .iter()
                .filter(|e| e.components.tilemap.is_some())
                .collect();
            assert_eq!(
                tilemap_entities.len(),
                1,
                "cena secundaria deve ter exatamente 1 tilemap"
            );
            // Entity count persistido == descriptor.entity_count.
            assert_eq!(
                secondary.entities.len(),
                descriptor.entity_count,
                "entity_count do descriptor deve bater com a cena secundaria persistida"
            );
            // cells[] reconstruidas para cada PNG de 128x128.
            let tilemap = tilemap_entities[0].components.tilemap.as_ref().unwrap();
            assert_eq!(tilemap.cells.len(), 16 * 16);
            // tilemap_cells do descriptor deve casar com o numero real de celulas.
            assert_eq!(
                descriptor.tilemap_cells,
                tilemap.cells.len(),
                "descriptor.tilemap_cells deve casar com cells.len()"
            );
            // SceneLayer derivadas em cenas secundarias tambem.
            let layers = secondary
                .layers
                .as_ref()
                .expect("secondary must have layers");
            assert!(layers.iter().any(|l| l.kind == "tile"));
            // Secundaria nao tem sprite; portanto nao deve ter layer gameplay.
            assert!(!layers.iter().any(|l| l.kind == "sprite"));
        }

        let _ = fs::remove_dir_all(&donor);
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn sgdk_phase_b_import_derives_scene_layers_grouping_entities_coherently() {
        let donor = temp_dir("sgdk-phaseb-layers-donor");
        let project = temp_dir("sgdk-phaseb-layers-project");
        create_project_skeleton(&project, "SGDK Phase B Layers", "megadrive")
            .expect("create project skeleton");
        write_generic_sgdk_donor_fixture(&donor);

        let report = import_sgdk_project(&project, &donor).expect("import sgdk phase b layers");

        let layers = report
            .primary_scene
            .layers
            .as_ref()
            .expect("cena primaria deve ter layers");

        let background = layers
            .iter()
            .find(|l| l.kind == "tile")
            .expect("layer background/tile esperada");
        assert_eq!(background.id, "layer_background");
        assert!(background.visible);
        assert!(!background.locked);
        // Tilemap entity precisa estar listado aqui.
        assert!(!background.entity_ids.is_empty());

        let gameplay = layers
            .iter()
            .find(|l| l.kind == "sprite")
            .expect("layer gameplay/sprite esperada");
        assert_eq!(gameplay.id, "layer_gameplay");
        // Gameplay contem sprite + camera.
        assert!(gameplay.entity_ids.iter().any(|id| id == "hero"));
        assert!(gameplay.entity_ids.iter().any(|id| id == "main_camera"));

        let audio = layers
            .iter()
            .find(|l| l.kind == "object")
            .expect("layer audio (object) esperada");
        assert!(audio.locked, "layer audio deve ser locked");
        assert!(audio.entity_ids.iter().any(|id| id == "audio_bank"));

        // Depth ordering coerente: background < gameplay < audio.
        assert!(background.depth < gameplay.depth);
        assert!(gameplay.depth < audio.depth);

        let _ = fs::remove_dir_all(&donor);
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn sgdk_phase_b_import_keeps_explicit_fallback_when_tilemap_source_is_too_small() {
        let donor = temp_dir("sgdk-phaseb-fallback-donor");
        let project = temp_dir("sgdk-phaseb-fallback-project");
        create_project_skeleton(&project, "SGDK Phase B Fallback", "megadrive")
            .expect("create project skeleton");

        fs::create_dir_all(donor.join("res").join("maps")).expect("create donor maps dir");
        // Tilemap com 4x4 px (menos que 8x8) => reconstrucao impossivel.
        image::RgbaImage::from_pixel(4, 4, image::Rgba([10, 20, 30, 255]))
            .save(donor.join("res").join("maps").join("tiny.png"))
            .expect("write tiny png");
        image::RgbaImage::from_pixel(32, 32, image::Rgba([200, 100, 50, 255]))
            .save(donor.join("res").join("maps").join("hero.png"))
            .expect("write hero sprite");
        fs::write(
            donor.join("res").join("resources.res"),
            [
                "SPRITE hero maps/hero.png 4 4 FAST 0",
                "IMAGE tiny maps/tiny.png NONE",
            ]
            .join("\n"),
        )
        .expect("write resources.res");

        let report = import_sgdk_project(&project, &donor).expect("import sgdk phase b fallback");

        // Fallback explicito presente porque PNG < 8x8.
        assert!(
            report
                .fallbacks
                .iter()
                .any(|f| f.contains("tilemap 'tiny'") && f.contains("cells[] vazio")),
            "fallback explicito esperado quando PNG e muito pequeno: {:?}",
            report.fallbacks
        );

        let tilemap = report
            .primary_scene
            .entities
            .iter()
            .find_map(|e| e.components.tilemap.as_ref())
            .expect("tilemap entity ainda criada com fallback");
        assert!(
            tilemap.cells.is_empty(),
            "cells[] deve permanecer vazio no fallback"
        );

        let _ = fs::remove_dir_all(&donor);
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn sgdk_phase_b_ledger_persists_scene_inventory_and_bumps_schema_version() {
        let donor = temp_dir("sgdk-phaseb-ledger-donor");
        let project = temp_dir("sgdk-phaseb-ledger-project");
        create_project_skeleton(&project, "SGDK Phase B Ledger", "megadrive")
            .expect("create project skeleton");
        write_multi_scene_sgdk_donor_fixture(&donor);

        let report = import_sgdk_project(&project, &donor).expect("import sgdk phase b ledger");
        let manifest_rel = report
            .manifest_path
            .as_deref()
            .expect("manifest_path presente no relatorio");
        let manifest_abs = project.join(manifest_rel);
        let raw = fs::read_to_string(&manifest_abs).expect("read ledger");
        let ledger: SgdkImportLedger = serde_json::from_str(&raw).expect("parse ledger json");

        assert_eq!(ledger.schema_version, SGDK_IMPORT_LEDGER_SCHEMA);
        assert_eq!(
            ledger.scenes.len(),
            report.imported_scenes,
            "ledger.scenes deve listar 1 primary + cenas secundarias"
        );
        let primary_entry = ledger
            .scenes
            .iter()
            .find(|s| s.role == "primary")
            .expect("ledger.scenes deve ter entrada primary");
        assert_eq!(primary_entry.scene_path, "scenes/main.json");
        assert!(primary_entry.tilemap_cells > 0);

        let secondaries: Vec<_> = ledger
            .scenes
            .iter()
            .filter(|s| s.role == "secondary_tilemap")
            .collect();
        assert_eq!(secondaries.len(), 2);
        for secondary in secondaries {
            assert!(secondary.scene_path.starts_with("scenes/"));
            assert_ne!(secondary.scene_path, "scenes/main.json");
            assert_eq!(secondary.tilemap_cells, 16 * 16);
        }

        let _ = fs::remove_dir_all(&donor);
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn sgdk_phase_b_reimport_multi_scene_is_idempotent_and_does_not_duplicate_scene_files() {
        let donor = temp_dir("sgdk-phaseb-reimport-donor");
        let project = temp_dir("sgdk-phaseb-reimport-project");
        create_project_skeleton(&project, "SGDK Phase B Reimport", "megadrive")
            .expect("create project skeleton");
        write_multi_scene_sgdk_donor_fixture(&donor);

        let first = import_sgdk_project(&project, &donor).expect("import sgdk first pass");
        let first_scene_files: Vec<_> = fs::read_dir(project.join("scenes"))
            .expect("list scenes after first pass")
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .collect();

        let second = import_sgdk_project(&project, &donor).expect("import sgdk second pass");
        assert_eq!(first.imported_scenes, second.imported_scenes);
        assert_eq!(
            first.additional_scenes.len(),
            second.additional_scenes.len()
        );

        let second_scene_files: Vec<_> = fs::read_dir(project.join("scenes"))
            .expect("list scenes after second pass")
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .collect();
        let mut a = first_scene_files.clone();
        let mut b = second_scene_files.clone();
        a.sort();
        b.sort();
        assert_eq!(
            a, b,
            "reimport nao pode criar arquivos de cena novos ({:?} vs {:?})",
            a, b
        );

        let _ = fs::remove_dir_all(&donor);
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn sgdk_phase_c_reimport_preserves_sprite_animations_and_collision_map() {
        let donor = temp_dir("sgdk-phasec-reimport-donor");
        let project = temp_dir("sgdk-phasec-reimport-project");
        create_project_skeleton(&project, "SGDK Phase C Reimport", "megadrive").expect("skel");
        write_generic_sgdk_donor_fixture(&donor);
        let first = import_sgdk_project(&project, &donor).expect("first import");
        let second = import_sgdk_project(&project, &donor).expect("second import");
        let h1 = first
            .primary_scene
            .entities
            .iter()
            .find(|e| e.entity_id == "hero")
            .expect("hero first");
        let h2 = second
            .primary_scene
            .entities
            .iter()
            .find(|e| e.entity_id == "hero")
            .expect("hero second");
        assert_eq!(
            h1.components.sprite.as_ref().unwrap().animations,
            h2.components.sprite.as_ref().unwrap().animations
        );
        assert_eq!(
            first.primary_scene.collision_map,
            second.primary_scene.collision_map
        );
        let _ = fs::remove_dir_all(&donor);
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn sgdk_phase_d_main_c_missing_keeps_external_refs_empty_and_emits_hint() {
        let donor = temp_dir("sgdk-phase-d-nomain");
        let project = temp_dir("sgdk-phase-d-proj");
        create_project_skeleton(&project, "SGDK D", "megadrive").expect("skel");
        fs::create_dir_all(donor.join("res").join("images")).expect("img dir");
        image::RgbaImage::from_pixel(16, 16, image::Rgba([10, 20, 30, 255]))
            .save(donor.join("res").join("images").join("hero.png"))
            .expect("hero png");
        fs::write(
            donor.join("res").join("resources.res"),
            "SPRITE hero images/hero.png 2 2 NONE\n",
        )
        .expect("res");
        let report = import_sgdk_project(&project, &donor).expect("import");
        let hero = report
            .primary_scene
            .entities
            .iter()
            .find(|e| e.entity_id == "hero")
            .expect("hero");
        let logic = hero.components.logic.as_ref().expect("logic");
        assert!(logic.external_source_refs.is_empty());
        assert!(
            logic
                .logic_hints
                .iter()
                .any(|h| h.contains("nenhum padrao distintivo")),
            "hints: {:?}",
            logic.logic_hints
        );
        let _ = fs::remove_dir_all(&donor);
        let _ = fs::remove_dir_all(&project);
    }

    #[test]
    fn sgdk_phase_e_import_edit_save_reload_and_build_emits_rom_header() {
        use crate::compiler::build_orch::{run_build_with_environment, BuildEnvironment};

        let donor = temp_dir("sgdk-phasee-d");
        let project = temp_dir("sgdk-phasee-p");
        create_project_skeleton(&project, "SGDK E2E", "megadrive").expect("skel");
        write_generic_sgdk_donor_fixture(&donor);
        import_sgdk_project(&project, &donor).expect("import");

        let mut scene = load_scene(&project, DEFAULT_ENTRY_SCENE).expect("load");
        let idx = scene
            .entities
            .iter()
            .position(|e| e.entity_id == "hero")
            .expect("hero");
        scene.entities[idx].transform.x += 13;
        save_scene(&project, DEFAULT_ENTRY_SCENE, &scene).expect("save");
        let reopen = load_scene(&project, DEFAULT_ENTRY_SCENE).expect("reopen");
        assert_eq!(
            reopen.entities[idx].transform.x,
            scene.entities[idx].transform.x
        );

        let toolchain = temp_dir("sgdk-fake-tool");
        let bin = toolchain.join("bin");
        fs::create_dir_all(&bin).expect("bin");
        let make = if cfg!(target_os = "windows") {
            let p = bin.join("fake-make.cmd");
            fs::write(
                &p,
                "@echo off\r\n\
                 if not exist out mkdir out\r\n\
                 powershell -NoProfile -Command \"$bytes = New-Object byte[] 512; [System.Text.Encoding]::ASCII.GetBytes('SEGA MEGA DRIVE').CopyTo($bytes, 256); [IO.File]::WriteAllBytes('out\\artifact.md', $bytes)\"\r\n\
                 exit /b 0\r\n",
            )
            .expect("write fake make");
            p
        } else {
            let p = bin.join("fake-make.sh");
            fs::write(
                &p,
                "#!/bin/sh\n\
                 mkdir -p out\n\
                 python3 - <<'PY'\n\
import pathlib\n\
rom = bytearray(512)\n\
rom[0x100:0x10F] = b'SEGA MEGA DRIVE'\n\
pathlib.Path('out/artifact.md').write_bytes(rom)\n\
PY\n",
            )
            .expect("write fake make");
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mut perms = fs::metadata(&p).unwrap().permissions();
                perms.set_mode(0o755);
                fs::set_permissions(&p, perms).unwrap();
            }
            p
        };
        let environment = BuildEnvironment {
            sgdk_root: Some(toolchain.clone()),
            sgdk_make_program: Some(make),
            ..BuildEnvironment::default()
        };
        let result = run_build_with_environment(&project, &environment, |_| {});
        assert!(result.ok, "build falhou: {:?}", result.log);
        let rom_bytes = fs::read(&result.rom_path).expect("rom bytes");
        assert!(
            rom_bytes.windows(15).any(|w| w == b"SEGA MEGA DRIVE"),
            "ROM deve conter cabecalho MD minimo do fake toolchain"
        );
        let _ = fs::remove_dir_all(&donor);
        let _ = fs::remove_dir_all(&project);
        let _ = fs::remove_dir_all(&toolchain);
    }

    /// Rodada 9 — Fase D expandida: quando o doador NAO exibe chamadas `XGM_*`/`SND_*`/`PSG_*`,
    /// o stencil `fire_hint` precisa ser marcado explicitamente como hipotese no `logic_hints`
    /// e o ledger nao pode publicar familias de audio que nao foram observadas textualmente.
    #[test]
    fn sgdk_phase_d_donor_without_audio_playback_flags_fire_hint_as_unbacked_hypothesis() {
        let donor = temp_dir("sgdk-phase-d-rg-noaudio-d");
        let project = temp_dir("sgdk-phase-d-rg-noaudio-p");
        create_project_skeleton(&project, "SGDK D RG NoAudio", "megadrive").expect("skel");
        // Fixture run-and-gun classica: JOY_readJoypad + MAP_scrollH + SPR_* sem playback de audio.
        write_sgdk_multifile_run_and_gun_donor(&donor);

        let report = import_sgdk_project(&project, &donor).expect("import");
        let hero = report
            .primary_scene
            .entities
            .iter()
            .find(|e| e.entity_id == "hero")
            .expect("hero primario");
        let logic = hero.components.logic.as_ref().expect("logic hero");

        // A classe run-and-gun materializa fire_hint; sem XGM/SND/PSG o hint precisa registrar a hipotese.
        let has_unbacked_hint = logic.logic_hints.iter().any(|h| {
            h.contains("stencil 'fire_hint' materializado sem evidencia textual de playback")
        });
        assert!(
            has_unbacked_hint,
            "sem audio: logic_hints deve registrar fire_hint como hipotese — hints: {:?}",
            logic.logic_hints
        );

        // Nenhuma menção a familia de audio quando nada foi detectado.
        let has_backed_hint = logic
            .logic_hints
            .iter()
            .any(|h| h.contains("familia(s) de audio detectada(s)"));
        assert!(
            !has_backed_hint,
            "sem audio: logic_hints NAO pode afirmar deteccao — hints: {:?}",
            logic.logic_hints
        );

        // Ledger precisa refletir a ausencia.
        let manifest_rel = report
            .manifest_path
            .as_deref()
            .expect("manifest_path presente no relatorio");
        let ledger_json = fs::read_to_string(project.join(manifest_rel)).expect("ledger file");
        let ledger: SgdkImportLedger =
            serde_json::from_str(&ledger_json).expect("deserializar ledger");
        assert!(
            ledger.phase_d.detected_audio_apis.is_empty(),
            "ledger.phase_d.detected_audio_apis deve estar vazio sem chamadas de audio: {:?}",
            ledger.phase_d.detected_audio_apis
        );

        let _ = fs::remove_dir_all(&donor);
        let _ = fs::remove_dir_all(&project);
    }

    /// Rodada 9 — Fase D expandida: quando o doador EXIBE `XGM_startPlay` e `SND_startPlay_PCM`
    /// alem dos sinais de classe alta, o stencil `fire_hint` precisa reportar a evidencia textual
    /// e o ledger precisa listar `audio_xgm` + `audio_snd_pcm` em `detected_audio_apis`.
    #[test]
    fn sgdk_phase_d_donor_with_xgm_and_snd_pcm_playback_tags_fire_hint_as_audio_backed() {
        let donor = temp_dir("sgdk-phase-d-rg-audio-d");
        let project = temp_dir("sgdk-phase-d-rg-audio-p");
        create_project_skeleton(&project, "SGDK D RG Audio", "megadrive").expect("skel");
        write_sgdk_multifile_run_and_gun_donor(&donor);
        // Sobrescreve `weapons_tick`-equivalente no `player_control.c` com playback textual.
        fs::write(
            donor.join("src").join("player_control.c"),
            b"#include <genesis.h>\n#include \"player_control.h\"\n\
void player_tick(void) {\n    u16 joy = JOY_readJoypad(JOY_1);\n    (void)joy;\n    /* Fixture RDS rodada 9: playback XGM + SND_PCM no agregado do doador. */\n\
    XGM_startPlay(bgm_theme);\n    SND_startPlay_PCM(sfx_fire, 22050, SOUND_PCM_CH_AUTO);\n\
    (void)SPR_addSprite(&foe_palette, &foe, 32, 32, TILE_ATTR(PAL0, 0, FALSE, FALSE));\n\
    SPR_update();\n}\n",
        )
        .expect("rewrite player_control.c with audio calls");

        let report = import_sgdk_project(&project, &donor).expect("import");
        let hero = report
            .primary_scene
            .entities
            .iter()
            .find(|e| e.entity_id == "hero")
            .expect("hero primario");
        let logic = hero.components.logic.as_ref().expect("logic hero");

        let backed_hint = logic
            .logic_hints
            .iter()
            .find(|h| h.contains("stencil 'fire_hint' tem apoio textual"))
            .cloned();
        assert!(
            backed_hint.is_some(),
            "com XGM+SND_PCM: hint de apoio textual precisa existir — hints: {:?}",
            logic.logic_hints
        );
        let backed_hint = backed_hint.unwrap();
        assert!(
            backed_hint.contains("audio_xgm"),
            "hint de apoio textual precisa citar audio_xgm: '{}'",
            backed_hint
        );
        assert!(
            backed_hint.contains("audio_snd_pcm"),
            "hint de apoio textual precisa citar audio_snd_pcm: '{}'",
            backed_hint
        );

        let unbacked_hint = logic
            .logic_hints
            .iter()
            .any(|h| h.contains("stencil 'fire_hint' materializado sem evidencia textual"));
        assert!(
            !unbacked_hint,
            "com audio: hint de hipotese NAO deve existir — hints: {:?}",
            logic.logic_hints
        );

        let manifest_rel = report
            .manifest_path
            .as_deref()
            .expect("manifest_path presente no relatorio");
        let ledger_json = fs::read_to_string(project.join(manifest_rel)).expect("ledger file");
        let ledger: SgdkImportLedger =
            serde_json::from_str(&ledger_json).expect("deserializar ledger");
        assert!(
            ledger
                .phase_d
                .detected_audio_apis
                .iter()
                .any(|f| f == "audio_xgm"),
            "ledger.phase_d.detected_audio_apis deve listar audio_xgm: {:?}",
            ledger.phase_d.detected_audio_apis
        );
        assert!(
            ledger
                .phase_d
                .detected_audio_apis
                .iter()
                .any(|f| f == "audio_snd_pcm"),
            "ledger.phase_d.detected_audio_apis deve listar audio_snd_pcm: {:?}",
            ledger.phase_d.detected_audio_apis
        );
        assert!(
            ledger
                .phase_d
                .detected_main_c_token_groups
                .iter()
                .any(|t| t == "audio_xgm"),
            "detected_main_c_token_groups deve espelhar a familia audio_xgm: {:?}",
            ledger.phase_d.detected_main_c_token_groups
        );

        let _ = fs::remove_dir_all(&donor);
        let _ = fs::remove_dir_all(&project);
    }

    /// Rodada 9 — Fase D expandida: quando existe playback mas NAO ha classe de gameplay de alta
    /// confianca (ex.: apenas XGM_startPlay num doador sem JOY/SPR/MAP_scroll), o ledger ainda
    /// registra a familia e o grafo do primario ganha um hint informativo sem materializar stencil.
    #[test]
    fn sgdk_phase_d_audio_without_high_confidence_class_records_family_in_ledger_only() {
        let donor = temp_dir("sgdk-phase-d-audioonly-d");
        let project = temp_dir("sgdk-phase-d-audioonly-p");
        create_project_skeleton(&project, "SGDK D Audio Only", "megadrive").expect("skel");
        fs::create_dir_all(donor.join("res").join("images")).expect("img dir");
        fs::create_dir_all(donor.join("src")).expect("src dir");
        image::RgbaImage::from_pixel(16, 16, image::Rgba([10, 20, 30, 255]))
            .save(donor.join("res").join("images").join("hero.png"))
            .expect("hero png");
        fs::write(
            donor.join("res").join("resources.res"),
            "SPRITE hero images/hero.png 2 2 NONE\n",
        )
        .expect("res");
        // main.c sem JOY/SPR/MAP_scroll — apenas playback XGM textual.
        fs::write(
            donor.join("src").join("main.c"),
            b"#include <genesis.h>\nint main(void) {\n    XGM_startPlay(bgm_theme);\n    return 0;\n}\n",
        )
        .expect("write main");

        let report = import_sgdk_project(&project, &donor).expect("import");
        let hero = report
            .primary_scene
            .entities
            .iter()
            .find(|e| e.entity_id == "hero")
            .expect("hero");
        let logic = hero.components.logic.as_ref().expect("logic");

        // Sem classe: o fire_hint NAO e materializado, mas o hint informativo e emitido.
        let informative = logic.logic_hints.iter().any(|h| {
            h.contains("familia(s) de audio detectada(s) no doador sem classe de gameplay")
        });
        assert!(
            informative,
            "audio sem classe: deve existir hint informativo — hints: {:?}",
            logic.logic_hints
        );
        let unbacked = logic
            .logic_hints
            .iter()
            .any(|h| h.contains("stencil 'fire_hint' materializado sem evidencia textual"));
        assert!(
            !unbacked,
            "audio sem classe: NAO deve existir hint de stencil nao apoiado (o stencil nao foi materializado): {:?}",
            logic.logic_hints
        );

        let manifest_rel = report
            .manifest_path
            .as_deref()
            .expect("manifest_path presente no relatorio");
        let ledger_json = fs::read_to_string(project.join(manifest_rel)).expect("ledger file");
        let ledger: SgdkImportLedger =
            serde_json::from_str(&ledger_json).expect("deserializar ledger");
        assert_eq!(
            ledger.phase_d.detected_audio_apis,
            vec!["audio_xgm".to_string()]
        );
        assert!(
            ledger.phase_d.heuristic_gameplay_class.is_none(),
            "audio sem classe: heuristic_gameplay_class deve ser None: {:?}",
            ledger.phase_d.heuristic_gameplay_class
        );

        let _ = fs::remove_dir_all(&donor);
        let _ = fs::remove_dir_all(&project);
    }

    /// Raiz canonica da matriz de corpus SGDK real no host de referencia (`docs/SGDK_REAL_CORPUS_VALIDATION_MATRIX.md`).
    const SGDK_MATRIX_CORPUS_ROOT: &str = r"F:\Projects\MegaDrive_DEV\SGDK_Engines";

    fn sgdk_matrix_corpus_donor_path(subdir: &str) -> PathBuf {
        Path::new(SGDK_MATRIX_CORPUS_ROOT).join(subdir)
    }

    /// Com `--ignored`, retorna `true` para sair do teste apenas se `RDS_SGDK_MATRIX_CORPUS_SKIP=1`.
    /// Caso contrario, **panic** se o doador nao existir (evita sucesso silencioso).
    fn sgdk_matrix_corpus_skip_if_missing_donor(test_fn_name: &str, donor: &Path) -> bool {
        if donor.is_dir() {
            return false;
        }
        if std::env::var("RDS_SGDK_MATRIX_CORPUS_SKIP")
            .map(|v| v == "1")
            .unwrap_or(false)
        {
            eprintln!(
                "SKIP (RDS_SGDK_MATRIX_CORPUS_SKIP=1): donor ausente para {test_fn_name} em {}",
                donor.display()
            );
            return true;
        }
        panic!(
            "{test_fn_name}: doador SGDK ausente em {}. \
             Monte o corpus neste caminho ou defina RDS_SGDK_MATRIX_CORPUS_SKIP=1 para saltar explicitamente. \
             Nao retornar Ok silencioso quando o teste e executado com --ignored.",
            donor.display()
        );
    }

    #[test]
    fn sgdk_matrix_corpus_skip_requires_explicit_env_flag_when_donor_missing() {
        let donor = temp_dir("sgdk-matrix-missing-donor-no-skip");
        let _ = fs::remove_dir_all(&donor);
        unsafe {
            std::env::remove_var("RDS_SGDK_MATRIX_CORPUS_SKIP");
        }

        let panic_result = std::panic::catch_unwind(|| {
            sgdk_matrix_corpus_skip_if_missing_donor(
                "sgdk_matrix_corpus_skip_requires_explicit_env_flag_when_donor_missing",
                &donor,
            )
        });
        assert!(
            panic_result.is_err(),
            "missing donor sem env de skip deve panic para evitar falso verde"
        );
    }

    #[test]
    fn sgdk_matrix_corpus_skip_honors_explicit_env_flag_when_donor_missing() {
        let donor = temp_dir("sgdk-matrix-missing-donor-with-skip");
        let _ = fs::remove_dir_all(&donor);
        unsafe {
            std::env::set_var("RDS_SGDK_MATRIX_CORPUS_SKIP", "1");
        }
        let skipped = sgdk_matrix_corpus_skip_if_missing_donor(
            "sgdk_matrix_corpus_skip_honors_explicit_env_flag_when_donor_missing",
            &donor,
        );
        unsafe {
            std::env::remove_var("RDS_SGDK_MATRIX_CORPUS_SKIP");
        }
        assert!(
            skipped,
            "com env explicito, helper deve diferenciar skip autorizado de sucesso de execucao"
        );
    }

    /// Fluxo parcial repetivel: import -> ledger/cenas -> sinais de superficie -> save/reload opcional -> build SGDK real -> ROM `SEGA`.
    /// `matrix_log_tag` identifica a linha no stdout (ex.: `MATRIX_P2`, `MATRIX_NEXZR`).
    fn run_sgdk_matrix_corpus_partial_flow_documents_build_blocker(
        test_fn_name: &'static str,
        donor: &Path,
        temp_slug: &'static str,
        skeleton_label: &str,
        matrix_log_tag: &'static str,
    ) {
        use crate::compiler::build_orch::{run_build_with_environment, BuildEnvironment};

        if sgdk_matrix_corpus_skip_if_missing_donor(test_fn_name, donor) {
            return;
        }

        let project = temp_dir(temp_slug);
        create_project_skeleton(&project, skeleton_label, "megadrive").expect("skel");
        let report = import_sgdk_project(&project, donor).expect("import SGDK corpus");
        stamp_imported_sgdk_metadata(&project, donor).expect("stamp imported_sgdk metadata");
        let stamped_project = load_project(&project).expect("reload project.rds after stamp");
        let stamped_source_kind = stamped_project
            .template_metadata
            .as_ref()
            .map(|m| m.source_kind.clone())
            .unwrap_or_default();
        assert_eq!(
            stamped_source_kind, "imported_sgdk",
            "matriz SGDK: source_kind esperado = imported_sgdk em project.rds"
        );

        let manifest_rel = report
            .manifest_path
            .as_deref()
            .expect("report.manifest_path (ledger .rds/imports/sgdk)");
        let ledger_path = project.join(manifest_rel);
        assert!(ledger_path.is_file(), "ledger em {}", ledger_path.display());
        let ledger_json = fs::read_to_string(&ledger_path).expect("read ledger");
        let _ledger: SgdkImportLedger =
            serde_json::from_str(&ledger_json).expect("ledger JSON valido");

        assert_eq!(report.primary_scene_path.as_str(), DEFAULT_ENTRY_SCENE);
        assert!(
            project.join(&report.primary_scene_path).is_file(),
            "cena primaria persistida"
        );
        let scene_files: Vec<_> = fs::read_dir(project.join("scenes"))
            .expect("list scenes")
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("json"))
            .collect();
        assert!(
            !scene_files.is_empty(),
            "esperado >=1 ficheiro scenes/*.json, tem {}",
            scene_files.len()
        );

        let tilemap_cells_nonempty = report.primary_scene.entities.iter().any(|e| {
            e.components
                .tilemap
                .as_ref()
                .map(|t| !t.cells.is_empty())
                .unwrap_or(false)
        });
        let sprite_anim_nonempty = report.primary_scene.entities.iter().any(|e| {
            e.components
                .sprite
                .as_ref()
                .map(|s| !s.animations.is_empty())
                .unwrap_or(false)
        });
        let collision_present = report.primary_scene.collision_map.is_some();
        let resolution_kind = report.source_summary.resolution_kind.as_str();
        let redirected = resolution_kind == "mddev_reference_redirect";
        let graph_ref_nonempty = report.primary_scene.entities.iter().any(|e| {
            e.components
                .logic
                .as_ref()
                .and_then(|l| l.graph_ref.as_ref())
                .map(|g| !g.trim().is_empty())
                .unwrap_or(false)
        });
        let md_hw = crate::hardware::md_profile::hw_status_with_source_kind(
            &report.primary_scene,
            Some("imported_sgdk"),
        );
        assert_eq!(
            md_hw.analysis_mode, "sgdk_managed",
            "matriz SGDK: hw status deve usar modo gerenciado para imported_sgdk"
        );
        eprintln!(
            "{matrix_log_tag} signals: source_kind={stamped_source_kind} resolution_kind={resolution_kind} redirected={redirected} effective_root={} tilemap_cells_nonempty={tilemap_cells_nonempty} sprite_anim_nonempty={sprite_anim_nonempty} collision_present={collision_present} graph_ref_nonempty={graph_ref_nonempty} imported_scenes={} warnings={}",
            report.source_summary.effective_root,
            report.imported_scenes,
            report.warnings.len()
        );
        eprintln!(
            "{matrix_log_tag} hw: mode={} total_kb={} resident_kb={} spr_res_kb={} tile_kb={} hud_kb={} strm_spr_kb={} anim_sw_kb={} streamable_kb={} dma_frame_kb={} banks={}/{} cells={}/{} fatal={} warn={}",
            md_hw.analysis_mode,
            md_hw.project_asset_bytes / 1024,
            md_hw.resident_vram_bytes / 1024,
            md_hw.sprite_resident_bytes / 1024,
            md_hw.tilemap_resident_bytes / 1024,
            md_hw.hud_resident_bytes / 1024,
            md_hw.streamable_sprite_bytes / 1024,
            md_hw.animated_swap_bytes / 1024,
            md_hw.streamable_vram_bytes / 1024,
            md_hw.dma_frame_bytes / 1024,
            md_hw.managed_concurrent_sprite_banks,
            crate::hardware::md_profile::MD_MANAGED_MAX_CONCURRENT_BANKS,
            md_hw.managed_sprite_cells_used,
            crate::hardware::md_profile::MD_MANAGED_SPRITE_CELL_BUDGET,
            md_hw.errors.len(),
            md_hw.warnings.len()
        );

        let mut scene = load_scene(&project, DEFAULT_ENTRY_SCENE).expect("load pos-import");
        if let Some(idx) = scene
            .entities
            .iter()
            .position(|e| e.components.sprite.is_some())
        {
            scene.entities[idx].transform.x += 7;
            save_scene(&project, DEFAULT_ENTRY_SCENE, &scene).expect("save");
            let reopen = load_scene(&project, DEFAULT_ENTRY_SCENE).expect("reopen");
            assert_eq!(
                reopen.entities[idx].transform.x, scene.entities[idx].transform.x,
                "persistencia/reopen"
            );
        }

        let env = BuildEnvironment::detect();
        assert!(
            env.sgdk_root.as_ref().is_some_and(|r| r.join("makefile.gen").is_file())
                && env.sgdk_make_program.is_some(),
            "{matrix_log_tag}: SGDK real nao detectado; fake toolchain nao e aceito como prova de matriz"
        );
        let result = run_build_with_environment(&project, &env, |_| {});
        assert!(
            result.ok,
            "{matrix_log_tag}: build SGDK real falhou: {:?}",
            result.log
        );
        assert!(
            !result.rom_path.is_empty(),
            "{matrix_log_tag}: build SGDK real nao reportou ROM"
        );
        let rom_full = {
            let path = PathBuf::from(&result.rom_path);
            if path.is_absolute() {
                path
            } else {
                project.join(path)
            }
        };
        let rom_bytes = fs::read(&rom_full).unwrap_or_else(|error| {
            panic!(
                "{matrix_log_tag}: falha ao ler ROM SGDK real '{}': {}",
                rom_full.display(),
                error
            )
        });
        let rom_has_sega = rom_bytes.windows(4).any(|w| w == b"SEGA");
        eprintln!(
            "{matrix_log_tag} build: source_kind={stamped_source_kind} resolution_kind={resolution_kind} redirected={redirected} mode=sgdk_detect_real rom_sega={rom_has_sega} rom={}",
            rom_full.display()
        );

        assert!(
            rom_has_sega,
            "{matrix_log_tag}: esperado ROM com marca SEGA apos build SGDK real"
        );

        let _ = fs::remove_dir_all(&project);
    }

    /// Matriz SGDK corpus real — linha 1 (plataforma / estudo). Ver `docs/SGDK_REAL_CORPUS_VALIDATION_MATRIX.md`.
    /// Ignorado no `cargo test` normal. Com `--ignored`, panic se doador ausente salvo `RDS_SGDK_MATRIX_CORPUS_SKIP=1`.
    ///
    /// `cargo test sgdk_matrix_corpus_platformer_2_partial_flow_documents_build_blocker --manifest-path src-tauri/Cargo.toml --lib -- --ignored --nocapture --test-threads=1`
    #[ignore]
    #[test]
    fn sgdk_matrix_corpus_platformer_2_partial_flow_documents_build_blocker() {
        let donor = sgdk_matrix_corpus_donor_path(
            "Platformer 2 [VER.001] [SGDK 211] [GEN] [ESTUDO] [PLATAFORMA]",
        );
        run_sgdk_matrix_corpus_partial_flow_documents_build_blocker(
            "sgdk_matrix_corpus_platformer_2_partial_flow_documents_build_blocker",
            &donor,
            "sgdk-matrix-p2",
            "Matrix Platformer2 Corpus",
            "MATRIX_P2",
        );
    }

    /// Linha 2 — engine plataforma (corpus real).
    #[ignore]
    #[test]
    fn sgdk_matrix_corpus_platformer_engine_partial_flow_documents_build_blocker() {
        let donor = sgdk_matrix_corpus_donor_path(
            "PlatformerEngine [VER.1.0] [SGDK 211] [GEN] [ENGINE] [PLATAFORMA]",
        );
        run_sgdk_matrix_corpus_partial_flow_documents_build_blocker(
            "sgdk_matrix_corpus_platformer_engine_partial_flow_documents_build_blocker",
            &donor,
            "sgdk-matrix-pe",
            "Matrix PlatformerEngine Corpus",
            "MATRIX_PE",
        );
    }

    /// Linha 3 — plataforma / estudo (Shadow Dancer revisitado).
    #[ignore]
    #[test]
    fn sgdk_matrix_corpus_shadow_dancer_revisitado_partial_flow_documents_build_blocker() {
        let donor = sgdk_matrix_corpus_donor_path(
            "Shadow Dancer Revisitado [VER.001] [SGDK 211] [GEN] [ESTUDO] [PLATAFORMA]",
        );
        run_sgdk_matrix_corpus_partial_flow_documents_build_blocker(
            "sgdk_matrix_corpus_shadow_dancer_revisitado_partial_flow_documents_build_blocker",
            &donor,
            "sgdk-matrix-sd",
            "Matrix ShadowDancer Corpus",
            "MATRIX_SD",
        );
    }

    /// Linha 4 — run-and-gun (Metal Slug Warfare Demo).
    #[ignore]
    #[test]
    fn sgdk_matrix_corpus_metal_slug_warfare_demo_partial_flow_documents_build_blocker() {
        let donor = sgdk_matrix_corpus_donor_path(
            "Metal Slug Warfare Demo [VER.001] [SGDK 211] [GEN] [ESTUDO] [RUN AND GUN]",
        );
        run_sgdk_matrix_corpus_partial_flow_documents_build_blocker(
            "sgdk_matrix_corpus_metal_slug_warfare_demo_partial_flow_documents_build_blocker",
            &donor,
            "sgdk-matrix-ms",
            "Matrix MetalSlugWarfare Corpus",
            "MATRIX_MS",
        );
    }

    /// Linha 5 — engine luta (Mortal Kombat Plus).
    #[ignore]
    #[test]
    fn sgdk_matrix_corpus_mortal_kombat_plus_partial_flow_documents_build_blocker() {
        let donor = sgdk_matrix_corpus_donor_path(
            "Mortal Kombat Plus [VER.001] [SGDK 211] [GEN] [ENGINE] [LUTA]",
        );
        run_sgdk_matrix_corpus_partial_flow_documents_build_blocker(
            "sgdk_matrix_corpus_mortal_kombat_plus_partial_flow_documents_build_blocker",
            &donor,
            "sgdk-matrix-mk",
            "Matrix MortalKombatPlus Corpus",
            "MATRIX_MK",
        );
    }

    /// Linha 6 — shmup (NEXZR MD).
    #[ignore]
    #[test]
    fn sgdk_matrix_corpus_nexzr_md_partial_flow_documents_build_blocker() {
        let donor =
            sgdk_matrix_corpus_donor_path("NEXZR MD [VER.001] [SGDK 211] [GEN] [GAME] [SHMUP]");
        run_sgdk_matrix_corpus_partial_flow_documents_build_blocker(
            "sgdk_matrix_corpus_nexzr_md_partial_flow_documents_build_blocker",
            &donor,
            "sgdk-matrix-nx",
            "Matrix NEXZR Corpus",
            "MATRIX_NEXZR",
        );
    }

    /// Linha 7 (rodada 14) — engine beat 'em up / briga de rua (BLAZE_ENGINE).
    #[ignore]
    #[test]
    fn sgdk_matrix_corpus_blaze_engine_partial_flow_documents_build_blocker() {
        use crate::compiler::build_orch::{run_build_with_environment, BuildEnvironment};
        use crate::emulator::frame_buffer::framebuffer_to_rgba;
        use crate::emulator::libretro_ffi::{EmulatorCore, JoypadState};

        let donor = sgdk_matrix_corpus_donor_path(
            "BLAZE_ENGINE [VER.001] [SGDK 211] [GEN] [ENGINE] [BRIGA DE RUA]",
        );
        if sgdk_matrix_corpus_skip_if_missing_donor(
            "sgdk_matrix_corpus_blaze_engine_partial_flow_documents_build_blocker",
            &donor,
        ) {
            return;
        }

        let artifact_root = validation_artifact_dir("sgdk-blaze-compatible-real");
        let project = artifact_root.join("project");
        let _ = fs::remove_dir_all(&artifact_root);
        fs::create_dir_all(&artifact_root).expect("create BLAZE validation artifact dir");
        create_project_skeleton(&project, "Matrix BLAZE Engine Corpus", "megadrive").expect("skel");
        let report = import_sgdk_project(&project, &donor).expect("import SGDK corpus blaze");
        stamp_imported_sgdk_metadata(&project, &donor).expect("stamp imported_sgdk metadata");

        let md_hw = crate::hardware::md_profile::hw_status_with_source_kind(
            &report.primary_scene,
            Some("imported_sgdk"),
        );
        eprintln!(
            "MATRIX_BLAZE hw: mode={} total_kb={} resident_kb={} spr_res_kb={} tile_kb={} hud_kb={} strm_spr_kb={} anim_sw_kb={} streamable_kb={} dma_frame_kb={} banks={}/{} cells={}/{} fatal={} warn={}",
            md_hw.analysis_mode,
            md_hw.project_asset_bytes / 1024,
            md_hw.resident_vram_bytes / 1024,
            md_hw.sprite_resident_bytes / 1024,
            md_hw.tilemap_resident_bytes / 1024,
            md_hw.hud_resident_bytes / 1024,
            md_hw.streamable_sprite_bytes / 1024,
            md_hw.animated_swap_bytes / 1024,
            md_hw.streamable_vram_bytes / 1024,
            md_hw.dma_frame_bytes / 1024,
            md_hw.managed_concurrent_sprite_banks,
            crate::hardware::md_profile::MD_MANAGED_MAX_CONCURRENT_BANKS,
            md_hw.managed_sprite_cells_used,
            crate::hardware::md_profile::MD_MANAGED_SPRITE_CELL_BUDGET,
            md_hw.errors.len(),
            md_hw.warnings.len()
        );
        assert_eq!(md_hw.analysis_mode, "sgdk_managed");
        assert!(
            md_hw.project_asset_bytes > md_hw.resident_vram_bytes,
            "BLAZE deve expor diferenca entre total e residente"
        );
        assert!(
            !md_hw.errors.is_empty(),
            "BLAZE original deve continuar expondo blocker legitimo de hardware antes da transformacao"
        );
        assert!(
            md_hw.resident_vram_bytes > crate::hardware::md_profile::MD_VRAM_BYTES
                || md_hw.errors.iter().any(|e| e.contains("Sprite overflow")),
            "BLAZE deve bloquear por residencia real ou por limite de sprites"
        );

        let env = BuildEnvironment::detect();
        assert!(
            env.sgdk_root
                .as_ref()
                .is_some_and(|r| r.join("makefile.gen").is_file())
                && env.sgdk_make_program.is_some(),
            "BLAZE compat real exige SGDK real detectado; fake toolchain nao e prova valida"
        );
        let result = run_build_with_environment(&project, &env, |_| {});
        assert!(
            result.ok,
            "BLAZE deve gerar build SGDK real com perfil de compatibilidade conservador: {:?}",
            result.log
        );
        assert!(
            result.log.iter().any(|entry| entry.level == "info"
                && entry
                    .message
                    .contains("MD VRAM analysis: mode=sgdk_managed")
                && entry.message.contains("spr_res=")
                && entry.message.contains("banks=")),
            "log deve expor breakdown de VRAM/residencia por categoria e uso de banks/cells"
        );
        assert!(
            result.log.iter().any(|entry| {
                entry.level == "warn"
                    && entry.message.contains("SGDK compatibility profile")
                    && entry.message.contains("sprite culling")
                    && entry.message.contains("multiplex")
            }),
            "BLAZE deve documentar transformacao conservadora de sprite culling/multiplex no build"
        );
        let compat_budget_line = result
            .log
            .iter()
            .find(|entry| {
                entry.level == "info"
                    && entry.message.contains("MD VRAM compatibility:")
                    && entry.message.contains("banks=")
            })
            .map(|entry| entry.message.clone())
            .expect("BLAZE compat log deve incluir budget depois da transformacao");
        let rom_full = {
            let path = PathBuf::from(&result.rom_path);
            if path.is_absolute() {
                path
            } else {
                project.join(path)
            }
        };
        let rom_bytes = fs::read(&rom_full).expect("read compatible BLAZE ROM");
        assert!(
            rom_bytes.windows(4).any(|w| w == b"SEGA"),
            "BLAZE compat SGDK real deve gerar ROM com assinatura SEGA"
        );
        let persistent_rom_path = artifact_root.join("blaze-compatible-real.md");
        fs::copy(&rom_full, &persistent_rom_path).expect("copy persistent BLAZE ROM");

        let mut emulator = EmulatorCore::new(None);
        emulator
            .load_rom(&persistent_rom_path)
            .unwrap_or_else(|error| {
                panic!("BLAZE compat ROM real nao carregou no Libretro: {}", error)
            });
        emulator
            .set_joypad(JoypadState {
                right: true,
                ..JoypadState::default()
            })
            .expect("set BLAZE compat joypad input");
        for _ in 0..60 {
            emulator
                .run_frame()
                .unwrap_or_else(|error| panic!("BLAZE compat frame falhou: {}", error));
        }
        let core_label = emulator
            .loaded_core_label()
            .unwrap_or("unknown-libretro-core")
            .to_string();
        let (framebuffer, frame_size, pixel_format) = emulator
            .get_framebuffer()
            .unwrap_or_else(|error| panic!("BLAZE compat framebuffer falhou: {}", error));
        let frame = framebuffer_to_rgba(&framebuffer, frame_size, pixel_format);
        let non_black_pixels = frame
            .rgba
            .chunks_exact(4)
            .filter(|px| px[0] != 0 || px[1] != 0 || px[2] != 0)
            .count();
        assert!(
            non_black_pixels > 0,
            "BLAZE compat emulation framebuffer should not be fully black"
        );
        let framebuffer_path = artifact_root.join("blaze-compatible-frame.ppm");
        write_rgba_ppm(&framebuffer_path, frame.width, frame.height, &frame.rgba);
        emulator.stop().expect("stop BLAZE emulator");

        let build_log_path = artifact_root.join("blaze-compatible-build.log");
        fs::write(
            &build_log_path,
            result
                .log
                .iter()
                .map(|entry| format!("[{}] {}", entry.level, entry.message))
                .collect::<Vec<_>>()
                .join("\n"),
        )
        .expect("write BLAZE build log");
        let report_path = artifact_root.join("blaze-compatible-report.json");
        let report_md_path = artifact_root.join("blaze-compatible-report.md");
        let report_json = serde_json::json!({
            "donor": donor.to_string_lossy(),
            "project_path": project.to_string_lossy(),
            "rom_path": persistent_rom_path.to_string_lossy(),
            "build_log": build_log_path.to_string_lossy(),
            "framebuffer_ppm": framebuffer_path.to_string_lossy(),
            "libretro_core": core_label,
            "frames_run": 60,
            "framebuffer_width": frame.width,
            "framebuffer_height": frame.height,
            "non_black_pixels": non_black_pixels,
            "fake_toolchain_used": false,
            "original_budget": {
                "mode": md_hw.analysis_mode,
                "total_kb": md_hw.project_asset_bytes / 1024,
                "resident_kb": md_hw.resident_vram_bytes / 1024,
                "sprite_resident_kb": md_hw.sprite_resident_bytes / 1024,
                "streamable_kb": md_hw.streamable_vram_bytes / 1024,
                "dma_frame_kb": md_hw.dma_frame_bytes / 1024,
                "banks_used": md_hw.managed_concurrent_sprite_banks,
                "banks_limit": crate::hardware::md_profile::MD_MANAGED_MAX_CONCURRENT_BANKS,
                "cells_used": md_hw.managed_sprite_cells_used,
                "cells_limit": crate::hardware::md_profile::MD_MANAGED_SPRITE_CELL_BUDGET,
                "fatal_count": md_hw.errors.len(),
                "warning_count": md_hw.warnings.len()
            },
            "compat_budget_log": compat_budget_line,
            "tradeoffs": [
                "sprite culling deterministico",
                "multiplex plan para sprites fora da janela ativa",
                "streaming conservador para assets nao residentes"
            ]
        });
        fs::write(
            &report_path,
            format!(
                "{}\n",
                serde_json::to_string_pretty(&report_json).expect("serialize BLAZE report")
            ),
        )
        .expect("write BLAZE JSON report");
        fs::write(
            &report_md_path,
            format!(
                "# BLAZE_ENGINE Compatibility Build\n\n- Donor: `{}`\n- ROM: `{}`\n- Core: `{}`\n- Frames run: `60`\n- Non-black pixels: `{}`\n- Fake toolchain used: `false`\n- Original budget: mode `{}`, total `{}KB`, resident `{}KB`, dma/frame `{}KB`, fatal `{}`\n- Compatibility budget: `{}`\n",
                donor.display(),
                persistent_rom_path.display(),
                report_json["libretro_core"].as_str().unwrap_or("unknown-libretro-core"),
                non_black_pixels,
                md_hw.analysis_mode,
                md_hw.project_asset_bytes / 1024,
                md_hw.resident_vram_bytes / 1024,
                md_hw.dma_frame_bytes / 1024,
                md_hw.errors.len(),
                report_json["compat_budget_log"].as_str().unwrap_or("")
            ),
        )
        .expect("write BLAZE Markdown report");
    }

    #[derive(Debug, serde::Serialize, Clone)]
    struct SgdkCorpusRealBuildEntry {
        project_name: String,
        donor_path: String,
        project_path: String,
        import_ok: bool,
        imported_scenes: usize,
        bridge_nodes: usize,
        build_real_ok: bool,
        rom_real_ok: bool,
        emulation_real_ok: bool,
        rom_path: Option<String>,
        framebuffer_ppm: Option<String>,
        libretro_core: Option<String>,
        frames_run: u32,
        framebuffer_width: u32,
        framebuffer_height: u32,
        non_black_pixels: usize,
        original_budget_total_kb: u64,
        original_budget_resident_kb: u64,
        original_budget_dma_frame_kb: u64,
        original_budget_fatal_count: usize,
        fake_toolchain_used: bool,
        bridge_only: bool,
        failure_reason: Option<String>,
    }

    fn count_non_black_rgba_pixels(rgba: &[u8]) -> usize {
        rgba.chunks_exact(4)
            .filter(|px| px[0] != 0 || px[1] != 0 || px[2] != 0)
            .count()
    }

    fn corpus_libretro_visible_smoke(
        rom_path: &Path,
    ) -> Result<(usize, String, u32, u32, u32, Vec<u8>), String> {
        use crate::emulator::frame_buffer::framebuffer_to_rgba;
        use crate::emulator::libretro_ffi::{EmulatorCore, JoypadState};

        let mut emulator = EmulatorCore::new(None);
        emulator
            .load_rom(rom_path)
            .map_err(|error| format!("load real ROM in Libretro: {error}"))?;

        let joypad_phases = [
            (90u32, JoypadState::default()),
            (
                90,
                JoypadState {
                    start: true,
                    ..JoypadState::default()
                },
            ),
            (
                90,
                JoypadState {
                    start: true,
                    right: true,
                    ..JoypadState::default()
                },
            ),
            (
                90,
                JoypadState {
                    start: true,
                    right: true,
                    a: true,
                    ..JoypadState::default()
                },
            ),
            (
                90,
                JoypadState {
                    start: true,
                    a: true,
                    b: true,
                    ..JoypadState::default()
                },
            ),
        ];

        let mut total_frames = 0u32;
        let mut best_non_black = 0usize;
        let mut best_frame = None;

        for (frame_budget, joypad) in joypad_phases {
            emulator
                .set_joypad(joypad)
                .map_err(|error| format!("set joypad: {error}"))?;
            for _ in 0..frame_budget {
                emulator
                    .run_frame()
                    .map_err(|error| format!("run Libretro frame: {error}"))?;
                total_frames += 1;
            }
            let (framebuffer, frame_size, pixel_format) = emulator
                .get_framebuffer()
                .map_err(|error| format!("capture Libretro framebuffer: {error}"))?;
            let frame = framebuffer_to_rgba(&framebuffer, frame_size, pixel_format);
            if frame.width == 0 || frame.height == 0 || frame.rgba.is_empty() {
                return Err("Libretro framebuffer is empty".to_string());
            }
            let non_black_pixels = count_non_black_rgba_pixels(&frame.rgba);
            if non_black_pixels > best_non_black {
                best_non_black = non_black_pixels;
                best_frame = Some((frame.width, frame.height, frame.rgba.clone()));
            }
            if best_non_black > 0 {
                break;
            }
        }

        let core_label = emulator
            .loaded_core_label()
            .map(str::to_string)
            .unwrap_or_else(|| "unknown-libretro-core".to_string());
        emulator
            .stop()
            .map_err(|error| format!("stop Libretro core: {error}"))?;

        if best_non_black == 0 {
            return Err(format!(
                "Libretro framebuffer fully black after {total_frames} frames"
            ));
        }

        let (width, height, rgba) = best_frame
            .ok_or_else(|| "Libretro visible smoke missing framebuffer payload".to_string())?;
        Ok((best_non_black, core_label, total_frames, width, height, rgba))
    }

    fn sgdk_real_corpus_slug(name: &str, index: usize) -> String {
        let slug: String = name
            .chars()
            .map(|ch| {
                if ch.is_ascii_alphanumeric() {
                    ch.to_ascii_lowercase()
                } else {
                    '-'
                }
            })
            .collect::<String>()
            .split('-')
            .filter(|part| !part.is_empty())
            .take(8)
            .collect::<Vec<_>>()
            .join("-");
        if slug.is_empty() {
            format!("project-{index:03}")
        } else {
            format!("{index:03}-{slug}")
        }
    }

    fn write_sgdk_corpus_real_build_report(
        artifact_root: &Path,
        entries: &[SgdkCorpusRealBuildEntry],
        total_projects: usize,
    ) {
        let build_real_ok = entries.iter().filter(|entry| entry.build_real_ok).count();
        let rom_real_ok = entries.iter().filter(|entry| entry.rom_real_ok).count();
        let emulation_real_ok = entries
            .iter()
            .filter(|entry| entry.emulation_real_ok)
            .count();
        let emulation_visible_ok = entries
            .iter()
            .filter(|entry| entry.emulation_real_ok && entry.non_black_pixels > 0)
            .count();
        let bridge_only = entries.iter().filter(|entry| entry.bridge_only).count();
        let failed = entries
            .iter()
            .filter(|entry| entry.failure_reason.is_some())
            .count();
        let stable_candidate = entries.len() == total_projects
            && total_projects > 0
            && entries.iter().all(|entry| {
                entry.import_ok
                    && entry.failure_reason.is_none()
                    && !entry.fake_toolchain_used
                    && (entry.bridge_only
                        || (entry.build_real_ok
                            && entry.rom_real_ok
                            && entry.emulation_real_ok
                            && entry.non_black_pixels > 0))
            });
        let summary = serde_json::json!({
            "total_projects": total_projects,
            "processed": entries.len(),
            "build_real_ok": build_real_ok,
            "rom_real_ok": rom_real_ok,
            "emulation_real_ok": emulation_real_ok,
            "emulation_visible_ok": emulation_visible_ok,
            "bridge_only": bridge_only,
            "failed": failed,
            "stable_candidate": stable_candidate,
            "fake_toolchain_used": false,
            "entries": entries,
        });
        let json_path = artifact_root.join("sgdk-corpus-real-build-report.json");
        fs::write(
            &json_path,
            format!(
                "{}\n",
                serde_json::to_string_pretty(&summary)
                    .expect("serialize SGDK real corpus build report")
            ),
        )
        .expect("write SGDK real corpus JSON report");

        let failed_lines = entries
            .iter()
            .filter_map(|entry| {
                entry.failure_reason.as_ref().map(|reason| {
                    format!(
                        "- `{}`: {} (build={}, rom={}, emu={})",
                        entry.project_name,
                        reason,
                        entry.build_real_ok,
                        entry.rom_real_ok,
                        entry.emulation_real_ok
                    )
                })
            })
            .collect::<Vec<_>>()
            .join("\n");
        let md_path = artifact_root.join("sgdk-corpus-real-build-report.md");
        fs::write(
            &md_path,
            format!(
                "# SGDK Corpus Real Build Report\n\n- Total projects: `{}`\n- Processed: `{}`\n- Build real OK: `{}`\n- ROM real OK: `{}`\n- Emulation real OK: `{}`\n- Emulation visible OK: `{}`\n- Bridge only: `{}`\n- Failed: `{}`\n- Stable candidate: `{}`\n- Fake toolchain used: `false`\n\n## Failures\n{}\n",
                total_projects,
                entries.len(),
                build_real_ok,
                rom_real_ok,
                emulation_real_ok,
                emulation_visible_ok,
                bridge_only,
                failed,
                stable_candidate,
                if failed_lines.is_empty() {
                    "- none".to_string()
                } else {
                    failed_lines
                }
            ),
        )
        .expect("write SGDK real corpus Markdown report");
    }

    fn execute_sgdk_corpus_real_build_rom_emulation_report() {
        use crate::compiler::build_orch::{run_build_with_environment, BuildEnvironment};
        use crate::core::sgdk_corpus_inventory::inspect_sgdk_project_for_nocode_inventory;

        std::env::set_var("RDS_EXTRA_FLAGS", "-DRDS_CORPUS_VISIBLE_SMOKE");
        let corpus_filter = std::env::var("RDS_SGDK_REAL_CORPUS_FILTER")
            .ok()
            .map(|value| {
                value
                    .split(',')
                    .map(str::trim)
                    .filter(|part| !part.is_empty())
                    .map(str::to_ascii_lowercase)
                    .collect::<Vec<_>>()
            })
            .filter(|parts| !parts.is_empty());

        let corpus_root = std::env::var("RDS_SGDK_CORPUS_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(SGDK_MATRIX_CORPUS_ROOT));
        assert!(
            corpus_root.is_dir(),
            "SGDK corpus root ausente: {}",
            corpus_root.display()
        );
        let mut donors = fs::read_dir(&corpus_root)
            .expect("list SGDK corpus root")
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.path().is_dir())
            .map(|entry| {
                (
                    entry.file_name().to_string_lossy().to_string(),
                    entry.path(),
                )
            })
            .collect::<Vec<_>>();
        donors.sort_by(|left, right| left.0.cmp(&right.0));
        assert!(
            !donors.is_empty(),
            "SGDK real corpus runner precisa de pelo menos um projeto"
        );

        let env = BuildEnvironment::detect();
        assert!(
            env.sgdk_root
                .as_ref()
                .is_some_and(|r| r.join("makefile.gen").is_file())
                && env.sgdk_make_program.is_some(),
            "SGDK real nao detectado; fake toolchain nao e aceito no corpus real"
        );

        let artifact_root = validation_artifact_dir("sgdk-corpus-real-build");
        let resume = std::env::var("RDS_SGDK_REAL_CORPUS_RESUME")
            .map(|value| value == "1")
            .unwrap_or(false);
        if !resume {
            let _ = fs::remove_dir_all(&artifact_root);
        }
        fs::create_dir_all(artifact_root.join("projects")).expect("create corpus projects dir");
        fs::create_dir_all(artifact_root.join("roms")).expect("create corpus roms dir");
        fs::create_dir_all(artifact_root.join("frames")).expect("create corpus frames dir");

        let mut entries = Vec::new();
        let max_projects = std::env::var("RDS_SGDK_REAL_CORPUS_MAX")
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(donors.len());

        for (index, (project_name, donor)) in donors.iter().take(max_projects).enumerate() {
            if let Some(filter) = &corpus_filter {
                let normalized = project_name.to_ascii_lowercase();
                if !filter
                    .iter()
                    .any(|needle| normalized.contains(needle.as_str()))
                {
                    continue;
                }
            }
            let slug = sgdk_real_corpus_slug(project_name, index + 1);
            let project_dir = artifact_root.join("projects").join(&slug);
            let mut entry = SgdkCorpusRealBuildEntry {
                project_name: project_name.clone(),
                donor_path: donor.to_string_lossy().to_string(),
                project_path: project_dir.to_string_lossy().to_string(),
                import_ok: false,
                imported_scenes: 0,
                bridge_nodes: 0,
                build_real_ok: false,
                rom_real_ok: false,
                emulation_real_ok: false,
                rom_path: None,
                framebuffer_ppm: None,
                libretro_core: None,
                frames_run: 0,
                framebuffer_width: 0,
                framebuffer_height: 0,
                non_black_pixels: 0,
                original_budget_total_kb: 0,
                original_budget_resident_kb: 0,
                original_budget_dma_frame_kb: 0,
                original_budget_fatal_count: 0,
                fake_toolchain_used: false,
                bridge_only: false,
                failure_reason: None,
            };

            let project_result: Result<(), String> = (|| {
                if project_dir.exists() {
                    fs::remove_dir_all(&project_dir).map_err(|error| {
                        format!(
                            "falha ao limpar projeto persistente '{}': {}",
                            project_dir.display(),
                            error
                        )
                    })?;
                }
                create_project_skeleton(&project_dir, project_name, "megadrive")
                    .map_err(|error| format!("create_project_skeleton: {error}"))?;
                let report = match import_sgdk_project(&project_dir, donor) {
                    Ok(report) => report,
                    Err(error)
                        if error.0.contains("nenhum manifesto .res foi encontrado")
                            || error.0.contains("nenhum manifesto .res")
                            || error.0.contains("asset inexistente")
                            || error.0.contains("nao possuem recursos suportados") =>
                    {
                        let inventory = inspect_sgdk_project_for_nocode_inventory(donor).map_err(
                            |inventory_error| {
                                format!(
                                    "import_sgdk_project: {}; bridge inventory failed: {}",
                                    error.0, inventory_error
                                )
                            },
                        )?;
                        let bridge_dir = project_dir.join(".rds").join("imports").join("sgdk");
                        fs::create_dir_all(&bridge_dir).map_err(|create_error| {
                            format!(
                                "create SGDK bridge inventory dir '{}': {}",
                                bridge_dir.display(),
                                create_error
                            )
                        })?;
                        let bridge_path = bridge_dir.join("source-bridge-inventory.json");
                        fs::write(
                            &bridge_path,
                            format!(
                                "{}\n",
                                serde_json::to_string_pretty(&inventory).map_err(
                                    |serialize_error| {
                                        format!("serialize bridge inventory: {serialize_error}")
                                    }
                                )?
                            ),
                        )
                        .map_err(|write_error| {
                            format!(
                                "write SGDK bridge inventory '{}': {}",
                                bridge_path.display(),
                                write_error
                            )
                        })?;
                        stamp_imported_sgdk_metadata(&project_dir, donor).map_err(
                            |stamp_error| format!("stamp_imported_sgdk_metadata: {stamp_error}"),
                        )?;
                        entry.import_ok = true;
                        entry.imported_scenes = 1;
                        entry.bridge_nodes = inventory.node_candidates.len();
                        entry.bridge_only = true;
                        return Ok(());
                    }
                    Err(error) => return Err(format!("import_sgdk_project: {}", error.0)),
                };
                stamp_imported_sgdk_metadata(&project_dir, donor)
                    .map_err(|error| format!("stamp_imported_sgdk_metadata: {error}"))?;
                entry.import_ok = true;
                entry.imported_scenes = report.imported_scenes;
                entry.bridge_nodes = report
                    .primary_scene
                    .entities
                    .iter()
                    .filter(|entity| {
                        entity
                            .components
                            .logic
                            .as_ref()
                            .and_then(|logic| logic.graph_ref.as_ref())
                            .is_some()
                    })
                    .count();
                let md_hw = crate::hardware::md_profile::hw_status_with_source_kind(
                    &report.primary_scene,
                    Some("imported_sgdk"),
                );
                entry.original_budget_total_kb = u64::from(md_hw.project_asset_bytes / 1024);
                entry.original_budget_resident_kb = u64::from(md_hw.resident_vram_bytes / 1024);
                entry.original_budget_dma_frame_kb = u64::from(md_hw.dma_frame_bytes / 1024);
                entry.original_budget_fatal_count = md_hw.errors.len();

                let build = run_build_with_environment(&project_dir, &env, |_| {});
                if !build.ok {
                    let tail = build
                        .log
                        .iter()
                        .rev()
                        .take(8)
                        .map(|line| format!("[{}] {}", line.level, line.message))
                        .collect::<Vec<_>>()
                        .into_iter()
                        .rev()
                        .collect::<Vec<_>>()
                        .join(" | ");
                    return Err(format!("real SGDK build failed: {tail}"));
                }
                entry.build_real_ok = true;
                if build.rom_path.trim().is_empty() {
                    return Err("real SGDK build did not report a ROM path".to_string());
                }
                let rom_full = {
                    let path = PathBuf::from(&build.rom_path);
                    if path.is_absolute() {
                        path
                    } else {
                        project_dir.join(path)
                    }
                };
                let rom_bytes = fs::read(&rom_full)
                    .map_err(|error| format!("read real ROM '{}': {error}", rom_full.display()))?;
                if !rom_bytes.windows(4).any(|window| window == b"SEGA") {
                    return Err(format!(
                        "real ROM '{}' lacks Mega Drive SEGA header",
                        rom_full.display()
                    ));
                }
                entry.rom_real_ok = true;
                let persistent_rom = artifact_root.join("roms").join(format!("{slug}.md"));
                fs::copy(&rom_full, &persistent_rom).map_err(|error| {
                    format!(
                        "copy real ROM '{}' to '{}': {}",
                        rom_full.display(),
                        persistent_rom.display(),
                        error
                    )
                })?;
                entry.rom_path = Some(persistent_rom.to_string_lossy().to_string());

                let (non_black_pixels, core_label, frames_run, width, height, rgba) =
                    corpus_libretro_visible_smoke(&persistent_rom)?;
                let frame_path = artifact_root.join("frames").join(format!("{slug}.ppm"));
                write_rgba_ppm(&frame_path, width, height, &rgba);
                entry.emulation_real_ok = true;
                entry.libretro_core = Some(core_label);
                entry.frames_run = frames_run;
                entry.framebuffer_width = width;
                entry.framebuffer_height = height;
                entry.non_black_pixels = non_black_pixels;
                entry.framebuffer_ppm = Some(frame_path.to_string_lossy().to_string());
                Ok(())
            })();

            if let Err(error) = project_result {
                entry.bridge_only = entry.import_ok && !entry.build_real_ok;
                entry.failure_reason = Some(error);
            }
            entries.push(entry);
            write_sgdk_corpus_real_build_report(&artifact_root, &entries, donors.len());
        }

        let expected_entries = if let Some(filter) = &corpus_filter {
            donors
                .iter()
                .take(max_projects)
                .filter(|(project_name, _)| {
                    let normalized = project_name.to_ascii_lowercase();
                    filter
                        .iter()
                        .any(|needle| normalized.contains(needle.as_str()))
                })
                .count()
        } else {
            max_projects.min(donors.len())
        };
        assert_eq!(
            entries.len(),
            expected_entries,
            "runner real do corpus deve registrar todos os projetos selecionados"
        );
        assert!(
            entries.iter().all(|entry| !entry.fake_toolchain_used),
            "nenhuma entrada do corpus real pode usar fake toolchain"
        );

        let report_json = fs::read_to_string(
            artifact_root.join("sgdk-corpus-real-build-report.json"),
        )
        .expect("read SGDK real corpus JSON report");
        let report: serde_json::Value =
            serde_json::from_str(&report_json).expect("parse SGDK real corpus JSON report");
        assert_eq!(
            report["failed"].as_u64(),
            Some(0),
            "corpus real runner must not leave failures: {:?}",
            report["entries"]
                .as_array()
                .map(|entries| {
                    entries
                        .iter()
                        .filter_map(|entry| entry.get("failure_reason"))
                        .filter(|reason| !reason.is_null())
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default()
        );
        assert_eq!(
            report["fake_toolchain_used"].as_bool(),
            Some(false),
            "corpus real runner must not use fake toolchain"
        );
        let emulation_visible_ok = report["emulation_visible_ok"]
            .as_u64()
            .unwrap_or(0);
        let build_real_ok = report["build_real_ok"].as_u64().unwrap_or(0);
        eprintln!(
            "SGDK corpus real visible emulation: {}/{} builds with non-black framebuffer (processed {}/{})",
            emulation_visible_ok,
            build_real_ok,
            report["processed"].as_u64().unwrap_or(0),
            report["total_projects"].as_u64().unwrap_or(0)
        );
        assert!(
            emulation_visible_ok > 0,
            "at least one corpus build must produce a visible Libretro framebuffer"
        );
        if corpus_filter.is_none() && max_projects >= donors.len() {
            assert!(
                report["stable_candidate"].as_bool().unwrap_or(false),
                "full corpus real runner must finish as stable candidate"
            );
            assert_eq!(
                emulation_visible_ok, build_real_ok,
                "every corpus build with a real ROM must also produce visible Libretro output"
            );
        }
    }

    #[ignore = "requires local SGDK_Engines corpus, official SGDK and a real Libretro Mega Drive core; writes persistent validation artifacts"]
    #[test]
    fn sgdk_corpus_real_build_rom_emulation_report() {
        execute_sgdk_corpus_real_build_rom_emulation_report();
    }

    #[ignore = "regression: Mega Drive Breakout visible framebuffer with real SGDK/Libretro"]
    #[test]
    fn sgdk_corpus_regression_mega_drive_breakout_visible_framebuffer() {
        std::env::set_var("RDS_SGDK_REAL_CORPUS_FILTER", "mega drive breakout");
        std::env::set_var("RDS_SGDK_REAL_CORPUS_RESUME", "1");
        execute_sgdk_corpus_real_build_rom_emulation_report();
    }

    #[ignore = "regression: Procedural Animation visible framebuffer with real SGDK/Libretro"]
    #[test]
    fn sgdk_corpus_regression_procedural_animation_visible_framebuffer() {
        std::env::set_var("RDS_SGDK_REAL_CORPUS_FILTER", "procedural animation");
        std::env::set_var("RDS_SGDK_REAL_CORPUS_RESUME", "1");
        execute_sgdk_corpus_real_build_rom_emulation_report();
    }
}
