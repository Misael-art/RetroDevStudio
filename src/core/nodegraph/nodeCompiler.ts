/**
 * nodeCompiler.ts — Utilitario legado/experimental NodeGraph ↔ C.
 *
 * Nao faz parte do pipeline canonico do app. O fluxo oficial Build -> ROM usa o
 * backend Rust (AST generator + emitters SGDK/PVSnesLib), nao este arquivo.
 *
 * Mantido apenas para experimentacao local, testes de compatibilidade e estudos
 * de serializacao do NodeGraph no frontend.
 */

import type { NodeGraph, GraphNode, NodeEdge } from "../../components/nodegraph/NodeGraphEditor";

// ── Node → C ─────────────────────────────────────────────────────────────────

function findIncomingEdge(
  graph: NodeGraph,
  toNodeId: string,
  toPort: string
): NodeEdge | undefined {
  return graph.edges.find((edge) => edge.toNode === toNodeId && edge.toPort === toPort);
}

function findNode(graph: NodeGraph, nodeId: string): GraphNode | undefined {
  return graph.nodes.find((node) => node.id === nodeId);
}

function findOutgoingExecEdge(
  graph: NodeGraph,
  fromNodeId: string,
  fromPort: string
): NodeEdge | undefined {
  return graph.edges.find((edge) => edge.fromNode === fromNodeId && edge.fromPort === fromPort);
}

function sanitizeIdentifier(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase() || "state";
}

function isTruthyParam(value: string | number | undefined): boolean {
  if (typeof value === "number") {
    return value !== 0;
  }
  return value === "1" || value === "true";
}

function buildMathExpression(
  graph: NodeGraph,
  node: GraphNode,
  visited = new Set<string>()
): string {
  if (visited.has(node.id)) {
    return "0";
  }
  visited.add(node.id);

  switch (node.type) {
    case "var_get":
      return `logic_var_${String(node.params.var_name ?? "temp_var")}`;

    case "logic_math": {
      const left = resolveMathInput(graph, node.id, "a", visited);
      const right = resolveMathInput(graph, node.id, "b", visited);
      const operator = String(node.params.operator ?? "+");
      return `(${left} ${operator} ${right})`;
    }

    case "var_set":
      return resolveMathInput(graph, node.id, "value", visited);

    default:
      return String(node.params.value ?? 0);
  }
}

function resolveMathInput(
  graph: NodeGraph,
  toNodeId: string,
  toPort: string,
  visited = new Set<string>()
): string {
  const incoming = findIncomingEdge(graph, toNodeId, toPort);
  if (incoming) {
    const sourceNode = findNode(graph, incoming.fromNode);
    if (sourceNode) {
      return buildMathExpression(graph, sourceNode, visited);
    }
  }

  const targetNode = findNode(graph, toNodeId);
  return String(targetNode?.params[toPort] ?? targetNode?.params.value ?? 0);
}

function buildBooleanExpression(
  graph: NodeGraph,
  node: GraphNode,
  target: "megadrive" | "snes",
  visited = new Set<string>()
): string {
  if (visited.has(node.id)) {
    return "0";
  }
  visited.add(node.id);

  switch (node.type) {
    case "input_pressed":
    case "input_held":
      return buildInputExpression(node, target);
    case "input_command":
      return buildInputCommandExpression(node);

    case "logic_and": {
      const left = resolveBooleanInput(graph, node.id, "a", target, visited);
      const right = resolveBooleanInput(graph, node.id, "b", target, visited);
      return `(${left} && ${right})`;
    }

    case "condition_compare": {
      const left = resolveMathInput(graph, node.id, "a");
      const right = resolveMathInput(graph, node.id, "b");
      const operator = String(node.params.operator ?? "==");
      return `(${left} ${operator} ${right})`;
    }

    case "var_get":
    case "logic_math":
    case "var_set":
      return `(${buildMathExpression(graph, node)} != 0)`;

    case "fsm_transition":
      return resolveBooleanInput(graph, node.id, "condition", target, visited) || "0";

    case "condition_overlap":
      if (target === "snes") {
        return `retro_aabb_intersects(${String(node.params.a)}_x, ${String(node.params.a)}_y, 16, 16, ${String(node.params.b)}_x, ${String(node.params.b)}_y, 16, 16)`;
      }
      return `SPR_overlaps(spr_${node.params.a}, spr_${node.params.b})`;

    default:
      return "0";
  }
}

function buildInputExpression(node: GraphNode, target: "megadrive" | "snes"): string {
  const pad = String(node.params.pad ?? "JOY_1");
  const button = String(node.params.button ?? "BUTTON_A");
  if (target === "snes") {
    return `(padsCurrent(0) & ${snesButtonMask(button)})`;
  }
  return `(JOY_readJoypad(${pad}) & ${button})`;
}

function snesButtonMask(button: string): string {
  const normalized = button.trim().toUpperCase().replace(/^BUTTON_/, "");
  const aliases: Record<string, string> = {
    A: "KEY_A",
    B: "KEY_B",
    X: "KEY_X",
    Y: "KEY_Y",
    L: "KEY_L",
    R: "KEY_R",
    LEFT: "KEY_LEFT",
    RIGHT: "KEY_RIGHT",
    UP: "KEY_UP",
    DOWN: "KEY_DOWN",
    DPAD_LEFT: "KEY_LEFT",
    DPAD_RIGHT: "KEY_RIGHT",
    DPAD_UP: "KEY_UP",
    DPAD_DOWN: "KEY_DOWN",
    START: "KEY_START",
    SELECT: "KEY_SELECT",
  };
  return aliases[normalized] ?? button;
}

type CompiledInputCommandStep = {
  direction: number;
  buttonMask: string;
};

function normalizeCommandToken(token: string): string {
  return token.trim();
}

function inputCommandTokenKey(token: string): string {
  return token.trim().replace(/^_/, "").toUpperCase();
}

