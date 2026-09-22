//! Recuperacao de uma rotina M68K pequena e exacta para o perfil Mega Drive.
//!
//! Este modulo nao tenta desassemblar uma ROM inteira. O contrato deliberadamente
//! estreito aceita somente `ADDQ.W #1,D0; RTS` em bytes contiguos, registra a
//! fronteira e o source mapping, e recusa qualquer entrada que nao case exatamente.

#![allow(dead_code)]

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::core::rom_mastering::sha256_hex;

use super::super::loader::load_rom;
use super::super::platform::LoadedRom;

const ADDQ_WORD_D0: [u8; 2] = [0x52, 0x40];
const RTS: [u8; 2] = [0x4e, 0x75];
const ROUTINE_SIZE: usize = 4;
const BRANCH_ROUTINE_SIZE: usize = 30;
const BRANCH_THRESHOLD_OFFSET: usize = 7;
const BRANCH_ROUTINE_BYTES: [u8; BRANCH_ROUTINE_SIZE] = [
    0x06, 0x40, 0x00, 0x01, 0x0c, 0x40, 0x00, 0x05, 0x6c, 0x0a, 0x33, 0xfc, 0x00, 0x00, 0xe0, 0xff,
    0xff, 0x00, 0x4e, 0x75, 0x33, 0xfc, 0x00, 0x01, 0xe0, 0xff, 0xff, 0x00, 0x4e, 0x75,
];

