//! Runtime gerado para animacoes do perfil MUGEN (`mugen.character.v1`, Experimental).
//!
//! Para sprites cujo asset traz `SpriteAnimation::mugen`, a auto-animacao da SGDK e
//! desligada e este runtime dirige os frames a partir da tabela vinda do modelo do
//! produto. Semantica (declarada em `crates/rex-mugen/CONTRACT.md`):
//! * o tick roda uma vez por quadro, depois da logica e antes de `SPR_update`;
//! * frame com timer `T` fica visivel `T` quadros; timer 0 = parado (`-1` do AIR);
//! * ao passar do ultimo frame volta a `loop_start`;
//! * `rds_mugen_<v>_done` fica 1 para a logica do quadro em que a primeira passagem
//!   completa `total` ticks (MUGEN `AnimTime = 0`); animacao com timer 0 nunca completa;
//! * flip em torno do eixo comum (convencao "largura - eixo"): deslocamento
//!   `2*eixo - celula`; offsets x/y do AIR somados a posicao (sem facing no v1);
//! * `rds_mugen_<v>_clsn1/_clsn2` = numero de caixas do frame atual (observavel na RAM).

use std::collections::{BTreeMap, BTreeSet};

use super::ast_generator::{
    AstNode, AstOutput, LogicBoolExpr, LogicOp, MugenAnimTable, SpriteAsset,
};

fn walk_bool(expr: &LogicBoolExpr, f: &mut dyn FnMut(&LogicBoolExpr)) {
    f(expr);
    match expr {
        LogicBoolExpr::Not(inner) => walk_bool(inner, f),
        LogicBoolExpr::And { left, right, .. } => {
            walk_bool(left, f);
            walk_bool(right, f);
        }
        _ => {}
    }
}

fn walk_ops(ops: &[LogicOp], f: &mut dyn FnMut(&LogicBoolExpr)) {
    for op in ops {
        match op {
            LogicOp::SourceMapped { op, .. } => walk_ops(std::slice::from_ref(op.as_ref()), f),
            LogicOp::ConditionOverlap {
                if_true, if_false, ..
            } => {
                walk_ops(if_true, f);
                walk_ops(if_false, f);
            }
            LogicOp::ConditionBool {
                condition,
                if_true,
                if_false,
            } => {
                walk_bool(condition, f);
                walk_ops(if_true, f);
                walk_ops(if_false, f);
            }
            LogicOp::WhileLoop {
                condition,
                body,
                done,
            } => {
                walk_bool(condition, f);
                walk_ops(body, f);
                walk_ops(done, f);
            }
            LogicOp::ForLoop { body, done, .. } => {
                walk_ops(body, f);
                walk_ops(done, f);
            }
            LogicOp::HardwareBudgetCheck { if_ok, if_warn, .. } => {
                walk_ops(if_ok, f);
                walk_ops(if_warn, f);
            }
            LogicOp::HardwareEvent { ops, .. } => walk_ops(ops, f),
            LogicOp::StateMachine { states, .. } => {
                for state in states {
                    walk_ops(&state.body, f);
                    for t in &state.transitions {
                        walk_bool(&t.condition, f);
                        walk_ops(&t.if_matched, f);
                        walk_ops(&t.if_unmatched, f);
                    }
                }
            }
            _ => {}
        }
    }
}

/// Sprites (variaveis) usados em `sprite_anim_done`.
pub(crate) fn anim_done_vars(ast: &AstOutput) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for script in &ast.logic_scripts {
        walk_ops(&script.ops, &mut |e| {
            if let LogicBoolExpr::SpriteAnimDone { var_name } = e {
                out.insert(var_name.clone());
            }
        });
    }
    out
}

/// Assets com tabela MUGEN: `resource -> tabelas por animacao (na ordem do asset)`.
/// `Err` = motivo que bloqueia o build (nunca aproximar em silencio).
pub(crate) fn mugen_assets(
    ast: &AstOutput,
) -> BTreeMap<String, Result<Vec<MugenAnimTable>, String>> {
    let mut out = BTreeMap::new();
    for asset in &ast.sprite_assets {
        if !asset.animations.iter().any(|a| a.mugen.is_some()) {
            continue;
        }
        out.insert(asset.resource_name.clone(), asset_tables(asset));
    }
    out
}

