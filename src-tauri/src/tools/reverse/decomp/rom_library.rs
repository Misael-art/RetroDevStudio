//! Biblioteca BYOR de pares (ROM, símbolos, fonte) + ledger de execuções
//! (`DecompLedger`) persistido em `RDS_DECOMP_WORK` (default `~/.retrodev/decomp_work`).
//! Nenhuma ROM entra no repo — apenas hashes, metadados e derivados.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const DECOMP_LEDGER_SCHEMA: &str = "decomp-ledger/v1";
/// Programa REX: v2 estende o ledger com corpus, capacidades e execuções de
/// cenário. v1 continua legível; a gravação normaliza para v2 (migração por
/// defaults, sem descartar histórico).
pub const DECOMP_LEDGER_SCHEMA_V2: &str = "decomp-ledger/v2";

/// Papéis de corpus suportados no ledger v2. `byor_commercial` nunca exporta
/// exemplos nem sai do host.
pub const CORPUS_ROLE_REFERENCE: &str = "reference";
pub const CORPUS_ROLE_CANDIDATE: &str = "candidate";
pub const CORPUS_ROLE_PREVIEW: &str = "preview";
pub const CORPUS_ROLE_CALIBRATION: &str = "calibration";
pub const CORPUS_ROLE_HOLDOUT: &str = "holdout";
pub const CORPUS_ROLE_BYOR_COMMERCIAL: &str = "byor_commercial";

/// Estados de capacidade do Programa REX (REX 3 do plano). `verified_for_profile`
/// só com evidência registrada; nenhum selo genérico de "ROM suportada".
pub const CAP_STATUS_UNSUPPORTED: &str = "unsupported";
pub const CAP_STATUS_EXPERIMENTAL: &str = "experimental";
pub const CAP_STATUS_VERIFIED: &str = "verified_for_profile";

/// Verdicts de execução de cenário. Runs são append-only: um novo run aponta ao
/// anterior por `previous_run_id`, nunca o substitui.
pub const SCENARIO_VERDICT_PASSED: &str = "passed";
pub const SCENARIO_VERDICT_REJECTED: &str = "rejected";
pub const SCENARIO_VERDICT_INDETERMINATE: &str = "indeterminate";
pub const SCENARIO_VERDICT_BLOCKED: &str = "blocked";
pub const SCENARIO_VERDICT_SKIPPED: &str = "skipped";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DecompPairEntry {
    pub id: String,
    pub tier: String,
    pub rom_path: String,
    pub rom_sha256: String,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub symbols_path: Option<String>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub elf_path: Option<String>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_root: Option<String>,
    pub registered_at_unix: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DecompRunRecord {
    pub run_id: String,
    pub pair_id: String,
    pub kind: String,
    pub started_at_unix: u64,
    pub finished_at_unix: u64,
    pub ok: bool,
    pub metrics: serde_json::Value,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub report_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DecompLedger {
    pub schema_version: String,
    pub entries: Vec<DecompPairEntry>,
    pub runs: Vec<DecompRunRecord>,
    /// Corpus registrado com identidade por conteúdo (`sha256:<hex>`); renomear
    /// arquivo não muda a identidade.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub corpus: Vec<CorpusEntry>,
    /// Matriz de capacidades por perfil, com lacunas e evidência; estados
    /// `unknown`/gaps são preservados como estão.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub capabilities: Vec<CapabilityRecord>,
    /// Execuções de cenário (positivas e negativas) com oráculos e artefatos;
    /// append-only.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub scenario_runs: Vec<ScenarioRunRecord>,
}

/// Referência durável a um artefato de evidência (relatório, captura, script).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ArtifactRef {
    pub label: String,
    pub path: String,
    pub sha256: String,
}

/// Entrada de corpus com identidade por conteúdo. `source_path` é apenas
/// proveniência de leitura — nunca copiado para o repo.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CorpusEntry {
    pub id: String,
    pub sha256: String,
    pub size_bytes: u64,
    pub role: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_path: Option<String>,
    #[serde(default)]
    pub provenance: String,
    pub registered_at_unix: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

/// Capacidade de um perfil no eixo REX 3: `identify`, `inspect_code`, `extract`,
/// `edit_asset`, `edit_logic`, `rebuild`, `emulate`, `export_patch`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CapabilityRecord {
    pub profile: String,
    pub capability: String,
    pub status: String,
    #[serde(default)]
    pub gaps: Vec<String>,
    #[serde(default)]
    pub evidence_run_ids: Vec<String>,
    pub updated_at_unix: u64,
    #[serde(default)]
    pub note: String,
}

