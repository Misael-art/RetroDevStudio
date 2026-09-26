# Benchmark de recompressão LZ4W — especificação congelada

Objetivo: medir a **capacidade real do codificador** de deixar recursos
comprimidos editáveis **sem expansão de ROM**. A pergunta operacional é:
para um recurso cujo slot original tem `S` bytes, o re-encode do *plain*
(editado ou não) cabe em `S`?

Este arquivo é a definição. Ele foi escrito **antes** de qualquer medição
do incremental, e qualquer mudança de conjunto, divisão ou edições exige uma
nova rodada com este arquivo versionado em commit separado.

## 1. Conjuntos

| ID | Conteúdo | Propriedade |
|---|---|---|
| `S-A` | fixture autoral (`scripts/rex_profiles/integrator/lz4w_fixture/`), 1 recurso LZ4W @`0x5f988`, plain 512 B, slot 444 B, SHA da ROM `159298eb…` | consumo conhecido **por construção**; é o único conjunto com efeito visual provado |
| `S-B` | streams LZ4W **reais** da ROM BYOR congelada (`sha256 558bea6c…`), definidas pela regra: todos os recursos retornados por `verify_lz4w_resource_set` (160 de 191 candidatos nesta ROM), ordenados por `stream_offset` | identificação estrutural **assistida**; bytes nunca vão para o git |

Nenhum outro recurso entra. Recursos recusados pelo conjunto (31 candidatos
não verificados) ficam registrados como recusa do *conjunto*, não do codificador.

## 2. Divisão tuning / validação (congelada aqui)

Índices 0-based sobre `S-B` ordenado por `stream_offset`:

- **validação**: `idx % 5 == 0` (20% do conjunto).
- **ajuste**: os demais (80%).

A divisão é uma função do deslocamento do recurso, não do resultado da
medição. **Nenhum parâmetro de codificador é escolhido olhando o conjunto de
validação**; ele é medido uma vez por incremento e publicado mesmo quando
piora. `S-A` não participa da divisão (é o caso de referência conhecido).

## 3. Edições pré-definidas (antes de ver qualquer resultado)

Para cada recurso, quatro edições de **um bit em uma word** — o mínimo que o
LZ4W pode alterar, já que o formato casa words de 16 bits. A operação é
**OR** (`|=`), não XOR, de propósito: se o bit já vale 1 a edição não muda o
plain, e esse caso existe para exercitar a classificação do §5.

| ID | Definição (independente do codificador) |
|---|---|
| `E1` | byte 1 da word `0` `\|= 0x01` |
| `E2` | byte 1 da word `floor(n/3)` `\|= 0x01` |
| `E3` | byte 1 da word `floor(2n/3)` `\|= 0x01` |
| `E4` | byte 1 da word `n-1` `\|= 0x01` |

onde `n = plain_len / 2` e o byte 1 de uma word big-endian é o seu byte baixo
(a palavra de um tile 4bpp chunky carrega dois pixels; `| 0x01` muda o índice
de um único pixel). As posições são função apenas do tamanho do plain,
portanto escolhe-las não requer olhar o compressor nem o resultado.

Para `S-A` acrescenta-se `E0`, a edição histórica já canônica:
tile 0, linha 5, coluna 7 → índice 15 (o plantio near-miss do fixture).

Se uma edição não mudar o plain (bit já valia o alvo), o recurso registra
`noop_preservando_stream` na coluna própria (§5) e **não** conta como sucesso.

## 4. Colunas por recurso

