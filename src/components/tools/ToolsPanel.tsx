import { useState } from "react";
import Panel from "../common/Panel";
import { useEditorStore } from "../../core/store/editorStore";
import {
  patchCreateIps, patchApplyIps, patchCreateBps, patchApplyBps,
  profilerAnalyzeRom, assetsExtract,
  ProfileReport, ProfileIssue,
} from "../../core/ipc/toolsService";

// ── Sub-tab: ROM Patch Studio ─────────────────────────────────────────────────

function PatchStudio() {
  const { logMessage } = useEditorStore();
  const [mode,     setMode]     = useState<"create" | "apply">("create");
  const [format,   setFormat]   = useState<"ips" | "bps">("ips");
  const [pathA,    setPathA]    = useState("");
  const [pathB,    setPathB]    = useState("");
  const [pathOut,  setPathOut]  = useState("");
  const [busy,     setBusy]     = useState(false);

  async function run() {
    if (!pathA || !pathB || !pathOut) {
      logMessage("warn", "Preencha todos os campos de caminho.");
      return;
    }
    setBusy(true);
    try {
      let res;
      if (mode === "create") {
        res = format === "ips"
          ? await patchCreateIps(pathA, pathB, pathOut)
          : await patchCreateBps(pathA, pathB, pathOut);
      } else {
        res = format === "ips"
          ? await patchApplyIps(pathA, pathB, pathOut)
          : await patchApplyBps(pathA, pathB, pathOut);
      }
      logMessage(res.ok ? "success" : "error", `[Patch] ${res.message}`);
    } catch (e) {
      logMessage("error", `[Patch] Erro inesperado: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  const labelA = mode === "create" ? "ROM Original" : "ROM Base";
  const labelB = mode === "create" ? "ROM Modificada" : "Arquivo Patch";
  const labelOut = mode === "create" ? "Salvar Patch em" : "ROM de Saída";

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Mode / Format toggles */}
      <div className="flex gap-2">
        {(["create", "apply"] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)}
            className={`px-2 py-1 text-xs rounded transition-colors ${mode === m ? "bg-[#cba6f7] text-[#1e1e2e] font-semibold" : "bg-[#313244] text-[#a6adc8] hover:bg-[#45475a]"}`}>
            {m === "create" ? "Criar Patch" : "Aplicar Patch"}
          </button>
        ))}
        <div className="ml-auto flex gap-1">
          {(["ips", "bps"] as const).map((f) => (
            <button key={f} onClick={() => setFormat(f)}
              className={`px-2 py-1 text-xs rounded transition-colors uppercase ${format === f ? "bg-[#89b4fa] text-[#1e1e2e] font-semibold" : "bg-[#313244] text-[#a6adc8] hover:bg-[#45475a]"}`}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Path fields */}
      {[
        { label: labelA, value: pathA, set: setPathA },
        { label: labelB, value: pathB, set: setPathB },
        { label: labelOut, value: pathOut, set: setPathOut },
      ].map(({ label, value, set }) => (
        <div key={label} className="flex flex-col gap-1">
          <label className="text-[10px] text-[#7f849c]">{label}</label>
          <input
            type="text"
            value={value}
            placeholder="/caminho/para/arquivo"
            className="bg-[#1e1e2e] border border-[#313244] rounded px-2 py-1 text-xs text-[#cdd6f4] font-mono focus:outline-none focus:border-[#cba6f7]"
            onChange={(e) => set(e.target.value)}
          />
        </div>
      ))}

      <button
        disabled={busy}
        onClick={run}
        className={`py-1.5 text-xs font-semibold rounded transition-colors ${busy ? "bg-[#45475a] text-[#6c7086] cursor-not-allowed" : "bg-[#cba6f7] text-[#1e1e2e] hover:bg-[#b4a0e0]"}`}
      >
        {busy ? "Processando..." : `${mode === "create" ? "Criar" : "Aplicar"} Patch ${format.toUpperCase()}`}
      </button>

      <p className="text-[9px] text-[#45475a] leading-tight">
        ⚖️ Apenas patches diferenciais. ROMs não são distribuídas.
      </p>
    </div>
  );
}

// ── Sub-tab: Deep Profiler ────────────────────────────────────────────────────

const SEVERITY_COLOR: Record<string, string> = {
  Info:    "text-[#89b4fa]",
  Warning: "text-[#fab387]",
  Error:   "text-[#f38ba8]",
};

function Heatbar({ values, max, color }: { values: number[]; max: number; color: string }) {
  if (max === 0) return <div className="text-[10px] text-[#45475a]">Sem dados</div>;
  return (
    <div className="flex gap-px h-12 items-end overflow-hidden rounded">
      {values.map((v, i) => (
        <div
          key={i}
          className={`flex-1 min-w-0 ${color} opacity-80`}
          style={{ height: `${Math.round((v / max) * 100)}%` }}
          title={`Scanline ${i}: ${v}`}
        />
      ))}
    </div>
  );
}

function DeepProfiler() {
  const { logMessage } = useEditorStore();
  const [romPath, setRomPath] = useState("");
  const [report,  setReport]  = useState<ProfileReport | null>(null);
  const [busy,    setBusy]    = useState(false);

  async function analyze() {
    if (!romPath) { logMessage("warn", "Informe o caminho da ROM."); return; }
    setBusy(true);
    try {
      const r = await profilerAnalyzeRom(romPath);
      setReport(r);
      if (!r.ok) {
        logMessage("error", `[Profiler] ${r.error}`);
      } else {
        const errors = r.issues.filter((i: ProfileIssue) => i.severity === "Error").length;
        logMessage(errors > 0 ? "warn" : "success",
          `[Profiler] ${r.issues.length} ocorrência(s) — ${r.sprite_count} sprites, DMA ${Math.round(r.dma_total_bytes / 1024)}KB/frame`);
      }
    } catch (e) {
      logMessage("error", `[Profiler] Erro: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  const dmaPeak  = report ? Math.max(...report.dma_heatmap,    1) : 1;
  const sprPeak  = report ? Math.max(...report.sprite_heatmap, 1) : 1;

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex gap-2 items-end">
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-[10px] text-[#7f849c]">Caminho da ROM (.md / .bin)</label>
          <input type="text" value={romPath} placeholder="/jogos/meu_jogo.md"
            className="bg-[#1e1e2e] border border-[#313244] rounded px-2 py-1 text-xs text-[#cdd6f4] font-mono focus:outline-none focus:border-[#89b4fa]"
            onChange={(e) => setRomPath(e.target.value)} />
        </div>
        <button disabled={busy} onClick={analyze}
          className={`shrink-0 px-3 py-1.5 text-xs font-semibold rounded transition-colors ${busy ? "bg-[#45475a] text-[#6c7086] cursor-not-allowed" : "bg-[#89b4fa] text-[#1e1e2e] hover:bg-[#74a8f0]"}`}>
          {busy ? "Analisando..." : "Analisar"}
        </button>
      </div>

      {report && report.ok && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: "Sprites",    value: report.sprite_count,  sub: `peak ${report.sprite_peak}/sl` },
              { label: "DMA/frame",  value: `${Math.round(report.dma_total_bytes/1024)}KB`, sub: "budget 7.2KB" },
              { label: "Problemas",  value: report.issues.length, sub: report.issues.filter((i: ProfileIssue) => i.severity === "Error").length + " erros" },
            ].map(({ label, value, sub }) => (
              <div key={label} className="bg-[#1e1e2e] rounded p-2">
                <div className="text-xs text-[#7f849c]">{label}</div>
                <div className="text-sm font-bold text-[#cdd6f4]">{value}</div>
                <div className="text-[10px] text-[#45475a]">{sub}</div>
              </div>
            ))}
          </div>

          {/* Heatmaps */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-[#45475a]">DMA por scanline</span>
            <Heatbar values={report.dma_heatmap} max={dmaPeak} color="bg-[#89b4fa]" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-[#45475a]">Sprites por scanline</span>
            <Heatbar values={report.sprite_heatmap} max={sprPeak} color="bg-[#cba6f7]" />
          </div>

          {/* Issues */}
          <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
            {report.issues.map((issue: ProfileIssue, i: number) => (
              <p key={i} className={`text-[10px] leading-tight ${SEVERITY_COLOR[issue.severity] ?? "text-[#cdd6f4]"}`}>
                [{issue.severity}] {issue.message}
              </p>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Sub-tab: Asset Extractor ──────────────────────────────────────────────────

function AssetExtractor() {
  const { logMessage } = useEditorStore();
  const [romPath,    setRomPath]    = useState("");
  const [outputDir,  setOutputDir]  = useState("");
  const [maxTiles,   setMaxTiles]   = useState(256);
  const [palSlot,    setPalSlot]    = useState(0);
  const [busy,       setBusy]       = useState(false);
  const [lastFiles,  setLastFiles]  = useState<string[]>([]);

  async function extract() {
    if (!romPath || !outputDir) { logMessage("warn", "Informe ROM e pasta de saída."); return; }
    setBusy(true);
    try {
      const r = await assetsExtract(romPath, outputDir, maxTiles, palSlot);
      if (r.ok) {
        setLastFiles(r.files);
        logMessage("success", `[Extractor] ${r.tiles_extracted} tile(s) + ${r.palettes_extracted} paleta(s) extraídas → ${outputDir}`);
      } else {
        logMessage("error", `[Extractor] ${r.error}`);
      }
    } catch (e) {
      logMessage("error", `[Extractor] Erro: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      {[
        { label: "ROM (.md / .bin)", value: romPath,   set: setRomPath,   ph: "/jogos/meu_jogo.md" },
        { label: "Pasta de Saída",   value: outputDir, set: setOutputDir, ph: "/projetos/assets/" },
      ].map(({ label, value, set, ph }) => (
        <div key={label} className="flex flex-col gap-1">
          <label className="text-[10px] text-[#7f849c]">{label}</label>
          <input type="text" value={value} placeholder={ph}
            className="bg-[#1e1e2e] border border-[#313244] rounded px-2 py-1 text-xs text-[#cdd6f4] font-mono focus:outline-none focus:border-[#a6e3a1]"
            onChange={(e) => set(e.target.value)} />
        </div>
      ))}

      <div className="flex gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-[#7f849c]">Máx. tiles</label>
          <input type="number" value={maxTiles} min={1} max={4096} step={64}
            className="w-20 bg-[#1e1e2e] border border-[#313244] rounded px-2 py-1 text-xs text-[#cdd6f4] font-mono text-right focus:outline-none focus:border-[#a6e3a1]"
            onChange={(e) => setMaxTiles(Math.max(1, Math.trunc(Number(e.target.value))))} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-[#7f849c]">Slot de paleta</label>
          <select value={palSlot} onChange={(e) => setPalSlot(Number(e.target.value))}
            className="bg-[#1e1e2e] border border-[#313244] rounded px-2 py-1 text-xs text-[#cdd6f4] focus:outline-none focus:border-[#a6e3a1]">
            {[0,1,2,3].map((s) => <option key={s} value={s}>PAL{s}</option>)}
          </select>
        </div>
      </div>

      <button disabled={busy} onClick={extract}
        className={`py-1.5 text-xs font-semibold rounded transition-colors ${busy ? "bg-[#45475a] text-[#6c7086] cursor-not-allowed" : "bg-[#a6e3a1] text-[#1e1e2e] hover:bg-[#94e2a0]"}`}>
        {busy ? "Extraindo..." : "Extrair Assets"}
      </button>

      {lastFiles.length > 0 && (
        <div className="flex flex-col gap-0.5 max-h-28 overflow-y-auto">
          <span className="text-[10px] text-[#45475a]">Arquivos gerados:</span>
          {lastFiles.slice(0, 20).map((f, i) => (
            <p key={i} className="text-[10px] text-[#a6e3a1] font-mono truncate">{f}</p>
          ))}
          {lastFiles.length > 20 && (
            <p className="text-[10px] text-[#45475a]">…e mais {lastFiles.length - 20} arquivo(s)</p>
          )}
        </div>
      )}

      <p className="text-[9px] text-[#45475a] leading-tight">
        ⚖️ Extrai apenas da ROM fornecida. Assets de terceiros pertencem aos seus donos.
      </p>
    </div>
  );
}

// ── Main ToolsPanel ───────────────────────────────────────────────────────────

type ToolTab = "patch" | "profiler" | "extractor";

const TOOL_TABS: { id: ToolTab; label: string; icon: string }[] = [
  { id: "patch",     label: "Patch Studio", icon: "⧉" },
  { id: "profiler",  label: "Deep Profiler", icon: "⬡" },
  { id: "extractor", label: "Asset Extractor", icon: "⊡" },
];

export default function ToolsPanel() {
  const [active, setActive] = useState<ToolTab>("patch");

  return (
    <Panel title="Tools — Camada Pro" className="h-full flex flex-col">
      {/* Tab bar */}
      <div className="flex border-b border-[#313244] shrink-0">
        {TOOL_TABS.map((t) => (
          <button key={t.id} onClick={() => setActive(t.id)}
            className={`px-3 py-1.5 text-xs transition-colors ${active === t.id ? "text-[#cdd6f4] border-b-2 border-[#cba6f7]" : "text-[#6c7086] hover:text-[#a6adc8]"}`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {active === "patch"     && <PatchStudio />}
        {active === "profiler"  && <DeepProfiler />}
        {active === "extractor" && <AssetExtractor />}
      </div>
    </Panel>
  );
}
