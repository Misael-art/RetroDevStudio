# Relatório técnico — endereçamento de ROMs en Rust (`rex-addressing`)

Data: 2026-09-27 · Rodada: axente A (frente A) · Branch: `codex/rex-rust-addressing`
Worktree exclusivo: `/home/misael/RDS-REX-A2-RUST-ADDR`
Base do diff: `9b27941` · 15 commits propios; o último de **código** é `ef5ab1a`
e o resto son docs (§11). Todas as medicións deste relatório rodáronse sobre a
árbore de `ef5ab1a`, limpa.
Estado de madurez: **Experimental**. Sen merge, sen release, sen promoción.

---

## 1. Obxectivo e veredicto

**Obxectivo:** biblioteca Rust autónoma, determinista e testada que traduce
enderezos de CPU a offsets de ficheiro para cinco perfis (MD lineal, MD SSF2 con
estado de rexistros de banco, SNES LoROM / HiROM / ExHiROM), con inversión con
aliases, lecturas segmentadas e erros estruturados.

**Veredicto:** os **cinco perfis están implementados e verdes** contra (a) 565
casos de vectores pinados, (b) unha segunda referencia executábel de código
distinto, e (c) sete controles de mutación que fallan cada un á súa maneira.
`cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` e a batería
rápida (**76 passed · 0 failed · 9 ignored**) están limpos na árbore entregada.

**O que isto NON é** (orixen do encargo, non inferencia):

- Non é soporte a xogo ningún: non detecta mapas, non deduce perfil por tamaño
  nin por banner, non modela DSP/SA1/SuperFX/CX4/SVP.
- Non é UI, non é decodificación de rexistros IO, non é descompilación.
- Tres dos cinco perfis son **só-fixture**: o corpus autorizado non permite
  proba con imaxe real neles (§7.5).
- Non se tocou ningún ficheiro compartido: o diff son **36 ficheiros, todos de
  alta, 0 modificacións, 0 borrados** (§9).

---

## 2. Táboa de checkpoint — os cinco perfis

| Perfil | Implementado | Testes executados | Comparación independente | Limitacións | Pendencias |
|---|---|---|---|---|---|
| **md-linear**<br>`src/md_linear.rs` (208 L) | `translate` / `invert` / `read`; xanela cartucho `$000000-$3FFFFF`; espello por `rom_size`; claves estrañas de estado **ignóranse** | 1 suite diferencial + `md_linear_rules.rs` (6 probes); vectores: 22 translate · 11 negativos · 5 invert · 60 mostras · 7 read = **105 casos** | **29 casos graduados** (4 sen modelo, nomeados); exaustivo: **20 offsets → 160 aliases**, preimage exacto; **BYOR con imaxe real** (§7.5) | `$E00000-$FFFFFF` etiquetado `WorkRam` (non `Sram`), como a referencia auditada; sen TMSS / MegaCD / Everdrive | ningunha no perfil |
| **md-ssf2**<br>`src/md_ssf2.rs` (341 L) | idem + `write_mapper_register` **pura**; 7 ventás remapeables de 512 KB; páxina de rexistros `$A13000-$A130FF` | `md_ssf2_rules.rs` (13) · `ssf2_writes.rs` (2) · 3 probes de `differential.rs`; vectores: 18 · 13 · 9 · 60 · 11 · 12 secuencias · 10 réx. = **133 casos** | **22 graduados** (9 sen modelo); motor de táboa de 64 páxinas; exaustivo: identidade **53 offsets → 53 aliases**, remapeado `{1:32,5:51}` **43 → 64** e **10 offsets sen preimage** (o perfil devolve lista baleira, non aliases inventados) | as 12 secuencias de escrita non levan estado no JSON: o teste fixa `SSF2_SEQ_ROM_SIZE = 0x800000` (§7.2); sen chips especiais | ningunha no perfil |
| **snes-lorom**<br>`src/snes_lorom.rs` (214 L) | `translate` / `invert` / `read`; estado SNES **rexeita** claves estrañas (asimétrico con MD) | 1 suite + `snes_lorom_rules.rs` (11); vectores: 18 · 10 · 8 · 60 · 10 = **106 casos** | **23 graduados** (5 sen modelo); exaustivo: **34 offsets → 270 aliases** | **só-fixture** (corpus sen ROM SNES); sen SA1 / SuperFX / CX4 / S-DD1 | ningunha no perfil |
| **snes-hirom**<br>`src/snes_hirom.rs` (225 L) | `translate` / `invert` / `read`; lectura que emenda bancos; `0x00fff0` de 32 B → 2 segmentos | 1 suite + `snes_hirom_rules.rs` (13); vectores: 18 · 8 · 7 · 60 · 10 = **103 casos** | **21 graduados** (5 sen modelo); exaustivo: **33 offsets → 380 aliases**; vectores **post-corrección histórica probados de dous xeitos** (§3) | **só-fixture**; prose de WRAM ("128 KB contiguos") vs `offset = a` (§7.4) | ningunha no perfil |
| **snes-exhirom**<br>`src/snes_exhirom.rs` (291 L) | `translate` / `invert` / `read`; área 2 con espello por `half2 = rom_size − 0x400000`; só totais `(4 MB, 8 MB]` con `half2` potencia de 2 | 1 suite + `snes_exhirom_rules.rs` (15, o maior); vectores: 25 · 8 · 13 · 60 · 12 = **118 casos** | **28 graduados** (5 sen modelo); exaustivo en dous tamaños: 8 MB **65 → 101**, 5 MB **61 → 155** | **só-fixture, declarado**; 7 MB rexeitado (`half2 = 3 MB` non é potencia de 2 — o padding a 8 MB está rexistrado, non implementado); sen S-DD1 | ningunha no perfil |

