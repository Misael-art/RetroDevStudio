// Fase 4: clase e consumidor de 0xc8cc8 (directiva: "non acepte clasificación
// por tamaño ou enderezo"). Expectativas fixadas ANTES da implementación, todas
// medidas sobre a ROM HAMOOPIG co probe estrutural previo:
//  - única referencia absoluta u32 a 0xc8cc8: 0x2578c = campo `tiles` do
//    header TileSet @0x25788 {comp=2 LZ4W, numTile=9} (layout SGDK 2.11 pinado).
//  - a lectura "palette-def" ({numColor, data}) que encaixa en 0xc8cc8 vive en
//    0x2578a, DENTRO do propio header TileSet: é o campo numTile=9 re-lido como
//    numColor. Esa é exactamente a trampa "9 paletas x 16 cores = 288 bytes".
//  - o payload decodificado (288 B, 144 B consumidos) contén 18 palabras BE con
//    bit0=1 (0xaaaa, 0xefef-style): IMPOSIBLE en paletas SGDK. Calibración
//    medida: as 960 palabras das 60 paletas de tódalas defs validadas teñen
//    bit0=0. En cambio os nibbles do payload son {0,10,12,13,14,15}: datos de
//    tile 4bpp con 5 cores + transparente, coherentes co VDPSprite 3x3=9 tiles.
//  - cadea: TileSet@0x25788 <- SpriteFrame@0x25790 (frame 0) <- SpriteAnimation
//    <- SpriteDefinition@0x258e8 (palette 0x221e6), referenciada 4 veces desde
//    o segmento de código (< 0x10000).
//  - o frame 1 da MESMA animación ten tiles en 0xc8d58 = 0xc8cc8 + 144
//    exactamente: calquera recomposición que cambie a lonxitude do stream despraza
//    streams veciños. Isto documenta a explicación alternativa do efecto E2e
//    observado polo integrador SEN necesidade de clase "paleta".
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { lz4wDecode } from "./lz4w.mjs";
import { readTileSetHeader, validateRom } from "./sgdk-sprite.mjs";
import { readPaletteDefinition } from "./graphics.mjs";
import {
  findU32Refs,
  findPaletteLikeRefs,
  nibbleAlphabet,
  countOddBit0Words,
} from "./resourceclass.mjs";

const ROM_PATH =
  process.env.HAMOOPIG_ROM ??
  "/home/misael/Projects/RetroDevStudio-CANONICAL-2026-09-21/data/canonical-local-2026-09-21/corpus/references/hamoopig-reference.bin";
const ROM_SHA256 = "558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9";
const haveRom = existsSync(ROM_PATH);
const rom = haveRom ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

test("identidade da ROM", { skip: !haveRom }, () => {
  assert.equal(sha256(rom), ROM_SHA256);
});

test("referencia verificada: a única u32 absoluta a 0xc8cc8 é o campo tiles do TileSet @0x25788", { skip: !haveRom }, () => {
  const refs = findU32Refs(rom, 0xc8cc8);
  assert.deepEqual(refs, [0x2578c], "agárdase exactamente unha referencia");
  const ts = readTileSetHeader(rom, 0x25788);
  assert.deepEqual(ts, { offset: 0x25788, compression: 2, numTile: 9, tiles: 0xc8cc8 });
  assert.equal(ts.tiles, 0xc8cc8);
  assert.equal(refs[0], ts.offset + 4, "a referencia cae no desprazamento do campo tiles");
});

test("sen consumidora paleta: toda lectura {numColor,data}=0xc8cc8 é un alias DENTRO do header TileSet", { skip: !haveRom }, () => {
  const palLike = findPaletteLikeRefs(rom, 0xc8cc8);
  assert.deepEqual(palLike, [0x2578a], "única lectura palette-like: 0x2578a");
  // 0x2578a está entre 0x25788 e 0x25790: é o campo numTile=0x0009 re-interpretado.
  // Non existe NINGUNHA Palette definition SGDK que apunte a 0xc8cc8.
  assert.ok(0x2578a > 0x25788 && 0x2578a < 0x25790);
});

