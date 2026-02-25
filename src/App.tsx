import { useState } from "react";
import HierarchyPanel  from "./components/hierarchy/HierarchyPanel";
import InspectorPanel  from "./components/inspector/InspectorPanel";
import ViewportPanel   from "./components/viewport/ViewportPanel";
import Console         from "./components/common/Console";
import ToolsPanel      from "./components/tools/ToolsPanel";
import { useEditorStore } from "./core/store/editorStore";
import { buildProject } from "./core/ipc/buildService";
import { getHwStatus } from "./core/ipc/hwService";

// Placeholder: caminho do projeto ativo (Sprint 1.2+ usará diálogo de abertura)
const DEV_PROJECT_DIR = "";

export default function App() {
  const { logMessage, setHwStatus } = useEditorStore();
  const [building,   setBuilding]   = useState(false);
  const [toolsOpen,  setToolsOpen]  = useState(false);

  async function handleBuildAndRun() {
    if (!DEV_PROJECT_DIR) {
      logMessage("warn", "Nenhum projeto aberto. Use Arquivo > Abrir Projeto.");
      return;
    }

    setBuilding(true);
    logMessage("info", "Iniciando build...");

    try {
      // Atualiza painel Hardware Limits antes de compilar
      const hwStatus = await getHwStatus(DEV_PROJECT_DIR);
      setHwStatus(hwStatus);
      if (hwStatus.errors.length > 0) {
        hwStatus.errors.forEach((e) => logMessage("error", `[HW] ${e}`));
        logMessage("error", "Build bloqueado: violações de hardware. Corrija os erros acima.");
        return;
      }
      hwStatus.warnings.forEach((w) => logMessage("warn", `[HW] ${w}`));

      const result = await buildProject(DEV_PROJECT_DIR, (line) => {
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

      {/* ── Top Menu Bar ── */}
      <header className="flex items-center gap-4 px-4 h-9 bg-[#181825] border-b border-[#313244] shrink-0 select-none">
        <span className="text-sm font-bold text-[#cba6f7]">RetroDev Studio</span>
        <nav className="flex items-center gap-1 text-xs text-[#a6adc8]">
          {["Arquivo", "Editar", "Projeto", "Build", "Emulador", "Ajuda"].map((item) => (
            <button
              key={item}
              className="px-2 py-1 hover:bg-[#313244] hover:text-[#cdd6f4] rounded transition-colors"
            >
              {item}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
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
            disabled={building}
            className={[
              "px-3 py-1 text-xs font-semibold rounded transition-colors",
              building
                ? "bg-[#45475a] text-[#6c7086] cursor-not-allowed"
                : "bg-[#a6e3a1] text-[#1e1e2e] hover:bg-[#94e2a0] cursor-pointer",
            ].join(" ")}
            title={building ? "Build em andamento..." : "Build & Run (requer SGDK em toolchains/sgdk/)"}
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
