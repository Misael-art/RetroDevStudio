//! Subconjunto M68000 do perfil: decodificacao, codificacao e execucao com flags.
//!
//! O subconjunto e fechado. Qualquer palavra fora dele e recusada com o offset
//! e o opcode observados; nada vira no-op nem e "aproximado".

use std::collections::BTreeMap;

/// Condicoes Bcc aceitas pelo perfil (comparacao assinada e igualdade).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Cond {
    Eq,
    Ne,
    Ge,
    Lt,
    Gt,
    Le,
}

impl Cond {
    fn from_code(code: u16) -> Option<Cond> {
        Some(match code {
            0x6 => Cond::Ne,
            0x7 => Cond::Eq,
            0xC => Cond::Ge,
            0xD => Cond::Lt,
            0xE => Cond::Gt,
            0xF => Cond::Le,
            _ => return None,
        })
    }

    fn code(self) -> u16 {
        match self {
            Cond::Ne => 0x6,
            Cond::Eq => 0x7,
            Cond::Ge => 0xC,
            Cond::Lt => 0xD,
            Cond::Gt => 0xE,
            Cond::Le => 0xF,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Cond::Eq => "eq",
            Cond::Ne => "ne",
            Cond::Ge => "ge",
            Cond::Lt => "lt",
            Cond::Gt => "gt",
            Cond::Le => "le",
        }
    }

