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

export type LiveValidationStateMatchOutcome =
  | { matches: true }
  | { matches: false; reason: "no-state" }
  | { matches: false; reason: "wrong-state"; expected: string; actual: string }
  | { matches: false; reason: "wrong-revision"; expected: number; actual: number };

export function isLiveValidationStateMatchingRevision(
  validationState: { hwValidationState: string; hwValidatedRevision: number } | null,
  expectedState: string, expectedRevision: number
): LiveValidationStateMatchOutcome {
  if (!validationState) {
    return { matches: false, reason: "no-state" };
  }

  if (validationState.hwValidationState !== expectedState) {
    return { matches: false, reason: "wrong-state", expected: expectedState, actual: validationState.hwValidationState };
  }

  if (validationState.hwValidatedRevision !== expectedRevision) {
    return {
      matches: false,
      reason: "wrong-revision",
      expected: expectedRevision,
      actual: validationState.hwValidatedRevision,
    };
  }

  return { matches: true };
}

export type SceneDraftReceipt = { ok: true; sceneRevision: number };
export function isValidSceneDraftReceipt(receipt: unknown): receipt is SceneDraftReceipt {
  if (!receipt || typeof receipt !== "object") return false;
  const value = receipt as { ok?: unknown; sceneRevision?: unknown };
  return value.ok === true && typeof value.sceneRevision === "number" && Number.isSafeInteger(value.sceneRevision) && value.sceneRevision > 0;
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

export type LiveToolbarIndicatorTone = "ok" | "info" | "warn" | "error";

export interface LiveToolbarIndicator {
  label: string;
  tone: LiveToolbarIndicatorTone;
  detail: string;
}

export function getLiveToolbarIndicator({
  activeProjectDir,
  hwStatus,
  hwValidationError,
  hwValidationState,
}: {
  activeProjectDir: string;
  hwStatus: HwStatus | null;
  hwValidationError: string | null;
  hwValidationState: HwValidationState;
}): LiveToolbarIndicator | null {
  if (!activeProjectDir) {
    return null;
  }

  switch (hwValidationState) {
    case "pending":
      return {
        label: "ANALISANDO",
        tone: "info",
        detail: "Preview live em analise.",
      };
    case "stale":
      return {
        label: "DESATUAL.",
        tone: "warn",
        detail:
          "O draft mudou depois da ultima analise live. Edite a cena para acionar a revalidacao automatica ou use Revalidar agora.",
      };
    case "error":
      return {
        label: "ERRO LIVE",
        tone: "error",
        detail: hwValidationError ?? "Falha ao atualizar o preview live.",
      };
    case "fresh":
      if (hwStatus?.errors.length) {
        return {
          label: "BLOQUEADO",
          tone: "error",
          detail: hwStatus.errors[0],
        };
      }
      if (hwStatus?.warnings.length) {
        return {
          label: "WARN",
          tone: "warn",
          detail: hwStatus.warnings[0],
        };
      }
      return {
        label: "LIVE",
        tone: "ok",
        detail: "Preview live sincronizado.",
      };
    default:
      return null;
  }
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
    hwValidationRefreshTick,
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
      hwValidationRefreshTick: state.hwValidationRefreshTick,
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
    hwValidationRefreshTick,
    resetHwValidation,
    sceneRevision,
    setHwValidationError,
    setHwValidationPending,
    setHwValidationResult,
  ]);
}
