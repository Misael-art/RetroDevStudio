import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";

import type { Scene } from "../ipc/sceneService";
import { validateSceneDraft } from "../ipc/hwService";
import {
  useEditorStore,
  type HwStatus,
  type HwValidationState,
} from "../store/editorStore";

export const LIVE_VALIDATION_DEBOUNCE_MS = 200;

export function serializeSceneDraft(scene: Scene): string {
  return JSON.stringify(scene);
}

export function getLiveBuildBlockReason({
  activeProjectDir,
  building,
  hwStatus,
  hwValidationState,
}: {
  activeProjectDir: string;
  building: boolean;
  hwStatus: HwStatus | null;
  hwValidationState: HwValidationState;
}): string | null {
  if (!activeProjectDir) {
    return "Abra um projeto para gerar a ROM.";
  }

  if (building) {
    return "Build em andamento.";
  }

  if (hwValidationState === "fresh" && hwStatus && hwStatus.errors.length > 0) {
    return `Build bloqueado: ${hwStatus.errors[0]}`;
  }

  return null;
}

export function getLiveBuildWarningSummary({
  activeProjectDir,
  building,
  hwStatus,
  hwValidationState,
}: {
  activeProjectDir: string;
  building: boolean;
  hwStatus: HwStatus | null;
  hwValidationState: HwValidationState;
}): string | null {
  if (!activeProjectDir || building) {
    return null;
  }

  if (
    hwValidationState === "fresh" &&
    hwStatus &&
    hwStatus.errors.length === 0 &&
    hwStatus.warnings.length > 0
  ) {
    return `Build com alerta: ${hwStatus.warnings[0]}`;
  }

  return null;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useLiveValidationController() {
  const {
    activeProjectDir,
    activeTarget,
    activeScene,
    sceneRevision,
    resetHwValidation,
    setHwValidationPending,
    setHwValidationResult,
    setHwValidationError,
  } = useEditorStore(
    useShallow((state) => ({
      activeProjectDir: state.activeProjectDir,
      activeTarget: state.activeTarget,
      activeScene: state.activeScene,
      sceneRevision: state.sceneRevision,
      resetHwValidation: state.resetHwValidation,
      setHwValidationPending: state.setHwValidationPending,
      setHwValidationResult: state.setHwValidationResult,
      setHwValidationError: state.setHwValidationError,
    }))
  );

  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!activeProjectDir || !activeScene) {
      requestIdRef.current += 1;
      resetHwValidation();
      return;
    }

    const currentRevision = sceneRevision;
    const requestId = ++requestIdRef.current;

    setHwValidationPending(currentRevision);

    const timeoutId = window.setTimeout(async () => {
      try {
        const result = await validateSceneDraft(
          activeProjectDir,
          serializeSceneDraft(activeScene)
        );
        const state = useEditorStore.getState();

        if (
          requestId !== requestIdRef.current ||
          state.activeProjectDir !== activeProjectDir ||
          state.activeTarget !== activeTarget ||
          state.sceneRevision !== currentRevision
        ) {
          return;
        }

        if (!result.ok) {
          state.setHwValidationError(currentRevision, result.error);
          return;
        }

        state.setHwValidationResult(currentRevision, result.hw_status);
      } catch (error) {
        const state = useEditorStore.getState();
        if (
          requestId !== requestIdRef.current ||
          state.activeProjectDir !== activeProjectDir ||
          state.activeTarget !== activeTarget ||
          state.sceneRevision !== currentRevision
        ) {
          return;
        }

        state.setHwValidationError(currentRevision, describeError(error));
      }
    }, LIVE_VALIDATION_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    activeProjectDir,
    activeScene,
    activeTarget,
    resetHwValidation,
    sceneRevision,
    setHwValidationError,
    setHwValidationPending,
    setHwValidationResult,
  ]);
}
