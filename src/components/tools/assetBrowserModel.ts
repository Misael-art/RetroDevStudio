import { getEntityDisplayName } from "../../core/entityDisplay";
import {
  resolveEntitySourceRefs,
  resolvePrimaryAuthoringSurface,
} from "../../core/entityAuthoring";
import { resolveImportedEntityContext } from "../../core/importedEntityContext";
import type { LegacySgdkIndex, Scene } from "../../core/ipc/sceneService";
import type { HwStatus } from "../../core/store/editorStore";
import { getPreferredSceneEntity } from "../../core/sceneWorkspaceContext";
import type {
  LegacyProjectFilePreview,
  ProjectAssetEntry,
} from "../../core/ipc/toolsService";

export type AssetBrowserFilterId =
  | "sprite"
  | "tilemap"
  | "palette"
  | "audio"
  | "source_art"
  | "generated"
  | "unused"
  | "over_budget";

export type AssetBrowserTypeId = Extract<
  AssetBrowserFilterId,
  "sprite" | "tilemap" | "palette" | "audio" | "source_art"
>;

export interface AssetBrowserClassification {
  typeId: AssetBrowserTypeId;
  typeLabel: string;
  generated: boolean;
}

export interface AssetBudgetSummary {
  status: "unknown" | "ok" | "over";
  vramLabel: string;
  dmaLabel: string;
  spriteLabel: string;
  paletteLabel: string;
  totalAssetLabel: string;
  reason: string;
}

export interface AssetReference {
  entityId: string;
  label: string;
  roleLabel: string | null;
  confidenceLabel: string | null;
  reason: string | null;
  isSceneFocus: boolean;
  authoringSurface: "tilemap" | "logic" | "artstudio" | null;
  sourcePaths: string[];
  positionLabel: string | null;
  scenePath: string | null;
  sceneLabel: string | null;
  graphRef: string | null;
}

export interface LegacyIndexSection {
  id: string;
  label: string;
  files: string[];
}

export interface AssetTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: AssetTreeNode[];
  asset?: ProjectAssetEntry;
  fileCount: number;
}

export type AssetBrowserState = {
  assets: ProjectAssetEntry[];
  busy: boolean;
  error: string | null;
  viewMode: "grid" | "tree";
  treeCollapsed: Set<string>;
  selectedTreeAsset: ProjectAssetEntry | null;
  selectedLegacyFile: string | null;
  legacyPreview: LegacyProjectFilePreview | null;
  legacyPreviewBusy: boolean;
  legacyPreviewError: string | null;
};

export function createInitialAssetBrowserState(): AssetBrowserState {
  return {
    assets: [],
    busy: false,
    error: null,
    viewMode: "tree",
    treeCollapsed: new Set<string>(),
    selectedTreeAsset: null,
    selectedLegacyFile: null,
    legacyPreview: null,
    legacyPreviewBusy: false,
    legacyPreviewError: null,
  };
}

function normalizeAssetPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase();
}

function assetBaseName(value: string): string {
  return normalizeAssetPath(value).split("/").pop() ?? normalizeAssetPath(value);
}

function hasAnySegment(value: string, patterns: string[]): boolean {
  const normalized = normalizeAssetPath(value);
  return patterns.some((pattern) => normalized.includes(pattern));
}

