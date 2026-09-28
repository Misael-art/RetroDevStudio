# Informe da capa de lectura de recursos — rolda completa (2026-09-28)

Árbore verificada: rama `codex/rex-rust-addressing` no worktree
`/home/misael/RDS-REX-A2-RUST-ADDR`, commits `57e51d3..cae6b58` sobre a base
`9b27941` (que é tamén a base do PR #82, cuxa punta remota está en `f0a9538`).
Cinco commits desta rolda: `57e51d3` (etapa 1), `58a06dd` (etapa 2), `f9c1913`
(etapa 3), `13c48ad` (etapa 4), `cae6b58` (etapa 5).

Clasificación de todo o entregado: **Experimental**, limitada aos cinco perfís
demonstrados. Ningunha palabra do roadmap se promotiona; non se fixo merge, nin
release, nin cambio no checkout canónico.

## 1. Executado de novo nesta rolda (con saída literal)

Todo o bloque é `cargo` sobre `CARGO_TARGET_DIR=/tmp/rex-a2-target`, sen target
compartido co produto e sen emuladores.

| Comprobador | Resultado desta rolda |
|---|---|
| `cargo fmt -- --check` | saída 0 (sen diff) |
| `cargo clippy --offline --all-targets -- -D warnings` | saída 0, cero avisos |
| `cargo test --offline` | **127 pasados · 0 fallos · 9 `#[ignore]`**, 16 filas de resultado (15 targets + doc-tests) |
| `cargo test --offline` repetido ×4 | 127/0/9 nas catro: tres para a estabilidade do detector novo e unha tras a última revisión de texto (ver `MUTATION-CONTROLS.md` §R1) |
| `cargo test --release --offline --test inversion -- --ignored` | 1 pasado · 7 casos · 8.22 s |
| `cargo test --offline --test byor -- --ignored` | 8 pasados · 0 fallos · 0.19 s |
| `cargo run --offline --example resource_report` | `lecturas=13 recusas=14` e `resumo sha256=27bebc7b4f83cbf66baaff0a9968bb5055729f015da2079e3c04ab7d13774c8f` (idéntico ao documentado en `EXEMPLO-CONSUMIDOR.md`, executado dúas veces máis) |
| `cargo test --offline --test no_panic_sweep -- --nocapture` | 277 610 chamadas, 0 pánicos (desglose abaixo) |
| Mutacións R1–R4 | catro FAIL literais, catro reverts con `git diff --stat src/` baleiro |

Desglose da varredura adversaria (chan derivado do dominio, non do resultado):

| Varredura | Chamadas | Pánicos | Clases de resultado exercitadas |
|---|---|---|---|
| `md-linear` | 47 312 | 0 | 10 |
| `md-ssf2` (inclúe páxina de rexistros `0xA13000..=0xA130FF` × 11 datos e cada estado derivado) | 62 528 | 0 | 13 |
| `snes-lorom` | 59 756 | 0 | 13 |
| `snes-hirom` | 57 882 | 0 | 11 |
| `snes-exhirom` | 48 412 | 0 | 11 |
| capa de recursos (atestación, límites, secuencias) | 1 720 | 0 | 6 (`recusa/BadAttestation`, `BadState`, `IncompatibleSize`, `InvalidRange`, `LimitExceeded`, `NonRomRegion`; `Ambiguous` **non** aparece, e iso tamén se afirma) |

Controis de mutación desta rolda (detalle completo e saída literal en
`MUTATION-CONTROLS.md`, §"Rolda da capa de recursos"):

| ID | Simula | Onde o detectan |
|---|---|---|
| R1 | invariante dos `.expect()` falso (`md_linear.rs:33` afrouxado) | 3 das 8 probes da varredura; 1 553 216 pánicos en 1 725 576 chamadas |
| R2 | banco equivocado (`md_ssf2.rs:117`, `window + 1`) | 4/14 `md_ssf2_rules` + 5/11 `resource_fixtures` + 3/15 `resource_reader` |
| R3 | fronteira equivocada (`md_ssf2.rs:303`, `window + 2`) | 1/14 + 2/11 + 2/15; un segmento chega a proclamar `cpu_len: 524296` |
| R4 | procedencia que mente (`resource.rs:479`, `rom_offset: cursor`) | 7/11 + 4/15, **co bytes correctos**: só a ve quen lea a procedencia |

## 2. Evidencia herdada (non se volveu xerar)

Separamos o que se re-executou do que segue sendo evidencia dunha rolda anterior,
porque unha parte do gate re-execútase pero as súas entradas non se re-obtêm:

- **Os 565 vectores pinados e a táboa do motor de referencia**: re-execútase contra
  eles (`differential` = 8 probes verdes), **non** se re-exportaron. As súas
  orixes e SHA están fixadas en `tests/support/*.rs` e no relatorio do
  2026-09-27; a regra do host segue a exigir orixe inmutábel con SHA-256, así que
  re-exportar desde `boards.bml` seria volver tocar a cadea de procedencia sen que
  ninguén o pedise.
- **A corrección histórica de HiROM** (`b952329`) e o **endurecemento do corredor
  baleiro** (`4958a2b`): hérdanse; o que si se repetiu foi o control M2b que os
  motivou (dentro dos `*_rules.rs` que volven estar verdes).
- **Os seis controles de mutación M1–M6 da rolda anterior**: non se volveron
  aplicar. O único re-verificado sobre `HEAD` daquela foi M3, e iso consta na súa
  propia sección. As catro mutacións novas (R1–R4) **non** as substitúen: son da
  capa de recursos, non dos perfís.
- **Clasificación dos chips especiais SNES** (DSP1/SA1/SuperFX/CX4/BS-X, BBRAM,
  SDD-1, ExLoROM) e do `> 8MB` en ExHiROM: segue sendo **non suportado por
  decisión de contrato**, sen corpus que o demonstre; non se executou nada novo.
- **`npm run check:tree`, `host:diagnose`, `host:certify` e a validación manual
  con dependencias oficiais**: son portas do integrador na árbore canónica e
  ségueno sendo. Esta rolda non abriu o checkout canónico nin tocou o seu
  `target/`, así que non hai resultado seu que reportar.

## 3. Reprodución, copia e pega

```bash
cd /home/misael/RDS-REX-A2-RUST-ADDR/scripts/rex_profiles/addressing_runtime/rex-addressing
export CARGO_TARGET_DIR=/tmp/rex-a2-target

cargo fmt -- --check                                                     # → sen saída
cargo clippy --offline --all-targets -- -D warnings                      # → Finished, 0 avisos
cargo test --offline                                                     # → 127 passed; 0 failed; 9 ignored
cargo test --offline 2>&1 | grep 'test result'                           # → 16 filas; a suma dá 127/0/9
cargo test --release --offline --test inversion -- --ignored             # → 8.22 s, 1 pasado
cargo test --offline --test byor -- --ignored                            # → 0.19 s, 8 pasados
cargo run --offline --example resource_report | tail -3                  # → resumo sha256=27bebc7b…
cargo test --offline --test no_panic_sweep -- --nocapture | grep '^\['   # → 277 610 chamadas, 0 pánicos
```

Unha nota sobre `git diff`: as catro mutacións aplicáronse e **retiráronse** con
`git checkout -- <ficheiro>`, e a árbore de `cae6b58` non contén ningún
deses catro parches. Pódese comprobar con `git log -p -S 'unwrap_or(0x1_0000)' --oneline`,
que non dá commits.

## 4. Que **non** alega esta entrega

- Non hai integración ao produto: sen dependencia por path en `src-tauri`, sen
  adaptador, sen chamada real polo backend, sen fluxo pola interface. A proposta
  está en `ADAPTACION.md` e di explicitamente «PROPOSTA. Nada do que hai aqui está
  aplicado».
- Non é descuberta automática de mapper nin identificación automática de recursos:
  quen chama fornece perfil, estado e rango.
- O `achado_de_revisao` que o integrador me devolveu (15 `.expect()` sen varredura
  adversaria no gate) queda tratado por `tests/no_panic_sweep.rs`; **non** se
  cambiou ningún `.expect()` de produción, e esa é a razón de que o control R1
  afrouxa a validación no canto de tocar os `expect`.
- A varredura proba **ausencia de pánico e estrutura de recusa**, non contido: o
  contido con oráculo independente vive en `tests/resource_fixtures.rs`.

## 5. Pendente para o integrador

1. As cinco preguntas de asinatura de `ADAPTACION.md` §6 (linguaxe do DTO, forma
   do erro, exposición de `read_sequence`, `serde` na crate ou no adaptador, quen
   elixe perfil/estado na interface). A crate non fixa ningunha desas decisións.
2. A ruta: o tronco xa ten `crates/rex-addressing/` promotionado desde os meus
   commits, e esta rama segue entregando en
   `scripts/rex_profiles/addressing_runtime/rex-addressing/`. A receta de
   aplicación (cherry-pick `-x` por entrega + o movemento de ruta, que lle
   pertence) está en `ADAPTACION.md` §1.
3. `maturidade` e `nao_alega` de `crates/registry.json`: esta rolda engade capa de
   lectura + exemplo consumidor + varredura, e **non** cambia a condición de
   «non integrado». O texto do Memory Bank proponse en `ADAPTACION.md` §7, non se
   aplica desde esta rama.
