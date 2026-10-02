# Perfil de endereçamento: SNES ExHiROM (`snes-exhirom`)

Perfil de referencia para cartuchos SNES >4MB con mapa ExHiROM (dos áreas
de 4MB: la primera `0x000000-0x3FFFFF` accesible desde bancos altos
`80-BF`/`C0-FF`; la segunda `0x400000-…` accesible desde bancos bajos
`00-3F`/`40-7D` con `base=0x400000`). Selección contextual de la ronda
REX, no una alegación de popularidad.

Fuentes primarias (fijadas por commit, consultadas como especificación;
**ninguna línea copiada**; la copia local de cada archivo fue verificada
byte a byte contra el commit fijado):

- Repositorio: https://github.com/byuu/bsnes
- Commit: `7d5aa1e656b9171524d01b1b22917197d8121cb4`
- Archivos citados:
  - `bsnes/target-bsnes/resource/system/boards.bml:706-720`, tableros
    `EXHIROM` / `EXHIROM-RAM`: ROM `00-3f:8000-ffff base=0x400000`,
    `40-7d:0000-ffff base=0x400000`, `80-bf:8000-ffff mask=0xc00000`,
    `c0-ff:0000-ffff mask=0xc00000`; Save RAM `20-3f,a0-bf:6000-7fff
    mask=0xe000`.
  - `bsnes/sfc/cartridge/load.cpp:131-139` (`loadMap`): si el mapa no
    declara `size`, `size = memory.size()` (ROM completa).
  - `bsnes/sfc/memory/memory.cpp:63-65` (`Bus::map`):
    `offset = reduce(banco<<16|a, mask); base = mirror(base, size);
    offset = base + mirror(offset, size − base)`.
  - `bsnes/sfc/memory/memory-inline.hpp:1-25`: `mirror` es módulo
    jerárquico (mod cuando `size` es potencia de 2); `reduce` arranca
    los bits marcados por `mask` (huecos de dirección) comprimendo los
    bits superiores. Para `mask=0xc00000` (A22/A23 desconectados)
    equivale a `A & 0x3FFFFF` en direcciones de 24 bits.
  - Licencia: GPL-3.0 (no autoriza transplantar código; este perfil es
    reimplementación desde la especificación).
- Repositorio: https://github.com/snes9xgit/snes9x
- Commit: `1bcc369e89f08243e0a462882fb1f3e42e51de3a`
- Archivo citado: `memmap.cpp` (raíz del repo; sha256 de la copia local
  idéntico al raw de ese commit):
  - `Map_ExtendedHiROMMap:3120-3128`:
    `map_hirom_offset(0x00,0x3f,0x8000,0xffff, CalculatedSize-0x400000, 0x400000)`,
    `map_hirom_offset(0x40,0x7f,0x0000,0xffff, CalculatedSize-0x400000, 0x400000)`,
    `map_hirom_offset(0x80,0xbf,0x8000,0xffff, 0x400000, 0)`,
    `map_hirom_offset(0xc0,0xff,0x0000,0xffff, 0x400000, 0)`.
  - `map_hirom_offset:2555-2568`: puntero por página 4KB =
    `ROM + offset + map_mirror(size, (banco − banco_inicial)<<16)`; la
    lectura suma `a` completa.
  - `map_mirror:2486-2502` (comentado "from bsnes"): módulo para tamaños
    potencia de 2.
  - Licencia: Snes9x License (no comercial). Solo consulta.
- Ambos fuentes **concuerdan** en las fórmulas unificadas de abajo (se
  verificó `reduce`/`mirror` de bsnes contra `map_mirror` de snes9x para
  los tres tamaños soportados). No hay caso `ambiguous` propio.

## Modelo de estado

```json
{ "rom_size": 8388608 }
```

- `rom_size`: obligatorio, `> 0x400000` y `≤ 0x800000` (dos áreas; más
  de 8MB no es direccionable en el barramento de 24 bits), y
  `rom_size − 0x400000` debe ser potencia de 2 (el espejo de la segunda
  área se hace módulo ese tamaño). Valores válidos: 5MB, 6MB, 8MB.
  4MB ⇒ `unsupported` (perfil `snes-hirom`); 7MB ⇒ `unsupported` con
  nota de normalización (pad 0xFF a 8MB registrada en evidencia).
- ExHiROM **no tiene registros de mapper**: claves extra en
  `mapper_state` (p. ej. `banks`) se rechazan con `unsupported`.

## Fórmula (concordante entre fuentes)

Con `A = banco<<16 | a`, `half2 = rom_size − 0x400000`:

- **Área 2** (bancos `00-3F` con `a ≥ 0x8000`; bancos `40-7D` rango
  completo): `offset = 0x400000 + (A mod half2)`.
  En bsnes: `base=mirror(0x400000, rom_size) = 0x400000` y
  `offset = 0x400000 + mirror(A, rom_size − 0x400000)`. En snes9x:
  `0x400000 + map_mirror(CalculatedSize − 0x400000, (banco − banco_s)
  <<16) + a`; ambos coinciden porque la ventana de cada banco mide
  ≤ 64KB y los bancos avanzan de a 64KB.
- **Área 1** (bancos `80-BF` con `a ≥ 0x8000`; bancos `C0-FF` rango
  completo): `offset = A mod 0x400000 = A & 0x3FFFFF` (A22/A23
  desconectados; `mask=0xc00000` de bsnes ≡ `map_mirror(0x400000, …)`
  de snes9x).

