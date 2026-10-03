# Contrato v1 — decodificador Kosinski (`crates/rex-kosinski`)

**Status:** Contrato FIXADO antes de qualquer linha de produção (regra da missão).
**Propriedade:** frente B (ferramenta REX). Não integra o produto; entrega-se
como pacote Rust autônomo pronto para adaptação pelo integrador.
**Base:** branch `codex/rex-kosinski-decoder` @ worktree
`REX-KOSINSKI-DECODER-2026-09-27`, registrado sobre `9b2389d27c4945c2e13d4344d0ad4e341c784861`
(`codex/rex-b-codecs`, PR #79 — nada mesclado).

## 0. Escopo (positivo e negativo)

- **Cobre:** decode da variante **Kosinski base, não-modular** (mdcomp
  `src/lib/kosinski.cc`, commit pinado `72c6df405a75d322c5b3722da46c3abb864d3793`,
  LGPL-3.0, **somente ferramenta externa; nenhum código transplantado**).
- **Não cobre (explícito):** encoder, modo modular (`-m`), autodescoberta de
  streams em ROM, reinserção, UI, Nemesis, Enigma, paridade com segundo
  descodificador 68k (continua `blocked`), suporte a jogo específico.

## 1. Enquadramento e leitura de bits

- A stream começa **diretamente na primeira palavra de descritor**; não há
  cabeçalho, magic nem comprimento declarado.
- **Descritor = palavra de 16 bits em 2 bytes little-endian**, consumida
  **LSB→MSB** (bit0 do byte par primeiro, depois bit1 … bit7, depois byte ímpar
  LSB→MSB). NÃO é tag de 8 bits MSB→LSB.
- **EARLY FETCH:** assim que o 16º bit da palavra corrente é consumido, a
  **próxima** palavra de descritor (2 bytes) é lida **imediatamente**, antes de
  qualquer byte de dados do token em andamento. Consequência medida (goldens
  `m09`/`m10`, confirmados pelo oráculo): um token cujo último bit de
  descritor é o 16º tem seus bytes de dados **após** o placeholder da palavra
  nova; um leitor "late fetch" desloca toda a stream e falha.
- Bytes de dados (literais, Low/High/c, byte de distância inline) são
  consumidos sequencialmente **no ponto de uso**, após o fetch antecipado.

## 2. Gramática de tokens (ordem de decisão por bit)

Cada token começa lendo 1 bit do descritor:

| Bits | Token | Campos de dados | Semântica |
|---|---|---|---|
| `1` | literal | 1 byte | copia byte para saída |
| `0`,`1` | separado | Low, High (2 bytes) | `Count3 = High & 7`; se `Count3 ≠ 0` → `len = Count3 + 2` (2..9); se `Count3 == 0` → lê 3º byte `c`: `c == 0` → **TERMINADOR** (para imediatamente; nada após é lido); `c == 1` → **continue** (quirk: consome o byte, não copia nada, próximo token); `c ≥ 2` → `len = c + 1` (3..256). Distância: `dist = 0x2000 − (((High & 0xF8) << 5) | Low)` (1..8192) |
| `0`,`0` | inline | +2 bits `h`,`l`; 1 byte `d` | `len = ((h<<1)|l) + 2` (2..5); `dist = 0x100 − d` (byte `0` → 256) |

- `dist` é sempre ≥ 1 por construção aritmética; não existe distância 0.
- **Cópia byte a byte com eco/sobreposição** (LZSS clássico): `out[i] =
  out[src + k]` com `src = len(out) − dist`, avançando a saída durante a cópia.
  `dist == histórico` (cópia iniciando no byte 0) é válida (golden `m07`).
- O terminador encerra **com sucesso**: `bytes_consumed = posição imediatamente
  após o byte `c == 0``. Bits restantes do descritor são descartados.

## 3. `bytes_consumed`, padding e política de trailing

- FATO MEDIDO no oráculo: `koscmp -c` emite **1 byte de padding após o
  terminator** (padrão `… 00 F0 00 00` observado nas 12 streams reais).
- Contrato do produto: **`bytes_consumed ≤ input.len()`**, nunca
  `== input.len()` como obrigação. Trailing bytes (padding ou dados seguintes)
  são **legalmente ignorados**; o chamador que precisar de emolduramento
  exato compara `bytes_consumed == input.len()` por conta própria (modo
  "exact-input" é política do chamador, não do decoder).
- Nada após o terminator é lido, validado ou contabilizado.

## 4. Divergências deliberadas vs oráculo (defeito da referência, não regra)

O oráculo **não valida nada**. O produto **não herda** esses comportamentos:

| Entrada | Oráculo (medido) | Produto (contrato v1) |
|---|---|---|
| stream sem terminator (ex.: golden `m02`, k01) | aceita por exaustão (`while (in.good())`) | `Err(Truncated)` |
| `dist` > histórico escrito | `seekg` inválido, resultado não-determinístico (sonda: rc=0, saída 0 bytes) | `Err(InvalidReference)` |
| stream truncada 1 byte antes do EOD (`m05`−1B) | aceita, saída maior que esperada (8692 vs 8451) | `Err(Truncated)` |
| saída acima de `max_output` | sem limite | `Err(ExcessiveOutput)` |

Fixtures esperadas são **independentes**: ouro = bytes `.expected.bin` do
perfil (confirmados pelo oráculo externo), nunca gerados pelo próprio decoder.

## 5. Limites e erros estruturados

API sem Tauri, sem dependências externas, sem pânico em input arbitrário:

```rust
pub enum KosError {
    Truncated,        // EOF no meio de descritor/token, ou fluxo exaurido sem terminator
    InvalidReference, // dist > histórico já escrito (ou fora dos intervalos do formato)
    ExcessiveOutput,  // saída excederia max_output
    WorkLimit,        // orçamento determinístico de trabalho esgotado
    EmptyInput,       // entrada com 0 bytes (caso degenerado de Truncated, mantido distinto por contrato)
}
pub struct KosDecoded { pub output: Vec<u8>, pub bytes_consumed: usize }
pub fn decode(input: &[u8], max_output: usize, work_limit: usize) -> Result<KosDecoded, KosError>
```

- `max_output` **requerido**: dimensiona e limita toda alocação (nenhuma
  alocação descontrolada a partir de comprimentos declarados — Kosinski base
  não declara comprimento; o limite é sempre do chamador).
- `work_limit` **determinístico** e obrigatório: budget em "operações" —
  consome 1 unidade por bit de descritor consumido, 1 por byte de input lido e
  1 por byte escrito. Timeouts externos **não substituem** este limite.
- Aritmética com `checked_*` antes de indexar/alocar; `Vec` cresce apenas até
  `max_output`; nenhum índice sem validação prévia; o decodificador **não lê
  filesystem** nem depende de clock/aleatoriedade.
- Sem sucesso parcial em erro: `Err` não devolve bytes.

## 6. Casos-limite fixados (antes dos testes)

| Caso | Comportamento v1 |
|---|---|
| input vazio (`[]`) | `Err(EmptyInput)` (o oráculo produziria saída vazia aceitando; contrato exige terminator, mas entrada 0 não tem descritor — erro estruturado distinto de Truncated para diagnóstico) |
| input de 1 byte (`[xx]`) | `Err(Truncated)` — descritor exige 2 bytes |
| EOF no meio de um descritor antecipado | `Err(Truncated)` |
| EOF após `0,1` antes de Low/High (k02) | `Err(Truncated)` |
| EOF após literal sem terminator (k01, m02) | `Err(Truncated)` |
| terminator `00 F0 00` seguido de padding | `Ok`, `bytes_consumed` para no `c==0`, padding não consumido |
| `continue` (`c==1`) | aceito, sem cópia (golden m06) — é quirk do formato, não defeito |
| `dist` antes do 1º byte escrito (k03, sonda `02 00 FF FF`) | `Err(InvalidReference)` |
| inline `dist=256` com 1 byte de histórico (k04) | `Err(InvalidReference)` |
| stream bem-formada com saída > `max_output` (k05, 512 > 16) | `Err(ExcessiveOutput)` |
| cópia sobreposta (`dist < len`, eco) | copiada byte a byte com eco (formato) |
| work_limit mínimo sobre stream válida | `Err(WorkLimit)` sem pânico; valor de limite é função determinística do input |

## 7. Fatos verificados nesta sessão (medidos, não lembrados)

- Fixtures do perfil presentes em `data/rex_profiles/codec/kosinski/` com
  SHA-256 conferidos contra `manifest.tsv`: `m09` `da295741…`, `m10`
  `7a04a5db…`, `m02` `07d9b4ef…`, `k01` `462fd236…`, `k05` `160ac892…`,
  `zeros_64k.kos` `e887c360…`; agregado da evidência `ea866df7…` registrado em
  `evidence/vectors-pinned-by-oracle-and-mirror.json`.
- 12 plains `RT-OK+MIRROR`, 10 goldens `GOLDEN-CONFIRMED`, 5 negativos
  `NEGATIVE-SPEC` (truncated×2, invalid-reference×2, excessive-output×1).
- Espelho `kos_mirror.py` possui modo `strict=True` = contrato do produto
  (terminator obrigatório, histórico validado), calibrado 12/12 contra as
  streams reais do oráculo.
- Exceção registrada: `m02_single_with_eod` é literal único **SEM** terminator
  (nome histórico preservado) — aceito pelo oráculo por exaustão; sob este
  contrato seria `Truncated`. Por isso **não** integra os negativos.
- Oráculo pinado: checkout mdcomp em `72c6df40…` (verificado `git rev-parse`
  no cache); binário `koscmp` SHA-256 `a74c92957eccf9c1e5143167af9d6d98b2ce087aed8fe10d50b1f9c016373ea3`.
- BYOR: **nenhuma stream Kosinski real de ROM foi medida nesta base** →
  capacidade `resource-identification-in-rom` permanece `blocked`; a entrega
  registra "não medido", sem inventar offsets.
