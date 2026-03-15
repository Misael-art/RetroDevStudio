import { create } from "zustand";

import type { BackgroundLayer, Entity, Scene } from "../ipc/sceneService";

const UNDO_STACK_LIMIT = 50;

export interface HwStatus {
  vram_used: number;
  vram_limit: number;
  sprite_count: number;
  sprite_limit: number;
  scanline_sprite_peak: number;
  scanline_sprite_limit: number;
  dma_used: number;
  dma_limit: number;
  palette_banks_used: number;
  palette_banks_limit: number;
  bg_layers: number;
  bg_layers_limit: number;
  errors: string[];
  warnings: string[];
}

export type HwValidationState = "idle" | "pending" | "fresh" | "stale" | "error";

export interface ConsoleEntry {
  id: number;
  level: "info" | "warn" | "error" | "success";
  message: string;
  timestamp: string;
}

export interface Tab {
  id: string;
  label: string;
  panel: "hierarchy" | "inspector" | "viewport" | "console";
}

export interface UndoEntry {
  activeScene: Scene | null;
  activeSceneSource: Scene | null;
  selectedEntityId: string | null;
}

export interface StoreState {
  activeProjectDir: string;
  activeProjectName: string;
  activeTarget: "megadrive" | "snes";
  activeScenePath: string;
  emulatorLoaded: boolean;
  selectedEntityId: string | null;
  activeViewportTab: string;
  consoleEntries: ConsoleEntry[];
  consoleVisible: boolean;
  hwStatus: HwStatus | null;
  sceneRevision: number;
  hwValidationState: HwValidationState;
  hwValidatedRevision: number;
  hwValidationError: string | null;
  hwValidationRefreshTick: number;
  undoStack: UndoEntry[];
  redoStack: UndoEntry[];
  pendingHistorySnapshot: UndoEntry | null;
  activeScene: Scene | null;
  activeSceneSource: Scene | null;
  emulPaused: boolean;
}

export interface StoreActions {
  setActiveProject: (dir: string, name: string) => void;
  setActiveTarget: (target: "megadrive" | "snes") => void;
  setActiveScenePath: (path: string) => void;
  setEmulatorLoaded: (loaded: boolean) => void;
  setSelectedEntityId: (id: string | null) => void;
  setActiveViewportTab: (id: string) => void;
  logMessage: (level: ConsoleEntry["level"], message: string) => void;
  clearConsole: () => void;
  toggleConsole: () => void;
  setHwStatus: (status: HwStatus | null) => void;
  setHwValidationPending: (revision: number) => void;
  setHwValidationResult: (revision: number, status: HwStatus) => void;
  setHwValidationError: (revision: number, error: string) => void;
  requestHwValidationRefresh: () => void;
  resetHwValidation: () => void;
  setActiveScene: (scene: Scene | null, sourceScene?: Scene | null) => void;
  beginHistoryCapture: () => void;
  commitHistoryCapture: () => void;
  cancelHistoryCapture: () => void;
  updateEntity: (
    entityId: string,
    patch: Partial<Entity>,
    options?: { recordHistory?: boolean }
  ) => void;
  addEntity: (entity: Entity) => void;
  removeEntity: (entityId: string) => void;
  updateBackgroundLayer: (layerId: string, patch: Partial<BackgroundLayer>) => void;
  undo: () => void;
  redo: () => void;
  setEmulPaused: (paused: boolean) => void;
}

export type EditorState = StoreState & StoreActions;

const INITIAL_VALIDATION_STATE = {
  hwValidationState: "idle" as HwValidationState,
  hwValidatedRevision: 0,
  hwValidationError: null as string | null,
};

let _entryCounter = 0;

