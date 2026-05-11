import { getEntityDisplayName } from "../../core/entityDisplay";
import {
  resolveEntitySourceRefs,
  resolvePrimaryAuthoringSurface,
} from "../../core/entityAuthoring";
import { resolveImportedEntityContext } from "../../core/importedEntityContext";
import type { LegacySgdkIndex, Scene } from "../../core/ipc/sceneService";
import { getPreferredSceneEntity } from "../../core/sceneWorkspaceContext";
import type {
  LegacyProjectFilePreview,
  ProjectAssetEntry,
} from "../../core/ipc/toolsService";

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

export function collectAssetReferences(scene: Scene | null): Map<string, AssetReference[]> {
  const references = new Map<string, AssetReference[]>();
  if (!scene) {
    return references;
  }
  const focusEntityId = getPreferredSceneEntity(scene)?.entity_id ?? null;

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
    positionLabel: string | null = null
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
      positionLabel
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
      positionLabel
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
        positionLabel
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
        positionLabel
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
