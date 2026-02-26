/**
 * editorStore.test.ts — Testes de integração para o estado global do editor
 *
 * Sprint P9: Vitest — cobre addEntity, removeEntity, updateEntity.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "./editorStore";
import type { Scene, Entity } from "../ipc/sceneService";

// ── Fixtures ─────────────────────────────────────────────────────────────────

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
};

// Reseta o store antes de cada teste (Zustand compartilha instância global)
beforeEach(() => {
  useEditorStore.setState({
    activeScene: null,
    selectedEntityId: null,
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
    const { addEntity } = useEditorStore.getState();
    addEntity(makeEntity("a"));
    addEntity(makeEntity("b"));
    addEntity(makeEntity("c"));
    expect(useEditorStore.getState().activeScene!.entities).toHaveLength(3);
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
});
