// Perfil de enderecamento snes-hirom (REX rodada 2026-09-25).
// Reimplementacao independente a partir da especificacao em
// docs/rex_profiles/addressing/snes-hirom.md, derivada de
// bsnes@7d5aa1e656b9171524d01b1b22917197d8121cb4 boards.bml (HIROM/HIROM-RAM)
// e snes9x@1bcc369e89f08243e0a462882fb1f3e42e51de3a memmap.cpp
// (map_hirom:2521-2534, Map_HiROMMap:3101-3119). Nenhuma linha copiada:
// GPL-3.0 e Snes9x License restringem transplantar codigo.
//
// Contrato (CONTRACTS.md secao 3): funcoes puras; erros estruturados, nunca
// offset 0; divergencia de fontes => ambiguous (sem casos em HiROM padrao).

export const PROFILE_ID = 'snes-hirom';
export const BUS_LIMIT = 0xffffff; // barramento 24 bits do 65816
export const MIN_ROM_SIZE = 0x10000; // um banco completo de 64KB
export const MAX_ROM_SIZE = 0x400000; // 4MB: alcance de uma area HiROM (8MB e ExHiROM)

function err(code, detail) {
  return { error: { code, detail } };
}

function isInt(v) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

// HiROM nao tem registradores de mapper: apenas rom_size (mascara de espelho).
export function validateState(mapperState) {
  if (mapperState === null || mapperState === undefined || typeof mapperState !== 'object' || Array.isArray(mapperState)) {
    return err('unsupported', 'mapper_state obrigatorio: { rom_size } (inteiro, potencia de 2, 64KB..4MB)');
  }
  const extra = Object.keys(mapperState).filter((k) => k !== 'rom_size');
  if (extra.length > 0) {
    return err('unsupported', `mapper_state com chaves estranhas ao HiROM: ${extra.join(', ')} (perfil sem estado de mapper)`);
  }
  const { rom_size: size } = mapperState;
  if (!isInt(size)) {
    return err('unsupported', 'mapper_state.rom_size deve ser inteiro >= 0');
  }
  if (size < MIN_ROM_SIZE || size > MAX_ROM_SIZE) {
    return err(
      'unsupported',
      `mapper_state.rom_size ${size} fora do intervalo [${MIN_ROM_SIZE}, ${MAX_ROM_SIZE}] (potencias de 2; 8MB exige perfil ExHiROM)`,
    );
  }
  if ((size & (size - 1)) !== 0) {
    return err(
      'unsupported',
      `mapper_state.rom_size ${size} nao e potencia de 2: normalize o arquivo (pad 0xFF ate a proxima potencia de 2) e registre a normalizacao na evidencia`,
    );
  }
  return null;
}

// Classes de banco (bsnes HIROM: `00-3f,80-bf:8000-ffff` + `40-7d,c0-ff:0000-ffff`)
function isHalfBank(b) {
  return b <= 0x3f || (b >= 0x80 && b <= 0xbf); // so metade alta e ROM
}
function isFullBank(b) {
  return (b >= 0x40 && b <= 0x7d) || b >= 0xc0; // banco inteiro ROM (7E/7F sao WRAM)
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
  const mask = mapperState.rom_size - 1;
  const bank = (cpuAddress >> 16) & 0xff;
  const a = cpuAddress & 0xffff;

  // WRAM: bancos 7E/7F inteiros, 128KB contiguos (snes9x map_WRAM).
  if (bank >= 0x7e && bank <= 0x7f) {
    return { region: 'wram', offset: a };
  }
  // ROM linear: offset = (banco<<16 | a) mascarado (map_hirom addr = c << 16).
  if ((isHalfBank(bank) && a >= 0x8000) || isFullBank(bank)) {
    return { region: 'rom', offset: ((bank << 16) + a) & mask };
  }
  // SRAM: 20-3F/A0-BF em $6000-$7FFF, janela de 2KB (bsnes mask=0xe000;
  // snes9x map_HiROMSRAM). Ganha do I-O na mesma faixa.
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
// Todos os aliases: bancos de metade alta capturam so rel < 0x8000; bancos
// completos capturam rel < 0x10000; 7E/7F nunca sao aliases (WRAM).
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
  const mask = size - 1;
  const aliases = [];
  for (let b = 0; b <= 0xff; b += 1) {
    const start = (b << 16) & mask;
    if (isHalfBank(b)) {
      const rel = (romOffset - start) & mask;
      if (rel < 0x8000) aliases.push((b << 16) + 0x8000 + rel);
    }
    if (isFullBank(b)) {
      const rel = (romOffset - start) & mask;
      if (rel < 0x10000) aliases.push((b << 16) + rel);
    }
  }
  aliases.sort((x, y) => x - y);
  return { aliases };
}

// Quantos bytes ainda ficam na MESMA janela ROM contigua a partir de cursor
// (bancos completos emendam no proximo banco; metade alta para no fim do
// banco; grupo 40-7D para em 7E; grupo C0-FF para no fim do barramento).
function romWindowLeft(cursor) {
  const bank = (cursor >> 16) & 0xff;
  const a = cursor & 0xffff;
  if (isHalfBank(bank)) return 0x10000 - a;
  if (bank >= 0x40 && bank <= 0x7d) return 0x7e0000 - cursor;
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
    const remaining = end - cursor;
    const bytesLeftInMirror = mapperState.rom_size - offset; // offset ja esta mascarado
    const run = Math.min(remaining, romWindowLeft(cursor), bytesLeftInMirror);
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
