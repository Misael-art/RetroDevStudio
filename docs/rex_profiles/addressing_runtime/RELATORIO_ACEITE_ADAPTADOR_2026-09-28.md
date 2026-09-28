# Informe de rolda — auditoría dos `.expect()` e aceite do adaptador (2026-09-28)

**Árbore.** Worktree `/home/misael/RDS-REX-A2-RUST-ADDR`, rama
`codex/rex-rust-addressing` (a da PR #82, `OPEN`). Base desta rolda: `30cb311`
(punta da rolda da capa de recursos). Commits publicados aquí:

| Commit | Contido |
|---|---|
| `0a371b7` | `tests/acceptance.rs`, `vectors/acceptance-v1.json` e as correccións neutras en `src/` |
| `d7e3925` | `INVARIANTES.md`, `ACEITE-ADAPTADOR.md`, sección R5–R8 de `MUTATION-CONTROLS.md`, táboa de recontos do `README.md`, nota en `CLASSIFICACION.md` |
| `cc8026c` | corrixe dous números do propio informe de invariantes (16→17 filas; 277 152→277 610) |
| o seguinte a este ficheiro | este informe |

Non se tocou o checkout canónico, non se reescribiron commits previos, non se
fixo merge nin release, e a clasificación segue sendo **Experimental** para os
cinco perfís demostrados.

## 1. Gate medido nesta árbore (executado, non de memoria)

Todo con `CARGO_TARGET_DIR=/tmp/rex-a2-target` (sen target compartido co
produto), `--offline`, sen emuladores e sen `host:certify`.

| Comprobador | Resultado |
|---|---|
| `cargo fmt -- --check` | saída 0, sen diff |
| `cargo clippy --offline --all-targets -- -D warnings` | `Finished 'dev' profile`, cero avisos |
| `cargo test --offline` | **138 pasados · 0 fallos · 10 `#[ignore]`**, 17 filas de resultado |
| `cargo test --offline --test acceptance` | 11 pasados · 0 fallos · 1 `#[ignore]` (o xerador) · 5.08 s |
| `cargo test --offline --test no_panic_sweep -- --nocapture` | **277 610 chamadas · 0 pánicos** (47 312 + 62 528 + 59 756 + 57 882 + 48 412 + 1 720) |
| `cargo run --offline --example resource_report` | `lecturas=13 recusas=14` e `resumo sha256=27bebc7b4f83cbf66baaff0a9968bb5055729f015da2079e3c04ab7d13774c8f` — idéntico ao documentado |
| `sha256sum vectors/acceptance-v1.json` | `54ba2b6e864c53ba69228b51d0a4cf079735182ad875ecb8e98b6dbbf257a216` = o SHA pinado en `tests/acceptance.rs` e nos dous documentos |

Delta fronte a `30cb311` (127/0/9, 16 filas): exactamente os 11 probes do
aceite e o seu xerador `#[ignore]`. Ningún test existente mudou de resultado.

## 2. Auditoría dos 15 `.expect()` de produción

Informe completo en `INVARIANTES.md`. Resumo do veredicto:

- **Os 15 son inalcanzables por entrada externa.** Ningún dato do chamador
  —imaxe, enderezo, lonxitude, estado do mapper, límite— pode facer fallar un
  só. Agrúpanse en seis razóns estruturais (5 + 2 + 1 + 3 + 3 + 1 = 15):
  delegación en `validate_state` (grupo 1, 5 sitios), o corredor cabe na xanela
  (2), a base filtrada está dentro da máscara `keep = mask >> 19` (1), a
  lectura non sae do bus (3), o corredor cabe na súa cela (3) e o candidato é
  un `rem_euclid` de `half2` (1).
- **Un sitio tiña xustificación falsa**, non inalcanzabilidade:
  `src/snes_exhirom.rs:181` afirmaba que o candidato "cabe en 16 bits", que é
  mentira (o banco pode superar 16 bits). Corrixese a **mensaxe**, non o código:
  o invariante real é `half2 ≤ 4 MB < 2^32`.
- **Non se eliminou ningún `expect` mecanicamente.** Son gardas de invariante
  interno e o resto do camiño vai sen comprobacións redundantes porque existen.
- **Non houbo ningún corrección con erro estruturado**, porque non se atopou
  ningún camiño alcánzabel. A varredura de 277 610 chamadas é **evidencia
  complementaria**: un `expect` que non se alcanza nos enderezos sondados
  tampouco está probado, así que cada sitio se xustifica lendo o chamador.
- Ámbito en release dos 5 `debug_assert!`: rexistrado, con constancia de que o
  gate roda en debug e de que a crate non depende deles para a corrección.

Tres obrigas que o adaptador **non pode delegar** na crate (en `INVARIANTES.md`
§"Obligacións do adaptador"): a crate non hashea a ROM (a identidade verifícaa
o adaptador na fronteira de bytes); `Limits` non é unha canle de protección
contra DoS de memoria agás `max_segments`; e `PhysicalSegment.state` clónase por
segmento, polo que non debe vialear enteiro por IPC.

## 3. Vectores de aceite para o adaptador

15 casos en `vectors/acceptance-v1.json` + `tests/acceptance.rs`. Detalle e
comandos en `ACEITE-ADAPTADOR.md`. As 8 entradas que pedía a misión:

| Entrada pedida | Caso |
|---|---|
| lectura simple | `A1-lectura-simple-md-linear` |
| lectura atravesando fronteira permitida | `A2-fronteira-de-xanela-ssf2` |
| aliases | `A3-alias-mesma-imaxe` |
| rexión non-ROM | `A4-rexion-non-rom-tras-ROM` |
| intervalo e tamaño inválidos | `A5a` (lonxitude 0), `A5b` (fora do barramento), `A5c` (`max_bytes`), `A5d` (`max_segments`), `A5e` (imaxe curta) |
| troca SSF2 que modifica a xanela esperada | `A6-secuencia-ssf2-remapeo` (antes → escrita `0xA13003 ← 5` → despois → xanela non afectada) |
| dúas instancias de mapper sen compartir estado | `A7a-instancia-con-banco` + `A7b-instancia-sen-banco` |
| procedencia que reconstrúe exactamente os bytes | `A8-procedencia-reconstrue` |

Engádense dous que a misión non pedía pero que a fronteira real necesita:
`A9-estado-alleo-bad-state` (clave de mapper nun perfil sen rexistradores) e
`A10-capacidade-digesto-non-verificado` (a capa comproba a *forma* do digesto,
non que sexa o SHA-256 deses bytes).

**Independencia do esperado.** As expectativas non chaman á función que proban:
os offsets físicos veñen do motor de xanelas declarativas
(`tests/support/windows_engine.rs`, táboa `boards.bml` de bsnes con SHA
`2de90492…`); os cortes de corredor aplícaos `estender_corrida` reproducindo
CONTRATO §7; a orde de políticas lévese de §12.3; os bytes da imaxe xeran pola
regra publicada `banked-byte-at-v1`. Cada caso leva o seu `que_proba` en
linguaxe natural para que o integrador poida disprobel sen fiarse da narración.

**Un defecto de deseño atopado ao montar o aceite.** As imaxes con bancos tiñan
que ser de 4 MB. Nunha imaxe de 2 MB a máscara de SSF2 recorta
`5 << 19 = 0x280000` a `0x80000`, que é xustamente a identidade da xanela 1: o
remapeo era **indistinguible de non remapear** e os casos A6/A7a/A7b/A8 pasaban
en vacío. Corrixido movendo eses casos a `IMAXE_4M` e reforzando A6 con
antes/despois + xanela afectada/nunca tocada. Esto está documentado en
`ACEITE-ADAPTADOR.md` e é o motivo polo que R6 tamén o detecta.

## 4. Gradación R5–R8 (o aceite non pasa en vacío)

Cuatro mutacións de **un só sitio**, cada unha coa saída literal do FAIL,
revertida cun `git diff --stat src/` baleiro despois, e ningunha chegou a un
commit. Detalle en `MUTATION-CONTROLS.md` §"Rolda do aceite (R5–R8)":

| ID | Simula | Detección |
|---|---|---|
| R5 | o límite de corredores non se aplica (`resource.rs:464` `>=` → `>`) | 1 probe do aceite (A5d) |
| R6 | pérdese a identidade de xanela cando `banks` non a nomea (`md_ssf2.rs:117`) | 3 probes (A2, A7b, o caso alterado) |
| R7 | imaxe curta clasifícase como rexión non-ROM (`resource.rs:504`) | 1 probe (A5e) + a lista de códigos pinada |
| R8 | a forma do díxito xa non se valida (`resource.rs:381`: admitir maiúsculas) | **só** `a_capa_non_pode_verificar_o_digesto` en toda a suite |

## 5. Correccións de texto e contaxes

- `README.md` da crate: os recontos van agora **etiquetados coa árbore** onde se
  mediron (`30cb311` → 127/0/9/16 filas; esta árbore → 138/0/10/17 filas), máis
  a fila `acceptance | 11 (+1 #[ignore])` na descomposición.
- Corríxese a afirmación de `mod support;`: inclúe a autocomprobación da fixture
  compartida en **14 dos 15** binarios de integración (`no_panic_sweep` é o que
  non); estaba escrito "13 dos 14".
- `src/state.rs` (`**não**` → `**non**`, "convierte" → "converte"),
  `src/region.rs` (`///rexión` → `/// rexión`, `roteada` → `rotada`),
  `src/md_common.rs`, `src/md_ssf2.rs` (`roteada` → `rotada`) e
  `tests/support/mod.rs` ("Infraestructura" → "Infraestrutura"): só comentarios,
  cero liñas de código cambiadas. Comprobado co `git diff` filtrado: a única
  liña non comentada de todo o commit `0a371b7` en `src/` é a cadea do `expect`
  de `snes_exhirom.rs:181`.

## 6. Dependencias e SHA final

- **Dependencias novas: cero.** `Cargo.toml` ten `[dependencies]` e
  `[dev-dependencies]` baleiros; o aceite, o oráculo, o SHA-256 e o parser de
  JSON son código de test propio. Non se introduo `sha2`, `serde` nin nada
  semellante.
- Sen redeseño de API: `CONTRACT_VERSION = 1`, `BUS_LIMIT = 0xFFFFFF`, os cinco
  `PROFILE_ID` e a forma do JSON de aceite (`rex-acceptance-v1`) non mudaron.
- `license = "UNLICENSED"`, `publish = false` sen cambios.
- SHA final desta rolda: os tres commits da táboa de cabeceira máis o commit
  deste informe. A punta remota da rama antes de publicar era `f0a9538`;
  quedan por publicar 5 commits da rolda da capa de recursos (`57e51d3`,
  `58a06dd`, `f9c1913`, `13c48ad`, `cae6b58`), 3 de docs desa mesma rolda
  (`981e177`, `dedb884`, `30cb311`) e os catro desta rolda: 12 commits cando
  saia o push.

## 7. Que queda en mans do integrador

Registrado expresamente, porque non depende de min:

1. **A proposta de adaptador non está publicada.** O paso 5 da misión (revisar
   a adaptación cando exista) queda **agardando**: non se pode revisar o que
   non existe, e non se escribiu nada no checkout canónico.
2. As cinco preguntas de sinatura de `ADAPTACION.md` §6 seguen **abertas**:
   ruta do `Cargo.toml`, o adaptador en si, o DTO, a fronteira IPC e os límites
   operativos. Son decisións del; non se aplicou ningunha suxestión por miña
   parte, só se deixan escritas as opcións e os seus efectos.
3. **Non se editaron ficheiros del** sen transferencia explícita de propiedade.
4. Pendente a evidencia cara (hai que concertala, unha pesado por vez):
   `cargo test --release --offline --test no_panic_sweep`, para o ámbito en
   release da garda `run >= 1`.
