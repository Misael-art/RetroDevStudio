# Perfil de endereçamento: SNES HiROM (`snes-hirom`)

Perfil de referencia para cartuchos SNES con mapa HiROM (banco completo de
64KB accesible en `0x40-0x7D`/`0xC0-0xFF`, mitad alta espejada A15 en
`0x00-0x3F`/`0x80-0xBF`). Selección contextual de la ronda REX, no una
alegación de popularidad.

Fuentes primarias (fijadas por commit, consultadas como especificación;
**ninguna línea copiada**; modelos matemáticos verificados a mano contra
ambas):

- Repositorio: https://github.com/byuu/bsnes
- Commit: `7d5aa1e656b9171524d01b1b22917197d8121cb4`
- Archivo citado: `bsnes/target-bsnes/resource/system/boards.bml`, tableros
  `HIROM` / `HIROM-RAM`:
  - ROM: `00-3f,80-bf:8000-ffff` + `40-7d,c0-ff:0000-ffff` (sin base: el
    desplazamiento es la propia dirección de 24 bits; en ROMs ≤4MB el
    enmascarado produce el alias natural 80-BF≡00-3F, C0-FF≡40-7F).
  - Save RAM: `20-3f,a0-bf:6000-7fff mask=0xe000` (8KB de ventana,
    máscara de 2KB).
  - Licencia: GPL-3.0 (no autoriza transplantar código; este perfil es
    reimplementación desde la especificación).
- Repositorio: https://github.com/Snes9x/snes9x
- Commit: `1bcc369e89f08243e0a462882fb1f3e42e51de3a`
- Archivo citado: `memmap.cpp` (raíz del repo, no `src/`):
  - `map_hirom:2521-2534` — `addr = c << 16` y `Map[p] = ROM +
    map_mirror(size, addr)`: el offset es la dirección lineal de 24 bits
    (`banco<<16 | a`) espejada por tamaño de ROM. Confirma bsnes.
  - `Map_HiROMMap:3101-3119` — ventanas efectivas: `map_hirom(0x00,0x3f,
    0x8000,0xffff)`, `map_hirom(0x40,0x7f,0x0000,0xffff)` y alias 80-BF /
    C0-FF; luego `map_HiROMSRAM` (`20-3f,a0-bf:6000-7fff`, offset
    `a & 0x1FFF`), `map_WRAM` (`7E/7F` completos) y `map_System` (bajos
    `00-3F`/`80-BF`: `0000-1FFF` WRAM, `2000-5FFF` I/O).
  - Licencia: Snes9x License (no comercial). Solo consulta.
- Descartado como fuente: tablas ExHiROM/HiROM de Wikibooks (autodeclaradas
  erróneas en la propia página).

## Modelo de estado

```json
{ "rom_size": 4194304 }
```

- `rom_size`: obligatorio, potencia de 2 entre `0x10000` (64KB, un banco
  completo) y `0x400000` (4MB, alcance de una sola área HiROM; 8MB exige
  ExHiROM, perfil propio). ROM real más grande que el archivo declarado
  ⇒ normalización (pad 0xFF) registrada en evidencia.
- HiROM **no tiene registros de mapper**: claves extra en `mapper_state`
  (p. ej. `banks`) se rechazan con `unsupported`. El único estado
  legítimamente necesario es `rom_size` (para la máscara de espejo).

## Fórmula

`offset = ((banco << 16) | a) & (rom_size - 1)` con `banco = addr>>16`,
`a = addr & 0xFFFF`. Idéntica en bsnes (ventanas sin base) y snes9x
(`addr = c << 16` + `map_mirror`).

## Regiones por `translate` (precedencia en orden)

| # | Condición | Región | Offset |
|---|---|---|---|
| 1 | banco `7E-7F` (completo) | `wram` | `a` (128KB contiguos; la ventana 7F es `RAM+0x10000` en snes9x `map_WRAM`) |
| 2 | banco `00-3F`/`80-BF` y `a ≥ 0x8000` | `rom` | fórmula |
| 3 | banco `40-7D`/`C0-FF` (rango completo) | `rom` | fórmula |
| 4 | banco `20-3F`/`A0-BF` y `0x6000 ≤ a ≤ 0x7FFF` | `sram` | `a & 0x1FFF` (2KB, máscara `0xe000` de bsnes; igual en snes9x `map_HiROMSRAM`) |
| 5 | banco `00-3D`/`80-BD` y `a < 0x2000` | `wram-mirror` | `a & 0x1FFF` |
| 6 | banco `00-3D`/`80-BD` y `0x2000 ≤ a < 0x8000` | `io` | `a` (PPU/CPU/snescpu según snes9x `map_System`) |
| 7 | resto (`3E/3F`/`BE/BF` bajos, `A0-AF` y `20`… fuera de sram, `>0xFFFFFF`) | error | ver Errores |

