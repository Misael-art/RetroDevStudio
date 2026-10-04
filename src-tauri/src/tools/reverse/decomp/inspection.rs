//! Serviço de inspeção visual REX-04.
//!
//! A ROM é sempre reaberta e verificada no backend; a UI só recebe IDs de
//! sessão/candidato e artefatos que o serviço resolveu. O trabalho de
//! descoberta e renderização roda em `spawn_blocking`, com progresso
//! observável, cancelamento cooperativo e snapshots imutáveis da sessão.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use super::extract::{
    canonical_dir_under, reject_if_symlink, validate_extraction_catalog, write_file_immutable,
    ExtractionCatalog,
};
use super::graphics_discovery::{
    discover_graphic_candidates, export_candidate_previews, validate_graphic_discovery,
    GraphicCandidate, GraphicDiscovery, KIND_PALETTE16, KIND_PALETTE64, KIND_TILE_BLOCK,
};
use super::rom_library::{
    decomp_work_dir, now_unix, record_scenario_run, sha256_hex, ArtifactRef, ScenarioRunRecord,
};
use crate::tools::reverse::loader::{rex_read_rom, RexRomIdentity};

pub const INSPECTION_SCHEMA_V1: &str = "rex-inspection-session/v1";
pub const INSPECTION_PROGRESS_EVENT: &str = "rex://inspection-progress";
pub const INSPECTION_MAX_ROM_BYTES: usize = 32 * 1024 * 1024;
pub const INSPECTION_MAX_CANDIDATES: usize = 16_384;
pub const INSPECTION_MAX_PAGE_SIZE: usize = 128;
pub const INSPECTION_MAX_QUERY_LENGTH: usize = 96;

static ID_SEQ: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct InspectionError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

impl InspectionError {
    fn new(code: &str, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
            retryable,
        }
    }

    pub(crate) fn from_wire(message: String) -> Self {
        let (code, detail) = message
            .split_once(": ")
            .filter(|(code, _)| !code.trim().is_empty())
            .unwrap_or(("inspection_failed", message.as_str()));
        Self::new(code, detail, true)
    }
}

