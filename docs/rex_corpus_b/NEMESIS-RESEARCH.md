# NEMESIS — pesquisa de codec (REX corpus B)

Ferramenta **local de pesquisa/análise**. Nada aqui é candidato a produto.
Comando para reproduzir a validação inteira:

```bash
bash scripts/rex_corpus_b/nemesis-validate.sh          # PASS/FAIL/SKIP por caso + rollup
KEEP_TMP=1 bash scripts/rex_corpus_b/nemesis-validate.sh   # mantém data/rex_corpus_b/tmp
REX_NEMCMP=/outro/caminho/nemcmp bash scripts/rex_corpus_b/nemesis-validate.sh
```

## 1. Licença e procedência (regra inegociável da missão)

O decoder `scripts/rex_corpus_b/nemesis_research.py` foi escrito **a partir da
leitura** da referência LGPL-3.0 `mdcomp/src/lib/nemesis.cc` (commit
`72c6df405a75d322c5b3722da46c3abb864d3793`). Ele é portanto um **derivado de
leitura de código LGPL-3.0**: serve apenas para análise local e **nunca** pode
ser transplantado, copiado, reempacotado ou ligado ao RetroDev Studio. Nenhuma
linha foi copiada do C++; a semântica foi reconstruída e validada byte a byte
contra o oráculo externo `nemcmp`. O oráculo mdcomp é usado **somente como
ferramenta externa**. O mesmo rótulo está gravado em
`data/rex_corpus_b/nemesis/evidence/decode-parity.json` (campo `territory`) e
no docstring do módulo.

## 2. O formato, como medido (não como "deveria ser")

Stream (a partir de `offset`, BE em tudo):

- **size word** BE16 = `(flag_alt << 15) | rtiles`; saída declarada =
  `rtiles * 32` (Art Word 8x8 de planos de bit = 32 bytes; domínio do plain:
  `len % 32 == 0` e `> 0`). `byte0 = (flag_alt << 7) | (rtiles >> 8)`.
- **tabela adaptativa**: sequência de registros terminada por `0xFF`.
  Em cada registro: se o byte `b` tem `b & 0x80`, o nibble corrente passa a
  `b & 0x0F` e lê-se outro byte; então `count = ((b & 0x70) >> 4) + 1` nibbles,
  `len = b & 0x0F`, e o próximo byte é o código (emitido MSB-first no
  bitstream). O **nibble persiste** entre registros sem flag `0x80` (inicializa
  em 0) — sem replicar isso, streams válidas decodificam errado (provado por
  `c2_persist_nibble`). A tabela é um **map chaveado por (code, len)**; registro
  duplicado sobrescreve o anterior (comportamento medido do `std::map` da
  referência — `c2_dup_record`).
- **bitstream**: códigos de 1..8 bits; `0x3F` (`%111111`) é inline RLE
  (`count+1` cópias do nibble corrente); demais pares buscam na tabela.
  Nibbles são empacotados MSB-first e **cortados na saída declarada**
  (overshoot de runs é normal — `c2_code_len_sweep`).
- **variantes**: `flag_alt = 0` → saída literal (`nemesis-raw`);
  `flag_alt = 1` → saída com **XOR incremental por palavra de 4 bytes**
  (`nemesis-alt-xor`). Não há campo de profundidade de plano no cabeçalho.

Valores de modifier byte **observados com evidência**: `0x00`, `0x80`, `0x81`,
`0x88` (15 casos alt-xor, 10 casos raw, sobre 68 registros).

## 3. Contrato v1 §4 e divergências deliberadas do oráculo

`decode(stream, *, max_out, work_limit, cancel) -> (data, bytes_consumed)`, com
erros estruturados exatamente `truncated`, `invalid-reference`, `overflow`,
`excessive-output`, `work-limit`, `cancelled` (+ `input-not-in-domain`, exigido
pelo negative-spec para n01/n02, declarado como código de guarda de domínio).
`bytes_consumed` é obrigatório e exato (trailing garbage ⇒ `7`, não `14` —
`c2_trailing_garbage`). Validar antes de alocar; loops limitados por
`work_limit`; cancelamento cooperativo honrado.

O oráculo tem três **falhas registradas** que o meu decoder NÃO replica (viram
erros estruturados): (i) padriça entrada fora de domínio (medido: 6B→32,
100B→128), (ii) lê além do EOF até `rtiles*32` (`tellg = -1`,
`oracle_end_offset = None` em `b:ff32`/`b:z32`), (iii) aceita stream truncada
com tamanho pleno (n05). Cada divergência é medida, não presumida.

## 4. Variantes implementadas vs bloqueadas

Implementadas **por evidência**: `nemesis-raw` e `nemesis-alt-xor` (as duas
únicas que o formato conhece).

Bloqueadas, com motivo (campo `variantes.bloqueadas` na evidência):

- **2B/4B/8B (profundidade de plano)** — não existe no formato: `nemesis.cc` só
  conhece o flag alt do bit 15; 2B/4B/8B é convenção do consumidor sobre o
  layout dos 32 bytes do Art Word, sem evidência no oráculo.
- **goldens literais da tabela adaptativa** — exigir espelhar o empacotador
  (Package-merge) da referência LGPL; continua `blocked` pelo motivo da rodada
  1, não reaberto por suposição.
- **modo `=[pointer]` do CLI do nemcmp** — capacidade separada (offset no
  arquivo); não é variante de stream e não foi exercitada aqui.

## 5. Validação — como roda e o que mede

- Oráculo: `~/.cache/rex-codecs/oracle-tools/bin/nemcmp`, SHA-256
  `7563a1522b01a89774dc8909204de433a1f4f87f8a99f6f10311989be2022a27`,
  conferido contra o pin de `docs/rex_corpus_b/RECONCILIACAO.md`. Pin diferente
  ou binário ausente ⇒ oráculo tratado como INDISPONÍVEL ⇒ casos ancorados
  viram **SKIP**, nunca PASS.
