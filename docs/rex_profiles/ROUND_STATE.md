# Estado da rodada REX — perfis de endereçamento e codecs

Registro vivo do integrador. Matriz honesta por capacidade: `blocked`,
`fixture` (prova sintética autoral) ou `verified` (evidência registrada — pacote em
`data/rex_profiles/*/evidence/`, conjunto pinado com SHA por arquivo, ou
teste/script versionado que a refaz). Nada aqui é badge único verde; cada célula
cita a evidência ou o bloqueio exato. Contratos: `CONTRACTS.md` (v1).

**A matriz mede capacidade técnica, não maturidade de produto.** Uma célula
`verified` não promove nada: o rótulo de produto continua `Experimental`, com os
limites de cobertura da própria célula e as provas herdadas valendo.

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
- Janela atual: o integrador usou 2026-09-28T08:14Z–09:25Z (UTC) para os gates
  da integración do adaptador, 10:57Z–11:01Z para as re-execucións que a
  limpeza de `/tmp` obrigou a refazer, 11:44Z–12:02Z para os gates da rolda de
  aceite, 12:18Z–12:20Z para a barra de frontend no HEAD final e 14:36Z–15:08Z
  para a entrega de B (encoder + fixtures), o adaptador Kosinski e a súa barra
  de gates (cargo/clippy/fmt/check-tree + lint/tsc/npm test). Para a PR #85
  (MUGEN -> SGDK) o integrador usou 2026-09-29T02:08Z–02:20Z na barra de gates
  do destino e 02:36Z–02:50Z no E2E desktop `mugen-import` (unha primeira
  lanza duplicada por un `&` mal posto competiu por `dist/` e foi descartada;
  ver `data/rex_profiles/mugen_sgdk/evidence/2026-09-28-integracao-integrador/LEIAME-e2e-e-host.md`)
  e 03:00Z–03:17Z na re-execución completa da barra sobre a árbore final curada
  (os 11 gates da barra, todos rc=0; evidencia en
  `data/rex_profiles/mugen_sgdk/evidence/2026-09-29-pos-curaduria/`).
  Nada pesado queda executado. **Consultas CI, todas pontuais sen monitor
  permanente:** a re-execución do job `desktop-smoke` en `ebfa8ea` (fronte A)
  fechou `completed`/`success` xunto con `validate` e `linux-validate`, e o CI
  do PR #86 en `d36df92` está terminal verde (detalle na célula de abaixo e no
  checkpoint (h) do Memory Bank).

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

Nota do integrador (2026-09-28), sen reescribir ningunha célula desta matriz
que sexa propiedade da agente A: o que se midiu nesta ronda é que o pacote
`crates/rex-addressing` ten gates propios aprobados (**127 executados / 0
fallos / 9 ignorados**) e está **exposto no backend real** só para lectura con
snapshot fixo nos dous perfis MD (`rex_addressing_read_snapshot`);
`read_sequence`, as escritas e os tres perfis SNES segúan sen exposición. A
cámara correcta para iso é a matriz de `crates/` abaixo e `crates/registry.json`
— que miden capacidade do paquete e do adaptador, non a cobertura por perfil
que A rexistra aquí.

## Matriz de codecs (propriedade: agente B; LZ4W integrado pelo integrador)

