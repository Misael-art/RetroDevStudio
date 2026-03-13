import type { PaletteEntry, Scene } from "../../core/ipc/sceneService";

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface VramImageDataLike {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

const DEFAULT_MD_PALETTE = [
  "#000000",
  "#202040",
  "#404080",
  "#6060C0",
  "#8080FF",
  "#A0A0FF",
  "#C0C0FF",
  "#FFFFFF",
  "#204020",
  "#408040",
  "#60C060",
  "#80FF80",
  "#804020",
  "#C08040",
  "#FFC060",
  "#FFE0A0",
];

const DEFAULT_SNES_PALETTE = [
  "#000000",
  "#1F1F1F",
  "#3F3F3F",
  "#5F5F5F",
  "#7F7F7F",
  "#9F9F9F",
  "#BFBFBF",
  "#DFDFDF",
  "#1F001F",
  "#3F003F",
  "#7F007F",
  "#BF00BF",
  "#001F1F",
  "#003F3F",
  "#007F7F",
  "#00BFBF",
];

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function parseHexColor(value: string): RgbColor {
  const normalized = value.trim().replace(/^#/, "");
  const hex = normalized.length === 3
    ? normalized.split("").map((char) => `${char}${char}`).join("")
    : normalized.padEnd(6, "0").slice(0, 6);
  const parsed = Number.parseInt(hex, 16);

  if (Number.isNaN(parsed)) {
    return { r: 0, g: 0, b: 0 };
  }

  return {
    r: clampByte((parsed >> 16) & 0xff),
    g: clampByte((parsed >> 8) & 0xff),
    b: clampByte(parsed & 0xff),
  };
}

export function getActivePalette(
  scene: Scene | null,
  target: "megadrive" | "snes",
  preferredSlot: number | null
): string[] {
  const palettes = [...(scene?.palettes ?? [])]
    .sort((left, right) => left.slot - right.slot);
  const paletteFromScene = palettes.find((entry) => entry.slot === preferredSlot)
    ?? palettes[0];

  if (paletteFromScene?.colors.length) {
    return normalizePaletteColors(paletteFromScene);
  }

  return target === "snes" ? DEFAULT_SNES_PALETTE : DEFAULT_MD_PALETTE;
}

function normalizePaletteColors(palette: PaletteEntry): string[] {
  const colors = palette.colors
    .slice(0, 16)
    .map((color) => {
      const normalized = color.trim();
      return normalized.startsWith("#") ? normalized : `#${normalized}`;
    });

  while (colors.length < 16) {
    colors.push("#000000");
  }

  return colors;
}

export function decodeTilesToImageData(
  vramData: number[],
  palette: string[],
  tilesPerRow: number
): VramImageDataLike {
  const bytesPerTile = 32;
  const tileCount = Math.max(Math.floor(vramData.length / bytesPerTile), 1);
  const rowCount = Math.max(Math.ceil(tileCount / tilesPerRow), 1);
  const width = tilesPerRow * 8;
  const height = rowCount * 8;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const paletteRgb = palette.map(parseHexColor);

  for (let tileIndex = 0; tileIndex < tileCount; tileIndex += 1) {
    const tileOffset = tileIndex * bytesPerTile;
    const tileX = (tileIndex % tilesPerRow) * 8;
    const tileY = Math.floor(tileIndex / tilesPerRow) * 8;

    for (let pixelIndex = 0; pixelIndex < bytesPerTile; pixelIndex += 1) {
      const packedByte = vramData[tileOffset + pixelIndex] ?? 0;
      const row = Math.floor(pixelIndex / 4);
      const column = (pixelIndex % 4) * 2;

      for (let nibble = 0; nibble < 2; nibble += 1) {
        const paletteIndex = nibble === 0 ? (packedByte >> 4) & 0x0f : packedByte & 0x0f;
        const color = paletteRgb[paletteIndex] ?? paletteRgb[0] ?? { r: 0, g: 0, b: 0 };
        const x = tileX + column + nibble;
        const y = tileY + row;
        const rgbaOffset = (y * width + x) * 4;

        rgba[rgbaOffset] = color.r;
        rgba[rgbaOffset + 1] = color.g;
        rgba[rgbaOffset + 2] = color.b;
        rgba[rgbaOffset + 3] = 255;
      }
    }
  }

  return {
    data: rgba,
    width,
    height,
  };
}
