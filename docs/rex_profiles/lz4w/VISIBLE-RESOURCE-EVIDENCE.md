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
ponteiros.

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
ponteiros proba alcançabilidade, non execución; a ejecución visual queda
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

## Fase 4 — clase e consumidor de `0xc8cc8` (sen clasificación por tamaño nin enderezo)

A hipótese do produto (ROUND_STATE.md @ 7bf3393) clasificaba `0xc8cc8` como
«288 bytes = 9 paletas × 16 cores». Esa lectura é un artefacto de tamaño:
288 = 9·32 bytes de tile 4bpp **e** 144 palabras BE, e calquera par
`{u16=0x0009, u32=0x000c8cc8}` se le tamén como Palette definition
`{numColor=9, data=0xc8cc8}`. O alias está en `0x2578a`, **dentro** do header
TileSet `@0x25788`: é o campo `numTile` re-interpretado. Pins verificadas en
`scripts/rex_profiles/lz4w/resourceclass.test.mjs` (expectativas RED antes da
implementación, medidas sobre a ROM):

- **Referencia verificada**: a única referencia absoluta u32 a `0xc8cc8` en
  todo o binario vive en `0x2578c`, que é o campo `tiles` do header
  TileSet SGDK 2.11 `@0x25788 = {u16 compression=2 (LZ4W), u16 numTile=9,
  u32 tiles=0xc8cc8}`. A única referencia a `0x25788` está en `0x25792`, o
  campo `tileset*` de `SpriteFrame @0x25790`.
- **Consumidor**: `validateRom` (layout pinado do xerador rescomp) pecha a
  cadea `SpriteDefinition @0x258e8` (paleta real `0x221e6`) → animación →
  frame 0 `@0x25790` → TileSet `@0x25788` → `0xc8cc8`. O VDPSprite do frame
  ten `cellsWide=3 · cellsTall=3 = 9 = numTile`. A definición está
  referenciada 4 veces desde o segmento de código (`0x4f22`, `0x5734`,
  `0x6070`, `0x616e`, todos < `0x10000`): **alcanzable** probado
  estaticamente. Non existe ningunha Palette definition SGDK cuxo `data`
  apunte a `0xc8cc8` fóra do alias do seu propio header.
- **Clase estructural do payload**: decodificado LZ4W (dicionario = prefixo
  `rom[0..0xc8cc8]`) → 288 bytes, `bytesConsumed = 144`. Alfabeto de nibbles
  = `{0, 10, 12, 13, 14, 15}` sen 1..9 nin 11 (5 cores + transparente), e 18
  palabras BE con bit0=1 (`0xaaaa`, `0xefef`…), **imposibles** en saída de
  paleta SGDK. Calibración na propia ROM: as 960 palabras das 60 paletas de
  tódalas definicións validadas teñen bit0=0. Conclusión: son **datos de
  tile 4bpp (chunky) dun efecto 3×3**, non paletas.
- **Separación honesta**: alcanzábelo (cadea + 4 sitios de código) ≠ cargado
  ≠ visible. A observación de carga (VRAM/CRAM/RAM) require a xanela do
  integrador. O efecto E2E reclamado (3174 px nunha caixa 208×94 ao editar un
  nibble) non é consistente cun cambio dun só píxel de tile, e si o é cun
  **desprazamento de streams** na recomposición: o frame 1 da mesma animación
  ten os seus tiles exactamente en `0xc8d58 = 0xc8cc8 + 144`, polo que calquer
  repack que altere a lonxitude do stream despraza todos os datos seguintes
  (os ponteiros son absolutos). Probas: decodificación do veciño a
  `numTile·32` exacta. Suxestión de observación na xanela: dump de VRAM/CRAM
  antes/depois do parche, e o `index` pasado a `VDP_loadTileSet`
  (rexión de patterns vs. name table).
- Hashes (sen bytes na repo): stream comprimido (144 B)
  `c537b9ad0895f566c49b751f57f375f8ffe9e481a3b03bf0af5486bec69e7353`;
  payload decodificado (288 B)
  `5e3e68a9ebadb5b178d9e8941017b92ffa49667aa8a0b39c268f735d6af87d46`.
- O **segundo alvo presérvase**: `TiledImage @0x21b5c` (APLIB) segue sendo o
  recurso visible probado píxel a píxel (95,90% cp129); `0xc8cc8` é recurso
  de sprite LZ4W cargado por outra ruta, sen conflicting claims.