fn asset_tables(asset: &SpriteAsset) -> Result<Vec<MugenAnimTable>, String> {
    asset
        .animations
        .iter()
        .map(|a| match &a.mugen {
            Some(Ok(t)) => {
                for f in &t.frames {
                    let flip_x = 2 * t.anchor.0 - t.cell.0 as i32;
                    let flip_y = 2 * t.anchor.1 - t.cell.1 as i32;
                    for v in [f.dx, f.dy, f.dx + flip_x, f.dy + flip_y] {
                        if !(-128..=127).contains(&v) {
                            return Err(format!("animacao '{}': deslocamento {v} fora de -128..=127", a.name));
                        }
                    }
                }
                Ok(t.clone())
            }
            Some(Err(e)) => Err(format!("animacao '{}': {e}", a.name)),
            None => Err(format!(
                "animacao '{}' sem tabela MUGEN num sprite MUGEN (auto-animacao desligada a deixaria parada)",
                a.name
            )),
        })
        .collect()
}

/// Sprites instanciados (var -> resource) cujo asset tem tabela MUGEN.
fn mugen_vars(
    ast: &AstOutput,
    assets: &BTreeMap<String, Result<Vec<MugenAnimTable>, String>>,
) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for node in &ast.nodes {
        if let AstNode::SpawnSprite {
            var_name,
            resource_name,
            ..
        } = node
        {
            if assets.contains_key(resource_name) && !out.iter().any(|(v, _)| v == var_name) {
                out.push((var_name.clone(), resource_name.clone()));
            }
        }
    }
    out
}