Total de casos de vector consumidos: **565** (105+133+106+103+118). Máis 4
doc-tests de uso, 5 probes de auto-comprobación do banco de probes
(`harness_selfcheck.rs`), 2 probes de escritas SSF2 (`ssf2_writes.rs`), 1 probe
exaustivo de inversión (`#[ignore]`) e 8 probes BYOR (`#[ignore]`).

---

## 3. A corrección histórica de HiROM, probada de dous xeitos

O encargo esixía confirmar que os vectores HiROM pinados **non** son anteriores
á corrección da fórmula de inversión, e que non se resucitan vectores vellos.

**Proba 1 — ascendencia e hash (documental, verificada en ficheiros efectivos):**

```
b952329  2026-09-25 08:45:48  fix(snes-hirom): invert devolvía aliases inexistentes e perdía legítimos
9ec21ac  2026-09-25 09:12:23  test(rex): vectores diferenciais p/ Rust (rust-vectors-v1.json + exportador)
$ git merge-base --is-ancestor b952329 9ec21ac   →  SI
```

O ficheiro xerado en `9ec21ac` é bit a bit o que consumo:

| Localización | SHA-256 |
|---|---|
| `9ec21ac:` `data/rex_profiles/addressing/differential/rust-vectors-v1.json` | `da09b5b2e84aeac4a95ee02fa6cc8fb6e77aa6a43ecce77a010d3082d741e048` |
| HEAD do workspace de referencia (só lectura) | `da09b5b2…e048` (idéntico) |
| miña copia: `…/rex-addressing/vectors/rust-vectors-v1.json` | `da09b5b2…e048` (idéntico) |

`git diff 9ec21ac HEAD -- <ficheiro>` está baleiro: non se regenerou nin se
editou nada desde a xeración posterior á corrección.

**Proba 2 — executábel (control M1):** restaurar a rama pre-`b952329` en
`src/snes_hirom.rs:116` fai **fallar** os vectores pinados con output literal
rexistrado en `MUTATION-CONTROLS.md`: a vella fórmula **invénta 8 aliases** de
metade alta. Un perfil con aliases de máis é precisamente o defecto que se
corrixiu; se os vectores foseis anteriores á corrección, M1 pasaría.

---

## 4. Verificación literal na árbore entregada

```bash
cd /home/misael/RDS-REX-A2-RUST-ADDR/scripts/rex_profiles/addressing_runtime/rex-addressing
export CARGO_TARGET_DIR=/tmp/rex-a2-target      # saída de build propia, nunca compartida
```

