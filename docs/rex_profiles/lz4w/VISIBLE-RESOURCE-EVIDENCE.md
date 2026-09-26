# Evidencia — recurso LZ4W/APLIB realmente usado en pantalla (HAMOOPIG)

Fase 3, axente A (rex-addressing). Linguaxe: pt-BR (informe). Sen bytes de
ROM nos repositorios: só hashes, enderezos e campos estruturais.

## Identidade da ROM

| Campo | Valor |
|---|---|
| Ficheiro corpus | `data/canonical-local-2026-09-21/corpus/references/hamoopig-reference.bin` |
| SHA-256 | `558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9` |
| Tamanho | 917504 bytes |
| Header | `HAMOOPIG (HAMOOPI MD PORT BY HUMBERTODIAS)` região JUE, variante raw |
| SDK pinado | SGDK 2.11 (`/home/misael/.local/share/sgdk_forge/sdk_9e22ce585b578c4c3246`) |

Layouts estruturais tomados directamente das fontes do SDK pinado
(`SpriteDefinition`/`TileSet`/`Palette` en `m68k/inc`, `TileMap.java`,
`Image.java`, `Map.java` en `tools/src`), non inferidos por secuencias de
punteiros.

## Evidencia de frame activo / capturas autorizadas

- Core de captura: Genesis Plus GX v1.7.4 `46a5521`, determinista.
- Secuencia REX-00: `60 idle, Start 10, Right 60, idle final` — **nunca
  chegou ao gameplay**: os catro checkpoints (059/069/129/179) son a MESMA
  pantalla de título en fases de fade de paleta (059 verde monocromo,
  069 fade medio, 129/179 cor completa; `checkpoint-129.ppm` e
  `checkpoint-179.ppm` byte-idénticos).
- SHA-256 dos PPM: 059 `936a61aa…cd08b8a`, 069 `3f72f038…4c19c9c4`,
  129≡179 `5f4ce09d…b61cda86`.

## Resultado negativo (honesto): sprites LZ4W NON visibles nas capturas

A cadea validada `SpriteDefinition → animación → frame → TileSet → stream`
(escript `sgdk-sprite.mjs`, 60 definicións válidas) non produce **unha soa**
colocación visible en checkpoint-129 baixo portas estritas
(`minTiles=8, minRichCells=8`, cobertura ≥0,7, ≥4 cores por colocación) —
probado con **ambos** formatos de tile (planar e chunky). Grafo estático de
punteiros proba alcançabilidade, non execución; a ejecución visual queda
sen probar para sprites porque a captura non mostra gameplay.

**Retracción explícita:** as afirmacións previas (pre-porte) «def 0x22a2a
visible en (130-132,98) 42/55» e o hit en 0x24948 eran **falsos positivos**:
rexión de fondo plano coincidente co matcher axénstico de paleta, e
cores da paleta runtime non batían coa paleta da definición (fade).

## Resultado positivo: recurso realmente usado en pantalla

Elemento persistente da pantalla de título («personagem parado» — cena do
porco): **TiledImage @0x21b5c**, estrutura SGDK 2.11
`{ u32 palette* | u32 tileset* | u32 tilemap* }`:

| Componente | Endrezo | Campos |
|---|---|---|
| TiledImage | `0x21b5c` | palette→`0x21b56`, tileset→`0x21b44`, tilemap→`0x21b4c` |
| TileSet | `0x21b44` | compression=1 (APLIB raw), numTile=500, data=`0x2e4d4` (fluxo consume 4485 bytes) |
| TileMap | `0x21b4c` | compression=1 (APLIB raw), 40×28, data=`0x2d534` (fluxo consume 1196 bytes) |
| Palette | `0x21b56` | numColor=16, data=`0x2cbe8` (words BE 0xABGR) |

Decodificación APLIB (porta JS do contrato do axente B, vectors dourados
18/18 en `data/rex_profiles/codecs/aplib-golden/`) produce exactamente
16000 bytes de tiles e 2240 bytes de mapa.

### Formato dos tiles: CHUNKY packed-nibble (non planar)

A reconstrución pixel-exacta só funciona con tiles 8×8 4bpp **chunky**
(`byte = row*4 + col/2`, nibble alto = columna par). Coincide co commit
canónico `0e77f0b` do integrador (`md_pixel_location` en
`rex_resources.rs`: «matches SGDK rescomp ImageUtil.convert8bppTo4bpp»).
Discriminador medido en checkpoint-129: chunky **95,90%**, planar
**64,79%** (por-pixel contra a cor cuantizada da paleta ROM).

### Relación tiles / posición / flips / paleta (comprobada)

- Posición: `cell = (x*8, y*8)` fila-major do tilemap 40×28 sobre o plano A.
- Entrada u16 BE: índice bits 0-10, hflip bit 11, vflip bit 12, banco de
  paleta bits 13-14 (todos os entries usan banco 0), priority bit 15 (0 en
  todo o mapa).
- Flips: 15 entries h, 27 v; ignoralos degrada a reconstrución
  (95,90% → 94,46%) — efecto probado, non asumido.
- Paleta: índice de paleta k de cada pixel → entrada k da Palette ROM
  (`0x2cbe8`) cuantizada `(v>>1)*239/7` (±4). 12 dos 16 índices usados
  teñen **unha soa cor** en todo o frame (sen oclusión); os índices 2 e 14
  levan píxeles alleos (= sprites superpostos ao plano A, non explicados
  por este recurso; o segundo TiledImage @0x21b80 só explica 27,98% do
  frame, descartado como capa visible).

## Reprodución

Probas: `node --test scripts/rex_profiles/lz4w/` (require ROM no corpus
canónico e PPMs en
`/home/misael/RetroDevStudio/rex-evidence-2026-09-10/backend-hamoopig`).
A cadena de observación (REX-00 + checkpoints) é determinista co core
pinado; para observar un frame de sprite en execución fai falta unha
captura que alcance o gameplay (pendente — xanela do integrador).

## Alcance dos 3 TiledImage da ROM

`0x21b5c` (APLIB, visible, probado arriba); `0x21b80` (APLIB, 543 tiles,
27,98% do frame — non é a capa base); `0x21ba4` (NONE, 2 tiles). Ningún
TiledImage referencia TileSet LZ4W: o LZ4W da ROM vive só en sprites e o
«realmente usado en pantalla» nas capturas autorizadas é APLIB.
