# Fixture LZ4W autoral (SGDK 2.11) — `rex-lz4w-fixture`

## O que é e o que NÃO é

ROM Mega Drive **autoral**, gerada neste repositório a partir de fontes
escritos aqui (`project/src/main.c`, `project/res/main.res`, `gen_fixture.py`)
compilados pelo toolchain SGDK 2.11 pinado pelo lock do host. **Não é BYOR**:
não há ROM comercial envolvida, e nenhuma alegação de sucesso sobre corpus de
terceiros se faz aqui. A ROM é artefato reconstruído — não vai para o git
(fontes + toolchain + SHA no relatório).

## Por que ele existe

A meta da rodada é **uma edição de recurso comprimido com efeito causal
demonstrado na tela**. No alvo comercial (0xc8cc8 de HAMOOPIG) o elo que
falta é o **consumidor**: a sonda do E2E só alcança as regiões que o core
expõe (`emulator_read_memory` regiões 2/3), então CRAM e o destino/chamada do
desempacotador ficam `missing` — não se pode afirmar que o recurso é
carregado nem onde ele aparece na tela. (Espaço para reinserção **existe**
nesse recurso: a edição canônica `pixel (0,7,4) -> idx 15` coube e é aplicada
pelo aceite BYOR, e a varredura orçada (64 candidatos) achou 4 edições cabíveis
em `0xc8cc8`; os 18 outros recursos com tiles em tela deram `fit=0` no mesmo
orçamento — e nenhuma dessas tem consumidor provado.) Instrumentar a ROM
comercial para forçar o recurso a
aparecer não é autorizado nesta rodada.

Um fixture resolve o problema pela outra ponta: aqui **a cadeia de consumo é
conhecida por construção**, não inferida.

| Elo | Quem garante | Como se verifica |
|---|---|---|
| PNG autoral -> stream LZ4W na ROM | `rescomp` (SGDK oficial, `res/main.res`: `TILESET fixture_tiles "tiles.png" LZ4W NONE`) | header `{u16 compression=2; u16 numTile=16; u32 tiles}` no ROM |
| stream -> pixels | `unpackTileSet()` (SGDK oficial, `inc/tools.h`) chamado em `src/main.c` | teste de aceite compara o decode do produto com a fonte recomposta do seed |
| pixels -> tela | `VDP_loadTileSet()` + `VDP_fillTileMapRectInc()` em `src/main.c` | tile `t` cai uma única vez na célula `(t % 4, t / 4)` de um plano 4x4 de tiles 8x8 |

Consequência: o pixel de tela esperado por uma edição `(tile, row, col)` é
`(x, y) = ((tile % 4) * 8 + col, (tile / 4) * 8 + row)` — **antes** de
qualquer emulação. Isso é o que faltava no alvo comercial.

## Geometria e dados

- 16 tiles de 8x8, 4bpp chunky (32 bytes/tile, 512 bytes plain).
- `tile(t, r, c) = LCG(t*NOISE_ROWS*8 + r*8 + c)` para `r < NOISE_ROWS=4`, e
  `(t*7 + r*3) & 0xF` para as demais linhas. As linhas de literais fazem a
  compressão vencer sem ser degenerada; as linhas sólidas dão matches longos.
  Se o tile for puro ruído, o LZ4W **perde** do dado cru (520 > 512) e o
  rescomp descarta a compressão (`compression=0`): o fixture deixa de ser um
  caso LZ4W. Foi o que aconteceu na primeira versão e é o que o passo de
  verificação em `build-fixture.sh` recusa agora.
- LCG MMIX: `state = state * 6364136223846793005 + 1442695040888963407`,
  byte útil = `(state >> 33) & 0xF`, seed `0x5245584C5A345731`.
- **Plantio do near-miss** (`NEAR_MISS_ROW = NOISE_ROWS + 1 = 5`,
  `col = TILE_PX - 1 = 7`): aquele pixel guarda `(v+1) & 0xF` em vez de `v`.
  Motivo, e é a parte não-negociável do desenho: o LZ4W casa **words de
  16 bits**, não pixels. Uma edição de 1 pixel só encurta o stream se ela
  fizer dois words adjacentes ficarem idênticos (ou prolongar um match).
  Sem isso, medir o fixture original provou que **nenhuma** das 15.360
  edições de um pixel cabia no slot. O plantio devolve a condição; desfazê-lo
  (`tile 0, row 5, col 7: índice 0 -> 15`) é a edição canônica do aceite.
