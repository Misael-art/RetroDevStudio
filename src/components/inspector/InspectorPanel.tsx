import { useState, useEffect, useRef } from "react";
import Panel from "../common/Panel";
import { useEditorStore } from "../../core/store/editorStore";
import HardwareLimitsPanel from "./HardwareLimitsPanel";
import { saveSceneData } from "../../core/ipc/sceneService";
import type { Entity, BackgroundLayer } from "../../core/ipc/sceneService";

// ── Prop row: exibe e edita um par chave/valor ─────────────────────────────────

interface PropRowProps {
  label: string;
  value: string | number | boolean;
  type: "string" | "int" | "bool";
  onChange: (val: string | number | boolean) => void;
}

function PropRow({ label, value, type, onChange }: PropRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  useEffect(() => { setDraft(String(value)); }, [value]);

  function commit() {
    setEditing(false);
    if (type === "int") {
      const n = parseInt(draft, 10);
      if (!isNaN(n)) onChange(n);
    } else if (type === "bool") {
      onChange(draft === "true");
    } else {
      onChange(draft);
    }
  }

  return (
    <tr className="border-b border-[#313244] last:border-0 group">
      <td className="px-3 py-1.5 text-[#7f849c] w-1/2 select-none text-xs">{label}</td>
      <td className="px-3 py-1.5 text-xs">
        {editing ? (
          type === "bool" ? (
            <select
              autoFocus
              value={draft}
              className="bg-[#1e1e2e] border border-[#cba6f7] rounded px-1 py-0.5 text-xs text-[#cdd6f4] w-full focus:outline-none"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
            >
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          ) : (
            <input
              autoFocus
              type={type === "int" ? "number" : "text"}
              value={draft}
              className="bg-[#1e1e2e] border border-[#cba6f7] rounded px-1 py-0.5 text-xs text-[#cdd6f4] w-full font-mono focus:outline-none"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => e.key === "Enter" && commit()}
            />
          )
        ) : (
          <span
            className="text-[#cdd6f4] font-mono cursor-pointer hover:text-[#cba6f7] transition-colors"
            onClick={() => setEditing(true)}
            title="Clique para editar"
          >
            {String(value)}
          </span>
        )}
      </td>
    </tr>
  );
}

// ── Extrai props de uma Entity para exibir no Inspector ────────────────────────

interface PropDef {
  key: string;
  path: string[];
  type: "string" | "int" | "bool";
}

function entityProps(entity: Entity): PropDef[] {
  const defs: PropDef[] = [
    { key: "ID",    path: ["entity_id"],      type: "string" },
    { key: "Prefab",path: ["prefab"],          type: "string" },
    { key: "Pos X", path: ["transform", "x"], type: "int"    },
    { key: "Pos Y", path: ["transform", "y"], type: "int"    },
  ];
  if (entity.components?.sprite) {
    defs.push(
      { key: "Asset",       path: ["components", "sprite", "asset"],        type: "string" },
      { key: "Frame W",     path: ["components", "sprite", "frame_width"],  type: "int"    },
      { key: "Frame H",     path: ["components", "sprite", "frame_height"], type: "int"    },
      { key: "Palette Slot",path: ["components", "sprite", "palette_slot"], type: "int"    },
      { key: "Priority",    path: ["components", "sprite", "priority"],     type: "string" },
    );
  }
  if (entity.components?.collision) {
    defs.push(
      { key: "Col. Shape",  path: ["components", "collision", "shape"],  type: "string" },
      { key: "Col. Width",  path: ["components", "collision", "width"],  type: "int"    },
      { key: "Col. Height", path: ["components", "collision", "height"], type: "int"    },
      { key: "Solid",       path: ["components", "collision", "solid"],  type: "bool"   },
    );
  }
  return defs;
}

function getPath(obj: unknown, path: string[]): string | number | boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = obj;
  for (const key of path) {
    if (cur == null) return "";
    cur = cur[key];
  }
  return cur ?? "";
}

// ── Main InspectorPanel ────────────────────────────────────────────────────────

