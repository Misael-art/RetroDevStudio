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
contrabando. O aceite abaixo é o que fiscaliza essa fronteira: ele lê o
manifesto, o núcleo só lê a ROM.

## Aceite no produto (por descoberta canônica)

Os dois testes vivem em `src-tauri/src/tools/reverse/decomp/rex_context.rs` e
são `#[ignore]` porque exigem a ROM compilada localmente:

```bash
cd src-tauri
RDS_REX_CTX_FIXTURE_ROM=$PWD/target-test/validation/rex-context-fixture/project/out/rom.bin \
  cargo test --lib rex_context::tests::fixture -- --ignored --nocapture --test-threads=1
```

Eles pinam o SHA do ROM antes de qualquer coisa (`705b72eb…`), descobrem as
estruturas por varredura + decode + ponteiro seguido (nenhum offset vem do
manifesto) e conferem, na ordem do briefing: reconstrução da camada → clique em
célula com flip → pixel de origem → previsão das ocorrências afetadas → edição
pela transação canônica. A escrita é a mesma do produto: `apply_resource_edit`,
com o índice de paleta 0 expressável e sem segundo encoder nem fluxo paralelo.

Medido em 2026-09-27, ROM `705b72eb…`, perfil `dev` (debuginfo 0, sem otimização
de teste):

- 2 recursos aPLib verificados de 12 candidatos de TileSet (2/16 do total de
  LZ4W + aPLib); 2 TileMaps verificados (`15x9` e o ghost `8x16`), ambos com
  codec lido do header; **1** cadeia `Image` — e nenhuma cadeia aponta para o
  ghost, exatamente como o `symbol.txt`/linker registram.
- Camada composta 120x72 byte a byte igual ao esperado autoral, com o SHA do
  esperado recomposto pelo teste batendo com `composed_layer.pixels_sha256`
  (`7dc94b02…`) — ou seja, o esperado do teste é o do oráculo, não um eco.
- Os 4 cliques das posições previstas devolvem `(tile 2, linha 4, coluna 7)`;
  `ocorrencias_do_tile(2)` devolve as mesmas 4 células com os mesmos flips.
- Edição canônica: desfecho `applied`, 1 byte alterado no tileset (o do pixel),
  mapa e paleta re-descobertos idênticos, BPS materializado, e o diff da camada
  recomposta **exatamente** as 4 posições previstas — nem uma a mais, nem uma a
  menos.
- Duração por etapa (diagnóstico, não alegação): descobrir + conferir estruturas
  ~0,4 ms, compor camada ~6,7 ms, clique/projeção ~0,1 ms, compartilhamento
  ~0,2 ms, superfície do contexto ~988 ms. Total dos três testes ignorados
  **1,20 s** (`cargo test ... --ignored`, medido 2026-09-27).

### O custo que os testes encontraram (e como ficou)

A perna de contexto levou **42,65 s** na primeira execução. Não é o modelo: é
`localizar_cadeias_imagem`, que para cada janela de 2 bytes consultava por
`Vec::contains` as listas de candidatos — 196 mil janelas × 3 383 candidatos de
paleta. Trocando as três listas por `HashSet` (mesma definição, custo de consulta
diferente), a varredura caiu para **~92 ms** e `contexto_da_rom`, para
**~206 ms** na ROM inteira de 384 KB:

| etapa (384 KB, perfil dev) | antes | depois |
|---|---|---|
| `localizar_cadeias_imagem` | 8,32 s | 92 ms |
| `contexto_da_rom` (passada completa) | 8,45 s | 206 ms |
| aceite de leitura (3 testes `--ignored`) | 51,3 s | 1,20 s |

Duas coisas prendem isso no lugar, sem depender de relógio:
`localizacao_de_cadeia_nao_depende_da_ordem_nem_de_duplicatas_dos_candidatos`
(que é o invariante que o `HashSet` preserva) e a sonda `#[ignore]`
`sonda_de_custo_da_descoberta_na_fixture`, que imprime a duração de cada fase.
Asserção de wall-clock seria flaky e não foi escrita.

## Superfície publicada (IPC somente leitura) e UI contextual

`rex_resource_context(rom_path)` devolve `ContextoRom`; `rex_resource_context_hit`
devolve a resolução de um pixel da camada. Nenhum dos dois escreve: a escrita
continua sendo `rex_resource_apply_edit`, que exige `expected_rom_sha256` — a UI
passa o `rom_sha256` que o próprio contexto publicou, e é assim que "revalidar
identidade ao editar" deixa de ser intenção.

O que a superfície publica, com a classe de proveniência de cada vínculo:

- identidade dos três recursos de cada imagem (header, stream, codec lido do
  header, `plain_len`, `stream_len` **medido** no decode, SHA-256 do plano);
- o que foi conferido (`conferido`) e o que isso **não** prova (`nao_prova`),
  incluindo que a prévia é camada reconstruída e não framebuffer;
- geometria do mapa, célula por célula (tile, flips, banco, prioridade) e as
  ocorrências agrupadas por tile, com escopo explícito do mapa;
- o que foi **recusado**: recurso verificado sem ponteiro (`sem_vinculo`) e trinca
  que não verifica (`recusados`) — nada desaparece em silêncio;
