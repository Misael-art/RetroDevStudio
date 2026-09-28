//! Delimitacao de regiao: a partir de uma entrada e de saidas declaradas pelo
//! chamador, percorre o fluxo de controle (os dois lados de cada desvio) ate
//! que todo caminho termine numa saida declarada. Recusa ciclos, sobreposicao
//! de instrucoes, desvios para fora e qualquer opcode fora do subconjunto.

use std::collections::{BTreeMap, BTreeSet};

use crate::m68k::{decode, Decoded, Insn};

/// Limite deterministico de instrucoes decodificadas por regiao.
pub const MAX_REGION_INSNS: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Region {
    pub entry: u32,
    pub exits: Vec<u32>,
    /// Instrucoes por offset (ordem de endereco).
    pub insns: BTreeMap<u32, Decoded>,
    /// Intervalos contiguos [inicio, fim) cobertos pela regiao.
    pub blocks: Vec<(u32, u32)>,
}

impl Region {
    pub fn at(&self, pc: u32) -> Option<&Decoded> {
        self.insns.get(&pc)
    }

    pub fn contains_byte(&self, offset: u32) -> bool {
        self.blocks.iter().any(|(s, e)| (*s..*e).contains(&offset))
    }
}

fn successors(decoded: &Decoded) -> Vec<u32> {
    let next = decoded.offset + decoded.len;
    match decoded.insn {
        Insn::Bcc { target, .. } => vec![next, target],
        Insn::Bra { target, .. } => vec![target],
        _ => vec![next],
    }
}

pub fn delimit(rom: &[u8], entry: u32, exits: &[u32]) -> Result<Region, String> {
    if exits.is_empty() {
        return Err("ao menos uma saida declarada e obrigatoria".to_string());
    }
    if exits.contains(&entry) {
        return Err("entrada coincide com uma saida declarada".to_string());
    }
    if entry % 2 != 0 || exits.iter().any(|e| e % 2 != 0) {
        return Err("entrada e saidas devem estar alinhadas a palavra".to_string());
    }
    let exit_set: BTreeSet<u32> = exits.iter().copied().collect();
    let mut insns: BTreeMap<u32, Decoded> = BTreeMap::new();
    let mut reached_exits = BTreeSet::new();
    let mut stack = vec![entry];
    while let Some(pc) = stack.pop() {
        if exit_set.contains(&pc) {
            reached_exits.insert(pc);
            continue;
        }
        if insns.contains_key(&pc) {
            continue;
        }
        if insns.len() >= MAX_REGION_INSNS {
            return Err(format!(
                "regiao excede {MAX_REGION_INSNS} instrucoes sem alcancar as saidas declaradas"
            ));
        }
        let decoded = decode(rom, pc)?;
        if let Insn::JsrAbsL { target } = decoded.insn {
            if target == entry {
                return Err(format!("JSR recursivo para a entrada em 0x{pc:06X}"));
            }
        }
        stack.extend(successors(&decoded));
        insns.insert(pc, decoded);
    }
    // Instrucoes sobrepostas (um desvio para o meio de outra) sao recusadas.
    let mut last_end = 0u32;
    for decoded in insns.values() {
        if decoded.offset < last_end {
            return Err(format!(
                "instrucoes sobrepostas em 0x{:06X}; delimitacao recusada",
                decoded.offset
            ));
        }
        last_end = decoded.offset + decoded.len;
    }
    for exit in exits {
        if !reached_exits.contains(exit) {
            return Err(format!(
                "saida declarada 0x{exit:06X} nao e alcancada por nenhum caminho"
            ));
        }
        if insns
            .values()
            .any(|d| d.offset < *exit && *exit < d.offset + d.len)
        {
            return Err(format!(
                "saida 0x{exit:06X} cai no meio de uma instrucao da regiao"
            ));
        }
    }
    // Aciclicidade: ordem topologica sobre as arestas internas.
    let mut indegree: BTreeMap<u32, usize> = insns.keys().map(|pc| (*pc, 0)).collect();
    for decoded in insns.values() {
        for succ in successors(decoded) {
            if let Some(count) = indegree.get_mut(&succ) {
                *count += 1;
            }
        }
    }
    let mut ready: Vec<u32> = indegree
        .iter()
        .filter(|(_, n)| **n == 0)
        .map(|(pc, _)| *pc)
        .collect();
    let mut seen = 0;
    while let Some(pc) = ready.pop() {
        seen += 1;
        for succ in successors(&insns[&pc]) {
            if let Some(count) = indegree.get_mut(&succ) {
                *count -= 1;
                if *count == 0 {
                    ready.push(succ);
                }
            }
        }
    }
    if seen != insns.len() {
        return Err("regiao contem ciclo; o perfil so aceita regioes aciclicas".to_string());
    }
    let mut blocks: Vec<(u32, u32)> = Vec::new();
    for decoded in insns.values() {
        let end = decoded.offset + decoded.len;
        match blocks.last_mut() {
            Some((_, block_end)) if *block_end == decoded.offset => *block_end = end,
            _ => blocks.push((decoded.offset, end)),
        }
    }
    Ok(Region {
        entry,
        exits: exits.to_vec(),
        insns,
        blocks,
    })
}
