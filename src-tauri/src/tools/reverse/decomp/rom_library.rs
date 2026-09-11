//! Biblioteca BYOR de pares (ROM, símbolos, fonte) + ledger de execuções
//! (`DecompLedger`) persistido em `RDS_DECOMP_WORK` (default `~/.retrodev/decomp_work`).
//! Nenhuma ROM entra no repo — apenas hashes, metadados e derivados.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const DECOMP_LEDGER_SCHEMA: &str = "decomp-ledger/v1";

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
}

impl Default for DecompLedger {
    fn default() -> Self {
        Self {
            schema_version: DECOMP_LEDGER_SCHEMA.to_string(),
            entries: Vec::new(),
            runs: Vec::new(),
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
    if ledger.schema_version != DECOMP_LEDGER_SCHEMA {
        return Err(format!(
            "schema de ledger nao suportado: {}; arquivo preservado",
            ledger.schema_version
        ));
    }
    Ok(ledger)
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
    let content = serde_json::to_string_pretty(ledger)
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
        assert_eq!(loaded.schema_version, DECOMP_LEDGER_SCHEMA);
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
}
