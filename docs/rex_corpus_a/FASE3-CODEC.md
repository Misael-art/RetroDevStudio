# FASE 3 — Aceite do codec Kosinski contra a referencia fixada (Misión A)

Estado: **Experimental**. Camiño de consumo do produto aceptado vector a
vector; **ningún recurso do corpus confirmado** (ver «Aceite no corpus»).

| | |
|---|---|
| Branch | `codex/rex-corpus-a` (worktree exclusiva `~/RDS-REX-CORPUS-A`) |
| Base declarada | `b53ce7a6a474cf2194d82b7f83c82d3fd4085b42` |
| Fase anterior | `fc24810` (sondeo de recursos e ciclo do codec; `3af9aea` pre-rebase) |
| Territorio rastreado | `scripts/rex_corpus_a/`, `docs/rex_corpus_a/`, `data/rex_corpus_a/` |
| Compartido, **só lectura** | `crates/rex-kosinski/`, `data/rex_profiles/codec/kosinski/` |

## 1. Que se engadiu e por que

Un verbo novo, `verify`, e un módulo `spec`. A referencia xa publicaba, por
cada vector negativo, **a razón** pola que debe ser rexeitado (`expected_error`,
`max_out`, `stream_len` en `negative/<nome>.expected.json`). Unha ferramenta
que só comprobase «deu erro» aceptaría un decoder que falla polo motivo
equivocado: é o falso positivo que a misión prohíbe («unha tentativa de decode
ben-sucedida non confirma un recurso», e do revés, un rexeito inxustificado
tampouco o refuta).

Esquema de saída: `rex-corpus-verify/v1`.

Códigos de saída do contrato (todos probados en `tests/cli.rs`):

| Código | Significado |
|---|---|
| 0 | aceite completo: cada vector executado coincide |
| 4 | `non executado` — non hai directorio de referencia |
| 5 | **diverxencias medidas** |
| 6 | **aceite incompleto** — hai fluxo sen ficherio de agardo |

O 6 engadiuse durante esta fase porque a primeira medición descubriuno: a
copia vendorizada devolvía `0` cun dos dez goldens sen verificar. Un verde que
oculta un fluxo non executado é exactamente o que o encargo veda, así que o
contrato separa «executouse e diverxe» (5) de «falta por executar» (6).

## 2. Anclaxe da referencia

A referencia é o perfil `data/rex_profiles/codec/kosinski/` do integrador.

| Campo | Valor medido |
|---|---|
| Orixe | mdcomp (Flamewing) `koscmp`, `src/lib/kosinski.cc` |
| Commit | `72c6df405a75d322c5b3722da46c3abb864d3793` |
| Licenza | LGPL-3.0-or-later (ferramenta externa; ningún byte transplantado) |
| `support` declarado | `fixture-only` |
| Variante | Kosinski base, **non modular**; descritor LE 16 bits LSB→MSB, reabastecemento EARLY |
| Hash agregado **declarado** | `ea866df797126230b36e27b76ca569d4fd8528d291e86fe578491998ec3d96d1` |
| Hash agregado **medido** | `ea866df797126230b36e27b76ca569d4fd8528d291e86fe578491998ec3d96d1` |

Receita da que se reproduce (`build-vectors.sh:171`), executada sen alterar
nada:

```bash
cd data/rex_profiles/codec/kosinski
{ find plain golden negative -type f | LC_ALL=C sort | xargs sha256sum; cat manifest.tsv; } \
  | sha256sum | cut -d' ' -f1
```

Coincide byte a byte: a referencia que se aceptou é a mesma que está publicada.

## 3. Resultado nas dúas árbores

```bash
cd ~/RDS-REX-CORPUS-A
A=$PWD/scripts/rex_corpus_a
B=$A/target/debug/rex-corpus
$B verify --referencia data/rex_profiles/codec/kosinski              # exit 5
$B verify --referencia crates/rex-kosinski/fixtures/kosinski         # exit 6
```

| Árbore | golden | plain | negative | `ok` | `rexeitado` | `sen_expectativa` | `diverxentes` | exit |
|---|---|---|---|---|---|---|---|---|
| `data/rex_profiles/…` (orixe) | 10 | 12 | 5 | 21 | 5 | 0 | 1 | **5** |
| `crates/rex-kosinski/fixtures/…` (copia) | 10 | 12 | 5 | 21 | 5 | 1 | 0 | **6** |