function inputCommandButtonMask(token: string, target: "megadrive" | "snes"): string | null {
  const raw = token.trim();
  const key = inputCommandTokenKey(raw);
  const isLowercaseMugenButton = /^[abcxyz]$/.test(raw);
  if (target === "snes") {
    if (key === "P") return "KEY_Y";
    if (key === "K") return "KEY_B";
    if (isLowercaseMugenButton || /^[ABCXYZ]$/.test(key)) {
      return {
        A: "KEY_B",
        B: "KEY_Y",
        C: "KEY_X",
        X: "KEY_A",
        Y: "KEY_L",
        Z: "KEY_R",
      }[key] ?? null;
    }
    return null;
  }
  if (key === "P") return "BUTTON_A";
  if (key === "K") return "BUTTON_B";
  if (isLowercaseMugenButton || /^[ABCXYZ]$/.test(key)) {
    return `BUTTON_${key}`;
  }
  return null;
}

function inputCommandDirection(token: string): number | null {
  const raw = token.trim();
  const key = inputCommandTokenKey(raw);
  if (/^[1-9]$/.test(key)) {
    return Number(key);
  }
  if (/^[abcxyz]$/.test(raw)) {
    return null;
  }
  const aliases: Record<string, number> = { D: 2, F: 6, B: 4, U: 8, DF: 3, DB: 1, UF: 9, UB: 7 };
  return aliases[key] ?? null;
}

function compileInputCommandSteps(
  node: GraphNode,
  target: "megadrive" | "snes"
): { steps: CompiledInputCommandStep[]; unsupported: string[] } {
  const unsupported = new Set<string>();
  const steps = String(node.params.notation ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      let direction = 0;
      const masks: string[] = [];
      for (const token of part.split("+").map(normalizeCommandToken).filter(Boolean)) {
        const dir = inputCommandDirection(token);
        const mask = inputCommandButtonMask(token, target);
        if (dir !== null) {
          direction = dir;
        } else if (mask) {
          masks.push(mask);
        } else {
          unsupported.add(token);
        }
      }
      return {
        direction,
        buttonMask: masks.length > 0 ? masks.join(" | ") : "0",
      };
    });

  return { steps, unsupported: [...unsupported] };
}

function inputCommandFunctionName(node: GraphNode): string {
  return `rds_cmd_${sanitizeIdentifier(String(node.params.command_id ?? node.id))}`;
}

function buildInputCommandExpression(node: GraphNode): string {
  const stepCount = String(node.params.notation ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean).length;
  return `rds_input_match_command(${inputCommandFunctionName(node)}_steps, ${stepCount}, ${Number(node.params.max_frames ?? 20)})`;
}

function collectInputCommandNodes(graph: NodeGraph): GraphNode[] {
  return graph.nodes.filter((node) => node.type === "input_command");
}

function emitInputCommandRuntime(graph: NodeGraph, target: "megadrive" | "snes"): string {
  const commandNodes = collectInputCommandNodes(graph);
  if (commandNodes.length === 0) {
    return "";
  }

  let out = `
typedef struct {
    u8 direction;
    u16 buttons;
} RdsInputCommandStep;

#define RDS_INPUT_HISTORY 32
static u8 rds_input_directions[RDS_INPUT_HISTORY];
static u16 rds_input_buttons[RDS_INPUT_HISTORY];
static u8 rds_input_cursor;

static u8 rds_input_direction_from_buttons(u16 buttons) {
    const bool left = (buttons & ${target === "snes" ? "KEY_LEFT" : "BUTTON_LEFT"}) != 0;
    const bool right = (buttons & ${target === "snes" ? "KEY_RIGHT" : "BUTTON_RIGHT"}) != 0;
    const bool up = (buttons & ${target === "snes" ? "KEY_UP" : "BUTTON_UP"}) != 0;
    const bool down = (buttons & ${target === "snes" ? "KEY_DOWN" : "BUTTON_DOWN"}) != 0;
    if (down && left) return 1;
    if (down && right) return 3;
    if (up && left) return 7;
    if (up && right) return 9;
    if (down) return 2;
    if (left) return 4;
    if (right) return 6;
    if (up) return 8;
    return 5;
}

static void rds_input_push_frame(u16 buttons) {
    rds_input_directions[rds_input_cursor] = rds_input_direction_from_buttons(buttons);
    rds_input_buttons[rds_input_cursor] = buttons;
    rds_input_cursor = (rds_input_cursor + 1) % RDS_INPUT_HISTORY;
}

static bool rds_input_step_matches(const RdsInputCommandStep* step, u8 index) {
    const u8 direction = rds_input_directions[index];
    const u16 buttons = rds_input_buttons[index];
    const bool direction_ok = step->direction == 0 || step->direction == direction;
    const bool buttons_ok = step->buttons == 0 || ((buttons & step->buttons) == step->buttons);
    return direction_ok && buttons_ok;
}

static bool rds_input_match_command(const RdsInputCommandStep* steps, u8 step_count, u8 max_frames) {
    if (step_count == 0) return FALSE;
    u8 matched = step_count;
    u8 scanned = 0;
    u8 cursor = rds_input_cursor;
    while (scanned < max_frames && scanned < RDS_INPUT_HISTORY && matched > 0) {
        cursor = (cursor + RDS_INPUT_HISTORY - 1) % RDS_INPUT_HISTORY;
        if (rds_input_step_matches(&steps[matched - 1], cursor)) {
            matched--;
        }
        scanned++;
    }
    return matched == 0;
}
`;

  for (const node of commandNodes) {
    const { steps, unsupported } = compileInputCommandSteps(node, target);
    const fn = inputCommandFunctionName(node);
    if (unsupported.length > 0) {
      out += `#error "Unsupported input_command tokens for ${String(node.params.command_id ?? node.id)}: ${unsupported.join(", ")}"\n`;
      continue;
    }
    out += `static const RdsInputCommandStep ${fn}_steps[] = {\n`;
    for (const step of steps) {
      out += `    { ${step.direction}, ${step.buttonMask} },\n`;
    }
    out += `};\n`;
    out += `static const u8 ${fn}_count = ${steps.length};\n`;
  }

  return out;
}