export function classifyAssetBrowserAsset(asset: ProjectAssetEntry): AssetBrowserClassification {
  const path = normalizeAssetPath(asset.relative_path);
  const generated = hasAnySegment(path, [
    "/generated/",
    "/gen/",
    "generated_",
    "/artstudio/generated",
    "/build/generated",
    "/cache_",
  ]);

  if (
    asset.kind === "audio" ||
    /\.(wav|vgm|xgm|pcm|ogg|mp3|flac)$/i.test(path) ||
    hasAnySegment(path, ["/audio/", "/sfx/", "/bgm/", "/music/", "/sound/"])
  ) {
    return { typeId: "audio", typeLabel: "audio", generated };
  }

  if (/\.(pal|act)$/i.test(path) || hasAnySegment(path, ["/palette", "/palettes/", "_palette"])) {
    return { typeId: "palette", typeLabel: "palette", generated };
  }

  if (
    /\.(psd|ase|aseprite|kra|xcf)$/i.test(path) ||
    hasAnySegment(path, ["/source_art/", "/source-art/", "/raw/", "/original/", "/source/"])
  ) {
    return { typeId: "source_art", typeLabel: "source art", generated };
  }

  if (
    hasAnySegment(path, [
      "/tilemap",
      "/tilemaps/",
      "/tileset",
      "/tilesets/",
      "/maps/",
      "/background",
      "/backgrounds/",
      "/levels/",
      "_tilemap",
      "_tiles",
      "_map",
    ])
  ) {
    return { typeId: "tilemap", typeLabel: "tilemap", generated };
  }

  return { typeId: "sprite", typeLabel: "sprite", generated };
}

function formatBytesAsKb(bytes: number | null | undefined): string {
  if (!Number.isFinite(bytes ?? Number.NaN)) {
    return "-";
  }
  return `${Math.round((bytes ?? 0) / 1024)}KB`;
}

function formatBytes(bytes: number | null | undefined): string {
  if (!Number.isFinite(bytes ?? Number.NaN)) {
    return "-";
  }
  return `${Math.round(bytes ?? 0)}B`;
}

function findAssetDiagnostic(asset: ProjectAssetEntry, diagnostics: string[]): string | null {
  const path = normalizeAssetPath(asset.relative_path);
  const baseName = assetBaseName(asset.relative_path);
  return (
    diagnostics.find((diagnostic) => {
      const normalized = normalizeAssetPath(diagnostic);
      return normalized.includes(path) || normalized.includes(baseName);
    }) ?? null
  );
}

export function buildAssetBudgetSummary(
  asset: ProjectAssetEntry,
  matches: AssetReference[],
  hwStatus: HwStatus | null
): AssetBudgetSummary {
  if (!hwStatus) {
    return {
      status: "unknown",
      vramLabel: "VRAM sem validacao",
      dmaLabel: "DMA sem validacao",
      spriteLabel: "Sprites sem validacao",
      paletteLabel: "Paletas sem validacao",
      totalAssetLabel: "Total de assets sem validacao",
      reason: "Rode a validacao de hardware para obter orcamento rapido.",
    };
  }

  const diagnostics = [...hwStatus.errors, ...hwStatus.warnings];
  const assetDiagnostic = findAssetDiagnostic(asset, diagnostics);
  const hasAssetSpecificDiagnostics = diagnostics.some((diagnostic) =>
    /\bassets[\\/]/i.test(diagnostic)
  );
  const vramUsed = hwStatus.resident_vram_bytes ?? hwStatus.vram_used;
  const vramOver = vramUsed > hwStatus.vram_limit;
  const dmaOver = hwStatus.dma_used > hwStatus.dma_limit;
  const spriteOver = hwStatus.sprite_count > hwStatus.sprite_limit;
  const paletteOver = hwStatus.palette_banks_used > hwStatus.palette_banks_limit;
  const aggregateOver = vramOver || dmaOver || spriteOver || paletteOver || hwStatus.errors.length > 0;
  const status =
    assetDiagnostic || (!hasAssetSpecificDiagnostics && matches.length > 0 && aggregateOver)
      ? "over"
      : "ok";

  return {
    status,
    vramLabel: `${formatBytesAsKb(vramUsed)} / ${formatBytesAsKb(hwStatus.vram_limit)}`,
    dmaLabel: `${formatBytes(hwStatus.dma_used)} / ${formatBytes(hwStatus.dma_limit)}`,
    spriteLabel: `${hwStatus.sprite_count} / ${hwStatus.sprite_limit}`,
    paletteLabel: `${hwStatus.palette_banks_used} / ${hwStatus.palette_banks_limit}`,
    totalAssetLabel: `${formatBytesAsKb(hwStatus.project_asset_bytes ?? hwStatus.vram_used)} total`,
    reason:
      assetDiagnostic ??
      (status === "over"
        ? "A cena ativa esta acima de pelo menos um orcamento e este asset participa dela."
        : "Sem diagnostico de orcamento associado a este asset na cena ativa."),
  };
}

