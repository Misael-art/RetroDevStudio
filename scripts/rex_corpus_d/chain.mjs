// Contrato de cadeia rastreavel: ROM -> tabela -> entrada -> pecas -> slots DPLC ->
// indice de arte -> endereco de arte -> paleta -> composicao, com enderecos explicitos.
// Lacuna (slot nao carregado) e sempre nomeada; nenhum tile e inventado.
import { readMappingFrame, readDplcFrame, slotToArt } from "./reader.mjs";
import { decodeAnimScript, expandAnimFrames } from "./anim.mjs";
import { composeFrame } from "./compose.mjs";

export function buildFrameRecord({ rom, profile, frame, frameName, palettes, globalFlip }) {
  const mapOffset = (rom[profile.map_table + frame * 2] << 8) | rom[profile.map_table + frame * 2 + 1];
  const mapAddr = profile.map_table + mapOffset;
  const dplcOffset = (rom[profile.dplc_table + frame * 2] << 8) | rom[profile.dplc_table + frame * 2 + 1];
  const dplcAddr = profile.dplc_table + dplcOffset;

  const piecesRaw = readMappingFrame(rom, profile, frame);
  const slots = readDplcFrame(rom, profile, frame);
  const gaps = [];
  const pieces = piecesRaw.map((p, i) => {
    const byte_addr = mapAddr + 1 + i * 5;
    const rec = {
      byte_addr,
      x: p.x,
      y: p.y,
      w_tiles: p.w,
      h_tiles: p.h,
      tile_slot: p.tile,
      xflip: p.xflip,
      yflip: p.yflip,
      pal: p.pal,
      pri: p.pri,
      palette_addr: profile.pal_addr + p.pal * 0x20,
      art_index: null,
      art_addr: null,
    };
    try {
      const art = slotToArt(slots, p.tile);
      rec.art_index = art;
      rec.art_addr = profile.art_addr + art * 32;
      rec.tiles_loaded = p.w * p.h;
    } catch (e) {
      rec.gap = String(e.message);
      gaps.push({ tile: p.tile, byte_addr, reason: rec.gap });
    }
    return rec;
  });

  const rec = {
    frame,
    frame_name: frameName ?? null,
    map: {
      table_addr: profile.map_table,
      entry_index: frame,
      entry_offset: mapOffset,
      addr: mapAddr,
      piece_count: piecesRaw.length,
      format: profile.map_format,
    },
    dplc: {
      table_addr: profile.dplc_table,
      entry_index: frame,
      entry_offset: dplcOffset,
      addr: dplcAddr,
      slots,
      format: profile.dplc_format,
      semantics: "p.tile indexa a ordem de carga do buffer DPLC do frame; arte = slots[tile]",
    },
    pieces,
    gaps,
  };
  if (palettes) {
    const img = composeFrame({ rom, profile, palettes, frame, globalFlip });
    rec.composition = { width: img.width, height: img.height, anchor: img.anchor };
  }
  return rec;
}

export function buildAnimRecord({ rom, profile, anim, ticks, special = false, palettes }) {
  const script = decodeAnimScript(rom, profile, anim, { special });
  const seq = expandAnimFrames(script, ticks);
  const cache = new Map();
  const sequence = seq.map((s, tick) => {
    if (s.frame === null) return { tick, frame: null, switch_to: s.switchTo };
    if (s.frame >= profile.map_frames) {
      return { tick, frame: s.frame, gap: `lacuna: frame ${s.frame} nao existe na tabela de mapping` };
    }
    if (!cache.has(s.frame)) {
      const rec = buildFrameRecord({ rom, profile, frame: s.frame, palettes });
      cache.set(s.frame, { map_addr: rec.map.addr, pieces: rec.pieces, composition: rec.composition ?? null });
    }
    return { tick, frame: s.frame, ...cache.get(s.frame) };
  });
  return {
    anim,
    script_addr: script.addr,
    interval: script.interval,
    interval_raw: script.intervalRaw,
    special,
    terminator: script.terminator,
    frames: script.frames,
    sequence,
  };
}
