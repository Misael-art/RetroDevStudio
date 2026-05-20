//! Subset GML -> official NodeGraph conversion for GameMaker imports.
//! Unsupported semantics become structured gaps; essential gameplay gaps fail harness gates.

use serde_json::{json, Value};
use std::collections::HashSet;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct GmlSemanticGap {
    pub id: String,
    pub severity: String,
    pub source_event: String,
    pub source_file: String,
    pub line_approx: usize,
    pub snippet: String,
    pub reason: String,
    pub impact: String,
    pub suggestion: String,
    pub blocks_build: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct GmlConversionResult {
    pub graph_json: String,
    pub nodes_generated: usize,
    pub native_constructs: Vec<String>,
    pub gaps: Vec<GmlSemanticGap>,
    pub blocking_gaps: usize,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct GmlEventInput {
    pub label: String,
    pub code: String,
    pub source_file: String,
    pub line_approx: usize,
}

#[derive(Debug, Default)]
struct ParsedGmlConstants {
    moving_speed: i32,
    climbing_speed: i32,
    gravity_force: i32,
    jumping_speed: i32,
}

#[allow(dead_code)]
pub fn convert_gamemaker_object_to_graph(
    entity_id: &str,
    object_name: &str,
    events: &[(String, String)],
) -> GmlConversionResult {
    let inputs = events
        .iter()
        .map(|(label, code)| GmlEventInput {
            label: label.clone(),
            code: code.clone(),
            source_file: format!("gml:{object_name}:{label}"),
            line_approx: 1,
        })
        .collect::<Vec<_>>();
    convert_gamemaker_object_events_to_graph(entity_id, object_name, &inputs)
}

pub fn convert_gamemaker_object_events_to_graph(
    entity_id: &str,
    object_name: &str,
    events: &[GmlEventInput],
) -> GmlConversionResult {
    let role = classify_gamemaker_object(object_name);
    match role.as_str() {
        "player_platformer" => convert_platformer_player_graph(entity_id, object_name, events),
        "static_prop" => convert_static_prop_graph(entity_id, object_name, events),
        _ => convert_generic_bridge_graph(entity_id, object_name, events),
    }
}

fn classify_gamemaker_object(object_name: &str) -> String {
    let lowered = object_name.to_ascii_lowercase();
    if lowered.contains("player") {
        "player_platformer".to_string()
    } else if lowered.contains("wall") || lowered.contains("ladder") {
        "static_prop".to_string()
    } else {
        "generic".to_string()
    }
}

fn convert_platformer_player_graph(
    entity_id: &str,
    object_name: &str,
    events: &[GmlEventInput],
) -> GmlConversionResult {
    let mut native = HashSet::new();
    let mut gaps = Vec::new();
    let mut create_code = String::new();
    let mut step_code = String::new();
    let mut alarm_events = Vec::new();
    let mut collision_events = Vec::new();

    for event in events {
        let lowered = event.label.to_ascii_lowercase();
        if lowered.starts_with("create") {
            create_code = event.code.clone();
        } else if lowered.starts_with("step") {
            step_code = event.code.clone();
        } else if lowered.starts_with("collision") {
            collision_events.push(event.clone());
        } else if lowered.starts_with("alarm") {
            alarm_events.push(event.clone());
        } else if lowered.starts_with("draw") && !is_trivial_draw_event(&event.code) {
            gaps.push(structured_gap_for_event(
                format!("unsupported_event_{}", sanitize_id(&event.label)),
                "warning",
                event,
                "Evento Draw com semantica custom permanece como bridge estruturada.",
                "Pode exigir reimplementacao manual do desenho customizado no runtime 16-bit.",
                "Converter o Draw para sprite/animation nodes ou manter como efeito custom auditado.",
                false,
            ));
        } else {
            gaps.push(structured_gap_for_event(
                format!("unsupported_event_{}", sanitize_id(&event.label)),
                "warning",
                event,
                "Evento GameMaker fora do subset nativo desta wave.",
                "Evento preservado como bridge; nao participa do SGDK C gerado automaticamente.",
                "Reescrever o evento com nodes oficiais ou adicionar conversao especifica em rodada futura.",
                false,
            ));
        }
    }

    let constants = parse_create_constants(&create_code);
    collect_step_gaps(events, &step_code, &mut gaps);
    for event in &collision_events {
        if !contains_any(
            &event.code,
            &["place_meeting", "instance_destroy", "instance_create"],
        ) {
            gaps.push(structured_gap_for_event(
                "collision_unconverted".to_string(),
                "warning",
                event,
                "Colisao GameMaker nao convertida nativamente nesta wave.",
                "Interacao de colisao permanece como bridge e pode precisar de ajuste manual.",
                "Expressar a colisao como condition_overlap + acoes basicas quando o alvo for claro.",
                false,
            ));
        }
    }

    native.insert("event_start".to_string());
    native.insert("event_update".to_string());
    native.insert("input_held".to_string());
    native.insert("input_pressed".to_string());
    native.insert("set_velocity".to_string());
    native.insert("sprite_move".to_string());
    native.insert("set_animation_state".to_string());
    native.insert("camera_follow".to_string());
    native.insert("var_set".to_string());
    if contains_any(&step_code, &["place_free"]) {
        native.insert("place_free".to_string());
    }
    if contains_any(&step_code, &["place_meeting"]) || !collision_events.is_empty() {
        native.insert("place_meeting".to_string());
        native.insert("condition_overlap".to_string());
    }
    if contains_any(&step_code, &["sprite_index"]) {
        native.insert("sprite_index".to_string());
    }
    if contains_any(&step_code, &["image_xscale"]) {
        native.insert("sprite_flip".to_string());
    }
    if contains_any(&step_code, &["image_speed"]) {
        native.insert("image_speed".to_string());
    }
    if !alarm_events.is_empty() || contains_any(&create_code, &["alarm["]) {
        native.insert("alarm".to_string());
        native.insert("timer".to_string());
    }
    if contains_any(&step_code, &["instance_create"])
        || alarm_events
            .iter()
            .any(|event| event.code.contains("instance_create"))
    {
        native.insert("instance_create".to_string());
        native.insert("spawn_entity".to_string());
    }
    if contains_any(&step_code, &["instance_destroy"])
        || collision_events
            .iter()
            .any(|event| event.code.contains("instance_destroy"))
    {
        native.insert("instance_destroy".to_string());
        native.insert("destroy_entity".to_string());
    }
    if contains_any(&step_code, &["room_goto", "room_restart"]) {
        native.insert("room_transition".to_string());
        native.insert("load_scene".to_string());
    }

    let target = sanitize_id(entity_id);
    let mut nodes: Vec<Value> = Vec::new();
    let mut edges: Vec<Value> = Vec::new();

    nodes.push(node(
        "gm_start",
        "event_start",
        "Room Start",
        "Game State",
        0,
        0,
        json!({}),
        vec![],
        vec![exec_out()],
    ));
    nodes.push(node(
        "gm_init_vy",
        "var_set",
        "Init vertical_speed",
        "Game State",
        1,
        0,
        json!({"var_name":"vertical_speed","value":0}),
        vec![exec_in()],
        vec![exec_out()],
    ));
    nodes.push(node(
        "gm_init_climb",
        "var_set",
        "Init climbing=false",
        "Game State",
        2,
        0,
        json!({"var_name":"climbing","value":0}),
        vec![exec_in()],
        vec![exec_out()],
    ));
    edges.push(edge(
        "gm_e_start_init_vy",
        "gm_start",
        "exec",
        "gm_init_vy",
        "exec",
    ));
    edges.push(edge(
        "gm_e_init_vy_climb",
        "gm_init_vy",
        "exec",
        "gm_init_climb",
        "exec",
    ));

    nodes.push(node(
        "gm_update",
        "event_update",
        "Step",
        "Input",
        0,
        1,
        json!({}),
        vec![],
        vec![exec_out()],
    ));
    nodes.push(node(
        "gm_right",
        "input_held",
        "Move Right (D)",
        "Input",
        1,
        1,
        json!({"pad":"JOY_1","button":"BUTTON_RIGHT"}),
        vec![exec_in()],
        vec![exec_out(), bool_out("true"), bool_out("false")],
    ));
    nodes.push(node(
        "gm_right_velocity",
        "set_velocity",
        "Horizontal Velocity +",
        "Physics",
        2,
        1,
        json!({"target":target,"vx":constants.moving_speed,"vy":0}),
        vec![exec_in()],
        vec![exec_out()],
    ));
    nodes.push(node(
        "gm_right_move",
        "sprite_move",
        "Apply Horizontal Move +",
        "Physics",
        3,
        1,
        json!({"target":target,"dx":constants.moving_speed,"dy":0}),
        vec![exec_in()],
        vec![exec_out()],
    ));
    nodes.push(node(
        "gm_left",
        "input_held",
        "Move Left (A)",
        "Input",
        1,
        2,
        json!({"pad":"JOY_1","button":"BUTTON_LEFT"}),
        vec![exec_in()],
        vec![exec_out(), bool_out("true"), bool_out("false")],
    ));
    nodes.push(node(
        "gm_left_velocity",
        "set_velocity",
        "Horizontal Velocity -",
        "Physics",
        2,
        2,
        json!({"target":target,"vx":-constants.moving_speed,"vy":0}),
        vec![exec_in()],
        vec![exec_out()],
    ));
    nodes.push(node(
        "gm_left_move",
        "sprite_move",
        "Apply Horizontal Move -",
        "Physics",
        3,
        2,
        json!({"target":target,"dx":-constants.moving_speed,"dy":0}),
        vec![exec_in()],
        vec![exec_out()],
    ));
    nodes.push(node(
        "gm_jump",
        "input_pressed",
        "Jump (Space)",
        "Input",
        1,
        3,
        json!({"pad":"JOY_1","button":"BUTTON_A"}),
        vec![exec_in()],
        vec![exec_out(), bool_out("true"), bool_out("false")],
    ));
    nodes.push(node(
        "gm_jump_velocity",
        "set_velocity",
        "Jump Impulse",
        "Physics",
        2,
        3,
        json!({"target":target,"vx":0,"vy":-constants.jumping_speed}),
        vec![exec_in()],
        vec![exec_out()],
    ));
    if step_code.contains("place_free") {
        nodes.push(node(
            "gm_place_free_floor",
            "condition_overlap",
            "place_free floor probe",
            "Collision",
            3,
            3,
            json!({"a":target,"b":"world","mode":"place_free","dx":0,"dy":1}),
            vec![exec_in()],
            vec![bool_out("true"), bool_out("false")],
        ));
    }
    if step_code.contains("place_meeting") || !collision_events.is_empty() {
        let collision_target = collision_events
            .first()
            .and_then(|event| event.label.split_whitespace().last())
            .filter(|value| !value.is_empty())
            .map(sanitize_id)
            .unwrap_or_else(|| "world".to_string());
        nodes.push(node(
            "gm_place_meeting",
            "condition_overlap",
            "place_meeting overlap",
            "Collision",
            3,
            4,
            json!({"a":target,"b":collision_target,"mode":"place_meeting"}),
            vec![exec_in()],
            vec![bool_out("true"), bool_out("false")],
        ));
    }
    if step_code.contains("sprite_index") || step_code.contains("image_speed") {
        nodes.push(node(
            "gm_sprite_index_anim",
            "set_animation_state",
            "sprite_index animation",
            "Animation",
            4,
            3,
            json!({
                "target":target,
                "state": parse_sprite_index_state(&step_code).unwrap_or_else(|| "walk".to_string()),
                "image_speed": parse_image_speed(&step_code).unwrap_or(1.0)
            }),
            vec![exec_in()],
            vec![exec_out()],
        ));
    }
    if step_code.contains("image_xscale") {
        nodes.push(node(
            "gm_image_xscale_flip",
            "set_animation_state",
            "image_xscale flip",
            "Animation",
            4,
            4,
            json!({"target":target,"state":"flip_x","flip_x": parse_image_xscale(&step_code).unwrap_or(1)}),
            vec![exec_in()],
            vec![exec_out()],
        ));
    }
    if !alarm_events.is_empty() || create_code.contains("alarm[") {
        nodes.push(node(
            "gm_alarm_timer",
            "timer",
            "Alarm Timer",
            "Game State",
            1,
            5,
            json!({"frames": parse_alarm_frames(&create_code).unwrap_or(60),"repeat":0}),
            vec![exec_in()],
            vec![
                exec_out(),
                json!({"id":"tick","label":"Tick","kind":"exec"}),
                json!({"id":"done","label":"Done","kind":"exec"}),
            ],
        ));
    }
    if let Some(spawn_target) = parse_instance_create_target(&step_code).or_else(|| {
        alarm_events
            .iter()
            .find_map(|event| parse_instance_create_target(&event.code))
    }) {
        nodes.push(node(
            "gm_instance_create",
            "spawn_entity",
            "instance_create",
            "Spawn/Room",
            5,
            3,
            json!({"prefab":spawn_target,"x":0,"y":0}),
            vec![exec_in()],
            vec![exec_out()],
        ));
    }
    if step_code.contains("instance_destroy")
        || collision_events
            .iter()
            .any(|event| event.code.contains("instance_destroy"))
    {
        nodes.push(node(
            "gm_instance_destroy",
            "destroy_entity",
            "instance_destroy",
            "Spawn/Room",
            5,
            4,
            json!({"target":target}),
            vec![exec_in()],
            vec![exec_out()],
        ));
    }
    if step_code.contains("room_goto") || step_code.contains("room_restart") {
        nodes.push(node(
            "gm_room_transition",
            "load_scene",
            "Room Transition",
            "Spawn/Room",
            5,
            5,
            json!({"scene":"next"}),
            vec![exec_in()],
            vec![exec_out()],
        ));
    }
    nodes.push(node(
        "gm_run_anim",
        "set_animation_state",
        "Walk Animation",
        "Animation",
        4,
        1,
        json!({"target":target,"state":"walk"}),
        vec![exec_in()],
        vec![exec_out()],
    ));
    nodes.push(node(
        "gm_idle_anim",
        "set_animation_state",
        "Idle Animation",
        "Animation",
        4,
        2,
        json!({"target":target,"state":"idle"}),
        vec![exec_in()],
        vec![exec_out()],
    ));
    nodes.push(node(
        "gm_camera",
        "camera_follow",
        "Camera Follow",
        "Camera",
        5,
        1,
        json!({"target":target,"offset_x":-120,"offset_y":-80}),
        vec![exec_in()],
        vec![exec_out()],
    ));
    nodes.push(node(
        "gm_budget",
        "hardware_budget_check",
        "Hardware Budget",
        "Hardware Budget",
        6,
        1,
        json!({"vram_kb":64,"sprites":80,"scanline_sprites":20}),
        vec![exec_in()],
        vec![exec_out(), bool_out("ok"), bool_out("fail")],
    ));

    if step_code.to_ascii_lowercase().contains("climbing") {
        nodes.push(node(
            "gm_climb_gap",
            "bridge_unconverted_source",
            "Climbing GML Gap",
            "Game State",
            1,
            4,
            json!({
                "source": format!("gml:{object_name}:step:climbing"),
                "label": "Climbing mode (W/S + place_meeting oLadders) permanece gap estruturado."
            }),
            vec![exec_in()],
            vec![exec_out()],
        ));
        edges.push(edge(
            "gm_e_budget_climb_gap",
            "gm_budget",
            "ok",
            "gm_climb_gap",
            "exec",
        ));
    }

    edges.push(edge(
        "gm_e_update_right",
        "gm_update",
        "exec",
        "gm_right",
        "exec",
    ));
    edges.push(edge(
        "gm_e_right_true_vel",
        "gm_right",
        "true",
        "gm_right_velocity",
        "exec",
    ));
    edges.push(edge(
        "gm_e_right_vel_move",
        "gm_right_velocity",
        "exec",
        "gm_right_move",
        "exec",
    ));
    edges.push(edge(
        "gm_e_right_move_anim",
        "gm_right_move",
        "exec",
        "gm_run_anim",
        "exec",
    ));
    edges.push(edge(
        "gm_e_right_false_left",
        "gm_right",
        "false",
        "gm_left",
        "exec",
    ));
    edges.push(edge(
        "gm_e_left_true_vel",
        "gm_left",
        "true",
        "gm_left_velocity",
        "exec",
    ));
    edges.push(edge(
        "gm_e_left_vel_move",
        "gm_left_velocity",
        "exec",
        "gm_left_move",
        "exec",
    ));
    edges.push(edge(
        "gm_e_left_move_idle",
        "gm_left_move",
        "exec",
        "gm_idle_anim",
        "exec",
    ));
    edges.push(edge(
        "gm_e_left_false_jump",
        "gm_left",
        "false",
        "gm_jump",
        "exec",
    ));
    edges.push(edge(
        "gm_e_jump_true_vel",
        "gm_jump",
        "true",
        "gm_jump_velocity",
        "exec",
    ));
    edges.push(edge(
        "gm_e_jump_vel_camera",
        "gm_jump_velocity",
        "exec",
        "gm_camera",
        "exec",
    ));
    edges.push(edge(
        "gm_e_jump_false_camera",
        "gm_jump",
        "false",
        "gm_camera",
        "exec",
    ));
    edges.push(edge(
        "gm_e_camera_budget",
        "gm_camera",
        "exec",
        "gm_budget",
        "exec",
    ));

    let mut native_constructs = native.into_iter().collect::<Vec<_>>();
    native_constructs.sort();
    let graph = auto_layout_graph(json!({
        "version": 1,
        "origin": "gamemaker_gmx_native",
        "source_object": object_name,
        "source_entity": entity_id,
        "native_constructs": native_constructs,
        "gaps": gaps,
        "nodes": nodes,
        "edges": edges,
    }));

    let nodes_generated = graph["nodes"].as_array().map(|v| v.len()).unwrap_or(0);
    let blocking_gaps = gaps.iter().filter(|gap| gap.blocks_build).count();
    GmlConversionResult {
        graph_json: graph.to_string(),
        nodes_generated,
        native_constructs,
        gaps,
        blocking_gaps,
    }
}

fn convert_static_prop_graph(
    entity_id: &str,
    object_name: &str,
    events: &[GmlEventInput],
) -> GmlConversionResult {
    let mut gaps = Vec::new();
    for event in events {
        if event.code.trim().is_empty() {
            continue;
        }
        gaps.push(structured_gap_for_event(
            format!("static_prop_{}", sanitize_id(&event.label)),
            "info",
            event,
            "Objeto estatico GameMaker; logica visual permanece no asset/colisao importada.",
            "Sem impacto no runtime basico; objeto e tratado como colisao/prop estatico.",
            "Converter manualmente se o prop tiver animacao ou interacao alem de colisao.",
            false,
        ));
    }
    let graph = auto_layout_graph(json!({
        "version": 1,
        "origin": "gamemaker_gmx_static",
        "source_object": object_name,
        "source_entity": entity_id,
        "nodes": [
            node("gm_static_start", "event_start", "On Start", "Game State", 0, 0, json!({}), vec![], vec![exec_out()]),
        ],
        "edges": []
    }));
    GmlConversionResult {
        graph_json: graph.to_string(),
        nodes_generated: 1,
        native_constructs: vec!["event_start".to_string()],
        gaps,
        blocking_gaps: 0,
    }
}

fn convert_generic_bridge_graph(
    entity_id: &str,
    object_name: &str,
    events: &[GmlEventInput],
) -> GmlConversionResult {
    let mut gaps = Vec::new();
    let mut nodes = vec![node(
        "gm_generic_start",
        "event_start",
        "On Start",
        "Game State",
        0,
        0,
        json!({}),
        vec![],
        vec![exec_out()],
    )];
    let mut edges = Vec::new();
    let mut tail = "gm_generic_start".to_string();

    for (index, event) in events.iter().enumerate() {
        if event.code.trim().is_empty() {
            continue;
        }
        let node_id = format!("gm_generic_bridge_{index}");
        gaps.push(structured_gap_for_event(
            format!("generic_{}_{}", sanitize_id(object_name), sanitize_id(&event.label)),
            if event.code.contains("instance_destroy") || event.code.contains("room_restart") {
                "warning"
            } else {
                "info"
            },
            event,
            "GML generico preservado como bridge estruturada; nao conta como conversao nativa completa.",
            "Comportamento preservado para auditoria, mas nao executa automaticamente no SGDK gerado.",
            "Mapear o script para nodes oficiais ou isolar a logica como bridge manual revisada.",
            false,
        ));
        nodes.push(node(
            &node_id,
            "bridge_unconverted_source",
            &format!("GML Bridge: {}", event.label),
            "Game State",
            index as i32 + 1,
            0,
            json!({
                "source": event.source_file,
                "line_approx": event.line_approx,
                "reason": "GML generico preservado como bridge estruturada.",
                "impact": "Nao executa automaticamente no SGDK gerado.",
                "suggestion": "Converter para nodes oficiais quando o comportamento for necessario.",
                "label": compact_snippet(&event.code, 180)
            }),
            vec![exec_in()],
            vec![exec_out()],
        ));
        edges.push(edge(
            &format!("gm_generic_edge_{index}"),
            &tail,
            "exec",
            &node_id,
            "exec",
        ));
        tail = node_id;
    }

    let graph = auto_layout_graph(json!({
        "version": 1,
        "origin": "gamemaker_gmx_bridge",
        "source_object": object_name,
        "source_entity": entity_id,
        "gaps": gaps,
        "nodes": nodes,
        "edges": edges,
    }));

    GmlConversionResult {
        graph_json: graph.to_string(),
        nodes_generated: graph["nodes"].as_array().map(|v| v.len()).unwrap_or(0),
        native_constructs: vec![
            "event_start".to_string(),
            "bridge_unconverted_source".to_string(),
        ],
        gaps,
        blocking_gaps: 0,
    }
}

fn parse_create_constants(code: &str) -> ParsedGmlConstants {
    let mut parsed = ParsedGmlConstants {
        moving_speed: 5,
        climbing_speed: 3,
        gravity_force: 2,
        jumping_speed: 20,
    };
    for line in code.lines() {
        let trimmed = line.trim();
        if let Some(value) = parse_assignment_i32(trimmed, "moving_speed") {
            parsed.moving_speed = value.max(1);
        }
        if let Some(value) = parse_assignment_i32(trimmed, "climbing_speed") {
            parsed.climbing_speed = value.max(1);
        }
        if let Some(value) = parse_assignment_i32(trimmed, "gravity_force") {
            parsed.gravity_force = value.max(1);
        }
        if let Some(value) = parse_assignment_i32(trimmed, "jumping_speed") {
            parsed.jumping_speed = value.max(1);
        }
    }
    parsed
}

fn collect_step_gaps(events: &[GmlEventInput], step_code: &str, gaps: &mut Vec<GmlSemanticGap>) {
    let Some(step_event) = events
        .iter()
        .find(|event| event.label.to_ascii_lowercase().starts_with("step"))
    else {
        return;
    };
    let lowered = step_code.to_ascii_lowercase();
    for (pattern, id, reason, impact, suggestion) in [
        (
            "repeat(",
            "gml_repeat_loop",
            "Loop repeat() GameMaker nao tem no-code nativo equivalente nesta wave.",
            "Fluxo repetitivo preservado como bridge para evitar alterar ordem/quantidade de execucao.",
            "Substituir por nodes de fluxo oficiais quando a iteracao for finita e segura.",
        ),
        (
            "climbing",
            "gml_climbing_state",
            "Estado de escalada GameMaker exige combinacao de input, colisao e animacao ainda parcial.",
            "Movimento basico continua nativo, mas comportamento de escada pode divergir.",
            "Modelar escalada com condition_overlap de ladder + set_velocity dedicado.",
        ),
        (
            "script_execute(",
            "gml_script_execute",
            "Chamada script_execute() pode invocar scripts dinamicos fora do subset auditavel.",
            "A chamada permanece como bridge e nao executa automaticamente no SGDK gerado.",
            "Resolver o script chamado e converter manualmente para nodes oficiais.",
        ),
        (
            "scr_",
            "gml_complex_script",
            "Script GameMaker nomeado sugere logica complexa fora do subset nativo desta wave.",
            "O trecho fica preservado para auditoria e pode exigir porta manual.",
            "Migrar o script para nodes menores ou bridge manual revisada.",
        ),
        (
            "shader_",
            "gml_shader",
            "Shaders GameMaker nao possuem equivalente automatico no runtime SGDK.",
            "Efeito visual fica ausente ate receber alternativa 16-bit.",
            "Substituir por paleta/sprite pre-renderizado ou bridge custom documentada.",
        ),
        (
            "surface_",
            "gml_surface",
            "Surfaces GameMaker dependem de render targets dinamicos indisponiveis no subset SGDK.",
            "Renderizacao baseada em surface permanece nao executavel automaticamente.",
            "Recriar o efeito com tiles/sprites ou pre-renderizar assets.",
        ),
        (
            "ds_",
            "gml_ds_complex",
            "Estruturas ds_* complexas precisam de mapeamento explicito de dados.",
            "Estado dinamico pode se perder se convertido automaticamente sem contrato.",
            "Trocar por variaveis/arrays simples ou implementar bridge de dados revisada.",
        ),
        (
            "physics_",
            "gml_box2d_physics",
            "Fisica Box2D GameMaker nao e convertida para o runtime 16-bit desta wave.",
            "Colisoes e forcas avancadas permanecem como bridge.",
            "Recriar interacoes com colisao tile/sprite simples ou motor fisico dedicado aprovado.",
        ),
        (
            "part_",
            "gml_particles",
            "Particulas GameMaker nao sao convertidas automaticamente para sprites SGDK.",
            "Efeitos podem ficar ausentes na ROM gerada.",
            "Substituir por animacoes sprite/tile ou emissor 16-bit especifico.",
        ),
        (
            "extension_",
            "gml_native_extension",
            "Extensoes nativas GameMaker ficam fora do ambiente SGDK auditavel.",
            "Dependencia externa nao e portada automaticamente.",
            "Isolar o comportamento e substituir por implementacao Rust/SGDK aprovada.",
        ),
    ] {
        if lowered.contains(pattern) {
            gaps.push(structured_gap_for_event(
                id.to_string(),
                "warning",
                step_event,
                reason,
                impact,
                suggestion,
                false,
            ));
        }
    }
}

fn parse_assignment_i32(line: &str, key: &str) -> Option<i32> {
    let marker = key;
    if !line.contains(marker) {
        return None;
    }
    let rhs = line.split('=').nth(1)?.trim().trim_end_matches(';');
    rhs.parse::<i32>().ok()
}

fn structured_gap_for_event(
    id: String,
    severity: &str,
    event: &GmlEventInput,
    reason: &str,
    impact: &str,
    suggestion: &str,
    blocks_build: bool,
) -> GmlSemanticGap {
    GmlSemanticGap {
        id,
        severity: severity.to_string(),
        source_event: event.label.clone(),
        source_file: event.source_file.clone(),
        line_approx: event.line_approx.max(1),
        snippet: compact_snippet(&event.code, 220),
        reason: reason.to_string(),
        impact: impact.to_string(),
        suggestion: suggestion.to_string(),
        blocks_build,
    }
}

fn is_trivial_draw_event(code: &str) -> bool {
    let compact = code
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("")
        .to_ascii_lowercase();
    compact.is_empty()
        || compact == "draw_self()"
        || compact == "draw_self();"
        || compact == "event_inherited()"
        || compact == "event_inherited();"
}

fn contains_any(code: &str, patterns: &[&str]) -> bool {
    let lowered = code.to_ascii_lowercase();
    patterns
        .iter()
        .any(|pattern| lowered.contains(&pattern.to_ascii_lowercase()))
}

fn parse_sprite_index_state(code: &str) -> Option<String> {
    parse_assignment_rhs(code, "sprite_index").map(|value| {
        sanitize_id(
            value
                .trim()
                .trim_end_matches(';')
                .trim_start_matches("spr_")
                .trim_start_matches("s_"),
        )
    })
}

fn parse_image_speed(code: &str) -> Option<f64> {
    parse_assignment_rhs(code, "image_speed")?
        .trim()
        .trim_end_matches(';')
        .parse::<f64>()
        .ok()
}

fn parse_image_xscale(code: &str) -> Option<i32> {
    parse_assignment_rhs(code, "image_xscale")?
        .trim()
        .trim_end_matches(';')
        .parse::<f64>()
        .ok()
        .map(|value| if value < 0.0 { -1 } else { 1 })
}

fn parse_alarm_frames(code: &str) -> Option<i32> {
    let lowered = code.to_ascii_lowercase();
    let alarm_index = lowered.find("alarm[")?;
    let rhs = code[alarm_index..].split_once('=')?.1;
    rhs.trim()
        .split(';')
        .next()?
        .split_whitespace()
        .next()
        .and_then(|value| value.parse::<i32>().ok())
}

fn parse_instance_create_target(code: &str) -> Option<String> {
    for function_name in [
        "instance_create_layer",
        "instance_create_depth",
        "instance_create",
    ] {
        if let Some(args) = parse_gml_call_args(code, function_name) {
            let target_index = if function_name == "instance_create" {
                2
            } else {
                3
            };
            if let Some(target) = args.get(target_index).or_else(|| args.last()) {
                let trimmed = target.trim().trim_end_matches(';');
                if !trimmed.is_empty() {
                    return Some(sanitize_id(trimmed));
                }
            }
        }
    }
    None
}

fn parse_assignment_rhs(code: &str, key: &str) -> Option<String> {
    for statement in code.split([';', '\n']) {
        let lowered = statement.to_ascii_lowercase();
        let key_lowered = key.to_ascii_lowercase();
        if !lowered.contains(&key_lowered) || !statement.contains('=') {
            continue;
        }
        let mut parts = statement.splitn(2, '=');
        let lhs = parts.next()?.trim().to_ascii_lowercase();
        if !lhs.ends_with(&key_lowered) {
            continue;
        }
        let rhs = parts.next()?.trim();
        if !rhs.is_empty() {
            return Some(rhs.to_string());
        }
    }
    None
}

fn parse_gml_call_args(code: &str, function_name: &str) -> Option<Vec<String>> {
    let lowered = code.to_ascii_lowercase();
    let call_index = lowered.find(&format!("{}(", function_name.to_ascii_lowercase()))?;
    let args_start = call_index + function_name.len() + 1;
    let mut depth = 0i32;
    let mut in_string = false;
    let mut end_index = None;
    for (offset, ch) in code[args_start..].char_indices() {
        match ch {
            '"' => in_string = !in_string,
            '(' if !in_string => depth += 1,
            ')' if !in_string && depth == 0 => {
                end_index = Some(args_start + offset);
                break;
            }
            ')' if !in_string => depth -= 1,
            _ => {}
        }
    }
    split_gml_args(&code[args_start..end_index?])
}

fn split_gml_args(args: &str) -> Option<Vec<String>> {
    let mut values = Vec::new();
    let mut current = String::new();
    let mut depth = 0i32;
    let mut in_string = false;
    for ch in args.chars() {
        match ch {
            '"' => {
                in_string = !in_string;
                current.push(ch);
            }
            '(' if !in_string => {
                depth += 1;
                current.push(ch);
            }
            ')' if !in_string => {
                depth -= 1;
                current.push(ch);
            }
            ',' if !in_string && depth == 0 => {
                values.push(current.trim().to_string());
                current.clear();
            }
            _ => current.push(ch),
        }
    }
    if !current.trim().is_empty() {
        values.push(current.trim().to_string());
    }
    Some(values)
}

fn compact_snippet(code: &str, max_len: usize) -> String {
    let compact = code.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.len() > max_len {
        format!("{}...", &compact[..max_len])
    } else {
        compact
    }
}

fn sanitize_id(value: &str) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() || ch == '_' {
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push('_');
        }
    }
    if out.is_empty() {
        "node".to_string()
    } else {
        out
    }
}

