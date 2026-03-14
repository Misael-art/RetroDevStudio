import type { Entity } from "./ipc/sceneService";
import type { ProjectAssetEntry } from "./ipc/toolsService";
import {
  constrainSpriteFrameSize,
  isOnboardingSpriteAsset,
  ONBOARDING_SPRITE_ASSET,
  ONBOARDING_SPRITE_SIZE,
  type EditorTarget,
} from "./sceneConstraints";

const DEFAULT_SPRITE_X = 48;
const DEFAULT_SPRITE_Y = 64;

function slugifyEntityId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\\/g, "/")
    .replace(/^.*\//, "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || "sprite";
}

function displayNameFromAsset(assetPath: string): string {
  const baseName = assetPath.replace(/\\/g, "/").replace(/^.*\//, "").replace(/\.[a-z0-9]+$/i, "");
  return baseName || "Sprite";
}

function ensureUniqueEntityId(baseId: string, existingEntityIds: Iterable<string>): string {
  const taken = new Set(existingEntityIds);
  if (!taken.has(baseId)) {
    return baseId;
  }

  let suffix = 2;
  while (taken.has(`${baseId}_${suffix}`)) {
    suffix += 1;
  }
  return `${baseId}_${suffix}`;
}

export function createStarterLogicGraph(targetEntityId: string): string {
  return JSON.stringify({
    version: 1,
    nodes: [
      {
        id: "start",
        type: "event_start",
        label: "On Start",
        x: 40,
        y: 80,
        inputs: [],
        outputs: [{ id: "exec", label: "->", kind: "exec" }],
        params: {},
      },
      {
        id: "move",
        type: "sprite_move",
        label: "Move Sprite",
        x: 240,
        y: 80,
        inputs: [
          { id: "exec", label: "->", kind: "exec" },
          { id: "dx", label: "dx", kind: "data", dataType: "int" },
          { id: "dy", label: "dy", kind: "data", dataType: "int" },
        ],
        outputs: [{ id: "exec", label: "->", kind: "exec" }],
        params: {
          target: targetEntityId,
          dx: 1,
          dy: 0,
        },
      },
    ],
    edges: [
      {
        id: "edge_start_move",
        fromNode: "start",
        fromPort: "exec",
        toNode: "move",
        toPort: "exec",
      },
    ],
  });
}

export function pickDefaultSpriteAsset(
  assets: Pick<ProjectAssetEntry, "kind" | "relative_path">[]
): string | null {
  const imageAssets = assets.filter((asset) => asset.kind === "image");
  if (imageAssets.length === 0) {
    return null;
  }

  const onboardingAsset = imageAssets.find((asset) => isOnboardingSpriteAsset(asset.relative_path));
  return onboardingAsset?.relative_path ?? imageAssets[0].relative_path;
}

export function createSpriteEntityFromAsset(options: {
  assetPath: string;
  target: EditorTarget;
  existingEntityIds: Iterable<string>;
  suggestedName?: string;
  x?: number;
  y?: number;
  includeStarterLogic?: boolean;
}): Entity {
  const {
    assetPath,
    target,
    existingEntityIds,
    suggestedName,
    x = DEFAULT_SPRITE_X,
    y = DEFAULT_SPRITE_Y,
    includeStarterLogic = false,
  } = options;
  const entityBaseId = slugifyEntityId(suggestedName ?? assetPath);
  const entityId = ensureUniqueEntityId(entityBaseId, existingEntityIds);
  const constrainedFrame = constrainSpriteFrameSize(
    target,
    assetPath,
    ONBOARDING_SPRITE_SIZE,
    ONBOARDING_SPRITE_SIZE
  );

  return {
    entity_id: entityId,
    prefab: displayNameFromAsset(suggestedName ?? assetPath),
    transform: { x, y },
    components: {
      sprite: {
        asset: assetPath || ONBOARDING_SPRITE_ASSET,
        frame_width: constrainedFrame.frameWidth,
        frame_height: constrainedFrame.frameHeight,
        palette_slot: 0,
        priority: "foreground",
        animations: {},
      },
      ...(includeStarterLogic
        ? {
            logic: {
              graph: createStarterLogicGraph(entityId),
              variables: {},
            },
          }
        : {}),
    },
  };
}