| Comando | Resultado |
|---|---|
| `cargo fmt --check` | saída baleira, código 0 |
| `cargo clippy --offline --all-targets -- -D warnings` | `Finished \`dev\` profile` sen advertencias |
| `cargo test --offline` | **76 passed · 0 failed · 9 ignored** en 12 binarios |
| `cargo test --offline --release --test inversion -- --ignored` | **1 passed** · 7 casos · 309 offsets · 1183 aliases · 10.34 s |
| `cargo test --offline --test byor -- --ignored` | **8 passed · 0 failed** · 0.20 s |

Reparto da batería rápida por binario: `lib` 0 · `byor` 8 ignored ·
`differential` 7 · `harness_selfcheck` 5 · `inversion` 1 ignored ·
`md_linear_rules` 6 · `md_ssf2_rules` 13 · `snes_exhirom_rules` 15 ·
`snes_hirom_rules` 13 · `snes_lorom_rules` 11 · `ssf2_writes` 2 · doc-tests 4.

**Dependencias: cero.** `Cargo.toml` ten `[dependencies]` e
`[dev-dependencies]` baleiros; `Cargo.lock` contén **exactamente 1 paquete**
(o propio). Compila sen rede. O parser JSON (`tests/support/json.rs`, 335 L),
SHA-256 (`tests/support/sha256.rs`, 94 L) e fixtures son reimplementacións
propias só de tests.

---

## 5. Tradución, inversión/aliases, fronteiras e transicións SSF2

Catro requisitos do encargo, e onde están probados con métrica real:

**Tradución (todos os perfis).** Cada caso de vector pasa por dúas capas que non
comparten fórmula: os probes manuais derivados de `boards.bml` / `md_cart.c`
(`tests/<perfil>_rules.rs`) e o motor declarativo (`oracle_cross_check`). Os 565
casos están nas táboas de §2.

**Inversión e aliases.** Tres capas mecanicamente distintas:

1. `invert_cases` pinados (42 casos nos cinco perfis) — preimage exacto caso a caso.
2. `invert_samples_exhaustive_verified` (60 mostras por perfil) — aliases
   verificados por enumeración exaustiva no xerador.
3. `tests/inversion.rs::cada_perfil_devolve_exactamente_o_preimage_do_motor`
   (`#[ignore]`, 10.34 s) — enumera **todo o dominio de 24 bits** e compara co
   preimage do motor. Este é o probe que distingue "lista baleira correcta" de
   "aliases de máis": os 10 offsets sen preimage do caso SSF2 remapeado teñen
   aserción explícita de baleiro.

**Fronteiras en lectura.** `read_cases` pinados (50 nos cinco perfis) máis os
doc-tests. Casos de fronteira probados: `0x00fff0` de 32 bytes en HiROM → 2
segmentos (`Bytes{0xfff0,16}` + `DeviceNoBacking`); cruzamento de bordo do
espello da área 2 en ExHiROM 6 MB; `0x7FFF/0x8000` nas ventás de 32 KB LoROM;
imaxe curta en MD → `OutOfRange`, non clamp (control M5). Toda lectura queda
acotada por corredor, e a garda `debug_assert!(run >= 1)` (`4958a2b`) converte
calquera inconsistencia entre fórmula de offset e anchura de espello en panic
con nome, non en bucle infinito (§8.2).

**Transicións de banco SSF2.** `ssf2_write_sequences` (12) máis
`ssf2_pinned_write_register_cases` (10) máis `tests/ssf2_writes.rs` (2 probes):
cada secuencia afirma bytes antes/despois, que as **outras** ventás non cambian,
que a escrita é pura (o estado anterior queda idéntico), e que a decodificación
da ventá é `window = (cpu_address & 0x0E) >> 1`. O control M4 mutando esa
decodificación falla as dúas capas (§8).

---

## 6. Expectativas manuais vs comparación independente executábel

As dúas capas existen e **non se substitúen**. A separación é explícita en
código e en contadores distintos.

