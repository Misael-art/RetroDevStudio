//! Grafo editavel no formato NodeGraph v1 do produto (`version`, `nodes`, `edges`,
//! `params`), com source mapping por no e distincao entre semantica recuperada
//! (`semantic_origin`) e rotulos amigaveis (`label`, `label_origin`).
//!
//! Reabrir um grafo nao confia nos parametros: as instrucoes registradas no
//! mapping de cada no sao remontadas, a regiao e delimitada e elevada de novo,
//! e o grafo reconstruido tem de coincidir com o salvo (exceto rotulos e o
//! limiar editado, que e validado contra a faixa sem crescimento).

use std::collections::BTreeMap;

use crate::json::Json;
use crate::lift::{lift, GateRule, Operator, Outcome};
use crate::m68k::{encode, mnemonic, BranchSize, Cond, Insn};
use crate::region::{delimit, Region};
use crate::PROFILE_ID;

/// Rotulos vindos de metadados (ex.: simbolos do ELF) — nunca semantica.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Hints {
    pub address_names: BTreeMap<u32, String>,
    pub origin: String,
}

fn hex(value: u32) -> Json {
    Json::str(format!("0x{value:06X}"))
}

fn parse_hex(text: &str) -> Result<u32, String> {
    let digits = text
        .strip_prefix("0x")
        .ok_or_else(|| format!("hex esperado com prefixo 0x: {text}"))?;
    u32::from_str_radix(digits, 16).map_err(|_| format!("hex invalido: {text}"))
}

fn size_name(size: BranchSize) -> &'static str {
    match size {
        BranchSize::Short => "s",
        BranchSize::Word => "w",
    }
}

pub fn insn_to_json(insn: &Insn) -> Json {
    let i = |v: u8| Json::Int(v as i64);
    match insn {
        Insn::MoveLAbsToD { abs, d } => Json::obj(vec![
            ("op", Json::str("move.l abs,dn")),
            ("abs", hex(*abs)),
            ("d", i(*d)),
        ]),
        Insn::MoveLDToAbs { d, abs } => Json::obj(vec![
            ("op", Json::str("move.l dn,abs")),
            ("d", i(*d)),
            ("abs", hex(*abs)),
        ]),
        Insn::AddqLD { q, d } => Json::obj(vec![
            ("op", Json::str("addq.l #q,dn")),
            ("q", i(*q)),
            ("d", i(*d)),
        ]),
        Insn::AddqLSp { q } => Json::obj(vec![("op", Json::str("addq.l #q,sp")), ("q", i(*q))]),
        Insn::Moveq { imm, d } => Json::obj(vec![
            ("op", Json::str("moveq")),
            ("imm", Json::Int(*imm as i64)),
            ("d", i(*d)),
        ]),
        Insn::CmpLDD { src, dst } => Json::obj(vec![
            ("op", Json::str("cmp.l dn,dn")),
            ("src", i(*src)),
            ("dst", i(*dst)),
        ]),
        Insn::BtstImmD { bit, d } => Json::obj(vec![
            ("op", Json::str("btst #n,dn")),
            ("bit", i(*bit)),
            ("d", i(*d)),
        ]),
        Insn::Bcc { cond, target, size } => Json::obj(vec![
            ("op", Json::str("bcc")),
            ("cond", Json::str(cond.name())),
            ("target", hex(*target)),
            ("size", Json::str(size_name(*size))),
        ]),
        Insn::Bra { target, size } => Json::obj(vec![
            ("op", Json::str("bra")),
            ("target", hex(*target)),
            ("size", Json::str(size_name(*size))),
        ]),
        Insn::PeaAbsW { abs } => Json::obj(vec![
            ("op", Json::str("pea abs.w")),
            ("abs", Json::Int(*abs as i64)),
        ]),
        Insn::MoveLAbsToPush { abs } => Json::obj(vec![
            ("op", Json::str("move.l abs,-(sp)")),
            ("abs", hex(*abs)),
        ]),
        Insn::JsrAbsL { target } => Json::obj(vec![
            ("op", Json::str("jsr abs.l")),
            ("target", hex(*target)),
        ]),
    }
}