/// Execução de um cenário delimitado: referência, candidato, input, core,
/// veredito por oráculo e artefatos. Append-only no ledger.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ScenarioRunRecord {
    pub run_id: String,
    pub scenario_id: String,
    pub kind: String,
    pub reference_sha256: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub candidate_sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_script_sha256: Option<String>,
    #[serde(default)]
    pub core_label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub core_sha256: Option<String>,
    #[serde(default)]
    pub frames: u32,
    pub verdict: String,
    #[serde(default)]
    pub oracle_results: serde_json::Value,
    #[serde(default)]
    pub gaps: Vec<String>,
    #[serde(default)]
    pub artifacts: Vec<ArtifactRef>,
    pub executed_at_unix: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_run_id: Option<String>,
    #[serde(default)]
    pub notes: String,
}

impl Default for DecompLedger {
    fn default() -> Self {
        Self {
            schema_version: DECOMP_LEDGER_SCHEMA_V2.to_string(),
            entries: Vec::new(),
            runs: Vec::new(),
            corpus: Vec::new(),
            capabilities: Vec::new(),
            scenario_runs: Vec::new(),
        }
    }
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    crate::core::rom_mastering::sha256_hex(bytes)
}

/// Diretório de trabalho BYOR: `RDS_DECOMP_WORK` ou `~/.retrodev/decomp_work`.
pub fn decomp_work_dir() -> PathBuf {
    if let Ok(work) = std::env::var("RDS_DECOMP_WORK") {
        let trimmed = work.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".retrodev").join("decomp_work")
}

pub fn ledger_path(work_dir: &Path) -> PathBuf {
    work_dir.join("ledger.json")
}

pub fn load_ledger(work_dir: &Path) -> Result<DecompLedger, String> {
    let path = ledger_path(work_dir);
    let content = match fs::read_to_string(&path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(DecompLedger::default())
        }
        Err(error) => return Err(format!("falha ao ler ledger '{}': {error}", path.display())),
    };
    let ledger: DecompLedger = serde_json::from_str(&content).map_err(|error| {
        format!(
            "ledger invalido '{}': {error}; arquivo preservado",
            path.display()
        )
    })?;
    match ledger.schema_version.as_str() {
        // v1 migra em memoria por defaults dos campos novos; v2 e o formato atual.
        DECOMP_LEDGER_SCHEMA | DECOMP_LEDGER_SCHEMA_V2 => Ok(migrate_to_v2(ledger)),
        other => Err(format!(
            "schema de ledger nao suportado: {other}; arquivo preservado",
        )),
    }
}

/// Normaliza um ledger carregado para o formato v2. Campos novos de um ledger
/// v1 entram vazios; histórico (`entries`/`runs`) é preservado byte a byte.
fn migrate_to_v2(mut ledger: DecompLedger) -> DecompLedger {
    ledger.schema_version = DECOMP_LEDGER_SCHEMA_V2.to_string();
    ledger
}

// A separate lock survives atomic replacement of ledger.json. Dropping File
// releases the OS lock, including on error; no stale lock deletion is needed.
fn lock_ledger(work_dir: &Path) -> Result<fs::File, String> {
    fs::create_dir_all(work_dir).map_err(|e| format!("criar work dir: {e}"))?;
    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(work_dir.join("ledger.lock"))
        .map_err(|e| format!("abrir lock: {e}"))?;
    file.lock().map_err(|e| format!("bloquear ledger: {e}"))?;
    Ok(file)
}