- Paleta PAL0 em `inc/pal_def.h` (gerado), sem índice transparente.

## Como reconstruir

```bash
scripts/rex_profiles/integrator/lz4w_fixture/build-fixture.sh \
  --out /tmp/rex-lz4w-fixture
```

Requer o host `READY` (`npm run host:diagnose`), `java` no PATH e SGDK +
m68k-elf no cache do host (ou `SGDK_ROOT`/`GDK` explícitos). O script copia o
template, gera as fontes, roda `make` com `makefile.gen` do SGDK e **falha**
se o ROM resultante não expuser exatamente um header TileSet com
`compression=2`. Escreve `fixture-build-report.json` (SHA da ROM, offset do
header/stream, SHA das fontes e do toolchain, ground truth).

## Aceite no produto

```bash
RDS_REX_LZ4W_FIXTURE_ROM=/tmp/rex-lz4w-fixture/project/out/rom.bin \
  cargo test --lib -- --ignored --nocapture fixture_lz4w
```

`src-tauri/src/tools/reverse/decomp/rex_resources.rs::
fixture_lz4w_decodes_to_authored_source_and_edit_has_predicted_pixel`
confere, nesta ordem:

1. decode do produto == tileset recomposto do seed **e da regra do
   near-miss** (expectativa independente do decodificador);
2. no-op pela transação canônica — re-inserir o plain não-editado não é
   sucesso fabricado;
3. linha de base medida **antes** de qualquer busca: `slot(rescomp)=444B`,
   `re-codificação do plain não-editado=448B`, `folga=-4B`;
4. busca de edições de 1 pixel — a plantada primeiro, depois a exaustiva
   (16 tiles x 64 pixels x 15 índices = 15.360 candidatos) com filtro barato
   (comprimento do re-encode) e dicionário compartilhado; a transação
   canônica (identidade, evidência, dependentes, roundtrip, BPS) só roda para
   candidato que **cabe**. Aceita: `tile 0, row 5, col 7 -> idx 15`,
   encode 440B no slot de 444B;
5. a transação aplica a edição e a ROM modificada é reaberta e re-decodificada:
   o recurso lido do disco é exatamente o plain planejado;
6. a prévia renderizada difere da original em **exatamente** o pixel previsto
   na faixa de tiles (`(tile*8+col, row)`) — é o que pega a regressão histórica
   de ler a faixa linearmente;
7. o pixel de **tela** é impresso como **previsão** (`tela=(7,5)`, calculado da
   célula do mapa, independente da prévia) com o SHA dos pixels e do PNG.

Ausência da ROM faz o teste **falhar**, não pular em silêncio; o SHA-256 da
ROM é conferido (`159298eb1c9a437a6abc83c80becfe38c52d469d6284aeab4dc9dc06e9b2b9b5`
para os fontes atuais). O stream escrito pelo produto também desempacota no
68000 oficial: `data/rex_profiles/integrator/lz4w-68k/evidence/2026-09-26-r13/
runs/runF` (`i30` = stream do rescomp, `i31` = stream do produto), ambos
`68k == jar == esperado` em 512 bytes.

## Prova pela aplicação (ETAPA E, E2E)

```bash
scripts/rex_profiles/integrator/lz4w_fixture/build-fixture.sh \
  --out src-tauri/target-test/validation/rex-lz4w-fixture   # reprodução durável do mesmo ROM
RDS_REX_LZ4W_FIXTURE_ROM=src-tauri/target-test/validation/rex-lz4w-fixture/project/out/rom.bin \
  npm run test:e2e:desktop -- --scenario rex-lz4w-fixture-effect
```

O cenário `rex-lz4w-fixture-effect` (`scripts/e2e-tauri-build-run.mjs`) percorre a
interface real (aba "Recursos comprimidos": verificar → selecionar → prévia →
formulário de pixel → transação → BPS) e depois executa a ROM modificada no core
Libretro do host, asserindo: **1 byte** no WRAM (`0x5e`, `f0→ff`), **exatamente 1
pixel de tela** diferente na coordenada prevista `(7,5)`, canvas do app == framebuffer do
core, BPS re-aplicado com hash exato, e os negativos alcançáveis pela UI (guarda
da fila de edição e `rom_identity_mismatch` por TOCTOU, com a ROM do fixture
reconferida intacta). Verde em run10/run11 no binário `e6907792…`; pacote e
`manifest.json` em
`data/rex_profiles/integrator/lz4w-fixture/evidence/2026-09-26-e2e/`.

