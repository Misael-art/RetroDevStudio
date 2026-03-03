import { getSceneData, parseScene, saveSceneData } from "./ipc/sceneService";
import { useEditorStore } from "./store/editorStore";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function reloadSceneFromDisk(projectDir: string, scope: string): Promise<boolean> {
  const { logMessage, setActiveScene } = useEditorStore.getState();

  try {
    const sceneData = await getSceneData(projectDir);
    if (!sceneData.ok) {
      logMessage("error", `[${scope}] Falha ao recarregar cena: ${sceneData.error}`);
      return false;
    }

    const scene = parseScene(sceneData);
    if (!scene) {
      logMessage("error", `[${scope}] Falha ao reidratar a cena salva.`);
      return false;
    }

    setActiveScene(scene);
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
  const { activeScene, logMessage } = useEditorStore.getState();
  if (!activeScene) {
    return true;
  }

  try {
    const result = await saveSceneData(projectDir, JSON.stringify(activeScene, null, 2));
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
