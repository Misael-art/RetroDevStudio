// Perfil de enderecamento snes-lorom (REX rodada 2026-09-25).
// Reimplementacao independente a partir da especificacao em
// docs/rex_profiles/addressing/snes-lorom.md, derivada de
// bsnes@7d5aa1e656b9171524d01b1b22917197d8121cb4 boards.bml (LOROM/LOROM-RAM)
// e snes9x@1bcc369e89f08243e0a462882fb1f3e42e51de3a memmap.cpp map_lorom.
// Nenhuma linha copiada: ambas as licengas (GPL-3.0 / Snes9x nao comercial)
// restringem transplantar codigo; este perfil e especificacao reimplementada.
//
// Contrato (CONTRACTS.md secao 3): funcoes puras; erros estruturados, nunca
// offset 0; divergencia de fontes => ambiguous, nunca palpite.

export const PROFILE_ID = 'snes-lorom';
export const BUS_LIMIT = 0xffffff; // barramento 24 bits do 65816
export const PAGE_SIZE = 0x8000; // pagina ROM de 32KB na metade alta de cada banco
export const MIN_ROM_SIZE = 0x8000; // uma pagina
export const MAX_ROM_SIZE = 0x400000; // 4MB = 128 paginas (acima disso e ExHiROM/multi-mapa)

function err(code, detail) {
  return { error: { code, detail } };
}

function isInt(v) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

// LoROM nao tem registradores de mapper: o unico estado legitimamente
// necessario e rom_size (para a mascara de espelho). Chaves extras (ex.:
// bancos) sao rejeitadas — aceita-las silently seria fingir estado inexistente.
export function validateState(mapperState) {
  if (mapperState === null || mapperState === undefined || typeof mapperState !== 'object' || Array.isArray(mapperState)) {
    return err('unsupported', 'mapper_state obrigatorio: { rom_size } (inteiro, potencia de 2, 32KB..4MB)');
  }
  const extra = Object.keys(mapperState).filter((k) => k !== 'rom_size');
  if (extra.length > 0) {
    return err('unsupported', `mapper_state com chaves estranhas ao LoROM: ${extra.join(', ')} (perfil sem estado de mapper)`);
  }
  const { rom_size: size } = mapperState;
  if (!isInt(size)) {
    return err('unsupported', 'mapper_state.rom_size deve ser inteiro >= 0');
  }
  if (size < MIN_ROM_SIZE || size > MAX_ROM_SIZE) {
    return err(
      'unsupported',
      `mapper_state.rom_size ${size} fora do intervalo [${MIN_ROM_SIZE}, ${MAX_ROM_SIZE}] (potencias de 2)`,
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

function inRange(v, lo, hi) {
  return v >= lo && v <= hi;
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

  // WRAM: bancos 7E/7F inteiros (64KB contiguos).
  if (inRange(bank, 0x7e, 0x7f)) {
    return { region: 'wram', offset: a };
  }
  // ROM: metade alta ($8000-$FFFF) dos bancos 00-7D e 80-FF
  // (bsnes LOROM `00-7d,80-ff:8000-ffff`; snes9x map_lorom (c&0x7F)*0x8000).
  if (a >= PAGE_SIZE && (bank <= 0x7d || bank >= 0x80)) {
    return { region: 'rom', offset: ((bank & 0x7f) * PAGE_SIZE + (a & 0x7fff)) & mask };
  }
  // SRAM: 70-7D, F0-FF metade baixa (bsnes LOROM-RAM `70-7d,f0-ff:0000-7fff`).
  if ((inRange(bank, 0x70, 0x7d) || inRange(bank, 0xf0, 0xff)) && a < PAGE_SIZE) {
    return { region: 'sram', offset: a & 0x7fff };
  }
  // Espelho WRAM (8KB) na metade baixa dos bancos 00-3D/80-BD.
  if ((bank <= 0x3d || inRange(bank, 0x80, 0xbd)) && a < 0x2000) {
    return { region: 'wram-mirror', offset: a & 0x1fff };
  }
  // Registradores I/O nos mesmos bancos, $2000-$7FFF.
  if (bank <= 0x3d || inRange(bank, 0x80, 0xbd)) {
    return { region: 'io', offset: a };
  }
  // Divergencia de fontes (Discordanca A na especificacao): metade baixa dos
  // bancos 40-7D/C0-FF com A15 desconectado. snes9x (Map_LoROMMap) mapeia ROM;
  // bsnes deixa janela aberta. Sem base primaria para escolher => ambiguous.
  if (inRange(bank, 0x40, 0x7d) || bank >= 0xc0) {
    return err(
      'ambiguous',
      `banco 0x${bank.toString(16)} metade baixa $${a.toString(16)}: com A15 desconectado as fontes divergem (snes9x ROM vs bsnes open bus); o cartucho real decide, o perfil nao palpita`,
    );
  }
  // Reservado/BSAT: bancos 3E/3F e BE/BF na metade baixa.
  return err('unsupported', `banco 0x${bank.toString(16)} endereco $${a.toString(16)} em janela reservada (sem dispositivo nas fontes pinadas)`);
}

// invert(rom_offset, mapper_state) -> { aliases: [cpu_address...] } | { error }
// Retorna TODOS os aliases: pagina p e sua alias A15 (banco p|0x80), mais
// qualquer pagina mascarada equivalente. Bancos 7E/7F nunca sao aliases
// (sao WRAM). Ordem crescente; lista vazia e resposta valida.
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
  for (let p = 0; p < 0x80; p += 1) {
    const candidate = (romOffset - p * PAGE_SIZE) & mask;
    if (candidate >= PAGE_SIZE) continue;
    // Banco p so vale se a metade alta dele e ROM (bancos 7E/7F inteiros sao
    // WRAM). O alias A15 p|0x80 (>= 0x80) e sempre ROM: as paginas 7E/7F so
    // sao alcancaveis pelos bancos FE/FF.
    if (p <= 0x7d) {
      aliases.push((p << 16) | (PAGE_SIZE + candidate));
    }
    aliases.push(((p | 0x80) << 16) | (PAGE_SIZE + candidate));
  }
  aliases.sort((x, y) => x - y);
  return { aliases };
}

// read(cpu_address, length, mapper_state, rom)
// -> { segments: [...] } | { error }
// Em LoROM nenhuma leitura ROM emenda em outra pagina ROM: o byte apos
// $xxxxFFFF e a metade baixa do proximo banco (WRAM/I-O/ambigua), entao
// leituras multi-pagina sempre cortam em segmentos.
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
    // Rejeitado antes de qualquer alocacao proporcional ao endereco.
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
    const bytesLeftInBankHighHalf = 0x10000 - (cursor & 0xffff);
    const bytesLeftInMirror = mapperState.rom_size - (offset % mapperState.rom_size);
    const run = Math.min(remaining, bytesLeftInBankHighHalf, bytesLeftInMirror);
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
