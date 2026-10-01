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
use crate::core::mugen_chain::{
    Cmp, Expr, Program, StateProgram, MAX_CHANGES_PER_TICK, TRACE_ENTRIES, TRACE_ENTRY_BYTES,
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

fn collect_velocity_targets(ops: &[LogicOp], out: &mut BTreeSet<String>) {
    for op in ops {
        match op {
            LogicOp::MugenSetVelocityX { target_var, .. } => {
                out.insert(target_var.clone());
            }
            LogicOp::SourceMapped { op, .. } => {
                collect_velocity_targets(std::slice::from_ref(op.as_ref()), out)
            }
            LogicOp::ConditionOverlap {
                if_true, if_false, ..
            }
            | LogicOp::ConditionBool {
                if_true, if_false, ..
            } => {
                collect_velocity_targets(if_true, out);
                collect_velocity_targets(if_false, out);
            }
            LogicOp::WhileLoop { body, done, .. } | LogicOp::ForLoop { body, done, .. } => {
                collect_velocity_targets(body, out);
                collect_velocity_targets(done, out);
            }
            LogicOp::HardwareBudgetCheck { if_ok, if_warn, .. } => {
                collect_velocity_targets(if_ok, out);
                collect_velocity_targets(if_warn, out);
            }
            LogicOp::HardwareEvent { ops, .. } => collect_velocity_targets(ops, out),
            LogicOp::StateMachine { states, .. } => {
                for state in states {
                    collect_velocity_targets(&state.body, out);
                    for t in &state.transitions {
                        collect_velocity_targets(&t.if_matched, out);
                        collect_velocity_targets(&t.if_unmatched, out);
                    }
                }
            }
            _ => {}
        }
    }
}

/// Sprites (variaveis) que recebem `MugenSetVelocityX`.
fn velocity_targets(ast: &AstOutput) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for script in &ast.logic_scripts {
        collect_velocity_targets(&script.ops, &mut out);
    }
    out
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
    for target in velocity_targets(ast) {
        let ok = vars
            .iter()
            .any(|(v, res)| *v == target && matches!(assets.get(res), Some(Ok(_))));
        if !ok {
            out.push_str(&format!(
                "#error \"RetroDev MUGEN: VelSet em '{target}' que nao tem tabela MUGEN valida (sem runtime para integrar a velocidade)\"\n"
            ));
        }
    }
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
             static volatile u16 rds_mugen_{v}_restart = 0;\n\
             static volatile u16 rds_mugen_{v}_clsn1 = 0;\n\
             static volatile u16 rds_mugen_{v}_clsn2 = 0;\n\
             static volatile s16 rds_mugen_{v}_vx = 0;\n\
             static s16 rds_mugen_{v}_xacc = 0;\n\
             static void rds_mugen_{v}_tick(void) {{\n\
             \x20   if (!{v}) return;\n\
             \x20   SPR_setAutoAnimation({v}, FALSE);\n\
             \x20   const u16 anim = {v}->animInd;\n\
             \x20   const rds_mugen_anim_t* a = &rds_mugen_{res}_anims[anim];\n\
             \x20   if (anim != rds_mugen_{v}_anim || rds_mugen_{v}_restart) {{\n\
             \x20       rds_mugen_{v}_restart = 0;\n\
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
             \x20   {{ s32 acc = (s32)rds_mugen_{v}_xacc + (s32)rds_mugen_{v}_vx; s32 step = acc >> 8; rds_mugen_{v}_xacc = (s16)(acc - (step << 8)); {v}_x += (s16)step; }}\n\
             \x20   SPR_setPosition({v}, {v}_x + f->fdx, {v}_y + f->fdy);\n\
             \x20   rds_mugen_{v}_clsn1 = f->c1; rds_mugen_{v}_clsn2 = f->c2;\n\
             }}\n"
        ));
    }
    out.push_str(&render_programs(ast, &assets, &vars));
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

// ------------------------------------------------------------------ programa de estados
// Perfil `mugen.original_chain.v1`: ver `core/mugen_chain.rs` e CONTRACT.md («Cadeia
// original»). Ordem por tick (documentada, nao presumida do motor original):
//   1. amostra do pad e comandos (borda de subida/segurado/soltura, time = 1);
//   2. controladores do estado -1, em ordem; ChangeState aborta o resto e entra no novo
//      estado NO MESMO tick (Statedef ctrl/velset/anim, depois o `ctrl` do ChangeState);
//   3. controladores do estado atual, do comeco, com o mesmo reinicio ao mudar;
//   4. rastro na RAM, depois Time e o relogio da animacao avancam.
// `AnimTime` = ticks desde a entrada da animacao - soma das duracoes do AIR.

