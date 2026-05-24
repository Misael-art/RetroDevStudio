use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

use serde_json::{json, Value};

use crate::core::sgdk_corpus_inventory::{SgdkCallInventory, SgdkProjectInventory, SourceLocation};

#[derive(Debug, Clone)]
struct GraphBuildNode {
    id: String,
    node_type: String,
    label: String,
    group: String,
    params: BTreeMap<String, Value>,
}

pub fn convert_sgdk_inventory_to_node_graph(inventory: &SgdkProjectInventory) -> String {
    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    let mut seen_ids = BTreeSet::new();

    if inventory
        .code
        .functions
        .iter()
        .any(|function| function.name == "main" && function.is_definition)
    {
        push_node(
            &mut nodes,
            &mut seen_ids,
            graph_node(
                "sgdk_start",
                "event_start",
                "SGDK main",
                "Input",
                BTreeMap::new(),
            ),
        );
    }

    if !inventory.code.main_loops.is_empty() || !inventory.code.update_functions.is_empty() {
        let mut params = BTreeMap::new();
        if let Some(source) = inventory
            .code
            .main_loops
            .first()
            .map(|item| item.source.clone())
            .or_else(|| {
                inventory
                    .code
                    .update_functions
                    .first()
                    .map(|item| item.source.clone())
            })
        {
            add_source_params(&mut params, &source);
        }
        push_node(
            &mut nodes,
            &mut seen_ids,
            graph_node(
                "sgdk_update",
                "event_update",
                "SGDK update loop",
                "Input",
                params,
            ),
        );
    }

    add_call_nodes(inventory, &mut nodes, &mut edges, &mut seen_ids);
    add_fsm_nodes(inventory, &mut nodes, &mut edges, &mut seen_ids);
    add_timer_nodes(inventory, &mut nodes, &mut edges, &mut seen_ids);
    add_collision_nodes(inventory, &mut nodes, &mut seen_ids);
    add_bridge_nodes(inventory, &mut nodes, &mut seen_ids);

    let nodes = layout_nodes(nodes);
    json!({
        "version": 1,
        "origin": "sgdk_semantic_model",
        "source_root": inventory.root,
        "project_name": inventory.project_name,
        "nodes": nodes,
        "edges": edges,
    })
    .to_string()
}

fn graph_node(
    id: impl Into<String>,
    node_type: impl Into<String>,
    label: impl Into<String>,
    group: impl Into<String>,
    params: BTreeMap<String, Value>,
) -> GraphBuildNode {
    GraphBuildNode {
        id: id.into(),
        node_type: node_type.into(),
        label: label.into(),
        group: group.into(),
        params,
    }
}

fn push_node(
    nodes: &mut Vec<GraphBuildNode>,
    seen_ids: &mut BTreeSet<String>,
    mut node: GraphBuildNode,
) -> String {
    let base_id = sanitize_id(&node.id);
    let mut id = base_id.clone();
    let mut suffix = 2;
    while !seen_ids.insert(id.clone()) {
        id = format!("{base_id}_{suffix}");
        suffix += 1;
    }
    node.id = id.clone();
    nodes.push(node);
    id
}

fn add_call_nodes(
    inventory: &SgdkProjectInventory,
    nodes: &mut Vec<GraphBuildNode>,
    edges: &mut Vec<Value>,
    seen_ids: &mut BTreeSet<String>,
) {
    let mut update_tail = "sgdk_update".to_string();
    for call in &inventory.code.calls {
        let source_line = read_source_line(inventory, &call.source);
        let Some(node) = call_to_node(call, source_line.as_deref()) else {
            continue;
        };
        let id = push_node(nodes, seen_ids, node);
        if seen_ids.contains("sgdk_update") {
            edges.push(edge(
                format!("edge_{update_tail}_{id}"),
                &update_tail,
                "exec",
                &id,
                "exec",
            ));
            update_tail = id;
        }
    }
}

