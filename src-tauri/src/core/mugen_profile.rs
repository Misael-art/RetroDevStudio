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
    // Caminho que sai do pacote e erro fatal (vale tambem para o caminho legado);
    // so a ausencia do arquivo deixa o chamador tentar os PNGs extraidos.
    if !root.join(sff_rel.trim().trim_matches('"')).exists() {
        return Ok(None);
    }
    let sff_path = resolve_inside(root, sff_rel)?;
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
    let boxes_total: usize = planned
        .actions
        .values()
        .flat_map(|a| a.frames.iter())
        .map(|f| f.clsn1.len() + f.clsn2.len())
        .sum();
    let mut resources: Vec<serde_json::Value> = planned
        .provenance
        .iter()
        .map(|p| {
            serde_json::json!({
                "item": p.item, "source": p.source.render(), "source_sha256": p.source_sha256,
                "transform": p.transform,
                "target": if p.item.starts_with("anim:") { format!("sprite.animations.action_{}", &p.item[5..]) } else { "sprite.asset (atlas)".to_string() },
                "fidelity": p.fidelity.as_str(), "reason": p.reason, "consequence": p.consequence,
            })
        })
        .collect();
    if boxes_total > 0 {
        resources.push(serde_json::json!({
            "item": "collision", "source": air_rel, "source_sha256": air_sha,
            "transform": format!("{boxes_total} caixas Clsn1/Clsn2 por frame -> tabelas na ROM"),
            "target": "sprite.animations.*.mugen_frames[].clsn1/clsn2",
            "fidelity": "manual",
            "reason": "as caixas sao preservadas por frame, mas nenhuma regra de jogo as usa no perfil v1",
            "consequence": "golpes nao acertam nem recebem dano sozinhos; e preciso ligar a logica de colisao manualmente",
        }));
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
        "resources": resources,
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

// ---------------------------------------------------------------- resumo para o usuario

/// Acrescenta ao relatorio os itens de personagem que dependem do DEF/CMD (comandos, som)
/// e grava o resumo por categoria (`summary`).
pub(crate) fn append_character_items(
    report: &mut serde_json::Value,
    commands: &[(String, String, Vec<String>)],
    sound_rel: Option<&str>,
) {
    if let Some(behavior) = report["behavior"].as_array_mut() {
        for (name, source, unsupported) in commands {
            behavior.push(if unsupported.is_empty() {
                serde_json::json!({ "item": format!("command:{name}"), "source": source, "fidelity": "direct",
                    "target": format!("input_command {name}"),
                    "reason": "sequencia de botoes/direcoes representavel no controle Mega Drive",
                    "consequence": "o comando e reconhecido no jogo" })
            } else {
                serde_json::json!({ "item": format!("command:{name}"), "source": source, "fidelity": "approximate",
                    "target": format!("input_command {name}"),
                    "reason": format!("partes sem equivalente no controle Mega Drive: {}", unsupported.join(", ")),
                    "consequence": "o comando pode ser reconhecido de forma diferente do original" })
            });
        }
        if let Some(sound) = sound_rel {
            behavior.push(serde_json::json!({ "item": "sound", "source": sound, "fidelity": "manual",
                "target": "audio_bank (quando o .snd e legivel)",
                "reason": "sons do .snd sao copiados como assets, mas nenhum PlaySnd e ligado a execucao no perfil v1",
                "consequence": "o personagem fica mudo ate voce ligar os sons nos estados" }));
        }
    }
    let summary = summarize(report);
    report["summary"] = summary;
}

const CATEGORIES: [(&str, &str); 7] = [
    ("sprites", "Sprites e paleta"),
    ("animations", "Animacoes"),
    ("commands", "Comandos"),
    ("states", "Estados e comportamento"),
    ("collisions", "Colisoes"),
    ("sound", "Som"),
    ("stage", "Cenario (stage)"),
];

fn category_of(item: &str) -> &'static str {
    if item == "palette" || item.starts_with("sprite:") || item == "sprites" {
        "sprites"
    } else if item.starts_with("anim:") {
        "animations"
    } else if item.starts_with("command:") {
        "commands"
    } else if item.starts_with("statedef:") || item.starts_with("controller:") {
        "states"
    } else if item == "collision" {
        "collisions"
    } else if item == "sound" {
        "sound"
    } else {
        "stage"
    }
}

type CategoryAcc = (BTreeMap<&'static str, u32>, Vec<serde_json::Value>);

/// Resumo por categoria e por classe de fidelidade. Categoria sem itens = `absent`
/// (nao existe no pacote ou nao se aplica), nunca apresentada como "ok".
pub(crate) fn summarize(report: &serde_json::Value) -> serde_json::Value {
    let mut cats: BTreeMap<&str, CategoryAcc> = BTreeMap::new();
    let mut totals: BTreeMap<&str, u32> = ["direct", "approximate", "manual", "unsupported"]
        .iter()
        .map(|k| (*k, 0))
        .collect();
    let mut bridges = 0;
    for key in ["resources", "behavior"] {
        for it in report[key].as_array().into_iter().flatten() {
            let item = it["item"].as_str().unwrap_or("");
            let fid: &'static str = match it["fidelity"].as_str().unwrap_or("unsupported") {
                "direct" => "direct",
                "approximate" => "approximate",
                "manual" => "manual",
                _ => "unsupported",
            };
            if item.starts_with("controller:") && fid != "direct" {
                bridges += 1;
            }
            *totals.get_mut(fid).unwrap() += 1;
            let entry = cats.entry(category_of(item)).or_default();
            *entry.0.entry(fid).or_default() += 1;
            entry.1.push(it.clone());
        }
    }
    let categories: Vec<serde_json::Value> = CATEGORIES
        .iter()
        .map(|(id, label)| {
            let (counts, items) = cats.remove(id).unwrap_or_default();
            let status = ["unsupported", "manual", "approximate", "direct"]
                .iter()
                .find(|k| counts.get(*k).copied().unwrap_or(0) > 0)
                .copied()
                .unwrap_or("absent");
            let note = match (*id, items.is_empty()) {
                ("stage", true) => "pacote de personagem: cenario nao faz parte desta importacao",
                ("sound", true) => "o pacote nao declara arquivo de som",
                ("collisions", true) => "o AIR nao declara caixas de colisao",
                (_, true) => "nada deste tipo no pacote",
                _ => "",
            };
            let n = |k: &str| counts.get(k).copied().unwrap_or(0);
            serde_json::json!({ "id": id, "label": label, "status": status,
                "counts": { "direct": n("direct"), "approximate": n("approximate"),
                    "manual": n("manual"), "unsupported": n("unsupported") },
                "note": note, "items": items })
        })
        .collect();
    serde_json::json!({ "categories": categories, "totals": totals, "manual_bridges": bridges })
}

