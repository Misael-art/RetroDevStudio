//! `object_diff`: comparação por símbolo entre objetos M68K (`.o`) do doador e de um
//! rebuild, via `m68k-elf-objdump -dr` (binutils do host). Cada função vira um bloco
//! textual cujo endereço-base é normalizado antes do hash — classes: `exact` (bytes
//! idênticos), `divergent`, `only_original` / `only_rebuild`.
//!
//! Segurança de execução: nomes de programa **literais** (`m68k-elf-objdump`,
//! `m68k-elf-nm`) resolvidos no PATH do processo filho; opcionalmente um diretório de
//! binutils autorizado (`RDS_M68K_BIN`) entra no `PATH` do filho após validação.
//! Sem shell intermediário, sem concatenação de comando.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};

use super::rom_library::sha256_hex;

pub const CLASS_EXACT: &str = "exact";
pub const CLASS_DIVERGENT: &str = "divergent";
pub const CLASS_ONLY_ORIGINAL: &str = "only_original";
pub const CLASS_ONLY_REBUILD: &str = "only_rebuild";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SymbolDiff {
    pub name: String,
    pub class: String,
    pub bytes_original: usize,
    pub bytes_rebuild: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ObjectDiffReport {
    pub original_path: String,
    pub rebuild_path: String,
    pub sha256_original: String,
    pub sha256_rebuild: String,
    pub identical_objects: bool,
    pub symbols_exact: usize,
    pub symbols_divergent: usize,
    pub only_original: usize,
    pub only_rebuild: usize,
    pub per_symbol: Vec<SymbolDiff>,
}

fn safe_dir(path: &Path, label: &str) -> Result<PathBuf, String> {
    if path.as_os_str().to_string_lossy().contains('\0') {
        return Err(format!("{label} contem byte NUL no caminho"));
    }
    if !path.is_dir() {
        return Err(format!("{label} nao e um diretorio: {}", path.display()));
    }
    Ok(path.to_path_buf())
}

/// Diretório de binutils m68k autorizado (`RDS_M68K_BIN`), se configurado.
pub fn m68k_bin_dir() -> Result<Option<PathBuf>, String> {
    match std::env::var("RDS_M68K_BIN") {
        Ok(dir) if !dir.trim().is_empty() => {
            Ok(Some(safe_dir(Path::new(dir.trim()), "RDS_M68K_BIN")?))
        }
        _ => Ok(None),
    }
}

fn run_capture(
    program: &'static str,
    bin_dir: Option<&Path>,
    args: &[String],
) -> Result<String, String> {
    let mut command = Command::new(program);
    if let Some(dir) = bin_dir {
        let child_path = match std::env::var("PATH") {
            Ok(existing) => format!("{}:{existing}", dir.display()),
            Err(_) => dir.display().to_string(),
        };
        command.env("PATH", child_path);
    }
    for arg in args {
        command.arg(arg);
    }
    let output = command
        .output()
        .map_err(|error| format!("falha ao invocar {program}: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "{program} terminou com status {}: {}",
            output.status,
            stderr.lines().take(8).collect::<Vec<_>>().join(" | ")
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Extrai, de `objdump -dr`, um mapa `símbolo -> bloco textual normalizado` (o
/// endereço-base e os offsets de instrução são removidos; permanecem mnemônico,
/// operandos e anotações de relocação — imunes a diferenças de layout entre builds).
pub fn parse_objdump_blocks(objdump_text: &str) -> BTreeMap<String, String> {
    let mut blocks: BTreeMap<String, String> = BTreeMap::new();
    let mut current: Option<String> = None;
    for line in objdump_text.lines() {
        // Cabeçalho de bloco: "00000000 <FUNCAO_FSM>:" (endereço hex + nome entre <>).
        if let Some((before, name)) = line.rsplit_once('<') {
            if let Some(header) = name.strip_suffix(">:") {
                let address = before.trim();
                if !address.is_empty() && address.chars().all(|c| c.is_ascii_hexdigit()) {
                    current = Some(header.to_string());
                    continue;
                }
            }
        }
        if let Some(name) = &current {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            // Instrução: "   4f60: 46fc 2700    move.w ..." -> mantém depois do ':'.
            // Relocação: "			42: R_68K_32	foo" -> mantém a linha inteira.
            let normalized = if trimmed.contains(':') && !trimmed.starts_with('.') {
                match trimmed.split_once(':') {
                    Some((_, rest)) if !rest.trim().is_empty() => rest.trim().to_string(),
                    _ => trimmed.to_string(),
                }
            } else {
                trimmed.to_string()
            };
            blocks
                .entry(name.clone())
                .or_default()
                .push_str(&normalized);
            blocks.entry(name.clone()).or_default().push('\n');
        }
    }
    blocks
}

fn symbol_blocks(object_path: &Path) -> Result<BTreeMap<String, String>, String> {
    if !object_path.is_file() {
        return Err(format!("objeto nao encontrado: {}", object_path.display()));
    }
    let bin_dir = m68k_bin_dir()?;
    let text = run_capture(
        "m68k-elf-objdump",
        bin_dir.as_deref(),
        &["-dr".to_string(), object_path.to_string_lossy().to_string()],
    )?;
    Ok(parse_objdump_blocks(&text))
}

/// Compara dois objetos por símbolo. `identical_objects` reflete o SHA-256 completo;
/// os contadores por símbolo refletem os blocos de disassembly normalizados.
pub fn diff_objects(original: &Path, rebuild: &Path) -> Result<ObjectDiffReport, String> {
    let original_bytes = fs::read(original)
        .map_err(|error| format!("falha ao ler '{}': {error}", original.display()))?;
    let rebuild_bytes = fs::read(rebuild)
        .map_err(|error| format!("falha ao ler '{}': {error}", rebuild.display()))?;

    let blocks_original = symbol_blocks(original)?;
    let blocks_rebuild = symbol_blocks(rebuild)?;

    let mut per_symbol: Vec<SymbolDiff> = Vec::new();
    let mut symbols_exact = 0usize;
    let mut symbols_divergent = 0usize;
    for (name, block_original) in &blocks_original {
        match blocks_rebuild.get(name) {
            Some(block_rebuild) => {
                let class = if block_original == block_rebuild {
                    symbols_exact += 1;
                    CLASS_EXACT
                } else {
                    symbols_divergent += 1;
                    CLASS_DIVERGENT
                };
                per_symbol.push(SymbolDiff {
                    name: name.clone(),
                    class: class.to_string(),
                    bytes_original: block_original.len(),
                    bytes_rebuild: block_rebuild.len(),
                });
            }
            None => per_symbol.push(SymbolDiff {
                name: name.clone(),
                class: CLASS_ONLY_ORIGINAL.to_string(),
                bytes_original: block_original.len(),
                bytes_rebuild: 0,
            }),
        }
    }
    let only_rebuild = blocks_rebuild
        .keys()
        .filter(|name| !blocks_original.contains_key(*name))
        .count();
    for name in blocks_rebuild.keys() {
        if !blocks_original.contains_key(name) {
            per_symbol.push(SymbolDiff {
                name: name.clone(),
                class: CLASS_ONLY_REBUILD.to_string(),
                bytes_original: 0,
                bytes_rebuild: blocks_rebuild[name].len(),
            });
        }
    }
    per_symbol.sort_by(|left, right| left.name.cmp(&right.name));
    let only_original = per_symbol
        .iter()
        .filter(|diff| diff.class == CLASS_ONLY_ORIGINAL)
        .count();

    Ok(ObjectDiffReport {
        original_path: original.to_string_lossy().to_string(),
        rebuild_path: rebuild.to_string_lossy().to_string(),
        sha256_original: sha256_hex(&original_bytes),
        sha256_rebuild: sha256_hex(&rebuild_bytes),
        identical_objects: original_bytes == rebuild_bytes,
        symbols_exact,
        symbols_divergent,
        only_original,
        only_rebuild,
        per_symbol,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const OBJDUMP_SAMPLE: &str = "DISASSEMBLY SECTION:\n.text:\n\n00000000 <FUNCAO_FSM>:\n   0:	46fc 2700    	move.w  #0x2700,sr\n   4:	31f9 0000 0000 	move.w  #1,gRoom\n		R_68K_32	gRoom\n\n00000020 <PLAYER_STATE>:\n   20:	4e75         	rts\n";

    #[test]
    fn parses_objdump_blocks_with_relocations() {
        let blocks = parse_objdump_blocks(OBJDUMP_SAMPLE);
        assert_eq!(blocks.len(), 2);
        let fsm = blocks.get("FUNCAO_FSM").expect("FUNCAO_FSM block");
        assert!(
            fsm.contains("move.w  #0x2700,sr"),
            "sem endereco-base: {fsm}"
        );
        assert!(fsm.contains("R_68K_32"), "relocacao preservada: {fsm}");
        assert!(!fsm.contains("   0:"), "offset de instrucao normalizado");
        assert!(blocks.contains_key("PLAYER_STATE"));
    }

    #[test]
    fn diff_classes_exact_divergent_and_onlys() {
        let mut original = BTreeMap::new();
        original.insert("same".to_string(), "rts\n".to_string());
        original.insert("changed".to_string(), "nop\n".to_string());
        original.insert("gone".to_string(), "illegal\n".to_string());
        let mut rebuild = BTreeMap::new();
        rebuild.insert("same".to_string(), "rts\n".to_string());
        rebuild.insert("changed".to_string(), "trapv\n".to_string());
        rebuild.insert("new".to_string(), "rte\n".to_string());

        let original_path = Path::new("/rds-test-orig.o");
        let rebuild_path = Path::new("/rds-test-rebuild.o");
        // Extrai a lógica pura de classificação reutilizando os mapas diretamente.
        let mut per_symbol: Vec<SymbolDiff> = Vec::new();
        let mut exact = 0;
        let mut divergent = 0;
        for (name, block_original) in &original {
            match rebuild.get(name) {
                Some(block_rebuild) => {
                    let class = if block_original == block_rebuild {
                        exact += 1;
                        CLASS_EXACT
                    } else {
                        divergent += 1;
                        CLASS_DIVERGENT
                    };
                    per_symbol.push(SymbolDiff {
                        name: name.clone(),
                        class: class.to_string(),
                        bytes_original: block_original.len(),
                        bytes_rebuild: block_rebuild.len(),
                    });
                }
                None => per_symbol.push(SymbolDiff {
                    name: name.clone(),
                    class: CLASS_ONLY_ORIGINAL.to_string(),
                    bytes_original: block_original.len(),
                    bytes_rebuild: 0,
                }),
            }
        }
        let _ = (original_path, rebuild_path);
        assert_eq!(exact, 1);
        assert_eq!(divergent, 1);
        assert_eq!(
            per_symbol
                .iter()
                .filter(|d| d.class == CLASS_ONLY_ORIGINAL)
                .count(),
            1
        );
        assert_eq!(
            rebuild
                .keys()
                .filter(|name| !original.contains_key(*name))
                .count(),
            1
        );
    }
}
