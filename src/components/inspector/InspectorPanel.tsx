import { type ChangeEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import AssetPreview from "../common/AssetPreview";
import {
  DEFAULT_TILEMAP_LEGACY_FALLBACK_DETAIL,
  hasCanonicalTilemapCells,
  resolveProjectAssetVisualState,
  type ProjectAssetVisualState,
} from "../../core/assetVisualState";
import { resolveImportedEntityContext } from "../../core/importedEntityContext";
import Panel from "../common/Panel";
import HardwareLimitsPanel from "./HardwareLimitsPanel";
import { useEditorStore } from "../../core/store/editorStore";
import type { BackgroundLayer, Entity } from "../../core/ipc/sceneService";
import { persistActiveScene } from "../../core/scenePersistence";
import {
  constrainSpriteFrameSize,
  constrainSpritePaletteSlot,
} from "../../core/sceneConstraints";
import { deserializeNodeGraph, serializeNodeGraph } from "../nodegraph/NodeGraphEditor";
import { getEntityDisplayName } from "../../core/entityDisplay";
import { resolveSceneWorkspaceContext } from "../../core/sceneWorkspaceContext";
import { buildTilemapAuthoringBrush } from "../../core/entityAuthoring";
import { openProjectSourcePath } from "../../core/ipc/projectService";
import { getEntityLogicImportSignal } from "../../core/sgdkLogicDiagnostics";
import knowledgeBase from "./knowledgeBase.json";

type KnowledgeSectionId =
  | "transform"
  | "sprite"
  | "collision"
  | "physics"
  | "audio"
  | "input"
  | "camera"
  | "tilemap"
  | "logic"
  | "background_layer";

type KnowledgeEntry = {
  summary: string;
  details: string[];
};

const INSPECTOR_KNOWLEDGE = knowledgeBase as Record<KnowledgeSectionId, KnowledgeEntry>;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface PropRowProps {
  label: string;
  value: string | number | boolean;
  type: "string" | "int" | "bool";
  sourceState?: "override" | "inherited" | null;
  onChange: (value: string | number | boolean) => void;
}

function PropRow({ label, value, type, sourceState = null, onChange }: PropRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const testIdBase = `inspector-prop-${label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}`;

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
    <tr
      data-testid={`${testIdBase}-row`}
      className="group border-b border-[#313244] last:border-0"
    >
      <td className="w-24 min-w-24 max-w-32 select-none px-2 py-1 text-xs text-[#7f849c] align-top">
        <div className="flex items-center gap-2">
          <span>{label}</span>
          {sourceState ? (
            <span
              className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                sourceState === "override"
                  ? "bg-[#a6e3a1]/15 text-[#a6e3a1]"
                  : "bg-[#89b4fa]/15 text-[#89b4fa]"
              }`}
            >
              {sourceState === "override" ? "Override" : "Herdado"}
            </span>
          ) : null}
        </div>
      </td>
      <td className="px-2 py-1 text-xs">
        {editing ? (
          type === "bool" ? (
            <select
              autoFocus
              value={draft}
              data-testid={`${testIdBase}-input`}
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
              data-testid={`${testIdBase}-input`}
              className="w-full rounded border border-[#cba6f7] bg-[#1e1e2e] px-1 py-0.5 font-mono text-xs text-[#cdd6f4] focus:outline-none"
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commit}
              onKeyDown={(event) => event.key === "Enter" && commit()}
            />
          )
        ) : (
          <span
            data-testid={`${testIdBase}-value`}
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

function KnowledgeTooltipLabel({
  sectionId,
  title,
}: {
  sectionId: KnowledgeSectionId;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const knowledge = INSPECTOR_KNOWLEDGE[sectionId];

  return (
    <div className="relative flex items-center gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#7f849c]">
        {title}
      </span>
      <button
        type="button"
        data-testid={`inspector-knowledge-${sectionId}`}
        className="flex h-4 w-4 items-center justify-center rounded-full border border-[#45475a] text-[9px] font-bold text-[#89b4fa] transition-colors hover:border-[#89b4fa] hover:text-[#b4befe]"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((current) => !current)}
        aria-label={`Ajuda sobre ${title}`}
      >
        ?
      </button>
      {open && knowledge && (
        <div className="absolute left-0 top-6 z-20 w-72 rounded border border-[#313244] bg-[#11111b] p-3 shadow-lg">
          <p className="text-[10px] font-semibold leading-tight text-[#cdd6f4]">
            {knowledge.summary}
          </p>
          <div className="mt-2 space-y-1">
            {knowledge.details.map((detail) => (
              <p key={detail} className="text-[10px] leading-tight text-[#7f849c]">
                {detail}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function InspectorSection({
  sectionId,
  title,
  children,
}: {
  sectionId: KnowledgeSectionId;
  title: string;
  children: ReactNode;
}) {
  return (
    <div
      data-testid={`inspector-section-${sectionId}`}
      className="border-t border-[#313244] px-3 py-2 first:border-t-0"
    >
      <div className="mb-1.5">
        <KnowledgeTooltipLabel sectionId={sectionId} title={title} />
      </div>
      {children}
    </div>
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
      <div className="space-y-1.5">
        {draftEntries.map((entry) => (
          <div key={entry.id} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
            <input
              value={entry.key}
              placeholder={keyPlaceholder}
              className="min-w-0 rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1 font-mono text-xs text-[#cdd6f4] focus:border-[#cba6f7] focus:outline-none"
              onChange={(event) => updateEntry(entry.id, "key", event.target.value)}
              onBlur={handleBlur}
              onKeyDown={(event) => event.key === "Enter" && handleBlur()}
            />
            <input
              value={entry.value}
              placeholder={valuePlaceholder}
              className="min-w-0 rounded border border-[#313244] bg-[#1e1e2e] px-2 py-1 font-mono text-xs text-[#cdd6f4] focus:border-[#cba6f7] focus:outline-none"
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

type PropSection = {
  id: KnowledgeSectionId;
  title: string;
  defs: PropDef[];
};

function entityPropSections(entity: Entity): PropSection[] {
  const sections: PropSection[] = [
    {
      id: "transform",
      title: "Transform",
      defs: [
        { key: "ID", path: ["entity_id"], type: "string" },
        { key: "Display Name", path: ["display_name"], type: "string" },
        { key: "Prefab", path: ["prefab"], type: "string" },
        { key: "Pos X", path: ["transform", "x"], type: "int" },
        { key: "Pos Y", path: ["transform", "y"], type: "int" },
      ],
    },
  ];

  if (entity.components?.sprite) {
    sections.push({
      id: "sprite",
      title: "Sprite",
      defs: [
        { key: "Asset", path: ["components", "sprite", "asset"], type: "string" },
        { key: "Frame W", path: ["components", "sprite", "frame_width"], type: "int" },
        { key: "Frame H", path: ["components", "sprite", "frame_height"], type: "int" },
        { key: "Palette Slot", path: ["components", "sprite", "palette_slot"], type: "int" },
        { key: "Priority", path: ["components", "sprite", "priority"], type: "string" },
      ],
    });
  }

  if (entity.components?.collision) {
    sections.push({
      id: "collision",
      title: "Collision",
      defs: [
        { key: "Col. Shape", path: ["components", "collision", "shape"], type: "string" },
        { key: "Col. Width", path: ["components", "collision", "width"], type: "int" },
        { key: "Col. Height", path: ["components", "collision", "height"], type: "int" },
        { key: "Solid", path: ["components", "collision", "solid"], type: "bool" },
      ],
    });
  }

  if (entity.components?.physics) {
    sections.push({
      id: "physics",
      title: "Physics",
      defs: [
        { key: "Gravity", path: ["components", "physics", "gravity"], type: "bool" },
        {
          key: "Grav. Strength",
          path: ["components", "physics", "gravity_strength"],
          type: "int",
        },
        { key: "Max Vel X", path: ["components", "physics", "max_velocity", "x"], type: "int" },
        { key: "Max Vel Y", path: ["components", "physics", "max_velocity", "y"], type: "int" },
        { key: "Friction", path: ["components", "physics", "friction"], type: "int" },
        { key: "Bounce", path: ["components", "physics", "bounce"], type: "int" },
      ],
    });
  }

  if (entity.components?.audio) {
    sections.push({
      id: "audio",
      title: "Audio",
      defs: [{ key: "BGM", path: ["components", "audio", "bgm"], type: "string" }],
    });
  }

  if (entity.components?.input) {
    sections.push({
      id: "input",
      title: "Input",
      defs: [{ key: "Device", path: ["components", "input", "device"], type: "string" }],
    });
  }

  if (entity.components?.camera) {
    sections.push({
      id: "camera",
      title: "Camera",
      defs: [
        { key: "Follow", path: ["components", "camera", "follow_entity"], type: "string" },
        { key: "Offset X", path: ["components", "camera", "offset_x"], type: "int" },
        { key: "Offset Y", path: ["components", "camera", "offset_y"], type: "int" },
      ],
    });
  }

  if (entity.components?.tilemap) {
    sections.push({
      id: "tilemap",
      title: "Tilemap",
      defs: [
        { key: "TM Tileset", path: ["components", "tilemap", "tileset"], type: "string" },
        { key: "TM Width", path: ["components", "tilemap", "map_width"], type: "int" },
        { key: "TM Height", path: ["components", "tilemap", "map_height"], type: "int" },
        { key: "Scroll X", path: ["components", "tilemap", "scroll_x"], type: "int" },
        { key: "Scroll Y", path: ["components", "tilemap", "scroll_y"], type: "int" },
      ],
    });
  }

  return sections;
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

function hasPath(obj: unknown, path: string[]): boolean {
  let current: unknown = obj;

  for (const key of path) {
    if (!isRecord(current) || !(key in current)) {
      return false;
    }
    current = current[key];
  }

  return true;
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

function targetDisplayName(target: "megadrive" | "snes"): string {
  return target === "megadrive" ? "Mega Drive" : "SNES";
}

function isStableAssetVisualState(visualState: ProjectAssetVisualState): boolean {
  return visualState.kind !== "loading";
}

function importedToneClass(tone: "primary" | "accent" | "support" | "neutral"): string {
  switch (tone) {
    case "primary":
      return "border-[#89b4fa]/35 bg-[#89b4fa]/10 text-[#89b4fa]";
    case "accent":
      return "border-[#f38ba8]/35 bg-[#f38ba8]/10 text-[#f38ba8]";
    case "support":
      return "border-[#a6e3a1]/35 bg-[#a6e3a1]/10 text-[#a6e3a1]";
    default:
      return "border-[#313244] bg-[#11111b] text-[#cdd6f4]";
  }
}

// ── LogicVariable Slider ─────────────────────────────────────────────────────

interface LogicVariableSliderProps {
  varName: string;
  variable: import("../../core/ipc/sceneService").LogicVariable;
  onChange: (value: number) => void;
}

function LogicVariableSlider({ varName, variable, onChange }: LogicVariableSliderProps) {
  const min = variable.min ?? 0;
  const max = variable.max ?? 100;
  const rawDefault = variable.default;
  const currentValue = typeof rawDefault === "number" ? rawDefault : min;
  const [draft, setDraft] = useState(currentValue);

  useEffect(() => {
    const next = typeof rawDefault === "number" ? rawDefault : min;
    setDraft(next);
  }, [rawDefault, min]);

  function handleSlider(event: ChangeEvent<HTMLInputElement>) {
    const next = Number(event.target.value);
    setDraft(next);
    onChange(next);
  }

  const pct = max > min ? Math.round(((draft - min) / (max - min)) * 100) : 0;

  return (
    <tr className="group border-b border-[#313244] last:border-0">
      <td className="w-24 min-w-24 select-none px-2 py-1 text-xs text-[#7f849c]">
        <span>{varName}</span>
        <span className="ml-1 rounded bg-[#cba6f7]/15 px-1 py-0.5 text-[9px] font-mono text-[#cba6f7]">
          {variable.type}
        </span>
      </td>
      <td className="px-2 py-1">
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={min}
            max={max}
            step={1}
            value={draft}
            onChange={handleSlider}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[#313244] accent-[#cba6f7]"
          />
          <span className="w-8 shrink-0 text-right font-mono text-xs text-[#cdd6f4]">{draft}</span>
          <span className="shrink-0 text-[9px] text-[#45475a]">{pct}%</span>
        </div>
        <div className="flex justify-between text-[8px] text-[#45475a]">
          <span>{min}</span>
          <span>{max}</span>
        </div>
      </td>
    </tr>
  );
}

export default function InspectorPanel() {
  const {
    activeProjectDir,
    activeScene,
    activeSceneSource,
    activeScenePath,
    activeTarget,
    logMessage,
    projectSourceKind,
    projectLegacyIndex,
    selectedEntityId,
    setSelectedEntityId,
    updateBackgroundLayer,
    updateEntity,
    clearTilemapCells,
    activeBrush,
    setActiveWorkspace,
    setActiveViewportTab,
    setActiveTilemapId,
    setEditorMode,
    setActiveBrush,
  } = useEditorStore();

  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "error">("idle");
  const [assetPreviewStates, setAssetPreviewStates] = useState<Record<string, ProjectAssetVisualState>>({});
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
  const sourceEntity = isLayer
    ? null
    : activeSceneSource?.entities.find((item) => item.entity_id === selectedEntityId) ?? null;
  const layer = isLayer
    ? activeScene?.background_layers.find((item) => `layer::${item.layer_id}` === selectedEntityId) ?? null
    : null;
  const entityLogicSummary = useMemo(() => {
    const logic = entity?.components.logic;
    if (!logic) {
      return null;
    }
    if (logic.graph?.trim()) {
      return graphSummary(logic.graph);
    }
    if (logic.graph_ref?.trim()) {
      return `Graph: externo (${logic.graph_ref})`;
    }
    return graphSummary(undefined);
  }, [entity]);
  const entityLogicHints = useMemo(
    () =>
      entity?.components.logic?.logic_hints?.filter(
        (hint): hint is string => typeof hint === "string" && hint.trim().length > 0
      ) ?? [],
    [entity]
  );
  const entityLogicImportSignal = useMemo(() => getEntityLogicImportSignal(entity), [entity]);
  const importedEntityContext = useMemo(() => resolveImportedEntityContext(entity), [entity]);
  const entityAssignedLayers = useMemo(() => {
    if (!entity || !activeScene?.layers) {
      return [];
    }

    return activeScene.layers
      .filter((sceneLayer) => sceneLayer.entity_ids.includes(entity.entity_id))
      .map((sceneLayer) => sceneLayer.name);
  }, [activeScene?.layers, entity]);
  const sections = useMemo(() => (entity ? entityPropSections(entity) : []), [entity]);
  const sceneContext = useMemo(
    () =>
      resolveSceneWorkspaceContext({
        scene: activeScene,
        scenePath: activeScenePath,
        projectSourceKind,
        projectLegacyIndex,
      }),
    [activeScene, activeScenePath, projectLegacyIndex, projectSourceKind]
  );
  const tilemapUsesLegacyFallback = Boolean(
    entity?.components.tilemap && !hasCanonicalTilemapCells(entity.components.tilemap)
  );

  async function handleOpenImportedSourcePath(relativePath: string) {
    if (!activeProjectDir) {
      logMessage("warn", "[Inspector] Abra um projeto antes de abrir a fonte associada.");
      return;
    }
    try {
      const result = await openProjectSourcePath(activeProjectDir, relativePath);
      if (!result?.ok) {
        throw new Error(result?.message ?? "Falha ao abrir fonte no host.");
      }
      logMessage("info", `[Inspector] Fonte aberta: ${relativePath}`);
    } catch (error) {
      logMessage("error", `[Inspector] Falha ao abrir fonte '${relativePath}': ${describeError(error)}`);
    }
  }

  function handleOpenLogicWorkspace() {
    if (!entity) {
      return;
    }
    setActiveWorkspace("logic");
    setActiveViewportTab("logic");
    setSelectedEntityId(entity.entity_id);
    logMessage("info", `[Inspector] Navegando para Logic Workspace: ${getEntityDisplayName(entity)}.`);
  }

  function handleOpenArtWorkspace() {
    if (!entity?.components.sprite) {
      logMessage("warn", "[Inspector] A entidade selecionada nao possui sprite para abrir no Art Workspace.");
      return;
    }
    setActiveWorkspace("artstudio");
    setActiveViewportTab("artstudio");
    setSelectedEntityId(entity.entity_id);
    logMessage("info", `[Inspector] Navegando para Art Workspace: ${getEntityDisplayName(entity)}.`);
  }

  function handleFocusTilemapInViewport() {
    if (!entity?.components.tilemap) {
      return;
    }
    setActiveWorkspace("scene");
    setActiveViewportTab("scene");
    setSelectedEntityId(entity.entity_id);
    setActiveTilemapId(entity.entity_id);
    setEditorMode("paint");
    const brush = buildTilemapAuthoringBrush(entity);
    if (brush) {
      setActiveBrush(brush);
    }
    logMessage(
      "info",
      `[Inspector] Tilemap '${getEntityDisplayName(entity)}' focado: modo pintura, brush tile #${brush?.tileIndex ?? 1} e tilemap travado. Paleta embutida no viewport (ou Tools > Paleta Contextual).`
    );
  }

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

  function buildSpriteTargetPatch(
    entityToUpdate: Entity,
    overrides?: Partial<NonNullable<Entity["components"]["sprite"]>>
  ) {
    const sprite = entityToUpdate.components.sprite;
    if (!sprite) {
      return null;
    }

    const nextFrame = constrainSpriteFrameSize(
      activeTarget,
      overrides?.asset ?? sprite.asset,
      overrides?.frame_width ?? sprite.frame_width,
      overrides?.frame_height ?? sprite.frame_height
    );
    const nextPaletteSlot = constrainSpritePaletteSlot(
      activeTarget,
      overrides?.palette_slot ?? sprite.palette_slot ?? 0
    );
    const nextSprite = {
      ...sprite,
      ...overrides,
      frame_width: nextFrame.frameWidth,
      frame_height: nextFrame.frameHeight,
      palette_slot: nextPaletteSlot,
    };

    return {
      nextSprite,
      patch: {
        components: {
          ...entityToUpdate.components,
          sprite: nextSprite,
        },
      } satisfies Partial<Entity>,
    };
  }

  function handleNormalizeSpriteTarget(entityToUpdate: Entity) {
    if (saveStatus === "error") {
      setSaveStatus("idle");
    }

    const normalized = buildSpriteTargetPatch(entityToUpdate);
    if (!normalized) {
      return;
    }

    const currentSprite = entityToUpdate.components.sprite!;
    const changed =
      normalized.nextSprite.frame_width !== currentSprite.frame_width ||
      normalized.nextSprite.frame_height !== currentSprite.frame_height ||
      normalized.nextSprite.palette_slot !== (currentSprite.palette_slot ?? 0);

    updateEntity(entityToUpdate.entity_id, normalized.patch);
    scheduleAutoSave();
    logMessage(
      "info",
      changed
        ? `[Inspector] Sprite normalizado para ${targetDisplayName(activeTarget)}.`
        : `[Inspector] Sprite ja atende ao target ${targetDisplayName(activeTarget)}.`
    );
  }

  function handleChange(entityToUpdate: Entity, def: PropDef, value: string | number | boolean) {
    if (saveStatus === "error") {
      setSaveStatus("idle");
    }

    const isSpriteFrameField =
      def.path.length === 3 &&
      def.path[0] === "components" &&
      def.path[1] === "sprite" &&
      (def.path[2] === "frame_width" || def.path[2] === "frame_height");
    const isSpritePaletteField =
      def.path.length === 3 &&
      def.path[0] === "components" &&
      def.path[1] === "sprite" &&
      def.path[2] === "palette_slot";
    const sprite = entityToUpdate.components.sprite;
    const patch =
      isSpriteFrameField && sprite
        ? buildSpriteTargetPatch(entityToUpdate, {
            frame_width: def.path[2] === "frame_width" ? Number(value) : sprite.frame_width,
            frame_height: def.path[2] === "frame_height" ? Number(value) : sprite.frame_height,
          })?.patch ?? {}
        : isSpritePaletteField && sprite
          ? buildSpriteTargetPatch(entityToUpdate, {
              palette_slot: Number(value),
            })?.patch ?? {}
        : buildEntityPatch(entityToUpdate, def.path, value);
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

  function handleLogicParamChange(nodeId: string, paramKey: string, newValue: string | number | boolean) {
    if (!selectedEntityId || !entity?.components.logic) return;

    const graph = deserializeNodeGraph(entity.components.logic.graph);
    const nodeIndex = graph.nodes.findIndex((n) => n.id === nodeId);
    if (nodeIndex === -1) return;

    // Params are strictly string | number in NodeGraph
    const val = typeof newValue === "boolean" ? (newValue ? 1 : 0) : newValue;
    graph.nodes[nodeIndex].params[paramKey] = val;

    const newGraphJson = serializeNodeGraph(graph);

    const patch = buildEntityPatch(entity, ["components", "logic", "graph"], newGraphJson);
    updateEntity(selectedEntityId, patch);
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
          <div className="px-3 py-4 text-xs text-[#45475a]">
            <p className="italic">Selecione uma entidade na Hierarchy.</p>
            {activeScene?.collision_map ? (
              <div className="mt-3 rounded border border-[#313244] bg-[#11111b]/40 p-2 text-[#cdd6f4]">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[#89b4fa]">
                  Collision map (cena)
                </p>
                <p className="mt-1 font-mono text-[10px]">
                  {activeScene.collision_map.width}×{activeScene.collision_map.height} tiles (
                  {activeScene.collision_map.tile_width}×{activeScene.collision_map.tile_height}px)
                </p>
                <p className="mt-1 text-[10px] text-[#7f849c]">
                  Sólidos:{" "}
                  {activeScene.collision_map.data.filter((v) => v === 1).length} /{" "}
                  {activeScene.collision_map.data.length}
                </p>
              </div>
            ) : null}
          </div>
        ) : entity ? (
          <>
            {/* Entity header badge */}
            <div className="flex items-center gap-2 border-b border-[#313244] bg-[#181825] px-3 py-2">
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-[#cba6f7]/40 bg-[#cba6f7]/10 text-[9px] font-bold text-[#cba6f7]"
                aria-hidden
              >
                {entity.components.camera
                  ? "CAM"
                  : entity.components.tilemap
                    ? "TM"
                    : entity.components.sprite
                      ? "SP"
                      : "OBJ"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[11px] font-semibold text-[#cdd6f4]" title={getEntityDisplayName(entity)}>
                  {getEntityDisplayName(entity)}
                </p>
                <p className="truncate text-[9px] text-[#7f849c]" title={entity.entity_id}>
                  id: {entity.entity_id}
                </p>
                {entity.prefab && (
                  <p className="truncate text-[9px] text-[#89b4fa]" title={entity.prefab}>
                    prefab: {entity.prefab.replace(/\.json$/i, "")}
                  </p>
                )}
                <div
                  data-testid="inspector-entity-context"
                  className="mt-1 flex flex-wrap gap-1 text-[9px] text-[#7f849c]"
                >
                  <span className="rounded-full border border-[#313244] bg-[#11111b] px-2 py-0.5">
                    Target: <span className="font-semibold text-[#cdd6f4]">{targetDisplayName(activeTarget)}</span>
                  </span>
                  <span className="rounded-full border border-[#313244] bg-[#11111b] px-2 py-0.5">
                    Camadas:{" "}
                    <span className="font-semibold text-[#cdd6f4]">
                      {entityAssignedLayers.length > 0 ? entityAssignedLayers.join(", ") : "nenhuma"}
                    </span>
                  </span>
                  <span
                    data-testid="inspector-scene-context"
                    className="rounded-full border border-[#313244] bg-[#11111b] px-2 py-0.5"
                  >
                    Cena:{" "}
                    <span className="font-semibold text-[#cdd6f4]">{sceneContext.sourceBadgeLabel}</span>
                  </span>
                  {sceneContext.focusEntityId === entity.entity_id ? (
                    <span className="rounded-full border border-[#89b4fa]/35 bg-[#89b4fa]/10 px-2 py-0.5 text-[#89b4fa]">
                      Entidade guia
                    </span>
                  ) : null}
                  {tilemapUsesLegacyFallback ? (
                    <span
                      data-testid="inspector-tilemap-fallback-chip"
                      className="rounded-full border border-[#fab387]/35 bg-[#fab387]/10 px-2 py-0.5 text-[#fab387]"
                    >
                      Fallback legado
                    </span>
                  ) : null}
                  {importedEntityContext.positionLabel ? (
                    <span
                      data-testid="inspector-position-provenance-chip"
                      className={`rounded-full border px-2 py-0.5 font-semibold ${
                        importedEntityContext.positionMode === "donor"
                          ? "border-[#a6e3a1]/40 bg-[#a6e3a1]/12 text-[#a6e3a1]"
                          : importedEntityContext.positionMode === "staging"
                            ? "border-[#fab387]/40 bg-[#fab387]/12 text-[#fab387]"
                            : "border-[#89b4fa]/35 bg-[#89b4fa]/10 text-[#89b4fa]"
                      }`}
                      title={importedEntityContext.positionDetail ?? undefined}
                    >
                      Pos: {importedEntityContext.positionLabel}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-0.5 text-[8px] text-[#45475a]">
                <span>{Object.values(entity.components).filter(Boolean).length} comp.</span>
                <span>({entity.transform.x}, {entity.transform.y})</span>
              </div>
            </div>
            {importedEntityContext.isImported && sections.length === 0 ? (
              <div className="border-b border-[#313244] bg-[#11111b]/40 px-3 py-2">
                <div
                  data-testid="inspector-imported-context"
                  className="rounded border border-[#313244] bg-[#0f172a]/40 p-2"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[#7f849c]">
                      Contexto importado
                    </p>
                    {importedEntityContext.badgeLabel ? (
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold ${importedToneClass(importedEntityContext.tone)}`}
                      >
                        {importedEntityContext.badgeLabel}
                      </span>
                    ) : null}
                    {importedEntityContext.gameplayLabel ? (
                      <span className="rounded-full border border-[#313244] bg-[#181825] px-2 py-0.5 text-[9px] text-[#cdd6f4]">
                        {importedEntityContext.gameplayLabel}
                      </span>
                    ) : null}
                    {importedEntityContext.confidenceLabel ? (
                      <span className="rounded-full border border-[#313244] bg-[#181825] px-2 py-0.5 text-[9px] text-[#94a3b8]">
                        {importedEntityContext.confidenceLabel}
                      </span>
                    ) : null}
                  </div>
                  {importedEntityContext.summary ? (
                    <p className="mt-1 text-[10px] font-semibold text-[#cdd6f4]">
                      {importedEntityContext.summary}
                    </p>
                  ) : null}
                  {importedEntityContext.detail ? (
                    <p className="mt-1 text-[10px] leading-relaxed text-[#94a3b8]">
                      {importedEntityContext.detail}
                    </p>
                  ) : null}
                  {importedEntityContext.driverFunctions.length > 0 ? (
                    <p className="mt-2 text-[9px] text-[#7f849c]">
                      Funcoes-chave:{" "}
                      <span className="font-mono text-[#cdd6f4]">
                        {importedEntityContext.driverFunctions.join(", ")}
                      </span>
                    </p>
                  ) : null}
                  {importedEntityContext.sourcePaths.length > 0 ? (
                    <p className="mt-1 text-[9px] text-[#7f849c]">
                      Fontes diretas:{" "}
                      <span className="font-mono text-[#cdd6f4]">
                        {importedEntityContext.sourcePaths.join(", ")}
                      </span>
                    </p>
                  ) : null}
                  {importedEntityContext.auditFlags.length > 0 ? (
                    <div
                      data-testid="inspector-imported-audit-flags"
                      className="mt-2 flex flex-wrap gap-1"
                    >
                      {importedEntityContext.auditFlags.map((flag) => (
                        <span
                          key={flag}
                          className="rounded-full border border-[#89b4fa]/30 bg-[#89b4fa]/10 px-2 py-0.5 font-mono text-[8px] text-[#89b4fa]"
                        >
                          {flag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      data-testid="inspector-open-logic-workspace"
                      onClick={handleOpenLogicWorkspace}
                      className="rounded border border-[#89b4fa]/35 bg-[#89b4fa]/10 px-2 py-1 text-[9px] font-semibold text-[#89b4fa] transition-colors hover:bg-[#89b4fa]/20"
                    >
                      Objeto -&gt; Logica
                    </button>
                    <button
                      type="button"
                      data-testid="inspector-open-art-workspace"
                      onClick={handleOpenArtWorkspace}
                      disabled={!entity?.components.sprite}
                      className="rounded border border-[#a6e3a1]/35 bg-[#a6e3a1]/10 px-2 py-1 text-[9px] font-semibold text-[#a6e3a1] transition-colors hover:bg-[#a6e3a1]/20 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Objeto -&gt; Art
                    </button>
                    {(() => {
                      const pathsFromSemantics = importedEntityContext.sourcePaths;
                      const refs =
                        entity?.components.logic?.external_source_refs?.filter(
                          (p): p is string => typeof p === "string" && p.trim().length > 0
                        ) ?? [];
                      const uniquePaths = Array.from(
                        new Set(
                          [...pathsFromSemantics, ...refs].map((p) => p.trim()).filter((p) => p.length > 0)
                        )
                      );
                      if (uniquePaths.length === 0) {
                        return (
                          <span className="rounded border border-[#313244] bg-[#11111b] px-2 py-1 text-[9px] text-[#6c7086]">
                            Fonte real indisponivel
                          </span>
                        );
                      }
                      return uniquePaths.map((relativePath, index) => (
                        <button
                          key={`${relativePath}-${index}`}
                          type="button"
                          data-testid={
                            index === 0 ? "inspector-open-imported-source-primary" : `inspector-open-imported-source-${index}`
                          }
                          onClick={() => void handleOpenImportedSourcePath(relativePath)}
                          className="max-w-[11rem] truncate rounded border border-[#f9e2af]/35 bg-[#f9e2af]/10 px-2 py-1 text-left text-[9px] font-semibold text-[#f9e2af] transition-colors hover:bg-[#f9e2af]/20"
                          title={relativePath}
                        >
                          Abrir fonte{uniquePaths.length > 1 ? ` (${index + 1})` : ""}
                          <span className="mt-0.5 block truncate font-mono text-[8px] font-normal text-[#6c7086]">
                            {relativePath}
                          </span>
                        </button>
                      ));
                    })()}
                  </div>
                </div>
              </div>
            ) : null}
            {sections.map((section) => (
              <InspectorSection
                key={section.id}
                sectionId={section.id}
                title={section.title}
              >
                {section.id === "sprite" &&
                  entity.components.sprite?.asset &&
                  activeProjectDir &&
                  (() => {
                    const spriteAssetPath = entity.components.sprite!.asset;
                    const spriteVisualState =
                      assetPreviewStates[spriteAssetPath]
                      ?? resolveProjectAssetVisualState({ relativePath: spriteAssetPath });
                    return (
                      <div className="mb-3 flex items-center justify-center overflow-hidden rounded border border-[#313244] bg-[#11111b] p-2">
                        <div className="w-full">
                          <AssetPreview
                            testId="inspector-asset-preview"
                            fallbackTestId="inspector-asset-preview-fallback"
                            projectDir={activeProjectDir}
                            relativePath={spriteAssetPath}
                            alt={spriteAssetPath}
                            imageClassName="max-h-24 max-w-full object-contain"
                            fallbackClassName="flex h-24 w-full items-center justify-center text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7f849c]"
                            fallbackLabel="Preview indisponivel"
                            pixelated
                            onVisualStateChange={(visualState) => {
                              if (!isStableAssetVisualState(visualState)) {
                                return;
                              }
                              setAssetPreviewStates((current) => ({
                                ...current,
                                [spriteAssetPath]: visualState,
                              }));
                            }}
                          />
                          <p
                            className="mt-0.5 truncate font-mono text-[8px] text-[#45475a]"
                            title={spriteAssetPath}
                          >
                            {spriteAssetPath}
                          </p>
                          <p className="mt-1 text-[9px] text-[#7f849c]">
                            Estado visual:{" "}
                            <span className="font-mono text-[#cdd6f4]">{spriteVisualState.title}</span>
                            <span className="ml-1 font-mono text-[#45475a]">({spriteVisualState.kind})</span>
                          </p>
                          <p className="mt-1 text-[9px] leading-relaxed text-[#6c7086]">
                            {spriteVisualState.detail}
                          </p>
                        </div>
                      </div>
                    );
                  })()}
                <table className="w-full text-xs">
                  <tbody>
                    {section.defs.map((def) => (
                      <PropRow
                        key={`${section.id}-${def.key}`}
                        label={def.key}
                        value={getPropValue(entity, def)}
                        type={def.type}
                        sourceState={
                          entity.prefab && sourceEntity
                            ? hasPath(sourceEntity, def.path)
                              ? "override"
                              : "inherited"
                            : null
                        }
                        onChange={(value) => handleChange(entity, def, value)}
                      />
                    ))}
                  </tbody>
                </table>
                {section.id === "audio" && entity.components.audio ? (
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
                {section.id === "input" && entity.components.input ? (
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
                {section.id === "sprite" &&
                entity.components.sprite &&
                entity.components.sprite.animations &&
                Object.keys(entity.components.sprite.animations).length > 0 ? (
                  <div className="mt-3 border-t border-[#313244] pt-3">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[#45475a]">
                      Animacoes (UGDM)
                    </p>
                    <ul className="mb-3 max-h-28 space-y-1 overflow-y-auto text-[10px] text-[#a6adc8]">
                      {Object.entries(entity.components.sprite.animations).map(([name, def]) => (
                        <li key={name} className="font-mono">
                          <span className="text-[#89b4fa]">{name}</span>
                          <span className="text-[#45475a]"> — </span>
                          <span>
                            {def.frames?.length ?? 0} quadros @ {def.fps ?? "?"} fps
                            {def.loop ? " (loop)" : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {section.id === "sprite" && entity.components.sprite ? (
                  <div className="mt-3 border-t border-[#313244] pt-3">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[#45475a]">
                      Preparacao para Build
                    </p>
                    <p className="mb-2 text-[10px] leading-relaxed text-[#7f849c]">
                      {activeTarget === "megadrive"
                        ? "Mega Drive usa grid de 8px, sprite simples ate 32x32 e palette slots 0-3."
                        : "SNES usa sprites simples quadrados 8/16/32/64 e palette slots 0-7."}
                    </p>
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        data-testid="inspector-normalize-sprite-target"
                        className="rounded border border-[#89b4fa]/40 bg-[#89b4fa]/10 px-2 py-1.5 text-[10px] font-mono text-[#89b4fa] transition-colors hover:border-[#89b4fa] hover:bg-[#89b4fa]/20 hover:text-[#cdd6f4]"
                        onClick={() => handleNormalizeSpriteTarget(entity)}
                      >
                        {`📐 Normalizar Sprite para ${targetDisplayName(activeTarget)}`}
                      </button>
                    </div>
                  </div>
                ) : null}
                {section.id === "tilemap" && (() => {
                  const tm = entity.components.tilemap!;
                  const total = tm.map_width * tm.map_height;
                  const cells = tm.cells ?? [];
                  const filled = cells.reduce(
                    (acc, v) => acc + ((v | 0) > 0 ? 1 : 0),
                    0
                  );
                  const percent = total > 0 ? Math.round((filled / total) * 100) : 0;
                  const hasCanonicalPaintedCells = hasCanonicalTilemapCells(tm);
                  const tilemapVisualState =
                    assetPreviewStates[tm.tileset]
                    ?? resolveProjectAssetVisualState({
                      relativePath: tm.tileset,
                      legacyFallback: !hasCanonicalPaintedCells,
                      legacyFallbackDetail: DEFAULT_TILEMAP_LEGACY_FALLBACK_DETAIL,
                    });
                  const brushTileIndex =
                    activeBrush?.kind === "tile" ? activeBrush.tileIndex ?? 0 : null;
                  return (
                    <div className="mt-3 border-t border-[#313244] pt-3">
                      {activeProjectDir && tm.tileset ? (
                        <div className="mb-3 overflow-hidden rounded border border-[#313244] bg-[#11111b] p-2">
                          <AssetPreview
                            testId="inspector-tilemap-preview"
                            fallbackTestId="inspector-tilemap-preview-fallback"
                            projectDir={activeProjectDir}
                            relativePath={tm.tileset}
                            alt={tm.tileset}
                            imageClassName="max-h-24 max-w-full object-contain"
                            fallbackClassName="flex h-24 w-full items-center justify-center text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7f849c]"
                            pixelated
                            legacyFallback={!hasCanonicalPaintedCells}
                            legacyFallbackDetail={DEFAULT_TILEMAP_LEGACY_FALLBACK_DETAIL}
                            onVisualStateChange={(visualState) => {
                              if (!isStableAssetVisualState(visualState)) {
                                return;
                              }
                              setAssetPreviewStates((current) => ({
                                ...current,
                                [tm.tileset]: visualState,
                              }));
                            }}
                          />
                          <p className="mt-0.5 truncate font-mono text-[8px] text-[#45475a]" title={tm.tileset}>
                            {tm.tileset}
                          </p>
                          <p className="mt-1 text-[9px] text-[#7f849c]">
                            Estado visual (tileset):{" "}
                            <span className="font-mono text-[#cdd6f4]">{tilemapVisualState.title}</span>
                            <span className="ml-1 font-mono text-[#45475a]">({tilemapVisualState.kind})</span>
                          </p>
                          <p className="mt-1 text-[9px] leading-relaxed text-[#6c7086]">
                            {tilemapVisualState.detail}
                          </p>
                        </div>
                      ) : null}
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[#45475a]">
                        Pintura de Células
                      </p>
                      <div className="mb-2 flex items-center justify-between text-[10px] text-[#a6adc8]">
                        <span>
                          Preenchidas:{" "}
                          <span className="font-mono text-[#cdd6f4]">
                            {filled}/{total}
                          </span>{" "}
                          <span className="text-[#45475a]">({percent}%)</span>
                        </span>
                        <span>
                          Tile ativo:{" "}
                          <span className="font-mono text-[#89b4fa]">
                            #{brushTileIndex ?? "—"}
                          </span>
                        </span>
                      </div>
                      <p
                        className="mb-2 text-[10px] text-[#7f849c]"
                        data-testid={
                          hasCanonicalPaintedCells
                            ? "inspector-tilemap-cells-canonical"
                            : "inspector-tilemap-legacy-fallback"
                        }
                      >
                        {hasCanonicalPaintedCells
                          ? "Tilemap com cells[] canônico: render célula-a-célula no viewport."
                          : "Tilemap em fallback explícito: tileset existe, mas cells[] ainda nao foram materializados."}
                      </p>
                      {!hasCanonicalPaintedCells ? (
                        <p className="mb-2 text-[10px] leading-relaxed text-[#f9e2af]">
                          Pinte/importe a malha cells[] para sair do fallback legado e ver o tilemap canônico no viewport.
                        </p>
                      ) : null}
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={handleFocusTilemapInViewport}
                          className="rounded border border-[#94e2d5]/35 bg-[#94e2d5]/10 px-2 py-1 text-[9px] font-semibold text-[#94e2d5] transition-colors hover:bg-[#94e2d5]/20"
                        >
                          Editar tilemap no viewport
                        </button>
                      </div>
                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          disabled={filled === 0}
                          data-testid="inspector-clear-tilemap-cells"
                          onClick={() => {
                            clearTilemapCells(entity.entity_id);
                            logMessage("info", `[Inspector] Limpeza de células aplicada a '${entity.entity_id}'.`);
                          }}
                          className={`rounded border px-2 py-1.5 text-[10px] font-mono transition-colors ${
                            filled === 0
                              ? "cursor-not-allowed border-[#45475a] bg-slate-800/50 text-[#6c7086] opacity-60"
                              : "border-[#f38ba8]/40 bg-[#f38ba8]/10 text-[#f38ba8] hover:border-[#f38ba8] hover:bg-[#f38ba8]/20"
                          }`}
                        >
                          🧹 Limpar Células Pintadas
                        </button>
                      </div>
                      <p className="mt-3 mb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[#45475a]">
                        Ferramentas Avancadas (Experimental)
                      </p>
                      <p className="mb-2 text-[10px] leading-relaxed text-[#7f849c]">
                        A extracao automatica de tileset/tilemap continua experimental e ainda depende do
                        pipeline oficial de assets.
                      </p>
                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          disabled
                          className="cursor-not-allowed rounded border border-[#45475a] bg-slate-800/50 px-2 py-1.5 text-[10px] font-mono text-[#6c7086] opacity-60"
                        >
                          🧩 Extrair Tilemap/Tileset
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </InspectorSection>
            ))}
            {importedEntityContext.isImported && sections.length > 0 ? (
              <details
                data-testid="inspector-imported-context"
                className="border-t border-[#313244] bg-[#11111b]/35 px-3 py-2 text-[10px] text-[#94a3b8]"
              >
                <summary className="flex cursor-pointer list-none items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-[#7f849c]">
                  <span>Contexto importado</span>
                  {importedEntityContext.badgeLabel ? (
                    <span
                      className={`rounded-full border px-1.5 py-0.5 text-[8px] ${importedToneClass(importedEntityContext.tone)}`}
                    >
                      {importedEntityContext.badgeLabel}
                    </span>
                  ) : null}
                  {importedEntityContext.confidenceLabel ? (
                    <span className="rounded-full border border-[#313244] bg-[#181825] px-1.5 py-0.5 text-[8px] text-[#94a3b8]">
                      {importedEntityContext.confidenceLabel}
                    </span>
                  ) : null}
                  {importedEntityContext.auditFlags.length > 0 ? (
                    <span className="ml-auto rounded-full border border-[#fab387]/35 bg-[#fab387]/10 px-1.5 py-0.5 text-[8px] text-[#fab387]">
                      {importedEntityContext.auditFlags.length} avisos
                    </span>
                  ) : null}
                </summary>
                <div className="mt-2 rounded border border-[#313244] bg-[#0f172a]/40 p-2">
                  {importedEntityContext.summary ? (
                    <p className="font-semibold text-[#cdd6f4]">{importedEntityContext.summary}</p>
                  ) : null}
                  {importedEntityContext.detail ? (
                    <p className="mt-1 leading-relaxed">{importedEntityContext.detail}</p>
                  ) : null}
                  {importedEntityContext.driverFunctions.length > 0 ? (
                    <p className="mt-2 text-[9px] text-[#7f849c]">
                      Funcoes-chave:{" "}
                      <span className="font-mono text-[#cdd6f4]">
                        {importedEntityContext.driverFunctions.join(", ")}
                      </span>
                    </p>
                  ) : null}
                  {importedEntityContext.sourcePaths.length > 0 ? (
                    <p className="mt-1 text-[9px] text-[#7f849c]">
                      Fontes diretas:{" "}
                      <span className="font-mono text-[#cdd6f4]">
                        {importedEntityContext.sourcePaths.join(", ")}
                      </span>
                    </p>
                  ) : null}
                  {importedEntityContext.auditFlags.length > 0 ? (
                    <div
                      data-testid="inspector-imported-audit-flags"
                      className="mt-2 flex flex-wrap gap-1"
                    >
                      {importedEntityContext.auditFlags.map((flag) => (
                        <span
                          key={flag}
                          className="rounded-full border border-[#89b4fa]/30 bg-[#89b4fa]/10 px-2 py-0.5 font-mono text-[8px] text-[#89b4fa]"
                        >
                          {flag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      data-testid="inspector-open-logic-workspace"
                      onClick={handleOpenLogicWorkspace}
                      className="rounded border border-[#89b4fa]/35 bg-[#89b4fa]/10 px-2 py-1 text-[9px] font-semibold text-[#89b4fa] transition-colors hover:bg-[#89b4fa]/20"
                    >
                      Objeto -&gt; Logica
                    </button>
                    <button
                      type="button"
                      data-testid="inspector-open-art-workspace"
                      onClick={handleOpenArtWorkspace}
                      disabled={!entity?.components.sprite}
                      className="rounded border border-[#a6e3a1]/35 bg-[#a6e3a1]/10 px-2 py-1 text-[9px] font-semibold text-[#a6e3a1] transition-colors hover:bg-[#a6e3a1]/20 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Objeto -&gt; Art
                    </button>
                    {(() => {
                      const refs =
                        entity?.components.logic?.external_source_refs?.filter(
                          (p): p is string => typeof p === "string" && p.trim().length > 0
                        ) ?? [];
                      const uniquePaths = Array.from(
                        new Set(
                          [...importedEntityContext.sourcePaths, ...refs]
                            .map((p) => p.trim())
                            .filter((p) => p.length > 0)
                        )
                      );
                      if (uniquePaths.length === 0) {
                        return (
                          <span className="rounded border border-[#313244] bg-[#11111b] px-2 py-1 text-[9px] text-[#6c7086]">
                            Fonte real indisponivel
                          </span>
                        );
                      }
                      return uniquePaths.map((relativePath, index) => (
                        <button
                          key={`${relativePath}-${index}`}
                          type="button"
                          data-testid={
                            index === 0 ? "inspector-open-imported-source-primary" : `inspector-open-imported-source-${index}`
                          }
                          onClick={() => void handleOpenImportedSourcePath(relativePath)}
                          className="max-w-[11rem] truncate rounded border border-[#f9e2af]/35 bg-[#f9e2af]/10 px-2 py-1 text-left text-[9px] font-semibold text-[#f9e2af] transition-colors hover:bg-[#f9e2af]/20"
                          title={relativePath}
                        >
                          Abrir fonte{uniquePaths.length > 1 ? ` (${index + 1})` : ""}
                          <span className="mt-0.5 block truncate font-mono text-[8px] font-normal text-[#6c7086]">
                            {relativePath}
                          </span>
                        </button>
                      ));
                    })()}
                  </div>
                </div>
              </details>
            ) : null}
            {entity.components.logic ? (
              <InspectorSection sectionId="logic" title="Logic">
                <table className="w-full text-xs">
                  <tbody>
                    {entityLogicImportSignal.status !== "none" ? (
                      <tr className="group border-b border-[#313244] last:border-0">
                        <td className="w-24 min-w-24 align-top select-none px-2 py-1 text-xs text-[#7f849c]">
                          Import
                        </td>
                        <td className="px-2 py-1 text-xs">
                          <div
                            data-testid="inspector-logic-import-truth"
                            className="grid gap-1 rounded border border-[#313244] bg-[#11111b]/70 px-2 py-1.5 text-[10px] leading-snug text-[#cdd6f4]"
                          >
                            <span
                              className={[
                                "w-fit rounded-full border px-1.5 py-0.5 text-[8px] font-semibold",
                                entityLogicImportSignal.status === "functional"
                                  ? "border-[#a6e3a1]/35 bg-[#a6e3a1]/10 text-[#a6e3a1]"
                                  : entityLogicImportSignal.status === "bridge_only"
                                    ? "border-[#f9e2af]/35 bg-[#f9e2af]/10 text-[#f9e2af]"
                                    : "border-[#89b4fa]/35 bg-[#89b4fa]/10 text-[#89b4fa]",
                              ].join(" ")}
                            >
                              {entityLogicImportSignal.label}
                            </span>
                            <div className="grid grid-cols-1 gap-1 xl:grid-cols-2">
                              {entityLogicImportSignal.graphRef ? (
                                <span className="min-w-0 truncate font-mono" title={entityLogicImportSignal.graphRef}>
                                  graph_ref: {entityLogicImportSignal.graphRef}
                                </span>
                              ) : null}
                              {entityLogicImportSignal.confidence ? (
                                <span className="min-w-0 truncate font-mono">
                                  confidence: {entityLogicImportSignal.confidence}
                                </span>
                              ) : null}
                              <span className="min-w-0 truncate font-mono">
                                converted_nodes_count: {entityLogicImportSignal.convertedNodesCount}
                              </span>
                              <span className="min-w-0 truncate font-mono">
                                bridge_count: {entityLogicImportSignal.bridgeCount}
                              </span>
                              {entityLogicImportSignal.sourcePaths.length > 0 ? (
                                <span
                                  className="min-w-0 truncate font-mono xl:col-span-2"
                                  title={entityLogicImportSignal.sourcePaths.join(", ")}
                                >
                                  source mapping: {entityLogicImportSignal.sourcePaths.join(", ")}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                    {entityLogicSummary ? (
                      <tr className="group border-b border-[#313244] last:border-0">
                        <td className="w-24 min-w-24 select-none px-2 py-1 text-xs text-[#7f849c]">Graph</td>
                        <td className="px-2 py-1 text-xs">
                          <span className="font-mono text-[#cdd6f4]">{entityLogicSummary}</span>
                          <button
                            type="button"
                            className="ml-2 text-[10px] text-[#89b4fa] transition-colors hover:text-[#b4befe]"
                            onClick={() => useEditorStore.getState().setActiveViewportTab("logic")}
                            title="Editar grafo no NodeGraph"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ) : null}
                    {entity.components.logic.graph_ref ? (
                      <tr className="group border-b border-[#313244] last:border-0">
                        <td className="w-24 min-w-24 select-none px-2 py-1 text-xs text-[#7f849c]">Graph Ref</td>
                        <td className="px-2 py-1 text-xs">
                          <span className="font-mono text-[#cdd6f4]">
                            {entity.components.logic.graph_ref}
                          </span>
                        </td>
                      </tr>
                    ) : null}
                    {importedEntityContext.isImported && importedEntityContext.summary ? (
                      <tr className="group border-b border-[#313244] last:border-0">
                        <td className="w-24 min-w-24 align-top select-none px-2 py-1 text-xs text-[#7f849c]">
                          Imported
                        </td>
                        <td className="px-2 py-1 text-xs">
                          <p className="text-[#cdd6f4]">{importedEntityContext.summary}</p>
                          {importedEntityContext.reason ? (
                            <p className="mt-1 text-[#7f849c]">{importedEntityContext.reason}</p>
                          ) : null}
                        </td>
                      </tr>
                    ) : null}
                    {entity.components.logic.external_source_refs &&
                    entity.components.logic.external_source_refs.length > 0 ? (
                      <tr className="group border-b border-[#313244] last:border-0">
                        <td className="w-24 min-w-24 align-top select-none px-2 py-1 text-xs text-[#7f849c]">
                          Fontes C
                        </td>
                        <td className="px-2 py-1 text-xs">
                          <ul className="list-inside list-disc font-mono text-[#cdd6f4]">
                            {entity.components.logic.external_source_refs.map((ref) => (
                              <li key={ref}>{ref}</li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ) : null}
                    {entityLogicHints.length > 0 ? (
                      <tr className="group border-b border-[#313244] last:border-0">
                        <td className="w-24 min-w-24 select-none px-2 py-1 align-top text-xs text-[#7f849c]">
                          Imported Hints
                        </td>
                        <td className="px-2 py-1 text-xs">
                          <div className="flex flex-col gap-1">
                            {entityLogicHints.map((hint, index) => (
                              <span key={`${index}-${hint}`} className="text-[#cdd6f4]">
                                {hint}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                    {(() => {
                      const graph = deserializeNodeGraph(entity.components.logic.graph);
                      const nodesWithParams = graph.nodes.filter((n) => Object.keys(n.params).length > 0);

                      if (nodesWithParams.length === 0) {
                        return null;
                      }

                      return nodesWithParams.map((node) => (
                        <tr key={node.id} className="group border-b border-[#313244] last:border-0 relative">
                          <td colSpan={2} className="p-0">
                            <table className="w-full text-xs bg-[#11111b]/30">
                              <tbody>
                                <tr className="border-b border-[#313244]/50">
                                  <td colSpan={2} className="flex items-center gap-2 bg-[#1e1e2e]/50 px-3 py-1 text-[10px] font-bold uppercase text-[#cba6f7]">
                                    <span>{node.label}</span>
                                    <span className="font-mono text-[9px] normal-case text-[#45475a]">{node.id}</span>
                                  </td>
                                </tr>
                                {Object.entries(node.params as Record<string, string | number>).map(([pKey, pVal]) => (
                                  <PropRow
                                    key={pKey}
                                    label={pKey}
                                    value={pVal}
                                    type={typeof pVal === "number" ? "int" : "string"}
                                    onChange={(newVal) => handleLogicParamChange(node.id, pKey, newVal)}
                                  />
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
                {/* LogicVariable sliders — variables with min/max defined */}
                {entity.components.logic.variables &&
                  Object.keys(entity.components.logic.variables).length > 0 && (
                    <div className="border-t border-[#313244] px-0 pt-1">
                      <p className="px-3 py-1 text-[9px] font-semibold uppercase tracking-[0.15em] text-[#45475a]">
                        Variáveis
                      </p>
                      <table className="w-full text-xs">
                        <tbody>
                          {Object.entries(entity.components.logic.variables).map(([varName, variable]) =>
                            variable.min !== undefined && variable.max !== undefined ? (
                              <LogicVariableSlider
                                key={varName}
                                varName={varName}
                                variable={variable}
                                onChange={(value) => {
                                  if (!entity.components.logic?.variables) return;
                                  const nextVariables = {
                                    ...entity.components.logic.variables,
                                    [varName]: { ...variable, default: value },
                                  };
                                  updateEntity(
                                    entity.entity_id,
                                    buildEntityPatch(entity, ["components", "logic", "variables"], nextVariables)
                                  );
                                  scheduleAutoSave();
                                }}
                              />
                            ) : (
                              <PropRow
                                key={varName}
                                label={varName}
                                value={typeof variable.default === "number" || typeof variable.default === "string" || typeof variable.default === "boolean" ? variable.default : String(variable.default ?? "")}
                                type={variable.type === "bool" ? "bool" : variable.type === "int" || variable.type === "float" ? "int" : "string"}
                                onChange={(value) => {
                                  if (!entity.components.logic?.variables) return;
                                  const nextVariables = {
                                    ...entity.components.logic.variables,
                                    [varName]: { ...variable, default: value },
                                  };
                                  updateEntity(
                                    entity.entity_id,
                                    buildEntityPatch(entity, ["components", "logic", "variables"], nextVariables)
                                  );
                                  scheduleAutoSave();
                                }}
                              />
                            )
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
              </InspectorSection>
            ) : null}
            <div className="px-3 py-2">
              <button
                onClick={() => void saveScene()}
                disabled={saveStatus === "saving"}
                className={`w-full rounded py-1 text-xs font-semibold transition-colors ${saveStatus === "saving"
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
            <InspectorSection sectionId="background_layer" title="Background Layer">
              <table className="w-full text-xs">
                <tbody>
                  <tr className="border-b border-[#313244]">
                    <td className="w-24 min-w-24 select-none px-2 py-1 text-xs text-[#7f849c]">ID</td>
                    <td className="px-2 py-1 font-mono text-xs text-[#cdd6f4]">
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
            </InspectorSection>
            <div className="px-3 py-2">
              <button
                onClick={() => void saveScene()}
                disabled={saveStatus === "saving"}
                className={`w-full rounded py-1 text-xs font-semibold transition-colors ${saveStatus === "saving"
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
