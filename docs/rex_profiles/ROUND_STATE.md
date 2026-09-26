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
| LZ4W SGDK | verified (SGDK MIT, prev-block + self-contained) | fixture (golden autorais) | verified (lz4w.jar 2 direções) | verified (lz4w.jar 2 direções) | verified (truncated/invalid-reference/overflow/excessive-output/work-limit/dicionário) | verified (corpus HAMOOPIG, ver cadeia) |
| Nemesis | blocked | fixture (PR #79, vetores nemcmp) | blocked | blocked | blocked | blocked |
| Kosinski | blocked | blocked | blocked | blocked | blocked | blocked |
| Enigma | blocked | fixture (PR #79, vetores enicmp) | blocked | blocked | blocked | blocked |

LZ4W implementado no produto em Rust canônico (`src-tauri/src/tools/reverse/
decomp/rex_codecs.rs`): decode com dicionário prev-block (port do unpacker
oficial, ROM-source com offsetAdj) e encode com dicionário + lazy matching;
oráculo oficial `lz4w.jar` exercido nas duas direções; 16 testes focados.

## Cadeia de recurso comprimido (propriedade: integrador)

| Etapa | Status | Evidência |
|---|---|---|
| ROM -> origem verificável | verified (assistido, rotulado) | scan estrutural de headers TileSet + decode exato `numTile*32` com dicionário = prefixo da ROM; aceite BYOR `byor_hamoopig_chain_original_noop_modified_and_patch` |
| decode | verified | 160/191 streams LZ4W do corpus HAMOOPIG congelado decodificam com tamanho exato |
| prévia | verified | `render_resource_png` chunky 4x no produto com pixels SHA-256 e comparação independente; exibida na aba "Recursos comprimidos" |
| edição | verified (via UI) | formulário pixel (tile/linha/coluna/índice) + transação canônica; no-op com zero edições pela mesma UI |
| encode | verified | re-codificação com dicionário dentro do espaço original (needs_space honesto nos demais; 159/160 recursos preservados na transação) |
| reinserção em cópia + patch | verified | transação no produto: identidade SHA, dependente recusado (0x91a00 dependente de 0x8ff8e), cópia + BPS exportado e re-aplicado à base com hash exato |
| efeito observado no jogo | **BLOQUEADO — classe do alvo desconhecida** | **Retratação (2026-09-26)**: a leitura "9 paletas × 16 cores" e o mecanismo "transparência tornada opaca" eram hipóteses sem evidência de consumidor — retirados do estado corrente (preservados no histórico do Memory Bank). O "efeito" anterior era ruído: o resume do loop vivo entre runs dessincronizava os frames comparados. **Prova causal nova** (sonda no E2E): com ROM/core/estado/inputs idênticos (run_frames determinístico), WRAM e VRAM são **idênticas** entre original e modificado em 900 frames (controle original/original também idêntico) — o recurso 0xc8cc8 não é descompactado na janela explorada; consumidor não provado; **edição semântica deste recurso permanece BLOQUEADA**. Evidências de bytes: intervalo alterado [30,31), byte 30 0x00→0xF0 (pixel (0,7,4), a única edição que coube com o encoder corrigido; needs_space honesto nas demais). **Defeitos corrigidos nesta rodada**: (1) tiles são chunky (nibble empacotado), não planar — golden literal `12 34 56 78`→1..8; (2) o encoder emitia matches longos não-ROM com offset > 0x4000 que o 68000 leria como referência PARA FRENTE (janela restaurada ao limite oficial; decoder rejeita); (3) o preview em grade lia a faixa linearmente e escondia edições fora do tile 0/linha 0; (4) verificação de ida-e-volta dentro da transação. Canvas do app == framebuffer do core comprovado como capacidade separada (subimagem 256×192 ou 320×224 conforme o estado). Varredura dos 18 recursos com tiles em tela: fit=0 no orçamento do tile 0 (needs_space honesto) |

Limitações declaradas: identificação é estrutural assistida (header declara
codec e tamanho), não descoberta automática geral; stream editado recusado
quando outros recursos dependem dos bytes originais (equivalência global de
decode verificada no teste); sem expansão de ROM, realocação ou edição de
ponteiros no v1.

## Histórico da rodada

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
