/**
 * nodeCompiler.test.ts — Testes de integração para o compilador Node → C
 *
 * Sprint P9: Vitest — cobre compileGraphToC() para Mega Drive e SNES.
 */

import { describe, it, expect } from "vitest";
import { compileGraphToC, parseCToNodes } from "./nodeCompiler";
import type { NodeGraph } from "../../components/nodegraph/NodeGraphEditor";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const EMPTY_GRAPH: NodeGraph = { nodes: [], edges: [] };

const GRAPH_START_ONLY: NodeGraph = {
  nodes: [{ id: "n1", type: "event_start", x: 0, y: 0, params: {}, ports: { exec: true } }],
  edges: [],
};

const GRAPH_MOVE_MD: NodeGraph = {
  nodes: [
    { id: "n1", type: "event_start", x: 0, y: 0, params: {}, ports: { exec: true } },
    { id: "n2", type: "sprite_move", x: 100, y: 0, params: { target: "player", dx: 2, dy: 0 }, ports: { exec: true } },
  ],
  edges: [
    { id: "e1", fromNode: "n1", fromPort: "exec", toNode: "n2", toPort: "exec" },
  ],
};

const GRAPH_MOVE_SNES: NodeGraph = GRAPH_MOVE_MD;

const GRAPH_SOUND_MD: NodeGraph = {
  nodes: [
    { id: "n1", type: "event_start", x: 0, y: 0, params: {}, ports: { exec: true } },
    { id: "n2", type: "action_sound", x: 100, y: 0, params: { sfx: "jump" }, ports: { exec: true } },
  ],
  edges: [
    { id: "e1", fromNode: "n1", fromPort: "exec", toNode: "n2", toPort: "exec" },
  ],
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

// ── parseCToNodes ─────────────────────────────────────────────────────────────
// parseCToNodes retorna ParsedNode[] (array direto, não { nodes, edges })

describe("parseCToNodes", () => {
  it("retorna array com event_start para qualquer código C", () => {
    const nodes = parseCToNodes("int main() {}");
    expect(Array.isArray(nodes)).toBe(true);
    expect(nodes.some((n) => n.type === "event_start")).toBe(true);
  });

  it("detecta chamadas SPR_setPosition e cria nó sprite_move", () => {
    const code = "    SPR_setPosition(spr_player, SPR_getX(spr_player) + 2 + 0, SPR_getY(spr_player) + 0 + 0);";
    const nodes = parseCToNodes(code);
    expect(nodes.some((n) => n.type === "sprite_move")).toBe(true);
  });
});
