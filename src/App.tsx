import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Group,
  Panel,
  type GroupImperativeHandle,
  useDefaultLayout,
} from "react-resizable-panels";
import Console from "./components/common/Console";
import LayoutSplitter from "./components/common/LayoutSplitter";
import UnifiedTopBar, {
  type UnifiedTopBarSection,
} from "./components/common/UnifiedTopBar";
import HierarchyPanel from "./components/hierarchy/HierarchyPanel";
import LayerPanel from "./components/hierarchy/LayerPanel";
import type { ToolTab, ToolWorkspace } from "./components/tools/ToolsPanel";
import { buildProject, generateCCode, validateProject } from "./core/ipc/buildService";
import { emulatorLoadRom, emulatorStop } from "./core/ipc/emulatorService";
import { getHwStatus } from "./core/ipc/hwService";
import {
  createProjectFromTemplate,
  importExternalProject,
  listExternalImportProfiles,
  listProjectTemplates,
  openProjectDialog,
  openProjectPath,
  previewProjectDestination,
  suggestProjectBaseDir,
  type ExternalImportProfileSummary,
  type ProjectDestinationPreview,
  type ProjectTemplateSummary,
  setProjectTarget,
} from "./core/ipc/projectService";
import { pollProjectAssetChanges } from "./core/ipc/projectWatcherService";
import {
  getSceneData,
  type Entity,
  type Scene,
} from "./core/ipc/sceneService";
import {
  useEditorStore,
  type EditorWorkspace,
} from "./core/store/editorStore";
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

const ExplorerWorkspace = lazy(() => import("./components/explorer/ExplorerWorkspace"));
const InspectorPanel = lazy(() => import("./components/inspector/InspectorPanel"));
const ToolsPanel = lazy(() => import("./components/tools/ToolsPanel"));
const ViewportPanel = lazy(() => import("./components/viewport/ViewportPanel"));

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

type LayoutPresetId = "artist" | "logic" | "debug" | "playtest";
type WorkspaceGroupId = "core" | "authoring" | "advanced";
type LayoutMap = {
  left: number;
  center: number;
  right: number;
};

const LAYOUT_STORAGE_KEY = "retrodev-shell-saved-layout";

const WORKSPACE_ITEMS: {
  id: EditorWorkspace;
  label: string;
  icon: string;
  description: string;
  group: WorkspaceGroupId;
  badge?: string;
}[] = [
  {
    id: "scene",
    label: "Scene",
    icon: "SC",
    description: "Composicao e edicao da cena",
    group: "core",
  },
  {
    id: "game",
    label: "Game",
    icon: "GM",
    description: "Playtest e runtime",
    group: "core",
  },
  {
    id: "explorer",
    label: "Explorer",
    icon: "EX",
    description: "Arquivos, assets e cenas",
    group: "core",
  },
  {
    id: "logic",
    label: "Logic",
    icon: "LG",
    description: "Fluxo visual e scripting",
    group: "authoring",
  },
  {
    id: "artstudio",
    label: "Art",
    icon: "AT",
    description: "Sprites, slicing e preview",
    group: "authoring",
    badge: "Exp.",
  },
  {
    id: "retrofx",
    label: "FX",
    icon: "FX",
    description: "Profundidade e parallax",
    group: "authoring",
    badge: "Exp.",
  },
  {
    id: "debug",
    label: "Debug",
    icon: "DB",
    description: "Analise e ferramentas avancadas",
    group: "advanced",
  },
];

const WORKSPACE_GROUPS: {
  id: WorkspaceGroupId;
  label: string;
}[] = [
  { id: "core", label: "Core" },
  { id: "authoring", label: "Autoria" },
  { id: "advanced", label: "Debug" },
];

type FirstSuccessStep = {
  label: string;
  detail: string;
  tone: "info" | "warn" | "success";
};

function getTargetLabel(target: "megadrive" | "snes") {
  return target === "megadrive" ? "Mega Drive" : "SNES";
}

function sanitizeProjectDirName(projectName: string) {
  const sanitized = projectName
    .trim()
    .split("")
    .map((character) =>
      /[A-Za-z0-9_-]/.test(character) ? character : "_"
    )
    .join("")
    .replace(/_+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "");

  return sanitized || "Projeto";
}

function joinProjectPathPreview(baseDir: string, leafName: string) {
  if (!baseDir.trim()) {
    return leafName;
  }

  const normalizedBaseDir = baseDir.replace(/[\\/]+$/, "");
  const separator = normalizedBaseDir.includes("\\") ? "\\" : "/";
  return `${normalizedBaseDir}${separator}${leafName}`;
}

function getDefaultTemplateId(templates: ProjectTemplateSummary[]) {
  const builtinReady =
    templates.find((template) => template.id === "starter_guided" && template.available) ??
    templates.find((template) => template.id === "empty" && template.available) ??
    templates.find(
      (template) => template.available && template.source_kind !== "external_sgdk"
    );

  if (builtinReady) {
    return builtinReady.id;
  }

  const externalReady = templates.find(
    (template) => template.available && template.source_kind === "external_sgdk"
  );
  return externalReady?.id ?? templates[0]?.id ?? "";
}

