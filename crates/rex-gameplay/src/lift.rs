//! Elevacao de uma regiao delimitada para a regra semantica do perfil
//! `m68k.counter_threshold_state_gate.v1`:
//!
//! ```text
//! [guarda: BTST #b,Dk ; BEQ saida]                 (opcional)
//! [contador: MOVE.L C,Dx ; ADDQ.L #q,Dx ; MOVE.L Dx,C] (opcional)
//! leitura:   MOVE.L C,Dx
//! limiar:    MOVEQ #K,Dy ; CMP.L Dx,Dy | CMP.L Dy,Dx ; Bcc
//! resultado: dois blocos, cada um MOVEQ #v,Dz ; MOVE.L Dz,G
//!            [+ PEA #w.W ; MOVE.L P,-(SP) ; JSR T ; ADDQ.L #8,SP]
//!            terminando numa saida declarada (fall-through ou BRA)
//! ```
//!
//! Qualquer outra forma e recusada com o motivo; nada e completado por palpite.

use crate::m68k::{Cond, Decoded, Insn};
use crate::region::Region;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Guard {
    pub reg: u8,
    pub bit: u8,
    pub skip_exit: u32,
    pub at: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CounterAdd {
    pub addr: u32,
    pub step: u8,
    pub reg: u8,
    pub at: Vec<u32>,
}

/// Operador normalizado da regra: o bloco "set" executa quando `contador OP limiar`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Operator {
    Ge,
    Lt,
    Eq,
    Ne,
}

