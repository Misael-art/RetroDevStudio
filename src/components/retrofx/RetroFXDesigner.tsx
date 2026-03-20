import { useEffect, useRef, useState } from "react";
import { persistActiveScene } from "../../core/scenePersistence";
import { useEditorStore } from "../../core/store/editorStore";
import type {
  RetroFXConfig,
  RetroFXParallaxLayer,
  RetroFXRasterLine,
} from "../../core/ipc/sceneService";

let fxCounter = 0;

const PARALLAX_LOOP_WIDTH = 720;

const DEFAULT_PARALLAX: RetroFXParallaxLayer[] = [
  { id: "p0", name: "Far", speed_x: 1, speed_y: 0, enabled: true },
  { id: "p1", name: "Mid", speed_x: 3, speed_y: 0, enabled: true },
  { id: "p2", name: "Near", speed_x: 5, speed_y: 0, enabled: true },
];

const DEFAULT_RASTER: RetroFXRasterLine[] = [
  { id: "r0", scanline: 128, offset_x: 4, enabled: true },
  { id: "r1", scanline: 160, offset_x: -4, enabled: false },
];

const PARALLAX_ROLE_COPY = [
  {
    label: "Far",
    subtitle: "fundo distante",
    accent: "#7dd3fc",
    borderClass: "border-[#7dd3fc]/35",
    bgClass: "bg-[#7dd3fc]/10",
    pattern:
      "radial-gradient(circle at 18% 40%, rgba(226,232,240,0.45) 0 18%, transparent 20%), radial-gradient(circle at 58% 34%, rgba(226,232,240,0.35) 0 12%, transparent 15%), linear-gradient(180deg, rgba(103,232,249,0.2), rgba(15,23,42,0))",
    patternSize: "280px 100%, 260px 100%, 100% 100%",
    top: 24,
    height: 104,
  },
  {
    label: "Mid",
    subtitle: "plano medio",
    accent: "#cba6f7",
    borderClass: "border-[#cba6f7]/35",
    bgClass: "bg-[#cba6f7]/10",
    pattern:
      "linear-gradient(160deg, transparent 0 35%, rgba(168,85,247,0.35) 35% 63%, transparent 63% 100%), linear-gradient(200deg, transparent 0 42%, rgba(147,51,234,0.4) 42% 68%, transparent 68% 100%), linear-gradient(180deg, rgba(30,41,59,0.05), rgba(15,23,42,0.45))",
    patternSize: "220px 100%, 180px 100%, 100% 100%",
    top: 132,
    height: 110,
  },
  {
    label: "Near",
    subtitle: "foreground",
    accent: "#f9e2af",
    borderClass: "border-[#f9e2af]/35",
    bgClass: "bg-[#f9e2af]/10",
    pattern:
      "linear-gradient(90deg, rgba(245,158,11,0.24) 0 20%, transparent 20% 40%, rgba(251,191,36,0.24) 40% 58%, transparent 58% 76%, rgba(245,158,11,0.24) 76% 100%), linear-gradient(180deg, rgba(251,191,36,0.35), rgba(120,53,15,0.55))",
    patternSize: "120px 100%, 100% 100%",
    top: 242,
    height: 96,
  },
];

function newId(existingIds: string[]) {
  do {
    fxCounter += 1;
  } while (existingIds.includes(`fx_${fxCounter}`));

  return `fx_${fxCounter}`;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function normalizeLayerName(name: string, index: number): string {
  const normalized = name.trim().toLowerCase();
  if (normalized === "bg1" || normalized === "bg1 (far)") {
    return "Far";
  }
  if (normalized === "bg2" || normalized === "bg2 (mid)") {
    return "Mid";
  }
  if (normalized === "bg3" || normalized === "bg3 (near)") {
    return "Near";
  }
  return name.trim() || `Layer ${index + 1}`;
}

function cloneRetroFXConfig(config?: RetroFXConfig | null): RetroFXConfig {
  return structuredClone({
    parallax_layers:
      config?.parallax_layers?.map((layer, index) => ({
        ...layer,
        name: normalizeLayerName(layer.name, index),
      })) ?? DEFAULT_PARALLAX,
    raster_lines: config?.raster_lines ?? DEFAULT_RASTER,
  });
}

function moveArrayItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) {
    return items;
  }

  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

