//! Parser de `.air` (animacoes MUGEN).
//!
//! Semantica seguida:
//! * `ClsnNDefault: n` define as caixas padrao dos frames seguintes da action;
//! * `ClsnN: n` define caixas so para o proximo frame (o cabecalho decide, nao a posicao);
//! * linha de frame `grupo, imagem, x, y, tempo[, flip[, blend]]` e posicional:
//!   campo 6 = flip (`H`, `V`, `HV`), campo 7 = blend; campo vazio conta;
//! * `tempo = -1` e infinito e e preservado como `None`;
//! * `Loopstart` marca o indice do proximo frame.
//!
//! Nada e descartado em silencio: linha nao reconhecida, action duplicada, contagem de
//! caixas divergente e recursos sem equivalente geram diagnostico com a linha.

use std::collections::BTreeMap;

use crate::diag::{Diagnostic, Severity, SourceLoc};

/// Caixa relativa ao eixo, normalizada (`x1 <= x2`, `y1 <= y2`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Box {
    pub x1: i32,
    pub y1: i32,
    pub x2: i32,
    pub y2: i32,
}

impl Box {
    pub fn new(a: i32, b: i32, c: i32, d: i32) -> Box {
        Box {
            x1: a.min(c),
            y1: b.min(d),
            x2: a.max(c),
            y2: b.max(d),
        }
    }

