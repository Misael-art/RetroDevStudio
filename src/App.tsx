import { useState, useRef, useEffect } from "react";
import HierarchyPanel  from "./components/hierarchy/HierarchyPanel";
import InspectorPanel  from "./components/inspector/InspectorPanel";
import ViewportPanel   from "./components/viewport/ViewportPanel";
import Console         from "./components/common/Console";
import ToolsPanel      from "./components/tools/ToolsPanel";
import { useEditorStore } from "./core/store/editorStore";
import { buildProject } from "./core/ipc/buildService";
import { getHwStatus } from "./core/ipc/hwService";
import { openProjectDialog, newProjectDialog, setProjectTarget } from "./core/ipc/projectService";

export default function App() {
  const {
    logMessage, setHwStatus,
    activeProjectDir, activeProjectName, setActiveProject,
    activeTarget, setActiveTarget,
  } = useEditorStore();
  const [building,       setBuilding]       = useState(false);
  const [toolsOpen,      setToolsOpen]      = useState(false);
  const [menuOpen,       setMenuOpen]       = useState<string | null>(null);
  const [newProjName,    setNewProjName]    = useState("");
  const [showNewDialog,  setShowNewDialog]  = useState(false);
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
    }
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
                <div className="border-t border-[#313244] my-1" />
                <div className="px-3 py-1 text-[10px] text-[#45475a] truncate max-w-full">
                  {activeProjectName
                    ? <>Aberto: <span className="text-[#cba6f7]">{activeProjectName}</span></>
                    : "Nenhum projeto aberto"}
                </div>
              </div>
            )}
          </div>

          {/* Menus estáticos por enquanto */}
          {["Editar", "Projeto", "Build", "Emulador", "Ajuda"].map((item) => (
            <button
              key={item}
              className="px-2 py-1 hover:bg-[#313244] hover:text-[#cdd6f4] rounded transition-colors"
            >
              {item}
            </button>
          ))}
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
