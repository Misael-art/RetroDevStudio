import { useEffect, useRef, useState } from "react";
import {
  Group,
  Panel,
  type GroupImperativeHandle,
  useDefaultLayout,
} from "react-resizable-panels";
import Console from "./components/common/Console";
import LayoutSplitter from "./components/common/LayoutSplitter";
import HierarchyPanel from "./components/hierarchy/HierarchyPanel";
import LayerPanel from "./components/hierarchy/LayerPanel";
import InspectorPanel from "./components/inspector/InspectorPanel";
import ToolsPanel, {
  type ToolTab,
  type ToolWorkspace,
} from "./components/tools/ToolsPanel";
import ViewportPanel from "./components/viewport/ViewportPanel";
import { buildProject, generateCCode, validateProject } from "./core/ipc/buildService";
import { emulatorLoadRom, emulatorStop } from "./core/ipc/emulatorService";
import { getHwStatus } from "./core/ipc/hwService";
import {
  createProjectFromTemplate,
  importSgdkProject,
  listProjectTemplates,
  openProjectDialog,
  openProjectPath,
  type ProjectTemplateSummary,
  setProjectTarget,
} from "./core/ipc/projectService";
import { pollProjectAssetChanges } from "./core/ipc/projectWatcherService";
import {
  getSceneData,
  type Entity,
  type Scene,
} from "./core/ipc/sceneService";
import { useEditorStore } from "./core/store/editorStore";
import {
  hydrateSceneResult,
  persistActiveScene,
  reloadSceneFromDisk,
} from "./core/scenePersistence";
import {
  detectRomDependency,
  getThirdPartyStatus,
  installThirdPartyDependency,
  type ThirdPartyDependencyId,
} from "./core/ipc/toolsService";
import {
  getLiveBuildBlockReason,
  getLiveToolbarIndicator,
  getLiveBuildWarningSummary,
  useLiveValidationController,
} from "./core/validation/liveValidationController";
import { getEntityDisplayName } from "./core/entityDisplay";