function cloneSceneSnapshot(scene: Scene | null): Scene | null {
  return scene ? structuredClone(scene) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergePatchedValue<T>(current: T, patch: unknown): T {
  if (!isRecord(patch)) {
    return structuredClone(patch) as T;
  }

  const currentRecord: Record<string, unknown> = isRecord(current) ? current : {};
  const merged: Record<string, unknown> = { ...currentRecord };

  for (const [key, value] of Object.entries(patch)) {
    merged[key] = mergePatchedValue(currentRecord[key], value);
  }

  return merged as T;
}

function prunePatchAgainstBase(patch: unknown, base: unknown): unknown | undefined {
  if (!isRecord(patch)) {
    return Object.is(patch, base) ? undefined : structuredClone(patch);
  }

  const baseRecord = isRecord(base) ? base : {};
  const pruned: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(patch)) {
    const child = prunePatchAgainstBase(value, baseRecord[key]);
    if (child !== undefined) {
      pruned[key] = child;
    }
  }

  return Object.keys(pruned).length > 0 ? pruned : undefined;
}

function cloneUndoEntry(entry: UndoEntry): UndoEntry {
  return {
    activeScene: cloneSceneSnapshot(entry.activeScene),
    activeSceneSource: cloneSceneSnapshot(entry.activeSceneSource),
    selectedEntityId: entry.selectedEntityId,
  };
}

function createUndoEntry(
  state: Pick<StoreState, "activeScene" | "activeSceneSource" | "selectedEntityId">
): UndoEntry {
  return {
    activeScene: cloneSceneSnapshot(state.activeScene),
    activeSceneSource: cloneSceneSnapshot(state.activeSceneSource),
    selectedEntityId: state.selectedEntityId,
  };
}

function pushHistoryEntry(stack: UndoEntry[], entry: UndoEntry): UndoEntry[] {
  return [...stack, cloneUndoEntry(entry)].slice(-UNDO_STACK_LIMIT);
}

function resolveSceneSelection(scene: Scene | null, previousSelection: string | null): string | null {
  if (!scene) {
    return null;
  }

  if (previousSelection) {
    const selectionStillExists = previousSelection.startsWith("layer::")
      ? scene.background_layers.some((layer) => `layer::${layer.layer_id}` === previousSelection)
      : scene.entities.some((entity) => entity.entity_id === previousSelection);

    if (selectionStillExists) {
      return previousSelection;
    }
  }

  if (scene.entities.length > 0) {
    return scene.entities[0].entity_id;
  }

  if (scene.background_layers.length > 0) {
    return `layer::${scene.background_layers[0].layer_id}`;
  }

  return null;
}

