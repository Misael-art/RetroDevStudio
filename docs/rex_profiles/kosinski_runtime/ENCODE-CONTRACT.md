# Contrato v1 — codificador Kosinski (`crates/rex-kosinski`, módulo `encode`)

**Status:** contrato FIXADO antes de qualquer linha de produção do encoder
(mesma regra do contrato do decoder). Complementa — não substitui — o
`CONTRACT.md` v1 do decodificador (SHA `30629659…`), que passa a ser a
gramática de referência das duas direções. A linha "Não cobre: encoder" do
`CONTRACT.md` continua verdadeira para *aquele* documento; o escopo do
encoder vive aqui.

**Propriedade:** frente B. Pacote Rust autônomo; nada do produto (IPC, UI,
`rex_resources.rs`, manifests compartilhados, harness E2E) é tocado. A
integração com a transação canônica de edição pertence ao integrador
(§10).

**Procedência:** escrito do zero a partir da gramática do `CONTRACT.md` e dos
12 plains/streams `koscmp` publicados no perfil (layout medido, §3). **Nenhum
código de referência externa foi copiado ou transplantado**; `koscmp`
(LGPL-3.0) continua somente ferramenta externa de comparação.

## 0. Escopo (positivo e negativo)

- **Cobre:** encode da variante **Kosinski base, não-modular** — a mesma que o
  decoder do pacote aceita; determinístico, com limites exigidos pelo
  chamador; e o ciclo de contrato plain→stream→decode (com o contêiner de
  edição da §9 como **prova de contrato demonstrativa**, não transação de
  produção).
- **Não cobre (explícito, sem promessa):** compressão ótima (ver §5), modo
  modular, autodescoberta de streams em ROM, realocação/busca de espaço
  livre/ajuste de ponteiros, novo formato de patch (o produto já tem BPS
  canônico), suporte a Sonic ou a qualquer jogo, ROM comercial, outros
  variantes Kosinski.

## 1. Tokens que o encoder pode emitir (espelho exato do `CONTRACT.md` §2)

| Token | Bits (LSB→MSB no descritor) | Bytes de dados | Uso |
|---|---|---|---|
| literal | `1` | 1 byte | sempre |
| separado `count3` | `0`,`1` | Low, High (`High&7 ∈ 1..7` → `len=count3+2` = 3..9) | `len 3..9`, `dist 1..0x2000` |
| separado `c` | `0`,`1` | Low, High (`High&7==0`), `c` (`c≥2` → `len=c+1` = 3..256) | `len 10..256` (ou 3..9 se contar for mais simples — §5 fixa a escolha) |
| inline | `0`,`0`,h,l | 1 byte `d` (`len=((h<<1)\|l)+2` = 2..5; `dist=0x100−d`) | `len 3..5` e `dist ≤ 256` (§5) |
| **terminador** | `0`,`1` | `Low=0x00`, `High=0xF0`, `c=0x00` | exatamente uma vez, no fim; nada depois (§3) |
| continue (`c==1`) | — | — | **NUNCA emitido** (quirk de leitura; o decoder aceita, o encoder não produz) |

Aritmética inversa (inteira, verificada com `checked_*`):
`X = 0x2000 − dist ∈ [0, 0x1FFF]`; `Low = X & 0xFF`;
`High = ((X >> 8) << 3) | count3`; inline: `d = 0x100 − dist ∈ [0,0xFF]`.
`dist == 0x2000` (caso extremo) e todo `dist ∈ 1..0x2000` são representáveis.

## 2. Fronteira de capacidade do formato × escolha de estratégia

Distinctos e não misturáveis (exigência da missão):

| Constante | Valor | Natureza |
|---|---|---|
| `FORMAT_MAX_DIST` | `0x2000` (8192) | capacidade do formato (separado) |
| `FORMAT_INLINE_MAX_DIST` | `0x100` (256) | capacidade do formato (inline) |
| `FORMAT_MAX_LEN` | `256` (byte `c=0xFF`) | capacidade do formato |
| `FORMAT_MIN_SEP_LEN` | `3` | capacidade (não existe separado de 2 bytes; `c=1` é continue) |
| `STRATEGY_WINDOW` | `= FORMAT_MAX_DIST` | escolha (aqui coincide; declarada separada) |
| `STRATEGY_CHAIN_LIMIT` | `64` candidatos por hash | estratégia de busca — custo, não capacidade |
| `STRATEGY_MIN_REF_LEN` | `3` | estratégia (inline de 2 existe no formato, não é usado) |

