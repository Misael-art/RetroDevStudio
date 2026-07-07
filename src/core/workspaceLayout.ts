import type { EditorWorkspace } from "./store/editorStore";

/** Presets de layout do shell — alinhados a tarefas de produção (Option B). */
export type LayoutPresetId = "authoring" | "art" | "logic" | "playtest" | "debug";

export type LayoutMap = {
  left: number;
  center: number;
  right: number;
};

export type RightPanelMode = "inspector" | "tools" | "hidden";

export type WorkspaceShellConfig = {
  preset: LayoutPresetId;
  panels: LayoutMap;
  showLeft: boolean;
  showRight: boolean;
  defaultRightMode: RightPanelMode;
  leftLabel: string;
  rightLabel: string;
  /** Maximiza área central no modo Focus deste workspace. */
  focusLayout: LayoutMap;
};

/**
 * 1440 alinha o corte compacto ao estudo de UI (fatia 1 v2): hosts como
 * Steam Deck (1280x800) e notebooks 1366x768 entram no perfil compacto.
 */
const COMPACT_WIDTH = 1440;
const NARROW_WIDTH = 960;

/** Densidade macro do shell por largura do host (estudo de UI, fatia 1 v2). */
export type ShellDensity = "compact" | "standard" | "wide";

export const SHELL_DENSITY_STANDARD_MIN = COMPACT_WIDTH;
export const SHELL_DENSITY_WIDE_MIN = 2400;

export function getShellDensity(width: number): ShellDensity {
  if (width < SHELL_DENSITY_STANDARD_MIN) {
    return "compact";
  }
  if (width >= SHELL_DENSITY_WIDE_MIN) {
    return "wide";
  }
  return "standard";
}

/**
 * Layout salvo passa a ser por perfil de densidade, para um host pequeno nao
 * herdar layout de ultrawide. `standard` mantem a chave legada para preservar
 * layouts ja salvos pelos usuarios.
 */
export function getLayoutStorageKeyForDensity(
  baseKey: string,
  density: ShellDensity
): string {
  return density === "standard" ? baseKey : `${baseKey}::${density}`;
}

function isCompact(width: number): boolean {
  return width < COMPACT_WIDTH;
}

function isNarrow(width: number): boolean {
  return width < NARROW_WIDTH;
}

/** Layout horizontal padrão por preset e largura do shell. */
export function getPresetLayout(preset: LayoutPresetId, width: number): LayoutMap {
  const compact = isCompact(width);
  const narrow = isNarrow(width);

  if (preset === "playtest") {
    return { left: 0, center: 100, right: 0 };
  }

  if (preset === "art") {
    if (narrow) {
      return { left: 0, center: 100, right: 0 };
    }
    return { left: 0, center: 100, right: 0 };
  }

  if (preset === "debug") {
    if (narrow) {
      return { left: 0, center: 52, right: 48 };
    }
    if (compact) {
      return { left: 0, center: 54, right: 46 };
    }
    return { left: 0, center: 58, right: 42 };
  }

  if (preset === "logic") {
    if (narrow) {
      return { left: 0, center: 68, right: 32 };
    }
    if (compact) {
      return { left: 12, center: 63, right: 25 };
    }
    return { left: 14, center: 61, right: 25 };
  }

  // authoring (Scene / Explorer)
  if (narrow) {
    return { left: 0, center: 72, right: 28 };
  }
  if (compact) {
    return { left: 16, center: 64, right: 20 };
  }
  return { left: 18, center: 60, right: 22 };
}

export function resolveLayoutPreset(workspace: EditorWorkspace): LayoutPresetId {
  switch (workspace) {
    case "game":
      return "playtest";
    case "artstudio":
    case "retrofx":
      return "art";
    case "logic":
      return "logic";
    case "debug":
      return "debug";
    default:
      return "authoring";
  }
}

export function resolveWorkspaceShellConfig(
  workspace: EditorWorkspace,
  shellWidth: number
): WorkspaceShellConfig {
  const preset = resolveLayoutPreset(workspace);
  const panels = getPresetLayout(preset, shellWidth);

  switch (workspace) {
    case "scene":
      return {
        preset,
        panels,
        showLeft: true,
        showRight: true,
        defaultRightMode: "inspector",
        leftLabel: "Hierarchy",
        rightLabel: "Inspector",
        focusLayout: { left: 0, center: 100, right: 0 },
      };
    case "game":
      return {
        preset,
        panels,
        showLeft: false,
        showRight: false,
        defaultRightMode: "hidden",
        leftLabel: "Hierarchy",
        rightLabel: "Runtime",
        focusLayout: { left: 0, center: 100, right: 0 },
      };
    case "artstudio":
    case "retrofx":
      return {
        preset,
        panels,
        showLeft: false,
        showRight: false,
        defaultRightMode: "hidden",
        leftLabel: "Assets",
        rightLabel: "Art Inspector",
        focusLayout: { left: 0, center: 100, right: 0 },
      };
    case "logic":
      return {
        preset,
        panels: { left: 0, center: 100, right: 0 },
        showLeft: false,
        showRight: false,
        defaultRightMode: "hidden",
        leftLabel: "Palette",
        rightLabel: "Propriedades",
        focusLayout: { left: 0, center: 100, right: 0 },
      };
    case "debug":
      return {
        preset,
        panels,
        showLeft: false,
        showRight: true,
        defaultRightMode: "tools",
        leftLabel: "Diag",
        rightLabel: "Debug Tools",
        focusLayout: { left: 0, center: 100, right: 0 },
      };
    case "explorer":
      return {
        preset,
        panels: isNarrow(shellWidth)
          ? { left: 0, center: 100, right: 0 }
          : { left: 0, center: 68, right: 32 },
        showLeft: false,
        showRight: true,
        defaultRightMode: "inspector",
        leftLabel: "Projeto",
        rightLabel: "Inspector",
        focusLayout: { left: 0, center: 100, right: 0 },
      };
    default:
      return {
        preset: "authoring",
        panels: getPresetLayout("authoring", shellWidth),
        showLeft: true,
        showRight: true,
        defaultRightMode: "inspector",
        leftLabel: "Hierarchy",
        rightLabel: "Inspector",
        focusLayout: { left: 0, center: 100, right: 0 },
      };
  }
}

/** Compatibilidade com chave legada `artist` em localStorage. */
export function normalizeStoredLayoutPreset(value: string | null | undefined): LayoutPresetId {
  if (value === "artist") {
    return "authoring";
  }
  if (
    value === "authoring" ||
    value === "art" ||
    value === "logic" ||
    value === "playtest" ||
    value === "debug"
  ) {
    return value;
  }
  return "authoring";
}
