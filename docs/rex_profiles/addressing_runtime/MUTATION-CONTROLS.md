# Controles discriminativos (mutación → FAIL → revert → PASS)

Obxectivo: demostrar que a batería de probes **rexeita** unha alteración
representativa incorrecta, non só que acepta a boa. Un test que nunca falla non
evidencia nada; aquí queda o output literal de cada fallo.

## Método

1. Ábrese o worktree (`/home/misael/RDS-REX-A2-RUST-ADDR`, rama
   `codex/rex-rust-addressing`) cunha árbore **limpa** sobre o commit base.
2. Applícase **unha** mutación nun único sitio do `src/` (nunca máis dun).
3. Ródase a batería (`cargo test --offline`, debug, `CARGO_TARGET_DIR=/tmp/rex-a2-target`)
   e guárdase o output literal do fallo.
4. Desfírase c`git checkout -- <ficheiro>` e vólvese rodar: **72 passed, 0 failed,
   1 ignored**.

As sete execucións deste ficheiro rodáronse sobre a árbore de `6f3194e`, cando a
batería rápida tiña 72 probes. Despois engadíronse os 4 doc-tests de `src/lib.rs`
e os 8 probes `#[ignore]` de `tests/byor.rs`; na árbore final o mesmo comando dá
**76 passed, 0 failed, 9 ignored** (verificado en `ef5ab1a`, §"Reprodución" abaixo).

Ningunha mutación chegou a `HEAD`: cada `git diff` posterior ao revert estivo
baleiro, e os commits listados en `git log` non conteñen ningunha desas mutacións.

## Índice

| ID | Perfil | Sitio mutado | Comportamento incorrecto simulado | Que o detecta |
|----|--------|--------------|-----------------------------------|---------------|
| M1 | snes-hirom | `src/snes_hirom.rs:116` | fórmula de inversión **anterior á corrección histórica** (2026-09-25) | vectores pinados |
| M2 | snes-exhirom | `src/snes_exhirom.rs:132` | espeillar a área 2 por `rom_size` en vez de `half2` | vectores pinados + 6 probes manuais |
| M2b | snes-exhirom | `src/snes_exhirom.rs:252` | anchos de espeillo intercambiados entre áreas na lectura | panic da garda `run >= 1` + desbordamento |
| M3 | snes-exhirom | `src/snes_exhirom.rs:93` | aceptar un `rom_size` cuxa segunda área non é potencia de 2 | caso negativo pinado + probe manual |
| M4 | md-ssf2 | `src/md_ssf2.rs:218` | decodificar a xanela de rexistro cos bits erróneos | casos de escrita + secuencias pinadas |
| M5 | md-linear | `src/md_linear.rs:178` | calar (clamp) unha imaxe curta no canto de erro `OutOfRange` | caso de lectura pinado |
| M6 | md-linear | `src/md_linear.rs:68` | devolver `Rom { offset: 0 }` cando o estado é rexeitable | caso negativo pinado + probe manual |

Cobertura por mecanismo: validación de estado (M3, M6), fórmula de inversión
(M1, M2), anchura do espeillo na lectura (M2b, M5), estado do mapper (M4).
Cada un fallou; ningún pasou desapercibido.

## M1 — HiROM: a fórmula anterior á corrección histórica

Mutación (restaurar o ramo pre-`b952329`):

```rust
// de
if is_half_bank(bank) && (HIGH_HALF..0x1_0000).contains(&rel) {
    aliases.push((bank << 16) + rel);
}
// para
if is_half_bank(bank) && rel < HIGH_HALF {
    aliases.push((bank << 16) + HIGH_HALF + rel);
}
```

```
test snes_hirom_concorda_cos_vectores_pinados_e_co_motor_de_referencia ... FAILED
thread 'snes_hirom_concorda_cos_vectores_pinados_e_co_motor_de_referencia' panicked at tests/differential.rs:275:17:
assertion `left == right` failed: snes-hirom / offset 0x000000 em 1MB: apenas 8 bancos completos (b&0xF=0 em 40-7D/C0-FF); metade alta nunca ve offset < start+0x8000
  left: [32768, 1081344, 2129920, 3178496, 4194304, 5242880, 6291456, 7340032, 8421376, 9469952, 10518528, 11567104, 12582912, 13631488, 14680064, 15728640]
 right: [4194304, 5242880, 6291456, 7340032, 12582912, 13631488, 14680064, 15728640]
test result: FAILED. 6 passed; 1 failed; 0 ignored
```