function emitInputCommandFrameCapture(target: "megadrive" | "snes"): string {
  return target === "snes"
    ? "        rds_input_push_frame(padsCurrent(0));\n"
    : "        rds_input_push_frame(JOY_readJoypad(JOY_1));\n";
}

function resolveBooleanInput(
  graph: NodeGraph,
  toNodeId: string,
  toPort: string,
  target: "megadrive" | "snes",
  visited = new Set<string>()
): string {
  const incoming = findIncomingEdge(graph, toNodeId, toPort);
  if (!incoming) {
    return "0";
  }

  const sourceNode = findNode(graph, incoming.fromNode);
  if (!sourceNode) {
    return "0";
  }

  let expression = buildBooleanExpression(graph, sourceNode, target, visited);
  if (incoming.fromPort === "false") {
    expression = `!(${expression})`;
  }
  return expression;
}

function collectLogicVariables(graph: NodeGraph): string[] {
  const vars = new Set<string>();

  for (const node of graph.nodes) {
    if (node.type === "var_set" || node.type === "var_get") {
      const name = String(node.params.var_name ?? "").trim();
      if (name) {
        vars.add(name);
      }
    }
    if (node.type === "fsm_state") {
      vars.add("fsm_state");
    }
    if (node.type === "timeline_sequence") {
      const timelineName = sanitizeIdentifier(String(node.params.timeline_name ?? node.id));
      vars.add(`timeline_${timelineName}`);
    }
    if (node.type === "timer") {
      vars.add(`timer_${sanitizeIdentifier(node.id)}`);
    }
    if (node.type === "set_velocity") {
      const target = sanitizeIdentifier(String(node.params.target ?? "entity"));
      vars.add(`${target}_vx`);
      vars.add(`${target}_vy`);
    }
  }

  return [...vars];
}

function emitLinearNodeC(node: GraphNode, graph: NodeGraph, target: "megadrive" | "snes"): string {
  const p = node.params;

  switch (node.type) {
    case "event_start":
      return "    // [On Start]\n";

    case "event_update":
      return "    // [On Update]\n";

    case "sprite_move":
      if (target === "snes") {
        return `    // Move ${p.target}: oamSet with dx=${p.dx}, dy=${p.dy} (update OAM manually)\n`;
      }
      return `    SPR_setPosition(spr_${p.target}, SPR_getX(spr_${p.target}) + ${p.dx}, SPR_getY(spr_${p.target}) + ${p.dy});\n`;

    case "set_velocity": {
      const targetName = sanitizeIdentifier(String(p.target ?? "entity"));
      return `    logic_var_${targetName}_vx = ${resolveMathInput(graph, node.id, "vx")};\n    logic_var_${targetName}_vy = ${resolveMathInput(graph, node.id, "vy")};\n`;
    }

    case "set_position":
      if (target === "snes") {
        return `    // Set position for ${p.target}: oamSet(${p.x}, ${p.y}) in the sprite upload pass\n`;
      }
      return `    SPR_setPosition(spr_${p.target}, ${resolveMathInput(graph, node.id, "x")}, ${resolveMathInput(graph, node.id, "y")});\n`;

    case "spawn_entity":
      if (target === "snes") {
        return `    // Spawn ${p.prefab} at (${p.x}, ${p.y}) in OAM staging\n`;
      }
      return `    spr_${p.prefab} = SPR_addSprite(&${p.prefab}, ${p.x}, ${p.y}, TILE_ATTR(PAL0, FALSE, FALSE, FALSE));\n`;

    case "destroy_entity":
      if (target === "snes") {
        return `    // Destroy ${p.target}: clear OAM slot\n`;
      }
      return `    SPR_releaseSprite(spr_${p.target});\n`;

    case "sprite_anim":
      if (target === "snes") {
        return `    // Set anim '${p.anim}' on ${p.target} (update tile index manually)\n`;
      }
      return `    SPR_setAnim(spr_${p.target}, ANIM_${String(p.anim).toUpperCase()});\n`;

    case "set_animation_state":
      if (target === "snes") {
        return `    // Set animation state '${p.state}' on ${p.target}\n`;
      }
      return `    SPR_setAnim(spr_${p.target}, ANIM_${String(p.state).toUpperCase()});\n`;

    case "condition_overlap":
      return `    if (SPR_overlaps(spr_${p.a}, spr_${p.b})) {\n        // [overlap branch]\n    }\n`;

    case "effect_parallax":
      if (target === "snes") {
        // PVSnesLib: bgSetScroll(u8 bgIndex, u16 x, u16 y)
        return `    bg_scroll_${p.layer} += ${p.speed_x}; bgSetScroll(${p.layer}, bg_scroll_${p.layer}, 0);\n`;
      }
      return `    VDP_setHorizontalScroll(BG_${p.layer}, bg_scroll_${p.layer} += ${p.speed_x});\n`;

    case "effect_raster": {
      const scanline = Number(p.scanline);
      const offset   = Number(p.offset_x);
      if (target === "snes") {
        // PVSnesLib: bgSetScroll com verificação de scanline via irq/hdma (simplificado)
        return `    if (snes_vblank_count == ${scanline}) { bgSetScroll(0, ${offset}, 0); }\n`;
      }
      return `    VDP_setHorizontalScrollLine(BG_A, ${scanline}, ${offset});\n`;
    }

    case "logic_and":
      return `    // [AND gate — combine boolean conditions]\n`;

    case "action_sound":
      if (target === "snes") {
        return `    SPC_playSFX(SFX_${String(p.sfx).toUpperCase()});\n`;
      }
      return `    SND_startPlayPCM(SFX_${String(p.sfx).toUpperCase()}, 1, SOUND_PCM_CH_AUTO);\n`;

    case "scroll_tilemap":
      if (target === "snes") {
        // PVSnesLib: bgSetScroll(u8 bgIndex, u16 x, u16 y) — acumula scroll em variável global
        return `    tm_scroll_x_${p.layer} += ${p.dx}; tm_scroll_y_${p.layer} += ${p.dy}; bgSetScroll(${p.layer}, tm_scroll_x_${p.layer}, tm_scroll_y_${p.layer});\n`;
      }
      // SGDK: VDP_setHorizontalScroll / VDP_setVerticalScroll — layer como enum BG_A/BG_B
      return `    tm_scroll_x_${p.layer} += ${p.dx}; VDP_setHorizontalScroll(${p.layer}, tm_scroll_x_${p.layer});\n    tm_scroll_y_${p.layer} += ${p.dy}; VDP_setVerticalScroll(${p.layer}, tm_scroll_y_${p.layer});\n`;

    case "set_tile":
      if (target === "snes") {
        return `    // Set tile ${p.tile} at ${p.x},${p.y} on BG ${p.layer}\n`;
      }
      return `    VDP_setTileMapXY(${p.layer}, TILE_ATTR_FULL(PAL0, FALSE, FALSE, FALSE, ${p.tile}), ${resolveMathInput(graph, node.id, "x")}, ${resolveMathInput(graph, node.id, "y")});\n`;

    case "load_scene":
      return `    // Load scene: ${p.scene}\n`;

    case "move_camera":
      if (target === "snes") {
        // PVSnesLib: sem API de câmera nativa — ajusta scroll dos layers diretamente
        return `    bgSetScroll(0, ${p.x}, ${p.y}); // camera: ${p.target}\n`;
      }
      // SGDK: câmera via scroll horizontal + vertical do BG_A
      return `    VDP_setHorizontalScroll(BG_A, ${p.x}); VDP_setVerticalScroll(BG_A, ${p.y}); // camera: ${p.target}\n`;

    case "camera_follow":
      if (target === "snes") {
        return `    // Camera follows ${p.target} with damping ${p.damping}\n`;
      }
      return `    VDP_setHorizontalScroll(BG_A, SPR_getX(spr_${p.target}) - 160); VDP_setVerticalScroll(BG_A, SPR_getY(spr_${p.target}) - 112);\n`;

    case "camera_bounds":
      return `    // Camera bounds: ${p.min_x},${p.min_y} -> ${p.max_x},${p.max_y}\n`;

    case "var_set":
      return `    logic_var_${p.var_name} = ${resolveMathInput(graph, node.id, "value")};\n`;

    case "var_get":
      return `    // logic_var_${p.var_name}\n`;

    case "logic_math":
      return `    // Math: ${buildMathExpression(graph, node)}\n`;

    case "condition_compare":
      return `    if (${resolveMathInput(graph, node.id, "a")} ${p.operator} ${resolveMathInput(graph, node.id, "b")}) {\n        // [true branch]\n    } else {\n        // [false branch]\n    }\n`;

    case "fsm_state":
    case "fsm_transition":
      return "";

    case "hardware_budget_check":
      return `    // Hardware budget check: VRAM ${p.vram_kb}KB, sprites ${p.sprites}, sprites/scanline ${p.scanline_sprites}\n`;

    case "bridge_unconverted_source":
      if (isTruthyParam(p.blocking) && !isTruthyParam(p.allow_bridge_mode)) {
        const gap = String(p.gap ?? "unconverted_source");
        const sourceFile = String(p.source_file ?? p.source ?? "unknown source");
        const sourceLine = String(p.source_line ?? "?");
        return `#error "Source Bridge blocks codegen: ${gap} at ${sourceFile}:${sourceLine}. Enable bridge compatibility mode or replace with native nodes."\n`;
      }
      return `    // Source bridge '${p.gap}': ${p.source}\n`;

    default:
      return `    // [unknown node: ${node.type}]\n`;
  }
}