- Sandbox próprio com as mesmas garantias do wrapper do integrador
  (`timeout` com kill forçado, `ulimit -v 2 GiB`, `-t 25 s` de CPU, `-f 8192`
  blocos, stdin fechado): wall=60s cpu=25s as=2048MiB fsize=4096KiB
  stdin=devnull, cwd isolado em `data/rex_corpus_b/tmp` (removido no fim;
  `KEEP_TMP=1` preserva).
- Categorias: **(a)** 9 vendored `.nem` decodificados por mim = `.bin` completo
  byte a byte + `bytes_consumed == len(.nem)`; **(b)** mesmo stream via
  `nemcmp -x` no sandbox, paridade byte a byte com a minha saída; **(c)** 19
  casos discriminantes — 10 plains adversariais empacotados **pelo oráculo**
  (runs longos de zero, fronteiras delta, mudança de tabela, padrões
  repetidos, fronteira de domínio 32 B, tiles=256, ruído semeado) + 9 streams
  construídas à mão para forçar caminhos do formato; **(d)** os 7 negativos do
  `negative-spec.json` (21 asserções, todas dentro dos limites, todas
  terminam); **(e)** determinismo — (a) rodado duas vezes.
- Round-trip próprio **sozinho não é prova**: 3 casos c2 são rotulados
  `SELF-ONLY` na saída (`c2_no_terminator`, `c2_len0_record`,
  `c2_zero_tiles`) — o oráculo neles é dado observado (rc=-24 SIGXCPU, rc=0,
  rc=0), não verificador.

Rollup medido nesta rodada (execução limpa, exit 0):

| categoria | verificados | pass | fail | skip |
|---|---|---|---|---|
| pre (integridade fixtures) | 1 | 1 | 0 | 0 |
| a | 9 | 9 | 0 | 0 |
| b | 9 | 9 | 0 | 0 |
| c | 19 | 19 | 0 | 0 |
| d | 21 | 21 | 0 | 0 |
| e | 9 | 9 | 0 | 0 |
| **total** | **68** | **68** | **0** | **0** |

Evidência por caso (tool, commit da referência, sha256 do oráculo, esperado,
meu, equal, rc, first_diff_offset, proveniência `authored-fixture`, limites,
sandbox, `oracle_end_offset`): `data/rex_corpus_b/nemesis/evidence/decode-parity.json`.
Um harness independente anterior (escrito separado do módulo validado) deixou
`decode-parity-independente.json` no mesmo diretório; o ponto de entrada
canônico atual é `nemesis-validate.sh` → `nemesis_validate.py`.

## 6. Divergências e fatos medidos (nada presumido)

- **n05 (truncation plausível)**: oráculo aceita, produz 65536 B e diverge do
  plain a partir do byte **65531** — a rodada 1 registrou 65508; **não
  reproduzido**. O offset **não é pinável**: a cauda vem de leitura além do EOF
  (indefinida). Estável entre execuções desta rodada: o fato da falsa aceitação,
  não o offset. Meu decoder responde `truncated`.
- **n06**: oráculo é morto no sandbox (`rc=-9`/SIGKILL; o spec esperava 137 via
  wrapper com SIGTERM antecessor) — ausências/recusas nunca viram prova; meu
  decoder termina em 0.000 s com erro estruturado.
- **n01/n02**: padding do oráculo medido em 32 e 128 B; produto recusa
  (`input-not-in-domain`).
- **n03**: oráculo aceita entrada vazia com `rc=0` (falsa aceitação registrada;
  a rodada 1 mediu SEGFAULT em outro caminho do binário).
- **n04**: expansão medida 1048544 B; meu decoder para em `excessive-output` /
  `work-limit` / `truncated` conforme o limite, emitindo 0 bytes antes de alocar.

## 7. O que permanece NÃO provado

- Streams reais de ROM (prefixos de alinhamento/pad e extensões que o empacotador
  mdcomp adiciona) — este corpus só cobre streams nuas geradas pelo próprio
  oráculo; a varredura do corpus ROM é etapa posterior.
- Lado de **compressão** (nenhum byte do meu trabalho empacota; toda comparação
  de (c) usa o oráculo como empacotador).
- Profundidade de plano 2B/4B/8B como propriedade do codec (bloqueada — §4).
- O offset exato de divergência em truncations lidas além do EOF (indefinível
  por natureza — §6).
- Semântica gráfica dos plains reconhecidos (tiles 8x8 → sprites): pertence à
  fase seguinte da missão, não a este decoder.

## 8. Arquivos desta fatia

- `scripts/rex_corpus_b/nemesis_research.py` — biblioteca + CLI (`decode --in --out
  [--offset] [--max-out] [--work-limit]`; JSON com codec, variant, offset,
  input_span, bytes_consumed, output_size, output_sha256, error/error_code, limites).
- `scripts/rex_corpus_b/nemesis-validate.sh` + `scripts/rex_corpus_b/nemesis_validate.py`
  — validação reproduzível; saída por caso + rollup.
- `scripts/rex_corpus_b/nemesis-validate.py` — harness independente (fases iniciais).
- `data/rex_corpus_b/nemesis/evidence/decode-parity.json` — 68 registros + rollup +
  variantes + self-only + território/licença.
- `data/rex_corpus_b/vendor/.../nemesis/` — fixtures vendored: 9 pares
  plain/stream + 7 negativos; a categoria `pre` confere **25 arquivos** contra
  o `manifest.tsv` (SHA-256 + tamanho) antes de qualquer caso rodar.
