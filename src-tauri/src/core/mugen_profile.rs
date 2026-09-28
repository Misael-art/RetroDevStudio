//! Adaptador do perfil `mugen.character.v1` (crate `rex-mugen`) ao modelo do produto.
//! Experimental. Contrato: `crates/rex-mugen/CONTRACT.md`.
//!
//! O importador canonico (`project_mgr::import_mugen_character_candidate`) chama este
//! modulo para AIR/SFF v1 (parsers da crate), atlas na grade do VDP, animacoes com tempo
//! por frame, e para ligar ao NodeGraph o subconjunto de comportamento que o compilador
//! executa. DEF/CMD/CNS continuam nos parsers canonicos do produto.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Component, Path, PathBuf};

use image::{ImageBuffer, Rgba, RgbaImage};
use rex_mugen::diag::{Diagnostic, Fidelity, Severity};
use rex_mugen::{air, plan, sff, sha256::sha256_hex};

use crate::core::project_mgr::LoadError;
use crate::ugdm::components::{AnimationDef, MugenAnimationFrame, MugenCollisionBox, Pivot};

pub const REPORT_SCHEMA: &str = "retrodev.mugen_import_report/v1";
pub const MAX_TEXT_BYTES: u64 = 1024 * 1024;

/// Resolve `rel` dentro de `root`; recusa caminho absoluto, `..` que escape e link para fora.
pub(crate) fn resolve_inside(root: &Path, rel: &str) -> Result<PathBuf, LoadError> {
    let rel_path = Path::new(rel.trim().trim_matches('"'));
    if rel_path.is_absolute()
        || rel_path
            .components()
            .any(|c| matches!(c, Component::Prefix(_) | Component::RootDir))
    {
        return Err(LoadError(format!(
            "caminho '{rel}' absoluto recusado no pacote MUGEN"
        )));
    }
    let joined = root.join(rel_path);
    let canon_root = root
        .canonicalize()
        .map_err(|e| LoadError(format!("raiz '{}' invalida: {e}", root.display())))?;
    let canon = joined
        .canonicalize()
        .map_err(|e| LoadError(format!("arquivo '{rel}' ausente ou ilegivel: {e}")))?;
    if !canon.starts_with(&canon_root) {
        return Err(LoadError(format!(
            "caminho '{rel}' sai do pacote MUGEN; recusado"
        )));
    }
    Ok(canon)
}

pub(crate) fn read_limited(path: &Path, max: u64) -> Result<Vec<u8>, LoadError> {
    let len = fs::metadata(path)
        .map_err(|e| LoadError(format!("'{}' ilegivel: {e}", path.display())))?
        .len();
    if len > max {
        return Err(LoadError(format!(
            "'{}' tem {len} bytes, acima do limite de {max}",
            path.display()
        )));
    }
    fs::read(path).map_err(|e| LoadError(format!("'{}' ilegivel: {e}", path.display())))
}

fn diag_json(d: &Diagnostic) -> serde_json::Value {
    serde_json::json!({
        "code": d.code, "severity": d.severity.as_str(), "source": d.source.render(),
        "message": d.message, "action": d.action,
    })
}

pub(crate) struct Converted {
    pub atlas: RgbaImage,
    pub cell_w: u32,
    pub cell_h: u32,
    pub pivot: Pivot,
    pub animations: BTreeMap<String, AnimationDef>,
    /// Relatorio `retrodev.mugen_import_report/v1` (recursos; o comportamento e anexado depois).
    pub report: serde_json::Value,
}

/// Converte AIR + SFF v1 pelo perfil. `Ok(None)` = o SFF nao e v1 legivel: o chamador pode
/// usar o caminho legado (PNGs extraidos), que o relatorio classifica a parte.
pub(crate) fn convert_character_v1(
    root: &Path,
    air_rel: &str,
    sff_rel: &str,
) -> Result<Option<Converted>, LoadError> {
    let air_path = resolve_inside(root, air_rel)?;
    let air_bytes = read_limited(&air_path, MAX_TEXT_BYTES)?;
    let air_text = String::from_utf8_lossy(&air_bytes).to_string();
    let air_doc = air::parse(&air_text, air_rel);
    let Ok(sff_path) = resolve_inside(root, sff_rel) else {
        return Ok(None);
    };
    let sff_bytes = read_limited(&sff_path, sff::MAX_FILE_BYTES as u64)?;
    let sff_doc = match sff::parse(&sff_bytes, sff_rel) {
        Ok(doc) => doc,
        Err(_) => return Ok(None),
    };
    let (air_sha, sff_sha) = (sha256_hex(&air_bytes), sha256_hex(&sff_bytes));
    let planned = plan::plan(&plan::Inputs {
        air: &air_doc,
        air_sha256: &air_sha,
        sff: &sff_doc,
        sff_sha256: &sff_sha,
        actions: &[],
    })
    .map_err(|diags| {
        LoadError(format!(
            "Conversao MUGEN recusada: {}",
            diags
                .iter()
                .filter(|d| d.severity == Severity::Error)
                .map(|d| format!("{} ({}): {}", d.code, d.source.render(), d.message))
                .collect::<Vec<_>>()
                .join("; ")
        ))
    })?;
    // Atlas: celulas na ordem do plano (actions com sprite ausente nao sao convertidas).
    let count = planned.cells.len();
    let cols = (count as f64).sqrt().ceil().max(1.0) as usize;
    let rows = count.div_ceil(cols);
    let (cw, ch) = (planned.cell_w, planned.cell_h);
    let mut atlas: RgbaImage =
        ImageBuffer::from_pixel((cols * cw) as u32, (rows * ch) as u32, Rgba([0, 0, 0, 0]));
    for i in 0..planned.cells.len() {
        let (ox, oy) = ((i % cols) * cw, (i / cols) * ch);
        for (p, px) in planned.render_cell(&sff_doc, i).into_iter().enumerate() {
            if let Some(c) = px {
                atlas.put_pixel(
                    (ox + p % cw) as u32,
                    (oy + p / cw) as u32,
                    Rgba([c[0], c[1], c[2], 255]),
                );
            }
        }
    }
    let mut animations = BTreeMap::new();
    for a in planned.actions.values() {
        let durations: Vec<i32> = a
            .frames
            .iter()
            .map(|f| if f.timer == 0 { -1 } else { f.timer as i32 })
            .collect();
        let positive: Vec<i32> = durations.iter().copied().filter(|d| *d > 0).collect();
        let avg = if positive.is_empty() {
            1.0
        } else {
            positive.iter().sum::<i32>() as f32 / positive.len() as f32
        };
        let boxes = |list: &[air::Box]| {
            list.iter()
                .map(|b| MugenCollisionBox {
                    x1: b.x1,
                    y1: b.y1,
                    x2: b.x2,
                    y2: b.y2,
                })
                .collect::<Vec<_>>()
        };
        animations.insert(
            format!("action_{}", a.number),
            AnimationDef {
                frames: a
                    .frames
                    .iter()
                    .map(|f| f.cell.expect("plano so mantem actions completas") as u32)
                    .collect(),
                fps: (60.0 / avg.max(1.0)).round().clamp(1.0, 60.0) as u32,
                // MUGEN sempre repete a animacao (frame -1 a segura).
                looping: true,
                frame_durations: Some(durations.clone()),
                loop_start: Some(a.loopstart as u32),
                mugen_frames: Some(
                    a.frames
                        .iter()
                        .zip(&durations)
                        .map(|(f, d)| MugenAnimationFrame {
                            group: f.sprite.0,
                            image: f.sprite.1,
                            axis: Some(Pivot { x: f.x, y: f.y }),
                            duration: *d,
                            flags: {
                                let mut flip = String::new();
                                if f.hflip {
                                    flip.push('H');
                                }
                                if f.vflip {
                                    flip.push('V');
                                }
                                if flip.is_empty() {
                                    Vec::new()
                                } else {
                                    vec![flip]
                                }
                            },
                            clsn1: boxes(&f.clsn1),
                            clsn2: boxes(&f.clsn2),
                        })
                        .collect(),
                ),
                onion_skin: None,
                hitboxes: Vec::new(),
            },
        );
    }
    let report = serde_json::json!({
        "schema": REPORT_SCHEMA,
        "profile": plan::PROFILE_ID,
        "maturity": "Experimental",
        "sources": {
            air_rel: {"sha256": air_sha},
            sff_rel: {"sha256": sff_sha, "version": format!("{}.{}.{}.{}", sff_doc.version[0], sff_doc.version[1], sff_doc.version[2], sff_doc.version[3])},
        },
        "cell": {"width": cw, "height": ch, "anchor": [planned.anchor_x, planned.anchor_y]},
        "runtime_needs": {"loopstart": planned.needs_runtime.loopstart, "frame_table": planned.needs_runtime.frame_table, "clsn_table": planned.needs_runtime.clsn_table},
        "resources": planned.provenance.iter().map(|p| serde_json::json!({
            "item": p.item, "source": p.source.render(), "source_sha256": p.source_sha256,
            "transform": p.transform,
            "target": if p.item.starts_with("anim:") { format!("sprite.animations.action_{}", &p.item[5..]) } else { "sprite.asset (atlas)".to_string() },
            "fidelity": p.fidelity.as_str(), "reason": p.reason, "consequence": p.consequence,
        })).collect::<Vec<_>>(),
        "metrics": planned.metrics.iter().map(|m| serde_json::json!({
            "name": m.name, "unit": m.unit, "value": m.value, "origin": m.origin.as_str(),
            "window": m.window, "availability": m.availability, "subject": m.subject.render(),
            "budget": m.budget, "over_budget": m.over_budget(),
        })).collect::<Vec<_>>(),
        "diagnostics": planned.diagnostics.iter().map(diag_json).collect::<Vec<_>>(),
        "fidelity_policy": {
            "direct": Fidelity::Direct.as_str(), "approximate": Fidelity::Approximate.as_str(),
            "manual": Fidelity::Manual.as_str(), "unsupported": Fidelity::Unsupported.as_str(),
        },
    });
    Ok(Some(Converted {
        atlas,
        cell_w: cw as u32,
        cell_h: ch as u32,
        pivot: Pivot {
            x: planned.anchor_x as i32,
            y: planned.anchor_y as i32,
        },
        animations,
        report,
    }))
}

