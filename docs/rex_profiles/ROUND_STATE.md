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
| encode | verified | re-codificação com dicionário dentro do espaço original (needs_space honesto nos demais; 159/160 recursos preservados na transação) |
| reinserção em cópia + patch | verified | transação no produto: identidade SHA, dependente recusado (0x91a00 dependente de 0x8ff8e), cópia + BPS exportado e re-aplicado à base com hash exato |
| efeito observado no jogo | **BLOQUEADO — classe do alvo desconhecida** | **Retratação (2026-09-26)**: a leitura "9 paletas × 16 cores" e o mecanismo "transparência tornada opaca" eram hipóteses sem evidência de consumidor — retirados do estado corrente (preservados no histórico do Memory Bank). O "efeito" anterior era ruído: o resume do loop vivo entre runs dessincronizava os frames comparados. **Sonda causal** (no E2E): com ROM/core/estado/inputs idênticos (run_frames determinístico), **nenhuma diferença foi medida** em WRAM/VRAM entre original e modificado em 900 frames (controle original/original também idêntico, o que valida determinismo e metodologia). **Precisão (2026-09-26, ETAPA C): isso não prova que o recurso não seja descompactado** — a sonda só alcança as regiões que o core expõe (`emulator_read_memory` regiões 2/3; CRAM e o destino/chamada do desempacotador ficam `missing`). Ausência de diferença observada ≠ ausência de carregamento. Consumidor não provado; **edição semântica deste recurso permanece BLOQUEADA**. Evidências de bytes: intervalo alterado [30,31), byte 30 0x00→0xF0 (pixel (0,7,4), a única edição que coube com o encoder corrigido; needs_space honesto nas demais). **Defeitos corrigidos nesta rodada**: (1) tiles são chunky (nibble empacotado), não planar — golden literal `12 34 56 78`→1..8; (2) o encoder emitia matches longos não-ROM com offset acima do que o 68000 lê para trás (janela do codificador restaurada a 0x4000 por estratégia; o teto **do formato** medido no hardware é 16385 e o decoder agora aceita até ele — `LZ4W_68K_ORACLE.md`); (3) o preview em grade lia a faixa linearmente e escondia edições fora do tile 0/linha 0; (4) verificação de ida-e-volta dentro da transação. Canvas do app == framebuffer do core comprovado como capacidade separada (subimagem 256×192 ou 320×224 conforme o estado). Varredura dos 18 recursos com tiles em tela: fit=0 no orçamento do tile 0 (needs_space honesto) |
| efeito demonstrado em **fixture autoral** (ETAPA D) | verified (mecanismo) | ROM Mega Drive autoral construída aqui (`scripts/rex_profiles/integrator/lz4w_fixture/`, SGDK 2.11, `TILESET ... LZ4W NONE`, SHA da ROM `159298eb…`), onde a cadeia de consumo é conhecida **por construção** (`unpackTileSet` -> `VDP_loadTileSet` -> `VDP_fillTileMapRectInc`, tile `t` numa única célula `(t%4, t/4)`). O aceite `--ignored` percorre a cadeia real do produto: decode == fonte recomposta; no-op honesto; **linha de base medida antes da busca** (`slot(rescomp)=444B` vs `re-codificação do plain não-editado=448B`, folga `-4B`); edição de 1 pixel **prevista antes de qualquer emulação** (`tile 0, row 5, col 7 -> idx 15`, re-encode 440B **dentro** do slot de 444B) aplicada pela transação canônica; ROM modificada reaberta e re-decodificada == plain planejado; coordenada de tela prevista `(7,5)` e prévia renderizada (SHA dos pixels/PNG). O stream **escrito pelo produto** desempacota no 68000 oficial: `data/rex_profiles/integrator/lz4w-68k/evidence/2026-09-26-r13/runs/runF` (`i30` rescomp, `i31` produto) ambos `68k == jar == esperado` em 512B. **Discriminante negativa preservada**: no fixture **sem** plantio, varredura exaustiva dos 15.360 candidatos de 1 pixel deu `0 cabem` (`.../lz4w-fixture/evidence/2026-09-26/fixture-acceptance-exhaustive-before-plant.log`). **Por que o plantio é necessário e isso não é trapaça**: o LZ4W casa **words de 16 bits**, não pixels; uma edição de 1 pixel só encurta o stream se tornar dois words adjacentes idênticos. O gap de codificador foi medido duas vezes (444/448 e 378/380) e **não** foi escondido: o porte do DP ótimo de `LZ4W.java` foi implementado, ficou verde no suíte e **piorou** (382B vs 380B) — revertido em vez de entregue; um DP fiel precisa de estado `(posição x literais pendentes mod 15)` porque o custo de 1 palavra/token ignora o chunk de 15 literais. Limite honesto: prova de **mecanismo**, não de cobertura de alvos reais; a tela do app ainda não foi capturada por emulação (ETAPA E) |

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
