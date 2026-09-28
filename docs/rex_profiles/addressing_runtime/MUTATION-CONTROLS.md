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
4. Desfírase c`git checkout -- <ficheiro>` e vólvese rodar: **72 passed, 0 failed, 1 ignored**.

Ningunha mutación chegou a `HEAD`; a árbore final é a do commit `6f3194e`.

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

**Hallazgo de endurecemento (commit `4958a2b`).** A primeira vez que se rodou
M2b aínda non existía a garda: `run` quedaba en `0`, o cursor non avanzaba e
`read` **entraba en bucle infinito**; a execución matouse por timeout (>10 min)
e non por un fallo de test. Agora os cinco bucles de lectura levan
`debug_assert!(run >= 1, …)`, que converte o hang nun panic co nome do
problema. Un control de mutación que se detecta por timeout é un control que
nadie vai repetir; a garda faino reproductible en milisegundos.

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
CARGO_TARGET_DIR=/tmp/rex-a2-target cargo test --offline        # → 72 passed, 0 failed, 1 ignored
```

Rodados con `timeout` explícito no caso M2b: sen a garda a execución cuelga, e
eso forma parte do resultado, non un defecto do procedimiento.