Executáronse 27 vectores por árbore. Na orixe: 21 decodificacións coincidentes
(9 golden + 12 `plain`), 5 rexeitos confirmados **pola razón declarada**, 1
golden diverxente (§6). Na copia: os mesmos 21 coincidentes e os 5 rexeitados,
pero sen poder confirmar a razón (§7) e cun golden sen executar.
`diff -r --brief` entre ambas árbores só devolve ficheiros de declaración e
proveniancia: ningún vector común diferenza.

## 4. Entradas, consumo, saídas e hashes (orixe)

`max_saida=2097152`, `orzamento=4000000`. `consumo` = bytes do fluxo
consumidos ata o terminator. Log íntegro (fóra do repositorio):
`~/.retrodev/rex_corpus_a_work/logs/verify-data-rex_profiles-codec-kosinski.log`.

| Vector | bytes_in | consumo | saída | SHA-256 da saída (== agardada) |
|---|---|---|---|---|
| `m01_literals` | 11 | 11 | 6 | `e9c0f8b575cbfcb42ab3b78ecc87efa3b011d9a5d10b09fa4e96f240bf6a82f5` |
| `m02_single_with_eod` | 3 | — | — | **diverxencia**, ver §6 |
| `m03_inline_match` | 11 | 11 | 9 | `919c3b8b8e08d48059486c8349c144e329cc3af41ce116cd1acf4b93738f84aa` |
| `m04_separate_short` | 18 | 18 | 20 | `eed465696c9a50d1b891b262675d4dfa22e4baa8197c441a0f7cd20e543c3443` |
| `m05_separate_long_far` | 115 | 115 | 8451 | `f54f89287c12a3502182f246d4788a946194087381deab5dd4d7f8196b6955be` |
| `m06_continue_edge` | 14 | 14 | 7 | `9578ecfd18dfe61d72b9b529f8798292a9303e7d2e902aa76be84327baf3e3db` |
| `m07_inline_exact_history` | 10 | 10 | 6 | `69dc6c3210e25e62c5938ff4e841e81ce3c7d2cde583553478a77d7fcb389f30` |
| `m08_len10_three_byte` | 17 | 17 | 19 | `208640a3c2363b44a4afd1c5df6f87720c9a75fb06042241e4b7f6a74e14fd5d` |
| `m09_earlyfetch_boundary_literal` | 23 | 23 | 16 | `ba22b7dc95f6cc8765757be4bccf37cd92ece6d4987dc26a31e274c9be236921` |
| `m10_earlyfetch_straddle_inline` | 21 | 21 | 16 | `273a0c1be37f7d3634da356480cfcb41871593eeacd75e4a7fc970d8a5e7d4e8` |

Os dous goldens `m09`/`m10` son os discriminantes da fronteira EARLY FETCH: un
lector «late fetch» despraza todos os bytes. Aquí decodifican co hash exacto.

### 4.1 Propiedade cruzada: o byte de recheo tras o terminator

O perfil declara (`limits`) que `koscmp` pode emitir 1 byte de recheo **apois**
do terminator, polo que `bytes_consumed <= tamaño da stream`. Medido nas 12
`plain`:

| relación | recuento |
|---|---|
| `consumo == bytes_in` | 6 |
| `consumo == bytes_in − 1` | 6 |
| outro | **0** |

As 12 `plain` medidas (`bytes_in` / `consumo` / `saida`):

| Vector | in | consumo | saída | Vector | in | consumo | saída |
|---|---|---|---|---|---|---|---|
| `abcdef` | 12 | 11 | 6 | `near_window_2k` | 76 | 76 | 1680 |
| `ab_repeat` | 20 | 19 | 800 | `odd3` | 10 | 10 | 5 |
| `empty` | 6 | 5 | 0 | `pseudo_random_8k` | 394 | 394 | 8192 |
| `far_window_40k` | 1086 | 1085 | 40048 | `single` | 6 | 6 | 1 |
| `text_rep` | 106 | 105 | 6000 | `noisy_runs_16k` | 1526 | 1526 | 16384 |
| `tile_like` | 164 | 163 | 8192 | `zeros_64k` | 838 | 838 | 65536 |

Ningún vector consome máis bytes dos que ten. A asimetría 6/6 era
predicible: o recheo só aparece cando o encoder do oráculo o emite.

