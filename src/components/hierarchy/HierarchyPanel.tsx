import Panel from "../common/Panel";
import { useEditorStore } from "../../core/store/editorStore";

// Placeholder entity list — Sprint 1.2 will populate from .rds project file
const PLACEHOLDER_ENTITIES = [
  { id: "entity-1", name: "Player", type: "sprite" },
  { id: "entity-2", name: "Background", type: "tilemap" },
  { id: "entity-3", name: "Enemy_01", type: "sprite" },
];

const TYPE_ICON: Record<string, string> = {
  sprite:  "◈",
  tilemap: "▦",
  camera:  "⊙",
};

export default function HierarchyPanel() {
  const { selectedEntityId, setSelectedEntityId } = useEditorStore();

  return (
    <Panel
      title="Hierarchy"
      className="h-full"
      headerActions={
        <button
          className="text-xs text-[#6c7086] hover:text-[#cdd6f4] transition-colors px-1"
          title="Adicionar entidade"
        >
          +
        </button>
      }
    >
      <ul className="py-1">
        {PLACEHOLDER_ENTITIES.map((entity) => {
          const isSelected = entity.id === selectedEntityId;
          return (
            <li
              key={entity.id}
              onClick={() => setSelectedEntityId(entity.id)}
              className={[
                "flex items-center gap-2 px-3 py-1 cursor-pointer select-none text-xs transition-colors",
                isSelected
                  ? "bg-[#313244] text-[#cdd6f4]"
                  : "text-[#a6adc8] hover:bg-[#24243a] hover:text-[#cdd6f4]",
              ].join(" ")}
            >
              <span className="text-[#7f849c]">{TYPE_ICON[entity.type] ?? "○"}</span>
              <span>{entity.name}</span>
              <span className="ml-auto text-[#45475a]">{entity.type}</span>
            </li>
          );
        })}
      </ul>
      {PLACEHOLDER_ENTITIES.length === 0 && (
        <p className="px-3 py-4 text-xs text-[#45475a] italic">
          Nenhuma entidade na cena.
        </p>
      )}
    </Panel>
  );
}
