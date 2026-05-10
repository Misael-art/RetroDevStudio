import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import AssetPreview from "../common/AssetPreview";
import Panel from "../common/Panel";
import SceneWorkspaceNotice from "../common/SceneWorkspaceNotice";
import { useEditorStore } from "../../core/store/editorStore";
import ContextualPalette from "./ContextualPalette";
import ToolPathField from "./ToolPathField";
import { getEntityDisplayName } from "../../core/entityDisplay";
import { buildTilemapAuthoringBrush } from "../../core/entityAuthoring";
import { openProjectSourcePath } from "../../core/ipc/projectService";
import { persistActiveScene } from "../../core/scenePersistence";
import { resolveSceneWorkspaceContext } from "../../core/sceneWorkspaceContext";
import { ExperimentalNotice, HeuristicNotice } from "./ToolNotices";
import type { LegacySgdkIndex } from "../../core/ipc/sceneService";
import {
  createSpriteEntityFromAsset,
  createTilemapEntityFromAsset,
} from "../../core/editorEntityFactory";
import { classifyImageAssetInstantiation } from "../../core/assetInstantiation";
import {
  buildMultiTarget,
  type BuildLogLine,
  type MultiTargetBuildResult,
} from "../../core/ipc/buildService";
import { emulatorReadMemory } from "../../core/ipc/emulatorService";
import { decodeTilesToImageData, getActivePalette } from "./vramViewer";
import {
  patchCreateIps,
  patchCreateBps,
  profilerAnalyzeRom,
  assetsExtract,
  getThirdPartyStatus,
  installThirdPartyDependency,
  type ProfileReport,
  type ProfileIssue,
  type DependencyStatus,
  type DependencyLogLine,
  type ThirdPartyDependencyId,
  type AssetExtractorBppMode,
  type ProjectAssetEntry,
} from "../../core/ipc/toolsService";
import AssetBrowserSelectionCard from "./AssetBrowserSelectionCard";
import {
  buildAssetTree,
  collectAssetReferences,
  type AssetReference,
  type AssetTreeNode,
} from "./assetBrowserModel";
import { useAssetBrowserState } from "./useAssetBrowserState";

