// Perfil de endereçamento snes-exhirom (REX rodada 2026-09-25).
// Reimplementacao independente a partir da especificacao em
// docs/rex_profiles/addressing/snes-exhirom.md, derivada de
// bsnes@7d5aa1e656b9171524d01b1b22917197d8121cb4 (boards.bml EXHIROM/
// EXHIROM-RAM, sfc/cartridge/load.cpp loadMap, sfc/memory Bus::map,
// mirror/reduce) e snes9x@1bcc369e89f08243e0a462882fb1f3e42e51de3a
// (Map_ExtendedHiROMMap, map_hirom_offset, map_mirror). Nenhuma linha
// copiada: GPL-3.0 e Snes9x License restringem transplantar codigo.
//
// Contrato (CONTRACTS.md secao 3): funcoes puras; erros estruturados,
// nunca offset 0; sem panic; validar antes de alocar; sem estado global.

export const PROFILE_ID = 'snes-exhirom';
export const BUS_LIMIT = 0xffffff; // barramento 24 bits do 65816
export const AREA2_BASE = 0x400000; // segunda area comeca no offset 4MB
export const MIN_ROM_SIZE = 0x500000; // 5MB: menor rom_size com half2 >= 1 banco
export const MAX_ROM_SIZE = 0x800000; // 8MB: duas areas de 4MB cabem no barramento
export const MIN_AREA2_SIZE = 0x10000; // half2 minimo: um banco de 64KB

function err(code, detail) {
  return { error: { code, detail } };
}

function isInt(v) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

function isPow2(v) {
  return v > 0 && (v & (v - 1)) === 0;
}

const mod = (a, m) => ((a % m) + m) % m;

// ExHiROM nao tem registradores de mapper: apenas rom_size.
export function validateState(mapperState) {
  if (mapperState === null || mapperState === undefined || typeof mapperState !== 'object' || Array.isArray(mapperState)) {
    return err('unsupported', 'mapper_state obrigatorio: { rom_size } (inteiro, >4MB e <=8MB, com rom_size-0x400000 potencia de 2)');
  }
  const extra = Object.keys(mapperState).filter((k) => k !== 'rom_size');
  if (extra.length > 0) {
    return err('unsupported', `mapper_state com chaves estranhas ao ExHiROM: ${extra.join(', ')} (perfil sem estado de mapper)`);
  }
  const { rom_size: size } = mapperState;
  if (!isInt(size)) {
    return err('unsupported', 'mapper_state.rom_size deve ser inteiro >= 0');
  }
  if (size < MIN_ROM_SIZE || size > MAX_ROM_SIZE) {
    return err(
      'unsupported',
      `mapper_state.rom_size ${size} fora do intervalo (${AREA2_BASE}, ${MAX_ROM_SIZE}] para ExHiROM; <=4MB e perfil snes-hirom, >8MB nao e enderecavel no barramento de 24 bits`,
    );
  }
  if (!isPow2(size - AREA2_BASE)) {
    return err(
      'unsupported',
      `segunda area de ExHiROM (rom_size - 0x${AREA2_BASE.toString(16)} = ${size - AREA2_BASE}) nao e potencia de 2: normalize o arquivo (pad 0xFF ate 5/6/8MB) e registre a normalizacao na evidencia`,
    );
  }
  return null;
}

// Classes de janela por banco (bsnes EXHIROM: 00-3f:8000-ffff,
// 40-7d:0000-ffff, 80-bf:8000-ffff, c0-ff:0000-ffff).
function windowFor(bank) {
  if (bank <= 0x3f) return { area: 2, lo: 0x8000 };
  if (bank <= 0x7d) return { area: 2, lo: 0 };
  if (bank <= 0xbf) return { area: 1, lo: 0x8000 };
  return { area: 1, lo: 0 }; // c0-ff
}
function isRomWindow(bank, a) {
  if (bank >= 0x7e && bank <= 0x7f) return false; // WRAM vence
  const w = windowFor(bank);
  return a >= w.lo && (w.lo === 0 || a >= 0x8000);
}

// translate(cpu_address, mapper_state) -> { region, offset } | { error }
export function translate(cpuAddress, mapperState) {
  if (!isInt(cpuAddress)) {
    return err('out-of-range', 'cpu_address deve ser inteiro >= 0');
  }
  if (cpuAddress > BUS_LIMIT) {
    return err('out-of-range', `endereco ${cpuAddress} excede o barramento 24 bits (max 0x${BUS_LIMIT.toString(16)})`);
  }
  const stateErr = validateState(mapperState);
  if (stateErr) return stateErr;
  const half2 = mapperState.rom_size - AREA2_BASE;
  const bank = (cpuAddress >> 16) & 0xff;
  const a = cpuAddress & 0xffff;

  // WRAM: bancos 7E/7F inteiros, 128KB contiguos.
  if (bank >= 0x7e && bank <= 0x7f) {
    return { region: 'wram', offset: a };
  }
  if (isRomWindow(bank, a)) {
    // Area 2: base 0x400000 + espelho mod half2 (bsnes
    // base+mirror(A, size-base); snes9x map_mirror(CalculatedSize-0x400000,...)).
    // Area 1: A22/A23 desconectados (bsnes mask=0xc00000; snes9x
    // map_mirror(0x400000,...)); em 24 bits equivale a A & 0x3FFFFF.
    if (windowFor(bank).area === 2) {
      return { region: 'rom', offset: AREA2_BASE + mod(cpuAddress, half2) };
    }
    return { region: 'rom', offset: cpuAddress % AREA2_BASE };
  }
  // SRAM: 20-3F/A0-BF em $6000-$7FFF, janela de 2KB (bsnes mask=0xe000).
  if (((bank >= 0x20 && bank <= 0x3f) || (bank >= 0xa0 && bank <= 0xbf)) && a >= 0x6000 && a <= 0x7fff) {
    return { region: 'sram', offset: a & 0x1fff };
  }
  // Espelho WRAM (8KB) e registradores nos bancos baixos 00-3D/80-BD
  // (convencao bsnes; snes9x estende a 3F/BF — divergencia documentada na spec).
  if (bank <= 0x3d || (bank >= 0x80 && bank <= 0xbd)) {
    if (a < 0x2000) {
      return { region: 'wram-mirror', offset: a & 0x1fff };
    }
    return { region: 'io', offset: a };
  }
  return err('unsupported', `banco 0x${bank.toString(16)} endereco $${a.toString(16)} em janela reservada (3E/3F/BE/BF baixos: sem dispositivo na fonte bsnes)`);
}