// ---------------------------------------------------------------- comportamento

/// Vista minima de um `[Statedef]` do modelo canonico.
pub(crate) struct StateView {
    pub state_no: i32,
    pub anim: Option<String>,
    pub source: String,
}

/// Vista minima de um `[State]` (controller) do modelo canonico.
pub(crate) struct ControllerView {
    pub index: usize,
    pub state_no: Option<i32>,
    pub kind: String,
    pub name: String,
    pub raw_lines: Vec<String>,
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Cond {
    Command(String),
    StateNo(i32),
    AnimDone,
}

fn parse_trigger(expr: &str) -> Result<Cond, String> {
    let e: String = expr.chars().filter(|c| !c.is_whitespace()).collect();
    let lower = e.to_ascii_lowercase();
    if let Some(rest) = lower.strip_prefix("command=") {
        let name = rest.trim_matches('"');
        if rest.starts_with('"') && rest.ends_with('"') && rest.len() >= 2 && !name.is_empty() {
            // preserva a grafia original do nome do comando
            let start = e.find('"').unwrap() + 1;
            let end = e.rfind('"').unwrap();
            return Ok(Cond::Command(e[start..end].to_string()));
        }
    }
    if let Some(rest) = lower.strip_prefix("stateno=") {
        if let Ok(k) = rest.parse::<i32>() {
            return Ok(Cond::StateNo(k));
        }
    }
    if lower == "animtime=0" {
        return Ok(Cond::AnimDone);
    }
    Err(format!(
        "gatilho '{}' fora do perfil v1 (command=\"x\", stateno=K, AnimTime=0)",
        expr.trim()
    ))
}

fn controller_value(raw: &[String]) -> Option<i32> {
    raw.iter().find_map(|l| {
        let (k, v) = l.split_once('=')?;
        (k.trim().eq_ignore_ascii_case("value")).then(|| v.trim().parse::<i32>().ok())?
    })
}

/// Grupos de gatilho: (`triggerall`, `trigger<N>` por N). Mantem linhas repetidas.
fn trigger_groups(raw: &[String]) -> (Vec<String>, BTreeMap<u32, Vec<String>>) {
    let mut all = Vec::new();
    let mut groups: BTreeMap<u32, Vec<String>> = BTreeMap::new();
    for line in raw {
        let line = line.split(';').next().unwrap_or("");
        let Some((k, v)) = line.split_once('=') else {
            continue;
        };
        let k = k.trim().to_ascii_lowercase();
        if k == "triggerall" {
            all.push(v.trim().to_string());
        } else if let Some(n) = k
            .strip_prefix("trigger")
            .and_then(|n| n.parse::<u32>().ok())
        {
            groups.entry(n).or_default().push(v.trim().to_string());
        }
    }
    (all, groups)
}

fn node(
    id: &str,
    kind: &str,
    label: &str,
    x: i32,
    y: i32,
    params: serde_json::Value,
) -> serde_json::Value {
    let (inputs, outputs) = match kind {
        "fsm_state" => (
            serde_json::json!([]),
            serde_json::json!([
                { "id": "exec", "label": "Body >", "kind": "exec" },
                { "id": "transitions", "label": "Transitions >", "kind": "exec" }
            ]),
        ),
        "fsm_transition" => (
            serde_json::json!([
                { "id": "exec", "label": ">", "kind": "exec" },
                { "id": "condition", "label": "Condition", "kind": "data", "dataType": "bool" }
            ]),
            serde_json::json!([
                { "id": "matched", "label": "Matched >", "kind": "exec" },
                { "id": "next", "label": "Next >", "kind": "exec" }
            ]),
        ),
        "sprite_anim_done" => (
            serde_json::json!([]),
            serde_json::json!([{ "id": "value", "label": "Done", "kind": "data", "dataType": "bool" }]),
        ),
        "logic_and" => (
            serde_json::json!([
                { "id": "a", "label": "A", "kind": "data", "dataType": "bool" },
                { "id": "b", "label": "B", "kind": "data", "dataType": "bool" }
            ]),
            serde_json::json!([{ "id": "value", "label": "A and B", "kind": "data", "dataType": "bool" }]),
        ),
        _ => (
            serde_json::json!([{ "id": "exec", "label": ">", "kind": "exec" }]),
            serde_json::json!([{ "id": "exec", "label": ">", "kind": "exec" }]),
        ),
    };
    serde_json::json!({ "id": id, "type": kind, "label": label, "x": x, "y": y,
        "inputs": inputs, "outputs": outputs, "params": params })
}

fn edge(id: &str, from: &str, from_port: &str, to: &str, to_port: &str) -> serde_json::Value {
    serde_json::json!({ "id": id, "fromNode": from, "fromPort": from_port, "toNode": to, "toPort": to_port })
}

/// (item do relatorio, condicoes, estado alvo, controller de origem).
type PlannedTransition<'a> = (String, Vec<Cond>, i32, &'a ControllerView);