pub fn insn_from_json(value: &Json) -> Result<Insn, String> {
    let reg = |key: &str| -> Result<u8, String> {
        let v = value.i64_at(key)?;
        u8::try_from(v)
            .ok()
            .filter(|r| *r < 8)
            .ok_or_else(|| format!("{key} fora de 0..=7"))
    };
    let small = |key: &str, max: i64| -> Result<u8, String> {
        let v = value.i64_at(key)?;
        if (0..=max).contains(&v) {
            Ok(v as u8)
        } else {
            Err(format!("{key} fora de 0..={max}"))
        }
    };
    let size = || -> Result<BranchSize, String> {
        match value.str_at("size")? {
            "s" => Ok(BranchSize::Short),
            "w" => Ok(BranchSize::Word),
            other => Err(format!("tamanho de desvio invalido: {other}")),
        }
    };
    let addr = |key: &str| parse_hex(value.str_at(key)?);
    Ok(match value.str_at("op")? {
        "move.l abs,dn" => Insn::MoveLAbsToD {
            abs: addr("abs")?,
            d: reg("d")?,
        },
        "move.l dn,abs" => Insn::MoveLDToAbs {
            d: reg("d")?,
            abs: addr("abs")?,
        },
        "addq.l #q,dn" => Insn::AddqLD {
            q: small("q", 8)?,
            d: reg("d")?,
        },
        "addq.l #q,sp" => Insn::AddqLSp { q: small("q", 8)? },
        "moveq" => Insn::Moveq {
            imm: i8::try_from(value.i64_at("imm")?).map_err(|_| "imm do MOVEQ fora de i8")?,
            d: reg("d")?,
        },
        "cmp.l dn,dn" => Insn::CmpLDD {
            src: reg("src")?,
            dst: reg("dst")?,
        },
        "btst #n,dn" => Insn::BtstImmD {
            bit: small("bit", 31)?,
            d: reg("d")?,
        },
        "bcc" => Insn::Bcc {
            cond: Cond::from_name(value.str_at("cond")?).ok_or("condicao invalida")?,
            target: addr("target")?,
            size: size()?,
        },
        "bra" => Insn::Bra {
            target: addr("target")?,
            size: size()?,
        },
        "pea abs.w" => Insn::PeaAbsW {
            abs: i16::try_from(value.i64_at("abs")?).map_err(|_| "PEA fora de i16")?,
        },
        "move.l abs,-(sp)" => Insn::MoveLAbsToPush { abs: addr("abs")? },
        "jsr abs.l" => Insn::JsrAbsL {
            target: addr("target")?,
        },
        other => {
            return Err(format!(
                "operacao '{other}' fora do subconjunto; grafo recusado"
            ))
        }
    })
}

fn mappings(region: &Region, offsets: &[u32], rom: &[u8]) -> Json {
    Json::Arr(
        offsets
            .iter()
            .map(|at| {
                let decoded = &region.insns[at];
                let start = decoded.offset as usize;
                let bytes: String = rom[start..start + decoded.len as usize]
                    .iter()
                    .map(|b| format!("{b:02X}"))
                    .collect();
                Json::obj(vec![
                    ("rom_start", hex(decoded.offset)),
                    ("rom_end", hex(decoded.offset + decoded.len)),
                    ("bytes", Json::str(bytes)),
                    ("mnemonic", Json::str(mnemonic(&decoded.insn))),
                    ("insn", insn_to_json(&decoded.insn)),
                ])
            })
            .collect(),
    )
}

struct Builder<'a> {
    region: &'a Region,
    rom: &'a [u8],
    hints: &'a Hints,
    nodes: Vec<Json>,
    edges: Vec<Json>,
}