impl Operator {
    pub fn symbol(self) -> &'static str {
        match self {
            Operator::Ge => ">=",
            Operator::Lt => "<",
            Operator::Eq => "==",
            Operator::Ne => "!=",
        }
    }

    pub fn from_symbol(text: &str) -> Option<Operator> {
        [Operator::Ge, Operator::Lt, Operator::Eq, Operator::Ne]
            .into_iter()
            .find(|op| op.symbol() == text)
    }

    pub fn holds(self, value: i32, threshold: i64) -> bool {
        let value = value as i64;
        match self {
            Operator::Ge => value >= threshold,
            Operator::Lt => value < threshold,
            Operator::Eq => value == threshold,
            Operator::Ne => value != threshold,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Compare {
    pub counter_addr: u32,
    pub counter_reg: u8,
    pub k: i8,
    pub k_reg: u8,
    pub k_at: u32,
    pub cond: Cond,
    /// `true` quando o CMP calcula K - contador (CMP.L Dx,Dy com Dy=K).
    pub k_minus_counter: bool,
    pub operator: Operator,
    /// Limiar apresentado; `k = threshold - bias`.
    pub threshold: i64,
    pub bias: i64,
    pub at: Vec<u32>,
    pub branch_at: u32,
    /// `true` quando o bloco "set" e o alvo do desvio (ramo tomado).
    pub set_is_taken: bool,
}

impl Compare {
    /// Faixa editavel: `K` precisa caber no MOVEQ original (sem crescimento).
    pub fn editable_range(&self) -> (i64, i64) {
        (i8::MIN as i64 + self.bias, i8::MAX as i64 + self.bias)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalCall {
    pub target: u32,
    pub immediate_arg: i16,
    pub pointer_arg_addr: u32,
    pub at: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Outcome {
    pub state_addr: u32,
    pub value: i8,
    pub value_reg: u8,
    pub call: Option<ExternalCall>,
    pub exit: u32,
    pub at: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GateRule {
    pub guard: Option<Guard>,
    pub counter_add: Option<CounterAdd>,
    pub read_at: u32,
    pub compare: Compare,
    /// Bloco executado quando a regra vale.
    pub set: Outcome,
    /// Bloco executado quando a regra nao vale.
    pub other: Outcome,
}

struct Cursor<'a> {
    region: &'a Region,
    pc: u32,
}

impl<'a> Cursor<'a> {
    fn peek(&self) -> Option<&'a Decoded> {
        self.region.at(self.pc)
    }

    fn take(&mut self, what: &str) -> Result<&'a Decoded, String> {
        let decoded = self
            .peek()
            .ok_or_else(|| format!("esperado {what} em 0x{:06X}; fim de caminho", self.pc))?;
        self.pc += decoded.len;
        Ok(decoded)
    }

    fn refuse<T>(&self, decoded: &Decoded, what: &str) -> Result<T, String> {
        Err(format!(
            "estrutura fora do perfil em 0x{:06X}: esperado {what}, observado {}",
            decoded.offset,
            crate::m68k::mnemonic(&decoded.insn)
        ))
    }
}

fn lift_outcome(region: &Region, start: u32) -> Result<Outcome, String> {
    let mut cur = Cursor { region, pc: start };
    let mut at = Vec::new();
    let first = cur.take("MOVEQ #v,Dz")?;
    let Insn::Moveq {
        imm: value,
        d: value_reg,
    } = first.insn
    else {
        return cur.refuse(first, "MOVEQ #v,Dz");
    };
    at.push(first.offset);
    let store = cur.take("MOVE.L Dz,G")?;
    let Insn::MoveLDToAbs { d, abs: state_addr } = store.insn else {
        return cur.refuse(store, "MOVE.L Dz,G");
    };
    if d != value_reg {
        return cur.refuse(store, "MOVE.L do mesmo registrador carregado pelo MOVEQ");
    }
    at.push(store.offset);
    let mut call = None;
    if let Some(Decoded {
        insn: Insn::PeaAbsW { abs: imm },
        offset,
        ..
    }) = cur.peek()
    {
        let (imm, pea_at) = (*imm, *offset);
        cur.take("PEA")?;
        let push = cur.take("MOVE.L P,-(SP)")?;
        let Insn::MoveLAbsToPush { abs: pointer } = push.insn else {
            return cur.refuse(push, "MOVE.L P,-(SP)");
        };
        let jsr = cur.take("JSR T")?;
        let Insn::JsrAbsL { target } = jsr.insn else {
            return cur.refuse(jsr, "JSR abs.L");
        };
        let clean = cur.take("ADDQ.L #8,SP")?;
        if clean.insn != (Insn::AddqLSp { q: 8 }) {
            return cur.refuse(clean, "ADDQ.L #8,SP");
        }
        let call_at = vec![pea_at, push.offset, jsr.offset, clean.offset];
        at.extend(&call_at);
        call = Some(ExternalCall {
            target,
            immediate_arg: imm,
            pointer_arg_addr: pointer,
            at: call_at,
        });
    }
    let exit = if region.exits.contains(&cur.pc) {
        cur.pc
    } else {
        let tail = cur.take("BRA saida")?;
        match tail.insn {
            Insn::Bra { target, .. } if region.exits.contains(&target) => {
                at.push(tail.offset);
                target
            }
            _ => return cur.refuse(tail, "BRA para saida declarada ou fall-through na saida"),
        }
    };
    Ok(Outcome {
        state_addr,
        value,
        value_reg,
        call,
        exit,
        at,
    })
}

fn operator_for(cond: Cond, k_minus_counter: bool) -> Result<(Operator, bool, i64), String> {
    // Devolve (operador sobre o contador, negado?, bias) tal que o ramo tomado
    // equivale a `contador OP (K + bias)`, ja normalizado para >=, <, ==, !=.
    let raw = match (cond, k_minus_counter) {
        (Cond::Eq, _) => (Operator::Eq, false, 0),
        (Cond::Ne, _) => (Operator::Ne, false, 0),
        // K - x < 0  <=> x > K  <=> x >= K+1
        (Cond::Lt, true) => (Operator::Ge, false, 1),
        // K - x <= 0 <=> x >= K
        (Cond::Le, true) => (Operator::Ge, false, 0),
        // K - x > 0  <=> x < K
        (Cond::Gt, true) => (Operator::Lt, false, 0),
        // K - x >= 0 <=> x <= K <=> x < K+1
        (Cond::Ge, true) => (Operator::Lt, false, 1),
        (Cond::Lt, false) => (Operator::Lt, false, 0),
        (Cond::Le, false) => (Operator::Lt, false, 1),
        (Cond::Gt, false) => (Operator::Ge, false, 1),
        (Cond::Ge, false) => (Operator::Ge, false, 0),
    };
    Ok(raw)
}

fn negate(op: Operator) -> Operator {
    match op {
        Operator::Ge => Operator::Lt,
        Operator::Lt => Operator::Ge,
        Operator::Eq => Operator::Ne,
        Operator::Ne => Operator::Eq,
    }
}

pub fn lift(region: &Region) -> Result<GateRule, String> {
    let mut cur = Cursor {
        region,
        pc: region.entry,
    };
    let mut guard = None;
    if let Some(Decoded {
        insn: Insn::BtstImmD { bit, d },
        offset,
        ..
    }) = cur.peek()
    {
        let (bit, reg, btst_at) = (*bit, *d, *offset);
        cur.take("BTST")?;
        let beq = cur.take("BEQ saida")?;
        match beq.insn {
            Insn::Bcc {
                cond: Cond::Eq,
                target,
                ..
            } if region.exits.contains(&target) => {
                guard = Some(Guard {
                    reg,
                    bit,
                    skip_exit: target,
                    at: vec![btst_at, beq.offset],
                });
            }
            _ => return cur.refuse(beq, "BEQ para saida declarada apos BTST"),
        }
    }
    let first = cur.take("MOVE.L C,Dx")?;
    let Insn::MoveLAbsToD {
        abs: counter_addr,
        d: counter_reg,
    } = first.insn
    else {
        return cur.refuse(first, "MOVE.L C,Dx");
    };
    let mut counter_add = None;
    let mut read_at = first.offset;
    if let Some(Decoded {
        insn: Insn::AddqLD { q, d },
        offset,
        ..
    }) = cur.peek()
    {
        let (q, d, add_at) = (*q, *d, *offset);
        if d != counter_reg {
            return cur.refuse(cur.peek().unwrap(), "ADDQ.L no registrador do contador");
        }
        cur.take("ADDQ")?;
        let store = cur.take("MOVE.L Dx,C")?;
        if store.insn
            != (Insn::MoveLDToAbs {
                d,
                abs: counter_addr,
            })
        {
            return cur.refuse(store, "MOVE.L Dx,C de volta ao mesmo contador");
        }
        let reread = cur.take("MOVE.L C,Dx (releitura)")?;
        if reread.insn
            != (Insn::MoveLAbsToD {
                abs: counter_addr,
                d,
            })
        {
            return cur.refuse(reread, "releitura do contador gravado");
        }
        counter_add = Some(CounterAdd {
            addr: counter_addr,
            step: q,
            reg: d,
            at: vec![first.offset, add_at, store.offset],
        });
        read_at = reread.offset;
    }
    let moveq = cur.take("MOVEQ #K,Dy")?;
    let Insn::Moveq { imm: k, d: k_reg } = moveq.insn else {
        return cur.refuse(moveq, "MOVEQ #K,Dy");
    };
    if k_reg == counter_reg {
        return cur.refuse(moveq, "MOVEQ em registrador distinto do contador");
    }
    let cmp = cur.take("CMP.L")?;
    let k_minus_counter = match cmp.insn {
        Insn::CmpLDD { src, dst } if src == counter_reg && dst == k_reg => true,
        Insn::CmpLDD { src, dst } if src == k_reg && dst == counter_reg => false,
        _ => return cur.refuse(cmp, "CMP.L entre contador e limiar"),
    };
    let branch = cur.take("Bcc")?;
    let Insn::Bcc { cond, target, .. } = branch.insn else {
        return cur.refuse(branch, "Bcc");
    };
    let fall = cur.pc;
    let taken = lift_outcome(region, target)?;
    let fallthrough = lift_outcome(region, fall)?;
    if taken.state_addr != fallthrough.state_addr {
        return Err(format!(
            "os dois ramos escrevem enderecos diferentes (${:08X} / ${:08X}); fora do perfil",
            taken.state_addr, fallthrough.state_addr
        ));
    }
    if taken.value == fallthrough.value {
        return Err("os dois ramos escrevem o mesmo valor; nao ha decisao a recuperar".to_string());
    }
    // O bloco "set" e o que escreve valor nao nulo; se ambos forem nao nulos, recusa.
    let set_is_taken = match (taken.value != 0, fallthrough.value != 0) {
        (true, false) => true,
        (false, true) => false,
        _ => {
            return Err(
                "ambos os ramos escrevem valores nao nulos; perfil exige 0/nao-0".to_string(),
            )
        }
    };
    let (op, _, bias) = operator_for(cond, k_minus_counter)?;
    let operator = if set_is_taken { op } else { negate(op) };
    let (set, other) = if set_is_taken {
        (taken, fallthrough)
    } else {
        (fallthrough, taken)
    };
    Ok(GateRule {
        guard,
        counter_add,
        read_at,
        compare: Compare {
            counter_addr,
            counter_reg,
            k,
            k_reg,
            k_at: moveq.offset,
            cond,
            k_minus_counter,
            operator,
            threshold: k as i64 + bias,
            bias,
            at: vec![moveq.offset, cmp.offset, branch.offset],
            branch_at: branch.offset,
            set_is_taken,
        },
        set,
        other,
    })
}

/// Efeito observavel de uma execucao da regra (independente do interpretador de instrucoes).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuleEffect {
    pub counter_write: Option<u32>,
    pub state_write: Option<(u32, u32)>,
    pub call: Option<(u32, i16, u32)>,
}

/// Avalia a regra em nivel semantico: `input` e o registrador da guarda,
/// `counter` o valor inicial em memoria, `pointer` o valor lido pelo argumento
/// de chamada. Usa aritmetica inteira direta, nao flags.
pub fn evaluate(
    rule: &GateRule,
    threshold: i64,
    input: u32,
    counter: u32,
    pointer: u32,
) -> RuleEffect {
    if let Some(guard) = &rule.guard {
        if input & (1u32 << (guard.bit % 32)) == 0 {
            return RuleEffect {
                counter_write: None,
                state_write: None,
                call: None,
            };
        }
    }
    let mut value = counter;
    let mut counter_write = None;
    if let Some(add) = &rule.counter_add {
        value = value.wrapping_add(add.step as u32);
        counter_write = Some(value);
    }
    let outcome = if rule.compare.operator.holds(value as i32, threshold) {
        &rule.set
    } else {
        &rule.other
    };
    RuleEffect {
        counter_write,
        state_write: Some((outcome.state_addr, outcome.value as i32 as u32)),
        call: outcome
            .call
            .as_ref()
            .map(|call| (call.target, call.immediate_arg, pointer)),
    }
}