type FsmStateDef = {
  node: GraphNode;
  enumName: string;
  index: number;
};

function collectFsmStates(graph: NodeGraph): FsmStateDef[] {
  const states = graph.nodes
    .filter((node) => node.type === "fsm_state")
    .sort((left, right) => {
      const leftInitial = isTruthyParam(left.params.initial);
      const rightInitial = isTruthyParam(right.params.initial);
      if (leftInitial !== rightInitial) {
        return leftInitial ? -1 : 1;
      }
      return left.id.localeCompare(right.id);
    });

  return states.map((node, index) => ({
    node,
    enumName: `FSM_STATE_${sanitizeIdentifier(String(node.params.state_name ?? node.id)).toUpperCase()}`,
    index,
  }));
}

function emitFsmTransitionChain(
  graph: NodeGraph,
  node: GraphNode,
  states: FsmStateDef[],
  target: "megadrive" | "snes",
  indent: number,
  visited = new Set<string>()
): string {
  if (visited.has(node.id)) {
    return "";
  }
  visited.add(node.id);

  const indentStr = " ".repeat(indent);
  const conditionExpr = resolveBooleanInput(graph, node.id, "condition", target) || "0";
  const targetStateName = sanitizeIdentifier(String(node.params.target_state ?? ""));
  const targetState = states.find((state) =>
    sanitizeIdentifier(String(state.node.params.state_name ?? state.node.id)) === targetStateName
  ) ?? states[0];
  const matchedEdge = findOutgoingExecEdge(graph, node.id, "matched");
  const matchedNode = matchedEdge ? findNode(graph, matchedEdge.toNode) : undefined;
  const nextEdge = findOutgoingExecEdge(graph, node.id, "next");
  const nextNode = nextEdge ? findNode(graph, nextEdge.toNode) : undefined;

  let out = `${indentStr}if (${conditionExpr}) {\n`;
  out += `${" ".repeat(indent + 4)}logic_var_fsm_state = ${targetState.enumName};\n`;
  if (matchedNode) {
    out += emitExecChainFromNode(graph, matchedNode, target, new Set(visited), indent + 4);
  }
  if (nextNode?.type === "fsm_transition") {
    out += `${indentStr}} else {\n`;
    out += emitFsmTransitionChain(graph, nextNode, states, target, indent + 4, new Set(visited));
    out += `${indentStr}}\n`;
  } else {
    out += `${indentStr}}\n`;
  }
  return out;
}

