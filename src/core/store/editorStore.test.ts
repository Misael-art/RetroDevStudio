/**
 * editorStore.test.ts — Testes de integração para o estado global do editor
 *
 * Sprint P9: Vitest — cobre addEntity, removeEntity, updateEntity.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "./editorStore";
import type { Scene, Entity, BackgroundLayer, SceneLayer } from "../ipc/sceneService";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeLayer(id: string, depth = 0): BackgroundLayer {
  return { layer_id: id, depth, tileset: `${id}.png` };
}

function makeEntity(id: string, x = 0, y = 0): Entity {
  return {
    entity_id: id,
    prefab: id,
    transform: { x, y },
    components: {},
  };
}

const EMPTY_SCENE: Scene = {
  scene_id: "scene_test",
  background_layers: [],
  entities: [],
  palettes: [],
};

// Reseta o store antes de cada teste (Zustand compartilha instância global)
beforeEach(() => {
  useEditorStore.setState({
    activeScene: null,
    activeSceneSource: null,
    selectedEntityId: null,
    sceneRevision: 0,
    hwValidationState: "idle",
    hwValidatedRevision: 0,
    hwValidationError: null,
    undoStack: [],
    redoStack: [],
    pendingHistorySnapshot: null,
  });
});

// ── addEntity ─────────────────────────────────────────────────────────────────

describe("addEntity", () => {
  it("não faz nada se não há cena ativa", () => {
    const { addEntity } = useEditorStore.getState();
    addEntity(makeEntity("e1"));
    expect(useEditorStore.getState().activeScene).toBeNull();
  });

  it("adiciona entidade à cena ativa", () => {
    useEditorStore.setState({ activeScene: { ...EMPTY_SCENE } });
    const { addEntity } = useEditorStore.getState();
    addEntity(makeEntity("hero", 10, 20));
    const { activeScene } = useEditorStore.getState();
    expect(activeScene!.entities).toHaveLength(1);
    expect(activeScene!.entities[0].entity_id).toBe("hero");
    expect(activeScene!.entities[0].transform.x).toBe(10);
  });

  it("acumula múltiplas entidades mantendo imutabilidade", () => {
    useEditorStore.setState({ activeScene: { ...EMPTY_SCENE } });
    // Chama getState() a cada vez para evitar stale closure após cada set()
    useEditorStore.getState().addEntity(makeEntity("a"));
    useEditorStore.getState().addEntity(makeEntity("b"));
    useEditorStore.getState().addEntity(makeEntity("c"));
    expect(useEditorStore.getState().activeScene!.entities).toHaveLength(3);
  });

  it("incrementa sceneRevision ao adicionar entidade", () => {
    useEditorStore.setState({ activeScene: { ...EMPTY_SCENE }, sceneRevision: 3 });
    useEditorStore.getState().addEntity(makeEntity("hero"));
    expect(useEditorStore.getState().sceneRevision).toBe(4);
  });
});

// ── removeEntity ──────────────────────────────────────────────────────────────

describe("removeEntity", () => {
  it("remove entidade pelo id", () => {
    const scene: Scene = { ...EMPTY_SCENE, entities: [makeEntity("a"), makeEntity("b")] };
    useEditorStore.setState({ activeScene: scene });
    useEditorStore.getState().removeEntity("a");
    const { activeScene } = useEditorStore.getState();
    expect(activeScene!.entities).toHaveLength(1);
    expect(activeScene!.entities[0].entity_id).toBe("b");
  });

  it("limpa selectedEntityId ao remover a entidade selecionada", () => {
    const scene: Scene = { ...EMPTY_SCENE, entities: [makeEntity("x")] };
    useEditorStore.setState({ activeScene: scene, selectedEntityId: "x" });
    useEditorStore.getState().removeEntity("x");
    expect(useEditorStore.getState().selectedEntityId).toBeNull();
  });

  it("mantém selectedEntityId ao remover outra entidade", () => {
    const scene: Scene = { ...EMPTY_SCENE, entities: [makeEntity("x"), makeEntity("y")] };
    useEditorStore.setState({ activeScene: scene, selectedEntityId: "x" });
    useEditorStore.getState().removeEntity("y");
    expect(useEditorStore.getState().selectedEntityId).toBe("x");
  });

  it("não faz nada se não há cena ativa", () => {
    useEditorStore.getState().removeEntity("ghost");
    expect(useEditorStore.getState().activeScene).toBeNull();
  });

  it("incrementa sceneRevision ao remover entidade", () => {
    const scene: Scene = { ...EMPTY_SCENE, entities: [makeEntity("a")] };
    useEditorStore.setState({ activeScene: scene, sceneRevision: 2 });
    useEditorStore.getState().removeEntity("a");
    expect(useEditorStore.getState().sceneRevision).toBe(3);
  });
});

// ── updateEntity ──────────────────────────────────────────────────────────────

describe("updateEntity", () => {
  it("atualiza transform de uma entidade pelo id", () => {
    const scene: Scene = { ...EMPTY_SCENE, entities: [makeEntity("hero", 0, 0)] };
    useEditorStore.setState({ activeScene: scene });
    useEditorStore.getState().updateEntity("hero", { transform: { x: 50, y: 80 } });
    const updated = useEditorStore.getState().activeScene!.entities[0];
    expect(updated.transform.x).toBe(50);
    expect(updated.transform.y).toBe(80);
  });

  it("não altera outras entidades ao atualizar uma", () => {
    const scene: Scene = {
      ...EMPTY_SCENE,
      entities: [makeEntity("a", 0, 0), makeEntity("b", 10, 10)],
    };
    useEditorStore.setState({ activeScene: scene });
    useEditorStore.getState().updateEntity("a", { transform: { x: 99, y: 99 } });
    const entities = useEditorStore.getState().activeScene!.entities;
    expect(entities[1].transform.x).toBe(10);
    expect(entities[1].transform.y).toBe(10);
  });

  it("não faz nada se não há cena ativa", () => {
    useEditorStore.getState().updateEntity("noop", { transform: { x: 1, y: 1 } });
    expect(useEditorStore.getState().activeScene).toBeNull();
  });

  it("atualiza components.camera mantendo imutabilidade", () => {
    const entity: Entity = {
      entity_id: "cam",
      prefab: "camera",
      transform: { x: 0, y: 0 },
      components: { camera: { follow_entity: "hero", offset_x: 0, offset_y: 0 } },
    };
    useEditorStore.setState({ activeScene: { ...EMPTY_SCENE, entities: [entity] } });
    useEditorStore.getState().updateEntity("cam", {
      components: { camera: { follow_entity: "hero", offset_x: 16, offset_y: 8 } },
    });
    const updated = useEditorStore.getState().activeScene!.entities[0];
    expect(updated.components.camera!.offset_x).toBe(16);
    expect(updated.components.camera!.offset_y).toBe(8);
    // Imutabilidade: objeto original não foi mutado
    expect(entity.components.camera!.offset_x).toBe(0);
  });

  it("atualiza components.tilemap mantendo imutabilidade", () => {
    const entity: Entity = {
      entity_id: "tm",
      prefab: "tilemap",
      transform: { x: 0, y: 0 },
      components: { tilemap: { tileset: "world.png", map_width: 32, map_height: 28, scroll_x: 0, scroll_y: 0 } },
    };
    useEditorStore.setState({ activeScene: { ...EMPTY_SCENE, entities: [entity] } });
    useEditorStore.getState().updateEntity("tm", {
      components: { tilemap: { tileset: "world.png", map_width: 32, map_height: 28, scroll_x: 64, scroll_y: 32 } },
    });
    const updated = useEditorStore.getState().activeScene!.entities[0];
    expect(updated.components.tilemap!.scroll_x).toBe(64);
    expect(updated.components.tilemap!.scroll_y).toBe(32);
    // Imutabilidade: objeto original não foi mutado
    expect(entity.components.tilemap!.scroll_x).toBe(0);
  });

  it("incrementa sceneRevision ao atualizar entidade", () => {
    const scene: Scene = { ...EMPTY_SCENE, entities: [makeEntity("hero", 0, 0)] };
    useEditorStore.setState({ activeScene: scene, sceneRevision: 5 });
    useEditorStore.getState().updateEntity("hero", { transform: { x: 2, y: 4 } });
    expect(useEditorStore.getState().sceneRevision).toBe(6);
  });
});

// ── updateBackgroundLayer ──────────────────────────────────────────────────────

describe("updateBackgroundLayer", () => {
  it("atualiza depth de um layer pelo id", () => {
    const scene: Scene = { ...EMPTY_SCENE, background_layers: [makeLayer("bg0", 0)] };
    useEditorStore.setState({ activeScene: scene });
    useEditorStore.getState().updateBackgroundLayer("bg0", { depth: 5 });
    const layer = useEditorStore.getState().activeScene!.background_layers[0];
    expect(layer.depth).toBe(5);
  });

  it("atualiza tileset de um layer pelo id", () => {
    const scene: Scene = { ...EMPTY_SCENE, background_layers: [makeLayer("sky", 1)] };
    useEditorStore.setState({ activeScene: scene });
    useEditorStore.getState().updateBackgroundLayer("sky", { tileset: "sky_new.png" });
    const layer = useEditorStore.getState().activeScene!.background_layers[0];
    expect(layer.tileset).toBe("sky_new.png");
  });

  it("não altera outros layers ao atualizar um", () => {
    const scene: Scene = {
      ...EMPTY_SCENE,
      background_layers: [makeLayer("bg0", 0), makeLayer("bg1", 2)],
    };
    useEditorStore.setState({ activeScene: scene });
    useEditorStore.getState().updateBackgroundLayer("bg0", { depth: 9 });
    const layers = useEditorStore.getState().activeScene!.background_layers;
    expect(layers[1].depth).toBe(2);
  });

  it("não faz nada se não há cena ativa", () => {
    useEditorStore.getState().updateBackgroundLayer("ghost", { depth: 1 });
    expect(useEditorStore.getState().activeScene).toBeNull();
  });

  it("incrementa sceneRevision ao atualizar layer", () => {
    const scene: Scene = { ...EMPTY_SCENE, background_layers: [makeLayer("bg0", 0)] };
    useEditorStore.setState({ activeScene: scene, sceneRevision: 1 });
    useEditorStore.getState().updateBackgroundLayer("bg0", { depth: 2 });
    expect(useEditorStore.getState().sceneRevision).toBe(2);
  });
});

describe("setActiveScene", () => {
  it("incrementa sceneRevision ao carregar cena", () => {
    useEditorStore.setState({ sceneRevision: 7 });
    useEditorStore.getState().setActiveScene({ ...EMPTY_SCENE });
    expect(useEditorStore.getState().sceneRevision).toBe(8);
  });

  it("seleciona automaticamente a primeira entidade da cena carregada", () => {
    useEditorStore.setState({ selectedEntityId: null });
    useEditorStore.getState().setActiveScene({
      ...EMPTY_SCENE,
      entities: [makeEntity("player"), makeEntity("enemy")],
    });

    expect(useEditorStore.getState().selectedEntityId).toBe("player");
  });

  it("prioriza a entidade player ou a primeira com sprite/logica ao carregar a cena", () => {
    useEditorStore.setState({ selectedEntityId: null });
    useEditorStore.getState().setActiveScene({
      ...EMPTY_SCENE,
      entities: [
        {
          entity_id: "tilemap_bg",
          prefab: "platformer_tilemap.json",
          transform: { x: 0, y: 0 },
          components: {
            tilemap: {
              tileset: "assets/tilesets/platformer_level.png",
              map_width: 32,
              map_height: 32,
            },
          },
        },
        {
          entity_id: "player",
          prefab: "platformer_player.json",
          transform: { x: 48, y: 120 },
          components: {
            sprite: {
              asset: "assets/sprites/platformer_player.png",
              frame_width: 32,
              frame_height: 32,
            },
            logic: {
              graph_ref: "graphs/platformer_player_logic.json",
            },
          },
        },
        {
          entity_id: "audio_bank",
          prefab: null,
          transform: { x: 0, y: 0 },
          components: {
            audio: {
              sfx: { jump: "assets/audio/jump.wav" },
            },
          },
        },
      ],
    });

    expect(useEditorStore.getState().selectedEntityId).toBe("player");
  });

  it("preserva a selecao quando a entidade ainda existe na cena carregada", () => {
    useEditorStore.setState({ selectedEntityId: "enemy" });
    useEditorStore.getState().setActiveScene({
      ...EMPTY_SCENE,
      entities: [makeEntity("player"), makeEntity("enemy")],
    });

    expect(useEditorStore.getState().selectedEntityId).toBe("enemy");
  });

  it("reseta o estado de validacao ao limpar a cena", () => {
    useEditorStore.setState({
      activeScene: { ...EMPTY_SCENE },
      sceneRevision: 4,
      hwValidationState: "fresh",
      hwValidatedRevision: 4,
      hwValidationError: "erro antigo",
    });
    useEditorStore.getState().setActiveScene(null);
    expect(useEditorStore.getState().sceneRevision).toBe(0);
    expect(useEditorStore.getState().hwValidationState).toBe("idle");
    expect(useEditorStore.getState().hwValidatedRevision).toBe(0);
    expect(useEditorStore.getState().hwValidationError).toBeNull();
  });

  it("stores the raw source scene separately when both snapshots are provided", () => {
    const sourceScene: Scene = {
      ...EMPTY_SCENE,
      entities: [
        {
          entity_id: "hero",
          prefab: "hero.json",
          transform: { x: 0, y: 0 },
          components: { physics: { friction: 2 } },
        },
      ],
    };
    const resolvedScene: Scene = {
      ...EMPTY_SCENE,
      entities: [
        {
          entity_id: "hero",
          prefab: "hero.json",
          transform: { x: 0, y: 0 },
          components: {
            sprite: { asset: "assets/sprites/hero.png", frame_width: 16, frame_height: 16 },
            physics: { friction: 2, gravity: false },
          },
        },
      ],
    };

    useEditorStore.getState().setActiveScene(resolvedScene, sourceScene);

    const state = useEditorStore.getState();
    expect(state.activeScene).toEqual(resolvedScene);
    expect(state.activeSceneSource).toEqual(sourceScene);
    expect(state.activeSceneSource?.entities[0]?.components.sprite).toBeUndefined();
  });
});

describe("undo/redo", () => {
  it("undo reverte addEntity", () => {
    useEditorStore.setState({ activeScene: { ...EMPTY_SCENE } });
    useEditorStore.getState().addEntity(makeEntity("hero", 10, 20));

    useEditorStore.getState().undo();

    const state = useEditorStore.getState();
    expect(state.activeScene!.entities).toHaveLength(0);
    expect(state.redoStack).toHaveLength(1);
  });

  it("undo reverte removeEntity e restaura a selecao", () => {
    useEditorStore.setState({
      activeScene: { ...EMPTY_SCENE, entities: [makeEntity("hero")] },
      selectedEntityId: "hero",
    });

    useEditorStore.getState().removeEntity("hero");
    useEditorStore.getState().undo();

    const state = useEditorStore.getState();
    expect(state.activeScene!.entities).toHaveLength(1);
    expect(state.activeScene!.entities[0].entity_id).toBe("hero");
    expect(state.selectedEntityId).toBe("hero");
  });

  it("undo reverte updateEntity", () => {
    useEditorStore.setState({
      activeScene: { ...EMPTY_SCENE, entities: [makeEntity("hero", 0, 0)] },
    });

    useEditorStore.getState().updateEntity("hero", { transform: { x: 24, y: 32 } });
    useEditorStore.getState().undo();

    const hero = useEditorStore.getState().activeScene!.entities[0];
    expect(hero.transform.x).toBe(0);
    expect(hero.transform.y).toBe(0);
  });

  it("redo reaplica a mutacao apos undo", () => {
    useEditorStore.setState({ activeScene: { ...EMPTY_SCENE } });

    useEditorStore.getState().addEntity(makeEntity("hero", 10, 20));
    useEditorStore.getState().undo();
    useEditorStore.getState().redo();

    const state = useEditorStore.getState();
    expect(state.activeScene!.entities).toHaveLength(1);
    expect(state.activeScene!.entities[0].transform).toEqual({ x: 10, y: 20 });
    expect(state.undoStack).toHaveLength(1);
  });

  it("limita a pilha de undo a 50 entradas", () => {
    useEditorStore.setState({ activeScene: { ...EMPTY_SCENE } });

    for (let index = 0; index < 51; index += 1) {
      useEditorStore.getState().addEntity(makeEntity(`entity_${index}`));
    }

    const state = useEditorStore.getState();
    expect(state.undoStack).toHaveLength(50);
    expect(state.undoStack[0]?.activeScene?.entities).toHaveLength(1);
    expect(state.undoStack[state.undoStack.length - 1]?.activeScene?.entities).toHaveLength(50);
  });

  it("undo sem pilha e no-op", () => {
    useEditorStore.setState({
      activeScene: { ...EMPTY_SCENE, entities: [makeEntity("hero")] },
      sceneRevision: 4,
    });

    useEditorStore.getState().undo();

    const state = useEditorStore.getState();
    expect(state.activeScene!.entities).toHaveLength(1);
    expect(state.sceneRevision).toBe(4);
    expect(state.redoStack).toHaveLength(0);
  });

  it("agrupa drag do viewport em uma unica entrada de undo", () => {
    useEditorStore.setState({
      activeScene: { ...EMPTY_SCENE, entities: [makeEntity("hero", 0, 0)] },
    });

    const state = useEditorStore.getState();
    state.beginHistoryCapture();
    state.commitHistoryCapture();
    state.updateEntity("hero", { transform: { x: 8, y: 8 } }, { recordHistory: false });
    state.updateEntity("hero", { transform: { x: 24, y: 16 } }, { recordHistory: false });

    expect(useEditorStore.getState().undoStack).toHaveLength(1);

    useEditorStore.getState().undo();

    const hero = useEditorStore.getState().activeScene!.entities[0];
    expect(hero.transform).toEqual({ x: 0, y: 0 });
  });

  it("preserves prefab references in activeSceneSource while editing the resolved entity", () => {
    const sourceScene: Scene = {
      ...EMPTY_SCENE,
      entities: [
        {
          entity_id: "hero",
          prefab: "hero.json",
          transform: { x: 0, y: 0 },
          components: { physics: { friction: 1 } },
        },
      ],
    };
    const resolvedScene: Scene = {
      ...EMPTY_SCENE,
      entities: [
        {
          entity_id: "hero",
          prefab: "hero.json",
          transform: { x: 0, y: 0 },
          components: {
            sprite: { asset: "assets/sprites/hero.png", frame_width: 16, frame_height: 16 },
            physics: { friction: 1, gravity: false },
          },
        },
      ],
    };

    useEditorStore.getState().setActiveScene(resolvedScene, sourceScene);
    useEditorStore.getState().updateEntity("hero", {
      components: {
        sprite: { asset: "assets/sprites/hero_alt.png", frame_width: 16, frame_height: 16 },
        physics: { friction: 1, gravity: false },
      },
    });

    const state = useEditorStore.getState();
    expect(state.activeScene?.entities[0]?.components.sprite?.asset).toBe(
      "assets/sprites/hero_alt.png"
    );
    expect(state.activeSceneSource?.entities[0]?.prefab).toBe("hero.json");
    expect(state.activeSceneSource?.entities[0]?.components.physics).toEqual({ friction: 1 });
    expect(state.activeSceneSource?.entities[0]?.components.sprite).toEqual({
      asset: "assets/sprites/hero_alt.png",
    });

    useEditorStore.getState().undo();

    expect(useEditorStore.getState().activeSceneSource).toEqual(sourceScene);
  });

  it("preserva graph_ref herdado ao editar o grafo resolvido de uma instancia de prefab", () => {
    const sourceScene: Scene = {
      ...EMPTY_SCENE,
      entities: [
        {
          entity_id: "player",
          prefab: "platformer_player.json",
          transform: { x: 48, y: 120 },
          components: {},
        },
      ],
    };
    const resolvedScene: Scene = {
      ...EMPTY_SCENE,
      entities: [
        {
          entity_id: "player",
          prefab: "platformer_player.json",
          transform: { x: 48, y: 120 },
          components: {
            sprite: {
              asset: "assets/sprites/platformer_player.png",
              frame_width: 32,
              frame_height: 32,
            },
            logic: {
              graph_ref: "graphs/platformer_player_logic.json",
              graph: "{\"version\":1,\"nodes\":[{\"id\":\"start\",\"type\":\"event_start\",\"params\":{}}],\"edges\":[]}",
            },
          },
        },
      ],
    };

    useEditorStore.getState().setActiveScene(resolvedScene, sourceScene);
    useEditorStore.getState().updateEntity("player", {
      components: {
        ...resolvedScene.entities[0].components,
        logic: {
          ...resolvedScene.entities[0].components.logic,
          graph:
            "{\"version\":1,\"nodes\":[{\"id\":\"start\",\"type\":\"event_start\",\"params\":{}},{\"id\":\"move\",\"type\":\"sprite_move\",\"params\":{\"target\":\"player\",\"dx\":2,\"dy\":0}}],\"edges\":[]}",
        },
      },
    });

    const persistedLogic = useEditorStore.getState().activeSceneSource?.entities[0]?.components.logic;
    expect(persistedLogic?.graph_ref).toBe("graphs/platformer_player_logic.json");
    expect(persistedLogic?.graph).toContain("\"sprite_move\"");
  });
});

describe("setEditorMode", () => {
  it("defaults to select mode", () => {
    expect(useEditorStore.getState().editorMode).toBe("select");
  });

  it("switches to paint mode", () => {
    useEditorStore.getState().setEditorMode("paint");
    expect(useEditorStore.getState().editorMode).toBe("paint");
  });

  it("switches to erase mode", () => {
    useEditorStore.getState().setEditorMode("erase");
    expect(useEditorStore.getState().editorMode).toBe("erase");
  });

  it("returns to select mode", () => {
    useEditorStore.getState().setEditorMode("paint");
    useEditorStore.getState().setEditorMode("select");
    expect(useEditorStore.getState().editorMode).toBe("select");
  });

  it("undo restores previous editorMode captured in snapshot", () => {
    useEditorStore.setState({ activeScene: { ...EMPTY_SCENE }, editorMode: "select" });
    useEditorStore.getState().setEditorMode("paint");
    useEditorStore.getState().addEntity(makeEntity("hero"));

    useEditorStore.getState().undo();

    expect(useEditorStore.getState().editorMode).toBe("paint");
  });
});

describe("setActiveBrush", () => {
  it("defaults to null", () => {
    expect(useEditorStore.getState().activeBrush).toBeNull();
  });

  it("sets a brush with kind and id", () => {
    useEditorStore.getState().setActiveBrush({ kind: "prefab", id: "player.json" });
    const brush = useEditorStore.getState().activeBrush;
    expect(brush).toEqual({ kind: "prefab", id: "player.json" });
  });

  it("sets a brush with assetPath", () => {
    useEditorStore.getState().setActiveBrush({
      kind: "prefab",
      id: "assets/sprites/hero.png",
      assetPath: "assets/sprites/hero.png",
    });
    const brush = useEditorStore.getState().activeBrush;
    expect(brush?.assetPath).toBe("assets/sprites/hero.png");
  });

  it("clears brush back to null", () => {
    useEditorStore.getState().setActiveBrush({ kind: "prefab", id: "coin.json" });
    useEditorStore.getState().setActiveBrush(null);
    expect(useEditorStore.getState().activeBrush).toBeNull();
  });

  it("replaces previous brush entirely", () => {
    useEditorStore.getState().setActiveBrush({ kind: "prefab", id: "a.json" });
    useEditorStore.getState().setActiveBrush({ kind: "tile", id: "tile_42" });
    const brush = useEditorStore.getState().activeBrush;
    expect(brush).toEqual({ kind: "tile", id: "tile_42" });
  });
});

// ── layer actions ────────────────────────────────────────────────────────────

function makeSceneLayer(id: string, overrides: Partial<SceneLayer> = {}): SceneLayer {
  return { id, name: id, kind: "sprite", visible: true, locked: false, depth: 0, entity_ids: [], ...overrides };
}

describe("createLayer", () => {
  it("não faz nada se não há cena ativa", () => {
    useEditorStore.getState().createLayer("BG", "sprite");
    expect(useEditorStore.getState().activeScene).toBeNull();
  });

  it("adiciona camada com atributos padrão corretos", () => {
    useEditorStore.setState({ activeScene: { ...EMPTY_SCENE } });
    useEditorStore.getState().createLayer("Background", "sprite");
    const layers = useEditorStore.getState().activeScene!.layers ?? [];
    expect(layers).toHaveLength(1);
    expect(layers[0].name).toBe("Background");
    expect(layers[0].kind).toBe("sprite");
    expect(layers[0].visible).toBe(true);
    expect(layers[0].locked).toBe(false);
    expect(layers[0].entity_ids).toHaveLength(0);
  });

  it("incrementa sceneRevision ao criar camada", () => {
    useEditorStore.setState({ activeScene: { ...EMPTY_SCENE }, sceneRevision: 2 });
    useEditorStore.getState().createLayer("Foreground", "tile");
    expect(useEditorStore.getState().sceneRevision).toBe(3);
  });
});

describe("deleteLayer", () => {
  it("remove camada pelo id", () => {
    const layer = makeSceneLayer("layer_1");
    useEditorStore.setState({ activeScene: { ...EMPTY_SCENE, layers: [layer] } });
    useEditorStore.getState().deleteLayer("layer_1");
    expect(useEditorStore.getState().activeScene!.layers).toHaveLength(0);
  });

  it("limpa activeLayerId ao remover a camada ativa", () => {
    const layer = makeSceneLayer("layer_1");
    useEditorStore.setState({ activeScene: { ...EMPTY_SCENE, layers: [layer] }, activeLayerId: "layer_1" });
    useEditorStore.getState().deleteLayer("layer_1");
    expect(useEditorStore.getState().activeLayerId).toBeNull();
  });

  it("mantém activeLayerId ao remover outra camada", () => {
    const l1 = makeSceneLayer("layer_1");
    const l2 = makeSceneLayer("layer_2");
    useEditorStore.setState({ activeScene: { ...EMPTY_SCENE, layers: [l1, l2] }, activeLayerId: "layer_1" });
    useEditorStore.getState().deleteLayer("layer_2");
    expect(useEditorStore.getState().activeLayerId).toBe("layer_1");
  });
});

describe("updateLayer", () => {
  it("altera visible para false", () => {
    const layer = makeSceneLayer("layer_1", { visible: true });
    useEditorStore.setState({ activeScene: { ...EMPTY_SCENE, layers: [layer] } });
    useEditorStore.getState().updateLayer("layer_1", { visible: false });
    expect(useEditorStore.getState().activeScene!.layers![0].visible).toBe(false);
  });

  it("altera locked para true", () => {
    const layer = makeSceneLayer("layer_1", { locked: false });
    useEditorStore.setState({ activeScene: { ...EMPTY_SCENE, layers: [layer] } });
    useEditorStore.getState().updateLayer("layer_1", { locked: true });
    expect(useEditorStore.getState().activeScene!.layers![0].locked).toBe(true);
  });

  it("não altera outras camadas ao atualizar uma", () => {
    const l1 = makeSceneLayer("l1", { visible: true });
    const l2 = makeSceneLayer("l2", { visible: true });
    useEditorStore.setState({ activeScene: { ...EMPTY_SCENE, layers: [l1, l2] } });
    useEditorStore.getState().updateLayer("l1", { visible: false });
    expect(useEditorStore.getState().activeScene!.layers![1].visible).toBe(true);
  });
});

describe("assignEntityToLayer", () => {
  it("atribui entidade à camada alvo", () => {
    const layer = makeSceneLayer("layer_1");
    useEditorStore.setState({ activeScene: { ...EMPTY_SCENE, layers: [layer] } });
    useEditorStore.getState().assignEntityToLayer("hero", "layer_1");
    expect(useEditorStore.getState().activeScene!.layers![0].entity_ids).toContain("hero");
  });

  it("remove entidade de camadas anteriores ao reatribuir", () => {
    const l1 = makeSceneLayer("layer_1", { entity_ids: ["hero"] });
    const l2 = makeSceneLayer("layer_2");
    useEditorStore.setState({ activeScene: { ...EMPTY_SCENE, layers: [l1, l2] } });
    useEditorStore.getState().assignEntityToLayer("hero", "layer_2");
    const layers = useEditorStore.getState().activeScene!.layers!;
    expect(layers[0].entity_ids).not.toContain("hero");
    expect(layers[1].entity_ids).toContain("hero");
  });

  it("remove entidade de todas as camadas ao passar layerId null", () => {
    const l1 = makeSceneLayer("layer_1", { entity_ids: ["hero"] });
    const l2 = makeSceneLayer("layer_2", { entity_ids: ["hero"] });
    useEditorStore.setState({ activeScene: { ...EMPTY_SCENE, layers: [l1, l2] } });
    useEditorStore.getState().assignEntityToLayer("hero", null);
    const layers = useEditorStore.getState().activeScene!.layers!;
    expect(layers[0].entity_ids).not.toContain("hero");
    expect(layers[1].entity_ids).not.toContain("hero");
  });
});

describe("startup messaging", () => {
  it("keeps the initial console entry aligned with release candidate status", () => {
    const startupMessage = useEditorStore.getInitialState().consoleEntries[0]?.message ?? "";
    expect(startupMessage).toContain("release candidate / beta testing");
    expect(startupMessage).not.toContain("MVP completo");
  });
});

// ── Tilemap cell painting ─────────────────────────────────────────────────────

function makeTilemapEntity(
  id: string,
  mapWidth = 4,
  mapHeight = 3,
  cells?: number[]
): Entity {
  return {
    entity_id: id,
    prefab: null,
    transform: { x: 0, y: 0 },
    components: {
      tilemap: {
        tileset: "assets/tilesets/bg.png",
        map_width: mapWidth,
        map_height: mapHeight,
        scroll_x: 0,
        scroll_y: 0,
        ...(cells ? { cells } : {}),
      },
    },
  };
}

describe("paintTilemapCell", () => {
  it("materializa cells[] sob demanda e pinta a célula correta (row-major)", () => {
    const tm = makeTilemapEntity("tm1", 4, 3);
    useEditorStore.setState({
      activeScene: { ...EMPTY_SCENE, entities: [tm] },
      activeSceneSource: { ...EMPTY_SCENE, entities: [tm] },
    });
    useEditorStore.getState().paintTilemapCell("tm1", 2, 1, 7);
    const patched = useEditorStore.getState().activeScene!.entities[0];
    const cells = patched.components.tilemap!.cells!;
    expect(cells).toHaveLength(12);
    // índice row-major: row*width + col = 1*4 + 2 = 6
    expect(cells[6]).toBe(7);
    // demais células permanecem 0
    expect(cells.filter((v) => v !== 0)).toEqual([7]);
  });

  it("rejeita coordenadas fora da malha sem mutar o estado", () => {
    const tm = makeTilemapEntity("tm1", 4, 3);
    useEditorStore.setState({
      activeScene: { ...EMPTY_SCENE, entities: [tm] },
      activeSceneSource: { ...EMPTY_SCENE, entities: [tm] },
    });
    const revBefore = useEditorStore.getState().sceneRevision;
    useEditorStore.getState().paintTilemapCell("tm1", 99, 1, 3);
    useEditorStore.getState().paintTilemapCell("tm1", -1, 0, 3);
    useEditorStore.getState().paintTilemapCell("tm1", 0, 99, 3);
    const patched = useEditorStore.getState().activeScene!.entities[0];
    expect(patched.components.tilemap!.cells ?? []).toEqual([]);
    expect(useEditorStore.getState().sceneRevision).toBe(revBefore);
  });

  it("não duplica mutação quando pinta com o mesmo tileIndex já presente", () => {
    const tm = makeTilemapEntity("tm1", 2, 2, [0, 5, 0, 0]);
    useEditorStore.setState({
      activeScene: { ...EMPTY_SCENE, entities: [tm] },
      activeSceneSource: { ...EMPTY_SCENE, entities: [tm] },
    });
    const revBefore = useEditorStore.getState().sceneRevision;
    useEditorStore.getState().paintTilemapCell("tm1", 1, 0, 5);
    expect(useEditorStore.getState().sceneRevision).toBe(revBefore);
  });
});

describe("fillTilemapRect", () => {
  it("preenche o retângulo inclusivo e cria uma única entrada de undo", () => {
    const tm = makeTilemapEntity("tm1", 4, 3);
    useEditorStore.setState({
      activeScene: { ...EMPTY_SCENE, entities: [tm] },
      activeSceneSource: { ...EMPTY_SCENE, entities: [tm] },
    });
    const undoLenBefore = useEditorStore.getState().undoStack.length;
    useEditorStore.getState().fillTilemapRect("tm1", 1, 0, 2, 1, 9);
    const cells = useEditorStore.getState().activeScene!.entities[0].components.tilemap!.cells!;
    // retângulo [1..2] × [0..1] → 4 células (row 0: idx 1,2; row 1: idx 5,6)
    expect(cells[1]).toBe(9);
    expect(cells[2]).toBe(9);
    expect(cells[5]).toBe(9);
    expect(cells[6]).toBe(9);
    expect(cells.filter((v) => v === 9)).toHaveLength(4);
    expect(useEditorStore.getState().undoStack.length).toBe(undoLenBefore + 1);
  });

  it("recorta retângulo fora da malha", () => {
    const tm = makeTilemapEntity("tm1", 3, 3);
    useEditorStore.setState({
      activeScene: { ...EMPTY_SCENE, entities: [tm] },
      activeSceneSource: { ...EMPTY_SCENE, entities: [tm] },
    });
    useEditorStore.getState().fillTilemapRect("tm1", -5, -5, 1, 1, 2);
    const cells = useEditorStore.getState().activeScene!.entities[0].components.tilemap!.cells!;
    // recortado para [0..1]×[0..1] → 4 células
    expect(cells.filter((v) => v === 2)).toHaveLength(4);
  });
});

describe("fillTilemapFlood", () => {
  it("preenche região 4-vizinhança a partir do seed", () => {
    // Malha 3×3 com ilha de zeros cercada por 1s:
    // 1 1 1
    // 1 0 0   → flood em (1,1) com tile 7
    // 1 0 0
    const tm = makeTilemapEntity("tm1", 3, 3, [1, 1, 1, 1, 0, 0, 1, 0, 0]);
    useEditorStore.setState({
      activeScene: { ...EMPTY_SCENE, entities: [tm] },
      activeSceneSource: { ...EMPTY_SCENE, entities: [tm] },
    });
    useEditorStore.getState().fillTilemapFlood("tm1", 1, 1, 7);
    const cells = useEditorStore.getState().activeScene!.entities[0].components.tilemap!.cells!;
    expect(cells).toEqual([1, 1, 1, 1, 7, 7, 1, 7, 7]);
  });

  it("é no-op quando seed já possui o tileIndex alvo", () => {
    const tm = makeTilemapEntity("tm1", 2, 2, [3, 3, 3, 3]);
    useEditorStore.setState({
      activeScene: { ...EMPTY_SCENE, entities: [tm] },
      activeSceneSource: { ...EMPTY_SCENE, entities: [tm] },
    });
    const revBefore = useEditorStore.getState().sceneRevision;
    useEditorStore.getState().fillTilemapFlood("tm1", 0, 0, 3);
    expect(useEditorStore.getState().sceneRevision).toBe(revBefore);
  });
});

describe("clearTilemapCells", () => {
  it("remove cells[] para restaurar o fallback de tileset esticado", () => {
    const tm = makeTilemapEntity("tm1", 2, 2, [1, 2, 3, 4]);
    useEditorStore.setState({
      activeScene: { ...EMPTY_SCENE, entities: [tm] },
      activeSceneSource: { ...EMPTY_SCENE, entities: [tm] },
    });
    useEditorStore.getState().clearTilemapCells("tm1");
    const patched = useEditorStore.getState().activeScene!.entities[0];
    expect(patched.components.tilemap!.cells).toBeUndefined();
    const srcPatched = useEditorStore.getState().activeSceneSource!.entities[0];
    expect(srcPatched.components.tilemap!.cells).toBeUndefined();
  });

  it("é no-op quando o tilemap já não possui cells[]", () => {
    const tm = makeTilemapEntity("tm1", 2, 2);
    useEditorStore.setState({
      activeScene: { ...EMPTY_SCENE, entities: [tm] },
      activeSceneSource: { ...EMPTY_SCENE, entities: [tm] },
    });
    const revBefore = useEditorStore.getState().sceneRevision;
    useEditorStore.getState().clearTilemapCells("tm1");
    expect(useEditorStore.getState().sceneRevision).toBe(revBefore);
  });
});

// ── updateCollisionMap ───────────────────────────────────────────────────────

describe("updateCollisionMap", () => {
  it("propagates collision edits to activeSceneSource for persistence", () => {
    const scene = { ...EMPTY_SCENE };
    useEditorStore.setState({
      activeScene: structuredClone(scene),
      activeSceneSource: structuredClone(scene),
      activeTarget: "megadrive",
    });
    useEditorStore.getState().updateCollisionMap(0, 1);

    const state = useEditorStore.getState();
    expect(state.activeScene?.collision_map).toBeDefined();
    expect(state.activeScene!.collision_map!.data[0]).toBe(1);
    expect(state.activeSceneSource?.collision_map).toBeDefined();
    expect(state.activeSceneSource!.collision_map!.data[0]).toBe(1);
  });

  it("auto-initializes collision_map with correct dimensions for target", () => {
    useEditorStore.setState({
      activeScene: structuredClone(EMPTY_SCENE),
      activeSceneSource: structuredClone(EMPTY_SCENE),
      activeTarget: "snes",
    });
    useEditorStore.getState().updateCollisionMap(5, 1);

    const map = useEditorStore.getState().activeScene!.collision_map!;
    expect(map.width).toBe(32);
    expect(map.height).toBe(28);
    expect(map.data[5]).toBe(1);
  });
});