Léase: a vella fórmula **invénta 8 aliases** de metade alta e **perde ningún**;
é dicir, un mapa incorrecto pero verosímil. Este é o motivo polo que a
corrección histórica importa e por que os vectores pinados non poden ser
anteriores a ela (probado tamén por procedencia: `b952329` 08:45:48 é ancestro
de `9ec21ac` 09:12:23, o export dos vectores).

## M2 / M2b — ExHiROM: o espello é por metade, non por tamaño total

M2 (`% half2` → `% size`):

```
test snes_exhirom_concorda_cos_vectores_pinados_e_co_motor_de_referencia ... FAILED
panicked at tests/differential.rs:218:9:
assertion `left == right` failed: snes-exhirom / inicio do banco cheio 40: area 2 identidade em 8MB
  left: Rom { offset: 8388608 }
 right: Rom { offset: 4194304 }
```

Ademais caen 6 probes manuais (`area_dous_base_catro_megabytes_e_espeello_mod_half2`,
`bancos_completos_non_deixen_ver_o_espello_wram`, `invert_aliases_da_area_dous_co_espeello`,
`lectura_wrap_da_area_dous_no_tamanho_declarado`, `lectura_emende_bancos_e_corta_na_fronteira_da_área`,
`lectura_rexeita_antes_de_reservar`). O offset devolto, `8388608`, é
**exactamente `rom_size`**: fóra da imaxe. Unha ferramenta de patches que
confiase nisto escribiría máis alá do EOF.

M2b (intercambiar os dous ramos de `left_in_mirror` en `read`,
`src/snes_exhirom.rs:252`):

```
test lectura_rexeita_antes_de_reservar ... FAILED
panicked at src/snes_exhirom.rs:253:21: attempt to subtract with overflow
test lectura_imaxe_curta_prefixo_e_erro ... FAILED
panicked at src/snes_exhirom.rs:253:21: attempt to subtract with overflow
test lectura_wrap_da_area_dous_no_tamanho_declarado ... FAILED
panicked at src/snes_exhirom.rs:253:21: attempt to subtract with overflow
test lectura_emende_bancos_e_corta_na_fronteira_da_área ... FAILED
panicked at src/snes_exhirom.rs:259:17: corredor baleiro: a fórmula de offset e a anchura do espeillo non son consistentes
test result: FAILED. 11 passed; 4 failed; 0 ignored
```

**Achado de endurecemento (commit `4958a2b`).** A primeira vez que se rodou
M2b aínda non existía a garda: `run` quedaba en `0`, o cursor non avanzaba e
`read` **entraba en bucle infinito**; a execución matouse por timeout (>10 min)
e non por un fallo de test. Agora os cinco bucles de lectura levan
`debug_assert!(run >= 1, …)`, que converte o hang nun panic co nome do
problema. Un control de mutación que se detecta por timeout é un control que
ninguén vai repetir; a garda faino reproductible en milisegundos.

## M3 — ExHiROM: a segunda área ten que ser potencia de 2

Mutación: `if !half2.is_power_of_two()` → `if false && !half2.is_power_of_two()`.

```
panicked at tests/differential.rs:238:13:
snes-exhirom / rom_size 7MB: half2=3MB nao e potencia de 2 (pad 0xFF a 8MB registrado): agardábase Unsupported, perfil devolve Rom { offset: 4227072 }

panicked at tests/snes_exhirom_rules.rs:66:13:
0x700000 debe rexeitarse
```

Dúas baterías independentes (vectores pinados e probes manuais) detectana. Sen
a comprobación o perfil non fallaba: devolvía `0x407F00`, un offset **dentro** da
imaxe de 7MB, que calquera comparación posterior contra un arquivo de 8MB
normalizado aceptaría. Este é o caso real polo que `rom_size` non pode
asumirse potencia de 2 nin ser inferido do tamaño.

## M4 — SSF2: que bits da páxina de rexistros decodifican a xanela

Mutación: `let window = (cpu_address & 0x0E) >> 1;` → `let window = (cpu_address & 0x07);`.

