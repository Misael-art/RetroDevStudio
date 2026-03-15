import { useEffect, useState } from "react";
import { persistActiveScene } from "../../core/scenePersistence";
import { useEditorStore } from "../../core/store/editorStore";
import type {
  RetroFXConfig,
  RetroFXParallaxLayer,
  RetroFXRasterLine,
} from "../../core/ipc/sceneService";

let fxCounter = 0;
function newId(existingIds: string[]) {
  do {
    fxCounter += 1;
  } while (existingIds.includes(`fx_${fxCounter}`));

  return `fx_${fxCounter}`;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const DEFAULT_PARALLAX: RetroFXParallaxLayer[] = [
  { id: "p0", name: "BG1 (Far)", speed_x: 1, speed_y: 0, enabled: true },
  { id: "p1", name: "BG2 (Mid)", speed_x: 2, speed_y: 0, enabled: true },
  { id: "p2", name: "BG3 (Near)", speed_x: 4, speed_y: 0, enabled: false },
];

const DEFAULT_RASTER: RetroFXRasterLine[] = [
  { id: "r0", scanline: 128, offset_x: 4, enabled: true },
  { id: "r1", scanline: 160, offset_x: -4, enabled: false },
];

function cloneRetroFXConfig(config?: RetroFXConfig | null): RetroFXConfig {
  return structuredClone({
    parallax_layers: config?.parallax_layers ?? DEFAULT_PARALLAX,
    raster_lines: config?.raster_lines ?? DEFAULT_RASTER,
  });
}

interface IntFieldProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}

function IntField({ label, value, min = -999, max = 999, onChange }: IntFieldProps) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-14 shrink-0 text-[10px] text-[#7f849c]">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={1}
        className="w-14 rounded border border-[#313244] bg-[#1e1e2e] px-1 py-0.5 text-right text-[11px] font-mono text-[#cdd6f4] focus:outline-none focus:border-[#cba6f7]"
        onChange={(event) => onChange(Math.trunc(Number(event.target.value)))}
      />
    </div>
  );
}

function RasterPreview({ lines }: { lines: RetroFXRasterLine[] }) {
  const height = 112;
  const width = 160;
  const activeLines = lines.filter((line) => line.enabled);

  return (
    <div
      className="relative shrink-0 overflow-hidden border border-[#313244] bg-black"
      style={{ width, height }}
    >
      {Array.from({ length: height }, (_, index) => {
        const scanline = Math.round((index / height) * 224);
        const hit = activeLines.find((line) => Math.abs(line.scanline - scanline) < 3);
        const offset = hit ? (hit.offset_x / 320) * width : 0;
        return (
          <div
            key={index}
            className={`absolute h-px w-full ${hit ? "bg-[#cba6f7]/60" : "bg-[#313244]/40"}`}
            style={{ top: index, transform: `translateX(${offset}px)` }}
          />
        );
      })}
      <span className="absolute bottom-1 right-1 select-none text-[9px] text-[#45475a]">Preview</span>
    </div>
  );
}