function emitFlowCondition(
  graph: NodeGraph,
  node: GraphNode,
  target: "megadrive" | "snes"
): string {
  return resolveBooleanInput(graph, node.id, "condition", target) || "0";
}

type TimelineSlotDef = {
  index: number;
  delay: number;
  nextNode?: GraphNode;
};

function collectTimelineSlots(graph: NodeGraph, node: GraphNode): TimelineSlotDef[] {
  return [0, 1, 2]
    .map((index) => {
      const nextEdge = findOutgoingExecEdge(graph, node.id, `slot_${index}`);
      return {
        index,
        delay: Number(node.params[`slot_${index}_delay`] ?? 0),
        nextNode: nextEdge ? findNode(graph, nextEdge.toNode) : undefined,
      };
    })
    .filter((slot) => slot.nextNode && slot.delay >= 0)
    .sort((left, right) => left.delay - right.delay);
}

type HardwareEventNodeType = "event_vblank" | "event_hblank" | "event_dma_done";

type HardwareEventNode = GraphNode & { type: HardwareEventNodeType };

function isHardwareEventNode(node: GraphNode): node is HardwareEventNode {
  return (
    node.type === "event_vblank" ||
    node.type === "event_hblank" ||
    node.type === "event_dma_done"
  );
}

function collectHardwareEventNodes(graph: NodeGraph): HardwareEventNode[] {
  return graph.nodes.filter(isHardwareEventNode);
}

function hardwareEventHandlerName(type: HardwareEventNodeType): string {
  switch (type) {
    case "event_vblank":
      return "retro_on_vblank";
    case "event_hblank":
      return "retro_on_hblank";
    case "event_dma_done":
      return "retro_on_dma_done";
  }
}

function emitHardwareEventRegistration(
  target: "megadrive" | "snes",
  type: HardwareEventNodeType
): string {
  if (target === "snes") {
    switch (type) {
      case "event_vblank":
        return "    nmiSet(retro_on_vblank);\n";
      case "event_hblank":
        return "    irqInit(); irqSet(IRQ_HBLANK, retro_on_hblank);\n";
      case "event_dma_done":
        return "    dmaSetCallback(retro_on_dma_done);\n";
    }
  }

  switch (type) {
    case "event_vblank":
      return "    SYS_setVBlankCallback(retro_on_vblank);\n";
    case "event_hblank":
      return "    SYS_setHIntCallback(retro_on_hblank);\n";
    case "event_dma_done":
      return "    VDP_setDMACompleteCallback(retro_on_dma_done);\n";
  }
}

