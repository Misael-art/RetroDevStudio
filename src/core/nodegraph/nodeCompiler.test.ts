/**
 * nodeCompiler.test.ts — Testes do compilador legado/experimental Node → C.
 *
 * Esta suite cobre apenas o utilitario frontend nao-canonico. O pipeline oficial
 * de codegen continua sendo validado no backend Rust.
 */

import { describe, it, expect } from "vitest";
import { compileGraphToC, parseCToNodes } from "./nodeCompiler";
import {
  EMPTY_GRAPH as SERIALIZED_EMPTY_GRAPH,
  deserializeNodeGraph,
  getNodeDisplayName,
  serializeNodeGraph,
  type NodeGraph,
} from "../../components/nodegraph/NodeGraphEditor";

// ── Helpers de fixture ────────────────────────────────────────────────────────

function node(
  id: string,
  type: NodeGraph["nodes"][number]["type"],
  params: Record<string, string | number> = {}
): NodeGraph["nodes"][number] {
  return { id, type, label: type, x: 0, y: 0, inputs: [], outputs: [], params };
}

function edge(id: string, fromNode: string, toNode: string): NodeGraph["edges"][number] {
  return { id, fromNode, fromPort: "exec", toNode, toPort: "exec" };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const EMPTY_GRAPH: NodeGraph = { nodes: [], edges: [] };

const GRAPH_START_ONLY: NodeGraph = {
  nodes: [node("n1", "event_start")],
  edges: [],
};

const GRAPH_MOVE_MD: NodeGraph = {
  nodes: [
    node("n1", "event_start"),
    node("n2", "sprite_move", { target: "player", dx: 2, dy: 0 }),
  ],
  edges: [edge("e1", "n1", "n2")],
};

const GRAPH_MOVE_SNES: NodeGraph = GRAPH_MOVE_MD;

const GRAPH_SOUND_MD: NodeGraph = {
  nodes: [
    node("n1", "event_start"),
    node("n2", "action_sound", { sfx: "jump" }),
  ],
  edges: [edge("e1", "n1", "n2")],
};

const GRAPH_LOGIC_VARS: NodeGraph = {
  nodes: [
    node("n1", "event_start"),
    node("get_score", "var_get", { var_name: "score" }),
    node("math_add", "logic_math", { operator: "+" }),
    node("set_score", "var_set", { var_name: "score", value: 0 }),
    node("compare", "condition_compare", { operator: ">=", b: 10 }),
  ],
  edges: [
    { id: "e1", fromNode: "n1", fromPort: "exec", toNode: "set_score", toPort: "exec" },
    { id: "e2", fromNode: "set_score", fromPort: "exec", toNode: "compare", toPort: "exec" },
    { id: "e3", fromNode: "get_score", fromPort: "value", toNode: "math_add", toPort: "a" },
    { id: "e4", fromNode: "math_add", fromPort: "value", toNode: "set_score", toPort: "value" },
    { id: "e5", fromNode: "get_score", fromPort: "value", toNode: "compare", toPort: "a" },
  ],
};

const GRAPH_LOGIC_BRANCHING: NodeGraph = {
  nodes: [
    node("start", "event_start"),
    node("score_get", "var_get", { var_name: "score" }),
    node("lives_get", "var_get", { var_name: "lives" }),
    node("score_ready", "condition_compare", { operator: ">", b: 0 }),
    node("score_check", "condition_compare", { operator: ">=", b: 10 }),
    node("lives_check", "condition_compare", { operator: ">", b: 0 }),
    node("guard", "logic_and"),
    node("win_sound", "action_sound", { sfx: "win" }),
    node("lose_sound", "action_sound", { sfx: "lose" }),
  ],
  edges: [
    { id: "e1", fromNode: "start", fromPort: "exec", toNode: "score_check", toPort: "exec" },
    { id: "e2", fromNode: "score_get", fromPort: "value", toNode: "score_ready", toPort: "a" },
    { id: "e3", fromNode: "score_get", fromPort: "value", toNode: "score_check", toPort: "a" },
    { id: "e4", fromNode: "lives_get", fromPort: "value", toNode: "lives_check", toPort: "a" },
    { id: "e5", fromNode: "score_ready", fromPort: "true", toNode: "guard", toPort: "a" },
    { id: "e6", fromNode: "lives_check", fromPort: "true", toNode: "guard", toPort: "b" },
    { id: "e7", fromNode: "guard", fromPort: "out", toNode: "score_check", toPort: "guard" },
    { id: "e8", fromNode: "score_check", fromPort: "true", toNode: "win_sound", toPort: "exec" },
    { id: "e9", fromNode: "score_check", fromPort: "false", toNode: "lose_sound", toPort: "exec" },
  ],
};

const GRAPH_FSM: NodeGraph = {
  nodes: [
    node("start", "event_start"),
    node("idle", "fsm_state", { state_name: "idle", initial: 1 }),
    node("run", "fsm_state", { state_name: "run", initial: 0 }),
    node("speed", "var_get", { var_name: "speed" }),
    node("idle_to_run", "fsm_transition", { target_state: "run" }),
    node("run_to_idle", "fsm_transition", { target_state: "idle" }),
    node("step", "sprite_move", { target: "player", dx: 2, dy: 0 }),
  ],
  edges: [
    { id: "e1", fromNode: "start", fromPort: "exec", toNode: "idle", toPort: "exec" },
    { id: "e2", fromNode: "idle", fromPort: "transitions", toNode: "idle_to_run", toPort: "exec" },
    { id: "e3", fromNode: "speed", fromPort: "value", toNode: "idle_to_run", toPort: "condition" },
    { id: "e4", fromNode: "run", fromPort: "exec", toNode: "step", toPort: "exec" },
    { id: "e5", fromNode: "run", fromPort: "transitions", toNode: "run_to_idle", toPort: "exec" },
    { id: "e6", fromNode: "speed", fromPort: "value", toNode: "run_to_idle", toPort: "condition" },
  ],
};

const GRAPH_FLOW: NodeGraph = {
  nodes: [
    node("start", "event_start"),
    node("speed", "var_get", { var_name: "speed" }),
    node("if_node", "flow_if"),
    node("while_node", "flow_while"),
    node("for_node", "flow_for", { var_name: "idx", count: 3 }),
    node("move", "sprite_move", { target: "player", dx: 1, dy: 0 }),
    node("sound", "action_sound", { sfx: "jump" }),
  ],
  edges: [
    { id: "f1", fromNode: "start", fromPort: "exec", toNode: "if_node", toPort: "exec" },
    { id: "f2", fromNode: "speed", fromPort: "value", toNode: "if_node", toPort: "condition" },
    { id: "f3", fromNode: "if_node", fromPort: "true", toNode: "while_node", toPort: "exec" },
    { id: "f4", fromNode: "speed", fromPort: "value", toNode: "while_node", toPort: "condition" },
    { id: "f5", fromNode: "while_node", fromPort: "body", toNode: "move", toPort: "exec" },
    { id: "f6", fromNode: "while_node", fromPort: "done", toNode: "for_node", toPort: "exec" },
    { id: "f7", fromNode: "for_node", fromPort: "body", toNode: "sound", toPort: "exec" },
  ],
};

const GRAPH_TIMELINE: NodeGraph = {
  nodes: [
    node("start", "event_start"),
    node("timeline", "timeline_sequence", {
      timeline_name: "intro",
      slot_0_delay: 15,
      slot_1_delay: 30,
      slot_2_delay: 45,
    }),
    node("move", "sprite_move", { target: "player", dx: 2, dy: 0 }),
    node("sound", "action_sound", { sfx: "jump" }),
  ],
  edges: [
    { id: "t1", fromNode: "start", fromPort: "exec", toNode: "timeline", toPort: "exec" },
    { id: "t2", fromNode: "timeline", fromPort: "slot_0", toNode: "move", toPort: "exec" },
    { id: "t3", fromNode: "timeline", fromPort: "slot_1", toNode: "sound", toPort: "exec" },
  ],
};

const GRAPH_HARDWARE_EVENTS: NodeGraph = {
  nodes: [
    node("vblank", "event_vblank"),
    node("hblank", "event_hblank"),
    node("dma_done", "event_dma_done"),
    node("move", "sprite_move", { target: "player", dx: 1, dy: 0 }),
    node("sound", "action_sound", { sfx: "jump" }),
  ],
  edges: [
    { id: "h1", fromNode: "vblank", fromPort: "exec", toNode: "move", toPort: "exec" },
    { id: "h2", fromNode: "hblank", fromPort: "exec", toNode: "sound", toPort: "exec" },
  ],
};

const GRAPH_NOCODE_MD_GAME: NodeGraph = {
  nodes: [
    node("start", "event_start"),
    node("spawn_player", "spawn_entity", { prefab: "player", x: 40, y: 96 }),
    node("paint_floor", "set_tile", { layer: "BG_A", tile: 12, x: 1, y: 14 }),
    node("camera_bounds", "camera_bounds", { min_x: 0, min_y: 0, max_x: 640, max_y: 224 }),
    node("update", "event_update"),
    node("right", "input_held", { pad: "JOY_1", button: "BUTTON_RIGHT" }),
    node("velocity", "set_velocity", { target: "player", vx: 2, vy: 0 }),
    node("position", "set_position", { target: "player", x: 40, y: 96 }),
    node("run_anim", "set_animation_state", { target: "player", state: "run" }),
    node("camera_follow", "camera_follow", { target: "player", damping: 0 }),
    node("budget", "hardware_budget_check", { vram_kb: 64, sprites: 80, scanline_sprites: 20 }),
    node("step_sfx", "action_sound", { sfx: "step" }),
  ],
  edges: [
    edge("g1", "start", "spawn_player"),
    edge("g2", "spawn_player", "paint_floor"),
    edge("g3", "paint_floor", "camera_bounds"),
    edge("g4", "update", "right"),
    edge("g5", "right", "velocity"),
    edge("g6", "velocity", "position"),
    edge("g7", "position", "run_anim"),
    edge("g8", "run_anim", "camera_follow"),
    edge("g9", "camera_follow", "budget"),
    { id: "g10", fromNode: "budget", fromPort: "ok", toNode: "step_sfx", toPort: "exec" },
  ],
};

const GRAPH_INPUT_COMMAND: NodeGraph = {
  nodes: [
    node("update", "event_update"),
    node("hadouken", "input_command", {
      command_id: "hadouken",
      display_name: "Hadouken",
      notation: "_2,_3,_6,_P",
      max_frames: 15,
      pad: "JOY_1",
      button_profile: "megadrive",
      target: "player",
    }),
    node("fireball", "set_animation_state", { target: "player", state: "fireball" }),
  ],
  edges: [
    edge("c1", "update", "hadouken"),
    edge("c2", "hadouken", "fireball"),
  ],
};

// ── compileGraphToC ───────────────────────────────────────────────────────────

describe("NodeGraph serialization", () => {
  it("round-trips nodes and edges through LogicComponent.graph JSON", () => {
    const graph: NodeGraph = {
      nodes: [
        node("n1", "event_start"),
        node("n2", "sprite_move", { target: "player", dx: 2, dy: -1 }),
        node("n3", "action_sound", { sfx: "jump" }),
      ],
      edges: [edge("e1", "n1", "n2"), edge("e2", "n2", "n3")],
    };

    const serialized = serializeNodeGraph(graph);

    expect(serialized).toContain('"type":"event_start"');
    expect(serialized).toContain('"type":"sprite_move"');
    const restored = deserializeNodeGraph(serialized);
    expect(restored.edges).toEqual(graph.edges);
    expect(restored.nodes).toHaveLength(graph.nodes.length);
    for (let i = 0; i < graph.nodes.length; i++) {
      expect(restored.nodes[i]).toMatchObject({
        id: graph.nodes[i].id,
        type: graph.nodes[i].type,
        params: graph.nodes[i].params,
      });
    }
    expect(restored.nodes.every((n) => n.outputs.length > 0)).toBe(true);
  });

  it("keeps display names separate from serialized technical ids", () => {
    expect(getNodeDisplayName("event_start")).toBe("Ao Iniciar");
    expect(getNodeDisplayName("sprite_move")).toBe("Mover Sprite");

    const serialized = serializeNodeGraph({
      nodes: [node("n1", "event_start"), node("n2", "sprite_move", { target: "player", dx: 2, dy: 0 })],
      edges: [edge("e1", "n1", "n2")],
    });

    expect(serialized).toContain('"type":"event_start"');
    expect(serialized).toContain('"type":"sprite_move"');
    expect(serialized).not.toContain("Ao Iniciar");
    expect(serialized).not.toContain("Mover Sprite");
  });

  it("falls back to empty graph for invalid payloads", () => {
    expect(deserializeNodeGraph("not-json")).toEqual(SERIALIZED_EMPTY_GRAPH);
    expect(
      deserializeNodeGraph(JSON.stringify({ nodes: [{ id: "n1", type: "unknown" }], edges: [] }))
    ).toEqual(
      SERIALIZED_EMPTY_GRAPH
    );
  });

  it("hydrates legacy backend-only node payloads into the editor schema", () => {
    const serialized = JSON.stringify({
      version: 1,
      nodes: [
        { id: "start", type: "event_start", params: {} },
        {
          id: "move",
          type: "sprite_move",
          params: { target: "player", dx: 1, dy: 0 },
        },
      ],
      edges: [
        {
          id: "edge_start_move",
          fromNode: "start",
          fromPort: "exec",
          toNode: "move",
          toPort: "exec",
        },
      ],
    });

    const hydrated = deserializeNodeGraph(serialized);

    expect(hydrated.edges).toHaveLength(1);
    expect(hydrated.nodes).toHaveLength(2);
    expect(hydrated.nodes[0]).toMatchObject({
      id: "start",
      type: "event_start",
      label: "On Start",
    });
    expect(hydrated.nodes[1]).toMatchObject({
      id: "move",
      type: "sprite_move",
      label: "Move Sprite",
      params: { target: "player", dx: 1, dy: 0 },
    });
    expect(hydrated.nodes[1].inputs.length).toBeGreaterThan(0);
    expect(hydrated.nodes[1].outputs.length).toBeGreaterThan(0);
  });

  it("SGDK import: portos parciais no JSON fundem-se com NODE_DEFS e arestas invalidas caem fora", () => {
    const serialized = JSON.stringify({
      version: 1,
      nodes: [
        {
          id: "start",
          type: "event_start",
          label: "On Start",
          x: 0,
          y: 0,
          inputs: [],
          outputs: [{ id: "exec", label: ">", kind: "exec" }],
          params: {},
        },
        {
          id: "move_sprite",
          type: "sprite_move",
          label: "Move Sprite",
          x: 0,
          y: 0,
          inputs: [{ id: "exec", label: ">", kind: "exec" }],
          outputs: [{ id: "exec", label: ">", kind: "exec" }],
          params: { target: "hero", dx: 2, dy: 0 },
        },
        {
          id: "scroll_bg",
          type: "scroll_tilemap",
          label: "Scroll",
          x: 0,
          y: 0,
          inputs: [{ id: "exec", label: ">", kind: "exec" }],
          outputs: [{ id: "exec", label: ">", kind: "exec" }],
          params: { layer: "BG_A", dx: -1, dy: 0 },
        },
      ],
      edges: [
        {
          id: "e_ok",
          fromNode: "start",
          fromPort: "exec",
          toNode: "move_sprite",
          toPort: "exec",
        },
        {
          id: "e_bad",
          fromNode: "ghost",
          fromPort: "exec",
          toNode: "move_sprite",
          toPort: "exec",
        },
      ],
    });
    const g = deserializeNodeGraph(serialized);
    expect(g.nodes).toHaveLength(3);
    const move = g.nodes.find((n) => n.id === "move_sprite");
    expect(move?.inputs.length).toBe(3);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0].id).toBe("e_ok");
  });
});

