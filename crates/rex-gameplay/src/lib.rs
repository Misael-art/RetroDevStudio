//! Recuperacao delimitada de uma regra de gameplay M68K a partir de uma ROM
//! Mega Drive — perfil `m68k.counter_threshold_state_gate.v1` (Experimental).
//!
//! Contrato em `crates/rex-gameplay/CONTRACT.md`. Pacote autonomo da frente REX:
//! sem Tauri, sem dependencias externas, sem filesystem na logica.
//!
//! Entradas declaradas pelo chamador: bytes da ROM, offset de entrada e offsets
//! de saida da regiao, e (opcionalmente) nomes de enderecos vindos de metadados,
//! usados apenas como rotulos. Nada aqui le fonte C, AST, grafo autoral ou
//! resultado esperado.

pub mod graph;
pub mod json;
pub mod lift;
pub mod m68k;
pub mod patch;
pub mod region;
pub mod sha256;

use graph::{build_graph, GraphInput, Hints};
use lift::{lift, GateRule};
use m68k::Machine;
use region::{delimit, Region};

pub const PROFILE_ID: &str = "m68k.counter_threshold_state_gate.v1";

pub const LIMITATIONS: &[&str] = &[
    "a regiao e delimitada a partir de entrada/saidas declaradas pelo chamador; nao ha descoberta automatica de rotinas",
    "subconjunto fechado de 12 formas M68000; qualquer outro opcode recusa a recuperacao",
    "a chamada externa (JSR) e opaca: alvo e argumentos sao registrados, o corpo nao e recuperado",
    "equivalencia e demonstrada por conjunto declarado de estados, nao por prova universal",
    "unica edicao permitida: limiar, dentro da faixa do MOVEQ original (sem crescimento)",
    "registradores e CCR na saida sao efeitos registrados, mas a sua vivacidade apos a saida nao e analisada",
];

#[derive(Debug, Clone)]
pub struct Recovery {
    pub rom_sha256: String,
    pub region: Region,
    pub rule: GateRule,
    pub graph_json: String,
}

pub fn recover(rom: &[u8], entry: u32, exits: &[u32], hints: &Hints) -> Result<Recovery, String> {
    let rom_sha256 = sha256::sha256_hex(rom);
    let region = delimit(rom, entry, exits)?;
    let rule = lift(&region)?;
    let threshold = rule.compare.k as i64 + rule.compare.bias;
    let graph_json = build_graph(&GraphInput {
        rom,
        rom_sha256: &rom_sha256,
        region: &region,
        rule: &rule,
        hints,
        threshold,
    })
    .pretty();
    Ok(Recovery {
        rom_sha256,
        region,
        rule,
        graph_json,
    })
}

/// Executa a regiao instrucao a instrucao (IR de instrucoes com flags) ate uma saida.
/// Devolve o PC de saida e o estado final.
pub fn execute_region(region: &Region, mut machine: Machine) -> Result<(u32, Machine), String> {
    let mut pc = region.entry;
    for _ in 0..=region.insns.len() {
        if region.exits.contains(&pc) {
            return Ok((pc, machine));
        }
        let decoded = region
            .at(pc)
            .ok_or_else(|| format!("PC 0x{pc:06X} fora da regiao delimitada"))?;
        pc = machine.step(decoded)?;
    }
    Err("execucao excedeu o numero de instrucoes da regiao aciclica".to_string())
}

/// Candidato estrutural encontrado por varredura (nao e prova de uso em gameplay).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Candidate {
    pub entry: u32,
    pub exit: u32,
    pub counter_addr: u32,
    pub threshold: i64,
}

/// Varre offsets alinhados procurando a forma com guarda (`BTST #n,Dk ; BEQ saida`)
/// e tenta recuperar cada um com a saida da propria guarda. So encontra essa forma;
/// regras sem guarda precisam de entrada/saidas declaradas.
pub fn scan_guarded_candidates(rom: &[u8]) -> Vec<Candidate> {
    let mut found = Vec::new();
    let mut at = 0u32;
    while (at as usize) + 6 <= rom.len() {
        if let Ok(first) = m68k::decode(rom, at) {
            if matches!(first.insn, m68k::Insn::BtstImmD { .. }) {
                if let Ok(second) = m68k::decode(rom, at + first.len) {
                    if let m68k::Insn::Bcc {
                        cond: m68k::Cond::Eq,
                        target,
                        ..
                    } = second.insn
                    {
                        if let Ok(region) = delimit(rom, at, &[target]) {
                            if let Ok(rule) = lift(&region) {
                                found.push(Candidate {
                                    entry: at,
                                    exit: target,
                                    counter_addr: rule.compare.counter_addr,
                                    threshold: rule.compare.threshold,
                                });
                            }
                        }
                    }
                }
            }
        }
        at += 2;
    }
    found
}