```
test md_ssf2_casos_pinados_de_write_mapper_register ... FAILED
assertion `left == right` failed: escrever $A130F3=5 remapeia janela 1; traducao seguinte muda: bancos
  left: [(3, 5)]
test md_ssf2_secuencias_de_escrita_pinadas_remapean_e_traducen ... FAILED
assertion `left == right` failed: seq 0: bancos despois da secuencia
  left: [(2, 43), (4, 93), (6, 7)]
test result: FAILED. 6 passed; 2 failed; 0 ignored
```

A escrita remapea a xanela 3 no canto da 1: un estado de mapper **silencioso**
(sen erro, co banco correcto escrito no banco equivocado) e por iso o control
máis parecido cun bug real de emulación.

## M5 — MD linear: imaxe curta é erro, non clamp

Mutación: eliminar o segmento `Segment::Invalid(OutOfRange)` do ramo de imaxe
máis curta que `rom_size`, devolvendo só o prefixo.

```
test md_linear_concorda_cos_vectores_pinados_e_co_motor_de_referencia ... FAILED
assertion `left == right` failed: md-linear / rom menor que rom_size declarado: trecho faltante e out-of-range, sem clamp: reconto de segmentos
  left: 1
 right: 2
```

`left: 1` é a resposta "aceptable" que calquera chamador consumiría sen notar:
prefixo de bytes reais e nada que diga que falta un trecho. Unha ferramenta que
lea ROMs parcheadas non pode distinguir "non hai bytes" de "non se pediron".

## M6 — MD linear: erro disfrazado de offset 0

Mutación: `Translate::Invalid(e)` → `Translate::Rom { offset: 0 }` cando
`validate_state` rexeita.

```
panicked at tests/differential.rs:238:13:
md-linear / mapper_state ausente: agardábase Unsupported, perfil devolve Rom { offset: 0 }

panicked at tests/md_linear_rules.rs:57:9:
estado sen rom_size debe ser Invalid, non Rom { offset: 0 }
```

O offset 0 é o valor por defecto de calquera binding (JSON, C, JS), así que
esta é a mutación que **convertiría un erro nun byte válido da ROM sen
mudar o tipo de retorno**.

## Como repetilos

```bash
cd /home/misael/RDS-REX-A2-RUST-ADDR/scripts/rex_profiles/addressing_runtime/rex-addressing
# exemplo M3: desactivar a comprobación de potencia de 2
sed -i 's/if !half2.is_power_of_two() {/if false \&\& !half2.is_power_of_two() {/' src/snes_exhirom.rs
CARGO_TARGET_DIR=/tmp/rex-a2-target cargo test --offline        # → FAIL co output de arriba
git checkout -- src/snes_exhirom.rs
CARGO_TARGET_DIR=/tmp/rex-a2-target cargo test --offline        # → verde: 72/0/1 na árbore de 6f3194e
                                                                #    76/0/9 na árbore final (ef5ab1a)
```

Rodados con `timeout` explícito no caso M2b: sen a garda a execución cuelga, e
eso forma parte do resultado, non un defecto do procedimiento.

## Re-verificación na árbore entregada

M3 volveu aplicarse e desfacerse sobre `HEAD` (`ef5ab1a`), coa batería xa
ampliada con BYOR e doc-tests. Saída literal do fallo:

```
thread 'snes_exhirom_concorda_cos_vectores_pinados_e_co_motor_de_referencia' panicked at tests/differential.rs:238:13:
snes-exhirom / rom_size 7MB: half2=3MB nao e potencia de 2 (pad 0xFF a 8MB registrado): agardábase Unsupported, perfil devolve Rom { offset: 4227072 }
test result: FAILED. 6 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out
```

E despois de `git checkout -- src/snes_exhirom.rs`, co `git diff` baleiro:

```
76 passed; 0 failed; 9 ignored   (doce binarios: 0 + 8 ignored + 7 + 5 + 1 ignored
                                  + 6 + 13 + 15 + 13 + 11 + 2 + 4 doc-tests)
```

---

# Rolda da capa de recursos (2026-09-28)

Os seis controles anteriores mutuaban os **perfís**. Esta rolda engadiu a capa de
lectura de recursos (`src/resource.rs`) e a súa batería, e o que se pide agora é
que a capa **sexa discriminativa por si mesma**: que un consumidor externo, só coa
API entregada e a procedencia devolta, note un banco equivocado, unha fronteira
equivocada ou unha procedencia equivocada. Por eso as tres mutacións requeridas
(R2, R3, R4) aplícanse ao `src/` e mídese canto cae das baterías de recursos, non
só dos vectores pinados.

