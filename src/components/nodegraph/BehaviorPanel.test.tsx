import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Entity } from "../../core/ipc/sceneService";
import { useEditorStore } from "../../core/store/editorStore";
import NodeGraphEditor, { deserializeNodeGraph, serializeNodeGraph, type NodeGraph } from "./NodeGraphEditor";

const mocks = vi.hoisted(() => ({ persistActiveScene: vi.fn(), resolveScenePrefabs: vi.fn() }));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  convertFileSrc: (path: string) => `asset://${path}`,
}));
vi.mock("../../core/scenePersistence", () => ({ persistActiveScene: mocks.persistActiveScene, registerPendingEditFlusher: () => () => undefined }));
vi.mock("../../core/ipc/projectService", () => ({ openProjectSourcePath: vi.fn() }));
vi.mock("../../core/ipc/sceneService", () => ({
  resolveScenePrefabs: mocks.resolveScenePrefabs,
  parseSceneJson: (sceneJson?: string | null) => (sceneJson ? JSON.parse(sceneJson) : null),
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const scoreGraph: NodeGraph = deserializeNodeGraph(
  JSON.stringify({ version: 1, nodes: [{ id: "score", type: "var_set", label: "score", x: 0, y: 0, params: { var_name: "reference_score", value: 0 } }], edges: [] })
);
const fox = (id: string, extra: Partial<Entity["components"]> = {}): Entity => ({
  entity_id: id,
  display_name: id === "player" ? "Raposa" : `Raposa ${id}`,
  prefab: null,
  transform: { x: 0, y: 0 },
  components: {
    sprite: { asset: "assets/fox.png", frame_width: 32, frame_height: 32, animations: { idle: { frames: [0], fps: 8, loop: true }, jump: { frames: [1], fps: 8, loop: false } } },
    physics: { gravity: true, gravity_strength: 6, friction: 1, bounce: 0 },
    collision: { shape: "aabb", width: 14, height: 32, solid: true, collides_with: [] },
    audio: { sfx: { jump: "a.wav" } },
    ...extra,
  },
});
const scene = () => ({
  scene_id: "main",
  display_name: "Main",
  entities: [
    fox("player", { logic: { graph: serializeNodeGraph(scoreGraph) } }),
    fox("fox_2"),
    { entity_id: "gate", display_name: "Portao", prefab: null, transform: { x: 0, y: 0 }, components: { collision: { shape: "aabb", width: 8, height: 32, solid: true, collides_with: [] } } },
    { entity_id: "camera", prefab: null, transform: { x: 0, y: 0 }, components: {} },
  ],
  background_layers: [],
  palettes: [],
});
const graphOf = (entityId: string) =>
  deserializeNodeGraph(useEditorStore.getState().activeScene?.entities.find((entity) => entity.entity_id === entityId)?.components.logic?.graph);

describe("BehaviorPanel through the NodeGraph editor", () => {
  let container: HTMLDivElement;
  let root: Root;
  const q = <T extends HTMLElement = HTMLElement>(testId: string) => container.querySelector<T>(`[data-testid='${testId}']`);
  const click = async (testId: string) => {
    const element = q(testId);
    if (!element) throw new Error(`missing ${testId}`);
    await act(async () => {
      element.click();
      await flush();
    });
  };
  const setField = async (key: string, value: string) => {
    const element = q<HTMLInputElement | HTMLSelectElement>(`behavior-param-${key}`)!;
    await act(async () => {
      const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
      element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
      await flush();
    });
  };
  const select = async (entityId: string) => {
    await act(async () => {
      useEditorStore.setState({ selectedEntityId: entityId });
      await flush();
      await flush();
    });
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.persistActiveScene.mockResolvedValue(true);
    mocks.resolveScenePrefabs.mockResolvedValue({ ok: false, error: "", scene_json: "" });
    const initial = scene();
    useEditorStore.setState({
      activeProjectDir: "/tmp/p",
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
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    container.remove();
  });

  it("applies, edits, undoes and removes behaviors on two entities independently", async () => {
    // Instancia 1: jogador, velocidade 1.
    await click("behavior-add-platform_movement");
    expect(q<HTMLSelectElement>("behavior-param-target")!.value).toBe("player");
    await setField("speed", "1");
    expect(q("behavior-summary")!.textContent).toContain("Raposa anda 1 px");
    await click("behavior-apply");
    const first = graphOf("player").behaviors ?? [];

    // Instancia 2: segunda entidade, controles e velocidade diferentes.
    await select("fox_2");
    await click("behavior-add-platform_movement");
    expect(q<HTMLSelectElement>("behavior-param-target")!.value).toBe("fox_2");
    await setField("speed", "3");
    await setField("right_button", "BUTTON_C");
    await setField("left_button", "");
    await setField("jump_button", "BUTTON_START");
    // Referencia invalida recusada com mensagem e botao desabilitado.
    await setField("speed", "12");
    expect(q("behavior-errors")!.textContent).toContain("entre 1 e 8");
    expect(q<HTMLButtonElement>("behavior-apply")!.disabled).toBe(true);
    await setField("speed", "3");
    await click("behavior-apply");
    await act(async () => {
      await wait(700);
    });
    const second = graphOf("fox_2").behaviors!;
    expect(second).toHaveLength(1);
    expect(second[0].params).toMatchObject({ target: "fox_2", speed: 3, right_button: "BUTTON_C", jump_button: "BUTTON_START" });
    const move2 = graphOf("fox_2").nodes.find((node) => node.id === `${second[0].id}__right_move`)!;
    expect(move2.params).toMatchObject({ target: "fox_2", dx: 3 });

    // Editar a segunda; a primeira (outra entidade) nao muda.
    const playerBefore = serializeNodeGraph(graphOf("player"));
    await click(`behavior-edit-${second[0].id}`);
    await setField("speed", "5");
    await click("behavior-apply");
    await act(async () => {
      await wait(700);
    });
    expect(graphOf("fox_2").nodes.find((node) => node.id === `${second[0].id}__right_move`)!.params.dx).toBe(5);
    expect(serializeNodeGraph(graphOf("player"))).toBe(playerBefore);
    expect(first.every((instance) => instance.params.target === "player")).toBe(true);

    // Desfazer/refazer a edicao.
    await click("nodegraph-undo");
    await act(async () => {
      await wait(700);
    });
    expect(graphOf("fox_2").nodes.find((node) => node.id === `${second[0].id}__right_move`)!.params.dx).toBe(3);
    await click("nodegraph-redo");
    await act(async () => {
      await wait(700);
    });
    expect(graphOf("fox_2").nodes.find((node) => node.id === `${second[0].id}__right_move`)!.params.dx).toBe(5);

    // Remover a da segunda preserva a do jogador.
    await click(`behavior-remove-${second[0].id}`);
    await click("behavior-remove-confirm");
    await act(async () => {
      await wait(700);
    });
    expect(graphOf("fox_2").behaviors ?? []).toEqual([]);
    expect(serializeNodeGraph(graphOf("player"))).toBe(playerBefore);
  });

  it("keeps an edit when the user switches entity before the autosave debounce", async () => {
    await click("behavior-add-platform_movement");
    await click("behavior-apply");
    await select("fox_2"); // imediatamente, sem esperar os 600 ms
    await act(async () => {
      await wait(700);
    });
    expect(graphOf("player").behaviors).toHaveLength(1);
    await select("player");
    expect(container.querySelectorAll("[data-testid^='behavior-instance-']")).toHaveLength(1);
  });

  it("asks for confirmation before adding a second movement to the same entity", async () => {
    await click("behavior-add-platform_movement");
    await click("behavior-apply");
    await click("behavior-add-platform_movement");
    expect(q("behavior-conflicts")!.textContent).toContain("ja move esta entidade");
    expect(q<HTMLButtonElement>("behavior-apply")!.disabled).toBe(true);
    await click("behavior-confirm-conflicts");
    expect(q<HTMLButtonElement>("behavior-apply")!.disabled).toBe(false);
  });

  it("builds a gated passage from a movement and refuses removing the movement first", async () => {
    await click("behavior-add-platform_movement");
    await click("behavior-apply");
    await click("behavior-add-gated_passage");
    expect(q<HTMLSelectElement>("behavior-param-blocker")!.value).toBe("fox_2");
    await setField("blocker", "gate");
    expect(q<HTMLSelectElement>("behavior-param-state_variable")!.value).toBe("reference_score");
    await setField("threshold", "12");
    expect(q("behavior-summary")!.textContent).toContain("reference_score >= 12");
    await click("behavior-apply");
    const current = container.querySelectorAll("[data-testid^='behavior-instance-']");
    expect(current).toHaveLength(2);
    const moveId = current[0].getAttribute("data-testid")!.replace("behavior-instance-", "");
    await click(`behavior-remove-${moveId}`);
    expect(q("behavior-errors")!.textContent).toContain("depende");
    expect(q<HTMLButtonElement>("behavior-remove-confirm")!.disabled).toBe(true);
  });
});