## 3. Enquadramento, early-fetch e terminador (lado do emissor)

- Stream começa na **primeira palavra de descritor** (2 bytes LE), sem
  cabeçalho nem comprimento declarado.
- **EARLY FETCH espelhado:** quando o 16.º bit de um descritor é emitido e o
  token em curso **ainda precisa de bits** (token atravessa a fronteira, caso
  m10) **ou existe token posterior**, a palavra do **próximo** descritor é
  escrita **imediatamente após a palavra corrente**, ANTES dos bytes de dados
  do token em curso; os bits do token atravessado continuam no novo
  descritor (bit0 primeiro). Se o token que completa no 16.º bit é o
  terminador, nada mais é escrito além dos seus bytes `00 F0 00`.
- **Terminador sempre nos últimos 3 bytes da stream, sem padding**
  (política emissor: `00 F0 00` final; o `CONTRACT.md` §3 registra padding
  `00`/`5a` opcional do oráculo — o produto não o emite nem o exige).
  Consequência verificável: **`decode(encode(p)).bytes_consumed ==
  encode(p).len()`** (propriedade testada, §7).
- Descritor parcial no fim: bits não usados só existem após o terminador —
  inexistente por construção (terminador é o último token).

Fato medido âncora (2026-09-27): os 12 plains publicados terminam
`00 F0 00` + opcional 1 byte; `empty.kos` = `02 00 00 F0 00 00`
(descritor `0x0002` + terminador + padding) — a stream mínima deste contrato
é o mesmo sem o padding: 5 bytes.

## 4. Domínio de entrada e limites da API

```rust
pub enum EncError {
    StreamLimit, // saida excederia max_stream (verificado no ponto de uso, byte a byte)
    WorkLimit,   // orcamento deterministico de trabalho esgotado
}
pub struct KosEncoded { pub stream: Vec<u8>, pub plain_len: usize }
pub fn encode(plain: &[u8], max_stream: usize, work_limit: usize)
    -> Result<KosEncoded, EncError>;
```

- `plain`: qualquer byte string, **incluindo vazia** (vazia → stream de 5
  bytes do §3; `Err(EmptyInput)` do decoder não se aplica — é sobre stream
  vazia, não sobre plain vazio).
- `max_stream` requerido: teto absoluto; **nenhuma expansão silenciosa** — o
  corte ocorre antes de cada escrita (mesma disciplina de `push()` do
  decoder). Sem sucesso parcial: `Err` não devolve stream.
- `work_limit` requerido e determinístico: **1 por byte de plain consumido na
  produção de tokens, 1 por byte de stream escrito, 1 por bit de descritor
  emitido, 1 por candidato de match examinado**. Função fixa do input e da
  estratégia; timeouts externos não o substituem.
- Aritmética toda `checked_*`; nenhum índice sem validação; sem pânico em
  input arbitrário; o encoder **não lê filesystem**, sem clock/aleatoriedade.

## 5. Estratégia (simples, correta, determinística — NÃO ótima)

Passada sequencial sobre `plain`, posição a posição:

1. **Match:** busca o maior comprimento `3..=256` em janela
   `min(pos, FORMAT_MAX_DIST)`, por cadeia de hash de prefixo de 3 bytes,
   mais recente primeiro, máx. `STRATEGY_CHAIN_LIMIT` candidatos;
   comparação permite **eco sobreposto** (`plain[src + (i % dist)]`,
   `len > dist` válido); candidatas com `len` maior que o resto da entrada
   são limitadas ao resto. Empate de comprimento → menor distância.
2. **Decisão:** sem match ≥ 3 → **literal**. Com match:
   `len ∈ 3..=5 && dist ≤ 256` → **inline**; `len 3..=9` → **separado
   count3**; `len 10..=256` → **separado c**; run > 256 → dividir em
   referências consecutivas de 256 com a mesma `dist` (eco mantém
   validez: histórico ≥ dist sempre).