fn visit_ops(ops: &[LogicOp], f: &mut dyn FnMut(&LogicOp)) {
    for op in ops {
        f(op);
        match op {
            LogicOp::SourceMapped { op, .. } => visit_ops(std::slice::from_ref(op.as_ref()), f),
            LogicOp::ConditionOverlap {
                if_true, if_false, ..
            }
            | LogicOp::ConditionBool {
                if_true, if_false, ..
            } => {
                visit_ops(if_true, f);
                visit_ops(if_false, f);
            }
            LogicOp::WhileLoop { body, done, .. } | LogicOp::ForLoop { body, done, .. } => {
                visit_ops(body, f);
                visit_ops(done, f);
            }
            LogicOp::HardwareBudgetCheck { if_ok, if_warn, .. } => {
                visit_ops(if_ok, f);
                visit_ops(if_warn, f);
            }
            LogicOp::HardwareEvent { ops, .. } => visit_ops(ops, f),
            LogicOp::StateMachine { states, .. } => {
                for state in states {
                    visit_ops(&state.body, f);
                    for t in &state.transitions {
                        visit_ops(&t.if_matched, f);
                        visit_ops(&t.if_unmatched, f);
                    }
                }
            }
            _ => {}
        }
    }
}

/// Programas por sprite (variavel). Dois programas para o mesmo sprite sao recusados.
pub(crate) fn mugen_programs(ast: &AstOutput) -> Vec<(String, Program)> {
    let mut out: Vec<(String, Program)> = Vec::new();
    for script in &ast.logic_scripts {
        visit_ops(&script.ops, &mut |op| {
            if let LogicOp::MugenProgramStep {
                target_var,
                program,
            } = op
            {
                out.push((target_var.clone(), (**program).clone()));
            }
        });
    }
    out
}

fn c_expr(v: &str, e: &Expr, cmd_index: &BTreeMap<&str, usize>) -> String {
    let cmp = |o: &Cmp| o.c_op();
    match e {
        Expr::Always => "1".into(),
        Expr::Command { name, negate } => {
            let i = cmd_index.get(name.as_str()).copied().unwrap_or(0);
            format!(
                "((cmd & (u16)(1u << {i})) {} 0)",
                if *negate { "==" } else { "!=" }
            )
        }
        Expr::StateType { value, negate } => format!(
            "(rds_mc_{v}_statetype {} '{value}')",
            if *negate { "!=" } else { "==" }
        ),
        Expr::Ctrl { op, value } => format!("((s16)rds_mc_{v}_ctrl {} {value})", cmp(op)),
        Expr::StateNo { op, value } => format!("((s16)rds_mc_{v}_stateno {} {value})", cmp(op)),
        Expr::Time { op, value } => format!("((s16)rds_mc_{v}_time {} {value})", cmp(op)),
        Expr::AnimTime { op, value } => format!(
            "(((s16)rds_mc_{v}_animtick - (s16)rds_mc_{v}_animtotal) {} {value})",
            cmp(op)
        ),
    }
}

fn c_condition(
    v: &str,
    c: &crate::core::mugen_chain::Controller,
    cmd_index: &BTreeMap<&str, usize>,
) -> String {
    let conj = |ts: &[crate::core::mugen_chain::Trigger]| -> String {
        ts.iter()
            .map(|t| c_expr(v, &t.expr, cmd_index))
            .collect::<Vec<_>>()
            .join(" && ")
    };
    let groups = c
        .groups
        .iter()
        .map(|g| format!("({})", conj(g)))
        .collect::<Vec<_>>()
        .join(" || ");
    if c.all.is_empty() {
        format!("({groups})")
    } else {
        format!("({}) && ({groups})", conj(&c.all))
    }
}

fn c_enter(
    v: &str,
    res: &str,
    st: &StateProgram,
    action_index: &dyn Fn(i32) -> Option<usize>,
) -> Result<String, String> {
    let mut body = String::new();
    if let Some(t) = &st.statetype {
        body.push_str(&format!("rds_mc_{v}_statetype = '{t}'; "));
    }
    if let Some(c) = st.ctrl {
        body.push_str(&format!("rds_mc_{v}_ctrl = {}; ", u8::from(c)));
    }
    if let Some(q) = st.velset_q8 {
        body.push_str(&format!("rds_mugen_{v}_vx = {q}; "));
    }
    if let Some(a) = st.anim {
        let i = action_index(a)
            .ok_or_else(|| format!("estado {}: anim {a} nao esta no atlas do sprite", st.no))?;
        body.push_str(&format!(
            "SPR_setAnim({v}, {i}); rds_mugen_{v}_restart = 1; rds_mc_{v}_animtick = 0; \
             rds_mc_{v}_animtotal = rds_mugen_{res}_anims[{i}].total; rds_mc_{v}_action = {a}; "
        ));
    }
    Ok(format!("        case {}: {body}break;\n", st.no))
}