function getRoleDescriptor(index: number) {
  return PARALLAX_ROLE_COPY[index] ?? {
    label: `Layer ${index + 1}`,
    subtitle: "camada adicional",
    accent: "#94a3b8",
    borderClass: "border-[#94a3b8]/35",
    bgClass: "bg-[#94a3b8]/10",
    pattern:
      "linear-gradient(90deg, rgba(148,163,184,0.18) 0 25%, transparent 25% 50%, rgba(148,163,184,0.18) 50% 75%, transparent 75% 100%), linear-gradient(180deg, rgba(148,163,184,0.18), rgba(15,23,42,0.35))",
    patternSize: "160px 100%, 100% 100%",
    top: 72 + index * 40,
    height: 92,
  };
}

function getDepthPercent(index: number, total: number): number {
  if (total <= 1) {
    return 50;
  }
  return Math.round((index / (total - 1)) * 100);
}

function wrapOffset(value: number, size: number): number {
  if (!Number.isFinite(value) || size <= 0) {
    return 0;
  }
  return ((value % size) + size) % size;
}

function wrapSignedOffset(value: number, size: number): number {
  if (!Number.isFinite(value) || size <= 0) {
    return 0;
  }
  return (((value % size) + size) % size) - size / 2;
}

interface SpeedControlProps {
  label: string;
  help: string;
  value: number;
  min: number;
  max: number;
  testId: string;
  onChange: (value: number) => void;
}

function SpeedControl({
  label,
  help,
  value,
  min,
  max,
  testId,
  onChange,
}: SpeedControlProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#cdd6f4]">
            {label}
          </div>
          <div className="mt-1 text-[11px] leading-5 text-[#7f849c]" title={help}>
            {help}
          </div>
        </div>
        <div className="rounded-full border border-[#313244] bg-[#11111b] px-2.5 py-1 text-[11px] font-mono text-[#f9e2af]">
          {value}
        </div>
      </div>

      <input
        data-testid={`${testId}-range`}
        type="range"
        value={value}
        min={min}
        max={max}
        step={1}
        className="w-full accent-[#cba6f7]"
        onChange={(event) => onChange(clampInteger(Number(event.target.value), min, max))}
      />

      <input
        data-testid={`${testId}-number`}
        type="number"
        value={value}
        min={min}
        max={max}
        step={1}
        className="w-full rounded-xl border border-[#313244] bg-[#11111b] px-3 py-2 text-right text-sm font-mono text-[#cdd6f4] focus:border-[#cba6f7] focus:outline-none"
        onChange={(event) => onChange(clampInteger(Number(event.target.value), min, max))}
        onKeyDown={(event) => {
          if (
            event.key !== "ArrowUp" &&
            event.key !== "ArrowDown" &&
            event.key !== "ArrowLeft" &&
            event.key !== "ArrowRight"
          ) {
            return;
          }

          event.preventDefault();
          const direction =
            event.key === "ArrowUp" || event.key === "ArrowRight" ? 1 : -1;
          const step = event.shiftKey ? 1 : 4;
          onChange(clampInteger(value + direction * step, min, max));
        }}
      />
    </div>
  );
}

