import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Group,
  Panel,
  type GroupImperativeHandle,
  useDefaultLayout,
} from "react-resizable-panels";
import Console from "./components/common/Console";
import AdaptivePanel, { type AdaptivePanelTone } from "./components/common/AdaptivePanel";
import Button, { type ButtonVariant } from "./components/common/Button";
import Dialog from "./components/common/Dialog";
import Icon, { type IconName } from "./components/common/Icon";
import Input from "./components/common/Input";
import Select from "./components/common/Select";
import Tabs from "./components/common/Tabs";
import LayoutSplitter from "./components/common/LayoutSplitter";
import type { LayoutResizeIntent } from "./components/common/LayoutSplitter";
import UnifiedTopBar, {
  type UnifiedTopBarSection,
} from "./components/common/UnifiedTopBar";
import HierarchyPanel from "./components/hierarchy/HierarchyPanel";
import LayerPanel from "./components/hierarchy/LayerPanel";
import type { ToolTab, ToolWorkspace } from "./components/tools/ToolsPanel";
import { buildProject, generateCCode, validateProject } from "./core/ipc/buildService";
import { emulatorLoadRom, emulatorStop } from "./core/ipc/emulatorService";
import { inspectRomMastering } from "./core/ipc/projectCapabilityService";
import { getHwStatus } from "./core/ipc/hwService";
import {
  createProjectFromTemplate,
  importExternalProject,
  importSgdkProject,
  listExternalImportProfiles,
  listProjectTemplates,
  openProjectDialog,
  openProjectPath,
  openProjectSourcePath,
  previewProjectDestination,
  suggestProjectBaseDir,
  type ExternalImportProfileSummary,
  type ProjectDestinationPreview,
  type ProjectSettingsPayload,
  type ProjectSettingsSnapshot,
  type ProjectTemplateSummary,
  getProjectSettings,
  setProjectTarget,
  updateProjectSettings,
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
import {
  buildAreaForTarget,
  createFallbackDiagnostic,
  importAreaForProfile,
  normalizeBuildDiagnostics,
  type ActionableDiagnostic,
} from "./core/diagnostics";
import { classifyImageAssetInstantiation } from "./core/assetInstantiation";
import {
  createSpriteEntityFromAsset,
  createTilemapEntityFromAsset,
} from "./core/editorEntityFactory";
import { getEntityDisplayName } from "./core/entityDisplay";
import {
  getPreferredSceneEntity,
  resolveSceneWorkspaceContext,
} from "./core/sceneWorkspaceContext";
import { resolveSceneWorldMetrics } from "./core/sceneWorldModel";
import {
  DEFAULT_SHORTCUTS,
  getPaletteCommands,
  findShortcutConflicts,
  formatShortcutKeys,
  getShortcutLabel,
  getShortcutTitle,
  groupShortcutsByGroup,
  loadShortcutCustomizations,
  resetShortcutCustomizations,
  resolveShortcutCommand,
  saveShortcutCustomizations,
  searchCommands,
  updateShortcutBinding,
  type CommandSearchResult,
  type ShortcutCommand,
  type ShortcutConflict,
} from "./core/shortcuts";
import {
  getPresetLayout,
  resolveWorkspaceShellConfig,
  type LayoutMap,
  type LayoutPresetId,
} from "./core/workspaceLayout";
import {
  buildSgdkCapabilityMatrix,
  formatSgdkImportSummaryKind,
  type CapabilityTone,
  type SgdkImportSummary,
} from "./core/sgdkLogicDiagnostics";

const ExplorerWorkspace = lazy(() => import("./components/explorer/ExplorerWorkspace"));
const InspectorPanel = lazy(() => import("./components/inspector/InspectorPanel"));
const ToolsPanel = lazy(() => import("./components/tools/ToolsPanel"));
const ViewportPanel = lazy(() => import("./components/viewport/ViewportPanel"));

function looksLikeRuntimeDependencyFailure(message: string): boolean {
  const lower = message.toLowerCase();
  return [
    "toolchain",
    "sgdk",
    "pvsneslib",
    "java",
    "jdk",
    "libretro",
    "make",
    "bash",
    "msvc",
    "cl.exe",
    "webdriver",
    "tauri-driver",
  ].some((token) => lower.includes(token));
}

function formatBuildFailureSummary(errorLines: string[]): string {
  const tail = errorLines.slice(-6).join("\n");
  if (tail.length === 0) {
    return "Build falhou sem linhas de erro no log. Acesse a aba Runtime Setup (Debug > Ferramentas > Runtime Setup), clique Revalidar e verifique o Console para o historico completo.";
  }
  const setupHint = looksLikeRuntimeDependencyFailure(tail)
    ? "\n\nAcao: abra a aba Runtime Setup (Debug > Ferramentas > Runtime Setup), clique Revalidar e corrija a dependencia indicada antes de tentar novamente."
    : "\n\nAcao: revise as mensagens de erro acima, corrija o problema no projeto e clique Build & Run novamente.";
  return `Build falhou. Erros:\n${tail}${setupHint}`;
}

function formatEmulatorFailureMessage(message: string): string {
  if (looksLikeRuntimeDependencyFailure(message)) {
    return `Emulador: ${message}\n\nAcao: acesse a aba Runtime Setup (Debug > Ferramentas > Runtime Setup), clique Revalidar e confirme que o core Libretro esta instalado antes de carregar a ROM novamente.`;
  }
  return `Emulador: ${message}`;
}

function ToolbarButton({
  label,
  icon,
  compactLabel = false,
  onClick,
  disabled = false,
  accent = "default",
  testId,
  title,
  describedBy,
}: {
  label: string;
  icon?: IconName;
  compactLabel?: boolean;
  onClick: () => void;
  disabled?: boolean;
  accent?: "default" | "primary" | "success" | "danger";
  testId?: string;
  title?: string;
  describedBy?: string;
}) {
  const variant: ButtonVariant = accent === "danger"
    ? "danger"
    : accent === "primary" || accent === "success"
      ? "primary"
      : "secondary";

  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      title={title}
      aria-describedby={describedBy}
      iconStart={icon ? <Icon name={icon} size={15} /> : undefined}
      className="shrink-0"
    >
      <span className={compactLabel ? "sr-only 2xl:not-sr-only" : undefined}>{label}</span>
    </Button>
  );
}

type WorkspaceGroupId = "core" | "authoring" | "advanced";

const LAYOUT_STORAGE_KEY = "retrodev-shell-saved-layout";
const WORKSPACE_GUIDE_STORAGE_KEY = "retrodev-workspace-guide-expanded";
const SRAM_SIZE_OPTIONS = [2048, 8192, 16384, 32768, 65536];

function projectSettingsToPayload(
  settings: ProjectSettingsSnapshot
): ProjectSettingsPayload {
  return {
    target: settings.target,
    region: settings.region,
    video_standard: settings.video_standard,
    internal_rom_name: settings.internal_rom_name,
    sram: { ...settings.sram },
    save_slots: settings.save_slots,
    debug_overlay: settings.debug_overlay,
  };
}

function projectSettingsWarnings(settings: ProjectSettingsPayload): string[] {
  const warnings: string[] = [];
  if (settings.target === "megadrive" && settings.sram.enabled) {
    warnings.push("SRAM sera declarada no header da ROM Mega Drive no proximo build.");
    warnings.push(
      "Build precisa passar antes de tratar save como funcional; runtime save depende de observacao Libretro/AAA."
    );
  } else if (settings.target === "megadrive") {
    warnings.push("SRAM off: ROM Mega Drive nao vai declarar backup RAM.");
  } else if (settings.sram.enabled) {
    warnings.push(
      "SRAM configurada fica preparada no schema, mas o build atual so aplica header SRAM no Mega Drive."
    );
  }

  warnings.push(
    "Save runtime ainda nao comprovado: use Build & Run e ROM report antes de tratar save como funcional."
  );

  if (settings.debug_overlay) {
    warnings.push(
      "Debug overlay sera tratado como contrato de build/runtime, sem prometer HUD final no jogo."
    );
  }

  return warnings;
}

function mergeProjectSettingsWarnings(
  settings: ProjectSettingsSnapshot,
  localWarnings: string[]
): ProjectSettingsSnapshot {
  const warnings = [...settings.warnings, ...localWarnings].filter(
    (warning, index, all) => all.indexOf(warning) === index
  );
  return { ...settings, warnings };
}

const EXECUTABLE_COMMAND_IDS = new Set([
  "project.open",
  "scene.save",
  "build.run",
  "build.validate",
  "code.generate",
  "edit.undo",
  "edit.redo",
  "layout.focus",
  "layout.save",
  "layout.restore",
  "commandPalette.open",
  "shortcuts.edit",
  "workspace.scene",
  "workspace.logic",
  "workspace.artstudio",
  "tools.runtimeSetup",
  "tools.assetBrowser",
  "console.open",
  "emulator.play",
  "emulator.stop",
]);

