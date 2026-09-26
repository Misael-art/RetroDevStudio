# Contrato de produto — decoder/encoder aPLib nativo (perfil `aplib`)

Destinatário: integrador (implementação nativa em `rex_codecs.rs`). Este
documento define o que a fixture `data/rex_profiles/codec/aplib/` exige do
produto. O agente B não toca em `rex_codecs.rs`; a verificação é executável
via CLI isolado (`verify-product.sh` neste diretório).

## 1. API mínima (CONTRACTS §4)

```
decode(stream, limits) -> { data, bytes_consumed } | erro estruturado
encode(data, limits)   -> stream | { error, needs_space }
limits = { max_mem, max_work, max_out, cancelled }
```

Sem panic, sem leitura fora do buffer, sem loop sem limite; validar antes de
alocar. Erros: `truncated`, `invalid-reference`, `overflow`,
`excessive-output`, `work-limit`, `cancelled`.

## 2. Formato (fatos calibrados 12/12 contra apultra e APJ; ver docstring de `gen_vectors.py`)

- byte 0 = primeiro literal; próximo byte é a 1ª tag.
- tags: 8 slots MSB→LSB; quando a máscara zera busca-se o PRÓXIMO byte como
  tag nova — inclusive no meio de um token; bytes de dados (literal, off-low,
  cmd do token 110) são intercalados na ordem de consumo.
- gamma2: leitor `v=1`; consome pares (dado, controle): `v=(v<<1)|dado`; para
  no controle 0. **Valor lido mínimo é 2.** Writer: dígitos de `v` sem o `1`
  líder (MSB→LSB), cada um seguido de controle (0 só no último).
- token `10`: `off_hi = gamma2 − LWM`; se `≥ 0`:
  `off = (off_hi<<8)|byte`, `len = gamma2` com `+2` se `off<128` ou
  `off≥32000`, `+1` se `1280≤off<32000`; se `−1`: rep-match, `off = último
  off`, `len = gamma2` **sem ajuste** (impossível como 1º token de match).
- token `110`: byte `cmd`; `0x00` = EOD (fim lógico; decodificador PARA aí);
  senão `off = cmd>>1` (1..127), `len = 2+(cmd&1)`.
- token `111`: 4 bits, o 1º lido pesa `<<3`; `off4=0` escreve `0x00`;
  senão copia 1 byte de `off4` (1..15).
- LWM (`nFollowsLiteral`): 3 após literal/111, 2 após match; inicial 3.
- Saída vazia é inexpressável; entrada de 1 byte não é codificável pelos
  oráculos, mas existe stream decodificável (golden `g01b`).

## 3. Regras de rejeição (derivadas do contrato — NÃO do oráculo)

Os decodificadores de referência (APJ; apultra em parte) **não validam**
entrada: leem além do EOF (UB) e aceitam streams truncados. O produto deve:

| Condição | Erro |
|---|---|
| EOF ao buscar byte de tag ou de dados exigido por token iniciado | `truncated` |
| stream descodifica mas nenhum EOD (`110`+`0x00`) foi visto | `truncated` |
| referência com `off > len(histórico)` em qualquer token de match | `invalid-reference` |
| rep-match (`off_hi=−1`) sem offset histórico prévio | `invalid-reference` |
| acumulação de gamma2 acima de `2^31` | `overflow` (decisão de produto; sem vetor de fixture) |
| `len(data) > max_out` (a qualquer momento, inclusive antes de alocar saída cheia) | `excessive-output` |
| operações > `max_work` | `work-limit` |
| `cancelled` observado entre tokens | `cancelled` |

`bytes_consumed` = posição imediatamente após o byte do cmd EOD (`0x00`),
exatamente — bytes após o EOD pertencem ao bloco vizinho do ROM, nunca ao
stream. Um decoder que "empurra" o consumo até o fim do buffer viola o
contrato ainda que os bytes decodificados estejam certos.

`max_work` sugerido: `2 * len(stream) + max_out` (1 por bit/tag lida no
pior caso + 1 por byte copiado).

## 4. Mapeamento vetor → expectativa

| Vetor | Conteúdo | Exigência do produto |
|---|---|---|
| `plain/*.apultra.ap`, `plain/*.apj.ap` | streams reais dos oráculos (cross-verified) | `decode == plain` do manifest, `bytes_consumed == len(stream)` |
| `golden/g01..g07` | streams montados à mão pela especificação, GOLDEN-CONFIRMED por AMBOS os oráculos | idem |
| `golden/g08_eod_trailing` | EOD válido + 5 bytes de lixo após | `decode == plain`, `bytes_consumed == 6` (NÃO 11) |
| `negative/n01..n07` | condições malformadas construídas, auto-verificadas pelo espelho Python | erro == `expected_error` do `.expected.json`; para `n05`, decodificar com `max_out` do JSON |

Negativos nunca foram nem serão executados nos oráculos; a expectativa é do
contrato. Rótulo: `negative-spec`.

## 5. Aceitação (ordem de evidência)

1. `verify-product.sh` verde contra os itens 1–4 acima (fixture versionada,
   hash agregado no manifest/evidence).
2. Paridade de recompressão: `decode(ref, encode(produto, dados)) == dados`
   para todos os `plain/*.bin` (apultra e APJ como decoders).
3. `decode(produto, encode(ref, dados)) == dados` já coberto pelo item 1.
4. Estados do perfil: `vetores-verificados` → `decoder-nativo-testado` →
   somente pelo integrador, nunca antes do item 1 verde.

## 6. Limitações de prova declaradas

- Não há vetor com `work-limit`/`cancelled`/`overflow` de fixture: são
  decisões de política do produto, sem comportamento observável nos oráculos.
- Cross-oracle (apultra↔APJ) prova os ORÁCULOS entre si, não o produto.
- O espelho Python (`mirror_decode` em `gen_vectors.py`) é calibrado contra
  os oráculos nos 8 plains CROSS-OK; é auto-verificação da fixture, não
  segunda implementação independente.