function emitExecChainFromNode(
  graph: NodeGraph,
  node: GraphNode,
  target: "megadrive" | "snes",
  visited = new Set<string>(),
  indent = 4
): string {
  if (visited.has(node.id)) {
    return "";
  }
  visited.add(node.id);

  const indentStr = " ".repeat(indent);

  if (node.type === "logic_and") {
    const nextEdge = findOutgoingExecEdge(graph, node.id, "exec");
    const nextNode = nextEdge ? findNode(graph, nextEdge.toNode) : undefined;
    return nextNode ? emitExecChainFromNode(graph, nextNode, target, visited, indent) : "";
  }

  if (node.type === "input_pressed" || node.type === "input_held" || node.type === "input_command") {
    const nextEdge =
      findOutgoingExecEdge(graph, node.id, "true") ?? findOutgoingExecEdge(graph, node.id, "exec");
    const falseEdge = findOutgoingExecEdge(graph, node.id, "false");
    const nextNode = nextEdge ? findNode(graph, nextEdge.toNode) : undefined;
    const falseNode = falseEdge ? findNode(graph, falseEdge.toNode) : undefined;
    const expression =
      node.type === "input_command" ? buildInputCommandExpression(node) : buildInputExpression(node, target);
    let out = `${indentStr}if (${expression}) {\n`;
    out += nextNode
      ? emitExecChainFromNode(graph, nextNode, target, new Set(visited), indent + 4)
      : `${" ".repeat(indent + 4)}// [input branch]\n`;
    if (falseNode) {
      out += `${indentStr}} else {\n`;
      out += emitExecChainFromNode(graph, falseNode, target, new Set(visited), indent + 4);
      out += `${indentStr}}\n`;
    } else {
      out += `${indentStr}}\n`;
    }
    return out;
  }

  if (node.type === "timer") {
    const timerName = `logic_var_timer_${sanitizeIdentifier(node.id)}`;
    const tickEdge = findOutgoingExecEdge(graph, node.id, "tick");
    const doneEdge = findOutgoingExecEdge(graph, node.id, "done");
    const tickNode = tickEdge ? findNode(graph, tickEdge.toNode) : undefined;
    const doneNode = doneEdge ? findNode(graph, doneEdge.toNode) : undefined;
    let out = `${indentStr}${timerName}++;\n`;
    if (tickNode) {
      out += emitExecChainFromNode(graph, tickNode, target, new Set(visited), indent);
    }
    out += `${indentStr}if (${timerName} >= ${Number(node.params.frames ?? 60)}) {\n`;
    if (doneNode) {
      out += emitExecChainFromNode(graph, doneNode, target, new Set(visited), indent + 4);
    }
    if (isTruthyParam(node.params.repeat)) {
      out += `${" ".repeat(indent + 4)}${timerName} = 0;\n`;
    }
    out += `${indentStr}}\n`;
    return out;
  }

  if (node.type === "hardware_budget_check") {
    const okEdge = findOutgoingExecEdge(graph, node.id, "ok");
    const warnEdge = findOutgoingExecEdge(graph, node.id, "warn");
    const okNode = okEdge ? findNode(graph, okEdge.toNode) : undefined;
    const warnNode = warnEdge ? findNode(graph, warnEdge.toNode) : undefined;
    let out = emitLinearNodeC(node, graph, target);
    if (okNode) {
      out += emitExecChainFromNode(graph, okNode, target, new Set(visited), indent);
    }
    if (warnNode) {
      out += `${indentStr}// [budget warning branch]\n`;
      out += emitExecChainFromNode(graph, warnNode, target, new Set(visited), indent);
    }
    return out;
  }

  if (node.type === "condition_compare") {
    const compareExpr = buildBooleanExpression(graph, node, target);
    const guardExpr = resolveBooleanInput(graph, node.id, "guard", target);
    const conditionExpr = guardExpr !== "0" ? `(${guardExpr} && ${compareExpr})` : compareExpr;
    const trueEdge = findOutgoingExecEdge(graph, node.id, "true");
    const falseEdge = findOutgoingExecEdge(graph, node.id, "false");
    const trueNode = trueEdge ? findNode(graph, trueEdge.toNode) : undefined;
    const falseNode = falseEdge ? findNode(graph, falseEdge.toNode) : undefined;

    let out = `${indentStr}if (${conditionExpr}) {\n`;
    out += trueNode
      ? emitExecChainFromNode(graph, trueNode, target, new Set(visited), indent + 4)
      : `${" ".repeat(indent + 4)}// [true branch]\n`;

    if (falseNode) {
      out += `${indentStr}} else {\n`;
      out += emitExecChainFromNode(graph, falseNode, target, new Set(visited), indent + 4);
      out += `${indentStr}}\n`;
    } else {
      out += `${indentStr}}\n`;
    }

    return out;
  }

  if (node.type === "fsm_state") {
    const states = collectFsmStates(graph);
    const currentState = states.find((state) => state.node.id === node.id);
    if (!currentState) {
      return "";
    }

    const bodyEdge = findOutgoingExecEdge(graph, node.id, "exec");
    const bodyNode = bodyEdge ? findNode(graph, bodyEdge.toNode) : undefined;
    const transitionEdge = findOutgoingExecEdge(graph, node.id, "transitions");
    const transitionNode = transitionEdge ? findNode(graph, transitionEdge.toNode) : undefined;

    let out = `${indentStr}if (logic_var_fsm_state == ${currentState.enumName}) {\n`;
    if (bodyNode) {
      out += emitExecChainFromNode(graph, bodyNode, target, new Set(visited), indent + 4);
    }
    if (transitionNode?.type === "fsm_transition") {
      out += emitFsmTransitionChain(
        graph,
        transitionNode,
        states,
        target,
        indent + 4,
        new Set(visited)
      );
    }
    out += `${indentStr}}\n`;
    return out;
  }

  if (node.type === "flow_if") {
    const conditionExpr = emitFlowCondition(graph, node, target);
    const trueEdge = findOutgoingExecEdge(graph, node.id, "true");
    const falseEdge = findOutgoingExecEdge(graph, node.id, "false");
    const trueNode = trueEdge ? findNode(graph, trueEdge.toNode) : undefined;
    const falseNode = falseEdge ? findNode(graph, falseEdge.toNode) : undefined;

    let out = `${indentStr}if (${conditionExpr}) {\n`;
    out += trueNode
      ? emitExecChainFromNode(graph, trueNode, target, new Set(visited), indent + 4)
      : `${" ".repeat(indent + 4)}// [true branch]\n`;
    if (falseNode) {
      out += `${indentStr}} else {\n`;
      out += emitExecChainFromNode(graph, falseNode, target, new Set(visited), indent + 4);
      out += `${indentStr}}\n`;
    } else {
      out += `${indentStr}}\n`;
    }
    return out;
  }

  if (node.type === "flow_while") {
    const conditionExpr = emitFlowCondition(graph, node, target);
    const bodyEdge = findOutgoingExecEdge(graph, node.id, "body");
    const doneEdge = findOutgoingExecEdge(graph, node.id, "done");
    const bodyNode = bodyEdge ? findNode(graph, bodyEdge.toNode) : undefined;
    const doneNode = doneEdge ? findNode(graph, doneEdge.toNode) : undefined;

    let out = `${indentStr}while (${conditionExpr}) {\n`;
    out += bodyNode
      ? emitExecChainFromNode(graph, bodyNode, target, new Set(visited), indent + 4)
      : `${" ".repeat(indent + 4)}// [loop body]\n`;
    out += `${indentStr}}\n`;
    if (doneNode) {
      out += emitExecChainFromNode(graph, doneNode, target, new Set(visited), indent);
    }
    return out;
  }

  if (node.type === "flow_for") {
    const countExpr = resolveMathInput(graph, node.id, "count");
    const loopVar = sanitizeIdentifier(String(node.params.var_name ?? "i"));
    const bodyEdge = findOutgoingExecEdge(graph, node.id, "body");
    const doneEdge = findOutgoingExecEdge(graph, node.id, "done");
    const bodyNode = bodyEdge ? findNode(graph, bodyEdge.toNode) : undefined;
    const doneNode = doneEdge ? findNode(graph, doneEdge.toNode) : undefined;

    let out = `${indentStr}for (int ${loopVar} = 0; ${loopVar} < ${countExpr}; ${loopVar}++) {\n`;
    out += bodyNode
      ? emitExecChainFromNode(graph, bodyNode, target, new Set(visited), indent + 4)
      : `${" ".repeat(indent + 4)}// [loop body]\n`;
    out += `${indentStr}}\n`;
    if (doneNode) {
      out += emitExecChainFromNode(graph, doneNode, target, new Set(visited), indent);
    }
    return out;
  }

  if (node.type === "timeline_sequence") {
    const timelineName = sanitizeIdentifier(String(node.params.timeline_name ?? node.id));
    const counterName = `logic_var_timeline_${timelineName}`;
    const slots = collectTimelineSlots(graph, node);

    let out = `${indentStr}${counterName}++;\n`;
    out += `${indentStr}switch (${counterName}) {\n`;
    for (const slot of slots) {
      out += `${" ".repeat(indent + 4)}case ${slot.delay}:\n`;
      if (slot.nextNode) {
        out += emitExecChainFromNode(graph, slot.nextNode, target, new Set(visited), indent + 8);
      }
      out += `${" ".repeat(indent + 8)}break;\n`;
    }
    out += `${" ".repeat(indent + 4)}default:\n`;
    out += `${" ".repeat(indent + 8)}break;\n`;
    out += `${indentStr}}\n`;
    return out;
  }

  let out = emitLinearNodeC(node, graph, target);
  const nextEdge = findOutgoingExecEdge(graph, node.id, "exec");
  const nextNode = nextEdge ? findNode(graph, nextEdge.toNode) : undefined;
  if (nextNode) {
    out += emitExecChainFromNode(graph, nextNode, target, visited, indent);
  }
  return out;
}

