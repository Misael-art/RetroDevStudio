import { useState } from "react";
import { useEditorStore } from "../../core/store/editorStore";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ParallaxLayer {
  id: string;
  name: string;
  speedX: number;   // pixels per frame (integer — no float)
  speedY: number;
  enabled: boolean;
}

interface RasterLine {
  id: string;
  scanline: number; // 0–223
  offsetX: number;  // horizontal offset applied at that scanline
  enabled: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

let _fxCounter = 0;
function newId() { return `fx_${++_fxCounter}`; }

const DEFAULT_PARALLAX: ParallaxLayer[] = [
  { id: "p0", name: "BG1 (Far)",   speedX: 1, speedY: 0, enabled: true },
  { id: "p1", name: "BG2 (Mid)",   speedX: 2, speedY: 0, enabled: true },
  { id: "p2", name: "BG3 (Near)",  speedX: 4, speedY: 0, enabled: false },
];

const DEFAULT_RASTER: RasterLine[] = [
  { id: "r0", scanline: 128, offsetX: 4, enabled: true },
  { id: "r1", scanline: 160, offsetX: -4, enabled: false },
];

// ── Sub-components ────────────────────────────────────────────────────────────

interface IntFieldProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
}

function IntField({ label, value, min = -999, max = 999, onChange }: IntFieldProps) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-[#7f849c] w-14 shrink-0">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={1}
        className="w-14 bg-[#1e1e2e] border border-[#313244] rounded px-1 py-0.5 text-[11px] text-[#cdd6f4] font-mono text-right focus:outline-none focus:border-[#cba6f7]"
        onChange={(e) => onChange(Math.trunc(Number(e.target.value)))}
      />
    </div>
  );
}

// ── Preview strip (mini scanline visualizer) ──────────────────────────────────