- **Capa A — expectativa manual derivada de specs** (`tests/*_rules.rs`, 58
  probes: 6+13+11+13+15). Fórmula escrita á man a partir de `md_cart.c` de
  GPGX `939ce4f045f981f89965f24780cef045cc5e52d7`, `boards.bml` de bsnes
  `7d5aa1e656b9171524d01b1b22917197d8121cb4` e `memmap.cpp` de snes9x
  `1bcc369e89f08243e0a462882fb1f3e42e51de3a`. **Cero liñas transcritas**; só
  consulta, conforme ás licenzas (BSD-custom GPL-3.0 / Snes9x non comercial).
- **Capa B — referencia executábel de código distinto**
  (`tests/support/windows_engine.rs`, 484 L + `Ssf2Engine`). Consome a táboa
  declarativa `vectors/windows-generated.json` e **non reutiliza ningunha
  fórmula dos perfis**. É un matcher de ventás, non aritmética pechada.

Contadores executados da capa B, perfil a perfil (nova saída de `ef5ab1a`):

```
md-linear:     29 casos graduados, 4 sen modelo
md-ssf2:       22 casos graduados, 9 sen modelo
snes-lorom:    23 casos graduados, 5 sen modelo
snes-hirom:    21 casos graduados, 5 sen modelo
snes-exhirom:  28 casos graduados, 5 sen modelo
```

"Sen modelo" son casos de erro cuxo estado o motor declarativo non representa
(`estado ausente`, `rom_size acima do alcance`, `banco con valor string`,
`xanela de banco desconhecida` …). Quedan **nomeados na saída**, non ocultados:
antes de `ef5ab1a` filtrábanse antes de recollelos e a columna non era
auditable. Verificouse contra o JSON que **os 28 casos sen modelo son todos
`translate_negatives`**: ningún dos **101 casos positivos de tradución**
(22+18+18+18+25) queda sen referencia executábel.

**Integridade das entradas (executada en cada run, non un comentario):**

| Entrada | SHA-256 pinada | Onde se re-comproba |
|---|---|---|
| `vectors/rust-vectors-v1.json` | `da09b5b2…e048` | `tests/support/vectors.rs:248` (assert no `load`) |
| `vectors/windows-generated.json` | `2de90492…15fa` | `tests/support/windows_engine.rs:186` |
| fixtures por perfil (PRNG `xorshift32`) | en `pv.fixture.sha256` | re-derivadas e comparadas en `differential.rs:202` e `harness_selfcheck.rs:34` |
| imaxe BYOR real | `c7da53a1…1ebb` | re-hash do ficheiro en `tests/byor.rs:53`, panic se falta |
| `boards.bml` orixinal | `b8006d80…3b78` | **rexistrada** no campo `source` da táboa; **non** re-verificable en Rust (o `.bml` non se vendoriza) — límite declarado |

### 7.5 Evidencia BYOR (só MD lineal e SSF2)

Política do corpus inventariado en fase 3: 256 ficheiros, **exactamente 1 ROM
crua**, sen extracción nin copia permitidas. Polo tanto só os dous perfis de MD
teñen proba con imaxe real; os tres SNES seguran **só-fixture por falta de
corpus, non por decisión de deseño**.

```
identidade OK: ficheiro 531577 B sha=c7da53a1… , imaxe 0x80000 B sha=76e1ffe0c5ce57d9…
inversión real: 1538 offsets, 12304 lecturas de alias, 0 desaxustes
ficheiro cru:   1016 segmentos, ningún toca os 7289 bytes de apéndice
linear vs ssf2-identidade: 1009 lecturas reais idénticas
$FF0000-$FFFFFF: Device/WorkRam sen bytes, como na referencia auditada
```

Os 8 probes están `#[ignore]` (a ROM non é provisionable en CI). O ficheiro
ausente **faila con panic nomeado**, non pasa como GREEN: verificouse
intencionadamente cunha ruta falsa.

---

## 7. Catro defectos de evidencia atopados ao auditar as entradas

Atopados ao cruzar o que o xerador afirma contra o que o Rust executa. Ningún
ocultado; ningún cambia comportamento do perfil.