fn call_to_node(call: &SgdkCallInventory, source_line: Option<&str>) -> Option<GraphBuildNode> {
    let mut params = BTreeMap::new();
    add_source_params(&mut params, &call.source);
    if let Some(line) = source_line {
        params.insert("source_snippet".to_string(), json!(compact(line, 180)));
    }

    match call.family.as_str() {
        "input" => {
            params.insert("pad".to_string(), json!("JOY_1"));
            params.insert(
                "button".to_string(),
                json!(extract_button(source_line).unwrap_or_else(|| "BUTTON_RIGHT".to_string())),
            );
            let pressed = source_line
                .map(|line| {
                    let lowered = line.to_ascii_lowercase();
                    lowered.contains("pressed")
                        || lowered.contains("just")
                        || lowered.contains("edge")
                })
                .unwrap_or(false);
            Some(graph_node(
                format!("input_{}_{}", call.name, call.source.line),
                if pressed {
                    "input_pressed"
                } else {
                    "input_held"
                },
                if pressed {
                    "Input pressed"
                } else {
                    "Input held"
                },
                "Input",
                params,
            ))
        }
        "sprite" if call.name.contains("Anim") || call.name.contains("Frame") => {
            params.insert(
                "target".to_string(),
                json!(extract_sprite_target(source_line)),
            );
            params.insert("anim".to_string(), json!(extract_animation(source_line)));
            Some(graph_node(
                format!("anim_{}_{}", call.name, call.source.line),
                "sprite_anim",
                "Sprite animation",
                "Animation",
                params,
            ))
        }
        "sprite" if call.name.contains("Position") => {
            params.insert(
                "target".to_string(),
                json!(extract_sprite_target(source_line)),
            );
            params.insert("x".to_string(), json!(0));
            params.insert("y".to_string(), json!(0));
            Some(graph_node(
                format!("position_{}_{}", call.name, call.source.line),
                "set_position",
                "Set sprite position",
                "Player FSM",
                params,
            ))
        }
        "sprite" if call.name.contains("add") || call.name.contains("Add") => {
            params.insert(
                "prefab".to_string(),
                json!(extract_sprite_target(source_line)),
            );
            params.insert("x".to_string(), json!(0));
            params.insert("y".to_string(), json!(0));
            Some(graph_node(
                format!("spawn_{}_{}", call.name, call.source.line),
                "spawn_entity",
                "Spawn entity",
                "Player FSM",
                params,
            ))
        }
        "sprite" if call.name.contains("release") || call.name.contains("Release") => {
            params.insert(
                "target".to_string(),
                json!(extract_sprite_target(source_line)),
            );
            Some(graph_node(
                format!("destroy_{}_{}", call.name, call.source.line),
                "destroy_entity",
                "Destroy entity",
                "Player FSM",
                params,
            ))
        }
        "sprite" => {
            params.insert(
                "target".to_string(),
                json!(extract_sprite_target(source_line)),
            );
            params.insert("dx".to_string(), json!(0));
            params.insert("dy".to_string(), json!(0));
            Some(graph_node(
                format!("move_{}_{}", call.name, call.source.line),
                "sprite_move",
                "Sprite movement",
                "Player FSM",
                params,
            ))
        }
        "tilemap" => Some(scroll_node(call, params)),
        "vdp" | "dma" if call.name.contains("Scroll") => Some(scroll_node(call, params)),
        "vdp" | "dma" => {
            params.insert("vram_kb".to_string(), json!(64));
            params.insert("sprites".to_string(), json!(80));
            params.insert("scanline_sprites".to_string(), json!(20));
            Some(graph_node(
                format!("hardware_{}_{}", call.name, call.source.line),
                "hardware_budget_check",
                "Hardware budget",
                "Camera",
                params,
            ))
        }
        "audio" => {
            params.insert("sfx".to_string(), json!(extract_sfx(source_line)));
            Some(graph_node(
                format!("audio_{}_{}", call.name, call.source.line),
                "action_sound",
                "Play sound",
                "Audio",
                params,
            ))
        }
        _ => None,
    }
}

fn scroll_node(call: &SgdkCallInventory, mut params: BTreeMap<String, Value>) -> GraphBuildNode {
    params.insert("layer".to_string(), json!("BG_A"));
    params.insert("dx".to_string(), json!(1));
    params.insert("dy".to_string(), json!(0));
    graph_node(
        format!("scroll_{}_{}", call.name, call.source.line),
        "scroll_tilemap",
        "Scroll tilemap",
        "Camera",
        params,
    )
}

