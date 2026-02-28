import { useState, useRef, useEffect } from "react";
import HierarchyPanel  from "./components/hierarchy/HierarchyPanel";
import InspectorPanel  from "./components/inspector/InspectorPanel";
import ViewportPanel   from "./components/viewport/ViewportPanel";
import Console         from "./components/common/Console";
import ToolsPanel      from "./components/tools/ToolsPanel";
import { useEditorStore } from "./core/store/editorStore";
import { buildProject, validateProject, generateCCode } from "./core/ipc/buildService";
import { emulatorLoadRom, emulatorStop } from "./core/ipc/emulatorService";
import { getHwStatus } from "./core/ipc/hwService";
import { openProjectDialog, newProjectDialog, setProjectTarget } from "./core/ipc/projectService";
import type { Entity } from "./core/ipc/sceneService";

export default function App() {
  const {
    logMessage, setHwStatus,
    activeProjectDir, activeProjectName, setActiveProject,
    activeTarget, setActiveTarget, setActiveScene, activeViewportTab, setActiveViewportTab,
    setSelectedEntityId, selectedEntityId, emulPaused, setEmulPaused,
  } = useEditorStore();
  const [building,       setBuilding]       = useState(false);
  const [toolsOpen,      setToolsOpen]      = useState(false);
  const [menuOpen,       setMenuOpen]       = useState<string | null>(null);
  const [newProjName,    setNewProjName]    = useState("");
  const [showNewDialog,  setShowNewDialog]  = useState(false);
  const [showAbout,      setShowAbout]      = useState(false);
  const [showShortcuts,  setShowShortcuts]  = useState(false);
  const [copiedEntity,   setCopiedEntity]   = useState<Entity | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Fecha menu ao clicar fora
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(null);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  async function handleOpenProject() {
    setMenuOpen(null);
    const result = await openProjectDialog();
    if (result.selected) {
      setActiveProject(result.path, result.name);
      logMessage("success", `Projeto aberto: ${result.name} (${result.path})`);
      const hw = await getHwStatus(result.path);
      setHwStatus(hw);
      // Sincroniza target com o project.rds
      const { getSceneData } = await import("./core/ipc/sceneService");
      const sd = await getSceneData(result.path);
      if (sd.ok && (sd.target === "megadrive" || sd.target === "snes")) {
        setActiveTarget(sd.target);
      }
    }
  }

  async function handleSwitchTarget(t: "megadrive" | "snes") {
    if (!activeProjectDir || t === activeTarget) return;
    const r = await setProjectTarget(activeProjectDir, t);
    if (r.ok) {
      setActiveTarget(t);
      const hw = await getHwStatus(activeProjectDir);
      setHwStatus(hw);
      logMessage("info", `Target alterado para ${t === "megadrive" ? "Mega Drive" : "SNES"}.`);
    } else {
      logMessage("error", `[Target] ${r.message}`);
    }
  }

  function handleCloseProject() {
    setMenuOpen(null);
    setActiveProject("", "");
    setActiveScene(null);
    setHwStatus(null);
    setSelectedEntityId(null);
    logMessage("info", "Projeto fechado.");
  }

  async function handleNewProject() {
    setMenuOpen(null);
    setNewProjName("MeuProjeto");
    setShowNewDialog(true);
  }

  async function confirmNewProject() {
    setShowNewDialog(false);
    if (!newProjName.trim()) return;
    const result = await newProjectDialog(newProjName.trim());
    if (result.selected) {
      setActiveProject(result.path, result.name);
      logMessage("success", `Novo projeto criado: ${result.name} em ${result.path}`);
      // Mesmas inicializações do handleOpenProject — sem isso a Hierarchy fica vazia
      const hw = await getHwStatus(result.path);
      setHwStatus(hw);
      const { getSceneData, parseScene } = await import("./core/ipc/sceneService");
      const sd = await getSceneData(result.path);
      if (sd.ok) {
        const scene = parseScene(sd);
        if (scene) setActiveScene(scene);
        if (sd.target === "megadrive" || sd.target === "snes") setActiveTarget(sd.target);
      }
    }
  }

  async function handleEmulatorLoadRom() {
    setMenuOpen(null);
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      title: "Carregar ROM",
      filters: [{ name: "ROM", extensions: ["md", "bin", "smc", "sfc", "rom"] }],
    });
    if (!selected) return;
    const romPath = typeof selected === "string" ? selected : selected[0];
    const r = await emulatorLoadRom(romPath);
    if (r.ok) {
      logMessage("success", `ROM carregada: ${romPath}`);
      setActiveViewportTab("game");
    } else {
      logMessage("error", `[Emulador] ${r.message}`);
    }
  }

  function handleEmulatorPause() {
    setMenuOpen(null);
    // ViewportPanel reage ao emulPaused via useEffect (P18)
    setEmulPaused(!emulPaused);
    logMessage("info", emulPaused ? "Emulador retomado." : "Emulador pausado.");
  }

  async function handleEmulatorStop() {
    setMenuOpen(null);
    await emulatorStop().catch(() => {});
    setEmulPaused(false);
    setActiveViewportTab("scene");
    logMessage("info", "Emulador parado.");
  }

  async function handleValidate() {
    setMenuOpen(null);
    if (!activeProjectDir) { logMessage("warn", "Nenhum projeto aberto."); return; }
    logMessage("info", "Validando projeto...");
    const r = await validateProject(activeProjectDir);
    r.errors.forEach((e) => logMessage("error", `[Validate] ${e}`));
    r.warnings.forEach((w) => logMessage("warn", `[Validate] ${w}`));
    if (r.ok) logMessage("success", "Validação OK — nenhum erro de hardware.");
  }

  async function handleGenerateC() {
    setMenuOpen(null);
    if (!activeProjectDir) { logMessage("warn", "Nenhum projeto aberto."); return; }
    logMessage("info", "Gerando código C...");
    const r = await generateCCode(activeProjectDir);
    r.errors.forEach((e) => logMessage("error", `[CodeGen] ${e}`));
    if (r.ok) {
      logMessage("success", "Código C gerado com sucesso.");
      logMessage("info", `--- main.c ---\n${r.main_c.slice(0, 800)}${r.main_c.length > 800 ? "\n[truncado]" : ""}`);
    }
  }

  function handleCopyEntity() {
    setMenuOpen(null);
    const { activeScene, selectedEntityId } = useEditorStore.getState();
    if (!selectedEntityId || selectedEntityId.startsWith("layer::") || !activeScene) return;
    const entity = activeScene.entities.find((e) => e.entity_id === selectedEntityId);
    if (!entity) return;
    setCopiedEntity(entity);
    logMessage("info", `[Editar] Entidade copiada: ${entity.prefab ?? entity.entity_id}`);
  }

  async function handlePasteEntity() {
    setMenuOpen(null);
    if (!copiedEntity || !activeProjectDir) return;
    const { addEntity, activeScene } = useEditorStore.getState();
    const newId = `${copiedEntity.entity_id}_copy_${Date.now()}`;
    const pasted: Entity = {
      ...copiedEntity,
      entity_id: newId,
      transform: { x: copiedEntity.transform.x + 16, y: copiedEntity.transform.y + 16 },
    };
    addEntity(pasted);
    logMessage("success", `[Editar] Entidade colada: ${pasted.prefab ?? pasted.entity_id}`);
    // Auto-save
    const { saveSceneData } = await import("./core/ipc/sceneService");
    const fresh = useEditorStore.getState().activeScene ?? activeScene;
    if (fresh) await saveSceneData(activeProjectDir, JSON.stringify(fresh, null, 2));
  }

  async function handleBuildAndRun() {
    if (!activeProjectDir) {
      logMessage("warn", "Nenhum projeto aberto. Use Arquivo > Abrir Projeto.");
      return;
    }

    setBuilding(true);
    logMessage("info", "Iniciando build...");

    try {
      const hwStatus = await getHwStatus(activeProjectDir);
      setHwStatus(hwStatus);
      if (hwStatus.errors.length > 0) {
        hwStatus.errors.forEach((e) => logMessage("error", `[HW] ${e}`));
        logMessage("error", "Build bloqueado: violações de hardware. Corrija os erros acima.");
        return;
      }
      hwStatus.warnings.forEach((w) => logMessage("warn", `[HW] ${w}`));

      const result = await buildProject(activeProjectDir, (line) => {
        logMessage(line.level, line.message);
      });

      if (result.ok) {
        logMessage("success", `Build concluído! ROM: ${result.rom_path}`);
        // Carrega a ROM no emulador e navega para aba Jogo
        const loadResult = await emulatorLoadRom(result.rom_path);
        if (loadResult.ok) {
          logMessage("info", "ROM carregada no emulador. Iniciando...");
          setActiveViewportTab("game");
        } else {
          logMessage("warn", `Emulador: ${loadResult.message}`);
        }
      } else {
        logMessage("error", "Build falhou. Verifique o Console para detalhes.");
      }
    } catch (err) {
      logMessage("error", `Erro inesperado no build: ${err}`);
    } finally {
      setBuilding(false);
    }
  }

  return (
    <div className="flex flex-col w-screen h-screen bg-[#11111b] text-[#cdd6f4] overflow-hidden">

      {/* ── Modal: Novo Projeto ── */}
      {showNewDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-[#181825] border border-[#313244] rounded-lg p-5 w-72 flex flex-col gap-3 shadow-2xl">
            <h2 className="text-sm font-bold text-[#cba6f7]">Novo Projeto</h2>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-[#7f849c]">Nome do projeto</label>
              <input
                autoFocus
                type="text"
                value={newProjName}
                onChange={(e) => setNewProjName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && confirmNewProject()}
                className="bg-[#1e1e2e] border border-[#313244] rounded px-2 py-1.5 text-sm text-[#cdd6f4] focus:outline-none focus:border-[#cba6f7]"
              />
            </div>
            <p className="text-[10px] text-[#45475a]">
              Você selecionará a pasta pai. A subpasta <code className="text-[#cba6f7]">{newProjName || "..."}</code> será criada automaticamente.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowNewDialog(false)}
                className="px-3 py-1 text-xs rounded bg-[#313244] text-[#a6adc8] hover:bg-[#45475a]">
                Cancelar
              </button>
              <button onClick={confirmNewProject}
                className="px-3 py-1 text-xs rounded bg-[#cba6f7] text-[#1e1e2e] font-semibold hover:bg-[#b4a0e0]">
                Criar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Sobre ── */}
      {showAbout && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-[#181825] border border-[#313244] rounded-lg p-5 w-80 flex flex-col gap-3 shadow-2xl">
            <h2 className="text-sm font-bold text-[#cba6f7]">◈ RetroDev Studio</h2>
            <div className="flex flex-col gap-1 text-xs text-[#a6adc8]">
              <p>Versão: <span className="text-[#cdd6f4] font-mono">0.1.0</span></p>
              <p>Stack: <span className="text-[#cdd6f4] font-mono">Tauri 2 · React 19 · Rust</span></p>
              <p>Fase: <span className="text-[#cdd6f4]">Pós-MVP — Polish/QA</span></p>
            </div>
            <p className="text-[10px] text-[#45475a]">
              Plataforma desktop para desenvolvimento de jogos 16-bit (Mega Drive, SNES).
            </p>
            <button onClick={() => setShowAbout(false)}
              className="self-end px-4 py-1 text-xs rounded bg-[#313244] text-[#a6adc8] hover:bg-[#45475a]">
              Fechar
            </button>
          </div>
        </div>
      )}

      {/* ── Modal: Atalhos de Teclado ── */}
      {showShortcuts && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-[#181825] border border-[#313244] rounded-lg p-5 w-80 flex flex-col gap-3 shadow-2xl">
            <h2 className="text-sm font-bold text-[#cba6f7]">⌨ Atalhos de Teclado</h2>
            <table className="text-xs w-full">
              <tbody className="divide-y divide-[#313244]">
                {[
                  ["Ctrl+C", "Copiar entidade selecionada"],
                  ["Ctrl+V", "Colar entidade copiada"],
                  ["Delete", "Remover nó (NodeGraph)"],
                  ["Z", "Joypad A (emulador)"],
                  ["X", "Joypad B (emulador)"],
                  ["Enter", "Start (emulador)"],
                  ["Setas", "D-Pad (emulador)"],
                ].map(([key, desc]) => (
                  <tr key={key}>
                    <td className="py-1.5 pr-4 font-mono text-[#f9e2af] whitespace-nowrap">{key}</td>
                    <td className="py-1.5 text-[#a6adc8]">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button onClick={() => setShowShortcuts(false)}
              className="self-end px-4 py-1 text-xs rounded bg-[#313244] text-[#a6adc8] hover:bg-[#45475a]">
              Fechar
            </button>
          </div>
        </div>
      )}

      {/* ── Top Menu Bar ── */}
      <header className="flex items-center gap-4 px-4 h-9 bg-[#181825] border-b border-[#313244] shrink-0 select-none">
        <span className="text-sm font-bold text-[#cba6f7]">RetroDev Studio</span>

        {/* Menu com dropdown para Arquivo */}
        <nav className="flex items-center gap-1 text-xs text-[#a6adc8]" ref={menuRef}>
          {/* Arquivo — dropdown funcional */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen(menuOpen === "Arquivo" ? null : "Arquivo")}
              className={`px-2 py-1 rounded transition-colors ${menuOpen === "Arquivo" ? "bg-[#313244] text-[#cdd6f4]" : "hover:bg-[#313244] hover:text-[#cdd6f4]"}`}
            >
              Arquivo
            </button>
            {menuOpen === "Arquivo" && (
              <div className="absolute left-0 top-full mt-0.5 w-48 bg-[#1e1e2e] border border-[#313244] rounded shadow-xl z-40 py-1">
                <button onClick={handleNewProject}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-[#313244] text-[#cdd6f4] flex items-center gap-2">
                  <span className="text-[#a6e3a1]">+</span> Novo Projeto...
                </button>
                <button onClick={handleOpenProject}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-[#313244] text-[#cdd6f4] flex items-center gap-2">
                  <span className="text-[#89b4fa]">◉</span> Abrir Projeto...
                </button>
                <button
                  onClick={handleCloseProject}
                  disabled={!activeProjectDir}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-[#313244] text-[#f38ba8] flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span>✕</span> Fechar Projeto
                </button>
                <div className="border-t border-[#313244] my-1" />
                <div className="px-3 py-1 text-[10px] text-[#45475a] truncate max-w-full">
                  {activeProjectName
                    ? <>Aberto: <span className="text-[#cba6f7]">{activeProjectName}</span></>
                    : "Nenhum projeto aberto"}
                </div>
              </div>
            )}
          </div>

          {/* Menu Build — dropdown funcional */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen(menuOpen === "Build" ? null : "Build")}
              className={`px-2 py-1 rounded transition-colors ${menuOpen === "Build" ? "bg-[#313244] text-[#cdd6f4]" : "hover:bg-[#313244] hover:text-[#cdd6f4]"}`}
            >
              Build
            </button>
            {menuOpen === "Build" && (
              <div className="absolute left-0 top-full mt-0.5 w-52 bg-[#1e1e2e] border border-[#313244] rounded shadow-xl z-40 py-1">
                <button onClick={handleValidate} disabled={!activeProjectDir}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-[#313244] text-[#cdd6f4] flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed">
                  <span className="text-[#89b4fa]">✓</span> Validar Projeto
                </button>
                <button onClick={handleGenerateC} disabled={!activeProjectDir}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-[#313244] text-[#cdd6f4] flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed">
                  <span className="text-[#f9e2af]">⟨/⟩</span> Gerar Código C
                </button>
                <div className="border-t border-[#313244] my-1" />
                <button onClick={() => { setMenuOpen(null); handleBuildAndRun(); }} disabled={!activeProjectDir || building}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-[#313244] text-[#a6e3a1] flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed">
                  <span>▶</span> Build & Run
                </button>
              </div>
            )}
          </div>

          {/* Menu Emulador — dropdown funcional */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen(menuOpen === "Emulador" ? null : "Emulador")}
              className={`px-2 py-1 rounded transition-colors ${menuOpen === "Emulador" ? "bg-[#313244] text-[#cdd6f4]" : "hover:bg-[#313244] hover:text-[#cdd6f4]"}`}
            >
              Emulador
            </button>
            {menuOpen === "Emulador" && (
              <div className="absolute left-0 top-full mt-0.5 w-52 bg-[#1e1e2e] border border-[#313244] rounded shadow-xl z-40 py-1">
                <button onClick={handleEmulatorLoadRom}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-[#313244] text-[#cdd6f4] flex items-center gap-2">
                  <span className="text-[#89b4fa]">◉</span> Carregar ROM...
                </button>
                <div className="border-t border-[#313244] my-1" />
                <button onClick={handleEmulatorPause} disabled={activeViewportTab !== "game"}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-[#313244] text-[#cdd6f4] flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed">
                  <span className="text-[#f9e2af]">{emulPaused ? "▶" : "⏸"}</span>
                  {emulPaused ? "Retomar" : "Pausar"}
                </button>
                <button onClick={handleEmulatorStop} disabled={activeViewportTab !== "game"}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-[#313244] text-[#f38ba8] flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed">
                  <span>■</span> Parar
                </button>
              </div>
            )}
          </div>

          {/* Menu Editar — dropdown funcional */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen(menuOpen === "Editar" ? null : "Editar")}
              className={`px-2 py-1 rounded transition-colors ${menuOpen === "Editar" ? "bg-[#313244] text-[#cdd6f4]" : "hover:bg-[#313244] hover:text-[#cdd6f4]"}`}
            >
              Editar
            </button>
            {menuOpen === "Editar" && (
              <div className="absolute left-0 top-full mt-0.5 w-52 bg-[#1e1e2e] border border-[#313244] rounded shadow-xl z-40 py-1">
                <button
                  onClick={() => { setMenuOpen(null); logMessage("info", "[Editar] Desfazer — não implementado nesta versão."); }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-[#313244] text-[#585b70] flex items-center gap-2 cursor-not-allowed"
                >
                  <span>↩</span> Desfazer <span className="ml-auto text-[#45475a]">Ctrl+Z</span>
                </button>
                <button
                  onClick={() => { setMenuOpen(null); logMessage("info", "[Editar] Refazer — não implementado nesta versão."); }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-[#313244] text-[#585b70] flex items-center gap-2 cursor-not-allowed"
                >
                  <span>↪</span> Refazer <span className="ml-auto text-[#45475a]">Ctrl+Y</span>
                </button>
                <div className="border-t border-[#313244] my-1" />
                <button
                  onClick={handleCopyEntity}
                  disabled={!selectedEntityId || selectedEntityId.startsWith("layer::")}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-[#313244] text-[#cdd6f4] flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span className="text-[#89b4fa]">⎘</span> Copiar Entidade <span className="ml-auto text-[#45475a]">Ctrl+C</span>
                </button>
                <button
                  onClick={handlePasteEntity}
                  disabled={!copiedEntity || !activeProjectDir}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-[#313244] text-[#cdd6f4] flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span className="text-[#a6e3a1]">⎗</span> Colar Entidade <span className="ml-auto text-[#45475a]">Ctrl+V</span>
                </button>
              </div>
            )}
          </div>

          {/* Menu Projeto — dropdown funcional */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen(menuOpen === "Projeto" ? null : "Projeto")}
              className={`px-2 py-1 rounded transition-colors ${menuOpen === "Projeto" ? "bg-[#313244] text-[#cdd6f4]" : "hover:bg-[#313244] hover:text-[#cdd6f4]"}`}
            >
              Projeto
            </button>
            {menuOpen === "Projeto" && (
              <div className="absolute left-0 top-full mt-0.5 w-52 bg-[#1e1e2e] border border-[#313244] rounded shadow-xl z-40 py-1">
                <div className="px-3 py-1.5 text-[10px] text-[#45475a]">
                  {activeProjectName
                    ? <><span className="text-[#cba6f7]">{activeProjectName}</span> — {activeTarget === "megadrive" ? "Mega Drive" : "SNES"}</>
                    : "Nenhum projeto aberto"}
                </div>
                <div className="border-t border-[#313244] my-1" />
                <button
                  onClick={() => { setMenuOpen(null); handleSwitchTarget("megadrive"); }}
                  disabled={!activeProjectDir || activeTarget === "megadrive"}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-[#313244] text-[#cdd6f4] flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span className="text-[#a6e3a1]">MD</span> Mudar para Mega Drive
                </button>
                <button
                  onClick={() => { setMenuOpen(null); handleSwitchTarget("snes"); }}
                  disabled={!activeProjectDir || activeTarget === "snes"}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-[#313244] text-[#cdd6f4] flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span className="text-[#89b4fa]">SN</span> Mudar para SNES
                </button>
                <div className="border-t border-[#313244] my-1" />
                <button
                  onClick={() => { setMenuOpen(null); if (activeProjectDir) logMessage("info", `[Projeto] Dir: ${activeProjectDir}`); }}
                  disabled={!activeProjectDir}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-[#313244] text-[#cdd6f4] flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span className="text-[#f9e2af]">ℹ</span> Info no Console
                </button>
              </div>
            )}
          </div>

          {/* Menu Ajuda — dropdown funcional */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen(menuOpen === "Ajuda" ? null : "Ajuda")}
              className={`px-2 py-1 rounded transition-colors ${menuOpen === "Ajuda" ? "bg-[#313244] text-[#cdd6f4]" : "hover:bg-[#313244] hover:text-[#cdd6f4]"}`}
            >
              Ajuda
            </button>
            {menuOpen === "Ajuda" && (
              <div className="absolute left-0 top-full mt-0.5 w-56 bg-[#1e1e2e] border border-[#313244] rounded shadow-xl z-40 py-1">
                <button
                  onClick={() => { setMenuOpen(null); setShowAbout(true); }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-[#313244] text-[#cdd6f4] flex items-center gap-2"
                >
                  <span className="text-[#cba6f7]">◈</span> Sobre o RetroDev Studio
                </button>
                <button
                  onClick={() => { setMenuOpen(null); setShowShortcuts(true); }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-[#313244] text-[#cdd6f4] flex items-center gap-2"
                >
                  <span className="text-[#f9e2af]">⌨</span> Atalhos de Teclado
                </button>
                <div className="border-t border-[#313244] my-1" />
                <button
                  onClick={() => { setMenuOpen(null); logMessage("info", "RetroDev Studio v0.1.0 — Tauri 2 + React 19 + Rust 1.86"); }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-[#313244] text-[#585b70] flex items-center gap-2"
                >
                  <span>⚙</span> Versão no Console
                </button>
              </div>
            )}
          </div>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {/* Indicador do projeto ativo */}
          {activeProjectName && (
            <span className="text-[10px] text-[#45475a] max-w-32 truncate" title={activeProjectDir}>
              📁 {activeProjectName}
            </span>
          )}
          {/* Target switcher MD / SNES */}
          <div className="flex items-center gap-0.5 bg-[#181825] border border-[#313244] rounded overflow-hidden">
            {(["megadrive", "snes"] as const).map((t) => (
              <button
                key={t}
                onClick={() => handleSwitchTarget(t)}
                disabled={!activeProjectDir}
                title={
                  !activeProjectDir ? "Abra um projeto primeiro" :
                  t === "megadrive" ? "Mega Drive — 320×224, 80 sprites" :
                  "SNES — 256×224, 128 sprites"
                }
                className={[
                  "px-2 py-0.5 text-[10px] font-bold transition-colors",
                  activeTarget === t
                    ? t === "megadrive"
                      ? "bg-[#a6e3a1] text-[#1e1e2e]"
                      : "bg-[#89b4fa] text-[#1e1e2e]"
                    : "text-[#45475a] hover:text-[#a6adc8] disabled:cursor-not-allowed",
                ].join(" ")}
              >
                {t === "megadrive" ? "MD" : "SNES"}
              </button>
            ))}
          </div>
          <span className="text-[10px] text-[#45475a]">Fase 4 — Camada Pro</span>
          <button
            onClick={() => setToolsOpen((o) => !o)}
            className={`px-2 py-1 text-xs font-semibold rounded transition-colors ${toolsOpen ? "bg-[#cba6f7] text-[#1e1e2e]" : "bg-[#313244] text-[#a6adc8] hover:bg-[#45475a]"}`}
            title="Ferramentas Pro: Patch Studio, Deep Profiler, Asset Extractor"
          >
            ⧉ Tools
          </button>
          <button
            onClick={handleBuildAndRun}
            disabled={building || !activeProjectDir}
            className={[
              "px-3 py-1 text-xs font-semibold rounded transition-colors",
              building
                ? "bg-[#45475a] text-[#6c7086] cursor-not-allowed"
                : !activeProjectDir
                  ? "bg-[#313244] text-[#45475a] cursor-not-allowed"
                  : "bg-[#a6e3a1] text-[#1e1e2e] hover:bg-[#94e2a0] cursor-pointer",
            ].join(" ")}
            title={
              building ? "Build em andamento..." :
              !activeProjectDir ? "Abra um projeto primeiro (Arquivo > Abrir Projeto)" :
              "Build & Run (requer SGDK em toolchains/sgdk/)"
            }
          >
            {building ? "⏳ Building..." : "▶ Build & Run"}
          </button>
        </div>
      </header>

      {/* ── Main workspace (3 painéis) ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left: Hierarchy */}
        <aside className="w-56 shrink-0 border-r border-[#313244] overflow-hidden">
          <HierarchyPanel />
        </aside>

        {/* Center: Viewport */}
        <main className="flex-1 overflow-hidden">
          <ViewportPanel />
        </main>

        {/* Right: Inspector ou Tools (alternável) */}
        <aside className="w-64 shrink-0 border-l border-[#313244] overflow-hidden">
          {toolsOpen ? <ToolsPanel /> : <InspectorPanel />}
        </aside>

      </div>

      {/* ── Bottom: Console ── */}
      <Console />

    </div>
  );
}