describe("compileGraphToC — Mega Drive", () => {
  it("grafo vazio: emite comentário de aviso sem event_start", () => {
    const code = compileGraphToC(EMPTY_GRAPH, "TestProject");
    expect(code).toContain("// No event_start node found in graph.");
  });

  it("inclui genesis.h para target megadrive", () => {
    const code = compileGraphToC(GRAPH_START_ONLY, "Test");
    expect(code).toContain("#include <genesis.h>");
  });

  it("emite SPR_setPosition para sprite_move no Mega Drive", () => {
    const code = compileGraphToC(GRAPH_MOVE_MD, "Test", "megadrive");
    expect(code).toContain("SPR_setPosition(spr_player");
    expect(code).toContain("2");
  });

  it("emite declaração static Sprite* para variáveis de sprite", () => {
    const code = compileGraphToC(GRAPH_MOVE_MD, "Test", "megadrive");
    expect(code).toContain("static Sprite* spr_player;");
  });

  it("emite SND_startPlayPCM para action_sound no Mega Drive", () => {
    const code = compileGraphToC(GRAPH_SOUND_MD, "Test", "megadrive");
    expect(code).toContain("SND_startPlayPCM(SFX_JUMP");
  });

  it("emite loop principal com SPR_update e SYS_doVBlankProcess", () => {
    const code = compileGraphToC(GRAPH_START_ONLY, "Test", "megadrive");
    expect(code).toContain("SPR_update()");
    expect(code).toContain("SYS_doVBlankProcess()");
  });

  it("inclui o nome do projeto no cabeçalho", () => {
    const code = compileGraphToC(GRAPH_START_ONLY, "MeuJogo");
    expect(code).toContain("// Project: MeuJogo");
  });
});