/// Declaracoes (tabelas, estado e funcoes). Vazio quando nao ha sprite MUGEN.
pub(crate) fn render_decls(ast: &AstOutput) -> String {
    let assets = mugen_assets(ast);
    let done_vars = anim_done_vars(ast);
    let mut out = String::new();
    for (res, tables) in &assets {
        if let Err(e) = tables {
            out.push_str(&format!(
                "#error \"RetroDev MUGEN: sprite '{res}': {}\"\n",
                e.replace('"', "'")
            ));
        }
    }
    let vars = mugen_vars(ast, &assets);
    let any_table = assets.values().any(|t| t.is_ok());
    if !any_table {
        out.push_str(&render_done_fns(&done_vars, &vars, &assets));
        return out;
    }
    out.push_str("/* RetroDev MUGEN runtime (mugen.character.v1, Experimental) */\n");
    out.push_str("typedef struct { u8 timer; s8 dx; s8 dy; s8 fdx; s8 fdy; u8 flip; u8 c1; u8 c2; } rds_mugen_frame_t;\n");
    out.push_str("typedef struct { u8 count; u8 loop; u16 total; const rds_mugen_frame_t* frames; } rds_mugen_anim_t;\n");
    out.push_str("typedef struct { const s8* c1; const s8* c2; } rds_mugen_boxes_t;\n");
    for (res, tables) in &assets {
        let Ok(tables) = tables else { continue };
        let mut anim_rows = Vec::new();
        for (ai, t) in tables.iter().enumerate() {
            let flip_x = 2 * t.anchor.0 - t.cell.0 as i32;
            let flip_y = 2 * t.anchor.1 - t.cell.1 as i32;
            let rows: Vec<String> = t
                .frames
                .iter()
                .zip(&t.timers)
                .map(|(f, timer)| {
                    let flip = u8::from(f.hflip) | (u8::from(f.vflip) << 1);
                    let fdx = f.dx + if f.hflip { flip_x } else { 0 };
                    let fdy = f.dy + if f.vflip { flip_y } else { 0 };
                    format!(
                        "{{{timer},{},{},{fdx},{fdy},{flip},{},{}}}",
                        f.dx,
                        f.dy,
                        f.clsn1.len(),
                        f.clsn2.len()
                    )
                })
                .collect();
            out.push_str(&format!(
                "static const rds_mugen_frame_t rds_mugen_{res}_a{ai}[] = {{{}}};\n",
                rows.join(",")
            ));
            // Caixas por frame (relativas ao eixo), disponiveis para logica futura.
            for (fi, f) in t.frames.iter().enumerate() {
                for (kind, list) in [("c1", &f.clsn1), ("c2", &f.clsn2)] {
                    if list.is_empty() {
                        continue;
                    }
                    let vals: Vec<String> = list
                        .iter()
                        .flat_map(|b| b.iter().map(|v| v.clamp(&-128, &127).to_string()))
                        .collect();
                    out.push_str(&format!(
                        "static const s16 rds_mugen_{res}_a{ai}_f{fi}_{kind}[] __attribute__((unused)) = {{{}}};\n",
                        vals.join(",")
                    ));
                }
            }
            let total: u32 = if t.timers.contains(&0) {
                0
            } else {
                t.timers
                    .iter()
                    .map(|v| *v as u32)
                    .sum::<u32>()
                    .min(u16::MAX as u32)
            };
            anim_rows.push(format!(
                "{{{},{},{total},rds_mugen_{res}_a{ai}}}",
                t.frames.len(),
                t.loop_start
            ));
        }
        out.push_str(&format!(
            "static const rds_mugen_anim_t rds_mugen_{res}_anims[] = {{{}}};\n",
            anim_rows.join(",")
        ));
    }
    for (v, res) in &vars {
        if !matches!(assets.get(res), Some(Ok(_))) {
            continue;
        }
        out.push_str(&format!(
            "static u16 rds_mugen_{v}_anim = 0xFFFF;\n\
             static u16 rds_mugen_{v}_frame = 0;\n\
             static u16 rds_mugen_{v}_timer = 0;\n\
             static u16 rds_mugen_{v}_elapsed = 0;\n\
             static volatile u16 rds_mugen_{v}_done = 0;\n\
             static volatile u16 rds_mugen_{v}_clsn1 = 0;\n\
             static volatile u16 rds_mugen_{v}_clsn2 = 0;\n\
             static void rds_mugen_{v}_tick(void) {{\n\
             \x20   if (!{v}) return;\n\
             \x20   SPR_setAutoAnimation({v}, FALSE);\n\
             \x20   const u16 anim = {v}->animInd;\n\
             \x20   const rds_mugen_anim_t* a = &rds_mugen_{res}_anims[anim];\n\
             \x20   if (anim != rds_mugen_{v}_anim) {{\n\
             \x20       rds_mugen_{v}_anim = anim; rds_mugen_{v}_frame = 0;\n\
             \x20       rds_mugen_{v}_timer = a->frames[0].timer; rds_mugen_{v}_elapsed = 0;\n\
             \x20   }} else {{\n\
             \x20       if (rds_mugen_{v}_elapsed < 0xFFFF) rds_mugen_{v}_elapsed++;\n\
             \x20       if (rds_mugen_{v}_timer > 0 && --rds_mugen_{v}_timer == 0) {{\n\
             \x20           rds_mugen_{v}_frame++;\n\
             \x20           if (rds_mugen_{v}_frame >= a->count) rds_mugen_{v}_frame = a->loop;\n\
             \x20           rds_mugen_{v}_timer = a->frames[rds_mugen_{v}_frame].timer;\n\
             \x20       }}\n\
             \x20   }}\n\
             \x20   rds_mugen_{v}_done = (a->total != 0 && rds_mugen_{v}_elapsed + 1 == a->total) ? 1 : 0;\n\
             \x20   const rds_mugen_frame_t* f = &a->frames[rds_mugen_{v}_frame];\n\
             \x20   SPR_setFrame({v}, rds_mugen_{v}_frame);\n\
             \x20   SPR_setHFlip({v}, (f->flip & 1) ? TRUE : FALSE);\n\
             \x20   SPR_setVFlip({v}, (f->flip & 2) ? TRUE : FALSE);\n\
             \x20   SPR_setPosition({v}, {v}_x + f->fdx, {v}_y + f->fdy);\n\
             \x20   rds_mugen_{v}_clsn1 = f->c1; rds_mugen_{v}_clsn2 = f->c2;\n\
             }}\n"
        ));
    }
    out.push_str(&render_done_fns(&done_vars, &vars, &assets));
    out
}

fn render_done_fns(
    done_vars: &BTreeSet<String>,
    vars: &[(String, String)],
    assets: &BTreeMap<String, Result<Vec<MugenAnimTable>, String>>,
) -> String {
    done_vars
        .iter()
        .map(|v| {
            let mugen = vars
                .iter()
                .any(|(var, res)| var == v && matches!(assets.get(res), Some(Ok(_))));
            if mugen {
                format!("static inline bool rds_anim_done_{v}(void) {{ return rds_mugen_{v}_done != 0; }}\n")
            } else {
                format!("static inline bool rds_anim_done_{v}(void) {{ return {v} && SPR_isAnimationDone({v}); }}\n")
            }
        })
        .collect()
}

/// Ticks de todos os sprites MUGEN, antes de `SPR_update`.
pub(crate) fn render_ticks(ast: &AstOutput, indent: usize) -> String {
    let assets = mugen_assets(ast);
    let pad = " ".repeat(indent);
    mugen_vars(ast, &assets)
        .iter()
        .filter(|(_, res)| matches!(assets.get(res), Some(Ok(_))))
        .map(|(v, _)| format!("{pad}rds_mugen_{v}_tick();\n"))
        .collect()
}
