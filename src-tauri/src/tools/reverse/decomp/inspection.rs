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
    pub pixels_sha256: Option<String>,
}

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
    let mut newest: Option<InspectionSession> = None;
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
        let replace = newest.as_ref().is_none_or(|old| {
            session.completed_at_unix.unwrap_or(session.created_at_unix)
                >= old.completed_at_unix.unwrap_or(old.created_at_unix)
        });
        if replace {
            newest = Some(session);
        }
    }
    let session = newest.ok_or_else(|| {
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

    let mut latest = HashMap::<String, InspectionSession>::new();
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
            let replace = latest.get(&session.session_id).is_none_or(|current| {
                session.completed_at_unix.unwrap_or(session.created_at_unix)
                    >= current.completed_at_unix.unwrap_or(current.created_at_unix)
            });
            if replace {
                latest.insert(session.session_id.clone(), session);
            }
        }
    }
    let mut sessions: Vec<_> = latest.into_values().collect();
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
    Ok(InspectionPreview {
        session_id: session_id.to_string(),
        candidate_id: candidate_id_value,
        available: true,
        reason: None,
        artifact: Some(artifact.clone()),
        data_url: Some(format!("data:image/png;base64,{}", BASE64.encode(&bytes))),
        width: Some(image.width()),
        height: Some(image.height()),
        pixels_sha256: Some(sha256_hex(&bytes)),
    })
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

pub fn save(session_id: &str) -> Result<InspectionSession, String> {
    let stored = get_stored_session(session_id)?;
    persist_session(&decomp_work_dir(), &stored.session)?;
    Ok(stored.session)
}

#[cfg(test)]
mod tests {
    use super::*;

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