fn add_fsm_nodes(
    inventory: &SgdkProjectInventory,
    nodes: &mut Vec<GraphBuildNode>,
    edges: &mut Vec<Value>,
    seen_ids: &mut BTreeSet<String>,
) {
    let mut states = inventory.code.game_states.clone();
    states.sort_by(|left, right| left.name.cmp(&right.name));
    states.dedup_by(|left, right| left.name == right.name);
    if states.is_empty() {
        return;
    }

    let mut state_ids = Vec::new();
    for (index, state) in states.iter().enumerate() {
        let mut params = BTreeMap::new();
        params.insert("state_name".to_string(), json!(sanitize_id(&state.name)));
        params.insert("initial".to_string(), json!(if index == 0 { 1 } else { 0 }));
        add_source_params(&mut params, &state.source);
        let id = push_node(
            nodes,
            seen_ids,
            graph_node(
                format!("fsm_state_{}", state.name),
                "fsm_state",
                format!("State {}", state.name),
                "Player FSM",
                params,
            ),
        );
        state_ids.push((state.name.clone(), id));
    }

    for pair in state_ids.windows(2) {
        let (from_name, from_id) = &pair[0];
        let (to_name, _) = &pair[1];
        let mut params = BTreeMap::new();
        params.insert("target_state".to_string(), json!(sanitize_id(to_name)));
        let transition_id = push_node(
            nodes,
            seen_ids,
            graph_node(
                format!("fsm_transition_{}_to_{}", from_name, to_name),
                "fsm_transition",
                format!("{from_name} -> {to_name}"),
                "Player FSM",
                params,
            ),
        );
        edges.push(edge(
            format!("edge_{from_id}_{transition_id}"),
            from_id,
            "transitions",
            &transition_id,
            "exec",
        ));
        if let Some(input_id) =
            first_node_id(nodes, "input_held").or_else(|| first_node_id(nodes, "input_pressed"))
        {
            edges.push(edge(
                format!("edge_{input_id}_{transition_id}_condition"),
                &input_id,
                "exec",
                &transition_id,
                "condition",
            ));
        }
    }
}

fn add_timer_nodes(
    inventory: &SgdkProjectInventory,
    nodes: &mut Vec<GraphBuildNode>,
    edges: &mut Vec<Value>,
    seen_ids: &mut BTreeSet<String>,
) {
    for item in &inventory.code.globals {
        let lowered = item.name.to_ascii_lowercase();
        if !(lowered.contains("timer") || lowered.contains("counter") || lowered.contains("frame"))
        {
            continue;
        }
        let mut params = BTreeMap::new();
        params.insert("frames".to_string(), json!(60));
        params.insert("repeat".to_string(), json!(1));
        params.insert("var_name".to_string(), json!(sanitize_id(&item.name)));
        add_source_params(&mut params, &item.source);
        let id = push_node(
            nodes,
            seen_ids,
            graph_node(
                format!("timer_{}", item.name),
                "timer",
                format!("Timer {}", item.name),
                "Player FSM",
                params,
            ),
        );
        if seen_ids.contains("sgdk_update") {
            edges.push(edge(
                format!("edge_sgdk_update_{id}"),
                "sgdk_update",
                "exec",
                &id,
                "exec",
            ));
        }
    }
}

fn add_collision_nodes(
    inventory: &SgdkProjectInventory,
    nodes: &mut Vec<GraphBuildNode>,
    seen_ids: &mut BTreeSet<String>,
) {
    for array in &inventory.code.arrays {
        if !array.name.to_ascii_lowercase().contains("collision") {
            continue;
        }
        let mut params = BTreeMap::new();
        params.insert("a".to_string(), json!("player"));
        params.insert("b".to_string(), json!(sanitize_id(&array.name)));
        add_source_params(&mut params, &array.source);
        push_node(
            nodes,
            seen_ids,
            graph_node(
                format!("collision_{}", array.name),
                "condition_overlap",
                format!("Collision {}", array.name),
                "Collision",
                params,
            ),
        );
    }
}