const LazyReverseWorkspace = lazy(() => import("./ReverseWorkspace"));

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function PatchStudio() {
  const { activeProjectDir, logMessage } = useEditorStore();
  const [format, setFormat] = useState<"ips" | "bps">("ips");
  const [pathA, setPathA] = useState("");
  const [pathB, setPathB] = useState("");
  const [pathOut, setPathOut] = useState("");
  const [busy, setBusy] = useState(false);
  const [legalAccepted, setLegalAccepted] = useState(false);

  async function run() {
    if (!pathA || !pathB || !pathOut) {
      logMessage("warn", "Preencha todos os campos de caminho.");
      return;
    }
    if (!activeProjectDir) {
      logMessage("warn", "Abra um projeto antes de exportar patches auditaveis.");
      return;
    }
    if (!legalAccepted) {
      logMessage("warn", "Confirme o aviso legal antes de exportar o patch.");
      return;
    }

    setBusy(true);
    try {
      const result =
        format === "ips"
          ? await patchCreateIps(pathA, pathB, pathOut, activeProjectDir)
          : await patchCreateBps(pathA, pathB, pathOut, activeProjectDir);
      const hashSuffix = result.patch_hash ? ` CRC32 ${result.patch_hash}` : "";
      logMessage(result.ok ? "success" : "error", `[Patch] ${result.message}${hashSuffix}`);
    } catch (error) {
      logMessage("error", `[Patch] Erro inesperado: ${describeError(error)}`);
    } finally {
      setBusy(false);
    }
  }

  const canCreate = Boolean(activeProjectDir) && legalAccepted && !busy;

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex gap-2">
        <button
          className="rounded bg-[#cba6f7] px-2 py-1 text-xs font-semibold text-[#1e1e2e]"
        >
          Criar Patch
        </button>
        <button
          disabled
          title="Aplicar ROM via Patch Studio foi desabilitado por compliance."
          className="rounded bg-[#313244] px-2 py-1 text-xs text-[#6c7086]"
        >
          Aplicar Patch Desabilitado
        </button>
        <div className="ml-auto flex gap-1">
          {(["ips", "bps"] as const).map((currentFormat) => (
            <button
              key={currentFormat}
              onClick={() => setFormat(currentFormat)}
              className={`rounded px-2 py-1 text-xs uppercase transition-colors ${format === currentFormat
                ? "bg-[#89b4fa] font-semibold text-[#1e1e2e]"
                : "bg-[#313244] text-[#a6adc8] hover:bg-[#45475a]"
                }`}
            >
              {currentFormat}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded border border-[#f38ba8] bg-[#181825] p-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#f38ba8]">
          Aviso Legal
        </p>
        <p className="mt-2 text-[10px] leading-tight text-[#bac2de]">
          O RetroDev Studio nao distribui ROMs e nao exporta copias completas neste fluxo.
          Apenas patches IPS/BPS derivados da sua ROM base sao permitidos.
        </p>
        <label className="mt-3 flex items-start gap-2 text-[10px] leading-tight text-[#cdd6f4]">
          <input
            type="checkbox"
            checked={legalAccepted}
            onChange={(event) => setLegalAccepted(event.target.checked)}
            className="mt-0.5"
          />
          <span>
            Confirmo que possuo a ROM base e que vou compartilhar apenas o patch diferencial.
          </span>
        </label>
      </div>

      <div className="rounded border border-[#313244] bg-[#11111b] px-3 py-2 text-[10px] text-[#7f849c]">
        Projeto ativo: <span className="font-mono text-[#cdd6f4]">{activeProjectDir || "(nenhum)"}</span>
      </div>

      <ToolPathField label="ROM Original" value={pathA} set={setPathA} extensions={["md", "bin", "smc", "sfc"]} />
      <ToolPathField label="ROM Modificada" value={pathB} set={setPathB} extensions={["md", "bin", "smc", "sfc"]} />
      <ToolPathField label="Salvar Patch em" value={pathOut} set={setPathOut} extensions={[format]} />

      <button
        disabled={!canCreate}
        onClick={() => void run()}
        className={`rounded py-1.5 text-xs font-semibold transition-colors ${!canCreate
          ? "cursor-not-allowed bg-[#45475a] text-[#6c7086]"
          : "bg-[#cba6f7] text-[#1e1e2e] hover:bg-[#b4a0e0]"
          }`}
      >
        {busy ? "Processando..." : `Criar Patch ${format.toUpperCase()}`}
      </button>

      <p className="text-[9px] leading-tight text-[#45475a]">
        Cada exportacao bem-sucedida registra hash e timestamp no project.rds do projeto ativo.
      </p>
    </div>
  );
}

const SEVERITY_COLOR: Record<string, string> = {
  Info: "text-[#89b4fa]",
  Warning: "text-[#fab387]",
  Error: "text-[#f38ba8]",
};

function Heatbar({ values, max, color }: { values: number[]; max: number; color: string }) {
  if (max === 0) return <div className="text-[10px] text-[#45475a]">Sem dados</div>;
  return (
    <div className="flex h-12 items-end gap-px overflow-hidden rounded">
      {values.map((value, index) => (
        <div
          key={index}
          className={`min-w-0 flex-1 ${color} opacity-80`}
          style={{ height: `${Math.round((value / max) * 100)}%` }}
          title={`Scanline ${index}: ${value}`}
        />
      ))}
    </div>
  );
}

function DeepProfiler() {
  const { logMessage } = useEditorStore();
  const [romPath, setRomPath] = useState("");
  const [report, setReport] = useState<ProfileReport | null>(null);
  const [busy, setBusy] = useState(false);

  async function analyze() {
    if (!romPath) {
      logMessage("warn", "Informe o caminho da ROM.");
      return;
    }

    setBusy(true);
    try {
      const result = await profilerAnalyzeRom(romPath);
      setReport(result);
      if (!result.ok) {
        logMessage("error", `[Profiler] ${result.error}`);
      } else {
        const errors = result.issues.filter((issue: ProfileIssue) => issue.severity === "Error").length;
        logMessage(
          errors > 0 ? "warn" : "success",
          `[Profiler] ${result.issues.length} ocorrencia(s) - ${result.sprite_count} sprites, DMA ${Math.round(result.dma_total_bytes / 1024)}KB/frame`
        );
      }
    } catch (error) {
      logMessage("error", `[Profiler] Erro: ${describeError(error)}`);
    } finally {
      setBusy(false);
    }
  }

  const dmaPeak = report ? Math.max(...report.dma_heatmap, 1) : 1;
  const spritePeak = report ? Math.max(...report.sprite_heatmap, 1) : 1;

  return (
    <div className="flex flex-col gap-3 p-3">
      <HeuristicNotice summary="Analise heuristica - resultados podem variar por ROM." />

      <div className="flex flex-col gap-2">
        <ToolPathField
          label="Caminho da ROM (.md / .bin)"
          value={romPath}
          set={setRomPath}
          placeholder="/jogos/meu_jogo.md"
          extensions={["md", "bin", "gen"]}
          accentColor="89b4fa"
        />
        <button
          disabled={busy}
          onClick={() => void analyze()}
          className={`rounded py-1.5 text-xs font-semibold transition-colors ${busy
            ? "cursor-not-allowed bg-[#45475a] text-[#6c7086]"
            : "bg-[#89b4fa] text-[#1e1e2e] hover:bg-[#74a8f0]"
            }`}
        >
          {busy ? "Analisando..." : "Analisar"}
        </button>
      </div>

      {report && report.ok && (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: "Sprites", value: report.sprite_count, sub: `peak ${report.sprite_peak}/sl` },
              { label: "DMA/frame", value: `${Math.round(report.dma_total_bytes / 1024)}KB`, sub: "budget 7.2KB" },
              {
                label: "Problemas",
                value: report.issues.length,
                sub: `${report.issues.filter((issue: ProfileIssue) => issue.severity === "Error").length} erros`,
              },
            ].map(({ label, value, sub }) => (
              <div key={label} className="rounded bg-[#1e1e2e] p-2">
                <div className="text-xs text-[#7f849c]">{label}</div>
                <div className="text-sm font-bold text-[#cdd6f4]">{value}</div>
                <div className="text-[10px] text-[#45475a]">{sub}</div>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-[#45475a]">DMA por scanline</span>
            <Heatbar values={report.dma_heatmap} max={dmaPeak} color="bg-[#89b4fa]" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-[#45475a]">Sprites por scanline</span>
            <Heatbar values={report.sprite_heatmap} max={spritePeak} color="bg-[#cba6f7]" />
          </div>

          <div className="flex max-h-32 flex-col gap-1 overflow-y-auto">
            {report.issues.map((issue: ProfileIssue, index: number) => (
              <p
                key={index}
                className={`text-[10px] leading-tight ${SEVERITY_COLOR[issue.severity] ?? "text-[#cdd6f4]"}`}
              >
                [{issue.severity}] {issue.message}
              </p>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function AssetExtractor() {
  const { logMessage } = useEditorStore();
  const [romPath, setRomPath] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [maxTiles, setMaxTiles] = useState(256);
  const [palSlot, setPalSlot] = useState(0);
  const [bppMode, setBppMode] = useState<AssetExtractorBppMode>("auto");
  const [busy, setBusy] = useState(false);
  const [lastFiles, setLastFiles] = useState<string[]>([]);

  async function extract() {
    if (!romPath || !outputDir) {
      logMessage("warn", "Informe ROM e pasta de saida.");
      return;
    }

    setBusy(true);
    try {
      const result = await assetsExtract(romPath, outputDir, maxTiles, palSlot, bppMode);
      if (result.ok) {
        setLastFiles(result.files);
        logMessage(
          "success",
          `[Extractor] ${result.tiles_extracted} tile(s) + ${result.palettes_extracted} paleta(s) extraidas (${bppMode}) -> ${outputDir}`
        );
      } else {
        logMessage("error", `[Extractor] ${result.error}`);
      }
    } catch (error) {
      logMessage("error", `[Extractor] Erro: ${describeError(error)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <ExperimentalNotice summary="Extracao heuristica de tiles e paletas direto da ROM. Excelente para exploracao rapida, mas ainda nao substitui um pipeline curado de importacao." />

      <ToolPathField
        label="ROM (.md / .bin)"
        value={romPath}
        set={setRomPath}
        placeholder="/jogos/meu_jogo.md"
        extensions={["md", "bin", "gen"]}
        accentColor="a6e3a1"
      />
      <ToolPathField
        label="Pasta de Saida"
        value={outputDir}
        set={setOutputDir}
        placeholder="/projetos/assets/"
        directory
        accentColor="a6e3a1"
      />

      <div className="flex gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-[#7f849c]">Max. tiles</label>
          <input
            type="number"
            value={maxTiles}
            min={1}
            max={4096}
            step={64}
            className="w-20 rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1 text-right text-xs font-mono text-[#cdd6f4] focus:outline-none focus:border-[#a6e3a1]"
            onChange={(event) => setMaxTiles(Math.max(1, Math.trunc(Number(event.target.value))))}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-[#7f849c]">Slot de paleta</label>
          <select
            value={palSlot}
            onChange={(event) => setPalSlot(Number(event.target.value))}
            className="rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1 text-xs text-[#cdd6f4] focus:outline-none focus:border-[#a6e3a1]"
          >
            {[0, 1, 2, 3].map((slot) => (
              <option key={slot} value={slot}>
                PAL{slot}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-[#7f849c]">BPP mode</label>
          <select
            value={bppMode}
            onChange={(event) => setBppMode(event.target.value as AssetExtractorBppMode)}
            className="rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1 text-xs text-[#cdd6f4] focus:outline-none focus:border-[#a6e3a1]"
          >
            <option value="auto">Auto</option>
            <option value="2bpp">2bpp</option>
            <option value="4bpp">4bpp</option>
          </select>
        </div>
      </div>

      <button
        disabled={busy}
        onClick={() => void extract()}
        className={`rounded py-1.5 text-xs font-semibold transition-colors ${busy
          ? "cursor-not-allowed bg-[#45475a] text-[#6c7086]"
          : "bg-[#a6e3a1] text-[#1e1e2e] hover:bg-[#94e2a0]"
          }`}
      >
        {busy ? "Extraindo..." : "Extrair Assets"}
      </button>

      {lastFiles.length > 0 && (
        <div className="flex max-h-28 flex-col gap-0.5 overflow-y-auto">
          <span className="text-[10px] text-[#45475a]">Arquivos gerados:</span>
          {lastFiles.slice(0, 20).map((file, index) => (
            <p key={index} className="truncate font-mono text-[10px] text-[#a6e3a1]">
              {file}
            </p>
          ))}
          {lastFiles.length > 20 && (
            <p className="text-[10px] text-[#45475a]">...e mais {lastFiles.length - 20} arquivo(s)</p>
          )}
        </div>
      )}

      <p className="text-[9px] leading-tight text-[#45475a]">
        Extrai apenas da ROM fornecida. Assets de terceiros pertencem aos seus donos.
      </p>
    </div>
  );
}

function LegacySgdkProjectCard({
  projectName,
  overlayDir,
  legacyIndex,
}: {
  projectName: string;
  overlayDir: string;
  legacyIndex: LegacySgdkIndex;
}) {
  const [expanded, setExpanded] = useState(false);

  const sections = [
    { id: "src", label: "Codigo C", files: legacyIndex.source_files },
    { id: "hdr", label: "Headers", files: legacyIndex.header_files },
    { id: "man", label: "Manifests", files: legacyIndex.manifest_files },
    { id: "res", label: "Recursos host", files: legacyIndex.resource_files },
    { id: "out", label: "Build host", files: legacyIndex.output_files },
  ].filter((section) => section.files.length > 0);

  const totalTrackedFiles = sections.reduce((total, section) => total + section.files.length, 0);

  return (
    <div
      data-testid="runtime-legacy-sgdk-card"
      className="flex flex-col gap-3 rounded border border-[#89b4fa]/35 bg-[#0f172a] p-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-[#89b4fa]/30 bg-[#89b4fa]/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#89b4fa]">
              SGDK legado
            </span>
            <span className="rounded-full border border-[#313244] bg-[#11111b] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#cdd6f4]">
              Overlay rds/
            </span>
          </div>
          <span className="text-xs font-semibold text-[#e5e7eb]">
            {projectName || "Projeto adotado"}
          </span>
          <p className="text-[10px] leading-tight text-[#94a3b8]">
            O codigo host continua intacto. O editor le o indice do projeto legado e usa apenas
            o overlay canonico para metadata, cena e assets importados.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="rounded border border-[#313244] bg-[#11111b] px-2 py-1 text-[10px] font-semibold text-[#cdd6f4] transition-colors hover:border-[#89b4fa] hover:text-[#89b4fa]"
        >
          {expanded ? "Ocultar indice" : "Ver indice"}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <div className="rounded border border-[#1f2937] bg-[#11111b] p-2">
          <div className="text-[9px] uppercase tracking-wide text-[#64748b]">Host root</div>
          <div className="mt-1 break-all font-mono text-[10px] text-[#cdd6f4]">
            {legacyIndex.host_root}
          </div>
        </div>
        <div className="rounded border border-[#1f2937] bg-[#11111b] p-2">
          <div className="text-[9px] uppercase tracking-wide text-[#64748b]">Overlay</div>
          <div className="mt-1 break-all font-mono text-[10px] text-[#cdd6f4]">{overlayDir}</div>
        </div>
        <div className="rounded border border-[#1f2937] bg-[#11111b] p-2">
          <div className="text-[9px] uppercase tracking-wide text-[#64748b]">Arquivos</div>
          <div className="mt-1 text-sm font-bold text-[#89b4fa]">{totalTrackedFiles}</div>
        </div>
        <div className="rounded border border-[#1f2937] bg-[#11111b] p-2">
          <div className="text-[9px] uppercase tracking-wide text-[#64748b]">Buckets</div>
          <div className="mt-1 text-sm font-bold text-[#cba6f7]">{sections.length}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 xl:grid-cols-5">
        {sections.map((section) => (
          <div
            key={section.id}
            className="rounded border border-[#1f2937] bg-[#11111b] px-2 py-1.5"
          >
            <div className="text-[9px] uppercase tracking-wide text-[#64748b]">
              {section.label}
            </div>
            <div className="mt-1 text-sm font-bold text-[#e5e7eb]">{section.files.length}</div>
          </div>
        ))}
      </div>

      {expanded && (
        <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
          {sections.map((section) => (
            <div
              key={`${section.id}-details`}
              className="rounded border border-[#1f2937] bg-[#11111b] p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#89b4fa]">
                  {section.label}
                </span>
                <span className="text-[10px] font-mono text-[#7f849c]">
                  {section.files.length} item(ns)
                </span>
              </div>
              <div className="mt-2 flex max-h-32 flex-col gap-1 overflow-y-auto">
                {section.files.slice(0, 10).map((file) => (
                  <p key={file} className="break-all font-mono text-[10px] text-[#cdd6f4]">
                    {file}
                  </p>
                ))}
                {section.files.length > 10 && (
                  <p className="text-[10px] text-[#64748b]">
                    ...e mais {section.files.length - 10} item(ns)
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface AssetBrowserProps {
  onRequestInspector?: () => void;
}

function AssetTreeView({
  node,
  collapsed,
  onToggle,
  onSelect,
  depth,
}: {
  node: AssetTreeNode;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (asset: ProjectAssetEntry) => void;
  depth: number;
}) {
  if (node.isDir) {
    const isCollapsed = collapsed.has(node.path);
    return (
      <>
        {node.name && (
          <button
            type="button"
            onClick={() => onToggle(node.path)}
            className="flex w-full items-center gap-1.5 py-0.5 text-[10px] text-[#a6adc8] transition-colors hover:text-[#cdd6f4]"
            style={{ paddingLeft: `${depth * 12 + 4}px` }}
          >
            <span className="text-[8px]">{isCollapsed ? "\u25b8" : "\u25be"}</span>
            <span className="font-semibold">{node.name}/</span>
            <span className="ml-auto font-mono text-[#45475a]">{node.fileCount}</span>
          </button>
        )}
        {!isCollapsed &&
          node.children.map((child) => (
            <AssetTreeView
              key={child.path}
              node={child}
              collapsed={collapsed}
              onToggle={onToggle}
              onSelect={onSelect}
              depth={node.name ? depth + 1 : depth}
            />
          ))}
      </>
    );
  }

  const asset = node.asset!;
  return (
    <button
      type="button"
      onClick={() => onSelect(asset)}
      className="flex min-w-0 w-full items-center gap-2 rounded py-0.5 text-left text-[10px] text-[#cdd6f4] transition-colors hover:bg-[#313244]"
      style={{ paddingLeft: `${depth * 12 + 4}px` }}
      title={asset.relative_path}
    >
      {asset.kind === "image" ? (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded bg-black/20">
          <AssetPreview
            absolutePath={asset.absolute_path}
            alt={node.name}
            imageClassName="h-6 w-6 object-contain"
            fallbackClassName="flex h-6 w-6 items-center justify-center text-[8px] font-bold text-[#89b4fa]"
            fallbackLabel="IMG"
            pixelated
          />
        </div>
      ) : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-[#313244] text-[8px] font-bold text-[#89b4fa]">
          {asset.kind === "audio" ? "A" : "F"}
        </span>
      )}
      <span className="min-w-0 truncate">{node.name}</span>
      <span className="ml-auto shrink-0 rounded bg-[#313244] px-1 py-0.5 text-[8px] uppercase text-[#7f849c]">
        {asset.kind}
      </span>
    </button>
  );
}

function AssetBrowser({ onRequestInspector }: AssetBrowserProps) {
  const {
    activeProjectDir,
    activeTarget,
    activeScene,
    activeScenePath,
    projectSourceKind,
    projectLegacyIndex,
    addEntity,
    setActiveBrush,
    setActiveTilemapId,
    setActiveWorkspace,
    setEditorMode,
    setSelectedEntityId,
    setActiveViewportTab,
    logMessage,
  } = useEditorStore();
  const [instantiatingAssetPath, setInstantiatingAssetPath] = useState<string | null>(null);
  const {
    assets,
    busy,
    error,
    viewMode,
    treeCollapsed,
    selectedTreeAsset,
    selectedLegacyFile,
    legacyPreview,
    legacyPreviewBusy,
    legacyPreviewError,
    legacySections,
    setViewMode,
    toggleTreeNode,
    selectTreeAsset,
    clearLegacyPreview,
    selectLegacyFile,
  } = useAssetBrowserState({
    activeProjectDir,
    projectSourceKind,
    projectLegacyIndex,
  });

  const references = useMemo(() => collectAssetReferences(activeScene), [activeScene]);
  const assetTree = useMemo(() => buildAssetTree(assets), [assets]);
  const selectedAssetMatches = useMemo(
    () => (selectedTreeAsset ? references.get(selectedTreeAsset.relative_path) ?? [] : []),
    [references, selectedTreeAsset]
  );
  const sceneContext = useMemo(
    () =>
      resolveSceneWorkspaceContext({
        scene: activeScene,
        scenePath: activeScenePath,
        projectSourceKind,
        projectLegacyIndex,
      }),
    [activeScene, activeScenePath, projectLegacyIndex, projectSourceKind]
  );
  const hostItemCount = useMemo(
    () => legacySections.reduce((count, section) => count + section.files.length, 0),
    [legacySections]
  );

  function handleFocusReferencedAsset(asset: ProjectAssetEntry) {
    const matches = references.get(asset.relative_path) ?? [];
    if (matches.length === 0) {
      const currentScene = useEditorStore.getState().activeScene;
      const decision =
        asset.kind === "image" && currentScene
          ? classifyImageAssetInstantiation({
              asset,
              projectSourceKind,
              sceneEntities: currentScene.entities,
            })
          : null;
      logMessage(
        "info",
        `[Assets] '${asset.relative_path}' ainda nao esta na cena ativa.${decision ? ` Use Instanciar para criar ${decision.entityLabel.toLowerCase()} (motivo: ${decision.reason}).` : ""}`
      );
      return;
    }

    setSelectedEntityId(matches[0].entityId);
    setActiveViewportTab("scene");
    onRequestInspector?.();
    logMessage("info", `[Assets] Selecionado no Inspector: ${matches[0].label}`);
  }

  function handleOpenReferenceAuthoringTarget(match: AssetReference) {
    const currentScene = useEditorStore.getState().activeScene;
    const entity = currentScene?.entities.find((candidate) => candidate.entity_id === match.entityId) ?? null;
    if (!entity) {
      logMessage("warn", `[Assets] Referencia '${match.label}' nao possui entidade carregada para abrir a autoria.`);
      return;
    }

    setSelectedEntityId(entity.entity_id);
    onRequestInspector?.();

    if (match.authoringSurface === "tilemap" && entity.components.tilemap) {
      setActiveWorkspace("scene");
      setActiveViewportTab("scene");
      setEditorMode("paint");
      setActiveTilemapId(entity.entity_id);
      const brush = buildTilemapAuthoringBrush(entity);
      if (brush) {
        setActiveBrush(brush);
      }
      logMessage(
        "info",
        `[Assets] Tilemap '${getEntityDisplayName(entity)}' aberto no fluxo de pintura da cena.`
      );
      return;
    }

    if (match.authoringSurface === "logic") {
      setActiveWorkspace("logic");
      setActiveViewportTab("logic");
      logMessage(
        "info",
        `[Assets] Navegando do Asset Browser para Logic Workspace: ${getEntityDisplayName(entity)}.`
      );
      return;
    }

    if (match.authoringSurface === "artstudio" && entity.components.sprite) {
      setActiveWorkspace("artstudio");
      setActiveViewportTab("artstudio");
      logMessage(
        "info",
        `[Assets] Navegando do Asset Browser para Art Workspace: ${getEntityDisplayName(entity)}.`
      );
      return;
    }

    setActiveWorkspace("scene");
    setActiveViewportTab("scene");
    logMessage("info", `[Assets] Referencia aberta na cena: ${match.label}.`);
  }

  async function handleOpenReferenceSource(match: AssetReference) {
    const relativePath = match.sourcePaths[0]?.trim();
    if (!activeProjectDir || !relativePath) {
      logMessage("warn", `[Assets] Fonte real indisponivel para '${match.label}'.`);
      return;
    }

    try {
      const result = await openProjectSourcePath(activeProjectDir, relativePath);
      if (!result.ok) {
        throw new Error(result.message || "Falha ao abrir fonte no host.");
      }
      logMessage("info", `[Assets] Fonte aberta a partir do Asset Browser: ${relativePath}`);
    } catch (error) {
      logMessage("error", `[Assets] Falha ao abrir fonte '${relativePath}': ${describeError(error)}`);
    }
  }

  function handleFocusSceneEntryPoint() {
    if (!sceneContext.focusEntityId) {
      logMessage("info", "[Assets] A cena ativa ainda nao possui entidade visual principal para focar.");
      return;
    }

    setSelectedEntityId(sceneContext.focusEntityId);
    setActiveViewportTab("scene");
    onRequestInspector?.();
    logMessage(
      "info",
      `[Assets] Contexto ativo reposicionado para '${sceneContext.focusEntityLabel ?? sceneContext.focusEntityId}'.`
    );
  }

  async function handleInstantiateAsset(asset: ProjectAssetEntry) {
    const { activeScene: currentScene } = useEditorStore.getState();

    if (!activeProjectDir || !currentScene) {
      logMessage("warn", "[Assets] Abra um projeto com uma cena ativa antes de instanciar sprites.");
      return;
    }

    if (asset.kind !== "image") {
      logMessage("warn", `[Assets] Apenas assets de imagem podem ser instanciados na cena: ${asset.relative_path}`);
      return;
    }

    setInstantiatingAssetPath(asset.relative_path);
    try {
      const decision = classifyImageAssetInstantiation({
        asset,
        projectSourceKind,
        sceneEntities: currentScene.entities,
      });
      const shouldInstantiateAsTilemap = decision.kind === "tilemap";
      logMessage(
        "info",
        `[Assets] Instanciacao '${asset.relative_path}': modo=${shouldInstantiateAsTilemap ? "tilemap" : "sprite"} (motivo: ${decision.reason}).`
      );
      const entity = shouldInstantiateAsTilemap
        ? createTilemapEntityFromAsset({
            assetPath: asset.relative_path,
            existingEntityIds: currentScene.entities.map((candidate) => candidate.entity_id),
          })
        : createSpriteEntityFromAsset({
            assetPath: asset.relative_path,
            target: activeTarget,
            existingEntityIds: currentScene.entities.map((candidate) => candidate.entity_id),
            includeStarterLogic:
              currentScene.entities.length === 0 && currentScene.background_layers.length === 0,
          });

      addEntity(entity);
      setSelectedEntityId(entity.entity_id);
      setActiveViewportTab("scene");
      onRequestInspector?.();

      const saved = await persistActiveScene(
        activeProjectDir,
        "Assets",
        `${decision.entityLabel} '${getEntityDisplayName(entity)}' instanciado a partir de '${asset.relative_path}'.`
      );
      if (!saved) {
        return;
      }
      logMessage(
        "info",
        `[Assets] '${asset.relative_path}' -> ${decision.entityLabel}. ${decision.nextStep} (motivo: ${decision.reason}).`
      );
    } catch (instantiationError) {
      logMessage("error", `[Assets] Falha ao instanciar '${asset.relative_path}': ${describeError(instantiationError)}`);
    } finally {
      setInstantiatingAssetPath(null);
    }
  }

  return (
    <div className="flex min-h-0 flex-col gap-2 overflow-x-hidden p-3">
      <ExperimentalNotice
        compact
        summary="Catalogo visual dos assets. Duplo clique foca referencias ou instancia imagens na cena."
      />

      <SceneWorkspaceNotice
        context={sceneContext}
        testId="asset-browser-scene-notice"
        actions={
          <>
            <button
              type="button"
              onClick={handleFocusSceneEntryPoint}
              disabled={!sceneContext.focusEntityId}
              className="rounded border border-[#313244] bg-[#11111b] px-2 py-1 text-[10px] font-semibold text-[#cdd6f4] transition-colors hover:border-[#89b4fa] hover:text-[#89b4fa] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Focar entidade guia
            </button>
            <button
              type="button"
              onClick={() => onRequestInspector?.()}
              className="rounded border border-[#313244] bg-[#11111b] px-2 py-1 text-[10px] font-semibold text-[#cdd6f4] transition-colors hover:border-[#cba6f7] hover:text-[#cba6f7]"
            >
              Abrir Inspector
            </button>
          </>
        }
      />

      <div className="flex shrink-0 items-center justify-between gap-2 overflow-hidden rounded bg-[#1e1e2e] px-3 py-2">
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[#7f849c]">
            Catalogo do projeto
          </p>
          <p className="truncate text-[10px] text-[#cdd6f4]" title={activeProjectDir || "(nenhum)"}>
            {assets.length} asset(s) canonico(s)
            {hostItemCount > 0 ? ` + ${hostItemCount} arquivo(s) host` : ""}
          </p>
          <p className="truncate text-[10px] text-[#6c7086]" title={activeProjectDir || "(nenhum)"}>
            {activeProjectDir || "(nenhum)"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5">
            {(["tree", "grid"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase transition-colors ${
                  viewMode === mode
                    ? "bg-[#cba6f7]/20 text-[#cba6f7]"
                    : "text-[#6c7086] hover:text-[#a6adc8]"
                }`}
              >
                {mode === "tree" ? "\u25e6" : "\u25a6"} {mode}
              </button>
            ))}
          </div>
        </div>
      </div>

      {busy && <p className="text-[10px] text-[#89b4fa]">Carregando catalogo de assets...</p>}
      {error && (
        <div className="rounded border border-[#f38ba8] bg-[#1e1e2e] px-3 py-2 text-[10px] text-[#f38ba8]">
          {error}
        </div>
      )}

      {viewMode === "tree" && (assets.length > 0 || legacySections.length > 0) && (
        <div className="scrollbar-thin min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden rounded border border-[#313244] bg-[#11111b] p-2">
          {assets.length > 0 && (
            <div className="flex flex-col gap-1 pb-3">
              <div className="px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#89b4fa]">
                Assets canonicos
              </div>
              <AssetTreeView
                node={assetTree}
                collapsed={treeCollapsed}
                onToggle={toggleTreeNode}
                onSelect={(asset) => {
                  selectTreeAsset(asset);
                  const matches = references.get(asset.relative_path) ?? [];
                  if (matches.length > 0) {
                    setSelectedEntityId(matches[0].entityId);
                  }
                }}
                depth={0}
              />
            </div>
          )}

          {legacySections.length > 0 && (
            <div className="flex flex-col gap-3 border-t border-[#1f2937] pt-3">
              <div className="flex flex-col gap-1 px-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#f9e2af]">
                  Projeto host SGDK
                </span>
                <p className="text-[10px] leading-tight text-[#94a3b8]">
                  Navegacao somente leitura dos arquivos mapeados pelo overlay legado.
                </p>
              </div>
              {legacySections.map((section) => (
                <div
                  key={`legacy-${section.id}`}
                  className="rounded border border-[#1f2937] bg-[#0f172a]/30 p-2"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#f9e2af]">
                      {section.label}
                    </span>
                    <span className="font-mono text-[10px] text-[#7f849c]">
                      {section.files.length} item(ns)
                    </span>
                  </div>
                  <div className="flex max-h-28 flex-col gap-1 overflow-y-auto">
                    {section.files.map((file) => (
                      <button
                        key={file}
                        type="button"
                        onClick={() => void selectLegacyFile(file)}
                        className={`rounded px-2 py-1 text-left font-mono text-[10px] transition-colors ${
                          selectedLegacyFile === file
                            ? "bg-[#f9e2af]/10 text-[#f9e2af]"
                            : "text-[#cdd6f4] hover:bg-[#313244]"
                        }`}
                        title={file}
                      >
                        {file}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {viewMode === "tree" && selectedTreeAsset && (
        <AssetBrowserSelectionCard
          activeProjectDir={activeProjectDir}
          asset={selectedTreeAsset}
          matches={selectedAssetMatches}
          projectSourceKind={projectSourceKind}
          sceneEntities={activeScene?.entities ?? []}
          canInstantiate={Boolean(activeProjectDir && activeScene)}
          instantiating={instantiatingAssetPath === selectedTreeAsset.relative_path}
          onFocus={() => handleFocusReferencedAsset(selectedTreeAsset)}
          onOpenAuthoringTarget={handleOpenReferenceAuthoringTarget}
          onOpenSource={(match) => void handleOpenReferenceSource(match)}
          onInstantiate={() => void handleInstantiateAsset(selectedTreeAsset)}
        />
      )}

      {viewMode === "tree" && selectedLegacyFile && (
        <div
          data-testid="legacy-file-preview"
          className="flex flex-col gap-2 rounded border border-[#f9e2af]/30 bg-[#1e1e2e] p-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p
                className="min-w-0 truncate font-mono text-[10px] text-[#f9e2af]"
                title={selectedLegacyFile}
              >
                {selectedLegacyFile}
              </p>
              <p className="text-[10px] text-[#94a3b8]">
                Arquivo legado do host SGDK. Visualizacao somente leitura.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={clearLegacyPreview}
                className="rounded border border-[#313244] bg-[#11111b] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#a6adc8] transition-colors hover:text-[#cdd6f4]"
              >
                Fechar
              </button>
              <span className="rounded border border-[#313244] bg-[#11111b] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#f9e2af]">
                Read-only
              </span>
            </div>
          </div>

          {legacyPreviewBusy && (
            <p className="text-[10px] text-[#89b4fa]">Carregando preview do arquivo legado...</p>
          )}

          {legacyPreviewError && (
            <div className="rounded border border-[#f38ba8] bg-[#11111b] px-3 py-2 text-[10px] text-[#f38ba8]">
              {legacyPreviewError}
            </div>
          )}

          {legacyPreview && (
            <>
              <p className="break-all font-mono text-[10px] text-[#7f849c]">
                {legacyPreview.absolute_path}
              </p>
              <p className="text-[10px] text-[#94a3b8]">{legacyPreview.note}</p>
              <pre className="scrollbar-thin max-h-48 overflow-auto rounded border border-[#1f2937] bg-[#11111b] p-3 text-[10px] leading-relaxed text-[#cdd6f4]">
                {legacyPreview.content}
              </pre>
            </>
          )}
        </div>
      )}

      {viewMode === "grid" && (
        <div className="scrollbar-thin min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="grid grid-cols-2 gap-2 p-2">
        {assets.map((asset) => {
          const matches = references.get(asset.relative_path) ?? [];
          const canInstantiate = asset.kind === "image" && Boolean(activeProjectDir && activeScene);
          const isInstantiating = instantiatingAssetPath === asset.relative_path;
          return (
            <div
              key={asset.relative_path}
              onDoubleClick={() => {
                if (asset.kind === "image" && matches.length === 0) {
                  void handleInstantiateAsset(asset);
                  return;
                }
                if (matches[0]?.authoringSurface) {
                  handleOpenReferenceAuthoringTarget(matches[0]);
                  return;
                }
                handleFocusReferencedAsset(asset);
              }}
              className="flex min-h-28 flex-col gap-2 rounded border border-[#313244] bg-[#1e1e2e] p-2 text-left transition-colors hover:border-[#cba6f7]"
              title={`${asset.relative_path}${matches.length > 0 ? `\nReferencias: ${matches.map((match) => match.label).join(", ")}` : ""}`}
            >
              <div className="flex h-16 w-full shrink-0 items-center justify-center overflow-hidden rounded bg-black/20">
                {asset.kind === "image" ? (
                  <AssetPreview
                    absolutePath={asset.absolute_path}
                    alt={asset.relative_path}
                    imageClassName="h-14 w-14 object-contain"
                    fallbackClassName="flex h-14 w-14 items-center justify-center text-[8px] font-bold text-[#89b4fa]"
                    fallbackLabel="IMG"
                    pixelated
                  />
                ) : (
                  <span className="text-lg font-bold text-[#89b4fa]">
                    {asset.kind === "audio" ? "AUD" : "FILE"}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="rounded bg-[#313244] px-1.5 py-0.5 text-[9px] uppercase text-[#a6adc8]">
                  {asset.kind}
                </span>
                {matches.length > 0 && (
                  <span className="text-[9px] text-[#a6e3a1]">{matches.length} ref.</span>
                )}
              </div>
              <p className="min-w-0 truncate font-mono text-[10px] text-[#cdd6f4]" title={asset.relative_path}>
                {asset.relative_path}
              </p>
              <div className="mt-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleFocusReferencedAsset(asset)}
                  className="rounded border border-[#313244] bg-[#11111b] px-2 py-1 text-[10px] font-semibold text-[#cdd6f4] transition-colors hover:border-[#cba6f7] hover:text-[#cba6f7]"
                >
                  {matches.length > 0 ? "Focar" : "Detalhes"}
                </button>
                {asset.kind === "image" && (
                  <button
                  type="button"
                  onClick={() => void handleInstantiateAsset(asset)}
                  onDoubleClick={(event) => event.stopPropagation()}
                  disabled={!canInstantiate || isInstantiating}
                  className="rounded border border-[#89b4fa]/40 bg-[#89b4fa]/10 px-2 py-1 text-[10px] font-semibold text-[#89b4fa] transition-colors hover:bg-[#89b4fa]/20 disabled:cursor-not-allowed disabled:opacity-40"
                  title={
                    canInstantiate
                      ? "Criar um sprite ou tilemap na cena ativa usando a regra canonica do editor."
                      : "Abra uma cena ativa para instanciar assets."
                  }
                >
                  {isInstantiating ? "Criando..." : "Instanciar"}
                </button>
              )}
              </div>
            </div>
          );
        })}
        </div>
        </div>
      )}

      {!busy && assets.length === 0 && legacySections.length === 0 && (
        <p className="text-[10px] text-[#45475a]">Nenhum asset encontrado em `assets/`.</p>
      )}
    </div>
  );
}

function RuntimeSetup() {
  const {
    activeProjectDir,
    activeProjectName,
    projectSourceKind,
    projectLegacyIndex,
    logMessage,
  } = useEditorStore();
  const [items, setItems] = useState<DependencyStatus[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [multiBuildBusy, setMultiBuildBusy] = useState(false);
  const [multiBuildReport, setMultiBuildReport] = useState<MultiTargetBuildResult | null>(null);

  async function refreshStatus() {
    setLoading(true);
    try {
      const report = await getThirdPartyStatus();
      setItems(report.items);
    } catch (error) {
      logMessage("error", `[Setup] Falha ao consultar dependencias: ${describeError(error)}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshStatus();
  }, []);

  async function ensureDependencies(
    dependencyIds: ThirdPartyDependencyId[],
    reason: string,
    logPrefix: string
  ) {
    try {
      const report = await getThirdPartyStatus();
      setItems(report.items);

      const missing = report.items.filter(
        (item) => dependencyIds.includes(item.id as ThirdPartyDependencyId) && !item.installed
      );
      if (missing.length === 0) {
        return true;
      }

      const summary = missing
        .map((item) => `- ${item.label}: ${item.issues[0] ?? item.install_dir}`)
        .join("\n");
      const confirmed = window.confirm(
        `${reason}\n\nDependencias ausentes:\n${summary}\n\nInstalar automaticamente agora?`
      );
      if (!confirmed) {
        logMessage("warn", `${logPrefix} Operacao cancelada: dependencias externas pendentes.`);
        return false;
      }

      for (const item of missing) {
        setBusyId(item.id);
        logMessage("info", `${logPrefix} Instalando ${item.label}...`);
        try {
          const result = await installThirdPartyDependency(item.id, (line: DependencyLogLine) => {
            logMessage(line.level, `[Setup] ${line.message}`);
          });
          if (!result.ok) {
            logMessage("error", `${logPrefix} ${result.message}`);
            return false;
          }
        } finally {
          setBusyId(null);
        }
      }

      await refreshStatus();
      return true;
    } catch (error) {
      logMessage("error", `${logPrefix} ${describeError(error)}`);
      return false;
    }
  }

  async function install(dependencyId: ThirdPartyDependencyId | string, label: string) {
    const confirmed = window.confirm(
      `Instalar ${label} agora? O download sera feito do upstream oficial e gravado apenas no ambiente local.`
    );
    if (!confirmed) return;

    setBusyId(dependencyId);
    try {
      const result = await installThirdPartyDependency(dependencyId, (line: DependencyLogLine) => {
        logMessage(line.level, `[Setup] ${line.message}`);
      });
      logMessage(result.ok ? "success" : "error", `[Setup] ${result.message}`);
      await refreshStatus();
    } catch (error) {
      logMessage("error", `[Setup] Falha inesperada ao instalar ${label}: ${describeError(error)}`);
    } finally {
      setBusyId(null);
    }
  }

  async function runBuildAllTargets() {
    if (!activeProjectDir) {
      logMessage("warn", "[Build All] Abra um projeto antes de iniciar o build multi-target.");
      return;
    }

    const dependenciesReady = await ensureDependencies(
      ["jdk", "sgdk", "pvsneslib"],
      "Build multi-target requer JDK, SGDK e PVSnesLib configurados no ambiente local.",
      "[Build All]"
    );
    if (!dependenciesReady) {
      return;
    }

    setMultiBuildBusy(true);
    try {
      const report = await buildMultiTarget(
        activeProjectDir,
        ["megadrive", "snes"],
        (line: BuildLogLine) => {
          logMessage(line.level, `[Build All] ${line.message}`);
        }
      );
      setMultiBuildReport(report);
      logMessage(
        report.ok ? "success" : "warn",
        `[Build All] ${report.results.filter((entry) => entry.ok).length}/${report.results.length} target(s) concluidos.`
      );
    } catch (error) {
      logMessage("error", `[Build All] Falha inesperada: ${describeError(error)}`);
    } finally {
      setMultiBuildBusy(false);
    }
  }

  function formatBytes(value: number): string {
    if (value <= 0) {
      return "0 B";
    }
    if (value < 1024) {
      return `${value} B`;
    }
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-[#cdd6f4]">Runtime Setup</span>
          <p className="text-[10px] leading-tight text-[#7f849c]">
            Instala sob demanda JDK (Temurin LTS), SGDK, PVSnesLib e cores Libretro oficiais sem versionar binarios no repositorio.
          </p>
        </div>
        <button
          onClick={() => void refreshStatus()}
          disabled={loading || busyId !== null}
          className="rounded bg-[#313244] px-2 py-1 text-[10px] text-[#a6adc8] hover:bg-[#45475a] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "Atualizando..." : "Atualizar"}
        </button>
      </div>

      {projectSourceKind === "external_sgdk" && projectLegacyIndex && (
        <LegacySgdkProjectCard
          projectName={activeProjectName}
          overlayDir={activeProjectDir}
          legacyIndex={projectLegacyIndex}
        />
      )}

      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <div key={item.id} className="flex flex-col gap-2 rounded border border-[#313244] bg-[#1e1e2e] p-2">
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-bold ${item.installed ? "text-[#a6e3a1]" : "text-[#f9e2af]"}`}>
                {item.installed ? "INSTALADO" : "PENDENTE"}
              </span>
              <span className="text-xs text-[#cdd6f4]">{item.label}</span>
              {item.version && <span className="ml-auto font-mono text-[10px] text-[#7f849c]">{item.version}</span>}
            </div>

            <p className="break-all font-mono text-[10px] text-[#45475a]">{item.install_dir}</p>

            {item.notes.slice(0, 2).map((note, index) => (
              <p key={index} className="text-[10px] leading-tight text-[#89b4fa]">
                {note}
              </p>
            ))}

            {item.issues.map((issue, index) => (
              <p key={index} className="text-[10px] leading-tight text-[#fab387]">
                {issue}
              </p>
            ))}

            <div className="flex items-center justify-between gap-3">
              <a
                href={item.source_url}
                target="_blank"
                rel="noreferrer"
                className="text-[10px] text-[#89b4fa] hover:text-[#b4befe]"
              >
                Fonte oficial
              </a>
              <button
                onClick={() => install(item.id, item.label)}
                disabled={!item.auto_install_supported || busyId !== null}
                className={`rounded px-2 py-1 text-[10px] font-semibold transition-colors ${busyId === item.id
                  ? "cursor-not-allowed bg-[#45475a] text-[#6c7086]"
                  : item.auto_install_supported
                    ? "bg-[#a6e3a1] text-[#1e1e2e] hover:bg-[#94e2a0]"
                    : "cursor-not-allowed bg-[#313244] text-[#6c7086]"
                  }`}
              >
                {busyId === item.id ? "Instalando..." : "Instalar / Reinstalar"}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3 rounded border border-[#313244] bg-[#11111b] p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-[#cdd6f4]">Multi-Target Build</span>
            <p className="text-[10px] leading-tight text-[#7f849c]">
              Compila Mega Drive e SNES em sequencia sem alterar o target salvo do projeto.
            </p>
          </div>
          <button
            onClick={() => void runBuildAllTargets()}
            disabled={!activeProjectDir || multiBuildBusy || loading || busyId !== null}
            className={`rounded px-3 py-1.5 text-[10px] font-semibold transition-colors ${
              !activeProjectDir || multiBuildBusy || loading || busyId !== null
                ? "cursor-not-allowed bg-[#45475a] text-[#6c7086]"
                : "bg-[#89b4fa] text-[#1e1e2e] hover:bg-[#74a8f0]"
            }`}
          >
            {multiBuildBusy ? "Compilando..." : "Build All Targets"}
          </button>
        </div>

        <p className="text-[10px] text-[#45475a]">
          Projeto ativo: <span className="font-mono text-[#cdd6f4]">{activeProjectDir || "(nenhum)"}</span>
        </p>

        {multiBuildReport && (
          <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
            {multiBuildReport.results.map((entry) => (
              <div key={entry.target} className="flex flex-col gap-2 rounded border border-[#313244] bg-[#1e1e2e] p-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase text-[#cdd6f4]">{entry.target}</span>
                  <span className={`text-[10px] font-bold ${entry.ok ? "text-[#a6e3a1]" : "text-[#f38ba8]"}`}>
                    {entry.ok ? "OK" : "FALHOU"}
                  </span>
                  <span className="ml-auto text-[10px] text-[#7f849c]">{formatBytes(entry.rom_size_bytes)}</span>
                </div>

                <p className="break-all font-mono text-[10px] text-[#7f849c]">
                  {entry.rom_path || "Sem ROM gerada"}
                </p>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded bg-[#11111b] p-2">
                    <div className="text-[9px] uppercase tracking-wide text-[#45475a]">Warnings</div>
                    <div className="text-sm font-bold text-[#fab387]">{entry.warnings.length}</div>
                  </div>
                  <div className="rounded bg-[#11111b] p-2">
                    <div className="text-[9px] uppercase tracking-wide text-[#45475a]">Errors</div>
                    <div className="text-sm font-bold text-[#f38ba8]">{entry.errors.length}</div>
                  </div>
                  <div className="rounded bg-[#11111b] p-2">
                    <div className="text-[9px] uppercase tracking-wide text-[#45475a]">Logs</div>
                    <div className="text-sm font-bold text-[#89b4fa]">{entry.log.length}</div>
                  </div>
                </div>

                {entry.warnings.length > 0 && (
                  <div className="flex max-h-20 flex-col gap-1 overflow-y-auto rounded bg-[#11111b] p-2">
                    {entry.warnings.map((warning, index) => (
                      <p key={`${entry.target}-warn-${index}`} className="text-[10px] leading-tight text-[#fab387]">
                        {warning}
                      </p>
                    ))}
                  </div>
                )}

                {entry.errors.length > 0 && (
                  <div className="flex max-h-20 flex-col gap-1 overflow-y-auto rounded bg-[#11111b] p-2">
                    {entry.errors.map((error, index) => (
                      <p key={`${entry.target}-error-${index}`} className="text-[10px] leading-tight text-[#f38ba8]">
                        {error}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-[9px] leading-tight text-[#45475a]">
        Componentes de terceiros sao baixados apenas sob consentimento do usuario. O projeto nao redistribui ROMs comerciais.
      </p>
    </div>
  );
}

const MEMORY_REGIONS = [
  { value: 2, label: "WRAM" },
  { value: 3, label: "VRAM" },
  { value: 0, label: "SRAM" },
] as const;

function parseHexInput(value: string): number | null {
  const normalized = value.trim().replace(/^0x/i, "");
  if (normalized.length === 0) return 0;
  if (!/^[0-9a-f]+$/i.test(normalized)) return null;
  return Number.parseInt(normalized, 16);
}

function formatHex(value: number, width = 2): string {
  return value.toString(16).toUpperCase().padStart(width, "0");
}

function formatAscii(value: number): string {
  return value >= 32 && value <= 126 ? String.fromCharCode(value) : ".";
}

function parseSearchToBytes(query: string): number[] | null {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const hexMatch = trimmed.match(/^[0-9a-fA-F\s]+$/);
  if (hexMatch) {
    const hexParts = trimmed.split(/\s+/).filter(Boolean);
    const bytes: number[] = [];
    for (const part of hexParts) {
      if (part.length === 1) {
        const n = parseInt(part, 16);
        if (Number.isNaN(n)) return null;
        bytes.push(n);
      } else if (part.length === 2) {
        const n = parseInt(part, 16);
        if (Number.isNaN(n)) return null;
        bytes.push(n);
      } else {
        for (let i = 0; i < part.length; i += 2) {
          const n = parseInt(part.slice(i, i + 2), 16);
          if (Number.isNaN(n)) return null;
          bytes.push(n);
        }
      }
    }
    return bytes.length > 0 ? bytes : null;
  }

  return [...trimmed].map((c) => c.charCodeAt(0) & 0xff);
}

function MemoryViewer() {
  const { logMessage } = useEditorStore();
  const [region, setRegion] = useState<number>(2);
  const [offsetHex, setOffsetHex] = useState("0000");
  const [lengthHex, setLengthHex] = useState("0100");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<number[]>([]);
  const [totalSize, setTotalSize] = useState(0);
  const [lastOffset, setLastOffset] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightRowIndex, setHighlightRowIndex] = useState<number | null>(null);
  const [lastSearchFrom, setLastSearchFrom] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const rowRefsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const inFlightRef = useRef(false);

  async function readMemory(silent = false) {
    if (inFlightRef.current) return;

    const offset = parseHexInput(offsetHex);
    const length = parseHexInput(lengthHex);
    if (offset === null || length === null) {
      const message = "Use valores hexadecimais validos para offset e length.";
      setError(message);
      if (!silent) {
        logMessage("warn", `[Memory] ${message}`);
      }
      return;
    }

    inFlightRef.current = true;
    setBusy(true);
    try {
      const result = await emulatorReadMemory(region, offset, length);
      const regionLabel =
        MEMORY_REGIONS.find((candidate) => candidate.value === region)?.label ?? `REGIAO ${region}`;
      setData(result.data);
      setTotalSize(result.total_size);
      setLastOffset(offset);
      setLastSearchFrom(0);
      setHighlightRowIndex(null);
      setError(null);
      if (!silent) {
        logMessage(
          "info",
          `[Memory] ${result.data.length} byte(s) lidos de ${regionLabel} @ 0x${formatHex(offset, 4)}.`
        );
      }
    } catch (readError) {
      const message = describeError(readError);
      setError(message);
      if (!silent) {
        logMessage("error", `[Memory] ${message}`);
      }
    } finally {
      setBusy(false);
      inFlightRef.current = false;
    }
  }

  useEffect(() => {
    if (!autoRefresh) return;

    void readMemory(true);
    const intervalId = window.setInterval(() => {
      void readMemory(true);
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [autoRefresh, region, offsetHex, lengthHex]);

  function findNextMatch(): number | null {
    const pattern = parseSearchToBytes(searchQuery);
    if (!pattern || pattern.length === 0 || data.length === 0) return null;

    for (let i = lastSearchFrom; i <= data.length - pattern.length; i += 1) {
      let match = true;
      for (let j = 0; j < pattern.length; j += 1) {
        if (data[i + j] !== pattern[j]) {
          match = false;
          break;
        }
      }
      if (match) return i;
    }
    for (let i = 0; i < lastSearchFrom && i <= data.length - pattern.length; i += 1) {
      let match = true;
      for (let j = 0; j < pattern.length; j += 1) {
        if (data[i + j] !== pattern[j]) {
          match = false;
          break;
        }
      }
      if (match) return i;
    }
    return null;
  }

  function handleSearchNext() {
    const pattern = parseSearchToBytes(searchQuery);
    if (!pattern || pattern.length === 0) {
      logMessage("warn", "[Memory] Digite um valor hex (ex: FF 00) ou texto para buscar.");
      return;
    }
    const found = findNextMatch();
    if (found === null) {
      setHighlightRowIndex(null);
      logMessage("info", "[Memory] Padrao nao encontrado.");
      return;
    }
    const rowIndex = Math.floor(found / 16);
    setHighlightRowIndex(rowIndex);
    setLastSearchFrom(found + 1);
    const rowEl = rowRefsRef.current.get(rowIndex);
    rowEl?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    logMessage("info", `[Memory] Encontrado em offset 0x${formatHex(lastOffset + found, 4)}.`);
  }

  const rows: { address: string; bytes: string; ascii: string }[] = [];
  for (let index = 0; index < data.length; index += 16) {
    const slice = data.slice(index, index + 16);
    const bytes = slice.map((value) => formatHex(value)).join(" ");
    const paddedBytes = bytes.padEnd(16 * 3 - 1, " ");
    const ascii = slice.map((value) => formatAscii(value)).join("");
    rows.push({
      address: formatHex(lastOffset + index, 8),
      bytes: paddedBytes,
      ascii,
    });
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <ExperimentalNotice summary="Leitor bruto de memoria do core ativo. Util para inspecao e debugging, mas a navegacao ainda e de baixo nivel e sujeita ao estado do emulador." />

      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-[#7f849c]">Regiao</label>
          <select
            value={region}
            onChange={(event) => setRegion(Number(event.target.value))}
            className="rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1 text-xs text-[#cdd6f4] focus:border-[#f9e2af] focus:outline-none"
          >
            {MEMORY_REGIONS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-[#7f849c]">Offset (hex)</label>
          <input
            type="text"
            value={offsetHex}
            onChange={(event) => setOffsetHex(event.target.value)}
            className="w-24 rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1 text-xs font-mono text-[#cdd6f4] focus:border-[#f9e2af] focus:outline-none"
            placeholder="0000"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-[#7f849c]">Length (hex)</label>
          <input
            type="text"
            value={lengthHex}
            onChange={(event) => setLengthHex(event.target.value)}
            className="w-24 rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1 text-xs font-mono text-[#cdd6f4] focus:border-[#f9e2af] focus:outline-none"
            placeholder="0100"
          />
        </div>

        <label className="mt-5 flex items-center gap-2 text-[10px] text-[#7f849c]">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(event) => setAutoRefresh(event.target.checked)}
            className="rounded border border-[#313244] bg-[#1e1e2e]"
          />
          Auto-refresh (1s)
        </label>

        <button
          disabled={busy}
          onClick={() => void readMemory()}
          className={`mt-4 rounded px-3 py-1.5 text-xs font-semibold transition-colors ${busy
            ? "cursor-not-allowed bg-[#45475a] text-[#6c7086]"
            : "bg-[#f9e2af] text-[#1e1e2e] hover:bg-[#e7cf96]"
            }`}
        >
          {busy ? "Lendo..." : "Ler"}
        </button>
      </div>

      <div className="flex items-center justify-between rounded bg-[#1e1e2e] px-3 py-2">
        <span className="text-[10px] text-[#7f849c]">
          Total: <span className="font-mono text-[#cdd6f4]">0x{formatHex(totalSize, 4)}</span> ({totalSize} bytes)
        </span>
        <span className="text-[10px] text-[#7f849c]">
          Ultimo offset: <span className="font-mono text-[#cdd6f4]">0x{formatHex(lastOffset, 4)}</span>
        </span>
      </div>

      {error && (
        <div className="rounded border border-[#f38ba8] bg-[#1e1e2e] px-3 py-2 text-[10px] text-[#f38ba8]">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2 border-b border-[#313244] pb-2">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-[#7f849c]">Buscar Hex...</label>
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleSearchNext();
              }
            }}
            placeholder="Buscar Hex..."
            className="w-40 rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1 text-xs font-mono text-[#cdd6f4] focus:border-[#f9e2af] focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={handleSearchNext}
          disabled={data.length === 0 || busy}
          className="rounded border border-[#89b4fa]/40 bg-[#89b4fa]/10 px-2 py-1 text-[10px] font-semibold text-[#89b4fa] transition-colors hover:bg-[#89b4fa]/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Procurar Proximo
        </button>
      </div>

      <div className="rounded border border-[#313244] bg-[#11111b]">
        <div className="flex items-center gap-4 border-b border-[#313244] px-3 py-2 text-[10px] uppercase tracking-wide text-[#45475a]">
          <span className="w-20 shrink-0">Address</span>
          <span className="flex-1">Hex</span>
          <span className="w-20 shrink-0">ASCII</span>
        </div>
        <div ref={scrollContainerRef} className="max-h-72 overflow-y-auto px-3 py-2">
          {rows.length === 0 ? (
            <p className="text-[10px] text-[#45475a]">Nenhum byte carregado.</p>
          ) : (
            <div className="flex flex-col gap-1 font-mono text-[11px] text-[#cdd6f4]">
              {rows.map((row, rowIndex) => (
                <div
                  key={row.address}
                  ref={(el) => {
                    if (el) rowRefsRef.current.set(rowIndex, el);
                  }}
                  className={`flex items-start gap-4 whitespace-pre rounded px-1 py-0.5 ${
                    highlightRowIndex === rowIndex ? "bg-[#f9e2af]/25 ring-1 ring-[#f9e2af]/60" : ""
                  }`}
                >
                  <span className="w-20 shrink-0 text-[#f9e2af]">{row.address}</span>
                  <span className="flex-1 text-[#a6e3a1]">{row.bytes}</span>
                  <span className="w-20 shrink-0 text-[#89b4fa]">{row.ascii}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function VramViewer() {
  const { logMessage, activeScene, activeTarget } = useEditorStore();
  const [offsetHex, setOffsetHex] = useState("0000");
  const [lengthHex, setLengthHex] = useState("1000");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [tileScale, setTileScale] = useState<8 | 16>(16);
  const [paletteSlot, setPaletteSlot] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<number[]>([]);
  const [totalSize, setTotalSize] = useState(0);
  const [lastOffset, setLastOffset] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inFlightRef = useRef(false);

  const scenePaletteSlots = useMemo(
    () => [...(activeScene?.palettes ?? [])].map((entry) => entry.slot).sort((left, right) => left - right),
    [activeScene]
  );
  const activePalette = useMemo(
    () => getActivePalette(activeScene, activeTarget, paletteSlot),
    [activeScene, activeTarget, paletteSlot]
  );
  const tileCount = Math.floor(data.length / 32);
  const tilesPerRow = 16;
  const rowCount = Math.max(Math.ceil(Math.max(tileCount, 1) / tilesPerRow), 1);

  async function readVram(silent = false) {
    if (inFlightRef.current) return;

    const offset = parseHexInput(offsetHex);
    const length = parseHexInput(lengthHex);
    if (offset === null || length === null) {
      const message = "Use valores hexadecimais validos para offset e length.";
      setError(message);
      if (!silent) {
        logMessage("warn", `[VRAM] ${message}`);
      }
      return;
    }

    inFlightRef.current = true;
    setBusy(true);
    try {
      const result = await emulatorReadMemory(3, offset, length);
      setData(result.data);
      setTotalSize(result.total_size);
      setLastOffset(offset);
      setError(null);
      if (!silent) {
        logMessage(
          "info",
          `[VRAM] ${result.data.length} byte(s) lidos de VRAM @ 0x${formatHex(offset, 4)}.`
        );
      }
    } catch (readError) {
      const message = describeError(readError);
      setError(message);
      if (!silent) {
        logMessage("error", `[VRAM] ${message}`);
      }
    } finally {
      setBusy(false);
      inFlightRef.current = false;
    }
  }

  useEffect(() => {
    if (!autoRefresh) return;

    void readVram(true);
    const intervalId = window.setInterval(() => {
      void readVram(true);
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [autoRefresh, offsetHex, lengthHex]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length === 0) {
      return;
    }

    const imageData = decodeTilesToImageData(data, activePalette, tilesPerRow);
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const frame = context.createImageData(imageData.width, imageData.height);
    frame.data.set(imageData.data);
    context.putImageData(frame, 0, 0);
  }, [activePalette, data]);

  return (
    <div className="flex flex-col gap-3 p-3">
      <ExperimentalNotice summary="Visualizador de tiles brutos da VRAM do core ativo. Usa leitura real via Libretro e decodificacao 4bpp para inspecao rapida." />

      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-[#7f849c]">Offset (hex)</label>
          <input
            type="text"
            value={offsetHex}
            onChange={(event) => setOffsetHex(event.target.value)}
            className="w-24 rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1 text-xs font-mono text-[#cdd6f4] focus:border-[#89b4fa] focus:outline-none"
            placeholder="0000"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-[#7f849c]">Length (hex)</label>
          <input
            type="text"
            value={lengthHex}
            onChange={(event) => setLengthHex(event.target.value)}
            className="w-24 rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1 text-xs font-mono text-[#cdd6f4] focus:border-[#89b4fa] focus:outline-none"
            placeholder="1000"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-[#7f849c]">Zoom</label>
          <select
            value={tileScale}
            onChange={(event) => setTileScale(Number(event.target.value) as 8 | 16)}
            className="rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1 text-xs text-[#cdd6f4] focus:border-[#89b4fa] focus:outline-none"
          >
            <option value={8}>8x</option>
            <option value={16}>16x</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-[#7f849c]">Paleta</label>
          <select
            value={paletteSlot}
            onChange={(event) => setPaletteSlot(Number(event.target.value))}
            className="rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1 text-xs text-[#cdd6f4] focus:border-[#89b4fa] focus:outline-none"
          >
            {(scenePaletteSlots.length > 0 ? scenePaletteSlots : [0]).map((slot) => (
              <option key={slot} value={slot}>
                PAL{slot}
              </option>
            ))}
          </select>
        </div>

        <label className="mt-5 flex items-center gap-2 text-[10px] text-[#7f849c]">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(event) => setAutoRefresh(event.target.checked)}
            className="rounded border border-[#313244] bg-[#1e1e2e]"
          />
          Auto-refresh (1s)
        </label>

        <button
          disabled={busy}
          onClick={() => void readVram()}
          className={`mt-4 rounded px-3 py-1.5 text-xs font-semibold transition-colors ${busy
            ? "cursor-not-allowed bg-[#45475a] text-[#6c7086]"
            : "bg-[#89b4fa] text-[#1e1e2e] hover:bg-[#74a8f0]"
            }`}
        >
          {busy ? "Lendo..." : "Ler VRAM"}
        </button>
      </div>

      <div className="flex items-center justify-between rounded bg-[#1e1e2e] px-3 py-2">
        <span className="text-[10px] text-[#7f849c]">
          Total: <span className="font-mono text-[#cdd6f4]">0x{formatHex(totalSize, 4)}</span> ({totalSize} bytes)
        </span>
        <span className="text-[10px] text-[#7f849c]">
          Tiles: <span className="font-mono text-[#cdd6f4]">{tileCount}</span>
        </span>
        <span className="text-[10px] text-[#7f849c]">
          Ultimo offset: <span className="font-mono text-[#cdd6f4]">0x{formatHex(lastOffset, 4)}</span>
        </span>
      </div>

      {error && (
        <div className="rounded border border-[#f38ba8] bg-[#1e1e2e] px-3 py-2 text-[10px] text-[#f38ba8]">
          {error}
        </div>
      )}

      <div className="rounded border border-[#313244] bg-[#11111b] p-3">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wide text-[#45475a]">
            Grid {tilesPerRow}x{rowCount} · 8x8 · 4bpp
          </span>
          <div className="flex items-center gap-1">
            {activePalette.slice(0, 8).map((color) => (
              <span
                key={color}
                className="h-3 w-3 rounded border border-[#313244]"
                style={{ backgroundColor: color }}
                title={color}
              />
            ))}
          </div>
        </div>

        {data.length === 0 ? (
          <p className="text-[10px] text-[#45475a]">Nenhum tile carregado.</p>
        ) : (
          <div className="overflow-auto">
            <canvas
              ref={canvasRef}
              data-testid="tools-vram-canvas"
              className="border border-[#313244] bg-black"
              style={{
                imageRendering: "pixelated",
                width: tilesPerRow * tileScale,
                height: rowCount * tileScale,
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export type ToolTab =
  | "patch"
  | "profiler"
  | "extractor"
  | "setup"
  | "memory"
  | "assets"
  | "vram"
  | "reverse"
  | "palette";

type ToolCategory = "create" | "configure" | "analyze" | "experimental";
export type ToolWorkspace = "editing" | "debug";

type ToolDescriptor = {
  id: ToolTab;
  label: string;
  icon: string;
  category: ToolCategory;
  description: string;
  advanced?: boolean;
  experimental?: boolean;
};

const TOOL_CATEGORIES: {
  id: ToolCategory;
  label: string;
  caption: string;
}[] = [
  { id: "create", label: "Create", caption: "autoria e montagem" },
  { id: "configure", label: "Configure", caption: "setup e saida" },
  { id: "analyze", label: "Analyze", caption: "debug e leitura tecnica" },
  { id: "experimental", label: "Experimental", caption: "superficies em hardening" },
];

const TOOL_TABS: ToolDescriptor[] = [
  {
    id: "palette",
    label: "Paleta Contextual",
    icon: "CR",
    category: "create",
    description: "Brushes e assets de autoria contextual para a cena ativa.",
  },
  {
    id: "setup",
    label: "Runtime Setup",
    icon: "RD",
    category: "configure",
    description: "Dependencias oficiais, toolchains e estado do runtime.",
  },
  {
    id: "patch",
    label: "Patch Studio",
    icon: "PT",
    category: "configure",
    description: "Criacao auditavel de patches IPS/BPS sem poluir o fluxo principal.",
  },
  {
    id: "profiler",
    label: "Deep Profiler",
    icon: "DP",
    category: "analyze",
    description: "Analise heuristica de sprites, DMA e hotspots de ROM.",
    advanced: true,
  },
  {
    id: "assets",
    label: "Asset Browser",
    icon: "AB",
    category: "experimental",
    description: "Navegacao e instancia de assets reais do projeto.",
    advanced: true,
    experimental: true,
  },
  {
    id: "extractor",
    label: "Asset Extractor",
    icon: "AE",
    category: "experimental",
    description: "Extracao heuristica de tiles e paletas direto da ROM.",
    advanced: true,
    experimental: true,
  },
  {
    id: "memory",
    label: "Memory Viewer",
    icon: "MV",
    category: "experimental",
    description: "Inspecao de memoria do core ativo com busca e highlight.",
    advanced: true,
    experimental: true,
  },
  {
    id: "vram",
    label: "VRAM Viewer",
    icon: "VV",
    category: "experimental",
    description: "Leitura de tiles 4bpp da VRAM para debug visual rapido.",
    advanced: true,
    experimental: true,
  },
  {
    id: "reverse",
    label: "Reverse Workspace",
    icon: "RX",
    category: "experimental",
    description: "Manifesto reverso, mapa estrutural, hex/disassembly e candidatos de GFX/TXT/AUD por ROM.",
    advanced: true,
    experimental: true,
  },
];

function getToolDescriptor(toolId: ToolTab): ToolDescriptor {
  return TOOL_TABS.find((tool) => tool.id === toolId) ?? TOOL_TABS[0];
}

function renderToolPanel(
  active: ToolTab,
  onRequestInspector?: () => void
) {
  switch (active) {
    case "setup":
      return <RuntimeSetup />;
    case "palette":
      return <ContextualPalette />;
    case "assets":
      return <AssetBrowser onRequestInspector={onRequestInspector} />;
    case "patch":
      return <PatchStudio />;
    case "profiler":
      return <DeepProfiler />;
    case "extractor":
      return <AssetExtractor />;
    case "memory":
      return <MemoryViewer />;
    case "vram":
      return <VramViewer />;
    case "reverse":
      return (
        <Suspense
          fallback={
            <div className="p-3 text-[12px] text-[#94a3b8]">
              Carregando Reverse Workspace...
            </div>
          }
        >
          <LazyReverseWorkspace />
        </Suspense>
      );
    default:
      return null;
  }
}

export default function ToolsPanel({
  onRequestInspector,
  initialActive = "setup",
  workspace = "editing",
  showAdvancedByDefault = false,
}: {
  onRequestInspector?: () => void;
  initialActive?: ToolTab;
  workspace?: ToolWorkspace;
  showAdvancedByDefault?: boolean;
}) {
  const [showAdvanced, setShowAdvanced] = useState(showAdvancedByDefault);
  const [activeCategory, setActiveCategory] = useState<ToolCategory>(() =>
    getToolDescriptor(initialActive).category
  );
  const [active, setActive] = useState<ToolTab>(initialActive);

  useEffect(() => {
    setShowAdvanced(showAdvancedByDefault || workspace === "debug");
  }, [showAdvancedByDefault, workspace]);

  useEffect(() => {
    const nextDescriptor = getToolDescriptor(initialActive);
    setActive(initialActive);
    setActiveCategory(nextDescriptor.category);
  }, [initialActive]);

  const visibleTools = TOOL_TABS.filter((tool) => showAdvanced || !tool.advanced);
  const safeActive = visibleTools.some((tool) => tool.id === active)
    ? active
    : visibleTools[0]?.id ?? "setup";
  const activeDescriptor = getToolDescriptor(safeActive);
  const toolsInCategory = visibleTools.filter((tool) => tool.category === activeCategory);
  const fallbackCategory =
    toolsInCategory.length > 0
      ? activeCategory
      : TOOL_CATEGORIES.find((category) =>
          visibleTools.some((tool) => tool.category === category.id)
        )?.id ?? "create";
  useEffect(() => {
    if (safeActive !== active) {
      setActive(safeActive);
    }
  }, [active, safeActive]);

  useEffect(() => {
    if (fallbackCategory !== activeCategory) {
      setActiveCategory(fallbackCategory);
    }
  }, [activeCategory, fallbackCategory]);

  return (
    <Panel
      title={workspace === "debug" ? "Debug Workspace" : "Tools Workspace"}
      className="flex h-full flex-col bg-[#11131f]"
      headerActions={
        <>
          <button
            type="button"
            onClick={() => setShowAdvanced((current) => !current)}
            className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] transition-colors ${
              showAdvanced
                ? "border-[#f9e2af]/40 bg-[#f9e2af]/12 text-[#f9e2af]"
                : "border-[#313244] bg-[#11111b] text-[#7f849c] hover:text-[#cdd6f4]"
            }`}
          >
            {showAdvanced ? "Avancado ON" : "Avancado OFF"}
          </button>
          {onRequestInspector && (
            <button
              type="button"
              onClick={onRequestInspector}
              className="rounded-full border border-[#313244] bg-[#11111b] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#cdd6f4] transition-colors hover:border-[#89b4fa] hover:text-[#89b4fa]"
            >
              Inspector
            </button>
          )}
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col xl:flex-row">
        <aside className="flex w-full shrink-0 flex-col border-b border-[#1f2937] bg-[#0b1020] xl:w-[230px] xl:border-b-0 xl:border-r">
          <div className="border-b border-[#1f2937] px-4 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#cba6f7]">
              {workspace === "debug" ? "Modo avancado" : "Modo basico"}
            </div>
            <div className="mt-2 text-[12px] leading-5 text-[#94a3b8]">
              {workspace === "debug"
                ? "Ferramentas de leitura, runtime e analise ficam em destaque."
                : "Mostre apenas o que faz sentido para autoria. Ferramentas tecnicas ficam fora do caminho por padrao."}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-3">
            <div className="space-y-3">
              {TOOL_CATEGORIES.filter((category) =>
                visibleTools.some((tool) => tool.category === category.id)
              ).map((category) => {
                const isActiveCategory = fallbackCategory === category.id;
                const categoryTools = visibleTools.filter(
                  (tool) => tool.category === category.id
                );

                return (
                  <div
                    key={category.id}
                    className={`rounded-2xl border p-2 ${
                      isActiveCategory
                        ? "border-[#313244] bg-[#131a2a]"
                        : "border-transparent bg-transparent"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setActiveCategory(category.id)}
                      className={`flex w-full items-start justify-between rounded-xl px-2 py-2 text-left transition-colors ${
                        isActiveCategory
                          ? "bg-[#1b2334] text-[#e5e7eb]"
                          : "text-[#94a3b8] hover:bg-[#131a2a] hover:text-[#e5e7eb]"
                      }`}
                    >
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                          {category.label}
                        </div>
                        <div className="mt-1 text-[11px] text-[#64748b]">
                          {category.caption}
                        </div>
                      </div>
                      <span className="rounded-full border border-[#313244] bg-[#0b1020] px-2 py-0.5 text-[10px] font-mono text-[#cdd6f4]">
                        {categoryTools.length}
                      </span>
                    </button>

                    {isActiveCategory && (
                      <div className="mt-2 space-y-1">
                        {categoryTools.map((tool) => (
                          <button
                            key={tool.id}
                            type="button"
                            onClick={() => setActive(tool.id)}
                            className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                              safeActive === tool.id
                                ? "bg-[#cba6f7] text-[#111827]"
                                : "bg-[#111827] text-[#cdd6f4] hover:bg-[#1f2937]"
                            }`}
                          >
                            <span className="flex items-center gap-3">
                              <span className="rounded-lg border border-current/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]">
                                {tool.icon}
                              </span>
                              <span className="min-w-0 truncate">{tool.label}</span>
                            </span>
                            {tool.experimental && (
                              <span
                                className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] ${
                                  safeActive === tool.id
                                    ? "bg-[#111827]/14 text-[#111827]"
                                    : "bg-[#fab387]/12 text-[#fab387]"
                                }`}
                              >
                                Exp
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="border-b border-[#1f2937] bg-[#0f172a] px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#7dd3fc]">
                  {fallbackCategory === "create"
                    ? "Create"
                    : fallbackCategory === "configure"
                      ? "Configure"
                      : fallbackCategory === "analyze"
                        ? "Analyze"
                        : "Experimental"}
                </div>
                <div className="mt-1 text-lg font-semibold text-[#e5e7eb]">
                  {activeDescriptor.label}
                </div>
                <div className="mt-2 max-w-2xl text-[12px] leading-6 text-[#94a3b8]">
                  {activeDescriptor.description}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full border border-[#313244] bg-[#11111b] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#cdd6f4]">
                  {workspace === "debug" ? "Debug" : "Editing"}
                </span>
                {activeDescriptor.experimental && (
                  <span className="rounded-full border border-[#fab387]/40 bg-[#fab387]/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#fab387]">
                    Experimental
                  </span>
                )}
                {activeDescriptor.advanced && (
                  <span className="rounded-full border border-[#89b4fa]/35 bg-[#89b4fa]/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#89b4fa]">
                    Analise
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto bg-[#11111b]">
            {renderToolPanel(safeActive, onRequestInspector)}
          </div>
        </div>
      </div>
    </Panel>
  );
}
