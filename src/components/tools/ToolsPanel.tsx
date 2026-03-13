import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import Panel from "../common/Panel";
import { useEditorStore } from "../../core/store/editorStore";
import type { Scene } from "../../core/ipc/sceneService";
import { emulatorReadMemory } from "../../core/ipc/emulatorService";
import {
  patchCreateIps,
  patchApplyIps,
  patchCreateBps,
  patchApplyBps,
  profilerAnalyzeRom,
  assetsExtract,
  getThirdPartyStatus,
  installThirdPartyDependency,
  listProjectAssets,
  type ProfileReport,
  type ProfileIssue,
  type DependencyStatus,
  type DependencyLogLine,
  type ThirdPartyDependencyId,
  type AssetExtractorBppMode,
  type ProjectAssetEntry,
} from "../../core/ipc/toolsService";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function browseFile(
  setter: (value: string) => void,
  opts?: {
    directory?: boolean;
    filters?: { name: string; extensions: string[] }[];
  }
) {
  const result = await open({
    multiple: false,
    directory: opts?.directory ?? false,
    filters: opts?.filters,
  });
  if (typeof result === "string") setter(result);
}

interface PathFieldProps {
  label: string;
  value: string;
  set: (value: string) => void;
  placeholder?: string;
  directory?: boolean;
  extensions?: string[];
  accentColor?: string;
}

function PathField({
  label,
  value,
  set,
  placeholder = "/caminho/para/arquivo",
  directory = false,
  extensions,
  accentColor = "cba6f7",
}: PathFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] text-[#7f849c]">{label}</label>
      <div className="flex gap-1">
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          className={`flex-1 rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1 text-xs font-mono text-[#cdd6f4] focus:outline-none focus:border-[#${accentColor}]`}
          onChange={(event) => set(event.target.value)}
        />
        <button
          onClick={() =>
            void browseFile(set, {
              directory,
              filters: extensions ? [{ name: "File", extensions }] : undefined,
            })
          }
          className="shrink-0 rounded bg-[#313244] px-2 py-1 text-xs text-[#a6adc8] transition-colors hover:bg-[#45475a]"
          title={directory ? "Selecionar pasta" : "Selecionar arquivo"}
        >
          ...
        </button>
      </div>
    </div>
  );
}

export function ExperimentalNotice({ summary }: { summary: string }) {
  return (
    <div className="rounded border border-[#fab387] bg-[#181825] p-2">
      <div className="flex items-center gap-2">
        <span className="rounded border border-[#fab387] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#fab387]">
          Experimental
        </span>
        <span className="text-[10px] leading-tight text-[#7f849c]">{summary}</span>
      </div>
    </div>
  );
}

function HeuristicNotice({ summary }: { summary: string }) {
  return (
    <div className="rounded border border-[#89b4fa] bg-[#181825] p-2 text-[10px] leading-tight text-[#89b4fa]">
      {summary}
    </div>
  );
}

function PatchStudio() {
  const { logMessage } = useEditorStore();
  const [mode, setMode] = useState<"create" | "apply">("create");
  const [format, setFormat] = useState<"ips" | "bps">("ips");
  const [pathA, setPathA] = useState("");
  const [pathB, setPathB] = useState("");
  const [pathOut, setPathOut] = useState("");
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!pathA || !pathB || !pathOut) {
      logMessage("warn", "Preencha todos os campos de caminho.");
      return;
    }

    setBusy(true);
    try {
      let result;
      if (mode === "create") {
        result =
          format === "ips"
            ? await patchCreateIps(pathA, pathB, pathOut)
            : await patchCreateBps(pathA, pathB, pathOut);
      } else {
        result =
          format === "ips"
            ? await patchApplyIps(pathA, pathB, pathOut)
            : await patchApplyBps(pathA, pathB, pathOut);
      }
      logMessage(result.ok ? "success" : "error", `[Patch] ${result.message}`);
    } catch (error) {
      logMessage("error", `[Patch] Erro inesperado: ${describeError(error)}`);
    } finally {
      setBusy(false);
    }
  }

  const labelA = mode === "create" ? "ROM Original" : "ROM Base";
  const labelB = mode === "create" ? "ROM Modificada" : "Arquivo Patch";
  const labelOut = mode === "create" ? "Salvar Patch em" : "ROM de Saida";

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex gap-2">
        {(["create", "apply"] as const).map((currentMode) => (
          <button
            key={currentMode}
            onClick={() => setMode(currentMode)}
            className={`rounded px-2 py-1 text-xs transition-colors ${mode === currentMode
              ? "bg-[#cba6f7] font-semibold text-[#1e1e2e]"
              : "bg-[#313244] text-[#a6adc8] hover:bg-[#45475a]"
              }`}
          >
            {currentMode === "create" ? "Criar Patch" : "Aplicar Patch"}
          </button>
        ))}
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

      <PathField label={labelA} value={pathA} set={setPathA} extensions={["md", "bin", "smc", "sfc"]} />
      <PathField label={labelB} value={pathB} set={setPathB} extensions={["md", "bin", "ips", "bps"]} />
      <PathField label={labelOut} value={pathOut} set={setPathOut} extensions={["md", "bin", "ips", "bps"]} />

      <button
        disabled={busy}
        onClick={() => void run()}
        className={`rounded py-1.5 text-xs font-semibold transition-colors ${busy
          ? "cursor-not-allowed bg-[#45475a] text-[#6c7086]"
          : "bg-[#cba6f7] text-[#1e1e2e] hover:bg-[#b4a0e0]"
          }`}
      >
        {busy ? "Processando..." : `${mode === "create" ? "Criar" : "Aplicar"} Patch ${format.toUpperCase()}`}
      </button>

      <p className="text-[9px] leading-tight text-[#45475a]">
        Apenas patches diferenciais. ROMs nao sao distribuidas.
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
        <PathField
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
      <PathField
        label="ROM (.md / .bin)"
        value={romPath}
        set={setRomPath}
        placeholder="/jogos/meu_jogo.md"
        extensions={["md", "bin", "gen"]}
        accentColor="a6e3a1"
      />
      <PathField
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

