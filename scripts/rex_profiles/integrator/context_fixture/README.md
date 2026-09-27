# Fixture de contexto aPLib autoral (SGDK 2.11) — `rex-context-aplib-fixture`

## O que é e o que NÃO é

ROM Mega Drive **autoral** com `TILESET` + `TILEMAP` + `PALETTE` comprimidos por
**aPLib**, compilada pelo toolchain SGDK 2.11 pinado pelo lock do host. **Não é
BYOR** e não é comercial. A ROM não vai para o git: é reconstruída das fontes
deste diretório, e o teste de aceite a consome por caminho explícito
(`RDS_REX_CTX_FIXTURE_ROM`).

Ela existe para provar a perna que o fixture LZ4W (`../lz4w_fixture/`) não
cobre: ali o **mapa é preenchido por código**, então não há TileMap comprimido,
não há tile compartilhado entre células, não há flip, não há múltiplos bancos de
paleta e não há referência inválida. Sem esses casos, "editar um pixel" não
distinge um modelo de contexto correto de um renderer que chutou a posição.

| Requisito do briefing | Onde está no fixture |
|---|---|
| tile usado uma vez | `t1` (banco 1) e `t4`..`t7` — uma ocorrência cada |
| tile compartilhado | `t2` em **4 células**, sob 4 transformações distintas (`B`,`H`,``,`V`); `t3` em 2 |
| flips H/V | acima, mais o bit de flip na palavra da célula |
| mais de uma paleta | 3 bancos de 16 cores; `t1` só aparece no banco 1 |
| índice 0 | `t0` é o tile vazio e todo pixel de índice 0 do mapa é transparente |
| referência inválida | `ctx_ghost` (mapa 8x16, `map_base=100`) referencia índice **107**, fora do tileset de 16 |
| tile de sistema colidindo | `ctx_ghost` resolve blocos sólidos para índices **0** e **5**, que também existem no tileset |

## Geometria

- Tileset: 4x4 = 16 tiles de 8x8, 4bpp chunky → 512 B plain, ordem ROW, `opt=NONE`.
- Mapa principal (`ctx_map`): 15x9 = 135 células → 270 B plain → **120x72 px** de tela.
- Mapa fantasma (`ctx_ghost`): 8x16 = 128 células → 256 B plain, `map_base = 100`.
- Paleta (`ctx_pal`): 48 cores = 3 bancos, via **JASC-PAL `.pal`** (o `.png` de
  paleta faria `numColor` depender do arquivo; o `.pal` fixa 48).
- Edição canônica: `tile 2, linha 4, coluna 7: índice 0x0B -> 0x03`. O pixel é
  plantado na fonte e o valor novo tem cor diferente **em todos os bancos** em
  que o tile aparece.

## Ordem obrigatória das pontas

1. **`gen_fixture.py` escreve o esperado ANTES de compilar.** Ele só conhece
   constantes de autoria e a semântica do rescomp 2.11 lida em
   `toolchains/sgdk/tools/rescomp/src/sgdk/rescomp/resource/{Tilemap,Tile,Tileset}.java`
   e `type/Basics.java`. Nada ali lê o ROM compilado; `ground_truth.json` carrega
   `derived_from_compiled_rom: false`.
2. **`build-fixture.sh` compila e confere o artefato.** Presunção pelo `.res` não
   vale: `Util.isCompressionValuable` troca APLIB por NONE em silêncio quando a
   economia não passa de 120 B ou dos 85%. O script exige, **no ROM**, exatamente
   um header TileSet com `compression=1`, um TileMap APLIB 15x9, um TileMap APLIB
   8x16 e uma Palette de 48 cores — e recusa se qualquer um dos três existir
   também como `compression=0`.
3. **`verify-external.py` valida o esperado com oráculo externo.** Usa
   `apj.jar` do SDK pinado (SHA-256 `2d8cdc63cc800e4b…`, idêntico ao oráculo
   registrado em `../aplib/oracle_encode_parity.py`) para **decodificar** os três
   streams do ROM e conferir byte a byte contra o `plain_hex` escrito no passo 1,
   e para **re-empacotar** e conferir byte a byte contra o stream do ROM. O
   renderer desta ponta é independente do produto: reimplementa chunky 4bpp,
   palavra de célula, bancos e máscara de transparência a partir do cabeçalho C
   do SGDK, e compara a camada composta com `expected/composed_layer.png` pixel a
   pixel. **Zero linhas de código do produto.**

## Como reconstruir e verificar

```bash
npm run host:diagnose                      # tem que estar READY
scripts/rex_profiles/integrator/context_fixture/build-fixture.sh \
  --out src-tauri/target-test/validation/rex-context-fixture
scripts/rex_profiles/integrator/context_fixture/verify-external.py \
  src-tauri/target-test/validation/rex-context-fixture
```

Requer `java` no PATH e SGDK + m68k-elf no cache do host (ou `SGDK_ROOT`/`GDK`).
Saídas: `project/out/rom.bin`, `fixture-build-report.json`, `external-verify.json`.

Estado medido nesta rodada (reconstrução determinística; dois `make` seguidos
deram o mesmo SHA):

