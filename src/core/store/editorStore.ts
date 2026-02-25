import { create } from "zustand";

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
}

let _entryCounter = 0;

export const useEditorStore = create<EditorState>((set) => ({
  selectedEntityId: null,
  setSelectedEntityId: (id) => set({ selectedEntityId: id }),

  activeViewportTab: "scene",
  setActiveViewportTab: (id) => set({ activeViewportTab: id }),

  consoleEntries: [
    {
      id: 0,
      level: "info",
      message: "RetroDev Studio iniciado. Fase 1 — Sprint 1.1 UI Base.",
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
}));
