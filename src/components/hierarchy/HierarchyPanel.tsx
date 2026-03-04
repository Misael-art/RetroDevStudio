import { useEffect, useState } from "react";
import Panel from "../common/Panel";
import { useEditorStore } from "../../core/store/editorStore";
import { getSceneData, parseScene } from "../../core/ipc/sceneService";
import { persistActiveScene } from "../../core/scenePersistence";

const TYPE_ICON: Record<string, string> = {
  sprite:  "◈",
  tilemap: "▦",
  camera:  "⊙",
  layer:   "▬",
};

function entityType(entity: { components?: { sprite?: unknown; collision?: unknown; tilemap?: unknown; camera?: unknown } }): string {
  if (entity.components?.camera)  return "camera";
  if (entity.components?.tilemap) return "tilemap";
  if (entity.components?.sprite)  return "sprite";
  return "object";
}

export default function HierarchyPanel() {
  const {
    selectedEntityId, setSelectedEntityId,
    activeProjectDir,
    activeScene, setActiveScene,
    addEntity, removeEntity,
    logMessage,
  } = useEditorStore();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newName, setNewName] = useState("Entity");
  const [isAdding, setIsAdding] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Recarrega cena sempre que o projeto ativo mudar
  useEffect(() => {
    let cancelled = false;

    if (!activeProjectDir) {
      setActiveScene(null);
      return;
    }

    getSceneData(activeProjectDir)
      .then((result) => {
        if (cancelled) return;

        const scene = parseScene(result);
        setActiveScene(scene);
        if (!result.ok) {
          logMessage("warn", `[Hierarchy] ${result.error}`);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        logMessage("error", `[Hierarchy] Falha ao carregar cena: ${String(error)}`);
        setActiveScene(null);
      });

    return () => {
      cancelled = true;
    };
  }, [activeProjectDir, logMessage, setActiveScene]);

  const entities = activeScene?.entities ?? [];
  const bgLayers = activeScene?.background_layers ?? [];

  async function handleAddEntity() {
    const prefab = newName.trim();
    if (!activeProjectDir || !activeScene || !prefab || isAdding) return;

    const id = `${prefab.toLowerCase().replace(/\s+/g, "_")}_${Date.now()}`;
    const newEntity = {
      entity_id: id,
      prefab,
      transform: { x: 16, y: 16 },
      components: {},
    };

    addEntity(newEntity);
    setSelectedEntityId(id);
    setIsAdding(true);

    const saved = await persistActiveScene(activeProjectDir, "Hierarchy", `Entidade '${newEntity.prefab}' adicionada.`);
    setIsAdding(false);

    if (saved) {
      setShowAddDialog(false);
      setNewName("Entity");
      return;
    }

    const { activeScene: reloadedScene } = useEditorStore.getState();
    const entityStillExists = reloadedScene?.entities.some((entity) => entity.entity_id === id) ?? false;
    if (!entityStillExists) {
      setSelectedEntityId(null);
    }
  }

  async function handleDeleteEntity() {
    if (!activeProjectDir || !activeScene || !selectedEntityId || selectedEntityId.startsWith("layer::") || isDeleting) {
      return;
    }

    const entityId = selectedEntityId;
    const name = activeScene.entities.find((entity) => entity.entity_id === entityId)?.prefab ?? entityId;
    removeEntity(entityId);
    setIsDeleting(true);

    const saved = await persistActiveScene(activeProjectDir, "Hierarchy", `Entidade '${name}' removida.`);
    setIsDeleting(false);

    if (saved) {
      return;
    }

    const { activeScene: reloadedScene } = useEditorStore.getState();
    const entityStillExists = reloadedScene?.entities.some((entity) => entity.entity_id === entityId) ?? false;
    if (entityStillExists) {
      setSelectedEntityId(entityId);
    }
  }

  return (
    <>
    {/* ── Modal: Nova Entidade ── */}
    {showAddDialog && (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
        <div className="bg-[#181825] border border-[#313244] rounded-lg p-4 w-60 flex flex-col gap-3 shadow-2xl">
          <h2 className="text-xs font-bold text-[#cba6f7]">Nova Entidade</h2>
          <input
            autoFocus
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddEntity()}
            className="bg-[#1e1e2e] border border-[#313244] rounded px-2 py-1.5 text-xs text-[#cdd6f4] focus:outline-none focus:border-[#cba6f7]"
            placeholder="Nome da entidade"
            disabled={isAdding}
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setShowAddDialog(false)}
              disabled={isAdding}
              className="px-2 py-1 text-xs rounded bg-[#313244] text-[#a6adc8] hover:bg-[#45475a] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Cancelar
            </button>
            <button
              onClick={handleAddEntity}
              disabled={isAdding}
              className="px-2 py-1 text-xs rounded bg-[#cba6f7] text-[#1e1e2e] font-semibold hover:bg-[#b4a0e0] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isAdding ? "Salvando..." : "Criar"}
            </button>
          </div>
        </div>
      </div>
    )}

    <Panel
      title="Hierarchy"
      className="h-full"
      headerActions={
        <div className="flex gap-1">
          <button
            onClick={() => { setNewName("Entity"); setShowAddDialog(true); }}
            disabled={!activeProjectDir || isAdding || isDeleting}
            className="text-xs text-[#6c7086] hover:text-[#a6e3a1] transition-colors px-1 disabled:opacity-30"
            title="Adicionar entidade"
          >
            +
          </button>
          <button
            onClick={handleDeleteEntity}
            disabled={!selectedEntityId || !!selectedEntityId?.startsWith("layer::") || isAdding || isDeleting}
            className="text-xs text-[#6c7086] hover:text-[#f38ba8] transition-colors px-1 disabled:opacity-30"
            title="Remover entidade selecionada"
          >
            −
          </button>
        </div>
      }
    >
      <ul className="py-1">
        {/* Background Layers */}
        {bgLayers.map((layer) => {
          const id = `layer::${layer.layer_id}`;
          const isSelected = id === selectedEntityId;
          return (
            <li
              key={id}
              onClick={() => setSelectedEntityId(id)}
              className={[
                "flex items-center gap-2 px-3 py-1 cursor-pointer select-none text-xs transition-colors",
                isSelected
                  ? "bg-[#313244] text-[#cdd6f4]"
                  : "text-[#a6adc8] hover:bg-[#24243a] hover:text-[#cdd6f4]",
              ].join(" ")}
            >
              <span className="text-[#7f849c]">{TYPE_ICON.layer}</span>
              <span>{layer.layer_id}</span>
              <span className="ml-auto text-[#45475a]">layer</span>
            </li>
          );
        })}

        {/* Entities */}
        {entities.map((entity) => {
          const isSelected = entity.entity_id === selectedEntityId;
          const type = entityType(entity);
          return (
            <li
              key={entity.entity_id}
              onClick={() => setSelectedEntityId(entity.entity_id)}
              className={[
                "flex items-center gap-2 px-3 py-1 cursor-pointer select-none text-xs transition-colors",
                isSelected
                  ? "bg-[#313244] text-[#cdd6f4]"
                  : "text-[#a6adc8] hover:bg-[#24243a] hover:text-[#cdd6f4]",
              ].join(" ")}
            >
              <span className="text-[#7f849c]">{TYPE_ICON[type] ?? "○"}</span>
              <span>{entity.prefab ?? entity.entity_id}</span>
              <span className="ml-auto text-[#45475a]">{type}</span>
            </li>
          );
        })}

        {entities.length === 0 && bgLayers.length === 0 && (
          <li className="px-3 py-4 text-xs text-[#45475a] italic">
            {activeProjectDir
              ? "Nenhuma entidade na cena."
              : "Abra um projeto (Arquivo → Abrir Projeto)."}
          </li>
        )}
      </ul>
    </Panel>
    </>
  );
}