Árbore destas execucións: `13c48ad` máis `tests/no_panic_sweep.rs` sen commitear.
Batería nesa árbore: **127 passed, 0 failed, 9 ignored** (16 filas de resultado).

## Índice da rolda

| ID | Simula | Sitio mutado | Detección |
|----|--------|--------------|-----------|
| R1 | o invariante tras os `.expect()` é falso | `src/md_linear.rs:33` (`checked_rom_size(...)?` → `.unwrap_or(0x1_0000)`) | `tests/no_panic_sweep.rs` (3 varreduras FAILED) |
| R2 | banco equivocado (off-by-one na resolución de xanela) | `src/md_ssf2.rs:117` (`bank_value(window, …)` → `bank_value(window + 1, …)`) | 4 + 5 + 3 probes en tres binarios |
| R3 | fronteira de xanela equivocada (o corredor non corta) | `src/md_ssf2.rs:303` (`(window + 1) * WINDOW_SIZE` → `(window + 2) * …`) | 1 + 2 + 2 probes |
| R4 | procedencia que mente (offset físico = enderezo lóxico) | `src/resource.rs:479` (`rom_offset: offset` → `rom_offset: cursor`) | 7 + 4 probes |

Cada mutación aplicouse **nun só sitio**, e tras cada execución `git diff --stat
src/` volveu a estar baleiro (`git checkout -- <ficheiro>`). Ningunha chegou a
ningún commit.

## R1 — varredura adversaria: que o invariante dos 15 `.expect()` se prove

Este é o `achado_de_revisao` que o integrador devolveu (`crates/registry.json`):
os `.expect()` están xustificados pero nada no gate os probaba. O control é o
mínimo: afrouxar a validación que xustifica catro deles.

```rust
// de
let size = state.checked_rom_size(PROFILE_ID)?;
// para
let size = state.checked_rom_size(PROFILE_ID).unwrap_or(0x1_0000);
```

`cargo test --offline --test no_panic_sweep` (log de 4 660 281 liñas en
`/tmp/rex-a2-m1b.log`; extráitanse as dúas filas de resumo):

```
[md-linear] 1725576 chamadas varridas; 1553216 pánico(s); primeiros: ["md-linear :: rom_size=-0 translate 0x0 → validate_state xa aceptou o tamaño: AddressingError { code: Unsupported, detail: \"perfil md-linear: mapper_state.rom_size debe ser un enteiro >= 0, atopado Int(0)\" }", …]
[recursos] 1720 chamadas varridas; 3 pánico(s); primeiros: ["recursos :: boa / md-linear → validate_state xa aceptou o tamaño: AddressingError { code: Unsupported, detail: \"perfil md-linear: mapper_state sen rom_size (enteiro >= 0)\" }", …]

test result: FAILED. 5 passed; 3 failed; 0 ignored
```

Caen `md_linear_nin_un_panico_con_entradas_adversarias`,
`a_validacion_md_caracteriza_o_dominio_dos_expect` e
`a_capa_de_recursos_non_panic_ante_atestacion_e_limites_hostis`. Non é un fallo
por coincidencia de números: o payload do pánico **é a frase que xustifica o
invariante** (`validate_state xa aceptou o tamaño`), que en `src/md_linear.rs` só
aparece nas catro liñas onde viven os `.expect()` (71, 95, 140, 172). Coa
varredura na súa forma boa, o mesmo comando dá `8 passed; 0 failed`.

### Endurecemento atopado ao montar R1: o gancho global de pánico

A primeira versión do detector capturaba a **localización** `ficheiro:liña` cun
`panic::set_hook` global, serializado cun mutex entre as varreduras. Funcionou
repetidas veces en `--test no_panic_sweep` illado, pero **nunha execución de
`cargo test --offline` completo fallou `o_detector_ve_un_panico_inxectado`**.
Causa: `set_hook` é processual e libtest instala/restaura o seu propio gancho
**por fío** para capturar saída; outro fío que remata a súa proba restaura o
anterior por riba do que a varredura tiña posto. A detección (que é o invariante)
non se rompe —`catch_unwind` sempre as capturou— pero a localización si quedaba
sen estar dispoñible, e o output do fallo era ilexible porque a mensaxe acababa no
buffer doutro fío.

