import { useEffect, useMemo, useState } from "react";
import { useEditorStore } from "../../core/store/editorStore";
import { listProjectAssets, type ProjectAssetEntry } from "../../core/ipc/toolsService";
import { resolveProjectAssetPath } from "../../core/pathUtils";
import { useProjectAssetVisualState } from "../../core/useProjectAssetVisualState";
import type { ActiveBrush, EditorMode, TilePaintTool } from "../../core/store/editorStore";

// ── Types ─────────────────────────────────────────────────────────────────────

type PaletteCategory = "sprites" | "tilemaps" | "audio" | "prefabs" | "other";

interface PaletteCategoryItem {
  id: string;
  label: string;
  category: PaletteCategory;
  assetPath: string;
  absolutePath: string;
  paintable: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function inferCategory(asset: ProjectAssetEntry): PaletteCategory {
  const normalized = asset.relative_path.replace(/\\/g, "/").toLowerCase();
  if (/^(assets\/)?sprites\//.test(normalized) && asset.kind === "image") return "sprites";
  if (/^(assets\/)?tilesets?\//.test(normalized)) return "tilemaps";
  if (/^(assets\/)?audio\//.test(normalized) || asset.kind === "audio") return "audio";
  if (/^prefabs?\//.test(normalized) || normalized.endsWith(".json")) return "prefabs";
  if (asset.kind === "image") return "sprites";
  return "other";
}

function displayLabel(relativePath: string): string {
  return relativePath
    .replace(/\\/g, "/")
    .replace(/^.*\//, "")
    .replace(/\.[a-z0-9]+$/i, "");
}

const CATEGORY_META: Record<PaletteCategory, { label: string; icon: string }> = {
  sprites: { label: "Sprites", icon: "\ud83d\uddbc\ufe0f" },
  tilemaps: { label: "Tilemaps", icon: "\ud83d\uddfa\ufe0f" },
  audio: { label: "Audio", icon: "\ud83d\udd0a" },
  prefabs: { label: "Prefabs", icon: "\ud83d\udce6" },
  other: { label: "Outros", icon: "\ud83d\udcc4" },
};

const CATEGORY_ORDER: PaletteCategory[] = ["sprites", "prefabs", "tilemaps", "audio", "other"];

// ── Components ────────────────────────────────────────────────────────────────

function PaletteItem({
  item,
  isActive,
  onSelect,
  projectDir,
}: {
  item: PaletteCategoryItem;
  isActive: boolean;
  onSelect: () => void;
  projectDir: string | null;
}) {
  const {
    src: thumbnailUrl,
    setLoaded,
    setFailed,
  } = useProjectAssetVisualState({
    absolutePath: item.category === "sprites" ? item.absolutePath : null,
    projectDir,
    relativePath: item.category === "sprites" ? item.assetPath : null,
  });

  return (
    <button
      onClick={onSelect}
      disabled={!item.paintable}
      className={`group/card relative flex flex-col items-center gap-1 p-1.5 rounded border transition-all ${
        isActive
          ? "bg-[#89b4fa]/20 border-[#89b4fa]"
          : item.paintable
            ? "bg-[#181825] border-[#313244] hover:border-[#45475a]"
            : "bg-[#181825] border-[#313244] opacity-50 cursor-not-allowed"
      }`}
    >
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-black/20 ${
          isActive ? "ring-1 ring-[#89b4fa]" : ""
        }`}
      >
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={item.label}
            onLoad={setLoaded}
            onError={setFailed}
            className="h-8 w-8 object-contain"
            style={{ imageRendering: "pixelated" }}
          />
        ) : (
          <span className={`text-base ${isActive ? "text-[#89b4fa]" : "text-[#7f849c]"}`}>
            {CATEGORY_META[item.category].icon}
          </span>
        )}
      </div>
      <span
        className={`min-w-0 w-full truncate text-center text-[9px] ${
          isActive ? "text-[#cdd6f4] font-semibold" : "text-[#a6adc8]"
        }`}
      >
        {item.label}
      </span>
      <div className="pointer-events-none absolute left-1/2 top-full z-10 mt-1 max-w-48 -translate-x-1/2 rounded border border-[#313244] bg-[#11111b] px-2 py-1 text-[9px] text-[#a6adc8] opacity-0 shadow-lg transition-opacity duration-150 group-hover/card:opacity-100">
        {item.paintable ? `Clique para selecionar: ${item.assetPath}` : `${item.assetPath} (não pintável)`}
      </div>
    </button>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

// ── TilePalette (apenas quando entidade-tilemap está selecionada) ─────────────

const TILE_TOOL_META: Record<TilePaintTool, { label: string; icon: string; hint: string }> = {
  pencil: { label: "Lápis", icon: "\u270f", hint: "Pintar célula (P)" },
  eraser: { label: "Borracha", icon: "\u232b", hint: "Apagar célula (X)" },
  picker: { label: "Conta-gotas", icon: "\ud83d\udd0d", hint: "Capturar tile (I)" },
  rect: { label: "Retângulo", icon: "\u25a2", hint: "Preencher retângulo (R)" },
  fill: { label: "Balde", icon: "\u25b2", hint: "Flood fill (G)" },
  stamp: { label: "Carimbo", icon: "\ud83d\udcf7", hint: "Stamp (reservado)" },
};

const TILE_TOOL_ORDER: TilePaintTool[] = ["pencil", "eraser", "picker", "rect", "fill"];

export function TilePalette({
  tilesetAbsolutePath,
  tilesetRelativePath,
  tileSize,
  tilemapEntityId,
}: {
  tilesetAbsolutePath: string;
  /** Caminho relativo ao projeto (gravado no tilemap) — repassado ao brush para tracabilidade. */
  tilesetRelativePath: string;
  tileSize: number;
  tilemapEntityId: string;
}) {
  const activeBrush = useEditorStore((s) => s.activeBrush);
  const setActiveBrush = useEditorStore((s) => s.setActiveBrush);
  const setEditorMode = useEditorStore((s) => s.setEditorMode);
  const tilePaintTool = useEditorStore((s) => s.tilePaintTool);
  const setTilePaintTool = useEditorStore((s) => s.setTilePaintTool);
  const setActiveTilemapId = useEditorStore((s) => s.setActiveTilemapId);
  const activeTilemapId = useEditorStore((s) => s.activeTilemapId);
  const activeProjectDir = useEditorStore((s) => s.activeProjectDir);

  const {
    src: url,
    setLoaded,
    setFailed,
  } = useProjectAssetVisualState({
    absolutePath: tilesetAbsolutePath,
    projectDir: activeProjectDir,
    relativePath: tilesetRelativePath,
  });
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    if (!url) return;
    const img = new Image();
    img.onload = () => {
      setLoaded();
      setDims({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = () => {
      setFailed();
      setDims(null);
    };
    img.src = url;
  }, [setFailed, setLoaded, url]);

  const grid = useMemo(() => {
    if (!dims || tileSize <= 0) return null;
    const cols = Math.max(0, Math.floor(dims.w / tileSize));
    const rows = Math.max(0, Math.floor(dims.h / tileSize));
    if (cols === 0 || rows === 0) return null;
    return { cols, rows };
  }, [dims, tileSize]);

  function handlePickTile(tileIndex: number) {
    setActiveBrush({
      kind: "tile",
      id: `tile:${tileIndex}`,
      assetPath: tilesetRelativePath,
      tileIndex,
    });
    setEditorMode("paint");
    setActiveTilemapId(tilemapEntityId);
  }

  const activeTileIndex =
    activeBrush?.kind === "tile" ? (activeBrush.tileIndex ?? 0) : null;

  const lockedToThisTilemap =
    activeTilemapId === tilemapEntityId && activeBrush?.kind === "tile";

  return (
    <div className="shrink-0 border-b border-[#313244] px-3 py-2">
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] font-bold text-[#7f849c] uppercase tracking-wider">
          Tilemap: Paleta de Tiles
        </h4>
        {lockedToThisTilemap && (
          <span className="rounded border border-[#a6e3a1]/40 bg-[#a6e3a1]/10 px-1 py-0.5 text-[8px] font-mono text-[#a6e3a1]">
            ATIVO
          </span>
        )}
      </div>

      {/* Tool toolbar */}
      <div className="mt-2 flex gap-1">
        {TILE_TOOL_ORDER.map((tool) => {
          const meta = TILE_TOOL_META[tool];
          const isActive = tilePaintTool === tool;
          return (
            <button
              key={tool}
              type="button"
              title={meta.hint}
              onClick={() => {
                setTilePaintTool(tool);
                setEditorMode("paint");
                setActiveTilemapId(tilemapEntityId);
              }}
              className={`flex-1 rounded border px-1 py-1 text-[10px] transition-colors ${
                isActive
                  ? "bg-[#89b4fa]/20 border-[#89b4fa] text-[#89b4fa]"
                  : "border-[#313244] bg-[#181825] text-[#a6adc8] hover:border-[#45475a]"
              }`}
            >
              {meta.icon}
            </button>
          );
        })}
      </div>

      {/* Status readout */}
      <div className="mt-2 flex items-center justify-between text-[9px] text-[#7f849c]">
        <span>
          Tile ativo:{" "}
          <span className="font-mono text-[#cdd6f4]">
            #{activeTileIndex ?? "—"}
          </span>
        </span>
        <span>
          Tool:{" "}
          <span className="font-mono uppercase text-[#89b4fa]">
            {TILE_TOOL_META[tilePaintTool].label}
          </span>
        </span>
      </div>

      {/* Tile grid */}
      {grid ? (
        <div
          className="mt-2 grid gap-[1px] overflow-hidden rounded border border-[#313244] bg-[#11111b]"
          style={{ gridTemplateColumns: `repeat(${grid.cols}, 1fr)` }}
        >
          {/* Index 0 = vazio */}
          <button
            type="button"
            title="Tile vazio (0) — use com borracha"
            onClick={() => handlePickTile(0)}
            className={`aspect-square bg-[#313244]/40 hover:bg-[#f38ba8]/20 transition-colors ${
              activeTileIndex === 0 ? "ring-2 ring-inset ring-[#f38ba8]" : ""
            }`}
          >
            <span className="text-[7px] text-[#45475a]">×</span>
          </button>
          {Array.from({ length: grid.cols * grid.rows - 1 }, (_, i) => {
            const tileIndex = i + 1;
            const atlasIdx = tileIndex - 1;
            const col = atlasIdx % grid.cols;
            const row = Math.floor(atlasIdx / grid.cols);
            return (
              <button
                key={tileIndex}
                type="button"
                title={`Tile #${tileIndex} (col ${col}, row ${row})`}
                onClick={() => handlePickTile(tileIndex)}
                className={`aspect-square transition-transform hover:scale-105 ${
                  activeTileIndex === tileIndex
                    ? "ring-2 ring-inset ring-[#89b4fa]"
                    : ""
                }`}
                style={{
                  backgroundImage: `url(${url})`,
                  backgroundSize: `${grid.cols * 100}% ${grid.rows * 100}%`,
                  backgroundPosition: `${(col * 100) / Math.max(1, grid.cols - 1)}% ${
                    (row * 100) / Math.max(1, grid.rows - 1)
                  }%`,
                  backgroundRepeat: "no-repeat",
                  imageRendering: "pixelated",
                }}
              />
            );
          })}
        </div>
      ) : (
        <p className="mt-2 text-[9px] text-[#45475a]">
          Carregando tileset ou dimensões não-múltiplas de {tileSize}px.
        </p>
      )}
    </div>
  );
}

