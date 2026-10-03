//! Ponte com Ghidra headless (`analyzeHeadless`) para exportar fronteiras de função.
//! Reusa o postscript versionado do spike (`scripts/decomp/GhidraListFunctions.java`).
//! Postura fail-hard: se Ghidra/JDK21 não estiverem presentes, retorna erro com o
//! pedido de autorização — nunca instala nada (mesmo contrato de `ghidra_boundary.sh`).
//!
//! Segurança de execução: o programa é sempre um **literal** (`"analyzeHeadless"`)
//! resolvido no PATH do processo filho; não há concatenação de linha de comando nem
//! shell intermediário. O diretório da instalação autorizada (`RETRODEV_GHIDRA_HOME`
//! ou `/opt/ghidra`) entra apenas no env `PATH` do filho, após validação de arquivo
//! existente e ausência de bytes NUL.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const GHIDRA_PROCESSOR: &str = "68000:BE:32:default";
const ANALYZE_HEADLESS: &str = "analyzeHeadless";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BoundaryMetrics {
    pub ground_truth_count: usize,
    pub ghidra_count: usize,
    pub matched: usize,
    pub precision: f64,
    pub recall: f64,
}

fn safe_path(path: &Path, label: &str) -> Result<PathBuf, String> {
    if path.as_os_str().to_string_lossy().contains('\0') {
        return Err(format!("{label} contem byte NUL no caminho"));
    }
    if !path.is_file() {
        return Err(format!("{label} nao e um arquivo: {}", path.display()));
    }
    Ok(path.to_path_buf())
}

/// Diretório `support` de uma instalação Ghidra autorizada no host.
pub fn resolve_ghidra_support_dir() -> Result<PathBuf, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(home) = std::env::var("RETRODEV_GHIDRA_HOME") {
        let trimmed = home.trim();
        if !trimmed.is_empty() {
            candidates.push(PathBuf::from(trimmed).join("support"));
        }
    }
    candidates.push(PathBuf::from("/opt/ghidra/support"));
    for candidate in candidates {
        let analyze = candidate.join(ANALYZE_HEADLESS);
        if analyze.is_file() {
            safe_path(&analyze, "analyzeHeadless")?;
            return Ok(candidate);
        }
    }
    Err(
        "Ghidra headless indisponivel (Fase 5 BLOCKED): defina RETRODEV_GHIDRA_HOME para uma \
         instalacao autorizada (Ghidra >= 12 com JDK 21) e rode novamente — nada e instalado \
         automaticamente."
            .to_string(),
    )
}

/// Postscript Java versionado do spike (`scripts/decomp/GhidraListFunctions.java`).
pub fn list_functions_postscript() -> Result<PathBuf, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let script = manifest_dir
        .parent()
        .ok_or("CARGO_MANIFEST_DIR sem pai")?
        .join("scripts")
        .join("decomp")
        .join("GhidraListFunctions.java");
    safe_path(&script, "postscript GhidraListFunctions.java")
}