1. **12 casos levan `engine_agree: false`** (1 md-linear, 8 md-ssf2, 3
   snes-exhirom) — a referencia autónoma xulgábase en desacordo co esperado.
   **Diagnóstico verificado executando o xerador** (`export-vectors.mjs`):
   constrúe o seu motor **unha soa vez** co estado da fixture, así que todo caso
   con estado propio lle resulta irrelevante. Comprobouse que os 12 teñen estado
   propio distinto da fixture (`rom_size` 0x10000 vs 0x80000, `banks {1:5}`,
   5/6 MB vs 8 MB). O banco Rust reconstrúe o motor **por caso**
   (`harness_selfcheck.rs::Reference::for_case`) e gradúa os 12 como correctos.
   A bandeira non se consome: o Rust re-derive.
2. **As 12 `ssf2_write_sequences` non levan `mapper_state`.** O esperado
   calculouse sobre un `rom_size` que o JSON non rexistra. O Rust fixa
   `SSF2_SEQ_ROM_SIZE = 0x800000` con comentario explícito; se alguén cambia a
   constante, a secuencia deixa de ter sentido — non é evidencia silenciosa.
3. **Os `read_cases` pían un prefixo de 32 bytes (`bytes_hex`), non o corredor
   completo.** A comparación é de prefixo, cun assert adicional de que o
   corredor obtido non é máis curto que o pinned. Boa parte do corredor non
   está fixada; dicilo é máis honesto que chamarlle "lectura completa
   verificada".
4. **A xanela MD `$E00000-$FFFFFF` está etiquetada `WorkRam`, non `Sram`.**
   Executando a referencia auditada (`md-linear.mjs`), `$FF0000` devolve
   `{"region":"work-ram","offset":0}`. Cambiar o comportamento do Rust
   diverxiría dos vectores pinados, así que se **fixou a etiqueta
   entregada** (`tests/byor.rs`, `CONTRATO.md` §10) en vez de "arreglar" o
   comportamento en silenzo.
   `Region::Sram` só o emiten os perfis SNES.

Adicional e menor: o contrato de HiROM di "128 KB de WRAM contiguos" pero a
fórmula de offset é `a` sobre a xanela; rexistrado en `CONTRATO.md` §10 como
diverxencia de prose, non de aritmética.

---

## 8. Os testes rexeitan unha alteración incorrecta (7 controles)

`docs/rex_profiles/addressing_runtime/MUTATION-CONTROLS.md` garda o output
literal de cada fallo e o revert verde. Cobertura por mecanismo: validación de
estado (M3, M6), fórmula de inversión (M1, M2), anchura de espello en lectura
(M2b, M5), estado do mapper (M4). **Ningunha mutación chegou a `HEAD`.**

Re-verificouse **na árbore entregada** (`ef5ab1a`, coa batería xa ampliada): M3
aplicado → `test result: FAILED. 6 passed; 1 failed` coa mensaxe
`agardábase Unsupported, perfil devolve Rom { offset: 4227072 }`; revertido →
`git diff` baleiro e **76 passed · 0 failed · 9 ignored**.

### 8.2 Atopado de endurecemento: un bucle que colgaba

Antes de `4958a2b`, se a anchura de espello e a fórmula de offset non eran
consistentes, `read` facía un bucle infinito **sen panic** — o banco de probes
colgaba en M2b en vez de fallar. Converteuse en `debug_assert!(run >= 1)` cos
cinco perfis, e M2b re-demostra agora un panic nomeado. Un colgamento non é un FAIL:
un banco que pode colgar non é un banco discriminativo.

---

## 9. Inventario e propiedade

**Diff vs base `9b27941` (incluíndo este relatório): 36 ficheiros, `A` nos 36,
16 415 liñas engadidas, 0 modificadas, 0 borradas.** Ningún ficheiro compartido,
ningún manifest do produto, ningún lockfile do produto, ningún módulo do
integrador, ningunha UI, ningún harness IPC/E2E, ningún Memory Bank, ningún
corpus BYOR. O reconto era de 35 ficheiros / 15 981 liñas até `06cb1aa`;
`git diff --name-status 9b27941 | awk '{print $1}' | sort | uniq -c` dá
`36 A` e nada máis.

