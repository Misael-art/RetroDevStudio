import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import HierarchyPanel from "./HierarchyPanel";
import { useEditorStore } from "../../core/store/editorStore";

const mocks = vi.hoisted(() => ({
  listScenes: vi.fn(),
  getSceneData: vi.fn(),
  switchScene: vi.fn(),
  createScene: vi.fn(),
  hydrateSceneResult: vi.fn(),
  persistActiveScene: vi.fn(),
  listProjectAssets: vi.fn(),
}));

vi.mock("../../core/ipc/sceneService", () => ({
  listScenes: mocks.listScenes,
  getSceneData: mocks.getSceneData,
  switchScene: mocks.switchScene,
  createScene: mocks.createScene,
}));

vi.mock("../../core/scenePersistence", () => ({
  hydrateSceneResult: mocks.hydrateSceneResult,
  persistActiveScene: mocks.persistActiveScene,
}));

vi.mock("../../core/ipc/toolsService", () => ({
  listProjectAssets: mocks.listProjectAssets,
}));

function flush() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (element) => element.textContent?.trim() === label
  );

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`);
  }

  return button;
}

describe("HierarchyPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.resetAllMocks();

    const emptyScene = {
      scene_id: "main",
      display_name: "Main",
      entities: [],
      background_layers: [],
      layers: [],
      palettes: [],
    };

    useEditorStore.setState({
      activeProjectDir: "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy",
      activeProjectName: "Mega Dummy",
      activeTarget: "megadrive",
      activeScenePath: "scenes/main.json",
      selectedEntityId: null,
      activeScene: emptyScene,
      activeSceneSource: emptyScene,
      activeViewportTab: "scene",
      emulatorLoaded: false,
      hwStatus: null,
      sceneRevision: 1,
      hwValidationState: "idle",
      hwValidatedRevision: 0,
      hwValidationError: null,
      hwValidationRefreshTick: 0,
      undoStack: [],
      redoStack: [],
      pendingHistorySnapshot: null,
      emulPaused: false,
      consoleEntries: [],
      consoleVisible: true,
      projectSourceKind: "imported_sgdk",
      projectLegacyIndex: null,
    });

    mocks.listScenes.mockResolvedValue([
      {
        path: "scenes/main.json",
        scene_id: "main",
        display_name: "Main",
      },
    ]);
    mocks.getSceneData.mockResolvedValue({
      ok: true,
      error: "",
      scene_json: JSON.stringify(emptyScene),
      project_name: "Mega Dummy",
      target: "megadrive",
      scene_path: "scenes/main.json",
    });
    mocks.switchScene.mockResolvedValue({
      ok: true,
      error: "",
      scene_json: JSON.stringify(emptyScene),
      project_name: "Mega Dummy",
      target: "megadrive",
      scene_path: "scenes/main.json",
    });
    mocks.hydrateSceneResult.mockImplementation(async (_projectDir: string, result: { scene_json: string }) => {
      const scene = JSON.parse(result.scene_json);
      return {
        sourceScene: scene,
        resolvedScene: scene,
      };
    });
    mocks.createScene.mockResolvedValue({
      path: "scenes/main.json",
      scene_id: "main",
      display_name: "Main",
    });
    mocks.persistActiveScene.mockResolvedValue(true);
    mocks.listProjectAssets.mockResolvedValue([
      {
        relative_path: "assets/sprites/onboarding_player.ppm",
        absolute_path: "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy/assets/sprites/onboarding_player.ppm",
        kind: "image",
      },
    ]);

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(<HierarchyPanel />);
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

  it("creates a starter sprite from the empty-scene CTA", async () => {
    expect(container.querySelector("[data-testid='hierarchy-scene-notice']")?.textContent).toContain(
      "Cena importada"
    );
    expect(container.querySelector("[data-testid='hierarchy-scene-summary']")?.textContent).toContain(
      "Cenas: 1"
    );
    expect(container.querySelector("[data-testid='hierarchy-scene-summary']")?.textContent).toContain(
      "Entidades: 0"
    );

    await act(async () => {
      findButton(container, "Sprite Inicial").click();
      await flush();
      await flush();
    });

    const state = useEditorStore.getState();
    expect(state.activeScene?.entities).toHaveLength(1);
    expect(state.selectedEntityId).toBe("onboarding_player");
    expect(state.activeScene?.entities[0].components.sprite).toMatchObject({
      asset: "assets/sprites/onboarding_player.ppm",
      frame_width: 16,
      frame_height: 16,
    });
    expect(state.activeScene?.entities[0].components.logic?.graph).toContain("\"type\":\"event_start\"");
    expect(mocks.persistActiveScene).toHaveBeenCalledWith(
      "F:/Projects/RetroDevStudio/tests/fixtures/projects/megadrive_dummy",
      "Hierarchy",
      "Sprite 'onboarding_player' criado a partir de 'assets/sprites/onboarding_player.ppm'."
    );
    expect(container.querySelector("[data-testid='hierarchy-scene-summary']")?.textContent).toContain(
      "Entidades: 1"
    );
  });

  it("shows a no-match message when the hierarchy filter hides every item", async () => {
    await act(async () => {
      findButton(container, "Sprite Inicial").click();
      await flush();
      await flush();
    });

    const filterInput = container.querySelector(
      "input[placeholder='Buscar...']"
    ) as HTMLInputElement | null;

    expect(filterInput).toBeInstanceOf(HTMLInputElement);

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set;
      valueSetter?.call(filterInput, "inexistente");
      filterInput!.dispatchEvent(new Event("input", { bubbles: true }));
      await flush();
    });

    expect(container.textContent).toContain('Nenhum item corresponde a "inexistente" na cena ativa.');
  });

  it("surfaces imported roles and keeps the guide focus on the authored entry entity", async () => {
    await act(async () => {
      const scene = {
        scene_id: "main",
        display_name: "Main",
        entities: [
          {
            entity_id: "stage_tilemap",
            display_name: "Stage Tilemap",
            prefab: null,
            transform: { x: 0, y: 0 },
            components: {
              tilemap: {
                tileset: "assets/tilesets/stage.png",
                map_width: 4,
                map_height: 4,
                scroll_x: 0,
                scroll_y: 0,
                cells: [],
              },
            },
          },
          {
            entity_id: "hero",
            display_name: "Hero",
            prefab: null,
            transform: { x: 16, y: 24 },
            components: {
              sprite: {
                asset: "assets/sprites/hero.png",
                frame_width: 16,
                frame_height: 16,
                palette_slot: 0,
                animations: {},
              },
              logic: {
                imported_semantics: {
                  source: "sgdk_phase_d",
                  entity_role: "player_avatar",
                  gameplay_class: "platformer_horizontal_scroller_signals",
                  confidence: "medium",
                  role_reason: "sprite primario com leitura JOY_* no agregado",
                  driver_functions: ["player_tick"],
                  source_paths: ["src/player.c"],
                  audit_flags: ["primary_sprite"],
                },
              },
            },
          },
        ],
        background_layers: [],
        layers: [],
        palettes: [],
      };

      useEditorStore.setState({
        activeScene: scene,
        activeSceneSource: scene,
      });
      await flush();
      await flush();
    });

    const roleChip = container.querySelector("[data-testid='hierarchy-imported-role-hero']");
    expect(roleChip?.textContent).toBe("PLR");
    expect(roleChip?.getAttribute("title")).toContain("Jogador");
    expect(container.textContent).toContain("Entrada");
    expect(container.textContent).toContain("Hero");
  });

  it("shows compact logic import signals without long diagnostic chips", async () => {
    await act(async () => {
      const scene = {
        scene_id: "main",
        display_name: "Main",
        entities: [
          {
            entity_id: "hero",
            display_name: "Hero",
            prefab: null,
            transform: { x: 16, y: 24 },
            components: {
              sprite: {
                asset: "assets/sprites/hero.png",
                frame_width: 16,
                frame_height: 16,
                palette_slot: 0,
                animations: {},
              },
              logic: {
                graph_ref: "graphs/sgdk_import_hero.json",
                imported_semantics: {
                  source: "sgdk_semantic_extractor",
                  extraction_kind: "fsm",
                  confidence: "high",
                  converted_nodes_count: 4,
                  bridge_count: 1,
                  states_detected: 2,
                  transitions_detected: 3,
                  source_paths: ["src/player.c"],
                },
              },
            },
          },
          {
            entity_id: "enemy",
            display_name: "Enemy",
            prefab: null,
            transform: { x: 48, y: 24 },
            components: {
              sprite: {
                asset: "assets/sprites/enemy.png",
                frame_width: 16,
                frame_height: 16,
                palette_slot: 0,
                animations: {},
              },
              logic: {
                graph_ref: "graphs/sgdk_import_enemy.json",
                imported_semantics: {
                  source: "sgdk_phase_d",
                  confidence: "low",
                  converted_nodes_count: 0,
                  bridge_count: 2,
                  status: "bridge_only",
                },
              },
            },
          },
        ],
        background_layers: [],
        layers: [],
        palettes: [],
      };

      useEditorStore.setState({
        activeScene: scene,
        activeSceneSource: scene,
      });
      await flush();
      await flush();
    });

    const heroSignal = container.querySelector("[data-testid='hierarchy-logic-signal-hero']");
    const enemySignal = container.querySelector("[data-testid='hierarchy-logic-signal-enemy']");

    expect(heroSignal?.textContent).toBe("Logic: FSM parcial");
    expect(heroSignal?.getAttribute("title")).toContain("graph_ref: graphs/sgdk_import_hero.json");
    expect(heroSignal?.getAttribute("title")).toContain("converted_nodes_count: 4");
    expect(enemySignal?.textContent).toBe("Logic: Bridge");
  });

  it("regressao: hidratacao inicial via beforeEach aplica a cena corretamente sem guard bloquear", async () => {
    const state = useEditorStore.getState();
    expect(state.activeScene).not.toBeNull();
    expect(state.activeScene?.scene_id).toBe("main");
    expect(state.activeScenePath).toBe("scenes/main.json");
  });

  it("regressao: hidratacao tardia do HierarchyPanel nao sobrescreve draft injetado", async () => {
    const hydrationStarted = createDeferred();
    const deferredHydrate = createDeferred();

    mocks.hydrateSceneResult.mockImplementationOnce(async () => {
      hydrationStarted.resolve();
      await deferredHydrate.promise;
      return {
        sourceScene: { scene_id: "old", entities: [], background_layers: [], layers: [], palettes: [] },
        resolvedScene: { scene_id: "old", entities: [], background_layers: [], layers: [], palettes: [] },
      };
    });

    const newProjectScene = {
      scene_id: "new_scene",
      entities: [],
      background_layers: [],
      layers: [],
      palettes: [],
    };

    mocks.listScenes.mockResolvedValueOnce([
      { path: "scenes/new.json", scene_id: "new_scene", display_name: "New" },
    ]);

    mocks.getSceneData.mockResolvedValueOnce({
      ok: true, error: "",
      scene_json: JSON.stringify(newProjectScene),
      project_name: "New", target: "megadrive",
      scene_path: "scenes/new.json",
    });

    const draftScene = {
      scene_id: "draft",
      display_name: "Draft Injetado",
      entities: [
        { entity_id: "injected", display_name: "Injected", prefab: null, transform: { x: 0, y: 0 }, components: {} },
      ],
      background_layers: [],
      layers: [],
      palettes: [],
    };

    // Trigger the effect by changing activeProjectDir
    await act(async () => {
      useEditorStore.setState({ activeProjectDir: "/projects/new", activeScene: null, activeSceneSource: null, activeScenePath: "" });
      await hydrationStarted.promise;
    });

    const { sceneRevision: revBeforeDraft } = useEditorStore.getState();

    // Inject draft while hydration is still pending
    await act(async () => {
      useEditorStore.setState({ activeScene: draftScene, activeSceneSource: draftScene, sceneRevision: revBeforeDraft + 1 });
      await flush();
    });

    const { sceneRevision: revAfterDraft, activeScene: sceneAfterDraft } = useEditorStore.getState();
    expect(revAfterDraft).toBe(revBeforeDraft + 1);
    expect(sceneAfterDraft?.scene_id).toBe("draft");

    // Resolve the pending hydration
    await act(async () => {
      deferredHydrate.resolve();
      await flush();
      await flush();
    });

    const {
      sceneRevision: revAfterHydrate,
      activeScene: sceneAfterHydrate,
      activeSceneSource: sourceAfterHydrate,
      activeScenePath: pathAfterHydrate,
    } = useEditorStore.getState();
    expect(revAfterHydrate).toBe(revBeforeDraft + 1);
    expect(sceneAfterHydrate?.scene_id).toBe("draft");
    expect(sourceAfterHydrate?.scene_id).toBe("draft");
    expect(pathAfterHydrate).toBe("");
    expect(sceneAfterHydrate?.entities[0].entity_id).toBe("injected");
  });

  it("regressao: erro tardio de hidratacao nao limpa o draft novo", async () => {
    const hydrationStarted = createDeferred();
    const deferredHydrate = createDeferred();
    mocks.hydrateSceneResult.mockImplementationOnce(async () => {
      hydrationStarted.resolve();
      await deferredHydrate.promise;
      throw new Error("falha antiga");
    });

    await act(async () => {
      useEditorStore.setState({ activeProjectDir: "/projects/error", activeScene: null, activeSceneSource: null, activeScenePath: "" });
      await hydrationStarted.promise;
    });

    const revisionAtStart = useEditorStore.getState().sceneRevision;
    const draftScene = { scene_id: "draft_after_error", entities: [], background_layers: [], layers: [], palettes: [] };
    useEditorStore.setState({
      activeScene: draftScene,
      activeSceneSource: draftScene,
      activeScenePath: "scenes/draft.json",
      sceneRevision: revisionAtStart + 1,
    });

    await act(async () => {
      deferredHydrate.resolve();
      await flush();
    });

    const state = useEditorStore.getState();
    expect(state.activeScene?.scene_id).toBe("draft_after_error");
    expect(state.activeSceneSource?.scene_id).toBe("draft_after_error");
    expect(state.activeScenePath).toBe("scenes/draft.json");
    expect(state.sceneRevision).toBe(revisionAtStart + 1);
  });

  it("regressao: troca de projeto ignora resposta de hidratacao tardia do projeto anterior", async () => {
    const hydrationAStarted = createDeferred();
    const deferredA = createDeferred();
    const hydrationBStarted = createDeferred();
    const deferredB = createDeferred();

    const projectAScene = {
      scene_id: "project_a",
      entities: [],
      background_layers: [],
      layers: [],
      palettes: [],
    };

    const projectBScene = {
      scene_id: "project_b",
      entities: [],
      background_layers: [],
      layers: [],
      palettes: [],
    };

    mocks.hydrateSceneResult
      .mockImplementationOnce(async () => {
        hydrationAStarted.resolve();
        await deferredA.promise;
        return { sourceScene: projectAScene, resolvedScene: projectAScene };
      })
      .mockImplementationOnce(async () => {
        hydrationBStarted.resolve();
        await deferredB.promise;
        return { sourceScene: projectBScene, resolvedScene: projectBScene };
      });

    mocks.listScenes
      .mockResolvedValueOnce([{ path: "scenes/a.json", scene_id: "project_a", display_name: "A" }])
      .mockResolvedValueOnce([{ path: "scenes/b.json", scene_id: "project_b", display_name: "B" }]);

    mocks.getSceneData
      .mockResolvedValueOnce({
        ok: true, error: "", scene_json: JSON.stringify(projectAScene),
        project_name: "A", target: "megadrive", scene_path: "scenes/a.json",
      })
      .mockResolvedValueOnce({
        ok: true, error: "", scene_json: JSON.stringify(projectBScene),
        project_name: "B", target: "megadrive", scene_path: "scenes/b.json",
      });

    // Render with project A
    await act(async () => {
      useEditorStore.setState({ activeProjectDir: "/projects/a" });
      await hydrationAStarted.promise;
    });

    // Switch to project B while A's hydration is still pending
    const { sceneRevision: revA } = useEditorStore.getState();
    useEditorStore.setState({
      activeProjectDir: "/projects/b",
      activeScene: null,
      activeSceneSource: null,
      activeScenePath: "",
      sceneRevision: revA + 1,
    });

    await act(async () => {
      await hydrationBStarted.promise;
    });

    // Resolve A's old hydration
    await act(async () => {
      deferredA.resolve();
      await flush();
      await flush();
    });

    const stateAfterA = useEditorStore.getState();
    expect(stateAfterA.activeScene).toBeNull();

    // Resolve B's hydration
    await act(async () => {
      deferredB.resolve();
      await flush();
      await flush();
    });

    const stateAfterB = useEditorStore.getState();
    expect(stateAfterB.activeScene?.scene_id).toBe("project_b");
  });

  it("regressao: ABA rejeita a resposta velha mesmo quando a revisao retorna a zero", async () => {
    const a1Started = createDeferred();
    const releaseA1 = createDeferred();
    const a2Started = createDeferred();
    const releaseA2 = createDeferred();
    const sceneAOld = { scene_id: "a_old", entities: [], background_layers: [], layers: [], palettes: [] };
    const sceneANew = { scene_id: "a_new", entities: [], background_layers: [], layers: [], palettes: [] };
    const sceneB = { scene_id: "b", entities: [], background_layers: [], layers: [], palettes: [] };

    mocks.hydrateSceneResult
      .mockImplementationOnce(async () => {
        a1Started.resolve();
        await releaseA1.promise;
        return { sourceScene: sceneAOld, resolvedScene: sceneAOld };
      })
      .mockResolvedValueOnce({ sourceScene: sceneB, resolvedScene: sceneB })
      .mockImplementationOnce(async () => {
        a2Started.resolve();
        await releaseA2.promise;
        return { sourceScene: sceneANew, resolvedScene: sceneANew };
      });
    mocks.listScenes.mockResolvedValue([{ path: "scenes/main.json", scene_id: "main", display_name: "Main" }]);
    mocks.getSceneData.mockResolvedValue({ ok: true, error: "", scene_json: JSON.stringify(sceneAOld), project_name: "P", target: "megadrive", scene_path: "scenes/main.json" });

    await act(async () => {
      useEditorStore.setState({ activeProjectDir: "/projects/a", activeScene: null, activeSceneSource: null, activeScenePath: "", sceneRevision: 0 });
      await a1Started.promise;
    });
    await act(async () => {
      useEditorStore.setState({ activeProjectDir: "/projects/b", activeScene: null, activeSceneSource: null, activeScenePath: "", sceneRevision: 1 });
      await flush();
    });
    await act(async () => {
      useEditorStore.setState({ activeProjectDir: "/projects/a", activeScene: null, activeSceneSource: null, activeScenePath: "", sceneRevision: 0 });
      await a2Started.promise;
    });

    await act(async () => {
      releaseA1.resolve();
      await flush();
    });
    const afterOldA = useEditorStore.getState();
    expect(afterOldA.activeScene).toBeNull();
    expect(afterOldA.activeSceneSource).toBeNull();
    expect(afterOldA.activeScenePath).toBe("");
    expect(afterOldA.sceneRevision).toBe(0);

    await act(async () => {
      releaseA2.resolve();
      await flush();
    });
    expect(useEditorStore.getState().activeScene?.scene_id).toBe("a_new");
  });

  it("opens the tilemap row editing CTA as a painting workflow and exposes staging provenance", async () => {
    await act(async () => {
      const scene = {
        scene_id: "main",
        display_name: "Main",
        entities: [
          {
            entity_id: "stage_tilemap",
            display_name: "Stage Tilemap",
            prefab: null,
            transform: { x: 0, y: 0 },
            components: {
              tilemap: {
                tileset: "assets/tilesets/stage.png",
                map_width: 8,
                map_height: 4,
                scroll_x: 0,
                scroll_y: 0,
                cells: [],
              },
              logic: {
                imported_semantics: {
                  source: "sgdk_phase_d",
                  entity_role: "support_actor",
                  confidence: "medium",
                  role_reason: "stage helper",
                  audit_flags: ["position:staging_layout"],
                },
              },
            },
          },
        ],
        background_layers: [],
        layers: [],
        palettes: [],
      };

      useEditorStore.setState({
        activeScene: scene,
        activeSceneSource: scene,
        selectedEntityId: null,
      });
      await flush();
      await flush();
    });

    const tilemapRow = Array.from(container.querySelectorAll("li")).find((element) =>
      element.textContent?.includes("Stage Tilemap")
    );

    if (!(tilemapRow instanceof HTMLLIElement)) {
      throw new Error("Tilemap row not found");
    }

    expect(tilemapRow.textContent).toContain("Staging");

    const editButton = Array.from(tilemapRow.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Editar"
    );

    if (!(editButton instanceof HTMLButtonElement)) {
      throw new Error("Tilemap edit button not found");
    }

    await act(async () => {
      editButton.click();
      await flush();
    });

    const state = useEditorStore.getState();
    expect(state.activeViewportTab).toBe("scene");
    expect(state.editorMode).toBe("paint");
    expect(state.activeTilemapId).toBe("stage_tilemap");
    expect(state.activeBrush).toMatchObject({
      kind: "tile",
      assetPath: "assets/tilesets/stage.png",
      tileIndex: 1,
    });
  });
});
