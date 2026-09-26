# LZ4W — oráculo 68000 oficial e o teto da janela não-ROM

**Status:** evidência medida em 2026-09-26 (integrador) · **Contrato:** `CONTRACTS.md` §4
("roundtrip puramente interno não é prova") · **Pino do código medido:**
`rex_codecs.rs` com SHA-256
`6044135b30f51bc746f8b15e6baf6b94cabbbd52c067ce969ea0cb231fa83e18`
(DP de custo explícito + política de escrita com orçamento de espaço; evidência em
`data/rex_profiles/integrator/lz4w-68k/evidence/2026-09-26-r15/`).

Cadeia de pinos desta medição — o mesmo harness rodou sobre três códigos:

| `rex_codecs.rs` | o que mudou | evidência |
|---|---|---|
| `656bdc9f…` @ `13a5792` | teto de hardware 16385 no decoder | `…/lz4w-68k/evidence/2026-09-26/` |
| `bee8524f…` @ `b8cf3b0` | `find_best` percorre dicionário e saída em ordem mesclada por proximidade | `…/lz4w-68k/evidence/2026-09-26-r14/` |
| `6044135b…` @ `cde88cc` | DP de custo explícito (`..._explained`) e política por orçamento de espaço (`..._fitting`); o produto passa a ter **dois** caminhos de codificação | `…/lz4w-68k/evidence/2026-09-26-r15/` |

## 1. Por que este documento existe

O decoder do produto validava o offset de um match longo não-ROM contra a
**janela de busca do compressor** (`0x4000` words) como se ela fosse um limite
do formato. As duas coisas são grandezas diferentes, e a confusão fez o
produto recusar um stream que o hardware desempacota corretamente. O limite do
formato é o que o **desempacotador 68000 oficial** consegue ler para trás, e
isso só é decidido por medição contra ele — não pelo roundtrip Rust↔Rust.

## 2. Derivação a partir do asm oficial

`SGDK 2.11 src/tools_a.s` (SHA-256
`34c9e8d67683ad9aa6a723891f86e70742add1007efb9a5f8f497b62bc60e2d0`), rótula
`.long_match`:

```
move.w  (a0)+,d0      ; word de offset do stream (16 bits)
add.w   d0,d0         ; duplica COM ARITMÉTICA DE 16 BITS
bcs     .lm_rom       ; carry ⇒ bit 0x8000 ⇒ fonte = ROM/dicionário
lea     -2(a1,d0.w),a2 ; displacement com SINAL de 16 bits a partir do dst
```

Com a convenção do empacotador `value = (-(off-1)) & 0x7FFF`:

| `value` | `add.w d0,d0` em int16 | leitura do 68000 | offset correspondente |
|---|---|---|---|
| `0x4000`…`0x7FFF` | `0x8000`…`0xFFFE` ⇒ negativo | **para trás** (correta) | `2` … `16385` |
| `0x0000` | `0x0000` | para trás (`-2 + 0` ⇒ último word) | `1` (válido) |
| `0x0001`…`0x3FFF` | positivo | **para FRENTE** — aliassa bytes após o dst | `16386` … (`0x7FFF`) |

Teto derivado: **`off <= 16385` words** para referência longa sem bit-ROM.
`value == 0` não é terminador: é o offset 1. O bit `0x8000` segue um caminho
diferente (`.lm_rom`), com alcance próprio — os dois limites são independentes.

## 3. Como foi medido (não é simulação)

* Desempacotador: `lz4w_unpack` **real**, montado do `tools_a.s` oficial com a
  toolchain embutida no SGDK 2.11 sob wine. `build-rom.sh` extrai
  `.text.asm.lz4w_unpack` do objeto montado e do `libmd.a` oficial e exige
  **bytes + tamanho idênticos**: 5056 bytes, SHA-256
  `ff18bacb349174a4324df9e9386f2635a948b3c527aab5e91c994a0e162f7787`, conferido
  nas **7** construções de ROM de cada rodada (r14 e r15: `runI`, `runC`, `runE`,
  `run14`, `run15`, `run16`, `runF`). A versão anterior deste parágrafo dizia
  "6": contagem errada, não mudança na cadeia de rodadas.
