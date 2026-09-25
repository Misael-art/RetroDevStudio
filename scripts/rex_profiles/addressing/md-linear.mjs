// Perfil de enderecamento md-linear (REX rodada 2026-09-24).
// Reimplementacao independente a partir da especificacao documentada em
// docs/rex_profiles/addressing/md-linear.md, derivada de
// Genesis-Plus-GX@939ce4f045f981f89965f24780cef045cc5e52d7 (sem copia de codigo;
// licenca da fonte nao permite transplantar).
//
// Contrato (CONTRACTS.md secao 3): funcoes puras; erros estruturados, nunca
// offset 0; sem panic; validar antes de alocar; sem estado global.

export const PROFILE_ID = 'md-linear';
export const BUS_LIMIT = 0xffffff; // barramento 24 bits do 68000
export const CART_WINDOW_END = 0x3fffff;
export const MIN_ROM_SIZE = 0x10000; // 64KB
export const MAX_ROM_SIZE = 0x400000; // 4MB (acima disso exige mapper)

function err(code, detail) {
  return { error: { code, detail } };
}

function isInt(v) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

// Valida mapper_state { rom_size }. Retorna erro estruturado ou null.
export function validateState(mapperState) {
  if (mapperState === null || mapperState === undefined || typeof mapperState !== 'object' || Array.isArray(mapperState)) {
    return err('unsupported', 'mapper_state obrigatorio: { rom_size } (inteiro, potencia de 2, 64KB..4MB)');
  }
  const { rom_size: size } = mapperState;
  if (!isInt(size)) {
    return err('unsupported', 'mapper_state.rom_size deve ser inteiro >= 0');
  }
  if (size < MIN_ROM_SIZE || size > MAX_ROM_SIZE) {
    return err(
      'unsupported',
      `mapper_state.rom_size ${size} fora do intervalo [${MIN_ROM_SIZE}, ${MAX_ROM_SIZE}] (potencias de 2; acima de 4MB exige mapper como SSF2)`,
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

// translate(cpu_address, mapper_state) -> { region, offset } | { error }
export function translate(cpuAddress, mapperState) {
  if (!isInt(cpuAddress)) {
    return err('out-of-range', 'cpu_address deve ser inteiro >= 0');
  }
  if (cpuAddress > BUS_LIMIT) {
    return err('out-of-range', `endereco ${cpuAddress} excede o barramento 24 bits do 68000 (max 0x${BUS_LIMIT.toString(16)})`);
  }
  const stateErr = validateState(mapperState);
  if (stateErr) return stateErr;
  const mask = mapperState.rom_size - 1;

  if (cpuAddress <= CART_WINDOW_END) {
    // Cartucho: espelho por mascara (md_cart.c:350,356-367).
    return { region: 'rom', offset: cpuAddress & mask };
  }
  if (cpuAddress >= 0xa00000 && cpuAddress <= 0xa0ffff) {
    // Bus do Z80 via I/O chip (mem68k.c:141-167): bits 13-14 do endereco.
    const sub = (cpuAddress >> 13) & 3;
    if (sub === 0 || sub === 1) {
      return { region: 'z80-ram', offset: cpuAddress & 0x1fff };
    }
    return err(
      'unsupported',
      `sound bus do Z80 (${sub === 2 ? 'YM2612' : 'misc/VDP via bus do Z80'}) fora do escopo v1`,
    );
  }
  if (cpuAddress >= 0xa10000 && cpuAddress <= 0xa1ffff) {
    if (cpuAddress >= 0xa13000 && cpuAddress <= 0xa130ff) {
      // TIME (mem68k.c:967-970): no perfil linear escritas nao têm efeito.
      return { region: 'cart-io', offset: cpuAddress - 0xa13000 };
    }
    return { region: 'io', offset: cpuAddress - 0xa10000 };
  }
  if (cpuAddress >= 0xe00000) {
    // Work RAM 64KB espelhada (genesis.c:100-113).
    return { region: 'work-ram', offset: cpuAddress & 0xffff };
  }
  if (cpuAddress >= 0xc00000) {
    return err('unsupported', 'portas VDP (0xC00000-0xDFFFFF) fora do escopo v1');
  }
  return err('unsupported', 'janela sem dispositivo mapeado no perfil md-linear (open bus / reservado / lockup)');
}

// invert(rom_offset, mapper_state) -> { aliases: [cpuAddress...] } | { error }
// Retorna TODOS os aliases do offset dentro da janela do cartucho.
export function invert(romOffset, mapperState) {
  const stateErr = validateState(mapperState);
  if (stateErr) return stateErr;
  if (!isInt(romOffset)) {
    return err('out-of-range', 'rom_offset deve ser inteiro >= 0');
  }
  const { rom_size: size } = mapperState;
  if (romOffset >= size) {
    // Offset inexistente: lista vazia e resposta valida (contrato secao 3).
    return { aliases: [] };
  }
  const aliases = [];
  for (let addr = romOffset; addr <= CART_WINDOW_END; addr += size) {
    aliases.push(addr);
  }
  return { aliases };
}

// read(cpu_address, length, mapper_state, rom)
// -> { segments: [{region, offset, bytes} | {region, offset, error} | {error}] } | { error }
// Segmentos de regiao sem backing ROM carregam region/offset + error unsupported;
// trechos de janela nao suportada carregam apenas error.
export function read(cpuAddress, length, mapperState, rom) {
  if (!isInt(cpuAddress)) {
    return err('out-of-range', 'cpu_address deve ser inteiro >= 0');
  }
  if (!isInt(length) || length < 1) {
    return err('out-of-range', 'length deve ser inteiro >= 1');
  }
  if (cpuAddress > BUS_LIMIT) {
    return err('out-of-range', `endereco ${cpuAddress} excede o barramento 24 bits do 68000`);
  }
  const stateErr = validateState(mapperState);
  if (stateErr) return stateErr;
  if (!(rom instanceof Uint8Array)) {
    return err('unsupported', 'rom deve ser Uint8Array (dispositivo de backing)');
  }

  const segments = [];
  let cursor = cpuAddress;
  const end = cpuAddress + length; // exclusive
  while (cursor < end) {
    const remaining = end - cursor;
    const t = translate(cursor, mapperState);
    if (t.error) {
      segments.push({ error: t.error });
      break;
    }
    const { region, offset } = t;
    if (region !== 'rom') {
      // Regiao conhecida, mas sem backing ROM no perfil: um unico segmento
      // classificatorio ate o fim da regiao contigua.
      segments.push({
        region,
        offset,
        error: { code: 'unsupported', detail: `regiao ${region} sem backing ROM no perfil ${PROFILE_ID}` },
      });
      break;
    }
    // Determina quantos bytes consecutivos permanecem no mesmo offset linear
    // (sem cruzar espelho da janela do cartucho nem o fim da ROM).
    const mirrorStride = mapperState.rom_size;
    const bytesLeftInMirror = mirrorStride - (offset % mirrorStride);
    const windowLeft = CART_WINDOW_END - cursor + 1;
    const run = Math.min(remaining, bytesLeftInMirror, windowLeft);
    if (cursor + run - 1 > BUS_LIMIT) {
      // Trecho que ultrapassa o barramento: out-of-range explicito, sem clamp.
      const valid = BUS_LIMIT - cursor + 1;
      if (valid > 0 && offset + valid <= rom.length) {
        segments.push({ region, offset, bytes: rom.slice(offset, offset + valid) });
      }
      segments.push(err('out-of-range', 'leitura ultrapassa o barramento 24 bits'));
      break;
    }
    if (offset + run > rom.length) {
      // ROM menor que rom_size declarado: trecho faltante e out-of-range.
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
