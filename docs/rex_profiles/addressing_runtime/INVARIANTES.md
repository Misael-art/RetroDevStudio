# Invariantes dos `.expect()` de produción — `rex-addressing`

**Que é este informe.** A auditoria, sitio por sitio, de cada `.expect()` que
queda en `src/`. Para cada un: a condición que o faría fallar, a validación que
o impide, e **se os datos externos poden contornar esa validación**. Non é unha
lista de desexos: cada fila comprobouse lendo o chamador que precede o `expect`.

**Árbore medida.** `30cb311` máis os cambios desta rolda na área de traballo
(`src/snes_exhirom.rs` coa mensaxe corrixida; `tests/acceptance.rs` e
`vectors/acceptance-v1.json` novos). Gates desa árbore: `cargo fmt -- --check`
sen saída, `cargo clippy --all-targets -- -D warnings` con
`Finished 'dev' profile` e **138 passed, 0 failed, 10 ignored**
(17 filas de resultado). A varredura de 277 610 chamadas de
`tests/no_panic_sweep.rs` é **evidencia complementaria**, non o argumento: un
`expect` que non se alcanza nos enderezos sondados tampouco está probado.

**Reconto na árbore.**

| Tipo | Cantos | Onde |
|------|--------|------|
| `.expect()` de produción | **15** | os cinco perfís (`src/*.rs`) |
| `debug_assert!` | **5** | `md_linear.rs:173`, `md_ssf2.rs:306`, `snes_lorom.rs:180`, `snes_hirom.rs:193`, `snes_exhirom.rs:263` |
| `.expect()` en doc-tests (`//!`) | **4** | `lib.rs:48,68,90`, `resource.rs:58` — executan no gate pero non son camiño de produción |

**Veredicto: os 15 son inalcanzables por entrada externa.** Ningún dato
externo —imaxe, enderezo, lonxitude, estado do mapper ou límite— pode facer
fallar un só. Un sitio tiña xustificación **falsa** (non inalcanzable):
`snes_exhirom.rs:181`; corrixíuselle a mensaxe, non o código. Non se eliminou
ningún `expect`: son gardas de invariante interno, e a súa presenza é o que
permite que o resto do camiño vaia sen comprobacións redundantes.

---

## Grupo 1 — `validate_state` xa aceptou o tamaño (5 sitios)

`md_linear.rs:71`, `md_linear.rs:95`, `md_linear.rs:140`, `md_ssf2.rs:139`,
`md_ssf2.rs:168`. Os cinco chaman a `state.checked_rom_size(PROFILE_ID)`
despois de que `validate_state(state)` devolvese `Ok`.

```rust
let Err(e) = validate_state(state) else {
    let size = state.checked_rom_size(PROFILE_ID).expect("…");
    …
};
```

- **Condición que o faría fallar:** que `checked_rom_size` devolva `None` nun
  estado que `validate_state` aceptou; é dicir, que as dúas funcións discrepen
  sobre o que é un `rom_size` válido.
- **Validación que o impide:** as dúas son a mesma función pura.
  `validate_state` delega en `checked_rom_size` (`md_common.rs`), así que non
  hai dous criterios que poidan separarse: `Ok` implica `Some`.
- **Datos externos:** **non**. Calquera `rom_size` rexeitábel (0, non potencia
  de 2, `Text`, ausente) xa devolveu `Err` en `validate_state` e o `else` non se
  executa. A mutación **R1** de `MUTATION-CONTROLS.md` (facer que
  `checked_rom_size` devolva un valor por defecto no camiño do erro) **si**
  rompe a batería: é a proba de que a guarda ten dente.

## Grupo 2 — a lonxitude do corredor cabe na xanela (2 sitios)

`md_linear.rs:172` (perfil MD lineal), `md_ssf2.rs:305` (SSF2).
`usize::try_from((end - cursor).min(left_in_window)…)`.

- **Condición:** que o corredor calculado non caiba en `usize`.
- **Validación:** en MD lineal o `min` inclúe `left_in_window`, que é
  `CART_WINDOW_END - addr + 1 ≤ 0x400000` (4 MB); en SSF2 inclúe
  `left_in_window ≤ WINDOW_SIZE = 0x80000` (512 KB). Os dous termos son `u64`
  derivados de `cpu_address: u32`, así que o valor antes do `try_from` vale como
  máximo 4 194 304.