/// Roda o Ghidra headless sobre um ELF (nao-stripado preferivelmente) e devolve os
/// endereços de entry points de função inferidos pelo analisador.
pub fn export_function_starts(elf_path: &Path, work_dir: &Path) -> Result<Vec<u32>, String> {
    let support_dir = resolve_ghidra_support_dir()?;
    let postscript = list_functions_postscript()?;
    let elf = safe_path(elf_path, "ELF de entrada")?;
    let project_dir = work_dir.join("ghidra-proj");
    fs::create_dir_all(&project_dir)
        .map_err(|error| format!("falha ao criar project dir Ghidra: {error}"))?;
    let project_name = format!("b{}", now_nanos());

    let child_path = match std::env::var("PATH") {
        Ok(existing) => format!("{}:{existing}", support_dir.display()),
        Err(_) => support_dir.display().to_string(),
    };

    // Programa literal + lista de argumentos (sem shell). O PATH do filho inclui o
    // diretório validado da instalação autorizada de Ghidra.
    let output = std::process::Command::new(ANALYZE_HEADLESS)
        .env("PATH", child_path)
        .arg(&project_dir)
        .arg(&project_name)
        .arg("-import")
        .arg(elf)
        .arg("-processor")
        .arg(GHIDRA_PROCESSOR)
        .arg("-scriptPath")
        .arg(postscript.parent().ok_or("postscript sem pai")?)
        .arg("-postScript")
        .arg(postscript.file_name().ok_or("postscript sem nome")?)
        .arg("-deleteProject")
        .output()
        .map_err(|error| format!("falha ao invocar analyzeHeadless: {error}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    fs::write(work_dir.join("ghidra-stdout.log"), &output.stdout)
        .map_err(|e| format!("salvar stdout Ghidra: {e}"))?;
    fs::write(work_dir.join("ghidra-stderr.log"), &output.stderr)
        .map_err(|e| format!("salvar stderr Ghidra: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "analyzeHeadless terminou com status {}: {}",
            output.status,
            stderr.lines().take(12).collect::<Vec<_>>().join(" | ")
        ));
    }
    parse_ghidra_funcs(&stdout)
        .ok_or_else(|| "GHIDRA_FUNCS ausente ou invalido no stdout do analyzeHeadless".to_string())
}

fn parse_ghidra_funcs(stdout: &str) -> Option<Vec<u32>> {
    for line in stdout.lines() {
        // Ghidra prefixa a linha com logger: "INFO  GhidraListFunctions.java> GHIDRA_FUNCS=..."
        let payload = match line.split_once("GHIDRA_FUNCS=") {
            Some((_, tail)) => tail,
            None => continue,
        };
        // Ghidra 12 console appends its logger name to the last address.
        // Strip only that known suffix; malformed addresses still fail closed.
        let payload = payload
            .trim()
            .strip_suffix("(GhidraScript)")
            .unwrap_or(payload.trim())
            .trim_end();
        let addrs = payload
            .split(',')
            .filter(|token| !token.trim().is_empty())
            .map(|token| {
                let trimmed = token.trim();
                let hex = trimmed.trim_start_matches("0x").trim_start_matches("0X");
                u32::from_str_radix(hex, 16).ok()
            })
            .collect::<Option<Vec<_>>>()?;
        return Some(addrs);
    }
    None
}

/// Precision/recall de fronteiras: um entry point do Ghidra "acerta" quando existe
/// função com mesmo endereço no ground truth da symbol table.
pub fn boundary_metrics(ground_truth: &[u32], ghidra: &[u32]) -> BoundaryMetrics {
    let mut truth: Vec<u32> = ground_truth.to_vec();
    truth.sort_unstable();
    truth.dedup();
    let mut inferred = ghidra.to_vec();
    inferred.sort_unstable();
    inferred.dedup();
    let mut matched = 0usize;
    for addr in &inferred {
        if truth.binary_search(addr).is_ok() {
            matched += 1;
        }
    }
    let precision = match inferred.len() {
        0 => 0.0,
        count => matched as f64 / count as f64,
    };
    let recall = match truth.len() {
        0 => 0.0,
        count => matched as f64 / count as f64,
    };
    BoundaryMetrics {
        ground_truth_count: truth.len(),
        ghidra_count: inferred.len(),
        matched,
        precision,
        recall,
    }
}

fn now_nanos() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ghidra_funcs_line() {
        let stdout = "INFO  REPORT\nGHIDRA_FUNCS=0x200,0x4f60,0xa204\nGHIDRA_FUNC_COUNT=3\n";
        assert_eq!(
            parse_ghidra_funcs(stdout),
            Some(vec![0x200, 0x4F60, 0xA204])
        );
        assert_eq!(parse_ghidra_funcs("sem linha"), None);
        assert_eq!(
            parse_ghidra_funcs("INFO script> GHIDRA_FUNCS=0x200,0x300 (GhidraScript)  "),
            Some(vec![0x200, 0x300])
        );
    }

    #[test]
    fn boundary_metrics_precision_and_recall() {
        let metrics = boundary_metrics(&[0x200, 0x300, 0x400], &[0x200, 0x350, 0x400, 0x900]);
        assert_eq!(metrics.ground_truth_count, 3);
        assert_eq!(metrics.ghidra_count, 4);
        assert_eq!(metrics.matched, 2);
        assert!((metrics.precision - 0.5).abs() < 1e-9);
        assert!((metrics.recall - 2.0 / 3.0).abs() < 1e-9);
    }

    #[test]
    fn boundary_metrics_empty_inputs_are_zero() {
        let metrics = boundary_metrics(&[], &[]);
        assert_eq!(metrics.matched, 0);
        assert_eq!(metrics.precision, 0.0);
        assert_eq!(metrics.recall, 0.0);
    }

    #[test]
    fn malformed_addresses_fail_and_duplicates_do_not_inflate_recall() {
        assert_eq!(parse_ghidra_funcs("GHIDRA_FUNCS=0x200,garbage"), None);
        let metrics = boundary_metrics(&[0x200, 0x200], &[0x200, 0x200]);
        assert_eq!(metrics.ghidra_count, 1);
        assert_eq!(metrics.matched, 1);
        assert_eq!(metrics.recall, 1.0);
    }

    #[test]
    fn safe_path_rejects_missing_and_nul() {
        assert!(safe_path(Path::new("/rds-test-inexistente"), "arq").is_err());
        assert!(safe_path(Path::new("/tmp\0evil"), "arq").is_err());
    }
}