const WORKSPACE_ITEMS: {
  id: EditorWorkspace;
  label: string;
  icon: IconName;
  description: string;
  group: WorkspaceGroupId;
  badge?: string;
}[] = [
  {
    id: "scene",
    label: "Scene",
    icon: "palette",
    description: "Composicao e edicao da cena",
    group: "core",
  },
  {
    id: "game",
    label: "Game",
    icon: "gamepad",
    description: "Playtest e runtime",
    group: "core",
  },
  {
    id: "explorer",
    label: "Explorer",
    icon: "folder",
    description: "Arquivos, assets e cenas",
    group: "core",
  },
  {
    id: "logic",
    label: "Logic",
    icon: "network",
    description: "Fluxo visual e scripting",
    group: "authoring",
  },
  {
    id: "artstudio",
    label: "Art",
    icon: "palette",
    description: "Sprites, slicing e preview",
    group: "authoring",
    badge: "Exp.",
  },
  {
    id: "retrofx",
    label: "FX",
    icon: "magic-wand",
    description: "Profundidade e parallax",
    group: "authoring",
    badge: "Exp.",
  },
  {
    id: "debug",
    label: "Debug",
    icon: "bug",
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
  icon: IconName;
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
      ? "border-[var(--rds-status-warning)]/45 bg-[var(--rds-status-warning)]/12 text-[var(--rds-status-warning)]"
      : "border-[var(--rds-action-primary)]/45 bg-[var(--rds-action-primary)]/14 text-[var(--rds-text-primary)]";

  return (
    <button
      type="button"
      aria-label={`${label}: ${title}`}
      title={title}
      data-testid={testId}
      onClick={onClick}
      className={`group flex w-full shrink-0 flex-col items-center gap-1 rounded-2xl border px-2 py-1.5 text-center transition-colors ${
        active
          ? activeTone
          : "border-transparent text-[var(--rds-text-muted)] hover:border-[var(--rds-border-subtle)] hover:bg-[var(--rds-surface-panel-strong)] hover:text-[var(--rds-text-primary)]"
      }`}
    >
      <span
        aria-hidden="true"
        className="flex h-8 w-8 items-center justify-center rounded-xl border border-current/20"
      >
        <Icon name={icon} size={18} />
      </span>
      <span className="sr-only">{label}</span>
      {badge ? (
        <span
          aria-hidden="true"
          className="text-[8px] font-semibold uppercase tracking-[0.18em] text-[var(--rds-status-warning)]"
        >
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

function getInitialWorkspaceGuideExpanded() {
  if (typeof localStorage === "undefined") {
    return false;
  }
  return localStorage.getItem(WORKSPACE_GUIDE_STORAGE_KEY) === "true";
}

function WorkspaceGuideCard({ guide }: { guide: WorkspaceGuide }) {
  const [expanded, setExpanded] = useState(getInitialWorkspaceGuideExpanded);
  const signalToneClass =
    guide.signal?.tone === "error"
      ? "border-[var(--rds-status-error)]/35 bg-[var(--rds-status-error)]/10 text-[var(--rds-status-error)]"
      : guide.signal?.tone === "warn"
        ? "border-[var(--rds-status-warning)]/35 bg-[var(--rds-status-warning)]/10 text-[var(--rds-status-warning)]"
        : guide.signal?.tone === "success"
          ? "border-[var(--rds-status-success)]/35 bg-[var(--rds-status-success)]/10 text-[var(--rds-status-success)]"
          : "border-[var(--rds-status-info)]/35 bg-[var(--rds-status-info)]/10 text-[var(--rds-status-info)]";
  const primaryActions = guide.actions.slice(0, expanded ? 2 : 1);
  const secondaryActions = expanded ? guide.actions.slice(2) : [];
  const panelTone: AdaptivePanelTone = guide.signal?.tone === "error"
    ? "build-blocker"
    : guide.signal?.tone === "warn"
      ? "warning"
      : "info";

  function toggleExpanded() {
    setExpanded((current) => {
      const next = !current;
      localStorage.setItem(WORKSPACE_GUIDE_STORAGE_KEY, String(next));
      return next;
    });
  }

  return (
    <div className="mx-4 mt-2 shrink-0">
    <AdaptivePanel
      panelId="workspace-guide-window"
      title="Guia do workspace"
      tone={panelTone}
      defaultSize={{ width: 560, height: 280 }}
      minSize={{ width: 320, height: 180 }}
      maxSize={{ width: 900, height: 560 }}
      className="h-auto"
    >
    <section
      data-testid="workspace-guide"
      data-expanded={expanded ? "true" : "false"}
      title={`${guide.title} — ${guide.summary}`}
      className={`rounded-xl border border-[var(--rds-border-subtle)] bg-[linear-gradient(135deg,var(--rds-surface-overlay),var(--rds-surface-input)_55%,var(--rds-surface-panel-strong))] px-3 shadow-[0_12px_24px_rgba(0,0,0,0.16)] ${
        expanded ? "py-2.5" : "py-1.5"
      }`}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--rds-status-info)]">
            {guide.eyebrow}
          </p>
          <h2
            title={guide.title}
            className={expanded ? "mt-1 text-sm font-semibold text-[var(--rds-text-primary)]" : "mt-0.5 truncate text-xs font-semibold text-[var(--rds-text-primary)]"}
          >
            {guide.title}
          </h2>
          {expanded ? (
            <p className="mt-1 text-[11px] leading-5 text-[var(--rds-text-secondary)]">{guide.summary}</p>
          ) : null}
          {expanded && guide.checkpoints?.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5" data-testid="workspace-guide-checkpoints">
              {guide.checkpoints.map((checkpoint) => (
                <span
                  key={checkpoint}
                  title={checkpoint}
                  className="inline-flex items-center rounded-full border border-[var(--rds-border-subtle)] bg-black/15 px-2 py-1 text-[10px] font-medium text-[var(--rds-text-secondary)]"
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
        <div className="flex shrink-0 flex-wrap gap-2 lg:max-w-[20rem] lg:justify-end">
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
          <button
            type="button"
            onClick={toggleExpanded}
            className="rounded border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel-strong)] px-2 py-1 text-xs font-semibold text-[var(--rds-text-secondary)] transition-colors hover:border-[var(--rds-status-info)] hover:text-[var(--rds-status-info)]"
          >
            {expanded ? "Compactar guia" : "Expandir guia"}
          </button>
        </div>
      </div>
      {expanded ? (
      <details className="mt-2 rounded-xl border border-[var(--rds-surface-hover)] bg-black/10 px-3 py-2">
        <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--rds-text-muted)]">
          Contexto e atalhos
        </summary>
        <p className="mt-2 text-[11px] leading-5 text-[var(--rds-text-muted)]">{guide.detail}</p>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-[var(--rds-text-muted)]">
          <span className="rounded-full border border-[var(--rds-surface-hover)] bg-black/10 px-2 py-1">
            Rail: troca workspace
          </span>
          <span className="rounded-full border border-[var(--rds-surface-hover)] bg-black/10 px-2 py-1">
            Presets: reorganizam o shell
          </span>
          <span className="rounded-full border border-[var(--rds-surface-hover)] bg-black/10 px-2 py-1">
            Tools: painel contextual
          </span>
        </div>
        {secondaryActions.length > 0 ? (
          <div className="mt-3 border-t border-[var(--rds-surface-hover)] pt-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--rds-text-muted)]">
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
      ) : null}
    </section>
    </AdaptivePanel>
    </div>
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
      return "border-[var(--rds-status-success)]/25 bg-[var(--rds-status-success)]/10 text-[var(--rds-status-success)]";
    }
    if (tone === "warn") {
      return "border-[var(--rds-status-warning)]/25 bg-[var(--rds-status-warning)]/10 text-[var(--rds-status-warning)]";
    }
    return "border-[var(--rds-status-info)]/25 bg-[var(--rds-status-info)]/10 text-[var(--rds-status-info)]";
  }

  return (
    <div
      data-testid="template-first-success"
      className="rounded border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel-strong)] p-3 text-[10px] text-[var(--rds-text-muted)]"
    >
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[var(--rds-tool-active)]">
            Primeiro sucesso
          </p>
          <p className="mt-1 text-[var(--rds-text-primary)]">
            Caminho recomendado para <span className="font-semibold">{templateName}</span>
          </p>
          <p className="mt-1 leading-5 text-[var(--rds-text-muted)]">
            Fluxo canonico desta escolha: <span className="font-semibold text-[var(--rds-text-primary)]">Scene</span>{" "}
            primeiro, depois <span className="font-semibold text-[var(--rds-text-primary)]">Game</span> para o
            playtest em {targetLabel}.
          </p>
        </div>
        <span className="rounded-full border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel)] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-[var(--rds-text-primary)]">
          {targetLabel}
        </span>
      </div>

      <ol className="mt-3 grid gap-2 md:grid-cols-2">
        {steps.map((step, index) => (
          <li
            key={`${step.label}-${index}`}
            className="rounded border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel)] px-3 py-2"
          >
            <div className="flex items-start gap-2">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--rds-surface-overlay)] text-[9px] font-semibold text-[var(--rds-action-primary)]">
                {index + 1}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[11px] font-semibold text-[var(--rds-text-primary)]">{step.label}</p>
                  <span className={`rounded-full border px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.14em] ${toneClass(step.tone)}`}>
                    {step.tone === "success"
                      ? "Pronto"
                      : step.tone === "warn"
                        ? "Bloqueio"
                        : "Proximo"}
                  </span>
                </div>
                <p className="mt-1 leading-5 text-[var(--rds-text-muted)]">{step.detail}</p>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function sgdkCapabilityToneClass(tone: CapabilityTone): string {
  switch (tone) {
    case "supported":
      return "border-[var(--rds-status-success)]/30 bg-[var(--rds-status-success)]/10 text-[var(--rds-status-success)]";
    case "bridge":
      return "border-[var(--rds-status-warning)]/30 bg-[var(--rds-status-warning)]/10 text-[var(--rds-status-warning)]";
    case "blocked":
      return "border-[var(--rds-status-error)]/30 bg-[var(--rds-status-error)]/10 text-[var(--rds-status-error)]";
    case "experimental":
      return "border-[var(--rds-action-primary)]/30 bg-[var(--rds-action-primary)]/10 text-[var(--rds-action-primary)]";
    case "partial":
    default:
      return "border-[var(--rds-status-info)]/30 bg-[var(--rds-status-info)]/10 text-[var(--rds-status-info)]";
  }
}

function SgdkCapabilityMatrix({ profile }: { profile: ExternalImportProfileSummary }) {
  const items = buildSgdkCapabilityMatrix(profile);
  return (
    <div
      data-testid="sgdk-capability-matrix"
      className="mt-3 rounded border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-overlay)] p-3 text-[10px] text-[var(--rds-text-muted)]"
    >
      <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[var(--rds-status-info)]">
        Matriz de capacidades SGDK
      </p>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        {items.map((item) => (
          <div key={item.id} className="rounded border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel-strong)] px-2 py-1.5">
            <div className="flex items-start justify-between gap-2">
              <span className="font-semibold text-[var(--rds-text-primary)]">{item.label}</span>
              <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[8px] font-semibold ${sgdkCapabilityToneClass(item.tone)}`}>
                {item.statusLabel}
              </span>
            </div>
            <p className="mt-1 leading-5 text-[var(--rds-text-muted)]">{item.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function SgdkImportSummaryCard({ summary }: { summary: SgdkImportSummary }) {
  const rows = [
    ["estados detectados", summary.states_detected ?? 0],
    ["transicoes detectadas", summary.transitions_detected ?? 0],
    ["nodes gerados", summary.nodes_generated ?? 0],
    ["bridges criadas", summary.bridges_created ?? 0],
  ] as const;
  return (
    <section
      data-testid="sgdk-import-summary"
      title={`Resumo SGDK Logic — ${formatSgdkImportSummaryKind(summary)}`}
      className="mx-3 mt-3 rounded border border-[var(--rds-status-info)]/30 bg-[var(--rds-surface-overlay)] p-3 text-[10px] text-[var(--rds-text-muted)]"
    >
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[var(--rds-status-info)]">
            Resumo SGDK Logic
          </p>
          <p className="mt-1 text-[var(--rds-text-primary)]">
            {formatSgdkImportSummaryKind(summary)}. Nodes funcionais, bridges e gaps ficam separados.
          </p>
        </div>
        <span className="rounded-full border border-[var(--rds-status-warning)]/35 bg-[var(--rds-status-warning)]/10 px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.14em] text-[var(--rds-status-warning)]">
          Equivalencia gameplay nao certificada
        </span>
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-4">
        {rows.map(([label, value]) => (
          <div key={label} className="rounded border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel-strong)] px-2 py-1.5">
            <p className="text-[var(--rds-text-muted)]">{label}</p>
            <p className="mt-1 font-mono text-sm text-[var(--rds-text-primary)]">{value}</p>
          </div>
        ))}
      </div>
      {summary.blocking_gaps?.length ? (
        <div className="mt-2 rounded border border-[var(--rds-status-error)]/30 bg-[var(--rds-status-error)]/10 px-2 py-1.5">
          <p className="font-semibold text-[var(--rds-status-error)]">gaps bloqueantes</p>
          <ul className="mt-1 list-inside list-disc text-[var(--rds-status-warning)]">
            {summary.blocking_gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {summary.mapped_source_files?.length ? (
        <p className="mt-2 font-mono text-[9px] text-[var(--rds-text-muted)]">
          arquivos fonte mapeados: {summary.mapped_source_files.join(", ")}
        </p>
      ) : null}
    </section>
  );
}

function WorkspacePanelPlaceholder({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-[var(--rds-surface-canvas)] px-4 text-center text-[11px] text-[var(--rds-text-muted)]">
      {label}
    </div>
  );
}

function BuildPhasePanel({
  active,
  blocked,
  warning,
  romMasteringStatus,
}: {
  active: boolean;
  blocked: boolean;
  warning: boolean;
  romMasteringStatus: string;
}) {
  if (!active) {
    return null;
  }

  const statusLabel = blocked ? "Acao necessaria" : warning ? "Seguro continuar" : "Pronto para build";
  const statusClass = blocked
    ? "border-[var(--rds-status-error)]/35 bg-[var(--rds-status-error)]/10 text-[var(--rds-status-error)]"
    : warning
      ? "border-[var(--rds-status-warning)]/35 bg-[var(--rds-status-warning)]/10 text-[var(--rds-status-warning)]"
      : "border-[var(--rds-status-success)]/30 bg-[var(--rds-status-success)]/10 text-[var(--rds-status-success)]";

  return (
    <div
      data-testid="build-phase-panel"
      className="hidden max-w-[21rem] items-center gap-2 rounded border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-overlay)] px-2 py-1 text-[9px] 2xl:flex"
      title="Fases do fluxo canonico Build -> ROM -> Emulacao."
    >
      <span className={`shrink-0 rounded-full border px-2 py-0.5 font-semibold ${statusClass}`}>
        {statusLabel}
      </span>
      <span className="truncate text-[var(--rds-text-muted)]">
        Validando -&gt; Compilando -&gt; Gerando ROM -&gt; Carregando emulador
      </span>
      <span className="shrink-0 rounded border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel-strong)] px-1.5 py-0.5 font-mono text-[var(--rds-text-muted)]">
        ROM {romMasteringStatus.replace(/_/g, " ")}
      </span>
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
    ? "bg-[var(--rds-status-error)]"
    : hasWarnings || percent >= 80
      ? "bg-[var(--rds-status-warning)]"
      : "bg-[var(--rds-status-success)]";

  return (
    <div
      data-testid="toolbar-vram-budget"
      className="pointer-events-none flex h-7 min-w-[6.5rem] shrink-0 items-center gap-1 rounded border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel-strong)] px-2"
      title={`VRAM ${Math.round(used / 1024)}KB / ${Math.round(limit / 1024)}KB (${percent}%)`}
    >
      <span className="text-[10px] text-[var(--rds-text-muted)]">VRAM</span>
        <span data-testid="toolbar-vram-budget-label" className="font-mono text-[var(--rds-text-primary)]">
          {Math.round(used / 1024)} / {Math.round(limit / 1024)} KB
        </span>
      <div className="h-1 w-9 overflow-hidden rounded bg-[var(--rds-border-subtle)]">
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
      ? "bg-[var(--rds-status-error)]"
      : percent >= 80
        ? "bg-[var(--rds-status-warning)]"
        : "bg-[var(--rds-status-info)]";

  return (
    <div
      data-testid="toolbar-scanline-budget"
      className="pointer-events-none hidden h-7 min-w-[5rem] shrink-0 items-center gap-1 rounded border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel-strong)] px-2 2xl:flex"
      title={`Sprites por scanline ${peak} / ${limit} (${percent}%)`}
    >
      <span className="text-[10px] text-[var(--rds-text-muted)]">SL</span>
        <span data-testid="toolbar-scanline-budget-label" className="font-mono text-[var(--rds-text-primary)]">
          {peak} / {limit}
        </span>
      <div className="h-1 w-7 overflow-hidden rounded bg-[var(--rds-border-subtle)]">
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
      ? "bg-[var(--rds-status-error)]"
      : percent >= 80
        ? "bg-[var(--rds-status-warning)]"
        : "bg-[var(--rds-status-warning)]";

  return (
    <div
      data-testid="toolbar-palette-budget"
      className="pointer-events-none hidden h-7 min-w-[4.5rem] shrink-0 items-center gap-1 rounded border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel-strong)] px-2 2xl:flex"
      title={`Bancos de paleta ${used} / ${limit} (${percent}%)`}
    >
      <span className="text-[10px] text-[var(--rds-text-muted)]">PAL</span>
        <span data-testid="toolbar-palette-budget-label" className="font-mono text-[var(--rds-text-primary)]">
          {used} / {limit}
        </span>
      <div className="h-1 w-7 overflow-hidden rounded bg-[var(--rds-border-subtle)]">
        <div
          data-testid="toolbar-palette-budget-bar"
          className={`h-full ${toneClass}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function ToolbarWarningBadge({
  issues,
}: {
  issues: string[];
}) {
  const [open, setOpen] = useState(false);

  if (issues.length === 0) {
    return null;
  }

  return (
    <div className="relative">
      <button
        type="button"
        data-testid="toolbar-warning-badge"
        onClick={() => setOpen((current) => !current)}
        className="relative flex h-7 min-w-7 items-center justify-center rounded border border-[var(--rds-status-warning)]/45 bg-[var(--rds-status-warning)]/14 px-2 text-[10px] font-bold text-[var(--rds-status-warning)] shadow-[0_0_0_1px_rgba(250,179,135,0.08)]"
        title={`${issues.length} warning(s) / erro(s). Clique para detalhes.`}
      >
        <Icon name="warning-triangle" size={14} />
        <span className="ml-1 font-mono">{issues.length}</span>
      </button>
      {open ? (
        <div
          data-testid="toolbar-warning-popover"
          className="absolute right-0 top-[calc(100%+8px)] z-30 w-80 rounded border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-overlay)] p-3 text-[11px] text-[var(--rds-text-secondary)] shadow-[0_24px_60px_rgba(0,0,0,0.45)]"
        >
          <p className="text-[10px] font-semibold uppercase text-[var(--rds-status-warning)]">
            Diagnostico
          </p>
          <ul className="mt-2 max-h-52 space-y-2 overflow-y-auto">
            {issues.map((issue, index) => (
              <li key={`${issue}-${index}`} className="rounded border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-input)] px-2 py-1.5">
                {issue}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ProductionStatusBar({
  buildStatus,
  importStatus,
  emulationStatus,
  hardwareSummary,
  lastMessage,
  onOpenDetails,
}: {
  buildStatus: string;
  importStatus: string;
  emulationStatus: string;
  hardwareSummary: string;
  lastMessage: string;
  onOpenDetails: () => void;
}) {
  return (
    <div
      data-testid="production-status-bar"
      className="flex h-7 shrink-0 items-center gap-3 border-t border-[var(--rds-border-subtle)] bg-[var(--rds-surface-overlay)] px-3 text-[10px] text-[var(--rds-text-muted)]"
    >
      <span className="min-w-0 flex-1 truncate" title={lastMessage}>
        {lastMessage || "Sem alertas recentes"}
      </span>
      <span className="hidden items-center gap-1 font-mono text-[var(--rds-text-primary)] sm:inline-flex"><Icon name="check-circle" size={13} />Build: {buildStatus}</span>
      <span className="hidden font-mono text-[var(--rds-text-primary)] md:inline">Importacao: {importStatus}</span>
      <span className="hidden font-mono text-[var(--rds-text-primary)] md:inline">Emulacao: {emulationStatus}</span>
      <span className="hidden font-mono text-[var(--rds-text-primary)] lg:inline">{hardwareSummary}</span>
      <button
        type="button"
        onClick={onOpenDetails}
        className="rounded border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-input)] px-2 py-0.5 text-[10px] font-semibold text-[var(--rds-text-primary)] transition-colors hover:border-[var(--rds-status-info)] hover:text-[var(--rds-status-info)]"
      >
        Ver detalhes
      </button>
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

function getShortcutConflictForCommand(
  conflicts: readonly ShortcutConflict[],
  commandId: string
) {
  return conflicts.find((conflict) => conflict.commandIds.includes(commandId));
}

function getActiveShortcutScope(workspace: EditorWorkspace): string {
  if (workspace === "game") return "emulator";
  if (workspace === "logic") return "nodegraph";
  if (workspace === "scene" || workspace === "artstudio" || workspace === "retrofx") return "scene";
  return "global";
}

export function CommandPaletteDialog({
  results,
  query,
  shortcuts,
  onQueryChange,
  onExecute,
  onClose,
  isCommandDisabled,
}: {
  results: CommandSearchResult[];
  query: string;
  shortcuts: readonly ShortcutCommand[];
  onQueryChange: (query: string) => void;
  onExecute: (commandId: string) => void;
  onClose: () => void;
  isCommandDisabled: (commandId: string) => boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const activeResults = results.filter((result) => !isCommandDisabled(result.command.id));
  const activeResultCount = activeResults.length;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    setSelectedIndex((current) => {
      if (activeResultCount === 0) {
        return 0;
      }
      return Math.min(current, activeResultCount - 1);
    });
  }, [activeResultCount]);

  function executeSelected() {
    if (activeResultCount === 0) {
      return;
    }
    const selected = activeResults[Math.min(selectedIndex, activeResultCount - 1)];
    if (selected) {
      onExecute(selected.command.id);
    }
  }

  return (
    <Dialog
      open
      title="Paleta de Comandos"
      description="Busque comandos reais; itens indisponiveis explicam o contexto necessario."
      onClose={onClose}
      initialFocusRef={inputRef}
      portal={false}
      overlayClassName="items-start pt-[12vh]"
      className="max-h-[72vh] w-[min(720px,calc(100vw-24px))]"
    >
      <div data-testid="command-palette" className="flex min-h-0 flex-col">
        <div className="border-b border-[var(--rds-border-subtle)] pb-3">
          <Input
            ref={inputRef}
            data-testid="command-palette-search"
            label="Buscar comando"
            hideLabel
            leadingIcon={<Icon name="search" size={16} />}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            role="combobox"
            aria-controls="command-palette-results"
            aria-expanded="true"
            aria-activedescendant={activeResultCount > 0 ? `command-palette-option-${activeResults[Math.min(selectedIndex, activeResultCount - 1)]?.command.id}` : undefined}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              } else if (event.key === "Enter") {
                event.preventDefault();
                executeSelected();
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelectedIndex((current) => Math.min(current + 1, Math.max(activeResultCount - 1, 0)));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelectedIndex((current) => Math.max(current - 1, 0));
              }
            }}
            placeholder="Buscar comando..."
            controlSize="lg"
          />
        </div>
        <div id="command-palette-results" role="listbox" aria-label="Resultados de comandos" className="min-h-0 flex-1 overflow-y-auto pt-2">
          {results.length === 0 ? (
            <div className="rounded border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-overlay)] px-3 py-4 text-xs text-[var(--rds-text-muted)]">
              Nenhum comando real encontrado.
            </div>
          ) : (
            <div className="grid gap-1">
              {activeResultCount === 0 ? (
                <div
                  data-testid="command-palette-no-active-results"
                  className="rounded border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-overlay)] px-3 py-2 text-xs text-[var(--rds-text-muted)]"
                >
                  Nenhum comando disponivel neste contexto.
                </div>
              ) : null}
              {(() => {
                let activeResultIndex = -1;
                return results.map((result) => {
                  const command = result.command;
                  const disabled = isCommandDisabled(command.id);
                  const shortcut = getShortcutLabel(command.id, shortcuts);
                  const resultActiveIndex = disabled ? -1 : ++activeResultIndex;
                  const selected = resultActiveIndex === selectedIndex;
                  return (
                    <button
                      key={command.id}
                      id={`command-palette-option-${command.id}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      data-testid={`command-palette-item-${command.id}`}
                      data-selected={selected ? "true" : "false"}
                      disabled={disabled}
                      onMouseEnter={() => {
                        if (resultActiveIndex >= 0) {
                          setSelectedIndex(resultActiveIndex);
                        }
                      }}
                      onFocus={() => {
                        if (resultActiveIndex >= 0) {
                          setSelectedIndex(resultActiveIndex);
                        }
                      }}
                      onClick={() => {
                        if (resultActiveIndex >= 0) {
                          onExecute(command.id);
                        }
                      }}
                      className={`grid grid-cols-[1fr_auto] items-center gap-3 rounded border px-3 py-2 text-left transition-colors ${
                        selected
                          ? "border-[var(--rds-status-info)]/50 bg-[var(--rds-surface-active)]"
                          : "border-transparent bg-[var(--rds-surface-overlay)] hover:border-[var(--rds-border-default)]"
                      } disabled:cursor-not-allowed disabled:opacity-45`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-semibold text-[var(--rds-text-primary)]">
                          {command.label}
                        </span>
                        <span className="block truncate text-[10px] text-[var(--rds-text-muted)]">
                          {command.group}
                          {command.description ? ` · ${command.description}` : ""}
                        </span>
                      </span>
                      {shortcut ? (
                        <kbd className="rounded border border-[var(--rds-border-default)] bg-[var(--rds-surface-canvas)] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[var(--rds-status-warning)]">
                          {shortcut}
                        </kbd>
                      ) : null}
                    </button>
                  );
                });
              })()}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function ShortcutEditorDialog({
  shortcuts,
  conflicts,
  onShortcutChange,
  onResetShortcut,
  onResetAll,
  onClose,
}: {
  shortcuts: readonly ShortcutCommand[];
  conflicts: readonly ShortcutConflict[];
  onShortcutChange: (commandId: string, value: string) => void;
  onResetShortcut: (commandId: string) => void;
  onResetAll: () => void;
  onClose: () => void;
}) {
  const groups = groupShortcutsByGroup(shortcuts.filter((shortcut) => shortcut.editable !== false));

  return (
    <Dialog
      open
      title="Atalhos"
      description="Personalize os comandos locais; conflitos permanecem visiveis antes de fechar."
      onClose={onClose}
      portal={false}
      className="max-h-[86vh] w-[min(860px,calc(100vw-24px))]"
    >
      <div data-testid="shortcut-editor" className="flex min-h-0 flex-col">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--rds-border-subtle)] pb-3">
          <div className="min-w-0">
            <div
              data-testid="shortcut-editor-conflicts"
              className={`mt-1 text-[10px] ${
                conflicts.length > 0 ? "text-[var(--rds-status-error)]" : "text-[var(--rds-status-success)]"
              }`}
            >
              {conflicts.length > 0
                ? `${conflicts.length} conflito(s): ${conflicts
                    .map((conflict) => `${conflict.displayKey} (${conflict.labels.join(" / ")})`)
                    .join("; ")}`
                : "Sem conflitos ativos"}
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <ToolbarButton label="Resetar padrao" onClick={onResetAll} />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pt-3">
          <div className="grid gap-3 md:grid-cols-2">
            {groups.map((group) => (
              <section key={group.group} className="rounded border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel-strong)]/70">
                <h3 className="border-b border-[var(--rds-surface-hover)] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--rds-focus-ring)]">
                  {group.group}
                </h3>
                <div className="divide-y divide-[var(--rds-surface-hover)]">
                  {group.shortcuts.map((shortcut) => {
                    const conflict = getShortcutConflictForCommand(conflicts, shortcut.id);
                    return (
                      <div key={shortcut.id} className="grid gap-2 px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-xs font-semibold text-[var(--rds-text-primary)]" title={shortcut.label}>
                              {shortcut.label}
                            </div>
                            <div className="text-[10px] text-[var(--rds-text-muted)]">Escopo: {shortcut.scope ?? "global"}</div>
                          </div>
                          <button
                            type="button"
                            data-testid={`shortcut-editor-reset-${shortcut.id}`}
                            onClick={() => onResetShortcut(shortcut.id)}
                            className="rounded border border-[var(--rds-border-default)] bg-[var(--rds-surface-canvas)] px-2 py-1 text-[10px] text-[var(--rds-text-muted)] hover:text-[var(--rds-text-primary)]"
                          >
                            Reset
                          </button>
                        </div>
                        <Input
                          data-testid={`shortcut-editor-input-${shortcut.id}`}
                          label={`Atalho para ${shortcut.label}`}
                          hideLabel
                          value={formatShortcutKeys(shortcut.keys)}
                          onChange={(event) => onShortcutChange(shortcut.id, event.target.value)}
                          className="font-mono text-[11px]"
                          errorMessage={conflict ? `Conflito: ${conflict.displayKey} com ${conflict.labels.join(" / ")}` : undefined}
                        />
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>
        <div className="mt-3 flex justify-end border-t border-[var(--rds-border-subtle)] pt-3">
          <ToolbarButton label="Fechar" onClick={onClose} />
        </div>
      </div>
    </Dialog>
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
    diagnostic: ActionableDiagnostic | null;
  }>;
  projectSourceKind: string;
};

type AutomationApi = {
  openProject: (projectDir: string) => Promise<boolean>;
  /** Importa doador SGDK para `baseDir` e abre o projeto nativo gerado; devolve o caminho absoluto. */
  importSgdkProject: (
    projectName: string,
    baseDir: string,
    sgdkDonorPath: string
  ) => Promise<string>;
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
  setConsoleVisible: (visible: boolean) => boolean;
  setEntityLogicGraph: (entityId: string, graphJson: string) => boolean;
  setEntityTransform: (entityId: string, x: number, y: number) => boolean;
  /** Instancia asset de imagem na cena ativa (mesma regra canónica do Asset Browser). E2E / QA. */
  instantiateBrowserImageAsset: (relativePath: string) => Promise<{
    entityId: string;
    kind: "sprite" | "tilemap";
    reason: string;
  }>;
  getEntityLogicState: (entityId: string) => {
    entityId: string;
    source: {
      graph_ref: string | null;
      graph_origin: string | null;
      has_graph: boolean;
      source_paths: string[];
      external_source_refs: string[];
    } | null;
    resolved: {
      graph_ref: string | null;
      graph_origin: string | null;
      has_graph: boolean;
      source_paths: string[];
      external_source_refs: string[];
    } | null;
  } | null;
  openEntitySourcePath: (
    entityId: string,
    relativePath?: string | null
  ) => Promise<{ ok: boolean; absolute_path: string | null; relative_path: string | null }>;
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
    activeScene,
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
    projectSourceKind,
    projectLegacyIndex,
    setProjectSourceKind,
    setProjectLegacyIndex,
    consoleEntries,
    consoleVisible,
    toggleConsole,
    logDiagnostic,
    setArtStudioAssetPath,
  } = useEditorStore();

  const [building, setBuilding] = useState(false);
  const [romMasteringStatus, setRomMasteringStatus] = useState<string>("not_inspected");
  const [rightPanelMode, setRightPanelMode] = useState<"inspector" | "tools">("inspector");
  const [toolPanelActive, setToolPanelActive] = useState<ToolTab>("setup");
  const [toolPanelWorkspace, setToolPanelWorkspace] = useState<ToolWorkspace>("editing");
  const [toolPanelShowAdvanced, setToolPanelShowAdvanced] = useState(false);
  const [leftPanelTab, setLeftPanelTab] = useState<"scene" | "layers">("scene");
  const [focusedShell, setFocusedShell] = useState(false);
  const [layoutPreset, setLayoutPreset] = useState<LayoutPresetId>("authoring");
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
  const [lastSgdkImportSummary, setLastSgdkImportSummary] = useState<SgdkImportSummary | null>(null);
  const [showProjectWizard, setShowProjectWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [creatingProject, setCreatingProject] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showProjectSettings, setShowProjectSettings] = useState(false);
  const [projectSettings, setProjectSettings] = useState<ProjectSettingsSnapshot | null>(null);
  const [projectSettingsDraft, setProjectSettingsDraft] =
    useState<ProjectSettingsPayload | null>(null);
  const [projectSettingsLoading, setProjectSettingsLoading] = useState(false);
  const [projectSettingsSaving, setProjectSettingsSaving] = useState(false);
  const [projectSettingsMessage, setProjectSettingsMessage] = useState("");
  const [projectSettingsError, setProjectSettingsError] = useState("");
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState("");
  const [showShortcutEditor, setShowShortcutEditor] = useState(false);
  const [shortcuts, setShortcuts] = useState(() =>
    loadShortcutCustomizations(DEFAULT_SHORTCUTS, localStorage)
  );
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
  const recommendedProjectTemplates = projectTemplates.filter(
    (template) => template.source_kind === "builtin" && !template.experimental
  );
  const importAdvancedProjectTemplates = projectTemplates.filter(
    (template) => template.source_kind !== "builtin" || template.experimental
  );
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
  const projectSettingsNameError =
    projectSettingsDraft && !projectSettingsDraft.internal_rom_name.trim()
      ? "Nome interno da ROM e obrigatorio"
      : "";
  const projectSettingsActiveWarnings = projectSettingsDraft
    ? projectSettingsWarnings(projectSettingsDraft)
    : projectSettings?.warnings ?? [];
  const workspaceMeta =
    WORKSPACE_ITEMS.find((workspace) => workspace.id === activeWorkspace) ?? WORKSPACE_ITEMS[0];
  const shellConfig = resolveWorkspaceShellConfig(activeWorkspace, shellWidth);
  const shortcutConflicts = findShortcutConflicts(shortcuts);
  const paletteCommands = getPaletteCommands(shortcuts).filter((command) =>
    EXECUTABLE_COMMAND_IDS.has(command.id)
  );
  const commandPaletteResults = searchCommands(commandPaletteQuery, paletteCommands);

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

  function openRuntimeSetupForIssue() {
    setActiveWorkspace("debug");
    setActiveViewportTab("scene");
    openToolsWorkspace("setup", "debug", true);
  }

  function openToolsCommand(activeTool: ToolTab, workspace: ToolWorkspace, showAdvanced = false) {
    const currentShell = resolveWorkspaceShellConfig(activeWorkspace, shellWidth);
    if (!currentShell.showRight) {
      handleWorkspaceSelect(workspace === "debug" || activeTool === "setup" ? "debug" : "scene");
    }
    openToolsWorkspace(activeTool, workspace, showAdvanced);
  }

  function openCommandPalette() {
    setCommandPaletteQuery("");
    setShowCommandPalette(true);
  }

  function updateShortcut(commandId: string, value: string) {
    setShortcuts((current) => {
      const next = updateShortcutBinding(current, commandId, value);
      saveShortcutCustomizations(next, DEFAULT_SHORTCUTS, localStorage);
      return next;
    });
  }

  function resetShortcut(commandId: string) {
    const defaultShortcut = DEFAULT_SHORTCUTS.find((shortcut) => shortcut.id === commandId);
    if (!defaultShortcut) {
      return;
    }
    setShortcuts((current) => {
      const next = updateShortcutBinding(current, commandId, defaultShortcut.keys);
      saveShortcutCustomizations(next, DEFAULT_SHORTCUTS, localStorage);
      return next;
    });
  }

  function resetAllShortcuts() {
    setShortcuts(resetShortcutCustomizations(DEFAULT_SHORTCUTS, localStorage));
  }

  function isCommandDisabled(commandId: string) {
    if (commandId === "build.run") return building || !activeProjectDir || liveBuildBlocked;
    if (
      commandId === "scene.save" ||
      commandId === "build.validate" ||
      commandId === "code.generate" ||
      commandId === "tools.assetBrowser"
    ) {
      return !activeProjectDir;
    }
    if (commandId === "emulator.stop") return !emulatorLoaded;
    return false;
  }

  function executeAppCommand(commandId: string) {
    if (isCommandDisabled(commandId)) {
      return;
    }

    switch (commandId) {
      case "project.open":
        void handleOpenProject();
        break;
      case "scene.save":
        void handleSaveScene();
        break;
      case "build.run":
        void handleBuildAndRun();
        break;
      case "build.validate":
        void handleValidate();
        break;
      case "code.generate":
        void handleGenerateC();
        break;
      case "edit.undo":
        undo();
        break;
      case "edit.redo":
        redo();
        break;
      case "layout.focus":
        toggleFocusMode();
        break;
      case "layout.save":
        saveCurrentLayout();
        break;
      case "layout.restore":
        restoreSavedLayout();
        break;
      case "commandPalette.open":
        openCommandPalette();
        break;
      case "shortcuts.edit":
        setShowShortcutEditor(true);
        break;
      case "workspace.scene":
        handleWorkspaceSelect("scene");
        break;
      case "workspace.logic":
        handleWorkspaceSelect("logic");
        break;
      case "workspace.artstudio":
        handleWorkspaceSelect("artstudio");
        break;
      case "tools.runtimeSetup":
        openToolsCommand("setup", "debug", true);
        break;
      case "tools.assetBrowser":
        openToolsCommand("assets", "editing", true);
        break;
      case "console.open":
        if (!consoleVisible) {
          toggleConsole();
        }
        break;
      case "emulator.play":
        void handlePlay();
        break;
      case "emulator.stop":
        void handleEmulatorStop();
        break;
      default:
        logMessage("warn", `[Command Palette] Comando sem executor: ${commandId}`);
    }
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

  function applyAutomaticLayout() {
    const config = resolveWorkspaceShellConfig(activeWorkspace, shellWidth);
    setFocusedShell(false);
    lastNonFocusLayoutRef.current = config.panels;
    applyShellLayout(config.panels);
    logMessage("info", "[Layout] Ajuste automatico aplicado para o workspace e a largura atuais.");
  }

  function applyBalancedLayout() {
    const config = resolveWorkspaceShellConfig(activeWorkspace, shellWidth);
    const nextLayout: LayoutMap = !config.showLeft && !config.showRight
      ? { left: 0, center: 100, right: 0 }
      : !config.showLeft
        ? { left: 0, center: 68, right: 32 }
        : !config.showRight
          ? { left: 24, center: 76, right: 0 }
          : { left: 18, center: 60, right: 22 };
    setFocusedShell(false);
    lastNonFocusLayoutRef.current = nextLayout;
    applyShellLayout(nextLayout);
    logMessage("info", "[Layout] Preset Balanceado aplicado.");
  }

  function handleShellSplitterIntent(side: "left" | "right", intent: LayoutResizeIntent) {
    if (intent.type === "auto") {
      applyAutomaticLayout();
      return;
    }
    const current = panelGroupRef.current?.getLayout();
    if (!current) return;
    const layout: LayoutMap = {
      left: current.left ?? 0,
      center: current.center ?? 100,
      right: current.right ?? 0,
    };
    const stepPercent = intent.type === "step"
      ? (intent.delta / Math.max(shellWidth - 56, 1)) * 100
      : 0;
    const minCenter = 20;

    if (side === "left") {
      const available = layout.left + layout.center - minCenter;
      const desired = intent.type === "minimum"
        ? 0
        : intent.type === "maximum"
          ? Math.min(42, available)
          : layout.left + stepPercent;
      const nextLeft = Math.max(0, Math.min(available, desired));
      applyShellLayout({ ...layout, left: nextLeft, center: layout.left + layout.center - nextLeft });
      return;
    }

    const available = layout.right + layout.center - minCenter;
    const desired = intent.type === "minimum"
      ? 0
      : intent.type === "maximum"
        ? Math.min(48, available)
        : layout.right - stepPercent;
    const nextRight = Math.max(0, Math.min(available, desired));
    applyShellLayout({ ...layout, center: layout.right + layout.center - nextRight, right: nextRight });
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

    const config = resolveWorkspaceShellConfig(activeWorkspace, shellWidth);
    setLayoutPreset(config.preset);
    applyShellLayout(config.panels);
  }, [activeWorkspace, shellWidth, focusedShell]);

  useEffect(() => {
    if (focusedShell) {
      return;
    }

    const config = resolveWorkspaceShellConfig(activeWorkspace, shellWidth);
    if (config.defaultRightMode === "tools") {
      setRightPanelMode("tools");
    } else if (config.defaultRightMode === "inspector") {
      setRightPanelMode("inspector");
    }
  }, [activeWorkspace, focusedShell, shellWidth]);

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
    if (showProjectWizard && wizardStep === 2 && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [showProjectWizard, wizardStep]);

  useEffect(() => {
    if (!showProjectWizard) {
      setShowExternalImportSection(false);
      setWizardStep(1);
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
      if (isEditableTarget(event.target)) {
        return;
      }

      const resolved = resolveShortcutCommand(
        event,
        shortcuts,
        EXECUTABLE_COMMAND_IDS,
        getActiveShortcutScope(activeWorkspace)
      );
      if (resolved.conflict) {
        event.preventDefault();
        logMessage(
          "warn",
          `[Atalhos] Conflito em ${resolved.conflict.displayKey}: ${resolved.conflict.labels.join(" / ")}.`
        );
        return;
      }

      if (resolved.commandId) {
        event.preventDefault();
        executeAppCommand(resolved.commandId);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeWorkspace, executeAppCommand, logMessage, shortcuts]);

  function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  function reportDiagnostic(diagnostic: ActionableDiagnostic) {
    logDiagnostic(diagnostic);
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
  const toolbarIssues = [
    ...(liveBuildBlocked && buildDisabledReason ? [buildDisabledReason] : []),
    ...(!liveBuildBlocked && buildWarningSummary ? [buildWarningSummary] : []),
    ...(!liveBuildBlocked && liveBuildErrorSummary ? [`Live: ${liveBuildErrorSummary}`] : []),
    ...(hwStatus?.warnings ?? []),
  ].filter((issue, index, all) => issue && all.indexOf(issue) === index);
  const buildStatus = building
    ? "building"
    : liveBuildBlocked
      ? "blocked"
      : buildWarningSummary
        ? "warn"
        : buildLiveIndicator?.label === "DESATUAL."
          ? "stale"
          : activeProjectDir
            ? "ready"
            : "idle";
  const importStatus = projectSourceKind || "builtin";
  const emulationStatus = emulatorLoaded ? (emulPaused ? "paused" : "loaded") : "idle";
  const hardwareSummary = hwStatus
    ? `VRAM ${Math.round(hwStatus.vram_used / 1024)}/${Math.round(hwStatus.vram_limit / 1024)}KB sprites ${hwStatus.sprite_count}/${hwStatus.sprite_limit}`
    : "hardware n/a";
  const lastConsoleMessage =
    [...consoleEntries].reverse().find((entry) => entry.level === "error" || entry.level === "warn")
      ?.message ?? consoleEntries[consoleEntries.length - 1]?.message ?? "";
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
          label: "Novo Projeto",
          onClick: () => setShowProjectWizard(true),
          accent: "primary",
          shortcut: getShortcutLabel("project.new", shortcuts),
          title: getShortcutTitle("project.new", "Criar novo projeto", shortcuts),
          testId: "menu-action-project-new",
        },
        {
          label: "Abrir Projeto",
          onClick: () => void handleOpenProject(),
          shortcut: getShortcutLabel("project.open", shortcuts),
          title: getShortcutTitle("project.open", "Abrir workspace existente", shortcuts),
          testId: "menu-action-project-open",
        },
        {
          label: creatingProject ? "Importando..." : "Importar Projeto Externo",
          onClick: () => void handleImportExternalProject(),
          disabled: creatingProject || templatesLoading,
          title: "Importar SGDK, GameMaker, Godot, MUGEN, OpenBOR ou outro projeto externo suportado",
          testId: "menu-action-project-import-external",
        },
        {
          label: "Importar Asset",
          onClick: handleImportAsset,
          disabled: !activeProjectDir,
          title: activeProjectDir
            ? "Abrir o ArtStudio para importar imagem, command.dat e preparar assets canonicos"
            : "Abra ou crie um projeto antes de importar assets",
          testId: "menu-action-asset-import",
        },
        {
          label: "Salvar",
          onClick: () => void handleSaveScene(),
          disabled: !activeProjectDir,
          shortcut: getShortcutLabel("scene.save", shortcuts),
          title: getShortcutTitle("scene.save", "Salvar cena ativa", shortcuts),
        },
        {
          label: "Configuracoes",
          onClick: () => void handleOpenProjectSettings(),
          disabled: !activeProjectDir,
          title: "Abrir configuracoes do projeto",
          testId: "menu-action-project-settings",
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
          shortcut: getShortcutLabel("build.validate", shortcuts),
          title: getShortcutTitle("build.validate", "Validar projeto ativo", shortcuts),
        },
        {
          label: "Gerar C",
          onClick: () => void handleGenerateC(),
          disabled: !activeProjectDir,
          shortcut: getShortcutLabel("code.generate", shortcuts),
          title: getShortcutTitle("code.generate", "Gerar codigo C para a cena ativa", shortcuts),
        },
        {
          label: "Copiar",
          onClick: handleCopyEntity,
          disabled: !selectedEntityId || selectedEntityId.startsWith("layer::"),
          shortcut: getShortcutLabel("entity.copy", shortcuts),
          title: getShortcutTitle("entity.copy", "Copiar entidade selecionada", shortcuts),
        },
        {
          label: "Colar",
          onClick: () => void handlePasteEntity(),
          disabled: !copiedEntity || !activeProjectDir,
          shortcut: getShortcutLabel("entity.paste", shortcuts),
          title: getShortcutTitle("entity.paste", "Colar entidade copiada", shortcuts),
        },
      ],
    },
    {
      title: "Layout",
      actions: [
        {
          label: "Salvar layout",
          onClick: saveCurrentLayout,
          shortcut: getShortcutLabel("layout.save", shortcuts),
          title: getShortcutTitle("layout.save", "Salvar layout local do workspace", shortcuts),
        },
        {
          label: "Layout automatico",
          onClick: applyAutomaticLayout,
          title: "Ajustar paineis ao workspace e a largura atuais",
        },
        {
          label: "Layout balanceado",
          onClick: applyBalancedLayout,
          title: "Restaurar proporcoes equilibradas para autoria",
        },
        {
          label: "Restaurar layout",
          onClick: restoreSavedLayout,
          shortcut: getShortcutLabel("layout.restore", shortcuts),
          title: getShortcutTitle("layout.restore", "Restaurar layout salvo neste host", shortcuts),
        },
        {
          label: "Paleta de Comandos",
          onClick: openCommandPalette,
          shortcut: getShortcutLabel("commandPalette.open", shortcuts),
          title: getShortcutTitle("commandPalette.open", "Buscar e executar comandos reais", shortcuts),
        },
        {
          label: "Atalhos",
          onClick: () => setShowShortcutEditor(true),
          shortcut: getShortcutLabel("shortcuts.edit", shortcuts),
          title: getShortcutTitle("shortcuts.edit", "Editar atalhos locais", shortcuts),
          testId: "menu-action-shortcuts",
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

  async function hydrateProjectState(
    projectDir: string,
    projectName: string,
    scope: string,
    preferredScenePath?: string | null
  ) {
    await resetEmulatorSession(true);
    const hw = await getHwStatus(projectDir);
    const normalizedPreferredScene = preferredScenePath?.trim() || null;
    let sceneData = normalizedPreferredScene
      ? await getSceneData(projectDir, normalizedPreferredScene)
      : await getSceneData(projectDir);
    if (!sceneData.ok && normalizedPreferredScene) {
      logMessage(
        "warn",
        `[${scope}] Cena preferida '${normalizedPreferredScene}' indisponivel; fallback para entry_scene canonica.`
      );
      sceneData = await getSceneData(projectDir);
    }
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
    setActiveWorkspace("scene");
    setActiveViewportTab("scene");
    setRightPanelMode("inspector");

    const focusedEntity = getPreferredSceneEntity(hydrated.resolvedScene);
    setSelectedEntityId(focusedEntity?.entity_id ?? null);

    const openReason =
      normalizedPreferredScene && sceneData.scene_path === normalizedPreferredScene
        ? `cena preferida '${normalizedPreferredScene}'`
        : "entry_scene canonica";
    logMessage(
      "info",
      `[${scope}] Cena aberta: '${sceneData.scene_path}' (${openReason}). Workspace reposicionada para Cena.`
    );
    if (focusedEntity) {
      logMessage(
        "info",
        `[${scope}] Foco inicial em '${getEntityDisplayName(focusedEntity)}' para evitar onboarding/UI vazia apos a abertura.`
      );
    } else {
      logMessage(
        "info",
        `[${scope}] Cena aberta sem entidade visual inicial; selecao permaneceu vazia por nao haver alvo relevante.`
      );
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
          reportDiagnostic(
            result.diagnostics?.[0] ??
              createFallbackDiagnostic({
                area: "runtime_setup",
                technicalDetail: result.message,
                sourcePath: item.install_dir || null,
                evidencePath: item.install_dir || null,
              })
          );
          return false;
        }
      }

      return true;
    } catch (error) {
      reportDiagnostic(
        createFallbackDiagnostic({
          area: "runtime_setup",
          technicalDetail: describeError(error),
        })
      );
      return false;
    }
  }

  async function handleOpenProject() {
    try {
      const result = await openProjectDialog();
      if (!result.selected) return;
      const hydrated = await hydrateProjectState(
        result.path,
        result.name,
        "Projeto",
        result.preferred_scene_path
      );
      setLastSgdkImportSummary(result.import_summary ?? null);
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
    const hydrated = await hydrateProjectState(
      result.path,
      result.name,
      scope,
      result.preferred_scene_path
    );
    setLastSgdkImportSummary(result.import_summary ?? null);
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
    let donorPathForDiagnostic: string | undefined;
    try {
      const donorPath =
        selectedTemplate.source_kind === "external_sgdk"
          ? templateDonorPaths[selectedTemplate.id]?.trim() ||
            selectedTemplate.default_donor_path ||
            undefined
          : undefined;
      donorPathForDiagnostic = donorPath;
      const result = await createProjectFromTemplate(
        newProjName.trim(),
        newProjTarget,
        newProjBaseDir.trim(),
        selectedTemplate.id,
        donorPath
      );
      setLastSgdkImportSummary(
        selectedTemplate.source_kind === "external_sgdk"
          ? result.import_summary ?? null
          : null
      );
      const hydrated = await hydrateProjectState(
        result.path,
        result.name,
        "Projeto",
        result.preferred_scene_path
      );
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
      if (selectedTemplate.source_kind === "external_sgdk") {
        reportDiagnostic(
          createFallbackDiagnostic({
            area: "import_sgdk",
            sourcePath: donorPathForDiagnostic ?? null,
            technicalDetail: describeError(error),
          })
        );
      } else {
        logMessage("error", `[Projeto] Falha ao criar projeto: ${describeError(error)}`);
      }
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

    let projectPath: string | null = null;
    try {
      projectPath = await chooseExternalProjectPath(selectedExternalImportProfile);
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
      setLastSgdkImportSummary(
        selectedExternalImportProfile.id === "sgdk" ? result.import_summary ?? null : null
      );
      const hydrated = await hydrateProjectState(
        result.path,
        result.name,
        "Projeto",
        result.preferred_scene_path
      );
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
      reportDiagnostic(
        createFallbackDiagnostic({
          area: importAreaForProfile(selectedExternalImportProfile.id),
          sourcePath: projectPath,
          technicalDetail: describeError(error),
        })
      );
    } finally {
      setCreatingProject(false);
    }
  }

  function handleImportAsset() {
    if (!activeProjectDir) {
      logMessage("warn", "[Assets] Abra ou crie um projeto antes de importar assets.");
      return;
    }

    setArtStudioAssetPath(null);
    handleWorkspaceSelect("artstudio");
    logMessage(
      "info",
      "[Assets] Importar Asset aberto no ArtStudio: use Importar imagem para sprites/sheets, Importar command.dat para comandos, e mantenha audio canonico em assets/audio para aparecer no Asset Browser."
    );
  }

  async function handleOpenProjectSettings() {
    if (!activeProjectDir) {
      logMessage("warn", "[Projeto] Abra um projeto antes de editar configuracoes.");
      return;
    }

    setShowProjectSettings(true);
    setProjectSettingsLoading(true);
    setProjectSettingsMessage("");
    setProjectSettingsError("");
    setProjectSettings(null);
    setProjectSettingsDraft(null);
    try {
      const settings = await getProjectSettings(activeProjectDir);
      setProjectSettings(settings);
      setProjectSettingsDraft(projectSettingsToPayload(settings));
    } catch (error) {
      const message = describeError(error);
      setProjectSettingsError(message);
      logMessage("error", `[Projeto] Falha ao carregar configuracoes: ${message}`);
    } finally {
      setProjectSettingsLoading(false);
    }
  }

  async function handleSaveProjectSettings() {
    if (!activeProjectDir || !projectSettingsDraft) {
      return;
    }

    if (!projectSettingsDraft.internal_rom_name.trim()) {
      setProjectSettingsError("Nome interno da ROM e obrigatorio");
      return;
    }

    const payload: ProjectSettingsPayload = {
      ...projectSettingsDraft,
      internal_rom_name: projectSettingsDraft.internal_rom_name.trim(),
      save_slots: Math.max(1, Math.min(9, Math.trunc(projectSettingsDraft.save_slots || 1))),
      sram: {
        enabled: projectSettingsDraft.sram.enabled,
        size_bytes: projectSettingsDraft.sram.size_bytes,
      },
    };
    const localWarnings = projectSettingsWarnings(payload);
    const previousTarget = activeTarget;

    setProjectSettingsSaving(true);
    setProjectSettingsMessage("");
    setProjectSettingsError("");
    try {
      const result = await updateProjectSettings(activeProjectDir, payload);
      if (!result.ok) {
        setProjectSettingsError(result.message);
        logMessage("error", `[Projeto] ${result.message}`);
        return;
      }

      if (result.settings) {
        const settings = mergeProjectSettingsWarnings(result.settings, localWarnings);
        setProjectSettings(settings);
        setProjectSettingsDraft(projectSettingsToPayload(settings));
        if (settings.target === "megadrive" || settings.target === "snes") {
          if (settings.target !== previousTarget) {
            await resetEmulatorSession(true);
            setHwStatus(await getHwStatus(activeProjectDir));
          }
          setActiveTarget(settings.target);
        }
      } else {
        setProjectSettingsDraft(payload);
      }
      setProjectSettingsMessage(result.message);
      logMessage("success", `[Projeto] ${result.message}`);
      requestHwValidationRefresh();
    } catch (error) {
      const message = describeError(error);
      setProjectSettingsError(message);
      logMessage("error", `[Projeto] Falha ao salvar configuracoes: ${message}`);
    } finally {
      setProjectSettingsSaving(false);
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
        const failureMessage = formatEmulatorFailureMessage(result.message);
        logMessage("error", failureMessage);
        if (result.message.includes("Nenhum core Libretro")) {
          openRuntimeSetupForIssue();
        }
        reportDiagnostic(
          result.diagnostics?.[0] ??
            createFallbackDiagnostic({
              area: "libretro_emulation",
              sourcePath: romPath,
              technicalDetail: failureMessage,
            })
        );
        return;
      }

      setEmulatorLoaded(true);
      logMessage("success", `ROM carregada: ${romPath}`);
      setActiveViewportTab("game");
      setEmulPaused(false);
    } catch (error) {
      reportDiagnostic(
        createFallbackDiagnostic({
          area: "libretro_emulation",
          technicalDetail: formatEmulatorFailureMessage(describeError(error)),
        })
      );
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
        state.hwStatus.errors.forEach((error) =>
          reportDiagnostic(
            createFallbackDiagnostic({
              area: "hardware",
              technicalDetail: error,
              suggestedAction:
                "Reduza os recursos marcados como fatais no painel de hardware e rode a validacao novamente.",
            })
          )
        );
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
      setRomMasteringStatus("pending");
      logMessage("info", "Iniciando build...");

      if (!(await persistActiveScene(activeProjectDir, "Build"))) {
        return;
      }

      const hwStatus = await getHwStatus(activeProjectDir);
      setHwStatus(hwStatus);
      if (hwStatus.errors.length > 0) {
        hwStatus.errors.forEach((error) =>
          reportDiagnostic(
            createFallbackDiagnostic({
              area: "hardware",
              technicalDetail: error,
              evidencePath: activeProjectDir,
              suggestedAction:
                "Reduza os recursos marcados como fatais no painel de hardware e rode a validacao novamente.",
            })
          )
        );
        return;
      }
      hwStatus.warnings.forEach((warning) => logMessage("warn", `[HW] ${warning}`));

      const result = await buildProject(activeProjectDir, (line) => {
        logMessage(line.level, line.message);
      });
      if (!result.ok) {
        const errorLines = result.log
          .filter((line) => line.level === "error")
          .map((line) => line.message.trim())
          .filter((msg) => msg.length > 0);
        if (errorLines.some(looksLikeRuntimeDependencyFailure)) {
          openRuntimeSetupForIssue();
        }
        normalizeBuildDiagnostics(result, activeTarget, activeProjectDir).forEach(reportDiagnostic);
        if (!result.diagnostics?.length && errorLines.length > 0) {
          logMessage("error", formatBuildFailureSummary(errorLines));
        }
        return;
      }

      logMessage("success", `Build concluido. ROM: ${result.rom_path}`);
      try {
        const mastering = await inspectRomMastering(result.rom_path);
        const nextStatus =
          mastering.blockers.length > 0
            ? "blocked"
            : mastering.warnings.length > 0
              ? "partial"
              : mastering.checksum.status;
        setRomMasteringStatus(nextStatus);
        mastering.blockers.forEach(reportDiagnostic);
        mastering.warnings.forEach((warning) => logMessage("warn", `[ROM Mastering] ${warning}`));
        logMessage(
          mastering.blockers.length > 0 ? "warn" : "info",
          `[ROM Mastering] ${mastering.platform ?? "unknown"} checksum=${mastering.checksum.status} sram=${mastering.sram.status} region=${mastering.region.status}`
        );
      } catch (error) {
        setRomMasteringStatus("inspect_failed");
        logMessage("error", `[ROM Mastering] ${error instanceof Error ? error.message : String(error)}`);
      }
      const loadResult = await emulatorLoadRom(result.rom_path);
      if (!loadResult.ok) {
        setEmulatorLoaded(false);
        const failureMessage = formatEmulatorFailureMessage(loadResult.message);
        logMessage("error", failureMessage);
        if (loadResult.message.includes("Nenhum core Libretro")) {
          openRuntimeSetupForIssue();
        }
        reportDiagnostic(
          loadResult.diagnostics?.[0] ??
            createFallbackDiagnostic({
              area: "libretro_emulation",
              sourcePath: result.rom_path,
              technicalDetail: failureMessage,
            })
        );
        return;
      }

      setEmulatorLoaded(true);
      logMessage("success", "ROM carregada no emulador.");
      setEmulPaused(false);
      setActiveViewportTab("game");
      setActiveWorkspace("game");
    } catch (error) {
      reportDiagnostic(
        createFallbackDiagnostic({
          area: buildAreaForTarget(activeTarget),
          technicalDetail: describeError(error),
          evidencePath: activeProjectDir ? `${activeProjectDir}/build/${activeTarget === "snes" ? "snes" : "megadrive"}` : null,
        })
      );
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
    const saved = await persistActiveScene(activeProjectDir, "Fechar", "Projeto salvo antes de fechar.");
    if (!saved) {
      const discard = window.confirm(
        "Falha ao salvar o projeto. Deseja descartar as alteracoes e fechar mesmo assim?"
      );
      if (!discard) {
        logMessage("info", "Fechamento cancelado apos falha de persistencia.");
        return;
      }
      logMessage("warn", "Projeto fechado com alteracoes nao salvas.");
    }
    await resetEmulatorSession(true);
    setActiveProject("", "");
    setActiveScenePath("");
    setActiveScene(null);
    setHwStatus(null);
    resetHwValidation();
    setSelectedEntityId(null);
    setLastSgdkImportSummary(null);
    setShowProjectSettings(false);
    setProjectSettings(null);
    setProjectSettingsDraft(null);
    setProjectSettingsMessage("");
    setProjectSettingsError("");
    logMessage("info", "Projeto fechado.");
  }

  function handleWorkspaceSelect(workspace: EditorWorkspace) {
    setActiveWorkspace(workspace);
    const config = resolveWorkspaceShellConfig(workspace, shellWidth);

    if (workspace === "debug") {
      openToolsWorkspace("profiler", "debug", true);
      setActiveViewportTab("scene");
      return;
    }

    if (config.defaultRightMode === "tools") {
      openToolsWorkspace(
        workspace === "logic" ? "palette" : toolPanelActive,
        "editing",
        false
      );
    } else if (config.defaultRightMode === "inspector") {
      setRightPanelMode("inspector");
    } else if (config.defaultRightMode === "hidden") {
      setRightPanelMode("inspector");
    }

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
              "Palette a esquerda, validacao e propriedades a direita no NodeGraph; o shell global nao abre Tools neste workspace.",
            detail:
              "Selecione uma entidade na hierarquia, monte o fluxo no canvas e use o painel direito para validacao, contexto importado e atalhos de navegacao.",
            signal: sharedSignal,
            actions: [
              {
                label: "Abrir Paleta Contextual",
                onClick: () => {
                  setActiveViewportTab("logic");
                  logMessage(
                    "info",
                    "Paleta de nos na barra esquerda do NodeGraph; validacao no painel direito fixo."
                  );
                },
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
            title: "Sprites, timeline e inspector integrados neste workspace.",
            summary:
              "O canvas de origem e preview dominam a area central; timeline compacta abaixo; inspector contextual fica no proprio ArtStudio.",
            detail:
              "Abra o Asset Browser para escolher a origem, use fit/zoom/pan no stage e exporte quando a sequencia estiver pronta.",
            signal: sharedSignal,
            actions: [
              {
                label: "Abrir Asset Browser",
                onClick: () => openToolsWorkspace("assets", "editing"),
                accent: "primary",
              },
              {
                label: "Ir para Cena",
                onClick: () => handleWorkspaceSelect("scene"),
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

        const sceneContext = resolveSceneWorkspaceContext({
          scene: activeScene,
          scenePath: activeScenePath,
          projectSourceKind,
          projectLegacyIndex,
        });

        return {
          eyebrow: sceneContext.eyebrow,
          title: sceneContext.title,
          summary: sceneContext.summary,
          checkpoints: sceneContext.checkpoints,
          detail: sceneContext.detail,
          signal: sharedSignal,
          actions: [
            {
              label: "Abrir Asset Browser",
              onClick: () => openToolsWorkspace("assets", "editing"),
              accent: "primary",
            },
            {
              label: "Focar Entidade Guia",
              onClick: () => setSelectedEntityId(sceneContext.focusEntityId),
              disabled: !sceneContext.focusEntityId,
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

  function renderProjectTemplateCard(template: ProjectTemplateSummary) {
    const availability = templateAvailability(template);
    const isSelected = template.id === selectedTemplateId;
    const donorPath = templateDonorPaths[template.id] || template.default_donor_path || "";
    const isExternalSgdk = template.source_kind === "external_sgdk";

    return (
      <div
        key={template.id}
        className={`overflow-hidden rounded border ${
          isSelected
            ? "border-[var(--rds-action-primary)] bg-[var(--rds-surface-panel)]"
            : "border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel-strong)]"
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
              <h3 className="text-sm font-semibold text-[var(--rds-text-primary)]">{template.name}</h3>
              <p className="text-[10px] uppercase tracking-wide text-[var(--rds-text-muted)]">
                {template.genre}
              </p>
            </div>
            {template.experimental ? (
              <span className="rounded border border-[var(--rds-status-warning)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--rds-status-warning)]">
                Experimental
              </span>
            ) : null}
          </div>
          <p className="min-h-[3rem] text-[11px] leading-5 text-[var(--rds-text-secondary)]">
            {template.description}
          </p>
          <div className="flex flex-wrap gap-1">
            <span className="rounded bg-[var(--rds-border-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--rds-text-primary)]">
              {template.difficulty}
            </span>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] ${
                availability.tone === "success"
                  ? "bg-[var(--rds-status-success)]/15 text-[var(--rds-status-success)]"
                  : availability.tone === "warn"
                    ? "bg-[var(--rds-status-warning)]/15 text-[var(--rds-status-warning)]"
                    : "bg-[var(--rds-status-error)]/15 text-[var(--rds-status-error)]"
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
                  className="rounded bg-[var(--rds-surface-panel)] px-1.5 py-0.5 text-[10px] text-[var(--rds-text-muted)]"
                >
                  {feature}
                </span>
              ))
            ) : (
              <span className="text-[10px] text-[var(--rds-text-muted)]">Sem presets iniciais.</span>
            )}
          </div>
        </button>

        {isExternalSgdk ? (
          <div className="border-t border-[var(--rds-border-subtle)] p-3 text-[10px] text-[var(--rds-text-muted)]">
            <div className="mb-2">
              <p className="text-[var(--rds-text-secondary)]">Template doador</p>
              <p className="truncate font-mono text-[var(--rds-text-primary)]">
                {donorPath || "(selecione uma pasta doadora)"}
              </p>
            </div>
            {availability.reason ? (
              <p className="mb-2 text-[var(--rds-status-warning)]">{availability.reason}</p>
            ) : (
              <p className="mb-2 text-[var(--rds-text-muted)]">
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
  }

  useEffect(() => {
    if (!automationEnabled) {
      delete window.__RDS_E2E__;
      return;
    }

    window.__RDS_E2E__ = {
      openProject: (projectDir: string) => openProjectAtPath(projectDir, "E2E"),
      importSgdkProject: async (projectName: string, baseDir: string, sgdkDonorPath: string) => {
        const result = await importSgdkProject(projectName, baseDir, sgdkDonorPath);
        const hydrated = await hydrateProjectState(
          result.path,
          result.name,
          "E2E SGDK",
          result.preferred_scene_path
        );
        if (!hydrated) {
          throw new Error(`Falha ao hidratar importacao SGDK em ${result.path}`);
        }
        setLastSgdkImportSummary(result.import_summary ?? null);
        return result.path;
      },
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
      setConsoleVisible: (visible: boolean) => {
        useEditorStore.setState({ consoleVisible: Boolean(visible) });
        return true;
      },
      setEntityLogicGraph: (entityId: string, graphJson: string) => {
        const state = useEditorStore.getState();
        const entity = state.activeScene?.entities.find((candidate) => candidate.entity_id === entityId);
        if (!entity) {
          throw new Error(`Entidade '${entityId}' nao encontrada para atualizar graph.`);
        }
        state.updateEntity(entityId, {
          components: {
            ...entity.components,
            logic: {
              ...(entity.components.logic ?? {}),
              graph: graphJson,
              graph_origin: entity.components.logic?.graph_ref
                ? "user_edited_ref"
                : entity.components.logic?.graph_origin,
            },
          },
        });
        return true;
      },
      setEntityTransform: (entityId: string, x: number, y: number) => {
        const state = useEditorStore.getState();
        const entity = state.activeScene?.entities.find((candidate) => candidate.entity_id === entityId);
        if (!entity) {
          throw new Error(`Entidade '${entityId}' nao encontrada para mover no E2E.`);
        }
        state.updateEntity(entityId, {
          transform: {
            ...entity.transform,
            x,
            y,
          },
        });
        return true;
      },
      instantiateBrowserImageAsset: async (relativePath: string) => {
        const trimmed = String(relativePath ?? "").trim();
        if (!trimmed) {
          throw new Error("instantiateBrowserImageAsset: relativePath vazio.");
        }
        const state = useEditorStore.getState();
        if (!state.activeProjectDir || !state.activeScene) {
          throw new Error("instantiateBrowserImageAsset: projeto ou cena ativa ausente.");
        }
        const asset = { kind: "image" as const, relative_path: trimmed };
        const decision = classifyImageAssetInstantiation({
          asset,
          projectSourceKind: state.projectSourceKind,
          sceneEntities: state.activeScene.entities,
        });
        const existingEntityIds = state.activeScene.entities.map((candidate) => candidate.entity_id);
        const entity =
          decision.kind === "tilemap"
            ? createTilemapEntityFromAsset({
                assetPath: trimmed,
                existingEntityIds,
              })
            : createSpriteEntityFromAsset({
                assetPath: trimmed,
                target: state.activeTarget,
                existingEntityIds,
                includeStarterLogic: false,
              });
        state.addEntity(entity);
        const saved = await persistActiveScene(
          state.activeProjectDir,
          "E2E instantiateBrowserImageAsset",
          `[E2E] Instanciado ${decision.kind} a partir de '${trimmed}' (${decision.reason}).`
        );
        if (!saved) {
          throw new Error("instantiateBrowserImageAsset: persistActiveScene falhou.");
        }
        return { entityId: entity.entity_id, kind: decision.kind, reason: decision.reason };
      },
      getEntityLogicState: (entityId: string) => {
        const state = useEditorStore.getState();
        const sourceEntity = state.activeSceneSource?.entities.find(
          (candidate) => candidate.entity_id === entityId
        );
        const resolvedEntity = state.activeScene?.entities.find(
          (candidate) => candidate.entity_id === entityId
        );
        if (!sourceEntity && !resolvedEntity) {
          return null;
        }
        return {
          entityId,
          source: sourceEntity
            ? {
                graph_ref: sourceEntity.components.logic?.graph_ref ?? null,
                graph_origin: sourceEntity.components.logic?.graph_origin ?? null,
                has_graph: Boolean(sourceEntity.components.logic?.graph?.trim()),
                source_paths: [...(sourceEntity.components.logic?.imported_semantics?.source_paths ?? [])],
                external_source_refs: [...(sourceEntity.components.logic?.external_source_refs ?? [])],
              }
            : null,
          resolved: resolvedEntity
            ? {
                graph_ref: resolvedEntity.components.logic?.graph_ref ?? null,
                graph_origin: resolvedEntity.components.logic?.graph_origin ?? null,
                has_graph: Boolean(resolvedEntity.components.logic?.graph?.trim()),
                source_paths: [...(resolvedEntity.components.logic?.imported_semantics?.source_paths ?? [])],
                external_source_refs: [...(resolvedEntity.components.logic?.external_source_refs ?? [])],
              }
            : null,
        };
      },
      openEntitySourcePath: async (entityId: string, relativePath?: string | null) => {
        const state = useEditorStore.getState();
        if (!state.activeProjectDir) {
          throw new Error("Nenhum projeto aberto para abrir fonte real.");
        }
        const entity =
          state.activeScene?.entities.find((candidate) => candidate.entity_id === entityId) ??
          state.activeSceneSource?.entities.find((candidate) => candidate.entity_id === entityId) ??
          null;
        const fallbackPath =
          entity?.components.logic?.imported_semantics?.source_paths?.[0] ??
          entity?.components.logic?.external_source_refs?.[0] ??
          null;
        const nextRelativePath = String(relativePath ?? fallbackPath ?? "").trim();
        if (!nextRelativePath) {
          throw new Error(`Entidade '${entityId}' sem source_paths/external_source_refs rastreaveis.`);
        }
        const result = await openProjectSourcePath(state.activeProjectDir, nextRelativePath);
        if (!result.ok) {
          throw new Error(result.message || "Falha ao abrir fonte real no host.");
        }
        return {
          ok: true,
          absolute_path: result.absolute_path ?? null,
          relative_path: nextRelativePath,
        };
      },
      getState: () => {
        const state = useEditorStore.getState();
        const sceneWorldMetrics = resolveSceneWorldMetrics(state.activeScene, state.activeTarget);
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
          activeTilemapId: state.activeTilemapId,
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
                worldBounds: sceneWorldMetrics.bounds,
                viewportFrame: sceneWorldMetrics.frame,
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
                  animationNames: Object.keys(entity.components.sprite?.animations ?? {}),
                  commandCount: entity.components.sprite?.commands?.length ?? 0,
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
            staleHint: currentLiveState === "DESATUAL." ? "Edite a cena para revalidar" : "",
            hasStaleRevalidateButton: currentLiveState === "DESATUAL.",
          },
          consoleEntries: state.consoleEntries.map(({ level, message, diagnostic }) => ({
            level,
            message,
            diagnostic: diagnostic ?? null,
          })),
          projectSourceKind: state.projectSourceKind,
        };
      },
    };

    return () => {
      delete window.__RDS_E2E__;
    };
  }, [automationEnabled, rightPanelMode]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--rds-surface-panel-strong)] text-[var(--rds-text-primary)]">
      <Dialog
        open={showProjectWizard}
        title={activeProjectDir ? "Novo Projeto" : "Wizard de Primeiro Uso"}
        description="Crie um projeto editável pelo fluxo canônico em três passos claros."
        onClose={() => {
          setShowProjectWizard(false);
          setWizardStep(1);
        }}
        closeLabel="Fechar assistente de projeto"
        portal={false}
        className="min-h-0 w-[52rem] max-w-[calc(100vw-1.5rem)]"
      >
        <nav aria-label="Etapas do assistente" className="mb-4">
          <ol className="grid grid-cols-3 gap-2">
            {([
              [1, "Template", "Escolha a base"],
              [2, "Destino", "Plataforma e pasta"],
              [3, "Revisão", "Confirme e crie"],
            ] as const).map(([step, label, detail]) => {
              const active = wizardStep === step;
              const complete = wizardStep > step;
              return (
                <li key={step}>
                  <button
                    type="button"
                    aria-current={active ? "step" : undefined}
                    onClick={() => setWizardStep(step)}
                    className={`flex min-h-12 w-full items-center gap-2 rounded border px-3 py-2 text-left transition-colors ${
                      active
                        ? "border-[var(--rds-action-primary)] bg-[var(--rds-action-primary-soft)]"
                        : "border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel-strong)] hover:border-[var(--rds-border-strong)]"
                    }`}
                  >
                    <span
                      className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                        complete
                          ? "bg-[var(--rds-status-success)] text-[var(--rds-surface-panel)]"
                          : active
                            ? "bg-[var(--rds-action-primary)] text-[var(--rds-surface-panel)]"
                            : "bg-[var(--rds-border-subtle)] text-[var(--rds-text-secondary)]"
                      }`}
                    >
                      {complete ? <Icon name="check-circle" size={14} /> : step}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-[var(--rds-text-primary)]">
                        {label}
                      </span>
                      <span className="block truncate text-[9px] text-[var(--rds-text-muted)]">
                        {detail}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
            <div
              data-testid="project-wizard-body"
              data-wizard-step={wizardStep}
              className="min-h-0 flex-1 space-y-4"
            >
              <div
                data-testid="wizard-recommended-start"
                hidden={wizardStep !== 1}
                className="grid gap-3 md:grid-cols-2"
              >
                <p className="col-span-full text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--rds-status-success)]">
                  Primeiro Projeto
                </p>
              {templatesLoading ? (
                <div className="col-span-full rounded border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel-strong)] p-4 text-xs text-[var(--rds-text-muted)]">
                  Carregando galeria de templates...
                </div>
              ) : (
                recommendedProjectTemplates.map((template) => {
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
                          ? "border-[var(--rds-action-primary)] bg-[var(--rds-surface-panel)]"
                          : "border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel-strong)]"
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
                            <h3 className="text-sm font-semibold text-[var(--rds-text-primary)]">{template.name}</h3>
                            <p className="text-[10px] uppercase tracking-wide text-[var(--rds-text-muted)]">
                              {template.genre}
                            </p>
                          </div>
                          {template.experimental ? (
                            <span className="rounded border border-[var(--rds-status-warning)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--rds-status-warning)]">
                              Experimental
                            </span>
                          ) : null}
                        </div>
                        <p className="min-h-[3rem] text-[11px] leading-5 text-[var(--rds-text-secondary)]">
                          {template.description}
                        </p>
                        <div className="flex flex-wrap gap-1">
                          <span className="rounded bg-[var(--rds-border-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--rds-text-primary)]">
                            {template.difficulty}
                          </span>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] ${
                              availability.tone === "success"
                                ? "bg-[var(--rds-status-success)]/15 text-[var(--rds-status-success)]"
                                : availability.tone === "warn"
                                  ? "bg-[var(--rds-status-warning)]/15 text-[var(--rds-status-warning)]"
                                  : "bg-[var(--rds-status-error)]/15 text-[var(--rds-status-error)]"
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
                                className="rounded bg-[var(--rds-surface-panel)] px-1.5 py-0.5 text-[10px] text-[var(--rds-text-muted)]"
                              >
                                {feature}
                              </span>
                            ))
                          ) : (
                            <span className="text-[10px] text-[var(--rds-text-muted)]">Sem presets iniciais.</span>
                          )}
                        </div>
                      </button>

                      {isExternalSgdk ? (
                        <div className="border-t border-[var(--rds-border-subtle)] p-3 text-[10px] text-[var(--rds-text-muted)]">
                          <div className="mb-2">
                            <p className="text-[var(--rds-text-secondary)]">Template doador</p>
                            <p className="truncate font-mono text-[var(--rds-text-primary)]">
                              {donorPath || "(selecione uma pasta doadora)"}
                            </p>
                          </div>
                          {availability.reason ? (
                            <p className="mb-2 text-[var(--rds-status-warning)]">{availability.reason}</p>
                          ) : (
                            <p className="mb-2 text-[var(--rds-text-muted)]">
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

            {!templatesLoading && importAdvancedProjectTemplates.length > 0 ? (
              <section
                data-testid="wizard-import-advanced"
                hidden={wizardStep !== 1}
                className="rounded border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel-strong)]/70 p-3"
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--rds-status-warning)]">
                      Importar / Avancado
                    </p>
                    <p className="mt-1 text-[10px] leading-5 text-[var(--rds-text-muted)]">
                      Templates doadores e experimentais ficam fora do primeiro caminho para manter o fluxo MVP claro.
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full border border-[var(--rds-status-warning)]/35 bg-[var(--rds-status-warning)]/10 px-2 py-1 text-[9px] font-semibold text-[var(--rds-status-warning)]">
                    Experimental
                  </span>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {importAdvancedProjectTemplates.map(renderProjectTemplateCard)}
                </div>
              </section>
            ) : null}

            <div hidden={wizardStep !== 1} className="grid gap-3">
              <div className="rounded border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel-strong)] p-3 text-[10px] text-[var(--rds-text-muted)]">
                <p className="mb-1 text-[var(--rds-text-primary)]">
                  Template selecionado: <span className="font-semibold">{selectedTemplate?.name ?? "Nenhum"}</span>
                </p>
                <p className="leading-5">
                  {selectedTemplate?.description ??
                    "A galeria de templates sera exibida assim que o catalogo for carregado."}
                </p>
                {selectedTemplateMegadriveOnly ? (
                  <p className="mt-2 text-[var(--rds-status-warning)]">
                    Este seed experimental e Mega Drive only nesta wave.
                  </p>
                ) : null}
                {selectedTemplate ? (
                  <div className="mt-3 rounded border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel)] px-3 py-2">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--rds-tool-active)]">
                      Validacao do fluxo
                    </p>
                    <p
                      className={`mt-1 leading-5 ${
                        selectedTemplateAvailability?.readyToCreate
                          ? "text-[var(--rds-status-success)]"
                          : selectedTemplateAvailability?.available
                            ? "text-[var(--rds-status-warning)]"
                            : "text-[var(--rds-status-error)]"
                      }`}
                    >
                      {selectedTemplateAvailability?.readyToCreate
                        ? "Template pronto para criar projeto."
                        : selectedTemplateAvailability?.reason || "Template ainda indisponivel para este fluxo."}
                    </p>
                    {selectedTemplate.source_kind === "external_sgdk" ? (
                      <p className="mt-1 leading-5 text-[var(--rds-status-warning)]">
                        {selectedTemplateDonorPath
                          ? `Template doador atual: ${selectedTemplateDonorPath}`
                          : "Escolha uma pasta doadora SGDK antes de criar este template experimental."}
                      </p>
                    ) : (
                      <p className="mt-1 leading-5 text-[var(--rds-text-muted)]">
                        Template interno: nenhuma pasta doadora externa e necessaria.
                      </p>
                    )}
                  </div>
                ) : null}
              </div>

              <div
                data-testid="wizard-external-import-section"
                className="rounded border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel-strong)] p-3 text-[10px] text-[var(--rds-text-muted)]"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--rds-status-warning)]">
                      Trilha secundaria
                    </p>
                    <p className="mt-1 text-[var(--rds-text-primary)]">
                      Importar projeto existente
                    </p>
                    <p className="mt-1 leading-5 text-[var(--rds-text-muted)]">
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
                  <div className="mt-3 rounded border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel)] p-3">
                    <p className="mb-1 text-[var(--rds-text-primary)]">
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
                      <span className="rounded bg-[var(--rds-border-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--rds-text-primary)]">
                        {selectedExternalImportProfile?.family ?? "External"}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] ${
                          selectedExternalImportProfile?.importable
                            ? "bg-[var(--rds-status-success)]/15 text-[var(--rds-status-success)]"
                            : "bg-[var(--rds-status-warning)]/15 text-[var(--rds-status-warning)]"
                        }`}
                      >
                        {selectedExternalImportProfile?.support_status ?? "Nao suportado"}
                      </span>
                      {selectedExternalImportProfile?.supported_levels.map((level) => (
                        <span
                          key={level}
                          className="rounded bg-[var(--rds-surface-panel-strong)] px-1.5 py-0.5 text-[10px] text-[var(--rds-text-muted)]"
                        >
                          {level}
                        </span>
                      ))}
                    </div>
                    <select
                      data-testid="external-import-profile-select"
                      value={selectedExternalImportProfileId}
                      onChange={(event) => setSelectedExternalImportProfileId(event.target.value)}
                      className="mt-3 w-full rounded border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel)] px-2 py-1.5 text-[11px] text-[var(--rds-text-primary)] focus:border-[var(--rds-action-primary)] focus:outline-none"
                    >
                      {externalImportProfiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name} · {profile.support_status}
                        </option>
                      ))}
                    </select>
                    <p className="mt-2 leading-5 text-[var(--rds-text-muted)]">
                      {selectedExternalImportProfile?.mega_drive_only
                        ? "Esta wave de importacao externa continua Mega Drive only para manter o caminho canonico enxuto."
                        : "Perfil externo compativel com o fluxo atual do wizard."}
                    </p>
                    {selectedExternalImportProfile?.id === "sgdk" ? (
                      <SgdkCapabilityMatrix profile={selectedExternalImportProfile} />
                    ) : null}
                    <div className="mt-3 flex justify-end">
                      <ToolbarButton
                        label={creatingProject ? "Importando..." : "Importar Projeto Externo"}
                        onClick={() => void handleImportExternalProject()}
                        disabled={creatingProject || templatesLoading}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 rounded border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel)] px-3 py-2 text-[10px] leading-5 text-[var(--rds-text-muted)]">
                    Perfil atual:{" "}
                    <span className="font-semibold text-[var(--rds-text-primary)]">
                      {selectedExternalImportProfile?.name ?? "Nenhum"}
                    </span>
                    . Abra o importador quando precisar converter um projeto existente em vez
                    de criar um template novo.
                  </div>
                )}
              </div>
            </div>

            <div hidden={wizardStep !== 1}>
              {selectedTemplate ? (
                <TemplateFirstSuccessCard
                  templateName={selectedTemplate.name}
                  targetLabel={getTargetLabel(newProjTarget)}
                  steps={selectedTemplateFirstSuccessSteps}
                />
              ) : (
                <div className="rounded border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel-strong)] p-3 text-[10px] leading-5 text-[var(--rds-text-muted)]">
                  Escolha um template para o wizard montar um caminho recomendado ate o primeiro
                  playtest no fluxo canonico atual.
                </div>
              )}
            </div>

            <div
              data-testid="wizard-step-destination"
              hidden={wizardStep !== 2}
              className="flex gap-2"
            >
              {(["megadrive", "snes"] as const).map((target) => (
                <button
                  key={target}
                  type="button"
                  disabled={selectedTemplateMegadriveOnly && target === "snes"}
                  onClick={() => setNewProjTarget(target)}
                  className={`flex-1 rounded px-3 py-2 text-xs font-semibold transition-colors ${
                    newProjTarget === target
                      ? target === "megadrive"
                        ? "bg-[var(--rds-status-success)] text-[var(--rds-surface-panel)]"
                        : "bg-[var(--rds-status-info)] text-[var(--rds-surface-panel)]"
                      : "bg-[var(--rds-border-subtle)] text-[var(--rds-text-secondary)] hover:bg-[var(--rds-text-disabled)]"
                  } disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  {target === "megadrive" ? "Mega Drive" : "SNES"}
                </button>
              ))}
            </div>

            <div hidden={wizardStep !== 2} className="grid gap-3 md:grid-cols-[1fr_1.1fr]">
              <div className="space-y-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={newProjName}
                  onChange={(event) => handleProjectNameChange(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && void confirmNewProject()}
                  placeholder="Nome do projeto"
                  className="w-full rounded border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel)] px-2 py-1.5 text-sm text-[var(--rds-text-primary)] focus:border-[var(--rds-action-primary)] focus:outline-none"
                />

                {pendingSuggestedProjectName ? (
                  <div className="rounded border border-[var(--rds-text-disabled)] bg-[var(--rds-surface-panel-strong)] p-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[10px] text-[var(--rds-text-muted)]">Nome sugerido</p>
                        <p
                          data-testid="wizard-project-name-suggestion"
                          className="truncate text-xs font-semibold text-[var(--rds-status-success)]"
                        >
                          {pendingSuggestedProjectName}
                        </p>
                      </div>
                      <ToolbarButton label="Usar" onClick={applySuggestedProjectName} />
                    </div>
                    <p className="mt-2 text-[10px] leading-5 text-[var(--rds-text-muted)]">
                      {projectDestinationPreview?.collision_status === "existing_project"
                        ? "O nome original aponta para um projeto RetroDev ja valido. Use o nome sugerido para criar outro sem sobrescrever o existente."
                        : "O nome atual ja ocupa a pasta preferida. Use o nome sugerido para o RetroDev criar o projeto em um destino livre ja nesta tentativa."}
                    </p>
                  </div>
                ) : null}
              </div>

              <div className="rounded border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel-strong)] p-2">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] text-[var(--rds-text-muted)]">Pasta base</p>
                    <p className="truncate font-mono text-[10px] text-[var(--rds-text-primary)]">
                      {newProjBaseDir || automaticBaseDirHint || "(automatico pelo sistema)"}
                    </p>
                  </div>
                  <ToolbarButton label="Escolher" onClick={() => void chooseNewProjectBaseDir()} />
                </div>
                <div className="mt-2 border-t border-[var(--rds-border-subtle)] pt-2">
                  <p className="text-[10px] text-[var(--rds-text-muted)]">Destino estimado</p>
                  <p
                    data-testid="wizard-project-destination"
                    className="truncate font-mono text-[10px] text-[var(--rds-status-warning)]"
                  >
                    {estimatedProjectDestination}
                  </p>
                </div>
                <p className="mt-2 text-[10px] leading-5 text-[var(--rds-text-muted)]">
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
                hidden={wizardStep !== 2}
                className="mt-3 rounded border border-[var(--rds-status-info)]/40 bg-[var(--rds-surface-panel-strong)] p-3"
              >
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--rds-status-info)]">
                  Projeto RetroDev encontrado
                </p>
                <p className="mt-2 text-xs text-[var(--rds-text-primary)]">
                  O nome original ja aponta para{" "}
                  <span className="font-semibold text-[var(--rds-status-success)]">
                    {detectedExistingProjectPreview.existing_project_name ?? "um projeto existente"}
                  </span>
                  .
                </p>
                <p
                  data-testid="wizard-existing-project-path"
                  className="mt-2 truncate font-mono text-[10px] text-[var(--rds-tool-active)]"
                >
                  {detectedExistingProjectPreview.existing_project_path}
                </p>
                <p className="mt-2 text-[10px] leading-5 text-[var(--rds-text-muted)]">
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

            <section
              data-testid="wizard-step-review"
              hidden={wizardStep !== 3}
              aria-label="Resumo do novo projeto"
              className="space-y-3"
            >
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel-strong)] p-3">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--rds-text-muted)]">
                    Template
                  </p>
                  <p className="mt-2 text-sm font-semibold text-[var(--rds-text-primary)]">
                    {selectedTemplate?.name ?? "Não selecionado"}
                  </p>
                  <p className="mt-1 text-[10px] text-[var(--rds-text-muted)]">
                    {selectedTemplateAvailability?.statusLabel ?? "Aguardando seleção"}
                  </p>
                </div>
                <div className="rounded border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel-strong)] p-3">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--rds-text-muted)]">
                    Plataforma
                  </p>
                  <p className="mt-2 text-sm font-semibold text-[var(--rds-text-primary)]">
                    {getTargetLabel(newProjTarget)}
                  </p>
                  <p className="mt-1 text-[10px] text-[var(--rds-text-muted)]">
                    Fluxo canônico Build → ROM → Emulação
                  </p>
                </div>
                <div className="rounded border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel-strong)] p-3">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--rds-text-muted)]">
                    Projeto
                  </p>
                  <p className="mt-2 truncate text-sm font-semibold text-[var(--rds-text-primary)]">
                    {newProjName || "Sem nome"}
                  </p>
                  <p className="mt-1 truncate font-mono text-[10px] text-[var(--rds-text-muted)]">
                    {estimatedProjectDestination}
                  </p>
                </div>
              </div>
              <div
                className={`flex items-start gap-3 rounded border p-3 ${
                  selectedTemplateAvailability?.readyToCreate
                    ? "border-[var(--rds-status-success)]/40 bg-[var(--rds-status-success-soft)]"
                    : "border-[var(--rds-status-warning)]/40 bg-[var(--rds-status-warning-soft)]"
                }`}
              >
                <Icon
                  name={selectedTemplateAvailability?.readyToCreate ? "check-circle" : "warning-triangle"}
                  size={20}
                  className={
                    selectedTemplateAvailability?.readyToCreate
                      ? "text-[var(--rds-status-success)]"
                      : "text-[var(--rds-status-warning)]"
                  }
                />
                <div>
                  <p className="text-xs font-semibold text-[var(--rds-text-primary)]">
                    {selectedTemplateAvailability?.readyToCreate
                      ? "Tudo pronto para criar"
                      : "Revise os requisitos do template"}
                  </p>
                  <p className="mt-1 text-[10px] leading-5 text-[var(--rds-text-secondary)]">
                    {selectedTemplateAvailability?.readyToCreate
                      ? "O projeto será criado sem sobrescrever destinos existentes."
                      : selectedTemplateAvailability?.reason || "Selecione um template disponível no primeiro passo."}
                  </p>
                </div>
              </div>
            </section>
            </div>

            <div
              data-testid="project-wizard-actions"
              className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel)] pt-3"
            >
              <div>
                {wizardStep > 1 ? (
                  <ToolbarButton
                    label="Voltar"
                    icon="nav-arrow-left"
                    onClick={() => setWizardStep((wizardStep - 1) as 1 | 2)}
                  />
                ) : null}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                {activeProjectDir ? (
                  <ToolbarButton
                    label="Cancelar"
                    onClick={() => {
                      setShowProjectWizard(false);
                      setWizardStep(1);
                    }}
                  />
                ) : null}
                {wizardStep < 3 ? (
                  <ToolbarButton
                    label="Continuar"
                    icon="nav-arrow-right"
                    onClick={() => setWizardStep((wizardStep + 1) as 2 | 3)}
                    accent="primary"
                  />
                ) : null}
                <div hidden={wizardStep !== 3} className="flex flex-wrap justify-end gap-2">
                    <ToolbarButton label="Abrir Projeto" onClick={() => void handleOpenProject()} />
                    <ToolbarButton
                      label={creatingProject ? "Criando..." : "Criar Projeto"}
                      icon="plus-circle"
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
      </Dialog>

      <Dialog
        open={showProjectSettings}
        title="Configuracoes do Projeto"
        description={`project.rds · ${activeProjectName || "Projeto ativo"}`}
        onClose={() => {
          setShowProjectSettings(false);
          setProjectSettingsMessage("");
          setProjectSettingsError("");
        }}
        closeLabel="Fechar configurações do projeto"
        portal={false}
        className="w-[min(560px,calc(100vw-1.5rem))]"
      >
            <div className="min-h-0 flex-1">
              {projectSettingsLoading && !projectSettingsDraft ? (
                <div className="rounded border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel-strong)] p-4 text-xs text-[var(--rds-text-muted)]">
                  Carregando configuracoes...
                </div>
              ) : projectSettingsDraft ? (
                <div className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <Select
                      label="Plataforma alvo"
                      controlSize="sm"
                      value={projectSettingsDraft.target}
                      onChange={(event) => {
                        const target = event.currentTarget.value as "megadrive" | "snes";
                        setProjectSettingsDraft((current) =>
                          current ? { ...current, target } : current
                        );
                      }}
                    >
                      <option value="megadrive">Mega Drive</option>
                      <option value="snes">SNES</option>
                    </Select>

                    <Select
                      label="Região"
                      controlSize="sm"
                      value={projectSettingsDraft.region}
                      onChange={(event) => {
                        const region = event.currentTarget.value;
                        setProjectSettingsDraft((current) =>
                          current ? { ...current, region } : current
                        );
                      }}
                    >
                      <option value="world">World</option>
                      <option value="japan">Japan</option>
                      <option value="usa">USA</option>
                      <option value="europe">Europe</option>
                    </Select>
                  </div>

                  <div className="grid gap-3 md:grid-cols-[1fr_8rem]">
                    <Input
                      label="Nome interno da ROM"
                      controlSize="sm"
                      data-testid="project-settings-internal-name"
                      value={projectSettingsDraft.internal_rom_name}
                      errorMessage={projectSettingsNameError || undefined}
                      onInput={(event) => {
                        const internal_rom_name = event.currentTarget.value;
                        setProjectSettingsDraft((current) =>
                          current ? { ...current, internal_rom_name } : current
                        );
                      }}
                    />

                    <Select
                      label="Vídeo"
                      controlSize="sm"
                      value={projectSettingsDraft.video_standard}
                      onChange={(event) => {
                        const video_standard = event.currentTarget.value;
                        setProjectSettingsDraft((current) =>
                          current ? { ...current, video_standard } : current
                        );
                      }}
                    >
                      <option value="ntsc">NTSC</option>
                      <option value="pal">PAL</option>
                    </Select>
                  </div>

                  <div className="grid gap-3 rounded border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel-strong)] p-3 md:grid-cols-[1fr_10rem_8rem]">
                    <label className="flex items-center gap-2 text-xs font-semibold text-[var(--rds-text-primary)]">
                      <input
                        data-testid="project-settings-sram-enabled"
                        type="checkbox"
                        checked={projectSettingsDraft.sram.enabled}
                        onChange={(event) => {
                          const enabled = event.currentTarget.checked;
                          setProjectSettingsDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  sram: { ...current.sram, enabled },
                                }
                              : current
                          );
                        }}
                        className="h-4 w-4"
                      />
                      SRAM
                    </label>

                    <Select
                      label="Tamanho"
                      controlSize="sm"
                      value={projectSettingsDraft.sram.size_bytes}
                      onChange={(event) => {
                        const size_bytes = Number(event.currentTarget.value);
                        setProjectSettingsDraft((current) =>
                          current
                            ? {
                                ...current,
                                sram: { ...current.sram, size_bytes },
                              }
                            : current
                        );
                      }}
                    >
                      {SRAM_SIZE_OPTIONS.map((size) => (
                        <option key={size} value={size}>
                          {size / 1024} KB
                        </option>
                      ))}
                    </Select>

                    <Input
                      label="Slots"
                      controlSize="sm"
                      type="number"
                      min={1}
                      max={9}
                      value={projectSettingsDraft.save_slots}
                      onInput={(event) => {
                        const save_slots = Number(event.currentTarget.value);
                        setProjectSettingsDraft((current) =>
                          current ? { ...current, save_slots } : current
                        );
                      }}
                    />
                  </div>

                  <label className="flex items-center gap-2 rounded border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel-strong)] p-3 text-xs font-semibold text-[var(--rds-text-primary)]">
                    <input
                      type="checkbox"
                      checked={projectSettingsDraft.debug_overlay}
                      onChange={(event) => {
                        const debug_overlay = event.currentTarget.checked;
                        setProjectSettingsDraft((current) =>
                          current ? { ...current, debug_overlay } : current
                        );
                      }}
                      className="h-4 w-4"
                    />
                    Debug overlay
                  </label>

                  <div className="space-y-2">
                    {projectSettingsActiveWarnings.map((warning) => (
                      <div
                        key={warning}
                        className="rounded border border-[var(--rds-status-warning)]/30 bg-[var(--rds-status-warning)]/10 px-3 py-2 text-[11px] text-[var(--rds-status-warning)]"
                      >
                        {warning}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded border border-[var(--rds-status-error)]/40 bg-[var(--rds-status-error)]/10 p-4 text-xs text-[var(--rds-status-error)]">
                  Configuracoes indisponiveis para o projeto ativo.
                </div>
              )}
            </div>

            {projectSettingsError ? (
              <p className="mt-3 rounded border border-[var(--rds-status-error)]/40 bg-[var(--rds-status-error)]/10 px-3 py-2 text-[11px] text-[var(--rds-status-error)]">
                {projectSettingsError}
              </p>
            ) : null}
            {projectSettingsMessage ? (
              <p className="mt-3 rounded border border-[var(--rds-status-success)]/40 bg-[var(--rds-status-success)]/10 px-3 py-2 text-[11px] text-[var(--rds-status-success)]">
                {projectSettingsMessage}
              </p>
            ) : null}

            <div className="mt-4 flex justify-end gap-2 border-t border-[var(--rds-border-subtle)] pt-3">
              <ToolbarButton
                label="Cancelar"
                onClick={() => {
                  setShowProjectSettings(false);
                  setProjectSettingsMessage("");
                  setProjectSettingsError("");
                }}
              />
              <ToolbarButton
                label={projectSettingsSaving ? "Salvando..." : "Salvar Configuracoes"}
                onClick={() => void handleSaveProjectSettings()}
                accent="primary"
                disabled={
                  projectSettingsSaving ||
                  projectSettingsLoading ||
                  !projectSettingsDraft ||
                  Boolean(projectSettingsNameError)
                }
              />
            </div>
      </Dialog>

      <Dialog
        open={showAbout}
        title="RetroDev Studio"
        description="Plataforma desktop para desenvolvimento de jogos 16-bit."
        onClose={() => setShowAbout(false)}
        portal={false}
        className="w-96"
      >
        <div className="grid gap-4">
          <p className="text-xs text-[var(--rds-text-secondary)]">Tauri 2 · React 19 · Rust</p>
          <p className="text-xs leading-5 text-[var(--rds-text-muted)]">
            Autoria, preservacao e engenharia reversa com fluxo canonico Build, ROM e Emulacao.
          </p>
          <div className="flex justify-end">
            <ToolbarButton label="Fechar" onClick={() => setShowAbout(false)} />
          </div>
        </div>
      </Dialog>

      {showCommandPalette && (
        <CommandPaletteDialog
          results={commandPaletteResults}
          query={commandPaletteQuery}
          shortcuts={shortcuts}
          onQueryChange={setCommandPaletteQuery}
          onExecute={(commandId) => {
            setShowCommandPalette(false);
            executeAppCommand(commandId);
          }}
          onClose={() => setShowCommandPalette(false)}
          isCommandDisabled={isCommandDisabled}
        />
      )}

      {showShortcutEditor && (
        <ShortcutEditorDialog
          shortcuts={shortcuts}
          conflicts={shortcutConflicts}
          onShortcutChange={updateShortcut}
          onResetShortcut={resetShortcut}
          onResetAll={resetAllShortcuts}
          onClose={() => setShowShortcutEditor(false)}
        />
      )}

      <UnifiedTopBar
        appName="RetroDev Studio"
        appTagline="Workspace adaptativo para autoria, playtest e debug."
        breadcrumbs={breadcrumbItems}
        menuSections={topBarMenuSections}
        centerContent={
          <>
            <Select
              label="Target de build"
              hideLabel
              title={`Target atual: ${getTargetLabel(activeTarget)}`}
              value={activeTarget}
              disabled={!activeProjectDir}
              onChange={(event) => void handleSwitchTarget(event.target.value as "megadrive" | "snes")}
              controlSize="sm"
              fieldClassName="shrink-0"
              className="w-[4.5rem] rounded-full text-[10px] font-bold uppercase"
            >
              <option value="megadrive">MD</option>
              <option value="snes">SNES</option>
            </Select>
            <ToolbarButton
              label="Build & Run"
              icon="play"
              onClick={() => void handleBuildAndRun()}
              disabled={building || !activeProjectDir || liveBuildBlocked}
              accent="success"
              testId="toolbar-build-run"
              title={getShortcutTitle(
                "build.run",
                liveBuildBlocked
                  ? buildDisabledReason ?? "Build & Run"
                  : buildWarningSummary ?? "Build & Run",
                shortcuts
              )}
              describedBy={liveBuildBlocked ? "build-disabled-reason" : undefined}
            />
            <ToolbarButton
              label="Play"
              icon="gamepad"
              onClick={() => void handlePlay()}
              disabled={!activeProjectDir}
            />
            <ToolbarButton
              label="Stop"
              icon="square"
              onClick={() => void handleEmulatorStop()}
              disabled={!emulatorLoaded}
              accent="danger"
            />
            <ToolbarButton
              label={emulPaused ? "Resume" : "Pause"}
              onClick={handleEmulatorPause}
              disabled={!emulatorLoaded}
            />
            {buildLiveIndicator && (
              <span
                data-testid="build-live-state"
                className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                  buildLiveIndicator.tone === "error"
                    ? "bg-[var(--rds-status-error)]/15 text-[var(--rds-status-error)]"
                    : buildLiveIndicator.tone === "warn"
                      ? "bg-[var(--rds-status-warning)]/15 text-[var(--rds-status-warning)]"
                      : buildLiveIndicator.tone === "info"
                        ? "bg-[var(--rds-status-info)]/15 text-[var(--rds-status-info)]"
                        : "bg-[var(--rds-status-success)]/15 text-[var(--rds-status-success)]"
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
                className="sr-only"
                title={buildDisabledReason}
              >
                {buildDisabledReason}
              </span>
            )}
            <ToolbarWarningBadge issues={toolbarIssues} />
            {!liveBuildBlocked &&
              !buildWarningSummary &&
              !liveBuildErrorSummary &&
              liveBuildPendingSummary && (
                <span
                  data-testid="build-live-pending-summary"
                  aria-live="polite"
                  className="max-w-52 truncate text-[10px] text-[var(--rds-status-info)]"
                  title={liveBuildPendingSummary}
                >
                  Live em analise...
                </span>
              )}
            {buildLiveIndicator?.label === "DESATUAL." && (
              <>
                <span
                  data-testid="build-stale-hint"
                  className="max-w-52 truncate text-[10px] text-[var(--rds-status-info)]"
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
            <BuildPhasePanel
              active={Boolean(activeProjectDir)}
              blocked={liveBuildBlocked}
              warning={Boolean(buildWarningSummary)}
              romMasteringStatus={romMasteringStatus}
            />
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
              label="Auto"
              icon="refresh"
              compactLabel
              onClick={applyAutomaticLayout}
              title="Ajustar paineis automaticamente"
            />
            <ToolbarButton
              label="Balanceado"
              icon="sidebar-expand"
              compactLabel
              onClick={applyBalancedLayout}
              title="Aplicar layout balanceado"
            />
            <ToolbarButton
              label={focusedShell ? "Sair do foco" : "Focus"}
              icon={focusedShell ? "sidebar-expand" : "maximize"}
              compactLabel
              onClick={toggleFocusMode}
              title={getShortcutTitle("layout.focus", "Maximizar ou restaurar a area central", shortcuts)}
            />
            <ToolbarButton
              label="Console"
              icon="terminal"
              compactLabel
              onClick={toggleConsole}
              title={getShortcutTitle("console.open", "Abrir Console", shortcuts)}
            />
          </>
        }
      />

      {!liveBuildBlocked && buildWarningSummary ? (
        <span data-testid="build-warning-summary" className="sr-only">
          {buildWarningSummary}
        </span>
      ) : null}
      {!liveBuildBlocked && liveBuildErrorSummary ? (
        <span data-testid="build-live-error-summary" className="sr-only">
          Live com falha: {liveBuildErrorSummary}
        </span>
      ) : null}

      {lastSgdkImportSummary ? (
        <SgdkImportSummaryCard summary={lastSgdkImportSummary} />
      ) : null}

      {!showProjectWizard &&
        !focusedShell &&
        workspaceGuide &&
        activeWorkspace !== "artstudio" &&
        activeWorkspace !== "retrofx" && (
        <WorkspaceGuideCard key={workspaceMeta.id} guide={workspaceGuide} />
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside
          data-testid="workspace-activity-bar"
          className="flex w-[56px] shrink-0 flex-col border-r border-[var(--rds-border-subtle)] bg-[var(--rds-surface-canvas)]"
        >
          <div className="flex flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto px-1.5 py-3">
            {WORKSPACE_GROUPS.map((group) => {
              const groupItems = WORKSPACE_ITEMS.filter((workspace) => workspace.group === group.id);
              return (
                <div
                  key={group.id}
                  data-testid={`workspace-rail-group-${group.id}`}
                  className="overflow-hidden rounded-2xl border border-[var(--rds-surface-panel-strong)] bg-[var(--rds-surface-overlay)] px-1 py-1.5"
                >
                  <p
                    className="truncate px-1 text-center text-[8px] font-semibold uppercase text-[var(--rds-border-strong)]"
                    title={group.label}
                  >
                    {group.label}
                  </p>
                  <div className="mt-1 flex flex-col items-center gap-2.5">
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
            defaultSize={shellConfig.panels.left}
            minSize={shellConfig.showLeft ? 12 : 0}
            collapsible
            className="flex flex-col overflow-hidden border-r border-[var(--rds-border-subtle)]"
          >
            {shellConfig.showLeft ? (
              <>
                <Tabs
                  tabs={[
                    { id: "scene", label: activeWorkspace === "logic" ? "Contexto" : "Cena" },
                    { id: "layers", label: "Camadas" },
                  ]}
                  activeTab={leftPanelTab}
                  onTabChange={(id) => setLeftPanelTab(id as "scene" | "layers")}
                  ariaLabel="Painel esquerdo"
                  className="shrink-0 [&>button]:flex-1 [&>button]:px-2 [&>button]:text-[10px] [&>button]:uppercase"
                />
                <div className="min-h-0 flex-1 overflow-hidden">
                  {leftPanelTab === "layers" ? <LayerPanel /> : <HierarchyPanel />}
                </div>
              </>
            ) : null}
          </Panel>
          <LayoutSplitter
            id="shell-left-splitter"
            ariaLabel="Redimensionar painel esquerdo"
            onResizeIntent={(intent) => handleShellSplitterIntent("left", intent)}
          />
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
          <LayoutSplitter
            id="shell-right-splitter"
            ariaLabel="Redimensionar painel direito"
            onResizeIntent={(intent) => handleShellSplitterIntent("right", intent)}
          />
          <Panel
            id="right"
            defaultSize={shellConfig.panels.right}
            minSize={shellConfig.showRight ? 16 : 0}
            collapsible
            className="overflow-hidden border-l border-[var(--rds-border-subtle)]"
          >
            {shellConfig.showRight ? (
            <div className="flex h-full min-h-0 flex-col bg-[var(--rds-surface-canvas)]">
              <div className="flex items-center justify-between border-b border-[var(--rds-border-subtle)] bg-[var(--rds-surface-input)] px-3 py-1.5">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--rds-text-muted)]">
                    {rightPanelMode === "tools" ? shellConfig.rightLabel : shellConfig.rightLabel}
                  </div>
                </div>
                {shellConfig.defaultRightMode !== "hidden" ? (
                  <Tabs
                    tabs={[
                      { id: "inspector", label: "Insp", ariaLabel: "Inspector" },
                      { id: "tools", label: "Tools", ariaLabel: "Ferramentas" },
                    ]}
                    activeTab={rightPanelMode}
                    onTabChange={(id) => {
                      if (id === "inspector") {
                        setRightPanelMode("inspector");
                        return;
                      }
                      openToolsWorkspace(
                        toolPanelActive === "setup" ? "palette" : toolPanelActive,
                        activeWorkspace === "debug" ? "debug" : "editing",
                        activeWorkspace === "debug" || toolPanelShowAdvanced
                      );
                    }}
                    ariaLabel="Painel direito"
                    className="shrink-0 border-b-0 [&>button]:px-2 [&>button]:text-[10px]"
                  />
                ) : null}
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
            ) : null}
          </Panel>
        </Group>
      </div>

      <ProductionStatusBar
        buildStatus={buildStatus}
        importStatus={importStatus}
        emulationStatus={emulationStatus}
        hardwareSummary={hardwareSummary}
        lastMessage={lastConsoleMessage}
        onOpenDetails={() => {
          if (!consoleVisible) {
            toggleConsole();
          }
        }}
      />
      <Console variant="drawer" />
    </div>
  );
}