interface AssetBrowserProps {
  onRequestInspector?: () => void;
}

interface AssetReference {
  entityId: string;
  label: string;
}

function collectAssetReferences(scene: Scene | null): Map<string, AssetReference[]> {
  const references = new Map<string, AssetReference[]>();
  if (!scene) {
    return references;
  }

  const pushReference = (assetPath: string | undefined, entityId: string, label: string) => {
    const normalized = String(assetPath ?? "").trim();
    if (!normalized) {
      return;
    }
    const bucket = references.get(normalized) ?? [];
    bucket.push({ entityId, label });
    references.set(normalized, bucket);
  };

  for (const entity of scene.entities) {
    pushReference(
      entity.components.sprite?.asset,
      entity.entity_id,
      `Sprite · ${entity.prefab ?? entity.entity_id}`
    );
    pushReference(
      entity.components.tilemap?.tileset,
      entity.entity_id,
      `Tilemap · ${entity.prefab ?? entity.entity_id}`
    );

    const audio = entity.components.audio;
    if (audio?.bgm) {
      pushReference(audio.bgm, entity.entity_id, `BGM · ${entity.prefab ?? entity.entity_id}`);
    }
    for (const [action, assetPath] of Object.entries(audio?.sfx ?? {})) {
      pushReference(assetPath, entity.entity_id, `SFX ${action} · ${entity.prefab ?? entity.entity_id}`);
    }
  }

  for (const layer of scene.background_layers) {
    pushReference(layer.tileset, `layer::${layer.layer_id}`, `Tileset · ${layer.layer_id}`);
    pushReference(layer.tilemap, `layer::${layer.layer_id}`, `Layer map · ${layer.layer_id}`);
  }

  return references;
}

function assetPreviewUrl(asset: ProjectAssetEntry): string | null {
  if (asset.kind !== "image") {
    return null;
  }
  return convertFileSrc(asset.absolute_path);
}