export function filterAssetBrowserAssets({
  assets,
  references,
  query,
  filters,
  hwStatus,
}: {
  assets: ProjectAssetEntry[];
  references: Map<string, AssetReference[]>;
  query: string;
  filters: Set<AssetBrowserFilterId>;
  hwStatus: HwStatus | null;
}): ProjectAssetEntry[] {
  const normalizedQuery = normalizeAssetPath(query).replace(/[_-]+/g, " ").trim();
  const roleFilters: AssetBrowserTypeId[] = ([
    "sprite",
    "tilemap",
    "palette",
    "audio",
    "source_art",
  ] as const).filter((filter): filter is AssetBrowserTypeId => filters.has(filter));

  return assets.filter((asset) => {
    const classification = classifyAssetBrowserAsset(asset);
    const matches = references.get(asset.relative_path) ?? [];
    const budget = buildAssetBudgetSummary(asset, matches, hwStatus);
    const searchable = [
      normalizeAssetPath(asset.relative_path).replace(/[_-]+/g, " "),
      assetBaseName(asset.relative_path).replace(/[_-]+/g, " "),
      asset.kind,
      classification.typeId.replace("_", " "),
      classification.typeLabel,
      classification.generated ? "generated gerado artstudio" : "",
      matches.length === 0 ? "unused orfao" : "used usado referenciado",
      budget.status === "over" ? "over budget over-budget acima orcamento" : "",
    ].join(" ");

    if (normalizedQuery && !searchable.includes(normalizedQuery)) {
      return false;
    }

    if (roleFilters.length > 0 && !roleFilters.includes(classification.typeId)) {
      return false;
    }

    if (filters.has("generated") && !classification.generated) {
      return false;
    }

    if (filters.has("unused") && matches.length > 0) {
      return false;
    }

    if (filters.has("over_budget") && budget.status !== "over") {
      return false;
    }

    return true;
  });
}

