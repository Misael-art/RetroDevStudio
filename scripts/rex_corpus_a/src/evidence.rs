//! As cadeas de evidencia de consumidor (`rex-corpus-evidence/v1`).
//!
//! `ResourceRecord::consumer_evidence` é un `Vec<String>`: se calquera texto
//! vales, un rexistro podería afirmar `confirmado-estaticamente` cunha proba
//! inventada. Este módulo pecha ese oco — as cadeas **fabrícanse** desde as
//! estruturas que mide [`crate::consumer`] e **len** só se cumpren a gramática:
//!
//! ```text
//! evidencia := lea@HEX / A<d> [ / chamada@HEX / HEX ]
//!            | chamada@HEX / HEX
//!            | taboa@HEX / ENTRADAS / (crecente|decrecente)
//!            | ref@HEX
//! HEX        := "0x" [5-7] díxitos hexadecimais en maiúsculas
//! ENTRADAS   := decimal
//! ```
//!
//! `HEX` usa o mesmo `0x{:05X}` que os verbos do CLI, cun ancho mínimo de cinco
//! díxitos: unha imaxe de 4 MiB chega a `0x400000` e o ancho non pode truncar.
//! Un desprazamento con menos de cinco díxitos rexéitase na lectura — `0x40`
//! non é a forma en que se mediu.
//!
//! [`Evidencia::vincula`] separa o que a Fase 2 xa aprendeu: a presenza de
//! bytes (`ref`) non é un consumidor. Unha cadea `ref` pode acompañar un
//! rexistro, pero soa non o confirma.

use crate::consumer::{CargaAbsoluta, JsrSite, PointerTable, RefSite};

/// Versión do contrato de cadeas de evidencia.
pub const SCHEMA_EVIDENCIA: &str = "rex-corpus-evidence/v1";

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Evidencia {
    /// `lea abs.l,An` cuxo operando é o enderezo do fluxo. `chamada`/`destino`
    /// son a primeira chamada dentro da ventanxa e o seu destino (a rutina);
    /// `None` cando non hai chamada — Sonic 1 usa `bsr` de 16 bits.
    Carga {
        offset: usize,
        registro: u8,
        chamada: Option<usize>,
        destino: Option<u32>,
    },
    /// `jsr`/`jmp` absoluto longo cuxo **destino** é o enderezo observado.
    Chamada { offset: usize, destino: u32 },
    /// Táboa de punteiros longos que contén o enderezo.
    Taboa {
        base: usize,
        entradas: usize,
        crecente: bool,
    },
    /// Referencia de bytes sen interpretar: pode estar dentro de datos.
    Referencia { offset: usize },
}

impl Evidencia {
    pub fn desde_carga(c: &CargaAbsoluta, chamada: Option<&JsrSite>) -> Evidencia {
        Evidencia::Carga {
            offset: c.offset,
            registro: c.registro,
            chamada: chamada.map(|s| s.offset),
            destino: chamada.map(|s| s.target),
        }
    }

    pub fn desde_chamada(s: &JsrSite) -> Evidencia {
        Evidencia::Chamada {
            offset: s.offset,
            destino: s.target,
        }
    }

    pub fn desde_taboa(t: &PointerTable) -> Evidencia {
        Evidencia::Taboa {
            base: t.base_offset,
            entradas: t.entries,
            crecente: t.ascending,
        }
    }

    pub fn desde_referencia(r: &RefSite) -> Evidencia {
        Evidencia::Referencia { offset: r.offset }
    }

    /// ¿Proba esta evidencia un consumidor? `Referencia` non: é a forma que a
    /// Fase 2 tomou por vínculo e despois retractou.
    pub fn vincula(&self) -> bool {
        !matches!(self, Evidencia::Referencia { .. })
    }

