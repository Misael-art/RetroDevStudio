# Estado da rodada REX — perfis de endereçamento e codecs

Registro vivo do integrador. Matriz honesta por capacidade: `blocked`,
`fixture` (prova sintética autoral) ou `verified` (evidência registrada em
`data/rex_profiles/*/evidence/`). Nada aqui é badge único verde; cada célula
cita a evidência ou o bloqueio exato. Contratos: `CONTRACTS.md` (v1).

## Regras de execução e job pesado (dono: integrador)

- Host snapshot da rodada: 8 CPUs lógicas, 14 GiB RAM. Antes de cada job pesado,
  reavaliar memória disponível e swap; com menos de ~3 GiB disponíveis ou
  crescimento persistente de swap, adiar.
- **Um único job pesado por vez** (Rust/SGDK/Ghidra/Tauri/WebDriver/build
  completo). O dono da execução é o **integrador**; A e B não iniciam
  compilação completa por conta própria e pedem janela aqui.
- A/B fazem leitura, fixtures e testes pequenos e isolados na própria saída;
  nunca escrevem no ledger comum nem em arquivos de IPC/UI/manifests comuns.
- Não matar processos alheios; não limpar corpus; corpus é somente leitura
  para A/B (caminho canônico `data/canonical-local-2026-09-21/corpus/`).
- Janela atual: (preenchida pelo integrador ao reservar/executar).

## Matriz de endereçamento (propriedade: agente A)

| Perfil | Especificação | Fixture | Implementação ref. | Negativos | Corpus |
|---|---|---|---|---|---|
| MD linear | blocked | blocked | blocked | blocked | blocked |
| MD SSF2 | blocked | blocked | blocked | blocked | blocked |
| SNES LoROM | blocked | blocked | blocked | blocked | blocked |
| SNES HiROM | blocked | blocked | blocked | blocked | blocked |
| SNES ExHiROM | blocked | blocked | blocked | blocked | blocked |

Endereçamento não implica codecs da plataforma nem compilação de lógica
recuperada; estados separados.

## Matriz de codecs (propriedade: agente B; LZ4W integrado pelo integrador)