pub(crate) struct Wired {
    pub nodes: Vec<serde_json::Value>,
    pub edges: Vec<serde_json::Value>,
    /// Classificacao de cada statedef e controller (relatorio `behavior`).
    pub report: Vec<serde_json::Value>,
    /// Controllers ja representados (o chamador nao gera outro no para eles).
    pub handled: std::collections::BTreeSet<usize>,
}

/// Liga ao NodeGraph o subconjunto executavel do perfil v1:
/// * cada `[Statedef S]` (S >= 0) vira `fsm_state` cujo corpo seleciona `anim`;
/// * `ChangeState` com gatilhos `command = "x"`, `stateno = K`, `AnimTime = 0`
///   (AND de `triggerall` + um unico `trigger1`) vira `fsm_transition` com condicao real;
///   em `[Statedef -1]` vale para todo estado (ou so para `stateno = K`), antes das
///   transicoes do proprio estado (ordem do MUGEN);
/// * qualquer outro gatilho ou alvo inexistente: ponte explicita, sem transicao.
pub(crate) fn wire_behavior_v1(
    entity_id: &str,
    states: &[StateView],
    controllers: &[ControllerView],
    command_nodes: &BTreeMap<String, String>,
    animations: &BTreeMap<String, AnimationDef>,
) -> Wired {
    let mut w = Wired {
        nodes: Vec::new(),
        edges: Vec::new(),
        report: Vec::new(),
        handled: Default::default(),
    };
    let playable: Vec<&StateView> = states.iter().filter(|s| s.state_no >= 0).collect();
    let state_id = |n: i32| format!("fsm_state_{n}");
    for (row, st) in playable.iter().enumerate() {
        let y = 80 + row as i32 * 120;
        w.nodes.push(node(&state_id(st.state_no), "fsm_state", &format!("State {}", st.state_no), 420, y,
            serde_json::json!({ "state_name": format!("state_{}", st.state_no), "state_no": st.state_no,
                "anim": st.anim.clone().unwrap_or_default(), "source": st.source,
                "initial": if st.state_no == 0 { 1 } else { 0 } })));
        let anim_key = st
            .anim
            .as_deref()
            .and_then(|a| a.trim().parse::<i32>().ok())
            .map(|a| format!("action_{a}"));
        match anim_key.filter(|k| animations.contains_key(k)) {
            Some(key) => {
                let id = format!("state_{}_anim", st.state_no);
                w.nodes.push(node(&id, "set_animation_state", &format!("Anim {key}"), 640, y,
                    serde_json::json!({ "target": entity_id, "state": key })));
                w.edges.push(edge(&format!("e_{id}"), &state_id(st.state_no), "exec", &id, "exec"));
                w.report.push(serde_json::json!({ "item": format!("statedef:{}", st.state_no), "source": st.source,
                    "fidelity": "direct", "target": state_id(st.state_no),
                    "reason": format!("anim = {} selecionada a cada quadro no estado", st.anim.clone().unwrap_or_default()),
                    "consequence": "a animacao do estado e a do AIR" }));
            }
            None => w.report.push(serde_json::json!({ "item": format!("statedef:{}", st.state_no), "source": st.source,
                "fidelity": "approximate", "target": state_id(st.state_no),
                "reason": format!("anim '{}' ausente ou nao convertida", st.anim.clone().unwrap_or_default()),
                "consequence": "o estado mantem a animacao anterior" })),
        }
    }
    // transicoes por estado de origem, na ordem: -1 primeiro, depois as do proprio estado
    let mut per_state: BTreeMap<i32, Vec<PlannedTransition>> = BTreeMap::new();
    let ordered: Vec<&ControllerView> = controllers
        .iter()
        .filter(|c| c.state_no == Some(-1))
        .chain(controllers.iter().filter(|c| c.state_no != Some(-1)))
        .collect();
    for c in ordered {
        if !c.kind.eq_ignore_ascii_case("changestate") {
            continue;
        }
        let item = format!(
            "controller:{}#{}",
            c.state_no.map(|s| s.to_string()).unwrap_or("?".into()),
            c.name
        );
        let refuse = |w: &mut Wired, why: String| {
            w.report.push(
                serde_json::json!({ "item": item, "source": c.source, "fidelity": "unsupported",
                "target": serde_json::Value::Null, "reason": why,
                "consequence": "a mudanca de estado nao acontece no jogo convertido" }),
            );
        };
        let Some(target) = controller_value(&c.raw_lines) else {
            refuse(&mut w, "value ausente ou nao numerico".into());
            continue;
        };
        if !playable.iter().any(|s| s.state_no == target) {
            refuse(&mut w, format!("estado alvo {target} nao existe"));
            continue;
        }
        let (all, groups) = trigger_groups(&c.raw_lines);
        if groups.len() != 1 || !groups.contains_key(&1) {
            refuse(
                &mut w,
                format!(
                    "{} grupos trigger<N> (perfil v1 aceita exatamente trigger1)",
                    groups.len()
                ),
            );
            continue;
        }
        let parsed: Result<Vec<Cond>, String> = all
            .iter()
            .chain(groups[&1].iter())
            .map(|t| parse_trigger(t))
            .collect();
        let conds = match parsed {
            Ok(v) => v,
            Err(e) => {
                refuse(&mut w, e);
                continue;
            }
        };
        let restrict: Vec<i32> = conds
            .iter()
            .filter_map(|c| {
                if let Cond::StateNo(k) = c {
                    Some(*k)
                } else {
                    None
                }
            })
            .collect();
        let runtime: Vec<Cond> = conds
            .iter()
            .filter(|c| !matches!(c, Cond::StateNo(_)))
            .cloned()
            .collect();
        if runtime.is_empty() {
            refuse(&mut w, "sem condicao executavel (so stateno)".into());
            continue;
        }
        if let Some(Cond::Command(name)) = runtime
            .iter()
            .find(|c| matches!(c, Cond::Command(n) if !command_nodes.contains_key(n)))
        {
            refuse(&mut w, format!("comando '{name}' nao definido no CMD"));
            continue;
        }
        let sources: Vec<i32> = match c.state_no {
            Some(-1) => playable
                .iter()
                .map(|s| s.state_no)
                .filter(|s| restrict.iter().all(|k| k == s))
                .collect(),
            Some(s) if s >= 0 => {
                if restrict.iter().all(|k| *k == s) {
                    vec![s]
                } else {
                    vec![]
                }
            }
            _ => {
                refuse(&mut w, "statedef de origem nao suportado (-2/-3)".into());
                continue;
            }
        };
        if sources.is_empty() {
            refuse(&mut w, "stateno nunca satisfeito".into());
            continue;
        }
        w.handled.insert(c.index);
        for s in &sources {
            per_state
                .entry(*s)
                .or_default()
                .push((item.clone(), runtime.clone(), target, c));
        }
        w.report.push(serde_json::json!({ "item": item, "source": c.source, "fidelity": "direct",
            "target": sources.iter().map(|s| format!("{}->state_{target}", state_id(*s))).collect::<Vec<_>>(),
            "reason": format!("ChangeState {target} com {:?}", runtime),
            "consequence": "transicao avaliada a cada quadro, antes do tick de animacao" }));
    }
    for (src, list) in &per_state {
        let mut prev: Option<(String, &str)> = Some((state_id(*src), "transitions"));
        for (k, (_, conds, target, c)) in list.iter().enumerate() {
            let tid = format!("t_{src}_{k}");
            let y = 80 + (*src).max(0) % 1000 + k as i32 * 90;
            w.nodes.push(node(&tid, "fsm_transition", &format!("ChangeState {target}"), 900, y,
                serde_json::json!({ "target_state": format!("state_{target}"), "source_state": format!("state_{src}"),
                    "source": c.source, "controller": c.name })));
            if let Some((from, port)) = prev.take() {
                w.edges
                    .push(edge(&format!("e_{tid}_in"), &from, port, &tid, "exec"));
            }
            // condicao: um no por gatilho, AND encadeado
            let mut sources_ids: Vec<String> = Vec::new();
            for (ci, cond) in conds.iter().enumerate() {
                match cond {
                    Cond::Command(name) => sources_ids.push(command_nodes[name].clone()),
                    Cond::AnimDone => {
                        let id = format!("{tid}_animdone_{ci}");
                        w.nodes.push(node(
                            &id,
                            "sprite_anim_done",
                            "AnimTime = 0",
                            700,
                            y + 40,
                            serde_json::json!({ "target": entity_id }),
                        ));
                        sources_ids.push(id);
                    }
                    Cond::StateNo(_) => {}
                }
            }
            let mut acc = sources_ids[0].clone();
            for (ai, next) in sources_ids.iter().enumerate().skip(1) {
                let id = format!("{tid}_and_{ai}");
                w.nodes.push(node(
                    &id,
                    "logic_and",
                    "AND",
                    800,
                    y + 60,
                    serde_json::json!({}),
                ));
                w.edges
                    .push(edge(&format!("e_{id}_a"), &acc, "value", &id, "a"));
                w.edges
                    .push(edge(&format!("e_{id}_b"), next, "value", &id, "b"));
                acc = id;
            }
            w.edges.push(edge(
                &format!("e_{tid}_cond"),
                &acc,
                "value",
                &tid,
                "condition",
            ));
            // MUGEN aplica a anim do novo estado no mesmo tick do ChangeState.
            if let Some(key) = playable
                .iter()
                .find(|st| st.state_no == *target)
                .and_then(|st| st.anim.as_deref())
                .and_then(|a| a.trim().parse::<i32>().ok())
                .map(|a| format!("action_{a}"))
                .filter(|k| animations.contains_key(k))
            {
                let id = format!("{tid}_enter_anim");
                w.nodes.push(node(
                    &id,
                    "set_animation_state",
                    &format!("Enter {key}"),
                    1120,
                    y,
                    serde_json::json!({ "target": entity_id, "state": key }),
                ));
                w.edges
                    .push(edge(&format!("e_{id}"), &tid, "matched", &id, "exec"));
            }
            prev = Some((tid, "next"));
        }
    }
    w
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};

    use crate::core::project_mgr::{
        create_project_skeleton, import_mugen_project, load_scene, DEFAULT_ENTRY_SCENE,
    };

    fn probe_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../crates/rex-mugen/fixtures/probe")
    }

    fn temp(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("rex-mugen-{name}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn copy_dir(from: &Path, to: &Path) {
        fs::create_dir_all(to).unwrap();
        for entry in fs::read_dir(from).unwrap() {
            let entry = entry.unwrap();
            fs::copy(entry.path(), to.join(entry.file_name())).unwrap();
        }
    }

    fn import_probe(name: &str) -> (PathBuf, PathBuf) {
        let root = temp(name);
        let donor = root.join("donor");
        copy_dir(&probe_dir(), &donor);
        let project = root.join("project");
        create_project_skeleton(&project, "Probe", "megadrive").unwrap();
        import_mugen_project(&project, &donor).expect("importa a Probe pelo caminho do produto");
        (root, project)
    }

    /// Caminho do produto: o modelo resultante bate com o desenho da fixture.
    #[test]
    fn probe_import_produces_the_designed_model() {
        let (root, project) = import_probe("model");
        let scene = load_scene(&project, DEFAULT_ENTRY_SCENE).unwrap();
        let probe = scene
            .entities
            .iter()
            .find(|e| e.entity_id == "probe")
            .expect("entidade");
        let sprite = probe.components.sprite.as_ref().unwrap();
        assert_eq!(
            (sprite.frame_width, sprite.frame_height),
            (32, 24),
            "celula multipla de 8"
        );
        let pivot = sprite.pivot.as_ref().unwrap();
        assert_eq!((pivot.x, pivot.y), (6, 24));
        let idle = &sprite.animations["action_0"];
        assert!(idle.looping, "MUGEN repete a animacao");
        assert_eq!(idle.frame_durations.as_deref(), Some(&[5, 9][..]));
        assert_eq!(idle.loop_start, Some(0));
        let punch = &sprite.animations["action_200"];
        assert_eq!(punch.frame_durations.as_deref(), Some(&[3, 6, 4, 2][..]));
        assert_eq!(punch.loop_start, Some(1));
        let mf = punch.mugen_frames.as_ref().unwrap();
        assert_eq!(mf[1].axis.as_ref().map(|a| (a.x, a.y)), Some((2, 0)));
        assert_eq!(mf[2].flags, vec!["H".to_string()]);
        assert_eq!(
            mf.iter().map(|f| f.clsn1.len()).collect::<Vec<_>>(),
            vec![0, 1, 0, 0]
        );
        // Grafo: estados 0 e 200 com anim, transicoes ligadas com condicao real.
        let logic = probe.components.logic.as_ref().unwrap();
        let graph: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(project.join(logic.graph_ref.as_ref().unwrap())).unwrap(),
        )
        .unwrap();
        let has_edge = |from: &str, fp: &str, to: &str, tp: &str| {
            graph["edges"].as_array().unwrap().iter().any(|e| {
                e["fromNode"] == from
                    && e["fromPort"] == fp
                    && e["toNode"] == to
                    && e["toPort"] == tp
            })
        };
        assert!(has_edge("fsm_state_0", "exec", "state_0_anim", "exec"));
        assert!(has_edge("fsm_state_200", "exec", "state_200_anim", "exec"));
        assert!(has_edge("fsm_state_0", "transitions", "t_0_0", "exec"));
        assert!(has_edge("cmd_a", "value", "t_0_0", "condition"));
        assert!(has_edge("fsm_state_200", "transitions", "t_200_0", "exec"));
        assert!(has_edge(
            "t_200_0_animdone_0",
            "value",
            "t_200_0",
            "condition"
        ));
        assert!(has_edge("t_0_0", "matched", "t_0_0_enter_anim", "exec"));
        let nodes = graph["nodes"].as_array().unwrap();
        assert!(
            !nodes.iter().any(|n| n["id"] == "fsm_state_-1"),
            "-1 nao e estado jogavel"
        );
        // Relatorio: recursos e comportamento classificados, com origem.
        let report: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(project.join("assets/mugen/probe_import_report.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(report["profile"], "mugen.character.v1");
        let fid = |item: &str, key: &str| {
            report[key]
                .as_array()
                .unwrap()
                .iter()
                .find(|r| r["item"] == item)
                .map(|r| r["fidelity"].clone())
        };
        assert_eq!(fid("anim:200", "resources"), Some("direct".into()));
        assert_eq!(fid("palette", "resources"), Some("direct".into()));
        assert_eq!(fid("statedef:200", "behavior"), Some("direct".into()));
        assert_eq!(
            fid("controller:-1#Punch", "behavior"),
            Some("direct".into())
        );
        assert_eq!(fid("controller:200#End", "behavior"), Some("direct".into()));
        let hw = report["metrics"]
            .as_array()
            .unwrap()
            .iter()
            .find(|m| m["name"] == "hardware_sprites_per_frame")
            .unwrap();
        assert!(hw["value"].is_null(), "indisponivel nao vira zero");
        let _ = fs::remove_dir_all(root);
    }

    /// C gerado a partir do projeto importado: runtime MUGEN presente e alimentado pelo modelo.
    #[test]
    fn probe_emits_runtime_tables_from_the_model() {
        let (root, project) = import_probe("emit");
        let proj = crate::core::project_mgr::load_project(&project).unwrap();
        let scene = load_scene(&project, DEFAULT_ENTRY_SCENE).unwrap();
        let ast = crate::compiler::ast_generator::generate_ast(&proj, &scene);
        let unsupported = crate::compiler::ast_generator::collect_unsupported_semantics(&ast);
        assert!(unsupported.is_empty(), "{unsupported:?}");
        let c = crate::compiler::sgdk_emitter::emit_sgdk(&ast, "Probe").main_c;
        assert!(!c.contains("#error"), "{c}");
        // anims do asset em ordem de nome: action_0, action_200, idle
        let row = |needle: &str| {
            c.lines()
                .find(|l| l.contains(needle))
                .unwrap_or_else(|| panic!("falta {needle}"))
                .to_string()
        };
        let a200 = row("_a1[] = {");
        // timers 3,6,4,2; frame 1 com dx=2 e 1 caixa Clsn1; frame 2 com flip H (fdx = 2*6-32 = -20)
        assert!(a200.contains("{3,0,0,0,0,0,0,1}"), "{a200}");
        assert!(a200.contains("{6,2,0,2,0,0,1,1}"), "{a200}");
        assert!(a200.contains("{4,0,0,-20,0,1,0,1}"), "{a200}");
        assert!(a200.contains("{2,0,0,0,0,0,0,1}"), "{a200}");
        let anims = row("_anims[] = {");
        assert!(
            anims.contains(",1,15,"),
            "count 4, loop 1, total 15: {anims}"
        );
        assert!(
            anims.contains("{2,0,14,"),
            "idle: 2 frames, loop 0, total 14: {anims}"
        );
        assert!(c.contains("SPR_setAutoAnimation(spr_probe, FALSE);"));
        let tick = c.find("rds_mugen_spr_probe_tick();\n        SPR_update();");
        assert!(tick.is_some(), "tick antes do SPR_update");
        assert!(
            c.contains("rds_anim_done_spr_probe()"),
            "AnimTime = 0 usa a flag do runtime"
        );
        let _ = fs::remove_dir_all(root);
    }

    // ------------------------------------------------------------------
    // Prova real: SGDK oficial + core Libretro. Ignorada na suite normal.
    // cargo test --manifest-path src-tauri/Cargo.toml --lib mugen_probe_real -- --ignored --nocapture --test-threads=1
    // ------------------------------------------------------------------

    use std::collections::HashMap;

    use crate::compiler::build_orch::{run_build_with_environment, BuildEnvironment};
    use crate::core::project_mgr::save_scene;
    use crate::core::rom_mastering::sha256_hex as sha;
    use crate::emulator::frame_buffer::framebuffer_to_rgba;
    use crate::emulator::libretro_ffi::{EmulatorCore, JoypadState};

    fn elf32_symbols(elf: &[u8]) -> HashMap<String, u32> {
        let r16 = |o: usize| u16::from_be_bytes([elf[o], elf[o + 1]]);
        let r32 = |o: usize| u32::from_be_bytes([elf[o], elf[o + 1], elf[o + 2], elf[o + 3]]);
        assert!(
            &elf[0..4] == b"\x7fELF" && elf[4] == 1 && elf[5] == 2,
            "ELF32 big-endian"
        );
        let (sh_off, sh_size, sh_count) = (r32(32) as usize, r16(46) as usize, r16(48) as usize);
        let mut out = HashMap::new();
        for index in 0..sh_count {
            let section = sh_off + index * sh_size;
            if r32(section + 4) != 2 {
                continue;
            }
            let (table, size) = (r32(section + 16) as usize, r32(section + 20) as usize);
            let strtab = sh_off + r32(section + 24) as usize * sh_size;
            let strings = r32(strtab + 16) as usize;
            let mut cursor = table;
            while cursor + 16 <= table + size {
                let name = r32(cursor) as usize;
                if name > 0 {
                    let start = strings + name;
                    let len = elf[start..].iter().position(|b| *b == 0).unwrap_or(0);
                    out.insert(
                        String::from_utf8_lossy(&elf[start..start + len]).to_string(),
                        r32(cursor + 4),
                    );
                }
                cursor += 16;
            }
        }
        out
    }

    fn build(project: &Path) -> (PathBuf, String, HashMap<String, u32>) {
        let env = BuildEnvironment::detect();
        assert!(
            env.sgdk_root
                .as_ref()
                .is_some_and(|r| r.join("makefile.gen").is_file())
                && env.sgdk_make_program.is_some(),
            "SGDK oficial nao detectado; esta prova nao aceita toolchain falso"
        );
        let result = run_build_with_environment(project, &env, |_| {});
        assert!(
            result.ok,
            "build falhou: {:?}",
            result.log.iter().rev().take(25).collect::<Vec<_>>()
        );
        let rom = PathBuf::from(&result.rom_path);
        let rom = if rom.is_absolute() {
            rom
        } else {
            project.join(rom)
        };
        let elf = fs::read(project.join("build/megadrive/out/rom.out")).expect("rom.out");
        (
            rom.clone(),
            sha(&fs::read(&rom).unwrap()),
            elf32_symbols(&elf),
        )
    }

    fn read_u16(emu: &EmulatorCore, addr: u32) -> u16 {
        let (d, _) = emu
            .read_memory(2, (addr & 0xFFFF) as usize, 2)
            .expect("WRAM");
        u16::from_le_bytes([d[0], d[1]])
    }

    /// Classifica o quadro exibido pelos marcadores de pixel da fixture (eixo em 102,120).
    fn classify(emu: &EmulatorCore) -> &'static str {
        let (raw, size, format) = emu.get_framebuffer().expect("fb");
        let fb = framebuffer_to_rgba(&raw, size, format);
        let w = fb.width as usize;
        let px = |x: usize, y: usize| {
            let i = (y * w + x) * 4;
            (fb.rgba[i], fb.rgba[i + 1], fb.rgba[i + 2])
        };
        let is = |(r, g, b): (u8, u8, u8), want: &str| {
            let (hi, lo) = (|v: u8| v > 160, |v: u8| v < 90);
            match want {
                "red" => hi(r) && lo(g) && lo(b),
                "green" => lo(r) && hi(g) && lo(b),
                "blue" => lo(r) && lo(g) && hi(b),
                "white" => hi(r) && hi(g) && hi(b),
                "yellow" => hi(r) && hi(g) && lo(b),
                _ => false,
            }
        };
        let colored = |p| {
            ["red", "green", "blue", "white", "yellow"]
                .iter()
                .any(|c| is(p, c))
        };
        if is(px(100, 110), "yellow") && is(px(110, 103), "white") {
            "punch1"
        } else if is(px(103, 110), "red") && is(px(95, 105), "white") && !colored(px(100, 110)) {
            "punch0_hflip"
        } else if is(px(100, 110), "red") && is(px(108, 105), "white") {
            "punch0"
        } else if is(px(100, 110), "red") && is(px(110, 118), "green") && !colored(px(108, 105)) {
            "idle0"
        } else if is(px(100, 110), "red") && is(px(110, 118), "blue") {
            "idle1"
        } else {
            "?"
        }
    }

    struct Run {
        rom_sha256: String,
        idle: Vec<&'static str>,
        after_press: Vec<&'static str>,
        clsn1: Vec<u16>,
    }

    fn run(emu: &mut EmulatorCore, rom: &Path, symbols: &HashMap<String, u32>) -> Run {
        emu.load_rom(rom).expect("load");
        emu.set_joypad(JoypadState::default()).unwrap();
        for _ in 0..60 {
            emu.run_frame().unwrap();
        }
        let mut idle = Vec::new();
        for _ in 0..42 {
            emu.run_frame().unwrap();
            idle.push(classify(emu));
        }
        let clsn_addr = symbols["rds_mugen_spr_probe_clsn1"];
        let (mut after, mut clsn1) = (Vec::new(), Vec::new());
        emu.set_joypad(JoypadState {
            y: true,
            ..JoypadState::default()
        })
        .unwrap(); // A do Mega Drive
        for i in 0..50 {
            if i == 2 {
                emu.set_joypad(JoypadState::default()).unwrap();
            }
            emu.run_frame().unwrap();
            after.push(classify(emu));
            clsn1.push(read_u16(emu, clsn_addr));
        }
        Run {
            rom_sha256: sha(&fs::read(rom).unwrap()),
            idle,
            after_press: after,
            clsn1,
        }
    }

    fn runs_of(seq: &[&'static str]) -> Vec<(&'static str, usize)> {
        let mut out: Vec<(&'static str, usize)> = Vec::new();
        for s in seq {
            match out.last_mut() {
                Some((l, n)) if l == s => *n += 1,
                _ => out.push((s, 1)),
            }
        }
        out
    }

    /// Sequencia prevista a partir do 1o quadro de soco, derivada do AIR (nao do runtime).
    fn expected_punch(frame1_ticks: usize) -> Vec<(&'static str, usize)> {
        // p0 3, p1 N, p0 com flip H 4, ultimo frame (sprite 0,0 = idle0) 2 + idle frame 0 por 5, idle1 9
        vec![
            ("punch0", 3),
            ("punch1", frame1_ticks),
            ("punch0_hflip", 4),
            ("idle0", 2 + 5),
            ("idle1", 9),
        ]
    }

    #[ignore]
    #[test]
    fn mugen_probe_real_build_run_edit_and_effect() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let out = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join(format!("target-test/validation/rex-mugen/run-{stamp}"));
        fs::create_dir_all(&out).unwrap();
        let prediction = serde_json::json!({
            "registered_before_execution": true,
            "axis_screen": [102, 120],
            "idle_cycle": [["idle0", 5], ["idle1", 9]],
            "punch_original": expected_punch(6),
            "punch_edited_frame1_12": expected_punch(12),
            "clsn1_active_frames": {"original": 6, "edited": 12},
            "pixel_markers": {
                "idle0": "vermelho (100,110), verde (110,118)", "idle1": "azul (110,118)",
                "punch0": "punho branco a direita (108,105)", "punch1": "corpo amarelo (100,110) por offset +2, punho (110,103)",
                "punch0_hflip": "punho branco a esquerda do eixo (95,105), corpo em (103,110)"
            }
        });
        let (root, project_a) = import_probe("real");
        let (rom_a, sha_a, sym_a) = build(&project_a);
        // Edicao no modelo do RetroDev: frame 1 do soco 6 -> 12 ticks; salvar e reabrir.
        let project_b = root.join("project_b");
        std::process::Command::new("cp")
            .arg("-r")
            .arg(&project_a)
            .arg(&project_b)
            .status()
            .unwrap();
        let _ = fs::remove_dir_all(project_b.join("build"));
        let mut scene = load_scene(&project_b, DEFAULT_ENTRY_SCENE).unwrap();
        {
            let sprite = scene
                .entities
                .iter_mut()
                .find(|e| e.entity_id == "probe")
                .unwrap()
                .components
                .sprite
                .as_mut()
                .unwrap();
            let punch = sprite.animations.get_mut("action_200").unwrap();
            punch.frame_durations.as_mut().unwrap()[1] = 12;
            punch.mugen_frames.as_mut().unwrap()[1].duration = 12;
        }
        save_scene(&project_b, DEFAULT_ENTRY_SCENE, &scene).unwrap();
        let reopened = load_scene(&project_b, DEFAULT_ENTRY_SCENE).unwrap();
        let punch = &reopened
            .entities
            .iter()
            .find(|e| e.entity_id == "probe")
            .unwrap()
            .components
            .sprite
            .as_ref()
            .unwrap()
            .animations["action_200"];
        assert_eq!(
            punch.frame_durations.as_deref(),
            Some(&[3, 12, 4, 2][..]),
            "salvar/reabrir preserva a edicao"
        );
        assert_eq!(punch.loop_start, Some(1));
        let (rom_b, sha_b, sym_b) = build(&project_b);
        assert_ne!(sha_a, sha_b, "a edicao muda a ROM");
        fs::copy(&rom_a, out.join("probe-original.rom")).unwrap();
        fs::copy(&rom_b, out.join("probe-edited-f1-12.rom")).unwrap();

        let mut emu = EmulatorCore::new(None);
        let ra = run(&mut emu, &rom_a, &sym_a);
        let rb = run(&mut emu, &rom_b, &sym_b);
        let punch_runs = |r: &Run| {
            let start = r
                .after_press
                .iter()
                .position(|l| l.starts_with("punch"))
                .expect("soco nunca apareceu");
            (start, runs_of(&r.after_press[start..]))
        };
        let (pa, runs_a) = punch_runs(&ra);
        let (pb, runs_b) = punch_runs(&rb);
        let idle_a = runs_of(&ra.idle);
        println!("idle A: {idle_a:?}");
        println!("A: inicio {pa} {runs_a:?}\nB: inicio {pb} {runs_b:?}");
        println!("clsn1 A {:?}\nclsn1 B {:?}", ra.clsn1, rb.clsn1);
        let report = serde_json::json!({
            "prediction": prediction,
            "roms": {"original": sha_a, "edited_frame1_12": sha_b},
            "loaded_rom_sha256": {"original": ra.rom_sha256, "edited": rb.rom_sha256},
            "observed": {
                "idle_runs_original": idle_a.iter().map(|(l, n)| serde_json::json!([l, n])).collect::<Vec<_>>(),
                "press_to_punch_frames": {"original": pa, "edited": pb},
                "punch_runs_original": runs_a.iter().map(|(l, n)| serde_json::json!([l, n])).collect::<Vec<_>>(),
                "punch_runs_edited": runs_b.iter().map(|(l, n)| serde_json::json!([l, n])).collect::<Vec<_>>(),
                "clsn1_original": ra.clsn1, "clsn1_edited": rb.clsn1,
            },
            "layer": "tecnica: import pelo caminho do produto + build SGDK + core direto; sem UI/teclado",
        });
        fs::write(
            out.join("report.json"),
            serde_json::to_string_pretty(&report).unwrap(),
        )
        .unwrap();
        println!("relatorio: {}", out.join("report.json").display());
        // Ciclo do idle (sem Loopstart): 5 + 9 repetindo (primeira corrida pode estar truncada).
        for w in idle_a.windows(2).skip(1) {
            let expected = match w[0].0 {
                "idle0" => ("idle1", 9),
                _ => ("idle0", 5),
            };
            if w[1] != *idle_a.last().unwrap() {
                assert_eq!(w[1], expected, "ciclo do idle: {idle_a:?}");
            }
        }
        let prefix = |runs: &[(&'static str, usize)], n: usize| {
            runs.iter().take(n).cloned().collect::<Vec<_>>()
        };
        assert_eq!(prefix(&runs_a, 5), expected_punch(6), "original");
        assert_eq!(prefix(&runs_b, 5), expected_punch(12), "editada");
        // Controles: cada ROM falha a expectativa da outra (ROM antiga / edicao nao aplicada).
        assert_ne!(prefix(&runs_a, 5), expected_punch(12));
        assert_ne!(prefix(&runs_b, 5), expected_punch(6));
        assert_ne!(
            (ra.rom_sha256.clone(), ra.after_press.clone()),
            (rb.rom_sha256.clone(), rb.after_press.clone())
        );
        // Clsn1: janela ativa com a duracao do frame 1 (medida na RAM, mesma fonte = tick).
        let active = |v: &[u16]| v.iter().filter(|c| **c == 1).count();
        assert_eq!((active(&ra.clsn1), active(&rb.clsn1)), (6, 12));
        emu.stop().ok();
        let _ = fs::remove_dir_all(root);
    }

    // ---------------------------------------------------------------- 2a amostra: Sentinel

    fn import_fixture(fixture: &str, name: &str) -> (PathBuf, PathBuf) {
        let root = temp(name);
        let donor = root.join("donor");
        copy_dir(
            &PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../crates/rex-mugen/fixtures")
                .join(fixture),
            &donor,
        );
        let project = root.join("project");
        create_project_skeleton(&project, fixture, "megadrive").unwrap();
        import_mugen_project(&project, &donor).expect("importa pelo caminho do produto");
        (root, project)
    }

    /// Classificacao prevista em `fixture::sentinel` (antes da execucao).
    #[test]
    fn sentinel_report_matches_the_registered_prediction() {
        let (root, project) = import_fixture("sentinel", "sentinel-model");
        let report: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(project.join("assets/mugen/sentinel_import_report.json")).unwrap(),
        )
        .unwrap();
        let find = |key: &str, item: &str| {
            report[key]
                .as_array()
                .unwrap()
                .iter()
                .find(|r| r["item"] == item)
                .cloned()
                .unwrap_or_else(|| panic!("{key}/{item} ausente: {}", report[key]))
        };
        assert_eq!(report["cell"]["width"], 40);
        assert_eq!(report["cell"]["height"], 48);
        assert_eq!(find("resources", "palette")["fidelity"], "approximate");
        let merged = report["metrics"]
            .as_array()
            .unwrap()
            .iter()
            .find(|m| m["name"] == "merged_pixels")
            .unwrap();
        assert_eq!(merged["value"], 2.0);
        assert_eq!(merged["over_budget"], true);
        assert_eq!(find("resources", "anim:0")["fidelity"], "direct");
        assert_eq!(find("resources", "anim:210")["fidelity"], "approximate");
        // Previsao registrada dizia "approximate" (frame vazio); a execucao mostrou que frame
        // vazio quebra o rescomp e o conversor passou a recusar a action (Sentinel = regressao).
        assert_eq!(find("resources", "anim:99")["fidelity"], "unsupported");
        let codes: Vec<&str> = report["diagnostics"]
            .as_array()
            .unwrap()
            .iter()
            .map(|d| d["code"].as_str().unwrap())
            .collect();
        for c in [
            "plan.palette.over_budget",
            "plan.frame.blend_unsupported",
            "plan.frame.sprite_missing",
        ] {
            assert!(codes.contains(&c), "falta {c}: {codes:?}");
        }
        assert_eq!(find("behavior", "controller:-1#Kick")["fidelity"], "direct");
        assert_eq!(
            find("behavior", "controller:-1#Taunt")["fidelity"],
            "unsupported"
        );
        assert_eq!(
            find("behavior", "controller:-1#Alt")["fidelity"],
            "unsupported"
        );
        assert_eq!(
            find("behavior", "controller:210#Push")["fidelity"],
            "unsupported"
        );
        assert_eq!(
            find("behavior", "controller:210#Back")["fidelity"],
            "direct"
        );
        assert_eq!(find("behavior", "statedef:230")["fidelity"], "approximate");
        let scene = load_scene(&project, DEFAULT_ENTRY_SCENE).unwrap();
        let sprite = scene
            .entities
            .iter()
            .find(|e| e.entity_id == "sentinel")
            .unwrap()
            .components
            .sprite
            .clone()
            .unwrap();
        let kick = &sprite.animations["action_210"];
        assert_eq!(kick.frame_durations.as_deref(), Some(&[4, 5, -1][..]));
        assert_eq!(
            kick.mugen_frames.as_ref().unwrap()[1].flags,
            vec!["V".to_string()]
        );
        let idle = &sprite.animations["action_0"];
        assert_eq!(
            idle.mugen_frames
                .as_ref()
                .unwrap()
                .iter()
                .map(|f| f.clsn2.len())
                .collect::<Vec<_>>(),
            vec![1, 2]
        );
        let _ = fs::remove_dir_all(root);
    }

    fn classify_sentinel(emu: &EmulatorCore) -> &'static str {
        let (raw, size, format) = emu.get_framebuffer().expect("fb");
        let fb = framebuffer_to_rgba(&raw, size, format);
        let w = fb.width as usize;
        let px = |x: usize, y: usize| {
            let i = (y * w + x) * 4;
            (fb.rgba[i], fb.rgba[i + 1], fb.rgba[i + 2])
        };
        let (hi, lo) = (|v: u8| v > 160, |v: u8| v < 90);
        let white = |p: (u8, u8, u8)| hi(p.0) && hi(p.1) && hi(p.2);
        let cyan = |p: (u8, u8, u8)| lo(p.0) && hi(p.1) && hi(p.2);
        let magenta = |p: (u8, u8, u8)| hi(p.0) && lo(p.1) && hi(p.2);
        // Marcador do corpo em y=160: o ponto planejado (116,170) cai na faixa colorida
        // espelhada (linha 21 do sprite) — erro do marcador, nao da geometria (ver relatorio).
        if cyan(px(116, 160)) && white(px(128, 169)) && !cyan(px(116, 130)) {
            "kick1_vflip"
        } else if cyan(px(116, 130)) && white(px(128, 127)) {
            "kick0"
        } else if cyan(px(116, 130)) && white(px(116, 100)) && !white(px(128, 127)) {
            "idle0"
        } else if cyan(px(116, 130)) && magenta(px(116, 100)) {
            "idle1"
        } else {
            "?"
        }
    }

    #[ignore]
    #[test]
    fn mugen_sentinel_real_build_and_run() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let out = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join(format!("target-test/validation/rex-mugen/sentinel-{stamp}"));
        fs::create_dir_all(&out).unwrap();
        let (root, project) = import_fixture("sentinel", "sentinel-real");
        let (rom, rom_sha, sym) = build(&project);
        fs::copy(&rom, out.join("sentinel.rom")).unwrap();
        let mut emu = EmulatorCore::new(None);
        emu.load_rom(&rom).unwrap();
        emu.set_joypad(JoypadState::default()).unwrap();
        for _ in 0..60 {
            emu.run_frame().unwrap();
        }
        let (c1, c2) = (
            sym["rds_mugen_spr_sentinel_clsn1"],
            sym["rds_mugen_spr_sentinel_clsn2"],
        );
        let (mut idle, mut idle_c2) = (Vec::new(), Vec::new());
        for _ in 0..40 {
            emu.run_frame().unwrap();
            idle.push(classify_sentinel(&emu));
            idle_c2.push(read_u16(&emu, c2));
        }
        emu.set_joypad(JoypadState {
            b: true,
            ..JoypadState::default()
        })
        .unwrap(); // B do Mega Drive
        let (mut after, mut after_c1) = (Vec::new(), Vec::new());
        for i in 0..60 {
            if i == 2 {
                emu.set_joypad(JoypadState::default()).unwrap();
            }
            emu.run_frame().unwrap();
            after.push(classify_sentinel(&emu));
            after_c1.push(read_u16(&emu, c1));
        }
        let (ri, ra) = (runs_of(&idle), runs_of(&after));
        println!("sentinel idle {ri:?}\nsentinel depois de B {ra:?}\nclsn2 idle {idle_c2:?}\nclsn1 {after_c1:?}");
        fs::write(out.join("report.json"), serde_json::to_string_pretty(&serde_json::json!({
            "rom_sha256": rom_sha,
            "idle_runs": ri.iter().map(|(l, n)| serde_json::json!([l, n])).collect::<Vec<_>>(),
            "after_b_runs": ra.iter().map(|(l, n)| serde_json::json!([l, n])).collect::<Vec<_>>(),
            "clsn2_idle": idle_c2, "clsn1_after_b": after_c1,
            "layer": "tecnica: import pelo produto + build SGDK + core direto",
        })).unwrap()).unwrap();
        // Previsao (fixture::sentinel): idle 8+8; chute 4 baixo, 5 com flip V, depois parado.
        for w in ri.windows(2).skip(1) {
            if w[1] != *ri.last().unwrap() {
                assert_eq!(w[1].1, 8, "idle 8+8: {ri:?}");
            }
        }
        let start = ra
            .iter()
            .position(|(l, _)| l.starts_with("kick"))
            .expect("chute nunca apareceu");
        assert_eq!(ra[start], ("kick0", 4), "{ra:?}");
        assert_eq!(ra[start + 1], ("kick1_vflip", 5), "{ra:?}");
        assert_eq!(ra[start + 2].0, "kick0");
        assert_eq!(
            start + 3,
            ra.len(),
            "tempo -1: fica parado ate o fim da janela: {ra:?}"
        );
        assert_eq!(after_c1.iter().filter(|v| **v == 1).count(), 5);
        assert!(
            idle_c2.iter().all(|v| *v == 1 || *v == 2)
                && idle_c2.contains(&1)
                && idle_c2.contains(&2)
        );
        emu.stop().ok();
        let _ = fs::remove_dir_all(root);
    }
}