    pub fn format(&self) -> String {
        match self {
            Evidencia::Carga {
                offset,
                registro,
                chamada,
                destino,
            } => match (chamada, destino) {
                (Some(c), Some(d)) => format!(
                    "lea@{}/A{registro}/chamada@{}/{}",
                    hex(*offset),
                    hex(*c),
                    hex(*d as usize)
                ),
                _ => format!("lea@{}/A{registro}", hex(*offset)),
            },
            Evidencia::Chamada { offset, destino } => {
                format!("chamada@{}/{}", hex(*offset), hex(*destino as usize))
            }
            Evidencia::Taboa {
                base,
                entradas,
                crecente,
            } => format!(
                "taboa@{}/{entradas}/{}",
                hex(*base),
                if *crecente { "crecente" } else { "decrecente" }
            ),
            Evidencia::Referencia { offset } => format!("ref@{}", hex(*offset)),
        }
    }

    /// A única porta de entrada para evidencia que vén de fóra (un JSON lido,
    /// por exemplo). Unha cadea que non cumpre a forma devolve `None`: non se
    /// interpreta, non se estima.
    pub fn parse(cadea: &str) -> Option<Evidencia> {
        let anacos: Vec<&str> = cadea.split('/').collect();
        let (cabeca, resto) = anacos.split_first()?;
        let (tipo, corpo) = cabeca.split_once('@')?;
        let sitio = hex5(corpo)?;
        match tipo {
            "lea" => {
                let rexistro = resto.first().and_then(|t| rexistro_de(t))?;
                match resto.len() {
                    1 => Some(Evidencia::Carga {
                        offset: sitio,
                        registro: rexistro,
                        chamada: None,
                        destino: None,
                    }),
                    3 => {
                        let (c, d) = resto[1].split_once('@')?;
                        if c != "chamada" {
                            return None;
                        }
                        Some(Evidencia::Carga {
                            offset: sitio,
                            registro: rexistro,
                            chamada: Some(hex5(d)?),
                            destino: Some(u32::try_from(hex5(resto[2])?).ok()?),
                        })
                    }
                    _ => None,
                }
            }
            "chamada" if resto.len() == 1 => Some(Evidencia::Chamada {
                offset: sitio,
                destino: u32::try_from(hex5(resto[0])?).ok()?,
            }),
            "taboa" if resto.len() == 2 => {
                let entradas = resto[0].bytes().all(|b| b.is_ascii_digit());
                if !entradas {
                    return None;
                }
                let crecente = match resto[1] {
                    "crecente" => true,
                    "decrecente" => false,
                    _ => return None,
                };
                Some(Evidencia::Taboa {
                    base: sitio,
                    entradas: resto[0].parse().ok()?,
                    crecente,
                })
            }
            "ref" if resto.is_empty() => Some(Evidencia::Referencia { offset: sitio }),
            _ => None,
        }
    }

    /// O enderezo do sitio que sostén a evidencia (fluxo, carga ou base).
    pub fn sitio(&self) -> usize {
        match self {
            Evidencia::Carga { offset, .. } => *offset,
            Evidencia::Chamada { offset, .. } => *offset,
            Evidencia::Taboa { base, .. } => *base,
            Evidencia::Referencia { offset } => *offset,
        }
    }
}

pub fn cadeas(lista: &[Evidencia]) -> Vec<String> {
    lista.iter().map(Evidencia::format).collect()
}

/// As cadeas que si fan un vínculo, na orde en que se mediron.
pub fn vinculantes(lista: &[Evidencia]) -> Vec<String> {
    lista
        .iter()
        .filter(|e| e.vincula())
        .map(Evidencia::format)
        .collect()
}

fn hex(v: usize) -> String {
    format!("0x{v:05X}")
}

/// `0x` + cinco ou máis díxitos hexadecimais en maiúsculas.
fn hex5(token: &str) -> Option<usize> {
    let corpo = token.strip_prefix("0x")?;
    if corpo.len() < 5 || corpo.len() > 7 {
        return None;
    }
    if !corpo
        .bytes()
        .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_lowercase())
    {
        return None;
    }
    usize::from_str_radix(corpo, 16).ok()
}

/// `A0`…`A7`: o rexistro de dirección medido, non un nome libre.
fn rexistro_de(token: &str) -> Option<u8> {
    let corpo = token.strip_prefix('A')?;
    if corpo.len() != 1 {
        return None;
    }
    let d = corpo.as_bytes()[0];
    if (b'0'..=b'7').contains(&d) {
        Some(d - b'0')
    } else {
        None
    }
}