| Zona | Liñas | Ficheiros |
|---|---|---|
| `src/` (11 módulos, biblioteca) | 1 888 | md_common 77 · region 56 · error 54 · state 122 · snes_common 137 · md_linear 208 · md_ssf2 341 · snes_lorom 214 · snes_hirom 225 · snes_exhirom 291 · lib 163 |
| `tests/` (10 suites) | 4 110 | differential 672 · snes_exhirom_rules 658 · snes_hirom_rules 585 · snes_lorom_rules 504 · md_ssf2_rules 460 · byor 356 · inversion 270 · ssf2_writes 259 · md_linear_rules 194 · harness_selfcheck 152 |
| `tests/support/` (7, só tests) | 1 677 | vectors 595 · windows_engine 484 · json 335 · sha256 94 · fixture 75 · conv 69 · mod 25 |
| `vectors/` (2, entradas pinadas) | 7 762 | rust-vectors-v1.json 7 551 · windows-generated.json 211 |
| `docs/rex_profiles/addressing_runtime/` (3) | 836 | CONTRATO.md 233 · MUTATION-CONTROLS.md 213 · este relatório 408 |
| `README.md` + `Cargo.toml` + `Cargo.lock` do paquete | 100 + 17 + 7 | — |

Suma de código Rust: 1 888 + 4 110 + 1 677 = **7 675 liñas**, das cales 5 787
son de tests (76 %).

Non se creou `data/rex_profiles/addressing_runtime/`: non fixo falta fixture
novo (as fixtures re-derívanse do PRNG spec; a ROM real léese en BYOR sen
copiala).

---

## 10. Plan de adaptación ao produto (sen tocar nada compartido)

Este é o camiño para que `rex-addressing` deixe de ser illado. **Ningún paso
está executado**: cada un require a decisión do integrador e aprobación do
operador.

1. **Promoción a crate do workspace.** `scripts/check-tree.cjs:12` ten
   `allowedDirs = [.github, data, docs, src, src-tauri, toolchains, scripts]`:
   un `crates/` na raíz faría fallar `npm run check:tree`. Polo que mover o
   paquete a `crates/rex-addressing/` require tocar `check-tree.cjs` e
   `docs/08_TREE_ARCHITECTURE.md`. **Non o fago eu**: son ficheiros
   compartidos. Alternativa sen tocar a árbore: deixar o paquete onde está e
   consumilo cunha `path` dependency — o `src-tauri/Cargo.toml` do produto non
   ten sección `[workspace]` hoxe, así que unha dependencia de ruta non a
   require.
2. **Consumo desde `src-tauri`.** Engadir `rex-addressing` ao `Cargo.toml` do
   produto toca un manifest compartido e a `Cargo.lock` → só o integrador, con
   auditoría (`cargo audit --file src-tauri/Cargo.lock`) porque engade un
   paquete ao grafo.
3. **Costura coa UI contextual.** A UI contextual da camada composta xa resolve
   cliques no núcleo (commits `896a372`/`9b27941`). A tradución de enderezos é o
   que falta para que un clique en `$0x??????` se resolva a offset de ficheiro.
   Require decidir **cal perfil** se aplica — e esta biblioteca
   deliberadamente **non** detecta mapas, así que a detección segue sendo
   problema do produto (`corpus-identification` segue `blocked`).
4. **Capas que non cambian:** os erros estruturados (`AddressingError { code,
   detail }`) están deseñados para serializar; non hai `Result` con "offset 0
   como erro", así que a UI non pode confundir fallos con byte válido.
5. **Licenza:** `UNLICENSED` + `publish = false`. Se o produto quere publicar,
   hai que resolver licenza antes — as specs consultadas son GPL-3.0 /
   BSD-custom non comercial; non se transcribiu código, pero a decisión é
   legal, non técnica.

---

## 11. Commits, base e dependencias do PR

Rama `codex/rex-rust-addressing`, base `9b27941` (punta de
`codex/rex-context-aplib-tilemap`). 15 commits propios até `06cb1aa`, todos
sobre as 36 rutas de §9 (o commit que trae este relatório é o 16º):

