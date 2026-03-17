import { useEffect, useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useEditorStore } from "../../core/store/editorStore";
import { listProjectAssets, type ProjectAssetEntry } from "../../core/ipc/toolsService";
import type { ActiveBrush, EditorMode } from "../../core/store/editorStore";

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
}: {
  item: PaletteCategoryItem;
  isActive: boolean;
  onSelect: () => void;
}) {
  const thumbnailUrl =
    item.category === "sprites" ? convertFileSrc(item.absolutePath) : null;

  return (
    <button
      onClick={onSelect}
      disabled={!item.paintable}
      className={`group flex flex-col items-center gap-1.5 p-2 rounded-lg border transition-all ${
        isActive
          ? "bg-[#89b4fa]/20 border-[#89b4fa]"
          : item.paintable
            ? "bg-[#181825] border-[#313244] hover:border-[#45475a]"
            : "bg-[#181825] border-[#313244] opacity-50 cursor-not-allowed"
      }`}
      title={
        item.paintable
          ? `Clique para selecionar: ${item.assetPath}`
          : `${item.assetPath} (nao pintavel)`
      }
    >
      <div
        className={`w-12 h-12 rounded flex items-center justify-center overflow-hidden ${
          isActive ? "ring-1 ring-[#89b4fa]" : ""
        }`}
      >
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={item.label}
            className="w-full h-full object-contain"
            style={{ imageRendering: "pixelated" }}
          />
        ) : (
          <span className={`text-xl ${isActive ? "text-[#89b4fa]" : "text-[#7f849c]"}`}>
            {CATEGORY_META[item.category].icon}
          </span>
        )}
      </div>
      <span
        className={`text-[10px] truncate w-full text-center ${
          isActive ? "text-[#cdd6f4] font-semibold" : "text-[#a6adc8]"
        }`}
      >
        {item.label}
      </span>
    </button>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function ContextualPalette() {
  const activeProjectDir = useEditorStore((s) => s.activeProjectDir);
  const activeBrush = useEditorStore((s) => s.activeBrush);
  const editorMode = useEditorStore((s) => s.editorMode);
  const setActiveBrush = useEditorStore((s) => s.setActiveBrush);
  const setEditorMode = useEditorStore((s) => s.setEditorMode);

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

  return (
    <div className="flex flex-col h-full bg-[#1e1e2e]">
      <div className="p-3 border-b border-[#313244]">
        <h3 className="text-[10px] font-bold text-[#7f849c] uppercase tracking-wider">
          Paleta de Assets
        </h3>
        <p className="text-[9px] text-[#45475a] mt-1">
          Selecione um sprite ou prefab para pintar na cena. Atalhos: V/B/E.
        </p>
      </div>

      {/* ── Collision section ─────────────────────────────────────── */}
      <div className="p-3 border-b border-[#313244]">
        <p className="text-[9px] font-bold text-[#7f849c] uppercase tracking-wider mb-2">
          🛡️ Colisão
        </p>
        <button
          type="button"
          onClick={() => setEditorMode(editorMode === "collision" ? "select" : "collision")}
          className={`w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded border text-[10px] font-semibold transition-colors ${
            editorMode === "collision"
              ? "bg-[#f38ba8]/20 border-[#f38ba8] text-[#f38ba8]"
              : "bg-[#181825] border-[#313244] text-[#a6adc8] hover:border-[#45475a]"
          }`}
          title="Ativar modo de colisão (atalho: C)"
        >
          <span>{editorMode === "collision" ? "\u25a0" : "\u25a1"}</span>
          <span>{editorMode === "collision" ? "Sair do modo colisão" : "Modo colisão"}</span>
        </button>
        {editorMode === "collision" && (
          <p className="text-[9px] text-[#f38ba8]/70 mt-1.5 leading-snug">
            👉 Esq: sólido · Dir: livre · Esc: sair
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
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
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {items.map((item) => (
                    <PaletteItem
                      key={item.id}
                      item={item}
                      isActive={activeBrush?.id === item.id}
                      onSelect={() => handleSelect(item)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="p-3 bg-[#181825] border-t border-[#313244]">
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
          <p className="text-[9px] text-[#45475a] mt-1 truncate" title={activeBrush.assetPath ?? activeBrush.id}>
            Brush: {displayLabel(activeBrush.assetPath ?? activeBrush.id)}
          </p>
        )}
      </div>
    </div>
  );
}
