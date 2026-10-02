// Testes da cadeia LZ4W en recursos de sprite SGDK 2.11 (ROM HAMOOPIG).
// Expectativas fixadas ANTES da implementación (TDD). Fontes das pins:
//  - vectores do decoder: calculados á man na especificación do unpacker
//    oficial (port verificado polo integrador en rex_codecs.rs).
//  - identidade da ROM + header TileSet 0x25788 + lonxitude 288 do stream
//    0xc8cc8: evidencia verificada no produto (docs/rex_profiles/ROUND_STATE.md,
//    cadea LZ4W HAMOOPIG; 9 tiles * 32 bytes/tile 8x8 4bpp).
//  - layouts: lidos do xerador rescomp SGDK 2.11 en
//    /home/misael/.local/share/sgdk_forge/sdk_9e22ce585b578c4c3246
//    (Sprite.java out(), SpriteAnimation.java:249-258, SpriteFrame.java:315-322,
//    VDPSprite.java internalOutS:60-62).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { lz4wDecode } from "./lz4w.mjs";
import { readTileSetHeader, validateRom } from "./sgdk-sprite.mjs";

const ROM_PATH =
  process.env.HAMOOPIG_ROM ??
  "/home/misael/Projects/RetroDevStudio-CANONICAL-2026-09-21/data/canonical-local-2026-09-21/corpus/references/hamoopig-reference.bin";

const ROM_SHA256 = "558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const hx = (h) => Uint8Array.from(Buffer.from(h, "hex"));

// --- decodificador LZ4W: vectores propios calculados á man -----------------

test("lz4w: só literais (token 0x1000 + palabra literal, terminador par)", () => {
  // 10 00 | 41 42 | 00 00 | 00 00  -> literais word LE verbatim -> 41 42
  const out = lz4wDecode(hx("1000414200000000"), null);
  assert.equal(sha256(out.data), sha256(hx("4142")));
  assert.equal(out.bytesConsumed, 8);
});

test("lz4w: match curto (1 literal + match de 2 words a offset 1)", () => {
  // token 0x1100 -> literal_count=1, match_nibble=1 => match_words =
  // nibble+MATCH_MIN_SIZE(1) = 2 words, offset = match_byte+1 = 1.
  // 41 42 literal; match de 2 words repite a palabra anterior (solapada):
  // saida = 41 42 41 42 41 42
  const out = lz4wDecode(hx("1100414200000000"), null);
  assert.equal(sha256(out.data), sha256(hx("414241424142")));
});

test("lz4w: byte final ímpar (0x8000|byte) engade o byte", () => {
  // token 0x1000 (1 literal 41 42), terminador 0x0000, final 0x80FF -> 41 42 FF
  const out = lz4wDecode(hx("10004142000080ff"), null);
  assert.equal(sha256(out.data), sha256(hx("4142ff")));
});

test("lz4w: stream ROM-source recusado sen dicionario (decode autonomo)", () => {
  // token 0x0001: match longo (match_nibble=0, match_byte=1 => 3 words);
  // word de offset 0xFFFB leva a flag 0x8000 (referencia ao bloque anterior
  // = dicionario). Sen dicionario o decoder debe recusar (invalid_reference
  // "ROM source"), como fai o Rust do produto — non inventar bytes.
  const tok = hx("0001fffb00000000");
  assert.throws(() => lz4wDecode(tok, null), /dicion|invalid_reference/i);
});

// --- ROM real (BYOR local; skip se non presente) ---------------------------

const haveRom = existsSync(ROM_PATH);
const rom = haveRom ? new Uint8Array(readFileSync(ROM_PATH)) : null;

test("identidade da ROM HAMOOPIG (sha256 e banner)", { skip: !haveRom }, () => {
  assert.equal(sha256(rom), ROM_SHA256);
  const banner = Buffer.from(rom.slice(0x100, 0x100 + 16)).toString("latin1");
  // campo de 16 bytes: "SEGA MEGA DRIVE" + padding de espacio
  assert.equal(banner.trimEnd(), "SEGA MEGA DRIVE");
});

test("header TileSet coñecido 0x25788 = {lz4w, 9 tiles, 0xc8cc8}", { skip: !haveRom }, () => {
  const ts = readTileSetHeader(rom, 0x25788);
  assert.deepEqual(ts, { offset: 0x25788, compression: 2, numTile: 9, tiles: 0xc8cc8 });
});

test("stream 0xc8cc8 decodifica co dicionário prefixo a 9*32 bytes exactos", { skip: !haveRom }, () => {
  // Variante verificada no produto: TODOS os streams LZ4W da ROM son
  // prev-block; dicionario = rom[0..0xc8cc8].
  const out = lz4wDecode(rom.slice(0xc8cc8), rom.slice(0, 0xc8cc8));
  assert.equal(out.data.length, 9 * 32, "lonxitude esperada do tileset faísca");
  assert.ok(out.bytesConsumed > 0 && 0xc8cc8 + out.bytesConsumed <= rom.length);
});

// --- validador da cadea completa -------------------------------------------

test("validateRom: atopa SpriteDefinitions coa cadea completa validada e igualdades", { skip: !haveRom }, () => {
  const r = validateRom(rom);
  assert.ok(r.definitions.length >= 8, `esperabanse >=8 defs validadas, atopadas ${r.definitions.length}`);
  for (const def of r.definitions) {
    // igualdades derivadas do xerador (Sprite.java:135-136, SpriteAnimation:173-191):
    const maxTile = Math.max(...def.frames.map((f) => f.tileSet.numTile));
    const maxSprite = Math.max(...def.frames.map((f) => f.actualNumSprite));
    assert.equal(def.maxNumTile, maxTile, `def ${def.offset.toString(16)}: maxNumTile`);
    assert.equal(def.maxNumSprite, maxSprite, `def ${def.offset.toString(16)}: maxNumSprite`);
    assert.ok(def.w % 8 === 0 && def.h % 8 === 0);
    for (const f of def.frames) {
      assert.ok(f.tileSet.offset < rom.length);
      assert.ok((f.tileSet.tiles & 1) === 0 || f.tileSet.compression !== 0);
    }
  }
});

test("validateRom: determinista — dous runns producen o mesmo sha256 do JSON", { skip: !haveRom }, () => {
  const a = JSON.stringify(validateRom(rom));
  const b = JSON.stringify(validateRom(rom));
  assert.equal(sha256(Buffer.from(a)), sha256(Buffer.from(b)));
});

test("validateRom: cada TileSet LZ4W reachable decodifica a numTile*32 co dicionario prefixo", { skip: !haveRom }, () => {
  const r = validateRom(rom);
  const lz4w = [];
  for (const def of r.definitions)
    for (const f of def.frames)
      if (f.tileSet.compression === 2 && !lz4w.some((z) => z.tiles === f.tileSet.tiles)) lz4w.push(f.tileSet);
  assert.ok(lz4w.length >= 1, "agárdase polo menos un TileSet LZ4W reachable (p.ex. faísca 0xc8cc8)");
  for (const ts of lz4w) {
    const out = lz4wDecode(rom.slice(ts.tiles), rom.slice(0, ts.tiles));
    assert.equal(out.data.length, ts.numTile * 32, `stream ${ts.tiles.toString(16)}: lonxitude != numTile*32`);
  }
});
