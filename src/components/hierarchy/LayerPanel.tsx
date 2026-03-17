import { useState } from "react";
import { useEditorStore } from "../../core/store/editorStore";
import { persistActiveScene } from "../../core/scenePersistence";
import type { SceneLayer } from "../../core/ipc/sceneService";

const KIND_LABELS: Record<string, string> = {
  sprite: "◈ Sprite",
  tile: "▦ Tile",
  background: "▬ Fundo",
  object: "○ Objeto",
};

const KIND_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "sprite", label: "Sprite" },
  { value: "tile", label: "Tile" },
  { value: "background", label: "Fundo" },
  { value: "object", label: "Objeto" },
];

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function LayerPanel() {
  const {
    activeScene,
    activeProjectDir,
    activeLayerId,
    selectedEntityId,
    setActiveLayerId,
    createLayer,
    deleteLayer,
    updateLayer,
    assignEntityToLayer,
    logMessage,
  } = useEditorStore();

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [newLayerName, setNewLayerName] = useState("Nova Camada");
  const [newLayerKind, setNewLayerKind] = useState("sprite");
  const [showCreate, setShowCreate] = useState(false);

  const layers: SceneLayer[] = activeScene?.layers ?? [];

  async function persistAfter(action: () => void) {
    action();
    if (activeProjectDir) {
      try {
        await persistActiveScene(activeProjectDir, "LayerPanel");
      } catch (error) {
        logMessage("error", `[LayerPanel] ${describeError(error)}`);
      }
    }
  }

  function handleToggleVisible(layer: SceneLayer) {
    void persistAfter(() => updateLayer(layer.id, { visible: !layer.visible }));
  }

  function handleToggleLocked(layer: SceneLayer) {
    void persistAfter(() => updateLayer(layer.id, { locked: !layer.locked }));
  }

  function handleSelectLayer(layerId: string) {
    setActiveLayerId(activeLayerId === layerId ? null : layerId);
  }

  function handleStartRename(layer: SceneLayer) {
    setRenamingId(layer.id);
    setRenameValue(layer.name);
  }

  function handleCommitRename(layerId: string) {
    const trimmed = renameValue.trim();
    if (trimmed) {
      void persistAfter(() => updateLayer(layerId, { name: trimmed }));
    }
    setRenamingId(null);
  }

  function handleDeleteLayer(layerId: string) {
    void persistAfter(() => deleteLayer(layerId));
  }

  function handleCreateLayer() {
    const trimmed = newLayerName.trim();
    if (!trimmed) return;
    void persistAfter(() => createLayer(trimmed, newLayerKind));
    setShowCreate(false);
    setNewLayerName("Nova Camada");
  }

  function handleAssignEntity() {
    if (!selectedEntityId || !activeLayerId || selectedEntityId.startsWith("layer::")) return;
    void persistAfter(() => assignEntityToLayer(selectedEntityId, activeLayerId));
  }

  function handleRemoveFromLayer() {
    if (!selectedEntityId || selectedEntityId.startsWith("layer::")) return;
    void persistAfter(() => assignEntityToLayer(selectedEntityId, null));
  }

  if (!activeScene) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-[#45475a]">
        Nenhuma cena ativa
      </div>
    );
  }

  const selectedLayer = layers.find((l) => l.id === activeLayerId);
  const entityInActiveLayer =
    selectedEntityId &&
    !selectedEntityId.startsWith("layer::") &&
    selectedLayer?.entity_ids.includes(selectedEntityId);

  return (
    <div className="flex h-full flex-col gap-0 overflow-hidden text-xs text-[#cdd6f4]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#313244] px-2 py-1.5">
        <span className="font-semibold text-[#a6adc8]">Camadas</span>
        <button
          onClick={() => setShowCreate((v) => !v)}
          title="Adicionar camada"
          className="rounded bg-[#313244] px-1.5 py-0.5 text-[10px] hover:bg-[#45475a]"
        >
          + Camada
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="flex flex-col gap-1 border-b border-[#313244] bg-[#11111b] p-2">
          <input
            className="rounded border border-[#313244] bg-[#1e1e2e] px-1.5 py-0.5 text-[11px] text-[#cdd6f4] outline-none"
            value={newLayerName}
            onChange={(e) => setNewLayerName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateLayer();
              if (e.key === "Escape") setShowCreate(false);
            }}
            placeholder="Nome da camada"
            autoFocus
          />
          <select
            className="rounded border border-[#313244] bg-[#1e1e2e] px-1 py-0.5 text-[11px] text-[#cdd6f4]"
            value={newLayerKind}
            onChange={(e) => setNewLayerKind(e.target.value)}
          >
            {KIND_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <div className="flex gap-1">
            <button
              onClick={handleCreateLayer}
              className="flex-1 rounded bg-[#a6e3a1] py-0.5 text-[10px] font-semibold text-[#1e1e2e] hover:bg-[#94e2a0]"
            >
              Criar
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="flex-1 rounded bg-[#313244] py-0.5 text-[10px] hover:bg-[#45475a]"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Layer list */}
      <div className="flex-1 overflow-y-auto">
        {layers.length === 0 && (
          <div className="p-3 text-center text-[11px] text-[#45475a]">
            Sem camadas. Clique em &quot;+ Camada&quot; para criar.
          </div>
        )}
        {[...layers].sort((a, b) => b.depth - a.depth).map((layer) => (
          <div
            key={layer.id}
            onClick={() => handleSelectLayer(layer.id)}
            className={`group flex cursor-pointer items-center gap-1 border-b border-[#313244] px-2 py-1 transition-colors ${
              activeLayerId === layer.id
                ? "bg-[#313244]"
                : "hover:bg-[#1e1e2e]"
            }`}
          >
            {/* Visible toggle */}
            <button
              onClick={(e) => { e.stopPropagation(); handleToggleVisible(layer); }}
              title={layer.visible ? "Ocultar camada" : "Mostrar camada"}
              className="shrink-0 text-[13px] leading-none"
            >
              {layer.visible ? "👁" : "🚫"}
            </button>

            {/* Locked toggle */}
            <button
              onClick={(e) => { e.stopPropagation(); handleToggleLocked(layer); }}
              title={layer.locked ? "Desbloquear camada" : "Bloquear camada"}
              className="shrink-0 text-[11px] leading-none"
            >
              {layer.locked ? "🔒" : "🔓"}
            </button>

            {/* Name / rename */}
            {renamingId === layer.id ? (
              <input
                className="min-w-0 flex-1 rounded border border-[#89b4fa] bg-[#1e1e2e] px-1 py-0 text-[11px] outline-none"
                value={renameValue}
                autoFocus
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => handleCommitRename(layer.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCommitRename(layer.id);
                  if (e.key === "Escape") setRenamingId(null);
                }}
              />
            ) : (
              <span
                onDoubleClick={(e) => { e.stopPropagation(); handleStartRename(layer); }}
                className={`min-w-0 flex-1 truncate text-[11px] ${
                  layer.visible ? "text-[#cdd6f4]" : "text-[#45475a] line-through"
                }`}
                title={`${layer.name} (duplo-clique para renomear)`}
              >
                {KIND_LABELS[layer.kind] ?? layer.kind} {layer.name}
              </span>
            )}

            {/* Entity count badge */}
            <span className="shrink-0 rounded bg-[#1e1e2e] px-1 text-[10px] text-[#45475a]">
              {layer.entity_ids.length}
            </span>

            {/* Delete */}
            <button
              onClick={(e) => { e.stopPropagation(); handleDeleteLayer(layer.id); }}
              title="Remover camada"
              className="hidden shrink-0 text-[10px] text-[#f38ba8] group-hover:block"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* Entity assignment footer */}
      {activeLayerId && selectedEntityId && !selectedEntityId.startsWith("layer::") && (
        <div className="border-t border-[#313244] bg-[#11111b] p-2">
          <p className="mb-1 truncate text-[10px] text-[#a6adc8]">
            Entidade: <span className="text-[#cdd6f4]">{selectedEntityId}</span>
          </p>
          {entityInActiveLayer ? (
            <button
              onClick={handleRemoveFromLayer}
              className="w-full rounded bg-[#f38ba8] py-0.5 text-[10px] font-semibold text-[#1e1e2e] hover:bg-[#eba0ac]"
            >
              Remover da camada
            </button>
          ) : (
            <button
              onClick={handleAssignEntity}
              className="w-full rounded bg-[#a6e3a1] py-0.5 text-[10px] font-semibold text-[#1e1e2e] hover:bg-[#94e2a0]"
            >
              Atribuir à camada ativa
            </button>
          )}
        </div>
      )}
    </div>
  );
}