Solución aplicada: bórrase o gancho e lése o **payload** do `catch_unwind`
(`fn mensaxe`, en `tests/no_panic_sweep.rs`). Non é un paso atrás: para os
`.expect()` de produción o payload é a frase do invariante, e cada chamada xa leva
a súa etiqueta reconstruible (perfil, forma do estado, enderezo, lonxitude,
imaxe). Como efecto lateral as oito probes deixan de serializarse e o binario
baixa de ~0.49 s a ~0.16 s.

Verificación da estabilidade tras o cambio (mesma árbore, comando idéntico ao que
fallou):

```
$ for i in 1 2 3; do CARGO_TARGET_DIR=/tmp/rex-a2-target cargo test --offline; done
rolda 1: 16 filas de resultado, pasados=127 fallos=0 ignorados=9   (TEST=0)
rolda 2: 16 filas de resultado, pasados=127 fallos=0 ignorados=9   (TEST=0)
rolda 3: 16 filas de resultado, pasados=127 fallos=0 ignorados=9   (TEST=0)
```

Rexistro honesto do límite: unha interacción así non se proba que desapareceu con
tres roldas verdes; o que se pode afirmar é que o mecanismo xa **non depende** de
ningún estado global, así que non pode volver manifestarse do mesmo xeito.

## R2 — banco equivocado: un erro silencioso que a capa de recursos ve

`window_base` pide o banco da xanela **seguinte**. É a mutación máis parecida a un
bug real de mapper: non hai erro, non hai panico, só bytes que non son.

```
tests/md_ssf2_rules.rs         →  4 failed / 14  (banco_fora_do_fin…, inversion_con_bancos…,
                                                   reescrita_substitue_o_valor_do_banco,
                                                   lectura_corta_por_xanela…)
tests/resource_fixtures.rs     →  5 failed / 11
tests/resource_reader.rs       →  3 failed / 15
```

Salientable porque a capa de recursos é a única superficie que consome un integrador externo:

```
assertion `left == right` failed: md-ssf2-4mb-xanela1-banco5: banco 5 na xanela 1 => base (5 and 7) shl 19
  left: [(524288, 65536, 524288)]
 right: [(524288, 65536, 2621440)]

assertion `left == right` failed: só a xanela 3 se remapea
  left: [0, 524288, 1048576, 1572864, 2097152, 2621440, 3145728, 3670016]
 right: [0, 524288, 1048576, 1048576, 2097152, 2621440, 3145728, 3670016]
```

O primeiro é a tripla `(enderezo, lonxitude, offset_físico)` que a fixture deriva
a man das especificacións e que o motor de xanelas declarativas confirma por
separado; o segundo é a propiedade de que escribir un banco **non mova as outras
sete xanelas**. `o_mesmo_enderezo_loxico_dá_bytes_distintos_segundo_o_estado` tamén
cae, así que a recusa detecta o banco malo **polos bytes**, non pola estrutura.

## R3 — fronteira equivocada: o corredor que non corta na xanela

`(window + 1) * WINDOW_SIZE` → `(window + 2) * WINDOW_SIZE`: a lectura segue coa
base da xanela actual máis alá da súa fronteira.

```
tests/resource_reader.rs:361 →
assertion `left == right` failed: [PhysicalSegment { index: 0, cpu_address: 524280, cpu_len: 524296,
rom_offset: 524280, … }, PhysicalSegment { index: 1, cpu_address: 1048576, cpu_len: 524544, … }]
  left: 2
```

Léase `cpu_len: 524296`: un segmento que **proclama 524 296 bytes**, máis do que mide unha
xanela enteira (524 288). Un consumidor que só lea a procedencia (sen tocar os bytes) xa ve que
algo está roto, que é exactamente o criterio final da rolda. Cae ademais en
`md_ssf2_rules` (1/14), `resource_fixtures` (2/11, incluída
`md-ssf2-4mb-porta-xanela-0-1: un segmento por xanela, aínda con bases contiguas`)
e `resource_reader` (2/15, co límite de segmentos).

## R4 — procedencia que mente: bytes ben, orixe mal

`rom_offset: offset` → `rom_offset: cursor` na construción do `PhysicalSegment`
(`src/resource.rs:479`). Os bytes devoltos son **os correctos**; o que minte é a
procedencia. Ningunha comparación de contido pode detectalo: só as probes que
reconstrúen a saída desde os segmentos, e as que afirman offsets concretos.