function RasterPreview({ lines }: { lines: RasterLine[] }) {
  const HEIGHT = 112; // half MD height for compact display
  const WIDTH  = 160;
  const activeLines = lines.filter((l) => l.enabled);

  return (
    <div
      className="relative bg-black border border-[#313244] overflow-hidden shrink-0"
      style={{ width: WIDTH, height: HEIGHT }}
    >
      {/* Scanline stripes */}
      {Array.from({ length: HEIGHT }, (_, i) => {
        const scanline = Math.round((i / HEIGHT) * 224);
        const hit = activeLines.find((l) => Math.abs(l.scanline - scanline) < 3);
        const offset = hit ? (hit.offsetX / 320) * WIDTH : 0;
        return (
          <div
            key={i}
            className={`absolute h-px w-full ${hit ? "bg-[#cba6f7]/60" : "bg-[#313244]/40"}`}
            style={{ top: i, transform: `translateX(${offset}px)` }}
          />
        );
      })}
      <span className="absolute bottom-1 right-1 text-[9px] text-[#45475a] select-none">
        Preview
      </span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RetroFXDesigner() {
  const { logMessage } = useEditorStore();
  const [parallax, setParallax] = useState<ParallaxLayer[]>(DEFAULT_PARALLAX);
  const [raster,   setRaster]   = useState<RasterLine[]>(DEFAULT_RASTER);
  const [tab, setTab] = useState<"parallax" | "raster">("parallax");

  function updateParallax(id: string, patch: Partial<ParallaxLayer>) {
    setParallax((p) => p.map((l) => l.id === id ? { ...l, ...patch } : l));
  }

  function addParallax() {
    const idx = parallax.length + 1;
    setParallax((p) => [...p, { id: newId(), name: `BG${idx}`, speedX: 1, speedY: 0, enabled: true }]);
  }

  function removeParallax(id: string) {
    setParallax((p) => p.filter((l) => l.id !== id));
  }

  function updateRaster(id: string, patch: Partial<RasterLine>) {
    setRaster((r) => r.map((l) => l.id === id ? { ...l, ...patch } : l));
  }

  function addRaster() {
    setRaster((r) => [...r, { id: newId(), scanline: 100, offsetX: 2, enabled: true }]);
  }

  function removeRaster(id: string) {
    setRaster((r) => r.filter((l) => l.id !== id));
  }

  function applyFX() {
    const pActive = parallax.filter((l) => l.enabled);
    const rActive = raster.filter((l) => l.enabled);
    logMessage("success", `RetroFX aplicado: ${pActive.length} parallax layer(s), ${rActive.length} raster line(s).`);
  }

  return (
    <div className="flex h-full w-full overflow-hidden">

      {/* ── Controls panel ── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-y-auto">

        {/* Tab switcher */}
        <div className="flex border-b border-[#313244] shrink-0">
          {(["parallax", "raster"] as const).map((t) => (
            <button
              key={t}
              className={`px-3 py-1.5 text-xs capitalize transition-colors ${
                tab === t
                  ? "text-[#cba6f7] border-b-2 border-[#cba6f7]"
                  : "text-[#6c7086] hover:text-[#a6adc8]"
              }`}
              onClick={() => setTab(t)}
            >
              {t === "parallax" ? "✦ Parallax" : "⟿ Raster"}
            </button>
          ))}
        </div>

        {/* Parallax tab */}
        {tab === "parallax" && (
          <div className="flex flex-col gap-0 p-2">
            <p className="text-[10px] text-[#45475a] px-1 mb-2 select-none">
              Velocidade inteira por frame — sem float (regra hardware)
            </p>
            {parallax.map((layer) => (
              <div
                key={layer.id}
                className={`flex flex-col gap-1.5 p-2 rounded mb-1.5 border ${
                  layer.enabled ? "border-[#313244] bg-[#1e1e2e]" : "border-[#313244]/40 bg-transparent opacity-50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-[#cdd6f4]">{layer.name}</span>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={layer.enabled}
                        className="accent-[#cba6f7] w-3 h-3"
                        onChange={(e) => updateParallax(layer.id, { enabled: e.target.checked })}
                      />
                      <span className="text-[10px] text-[#6c7086]">ativo</span>
                    </label>
                    <button
                      className="text-[#45475a] hover:text-[#f38ba8] text-[11px]"
                      onClick={() => removeParallax(layer.id)}
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <div className="flex gap-3 flex-wrap">
                  <IntField label="speed X" value={layer.speedX} onChange={(v) => updateParallax(layer.id, { speedX: v })} />
                  <IntField label="speed Y" value={layer.speedY} onChange={(v) => updateParallax(layer.id, { speedY: v })} />
                </div>
              </div>
            ))}
            <button
              className="mt-1 text-xs text-[#45475a] hover:text-[#cba6f7] border border-dashed border-[#313244] hover:border-[#cba6f7] rounded py-1 transition-colors"
              onClick={addParallax}
            >
              + Add Layer
            </button>
          </div>
        )}

        {/* Raster tab */}
        {tab === "raster" && (
          <div className="flex flex-col gap-0 p-2">
            <p className="text-[10px] text-[#45475a] px-1 mb-2 select-none">
              Offset horizontal aplicado por scanline (inteiro)
            </p>
            {raster.map((line) => (
              <div
                key={line.id}
                className={`flex flex-col gap-1.5 p-2 rounded mb-1.5 border ${
                  line.enabled ? "border-[#313244] bg-[#1e1e2e]" : "border-[#313244]/40 opacity-50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-[#cdd6f4]">
                    Scanline {line.scanline}
                  </span>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={line.enabled}
                        className="accent-[#cba6f7] w-3 h-3"
                        onChange={(e) => updateRaster(line.id, { enabled: e.target.checked })}
                      />
                      <span className="text-[10px] text-[#6c7086]">ativo</span>
                    </label>
                    <button
                      className="text-[#45475a] hover:text-[#f38ba8] text-[11px]"
                      onClick={() => removeRaster(line.id)}
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <div className="flex gap-3 flex-wrap">
                  <IntField label="scanline" value={line.scanline} min={0} max={223} onChange={(v) => updateRaster(line.id, { scanline: v })} />
                  <IntField label="offset X" value={line.offsetX} min={-319} max={319} onChange={(v) => updateRaster(line.id, { offsetX: v })} />
                </div>
              </div>
            ))}
            <button
              className="mt-1 text-xs text-[#45475a] hover:text-[#cba6f7] border border-dashed border-[#313244] hover:border-[#cba6f7] rounded py-1 transition-colors"
              onClick={addRaster}
            >
              + Add Scanline
            </button>
          </div>
        )}

        {/* Apply button */}
        <div className="mt-auto p-2 border-t border-[#313244] shrink-0">
          <button
            className="w-full py-1 text-xs font-semibold bg-[#cba6f7] text-[#1e1e2e] rounded hover:bg-[#b4a0e0] transition-colors"
            onClick={applyFX}
          >
            Aplicar RetroFX
          </button>
        </div>
      </div>

      {/* ── Preview panel ── */}
      <div className="w-44 shrink-0 bg-[#181825] border-l border-[#313244] flex flex-col items-center gap-3 p-3">
        <span className="text-[10px] text-[#45475a] select-none self-start">PREVIEW</span>

        {/* Parallax bars */}
        <div className="w-full flex flex-col gap-1">
          {parallax.filter((l) => l.enabled).map((l) => (
            <div key={l.id} className="flex items-center gap-1.5">
              <div
                className="h-2 bg-[#cba6f7]/60 rounded-sm"
                style={{ width: `${Math.min(Math.abs(l.speedX) * 12, 100)}%` }}
              />
              <span className="text-[9px] text-[#45475a] shrink-0">{l.name}</span>
            </div>
          ))}
        </div>

        <RasterPreview lines={raster} />

        <p className="text-[9px] text-[#45475a] text-center select-none leading-tight">
          Raster offsets<br/>visualizados em escala
        </p>
      </div>
    </div>
  );
}