test("clase estrutural: payload = datos de tile 4bpp, NON 9 paletas de 16 cores", { skip: !haveRom }, () => {
  const out = lz4wDecode(rom.slice(0xc8cc8), rom.slice(0, 0xc8cc8));
  assert.equal(out.bytesConsumed, 144, "o stream ocupa exactamente 144 B (o frame 1 comeza en 0xc8d58)");
  assert.equal(out.data.length, 288);
  // a) alfabeto de nibbles restrinxido: sen 1..9 nin 11 => 5 cores + transparente
  assert.deepEqual(nibbleAlphabet(out.data), [0, 10, 12, 13, 14, 15]);
  // b) 18 palabras BE con bit0=1 => imposible como saída de paleta SGDK
  assert.equal(countOddBit0Words(out.data), 18);
  // c) calibración na propia ROM: tódalas paletas das defs validadas teñen
  //    bit0=0 en tódalas palabras (criterio medido, non asumido).
  const r = validateRom(rom);
  let words = 0;
  for (const def of r.definitions) {
    if (!def.palette) continue;
    const pal = readPaletteDefinition(rom, def.palette);
    for (let i = 0; i < pal.numColor; i++) {
      const w = (rom[pal.data + 2 * i] << 8) | rom[pal.data + 2 * i + 1]; // palabra BE crúa, sen re-codificar
      assert.equal(w & 1, 0, `palette @${def.palette.toString(16)}: palabra ${i} = 0x${w.toString(16)} ten bit0=1`);
      words++;
    }
  }
  assert.ok(words >= 900, `calibración con moitas palabras (medidas: ${words})`);
});

test("consumidor: TileSet@0x25788 -> SpriteFrame@0x25790 -> SpriteDefinition@0x258e8 (3x3 celas, 9 tiles)", { skip: !haveRom }, () => {
  assert.deepEqual(findU32Refs(rom, 0x25788), [0x25792], "única referencia ao header, no campo tileset* do frame");
  const r = validateRom(rom);
  const def = r.definitions.find((d) => d.offset === 0x258e8);
  assert.ok(def, "a definición 0x258e8 está validada pola cadea SGDK pinada");
  const frame = def.frames.find((f) => f.offset === 0x25790);
  assert.ok(frame, "frame 0 da animación");
  assert.equal(frame.tileSet.offset, 0x25788);
  assert.equal(frame.tileSet.numTile, 9);
  assert.equal(frame.sprites.length, 1);
  assert.equal(frame.sprites[0].cellsWide * frame.sprites[0].cellsTall, 9, "VDPSprite 3x3 == numTile");
  assert.equal(def.palette, 0x221e6, "a paleta da definición é unha Palette definition real, non 0xc8cc8");
});

test("alcanzable: a definición 0x258e8 está referenciada desde o segmento de código (4 sitios, < 0x10000)", { skip: !haveRom }, () => {
  const refs = findU32Refs(rom, 0x258e8);
  assert.equal(refs.length, 4);
  for (const o of refs) assert.ok(o < 0x10000, `referencia 0x${o.toString(16)} fora do segmento de código`);
});

test("veciñanza: frame 1 da mesma animación comeza exactamente tras 144 B (0xc8d58) — desprazamento en recomposición explicaría efectos E2E globais", { skip: !haveRom }, () => {
  const r = validateRom(rom);
  const def = r.definitions.find((d) => d.offset === 0x258e8);
  const frame1 = def.frames[1];
  assert.equal(frame1.tileSet.tiles, 0xc8d58);
  const ts1 = readTileSetHeader(rom, frame1.tileSet.offset);
  assert.equal(ts1.compression, 2);
  const out1 = lz4wDecode(rom.slice(0xc8d58), rom.slice(0, 0xc8d58));
  assert.equal(out1.data.length, ts1.numTile * 32, "o stream seguinte segue intacto tras 144 B");
});