fn render_programs(
    ast: &AstOutput,
    assets: &BTreeMap<String, Result<Vec<MugenAnimTable>, String>>,
    vars: &[(String, String)],
) -> String {
    let programs = mugen_programs(ast);
    if programs.is_empty() {
        return String::new();
    }
    let mut out = format!(
        "/* RetroDev MUGEN state program (mugen.original_chain.v1, Experimental) */\n\
         typedef struct {{ u16 tick; u16 stateno; u16 time; u16 flags; u16 action; u16 cmd; u16 pad; u16 animtick; s16 vx; s16 x; u16 vt; }} rds_mc_trace_t;\n\
         _Static_assert(sizeof(rds_mc_trace_t) == {TRACE_ENTRY_BYTES}, \"rds_mc_trace_t != contrato do rastreio\");\n"
    );
    let mut seen = BTreeSet::new();
    for (v, program) in &programs {
        if !seen.insert(v.clone()) {
            out.push_str(&format!(
                "#error \"RetroDev MUGEN: dois programas de estado para o sprite '{v}'\"\n"
            ));
            continue;
        }
        let Some((_, res)) = vars.iter().find(|(var, _)| var == v) else {
            out.push_str(&format!(
                "#error \"RetroDev MUGEN: programa de estado em '{v}' sem tabela MUGEN valida\"\n"
            ));
            continue;
        };
        if !matches!(assets.get(res), Some(Ok(_))) {
            out.push_str(&format!(
                "#error \"RetroDev MUGEN: programa de estado em '{v}' sem tabela MUGEN valida\"\n"
            ));
            continue;
        }
        if let Err(e) = program.validate() {
            out.push_str(&format!(
                "#error \"RetroDev MUGEN: programa invalido: {}\"\n",
                e.replace('"', "'")
            ));
            continue;
        }
        let Some(asset) = ast.sprite_assets.iter().find(|a| a.resource_name == *res) else {
            continue;
        };
        let action_index = |n: i32| {
            let name = format!("action_{n}");
            asset.animations.iter().position(|a| a.name == name)
        };
        match render_program(v, res, program, &action_index) {
            Ok(text) => out.push_str(&text),
            Err(e) => out.push_str(&format!(
                "#error \"RetroDev MUGEN: programa de estado: {}\"\n",
                e.replace('"', "'")
            )),
        }
    }
    out
}

