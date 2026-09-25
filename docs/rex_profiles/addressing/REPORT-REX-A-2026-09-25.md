# Informe REX — Agente A: perfiles de endereçamento + inventario de corpus

Fecha: 2026-09-25 · Branch: `codex/rex-a-addressing` · BASE: `0d8c413`
Propiedad: `scripts/rex_profiles/addressing/`, `data/rex_profiles/addressing/`,
`docs/rex_profiles/addressing/`. Nada fuera de estos directorios fue tocado.

## 1. Perfiles entregados (5/5)

| Perfil | Tests | Casos pinados (pos/neg/invert/read/otros) | Fuentes fijadas | Cadena de commits |
|---|---|---|---|---|
| `md-linear` | 12 | 22 / 11 / 5 / 7 / — | Genesis-Plus-GX@`939ce4f` (license no comercial, solo consulta; cero lineas transcritas) | `7452dc3`→`e070d5a`→`8130640` |
| `md-ssf2` | 13 | 18 / 13 / 9 / 11 / 15 (registro) | mismas fuentes + ventanas/registro SSF2 mapeados a mano contra la spec | `3fb0ff9`→`bf79daa`→`5f7b217`→`eb09e39` |
| `snes-lorom` | 8 | 18 / 10 / 8 / 10 / — | bsnes@`7d5aa1e` boards.bml + snes9x@`1bcc369` memmap.cpp (solo consulta; licencias GPL-3.0 / Snes9x no comercial; cero lineas transcritas) | `c9a80c3`→`2a16914`→`2a03a9c`→`81ebca7`→`bddf0b2` |
| `snes-hirom` | 8 | 18 / 8 / 7 / 10 / — | mismas fuentes (map_hirom:2521-2534, Map_HiROMMap:3101-3119) | `08f0f87`→`37b608b`→`b068700` |
| `snes-exhirom` | 9 | 25 / 8 / 13 / 12 / — | mismas fuentes (Map_ExtendedHiROMMap:3120-3128, boards.bml:706-720) | `4265c98`→`436459d`→`50b83b7` |

Suite completa: **50 tests, 50 pasan, 0 fallan** (`node --test
scripts/rex_profiles/addressing/`).

Garantías de método (contrato v1, `docs/rex_profiles/CONTRACTS.md` +
`7db9da4`):

- Expectativas pinadas ANTES de cada implementación, con `pinning_history` y
  SHA-256 del archivo de expectativas registrado en la evidencia
  (`data/rex_profiles/addressing/<perfil>/evidence/translate-fixture.json`).
- Calculadoras independientes derivadas solo de la FÓRMULA de la spec
  (invert por fuerza bruta sobre las 16M direcciones del bus, read byte a
  byte) validaron los literales antes del pin; dos errores propios de
  transcripción fueron cazados así antes de commit (`81ebca7`, pre-pin
  exhirom).
- Tests discriminan fórmula equivocada (LoROM↔HiROM↔ExHiROM, swap de áreas),
  endian (checksums/offsets BE), estado errado (registro SSF2, `rom_size`,
  claves extra) y errores estructurados (nunca offset 0, sin `panic`).
- Fixtures autorales (patrones por banco, SHA-256 inmovilizados); ROMs
  comerciales no se usaron en ningún test.

## 2. Límites declarados (no es soporte general)

- `corpus-identification: blocked` en los cinco manifests: ningún perfil
  detecta el mapa de una ROM real; la detección (p. ej. puntuación
  LoROM-vs-HiROM de snes9x `Score*ROM`) queda como hipótesis de inventario.
- No modelados: ExMMD/MBD-512-extra, chips de oclusión (DSP1/2, SuperFX,
  SA1, CX4, SPC7110, BS-Cart), SRAM grande, DMA BWE/BWB, Game Genie,
  cabeceras .fig/.gd3, MBD con registros no documentados.
- Prueba sintética ≠ prueba en juego real: los fixtures son la especificación
  ejecutable, no evidencia de comportamiento en hardware.

## 3. Inventario ligero del corpus autorizado (`corpus-inventory-2026-09-25.json`)

Solo lectura: sin extracción a disco, sin copia de ROMs; los miembros de
archive se listan (`unzip -l -v` / `7z l -slt`) y las cabeceras se leen por
tubería (`unzip -p`/`7z x -so | head -c 68KB`) únicamente para señales.

Alcance: 10 directorios MD/SNES de `/home/misael/emulation/roms`
(`sfc snes sneshd snesna sufami satellaview genesis megadrive megadrivejp
genesiswide`). Total corpus completo leído: 9059 archivos / ~167 GB; el
alcance inventariado: **256 archivos / ~3.8 GB**, sha256 por archivo.

| Clase | n | Nota |
|---|---|---|
| `header-signal` | 190 | banner SNES en 0x7FC0/0xFFC0 (±512 SMC) o cabecera MD "SEGA" en 0x100 leída; map_bits declarados: nibble 2 (LoROM) 33, nibble 3 (HiROM/ExHiROM) 81 — **hipótesis de cabecera, no prueba de mapa** |
| `no-banner-in-sniff-window` | 31 | dumps >32KB sin banner en la ventana de 68KB (candidatos ExHiROM/Unl/SD-board; escaneo profundo fuera del alcance ligero) |
| `document` | 31 | txt/.directory de EmuDeck |
| `out-of-scope-32x-cd` | 2 | Doom/MK2 "MD+" son paquetes 32X+CD: fuera de los perfiles MD lineales |
| `misplaced-other-platform` | 1 | 7z en `sfc/` que contiene un `.nes` |
| `no-rom-content` | 1 | `Super Mario World (USA).zip` = placeholder sin ROM |

Brechas registradas: sufami/satellaview/megadrivejp/genesiswide están vacíos
(solo metadata); 4 archivos sin miembro ROM; snesna pesa 2.9 GB (hacks MSU1
con audio — el `.sfc` interno es candidato a datos appended, sin verificar
en modo ligero).

## 4. Siguiente paso (para el integrador)

- Revisar/mergear esta rama sobre la base acordada
  `codex/rex-integrator-profiles-codecs` (el agente A no hace merge).
- Desambiguar la sesión duplicada documentada en `COORDINATION.md`
  (archivos underscore/`MD_LINEAR.md` de otro executor ya no están en el
  árbol; la historia de commits los menciona).
- Si se quiere desbloquear `corpus-identification`: ventana de verificación
  pesada (escaneo de banners en bancos altos + comparación con tablas de
  placas conocidas) — fuera del presupuesto de esta ronda.
- Nota para `docs/06_AI_MEMORY_BANK.md` (se propone, no se edita por
  propiedad): rodada REX-A entrega 5 perfiles de traducción de direcciones
  con TDD estricto, suite 50/50, corpus inventariado en modo hipótesis.
