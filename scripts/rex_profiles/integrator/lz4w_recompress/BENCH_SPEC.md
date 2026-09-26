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