impl Builder<'_> {
    fn addr_label(&self, addr: u32) -> Json {
        self.hints
            .address_names
            .get(&addr)
            .map(|name| Json::str(name.clone()))
            .unwrap_or(Json::Null)
    }

    fn node(
        &mut self,
        id: &str,
        kind: &str,
        label: &str,
        at: &[u32],
        mut params: Vec<(&str, Json)>,
    ) {
        params.insert(0, ("semantic_origin", Json::str("recovered_from_rom")));
        params.push(("source_mappings", mappings(self.region, at, self.rom)));
        let y = 120 + 110 * (self.nodes.len() as i64 % 4);
        let x = 40 + 260 * (self.nodes.len() as i64 / 4);
        self.nodes.push(Json::obj(vec![
            ("id", Json::str(id)),
            ("type", Json::str(kind)),
            ("label", Json::str(label)),
            ("label_origin", Json::str("profile_default")),
            ("x", Json::Int(x)),
            ("y", Json::Int(y)),
            ("params", Json::obj(params)),
        ]));
    }

    fn edge(&mut self, from: &str, port: &str, to: &str) {
        self.edges.push(Json::obj(vec![
            ("id", Json::str(format!("{from}_{port}_{to}"))),
            ("fromNode", Json::str(from)),
            ("fromPort", Json::str(port)),
            ("toNode", Json::str(to)),
            ("toPort", Json::str("exec")),
        ]));
    }

    fn outcome(&mut self, prefix: &str, outcome: &Outcome, label: &str) {
        let call_at: Vec<u32> = outcome
            .call
            .as_ref()
            .map(|c| c.at.clone())
            .unwrap_or_default();
        let write_at: Vec<u32> = outcome
            .at
            .iter()
            .copied()
            .filter(|a| !call_at.contains(a))
            .collect();
        let write_id = format!("{prefix}_write");
        self.node(
            &write_id,
            "rom_state_write",
            label,
            &write_at,
            vec![
                ("address", hex(outcome.state_addr)),
                ("address_label", self.addr_label(outcome.state_addr)),
                ("value", Json::Int(outcome.value as i64)),
                ("width_bits", Json::Int(32)),
            ],
        );
        let exit_id = format!("exit_{:06X}", outcome.exit);
        if let Some(call) = &outcome.call {
            let call_id = format!("{prefix}_call");
            self.node(
                &call_id,
                "rom_external_call",
                "External call (not recovered)",
                &call_at,
                vec![
                    ("target", hex(call.target)),
                    (
                        "args",
                        Json::Arr(vec![
                            Json::obj(vec![
                                ("kind", Json::str("long_from_memory")),
                                ("address", hex(call.pointer_arg_addr)),
                                ("address_label", self.addr_label(call.pointer_arg_addr)),
                            ]),
                            Json::obj(vec![
                                ("kind", Json::str("immediate_long")),
                                ("value", Json::Int(call.immediate_arg as i64)),
                            ]),
                        ]),
                    ),
                    ("understood", Json::Bool(false)),
                    ("clobbers", Json::str("D0,D1,A0,A1,CCR (ABI m68k-elf-gcc)")),
                ],
            );
            self.edge(&write_id, "exec", &call_id);
            self.edge(&call_id, "exec", &exit_id);
        } else {
            self.edge(&write_id, "exec", &exit_id);
        }
    }
}

pub struct GraphInput<'a> {
    pub rom: &'a [u8],
    pub rom_sha256: &'a str,
    pub region: &'a Region,
    pub rule: &'a GateRule,
    pub hints: &'a Hints,
    pub threshold: i64,
}