| Codec | Variante fixada | Vetores+holdout | decode vs ref | encode vs ref | Negativos | Recurso real |
|---|---|---|---|---|---|---|
| aPLib | blocked | fixture (PR #79, agente B) | blocked | blocked | blocked | blocked |
| LZ4W SGDK | verified (SGDK MIT, prev-block + self-contained) | fixture (golden autorais) | verified (desempacotador 68000 oficial sob MAME + lz4w.jar nas duas direções) | verified (o 68000 reproduz byte a byte cada stream dos casos medidos — **pelos dois caminhos do encoder**: entrada DP-first e caminho de escrita com orçamento de espaço; 14 casos em r15) | verified (truncated/invalid-reference/overflow/excessive-output/work-limit/dicionário/fronteira 16384-16385-16386) | verified (corpus HAMOOPIG, ver cadeia) |
| Nemesis | blocked | fixture (PR #79, vetores nemcmp) | blocked | blocked | blocked | blocked |
| Kosinski | blocked | blocked | blocked | blocked | blocked | blocked |
| Enigma | blocked | fixture (PR #79, vetores enicmp) | blocked | blocked | blocked | blocked |

LZ4W implementado no produto em Rust canônico (`src-tauri/src/tools/reverse/
decomp/rex_codecs.rs`): decode com dicionário prev-block (port do unpacker
oficial, ROM-source com offsetAdj) e **dois caminhos de encode** sobre o mesmo
formato e a mesma janela (`0x4000` words, teto de 128 candidatos, lazy matching) —
DP de custo explícito com orçamentos determinísticos (`..._explained`, o que o
benchmark mede; acima do orçamento cai no guloso sem falha e sem stream inválido)
e política com orçamento de espaço (`..._fitting`, o que a transação escreve:
guloso quando já cabe, DP como resgate). Relógio não entra em nenhum critério:
os bytes não podem depender da velocidade do host. Dois oráculos externos, em
níveis diferentes: `lz4w.jar` v1.43 (referência Java de 32 bits, nas duas
direções) e o **desempacotador 68000 real** (`tools_a.s` do SGDK 2.11, montado e
executado sob MAME 0.289) — o segundo é o padrão do alvo, porque é o código que
roda no console. Evidência, derivação do teto e limites em `LZ4W_68K_ORACLE.md`;
33 testes de LZ4W na suíte do lib + aceites ignoráveis (bench congelado, piso,
aceite BYOR e aceite do fixture).

aPLib — **decoder em Rust canônico existe e aceita os vetores pinados; nada
promovido nesta matriz**. O consolidado do que existia antes da frente (evidência
TiledImage da agente A em `codex/rex-a-addressing`, pacote de contrato e vetores
da agente B em `codex/rex-b-codecs`, hash agregado `3a9d7e9e…` recomputado da
árvore de B, os 9 goldens byte-idênticos entre os dois namespaces) e a ordem de
aceite estão em `APLIB_TILEDIMAGE_PROXIMA_PROVA_2026-09-26.md`, com adendo datado
registrando o que a frente executou.

Estado do produto (medido, não alegado): `aplib_decode` + `AplibLimits` em
`src-tauri/src/tools/reverse/decomp/rex_aplib.rs` (variante SGDK **raw sem header
`"AP\0"`**), 9 testes na suíte do lib aceitando as 8 duplas de oráculo, os 9
goldens com `bytes_consumed` exato (o discriminante `g08`), os 7 negativos com o
erro estruturado próprio e os 3 limites de política (`work_limit`,
`excessive_output`, `overflow` por gamma2 sem fim); `verify_aplib_resource` em
`rex_resources.rs:148` liga o codec à cadeia de recurso (recusa `compression !=
Aplib`, exige `expected_len`, decodifica **sem dicionário**) com 3 testes
sintéticos, e a via LZ4W continua recusando header APLIB (teste
`verify_lz4w_resource_continua_recusando_header_aplib`) — os dois codecs não se
alcançam entre si.
Vetores importados para namespace próprio do integrador
(`data/rex_profiles/integrator/aplib/vectors/`, 49 arquivos, `manifest.json` com
SHA por arquivo e o hash agregado) e a **cópia em `codecs/aplib-golden/` da
agente A não foi adotada**: o pino único é o do integrador.

Descoberta da frente (bug de produto, corrigido em `d10d5ab`): o token `110` não
gravava o histórico de offset, então o rep-match seguinte reusava offset
obsoleto. Os 49 vetores importados passaram **todos** com o bug — nenhum deles
coloca um rep-match depois de `110`/`111`; a regra nunca esteve no contrato de B
e só aparece em stream real. Arbitragem feita por dois decodificadores de
referência independentes (`apultra` `8f340057…`, Zlib, e `apj.jar` SGDK v2.11
`2d8cdc63…`), os dois concordando com o JS da agente A (`aplib.mjs`, conteúdo
`62425497…`): no TileSet APLIB real do alvo visível o stream frameia certo
(`4485 → 16000`) e **703 dos 16 000 bytes** saíam divergentes antes da correção.
Os dois casos ficaram pinados como vetores discriminadores em
`data/rex_profiles/integrator/aplib/discriminating/` (`rep_after_cmd110`,
`rep_after_short111`; SHA por arquivo e receita de reconstrução em `ORIGEM.md`),
cobertas pelo teste `aplib_rep_match_depois_de_110_e_de_111_usa_o_offset_correto`
— não-vacuidade provada removendo a correção: só esse teste cai.

Aceite BYOR da frente (`#[ignore]`, nunca `return` silencioso) no teste
`byor_aplib_decodifica_os_dois_streams_do_tiledimage_visivel`: ROM `558bea6c…`,
TileSet `0x21b44` → stream `0x2e4d4` com `bytes_consumed` 4485 e plain de
`16000 B` (`dd7affc3…`); TileMap `0x21b4c` → stream `0x2d534` com 1196 e
`2240 B` (`c196aa5b…`); e a separação estrutural `0x2d534 + 1196 < 0x2e4d4`.
Repetido por perna independente em JS
(`scripts/rex_profiles/integrator/aplib/byor_cross_check.mjs`). **O que isso não é**: não é reconstrução visual no produto (os 95,90 % de
correspondência por pixel continuam medidos só em JS pela agente A), não é
identificação automática (os dois endereços vêm do header lido, e identificação é
capacidade separada de decode), e a paridade bidirecional do CONTRACTS §4 está
fechada nas duas pernas (registro abaixo). Reinserção em slot, porém, ainda
**não**: `reinsert` em `rex_resources.rs` é caminho exclusivo de LZ4W, então
nenhum recurso APLIB da ROM é "editável sem expansão" pelo produto hoje. Ligar o
encoder a essa via é o próximo passo de frente, e continua sem autorização para
expandir ROM nem realocar ponteiros. Promoção de maturidade fica com o operador;
a célula acima permanece `blocked` por decisão de missão, não por falta deste
registro.

Encoder aPLib em Rust canônico (2026-09-26, frente do integrador).
`aplib_encode(data, &AplibEncodeLimits { max_stream, max_work })` na variante
**raw sem header**, com os erros do vocabulário de CONTRACTS §4 e nada além
disso: `needs_space` citando os três números (plain, stream produzido,
orçamento), `work_limit` quando o orçamento de operações estoura no meio do
parse sem deixar stream inválido, `overflow` para o que o formato não expressa
(entrada de 0 byte, entrada acima de 2^32 posições). Quatro incrementos, cada um
com teste próprio antes do código: `632c195` guloso + `needs_space` honesto;
`745dc59` cobertura de offsets distantes (índice hash/chain de chave exata de 2
bytes, `1024` candidatos por posição, marca d'água que indexa também as posições
cobertas por match); `3a3db96` rep-match reusando o offset do último match;
`19bc865` token `111` (cópia de 1 byte a offset ≤ 15 e `0x00` órfão).

Capacidade real medida, não estimada, por mesa de tokens
(`scripts/rex_profiles/integrator/aplib/token_dump.py`: o custo por token soma
com o rabo não usado dos bytes de tag e dá exatamente o stream consumido, e isso
vale para os 35 streams bem-formados do acervo — 9 goldens, 16 de dois oráculos
sobre 8 plains, 2 discriminantes, 8 dumps do produto — com zero falha; os 7
negativos são recusados cada um pelo motivo estrutural que o define). Resultado
em 2026-09-26: **7 das 8 mesas de tokens são idênticas às dos dois oráculos**
(`apultra` e `apj.jar`) — contagem por tipo, plain produzido e custo. A única
divergência é `noisy_runs_16k`, 1364 B contra 1205 B do oráculo, e a mesa diz o
porquê em números: o produto paga **+433 B** de `match-10` (305× a 3,36 B contra
179× a 3,31 B) para economizar 272 B entre literais e rep-matches (127× vs 241×,
123× vs 210×). É escolha de parse do guloso — o oráculo encurta um match, paga um
literal de 9 bits para rearmar LWM a 3 e emenda um rep-match de 1,58 B, onde o
produto paga o `match-10` inteiro com byte de offset — e não token indisponível.
Os oito números estão congelados por igualdade em
`aplib_encode_tem_a_capacidade_medida_congelada_por_plain` (pino ≠ alvo; mexer na
qualidade muda pino, e mudar pino é decisão registrada).

Paridade bidirecional de CONTRACTS §4: perna 1 (`decode` do produto sobre stream
do oráculo) verde nos 8 plains × 2 oráculos, mais os 9 goldens com
`bytes_consumed` exato; perna 2 (`decode` do oráculo sobre stream do **produto**)
verde em 8 de 8 **contra cada um dos dois oráculos** — 16 aceitações por
`scripts/rex_profiles/integrator/aplib/oracle_encode_parity.py`: `apultra` v1.4.8
`64be2a7a…` (C, Emmanuel Marty) e `apj.jar` v1.32 do SGDK 2.11 `2d8cdc63…` (Java,
Stephane Dallongeville, o empacotador que gerou os `plain/*.apj.ap`), duas
implementações independentes entre si e do produto, devolvendo para cada stream do
produto exatamente o plain pinado no `manifest.tsv`. Não-vacuidade provada com um
controle por ramo do aceite, nos dois oráculos: bit invertido na tag de
`tile_like` → o oráculo recusa e o script sai FAIL com rc=1; literal físico
(byte 0) corrompido em `text_rep` → o oráculo **aceita** e produz 6000 B, e o que
aponta FAIL é a comparação de hash. Ou seja, o que fecha a prova não é o código de
saída do oráculo, nem ele ter devolvido alguns bytes. **O que continua não alegado**:
optimalidade (não houve comparação exaustiva com parse ótimo, e o `111` economiza
2 bits mas não chega a encolher stream em `ABCDA` nem em `01 00 02` — ele estoura
o tag e cobra um tag extra), desempacotamento dos streams do produto pelo
desempacotador 68000 real sob MAME (esse oráculo só existe para LZ4W hoje),
reinserção em slot e reconstrução de TiledImage dentro do produto.

Duas divergências continuam registradas em vez de resolvidas por alegação: (a) a
linha aPLib desta matriz diz `variant-fixed: blocked` enquanto o `manifest.json`
de B diz `"variant-fixed": "verified"`; (b) o próprio CONTRACTS v1 é inconsistente
sobre o caminho — §1 pede `data/rex_profiles/<kind>/<profile_id>/`, o que dá
`codec/aplib/` (foi o que B publicou), enquanto a cláusula de propriedade declara
`data/rex_profiles/codecs/` para B (foi onde A copiou os goldens). Resolver é
atribuição do integrador e exige v2 com justificativa, não edição silenciosa. O
que a frente fez na prática, com registro: o produto pinou **um** conjunto próprio
(`data/rex_profiles/integrator/aplib/`), sem editar o namespace de B nem o de A.

O decoder distinguia antes a janela de busca do compressor (`0x4000`) do limite
do formato e recusava o último offset que o 68000 ainda lê para trás. Medido no
hardware: teto real `16385` words (`value 0x4000`), divergência silenciosa a
partir de `16386` (`value 0x3FFF` ⇒ leitura PARA FRENTE, aliassa a ROM), `value
0x0000` = offset 1 válido. Corrigido em `13a5792` com goldens calculados à mão e
com um andador de tokens que exige que todo offset emitido caiba na janela
legível.

## Cadeia de recurso comprimido (propriedade: integrador)

| Etapa | Status | Evidência |
|---|---|---|
| ROM -> origem verificável | verified (assistido, rotulado) | scan estrutural de headers TileSet + decode exato `numTile*32` com dicionário = prefixo da ROM; aceite BYOR `byor_hamoopig_chain_original_noop_modified_and_patch` |
| decode | verified | 160/191 streams LZ4W do corpus HAMOOPIG congelado decodificam com tamanho exato; o recurso do alvo e os casos sintéticos do encoder atual reproduzem **byte a byte no desempacotador 68000 oficial** (`LZ4W_68K_ORACLE.md`) |
| prévia | verified | `render_resource_png` chunky 4x no produto com pixels SHA-256 e comparação independente; exibida na aba "Recursos comprimidos" |
| edição | verified (via UI) | formulário pixel (tile/linha/coluna/índice) + transação canônica; no-op com zero edições pela mesma UI |
| encode | verified (com benchmark de capacidade congelado) | re-codificação com dicionário dentro do espaço original; busca de candidatos do dicionário e da saída **mesclada por proximidade** (mesmo teto de 128, mesma janela, mesmo lazy) levou o fixture de 448→**444 B, byte a byte o stream do `rescomp`** e o corpus de `folga_base` somada −13 188→**−9 156 B** (158 melhoraram, **0** pioraram, 2 empataram). Medida pela especificação congelada `scripts/rex_profiles/integrator/lz4w_recompress/BENCH_SPEC.md` com split de validação `índice % 5`; needs_space honesto nos demais; 159/160 recursos preservados na transação. **Capacidade real medida, não prometida**: com esse ganho continua havendo **1/160** recurso com folga não negativa (`0xc8cc8`, +2 B) e a bateria amostral (24 bits/recurso) só encontra bit cabível ali — a edição canônica de 1 pixel custa 146 B contra slot de 144 B. *(número de r4; a célula termina em r7 abaixo com 7/160)*. Causa e leitura em `LZ4W_ENCODER_444_VS_448_2026-09-26.md` §4.1; evidência `data/rex_profiles/integrator/lz4w-recompress/evidence/2026-09-26-r{1,2,3,4-final-pin}/` (r1 = linha de base pinada em `656bdc9f…`, r4 = pino final `bee8524f…`). **Piso medido (emenda §9, rodada r5):** um DP de custo explícito validado contra busca exaustiva (1 165 entradas) dá stream menor que o produto em **160/160** recursos do corpus — soma **9 394 B**, mediana 56 B, máximo 150 B, **zero empates e zero perdas**; no fixture autoral o piso é exatamente os 444 B que o produto já emite (gap 0, e o `rescomp` do SGDK também está ali). Consequência: **125/160** recursos teriam o plain não-editado cabendo no slot contra o parse ótimo (hoje 1), e a folga agregada do corpus passaria de −9 156 B para **+238 B** (o déficit agregado desaparece, mas a sobra não é uniforme: 35 recursos continuariam sem caber). Isso é margem de *parsing*, medida no plain sem edição, decodificada pelo decoder do produto (161/161) — não é editabilidade provada nem replay 68k feito; evidência em `data/rex_profiles/integrator/lz4w-recompress/evidence/2026-09-26-r5-floor-dump/` e leitura em `LZ4W_ENCODER_444_VS_448_2026-09-26.md` §6. **INCREMENTO INTEGRADO (rodada r7, pino `6044135b…`, commits `cde88cc`+`8a22689`):** o DP de custo explícito entrou no produto e a medição foi **refeita no pino final** (`.../evidence/2026-09-26-r7-final-pin/`). Antes/depois r5→r7 no benchmark congelado, recurso a recurso: **160 melhoram, 1 empata, 0 pioram**; gap sobre o piso **9 394 → 3 602 B (−5 792, 61,7 % fechado)**; folga somada S-B **−9 156 → −3 364 B**; recursos com folga não negativa **1 → 7**; `ja_cabe` **2 → 8** com **6 transições para a frente e nenhuma para trás**; bateria §4-edita `cabe` **2 → 20** e `needs_space` **523 → 505** com a coluna no-op intacta em 119; coube na amostragem de ajuste **1 → 5** e na de validação **0 → 1** (o split de validação nunca serviu de sintonia). Consequência operacional no recurso real: a edição canônica de `0xc8cc8` passou de 146 B (estourava o slot de 144) para **144 B, cabendo no próprio slot**, lida byte a byte pelo desempacotador 68000 oficial (`lz4w-68k/evidence/2026-09-26-r15`, caso `i40`) — sem expansão de ROM e sem tocar vizinhos. **Achado que mudou o desenho — pegada de escrita ≠ comprimento:** o guloso é parse *local* e a DP é *re-parse global*; como o dicionário de um recurso é o prefixo que o antecede na ROM, a pegada larga da DP altera dependentes. Com "DP sempre que coubesse", a varredura de `0xc8cc8` caiu de `fit=4 aplicados=4` (HEAD) para `fit=60 aplicados=56` — 4 recusadas por `dependent_modified`, não por tamanho. Por isso a transação escreve por **orçamento de espaço** (`..._index_fitting`: guloso se já cabe, DP como resgate) e só o *benchmark* mede DP-first: onde o guloso cabia o produto escreve os mesmos bytes de antes (provado em `i41`, SHA `2776ec2c…` idêntico ao do pino só-guloso); onde não cabia, ganha o resgate. **Teto do incremento (não chamar de ótimo):** 3/161 recursos atingem o *comprimento* do piso e **0/161** emitem os *bytes* do piso, porque o modelo de piso ignora o teto de 128 candidatos por posição que o produto aplica; provado é "≤ guloso em 161/161, estritamente menor em 160". **E 'editável' não é 'compreendido':** `0xc8cc8` continua `BLOQUEADO` quanto ao que representa — a medição afirma comprimento e decodificabilidade, não semântica de tile/paleta |
| transação canônica no aPLib, na mesma ROM do LZ4W (passo 3) | verified (fixture autoral aPLib + rom mista sintética) | `verify_resource_set` verifica os candidatos dos **dois** codecs e recusa sobreposição cross-codec; `transacao_canonica` é uma só (identidade → evidência → tamanhos → no-op → re-codificação no espaço comprovado → ida-e-volta → cópia + dependentes → BPS com hash exato) e o contrato de histórico viaja com o recurso verificado (`RecursoEditavel`), nunca escolhido por suposição: LZ4W usa dicionário = prefixo da ROM, aPLib raw usa o próprio stream até o EOD. Nenhuma validação LZ4W foi removida; `verify_lz4w_resource_set` segue existindo e os testes dele seguem verdes. A fronteira de produto (`list_resources` → `preview_resource` → `apply_resource_edit`) agora rotula e despacha pelo codec do header: `ui_edite_recurso_aplib_pela_mesma_fronteira_do_lz4w` abre a ROM mista, acha `["lz4w","lz4w","aplib"]`, edita 1 pixel do aPLib (tile 64, 3, 4 → 15), escreve `rex-aplib-modified-*`/`rex-aplib-patch-*` com os SHA declarados conferidos no disco, preserva os **2** LZ4W e re-prévia da cópia bate com a prévia da edição. **Medido, não assumido (ver checkpoint 2026-09-27): slot de `tile_like` tem paridade exata (41 B) e o menor custo de edição de 1 pixel é +3 B, então nenhum recurso com slot assim tem espaço comprovado; a fixture de edição usa `noisy_runs_16k` (1 366 B de folga 2 B → escreve 1 364 B)** |
| reinserção em cópia + patch | verified | transação no produto: identidade SHA, dependente recusado (0x91a00 dependente de 0x8ff8e), cópia + BPS exportado e re-aplicado à base com hash exato |
| efeito observado no jogo | **BLOQUEADO — classe do alvo desconhecida** | **Retratação (2026-09-26)**: a leitura "9 paletas × 16 cores" e o mecanismo "transparência tornada opaca" eram hipóteses sem evidência de consumidor — retirados do estado corrente (preservados no histórico do Memory Bank). O "efeito" anterior era ruído: o resume do loop vivo entre runs dessincronizava os frames comparados. **Sonda causal** (no E2E): com ROM/core/estado/inputs idênticos (run_frames determinístico), **nenhuma diferença foi medida** em WRAM/VRAM entre original e modificado em 900 frames (controle original/original também idêntico, o que valida determinismo e metodologia). **Precisão (2026-09-26, ETAPA C): isso não prova que o recurso não seja descompactado** — a sonda só alcança as regiões que o core expõe (`emulator_read_memory` regiões 2/3; CRAM e o destino/chamada do desempacotador ficam `missing`). Ausência de diferença observada ≠ ausência de carregamento. Consumidor não provado; **edição semântica deste recurso permanece BLOQUEADA**. Evidências de bytes: intervalo alterado [30,31), byte 30 0x00→0xF0 (pixel (0,7,4), a única edição que coube com o encoder corrigido; needs_space honesto nas demais). **Defeitos corrigidos nesta rodada**: (1) tiles são chunky (nibble empacotado), não planar — golden literal `12 34 56 78`→1..8; (2) o encoder emitia matches longos não-ROM com offset acima do que o 68000 lê para trás (janela do codificador restaurada a 0x4000 por estratégia; o teto **do formato** medido no hardware é 16385 e o decoder agora aceita até ele — `LZ4W_68K_ORACLE.md`); (3) o preview em grade lia a faixa linearmente e escondia edições fora do tile 0/linha 0; (4) verificação de ida-e-volta dentro da transação. Canvas do app == framebuffer do core comprovado como capacidade separada (subimagem 256×192 ou 320×224 conforme o estado). Varredura dos 18 recursos com tiles em tela: fit=0 no orçamento do tile 0 (needs_space honesto) |
| efeito demonstrado em **fixture autoral** (ETAPA D) | verified (mecanismo) | ROM Mega Drive autoral construída aqui (`scripts/rex_profiles/integrator/lz4w_fixture/`, SGDK 2.11, `TILESET ... LZ4W NONE`, SHA da ROM `159298eb…`), onde a cadeia de consumo é conhecida **por construção** (`unpackTileSet` -> `VDP_loadTileSet` -> `VDP_fillTileMapRectInc`, tile `t` numa única célula `(t%4, t/4)`). O aceite `--ignored` percorre a cadeia real do produto: decode == fonte recomposta; no-op honesto; **linha de base medida antes da busca** (`slot(rescomp)=444B` vs `re-codificação do plain não-editado=448B`, folga `-4B`); edição de 1 pixel **prevista antes de qualquer emulação** (`tile 0, row 5, col 7 -> idx 15`, re-encode 440B **dentro** do slot de 444B) aplicada pela transação canônica; ROM modificada reaberta e re-decodificada == plain planejado; coordenada de tela prevista `(7,5)` e prévia renderizada (SHA dos pixels/PNG). O stream **escrito pelo produto** desempacota no 68000 oficial: `data/rex_profiles/integrator/lz4w-68k/evidence/2026-09-26-r13/runs/runF` (`i30` rescomp, `i31` produto) ambos `68k == jar == esperado` em 512B. **Discriminante negativa preservada**: no fixture **sem** plantio, varredura exaustiva dos 15.360 candidatos de 1 pixel deu `0 cabem` (`.../lz4w-fixture/evidence/2026-09-26/fixture-acceptance-exhaustive-before-plant.log`). **Por que o plantio é necessário e isso não é trapaça**: o LZ4W casa **words de 16 bits**, não pixels; uma edição de 1 pixel só encurta o stream se tornar dois words adjacentes idênticos. O gap de codificador foi medido duas vezes (444/448 e 378/380) e **não** foi escondido: o porte do DP ótimo de `LZ4W.java` foi implementado, ficou verde no suíte e **piorou** (382B vs 380B) — revertido em vez de entregue; um DP fiel precisa de estado `(posição x literais pendentes mod 15)` porque o custo de 1 palavra/token ignora o chunk de 15 literais. Limite honesto: prova de **mecanismo**, não de cobertura de alvos reais; a tela do app foi capturada por emulação na ETAPA E (ver linha seguinte) |
| efeito causal demonstrado **na aplicação** (ETAPA E) | verified (fixture autoral) | cenário E2E `rex-lz4w-fixture-effect` (`scripts/e2e-tauri-build-run.mjs`) rodando o binário real `e6907792…` e o core oficial Genesis Plus GX v1.7.4 `46a5521`: descuberta+decode **pela UI** (header 95464, stream `0x5f988`, slot 444 B, `1/5 candidatos`), no-op honesto, edição de 1 pixel aplicada pela transação canônica (modificada `e55dba92…`, BPS `52ce036f…` 74 B, 268 bytes distintos, faixa `5f9a1..5fb3f`, `diferenteForaDoSlot:0`), BPS re-aplicado reproduzindo o hash exato, cópia reaberta decodificando no plain editado (`917048cc35508e9a`), **prova de memória** em WRAM (1 byte, `0x5e f0→ff`) e **exatamente 1 pixel de tela diferente na coordenada prevista (7,5)** com as classes de cor certas (`0x212021 → 0x8c008c`, 11 classes), canvas == framebuffer do core (320×224), e os dois negativos alcançáveis: guarda de intervalo da fila (0 entradas, 0 escritas, com controle positivo enfileirando 1) e `rom_identity_mismatch` por TOCTOU com a ROM do fixture verificada intacta. Verde duas vezes com o código final (run10/run11, rc=0 lido nos próprios logs). Pacote promovido com manifesto vinculado ao binário: `data/rex_profiles/integrator/lz4w-fixture/evidence/2026-09-26-e2e/` (`manifest.json`). **Limitações medidas, registradas como não provadas e não como sucesso**: (a) o core não expõe `VIDEO_RAM` (`retro_get_memory_size==0`, mas `emulator_read_memory` responde `ok:true` com dados vazios — armadilha de prova vacuada), então a perna de VRAM fica `observed:false`; (b) a fusão de DAC do Mega Drive reduz as 16 palavras de paleta autorais a **11 cores** — índice→cor é função, não injeção, portanto a identidade do pixel alterado é estabelecida por **posição** e a cor só confirma a classe (`scripts/rex_profiles/integrator/lz4w_fixture/analyze-frame.py`); (c) a recusa de intervalo do **núcleo** é inalcançável pela UI (o painel descarta `editTile >= num_tiles` no cliente, `CompressedResourcePanel.tsx`), e por isso está provada no teste unitário `apply_rejects_tile_outside_resource_without_writing`, não no E2E. **Emenda (2026-09-26, PASSO 4)**: o descarte era **silencioso** — agora `editRejectReason` explica o motivo no painel (`rex-resource-notice`) e no log da ferramenta, preserva a fila válida e não envia o candidato inválido; a guarda do núcleo segue sendo a definitiva (testes `tile fora do recurso: avisa…` e `linha, coluna e índice inválidos…`). Isso não torna a recusa do núcleo alcançável pela UI: continua provada no unitário. (d) as duas corridas rc=0 **leram a ROM de `/tmp`** (`fixture.romPath` no relatório do run11; o cenário consome o que `RDS_REX_LZ4W_FIXTURE_ROM` apontar e não reconstrói o fixture sozinho) — o caminho durável devolve o mesmo SHA `159298eb…` (`fixture-rebuild-report.json`, reconferido por `sha256sum`), então a entrada é reprodutível a partir do repositório, mas não foi o arquivo do repositório que as corridas registradas abriram. Nada aqui altera o alvo comercial: `0xc8cc8` continua `BLOQUEADO`. **REEXECUTADO no pino novo (rodada r8, `.../lz4w-fixture/evidence/2026-09-26-e2e-r8-new-pin/`):** cenário completo reconstruído e verde (`rc=0`, 11 passos) no binário `e36f9f49…`, com `rex_codecs.rs @ 6044135b…` + `rex_resources.rs @ d8477608…`. A ROM do fixture foi lida do **caminho durável do repositório**, então a limitação (d) acima não se aplica a esta corrida. Novos números da escrita: modificada `07905193…`, BPS `c3bc1e94…` (62 B, 264 bytes distintos, faixa `5f9a1..5fb3b`, `diferenteForaDoSlot:0`), pixels `917048cc…` inalterados. **Triangulação que não existia:** os 436 B que a UI escreveu neste binário têm SHA-256 `2776ec2c…` — IDÊNTICO ao stream do caso `i41` que o desempacotador 68000 leu em hardware; UI→ROM, driver→MAME e decoder do produto agora apontam para os mesmos bytes. **Por que os hashes mudaram em relação ao run11:** `39c0fd9` (incremento r1→r4, já publicado) mudou a codificação gulosa do fixture — o run11 escrevia `47cfeb81…` no mesmo comprimento; NÃO é efeito deste incremento, e a equivalência de plain entre os dois streams não foi aferida (só o do run2 tem prévia conferida). **Achado de processo (falha minha, registrada com o log da corrida falha):** o negativo de intervalo do cenário ainda exigia o literal antigo `0 edição(ões)` e apodreceu quando `6351f15` passou a renderizar "nenhuma edição pendente" — o E2E não fora reexecutado desde então. O passo 10 agora exige as duas coisas que o contrato do PASSO 4 promete: fila vazia **e** aviso explicando o descarte; a recusa do núcleo segue provada no unitário. **Relatório técnico:** `docs/rex_profiles/RELATORIO_ETAPA_E_2026-09-26.md` |

Limitações declaradas: identificação é estrutural assistida (header declara
codec e tamanho), não descoberta automática geral; stream editado recusado
quando outros recursos dependem dos bytes originais (equivalência global de
decode verificada no teste); sem expansão de ROM, realocação ou edição de
ponteiros no v1.

Propriedade e integração (2026-09-26): as suítes da agente-A e da agente-B
continuam **não integradas** a este tronco — seguem nos worktrees de cada uma.
Do que a B produziu, o integrador apenas **vendorou a ferramenta de medição**
(68k + jar + MAME) com proveniência e SHA-256 por arquivo em
`scripts/rex_profiles/integrator/lz4w_68k/PROVENANCE.md`; nada de lá entra no
produto. Evidência do integrador vive em namespace próprio
(`data/rex_profiles/integrator/…`), sem invadir os namespaces `addressing/` (A)
e `codecs/` (B) do CONTRACTS v1.

## Histórico da rodada

- 2026-09-27 (integrador, **PASSO 4 — o alvo BYOR reconfirmado e a edição-alvo
  escolhida por medida; PASSO 2 e PASSO 6 registrados**), esta célula é o
  checkpoint. **HEAD de partida:** `d0a3426`, sobre os commits da mesma ordem
  (`48562b7` passo 1, `56faf0d`/`41a05b6`/`c631a1f` passo 3, `0ef7a66`, `97208e1`).
  **Alterações não commitadas antes deste entry:** `rex_resources.rs` (varredura +
  pin) e `scripts/rex_profiles/integrator/aplib/survey_tiledimage_refs.py` (novo).
  **Hipótese testada:** o bloqueio registrado no passo 6 anterior ("nenhuma edição
  do TileSet visível cabe: 4 544 > 4 485") é escolha de recurso, não limite da
  rodada — medido em todas as cadeias em vez de aceito.
  **Instrumento:** o censo das cadeias TiledImage reusa o
  `token_dump.desmonta` do aceite do decoder em vez de reimplementar um segundo
  desempacotador (`832b558`); a ROM comercial continua fora do repositório e o
  script exige `--pin-sha256`. **O que ele mediu nesta ROM** (917 504 B,
  `558bea6c…`): 31 headers com `compression == 1`, dos quais **4** o
  desempacotador fecha no comprimento anunciado — `0x21b20` (100 tiles, stream
  `0x2e12a` 938 B, plain 3 200 B), `0x21b44` (500/4 485/16 000), `0x21b68`
  (543/7 420/17 376), `0x270de` (96/609/3 072). Cada um dos três primeiros é
  apontado por **exatamente um** `TiledImage` (`0x21b38`, `0x21b5c`, `0x21b80`);
  o `0x270de` — o do `font_08x08`, pinado na suíte como artefato da toolchain —
  é apontado por **zero**, o que é a razão estrutural pela qual a descoberta não
  o apresenta como recurso editável.
  **Evidência a favor (o que decidiu):** a varredura de edições de 1 pixel
  (`byor_varre_as_edicoes_de_pixel_que_cabem_no_slot`, `a31aecd`, 135,94 s) testou
  **61 128** edições candidatas do `0x21b20` e **30 662 cabem** no slot de 938 B
  (mais barata: 932 B). A edição pinada
  (`byor_aplib_pina_a_edicao_de_pixel_que_cabe_e_eh_observada_em_tela`, 0,09 s) é
  tile 53, pixel do tile (4,0), índice 5→0, byte 1 698 `0x55`→`0x05`, e
  **re-codifica em 937 B** — 1 B de folga dentro do slot, o stream vizinho
  começando em `0x2e4d4` intacto (a fronteira é asserção). As duas células do tile
  são `(35,16)` e `(26,25)`, com hflip, vflip e banco de paleta todos `0`, logo as
  posições previstas em tela são **(284,128)** e **(212,200)**, e as cores da
  paleta `0x2cbc8` são `0x0468` → `0x0000` — 34× a tolerância ±4/canal do
  comparador da perna A. **Por que o pixel é observado e não inferido:** os dois
  retângulos das células (`x 280..287, y 128..135` e `x 208..215, y 200..207`)
  estão inteiros dentro dos 2 938 pixels residuais que a perna A atribuiu a
  oclusão total nesse checkpoint (evidências citadas por SHA no próprio teste:
  `dbdc122:docs/rex_profiles/lz4w/VISIBLE-RESOURCE-EVIDENCE.md` =
  `ac850f420f1fd8f6d1d3aa46e1f0c11badbe9b8cbbf55d889e9f58b252c8f0c8` e
  `dbdc122:data/rex_profiles/lz4w/residual-attribution-cp129.json` =
  `febb6d0edded4b9e206145ead7abe5a3258de8f15067b588eda7354b5fb02ed5`).
  **Evidência contra / limites honestos:** a pin não executa o jogo — re-derivada
  a comparação de quadro, ela vale como *escolha de alvo com custo congelado*, e a
  reexecução da atribuição é tarefa do passo 5, não alegação desta célula; o
  plain, o slot, as colocações e o custo de 937 B viraram asserções para que
  mexer neles seja decisão registrada e não drift.
  **PASSO 6 (limites) encerrado sem tocar o encoder:** nenhum dos dois
  orçamentos (`max_stream`, `max_work`) foi alterado, o benchmark congelado
  (`PINOS`) e o registro de capacidade de 2026-09-26 continuam os mesmos números,
  e não houve expansão de ROM nem realocação de ponteiros — a folga veio de
  escolher outro recurso real, que é exatamente o que a ordem autorizava.
  **PASSO 2 (CI registrado por SHA, sem usar verde de HEAD anterior):** em
  `d0a3426` o workflow `CI` (run 865, id `36295381790`) fechou **success** nos dois
  jobs (`linux-validate`, `validate`); `Desktop E2E` (run 748, id
  `36295381781`) fechou **failure** em `desktop-smoke`, cenário `reference_goal`.
  Não atribuído a este trabalho por duas linhas independentes: a asserção que cai
  (`scripts/e2e-tauri-build-run.mjs:5253`) está fora de todo o diff da rodada, e o
  mesmo passo estourou orçamento de tempo em corridas disparadas por commit
  **só-documentação** (`36250323843`; também em `135bda2`/`d0744b0`). Registrado em
  vez de escondido; nenhum `--no-verify`, nenhuma nova corrida para mascarar.
  **Gates desta árvore:** `cargo test --lib` **706 passed / 0 failed / 59
  ignored**; `cargo clippy --lib -- -D warnings` limpo; `cargo fmt --check` OK.
  **Matriz:** linha aPLib **não promovida** — a célula "Recurso real" continua
  `blocked` até existir execução do recurso modificado pelo desempacotador do jogo;
  missão veta merge, release e promoção de maturidade.
  **Próximo comando:** passo 5 pelo produto — abrir a ROM, selecionar o recurso do
  stream `0x2e12a`, pré-visualizar, aplicar a edição pinada, salvar e reabrir,
  exportar BPS, reaplicar sobre cópia íntegra e **executar**, comparando
  original×original, no-op e modificado com estado e entradas iguais; o oráculo
  decisivo é o desempacotador do próprio jogo sob o core, não os dois oráculos de
  host. Fixar ROM, core e app exercitados. **Bloqueio:** nenhum externo.

- 2026-09-27 (integrador, **PASSO 3 — aPLib na transação canônica e na fronteira
  de produto, preservando LZ4W**), esta célula é o checkpoint.
  **HEAD de partida:** `48562b7` (passo 1, gate de paridade endurecido) sobre
  `4a389ff`/`cb8557c`/`290c8ec`. **Alterações não commitadas antes deste entry:**
  `rex_resources.rs` (transação), `CompressedResourcePanel.tsx` +
  `toolsService.ts` + teste do painel (UI). **Hipótese de trabalho:** a
  reinserção do aPLib não pede arquitetura nova — pede que a sequência de guardas
  existente aceite um segundo *contrato de histórico*, e que a UI deixe de
  pressupor LZ4W.
  **O que foi implementado:** `TransactionLimits` (três orçamentos: decode/encode
  aPLib + LZ4W), `RecursoVerificado` (enum que carrega o recurso verificado e o
  próprio contrato), `verify_resource_set` (varre candidatos dos dois codecs,
  ignora quem falha na verificação e **recusa sobreposição cross-codec** com
  `invalid_reference`), `RecursoEditavel::{desempacotar, recodificar_no_espaco}`,
  `transacao_canonica` (as sete guardas em uma só sequência) e
  `reinsert_transaction_aplib`; `reinsert_transaction` (LZ4W) foi **redirecionada
  para a mesma função** sem perder nenhuma validação própria — o corpo LZ4W de
  162 linhas deixou de ser duplicado, mas `verify_lz4w_resource_set`, o dicionário
  de comprimento par, o índice de dicionário e o encaixe por orçamento de espaço
  continuam no caminho dele e são exercitados pelos testes originais.
  **Duas mudanças de semântica registradas explicitamente** (não absorvidas em
  silêncio): (1) `verified_preserved` agora conta sobre o **conjunto dos dois
  codecs**, então um `preservados N` vindo de ROM mista não é comparável
  byte-a-byte com o mesmo número de antes; (2) `analyzed_scope` passou a declarar
  o denominador por codec (`3/3 candidatos (LZ4W 2/2 de LZ4W, aPLib 1/1 de
  aPLib)`), e a asserção pré-exigente `contains("2/2")` do tronco LZ4W continua
  válida por construção desse texto.
  **Capacidade medida, com números (foi o que decidiu a fixture):** o encoder do
  produto sobre `tile_like` empata o oráculo em **41 B**, mas a menor edição de 1
  pixel custa **+3 B** (44 > 41) — ou seja, *nenhuma* edição cabe num slot de 41
  B, e isso é propriedade do codec sobre esse plain, não defeito do encoder.
  `pseudo_random_8k` empata em 294 B com delta mínimo **+1**. `noisy_runs_16k` é
  o único dos três com folga medida: oráculo **1 366 B**, produto **1 364 B**
  (2 B de folga) e existe edição de 1 pixel de custo **zero** (tile 64, linha 3,
  coluna 4, índice 11 → 15 → re-codifica em 1 364 B). A fixture de edição usa
  esses números; a de recusa usa o slot apertado de 41 B e exige que a mensagem
  carregue `41` e `8192`. Os três números saem da regeneração das mesas e do gate
  de paridade reexecutado nesta célula (`.../oracle_encode_parity.py
  src-tauri/target-test/analysis/aplib` → **esperado 16 | executado 16 | aprovado
  16 | divergente 0**, rc=0, com os dois oráculos independentes).
  **Evidência discriminante:** os cinco testes do tronco aPLib
  (`reinsert_aplib_*`) e o novo da fronteira de produto
  (`ui_edite_recurso_aplib_pela_mesma_fronteira_do_lz4w`) passam; os três
  negativos cobertos são `excessive_output` (não cabe), `dependent_modified`
  (LZ4W cujo dicionário contém a cauda do stream aPLib muda de decode) e
  `rom_identity_mismatch`/`evidence_mismatch` (evidência velha reaplicada contra
  a ROM já modificada). **Prova de que o teste do barra não é decorativo:** com a
  variante aPLib de `verify_resource_set` mutada para `None`, **6** testes falham
  (o da UI, os quatro do tronco e o do conjunto), incluindo o da fronteira com
  `a lista deveria trazer os três recursos verificados` — o mutante foi revertido
  e o suíte reexecutado. No painel, o mutante correspondente (escopo voltando a
  dizer "Recursos LZ4W …") derruba exatamente a asserção `(LZ4W 1, aPLib 1)`.
  **Achado de fixture que custou duas iterações e está registrado:** a semente de
  dependência cross-codec precisa vir da **cauda** do stream aPLib. Com a cabeça
  (32 B) a transação era aceita, porque a edição começa no tile 64 (offset 2 048
  de 16 384) e os primeiros ~170 B do stream re-codificado permanecem idênticos —
  ou seja, o guarda existia mas o fixture não exercitava dependência real.
  **Gates executados:** `cargo fmt -- --check` rc=0; `cargo clippy -- -D warnings`
  rc=0 (a primeira corrida falhou com 5 lints `doc list item without indentation`
  da minha própria doc-string numerada — corrigidos, não allowanceados);
  `cargo test --lib` **706 passed / 0 failed / 54 ignored** (699 no pino anterior
  da mesma frente + os 7 testes desta barra: 1 de conjunto, 5 do tronco aPLib, 1
  da fronteira de produto); `npm run check:tree`
  rc=0; `npx tsc --noEmit` rc=0; `npm run lint` (eslint `--max-warnings=0`) rc=0;
  `npm test` **702 passed / 6 skipped (708)**. Delta reconciliado com o número
  anterior registrado aqui (699/705): **+3**, sendo 2 do `6351f15` (os dois testes
  do aviso de descarte, abertos depois daquele registro) e 1 deste checkpoint
  (painel de ROM mista).
  **Contra-evidência / não provado:** nada aqui toca o alvo comercial. O passo 4
  (reconfirmar `0x2e4d4`/`0x2d534`/paleta no manifesto atual, derivando de novo)
  e o passo 5 (fluxo completo pelo app + execução com o desempacotador do jogo)
  seguem abertos; o E2E canônico do fixture e o aceite BYOR **não foram
  reexecutados nesta célula** e precisam ser rodados antes de qualquer alegação de
  entrega da UI. A ETAPA E continua aceita **apenas** no escopo do fixture
  autoral LZ4W. **Próximos comandos:** `npm run build:debug` e o cenário E2E do
  fixture (a UI mudou e precisa ser reexecutada antes de qualquer alegação sobre
  ela), consulta pontual do CI no SHA publicado, e o passo 4 (reconfirmar os
  offsets e a identidade no manifesto atual, derivando de novo).
  **Bloqueio:** nenhum externo. Merge, release e promoção de maturidade seguem
  fora desta missão por ordem do operador.

- 2026-09-26 (integrador, **PASSO 5 — aPLib em Rust canônico: decoder, arbitragem
  por oráculo externo e aceite BYOR**), esta célula é o checkpoint.
  **HEAD/commits da frente** em `codex/rex-integrator-aplib-decode`: `9a9b66d`
  (vetores de B importados para namespace próprio, pinados por SHA), `d27be00`
  (`aplib_decode`/`AplibLimits` + 8 testes dos vetores), `9fb2c12`
  (`verify_aplib_resource` na cadeia + 3 testes sintéticos + garantia de que a via
  LZ4W continua recusando APLIB), `d10d5ab` (correção do `110` + os dois vetores
  discriminadores + script de reconstrução + registro em `manifest.json`) e
  `a69614e` (aceite BYOR das duas streams reais + perna JS independente);
  mais este registro de documentação.
  **Alterações não commitadas após eles: nenhuma** (o `git status --short` desta
  árvore lista apenas arquivos alheios à rodada: `.mimosa/`, `APJ-unpack`,
  `a.out`, `apultra-decode`, `src-tauri/.mimosa/`, `src-tauri/src-tauri/` e
  `data/canonical-local-2026-09-21/` = corpus BYOR, nunca versionável; nenhum foi
  executado, stagingado ou apagado).
  **Hipótese testada:** um decoder que passa nos 49 vetores pinados por dois
  oráculos decodifica corretamente os dois streams APLIB do alvo visível — e,
  ao ligá-lo à cadeia, nada na via LZ4W muda.
  **Evidência a favor (medida nesta árvore):** `cargo test --lib` **687 passed /
  0 failed / 54 ignored**; `cargo test --lib -- --ignored byor_aplib` **1 passed**
  (TileSet `0x21b44` → `0x2e4d4`: `bytes_consumed 4485`, plain 16 000 B `dd7affc3…`;
  TileMap `0x21b4c` → `0x2d534`: 1196, 2 240 B `c196aa5b…`; separação
  `0x2d534 + 1196 < 0x2e4d4`); `cargo clippy -- -D warnings` rc=0;
  `cargo fmt -- --check` limpo; `verify_vectors.py` rc=0 com o hash agregado
  `3a9d7e9e…` recomputado dos 49 arquivos; a perna JS (`byor_cross_check.mjs`)
  reproduz o mesmo enquadramento `16000/4485` e `2240/1196`.
  **Evidência CONTRA — a hipótese estava errada e foi assim que se soube:** com os
  49 vetores **todos verdes**, o decoder divergia dos dois decodificadores de
  referência em **703 dos 16 000 bytes** do TileSet real (enquadramento idêntico:
  antes da correção `34a894c3…`, depois `dd7affc3…`, `bytes_consumed` 4485 nos dois). Causa:
  o token `110` não gravava `offset_history`, então o rep-match seguinte reusava
  offset obsoleto. A regra faltava na especificação de B e nenhum vetor importado
  coloca um rep-match depois de `110`/`111`. Corrigido em `d10d5ab`; os dois casos
  ficaram pinados (`data/rex_profiles/integrator/aplib/discriminating/`, SHA por
  arquivo + `ORIGEM.md` com receita de reconstrução e dos dois oráculos) e a
  não-vacuidade foi provada removendo a correção: **só** o teste novo cai.
  Arbitragem por três caminhos independentes que concordam (`apultra` `64be2a7a…`
  deste exemplar, origem declarada `8f340057…`; `apj.jar` SGDK v2.11 `2d8cdc63…`
  conferido antes de executar; `aplib.mjs` da agente A `62425497…`) — o produto
  não é a autoridade do formato, nem a port da agente A.
  **Limite honesto (não provado nesta frente):** não há encoder aPLib, então a
  paridade bidirecional do CONTRACTS §4 e a editabilidade **sem expansão** estão
  abertas; os 95,90 % de correspondência por pixel seguem medidos só em JS, não no
  produto; a identificação continua assistida pelo header (não é descoberta
  geral); não há reinserção/transação aPLib; e `work_limit`/`cancelled`/`overflow`
  são política do produto sem vetor de oráculo.
  **Matriz:** a linha aPLib **não foi promovida** (`blocked`, `fixture`) — missão
  veta promoção de maturidade, merge e release; o que entra aqui é evidência
  registrada, e a decisão de célula é do operador.
  **Próximo comando:** `git fetch` seguro e push de `codex/rex-integrator-aplib-decode`
  (ahead local não substitui consulta remota); depois, frente do **encoder** aPLib
  com `needs_space` honesto — o pré-requisito do objetivo da rodada.
  **Bloqueio:** nenhum técnico pendente; o que trava é escopo (encode ausente,
  promoção e merge são decisão do operador).

- 2026-09-26 (integrador, **PASSO 6 — E2E reexecutado no pino novo e entrega**),
  esta célula é o checkpoint: commits da frente — `fa98bda`
  (`scripts/e2e-tauri-build-run.mjs`: o negativo de intervalo passa a exigir o
  aviso do PASSO 4, e o passo seguinte foi renumerado) e este registro com o
  pacote `data/rex_profiles/integrator/lz4w-fixture/evidence/2026-09-26-e2e-r8-new-pin/`
  (logs dos dois runs + relatório + manifesto com SHA-256 por arquivo).
  Alterações não commitadas após eles: **nenhuma**; seguem intocados os arquivos
  alheios à rodada (`.mimosa/`, `APJ-unpack`, `a.out`, `apultra-decode`,
  `src-tauri/.mimosa/`, `src-tauri/src-tauri/`,
  `data/canonical-local-2026-09-21/` = corpus BYOR, nunca versionável).
  **Hipótese testada:** o incremento de encoder da rodada r7 sobrevive ao caminho
  *completo pela interface* — descoberta, prévia, transação canônica, BPS,
  reabertura e efeito de tela — e as garantias do PASSO 4 (aviso de descarte com
  fila preservada) são observáveis no binário novo, não só no unitário.
  **Evidência a favor:** cenário `rex-lz4w-fixture-effect` **rc=0**, 11 registros,
  no binário `e36f9f49…` construído por esta corrida com
  `rex_codecs.rs @ 6044135b…` + `rex_resources.rs @ d8477608…`; a ROM do fixture
  foi lida do **caminho durável do repositório**, o que encerra a limitação (d)
  do run11 (que lia `/tmp`). Escrita: modificada `07905193…`, BPS `c3bc1e94…`
  (62 B, 264 bytes distintos, faixa `5f9a1..5fb3b`, `diferenteForaDoSlot:0`),
  pixels `917048cc…` **inalterados** frente ao pino anterior. **Triangulação que
  não existia:** os 436 B que a UI escreveu têm SHA-256 `2776ec2c…` — idêntico ao
  stream do caso `i41` que o desempacotador 68000 oficial leu em hardware. Gates
  na árvore commitada: `node --check` OK, `check:tree` OK, `lint` rc=0,
  `tsc --noEmit` rc=0, `npm test` **701 passed / 6 skipped**,
  `npm run host:certify` rc=0 (**READY**, fingerprint `60249508…`, e o certify
  reexecutou o `cargo test --lib` dentro do binário atual: **675 passed / 0 failed
  / 53 ignored** + smoke oficial SGDK e PVSnesLib `Success: true`).
  **Evidência contra / o que NÃO se afirma:** (1) a corrida 1 foi **rc=1** por uma
  asserção **apodrecida pelo próprio PASSO 4** (`6351f15` passou a renderizar
  "nenhuma edição pendente" e o cenário ainda cobrava o literal `^\s*0\b`; o E2E
  não era reexecutado desde então). O log falho está promovido de propósito e a
  correção **fortaleceu** o teste em vez de afrouxá-lo — mas é falha de processo
  minha, registrada como tal. (2) O `report-run2.json` promovido foi gerado antes
  da renumeração de `fa98bda` e lista o índice `10` duas vezes (ambos os `claim`
  completos); nada foi editado à mão no relatório. (3) A reexecução cobre **o
  fixture autoral**, não os 160 recursos do corpus, e não altera o `BLOQUEADO`
  semântico de `0xc8cc8`. (4) Os hashes da escrita mudaram frente ao run11 por
  causa de `39c0fd9` (incremento r1→r4, já publicado), não deste incremento;
  **não** aferi que o stream do run11 decodifica no mesmo plain — equivalência
  declarada como não provada.
  **Próximo comando:** push da branch + acompanhamento pontual do CI (um job por
  vez, sem monitor permanente). **Executado:** `135bda2..d0744b0` pushado
  (fast-forward confirmado por `git fetch` antes do push: 0 atrás / 11 à frente).
  No acompanhamento, o job `Desktop E2E` do PR falhou **só** em
  `reference_goal=failure` — "ROM reaberta não refletiu o tilemap persistido no
  framebuffer", timeout de `15161 ms` contra orçamento de `15000 ms`. Achei o
  MESMO erro em corrida anterior deste branch disparada por um commit
  **só-documentação** (`36250323843`, `15011 ms` / `15000 ms`): flake de orçamento
  apertado no cenário `reference-platformer`, de outra frente, não atribuído a
  esta rodada e não corrigido aqui. Dado relacionado e desconfortável, registrado
  em vez de escondido: os cenários `rex-*` **não fazem parte** da matriz Desktop
  E2E do runner (ela roda `smoke_md`, `reference_goal` e os `live_*`, todos
  `skipped` menos os dois), então a prova do fixture é local e vinculada ao
  binário que medi — não há cobertura de CI para ela.
  **Depois:** PASSO 5 — consolidar a evidência
  TiledImage/APLIB (existe como afirmação em `PROMPT_REX_INTEGRATOR_RESUME_2026-09-26.md`
  e como código não integrado: `scripts/rex_profiles/lz4w/tiledimage.mjs` em
  `codex/rex-a-addressing @ 19094b0`, vetores aPLib em `codex/rex-b-codecs`) e
  implementar aPLib em Rust canônico em frente separada, com oráculos independentes.
  **Bloqueio:** nenhum externo. **Fora de escopo por ordem do operador:** merge,
  release, promoção de maturidade, expansão de ROM, realocação de ponteiros e
  promoção do marco do fixture para cobertura BYOR.


- 2026-09-26 (integrador, PASSO 3 entregue + PASSO 4 — **incremento integrado e oráculo 68k
  com o pino novo**, esta célula é o checkpoint): commits da frente — `cde88cc`
  (`rex_codecs.rs`: DP de custo explícito + política com orçamento de espaço),
  `8a22689` (`rex_resources.rs`: transação escreve pelo caminho orçado; harness
  publica `estrategia_base` e tempo/recurso), `04d703d` (driver e `reproduce.sh`:
  `i40`/`i41` + `i14` redesenhado), `b1d3df4` (evidência r15 + `LZ4W_68K_ORACLE.md`
  com o pino novo) e este registro com a evidência r7. Alterações não commitadas após
  eles: **nenhuma** nas quatro frentes; seguem intocados os arquivos alheios à
  rodada (`.mimosa/`, `APJ-unpack`, `a.out`, `apultra-decode`, `src-tauri/.mimosa/`,
  `src-tauri/src-tauri/`, `data/canonical-local-2026-09-21/` = corpus BYOR, nunca
  versionável).
  **Hipótese testada:** transformar *comprimento* ganho pela DP em *recursos
  editáveis a mais* sem expansão de ROM — e descobrir se o ganho medido no piso
  (r5) sobrevivia à transação real, que conhece vizinhos.
  **Evidência a favor:** no benchmark congelado, r5→r7 com o split de validação
  intocado — 160 melhoram / 1 empata / **0 pioram**, gap sobre o piso
  9 394→3 602 B (61,7 % fechado), folga somada −9 156→−3 364 B, folga não negativa
  1→7 de 160, `cabe` na bateria §4-edita 2→20 (coluna no-op preservada em 119),
  ajuste 1→5 e validação 0→1; 6 recursos mudaram de categoria para a frente e
  nenhum para trás. No recurso real: a edição canônica de `0xc8cc8` custava 146 B
  contra slot de 144 (`needs_space`) e passou a 144 B **cabendo**, com o desempacotador
  68000 oficial lendo essa stream exata (`i40`, `runE` idêntico nos dois caminhos).
  Reconciliações sem deriva: aceite do fixture `escrito=436`, pixels `917048cc…`,
  PNG `a3513ae6…` idênticos aos do pino anterior; cadeia BYOR `patch=7cd8f9de…`,
  `modificado=e5cb5dd9…`, 159 preservados == baseline r5; varredura `0xc8cc8`
  `candidatos=64 fit=60 aplicados=60`.
  **Evidência contra / o que NÃO se afirma:** (1) *comprimento não é a única
  grandeza* — rodar a DP como caminho de escrita derrubou a varredura para
  `fit=60 aplicados=56` por `dependent_modified` em 4 edições, o que produziu a
  política separada em vez de um "sempre o mais curto"; consequência medida: onde o
  guloso cabia o produto escreve os mesmos bytes (`i41`, SHA `2776ec2c…`), e a
  amostra de hardware do caminho de escrita são **2 casos**, não os 160 recursos.
  (2) O incremento **não é ótimo**: 3/161 atingem o comprimento do piso e 0/161
  emitem os bytes do piso (o modelo de piso ignora o teto de 128 candidatos/posição
  do produto); o que está provado é ≤ guloso em 161/161 e estritamente menor em 160.
  (3) *Editável ≠ compreendido*: `0xc8cc8` segue `BLOQUEADO` quanto ao conteúdo
  semântico. **Fechado depois deste checkpoint:** o E2E da ETAPA E foi reexecutado
  no binário novo e verde (rodada r8, `rc=0`, 11 passos, `e36f9f49…`) — veja a
  célula da ETAPA E e o próximo comando abaixo.
  **Comandos e resultados (rodados na árvore commitada):** `cargo test --lib`
  **675 passed / 0 failed / 53 ignored** (rc=0); `cargo clippy -- -D warnings` rc=0;
  `cargo fmt -- --check` rc=0; aceite ignorável do fixture e do piso verdes na
  rodada r7; replay r15 completo (14 casos, sem `FATAL`, único `DIVERGE` contratual
  em `i16`). Nota de higiene: `clippy --all-targets` conserva os **10 achados
  pré-existentes** (`build_or.rs:5225`, 5× `project_mgr.rs`, `lib.rs:165`,
  `graphics_discovery.rs:1946`, `holdout.rs:661`, `logic_recovery.rs:620`) —
  atribuídos ao WIP do operador, não corrigidos aqui; nenhum em `rex_*.rs`.
  **Auto-correção registrada:** um comando de atribuição mal encadeado no início
  desta sessão restaurou um snapshot velho em `rex_codecs.rs`/`rex_resources.rs`
  (trabalho perdido próprio); o código foi recuperado do transcript da sessão
  (linhas 8418/8430/8440) e **re-verificado do zero** — nada publicado como número
  antes da recomprovação.
  **Próximo comando (à época):** `node scripts/e2e-tauri-build-run.mjs --scenario
  rex-lz4w-fixture-effect --app src-tauri/target-test/debug/retro-dev-studio` com
  `RDS_REX_LZ4W_FIXTURE_ROM` apontando a ROM do fixture no caminho durável (job
  pesado próprio, um por vez), depois `npm run host:certify` e os gates de frontend
  (`check:tree`, `lint`, `tsc --noEmit`, `npm test`) para fechar o PASSO 6 com push
  e acompanhamento pontual do CI. **Executado e registrado acima**: o E2E passou
  rc=0 no pino novo (rodada r8) e os gates + `host:certify` foram reexecutados com
  ele. **Em paralelo (PASSO 5):** consolidar a evidência
  TiledImage/APLIB e implementar aPLib em Rust canônico em frente separada.
  **Bloqueio:** nenhum externo. **Fora de escopo por ordem do operador:** merge,
  release, promoção de maturidade, expansão de ROM, realocação de ponteiros e
  promoção do marco do fixture para cobertura BYOR.


- 2026-09-26 (integrador, PASSO 3 — **piso medido**, incremento ainda não
  integrado): HEAD deste checkpoint é o commit de documentação que acompanha
  `c296102` (instrumento de piso + emenda §9 do BENCH_SPEC) e `563c5f0` (dumps
  opcionais de material + verificador do piso pelo decoder do produto).
  Alterações não commitadas após ele: nenhuma nas três frentes; continuam
  intocados os arquivos alheios à rodada (`.mimosa/`, `APJ-unpack`, `a.out`,
  `apultra-decode`, `src-tauri/.mimosa/`, `src-tauri/src-tauri/`,
  `data/canonical-local-2026-09-21/` = corpus BYOR, nunca versionável).
  **Hipótese testada:** o déficit de 9 156 B do corpus era culpa do *parsing*
  guloso, e isso era mensurável antes de tocar no codificador.
  **Evidência a favor:** DP de custo explícito com busca exaustiva como referência
  — 1 165 entradas pequenas coincidem em TODAS (cinco configurações distintas,
  porque a contagem de transições provou que as duas primeiras nunca emitiam
  match longo nem tocavam o teto de 16 words); o gap produto − piso é positivo em
  **160/160** recursos do corpus, soma **9 394 B**, mediana 56 B, máximo 150 B,
  **zero empates e zero perdas**; no fixture o piso é exatamente o que o produto
  já emite (444 B, igual ao `rescomp`). Os 161 streams de piso passam pelo
  **decoder do produto** (161/161 voltam ao plain exato, consumidos inteiros) e o
  total de 9 394 B aparece por dois caminhos independentes. Rodada r5 == rodada
  pinada r4 campo a campo fora do tempo: o harness novo não moveu medição.
  **Evidência contra / o que a medida NÃO afirma:** o piso é do plain **sem
  edição**, então "cabe no slot" é condição necessária (125/160 contra 1 hoje; a
  folga agregada viraria +238 B, mas 35 recursos continuariam fora); não houve
  replay 68000 dos streams de piso; e a restrição a matches maximais **falhou**
  na 26.ª entrada do selftest antes de ser abandonada — o que invalida o número
  de piso que a versão restrita dava.
  **Comandos e resultados:** `cargo test --lib` **669 passed / 0 failed / 53
  ignored**; `cargo clippy -- -D warnings` rc=0; `cargo fmt -- --check` rc=0;
  `dp_floor.py --selftest` rc=0 (1165 casos + 4 barreiras RLE); varredura 59,4 s /
  161 recursos. `clippy --all-targets` mantém os mesmos 10 achados
  **pré-existentes** de `project_mgr.rs`, `holdout.rs`, `lib.rs`,
  `graphics_discovery.rs`, `build_orch.rs`, `logic_recovery.rs` — nenhum em
  `rex_*.rs`, e nada neste lote os introduziu.
  **Próximo comando (PASSO 3, integração do parse de custo explícito):** portar a
  DP para `rex_codecs.rs` atrás de orçamento explícito, com as obrigações do §6 da
  especificação (formato, decoder, teto de hardware 16 385, dependentes, recusa
  honesta), re-pinar o codificador e refazer o replay 68k no pino novo; só então
  publicar antes/depois com perdas e empates. **Em paralelo (PASSO 5):** TiledImage
  APLIB em frente separada. **Bloqueio:** nenhum externo. **Fora de escopo por
  ordem do operador:** merge, release, promoção de maturidade, expansão de ROM,
  realocação de ponteiros e promoção do marco do fixture para cobertura BYOR.

- 2026-09-26 (integrador, objetivo "capacidade real do encoder" — PASSOS 1-4 e
  entrega parcial): os três commits desta entrega são `2ffb076` (benchmark
  congelado), `39c0fd9` (incremento do codificador + evidência 68k r14) e `6351f15`
  (aviso de UI), sobre `47f2c89` (ETAPA E); este registro segue num commit de
  documentação próprio, então o HEAD da rodada é o dele. Alterações não commitadas após este
  checkpoint: nenhuma das três frentes — só arquivos alheios à rodada, que ficam
  intactos (`.mimosa/`, `APJ-unpack`, `a.out`, `apultra-decode`, `src-tauri/.mimosa/`,
  `src-tauri/src-tauri/`, `data/canonical-local-2026-09-21/` = corpus BYOR, nunca
  versionável).
  **Hipótese testada:** o gargalo de "tornar mais recursos editáveis sem expansão"
  era o codificador, e medi-lo diria se algum incremento de parsing valia o risco.
  **Evidência a favor:** linha de base pinada (`r1`, `rex_codecs.rs @ 656bdc9f…`)
  = folga somada −13 188 B, 1/160 com folga ≥ 0, 2 cabem / 523 needs_space / 119
  no-op em coluna separada; o diagnóstico token a token localizou a causa em **uma
  posição** (fixture, word 200) e três instrumentos independentes concordaram
  (tokenizador próprio, réplica byte a byte do codificador, sonda de candidatos);
  corrigida a ordem de iteração, o fixture passa a emitir **444 B idênticos ao
  `rescomp`** e o corpus ganha 4 032 B **sem uma única piora** (158 melhoram, 0
  pioram, 2 empatam), reproduzido campo a campo no pino final (`r4`) e relido byte a
  byte pelo **desempacotador 68000 oficial** nos 12 casos (`lz4w-68k/evidence/
  2026-09-26-r14`, determinismo entre duas corridas registrado no manifesto).
  **Evidência contra / o que NÃO se resolveu:** a editabilidade **não** subiu —
  segue 1/160 com folga não negativa, a bateria amostral (24 bits/recurso) só acha
  bit cabível no mesmo `0xc8cc8`, e a edição canônica ali custa 146 B contra slot de
  144 B. Mediana do déficit restante 56 B/recurso contra 2-6 B por bit: paridade com
  o `rescomp` é necessária, não suficiente. **Amostragem, não exaustão:** os 24 bits
  por recurso são amostra declarada; exaustivo estouraria o orçamento de 2 s/recurso.
  **Comandos e resultados:** `cargo test --lib` **669 passed / 0 failed / 52
  ignored**; `cargo clippy -- -D warnings` rc=0; `cargo fmt --check` rc=0; `npm test`
  **701 passed / 6 skipped**; `check:tree`/`lint`/`tsc --noEmit` rc=0; §5 do
  diagnóstico re-executado e verde (passo 4 dif == log versionado). Nota de higiene:
  `cargo clippy --all-targets` tem 10 achados **pré-existentes** em arquivos que este
  lote não toca (`project_mgr.rs`, `holdout.rs`, `lib.rs`, `graphics_discovery.rs`,
  `build_orch.rs`, `logic_recovery.rs`) — nenhum em `rex_*.rs`.
  **Próximo comando (PASSO 3, incremento seguinte):** medir o **piso** por parse de
  custo explícito (caminho mais curto sobre as words com custo de token + literais +
  descrito + word de offset, respeitando ≤15 literais/token e o teto de 128
  candidatos), validar contra busca exaustiva em entradas pequenas e só então decidir
  se integra — sem a palavra "ótimo" antes dessa comparação. **Em paralelo (PASSO
  5):** TiledImage APLIB em frente separada, sem misturar codec novo, otimização
  LZ4W e UI no mesmo commit. **Bloqueio:** nenhum externo. **Fora de escopo por
  ordem do operador:** merge, release, promoção de maturidade, expansão de ROM,
  realocação de ponteiros e promoção do marco do fixture para cobertura BYOR.


- 2026-09-26 (integrador, ETAPA E — relatório técnico): consolidado em
  `docs/rex_profiles/RELATORIO_ETAPA_E_2026-09-26.md` (11 seções: veredito, artefatos
  com SHA-256, método e as cinco barreiras não-vacuosas, dez passos medidos, argumento
  de causalidade, mapa dos negativos, limitações, portas com reconciliação 699↔702,
  reprodução, conteúdo do pacote, pendências). Antes do commit cada número foi
  confrontado com `manifest.json` e com o relatório do run11 (16/16 hashes dos
  artefatos conferidos contra o disco, zero divergências). A auditoria **produziu duas
  correções**: (1) o manifesto apontava a linha do pixel para `steps[8]` — o índice
  correto é `steps[7]` (`steps[8]` é a comparação canvas==framebuffer); (2) nem o
  manifesto nem o relatório registravam que as corridas rc=0 abriram a ROM em `/tmp` —
  agora registrado como limitação, com o SHA idêntico do caminho durável. HEAD da
  etapa: `9849aac` (remoto == local antes deste commit). Gates: `check:tree` rc=0 com
  o arquivo novo; nenhuma mudança de código. Bloqueio: nenhum externo;
  merge/release/promoção seguem fora do escopo por ordem do operador.

- 2026-09-26 (integrador, ETAPA E — checkpoint): **uma edição de recurso
  comprimido com efeito causal demonstrado na aplicação**, em dado autoral.
  HEAD na promoção `d4043eb`; alterações não commitadas deste checkpoint:
  `scripts/e2e-tauri-build-run.mjs`, `src-tauri/src/tools/reverse/decomp/rex_resources.rs`,
  `scripts/rex_profiles/integrator/lz4w_fixture/{README.md,gen_fixture.py}`,
  `analyze-frame.py` (novo) e o pacote `data/.../lz4w-fixture/evidence/2026-09-26-e2e/`.
  Hipótese testada: a cadeia LZ4W do produto produz um efeito observável **na
  tela do app** quando a edição é aplicada pela interface real e pelo núcleo real.
  Evidência a favor: run10 e run11 rc=0 no binário `e6907792…` com WRAM `0x5e
  f0→ff`, exatamente 1 pixel de tela distinto em `(7,5)` (coordenada prevista
  antes da emulação), canvas == framebuffer, BPS re-aplicado com hash exato e
  re-decode do plain editado. Evidência contra/limitações: a perna de VRAM **não
  é provável neste core** (não expõe `VIDEO_RAM`; `ok:true` com 0 bytes lidos é
  a armadilha de prova vacuada que motivou a barreira `total_size`); a paleta
  autoral de 16 palavras funde em 11 cores no DAC, logo pixel é identificado por
  posição; o negativo de intervalo é **inalcançável pela UI** (guarda do
  cliente) e foi movido para teste unitário do núcleo. Retratação de redação
  anterior: a frase "a tela do app ainda não foi capturada por emulação" estava
  no estado corrente e é substituída pela linha ETAPA E acima — ela vale para o
  fixture, **não** para o alvo comercial (`0xc8cc8` segue `BLOQUEADO`).
  Gates: `cargo clippy -- -D warnings` rc=0; `cargo test --lib -- --nocapture`
  **669 passed / 0 failed / 51 ignored** (rc=0); `check:tree`/`lint`/`tsc` rc=0.
  Log promovido com todas as portas e rc:
  `data/rex_profiles/integrator/lz4w-fixture/evidence/2026-09-26-e2e/gates-2026-09-26.log`. Achado paralelo honesto: `cargo clippy
  --all-targets` (mais estrito que o gate documentado) falha em 10 lints de
  código de teste **pré-existente** (`build_orch.rs:5225`, cinco em
  `project_mgr.rs`, `graphics_discovery.rs:1946`, `holdout.rs:661`,
  `logic_recovery.rs:620`, `lib.rs:165`) — atribuídos, não corrigidos nesta
  rodada; os 8 lints do meu próprio arquivo (`rex_resources.rs`, aritmética
  constante em asserções) foram corrigidos. `npm test` **699 passed / 6 skipped
  (705)** e `npm run host:certify` **READY** (702/3 na mesma árvore; os 3 a mais
  são guardas de toolchain em `scripts/decomp/decomp-scripts.test.mjs`, reconciliado
  em `.../evidence/2026-09-26-e2e/gates-2026-09-26.log`). Próximo comando: commit
  deste conjunto revisado e push. Bloqueio: nenhum externo —
  merge/release/promoção permanecem fora desta missão por ordem do operador.


- 2026-09-26 (integrador, ETAPA D): primeira edição de recurso comprimido com
  **efeito previsto e demonstrado de ponta a ponta em dado autoral**. Fixture
  SGDK 2.11 authored (`scripts/rex_profiles/integrator/lz4w_fixture/`) expõe a
  cadeia de consumo por construção; o aceite do produto aplica uma edição de 1
  pixel que **cabe** (440B no slot de 444B), re-decodifica a ROM modificada e
  imprime a coordenada de tela **antes** de qualquer emulação; replay no
  desempacotador 68000 oficial confirma o stream escrito pelo produto (runF:
  `i30` rescomp + `i31` produto, `68k == jar == esperado`, sem sobrescrever
  vizinhos). Medido e registrado, não escondido: o codificador do produto
  gasta **mais** que o rescomp no plain não-editado (448 vs 444; antes 380 vs
  378) e por isso **nenhuma** das 15.360 edições de pixel do fixture original
  cabia — a granularidade do LZ4W é de words, daí o plantio do near-miss. O
  DP ótimo portado de `LZ4W.java` foi implementado, verde, e **revertido** por
  piorar (382 vs 380); um DP fiel exige a dimensão "literais pendentes mod
  15". Retratação menor de redação: o bloqueio comercial é o **consumidor não
  provado**, não a ausência de espaço (a edição BYOR canônica cabe). Pendente:
  ETAPA E (prova pelo produto/emulação).

- 2026-09-26 (integrador, retomada): contrato do codec fechado contra o
  desempacotador 68000 oficial. Teto da referência longa não-ROM medido no
  hardware (`16385`, não `16384`) e confusão de constantes corrigida com
  regressões de fronteira à mão; replay `Rust encode -> 68k decode` obrigatório
  executado fora do roundtrip interno (10 casos, 6 ROMs, identidade do
  desempacotador conferida em cada construção); divergência mínima confirmada
  em `16386` com o jar de 32 bits discordando do hardware. Preservados os 7
  commits anteriores + o checkpoint pendente do Memory Bank. ALEGAÇÕES DE
  OBSERVAÇÃO rebaixadas ao que foi medido (ETAPA C). Pendente: alvo com efeito
  demonstrável (ETAPA D) e prova ponta a ponta pelo produto (ETAPA E).

- 2026-09-25: LZ4W canônico em Rust com oráculo bidirecional (lz4w.jar);
  descoberta de que TODOS os streams LZ4W do corpus são prev-block (ResComp
  empacota com os bytes anteriores como dicionário) -> decoder com dicionário
  verificado em 100+ streams do corpus congelado; encoder com dicionário +
  lazy matching; primeira cadeia real comprimida executada no produto (scan ->
  decode -> edição -> re-codificação -> reinserção em cópia -> patch ->
  equivalência global de decode) no recurso header 0x25788/stream 0xc8cc8.
  Pendentes: prévia PNG no produto, IPC/UI, efeito observado no core Libretro
  (E2E), aPLib decoder/encoder, perfis de endereçamento no produto, agentes
  A/B retomados após reset de quota (15:21).
- 2026-09-24: base `0d8c413` confirmada (CI remoto verde em todos os checks;
  provas 4/4, 6/6, 13/13, 16/16 conferidas programaticamente no binário
  `9a6afe4b…`; corpus com hashes conferidos). Contratos v1 congelados;
  worktrees A/B preparados sobre a mesma base; estado inicial tudo `blocked`.