// invert(rom_offset, mapper_state) -> { aliases: [cpu_address...] } | { error }
// Alias de area 1: (banco & 0x3F) = offset>>16 e a = offset & 0xFFFF dentro da
// janela do banco. Alias de area 2: a = (offset - 0x400000 - banco*0x10000) mod
// half2, unico porque half2 >= 0x10000.
export function invert(romOffset, mapperState) {
  const stateErr = validateState(mapperState);
  if (stateErr) return stateErr;
  if (!isInt(romOffset)) {
    return err('out-of-range', 'rom_offset deve ser inteiro >= 0');
  }
  const { rom_size: size } = mapperState;
  if (romOffset >= size) {
    return { aliases: [] };
  }
  const half2 = size - AREA2_BASE;
  const aliases = [];
  for (let bank = 0; bank <= 0xff; bank += 1) {
    if (bank >= 0x7e && bank <= 0x7f) continue; // WRAM nunca e alias de ROM
    const { area, lo } = windowFor(bank);
    if (area === 1 && romOffset < AREA2_BASE) {
      if ((bank & 0x3f) !== (romOffset >> 16)) continue;
      const a = romOffset & 0xffff;
      if (a >= lo) aliases.push((bank << 16) + a);
    } else if (area === 2 && romOffset >= AREA2_BASE) {
      const a = mod(romOffset - AREA2_BASE - bank * 0x10000, half2);
      if (a >= lo && a < 0x10000) aliases.push((bank << 16) + a);
    }
  }
  aliases.sort((x, y) => x - y);
  return { aliases };
}

// Quantos bytes ainda ficam na MESMA janela ROM contigua a partir de cursor
// (metades altas param no fim do banco; grupo 40-7D param em 7E; grupo C0-FF
// no fim do barramento).
function romWindowLeft(cursor) {
  const bank = (cursor >> 16) & 0xff;
  const a = cursor & 0xffff;
  if (windowFor(bank).lo === 0x8000) return 0x10000 - a;
  if (bank <= 0x7d) return 0x7e0000 - cursor;
  return 0x1000000 - cursor;
}

// read(cpu_address, length, mapper_state, rom) -> { segments } | { error }
export function read(cpuAddress, length, mapperState, rom) {
  if (!isInt(cpuAddress)) {
    return err('out-of-range', 'cpu_address deve ser inteiro >= 0');
  }
  if (!isInt(length) || length < 1) {
    return err('out-of-range', 'length deve ser inteiro >= 1');
  }
  if (cpuAddress > BUS_LIMIT) {
    return err('out-of-range', `endereco ${cpuAddress} excede o barramento 24 bits`);
  }
  const stateErr = validateState(mapperState);
  if (stateErr) return stateErr;
  if (!(rom instanceof Uint8Array)) {
    return err('unsupported', 'rom deve ser Uint8Array (dispositivo de backing)');
  }
  if (cpuAddress + length - 1 > BUS_LIMIT) {
    return err('out-of-range', `leitura de ${length} bytes em 0x${cpuAddress.toString(16)} ultrapassa o barramento 24 bits`);
  }

  const segments = [];
  let cursor = cpuAddress;
  const end = cpuAddress + length; // exclusive
  while (cursor < end) {
    const t = translate(cursor, mapperState);
    if (t.error) {
      segments.push({ error: t.error });
      break;
    }
    const { region, offset } = t;
    if (region !== 'rom') {
      segments.push({
        region,
        offset,
        error: { code: 'unsupported', detail: `regiao ${region} sem backing ROM no perfil ${PROFILE_ID}` },
      });
      break;
    }
    // Descontinuidade propria de cada area: espelho da area 1 em 0x400000,
    // da area 2 em rom_size.
    const area = windowFor((cursor >> 16) & 0xff).area;
    const bytesToBoundary = area === 2 ? mapperState.rom_size - offset : AREA2_BASE - offset;
    const run = Math.min(end - cursor, romWindowLeft(cursor), bytesToBoundary);
    if (offset + run > rom.length) {
      const available = rom.length - offset;
      if (available > 0) {
        segments.push({ region, offset, bytes: rom.slice(offset, rom.length) });
      }
      segments.push(
        err('out-of-range', `ROM (${rom.length} bytes) menor que rom_size declarado (${mapperState.rom_size}); trecho faltante a partir do offset 0x${offset.toString(16)}`),
      );
      break;
    }
    segments.push({ region, offset, bytes: rom.slice(offset, offset + run) });
    cursor += run;
  }
  return { segments };
}