export const useEditorStore = create<EditorState>((set) => ({
  activeProjectDir: "",
  activeProjectName: "",
  activeTarget: "megadrive",
  setActiveProject: (dir, name) => set({ activeProjectDir: dir, activeProjectName: name }),
  setActiveTarget: (target) => set({ activeTarget: target }),
  activeScenePath: "",
  setActiveScenePath: (path) => set({ activeScenePath: path }),
  emulatorLoaded: false,
  setEmulatorLoaded: (loaded) => set({ emulatorLoaded: loaded }),

  selectedEntityId: null,
  setSelectedEntityId: (id) => set({ selectedEntityId: id }),

  activeViewportTab: "scene",
  setActiveViewportTab: (id) => set({ activeViewportTab: id }),

  consoleEntries: [
    {
      id: 0,
      level: "info",
      message:
        "RetroDev Studio iniciado. Status: release candidate / beta testing do desktop Tauri. Use Arquivo -> Abrir/Novo Projeto.",
      timestamp: new Date().toLocaleTimeString(),
    },
  ],
  logMessage: (level, message) =>
    set((state) => ({
      consoleEntries: [
        ...state.consoleEntries,
        {
          id: ++_entryCounter,
          level,
          message,
          timestamp: new Date().toLocaleTimeString(),
        },
      ],
    })),
  clearConsole: () => set({ consoleEntries: [] }),

  consoleVisible: true,
  toggleConsole: () => set((state) => ({ consoleVisible: !state.consoleVisible })),

  hwStatus: null,
  setHwStatus: (status) => set({ hwStatus: status }),
  sceneRevision: 0,
  ...INITIAL_VALIDATION_STATE,
  hwValidationRefreshTick: 0,
  undoStack: [],
  redoStack: [],
  pendingHistorySnapshot: null,
  setHwValidationPending: (revision) =>
    set((state) => ({
      hwValidationState:
        state.hwValidatedRevision > 0 && state.hwValidatedRevision < revision && state.hwStatus
          ? "stale"
          : "pending",
      hwValidationError: null,
    })),
  setHwValidationResult: (revision, status) =>
    set({
      hwStatus: status,
      hwValidationState: "fresh",
      hwValidatedRevision: revision,
      hwValidationError: null,
    }),
  setHwValidationError: (revision, error) =>
    set({
      hwValidationState: "error",
      hwValidatedRevision: revision,
      hwValidationError: error,
    }),
  requestHwValidationRefresh: () =>
    set((state) => ({
      hwValidationRefreshTick: state.hwValidationRefreshTick + 1,
    })),
  resetHwValidation: () => set({ ...INITIAL_VALIDATION_STATE }),

  activeScene: null,
  activeSceneSource: null,
  setActiveScene: (scene, sourceScene = scene) =>
    set((state) => ({
      activeScene: scene,
      activeSceneSource: sourceScene,
      selectedEntityId: resolveSceneSelection(scene, state.selectedEntityId),
      sceneRevision: scene ? state.sceneRevision + 1 : 0,
      undoStack: [],
      redoStack: [],
      pendingHistorySnapshot: null,
      ...(scene ? {} : INITIAL_VALIDATION_STATE),
    })),
  beginHistoryCapture: () =>
    set((state) => {
      if (!state.activeScene || state.pendingHistorySnapshot) {
        return {};
      }

      return {
        pendingHistorySnapshot: createUndoEntry(state),
      };
    }),
  commitHistoryCapture: () =>
    set((state) => {
      if (!state.pendingHistorySnapshot) {
        return {};
      }

      return {
        undoStack: pushHistoryEntry(state.undoStack, state.pendingHistorySnapshot),
        redoStack: [],
        pendingHistorySnapshot: null,
      };
    }),
  cancelHistoryCapture: () => set({ pendingHistorySnapshot: null }),
  updateEntity: (entityId, patch, options) =>
    set((state) => {
      if (!state.activeScene) return {};
      const recordHistory = options?.recordHistory ?? true;
      const resolvedEntity = state.activeScene.entities.find((entity) => entity.entity_id === entityId);
      const preferredSourceScene = state.activeSceneSource ?? state.activeScene;
      const sourceScene = preferredSourceScene.entities.some((entity) => entity.entity_id === entityId)
        ? preferredSourceScene
        : state.activeScene;
      const sourceEntity = sourceScene.entities.find((entity) => entity.entity_id === entityId);
      if (!resolvedEntity || !sourceEntity) {
        return {};
      }

      const sourcePatch = prunePatchAgainstBase(patch, resolvedEntity);
      return {
        ...(recordHistory
          ? {
              undoStack: pushHistoryEntry(state.undoStack, createUndoEntry(state)),
              redoStack: [],
              pendingHistorySnapshot: null,
            }
          : {}),
        activeScene: {
          ...state.activeScene,
          entities: state.activeScene.entities.map((entity) =>
            entity.entity_id === entityId ? mergePatchedValue(entity, patch) : entity
          ),
        },
        activeSceneSource: {
          ...sourceScene,
          entities: sourceScene.entities.map((entity) =>
            entity.entity_id === entityId && sourcePatch !== undefined
              ? mergePatchedValue(entity, sourcePatch)
              : entity
          ),
        },
        sceneRevision: state.sceneRevision + 1,
      };
    }),
  addEntity: (entity) =>
    set((state) => {
      if (!state.activeScene) return {};
      const sourceScene =
        state.activeSceneSource?.scene_id === state.activeScene.scene_id
          ? state.activeSceneSource
          : state.activeScene;
      return {
        undoStack: pushHistoryEntry(state.undoStack, createUndoEntry(state)),
        redoStack: [],
        pendingHistorySnapshot: null,
        activeScene: {
          ...state.activeScene,
          entities: [...state.activeScene.entities, entity],
        },
        activeSceneSource: {
          ...sourceScene,
          entities: [...sourceScene.entities, structuredClone(entity)],
        },
        sceneRevision: state.sceneRevision + 1,
      };
    }),
  removeEntity: (entityId) =>
    set((state) => {
      if (!state.activeScene) return {};
      const preferredSourceScene = state.activeSceneSource ?? state.activeScene;
      const sourceScene = preferredSourceScene.entities.some((entity) => entity.entity_id === entityId)
        ? preferredSourceScene
        : state.activeScene;
      return {
        undoStack: pushHistoryEntry(state.undoStack, createUndoEntry(state)),
        redoStack: [],
        pendingHistorySnapshot: null,
        activeScene: {
          ...state.activeScene,
          entities: state.activeScene.entities.filter((entity) => entity.entity_id !== entityId),
        },
        activeSceneSource: {
          ...sourceScene,
          entities: sourceScene.entities.filter((entity) => entity.entity_id !== entityId),
        },
        selectedEntityId: state.selectedEntityId === entityId ? null : state.selectedEntityId,
        sceneRevision: state.sceneRevision + 1,
      };
    }),
  updateBackgroundLayer: (layerId, patch) =>
    set((state) => {
      if (!state.activeScene) return {};
      const preferredSourceScene = state.activeSceneSource ?? state.activeScene;
      const sourceScene = preferredSourceScene.background_layers.some(
        (layer) => layer.layer_id === layerId
      )
        ? preferredSourceScene
        : state.activeScene;
      return {
        undoStack: pushHistoryEntry(state.undoStack, createUndoEntry(state)),
        redoStack: [],
        pendingHistorySnapshot: null,
        activeScene: {
          ...state.activeScene,
          background_layers: state.activeScene.background_layers.map((layer) =>
            layer.layer_id === layerId ? mergePatchedValue(layer, patch) : layer
          ),
        },
        activeSceneSource: {
          ...sourceScene,
          background_layers: sourceScene.background_layers.map((layer) =>
            layer.layer_id === layerId ? mergePatchedValue(layer, patch) : layer
          ),
        },
        sceneRevision: state.sceneRevision + 1,
      };
    }),
  undo: () =>
    set((state) => {
      const previous = state.undoStack[state.undoStack.length - 1];
      if (!previous) {
        return {
          pendingHistorySnapshot: null,
        };
      }

      return {
        activeScene: cloneSceneSnapshot(previous.activeScene),
        activeSceneSource: cloneSceneSnapshot(previous.activeSceneSource),
        selectedEntityId: previous.selectedEntityId,
        undoStack: state.undoStack.slice(0, -1),
        redoStack: pushHistoryEntry(state.redoStack, createUndoEntry(state)),
        pendingHistorySnapshot: null,
        sceneRevision: state.sceneRevision + 1,
      };
    }),
  redo: () =>
    set((state) => {
      const next = state.redoStack[state.redoStack.length - 1];
      if (!next) {
        return {
          pendingHistorySnapshot: null,
        };
      }

      return {
        activeScene: cloneSceneSnapshot(next.activeScene),
        activeSceneSource: cloneSceneSnapshot(next.activeSceneSource),
        selectedEntityId: next.selectedEntityId,
        undoStack: pushHistoryEntry(state.undoStack, createUndoEntry(state)),
        redoStack: state.redoStack.slice(0, -1),
        pendingHistorySnapshot: null,
        sceneRevision: state.sceneRevision + 1,
      };
    }),

  emulPaused: false,
  setEmulPaused: (paused) => set({ emulPaused: paused }),
}));
