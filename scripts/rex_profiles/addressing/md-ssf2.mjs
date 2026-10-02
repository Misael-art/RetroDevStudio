// Perfil de enderecamento md-ssf2 (REX rodada 2026-09-24).
// Mapper de Super Street Fighter 2 documentado por Bart Trzynadlowski
// (emu-docs.org/Genesis/ssf2.txt, Wayback 20191212014333) e descrito em
// Genesis-Plus-GX@939ce4f045f981f89965f24780cef045cc5e52d7
// (core/cart_hw/md_cart.c: mapper_512k_w, mapper_ssf2_w) como especificacao;
// reimplementacao independente a partir de docs/rex_profiles/addressing/md-ssf2.md
// (licenca da fonte nao permite transplantar codigo).
//
// Contrato (CONTRACTS.md secao 3): funcoes puras; erros estruturados, nunca
// offset 0; sem panic; validar antes de alocar; mapper_state faz parte da
// identidade da observacao; nenhuma entrada muta.

import {
  BUS_LIMIT,
  CART_WINDOW_END,
} from './md-linear.mjs';

export const PROFILE_ID = 'md-ssf2';
export const WINDOW_SIZE = 0x80000; // 512KB por janela
export const MIN_ROM_SIZE = 0x80000; // uma janela
export const MAX_ROM_SIZE = 0x800000; // 8MB (dump real de 5MB normalizado a potencia de 2)
export const REGISTER_PAGE_START = 0xa13000; // pagina TIME roteada ao cartucho
export const REGISTER_PAGE_END = 0xa130ff;

function err(code, detail) {
  return { error: { code, detail } };
}

function isInt(v) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

// Valida mapper_state { rom_size, banks? }. banks: janela 1..7 -> inteiro >= 0.
export function validateState(mapperState) {
  if (mapperState === null || mapperState === undefined || typeof mapperState !== 'object' || Array.isArray(mapperState)) {
    return err('unsupported', 'mapper_state obrigatorio: { rom_size (potencia de 2, 512KB..8MB), banks? }');
  }
  const { rom_size: size, banks } = mapperState;
  if (!isInt(size)) {
    return err('unsupported', 'mapper_state.rom_size deve ser inteiro >= 0');
  }
  if (size < MIN_ROM_SIZE || size > MAX_ROM_SIZE) {
    return err('unsupported', `mapper_state.rom_size ${size} fora do intervalo [${MIN_ROM_SIZE}, ${MAX_ROM_SIZE}] do mapper SSF2`);
  }
  if ((size & (size - 1)) !== 0) {
    return err('unsupported', `mapper_state.rom_size ${size} nao e potencia de 2: normalize (pad 0xFF) e registre na evidencia`);
  }
  if (banks !== undefined) {
    if (banks === null || typeof banks !== 'object' || Array.isArray(banks)) {
      return err('unsupported', 'mapper_state.banks deve ser objeto janela->valor');
    }
    for (const [key, value] of Object.entries(banks)) {
      const w = Number(key);
      if (!Number.isInteger(w) || w < 1 || w > 7) {
        return err('unsupported', `mapper_state.banks: janela '${key}' invalida (apenas 1..7 sao remapeaveis; janela 0 e fixa)`);
      }
      if (!isInt(value)) {
        return err('unsupported', `mapper_state.banks[${w}] deve ser inteiro >= 0, recebido ${JSON.stringify(value)}`);
      }
    }
  }
  return null;
}

// Base efetiva da janela i (1..7): valor escrito ou identidade; mascarado
// como em mapper_512k_w: base = (data << 19) & cart.mask.
function windowBase(window, mapperState) {
  const mask = mapperState.rom_size - 1;
  const raw = (mapperState.banks && mapperState.banks[window] !== undefined)
    ? mapperState.banks[window]
    : window;
  return (raw << 19) & mask;
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
    const window = (cpuAddress / WINDOW_SIZE) | 0; // 0..7
    if (window === 0) {
      return { region: 'rom', offset: cpuAddress & mask };
    }
    return { region: 'rom', offset: windowBase(window, mapperState) + (cpuAddress & 0x7ffff) };
  }
  if (cpuAddress >= 0xa00000 && cpuAddress <= 0xa0ffff) {
    const sub = (cpuAddress >> 13) & 3;
    if (sub === 0 || sub === 1) {
      return { region: 'z80-ram', offset: cpuAddress & 0x1fff };
    }
    return err('unsupported', `sound bus do Z80 (${sub === 2 ? 'YM2612' : 'misc/VDP via bus do Z80'}) fora do escopo v1`);
  }
  if (cpuAddress >= 0xa10000 && cpuAddress <= 0xa1ffff) {
    if (cpuAddress >= REGISTER_PAGE_START && cpuAddress <= REGISTER_PAGE_END) {
      return { region: 'cart-io', offset: cpuAddress - REGISTER_PAGE_START };
    }
    return { region: 'io', offset: cpuAddress - 0xa10000 };
  }
  if (cpuAddress >= 0xe00000) {
    return { region: 'work-ram', offset: cpuAddress & 0xffff };
  }
  if (cpuAddress >= 0xc00000) {
    return err('unsupported', 'portas VDP (0xC00000-0xDFFFFF) fora do escopo v1');
  }
  return err('unsupported', 'janela sem dispositivo mapeado no perfil md-ssf2 (open bus / reservado / lockup)');
}