| Coluna | Definição |
|---|---|
| `recurso` | `stream_offset` (hex) e `num_tiles` |
| `conjunto` | `S-A` / `S-B` / `ajuste` / `validação` |
| `plain_len` | bytes decodificados (`numTile * 32`) |
| `slot` | `bytes_consumed` do stream empacotado na ROM (espaço disponível real, incluindo o terminador) |
| `reencode_base` | tamanho do re-encode do plain **não editado** pelo codificador atual, com dicionário = prefixo da ROM antes do stream |
| `folga_base` | `slot - reencode_base` (negativo = o codificador não reproduce o espaço original) |
| `dep_usa_rom_source` | o stream original referencia o prefixo (flag ROM source)? |
| `dep_alcance` | limite superior de dependentes, calculado por endereçamento: quantos outros recursos verificados têm dicionário cuja janela (`0x4000` words a partir do próprio stream) alcança o intervalo `[start, start+slot)` de `S`, mais os com intervalo sobreposto. **Não é veredito**: a autoridade continua sendo `reinsert_transaction`, que re-decodeia o conjunto |
| `ed_<E>_len` | tamanho do re-encode com a edição aplicada |
| `ed_<E>_resultado` | `cabe` / `needs_space` / `noop_preservando_stream` / `recusa:<código>` |
| `ed_<E>_motivo` | texto da recusa quando houver (`excessive_output`, `overflow`, `invalid_reference`, …) |
| `tempo_ms` | tempo de codificação do recurso (orçamento: ver §6) |

## 5. O que NÃO conta como sucesso do codificador

- **No-op que preserva o stream original**: a transação pode devolver o
  stream existente byte a byte quando a edição não altera o plain. Isso é
  otimização legítima do produto e fica em coluna própria
  (`noop_preservando_stream`), mas **não** entra em nenhuma contagem de
  "recursos editáveis".
- Re-encode que "cabe" só porque o dicionário foi maior que o permitido.
- Recursos do conjunto de validação usados para escolher parâmetro.
- Qualquer ganho obtido rompendo o decodificador, o teto do formato ou o
  desempacotador 68000.

## 6. Invariantes que todo incremento deve preservar

1. Limites do formato: offset longo não-ROM ≤ **16385** words (teto medido no
   hardware; o codificador usa janela `0x4000` por estratégia), `len` longo ≥ 3
   words, literais ≤ 15 words por token, terminador + word final ímpar.
2. O decodificador Rust (`rex_codecs.rs`) aceita todo stream emitido e o
   reproduz byte a byte (roundtrip intra-transação continua obrigatório).
3. Equivalência com o desempacotador **68000 oficial** para os casos de
   fronteira do pacote `lz4w_68k` (runI/runC/runE/run14/run15/run16, e
   runF com o fixture).
4. Tempo e memória: codificar um recurso do `S-B` não pode exceder **2 s** e a
   varredura completa do conjunto deve terminar em **< 120 s**; estouro é
   publicado como perda, não escondido.
5. Proteção de dependentes: nenhum outro recurso verificado pode mudar de
   decode.
6. Quando a edição não cabe, a resposta continua sendo recusa honesta
   (`needs_space`/`excessive_output`), nunca expansão de ROM, realocação de
   ponteiros nem sobrescrita de padding.

## 7. Métricas agregadas (publicadas por incremento)

- `editáveis_ajuste` / `editáveis_validacao`: nº de recursos com ≥ 1 edição
  que cabe, separados pela divisão do §2.
- `folga_total`: soma de `folga_base` (bytes disponíveis antes de qualquer
  edição).
- Distribuição de motivos de recusa.
- **Antes/depois com perdas e empates**: toda linha que piorou é listada
  integralmente, inclusive quando o agregado melhora.

## 8. Procedência e política BYOR

`S-B` roda só com a ROM em posse local (aceite `#[ignore]`, ausência **falha**
no comando de aceite). O repositório publica deslocamentos, tamanhos,
contagens e hashes — **nunca** bytes derivados da ROM comercial. Dumps de
`stream`/`plain`/`dict` para análise de tokens são escritos **somente** para
`S-A` (autoral, reconstruível pela receita pinada). O pacote de evidência fica
em `data/rex_profiles/integrator/lz4w-recompress/evidence/<rodada>/`.

Exceção aberta em 2026-09-26 pelo §9: `RDS_REX_BENCH_DUMP_DIR` permite dumps de
material de **todos** os recursos, mas o próprio teste recusa um caminho dentro
do repositório (asserção, não recomendação) e nada desses bytes é versionado — o
que se versiona é o SHA-256 de cada arquivo, para que o material descartável
continue auditável.

