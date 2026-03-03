import { useEffect, useRef, useState } from "react";
import Console from "./components/common/Console";
import HierarchyPanel from "./components/hierarchy/HierarchyPanel";
import InspectorPanel from "./components/inspector/InspectorPanel";
import ToolsPanel from "./components/tools/ToolsPanel";
import ViewportPanel from "./components/viewport/ViewportPanel";
import { buildProject, generateCCode, validateProject } from "./core/ipc/buildService";
import { emulatorLoadRom, emulatorStop } from "./core/ipc/emulatorService";
import { getHwStatus } from "./core/ipc/hwService";
import {
  newProjectDialog,
  openProjectDialog,
  openProjectPath,
  setProjectTarget,
} from "./core/ipc/projectService";
import {
  getSceneData,
  parseScene,
  type Entity,
} from "./core/ipc/sceneService";
import { useEditorStore } from "./core/store/editorStore";
import { persistActiveScene, reloadSceneFromDisk } from "./core/scenePersistence";
import {
  detectRomDependency,
  getThirdPartyStatus,
  installThirdPartyDependency,
  type ThirdPartyDependencyId,
} from "./core/ipc/toolsService";

function ToolbarButton({
  label,
  onClick,
  disabled = false,
  accent = "default",
  testId,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  accent?: "default" | "primary" | "success" | "danger";
  testId?: string;
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
      className={`rounded px-2 py-1 text-xs font-semibold transition-colors ${palette} disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {label}
    </button>
  );
}

type AutomationState = {
  activeProjectDir: string;
  activeProjectName: string;
  activeTarget: "megadrive" | "snes";
  activeViewportTab: string;
  consoleEntries: Array<{
    level: "info" | "warn" | "error" | "success";
    message: string;
  }>;
};

type AutomationApi = {
  openProject: (projectDir: string) => Promise<boolean>;
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
    activeProjectDir,
    activeProjectName,
    setActiveProject,
    activeTarget,
    setActiveTarget,
    setActiveScene,
    activeViewportTab,
    setActiveViewportTab,
    setSelectedEntityId,
    selectedEntityId,
    emulPaused,
    setEmulPaused,
  } = useEditorStore();

  const [building, setBuilding] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [newProjName, setNewProjName] = useState("");
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [copiedEntity, setCopiedEntity] = useState<Entity | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const tauriInternals =
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  const automationEnabled =
    typeof tauriInternals !== "undefined" ||
    import.meta.env.DEV ||
    String(import.meta.env.TAURI_ENV_DEBUG ?? "").toLowerCase() === "true" ||
    String(import.meta.env.TAURI_ENV_DEBUG ?? "") === "1" ||
    new URLSearchParams(window.location.search).has("e2e");

  useEffect(() => {
    if (showNewDialog && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [showNewDialog]);

  function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  async function hydrateProjectState(projectDir: string, projectName: string, scope: string) {
    const hw = await getHwStatus(projectDir);
    const sceneData = await getSceneData(projectDir);
    if (!sceneData.ok) {
      setActiveProject(projectDir, projectName);
      setSelectedEntityId(null);
      setHwStatus(hw);
      logMessage("warn", `[${scope}] ${sceneData.error}`);
      setActiveScene(null);
      return false;
    }

    const scene = parseScene(sceneData);
    if (!scene) {
      setActiveProject(projectDir, projectName);
      setSelectedEntityId(null);
      setHwStatus(hw);
      logMessage("error", `[${scope}] Falha ao reconstruir a cena do projeto.`);
      setActiveScene(null);
      return false;
    }

    setActiveProject(projectDir, projectName);
    setSelectedEntityId(null);
    setHwStatus(hw);
    setActiveScene(scene);
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

      setToolsOpen(true);
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
      await hydrateProjectState(result.path, result.name, "Projeto");
      logMessage("success", `Projeto aberto: ${result.name} (${result.path})`);
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
      setActiveTarget(target);
      setHwStatus(await getHwStatus(activeProjectDir));
      logMessage("info", `Target alterado para ${target === "megadrive" ? "Mega Drive" : "SNES"}.`);
    } catch (error) {
      logMessage("error", `[Target] Falha ao alterar target: ${describeError(error)}`);
    }
  }

  async function confirmNewProject() {
    setShowNewDialog(false);
    if (!newProjName.trim()) return;
    try {
      const result = await newProjectDialog(newProjName.trim());
      if (!result.selected) return;
      await hydrateProjectState(result.path, result.name, "Projeto");
      logMessage("success", `Novo projeto criado: ${result.name} em ${result.path}`);
    } catch (error) {
      logMessage("error", `[Projeto] Falha ao criar projeto: ${describeError(error)}`);
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
        if (result.message.includes("Nenhum core Libretro")) setToolsOpen(true);
        logMessage("error", `[Emulador] ${result.message}`);
        return;
      }

      logMessage("success", `ROM carregada: ${romPath}`);
      setActiveViewportTab("game");
      setEmulPaused(false);
    } catch (error) {
      logMessage("error", `[Emulador] Falha ao carregar ROM: ${describeError(error)}`);
    }
  }

  function handleEmulatorPause() {
    setEmulPaused(!emulPaused);
    logMessage("info", emulPaused ? "Emulador retomado." : "Emulador pausado.");
  }

  async function handleEmulatorStop() {
    try {
      await emulatorStop();
      setEmulPaused(false);
      setActiveViewportTab("scene");
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

  function handleCopyEntity() {
    const { activeScene, selectedEntityId: currentSelected } = useEditorStore.getState();
    if (!currentSelected || currentSelected.startsWith("layer::") || !activeScene) return;
    const entity = activeScene.entities.find((item) => item.entity_id === currentSelected);
    if (!entity) return;
    setCopiedEntity(entity);
    logMessage("info", `[Editar] Entidade copiada: ${entity.prefab ?? entity.entity_id}`);
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
        logMessage("success", `[Editar] Entidade colada: ${pasted.prefab ?? pasted.entity_id}`);
      }
    } catch (error) {
      logMessage("error", `[Editar] Falha ao colar entidade: ${describeError(error)}`);
      await reloadSceneFromDisk(activeProjectDir, "Editar");
    }
  }

  async function handleBuildAndRun() {
    if (!activeProjectDir) {
      logMessage("warn", "Nenhum projeto aberto. Use Abrir Projeto.");
      return;
    }
    if (building) {
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

    try {
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
        if (loadResult.message.includes("Nenhum core Libretro")) setToolsOpen(true);
        logMessage("error", `[Emulador] ${loadResult.message}`);
        return;
      }

      logMessage("success", "ROM carregada no emulador.");
      setEmulPaused(false);
      setActiveViewportTab("game");
    } catch (error) {
      logMessage("error", `[Build] Falha inesperada: ${describeError(error)}`);
    } finally {
      setBuilding(false);
    }
  }

  async function handleCloseProject() {
    try {
      await emulatorStop();
    } catch {
      // Closing the project should still clear the UI even if the core is already stopped.
    }

    setActiveProject("", "");
    setActiveScene(null);
    setHwStatus(null);
    setSelectedEntityId(null);
    setEmulPaused(false);
    setActiveViewportTab("scene");
    logMessage("info", "Projeto fechado.");
  }

  useEffect(() => {
    if (!automationEnabled) {
      delete window.__RDS_E2E__;
      return;
    }

    window.__RDS_E2E__ = {
      openProject: (projectDir: string) => openProjectAtPath(projectDir, "E2E"),
      getState: () => {
        const state = useEditorStore.getState();
        return {
          activeProjectDir: state.activeProjectDir,
          activeProjectName: state.activeProjectName,
          activeTarget: state.activeTarget,
          activeViewportTab: state.activeViewportTab,
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
      {showNewDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="flex w-72 flex-col gap-3 rounded-lg border border-[#313244] bg-[#181825] p-5 shadow-2xl">
            <h2 className="text-sm font-bold text-[#cba6f7]">Novo Projeto</h2>
            <input
              ref={inputRef}
              type="text"
              value={newProjName}
              onChange={(event) => setNewProjName(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && void confirmNewProject()}
              className="rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1.5 text-sm text-[#cdd6f4] focus:border-[#cba6f7] focus:outline-none"
            />
            <div className="flex justify-end gap-2">
              <ToolbarButton label="Cancelar" onClick={() => setShowNewDialog(false)} />
              <ToolbarButton label="Criar" onClick={() => void confirmNewProject()} accent="primary" />
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

      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#313244] bg-[#181825] px-4 py-2">
        <span className="mr-2 text-sm font-bold text-[#cba6f7]">RetroDev Studio</span>
        <ToolbarButton label="Novo" onClick={() => setShowNewDialog(true)} />
        <ToolbarButton label="Abrir" onClick={() => void handleOpenProject()} />
        <ToolbarButton label="Fechar" onClick={() => void handleCloseProject()} disabled={!activeProjectDir} />
        <ToolbarButton label="Validar" onClick={() => void handleValidate()} disabled={!activeProjectDir} />
        <ToolbarButton label="Gerar C" onClick={() => void handleGenerateC()} disabled={!activeProjectDir} />
        <ToolbarButton
          label="Build & Run"
          onClick={() => void handleBuildAndRun()}
          disabled={building || !activeProjectDir}
          accent="success"
          testId="toolbar-build-run"
        />
        <ToolbarButton label="Carregar ROM" onClick={() => void handleEmulatorLoadRom()} />
        <ToolbarButton label={emulPaused ? "Retomar" : "Pausar"} onClick={handleEmulatorPause} disabled={activeViewportTab !== "game"} />
        <ToolbarButton label="Parar" onClick={() => void handleEmulatorStop()} disabled={activeViewportTab !== "game"} accent="danger" />
        <ToolbarButton label="Copiar" onClick={handleCopyEntity} disabled={!selectedEntityId || selectedEntityId.startsWith("layer::")} />
        <ToolbarButton label="Colar" onClick={() => void handlePasteEntity()} disabled={!copiedEntity || !activeProjectDir} />
        <ToolbarButton label={toolsOpen ? "Inspector" : "Tools"} onClick={() => setToolsOpen((open) => !open)} accent="primary" />
        <ToolbarButton label="Sobre" onClick={() => setShowAbout(true)} />
        <ToolbarButton label="Atalhos" onClick={() => setShowShortcuts(true)} />

        <div className="ml-auto flex items-center gap-2">
          <span data-testid="active-project-name" className="max-w-36 truncate text-[10px] text-[#45475a]">
            {activeProjectName || "Sem projeto"}
          </span>
          <div className="flex overflow-hidden rounded border border-[#313244] bg-[#11111b]">
            {(["megadrive", "snes"] as const).map((target) => (
              <button
                key={target}
                onClick={() => void handleSwitchTarget(target)}
                disabled={!activeProjectDir || activeTarget === target}
                className={`px-2 py-0.5 text-[10px] font-bold ${
                  activeTarget === target
                    ? target === "megadrive"
                      ? "bg-[#a6e3a1] text-[#1e1e2e]"
                      : "bg-[#89b4fa] text-[#1e1e2e]"
                    : "text-[#45475a] disabled:cursor-not-allowed"
                }`}
              >
                {target === "megadrive" ? "MD" : "SNES"}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-56 shrink-0 overflow-hidden border-r border-[#313244]">
          <HierarchyPanel />
        </aside>
        <main className="flex-1 overflow-hidden">
          <ViewportPanel />
        </main>
        <aside className="w-64 shrink-0 overflow-hidden border-l border-[#313244]">
          {toolsOpen ? <ToolsPanel /> : <InspectorPanel />}
        </aside>
      </div>

      <Console />
    </div>
  );
}
