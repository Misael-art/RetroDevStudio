import { create } from "zustand";

import type { BackgroundLayer, Entity, Scene } from "../ipc/sceneService";

export interface HwStatus {
  vram_used: number;
  vram_limit: number;
  sprite_count: number;
  sprite_limit: number;
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

export interface StoreState {
  activeProjectDir: string;
  activeProjectName: string;
  activeTarget: "megadrive" | "snes";
  selectedEntityId: string | null;
  activeViewportTab: string;
  consoleEntries: ConsoleEntry[];
  consoleVisible: boolean;
  hwStatus: HwStatus | null;
  sceneRevision: number;
  hwValidationState: HwValidationState;
  hwValidatedRevision: number;
  hwValidationError: string | null;
  activeScene: Scene | null;
  emulPaused: boolean;
}

export interface StoreActions {
  setActiveProject: (dir: string, name: string) => void;
  setActiveTarget: (target: "megadrive" | "snes") => void;
  setSelectedEntityId: (id: string | null) => void;
  setActiveViewportTab: (id: string) => void;
  logMessage: (level: ConsoleEntry["level"], message: string) => void;
  clearConsole: () => void;
  toggleConsole: () => void;
  setHwStatus: (status: HwStatus | null) => void;
  setHwValidationPending: (revision: number) => void;
  setHwValidationResult: (revision: number, status: HwStatus) => void;
  setHwValidationError: (revision: number, error: string) => void;
  resetHwValidation: () => void;
  setActiveScene: (scene: Scene | null) => void;
  updateEntity: (entityId: string, patch: Partial<Entity>) => void;
  addEntity: (entity: Entity) => void;
  removeEntity: (entityId: string) => void;
  updateBackgroundLayer: (layerId: string, patch: Partial<BackgroundLayer>) => void;
  setEmulPaused: (paused: boolean) => void;
}

export type EditorState = StoreState & StoreActions;

const INITIAL_VALIDATION_STATE = {
  hwValidationState: "idle" as HwValidationState,
  hwValidatedRevision: 0,
  hwValidationError: null as string | null,
};

let _entryCounter = 0;

export const useEditorStore = create<EditorState>((set) => ({
  activeProjectDir: "",
  activeProjectName: "",
  activeTarget: "megadrive",
  setActiveProject: (dir, name) => set({ activeProjectDir: dir, activeProjectName: name }),
  setActiveTarget: (target) => set({ activeTarget: target }),

  selectedEntityId: null,
  setSelectedEntityId: (id) => set({ selectedEntityId: id }),

  activeViewportTab: "scene",
  setActiveViewportTab: (id) => set({ activeViewportTab: id }),

  consoleEntries: [
    {
      id: 0,
      level: "info",
      message: "RetroDev Studio iniciado. Roadmap MVP completo. Use Arquivo -> Abrir/Novo Projeto.",
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
  resetHwValidation: () => set({ ...INITIAL_VALIDATION_STATE }),

  activeScene: null,
  setActiveScene: (scene) =>
    set((state) => ({
      activeScene: scene,
      sceneRevision: scene ? state.sceneRevision + 1 : 0,
      ...(scene ? {} : INITIAL_VALIDATION_STATE),
    })),
  updateEntity: (entityId, patch) =>
    set((state) => {
      if (!state.activeScene) return {};
      return {
        activeScene: {
          ...state.activeScene,
          entities: state.activeScene.entities.map((entity) =>
            entity.entity_id === entityId ? { ...entity, ...patch } : entity
          ),
        },
        sceneRevision: state.sceneRevision + 1,
      };
    }),
  addEntity: (entity) =>
    set((state) => {
      if (!state.activeScene) return {};
      return {
        activeScene: {
          ...state.activeScene,
          entities: [...state.activeScene.entities, entity],
        },
        sceneRevision: state.sceneRevision + 1,
      };
    }),
  removeEntity: (entityId) =>
    set((state) => {
      if (!state.activeScene) return {};
      return {
        activeScene: {
          ...state.activeScene,
          entities: state.activeScene.entities.filter((entity) => entity.entity_id !== entityId),
        },
        selectedEntityId: state.selectedEntityId === entityId ? null : state.selectedEntityId,
        sceneRevision: state.sceneRevision + 1,
      };
    }),
  updateBackgroundLayer: (layerId, patch) =>
    set((state) => {
      if (!state.activeScene) return {};
      return {
        activeScene: {
          ...state.activeScene,
          background_layers: state.activeScene.background_layers.map((layer) =>
            layer.layer_id === layerId ? { ...layer, ...patch } : layer
          ),
        },
        sceneRevision: state.sceneRevision + 1,
      };
    }),

  emulPaused: false,
  setEmulPaused: (paused) => set({ emulPaused: paused }),
}));
