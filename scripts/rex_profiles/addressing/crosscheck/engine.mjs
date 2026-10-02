// Cross-check engine (validacion externa da rodada REX-A, 2026-09-25).
//
// Que é isto: un SEGUNDO executador das mesmas especifics, construido por un
// camiño de derivacion DIFERENTE ao de cada perfil:
//   - Os perfis son formulas fechadas (if-cadeas con aritmetica de mascaras).
//   - Este motor e un matcher xenerico de ventas declarativas: as ventas ROM
//     SNES parsean-se mecanicamente do boards.bml CRUDO de
//     bsnes@7d5aa1e (procedencia en windows-generated.json) e compoñense coas
//     primitivas formais reduce/mirror documentadas en
//     bsnes memory.cpp:63-65 + memory-inline.hpp:1-25 (mesmos commits que as
//     specs). Un erro de transcricion na formula fechada dun perfil NON pode
//     reproducirse aqui salvo que tamén estea errado o parser/táboa.
//   - As rexionas internas (wram/sram/io/espellos, MD) veñen de táboas
//     declarativas transcritas coas citas de liña de snes9x/GPGX/SGDK xa
//     dublemente verificadas: terceira representacion dos mesmos feitos.
//   - SSF2: simulacion literal do modelo de tabla de paginas de GPGX
//     (mapper_512k_w/mapper_ssf2_w, gpgx_md_cart.c:1268-1330 no dump fixado):
//     64 entradas de 64KB reescritas por escritas de rexistrador — structura
//     totalmente distinta da aritmetica de xanelas do perfil.
// Ningunha liña copiada: bsnes GPL-3.0, snes9x licenza no comercial, GPGX
// licenza estilo MAME — todo usado só como especificacion.

export const BUS_LIMIT = 0xffffff;

// ---------------------------------------------------------------- primitives

// reduce(A, mask) — definicion formal (memory-inline.hpp, memorizada na spec
// de hirom/exhirom): elimina os bits que valen 1 en mask e COMPACTA os bits
// superiores cara abaixo. Ex.: mask=0x8000 borra o bit 15 e o banco despraza
// un bit á dereita; mask=0xc00000 deixa A & 0x3fffff; mask=0 devolve A.
export function reduceAddress(a, mask) {
  if (!mask) return a;
  let result = 0;
  let writeBit = 0;
  for (let bit = 0; bit <= 23; bit += 1) {
    if ((mask >> bit) & 1) continue; // bit eliminado: non avanza writeBit
    if ((a >> bit) & 1) result |= 1 << writeBit;
    writeBit += 1;
  }
  return result;
}

// mirror(x, size) — reimplementacion propia da plegada de Bus::mirror
// (memory-inline.hpp, texto fixado sha 9c6e8e34…) NO DOMINIO que este motor
// precisa, que e o unico no que bsnes a exercita con os nosos estados:
//   (a) x < size  => identidade (o bucle do texto ninquera se executa);
//   (b) size potencia de 2 => identico a x % size (plegada de mascara = mod).
// O motor só chama mirror con size potencia de 2 (rom_size; mirror(offset,
// rom_size - base) onde ExHiROM valida que rom_size-0x400000 e potencia de 2)
// ou con x < size (base 0x400000 < rom_size). Fora dese dominio lanza: na
// xeneral non-potencia con x >= size o texto fai unha plegada jerarquica que
// esta formulacion non reproduce, e prefire un fallo ruidoso a un silencio.
export function mirrorMod(x, size) {
  if (size === 0) return 0;
  if (x < size) return x;
  if ((size & (size - 1)) === 0) return x & (size - 1);
  throw new Error(`mirrorMod fora do dominio probado: x=0x${x.toString(16)} size=0x${size.toString(16)}`);
}

// Bus::map (memory.cpp:63-65): offset=reduce(A,mask); if(size){base=mirror(base,size);
// offset = base + mirror(offset, size - base);}
export function bsnesMapOffset(addr, win, romSize) {
  const reduced = reduceAddress(addr, win.mask ?? 0);
  const base = mirrorMod(win.base ?? 0, romSize);
  return base + mirrorMod(reduced, romSize - base);
}

// ------------------------------------------------------- boards.bml tables

function parseBankList(spec) {
  return spec.split(',').map((part) => {
    const [lo, hi] = part.split('-').map((p) => parseInt(p, 16));
    return [hi === undefined ? lo : lo, hi === undefined ? lo : hi];
  });
}

// Converte a liña `map address=00-3f,80-bf:8000-ffff base=0x400000 mask=0xc00000`
// nun obxecto de venta. Soporta o subconxunto necesario (address + base + mask).
export function parseMapLine(line) {
  const m = line.match(/^\s*map\s+address=([0-9a-fA-F,\-]+):([0-9a-fA-F]+)-([0-9a-fA-F]+)(?:\s+base=(0x[0-9a-fA-F]+))?(?:\s+mask=(0x[0-9a-fA-F]+))?\s*$/);
  if (!m) return null;
  return {
    banks: parseBankList(m[1]),
    a: [parseInt(m[2], 16), parseInt(m[3], 16)],
    base: m[4] ? parseInt(m[4], 16) : 0,
    mask: m[5] ? parseInt(m[5], 16) : 0,
  };
}