En 8MB (`half2=0x400000`) el mapa es una involución: `0x008000 →
0x408000` y `0x808000 → 0x008000`; los vectores de reset leídos en
`0x00FFD8` caen al offset `0x40FFD8` (mitad del archivo de 8MB), y sus
alias en `0x80FFD8` al offset `0xFFD8`.

## Regiones por `translate` (precedencia en orden)

| # | Condición | Región | Offset |
|---|---|---|---|
| 1 | banco `7E-7F` (completo) | `wram` | `a` (128KB contiguos) |
| 2 | banco `00-3F`/`80-BF` y `a ≥ 0x8000` | `rom` | área según banco |
| 3 | banco `40-7D` (área 2) / `C0-FF` (área 1) rango completo | `rom` | área según banco |
| 4 | banco `20-3F`/`A0-BF` y `0x6000 ≤ a ≤ 0x7FFF` | `sram` | `a & 0x1FFF` (bsnes `mask=0xe000`; snes9x `map_HiROMSRAM`) |
| 5 | banco `00-3D`/`80-BD` y `a < 0x2000` | `wram-mirror` | `a & 0x1FFF` |
| 6 | banco `00-3D`/`80-BD` y `0x2000 ≤ a < 0x8000` | `io` | `a` |
| 7 | resto (`3E/3F`/`BE/BF` bajos, `>0xFFFFFF`) | error | ver Errores |

Regiones no-ROM idénticas a `snes-hirom` (bsnes `EXHIROM-RAM` solo
añade la ventana Save; el resto es mapeo de sistema estándar). La regla
2/3 asigna el área por banco: bajos ⇒ área 2, altos ⇒ área 1.

Discordancia documentada (resuelta como en `snes-lorom`/`snes-hirom`):
snes9x `Map_ExtendedHiROMMap` usa bancos `40-7f` completos, bsnes limita
a `40-7d` (porque `7E/7F` son WRAM en la convención de ventanas de
bsnes, igual que en HiROM); snes9x `map_System` extiende espejo WRAM/I-O
a bancos bajos `00-3F`/`80-BF` completos, bsnes a `00-3D`/`80-BD`. El
perfil sigue a bsnes en ambas, sin adivinar.

## Errores estructurados

- Dirección `> 0xFFFFFF` ⇒ `out-of-range`; estado inválido o fuera del
  modelo ⇒ `unsupported`; ventanas reservadas (`3E/3F`/`BE/BF` bajos) ⇒
  `unsupported`. `ambiguous` sin casos pinados (fuentes concuerdan).

## `invert(rom_offset, mapper_state)`

Devuelve **todos** los aliases: para cada banco elegible, resolver
analíticamente la dirección dentro de su ventana cuyo offset es el
buscado:

- Área 1 (`O < 0x400000`): bancos con `(banco & 0x3F) = O >> 16`;
  alias `banco<<16 | a` con `a ≡ O (mod 0x10000)`, `a ≥ 0x8000` si el
  banco es `80-BF` (mitad alta), cualquier `a` si es `C0-FF`.
- Área 2 (`O ≥ 0x400000`, `D = O − 0x400000 < half2`): bancos `00-3F`
  (mitad alta) y `40-7D` (completo) con `a₀ = (D − banco·0x10000) mod
  half2`; es alias si `a₀` cae en la ventana del banco (≤ 0xFFFF ⇒
  único, porque `half2 ≥ 0x10000`).

Orden creciente. Lista vacía (offset más allá de `rom_size`) es
respuesta válida.

## `read(cpu_address, length, mapper_state, rom)`

Semántica de segmentos igual que `snes-hirom` (un segmento por corrida;
regiones sin respaldo ROM devuelven segmento clasificador con `error`),
con cortes adicionales:

- La corrida ROM se corta además en el borde del espejo del área:
  área 1 al offset `0x400000`, área 2 al offset `rom_size` (p. ej. en
  6MB, `0x5FFFFF → 0x400000` corta).
- Grupos de bancos contiguos: `40-7D` termina en `0x7E0000` (WRAM),
  `C0-FF` en el fin del barramento, y cada mitad alta (`00-3F`/`80-BF`)
  termina en el borde del banco (la dirección siguiente es mitad baja
  de otro dispositivo).
- ROM más corta que `rom_size` declarado ⇒ `out-of-range` en el tramo
  faltante, sin clamp.

## Detección (fuera del perfil, registrada para el inventario)

snes9x `CalculateFlags` clasifica ExHiROM por heurística de header
(tamaño calculado > 4MB y bandera HiROM con bit 7 del banco de modo
`0x21` ⇒ extended). El header no es prueba: en el inventario del corpus
esas señales son hipótesis con evidencia, nunca asignación de mapper por
extensión.

## Límites explícitos (v1)

- No modela ExHiROM de 5/6MB con áreas asimétricas no binarias, SA1/
  DSP-x/SuperFX/CX4 (oclusión de ventanas), BS-Cart, Satox, ExpRAM/
  ExpWRAM, ni DMA BWE/BWB.
- No ejecuta ni inspecciona la ROM: la referencia es el contrato
  dirección+estado ⇒ región+offset/segmentos.
