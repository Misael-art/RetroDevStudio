import { useEffect, useState } from "react";
import Panel from "../common/Panel";
import { useEditorStore } from "../../core/store/editorStore";
import { getSceneData, parseScene, saveSceneData } from "../../core/ipc/sceneService";

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

  // Recarrega cena sempre que o projeto ativo mudar
  useEffect(() => {
    if (!activeProjectDir) {
      setActiveScene(null);
      return;
    }
    getSceneData(activeProjectDir).then((result) => {
      const scene = parseScene(result);
      setActiveScene(scene);
      if (!result.ok) {
        logMessage("warn", `[Hierarchy] ${result.error}`);
      }
    });
  }, [activeProjectDir]);

  const entities = activeScene?.entities ?? [];
  const bgLayers = activeScene?.background_layers ?? [];

  async function handleAddEntity() {
    if (!activeProjectDir || !activeScene || !newName.trim()) return;
    const id = `${newName.trim().toLowerCase().replace(/\s+/g, "_")}_${Date.now()}`;
    const newEntity = {
      entity_id: id,
      prefab: newName.trim(),
      transform: { x: 16, y: 16 },
      components: {},
    };
    addEntity(newEntity);
    setSelectedEntityId(id);
    setShowAddDialog(false);
    setNewName("Entity");
    // Auto-save
    const updated = { ...activeScene, entities: [...activeScene.entities, newEntity] };
    const r = await saveSceneData(activeProjectDir, JSON.stringify(updated, null, 2));
    logMessage(r.ok ? "success" : "error", `[Hierarchy] ${r.ok ? `Entidade '${newEntity.prefab}' adicionada.` : r.message}`);
  }

  async function handleDeleteEntity() {
    if (!activeProjectDir || !activeScene || !selectedEntityId || selectedEntityId.startsWith("layer::")) return;
    const name = activeScene.entities.find(e => e.entity_id === selectedEntityId)?.prefab ?? selectedEntityId;
    removeEntity(selectedEntityId);
    const updated = { ...activeScene, entities: activeScene.entities.filter(e => e.entity_id !== selectedEntityId) };
    const r = await saveSceneData(activeProjectDir, JSON.stringify(updated, null, 2));
    logMessage(r.ok ? "success" : "error", `[Hierarchy] ${r.ok ? `Entidade '${name}' removida.` : r.message}`);
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
          />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowAddDialog(false)}
              className="px-2 py-1 text-xs rounded bg-[#313244] text-[#a6adc8] hover:bg-[#45475a]">
              Cancelar
            </button>
            <button onClick={handleAddEntity}
              className="px-2 py-1 text-xs rounded bg-[#cba6f7] text-[#1e1e2e] font-semibold hover:bg-[#b4a0e0]">
              Criar
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
            disabled={!activeProjectDir}
            className="text-xs text-[#6c7086] hover:text-[#a6e3a1] transition-colors px-1 disabled:opacity-30"
            title="Adicionar entidade"
          >
            +
          </button>
          <button
            onClick={handleDeleteEntity}
            disabled={!selectedEntityId || !!selectedEntityId?.startsWith("layer::")}
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