describe("compileGraphToC — SNES", () => {
  it("declara e usa variaveis logicas com var_set e logic_math", () => {
    const code = compileGraphToC(GRAPH_LOGIC_VARS, "LogicVars", "megadrive");
    expect(code).toContain("static int logic_var_score;");
    expect(code).toContain("logic_var_score = (logic_var_score + 0);");
  });

  it("emite comparacao usando entradas conectadas", () => {
    const code = compileGraphToC(GRAPH_LOGIC_VARS, "LogicVars", "megadrive");
    expect(code).toContain("if ((logic_var_score >= 10))");
  });

  it("emite logic_and como guarda booleana inline", () => {
    const code = compileGraphToC(GRAPH_LOGIC_BRANCHING, "LogicBranching", "megadrive");
    expect(code).toContain("((logic_var_score > 0) && (logic_var_lives > 0))");
  });

  it("emite branching real com portas true e false para condition_compare", () => {
    const code = compileGraphToC(GRAPH_LOGIC_BRANCHING, "LogicBranching", "megadrive");
    expect(code).toContain("if ((((logic_var_score > 0) && (logic_var_lives > 0)) && (logic_var_score >= 10))) {");
    expect(code).toContain("SND_startPlayPCM(SFX_WIN, 1, SOUND_PCM_CH_AUTO);");
    expect(code).toContain("} else {");
    expect(code).toContain("SND_startPlayPCM(SFX_LOSE, 1, SOUND_PCM_CH_AUTO);");
  });

  it("inclui snes.h para target snes", () => {
    const code = compileGraphToC(GRAPH_START_ONLY, "Test", "snes");
    expect(code).toContain("#include <snes.h>");
  });

  it("emite comentário de oamSet para sprite_move no SNES", () => {
    const code = compileGraphToC(GRAPH_MOVE_SNES, "Test", "snes");
    expect(code).toContain("oamSet");
  });

  it("emite declaração static u16 oam_ para variáveis de sprite no SNES", () => {
    const code = compileGraphToC(GRAPH_MOVE_SNES, "Test", "snes");
    expect(code).toContain("static u16 oam_player;");
  });

  it("emite SPC_playSFX para action_sound no SNES", () => {
    const code = compileGraphToC(GRAPH_SOUND_MD, "Test", "snes");
    expect(code).toContain("SPC_playSFX(SFX_JUMP");
  });

  it("emite loop principal com oamUpdate e WaitForVBlank para SNES", () => {
    const code = compileGraphToC(GRAPH_START_ONLY, "Test", "snes");
    expect(code).toContain("oamUpdate()");
    expect(code).toContain("WaitForVBlank()");
  });

  it("gera SNES C consistente para input_held, movimento e FSM", () => {
    const graph: NodeGraph = {
      nodes: [
        node("update", "event_update"),
        node("right", "input_held", { pad: "JOY_1", button: "BUTTON_RIGHT" }),
        node("move", "sprite_move", { target: "player", dx: 2, dy: 0 }),
        node("idle", "fsm_state", { state_name: "idle", initial: 1 }),
        node("run", "fsm_state", { state_name: "run", initial: 0 }),
        node("idle_to_run", "fsm_transition", { target_state: "run" }),
      ],
      edges: [
        edge("e1", "update", "right"),
        { id: "e2", fromNode: "right", fromPort: "true", toNode: "move", toPort: "exec" },
        { id: "e3", fromNode: "idle", fromPort: "transitions", toNode: "idle_to_run", toPort: "exec" },
        { id: "e4", fromNode: "right", fromPort: "true", toNode: "idle_to_run", toPort: "condition" },
      ],
    };

    const code = compileGraphToC(graph, "SnesInputMoveFsm", "snes");

    expect(code).toContain("if ((padsCurrent(0) & KEY_RIGHT))");
    expect(code).not.toContain("BUTTON_RIGHT");
    expect(code).toContain("oamSet");
    expect(code).toContain("FSM_STATE_IDLE = 0");
    expect(code).toContain("FSM_STATE_RUN = 1");
    expect(code).toContain("logic_var_fsm_state = FSM_STATE_RUN;");
  });

  it("emite if-chain de FSM com estados nomeados e transicoes", () => {
    const code = compileGraphToC(GRAPH_FSM, "FsmDemo", "megadrive");

    expect(code).toContain("FSM_STATE_IDLE = 0");
    expect(code).toContain("FSM_STATE_RUN = 1");
    expect(code).toContain("static int logic_var_fsm_state = FSM_STATE_IDLE;");
    expect(code).toContain("if (logic_var_fsm_state == FSM_STATE_IDLE) {");
    expect(code).toContain("logic_var_fsm_state = FSM_STATE_RUN;");
    expect(code).toContain("if (logic_var_fsm_state == FSM_STATE_RUN) {");
    expect(code).toContain("SPR_setPosition(spr_player");
  });

  it("emite estruturas C reais para flow_if, flow_while e flow_for", () => {
    const code = compileGraphToC(GRAPH_FLOW, "FlowDemo", "megadrive");

    expect(code).toContain("if ((logic_var_speed != 0)) {");
    expect(code).toContain("while ((logic_var_speed != 0)) {");
    expect(code).toContain("for (int idx = 0; idx < 3; idx++) {");
    expect(code).toContain("SND_startPlayPCM(SFX_JUMP");
  });

  it("emite timeline_sequence como counter mais switch/case", () => {
    const code = compileGraphToC(GRAPH_TIMELINE, "TimelineDemo", "megadrive");

    expect(code).toContain("static int logic_var_timeline_intro;");
    expect(code).toContain("logic_var_timeline_intro++;");
    expect(code).toContain("switch (logic_var_timeline_intro) {");
    expect(code).toContain("case 15:");
    expect(code).toContain("case 30:");
    expect(code).toContain("SPR_setPosition(spr_player");
    expect(code).toContain("SND_startPlayPCM(SFX_JUMP");
  });

  it("emite handlers e registro para hardware event nodes", () => {
    const mdCode = compileGraphToC(GRAPH_HARDWARE_EVENTS, "EventsDemo", "megadrive");
    const snesCode = compileGraphToC(GRAPH_HARDWARE_EVENTS, "EventsDemo", "snes");

    expect(mdCode).toContain("static void retro_on_vblank(void) {");
    expect(mdCode).toContain("SYS_setVBlankCallback(retro_on_vblank);");
    expect(mdCode).toContain("SYS_setHIntCallback(retro_on_hblank);");
    expect(mdCode).toContain("static void retro_on_dma_done(void) {");

    expect(snesCode).toContain("static void retro_on_vblank(void) {");
    expect(snesCode).toContain("nmiSet(retro_on_vblank);");
    expect(snesCode).toContain("irqInit(); irqSet(IRQ_HBLANK, retro_on_hblank);");
    expect(snesCode).toContain("dmaSetCallback(retro_on_dma_done);");
  });

  it("gera C deterministico para um jogo Mega Drive criado 100% por nodes", () => {
    const code = compileGraphToC(GRAPH_NOCODE_MD_GAME, "NoCodePlatformer", "megadrive");
    const secondPass = compileGraphToC(GRAPH_NOCODE_MD_GAME, "NoCodePlatformer", "megadrive");

    expect(secondPass).toBe(code);
    expect(code).toContain("SPR_addSprite(&player, 40, 96");
    expect(code).toContain("VDP_setTileMapXY(BG_A");
    expect(code).toContain("JOY_readJoypad(JOY_1) & BUTTON_RIGHT");
    expect(code).toContain("logic_var_player_vx = 2");
    expect(code).toContain("SPR_setPosition(spr_player, 40, 96)");
    expect(code).toContain("SPR_setAnim(spr_player, ANIM_RUN)");
    expect(code).toContain("VDP_setHorizontalScroll(BG_A, SPR_getX(spr_player) - 160)");
    expect(code).toContain("Hardware budget check: VRAM 64KB, sprites 80, sprites/scanline 20");
    expect(code).toContain("SND_startPlayPCM(SFX_STEP");
  });

  it("emite matcher deterministico por ring buffer para input_command no Mega Drive", () => {
    const code = compileGraphToC(GRAPH_INPUT_COMMAND, "FightDemo", "megadrive");

    expect(code).toContain("rds_input_push_frame");
    expect(code).toContain("static const RdsInputCommandStep rds_cmd_hadouken_steps[]");
    expect(code).toContain("{ 2, 0 }");
    expect(code).toContain("{ 3, 0 }");
    expect(code).toContain("{ 6, 0 }");
    expect(code).toContain("{ 0, BUTTON_A }");
    expect(code).toContain("if (rds_input_match_command(rds_cmd_hadouken_steps, 4, 15))");
    expect(code).toContain("SPR_setAnim(spr_player, ANIM_FIREBALL)");
  });

  it("marca tokens nao suportados como erro de compilacao acionavel", () => {
    const graph: NodeGraph = {
      nodes: [
        node("update", "event_update"),
        node("broken", "input_command", {
          command_id: "broken",
          display_name: "Broken",
          notation: "~30,_6,_P",
          max_frames: 18,
          pad: "JOY_1",
          button_profile: "megadrive",
          target: "player",
        }),
      ],
      edges: [edge("broken_edge", "update", "broken")],
    };

    const code = compileGraphToC(graph, "BrokenCommand", "megadrive");

    expect(code).toContain('#error "Unsupported input_command tokens for broken: ~30"');
  });
});

