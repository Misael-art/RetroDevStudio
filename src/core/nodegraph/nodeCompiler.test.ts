/**
 * nodeCompiler.test.ts — Testes de integração para o compilador Node → C
 *
 * Sprint P9: Vitest — cobre compileGraphToC() para Mega Drive e SNES.
 */

import { describe, it, expect } from "vitest";
import { compileGraphToC, parseCToNodes } from "./nodeCompiler";
import type { NodeGraph } from "../../components/nodegraph/NodeGraphEditor";

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

// ── compileGraphToC ───────────────────────────────────────────────────────────

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
});
