//! Plano de conversao de personagem: AIR + SFF v1 -> recursos SGDK com fidelidade declarada.
//!
//! Regras (cada uma vira diagnostico e/ou proveniencia):
//! * tempo `-1` -> timer 0 do SGDK (o frame fica parado): **direto**;
//! * tempo 1..=255 -> mesmo timer: **direto**; `0` -> 1 tick e `>255` -> 255: **aproximado**;
//! * `Loopstart` 0/ausente -> laco da SGDK: **direto**; `Loopstart > 0` exige o callback de
//!   runtime (`needs_runtime.loopstart`);
//! * flip e offset por frame exigem a tabela de runtime (`needs_runtime.frame_table`);
//! * blend nao tem equivalente no VDP: **nao suportado** (frame exibido opaco);
//! * sprite ausente no SFF: a action **nao e convertida** (nao suportado), erro. Um frame
//!   vazio encurtaria a animacao no `rescomp` (ele para no primeiro frame vazio) e
//!   deslocaria os indices das animacoes seguintes;
//! * celula > 248 px ou > 255 frames por action: **nao suportado** (plano recusado).

use std::collections::{BTreeMap, BTreeSet};

use crate::air::{Air, Box};
use crate::diag::{Diagnostic, Fidelity, Metric, MetricOrigin, Provenance, Severity, SourceLoc};
use crate::palette::{self, HardwarePalette};
use crate::sff::{Rgb, Sff};

