//! Emissao da regiao a partir da regra semantica (`GateRule`).
//!
//! Cada instrucao emitida tem os operandos tirados de campos da regra e so o
//! *layout* (offset, tamanho de desvio `.S`/`.W`) tirado do registro mapeado.
//! A funcao nao recebe a ROM-base: nenhum byte da regiao e copiado dela.
//!
//! Origem de cada operando (`Field::source`):
//! * `semantic:*`  — parametro semantico exposto nos nos do grafo;
//! * `alloc:*`     — alocacao de registradores recuperada (nao editavel);
//! * `layout:*`    — offset/tamanho de desvio do registro mapeado;
//! * `fixed:*`     — constante do proprio perfil (ex.: `ADDQ.L #8,SP`).

use std::collections::BTreeMap;

use crate::lift::{GateRule, Outcome};
use crate::m68k::{encode, BranchSize, Cond, Insn};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Emitted {
    pub offset: u32,
    pub node: &'static str,
    pub insn: Insn,
    pub bytes: Vec<u8>,
    /// Campos que determinam esta instrucao, com a origem de cada um.
    pub fields: Vec<(&'static str, &'static str)>,
}

fn branch_size(layout: &BTreeMap<u32, Insn>, at: u32) -> Result<BranchSize, String> {
    match layout.get(&at) {
        Some(Insn::Bcc { size, .. }) | Some(Insn::Bra { size, .. }) => Ok(*size),
        other => Err(format!(
            "layout em 0x{at:06X} nao e desvio ({other:?}); emissao recusada"
        )),
    }
}

fn push(
    out: &mut Vec<Emitted>,
    offset: u32,
    node: &'static str,
    insn: Insn,
    fields: &[(&'static str, &'static str)],
) -> Result<(), String> {
    let bytes = encode(&insn, offset)?;
    out.push(Emitted {
        offset,
        node,
        insn,
        bytes,
        fields: fields.to_vec(),
    });
    Ok(())
}

fn emit_outcome(
    out: &mut Vec<Emitted>,
    node: &'static str,
    outcome: &Outcome,
    layout: &BTreeMap<u32, Insn>,
) -> Result<(), String> {
    let at = &outcome.at;
    push(
        out,
        at[0],
        node,
        Insn::Moveq {
            imm: outcome.value,
            d: outcome.value_reg,
        },
        &[
            ("value", "semantic:state_write.value"),
            ("reg", "alloc:value_reg"),
        ],
    )?;
    push(
        out,
        at[1],
        node,
        Insn::MoveLDToAbs {
            d: outcome.value_reg,
            abs: outcome.state_addr,
        },
        &[
            ("abs", "semantic:state_write.address"),
            ("reg", "alloc:value_reg"),
        ],
    )?;
    let mut used = 2;
    if let Some(call) = &outcome.call {
        let call_fields: [(&[(&'static str, &'static str)], Insn); 4] = [
            (
                &[("abs", "semantic:external_call.immediate_arg")],
                Insn::PeaAbsW {
                    abs: call.immediate_arg,
                },
            ),
            (
                &[("abs", "semantic:external_call.pointer_arg")],
                Insn::MoveLAbsToPush {
                    abs: call.pointer_arg_addr,
                },
            ),
            (
                &[("target", "semantic:external_call.target")],
                Insn::JsrAbsL {
                    target: call.target,
                },
            ),
            (&[("q", "fixed:stack_cleanup_8")], Insn::AddqLSp { q: 8 }),
        ];
        for ((fields, insn), offset) in call_fields.into_iter().zip(&call.at) {
            push(out, *offset, "external_call", insn, fields)?;
        }
        used += 4;
    }
    if at.len() == used + 1 {
        let bra_at = at[used];
        push(
            out,
            bra_at,
            node,
            Insn::Bra {
                target: outcome.exit,
                size: branch_size(layout, bra_at)?,
            },
            &[
                ("target", "semantic:region_exit"),
                ("size", "layout:branch_size"),
            ],
        )?;
    } else if at.len() != used {
        return Err("bloco de resultado com instrucoes nao explicadas".to_string());
    }
    Ok(())
}

