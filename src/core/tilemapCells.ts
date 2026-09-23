/**
 * Tilemap cell values (shared editor/compiler contract):
 * - 0: no change over the base map (the tileset image drawn as the stage picture);
 * - TILEMAP_CELL_EMPTY: the cell is explicitly empty (blank tile in the ROM);
 * - N > 0: tile N-1 of the tileset image in row-major 8x8 order.
 * Projects saved before the empty value existed only use 0 and N, so they are unchanged.
 */
export const TILEMAP_CELL_BASE = 0;
export const TILEMAP_CELL_EMPTY = 0xffffffff;

export function isExplicitEmptyCell(value: number): boolean {
  return value === TILEMAP_CELL_EMPTY;
}

export function tilesetAtlasIndex(value: number): number | null {
  return value > 0 && value !== TILEMAP_CELL_EMPTY ? value - 1 : null;
}
