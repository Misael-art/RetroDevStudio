import { useEffect } from "react";
import Panel from "../common/Panel";
import { useEditorStore } from "../../core/store/editorStore";
import { getSceneData, parseScene } from "../../core/ipc/sceneService";

const TYPE_ICON: Record<string, string> = {
  sprite:  "◈",
  tilemap: "▦",
  camera:  "⊙",
  layer:   "▬",
};

function entityType(entity: { components?: { sprite?: unknown; collision?: unknown } }): string {
  if (entity.components?.sprite) return "sprite";
  return "object";
}

export default function HierarchyPanel() {
  const {
    selectedEntityId, setSelectedEntityId,
    activeProjectDir,
    activeScene, setActiveScene,
    logMessage,
  } = useEditorStore();

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

  return (
    <Panel
      title="Hierarchy"
      className="h-full"
      headerActions={
        <button
          className="text-xs text-[#6c7086] hover:text-[#cdd6f4] transition-colors px-1"
          title="Adicionar entidade (em breve)"
          disabled
        >
          +
        </button>
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
  );
}
