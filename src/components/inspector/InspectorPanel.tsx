import { useEffect, useMemo, useRef, useState } from "react";
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
              onChange={(event) => {
                setDraft(event.target.value);
                setEditing(false);
                onChange(event.target.value === "true");
              }}
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

interface StaticRowProps {
  label: string;
  value: string;
}

function StaticRow({ label, value }: StaticRowProps) {
  return (
    <tr className="group border-b border-[#313244] last:border-0">
      <td className="w-1/2 select-none px-3 py-1.5 text-xs text-[#7f849c]">{label}</td>
      <td className="px-3 py-1.5 font-mono text-xs text-[#cdd6f4]">{value}</td>
    </tr>
  );
}

interface RecordEntry {
  id: number;
  key: string;
  value: string;
}

interface RecordListEditorProps {
  label: string;
  entries: Record<string, string> | undefined;
  keyPlaceholder: string;
  valuePlaceholder: string;
  onChange: (next: Record<string, string>) => void;
}

function normalizeRecordEntries(entries: Record<string, string> | undefined): RecordEntry[] {
  const records = Object.entries(entries ?? {});
  if (records.length === 0) {
    return [{ id: 1, key: "", value: "" }];
  }

  return records.map(([key, value], index) => ({ id: index + 1, key, value }));
}

function serializeRecordEntries(entries: RecordEntry[]): Record<string, string> {
  return entries.reduce<Record<string, string>>((record, entry) => {
    const trimmedKey = entry.key.trim();
    if (trimmedKey) {
      record[trimmedKey] = entry.value;
    }
    return record;
  }, {});
}

