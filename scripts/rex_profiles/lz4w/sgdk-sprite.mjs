// Validador da cadea SpriteDefinition -> animacion -> frame -> TileSet ->
// stream para ROMs SGDK 2.11 (layout FIXADO desde o xerador, non inferido
// por secuencias de ponteiros "plausibles").
//
// Versão do layout: SGDK 2.11 (abril 2025), instalación en disco
//   /home/misael/.local/share/sgdk_forge/sdk_9e22ce585b578c4c3246
// Serialización lida do propio rescomp (dc.w/dc.l big-endian, sen recheo):
//  SpriteDefinition (18 B)           — Sprite.java out():220-233
//    u16 w (=wf*8) | u16 h (=hf*8) | u32 palette* | u16 numAnimation |
//    u32 animations_table* | u16 maxNumTile | u16 maxNumSprite
//  tabla animations: numAnimation x u32 -> struct Animation
//  Animation (6 B)                   — SpriteAnimation.java:256-258
//    u16 (numFrame<<8)|loopIndex | u32 frames_table*
//  tabla frames: numFrame x u32 -> struct AnimationFrame
//  AnimationFrame                    — SpriteFrame.java:315-322
//    u16 (numSprite<<8)|timer (numSprite byte 0x81 = "optimisable": un só
//    VDPSprite, semantics en sprite_eng.c:1520-1530) | u32 tileset* |
//    u32 collision* (0 = sen colisión) | FrameVDPSprite[numSprite] inline
//  FrameVDPSprite (6 B)              — VDPSprite.java internalOutS:60-62
//    u8 offsetY | u8 offsetYFlip | u8 size = ((wt-1)<<2)|(ht-1) |
//    u8 offsetX | u8 offsetXFlip | u8 numTile (=wt*ht cells)
//  TileSet (8 B)                     — inc/vdp_tile.h + Tileset.java
//    u16 compression (0=NONE 1=APLIB 2=LZ4W, inc/tools.h) | u16 numTile |
//    u32 tiles*
// Igualdades globais derivadas do xerador (discriminantes fortes):
//  def.maxNumTile   == max_sobre_frames(tileset.numTile)   Sprite.java:135,
//                                                            SpriteAnimation:173-181
//  def.maxNumSprite == max_sobre_frames(numSprite_real)    Sprite.java:136,
//      onde numSprite_real = (byte==0x81 ? 1 : byte)       SpriteFrame:235,314
export const SGDK_LAYOUT_VERSION = "SGDK-2.11 (rescomp out(), sdk_9e22ce585b578c4c3246)";

export const COMPRESSION = { NONE: 0, APLIB: 1, LZ4W: 2 };
export const OPTIMISABLE_FLAG = 0x81;
const BYTES_PER_TILE_8X8_4BPP = 32;

const u8 = (rom, o) => rom[o];
const u16 = (rom, o) => ((rom[o] << 8) | rom[o + 1]) >>> 0;
const u32 = (rom, o) => (((((rom[o] << 8 | rom[o + 1]) << 8 | rom[o + 2]) << 8 | rom[o + 3]) >>> 0));

const inBoundsEven = (rom, ptr) => ptr !== undefined && ptr % 2 === 0 && ptr + 2 <= rom.length;

/** Header TileSet lido nun offset; NON valida (iso fai `parseTileSet`). */
export function readTileSetHeader(rom, offset) {
  return {
    offset,
    compression: u16(rom, offset),
    numTile: u16(rom, offset + 2),
    tiles: u32(rom, offset + 4),
  };
}

function parseTileSet(rom, ptr, defOffset) {
  if (!inBoundsEven(rom, ptr) || ptr + 8 > rom.length) return null;
  const ts = readTileSetHeader(rom, ptr);
  if (!(COMPRESSION.NONE <= ts.compression && ts.compression <= COMPRESSION.LZ4W)) return null;
  if (!(ts.numTile >= 1 && ts.numTile <= 4096)) return null;
  if (!(ts.tiles % 2 === 0 && ts.tiles < rom.length)) return null;
  if (ts.compression === COMPRESSION.NONE && ts.tiles + ts.numTile * BYTES_PER_TILE_8X8_4BPP > rom.length)
    return null;
  void defOffset;
  return ts;
}

function parseFrame(rom, ptr, limitNumSprite) {
  if (!inBoundsEven(rom, ptr) || ptr + 10 > rom.length) return null;
  const word = u16(rom, ptr);
  const numSpriteField = (word >> 8) & 0xff;
  const timer = word & 0xff;
  const actualNumSprite = numSpriteField === OPTIMISABLE_FLAG ? 1 : numSpriteField;
  if (actualNumSprite < 1 || actualNumSprite > 0xff) return null;
  if (actualNumSprite > limitNumSprite) return null;
  const tileSetPtr = u32(rom, ptr + 2);
  const collision = u32(rom, ptr + 6);
  const tileSet = parseTileSet(rom, tileSetPtr, ptr);
  if (tileSet === null) return null;
  if (!(collision === 0 || inBoundsEven(rom, collision))) return null;
  if (ptr + 10 + actualNumSprite * 6 > rom.length) return null;
  const sprites = [];
  for (let i = 0; i < actualNumSprite; i++) {
    const o = ptr + 10 + i * 6;
    const size = u8(rom, o + 2);
    const numTile = u8(rom, o + 5);
    // size = ((wt-1)<<2)|(ht-1) (VDPSprite.getFormattedSize); numTile = wt*ht.
    // Os "flip" son desprazamentos en px (0..255), non flags binarias.
    const wt = (size >> 2) + 1;
    const ht = (size & 3) + 1;
    if (wt > 8 || ht > 4 || wt * ht !== numTile) return null;
    if (numTile > tileSet.numTile) return null;
    sprites.push({
      offsetY: u8(rom, o),
      offsetYFlip: u8(rom, o + 1),
      size,
      offsetX: u8(rom, o + 3),
      offsetXFlip: u8(rom, o + 4),
      numTile,
      cellsWide: wt,
      cellsTall: ht,
    });
  }
  return {
    offset: ptr,
    numSpriteField,
    optimisable: numSpriteField === OPTIMISABLE_FLAG,
    actualNumSprite,
    timer,
    tileSet,
    collision,
    sprites,
  };
}