As 12 `plain` pechan tamén o ciclo (decode → encode → decode independente,
`ciclo=ok` nas 12). Isto é **determinismo do codec**, non evidencia de
recurso; a Fase 2 xa o cuantificara no corpus (4628/4628 pechaban).

### 4.2 Negativos: a razón, non só o rexeito

| Vector | bytes_in | `max_out` | declarado | medido | resultado |
|---|---|---|---|---|---|
| `k01_no_terminator_after_literal` | 3 | 16 | `truncated` | `fluxo-truncado` | rexeitado |
| `k02_separate_missing_high_byte` | 3 | 16 | `truncated` | `fluxo-truncado` | rexeitado |
| `k03_separate_ref_before_history_start` | 4 | 16 | `invalid-reference` | `referencia-invalida` | rexeitado |
| `k04_inline_dist_beyond_history` | 5 | 16 | `invalid-reference` | `referencia-invalida` | rexeitado |
| `k05_excessive_output` | 296 | **16 declarado** | `excessive-output` | `saida-excesiva` | rexeitado |

`stream_len` declarado coincide cos bytes reais nos cinco. `espello=` imprímese
verbatim e **non** se compara: `mirror_condition` é o token do espello Python,
que non executamos desde Rust. Observación para o integrador: no `k05` a
etiqueta declarada é `ERR-eod`, que non existe no vocabulario do espello
(`kos_mirror.py` só emite `ERR-trunc` e `ERR-off`); en `gen_vectors.py:348`
vese que para os vectors con `max_out` o que se afirma é unha desigualdade de
lonxitude, non un token. Non é un defecto de execución, pero si unha etiqueta
que un lector pode tomar por medida.

Que o `max_out` declarado **oblígase** está probado só polo test autoral
(`verify_obedece_o_max_out_declarado_por_vector_en_lugar_do_limite_xeral`,
que declara 4 nun vector de 8 bytes de saída): na árbore real o valor
declarado de `k05` é 16 e coincide xa coa nosa por defecto, así que alí as
dúas rutas son indistinguibles.

## 5. Control discriminativo (a proba de que o test non é decorativo)

Mutación: `Some(agardado) if agardado == medido` → `Some(agardado) if true`,
é dicir, «aceita calquera rexeito cando hai declaración».

```
cargo test --test cli  →  35 passed; 1 FAILED
   verify_rexeita_un_decoder_que_falla_polo_motivo_equivocado_aínda_que_rexeite
rexisto completo       →  115 passed; 0 failed
```

E, na árbore de referencia, **a saída foi idéntica** (`exit=5`, `rexeitado=5`):
as cinco razóns declaradas xa se cumpren co decoder tal e como está publicado,
polo que ningún dos dous lados do par (referencia ↔ produto) revela a
debilitación. Só o control autoral —que si inventa a incoherencia— a detecta.
Por iso fan falta os dous.

## 6. A diverxencia `m02` — clasificación e proposta

Medida:

```
GOLDEN m02_single_with_eod bytes_in=3 medido=- \
  esperado=bbeebd879e1dff6918546dc0c179fdde505f2a21591c9a9c96e36b054ec5af83 \
  resultado=diverxencia motivo=fluxo-truncado
```

Reprodución mínima: os bytes son `01 00 5A` (descritor `0x0001`: un literal, e
15 ceros) con agardo dun byte `5A`. Descrito á man: tras o literal, o bit
`0,0` abre un match inline que precisa un byte de distancia que xa non existe.

Non é un defecto do decoder. Tres fontes independentes din o mesmo:

1. `scripts/rex_profiles/codecs/kosinski/gen_vectors.py:284` afirma
   `assert sgot == "ERR-trunc"` para m02 no espello strict.
2. `manifest.json` → `limits`: «EXCECAO declarada: golden m02_single_with_eod
   e literal unico SEM terminator — aceito pelo oraculo por exaustao; sob o
   contrato do produto seria 'truncated'».
3. `crates/rex-kosinski/fixtures/PROVENANCE.md` di que a copia vendorizada
   **non** inclui o `.expected.bin` de m02 por ese mesmo motivo.

