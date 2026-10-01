# RELATORIO DE INTEGRACIÓN — MISSAO A (frente A, corpus real)

**Estado: Experimental.** Ningunha promoción de maturidade, ningunha fusión,
ningunha release. Este documento non substitúe os informes de fase: recolle o
que se pode integrar, o que queda aberto e o que **non** se probou.

| | |
|---|---|
| Base declarada | `b53ce7a6a474cf2194d82b7f83c82d3fd4085b42` |
| Base **efectivamente usada** | a mesma: `git merge-base main HEAD` → `b53ce7a…`; HEAD do frente `ac74ebf` |
| Branch | `codex/rex-corpus-a` (sen `upstream`: **ningunha entrega publicada**) |
| Worktree | `~/RDS-REX-CORPUS-A`, exclusiva deste frente |
| Territorio rastrexado | `scripts/rex_corpus_a/`, `docs/rex_corpus_a/`, `data/rex_corpus_a/` — nada máis tocouse |
| Concellos de fase | `FASE1-INVENTARIO.md`, `FASE2-RECURSOS.md`, `FASE3-CODEC.md`, `FASE4-REFUTACION.md`, `FASE5-PERFIS.md` |

## 1. Commits do frente

| Commit | Que trae |
|---|---|
| `ae3cc4c` | Fase 1 — inventario con proveniancia reculada e manifesto determinista |
| `3af9aea` | Fase 2 — sondeo de recursos e ciclo do codec, con refutación propia |
| `5b1ba74` | Fase 3 — aceite do codec pola razón declarada, código 6 de aceite incompleto |
| `56de87e` | Fase 4 — vínculo por carga absoluta longa e refutación das regras |
| `2c28431` | Fase 5 — contrato de evidencia, perfil fixado por hash, subcomandos `perfil`/`rexistro` |
| `ac74ebf` | Fase 5 — perfis e rexistros versionados + verificador de forma `tests/artefactos.rs` |

## 2. Que se entrega para integrar

**Crate `rex-corpus`** (`scripts/rex_corpus_a/`), zero dependencias externas,
lib + bin `rex-corpus`, MSRV 1.70; consome `crates/rex-addressing` e
`crates/rex-kosinski` por ruta sen duplicar nin modificar.

Seis esquemas versionados:

| Esquema | Onde | Que fixa |
|---|---|---|
| `rex-corpus-inventario/v1` | `src/inventory.rs` | contedor, membro, hashes, cabecero, layout, normalización, límites |
| `rex-corpus-scan/v1` | `src/scan.rs` | barrido acotado de candidatos Kosinski |
| `rex-corpus-magia/v1` | `src/magia.rs` | contaxe de marcadores de fluxo |
| `rex-corpus-consumer/v2` | `src/consumer.rs` | quen referencia/chama/carga un enderezo |
| `rex-corpus-verify/v1` | `cmd_verify` | aceite contra fixtures dunha referencia |
| `rex-corpus-evidence/v1` | `src/evidence.rs` | **gramática** da evidencia de consumidor |
| `rex-corpus-perfil/v1` | `src/perfil.rs` | perfil reutilizable fixado por SHA-256 |
| `rex-corpus-resource/v1` | `src/resource.rs` | rexistro de recurso con campos non medidos explícitos |

Artefactos de datos (só hashes, offsets e lonxitudes — ver FASE5 §5):
5 perfis e 8 rexistros (3 Sonic 1 + 5 mostra reservada), todos xerados pola
ferramenta sobre as imaxes locais e comprovados contra as medidas da Fase 4.

## 3. Afirmacións que se poden defender

1. Inventario de 5 imaxes Mega Drive (4 de desenvolvemento + 1 reservada) con
   hash de contedor, hash de membro, CRC-32, cabecero, layout e normalización
   declarados; a suma de verificación do cabecero de Sonic 1 **non** coincide
   coa imaxe local (declarado 57871, observado 30221).
2. Non hai maxia da familia Kosinski neste corpus: `magia` deu **0 marcadores**
   nas 5 imaxes normalizadas (`KosM`/`KosP`/`EniM`/`GSS `/`Unic`). Non se alega
   Kosinski modular nin Kosinski+.
3. O ciclo do codec está pechado contra a referencia fixada
   (mdcomp `koscmp`, commit `72c6df405a75d322c5b3722da46c3abb864d3793`,
   LGPL-3.0-or-later, `support=fixture-only`, hash agregado declarado = medido
   `ea866df7…`): 21 decodificacións coincidentes e 5 rexeitos confirmados pola
   razón declarada en cada árbore.
4. **Oito recursos con vínculo estrutural medido** (Fase 5): en Sonic 1,
   `41 F9 00 03 F0 9A` en `0x03082` é `lea $3F09A,A0` — bytes comprobados na
   imaxe; na reservada, seis cargas `lea …,A0` seguidas de `4E B9 … 0x085A2`.
   `confianza=confirmado-estaticamente` só cando existe evidencia vinculante.
5. Dúas regras da Fase 2 caen ao xeneralizalas (R6 carga absoluta como única
   forma, R7 chamada absoluta como requisito) e están refutadas con datos, non
   con opinión; a gramática acepta a forma de Sonic (carga sen chamada) por iso.

## 4. O que NON se probou (que ningún lector debe inferir)

- **Non se executou unha ROM nin unha liña de xogo modificado.** Nada aquí di
  que `0x085A2` sexa un descompresor, nin que eses fluxos se carguen en pantalla.