export default function RetroFXDesigner() {
  const activeProjectDir = useEditorStore((state) => state.activeProjectDir);
  const activeScene = useEditorStore((state) => state.activeScene);
  const logMessage = useEditorStore((state) => state.logMessage);
  const [parallax, setParallax] = useState<RetroFXParallaxLayer[]>(() =>
    cloneRetroFXConfig(useEditorStore.getState().activeScene?.retrofx).parallax_layers
  );
  const [raster, setRaster] = useState<RetroFXRasterLine[]>(() =>
    cloneRetroFXConfig(useEditorStore.getState().activeScene?.retrofx).raster_lines
  );
  const [tab, setTab] = useState<"parallax" | "raster">("parallax");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const retrofx = cloneRetroFXConfig(activeScene?.retrofx);
    setParallax(retrofx.parallax_layers);
    setRaster(retrofx.raster_lines);
  }, [activeScene]);

  function updateParallax(id: string, patch: Partial<RetroFXParallaxLayer>) {
    setParallax((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function addParallax() {
    const nextIndex = parallax.length + 1;
    setParallax((items) => [
      ...items,
      { id: newId(items.map((item) => item.id)), name: `BG${nextIndex}`, speed_x: 1, speed_y: 0, enabled: true },
    ]);
  }

  function removeParallax(id: string) {
    setParallax((items) => items.filter((item) => item.id !== id));
  }

  function updateRaster(id: string, patch: Partial<RetroFXRasterLine>) {
    setRaster((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function addRaster() {
    setRaster((items) => [
      ...items,
      { id: newId(items.map((item) => item.id)), scanline: 100, offset_x: 2, enabled: true },
    ]);
  }

  function removeRaster(id: string) {
    setRaster((items) => items.filter((item) => item.id !== id));
  }

  async function applyFX() {
    if (!activeScene || !activeProjectDir) {
      logMessage("warn", "[RetroFX] Abra um projeto antes de salvar a configuracao.");
      return;
    }

    setSaving(true);
    try {
      useEditorStore.setState((state) => {
        if (!state.activeScene) {
          return state;
        }

        return {
          activeScene: {
            ...state.activeScene,
            retrofx: {
              parallax_layers: structuredClone(parallax),
              raster_lines: structuredClone(raster),
            },
          },
          sceneRevision: state.sceneRevision + 1,
        };
      });

      await persistActiveScene(
        activeProjectDir,
        "RetroFX",
        "Configuracao salva no scene JSON. Emissao para build continua experimental."
      );
    } catch (error: unknown) {
      logMessage("error", `[RetroFX] Falha ao salvar configuracao: ${describeError(error)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full w-full overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="flex shrink-0 border-b border-[#313244]">
          {(["parallax", "raster"] as const).map((currentTab) => (
            <button
              key={currentTab}
              className={`px-3 py-1.5 text-xs capitalize transition-colors ${tab === currentTab
                  ? "border-b-2 border-[#cba6f7] text-[#cba6f7]"
                  : "text-[#6c7086] hover:text-[#a6adc8]"
                }`}
              onClick={() => setTab(currentTab)}
            >
              {currentTab === "parallax" ? "Parallax" : "Raster"}
            </button>
          ))}
        </div>

        {tab === "parallax" && (
          <div className="flex flex-col gap-0 p-2">
            <p className="mb-2 px-1 text-[10px] text-[#45475a] select-none">
              Velocidade inteira por frame, sem float.
            </p>
            {parallax.map((layer) => (
              <div
                key={layer.id}
                className={`mb-1.5 flex flex-col gap-1.5 rounded border p-2 ${layer.enabled ? "border-[#313244] bg-[#1e1e2e]" : "border-[#313244]/40 bg-transparent opacity-50"
                  }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-[#cdd6f4]">{layer.name}</span>
                  <div className="flex items-center gap-2">
                    <label className="flex cursor-pointer items-center gap-1">
                      <input
                        type="checkbox"
                        checked={layer.enabled}
                        className="h-3 w-3 accent-[#cba6f7]"
                        onChange={(event) => updateParallax(layer.id, { enabled: event.target.checked })}
                      />
                      <span className="text-[10px] text-[#6c7086]">ativo</span>
                    </label>
                    <button
                      className="text-[11px] text-[#45475a] hover:text-[#f38ba8]"
                      onClick={() => removeParallax(layer.id)}
                    >
                      X
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <IntField label="speed X" value={layer.speed_x} onChange={(value) => updateParallax(layer.id, { speed_x: value })} />
                  <IntField label="speed Y" value={layer.speed_y} onChange={(value) => updateParallax(layer.id, { speed_y: value })} />
                </div>
              </div>
            ))}
            <button
              className="mt-1 rounded border border-dashed border-[#313244] py-1 text-xs text-[#45475a] transition-colors hover:border-[#cba6f7] hover:text-[#cba6f7]"
              onClick={addParallax}
            >
              + Add Layer
            </button>
          </div>
        )}

        {tab === "raster" && (
          <div className="flex flex-col gap-0 p-2">
            <p className="mb-2 px-1 text-[10px] text-[#45475a] select-none">
              Offset horizontal aplicado por scanline.
            </p>
            {raster.map((line) => (
              <div
                key={line.id}
                className={`mb-1.5 flex flex-col gap-1.5 rounded border p-2 ${line.enabled ? "border-[#313244] bg-[#1e1e2e]" : "border-[#313244]/40 opacity-50"
                  }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-[#cdd6f4]">Scanline {line.scanline}</span>
                  <div className="flex items-center gap-2">
                    <label className="flex cursor-pointer items-center gap-1">
                      <input
                        type="checkbox"
                        checked={line.enabled}
                        className="h-3 w-3 accent-[#cba6f7]"
                        onChange={(event) => updateRaster(line.id, { enabled: event.target.checked })}
                      />
                      <span className="text-[10px] text-[#6c7086]">ativo</span>
                    </label>
                    <button
                      className="text-[11px] text-[#45475a] hover:text-[#f38ba8]"
                      onClick={() => removeRaster(line.id)}
                    >
                      X
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <IntField label="scanline" value={line.scanline} min={0} max={223} onChange={(value) => updateRaster(line.id, { scanline: value })} />
                  <IntField label="offset X" value={line.offset_x} min={-319} max={319} onChange={(value) => updateRaster(line.id, { offset_x: value })} />
                </div>
              </div>
            ))}
            <button
              className="mt-1 rounded border border-dashed border-[#313244] py-1 text-xs text-[#45475a] transition-colors hover:border-[#cba6f7] hover:text-[#cba6f7]"
              onClick={addRaster}
            >
              + Add Scanline
            </button>
          </div>
        )}

        <div className="mt-auto shrink-0 border-t border-[#313244] p-2">
          <button
            className={`w-full rounded py-1 text-xs font-semibold transition-colors ${saving
                ? "cursor-not-allowed bg-[#45475a] text-[#6c7086]"
                : "bg-[#cba6f7] text-[#1e1e2e] hover:bg-[#b4a0e0]"
              }`}
            disabled={saving}
            onClick={() => void applyFX()}
          >
            {saving ? "Salvando..." : "Salvar RetroFX"}
          </button>
        </div>
      </div>

      <div className="flex w-44 shrink-0 flex-col items-center gap-3 border-l border-[#313244] bg-[#181825] p-3">
        <span className="self-start select-none text-[10px] text-[#45475a]">PREVIEW</span>

        <div className="flex w-full flex-col gap-1">
          {parallax.filter((layer) => layer.enabled).map((layer) => (
            <div key={layer.id} className="flex items-center gap-1.5">
              <div
                className="h-2 rounded-sm bg-[#cba6f7]/60"
                style={{ width: `${Math.min(Math.abs(layer.speed_x) * 12, 100)}%` }}
              />
              <span className="shrink-0 text-[9px] text-[#45475a]">{layer.name}</span>
            </div>
          ))}
        </div>

        <RasterPreview lines={raster} />

        <p className="select-none text-center text-[9px] leading-tight text-[#45475a]">
          Raster offsets
          <br />
          visualizados em escala
        </p>
      </div>
    </div>
  );
}