function RasterPreview({ lines }: { lines: RetroFXRasterLine[] }) {
  const height = 112;
  const width = 240;
  const activeLines = lines.filter((line) => line.enabled);

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-[#313244] bg-[#050816]"
      style={{ width, height }}
    >
      {Array.from({ length: height }, (_, index) => {
        const scanline = Math.round((index / height) * 224);
        const hit = activeLines.find((line) => Math.abs(line.scanline - scanline) < 3);
        const offset = hit ? (hit.offset_x / 320) * width : 0;
        return (
          <div
            key={index}
            className={`absolute h-px w-full ${hit ? "bg-[#cba6f7]/70" : "bg-[#313244]/40"}`}
            style={{ top: index, transform: `translateX(${offset}px)` }}
          />
        );
      })}
      <div className="absolute bottom-2 right-2 rounded-full border border-[#313244] bg-[#11111b]/90 px-2 py-0.5 text-[10px] text-[#7f849c]">
        Raster Preview
      </div>
    </div>
  );
}

function ParallaxPreview({
  layers,
  previewTime,
  playing,
}: {
  layers: RetroFXParallaxLayer[];
  previewTime: number;
  playing: boolean;
}) {
  const enabledLayers = layers.filter((layer) => layer.enabled);

  return (
    <div className="relative min-h-[360px] overflow-hidden rounded-[28px] border border-[#313244] bg-[linear-gradient(180deg,#0f172a_0%,#101826_38%,#090c14_100%)] shadow-[0_28px_80px_rgba(0,0,0,0.35)]">
      <div className="absolute inset-x-0 top-0 h-40 bg-[radial-gradient(circle_at_20%_20%,rgba(125,211,252,0.24),transparent_35%),radial-gradient(circle_at_70%_10%,rgba(203,166,247,0.22),transparent_32%),linear-gradient(180deg,rgba(30,41,59,0.55),transparent)]" />
      <div className="absolute inset-x-0 bottom-0 h-24 bg-[linear-gradient(180deg,rgba(17,24,39,0),rgba(2,6,23,0.95))]" />
      <div className="absolute inset-y-0 left-1/2 w-px bg-[#f9e2af]/20" />

      <div className="absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-2">
        <div className="rounded-full border border-[#f9e2af]/40 bg-[#f9e2af]/14 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#f9e2af]">
          Camera
        </div>
        <div className="h-12 w-12 rounded-2xl border border-[#f9e2af]/30 bg-[linear-gradient(180deg,#f9e2af,#f59e0b)] shadow-[0_12px_24px_rgba(245,158,11,0.28)]" />
      </div>

      <div className="absolute left-4 top-4 rounded-2xl border border-[#313244] bg-[#11111b]/85 px-4 py-3 text-[12px] leading-5 text-[#cdd6f4] backdrop-blur-sm">
        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#7dd3fc]">
          Preview animado
        </div>
        <div className="mt-1">
          {playing ? "Simulando movimento continuo" : "Preview pausado para ajuste fino"}
        </div>
      </div>

      {enabledLayers.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center px-8 text-center text-[13px] leading-6 text-[#7f849c]">
          Ative pelo menos uma camada para ver o efeito de profundidade no preview.
        </div>
      ) : (
        enabledLayers.map((layer, index) => {
          const descriptor = getRoleDescriptor(index);
          const offsetX = wrapOffset(previewTime * layer.speed_x * 0.045, PARALLAX_LOOP_WIDTH);
          const offsetY = wrapSignedOffset(previewTime * layer.speed_y * 0.015, 64);
          const layerTop = descriptor.top + offsetY;

          return (
            <div
              key={layer.id}
              className="absolute inset-x-0 overflow-hidden"
              style={{ top: layerTop, height: descriptor.height }}
            >
              <div className="absolute left-0 top-0 z-10 rounded-full border border-[#111827]/70 bg-[#111827]/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#e5e7eb]">
                {descriptor.label}
              </div>
              <div
                className="absolute inset-y-0 left-0"
                style={{
                  width: PARALLAX_LOOP_WIDTH * 2,
                  transform: `translate3d(${-offsetX}px, 0, 0)`,
                }}
              >
                <div
                  className="absolute inset-y-0 left-0"
                  style={{
                    width: PARALLAX_LOOP_WIDTH,
                    backgroundImage: descriptor.pattern,
                    backgroundSize: descriptor.patternSize,
                    backgroundRepeat: "repeat-x",
                    opacity: 0.92,
                  }}
                />
                <div
                  className="absolute inset-y-0"
                  style={{
                    left: PARALLAX_LOOP_WIDTH,
                    width: PARALLAX_LOOP_WIDTH,
                    backgroundImage: descriptor.pattern,
                    backgroundSize: descriptor.patternSize,
                    backgroundRepeat: "repeat-x",
                    opacity: 0.92,
                  }}
                />
              </div>
            </div>
          );
        })
      )}
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
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(() =>
    cloneRetroFXConfig(useEditorStore.getState().activeScene?.retrofx).parallax_layers[0]?.id ?? null
  );
  const [previewPlaying, setPreviewPlaying] = useState(true);
  const [previewTime, setPreviewTime] = useState(0);
  const [draggingLayerId, setDraggingLayerId] = useState<string | null>(null);
  const previewLastTimeRef = useRef<number | null>(null);

  const selectedLayer =
    parallax.find((layer) => layer.id === selectedLayerId) ?? parallax[0] ?? null;

  useEffect(() => {
    const retrofx = cloneRetroFXConfig(activeScene?.retrofx);
    setParallax(retrofx.parallax_layers);
    setRaster(retrofx.raster_lines);
    setSelectedLayerId((current) =>
      retrofx.parallax_layers.some((layer) => layer.id === current)
        ? current
        : retrofx.parallax_layers[0]?.id ?? null
    );
  }, [activeScene]);

  useEffect(() => {
    if (!selectedLayerId || parallax.some((layer) => layer.id === selectedLayerId)) {
      return;
    }
    setSelectedLayerId(parallax[0]?.id ?? null);
  }, [parallax, selectedLayerId]);

  useEffect(() => {
    if (!previewPlaying) {
      previewLastTimeRef.current = null;
      return;
    }

    let rafId = 0;
    const tick = (now: number) => {
      if (previewLastTimeRef.current === null) {
        previewLastTimeRef.current = now;
      }
      const delta = Math.min(32, now - previewLastTimeRef.current);
      previewLastTimeRef.current = now;
      setPreviewTime((value) => value + delta);
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [previewPlaying]);

  function updateParallax(id: string, patch: Partial<RetroFXParallaxLayer>) {
    setParallax((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function reorderParallax(sourceId: string, targetId: string) {
    setParallax((items) => {
      const fromIndex = items.findIndex((item) => item.id === sourceId);
      const toIndex = items.findIndex((item) => item.id === targetId);
      return moveArrayItem(items, fromIndex, toIndex);
    });
  }

  function addParallax() {
    setParallax((items) => {
      const nextItems = [
        ...items,
        {
          id: newId(items.map((item) => item.id)),
          name: `Layer ${items.length + 1}`,
          speed_x: 2,
          speed_y: 0,
          enabled: true,
        },
      ];
      setSelectedLayerId(nextItems[nextItems.length - 1]?.id ?? null);
      return nextItems;
    });
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

        const nextRetroFX = {
          parallax_layers: structuredClone(parallax),
          raster_lines: structuredClone(raster),
        };

        return {
          activeScene: {
            ...state.activeScene,
            retrofx: nextRetroFX,
          },
          activeSceneSource: state.activeSceneSource
            ? {
                ...state.activeSceneSource,
                retrofx: structuredClone(nextRetroFX),
              }
            : state.activeSceneSource,
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
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#090d16]">
      <div className="border-b border-[#313244] bg-[linear-gradient(180deg,#111827,#0b1220)] px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#cba6f7]">
              RetroFX Experimental
            </div>
            <div className="mt-1 text-sm font-semibold text-[#e5e7eb]">
              Editor visual de profundidade e movimento
            </div>
            <div className="mt-1 text-[12px] text-[#94a3b8]">
              Camadas mais distantes se movem mais devagar. Ajuste no painel e veja o impacto imediatamente no preview.
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-full border border-[#313244] bg-[#11111b] p-1">
            {(["parallax", "raster"] as const).map((currentTab) => (
              <button
                key={currentTab}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  tab === currentTab
                    ? "bg-[#cba6f7] text-[#111827]"
                    : "text-[#94a3b8] hover:bg-[#1f2937] hover:text-[#e5e7eb]"
                }`}
                onClick={() => setTab(currentTab)}
              >
                {currentTab === "parallax" ? "Parallax" : "Raster"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {tab === "parallax" ? (
        <div className="grid min-h-0 flex-1 gap-3 p-3 xl:grid-cols-[320px_minmax(0,1fr)_340px]">
          <section className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-[#313244] bg-[linear-gradient(180deg,#111827,#0b1220)] shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
            <div className="border-b border-[#1f2937] px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#7dd3fc]">
                Layers
              </div>
              <div className="mt-1 text-[12px] leading-5 text-[#94a3b8]">
                Arraste para reorganizar a profundidade. O topo da lista fica mais distante.
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
              {parallax.map((layer, index) => {
                const role = getRoleDescriptor(index);
                const depthPercent = getDepthPercent(index, Math.max(parallax.length, 1));
                const isSelected = selectedLayer?.id === layer.id;

                return (
                  <div
                    key={layer.id}
                    data-testid={`retrofx-layer-${layer.id}`}
                    role="button"
                    tabIndex={0}
                    draggable
                    className={`rounded-2xl border px-4 py-3 transition-colors ${
                      isSelected
                        ? `${role.borderClass} ${role.bgClass}`
                        : "border-[#1f2937] bg-[#0b1220] hover:border-[#334155]"
                    } ${draggingLayerId === layer.id ? "opacity-70" : ""}`}
                    onClick={() => setSelectedLayerId(layer.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        setSelectedLayerId(layer.id);
                      }
                    }}
                    onDragStart={() => {
                      setDraggingLayerId(layer.id);
                      setSelectedLayerId(layer.id);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (draggingLayerId && draggingLayerId !== layer.id) {
                        reorderParallax(draggingLayerId, layer.id);
                      }
                      setDraggingLayerId(null);
                    }}
                    onDragEnd={() => setDraggingLayerId(null)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="rounded-xl border border-[#313244] bg-[#11111b] px-2 py-1 text-[11px] text-[#cdd6f4]">
                          ::
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#111827]"
                              style={{ backgroundColor: role.accent }}
                            >
                              {role.label}
                            </span>
                            <span className="text-[10px] uppercase tracking-[0.16em] text-[#64748b]">
                              {role.subtitle}
                            </span>
                          </div>
                          <div className="mt-2 truncate text-sm font-semibold text-[#e5e7eb]">
                            {layer.name}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1 text-[11px] text-[#94a3b8]">
                          <input
                            type="checkbox"
                            checked={layer.enabled}
                            className="accent-[#cba6f7]"
                            onChange={(event) =>
                              updateParallax(layer.id, { enabled: event.target.checked })
                            }
                            onClick={(event) => event.stopPropagation()}
                          />
                          visivel
                        </label>
                        <button
                          className="rounded-lg border border-[#f38ba8]/30 bg-[#f38ba8]/10 px-2 py-1 text-[11px] font-semibold text-[#fda4af] transition-colors hover:bg-[#f38ba8]/16"
                          onClick={(event) => {
                            event.stopPropagation();
                            removeParallax(layer.id);
                          }}
                        >
                          Remover
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-[#94a3b8]">
                      <span className="rounded-full border border-[#313244] bg-[#11111b] px-2 py-1 font-mono text-[#cdd6f4]">
                        X {layer.speed_x}
                      </span>
                      <span className="rounded-full border border-[#313244] bg-[#11111b] px-2 py-1 font-mono text-[#cdd6f4]">
                        Y {layer.speed_y}
                      </span>
                      <span className="text-[#64748b]">Profundidade {depthPercent}%</span>
                    </div>

                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#11111b]">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(18, 100 - depthPercent)}%`,
                          backgroundColor: role.accent,
                        }}
                      />
                    </div>
                  </div>
                );
              })}

              <button
                className="rounded-2xl border border-dashed border-[#334155] py-3 text-sm font-semibold text-[#94a3b8] transition-colors hover:border-[#cba6f7] hover:text-[#e9d5ff]"
                onClick={addParallax}
              >
                + Adicionar camada
              </button>
            </div>
          </section>

          <section className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-[#313244] bg-[linear-gradient(180deg,#111827,#0b1220)] shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
            <div className="border-b border-[#1f2937] px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#f9e2af]">
                    Preview grande
                  </div>
                  <div className="mt-1 text-[12px] leading-5 text-[#94a3b8]">
                    Veja o efeito de profundidade em movimento continuo antes de salvar.
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    data-testid="retrofx-preview-play"
                    type="button"
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                      previewPlaying
                        ? "bg-[#a6e3a1] text-[#111827]"
                        : "bg-[#1f2937] text-[#cdd6f4] hover:bg-[#2b3544]"
                    }`}
                    onClick={() => setPreviewPlaying((value) => !value)}
                  >
                    {previewPlaying ? "Pause" : "Play"}
                  </button>
                  <button
                    type="button"
                    className="rounded-full bg-[#1f2937] px-3 py-1.5 text-xs font-semibold text-[#cdd6f4] transition-colors hover:bg-[#2b3544]"
                    onClick={() => setPreviewTime(0)}
                  >
                    Reiniciar
                  </button>
                </div>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 gap-4 p-4">
              <ParallaxPreview
                layers={parallax}
                previewTime={previewTime}
                playing={previewPlaying}
              />

              <div className="grid gap-3 lg:grid-cols-[1fr_240px]">
                <div className="rounded-2xl border border-[#1f2937] bg-[#0b1220] p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#f9e2af]">
                    Como ler o preview
                  </div>
                  <div className="mt-3 grid gap-3 text-[12px] leading-6 text-[#cdd6f4]">
                    <p title="Speed X controla o deslocamento horizontal por frame. Valores maiores passam mais rapido pela camera.">
                      `Speed X`: controla quanto a camada se desloca na horizontal.
                    </p>
                    <p title="Speed Y controla deslocamento vertical e ajuda a simular planos com subida, descida ou deriva.">
                      `Speed Y`: adiciona movimento vertical e ajuda a simular planos mais vivos.
                    </p>
                    <p>
                      Camadas mais distantes normalmente usam velocidades menores. Camadas proximas aceitam velocidades maiores para dar sensacao de profundidade.
                    </p>
                  </div>
                </div>

                <div className="rounded-2xl border border-[#1f2937] bg-[#0b1220] p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#f9e2af]">
                    Estado atual
                  </div>
                  <div className="mt-3 space-y-2 text-[12px] text-[#cdd6f4]">
                    <div className="flex items-center justify-between">
                      <span className="text-[#94a3b8]">Camadas visiveis</span>
                      <span>{parallax.filter((layer) => layer.enabled).length}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#94a3b8]">Loop</span>
                      <span>{previewPlaying ? "Ativo" : "Pausado"}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#94a3b8]">Dica</span>
                      <span>Shift + setas = ajuste fino</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-[#313244] bg-[linear-gradient(180deg,#111827,#0b1220)] shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
            <div className="border-b border-[#1f2937] px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#a6e3a1]">
                Propriedades
              </div>
              <div className="mt-1 text-[12px] leading-5 text-[#94a3b8]">
                Ajuste a camada selecionada com feedback imediato.
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
              {selectedLayer ? (
                <>
                  <div className="rounded-2xl border border-[#1f2937] bg-[#0b1220] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.22em] text-[#64748b]">
                          Camada selecionada
                        </div>
                        <div className="mt-1 text-lg font-semibold text-[#e5e7eb]">
                          {selectedLayer.name}
                        </div>
                      </div>
                      <span className="rounded-full border border-[#313244] bg-[#11111b] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#cdd6f4]">
                        {
                          getRoleDescriptor(
                            parallax.findIndex((layer) => layer.id === selectedLayer.id)
                          ).label
                        }
                      </span>
                    </div>
                  </div>

                  <label className="space-y-2">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#cdd6f4]">
                      Nome da camada
                    </span>
                    <input
                      type="text"
                      value={selectedLayer.name}
                      className="w-full rounded-2xl border border-[#313244] bg-[#11111b] px-4 py-3 text-sm font-semibold text-[#e5e7eb] focus:border-[#cba6f7] focus:outline-none"
                      onChange={(event) =>
                        updateParallax(selectedLayer.id, { name: event.target.value })
                      }
                    />
                  </label>

                  <label className="flex items-center justify-between rounded-2xl border border-[#1f2937] bg-[#0b1220] px-4 py-3 text-[12px] text-[#cdd6f4]">
                    <span>Camada visivel no preview</span>
                    <input
                      type="checkbox"
                      checked={selectedLayer.enabled}
                      className="accent-[#cba6f7]"
                      onChange={(event) =>
                        updateParallax(selectedLayer.id, { enabled: event.target.checked })
                      }
                    />
                  </label>

                  <div className="rounded-2xl border border-[#1f2937] bg-[#0b1220] p-4">
                    <SpeedControl
                      label="Speed X"
                      help="Movimento horizontal. Mais alto = camada parece mais proxima."
                      value={selectedLayer.speed_x}
                      min={-12}
                      max={12}
                      testId="retrofx-speed-x"
                      onChange={(value) => updateParallax(selectedLayer.id, { speed_x: value })}
                    />
                  </div>

                  <div className="rounded-2xl border border-[#1f2937] bg-[#0b1220] p-4">
                    <SpeedControl
                      label="Speed Y"
                      help="Movimento vertical. Use valores pequenos para deriva ou profundidade extra."
                      value={selectedLayer.speed_y}
                      min={-12}
                      max={12}
                      testId="retrofx-speed-y"
                      onChange={(value) => updateParallax(selectedLayer.id, { speed_y: value })}
                    />
                  </div>

                  <div className="rounded-2xl border border-[#1f2937] bg-[#0b1220] p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#cdd6f4]">
                      Leitura pedagogica
                    </div>
                    <div className="mt-3 space-y-3 text-[12px] leading-6 text-[#94a3b8]">
                      <p>
                        Camadas mais distantes geralmente usam `speed X` baixo. Camadas proximas aceitam valores maiores para reforcar a sensacao de camera.
                      </p>
                      <p>
                        O preview do centro atualiza instantaneamente. Use `Pause` para observar melhor o impacto de pequenos ajustes.
                      </p>
                    </div>
                  </div>
                </>
              ) : (
                <div className="rounded-2xl border border-[#1f2937] bg-[#0b1220] p-4 text-[12px] leading-6 text-[#94a3b8]">
                  Selecione uma camada na lista para editar nome, visibilidade e velocidades.
                </div>
              )}
            </div>

            <div className="border-t border-[#1f2937] p-4">
              <button
                data-testid="retrofx-save"
                className={`w-full rounded-2xl py-3 text-sm font-semibold transition-colors ${
                  saving
                    ? "cursor-not-allowed bg-[#45475a] text-[#6c7086]"
                    : "bg-[#cba6f7] text-[#111827] hover:bg-[#b4a0e0]"
                }`}
                disabled={saving}
                onClick={() => void applyFX()}
              >
                {saving ? "Salvando..." : "Salvar RetroFX"}
              </button>
            </div>
          </section>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 gap-3 p-3 xl:grid-cols-[minmax(0,1fr)_280px]">
          <section className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-[#313244] bg-[linear-gradient(180deg,#111827,#0b1220)] shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
            <div className="border-b border-[#1f2937] px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#cba6f7]">
                Raster
              </div>
              <div className="mt-1 text-[12px] leading-5 text-[#94a3b8]">
                Offset horizontal aplicado por scanline. Mantido como editor auxiliar.
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
              {raster.map((line) => (
                <div
                  key={line.id}
                  className={`rounded-2xl border p-4 ${
                    line.enabled
                      ? "border-[#313244] bg-[#0b1220]"
                      : "border-[#313244]/40 bg-[#0b1220]/40 opacity-60"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[#e5e7eb]">
                        Scanline {line.scanline}
                      </div>
                      <div className="mt-1 text-[11px] text-[#94a3b8]">
                        Offset {line.offset_x}px
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1 text-[11px] text-[#94a3b8]">
                        <input
                          type="checkbox"
                          checked={line.enabled}
                          className="accent-[#cba6f7]"
                          onChange={(event) =>
                            updateRaster(line.id, { enabled: event.target.checked })
                          }
                        />
                        visivel
                      </label>
                      <button
                        className="rounded-lg border border-[#f38ba8]/30 bg-[#f38ba8]/10 px-2 py-1 text-[11px] font-semibold text-[#fda4af] transition-colors hover:bg-[#f38ba8]/16"
                        onClick={() => removeRaster(line.id)}
                      >
                        Remover
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <SpeedControl
                      label="Scanline"
                      help="Define a linha em que o deslocamento horizontal passa a valer."
                      value={line.scanline}
                      min={0}
                      max={223}
                      testId={`retrofx-raster-scanline-${line.id}`}
                      onChange={(value) => updateRaster(line.id, { scanline: value })}
                    />
                    <SpeedControl
                      label="Offset X"
                      help="Deslocamento horizontal dessa faixa de scanlines."
                      value={line.offset_x}
                      min={-319}
                      max={319}
                      testId={`retrofx-raster-offset-${line.id}`}
                      onChange={(value) => updateRaster(line.id, { offset_x: value })}
                    />
                  </div>
                </div>
              ))}

              <button
                className="rounded-2xl border border-dashed border-[#334155] py-3 text-sm font-semibold text-[#94a3b8] transition-colors hover:border-[#cba6f7] hover:text-[#e9d5ff]"
                onClick={addRaster}
              >
                + Add Scanline
              </button>
            </div>
          </section>

          <section className="flex flex-col gap-3 overflow-hidden rounded-3xl border border-[#313244] bg-[linear-gradient(180deg,#111827,#0b1220)] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#cba6f7]">
              Preview raster
            </div>
            <RasterPreview lines={raster} />
            <div className="rounded-2xl border border-[#1f2937] bg-[#0b1220] p-4 text-[12px] leading-6 text-[#94a3b8]">
              Use scanlines para quebrar a imagem em faixas com offsets diferentes. O efeito continua experimental e serve como apoio visual rapido.
            </div>
            <button
              data-testid="retrofx-save"
              className={`mt-auto w-full rounded-2xl py-3 text-sm font-semibold transition-colors ${
                saving
                  ? "cursor-not-allowed bg-[#45475a] text-[#6c7086]"
                  : "bg-[#cba6f7] text-[#111827] hover:bg-[#b4a0e0]"
              }`}
              disabled={saving}
              onClick={() => void applyFX()}
            >
              {saving ? "Salvando..." : "Salvar RetroFX"}
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