impl std::fmt::Display for InspectionError {
    fn fmt(&self, output: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(output, "{}: {}", self.code, self.message)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct InspectionRomIdentity {
    pub original_sha256: String,
    pub normalized_sha256: String,
    pub original_size: u64,
    pub normalized_size: u64,
    pub variant: String,
    pub header_console: String,
    pub header_title: String,
    pub region: Option<String>,
    pub version: Option<String>,
    pub size_note: Option<String>,
}

impl From<&RexRomIdentity> for InspectionRomIdentity {
    fn from(identity: &RexRomIdentity) -> Self {
        Self {
            original_sha256: identity.original_sha256.clone(),
            normalized_sha256: identity.normalized_sha256.clone(),
            original_size: identity.original_size as u64,
            normalized_size: identity.normalized_size as u64,
            variant: identity.variant.clone(),
            header_console: identity.header_console.clone(),
            header_title: identity.header_title.clone(),
            region: identity.region.clone(),
            version: identity.version.clone(),
            size_note: identity.size_note.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct InspectionSession {
    pub schema_version: String,
    pub session_id: String,
    pub rom_path: String,
    pub identity: InspectionRomIdentity,
    pub catalog_artifact: ArtifactRef,
    pub artifact_refs: Vec<ArtifactRef>,
    pub user_choice_artifacts: Vec<ArtifactRef>,
    pub discovery_run_id: Option<String>,
    pub status: String,
    pub candidates_total: usize,
    pub unknown_bytes: u64,
    pub created_at_unix: u64,
    pub completed_at_unix: Option<u64>,
    pub error: Option<InspectionError>,
    #[serde(default)]
    pub sprite_frame_id: Option<String>,
    #[serde(default)]
    pub edit: Option<InspectionEdit>,
    #[serde(default)]
    pub applied_edits: Vec<SonicAppliedEdit>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct InspectionEdit {
    pub format: String,
    pub resource_id: String,
    pub frame_id: String,
    pub palette_index: u8,
    pub red: u8,
    pub green: u8,
    pub blue: u8,
    pub original_rom_sha256: String,
    pub modified_rom_sha256: String,
    pub modified_rom_path: String,
    pub changed_offsets: Vec<u64>,
    pub bytes_changed: u32,
    /// Tile edits only: art tiles written, and other DPLC frames that also load them.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub art_tiles: Vec<u32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub shared_with_frames: Vec<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pixels_changed: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_rom_sha256_after: Option<String>,
    /// No-op explícito: valor já vigente, nenhuma escrita realizada, cadeia
    /// de SHA inalterada. Idempotência legítima, não falha técnica.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub noop: bool,
}

/// Registro cumulativo de cada edição Sonic aplicada à cópia da sessão.
/// A reabertura restaura a proveniência de TODOS os domínios (pixel,
/// paleta, cadência), não apenas da última operação.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SonicAppliedEdit {
    pub seq: u32,
    pub format: String,
    pub frame_id: String,
    pub summary: String,
    pub offsets: Vec<u64>,
    pub old_bytes: Vec<u8>,
    pub new_bytes: Vec<u8>,
    pub copy_sha256: String,
    pub at_unix: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct InspectionPixelEdit {
    pub x: u32,
    pub y: u32,
    pub index: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct InspectionProgress {
    pub session_id: String,
    pub run_id: String,
    pub generation: u64,
    pub phase: String,
    pub status: String,
    pub completed_work: u64,
    pub total_work: u64,
    pub candidates_found: usize,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct InspectionRun {
    pub run_id: String,
    pub session_id: String,
    pub generation: u64,
    pub status: String,
    pub progress: InspectionProgress,
    pub started_at_unix: u64,
    pub finished_at_unix: Option<u64>,
    pub error: Option<InspectionError>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct InspectionStatus {
    pub session: InspectionSession,
    pub run: Option<InspectionRun>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct InspectionCandidate {
    pub id: String,
    pub offset: u64,
    pub size: u64,
    pub kind: String,
    pub status: String,
    pub method: String,
    pub confidence: f32,
    pub evidence: serde_json::Value,
    pub previews: Vec<ArtifactRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct InspectionUnknownRegion {
    pub offset: u64,
    pub size: u64,
    pub kind: String,
    pub method: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct InspectionUserChoice {
    pub choice_id: String,
    pub session_id: String,
    pub tile_candidate_id: String,
    pub palette_candidate_id: String,
    pub source: String,
    pub artifact: ArtifactRef,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct InspectionCatalogPage {
    pub session_id: String,
    pub run_id: String,
    pub offset: usize,
    pub limit: usize,
    pub total_candidates: usize,
    pub candidates: Vec<InspectionCandidate>,
    pub unknown_regions: Vec<InspectionUnknownRegion>,
    pub user_choices: Vec<InspectionUserChoice>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct InspectionPreview {
    pub session_id: String,
    pub candidate_id: String,
    pub available: bool,
    pub reason: Option<String>,
    pub artifact: Option<ArtifactRef>,
    pub data_url: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub png_sha256: Option<String>,
    pub pixels_sha256: Option<String>,
}

#[derive(Clone)]
struct StoredInspection {
    session: InspectionSession,
    catalog: ExtractionCatalog,
}

struct ActiveJob {
    cancel: Arc<AtomicBool>,
    run: Arc<Mutex<InspectionRun>>,
}

static SESSIONS: OnceLock<Mutex<HashMap<String, StoredInspection>>> = OnceLock::new();
static JOBS: OnceLock<Mutex<HashMap<String, ActiveJob>>> = OnceLock::new();

fn sessions() -> &'static Mutex<HashMap<String, StoredInspection>> {
    SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn jobs() -> &'static Mutex<HashMap<String, ActiveJob>> {
    JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn error(code: &str, message: impl Into<String>, retryable: bool) -> String {
    InspectionError::new(code, message, retryable).to_string()
}

fn validate_session_id(session_id: &str) -> Result<(), String> {
    if session_id.len() > 160
        || session_id.is_empty()
        || !session_id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    {
        return Err(error("invalid_session", "ID de sessão inválido", false));
    }
    Ok(())
}

fn session_id() -> String {
    let seq = ID_SEQ.fetch_add(1, Ordering::Relaxed);
    format!("inspection-{}-{seq:08x}", now_unix())
}

fn identity_matches(left: &InspectionRomIdentity, right: &RexRomIdentity) -> bool {
    left.original_sha256 == right.original_sha256
        && left.normalized_sha256 == right.normalized_sha256
        && left.original_size == right.original_size as u64
        && left.normalized_size == right.normalized_size as u64
}

fn ensure_rom_path(rom_path: &str) -> Result<PathBuf, String> {
    let trimmed = rom_path.trim();
    if trimmed.is_empty() {
        return Err(error(
            "rom_missing",
            "Selecione uma ROM BYOR antes de iniciar",
            true,
        ));
    }
    let path = Path::new(trimmed);
    let metadata =
        fs::metadata(path).map_err(|e| error("rom_io", format!("ROM indisponível: {e}"), true))?;
    if !metadata.is_file() {
        return Err(error(
            "rom_not_file",
            "O caminho selecionado não é um arquivo regular",
            false,
        ));
    }
    if metadata.len() > INSPECTION_MAX_ROM_BYTES as u64 {
        return Err(error(
            "rom_too_large",
            format!(
                "ROM excede o limite de {} MiB",
                INSPECTION_MAX_ROM_BYTES / 1024 / 1024
            ),
            false,
        ));
    }
    fs::canonicalize(path).map_err(|e| {
        error(
            "rom_path",
            format!("Não foi possível resolver a ROM: {e}"),
            true,
        )
    })
}

fn read_identity_and_normalized(path: &Path) -> Result<(RexRomIdentity, Vec<u8>), String> {
    let (identity, raw) = rex_read_rom(path).map_err(|e| error("rom_identity", e, true))?;
    let (_, normalized) = crate::tools::reverse::platform::identify_md(&raw)
        .map_err(|e| error("rom_identity", e.message(), true))?;
    Ok((identity, normalized))
}

fn session_dir(work_dir: &Path, normalized_sha: &str) -> Result<PathBuf, String> {
    canonical_dir_under(work_dir, &["extract", normalized_sha, "sessions"])
}

fn persist_session(work_dir: &Path, session: &InspectionSession) -> Result<ArtifactRef, String> {
    let dir = session_dir(work_dir, &session.identity.normalized_sha256)?;
    let bytes = serde_json::to_vec_pretty(session)
        .map_err(|e| error("session_encode", e.to_string(), false))?;
    let sha = sha256_hex(&bytes);
    let path = dir.join(format!("session-{}-{sha}.json", session.session_id));
    write_file_immutable(&path, &bytes, &sha)?;
    Ok(ArtifactRef {
        label: "inspection-session".to_string(),
        path: path.display().to_string(),
        sha256: sha,
    })
}

fn valid_artifact_path(
    work_dir: &Path,
    artifact: &ArtifactRef,
    expected_dir: &Path,
) -> Result<PathBuf, String> {
    if artifact.sha256.len() != 64 || !artifact.sha256.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(error(
            "artifact_hash",
            "Artefato com SHA-256 inválido",
            false,
        ));
    }
    let path = PathBuf::from(&artifact.path);
    reject_if_symlink(&path).map_err(|message| error("artifact_link", message, false))?;
    let canonical_expected =
        fs::canonicalize(expected_dir).map_err(|e| error("artifact_root", e.to_string(), false))?;
    let canonical_path = fs::canonicalize(&path).map_err(|e| {
        error(
            "artifact_missing",
            format!("Artefato indisponível: {e}"),
            true,
        )
    })?;
    if !canonical_path.starts_with(&canonical_expected) || !canonical_path.is_file() {
        return Err(error(
            "artifact_scope",
            "Artefato fora da sessão autorizada",
            false,
        ));
    }
    let bytes = fs::read(&canonical_path).map_err(|e| error("artifact_io", e.to_string(), true))?;
    if sha256_hex(&bytes) != artifact.sha256 {
        return Err(error(
            "artifact_tampered",
            "Artefato adulterado ou incompleto",
            false,
        ));
    }
    let _ = work_dir;
    Ok(canonical_path)
}

fn load_catalog(work_dir: &Path, session: &InspectionSession) -> Result<ExtractionCatalog, String> {
    let catalog_dir =
        canonical_dir_under(work_dir, &["extract", &session.identity.normalized_sha256])?;
    let path = valid_artifact_path(work_dir, &session.catalog_artifact, &catalog_dir)?;
    let bytes = fs::read(&path).map_err(|e| error("catalog_io", e.to_string(), true))?;
    let catalog: ExtractionCatalog = serde_json::from_slice(&bytes)
        .map_err(|e| error("catalog_schema", format!("Catálogo inválido: {e}"), false))?;
    let expected_sha = sha256_hex(&serde_json::to_vec_pretty(&catalog).map_err(|e| e.to_string())?);
    if expected_sha != session.catalog_artifact.sha256 {
        return Err(error(
            "catalog_hash",
            "Hash do catálogo não corresponde à serialização canônica",
            false,
        ));
    }
    Ok(catalog)
}

fn load_stored_session_from_disk(
    session_id: &str,
    rom_path: &str,
) -> Result<StoredInspection, String> {
    validate_session_id(session_id)?;
    let canonical_rom = ensure_rom_path(rom_path)?;
    let (identity, normalized) = read_identity_and_normalized(&canonical_rom)?;
    if normalized.len() > INSPECTION_MAX_ROM_BYTES {
        return Err(error(
            "rom_too_large",
            "ROM excede o limite de inspeção",
            false,
        ));
    }
    let dir = session_dir(&decomp_work_dir(), &identity.normalized_sha256)?;
    let prefix = format!("session-{session_id}-");
    let mut newest: Option<(InspectionSession, Option<std::time::SystemTime>)> = None;
    for entry in fs::read_dir(&dir).map_err(|e| error("session_io", e.to_string(), true))? {
        let path = entry.map_err(|e| e.to_string())?.path();
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default();
        let metadata =
            fs::symlink_metadata(&path).map_err(|e| error("session_io", e.to_string(), true))?;
        if !name.starts_with(&prefix) || !name.ends_with(".json") || !metadata.file_type().is_file()
        {
            continue;
        }
        let bytes = fs::read(&path).map_err(|e| error("session_io", e.to_string(), true))?;
        let sha = sha256_hex(&bytes);
        let session: InspectionSession = serde_json::from_slice(&bytes)
            .map_err(|e| error("session_schema", e.to_string(), false))?;
        if !name.contains(&sha)
            || session.session_id != session_id
            || !identity_matches(&session.identity, &identity)
        {
            continue;
        }
        // Snapshots share one created_at second; the file write order is the
        // only total order that matches user intent (last saved state wins).
        let mtime = metadata.modified().ok();
        let replace = newest.as_ref().is_none_or(|(old, old_mtime)| {
            mtime > *old_mtime
                || (mtime == *old_mtime
                    && session.completed_at_unix.unwrap_or(session.created_at_unix)
                        >= old.completed_at_unix.unwrap_or(old.created_at_unix))
        });
        if replace {
            newest = Some((session, mtime));
        }
    }
    let session = newest.map(|(session, _)| session).ok_or_else(|| {
        error(
            "session_missing",
            "Sessão não encontrada para esta identidade de ROM",
            false,
        )
    })?;
    if session.schema_version != INSPECTION_SCHEMA_V1 {
        return Err(error(
            "session_schema",
            "Schema de sessão não suportado",
            false,
        ));
    }
    let catalog = load_catalog(&decomp_work_dir(), &session)?;
    validate_extraction_catalog(&catalog, &normalized)
        .map_err(|e| error("catalog_invalid", e, false))?;
    Ok(StoredInspection { session, catalog })
}

pub fn list_sessions() -> Result<Vec<InspectionSession>, String> {
    let work_dir = decomp_work_dir();
    let extract_dir = work_dir.join("extract");
    let metadata = match fs::symlink_metadata(&extract_dir) {
        Ok(metadata) => metadata,
        Err(io_error) if io_error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(io_error) => return Err(error("session_list_io", io_error.to_string(), true)),
    };
    if !metadata.file_type().is_dir() {
        return Err(error(
            "session_list_root",
            "Diretório de extração inválido",
            false,
        ));
    }

    let mut latest = HashMap::<String, (InspectionSession, Option<std::time::SystemTime>)>::new();
    for entry in
        fs::read_dir(&extract_dir).map_err(|e| error("session_list_io", e.to_string(), true))?
    {
        let hash_dir = entry
            .map_err(|e| error("session_list_io", e.to_string(), true))?
            .path();
        let hash_name = hash_dir
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        let hash_metadata = fs::symlink_metadata(&hash_dir)
            .map_err(|e| error("session_list_io", e.to_string(), true))?;
        if hash_name.len() != 64
            || !hash_name.bytes().all(|byte| byte.is_ascii_hexdigit())
            || !hash_metadata.file_type().is_dir()
        {
            continue;
        }
        let sessions_dir = hash_dir.join("sessions");
        let Ok(session_entries) = fs::read_dir(&sessions_dir) else {
            continue;
        };
        for session_entry in session_entries {
            let path = session_entry
                .map_err(|e| error("session_list_io", e.to_string(), true))?
                .path();
            let name = path
                .file_name()
                .and_then(|item| item.to_str())
                .unwrap_or_default();
            let file_metadata = fs::symlink_metadata(&path)
                .map_err(|e| error("session_list_io", e.to_string(), true))?;
            if !name.starts_with("session-")
                || !name.ends_with(".json")
                || !file_metadata.file_type().is_file()
            {
                continue;
            }
            let bytes =
                fs::read(&path).map_err(|e| error("session_list_io", e.to_string(), true))?;
            let content_sha = sha256_hex(&bytes);
            if !name.contains(&content_sha) {
                continue;
            }
            let session: InspectionSession = match serde_json::from_slice(&bytes) {
                Ok(session) => session,
                Err(_) => continue,
            };
            if session.schema_version != INSPECTION_SCHEMA_V1
                || validate_session_id(&session.session_id).is_err()
                || session.identity.normalized_sha256 != hash_name
            {
                continue;
            }
            let replace = latest
                .get(&session.session_id)
                .is_none_or(|(current, old_mtime)| {
                    let mtime = file_metadata.modified().ok();
                    mtime > *old_mtime
                        || (mtime == *old_mtime
                            && session.completed_at_unix.unwrap_or(session.created_at_unix)
                                >= current.completed_at_unix.unwrap_or(current.created_at_unix))
                });
            if replace {
                let mtime = file_metadata.modified().ok();
                latest.insert(session.session_id.clone(), (session, mtime));
            }
        }
    }
    let mut sessions: Vec<_> = latest.into_values().map(|(session, _)| session).collect();
    sessions.sort_by(|left, right| {
        right
            .completed_at_unix
            .unwrap_or(right.created_at_unix)
            .cmp(&left.completed_at_unix.unwrap_or(left.created_at_unix))
            .then_with(|| left.session_id.cmp(&right.session_id))
    });
    Ok(sessions)
}

fn get_stored_session(session_id: &str) -> Result<StoredInspection, String> {
    validate_session_id(session_id)?;
    if let Some(stored) = sessions()
        .lock()
        .map_err(|e| e.to_string())?
        .get(session_id)
    {
        return Ok(StoredInspection {
            session: stored.session.clone(),
            catalog: stored.catalog.clone(),
        });
    }
    Err(error(
        "session_not_loaded",
        "Reabra a sessão com a ROM para autorizar seu conteúdo",
        false,
    ))
}

fn candidate_id(index: usize, candidate: &GraphicCandidate) -> String {
    format!("{}@{:08X}-{index:04X}", candidate.kind, candidate.offset)
}

fn candidate_view(index: usize, candidate: &GraphicCandidate) -> InspectionCandidate {
    InspectionCandidate {
        id: candidate_id(index, candidate),
        offset: candidate.offset,
        size: candidate.size,
        kind: candidate.kind.clone(),
        status: candidate.status.clone(),
        method: candidate.method.clone(),
        confidence: candidate.confidence,
        evidence: candidate.evidence.clone(),
        previews: candidate.previews.clone(),
    }
}

fn discovery_from_session(stored: &StoredInspection) -> Result<GraphicDiscovery, String> {
    let artifact = stored
        .session
        .artifact_refs
        .iter()
        .find(|a| a.label == "graphic-discovery")
        .ok_or_else(|| {
            error(
                "discovery_missing",
                "A descoberta ainda não foi concluída",
                false,
            )
        })?;
    let root = canonical_dir_under(
        &decomp_work_dir(),
        &["extract", &stored.session.identity.normalized_sha256],
    )?;
    let path = valid_artifact_path(&decomp_work_dir(), artifact, &root)?;
    let bytes = fs::read(path).map_err(|e| error("discovery_io", e.to_string(), true))?;
    let discovery: GraphicDiscovery = serde_json::from_slice(&bytes)
        .map_err(|e| error("discovery_schema", e.to_string(), false))?;
    if sha256_hex(&bytes) != artifact.sha256
        || discovery.normalized_sha256 != stored.session.identity.normalized_sha256
    {
        return Err(error(
            "discovery_identity",
            "Descoberta não corresponde à sessão",
            false,
        ));
    }
    let (identity, normalized) = read_identity_and_normalized(Path::new(&stored.session.rom_path))?;
    if !identity_matches(&stored.session.identity, &identity) {
        return Err(error(
            "rom_changed",
            "A ROM atual não corresponde à sessão",
            false,
        ));
    }
    validate_graphic_discovery(&discovery, &normalized)
        .map_err(|e| error("discovery_invalid", e, false))?;
    Ok(discovery)
}

fn update_run(run: &Arc<Mutex<InspectionRun>>, progress: InspectionProgress) {
    if let Ok(mut current) = run.lock() {
        current.progress = progress;
    }
}

fn emit_progress(app: &AppHandle, progress: InspectionProgress) {
    let _ = app.emit(INSPECTION_PROGRESS_EVENT, &progress);
}

fn finish_job(session_id: &str, run_id: &str, status: &str, failure: Option<InspectionError>) {
    if let Ok(map) = jobs().lock() {
        if let Some(job) = map.get(session_id) {
            if let Ok(mut run) = job.run.lock() {
                run.status = status.to_string();
                run.finished_at_unix = Some(now_unix());
                run.error = failure;
                run.progress.status = status.to_string();
                run.progress.phase = "finished".to_string();
                run.progress.completed_work = run.progress.total_work;
            }
        }
    }
    let _ = run_id;
}

fn execute_discovery(app: AppHandle, stored: StoredInspection, job: Arc<ActiveJob>) {
    let session_id = stored.session.session_id.clone();
    let run_id = job.run.lock().map(|r| r.run_id.clone()).unwrap_or_default();
    let generation = job.run.lock().map(|r| r.generation).unwrap_or(0);
    let total_work = 100u64;
    let progress = |phase: &str, completed: u64, count: usize, message: &str| {
        let value = InspectionProgress {
            session_id: session_id.clone(),
            run_id: run_id.clone(),
            generation,
            phase: phase.to_string(),
            status: "running".to_string(),
            completed_work: completed,
            total_work,
            candidates_found: count,
            message: message.to_string(),
        };
        update_run(&job.run, value.clone());
        emit_progress(&app, value);
    };
    progress("verify", 5, 0, "Verificando identidade e bytes da ROM...");
    let result = (|| -> Result<(), String> {
        let rom_path = ensure_rom_path(&stored.session.rom_path)?;
        let (identity, normalized) = read_identity_and_normalized(&rom_path)?;
        if !identity_matches(&stored.session.identity, &identity) {
            return Err(error(
                "rom_changed",
                "A ROM foi removida ou alterada desde a identificação",
                false,
            ));
        }
        validate_extraction_catalog(&stored.catalog, &normalized)
            .map_err(|e| error("catalog_invalid", e, false))?;
        if job.cancel.load(Ordering::Acquire) {
            return Err(error("cancelled", "Análise cancelada pelo usuário", true));
        }
        progress(
            "discover",
            35,
            0,
            "Varredura dos bytes desconhecidos em andamento...",
        );
        let catalog_sha = stored.session.catalog_artifact.sha256.clone();
        let mut discovery =
            discover_graphic_candidates(&stored.catalog, &normalized, &catalog_sha)?;
        if discovery.candidates.len() > INSPECTION_MAX_CANDIDATES {
            return Err(error(
                "candidate_limit",
                "A descoberta excedeu o limite de candidatos",
                false,
            ));
        }
        if job.cancel.load(Ordering::Acquire) {
            return Err(error("cancelled", "Análise cancelada pelo usuário", true));
        }
        progress(
            "previews",
            60,
            discovery.candidates.len(),
            "Renderizando prévias reais dos candidatos...",
        );
        export_candidate_previews(&decomp_work_dir(), &mut discovery, &normalized)?;
        if job.cancel.load(Ordering::Acquire) {
            return Err(error("cancelled", "Análise cancelada pelo usuário", true));
        }
        progress(
            "persist",
            85,
            discovery.candidates.len(),
            "Persistindo descoberta e proveniência...",
        );
        let (_, artifact) = super::graphics_discovery::record_discovery_run(
            &decomp_work_dir(),
            &discovery,
            serde_json::json!({"source":"desktop_inspection"}),
        )?;
        let mut session = stored.session.clone();
        session.status = "completed".to_string();
        session.candidates_total = discovery.candidates.len();
        session.unknown_bytes = stored.catalog.unknown_bytes;
        session.completed_at_unix = Some(now_unix());
        session.error = None;
        session.discovery_run_id = Some(run_id.clone());
        if !session
            .artifact_refs
            .iter()
            .any(|existing| existing == &artifact)
        {
            session.artifact_refs.push(artifact);
        }
        for candidate in &discovery.candidates {
            for preview in &candidate.previews {
                if !session
                    .artifact_refs
                    .iter()
                    .any(|existing| existing == preview)
                {
                    session.artifact_refs.push(preview.clone());
                }
            }
        }
        persist_session(&decomp_work_dir(), &session)?;
        if let Ok(mut map) = sessions().lock() {
            map.insert(
                session_id.clone(),
                StoredInspection {
                    session: session.clone(),
                    catalog: stored.catalog.clone(),
                },
            );
        }
        record_scenario_run(
            &decomp_work_dir(),
            ScenarioRunRecord {
                run_id: format!("inspection-{run_id}"),
                scenario_id: "rex04-desktop-inspection-v1".to_string(),
                kind: "desktop_inspection".to_string(),
                reference_sha256: identity.original_sha256,
                candidate_sha256: Some(identity.normalized_sha256),
                input_script_sha256: None,
                core_label: String::new(),
                core_sha256: None,
                frames: 0,
                verdict: "discovered".to_string(),
                oracle_results: serde_json::json!({"candidates": discovery.candidates.len()}),
                gaps: vec!["heurística; nenhum candidato é recurso confirmado".to_string()],
                artifacts: session_artifacts(&session),
                executed_at_unix: now_unix(),
                previous_run_id: None,
                notes: String::new(),
            },
        )?;
        Ok(())
    })();
    match result {
        Ok(()) => {
            finish_job(&session_id, &run_id, "completed", None);
            let value = InspectionProgress {
                session_id: session_id.clone(),
                run_id: run_id.clone(),
                generation,
                phase: "finished".to_string(),
                status: "completed".to_string(),
                completed_work: 100,
                total_work: 100,
                candidates_found: get_stored_session(&session_id)
                    .map(|s| s.session.candidates_total)
                    .unwrap_or(0),
                message: "Descoberta concluída; candidatos continuam heurísticos.".to_string(),
            };
            update_run(&job.run, value.clone());
            emit_progress(&app, value);
        }
        Err(message) if message.starts_with("cancelled:") => {
            let failure = InspectionError::new("cancelled", message, true);
            finish_job(&session_id, &run_id, "cancelled", Some(failure.clone()));
            if let Ok(mut map) = sessions().lock() {
                if let Some(current) = map.get_mut(&session_id) {
                    current.session.status = "cancelled".to_string();
                    current.session.error = Some(failure.clone());
                    current.session.completed_at_unix = Some(now_unix());
                    let _ = persist_session(&decomp_work_dir(), &current.session);
                }
            }
            let value = InspectionProgress {
                session_id: session_id.clone(),
                run_id: run_id.clone(),
                generation,
                phase: "finished".to_string(),
                status: "cancelled".to_string(),
                completed_work: 100,
                total_work: 100,
                candidates_found: 0,
                message: "Análise cancelada; nenhum resultado parcial foi promovido.".to_string(),
            };
            update_run(&job.run, value.clone());
            emit_progress(&app, value);
        }
        Err(message) => {
            let failure = InspectionError::new("inspection_failed", message, true);
            finish_job(&session_id, &run_id, "failed", Some(failure.clone()));
            let value = InspectionProgress {
                session_id: session_id.clone(),
                run_id: run_id.clone(),
                generation,
                phase: "finished".to_string(),
                status: "failed".to_string(),
                completed_work: 100,
                total_work: 100,
                candidates_found: 0,
                message: failure.message.clone(),
            };
            update_run(&job.run, value.clone());
            emit_progress(&app, value);
            if let Ok(mut map) = sessions().lock() {
                if let Some(current) = map.get_mut(&session_id) {
                    current.session.status = "failed".to_string();
                    current.session.error = Some(failure);
                    current.session.completed_at_unix = Some(now_unix());
                    let _ = persist_session(&decomp_work_dir(), &current.session);
                }
            }
        }
    }
}

fn session_artifacts(session: &InspectionSession) -> Vec<ArtifactRef> {
    let mut refs = session.artifact_refs.clone();
    refs.extend(session.user_choice_artifacts.clone());
    refs
}

pub fn open(rom_path: &str) -> Result<InspectionSession, String> {
    let canonical = ensure_rom_path(rom_path)?;
    let (identity, normalized) = read_identity_and_normalized(&canonical)?;
    if normalized.len() > INSPECTION_MAX_ROM_BYTES {
        return Err(error(
            "rom_too_large",
            "ROM excede o limite de inspeção",
            false,
        ));
    }
    let identity_summary = InspectionRomIdentity::from(&identity);
    let catalog = super::extract::build_md_extraction_catalog(&identity, &normalized)
        .map_err(|e| error("catalog_build", e, false))?;
    let (_, catalog_artifact) =
        super::extract::record_extraction_run(&decomp_work_dir(), &catalog)?;
    let session = InspectionSession {
        schema_version: INSPECTION_SCHEMA_V1.to_string(),
        session_id: session_id(),
        rom_path: canonical.display().to_string(),
        identity: identity_summary,
        catalog_artifact: catalog_artifact.clone(),
        artifact_refs: vec![catalog_artifact],
        user_choice_artifacts: Vec::new(),
        discovery_run_id: None,
        status: "identified".to_string(),
        candidates_total: 0,
        unknown_bytes: catalog.unknown_bytes,
        created_at_unix: now_unix(),
        completed_at_unix: None,
        error: None,
        sprite_frame_id: None,
        edit: None,
        applied_edits: Vec::new(),
    };
    persist_session(&decomp_work_dir(), &session)?;
    sessions().lock().map_err(|e| e.to_string())?.insert(
        session.session_id.clone(),
        StoredInspection {
            session: session.clone(),
            catalog,
        },
    );
    Ok(session)
}

pub fn reopen(rom_path: &str, session_id: &str) -> Result<InspectionSession, String> {
    let stored = load_stored_session_from_disk(session_id, rom_path)?;
    let result = stored.session.clone();
    sessions()
        .lock()
        .map_err(|e| e.to_string())?
        .insert(session_id.to_string(), stored);
    Ok(result)
}

pub fn start(app: AppHandle, session_id: &str, generation: u64) -> Result<InspectionRun, String> {
    let stored = get_stored_session(session_id)?;
    if let Ok(map) = jobs().lock() {
        if let Some(existing) = map.get(session_id) {
            if existing
                .run
                .lock()
                .map(|r| r.status == "running")
                .unwrap_or(false)
            {
                return Err(error(
                    "already_running",
                    "Já existe uma análise em andamento para esta sessão",
                    false,
                ));
            }
        }
    }
    let seq = ID_SEQ.fetch_add(1, Ordering::Relaxed);
    let run_id = format!("run-{session_id}-{seq:08x}");
    let run = Arc::new(Mutex::new(InspectionRun {
        run_id: run_id.clone(),
        session_id: session_id.to_string(),
        generation,
        status: "running".to_string(),
        progress: InspectionProgress {
            session_id: session_id.to_string(),
            run_id: run_id.clone(),
            generation,
            phase: "queued".to_string(),
            status: "running".to_string(),
            completed_work: 0,
            total_work: 100,
            candidates_found: 0,
            message: "Análise enfileirada fora da thread da UI".to_string(),
        },
        started_at_unix: now_unix(),
        finished_at_unix: None,
        error: None,
    }));
    let cancel = Arc::new(AtomicBool::new(false));
    let job = Arc::new(ActiveJob {
        cancel,
        run: run.clone(),
    });
    jobs()
        .lock()
        .map_err(|e| e.to_string())?
        .insert(session_id.to_string(), (*job).clone_for_map());
    let mut running_session = stored.session.clone();
    running_session.status = "running".to_string();
    running_session.error = None;
    persist_session(&decomp_work_dir(), &running_session)?;
    sessions().lock().map_err(|e| e.to_string())?.insert(
        session_id.to_string(),
        StoredInspection {
            session: running_session,
            catalog: stored.catalog.clone(),
        },
    );
    let _ = app.emit(
        INSPECTION_PROGRESS_EVENT,
        &run.lock().map_err(|e| e.to_string())?.progress,
    );
    tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        let job = job.clone();
        move || execute_discovery(app, stored, job)
    });
    run.lock().map(|r| r.clone()).map_err(|e| e.to_string())
}

impl ActiveJob {
    fn clone_for_map(&self) -> ActiveJob {
        ActiveJob {
            cancel: self.cancel.clone(),
            run: self.run.clone(),
        }
    }
}

pub fn cancel(session_id: &str, run_id: &str) -> Result<InspectionRun, String> {
    let map = jobs().lock().map_err(|e| e.to_string())?;
    let job = map
        .get(session_id)
        .ok_or_else(|| error("run_missing", "Análise não encontrada", false))?;
    let mut run = job.run.lock().map_err(|e| e.to_string())?;
    if run.run_id != run_id {
        return Err(error(
            "run_mismatch",
            "A análise solicitada não pertence à sessão",
            false,
        ));
    }
    if run.status == "running" {
        job.cancel.store(true, Ordering::Release);
        run.progress.message = "Cancelamento solicitado; aguardando ponto seguro...".to_string();
    }
    Ok(run.clone())
}

pub fn status(session_id: &str) -> Result<InspectionStatus, String> {
    let stored = get_stored_session(session_id)?;
    let run = jobs()
        .lock()
        .map_err(|e| e.to_string())?
        .get(session_id)
        .and_then(|j| j.run.lock().ok().map(|r| r.clone()));
    Ok(InspectionStatus {
        session: stored.session,
        run,
    })
}

pub fn catalog_page(
    session_id: &str,
    offset: usize,
    limit: usize,
    query: &str,
    kind: &str,
) -> Result<InspectionCatalogPage, String> {
    if limit == 0 || limit > INSPECTION_MAX_PAGE_SIZE {
        return Err(error("page_limit", "Limite de página inválido", false));
    }
    if query.len() > INSPECTION_MAX_QUERY_LENGTH || kind.len() > 64 {
        return Err(error(
            "page_filter",
            "Filtro de catálogo excede o limite",
            false,
        ));
    }
    let stored = get_stored_session(session_id)?;
    let discovery = discovery_from_session(&stored)?;
    let query = query.trim().to_ascii_lowercase();
    let kind = kind.trim().to_ascii_lowercase();
    let matches = |candidate: &GraphicCandidate| {
        let candidate_kind = candidate.kind.to_ascii_lowercase();
        let kind_ok = kind.is_empty()
            || kind == candidate_kind
            || (kind == "tiles" && candidate_kind == KIND_TILE_BLOCK)
            || (kind == "palettes"
                && (candidate_kind == KIND_PALETTE16 || candidate_kind == KIND_PALETTE64));
        let text = format!(
            "{} {} {}",
            candidate_kind, candidate.offset, candidate.method
        )
        .to_ascii_lowercase();
        kind_ok && (query.is_empty() || text.contains(&query))
    };
    let all: Vec<_> = discovery
        .candidates
        .iter()
        .enumerate()
        .filter(|(_, c)| matches(c))
        .collect();
    let total_candidates = all.len();
    let candidates = all
        .into_iter()
        .skip(offset)
        .take(limit)
        .map(|(i, c)| candidate_view(i, c))
        .collect();
    let unknown_regions = if kind == "unknown" || kind.is_empty() {
        stored
            .catalog
            .regions
            .iter()
            .filter(|r| r.status == super::extract::STATUS_UNKNOWN)
            .map(|r| InspectionUnknownRegion {
                offset: r.offset,
                size: r.size,
                kind: r.kind.clone(),
                method: r.method.clone(),
            })
            .collect()
    } else {
        Vec::new()
    };
    Ok(InspectionCatalogPage {
        session_id: session_id.to_string(),
        run_id: stored.session.discovery_run_id.clone().unwrap_or_default(),
        offset,
        limit,
        total_candidates,
        candidates,
        unknown_regions,
        user_choices: load_choices(&stored)?,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredChoice {
    choice_id: String,
    session_id: String,
    tile_candidate_id: String,
    palette_candidate_id: String,
    source: String,
}

fn load_choices(stored: &StoredInspection) -> Result<Vec<InspectionUserChoice>, String> {
    let root = canonical_dir_under(
        &decomp_work_dir(),
        &[
            "extract",
            &stored.session.identity.normalized_sha256,
            "choices",
        ],
    )?;
    stored
        .session
        .user_choice_artifacts
        .iter()
        .map(|artifact| {
            let path = valid_artifact_path(&decomp_work_dir(), artifact, &root)?;
            let bytes = fs::read(path).map_err(|e| e.to_string())?;
            let stored_choice: StoredChoice =
                serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
            Ok(InspectionUserChoice {
                choice_id: stored_choice.choice_id,
                session_id: stored_choice.session_id,
                tile_candidate_id: stored_choice.tile_candidate_id,
                palette_candidate_id: stored_choice.palette_candidate_id,
                source: stored_choice.source,
                artifact: artifact.clone(),
            })
        })
        .collect()
}

pub fn preview(session_id: &str, candidate_id_value: &str) -> Result<InspectionPreview, String> {
    let stored = get_stored_session(session_id)?;
    let discovery = discovery_from_session(&stored)?;
    let (index, candidate) = discovery
        .candidates
        .iter()
        .enumerate()
        .find(|(i, c)| candidate_id(*i, c) == candidate_id_value)
        .ok_or_else(|| {
            error(
                "candidate_missing",
                "Candidato não pertence à sessão",
                false,
            )
        })?;
    let candidate_id_value = candidate_id(index, candidate);
    let Some(artifact) = candidate.previews.first() else {
        return Ok(InspectionPreview {
            session_id: session_id.to_string(),
            candidate_id: candidate_id_value,
            available: false,
            reason: Some("Prévia não disponível para este candidato".to_string()),
            artifact: None,
            data_url: None,
            width: None,
            height: None,
            png_sha256: None,
            pixels_sha256: None,
        });
    };
    let root = canonical_dir_under(
        &decomp_work_dir(),
        &[
            "extract",
            &stored.session.identity.normalized_sha256,
            "previews",
        ],
    )?;
    let path = valid_artifact_path(&decomp_work_dir(), artifact, &root)?;
    let bytes = fs::read(path).map_err(|e| error("preview_io", e.to_string(), true))?;
    let image = image::load_from_memory(&bytes)
        .map_err(|e| error("preview_decode", e.to_string(), false))?;
    let pixels = image.to_rgba8().into_raw();
    Ok(InspectionPreview {
        session_id: session_id.to_string(),
        candidate_id: candidate_id_value,
        available: true,
        reason: None,
        artifact: Some(artifact.clone()),
        data_url: Some(format!("data:image/png;base64,{}", BASE64.encode(&bytes))),
        width: Some(image.width()),
        height: Some(image.height()),
        png_sha256: Some(sha256_hex(&bytes)),
        pixels_sha256: Some(sha256_hex(&pixels)),
    })
}

pub fn sprite_frame(
    session_id: &str,
    resource_id: &str,
    frame_id: &str,
    flip_x: bool,
    flip_y: bool,
    from_base: bool,
) -> Result<super::sprite_composition::InspectionSpriteFrame, String> {
    let stored = get_stored_session(session_id)?;
    super::sprite_composition::compose_for_session(
        &stored.session,
        resource_id,
        frame_id,
        flip_x,
        flip_y,
        from_base,
    )
}

pub fn save_palette_choice(
    session_id: &str,
    tile_candidate_id: &str,
    palette_candidate_id: &str,
) -> Result<InspectionUserChoice, String> {
    let mut stored = get_stored_session(session_id)?;
    let discovery = discovery_from_session(&stored)?;
    let find = |id: &str| {
        discovery
            .candidates
            .iter()
            .enumerate()
            .find(|(i, c)| candidate_id(*i, c) == id)
            .map(|(_, c)| c)
    };
    let tile = find(tile_candidate_id)
        .ok_or_else(|| error("candidate_missing", "Tile não pertence à sessão", false))?;
    let palette = find(palette_candidate_id)
        .ok_or_else(|| error("candidate_missing", "Paleta não pertence à sessão", false))?;
    if tile.kind != KIND_TILE_BLOCK
        || !matches!(palette.kind.as_str(), KIND_PALETTE16 | KIND_PALETTE64)
    {
        return Err(error(
            "choice_kind",
            "A associação exige tile e paleta candidatos",
            false,
        ));
    }
    let choice_id = format!(
        "choice-{}-{}",
        session_id,
        ID_SEQ.fetch_add(1, Ordering::Relaxed)
    );
    let stored_choice = StoredChoice {
        choice_id: choice_id.clone(),
        session_id: session_id.to_string(),
        tile_candidate_id: tile_candidate_id.to_string(),
        palette_candidate_id: palette_candidate_id.to_string(),
        source: "user".to_string(),
    };
    let bytes = serde_json::to_vec_pretty(&stored_choice).map_err(|e| e.to_string())?;
    let sha = sha256_hex(&bytes);
    let dir = canonical_dir_under(
        &decomp_work_dir(),
        &[
            "extract",
            &stored.session.identity.normalized_sha256,
            "choices",
        ],
    )?;
    let path = dir.join(format!("choice-{sha}.json"));
    write_file_immutable(&path, &bytes, &sha)?;
    let artifact = ArtifactRef {
        label: "user-palette-choice".to_string(),
        path: path.display().to_string(),
        sha256: sha,
    };
    // O conteúdo persistido inclui os mesmos campos de associação; o ArtifactRef
    // é retornado separadamente para não transformar um fato extraído em fato do jogo.
    let mut session = stored.session;
    if !session
        .user_choice_artifacts
        .iter()
        .any(|a| a.sha256 == artifact.sha256)
    {
        session.user_choice_artifacts.push(artifact.clone());
    }
    persist_session(&decomp_work_dir(), &session)?;
    stored.session = session.clone();
    sessions()
        .lock()
        .map_err(|e| e.to_string())?
        .insert(session_id.to_string(), stored);
    Ok(InspectionUserChoice {
        choice_id,
        session_id: session_id.to_string(),
        tile_candidate_id: tile_candidate_id.to_string(),
        palette_candidate_id: palette_candidate_id.to_string(),
        source: "user".to_string(),
        artifact,
    })
}

pub fn save(session_id: &str, sprite_frame_id: Option<&str>) -> Result<InspectionSession, String> {
    let mut stored = get_stored_session(session_id)?;
    stored.session.sprite_frame_id = sprite_frame_id.map(str::to_string);
    persist_session(&decomp_work_dir(), &stored.session)?;
    sessions()
        .lock()
        .map_err(|e| e.to_string())?
        .insert(session_id.to_string(), stored.clone());
    Ok(stored.session)
}

// Serializes Sonic writes so a second command cannot replace a newer snapshot
// with a copy read before the first edit completed.
static SONIC_EDIT_GUARD: Mutex<()> = Mutex::new(());

fn persist_sonic_edit(
    mut stored: StoredInspection,
    base: &[u8],
    previous: &[u8],
    rom: &[u8],
    mut edit: InspectionEdit,
) -> Result<InspectionEdit, String> {
    use super::sonic_sprite as sonic;
    let (base_after, _) = rex_read_rom(Path::new(&stored.session.rom_path))?;
    if base_after.normalized_sha256 != super::sprite_composition::SONIC1_REFERENCE_SHA256 {
        return Err(error(
            "edit_base_modified",
            "A ROM base mudou durante a edição",
            false,
        ));
    }
    edit.changed_offsets = base
        .iter()
        .zip(rom)
        .enumerate()
        .filter(|(_, (a, b))| a != b)
        .map(|(i, _)| i as u64)
        .collect();
    edit.bytes_changed = edit.changed_offsets.len() as u32;
    edit.art_tiles = edit
        .changed_offsets
        .iter()
        .filter_map(|&i| {
            let i = i as usize;
            (sonic::ART_OFFSET..sonic::ART_OFFSET + sonic::ART_SIZE)
                .contains(&i)
                .then(|| ((i - sonic::ART_OFFSET) / 32) as u32)
        })
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();
    edit.shared_with_frames = if edit.format == super::sonic_cadence::EDIT_FORMAT
        || edit.format == super::sonic_sequence::EDIT_FORMAT
    {
        if edit.art_tiles.is_empty() {
            Vec::new()
        } else {
            sonic::dplc_tiles(base)?
                .iter()
                .enumerate()
                .filter(|(_, tiles)| tiles.iter().any(|t| edit.art_tiles.contains(&(*t as u32))))
                .map(|(i, _)| i as u32)
                .collect()
        }
    } else {
        let selected = sonic::frame_index(&edit.frame_id)?;
        sonic::dplc_tiles(base)?
            .iter()
            .enumerate()
            .filter(|(i, tiles)| {
                *i != selected && tiles.iter().any(|t| edit.art_tiles.contains(&(*t as u32)))
            })
            .map(|(i, _)| i as u32)
            .collect()
    };
    edit.base_rom_sha256_after = Some(base_after.normalized_sha256);
    edit.modified_rom_sha256 = sha256_hex(rom);
    // Diff pontual desta operação (cópia anterior → cópia nova): entra no
    // ledger cumulativo como proveniência do domínio editado.
    let mut offsets: Vec<u64> = Vec::new();
    let mut old_bytes: Vec<u8> = Vec::new();
    let mut new_bytes: Vec<u8> = Vec::new();
    for (i, (a, b)) in previous.iter().zip(rom).enumerate() {
        if a != b {
            offsets.push(i as u64);
            old_bytes.push(*a);
            new_bytes.push(*b);
        }
    }
    let summary = match edit.format.as_str() {
        "md_rgb333_palette_word" => format!(
            "Paleta: indice {} = RGB333({}, {}, {})",
            edit.palette_index, edit.red, edit.green, edit.blue
        ),
        "md_4bpp_tile_nibbles" => format!(
            "Pixel: {} ponto(s) no frame {}",
            edit.pixels_changed.unwrap_or(0),
            edit.frame_id
        ),
        "sonic1_wait_frame_order" => format!(
            "Sequencia id_Wait: {} entrada(s) reordenada(s) (janela {:#07x}..{:#07x})",
            offsets.len(),
            super::sonic_sequence::FRAMES_ADDR,
            super::sonic_sequence::FRAMES_END - 1
        ),
        _ => {
            let prev_byte = old_bytes.first().copied().unwrap_or_default();
            let next_byte = new_bytes.first().copied().unwrap_or_default();
            format!(
                "Cadencia id_Wait: {} -> {} ticks (offset {:#07x})",
                prev_byte,
                next_byte,
                super::sonic_cadence::WAIT_ADDR
            )
        }
    };
    let entry = SonicAppliedEdit {
        seq: stored.session.applied_edits.len() as u32 + 1,
        format: edit.format.clone(),
        frame_id: edit.frame_id.clone(),
        summary,
        offsets,
        old_bytes,
        new_bytes,
        copy_sha256: edit.modified_rom_sha256.clone(),
        at_unix: now_unix(),
    };
    stored.session.applied_edits.push(entry);
    let root = canonical_dir_under(
        &decomp_work_dir(),
        &["extract", &edit.original_rom_sha256, "edits"],
    )?;
    let path = root.join(format!(
        "sonic1-sprite-{}-{}.bin",
        edit.format, edit.modified_rom_sha256
    ));
    write_file_immutable(&path, rom, &edit.modified_rom_sha256)?;
    edit.modified_rom_path = path.display().to_string();
    stored.session.edit = Some(edit.clone());
    persist_session(&decomp_work_dir(), &stored.session)?;
    sessions()
        .lock()
        .map_err(|e| e.to_string())?
        .insert(stored.session.session_id.clone(), stored);
    Ok(edit)
}

fn sonic_edit_record(frame_id: &str, format: &str) -> InspectionEdit {
    InspectionEdit {
        format: format.into(),
        resource_id: "sonic1_sonic".into(),
        frame_id: frame_id.into(),
        palette_index: 0,
        red: 0,
        green: 0,
        blue: 0,
        original_rom_sha256: super::sprite_composition::SONIC1_REFERENCE_SHA256.into(),
        modified_rom_sha256: String::new(),
        modified_rom_path: String::new(),
        changed_offsets: Vec::new(),
        bytes_changed: 0,
        art_tiles: Vec::new(),
        shared_with_frames: Vec::new(),
        pixels_changed: None,
        base_rom_sha256_after: None,
        noop: false,
    }
}

/// Resultado de no-op: mesmo valor vigente em qualquer domínio. Não escreve
/// arquivo, não move a cadeia de SHA, não entra no ledger; devolve o estado
/// atual da cópia com classificação explícita.
fn sonic_noop_record(
    stored: &StoredInspection,
    frame_id: &str,
    format: &str,
    rom: &[u8],
) -> InspectionEdit {
    let mut edit = sonic_edit_record(frame_id, format);
    edit.noop = true;
    match stored.session.edit.as_ref() {
        Some(last) => {
            edit.modified_rom_sha256 = last.modified_rom_sha256.clone();
            edit.modified_rom_path = last.modified_rom_path.clone();
        }
        None => {
            edit.modified_rom_sha256 = sha256_hex(rom);
            edit.modified_rom_path = stored.session.rom_path.clone();
        }
    }
    edit
}

pub fn edit_sonic_palette(
    session_id: &str,
    resource_id: &str,
    frame_id: &str,
    palette_index: u8,
    red: u8,
    green: u8,
    blue: u8,
) -> Result<InspectionEdit, String> {
    use super::sonic_sprite as sonic;
    if resource_id != "sonic1_sonic" {
        return Err(error(
            "edit_resource_unsupported",
            "Recurso não comprovado",
            false,
        ));
    }
    sonic::frame_index(frame_id)?;
    if palette_index == 0 || palette_index >= 16 || red >= 8 || green >= 8 || blue >= 8 {
        return Err(error(
            "edit_palette_invalid",
            "Use índice 1..15 e canais RGB333 entre 0 e 7",
            false,
        ));
    }
    let _guard = SONIC_EDIT_GUARD.lock().map_err(|e| e.to_string())?;
    let stored = get_stored_session(session_id)?;
    let (base, mut rom) = super::sprite_composition::read_sonic_session_rom(&stored.session)?;
    let previous = rom.clone();
    sonic::read_frame(&rom, frame_id)?;
    let offset = sonic::PALETTE_OFFSET + usize::from(palette_index) * 2;
    let word = (u16::from(red) << 1) | (u16::from(green) << 5) | (u16::from(blue) << 9);
    if rom[offset..offset + 2] == word.to_be_bytes() {
        return Ok(sonic_noop_record(
            &stored,
            frame_id,
            "md_rgb333_palette_word",
            &rom,
        ));
    }
    rom[offset..offset + 2].copy_from_slice(&word.to_be_bytes());
    let mut edit = sonic_edit_record(frame_id, "md_rgb333_palette_word");
    edit.palette_index = palette_index;
    edit.red = red;
    edit.green = green;
    edit.blue = blue;
    persist_sonic_edit(stored, &base, &previous, &rom, edit)
}

/// Applies the selected frame's DPLC/column-major geometry, accumulating edits
/// on the last verified copy. The BYOR base is never opened for writing.
pub fn edit_sonic_tiles(
    session_id: &str,
    resource_id: &str,
    frame_id: &str,
    pixels: &[InspectionPixelEdit],
    allow_shared_tiles: bool,
) -> Result<InspectionEdit, String> {
    use super::sonic_sprite as sonic;
    if resource_id != "sonic1_sonic" {
        return Err(error(
            "edit_format_unsupported",
            "Arte não comprovada",
            false,
        ));
    }
    sonic::frame_index(frame_id)?;
    let _guard = SONIC_EDIT_GUARD.lock().map_err(|e| e.to_string())?;
    let stored = get_stored_session(session_id)?;
    let (base, mut rom) = super::sprite_composition::read_sonic_session_rom(&stored.session)?;
    let previous = rom.clone();
    let geometry = sonic::read_frame(&rom, frame_id)?;
    if pixels.is_empty() || pixels.len() > (geometry.width * geometry.height) as usize {
        return Err(error(
            "edit_pixels_invalid",
            "Quantidade de pixels fora do limite do frame",
            false,
        ));
    }
    let dplc = sonic::dplc_tiles(&base)?;
    let mut tiles = std::collections::BTreeSet::new();
    let mut changed = std::collections::BTreeSet::new();
    for pixel in pixels {
        if pixel.index > 15 {
            return Err(error(
                "edit_pixels_invalid",
                "Índice deve estar entre 0 e 15",
                false,
            ));
        }
        let location = geometry.source_pixel(pixel.x, pixel.y).ok_or_else(|| {
            error(
                "edit_pixel_unmapped",
                format!(
                    "Pixel ({},{}) não pertence ao mapping deste frame",
                    pixel.x, pixel.y
                ),
                false,
            )
        })?;
        let old = rom[location.byte_offset];
        let next = if location.high_nibble {
            (old & 15) | (pixel.index << 4)
        } else {
            (old & 0xf0) | pixel.index
        };
        if old != next {
            rom[location.byte_offset] = next;
            tiles.insert(location.art_tile);
            changed.insert((pixel.x, pixel.y));
        }
    }
    if changed.is_empty() {
        return Ok(sonic_noop_record(
            &stored,
            frame_id,
            "md_4bpp_tile_nibbles",
            &rom,
        ));
    }
    let shared: Vec<usize> = dplc
        .iter()
        .enumerate()
        .filter(|(i, t)| *i != geometry.index && t.iter().any(|tile| tiles.contains(tile)))
        .map(|(i, _)| i)
        .collect();
    if !shared.is_empty() && !allow_shared_tiles {
        return Err(error("edit_tile_shared", format!("Tiles {:?} também são usados pelos frames DPLC {:?}; confirme a edição compartilhada", tiles, shared), false));
    }
    let mut edit = sonic_edit_record(frame_id, "md_4bpp_tile_nibbles");
    edit.pixels_changed = Some(changed.len() as u32);
    persist_sonic_edit(stored, &base, &previous, &rom, edit)
}

/// Wire errors from the cadence core keep their proven contract code.
fn cadence_error(message: String) -> String {
    let (code, detail) = match message.split_once(':') {
        Some((code, detail)) => (code, detail.trim_start()),
        None => ("cadence_invalid", message.as_str()),
    };
    error(code, detail, false)
}

/// The proven `id_Wait` cadence as read from this session's ROMs. All
/// addresses and limits come from the core contract; the UI renders this.
pub fn sonic_cadence_info(session_id: &str) -> Result<super::sonic_cadence::CadenceInfo, String> {
    let stored = get_stored_session(session_id)?;
    let (base, rom) = super::sprite_composition::read_sonic_session_rom(&stored.session)
        .map_err(|e| error("cadence_rom_unreadable", e, false))?;
    super::sonic_cadence::describe(&base, &rom).map_err(cadence_error)
}

/// Changes only the proven duration byte, on the accumulated copy.
pub fn edit_sonic_duration(
    session_id: &str,
    resource_id: &str,
    value: u8,
) -> Result<InspectionEdit, String> {
    if resource_id != "sonic1_sonic" {
        return Err(error(
            "edit_resource_unsupported",
            "Recurso não comprovado",
            false,
        ));
    }
    let _guard = SONIC_EDIT_GUARD.lock().map_err(|e| e.to_string())?;
    let stored = get_stored_session(session_id)?;
    let (base, mut rom) = super::sprite_composition::read_sonic_session_rom(&stored.session)?;
    let previous = rom.clone();
    super::sonic_cadence::validate_base(&base).map_err(cadence_error)?;
    let current = super::sonic_cadence::read_interval(&rom).map_err(cadence_error)?;
    if value == current {
        return Ok(sonic_noop_record(
            &stored,
            "id_Wait",
            super::sonic_cadence::EDIT_FORMAT,
            &rom,
        ));
    }
    super::sonic_cadence::set_interval(&mut rom, value).map_err(cadence_error)?;
    let mut edit = sonic_edit_record("id_Wait", super::sonic_cadence::EDIT_FORMAT);
    edit.pixels_changed = None;
    persist_sonic_edit(stored, &base, &previous, &rom, edit)
}

/// The proven `id_Wait` frame sequence as read from this session's ROMs:
/// original vs current order plus the positions that differ. All addresses and
/// refusals live in `sonic_sequence`; the UI only renders this view.
pub fn sonic_sequence_info(
    session_id: &str,
) -> Result<super::sonic_sequence::SequenceInfo, String> {
    let stored = get_stored_session(session_id)?;
    let (base, rom) = super::sprite_composition::read_sonic_session_rom(&stored.session)
        .map_err(|e| error("sequence_rom_unreadable", e, false))?;
    super::sonic_sequence::describe(&base, &rom).map_err(cadence_error)
}

/// Reorders the 18 frame entries of the accumulated copy, in place. Writes only
/// `0x13BAF..0x13BC0`; the interval byte, terminator, pad and neighbours are
/// never touched. A proposal identical to the current order (including a swap of
/// two equal entries) is an explicit no-op, never a silent edit.
pub fn edit_sonic_sequence(
    session_id: &str,
    resource_id: &str,
    proposal: Vec<u8>,
) -> Result<InspectionEdit, String> {
    if resource_id != "sonic1_sonic" {
        return Err(error(
            "edit_resource_unsupported",
            "Recurso não comprovado",
            false,
        ));
    }
    let _guard = SONIC_EDIT_GUARD.lock().map_err(|e| e.to_string())?;
    let stored = get_stored_session(session_id)?;
    let (base, mut rom) = super::sprite_composition::read_sonic_session_rom(&stored.session)?;
    let previous = rom.clone();
    super::sonic_cadence::validate_base(&base).map_err(cadence_error)?;
    let outcome = super::sonic_sequence::permute(&mut rom, &proposal).map_err(cadence_error)?;
    if outcome.noop {
        return Ok(sonic_noop_record(
            &stored,
            "id_Wait",
            super::sonic_sequence::EDIT_FORMAT,
            &rom,
        ));
    }
    let mut edit = sonic_edit_record("id_Wait", super::sonic_sequence::EDIT_FORMAT);
    edit.pixels_changed = None;
    persist_sonic_edit(stored, &base, &previous, &rom, edit)
}

/// Restores only the frame sequence to its original order. The interval byte
/// (cadence domain), pixel edits, palette and terminator are left exactly as the
/// accumulated copy holds them — this never rewrites a foreign domain.
pub fn restore_sonic_sequence(
    session_id: &str,
    resource_id: &str,
) -> Result<InspectionEdit, String> {
    if resource_id != "sonic1_sonic" {
        return Err(error(
            "edit_resource_unsupported",
            "Recurso não comprovado",
            false,
        ));
    }
    let _guard = SONIC_EDIT_GUARD.lock().map_err(|e| e.to_string())?;
    let stored = get_stored_session(session_id)?;
    let (base, mut rom) = super::sprite_composition::read_sonic_session_rom(&stored.session)?;
    let previous = rom.clone();
    super::sonic_cadence::validate_base(&base).map_err(cadence_error)?;
    let prev_frames = super::sonic_sequence::restore(&mut rom).map_err(cadence_error)?;
    if prev_frames == super::sonic_cadence::WAIT_FRAMES.to_vec() {
        return Ok(sonic_noop_record(
            &stored,
            "id_Wait",
            super::sonic_sequence::EDIT_FORMAT,
            &rom,
        ));
    }
    let mut edit = sonic_edit_record("id_Wait", super::sonic_sequence::EDIT_FORMAT);
    edit.pixels_changed = None;
    persist_sonic_edit(stored, &base, &previous, &rom, edit)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "BYOR Sonic pinado; RDS_SONIC_MULTIFRAME_ROM obrigatório; escreva em RDS_DECOMP_WORK isolado"]
    fn sonic_multiframe_byor_accumulates_and_reopens_without_touching_base() {
        use super::super::{sonic_sprite as sonic, sprite_composition as comp};
        let path = std::env::var("RDS_SONIC_MULTIFRAME_ROM").expect("BYOR obrigatório");
        assert!(
            std::env::var("RDS_DECOMP_WORK").is_ok(),
            "diretório de prova isolado obrigatório"
        );
        let session = open(&path).unwrap();
        assert_eq!(
            session.identity.normalized_sha256,
            comp::SONIC1_REFERENCE_SHA256
        );
        let (_, base) = rex_read_rom(Path::new(&path)).unwrap();
        let mut evidence = Vec::new();
        for choice in sonic::choices() {
            let preview = comp::compose_for_session(
                &session,
                "sonic1_sonic",
                &choice.id,
                false,
                false,
                false,
            )
            .unwrap();
            assert_eq!(
                preview.sonic_context.as_ref().unwrap().mapping_index,
                choice.mapping_index
            );
            assert_eq!(
                preview
                    .sonic_context
                    .as_ref()
                    .unwrap()
                    .pixel_art_tiles
                    .len(),
                (preview.width * preview.height) as usize
            );
            evidence.push(serde_json::json!({"frame_id":choice.id,"width":preview.width,"height":preview.height,
                "pixels_sha256":preview.pixels_sha256,"png":preview.artifact,
                "context":preview.sonic_context}));
        }
        let frame_id = "sonic1_sonic/walk-1";
        let geometry = sonic::read_frame(&base, frame_id).unwrap();
        let loc = geometry.source_pixel(0, 0).unwrap();
        let previous = if loc.high_nibble {
            base[loc.byte_offset] >> 4
        } else {
            base[loc.byte_offset] & 15
        };
        let index = (previous + 1) % 16;
        let low_index = if base[loc.byte_offset] & 15 == 15 {
            14
        } else {
            15
        };
        let pixels = [
            InspectionPixelEdit { x: 0, y: 0, index },
            InspectionPixelEdit {
                x: 1,
                y: 0,
                index: low_index,
            },
        ];
        let refused = edit_sonic_tiles(
            &session.session_id,
            "sonic1_sonic",
            frame_id,
            &pixels,
            false,
        )
        .unwrap_err();
        assert!(refused.contains("edit_tile_shared"));
        assert!(get_stored_session(&session.session_id)
            .unwrap()
            .session
            .edit
            .is_none());
        assert!(edit_sonic_tiles(
            &session.session_id,
            "sonic1_sonic",
            frame_id,
            &[InspectionPixelEdit {
                x: u32::MAX,
                y: 0,
                index
            }],
            true
        )
        .unwrap_err()
        .contains("edit_pixel_unmapped"));
        let first =
            edit_sonic_tiles(&session.session_id, "sonic1_sonic", frame_id, &pixels, true).unwrap();
        let first_rom = rex_read_rom(Path::new(&first.modified_rom_path)).unwrap().1;
        assert_eq!(first_rom.len(), base.len());
        assert_eq!(first_rom[loc.byte_offset], (index << 4) | low_index);
        assert_eq!(first.bytes_changed, 1);
        let palette = edit_sonic_palette(
            &session.session_id,
            "sonic1_sonic",
            "sonic1_sonic/stand",
            1,
            7,
            0,
            7,
        )
        .unwrap();
        let palette_rom = rex_read_rom(Path::new(&palette.modified_rom_path))
            .unwrap()
            .1;
        assert_eq!(
            palette_rom[loc.byte_offset], first_rom[loc.byte_offset],
            "paleta não pode apagar pintura"
        );
        let second_loc = geometry.source_pixel(1, 0).unwrap();
        let second = edit_sonic_tiles(
            &session.session_id,
            "sonic1_sonic",
            frame_id,
            &[InspectionPixelEdit {
                x: 1,
                y: 0,
                index: 0,
            }],
            true,
        )
        .unwrap();
        let edited = rex_read_rom(Path::new(&second.modified_rom_path))
            .unwrap()
            .1;
        assert_eq!(
            &edited[sonic::PALETTE_OFFSET + 2..sonic::PALETTE_OFFSET + 4],
            &[0x0e, 0x0e]
        );
        assert_eq!(edited[second_loc.byte_offset] & 15, 0);
        assert_eq!(edited[loc.byte_offset] >> 4, index);
        let saved = save(&session.session_id, Some(frame_id)).unwrap();
        sessions().lock().unwrap().remove(&session.session_id);
        let reopened = reopen(&path, &session.session_id).unwrap();
        assert_eq!(reopened.sprite_frame_id.as_deref(), Some(frame_id));
        assert_eq!(reopened.edit, saved.edit);
        let after =
            comp::compose_for_session(&reopened, "sonic1_sonic", frame_id, false, false, false)
                .unwrap();
        assert_eq!(after.rom_sha256, second.modified_rom_sha256);
        assert_eq!(
            rex_read_rom(Path::new(&path)).unwrap().1,
            base,
            "BYOR intacta"
        );
        let report = serde_json::json!({"base_sha256":comp::SONIC1_REFERENCE_SHA256,"frames":evidence,
            "edit":second,"reopened_pixels_sha256":after.pixels_sha256,"accumulation":true,"base_unchanged":true});
        fs::write(
            decomp_work_dir().join("sonic-multiframe-proof.json"),
            serde_json::to_vec_pretty(&report).unwrap(),
        )
        .unwrap();
    }

    #[test]
    #[ignore = "BYOR Sonic pinado; RDS_SONIC_MULTIFRAME_ROM obrigatório; escreva em RDS_DECOMP_WORK isolado"]
    fn sonic_cadence_byor_edits_interval_and_reopens_without_touching_base() {
        use super::super::{sonic_cadence as cadence, sprite_composition as comp};
        let path = std::env::var("RDS_SONIC_MULTIFRAME_ROM").expect("BYOR obrigatório");
        assert!(
            std::env::var("RDS_DECOMP_WORK").is_ok(),
            "diretório de prova isolado obrigatório"
        );
        let session = open(&path).unwrap();
        let (_, base) = rex_read_rom(Path::new(&path)).unwrap();
        cadence::validate_base(&base).expect("contrato na ROM pinada");

        let info = sonic_cadence_info(&session.session_id).unwrap();
        assert_eq!(info.current_interval, cadence::WAIT_ORIGINAL_INTERVAL);
        assert_eq!(info.original_interval, cadence::WAIT_ORIGINAL_INTERVAL);
        assert_eq!(info.frames, cadence::WAIT_FRAMES.to_vec());

        for reserved in [cadence::EDITABLE_MIN - 1, 0x80, 0xfe] {
            let refused =
                edit_sonic_duration(&session.session_id, "sonic1_sonic", reserved).unwrap_err();
            assert!(refused.contains("cadence_value_reserved"), "{refused}");
            assert!(
                get_stored_session(&session.session_id)
                    .unwrap()
                    .session
                    .edit
                    .is_none(),
                "recusa não pode deixar edição registrada"
            );
        }
        let noop = edit_sonic_duration(
            &session.session_id,
            "sonic1_sonic",
            cadence::WAIT_ORIGINAL_INTERVAL,
        )
        .unwrap();
        assert!(noop.noop, "valor vigente deve devolver no-op explícito");
        assert_eq!(noop.bytes_changed, 0);
        assert!(noop.changed_offsets.is_empty());
        assert!(
            get_stored_session(&session.session_id)
                .unwrap()
                .session
                .edit
                .is_none(),
            "no-op não pode registrar edição nem escrever cópia"
        );
        assert!(
            get_stored_session(&session.session_id)
                .unwrap()
                .session
                .applied_edits
                .is_empty(),
            "no-op não entra no ledger de proveniência"
        );
        let wrong_resource =
            edit_sonic_duration(&session.session_id, "sonic1_tails", 40).unwrap_err();
        assert!(wrong_resource.contains("edit_resource_unsupported"));

        let first = edit_sonic_duration(&session.session_id, "sonic1_sonic", 40).unwrap();
        assert_eq!(first.bytes_changed, 1);
        assert_eq!(first.changed_offsets, vec![cadence::WAIT_ADDR as u64]);
        assert_eq!(first.format, cadence::EDIT_FORMAT);
        let first_rom = rex_read_rom(Path::new(&first.modified_rom_path)).unwrap().1;
        assert_eq!(first_rom.len(), base.len());
        assert_eq!(first_rom[cadence::WAIT_ADDR], 40);
        assert_eq!(
            (0..base.len())
                .filter(|&i| base[i] != first_rom[i])
                .collect::<Vec<_>>(),
            vec![cadence::WAIT_ADDR]
        );

        let second = edit_sonic_duration(&session.session_id, "sonic1_sonic", 60).unwrap();
        let second_rom = rex_read_rom(Path::new(&second.modified_rom_path))
            .unwrap()
            .1;
        assert_eq!(second.changed_offsets, vec![cadence::WAIT_ADDR as u64]);
        assert_eq!(second_rom[cadence::WAIT_ADDR], 60);
        let info_after = sonic_cadence_info(&session.session_id).unwrap();
        assert_eq!(
            (info_after.original_interval, info_after.current_interval),
            (cadence::WAIT_ORIGINAL_INTERVAL, 60)
        );

        // Cadência e pintura coexistem na mesma cópia cumulativa autorizada.
        let geometry = super::super::sonic_sprite::read_frame(&base, "sonic1_sonic/stand").unwrap();
        let loc = geometry.source_pixel(8, 8).unwrap();
        let previous = if loc.high_nibble {
            base[loc.byte_offset] >> 4
        } else {
            base[loc.byte_offset] & 15
        };
        let painted = edit_sonic_tiles(
            &session.session_id,
            "sonic1_sonic",
            "sonic1_sonic/stand",
            &[InspectionPixelEdit {
                x: 8,
                y: 8,
                index: (previous + 1) % 16,
            }],
            true,
        )
        .unwrap();
        assert!(painted
            .changed_offsets
            .contains(&(cadence::WAIT_ADDR as u64)));
        assert_eq!(painted.bytes_changed, 2);
        let painted_rom = rex_read_rom(Path::new(&painted.modified_rom_path))
            .unwrap()
            .1;
        assert_eq!(painted_rom[cadence::WAIT_ADDR], 60);
        let composed = comp::compose_for_session(
            &get_stored_session(&session.session_id).unwrap().session,
            "sonic1_sonic",
            "sonic1_sonic/stand",
            false,
            false,
            false,
        )
        .unwrap();
        assert_eq!(composed.rom_sha256, painted.modified_rom_sha256);
        // E2-3 (EXPECTATIONS-VISUAL-ETAPA2): a composição original usa os bytes
        // da base intocada pelo mesmo pipeline, mesmo com edições acumuladas.
        let original = comp::compose_for_session(
            &get_stored_session(&session.session_id).unwrap().session,
            "sonic1_sonic",
            "sonic1_sonic/stand",
            false,
            false,
            true,
        )
        .unwrap();
        assert_eq!(original.rom_sha256, super::sha256_hex(&base));
        assert_eq!(
            original.pixels_sha256.as_deref(),
            Some(comp::SONIC1_STAND_PIXELS_SHA256),
            "original pós-edição deve bater o golden da base"
        );
        assert_ne!(
            original.pixels_sha256, composed.pixels_sha256,
            "cópia pintada e original não podem colapsar na mesma imagem"
        );
        // Os quatro índices distintos do script id_Wait compõem como frames
        // reais pelo mesmo pipeline (mapping/DPLC), sem geometria paralela.
        let live = get_stored_session(&session.session_id).unwrap().session;
        let mut distinct = Vec::new();
        for byte in [0x01u8, 0x02, 0x03, 0x04] {
            let id = format!("sonic1_sonic/anim-{byte:02x}");
            let frame =
                comp::compose_for_session(&live, "sonic1_sonic", &id, false, false, false).unwrap();
            assert!(frame.available, "{id} deveria compor");
            distinct.push((id, frame.pixels_sha256));
        }
        let unique_hashes: std::collections::BTreeSet<_> =
            distinct.iter().map(|(_, hash)| hash.clone()).collect();
        assert!(
            unique_hashes.len() >= 2,
            "os índices do script não podem todos colapsar no mesmo pixel"
        );

        let saved = save(&session.session_id, None).unwrap();
        sessions().lock().unwrap().remove(&session.session_id);
        let reopened = reopen(&path, &session.session_id).unwrap();
        assert_eq!(reopened.edit, saved.edit);
        let info_reopened = sonic_cadence_info(&session.session_id).unwrap();
        assert_eq!(info_reopened.current_interval, 60);
        assert_eq!(
            rex_read_rom(Path::new(&path)).unwrap().1,
            base,
            "BYOR intacta"
        );
        let report = serde_json::json!({
            "base_sha256": comp::SONIC1_REFERENCE_SHA256,
            "interval_byte_addr": format!("0x{:X}", cadence::WAIT_ADDR),
            "original": cadence::WAIT_ORIGINAL_INTERVAL,
            "durations": [40, 60],
            "cumulative_with_paint": painted.bytes_changed,
            "edit": second,
            "reopened_current_interval": info_reopened.current_interval,
            "base_unchanged": true,
        });
        fs::write(
            decomp_work_dir().join("sonic-cadence-proof.json"),
            serde_json::to_vec_pretty(&report).unwrap(),
        )
        .unwrap();
    }

    /// Etapa 2/4 da jornada integrada: pixel + paleta + cadência acumulam na
    /// MESMA cadeia de cópias, nas duas ordens, com diff byte a byte exato,
    /// ledger de proveniência por domínio, restauração seletiva e reabertura.
    #[test]
    #[ignore = "BYOR Sonic pinado; RDS_SONIC_MULTIFRAME_ROM obrigatório; escreva em RDS_DECOMP_WORK isolado"]
    fn sonic_anim_integrada_byor_accumulates_all_domains_both_orders() {
        use super::super::{sonic_cadence as cadence, sonic_sprite as sonic};
        let path = std::env::var("RDS_SONIC_MULTIFRAME_ROM").expect("BYOR obrigatório");
        assert!(
            std::env::var("RDS_DECOMP_WORK").is_ok(),
            "diretório de prova isolado obrigatório"
        );
        let (_, base) = rex_read_rom(Path::new(&path)).unwrap();

        // Dois pixels em bytes de arte distintos + uma cor de paleta + cadência.
        let geometry = sonic::read_frame(&base, "sonic1_sonic/stand").unwrap();
        let loc_a = geometry.source_pixel(8, 8).unwrap();
        let loc_b = geometry.source_pixel(9, 9).unwrap();
        assert_ne!(
            loc_a.byte_offset, loc_b.byte_offset,
            "os dois pixels precisam tocar bytes distintos para a contagem ser exata"
        );
        let index_a = {
            let prev = if loc_a.high_nibble {
                base[loc_a.byte_offset] >> 4
            } else {
                base[loc_a.byte_offset] & 15
            };
            (prev + 1) % 16
        };
        let index_b = {
            let prev = if loc_b.high_nibble {
                base[loc_b.byte_offset] >> 4
            } else {
                base[loc_b.byte_offset] & 15
            };
            (prev + 7) % 16
        };
        assert_ne!(index_b, 0, "transparência não é alvo aqui");
        let pal_word = sonic::PALETTE_OFFSET + 3 * 2;
        // word = (red<<1) | (green<<5) | (blue<<9), gravado big-endian.
        // Byte alto: bits 8..15 (azul em 9..11). Byte baixo: bits 0..7
        // (vermelho 1..3, verde 5..7). Bit 8 não é usado pelo produto.
        let pal_new: [u8; 2] = [base[pal_word] ^ 0x02, base[pal_word + 1] ^ 0x02];
        let pal_red = (pal_new[1] & 0b0000_1110) >> 1;
        let pal_green = (pal_new[1] & 0b1110_0000) >> 5;
        let pal_blue = (pal_new[0] & 0b0000_1110) >> 1;
        let recomputed =
            (u16::from(pal_red) << 1) | (u16::from(pal_green) << 5) | (u16::from(pal_blue) << 9);
        assert_eq!(
            recomputed.to_be_bytes(),
            pal_new,
            "canais reconstroem a palavra-alvo"
        );

        let expected_diff: Vec<usize> = {
            let mut v = vec![
                loc_a.byte_offset,
                loc_b.byte_offset,
                pal_word,
                pal_word + 1,
                cadence::WAIT_ADDR,
            ];
            v.sort_unstable();
            v
        };

        let run_chain = |order: u8| -> String {
            let session = open(&path).unwrap();
            let paint = || {
                edit_sonic_tiles(
                    &session.session_id,
                    "sonic1_sonic",
                    "sonic1_sonic/stand",
                    &[
                        InspectionPixelEdit {
                            x: 8,
                            y: 8,
                            index: index_a,
                        },
                        InspectionPixelEdit {
                            x: 9,
                            y: 9,
                            index: index_b,
                        },
                    ],
                    true,
                )
                .unwrap()
            };
            let palette = || {
                edit_sonic_palette(
                    &session.session_id,
                    "sonic1_sonic",
                    "sonic1_sonic/stand",
                    3,
                    pal_red,
                    pal_green,
                    pal_blue,
                )
                .unwrap()
            };
            let duration = || edit_sonic_duration(&session.session_id, "sonic1_sonic", 40).unwrap();
            let last = match order {
                0 => {
                    paint();
                    palette();
                    duration()
                }
                _ => {
                    duration();
                    palette();
                    paint()
                }
            };
            assert_eq!(
                last.changed_offsets,
                expected_diff.iter().map(|&i| i as u64).collect::<Vec<_>>(),
                "diff cumulativo da cadeia {order} contra a base precisa ser exatamente os 5 bytes autorizados"
            );
            let stored = get_stored_session(&session.session_id).unwrap().session;
            assert_eq!(
                stored.applied_edits.len(),
                3,
                "ledger com um registro por domínio"
            );
            let seqs: Vec<u32> = stored.applied_edits.iter().map(|e| e.seq).collect();
            assert_eq!(seqs, vec![1, 2, 3]);
            let formats: Vec<&str> = stored
                .applied_edits
                .iter()
                .map(|e| e.format.as_str())
                .collect();
            let expected_formats: &[&str] = if order == 0 {
                &[
                    "md_4bpp_tile_nibbles",
                    "md_rgb333_palette_word",
                    cadence::EDIT_FORMAT,
                ]
            } else {
                &[
                    cadence::EDIT_FORMAT,
                    "md_rgb333_palette_word",
                    "md_4bpp_tile_nibbles",
                ]
            };
            assert_eq!(formats, expected_formats);
            // Cada entrada nomeia seus bytes pontuais e o SHA da cópia resultante.
            let cadence_entry = stored
                .applied_edits
                .iter()
                .find(|e| e.format == cadence::EDIT_FORMAT)
                .unwrap();
            assert_eq!(cadence_entry.offsets, vec![cadence::WAIT_ADDR as u64]);
            assert_eq!(
                cadence_entry.old_bytes,
                vec![cadence::WAIT_ORIGINAL_INTERVAL]
            );
            assert_eq!(cadence_entry.new_bytes, vec![40]);
            assert!(cadence_entry.summary.contains("id_Wait"));
            assert!(cadence_entry.summary.contains("40"));
            let paint_entry = stored
                .applied_edits
                .iter()
                .find(|e| e.format == "md_4bpp_tile_nibbles")
                .unwrap();
            assert!(paint_entry.offsets.contains(&(loc_a.byte_offset as u64)));
            assert!(paint_entry.offsets.contains(&(loc_b.byte_offset as u64)));
            assert_eq!(
                stored.applied_edits.last().unwrap().copy_sha256,
                last.modified_rom_sha256
            );
            last.modified_rom_sha256
        };

        let sha_a = run_chain(0);
        let sha_b = run_chain(1);
        assert_eq!(
            sha_a, sha_b,
            "comutatividade byte a byte: as duas ordens convergem para a mesma cópia"
        );

        // Restauração seletiva: cadeia 0 → volta só a cadência; pixel/paleta intactos.
        let session = open(&path).unwrap();
        edit_sonic_tiles(
            &session.session_id,
            "sonic1_sonic",
            "sonic1_sonic/stand",
            &[
                InspectionPixelEdit {
                    x: 8,
                    y: 8,
                    index: index_a,
                },
                InspectionPixelEdit {
                    x: 9,
                    y: 9,
                    index: index_b,
                },
            ],
            true,
        )
        .unwrap();
        edit_sonic_palette(
            &session.session_id,
            "sonic1_sonic",
            "sonic1_sonic/stand",
            3,
            pal_red,
            pal_green,
            pal_blue,
        )
        .unwrap();
        edit_sonic_duration(&session.session_id, "sonic1_sonic", 40).unwrap();
        let restored = edit_sonic_duration(
            &session.session_id,
            "sonic1_sonic",
            cadence::WAIT_ORIGINAL_INTERVAL,
        )
        .unwrap();
        let restored_rom = rex_read_rom(Path::new(&restored.modified_rom_path))
            .unwrap()
            .1;
        let mut expected_restored: Vec<usize> =
            vec![loc_a.byte_offset, loc_b.byte_offset, pal_word, pal_word + 1];
        expected_restored.sort_unstable();
        assert_eq!(
            (0..base.len())
                .filter(|&i| base[i] != restored_rom[i])
                .collect::<Vec<_>>(),
            expected_restored,
            "restaurar cadência não pode apagar edição gráfica"
        );
        assert_eq!(
            restored_rom[cadence::WAIT_ADDR],
            cadence::WAIT_ORIGINAL_INTERVAL
        );
        assert_ne!(
            restored_rom[loc_a.byte_offset], base[loc_a.byte_offset],
            "pixel pintado permanece"
        );
        // No-op por domínio: repetir o valor vigente não escreve nem movimenta a cadeia.
        let before_sha = restored.modified_rom_sha256.clone();
        let noop = edit_sonic_duration(
            &session.session_id,
            "sonic1_sonic",
            cadence::WAIT_ORIGINAL_INTERVAL,
        )
        .unwrap();
        assert!(noop.noop);
        assert_eq!(noop.bytes_changed, 0);
        let noop_palette = edit_sonic_palette(
            &session.session_id,
            "sonic1_sonic",
            "sonic1_sonic/stand",
            3,
            pal_red,
            pal_green,
            pal_blue,
        )
        .unwrap();
        assert!(noop_palette.noop);
        let noop_paint = edit_sonic_tiles(
            &session.session_id,
            "sonic1_sonic",
            "sonic1_sonic/stand",
            &[InspectionPixelEdit {
                x: 8,
                y: 8,
                index: index_a,
            }],
            true,
        )
        .unwrap();
        assert!(noop_paint.noop);
        let stored = get_stored_session(&session.session_id).unwrap().session;
        assert_eq!(
            stored.edit.as_ref().unwrap().modified_rom_sha256,
            before_sha,
            "no-op não move a cadeia de SHA"
        );
        assert_eq!(
            stored.applied_edits.len(),
            4,
            "3 edições + 1 restauração; no-ops fora"
        );

        // Reabertura restaura conjunto + proveniência de todos os domínios.
        let saved = save(&session.session_id, None).unwrap();
        sessions().lock().unwrap().remove(&session.session_id);
        let reopened = reopen(&path, &session.session_id).unwrap();
        assert_eq!(reopened.edit, saved.edit);
        assert_eq!(reopened.applied_edits.len(), 4);
        let info = sonic_cadence_info(&session.session_id).unwrap();
        assert_eq!(info.current_interval, cadence::WAIT_ORIGINAL_INTERVAL);
        let final_rom = rex_read_rom(Path::new(&saved.edit.as_ref().unwrap().modified_rom_path))
            .unwrap()
            .1;
        assert_eq!(
            (0..base.len()).filter(|&i| base[i] != final_rom[i]).count(),
            4,
            "estado final: só arte+paleta divergem da base"
        );
        assert_eq!(
            rex_read_rom(Path::new(&path)).unwrap().1,
            base,
            "BYOR intacta"
        );
        let report = serde_json::json!({
            "base_sha256": super::super::sprite_composition::SONIC1_REFERENCE_SHA256,
            "chain_paint_first_sha": sha_a,
            "chain_cadence_first_sha": sha_b,
            "commutative": sha_a == sha_b,
            "diff_bytes": expected_diff,
            "ledger_entries": 3,
            "restored_diff_count": 4,
            "noop_classified": true,
            "reopened_ledger_entries": 4,
            "base_unchanged": true,
        });
        fs::write(
            decomp_work_dir().join("sonic-anim-integrada-proof.json"),
            serde_json::to_vec_pretty(&report).unwrap(),
        )
        .unwrap();
    }

    /// Etapa 4, passo 1 (sonda rotulada): liga o core Libretro real com a ROM
    /// BYOR pinada, entra no jogo apenas por input e registra o que o core
    /// expõe. Descobre por temporalidade (não por mapa fixo) o contador de
    /// duração da animação do jogador e grava a log de mudanças do framebuffer.
    /// Nada aqui é promovido a prova: a prova é o oracle que consome estes
    /// endereços descobertos.
    #[test]
    #[ignore = "BYOR Sonic pinado + core Libretro real; requer RDS_SONIC_MULTIFRAME_ROM e RDS_DECOMP_WORK"]
    fn sonic_cadence_byor_probe_discovers_player_timer_on_real_core() {
        use super::super::{sonic_cadence as cadence, sprite_composition as comp};
        use crate::core::rom_mastering::sha256_hex;
        use crate::emulator::frame_buffer::framebuffer_to_rgba;
        use crate::emulator::libretro_ffi::{EmulatorCore, JoypadState};

        let path = std::env::var("RDS_SONIC_MULTIFRAME_ROM").expect("BYOR obrigatório");
        assert!(
            std::env::var("RDS_DECOMP_WORK").is_ok(),
            "diretório de prova isolado obrigatório"
        );
        let rom_bytes = fs::read(&path).unwrap();
        assert_eq!(
            sha256_hex(&rom_bytes),
            comp::SONIC1_REFERENCE_SHA256,
            "a sonda só roda contra a ROM pinada do contrato"
        );

        let mut emu = EmulatorCore::new(None);
        emu.load_rom(Path::new(&path)).expect("core real + BYOR");
        let regions: Vec<serde_json::Value> = emu
            .capture_normalized_regions()
            .into_iter()
            .map(|region| {
                serde_json::json!({
                    "label": region.label,
                    "region_id": region.region_id,
                    "available": region.available,
                    "size": region.size,
                })
            })
            .collect();
        let (probe_bytes, wram_total) = emu.read_memory(2, 0, usize::MAX).expect("leitura WRAM");
        assert_eq!(probe_bytes.len(), wram_total, "WRAM legível no offset 0");

        // Rota de entrada: neutro até o frame 900, START segurado por 2 frames,
        // liberado, neutro ate o frame 2400. Nenhuma escrita em estado.
        // (A execucao 2 desta sonda mostrou que um segundo START congela tudo:
        // e o pause do jogo, o que confirma que o primeiro START entra em jogo.)
        let total_frames = 2400usize;
        // Triplo descoberto pela execucao anterior da sonda por voto temporal
        // (nao por mapa fixo): timer 0xD01F, anim 0xD01D, frame 0xD01B.
        // Esta execucao caracteriza a serie temporal desses bytes.
        const TIMER_IDX: usize = 0xD01F;
        const ANIM_IDX: usize = 0xD01D;
        const FRAME_IDX: usize = 0xD01B;
        let mut previous: Option<Vec<u8>> = None;
        let mut timer_votes: std::collections::BTreeMap<usize, usize> =
            std::collections::BTreeMap::new();
        // Voto condicional: decremento observado com o byte de animacao do
        // objeto (timer - 2, pois obAnim=$1C e obTimeFrame=$1E) igual a 5.
        let mut wait_votes: std::collections::BTreeMap<usize, usize> =
            std::collections::BTreeMap::new();
        let mut center_roi_changes: Vec<usize> = Vec::new();
        let mut previous_roi_hash: Option<String> = None;
        let mut full_frame_changes: Vec<usize> = Vec::new();
        let mut previous_full_hash: Option<String> = None;
        let mut byte_series: Vec<serde_json::Value> = Vec::new();
        let mut wram_at_probe_frame: Option<Vec<u8>> = None;

        for frame in 0..total_frames {
            let pressed = (900..902).contains(&frame);
            let joypad = if pressed {
                JoypadState {
                    start: true,
                    ..JoypadState::default()
                }
            } else {
                JoypadState::default()
            };
            emu.set_joypad(joypad).unwrap();
            emu.run_frame().unwrap();
            let (current, _) = emu.read_memory(2, 0, usize::MAX).unwrap();
            if frame == 2300 {
                wram_at_probe_frame = Some(current.clone());
            }
            if (1200..total_frames).contains(&frame)
                && current[ANIM_IDX] == cadence::WAIT_ANIM as u8
            {
                byte_series.push(serde_json::json!({
                    "frame": frame,
                    "timer": current[TIMER_IDX],
                    "anim": current[ANIM_IDX],
                    "frame_byte": current[FRAME_IDX],
                }));
            }
            if frame > 1200 {
                if let Some(previous) = &previous {
                    for address in 0..current.len().min(previous.len()) {
                        let (before, now) = (previous[address], current[address]);
                        if before == now {
                            continue;
                        }
                        let decreased =
                            (before > 0 && now == before - 1) || (before == 0 && now == 23);
                        if decreased {
                            *timer_votes.entry(address).or_default() += 1;
                            if address >= 0x2
                                && current.get(address - 0x2) == Some(&(cadence::WAIT_ANIM as u8))
                            {
                                *wait_votes.entry(address).or_default() += 1;
                            }
                        }
                    }
                }
            }
            {
                let (raw, size, format) = emu.get_framebuffer().unwrap();
                let payload = framebuffer_to_rgba(&raw, size, format);
                let full_hash = sha256_hex(&payload.rgba);
                if previous_full_hash
                    .as_ref()
                    .is_some_and(|last| *last != full_hash)
                {
                    full_frame_changes.push(frame);
                }
                previous_full_hash = Some(full_hash);
                if frame > 1200 {
                    let (w, h) = (payload.width as usize, payload.height as usize);
                    let (x0, y0) = (w / 2 - 32, h / 2 - 24);
                    let mut roi = Vec::with_capacity(64 * 48 * 4);
                    for y in y0..y0 + 48 {
                        for x in x0..x0 + 64 {
                            let offset = (y * w + x) * 4;
                            roi.extend_from_slice(&payload.rgba[offset..offset + 4]);
                        }
                    }
                    let hash = sha256_hex(&roi);
                    if previous_roi_hash.as_ref().is_some_and(|last| *last != hash) {
                        center_roi_changes.push(frame);
                    }
                    previous_roi_hash = Some(hash);
                }
            }
            previous = Some(current);
        }

        let hot_addresses: Vec<usize> = timer_votes
            .iter()
            .filter(|(_, votes)| **votes > 400)
            .map(|(address, _)| *address)
            .collect();
        let hot_timers: Vec<serde_json::Value> = hot_addresses
            .iter()
            .map(|address| {
                let base = address.checked_sub(0x1E);
                serde_json::json!({
                    "wram_offset": format!("0x{:04X}", address),
                    "decrement_votes": timer_votes[address],
                    "wait_anim_votes": wait_votes.get(address).copied().unwrap_or(0),
                    "object_base_guess": base.map(|value| format!("0x{:04X}", value)),
                })
            })
            .collect();
        let window_dump = wram_at_probe_frame.map(|bytes| {
            hot_addresses
                .iter()
                .filter_map(|address| {
                    let base = address.checked_sub(0x1E)?;
                    let end = base + 0x40;
                    if end > bytes.len() {
                        return None;
                    }
                    Some(serde_json::json!({
                        "base": format!("0x{:04X}", base),
                        "bytes_hex": bytes[base..end].iter().map(|byte| format!("{byte:02x}")).collect::<String>(),
                    }))
                })
                .collect::<Vec<_>>()
        });

        let report = serde_json::json!({
            "probe": true,
            "rom_sha256": comp::SONIC1_REFERENCE_SHA256,
            "core_file": emu.loaded_core_file().map(|value| value.display().to_string()),
            "regions": regions,
            "wram_total": wram_total,
            "frames_run": emu.frame_index(),
            "hot_timers": hot_timers,
            "full_frame_change_frames": full_frame_changes,
            "byte_series": byte_series,
            "wait_vote_totals": wait_votes.iter().map(|(address, votes)| serde_json::json!({
                "wram_offset": format!("0x{:04X}", address),
                "votes": votes,
            })).collect::<Vec<_>>(),
            "center_roi_change_frames": center_roi_changes,
            "window_dumps": window_dump,
            "layer": "sonda rotulada: só observação passiva + input; nada é escrito no estado",
        });
        fs::write(
            decomp_work_dir().join("sonic-cadence-probe.json"),
            serde_json::to_vec_pretty(&report).unwrap(),
        )
        .unwrap();
        emu.stop().ok();
    }

    /// Etapa 4: oracle de duracoes efetivas. Roda no core real a ROM pinada,
    /// as copias canonicas (intervalo 40 e 60) e controles, descobrindo o
    /// triplo do jogador por voto temporal em CADA ROM (nunca por mapa fixo) e
    /// gravando series por corrida em RDS_DECOMP_WORK/oracle/. A arbitragem
    /// H-N vs H-N+1 e a avaliacao dos negativos pertencem ao verificador
    /// independente scripts/qa/sonic-cadence-runtime-oracle.mjs; as assercoes
    /// aqui so seguram as portas duras (escopo de byte, recusas, determinismo,
    /// discriminacao entre durações). Expectativas congeladas antes da execucao
    /// em docs/rex_profiles/sonic_cadence/EXPECTATIONS-ETAPA4.md.
    #[test]
    #[ignore = "BYOR Sonic pinado + core real; 6 corridas de ~3300 frames; requer RDS_SONIC_MULTIFRAME_ROM e RDS_DECOMP_WORK"]
    fn sonic_cadence_runtime_oracle_measures_effective_durations_on_real_core() {
        use super::super::{sonic_cadence as cadence, sprite_composition as comp};
        use crate::core::rom_mastering::sha256_hex;
        use crate::emulator::libretro_ffi::{EmulatorCore, JoypadState};

        let rom_path = std::env::var("RDS_SONIC_MULTIFRAME_ROM").expect("BYOR obrigatorio");
        let work =
            std::env::var("RDS_DECOMP_WORK").expect("diretorio de prova isolado obrigatorio");
        let oracle_dir = Path::new(&work).join("oracle");
        fs::create_dir_all(&oracle_dir).unwrap();

        // C6: somente a ROM pinada entra no oracle.
        let base_bytes = fs::read(&rom_path).unwrap();
        let base_sha = sha256_hex(&base_bytes);
        assert_eq!(
            base_sha,
            comp::SONIC1_REFERENCE_SHA256,
            "C6: ROM fora do SHA pinado e recusada antes de tocar o core"
        );

        // Copias produzidas PELO PIPELINE CANONICO (nada de byte-patch manual
        // para as variantes 40/60).
        let session = open(&rom_path).unwrap();
        let edit40 = edit_sonic_duration(&session.session_id, "sonic1_sonic", 40).unwrap();
        let edit60 = edit_sonic_duration(&session.session_id, "sonic1_sonic", 60).unwrap();

        // C5: valores reservados enoop recusados pelo pipeline (nada chega ao core).
        for reserved in [0u8, 0x80, 0xFE, 0xFF] {
            assert!(
                edit_sonic_duration(&session.session_id, "sonic1_sonic", reserved).is_err(),
                "C5: valor reservado {reserved} deveria ser recusado"
            );
        }
        assert!(edit_sonic_duration(&session.session_id, "sonic1_tails", 45).is_err());
        assert!(
            edit_sonic_duration(&session.session_id, "sonic1_sonic", 60).is_err(),
            "C5: edicao noop (atual==60) deveria ser recusada"
        );

        // C4 + C7: lidos dos ARQUIVOS pelos bytes, sem parser do produto.
        for (edit, expected) in [(&edit40, 40u8), (&edit60, 60u8)] {
            let copy = fs::read(&edit.modified_rom_path).unwrap();
            assert_eq!(copy.len(), base_bytes.len());
            let diffs: Vec<usize> = (0..copy.len())
                .filter(|i| copy[*i] != base_bytes[*i])
                .collect();
            assert_eq!(
                diffs,
                vec![cadence::WAIT_ADDR],
                "C4: escopo exato de escrita"
            );
            assert_eq!(copy[cadence::WAIT_ADDR], expected);
            assert_eq!(sha256_hex(&copy), edit.modified_rom_sha256);
            assert_eq!(
                &copy[0x139c4..0x139c4 + cadence::SONIC_ANIMATE_PROLOGUE.len()],
                cadence::SONIC_ANIMATE_PROLOGUE,
                "C7: consumidor da cadencia intacto na copia"
            );
        }

        // D: consumidor adulterado manualmente (fora do pipeline), so para
        // mostrar que a cadencia provada depende dele. Prologo em 0x139C4.
        let mut tampered = base_bytes.clone();
        tampered[0x139c4] ^= 0x01;
        let tampered_path = oracle_dir.join("manual-consumer-tampered.bin");
        fs::write(&tampered_path, &tampered).unwrap();

        fn route(frame: usize) -> JoypadState {
            if (900..902).contains(&frame) {
                JoypadState {
                    start: true,
                    ..JoypadState::default()
                }
            } else {
                JoypadState::default()
            }
        }

        // Fase 1: descoberta do timer do jogador por voto temporal — byte que
        // decresce de 1 por frame com o byte de animacao (2 antes, obAnim=$1C
        // vs obTimeFrame=$1E) valendo 5. Nenhum endereco e assumido: cada ROM
        // re-descobre o proprio indice de regiao.
        fn discover(rom: &Path) -> Option<(usize, u8)> {
            use super::super::sonic_cadence as cadence;
            use crate::emulator::libretro_ffi::EmulatorCore;
            const WINDOW: usize = 1200;
            const END: usize = 1600;
            let mut emu = EmulatorCore::new(None);
            emu.load_rom(rom).ok()?;
            let mut previous: Option<Vec<u8>> = None;
            let mut votes: std::collections::BTreeMap<usize, usize> =
                std::collections::BTreeMap::new();
            let mut jumps: std::collections::BTreeMap<
                usize,
                std::collections::BTreeMap<u8, usize>,
            > = std::collections::BTreeMap::new();
            for frame in 0..END {
                emu.set_joypad(route(frame)).ok()?;
                emu.run_frame().ok()?;
                let (current, _) = emu.read_memory(2, 0, usize::MAX).ok()?;
                if frame >= WINDOW {
                    if let Some(previous) = &previous {
                        for address in 2..current.len() {
                            if current[address - 2] != cadence::WAIT_ANIM as u8 {
                                continue;
                            }
                            let (before, now) = (previous[address], current[address]);
                            if before > 0 && now == before - 1 {
                                *votes.entry(address).or_default() += 1;
                            } else if before == 0 && now != 0 {
                                *jumps.entry(address).or_default().entry(now).or_default() += 1;
                            }
                        }
                    }
                }
                previous = Some(current);
            }
            emu.stop().ok();
            let (timer, vote_count) = votes.into_iter().max_by_key(|(_, count)| *count)?;
            if vote_count < (END - WINDOW) * 2 / 3 {
                return None;
            }
            let reload = jumps
                .remove(&timer)?
                .into_iter()
                .max_by_key(|(_, count)| *count)?
                .0;
            Some((timer, reload))
        }

        // Fase 2: serie temporal a partir do timer descoberto + transicoes do
        // byte de frame ($1A = timer-4) + mudancas de framebuffer pleno.
        fn series(rom: &Path, timer: usize) -> serde_json::Value {
            use super::super::sonic_cadence as cadence;
            use crate::core::rom_mastering::sha256_hex;
            use crate::emulator::frame_buffer::framebuffer_to_rgba;
            use crate::emulator::libretro_ffi::EmulatorCore;
            const WINDOW: usize = 1200;
            const END: usize = 3300;
            let mut emu = EmulatorCore::new(None);
            emu.load_rom(rom).expect("core real na fase 2");
            let mut rows: Vec<serde_json::Value> = Vec::new();
            let mut frame_changes: Vec<usize> = Vec::new();
            let mut previous_full: Option<String> = None;
            for frame in 0..END {
                emu.set_joypad(route(frame)).unwrap();
                emu.run_frame().unwrap();
                let (current, _) = emu.read_memory(2, 0, usize::MAX).unwrap();
                if frame >= WINDOW {
                    if current.get(timer - 2) == Some(&(cadence::WAIT_ANIM as u8)) {
                        rows.push(serde_json::json!({
                            "frame": frame,
                            "timer": current[timer],
                            "frame_byte": current[timer - 4],
                        }));
                    }
                    let (raw, size, format) = emu.get_framebuffer().unwrap();
                    let payload = framebuffer_to_rgba(&raw, size, format);
                    let full = sha256_hex(&payload.rgba);
                    if previous_full.as_ref().is_some_and(|last| *last != full) {
                        frame_changes.push(frame);
                    }
                    previous_full = Some(full);
                }
            }
            emu.stop().ok();
            let mut transitions: Vec<usize> = Vec::new();
            for i in 1..rows.len() {
                let before = rows[i - 1]["frame"].as_u64().unwrap() as usize;
                let now = rows[i]["frame"].as_u64().unwrap() as usize;
                if now != before + 1 {
                    continue;
                }
                if rows[i]["frame_byte"] != rows[i - 1]["frame_byte"] {
                    transitions.push(now);
                }
            }
            let gaps: Vec<usize> = (1..transitions.len())
                .map(|i| transitions[i] - transitions[i - 1])
                .collect();
            serde_json::json!({
                "rows": rows,
                "transitions": transitions,
                "gaps": gaps,
                "frame_change_frames": frame_changes,
            })
        }

        fn mode_usize(values: &[usize]) -> Option<usize> {
            let mut counts: std::collections::BTreeMap<usize, usize> =
                std::collections::BTreeMap::new();
            for value in values {
                *counts.entry(*value).or_default() += 1;
            }
            counts
                .into_iter()
                .max_by_key(|(_, count)| *count)
                .map(|(value, _)| value)
        }

        fn run_one(
            run_id: &str,
            rom: &Path,
            rom_sha: &str,
            oracle_dir: &Path,
        ) -> serde_json::Value {
            let file_interval_byte = fs::read(rom).ok().map(|bytes| bytes[cadence::WAIT_ADDR]);
            let discovered = discover(rom);
            let mut record = serde_json::json!({
                "schema": "rex-sonic-cadence-run/v1",
                "run_id": run_id,
                "rom_path": rom.display().to_string(),
                "rom_sha256": rom_sha,
                "file_interval_byte": file_interval_byte,
                "discovery": discovered.as_ref().map(|(timer, reload)| serde_json::json!({
                    "timer_region_index": format!("0x{timer:04X}"),
                    "reload_byte": reload,
                })),
            });
            if let Some((timer, _)) = &discovered {
                let captured = series(rom, *timer);
                let gaps: Vec<usize> = captured["gaps"]
                    .as_array()
                    .map(|values| {
                        values
                            .iter()
                            .filter_map(|value| value.as_u64())
                            .map(|v| v as usize)
                            .collect()
                    })
                    .unwrap_or_default();
                record["gaps_mode"] = serde_json::json!(mode_usize(&gaps));
                record["transition_count"] =
                    serde_json::json!(captured["transitions"].as_array().map(Vec::len));
                record["series"] = captured;
            }
            fs::write(
                oracle_dir.join(format!("run-{run_id}.json")),
                serde_json::to_vec_pretty(&record).unwrap(),
            )
            .unwrap();
            record
        }

        // Ordem da tabela: A1/A2 (controle), variantes, A3 (no-op depois), D.
        let a1 = run_one("A1-original", Path::new(&rom_path), &base_sha, &oracle_dir);
        let a2 = run_one(
            "A2-original-controle",
            Path::new(&rom_path),
            &base_sha,
            &oracle_dir,
        );
        let b = run_one(
            "B40-pipeline",
            Path::new(&edit40.modified_rom_path),
            &edit40.modified_rom_sha256,
            &oracle_dir,
        );
        let c = run_one(
            "C60-pipeline",
            Path::new(&edit60.modified_rom_path),
            &edit60.modified_rom_sha256,
            &oracle_dir,
        );
        let a3 = run_one(
            "A3-original-pos-variantes",
            Path::new(&rom_path),
            &base_sha,
            &oracle_dir,
        );
        let tampered_sha = sha256_hex(&tampered);
        let d = run_one(
            "D-consumidor-adulterado",
            &tampered_path,
            &tampered_sha,
            &oracle_dir,
        );

        // C1/C2: mesma ROM, mesma serie, antes e depois das variantes.
        assert_eq!(
            a1["series"], a2["series"],
            "C1: a ROM pinada deve reproduzir a serie exata"
        );
        assert_eq!(
            a1["series"], a3["series"],
            "C2: a original segue inalterada depois de rodar as variantes"
        );

        let mode_a = a1["gaps_mode"]
            .as_u64()
            .expect("A1: cadencia descobrivivel");
        let mode_b = b["gaps_mode"]
            .as_u64()
            .expect("B40: cadencia descobrivivel");
        let mode_c = c["gaps_mode"]
            .as_u64()
            .expect("C60: cadencia descobrivivel");
        assert!(
            matches!(mode_a, 23 | 24),
            "A1 esperado 23 (H-N) ou 24 (H-N+1); veio {mode_a}"
        );
        assert!(
            matches!(mode_b, 40 | 41),
            "B40 esperado 40 ou 41; veio {mode_b}"
        );
        assert!(
            matches!(mode_c, 60 | 61),
            "C60 esperado 60 ou 61; veio {mode_c}"
        );
        for record in [&a1, &b, &c] {
            let count = record["transition_count"].as_u64().unwrap_or(0);
            assert!(
                count >= 5,
                "transicoes insuficientes para arbitrar: {count}"
            );
        }

        // C3: mutacao discriminante — as tres duracoes devem diferir entre si.
        assert_ne!(mode_a, mode_b, "40 nao discriminou contra o original");
        assert_ne!(mode_b, mode_c, "60 nao discriminou contra 40");
        assert_ne!(mode_a, mode_c, "60 nao discriminou contra o original");

        // O reload observado deve ser o byte do arquivo: prova de consumo.
        for (record, expected) in [(&a1, 23u8), (&b, 40), (&c, 60)] {
            let reload = record["discovery"]["reload_byte"].as_u64().unwrap() as u8;
            assert_eq!(
                reload, expected,
                "{}: reload != byte do arquivo",
                record["run_id"]
            );
        }

        // D negativo: o consumidor adulterado a mao nao pode reproduzir a
        // cadencia provada do original (23/24).
        let mode_d = d["gaps_mode"].as_u64();
        assert!(
            !matches!(mode_d, Some(23) | Some(24)),
            "consumidor adulterado ainda produz a cadencia original (modo {mode_d:?})"
        );

        let core_sha = {
            // loaded_core_file() so aponta para o core depois de um load real;
            // uma instancia virgem retornaria None e o manifesto sairia cego.
            let mut tracer = EmulatorCore::new(None);
            tracer.load_rom(Path::new(&rom_path)).ok();
            let sha = tracer
                .loaded_core_file()
                .and_then(|path| fs::read(path).ok())
                .map(|bytes| sha256_hex(&bytes));
            tracer.stop().ok();
            sha
        };
        let binary_sha = std::env::current_exe()
            .ok()
            .and_then(|path| fs::read(path).ok())
            .map(|bytes| sha256_hex(&bytes));
        let harness_sha = fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join(file!()))
            .ok()
            .map(|bytes| sha256_hex(&bytes));
        let runs_summary: Vec<serde_json::Value> = [&a1, &a2, &b, &c, &a3, &d]
            .iter()
            .map(|record| {
                serde_json::json!({
                    "run_id": record["run_id"],
                    "rom_sha256": record["rom_sha256"],
                    "file_interval_byte": record["file_interval_byte"],
                    "discovery": record["discovery"],
                    "gaps_mode": record["gaps_mode"],
                    "transition_count": record["transition_count"],
                })
            })
            .collect();
        let manifest = serde_json::json!({
            "schema": "rex-sonic-cadence-oracle/v1",
            "expectations_doc": "docs/rex_profiles/sonic_cadence/EXPECTATIONS-ETAPA4.md",
            "base_rom_sha256": base_sha,
            "tampered_rom_sha256": tampered_sha,
            "copy40_sha256": edit40.modified_rom_sha256,
            "copy60_sha256": edit60.modified_rom_sha256,
            "core_sha256": core_sha,
            "test_binary_sha256": binary_sha,
            "harness_source_sha256": harness_sha,
            "route": "neutro ate 900, START segurado nos frames 900-901, neutro depois; nenhuma escrita em estado",
            "pipeline_refusals": ["0x00", "0x80", "0xFE", "0xFF", "recurso nao comprovado", "noop"],
            "runs": runs_summary,
        });
        fs::write(
            oracle_dir.join("manifest.json"),
            serde_json::to_vec_pretty(&manifest).unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn session_ids_cannot_become_paths() {
        assert!(validate_session_id("inspection-123-00000001").is_ok());
        assert!(validate_session_id("../outside").is_err());
        assert!(validate_session_id("inspection/../outside").is_err());
        assert!(validate_session_id(&"a".repeat(161)).is_err());
    }

    #[test]
    fn candidate_ids_are_stable_and_do_not_expose_arbitrary_offsets() {
        let candidate = GraphicCandidate {
            offset: 0x200,
            size: 32,
            kind: KIND_TILE_BLOCK.to_string(),
            status: "candidate".to_string(),
            method: "test".to_string(),
            confidence: 0.5,
            evidence: serde_json::json!({}),
            previews: Vec::new(),
        };
        assert_eq!(candidate_id(0, &candidate), "tile4bpp_block@00000200-0000");
    }
}