```
tests/resource_fixtures.rs →  7 failed / 11
assertion `left == right` failed: md-ssf2-4mb-xanela1-banco5: banco 5 na xanela 1 => base (5 and 7) shl 19
  left: [(524288, 65536, 524288)]
tests/resource_reader.rs   →  4 failed / 15
assertion `left == right` failed: dous bancos remapeados á mesma base son dous segmentos distintos
```

Ademais de `a_procedencia_reconstrue_a_saida_byte_a_byte`, caen
`ningunha_lectura_devolve_parciais_como_exitos` e
`secuencia_de_bancos_e_unha_operacion_distinta`, e dúas probes que non miran a
procedencia en absoluto (`os_alias_acada_os_mesmos_bytes…`, `exhirom_fóra_do_contrato…`)
porque comparan o `rom_offset` contra o oráculo. É o control máis incómodo dos
catro: amosa que un adaptador que só devolva `bytes` pola IPC ocultaría este defecto
completamente, e é a razón práctica de que `ADAPTACION.md` esixa `bytes_sha256`
**e** a lista de segmentos no DTO.

## Como repetir calquera deles

```bash
cd /home/misael/RDS-REX-A2-RUST-ADDR/scripts/rex_profiles/addressing_runtime/rex-addressing
# R4: que a procedencia mintan
perl -0pi -e 's/rom_offset: offset,/rom_offset: cursor,/' src/resource.rs
CARGO_TARGET_DIR=/tmp/rex-a2-target cargo test --offline --test resource_fixtures --test resource_reader
git checkout -- src/resource.rs
CARGO_TARGET_DIR=/tmp/rex-a2-target cargo test --offline   # → 127/0/9
```

Para R2 e R3 o mesmo patrón con `bank_value(window, state)` → `bank_value(window + 1, state)`
e `(window + 1) * u64::from(WINDOW_SIZE)` → `(window + 2) * …`, en `src/md_ssf2.rs`.
R1 require o binario de varredura: `cargo test --offline --test no_panic_sweep`.

## Rolda do aceite (R5–R8)

Os catro controles anteriores gradúan as probes do produto. Os desta rolda
gradúan **`tests/acceptance.rs`**: o oráculo independente e os vectores
publicados en `vectors/acceptance-v1.json` teñen que rexeitar as mesmas
alteracións, ou o aceite non vale como evidencia para o adaptador.

Medido na árbore de traballo de `30cb311` máis os ficheiros desta rolda (`src/snes_exhirom.rs`,
`src/md_common.rs`, `src/md_ssf2.rs`, `src/region.rs`, `src/state.rs` e
`tests/support/mod.rs` modificados; `tests/acceptance.rs` e
`vectors/acceptance-v1.json` novos), na rama `codex/rex-rust-addressing` — a
mesma das roldas M1–M6 e R1–R4, que é a rama aberta na PR #82. Batería completa nesta árbore:
**138 passed, 0 failed, 10 ignored** — o delta fronte a 127/0/9 é exactamente
os 11 probes aceptados do aceite máis o seu xerador `#[ignore]`. Cada execución
baixo mutación usou `--test acceptance` (agás R8, que rodou a suite enteira).

| ID | Simula | Sitio mutado | Detección |
|----|--------|--------------|-----------|
| R5 | o límite de corredores non se aplica | `src/resource.rs:464` (`segments.len() >= max_segments` → `>`) | 1 probe: `todos_os_vectores_de_aceite_gradan_pola_api_publica` (A5d) |
| R6 | a identidade de xanela pérdese cando `banks` non nomea a xanela | `src/md_ssf2.rs:117` (`unwrap_or(u64::from(window))` → `unwrap_or(0)`) | 3 probes: gradación (A2), `as_dúas_instancias…` (A7b), `un_vector_alterado…` |
| R7 | unha imaxe curta clasifícase como rexión non-ROM | `src/resource.rs:504` (`OutOfRange => IncompatibleSize` → `NonRomRegion`) | 1 probe: gradación (A5e) + a lista de códigos pinada |
| R8 | a forma do díxito xa non se valida (maiúsculas admitidas) | `src/resource.rs:381` (engadir `b'A'..=b'F'` ao `matches!`) | **só** `a_capa_non_pode_verificar_o_digesto` en toda a suite |

### R5 — límite de corredores

