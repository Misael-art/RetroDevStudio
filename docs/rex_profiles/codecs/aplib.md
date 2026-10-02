# Perfil: aPLib (variante raw, sem header) — fases 1–2 concluídas

Status: **Experimental — referência fixada e vetores confirmados por dois
oráculos independentes; implementação de produto ainda não começada**
(aguarda contrato congelado do integrador).

## Referência fixada (oráculos externos, nada transplantado)

| Papel | Artefato | Pin | Licença |
|---|---|---|---|
| encoder/decoder de referência independente | apultra v1.4.8 CLI | commit `8f340057d7402c10da3d9c76c599f9ab83b8a22d` (2023-05-16) | Zlib (+CC0 no matchfinder) |
| encoder que o SGDK usa em build | `apj.jar` (APJ v1.32, SGDK release v2.11) | SHA-256 `2d8cdc63cc800e4b86ff4d9cdfe514001b77f788abcd02d61974dc319d026204`, dentro de `sgdk211.7z` `5cc704b7…` | MIT (SGDK) |
| decoder alvo no hardware | `aplib_decrunch` (MML/hitchhikr/r57shell via SGDK) | SGDK git `2eac605a7744a6eb4f61824bb24ccab39b8bd8b8` `src/tools_a.s:129` | MIT (SGDK) |

Declaração de independência: apultra é implementação nativa independente do
formato; APJ é a ferramenta do ecossistema SGDK (mesmo formato, código
diferente). O decoder do produto será implementação nativa Rust nova; NÃO
existirão dois nomes para a mesma função como oráculos.

## Variante fixada

Stream aPLib **raw** (sem header "AP\0"/genheader): primeiro byte é o primeiro
literal; tokens no fluxo de bits **MSB→LSB** por byte de tag; bytes de dados
são intercalados na posição em que o leitor os consome; fim por token `110` +
byte `0x00` (bytes após o EOD são ignorados pela referência).
`apultra -c`/`-d` e `apj p/u` operam neste mesmo formato cru — paridade
cruzada observada byte a byte nos 8 plains do conjunto de vetores.

## Especificação do formato (calibrada 2026-09-24 contra streams reais)

Autoridade: `expand.c`/`compress.c` do apultra + `src/tools_a.s` do SGDK +
streams reais dos dois oráculos. Estado: `offset_history` inicialmente
INVÁLIDO; `nFollowsLiteral` (LWM) inicia 3, =3 após literal/`111`, =2 após
match (`10`/`rep`/`110`).

1. Byte 0 do stream: literal escrito direto.
2. Loop: bit de tag lido MSB→LSB; um NOVO byte de tag é buscado na posição
   corrente SOMENTE quando a máscara zera — inclusive no meio de um token
   (provado pelo stream real de HELLO `48 38 45 4C B0 4F 00`).
   - `0` → literal: próximo byte do stream vai para a saída.
   - `10` → código longo:
     - `off_hi = gamma2_read() - LWM`; se `< 0` → **rep-match** reusa
       `offset_history` com `len = gamma2_read()` SEM ajuste (assimetria
       confirmada em `tools_a.s`);
     - senão `offset = (off_hi << 8) | próximo byte` (offset mínimo prático 1);
     - `len = gamma2_read()`; ajuste: `len += 2` se `offset < 128` ou
       `offset >= 32000`; `len += 1` se `1280 <= offset < 32000`
       (constantes `MINMATCH3_OFFSET=1280`, `MINMATCH4_OFFSET=32000` —
       apultra `src/format.h:44-45`, iguais em `tools_a.s`).
   - `110` → byte de comando: `0x00` = **EOD**; senão
     `offset = cmd>>1` (1..127), `len = 2 + (cmd&1)`.
   - `111` → mais 4 bits = `off4` (1º lido pesa <<3); `off4==0` → escreve
     byte `0x00`; senão cópia de 1 byte em `dst - off4` (1..15).
3. `gamma2_read` (`expand.c:64-75`): `v=1`; consome pares (dado, controle):
   `v=(v<<1)|dado`; para quando o controle é `0` (não acumulado).
   Consequências estruturais: **menor valor legível = 2**; portanto o menor
   comprimento de match é 3 (`128<=off<1280`), 4 (`off<128`/`>=32000`) ou 5
   (`off` em `[1280,32000)`); e **rep-match só é codificável com LWM=3**
   (logo após literal/`111`), pois exige gamma = LWM-1.

