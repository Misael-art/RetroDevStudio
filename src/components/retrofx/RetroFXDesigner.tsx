import { useState } from "react";
import { useEditorStore } from "../../core/store/editorStore";

interface ParallaxLayer {
  id: string;
  name: string;
  speedX: number;
  speedY: number;
  enabled: boolean;
}

interface RasterLine {
  id: string;
  scanline: number;
  offsetX: number;
  enabled: boolean;
}

let fxCounter = 0;
function newId() {
  fxCounter += 1;
  return `fx_${fxCounter}`;
}

const DEFAULT_PARALLAX: ParallaxLayer[] = [
  { id: "p0", name: "BG1 (Far)", speedX: 1, speedY: 0, enabled: true },
  { id: "p1", name: "BG2 (Mid)", speedX: 2, speedY: 0, enabled: true },
  { id: "p2", name: "BG3 (Near)", speedX: 4, speedY: 0, enabled: false },
];

const DEFAULT_RASTER: RasterLine[] = [
  { id: "r0", scanline: 128, offsetX: 4, enabled: true },
  { id: "r1", scanline: 160, offsetX: -4, enabled: false },
];

const RETROFX_DISABLED = true;

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

function RasterPreview({ lines }: { lines: RasterLine[] }) {
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
        const offset = hit ? (hit.offsetX / 320) * width : 0;
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
  const { logMessage } = useEditorStore();
  const [parallax, setParallax] = useState<ParallaxLayer[]>(DEFAULT_PARALLAX);
  const [raster, setRaster] = useState<RasterLine[]>(DEFAULT_RASTER);
  const [tab, setTab] = useState<"parallax" | "raster">("parallax");

  function updateParallax(id: string, patch: Partial<ParallaxLayer>) {
    setParallax((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function addParallax() {
    const nextIndex = parallax.length + 1;
    setParallax((items) => [
      ...items,
      { id: newId(), name: `BG${nextIndex}`, speedX: 1, speedY: 0, enabled: true },
    ]);
  }

  function removeParallax(id: string) {
    setParallax((items) => items.filter((item) => item.id !== id));
  }

  function updateRaster(id: string, patch: Partial<RasterLine>) {
    setRaster((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function addRaster() {
    setRaster((items) => [
      ...items,
      { id: newId(), scanline: 100, offsetX: 2, enabled: true },
    ]);
  }

  function removeRaster(id: string) {
    setRaster((items) => items.filter((item) => item.id !== id));
  }

  function applyFX() {
    logMessage("warn", "[RetroFX] Experimental: configuracao ainda nao e persistida nem integrada ao pipeline.");
  }

  return (
    <div className="flex h-full w-full overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="border-b border-[#313244] bg-[#181825] p-2">
          <div className="flex items-center gap-2">
            <span className="rounded border border-[#fab387] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#fab387]">
              Experimental
            </span>
            <span className="text-[10px] leading-tight text-[#7f849c]">
              UI de estudo. Ainda nao persiste efeitos nem exporta codigo real.
            </span>
          </div>
        </div>

        <div className="flex shrink-0 border-b border-[#313244]">
          {(["parallax", "raster"] as const).map((currentTab) => (
            <button
              key={currentTab}
              className={`px-3 py-1.5 text-xs capitalize transition-colors ${
                tab === currentTab
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
                className={`mb-1.5 flex flex-col gap-1.5 rounded border p-2 ${
                  layer.enabled ? "border-[#313244] bg-[#1e1e2e]" : "border-[#313244]/40 bg-transparent opacity-50"
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
                  <IntField label="speed X" value={layer.speedX} onChange={(value) => updateParallax(layer.id, { speedX: value })} />
                  <IntField label="speed Y" value={layer.speedY} onChange={(value) => updateParallax(layer.id, { speedY: value })} />
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
                className={`mb-1.5 flex flex-col gap-1.5 rounded border p-2 ${
                  line.enabled ? "border-[#313244] bg-[#1e1e2e]" : "border-[#313244]/40 opacity-50"
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
                  <IntField label="offset X" value={line.offsetX} min={-319} max={319} onChange={(value) => updateRaster(line.id, { offsetX: value })} />
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
            className={`w-full rounded py-1 text-xs font-semibold transition-colors ${
              RETROFX_DISABLED
                ? "cursor-not-allowed bg-[#45475a] text-[#6c7086]"
                : "bg-[#cba6f7] text-[#1e1e2e] hover:bg-[#b4a0e0]"
            }`}
            disabled={RETROFX_DISABLED}
            onClick={applyFX}
          >
            {RETROFX_DISABLED ? "Experimental - indisponivel" : "Aplicar RetroFX"}
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
                style={{ width: `${Math.min(Math.abs(layer.speedX) * 12, 100)}%` }}
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
