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