    pub fn from_name(name: &str) -> Option<Cond> {
        [Cond::Eq, Cond::Ne, Cond::Ge, Cond::Lt, Cond::Gt, Cond::Le]
            .into_iter()
            .find(|cond| cond.name() == name)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BranchSize {
    Short,
    Word,
}

/// Instrucao do subconjunto. Enderecos absolutos sao valores de 24/32 bits como
/// aparecem no stream; alvos de desvio sao enderecos absolutos ja resolvidos.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Insn {
    /// `MOVE.L abs.L,Dn`
    MoveLAbsToD { abs: u32, d: u8 },
    /// `MOVE.L Dn,abs.L`
    MoveLDToAbs { d: u8, abs: u32 },
    /// `ADDQ.L #q,Dn` (q em 1..=8)
    AddqLD { q: u8, d: u8 },
    /// `MOVEQ #imm,Dn`
    Moveq { imm: i8, d: u8 },
    /// `CMP.L Ds,Dd` (calcula Dd - Ds)
    CmpLDD { src: u8, dst: u8 },
    /// `BTST #bit,Dn`
    BtstImmD { bit: u8, d: u8 },
    /// `Bcc` com condicao aceita
    Bcc {
        cond: Cond,
        target: u32,
        size: BranchSize,
    },
    /// `BRA`
    Bra { target: u32, size: BranchSize },
    /// `PEA abs.W`
    PeaAbsW { abs: i16 },
    /// `MOVE.L abs.L,-(SP)`
    MoveLAbsToPush { abs: u32 },
    /// `JSR abs.L`
    JsrAbsL { target: u32 },
    /// `ADDQ.L #q,SP`
    AddqLSp { q: u8 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Decoded {
    pub offset: u32,
    pub len: u32,
    pub insn: Insn,
}

fn word(bytes: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_be_bytes([*bytes.get(at)?, *bytes.get(at + 1)?]))
}

fn long(bytes: &[u8], at: usize) -> Option<u32> {
    Some(((word(bytes, at)? as u32) << 16) | word(bytes, at + 2)? as u32)
}

/// Decodifica uma instrucao em `offset`. `Err` descreve a recusa (fora do subconjunto
/// ou truncada); nunca devolve uma aproximacao.
pub fn decode(bytes: &[u8], offset: u32) -> Result<Decoded, String> {
    let at = offset as usize;
    let truncated = || format!("instrucao truncada em 0x{offset:06X}");
    let op = word(bytes, at).ok_or_else(truncated)?;
    let reg_hi = ((op >> 9) & 7) as u8;
    let reg_lo = (op & 7) as u8;
    let (insn, len) = match op {
        _ if op & 0xF1FF == 0x2039 => (
            Insn::MoveLAbsToD {
                abs: long(bytes, at + 2).ok_or_else(truncated)?,
                d: reg_hi,
            },
            6,
        ),
        _ if op & 0xFFF8 == 0x23C0 => (
            Insn::MoveLDToAbs {
                d: reg_lo,
                abs: long(bytes, at + 2).ok_or_else(truncated)?,
            },
            6,
        ),
        _ if op & 0xF1F8 == 0x5080 => (
            Insn::AddqLD {
                q: if reg_hi == 0 { 8 } else { reg_hi },
                d: reg_lo,
            },
            2,
        ),
        _ if op & 0xF1FF == 0x508F => (
            Insn::AddqLSp {
                q: if reg_hi == 0 { 8 } else { reg_hi },
            },
            2,
        ),
        _ if op & 0xF100 == 0x7000 => (
            Insn::Moveq {
                imm: op as u8 as i8,
                d: reg_hi,
            },
            2,
        ),
        _ if op & 0xF1F8 == 0xB080 => (
            Insn::CmpLDD {
                src: reg_lo,
                dst: reg_hi,
            },
            2,
        ),
        _ if op & 0xFFF8 == 0x0800 => {
            let ext = word(bytes, at + 2).ok_or_else(truncated)?;
            if ext > 31 {
                return Err(format!(
                    "BTST em 0x{offset:06X} com extensao 0x{ext:04X} fora do contrato"
                ));
            }
            (
                Insn::BtstImmD {
                    bit: ext as u8,
                    d: reg_lo,
                },
                4,
            )
        }
        0x4878 => (
            Insn::PeaAbsW {
                abs: word(bytes, at + 2).ok_or_else(truncated)? as i16,
            },
            4,
        ),
        0x2F39 => (
            Insn::MoveLAbsToPush {
                abs: long(bytes, at + 2).ok_or_else(truncated)?,
            },
            6,
        ),
        0x4EB9 => (
            Insn::JsrAbsL {
                target: long(bytes, at + 2).ok_or_else(truncated)?,
            },
            6,
        ),
        _ if op & 0xF000 == 0x6000 => {
            let code = (op >> 8) & 0xF;
            let disp8 = op as u8;
            let (disp, size, len) = match disp8 {
                0x00 => (
                    word(bytes, at + 2).ok_or_else(truncated)? as i16 as i32,
                    BranchSize::Word,
                    4,
                ),
                0xFF => {
                    return Err(format!(
                        "Bcc.L (68020+) em 0x{offset:06X} fora do contrato 68000"
                    ))
                }
                _ => (disp8 as i8 as i32, BranchSize::Short, 2),
            };
            let target = (offset as i64 + 2 + disp as i64) as u32;
            match code {
                0x0 => (Insn::Bra { target, size }, len),
                0x1 => return Err(format!("BSR em 0x{offset:06X} fora do contrato")),
                _ => match Cond::from_code(code) {
                    Some(cond) => (Insn::Bcc { cond, target, size }, len),
                    None => {
                        return Err(format!(
                            "Bcc com condicao 0x{code:X} em 0x{offset:06X} fora do contrato (so eq/ne/ge/lt/gt/le)"
                        ))
                    }
                },
            }
        }
        _ => {
            return Err(format!(
                "opcode 0x{op:04X} em 0x{offset:06X} fora do subconjunto do perfil; recuperacao recusada"
            ))
        }
    };
    if at + len > bytes.len() {
        return Err(truncated());
    }
    Ok(Decoded {
        offset,
        len: len as u32,
        insn,
    })
}

/// Codifica uma instrucao para o endereco `offset` (necessario para desvios relativos).
/// Recusa quando o operando nao cabe na forma original (sem crescimento silencioso).
pub fn encode(insn: &Insn, offset: u32) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let push_w = |out: &mut Vec<u8>, w: u16| out.extend_from_slice(&w.to_be_bytes());
    let check_reg = |reg: u8| {
        if reg < 8 {
            Ok(reg as u16)
        } else {
            Err(format!("registrador D{reg} invalido"))
        }
    };
    let check_q = |q: u8| {
        if (1..=8).contains(&q) {
            Ok((q & 7) as u16)
        } else {
            Err(format!("ADDQ #{q} fora de 1..=8"))
        }
    };
    match insn {
        Insn::MoveLAbsToD { abs, d } => {
            push_w(&mut out, 0x2039 | (check_reg(*d)? << 9));
            out.extend_from_slice(&abs.to_be_bytes());
        }
        Insn::MoveLDToAbs { d, abs } => {
            push_w(&mut out, 0x23C0 | check_reg(*d)?);
            out.extend_from_slice(&abs.to_be_bytes());
        }
        Insn::AddqLD { q, d } => push_w(&mut out, 0x5080 | (check_q(*q)? << 9) | check_reg(*d)?),
        Insn::AddqLSp { q } => push_w(&mut out, 0x508F | (check_q(*q)? << 9)),
        Insn::Moveq { imm, d } => push_w(
            &mut out,
            0x7000 | (check_reg(*d)? << 9) | (*imm as u8 as u16),
        ),
        Insn::CmpLDD { src, dst } => push_w(
            &mut out,
            0xB080 | (check_reg(*dst)? << 9) | check_reg(*src)?,
        ),
        Insn::BtstImmD { bit, d } => {
            if *bit > 31 {
                return Err(format!("BTST #{bit} fora de 0..=31"));
            }
            push_w(&mut out, 0x0800 | check_reg(*d)?);
            push_w(&mut out, *bit as u16);
        }
        Insn::PeaAbsW { abs } => {
            push_w(&mut out, 0x4878);
            push_w(&mut out, *abs as u16);
        }
        Insn::MoveLAbsToPush { abs } => {
            push_w(&mut out, 0x2F39);
            out.extend_from_slice(&abs.to_be_bytes());
        }
        Insn::JsrAbsL { target } => {
            push_w(&mut out, 0x4EB9);
            out.extend_from_slice(&target.to_be_bytes());
        }
        Insn::Bcc { .. } | Insn::Bra { .. } => {
            let (code, target, size) = match insn {
                Insn::Bcc { cond, target, size } => (cond.code(), *target, *size),
                Insn::Bra { target, size } => (0, *target, *size),
                _ => unreachable!(),
            };
            let disp = target as i64 - (offset as i64 + 2);
            match size {
                BranchSize::Short => {
                    if disp == 0 || disp == -1 || !(-128..=127).contains(&disp) {
                        return Err(format!(
                            "desvio curto em 0x{offset:06X} nao alcanca 0x{target:06X}; crescimento recusado"
                        ));
                    }
                    push_w(&mut out, 0x6000 | (code << 8) | (disp as i8 as u8 as u16));
                }
                BranchSize::Word => {
                    if !(-32768..=32767).contains(&disp) {
                        return Err(format!("desvio .W em 0x{offset:06X} fora de alcance"));
                    }
                    push_w(&mut out, 0x6000 | (code << 8));
                    push_w(&mut out, disp as i16 as u16);
                }
            }
        }
    }
    Ok(out)
}

/// Texto de desmontagem (so apresentacao; nao e usado para reconstruir).
pub fn mnemonic(insn: &Insn) -> String {
    match insn {
        Insn::MoveLAbsToD { abs, d } => format!("MOVE.L ${abs:08X}.L,D{d}"),
        Insn::MoveLDToAbs { d, abs } => format!("MOVE.L D{d},${abs:08X}.L"),
        Insn::AddqLD { q, d } => format!("ADDQ.L #{q},D{d}"),
        Insn::AddqLSp { q } => format!("ADDQ.L #{q},SP"),
        Insn::Moveq { imm, d } => format!("MOVEQ #{imm},D{d}"),
        Insn::CmpLDD { src, dst } => format!("CMP.L D{src},D{dst}"),
        Insn::BtstImmD { bit, d } => format!("BTST #{bit},D{d}"),
        Insn::Bcc { cond, target, size } => format!(
            "B{}.{} ${target:06X}",
            cond.name().to_uppercase(),
            if *size == BranchSize::Short { "S" } else { "W" }
        ),
        Insn::Bra { target, size } => format!(
            "BRA.{} ${target:06X}",
            if *size == BranchSize::Short { "S" } else { "W" }
        ),
        Insn::PeaAbsW { abs } => format!("PEA ${:04X}.W", *abs as u16),
        Insn::MoveLAbsToPush { abs } => format!("MOVE.L ${abs:08X}.L,-(SP)"),
        Insn::JsrAbsL { target } => format!("JSR ${target:06X}.L"),
    }
}

/// Valor possivelmente desconhecido (clobber de chamada externa).
pub type Val = Option<u32>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Ccr {
    pub x: Option<bool>,
    pub n: Option<bool>,
    pub z: Option<bool>,
    pub v: Option<bool>,
    pub c: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    /// Escrita longa em endereco absoluto.
    Write { at: u32, addr: u32, value: u32 },
    /// Chamada externa opaca: alvo e argumentos empilhados (topo primeiro).
    Call {
        at: u32,
        target: u32,
        args: Vec<Val>,
    },
}

/// Estado de maquina do perfil. `mem` guarda somente palavras longas em
/// enderecos absolutos declarados; ler endereco nao declarado e erro.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Machine {
    pub d: [Val; 8],
    pub ccr: Ccr,
    pub mem: BTreeMap<u32, u32>,
    pub stack: Vec<Val>,
    pub events: Vec<Event>,
}