export default function InspectorPanel() {
  const {
    selectedEntityId,
    activeScene,
    updateEntity,
    updateBackgroundLayer,
    logMessage,
  } = useEditorStore();

  const [saving, setSaving] = useState(false);
  // Debounce timer para auto-save (600ms após última edição)
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Entidade ou layer selecionada
  const isLayer = selectedEntityId?.startsWith("layer::");
  const entity = isLayer
    ? null
    : activeScene?.entities.find((e) => e.entity_id === selectedEntityId) ?? null;
  const layer = isLayer
    ? activeScene?.background_layers.find((l) => `layer::${l.layer_id}` === selectedEntityId) ?? null
    : null;

  // Salva a cena — usado pelo auto-save e pelo botão manual
  async function saveScene() {
    const { activeScene: scene, activeProjectDir: dir } = useEditorStore.getState();
    if (!dir || !scene) return;
    setSaving(true);
    try {
      const result = await saveSceneData(dir, JSON.stringify(scene, null, 2));
      if (!result.ok) logMessage("error", `[Inspector] ${result.message}`);
    } finally {
      setSaving(false);
    }
  }

  // Dispara auto-save com debounce de 600ms após cada edição
  function scheduleAutoSave() {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(saveScene, 600);
  }

  function handleChange(entity: Entity, def: PropDef, val: string | number | boolean) {
    if (def.path.length === 1) {
      updateEntity(entity.entity_id, { [def.path[0]]: val } as Partial<Entity>);
    } else if (def.path[0] === "transform" && def.path.length === 2) {
      updateEntity(entity.entity_id, { transform: { ...entity.transform, [def.path[1]]: val } });
    } else if (def.path[0] === "components" && def.path[1] === "sprite" && def.path.length === 3) {
      updateEntity(entity.entity_id, {
        components: { ...entity.components, sprite: { ...entity.components.sprite!, [def.path[2]]: val } },
      });
    } else if (def.path[0] === "components" && def.path[1] === "collision" && def.path.length === 3) {
      updateEntity(entity.entity_id, {
        components: { ...entity.components, collision: { ...entity.components.collision!, [def.path[2]]: val } },
      });
    }
    scheduleAutoSave();
  }

  function handleLayerChange(layer: BackgroundLayer, field: keyof BackgroundLayer, val: string | number) {
    updateBackgroundLayer(layer.layer_id, { [field]: val } as Partial<BackgroundLayer>);
    scheduleAutoSave();
  }

  return (
    <Panel title="Inspector" className="h-full flex flex-col">
      {/* Entity / Layer properties */}
      <div className="flex-1 overflow-auto">
        {!selectedEntityId ? (
          <p className="px-3 py-4 text-xs text-[#45475a] italic">
            Selecione uma entidade na Hierarchy.
          </p>
        ) : entity ? (
          <>
            <table className="w-full text-xs">
              <tbody>
                {entityProps(entity).map((def) => (
                  <PropRow
                    key={def.key}
                    label={def.key}
                    value={getPath(entity, def.path)}
                    type={def.type}
                    onChange={(val) => handleChange(entity, def, val)}
                  />
                ))}
              </tbody>
            </table>
            {/* Save button — auto-save ocorre 600ms após edição; botão manual disponível */}
            <div className="px-3 py-2">
              <button
                onClick={saveScene}
                disabled={saving}
                className={`w-full py-1 text-xs font-semibold rounded transition-colors ${
                  saving
                    ? "bg-[#45475a] text-[#6c7086] cursor-not-allowed"
                    : "bg-[#313244] text-[#cba6f7] hover:bg-[#45475a]"
                }`}
              >
                {saving ? "Salvando..." : "💾 Salvar Cena"}
              </button>
            </div>
          </>
        ) : layer ? (
          <>
            <table className="w-full text-xs">
              <tbody>
                <tr className="border-b border-[#313244]">
                  <td className="px-3 py-1.5 text-[#7f849c] w-1/2 select-none text-xs">ID</td>
                  <td className="px-3 py-1.5 text-[#cdd6f4] font-mono text-xs">{layer.layer_id}</td>
                </tr>
                <PropRow
                  label="Depth"
                  value={layer.depth}
                  type="int"
                  onChange={(val) => handleLayerChange(layer, "depth", val as number)}
                />
                <PropRow
                  label="Tileset"
                  value={layer.tileset}
                  type="string"
                  onChange={(val) => handleLayerChange(layer, "tileset", val as string)}
                />
              </tbody>
            </table>
            <div className="px-3 py-2">
              <button
                onClick={saveScene}
                disabled={saving}
                className={`w-full py-1 text-xs font-semibold rounded transition-colors ${
                  saving
                    ? "bg-[#45475a] text-[#6c7086] cursor-not-allowed"
                    : "bg-[#313244] text-[#cba6f7] hover:bg-[#45475a]"
                }`}
              >
                {saving ? "Salvando..." : "💾 Salvar Cena"}
              </button>
            </div>
          </>
        ) : null}
      </div>

      {/* Hardware Limits panel — always visible at the bottom */}
      <div className="border-t border-[#313244] shrink-0">
        <HardwareLimitsPanel />
      </div>
    </Panel>
  );
}
