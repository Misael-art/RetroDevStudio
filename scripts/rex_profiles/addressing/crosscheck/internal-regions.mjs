// Taboas de rexións INTERNAS (non-ROM) para o cross-check (REX-A 2026-09-25).
//
// Terceira representación dos mesmos feitos documentais: os perfis codifican
// estas rexións como if-cadeas fechadas derivadas das specs; aquí van como
// DATOS declarativos coa cita de orixe (snes9x@1bcc369e memmap.cpp, GPGX@939ce4f
// m68k/md_cart, bsnes@7d5aa1e boards.bml). O offset resólvese con funciones
// mínimas transcritas da descrición, non do perfil.
//
// Formato de fila: { banks:[[lo,hi],…], addr?:[lo,hi] (range dentro do banco),
//                    region, offset(addr,a) } ou { …, error } para filas de
// erro. engineTranslate probe ROM-window -> filas internas -> unsupported.

// ---------------------------------------------------------------- SNES core
// WRAM 7E/7F (snes9x map_WRAM; bsnes core, non board). Offset = a (64KB por
// banco, 128KB contiguos).
const wramRow = { banks: [[0x7e, 0x7f]], region: 'wram', offset: (addr, a) => a, cite: 'snes9x memmap.cpp map_WRAM' };

// Espello WRAM 8KB + rexistradores I/O nos bancos baixos (convenção bsnes
// 00-3D/80-BD; snes9x map_System estende a 3F/BF — diverxencia documentada
// nos perfis, resolta como no perfil pinado).
const mirrorRow = { banks: [[0x00, 0x3d], [0x80, 0xbd]], addr: [0x0000, 0x1fff], region: 'wram-mirror', offset: (addr, a) => a & 0x1fff, cite: 'snes9x map_System / bsnes LOROM-RAM-HDR windows' };
const ioRow = { banks: [[0x00, 0x3d], [0x80, 0xbd]], addr: [0x2000, 0x7fff], region: 'io', offset: (addr, a) => a, cite: 'snes9x map_System ($2100 PPU, $2140 SMP…)' };

export const SNES_LOROM_INTERNAL = [
  wramRow,
  // SRAM: bsnes LOROM-RAM `map address=70-7d,f0-ff:0000-7fff`; offset a&0x7fff
  // (xanela de 32K; a batería real é menor — o dispositivo non e en xogo).
  { banks: [[0x70, 0x7d], [0xf0, 0xff]], addr: [0x0000, 0x7fff], region: 'sram', offset: (addr, a) => a & 0x7fff, cite: 'bsnes boards.bml LOROM-RAM Save window' },
  mirrorRow,
  ioRow,
  // A15 desconectado: metade baixa de 40-7D/C0-FF — snes9x (Map_LoROMMap)
  // mapea ROM, bsnes deixa open bus; o perfil pinado devolve ambiguous.
  { banks: [[0x40, 0x7d], [0xc0, 0xff]], addr: [0x0000, 0x7fff], error: 'ambiguous', cite: 'diverxencia snes9x vs bsnes, ver docs/rex_profiles/addressing/snes-lorom.md' },
  // resto (3E/3F/BE/BF baixos) => unsupported por defecto do motor.
];

export const SNES_HIROM_INTERNAL = [
  wramRow,
  // SRAM: bsnes HIROM-RAM `map address=20-3f,a0-bf:6000-7fff mask=0xe000`
  // -> xanela de 2KB (tamén extraída mecanicamente en windows-generated.json).
  { banks: [[0x20, 0x3f], [0xa0, 0xbf]], addr: [0x6000, 0x7fff], region: 'sram', offset: (addr, a) => a & 0x1fff, cite: 'bsnes boards.bml HIROM-RAM Save mask=0xe000; snes9x map_HiROMSRAM' },
  mirrorRow,
  ioRow,
];

export const SNES_EXHIROM_INTERNAL = [
  wramRow,
  { banks: [[0x20, 0x3f], [0xa0, 0xbf]], addr: [0x6000, 0x7fff], region: 'sram', offset: (addr, a) => a & 0x1fff, cite: 'bsnes boards.bml EXHIROM-RAM Save mask=0xe000' },
  mirrorRow,
  ioRow,
];

// ------------------------------------------------------------------ Mega Drive
// Xanela de cartucho MD como pseudo-ventoia bsnes (sen mask/base => mirror
// lineal do enderezo contra rom_size == `addr & mask` do perfil por
// potencias de 2). Vía mirrorMod, código distinto do perfil.
export const MD_CART_WINDOW = { banks: [[0x00, 0x3f]], a: [0x0000, 0xffff], base: 0, mask: 0, cite: 'GPGX md_cart.c:350,356-367 (mapa linear do cartucho)' };

// Bus do Z80 via I/O chip (GPGX mem68k.c:141-167): sub = (addr>>13)&3.
const z80Ranges = [[0x0000, 0x3fff], [0x8000, 0xbfff]]; // sub 0/1 e 0/1 no segundo espello
const z80ErrorRanges = [[0x4000, 0x7fff], [0xc000, 0xffff]]; // sub 2/3 = YM2612 / misc
export const MD_INTERNAL = [
  ...z80Ranges.map(([lo, hi]) => ({ banks: [[0xa0, 0xa0]], addr: [lo, hi], region: 'z80-ram', offset: (addr) => addr & 0x1fff, cite: 'GPGX mem68k.c:141-167' })),
  ...z80ErrorRanges.map(([lo, hi]) => ({ banks: [[0xa0, 0xa0]], addr: [lo, hi], error: 'unsupported', cite: 'sound bus YM2612/misc fora do escopo v1' })),
  { banks: [[0xa1, 0xa1]], addr: [0x3000, 0x30ff], region: 'cart-io', offset: (addr) => addr - 0xa13000, cite: 'GPGX mem68k.c:967-970 (paxina TIME)' },
  { banks: [[0xa1, 0xa1]], addr: [0x0000, 0xffff], region: 'io', offset: (addr) => addr - 0xa10000, cite: 'GPGX mem68k.c I/O chip' },
  { banks: [[0xe0, 0xff]], region: 'work-ram', offset: (addr, a) => a, cite: 'GPGX genesis.c:100-113 (68K RAM espellada)' },
  // 0xC00000-0xDFFFFF (VDP) e o resto: unsupported por defecto do motor.
];