export default function ContextualPalette() {
  const activeProjectDir = useEditorStore((s) => s.activeProjectDir);
  const activeViewportTab = useEditorStore((s) => s.activeViewportTab);
  const activeBrush = useEditorStore((s) => s.activeBrush);
  const editorMode = useEditorStore((s) => s.editorMode);
  const setActiveBrush = useEditorStore((s) => s.setActiveBrush);
  const setEditorMode = useEditorStore((s) => s.setEditorMode);
  const activeScene = useEditorStore((s) => s.activeScene);
  const selectedEntityId = useEditorStore((s) => s.selectedEntityId);
  const tilePaintSize = useEditorStore((s) => s.tilePaintSize);

  const isSceneTab = activeViewportTab === "scene";

  const [assets, setAssets] = useState<ProjectAssetEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<PaletteCategory>>(new Set());

  useEffect(() => {
    if (!activeProjectDir) {
      setAssets([]);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void listProjectAssets(activeProjectDir)
      .then((result) => {
        if (!cancelled) {
          setAssets(result);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeProjectDir]);

  // Resolve a tilemap selecionada (se houver) e o asset do tileset
  const selectedTilemap = useMemo(() => {
    if (!selectedEntityId || !activeScene) return null;
    const entity = activeScene.entities.find((e) => e.entity_id === selectedEntityId);
    const tm = entity?.components?.tilemap;
    if (!entity || !tm) return null;
    return { entity, tileset: tm.tileset };
  }, [activeScene, selectedEntityId]);

  const selectedTilesetAsset = useMemo(() => {
    if (!selectedTilemap) return null;
    return assets.find((a) => a.relative_path === selectedTilemap.tileset) ?? null;
  }, [assets, selectedTilemap]);

  const resolvedTilesetAbsolutePath = useMemo(() => {
    if (!selectedTilemap) return "";
    if (selectedTilesetAsset?.absolute_path) {
      return selectedTilesetAsset.absolute_path;
    }
    if (!activeProjectDir) {
      return "";
    }
    return resolveProjectAssetPath(activeProjectDir, selectedTilemap.tileset);
  }, [activeProjectDir, selectedTilemap, selectedTilesetAsset]);

  const groupedItems = useMemo(() => {
    const groups = new Map<PaletteCategory, PaletteCategoryItem[]>();

    for (const asset of assets) {
      const category = inferCategory(asset);
      const paintable = category === "sprites" || category === "prefabs";
      const item: PaletteCategoryItem = {
        id: asset.relative_path,
        label: displayLabel(asset.relative_path),
        category,
        assetPath: asset.relative_path,
        absolutePath: asset.absolute_path,
        paintable,
      };
      const bucket = groups.get(category) ?? [];
      bucket.push(item);
      groups.set(category, bucket);
    }

    return groups;
  }, [assets]);

  function handleSelect(item: PaletteCategoryItem) {
    if (!item.paintable) return;

    const brush: ActiveBrush = {
      kind: "prefab",
      id: item.id,
      assetPath: item.assetPath,
    };
    setActiveBrush(brush);
    setEditorMode("paint");
  }

  function handleClearBrush() {
    setActiveBrush(null);
    setEditorMode("select");
  }

  function toggleCategory(cat: PaletteCategory) {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  }

  const modeLabel: Record<EditorMode, string> = {
    select: "Sele\u00e7\u00e3o",
    paint: "Pintura",
    erase: "Borracha",
    collision: "Colis\u00e3o",
  };

  if (!isSceneTab) {
    return (
      <div className="flex flex-col h-full items-center justify-center bg-[#1e1e2e] p-6 text-center">
        <p className="text-[11px] font-semibold text-[#7f849c]">
          Abra a aba Cena para usar a paleta
        </p>
        <p className="mt-2 text-[10px] text-[#45475a] leading-relaxed">
          A paleta de sprites, prefabs e o modo colisão estão disponíveis apenas quando a aba &quot;SC Cena&quot; está ativa no viewport.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#1e1e2e] overflow-x-hidden">
      <div className="shrink-0 border-b border-[#313244] px-3 py-2">
        <h3 className="text-[10px] font-bold text-[#7f849c] uppercase tracking-wider">
          Paleta de Assets
        </h3>
        <p className="text-[9px] text-[#45475a] mt-0.5">
          Selecione um sprite ou prefab para pintar. Atalhos: V/B/E.
        </p>
      </div>

      {/* ── Tile palette (tilemap selecionado) ─────────────────────── */}
      {selectedTilemap && resolvedTilesetAbsolutePath.length > 0 && (
        <TilePalette
          tilesetAbsolutePath={resolvedTilesetAbsolutePath}
          tilesetRelativePath={selectedTilemap.tileset}
          tileSize={tilePaintSize > 0 ? tilePaintSize : 8}
          tilemapEntityId={selectedTilemap.entity.entity_id}
        />
      )}

      {/* ── Collision toggle ─────────────────────────────────────── */}
      <div className="shrink-0 border-b border-[#313244] px-3 py-2">
        <div className="relative group/toggle">
          <button
            type="button"
            onClick={() => setEditorMode(editorMode === "collision" ? "select" : "collision")}
            className={`flex w-full items-center justify-center gap-1.5 rounded px-2 py-1.5 text-[10px] font-semibold transition-all ${
              editorMode === "collision"
                ? "bg-[#f38ba8]/25 border border-[#f38ba8] text-[#f38ba8] shadow-sm"
                : "border border-[#313244] bg-[#181825] text-[#a6adc8] hover:border-[#45475a] hover:bg-[#313244]/50"
            }`}
          >
            <span className="text-[12px]">{editorMode === "collision" ? "\u25a0" : "\u25a1"}</span>
            <span>{editorMode === "collision" ? "Sair do modo colisão" : "Modo colisão"}</span>
          </button>
          <div className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 -translate-x-1/2 whitespace-nowrap rounded border border-[#313244] bg-[#11111b] px-2 py-1.5 text-[9px] text-[#a6adc8] opacity-0 shadow-lg transition-opacity duration-150 group-hover/toggle:opacity-100">
            Ativar modo de colisão (atalho: C)
          </div>
        </div>
        {editorMode === "collision" && (
          <p className="text-[9px] text-[#f38ba8]/70 mt-1 leading-snug">
            👉 Esq: sólido · Dir: livre · Esc: sair
          </p>
        )}
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3">
        {loading && (
          <p className="text-[10px] text-[#89b4fa]">Carregando assets...</p>
        )}
        {error && (
          <p className="text-[10px] text-[#f38ba8]">{error}</p>
        )}
        {!loading && !error && assets.length === 0 && activeProjectDir && (
          <p className="text-[10px] text-[#45475a]">
            Nenhum asset encontrado. Adicione sprites em assets/sprites/.
          </p>
        )}
        {!activeProjectDir && (
          <p className="text-[10px] text-[#45475a]">
            Abra um projeto para ver os assets disponiveis.
          </p>
        )}

        {CATEGORY_ORDER.map((category) => {
          const items = groupedItems.get(category);
          if (!items || items.length === 0) return null;
          const meta = CATEGORY_META[category];
          const isCollapsed = collapsedCategories.has(category);

          return (
            <div key={category} className="mb-3">
              <button
                type="button"
                onClick={() => toggleCategory(category)}
                className="flex w-full items-center gap-1.5 py-1 text-[10px] font-bold text-[#7f849c] uppercase tracking-wider hover:text-[#a6adc8] transition-colors"
              >
                <span className="text-[8px]">{isCollapsed ? "\u25b8" : "\u25be"}</span>
                <span>{meta.icon} {meta.label}</span>
                <span className="ml-auto font-mono text-[#45475a] normal-case">{items.length}</span>
              </button>
              {!isCollapsed && (
                <div className="grid grid-cols-2 gap-1.5 mt-1">
                  {items.map((item) => (
                    <PaletteItem
                      key={item.id}
                      item={item}
                      isActive={activeBrush?.id === item.id}
                      onSelect={() => handleSelect(item)}
                      projectDir={activeProjectDir}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-auto shrink-0 border-t border-[#313244] bg-[#1e1e2e] px-3 py-2">
        <div className="flex items-center justify-between text-[10px] text-[#7f849c]">
          <span>Modo: <span
            className={`font-mono uppercase ${
              editorMode === "collision" ? "text-[#f38ba8]" : "text-[#89b4fa]"
            }`}
          >{modeLabel[editorMode]}</span></span>
          {activeBrush && editorMode !== "collision" && (
            <button
              type="button"
              onClick={handleClearBrush}
              className="rounded border border-[#313244] px-1.5 py-0.5 text-[9px] text-[#f38ba8] hover:bg-[#f38ba8]/10 transition-colors"
            >
              Limpar brush
            </button>
          )}
        </div>
        {activeBrush && (
          <p className="mt-1 min-w-0 truncate text-[9px] text-[#45475a]" title={activeBrush.assetPath ?? activeBrush.id}>
            Brush: {displayLabel(activeBrush.assetPath ?? activeBrush.id)}
          </p>
        )}
      </div>
    </div>
  );
}