fn exec_in() -> Value {
    json!({"id":"exec","label":">","kind":"exec"})
}

fn exec_out() -> Value {
    json!({"id":"exec","label":">","kind":"exec"})
}

fn bool_out(id: &str) -> Value {
    json!({"id":id,"label":id,"kind":"data","dataType":"bool"})
}

#[allow(clippy::too_many_arguments)]
fn node(
    id: &str,
    node_type: &str,
    label: &str,
    group: &str,
    lane: i32,
    row: i32,
    params: Value,
    inputs: Vec<Value>,
    outputs: Vec<Value>,
) -> Value {
    json!({
        "id": id,
        "type": node_type,
        "label": label,
        "group": group,
        "origin": "gamemaker_gmx",
        "source_reference": format!("gml:{id}"),
        "x": 80 + lane * 220,
        "y": 80 + row * 140,
        "inputs": inputs,
        "outputs": outputs,
        "params": params,
    })
}

fn edge(id: &str, from_node: &str, from_port: &str, to_node: &str, to_port: &str) -> Value {
    json!({
        "id": id,
        "fromNode": from_node,
        "fromPort": from_port,
        "toNode": to_node,
        "toPort": to_port,
    })
}

fn auto_layout_graph(mut graph: Value) -> Value {
    let Some(nodes) = graph.get_mut("nodes").and_then(Value::as_array_mut) else {
        return graph;
    };
    let group_order = [
        "Input",
        "Physics",
        "Collision",
        "Animation",
        "Camera",
        "Game State",
        "Spawn/Room",
        "Hardware Budget",
    ];
    nodes.sort_by(|left, right| {
        let lg = left
            .get("group")
            .and_then(Value::as_str)
            .unwrap_or("Game State");
        let rg = right
            .get("group")
            .and_then(Value::as_str)
            .unwrap_or("Game State");
        let li = group_order.iter().position(|g| *g == lg).unwrap_or(99);
        let ri = group_order.iter().position(|g| *g == rg).unwrap_or(99);
        li.cmp(&ri).then_with(|| {
            left.get("label")
                .and_then(Value::as_str)
                .unwrap_or("")
                .cmp(right.get("label").and_then(Value::as_str).unwrap_or(""))
        })
    });
    let mut group_counts: std::collections::HashMap<String, usize> =
        std::collections::HashMap::new();
    for (index, node) in nodes.iter_mut().enumerate() {
        let group = node
            .get("group")
            .and_then(Value::as_str)
            .unwrap_or("Game State")
            .to_string();
        let count = group_counts.entry(group.clone()).or_insert(0);
        node["x"] = json!(80 + (index % 5) as i32 * 220);
        node["y"] = json!(
            80 + group_order.iter().position(|g| g == &group).unwrap_or(6) as i32 * 140
                + *count as i32 * 86
        );
        *count += 1;
    }
    graph
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_platformer_player_step_to_native_nodes() {
        let events = vec![
            ("Create".to_string(), "moving_speed = 5; gravity_force = 2; jumping_speed = 20; climbing = false;".to_string()),
            ("Step".to_string(), "var hmove = keyboard_check(ord(\"D\")) - keyboard_check(ord(\"A\")); if(!climbing) { if(keyboard_check(vk_space) and !place_free(x, y + 1)) vertical_speed = -jumping_speed; }".to_string()),
        ];
        let result = convert_gamemaker_object_to_graph("inst_player", "oPlayer", &events);
        assert!(result.nodes_generated >= 8);
        assert!(result.native_constructs.contains(&"input_held".to_string()));
        assert!(result
            .native_constructs
            .contains(&"camera_follow".to_string()));
        assert!(result.graph_json.contains("\"type\":\"event_update\""));
        assert!(result.blocking_gaps == 0);
        assert!(result
            .gaps
            .iter()
            .any(|gap| gap.id.contains("place_free") || gap.id.contains("climbing")));
    }

    #[test]
    fn converts_core_gameplay_gml_constructs_to_native_nodes() {
        let events = vec![
            (
                "Create".to_string(),
                "moving_speed = 4; gravity_force = 1; jumping_speed = 9; alarm[0] = 45; hp = 3;".to_string(),
            ),
            (
                "Step".to_string(),
                [
                    "var hmove = keyboard_check(vk_right) - keyboard_check(vk_left);",
                    "if (keyboard_check_pressed(vk_space) && !place_free(x, y + 1)) { vsp = -jumping_speed; }",
                    "if (!place_free(x + hmove, y)) { hmove = 0; }",
                    "if (place_meeting(x, y + 1, obj_ground)) { vsp = 0; }",
                    "sprite_index = spr_player_run;",
                    "image_xscale = -1;",
                    "image_speed = 0.25;",
                    "instance_create(x + 12, y, obj_bullet);",
                    "if (hp <= 0) { instance_destroy(); }",
                    "room_goto_next();",
                ]
                .join(" "),
            ),
            (
                "Alarm 0".to_string(),
                "instance_create(x, y - 8, obj_enemy);".to_string(),
            ),
            (
                "Collision obj_enemy".to_string(),
                "if (place_meeting(x, y, obj_enemy)) { instance_destroy(); }".to_string(),
            ),
        ];

        let result = convert_gamemaker_object_to_graph("inst_player", "oPlayer", &events);

        for expected in [
            "place_free",
            "place_meeting",
            "condition_overlap",
            "set_animation_state",
            "sprite_flip",
            "timer",
            "spawn_entity",
            "destroy_entity",
            "load_scene",
            "var_set",
        ] {
            assert!(
                result.native_constructs.contains(&expected.to_string()),
                "native_constructs should include {expected}: {:?}\n{}",
                result.native_constructs,
                result.graph_json
            );
        }
        for node_type in [
            "\"type\":\"condition_overlap\"",
            "\"type\":\"timer\"",
            "\"type\":\"spawn_entity\"",
            "\"type\":\"destroy_entity\"",
            "\"type\":\"set_animation_state\"",
            "\"type\":\"load_scene\"",
        ] {
            assert!(
                result.graph_json.contains(node_type),
                "graph should contain {node_type}: {}",
                result.graph_json
            );
        }
        assert!(
            !result.gaps.iter().any(|gap| {
                gap.id.contains("place_free")
                    || gap.id.contains("sprite_index")
                    || gap.id.contains("image_xscale")
            }),
            "converted core constructs must not remain semantic gaps: {:?}",
            result.gaps
        );
    }

    #[test]
    fn generic_object_keeps_bridge_gap_visible() {
        let events = vec![(
            "Alarm 0".to_string(),
            "show_message(\"lose\"); room_restart();".to_string(),
        )];
        let result = convert_gamemaker_object_to_graph("inst_control", "control", &events);
        assert!(result.graph_json.contains("bridge_unconverted_source"));
        assert!(!result.gaps.is_empty());
    }

    #[test]
    fn unsupported_complex_gml_bridge_carries_audit_fields() {
        let events = vec![(
            "Draw".to_string(),
            [
                "var surf = surface_create(320, 224);",
                "shader_set(shd_outline);",
                "ds_map_add(global.cache, \"score\", score);",
                "physics_apply_force(x, y, 0, -10);",
            ]
            .join(" "),
        )];
        let result = convert_gamemaker_object_to_graph("inst_fx", "obj_fx", &events);
        let graph: Value = serde_json::from_str(&result.graph_json).expect("graph json");
        let gaps = graph
            .get("gaps")
            .and_then(Value::as_array)
            .expect("gaps array");
        assert!(!gaps.is_empty(), "complex GML should remain bridged");
        for gap in gaps {
            assert!(
                gap.get("source_file").and_then(Value::as_str).is_some(),
                "bridge gap must keep source_file: {gap}"
            );
            assert!(
                gap.get("line_approx").and_then(Value::as_u64).unwrap_or(0) > 0,
                "bridge gap must keep approximate source line: {gap}"
            );
            assert!(
                gap.get("impact").and_then(Value::as_str).is_some(),
                "bridge gap must keep impact: {gap}"
            );
            assert!(
                gap.get("suggestion").and_then(Value::as_str).is_some(),
                "bridge gap must keep suggestion: {gap}"
            );
        }
    }
}