/// Linha curta para o aviso de sucesso, a partir dos relatorios gravados no projeto.
pub(crate) fn summary_line(project_dir: &Path) -> Option<String> {
    let mut parts = Vec::new();
    for entry in fs::read_dir(project_dir.join("assets/mugen"))
        .ok()?
        .flatten()
    {
        let name = entry.file_name().to_string_lossy().to_string();
        let Some(id) = name.strip_suffix("_import_report.json") else {
            continue;
        };
        let Ok(bytes) = fs::read(entry.path()) else {
            continue;
        };
        let Ok(report) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
            continue;
        };
        let t = &report["summary"]["totals"];
        let n = |k: &str| t[k].as_u64().unwrap_or(0);
        parts.push(format!(
            "{id}: {} funcionam igual, {} com diferenca, {} precisam de ajuste manual, {} nao convertidos ({} pontes manuais no grafo); relatorio em assets/mugen/{name}",
            n("direct"),
            n("approximate"),
            n("manual"),
            n("unsupported"),
            report["summary"]["manual_bridges"].as_u64().unwrap_or(0)
        ));
    }
    parts.sort();
    (!parts.is_empty()).then(|| format!("MUGEN (Experimental) - {}", parts.join("; ")))
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

// ---------------------------------------------------------------- velocidade (VelSet)

/// Limite de |Q8.8| aceito (s16): |v| <= 127,99609375 px/tick.
pub(crate) const VELOCITY_MAX_Q8: i32 = 32767;

/// Velocidade horizontal em Q8.8 (1/256 px por tick de 1/60 s).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct VelocityQ8 {
    pub q8: i32,
    /// `false` quando o literal nao e multiplo de 1/256 (arredondado ao mais proximo,
    /// metade para longe do zero) — o chamador registra como aproximado.
    pub exact: bool,
}

/// Literal decimal `[+-]digitos[.digitos]` (px/tick) -> Q8.8. Expressoes, `const(...)`,
/// expoentes e qualquer outra sintaxe sao recusadas, nunca tratadas como constante.
pub(crate) fn parse_velocity_q8(text: &str) -> Result<VelocityQ8, String> {
    let t = text.trim();
    let (neg, body) = match t.as_bytes().first() {
        Some(b'-') => (true, &t[1..]),
        Some(b'+') => (false, &t[1..]),
        _ => (false, t),
    };
    let (int_s, frac_s) = body.split_once('.').unwrap_or((body, ""));
    let digits_ok = |x: &str| x.bytes().all(|b| b.is_ascii_digit());
    if body.is_empty()
        || int_s.is_empty()
        || !digits_ok(int_s)
        || !digits_ok(frac_s)
        || (body.contains('.') && frac_s.is_empty())
    {
        return Err(format!(
            "'{t}' nao e um literal decimal (so [+-]N ou [+-]N.N; sem expressoes, const() ou expoente)"
        ));
    }
    if int_s.len() > 6 || frac_s.len() > 9 {
        return Err(format!(
            "'{t}' tem digitos demais (ate 6 inteiros e 9 decimais)"
        ));
    }
    let den: i128 = 10i128.pow(frac_s.len() as u32);
    let num: i128 = format!("{int_s}{frac_s}").parse::<i128>().unwrap_or(0);
    let scaled = num * 256;
    let mut q = scaled / den;
    let rem = scaled % den;
    if rem != 0 && rem * 2 >= den {
        q += 1;
    }
    if q > VELOCITY_MAX_Q8 as i128 {
        return Err(format!(
            "'{t}' fora do intervalo representavel (|v| <= 127,99609375 px/tick)"
        ));
    }
    let q8 = if neg { -(q as i32) } else { q as i32 };
    Ok(VelocityQ8 {
        q8,
        exact: rem == 0,
    })
}

/// Um `VelSet` dentro do subconjunto: componente x constante, `trigger1 = 1`, sem vertical.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct VelSetSpec {
    /// Literal de x como autorado (fonte do modelo; a ROM usa o Q8.8 derivado).
    pub x_text: String,
    pub velocity: VelocityQ8,
}

fn raw_param(raw: &[String], key: &str) -> Option<String> {
    raw.iter().find_map(|l| {
        let l = l.split(';').next().unwrap_or("");
        let (k, v) = l.split_once('=')?;
        k.trim()
            .eq_ignore_ascii_case(key)
            .then(|| v.trim().to_string())
    })
}

/// Contrato v1 do `VelSet`: `x = N` ou `value = N[, 0]` (N literal decimal); y ausente ou 0;
/// exatamente `trigger1 = 1` (todo quadro em que o estado esta ativo) e nenhum `triggerall`.
pub(crate) fn parse_velset(raw: &[String]) -> Result<VelSetSpec, String> {
    let (all, groups) = trigger_groups(raw);
    let always = groups.len() == 1
        && groups
            .get(&1)
            .is_some_and(|g| g.len() == 1 && g[0].trim() == "1");
    if !all.is_empty() || !always {
        return Err(
            "gatilho fora do contrato do VelSet v1 (so 'trigger1 = 1', sem triggerall)".into(),
        );
    }
    for line in raw {
        let line = line.split(';').next().unwrap_or("").trim();
        if line.is_empty() || line.starts_with('[') {
            continue;
        }
        let Some((k, _)) = line.split_once('=') else {
            continue;
        };
        let k = k.trim().to_ascii_lowercase();
        let known = matches!(
            k.as_str(),
            "type" | "name" | "x" | "y" | "value" | "triggerall"
        ) || k
            .strip_prefix("trigger")
            .is_some_and(|n| n.parse::<u32>().is_ok());
        if !known {
            return Err(format!("parametro '{k}' do VelSet nao e convertido"));
        }
    }
    let (x_text, y_text) = match (raw_param(raw, "x"), raw_param(raw, "value")) {
        (Some(_), Some(_)) => return Err("x e value ao mesmo tempo".into()),
        (Some(x), None) => (x, raw_param(raw, "y")),
        (None, Some(v)) => {
            let mut it = v.splitn(2, ',');
            let x = it.next().unwrap_or("").trim().to_string();
            let y = it.next().map(|y| y.trim().to_string());
            (x, y.or_else(|| raw_param(raw, "y")))
        }
        (None, None) => {
            return Err("sem componente x (VelSet so vertical nao move na horizontal)".into())
        }
    };
    if x_text.is_empty() {
        return Err("componente x omitido (x inalterado nao e convertido)".into());
    }
    if let Some(y) = y_text {
        let yv = parse_velocity_q8(&y).map_err(|e| format!("componente y: {e}"))?;
        if yv.q8 != 0 {
            return Err(format!(
                "componente y = {y} (movimento vertical nao faz parte do perfil v1)"
            ));
        }
    }
    let velocity = parse_velocity_q8(&x_text).map_err(|e| format!("componente x: {e}"))?;
    Ok(VelSetSpec { x_text, velocity })
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
    /// Controllers recusados aqui com motivo especifico (o chamador nao repete o relatorio).
    pub refused: std::collections::BTreeSet<usize>,
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
        refused: Default::default(),
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
    wire_velsets(&mut w, entity_id, &playable, controllers);
    w
}