// writeMapperRegister(cpu_address, data, mapper_state) -> { state } | { error }
// Funcao pura: nunca muta o estado recebido; retorna estado novo. Decodificacao
// espelhada identica a GPGX: w = (addr & 0x0E) >> 1 (equivalente a
// (addr << 2) & 0x38 em unidades de 512K); w == 0 nao tem efeito (banco 0 fixo).
export function writeMapperRegister(cpuAddress, data, mapperState) {
  const stateErr = validateState(mapperState);
  if (stateErr) return stateErr;
  if (!isInt(cpuAddress) || cpuAddress > BUS_LIMIT) {
    return err('out-of-range', 'cpu_address deve ser inteiro dentro do barramento 24 bits');
  }
  if (!isInt(data) || data > 0xff) {
    return err('out-of-range', 'data deve ser um byte (inteiro 0..255)');
  }
  if (cpuAddress < REGISTER_PAGE_START || cpuAddress > REGISTER_PAGE_END) {
    return err('unsupported', `escrita em 0x${cpuAddress.toString(16)} nao pertence a pagina de registradores SSF2 (0xA13000-0xA130FF)`);
  }
  const window = (cpuAddress & 0x0e) >> 1;
  if (window === 0) {
    return { state: { rom_size: mapperState.rom_size, banks: { ...(mapperState.banks ?? {}) } } };
  }
  return {
    state: {
      rom_size: mapperState.rom_size,
      banks: { ...(mapperState.banks ?? {}), [window]: data },
    },
  };
}

// invert(rom_offset, mapper_state) -> { aliases } | { error }
// Todos os aliases no ESTADO dado; janelas com a mesma base produzem aliases
// distintos; lista vazia e resposta valida.
export function invert(romOffset, mapperState) {
  const stateErr = validateState(mapperState);
  if (stateErr) return stateErr;
  if (!isInt(romOffset)) {
    return err('out-of-range', 'rom_offset deve ser inteiro >= 0');
  }
  if (romOffset >= mapperState.rom_size) {
    return { aliases: [] };
  }
  const aliases = [];
  for (let w = 0; w < 8; w += 1) {
    const base = w === 0 ? 0 : windowBase(w, mapperState);
    if (romOffset >= base && romOffset <= base + 0x7ffff) {
      aliases.push(w * WINDOW_SIZE + (romOffset - base));
    }
  }
  aliases.sort((a, b) => a - b);
  return { aliases };
}

// read(cpu_address, length, mapper_state, rom) -> { segments } | { error }
// Cada janela do cartucho e um segmento proprio (mesmo quando as bases sao
// contiguas no estado identidade); regiao sem backing ROM vira segmento
// classificatorio; ROM menor que rom_size -> out-of-range no trecho faltante.
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
      segments.push({
        region,
        offset,
        error: { code: 'unsupported', detail: `regiao ${region} sem backing ROM no perfil ${PROFILE_ID}` },
      });
      break;
    }
    // Um segmento por janela: para no limite da janela atual (0x80000).
    const window = (cursor / WINDOW_SIZE) | 0;
    const windowLeft = (window + 1) * WINDOW_SIZE - cursor;
    const run = Math.min(remaining, windowLeft);
    if (offset + run > rom.length) {
      const available = rom.length - offset;
      if (available > 0) {
        segments.push({ region, offset, bytes: rom.slice(offset, rom.length) });
      }
      segments.push(
        err('out-of-range', `ROM (${rom.length} bytes) menor que rom_size declarado (${mapperState.rom_size}); trecho faltante a partir do offset 0x${(offset + Math.max(available, 0)).toString(16)}`),
      );
      break;
    }
    segments.push({ region, offset, bytes: rom.slice(offset, offset + run) });
    cursor += run;
  }
  return { segments };
}
