//! Dois caminhos de reconstrucao, mantidos separados:
//!
//! * `patch_threshold`: copia a base e reescreve somente o byte imediato do
//!   `MOVEQ` do limiar (mais o checksum do cabecalho, se a base o tinha valido).
//! * `regenerate_from_graph`: remonta todas as instrucoes registradas no grafo,
//!   com o limiar editado, nos offsets originais.
//!
//! Ambos exigem identidade da base (SHA-256 e bytes da regiao iguais aos do
//! grafo), recusam crescimento e verificam que nenhum byte fora das faixas
//! autorizadas mudou.

use crate::graph::OpenedGraph;
use crate::m68k::{encode, Insn};
use crate::sha256::sha256_hex;

pub const MD_CHECKSUM_AT: usize = 0x18E;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rebuilt {
    pub method: &'static str,
    pub bytes: Vec<u8>,
    pub input_sha256: String,
    pub output_sha256: String,
    /// Faixas [inicio, fim) autorizadas a mudar.
    pub authorized: Vec<(usize, usize)>,
    /// Offsets que de fato mudaram.
    pub changed: Vec<usize>,
    pub checksum_updated: bool,
}

/// Checksum Mega Drive: soma de palavras big-endian de 0x200 ao fim da imagem.
pub fn md_checksum(rom: &[u8]) -> Option<u16> {
    if rom.len() < 0x200 || &rom[0x100..0x104] != b"SEGA" {
        return None;
    }
    let mut sum = 0u16;
    for pair in rom[0x200..].chunks(2) {
        let word = u16::from_be_bytes([pair[0], *pair.get(1).unwrap_or(&0)]);
        sum = sum.wrapping_add(word);
    }
    Some(sum)
}

fn stored_checksum(rom: &[u8]) -> u16 {
    u16::from_be_bytes([rom[MD_CHECKSUM_AT], rom[MD_CHECKSUM_AT + 1]])
}

fn verify_base(base: &[u8], expected_sha256: &str, opened: &OpenedGraph) -> Result<String, String> {
    let sha = sha256_hex(base);
    if sha != expected_sha256 {
        return Err(format!(
            "SHA-256 da base diverge: esperado {expected_sha256}, observado {sha}; recusado"
        ));
    }
    if sha != opened.rom_sha256 {
        return Err(format!(
            "o grafo foi recuperado de {} e a base informada e {sha}; recusado",
            opened.rom_sha256
        ));
    }
    for (start, bytes) in &opened.recorded_bytes {
        let s = *start as usize;
        if base.get(s..s + bytes.len()) != Some(bytes.as_slice()) {
            return Err(format!(
                "bytes da base em 0x{s:06X} nao sao os registrados no grafo; recusado"
            ));
        }
    }
    Ok(sha)
}

fn new_k(opened: &OpenedGraph) -> Result<i8, String> {
    let (min, max) = opened.rule.compare.editable_range();
    if !(min..=max).contains(&opened.threshold) {
        return Err(format!(
            "limiar {} fora de {min}..={max}; crescimento recusado",
            opened.threshold
        ));
    }
    Ok((opened.threshold - opened.rule.compare.bias) as i8)
}

fn finish(
    method: &'static str,
    base: &[u8],
    input_sha256: String,
    mut bytes: Vec<u8>,
    mut authorized: Vec<(usize, usize)>,
) -> Result<Rebuilt, String> {
    let mut checksum_updated = false;
    if let Some(sum) = md_checksum(base) {
        if sum == stored_checksum(base) {
            let new_sum = md_checksum(&bytes).expect("header preservado");
            bytes[MD_CHECKSUM_AT..MD_CHECKSUM_AT + 2].copy_from_slice(&new_sum.to_be_bytes());
            authorized.push((MD_CHECKSUM_AT, MD_CHECKSUM_AT + 2));
            checksum_updated = true;
        }
    }
    if bytes.len() != base.len() {
        return Err("tamanho da ROM mudou; crescimento recusado".to_string());
    }
    let changed: Vec<usize> = (0..base.len()).filter(|i| base[*i] != bytes[*i]).collect();
    if let Some(bad) = changed
        .iter()
        .find(|i| !authorized.iter().any(|(s, e)| (*s..*e).contains(*i)))
    {
        return Err(format!(
            "byte 0x{bad:06X} mudou fora das faixas autorizadas; recusado"
        ));
    }
    Ok(Rebuilt {
        method,
        output_sha256: sha256_hex(&bytes),
        bytes,
        input_sha256,
        authorized,
        changed,
        checksum_updated,
    })
}

pub fn patch_threshold(
    base: &[u8],
    expected_sha256: &str,
    opened: &OpenedGraph,
) -> Result<Rebuilt, String> {
    let sha = verify_base(base, expected_sha256, opened)?;
    let k = new_k(opened)?;
    let at = opened.rule.compare.k_at as usize;
    let mut bytes = base.to_vec();
    // MOVEQ: o imediato e o byte baixo da palavra de opcode.
    bytes[at + 1] = k as u8;
    finish(
        "patch_moveq_immediate",
        base,
        sha,
        bytes,
        vec![(at + 1, at + 2)],
    )
}

pub fn regenerate_from_graph(
    base: &[u8],
    expected_sha256: &str,
    opened: &OpenedGraph,
) -> Result<Rebuilt, String> {
    let sha = verify_base(base, expected_sha256, opened)?;
    let k = new_k(opened)?;
    let mut bytes = base.to_vec();
    let mut authorized = Vec::new();
    for (start, insn) in &opened.records {
        let insn = if *start == opened.rule.compare.k_at {
            match insn {
                Insn::Moveq { d, .. } => Insn::Moveq { imm: k, d: *d },
                _ => return Err("registro do limiar nao e MOVEQ".to_string()),
            }
        } else {
            insn.clone()
        };
        let encoded = encode(&insn, *start)?;
        let original_len = opened.recorded_bytes[start].len();
        if encoded.len() != original_len {
            return Err(format!(
                "instrucao em 0x{start:06X} mudaria de tamanho; crescimento recusado"
            ));
        }
        let s = *start as usize;
        bytes[s..s + encoded.len()].copy_from_slice(&encoded);
        authorized.push((s, s + encoded.len()));
    }
    finish("regenerate_region_from_graph", base, sha, bytes, authorized)
}