Notas de precedencia: la regla 3 incluye bancos `FE/FF` (bsnes `c0-ff`),
cuyos offsets enmascaran a `3E/3F` en 4MB. Las reglas 2 y 3 se excluyen
por `a`; la 4 gana a la 6 en `20-3F`/`A0-BF` `$6000-$7FFF` (SRAM). En
HiROM **no hay mitad baja ambigua**: los bancos bajos `40-7D`/`C0-FF` son
ROM en ambas fuentes (el desacuerdo A15 de LoROM no aplica aquí).

Discordanca documentada (resuelta como en `snes-lorom`): snes9x
`map_System` extiende el espejo WRAM/I-O a los bancos bajos completos
`00-3F`/`80-BF`; bsnes limita las ventanas efectivas a `00-3D`/`80-BD`.
El perfil sigue a bsnes (misma convención que `snes-lorom`): mitades bajas
de `3E/3F`/`BE/BF` son `unsupported`, sin adivinar.

## Errores estructurados

- Mismos códigos que `md-linear`/`snes-lorom` (`out-of-range`,
  `unsupported`); `ambiguous` queda disponible pero **sin casos pinados**
  en este perfil (las fuentes no divergen en HiROM estándar).
- Dirección `> 0xFFFFFF` ⇒ `out-of-range`; estado inválido ⇒
  `unsupported`; ventana reservada (`3E/3F`/`BE/BF` bajos) ⇒
  `unsupported`.

## `invert(rom_offset, mapper_state)`

Devuelve **todos** los aliases: para cada banco `0x00-0xFF` elegible por
las reglas 2/3, sea `start = (banco<<16) & mask` y `rel = (offset − start)
& mask`; es alias si `0x8000 ≤ rel < 0x10000` (bancos de mitad alta ⇒
`a = rel`) o si `rel < 0x10000` (bancos completos ⇒ `a = rel`), con alias
`banco<<16 + rel`. Esto es directo de la definición de `translate`
(`offset = start + a`, sin overflow porque `start + a ≤ mask`). Orden
creciente; dos bancos apuntando al mismo offset generan aliases distintos
(p. ej. en 4MB, `0x008000` y `0x408000` ambos → offset `0x8000`). Lista
vacía (offset más allá del fin) es respuesta válida.

> Revisión 2026-09-25 (cross-check ejecutivo): la fórmula anterior exigía
> `rel < 0x8000` y construía el alias como `0x8000 + rel`, lo que invertía
> el offset `start + 0x8000 + rel` — ni producía los aliases reales de la
> mitad alta ni cubría los legítimos. La corrección fue validada por
> enumeración exhaustiva de las 16,7M de direcciones del barramento a
> través de `translate` y por el motor declarativo independiente de
> `scripts/rex_profiles/addressing/crosscheck/` (ventanas
> bsnes@7d5aa1e boards.bml, sha256 `b8006d805bef610bb527a486e8b576d48531e6afd94fce7083d3ca9eb553b378`).
> Los `invert_cases` pinados fueron re-pinhados con nota de revisión en
> `data/rex_profiles/addressing/snes-hirom/expected/translate-cases.json`.

## `read(cpu_address, length, mapper_state, rom)`

Semántica de segmentos igual que `snes-lorom` (un segmento por corrida de
región; regiones sin respaldo ROM devuelven segmento clasificador con
`error`), con la diferencia estructural de que **en HiROM una lectura ROM
sí puede ser contigua a través de bancos completos** (`40→41→…` y
`C0→…`): la corrida se corta en el fin del grupo de bancos (`0x7DFFFF`,
`0xFFFFFF`), en el borde de la mitad alta (`0x??FFFF` de bancos `00-3F`),
en el borde del espejo (`rom_size`) y en el fin del barramento. ROM más
corta que `rom_size` declarado ⇒ `out-of-range` en el tramo faltante, sin
clamp.

## Límites explícitos (v1)

- No modela ExHiROM (segunda área de 4MB, `base=0x400000`), Sa-Net, BS-Cart,
  DMA de BWE/BWB, chips DSP1/DSP2/SuperFX/CX4/SA1 (oclusión de ventanas por
  `map_DSP`/`map_SA1`), ni SRAM de 60-67/e0-e7 (tablas separadas de bsnes).
- No ejecuta ni inspecciona la ROM: la detección de mapa en cartucho real
  (puntuación LoROM vs HiROM de snes9x `Score*ROM`) es hipótesis registrada
  en el inventario del corpus, nunca conclusión del perfil. El header no es
  prueba.
- Ventanas `0x7E/0x7F` completas como WRAM siguen a bsnes/snes9x; boards
  con WRAM ampliada (80-BF bajos en modo ExpRAM) quedan fuera.