describe("compileGraphToC — valores negativos (regressão bug regex)", () => {
  it("emite dx negativo corretamente para Mega Drive", () => {
    const graph: NodeGraph = {
      nodes: [node("n1", "event_start"), node("n2", "sprite_move", { target: "enemy", dx: -3, dy: -5 })],
      edges: [edge("e1", "n1", "n2")],
    };
    const code = compileGraphToC(graph, "Test", "megadrive");
    expect(code).toContain("+ -3");
    expect(code).toContain("+ -5");
  });
});

// ── parseCToNodes ─────────────────────────────────────────────────────────────
// parseCToNodes retorna ParsedNode[] (array direto, não { nodes, edges })

describe("parseCToNodes", () => {
  it("retorna array com event_start para qualquer código C", () => {
    const nodes = parseCToNodes("int main() {}");
    expect(Array.isArray(nodes)).toBe(true);
    expect(nodes.some((n) => n.type === "event_start")).toBe(true);
  });

  it("detecta chamadas SPR_setPosition e cria nó sprite_move (dx positivo)", () => {
    const code = "    SPR_setPosition(spr_player, SPR_getX(spr_player) + 2, SPR_getY(spr_player) + 0);";
    const nodes = parseCToNodes(code);
    expect(nodes.some((n) => n.type === "sprite_move")).toBe(true);
  });

  it("detecta SPR_setPosition com dx negativo (regressão bug regex)", () => {
    const code = "    SPR_setPosition(spr_enemy, SPR_getX(spr_enemy) + -3, SPR_getY(spr_enemy) + -5);";
    const nodes = parseCToNodes(code);
    const moveNode = nodes.find((n) => n.type === "sprite_move");
    expect(moveNode).toBeDefined();
    expect(moveNode?.params.dx).toBe(-3);
    expect(moveNode?.params.dy).toBe(-5);
  });

  it("round-trip SNES: compila effect_parallax e re-parse bgSetScroll → effect_parallax", () => {
    const graph: NodeGraph = {
      nodes: [
        node("n1", "event_start"),
        node("n2", "effect_parallax", { layer: "A", speed_x: 2, speed_y: 0 }),
      ],
      edges: [edge("e1", "n1", "n2")],
    };
    const code = compileGraphToC(graph, "Test", "snes");
    expect(code).toContain("bgSetScroll");
    const parsed = parseCToNodes(code);
    const parallaxNode = parsed.find((n) => n.type === "effect_parallax");
    expect(parallaxNode).toBeDefined();
    expect(parallaxNode?.params.layer).toBe("A");
    expect(parallaxNode?.params.speed_x).toBe(2);
  });

  it("round-trip SNES: compila action_sound e re-parse SPC_playSFX → action_sound", () => {
    const graph: NodeGraph = {
      nodes: [
        node("n1", "event_start"),
        node("n2", "action_sound", { sfx: "jump" }),
      ],
      edges: [edge("e1", "n1", "n2")],
    };
    const code = compileGraphToC(graph, "Test", "snes");
    expect(code).toContain("SPC_playSFX(SFX_JUMP");
    const parsed = parseCToNodes(code);
    const soundNode = parsed.find((n) => n.type === "action_sound");
    expect(soundNode).toBeDefined();
    expect(soundNode?.params.sfx).toBe("jump");
  });

  it("round-trip MD: compila scroll_tilemap e re-parse VDP_setHorizontalScroll → scroll_tilemap", () => {
    const graph: NodeGraph = {
      nodes: [
        node("n1", "event_start"),
        node("n2", "scroll_tilemap", { layer: "BG_A", dx: 2, dy: 0 }),
      ],
      edges: [edge("e1", "n1", "n2")],
    };
    const code = compileGraphToC(graph, "Test", "megadrive");
    expect(code).toContain("VDP_setHorizontalScroll");
    expect(code).toContain("tm_scroll_x_BG_A += 2");
    const parsed = parseCToNodes(code);
    const tmNode = parsed.find((n) => n.type === "scroll_tilemap");
    expect(tmNode).toBeDefined();
    expect(tmNode?.params.layer).toBe("BG_A");
    expect(tmNode?.params.dx).toBe(2);
  });

  it("round-trip SNES: compila scroll_tilemap e re-parse bgSetScroll → scroll_tilemap", () => {
    const graph: NodeGraph = {
      nodes: [
        node("n1", "event_start"),
        node("n2", "scroll_tilemap", { layer: "1", dx: 3, dy: 1 }),
      ],
      edges: [edge("e1", "n1", "n2")],
    };
    const code = compileGraphToC(graph, "Test", "snes");
    expect(code).toContain("bgSetScroll");
    expect(code).toContain("tm_scroll_x_1 += 3");
    const parsed = parseCToNodes(code);
    const tmNode = parsed.find((n) => n.type === "scroll_tilemap");
    expect(tmNode).toBeDefined();
    expect(tmNode?.params.dx).toBe(3);
    expect(tmNode?.params.dy).toBe(1);
  });

  it("round-trip MD: compila move_camera e re-parse VDP_setHorizontalScroll/VDP_setVerticalScroll → move_camera", () => {
    const graph: NodeGraph = {
      nodes: [
        node("n1", "event_start"),
        node("n2", "move_camera", { target: "cam", x: 64, y: 32 }),
      ],
      edges: [edge("e1", "n1", "n2")],
    };
    const code = compileGraphToC(graph, "Test", "megadrive");
    expect(code).toContain("VDP_setHorizontalScroll(BG_A, 64)");
    expect(code).toContain("VDP_setVerticalScroll(BG_A, 32)");
    const parsed = parseCToNodes(code);
    const camNode = parsed.find((n) => n.type === "move_camera");
    expect(camNode).toBeDefined();
    expect(camNode?.params.x).toBe(64);
    expect(camNode?.params.y).toBe(32);
    expect(camNode?.params.target).toBe("cam");
  });

  it("round-trip SNES: compila move_camera e re-parse bgSetScroll(0,...) → move_camera", () => {
    const graph: NodeGraph = {
      nodes: [
        node("n1", "event_start"),
        node("n2", "move_camera", { target: "cam", x: 128, y: 0 }),
      ],
      edges: [edge("e1", "n1", "n2")],
    };
    const code = compileGraphToC(graph, "Test", "snes");
    expect(code).toContain("bgSetScroll(0, 128, 0)");
    const parsed = parseCToNodes(code);
    const camNode = parsed.find((n) => n.type === "move_camera");
    expect(camNode).toBeDefined();
    expect(camNode?.params.x).toBe(128);
    expect(camNode?.params.target).toBe("cam");
  });

  it("parseia atribuicao de var_set emitida pelo compilador", () => {
    const code = compileGraphToC(GRAPH_LOGIC_VARS, "LogicVars", "megadrive");
    const parsed = parseCToNodes(code);
    const setNode = parsed.find((current) => current.type === "var_set");
    expect(setNode).toBeDefined();
    expect(setNode?.params.var_name).toBe("score");
  });
});