- ROM `705b72eb848fadf11cdefd4302ef8c6751d005bd1c762918aea3b0860b20da86`, 393216 B.
- 18/18 conferências externas verdes. Decode `apj.jar`: tileset 512 B
  (`0c666624…`), mapa 270 B (`e7980b78…`), ghost 256 B (`3f035802…`) — os três
  iguais ao esperado pré-compilação. Round-trip de re-empacotamento byte exato.
- Camada composta renderizada por ferramenta externa: `7dc94b0254acda91…` ==
  SHA do esperado.
- Impacto da edição canônica, previsto antes da compilação e conferido depois:
  **exatamente 4 pixels** de tela mudam, em `(0,3) (56,4) (23,12) (47,27)`, todos
  de `(0,36,109)` para `(0,0,109)`.

## Associações: verificada, assistida e desconhecida

O briefing exige registrar a classe de cada associação e proíbe associar
recursos por proximidade ou tamanho. O artefato responde por conta própria:

- **Verificada por ponteiro** — `src/main.c` instancia `const Image ctx_image =
  { &ctx_pal, &ctx_tiles, &ctx_map }`. No ROM, em `0x1750a`, estão os três
  ponteiros `0x174e8 / 0x174ee / 0x174f6`. O produto pode **seguir ponteiros** em
  vez de inferir. A varredura integral do ROM acha **uma** única trinca assim.
- **Assistida por símbolo** — `project/out/symbol.txt` (emitido pelo linker, não
  por mim) declara `ctx_pal 0x174e8`, `ctx_tiles 0x174ee`, `ctx_map 0x174f6`,
  `ctx_ghost 0x17500` e os `<x>_data_size`. O `build-fixture.sh` **recusa o
  build** se o endereço do símbolo divergir do header que o scanner achou pelo
  padrão de bytes: duas fontes independentes têm que concordar. Também é o
  símbolo que dá o tamanho real do stream, em vez de "até o próximo vizinho" (o
  tileset é o último e não tem vizinho).
- **Desconhecida no artefato** — `ctx_ghost`: o linker descartou
  `ctx_ghost_image` (struct sem referência no código), então **nenhum** ponteiro
  liga esse mapa ao tileset. O produto não pode afirmar a associação; se
  aparecer associado "porque é o tileset vizinho", é bug de heurística, não
  sucesso. Continua útil como fonte de referência inválida e de colisão de tile
  de sistema.

Tamanhos registrados nas duas fontes, e a diferença é real (não é divergência): o
símbolo diz `ctx_tiles_data_size = 0xaa = 170` e o oráculo externo re-empacota em
169 B, que conferem byte a byte com o ROM em `0x5fa38`. Os índices 0..168 do
stream são dado comprimido; o índice 169 vale `0x00` e o recurso seguinte começa
exatamente em `+170` (`0xc4`): é padding de alinhamento, não dado comprimido. Cada número aparece no relatório da fonte que o
mede (`fixture-build-report.json` e `external-verify.json`).

## O que o produto **não** recebe

`ground_truth.json` e `fixture-build-report.json` existem **para o teste**. O
produto tem que localizar TileSet/TileMap/Paleta/`Image` pelo caminho canônico
de descoberta e descobrir offsets sozinho. Nenhuma linha do núcleo lê o
manifesto; se passar a ler, a associação deixa de ser verificada e passa a ser
contrabando. Esta ponta (modelo de mapa no núcleo, prévia composta na interface e
prova discriminante) é a que vem agora — o fixture existe para que ela tenha
com o que ser conferida.

## Limites declarados

- **Não é screenshot do jogo.** A prévia que estas ferramentas comparam é a
  **reconstrução de uma camada** (`ctx_map` em BG_A sobre o backdrop). Não há
  sprites, janela, raster, scroll nem segunda camada no fixture; quem renderizar
  isso como "a tela do jogo" está mentindo.
- **Índice 0 é transparente no plano**, e só: os bancos 1 e 2 têm cores visíveis
  no índice 0 justamente para pegar renderer ingênuo que pinta `pal[banco][0]`
  em vez do backdrop. Não confunde com "a cor 0 é transparente" — a máscara é do
  **pixel em tela**, não da paleta.
- **Prioridade não é composta aqui.** O bit 15 da célula é autoral e conferido
  na palavra, mas a composição esperada não resolve o caso "tile com prioridade
  alta sobre fundo": isso é comportamento do VDP, não do rescomp, e fica fora do
  escopo desta prova.
- **Contagem de células ≠ dependências da ROM.** "Esta edição afeta 4 ocorrências
  **neste mapa verificado**" é o que o fixture sustenta. Não há alegação sobre o
  jogo inteiro.
- **Colisão de tile de sistema**: em `ctx_ghost` (`map_base=100`), um bloco
  sólido resolve para o tile de sistema **sem** o offset de base, então os
  índices 0 e 5 ali significam o padrão sólido do VDP, não `t0`/`t5` do tileset.
  Numericamente idênticos. O fixture **expõe** o ambiguo; resolvê-lo exigiria
  observação de VRAM, que não está nesta rodada.
- O perfil vale para **este** toolchain pinado (rescomp.jar `502a4670…`,
  apj.jar `2d8cdc63…`, libmd.a `ef904a37…`). Não generalize para outras ROMs nem
  para outra versão do SGDK sem reconstruir e re-medir.
