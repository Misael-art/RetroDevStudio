// Leitor limitado do perfil Sonic 1 (SonicMappingsVer=1, SonicDplcVer=1).
// Enderechos absolutos vem do profile JSON (verificados na ROM local, nao em outra revisao).

export function sbyte(value) {
  return value >= 0x80 ? value - 0x100 : value;
}

function wordAt(rom, addr) {
  return (rom[addr] << 8) | rom[addr + 1];
}

function frameEntryAddr(rom, table, frames, frame, kind) {
  if (frame < 0 || frame >= frames) throw new Error(`frame ${frame} fora da tabela ${kind} (${frames} entradas)`);
  return table + wordAt(rom, table + frame * 2);
}

export function readMappingFrame(rom, profile, frame) {
  const addr = frameEntryAddr(rom, profile.map_table, profile.map_frames, frame, "mapping");
  const count = rom[addr];
  const pieces = [];
  for (let i = 0; i < count; i++) {
    const p = addr + 1 + i * 5;
    const y = sbyte(rom[p]);
    const size = rom[p + 1];
    const flagsHi = rom[p + 2];
    const tileLo = rom[p + 3];
    const x = sbyte(rom[p + 4]);
    const tile = ((flagsHi & 0x07) << 8) | tileLo;
    pieces.push({
      x,
      y,
      w: ((size >> 2) & 3) + 1,
      h: (size & 3) + 1,
      tile,
      xflip: (flagsHi >> 3) & 1,
      yflip: (flagsHi >> 4) & 1,
      pal: (flagsHi >> 5) & 3,
      pri: (flagsHi >> 7) & 1,
    });
  }
  return pieces;
}

export function readDplcFrame(rom, profile, frame) {
  const addr = frameEntryAddr(rom, profile.dplc_table, profile.dplc_frames, frame, "DPLC");
  const count = rom[addr];
  const slots = [];
  for (let i = 0; i < count; i++) {
    const entry = wordAt(rom, addr + 1 + i * 2);
    const tiles = (entry >> 12) + 1;
    const artIndex = entry & 0xfff;
    for (let t = 0; t < tiles; t++) slots.push(artIndex + t);
  }
  return slots;
}

export function slotToArt(slots, tileSlot) {
  if (tileSlot < 0 || tileSlot >= slots.length) {
    throw new Error(`lacuna: slot ${tileSlot} nao e carregado pelo DPLC deste frame (${slots.length} slots)`);
  }
  return slots[tileSlot];
}

export function readTileArt(rom, profile, artIndex) {
  const start = profile.art_addr + artIndex * 32;
  const end = start + 32;
  if (start < profile.art_addr || end > profile.art_addr + profile.art_size) {
    throw new Error(`tile de arte ${artIndex} fora da regiao Art_Sonic`);
  }
  return rom.subarray(start, end);
}