impl Machine {
    pub fn new(d: [u32; 8], ccr: Ccr, mem: BTreeMap<u32, u32>) -> Machine {
        Machine {
            d: d.map(Some),
            ccr,
            mem,
            stack: Vec::new(),
            events: Vec::new(),
        }
    }

    fn get_d(&self, reg: u8, at: u32) -> Result<u32, String> {
        self.d[reg as usize]
            .ok_or_else(|| format!("D{reg} desconhecido (clobber de chamada) lido em 0x{at:06X}"))
    }

    fn read_abs(&self, addr: u32, at: u32) -> Result<u32, String> {
        self.mem.get(&addr).copied().ok_or_else(|| {
            format!("leitura de ${addr:08X} em 0x{at:06X} fora da memoria declarada")
        })
    }

    fn set_nz(&mut self, value: u32) {
        self.ccr.n = Some(value & 0x8000_0000 != 0);
        self.ccr.z = Some(value == 0);
        self.ccr.v = Some(false);
        self.ccr.c = Some(false);
    }

    fn cond(&self, cond: Cond, at: u32) -> Result<bool, String> {
        let flag = |value: Option<bool>, name: &str| {
            value.ok_or_else(|| format!("flag {name} desconhecida em 0x{at:06X}"))
        };
        Ok(match cond {
            Cond::Eq => flag(self.ccr.z, "Z")?,
            Cond::Ne => !flag(self.ccr.z, "Z")?,
            Cond::Ge => flag(self.ccr.n, "N")? == flag(self.ccr.v, "V")?,
            Cond::Lt => flag(self.ccr.n, "N")? != flag(self.ccr.v, "V")?,
            Cond::Gt => !flag(self.ccr.z, "Z")? && flag(self.ccr.n, "N")? == flag(self.ccr.v, "V")?,
            Cond::Le => flag(self.ccr.z, "Z")? || flag(self.ccr.n, "N")? != flag(self.ccr.v, "V")?,
        })
    }