    /// Espelha a caixa horizontalmente em torno do eixo.
    pub fn hflip(self) -> Box {
        Box::new(-self.x2, self.y1, -self.x1, self.y2)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    pub group: i32,
    pub image: i32,
    /// Deslocamento do frame em relacao ao eixo (pixels).
    pub x: i32,
    pub y: i32,
    /// Duracao em ticks de 1/60 s; `None` = infinito (`-1`).
    pub time: Option<u32>,
    pub hflip: bool,
    pub vflip: bool,
    /// Texto do blend quando presente (sem equivalente no VDP).
    pub blend: Option<String>,
    /// Caixas de ataque.
    pub clsn1: Vec<Box>,
    /// Caixas de corpo.
    pub clsn2: Vec<Box>,
    pub line: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Action {
    pub number: i32,
    pub frames: Vec<Frame>,
    /// Indice do frame de retorno; `None` = sem `Loopstart` (MUGEN volta ao 0).
    pub loopstart: Option<usize>,
    pub line: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Air {
    pub file: String,
    pub actions: BTreeMap<i32, Action>,
    pub diagnostics: Vec<Diagnostic>,
}

fn strip_comment(raw: &str) -> &str {
    raw.split(';').next().unwrap_or("").trim()
}

fn parse_action_header(line: &str) -> Option<Result<i32, ()>> {
    let inner = line.strip_prefix('[')?.strip_suffix(']')?.trim();
    let lower = inner.to_ascii_lowercase();
    let rest = lower.strip_prefix("begin")?.trim_start();
    let number = rest.strip_prefix("action")?.trim();
    Some(number.parse::<i32>().map_err(|_| ()))
}

enum ClsnHeader {
    Default(u8, usize),
    Next(u8, usize),
}

fn parse_clsn_header(line: &str) -> Option<ClsnHeader> {
    let lower = line.to_ascii_lowercase();
    let rest = lower.strip_prefix("clsn")?;
    let kind = match rest.as_bytes().first()? {
        b'1' => 1,
        b'2' => 2,
        _ => return None,
    };
    let rest = &rest[1..];
    let (is_default, rest) = match rest.strip_prefix("default") {
        Some(r) => (true, r),
        None => (false, rest),
    };
    let count = rest.trim_start().strip_prefix(':')?.trim().parse().ok()?;
    Some(if is_default {
        ClsnHeader::Default(kind, count)
    } else {
        ClsnHeader::Next(kind, count)
    })
}

fn parse_clsn_box(line: &str) -> Option<(u8, Option<Box>)> {
    let lower = line.to_ascii_lowercase();
    let rest = lower.strip_prefix("clsn")?;
    let kind = match rest.as_bytes().first()? {
        b'1' => 1,
        b'2' => 2,
        _ => return None,
    };
    let rest = rest[1..].trim_start();
    if !rest.starts_with('[') {
        return None;
    }
    let (_, values) = line.split_once('=')?;
    let nums: Vec<i32> = values
        .split(',')
        .map(|v| v.trim().parse::<i32>())
        .collect::<Result<_, _>>()
        .ok()
        .unwrap_or_default();
    Some((
        kind,
        (nums.len() == 4).then(|| Box::new(nums[0], nums[1], nums[2], nums[3])),
    ))
}

struct Pending {
    kind: u8,
    is_default: bool,
    expected: usize,
    got: usize,
    line: u32,
}

pub fn parse(text: &str, file: &str) -> Air {
    let mut actions: BTreeMap<i32, Action> = BTreeMap::new();
    let mut diagnostics = Vec::new();
    let mut current: Option<Action> = None;
    let mut defaults: [Vec<Box>; 2] = [Vec::new(), Vec::new()];
    let mut next: [Option<Vec<Box>>; 2] = [None, None];
    let mut reading: Option<Pending> = None;
    let loc = |line: u32| SourceLoc::line(file, line);

    let close_reading = |reading: &mut Option<Pending>, diagnostics: &mut Vec<Diagnostic>| {
        if let Some(p) = reading.take() {
            if p.got != p.expected {
                diagnostics.push(Diagnostic::new(
                    "air.clsn.count_mismatch",
                    Severity::Warning,
                    SourceLoc::line(file, p.line),
                    format!(
                        "Clsn{}{} declara {} caixas e lista {}",
                        p.kind,
                        if p.is_default { "Default" } else { "" },
                        p.expected,
                        p.got
                    ),
                    "Corrija a contagem no cabecalho ou as linhas de caixa; foram usadas as caixas listadas.",
                ));
            }
        }
    };

    let finish =
        |action: Action, actions: &mut BTreeMap<i32, Action>, diagnostics: &mut Vec<Diagnostic>| {
            if action.frames.is_empty() {
                diagnostics.push(Diagnostic::new(
                    "air.action.empty",
                    Severity::Warning,
                    SourceLoc::line(file, action.line),
                    format!("action {} sem frames", action.number),
                    "Adicione frames ou remova a action; ela nao sera convertida.",
                ));
            }
            if let Some(first) = actions.get(&action.number) {
                diagnostics.push(Diagnostic::new(
                    "air.action.duplicate",
                    Severity::Error,
                    SourceLoc::line(file, action.line),
                    format!(
                        "action {} duplicada (primeira na linha {}); a duplicata foi ignorada",
                        action.number, first.line
                    ),
                    "Renumere ou remova a action duplicada.",
                ));
            } else {
                actions.insert(action.number, action);
            }
        };

    for (index, raw) in text.lines().enumerate() {
        let ln = index as u32 + 1;
        let line = strip_comment(raw);
        if line.is_empty() {
            continue;
        }
        if let Some(header) = parse_action_header(line) {
            close_reading(&mut reading, &mut diagnostics);
            if let Some(done) = current.take() {
                finish(done, &mut actions, &mut diagnostics);
            }
            match header {
                Ok(number) => {
                    current = Some(Action {
                        number,
                        frames: Vec::new(),
                        loopstart: None,
                        line: ln,
                    })
                }
                Err(()) => diagnostics.push(Diagnostic::new(
                    "air.action.bad_header",
                    Severity::Error,
                    loc(ln),
                    format!("cabecalho de action invalido: '{line}'"),
                    "Use '[Begin Action <numero>]'.",
                )),
            }
            defaults = [Vec::new(), Vec::new()];
            next = [None, None];
            continue;
        }
        let Some(action) = current.as_mut() else {
            diagnostics.push(Diagnostic::new(
                "air.line.outside_action",
                Severity::Warning,
                loc(ln),
                format!("linha fora de action ignorada: '{line}'"),
                "Mova a linha para dentro de um '[Begin Action]'.",
            ));
            continue;
        };
        if line.eq_ignore_ascii_case("loopstart") {
            close_reading(&mut reading, &mut diagnostics);
            action.loopstart = Some(action.frames.len());
            continue;
        }
        if let Some(header) = parse_clsn_header(line) {
            close_reading(&mut reading, &mut diagnostics);
            let (kind, is_default, expected) = match header {
                ClsnHeader::Default(k, n) => (k, true, n),
                ClsnHeader::Next(k, n) => (k, false, n),
            };
            let slot = (kind - 1) as usize;
            if is_default {
                defaults[slot] = Vec::new();
            } else {
                next[slot] = Some(Vec::new());
            }
            reading = Some(Pending {
                kind,
                is_default,
                expected,
                got: 0,
                line: ln,
            });
            continue;
        }
        if let Some((kind, parsed)) = parse_clsn_box(line) {
            let Some(b) = parsed else {
                diagnostics.push(Diagnostic::new(
                    "air.clsn.bad_box",
                    Severity::Error,
                    loc(ln),
                    format!("caixa invalida: '{line}'"),
                    "Use 'ClsnN[i] = x1, y1, x2, y2' com inteiros.",
                ));
                continue;
            };
            let slot = (kind - 1) as usize;
            match reading.as_mut() {
                Some(p) if p.kind == kind => {
                    p.got += 1;
                    if p.is_default {
                        defaults[slot].push(b);
                    } else {
                        next[slot].get_or_insert_with(Vec::new).push(b);
                    }
                }
                _ => diagnostics.push(Diagnostic::new(
                    "air.clsn.no_header",
                    Severity::Error,
                    loc(ln),
                    format!("caixa Clsn{kind} sem cabecalho correspondente ignorada"),
                    "Declare 'ClsnN: n' ou 'ClsnNDefault: n' antes das caixas.",
                )),
            }
            continue;
        }
        if line.to_ascii_lowercase().starts_with("interpolate") {
            diagnostics.push(Diagnostic::new(
                "air.interpolate.unsupported",
                Severity::Warning,
                loc(ln),
                format!("'{line}' nao e suportado; os frames ficam sem interpolacao"),
                "A animacao salta entre frames; crie frames intermediarios se precisar da transicao.",
            ));
            continue;
        }
        let first = line.as_bytes()[0];
        if first.is_ascii_digit() || first == b'-' {
            close_reading(&mut reading, &mut diagnostics);
            let parts: Vec<&str> = line.split(',').map(str::trim).collect();
            let nums: Option<Vec<i32>> = parts
                .iter()
                .take(5)
                .map(|p| p.parse::<i32>().ok())
                .collect();
            let nums = match nums {
                Some(n) if n.len() == 5 => n,
                _ => {
                    diagnostics.push(Diagnostic::new(
                        "air.frame.bad_line",
                        Severity::Error,
                        loc(ln),
                        format!("frame invalido: '{line}'"),
                        "Use 'grupo, imagem, x, y, tempo[, flip[, blend]]' com inteiros.",
                    ));
                    continue;
                }
            };
            let time = match nums[4] {
                -1 => None,
                t if t >= 0 => Some(t as u32),
                t => {
                    diagnostics.push(Diagnostic::new(
                        "air.frame.bad_time",
                        Severity::Error,
                        loc(ln),
                        format!("tempo {t} invalido (so -1 ou >= 0)"),
                        "Use -1 para infinito ou um numero de ticks.",
                    ));
                    continue;
                }
            };
            let flip = parts.get(5).copied().unwrap_or("").to_ascii_uppercase();
            if !flip.chars().all(|c| c == 'H' || c == 'V') {
                diagnostics.push(Diagnostic::new(
                    "air.frame.bad_flip",
                    Severity::Error,
                    loc(ln),
                    format!("flip '{flip}' invalido (so H, V ou HV); frame ignorado"),
                    "Use H, V, HV ou deixe o campo vazio.",
                ));
                continue;
            }
            let blend = parts
                .get(6)
                .map(|b| b.to_string())
                .filter(|b| !b.is_empty());
            if parts.len() > 7 && parts[7..].iter().any(|p| !p.is_empty()) {
                diagnostics.push(Diagnostic::new(
                    "air.frame.extra_fields",
                    Severity::Warning,
                    loc(ln),
                    "campos alem de blend (escala/angulo do 1.1) ignorados",
                    "O frame e exibido sem escala/rotacao.",
                ));
            }
            let clsn1 = next[0].take().unwrap_or_else(|| defaults[0].clone());
            let clsn2 = next[1].take().unwrap_or_else(|| defaults[1].clone());
            action.frames.push(Frame {
                group: nums[0],
                image: nums[1],
                x: nums[2],
                y: nums[3],
                time,
                hflip: flip.contains('H'),
                vflip: flip.contains('V'),
                blend,
                clsn1,
                clsn2,
                line: ln,
            });
            continue;
        }
        diagnostics.push(Diagnostic::new(
            "air.line.unknown",
            Severity::Warning,
            loc(ln),
            format!("linha nao reconhecida ignorada: '{line}'"),
            "Verifique a sintaxe; a linha nao afeta a conversao.",
        ));
    }
    close_reading(&mut reading, &mut diagnostics);
    if let Some(done) = current.take() {
        finish(done, &mut actions, &mut diagnostics);
    }
    Air {
        file: file.to_string(),
        actions,
        diagnostics,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clsn_semantics_follow_the_header_not_the_position() {
        let air = parse(
            "[Begin Action 5]\n\
             Clsn2: 1\n Clsn2[0] = 10,-20,-10,0\n\
             0,0, 0,0, 3\n\
             0,1, 0,0, 4\n\
             Clsn2Default: 1\n Clsn2[0] = -5,-5,5,5\n\
             0,2, 0,0, 5\n\
             0,3, 0,0, 6\n",
            "t.air",
        );
        let f = &air.actions[&5].frames;
        assert_eq!(
            f[0].clsn2,
            vec![Box::new(-10, -20, 10, 0)],
            "so o frame seguinte"
        );
        assert!(f[1].clsn2.is_empty(), "Clsn2: nao vira default");
        assert_eq!(f[2].clsn2, vec![Box::new(-5, -5, 5, 5)]);
        assert_eq!(f[3].clsn2, vec![Box::new(-5, -5, 5, 5)], "default persiste");
        assert!(air.diagnostics.is_empty(), "{:?}", air.diagnostics);
    }

    #[test]
    fn flip_and_blend_are_positional_and_infinite_time_is_kept() {
        let air = parse(
            "[Begin Action 1]\n0,0,0,0,4,,A\n0,1,2,-3,-1,H\n0,2,0,0,2,VH,S\n",
            "t.air",
        );
        let f = &air.actions[&1].frames;
        assert!(!f[0].hflip && !f[0].vflip);
        assert_eq!(f[0].blend.as_deref(), Some("A"));
        assert!(f[1].hflip && !f[1].vflip);
        assert_eq!((f[1].x, f[1].y, f[1].time), (2, -3, None));
        assert!(f[2].hflip && f[2].vflip);
        assert_eq!(f[2].line, 4);
    }

    #[test]
    fn nothing_is_dropped_silently() {
        let air = parse(
            "0,0,0,0,1\n[Begin Action 1]\n0,0,0,0,1\nbanana\nClsn1: 2\n Clsn1[0]=1,1,2,2\n0,0,0,0,x\n\
             0,0,0,0,-4\n0,0,0,0,1,Q\nInterpolate Offset\n[Begin Action 1]\n0,0,0,0,1\n[Begin Action 9]\n",
            "t.air",
        );
        let codes: Vec<&str> = air.diagnostics.iter().map(|d| d.code).collect();
        for code in [
            "air.line.outside_action",
            "air.line.unknown",
            "air.clsn.count_mismatch",
            "air.frame.bad_line",
            "air.frame.bad_time",
            "air.frame.bad_flip",
            "air.interpolate.unsupported",
            "air.action.duplicate",
            "air.action.empty",
        ] {
            assert!(codes.contains(&code), "falta {code}: {codes:?}");
        }
        assert_eq!(
            air.actions[&1].frames.len(),
            1,
            "a primeira definicao vence"
        );
    }
}