## Vetores fase 2 (construídos e confirmados)

Gerados por `scripts/rex_profiles/codecs/aplib/` (`gen_vectors.py` +
`build-vectors.sh`), publicados em `data/rex_profiles/codec/aplib/` com
`manifest.tsv` (hashes SHA-256 de entrada/saída de cada oráculo).

- 8 plains sintéticos redistribuíveis (ab_repeat, zeros_64k, text_rep,
  tile_like, pseudo_random_8k, noisy_runs_16k, far_window_40k cobrindo
  off>=32000, near_window_2k cobrindo janela curta): cada um comprimido
  pelos DOIS oráculos; status `CROSS-OK` = cada oráculo decodifica o stream
  do outro com saída byte-exata. Em 6/8 os dois encoders produzem streams
  idênticos (APJ == apultra); divergência de stream é esperada e registrada
  (comprimento, não conteúdo).
- 9 goldens montados À MÃO pela especificação (literais, 111-off0/off4,
  `110`, `10` curto, rep-match, mid-offset 1280, far-offset 32100, 1 byte
  via golden, e `g08_eod_trailing` para a fronteira de `bytes_consumed`:
  EOD válido seguido de 5 bytes de lixo que o decoder NÃO pode consumir) e
  auto-validados por espelho Python do decoder de referência;
  `build-vectors.sh` só os publica se **ambos os oráculos** decodificarem
  para a saída exata (`GOLDEN-CONFIRMED`); divergiu → rejeitados.
- 7 negativos `negative-spec` em `data/.../aplib/negative/` (sem EOD,
  rep-match como 1º token, offset além do histórico, truncamento no meio de
  token, saída excessiva com `max_out`, `110`/`111` sem histórico): as
  condições foram construídas de propósito e auto-verificadas pelo espelho;
  **os oráculos não foram executados neles** — a referência não valida
  entrada (UB além do EOF), então a expectativa de erro vem do contrato
  (`truncated` / `invalid-reference` / `excessive-output`), não do oráculo.
- Limites de formato documentados pelos oráculos: saída vazia não é
  representável (aPLib exige ≥1 byte); entrada de 1 byte quebra o APJ
  (`SKIP single`), mas o stream `5A C0 00` do estilo apultra decodifica nos
  dois (golden `g01b`).

## Requisitos estruturais do decoder do produto (desta especificação)

- Validar `offset_history` antes de copiar: rep-match sem offset anterior é
  entrada malformada — o produto **deve** retornar erro estruturado (a
  referência C retorna -1; o asm 68k trusts).
- Copia de match com `dst - offset < início` é erro estruturado.
- Validar espaço de saída ANTES de alocar/escrever; limite máximo declarado
  pelo chamador; sem leitura além do buffer de entrada (EOD ausente em
  stream truncado → erro `truncated`).
- Loop com limite superior de trabalho (passos ≤ função de
  len(input)+max_out); os oráculos de CLI NÃO têm limite (nem apultra nem
  APJ) — proteção é responsabilidade do produto.
- Cancelamento: ver contrato do integrador (rascunho pendente).

## Pendências deste perfil (checklist)

- [x] Fase 1: fonte/commit/licença/variante fixados.
- [x] Fase 2: vetores de fronteira + holdout com oráculos duplos e manifest.
- [x] Pacote p/ implementação nativa: `scripts/rex_profiles/codecs/aplib/PRODUCT-CONTRACT.md`
      (API, tabela de rejeição, regra de `bytes_consumed`, mapeamento
      vetor→expectativa, limites de prova) + `verify-product.sh` (executa a
      fixture contra um CLI do produto; negativos nunca vão ao oráculo).
- [x] Negativos fase 4 (negative-spec): 7 vetores derivados do contrato;
      trabalho-máximo e cancelamento ficam como política do produto (sem
      comportamento observável na referência).
- [ ] Implementação Rust no pipeline canônico (do integrador; roda `verify-product.sh`).
- [ ] Confirmação de que `aplib_unpack` SGDK retorna tamanho descomprimido e
      não exige buffer extra (lido em tools.h; testar contra vetores).
- [ ] Caso de recurso real p/ integrador ou rótulo fixture-only.