- Non hai decompilación de lóxica nin nomes de rutina: `A0`/`A1`, `bsr`/`jsr`
  son formas de opcode.
- Non hai reinserción nin ROM modificada (prohibido no encargo): o ciclo é
  decode→encode→decode en memoria.
- Non hai paridade cun segundo oráculo (somos un segundo *consumidor*).
- Non hai cobertura universal: 5 imaxes, 8 rexistros, unha convención de chamada
  por ROM. Unha ROM que referencie fluxos por táboa ou por desprazamento
  relativo PC segue sen detectar.
- A mostra reservada **só** se usou para tentar refutar (Fases 4 e 5); non axustou
  ningunha regra.

## 5. Decisións que lle corresponden ao integrador

1. **Licencia e fluxo de usuario.** `rex-corpus` consome unha referencia LGPL
   só como *fixture*; a decisión de cómo se expón ao usuario (e se se expón)
   non é deste frente.
2. **Promoción de maturidade.** Todo o frente queda `Experimental`.
3. **Publicación.** A branch non ten `upstream`: non se fixo `push` nin PR —
   queda á espera de orde expresa.
4. **Defectos propostos en territorio compartido** (reprodución mínima no
   informe da Fase 5 §9; **aquí non se modificou**):
   - `crates/rex-addressing`: `md_linear::translate` enmascara sen coñecer o
     tamaño real do arquivo; a zona de recheo resólveo o chamador.
   - `rex_corpus::consumer::tables_for`: acepta táboas cuxa primeira entrada
     cae moi abaixo do mapa (`primeiro=0x12` en Altered Beast).
   - `crates/rex-kosinski`: glob de aceite `m02`, `vendoring` de
     `negative/*.expected.json` (a copia perde as declaracións → `sen_expectativa`
     e código 6) e a etiqueta `ERR-eod` en `gen_vectors.py`.

## 6. Gates da entrega final

Executados en `~/RDS-REX-CORPUS-A/scripts/rex_corpus_a` con HEAD `ac74ebf`:

| Gate | Resultado |
|---|---|
| `cargo test --offline` | **157 passed · 0 failed** |
| `cargo test --offline` en commit illado (`2c28431`) | 154 passed · 0 failed (os 3 testes de artefactos veñen con `ac74ebf`) |
| `cargo clippy --offline --all-targets -- -D warnings` | sen avisos |
| `cargo fmt -- --check` | exit 0 |
| `npm run check:tree` | `OK: Estrutura da raiz conforme docs/08_TREE_ARCHITECTURE.md.` |
| Bytes comerciais no índice | ningún (ver FASE5 §5; os ficheiros de datos son JSON/JSONL de hashes) |
| ROMs (BYOR) | fóra do índice, en `~/.retrodev/rex_corpus_a_work/staged` e `~/.retrodev/rex_corpus_a_holdout/staged`, identificadas por SHA-256 |
| Controles discriminativos | 5 mutacións → FAIL esperado → restauración byte a byte → 157 verdes (FASE5 §6.1) |

## 7. Adenda do integrador (2026-10-01)

Revisión de pre-integración feita polo integrador na curadoria
`codex/rex-integrator-corpus-a` (cherry-picks `-x` dos sete commits sobre
`2793430`; esta worktree da agente non foi tocada). Evidencia histórica
mantense tal cal; esta adenda non reescribe o corpo do relatorio.

1. **Re-medición no destino:** `cargo test --offline` **157 passed · 0 failed ·
   0 ignored** e `npm run check:tree` OK na curadoria — idénticos aos números
   de §6.
2. **Corrección factual pendente da agente:** a edición AÍNDA NON commitada
   deste relatorio (preservada en
   `REX-HANDOFF-2026-10-01/084414Z/A-unstaged.patch` e
   `backup-integracao-2026-10-01/copias/A-RELATORIO-INTEGRACION-modificado.md`)
   afirma que «o tronco é `codex/collect-counter-goal`». **Non é correcto**: o
   repositorio ten `origin/main` (`616abdb`, parado) e o tronco de trabalho é a
   liña do integrador `codex/rex-integrator-crates-registry` @ `0194f94`, da
   cal descende `2793430`. A afirmación non entra nesta cadea porque só existe
   no diff non commitado; ao rebasear esa edición, substituir pola liña da
   adenda.
3. **Veredicto da revisión (consumidor + variante + saída):** o alvo do LEA é o
   propio offset do stream (`lea $3F09A,A0` @ `0x03082` → recurso
   `offset:258202`), variante declarada `base` sen alegar modular/Kosinski+, e
   a saída ten aceite contra `koscmp` (21 coincidencias + 5 rexeitos). §3.2
   alega soamente ausencia de marcadores de fluxo (0/5 imaxes), non ausencia de
   codec — a disciplina pedida cúmprese.
4. **Nota de procedencia (compartida coa fronte D):** a imaxe «Sonic 1» local
   (531577 bytes, SHA-256 `c7da53a1…`) ten checksum de cabeceiro diverxente do
   varexo (declarado 57871, observado 30221). Xa declarado en §3.1; toda a
   proba é contra ESTA imaxe, pinada por hash.
5. **Decisións que seguen abertas para o operador** (§5 orixinal mantense):
   licenza/exposición do crate (consome referencia LGPL só como *fixture*) e
   calquera promoción de madurez — nada aquí é merge, release nin promoción.