pub fn build_graph(input: &GraphInput) -> Json {
    let GraphInput {
        rom,
        rom_sha256,
        region,
        rule,
        hints,
        threshold,
    } = *input;
    let mut b = Builder {
        region,
        rom,
        hints,
        nodes: Vec::new(),
        edges: Vec::new(),
    };
    b.node(
        "entry",
        "rom_region_entry",
        "Recovered region entry",
        &[],
        vec![("address", hex(region.entry))],
    );
    let mut prev = "entry".to_string();
    let mut prev_port = "exec";
    if let Some(guard) = &rule.guard {
        b.node(
            "guard",
            "rom_input_bit_guard",
            "Input bit guard",
            &guard.at,
            vec![
                ("register", Json::str(format!("D{}", guard.reg))),
                ("bit", Json::Int(guard.bit as i64)),
                ("skip_exit", hex(guard.skip_exit)),
            ],
        );
        b.edge(&prev, prev_port, "guard");
        b.edge("guard", "false", &format!("exit_{:06X}", guard.skip_exit));
        prev = "guard".to_string();
        prev_port = "true";
    }
    if let Some(add) = &rule.counter_add {
        b.node(
            "counter_add",
            "rom_counter_add",
            "Counter += step",
            &add.at,
            vec![
                ("address", hex(add.addr)),
                ("address_label", b.addr_label(add.addr)),
                ("step", Json::Int(add.step as i64)),
                ("width_bits", Json::Int(32)),
                ("signedness", Json::str("two-complement wrapping")),
            ],
        );
        b.edge(&prev, prev_port, "counter_add");
        prev = "counter_add".to_string();
        prev_port = "exec";
    }
    let (min, max) = rule.compare.editable_range();
    let mut compare_at = vec![rule.read_at];
    compare_at.extend(&rule.compare.at);
    b.node(
        "compare",
        "rom_counter_compare",
        "Counter threshold",
        &compare_at,
        vec![
            ("address", hex(rule.compare.counter_addr)),
            ("address_label", b.addr_label(rule.compare.counter_addr)),
            ("operator", Json::str(rule.compare.operator.symbol())),
            ("threshold", Json::Int(threshold)),
            (
                "recovered_threshold",
                Json::Int(rule.compare.k as i64 + rule.compare.bias),
            ),
            ("threshold_min", Json::Int(min)),
            ("threshold_max", Json::Int(max)),
            ("width_bits", Json::Int(32)),
            ("signed", Json::Bool(true)),
            ("editable", Json::str("threshold")),
            (
                "lowering",
                Json::str(format!(
                    "MOVEQ #(threshold-{}) ; CMP.L ; B{} ({} = set branch)",
                    rule.compare.bias,
                    rule.compare.cond.name().to_uppercase(),
                    if rule.compare.set_is_taken {
                        "taken"
                    } else {
                        "fall-through"
                    }
                )),
            ),
        ],
    );
    b.edge(&prev, prev_port, "compare");
    b.edge("compare", "true", "set_write");
    b.edge("compare", "false", "other_write");
    b.outcome("set", &rule.set, "Write state when rule holds");
    b.outcome("other", &rule.other, "Write state when rule fails");
    for exit in &region.exits {
        b.node(
            &format!("exit_{exit:06X}"),
            "rom_region_exit",
            "Region exit",
            &[],
            vec![("address", hex(*exit))],
        );
    }
    let blocks = Json::Arr(
        region
            .blocks
            .iter()
            .map(|(s, e)| Json::obj(vec![("rom_start", hex(*s)), ("rom_end", hex(*e))]))
            .collect(),
    );
    Json::obj(vec![
        ("version", Json::Int(1)),
        (
            "rex_gameplay",
            Json::obj(vec![
                ("profile_id", Json::str(PROFILE_ID)),
                ("rom_sha256", Json::str(rom_sha256)),
                ("entry", hex(region.entry)),
                (
                    "exits",
                    Json::Arr(region.exits.iter().map(|e| hex(*e)).collect()),
                ),
                ("blocks", blocks),
                ("localization", Json::str("declared-by-caller")),
                ("label_hints_origin", Json::str(hints.origin.clone())),
            ]),
        ),
        ("nodes", Json::Arr(b.nodes)),
        ("edges", Json::Arr(b.edges)),
    ])
}

/// Grafo reaberto e validado.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenedGraph {
    pub rom_sha256: String,
    pub region: Region,
    pub rule: GateRule,
    /// Limiar pedido no no `compare` (pode diferir do recuperado).
    pub threshold: i64,
    /// Instrucoes registradas, por offset, como salvas.
    pub records: BTreeMap<u32, Insn>,
    /// Imagem dos bytes originais registrados nos mappings.
    pub recorded_bytes: BTreeMap<u32, Vec<u8>>,
}

fn strip_labels(value: &Json) -> Json {
    match value {
        Json::Obj(fields) => Json::Obj(
            fields
                .iter()
                .filter(|(k, _)| {
                    !k.starts_with("label") && k != "address_label" && k != "x" && k != "y"
                })
                .map(|(k, v)| (k.clone(), strip_labels(v)))
                .collect(),
        ),
        Json::Arr(items) => Json::Arr(items.iter().map(strip_labels).collect()),
        other => other.clone(),
    }
}