```
test todos_os_vectores_de_aceite_gradan_pola_api_publica ... FAILED
panicked at tests/acceptance.rs:1083:21:
assertion `left == right` failed: A5d-limite-de-segmentos: o aceite esperaba recusa
test result: FAILED. 10 passed; 1 failed; 1 ignored
```

O vector A5d pide 1 MB cunha `max_segments` de 1: con `>` a garda deixa pasar o
segundo corredor e a lectura convértese en éxito. Revertido: 11/0/1.

### R6 — identidade da xanela

```
test un_vector_alterado_detectase ... FAILED                     (acceptance.rs:1656)
test todos_os_vectores_de_aceite_gradan_pola_api_publica ... FAILED
  assertion `left == right` failed: A2-fronteira-de-xanela-ssf2: rom_offset 1  (acceptance.rs:1216)
test as_dúas_instancias_non_comparten_estado ... FAILED
  assertion `left == right` failed: A7b non le a identidade       (acceptance.rs:1580)
test result: FAILED. 8 passed; 3 failed; 1 ignored
```

É o control que xustifica a imaxe de 4 MB do aceite: nunha imaxe de 2 MB,
`5 << 19 = 0x280000` recorta pola máscara a `0x80000`, que é a identidade da
xanela 1, e A6/A7a/A8 non poderían distinguir remapeo de identidade. Coa base
mal, A7b (sen bancos) e A7a (banco 5) devolven o mesmo corredor e a probe de
independencia queda vacía.

### R7 — clasificación da imaxe curta

```
test todos_os_vectores_de_aceite_gradan_pola_api_publica ... FAILED
panicked at tests/acceptance.rs:1313:5:
assertion `left == right` failed: A5e-imaxe-curta: código de recusa (detalle:
percorrido detido en 0x408010: ROM (32784 bytes) máis curta que rom_size declarado
(1048576); trecho faltante a partir do offset 0x8000)
test result: FAILED. 10 passed; 1 failed; 1 ignored
```

O código é o que consume o adaptador para decidir que lle mostra ao usuario; a
aceptación está pinada en `a_bateria_non_e_degenerada` coa lista ordenada de
recusas, así que calquer renomeamento tamén a move.

### R8 — a forma do díxito (control exclusivo do aceite)

Este é o único dos oito que **ningunha probe previa do repositorio ve**. Tras
admitir maiúsculas en `check_attestation`, a suite enteira (138 probes) falla só
nun punto:

```
Running tests/acceptance.rs
test a_capa_non_pode_verificar_o_digesto ... FAILED   (acceptance.rs:1538)
```

`a_capa_non_pode_verificar_o_digesto` acepta un díxito **mentireiro pero ben
formado** (a capa non hashexa, §12.5 do contrato) e rexeita catro mal formados:
baleiro, 63 ceros, 64 `A` e 64 `g`. É a diferenza entre "non comprobo o contido"
e "non comprobo a forma", e só o aceite a gradúa.

### Como repetir R5–R8

```bash
cd /home/misael/RDS-REX-A2-RUST-ADDR/scripts/rex_profiles/addressing_runtime/rex-addressing
export CARGO_TARGET_DIR=/tmp/rex-a2-target
# R5
perl -0pi -e 's/if segments\.len\(\) as u32 >= req\.limits\.max_segments \{/if segments.len() as u32 > req.limits.max_segments {/' src/resource.rs
# R6
perl -0pi -e 's/\.unwrap_or\(u64::from\(window\)\)/.unwrap_or(0)/' src/md_ssf2.rs
# R7
perl -0pi -e "s/ErrorCode::OutOfRange => ResourceErrorCode::IncompatibleSize,/ErrorCode::OutOfRange => ResourceErrorCode::NonRomRegion,/" src/resource.rs
# R8
perl -0pi -e "s/b'0'\.\.=b'9' \| b'a'\.\.=b'f'/b'0'..=b'9' | b'a'..=b'f' | b'A'..=b'F'/" src/resource.rs
CARGO_TARGET_DIR=/tmp/rex-a2-target cargo test --offline --test acceptance
git checkout -- src/resource.rs src/md_ssf2.rs
CARGO_TARGET_DIR=/tmp/rex-a2-target cargo test --offline   # → 138/0/10
```

Unha mutación por vez; `git status --porcelain src/` quedou só con
`src/snes_exhirom.rs` (a mensaxe do `.expect()`) tras cada revert, e ningunha
mutación chegou a un commit.