3. Run de literais não é reembalado retroativamente (simplificação aceita).
- **Garantia mínima (exigência da missão):** dados com repetição ≥ 3 emitem
  referências reais — provado em teste por asserção estrutural (stream de
  `text_rep`/`zeros_64k`-like contém tokens `0,1`/`0,0`), não apenas por
  tamanho.
- Tamanho **não** é prometido menor que o oráculo; a tabela de §8 mede.

## 6. Determinismo

Mesmo `plain` + mesmos limites ⇒ bytes idênticos em qualquer execução/
plataforma (inteiros puros, ordem fixa, sem HashMap não ordenada — a cadeia
de hash é indexada por posição; desempates definidos na §5). Provado por
dupla codificação com SHA-256 em teste.

## 7. Propriedades de paridade (o que os testes afirmam)

- **P1 round-trip interno:** `decode(encode(p, u32::MAX-ish, w), m, w2)`
  produz `p` e `bytes_consumed == stream.len()` (relação tamanho↔consumo).
- **P2 paridade externa direção B:** para todo plain do corpus e casos
  gerados, `koscmp -x` sobre o stream do produto reproduz o plain **byte a
  byte, conteúdo integral** (não só rc/tamanho).
- **P3 direção A (herdada, preservada):** streams do encoder de referência
  (12 published + 19 goldens) continuam decodificando pelo produto —
  inalteradas; m09/m10 e a conclusão "**m10 sozinho não discrimina
  early-fetch**" permanecem registradas.
- **P4 corruptos (controles, NÃO paridade):** (a) stream do produto com 1
  byte trocado determinísticamente → oráculo produz **conteúdo diferente**
  (divergência detectada pela comparação, linha própria no TSV); (b)
  corrupto que viola estrutura → produto recusa com erro estruturado. As
  sondas de defeito do oráculo continuam fora da contagem de paridade.

## 8. Entrega, evidência e tabela

- Suíte Rust própria (`tests/encode.rs`, `tests/edit.rs`) roda **sem**
  oráculo; o modo diferencial (script `differential-vs-koscmp.sh`, estendido)
  é o complemento externo com sandbox/timeout/ulimit e pin
  `a74c9295…`/commit `72c6df40…`.
- Tabela de tamanhos produto × oráculo por plain do corpus (12), com coluna
  de razão — publicada no REPORT; casos onde a estratégia não cabe no slot
  (§9) são listados como limitação, sem esconder.

## 9. Contêiner de edição autoral (prova de contrato, não transação)

Formato demonstrativo documentado (arquivo novo `data/rex_profiles/
kosinski_runtime/edit/` + módulo `edit.rs` puro sobre slices, sem FS):

```
[ sentinela A: 8 B "REXKOS0A" ]
[ plain_len u32 LE ][ stream_len u32 LE ][ slot_cap u32 LE ]
[ sha256(plain original): 32 B ]
[ slot: stream_len bytes de stream + padding 0x00 até slot_cap ]
[ sentinela B: 8 B "REXKOS0B" ]
```

Política (explícita, testada):
1. **no-op** (mesmo plain): re-encode determinístico ⇒ contêiner byte-idêntico;
2. **edição delimitada**: plain alterado só na região autorizada → re-encode →
   decode externo confirma o conteúdo editado;
3. **só o slot e `stream_len` podem mudar**; sentinelas e cabeçalho fora de
   `stream_len` preservados byte a byte (asserção);
4. stream menor → **padding `0x00` explícito até `slot_cap`** (política única,
   sem realocação nem ponteiros);
5. stream maior que `slot_cap` → **recusa sem escrita** (`Err`; contêiner
   permanece byte-idêntico);
6. identidade divergente (sentinela/`plain_len`/SHA do plain declarados vs.
   conteúdo) → recusa no consumidor demonstrativo (`examples/edit_cycle.rs`).

## 10. Integração (para o integrador, não entregue aqui)

- API final proposta: `rex_kosinski::{decode, encode, KosError, EncError,
  KosDecoded, KosEncoded, edit::*}` — mesma forma de limites explícitos do
  contrato do decoder; adaptação ao contrato de codecs/`rex_resources.rs` e à
  transação BPS/IPS existente é trabalho do integrador; este pacote fornece
  exemplo executável e tabela, não posse dos arquivos compartilhados.