| Codec | Variante fixada | Vetores+holdout | decode vs ref | encode vs ref | Negativos | Recurso real |
|---|---|---|---|---|---|---|
| aPLib | verified (variante **raw do SGDK 2.11, sem header `"AP\0"`**, fixada no produto e arbitrada por dois decodificadores de referência independentes; a questão de fundo sobre namespace canônico segue registrada em (b) abaixo) | verified (pino próprio do integrador em `data/rex_profiles/integrator/aplib/vectors/`: 49 arquivos com SHA + hash agregado `3a9d7e9e…`, mais 2 discriminadores em `.../discriminating/`; a cópia da agente A **não** foi adotada) | verified (perna 1 da paridade §4: `aplib_decode` do produto sobre o stream de cada um dos **dois** oráculos — `apultra` exemplar `64be2a7a…` (origem declarada commit `8f340057…`) e `apj.jar` SGDK v2.11 `2d8cdc63…` — nos 8 plains, e nos 9 goldens com `bytes_consumed` exato; **não** alegado pelo desempacotador 68000 real, que hoje só existe para LZ4W) | verified (perna 2 da paridade §4: os dois oráculos devolvem o plain pinado a partir do stream que o **produto** codificou — gate **16 executados / 16 aprovados / 0 divergentes**; mesa de tokens idêntica à dos oráculos em 7 das 8 mesas; **ótimo não alegado** — em `noisy_runs_16k` o produto emite 1 364 B contra 1 205 B dos dois oráculos, e a mesa explica em números: +433 B de `match-10` comprando 272 B de literais e rep-matches) | verified (os 7 negativos recusados cada um pelo código estruturado que o define, `work_limit`, `excessive_output` sem estourar saída, `overflow` por gamma2 sem fim, e `verify_aplib_resource` recusando tamanho declarado divergente e header de outro codec) | **verified no perfil demonstrado** (HAMOOPIG `558bea6c…`, recurso `0x2e12a` da lista real, edição de 1 pixel registrada e aplicada pela barra, reinserção em slot **sem expansão** com 0 bytes fora dele, BPS reaplicado sobre a base reproduzindo o hash da cópia e efeito em tela nas 2 posições previstas pelo desempacotador do próprio jogo — ver as duas packages em `data/rex_profiles/integrator/aplib/evidence/` e o checkpoint abaixo; **não** verificado para os outros 3 recursos aPLib da ROM, para o resto do acervo, nem para o app distribuído) |
| LZ4W SGDK | verified (SGDK MIT, prev-block + self-contained) | fixture (golden autorais) | verified (desempacotador 68000 oficial sob MAME + lz4w.jar nas duas direções) | verified (o 68000 reproduz byte a byte cada stream dos casos medidos — **pelos dois caminhos do encoder**: entrada DP-first e caminho de escrita com orçamento de espaço; 14 casos em r15) | verified (truncated/invalid-reference/overflow/excessive-output/work-limit/dicionário/fronteira 16384-16385-16386) | verified (corpus HAMOOPIG, ver cadeia) |
| Nemesis | blocked | fixture (PR #79, vetores nemcmp) | blocked | blocked | blocked | blocked |
| Kosinski | verified (variante base não-modular v1 fixada em `docs/rex_profiles/kosinski_runtime/CONTRACT.md`; módulo de edição REXKOS declarado prova de contrato, NON transación canónica) | verified (52 fixtures autorais vendorizadas no paquete `crates/rex-kosinski` con SHA-256 pinada en `tests/fixtures.rs`; gate do paquete 51 executados / 0 falhas / 0 ignorados medido 2026-09-28T14:36Z) | verified (gate do paquete + adaptador do backend: 16 probas con esperas rexistradas independentemente por B e confirmadas no oráculo koscmp; diferencial 53/1/2/2 byte-idêntico rexistrado en `data/rex_profiles/kosinski_runtime/`) | verified (paridade bidireccional koscmp nos 16 testes `encode` do paquete + round-trip pola fronteira do backend; **ótimo non alegado**) | verified (truncated / invalid_reference (`0200ffff`) / excessive_output / work_limit / empty_input na decodificación e stream_limit / work_limit na codificación, cada un polo código estruturado do `CodecError` do produto) | **blocked** — ningún recurso real (BYOR) foi decodificado, recodificado ou reinserido polo produto; non hai chamador da interface |
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

aPLib — **linha corrigida em 2026-09-27 por ordem do operador: as células refletem
capacidade técnica medida, e a maturidade do produto continua `Experimental`.** O
que estava atrasado nesta linha era o registro, não o código. O consolidado do que
existia antes da frente (evidência TiledImage da agente A em `codex/rex-a-addressing`,
pacote de contrato e vetores da agente B em `codex/rex-b-codecs`, hash agregado
`3a9d7e9e…` recomputado da árvore de B, os 9 goldens byte-idênticos entre os dois
namespaces) e a ordem de aceite estão em `APLIB_TILEDIMAGE_PROXIMA_PROVA_2026-09-26.md`,
com adendo datado registrando o que a frente executou. A célula "Recurso real" está
agora `verified` **no perfil demonstrado**, com o critério atendido ponto a ponto e
cada número conferível no pacote: ROM HAMOOPIG com identidade fixada (`558bea6c…`
reconfirmado no disco antes e depois de cada corrida), recurso `0x2e12a` vindo da
lista real (não do fixture), edição de 1 pixel registrada (`(53,7,5) → 4`),
reinserção **sem expansão** (cópia do tamanho da ROM, 800 bytes distintos, 0 fora
de `[0x2e12a, +938)`), BPS reaplicado sobre a base reproduzindo o hash exato da
cópia, e efeito em tela nas 2 posições previstas pela geometria chunky, executado
pelo desempacotador do próprio jogo. Evidência por hash em
`data/rex_profiles/integrator/aplib/evidence/2026-09-27-passo5-perna3-core/` e
`.../2026-09-27-passo5-perna2-barra/`, e nos checkpoints do passo 5 abaixo.
**Complemento de 2026-09-27 (entrega 2):** o painel expressa o domínio inteiro do
4bpp (`0..15`), inclusive o índice 0 que `min=1` + `Number(v) || 1` reescreviam para
1; a edição pinada das pernas 1 e 3 — `(53,0,4) → 0`, 937 B no slot de 938 B — agora
é digitável na barra e a cópia que ela escreve é **byte a byte** `69389ec2…`, o
artefato que a perna 3 executou no desempacotador do jogo. Pacote:
`data/rex_profiles/integrator/aplib/evidence/2026-09-27-entrega2-indice-0-na-barra/`.

Limites desta célula, parte do que ela afirma (não são nota de rodapé): é **um**
dos **4** recursos aPLib da ROM; `0x2e4d4` e `0x2f65a` não aceitam nenhuma edição
de 1 pixel no domínio inteiro que a barra expressa hoje (0..15: piso 4 540 > slot
4 485 e 7 439 > 7 420), `0x2e12a` tem folga de 1 B e `0x2cd94` folga 0; prova de execução é
sob o core do harness (Genesis Plus GX v1.7.4 `46a5521`), não em hardware nem no
app distribuído; e "editável" não é "compreendido" — a classe do alvo segue
desconhecida.

Estado do produto (medido, não alegado): `aplib_decode` + `AplibLimits` em
`src-tauri/src/tools/reverse/decomp/rex_aplib.rs` (variante SGDK **raw sem header
`"AP\0"`**), 9 testes na suíte do lib aceitando as 8 duplas de oráculo, os 9
goldens com `bytes_consumed` exato (o discriminante `g08`), os 7 negativos com o
erro estruturado próprio e os 3 limites de política (`work_limit`,
`excessive_output`, `overflow` por gamma2 sem fim); `verify_aplib_resource` em
`rex_resources.rs` liga o codec à cadeia de recurso (recusa `compression !=
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
fechada nas duas pernas (registro abaixo). **Correção de registro (2026-09-27):**
este parágrafo dizia "reinserção em slot ainda não: `reinsert` é caminho exclusivo
de LZ4W". Isso foi superado pelo passo 3 e pelo passo 5 da mesma frente — o
tronco `reinsert_aplib_*` existe, a transação canônica é uma só e opera nos
recursos aPLib reais (5 testes no lib + as duas pernas BYOR), e o que ela escreve
foi executado pelo desempacotador do jogo. Continuam **sem** autorização e **sem**
implementação: expansão de ROM e realocação de ponteiros. Promoção de maturidade
não é o que esta linha declara: o produto segue `Experimental`.

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
o tag e cobra um tag extra) e o desempacotamento dos streams do produto pelo
**oráculo 68000 montado sob MAME**, que hoje só existe para LZ4W. A reinserção em
slot saiu desta lista em 2026-09-27: existe o tronco `reinsert_aplib_*` (5 testes)
e o artefato que a barra escreveu é desempacotado pelo código do **próprio jogo**
sob o core do harness (Genesis Plus GX v1.7.4 `46a5521`) — oráculo do jogo, não o
montador do SGDK sob MAME; a distinção é do escopo da célula, não uma nota.
Reconstrução de TiledImage dentro do produto segue não alegada.

Duas divergências continuam registradas em vez de resolvidas por alegação: (a) a
linha aPLib desta matriz dizia `variant-fixed: blocked` enquanto o `manifest.json`
de B diz `"variant-fixed": "verified"`; em 2026-09-27 a linha foi corrigida para o
que **a evidência do integrador** mede (variante raw, arbitrada por dois
decodificadores independentes), o que remove a contradição de status mas **não**
adjudica a questão de fundo — qual namespace é canônico e com qual contrato;
(b) o próprio CONTRACTS v1 é inconsistente
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

## Matriz de bibliotecas standalone (`crates/`) — propriedade: integrador

A escada tem quatro degraus e **cada degrau é um registro distinto**; subir um
não implica o seguinte. Uma biblioteca compilar e passar nos gates próprios não
é integração, e integração ao backend não é fluxo do usuário comprovado.

| Pacote | biblioteca implementada | gates próprios aprovados | backend integrado | fluxo do usuário comprovado |
|---|---|---|---|---|
| `crates/rex-kosinski` (frente B) | verified (codec Kosinski base não-modular v1: decoder + encoder + contenedor de edición autoral + 52 fixtures vendorizadas; contrato `docs/rex_profiles/kosinski_runtime/CONTRACT.md` e `ENCODE-CONTRACT.md`; entregas `3fea06e`+`1af7017` e 8 commits `0b752b7..6a2218e`, pino `6a2218e` conferido por `git ls-remote` 2026-09-28T14:38:34Z, todas por `cherry-pick -x` con paridade byte-exata (diff = 0 bytes)) | **verified** — `npm run crates:gates` medido 2026-09-28T02:48Z (25 executados) e **re-medido 2026-09-28T14:36Z–14:37Z** depois da entrega do encoder: `fmt` OK, `clippy --all-targets -D warnings` OK, `test --locked` OK com **51 executados / 0 falhas / 0 ignorados** (22 contract + 8 edit + 16 encode + 2 fixtures + 3 mutations). O achado de relocabilidade (fixtures fóra do pacote) está **fechado** pola propia B: as 52 fixtures vendorizan-se dentro do paquete con SHA-256 pinada en `tests/fixtures.rs`. Log + manifesto con SHA en `data/rex_profiles/kosinski_runtime/evidence/2026-09-28-integrador-gates/` e `.../2026-09-28-entrega-encoder-fixtures/` | **verified** — chamado polo backend real e medido 2026-09-28T14:45Z–15:08Z: `rex-kosinski = { path = "../crates/rex-kosinski" }` em `src-tauri/Cargo.toml` (sem workspace na raiz; `Cargo.lock` +5 linhas, unha entrada `[[package]]` **sem** `source` e zero crates externos novos), adaptador en `src-tauri/src/tools/reverse/decomp/rex_kosinski.rs` (mapeo 1:1 de `KosError`/`EncError` ao `CodecError { code, detail }` do contrato de codecs, `bytes_consumed` conforme contrato v1 §3, DTOs `snake_case` + base64 + SHA-256 laterais) e **dous comandos Tauri** `rex_kosinski_decode`/`rex_kosinski_encode` registrados en `generate_handler!` (HEAD do commit `3428b69`, SHA do adaptador `3b4115ab…`). **16 testes do adaptador, 0 falhas** (10 capa codec + 6 capa IPC) con esperas independentes rexistradas por B (abcdef consumed=11, sonda `0200ffff`, mínima de encode `020000F000`); suite completa `cargo test --lib` **770 / 0 / 66**, `clippy --lib -D warnings` rc=0, `fmt --check` rc=0, `check:tree`/`lint`/`tsc --noEmit`/`npm test` (749/6/755) rc=0. Non-vacuidade: dous RED observados (capa codec e capa IPC, E0432) e tres controles de mutación (mapeo `empty_input`, `bytes_consumed` da resposta IPC, mapeo `stream_limit`) matando 1/1/2 pruebas, restauración conferida por SHA. **Exposto só decodificar e codificar streams en memoria**; o contenedor `edit::build/open/reinsert` queda declarado como non exposto — proba de contrato, non transación canónica | **blocked** — nenhum chamador da interface usa `rex_kosinski_decode`/`rex_kosinski_encode`, non hai pantalla de codec, e ningún recurso real (BYOR) foi decodificado ou recodificado polo produto: as chamadas probadas usan streams autoriais, cero corpus BYOR no gate |
| `crates/rex-addressing` (frente A) | verified (5 perfis MD linear/SSF2 e SNES LoROM/HiROM/ExHiROM; 17 commits `9b27941..57e51d3`, PR #82, `cherry-pick -x` sem conflitos; movido de `scripts/rex_profiles/addressing_runtime/` para `crates/rex-addressing` — promoção que o `CONTRATO.md` do próprio perfil registrava como pendente do integrador. A entrega mais recente de A também entrou: 7 commits `58a06dd..30cb311` (PR #83, etapas 2–5 — capa de leitura de recursos com procedência, bateria discriminante, exemplo consumidor e varredura *nunca panica*), por `cherry-pick -x` como `cde721c..8a28909`, com pino conferido por fetch pontual antes de integrar) | **verified** — primeira medição 2026-09-28T02:58Z já na localização nova (`fmt` OK, `clippy --all-targets -D warnings` OK, `test --locked` OK com **81 executados / 0 falhas / 9 ignorados**) e re-medida 2026-09-28T08:14Z depois dos cherry-picks das etapas 2–5: `fmt` OK, `clippy --all-targets -D warnings` OK, `test --locked` OK com **127 executados / 0 falhas / 9 ignorados**; e re-medida outra vez 2026-09-28T11:44Z depois da rolda de aceite de A (`30cb311..0e5f804`), cos tres gates OK e **138 executados / 0 falhas / 10 ignorados** en 17 targets — exactamente os números que A publicou na súa propia árbore, reproducidos neste tronco e xa con `examples/` dentro do paquete. Logs + manifestos em `data/rex_profiles/addressing_runtime/evidence/2026-09-28-integrador-gates/` e `.../2026-09-28-backend-integrado/`. Os ignorados são os BYOR (8), a preimage exaustiva (1) e — só na carreira de 11:44Z — o caso que rexenera o JSON de aceite baixo `REX_ACEITE_ESCRIBIR=1`, que non se executou en ningunha das tres: o gate ordinário não depende de ROM. Pacote **relocável** — os vectors pinados viven dentro del (`vectors/rust-vectors-v1.json` e `vectors/acceptance-v1.json`, SHA-256 `54ba2b6e…a216` pino dentro de `tests/acceptance.rs`). Achado devolvido à A (15 `.expect()` sem varredura adversária) está **fechado** pela própria etapa 5: `tests/no_panic_sweep.rs`, 277 610 chamadas determinísticas nos cinco perfis mais a capa de recursos | **verified** — chamado pelo backend real e medido: `rex-addressing = { path = "../crates/rex-addressing" }` em `src-tauri/Cargo.toml` (sem workspace na raiz; `Cargo.lock` +5 linhas, uma entrada `[[package]]` **sem** `source` e zero crates externos novos), adaptador em `src-tauri/src/tools/reverse/decomp/rex_addressing.rs` e comando Tauri `rex_addressing_read_snapshot` registrado em `generate_handler!` (SHA do adaptador `7bd75ea9…`). **17 testes do adaptador, 0 falhas**; suite completa `cargo test --lib`: **754 / 0 / 66 ignorados** (737 era a base sem o adaptador), `clippy --lib -D warnings` rc=0, `fmt --check` rc=0, `check:tree`/`lint`/`tsc --noEmit`/`npm test` todos rc=0. Não-vacuidade: RED observado (16 fallos antes da implementação) e três controles de mutação (garda de identidade, procedência do segmento, achatamento de erros) matando 1/2/8 testes, com restauração conferida por SHA. **Exposto apenas a leitura com snapshot fixo nos perfis MD**; `read_sequence`, as escritas e os perfis SNES ficam declarados como não expostos no registro. **A rolda de aceite de A (medida 2026-09-28T11:44Z–12:02Z) non move este degrau**: os seus 15 vectores gradúan `read_resource`/`read_sequence` contra un oráculo independente, superficies que o adaptador do produto non expón, polo que non son evidencia do adaptador. Si mudou a débeda da promoción: `examples/resource_report.rs` da etapa 4 quedara na ruta vella (o paquete graduado ás 08:14Z non tiña exemplo e `clippy --all-targets` nunca o lintaba) e catro ligazóns relativas do README do paquete apuntaban tres niveis por riba da raíz — reparado en `daefb43`, con paridade conferida ficheiro a ficheiro (42 ↔ 42, única diferenza de contido a miña nota de localización) e o exemplo executado rc=0 desde `crates/rex-addressing` (13 lecturas / 14 recusas / 7 códigos, resumo `27bebc7b…`). Log + manifesto por arquivo em `data/rex_profiles/addressing_runtime/evidence/2026-09-28-backend-integrado/` | **blocked** — nenhum chamador da interface usa `rex_addressing_read_snapshot` e não existe tela de endereçamento; as únicas imagens lidas são fixtures autoriais do próprio adaptador, sem corpus BYOR no gate |
| `crates/rex-gameplay` (frente de recuperación de gameplay) | verified (perfil pechado `m68k.counter_threshold_state_gate.v1`: guarda de input + contador + limiar + escrita de estado + chamada externa opaca, con grafo NodeGraph v1 editable só no limiar; PR #84 `308fd44` + `a63e3a3` (PROPOSTA), o de paquete entrou por `cherry-pick -x` como `f35ed0d` e o integrador reescribiu `registry.json`/`Cargo.toml`/`Cargo.lock`/`mod.rs` polas convencións actuais. Zero dependencias externas; 3 fixtures hex vendorizadas con `PROVENANCE.md`) | **verified** — medido 2026-09-28T17:08Z no tronco do integrador: `fmt` OK (rc=0), `clippy --all-targets -D warnings` OK (rc=0), `test --locked` OK con **16 executados / 0 falhas / 0 ignorados** (6 lib + 10 profile); números medidos na localización nova, non os publicados pola fronte | **verified** — `rex-gameplay = { path = "../crates/rex-gameplay" }` en `src-tauri/Cargo.toml`, adaptador `src-tauri/src/tools/reverse/decomp/rex_gameplay.rs` (DTOs `snake_case` con `deny_unknown_fields`, erros `InspectionError { code, message, retryable }` con conxunto pechado de códigos, límites ROM 32 MiB / grafo 8 MiB / 64 saídas / 512 rótulos, identidade por `rom_sha256`) e catro comandos rexistrados en `generate_handler!` (`rex_gameplay_scan`/`_recover`/`_edit_threshold`/`_rebuild`), executados fóra do fio principal. Suite do backend **780 / 0 / 67**, `clippy --lib` rc=0, `fmt --check` rc=0. Non-vacuidade: M1..M5 mataron 2/1/1/1/2 probas con restauración conferida por SHA. **Exposta a inspección, recuperación, edición do limiar e reconstrución; JSR segue opaco** | **blocked** — a rolda pola interface (ETAPA 6: grafo visible + teclado real no E2E desktop) aínda non executou; o degrau non se promove por ordem expresa do operador ("sem merge, release ou promoción de maturidade"). Evidencia en `data/rex_profiles/gameplay_recovery/evidence/` |
| `crates/rex-mugen` (frente MUGEN -> SGDK, PR #85) | verified (perfil `mugen.character.v1`: AIR, SFF v1 indexado, paleta na grade do VDP, proxección de animación para rescomp/SGDK, diagnóstico `rex-mugen/diag/v1` e informe `retrodev.mugen_import_report/v1` en 7 categorías; 22 commits `a08c2c6..bd02e3c` entraron como merge curado do integrador `b410de0` — o único conflito material eran 2 liñas de path-deps en `src-tauri/Cargo.toml`, e resolveuse conservando `rex-kosinski`, `rex-gameplay` e `rex-mugen`. Zero dependencias externas; as 3 mostras (Probe/Sentinel/Warden) **xéranse por código** en `src/fixture.rs` con `fixtures/.gitattributes` `* -text`) | **verified** — medido 2026-09-29T02:08Z–02:20Z sobre `b410de0`: `fmt` OK (rc=0), `clippy --all-targets -D warnings` OK (rc=0), `test --locked` OK con **12 executados / 0 falhas / 0 ignorados** (8 lib: 3 air + 2 palette + 2 sff + 1 sha256; 4 en `tests/fixture_probe.rs`); `npm run crates:gates` rc=0 cos 4 paquetes registrados. Suite do backend **796 / 0 / 70** (reconciliada: base 770/66 + PR 15/3 + integrador 11/1), frontend `npm test` **812 passed / 0 failed / 6 skipped**. Logs + `SHA256SUMS` en `data/rex_profiles/mugen_sgdk/evidence/2026-09-28-integracao-integrador/` | **verified** — `rex-mugen = { path = "../crates/rex-mugen" }`; adaptador `src-tauri/src/core/mugen_profile.rs` (1951 liñas, 18 `#[test]` con 3 `#[ignore]` para a proba real SGDK) con contención de caminhos `resolve_inside()` (absoluto, prefixo, `RootDir` e calquera `..` fóra do paquete recusan), `read_limited()` con 1 MiB de texto e 32 MiB de SFF, **validación integral antes de calquera escritura** (un só `save_rgba_image`), `discard_failed_import()` segundo a orixe reservada do cartafol, runtime xerado en `compiler/mugen_runtime.rs` (317 liñas) e ganchos en `project_mgr`/`ast_generator`/`sgdk_emitter`/`snes_emitter`/`build_orch`. `clippy --lib` e `clippy` por defecto rc=0, `cargo fmt --check` rc=0, `check:tree` rc=0 | **verified (con límites declarados)** — E2E desktop `mugen-import` verde 2026-09-29T02:46Z–02:47Z sobre o binario SHA-256 `1b46ff50…`: importación pola UI (wizard -> perfil `mugen` -> Importar), panel coas 7 categorías e resumo «12 funcionam igual, 0 con diferenca, 1 precisam de ajuste seu, 0 non convertidos», Build & Run real co personaxe no canvas 320x224 (mostra en (96,96): idle0=11, idle1=14), edición +44 no Inspector -> Salvar -> reinicio -> reapertura -> ROM distinta (`10658a6c` vs `5a6aff76`) co personaxe na posición nova e a vella baleira, e negativo `../fora.sff` recusado con mensaxe específica sen cartafol desta execución e sen mover o proxecto activo. **Non conta como fluxo completo**: SFF v2, som, stage e colisión lóxica seguen fóra, o comando por teclado e o golpe só teñen proba técnica/core, o informe non ten reapertura futura e o Inspector etiqueta «FPS» unha animación MUGEN. O degrau **non se promove** (ordem do operador). Condición do host e dous achados do harness en `.../e2e-e-host.md` |

Regras desta matriz: o registro canônico é `crates/registry.json` (schema
`rex-crate-registry/v1`), consumido por `npm run check:tree` e por
`npm run crates:gates`; o CI chama esses gates nos dois jobs
(`.github/workflows/ci.yml`, passo *Crate package gates*), que disparam em
todo push/PR — não há filtro de caminho a afrouxar. Não existe `Cargo.toml` de
workspace na raiz, e não se cria um para fazer pacote standalone compilar.
ROMs comerciais e corpus BYOR continuam fora da árvore: comparação com
ferramenta externa vive no script do perfil, identificada à parte. A gate de
árvore é duplicada (`check-tree.cjs` + `check-tree.ps1`) e imprime caminhos como
literais POSIX nas duas — nem a saída nem o veredicto podem depender do SO que
roda o CI (reparo `882272c`; paridade medida com `pwsh 7.6.6` e não-vacuidade por
mutação em
`data/rex_profiles/integrator/crates_registry/evidence/2026-09-28-gate-cross-platform/`).

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
| edição **contextual** pela interface (célula do mapa → pixel de fonte → impacto → resultado) | verified (fixture autoral aPLib, com reexecução do caso BYOR) | cenário E2E `rex-context-fixture-effect` (`scripts/e2e-tauri-build-run.mjs`) no binário real `f56be451…` (rc=0, 17 passos, 15 638 ms): a barra localiza o TileSet **sem receber offsets** (`0x5fa38 — aplib · 16 tiles (stream 169 B)`), monta o contexto com identidade, vínculos e proveniência por vínculo, e a camada composta **lida do `<img>` do WebView** é igual ao esperado do oráculo externo no empacotamento correto (RGB `7dc94b02…`; alpha provado à parte, **0** divergências RGBA). Os quatro cliques sob as quatro transformações (`B`,`H`,`nenhum`,`V`) resolvem o **mesmo** pixel de fonte (`tile 2, linha 4, coluna 7`, índice atual 11) e a barra diz `4 ocorrências neste mapa verificado`, nomeando o escopo (TileMap `0x174f6`). Uma edição aplicada pela transação canônica muda **exatamente** as quatro posições previstas — `(0,3) (56,4) (23,12) (47,27)` —, com 129 bytes alterados, **0** fora de `[0x5fa38, +169)` e o único byte do tileset em `0x5fa57`; cópia `1d6da6d9…`, BPS `2fafda41…` re-aplicado reproduzindo o hash da cópia, salvar/reabrir restaura com identidade **revalidada** (não reusa prévia em cache). Cada expectativa vem de receita autoral: o **consumo medido** pelo oráculo (`apj.jar` `2d8cdc63…`, 169 B) é o que a barra anuncia, e o **array linkado** do `symbol.txt` (170 B) fica registrado com a cauda conferida byte a byte como padding — a primeira versão desta perna cobrava 170 na barra e estava errada (log `e2e-run2…` no pacote). **Seis negativos obrigatórios, todos asserções**: ghost sem vínculo, tile fora do conjunto (`são 16 tile(s), numerados de 0 a 15`), identidade trocada na leitura e na escrita, resposta obsoleta no mesmo tick e descarte por troca de ROM; clique fora da camada recusado com a seleção preservada. **Dois são inalcançáveis pela UI nesta fixture por construção** (a referência inválida e o banco sem cores vivem em `ctx_ghost`, que o linker deixou **sem** struct `Image`) e por isso seguem provados no núcleo (`composicao_recusa_referencia_fora_do_tileset_em_vez_de_pintar_ruido`, `composicao_recusa_banco_que_a_paleta_nao_tem_cores`) — atribuição registrada, não sucesso de interface. **Dois defeitos reais só apareceram porque a interface mediu** (log de cada falha versionado no pacote): (1) o preflight `img{max-width:100%}` com item de flex encolhendo achatava só a largura — pedido 4x de uma camada 120x72 desenhava `193,66x288`, pixel deixava de ser quadrado e `pixelated` perdia o efeito (`16ce6bf`, com `getBoundingClientRect` assido no E2E e o contrato de CSS pinhado no unitário); (2) a transação conferia a identidade **depois** da varredura dos candidatos, então com outro arquivo no caminho a recusa levava >60 s e vinha como "recurso não verificado nesta ROM" — sintoma, não causa (`e44f39d`, teste escrito RED primeiro com offset de outra ROM, e a perna 11 assere a recusa em ≤1,5 s com `nada foi varrido e nada foi escrito`). **Caso BYOR reexecutado contra este binário** (`rex-aplib-byor-effect`, rc=0): os artefatos voltam **idênticos** aos pinados das pernas 2/3 — cópia `80249128…`, BPS `58ae4f0b…` reaplicado, 800 bytes distintos, **0** fora de `[0x2e12a, +938)`, 163 preservados, índice 0 produzindo a cópia `69389ec2…` que o core já executou — e a perna 14 do cenário contextual abre o BYOR pelo produto declarando a prévia como **camada reconstruída** (`1018 ocorrências neste mapa verificado`, TileMap `0x21b28` de 1120 células), com as oclusões não modeladas explícitas na barra. Pacote com manifesto amarrado ao SHA do binário: `data/rex_profiles/integrator/context_fixture/evidence/2026-09-27-interface/`. **O que esta célula NÃO alega**: que a camada é o framebuffer do jogo (não há sprites, janela, raster, scroll nem segunda camada modelada); que a contagem valha para o jogo inteiro; que "Verificada" prove que o jogo carrega ou exibe o recurso (ela nomeia o que foi conferido e o que ficou de fora); edição de uma única ocorrência (não existe controle — sem duplicação e realocação seria destrutivo); composição do bit de prioridade; nada de promoção de maturidade (frente `Experimental`, sem merge, sem release) |

Limitações declaradas: identificação é estrutural assistida (header declara
codec e tamanho), não descoberta automática geral; stream editado recusado
quando outros recursos dependem dos bytes originais (equivalência global de
decode verificada no teste); sem expansão de ROM, realocação ou edição de
ponteiros no v1.

Propriedade e integração (2026-09-26, emendado 2026-09-28): as suítes da
agente-A e da agente-B continuavam **não integradas** a este tronco — seguiam
nos worktrees de cada uma. Do que a B produziu, o integrador apenas
**vendorou a ferramenta de medição** (68k + jar + MAME) com proveniência e
SHA-256 por arquivo em
`scripts/rex_profiles/integrator/lz4w_68k/PROVENANCE.md`; nada de lá entra no
produto. Evidência do integrador vive em namespace próprio
(`data/rex_profiles/integrator/…`), sem invadir os namespaces `addressing/` (A)
e `codecs/` (B) do CONTRACTS v1.

Emenda 2026-09-28: duas **bibliotecas standalone** dessas frentes passaram a
existir neste tronco — `crates/rex-kosinski` e `crates/rex-addressing`,
registradas em `crates/registry.json` e com gates próprios medidos (ver a
matriz de `crates/` acima). Isso é degrau de biblioteca, **não** integração.
Emenda da emenda (2026-09-28, rodada de integración da frente A): essa frase já
não vale para os dois. `crates/rex-addressing` **foi integrada ao backend** —
path dependency em `src-tauri/Cargo.toml`, adaptador em
`src-tauri/src/tools/reverse/decomp/rex_addressing.rs` e comando Tauri
`rex_addressing_read_snapshot` com 17 testes próprios; a linha de
`src-tauri/src/tools/reverse/decomp/` foi tocada por essa entrega (o adaptador,
`mod.rs`, `lib.rs`, `Cargo.toml`/`Cargo.lock`).
Emenda da emenda da emenda (2026-09-28, perna B): o mesmo passa a valer para
`crates/rex-kosinski` — path dependency (`Cargo.lock` +5 linhas, só a entrada
local), adaptador em `src-tauri/src/tools/reverse/decomp/rex_kosinski.rs` e
**dous** comandos Tauri (`rex_kosinski_decode`/`rex_kosinski_encode`, HEAD do
commit `3428b69`) com 16 testes próprios; decodificar e codificar quedan como
operacións separadas e o contenedor `edit` segue declarado como non exposto.
O degrau `fluxo do usuário comprovado` segue bloqueado para **ambos**: nada na
interface chama os comandos. O WIP de encoder da B deixou de estar fora: a
entrega `0b752b7..6a2218e` (encoder v1 + 52 fixtures vendorizadas) entrou por
`cherry-pick -x` con paridade byte-exata. O produto segue sen reinserción
Kosinski nas súas transacións canónicas.

## Histórico da rodada

- 2026-09-29 (integrador, **PR #85 MUGEN -> SGDK integrado no tronco — sen merge
  no remoto e sen promoción de maturidade**), esta célula é o checkpoint.
  **HEAD de partida:** `e319fb9` (tronco do integrador, xa con `rex-gameplay`
  integrado). **Ordem recebida:** "Revisar e integrar o PR draft #85 MUGEN -> SGDK,
  sem merge automatico… Reexecutar no destino… Validar especificamente: falha de
  importação não deixa projeto fantasma; relatório de compatibilidade aparece na
  UI; sucesso resume perdas; paths fora do pacote são recusados; projeto anterior
  aberto não muda após falha; personagem aparece no core; edição no Inspector
  persiste após salvar, reiniciar e reabrir… Entrega: PR integrado ou relatório de
  bloqueios. Sem release, sem promoção de maturidade."
  **Revisión das 5 superficies centrais (reservadas ao integrador):**
  `src-tauri/src/lib.rs` (+91/-14: envolve a importación, chama
  `discard_failed_import(project_dir, origin)` segundo a orixe reservada do
  cartafol e fusiona `mugen_profile::summary_line()` no aviso de éxito, nas dúas
  vías de importación externa), `src/App.tsx` (+74: estado `mugenCompatibility`,
  panel, `__RDS_E2E__.setNextExternalImportPath`, `testid` de confirmación),
  `src/core/diagnostics.ts` (+45/-2: `mugenImportCause()` con causa + acción para
  os catro casos e peche «Nenhum projeto foi criado.»),
  `scripts/e2e-tauri-build-run.mjs` (+291/-2: escenario `mugen-import`) e
  `src-tauri/Cargo.toml`. **Conflito:** un só, de 2 liñas de path-deps; resolto
  conservando `rex-kosinski`, `rex-gameplay` e `rex-mugen`, sen apagar avanço do
  integrador (`git diff --diff-filter=U` = 0 e ningún marcador na árbore).
  **Commits desta célula:** `b410de0` (merge curado, pais `e319fb9` + `bd02e3c`,
  índice de 72 ficheiros / +7910 / -88) e o commit de curaduría que rexistra esta
  célula, reescribe `crates/registry.json` e reforza o harness. **O PR #85
  mantense draft no remoto e non se lle tocou nada além de o referenciar.**
  **Publicación (ordem do operador, 2026-09-29):** tronco
  `codex/rex-integrator-crates-registry` adiantado en fast-forward
  `00f9d29..e319fb9` antes do push, e **PR #86** aberto con head
  `codex/rex-integrator-mugen-85 @ d36df92` (base o tronco, 24 commits, 113
  ficheiros, +18009/−90, non draft, `MERGEABLE`/`CLEAN`) coa descrición
  obrigatoria completa. **CI terminal en `d36df92`, consulta pontual:** runs
  `36542842781` e `36542937864` (CI, `validate`+`linux-validate`) e
  `36542842770` e `36542937819` (Desktop E2E, `desktop-smoke`) — todos
  `completed`/`success` entre 08:27:33Z e 08:52:05Z; `CodeRabbit` `pass`,
  `Sourcery` `skipping`. **Segunda medição tras o fast-forward
  `d36df92..eaf980c`** (só os dous documentos de estado): `CI` `36546968827`
  (push) + `36546969248` (PR) e `Desktop E2E` `36546969249` (PR)
  `completed`/`success`; non hai run `Desktop E2E` de push porque o `paths:`
  dese disparador non inclúe `docs/`. **Sen merge: #86 queda aberto para
  revisión humana.**
  **Barra no destino (todos rc=0):** `check:tree`, `lint`, `tsc --noEmit`,
  `npm test` **812 passed / 0 failed / 6 skipped** (83 ficheiros passed | 1
  skipped; +5 respecto da base: panel + diagnostics), `cargo fmt --check`,
  `cargo clippy --lib -- -D warnings`, `cargo clippy -- -D warnings`, `cargo test
  --lib` **796 executados / 0 fallos / 70 ignorados** e `npm run crates:gates` cos
  4 paquetes. **Reexecución sobre a árbore final curada (2026-09-29T03:00Z–03:17Z
  UTC, despois de reescribir o rexistro e de reforzar o harness):** todos os
  gates volven dar rc=0 coas mesmas contaxes (812/0/6 e 796/0/70), `node --check`
  do harness rc=0, e `npm run host:certify` rc=0 co host **READY** (fingerprint
  `60249508…`, lock `dd99a22f…`) e o smoke oficial SGDK/PVSnesLib `Success: true`
  (`src-tauri/target-test/validation/upstream-validation-linux.json`). O E2E **non**
  se volveu executar: entre run7 e esta reexecución só mudaron
  `crates/registry.json`, `docs/rex_profiles/ROUND_STATE.md`,
  `docs/06_AI_MEMORY_BANK.md` e a aserción do harness que run7 xa levaba aplicada;
  ningún byte de produto, de fixture ou do escenario cambiou. Evidencia desa reexecución:
  `data/rex_profiles/mugen_sgdk/evidence/2026-09-29-pos-curaduria/`. **Reconciliación independente da contaxe:** base `a08c2c6` 770/66 +
  PR 15 executados/3 ignorados (os 18 `#[test]` de `mugen_profile.rs`, 3 deles
  `#[ignore]` para a proba real SGDK) + integrador 11/1 (`project_mgr.rs` +1,
  `rex_gameplay.rs` +11/+1) = 796/70; os 781/0/69 que anunciou a fronte son unha
  medición anterior á súa propia entrega (o seu `REPORT.md` xa di 785/0/69).
  **Débeda anterior, non atribuíble ao PR:** `cargo clippy --all-targets` no
  backend reproba con 46 avisos en código `#[cfg(test)]` de `rex_context` (18),
  `rex_aplib` (8), `rex_resources` (5), `project_mgr` (5), `rex_codecs` (4) e 1
  cada un en `logic_recovery`, `holdout`, `graphics_discovery`, `lib.rs:165` e
  `build_orch:5227`; cruzadas as 45 localizacións únicas co conxunto de liñas
  engadidas polo PR, **0** caen nelas. Rexístrase e non se corrige nesta rolda
  (atribúese, non se arrecula o avance alleo).
  **E2E desktop `mugen-import` (run7, verde 2026-09-29T02:46Z–02:47Z, binario
  SHA-256 `1b46ff50…`):** as 7 validacións pedidas quedan provadas — (1) a falla
  non deixa projeto fantasma (`failed_import_does_not_leave_a_project_that_looks_valid`,
  `failed_import_into_existing_empty_dir_keeps_the_dir_empty` e, no E2E, a
  comprobación explícita de que `Mugen_Escape_1790650044699` non existe no disco);
  (2) o relatório aparece na UI (tests do panel + asercións DOM no E2E coas 7
  categorías `{sprites/animations/commands/states: direct, collisions: manual,
  sound/stage: absent}` e texto cru de 15 527 caracteres); (3) o éxito resume
  perdas (`successful_import_summarizes_losses_by_category`,
  `sentinel_summary_exposes_every_loss_class` e o console
  `[MUGEN] probe (Experimental): 12 funcionam igual, …`); (4) os caminhos fora do
  paquete recusanse (`negative_path_escaping_the_package_is_refused`,
  `negative_logic_file_outside_the_package_is_refused`,
  `negative_oversized_air_is_refused`, `negative_cell_over_budget_is_refused` +
  o negativo do E2E); (5) o projeto aberto anterior non muda (`activeProjectDir`
  invariado — **só probado no E2E**, non hai test Rust para isto); (6) o
  personaxe aparece no core (Build & Run real, mostra no canvas 320x224 en
  (96,96): idle0=11, idle1=14; a proba `mugen_probe_real_build_run_edit_and_effect`
  segue `#[ignore]`); (7) a edición persiste tras salvar/reiniciar/reabrir (+44 no
  Inspector, x=140 tras a reapertura, ROM `10658a6c` vs `5a6aff76`, personaxe na
  posición nova e vella baleira — **só probado no E2E**).
  **Dous achados do propio harness (superficie do integrador):** a aserción do
  projeto fantasma comparaba só o *conteo* de cartafoles `Mugen_Escape_*` e non era
  discriminante se xa existía un de outra execución — agora exixe ademais que o
  `escapeName` desta execución non estea no disco; e tras o reinicio do E2E queda
  unha instancia de `retro-dev-studio` viva (pasou en run4 e run7), rexistrada como
  límite sen corrixir nesta rolda. O cartafol `Mugen_Escape_1790639205721` que
  aínda existe en `~/Documents/RetroDevProjects` **non é un fantasma MUGEN**: o seu
  `project.rds` di `template_id = "starter_guided"`, `source_kind = "builtin"`,
  `imported_at_ms = 1790640543662`, é dicir, creouno o onboarding da rolda da
  fronte a partir dun nome de wizard pendurado. Non se borrou.
  **Condición do host:** o output primario pasou a ser un panel rotado
  `1280x800+0+0` e o compositor recorta alí as xanelas, así que o redimensionado a
  1920x1080 CSS era imposible (`inner=948x564`, factor físico/CSS 1,35). Un vixía
  temporal fóra do repo colocou **só a xanela da app de proba** no monitor externo
  (`3456x1458+1281+0`, físico 2592x1458 = 1920x1080 CSS) para reproducir o mesmo
  viewport da proba da fronte; non se mudou a configuración de pantallas do
  operador nin se alterou o harness para aceptar outra xeometría.
  **Limites rexistrados (o que non se alega):** SFF v2, som, stage e colisión
  lóxica seguen fóra; o comando por teclado e o golpe son proba técnica/core, non
  de UI; o relatório non ten reapertura futura; o Inspector usa a etiqueta «FPS»
  para unha animación MUGEN; non se copia o runtime C `mg_*` (base HAMOOPIG de
  terceiros, licenza non verificada — `docs/rex_profiles/mugen_sgdk/AUDIT.md`) e
  non se asume licenza estra; **a promoción de degrau e a decisión de licenza e
  fluxo de usuario quedan en mans do operador**.
  **Evidencia:** `data/rex_profiles/mugen_sgdk/evidence/2026-09-28-integracao-integrador/`
  (logs por paso, informe do E2E, 6 capturas, `LEIAME-e2e-e-host.md` cos descartes
  e `SHA256SUMS` de 26 ficheiros) e `data/rex_profiles/mugen_sgdk/evidence/2026-09-29-pos-curaduria/`
  (reexecución da barra, `LEIAME.md` con rc/comando/log/medida por gate e
  `SHA256SUMS` de 11 ficheiros).

- 2026-09-28 (integrador, **perna B2 — `crates/rex-kosinski` sobe a `backend
  integrado`, e só a ese degrau**), esta célula é o checkpoint. **HEAD de
  partida:** `ddab0ac` (a entrega `0b752b7..6a2218e` de B xa estaba integrada e
  rexistrada). **Ordem recebida (mesma misión):** "B — decoder/encoder
  Kosinski… adaptar limites e erros ao contrato de codecs existente
  (`CodecError { code, detail }`), preservando a distinción entre decodificar,
  codificar e reinserir… Integre e valide unha frente por vez… Prossiga até os
  adaptadores testados e a entrega publicada."
  **Commits desta célula:** `3428b69` (adaptador + path dep + dous comandos
  Tauri rexistrados), `9894e88` (evidencia) e `4daefe8` (rexistro e matriz).
  **Medido:** dous RED observados antes de produción (capa codec: E0432 `rc=101`;
  capa IPC: E0432 para `ipc_decode`/`ipc_encode`, `rc=101`); GREEN **16/16** (10
  codec + 6 IPC) con esperas independentes rexistradas por B e confirmadas no
  oráculo koscmp (abcdef.kos → `b"ABCDEF"` con `bytes_consumed=11`; sonda
  `0200ffff` → `invalid_reference`; `[0xff]` → `truncated`; espido →
  `empty_input`; `max_output=5` → `excessive_output`; `max_work=3` →
  `work_limit`; `encode(b"")` → `020000F000`). Non-vacuidade: M1 (mapeo
  `empty_input`→`truncated`) matou 1, M2 (`bytes_consumed` da resposta IPC =
  lonxitude do stream) matou 1, M3 (`stream_limit`→`work_limit`) matou 2;
  restauración conferida por SHA-256 (`3b4115ab…d45eb4e2` idéntica) e 16/16
  verdes outra vez. **Gates no destino:** `cargo test --lib` **770 / 0 / 66**
  (base 754 + 16), `clippy --lib -D warnings` rc=0, `fmt --check` rc=0,
  `check:tree` rc=0, `lint`/`tsc --noEmit` rc=0, `npm test` **749 / 6 / 755**
  rc=0 sen cambios de frontend. `Cargo.lock`: +5 liñas, só a entrada local
  `rex-kosinski` sen campo `source`, cero crates externos novos.
  **O que se expón:** dous comandos Tauri reais (`rex_kosinski_decode`,
  `rex_kosinski_encode`), operacións separadas, erros viaxan como
  `CodecError { code, detail }` traducido 1:1 a `InspectionError` (código e
  detalle preservados, `retryable=false`), limites explícitos cos defectos do
  contrato (4 MiB / 64 M).
  **O que NON se expón nin se alega:** o contenedor `edit::build/open/reinsert`
  segue sendo proba de contrato — a transación canónica do produto aínda non
  consome Kosinski, polo que a distinción decodificar/codificar/reinserir
  presérvese por exclusión declarada; non hai fluxo do usuario (ninguén chama
  os comandos desde a interface), non hai corpus BYOR no gate, non se alega
  descuberta de recursos, e `rex-kosinski` segue **Experimental**. Sen merge,
  sen release, sen promoción além do degrau medido. **Licenza:** segue decisión
  do operador (`UNLICENSED`, `source: workspace`).
  Evidencia con manifesto e SHA por ficheiro en
  `data/rex_profiles/kosinski_runtime/evidence/2026-09-28-adaptador-backend/`
  (autocomprobada: 4 artefactos listados, 4 presentes, 0 diverxencias).

- 2026-09-28 (integrador, **perna `aceite-integrado` — a rolda de invariantes e
  vectores de aceite da fronte A entra no tronco e repárase a débeda da propia
  promoción**), esta célula é o checkpoint. **HEAD de partida:** `6c3ea0e`.
  **Como se descubriu:** ao consultar o tip de A despois de publicar o rexistro,
  `git ls-remote` deu `0e5f804` en `codex/rex-rust-addressing` — cinco commits
  mais recentes ca pin `30cb311` integrado ás 08:13Z, publicados entre 11:03Z e
  11:23Z mentres este integrador medía os gates do adaptador. **Que había:**
  `tests/acceptance.rs` (1 783 liñas) con 15 casos en
  `vectors/acceptance-v1.json` (18 774 B, SHA-256 `54ba2b6e…a216` pinado dentro
  do propio test), máis `INVARIANTES.md`, `ACEITE-ADAPTADOR.md`,
  `RELATORIO_ACEITE_ADAPTADOR_2026-09-28.md` e dúas correccións de forma. O
  esperado non sae das fórmulas dos perfís: sae dun oráculo independente (motor
  de xanelas declarativo, táboa `boards.bml` de bsnes con SHA `2de90492…` e
  modelo GPGX para SSF2), e rexenerar o JSON require `REX_ACEITE_ESCRIBIR=1` con
  `--ignored`, que non se executou. **Como entrou:** `0a371b7` e `d7e3925` tocan
  o crate, que na árbore de A aínda vivía en
  `scripts/rex_profiles/addressing_runtime/rex-addressing/`; aplicáronse con
  `git show` e reescrita desa ruta a `crates/rex-addressing/`, conservando autor,
  data e mensaxe e engadindo `(cherry picked from commit …)`. `cc8026c`,
  `785320c` e `0e5f804` son de solos `docs/` e entraron por `cherry-pick -x` sen
  conflitos. Locais: `10a8f5d`, `32d2e26`, `42756e2`, `d252a5f`, `aa46265`.
  **Achado sobre o meu propio traballo (débeda da promoción, non de A):** a
  promoción `9f83d15` moveu 41 ficheiros, pero o cherry-pick da etapa 4
  recreara `examples/resource_report.rs` na ruta vella. O paquete graduado ás
  08:14Z non tiña exemplo e `clippy --all-targets` nunca o lintou; e catro
  ligazóns relativas do README do paquete (`../../../../docs/…`) apuntaban tres
  niveis por riba da raíz desde o movemento. Reparado en `daefb43`: exemplo
  movido (blob idéntico `7f9a8f5b…` nas dúas puntas), ligazóns revalidadas con
  0 rotas, receitas `cd scripts/…` de `ACEITE-ADAPTADOR.md` §3 e
  `EXEMPLO-CONSUMIDOR.md` postas a `cd crates/rex-addressing` (rompeunas a miña
  promoción, non A) e `CONTRATO.md` §0.1 — nota miña — deixa de afirmar que nada
  no produto consome o paquete. A narración histórica e os rexistros de comandos
  co worktree de A (`/home/misael/RDS-REX-A2-RUST-ADDR/…`) mantéñense tal cales:
  evidencia pasada non se reescribe. **Medido, non narrado:**
  `npm run crates:gates` rc=0 con **rex-addressing 138 executados / 0 falhas /
  10 ignorados en 17 targets** (exactamente os números que A publicou na súa
  árbore, xa co exemplo dentro do paquete) e **rex-kosinski 25 / 0 / 0 sen
  cambios**; o exemplo executado desde `crates/rex-addressing` dá rc=0 co seu
  resumo (`13` lecturas, `14` recusas, 7 códigos, `resumo sha256=27bebc7b…`);
  `npm run check:tree` rc=0 (o directorio vello xa non existe), `cargo fmt
  --check` rc=0, `cargo clippy --lib -- -D warnings` rc=0 e `cargo test --lib`
  con **754 / 0 / 66** e `CARGO_RC=0` — as 17 probas do adaptador seguen verdes
  co crate reconstruído e o SHA do adaptador (`7bd75ea9…`) non cambiou. A barra
  de frontend de AGENTS.md re-executada no HEAD final desta perna (`1f30467`) dá
  rc=0 nos tres comandos (`lint`, `tsc --noEmit`, `npm test` con **749 pasados /
  6 saltados / 755**), entre as 12:18:14Z e as 12:20:26Z, despois do último
  commit de docs — ningún ficheiro de frontend se tocou aquí; execútase porque
  a promoción do paquete non debe regredila. Paridade
  conferida ficheiro a ficheiro: 42 ficheiros no paquete de A, 42 neste tronco,
  cero diferenzas de nome, única diferenza de contido o README coa miña nota de
  localización; árbore graduada `9101cfb5…`. **Un fallo meu de captura,
  rexistrado co log:** a primeira carreira da suíte pipesouse a `tail -30`, polo
  que o seu `TEST_LIB_RC=0` era o código de saída de `tail`; conservouse como
  `captura-defectuosa-rc-do-pipeline-e-tail30.log` e a carreira autorizada é
  `cargo-test-lib-pos-aceite.log`. **O que NON se alega:** os vectores de aceite
  gradúan `read_resource`/`read_sequence`, superficies que o adaptador non
  expón, así que non son evidencia do adaptador nin suben ningún degrau;
  `backend-integrado` queda onde estaba, `fluxo do usuario` segue bloqueado, non
  hai corpus BYOR no gate e non houbo merge, release nin promoción de
  maturidade. Evidencia con manifesto e SHA por ficheiro en
  `data/rex_profiles/addressing_runtime/evidence/2026-09-28-aceite-integrado/`
  (autocomprobada con `gates-de-frontend-no-head-final.log` dentro: 7 artefactos
  listados, 7 presentes, 0 diverxencias).

- 2026-09-28 (integrador, **rodada de integración da frente A — `crates/rex-addressing`
  sobe de `gates propios aprobados` a `backend integrado`, e só a ese degrau**),
  esta célula é o checkpoint. **HEAD de partida:** `8a28909`. **Ordem recebida:**
  "GO para retomar a integración. ORDEM 1. A — endereçamento + lector de recursos.
  2. B — decoder/encoder Kosinski. Integre e valide unha frente por vez na súa
  branch de integración. Sen merge de PR, release ou promoción de maturidade", coa
  división de responsabilidade que reserva ao integrador "o contrato do adaptador,
  manifests/lockfiles compartidos, rexistro dos módulos, backend e IPC" e deixa
  "os arquivos internos dos propios paquetes" en mans de A e B. As decisións de
  contrato xa autorizadas executáronse tal cal: o crate segue sen Tauri e sen
  serde (a serialización fica no adaptador, coas convencións actuais do produto),
  os erros internos viran erros estruturados "preserve código e detalles úteis,
  sen transformar toda falla en texto xenérico", perfil e estado do mapper son
  explícitos ("non autodetectar perfil silenciosamente"), "a primeira integración
  pode expoñer apenas o snapshot fixo, declarando a outra como aínda non exposta",
  "a identidade da ROM é verificada na fronteira de acceso aos bytes" e "retorne
  bytes e proveniência dos segmentos efectivamente lidos". **Usouse a entrega mais
  recente de A, incluidas as súas dependencias:** fetch pontual antes de integrar
  conferiu que o tip de `codex/rex-rust-recursos` (PR #83) seguía en `30cb311`, e
  os 7 commits `58a06dd..30cb311` entraron por `cherry-pick -x` como
  `cde721c..8a28909`; non se integrou "só a biblioteca antiga" — a capa de lectura
  de recursos con procedencia (etapa 2), a batería discriminante (etapa 3), o
  exemplo consumidor (etapa 4) e a varredura *nunca panica* (etapa 5) van todos na
  branch. **Commits desta célula:** `16e22e9` (path dependency + adaptador +
  comando Tauri), `b2f6d45` (23 artefactos de evidencia con SHA por arquivo) e
  esta célula (rexistro + matriz). **Medido, non narrado:** gates do pacote
  `fmt`/`clippy --all-targets`/`test --locked` rc=0 con **127 executados / 0 fallos
  / 9 ignorados** (a carreira de 02:58Z dava 81 antes das etapas 2–5); adaptador
  con **17 probas / 0 fallos**; `cargo test --lib` **754 / 0 / 66 ignorados**
  (754 − 17 = 737, a base previa); `cargo clippy -- -D warnings` rc=0;
  `cargo fmt --check` rc=0 (a primeira carreira deu FMT_RC=1 con 3 diffs no
  ficheiro novo, rexistrado co fallo); `check:tree`, `eslint`, `tsc --noEmit` e
  `npm test` (**749 / 0 / 6 saltados**, 79 ficheiros verdes + 1 saltado) todos
  rc=0; `npm run host:diagnose` rc=0 con `status: ready` e fingerprint `60249508…`
  inalterado; `cargo audit` rc=0 con 496 dependencias e os mesmos 8 avisos
  permitidos. **Non-vacuidade:** RED observado antes de implementar (16 fallos) e
  tres mutacións da capa de adaptador — garda de identidade anulada (mata 1),
  `rom_offset` substituído polo enderezo do bus (mata 2), erros do núcleo achatados
  nun código xenérico (mata 8) — con restauración conferida por SHA e M1
  re-executada despois do reparo de hixiene. **Un achado propio, corrixido con
  TDD:** as probas do adaptador deixaban 512 KiB–1 MiB por test en `/tmp` (143
  directorios contados a medio camiño). Escribiuse primeiro a proba que fallaba
  («a fixture temporal descártase ao saír do alcance», log do fallo con camiño
  literal) e despois o garda; re-execución: antes=160 / depois=160 directorios,
  cero filtracións novas. **O que a entrega di do produto:** `Cargo.lock` pasa de
  495 a 496 entradas `[[package]]`, só o crate local sen campo `source` (cero
  dependencias externas novas), e `rex-addressing` entra no inventario de licenzas
  como `source: workspace` co `license: UNLICENSED` que o paquete xa declaraba —
  non se escolleu ningunha licencia por suposición. **O que NON se alega:**
  `fluxo do usuario comprobado` segue bloqueado (ningún chamador da interface usa
  `rex_addressing_read_snapshot`, non hai pantalla de endereçamento); non se
  alega descuberta de recursos nin lectura sobre xogos reais (as únicas imaxes
  lidas son fixtures autoriais, cero corpus BYOR no gate); `read_sequence`, as
  escritas puras e os tres perfís SNES quedan declarados como non expostos, e a
  negativa non é un oco de implementación: é a fronteira de identidade do produto
  (`rex_read_rom` + `platform::identify_md`) que só dá fe en imaxes Mega Drive.
  **Dous fallos rexistrados como fallos:** `cargo clippy --all-targets -- -D
  warnings` dá rc=101 con 45 lints en código de proba alleo (`rex_context.rs` 18,
  `rex_aplib.rs` 8, `rex_resources.rs` 5, `project_mgr.rs` 5, `rex_codecs.rs` 4,
  1 en cada un de `logic_recovery.rs`, `holdout.rs`, `graphics_discovery.rs`,
  `lib.rs`, `build_orch.rs`; **0 en `rex_addressing.rs`**) — non se tocou esa
  deuda, que non é desta entrega nin da barra do proxecto; e
  `npm run security:audit` dá rc=1 por `EALLOWSCRIPTS`, config do host anterior e
  allea (ningún ficheiro npm se modificou nesta entrega). **Achado de proceso:** `/tmp`
  purgouse a metade da rodada; os 17 artefactos xa estaban copiados no repositorio
  cando ocorreu e as seis medicións posteriores volveron executarse escribindo
  directo no directorio de evidencia. **Pendente para a seguinte perna (frente B):**
  o empacotamento que se lle pedía a B está feito por ela mesma no seu branch
  (tip `6a2218e`: 52 fixtures con SHA-256 dentro do pacote, `fixtures/PROVENANCE.md`
  e o reconto do package list conferido con `git archive`); o que fica aberto é a
  **licenza**, que é decisión do operador, non do integrador. Integrar B exige
  adaptar limites e erros ao contrato de codecs existente
  (`CodecError { code, detail }`), preservando a distinción entre decodificar,
  codificar e reinserir; o exemplo de edición en contedor non substitúe a
  transacción canónica. **Nada aquí é merge nin release:** os commits entraron un
  a un con `cherry-pick -x` e `crates/rex-addressing` segue `Experimental`.

  **Emenda (12:14Z, mesma sesión):** o «entrega mais recente» que aquela célula
  rexistraba era `30cb311`. Entre 11:03Z e 11:23Z A publicou cinco commits mais
  en `codex/rex-rust-addressing` (`0e5f804`: rolda de invariantes e vectores de
  aceite do adaptador), xa integrados na célula anterior desta lista. O pino
  conferíase de forma pontual en cada integración — non había ningún monitor
  vixiando a branch de A, e iso é o motivo polo que a emenda fai falta.


- 2026-09-28 (integrador, **rodada `crates/` — a árvore formalizada e duas
  bibliotecas standalone integradas uma por vez, sem promover nenhuma a
  "integrada ao produto"**), esta célula é o checkpoint. **HEAD de partida:**
  `9b27941`, sobre branch própria `codex/rex-integrator-crates-registry`.
  **Ordem recebida:** "A continuará com leitura de recursos através dos perfis de
  endereçamento. B continuará com codificação Kosinski e prova de edição sobre
  fixture autoral. Ambos trabalharão em módulos e evidências próprios. Reserve
  para si manifests compartilhados, registro de módulos, IPC, UI, harness
  principal e documentos de estado. Integre uma entrega por vez; não espere a
  conclusão das duas para começar a revisão. Formalize crates/ nas convenções do
  projeto, preservando a finalidade de check:tree", seguida da decisão em sete
  itens — "crates/ será a localização oficial das bibliotecas Rust independentes,
  com gates próprios. Integração ao aplicativo será uma etapa posterior", "Não
  permita qualquer diretório indiscriminadamente", "Não crie Cargo.toml de
  workspace na raiz apenas para fazê-los compilar", "Um pacote esperado ausente
  deve reprovar, não ser silenciosamente ignorado", "Não registre 'integrado ao
  produto' só porque o pacote compila" e "Diferencie na matriz: biblioteca
  implementada → gates próprios aprovados → backend integrado → fluxo do usuário
  comprovado". **Commits desta célula:** `7115fc3` (formalização),
  `96dbd20`+`f58ff05` (os dois commits da entrega B, por `cherry-pick -x`),
  `6a43c53` (pacote registrado + cadeia de fixtures fechada), os 17 commits da
  entrega A `9bec531..0a3ac83` (também `cherry-pick -x`, zero conflitos) e
  `9f83d15` (promoção de `rex-addressing` para `crates/` + registro com gates
  medidos), `a556e86` (esta célula: matriz, checkpoints e barra medida),
  `882272c` (o reparo cross-platform da própria gate, achado pela CI) e
  `1abad5d` (o registro do veredito por SHA). **Nada aqui é merge:** os dois pacotes entraram commit a commit, com
  autoria e mensagem preservadas, e as branches de cada frente continuam sendo o
  dono do resto do trabalho delas.

  **Item 1 — `crates/` formalizado sem afrouxar a gate.** `docs/08_TREE_ARCHITECTURE.md`
  passa a descrever `crates/<nome>/` (com `Cargo.toml`, `src/`, `examples/`,
  `tests/`) e `crates/registry.json` + `crates/README.md`, com quatro bullets de
  regra de inserção (local oficial sem workspace na raiz; registro obrigatório antes
  de o diretório existir; nada de `target/`, ROM ou corpus BYOR em `crates/`;
  integração ao produto é etapa posterior e separada). `scripts/check-tree.cjs` e o
  espelho `.ps1` aceitam `crates/` **condicionalmente ao registro**: diretório em
  `crates/` sem entrada no registro reprova; entrada registrada sem `Cargo.toml`
  reprova; arquivo solto dentro de `crates/` que não seja o registro nem o README
  reprova; todo o resto da verificação de primeiro nível continua igual. Nove testes
  em `scripts/check-tree-crates.test.mjs`, incluindo o que exige que as **duas
  implementações** (cjs e ps1) aceitem o mesmo conjunto de diretórios — a gate
  duplicada não pode divergir. Os dois últimos testes nasceram justamente da
  divergência que a própria CI achou, registrada abaixo.

  **Itens 2 a 4 — registro e gates próprios, com ausência reprovando.**
  `crates/registry.json` (schema `rex-crate-registry/v1`) é a fonte única da lista
  de pacotes; `scripts/crates-gates.mjs` lê o registro e emite exatamente os três
  comandos pedidos por pacote, na ordem: `cargo fmt --manifest-path <m> -- --check`,
  `cargo clippy --manifest-path <m> --all-targets -- -D warnings`,
  `cargo test --manifest-path <m> --locked`, com `CARGO_TARGET_DIR` apontando para
  `target/crates-gates` (fora da árvore rastreada). Pacote declarado sem manifesto
  produz `REPROVADO` e **não** é ignorado; registro ausente ou com schema errado é
  rc=1. Seis testes em `scripts/crates-gates.test.mjs`; a **não-vacuidade** da regra
  de ausência foi provada mutando temporariamente a condição para `if (false && …)`:
  caíram exatamente os dois testes da regra, e o suíte voltou a verde depois de
  reverter. `npm run crates:gates` entrou no `package.json` e no CI
  (`.github/workflows/ci.yml`, passo *Crate package gates* nos dois jobs, com
  `outcome` na janela de resumo) — os dois jobs disparam em todo push/PR, então não
  houve filtro de caminho a afrouxar.

  **Item 6 — uma entrega por vez: primeiro a B, depois a A.** A B entrou antes:
  decodificador Kosinski v1 (`3fea06e`+`1af7017`, PR #81, pino revisto `0b752b7`)
  virou `crates/rex-kosinski` e passou nos gates medidos às 02:48Z — **25 testes
  executados / 0 falhas / 0 ignorados** (22 contract + 3 mutations). A primeira
  corrida **falhou** (15 de 25 com "fixture golden/…: No such file or directory"):
  o pacote lê fixtures **fora** dele, e o perfil existia só na outra linha de branch
  da B. Fechei como integrador — importando os dados e os scripts geradores no mesmo
  pino, conferindo as **27** linhas de `manifest.tsv` (0 divergências de SHA) e
  reproduzindo o hash agregado `ea866df7…` — **sem editar o teste de outra agente**.
  O achado volta para a B como trabalho dela: vendorizar as fixtures (ou aceitar o
  caminho por variável de ambiente) para o pacote ser relocável, e a metadata
  `license` que falta. O contrato do **encoder** (`0b752b7`) e o WIP `encode.rs`
  ficaram fora: são a próxima entrega dela. A A entrou depois, com os 17 commits do
  intervalo `9b27941..57e51d3` (PR #82) e o `git mv` de
  `scripts/rex_profiles/addressing_runtime/rex-addressing` para
  `crates/rex-addressing` — promoção que o `CONTRATO.md` do próprio perfil declarava
  como pendente do integrador. Gates medidos às 02:58Z já na localização nova:
  **81 executados / 0 falhas / 9 ignorados** (77 em 10 targets + 4 doc-tests); os 9
  ignorados são os 8 BYOR e o preimage exaustivo, então o gate ordinário não depende
  de ROM. Diferença registrada: o README do pacote anuncia 72 e a suite integrada
  executa 77. Achado devolvido à A: 15 `.expect()` de produção cujo invariante não
  tem varredura adversária no gate.

  **Item 7 — a escada de quatro degraus.** Nova seção "Matriz de bibliotecas
  standalone (`crates/`)" no estado corrente, com as duas pacotes em
  `biblioteca implementada: verified` e `gates próprios aprovados: verified` e
  **`backend integrado: blocked` / `fluxo do usuário comprovado: blocked`** nos dois
  — sem `rex-kosinski` nem `rex-addressing` em `src-tauri/Cargo.toml`, sem adaptador,
  sem chamada real pelo backend. As matrizes de endereçamento e de codecs (propriedade
  de A e B) **não** foram tocadas: continuam `blocked`, que é o que é verdade.
  `docs/rex_profiles/CONTRACTS.md` ganhou a §6 registrando a reserva de superfícies
  (manifests e lockfiles, registro de módulos, `src/core/ipc/`, `src/components/`,
  harness principal E2E, `check-tree.*`, `crates-gates.mjs`, `ci.yml` e documentos de
  estado) e o direito de cada frente ao próprio namespace de evidência.

  **Gates desta barra (medidos, com onde mora cada número).** Pacote de evidência
  `data/rex_profiles/integrator/crates_registry/evidence/2026-09-28-barra-de-entrega/`
  (`manifest.json` com SHA-256 por arquivo): `npm run check:tree` rc=0
  (`gates-frontend.log:6`) · `npm run lint` rc=0 (`:10`) · `npx tsc --noEmit` rc=0
  (`:14`) · `npm test` **747 passed / 6 skipped (753)**, 118,35 s (`:41-42`, rc na
  `:46`) · `npm run crates:gates` rc=0 com os seis gates dos dois pacotes
  (`gates-crates.log`: kosinski 6/9/61, addressing 64/67/238, rc na 241) ·
  `cargo fmt -- --check` e `cargo clippy -- -D warnings` do produto rc=0
  (`gates-rust-produto.log:3,6`) · `npm run host:certify` rc=0 — **READY**,
  fingerprint `60249508…`, lock `dd99a22f…`, `cargo test --lib` **737 passed / 0
  failed / 66 ignored** (`host-certify.log:2357`, `Success: true` em `:2363`,
  `READY` em `:2364`). Reconciliação da contagem de frente: o registro anterior
  desta matriz era **737/3 (740)**; os **13** a mais são exatamente os dois
  arquivos de teste novos (`check-tree-crates.test.mjs` 7 + `crates-gates.test.mjs`
  6), verificados isoladamente com 13/13 passando. Os 737 do produto não mudaram:
  nenhum fonte de produto foi tocado. Um job pesado por vez, serializado; nenhum
  monitor de CI deixado de pé.

  **Push e CI registrados por SHA — e a gate reprovada por mim.** O push publicou a
  branch nova `codex/rex-integrator-crates-registry` no SHA `a556e86`. A consulta foi
  **pontual**, sem monitor, no SHA publicado
  (`2026-09-28-barra-de-entrega/ci-consulta-a556e86.log`, rollup terminal na linha
  80): `linux-validate` **success** (`:60`, `:76`), `desktop-smoke` **success**
  (`:77`) e `validate` (runner `windows-latest`) **FAILURE** (`:73`, `:78`) — o que
  reprova é o passo 15 *Frontend tests*, com **2 failed / 729 passed / 22 skipped
  (753)** e 1 arquivo de teste falho (o total 753 bate com o Linux; os 22 skips foram
  decompostos depois, no log do próprio job — host-manager 5 + `decomp-scripts` 11 +
  `linux-host-scripts` 6, e as duas falhas em `:77:29`/`:96:29`, no apêndice de
  `ci-windows-1abad5d-extract.log`). Os passos 10 *Structure
  check* e 13 *Crate package gates* passaram no Windows, ou seja, os gates dos dois
  pacotes também correm lá. O extrato passo a passo está em
  `2026-09-28-gate-cross-platform/ci-windows-a556e86.log`.
  As duas asserções que pegaram são as **minhas** (`check-tree-crates.test.mjs:77`
  e `:96`), e o defeito é do código que eu escrevi: `scripts/check-tree.cjs:47`
  compunha o caminho *exibido* com `path.join`, então no Windows a gate imprimia
  `crates\registry.json` enquanto o espelho `.ps1` imprime `crates/registry.json` —
  duas implementações da mesma gate, duas saídas. O mesmo exame revelou um segundo
  defeito, pior porque é de veredito e não de texto: o `.cjs` normalizava o
  `manifesto` declarado antes de comparar, de modo que no Windows as duas margens
  convergiam em barras e uma declaração torta era **aceita em silêncio** — a
  checagem mordia só no Linux. O reparo (`882272c`) deixa os caminhos exibidos como
  literais POSIX (comparação literal nas duas implementações, `.ps1` apertado no
  mesmo ponto) e **não afrouxa as duas asserções**: o que estava errado era a
  produção. Prova de não-vacuidade no Linux, por mutação
  (`2026-09-28-gate-cross-platform/red-green-mutacao.log`): reverter o caminho
  exibido para `path.join` derruba exatamente 1 teste, reintroduzir o
  `path.normalize` derruba exatamente 1 teste, e a restauração foi conferida por
  SHA-256 (duas pernas idênticas). Paridade entre as duas implementações medida com
  `pwsh 7.6.6` em quatro casos (sem registro; manifesto com barras de Windows; sem
  campo; com campo POSIX) — vereditos e caminhos iguais nos dois
  (`parity-cjs-ps1.log`). Barra do reparo: `check:tree`, `lint`, `tsc --noEmit` rc=0
  e `npm test` **749 passed / 6 skipped (755)** — os 2 a mais sobre os 747 são os
  dois testes novos (`gates-frontend-fix.log`).

  **O veredito do Windows no SHA do reparo — medido, não inferido.** O push publicou
  `882272c` + `1abad5d`, e a consulta em `1abad5da356781d…` foi pontual, em três
  segmentos acotados do mesmo log
  (`2026-09-28-gate-cross-platform/ci-consulta-1abad5d.log`, `ROLLUP_TERMINAL` às
  2026-09-28T04:22:02Z): `linux-validate` **success** (job 108781125449) e `validate`
  (windows-latest) **success** (job 108781125205, das 03:57:59Z às 04:21:14Z), com os
  dezoito passos em `success` — inclusive o 10 *Structure check*, o 13 *Crate package
  gates* e o **15 *Frontend tests***, que era justamente onde reprovava; o 16
  *TypeScript check*, antes `skipped` por parada de fluxo, passou. No próprio runner
  Windows a suíte da gate fecha com **9 testes, 0 falhas** (log despojado do job
  `:4317`) e os caminhos que a ferramenta imprime são POSIX lá também: `:1653`–`:1654`
  (`rex-kosinski`), `:1713` (`rex-addressing`), com o shell do runner sendo PowerShell
  (`:1146`). Contagens do runner: **733 passed / 22 skipped (755)**; locais, na mesma
  barreira, **749 passed / 6 skipped (755)**. A diferença está decomposta arquivo por
  arquivo nas duas margens, sem sobra — os 22 são `host-manager` 5 + `decomp-scripts` 11
  + `linux-host-scripts` 6; os 6 são `decomp-scripts` 4 + `validateUpstreamWindows` 2; e
  o líquido 18 − 2 = 16 bate com 22 − 6 e com 749 − 733
  (`ci-windows-1abad5d-extract.log`, cujo apêndice decompõe também a perna que reprovou:
  os mesmos 22 skips, com as duas falhas em `:77:29` e `:96:29`). Varredura da mesma
  classe nos demais testes de `scripts/`: nenhuma outra asserção compõe caminho esperado
  com API de caminho, `path.sep` não aparece em testes, e as vizinhas
  `crates-gates.test.mjs:75`/`:136` batem em literais POSIX que o próprio script imprime
  (`crates-gates.mjs:86`, `:122`) — por isso não divergem. O exame devolveu um achado
  para mim mesmo: `crates-gates.mjs:119-123` aceita o campo `manifesto` como declarado e
  o recompõe com `path.join(root, ...manifesto.split("/"))`, de modo que uma declaração
  com barras de Windows seria um único segmento — resolveria no Windows e quebraria no
  Linux. Quem a reprova hoje é o `check:tree`, com a comparação literal agora estrita, e
  ele roda antes no mesmo job; a checagem não foi duplicada no gate de pacotes, e a
  dependência de ordem entre os dois passos fica registrada aqui como superfície
  protegida. **O que isso ainda não prova:** nada sobre integração ao produto, promoção
  de maturidade, merge ou release; e o Desktop E2E não corre neste SHA — o gatilho é por
  filtro de caminho e o pino não toca os caminhos vigiados, o que é explicação medida,
  não omissão.

  **Limites desta célula.** `crates/` é localização de **biblioteca**, não alegação
  de produto; o produto continua com os codecs que já tinha (LZ4W e aPLib na
  transação canônica), e nenhuma linha de `src-tauri/src/tools/reverse/decomp/`
  mudou nesta rodada. Os dois pacotes seguem `Experimental` na classificação da
  rodada, e o degrau `gates-proprios-aprovados` não autoriza ninguém a escrever
  "integrado" em documento nenhum. **Sem merge, sem release, sem promoção de
  maturidade.**

  **Ordem recebida para a etapa seguinte (2026-09-28, operador).** Integrar A e B ao
  backend, uma entrega por vez, sem merge nem release, com quatro condições explícitas:
  (i) `rex-addressing` permanece **sem dependência de Tauri** — serialização e tradução
  de erros vivem no **adaptador**, não na biblioteca; (ii) perfil e estado do mapper são
  **explícitos** nesta etapa, sem autodetecção silenciosa; (iii) leitura com estado fixo
  fica **separada** de sequências que alteram bancos; (iv) antes de subir qualquer
  degrau, resolvem-se os contratos pendentes com A e o empacotamento com B (fixtures
  dentro do pacote, `license` no manifesto). O degrau `backend-integrado` só é
  declarado com chamada real comprovada pelo backend, e `fluxo-do-usuario-comprovado` só
  com prova pela interface. Um agente novo passa a trabalhar isolado em recuperação de
  lógica de gameplay: as superfícies compartilhadas continuam do integrador, e ele
  entrega no próprio namespace de evidência.

- 2026-09-27 (integrador, **edição contextual comprovada pela interface** — o
  resultado visível que o briefing pediu, não mais um relatório do backend),
  célula de fechamento dos itens 1 a 4. **HEAD de partida:** `896a372`.
  **Ordem recebida:** "O próximo resultado visível deve ser uma edição contextual
  utilizável, não apenas outro relatório do backend", com "Não aceite coordenadas,
  dimensões ou offsets da UI como autoridade" e "Depois execute o caso BYOR já
  comprovado, distinguindo camada reconstruída de framebuffer completo".
  **Commits desta célula:** `e44f39d` (identidade antes da varredura, núcleo),
  `16ce6bf` (zoom inteiro preservado, UI) e `7e10944` (cenário E2E
  `rex-context-fixture-effect`). Os quatro commits anteriores da mesma frente
  (`c731485` fixture com esperado antes de compilar, `b9cbe8e` modelo no núcleo,
  `560347e` IPC somente leitura, `896a372` UI contextual) já estavam publicados;
  esta célula é a que os amarra por prova de interface.

  **O que a barra fez, medido no WebView (rc=0, 17 passos, 15 638 ms, binário
  `f56be451…`):** localizou o TileSet sozinha (`0x5fa38 — aplib · 16 tiles
  (stream 169 B)`), montou o contexto com identidade, vínculos e proveniência, e a
  camada composta lida do `<img>` é o esperado do oráculo externo (`7dc94b02…` no
  empacotamento RGB; alpha à parte, 0 divergências RGBA). Os quatro cliques sob
  `B`/`H`/nenhum/`V` convergiram no mesmo pixel de fonte (`tile 2, 4, 7`, índice
  atual 11) e a barra nomeou o escopo: `4 ocorrências neste mapa verificado`. Uma
  edição (11→3) pela transação canônica alterou **exatamente** as quatro posições
  previstas `(0,3) (56,4) (23,12) (47,27)`, 129 bytes, **0** fora de
  `[0x5fa38, +169)`; cópia `1d6da6d9…`, BPS `2fafda41…` reaplicado reproduzindo o
  hash da cópia; salvar/reabrir restaurou com identidade revalidada. A escala de
  página 0,75 e o clique fora da camada também foram assido.

  **Os dois defeitos reais que só a interface viu.** (1) *Zoom pedido ≠ zoom
  desenhado*: preflight `img{max-width:100%}` + flex item encolhendo achatavam só a
  largura (`193,66x288` num 4x de 120x72) — pixel não quadrado, `pixelated` inútil,
  e o mapa ponteiro→pixel apontando para outra imagem. Corrigido por TDD
  (`16ce6bf`); o teste pinha o contrato de CSS, o E2E mede o retângulo. (2) *Identidade
  depois da varredura*: com outro arquivo no caminho, a recusa levava >60 s e vinha
  como "recurso não verificado nesta ROM" — sintoma no lugar da causa. Corrigido por
  TDD (`e44f39d`), com o teste escrito RED usando **offset de outra ROM** para que a
  ordem das guardas discrimine; a perna 11 agora assere a recusa em ≤1,5 s e a
  mensagem diz `nada foi varrido e nada foi escrito`. O log das duas corridas falhas
  (run3 e run4) está versionado no pacote, junto do run2 que pegou **meu** erro de
  expectativa: eu cobrava na barra o `data_size` do símbolo (170 B = array linkado,
  com byte de padding) quando o que a barra anuncia é o consumo medido pelo oráculo
  (169 B). O cenário passou a exigir `medido <= array` e cauda toda zero.

  **Caso BYOR reexecutado contra o binário novo** (`rex-aplib-byor-effect`, rc=0,
  0 linhas de ERRO): cópia `80249128…`, BPS `58ae4f0b…` reaplicado, 800 bytes
  distintos, 0 fora de `[0x2e12a, +938)`, 163 preservados, índice 0 produzindo a
  cópia `69389ec2…` que a perna 3 já tinha executado no core — **idêntico aos
  pinos anteriores**, então nenhuma das duas correções regrediu o caminho real. A
  perna 14 do cenário contextual abre o BYOR pelo produto e declara a prévia como
  **camada reconstruída** (`1018 ocorrências neste mapa verificado`, TileMap
  `0x21b28` de 1120 células), com as oclusões não modeladas explícitas na barra: isto
  não é framebuffer do jogo.

  **Negativos.** Seis obrigatórios: quatro alcançados e asseridos pela UI (ghost sem
  vínculo, tile fora do conjunto, identidade trocada nas duas pernas, resposta
  obsoleta, descarte por troca de ROM, clique fora da camada). Dois são
  **inalcançáveis por construção** nesta fixture — a referência inválida e o banco
  sem cores vivem em `ctx_ghost`, que o linker deixou sem struct `Image`, então a UI
  não tem como chegar lá. Ficam provados no núcleo
  (`composicao_recusa_referencia_fora_do_tileset_em_vez_de_pintar_ruido`,
  `composicao_recusa_banco_que_a_paleta_nao_tem_cores`) e a matriz registra a
  atribuição em vez de inflar a prova de interface.

  **Gates e host.** `host:certify` rc=0 (`READY`, fingerprint `60249508…`, lock
  `dd99a22f…`), incluindo `check:tree` OK, `lint` OK e **737** testes de frente
  verdes (3 skipped); `cargo test --lib -- --nocapture --test-threads=1`
  **737 passed / 0 failed / 66 ignored** (104,30 s); `cargo fmt --check` OK;
  `cargo clippy -- -D warnings` limpo; `npx tsc --noEmit` OK; harness validado com
  `node --check` + eslint. Um job pesado por vez, serializado (E2E da fixture → E2E
  do BYOR → certify → fmt/tsc/clippy); nenhum monitor de CI ficou de pé.

  **Limites desta célula (não alegados como sucesso).** A frente continua
  `Experimental`, sem merge, sem release e sem promoção de maturidade. "Verificada"
  informa o que foi conferido (ponteiro do struct `Image`, decode com tamanho exato,
  round-trip pelo oráculo) e **não** prova que o jogo carrega ou exibe o recurso. Não
  existe controle de "editar só esta ocorrência": sem duplicação e realocação de
  tile isso seria destrutivo. Prioridade (bit 15) é conferida na palavra mas não é
  composta na camada. A contagem de ocorrências é por mapa verificado. O perfil vale
  para o toolchain pinado (rescomp `502a4670…`, apj `2d8cdc63…`, libmd `ef904a37…`)
  e para os recursos demonstrados. BYOR não é dependência provisionável: os dois
  cenários consomem ROM local explícita e não rodam no CI.

- 2026-09-27 (integrador, **ENTREGAS 2 e 3 do briefing — o índice 0 deixou de ser
  achado e passou a ser caminho**, e a barra o percorre de ponta a ponta), célula
  de fechamento. **HEAD de partida:** `794033e` (entrega 1). **Ordem recebida:**
  "O campo atual usa `min=1` e `Number(value) || 1`, transformando 0 em 1. O índice
  0 pertence ao domínio 4bpp e deve ser representável" + "substitua as asserções
  que preservavam o defeito por regressões" + "reconfirme espaço e hashes, não
  copie números antigos". **Commits desta célula:** `af5d5d0` (conserto na UI),
  `d769629` (pino no codec + varredura no domínio real da barra), `eae825a`
  (regressões no cenário WebDriver) e `ad3ff57` (o `selectResource` assentado e as
  durações por aplicação, que fecham as duas janelas de harness descritas abaixo).

  **O que estava errado e por quê.** `CompressedResourcePanel.tsx` guardava o campo
  de índice como número já coercido (`setPaintIndex(Number(event.target.value) ||
  1)`) com `min={1}`, então o `0` digitado virava `1` **antes** de qualquer
  validação — o `editRejectReason` nem via o 0. O 0 é índice legítimo do 4bpp: é o
  índice que o VDP lê como transparente no plano de tiles. **Isto não é a cor RGB
  da paleta:** editar o índice de um pixel escolhe qual entrada da paleta aquele
  pixel usa; mexer no RGB de uma entrada é outra superfície, que este painel não
  toca. A distinção agora está escrita no cabeçalho do painel e em cada queixa de
  índice inválido, para não ser nota de rodapé.

  **O conserto (UI).** O campo guarda o **texto** digitado (`useState("1")`) e é
  validado por `paintIndexRejectReason`, que dá queixa própria por forma: campo
  vazio, não número, não inteiro e fora de 0..15 — cada uma terminando com o
  domínio e com "A fila atual foi preservada". Nada entra na fila no lugar de outra
  cor. `editRejectReason` passou a aceitar inteiro em `[0, 16)` (antes 0 era
  recusado como índice de paleta). Pintura por clique e botão "Adicionar edição"
  compartilham o mesmo `queuePaint`, então as duas superfícies herdam a mesma
  validação. A guarda do núcleo continua sendo a definitiva e não mudou.

  **Hashes e espaços re-medidos, não copiados.** Com o encoder atual, em
  2026-09-27: a edição pinada das pernas 1 e 3 — tile 53, linha 0, coluna 4,
  índice 5 → **0** — custa **937 B** no slot de **938 B** (folga 1 B) e produz a
  cópia `69389ec2b400220c7a069e4c36326ca3c26d81e85ff0ab81bf798dc9ae4038ac`, com
  patch BPS `8bf6d3df…` (853 B) e **781** bytes distintos na cópia, **0** fora do
  slot. Medido por `cargo test --lib byor_aplib -- --ignored --nocapture`.

  **Varredura re-ancorada no domínio real da barra (v2,
  `rex-aplib-capacidade-da-barra/v2`).** A varredura que escolhia o alvo deixara de
  descrever a interface: contava 1..15. Ela agora mede os dois domínios. Em
  `0x2e12a`: `piso_indices_da_barra` 932 B contra `piso_sem_indice_0` 934 B, e
  `cabiveis_na_barra` **1 694** contra `cabiveis_sem_indice_0` **1 619** — o índice
  0 abre **75** edições de 1 pixel que a barra não alcançava. Em `0x2cd94`: 78 vs
  77 (**+1**). `0x2e4d4` e `0x2f65a` seguem em **0** nos dois domínios (piso
  4 540 > slot 4 485; 7 439 > 7 420) — para esses dois o conserto da UI não muda
  nada, e a célula da matriz que o diz continua verdadeira. Total de edições
  cabíveis com índice 0 nas quatro varreduras: **76**. Higiene de medição medida
  nesta mesma célula: o tile 53 entrava duas vezes na lista de alvos (varredura
  completa de 64 pixels + amostra genérica `(0,0)`/`(0,4)` por tile), então uma
  edição era contada em dobro; com `sort_unstable + dedup` as tentativas caem de
  10 770 para **10 740** (−30 = 2 pixels duplicados × 15 índices) e `cabiveis`
  1 695 → **1 694** — o único par duplicado que cabia era justamente o do índice 0.
  A calibração pinada (`CUSTO_DO_PIN_5_PARA_0 = 937`) continua valendo e a lista do
  tile 53 agora é `[[0,4,937],[7,5,938],[7,7,938]]`, com `pin_cabiveis == vec![0]`
  e o cruzamento `cabiveis_sem_indice_0 ==` contagem das entradas com índice ≥ 1
  asseridos no teste; as 5 sondas de recusa por forma (§5a) e os 14 índices
  recusados com `excessive_output` (§6a) estão nos relatórios do WebDriver
  promovidos no pacote abaixo.

  **Regressões no cenário `rex-aplib-byor-effect` (schema
  `rex-aplib-byor-effect/v2`).** As asserções que preservavam o defeito saíram e
  entraram as que o impedem de voltar. No lib de testes da UI (`af5d5d0`, 4
  entradas novas no arquivo, que passa a ter 10): "digitar índice 0 mantém 0 no
  campo e a transação recebe índice 0", "entrada de índice inválida diz o motivo e
  não entra na fila no lugar de outra cor", "pintura por clique usa o índice do
  campo, inclusive 0, e recusa campo inválido" e "índice 0 sobrevive a desfazer
  (re-editar o pixel), reabrir o recurso e ao no-op". No WebDriver: §5a: cinco formas fora do domínio (`linha 8`,
  índice `16`, `-1`, `1.5`, campo vazio) cada uma com queixa própria **e** fila
  vazia asserida. §5b: digitar **0** deixa `"0"` no campo do DOM (qualquer outro
  valor ali é a coerção voltando), a edição entra na fila, a transação **completa**,
  o hash anunciado é `69389ec2b400220c…`, o arquivo em disco re-hashed é exatamente
  `69389ec2…`, a cópia tem o mesmo tamanho da ROM (917 504 B) e **0** bytes fora de
  `[0x2e12a, +938)`. §6a mantém o lado diferencial: **14** índices de 1..15 no
  mesmo pixel, todos recusados com `excessive_output` — prova de que 0 não é outro
  valor disfarçado. §6b mantém a edição 5→4 em `(53,7,5)` como regressão útil:
  cópia `80249128…`, BPS `58ae4f0b…` reaplicado, 800 bytes distintos, 163
  preservados — os mesmos hashes das corridas do passo 5.

  **Corridas desta célula, registradas como aconteceram.** Quatro corridas do
  cenário nesta árvore, todas com a ROM `558bea6c…` conferida antes de cada uma.
  (1) 10:34Z, logo após um build: falha no WebDriver — `setPanelInput` em
  `rex-resource-paint-index` recebeu "o setter de HTMLInputElement.value só aceita
  instância de HTMLInputElement", que em WebKit é o que ocorre quando o elemento
  não está lá. Diagnóstico: a espera do harness era por `rex-resource-canvas`, e o
  painel desmonta o bloco inteiro (prévia **e** campo de índice) ao começar a
  re-decodagem — a sondagem pode ver o canvas do estado anterior e passar cedo.
  (2) 10:45Z, mesmo binário, com `selectResource` esperando a condição assentada
  (campo de índice montado **e** botão aplicar habilitado, ou seja `busy === false`)
  e com marcadores de passo: **verde** — 23 marcadores no log (`1-3`, `4`, `5a`×5,
  `5b`, `6a`×14, `7`) e o resumo impresso ao fim traz `indice_0_no_campo: "0"`,
  `indice_0_sonda: "aplicado"` e `indice_0_copia: "69389ec2b400220c"`; a linha
  `E2E_RC=0` do wrapper só está no log da corrida (4). Cópia `69389ec2…` conferida
  em disco, 14 recusas, 5 recusas de guarda,
  alvo 5→4 com `80249128…`. (3) 10:52Z, build completo novo: passou 5a, **5b** e os
  14 índices de 6a e morreu no orçamento de 60 s do desfecho em §6b, com a edição já
  na fila, sem erro no painel e sem desfecho. (4) 10:58Z, mesmo binário da (3) e
  orçamento por aplicação medido: **verde**, `E2E_RC=0`, com as durações registradas
  no relatório — **7 621 ms** para o apply do índice 0, **272–327 ms** para cada uma
  das 14 recusas e **7 400 ms** para o apply do alvo 5→4. A cópia do índice 0, a
  cópia do alvo e o BPS do alvo são os mesmos das corridas do passo 5
  (`69389ec2…`, `80249128…`, `58ae4f0b…`),
  781/800 bytes distintos, 0 fora do slot, 163 preservados.
  **O que isso ainda não explica:** a corrida (3) estourou 60 s num passo que custa
  ~7,4 s — não foi lentidão sistemática nem a barreira do orçamento sendo atingida
  "por pouco", e a causa do travamento único não foi estabelecida. O que mudou desde
  então é diagnóstico, não produto: cada desfecho agora carrega sua duração e o
  orçamento subiu para 180 s, então a próxima ocorrência é medida em vez de virar
  timeout cego. Um `rc=101` no meio da série de gates foi erro de invoco meu
  (`cargo` rodado na raiz do repositório, sem `--manifest-path`: "could not find
  Cargo.toml"), não falha de código; a distinção entre as duas formas de invocar o
  `cargo` fica registrada na célula `Gates` abaixo.

  **Efeito em tela.** A perna 3 já executou a cópia `69389ec2…` no desempacotador
  do próprio jogo (2 pixels por frame em 119 frames, coordenadas `[[212,200],
  [284,128]]`), e as duas pernas de core foram reexecutadas hoje às 10:29Z (07:29
  local): `rex05` (edição do backend) e `rex06` (cópia da barra, `80249128…`, 232
  pixels em 116 frames nas posições previstas). Os dois relatórios promovidos
  registram `core.sha256 = 07c10476…` (Genesis Plus GX v1.7.4 `46a5521`), que é o
  mesmo `core_sob_teste` do manifesto, então a identidade do core executado é
  conferível no pacote e não só na descrição. O que esta célula fecha é a
  **identidade do artefato**: a barra produz byte a byte o que o núcleo rodou. A
  amarração ao binário de teste que produziu os relatórios vive em
  `binario_sob_teste.harness_de_teste` (`app_lib-716403bf8cac2e87`, citado pelos
  logs de `--ignored`); o relatório `rex05` em si não registra esse caminho, o que
  fica declarado como limite do pacote. A asserção nibble a nibble
  da edição de índice 0 vive no lib (`indice_0_e_do_dominio_4bpp_ate_o_stream_aplib`:
  `0x5A → 0x0A` no nibble baixo, `0xA5 → 0xA0` no alto, vizinhos intactos, e o
  índice 0 sobrevivendo a re-codificação + decode no fixture autoral).

  **Gates desta árvore.** `npm run check:tree` rc=0 · `npm run lint` rc=0 ·
  `npx tsc --noEmit` rc=0 · `npm test` → **706 passed, 0 failed, 6 skipped**
  (invariante anterior 702; **+4** = as quatro regressões do painel, arquivo com
  10 testes) · `cargo fmt -- --check` rc=0 · `cargo clippy -- -D warnings` rc=0 ·
  `cd src-tauri && cargo test --lib -- --nocapture` → **707 passed, 0 failed,
  63 ignored** (invariante anterior 706; **+1** = o pino do índice 0 no codec).
  Sobre a forma de invocar o `cargo`: `src-tauri/.cargo/config.toml` define
  `target-dir = "target-test"` **relativo ao diretório de invocação**, e a forma
  canônica da raiz (`cargo … --manifest-path src-tauri/Cargo.toml`) cai em
  `src-tauri/target` — medido com `cargo metadata` nos dois diretórios. O log que
  carrega os **707 testes** mostra `target-test/debug/deps/app_lib-716403bf8cac2e87`,
  o binário amarrado no manifesto como `harness_de_teste`, então aquela corrida é
  a rodada dentro de `src-tauri`. Os logs de `fmt` e `clippy` não imprimem caminho:
  a forma exata dessas duas invocações não é decidível pela evidência promovida, e o
  que distingue as duas formas é o diretório de alvo, não o veredito. Os logs
  promovidos são os das reexecuções corretas, descritas acima.

  **Push e CI registrados por SHA.** `git fetch` + `git push origin
  codex/rex-integrator-aplib-decode` → fast-forward `19c880f..9a4335f` (0 atrás, 6
  à frente: `794033e`, `af5d5d0`, `d769629`, `eae825a`, `ad3ff57`, `9a4335f`).
  Consulta **pontual**, sem monitor permanente, no SHA publicado
  `9a4335f72bf0f463faa23cdfdd5db45059c71983`: workflow `CI` → **success**
  (`validate`, `linux-validate`), run `36315702049`; workflow `Desktop E2E` →
  **success** (`desktop-smoke`), run `36315702070`. O que esse verde **não** cobre
  continua sendo os dois aceites `#[ignore]` e o cenário `rex-aplib-byor-effect`,
  que consomem BYOR — BYOR não é dependência provisionável, então o CI atesta o
  contrato, não esta ROM. Este parágrafo foi escrito no commit só de texto
  `3326228`, então ficou sem consulta própria (precedente: `19c880f`, run
  `36305001760`). **Revisado em 2026-09-27 a pedido do operador:** o HEAD final
  `9e63adc` foi consultado pontualmente, e a consulta está registrada abaixo.

  **Consulta pontual do HEAD final `9e63adcc756d6de8db5a11c0adc06b68ae8807d2`.**
  `git push origin codex/rex-integrator-aplib-decode` → fast-forward
  `9a4335f..9e63adc` (2 commits de texto: `3326228`, `9e63adc`; nenhum código de
  produto ou de teste nesse intervalo). Checks vinculados ao SHA, lidos em
  `GET /repos/Misael-art/RetroDevStudio/commits/9e63adcc…/check-runs`:
  `validate` → **completed / success** (job `108614432239`, 20m56s) e
  `linux-validate` → **completed / success** (job `108614432149`, 12m40s); run
  `36317340061`, encerrado 2026-09-27T12:17:25Z
  (`https://github.com/Misael-art/RetroDevStudio/actions/runs/36317340061`).
  `Desktop E2E` **não** existe nesse SHA, e isso não é falha nem PASS emprestado:
  o workflow filtra por caminhos (`.github/workflows/desktop-e2e.yml` →
  `src/**`, `src-tauri/**`, `scripts/e2e-tauri-build-run.mjs`,
  `scripts/build.mjs`, `package.json`, `package-lock.json`) e `9e63adc` tocou só
  `docs/06_AI_MEMORY_BANK.md`, `docs/rex_profiles/ROUND_STATE.md` e o
  `manifest.json` do pacote. **Regra terminal adotada:** esta é a última consulta
  de CI da rodada; o commit que registra esta célula é só texto e, por construção,
  não recebe consulta própria — o contrário implicaria uma consulta por commit de
  registro, ao infinito. Nenhum observador ficou de pé: o único `gh run watch`
  desta sessão terminou sozinho e `ps -eo args | grep 'gh run'` não retorna
  processo vivo.

  **Limites, parte da célula.** Continua **um** dos **4** recursos aPLib de **uma**
  ROM BYOR; `0x2e4d4`/`0x2f65a` ineditáveis em 1 pixel nos dois domínios; execução
  sob core de harness, não hardware nem app distribuído; BYOR não roda no CI, e o
  pacote não versiona ROM nem capturas derivadas dela (só hashes); "editável" não é
  "compreendido" — a classe do alvo segue desconhecida. **Maturidade:** nada
  promovido, produto continua `Experimental`. **Sem merge, sem release, sem
  promoção de maturidade.** A decisão (b) do checkpoint anterior ("decidir a
  semântica do índice 0 na UI") foi executada por ordem expressa do operador e
  deixa de estar em aberto.

- 2026-09-27 (integrador, **ENTREGA 1 do briefing do operador — a linha aPLib da
  matriz deixou de atrasar o código**), célula de correção de registro. **HEAD de
  partida:** `19c880f`. **Ordem recebida:** "Separe capacidade técnica de
  maturidade do produto. Mantenha Experimental, limites de cobertura e provas
  herdadas. Não deixe 'blocked por decisão de missão' quando o critério foi
  atendido. Revise também as demais células aPLib: atualize somente as que possuem
  evidência específica. Preserve o histórico."
  **O que estava errado e por que era errado:** a linha aPLib da matriz dizia
  `blocked` em 5 das 6 células, e o texto do estado corrente afirmava duas coisas
  **falsas contra o código desta árvore** — que `reinsert` em `rex_resources.rs` é
  caminho exclusivo de LZ4W e que "nenhum recurso APLIB da ROM é editável sem
  expansão pelo produto hoje". As duas foram superadas pelo passo 3 (`reinsert_*`
  + os 5 testes `reinsert_aplib_*` + `ui_edite_recurso_aplib_pela_mesma_fronteira_do_lz4w`)
  e pelo passo 5 (as 4 pernas, checkpoints abaixo). Ou seja: o bloqueio registrado
  era o do *registro*, não o da frente.
  **Célula por célula, com o critério:** `Variante fixada` → verified (raw do SGDK
  2.11 sem header `"AP\0"`, arbitrada por dois decodificadores independentes; a
  divergência de fundo sobre namespace canônico **não** foi adjudicada e segue
  registrada como (a)/(b) no estado corrente). `Vetores+holdout` → verified no
  pino **do integrador** (49 arquivos + 2 discriminadores, SHA por arquivo e hash
  agregado `3a9d7e9e…`; a cópia da agente A não foi adotada — antes a célula
  apontava para o pacote de B, que é outra árvore). `decode vs ref` → verified
  pela perna 1 da paridade §4 (8 plains × 2 oráculos + 9 goldens com
  `bytes_consumed` exato), com a negativa explícita de que o oráculo 68000 montado
  sob MAME continua só existente para LZ4W. `encode vs ref` → verified pela perna 2
  (gate 16/16/0) e pela mesa de tokens (7 de 8 mesas idênticas às dos oráculos),
  com **ótimo não alegado** e a oitava mesa divergente quantificada (1 364 B
  contra 1 205 B; +433 B de `match-10` comprando 272 B). `Negativos` → verified
  (os 7 negativos pelo código estruturado próprio + `work_limit` +
  `excessive_output` + `overflow` por gamma2 + `verify_aplib_resource` recusando
  tamanho divergente e header de outro codec). `Recurso real` → **verified no
  perfil demonstrado**, critério do operador atendido ponto a ponto: identidade
  fixada (ROM `558bea6c80c76ec3…` reconfirmada no corpus intacto), recurso
  `0x2e12a` vindo da **lista real** (não do fixture; header TileSet `0x21b20`,
  100 tiles, plain 3 200 B, slot 938 B), edição registrada (`(53,7,5)`: índice
  5 → 4), reinserção **sem expansão** (cópia de 917 504 B = tamanho da ROM, 800
  bytes distintos na faixa `[0x2e18f, 0x2e4d2]`, **0** fora do slot, 163 recursos
  preservados), BPS `58ae4f0b…` reaplicado sobre a base reproduzindo o hash exato
  da cópia `80249128…`, e efeito em tela nas **2 posições previstas**
  (`[[213,207],[285,135]]`) executado pelo desempacotador do próprio jogo.
  **Limites que são parte da célula, não rodapé:** 1 dos 4 recursos aPLib da ROM;
  `0x2e4d4` e `0x2f65a` não aceitam nenhuma edição de 1 pixel (4 540 > 4 485 e
  7 439 > 7 420, mesmo contando índice 0); `0x2e12a` tem folga de 1 B e `0x2cd94`
  folga 0, e o alvo aplicado está no **teto** (938 B), não no piso; execução sob
  core de harness, não hardware nem app distribuído; "editável" ≠ "compreendido".
  **Maturidade:** nada promovido — o rótulo de produto continua `Experimental` (a
  própria UI o declara no cabeçalho do painel), e a legenda da matriz agora diz
  explicitamente que célula `verified` mede capacidade técnica, não maturidade.
  **Histórico preservado:** os checkpointes anteriores (passos 1 a 5, incluindo as
  células que escreveram "linha aPLib **mantida `blocked`**" na data em que isso
  era a ordem vigente) **não foram reescritos**; a correção vive nesta célula e no
  estado corrente. **Um achado registrado aqui deixa de ser decisão pendente na
  próxima célula:** o índice 0 inexpressável pela barra foi corrigido por ordem
  expressa do operador (entrega 2), e as asserções do cenário que preservavam o
  defeito foram substituídas por regressões.
  **Gates desta célula:** correção documental; nenhum arquivo de produto, UI,
  teste ou evidência alterado. `npm run check:tree` rc=0. O verde aplicável ao
  código desta árvore continua sendo o de `f633e07` (CI `success` + Desktop E2E
  `success`, registrado na célula anterior).

- 2026-09-27 (integrador, **PASSO 5 — Pernas 2 e 4 fechadas: a barra edita o
  recurso aPLib real e o que ela escreve roda no desempacotador do jogo**), esta
  célula é o checkpoint e fecha o passo 5 do briefing. **HEAD de partida:**
  `94bfa81` (o checkpoint das pernas 1 e 3) com a varredura de capacidade ainda não
  commitada. **Commits desta célula:** `7c65cd5`
  (varredura de capacidade), `ce6ed3c` (cenário WebDriver), `8f2f3f1` (execução
  no core).
  **O que abriu a perna 2 foi uma morte, não uma escolha.** As pernas 1 e 3
  pinaram o pixel `(53, 0, 4)` com índice **0**; a barra não digita índice 0.
  Iterar 1..15 sobre esse pixel no navegador recusou os 15 (`excessive_output`,
  939–942 B contra o slot de 938 B) — `e2e-run2-becodo-que-motivou-a-varredura.log`.
  Em vez de trocar de alvo por opinião, `7c65cd5` mediu o espaço com o codificador
  do próprio produto nos **4** recursos aPLib da ROM (75 325 ms, 10 770 tentativas):
  dois deles (`0x2e4d4`, `0x2f65a`) não aceitam **nenhuma** edição de 1 pixel que a
  barra expresse, e nem contando o índice 0 há piso abaixo do slot (4 540 > 4 485;
  7 439 > 7 420). Sobram `0x2e12a` (folga 1 B) e `0x2cd94` (folga 0). Dentro de
  `0x2e12a`, o tile 53 tem exatamente dois pares cabíveis — `[[7,5],[7,7]] → idx 4`,
  ambos a 938 B, o teto — e essa lista está pinada no teste do lib.
  **Perna 2 (`ce6ed3c`, cenário `rex-aplib-byor-effect`):** a interface chama
  `rexResourceList` → `rexResourcePreview` → `rexResourceApplyEdit` (no-op com zero
  edições e depois com a edição medida) → reabre a cópia no mesmo painel. Conferido
  em bytes, não em screenshot: hash anunciado == SHA da cópia no disco, cópia do
  tamanho da ROM, **800** bytes distintos todos dentro de `[0x2e12a, +938)`, **0**
  fora do slot, **163** recursos preservados, BPS reaplicado sobre ROM íntegra
  reproduzindo o hash da cópia, e a prévia da cópia com pixels-sha próprio
  (`a6a4b603…` → `b469458…`). Verde duas rodadas (run3 07:00:50Z, run4 07:03:22Z);
  os dois relatórios viajam no pacote e a reconciliação é reproduzível: 62 campos
  idênticos, exatamente um diferente — o texto livre que editei entre as corridas.
  A guarda anti-descarte-silencioso está exercida pela barra (linha 8 → aviso +
  fila vazia asserida).
  **Achado que refutou a premissa da minha própria perna 2:** o painel **não**
  recusa índice 0 — `CompressedResourcePanel.tsx:273` faz
  `setPaintIndex(Number(v) || 1)` e reescreve 0 para 1 antes de `editRejectReason`
  (linhas 40–42), que reserva 0 como transparente. Medido: digitar 0 deixa `"1"` no
  `value` do DOM e o desfecho é byte a byte o do índice 1 explícito; o índice 0 real
  custou 937 B nas pernas 1 e 3, contra os 942 B alegados pela sonda. **Registrado,
  não corrigido** — mudar a semântica de paleta da UI é decisão do operador. O
  cenário tem duas asserções que apodrecem se a UI passar a expressar o 0 (hash
  pinado `69389ec2…`) ou se o clamp mudar de valor.
  **Perna 4 (`8f2f3f1`, `rex06_hamoopig_aplib_edicao_da_barra_executa_no_core`):**
  o artefato da barra, executado. O teste refaz a chamada com os quatro campos que
  a barra enviou e **obriga** o hash da cópia a ser `80249128…` antes de emular;
  três corridas frescas (power-on) sob Genesis Plus GX v1.7.4 `46a5521`, 180 frames
  do mesmo script. Coordenadas **previstas antes de executar** pela geometria chunky
  (`cx*8+5, cy*8+7` nas células (35,16) e (26,25) do tile 53) = as duas observadas.
  **Medido:** determinismo original-vs-original **0**; **232** pixels alterados em
  **116** frames (59..179, menos 60/61/62/66/67), **2 por frame**, agregando em
  `[[213,207],[285,135]]`; **0** fora dos retângulos das células; no checkpoint 129
  exatamente as mesmas duas colocações. Os frames 59/69/129/179 da ROM íntegra
  reproduzem byte a byte os hashes de
  `rex-evidence-2026-09-10/backend-hamoopig/checkpoint-rgba-hashes.json` (arquivo
  de 2026-09-12, anterior a esta frente), e os PPM base desta célula são os mesmos
  bytes da perna 3. **Não atribuído e por isso registrado como limite:** a perna 3
  viu 119 frames/238 pixels e esta vê 116/232; o que muda é a posição do pixel
  dentro do tile, e nenhum mecanismo foi medido para os frames 62/66/67.
  **Evidência promovida:** `data/rex_profiles/integrator/aplib/evidence/`
  `2026-09-27-passo5-perna2-barra/` — manifesto com 11 artefatos conferidos por
  SHA-256 no disco (2 relatórios, 3 logs E2E, JSON do core, JSON da varredura, 4
  logs de gates), ROM/cópia/BPS/core/binário sob teste amarrados por hash, e os
  PPM **não** versionados por serem derivados de ROM comercial.
  **Gates desta árvore:** `cargo fmt --check` rc=0; `cargo clippy --lib --
  -D warnings` rc=0; `cargo test --lib` **706 passed / 0 failed / 63 ignored**
  rc=0; os dois aceites ignorados `1 passed` cada (sweep 75,43 s; perna 4 12,24 s);
  `check:tree`/`lint`/`tsc --noEmit` rc=0; `npm test` **702 passed / 0 failed / 6
  skipped** (os 6 skips são de toolchain ausente, reconciliados no manifesto; o
  invariante é 702/0); `host:certify` **READY**.
  **Matriz:** linha aPLib **mantida `blocked`**, mesmo com a condição declarada do
  bloqueio (execução do recurso modificado pelo desempacotador do jogo) agora
  alcançada — promoção de maturidade é vetada pela ordem do operador. As quatro
  pernas do passo 5 estão na mesa para decisão. **Bloqueio:** nenhum externo.
  **Push e CI registrados por SHA:** `94bfa81..f633e07` em
  `codex/rex-integrator-aplib-decode` (fast-forward, 0 atrás / 4 à frente).
  Consulta **pontual** em `f633e07dbb6bf4ad67ce3f4d829df626bdd069c9`: workflow `CI`
  → `run: success` (`validate` success, `linux-validate` success); workflow
  `Desktop E2E` → `run: success` (`desktop-smoke` success). Run ids `36303792634`
  e `36303792614`. Os dois aceites `#[ignore]` e o cenário `rex-aplib-byor-effect`
  **não** estão nesse verde: consomem BYOR, que não é dependência provisionável —
  o CI cobre o contrato, não esta ROM. SHAs anteriores já verdes na mesma branch
  (`4a389ff`, `cb8557c`, `94bfa81`, `a31aecd`) permanecem registrados; o commit
  puramente documental desta célula não altera código de produto, de UI ou de
  teste, então o verde aplicável ao código testado é o de `f633e07`. **Próximo:**
  nada aberto nesta frente — passo 2 e passo 7 do briefing fechados aqui; ficam
  com o operador a promoção da célula APLIB e a semântica do índice 0 na UI.

- 2026-09-27 (integrador, **PASSO 5 — o recurso real BYOR editado pela frente do
  produto, Pernas 1 e 3 fechadas, perna 2 aberta**), esta célula é o checkpoint.
  **HEAD de partida:** `7aeb3fa` + o teste da perna 1 ainda não commitado.
  **Perna 1 (`5880a22`, `byor_aplib_edite_o_recurso_pelo_fluxo_do_produto`):** as
  três chamadas que a barra faz — `list_resources` → `preview_resource` →
  `apply_resource_edit` — sobre a ROM BYOR, com a transação canônica inteira
  exercida em bytes reais e conferida por fora do produto: o recurso do stream
  `0x2e12a` aparece exatamente uma vez na lista (`aplib`, header `0x21b20`, 100
  tiles, plain 3 200 B, custo 938), a prévia é 128×56, o no-op não escreve
  arquivo nenhum, a edição escreve 937 B, todos os bytes divergentes caem dentro
  do slot, o produto re-desempacota o stream escrito (`bytes_consumed == 937`,
  um único byte de plain mudado), o vizinho de `0x2e4d4` continua decodificando o
  mesmo plain de 16 000 B, `verify_resource_set` re-rodado na cópia diverge só no
  stream alvo, o BPS reaplicado sobre ROM íntegra reproduz a cópia byte a byte e
  a cópia reaberta devolve a mesma prévia.
  **Perna 3 (`d43fdde`, `rex05_hamoopig_aplib_edit_pelo_produto_executa_no_core`):**
  quem executa o stream que o produto escreveu é o **desempacotador do próprio
  jogo**. A cópia modificada não é montada à mão — sai de `apply_resource_edit` e
  o hash anunciado é conferido no disco. Três corridas frescas (power-on, não
  savestate: neste título a restauração não é fiel — achado REX-00) sob Genesis
  Plus GX v1.7.4 `46a5521` com o mesmo script de 180 frames. **Medido:** 0 pixel
  de ruído entre as duas corridas da ROM íntegra; **238 pixels alterados em 119
  frames** (59..179, menos 60/61), **exatamente 2 por frame**, agregando nas
  coordenadas `[[212,200],[284,128]]` — as duas colocações do tile 53 que o passo
  4 previu **antes** de executar; **0** pixels fora dos retângulos das células; e
  no checkpoint 129, o da atribuição residual de 2 938 pixels, a mudança é
  exatamente as mesmas duas colocações. A asserção 0 amarra a janela observada a
  uma medição **anterior a esta frente**: os frames 59/69/129/179 desta corrida
  reproduzem byte a byte os hashes de
  `rex-evidence-2026-09-10/backend-hamoopig/checkpoint-rgba-hashes.json`
  (arquivo de 2026-09-12, SHA-256 `e7527a83…`). Seis corridas no ledger, todas
  com o mesmo `candidate_sha256` (`69389ec2…`) e os mesmos números, inclusive as
  três anteriores ao endurecimento.
  **Evidência discriminante e o limite dela, registrado:** a perna 1 morre em 5
  testes se a variante aPLib de `verify_resource_set` devolve `None`, e cai na
  fronteira `expect("edição aPLib no recurso real")` se o re-encode codificar o
  plain original em vez do editado. Na perna 3, os dois mutantes de geometria
  (nibble par↔ímpar em `md_pixel_location`, linha do tile invertida) **morrem
  antes**, em `excessive_output: 3200 bytes de plain precisam de 942/941 bytes de
  stream, orçamento de 938` — com 1 B de folga no slot nenhuma mudança de
  geometria chega viva à asserção de coordenada. **Não foi exibido mutante que
  passe pela perna 1 e caia só na coordenada**; o acréscimo da perna 3 é o
  oráculo (o unpacker do jogo e o TileMap real, não o renderer da prévia), e isto
  consta do doc-string do teste em vez de ser alegado ao contrário.
  **Evidência promovida (por hash, sem bytes de ROM):**
  `data/rex_profiles/integrator/aplib/evidence/2026-09-27-passo5-perna3-core/` —
  manifesto com ROM original/cópia/BPS/core/binário de teste/script conferidos no
  disco, relatório do teste, registro extraído do ledger e **um** log de gates
  real da árvore em `d43fdde`. Os quatro PPM **não** são versionados (quadros
  derivados de ROM comercial); os SHA-256 deles viajam no manifesto.
  **Gates desta árvore:** `cargo fmt --check` rc=0; `cargo clippy --lib --
  -D warnings` rc=0; `cargo test --lib` **706 passed / 0 failed / 61 ignored**
  rc=0; o aceite ignorado da perna 3 `1 passed`.
  **Perna 2 (aberta, é o gap declarado no `gaps` do próprio run):** WebDriver
  pela barra — a interface chamando estes mesmos três comandos nesta ROM. O
  harness já existe para o fixture autoral (`scripts/e2e-tauri-build-run.mjs`,
  `rex-resource-panel` em diante); o que falta é exercitar o recurso aPLib real,
  e ele não pode vir do fixture: o único aPLib que a toolchain embute
  (`0x270de`, o `font_08x08`) é apontado por **zero** `TiledImage` (medição do
  passo 4), então a descoberta não o apresenta como editável — por construção a
  perna 2 precisa de BYOR, que o CI não pode provisionar.
  **Matriz:** linha aPLib **mantida `blocked`** — a célula "Recurso real" tinha
  como condição de saída exatamente a execução do recurso modificado pelo
  desempacotador do jogo, que agora existe, mas a ordem do operador veta promoção
  de maturidade e a perna 2 está aberta; a mudança de status fica para decisão do
  operador com as três pernas na mesa. **Bloqueio:** nenhum externo.


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