```
d9455bc docs(rex): contrato da biblioteca Rust rex-addressing (fase 5) antes de implementar
b0c422f test(rex): banco de probes Rust sen Node, con referencia independente xa verificada
375b487 feat(rex): perfil md-linear en Rust, verde contra vectores e referencia
faefe39 feat(rex): perfil md-ssf2 en Rust, co estado de bancos e escritas puras
f60bbec feat(rex): perfil snes-lorom en Rust, con política de estado propia dos SNES
cd41955 feat(rex): perfil snes-hirom en Rust, con lecturas que emenden bancos
71726fa feat(rex): perfil snes-exhirom en Rust, pechando os cinco perfis
5d07a06 test(rex): segunda referencia para invert, e preimage exaustivo #[ignore]
4958a2b fix(rex): gardar corredor baleiro nos bucles de lectura dos cinco perfis
6f3194e test(rex): preimage exaustivo distingue offset sen preimage de aliases de mais
705afba docs(rex): sete controles de mutacion con output literal, cada un revertido a verde
c27cb91 test(rex): evidencia BYOR cunha imaxe real, con identidade comprobada
a36e0be docs(rex): README do paquete, doc-tests de uso e tres correccions do contrato
ef5ab1a test(rex): a referencia independente declara que casos non modela
06cb1aa docs(rex): controles de mutacion re-verificados na árbore entregada
```

**Dependencias do PR:**

- **Base:** `9b27941`. Non depende de `origin/main` (o merge-base con
  `origin/main` é `4377914`, anterior), e non debe rebasearse a main sen
  decisión do integrador.
- **Dependencia de coñecemento (non de código):** os vectores pinados veñen de
  `RDS-REX-A-addressing` @ `9ec21ac`, ficheiro con SHA `da09b5b2…e048`,
  **vendorizado byte a byte** (§3) para que o PR sexa auto-contido. Se o
  integrador prefire non vendorizar, o PR convértese en dependente de que a
  rama `codex/rex-a-addressing` entre primeiro — é a única alternativa real, e
  hai que escoller entre as dúas.
- **Non depende** do traballo do axente B (codecs), nin da UI, nin do
  `src-tauri` do integrador.

---

## 12. Divulgacións obrigatorias

1. **Dous erros tipográficos en mensaxes de commit, a propósito.** `71726fa`
   ten "非 `0x3FFF0`" no corpo e `6f3194e` ten "as dúasdirections". Corrixir
   sería `git commit --amend` sobre commits xa descritos, e a regra da sesión
   prohibe emendar sen ordem expresa. Quedan aquí rexistrados; o código e os
   docs non teñen esas cadeas (verificouse: `非` non aparece en ningunha ruta
   do repo).
2. **Unha garda borrada por un revert.** O `git checkout --` do control M2
   levou consigo a garda `run >= 1` de `src/snes_exhirom.rs` (estaba sen
   commiter). Detectouse ao reler o ficheiro, re-engadiuse en `4958a2b` e
   re-demostrouse como M2b. Lección de proceso: un revert só é seguro sobre
   árbore limpa, e nese momento non o estaba.
3. **Atopado do colgamento** (§8.2): o banco de probes podía colgar en vez de fallar.
   Agora é panic nomeado.
4. **Catro ficheiros que `CONTRATO.md` §11 prometía e que non existen co nome
   prometido:** `tests/oracle.rs`, `tests/limits.rs`, `tests/inversion.rs`
   (existe, outro contido) e `tests/exhaustive.rs`. O que a táboa describía
   como ficheiros separados vive en `differential.rs` + `windows_engine.rs` +
   os `*_rules.rs`. **Non creei ficheiros baleiros para que a táboa fose
   certa**; §11 reescrito en `a36e0be` coas localizacións reais e unha nota
   "Desviación rexistrada da propia táboa".
5. **Non se executaron** `npm run host:diagnose`, `host:certify`, builds do
   produto, emuladores, nin MAME: o encargo prohibeo a este axente e o cambio
   non toca build/emulación/toolchain do produto. A barra mínima de AGENTS.md
   aplícase ao produto; este paquete é illado e auto-contido, e a súa barra é
   fmt + clippy + test, toda verde (§4).
6. **Non se fixo merge, nin release, nin promoción**, e non se tocou o checkout
   canónico. O `MEMORY.md` do proyecto foi modificado por outra sesión durante
   a rodada; non o alterei.