    /// Executa uma instrucao e devolve o proximo PC.
    pub fn step(&mut self, decoded: &Decoded) -> Result<u32, String> {
        let at = decoded.offset;
        let next = at + decoded.len;
        match &decoded.insn {
            Insn::MoveLAbsToD { abs, d } => {
                let value = self.read_abs(*abs, at)?;
                self.d[*d as usize] = Some(value);
                self.set_nz(value);
            }
            Insn::MoveLDToAbs { d, abs } => {
                let value = self.get_d(*d, at)?;
                self.mem.insert(*abs, value);
                self.events.push(Event::Write {
                    at,
                    addr: *abs,
                    value,
                });
                self.set_nz(value);
            }
            Insn::AddqLD { q, d } => {
                let a = self.get_d(*d, at)?;
                let b = *q as u32;
                let r = a.wrapping_add(b);
                let (sa, sb, sr) = (a >> 31 != 0, b >> 31 != 0, r >> 31 != 0);
                let carry = (a as u64 + b as u64) > u32::MAX as u64;
                self.d[*d as usize] = Some(r);
                self.ccr.n = Some(sr);
                self.ccr.z = Some(r == 0);
                self.ccr.v = Some(sa == sb && sr != sa);
                self.ccr.c = Some(carry);
                self.ccr.x = Some(carry);
            }
            Insn::AddqLSp { q } => {
                // Cada argumento empilhado e uma palavra longa; o perfil so aceita
                // limpeza exata de pilha em multiplos de 4.
                if q % 4 != 0 || (*q as usize / 4) > self.stack.len() {
                    return Err(format!(
                        "ADDQ.L #{q},SP em 0x{at:06X} nao corresponde a limpeza de argumentos empilhados"
                    ));
                }
                for _ in 0..(*q / 4) {
                    self.stack.pop();
                }
            }
            Insn::Moveq { imm, d } => {
                let value = *imm as i32 as u32;
                self.d[*d as usize] = Some(value);
                self.set_nz(value);
            }
            Insn::CmpLDD { src, dst } => {
                let s = self.get_d(*src, at)?;
                let t = self.get_d(*dst, at)?;
                let r = t.wrapping_sub(s);
                let (ss, st, sr) = (s >> 31 != 0, t >> 31 != 0, r >> 31 != 0);
                self.ccr.n = Some(sr);
                self.ccr.z = Some(r == 0);
                self.ccr.v = Some(ss != st && sr != st);
                self.ccr.c = Some(s > t);
            }
            Insn::BtstImmD { bit, d } => {
                let value = self.get_d(*d, at)?;
                self.ccr.z = Some(value & (1 << (bit % 32)) == 0);
            }
            Insn::Bcc { cond, target, .. } => {
                return Ok(if self.cond(*cond, at)? { *target } else { next });
            }
            Insn::Bra { target, .. } => return Ok(*target),
            Insn::PeaAbsW { abs } => self.stack.push(Some(*abs as i32 as u32)),
            Insn::MoveLAbsToPush { abs } => {
                let value = self.read_abs(*abs, at)?;
                self.stack.push(Some(value));
                self.set_nz(value);
            }
            Insn::JsrAbsL { target } => {
                let args = self.stack.iter().rev().copied().collect();
                self.events.push(Event::Call {
                    at,
                    target: *target,
                    args,
                });
                // ABI C do m68k-elf-gcc: D0/D1/A0/A1 e CCR sao scratch do chamado.
                self.d[0] = None;
                self.d[1] = None;
                self.ccr = Ccr::default();
            }
        }
        Ok(next)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_every_subset_form() {
        let cases: Vec<(Insn, u32)> = vec![
            (
                Insn::MoveLAbsToD {
                    abs: 0xE0FF0054,
                    d: 0,
                },
                0x94C,
            ),
            (
                Insn::MoveLDToAbs {
                    d: 3,
                    abs: 0xE0FF0062,
                },
                0xCB0,
            ),
            (Insn::AddqLD { q: 1, d: 0 }, 0x952),
            (Insn::AddqLD { q: 8, d: 7 }, 0x952),
            (Insn::AddqLSp { q: 8 }, 0xCC6),
            (Insn::Moveq { imm: -128, d: 2 }, 0x960),
            (Insn::CmpLDD { src: 0, dst: 2 }, 0x962),
            (Insn::BtstImmD { bit: 3, d: 0 }, 0x946),
            (
                Insn::Bcc {
                    cond: Cond::Lt,
                    target: 0xCAE,
                    size: BranchSize::Word,
                },
                0x964,
            ),
            (
                Insn::Bcc {
                    cond: Cond::Eq,
                    target: 0x970,
                    size: BranchSize::Short,
                },
                0x94A,
            ),
            (
                Insn::Bra {
                    target: 0x970,
                    size: BranchSize::Word,
                },
                0xCC8,
            ),
            (Insn::PeaAbsW { abs: 1 }, 0xCB6),
            (Insn::MoveLAbsToPush { abs: 0xE0FF007A }, 0xCBA),
            (Insn::JsrAbsL { target: 0xB10C }, 0xCC0),
        ];
        for (insn, at) in cases {
            let bytes = encode(&insn, at).expect("encode");
            let mut image = vec![0u8; at as usize];
            image.extend_from_slice(&bytes);
            let decoded = decode(&image, at).expect("decode");
            assert_eq!(decoded.insn, insn);
            assert_eq!(decoded.len as usize, bytes.len());
        }
    }

    #[test]
    fn refuses_outside_subset_and_long_branches() {
        assert!(decode(&[0x4E, 0x75], 0)
            .unwrap_err()
            .contains("fora do subconjunto"));
        assert!(decode(&[0x61, 0x02], 0).unwrap_err().contains("BSR"));
        assert!(decode(&[0x6D, 0xFF, 0, 0, 0, 0], 0)
            .unwrap_err()
            .contains("68020"));
        assert!(decode(&[0x65, 0x02], 0).unwrap_err().contains("condicao"));
        assert!(decode(&[0x20, 0x39, 0xE0], 0)
            .unwrap_err()
            .contains("truncada"));
        assert!(encode(
            &Insn::Bcc {
                cond: Cond::Eq,
                target: 0x1000,
                size: BranchSize::Short
            },
            0
        )
        .unwrap_err()
        .contains("crescimento recusado"));
    }

    #[test]
    fn addq_long_flags_cover_signed_overflow_and_carry() {
        let run = |d0: u32| {
            let mut m = Machine::new([d0, 0, 0, 0, 0, 0, 0, 0], Ccr::default(), BTreeMap::new());
            m.step(&Decoded {
                offset: 0,
                len: 2,
                insn: Insn::AddqLD { q: 1, d: 0 },
            })
            .unwrap();
            (m.d[0].unwrap(), m.ccr)
        };
        let (r, ccr) = run(0x7FFF_FFFF);
        assert_eq!(r, 0x8000_0000);
        assert_eq!(
            (ccr.n, ccr.z, ccr.v, ccr.c, ccr.x),
            (
                Some(true),
                Some(false),
                Some(true),
                Some(false),
                Some(false)
            )
        );
        let (r, ccr) = run(0xFFFF_FFFF);
        assert_eq!(r, 0);
        assert_eq!(
            (ccr.n, ccr.z, ccr.v, ccr.c, ccr.x),
            (Some(false), Some(true), Some(false), Some(true), Some(true))
        );
    }

    #[test]
    fn cmp_flags_match_signed_semantics_including_overflow() {
        // CMP.L D0,D2 com D2=5: LT <=> 5 < D0 (assinado), incluindo overflow.
        for (d0, expected_lt) in [
            (5u32, false),
            (6, true),
            (0x7FFF_FFFF, true),
            (0x8000_0000, false),
            (0xFFFF_FFFF, false),
        ] {
            let mut m = Machine::new([d0, 0, 5, 0, 0, 0, 0, 0], Ccr::default(), BTreeMap::new());
            m.step(&Decoded {
                offset: 0,
                len: 2,
                insn: Insn::CmpLDD { src: 0, dst: 2 },
            })
            .unwrap();
            assert_eq!(m.cond(Cond::Lt, 0).unwrap(), expected_lt, "d0={d0:#x}");
        }
    }
}
