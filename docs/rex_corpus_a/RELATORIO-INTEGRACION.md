# RELATORIO DE INTEGRACIÓN — MISSAO A (frente A, corpus real)

**Estado: Experimental.** Ningunha promoción de maturidade, ningunha fusión,
ningunha release. Este documento non substitúe os informes de fase: recolle o
que se pode integrar, o que queda aberto e o que **non** se probou.

| | |
|---|---|
| Base declarada | `b53ce7a6a474cf2194d82b7f83c82d3fd4085b42` |
| Base **efectivamente usada** | a mesma, e comprobada: `git merge-base b53ce7a HEAD` → `b53ce7a6a474cf2194d82b7f83c82d3fd4085b42` (é ancestral directo de HEAD). `b53ce7a` é a ponta publicada de `codex/rex-mugen-locomotion` (cadea MUGEN); o PR dependente deste fronte usa esa base. A integración no tronco (`codex/rex-integrator-crates-registry`, `0194f94`) coordínaa o integrador — o tronco aínda non contén `b53ce7a` (PRs #87–#95 empilhadas, sen merge). Unha versión anterior desta liña dicía "tronco = `codex/collect-counter-goal`": estaba **incorrecta** e corrixida aqui |
| HEAD do frente | este commit — nove commits sobre a base, todos na táboa §1 |
| Branch | `codex/rex-corpus-a` (publicada; PR #96 → `codex/rex-mugen-locomotion`) |
| Worktree | `~/RDS-REX-CORPUS-A`, exclusiva deste frente |
| Territorio rastrexado | `scripts/rex_corpus_a/`, `docs/rex_corpus_a/`, `data/rex_corpus_a/` — nada máis tocouse |
| Concellos de fase | `FASE1-INVENTARIO.md`, `FASE2-RECURSOS.md`, `FASE3-CODEC.md`, `FASE4-REFUTACION.md`, `FASE5-PERFIS.md`, `FASE6-CADEIA-E-CORREXIONS.md` |

## 1. Commits do frente ( ata este commit )

| Commit | Que trae |
|---|---|
| `ae3cc4c` | Fase 1 — inventario con proveniancia reculada e manifesto determinista |
| `3af9aea` | Fase 2 — sondeo de recursos e ciclo do codec, con refutación propia |
| `5b1ba74` | Fase 3 — aceite do codec pola razón declarada, código 6 de aceite incompleto |
| `56de87e` | Fase 4 — vínculo por carga absoluta longa e refutación das regras |
| `2c28431` | Fase 5 — contrato de evidencia, perfil fixado por hash, subcomandos `perfil`/`rexistro` |
| `ac74ebf` | Fase 5 — perfis e rexistros versionados + verificador de forma `tests/artefactos.rs` |
| `52f9abe` | Fase 6 — relatorio de integracion da rodada anterior |
| `0a594a3` | Fase 6 (continuación) — contrato de confianza v2 (`vinculo-estrutural`/`referencia-estatica`), táboa non vinculante, morfoloxía do descompresor, parámetros, comparación independente e auditoría da mostra reservada (`FASE6-CADEIA-E-CORREXIONS.md`) |
| este commit | Reconciliación do relatorio: oito esquemas, niveis v2, correccións da Fase 5 e gates 161 |

## 2. Que se entrega para integrar

**Crate `rex-corpus`** (`scripts/rex_corpus_a/`), zero dependencias externas,
lib + bin `rex-corpus`, MSRV 1.70; consome `crates/rex-addressing` e
`crates/rex-kosinski` por ruta sen duplicar nin modificar.

Oito esquemas versionados:

| Esquema | Onde | Que fixa |
|---|---|---|
| `rex-corpus-inventario/v1` | `src/inventory.rs` | contedor, membro, hashes, cabecero, layout, normalización, límites |
| `rex-corpus-scan/v1` | `src/scan.rs` | barrido acotado de candidatos Kosinski |
| `rex-corpus-magia/v1` | `src/magia.rs` | contaxe de marcadores de fluxo |
| `rex-corpus-consumer/v3` | `src/consumer.rs` | quen referencia/chama/carga un enderezo; v3: `vinculo=si` só por forma de instrución (táboa enumérase, non vencella — refutación de R1) |
| `rex-corpus-verify/v1` | `cmd_verify` | aceite contra fixtures dunha referencia |
| `rex-corpus-evidence/v1` | `src/evidence.rs` | **gramática** da evidencia de consumidor |
| `rex-corpus-perfil/v1` | `src/perfil.rs` | perfil reutilizable fixado por SHA-256 |
| `rex-corpus-resource/v2` | `src/resource.rs` | rexistro de recurso con confianza que nomea a medida (v1 dicía `confirmado-estaticamente` para dous niveis de proba; v2: `candidato` / `referencia-estatica` / `vinculo-estrutural`) |

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
4. **Oito fluxos con vínculo estrutural medido, en dous niveis honestos**
   (Fases 4–6): en Sonic 1, `41 F9 00 03 F0 9A` en `0x03082` é
   `lea $3F09A,A0` — bytes comprobados na imaxe; a evidencia versionada é
   unha **referencia estática** (`referencia-estatica`: o enderezo é operando
   dunha instrución; a chamada `bsr.w $0189E` foi medida na Fase 6, fóra da
   gramática actual). Na reservada, seis cargas `lea …,A0` seguidas de
   `4E B9 … 0x085A2` — **vínculo estrutural** (`vinculo-estrutural`): carga +
   chamada á rutina, con fonte en A0 e destino en A1 medidos nos seis sitios.
   A rutina `$085A2` ten a **forma morfolóxica completa dun descompresor con
   convencións Kosinski base** (descritor LE/LSB-first, 1=literal, distancia
   `(High&0xF8)<<5|Low`) — comprobada instrución a instrución en
   `$085A2…$08621`, **sen executar un byte** (FASE6 §5). Ningún rótulo alega
   recurso consumido en runtime.
5. **Comparación independente do produto decodificado** (FASE6 §6): unha
   segunda implementación do codec, escrita de cero e validada nos 27
   vectores do perfil fixado (21 aceptas, 5 rexeitos pola razón declarada,
   `m02` coa excepción contratual), reproducen **8/8** o consumo, tamaño e
   SHA-256 dos rexistros versionados. É acordo entre dúas implementacións,
   non paridade de oráculo.
6. Dúas regras da Fase 2 caen ao xeneralizalas (R6 carga absoluta como única
   forma, R7 chamada absoluta como requisito) e están refutadas con datos, non
   con opinión; a gramática acepta a forma de Sonic (carga sen chamada) por iso.

## 4. O que NON se probou (que ningún lector debe inferir)

- **Non se executou unha ROM nin unha liña de xogo modificado.** Nada aquí di
  que eses fluxos se carguen en pantalla nin que A1 reciba esas escritas.
  A identidade de `$085A2` como descompresor é **morfolóxica** (bytes
  decodificados á man), non execución.
- A cauda da rutina (`$08622`…) non se decodificou instrución a instrución;
  e en Sonic 1 a convención de entrada está **aberta**: os tres `bsr.w`
  apuntan a `$0189E`, dous bytes despois do prólogo `55 8F`
  (FASE6 §10.3).
- A busca de opcodes é **varredura lineal aliñada a palabra**, non análise de
  alcanzabilidade: un opcode pode casar en bytes de datos (a limitación vai
  declarada en cada rexistro).
- Non hai reinserción nin ROM modificada (prohibido no encargo): o ciclo é
  decode→encode→decode en memoria.
- Non hai paridade cun segundo oráculo (somos un segundo *consumidor*; a
  comparación independente da Fase 6 é entre dúas implementacións do mesmo
  operador).
- Non hai cobertura universal: 5 imaxes, 8 rexistros, unha convención de
  chamada por ROM. Unha ROM que referencie fluxos por táboa ou por
  desprazamento relativo PC segue sen detectar (a chamada de Sonic por `bsr`
  medíuse só como exploración; a gramática actual non a versiona).
- A ausencia de strings `KosM`/`KosP`/etc. (0 marcadores nas 5 imaxes) é unha
  medida de contaxe: **non proba a ausencia dos formatos** nin autoriza a
  alegar Kosinski modular/Kosinski+ nin a negalo.
- A mostra reservada **orixinou** as regras R6/R7 e a ventá de 16 bytes
  (Fase 4 §6–7): a afirmación anterior de que "non axustou ningunha regra"
  estaba **incorrecta** e corrixise na Fase 6 §7. A validación non vista
  desas regras acabou sendo Sonic 1; os 5 rexistros da reservada son
  in-sample para a regra que os detectou.

## 5. Decisións que lle corresponden ao integrador

1. **Licencia e fluxo de usuario.** `rex-corpus` consome unha referencia LGPL
   só como *fixture*; a decisión de cómo se expón ao usuario (e se se expón)
   non é deste frente.
2. **Promoción de maturidade.** Todo o frente queda `Experimental`.
3. **Publicación.** Feita nesta rodada, coa autorización do encargo:
   `push` de `codex/rex-corpus-a` (remoto = local `463cb8a`…, verificado
   antes para non sobrescribir: a branch non existía na orixe) e PR #96
   dependente de `codex/rex-mugen-locomotion`. Sen merge.
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

Executados en `~/RDS-REX-CORPUS-A/scripts/rex_corpus_a` con HEAD `52f9abe`:

| Gate | Resultado |
|---|---|
| `cargo test --offline` | **161 passed · 0 failed** (após o contrato v2 da Fase 6; antes: 157) |
| `cargo test --offline` en commit illado (`2c28431`) | 154 passed · 0 failed (os 3 testes de artefactos veñen con `ac74ebf`) |
| `cargo clippy --offline --all-targets -- -D warnings` | sen avisos |
| `cargo fmt -- --check` | exit 0 |
| `npm run check:tree` | `OK: Estrutura da raiz conforme docs/08_TREE_ARCHITECTURE.md.` |
| Bytes comerciais no índice | ningún (ver FASE5 §5; os ficheiros de datos son JSON/JSONL de hashes) |
| ROMs (BYOR) | fóra do índice, en `~/.retrodev/rex_corpus_a_work/staged` e `~/.retrodev/rex_corpus_a_holdout/staged`, identificadas por SHA-256 |
| Controles discriminativos | Fase 5: 5 mutacións → FAIL esperado → restauración → verdes. Fase 6: mutación `e_carga_con_chamada` → 7 FAIL en 4 binarios → restauración byte a byte → **161 verdes** (FASE6 §8) |
| Comparación independente | segunda implementación validada nos 27 vectores e 8/8 fluxos reais por SHA-256 (FASE6 §6) |