* Execução: **MAME 0.289** (slot `genesis`, cart ZIPpado,
  `-noplugins -hashpath <vazio> -skip_gameinfo -autoboot_script capture.lua`).
  A RAM é despejada pela sentinela `$FF0180 = 0xDEADBEEF`; o tamanho retornado
  por caso fica em `$FF0000 + i*4`.
* Layout por caso (harness2): `gap 0x5AA5×128 + prefixo-dicionário + stream` na
  ROM; o harness copia o prefixo para o destino e chama
  `lz4w_unpack(src, dst + plen)` — exatamente o contexto do produto
  (`decode(stream, Some(&rom[..start]))`). Buffers de destino contíguos em
  `$FF0200`, pré-preenchidos com `0xFEFE` para detectar qualquer sobrescrita.
* Desempate tripartite: **68k oficial × oráculo Java `lz4w.jar` v1.43
  (`bfcf9c69…`) × plano esperado pelo produto**, com primeiro byte divergente
  reportado, verificação de prefixo intacto e de ausência de estouro.

Ferramenta de medição em `scripts/rex_profiles/integrator/lz4w_68k/`
(proveniência das cópias em `PROVENANCE.md`). Evidência bruta (logs, comprimentos,
SHA-256 por execução) em
`data/rex_profiles/integrator/lz4w-68k/evidence/2026-09-26-r14/` (pino atual) e
`…/evidence/2026-09-26/` (pino anterior) — **nenhum byte da
ROM comercial é versionado**; a ROM BYOR é pré-requisito local do `reproduce.sh`
(SHA-256 `558bea6c…`, 917 504 bytes).

## 4. Casos e vereditos

