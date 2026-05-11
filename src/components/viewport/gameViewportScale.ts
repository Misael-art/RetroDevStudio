const MD_WIDTH = 320;
const MD_HEIGHT = 224;

export function getGameViewportScale(
  availableWidth: number,
  availableHeight: number,
  baseWidth = MD_WIDTH,
  baseHeight = MD_HEIGHT
): number {
  if (
    !Number.isFinite(availableWidth) ||
    !Number.isFinite(availableHeight) ||
    availableWidth <= 0 ||
    availableHeight <= 0
  ) {
    return 1;
  }

  const widthScale = Math.floor(availableWidth / baseWidth);
  const heightScale = Math.floor(availableHeight / baseHeight);

  return Math.max(1, Math.min(widthScale, heightScale));
}