- **Datos externos:** **non**. `length` si pode ser enorme (`0xFFFFFFFF`), pero
  o `min` coa áncora da xanela recorta *antes* do `try_from`; e
  `read_resource` xa rexeita `cpu_address + length - 1 > 0xFFFFFF` na fronteira
  do barramento (`resource.rs:425`). O `expect` non pode vir de `length`.

## Grupo 3 — a base filtrada está dentro da máscara (`md_ssf2.rs:122`)

- **Condición:** que `(raw & keep) << 19` non caiba en `u32`.
- **Validación:** `keep = mask >> 19`, logo `(raw & keep) << 19 ≤ mask = size - 1`,
  e `size` é un `u32` (`checked_rom_size`). É unha identidade alxébrica, non unha
  suposición sobre o banco escrito: un banco fóra da ROM **espella por máscara e
  non é erro** (`§8` do contrato).
- **Datos externos:** **non**. `raw` ven de `banks` (`0..=0xFF` pola escrita de
  rexistro, calquera `Uint` pola API de estado) e a máscara recorta antes do
  `shift`.

## Grupo 4 — a lectura non pode saír do bus (3 sitios)

`snes_lorom.rs:160`, `snes_hirom.rs:173`, `snes_exhirom.rs:237`.
`u32::try_from(cursor)` dentro do bucle do percorrido.

- **Condición:** que `cursor` supere `u32::MAX`, é dicir que o percorrido
  desborde os 24 bits do bus.
- **Validación:** os tres perfís SNES rexeitan na entrada de `read`
  `cpu_address + length - 1 > BUS_LIMIT` **antes** de reservar nada
  (`§7` do contrato). `cursor` avanza até `end`, que é exclusivo: o último
  `cursor` visitado é `0xFF_FFFF`, nunca `0x1_0000_0000`.
- **Datos externos:** **non**, pero **pola porta do perfil, non pola de
  `read_resource`**. Esta é a diferenza co grupo 2: se alguén expón
  `snes_*::read` sen pasar por `read_resource`, a validación segue estando no
  propio perfil. A varredura `no_panic_sweep` sondea os 16,7 M de enderezos do
  bus nos cinco perfís e non atopou un só `cursor` desbordado.

## Grupo 5 — o corredor cabe na súa cela (3 sitios)

`snes_lorom.rs:179` (32 KB), `snes_hirom.rs:192` (bus), `snes_exhirom.rs:262`
(bus).

- **Condición:** que `usize::try_from(run)` falle con `run` xa acoutado.
- **Validación:** en LoROM o `min` inclúe `left_in_bank ≤ 0x8000` (32 KB, o
  tamaño da cela — o límite é exacto, non holgado); en HiROM/ExHiROM inclúe o
  resto do barramento.
- **Datos externos:** **non** en 32/64 bits: `run` vale como máximo 16 MiB e
  `usize` é de 64 bits nos targets soportados. ** Rexistro a hipótese:** un
  target con `usize` de 32 bits e un corredor de exactamente `0x1_0000_0000`
  faría fallar este `expect`. Non é alcanzábel por entrada externa (ningunha
  lectura cubre os 16 MiB + 1 do bus, tope `$FFFFFF`), pero é o único `expect`
  da crate cuxa xustificación depende da largura do target, así que queda escrito
  aquí en vez dun comentario no código.

## Grupo 6 — o candidato é un `rem_euclid` de `half2` (`snes_exhirom.rs:181`)

- **Condición:** que `u32::try_from(a)` falle.
- **Validación (corrixida nesta rolda):** a versión anterior do comentario
  afirmaba que `a` valía menos de 16 bits, e **iso non era certo**: na área 2
  `a` vale até `half2 - 1`, que pode chegar a 4 MiB. O que si garante o rango é
  `half2 ≤ 4 MiB < 2^32`, e o corte de 16 bits faino a comprobación de abaixo
  (`a < window.lo..0x1_0000`). O código era correcto; a xustificación non.
  Cambiouse só a mensaxe:

```rust
let a = u32::try_from(a)
    .expect("candidato = rem_euclid(half2), e half2 ≤ 4MB cabe en u32");
```

- **Datos externos:** **non**. `a` sale de `rem_euclid(half2, …)` cun `half2`
  validado como potencia de 2 (`validate_state`, mutación **M3** do rexistro).

---

## Os `debug_assert!` e o seu alcance real

As cinco gardas `run >= 1` (`§9` do contrato) **desaparecen en release**:
`debug_assert!` non se emite con `debug_assertions = false`. O que isto significa
para o adaptador:

- En **debug** (os gates do repositorio, `cargo test`): un corredor baleiro é un
  panic con mensaxe, e a batería veo.
- En **release**: un `run == 0` non abortaría; empuxaría un `Segment::Bytes` de
  lonxitude cero, e a garda final de `read_resource` ("nunca devolve un parcial
  como éxito", `resource.rs:530`) convertería o resultado en
  `incompatible-size`. É dicir: **dexeneración a recusa, non a bytes
  inventados.**
- **Non se ensanchou o comportamento** para que a propiedade valga tamén en
  release: iso reescribiría o contrato sen unha medida que o pida. O que falta
  é evidencia, non código: `cargo test --release --offline --test no_panic_sweep`
  sobre a varredura completa. Qeda **pendente e registrado**, porque é unha
  corrida pesada e a norma desta rolda é unha soa á vez, coordinada co
  integrador.

## O que a capa de recursos **non** garante (para o adaptador)

Tres límites que a auditoría deixou escritos porque o adaptador é quen ten que
pechalos:

1. **A crate non hashexa.** `read_resource` valida a **forma** do `sha256_hex`
   (64 díxitos hex minúsculos) e que `byte_len` coincida coa imaxe, pero **non
   pode** verificar o contido: un digesto mentireiro pero ben formado pasa
   (`§12.5` do contrato). O aceite fíxao polos dous lados: `A10` acepta un
   digesto falso e recusan catro mal formados; e o control **R8** (afrouxar a
   forma admitindo maiúsculas) non o ve **ningunha outra probe do repositorio**
   — só `a_capa_non_pode_verificar_o_digesto`. Consecuencia: **o hash que
   verifica o contido cómpútao o adaptador sobre os bytes entregados**, e o
   digesto do pedido é unha etiqueta de orixe, non unha verificación.
2. **`Limits` non é unha canle de DoS de memoria**, pero tampouco un seguro
   absoluto. O tope estrutural da saída póñoo o bus: unha lectura non pode
   cubrir máis de 16 MiB, así que un `max_bytes` grande non abre unha reserva
   proporcional a un valor arbitrario. O que **si** multiplica é o número de
   corredores: `max_segments` vale 4096 por defecto.
3. **Cada segmento clona o estado do mapper** (`PhysicalSegment.state`,
   `resource.rs:478`). Con `max_segments = 4096` son 4096 copias de
   `{rom_size, banks}` no mesmo resultado: é irrelevante para a pila e **non** o
   é para unha serialización IPC. O adaptador non debe reenviar
   `segments[].state` polo canal; o contrato xa leva o estado unha vez na
   cabeceira da lectura (`ResourceRead.state`).

## Como repetir a auditoría

```bash
cd /home/misael/RDS-REX-A2-RUST-ADDR/scripts/rex_profiles/addressing_runtime/rex-addressing
grep -rn "\.expect(" src/ | grep -v '^src/lib.rs' | grep -v '^src/resource.rs:58'   # 15 de produción
grep -rn "debug_assert!" src/                                                       # 5
CARGO_TARGET_DIR=/tmp/rex-a2-target cargo test --offline                            # 138/0/10
```

Os controles que poñen a proba estas afirmacións están en
`MUTATION-CONTROLS.md`: **R1** (grupo 1), **R2/R3** (grupos 2 e 3), **R4/R6**
(procedencia e identidade), **R5/R7** (política de recusas), **R8** (límite 1) e
**M3** (grupo 6).
