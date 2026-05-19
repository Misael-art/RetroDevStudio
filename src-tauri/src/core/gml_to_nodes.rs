//! Subset GML -> official NodeGraph conversion for GameMaker imports.
//! Unsupported semantics become structured gaps; essential gameplay gaps fail harness gates.

use serde_json::{json, Value};
use std::collections::HashSet;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct GmlSemanticGap {
    pub id: String,
    pub severity: String,
    pub source_event: String,
    pub snippet: String,
    pub reason: String,
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

#[derive(Debug, Default)]
struct ParsedGmlConstants {
    moving_speed: i32,
    climbing_speed: i32,
    gravity_force: i32,
    jumping_speed: i32,
}

pub fn convert_gamemaker_object_to_graph(
    entity_id: &str,
    object_name: &str,
    events: &[(String, String)],
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
    events: &[(String, String)],
) -> GmlConversionResult {
    let mut native = HashSet::new();
    let mut gaps = Vec::new();
    let mut create_code = String::new();
    let mut step_code = String::new();
    let mut collision_code = String::new();

    for (label, code) in events {
        let lowered = label.to_ascii_lowercase();
        if lowered.starts_with("create") {
            create_code = code.clone();
        } else if lowered.starts_with("step") {
            step_code = code.clone();
        } else if lowered.starts_with("collision") {
            collision_code = code.clone();
        } else {
            gaps.push(structured_gap(
                format!("unsupported_event_{}", sanitize_id(label)),
                "warning",
                label,
                code,
                "Evento GameMaker fora do subset nativo desta wave.",
                false,
            ));
        }
    }

    let constants = parse_create_constants(&create_code);
    collect_step_gaps(&step_code, &mut gaps);
    if !collision_code.is_empty() {
        if collision_code.contains("instance_destroy") || collision_code.contains("alarm") {
            gaps.push(structured_gap(
                "collision_destroy_alarm".to_string(),
                "warning",
                "Collision",
                &collision_code,
                "Colisao com destroy/alarm permanece como gap; nao bloqueia movimento base.",
                false,
            ));
        } else {
            gaps.push(structured_gap(
                "collision_unconverted".to_string(),
                "warning",
                "Collision",
                &collision_code,
                "Colisao GameMaker nao convertida nativamente nesta wave.",
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
    edges.push(edge("gm_e_start_init_vy", "gm_start", "exec", "gm_init_vy", "exec"));
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

    edges.push(edge("gm_e_update_right", "gm_update", "exec", "gm_right", "exec"));
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

    let graph = auto_layout_graph(json!({
        "version": 1,
        "origin": "gamemaker_gmx_native",
        "source_object": object_name,
        "source_entity": entity_id,
        "native_constructs": native.iter().cloned().collect::<Vec<_>>(),
        "gaps": gaps,
        "nodes": nodes,
        "edges": edges,
    }));

    let nodes_generated = graph["nodes"].as_array().map(|v| v.len()).unwrap_or(0);
    let blocking_gaps = gaps.iter().filter(|gap| gap.blocks_build).count();
    GmlConversionResult {
        graph_json: graph.to_string(),
        nodes_generated,
        native_constructs: native.into_iter().collect(),
        gaps,
        blocking_gaps,
    }
}

fn convert_static_prop_graph(
    entity_id: &str,
    object_name: &str,
    events: &[(String, String)],
) -> GmlConversionResult {
    let mut gaps = Vec::new();
    for (label, code) in events {
        if code.trim().is_empty() {
            continue;
        }
        gaps.push(structured_gap(
            format!("static_prop_{}", sanitize_id(label)),
            "info",
            label,
            code,
            "Objeto estatico GameMaker; logica visual permanece no asset/colisao importada.",
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
    events: &[(String, String)],
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

    for (index, (label, code)) in events.iter().enumerate() {
        if code.trim().is_empty() {
            continue;
        }
        let node_id = format!("gm_generic_bridge_{index}");
        gaps.push(structured_gap(
            format!("generic_{}_{}", sanitize_id(object_name), sanitize_id(label)),
            if code.contains("instance_destroy") || code.contains("room_restart") {
                "warning"
            } else {
                "info"
            },
            label,
            code,
            "GML generico preservado como bridge estruturada; nao conta como conversao nativa completa.",
            false,
        ));
        nodes.push(node(
            &node_id,
            "bridge_unconverted_source",
            &format!("GML Bridge: {label}"),
            "Game State",
            index as i32 + 1,
            0,
            json!({
                "source": format!("gml:{object_name}:{label}"),
                "label": compact_snippet(code, 180)
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
        native_constructs: vec!["event_start".to_string(), "bridge_unconverted_source".to_string()],
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

fn collect_step_gaps(step_code: &str, gaps: &mut Vec<GmlSemanticGap>) {
    let lowered = step_code.to_ascii_lowercase();
    for (pattern, id, reason) in [
        (
            "repeat(",
            "gml_repeat_loop",
            "Loop repeat() GameMaker nao tem no-code nativo equivalente nesta wave.",
        ),
        (
            "place_free(",
            "gml_place_free",
            "place_free() depende de colisao fina GM; MD usa collision_map + physics.",
        ),
        (
            "place_meeting(",
            "gml_place_meeting",
            "place_meeting() parcialmente coberto via collision_map; interacoes especificas permanecem gap.",
        ),
        (
            "sprite_index",
            "gml_sprite_index_swap",
            "Troca dinamica de sprite_index (ex.: climbing) permanece gap nesta wave.",
        ),
        (
            "image_xscale",
            "gml_image_xscale",
            "Flip horizontal via image_xscale nao mapeado para set_animation_state nesta wave.",
        ),
    ] {
        if lowered.contains(pattern) {
            gaps.push(structured_gap(
                id.to_string(),
                "warning",
                "Step",
                step_code,
                reason,
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

fn structured_gap(
    id: String,
    severity: &str,
    source_event: &str,
    snippet: &str,
    reason: &str,
    blocks_build: bool,
) -> GmlSemanticGap {
    GmlSemanticGap {
        id,
        severity: severity.to_string(),
        source_event: source_event.to_string(),
        snippet: compact_snippet(snippet, 220),
        reason: reason.to_string(),
        blocks_build,
    }
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
    let mut group_counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for (index, node) in nodes.iter_mut().enumerate() {
        let group = node
            .get("group")
            .and_then(Value::as_str)
            .unwrap_or("Game State")
            .to_string();
        let count = group_counts.entry(group.clone()).or_insert(0);
        node["x"] = json!(80 + (index % 5) as i32 * 220);
        node["y"] = json!(80 + group_order.iter().position(|g| g == &group).unwrap_or(6) as i32 * 140 + *count as i32 * 86);
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
        assert!(result.native_constructs.contains(&"camera_follow".to_string()));
        assert!(result.graph_json.contains("\"type\":\"event_update\""));
        assert!(result.blocking_gaps == 0);
        assert!(result.gaps.iter().any(|gap| gap.id.contains("place_free") || gap.id.contains("climbing")));
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
}
