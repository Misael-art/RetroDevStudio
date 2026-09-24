import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import projectMgrSource from "../../../src-tauri/src/core/project_mgr.rs?raw";
import type { Entity } from "../../core/ipc/sceneService";
import { dispatchGraphHistory } from "../../core/nodegraph/graphHistory";
import { graphSemanticSignature } from "../../core/nodegraph/nodeLayout";
import { useEditorStore } from "../../core/store/editorStore";
import NodeGraphEditor, { deserializeNodeGraph, serializeNodeGraph, type NodeGraph } from "./NodeGraphEditor";

const mocks = vi.hoisted(() => ({
  persistActiveScene: vi.fn(),
  resolveScenePrefabs: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  convertFileSrc: (path: string) => `asset://${path}`,
}));
vi.mock("../../core/scenePersistence", () => ({
  persistActiveScene: mocks.persistActiveScene,
  registerPendingEditFlusher: () => () => undefined,
}));
vi.mock("../../core/ipc/projectService", () => ({ openProjectSourcePath: vi.fn() }));
vi.mock("../../core/ipc/sceneService", () => ({
  resolveScenePrefabs: mocks.resolveScenePrefabs,
  parseSceneJson: (sceneJson?: string | null) => (sceneJson ? JSON.parse(sceneJson) : null),
}));

function referenceGraph(): NodeGraph {
  const source: string = projectMgrSource;
  const start = source.indexOf("serde_json::json!(", source.indexOf("fn reference_platformer_logic_graph()"));
  const end = source.indexOf("\n    });", start);
  return deserializeNodeGraph(source.slice(start + "serde_json::json!(".length, end + "\n    }".length));
}

function entity(entityId: string, graph?: NodeGraph, extra: Partial<Entity["components"]> = {}): Entity {
  return {
    entity_id: entityId,
    display_name: entityId,
    prefab: null,
    transform: { x: 0, y: 0 },
    components: {
      ...(graph ? { logic: { graph: serializeNodeGraph(graph) } } : {}),
      ...extra,
    },
  };
}