function RecordListEditor({
  label,
  entries,
  keyPlaceholder,
  valuePlaceholder,
  onChange,
}: RecordListEditorProps) {
  const [draftEntries, setDraftEntries] = useState<RecordEntry[]>(() => normalizeRecordEntries(entries));
  const nextIdRef = useRef(2);

  useEffect(() => {
    const normalized = normalizeRecordEntries(entries);
    setDraftEntries(normalized);
    nextIdRef.current = normalized.reduce((maxId, entry) => Math.max(maxId, entry.id), 0) + 1;
  }, [entries]);

  function commit(nextEntries: RecordEntry[]) {
    onChange(serializeRecordEntries(nextEntries));
  }

  function updateEntry(entryId: number, field: "key" | "value", value: string) {
    setDraftEntries((current) => {
      const nextEntries = current.map((entry) =>
        entry.id === entryId ? { ...entry, [field]: value } : entry
      );
      commit(nextEntries);
      return nextEntries;
    });
  }

  function handleBlur() {
    commit(draftEntries);
  }

  function addEntry() {
    setDraftEntries((current) => [
      ...current,
      { id: nextIdRef.current++, key: "", value: "" },
    ]);
  }

  function removeEntry(entryId: number) {
    const nextEntries = draftEntries.filter((entry) => entry.id !== entryId);
    const normalized = nextEntries.length > 0 ? nextEntries : [{ id: nextIdRef.current++, key: "", value: "" }];
    setDraftEntries(normalized);
    commit(normalized);
  }

  return (
    <div className="border-t border-[#313244] px-3 py-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#7f849c]">
          {label}
        </p>
        <button
          type="button"
          className="rounded border border-[#45475a] px-2 py-1 text-[10px] font-semibold text-[#cba6f7] transition-colors hover:border-[#cba6f7] hover:text-[#f5e0dc]"
          onClick={addEntry}
        >
          + Add
        </button>
      </div>
      <div className="space-y-2">
        {draftEntries.map((entry) => (
          <div key={entry.id} className="flex items-center gap-2">
            <input
              value={entry.key}
              placeholder={keyPlaceholder}
              className="w-1/2 rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1 font-mono text-xs text-[#cdd6f4] focus:border-[#cba6f7] focus:outline-none"
              onChange={(event) => updateEntry(entry.id, "key", event.target.value)}
              onBlur={handleBlur}
              onKeyDown={(event) => event.key === "Enter" && handleBlur()}
            />
            <input
              value={entry.value}
              placeholder={valuePlaceholder}
              className="flex-1 rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1 font-mono text-xs text-[#cdd6f4] focus:border-[#cba6f7] focus:outline-none"
              onChange={(event) => updateEntry(entry.id, "value", event.target.value)}
              onBlur={handleBlur}
              onKeyDown={(event) => event.key === "Enter" && handleBlur()}
            />
            <button
              type="button"
              className="rounded border border-[#45475a] px-2 py-1 text-[10px] font-semibold text-[#f38ba8] transition-colors hover:border-[#f38ba8] hover:text-[#f5c2e7]"
              onClick={() => removeEntry(entry.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
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

  if (entity.components?.physics) {
    defs.push(
      { key: "Gravity", path: ["components", "physics", "gravity"], type: "bool" },
      {
        key: "Grav. Strength",
        path: ["components", "physics", "gravity_strength"],
        type: "int",
      },
      { key: "Max Vel X", path: ["components", "physics", "max_velocity", "x"], type: "int" },
      { key: "Max Vel Y", path: ["components", "physics", "max_velocity", "y"], type: "int" },
      { key: "Friction", path: ["components", "physics", "friction"], type: "int" },
      { key: "Bounce", path: ["components", "physics", "bounce"], type: "int" }
    );
  }

  if (entity.components?.audio) {
    defs.push({ key: "BGM", path: ["components", "audio", "bgm"], type: "string" });
  }

  if (entity.components?.input) {
    defs.push({ key: "Device", path: ["components", "input", "device"], type: "string" });
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

const DEFAULT_PROP_VALUES: Record<string, string | number | boolean> = {
  "components.physics.gravity": true,
  "components.physics.gravity_strength": 6,
  "components.physics.max_velocity.x": 0,
  "components.physics.max_velocity.y": 0,
  "components.physics.friction": 0,
  "components.physics.bounce": 0,
};

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

function getPropValue(entity: Entity, def: PropDef): string | number | boolean {
  const value = getPath(entity, def.path);
  if (value !== "") {
    return value;
  }

  return DEFAULT_PROP_VALUES[def.path.join(".")] ?? "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildNestedRecordPatch(
  current: Record<string, unknown> | undefined,
  path: string[],
  value: unknown
): Record<string, unknown> {
  const [head, ...tail] = path;
  if (!head) {
    return current ?? {};
  }

  if (tail.length === 0) {
    return { ...(current ?? {}), [head]: value };
  }

  const child = current?.[head];
  return {
    ...(current ?? {}),
    [head]: buildNestedRecordPatch(isRecord(child) ? child : undefined, tail, value),
  };
}

function buildEntityPatch(entity: Entity, path: string[], value: unknown): Partial<Entity> {
  const [root, ...tail] = path;
  if (!root) {
    return {};
  }

  if (tail.length === 0) {
    return { [root]: value } as Partial<Entity>;
  }

  const currentRoot = (entity as unknown as Record<string, unknown>)[root];
  return {
    [root]: buildNestedRecordPatch(isRecord(currentRoot) ? currentRoot : undefined, tail, value),
  } as Partial<Entity>;
}

function graphSummary(serializedGraph?: string): string {
  if (!serializedGraph) {
    return "Graph: 0 nodes, 0 edges";
  }

  try {
    const parsed = JSON.parse(serializedGraph) as unknown;
    if (!isRecord(parsed)) {
      return "Graph: 0 nodes, 0 edges";
    }

    const nodes = Array.isArray(parsed.nodes) ? parsed.nodes.length : 0;
    const edges = Array.isArray(parsed.edges) ? parsed.edges.length : 0;
    return `Graph: ${nodes} nodes, ${edges} edges`;
  } catch {
    return "Graph: 0 nodes, 0 edges";
  }
}

export default function InspectorPanel() {
  const {
    activeScene,
    logMessage,
    selectedEntityId,
    updateBackgroundLayer,
    updateEntity,
  } = useEditorStore();

  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "error">("idle");
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
  const entityLogicSummary = useMemo(
    () => (entity?.components.logic ? graphSummary(entity.components.logic.graph) : null),
    [entity]
  );

  async function saveScene() {
    const { activeProjectDir } = useEditorStore.getState();
    if (!activeProjectDir) {
      return;
    }

    setSaveStatus("saving");
    try {
      const saved = await persistActiveScene(activeProjectDir, "Inspector");
      setSaveStatus(saved ? "idle" : "error");
    } finally {
      if (useEditorStore.getState().activeProjectDir !== activeProjectDir) {
        setSaveStatus("idle");
      }
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
    if (saveStatus === "error") {
      setSaveStatus("idle");
    }

    const patch = buildEntityPatch(entityToUpdate, def.path, value);
    if (Object.keys(patch).length === 0) {
      logMessage("warn", `[Inspector] Campo nao suportado: ${def.key}`);
      return;
    }

    updateEntity(entityToUpdate.entity_id, patch);
    scheduleAutoSave();
  }

  function handleRecordFieldChange(
    entityToUpdate: Entity,
    path: string[],
    value: Record<string, string>
  ) {
    if (saveStatus === "error") {
      setSaveStatus("idle");
    }

    updateEntity(entityToUpdate.entity_id, buildEntityPatch(entityToUpdate, path, value));
    scheduleAutoSave();
  }

  function handleLayerChange(
    layerToUpdate: BackgroundLayer,
    field: keyof BackgroundLayer,
    value: string | number
  ) {
    if (saveStatus === "error") {
      setSaveStatus("idle");
    }

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
                    value={getPropValue(entity, def)}
                    type={def.type}
                    onChange={(value) => handleChange(entity, def, value)}
                  />
                ))}
                {entityLogicSummary ? <StaticRow label="Logic" value={entityLogicSummary} /> : null}
              </tbody>
            </table>
            {entity.components.audio ? (
              <RecordListEditor
                label="Audio SFX"
                entries={entity.components.audio.sfx}
                keyPlaceholder="action"
                valuePlaceholder="asset.wav"
                onChange={(value) =>
                  handleRecordFieldChange(entity, ["components", "audio", "sfx"], value)
                }
              />
            ) : null}
            {entity.components.input ? (
              <RecordListEditor
                label="Input Mapping"
                entries={entity.components.input.mapping}
                keyPlaceholder="action"
                valuePlaceholder="button"
                onChange={(value) =>
                  handleRecordFieldChange(entity, ["components", "input", "mapping"], value)
                }
              />
            ) : null}
            <div className="px-3 py-2">
              <button
                onClick={() => void saveScene()}
                disabled={saveStatus === "saving"}
                className={`w-full rounded py-1 text-xs font-semibold transition-colors ${
                  saveStatus === "saving"
                    ? "cursor-not-allowed bg-[#45475a] text-[#6c7086]"
                    : saveStatus === "error"
                      ? "bg-[#f38ba8] text-[#1e1e2e] hover:bg-[#eba0ac]"
                    : "bg-[#313244] text-[#cba6f7] hover:bg-[#45475a]"
                }`}
              >
                {saveStatus === "saving"
                  ? "Salvando..."
                  : saveStatus === "error"
                    ? "Falha ao salvar"
                    : "Salvar Cena"}
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
                disabled={saveStatus === "saving"}
                className={`w-full rounded py-1 text-xs font-semibold transition-colors ${
                  saveStatus === "saving"
                    ? "cursor-not-allowed bg-[#45475a] text-[#6c7086]"
                    : saveStatus === "error"
                      ? "bg-[#f38ba8] text-[#1e1e2e] hover:bg-[#eba0ac]"
                    : "bg-[#313244] text-[#cba6f7] hover:bg-[#45475a]"
                }`}
              >
                {saveStatus === "saving"
                  ? "Salvando..."
                  : saveStatus === "error"
                    ? "Falha ao salvar"
                    : "Salvar Cena"}
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