/// Emite todas as instrucoes da regiao a partir de `rule`. `layout` so fornece
/// o tamanho de cada desvio; offsets vem de `rule` (`at`), operandos de `rule`.
pub fn emit_region(rule: &GateRule, layout: &BTreeMap<u32, Insn>) -> Result<Vec<Emitted>, String> {
    let mut out = Vec::new();
    if let Some(guard) = &rule.guard {
        push(
            &mut out,
            guard.at[0],
            "input_guard",
            Insn::BtstImmD {
                bit: guard.bit,
                d: guard.reg,
            },
            &[
                ("bit", "semantic:input_guard.bit"),
                ("reg", "alloc:input_reg"),
            ],
        )?;
        push(
            &mut out,
            guard.at[1],
            "input_guard",
            Insn::Bcc {
                cond: Cond::Eq,
                target: guard.skip_exit,
                size: branch_size(layout, guard.at[1])?,
            },
            &[
                ("target", "semantic:region_exit"),
                ("size", "layout:branch_size"),
            ],
        )?;
    }
    let c = &rule.compare;
    if let Some(add) = &rule.counter_add {
        push(
            &mut out,
            add.at[0],
            "counter_add",
            Insn::MoveLAbsToD {
                abs: add.addr,
                d: add.reg,
            },
            &[
                ("abs", "semantic:counter.address"),
                ("reg", "alloc:counter_reg"),
            ],
        )?;
        push(
            &mut out,
            add.at[1],
            "counter_add",
            Insn::AddqLD {
                q: add.step,
                d: add.reg,
            },
            &[
                ("q", "semantic:counter_add.step"),
                ("reg", "alloc:counter_reg"),
            ],
        )?;
        push(
            &mut out,
            add.at[2],
            "counter_add",
            Insn::MoveLDToAbs {
                d: add.reg,
                abs: add.addr,
            },
            &[
                ("abs", "semantic:counter.address"),
                ("reg", "alloc:counter_reg"),
            ],
        )?;
    }
    push(
        &mut out,
        rule.read_at,
        "compare",
        Insn::MoveLAbsToD {
            abs: c.counter_addr,
            d: c.counter_reg,
        },
        &[
            ("abs", "semantic:counter.address"),
            ("reg", "alloc:counter_reg"),
        ],
    )?;
    let k = c.threshold - c.bias;
    if !(i8::MIN as i64..=i8::MAX as i64).contains(&k) {
        return Err(format!(
            "limiar {} nao cabe no MOVEQ; recusado",
            c.threshold
        ));
    }
    push(
        &mut out,
        c.at[0],
        "compare",
        Insn::Moveq {
            imm: k as i8,
            d: c.k_reg,
        },
        &[
            ("imm", "semantic:compare.threshold"),
            ("reg", "alloc:threshold_reg"),
        ],
    )?;
    let (src, dst) = if c.k_minus_counter {
        (c.counter_reg, c.k_reg)
    } else {
        (c.k_reg, c.counter_reg)
    };
    push(
        &mut out,
        c.at[1],
        "compare",
        Insn::CmpLDD { src, dst },
        &[
            ("order", "semantic:compare.operator"),
            ("reg", "alloc:counter_reg+threshold_reg"),
        ],
    )?;
    let taken_start = if c.set_is_taken {
        rule.set.at[0]
    } else {
        rule.other.at[0]
    };
    push(
        &mut out,
        c.branch_at,
        "compare",
        Insn::Bcc {
            cond: c.cond,
            target: taken_start,
            size: branch_size(layout, c.branch_at)?,
        },
        &[
            ("cond", "semantic:compare.operator"),
            ("target", "semantic:edge compare->state_write(polaridade)"),
            ("size", "layout:branch_size"),
        ],
    )?;
    emit_outcome(&mut out, "state_write_set", &rule.set, layout)?;
    emit_outcome(&mut out, "state_write_other", &rule.other, layout)?;
    out.sort_by_key(|e| e.offset);
    Ok(out)
}

/// Rule com o limiar trocado: e so esse campo que a edicao do perfil altera.
pub fn with_threshold(rule: &GateRule, threshold: i64) -> GateRule {
    let mut edited = rule.clone();
    edited.compare.threshold = threshold;
    edited.compare.k = (threshold - edited.compare.bias) as i8;
    edited
}