## O que o fixture também mede (e não esconde)

- **Gap de codificador, medido duas vezes**: no plain não-editado o rescomp
  gasta 444B e o codificador guloso+lazy do produto gasta 448B (no fixture
  anterior, 378B vs 380B). Sem folga positiva, só reinserção que **encurte**
  o stream é possível — daí o plantio.
- **Porte do DP ótimo não resolveu**: implementado, verde no suíte, e
  **pior** (382B vs 380B) — revertido em vez de entregue. O modelo de custo
  de 1 palavra por token ignora o limite de chunk de 15 literais: o custo
  real de 16 literais + match curto é 20 words, não 17. Um DP fiel precisa
  de estado `(posição x literais pendentes mod 15)`.
- **Discriminante negativa**: `data/rex_profiles/integrator/lz4w-fixture/
  evidence/2026-09-26/fixture-acceptance-exhaustive-before-plant.log` registra
  os 15.360 candidatos do fixture **sem** plantio — `0 cabem`. O teste não
  passa por construção conveniente; ele passa porque a única condição que faz
  uma edição de pixel caber foi satisfeita e medida.

## Limites declarados

- Prova a cadeia LZ4W do produto contra um consumidor **nosso**; não prova
  nada sobre o uso de LZ4W em ROM comercial.
- A edição cabível existe porque o fixture foi desenhado para ela: é prova de
  **mecanismo**, não de cobertura de alvos reais. No corpus comercial nada
  foi alterado além do que o teste BYOR já aplicava (`pixel (0,7,4) -> idx
  15`, ROM de base intacta, `needs_space` honesto onde não coube).
- O efeito na tela do app **foi** capturado por emulação (ETAPA E, cenário
  `rex-lz4w-fixture-effect`): com o Genesis Plus GX v1.7.4 46a5521 do host, a
  ROM modificada difere da base em **exatamente 1 pixel de tela**, na
  coordenada prevista pelo fonte (`(7,5)`), e o canvas do app apresenta o
  framebuffer do core no mesmo frame congelado. Rodadas em
  `data/rex_profiles/integrator/lz4w-fixture/evidence/2026-09-26-e2e/`.
- Duas pernas **não** provadas pela emulação, registradas como limitação no
  relatório do cenário em vez de contadas como sucesso:
  - O core não expõe a região `VIDEO_RAM` (`retro_get_memory_size` devolve 0 e
    `emulator_read_memory` responde `ok:true` com dados vazios — armadilha de
    prova vacua). A cadeia causal fica provada por `WRAM` (1 byte em `0x5e`,
    `f0 -> ff`) + framebuffer.
  - O DAC do Mega Drive **funde** as 16 palavras de paleta autorais em 11
    cores observadas (medido: índices colididos `[0,1,2,3,4,6,7,8,9,10]`).
    Índice->cor é função, mas não é injetiva; a identidade do pixel editado é
    estabelecida pela **posição** (layout do fonte), e a cor apenas confirma a
    classe. Ferramenta de diagnóstico: `analyze-frame.py` neste diretório.
- A recusa de edição fora do recurso **não é alcançável pela interface**: o
  painel descarta no cliente o tile `>= num_tiles`
  (`CompressedResourcePanel.tsx`, botão "Adicionar edição"). O que o cenário
  prova pela UI é a guarda (nada entra na fila, nada é escrito, com controle
  positivo de tile válido que enfileira 1 edição); a recusa do núcleo
  (`rex_resources.rs`, `tile N fora do recurso`) é provada pelo teste unitário
  `apply_rejects_tile_outside_resource_without_writing`.
- O mapa é preenchido por código, não por recurso comprimido: um fixture com
  `TILEMAP`/`IMAGE` comprimidos seria um caso adicional, não está feito.
- Licenças: toolchain SGDK 2.11 (Stephane Dallongeville) é dependência já
  aprovada do host; as fontes deste diretório são autoriais do projeto.
