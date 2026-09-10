//! Orquestrador da Etapa A (Tier 0) do currículo `docs/12`: para cada par
//! (fonte, ROM) conhecido — triagem, boundary Ghidra (ground truth da symbol table),
//! fingerprint das funções, rebuild duplo determinístico com a toolchain oficial do
//! host e `object_diff`. Sem LLM, sem UI. Executado via teste `#[ignore]` host-local.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};

use super::fingerprint::build_fingerprint_index;
use super::ghidra_bridge::{boundary_metrics, export_function_starts, BoundaryMetrics};
use super::object_diff::{diff_objects, ObjectDiffReport};
use super::rom_library::{record_run, register_pair, sha256_hex, DecompRunRecord};
use super::symbols::{function_ranges, function_starts, parse_nm_symbols};
use super::triage::{triage_rom, RomTriageReport, TIER_T0_PAIR};

#[derive(Debug, Clone)]
pub struct EtapaAPairSpec {
    pub rom_path: PathBuf,
    pub symbols_path: Option<PathBuf>,
    pub elf_path: Option<PathBuf>,
    pub source_root: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DeterminismResult {
    pub rom_sha256_build_a: String,
    pub rom_sha256_build_b: String,
    pub rom_identical: bool,
    pub objects_total: usize,
    pub objects_exact: usize,
    pub objects_divergent: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EtapaAPairResult {
    pub pair_id: String,
    pub triage: RomTriageReport,
    pub functions_indexed: usize,
    pub fingerprint_unique_hashes: usize,
    pub boundary: Option<BoundaryMetrics>,
    pub determinism: Option<DeterminismResult>,
    pub provenance_diff: Option<ObjectDiffReport>,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct EtapaAOptions {
    /// Roda Ghidra headless (exige instalação autorizada; ignora se ausente, com nota).
    pub run_ghidra: bool,
    /// Rebuild duplo do doador (cópia em work dir; exige m68k-elf + SGDK no host).
    pub run_rebuild: bool,
}

/// Executa a Etapa A para um par e registra tudo (pair + run) no ledger do work dir.
pub fn run_etapa_a(
    spec: &EtapaAPairSpec,
    work_dir: &Path,
    options: &EtapaAOptions,
) -> Result<EtapaAPairResult, String> {
    let started = super::rom_library::now_unix();
    let mut notes: Vec<String> = Vec::new();

    let triage = triage_rom(&spec.rom_path)?;
    let rom_bytes = fs::read(&spec.rom_path)
        .map_err(|error| format!("falha ao ler ROM '{}': {error}", spec.rom_path.display()))?;

    // Ground truth: symbol.txt estilo nm ou `m68k-elf-nm` sobre o ELF do doador.
    let symbols = if let Some(symbols_path) = &spec.symbols_path {
        let content = fs::read_to_string(symbols_path)
            .map_err(|error| format!("falha ao ler '{}': {error}", symbols_path.display()))?;
        parse_nm_symbols(&content)
    } else if let Some(elf_path) = &spec.elf_path {
        parse_nm_symbols(&run_capture_nm(elf_path)?)
    } else {
        Vec::new()
    };
    if symbols.is_empty() {
        notes.push(
            "par sem symbol table (ground truth ausente); boundary/fingerprint limitados"
                .to_string(),
        );
    }
    let text_end = (rom_bytes.len() as u32).min(0xFF_FFFF);
    let ranges = function_ranges(&symbols, Some(text_end));

    let mut boundary = None;
    if options.run_ghidra {
        if let Some(elf_path) = &spec.elf_path {
            match export_function_starts(elf_path, work_dir) {
                Ok(ghidra_starts) => {
                    boundary = Some(boundary_metrics(&function_starts(&ranges), &ghidra_starts));
                }
                Err(error) => notes.push(format!("boundary Ghidra indisponivel: {error}")),
            }
        } else {
            notes.push("boundary Ghidra pulado: par sem ELF nao-stripado".to_string());
        }
    }

    let index = build_fingerprint_index(&rom_bytes, &ranges);

    let mut determinism = None;
    let mut provenance_diff = None;
    if options.run_rebuild {
        match &spec.source_root {
            Some(source_root) => match run_double_build(source_root, work_dir) {
                Ok(result) => {
                    let build_a = work_dir.join("rebuild-a").join("out");
                    let build_b = work_dir.join("rebuild-b").join("out");
                    provenance_diff =
                        diff_donor_objects(source_root, &[&build_a, &build_b], &mut notes)?;
                    determinism = Some(result);
                }
                Err(error) => notes.push(format!(
                    "rebuild duplo nao reproduzivel com a toolchain do host (boot/SGDK do autor \
                     pode divergir); boundary/fingerprint da ROM original permanecem validos: {error}"
                )),
            },
            None => notes.push("rebuild pulado: par sem source_root".to_string()),
        }
    }

    let pair = register_pair(
        work_dir,
        &spec.rom_path,
        TIER_T0_PAIR,
        spec.symbols_path.as_deref(),
        spec.elf_path.as_deref(),
        spec.source_root.as_deref(),
    )?;

    let result = EtapaAPairResult {
        pair_id: pair.id.clone(),
        triage,
        functions_indexed: index.functions.len(),
        fingerprint_unique_hashes: index.unique_hashes,
        boundary,
        determinism,
        provenance_diff,
        notes,
    };

    record_run(
        work_dir,
        DecompRunRecord {
            run_id: format!("etapa-a-{}", super::rom_library::now_unix()),
            pair_id: pair.id,
            kind: "etapa_a".to_string(),
            started_at_unix: started,
            finished_at_unix: super::rom_library::now_unix(),
            ok: true,
            metrics: serde_json::to_value(&result)
                .map_err(|error| format!("falha ao serializar métricas: {error}"))?,
            report_path: None,
        },
    )?;
    Ok(result)
}

fn run_capture_nm(elf_path: &Path) -> Result<String, String> {
    if !elf_path.is_file() {
        return Err(format!("ELF nao encontrado: {}", elf_path.display()));
    }
    let output = Command::new("m68k-elf-nm")
        .arg("-n")
        .arg(elf_path)
        .output()
        .map_err(|error| format!("falha ao invocar m68k-elf-nm: {error}"))?;
    if !output.status.success() {
        return Err(format!("m68k-elf-nm terminou com status {}", output.status));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn copy_dir_recursive(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination)
        .map_err(|error| format!("mkdir '{}': {error}", destination.display()))?;
    for entry in
        fs::read_dir(source).map_err(|error| format!("read_dir '{}': {error}", source.display()))?
    {
        let entry = entry.map_err(|error| format!("entry '{}': {error}", source.display()))?;
        let entry_path = entry.path();
        let file_name = entry.file_name();
        // Artefatos de build antigos e VCS do doador não entram no rebuild: out/ com
        // .d do build original quebra o makefile.gen (alvos duplicados).
        let name = file_name.to_string_lossy().to_ascii_lowercase();
        if entry_path.is_dir() && matches!(name.as_str(), "out" | ".git" | "build") {
            continue;
        }
        // .d solto em res//src/ é artefato de build do doador (quebra o makefile.gen).
        if !entry_path.is_dir() && name.ends_with(".d") {
            continue;
        }
        let target = destination.join(file_name);
        if entry_path.is_dir() {
            copy_dir_recursive(&entry_path, &target)?;
        } else {
            fs::copy(&entry_path, &target)
                .map_err(|error| format!("copy '{}': {error}", entry_path.display()))?;
        }
    }
    Ok(())
}

fn sgdk_root() -> Result<PathBuf, String> {
    for env_name in ["SGDK_ROOT", "GDK"] {
        if let Ok(root) = std::env::var(env_name) {
            let trimmed = root.trim();
            if !trimmed.is_empty() {
                return Ok(PathBuf::from(trimmed));
            }
        }
    }
    Err(
        "SGDK_ROOT/GDK ausente: rebuild da Etapa A exige a toolchain SGDK oficial no host"
            .to_string(),
    )
}

/// makefile.gen (SGDK 2.x) faz `cp res/<nome>.d out/res/` apos compilar o `.rs`
/// gerado pelo rescomp; o `.d` so existe em builds consecutivos do autor. Em um
/// rebuild limpo criamos um arquivo de deps vazio (inocuo ao `-include`).
fn ensure_res_dep_files(build_dir: &Path) -> Result<(), String> {
    let mut stack = vec![build_dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        for entry in fs::read_dir(&current)
            .map_err(|error| format!("read_dir '{}': {error}", current.display()))?
            .flatten()
        {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().and_then(|value| value.to_str()) == Some("res") {
                let mut stem = path.clone();
                stem.set_extension("d");
                if !stem.exists() {
                    fs::write(&stem, "").map_err(|error| {
                        format!("criar deps vazio '{}': {error}", stem.display())
                    })?;
                }
            }
        }
    }
    Ok(())
}

fn run_sgdk_make(build_dir: &Path) -> Result<(), String> {
    let sgdk = sgdk_root()?;
    let makefile = sgdk.join("makefile.gen");
    if !makefile.is_file() {
        return Err(format!(
            "makefile.gen ausente em '{}': SGDK oficial incompleto",
            sgdk.display()
        ));
    }
    let output = Command::new("make")
        .arg("-f")
        .arg(&makefile)
        .current_dir(build_dir)
        .env("GDK", &sgdk)
        .env("SGDK_ROOT", &sgdk)
        .output()
        .map_err(|error| {
            format!(
                "falha ao invocar make em '{}': {error}",
                build_dir.display()
            )
        })?;
    if !output.status.success() {
        let tail = String::from_utf8_lossy(&output.stderr).to_string();
        let tail = if tail.trim().is_empty() {
            String::from_utf8_lossy(&output.stdout).to_string()
        } else {
            tail
        };
        return Err(format!(
            "make falhou em '{}': {}",
            build_dir.display(),
            tail.lines().take(8).collect::<Vec<_>>().join(" | ")
        ));
    }
    Ok(())
}

/// Rebuild duplo em cópias independentes: prova determinismo da toolchain oficial
/// (ROM idêntica byte-a-byte e objetos exatos entre build A e build B).
fn run_double_build(source_root: &Path, work_dir: &Path) -> Result<DeterminismResult, String> {
    let mut shas = [String::new(), String::new()];
    for (index, slug) in ["rebuild-a", "rebuild-b"].iter().enumerate() {
        let build_dir = work_dir.join(slug);
        if build_dir.exists() {
            fs::remove_dir_all(&build_dir)
                .map_err(|error| format!("limpa '{}': {error}", build_dir.display()))?;
        }
        copy_dir_recursive(source_root, &build_dir)?;
        ensure_res_dep_files(&build_dir)?;
        run_sgdk_make(&build_dir)?;
        let rom = build_dir.join("out").join("rom.bin");
        let rom_bytes = fs::read(&rom)
            .map_err(|error| format!("ROM do rebuild '{}': {error}", rom.display()))?;
        shas[index] = sha256_hex(&rom_bytes);
    }

    let build_a = work_dir.join("rebuild-a").join("out");
    let build_b = work_dir.join("rebuild-b").join("out");
    let (objects_total, objects_exact, objects_divergent) = count_object_pairs(&build_a, &build_b)?;

    Ok(DeterminismResult {
        rom_sha256_build_a: shas[0].clone(),
        rom_sha256_build_b: shas[1].clone(),
        rom_identical: shas[0] == shas[1] && !shas[0].is_empty(),
        objects_total,
        objects_exact,
        objects_divergent,
    })
}

fn count_object_pairs(build_a: &Path, build_b: &Path) -> Result<(usize, usize, usize), String> {
    let mut total = 0usize;
    let mut exact = 0usize;
    let mut divergent = 0usize;
    let entries_a = fs::read_dir(build_a)
        .map_err(|error| format!("read_dir '{}': {error}", build_a.display()))?;
    for entry in entries_a.flatten() {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("o") {
            continue;
        }
        let Some(file_name) = path.file_name() else {
            continue;
        };
        let counterpart = build_b.join(file_name);
        if !counterpart.is_file() {
            divergent += 1;
            total += 1;
            continue;
        }
        let bytes_a =
            fs::read(&path).map_err(|error| format!("read '{}': {error}", path.display()))?;
        let bytes_b = fs::read(&counterpart)
            .map_err(|error| format!("read '{}': {error}", counterpart.display()))?;
        total += 1;
        if bytes_a == bytes_b {
            exact += 1;
        } else {
            divergent += 1;
        }
    }
    Ok((total, exact, divergent))
}

/// Diff de proveniência: objetos `.o` do rebuild vs os `.o` originais do doador
/// (divergência esperada quando a toolchain do host difere da do autor — métrica
/// registrada honestamente, sem claim de MatchExact).
fn diff_donor_objects(
    source_root: &Path,
    rebuild_out_dirs: &[&Path],
    notes: &mut Vec<String>,
) -> Result<Option<ObjectDiffReport>, String> {
    let donor_out = source_root.join("out");
    if !donor_out.is_dir() {
        notes.push("doador sem out/ de objetos originais; provenance diff pulado".to_string());
        return Ok(None);
    }
    let mut diffed: Option<ObjectDiffReport> = None;
    let mut compared = 0usize;
    for entry in fs::read_dir(&donor_out)
        .map_err(|error| format!("read_dir '{}': {error}", donor_out.display()))?
        .flatten()
    {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("o") {
            continue;
        }
        let Some(file_name) = path.file_name() else {
            continue;
        };
        let Some(rebuild_out) = rebuild_out_dirs.first() else {
            continue;
        };
        let counterpart = rebuild_out.join(file_name);
        if !counterpart.is_file() {
            continue;
        }
        compared += 1;
        if diffed.is_none() {
            diffed = Some(diff_objects(&path, &counterpart)?);
        }
    }
    if compared == 0 {
        notes.push(
            "nenhum .o original casou com o rebuild (nomes/layout diferentes); provenance diff pulado"
                .to_string(),
        );
        return Ok(None);
    }
    if compared > 1 {
        notes.push(format!(
            "provenance diff cobriu {compared} objetos; relatório do primeiro"
        ));
    }
    Ok(diffed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::reverse::decomp::rom_library::decomp_work_dir;

    fn temp_work() -> PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("rds-orch-test-{nonce}"));
        fs::create_dir_all(&dir).expect("mkdir temp");
        dir
    }

    #[test]
    fn count_object_pairs_classifies_by_bytes() {
        let work = temp_work();
        let a = work.join("a");
        let b = work.join("b");
        fs::create_dir_all(&a).expect("mkdir a");
        fs::create_dir_all(&b).expect("mkdir b");
        fs::write(a.join("main.o"), b"AAAA").expect("write a");
        fs::write(b.join("main.o"), b"AAAA").expect("write b");
        fs::write(a.join("sprite.o"), b"1111").expect("write a2");
        fs::write(b.join("sprite.o"), b"2222").expect("write b2");

        let (total, exact, divergent) = count_object_pairs(&a, &b).expect("count");
        assert_eq!(total, 2);
        assert_eq!(exact, 1);
        assert_eq!(divergent, 1);
        let _ = fs::remove_dir_all(&work);
    }

    #[test]
    fn double_build_reports_determinism_shape() {
        // Contrato do resultado: campos sempre presentes, mesmo sem execução real.
        let determinism = DeterminismResult {
            rom_sha256_build_a: "aa".to_string(),
            rom_sha256_build_b: "aa".to_string(),
            rom_identical: true,
            objects_total: 3,
            objects_exact: 3,
            objects_divergent: 0,
        };
        let json = serde_json::to_string(&determinism).expect("serialize");
        assert!(json.contains("rom_identical"));
        assert!(json.contains("objects_exact"));
    }

    /// Etapa A (Tier 0) — host-local, `#[ignore]`: roda o pipeline completo nos 3 pares
    /// do corpus SGDKForge (Taiketsu + SMOKE_TEST + BLUE_CIRCUIT), com rebuild duplo e
    /// Ghidra headless. Requer `SGDK_ROOT`, m68k-elf no PATH e `RETRODEV_GHIDRA_HOME`.
    ///
    /// `RDS_DECOMP_ETAPA_A_ROOT` (default `/mnt/sdcard/SGDKForge`)
    /// `cargo test decomp_etapa_a_tier0 --manifest-path src-tauri/Cargo.toml --lib -- --ignored --nocapture --test-threads=1`
    #[test]
    #[ignore = "host-local Tier 0 pairs (BYOR + Ghidra + SGDK rebuild)"]
    fn decomp_etapa_a_tier0_pairs() {
        let corpus_root = std::env::var("RDS_DECOMP_ETAPA_A_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("/mnt/sdcard/SGDKForge"));
        assert!(
            corpus_root.is_dir(),
            "corpus Etapa A ausente: {}",
            corpus_root.display()
        );

        let work_dir = decomp_work_dir();
        fs::create_dir_all(&work_dir).expect("create decomp work dir");

        let mut specs: Vec<EtapaAPairSpec> = Vec::new();
        // 1) TaiketsuUltraHeroGenesis — par completo com symbol.txt + rom.out ELF.
        let taiketsu = corpus_root
            .join("SGDK_Engines")
            .join("TaiketsuUltraHeroGenesis")
            .join("src");
        specs.push(EtapaAPairSpec {
            rom_path: taiketsu.join("out").join("rom.bin"),
            symbols_path: Some(taiketsu.join("out").join("symbol.txt")),
            elf_path: Some(taiketsu.join("out").join("rom.out")),
            source_root: Some(taiketsu),
        });
        // 2-3) Pares pequenos do SGDK_projects (self-compare determinístico).
        for project in [
            "SMOKE_TEST [VER.001] [SGDK 211] [GEN] [LAB]",
            "BLUE_CIRCUIT [VER.001] [SGDK 211] [GEN] [GAME] [ACTION_PLATFORMER]",
        ] {
            let root = corpus_root.join("SGDK_projects").join(project);
            specs.push(EtapaAPairSpec {
                rom_path: root.join("out").join("rom.bin"),
                symbols_path: root
                    .join("out")
                    .join("symbol.txt")
                    .is_file()
                    .then(|| root.join("out").join("symbol.txt")),
                elf_path: root
                    .join("out")
                    .join("rom.out")
                    .is_file()
                    .then(|| root.join("out").join("rom.out")),
                source_root: Some(root),
            });
        }

        let options = EtapaAOptions {
            run_ghidra: true,
            run_rebuild: true,
        };
        let mut results: Vec<EtapaAPairResult> = Vec::new();
        for spec in &specs {
            let result = run_etapa_a(spec, &work_dir, &options).expect("etapa A do par");
            println!(
                "DECOMP_ETAPA_A pair={} functions={} unique_hashes={} boundary={:?} rom_identical={:?} objects={:?}/{:?} notes={:?}",
                result.pair_id,
                result.functions_indexed,
                result.fingerprint_unique_hashes,
                result.boundary.as_ref().map(|b| (b.precision, b.recall)),
                result.determinism.as_ref().map(|d| d.rom_identical),
                result.determinism.as_ref().map(|d| d.objects_exact),
                result.determinism.as_ref().map(|d| d.objects_total),
                result.notes,
            );
            results.push(result);
        }

        // Contrato da Etapa A: os 3 pares processam; os 2 self-compare pequenos exigem
        // ROM determinística e objetos exatos entre build A e build B.
        assert_eq!(results.len(), 3, "3 pares Tier 0 devem processar");
        for result in &results {
            if result.pair_id.starts_with("smoke_test")
                || result.pair_id.starts_with("blue_circuit")
            {
                let determinism = result
                    .determinism
                    .as_ref()
                    .expect("self-compare precisa de rebuild duplo");
                assert!(
                    determinism.rom_identical,
                    "ROM do rebuild duplo deve ser identica para {}",
                    result.pair_id
                );
                assert!(
                    determinism.objects_total > 0
                        && determinism.objects_exact == determinism.objects_total,
                    "objetos do rebuild duplo devem ser exatos para {}: {:?}",
                    result.pair_id,
                    determinism
                );
                assert!(
                    result.functions_indexed > 0,
                    "fingerprint deve indexar funções: {}",
                    result.pair_id
                );
            }
        }

        // Relatórios persistidos (target-test é gitignored; evidência local).
        let report_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target-test")
            .join("validation")
            .join("decomp");
        fs::create_dir_all(&report_dir).expect("create report dir");
        let report_path = report_dir.join("etapa-a-report.json");
        fs::write(
            &report_path,
            serde_json::to_string_pretty(&results).expect("serialize etapa a") + "\n",
        )
        .expect("write etapa a report");
        println!("DECOMP_ETAPA_A report={}", report_path.display());
    }
}