function scene(graph: NodeGraph) {
  return {
    scene_id: "main",
    display_name: "Main",
    entities: [
      entity("player", graph, {
        sprite: { asset: "assets/sprites/fox.png", frame_width: 32, frame_height: 32 },
        audio: { sfx: { jump: "assets/sfx/jump.wav", goal_sound: "assets/sfx/goal.wav", victory: "assets/sfx/victory.wav" } },
      }),
      entity("passage_blocker"),
      entity("goal_sensor"),
    ],
    background_layers: [],
    palettes: [],
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function storedGraph(): NodeGraph {
  const player = useEditorStore.getState().activeScene?.entities.find((item) => item.entity_id === "player");
  return deserializeNodeGraph(player?.components.logic?.graph);
}

describe("NodeGraphEditor authoring (reference graph)", () => {
  let container: HTMLDivElement;
  let root: Root;
  const q = <T extends Element = HTMLElement>(testId: string) => container.querySelector<T & Element>(`[data-testid='${testId}']`);
  const click = async (testId: string) => {
    const element = q<HTMLElement>(testId);
    if (!element) throw new Error(`missing ${testId}`);
    await act(async () => {
      element.click();
      await flush();
    });
  };
  const cardPosition = (id: string) => {
    const card = q<HTMLDivElement>(`node-card-${id}`)!;
    return { left: card.style.left, top: card.style.top };
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.persistActiveScene.mockResolvedValue(true);
    mocks.resolveScenePrefabs.mockResolvedValue({ ok: false, error: "not-needed", scene_json: "" });
    const initial = scene(referenceGraph());
    useEditorStore.setState({
      activeProjectDir: "/tmp/ref",
      activeScenePath: "scenes/main.json",
      selectedEntityId: "player",
      activeViewportTab: "logic",
      consoleEntries: [],
      undoStack: [],
      redoStack: [],
      pendingHistorySnapshot: null,
      activeScene: initial,
      activeSceneSource: structuredClone(initial),
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<NodeGraphEditor />);
      await flush();
      await flush();
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    container.remove();
  });

  it("organizes everything visually, persists, and undoes/redoes without changing logic", async () => {
    const original = referenceGraph();
    const before = cardPosition("jump");

    await click("nodegraph-organize-all");
    const report = q("nodegraph-layout-report")!;
    expect(Number(report.dataset.moved)).toBeGreaterThan(10);
    expect(report.dataset.overlaps).toBe("0");
    expect(report.dataset.conflicts).toBe("0");
    const organized = cardPosition("jump");
    expect(organized).not.toEqual(before);

    await act(async () => {
      await wait(700); // autosave debounce
    });
    const saved = storedGraph();
    expect(graphSemanticSignature(saved)).toBe(graphSemanticSignature(original));
    expect(saved.nodes.find((node) => node.id === "jump")!.x).not.toBe(original.nodes.find((node) => node.id === "jump")!.x);
    expect(mocks.persistActiveScene).toHaveBeenCalled();

    // Ctrl+Z global chega ao NodeGraph enquanto ele estiver montado.
    await act(async () => {
      expect(dispatchGraphHistory("undo")).toBe(true);
      await flush();
    });
    expect(cardPosition("jump")).toEqual(before);
    await click("nodegraph-redo");
    expect(cardPosition("jump")).toEqual(organized);
  });

  it("snaps a pending connection to a compatible port, cancels with Escape and connects only on release", async () => {
    const shell = q<HTMLDivElement>("nodegraph-canvas-shell")!;
    const edgeCount = () => container.querySelectorAll("path[data-testid^='nodegraph-edge-']").length;
    const initialEdges = edgeCount();
    const fromPort = q<HTMLDivElement>("node-port-jump_sound-out-exec")!;
    const target = referenceGraph().nodes.find((node) => node.id === "mark_goal")!;

    const startDrag = async () => {
      await act(async () => {
        fromPort.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 0, clientY: 0 }));
        await flush();
      });
      // Perto da entrada exec de "mark_goal" (ancora estimada: y + 100 com a entidade exibida).
      await act(async () => {
        shell.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: target.x + 6, clientY: target.y + 101 }));
        await flush();
      });
    };

    await startDrag();
    expect(q("node-port-mark_goal-in-exec")!.dataset.snapped).toBe("true");
    expect(q("nodegraph-pending-edge")!.dataset.snapped).toBe("true");
    expect(q("nodegraph-connect-hint")!.textContent).toContain("Esc cancela");
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      await flush();
    });
    expect(q("nodegraph-pending-edge")).toBeNull();
    await act(async () => {
      shell.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      await flush();
    });
    expect(edgeCount()).toBe(initialEdges);

    await startDrag();
    await act(async () => {
      shell.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      await flush();
    });
    expect(edgeCount()).toBe(initialEdges + 1);

    // Dado -> execucao e recusado mesmo soltando em cima da porta.
    await act(async () => {
      q("node-port-score_get-out-value")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      await flush();
      q("node-port-open_goal-in-exec")!.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      await flush();
    });
    expect(edgeCount()).toBe(initialEdges + 1);
    expect(useEditorStore.getState().consoleEntries.some((entry) => entry.message.includes("Conexao recusada"))).toBe(true);
  });

  it("groups a behavior, renames, collapses and drags it without touching logic", async () => {
    const original = referenceGraph();
    await act(async () => {
      q("node-card-jump")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
      q<HTMLDivElement>("nodegraph-canvas-shell")!.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      await flush();
    });
    await click("nodegraph-select-behavior");
    expect(q("nodegraph-selection-count")!.textContent).toContain("4 selecionado(s)");
    await click("nodegraph-group-selection");
    const nameInput = container.querySelector<HTMLInputElement>("[data-testid^='nodegraph-group-name-']")!;
    expect(nameInput.value).toBe("Pulo");
    const groupId = nameInput.dataset.testid!.replace("nodegraph-group-name-", "");
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setValue.call(nameInput, "Pulo da raposa");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
      await flush();
    });
    expect(q(`nodegraph-group-header-${groupId}`)!.textContent).toContain("Pulo da raposa");

    await click(`nodegraph-group-collapse-${groupId}`);
    expect(q(`nodegraph-group-box-${groupId}`)!.dataset.collapsed).toBe("true");
    expect(q("node-card-jump")).toBeNull();
    expect(q("node-card-jump_velocity")).toBeNull();

    // Arrastar o cabecalho move os quatro nos juntos.
    const header = q(`nodegraph-group-header-${groupId}`)!;
    const shell = q<HTMLDivElement>("nodegraph-canvas-shell")!;
    await act(async () => {
      header.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 0, clientY: 0 }));
      await flush();
    });
    await act(async () => {
      shell.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 96, clientY: 48 }));
      await flush();
    });
    await act(async () => {
      shell.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      await flush();
      await wait(700);
    });
    const saved = storedGraph();
    expect(graphSemanticSignature(saved)).toBe(graphSemanticSignature(original));
    for (const id of ["update_jump", "jump", "jump_velocity", "jump_sound"]) {
      const a = original.nodes.find((node) => node.id === id)!;
      const b = saved.nodes.find((node) => node.id === id)!;
      expect([b.x - a.x, b.y - a.y]).toEqual([96, 48]);
    }
    expect(saved.groups).toHaveLength(1);
    expect(saved.groups![0]).toMatchObject({ id: groupId, label: "Pulo da raposa", collapsed: true });
    expect([...saved.groups![0].nodeIds].sort()).toEqual(["jump", "jump_sound", "jump_velocity", "update_jump"]);
  });

  it("keeps pinned nodes still when organizing", async () => {
    await act(async () => {
      q("node-card-music")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
      q<HTMLDivElement>("nodegraph-canvas-shell")!.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      await flush();
    });
    await click("nodegraph-pin-selection");
    expect(q("node-card-music")!.dataset.pinned).toBe("true");
    const before = cardPosition("music");
    await click("nodegraph-reset-view");
    const pinnedBefore = { ...before };
    await click("nodegraph-organize-all");
    // A vista muda (enquadrar), entao compara no grafo salvo: o no fixado nao se move.
    await act(async () => {
      await wait(700);
    });
    const saved = storedGraph().nodes.find((node) => node.id === "music")!;
    const original = referenceGraph().nodes.find((node) => node.id === "music")!;
    expect({ x: saved.x, y: saved.y, pinned: saved.pinned }).toEqual({ x: original.x, y: original.y, pinned: true });
    expect(pinnedBefore.left).toBe(`${original.x}px`);
  });

  it("edits the jump button from the rules view and keeps the other behaviors intact", async () => {
    const select = q<HTMLSelectElement>("rule-edit-jump-button")!;
    expect(select.value).toBe("BUTTON_A");
    await act(async () => {
      select.value = "BUTTON_B";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await flush();
      await wait(700);
    });
    expect(q<HTMLSelectElement>("node-param-jump-button")!.value).toBe("BUTTON_B");
    expect(q("node-action-jump")!.textContent).toBe("Ao apertar Botao B (tecla X)");
    const saved = storedGraph();
    const original = referenceGraph();
    expect(saved.nodes.find((node) => node.id === "jump")!.params.button).toBe("BUTTON_B");
    // So o parametro editado mudou.
    const strip = (graph: NodeGraph) => graph.nodes.map((node) => (node.id === "jump" ? { ...node, params: { ...node.params, button: "X" } } : node));
    expect(graphSemanticSignature({ ...saved, nodes: strip(saved) })).toBe(graphSemanticSignature({ ...original, nodes: strip(original) }));
    // O ramo "senao" do limiar aparece em vez de ser escondido.
    expect(q("rule-else-score_threshold")!.textContent).toContain("goal_open = 0");
  });

  it("does not delete the node when Backspace is pressed inside a field", async () => {
    await act(async () => {
      q("node-card-score_threshold")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
      q<HTMLDivElement>("nodegraph-canvas-shell")!.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      await flush();
    });
    const input = q<HTMLInputElement>("node-param-score_threshold-b")!;
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
      await flush();
    });
    expect(q("node-card-score_threshold")).not.toBeNull();
  });

  it("ignores a stale graph_ref hydration that resolves after the user switched entity", async () => {
    let resolveStale: (value: unknown) => void = () => undefined;
    mocks.resolveScenePrefabs.mockImplementationOnce(() => new Promise((resolve) => { resolveStale = resolve; }));
    const staleGraph: NodeGraph = { nodes: [{ ...referenceGraph().nodes[0], id: "stale_only" }], edges: [] };
    const current = useEditorStore.getState().activeScene!;
    const withRef = {
      ...current,
      entities: [
        ...current.entities,
        { ...entity("enemy"), components: { logic: { graph_ref: "graphs/enemy.json" } } },
      ],
    };
    await act(async () => {
      useEditorStore.setState({ activeScene: withRef, activeSceneSource: withRef, selectedEntityId: "enemy" });
      await flush();
    });
    await act(async () => {
      useEditorStore.setState({ selectedEntityId: "player" });
      await flush();
      await flush();
    });
    expect(q("node-card-jump")).not.toBeNull();
    await act(async () => {
      resolveStale({
        ok: true,
        error: "",
        scene_json: JSON.stringify({ ...withRef, entities: [{ ...entity("enemy", staleGraph) }] }),
      });
      await flush();
      await flush();
    });
    expect(q("node-card-stale_only")).toBeNull();
    expect(q("node-card-jump")).not.toBeNull();
  });
});