fn render_program(
    v: &str,
    res: &str,
    p: &Program,
    action_index: &dyn Fn(i32) -> Option<usize>,
) -> Result<String, String> {
    let cmd_index: BTreeMap<&str, usize> = p
        .commands
        .iter()
        .enumerate()
        .map(|(i, c)| (c.name.as_str(), i))
        .collect();
    let mut o = String::new();
    o.push_str(&format!(
        "/* programa {} (digest {}) */\n\
         static volatile rds_mc_trace_t rds_mc_{v}_trace[{TRACE_ENTRIES}];\n\
         static volatile u16 rds_mc_{v}_trace_n = 0;\n\
         static volatile u16 rds_mc_{v}_tick = 0;\n\
         static volatile u16 rds_mc_{v}_stateno = 0;\n\
         static volatile u16 rds_mc_{v}_time = 0;\n\
         static volatile u16 rds_mc_{v}_ctrl = 0;\n\
         static volatile u16 rds_mc_{v}_statetype = 'S';\n\
         static volatile u16 rds_mc_{v}_cmd = 0;\n\
         static volatile u16 rds_mc_{v}_pad = 0;\n\
         static volatile u16 rds_mc_{v}_action = 0;\n\
         static volatile u16 rds_mc_{v}_animtick = 0;\n\
         static volatile u16 rds_mc_{v}_animtotal = 0;\n\
         static volatile u16 rds_mc_{v}_changes = 0;\n\
         static u16 rds_mc_{v}_prev = 0;\n\
         static u8 rds_mc_{v}_started = 0;\n",
        p.entity, p.digest
    ));
    o.push_str(&format!("static void rds_mc_{v}_enter(u16 no) {{\n    rds_mc_{v}_stateno = no; rds_mc_{v}_time = 0; rds_mc_{v}_changes++;\n    switch (no) {{\n"));
    for st in &p.states {
        o.push_str(&c_enter(v, res, st, action_index)?);
    }
    o.push_str("        default: break;\n    }\n}\n");
    let port = match p.pad.as_str() {
        "JOY_1" | "JOY_2" | "JOY_3" | "JOY_4" => p.pad.as_str(),
        other => return Err(format!("pad '{other}' invalido")),
    };
    o.push_str(&format!(
        "static void rds_mc_{v}_step(void) {{\n\
         \x20   const u16 pad = JOY_readJoypad({port});\n\
         \x20   const u16 pressed = (u16)(pad & (u16)~rds_mc_{v}_prev);\n\
         \x20   const u16 released = (u16)((u16)~pad & rds_mc_{v}_prev);\n\
         \x20   u16 cmd = 0;\n\
         \x20   u8 guard = 0;\n\
         \x20   (void)pressed; (void)released;\n"
    ));
    for (i, c) in p.commands.iter().enumerate() {
        let cond = match (c.kind.as_str(), &c.button, &c.dir) {
            (k, Some(b), _) => {
                let md = p
                    .bindings
                    .get(b.as_str())
                    .ok_or_else(|| format!("botao '{b}' sem ligacao"))?;
                match k {
                    "press" => format!("(pressed & {md})"),
                    "hold" => format!("(pad & {md})"),
                    "release" => format!("(released & {md})"),
                    other => return Err(format!("tipo de comando '{other}' invalido")),
                }
            }
            (_, None, Some(d)) => {
                let bit = match d.as_str() {
                    "U" => "BUTTON_UP",
                    "D" => "BUTTON_DOWN",
                    "F" => "BUTTON_RIGHT", // facing fixo a direita no perfil
                    "B" => "BUTTON_LEFT",
                    other => return Err(format!("direcao '{other}' invalida")),
                };
                if c.any_dir {
                    format!("(pad & {bit})")
                } else {
                    format!(
                        "((pad & (BUTTON_UP | BUTTON_DOWN | BUTTON_LEFT | BUTTON_RIGHT)) == {bit})"
                    )
                }
            }
            _ => return Err(format!("comando '{}' invalido", c.name)),
        };
        o.push_str(&format!("    if ({cond}) cmd |= (u16)(1u << {i});\n"));
    }
    o.push_str(&format!(
        "    rds_mc_{v}_cmd = cmd; rds_mc_{v}_prev = pad; rds_mc_{v}_pad = pad;\n\
         \x20   if (!rds_mc_{v}_started) {{ rds_mc_{v}_started = 1; rds_mc_{v}_enter({}); rds_mc_{v}_changes = 0; }}\n",
        p.initial_state
    ));
    let transition = |o: &mut String, c: &crate::core::mugen_chain::Controller, pad: &str| {
        let ctrl = c
            .set_ctrl
            .map(|b| format!(" rds_mc_{v}_ctrl = {};", u8::from(b)))
            .unwrap_or_default();
        o.push_str(&format!(
            "{pad}if ({}) {{ rds_mc_{v}_enter({});{ctrl} if (++guard >= {MAX_CHANGES_PER_TICK}) goto rds_mc_{v}_done; goto rds_mc_{v}_run; }}\n",
            c_condition(v, c, &cmd_index),
            c.target
        ));
    };
    for c in &p.special {
        transition(&mut o, c, "    ");
    }
    o.push_str(&format!(
        "rds_mc_{v}_run:\n    switch (rds_mc_{v}_stateno) {{\n"
    ));
    for st in &p.states {
        if st.controllers.is_empty() {
            continue;
        }
        o.push_str(&format!("    case {}:\n", st.no));
        for c in &st.controllers {
            transition(&mut o, c, "        ");
        }
        o.push_str("        break;\n");
    }
    o.push_str("    default: break;\n    }\n");
    o.push_str(&format!(
        "rds_mc_{v}_done:\n\
         \x20   {{\n\
         \x20       volatile rds_mc_trace_t* t = &rds_mc_{v}_trace[rds_mc_{v}_trace_n % {TRACE_ENTRIES}];\n\
         \x20       t->tick = rds_mc_{v}_tick; t->stateno = rds_mc_{v}_stateno; t->time = rds_mc_{v}_time;\n\
         \x20       t->flags = (u16)((rds_mc_{v}_ctrl ? 1 : 0) | ((rds_mc_{v}_statetype & 0xFF) << 8));\n\
         \x20       t->action = rds_mc_{v}_action; t->cmd = rds_mc_{v}_cmd; t->pad = rds_mc_{v}_pad; t->animtick = rds_mc_{v}_animtick; t->vx = rds_mugen_{v}_vx; t->x = {v}_x; t->vt = (u16)vtimer;\n\
         \x20       rds_mc_{v}_trace_n++;\n\
         \x20   }}\n\
         \x20   rds_mc_{v}_tick++; rds_mc_{v}_time++; rds_mc_{v}_animtick++;\n\
         }}\n"
    ));
    Ok(o)
}