Coluna "Origem da stream" distingue os dois caminhos do codificador: **"entrada
DP-first"** = `lz4w_encode_with_dictionary_index_explained` (o que o benchmark de
recompressão mede); **"caminho de escrita"** = `..._index_fitting` com o slot do
recurso como orçamento (o que a transação grava na ROM). 14 casos em 7 blocos de
execução: o `ORACLE-RUN.log` de r15 não tem linha `FATAL`, a única linha `DIVERGE`
é `i16` (exigida por contrato, e o bloco fecha com "DIVERGÊNCIA DO 68k
CONFIRMADA"), e os outros 6 blocos fecham com `RESULTADO: TODOS OS CASOS
IDÊNTICES`. O código de saída do shell não foi capturado no log — quem precisa
dele como evidência reexecuta o §7.

| Caso | Origem da stream | O que testa | Produto | 68k oficial | jar v1.43 |
|---|---|---|---|---|---|
| `i20_lits_odd` | **entrada DP-first** | só literais + cauda ímpar (11 bytes) | ok | idêntico | idêntico |
| `i21_short_mix` | **entrada DP-first** | matches curtos off 2 e off 1 | ok | idêntico | idêntico |
| `i22_long_far_nodict` | **entrada DP-first** | longo auto-referente dentro da saída (620 B) | ok | idêntico | idêntico |
| `i23_long_zero_value` | **entrada DP-first** | longo com `value = 0x0000` (off 1) | ok | idêntico | idêntico |
| `i24_dict_mixed` | **entrada DP-first** | dicionário + curto + longo não-ROM + autorref. | ok | idêntico | idêntico |
| `i09_corpus_orig_c8cc8` | **corpus (original)** | recurso real 0xc8cc8 com prefixo mínimo aceito (4096 B) | ok | idêntico (288 B) | idêntico |
| `i18_corpus_edit_c8cc8` | **entrada DP-first** sobre a edição canônica | re-codificação do alvo real do produto: 144 B dentro do slot de 144 | ok | idêntico (288 B) | idêntico |
| `i40_corpus_edit_fitting_c8cc8` | **caminho de escrita** (`..._fitting`, orçamento = slot) | a mesma edição pelo caminho que a transação usa: 144 B, estratégia `CostDp`, byte a byte igual a `i18` | ok | idêntico (288 B) | idêntico |
| `i14_encoder_deep_16384` | **encoder atual** | `Rust encode → 68k decode` no offset mais fundo alcançável (16384, `value 0x4001`); dicionário com 16 386 words par-a-par distintos para forçar **as duas estratégias** ao token longo | ok | idêntico | idêntico |
| `i15_hardware_ceiling_16385` | construída à mão | **teto do formato**: off 16385 (`value 0x4000`) | **aceita** | idêntico | idêntico |
| `i16_beyond_ceiling_16386` | construída à mão | um word além: off 16386 (`value 0x3FFF`) | **recusa** (`invalid_reference`) | **DIVERGE**: byte 0 = `0x24` em vez de `0xBE` | idêntico ao pretendido |
| `i30_fixture_rescomp_orig` | **fixture autoral** | stream do `rescomp` no plain não editado (444 B, prefixo mínimo 256 B) | ok | idêntico | idêntico |
| `i31_fixture_product_edit` | **entrada DP-first** sobre a edição do produto | edição plantada (tile 0, linha 5, col 7 → índice 15): 436 B dentro do slot de 444 | ok | idêntico | idêntico |
| `i41_fixture_edit_fitting` | **caminho de escrita** (`..._fitting`, orçamento = slot) | a mesma edição como a transação a escreve: 436 B, estratégia `Greedy`, byte a byte IDÊNTICA ao stream que o pino só-guloso escrevia | ok | idêntico | idêntico |

Consequências diretas:

1. `16385` é o teto correto e estava sendo recusado indevidamente pelo decoder —
   corrigido em `13a5792` com regressões calculadas à mão (`rex_codecs.rs`).
2. A recusa a partir de `16386` **não é conservadorismo**: o hardware produz
   bytes errados em silêncio (lê para frente e aliassa a ROM), enquanto o
   oráculo Java — que aritmetiza em 32 bits — decodifica o pretendido. Ou seja,
   concordar com o jar aqui seria **errado para o alvo**; o produto decide pelo
   hardware.
3. Recompressão do recurso real **deixou de ser recusada por espaço**: a edição
   canônica re-codificada media **150 bytes** no pino `656bdc9f…`, **146 bytes**
   no pino `bee8524f…` (busca mesclada, `needs_space` honesto contra um slot de
   **144**) e **144 bytes** no pino `6044135b…` — cabe no próprio slot, e é essa
   stream de 144 B que o 68k desempacotou (`i40`), sem expansão de ROM e sem
   tocar vizinhos. Nada foi forçado por sobrescrita em nenhum dos três pinos.
   Diagnóstico do porquê, token a token: `LZ4W_ENCODER_444_VS_448_2026-09-26.md`
   §4.1.
4. Os dois caminhos do codificador não são intercambiáveis para quem escreve num
   slot: no fixture, `i31` (DP-first) e `i41` (escrita) têm o MESMO comprimento e
   parses diferentes, e só `i41` reproduz byte a byte o que o pino só-guloso
   escrevia — a razão está na pegada de escrita (um re-parse global reescreve a
   stream inteira e o prefixo é o dicionário do vizinho), documentada em
   `rex_codecs.rs` e medida em
   `data/rex_profiles/integrator/lz4w-recompress/evidence/2026-09-26-r7-final-pin/`.

## 5. Relação com a medição anterior (agente-B)

B mediu o mesmo desempacotador antes desta correção
(`…/evidence/rust-streams-2026-09-26/reproduce.sh`, commit `9b2389d`): `r11`
(off 16590) divergiu no 68k, `r12` (off 16385) passou no 68k e no jar enquanto
o decoder do produto recusava, `r13` (edição canônica com a janela 0x4000) deu
150 > 144. Aqueles streams de fronteira foram emitidos pelo **encoder legado**
(janela 0x8000), que o produto não tem mais. A tabela acima refaz a medição com
o codec em revisão, acrescenta o caso emitido pelo encoder no offset mais fundo
alcançável (`i14`) e fecha o lado divergente no mínimo possível (`i16`, 16386).
**As suítes A e B continuam não integradas**; apenas a ferramenta de medição foi
vendorada com proveniência registrada.

## 6. Limites do que está provado aqui

* Prova de **formato/decode** contra o hardware, para os casos listados. Não é
  prova de que o jogo descompacte o recurso, nem em que região, nem em que
  momento — isso é capacidade separada (`ROUND_STATE.md`, efeito observado).
* O corpus real tem 160/191 streams LZ4W verificados pelo produto; o replay 68k
  desta seção cobre o recurso do alvo (`0xc8cc8`) e os casos sintéticos, **não**
  as 160 streams individualmente.
* Truncamento de stream e erros estruturados (`truncated`, `overflow`,
  `excessive-output`, `work-limit`) **não têm contraparte no 68k**: o asm não
  reporta erro, apenas escreve. Esses códigos são provados somente nos testes do
  produto, e isso fica declarado em vez de ser alegado como equivalência.
* A busca do prefixo mínimo (`minimal_prefix`) é feita pela aceitação do
  produto; os valores medidos em r15 — 4096 B para o stream original de
  `0xc8cc8`, 512 B para a edição canônica (nos dois caminhos) e 256 B para o
  fixture — são medidas destes casos, não constantes do formato.
* O hardware leu **os dois caminhos** do codificador, mas não uniformemente: o
  caminho de escrita da transação tem exatamente 2 casos próprios (`i40` no
  recurso real, `i41` no fixture); o resto das streams codificadas sai pela
  entrada DP-first, que é o que o benchmark mede. A bateria dos 160 recursos do
  corpus continua aferida pelo decoder do produto, não pelo 68k — provar em
  hardware cada stream re-codificada seria uma rodada por recurso.

## 7. Reexecutar

```bash
REX_CODECS_SHA=6044135b30f51bc746f8b15e6baf6b94cabbbd52c067ce969ea0cb231fa83e18 \
RDS_REX_LZ4W_FIXTURE_ROM=<caminho absoluto da ROM do fixture autoral> \
  bash scripts/rex_profiles/integrator/lz4w_68k/reproduce.sh /tmp/rex-68k-int-<data>
```

Promovida a partir de `/tmp/rex-68k-int-2026-09-26-r15` (r14, o pino anterior,
tinha vindo de `/tmp/rex-68k-int-2026-09-26-r5`; a corrida `…-r4` pinava o mesmo
código antes do `cargo fmt` em `7b037745…`: as 7 ROMs e os 7 captures têm SHA-256
idênticos entre as duas, mudando apenas o hash do binário do driver — o
determinismo registrado no `manifest.json` de `r14` é desta comprovação).

Pré-requisitos medidos: SGDK 2.11 em `$GDK` (mapeado a `G:` no wine), wine-11.17,
MAME 0.289, Java 17, `lz4w.jar` v1.43 no cache do oráculo, `gawk`, `zip`, e a ROM
BYOR congelada em posse local. O script **falha** se o codec medido divergir do
pino, se o desempacotador montado divergir do `libmd.a`, se qualquer caso emitido
pelos dois caminhos do encoder divergir do 68k, se o caminho de escrita deixar de
caber no espaço do fixture (asserção no driver), ou se o 68k **não** divergir em
`i16`. A identidade byte a byte de `i41` com o stream do pino só-guloso
(SHA-256 `2776ec2c…`) NÃO é asserção do script: é confronto registrado no
`manifest.json` de r15 — quem mexer no codificador deve conferir esse SHA antes de
alegar que a escrita não mudou.
