import Panel from "../common/Panel";
import { useEditorStore } from "../../core/store/editorStore";
import HardwareLimitsPanel from "./HardwareLimitsPanel";

// Placeholder properties — Sprint 1.2 will bind to real UGDM entity data
const PLACEHOLDER_PROPS: Record<string, Array<{ key: string; value: string; type: string }>> = {
  "entity-1": [
    { key: "Name",    value: "Player",  type: "string" },
    { key: "Pos X",   value: "0",       type: "int" },
    { key: "Pos Y",   value: "0",       type: "int" },
    { key: "Width",   value: "32",      type: "int" },
    { key: "Height",  value: "32",      type: "int" },
    { key: "Visible", value: "true",    type: "bool" },
  ],
  "entity-2": [
    { key: "Name",   value: "Background", type: "string" },
    { key: "Plane",  value: "A",          type: "string" },
    { key: "Scroll", value: "0",          type: "int" },
  ],
  "entity-3": [
    { key: "Name",   value: "Enemy_01", type: "string" },
    { key: "Pos X",  value: "128",      type: "int" },
    { key: "Pos Y",  value: "96",       type: "int" },
    { key: "Health", value: "3",        type: "int" },
  ],
};

export default function InspectorPanel() {
  const { selectedEntityId } = useEditorStore();
  const props = selectedEntityId ? PLACEHOLDER_PROPS[selectedEntityId] : null;

  return (
    <Panel title="Inspector" className="h-full flex flex-col">
      {/* Entity properties */}
      <div className="flex-1 overflow-auto">
        {!selectedEntityId ? (
          <p className="px-3 py-4 text-xs text-[#45475a] italic">
            Selecione uma entidade na Hierarchy.
          </p>
        ) : props ? (
          <table className="w-full text-xs">
            <tbody>
              {props.map(({ key, value, type }) => (
                <tr key={key} className="border-b border-[#313244] last:border-0 group">
                  <td className="px-3 py-1.5 text-[#7f849c] w-1/2 select-none">{key}</td>
                  <td className="px-3 py-1.5 text-[#cdd6f4] font-mono">
                    {value}
                    <span className="ml-2 text-[#45475a] text-[10px] opacity-0 group-hover:opacity-100 transition-opacity">
                      {type}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>

      {/* Hardware Limits panel — always visible at the bottom */}
      <div className="border-t border-[#313244] shrink-0">
        <HardwareLimitsPanel />
      </div>
    </Panel>
  );
}