fn save_ledger(work_dir: &Path, ledger: &DecompLedger) -> Result<(), String> {
    let mut normalized = ledger.clone();
    normalized.schema_version = DECOMP_LEDGER_SCHEMA_V2.to_string();
    let content = serde_json::to_string_pretty(&normalized)
        .map_err(|error| format!("falha ao serializar ledger: {error}"))?;
    let temporary = work_dir.join(format!("ledger-{}.tmp", std::process::id()));
    let result = (|| -> Result<(), String> {
        let mut file =
            fs::File::create(&temporary).map_err(|e| format!("criar ledger temporario: {e}"))?;
        file.write_all(format!("{content}\n").as_bytes())
            .map_err(|e| format!("gravar ledger: {e}"))?;
        file.sync_all()
            .map_err(|e| format!("sincronizar ledger: {e}"))?;
        drop(file);
        fs::rename(&temporary, ledger_path(work_dir)).map_err(|e| format!("publicar ledger: {e}"))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

/// Slug do par a partir do caminho da ROM: usa o nome do diretório do projeto,
/// pulando diretórios de artefato (`out/`, `build/`, `bin/`).
pub fn slug_from_rom_path(rom_path: &Path) -> String {
    let mut current = rom_path.parent();
    while let Some(dir) = current {
        let name = dir
            .file_name()
            .map(|name| name.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default();
        if matches!(name.as_str(), "out" | "build" | "bin" | "src") {
            current = dir.parent();
        } else {
            break;
        }
    }
    let raw = current
        .and_then(|dir| dir.file_name())
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| {
            rom_path
                .file_stem()
                .map(|stem| stem.to_string_lossy().to_string())
                .unwrap_or_else(|| "pair".to_string())
        });
    let mut slug = String::new();
    for character in raw.chars() {
        if character.is_ascii_alphanumeric() {
            slug.push(character.to_ascii_lowercase());
        } else if !slug.ends_with('_') && !slug.is_empty() {
            slug.push('_');
        }
    }
    let trimmed = slug.trim_matches('_').to_string();
    if trimmed.is_empty() {
        "pair".to_string()
    } else {
        trimmed
    }
}

/// Registra (ou atualiza) um par BYOR no ledger, calculando o SHA-256 da ROM.
pub fn register_pair(
    work_dir: &Path,
    rom_path: &Path,
    tier: &str,
    symbols_path: Option<&Path>,
    elf_path: Option<&Path>,
    source_root: Option<&Path>,
) -> Result<DecompPairEntry, String> {
    let rom_bytes = fs::read(rom_path)
        .map_err(|error| format!("falha ao ler ROM '{}': {error}", rom_path.display()))?;
    let canonical = fs::canonicalize(rom_path).map_err(|e| format!("resolver ROM: {e}"))?;
    let rom_sha256 = sha256_hex(&rom_bytes);
    let identity = sha256_hex(format!("{}\n{}", canonical.display(), rom_sha256).as_bytes());
    let entry = DecompPairEntry {
        id: format!("{}-{identity}", slug_from_rom_path(rom_path)),
        tier: tier.to_string(),
        rom_path: rom_path.to_string_lossy().to_string(),
        rom_sha256,
        symbols_path: symbols_path.map(|path| path.to_string_lossy().to_string()),
        elf_path: elf_path.map(|path| path.to_string_lossy().to_string()),
        source_root: source_root.map(|path| path.to_string_lossy().to_string()),
        registered_at_unix: now_unix(),
    };

    let _lock = lock_ledger(work_dir)?;
    let mut ledger = load_ledger(work_dir)?;
    ledger.entries.retain(|existing| existing.id != entry.id);
    ledger.entries.push(entry.clone());
    save_ledger(work_dir, &ledger)?;
    Ok(entry)
}

pub fn record_run(work_dir: &Path, record: DecompRunRecord) -> Result<(), String> {
    let _lock = lock_ledger(work_dir)?;
    let mut ledger = load_ledger(work_dir)?;
    ledger.runs.push(record);
    save_ledger(work_dir, &ledger)
}

/// Identidade de corpus por conteúdo: renomear/mover o arquivo não muda o id.
pub fn corpus_identity(sha256: &str) -> String {
    format!("sha256:{sha256}")
}

/// Registra (ou atualiza) uma entrada de corpus por identidade de conteúdo.
/// A ROM em si nunca entra no repo; guarda-se hash, tamanho e proveniência.
pub fn register_corpus_entry(work_dir: &Path, entry: CorpusEntry) -> Result<CorpusEntry, String> {
    if entry.id != corpus_identity(&entry.sha256) {
        return Err(format!(
            "id de corpus '{}' nao corresponde a identidade por conteudo '{}'",
            entry.id,
            corpus_identity(&entry.sha256)
        ));
    }
    let _lock = lock_ledger(work_dir)?;
    let mut ledger = load_ledger(work_dir)?;
    ledger.corpus.retain(|existing| existing.id != entry.id);
    ledger.corpus.push(entry.clone());
    save_ledger(work_dir, &ledger)?;
    Ok(entry)
}

/// Insere registros de capacidade ausentes; registros existentes NÃO são
/// rebaixados nem sobrescritos por esta funcao — atualizacao de status exige
/// evidencia nova via `record_capability`.
pub fn ensure_capability_records(
    work_dir: &Path,
    records: Vec<CapabilityRecord>,
) -> Result<usize, String> {
    let _lock = lock_ledger(work_dir)?;
    let mut ledger = load_ledger(work_dir)?;
    let mut inserted = 0;
    for record in records {
        let exists = ledger.capabilities.iter().any(|existing| {
            existing.profile == record.profile && existing.capability == record.capability
        });
        if !exists {
            ledger.capabilities.push(record);
            inserted += 1;
        }
    }
    if inserted > 0 {
        save_ledger(work_dir, &ledger)?;
    }
    Ok(inserted)
}

/// Atualiza (upsert por perfil+capacidade) um registro de capacidade com
/// evidência nova. Chamado apenas quando existe execução que sustenta o estado.
pub fn record_capability(work_dir: &Path, record: CapabilityRecord) -> Result<(), String> {
    let _lock = lock_ledger(work_dir)?;
    let mut ledger = load_ledger(work_dir)?;
    ledger.capabilities.retain(|existing| {
        !(existing.profile == record.profile && existing.capability == record.capability)
    });
    ledger.capabilities.push(record);
    save_ledger(work_dir, &ledger)
}

/// Append-only: cada execução nova é acrescentada e aponta à anterior por
/// `previous_run_id`. Nenhum run existente é sobrescrito.
pub fn record_scenario_run(
    work_dir: &Path,
    mut record: ScenarioRunRecord,
) -> Result<String, String> {
    let _lock = lock_ledger(work_dir)?;
    let mut ledger = load_ledger(work_dir)?;
    record.previous_run_id = ledger
        .scenario_runs
        .iter()
        .filter(|existing| existing.scenario_id == record.scenario_id)
        .map(|existing| existing.run_id.clone())
        .next_back();
    ledger.scenario_runs.push(record.clone());
    save_ledger(work_dir, &ledger)?;
    Ok(record.run_id)
}

pub fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_work(label: &str) -> PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let dir =
            std::env::temp_dir().join(format!("rds-decomp-{label}-{}-{nonce}", std::process::id()));
        fs::create_dir_all(&dir).expect("create temp work dir");
        dir
    }

    #[test]
    fn corrupt_ledger_is_not_overwritten_and_changed_rom_keeps_history() {
        let work = temp_work("preservation");
        let rom = work.join("rom.bin");
        fs::write(&rom, b"first").unwrap();
        fs::write(ledger_path(&work), b"{broken").unwrap();
        assert!(register_pair(&work, &rom, "tier0_pair", None, None, None).is_err());
        assert_eq!(fs::read(ledger_path(&work)).unwrap(), b"{broken");
        fs::remove_file(ledger_path(&work)).unwrap();
        let first = register_pair(&work, &rom, "tier0_pair", None, None, None).unwrap();
        fs::write(&rom, b"second").unwrap();
        let second = register_pair(&work, &rom, "tier0_pair", None, None, None).unwrap();
        assert_ne!(first.id, second.id);
        assert_eq!(load_ledger(&work).unwrap().entries.len(), 2);
        fs::remove_dir_all(work).unwrap();
    }

    #[test]
    fn concurrent_registrations_preserve_all_entries() {
        let work = temp_work("concurrent");
        let workers: Vec<_> = (0..8)
            .map(|i| {
                let work = work.clone();
                std::thread::spawn(move || {
                    let rom = work.join(format!("rom-{i}.bin"));
                    fs::write(&rom, [i as u8]).unwrap();
                    register_pair(&work, &rom, "tier0_pair", None, None, None).unwrap();
                })
            })
            .collect();
        for worker in workers {
            worker.join().unwrap();
        }
        assert_eq!(load_ledger(&work).unwrap().entries.len(), 8);
        fs::remove_dir_all(work).unwrap();
    }

    #[test]
    fn sha256_matches_known_vector() {
        // FIPS 180-2: SHA-256("abc")
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn ledger_round_trip_and_pair_registration() {
        let work = temp_work("ledger");
        // layout real de doador SGDK: <projeto>/out/rom.bin
        let project = work.join("SMOKE_TEST [VER.001] [LAB]");
        let out_dir = project.join("out");
        fs::create_dir_all(&out_dir).expect("create project out");
        let rom = out_dir.join("rom.bin");
        fs::write(&rom, b"SEGA-rom-bytes").expect("write rom");
        let symbols = project.join("symbol.txt");
        fs::write(&symbols, "00000200 t _Entry_Point\n").expect("write symbols");

        let entry = register_pair(
            &work,
            &rom,
            crate::tools::reverse::decomp::triage::TIER_T0_PAIR,
            Some(&symbols),
            None,
            None,
        )
        .expect("register pair");
        assert!(entry.id.starts_with("smoke_test_ver_001_lab-"));
        assert_eq!(
            entry.symbols_path.as_deref(),
            Some(symbols.to_str().expect("utf8 temp path"))
        );

        let loaded = load_ledger(&work).expect("load ledger");
        assert_eq!(loaded.schema_version, DECOMP_LEDGER_SCHEMA_V2);
        assert_eq!(loaded.entries.len(), 1);
        assert_eq!(loaded.entries[0].rom_sha256, sha256_hex(b"SEGA-rom-bytes"));
        assert_eq!(
            loaded.entries[0].tier,
            crate::tools::reverse::decomp::triage::TIER_T0_PAIR
        );

        record_run(
            &work,
            DecompRunRecord {
                run_id: "run-1".to_string(),
                pair_id: entry.id.clone(),
                kind: "triage".to_string(),
                started_at_unix: 0,
                finished_at_unix: 1,
                ok: true,
                metrics: serde_json::json!({ "functions": 1 }),
                report_path: None,
            },
        )
        .expect("record run");
        let reloaded = load_ledger(&work).expect("load ledger");
        assert_eq!(reloaded.runs.len(), 1);
        assert_eq!(reloaded.runs[0].pair_id, entry.id);

        // Re-registrar o mesmo par atualiza em vez de duplicar.
        register_pair(
            &work,
            &rom,
            crate::tools::reverse::decomp::triage::TIER_T0_PAIR,
            Some(&symbols),
            None,
            None,
        )
        .expect("again");
        assert_eq!(load_ledger(&work).expect("load ledger").entries.len(), 1);

        let _ = fs::remove_dir_all(&work);
    }

    #[test]
    fn v1_ledger_migrates_to_v2_preserving_history() {
        let work = temp_work("v1-migration");
        let v1 = serde_json::json!({
            "schema_version": "decomp-ledger/v1",
            "entries": [{
                "id": "smoke-abc",
                "tier": "tier0_pair",
                "rom_path": "/tmp/rom.bin",
                "rom_sha256": "aa",
                "registered_at_unix": 42
            }],
            "runs": [{
                "run_id": "run-legacy",
                "pair_id": "smoke-abc",
                "kind": "triage",
                "started_at_unix": 42,
                "finished_at_unix": 43,
                "ok": true,
                "metrics": {}
            }]
        });
        fs::write(ledger_path(&work), format!("{v1}\n")).expect("write v1 fixture");

        let loaded = load_ledger(&work).expect("v1 deve ser legivel");
        assert_eq!(loaded.entries.len(), 1);
        assert_eq!(loaded.runs.len(), 1);
        assert!(loaded.corpus.is_empty());
        assert!(loaded.capabilities.is_empty());
        assert!(loaded.scenario_runs.is_empty());

        // Gravar após a migração persista v2 sem perder o histórico v1.
        record_scenario_run(
            &work,
            ScenarioRunRecord {
                run_id: "run-2".to_string(),
                scenario_id: "s1".to_string(),
                kind: "equivalence".to_string(),
                reference_sha256: "aa".to_string(),
                candidate_sha256: None,
                input_script_sha256: None,
                core_label: "core".to_string(),
                core_sha256: None,
                frames: 10,
                verdict: SCENARIO_VERDICT_PASSED.to_string(),
                oracle_results: serde_json::json!({}),
                gaps: Vec::new(),
                artifacts: Vec::new(),
                executed_at_unix: 44,
                previous_run_id: None,
                notes: String::new(),
            },
        )
        .expect("record scenario run");
        let reloaded = load_ledger(&work).expect("reload");
        assert_eq!(reloaded.schema_version, DECOMP_LEDGER_SCHEMA_V2);
        assert_eq!(reloaded.entries.len(), 1, "histórico v1 preservado");
        assert_eq!(reloaded.runs.len(), 1, "histórico v1 preservado");
        assert_eq!(reloaded.scenario_runs.len(), 1);
        assert_eq!(reloaded.scenario_runs[0].run_id, "run-2");

        fs::remove_dir_all(work).unwrap();
    }

    #[test]
    fn unknown_ledger_schema_is_rejected_and_file_preserved() {
        let work = temp_work("unknown-schema");
        fs::write(
            ledger_path(&work),
            "{\"schema_version\":\"decomp-ledger/v99\",\"entries\":[],\"runs\":[]}\n",
        )
        .expect("write fixture");
        assert!(load_ledger(&work).is_err());
        assert!(ledger_path(&work).is_file(), "arquivo deve ser preservado");
        fs::remove_dir_all(work).unwrap();
    }

    #[test]
    fn corpus_identity_is_content_based_across_renames() {
        let work = temp_work("corpus-identity");
        let sha = sha256_hex(b"same-bytes");
        let first = CorpusEntry {
            id: corpus_identity(&sha),
            sha256: sha.clone(),
            size_bytes: 10,
            role: CORPUS_ROLE_REFERENCE.to_string(),
            label: "original-name".to_string(),
            source_path: Some("/old/path/rom.bin".to_string()),
            provenance: "test".to_string(),
            registered_at_unix: 1,
            notes: None,
        };
        register_corpus_entry(&work, first).expect("register first");
        // Mesmo conteúdo, caminho/label diferentes: mesma identidade, sem duplicar.
        let renamed = CorpusEntry {
            id: corpus_identity(&sha),
            sha256: sha.clone(),
            size_bytes: 10,
            role: CORPUS_ROLE_REFERENCE.to_string(),
            label: "renamed".to_string(),
            source_path: Some("/new/path/other.bin".to_string()),
            provenance: "test".to_string(),
            registered_at_unix: 2,
            notes: None,
        };
        register_corpus_entry(&work, renamed).expect("register renamed");
        let ledger = load_ledger(&work).expect("load");
        assert_eq!(ledger.corpus.len(), 1, "identidade por conteúdo deduplica");
        assert_eq!(ledger.corpus[0].label, "renamed");

        // id inconsistente com o conteúdo é rejeitado.
        let bad = CorpusEntry {
            id: "sha256:deadbeef".to_string(),
            sha256: sha,
            size_bytes: 10,
            role: CORPUS_ROLE_REFERENCE.to_string(),
            label: "bad".to_string(),
            source_path: None,
            provenance: "test".to_string(),
            registered_at_unix: 3,
            notes: None,
        };
        assert!(register_corpus_entry(&work, bad).is_err());
        fs::remove_dir_all(work).unwrap();
    }

    #[test]
    fn capability_ensure_never_downgrades_existing_records() {
        let work = temp_work("capability");
        let base = CapabilityRecord {
            profile: "megadrive/cart".to_string(),
            capability: "extract".to_string(),
            status: CAP_STATUS_UNSUPPORTED.to_string(),
            gaps: vec!["nenhum extrator".to_string()],
            evidence_run_ids: Vec::new(),
            updated_at_unix: 1,
            note: String::new(),
        };
        let inserted = ensure_capability_records(&work, vec![base.clone()]).expect("ensure");
        assert_eq!(inserted, 1);

        // Evidência nova promove o status explicitamente.
        let mut promoted = base.clone();
        promoted.status = CAP_STATUS_EXPERIMENTAL.to_string();
        promoted.updated_at_unix = 2;
        record_capability(&work, promoted).expect("promote");
        // ensure repetido NÃO rebaixa o registro promovido.
        let inserted_again =
            ensure_capability_records(&work, vec![base.clone()]).expect("ensure again");
        assert_eq!(inserted_again, 0);
        let ledger = load_ledger(&work).expect("load");
        assert_eq!(ledger.capabilities.len(), 1);
        assert_eq!(ledger.capabilities[0].status, CAP_STATUS_EXPERIMENTAL);
        fs::remove_dir_all(work).unwrap();
    }

    #[test]
    fn scenario_runs_are_append_only_with_previous_link() {
        let work = temp_work("scenario-append");
        let make = |run_id: &str| ScenarioRunRecord {
            run_id: run_id.to_string(),
            scenario_id: "same-scenario".to_string(),
            kind: "equivalence".to_string(),
            reference_sha256: "aa".to_string(),
            candidate_sha256: Some("bb".to_string()),
            input_script_sha256: None,
            core_label: "core".to_string(),
            core_sha256: None,
            frames: 5,
            verdict: SCENARIO_VERDICT_REJECTED.to_string(),
            oracle_results: serde_json::json!({ "behavior": "fail" }),
            gaps: vec!["exemplo".to_string()],
            artifacts: Vec::new(),
            executed_at_unix: 7,
            previous_run_id: None,
            notes: String::new(),
        };
        let first_id = record_scenario_run(&work, make("run-a")).expect("record first");
        let second_id = record_scenario_run(&work, make("run-b")).expect("record second");
        let ledger = load_ledger(&work).expect("load");
        assert_eq!(ledger.scenario_runs.len(), 2, "runs nunca são sobrescritos");
        assert_eq!(ledger.scenario_runs[0].run_id, first_id);
        assert_eq!(ledger.scenario_runs[1].run_id, second_id);
        assert_eq!(
            ledger.scenario_runs[1].previous_run_id.as_deref(),
            Some(first_id.as_str()),
            "run novo aponta ao anterior"
        );
        fs::remove_dir_all(work).unwrap();
    }
}