// Devolve as ventanas do primeiro taboleiro `board: NAME`, no primeiro bloco
// `memory type=ROM content=<CONTENT>` (Program = ROM, Save = battery RAM).
export function parseBoardWindows(bmlText, boardName, content = 'Program') {
  const lines = bmlText.split('\n');
  const windows = [];
  let collecting = false;
  let inBlock = false;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    const b = line.match(/^board:\s*(\S+)/);
    if (b) {
      if (collecting && inBlock) break; // pasamos do taboleiro buscado
      collecting = b[1] === boardName;
      inBlock = false;
      continue;
    }
    if (!collecting) continue;
    if (new RegExp(`memory\\s+type=(ROM|RAM)\\s+content=${content}\\b`).test(line)) { inBlock = true; continue; }
    if (inBlock && /^\s*memory\s/.test(line)) { inBlock = false; continue; }
    if (inBlock) {
      const w = parseMapLine(line);
      if (w) windows.push(w);
    }
  }
  return windows;
}

function bankInRanges(bank, ranges) {
  return ranges.some(([lo, hi]) => bank >= lo && bank <= hi);
}

// translate xenerico sobre unha táboa de ventas ROM + unha lista de ventas
// internas ORDENADAS (precedencia: primeira coincidencia). `romSize` e o
// `size` de bsnes (mirror por el). Nunca lanza: devolve error estruturado.
export function engineTranslate(addr, { windows, internal, romSize }) {
  if (!Number.isInteger(addr) || addr < 0) {
    return { error: { code: 'out-of-range' } };
  }
  if (addr > BUS_LIMIT) return { error: { code: 'out-of-range' } };
  const bank = (addr >> 16) & 0xff;
  const a = addr & 0xffff;
  // as internas teñen precedencia igual ao perfil (o chamante constrúi a
  // orde); buscar primeira coincidencia ROM-ventan OR windows; se non, interna
  for (const w of windows) {
    if (bankInRanges(bank, w.banks) && a >= w.a[0] && a <= w.a[1]) {
      return { region: 'rom', offset: bsnesMapOffset(addr, w, romSize) };
    }
  }
  for (const w of internal) {
    if (w.addr && !(a >= w.addr[0] && a <= w.addr[1])) continue;
    if (!bankInRanges(bank, w.banks)) continue;
    if (w.error) return { error: { code: w.error } };
    return { region: w.region, offset: w.offset ? w.offset(addr, a) : a };
  }
  return { error: { code: 'unsupported' } };
}

// ------------------------------------------------------- SSF2 page-table sim
// Modelo literal de GPGX (md_cart.c:1268-1330 do dump fixado sha
// 6991903a…): 64 paginas de 64KB, cada unha cunha base; cada escrita de
// rexistrador reescribe 8 paginas (512KB). A inicializacion linear
// (p<<19… p<<16)&mask replica md_cart.c:356-367; para comparar co PERFIL,
// o estado default (banks[w] = w) inxectase a traves do PROPIO camiño de
// escritas de GPGX (mapper_ssf2_w -> mapper_512k_w), non copiando a
// aritmetica do perfil.
export function ssf2Engine(romSize, banks = {}) {
  const mask = romSize - 1;
  const pages = new Array(64);
  for (let p = 0; p < 64; p += 1) pages[p] = (p << 16) & mask; // init GPGX linear
  const nonRom = (addr) => {
    // as mesmas rexionas internas que o perfil, en forma de datos
    if (addr >= 0xa00000 && addr <= 0xa0ffff) {
      const sub = (addr >> 13) & 3;
      if (sub === 0 || sub === 1) return { region: 'z80-ram', offset: addr & 0x1fff };
      return { error: { code: 'unsupported' } };
    }
    if (addr >= 0xa10000 && addr <= 0xa1ffff) {
      if (addr >= 0xa13000 && addr <= 0xa130ff) return { region: 'cart-io', offset: addr - 0xa13000 };
      return { region: 'io', offset: addr - 0xa10000 };
    }
    if (addr >= 0xe00000) return { region: 'work-ram', offset: addr & 0xffff };
    return { error: { code: 'unsupported' } };
  };
  const engine = {
    writeRegister(addr, data) {
      // GPGX chama a mapper_ssf2_w co enderezo completo do bus; so a pagina
      // TIME chega aqui (mem68k.c case 0x30) — igual que o perfil.
      if (addr < 0xa13000 || addr > 0xa130ff) return; // fora: sen efecto neste modelo
      if ((addr & 0x0e) === 0) return; // bank 0 inamovible (mapper_ssf2_w: if (address & 0x0E))
      const slot = ((addr << 2) & 0x38) >> 3; // indice de xanela 0..7 (mapper_512k_w)
      const src = (data << 19) & mask; // base = (data << 19) & cart.mask
      for (let i = 0; i < 8; i += 1) pages[(slot << 3) + i] = (src + (i << 16)) & mask;
    },
    translate(addr) {
      if (!Number.isInteger(addr) || addr < 0 || addr > BUS_LIMIT) return { error: { code: 'out-of-range' } };
      if (addr <= 0x3fffff) {
        return { region: 'rom', offset: pages[addr >> 16] + (addr & 0xffff) };
      }
      return nonRom(addr);
    },
  };
  // estado inicial do PERFIL: xanela 0 = linear (mesmo que init GPGX para as
  // paginas 0..7 con mask>=0x7ffff); xanelas 1..7 = banks[w] ?? w, aplicadas
  // escrita a traves escrita polo camiño GPGX.
  for (let w = 1; w <= 7; w += 1) {
    const data = banks[w] ?? banks[String(w)] ?? w;
    engine.writeRegister(0xa13000 | (w << 1), data); // slot w <=> addr & 0x0E == w<<1
  }
  return engine;
}

// --------------------------------------------------------------- fuzz helper
// LCG deterministicamente sementeado (dx18002-like): a mesma semente produce
// sempre a mesma secuencia en calquera plataforma (enteros de 32 bits exatos).
export function makeRng(seed) {
  let s = seed >>> 0;
  return function next(maxExclusive) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s % maxExclusive;
  };
}