/**
 * Compila um NodeGraph para código C.
 * Percorre todas as chains exec a partir de nós "event_start".
 */
export function compileGraphToC(
  graph: NodeGraph,
  projectName: string,
  target: "megadrive" | "snes" = "megadrive"
): string {
  const include = target === "snes" ? "#include <snes.h>" : "#include <genesis.h>";
  let out = `// Generated by RetroDev Studio NodeGraph — DO NOT EDIT\n// Project: ${projectName}\n\n${include}\n#include "resources.h"\n\n`;

  const startNodes = graph.nodes.filter((n: GraphNode) => n.type === "event_start");
  const updateNodes = graph.nodes.filter((n: GraphNode) => n.type === "event_update");
  const fsmStates = collectFsmStates(graph);
  const hardwareEvents = collectHardwareEventNodes(graph);
  const inputCommandNodes = collectInputCommandNodes(graph);

  if (startNodes.length === 0 && updateNodes.length === 0 && hardwareEvents.length === 0) {
    return out + "// No event_start node found in graph.\n";
  }

  // Collect sprite var declarations
  const spriteNodes = graph.nodes.filter(
    (n: GraphNode) =>
      n.type === "sprite_move" ||
      n.type === "sprite_anim" ||
      n.type === "set_position" ||
      n.type === "set_velocity" ||
      n.type === "set_animation_state" ||
      n.type === "camera_follow" ||
      n.type === "destroy_entity"
  );
  const spriteVars = new Set<string | number>(
    spriteNodes.map((n: GraphNode) => String(n.params.target))
  );
  graph.nodes
    .filter((n: GraphNode) => n.type === "spawn_entity")
    .forEach((n: GraphNode) => spriteVars.add(String(n.params.prefab)));

  if (target === "megadrive") {
    spriteVars.forEach((v) => { out += `static Sprite* spr_${v};\n`; });
  } else {
    spriteVars.forEach((v) => { out += `static u16 oam_${v};\n`; });
  }

  collectLogicVariables(graph).forEach((v) => {
    if (v === "fsm_state" && fsmStates.length > 0) {
      return;
    }
    out += `static int logic_var_${v};\n`;
  });
  if (fsmStates.length > 0) {
    out += "enum {\n";
    fsmStates.forEach((state) => {
      out += `    ${state.enumName} = ${state.index},\n`;
    });
    out += "};\n";
    out += `static int logic_var_fsm_state = ${fsmStates[0].enumName};\n`;
  }
  if (hardwareEvents.length > 0) {
    out += "\n";
    for (const eventNode of hardwareEvents) {
      const handlerName = hardwareEventHandlerName(eventNode.type);
      out += `static void ${handlerName}(void) {\n`;
      const nextEdge = findOutgoingExecEdge(graph, eventNode.id, "exec");
      const nextNode = nextEdge ? findNode(graph, nextEdge.toNode) : undefined;
      if (nextNode) {
        out += emitExecChainFromNode(graph, nextNode, target, new Set([eventNode.id]));
      }
      out += "}\n";
    }
  }

  out += emitInputCommandRuntime(graph, target);

  out += "\nint main() {\n";
  for (const eventNode of hardwareEvents) {
    out += emitHardwareEventRegistration(target, eventNode.type);
  }

  for (const startNode of startNodes) {
    out += emitExecChainFromNode(graph, startNode, target);
  }
  for (const state of fsmStates) {
    out += emitExecChainFromNode(graph, state.node, target);
  }

  if (target === "snes") {
    out += "\n    while (true) {\n";
    if (inputCommandNodes.length > 0) {
      out += emitInputCommandFrameCapture(target);
    }
    for (const updateNode of updateNodes) {
      out += emitExecChainFromNode(graph, updateNode, target);
    }
    out += "        oamUpdate();\n        WaitForVBlank();\n    }\n";
  } else {
    out += "\n    while (TRUE) {\n";
    if (inputCommandNodes.length > 0) {
      out += emitInputCommandFrameCapture(target);
    }
    for (const updateNode of updateNodes) {
      out += emitExecChainFromNode(graph, updateNode, target);
    }
    out += "        SPR_update();\n        SYS_doVBlankProcess();\n    }\n";
  }

  out += "\n    return 0;\n}\n";
  return out;
}

// ── C → Node (basic round-trip parser) ───────────────────────────────────────

import type { NodeType } from "../../components/nodegraph/NodeGraphEditor";

interface ParsedNode {
  type: NodeType;
  params: Record<string, string | number>;
}

/**
 * Parseia um main.c gerado pelo Studio e reconstrói uma lista de nós.
 * Suporta apenas os patterns emitidos pelo próprio Studio (round-trip).
 */