## 9. Emenda 2026-09-26: instrumento de piso (fora do `bench.json`)

Os §1–§8 continuam congelados: conjunto, divisão tuning/validação e edições
pré-definidas não mudaram, e nenhuma coluna do `bench.json` foi tocada. Esta
emenda acrescenta um **instrumento auxiliar** que consome os dumps e responde
uma pergunta que o benchmark não responde: *quanto do déficit atual é qualidade
de parsing e não falta de espaço*.

- Definição. **Piso** de um recurso = o menor stream LZ4W que reproduz aquele
  plain, sob o custo explícito do formato (1 word de descritor + 1 word por
  literal + 1 word de offset para match longo + terminador de 2 words), dentro
  da janela do codificador (`0x4000` words) e da convenção de offset do produto
  (espaço dicionário+saída, sem o bit `0x8000`). Resolvido por DP sobre o grafo
  `(posição, literais pendentes 0..14)` em
  `scripts/rex_profiles/integrator/lz4w_recompress/dp_floor.py`.
- Por que o estado "literais pendentes" existe: um token carrega no máximo 15
  literais, então a pendência muda o custo do futuro. Omiti-la dá resposta
  errada — foi o bug do DP portado de `LZ4W.java`, que piorou o produto
  (382 B contra 380 B) e foi revertido.
- Por que matches **não maximais** entram: restringir-se ao comprimento máximo
  por fonte falhou na 26.ª entrada do selftest (`plain=[2,2,1,2,1,0,2,1,1,1,1,2]`,
  `dict=[2]`: 10 words contra 9 da busca exaustiva). Cortar um match mais cedo
  muda a posição seguinte, e ali o próximo token pode gastar menos.
- Uso da palavra "ótimo": só vale porque `dp_floor.py --selftest` compara a DP
  com **busca exaustiva** em 1 165 entradas pequenas, em cinco configurações que
  cobrem caminhos distintos (match longo, offsets além de `0x100`, flush de 15
  literais, recorte de janela, tetos de 16 e 257 words). Sem essa comparação o
  número seria uma heurística com nome de piso.
- Barreiras por recurso: o stream reconstruído (i) decodifica de volta ao plain
  pelo tokenizador independente `tokens.py`, (ii) é consumido inteiro, (iii) tem
  exatamente o comprimento que o modelo anuncia, e (iv) é decodificado pelo
  **decoder do produto** no teste ignorado
  `piso_streams_do_dp_decodificam_pelo_decoder_do_produto`.
- O que o piso **não** afirma: nada sobre editabilidade (é medido no plain sem
  edição — cabe no slot é condição necessária, não sucesso do §5), nada sobre o
  desempacotador 68000 (a replay nos streams de piso é obrigação de quem
  integrar, não desta medição), e nada fora da janela/modelo acima.
- Receita (rodada `2026-09-26-r5-floor-dump`):

  ```bash
  D=/tmp/rex-lz4w-floor-dumps-$(date +%Y-%m-%d)           # FORA do repositório
  E=$PWD/data/rex_profiles/integrator/lz4w-recompress/evidence/<rodada>
  RDS_REX_BENCH_OUT=$E RDS_REX_BENCH_DUMP_DIR=$D \
  RDS_REX_LZ4W_FIXTURE_ROM=<rom do fixture 159298eb…> \
    cargo test --manifest-path src-tauri/Cargo.toml --lib lz4w_recompression_benchmark \
    -- --ignored --nocapture                                   # > bench-com-dumps.log
  python3 scripts/rex_profiles/integrator/lz4w_recompress/floor_sweep.py $D \
    --escrever-streams --jsonl $E/floor-sweep.jsonl             # > floor-sweep.log
  RDS_REX_BENCH_DUMP_DIR=$D cargo test --manifest-path src-tauri/Cargo.toml --lib \
    piso_streams_do_dp_decodificam -- --ignored --nocapture
  ```