/// `VelSet` (x constante) como `set_velocity` do perfil, no corpo do estado (todo quadro,
/// depois da animacao) e na entrada por transicao (mesmo tick, como a animacao).
fn wire_velsets(
    w: &mut Wired,
    entity_id: &str,
    playable: &[&StateView],
    controllers: &[ControllerView],
) {
    let state_id = |n: i32| format!("fsm_state_{n}");
    let mut by_state: BTreeMap<i32, Vec<(usize, String, VelSetSpec)>> = BTreeMap::new();
    for c in controllers {
        if !c.kind.eq_ignore_ascii_case("velset") {
            continue;
        }
        let item = format!(
            "controller:{}#{}",
            c.state_no.map(|s| s.to_string()).unwrap_or("?".into()),
            c.name
        );
        let refuse = |w: &mut Wired, why: String| {
            w.refused.insert(c.index);
            w.report.push(serde_json::json!({ "item": item, "source": c.source, "fidelity": "unsupported",
                "target": serde_json::Value::Null, "reason": format!("VelSet fora do contrato v1: {why}"),
                "consequence": "a velocidade nao e aplicada; o personagem nao se desloca por este controller" }));
        };
        let Some(state_no) = c
            .state_no
            .filter(|s| playable.iter().any(|p| p.state_no == *s))
        else {
            refuse(
                w,
                "estado de origem ausente ou nao jogavel (-1/-2/-3)".into(),
            );
            continue;
        };
        match parse_velset(&c.raw_lines) {
            Ok(spec) => by_state
                .entry(state_no)
                .or_default()
                .push((c.index, item.clone(), spec)),
            Err(why) => refuse(w, why),
        }
    }
    for (state_no, list) in &by_state {
        let mut body_prev = (state_id(*state_no), "exec".to_string());
        if w.nodes
            .iter()
            .any(|n| n["id"] == format!("state_{state_no}_anim"))
        {
            body_prev = (format!("state_{state_no}_anim"), "exec".to_string());
        }
        for (k, (index, item, spec)) in list.iter().enumerate() {
            let params = |instance: &str| {
                serde_json::json!({
                    "target": entity_id, "vx": spec.x_text, "vy": 0, "mode": "set",
                    "profile": plan::PROFILE_ID, "state_no": state_no,
                    "unit": "px/tick (1/60 s)", "controller": item, "instance": instance })
            };
            let id = format!("state_{state_no}_velset_{k}");
            w.nodes.push(node(
                &id,
                "set_velocity",
                &format!("VelSet x = {}", spec.x_text),
                860,
                80 + k as i32 * 60,
                params("body"),
            ));
            w.edges.push(edge(
                &format!("e_{id}"),
                &body_prev.0,
                &body_prev.1,
                &id,
                "exec",
            ));
            body_prev = (id, "exec".to_string());
            let transitions: Vec<String> = w
                .nodes
                .iter()
                .filter(|n| {
                    n["type"] == "fsm_transition"
                        && n["params"]["target_state"] == format!("state_{state_no}")
                })
                .filter_map(|n| n["id"].as_str().map(str::to_string))
                .collect();
            for tid in transitions {
                let enter = format!("{tid}_enter_velset_{k}");
                let enter_anim = format!("{tid}_enter_anim");
                let (from, port) = if k > 0 {
                    (format!("{tid}_enter_velset_{}", k - 1), "exec".to_string())
                } else if w.nodes.iter().any(|n| n["id"] == enter_anim) {
                    (enter_anim, "exec".to_string())
                } else {
                    (tid.clone(), "matched".to_string())
                };
                w.nodes.push(node(
                    &enter,
                    "set_velocity",
                    &format!("Enter VelSet x = {}", spec.x_text),
                    1340,
                    80 + k as i32 * 60,
                    params("enter"),
                ));
                w.edges
                    .push(edge(&format!("e_{enter}"), &from, &port, &enter, "exec"));
            }
            w.handled.insert(*index);
            let (fid, reason, consequence) = if spec.velocity.exact {
                (
                    "direct",
                    format!(
                        "VelSet x = {} = {}/256 px/tick, trigger1 = 1",
                        spec.x_text, spec.velocity.q8
                    ),
                    "o personagem desloca esse valor a cada tick em que o estado esta ativo (facing fixo a direita)".to_string(),
                )
            } else {
                (
                    "approximate",
                    format!(
                        "VelSet x = {} nao e multiplo de 1/256; usado {}/256 = {} px/tick",
                        spec.x_text,
                        spec.velocity.q8,
                        spec.velocity.q8 as f64 / 256.0
                    ),
                    "o deslocamento por tick e arredondado ao multiplo de 1/256 px mais proximo"
                        .to_string(),
                )
            };
            w.report.push(serde_json::json!({ "item": item, "source": serde_json::Value::Null, "fidelity": fid,
                "target": format!("{}:set_velocity", state_id(*state_no)), "reason": reason, "consequence": consequence }));
        }
    }
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
        // O C gerado pelo runtime MUGEN nao pode poluir o console do usuario com avisos.
        let runtime_warnings: Vec<&str> = result
            .log
            .iter()
            .filter(|line| {
                line.level != "info"
                    && line.level != "success"
                    && line.message.contains("rds_mugen")
            })
            .map(|line| line.message.as_str())
            .collect();
        assert!(
            runtime_warnings.is_empty(),
            "avisos do runtime MUGEN no build: {runtime_warnings:?}"
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
        // VelSet x = 2, trigger1 = 1: dentro do contrato de locomocao (antes: nao ligado).
        assert_eq!(
            find("behavior", "controller:210#Push")["fidelity"],
            "direct"
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

    // ---------------------------------------------------------------- 3a amostra: Warden

    fn classify_warden(emu: &EmulatorCore) -> &'static str {
        let (raw, size, format) = emu.get_framebuffer().expect("fb");
        let fb = framebuffer_to_rgba(&raw, size, format);
        let w = fb.width as usize;
        let px = |x: usize, y: usize| {
            let i = (y * w + x) * 4;
            (fb.rgba[i], fb.rgba[i + 1], fb.rgba[i + 2])
        };
        let (hi, lo) = (|v: u8| v > 160, |v: u8| v < 90);
        let green = |p: (u8, u8, u8)| lo(p.0) && hi(p.1) && lo(p.2);
        let blue = |p: (u8, u8, u8)| lo(p.0) && lo(p.1) && hi(p.2);
        let yellow = |p: (u8, u8, u8)| hi(p.0) && hi(p.1) && lo(p.2);
        let white = |p: (u8, u8, u8)| hi(p.0) && hi(p.1) && hi(p.2);
        let any = |p: (u8, u8, u8)| green(p) || blue(p) || yellow(p) || white(p);
        if yellow(px(104, 140)) && !any(px(104, 110)) {
            "w2_hv"
        } else if blue(px(104, 110)) && white(px(97, 97)) {
            "w1"
        } else if green(px(104, 110)) && !white(px(97, 97)) {
            "w0"
        } else {
            "?"
        }
    }

    #[test]
    fn warden_report_is_all_direct() {
        let (root, project) = import_fixture("warden", "warden-model");
        let report: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(project.join("assets/mugen/warden_import_report.json")).unwrap(),
        )
        .unwrap();
        for key in ["resources", "behavior"] {
            for r in report[key].as_array().unwrap() {
                assert_eq!(r["fidelity"], "direct", "{key}: {r}");
            }
        }
        assert!(
            report["diagnostics"].as_array().unwrap().is_empty(),
            "{}",
            report["diagnostics"]
        );
        let _ = fs::remove_dir_all(root);
    }

    #[ignore]
    #[test]
    fn mugen_warden_real_build_and_run() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let out = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join(format!("target-test/validation/rex-mugen/warden-{stamp}"));
        fs::create_dir_all(&out).unwrap();
        let (root, project) = import_fixture("warden", "warden-real");
        let (rom, rom_sha, _sym) = build(&project);
        fs::copy(&rom, out.join("warden.rom")).unwrap();
        let mut emu = EmulatorCore::new(None);
        emu.load_rom(&rom).unwrap();
        emu.set_joypad(JoypadState::default()).unwrap();
        for _ in 0..60 {
            emu.run_frame().unwrap();
        }
        let mut idle = Vec::new();
        for _ in 0..20 {
            emu.run_frame().unwrap();
            idle.push(classify_warden(&emu));
        }
        emu.set_joypad(JoypadState {
            y: true,
            ..JoypadState::default()
        })
        .unwrap();
        let mut after = Vec::new();
        for i in 0..30 {
            if i == 2 {
                emu.set_joypad(JoypadState::default()).unwrap();
            }
            emu.run_frame().unwrap();
            after.push(classify_warden(&emu));
        }
        let (ri, ra) = (runs_of(&idle), runs_of(&after));
        println!("warden idle {ri:?}\nwarden depois de A {ra:?}");
        fs::write(out.join("report.json"), serde_json::to_string_pretty(&serde_json::json!({
            "rom_sha256": rom_sha,
            "idle_runs": ri.iter().map(|(l, n)| serde_json::json!([l, n])).collect::<Vec<_>>(),
            "after_a_runs": ra.iter().map(|(l, n)| serde_json::json!([l, n])).collect::<Vec<_>>(),
            "layer": "tecnica: import pelo produto + build SGDK + core direto",
        })).unwrap()).unwrap();
        // Previsao (fixture::warden): idle so W1 (Loopstart no ultimo frame);
        // golpe W2 HV 2, W1 4, W0 2 + volta ao idle W0 2 = W0 4, depois W1 parado.
        assert_eq!(ri, vec![("w1", 20)], "idle apos o 1o ciclo: so W1");
        let start = ra
            .iter()
            .position(|(l, _)| *l == "w2_hv")
            .expect("golpe nunca apareceu");
        assert_eq!(
            &ra[start..],
            &[
                ("w2_hv", 2),
                ("w1", 4),
                ("w0", 4),
                ("w1", ra.last().unwrap().1)
            ][..],
            "{ra:?}"
        );
        emu.stop().ok();
        let _ = fs::remove_dir_all(root);
    }

    // ---------------------------------------------------------------- negativos

    /// Importa uma Probe alterada; devolve (raiz, projeto, resultado).
    fn import_mutated(
        name: &str,
        mutate: impl FnOnce(&Path),
    ) -> (PathBuf, PathBuf, Result<(), String>) {
        let root = temp(name);
        let donor = root.join("donor");
        copy_dir(&probe_dir(), &donor);
        mutate(&donor);
        let project = root.join("project");
        create_project_skeleton(&project, "Probe", "megadrive").unwrap();
        let r = import_mugen_project(&project, &donor)
            .map(|_| ())
            .map_err(|e| e.0);
        (root, project, r)
    }

    /// Falha nao deixa projeto parcial apresentado como valido: cena sem entidade e sem atlas.
    fn assert_untouched(project: &Path) {
        let scene = load_scene(project, DEFAULT_ENTRY_SCENE).unwrap();
        assert!(
            scene.entities.iter().all(|e| e.components.sprite.is_none()),
            "entidade parcial na cena"
        );
        let sprites: Vec<_> = fs::read_dir(project.join("assets/sprites"))
            .unwrap()
            .flatten()
            .collect();
        assert!(sprites.is_empty(), "atlas parcial: {sprites:?}");
    }

    #[test]
    fn negative_path_escaping_the_package_is_refused() {
        let (root, project, r) = import_mutated("neg-path", |d| {
            let def = fs::read_to_string(d.join("probe.def")).unwrap();
            fs::copy(d.join("probe.sff"), d.parent().unwrap().join("fora.sff")).unwrap();
            fs::write(
                d.join("probe.def"),
                def.replace("sprite = probe.sff", "sprite = ../fora.sff"),
            )
            .unwrap();
        });
        let e = r.unwrap_err();
        assert!(e.contains("sai do pacote"), "{e}");
        assert_untouched(&project);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn negative_oversized_air_is_refused() {
        let (root, project, r) = import_mutated("neg-size", |d| {
            let mut air = fs::read_to_string(d.join("probe.air")).unwrap();
            air.push_str(&";".repeat((super::MAX_TEXT_BYTES + 1) as usize));
            fs::write(d.join("probe.air"), air).unwrap();
        });
        assert!(r.unwrap_err().contains("acima do limite"));
        assert_untouched(&project);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn negative_truncated_sff_fails_without_partial_project() {
        let (root, project, r) = import_mutated("neg-trunc", |d| {
            let sff = fs::read(d.join("probe.sff")).unwrap();
            fs::write(d.join("probe.sff"), &sff[..600]).unwrap();
        });
        assert!(r.is_err(), "SFF truncado nao pode importar");
        assert_untouched(&project);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn negative_cell_over_budget_is_refused() {
        let (root, project, r) = import_mutated("neg-budget", |d| {
            // eixo x=300 empurra a celula comum alem de 248 px
            let mut sff = fs::read(d.join("probe.sff")).unwrap();
            sff[512 + 8..512 + 10].copy_from_slice(&300i16.to_le_bytes());
            fs::write(d.join("probe.sff"), sff).unwrap();
        });
        let e = r.unwrap_err();
        assert!(e.contains("plan.budget.cell_too_large"), "{e}");
        assert_untouched(&project);
        let _ = fs::remove_dir_all(root);
    }

    /// Dado do modelo fora do representavel bloqueia o build (#error), nao aproxima.
    #[test]
    fn negative_invalid_model_edit_blocks_the_build() {
        let (root, project) = import_probe("neg-build");
        let mut scene = load_scene(&project, DEFAULT_ENTRY_SCENE).unwrap();
        // Como o Inspector: os dois campos coerentes, valor nao representavel.
        let punch = scene
            .entities
            .iter_mut()
            .find(|e| e.entity_id == "probe")
            .unwrap()
            .components
            .sprite
            .as_mut()
            .unwrap()
            .animations
            .get_mut("action_200")
            .unwrap();
        punch.frame_durations.as_mut().unwrap()[0] = 0;
        punch.mugen_frames.as_mut().unwrap()[0].duration = 0;
        save_scene(&project, DEFAULT_ENTRY_SCENE, &scene).unwrap();
        let proj = crate::core::project_mgr::load_project(&project).unwrap();
        let scene = load_scene(&project, DEFAULT_ENTRY_SCENE).unwrap();
        let ast = crate::compiler::ast_generator::generate_ast(&proj, &scene);
        let c = crate::compiler::sgdk_emitter::emit_sgdk(&ast, "Probe").main_c;
        assert!(
            c.contains("#error \"RetroDev MUGEN") && c.contains("duracao 0"),
            "build deve ser bloqueado"
        );
        let _ = fs::remove_dir_all(root);
    }

    /// Divergencia entre `frame_durations` e `mugen_frames[].duration` nao chega a ROM:
    /// bloqueia o build nomeando animacao, quadro e os dois valores; o projeto no disco
    /// nao e reescrito.
    #[test]
    fn negative_divergent_duration_fields_block_the_build_and_leave_the_project_alone() {
        let (root, project) = import_probe("neg-diverge");
        let mut scene = load_scene(&project, DEFAULT_ENTRY_SCENE).unwrap();
        {
            let punch = scene
                .entities
                .iter_mut()
                .find(|e| e.entity_id == "probe")
                .unwrap()
                .components
                .sprite
                .as_mut()
                .unwrap()
                .animations
                .get_mut("action_200")
                .unwrap();
            punch.frame_durations.as_mut().unwrap()[1] = 12; // so um dos campos
        }
        save_scene(&project, DEFAULT_ENTRY_SCENE, &scene).unwrap();
        let on_disk = fs::read(project.join("scenes/main.json")).unwrap();
        let proj = crate::core::project_mgr::load_project(&project).unwrap();
        let scene = load_scene(&project, DEFAULT_ENTRY_SCENE).unwrap();
        let ast = crate::compiler::ast_generator::generate_ast(&proj, &scene);
        let c = crate::compiler::sgdk_emitter::emit_sgdk(&ast, "Probe").main_c;
        assert!(
            c.contains("#error \"RetroDev MUGEN")
                && c.contains("action_200")
                && c.contains("quadro 2")
                && c.contains("frame_durations = 12")
                && c.contains("mugen_frames[1].duration = 6"),
            "divergencia deve bloquear identificando animacao, quadro e valores"
        );
        assert_eq!(
            fs::read(project.join("scenes/main.json")).unwrap(),
            on_disk,
            "gerar nao reescreve o projeto"
        );
        let _ = fs::remove_dir_all(root);
    }

    // ------------------------------------------------------------ locomocao (VelSet)

    fn strider_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../crates/rex-mugen/fixtures/strider")
    }

    /// Importa a fixture `strider` (com o CNS trocado por `edit`) pelo caminho do produto.
    fn import_strider(name: &str, edit: impl FnOnce(String) -> String) -> (PathBuf, PathBuf) {
        let root = temp(name);
        let donor = root.join("donor");
        copy_dir(&strider_dir(), &donor);
        let cns = fs::read_to_string(donor.join("strider.cns")).unwrap();
        fs::write(donor.join("strider.cns"), edit(cns)).unwrap();
        let project = root.join("project");
        create_project_skeleton(&project, "Strider", "megadrive").unwrap();
        import_mugen_project(&project, &donor).expect("importa a Strider");
        (root, project)
    }

    fn strider_report(project: &Path) -> serde_json::Value {
        serde_json::from_str(
            &fs::read_to_string(project.join("assets/mugen/strider_import_report.json")).unwrap(),
        )
        .unwrap()
    }

    fn behavior_item<'a>(report: &'a serde_json::Value, item: &str) -> &'a serde_json::Value {
        report["behavior"]
            .as_array()
            .unwrap()
            .iter()
            .find(|b| b["item"] == item)
            .unwrap_or_else(|| panic!("item {item} ausente do relatorio"))
    }

    fn strider_c(project: &Path) -> String {
        let proj = crate::core::project_mgr::load_project(project).unwrap();
        let scene = load_scene(project, DEFAULT_ENTRY_SCENE).unwrap();
        let ast = crate::compiler::ast_generator::generate_ast(&proj, &scene);
        crate::compiler::sgdk_emitter::emit_sgdk(&ast, "Strider").main_c
    }

    fn strider_graph_nodes(project: &Path) -> Vec<serde_json::Value> {
        let scene = load_scene(project, DEFAULT_ENTRY_SCENE).unwrap();
        let entity = scene
            .entities
            .iter()
            .find(|e| e.entity_id == "strider")
            .unwrap();
        let graph: serde_json::Value = serde_json::from_str(
            entity
                .components
                .logic
                .as_ref()
                .unwrap()
                .graph
                .as_ref()
                .unwrap(),
        )
        .unwrap();
        graph["nodes"].as_array().unwrap().clone()
    }

    fn velocity_nodes(nodes: &[serde_json::Value], state: i64) -> Vec<serde_json::Value> {
        nodes
            .iter()
            .filter(|n| {
                n["type"] == "set_velocity"
                    && n["params"]["profile"] == "mugen.character.v1"
                    && n["params"]["state_no"] == state
            })
            .cloned()
            .collect()
    }

    #[test]
    fn velocity_literals_convert_to_q8_with_documented_rounding() {
        use super::parse_velocity_q8;
        let ok = |t: &str| parse_velocity_q8(t).unwrap();
        assert_eq!((ok("2.5").q8, ok("2.5").exact), (640, true));
        assert_eq!((ok("-1.75").q8, ok("-1.75").exact), (-448, true));
        assert_eq!((ok("0").q8, ok("+3").q8), (0, 768));
        assert_eq!((ok("2.4").q8, ok("2.4").exact), (614, false));
        // metade para longe do zero (1/512 px = meio passo)
        assert_eq!(ok("0.001953125").q8, 1);
        assert_eq!(ok("-0.001953125").q8, -1);
        assert_eq!(ok("127.99609375").q8, 32767);
        for bad in [
            "",
            "abc",
            "1e2",
            "2,5",
            "1.",
            ".5",
            "1+1",
            "128",
            "-128",
            "const(velocity.walk.fwd.x)",
            "1234567",
            "0.1234567891",
        ] {
            assert!(
                parse_velocity_q8(bad).is_err(),
                "'{bad}' deveria ser recusado"
            );
        }
    }

    #[test]
    fn strider_import_wires_velset_into_the_state_graph_and_reports_it() {
        let (root, project) = import_strider("strider-wire", |c| c);
        let nodes = strider_graph_nodes(&project);
        for (state, vx) in [(0i64, "0"), (20, "2.5"), (21, "-1.75"), (200, "0")] {
            let v = velocity_nodes(&nodes, state);
            let body: Vec<_> = v
                .iter()
                .filter(|n| n["params"]["instance"] == "body")
                .collect();
            assert_eq!(body.len(), 1, "estado {state}: um no de corpo");
            assert_eq!(body[0]["params"]["vx"], vx);
            assert_eq!(body[0]["params"]["target"], "strider");
            if state != 0 {
                assert!(
                    v.iter().any(|n| n["params"]["instance"] == "enter"),
                    "estado {state}: aplicado tambem na entrada"
                );
            }
        }
        let report = strider_report(&project);
        for (item, fid) in [
            ("controller:20#Walk", "direct"),
            ("controller:21#Walk", "direct"),
            ("controller:0#Stop", "direct"),
        ] {
            assert_eq!(behavior_item(&report, item)["fidelity"], fid, "{item}");
        }
        // nenhum VelSet do perfil ficou como referencia nao ligada
        assert!(!nodes
            .iter()
            .any(|n| n["type"] == "set_velocity" && n["params"]["wired"] == false));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn strider_generation_uses_per_entity_velocity_and_state_machine() {
        let (root, project) = import_strider("strider-gen", |c| c);
        let c = strider_c(&project);
        for expect in [
            "rds_mugen_spr_strider_vx = 640;",
            "rds_mugen_spr_strider_vx = -448;",
            "rds_mugen_spr_strider_vx = 0;",
            "static volatile s16 rds_mugen_spr_strider_vx = 0;",
            "static s16 rds_mugen_spr_strider_xacc = 0;",
            "logic_var_fsm_state_strider",
        ] {
            assert!(c.contains(expect), "C sem `{expect}`");
        }
        assert!(!c.contains("#error"), "geracao limpa");
        assert!(
            !c.contains("logic_var_fsm_state ="),
            "sem maquina global compartilhada"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn strider_fractional_literal_not_on_the_grid_is_approximate_and_explicit() {
        let (root, project) = import_strider("strider-approx", |c| c.replace("x = 2.5", "x = 2.4"));
        let report = strider_report(&project);
        let item = behavior_item(&report, "controller:20#Walk");
        assert_eq!(item["fidelity"], "approximate");
        assert!(item["reason"].as_str().unwrap().contains("614/256"));
        assert!(strider_c(&project).contains("rds_mugen_spr_strider_vx = 614;"));
        let _ = fs::remove_dir_all(root);
    }

    /// Sintaxe fora do contrato nao vira constante: relatorio `unsupported`, sem no ligado.
    #[test]
    fn strider_unsupported_velset_forms_are_refused_not_guessed() {
        let cases: [(&str, &str, &str, &str); 6] = [
            (
                "expr",
                "x = 2.5",
                "x = const(velocity.walk.fwd.x)",
                "literal decimal",
            ),
            (
                "trigger",
                "x = 2.5\ntrigger1 = 1",
                "x = 2.5\ntrigger1 = Time = 0",
                "gatilho",
            ),
            ("vertical", "x = 2.5", "x = 2.5\ny = -3", "vertical"),
            ("range", "x = 2.5", "x = 200", "intervalo"),
            ("only_y", "x = 2.5", "y = 0", "sem componente x"),
            (
                "param",
                "x = 2.5",
                "x = 2.5\nignorehitpause = 1",
                "ignorehitpause",
            ),
        ];
        for (name, from, to, reason) in cases {
            let (root, project) = import_strider(&format!("strider-neg-{name}"), |c| {
                assert!(c.contains(from), "{name}: trecho ausente");
                c.replace(from, to)
            });
            let report = strider_report(&project);
            let item = behavior_item(&report, "controller:20#Walk");
            assert_eq!(item["fidelity"], "unsupported", "{name}");
            assert!(
                item["reason"].as_str().unwrap().contains(reason),
                "{name}: {}",
                item["reason"]
            );
            let nodes = strider_graph_nodes(&project);
            assert!(
                velocity_nodes(&nodes, 20).is_empty(),
                "{name}: nao liga o no"
            );
            let c = strider_c(&project);
            assert!(!c.contains("rds_mugen_spr_strider_vx = 640;"), "{name}");
            let _ = fs::remove_dir_all(root);
        }
    }

    #[test]
    fn strider_velocity_edit_in_the_model_changes_the_generated_c_and_invalid_edit_blocks() {
        let (root, project) = import_strider("strider-edit", |c| c);
        let mut scene = load_scene(&project, DEFAULT_ENTRY_SCENE).unwrap();
        let set_vx = |scene: &mut crate::ugdm::entities::Scene, vx: &str| {
            let logic = scene
                .entities
                .iter_mut()
                .find(|e| e.entity_id == "strider")
                .unwrap()
                .components
                .logic
                .as_mut()
                .unwrap();
            let mut graph: serde_json::Value =
                serde_json::from_str(logic.graph.as_ref().unwrap()).unwrap();
            for n in graph["nodes"].as_array_mut().unwrap() {
                if n["type"] == "set_velocity" && n["params"]["state_no"] == 20 {
                    n["params"]["vx"] = serde_json::json!(vx);
                }
            }
            logic.graph = Some(graph.to_string());
        };
        set_vx(&mut scene, "3.75");
        save_scene(&project, DEFAULT_ENTRY_SCENE, &scene).unwrap();
        let c = strider_c(&project);
        assert!(c.contains("rds_mugen_spr_strider_vx = 960;"));
        assert!(!c.contains("rds_mugen_spr_strider_vx = 640;"));
        // valor nao representavel: bloqueia o build, nao vira 0
        set_vx(&mut scene, "300");
        save_scene(&project, DEFAULT_ENTRY_SCENE, &scene).unwrap();
        let c = strider_c(&project);
        assert!(c.contains("#error") && c.contains("mugen_velset") && c.contains("intervalo"));
        assert!(!c.contains("rds_mugen_spr_strider_vx = 0;\n") || c.contains("#error"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn two_controlled_instances_do_not_share_velocity_or_state_machine() {
        let (root, project) = import_strider("strider-two", |c| c);
        let mut scene = load_scene(&project, DEFAULT_ENTRY_SCENE).unwrap();
        let mut second = scene
            .entities
            .iter()
            .find(|e| e.entity_id == "strider")
            .unwrap()
            .clone();
        second.entity_id = "strider2".to_string();
        second.transform.x += 120;
        let logic = second.components.logic.as_mut().unwrap();
        logic.graph = logic
            .graph
            .as_ref()
            .map(|g| g.replace("\"strider\"", "\"strider2\""));
        scene.entities.push(second);
        save_scene(&project, DEFAULT_ENTRY_SCENE, &scene).unwrap();
        let c = strider_c(&project);
        assert!(c.contains("logic_var_fsm_state_strider ="), "maquina da 1a");
        assert!(
            c.contains("logic_var_fsm_state_strider2 ="),
            "maquina da 2a"
        );
        assert_eq!(
            c.matches("static volatile s16 rds_mugen_").count(),
            2,
            "um vx por instancia"
        );
        assert!(
            c.contains("rds_mugen_spr_strider2_vx = 640;") || c.contains("_strider2_vx = 640;")
        );
        assert!(!c.contains("#error"), "geracao limpa com duas instancias");
        let _ = fs::remove_dir_all(root);
    }

    /// Locomocao com a toolchain e o core reais: o deslocamento por quadro bate com o contrato
    /// (`floor(soma(vx_q8)/256)` com o vx de cada quadro derivado das ENTRADAS, nao do runtime).
    #[ignore]
    #[test]
    fn mugen_strider_real_build_run_locomotion() {
        let (root, project) = import_strider("strider-real", |c| c);
        let (rom, _sha, sym) = build(&project);
        let x_addr = sym["spr_strider_x"];
        let mut emu = EmulatorCore::new(None);
        emu.load_rom(&rom).expect("load");
        emu.set_joypad(JoypadState::default()).unwrap();
        for _ in 0..60 {
            emu.run_frame().unwrap();
        }
        let x0 = read_u16(&emu, x_addr) as i16;
        assert_eq!(x0, 96, "posicao inicial da entidade");
        // (quadros, direita, esquerda)
        let script: [(usize, bool, bool); 6] = [
            (30, false, false),
            (40, true, false),
            (30, false, false),
            (40, false, true),
            (30, false, false),
            (25, true, false),
        ];
        let (mut acc, mut expected, mut observed): (i32, i32, Vec<i16>) = (0, 0, Vec::new());
        let mut mismatches = Vec::new();
        let mut frame = 0usize;
        for (frames, right, left) in script {
            emu.set_joypad(JoypadState {
                right,
                left,
                ..JoypadState::default()
            })
            .unwrap();
            for _ in 0..frames {
                emu.run_frame().unwrap();
                let vq8: i32 = if right {
                    640
                } else if left {
                    -448
                } else {
                    0
                };
                acc += vq8;
                let step = acc >> 8;
                acc -= step << 8;
                expected += step;
                let x = read_u16(&emu, x_addr) as i16;
                observed.push(x);
                if x as i32 != 96 + expected {
                    mismatches.push((frame, x, 96 + expected));
                }
                frame += 1;
            }
        }
        let total: Vec<i16> = observed.iter().copied().step_by(10).collect();
        eprintln!("x a cada 10 quadros: {total:?}");
        eprintln!(
            "primeiros desvios: {:?}",
            &mismatches[..mismatches.len().min(12)]
        );
        assert!(
            mismatches.is_empty(),
            "{} quadros divergem do contrato",
            mismatches.len()
        );
        let _ = fs::remove_dir_all(root);
    }

    /// Gatilho fora do perfil vira ponte explicita, nunca transicao silenciosa.
    #[test]
    fn negative_unsupported_trigger_is_bridged_not_wired() {
        let (root, project, r) = import_mutated("neg-trigger", |d| {
            let cns = fs::read_to_string(d.join("probe.cns")).unwrap();
            fs::write(
                d.join("probe.cns"),
                cns.replace("trigger1 = AnimTime = 0", "trigger1 = Time > 20"),
            )
            .unwrap();
        });
        r.unwrap();
        let report: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(project.join("assets/mugen/probe_import_report.json")).unwrap(),
        )
        .unwrap();
        let end = report["behavior"]
            .as_array()
            .unwrap()
            .iter()
            .find(|b| b["item"] == "controller:200#End")
            .unwrap();
        assert_eq!(end["fidelity"], "unsupported");
        let graph = fs::read_to_string(project.join("graphs/mugen_probe.json")).unwrap();
        assert!(
            !graph.contains("\"t_200_0\""),
            "sem transicao para gatilho nao suportado"
        );
        assert!(graph.contains("mugen_changestate_unsupported_trigger"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn negative_logic_file_outside_the_package_is_refused() {
        let (root, project, r) = import_mutated("neg-cmd", |d| {
            fs::copy(d.join("probe.cmd"), d.parent().unwrap().join("fora.cmd")).unwrap();
            let def = fs::read_to_string(d.join("probe.def")).unwrap();
            fs::write(
                d.join("probe.def"),
                def.replace("cmd = probe.cmd", "cmd = ../fora.cmd"),
            )
            .unwrap();
        });
        assert!(r.unwrap_err().contains("sai do pacote"));
        assert_untouched(&project);
        let _ = fs::remove_dir_all(root);
    }

    // ---------------------------------------------------------------- produto: falha e resumo

    fn escaping_probe(root: &Path) -> PathBuf {
        let donor = root.join("donor");
        copy_dir(&probe_dir(), &donor);
        fs::copy(donor.join("probe.sff"), root.join("fora.sff")).unwrap();
        let def = fs::read_to_string(donor.join("probe.def")).unwrap();
        fs::write(
            donor.join("probe.def"),
            def.replace("sprite = probe.sff", "sprite = ../fora.sff"),
        )
        .unwrap();
        donor
    }

    /// Falha pelos comandos do produto: a pasta criada pela importacao desaparece.
    #[test]
    fn failed_import_does_not_leave_a_project_that_looks_valid() {
        let root = temp("fail-cleanup");
        let donor = escaping_probe(&root);
        let base = root.join("projects");
        fs::create_dir_all(&base).unwrap();
        for profile in [None, Some("mugen")] {
            let err = match profile {
                None => crate::import_mugen_project_at_base_dir(&base, "Escape", &donor)
                    .err()
                    .expect("importacao deveria falhar"),
                Some(p) => crate::import_external_project_at_base_dir(&base, "Escape", p, &donor)
                    .err()
                    .expect("importacao deveria falhar"),
            };
            assert!(err.contains("sai do pacote"), "{err}");
            let left: Vec<_> = fs::read_dir(&base)
                .unwrap()
                .flatten()
                .map(|e| e.path())
                .collect();
            assert!(left.is_empty(), "{profile:?}: sobrou {left:?}");
        }
        let _ = fs::remove_dir_all(root);
    }

    /// Pasta de destino que ja existia vazia volta a ficar vazia (nunca e apagada).
    #[test]
    fn failed_import_into_existing_empty_dir_keeps_the_dir_empty() {
        let root = temp("fail-existing");
        let donor = escaping_probe(&root);
        let base = root.join("projects");
        let preferred = base.join("Escape");
        fs::create_dir_all(&preferred).unwrap();
        let _ = crate::import_mugen_project_at_base_dir(&base, "Escape", &donor)
            .err()
            .expect("importacao deveria falhar");
        assert!(
            preferred.is_dir(),
            "pasta preexistente nao pode ser apagada"
        );
        assert_eq!(fs::read_dir(&preferred).unwrap().count(), 0);
        let _ = fs::remove_dir_all(root);
    }

    /// Sucesso: o aviso resume perdas e o relatorio traz as 7 categorias com status honesto.
    #[test]
    fn successful_import_summarizes_losses_by_category() {
        let root = temp("summary");
        let donor = root.join("donor");
        copy_dir(&probe_dir(), &donor);
        let base = root.join("projects");
        fs::create_dir_all(&base).unwrap();
        let result =
            crate::import_external_project_at_base_dir(&base, "Probe", "mugen", &donor).unwrap();
        let notice = result.notice.clone().unwrap_or_default();
        assert!(notice.contains("MUGEN (Experimental)"), "{notice}");
        assert!(
            notice.contains("precisam de ajuste manual") && notice.contains("nao convertidos"),
            "{notice}"
        );
        let report: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(
                Path::new(&result.path).join("assets/mugen/probe_import_report.json"),
            )
            .unwrap(),
        )
        .unwrap();
        let status = |id: &str| {
            report["summary"]["categories"]
                .as_array()
                .unwrap()
                .iter()
                .find(|c| c["id"] == id)
                .map(|c| c["status"].as_str().unwrap().to_string())
                .unwrap()
        };
        assert_eq!(status("sprites"), "direct");
        assert_eq!(status("animations"), "direct");
        assert_eq!(status("commands"), "direct");
        assert_eq!(status("states"), "direct");
        assert_eq!(
            status("collisions"),
            "manual",
            "caixas preservadas mas sem logica"
        );
        assert_eq!(status("sound"), "absent");
        assert_eq!(status("stage"), "absent");
        assert_eq!(report["summary"]["totals"]["manual"], 1);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn sentinel_summary_exposes_every_loss_class() {
        let (root, project) = import_fixture("sentinel", "sentinel-summary");
        let report: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(project.join("assets/mugen/sentinel_import_report.json")).unwrap(),
        )
        .unwrap();
        let t = &report["summary"]["totals"];
        for k in ["direct", "approximate", "manual", "unsupported"] {
            assert!(t[k].as_u64().unwrap() > 0, "{k}: {t}");
        }
        assert!(
            report["summary"]["manual_bridges"].as_u64().unwrap() >= 2,
            "Taunt, Alt (Push virou VelSet ligado)"
        );
        let _ = fs::remove_dir_all(root);
    }
}