fn add_bridge_nodes(
    inventory: &SgdkProjectInventory,
    nodes: &mut Vec<GraphBuildNode>,
    seen_ids: &mut BTreeSet<String>,
) {
    for gap in inventory
        .semantic_gaps
        .iter()
        .filter(|gap| gap.blocks_nocode || gap.blocks_round_trip || gap.blocks_build)
    {
        let mut params = BTreeMap::new();
        params.insert("gap".to_string(), json!(&gap.kind));
        params.insert("source".to_string(), json!(&gap.subject));
        params.insert("detail".to_string(), json!(compact(&gap.detail, 220)));
        params.insert(
            "blocking".to_string(),
            json!(if gap.blocks_build || gap.blocks_nocode {
                1
            } else {
                0
            }),
        );
        params.insert("allow_bridge_mode".to_string(), json!(0));
        if let Some(source) = &gap.source {
            add_source_params(&mut params, source);
        }
        push_node(
            nodes,
            seen_ids,
            graph_node(
                format!("bridge_{}_{}", gap.kind, gap.subject),
                "bridge_unconverted_source",
                format!("Source Bridge: {}", gap.kind),
                "Bridges",
                params,
            ),
        );
    }
}

fn layout_nodes(nodes: Vec<GraphBuildNode>) -> Vec<Value> {
    let group_order = [
        "Input",
        "Player FSM",
        "Enemy FSM",
        "Camera",
        "Animation",
        "Collision",
        "Audio",
        "Bridges",
    ];
    let type_order = [
        "event_start",
        "event_update",
        "input_pressed",
        "input_held",
        "input_command",
        "fsm_state",
        "fsm_transition",
        "condition_compare",
        "flow_if",
        "set_velocity",
        "set_position",
        "sprite_move",
        "timer",
        "var_get",
        "var_set",
        "scroll_tilemap",
        "move_camera",
        "camera_follow",
        "camera_bounds",
        "sprite_anim",
        "set_animation_state",
        "condition_overlap",
        "action_sound",
        "spawn_entity",
        "destroy_entity",
        "bridge_unconverted_source",
    ];
    let mut ordered = nodes;
    ordered.sort_by(|left, right| {
        group_index(&group_order, &left.group)
            .cmp(&group_index(&group_order, &right.group))
            .then_with(|| {
                type_index(&type_order, &left.node_type)
                    .cmp(&type_index(&type_order, &right.node_type))
            })
            .then_with(|| left.label.cmp(&right.label))
            .then_with(|| left.id.cmp(&right.id))
    });
    let mut group_counts: BTreeMap<String, i32> = BTreeMap::new();
    ordered
        .into_iter()
        .enumerate()
        .map(|(index, node)| {
            let group_y = group_index(&group_order, &node.group) as i32;
            let count = *group_counts.get(&node.group).unwrap_or(&0);
            group_counts.insert(node.group.clone(), count + 1);
            json!({
                "id": node.id,
                "type": node.node_type,
                "label": node.label,
                "group": node.group,
                "origin": "sgdk_semantic_model",
                "x": 80 + (index.min(4) as i32 * 220),
                "y": 80 + group_y * 180 + count * 92,
                "params": node.params,
            })
        })
        .collect()
}

fn group_index(group_order: &[&str], group: &str) -> usize {
    group_order
        .iter()
        .position(|candidate| *candidate == group)
        .unwrap_or(group_order.len())
}

fn type_index(type_order: &[&str], node_type: &str) -> usize {
    type_order
        .iter()
        .position(|candidate| *candidate == node_type)
        .unwrap_or(type_order.len())
}

fn edge(
    id: impl Into<String>,
    from_node: &str,
    from_port: &str,
    to_node: &str,
    to_port: &str,
) -> Value {
    json!({
        "id": sanitize_id(&id.into()),
        "fromNode": from_node,
        "fromPort": from_port,
        "toNode": to_node,
        "toPort": to_port,
    })
}

fn add_source_params(params: &mut BTreeMap<String, Value>, source: &SourceLocation) {
    params.insert("source_file".to_string(), json!(&source.file));
    params.insert("source_line".to_string(), json!(source.line as i64));
    params.insert(
        "source_mapping".to_string(),
        json!(format!("{}:{}", source.file, source.line)),
    );
}

fn first_node_id(nodes: &[GraphBuildNode], node_type: &str) -> Option<String> {
    nodes
        .iter()
        .find(|node| node.node_type == node_type)
        .map(|node| node.id.clone())
}