function AssetBrowser({ onRequestInspector }: AssetBrowserProps) {
  const {
    activeProjectDir,
    activeScene,
    setSelectedEntityId,
    logMessage,
  } = useEditorStore();
  const [assets, setAssets] = useState<ProjectAssetEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const references = useMemo(() => collectAssetReferences(activeScene), [activeScene]);

  useEffect(() => {
    if (!activeProjectDir) {
      setAssets([]);
      setError(null);
      return;
    }

    let cancelled = false;

    async function loadAssets() {
      setBusy(true);
      try {
        const result = await listProjectAssets(activeProjectDir);
        if (!cancelled) {
          setAssets(result);
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(describeError(loadError));
        }
      } finally {
        if (!cancelled) {
          setBusy(false);
        }
      }
    }

    void loadAssets();
    return () => {
      cancelled = true;
    };
  }, [activeProjectDir]);

  function handleAssetDoubleClick(asset: ProjectAssetEntry) {
    const matches = references.get(asset.relative_path) ?? [];
    if (matches.length === 0) {
      logMessage("info", `[Assets] '${asset.relative_path}' nao esta referenciado pela cena ativa.`);
      return;
    }

    setSelectedEntityId(matches[0].entityId);
    onRequestInspector?.();
    logMessage("info", `[Assets] Selecionado no Inspector: ${matches[0].label}`);
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <ExperimentalNotice summary="Catalogo visual inicial dos assets do projeto ativo. Preview e foco no Inspector ainda estao em validacao com projeto real." />

      <div className="flex items-center justify-between rounded bg-[#1e1e2e] px-3 py-2">
        <span className="text-[10px] text-[#7f849c]">
          Projeto: <span className="font-mono text-[#cdd6f4]">{activeProjectDir || "(nenhum)"}</span>
        </span>
        <span className="text-[10px] text-[#7f849c]">
          Assets: <span className="font-mono text-[#cdd6f4]">{assets.length}</span>
        </span>
      </div>

      {busy && <p className="text-[10px] text-[#89b4fa]">Carregando catalogo de assets...</p>}
      {error && (
        <div className="rounded border border-[#f38ba8] bg-[#1e1e2e] px-3 py-2 text-[10px] text-[#f38ba8]">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {assets.map((asset) => {
          const preview = assetPreviewUrl(asset);
          const matches = references.get(asset.relative_path) ?? [];
          return (
            <button
              key={asset.relative_path}
              type="button"
              onDoubleClick={() => handleAssetDoubleClick(asset)}
              className="flex min-h-28 flex-col gap-2 rounded border border-[#313244] bg-[#1e1e2e] p-2 text-left transition-colors hover:border-[#cba6f7]"
              title={`${asset.relative_path}${matches.length > 0 ? `\nReferencias: ${matches.map((match) => match.label).join(", ")}` : ""}`}
            >
              <div className="flex h-16 items-center justify-center overflow-hidden rounded bg-[#11111b]">
                {preview ? (
                  <img src={preview} alt={asset.relative_path} className="h-full w-full object-contain" />
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
              <p className="line-clamp-2 break-all font-mono text-[10px] text-[#cdd6f4]">
                {asset.relative_path}
              </p>
            </button>
          );
        })}
      </div>

      {!busy && assets.length === 0 && (
        <p className="text-[10px] text-[#45475a]">Nenhum asset encontrado em `assets/`.</p>
      )}
    </div>
  );
}

function RuntimeSetup() {
  const { logMessage } = useEditorStore();
  const [items, setItems] = useState<DependencyStatus[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-[#cdd6f4]">Runtime Setup</span>
          <p className="text-[10px] leading-tight text-[#7f849c]">
            Instala sob demanda SGDK, PVSnesLib e cores Libretro oficiais sem versionar binarios no repositorio.
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

      <div className="rounded border border-[#313244] bg-[#11111b]">
        <div className="flex items-center gap-4 border-b border-[#313244] px-3 py-2 text-[10px] uppercase tracking-wide text-[#45475a]">
          <span className="w-20 shrink-0">Address</span>
          <span className="flex-1">Hex</span>
          <span className="w-20 shrink-0">ASCII</span>
        </div>
        <div className="max-h-72 overflow-y-auto px-3 py-2">
          {rows.length === 0 ? (
            <p className="text-[10px] text-[#45475a]">Nenhum byte carregado.</p>
          ) : (
            <div className="flex flex-col gap-1 font-mono text-[11px] text-[#cdd6f4]">
              {rows.map((row) => (
                <div key={row.address} className="flex items-start gap-4 whitespace-pre">
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

type ToolTab = "patch" | "profiler" | "extractor" | "setup" | "memory" | "assets";

const TOOL_TABS: { id: ToolTab; label: string; icon: string; experimental?: boolean }[] = [
  { id: "setup", label: "Runtime Setup", icon: "RD" },
  { id: "assets", label: "Asset Browser", icon: "AB", experimental: true },
  { id: "patch", label: "Patch Studio", icon: "PT" },
  { id: "profiler", label: "Deep Profiler", icon: "DP" },
  { id: "extractor", label: "Asset Extractor", icon: "AE" },
  { id: "memory", label: "Memory Viewer", icon: "MV" },
];

export default function ToolsPanel({ onRequestInspector }: { onRequestInspector?: () => void }) {
  const [active, setActive] = useState<ToolTab>("setup");

  return (
    <Panel title="Tools - Camada Pro" className="flex h-full flex-col">
      <div className="flex shrink-0 border-b border-[#313244]">
        {TOOL_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActive(tab.id)}
            className={`px-3 py-1.5 text-xs transition-colors ${active === tab.id ? "border-b-2 border-[#cba6f7] text-[#cdd6f4]" : "text-[#6c7086] hover:text-[#a6adc8]"
              }`}
          >
            <span>
              {tab.icon} {tab.label}
            </span>
            {tab.experimental && (
              <span className="ml-1 rounded border border-[#fab387] px-1 py-0 text-[9px] font-semibold uppercase tracking-wide text-[#fab387]">
                Experimental
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {active === "setup" && <RuntimeSetup />}
        {active === "assets" && <AssetBrowser onRequestInspector={onRequestInspector} />}
        {active === "patch" && <PatchStudio />}
        {active === "profiler" && <DeepProfiler />}
        {active === "extractor" && <AssetExtractor />}
        {active === "memory" && <MemoryViewer />}
      </div>
    </Panel>
  );
}
