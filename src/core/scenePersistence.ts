import {
  getSceneData,
  parseScene,
  parseSceneJson,
  resolveScenePrefabs,
  saveSceneData,
  type Scene,
  type SceneDataResult,
} from "./ipc/sceneService";
import { useEditorStore } from "./store/editorStore";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface HydratedScenePair {
  sourceScene: Scene;
  resolvedScene: Scene;
}

export async function hydrateSceneResult(
  projectDir: string,
  sceneData: SceneDataResult
): Promise<HydratedScenePair | null> {
  const sourceScene = parseScene(sceneData);
  if (!sourceScene) {
    return null;
  }

  const resolvedResult = await resolveScenePrefabs(projectDir, sourceScene);
  if (!resolvedResult.ok) {
    throw new Error(resolvedResult.error || "Falha ao resolver prefabs da cena.");
  }

  const resolvedScene = parseSceneJson(resolvedResult.scene_json);
  if (!resolvedScene) {
    throw new Error("Falha ao reconstruir a cena resolvida.");
  }

  return {
    sourceScene,
    resolvedScene,
  };
}

export async function reloadSceneFromDisk(projectDir: string, scope: string): Promise<boolean> {
  const {
    activeScenePath,
    logMessage,
    selectedEntityId,
    setActiveScene,
    setActiveScenePath,
    setSelectedEntityId,
  } = useEditorStore.getState();

  try {
    const sceneData = await getSceneData(projectDir, activeScenePath || undefined);
    if (!sceneData.ok) {
      logMessage("error", `[${scope}] Falha ao recarregar cena: ${sceneData.error}`);
      return false;
    }

    const hydrated = await hydrateSceneResult(projectDir, sceneData);
    if (!hydrated) {
      logMessage("error", `[${scope}] Falha ao reidratar a cena salva.`);
      return false;
    }

    setActiveScenePath(sceneData.scene_path);
    setActiveScene(hydrated.resolvedScene, hydrated.sourceScene);
    if (selectedEntityId) {
      const isLayerSelection = selectedEntityId.startsWith("layer::");
      const selectionStillExists = isLayerSelection
        ? hydrated.resolvedScene.background_layers.some(
            (layer) => `layer::${layer.layer_id}` === selectedEntityId
          )
        : hydrated.resolvedScene.entities.some(
            (entity) => entity.entity_id === selectedEntityId
          );

      if (!selectionStillExists) {
        setSelectedEntityId(null);
      }
    }
    return true;
  } catch (error) {
    logMessage("error", `[${scope}] ${describeError(error)}`);
    return false;
  }
}

export async function persistActiveScene(
  projectDir: string,
  scope: string,
  successMessage?: string
): Promise<boolean> {
  const { activeScene, activeScenePath, activeSceneSource, logMessage } = useEditorStore.getState();
  if (!activeSceneSource || !activeScene) {
    return true;
  }

  try {
    const result = await saveSceneData(
      projectDir,
      JSON.stringify(activeSceneSource, null, 2),
      activeScenePath || undefined,
      JSON.stringify(activeScene, null, 2)
    );
    if (result.ok) {
      clearSceneDraft(projectDir);
      if (successMessage) {
        logMessage("success", `[${scope}] ${successMessage}`);
      }
      return true;
    }

    logMessage("error", `[${scope}] ${result.message}`);
  } catch (error) {
    logMessage("error", `[${scope}] ${describeError(error)}`);
  }

  await reloadSceneFromDisk(projectDir, scope);
  return false;
}

/**
 * Autosave de rascunho local (fatia 1 v2 do estudo de UI) — Experimental.
 *
 * O rascunho vive apenas em localStorage do host; nunca grava em disco por
 * conta propria. O disco so muda no fluxo canonico `persistActiveScene`, que
 * limpa o rascunho apos salvar com sucesso.
 */
const SCENE_DRAFT_STORAGE_PREFIX = "retrodev-scene-draft";

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultDraftStorage(): DraftStorage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

export interface SceneDraftRecord {
  savedAt: string;
  scenePath: string | null;
  sourceSceneJson: string;
}

export function sceneDraftStorageKey(projectDir: string): string {
  return `${SCENE_DRAFT_STORAGE_PREFIX}::${projectDir}`;
}

export function saveActiveSceneDraft(
  projectDir: string,
  storage: DraftStorage | null = defaultDraftStorage(),
  now: Date = new Date()
): boolean {
  const { activeSceneSource, activeScenePath } = useEditorStore.getState();
  if (!projectDir || !activeSceneSource || !storage) {
    return false;
  }

  try {
    storage.setItem(
      sceneDraftStorageKey(projectDir),
      JSON.stringify({
        savedAt: now.toISOString(),
        scenePath: activeScenePath || null,
        sourceSceneJson: JSON.stringify(activeSceneSource),
      } satisfies SceneDraftRecord)
    );
    return true;
  } catch {
    return false;
  }
}

export function loadSceneDraft(
  projectDir: string,
  storage: DraftStorage | null = defaultDraftStorage()
): SceneDraftRecord | null {
  try {
    const raw = storage?.getItem(sceneDraftStorageKey(projectDir));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<SceneDraftRecord>;
    if (typeof parsed.sourceSceneJson !== "string" || typeof parsed.savedAt !== "string") {
      return null;
    }
    return {
      savedAt: parsed.savedAt,
      scenePath: typeof parsed.scenePath === "string" ? parsed.scenePath : null,
      sourceSceneJson: parsed.sourceSceneJson,
    };
  } catch {
    return null;
  }
}

export function clearSceneDraft(
  projectDir: string,
  storage: DraftStorage | null = defaultDraftStorage()
): void {
  try {
    storage?.removeItem(sceneDraftStorageKey(projectDir));
  } catch {
    // storage indisponivel: nada a limpar
  }
}

/** True quando o rascunho difere da fonte ativa no editor (ou nao ha fonte ativa). */
export function sceneDraftDiffersFromActiveSource(draft: SceneDraftRecord): boolean {
  const { activeSceneSource } = useEditorStore.getState();
  if (!activeSceneSource) {
    return true;
  }
  return draft.sourceSceneJson !== JSON.stringify(activeSceneSource);
}

/**
 * Restaura o rascunho no editor (memoria apenas). O disco permanece intocado
 * ate o usuario salvar explicitamente pelo fluxo canonico.
 */
export async function restoreSceneDraft(
  projectDir: string,
  draft: SceneDraftRecord
): Promise<boolean> {
  const { logMessage, setActiveScene, setActiveScenePath } = useEditorStore.getState();

  const source = parseSceneJson(draft.sourceSceneJson);
  if (!source) {
    logMessage("error", "[Autosave] Rascunho local invalido; nada foi restaurado.");
    return false;
  }

  try {
    const resolvedResult = await resolveScenePrefabs(projectDir, source);
    if (!resolvedResult.ok) {
      logMessage(
        "error",
        `[Autosave] Falha ao resolver prefabs do rascunho: ${resolvedResult.error}`
      );
      return false;
    }

    const resolved = parseSceneJson(resolvedResult.scene_json);
    if (!resolved) {
      logMessage("error", "[Autosave] Falha ao reconstruir a cena do rascunho.");
      return false;
    }

    if (draft.scenePath) {
      setActiveScenePath(draft.scenePath);
    }
    setActiveScene(resolved, source);
    logMessage(
      "success",
      "[Autosave] Rascunho local restaurado no editor (nada foi gravado em disco)."
    );
    return true;
  } catch (error) {
    logMessage("error", `[Autosave] ${describeError(error)}`);
    return false;
  }
}