- camada acima do orçamento (`max_pixels_por_camada`, padrão 2048×2048): recusa a
  prévia com o motivo e mantém células, ocorrências e identidade publicados.

Na frente, `RexImageContextPanel` mostra a camada composta com zoom inteiro
(1/2/3/4/6/8) e `image-rendering: pixelated`, destaca a célula clicada e as
irmãs, e nomeia o tile de origem no sheet do TileSet. A UI **não** sabe
geometria: converte o ponteiro em pixel natural (`ponteiroParaPixel`, que desfaz
zoom inteiro, `max-width` e escala de página pela razão dos retângulos) e pergunta
ao núcleo. Enfileirar uma edição exige que o recurso selecionado seja o TileSet
da imagem; se não for, a frente recusa e a fila não muda. Não existe controle de
"editar só esta ocorrência" — sem duplicar e realocar tile, isso seria
destrutivo.

Prova de frente (38 testes em 3 arquivos, com mutação conferida): remover o
guard de sequência faz cair "clique obsoleto"; enfileirar pelo pixel de tela em
vez do de fonte faz cair as duas pernas de edição; arredondar em vez de recusar a
borda faz cair as três pernas de geometria; e tirar o reset por troca de ROM faz
cair "trocar de ROM descarta contexto, seleção e pedidos exibidos".

## Prova pela interface (WebDriver, binário real)

`npm run test:e2e:desktop -- --scenario rex-context-fixture-effect` percorre o
cenário acima no WebView real, com as três receitas autorais como oráculo e **nenhum
offset vindo da UI**. Verde em 2026-09-27 no binário `f56be451…`
(rc=0, 17 passos, 15,6 s): os quatro cliques sob flips distintos resolvem o mesmo
pixel de fonte, a camada lida do `<img>` bate com o SHA do oráculo externo
(`7dc94b02…`, RGB; alpha conferido à parte — 0 divergências RGBA), a edição única
altera exatamente as quatro posições previstas, a escrita confina ao slot, o BPS
re-aplicado reproduz o hash da cópia e os negativos são asserções.

Duas coisas só apareceram porque a interface mediu, não o núcleo:

- **Zoom desenhado ≠ zoom pedido.** O preflight (`img { max-width: 100% }`) com o
  item de flex encolhendo achatava só a largura: pedido 4x, uma camada de 120x72
  desenhava 193,66x288 px, o pixel deixava de ser quadrado e `pixelated` perdia o
  efeito. Travas: `maxWidth: none`, `shrink-0` no envolucro e trilho com
  `overflow-x-auto`. O E2E mede `getBoundingClientRect`; o teste unitário pinha o
  contrato de CSS que o produz.
- **Ordem das guardas da transação.** A identidade era conferida depois da
  varredura dos candidatos: com o caminho apontando para outra ROM, a recusa
  demorava mais de 60 s e vinha como "recurso não verificado nesta ROM" — o
  sintoma, não a causa. Agora a identidade abre a sequência e o custo da recusa é
  um hash; a perna 11 assere a recusa em `<=1,5 s`.

Os dois negativos que a UI **não** alcança nesta fixture, por construção (a
referência inválida e o banco sem cores vivem em `ctx_ghost`, que não tem struct
`Image`), continuam provados no núcleo:
`composicao_recusa_referencia_fora_do_tileset_em_vez_de_pintar_ruido` e
`composicao_recusa_banco_que_a_paleta_nao_tem_cores`. Evidência, hashes por
arquivo e limites: `data/rex_profiles/integrator/context_fixture/evidence/2026-09-27-interface/manifest.json`.

### O aceite pode falhar? (conferência por mutação)

Passar na primeira execução não prova nada por si. Cada afirmação foi mutada e o
aceite morreu na perna certa, com o baseline verde antes e depois:

| mutação | o que quebra | mensagem |
|---|---|---|
| leitura da fonte também espelhada (flip duplo em `compor_camada`) | reconstrução da camada | "a prévia composta divergiu do esperado autoral (flip, banco ou transparência)" |
| `fonte_do_ponto` sem flip | clique em célula flipada | "clique em (0,3) não atingiu o pixel da fonte previsto" |
| escala de cor `v*36` (a convenção antiga) | paleta | "cor do banco 0 índice 2: a escala do produto divergiu do fixture" |
| `md_write_pixel_index` com paridade de nibble trocada | edição | desfecho `noop` em vez de `applied` |

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
- **Só há um tipo de associação composta no SDK pinado.** `inc/vdp_bg.h` declara
  `Image = { Palette*, TileSet*, TileMap* }`; `TiledImage` **não existe** no
  SGDK 2.11 (0 ocorrências em `inc/`). Portanto "cadeia" aqui é esse struct e
  nada mais — inventar um segundo formato de vínculo seria inventar o SDK.
- O perfil vale para **este** toolchain pinado (rescomp.jar `502a4670…`,
  apj.jar `2d8cdc63…`, libmd.a `ef904a37…`). Não generalize para outras ROMs nem
  para outra versão do SGDK sem reconstruir e re-medir.
