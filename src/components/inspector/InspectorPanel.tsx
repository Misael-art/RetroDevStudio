import { useEffect, useRef, useState } from "react";
import Panel from "../common/Panel";
import HardwareLimitsPanel from "./HardwareLimitsPanel";
import { useEditorStore } from "../../core/store/editorStore";
import type { BackgroundLayer, Entity } from "../../core/ipc/sceneService";
import { persistActiveScene } from "../../core/scenePersistence";

interface PropRowProps {
  label: string;
  value: string | number | boolean;
  type: "string" | "int" | "bool";
  onChange: (value: string | number | boolean) => void;
}

function PropRow({ label, value, type, onChange }: PropRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  function commit() {
    setEditing(false);

    if (type === "int") {
      const parsed = Number.parseInt(draft, 10);
      if (!Number.isNaN(parsed)) {
        onChange(parsed);
      }
      return;
    }

    if (type === "bool") {
      onChange(draft === "true");
      return;
    }

    onChange(draft);
  }

  return (
    <tr className="group border-b border-[#313244] last:border-0">
      <td className="w-1/2 select-none px-3 py-1.5 text-xs text-[#7f849c]">{label}</td>
      <td className="px-3 py-1.5 text-xs">
        {editing ? (
          type === "bool" ? (
            <select
              autoFocus
              value={draft}
              className="w-full rounded border border-[#cba6f7] bg-[#1e1e2e] px-1 py-0.5 text-xs text-[#cdd6f4] focus:outline-none"
              onChange={(event) => setDraft(event.target.value)}
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
              className="w-full rounded border border-[#cba6f7] bg-[#1e1e2e] px-1 py-0.5 font-mono text-xs text-[#cdd6f4] focus:outline-none"
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commit}
              onKeyDown={(event) => event.key === "Enter" && commit()}
            />
          )
        ) : (
          <span
            className="cursor-pointer font-mono text-[#cdd6f4] transition-colors hover:text-[#cba6f7]"
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

interface PropDef {
  key: string;
  path: string[];
  type: "string" | "int" | "bool";
}

function entityProps(entity: Entity): PropDef[] {
  const defs: PropDef[] = [
    { key: "ID", path: ["entity_id"], type: "string" },
    { key: "Prefab", path: ["prefab"], type: "string" },
    { key: "Pos X", path: ["transform", "x"], type: "int" },
    { key: "Pos Y", path: ["transform", "y"], type: "int" },
  ];

  if (entity.components?.sprite) {
    defs.push(
      { key: "Asset", path: ["components", "sprite", "asset"], type: "string" },
      { key: "Frame W", path: ["components", "sprite", "frame_width"], type: "int" },
      { key: "Frame H", path: ["components", "sprite", "frame_height"], type: "int" },
      { key: "Palette Slot", path: ["components", "sprite", "palette_slot"], type: "int" },
      { key: "Priority", path: ["components", "sprite", "priority"], type: "string" }
    );
  }

  if (entity.components?.collision) {
    defs.push(
      { key: "Col. Shape", path: ["components", "collision", "shape"], type: "string" },
      { key: "Col. Width", path: ["components", "collision", "width"], type: "int" },
      { key: "Col. Height", path: ["components", "collision", "height"], type: "int" },
      { key: "Solid", path: ["components", "collision", "solid"], type: "bool" }
    );
  }

  if (entity.components?.camera) {
    defs.push(
      { key: "Follow", path: ["components", "camera", "follow_entity"], type: "string" },
      { key: "Offset X", path: ["components", "camera", "offset_x"], type: "int" },
      { key: "Offset Y", path: ["components", "camera", "offset_y"], type: "int" }
    );
  }

  if (entity.components?.tilemap) {
    defs.push(
      { key: "TM Tileset", path: ["components", "tilemap", "tileset"], type: "string" },
      { key: "TM Width", path: ["components", "tilemap", "map_width"], type: "int" },
      { key: "TM Height", path: ["components", "tilemap", "map_height"], type: "int" },
      { key: "Scroll X", path: ["components", "tilemap", "scroll_x"], type: "int" },
      { key: "Scroll Y", path: ["components", "tilemap", "scroll_y"], type: "int" }
    );
  }

  return defs;
}

function getPath(obj: unknown, path: string[]): string | number | boolean {
  let current: Record<string, unknown> | unknown = obj;

  for (const key of path) {
    if (current == null || typeof current !== "object") {
      return "";
    }
    current = (current as Record<string, unknown>)[key];
  }

  if (
    typeof current === "string" ||
    typeof current === "number" ||
    typeof current === "boolean"
  ) {
    return current;
  }

  return "";
}

export default function InspectorPanel() {
  const {
    activeScene,
    logMessage,
    selectedEntityId,
    updateBackgroundLayer,
    updateEntity,
  } = useEditorStore();

  const [saving, setSaving] = useState(false);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (autoSaveTimer.current) {
        clearTimeout(autoSaveTimer.current);
      }
    },
    []
  );

  const isLayer = selectedEntityId?.startsWith("layer::");
  const entity = isLayer
    ? null
    : activeScene?.entities.find((item) => item.entity_id === selectedEntityId) ?? null;
  const layer = isLayer
    ? activeScene?.background_layers.find((item) => `layer::${item.layer_id}` === selectedEntityId) ?? null
    : null;

  async function saveScene() {
    const { activeProjectDir } = useEditorStore.getState();
    if (!activeProjectDir) {
      return;
    }

    setSaving(true);
    try {
      await persistActiveScene(activeProjectDir, "Inspector");
    } finally {
      setSaving(false);
    }
  }

  function scheduleAutoSave() {
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
    }
    autoSaveTimer.current = setTimeout(() => {
      void saveScene();
    }, 600);
  }

  function handleChange(entityToUpdate: Entity, def: PropDef, value: string | number | boolean) {
    if (def.path.length === 1) {
      updateEntity(entityToUpdate.entity_id, { [def.path[0]]: value } as Partial<Entity>);
    } else if (def.path[0] === "transform" && def.path.length === 2) {
      updateEntity(entityToUpdate.entity_id, {
        transform: { ...entityToUpdate.transform, [def.path[1]]: value },
      });
    } else if (
      def.path[0] === "components" &&
      def.path[1] === "sprite" &&
      def.path.length === 3 &&
      entityToUpdate.components.sprite
    ) {
      updateEntity(entityToUpdate.entity_id, {
        components: {
          ...entityToUpdate.components,
          sprite: { ...entityToUpdate.components.sprite, [def.path[2]]: value },
        },
      });
    } else if (
      def.path[0] === "components" &&
      def.path[1] === "collision" &&
      def.path.length === 3 &&
      entityToUpdate.components.collision
    ) {
      updateEntity(entityToUpdate.entity_id, {
        components: {
          ...entityToUpdate.components,
          collision: { ...entityToUpdate.components.collision, [def.path[2]]: value },
        },
      });
    } else if (
      def.path[0] === "components" &&
      def.path[1] === "camera" &&
      def.path.length === 3 &&
      entityToUpdate.components.camera
    ) {
      updateEntity(entityToUpdate.entity_id, {
        components: {
          ...entityToUpdate.components,
          camera: { ...entityToUpdate.components.camera, [def.path[2]]: value },
        },
      });
    } else if (
      def.path[0] === "components" &&
      def.path[1] === "tilemap" &&
      def.path.length === 3 &&
      entityToUpdate.components.tilemap
    ) {
      updateEntity(entityToUpdate.entity_id, {
        components: {
          ...entityToUpdate.components,
          tilemap: { ...entityToUpdate.components.tilemap, [def.path[2]]: value },
        },
      });
    } else {
      logMessage("warn", `[Inspector] Campo nao suportado: ${def.key}`);
      return;
    }

    scheduleAutoSave();
  }

  function handleLayerChange(
    layerToUpdate: BackgroundLayer,
    field: keyof BackgroundLayer,
    value: string | number
  ) {
    updateBackgroundLayer(layerToUpdate.layer_id, {
      [field]: value,
    } as Partial<BackgroundLayer>);
    scheduleAutoSave();
  }

  return (
    <Panel title="Inspector" className="flex h-full flex-col">
      <div className="flex-1 overflow-auto">
        {!selectedEntityId ? (
          <p className="px-3 py-4 text-xs italic text-[#45475a]">
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
                    onChange={(value) => handleChange(entity, def, value)}
                  />
                ))}
              </tbody>
            </table>
            <div className="px-3 py-2">
              <button
                onClick={() => void saveScene()}
                disabled={saving}
                className={`w-full rounded py-1 text-xs font-semibold transition-colors ${
                  saving
                    ? "cursor-not-allowed bg-[#45475a] text-[#6c7086]"
                    : "bg-[#313244] text-[#cba6f7] hover:bg-[#45475a]"
                }`}
              >
                {saving ? "Salvando..." : "Salvar Cena"}
              </button>
            </div>
          </>
        ) : layer ? (
          <>
            <table className="w-full text-xs">
              <tbody>
                <tr className="border-b border-[#313244]">
                  <td className="w-1/2 select-none px-3 py-1.5 text-xs text-[#7f849c]">ID</td>
                  <td className="px-3 py-1.5 font-mono text-xs text-[#cdd6f4]">
                    {layer.layer_id}
                  </td>
                </tr>
                <PropRow
                  label="Depth"
                  value={layer.depth}
                  type="int"
                  onChange={(value) => handleLayerChange(layer, "depth", value as number)}
                />
                <PropRow
                  label="Tileset"
                  value={layer.tileset}
                  type="string"
                  onChange={(value) => handleLayerChange(layer, "tileset", value as string)}
                />
              </tbody>
            </table>
            <div className="px-3 py-2">
              <button
                onClick={() => void saveScene()}
                disabled={saving}
                className={`w-full rounded py-1 text-xs font-semibold transition-colors ${
                  saving
                    ? "cursor-not-allowed bg-[#45475a] text-[#6c7086]"
                    : "bg-[#313244] text-[#cba6f7] hover:bg-[#45475a]"
                }`}
              >
                {saving ? "Salvando..." : "Salvar Cena"}
              </button>
            </div>
          </>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-[#313244]">
        <HardwareLimitsPanel />
      </div>
    </Panel>
  );
}
