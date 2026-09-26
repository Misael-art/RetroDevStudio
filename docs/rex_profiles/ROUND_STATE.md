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
| LZ4W SGDK | verified (SGDK MIT, prev-block + self-contained) | fixture (golden autorais) | verified (desempacotador 68000 oficial sob MAME + lz4w.jar nas duas direções) | verified (o 68000 reproduz byte a byte cada stream dos casos medidos emitida pelo encoder atual) | verified (truncated/invalid-reference/overflow/excessive-output/work-limit/dicionário/fronteira 16384-16385-16386) | verified (corpus HAMOOPIG, ver cadeia) |
| Nemesis | blocked | fixture (PR #79, vetores nemcmp) | blocked | blocked | blocked | blocked |
| Kosinski | blocked | blocked | blocked | blocked | blocked | blocked |
| Enigma | blocked | fixture (PR #79, vetores enicmp) | blocked | blocked | blocked | blocked |

LZ4W implementado no produto em Rust canônico (`src-tauri/src/tools/reverse/
decomp/rex_codecs.rs`): decode com dicionário prev-block (port do unpacker
oficial, ROM-source com offsetAdj) e encode com dicionário + lazy matching.
Dois oráculos externos, em níveis diferentes: `lz4w.jar` v1.43 (referência Java
de 32 bits, nas duas direções) e o **desempacotador 68000 real** (`tools_a.s`
do SGDK 2.11, montado e executado sob MAME 0.289) — o segundo é o padrão do
alvo, porque é o código que roda no console. Evidência, derivação do teto e
limites em `LZ4W_68K_ORACLE.md`; 24 testes focados + 1 aceite BYOR ignorável.

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
| encode | verified (com benchmark de capacidade congelado) | re-codificação com dicionário dentro do espaço original; busca de candidatos do dicionário e da saída **mesclada por proximidade** (mesmo teto de 128, mesma janela, mesmo lazy) levou o fixture de 448→**444 B, byte a byte o stream do `rescomp`** e o corpus de `folga_base` somada −13 188→**−9 156 B** (158 melhoraram, **0** pioraram, 2 empataram). Medida pela especificação congelada `scripts/rex_profiles/integrator/lz4w_recompress/BENCH_SPEC.md` com split de validação `índice % 5`; needs_space honesto nos demais; 159/160 recursos preservados na transação. **Capacidade real medida, não prometida**: com esse ganho continua havendo **1/160** recurso com folga não negativa (`0xc8cc8`, +2 B) e a bateria amostral (24 bits/recurso) só encontra bit cabível ali — a edição canônica de 1 pixel custa 146 B contra slot de 144 B. Causa e leitura em `LZ4W_ENCODER_444_VS_448_2026-09-26.md` §4.1; evidência `data/rex_profiles/integrator/lz4w-recompress/evidence/2026-09-26-r{1,2,3,4-final-pin}/` (r1 = linha de base pinada em `656bdc9f…`, r4 = pino final `bee8524f…`) |
| reinserção em cópia + patch | verified | transação no produto: identidade SHA, dependente recusado (0x91a00 dependente de 0x8ff8e), cópia + BPS exportado e re-aplicado à base com hash exato |
| efeito observado no jogo | **BLOQUEADO — classe do alvo desconhecida** | **Retratação (2026-09-26)**: a leitura "9 paletas × 16 cores" e o mecanismo "transparência tornada opaca" eram hipóteses sem evidência de consumidor — retirados do estado corrente (preservados no histórico do Memory Bank). O "efeito" anterior era ruído: o resume do loop vivo entre runs dessincronizava os frames comparados. **Sonda causal** (no E2E): com ROM/core/estado/inputs idênticos (run_frames determinístico), **nenhuma diferença foi medida** em WRAM/VRAM entre original e modificado em 900 frames (controle original/original também idêntico, o que valida determinismo e metodologia). **Precisão (2026-09-26, ETAPA C): isso não prova que o recurso não seja descompactado** — a sonda só alcança as regiões que o core expõe (`emulator_read_memory` regiões 2/3; CRAM e o destino/chamada do desempacotador ficam `missing`). Ausência de diferença observada ≠ ausência de carregamento. Consumidor não provado; **edição semântica deste recurso permanece BLOQUEADA**. Evidências de bytes: intervalo alterado [30,31), byte 30 0x00→0xF0 (pixel (0,7,4), a única edição que coube com o encoder corrigido; needs_space honesto nas demais). **Defeitos corrigidos nesta rodada**: (1) tiles são chunky (nibble empacotado), não planar — golden literal `12 34 56 78`→1..8; (2) o encoder emitia matches longos não-ROM com offset acima do que o 68000 lê para trás (janela do codificador restaurada a 0x4000 por estratégia; o teto **do formato** medido no hardware é 16385 e o decoder agora aceita até ele — `LZ4W_68K_ORACLE.md`); (3) o preview em grade lia a faixa linearmente e escondia edições fora do tile 0/linha 0; (4) verificação de ida-e-volta dentro da transação. Canvas do app == framebuffer do core comprovado como capacidade separada (subimagem 256×192 ou 320×224 conforme o estado). Varredura dos 18 recursos com tiles em tela: fit=0 no orçamento do tile 0 (needs_space honesto) |
| efeito demonstrado em **fixture autoral** (ETAPA D) | verified (mecanismo) | ROM Mega Drive autoral construída aqui (`scripts/rex_profiles/integrator/lz4w_fixture/`, SGDK 2.11, `TILESET ... LZ4W NONE`, SHA da ROM `159298eb…`), onde a cadeia de consumo é conhecida **por construção** (`unpackTileSet` -> `VDP_loadTileSet` -> `VDP_fillTileMapRectInc`, tile `t` numa única célula `(t%4, t/4)`). O aceite `--ignored` percorre a cadeia real do produto: decode == fonte recomposta; no-op honesto; **linha de base medida antes da busca** (`slot(rescomp)=444B` vs `re-codificação do plain não-editado=448B`, folga `-4B`); edição de 1 pixel **prevista antes de qualquer emulação** (`tile 0, row 5, col 7 -> idx 15`, re-encode 440B **dentro** do slot de 444B) aplicada pela transação canônica; ROM modificada reaberta e re-decodificada == plain planejado; coordenada de tela prevista `(7,5)` e prévia renderizada (SHA dos pixels/PNG). O stream **escrito pelo produto** desempacota no 68000 oficial: `data/rex_profiles/integrator/lz4w-68k/evidence/2026-09-26-r13/runs/runF` (`i30` rescomp, `i31` produto) ambos `68k == jar == esperado` em 512B. **Discriminante negativa preservada**: no fixture **sem** plantio, varredura exaustiva dos 15.360 candidatos de 1 pixel deu `0 cabem` (`.../lz4w-fixture/evidence/2026-09-26/fixture-acceptance-exhaustive-before-plant.log`). **Por que o plantio é necessário e isso não é trapaça**: o LZ4W casa **words de 16 bits**, não pixels; uma edição de 1 pixel só encurta o stream se tornar dois words adjacentes idênticos. O gap de codificador foi medido duas vezes (444/448 e 378/380) e **não** foi escondido: o porte do DP ótimo de `LZ4W.java` foi implementado, ficou verde no suíte e **piorou** (382B vs 380B) — revertido em vez de entregue; um DP fiel precisa de estado `(posição x literais pendentes mod 15)` porque o custo de 1 palavra/token ignora o chunk de 15 literais. Limite honesto: prova de **mecanismo**, não de cobertura de alvos reais; a tela do app foi capturada por emulação na ETAPA E (ver linha seguinte) |
| efeito causal demonstrado **na aplicação** (ETAPA E) | verified (fixture autoral) | cenário E2E `rex-lz4w-fixture-effect` (`scripts/e2e-tauri-build-run.mjs`) rodando o binário real `e6907792…` e o core oficial Genesis Plus GX v1.7.4 `46a5521`: descuberta+decode **pela UI** (header 95464, stream `0x5f988`, slot 444 B, `1/5 candidatos`), no-op honesto, edição de 1 pixel aplicada pela transação canônica (modificada `e55dba92…`, BPS `52ce036f…` 74 B, 268 bytes distintos, faixa `5f9a1..5fb3f`, `diferenteForaDoSlot:0`), BPS re-aplicado reproduzindo o hash exato, cópia reaberta decodificando no plain editado (`917048cc35508e9a`), **prova de memória** em WRAM (1 byte, `0x5e f0→ff`) e **exatamente 1 pixel de tela diferente na coordenada prevista (7,5)** com as classes de cor certas (`0x212021 → 0x8c008c`, 11 classes), canvas == framebuffer do core (320×224), e os dois negativos alcançáveis: guarda de intervalo da fila (0 entradas, 0 escritas, com controle positivo enfileirando 1) e `rom_identity_mismatch` por TOCTOU com a ROM do fixture verificada intacta. Verde duas vezes com o código final (run10/run11, rc=0 lido nos próprios logs). Pacote promovido com manifesto vinculado ao binário: `data/rex_profiles/integrator/lz4w-fixture/evidence/2026-09-26-e2e/` (`manifest.json`). **Limitações medidas, registradas como não provadas e não como sucesso**: (a) o core não expõe `VIDEO_RAM` (`retro_get_memory_size==0`, mas `emulator_read_memory` responde `ok:true` com dados vazios — armadilha de prova vacuada), então a perna de VRAM fica `observed:false`; (b) a fusão de DAC do Mega Drive reduz as 16 palavras de paleta autorais a **11 cores** — índice→cor é função, não injeção, portanto a identidade do pixel alterado é estabelecida por **posição** e a cor só confirma a classe (`scripts/rex_profiles/integrator/lz4w_fixture/analyze-frame.py`); (c) a recusa de intervalo do **núcleo** é inalcançável pela UI (o painel descarta `editTile >= num_tiles` no cliente, `CompressedResourcePanel.tsx`), e por isso está provada no teste unitário `apply_rejects_tile_outside_resource_without_writing`, não no E2E. **Emenda (2026-09-26, PASSO 4)**: o descarte era **silencioso** — agora `editRejectReason` explica o motivo no painel (`rex-resource-notice`) e no log da ferramenta, preserva a fila válida e não envia o candidato inválido; a guarda do núcleo segue sendo a definitiva (testes `tile fora do recurso: avisa…` e `linha, coluna e índice inválidos…`). Isso não torna a recusa do núcleo alcançável pela UI: continua provada no unitário. (d) as duas corridas rc=0 **leram a ROM de `/tmp`** (`fixture.romPath` no relatório do run11; o cenário consome o que `RDS_REX_LZ4W_FIXTURE_ROM` apontar e não reconstrói o fixture sozinho) — o caminho durável devolve o mesmo SHA `159298eb…` (`fixture-rebuild-report.json`, reconferido por `sha256sum`), então a entrada é reprodutível a partir do repositório, mas não foi o arquivo do repositório que as corridas registradas abriram. Nada aqui altera o alvo comercial: `0xc8cc8` continua `BLOQUEADO`. **Relatório técnico:** `docs/rex_profiles/RELATORIO_ETAPA_E_2026-09-26.md` |

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
