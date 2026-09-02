import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  clearSceneDraft,
  loadSceneDraft,
  persistActiveScene,
  saveActiveSceneDraft,
  sceneDraftDiffersFromActiveSource,
  sceneDraftStorageKey,
} from "./scenePersistence";
import { useEditorStore } from "./store/editorStore";
import type { Entity, Scene } from "./ipc/sceneService";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const SCENE: Scene = {
  scene_id: "scene_draft",
  background_layers: [],
  entities: [],
  palettes: [],
};

function makeEntity(id: string): Entity {
  return { entity_id: id, prefab: id, transform: { x: 1, y: 2 }, components: {} };
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(invoke).mockReset();
  useEditorStore.setState({
    activeScene: structuredClone(SCENE),
    activeSceneSource: structuredClone(SCENE),
    activeScenePath: "scenes/main.json",
  });
});

describe("autosave de rascunho local (Experimental)", () => {
  it("salva, carrega e limpa rascunho por projeto", () => {
    expect(saveActiveSceneDraft("/proj/a")).toBe(true);

    const draft = loadSceneDraft("/proj/a");
    expect(draft).not.toBeNull();
    expect(draft?.scenePath).toBe("scenes/main.json");
    expect(draft && sceneDraftDiffersFromActiveSource(draft)).toBe(false);

    expect(loadSceneDraft("/proj/b")).toBeNull();

    clearSceneDraft("/proj/a");
    expect(loadSceneDraft("/proj/a")).toBeNull();
  });

  it("detecta divergencia apos mutacao da cena ativa", () => {
    saveActiveSceneDraft("/proj/a");
    useEditorStore.setState({
      activeSceneSource: { ...structuredClone(SCENE), entities: [makeEntity("novo")] },
    });

    const draft = loadSceneDraft("/proj/a");
    expect(draft && sceneDraftDiffersFromActiveSource(draft)).toBe(true);
  });

  it("nao salva sem projeto ou sem cena ativa", () => {
    expect(saveActiveSceneDraft("")).toBe(false);

    useEditorStore.setState({ activeSceneSource: null });
    expect(saveActiveSceneDraft("/proj/a")).toBe(false);
  });

  it("rascunho corrompido volta como null em vez de quebrar", () => {
    localStorage.setItem(sceneDraftStorageKey("/proj/a"), "{corrompido");
    expect(loadSceneDraft("/proj/a")).toBeNull();
  });

  it("persistActiveScene com sucesso limpa o rascunho (o disco e a verdade)", async () => {
    vi.mocked(invoke).mockResolvedValue({ ok: true, message: "" });

    saveActiveSceneDraft("/proj/a");
    expect(loadSceneDraft("/proj/a")).not.toBeNull();

    await expect(persistActiveScene("/proj/a", "Teste")).resolves.toBe(true);
    expect(loadSceneDraft("/proj/a")).toBeNull();
  });
});
