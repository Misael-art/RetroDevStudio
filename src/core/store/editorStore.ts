import { create } from "zustand";
import type { Scene, Entity } from "../ipc/sceneService";

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

interface EditorState {
  // Active project directory (empty = no project open)
  activeProjectDir: string;
  activeProjectName: string;
  activeTarget: "megadrive" | "snes";
  setActiveProject: (dir: string, name: string) => void;
  setActiveTarget: (target: "megadrive" | "snes") => void;

  // Selected entity in hierarchy
  selectedEntityId: string | null;
  setSelectedEntityId: (id: string | null) => void;

  // Active viewport tab
  activeViewportTab: string;
  setActiveViewportTab: (id: string) => void;

  // Console log entries
  consoleEntries: ConsoleEntry[];
  logMessage: (level: ConsoleEntry["level"], message: string) => void;
  clearConsole: () => void;

  // Console visibility
  consoleVisible: boolean;
  toggleConsole: () => void;

  // Hardware status (Sprint 1.5)
  hwStatus: HwStatus | null;
  setHwStatus: (status: HwStatus | null) => void;

  // Active scene data (Sprint P2)
  activeScene: Scene | null;
  setActiveScene: (scene: Scene | null) => void;
  updateEntity: (entityId: string, patch: Partial<Entity>) => void;
  addEntity: (entity: Entity) => void;
  removeEntity: (entityId: string) => void;
}

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
      message: "RetroDev Studio iniciado. Roadmap MVP completo. Use Arquivo → Abrir/Novo Projeto.",
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

  activeScene: null,
  setActiveScene: (scene) => set({ activeScene: scene }),
  updateEntity: (entityId, patch) =>
    set((state) => {
      if (!state.activeScene) return {};
      return {
        activeScene: {
          ...state.activeScene,
          entities: state.activeScene.entities.map((e) =>
            e.entity_id === entityId ? { ...e, ...patch } : e
          ),
        },
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
      };
    }),
  removeEntity: (entityId) =>
    set((state) => {
      if (!state.activeScene) return {};
      return {
        activeScene: {
          ...state.activeScene,
          entities: state.activeScene.entities.filter((e) => e.entity_id !== entityId),
        },
        selectedEntityId: state.selectedEntityId === entityId ? null : state.selectedEntityId,
      };
    }),
}));