export function parseCToNodes(source: string): ParsedNode[] {
  const nodes: ParsedNode[] = [];

  // Sempre começa com event_start
  nodes.push({ type: "event_start", params: {} });

  const lines = source.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    // SPR_setPosition → sprite_move
    // Regex não-guloso para capturar corretamente dx e dy, incluindo valores negativos
    const moveMatch = trimmed.match(/SPR_setPosition\(spr_(\w+),\s*\S+\s*\+\s*(-?\d+),\s*\S+\s*\+\s*(-?\d+)/);
    if (moveMatch) {
      nodes.push({ type: "sprite_move", params: { target: moveMatch[1], dx: Number(moveMatch[2]), dy: Number(moveMatch[3]) } });
      continue;
    }

    // SPR_setAnim → sprite_anim
    const animMatch = trimmed.match(/SPR_setAnim\(spr_(\w+),\s*ANIM_(\w+)\)/);
    if (animMatch) {
      nodes.push({ type: "sprite_anim", params: { target: animMatch[1], anim: animMatch[2].toLowerCase() } });
      continue;
    }

    // VDP_setHorizontalScroll → effect_parallax (Mega Drive)
    const parallaxMatch = trimmed.match(/VDP_setHorizontalScroll\(BG_(\w+),.*\+= (-?\d+)\)/);
    if (parallaxMatch) {
      nodes.push({ type: "effect_parallax", params: { layer: parallaxMatch[1], speed_x: Number(parallaxMatch[2]), speed_y: 0 } });
      continue;
    }

    // bgSetScroll → effect_parallax (SNES / PVSnesLib)
    const snesParallaxMatch = trimmed.match(/bg_scroll_(\w+) \+= (-?\d+); bgSetScroll\(/);
    if (snesParallaxMatch) {
      nodes.push({ type: "effect_parallax", params: { layer: snesParallaxMatch[1], speed_x: Number(snesParallaxMatch[2]), speed_y: 0 } });
      continue;
    }

    // VDP_setHorizontalScrollLine → effect_raster (Mega Drive)
    const rasterMatch = trimmed.match(/VDP_setHorizontalScrollLine\(BG_\w+,\s*(\d+),\s*(-?\d+)\)/);
    if (rasterMatch) {
      nodes.push({ type: "effect_raster", params: { scanline: Number(rasterMatch[1]), offset_x: Number(rasterMatch[2]) } });
      continue;
    }

    // SND_startPlayPCM → action_sound (Mega Drive)
    const soundMatch = trimmed.match(/SND_startPlayPCM\(SFX_(\w+)/);
    if (soundMatch) {
      nodes.push({ type: "action_sound", params: { sfx: soundMatch[1].toLowerCase() } });
      continue;
    }

    // SPC_playSFX → action_sound (SNES / PVSnesLib)
    const snesSoundMatch = trimmed.match(/SPC_playSFX\(SFX_(\w+)/);
    if (snesSoundMatch) {
      nodes.push({ type: "action_sound", params: { sfx: snesSoundMatch[1].toLowerCase() } });
      continue;
    }

    // VDP_setHorizontalScroll + VDP_setVerticalScroll → scroll_tilemap (Mega Drive)
    // Padrão: tm_scroll_x_LAYER += DX; VDP_setHorizontalScroll(LAYER, ...)
    const tmScrollMdMatch = trimmed.match(/tm_scroll_x_(\w+) \+= (-?\d+); VDP_setHorizontalScroll/);
    if (tmScrollMdMatch) {
      // Extrai dy da linha seguinte — aqui aproximamos com 0 se não encontrado
      const dyMatch = trimmed.match(/tm_scroll_y_\w+ \+= (-?\d+)/);
      nodes.push({ type: "scroll_tilemap", params: { layer: tmScrollMdMatch[1], dx: Number(tmScrollMdMatch[2]), dy: dyMatch ? Number(dyMatch[1]) : 0 } });
      continue;
    }

    // bgSetScroll com prefixo tm_scroll → scroll_tilemap (SNES)
    const tmScrollSnesMatch = trimmed.match(/tm_scroll_x_(\w+) \+= (-?\d+); tm_scroll_y_\w+ \+= (-?\d+); bgSetScroll/);
    if (tmScrollSnesMatch) {
      nodes.push({ type: "scroll_tilemap", params: { layer: tmScrollSnesMatch[1], dx: Number(tmScrollSnesMatch[2]), dy: Number(tmScrollSnesMatch[3]) } });
      continue;
    }

    // VDP_setHorizontalScroll(BG_A, X) com comentário "camera" → move_camera (Mega Drive)
    const moveCamMdMatch = trimmed.match(/VDP_setHorizontalScroll\(BG_A,\s*(-?\d+)\).*camera:\s*(\w+)/);
    if (moveCamMdMatch) {
      const yMatch = trimmed.match(/VDP_setVerticalScroll\(BG_A,\s*(-?\d+)\)/);
      nodes.push({ type: "move_camera", params: { target: moveCamMdMatch[2], x: Number(moveCamMdMatch[1]), y: yMatch ? Number(yMatch[1]) : 0 } });
      continue;
    }

    // bgSetScroll(0, X, Y) com comentário "camera" → move_camera (SNES)
    const moveCamSnesMatch = trimmed.match(/bgSetScroll\(0,\s*(-?\d+),\s*(-?\d+)\).*camera:\s*(\w+)/);
    if (moveCamSnesMatch) {
      nodes.push({ type: "move_camera", params: { target: moveCamSnesMatch[3], x: Number(moveCamSnesMatch[1]), y: Number(moveCamSnesMatch[2]) } });
      continue;
    }

    // var_set
    const setVarMatch = trimmed.match(/logic_var_(\w+)\s*=\s*(.*);/);
    if (setVarMatch) {
      nodes.push({ type: "var_set", params: { var_name: setVarMatch[1], value: setVarMatch[2] } });
      continue;
    }

    const legacySetVarMatch = trimmed.match(/\/\/ Set logic_var_(\w+) = (.*)/);
    if (legacySetVarMatch) {
      nodes.push({ type: "var_set", params: { var_name: legacySetVarMatch[1], value: legacySetVarMatch[2] } });
      continue;
    }

    // condition_compare
    const compareMatch = trimmed.match(/if \((.*) (==|!=|>|>=|<|<=) (.*)\) \{/);
    if (compareMatch) {
      nodes.push({ type: "condition_compare", params: { a: compareMatch[1], operator: compareMatch[2], b: compareMatch[3] } });
      continue;
    }
  }

  return nodes;
}