fn set_threshold(graph: &mut Json, threshold: i64) {
    if let Json::Obj(fields) = graph {
        for (key, value) in fields.iter_mut() {
            if key == "nodes" {
                if let Json::Arr(nodes) = value {
                    for node in nodes.iter_mut() {
                        if node.get("id") == Some(&Json::str("compare")) {
                            if let Json::Obj(nf) = node {
                                for (nk, nv) in nf.iter_mut() {
                                    if nk == "params" {
                                        if let Json::Obj(pf) = nv {
                                            for (pk, pv) in pf.iter_mut() {
                                                if pk == "threshold" {
                                                    *pv = Json::Int(threshold);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/// Muda o limiar de um grafo salvo (a edicao permitida pelo perfil), validando a faixa.
pub fn edit_threshold(graph_text: &str, threshold: i64) -> Result<String, String> {
    let opened = open_graph(graph_text)?;
    let (min, max) = opened.rule.compare.editable_range();
    if !(min..=max).contains(&threshold) {
        return Err(format!(
            "limiar {threshold} fora de {min}..={max}: nao cabe no MOVEQ original e o perfil nao tem estrategia de crescimento; edicao recusada"
        ));
    }
    let mut graph = Json::parse(graph_text)?;
    set_threshold(&mut graph, threshold);
    Ok(graph.pretty())
}

pub fn open_graph(text: &str) -> Result<OpenedGraph, String> {
    let graph = Json::parse(text)?;
    if graph.i64_at("version")? != 1 {
        return Err("versao de grafo nao suportada".to_string());
    }
    let meta = graph.field("rex_gameplay")?;
    if meta.str_at("profile_id")? != PROFILE_ID {
        return Err(format!(
            "perfil '{}' diferente de {PROFILE_ID}",
            meta.str_at("profile_id")?
        ));
    }
    let rom_sha256 = meta.str_at("rom_sha256")?.to_string();
    let entry = parse_hex(meta.str_at("entry")?)?;
    let exits = meta
        .field("exits")?
        .as_arr()?
        .iter()
        .map(|e| parse_hex(e.as_str()?))
        .collect::<Result<Vec<u32>, String>>()?;
    let mut records = BTreeMap::new();
    let mut recorded_bytes = BTreeMap::new();
    let mut threshold = None;
    for node in graph.field("nodes")?.as_arr()? {
        let params = node.field("params")?;
        if params.str_at("semantic_origin")? != "recovered_from_rom" {
            return Err("no sem semantic_origin=recovered_from_rom".to_string());
        }
        if node.str_at("id")? == "compare" {
            threshold = Some(params.i64_at("threshold")?);
        }
        for mapping in params.field("source_mappings")?.as_arr()? {
            let start = parse_hex(mapping.str_at("rom_start")?)?;
            let end = parse_hex(mapping.str_at("rom_end")?)?;
            let insn = insn_from_json(mapping.field("insn")?)?;
            let bytes = encode(&insn, start)?;
            if start as usize + bytes.len() != end as usize {
                return Err(format!("mapping 0x{start:06X} com tamanho inconsistente"));
            }
            let recorded = mapping.str_at("bytes")?;
            let encoded: String = bytes.iter().map(|b| format!("{b:02X}")).collect();
            if recorded != encoded {
                return Err(format!("mapping 0x{start:06X}: bytes registrados {recorded} nao correspondem a operacao ({encoded})"));
            }
            if records.insert(start, insn).is_some() {
                return Err(format!("offset 0x{start:06X} mapeado por mais de um no"));
            }
            recorded_bytes.insert(start, bytes);
        }
    }
    let threshold = threshold.ok_or("no 'compare' ausente")?;
    let top = recorded_bytes
        .iter()
        .map(|(s, b)| *s as usize + b.len())
        .max()
        .unwrap_or(0);
    let mut image = vec![0u8; top.max(exits.iter().copied().max().unwrap_or(0) as usize + 2)];
    for (start, bytes) in &recorded_bytes {
        image[*start as usize..*start as usize + bytes.len()].copy_from_slice(bytes);
    }
    let region = delimit(&image, entry, &exits)?;
    if region.insns.len() != records.len() {
        return Err("o grafo mapeia instrucoes fora do fluxo delimitado".to_string());
    }
    let rule = lift(&region)?;
    let (min, max) = rule.compare.editable_range();
    if !(min..=max).contains(&threshold) {
        return Err(format!(
            "limiar {threshold} fora de {min}..={max}; grafo recusado"
        ));
    }
    let rebuilt = build_graph(&GraphInput {
        rom: &image,
        rom_sha256: &rom_sha256,
        region: &region,
        rule: &rule,
        hints: &Hints::default(),
        threshold,
    });
    if strip_labels(&rebuilt) != strip_labels(&graph) {
        return Err("grafo inconsistente com as instrucoes mapeadas (operacao, parametro, conexao ou mapping alterado); reabertura recusada".to_string());
    }
    Ok(OpenedGraph {
        rom_sha256,
        region,
        rule,
        threshold,
        records,
        recorded_bytes,
    })
}

/// Operador da regra do grafo aberto (apresentacao).
pub fn operator_of(opened: &OpenedGraph) -> Operator {
    opened.rule.compare.operator
}