fn read_source_line(inventory: &SgdkProjectInventory, source: &SourceLocation) -> Option<String> {
    if source.file.is_empty() || source.line == 0 {
        return None;
    }
    let path = Path::new(&inventory.root).join(&source.file);
    let content = fs::read_to_string(path).ok()?;
    content
        .lines()
        .nth(source.line.saturating_sub(1))
        .map(str::to_string)
}

fn extract_button(source_line: Option<&str>) -> Option<String> {
    let line = source_line?;
    let start = line.find("BUTTON_")?;
    let suffix = line[start..]
        .chars()
        .take_while(|ch| ch.is_ascii_alphanumeric() || *ch == '_')
        .collect::<String>();
    (!suffix.is_empty()).then_some(suffix)
}

fn extract_sprite_target(source_line: Option<&str>) -> String {
    let Some(line) = source_line else {
        return "player".to_string();
    };
    if let Some(start) = line.find("spr_") {
        let target = line[start + 4..]
            .chars()
            .take_while(|ch| ch.is_ascii_alphanumeric() || *ch == '_')
            .collect::<String>()
            .trim_matches('_')
            .to_string();
        if !target.is_empty() {
            return sanitize_id(&target);
        }
    }
    "player".to_string()
}

fn extract_animation(source_line: Option<&str>) -> String {
    let Some(line) = source_line else {
        return "idle".to_string();
    };
    if let Some(start) = line.find("ANIM_") {
        return sanitize_id(
            &line[start + 5..]
                .chars()
                .take_while(|ch| ch.is_ascii_alphanumeric() || *ch == '_')
                .collect::<String>(),
        );
    }
    "idle".to_string()
}

fn extract_sfx(source_line: Option<&str>) -> String {
    let Some(line) = source_line else {
        return "effect".to_string();
    };
    if let Some(start) = line.find("SFX_") {
        return sanitize_id(
            &line[start + 4..]
                .chars()
                .take_while(|ch| ch.is_ascii_alphanumeric() || *ch == '_')
                .collect::<String>(),
        );
    }
    "effect".to_string()
}

fn sanitize_id(value: &str) -> String {
    let mut out = String::new();
    let mut previous_separator = false;
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            previous_separator = false;
        } else if !previous_separator {
            out.push('_');
            previous_separator = true;
        }
    }
    let sanitized = out.trim_matches('_').to_string();
    if sanitized.is_empty() {
        "node".to_string()
    } else {
        sanitized
    }
}

