// Perfil REX Sonic 1 (USA, Europe) — cada endereco foi confirmado contra a ROM local
// (nao contra build doador) e cruzado com s1disasm fixado 064e3c68eb19cc85b8801b087f9d95f9b3e82cea.
// Proveniencia completa em docs/rex_corpus_d/PROFILE-S1-SPRITES.md.
export const SONIC1_US_EU = {
  id: "sonic1-us-eu",
  rom: {
    filename: "Sonic the Hedgehog (USA, Europe).bin",
    sha256: "c7da53a10c317f882f5bba93af31c3972fc1ded18d8507d4f3d5a06190c81ebb",
    size: 531577,
  },
  search_paths: [
    "/home/misael/emulation/roms/genesis",
    "/home/misael/emulation/roms/megadrive",
  ],
  map_table: 0x211e2,
  map_frames: 88,
  map_format: "sonic-v1-5byte", // SonicMappingsVer=1
  dplc_table: 0x217fe,
  dplc_frames: 88,
  dplc_format: "sonic-v1", // SonicDplcVer=1: word = ((tiles-1)<<12)|artIndex
  art_addr: 0x21afe,
  art_size: 0xa120,
  art_layout: "md-4bpp-chunky-highnibble-first",
  pal_addr: 0x2388,
  pal_lines: 1, // Pal_Sonic = 1 linha de 16 cores (0x20 bytes)
  anim_table: 0x13b48,
  anim_count: 31,
  // consumidores estaticos localizados por padrao de bytes 68k (prova de uso, nao de runtime)
  consumers: {
    sonic_animate: 0x139c4,
    dplc_lea: 0x13c4e,
    art_lea: 0x13c7a,
    ani_run_lea: 0x13a9c,
    ani_walk_lea: 0x13aa8,
    map_set_sites: [0x4f8a, 0x4ffe, 0x12c0e, 0x1b9ba, 0x1d0fa, 0x1d132],
    pal_index_entry: 0x2180,
  },
};

// frames por ID (fr_* de _anim/Sonic.asm) usados na prova estatica
export const FR = {
  Stand: 1,
  Wait1: 2,
  LookUp: 5,
  Walk11: 6,
  Walk13: 8,
  Run11: 0x1e,
};
