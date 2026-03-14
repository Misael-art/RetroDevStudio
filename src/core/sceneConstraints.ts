export type EditorTarget = "megadrive" | "snes";

export const ONBOARDING_SPRITE_ASSET = "assets/sprites/onboarding_player.ppm";
export const ONBOARDING_SPRITE_SIZE = 16;
export const TILE_SIZE = 8;

const MD_SIMPLE_SPRITE_MAX = 32;
const SNES_SIMPLE_SPRITE_SIZES = [8, 16, 32, 64] as const;

function normalizeAssetPath(asset?: string): string {
  return (asset ?? "").replace(/\\/g, "/").toLowerCase();
}

function snapUpToTile(value: number): number {
  if (!Number.isFinite(value)) {
    return TILE_SIZE;
  }

  return Math.max(TILE_SIZE, Math.ceil(value / TILE_SIZE) * TILE_SIZE);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function nextSnesSimpleSpriteSize(value: number): number {
  return SNES_SIMPLE_SPRITE_SIZES.find((size) => value <= size) ?? SNES_SIMPLE_SPRITE_SIZES[SNES_SIMPLE_SPRITE_SIZES.length - 1];
}

export function isOnboardingSpriteAsset(asset?: string): boolean {
  return normalizeAssetPath(asset) === ONBOARDING_SPRITE_ASSET;
}

export function constrainSpriteFrameSize(
  target: EditorTarget,
  asset: string | undefined,
  frameWidth: number,
  frameHeight: number
): { frameWidth: number; frameHeight: number } {
  if (isOnboardingSpriteAsset(asset)) {
    return {
      frameWidth: ONBOARDING_SPRITE_SIZE,
      frameHeight: ONBOARDING_SPRITE_SIZE,
    };
  }

  const snappedWidth = snapUpToTile(frameWidth);
  const snappedHeight = snapUpToTile(frameHeight);

  if (target === "megadrive") {
    return {
      frameWidth: clamp(snappedWidth, TILE_SIZE, MD_SIMPLE_SPRITE_MAX),
      frameHeight: clamp(snappedHeight, TILE_SIZE, MD_SIMPLE_SPRITE_MAX),
    };
  }

  const squareSize = nextSnesSimpleSpriteSize(Math.max(snappedWidth, snappedHeight));
  return {
    frameWidth: squareSize,
    frameHeight: squareSize,
  };
}