pub const PROFILE_ID: &str = "m68k.addq_word_d0_rts.v1";
pub const BRANCH_PROFILE_ID: &str = "m68k.add_compare_branch_word_d0_wram.v1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LogicRecoveryResult {
    pub ok: bool,
    pub error: String,
    pub profile_id: String,
    pub architecture: String,
    pub source_path: String,
    pub rom_sha256: String,
    pub rom_offset: usize,
    pub rom_end: usize,
    pub bytes: Vec<u8>,
    pub boundary: String,
    pub call_sites: Vec<usize>,
    pub limitations: Vec<String>,
    pub operations: Vec<RecoveredOperation>,
    pub inputs: Vec<String>,
    pub outputs: Vec<String>,
    pub memory_effects: Vec<String>,
    pub flags: Vec<String>,
    pub source_mappings: Vec<SourceMapping>,
    pub independent_test_states: Vec<IndependentTestState>,
    pub graph_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RecoveredOperation {
    pub rom_offset: usize,
    pub bytes: Vec<u8>,
    pub mnemonic: String,
    pub semantic: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SourceMapping {
    pub rom_start: usize,
    pub rom_end: usize,
    pub ir_op: String,
    pub node_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct IndependentTestState {
    pub input_d0: u32,
    pub input_x: bool,
    pub output_d0: u32,
    pub output_x: bool,
    pub output_n: bool,
    pub output_z: bool,
    pub output_v: bool,
    pub output_c: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_result: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch_taken: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parameter_value: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LogicPatchResult {
    pub ok: bool,
    pub error: String,
    pub profile_id: String,
    pub input_path: String,
    pub output_path: String,
    pub input_sha256: String,
    pub output_sha256: String,
    pub rom_offset: usize,
    pub old_bytes: Vec<u8>,
    pub new_bytes: Vec<u8>,
    pub immediate: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct CpuState {
    d0: u32,
    x: bool,
    n: bool,
    z: bool,
    v: bool,
    c: bool,
}

pub fn recover_logic(rom_path: &str, offset: usize) -> Result<LogicRecoveryResult, String> {
    let loaded = load_rom(Path::new(rom_path))?;
    if loaded.target != "megadrive" {
        return Err(format!(
            "perfil {} requer uma ROM Mega Drive; target detectado: {}",
            PROFILE_ID, loaded.target
        ));
    }
    if offset.checked_add(ROUTINE_SIZE).is_none() || offset + ROUTINE_SIZE > loaded.bytes.len() {
        return Err(format!(
            "offset 0x{offset:06X} fora dos limites para uma rotina de {ROUTINE_SIZE} bytes; ROM normalizada tem {} bytes",
            loaded.bytes.len()
        ));
    }

    if offset + BRANCH_ROUTINE_SIZE <= loaded.bytes.len()
        && loaded.bytes[offset..offset + BRANCH_ROUTINE_SIZE] == BRANCH_ROUTINE_BYTES
    {
        return recover_branch_logic(&loaded, offset);
    }

    let observed = &loaded.bytes[offset..offset + ROUTINE_SIZE];
    if observed != [ADDQ_WORD_D0[0], ADDQ_WORD_D0[1], RTS[0], RTS[1]] {
        return Err(format!(
            "bytes em 0x{offset:06X} nao casam exatamente com ADDQ.W #1,D0; RTS: observado {}",
            format_bytes(observed)
        ));
    }

    let call_sites = find_absolute_call_sites(&loaded.bytes, offset);
    let rom_sha256 = sha256_hex(&loaded.bytes);
    let node_id = format!("rom_addq_word_{offset:06X}");
    let graph_json = graph_json(&node_id, &rom_sha256, offset);
    let independent_test_states = independent_test_states();
    let limitations = vec![
        "call_sites cobre somente JSR absoluto .L/.W; callers indiretos ou PC-relative permanecem desconhecidos".to_string(),
        "a prova de execução dinâmica do PC não faz parte deste perfil; call_sites é evidência estrutural".to_string(),
        "o corpo fora dos quatro bytes exatos não é inferido nem desassemblado".to_string(),
    ];

    Ok(LogicRecoveryResult {
        ok: true,
        error: String::new(),
        profile_id: PROFILE_ID.to_string(),
        architecture: "m68000-big-endian".to_string(),
        source_path: loaded.source_path,
        rom_sha256,
        rom_offset: offset,
        rom_end: offset + ROUTINE_SIZE,
        bytes: observed.to_vec(),
        boundary: "exact: [ADDQ.W #1,D0] [RTS]; RTS terminates the recovered body".to_string(),
        call_sites,
        limitations,
        operations: vec![
            RecoveredOperation {
                rom_offset: offset,
                bytes: ADDQ_WORD_D0.to_vec(),
                mnemonic: "ADDQ.W #1,D0".to_string(),
                semantic: "D0[15:0] = D0[15:0] + 1 (mod 2^16); D0[31:16] unchanged".to_string(),
            },
            RecoveredOperation {
                rom_offset: offset + 2,
                bytes: RTS.to_vec(),
                mnemonic: "RTS".to_string(),
                semantic: "return to caller; no fall-through".to_string(),
            },
        ],
        inputs: vec![
            "D0[31:0]".to_string(),
            "X flag (only as prior-state documentation)".to_string(),
        ],
        outputs: vec![
            "D0[31:0]".to_string(),
            "N,Z,V,C,X flags".to_string(),
            "return control flow".to_string(),
        ],
        memory_effects: vec!["none".to_string()],
        flags: vec![
            "N = result bit 15".to_string(),
            "Z = result word == 0".to_string(),
            "V = signed 16-bit overflow".to_string(),
            "C = unsigned 16-bit carry".to_string(),
            "X = C for this data-register ADDQ".to_string(),
        ],
        source_mappings: vec![
            SourceMapping {
                rom_start: offset,
                rom_end: offset + 2,
                ir_op: "rom.addq_word(register=D0, immediate=1)".to_string(),
                node_id: node_id.clone(),
            },
            SourceMapping {
                rom_start: offset + 2,
                rom_end: offset + ROUTINE_SIZE,
                ir_op: "control.return".to_string(),
                node_id: format!("{node_id}_return"),
            },
        ],
        independent_test_states,
        graph_json,
    })
}

fn recover_branch_logic(loaded: &LoadedRom, offset: usize) -> Result<LogicRecoveryResult, String> {
    let observed = &loaded.bytes[offset..offset + BRANCH_ROUTINE_SIZE];
    let rom_sha256 = sha256_hex(&loaded.bytes);
    let node_id = format!("rom_branch_compare_word_{offset:06X}");
    let threshold = u16::from_be_bytes([observed[6], observed[7]]);
    let graph_json = branch_graph_json(&node_id, &rom_sha256, offset, threshold);
    let independent_test_states = branch_independent_test_states(threshold);
    let call_sites = find_absolute_call_sites(&loaded.bytes, offset);

    Ok(LogicRecoveryResult {
        ok: true,
        error: String::new(),
        profile_id: BRANCH_PROFILE_ID.to_string(),
        architecture: "m68000-big-endian".to_string(),
        source_path: loaded.source_path.clone(),
        rom_sha256,
        rom_offset: offset,
        rom_end: offset + BRANCH_ROUTINE_SIZE,
        bytes: observed.to_vec(),
        boundary: "exact: ADDI.W #1,D0; CMPI.W #5,D0; BGE.S; two MOVE.W result writes; RTS at both exits".to_string(),
        call_sites,
        limitations: vec![
            "aceita somente os 30 bytes contiguos deste fixture, com ADDI.W #1, limiar 5, BGE.S e escrita WRAM fixa".to_string(),
            "o unico parametro editavel deste perfil e o limiar CMPI.W; bias, registrador, desvios e endereco permanecem fixos".to_string(),
            "a prova cobre os callers JSR absolutos detectaveis e nao promete desassemblagem geral de M68K".to_string(),
        ],
        operations: vec![
            RecoveredOperation { rom_offset: offset, bytes: observed[0..4].to_vec(), mnemonic: "ADDI.W #1,D0".to_string(), semantic: "le a palavra baixa de D0 e soma 1 modulo 2^16".to_string() },
            RecoveredOperation { rom_offset: offset + 4, bytes: observed[4..8].to_vec(), mnemonic: "CMPI.W #5,D0".to_string(), semantic: "compara D0[15:0] com o limiar assinado 5".to_string() },
            RecoveredOperation { rom_offset: offset + 8, bytes: observed[8..10].to_vec(), mnemonic: "BGE.S .branch_true".to_string(), semantic: "seleciona o ramo verdadeiro quando a comparacao assinada e >=".to_string() },
            RecoveredOperation { rom_offset: offset + 10, bytes: observed[10..18].to_vec(), mnemonic: "MOVE.W #0,$E0FFFF00.L".to_string(), semantic: "escreve resultado 0 na palavra da oracle WRAM no ramo falso".to_string() },
            RecoveredOperation { rom_offset: offset + 18, bytes: observed[18..20].to_vec(), mnemonic: "RTS".to_string(), semantic: "retorna no ramo falso sem fall-through".to_string() },
            RecoveredOperation { rom_offset: offset + 20, bytes: observed[20..28].to_vec(), mnemonic: "MOVE.W #1,$E0FFFF00.L".to_string(), semantic: "escreve resultado 1 na palavra da oracle WRAM no ramo verdadeiro".to_string() },
            RecoveredOperation { rom_offset: offset + 28, bytes: observed[28..30].to_vec(), mnemonic: "RTS".to_string(), semantic: "retorna no ramo verdadeiro".to_string() },
        ],
        inputs: vec!["D0[15:0] como variavel de entrada".to_string(), "D0[31:16] nao participa da comparacao".to_string()],
        outputs: vec!["palavra 0/1 em $E0FFFF00 (oracle WRAM)".to_string(), "controle de retorno por ambos os RTS".to_string()],
        memory_effects: vec!["write.w $E0FFFF00.L: 0 no ramo falso ou 1 no ramo verdadeiro".to_string()],
        flags: vec!["BGE.S consome a comparacao assinada de CMPI.W".to_string()],
        source_mappings: vec![
            SourceMapping { rom_start: offset, rom_end: offset + 4, ir_op: "rom.branch_word.read_add(input=D0,bias=1)".to_string(), node_id: node_id.clone() },
            SourceMapping { rom_start: offset + 4, rom_end: offset + 10, ir_op: "rom.branch_word.compare_gte_signed(threshold=5)".to_string(), node_id: node_id.clone() },
            SourceMapping { rom_start: offset + 10, rom_end: offset + 20, ir_op: "rom.branch_word.write_result(false=0);control.return".to_string(), node_id: node_id.clone() },
            SourceMapping { rom_start: offset + 20, rom_end: offset + BRANCH_ROUTINE_SIZE, ir_op: "rom.branch_word.write_result(true=1);control.return".to_string(), node_id: node_id.clone() },
        ],
        independent_test_states,
        graph_json,
    })
}

pub fn patch_logic(
    rom_path: &str,
    output_path: &str,
    expected_sha256: &str,
    offset: usize,
    immediate: u8,
) -> Result<LogicPatchResult, String> {
    if !(1..=8).contains(&immediate) {
        return Err("immediate deve estar entre 1 e 8 para ADDQ".to_string());
    }
    let input = Path::new(rom_path);
    let output = Path::new(output_path);
    if input == output {
        return Err("a saida deve ser uma copia distinta da ROM de entrada".to_string());
    }
    if output.exists() {
        return Err(format!(
            "saida ja existe; para preservar evidencia e evitar sobrescrita, escolha outro caminho: {}",
            output.display()
        ));
    }

    let loaded = load_rom(input)?;
    if loaded.target != "megadrive" || loaded.stripped_header_bytes != 0 {
        return Err(
            "patch deste perfil aceita somente imagem Mega Drive raw sem copier header".to_string(),
        );
    }
    let input_sha256 = sha256_hex(&loaded.bytes);
    if input_sha256 != expected_sha256 {
        return Err(format!(
            "SHA-256 diverge: esperado {expected_sha256}, observado {input_sha256}; patch recusado"
        ));
    }
    if offset.checked_add(ROUTINE_SIZE).is_none() || offset + ROUTINE_SIZE > loaded.bytes.len() {
        return Err("offset fora dos limites da ROM".to_string());
    }
    let old_bytes = loaded.bytes[offset..offset + ROUTINE_SIZE].to_vec();
    if offset + BRANCH_ROUTINE_SIZE <= loaded.bytes.len()
        && loaded.bytes[offset..offset + BRANCH_ROUTINE_SIZE] == BRANCH_ROUTINE_BYTES
    {
        let mut patched = loaded.bytes;
        patched[offset + BRANCH_THRESHOLD_OFFSET] = immediate;
        fs::write(output, &patched)
            .map_err(|error| format!("falha ao gravar copia patchada: {error}"))?;
        return Ok(LogicPatchResult {
            ok: true,
            error: String::new(),
            profile_id: BRANCH_PROFILE_ID.to_string(),
            input_path: input.to_string_lossy().to_string(),
            output_path: output.to_string_lossy().to_string(),
            input_sha256,
            output_sha256: sha256_hex(&patched),
            rom_offset: offset,
            old_bytes: BRANCH_ROUTINE_BYTES.to_vec(),
            new_bytes: patched[offset..offset + BRANCH_ROUTINE_SIZE].to_vec(),
            immediate,
        });
    }
    if old_bytes != vec![ADDQ_WORD_D0[0], ADDQ_WORD_D0[1], RTS[0], RTS[1]] {
        return Err(format!(
            "patch recusado: bytes nao sao o perfil exacto: {}",
            format_bytes(&old_bytes)
        ));
    }
    let new_opcode = 0x5000u16 | ((immediate as u16) << 9) | 0x0040;
    let mut patched = loaded.bytes;
    patched[offset..offset + 2].copy_from_slice(&new_opcode.to_be_bytes());
    fs::write(output, &patched)
        .map_err(|error| format!("falha ao gravar copia patchada: {error}"))?;
    let output_sha256 = sha256_hex(&patched);

    Ok(LogicPatchResult {
        ok: true,
        error: String::new(),
        profile_id: PROFILE_ID.to_string(),
        input_path: input.to_string_lossy().to_string(),
        output_path: output.to_string_lossy().to_string(),
        input_sha256,
        output_sha256,
        rom_offset: offset,
        old_bytes,
        new_bytes: patched[offset..offset + ROUTINE_SIZE].to_vec(),
        immediate,
    })
}

fn graph_json(node_id: &str, rom_sha256: &str, offset: usize) -> String {
    json!({
        "version": 1,
        "nodes": [
            {
                "id": format!("{node_id}_entry"),
                "type": "event_start",
                "label": "Recovered ROM entry",
                "x": 40,
                "y": 120,
                "inputs": [],
                "outputs": [{"id":"exec","label":"▶","kind":"exec"}],
                "params": {
                    "source": "rom",
                    "rom_sha256": rom_sha256,
                    "rom_start": offset as u64
                }
            },
            {
                "id": node_id,
                "type": "rom_addq_word",
                "label": "ADDQ.W #1, D0 (recovered)",
                "x": 300,
                "y": 120,
                "inputs": [{"id":"exec","label":"▶","kind":"exec"}],
                "outputs": [{"id":"exec","label":"▶","kind":"exec"}],
                "params": {
                    "register": "D0",
                    "var_name": "rom_d0",
                    "immediate": 1,
                    "width_bits": 16,
                    "signedness": "bit-preserving-word",
                    "rom_sha256": rom_sha256,
                    "rom_start": offset as u64,
                    "rom_end": (offset + ROUTINE_SIZE) as u64,
                    "instruction_offsets": format!("0x{offset:06X},0x{:06X}", offset + 2),
                    "flags": "N,Z,V,C,X",
                    "memory_effects": "none",
                    "limitations": "absolute-jsr-only-call-scan; no-dynamic-pc-trace; exact-four-byte-body-only",
                    "profile_id": PROFILE_ID
                }
            }
        ],
        "edges": [{
            "id": format!("{node_id}_entry_exec"),
            "fromNode": format!("{node_id}_entry"),
            "fromPort": "exec",
            "toNode": node_id,
            "toPort": "exec"
        }]
    })
    .to_string()
}

fn branch_graph_json(node_id: &str, rom_sha256: &str, offset: usize, threshold: u16) -> String {
    json!({
        "version": 1,
        "nodes": [
            {
                "id": format!("{node_id}_entry"),
                "type": "event_start",
                "label": "Recovered branch routine entry",
                "x": 40,
                "y": 120,
                "inputs": [],
                "outputs": [{"id":"exec","label":"▶","kind":"exec"}],
                "params": {"source":"rom","rom_sha256":rom_sha256,"rom_start":offset as u64}
            },
            {
                "id": node_id,
                "type": "rom_branch_compare_word",
                "label": "ADD.W + compare + branch + write (recovered)",
                "x": 320,
                "y": 120,
                "inputs": [{"id":"exec","label":"▶","kind":"exec"}],
                "outputs": [{"id":"exec","label":"▶","kind":"exec"}],
                "params": {
                    "profile_id": BRANCH_PROFILE_ID,
                    "input_var": "branch_input",
                    "bias": 1,
                    "threshold": threshold,
                    "result_var": "branch_result",
                    "output_address": "0xE0FFFF00",
                    "rom_sha256": rom_sha256,
                    "rom_start": offset as u64,
                    "rom_end": (offset + BRANCH_ROUTINE_SIZE) as u64,
                    "instruction_offsets": format!("0x{offset:06X},0x{:06X},0x{:06X},0x{:06X},0x{:06X},0x{:06X},0x{:06X}", offset + 4, offset + 8, offset + 10, offset + 18, offset + 20, offset + 28),
                    "semantic_stages": "read_variable;add_word;compare_signed;branch_conditional;write_result",
                    "limitations": "exact-fixture-body-only;threshold-edit-only;fixed-wram-oracle",
                }
            }
        ],
        "edges": [{"id":format!("{node_id}_entry_exec"),"fromNode":format!("{node_id}_entry"),"fromPort":"exec","toNode":node_id,"toPort":"exec"}]
    }).to_string()
}

fn independent_test_states() -> Vec<IndependentTestState> {
    [
        0x0000_0000,
        0x0000_0001,
        0x0000_7fff,
        0x0000_8000,
        0x1234_ffff,
    ]
    .into_iter()
    .map(|d0| {
        let result = reference_word_add(d0);
        IndependentTestState {
            input_d0: d0,
            input_x: true,
            output_d0: result.0,
            output_x: result.5,
            output_n: result.1,
            output_z: result.2,
            output_v: result.3,
            output_c: result.4,
            output_result: None,
            branch_taken: None,
            parameter_value: None,
        }
    })
    .collect()
}

fn branch_independent_test_states(threshold: u16) -> Vec<IndependentTestState> {
    [3u32, 4, 5, 0, 0xffff, 0x1234]
        .into_iter()
        .map(|input_d0| {
            let arithmetic = (input_d0 as u16).wrapping_add(1);
            let branch_taken = (arithmetic as i16) >= threshold as i16;
            IndependentTestState {
                input_d0,
                input_x: false,
                output_d0: (input_d0 & 0xffff_0000) | arithmetic as u32,
                output_x: false,
                output_n: false,
                output_z: false,
                output_v: false,
                output_c: false,
                output_result: Some(if branch_taken { 1 } else { 0 }),
                branch_taken: Some(branch_taken),
                parameter_value: Some(threshold),
            }
        })
        .collect()
}

fn reference_word_add(d0: u32) -> (u32, bool, bool, bool, bool, bool) {
    let word = d0 as u16;
    let result = word.wrapping_add(1);
    let signed = word as i16;
    let signed_result = result as i16;
    let overflow = signed == i16::MAX;
    let carry = word == u16::MAX;
    (
        (d0 & 0xffff_0000) | result as u32,
        signed_result.is_negative(),
        result == 0,
        overflow,
        carry,
        carry,
    )
}

fn find_absolute_call_sites(bytes: &[u8], target: usize) -> Vec<usize> {
    let target32 = target as u32;
    let target16 = target as u16;
    let mut sites = Vec::new();
    for (offset, window) in bytes.windows(6).enumerate() {
        if window[0..2] == [0x4e, 0xb9] && window[2..6] == target32.to_be_bytes() {
            sites.push(offset);
        }
    }
    for (offset, window) in bytes.windows(4).enumerate() {
        if window[0..2] == [0x4e, 0xb8] && window[2..4] == target16.to_be_bytes() {
            sites.push(offset);
        }
    }
    sites.sort_unstable();
    sites.dedup();
    sites
}

fn format_bytes(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fixture_path() -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        std::env::temp_dir().join(format!("retrodev-logic-recovery-{nonce}.bin"))
    }

    fn fixture_rom() -> Vec<u8> {
        let mut rom = vec![0u8; 0x2000];
        rom[0x100..0x110].copy_from_slice(b"SEGA GENESIS    ");
        rom[0x150..0x161].copy_from_slice(b"RETRODEV LOGIC MD");
        rom[0x200..0x204].copy_from_slice(&[0x52, 0x40, 0x4e, 0x75]);
        rom
    }

    #[test]
    fn recovers_exact_routine_with_mapping_and_independent_states() {
        let path = fixture_path();
        fs::write(&path, fixture_rom()).expect("fixture");
        let result = recover_logic(path.to_str().expect("path"), 0x200).expect("recovery");
        assert_eq!(result.profile_id, PROFILE_ID);
        assert_eq!(result.bytes, vec![0x52, 0x40, 0x4e, 0x75]);
        assert_eq!(result.rom_end, 0x204);
        assert_eq!(result.call_sites, Vec::<usize>::new());
        assert_eq!(result.source_mappings.len(), 2);
        assert_eq!(result.independent_test_states[2].output_d0, 0x0000_8000);
        assert!(result.graph_json.contains("rom_addq_word"));
        fs::remove_file(path).expect("cleanup");
    }

    #[test]
    fn rejects_near_miss_instead_of_guessing() {
        let path = fixture_path();
        let mut rom = fixture_rom();
        rom[0x201] = 0x40;
        rom[0x200] = 0x54;
        fs::write(&path, rom).expect("fixture");
        let error = recover_logic(path.to_str().expect("path"), 0x200).expect_err("reject");
        assert!(error.contains("nao casam exatamente"));
        fs::remove_file(path).expect("cleanup");
    }

    #[test]
    fn patch_requires_hash_and_writes_distinct_copy() {
        let path = fixture_path();
        let output = path.with_file_name(format!("{}.patched.bin", path.display()));
        let bytes = fixture_rom();
        fs::write(&path, &bytes).expect("fixture");
        let sha = sha256_hex(&bytes);
        let result = patch_logic(
            path.to_str().expect("path"),
            output.to_str().expect("output"),
            &sha,
            0x200,
            2,
        )
        .expect("patch");
        assert_eq!(result.new_bytes, vec![0x54, 0x40, 0x4e, 0x75]);
        assert_ne!(result.input_sha256, result.output_sha256);
        fs::remove_file(path).expect("cleanup input");
        fs::remove_file(output).expect("cleanup output");
    }

    #[test]
    fn reference_flags_cover_word_wrap_and_signed_overflow() {
        let wrapped = reference_word_add(0x1234_ffff);
        assert_eq!(wrapped.0, 0x1234_0000);
        assert!(wrapped.1 == false && wrapped.2 && wrapped.4 && wrapped.5);
        let overflow = reference_word_add(0x0000_7fff);
        assert_eq!(overflow.0, 0x0000_8000);
        assert!(overflow.1 && overflow.3 && !overflow.4);
    }

    #[test]
    fn recovers_branch_fixture_and_patches_only_threshold() {
        let path = fixture_path();
        let output = path.with_file_name(format!("{}.branch6.patched.bin", path.display()));
        let mut rom = fixture_rom();
        rom[0x300..0x300 + BRANCH_ROUTINE_SIZE].copy_from_slice(&BRANCH_ROUTINE_BYTES);
        fs::write(&path, &rom).expect("fixture");
        let result = recover_logic(path.to_str().expect("path"), 0x300).expect("branch recovery");
        assert_eq!(result.profile_id, BRANCH_PROFILE_ID);
        assert_eq!(result.source_mappings.len(), 4);
        assert_eq!(result.independent_test_states[0].output_result, Some(0));
        assert_eq!(result.independent_test_states[1].output_result, Some(1));
        assert_eq!(result.independent_test_states[3].output_result, Some(0));
        let sha = sha256_hex(&rom);
        let patched = patch_logic(
            path.to_str().expect("path"),
            output.to_str().expect("output"),
            &sha,
            0x300,
            6,
        )
        .expect("branch patch");
        assert_eq!(patched.profile_id, BRANCH_PROFILE_ID);
        assert_eq!(patched.new_bytes[7], 6);
        assert_eq!(patched.new_bytes[..7], BRANCH_ROUTINE_BYTES[..7]);
        assert_eq!(patched.new_bytes[8..], BRANCH_ROUTINE_BYTES[8..]);
        fs::remove_file(path).expect("cleanup input");
        fs::remove_file(output).expect("cleanup output");
    }
}
