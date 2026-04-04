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
    moveLayerUp,
    moveLayerDown,
    assignEntityToLayer,
    setEditorMode,
    logMessage,
  } = useEditorStore();

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [newLayerName, setNewLayerName] = useState("Nova Camada");
  const [newLayerKind, setNewLayerKind] = useState("sprite");
  const [showCreate, setShowCreate] = useState(false);

  const layers: SceneLayer[] = activeScene?.layers ?? [];
  const selectedEntityIsAssignable =
    Boolean(selectedEntityId) && !selectedEntityId?.startsWith("layer::");

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

  function handleSelectLayer(layer: SceneLayer) {
    const isNewSelection = activeLayerId !== layer.id;
    setActiveLayerId(isNewSelection ? layer.id : null);

    if (isNewSelection) {
      if (layer.kind === "collision") {
        setEditorMode("collision");
      } else if (layer.kind === "sprite" || layer.kind === "tile") {
        setEditorMode("paint");
      }
    }
  }

  function handleMoveUp(e: React.MouseEvent, layerId: string) {
    e.stopPropagation();
    void persistAfter(() => moveLayerUp(layerId));
  }

  function handleMoveDown(e: React.MouseEvent, layerId: string) {
    e.stopPropagation();
    void persistAfter(() => moveLayerDown(layerId));
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
        <div className="flex items-center gap-1">
          {activeLayerId ? (
            <button
              type="button"
              onClick={() => setActiveLayerId(null)}
              title="Limpar camada ativa"
              className="rounded border border-[#313244] px-1.5 py-0.5 text-[10px] text-[#cdd6f4] hover:border-[#89b4fa] hover:text-[#89b4fa]"
            >
              Limpar
            </button>
          ) : null}
          <button
            onClick={() => setShowCreate((v) => !v)}
            title="Adicionar camada"
            className="rounded bg-[#313244] px-1.5 py-0.5 text-[10px] hover:bg-[#45475a]"
          >
            + Camada
          </button>
        </div>
      </div>

      <div
        data-testid="layer-panel-summary"
        className="border-b border-[#313244] bg-[#11111b] px-2 py-2 text-[10px] text-[#7f849c]"
      >
        <div className="flex flex-wrap gap-1.5">
          <span className="rounded-full border border-[#313244] bg-[#181825] px-2 py-0.5">
            Camadas: <span className="font-semibold text-[#cdd6f4]">{layers.length}</span>
          </span>
          <span className="rounded-full border border-[#313244] bg-[#181825] px-2 py-0.5">
            Ativa:{" "}
            <span className="font-semibold text-[#cdd6f4]">
              {selectedLayer?.name ?? "Nenhuma"}
            </span>
          </span>
          {selectedEntityIsAssignable ? (
            <span className="rounded-full border border-[#313244] bg-[#181825] px-2 py-0.5">
              Entidade: <span className="font-semibold text-[#cdd6f4]">{selectedEntityId}</span>
            </span>
          ) : null}
        </div>
        <p className="mt-2 leading-5 text-[#94a3b8]">
          {selectedLayer
            ? `${KIND_LABELS[selectedLayer.kind] ?? selectedLayer.kind} · ${
                selectedLayer.visible ? "visível" : "oculta"
              } · ${selectedLayer.locked ? "bloqueada" : "editável"} · ${
                selectedLayer.entity_ids.length
              } entidade(s).`
            : "Selecione uma camada para controlar visibilidade, lock e organização da cena ativa."}
        </p>
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
            Sem camadas. Clique em &quot;+ Camada&quot; para organizar sprites, tiles e objetos da
            cena ativa.
          </div>
        )}
        {[...layers].sort((a, b) => b.depth - a.depth).map((layer) => (
          <div
            key={layer.id}
            data-testid={`layer-row-${layer.id}`}
            onClick={() => handleSelectLayer(layer)}
            className={`group flex cursor-pointer items-center gap-1 border-b border-[#313244] px-2 py-1 transition-colors ${
              activeLayerId === layer.id
                ? "bg-[#313244] ring-1 ring-inset ring-[#89b4fa]/30"
                : "hover:bg-[#1e1e2e]"
            }`}
          >
            {/* Reorder buttons */}
            <div className="flex flex-col gap-0.5 mr-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={(e) => handleMoveUp(e, layer.id)}
                className="text-[8px] hover:text-[#89b4fa]"
                title="Mover para cima (Frente)"
              >
                ▲
              </button>
              <button
                onClick={(e) => handleMoveDown(e, layer.id)}
                className="text-[8px] hover:text-[#89b4fa]"
                title="Mover para baixo (Trás)"
              >
                ▼
              </button>
            </div>
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

      {!activeLayerId && selectedEntityIsAssignable && layers.length > 0 && (
        <div
          data-testid="layer-panel-assignment-hint"
          className="border-t border-[#313244] bg-[#11111b] p-2 text-[10px] text-[#94a3b8]"
        >
          Selecione uma camada para atribuir <span className="font-semibold text-[#cdd6f4]">{selectedEntityId}</span>{" "}
          ao grupo correto.
        </div>
      )}
    </div>
  );
}