export function collectAssetReferences(
  scene: Scene | null,
  scenePath: string | null = null
): Map<string, AssetReference[]> {
  const references = new Map<string, AssetReference[]>();
  if (!scene) {
    return references;
  }
  const focusEntityId = getPreferredSceneEntity(scene)?.entity_id ?? null;
  const sceneLabel = scene.display_name ?? scene.scene_id;

  const pushReference = (
    assetPath: string | undefined,
    entityId: string,
    label: string,
    roleLabel: string | null = null,
    confidenceLabel: string | null = null,
    reason: string | null = null,
    isSceneFocus = false,
    authoringSurface: AssetReference["authoringSurface"] = null,
    sourcePaths: string[] = [],
    positionLabel: string | null = null,
    graphRef: string | null = null
  ) => {
    const normalized = String(assetPath ?? "").trim();
    if (!normalized) {
      return;
    }
    const bucket = references.get(normalized) ?? [];
    bucket.push({
      entityId,
      label,
      roleLabel,
      confidenceLabel,
      reason,
      isSceneFocus,
      authoringSurface,
      sourcePaths,
      positionLabel,
      scenePath,
      sceneLabel,
      graphRef,
    });
    references.set(normalized, bucket);
  };

  for (const entity of scene.entities) {
    const importedContext = resolveImportedEntityContext(entity);
    const roleLabel = importedContext.roleLabel;
    const confidenceLabel = importedContext.confidenceLabel;
    const reason = importedContext.reason;
    const isSceneFocus = focusEntityId === entity.entity_id;
    const authoringSurface = resolvePrimaryAuthoringSurface(entity);
    const sourcePaths = resolveEntitySourceRefs(entity);
    const positionLabel = importedContext.positionLabel;
    const graphRef = entity.components.logic?.graph_ref ?? entity.components.logic?.graph ?? null;
    pushReference(
      entity.components.sprite?.asset,
      entity.entity_id,
      `Sprite · ${getEntityDisplayName(entity)}`,
      roleLabel,
      confidenceLabel,
      reason,
      isSceneFocus,
      authoringSurface,
      sourcePaths,
      positionLabel,
      graphRef
    );
    pushReference(
      entity.components.tilemap?.tileset,
      entity.entity_id,
      `Tilemap · ${getEntityDisplayName(entity)}`,
      roleLabel,
      confidenceLabel,
      reason,
      isSceneFocus,
      authoringSurface,
      sourcePaths,
      positionLabel,
      graphRef
    );

    const audio = entity.components.audio;
    if (audio?.bgm) {
      pushReference(
        audio.bgm,
        entity.entity_id,
        `BGM · ${getEntityDisplayName(entity)}`,
        roleLabel,
        confidenceLabel,
        reason,
        isSceneFocus,
        authoringSurface,
        sourcePaths,
        positionLabel,
        graphRef
      );
    }
    for (const [action, assetPath] of Object.entries(audio?.sfx ?? {})) {
      pushReference(
        assetPath,
        entity.entity_id,
        `SFX ${action} · ${getEntityDisplayName(entity)}`,
        roleLabel,
        confidenceLabel,
        reason,
        isSceneFocus,
        authoringSurface,
        sourcePaths,
        positionLabel,
        graphRef
      );
    }
  }

  for (const layer of scene.background_layers) {
    pushReference(
      layer.tileset,
      `layer::${layer.layer_id}`,
      `Tileset · ${layer.layer_id}`
    );
    pushReference(
      layer.tilemap,
      `layer::${layer.layer_id}`,
      `Layer map · ${layer.layer_id}`
    );
  }

  for (const bucket of references.values()) {
    bucket.sort((a, b) => {
      if (a.isSceneFocus !== b.isSceneFocus) {
        return a.isSceneFocus ? -1 : 1;
      }
      if (Boolean(a.roleLabel) !== Boolean(b.roleLabel)) {
        return a.roleLabel ? -1 : 1;
      }
      return a.label.localeCompare(b.label);
    });
  }

  return references;
}

export function buildLegacyIndexSections(index: LegacySgdkIndex | null): LegacyIndexSection[] {
  if (!index) {
    return [];
  }

  return [
    { id: "source", label: "src/", files: index.source_files },
    { id: "headers", label: "inc/", files: index.header_files },
    { id: "manifests", label: "res/", files: index.manifest_files },
    { id: "resources", label: "assets host", files: index.resource_files },
    { id: "output", label: "out/", files: index.output_files },
  ].filter((section) => section.files.length > 0);
}

export function buildAssetTree(assets: ProjectAssetEntry[]): AssetTreeNode {
  const root: AssetTreeNode = { name: "", path: "", isDir: true, children: [], fileCount: 0 };

  for (const asset of assets) {
    const segments = asset.relative_path.replace(/\\/g, "/").split("/");
    let current = root;
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const isLast = index === segments.length - 1;
      if (isLast) {
        current.children.push({
          name: segment,
          path: asset.relative_path,
          isDir: false,
          children: [],
          asset,
          fileCount: 0,
        });
      } else {
        let dir = current.children.find((child) => child.isDir && child.name === segment);
        if (!dir) {
          dir = {
            name: segment,
            path: segments.slice(0, index + 1).join("/"),
            isDir: true,
            children: [],
            fileCount: 0,
          };
          current.children.push(dir);
        }
        current = dir;
      }
    }
  }

  function countFiles(node: AssetTreeNode): number {
    if (!node.isDir) {
      return 1;
    }
    let total = 0;
    for (const child of node.children) {
      total += countFiles(child);
    }
    node.fileCount = total;
    return total;
  }
  countFiles(root);

  return root;
}
