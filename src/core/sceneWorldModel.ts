import type { Entity, Scene } from "./ipc/sceneService";
import { getEntityDisplayName } from "./entityDisplay";

export type SceneViewportFrame = {
  width: number;
  height: number;
};

export type SceneWorldBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
};

export type SceneWorldCameraFrame = {
  entityId: string;
  label: string;
  followEntityId: string | null;
  focusX: number;
  focusY: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SceneWorldMetrics = {
  frame: SceneViewportFrame;
  bounds: SceneWorldBounds;
  worldWidth: number;
  worldHeight: number;
  largeWorld: boolean;
  dominantTilemapId: string | null;
  tilemapWorldSize: { width: number; height: number } | null;
  collisionWorldSize: { width: number; height: number } | null;
  camera: SceneWorldCameraFrame | null;
  centerX: number;
  centerY: number;
};

export type ViewportPan = {
  x: number;
  y: number;
};

export type ViewportPanClampOptions = {
  enabled: boolean;
  pan: ViewportPan;
  stageWidth: number;
  stageHeight: number;
  contentWidth: number;
  contentHeight: number;
};

export function getSceneViewportFrame(target: "megadrive" | "snes"): SceneViewportFrame {
  return {
    width: target === "snes" ? 256 : 320,
    height: 224,
  };
}

export function getSceneEntityBounds(
  entity: Entity,
  target: "megadrive" | "snes",
  entities: Entity[] = []
): { x: number; y: number; width: number; height: number; resizable: boolean } {
  if (entity.components?.tilemap) {
    return {
      x: entity.transform.x,
      y: entity.transform.y,
      width: entity.components.tilemap.map_width * 8,
      height: entity.components.tilemap.map_height * 8,
      resizable: false,
    };
  }

  if (entity.components?.camera) {
    const frame = getSceneViewportFrame(target);
    const offsetX = entity.components.camera.offset_x ?? 0;
    const offsetY = entity.components.camera.offset_y ?? 0;
    const followedEntity =
      entity.components.camera.follow_entity
        ? entities.find((candidate) => candidate.entity_id === entity.components.camera?.follow_entity)
        : null;

    if (followedEntity) {
      const followedBounds = getSceneEntityBounds(followedEntity, target, entities);
      const focusX = followedBounds.x + followedBounds.width / 2 + offsetX;
      const focusY = followedBounds.y + followedBounds.height / 2 + offsetY;
      return {
        x: Math.round(focusX - frame.width / 2),
        y: Math.round(focusY - frame.height / 2),
        width: frame.width,
        height: frame.height,
        resizable: false,
      };
    }

    return {
      x: entity.transform.x + offsetX,
      y: entity.transform.y + offsetY,
      width: frame.width,
      height: frame.height,
      resizable: false,
    };
  }

  return {
    x: entity.transform.x,
    y: entity.transform.y,
    width: entity.components?.sprite?.frame_width ?? 32,
    height: entity.components?.sprite?.frame_height ?? 32,
    resizable: Boolean(entity.components?.sprite),
  };
}

function unionBounds(
  current: SceneWorldBounds,
  next: { x: number; y: number; width: number; height: number }
): SceneWorldBounds {
  const minX = Math.min(current.minX, next.x);
  const minY = Math.min(current.minY, next.y);
  const maxX = Math.max(current.maxX, next.x + next.width);
  const maxY = Math.max(current.maxY, next.y + next.height);
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function createInitialBounds(frame: SceneViewportFrame): SceneWorldBounds {
  return {
    minX: 0,
    minY: 0,
    maxX: frame.width,
    maxY: frame.height,
    width: frame.width,
    height: frame.height,
  };
}

export function resolveSceneWorldMetrics(
  scene: Scene | null | undefined,
  target: "megadrive" | "snes"
): SceneWorldMetrics {
  const frame = getSceneViewportFrame(target);
  let bounds = createInitialBounds(frame);
  let dominantTilemapId: string | null = null;
  let dominantTilemapArea = 0;
  let tilemapWorldSize: { width: number; height: number } | null = null;
  let collisionWorldSize: { width: number; height: number } | null = null;
  let camera: SceneWorldCameraFrame | null = null;

  if (scene?.collision_map) {
    const collisionWidth = scene.collision_map.width * scene.collision_map.tile_width;
    const collisionHeight = scene.collision_map.height * scene.collision_map.tile_height;
    bounds = unionBounds(bounds, { x: 0, y: 0, width: collisionWidth, height: collisionHeight });
    collisionWorldSize = { width: collisionWidth, height: collisionHeight };
  }

  for (const entity of scene?.entities ?? []) {
    const entityBounds = getSceneEntityBounds(entity, target, scene?.entities ?? []);
    bounds = unionBounds(bounds, entityBounds);

    if (entity.components?.tilemap) {
      const area = entityBounds.width * entityBounds.height;
      if (area > dominantTilemapArea) {
        dominantTilemapArea = area;
        dominantTilemapId = entity.entity_id;
        tilemapWorldSize = {
          width: entityBounds.width,
          height: entityBounds.height,
        };
      }
    }

    if (!camera && entity.components?.camera) {
      const focusX = entityBounds.x + entityBounds.width / 2;
      const focusY = entityBounds.y + entityBounds.height / 2;
      camera = {
        entityId: entity.entity_id,
        label: getEntityDisplayName(entity),
        followEntityId: entity.components.camera.follow_entity ?? null,
        focusX,
        focusY,
        x: entityBounds.x,
        y: entityBounds.y,
        width: entityBounds.width,
        height: entityBounds.height,
      };
    }
  }

  return {
    frame,
    bounds,
    worldWidth: bounds.width,
    worldHeight: bounds.height,
    largeWorld: bounds.width > frame.width || bounds.height > frame.height,
    dominantTilemapId,
    tilemapWorldSize,
    collisionWorldSize,
    camera,
    centerX: camera?.focusX ?? bounds.minX + bounds.width / 2,
    centerY: camera?.focusY ?? bounds.minY + bounds.height / 2,
  };
}

export function clampViewportPan({
  enabled,
  pan,
  stageWidth,
  stageHeight,
  contentWidth,
  contentHeight,
}: ViewportPanClampOptions): ViewportPan {
  if (!enabled || stageWidth <= 0 || stageHeight <= 0) {
    return pan;
  }

  const limitX = Math.max(0, (contentWidth - stageWidth) / 2);
  const limitY = Math.max(0, (contentHeight - stageHeight) / 2);
  return {
    x: Math.min(limitX, Math.max(-limitX, pan.x)),
    y: Math.min(limitY, Math.max(-limitY, pan.y)),
  };
}

export function getViewportPanForWorldPoint({
  pointX,
  pointY,
  zoom,
  worldBounds,
  worldWidth,
  worldHeight,
  contentOffset,
}: {
  pointX: number;
  pointY: number;
  zoom: number;
  worldBounds: SceneWorldBounds;
  worldWidth: number;
  worldHeight: number;
  contentOffset: number;
}): ViewportPan {
  const localX = (pointX - worldBounds.minX) * zoom + contentOffset;
  const localY = (pointY - worldBounds.minY) * zoom + contentOffset;
  return {
    x: worldWidth * zoom / 2 + contentOffset / 2 - localX,
    y: worldHeight * zoom / 2 + contentOffset / 2 - localY,
  };
}