O que si é un defecto de **contrato de datos**: a excepción vive en prosa e na
ausencia dun marcador, mentres que o vector queda dentro do glob de aceite
`golden/*.expected.bin` e `manifest.tsv` lle asigna o mesmo status que aos
outros nove (`GOLDEN-CONFIRMED`, 10/10). Calquera consumidor que globe
`golden/` —como calquera ferramenta futura, non só a nosa— obterá un falso
positivo. Proposta (cambio compartido, **para o integrador**; aquí non se
editou `data/` nin `crates/`):

- mover o vector fóra do namespace de aceite (`golden/exceptions/`), ou
- engadir un campo de máquina (`contract_exception: "truncated"`) no
  `manifest.tsv`/no JSON lateral, ou
- distinguir o status desa fila (`GOLDEN-CONFIRMED-ORACLE-EXHAUSTION`).

Calquera das tres mantén os bytes e os hashes pinados; é metadata.

## 7. A copia vendorizada perde as declaracións

`diff -r --brief crates/rex-kosinski/fixtures/kosinski data/rex_profiles/codec/kosinski`
só mostra ficheiros «somente em data/…»: `evidence/`, `manifest.json`,
`manifest.tsv`, os 5 `negative/*.expected.json` e `golden/m02…expected.bin`.
Ningún vector común difire.

Consecuencia medida: na copia, `verify` imprime `declarado=ningún` para os cinco
negativos e `sen-expectativa` para m02, e sae con 6. A suíte do crate segue
aferindo os hashes (que é o que pinan en `tests/fixtures.rs`), pero **xa non
pode aferir a razón do rexeito nin o `max_out` por vector**, porque a metadata
non viaxou. Como `PROVENANCE.md` declara os `.json` «documentación de
proveniancia histórica», suxestión para o integrador: eses cinco ficheiros non
son documentación, son a metade esquerda da afirmación de aceitado; vendorizalos
e pinalos custaría 5 liñas de `PINNED`.

## 8. Que NON proba esta fase

| Afirmación | Estado |
|---|---|
| Kosinski confirmado no corpus (Sonic ou outras 5 imaxes) | **non executado**: a Fase 2 non deixou ningún candidato con evidencia de consumidor ou vínculo estrutural |
| Aceite no corpus (`--imaxe` + offsets reais) | **non executado** — sen recurso confirmado non hai vector de aceite; `verify` non le ROMs |
| Kosinski modular / `KosM` / Kosinski+ | **non medido**: o perfil declara a variante base non modular, e `magia` deu 0 marcadores nas 5 imaxes normalizadas |
| Reinserción segura na ROM | **non feito** (prohibido no encargo); o ciclo é decode→encode→decode en memoria |
| Execución do xogo modificado | **non feito** |
| Paridade cun segundo oráculo | **non medido** — o perfil xa a declara `blocked`; nós somos un segundo *consumidor*, non un segundo oráculo |
| Cobertura universal do formato | **non afirmada**: 27 vectores autorais, ningunha stream real de ROM |

## 9. Gates executados

| Gate | Resultado |
|---|---|
| `cargo test --offline` | **115 passed / 0 failed** (cli 36, consumer 20, container 9, inventory 20, json 9, magia 7, mdheader 9, spec 5). Antes da fase: 105 |
| `cargo fmt -- --check` | exit 0 |
| `cargo clippy --all-targets -- -D warnings` | limpo |
| `npm run check:tree` | `OK: Estrutura da raiz conforme docs/08_TREE_ARCHITECTURE.md.` |
| Bytes comerciais no índice | ningún: `git add` restrinxido a `scripts/rex_corpus_a/`, `docs/rex_corpus_a/`, `data/rex_corpus_a/` |
| `target/` | ignorado (`git check-ignore` OK) |

## 10. Continuidade cara á Fase 4

A Fase 4 debe intentar refutar as regras coa mostra reservada
(`Streets of Rage`, papel `reservada`, só con `REX_ROLES=reservada`). O que
esta fase deixa consumible:

- `verify` xa distingue as tres clases e a razón do rexeito; serviría igual
  para un segundo perfil de codec se a referencia publica a mesma forma
  lateral.
- `spec::campo_declarado` é deliberadamente un lector de obxecto plano, non un
  parser JSON: se Fase 5 necesita perfis con aninhamento, hai que decidir alí
  se se versiona un subconxunto ou se se pide `serde_json` (dependencia nova =
  aprobación do usuario + `docs/02_TECH_STACK.md`).