fn compact(value: &str, max_len: usize) -> String {
    let compact = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.len() > max_len {
        format!("{}...", &compact[..max_len])
    } else {
        compact
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::sgdk_corpus_inventory::{
        SgdkCallInventory, SgdkCanonicalProjectModel, SgdkCodeInventory, SgdkFunctionInventory,
        SgdkNamedSourceItem, SgdkProjectInventory, SgdkSemanticGap,
    };

    fn source(file: &str, line: usize) -> SourceLocation {
        SourceLocation {
            file: file.to_string(),
            line,
        }
    }

    fn fixture_inventory() -> SgdkProjectInventory {
        SgdkProjectInventory {
            project_name: "fsm_fixture".to_string(),
            root: ".".to_string(),
            source_files: vec!["src/main.c".to_string()],
            header_files: Vec::new(),
            resource_manifests: Vec::new(),
            assets: Vec::new(),
            resources: Vec::new(),
            code: SgdkCodeInventory {
                functions: vec![SgdkFunctionInventory {
                    name: "main".to_string(),
                    source: source("src/main.c", 1),
                    end_line: 20,
                    is_definition: true,
                    is_prototype: false,
                }],
                main_loops: vec![SgdkNamedSourceItem {
                    name: "while_true".to_string(),
                    source: source("src/main.c", 8),
                }],
                game_states: vec![
                    SgdkNamedSourceItem {
                        name: "IDLE".to_string(),
                        source: source("src/player.c", 4),
                    },
                    SgdkNamedSourceItem {
                        name: "RUN".to_string(),
                        source: source("src/player.c", 5),
                    },
                    SgdkNamedSourceItem {
                        name: "JUMP".to_string(),
                        source: source("src/player.c", 6),
                    },
                ],
                calls: vec![
                    SgdkCallInventory {
                        name: "JOY_readJoypad".to_string(),
                        family: "input".to_string(),
                        caller: Some("player_tick".to_string()),
                        source: source("src/player.c", 10),
                    },
                    SgdkCallInventory {
                        name: "SPR_setAnim".to_string(),
                        family: "sprite".to_string(),
                        caller: Some("player_tick".to_string()),
                        source: source("src/player.c", 14),
                    },
                    SgdkCallInventory {
                        name: "VDP_setHorizontalScroll".to_string(),
                        family: "vdp".to_string(),
                        caller: Some("camera_tick".to_string()),
                        source: source("src/camera.c", 3),
                    },
                    SgdkCallInventory {
                        name: "XGM_startPlayPCM".to_string(),
                        family: "audio".to_string(),
                        caller: Some("sound_tick".to_string()),
                        source: source("src/audio.c", 7),
                    },
                ],
                ..SgdkCodeInventory::default()
            },
            semantic_gaps: vec![SgdkSemanticGap {
                kind: "inline_assembly".to_string(),
                subject: "fast_dma".to_string(),
                detail: "asm block".to_string(),
                source: Some(source("src/dma.c", 42)),
                severity: "error".to_string(),
                blocks_build: true,
                blocks_nocode: true,
                blocks_round_trip: true,
                ..SgdkSemanticGap::default()
            }],
            node_candidates: Vec::new(),
            canonical_model: SgdkCanonicalProjectModel::default(),
            semantic_node_graph_json: String::new(),
        }
    }

    fn graph_nodes(graph_json: &str) -> Vec<Value> {
        serde_json::from_str::<Value>(graph_json)
            .expect("valid graph")
            .get("nodes")
            .and_then(Value::as_array)
            .cloned()
            .expect("nodes array")
    }

    #[test]
    fn converts_sgdk_semantic_model_to_real_fsm_nodegraph_with_source_mapping() {
        let graph_json = convert_sgdk_inventory_to_node_graph(&fixture_inventory());
        let nodes = graph_nodes(&graph_json);

        let node_types = nodes
            .iter()
            .filter_map(|node| node.get("type").and_then(Value::as_str))
            .collect::<Vec<_>>();

        assert!(node_types.contains(&"event_update"));
        assert_eq!(
            node_types
                .iter()
                .filter(|node_type| **node_type == "fsm_state")
                .count(),
            3
        );
        assert!(node_types.contains(&"fsm_transition"));
        assert!(node_types.contains(&"input_held"));
        assert!(node_types.contains(&"sprite_anim"));
        assert!(nodes.iter().any(|node| {
            node.get("params")
                .and_then(|params| params.get("source_file"))
                .and_then(Value::as_str)
                == Some("src/player.c")
        }));
    }

    #[test]
    fn auto_layout_keeps_required_system_groups_apart_and_bridges_last() {
        let graph_json = convert_sgdk_inventory_to_node_graph(&fixture_inventory());
        let nodes = graph_nodes(&graph_json);
        let input_y = node_y(&nodes, "input_held");
        let fsm_y = node_y(&nodes, "fsm_state");
        let bridge_y = node_y(&nodes, "bridge_unconverted_source");

        assert_ne!(input_y, fsm_y);
        assert!(bridge_y > fsm_y);
    }

    #[test]
    fn round_trip_json_preserves_bridge_source_mapping_fields() {
        let graph_json = convert_sgdk_inventory_to_node_graph(&fixture_inventory());
        let reparsed =
            serde_json::to_string(&serde_json::from_str::<Value>(&graph_json).expect("json graph"))
                .expect("serialize graph");

        assert!(reparsed.contains("\"type\":\"bridge_unconverted_source\""));
        assert!(reparsed.contains("\"source_file\":\"src/dma.c\""));
        assert!(reparsed.contains("\"source_line\":42"));
        assert!(reparsed.contains("\"blocking\":1"));
    }

    fn node_y(nodes: &[Value], node_type: &str) -> i64 {
        nodes
            .iter()
            .find(|node| node.get("type").and_then(Value::as_str) == Some(node_type))
            .and_then(|node| node.get("y"))
            .and_then(Value::as_i64)
            .expect("node y")
    }
}
