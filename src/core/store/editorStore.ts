import { create } from "zustand";

import type {
  BackgroundLayer,
  CollisionMap,
  Entity,
  LegacySgdkIndex,
  Scene,
  SceneLayer,
} from "../ipc/sceneService";

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
  editorMode: EditorMode;
}

export type EditorMode = "select" | "paint" | "erase" | "collision";
export type EditorWorkspace =
  | "explorer"
  | "scene"
  | "game"
  | "logic"
  | "retrofx"
  | "artstudio"
  | "debug";

export interface ActiveBrush {
  kind: "prefab" | "tile";
  id: string; // prefab filename or tile id
  assetPath?: string;
}

export interface StoreState {
  activeProjectDir: string;
  activeProjectName: string;
  activeTarget: "megadrive" | "snes";
  activeScenePath: string;
  emulatorLoaded: boolean;
  selectedEntityId: string | null;
  /** ID da camada ativa no LayerPanel. null = sem camada selecionada. */
  activeLayerId: string | null;
  activeWorkspace: EditorWorkspace;
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
  viewportZoom: number;
  projectSourceKind: string;
  projectLegacyIndex: LegacySgdkIndex | null;
  editorMode: EditorMode;
  activeBrush: ActiveBrush | null;
}

export interface StoreActions {
  setActiveProject: (dir: string, name: string) => void;
  setActiveTarget: (target: "megadrive" | "snes") => void;
  setActiveScenePath: (path: string) => void;
  setEmulatorLoaded: (loaded: boolean) => void;
  setSelectedEntityId: (id: string | null) => void;
  setActiveLayerId: (id: string | null) => void;
  setActiveWorkspace: (workspace: EditorWorkspace) => void;
  /** Cria uma nova camada na cena ativa. */
  createLayer: (name: string, kind: string) => void;
  /** Remove uma camada pelo id. Entidades da camada ficam sem camada atribuída. */
  deleteLayer: (layerId: string) => void;
  /** Atualiza campos de uma camada (name, visible, locked, depth). */
  updateLayer: (layerId: string, patch: Partial<SceneLayer>) => void;
  /** Move a camada para cima na profundidade (renderiza sobre as outras). */
  moveLayerUp: (layerId: string) => void;
  /** Move a camada para baixo na profundidade (renderiza atrás das outras). */
  moveLayerDown: (layerId: string) => void;
  /** Atribui uma entidade a uma camada (remove-a de outras camadas primeiro). */
  assignEntityToLayer: (entityId: string, layerId: string | null) => void;
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
  /**
   * Pinta ou apaga um tile do collision_map pelo índice linear.
   * Se collision_map ainda não existe na cena, auto-inicializa com dimensões
   * padrão do activeTarget (MD=40x28, SNES=32x28, tile=8x8).
   * Não empurra o undo stack — use beginHistoryCapture / commitHistoryCapture
   * ao redor do drag para criar uma entrada única de undo.
   */
  updateCollisionMap: (tileIndex: number, value: 0 | 1) => void;
  undo: () => void;
  redo: () => void;
  setEmulPaused: (paused: boolean) => void;
  setViewportZoom: (zoom: number) => void;
  resetViewportZoom: () => void;
  setProjectSourceKind: (kind: string) => void;
  setProjectLegacyIndex: (index: LegacySgdkIndex | null) => void;
  setEditorMode: (mode: EditorMode) => void;
  setActiveBrush: (brush: ActiveBrush | null) => void;
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

function preserveInheritedGraphRef(
  sourcePatch: unknown,
  patch: unknown,
  sourceEntity: Entity,
  resolvedEntity: Entity
): unknown | undefined {
  if (!isRecord(sourcePatch) || !isRecord(patch)) {
    return sourcePatch;
  }

  const patchComponents = isRecord(patch.components) ? patch.components : null;
  const patchLogic = patchComponents && isRecord(patchComponents.logic) ? patchComponents.logic : null;
  if (!patchLogic || !Object.prototype.hasOwnProperty.call(patchLogic, "graph")) {
    return sourcePatch;
  }

  const resolvedGraphRef = resolvedEntity.components.logic?.graph_ref;
  const sourceGraphRef = sourceEntity.components.logic?.graph_ref;
  if (!resolvedGraphRef || sourceGraphRef) {
    return sourcePatch;
  }

  const nextPatch = structuredClone(sourcePatch) as Record<string, unknown>;
  const nextComponents = isRecord(nextPatch.components)
    ? { ...(nextPatch.components as Record<string, unknown>) }
    : {};
  const nextLogic = isRecord(nextComponents.logic)
    ? { ...(nextComponents.logic as Record<string, unknown>) }
    : {};
  nextLogic.graph_ref = resolvedGraphRef;
  nextComponents.logic = nextLogic;
  nextPatch.components = nextComponents;
  return nextPatch;
}

function cloneUndoEntry(entry: UndoEntry): UndoEntry {
  return {
    activeScene: cloneSceneSnapshot(entry.activeScene),
    activeSceneSource: cloneSceneSnapshot(entry.activeSceneSource),
    selectedEntityId: entry.selectedEntityId,
    editorMode: entry.editorMode,
  };
}

function createUndoEntry(
  state: Pick<StoreState, "activeScene" | "activeSceneSource" | "selectedEntityId" | "editorMode">
): UndoEntry {
  return {
    activeScene: cloneSceneSnapshot(state.activeScene),
    activeSceneSource: cloneSceneSnapshot(state.activeSceneSource),
    selectedEntityId: state.selectedEntityId,
    editorMode: state.editorMode,
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
    const preferredEntity = [...scene.entities].sort((left, right) => {
      const score = (entity: Entity) => {
        let total = 0;
        if (entity.entity_id === "player") total += 100;
        if (entity.components?.logic) total += 60;
        if (entity.components?.sprite) total += 40;
        if (entity.components?.camera) total += 20;
        if (entity.components?.tilemap) total += 10;
        return total;
      };

      return score(right) - score(left);
    })[0];

    return preferredEntity?.entity_id ?? scene.entities[0].entity_id;
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

  activeWorkspace: "scene",
  setActiveWorkspace: (workspace) => set({ activeWorkspace: workspace }),
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
      consoleVisible: level === "error" ? true : state.consoleVisible,
    })),
  clearConsole: () => set({ consoleEntries: [] }),

  consoleVisible: false,
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

  activeLayerId: null,
  setActiveLayerId: (id) => set({ activeLayerId: id }),

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

      const sourcePatch = preserveInheritedGraphRef(
        prunePatchAgainstBase(patch, resolvedEntity),
        patch,
        sourceEntity,
        resolvedEntity
      );
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
  updateCollisionMap: (tileIndex, value) =>
    set((state) => {
      if (!state.activeScene) return {};

      // Auto-inicializa o mapa se ainda é null.
      const defaultDims: Record<"megadrive" | "snes", Pick<CollisionMap, "width" | "height" | "tile_width" | "tile_height">> = {
        megadrive: { width: 40, height: 28, tile_width: 8, tile_height: 8 },
        snes:      { width: 32, height: 28, tile_width: 8, tile_height: 8 },
      };

      const existingMap = state.activeScene.collision_map;
      const collisionMap: CollisionMap = existingMap ?? {
        ...defaultDims[state.activeTarget],
        data: Array<number>(
          defaultDims[state.activeTarget].width * defaultDims[state.activeTarget].height
        ).fill(0),
      };

      // Guarda limites: ignora índice fora do array.
      const capacity = collisionMap.width * collisionMap.height;
      if (tileIndex < 0 || tileIndex >= capacity) return {};

      const newData = collisionMap.data.slice();
      newData[tileIndex] = value;

      return {
        activeScene: {
          ...state.activeScene,
          collision_map: { ...collisionMap, data: newData },
        },
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

  viewportZoom: 1.75,
  setViewportZoom: (zoom) =>
    set({ viewportZoom: Math.min(4.0, Math.max(0.25, zoom)) }),
  resetViewportZoom: () => set({ viewportZoom: 1.75 }),

  projectSourceKind: "",
  setProjectSourceKind: (kind) => set({ projectSourceKind: kind }),
  projectLegacyIndex: null,
  setProjectLegacyIndex: (index) => set({ projectLegacyIndex: index }),

  editorMode: "select",
  setEditorMode: (mode) => set({ editorMode: mode }),

  activeBrush: null,
  setActiveBrush: (brush) => set({ activeBrush: brush }),

  createLayer: (name, kind) =>
    set((state) => {
      if (!state.activeScene) return {};
      const id = `layer_${Date.now()}`;
      const newLayer: SceneLayer = {
        id,
        name,
        kind,
        visible: true,
        locked: false,
        depth: (state.activeScene.layers?.length ?? 0),
        entity_ids: [],
      };
      const currentLayers = state.activeScene.layers ?? [];
      const sourceLayers = state.activeSceneSource?.layers ?? currentLayers;
      return {
        undoStack: pushHistoryEntry(state.undoStack, createUndoEntry(state)),
        redoStack: [],
        pendingHistorySnapshot: null,
        activeScene: { ...state.activeScene, layers: [...currentLayers, newLayer] },
        activeSceneSource: state.activeSceneSource
          ? { ...state.activeSceneSource, layers: [...sourceLayers, structuredClone(newLayer)] }
          : state.activeSceneSource,
        sceneRevision: state.sceneRevision + 1,
      };
    }),

  deleteLayer: (layerId) =>
    set((state) => {
      if (!state.activeScene) return {};
      const filterLayer = (layers: SceneLayer[] | null | undefined) =>
        (layers ?? []).filter((l) => l.id !== layerId);
      return {
        undoStack: pushHistoryEntry(state.undoStack, createUndoEntry(state)),
        redoStack: [],
        pendingHistorySnapshot: null,
        activeScene: { ...state.activeScene, layers: filterLayer(state.activeScene.layers) },
        activeSceneSource: state.activeSceneSource
          ? { ...state.activeSceneSource, layers: filterLayer(state.activeSceneSource.layers) }
          : state.activeSceneSource,
        activeLayerId: state.activeLayerId === layerId ? null : state.activeLayerId,
        sceneRevision: state.sceneRevision + 1,
      };
    }),

  updateLayer: (layerId, patch) =>
    set((state) => {
      if (!state.activeScene) return {};
      const applyPatch = (layers: SceneLayer[] | null | undefined): SceneLayer[] =>
        (layers ?? []).map((l) => (l.id === layerId ? { ...l, ...patch } : l));
      return {
        undoStack: pushHistoryEntry(state.undoStack, createUndoEntry(state)),
        redoStack: [],
        pendingHistorySnapshot: null,
        activeScene: { ...state.activeScene, layers: applyPatch(state.activeScene.layers) },
        activeSceneSource: state.activeSceneSource
          ? { ...state.activeSceneSource, layers: applyPatch(state.activeSceneSource.layers) }
          : state.activeSceneSource,
        sceneRevision: state.sceneRevision + 1,
      };
    }),
  
  moveLayerUp: (layerId) =>
    set((state) => {
      if (!state.activeScene) return {};
      const layers = [...(state.activeScene.layers ?? [])].sort((a, b) => a.depth - b.depth);
      const idx = layers.findIndex(l => l.id === layerId);
      if (idx === -1 || idx === layers.length - 1) return {};

      // Swap depth with the layer above it
      const tempDepth = layers[idx].depth;
      layers[idx].depth = layers[idx + 1].depth;
      layers[idx + 1].depth = tempDepth;

      return {
        undoStack: pushHistoryEntry(state.undoStack, createUndoEntry(state)),
        redoStack: [],
        activeScene: { ...state.activeScene, layers },
        sceneRevision: state.sceneRevision + 1,
      };
    }),

  moveLayerDown: (layerId) =>
    set((state) => {
      if (!state.activeScene) return {};
      const layers = [...(state.activeScene.layers ?? [])].sort((a, b) => a.depth - b.depth);
      const idx = layers.findIndex(l => l.id === layerId);
      if (idx <= 0) return {};

      // Swap depth with the layer below it
      const tempDepth = layers[idx].depth;
      layers[idx].depth = layers[idx - 1].depth;
      layers[idx - 1].depth = tempDepth;

      return {
        undoStack: pushHistoryEntry(state.undoStack, createUndoEntry(state)),
        redoStack: [],
        activeScene: { ...state.activeScene, layers },
        sceneRevision: state.sceneRevision + 1,
      };
    }),

  assignEntityToLayer: (entityId, layerId) =>
    set((state) => {
      if (!state.activeScene) return {};
      const reassign = (layers: SceneLayer[] | null | undefined): SceneLayer[] =>
        (layers ?? []).map((l) => ({
          ...l,
          entity_ids: l.id === layerId
            ? [...new Set([...l.entity_ids, entityId])]
            : l.entity_ids.filter((id) => id !== entityId),
        }));
      return {
        undoStack: pushHistoryEntry(state.undoStack, createUndoEntry(state)),
        redoStack: [],
        pendingHistorySnapshot: null,
        activeScene: { ...state.activeScene, layers: reassign(state.activeScene.layers) },
        activeSceneSource: state.activeSceneSource
          ? { ...state.activeSceneSource, layers: reassign(state.activeSceneSource.layers) }
          : state.activeSceneSource,
        sceneRevision: state.sceneRevision + 1,
      };
    }),
}));