function ToolbarButton({
  label,
  onClick,
  disabled = false,
  accent = "default",
  testId,
  title,
  describedBy,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  accent?: "default" | "primary" | "success" | "danger";
  testId?: string;
  title?: string;
  describedBy?: string;
}) {
  const palette =
    accent === "primary"
      ? "bg-[#cba6f7] text-[#1e1e2e] hover:bg-[#b4a0e0]"
      : accent === "success"
        ? "bg-[#a6e3a1] text-[#1e1e2e] hover:bg-[#94e2a0]"
        : accent === "danger"
          ? "bg-[#f38ba8] text-[#1e1e2e] hover:bg-[#eba0ac]"
          : "bg-[#313244] text-[#a6adc8] hover:bg-[#45475a]";

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      title={title}
      aria-describedby={describedBy}
      className={`rounded px-2 py-1 text-xs font-semibold transition-colors ${palette} disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {label}
    </button>
  );
}

type ShellWorkspace = "scene" | "game" | "logic" | "retrofx" | "artstudio" | "debug";
type LayoutPresetId = "artist" | "logic" | "debug" | "playtest";
type LayoutMap = {
  left: number;
  center: number;
  right: number;
};

const LAYOUT_STORAGE_KEY = "retrodev-shell-saved-layout";

const WORKSPACE_ITEMS: {
  id: ShellWorkspace;
  label: string;
  icon: string;
  description: string;
}[] = [
  { id: "scene", label: "Scene", icon: "SC", description: "Composicao e edicao da cena" },
  { id: "game", label: "Game", icon: "GM", description: "Playtest e runtime" },
  { id: "logic", label: "Logic", icon: "LG", description: "Fluxo visual e scripting" },
  { id: "retrofx", label: "FX", icon: "FX", description: "Profundidade e parallax" },
  { id: "artstudio", label: "Art", icon: "AT", description: "Sprites, slicing e preview" },
  { id: "debug", label: "Debug", icon: "DB", description: "Analise e ferramentas avancadas" },
];

function getPresetLayout(preset: LayoutPresetId, width: number): LayoutMap {
  const compact = width < 1180;
  const narrow = width < 960;

  if (preset === "playtest") {
    return { left: 0, center: 100, right: 0 };
  }

  if (preset === "debug") {
    if (narrow) {
      return { left: 0, center: 54, right: 46 };
    }
    if (compact) {
      return { left: 10, center: 50, right: 40 };
    }
    return { left: 14, center: 50, right: 36 };
  }

  if (preset === "logic") {
    if (narrow) {
      return { left: 0, center: 68, right: 32 };
    }
    if (compact) {
      return { left: 14, center: 62, right: 24 };
    }
    return { left: 15, center: 60, right: 25 };
  }

  if (narrow) {
    return { left: 0, center: 72, right: 28 };
  }
  if (compact) {
    return { left: 16, center: 64, right: 20 };
  }
  return { left: 18, center: 60, right: 22 };
}

function WorkspaceRailButton({
  icon,
  label,
  active,
  title,
  onClick,
  accent = "default",
}: {
  icon: string;
  label: string;
  active: boolean;
  title: string;
  onClick: () => void;
  accent?: "default" | "debug";
}) {
  const activeTone =
    accent === "debug"
      ? "border-[#f9e2af]/45 bg-[#f9e2af]/12 text-[#f9e2af]"
      : "border-[#cba6f7]/45 bg-[#cba6f7]/14 text-[#e9d5ff]";

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`group flex w-full flex-col items-center gap-1 rounded-2xl border px-2 py-2 text-center transition-colors ${
        active
          ? activeTone
          : "border-transparent text-[#7f849c] hover:border-[#313244] hover:bg-[#11111b] hover:text-[#e5e7eb]"
      }`}
    >
      <span className="rounded-xl border border-current/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]">
        {icon}
      </span>
      <span className="text-[10px] font-semibold text-current">{label}</span>
    </button>
  );
}

function ToolbarVramBudget({
  used,
  limit,
  hasErrors,
  hasWarnings,
}: {
  used: number;
  limit: number;
  hasErrors: boolean;
  hasWarnings: boolean;
}) {
  const percent = Math.min(100, Math.round((used / Math.max(limit, 1)) * 100));
  const toneClass = hasErrors
    ? "bg-[#f38ba8]"
    : hasWarnings || percent >= 80
      ? "bg-[#fab387]"
      : "bg-[#a6e3a1]";

  return (
    <div
      data-testid="toolbar-vram-budget"
      className="flex min-w-[9rem] flex-col gap-1 rounded border border-[#313244] bg-[#11111b] px-2 py-1"
      title={`VRAM ${Math.round(used / 1024)}KB / ${Math.round(limit / 1024)}KB (${percent}%)`}
    >
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-[#7f849c]">VRAM</span>
        <span data-testid="toolbar-vram-budget-label" className="font-mono text-[#cdd6f4]">
          {Math.round(used / 1024)} / {Math.round(limit / 1024)} KB
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded bg-[#313244]">
        <div
          data-testid="toolbar-vram-budget-bar"
          className={`h-full ${toneClass}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function ToolbarScanlineBudget({
  peak,
  limit,
}: {
  peak: number;
  limit: number;
}) {
  const percent = Math.min(100, Math.round((peak / Math.max(limit, 1)) * 100));
  const toneClass =
    peak > limit
      ? "bg-[#f38ba8]"
      : percent >= 80
        ? "bg-[#fab387]"
        : "bg-[#89b4fa]";

  return (
    <div
      data-testid="toolbar-scanline-budget"
      className="flex min-w-[8rem] flex-col gap-1 rounded border border-[#313244] bg-[#11111b] px-2 py-1"
      title={`Sprites por scanline ${peak} / ${limit} (${percent}%)`}
    >
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-[#7f849c]">Scanline</span>
        <span data-testid="toolbar-scanline-budget-label" className="font-mono text-[#cdd6f4]">
          {peak} / {limit}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded bg-[#313244]">
        <div
          data-testid="toolbar-scanline-budget-bar"
          className={`h-full ${toneClass}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function ToolbarPaletteBudget({
  used,
  limit,
}: {
  used: number;
  limit: number;
}) {
  const percent = Math.min(100, Math.round((used / Math.max(limit, 1)) * 100));
  const toneClass =
    used > limit
      ? "bg-[#f38ba8]"
      : percent >= 80
        ? "bg-[#fab387]"
        : "bg-[#f9e2af]";

  return (
    <div
      data-testid="toolbar-palette-budget"
      className="flex min-w-[7rem] flex-col gap-1 rounded border border-[#313244] bg-[#11111b] px-2 py-1"
      title={`Bancos de paleta ${used} / ${limit} (${percent}%)`}
    >
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-[#7f849c]">Paleta</span>
        <span data-testid="toolbar-palette-budget-label" className="font-mono text-[#cdd6f4]">
          {used} / {limit}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded bg-[#313244]">
        <div
          data-testid="toolbar-palette-budget-bar"
          className={`h-full ${toneClass}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName;
  return (
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT" ||
    target.isContentEditable
  );
}

type AutomationState = {
  activeProjectDir: string;
  activeProjectName: string;
  activeTarget: "megadrive" | "snes";
  activeViewportTab: string;
  sceneRevision: number;
  hwValidationState: string;
  hwValidatedRevision: number;
  hwValidationError: string | null;
  activeSceneEntityCount: number;
  hwStatus: {
    spriteCount: number;
    spriteLimit: number;
    errorCount: number;
    warningCount: number;
    firstError: string | null;
    firstWarning: string | null;
  } | null;
  liveSnapshot: {
    disabled: boolean;
    describedBy: string;
    reason: string;
    summary: string;
    errorSummary: string;
    pendingSummary: string;
    liveState: string;
    liveStateDetail: string;
    severity: string;
    warning: string;
    error: string;
    staleHint: string;
    hasStaleRevalidateButton: boolean;
  };
  consoleEntries: Array<{
    level: "info" | "warn" | "error" | "success";
    message: string;
  }>;
};

type AutomationApi = {
  openProject: (projectDir: string) => Promise<boolean>;
  setSceneDraft: (scene: Scene) => Promise<boolean>;
  getState: () => AutomationState;
};

declare global {
  interface Window {
    __RDS_E2E__?: AutomationApi;
  }
}

export default function App() {
  const {
    logMessage,
    setHwStatus,
    hwStatus,
    hwValidationError,
    hwValidationState,
    activeProjectDir,
    activeProjectName,
    setActiveProject,
    activeTarget,
    setActiveTarget,
    emulatorLoaded,
    setEmulatorLoaded,
    setActiveScene,
    setActiveScenePath,
    activeViewportTab,
    setActiveViewportTab,
    setSelectedEntityId,
    selectedEntityId,
    emulPaused,
    setEmulPaused,
    requestHwValidationRefresh,
    resetHwValidation,
    undo,
    redo,
    setProjectSourceKind,
    consoleVisible,
    toggleConsole,
  } = useEditorStore();

  const [building, setBuilding] = useState(false);
  const [rightPanelMode, setRightPanelMode] = useState<"inspector" | "tools">("inspector");
  const [toolPanelActive, setToolPanelActive] = useState<ToolTab>("setup");
  const [toolPanelWorkspace, setToolPanelWorkspace] = useState<ToolWorkspace>("editing");
  const [toolPanelShowAdvanced, setToolPanelShowAdvanced] = useState(false);
  const [activeWorkspace, setActiveWorkspace] = useState<ShellWorkspace>("scene");
  const [leftPanelTab, setLeftPanelTab] = useState<"scene" | "layers">("scene");
  const [focusedShell, setFocusedShell] = useState(false);
  const [layoutPreset, setLayoutPreset] = useState<LayoutPresetId>("artist");
  const [shellWidth, setShellWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1440
  );
  const [newProjName, setNewProjName] = useState("MeuProjeto");
  const [newProjTarget, setNewProjTarget] = useState<"megadrive" | "snes">("megadrive");
  const [newProjBaseDir, setNewProjBaseDir] = useState("");
  const [projectTemplates, setProjectTemplates] = useState<ProjectTemplateSummary[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateDonorPaths, setTemplateDonorPaths] = useState<Record<string, string>>({});
  const [showProjectWizard, setShowProjectWizard] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [copiedEntity, setCopiedEntity] = useState<Entity | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const buildInFlightRef = useRef(false);
  const panelGroupRef = useRef<GroupImperativeHandle | null>(null);
  const lastNonFocusLayoutRef = useRef<LayoutMap | null>(null);
  const applyingLayoutRef = useRef(false);
  const tauriInternals =
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  const automationEnabled =
    typeof tauriInternals !== "undefined" ||
    import.meta.env.DEV ||
    String(import.meta.env.TAURI_ENV_DEBUG ?? "").toLowerCase() === "true" ||
    String(import.meta.env.TAURI_ENV_DEBUG ?? "") === "1" ||
    new URLSearchParams(window.location.search).has("e2e");

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "retrodev-layout",
    storage: typeof window !== "undefined" ? localStorage : undefined,
    panelIds: ["left", "center", "right"],
  });

  const selectedTemplate =
    projectTemplates.find((template) => template.id === selectedTemplateId) ?? null;
  const selectedTemplateMegadriveOnly = selectedTemplate?.source_kind === "external_sgdk";

  useLiveValidationController();

  useEffect(() => {
    function handleResize() {
      setShellWidth(window.innerWidth);
    }

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  function openToolsWorkspace(
    activeTool: ToolTab,
    workspace: ToolWorkspace,
    showAdvanced = false
  ) {
    setRightPanelMode("tools");
    setToolPanelActive(activeTool);
    setToolPanelWorkspace(workspace);
    setToolPanelShowAdvanced(showAdvanced);
  }

  function applyShellLayout(nextLayout: LayoutMap) {
    applyingLayoutRef.current = true;
    panelGroupRef.current?.setLayout(nextLayout);
    onLayoutChanged(nextLayout);
    window.setTimeout(() => {
      applyingLayoutRef.current = false;
    }, 0);
  }

  function applyLayoutPreset(preset: LayoutPresetId) {
    setFocusedShell(false);
    setLayoutPreset(preset);
    const nextLayout = getPresetLayout(preset, shellWidth);
    lastNonFocusLayoutRef.current = nextLayout;
    applyShellLayout(nextLayout);
  }

  function toggleFocusMode() {
    if (!focusedShell) {
      const currentLayout = panelGroupRef.current?.getLayout();
      if (currentLayout) {
        lastNonFocusLayoutRef.current = {
          left: currentLayout.left ?? 0,
          center: currentLayout.center ?? 100,
          right: currentLayout.right ?? 0,
        };
      }
      setFocusedShell(true);
      applyShellLayout({ left: 0, center: 100, right: 0 });
      if (consoleVisible) {
        toggleConsole();
      }
      return;
    }

    setFocusedShell(false);
    applyShellLayout(
      lastNonFocusLayoutRef.current ?? getPresetLayout(layoutPreset, shellWidth)
    );
  }

  function saveCurrentLayout() {
    const layout = panelGroupRef.current?.getLayout();
    if (!layout) {
      return;
    }

    localStorage.setItem(
      LAYOUT_STORAGE_KEY,
      JSON.stringify({
        left: layout.left ?? 0,
        center: layout.center ?? 100,
        right: layout.right ?? 0,
      } satisfies LayoutMap)
    );
    logMessage("success", "[Layout] Layout atual salvo para restauracao rapida.");
  }

  function restoreSavedLayout() {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) {
      logMessage("warn", "[Layout] Nenhum layout salvo neste host.");
      return;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<LayoutMap>;
      const nextLayout: LayoutMap = {
        left: Number(parsed.left ?? 18),
        center: Number(parsed.center ?? 60),
        right: Number(parsed.right ?? 22),
      };
      setFocusedShell(false);
      lastNonFocusLayoutRef.current = nextLayout;
      applyShellLayout(nextLayout);
      logMessage("success", "[Layout] Layout salvo restaurado.");
    } catch {
      logMessage("error", "[Layout] Falha ao ler layout salvo neste host.");
    }
  }

  useEffect(() => {
    if (focusedShell) {
      return;
    }

    applyShellLayout(getPresetLayout(layoutPreset, shellWidth));
  }, [layoutPreset, shellWidth]);

  useEffect(() => {
    if (focusedShell) {
      return;
    }

    if (activeWorkspace === "debug") {
      setLayoutPreset("debug");
      return;
    }

    if (activeWorkspace === "logic") {
      setLayoutPreset("logic");
      return;
    }

    if (activeWorkspace === "game") {
      setLayoutPreset("playtest");
      return;
    }

    setLayoutPreset("artist");
  }, [activeWorkspace, focusedShell]);

  useEffect(() => {
    if (activeWorkspace === "debug") {
      return;
    }

    if (
      activeViewportTab === "scene" ||
      activeViewportTab === "game" ||
      activeViewportTab === "logic" ||
      activeViewportTab === "retrofx" ||
      activeViewportTab === "artstudio"
    ) {
      setActiveWorkspace(activeViewportTab);
    }
  }, [activeViewportTab, activeWorkspace]);

  useEffect(() => {
    if (showProjectWizard && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [showProjectWizard]);

  useEffect(() => {
    if (!showProjectWizard) {
      return;
    }

    let cancelled = false;

    async function loadTemplates() {
      setTemplatesLoading(true);
      try {
        const templates = await listProjectTemplates();
        if (cancelled) {
          return;
        }
        setProjectTemplates(templates);
        setSelectedTemplateId((current) => {
          if (templates.some((template) => template.id === current)) {
            return current;
          }
          const defaultTemplate =
            templates.find((template) => template.id === "platformer_seed" && template.available) ??
            templates.find((template) => template.id === "starter_guided") ??
            templates[0];
          return defaultTemplate?.id ?? "";
        });
      } catch (error) {
        if (!cancelled) {
          setProjectTemplates([]);
          logMessage("error", `[Projeto] Falha ao carregar templates: ${describeError(error)}`);
        }
      } finally {
        if (!cancelled) {
          setTemplatesLoading(false);
        }
      }
    }

    void loadTemplates();

    return () => {
      cancelled = true;
    };
  }, [showProjectWizard, logMessage]);

  useEffect(() => {
    if (activeProjectDir) {
      setShowProjectWizard(false);
      return;
    }

    setShowProjectWizard(true);
  }, [activeProjectDir]);

  useEffect(() => {
    if (selectedTemplateMegadriveOnly && newProjTarget !== "megadrive") {
      setNewProjTarget("megadrive");
    }
  }, [newProjTarget, selectedTemplateMegadriveOnly]);

  useEffect(() => {
    if (!activeProjectDir) {
      return;
    }

    let cancelled = false;

    async function pollAssetChanges() {
      try {
        const result = await pollProjectAssetChanges(activeProjectDir);
        if (cancelled || !result.changed) {
          return;
        }

        requestHwValidationRefresh();
        const preview = result.changed_paths.slice(0, 2).join(", ");
        const suffix = result.changed_paths.length > 2 ? "..." : "";
        logMessage(
          "info",
          `[Hot Reload] ${result.changed_paths.length} asset(s) alterado(s) no disco: ${preview}${suffix}. Revalidando preview live.`
        );
      } catch (error) {
        if (!cancelled) {
          logMessage("warn", `[Hot Reload] Falha ao verificar assets do projeto: ${describeError(error)}`);
        }
      }
    }

    void pollAssetChanges();
    const intervalId = window.setInterval(() => {
      void pollAssetChanges();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeProjectDir, logMessage, requestHwValidationRefresh]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || isEditableTarget(event.target)) {
        return;
      }

      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }

      if (event.key.toLowerCase() === "y" && !event.shiftKey) {
        event.preventDefault();
        redo();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [redo, undo]);

  function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  const buildDisabledReason = getLiveBuildBlockReason({
    activeProjectDir,
    building,
    hwStatus,
    hwValidationState,
  });
  const buildWarningSummary = getLiveBuildWarningSummary({
    activeProjectDir,
    building,
    hwStatus,
    hwValidationState,
  });
  const buildLiveIndicator = getLiveToolbarIndicator({
    activeProjectDir,
    hwStatus,
    hwValidationError,
    hwValidationState,
  });
  const liveBuildPendingSummary =
    buildLiveIndicator?.label === "ANALISANDO" ? buildLiveIndicator.detail : null;
  const liveBuildErrorSummary =
    buildLiveIndicator?.label === "ERRO LIVE" ? buildLiveIndicator.detail : null;
  const liveBuildBlocked =
    hwValidationState === "fresh" && Boolean(hwStatus && hwStatus.errors.length > 0);

  async function resetEmulatorSession(switchToScene = false) {
    try {
      await emulatorStop();
    } catch {
      // Project and target transitions should still reset local editor state even if the core is already stopped.
    }

    setEmulatorLoaded(false);
    setEmulPaused(false);

    if (switchToScene) {
      setActiveViewportTab("scene");
    }
  }

  async function hydrateProjectState(projectDir: string, projectName: string, scope: string) {
    await resetEmulatorSession(true);
    const hw = await getHwStatus(projectDir);
    const sceneData = await getSceneData(projectDir);
    if (!sceneData.ok) {
      setActiveProject(projectDir, projectName);
      setSelectedEntityId(null);
      setHwStatus(hw);
      logMessage("warn", `[${scope}] ${sceneData.error}`);
      setActiveScenePath("");
      setActiveScene(null);
      return false;
    }

    const hydrated = await hydrateSceneResult(projectDir, sceneData);
    if (!hydrated) {
      setActiveProject(projectDir, projectName);
      setSelectedEntityId(null);
      setHwStatus(hw);
      logMessage("error", `[${scope}] Falha ao reconstruir a cena do projeto.`);
      setActiveScenePath("");
      setActiveScene(null);
      return false;
    }

    setActiveProject(projectDir, projectName);
    setSelectedEntityId(null);
    setHwStatus(hw);
    setActiveScenePath(sceneData.scene_path);
    setActiveScene(hydrated.resolvedScene, hydrated.sourceScene);
    setProjectSourceKind(sceneData.source_kind ?? "");
    if (sceneData.target === "megadrive" || sceneData.target === "snes") {
      setActiveTarget(sceneData.target);
    }

    return true;
  }

  async function ensureDependencies(
    dependencyIds: (ThirdPartyDependencyId | string)[],
    reason: string
  ) {
    try {
      const report = await getThirdPartyStatus();
      const missing = report.items.filter(
        (item) => dependencyIds.includes(item.id) && !item.installed
      );
      if (missing.length === 0) return true;

      openToolsWorkspace("setup", "editing");
      const summary = missing
        .map((item) => `- ${item.label}: ${item.issues[0] ?? item.install_dir}`)
        .join("\n");

      const confirmed = window.confirm(
        `${reason}\n\nDependencias ausentes:\n${summary}\n\nInstalar automaticamente agora?`
      );
      if (!confirmed) {
        logMessage("warn", "[Setup] Operacao cancelada: dependencias externas pendentes.");
        return false;
      }

      for (const item of missing) {
        logMessage("info", `[Setup] Instalando ${item.label}...`);
        const result = await installThirdPartyDependency(item.id, (line) => {
          logMessage(line.level, `[Setup] ${line.message}`);
        });
        if (!result.ok) {
          logMessage("error", `[Setup] ${result.message}`);
          return false;
        }
      }

      return true;
    } catch (error) {
      logMessage("error", `[Setup] ${describeError(error)}`);
      return false;
    }
  }

  async function handleOpenProject() {
    try {
      const result = await openProjectDialog();
      if (!result.selected) return;
      const hydrated = await hydrateProjectState(result.path, result.name, "Projeto");
      if (hydrated) {
        logMessage("success", `Projeto aberto: ${result.name} (${result.path})`);
      } else {
        logMessage("warn", `[Projeto] Projeto aberto sem cena valida: ${result.name} (${result.path})`);
      }
    } catch (error) {
      logMessage("error", `[Projeto] Falha ao abrir projeto: ${describeError(error)}`);
    }
  }

  async function openProjectAtPath(projectDir: string, scope: string) {
    const result = await openProjectPath(projectDir);
    if (!result.selected) {
      throw new Error(`Projeto invalido ou incompleto: ${projectDir}`);
    }
    const hydrated = await hydrateProjectState(result.path, result.name, scope);
    if (!hydrated) {
      throw new Error(`Falha ao hidratar o projeto: ${result.path}`);
    }
    logMessage("success", `Projeto aberto: ${result.name} (${result.path})`);
    return true;
  }

  async function handleSwitchTarget(target: "megadrive" | "snes") {
    if (!activeProjectDir || target === activeTarget) return;
    try {
      const result = await setProjectTarget(activeProjectDir, target);
      if (!result.ok) {
        logMessage("error", `[Target] ${result.message}`);
        return;
      }
      await resetEmulatorSession(true);
      setActiveTarget(target);
      setHwStatus(await getHwStatus(activeProjectDir));
      logMessage("info", `Target alterado para ${target === "megadrive" ? "Mega Drive" : "SNES"}.`);
    } catch (error) {
      logMessage("error", `[Target] Falha ao alterar target: ${describeError(error)}`);
    }
  }

  async function chooseNewProjectBaseDir() {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        title: "Escolher pasta base do projeto",
        directory: true,
        multiple: false,
      });
      if (typeof selected === "string") {
        setNewProjBaseDir(selected);
      }
    } catch (error) {
      logMessage("error", `[Projeto] Falha ao escolher pasta base: ${describeError(error)}`);
    }
  }

  function templateAvailability(template: ProjectTemplateSummary) {
    const donorOverride = templateDonorPaths[template.id]?.trim();
    if (template.source_kind === "external_sgdk" && donorOverride) {
      return {
        available: true,
        reason: "Usando uma pasta doadora selecionada manualmente.",
      };
    }

    return {
      available: template.available,
      reason: template.availability_reason ?? "",
    };
  }

  async function chooseTemplateDonorPath(templateId: string) {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        title: "Escolher pasta doadora do template",
        directory: true,
        multiple: false,
      });
      if (typeof selected === "string") {
        setTemplateDonorPaths((current) => ({
          ...current,
          [templateId]: selected,
        }));
        setSelectedTemplateId(templateId);
        if (
          projectTemplates.find((template) => template.id === templateId)?.source_kind ===
          "external_sgdk"
        ) {
          setNewProjTarget("megadrive");
        }
      }
    } catch (error) {
      logMessage("error", `[Projeto] Falha ao escolher pasta doadora: ${describeError(error)}`);
    }
  }

  async function chooseSgdkProjectPath() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      title: "Escolher projeto SGDK para importar",
      directory: true,
      multiple: false,
    });
    return typeof selected === "string" ? selected : null;
  }

  async function confirmNewProject() {
    if (!newProjName.trim()) {
      logMessage("warn", "[Projeto] Informe um nome para o projeto.");
      return;
    }
    if (!newProjBaseDir.trim()) {
      logMessage("warn", "[Projeto] Escolha a pasta base onde o projeto sera criado.");
      return;
    }
    if (!selectedTemplate) {
      logMessage("warn", "[Projeto] Escolha um template antes de criar o projeto.");
      return;
    }

    const availability = templateAvailability(selectedTemplate);
    if (!availability.available) {
      logMessage(
        "warn",
        `[Projeto] O template '${selectedTemplate.name}' ainda nao esta disponivel: ${availability.reason}`
      );
      return;
    }

    setCreatingProject(true);
    try {
      const donorPath =
        selectedTemplate.source_kind === "external_sgdk"
          ? templateDonorPaths[selectedTemplate.id]?.trim() ||
            selectedTemplate.default_donor_path ||
            undefined
          : undefined;
      const result = await createProjectFromTemplate(
        newProjName.trim(),
        newProjTarget,
        newProjBaseDir.trim(),
        selectedTemplate.id,
        donorPath
      );
      const hydrated = await hydrateProjectState(result.path, result.name, "Projeto");
      if (hydrated) {
        logMessage(
          "success",
          `Novo projeto criado a partir de '${selectedTemplate.name}': ${result.name} em ${result.path}`
        );
      } else {
        logMessage("warn", `[Projeto] Projeto criado, mas a cena inicial nao foi hidratada: ${result.name}`);
      }
    } catch (error) {
      logMessage("error", `[Projeto] Falha ao criar projeto: ${describeError(error)}`);
    } finally {
      setCreatingProject(false);
    }
  }

  async function handleImportSgdkProject() {
    if (!newProjName.trim()) {
      logMessage("warn", "[Projeto] Informe um nome para o projeto importado.");
      return;
    }
    if (!newProjBaseDir.trim()) {
      logMessage("warn", "[Projeto] Escolha a pasta base onde o projeto importado sera criado.");
      return;
    }

    try {
      const sgdkPath = await chooseSgdkProjectPath();
      if (!sgdkPath) {
        return;
      }

      setCreatingProject(true);
      const result = await importSgdkProject(newProjName.trim(), newProjBaseDir.trim(), sgdkPath);
      const hydrated = await hydrateProjectState(result.path, result.name, "Projeto");
      if (hydrated) {
        logMessage(
          "success",
          `Projeto SGDK importado: ${result.name} em ${result.path}`
        );
      } else {
        logMessage(
          "warn",
          `[Projeto] Importacao concluida, mas a cena inicial nao foi hidratada: ${result.name}`
        );
      }
    } catch (error) {
      logMessage("error", `[Projeto] Falha ao importar projeto SGDK: ${describeError(error)}`);
    } finally {
      setCreatingProject(false);
    }
  }

  async function handleEmulatorLoadRom() {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        title: "Carregar ROM",
        filters: [{ name: "ROM", extensions: ["md", "bin", "gen", "smc", "sfc", "rom"] }],
      });
      if (!selected) return;

      const romPath = typeof selected === "string" ? selected : selected[0];
      const romDependency = await detectRomDependency(romPath);
      if (romDependency.dependency_id) {
        const ready = await ensureDependencies(
          [romDependency.dependency_id],
          "Carregar esta ROM requer o core Libretro correspondente."
        );
        if (!ready) return;
      }

      const result = await emulatorLoadRom(romPath);
      if (!result.ok) {
        setEmulatorLoaded(false);
        if (result.message.includes("Nenhum core Libretro")) {
          openToolsWorkspace("setup", "editing");
        }
        logMessage("error", `[Emulador] ${result.message}`);
        return;
      }

      setEmulatorLoaded(true);
      logMessage("success", `ROM carregada: ${romPath}`);
      setActiveViewportTab("game");
      setEmulPaused(false);
    } catch (error) {
      logMessage("error", `[Emulador] Falha ao carregar ROM: ${describeError(error)}`);
    }
  }

  function handleEmulatorPause() {
    if (!emulatorLoaded) {
      return;
    }
    setEmulPaused(!emulPaused);
    logMessage("info", emulPaused ? "Emulador retomado." : "Emulador pausado.");
  }

  async function handleEmulatorStop() {
    try {
      await resetEmulatorSession(true);
      logMessage("info", "Emulador parado.");
    } catch (error) {
      logMessage("error", `[Emulador] Falha ao parar: ${describeError(error)}`);
    }
  }

  async function handleValidate() {
    if (!activeProjectDir) {
      logMessage("warn", "Nenhum projeto aberto.");
      return;
    }
    logMessage("info", "Validando projeto...");
    try {
      if (!(await persistActiveScene(activeProjectDir, "Validate"))) {
        return;
      }
      const result = await validateProject(activeProjectDir);
      result.errors.forEach((error) => logMessage("error", `[Validate] ${error}`));
      result.warnings.forEach((warning) => logMessage("warn", `[Validate] ${warning}`));
      if (result.ok) {
        logMessage("success", "Validacao OK - nenhum erro de hardware.");
      } else if (result.errors.length === 0) {
        logMessage("error", "[Validate] Validacao falhou sem detalhar erros.");
      }
    } catch (error) {
      logMessage("error", `[Validate] Falha inesperada: ${describeError(error)}`);
    }
  }

  async function handleGenerateC() {
    if (!activeProjectDir) {
      logMessage("warn", "Nenhum projeto aberto.");
      return;
    }
    logMessage("info", "Gerando codigo C...");
    try {
      if (!(await persistActiveScene(activeProjectDir, "CodeGen"))) {
        return;
      }
      const result = await generateCCode(activeProjectDir);
      result.errors.forEach((error) => logMessage("error", `[CodeGen] ${error}`));
      result.warnings.forEach((warning) => logMessage("warn", `[CodeGen] ${warning}`));
      if (!result.ok) {
        if (result.errors.length === 0) {
          logMessage("error", "[CodeGen] Falha sem diagnostico detalhado.");
        }
        return;
      }
      logMessage("success", "Codigo C gerado com sucesso.");
      logMessage(
        "info",
        `--- main.c ---\n${result.main_c.slice(0, 800)}${result.main_c.length > 800 ? "\n[truncado]" : ""}`
      );
    } catch (error) {
      logMessage("error", `[CodeGen] Falha inesperada: ${describeError(error)}`);
    }
  }

  async function handleSaveScene() {
    if (!activeProjectDir) {
      logMessage("warn", "Nenhum projeto aberto.");
      return;
    }

    try {
      const saved = await persistActiveScene(
        activeProjectDir,
        "Save",
        "Cena salva no projeto ativo."
      );
      if (saved) {
        requestHwValidationRefresh();
      }
    } catch (error) {
      logMessage("error", `[Save] Falha ao salvar: ${describeError(error)}`);
    }
  }

  function handleCopyEntity() {
    const { activeScene, selectedEntityId: currentSelected } = useEditorStore.getState();
    if (!currentSelected || currentSelected.startsWith("layer::") || !activeScene) return;
    const entity = activeScene.entities.find((item) => item.entity_id === currentSelected);
    if (!entity) return;
    setCopiedEntity(entity);
    logMessage("info", `[Editar] Entidade copiada: ${getEntityDisplayName(entity)}`);
  }

  async function handlePasteEntity() {
    if (!copiedEntity || !activeProjectDir) return;
    try {
      const { addEntity } = useEditorStore.getState();
      const pasted: Entity = {
        ...copiedEntity,
        entity_id: `${copiedEntity.entity_id}_copy_${Date.now()}`,
        transform: {
          x: copiedEntity.transform.x + 16,
          y: copiedEntity.transform.y + 16,
        },
      };
      addEntity(pasted);
      if (await persistActiveScene(activeProjectDir, "Editar")) {
        logMessage("success", `[Editar] Entidade colada: ${getEntityDisplayName(pasted)}`);
      }
    } catch (error) {
      logMessage("error", `[Editar] Falha ao colar entidade: ${describeError(error)}`);
      await reloadSceneFromDisk(activeProjectDir, "Editar");
    }
  }

  async function handlePlay() {
    if (!emulatorLoaded) {
      await handleEmulatorLoadRom();
      return;
    }

    setActiveViewportTab("game");
    setActiveWorkspace("game");
    if (emulPaused) {
      handleEmulatorPause();
    }
  }

  async function handleBuildAndRun() {
    if (!activeProjectDir) {
      logMessage("warn", "Nenhum projeto aberto. Use Abrir Projeto.");
      return;
    }
    if (building || buildInFlightRef.current) {
      return;
    }
    buildInFlightRef.current = true;

    try {
      const state = useEditorStore.getState();
      if (
        state.hwValidationState === "fresh" &&
        state.hwStatus &&
        state.hwStatus.errors.length > 0
      ) {
        state.hwStatus.errors.forEach((error) => logMessage("error", `[HW] ${error}`));
        logMessage("warn", buildDisabledReason ?? "Build bloqueado pelo preview de hardware.");
        return;
      }

      const requiredDependencies =
        activeTarget === "megadrive"
          ? (["sgdk", "libretro_megadrive"] as const)
          : (["pvsneslib", "sgdk", "libretro_snes"] as const);

      const dependenciesReady = await ensureDependencies(
        [...requiredDependencies],
        `Build & Run para ${activeTarget === "megadrive" ? "Mega Drive" : "SNES"} requer componentes de terceiros.`
      );
      if (!dependenciesReady) return;

      setBuilding(true);
      logMessage("info", "Iniciando build...");

      if (!(await persistActiveScene(activeProjectDir, "Build"))) {
        return;
      }

      const hwStatus = await getHwStatus(activeProjectDir);
      setHwStatus(hwStatus);
      if (hwStatus.errors.length > 0) {
        hwStatus.errors.forEach((error) => logMessage("error", `[HW] ${error}`));
        logMessage("error", "Build bloqueado: violacoes de hardware.");
        return;
      }
      hwStatus.warnings.forEach((warning) => logMessage("warn", `[HW] ${warning}`));

      const result = await buildProject(activeProjectDir, (line) => {
        logMessage(line.level, line.message);
      });
      if (!result.ok) {
        logMessage("error", "Build falhou. Verifique o Console para detalhes.");
        return;
      }

      logMessage("success", `Build concluido. ROM: ${result.rom_path}`);
      const loadResult = await emulatorLoadRom(result.rom_path);
      if (!loadResult.ok) {
        setEmulatorLoaded(false);
        if (loadResult.message.includes("Nenhum core Libretro")) {
          openToolsWorkspace("setup", "editing");
        }
        logMessage("error", `[Emulador] ${loadResult.message}`);
        return;
      }

      setEmulatorLoaded(true);
      logMessage("success", "ROM carregada no emulador.");
      setEmulPaused(false);
      setActiveViewportTab("game");
    } catch (error) {
      logMessage("error", `[Build] Falha inesperada: ${describeError(error)}`);
    } finally {
      buildInFlightRef.current = false;
      setBuilding(false);
    }
  }

  function handleRevalidateLiveSnapshot() {
    if (!activeProjectDir) {
      return;
    }
    requestHwValidationRefresh();
    logMessage("info", "[Live] Revalidacao manual solicitada.");
  }

  async function handleCloseProject() {
    await resetEmulatorSession(true);
    setActiveProject("", "");
    setActiveScenePath("");
    setActiveScene(null);
    setHwStatus(null);
    resetHwValidation();
    setSelectedEntityId(null);
    logMessage("info", "Projeto fechado.");
  }

  function handleWorkspaceSelect(workspace: ShellWorkspace) {
    setActiveWorkspace(workspace);

    if (workspace === "debug") {
      openToolsWorkspace("profiler", "debug", true);
      return;
    }

    setActiveViewportTab(workspace);
    setRightPanelMode("inspector");

    if (workspace === "scene") {
      setLeftPanelTab("scene");
    }
  }

  useEffect(() => {
    if (!automationEnabled) {
      delete window.__RDS_E2E__;
      return;
    }

    window.__RDS_E2E__ = {
      openProject: (projectDir: string) => openProjectAtPath(projectDir, "E2E"),
      setSceneDraft: async (scene: Scene) => {
        const state = useEditorStore.getState();
        if (!state.activeProjectDir) {
          throw new Error("Nenhum projeto aberto para injetar draft.");
        }

        state.setSelectedEntityId(null);
        state.setActiveScene(scene, scene);
        return true;
      },
      getState: () => {
        const state = useEditorStore.getState();
        const currentLiveBuildBlocked =
          state.hwValidationState === "fresh" &&
          Boolean(state.hwStatus && state.hwStatus.errors.length > 0);
        const currentBuildDisabledReason =
          currentLiveBuildBlocked && state.hwStatus
            ? `Build bloqueado: ${state.hwStatus.errors[0]}`
            : null;
        const currentBuildWarningSummary =
          state.activeProjectDir &&
          !building &&
          state.hwValidationState === "fresh" &&
          state.hwStatus &&
          state.hwStatus.errors.length === 0 &&
          state.hwStatus.warnings.length > 0
            ? `Build com alerta: ${state.hwStatus.warnings[0]}`
            : null;

        let currentLiveState = "";
        let currentLiveStateDetail = "";
        if (state.activeProjectDir) {
          if (state.hwValidationState === "pending") {
            currentLiveState = "ANALISANDO";
            currentLiveStateDetail = "Preview live em analise.";
          } else if (state.hwValidationState === "stale") {
            currentLiveState = "DESATUAL.";
            currentLiveStateDetail =
              "O draft mudou depois da ultima analise live. Edite a cena para acionar a revalidacao automatica ou use Revalidar agora.";
          } else if (state.hwValidationState === "error") {
            currentLiveState = "ERRO LIVE";
            currentLiveStateDetail = state.hwValidationError ?? "Falha ao atualizar o preview live.";
          } else if (state.hwValidationState === "fresh" && state.hwStatus?.errors.length) {
            currentLiveState = "BLOQUEADO";
            currentLiveStateDetail = state.hwStatus.errors[0];
          } else if (state.hwValidationState === "fresh" && state.hwStatus?.warnings.length) {
            currentLiveState = "WARN";
            currentLiveStateDetail = state.hwStatus.warnings[0];
          } else if (state.hwValidationState === "fresh") {
            currentLiveState = "LIVE";
            currentLiveStateDetail = "Preview live sincronizado.";
          }
        }

        return {
          activeProjectDir: state.activeProjectDir,
          activeProjectName: state.activeProjectName,
          activeTarget: state.activeTarget,
          activeViewportTab: state.activeViewportTab,
          sceneRevision: state.sceneRevision,
          hwValidationState: state.hwValidationState,
          hwValidatedRevision: state.hwValidatedRevision,
          hwValidationError: state.hwValidationError,
          activeSceneEntityCount: state.activeScene?.entities.length ?? 0,
          hwStatus: state.hwStatus
            ? {
                spriteCount: state.hwStatus.sprite_count,
                spriteLimit: state.hwStatus.sprite_limit,
                errorCount: state.hwStatus.errors.length,
                warningCount: state.hwStatus.warnings.length,
                firstError: state.hwStatus.errors[0] ?? null,
                firstWarning: state.hwStatus.warnings[0] ?? null,
              }
            : null,
          liveSnapshot: {
            disabled: Boolean(building || !state.activeProjectDir || currentLiveBuildBlocked),
            describedBy: currentLiveBuildBlocked ? "build-disabled-reason" : "",
            reason: currentLiveBuildBlocked ? currentBuildDisabledReason ?? "" : "",
            summary: !currentLiveBuildBlocked ? currentBuildWarningSummary ?? "" : "",
            errorSummary: !currentLiveBuildBlocked && currentLiveState === "ERRO LIVE"
              ? `Live com falha: ${currentLiveStateDetail}`
              : "",
            pendingSummary:
              !currentLiveBuildBlocked &&
              !currentBuildWarningSummary &&
              currentLiveState === "ANALISANDO"
                ? currentLiveStateDetail
              : "",
            liveState: currentLiveState,
            liveStateDetail: currentLiveStateDetail,
            severity: state.hwStatus
              ? state.hwStatus.errors.length > 0
                ? "OVERFLOW"
                : state.hwStatus.warnings.length > 0
                  ? "WARN"
                  : "OK"
              : "OK",
            warning: state.hwStatus?.warnings[0] ?? "",
            error: state.hwStatus?.errors[0] ?? "",
            staleHint: currentLiveState === "DESATUAL." ? currentLiveStateDetail : "",
            hasStaleRevalidateButton: currentLiveState === "DESATUAL.",
          },
          consoleEntries: state.consoleEntries.map(({ level, message }) => ({ level, message })),
        };
      },
    };

    return () => {
      delete window.__RDS_E2E__;
    };
  }, [automationEnabled]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#11111b] text-[#cdd6f4]">
      {showProjectWizard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="flex max-h-[90vh] w-[52rem] flex-col gap-4 overflow-hidden rounded-lg border border-[#313244] bg-[#181825] p-5 shadow-2xl">
            <div className="space-y-1">
              <h2 className="text-sm font-bold text-[#cba6f7]">
                {activeProjectDir ? "Novo Projeto" : "Wizard de Primeiro Uso"}
              </h2>
              <p className="text-[10px] leading-tight text-[#7f849c]">
                Escolha um template, ajuste target/nome/pasta base e crie um projeto editavel
                sem sair do fluxo canonico do editor.
              </p>
            </div>

            <div className="grid gap-3 overflow-y-auto pr-1 md:grid-cols-3">
              {templatesLoading ? (
                <div className="col-span-full rounded border border-[#313244] bg-[#11111b] p-4 text-xs text-[#7f849c]">
                  Carregando galeria de templates...
                </div>
              ) : (
                projectTemplates.map((template) => {
                  const availability = templateAvailability(template);
                  const isSelected = template.id === selectedTemplateId;
                  const donorPath =
                    templateDonorPaths[template.id] || template.default_donor_path || "";
                  const isExternalSgdk = template.source_kind === "external_sgdk";

                  return (
                    <div
                      key={template.id}
                      className={`overflow-hidden rounded border ${
                        isSelected
                          ? "border-[#cba6f7] bg-[#1e1e2e]"
                          : "border-[#313244] bg-[#11111b]"
                      }`}
                    >
                      <button
                        type="button"
                        data-testid={`template-card-${template.id}`}
                        disabled={!availability.available}
                        onClick={() => {
                          setSelectedTemplateId(template.id);
                          if (template.source_kind === "external_sgdk") {
                            setNewProjTarget("megadrive");
                          }
                        }}
                        className="flex w-full flex-col gap-2 p-3 text-left disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h3 className="text-sm font-semibold text-[#cdd6f4]">{template.name}</h3>
                            <p className="text-[10px] uppercase tracking-wide text-[#7f849c]">
                              {template.genre}
                            </p>
                          </div>
                          {template.experimental ? (
                            <span className="rounded border border-[#fab387] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#fab387]">
                              Experimental
                            </span>
                          ) : null}
                        </div>
                        <p className="min-h-[3rem] text-[11px] leading-5 text-[#a6adc8]">
                          {template.description}
                        </p>
                        <div className="flex flex-wrap gap-1">
                          <span className="rounded bg-[#313244] px-1.5 py-0.5 text-[10px] text-[#cdd6f4]">
                            {template.difficulty}
                          </span>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] ${
                              availability.available
                                ? "bg-[#a6e3a1]/15 text-[#a6e3a1]"
                                : "bg-[#f38ba8]/15 text-[#f38ba8]"
                            }`}
                          >
                            {availability.available ? "Disponivel" : "Indisponivel"}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {template.features.length > 0 ? (
                            template.features.map((feature) => (
                              <span
                                key={feature}
                                className="rounded bg-[#181825] px-1.5 py-0.5 text-[10px] text-[#7f849c]"
                              >
                                {feature}
                              </span>
                            ))
                          ) : (
                            <span className="text-[10px] text-[#6c7086]">Sem presets iniciais.</span>
                          )}
                        </div>
                      </button>

                      {isExternalSgdk ? (
                        <div className="border-t border-[#313244] p-3 text-[10px] text-[#7f849c]">
                          <div className="mb-2">
                            <p className="text-[#a6adc8]">Template doador</p>
                            <p className="truncate font-mono text-[#cdd6f4]">
                              {donorPath || "(selecione uma pasta doadora)"}
                            </p>
                          </div>
                          {availability.reason ? (
                            <p className="mb-2 text-[#fab387]">{availability.reason}</p>
                          ) : (
                            <p className="mb-2 text-[#7f849c]">
                              Usa assets limpos do template SGDK externo sem copiar ROM, VGM ou artefatos.
                            </p>
                          )}
                          <ToolbarButton
                            label="Escolher pasta..."
                            onClick={() => void chooseTemplateDonorPath(template.id)}
                          />
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-[1.2fr_1fr]">
              <div className="rounded border border-[#313244] bg-[#11111b] p-3 text-[10px] text-[#7f849c]">
                <p className="mb-1 text-[#cdd6f4]">
                  Template selecionado: <span className="font-semibold">{selectedTemplate?.name ?? "Nenhum"}</span>
                </p>
                <p className="leading-5">
                  {selectedTemplate?.description ??
                    "A galeria de templates sera exibida assim que o catalogo for carregado."}
                </p>
                {selectedTemplateMegadriveOnly ? (
                  <p className="mt-2 text-[#fab387]">
                    Este seed experimental e Mega Drive only nesta wave.
                  </p>
                ) : null}
              </div>

              <div className="flex gap-2">
                {(["megadrive", "snes"] as const).map((target) => (
                  <button
                    key={target}
                    type="button"
                    disabled={selectedTemplateMegadriveOnly && target === "snes"}
                    onClick={() => setNewProjTarget(target)}
                    className={`flex-1 rounded px-3 py-2 text-xs font-semibold transition-colors ${
                      newProjTarget === target
                        ? target === "megadrive"
                          ? "bg-[#a6e3a1] text-[#1e1e2e]"
                          : "bg-[#89b4fa] text-[#1e1e2e]"
                        : "bg-[#313244] text-[#a6adc8] hover:bg-[#45475a]"
                    } disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    {target === "megadrive" ? "Mega Drive" : "SNES"}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-[1fr_1.1fr]">
              <input
                ref={inputRef}
                type="text"
                value={newProjName}
                onChange={(event) => setNewProjName(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && void confirmNewProject()}
                placeholder="Nome do projeto"
                className="rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1.5 text-sm text-[#cdd6f4] focus:border-[#cba6f7] focus:outline-none"
              />

              <div className="flex items-center gap-2 rounded border border-[#313244] bg-[#11111b] p-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] text-[#7f849c]">Pasta base</p>
                  <p className="truncate font-mono text-[10px] text-[#cdd6f4]">
                    {newProjBaseDir || "(selecione uma pasta)"}
                  </p>
                </div>
                <ToolbarButton label="Escolher" onClick={() => void chooseNewProjectBaseDir()} />
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t border-[#313244] pt-2">
              {activeProjectDir ? (
                <ToolbarButton label="Cancelar" onClick={() => setShowProjectWizard(false)} />
              ) : null}
              <ToolbarButton label="Abrir Existente" onClick={() => void handleOpenProject()} />
              <ToolbarButton
                label={creatingProject ? "Importando..." : "Importar Projeto SGDK"}
                onClick={() => void handleImportSgdkProject()}
                disabled={creatingProject || templatesLoading}
              />
              <ToolbarButton
                label={creatingProject ? "Criando..." : "Criar Projeto"}
                onClick={() => void confirmNewProject()}
                accent="primary"
                disabled={creatingProject || templatesLoading || !selectedTemplate}
              />
            </div>
          </div>
        </div>
      )}

      {showAbout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="flex w-80 flex-col gap-3 rounded-lg border border-[#313244] bg-[#181825] p-5 shadow-2xl">
            <h2 className="text-sm font-bold text-[#cba6f7]">RetroDev Studio</h2>
            <p className="text-xs text-[#a6adc8]">Tauri 2 · React 19 · Rust</p>
            <p className="text-[10px] text-[#45475a]">
              Plataforma desktop para desenvolvimento de jogos 16-bit.
            </p>
            <ToolbarButton label="Fechar" onClick={() => setShowAbout(false)} />
          </div>
        </div>
      )}

      {showShortcuts && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="flex w-80 flex-col gap-3 rounded-lg border border-[#313244] bg-[#181825] p-5 shadow-2xl">
            <h2 className="text-sm font-bold text-[#cba6f7]">Atalhos</h2>
            <table className="w-full text-xs">
              <tbody className="divide-y divide-[#313244]">
                {[
                  ["Ctrl+C", "Copiar entidade"],
                  ["Ctrl+V", "Colar entidade"],
                  ["Ctrl+Z", "Desfazer"],
                  ["Ctrl+Shift+Z / Ctrl+Y", "Refazer"],
                  ["Delete", "Remover no no NodeGraph"],
                  ["Z / X / Enter / Setas", "Controles do emulador"],
                ].map(([key, value]) => (
                  <tr key={key}>
                    <td className="py-1.5 pr-4 font-mono text-[#f9e2af]">{key}</td>
                    <td className="py-1.5 text-[#a6adc8]">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ToolbarButton label="Fechar" onClick={() => setShowShortcuts(false)} />
          </div>
        </div>
      )}

      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#313244] bg-[linear-gradient(180deg,#181825,#111827)] px-4 py-3">
        <div className="mr-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#cba6f7]">
            RetroDev Studio
          </div>
          <div className="mt-1 text-xs text-[#94a3b8]">
            Workspace adaptativo para autoria, playtest e debug.
          </div>
        </div>
        <ToolbarButton label="Novo" onClick={() => setShowProjectWizard(true)} />
        <ToolbarButton label="Abrir" onClick={() => void handleOpenProject()} />
        <ToolbarButton
          label="Salvar"
          onClick={() => void handleSaveScene()}
          disabled={!activeProjectDir}
          accent="primary"
        />
        <ToolbarButton
          label="Build & Run"
          onClick={() => void handleBuildAndRun()}
          disabled={building || !activeProjectDir || liveBuildBlocked}
          accent="success"
          testId="toolbar-build-run"
          title={liveBuildBlocked ? buildDisabledReason ?? undefined : buildWarningSummary ?? undefined}
          describedBy={liveBuildBlocked ? "build-disabled-reason" : undefined}
        />
        <ToolbarButton
          label="Play"
          onClick={() => void handlePlay()}
          disabled={!activeProjectDir}
          accent="default"
        />
        <ToolbarButton
          label="Stop"
          onClick={() => void handleEmulatorStop()}
          disabled={!emulatorLoaded}
          accent="danger"
        />
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[#313244] bg-[#11111b] px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            data-testid="active-project-name"
            className="max-w-40 truncate rounded-full border border-[#313244] bg-[#181825] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#cdd6f4]"
          >
            {activeProjectName || "Sem projeto"}
          </span>
          <div className="flex overflow-hidden rounded-full border border-[#313244] bg-[#0b1020]">
            {(["megadrive", "snes"] as const).map((target) => (
              <button
                key={target}
                onClick={() => void handleSwitchTarget(target)}
                disabled={!activeProjectDir || activeTarget === target}
                className={`px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] ${
                  activeTarget === target
                    ? target === "megadrive"
                      ? "bg-[#a6e3a1] text-[#1e1e2e]"
                      : "bg-[#89b4fa] text-[#1e1e2e]"
                    : "text-[#7f849c] disabled:cursor-not-allowed"
                }`}
              >
                {target === "megadrive" ? "MD" : "SNES"}
              </button>
            ))}
          </div>
          {buildLiveIndicator && (
            <span
              data-testid="build-live-state"
              className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                buildLiveIndicator.tone === "error"
                  ? "bg-[#f38ba8]/15 text-[#f38ba8]"
                  : buildLiveIndicator.tone === "warn"
                    ? "bg-[#fab387]/15 text-[#fab387]"
                    : buildLiveIndicator.tone === "info"
                      ? "bg-[#89b4fa]/15 text-[#89b4fa]"
                      : "bg-[#a6e3a1]/15 text-[#a6e3a1]"
              }`}
              title={buildLiveIndicator.detail}
            >
              {buildLiveIndicator.label}
            </span>
          )}
          {liveBuildBlocked && buildDisabledReason && (
            <span
              id="build-disabled-reason"
              data-testid="build-disabled-reason"
              aria-live="polite"
              className="max-w-52 truncate text-[10px] text-[#f38ba8]"
              title={buildDisabledReason}
            >
              {buildDisabledReason}
            </span>
          )}
          {!liveBuildBlocked && buildWarningSummary && (
            <span
              data-testid="build-warning-summary"
              aria-live="polite"
              className="max-w-52 truncate text-[10px] text-[#fab387]"
              title={buildWarningSummary}
            >
              {buildWarningSummary}
            </span>
          )}
          {!liveBuildBlocked && liveBuildErrorSummary && (
            <span
              data-testid="build-live-error-summary"
              aria-live="polite"
              className="max-w-52 truncate text-[10px] text-[#f38ba8]"
              title={liveBuildErrorSummary}
            >
              Live com falha: {liveBuildErrorSummary}
            </span>
          )}
          {!liveBuildBlocked &&
            !buildWarningSummary &&
            !liveBuildErrorSummary &&
            liveBuildPendingSummary && (
              <span
                data-testid="build-live-pending-summary"
                aria-live="polite"
                className="max-w-52 truncate text-[10px] text-[#89b4fa]"
                title={liveBuildPendingSummary}
              >
                Live em analise...
              </span>
            )}
          {buildLiveIndicator?.label === "DESATUAL." && (
            <>
              <span
                data-testid="build-stale-hint"
                className="max-w-52 truncate text-[10px] text-[#89b4fa]"
                title="Edite a cena para acionar a revalidacao automatica ou use Revalidar agora."
              >
                Edite a cena para revalidar
              </span>
              <ToolbarButton
                label="Revalidar agora"
                onClick={handleRevalidateLiveSnapshot}
                testId="build-stale-revalidate"
              />
            </>
          )}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {hwStatus && hwStatus.vram_limit > 0 && (
            <ToolbarVramBudget
              used={hwStatus.vram_used}
              limit={hwStatus.vram_limit}
              hasErrors={hwStatus.errors.length > 0}
              hasWarnings={hwStatus.warnings.length > 0}
            />
          )}
          {hwStatus && hwStatus.scanline_sprite_limit > 0 && (
            <ToolbarScanlineBudget
              peak={hwStatus.scanline_sprite_peak}
              limit={hwStatus.scanline_sprite_limit}
            />
          )}
          {hwStatus && hwStatus.palette_banks_limit > 0 && (
            <ToolbarPaletteBudget
              used={hwStatus.palette_banks_used}
              limit={hwStatus.palette_banks_limit}
            />
          )}
          <div className="flex items-center gap-1 rounded-full border border-[#313244] bg-[#181825] p-1">
            {(["artist", "logic", "debug", "playtest"] as LayoutPresetId[]).map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => applyLayoutPreset(preset)}
                className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors ${
                  !focusedShell && layoutPreset === preset
                    ? "bg-[#cba6f7] text-[#111827]"
                    : "text-[#94a3b8] hover:bg-[#1f2937] hover:text-[#e5e7eb]"
                }`}
              >
                {preset === "artist"
                  ? "Artist"
                  : preset === "logic"
                    ? "Logic"
                    : preset === "debug"
                      ? "Debug"
                      : "Playtest"}
              </button>
            ))}
          </div>
          <ToolbarButton label="Salvar layout" onClick={saveCurrentLayout} />
          <ToolbarButton label="Restaurar layout" onClick={restoreSavedLayout} />
          <ToolbarButton
            label={focusedShell ? "Sair do foco" : "Focus"}
            onClick={toggleFocusMode}
          />
          <ToolbarButton
            label={rightPanelMode === "tools" ? "Inspector" : "Tools"}
            onClick={() =>
              rightPanelMode === "tools"
                ? setRightPanelMode("inspector")
                : openToolsWorkspace("palette", activeWorkspace === "debug" ? "debug" : "editing", activeWorkspace === "debug")
            }
            accent="primary"
          />
          <ToolbarButton label="Validar" onClick={() => void handleValidate()} disabled={!activeProjectDir} />
          <ToolbarButton label="Gerar C" onClick={() => void handleGenerateC()} disabled={!activeProjectDir} />
          <ToolbarButton label="Copiar" onClick={handleCopyEntity} disabled={!selectedEntityId || selectedEntityId.startsWith("layer::")} />
          <ToolbarButton label="Colar" onClick={() => void handlePasteEntity()} disabled={!copiedEntity || !activeProjectDir} />
          <ToolbarButton
            label={consoleVisible ? "Console" : "Console"}
            onClick={toggleConsole}
          />
          <ToolbarButton label="Atalhos" onClick={() => setShowShortcuts(true)} />
          <ToolbarButton label="Sobre" onClick={() => setShowAbout(true)} />
          <ToolbarButton label="Fechar" onClick={() => void handleCloseProject()} disabled={!activeProjectDir} />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="flex w-[74px] shrink-0 flex-col justify-between border-r border-[#313244] bg-[#0b1020]">
          <div className="flex flex-col gap-2 px-2 py-3">
            {WORKSPACE_ITEMS.map((workspace) => (
              <WorkspaceRailButton
                key={workspace.id}
                icon={workspace.icon}
                label={workspace.label}
                active={activeWorkspace === workspace.id}
                title={workspace.description}
                accent={workspace.id === "debug" ? "debug" : "default"}
                onClick={() => handleWorkspaceSelect(workspace.id)}
              />
            ))}
          </div>

          <div className="flex flex-col gap-2 border-t border-[#1f2937] px-2 py-3">
            <WorkspaceRailButton
              icon="IN"
              label="Inspector"
              active={rightPanelMode === "inspector"}
              title="Mostrar painel contextual de propriedades"
              onClick={() => setRightPanelMode("inspector")}
            />
            <WorkspaceRailButton
              icon="TL"
              label="Tools"
              active={rightPanelMode === "tools"}
              title="Mostrar workspace contextual de ferramentas"
              onClick={() =>
                openToolsWorkspace(
                  toolPanelActive,
                  activeWorkspace === "debug" ? "debug" : "editing",
                  activeWorkspace === "debug" || toolPanelShowAdvanced
                )
              }
            />
            <WorkspaceRailButton
              icon="CS"
              label="Console"
              active={consoleVisible}
              title="Alternar console inferior"
              onClick={toggleConsole}
            />
            <WorkspaceRailButton
              icon="FM"
              label="Focus"
              active={focusedShell}
              title="Ocultar paineis laterais e priorizar o canvas"
              onClick={toggleFocusMode}
            />
          </div>
        </aside>

        <Group
          id="retrodev-layout"
          orientation="horizontal"
          groupRef={panelGroupRef}
          className="min-w-0 flex flex-1 overflow-hidden"
          defaultLayout={defaultLayout}
          onLayoutChanged={(layout) => {
            if (!focusedShell) {
              lastNonFocusLayoutRef.current = {
                left: layout.left ?? 0,
                center: layout.center ?? 100,
                right: layout.right ?? 0,
              };
            }
            onLayoutChanged(layout);
          }}
        >
          <Panel
            id="left"
            defaultSize={15}
            minSize={0}
            className="flex flex-col overflow-hidden border-r border-[#313244]"
          >
            <div className="flex shrink-0 border-b border-[#313244] bg-[#11111b]">
              <button
                onClick={() => setLeftPanelTab("scene")}
                className={`flex-1 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] transition-colors ${
                  leftPanelTab === "scene"
                    ? "bg-[#313244] text-[#cdd6f4]"
                    : "text-[#45475a] hover:text-[#a6adc8]"
                }`}
              >
                Cena
              </button>
              <button
                onClick={() => setLeftPanelTab("layers")}
                className={`flex-1 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] transition-colors ${
                  leftPanelTab === "layers"
                    ? "bg-[#313244] text-[#cdd6f4]"
                    : "text-[#45475a] hover:text-[#a6adc8]"
                }`}
              >
                Camadas
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {leftPanelTab === "layers" ? <LayerPanel /> : <HierarchyPanel />}
            </div>
          </Panel>
          <LayoutSplitter />
          <Panel id="center" minSize={20} className="overflow-hidden">
            <ViewportPanel showWorkspaceTabs={false} />
          </Panel>
          <LayoutSplitter />
          <Panel
            id="right"
            defaultSize={20}
            minSize={0}
            className="overflow-hidden border-l border-[#313244]"
          >
            {rightPanelMode === "tools" ? (
              <ToolsPanel
                onRequestInspector={() => setRightPanelMode("inspector")}
                initialActive={toolPanelActive}
                workspace={toolPanelWorkspace}
                showAdvancedByDefault={toolPanelShowAdvanced}
              />
            ) : (
              <InspectorPanel />
            )}
          </Panel>
        </Group>
      </div>

      <Console />
    </div>
  );
}