function getTemplateFirstSuccessSteps({
  template,
  target,
  availability,
  donorPath,
}: {
  template: ProjectTemplateSummary;
  target: "megadrive" | "snes";
  availability: {
    available: boolean;
    readyToCreate: boolean;
    reason: string;
  };
  donorPath: string;
}): FirstSuccessStep[] {
  const targetLabel = getTargetLabel(target);
  const steps: FirstSuccessStep[] = [];

  if (template.source_kind === "external_sgdk") {
    steps.push(
      donorPath.trim()
        ? {
            label: "Pasta doadora configurada",
            detail:
              "O wizard vai montar o template a partir da pasta escolhida, sem depender de caminhos absolutos deste host.",
            tone: "success",
          }
        : {
            label: "Escolher pasta doadora SGDK",
            detail:
              availability.reason ||
              "Selecione a pasta doadora antes de criar este template experimental.",
            tone: "warn",
          }
    );
  }

  steps.push({
    label: `Criar o projeto em ${targetLabel}`,
    detail: availability.readyToCreate
      ? "O projeto abre diretamente no Scene workspace, com a cena inicial hidratada no shell atual."
      : "Assim que a configuracao minima estiver pronta, o wizard cria o projeto e abre a cena inicial.",
    tone: availability.readyToCreate ? "success" : "info",
  });

  steps.push(
    template.id === "empty"
      ? {
          label: "Instanciar o primeiro asset",
          detail:
            "Abra o Asset Browser no Scene workspace para colocar o primeiro sprite ou tilemap antes do playtest.",
          tone: "info",
        }
      : {
          label: "Revisar a cena inicial",
          detail:
            "Confirme entidades, camadas e Inspector no Scene workspace antes de ir para o emulador.",
          tone: "info",
        }
  );

  steps.push({
    label: `Rodar Build & Run (${targetLabel})`,
    detail:
      "Use o Game workspace para compilar e validar a ROM no emulador integrado sem sair do fluxo canonico.",
    tone: "info",
  });

  return steps;
}

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
  badge,
  testId,
}: {
  icon: string;
  label: string;
  active: boolean;
  title: string;
  onClick: () => void;
  accent?: "default" | "debug";
  badge?: string;
  testId?: string;
}) {
  const activeTone =
    accent === "debug"
      ? "border-[#f9e2af]/45 bg-[#f9e2af]/12 text-[#f9e2af]"
      : "border-[#cba6f7]/45 bg-[#cba6f7]/14 text-[#e9d5ff]";

  return (
    <button
      type="button"
      title={title}
      data-testid={testId}
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
      {badge ? (
        <span className="text-[8px] font-semibold uppercase tracking-[0.18em] text-[#fab387]">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

type WorkspaceGuideAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  accent?: "default" | "primary" | "success" | "danger";
  title?: string;
};

type WorkspaceGuide = {
  eyebrow: string;
  title: string;
  summary: string;
  checkpoints?: string[];
  detail: string;
  signal?: {
    tone: "info" | "warn" | "error" | "success";
    label: string;
  };
  actions: WorkspaceGuideAction[];
};

function WorkspaceGuideCard({ guide }: { guide: WorkspaceGuide }) {
  const signalToneClass =
    guide.signal?.tone === "error"
      ? "border-[#f38ba8]/35 bg-[#f38ba8]/10 text-[#f38ba8]"
      : guide.signal?.tone === "warn"
        ? "border-[#fab387]/35 bg-[#fab387]/10 text-[#fab387]"
        : guide.signal?.tone === "success"
          ? "border-[#a6e3a1]/35 bg-[#a6e3a1]/10 text-[#a6e3a1]"
          : "border-[#89b4fa]/35 bg-[#89b4fa]/10 text-[#89b4fa]";
  const primaryActions = guide.actions.slice(0, 2);
  const secondaryActions = guide.actions.slice(2);

  return (
    <section
      data-testid="workspace-guide"
      className="mx-4 mt-3 rounded-2xl border border-[#313244] bg-[linear-gradient(135deg,#0b1020,#111827_55%,#0f172a)] px-4 py-3 shadow-[0_16px_32px_rgba(0,0,0,0.18)]"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#89b4fa]">
            {guide.eyebrow}
          </p>
          <h2 className="mt-1 text-sm font-semibold text-[#e2e8f0]">{guide.title}</h2>
          <p className="mt-1 text-[11px] leading-5 text-[#cbd5e1]">{guide.summary}</p>
          {guide.checkpoints?.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5" data-testid="workspace-guide-checkpoints">
              {guide.checkpoints.map((checkpoint) => (
                <span
                  key={checkpoint}
                  className="inline-flex items-center rounded-full border border-[#313244] bg-black/15 px-2 py-1 text-[10px] font-medium text-[#bac2de]"
                >
                  {checkpoint}
                </span>
              ))}
            </div>
          ) : null}
          {guide.signal ? (
            <div
              data-testid="workspace-guide-signal"
              className={`mt-2 inline-flex max-w-full items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold ${signalToneClass}`}
            >
              {guide.signal.label}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 lg:max-w-[18rem] lg:justify-end">
          {primaryActions.map((action) => (
            <ToolbarButton
              key={action.label}
              label={action.label}
              onClick={action.onClick}
              disabled={action.disabled}
              accent={action.accent}
              title={action.title}
            />
          ))}
        </div>
      </div>
      <details className="mt-2 rounded-xl border border-[#1f2937] bg-black/10 px-3 py-2">
        <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7f849c]">
          Contexto e atalhos
        </summary>
        <p className="mt-2 text-[11px] leading-5 text-[#94a3b8]">{guide.detail}</p>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-[#7f849c]">
          <span className="rounded-full border border-[#1f2937] bg-black/10 px-2 py-1">
            Rail: troca workspace
          </span>
          <span className="rounded-full border border-[#1f2937] bg-black/10 px-2 py-1">
            Presets: reorganizam o shell
          </span>
          <span className="rounded-full border border-[#1f2937] bg-black/10 px-2 py-1">
            Tools: painel contextual
          </span>
        </div>
        {secondaryActions.length > 0 ? (
          <div className="mt-3 border-t border-[#1f2937] pt-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#64748b]">
              Mais acoes
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {secondaryActions.map((action) => (
                <ToolbarButton
                  key={action.label}
                  label={action.label}
                  onClick={action.onClick}
                  disabled={action.disabled}
                  accent={action.accent}
                  title={action.title}
                />
              ))}
            </div>
          </div>
        ) : null}
      </details>
    </section>
  );
}

function TemplateFirstSuccessCard({
  templateName,
  targetLabel,
  steps,
}: {
  templateName: string;
  targetLabel: string;
  steps: FirstSuccessStep[];
}) {
  function toneClass(tone: FirstSuccessStep["tone"]) {
    if (tone === "success") {
      return "border-[#a6e3a1]/25 bg-[#a6e3a1]/10 text-[#a6e3a1]";
    }
    if (tone === "warn") {
      return "border-[#fab387]/25 bg-[#fab387]/10 text-[#fab387]";
    }
    return "border-[#89b4fa]/25 bg-[#89b4fa]/10 text-[#89b4fa]";
  }

  return (
    <div
      data-testid="template-first-success"
      className="rounded border border-[#313244] bg-[#11111b] p-3 text-[10px] text-[#7f849c]"
    >
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[#94e2d5]">
            Primeiro sucesso
          </p>
          <p className="mt-1 text-[#cdd6f4]">
            Caminho recomendado para <span className="font-semibold">{templateName}</span>
          </p>
          <p className="mt-1 leading-5 text-[#94a3b8]">
            Fluxo canonico desta escolha: <span className="font-semibold text-[#cdd6f4]">Scene</span>{" "}
            primeiro, depois <span className="font-semibold text-[#cdd6f4]">Game</span> para o
            playtest em {targetLabel}.
          </p>
        </div>
        <span className="rounded-full border border-[#313244] bg-[#181825] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-[#cdd6f4]">
          {targetLabel}
        </span>
      </div>

      <ol className="mt-3 grid gap-2 md:grid-cols-2">
        {steps.map((step, index) => (
          <li
            key={`${step.label}-${index}`}
            className="rounded border border-[#313244] bg-[#181825] px-3 py-2"
          >
            <div className="flex items-start gap-2">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0b1020] text-[9px] font-semibold text-[#cba6f7]">
                {index + 1}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[11px] font-semibold text-[#e2e8f0]">{step.label}</p>
                  <span className={`rounded-full border px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.14em] ${toneClass(step.tone)}`}>
                    {step.tone === "success"
                      ? "Pronto"
                      : step.tone === "warn"
                        ? "Bloqueio"
                        : "Proximo"}
                  </span>
                </div>
                <p className="mt-1 leading-5 text-[#94a3b8]">{step.detail}</p>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function WorkspacePanelPlaceholder({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-[#09090b] px-4 text-center text-[11px] text-[#64748b]">
      {label}
    </div>
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
  closeProject: () => Promise<void>;
  persistScene: (scope?: string, successMessage?: string) => Promise<boolean>;
  setSceneDraft: (scene: Scene) => Promise<boolean>;
  setSelectedEntityId: (entityId: string | null) => boolean;
  setActiveLayerId: (layerId: string | null) => boolean;
  setEditorMode: (mode: "select" | "paint" | "erase" | "collision") => boolean;
  setActiveBrush: (relativeAssetPath: string | null) => boolean;
  setRightPanelMode: (mode: "inspector" | "tools") => boolean;
  openToolsWorkspace: (
    activeTool: ToolTab,
    workspace?: ToolWorkspace,
    showAdvanced?: boolean
  ) => boolean;
  selectWorkspace: (workspace: EditorWorkspace) => boolean;
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
    activeScenePath,
    setActiveProject,
    activeTarget,
    setActiveTarget,
    emulatorLoaded,
    setEmulatorLoaded,
    setActiveScene,
    setActiveScenePath,
    activeWorkspace,
    setActiveWorkspace,
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
    setProjectLegacyIndex,
    consoleVisible,
    toggleConsole,
  } = useEditorStore();

  const [building, setBuilding] = useState(false);
  const [rightPanelMode, setRightPanelMode] = useState<"inspector" | "tools">("inspector");
  const [toolPanelActive, setToolPanelActive] = useState<ToolTab>("setup");
  const [toolPanelWorkspace, setToolPanelWorkspace] = useState<ToolWorkspace>("editing");
  const [toolPanelShowAdvanced, setToolPanelShowAdvanced] = useState(false);
  const [leftPanelTab, setLeftPanelTab] = useState<"scene" | "layers">("scene");
  const [focusedShell, setFocusedShell] = useState(false);
  const [layoutPreset, setLayoutPreset] = useState<LayoutPresetId>("artist");
  const [shellWidth, setShellWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1440
  );
  const [newProjName, setNewProjName] = useState("MeuProjeto");
  const [projectNameSuggestionMode, setProjectNameSuggestionMode] = useState<"auto" | "manual">(
    "auto"
  );
  const [newProjTarget, setNewProjTarget] = useState<"megadrive" | "snes">("megadrive");
  const [newProjBaseDir, setNewProjBaseDir] = useState("");
  const [automaticBaseDirHint, setAutomaticBaseDirHint] = useState("");
  const [projectDestinationPreview, setProjectDestinationPreview] =
    useState<ProjectDestinationPreview | null>(null);
  const [lastExistingProjectPreview, setLastExistingProjectPreview] =
    useState<ProjectDestinationPreview | null>(null);
  const [projectTemplates, setProjectTemplates] = useState<ProjectTemplateSummary[]>([]);
  const [externalImportProfiles, setExternalImportProfiles] = useState<ExternalImportProfileSummary[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedExternalImportProfileId, setSelectedExternalImportProfileId] = useState("");
  const [showExternalImportSection, setShowExternalImportSection] = useState(false);
  const [templateDonorPaths, setTemplateDonorPaths] = useState<Record<string, string>>({});
  const [showProjectWizard, setShowProjectWizard] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [copiedEntity, setCopiedEntity] = useState<Entity | null>(null);
  const [explorerBreadcrumb, setExplorerBreadcrumb] = useState<string | null>(null);
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
  const selectedTemplateAvailability = selectedTemplate
    ? templateAvailability(selectedTemplate)
    : null;
  const selectedTemplateDonorPath = selectedTemplate
    ? templateDonorPaths[selectedTemplate.id] || selectedTemplate.default_donor_path || ""
    : "";
  const selectedTemplateFirstSuccessSteps =
    selectedTemplate && selectedTemplateAvailability
      ? getTemplateFirstSuccessSteps({
          template: selectedTemplate,
          target: newProjTarget,
          availability: selectedTemplateAvailability,
          donorPath: selectedTemplateDonorPath,
        })
      : [];
  const selectedExternalImportProfile =
    externalImportProfiles.find((profile) => profile.id === selectedExternalImportProfileId) ?? null;
  const estimatedProjectRoot = (newProjBaseDir || automaticBaseDirHint).trim();
  const estimatedProjectDirName =
    projectDestinationPreview?.suggested_dir_name ?? sanitizeProjectDirName(newProjName);
  const estimatedProjectDestination =
    projectDestinationPreview?.resolved_path ??
    joinProjectPathPreview(estimatedProjectRoot, estimatedProjectDirName);
  const pendingSuggestedProjectName =
    projectDestinationPreview?.suggested_name &&
    projectDestinationPreview.suggested_name !== newProjName
      ? projectDestinationPreview.suggested_name
      : null;
  const detectedExistingProjectPreview =
    projectDestinationPreview?.collision_status === "existing_project"
      ? projectDestinationPreview
      : lastExistingProjectPreview &&
          lastExistingProjectPreview.suggested_name === newProjName
        ? lastExistingProjectPreview
        : null;
  const workspaceMeta =
    WORKSPACE_ITEMS.find((workspace) => workspace.id === activeWorkspace) ?? WORKSPACE_ITEMS[0];

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
    if (activeWorkspace === "debug" || activeWorkspace === "explorer") {
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
  }, [activeViewportTab, activeWorkspace, setActiveWorkspace]);

  useEffect(() => {
    if (activeWorkspace !== "explorer") {
      setExplorerBreadcrumb(null);
    }
  }, [activeWorkspace]);

  useEffect(() => {
    if (showProjectWizard && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [showProjectWizard]);

  useEffect(() => {
    if (!showProjectWizard) {
      setShowExternalImportSection(false);
      return;
    }

    let cancelled = false;

    async function loadTemplates() {
      setTemplatesLoading(true);
      try {
        const [templates, profiles] = await Promise.all([
          listProjectTemplates(),
          listExternalImportProfiles(),
        ]);
        if (cancelled) {
          return;
        }
        setProjectTemplates(templates);
        setExternalImportProfiles(profiles);
        setSelectedTemplateId((current) => {
          if (templates.some((template) => template.id === current)) {
            return current;
          }
          return getDefaultTemplateId(templates);
        });
        setSelectedExternalImportProfileId((current) => {
          if (profiles.some((profile) => profile.id === current)) {
            return current;
          }
          const defaultProfile = profiles.find((profile) => profile.importable) ?? profiles[0];
          return defaultProfile?.id ?? "";
        });
      } catch (error) {
        if (!cancelled) {
          setProjectTemplates([]);
          setExternalImportProfiles([]);
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
    if (!showProjectWizard) {
      return;
    }

    let cancelled = false;

    void suggestProjectBaseDir()
      .then((path) => {
        if (!cancelled) {
          setAutomaticBaseDirHint(path);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAutomaticBaseDirHint("");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [showProjectWizard]);

  useEffect(() => {
    if (!showProjectWizard) {
      setProjectDestinationPreview(null);
      setLastExistingProjectPreview(null);
      return;
    }

    if (!estimatedProjectRoot) {
      setProjectDestinationPreview(null);
      return;
    }

    let cancelled = false;
    void previewProjectDestination(newProjName, estimatedProjectRoot)
      .then((preview) => {
        if (cancelled) {
          return;
        }

        setProjectDestinationPreview(preview);
        if (preview.collision_status === "existing_project") {
          setLastExistingProjectPreview(preview);
        }

        if (
          projectNameSuggestionMode === "auto" &&
          preview.suggested_name.trim() &&
          preview.suggested_name !== newProjName
        ) {
          setNewProjName(preview.suggested_name);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProjectDestinationPreview(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [showProjectWizard, estimatedProjectRoot, newProjName, projectNameSuggestionMode]);

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
  const breadcrumbItems = [
    activeProjectName || "Sem projeto",
    activeWorkspace === "explorer"
      ? "Explorer"
      : activeScenePath || workspaceMeta.label,
    ...(activeWorkspace === "explorer" && explorerBreadcrumb ? [explorerBreadcrumb] : []),
  ];
  const topBarMenuSections: UnifiedTopBarSection[] = [
    {
      title: "Projeto",
      actions: [
        {
          label: "Novo",
          onClick: () => setShowProjectWizard(true),
          accent: "primary",
        },
        {
          label: "Abrir",
          onClick: () => void handleOpenProject(),
        },
        {
          label: creatingProject ? "Importando..." : "Importar Externo",
          onClick: () => void handleImportExternalProject(),
          disabled: creatingProject || templatesLoading,
        },
        {
          label: "Salvar",
          onClick: () => void handleSaveScene(),
          disabled: !activeProjectDir,
        },
        {
          label: "Fechar",
          onClick: () => void handleCloseProject(),
          disabled: !activeProjectDir,
          accent: "danger",
        },
      ],
    },
    {
      title: "Ferramentas",
      actions: [
        {
          label: "Validar",
          onClick: () => void handleValidate(),
          disabled: !activeProjectDir,
        },
        {
          label: "Gerar C",
          onClick: () => void handleGenerateC(),
          disabled: !activeProjectDir,
        },
        {
          label: "Copiar",
          onClick: handleCopyEntity,
          disabled: !selectedEntityId || selectedEntityId.startsWith("layer::"),
        },
        {
          label: "Colar",
          onClick: () => void handlePasteEntity(),
          disabled: !copiedEntity || !activeProjectDir,
        },
      ],
    },
    {
      title: "Layout",
      actions: [
        {
          label: "Salvar layout",
          onClick: saveCurrentLayout,
        },
        {
          label: "Restaurar layout",
          onClick: restoreSavedLayout,
        },
        {
          label: "Atalhos",
          onClick: () => setShowShortcuts(true),
        },
        {
          label: "Sobre",
          onClick: () => setShowAbout(true),
          testId: "menu-action-about",
        },
      ],
    },
  ];

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
      setActiveWorkspace("scene");
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
      setProjectSourceKind("");
      setProjectLegacyIndex(null);
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
      setProjectSourceKind("");
      setProjectLegacyIndex(null);
      return false;
    }

    setActiveProject(projectDir, projectName);
    setSelectedEntityId(null);
    setHwStatus(hw);
    setActiveScenePath(sceneData.scene_path);
    setActiveScene(hydrated.resolvedScene, hydrated.sourceScene);
    setProjectSourceKind(sceneData.source_kind ?? "");
    setProjectLegacyIndex(sceneData.legacy_sgdk_index ?? null);
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
        if (result.notice) {
          logMessage("info", `[Projeto] ${result.notice}`);
        }
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
    if (result.notice) {
      logMessage("info", `[Projeto] ${result.notice}`);
    }
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

  function handleProjectNameChange(projectName: string) {
    setProjectNameSuggestionMode("manual");
    setLastExistingProjectPreview(null);
    setNewProjName(projectName);
  }

  function applySuggestedProjectName() {
    if (!pendingSuggestedProjectName) {
      return;
    }

    setProjectNameSuggestionMode("auto");
    setNewProjName(pendingSuggestedProjectName);
  }

  async function openDetectedExistingProject() {
    const existingProjectPath = detectedExistingProjectPreview?.existing_project_path?.trim();
    if (!existingProjectPath) {
      return;
    }

    try {
      await openProjectAtPath(existingProjectPath, "Projeto");
      setShowProjectWizard(false);
      setLastExistingProjectPreview(null);
    } catch (error) {
      logMessage(
        "error",
        `[Projeto] Falha ao abrir projeto existente: ${describeError(error)}`
      );
    }
  }

  function templateAvailability(template: ProjectTemplateSummary) {
    const donorOverride = templateDonorPaths[template.id]?.trim();
    const donorPath = donorOverride || template.default_donor_path || "";
    if (template.source_kind === "external_sgdk" && donorOverride) {
      return {
        available: true,
        readyToCreate: true,
        reason: "Usando uma pasta doadora selecionada manualmente.",
        statusLabel: "Configurado",
        tone: "success" as const,
      };
    }

    if (template.source_kind === "external_sgdk" && !donorPath) {
      return {
        available: true,
        readyToCreate: false,
        reason:
          template.availability_reason ??
          "Requer uma pasta doadora SGDK escolhida manualmente neste host.",
        statusLabel: "Requer pasta",
        tone: "warn" as const,
      };
    }

    return {
      available: template.available,
      readyToCreate: template.available,
      reason: template.availability_reason ?? "",
      statusLabel: template.available ? "Disponivel" : "Indisponivel",
      tone: template.available ? ("success" as const) : ("danger" as const),
    };
  }

  async function chooseTemplateDonorPath(templateId: string) {
    try {
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

  async function chooseExternalProjectPath(profile: ExternalImportProfileSummary) {
    const selected = await open({
      title: `Escolher projeto ${profile.name} para importar`,
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
    if (!availability.readyToCreate) {
      logMessage("warn", `[Projeto] ${availability.reason}`);
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
        if (result.notice) {
          logMessage("info", `[Projeto] ${result.notice}`);
        }
      } else {
        logMessage("warn", `[Projeto] Projeto criado, mas a cena inicial nao foi hidratada: ${result.name}`);
      }
    } catch (error) {
      logMessage("error", `[Projeto] Falha ao criar projeto: ${describeError(error)}`);
    } finally {
      setCreatingProject(false);
    }
  }

  async function handleImportExternalProject() {
    if (!newProjName.trim()) {
      logMessage("warn", "[Projeto] Informe um nome para o projeto importado.");
      return;
    }
    if (!selectedExternalImportProfile) {
      logMessage("warn", "[Projeto] Escolha um importador externo antes de continuar.");
      return;
    }
    if (!selectedExternalImportProfile.importable) {
      logMessage(
        "warn",
        `[Projeto] O perfil '${selectedExternalImportProfile.name}' ainda nao esta importavel: ${selectedExternalImportProfile.support_status}.`
      );
      return;
    }
    if (selectedExternalImportProfile.mega_drive_only && newProjTarget !== "megadrive") {
      logMessage(
        "info",
        `[Projeto] O perfil '${selectedExternalImportProfile.name}' sera importado como projeto Mega Drive nesta wave.`
      );
    }

    try {
      const projectPath = await chooseExternalProjectPath(selectedExternalImportProfile);
      if (!projectPath) {
        return;
      }

      setCreatingProject(true);
      const result = await importExternalProject(
        newProjName.trim(),
        newProjBaseDir.trim(),
        selectedExternalImportProfile.id,
        projectPath
      );
      const hydrated = await hydrateProjectState(result.path, result.name, "Projeto");
      if (hydrated) {
        logMessage(
          "success",
          `Projeto externo (${selectedExternalImportProfile.name}) importado: ${result.name} em ${result.path}`
        );
        if (result.notice) {
          logMessage("info", `[Projeto] ${result.notice}`);
        }
      } else {
        logMessage(
          "warn",
          `[Projeto] Importacao concluida, mas a cena inicial nao foi hidratada: ${result.name}`
        );
      }
    } catch (error) {
      logMessage(
        "error",
        `[Projeto] Falha ao importar projeto ${selectedExternalImportProfile.name}: ${describeError(error)}`
      );
    } finally {
      setCreatingProject(false);
    }
  }

  async function handleEmulatorLoadRom() {
    try {
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
          ? (["jdk", "sgdk", "libretro_megadrive"] as const)
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
      setActiveWorkspace("game");
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

  function handleWorkspaceSelect(workspace: EditorWorkspace) {
    setActiveWorkspace(workspace);

    if (workspace === "debug") {
      openToolsWorkspace("profiler", "debug", true);
      return;
    }

    setRightPanelMode("inspector");
    if (workspace === "explorer") {
      setActiveViewportTab("scene");
      return;
    }

    setActiveViewportTab(workspace);

    if (workspace === "scene") {
      setLeftPanelTab("scene");
    }
  }

  const workspaceGuide = activeProjectDir
    ? (() => {
        const sharedSignal = liveBuildBlocked && buildDisabledReason
          ? {
              tone: "error" as const,
              label: buildDisabledReason,
            }
          : buildWarningSummary
            ? {
                tone: "warn" as const,
                label: buildWarningSummary,
              }
            : emulatorLoaded && activeWorkspace === "game"
              ? {
                  tone: "success" as const,
                  label: "Sessao do emulador pronta para playtest.",
                }
              : {
                  tone: "info" as const,
                  label: `Painel direito atual: ${rightPanelMode === "tools" ? "Tools" : "Inspector"}.`,
                };

        if (activeWorkspace === "explorer") {
          return {
            eyebrow: "Explorer Workspace",
            title: "Navegue pelas cenas, assets canonicos e arquivos do host legado sem sair do shell.",
            summary:
              "A arvore sintetizada usa apenas as APIs atuais do projeto e prepara o caminho para um explorer completo depois, sem mudar contratos do backend nesta wave.",
            detail:
              "Escolha uma cena para ativar, revise assets do projeto e abra o Scene Editor quando quiser voltar para a autoria no canvas.",
            signal: sharedSignal,
            actions: [
              {
                label: "Abrir Scene Editor",
                onClick: () => handleWorkspaceSelect("scene"),
                accent: "primary",
              },
              {
                label: "Abrir Asset Browser",
                onClick: () => openToolsWorkspace("assets", "editing"),
              },
              {
                label: "Abrir Inspector",
                onClick: () => setRightPanelMode("inspector"),
              },
            ],
          } satisfies WorkspaceGuide;
        }

        if (activeWorkspace === "logic") {
          return {
            eyebrow: "Logic Workspace",
            title: "Edite a logica visual da cena sem perder o contexto do projeto.",
            summary:
              "O NodeGraph fica no canvas central, enquanto o painel direito pode alternar entre a Paleta Contextual e o Inspector.",
            detail:
              "Abra a paleta quando quiser descobrir blocos disponiveis, valide o projeto antes de compilar e use o Inspector para revisar a entidade selecionada.",
            signal: sharedSignal,
            actions: [
              {
                label: "Abrir Paleta Contextual",
                onClick: () => openToolsWorkspace("palette", "editing"),
                accent: "primary",
              },
              {
                label: "Validar Projeto",
                onClick: () => void handleValidate(),
              },
              {
                label: "Abrir Inspector",
                onClick: () => setRightPanelMode("inspector"),
              },
            ],
          } satisfies WorkspaceGuide;
        }

        if (activeWorkspace === "game") {
          return {
            eyebrow: "Game Workspace",
            title: "Teste o runtime rapidamente e itere sem sair do editor.",
            summary:
              "Build & Run recompila a cena ativa; Runtime Setup ajuda a conferir toolchains e o profiler fica a um clique do playtest.",
            detail:
              "Quando o build estiver pronto, use o emulador integrado para validar fluxo, input e status de hardware antes de voltar para a cena.",
            signal: sharedSignal,
            actions: [
              {
                label: "Rodar no Emulador",
                onClick: () => void handleBuildAndRun(),
                accent: "success",
                disabled: building || liveBuildBlocked,
                title: liveBuildBlocked ? buildDisabledReason ?? undefined : undefined,
              },
              {
                label: "Abrir Runtime Setup",
                onClick: () => openToolsWorkspace("setup", "editing"),
              },
              {
                label: "Abrir Profiler",
                onClick: () => openToolsWorkspace("profiler", "debug", true),
              },
            ],
          } satisfies WorkspaceGuide;
        }

        if (activeWorkspace === "retrofx") {
          return {
            eyebrow: "FX Workspace",
            title: "Ajuste profundidade, parallax e raster com feedback visual.",
            summary:
              "Use o canvas central para desenhar a leitura do efeito e o Inspector para revisar rapidamente a entidade ou cena relacionada.",
            detail:
              "Depois de mexer nos efeitos, valide o projeto e rode no emulador para confirmar o comportamento no target real.",
            signal: sharedSignal,
            actions: [
              {
                label: "Abrir Inspector",
                onClick: () => setRightPanelMode("inspector"),
                accent: "primary",
              },
              {
                label: "Validar Projeto",
                onClick: () => void handleValidate(),
              },
              {
                label: "Rodar no Emulador",
                onClick: () => void handleBuildAndRun(),
                accent: "success",
                disabled: building || liveBuildBlocked,
                title: liveBuildBlocked ? buildDisabledReason ?? undefined : undefined,
              },
            ],
          } satisfies WorkspaceGuide;
        }

        if (activeWorkspace === "artstudio") {
          return {
            eyebrow: "Art Workspace",
            title: "Prepare sprites e sequencias antes de voltar para a cena.",
            summary:
              "ArtStudio agora organiza stage, timeline e inspector no proprio workspace, enquanto o Asset Browser continua sendo o ponto de entrada para os assets canonicos do projeto.",
            detail:
              "Abra o Asset Browser para escolher a origem certa, revise a sequencia no inspector contextual do workspace e rode no emulador quando quiser checar o resultado.",
            signal: sharedSignal,
            actions: [
              {
                label: "Abrir Asset Browser",
                onClick: () => openToolsWorkspace("assets", "editing"),
                accent: "primary",
              },
              {
                label: "Abrir Inspector",
                onClick: () => setRightPanelMode("inspector"),
              },
              {
                label: "Rodar no Emulador",
                onClick: () => void handleBuildAndRun(),
                accent: "success",
                disabled: building || liveBuildBlocked,
                title: liveBuildBlocked ? buildDisabledReason ?? undefined : undefined,
              },
            ],
          } satisfies WorkspaceGuide;
        }

        if (activeWorkspace === "debug") {
          return {
            eyebrow: "Debug Workspace",
            title: "Analise o projeto ativo sem sair do fluxo principal.",
            summary:
              "Profiler, Memory Viewer, Runtime Setup e Reverse Workspace ficam concentrados aqui para reduzir cliques e contexto perdido.",
            detail:
              "Comece pelo profiler para localizar gargalos, use o memory viewer para inspecionar a sessao atual e mantenha o Runtime Setup por perto quando houver suspeita de ambiente.",
            signal: sharedSignal,
            actions: [
              {
                label: "Abrir Profiler",
                onClick: () => openToolsWorkspace("profiler", "debug", true),
                accent: "primary",
              },
              {
                label: "Abrir Memory Viewer",
                onClick: () => openToolsWorkspace("memory", "debug", true),
              },
              {
                label: "Abrir Runtime Setup",
                onClick: () => openToolsWorkspace("setup", "debug", true),
              },
            ],
          } satisfies WorkspaceGuide;
        }

        return {
          eyebrow: "Scene Editor",
          title: "Monte a cena e valide a selecao sem sair do canvas.",
          summary:
            "Hierarchy, viewport e painel direito ficam alinhados para editar, inspecionar e rodar com menos troca de contexto.",
          checkpoints: [
            "Hierarchy: selecao e cenas",
            "Inspector/Tools: propriedades e utilitarios",
            "Build & Run: validacao rapida",
          ],
          detail:
            "Abra o Asset Browser para instanciar recursos canonicos, revise a entidade ativa no Inspector e rode no emulador assim que a cena estiver pronta.",
          signal: sharedSignal,
          actions: [
            {
              label: "Abrir Asset Browser",
              onClick: () => openToolsWorkspace("assets", "editing"),
              accent: "primary",
            },
            {
              label: "Abrir Inspector",
              onClick: () => setRightPanelMode("inspector"),
            },
            {
              label: "Rodar no Emulador",
              onClick: () => void handleBuildAndRun(),
              accent: "success",
              disabled: building || liveBuildBlocked,
              title: liveBuildBlocked ? buildDisabledReason ?? undefined : undefined,
            },
          ],
        } satisfies WorkspaceGuide;
      })()
    : null;

  useEffect(() => {
    if (!automationEnabled) {
      delete window.__RDS_E2E__;
      return;
    }

    window.__RDS_E2E__ = {
      openProject: (projectDir: string) => openProjectAtPath(projectDir, "E2E"),
      closeProject: () => handleCloseProject(),
      persistScene: (scope = "E2E", successMessage?: string) => {
        const state = useEditorStore.getState();
        if (!state.activeProjectDir) {
          throw new Error("Nenhum projeto aberto para persistir a cena.");
        }
        return persistActiveScene(state.activeProjectDir, scope, successMessage);
      },
      setSceneDraft: async (scene: Scene) => {
        const state = useEditorStore.getState();
        if (!state.activeProjectDir) {
          throw new Error("Nenhum projeto aberto para injetar draft.");
        }

        state.setSelectedEntityId(null);
        state.setActiveScene(scene, scene);
        return true;
      },
      setSelectedEntityId: (entityId: string | null) => {
        useEditorStore.getState().setSelectedEntityId(entityId);
        return true;
      },
      setActiveLayerId: (layerId: string | null) => {
        useEditorStore.getState().setActiveLayerId(layerId);
        return true;
      },
      setEditorMode: (mode: "select" | "paint" | "erase" | "collision") => {
        useEditorStore.getState().setEditorMode(mode);
        return true;
      },
      setActiveBrush: (relativeAssetPath: string | null) => {
        const state = useEditorStore.getState();
        state.setActiveBrush(
          relativeAssetPath
            ? {
                kind: "prefab",
                id: relativeAssetPath,
                assetPath: relativeAssetPath,
              }
            : null
        );
        if (relativeAssetPath) {
          state.setEditorMode("paint");
        }
        return true;
      },
      setRightPanelMode: (mode: "inspector" | "tools") => {
        setRightPanelMode(mode);
        return true;
      },
      openToolsWorkspace: (
        activeTool: ToolTab,
        workspace: ToolWorkspace = "editing",
        showAdvanced = false
      ) => {
        openToolsWorkspace(activeTool, workspace, showAdvanced);
        return true;
      },
      selectWorkspace: (workspace: EditorWorkspace) => {
        handleWorkspaceSelect(workspace);
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
          activeWorkspace: state.activeWorkspace,
          activeViewportTab: state.activeViewportTab,
          activeScenePath: state.activeScenePath,
          emulatorLoaded: state.emulatorLoaded,
          emulPaused: state.emulPaused,
          sceneRevision: state.sceneRevision,
          selectedEntityId: state.selectedEntityId,
          activeLayerId: state.activeLayerId,
          editorMode: state.editorMode,
          rightPanelMode,
          hwValidationState: state.hwValidationState,
          hwValidatedRevision: state.hwValidatedRevision,
          hwValidationError: state.hwValidationError,
          activeSceneEntityCount: state.activeScene?.entities.length ?? 0,
          activeBrush: state.activeBrush
            ? {
                kind: state.activeBrush.kind,
                id: state.activeBrush.id,
                assetPath: state.activeBrush.assetPath ?? null,
              }
            : null,
          activeScene: state.activeScene
            ? {
                sceneId: state.activeScene.scene_id,
                displayName: state.activeScene.display_name ?? state.activeScene.scene_id,
                entityCount: state.activeScene.entities.length,
                backgroundLayerCount: state.activeScene.background_layers.length,
                editorLayerCount: state.activeScene.layers?.length ?? 0,
                collisionSolidCount:
                  state.activeScene.collision_map?.data.filter((value) => value === 1).length ?? 0,
                entities: state.activeScene.entities.map((entity) => ({
                  id: entity.entity_id,
                  displayName: getEntityDisplayName(entity),
                  x: entity.transform.x,
                  y: entity.transform.y,
                  spriteAsset: entity.components.sprite?.asset ?? null,
                  type: entity.components.camera
                    ? "camera"
                    : entity.components.tilemap
                      ? "tilemap"
                      : entity.components.sprite
                        ? "sprite"
                        : entity.components.audio && !entity.components.sprite
                          ? "audio"
                          : "object",
                })),
                layers: (state.activeScene.layers ?? []).map((layer) => ({
                  id: layer.id,
                  name: layer.name,
                  kind: layer.kind,
                  visible: layer.visible,
                  locked: layer.locked,
                  depth: layer.depth,
                  entityCount: layer.entity_ids.length,
                  entityIds: [...layer.entity_ids],
                })),
              }
            : null,
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
  }, [automationEnabled, rightPanelMode]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#11111b] text-[#cdd6f4]">
      {showProjectWizard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3">
          <div className="flex max-h-[calc(100vh-1.5rem)] min-h-0 w-[52rem] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-lg border border-[#313244] bg-[#181825] p-5 shadow-2xl">
            <div className="space-y-1">
              <h2 className="text-sm font-bold text-[#cba6f7]">
                {activeProjectDir ? "Novo Projeto" : "Wizard de Primeiro Uso"}
              </h2>
              <p className="text-[10px] leading-tight text-[#7f849c]">
                Escolha um template, ajuste target/nome/pasta base e crie um projeto editavel
                sem sair do fluxo canonico do editor.
              </p>
            </div>

            <div
              data-testid="project-wizard-body"
              className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1"
            >
              <div className="grid gap-3 md:grid-cols-3">
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
                              availability.tone === "success"
                                ? "bg-[#a6e3a1]/15 text-[#a6e3a1]"
                                : availability.tone === "warn"
                                  ? "bg-[#fab387]/15 text-[#fab387]"
                                  : "bg-[#f38ba8]/15 text-[#f38ba8]"
                            }`}
                          >
                            {availability.statusLabel}
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

            <div className="grid gap-3">
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
                {selectedTemplate ? (
                  <div className="mt-3 rounded border border-[#313244] bg-[#181825] px-3 py-2">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#94e2d5]">
                      Validacao do fluxo
                    </p>
                    <p
                      className={`mt-1 leading-5 ${
                        selectedTemplateAvailability?.readyToCreate
                          ? "text-[#a6e3a1]"
                          : selectedTemplateAvailability?.available
                            ? "text-[#fab387]"
                            : "text-[#f38ba8]"
                      }`}
                    >
                      {selectedTemplateAvailability?.readyToCreate
                        ? "Template pronto para criar projeto."
                        : selectedTemplateAvailability?.reason || "Template ainda indisponivel para este fluxo."}
                    </p>
                    {selectedTemplate.source_kind === "external_sgdk" ? (
                      <p className="mt-1 leading-5 text-[#fab387]">
                        {selectedTemplateDonorPath
                          ? `Template doador atual: ${selectedTemplateDonorPath}`
                          : "Escolha uma pasta doadora SGDK antes de criar este template experimental."}
                      </p>
                    ) : (
                      <p className="mt-1 leading-5 text-[#94a3b8]">
                        Template interno: nenhuma pasta doadora externa e necessaria.
                      </p>
                    )}
                  </div>
                ) : null}
              </div>

              <div
                data-testid="wizard-external-import-section"
                className="rounded border border-[#313244] bg-[#11111b] p-3 text-[10px] text-[#7f849c]"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#fab387]">
                      Trilha secundaria
                    </p>
                    <p className="mt-1 text-[#cdd6f4]">
                      Importar projeto existente
                    </p>
                    <p className="mt-1 leading-5 text-[#94a3b8]">
                      Use esta area quando voce ja tiver um projeto externo real e quiser
                      converter esse projeto para o formato nativo do RetroDev sem misturar isso com o
                      primeiro sucesso do wizard.
                    </p>
                  </div>
                  <ToolbarButton
                    label={showExternalImportSection ? "Ocultar importador" : "Abrir importador"}
                    onClick={() =>
                      setShowExternalImportSection((current) => !current)
                    }
                    testId="wizard-external-import-toggle"
                  />
                </div>
                {showExternalImportSection ? (
                  <div className="mt-3 rounded border border-[#313244] bg-[#181825] p-3">
                    <p className="mb-1 text-[#cdd6f4]">
                      Importador externo:{" "}
                      <span className="font-semibold">
                        {selectedExternalImportProfile?.name ?? "Nenhum"}
                      </span>
                    </p>
                    <p className="leading-5">
                      {selectedExternalImportProfile?.description ??
                        "Escolha um adaptador externo para importar projetos reais para o formato nativo do RetroDev."}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1">
                      <span className="rounded bg-[#313244] px-1.5 py-0.5 text-[10px] text-[#cdd6f4]">
                        {selectedExternalImportProfile?.family ?? "External"}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] ${
                          selectedExternalImportProfile?.importable
                            ? "bg-[#a6e3a1]/15 text-[#a6e3a1]"
                            : "bg-[#fab387]/15 text-[#fab387]"
                        }`}
                      >
                        {selectedExternalImportProfile?.support_status ?? "Nao suportado"}
                      </span>
                      {selectedExternalImportProfile?.supported_levels.map((level) => (
                        <span
                          key={level}
                          className="rounded bg-[#11111b] px-1.5 py-0.5 text-[10px] text-[#7f849c]"
                        >
                          {level}
                        </span>
                      ))}
                    </div>
                    <select
                      data-testid="external-import-profile-select"
                      value={selectedExternalImportProfileId}
                      onChange={(event) => setSelectedExternalImportProfileId(event.target.value)}
                      className="mt-3 w-full rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1.5 text-[11px] text-[#cdd6f4] focus:border-[#cba6f7] focus:outline-none"
                    >
                      {externalImportProfiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name} · {profile.support_status}
                        </option>
                      ))}
                    </select>
                    <p className="mt-2 leading-5 text-[#94a3b8]">
                      {selectedExternalImportProfile?.mega_drive_only
                        ? "Esta wave de importacao externa continua Mega Drive only para manter o caminho canonico enxuto."
                        : "Perfil externo compativel com o fluxo atual do wizard."}
                    </p>
                    <div className="mt-3 flex justify-end">
                      <ToolbarButton
                        label={creatingProject ? "Importando..." : "Importar Externo"}
                        onClick={() => void handleImportExternalProject()}
                        disabled={creatingProject || templatesLoading}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 rounded border border-[#313244] bg-[#181825] px-3 py-2 text-[10px] leading-5 text-[#94a3b8]">
                    Perfil atual:{" "}
                    <span className="font-semibold text-[#cdd6f4]">
                      {selectedExternalImportProfile?.name ?? "Nenhum"}
                    </span>
                    . Abra o importador quando precisar converter um projeto existente em vez
                    de criar um template novo.
                  </div>
                )}
              </div>
            </div>

            {selectedTemplate ? (
              <TemplateFirstSuccessCard
                templateName={selectedTemplate.name}
                targetLabel={getTargetLabel(newProjTarget)}
                steps={selectedTemplateFirstSuccessSteps}
              />
            ) : (
              <div className="rounded border border-[#313244] bg-[#11111b] p-3 text-[10px] leading-5 text-[#7f849c]">
                Escolha um template para o wizard montar um caminho recomendado ate o primeiro
                playtest no fluxo canonico atual.
              </div>
            )}

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

            <div className="grid gap-3 md:grid-cols-[1fr_1.1fr]">
              <div className="space-y-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={newProjName}
                  onChange={(event) => handleProjectNameChange(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && void confirmNewProject()}
                  placeholder="Nome do projeto"
                  className="w-full rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1.5 text-sm text-[#cdd6f4] focus:border-[#cba6f7] focus:outline-none"
                />

                {pendingSuggestedProjectName ? (
                  <div className="rounded border border-[#45475a] bg-[#11111b] p-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[10px] text-[#7f849c]">Nome sugerido</p>
                        <p
                          data-testid="wizard-project-name-suggestion"
                          className="truncate text-xs font-semibold text-[#a6e3a1]"
                        >
                          {pendingSuggestedProjectName}
                        </p>
                      </div>
                      <ToolbarButton label="Usar" onClick={applySuggestedProjectName} />
                    </div>
                    <p className="mt-2 text-[10px] leading-5 text-[#7f849c]">
                      {projectDestinationPreview?.collision_status === "existing_project"
                        ? "O nome original aponta para um projeto RetroDev ja valido. Use o nome sugerido para criar outro sem sobrescrever o existente."
                        : "O nome atual ja ocupa a pasta preferida. Use o nome sugerido para o RetroDev criar o projeto em um destino livre ja nesta tentativa."}
                    </p>
                  </div>
                ) : null}
              </div>

              <div className="rounded border border-[#313244] bg-[#11111b] p-2">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] text-[#7f849c]">Pasta base</p>
                    <p className="truncate font-mono text-[10px] text-[#cdd6f4]">
                      {newProjBaseDir || automaticBaseDirHint || "(automatico pelo sistema)"}
                    </p>
                  </div>
                  <ToolbarButton label="Escolher" onClick={() => void chooseNewProjectBaseDir()} />
                </div>
                <div className="mt-2 border-t border-[#313244] pt-2">
                  <p className="text-[10px] text-[#7f849c]">Destino estimado</p>
                  <p
                    data-testid="wizard-project-destination"
                    className="truncate font-mono text-[10px] text-[#f9e2af]"
                  >
                    {estimatedProjectDestination}
                  </p>
                </div>
                <p className="mt-2 text-[10px] leading-5 text-[#7f849c]">
                  {detectedExistingProjectPreview
                    ? `Ja existe um projeto RetroDev valido em '${detectedExistingProjectPreview.preferred_path}'. Se quiser continuar nele, use 'Abrir projeto existente'. Se preferir criar outro, o wizard sugere um nome livre automaticamente.`
                    : newProjBaseDir
                    ? `Pasta manual selecionada. Se ela falhar na escrita, o backend fara fallback seguro; se '${estimatedProjectDirName}' ja existir, o RetroDev cria '${estimatedProjectDirName}_2' automaticamente.`
                    : automaticBaseDirHint
                      ? `Se voce nao escolher uma pasta, o RetroDev usara '${automaticBaseDirHint}' automaticamente. Se '${estimatedProjectDirName}' ja existir, ele cria '${estimatedProjectDirName}_2' para manter o fluxo.`
                      : `Se voce nao escolher uma pasta, o backend tentara resolver uma localizacao automatica segura. Se '${estimatedProjectDirName}' ja existir, ele criara '${estimatedProjectDirName}_2' automaticamente.`}
                </p>
              </div>
            </div>

            {detectedExistingProjectPreview?.existing_project_path ? (
              <div
                data-testid="wizard-existing-project-card"
                className="mt-3 rounded border border-[#89b4fa]/40 bg-[#11111b] p-3"
              >
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#89b4fa]">
                  Projeto RetroDev encontrado
                </p>
                <p className="mt-2 text-xs text-[#cdd6f4]">
                  O nome original ja aponta para{" "}
                  <span className="font-semibold text-[#a6e3a1]">
                    {detectedExistingProjectPreview.existing_project_name ?? "um projeto existente"}
                  </span>
                  .
                </p>
                <p
                  data-testid="wizard-existing-project-path"
                  className="mt-2 truncate font-mono text-[10px] text-[#94e2d5]"
                >
                  {detectedExistingProjectPreview.existing_project_path}
                </p>
                <p className="mt-2 text-[10px] leading-5 text-[#7f849c]">
                  {pendingSuggestedProjectName
                    ? `Se a sua intencao era continuar no projeto original, abra-o agora. Se voce queria um projeto novo, o wizard pode trocar o campo para '${pendingSuggestedProjectName}' sem interromper o fluxo.`
                    : `Se voce queria um projeto novo, o wizard ja ajustou o nome para '${newProjName}' e manteve o projeto original intacto. Se a intencao era continuar no original, voce pode abri-lo daqui.`}
                </p>
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  {pendingSuggestedProjectName ? (
                    <ToolbarButton label="Usar nome sugerido" onClick={applySuggestedProjectName} />
                  ) : null}
                  <ToolbarButton
                    label="Abrir projeto existente"
                    onClick={() => void openDetectedExistingProject()}
                    accent="success"
                    testId="wizard-open-existing-project"
                  />
                </div>
              </div>
            ) : null}
            </div>

            <div
              data-testid="project-wizard-actions"
              className="mt-4 flex flex-wrap justify-end gap-2 border-t border-[#313244] bg-[#181825] pt-3"
            >
              {activeProjectDir ? (
                <ToolbarButton label="Cancelar" onClick={() => setShowProjectWizard(false)} />
              ) : null}
              <ToolbarButton label="Abrir Existente" onClick={() => void handleOpenProject()} />
              <ToolbarButton
                label={creatingProject ? "Criando..." : "Criar Projeto"}
                onClick={() => void confirmNewProject()}
                accent="primary"
                disabled={
                  creatingProject ||
                  templatesLoading ||
                  !selectedTemplate ||
                  !selectedTemplateAvailability?.readyToCreate
                }
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

      <UnifiedTopBar
        appName="RetroDev Studio"
        appTagline="Workspace adaptativo para autoria, playtest e debug."
        breadcrumbs={breadcrumbItems}
        menuSections={topBarMenuSections}
        centerContent={
          <>
            <div className="flex overflow-hidden rounded-full border border-[#313244] bg-[#0b1020]">
              {(["megadrive", "snes"] as const).map((target) => (
                <button
                  key={target}
                  onClick={() => void handleSwitchTarget(target)}
                  disabled={!activeProjectDir || activeTarget === target}
                  className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] transition-colors ${
                    activeTarget === target
                      ? target === "megadrive"
                        ? "bg-[#a6e3a1] text-[#1e1e2e]"
                        : "bg-[#89b4fa] text-[#1e1e2e]"
                      : "text-[#7f849c] hover:bg-[#111827] disabled:cursor-not-allowed"
                  }`}
                >
                  {target === "megadrive" ? "MD" : "SNES"}
                </button>
              ))}
            </div>
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
            />
            <ToolbarButton
              label="Stop"
              onClick={() => void handleEmulatorStop()}
              disabled={!emulatorLoaded}
              accent="danger"
            />
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
          </>
        }
        rightContent={
          <>
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
            <ToolbarButton
              label={focusedShell ? "Sair do foco" : "Focus"}
              onClick={toggleFocusMode}
            />
            <ToolbarButton label="Console" onClick={toggleConsole} />
          </>
        }
      />

      {!showProjectWizard && !focusedShell && workspaceGuide && (
        <WorkspaceGuideCard key={workspaceMeta.id} guide={workspaceGuide} />
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside
          data-testid="workspace-activity-bar"
          className="flex w-[56px] shrink-0 flex-col border-r border-[#27272a] bg-[#09090b]"
        >
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-1.5 py-3">
            {WORKSPACE_GROUPS.map((group) => {
              const groupItems = WORKSPACE_ITEMS.filter((workspace) => workspace.group === group.id);
              return (
                <div
                  key={group.id}
                  data-testid={`workspace-rail-group-${group.id}`}
                  className="rounded-2xl border border-[#18181b] bg-[#0b1120] px-1 py-1.5"
                >
                  <p className="px-1 text-center text-[8px] font-semibold uppercase tracking-[0.18em] text-[#475569]">
                    {group.label}
                  </p>
                  <div className="mt-1 flex flex-col items-center gap-2">
                    {groupItems.map((workspace) => (
                      <WorkspaceRailButton
                        key={workspace.id}
                        icon={workspace.icon}
                        label={workspace.label}
                        active={activeWorkspace === workspace.id}
                        title={workspace.description}
                        accent={workspace.id === "debug" ? "debug" : "default"}
                        badge={workspace.badge}
                        testId={`workspace-rail-${workspace.id}`}
                        onClick={() => handleWorkspaceSelect(workspace.id)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
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
            {activeWorkspace === "explorer" ? (
              <div className="flex h-full min-h-0 flex-col bg-[#0b1120]">
                <div className="border-b border-[#313244] px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#7dd3fc]">
                    Explorer
                  </div>
                  <div className="mt-1 text-[11px] text-[#64748b]">
                    Estrutura sintetizada no stage central.
                  </div>
                </div>
                <div className="min-h-0 flex-1 px-3 py-4 text-[12px] leading-6 text-[#94a3b8]">
                  Use o workspace central para navegar por cenas, assets canonicos e arquivos do host legado sem mudar contratos de IPC.
                </div>
              </div>
            ) : (
              <>
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
              </>
            )}
          </Panel>
          <LayoutSplitter />
          <Panel id="center" minSize={20} className="overflow-hidden">
            {activeWorkspace === "explorer" ? (
              <Suspense fallback={<WorkspacePanelPlaceholder label="Carregando Explorer..." />}>
                <ExplorerWorkspace
                  onSelectionChange={setExplorerBreadcrumb}
                  onOpenSceneEditor={() => handleWorkspaceSelect("scene")}
                />
              </Suspense>
            ) : (
              <Suspense fallback={<WorkspacePanelPlaceholder label="Carregando Workspace..." />}>
                <ViewportPanel showWorkspaceTabs={false} />
              </Suspense>
            )}
          </Panel>
          <LayoutSplitter />
          <Panel
            id="right"
            defaultSize={20}
            minSize={0}
            className="overflow-hidden border-l border-[#313244]"
          >
            <div className="flex h-full min-h-0 flex-col bg-[#09090b]">
              <div className="flex items-center justify-between border-b border-[#27272a] bg-[#111827] px-3 py-2">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#94a3b8]">
                    {rightPanelMode === "tools" ? "Tools" : "Inspector"}
                  </div>
                  <div className="mt-1 text-[11px] text-[#64748b]">
                    Painel contextual do workspace ativo
                  </div>
                </div>
                <div className="flex items-center gap-1 rounded-full border border-[#313244] bg-[#09090b] p-1">
                  <button
                    type="button"
                    onClick={() => setRightPanelMode("inspector")}
                    className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors ${
                      rightPanelMode === "inspector"
                        ? "bg-[#cba6f7] text-[#111827]"
                        : "text-[#94a3b8] hover:bg-[#1f2937] hover:text-[#e5e7eb]"
                    }`}
                  >
                    Inspector
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      openToolsWorkspace(
                        toolPanelActive === "setup" ? "palette" : toolPanelActive,
                        activeWorkspace === "debug" ? "debug" : "editing",
                        activeWorkspace === "debug" || toolPanelShowAdvanced
                      )
                    }
                    className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors ${
                      rightPanelMode === "tools"
                        ? "bg-[#cba6f7] text-[#111827]"
                        : "text-[#94a3b8] hover:bg-[#1f2937] hover:text-[#e5e7eb]"
                    }`}
                  >
                    Tools
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                {rightPanelMode === "tools" ? (
                  <Suspense fallback={<WorkspacePanelPlaceholder label="Carregando Tools..." />}>
                    <ToolsPanel
                      onRequestInspector={() => setRightPanelMode("inspector")}
                      initialActive={toolPanelActive}
                      workspace={toolPanelWorkspace}
                      showAdvancedByDefault={toolPanelShowAdvanced}
                    />
                  </Suspense>
                ) : (
                  <Suspense fallback={<WorkspacePanelPlaceholder label="Carregando Inspector..." />}>
                    <InspectorPanel />
                  </Suspense>
                )}
              </div>
            </div>
          </Panel>
        </Group>
      </div>

      <Console />
    </div>
  );
}