function parseAnimation(rom, ptr, limitNumSprite) {
  if (!inBoundsEven(rom, ptr) || ptr + 6 > rom.length) return null;
  const word = u16(rom, ptr);
  const numFrame = (word >> 8) & 0xff;
  const loopIndex = word & 0xff;
  const framesTable = u32(rom, ptr + 2);
  if (numFrame < 1 || numFrame > 255) return null;
  if (!inBoundsEven(rom, framesTable) || framesTable + numFrame * 4 > rom.length) return null;
  const frames = [];
  for (let i = 0; i < numFrame; i++) {
    const fp = u32(rom, framesTable + i * 4);
    const frame = parseFrame(rom, fp, limitNumSprite);
    if (frame === null) return null;
    frames.push(frame);
  }
  return { offset: ptr, numFrame, loopIndex, framesTable, frames };
}

/**
 * Candidato a SpriteDefinition en `off` (que non se validan "a primeira de
 * cambio": rexeitamento escalonado para que a cadea completa e as igualdades
 * do xerador sexan o filtro real).
 */
export function parseSpriteDefinition(rom, off) {
  if (off % 2 !== 0 || off + 18 > rom.length) return null;
  const w = u16(rom, off);
  const h = u16(rom, off + 2);
  if (!(w >= 8 && w <= 512 && w % 8 === 0)) return null;
  if (!(h >= 8 && h <= 512 && h % 8 === 0)) return null;
  const palette = u32(rom, off + 4);
  const numAnimation = u16(rom, off + 8);
  const animationsTable = u32(rom, off + 10);
  const maxNumTile = u16(rom, off + 14);
  const maxNumSprite = u16(rom, off + 16);
  if (!(inBoundsEven(rom, palette))) return null;
  if (numAnimation < 1 || numAnimation > 64) return null;
  if (!inBoundsEven(rom, animationsTable) || animationsTable + numAnimation * 4 > rom.length) return null;
  if (maxNumTile < 1 || maxNumTile > 4096) return null;
  if (maxNumSprite < 1 || maxNumSprite > 255) return null;

  const animations = [];
  const frames = [];
  for (let i = 0; i < numAnimation; i++) {
    const ap = u32(rom, animationsTable + i * 4);
    const anim = parseAnimation(rom, ap, maxNumSprite);
    if (anim === null) return null;
    animations.push({ offset: anim.offset, numFrame: anim.numFrame, loopIndex: anim.loopIndex, framesTable: anim.framesTable });
    frames.push(...anim.frames.map((f, j) => ({ ...f, animationIndex: i, frameIndex: j })));
  }
  // Non se fía do byte numSprite do frame ata que as igualdades do xerador
  // o confirman a nivel de definición completa:
  const derivedMaxTile = Math.max(...frames.map((f) => f.tileSet.numTile));
  const derivedMaxSprite = Math.max(...frames.map((f) => f.actualNumSprite));
  if (derivedMaxTile !== maxNumTile || derivedMaxSprite !== maxNumSprite) return null;
  return {
    offset: off,
    w,
    h,
    palette,
    numAnimation,
    animationsTable,
    maxNumTile,
    maxNumSprite,
    animations,
    frames,
  };
}

/**
 * Enumera tódalas SpriteDefinitions da ROM validando a cadea completa.
 * Devolve tamén a proxección compacta (streams LZ4W reachable coa súa ruta).
 */
export function validateRom(rom) {
  const definitions = [];
  for (let off = 0x20; off + 18 <= rom.length; off += 2) {
    const def = parseSpriteDefinition(rom, off);
    if (def !== null) definitions.push(def);
  }
  const lz4wReachable = [];
  const seen = new Set();
  for (const def of definitions)
    for (const f of def.frames)
      if (f.tileSet.compression === COMPRESSION.LZ4W && !seen.has(f.tileSet.tiles)) {
        seen.add(f.tileSet.tiles);
        lz4wReachable.push({
          tileSetOffset: f.tileSet.offset,
          numTile: f.tileSet.numTile,
          stream: f.tileSet.tiles,
          expectedOutBytes: f.tileSet.numTile * BYTES_PER_TILE_8X8_4BPP,
          reachedBy: definitions
            .filter((d) => d.frames.some((x) => x.tileSet.tiles === f.tileSet.tiles))
            .flatMap((d) =>
              d.frames
                .filter((x) => x.tileSet.tiles === f.tileSet.tiles)
                .map((x) => ({ def: d.offset, animation: x.animationIndex, frame: x.frameIndex }))
            ),
        });
      }
  return {
    layout: SGDK_LAYOUT_VERSION,
    romLength: rom.length,
    definitionCount: definitions.length,
    definitions,
    lz4wReachable,
  };
}