pub const PROFILE_ID: &str = "mugen.character.v1";
pub const MAX_CELL_PX: usize = 248;
pub const MAX_FRAMES: usize = 255;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedFrame {
    pub sprite: (i32, i32),
    /// Celula no atlas; `None` = sprite ausente (frame vazio).
    pub cell: Option<usize>,
    /// Timer SGDK: 0 = parado, 1..=255 ticks.
    pub timer: u8,
    pub x: i32,
    pub y: i32,
    pub hflip: bool,
    pub vflip: bool,
    pub clsn1: Vec<Box>,
    pub clsn2: Vec<Box>,
    pub line: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedAction {
    pub number: i32,
    pub frames: Vec<PlannedFrame>,
    pub loopstart: usize,
    pub fidelity: Fidelity,
    pub line: u32,
}

impl PlannedAction {
    /// Lista `[t1,t2,...]` para o campo `time` do `rescomp` (sem espacos).
    pub fn rescomp_times(&self) -> String {
        let t: Vec<String> = self.frames.iter().map(|f| f.timer.to_string()).collect();
        format!("[{}]", t.join(","))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct RuntimeNeeds {
    pub loopstart: bool,
    pub frame_table: bool,
    pub clsn_table: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Cell {
    pub sprite: (i32, i32),
    /// Posicao do canto superior esquerdo do sprite dentro da celula.
    pub dx: usize,
    pub dy: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CharacterPlan {
    pub profile: &'static str,
    /// Tamanho da celula (multiplo de 8) e eixo comum dentro dela.
    pub cell_w: usize,
    pub cell_h: usize,
    pub anchor_x: usize,
    pub anchor_y: usize,
    pub cells: Vec<Cell>,
    pub actions: BTreeMap<i32, PlannedAction>,
    pub palette: HardwarePalette,
    pub needs_runtime: RuntimeNeeds,
    pub provenance: Vec<Provenance>,
    pub metrics: Vec<Metric>,
    pub diagnostics: Vec<Diagnostic>,
}

pub struct Inputs<'a> {
    pub air: &'a Air,
    pub air_sha256: &'a str,
    pub sff: &'a Sff,
    pub sff_sha256: &'a str,
    /// Actions a converter; vazio = todas.
    pub actions: &'a [i32],
}

fn round8(v: usize) -> usize {
    (v + 7) / 8 * 8
}

/// Recusa (Err) so quando o plano inteiro nao pode existir; o resto vira diagnostico.
pub fn plan(inp: &Inputs) -> Result<CharacterPlan, Vec<Diagnostic>> {
    let air = inp.air;
    let sff = inp.sff;
    let mut diagnostics: Vec<Diagnostic> = air.diagnostics.clone();
    diagnostics.extend(sff.diagnostics.iter().cloned());
    let mut provenance = Vec::new();
    let mut fatal = Vec::new();
    let selected: Vec<i32> = if inp.actions.is_empty() {
        air.actions.keys().copied().collect()
    } else {
        inp.actions.to_vec()
    };
    for n in &selected {
        if !air.actions.contains_key(n) {
            fatal.push(Diagnostic::new(
                "plan.action.missing",
                Severity::Error,
                SourceLoc::file(&air.file),
                format!("action {n} pedida nao existe no AIR"),
                "Escolha actions existentes no AIR.",
            ));
        }
    }
    // Sprites usados, na ordem (grupo, imagem).
    let used: BTreeSet<(i32, i32)> = selected
        .iter()
        .filter_map(|n| air.actions.get(n))
        .flat_map(|a| a.frames.iter().map(|f| (f.group, f.image)))
        .collect();
    let present: Vec<(i32, i32)> = used
        .iter()
        .copied()
        .filter(|k| sff.sprites.contains_key(k))
        .collect();
    if present.is_empty() {
        fatal.push(Diagnostic::new(
            "plan.sprites.none",
            Severity::Error,
            SourceLoc::file(&sff.file),
            "nenhum sprite referenciado pelas actions existe no SFF",
            "Confira grupos/imagens do AIR contra o SFF.",
        ));
    }
    if !fatal.is_empty() {
        diagnostics.extend(fatal);
        return Err(diagnostics);
    }
    let anchor_x = present
        .iter()
        .map(|k| sff.sprites[k].axis_x.max(0) as usize)
        .max()
        .unwrap();
    let anchor_y = present
        .iter()
        .map(|k| sff.sprites[k].axis_y.max(0) as usize)
        .max()
        .unwrap();
    let raw_w = present
        .iter()
        .map(|k| {
            let s = &sff.sprites[k];
            anchor_x + s.width.saturating_sub(s.axis_x.max(0) as usize)
        })
        .max()
        .unwrap();
    let raw_h = present
        .iter()
        .map(|k| {
            let s = &sff.sprites[k];
            anchor_y + s.height.saturating_sub(s.axis_y.max(0) as usize)
        })
        .max()
        .unwrap();
    let (cell_w, cell_h) = (round8(raw_w), round8(raw_h));
    let mut metrics = vec![
        Metric {
            name: "cell_width",
            unit: "px",
            value: Some(cell_w as f64),
            origin: MetricOrigin::Static,
            window: "uniao de todos os sprites convertidos".into(),
            availability: "available".into(),
            subject: SourceLoc::file(&sff.file),
            budget: Some(MAX_CELL_PX as f64),
        },
        Metric {
            name: "cell_height",
            unit: "px",
            value: Some(cell_h as f64),
            origin: MetricOrigin::Static,
            window: "uniao de todos os sprites convertidos".into(),
            availability: "available".into(),
            subject: SourceLoc::file(&sff.file),
            budget: Some(MAX_CELL_PX as f64),
        },
        Metric {
            name: "tiles_per_frame",
            unit: "tiles 8x8",
            value: Some(((cell_w / 8) * (cell_h / 8)) as f64),
            origin: MetricOrigin::Static,
            window: "por frame (celula inteira, antes do corte do rescomp)".into(),
            availability: "available".into(),
            subject: SourceLoc::file(&sff.file),
            budget: None,
        },
        Metric {
            name: "hardware_sprites_per_frame",
            unit: "sprites VDP",
            value: None,
            origin: MetricOrigin::Static,
            window: "por frame".into(),
            availability:
                "indisponivel: definido pelo corte do rescomp no build, nao calculado estaticamente"
                    .into(),
            subject: SourceLoc::file(&sff.file),
            budget: Some(16.0),
        },
    ];
    if cell_w > MAX_CELL_PX || cell_h > MAX_CELL_PX {
        diagnostics.push(Diagnostic::new(
            "plan.budget.cell_too_large",
            Severity::Error,
            SourceLoc::file(&sff.file),
            format!("celula {cell_w}x{cell_h} px excede {MAX_CELL_PX} px do rescomp"),
            "Reduza as dimensoes ou o deslocamento de eixo dos sprites maiores, ou converta menos actions.",
        ));
        return Err(diagnostics);
    }
    let cells: Vec<Cell> = present
        .iter()
        .map(|k| {
            let s = &sff.sprites[k];
            Cell {
                sprite: *k,
                dx: anchor_x - s.axis_x.max(0) as usize,
                dy: anchor_y - s.axis_y.max(0) as usize,
            }
        })
        .collect();
    let cell_of: BTreeMap<(i32, i32), usize> = cells
        .iter()
        .enumerate()
        .map(|(i, c)| (c.sprite, i))
        .collect();

    // Paleta: a do primeiro sprite usado; outras paletas diferentes sao declaradas.
    let base_palette = sff.sprites[&present[0]].palette.clone();
    let mut counts = [0u64; 256];
    for k in &present {
        let s = &sff.sprites[k];
        if s.palette != base_palette {
            diagnostics.push(Diagnostic::new(
                "plan.palette.multiple",
                Severity::Warning,
                SourceLoc::offset(&sff.file, s.offset),
                format!("sprite {},{} usa paleta diferente da do personagem; indices reinterpretados na paleta comum", k.0, k.1),
                "Unifique a paleta no SFF (same palette) para cores fieis.",
            ));
        }
        for &p in &s.pixels {
            counts[p as usize] += 1;
        }
    }
    let hw = palette::build(&base_palette, &counts);
    metrics.push(Metric {
        name: "palette_colors",
        unit: "cores VDP distintas",
        value: Some(hw.distinct_vdp_colors as f64),
        origin: MetricOrigin::Static,
        window: "pixels opacos dos sprites convertidos".into(),
        availability: "available".into(),
        subject: SourceLoc::file(&sff.file),
        budget: Some(15.0),
    });
    metrics.push(Metric {
        name: "merged_pixels",
        unit: "px",
        value: Some(hw.merged_pixels as f64),
        origin: MetricOrigin::Static,
        window: "pixels opacos dos sprites convertidos".into(),
        availability: "available".into(),
        subject: SourceLoc::file(&sff.file),
        budget: Some(0.0),
    });
    let pal_fidelity = if hw.merged_pixels > 0 {
        diagnostics.push(Diagnostic::new(
            "plan.palette.over_budget",
            Severity::Warning,
            SourceLoc::file(&sff.file),
            format!(
                "{} cores VDP distintas; {} de {} pixels foram para a cor mais proxima",
                hw.distinct_vdp_colors, hw.merged_pixels, hw.total_opaque_pixels
            ),
            "Reduza a paleta do personagem para ate 15 cores para evitar mudanca de cor.",
        ));
        Fidelity::Approximate
    } else if hw.rounded_pixels > 0 {
        Fidelity::Approximate
    } else {
        Fidelity::Direct
    };
    provenance.push(Provenance {
        item: "palette".into(),
        source: SourceLoc::offset(&sff.file, sff.sprites[&present[0]].offset),
        source_sha256: Some(inp.sff_sha256.to_string()),
        transform: format!(
            "{} indices usados -> {} cores na grade VDP de 9 bits -> 15 slots + transparente",
            hw.used_indices, hw.distinct_vdp_colors
        ),
        target: None,
        fidelity: pal_fidelity,
        reason: if hw.merged_pixels > 0 {
            "mais de 15 cores VDP".into()
        } else if hw.rounded_pixels > 0 {
            "arredondamento para 3 bits por canal".into()
        } else {
            "cores ja na grade do VDP".into()
        },
        consequence: format!(
            "{} px arredondados, {} px trocados de cor",
            hw.rounded_pixels, hw.merged_pixels
        ),
    });
    for c in &cells {
        let s = &sff.sprites[&c.sprite];
        provenance.push(Provenance {
            item: format!("sprite:{},{}", c.sprite.0, c.sprite.1),
            source: SourceLoc::offset(&sff.file, s.offset),
            source_sha256: Some(inp.sff_sha256.to_string()),
            transform: format!(
                "PCX {}x{} eixo ({},{}) -> celula {}x{} em ({},{}), indices -> slots",
                s.width, s.height, s.axis_x, s.axis_y, cell_w, cell_h, c.dx, c.dy
            ),
            target: None,
            fidelity: pal_fidelity,
            reason: "eixo alinhado a ancora comum".into(),
            consequence: "origem preservada; cores conforme a paleta".into(),
        });
    }

    let mut needs = RuntimeNeeds::default();
    let mut actions = BTreeMap::new();
    for n in &selected {
        let a = &air.actions[n];
        let at = |line| SourceLoc::line(&air.file, line);
        let mut fidelity = Fidelity::Direct;
        let mut notes: Vec<String> = Vec::new();
        if a.frames.len() > MAX_FRAMES {
            diagnostics.push(Diagnostic::new(
                "plan.budget.too_many_frames",
                Severity::Error,
                at(a.line),
                format!("action {n} tem {} frames (> {MAX_FRAMES})", a.frames.len()),
                "Divida a animacao; ela nao sera convertida.",
            ));
            continue;
        }
        if a.frames.is_empty() {
            continue;
        }
        let mut frames = Vec::new();
        let mut missing: Vec<u32> = Vec::new();
        for f in &a.frames {
            let cell = cell_of.get(&(f.group, f.image)).copied();
            if cell.is_none() {
                missing.push(f.line);
                diagnostics.push(Diagnostic::new(
                    "plan.frame.sprite_missing",
                    Severity::Error,
                    at(f.line),
                    format!(
                        "sprite {},{} nao existe no SFF; a action {n} nao sera convertida",
                        f.group, f.image
                    ),
                    "Inclua o sprite no SFF ou corrija o grupo/imagem no AIR.",
                ));
            }
            let timer = match f.time {
                None => 0,
                Some(0) => {
                    fidelity = Fidelity::Approximate;
                    notes.push(format!("linha {}: tempo 0 -> 1", f.line));
                    diagnostics.push(Diagnostic::new(
                        "plan.frame.zero_time",
                        Severity::Warning,
                        at(f.line),
                        "tempo 0 exibido por 1 tick (a SGDK usa 0 como 'parado')",
                        "Use 1 ou mais ticks.",
                    ));
                    1
                }
                Some(t) if t > 255 => {
                    fidelity = Fidelity::Approximate;
                    notes.push(format!("linha {}: tempo {t} -> 255", f.line));
                    diagnostics.push(Diagnostic::new(
                        "plan.frame.time_clamped",
                        Severity::Warning,
                        at(f.line),
                        format!("tempo {t} excede 255 ticks do timer SGDK; usado 255"),
                        "Repita o frame para duracoes maiores que 255 ticks.",
                    ));
                    255
                }
                Some(t) => t as u8,
            };
            if let Some(b) = &f.blend {
                if fidelity == Fidelity::Direct {
                    fidelity = Fidelity::Approximate;
                }
                notes.push(format!("linha {}: blend {b} ignorado", f.line));
                diagnostics.push(Diagnostic::new(
                    "plan.frame.blend_unsupported",
                    Severity::Warning,
                    at(f.line),
                    format!("blend '{b}' nao tem equivalente no VDP; frame exibido opaco"),
                    "Aceite o frame opaco ou substitua por paleta/sombra manual.",
                ));
            }
            if f.hflip || f.vflip || f.x != 0 || f.y != 0 {
                needs.frame_table = true;
            }
            if !f.clsn1.is_empty() || !f.clsn2.is_empty() {
                needs.clsn_table = true;
            }
            frames.push(PlannedFrame {
                sprite: (f.group, f.image),
                cell,
                timer,
                x: f.x,
                y: f.y,
                hflip: f.hflip,
                vflip: f.vflip,
                clsn1: f.clsn1.clone(),
                clsn2: f.clsn2.clone(),
                line: f.line,
            });
        }
        if !missing.is_empty() {
            provenance.push(Provenance {
                item: format!("anim:{n}"),
                source: at(a.line),
                source_sha256: Some(inp.air_sha256.to_string()),
                transform: "nao convertida".into(),
                target: None,
                fidelity: Fidelity::Unsupported,
                reason: format!("sprite ausente nas linhas {missing:?}"),
                consequence: "a animacao nao existe no projeto; estados que a usam ficam sem ela"
                    .into(),
            });
            continue;
        }
        let loopstart = a.loopstart.unwrap_or(0);
        if loopstart > 0 {
            needs.loopstart = true;
        }
        provenance.push(Provenance {
            item: format!("anim:{n}"),
            source: at(a.line),
            source_sha256: Some(inp.air_sha256.to_string()),
            transform: format!(
                "{} frames, timers {} , loopstart {loopstart}",
                frames.len(),
                frames
                    .iter()
                    .map(|f| f.timer.to_string())
                    .collect::<Vec<_>>()
                    .join(",")
            ),
            target: None,
            fidelity,
            reason: if notes.is_empty() {
                "tempos, flips, offsets e caixas representaveis".into()
            } else {
                notes.join("; ")
            },
            consequence: if fidelity == Fidelity::Direct {
                "mesma sequencia e duracao por frame".into()
            } else {
                "ver motivo; o restante da animacao e fiel".into()
            },
        });
        actions.insert(
            *n,
            PlannedAction {
                number: *n,
                frames,
                loopstart,
                fidelity,
                line: a.line,
            },
        );
    }
    Ok(CharacterPlan {
        profile: PROFILE_ID,
        cell_w,
        cell_h,
        anchor_x,
        anchor_y,
        cells,
        actions,
        palette: hw,
        needs_runtime: needs,
        provenance,
        metrics,
        diagnostics,
    })
}

impl CharacterPlan {
    /// Celula `i` em cores VDP (`None` = transparente), `cell_w * cell_h`.
    pub fn render_cell(&self, sff: &Sff, i: usize) -> Vec<Option<Rgb>> {
        let c = &self.cells[i];
        let s = &sff.sprites[&c.sprite];
        let mut out = vec![None; self.cell_w * self.cell_h];
        for y in 0..s.height {
            for x in 0..s.width {
                let idx = s.pixels[y * s.width + x];
                if idx == 0 {
                    continue;
                }
                let slot = self.palette.slot_of_index[idx as usize];
                out[(c.dy + y) * self.cell_w + c.dx + x] = Some(self.palette.colors[slot as usize]);
            }
        }
        out
    }
}
