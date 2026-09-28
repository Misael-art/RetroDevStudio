# Aceite do adaptador — vectores, comandos e o que a crate **non** dá

**Para que serve.** Que o integrador poida verificar o comportamento do lector
de recursos **pola fronteira real do backend** sen reimplementar ningunha regra
de enderezamento. Todo o esperado vai en `vectors/acceptance-v1.json`, derivado
por un oráculo independente; o que se pide ao adaptador é que reproduza eses
resultados chamando só a `read_resource` / `read_sequence` (e ás súas tres
funcións de servizo), non que volva calcular offsets.

**Árbore medida.** `30cb311` máis os tres ficheiros desta rolda na área de
traballo (`tests/acceptance.rs`, `vectors/acceptance-v1.json`, e a mensaxe
corrixida en `src/snes_exhirom.rs`). Gates desa árbore:

|Comprobador|Resultado|
|---|---|
|`cargo fmt -- --check`|saída 0, sen diff|
|`cargo clippy --offline --all-targets -- -D warnings`|saída 0, cero avisos|
|`cargo test --offline`|**138 executados · 0 fallos · 10 `#[ignore]`** (17 filas de resultado: 16 binarios + doc-tests, que estes últimos achegan 5 probes)|
|`cargo test --offline --test acceptance`|**11 executados · 0 fallos · 1 `#[ignore]`**|
|`cargo test --offline --test acceptance -- --ignored` (con `REX_ACEITE_ESCRIBIR=1`)|1 pasado, escribe o ficheiro e imprime o seu SHA|

Ficheiro de aceite: `vectors/acceptance-v1.json`, 18 774 bytes,
**SHA-256 `54ba2b6e864c53ba69228b51d0a4cf079735182ad875ecb8e98b6dbbf257a216`**,
15 casos. Ese SHA está pinado en `tests/acceptance.rs` (`FICHEIRO_SHA256`), así
que calquera edición posterior do JSON rompe `o_ficheiro_publicado_ten_a_sha_pinada`
antes de que ninguén lea un resultado ambiguo.

---

## 1. Independencia do esperado

A regra da rolda era: **non calcular o esperado chamando a función do produto
que se gradúa.** Así se cumpriu:

|Que se gradúa|De onde vén o esperado|
|---|---|
|`rom_offset` de cada corredor|motor de xanelas declarativo (`tests/support/windows_engine.rs`), coa táboa `boards.bml` de bsnes (SHA `2de90492…`) e o modelo de páxinas de GPGX para SSF2 — o mesmo camiño cruzado que xa usa `tests/differential.rs`, non as fórmulas dos perfís|
|Onde **corta** un corredor|texto de `CONTRATO.md` §7 (borde de xanela/grupo de bancos, borde de espello, fin do barramento, fronteira ROM→non-ROM), aplicado por `estender_corrida` sondando o **último** byte de cada tramo de `$2000`; se o sondeo falla, retrocede byte a byte|
|Política de recusas e a súa **orde**|`CONTRATO.md` §12.3, replicada en `derivar()`: atestación → `length < 1` → fronteira do bus → `max_bytes` → `validate_state` → percorrido → `max_segments` → garda final de cobertura|
|Contido dos bytes|`banked-byte-at-v1`, a fórmula publicada dentro do propio JSON (`regra_imaxe.formula`): `byte(i) = (i*37 + (i>>8)*91 + (i>>16)*2F)` en decimal `… + (i>>8)*0x5B + (i>>16)*0x2F) mod 256`. O adaptador pode reconstruír a imaxe **sen a crate**|
|Estado, límites e pasos da secuencia|o que vai **escrito no JSON**: `todos_os_vectores_de_aceite_gradan_pola_api_publica` lles os pasos desde o ficheiro, non desde a estrutura do xerador, para graduar tamén que o publicado é executábel|

Ademais, `a_regra_da_imaxe_publicada_reproduse` re-deriva a fórmula **a man
dentro da probe** (constantes `37`, `91`, `47` escritas no test) e compáraa coa
fixture: se alguén cambia `banked::byte_at` sen cambiar o texto publicado, iso
falla.

## 2. Os 15 casos e o que cada un prova

|ID|Perfil|Op|Esperado|Que prova|
|---|---|---|---|---|
|`A1-lectura-simple-md-linear`|md-linear|read|1 corredor, `rom_offset 0x10000`, 32 bytes|lectura simple dentro da xanela do cartucho|
|`A2-fronteira-de-xanela-ssf2`|md-ssf2|read|**2** corredores (`0x7FFF0` + `0x80000`), 32 bytes contiguos|cruzar a fronteira **permitida** de 512 KB abre segmento, non emenda|
|`A3-alias-mesma-imaxe`|md-linear|read|1 corredor, `rom_offset 0x10000` (igual ao de A1)|alias: dous enderezos, mesma posición física, `cpu_address` propio na procedencia|
|`A4-rexion-non-rom-tras-ROM`|snes-lorom|read|`non-rom-region`, `rexion wram-mirror`, `detido_en 0x10000`, 1 corredor de 16 bytes na recusa|rexión non-ROM clasifícase, **non se inventan bytes**|
|`A5a-longitude-cero`|md-linear|read|`invalid-range`, sen procedencia|`length = 0` rexeitado antes de percorrer|
|`A5b-rango-fora-do-barramento`|md-linear|read|`invalid-range`, sen procedencia|`cpu+length-1 > 0xFFFFFF` rexeitado antes de reservar|
|`A5c-limite-de-bytes`|md-linear|read|`limit-exceeded`|`length` por riba de `Limits::max_bytes`|
|`A5d-limite-de-segmentos`|md-ssf2|read|`limit-exceeded` **coa procedencia percorrida** (1 corredor de 512 KB)|`max_segments` deteñe o percorrido e di onde|
|`A5e-imaxe-curta`|snes-hirom|read|`incompatible-size`, `detido_en 0x408010`, prefixo de 16 bytes en `0x8000`|imaxe máis curta que `rom_size`: prefixo real + erro, **sen clamp**|
|`A6-secuencia-ssf2-remapeo`|md-ssf2|seq|3 lecturas: `0x80000` → `0x280000` → `0x100000`; `escritas_aplicadas 1`; `estado_final.banks{1:5}`|a escrita de rexistro cambia a súa xanela, a xanela 2 queda byte a byte igual|
|`A7a-instancia-con-banco`|md-ssf2|read|`0x280000` (banco 5)|instancia A co seu banco|
|`A7b-instancia-sen-banco`|md-ssf2|read|`0x80000` (identidade)|instancia B non ve o estado de A|
|`A8-procedencia-reconstrue`|md-ssf2|read|3 corredores de 512 KB, bases `0x0`/`0x280000`/`0x180000`, 1 572 864 bytes|a lista de segmentos reconstrúe **exactamente** os bytes devoltos|
|`A9-estado-alleo-bad-state`|snes-hirom|read|`bad-state`, `detalle_menciona "snes-hirom"`|clave de mapper nun perfil sen rexistradores, rexeitada **antes** de percorrer|
|`A10-capacidade-digesto-non-verificado`|md-linear|read|**éxito** cun digesto mentireiro ben formado|a capa comproba a **forma**, non o contido: ver §4|

Os oito requisitos da misión están cubertos así: lectura simple → A1; fronteira
permitida → A2; alias → A3; non-ROM → A4; intervalo/tamaño inválidos →
A5a/A5b/A5c/A5d (+ A5e para a imaxe curta); troca SSF2 que modifica a xanela →
A6 (antes/despois, máis a xanela non afectada, como esixe `CONTRATO.md` §8);
dúas instancias sen compartir estado → A7a/A7b e `as_dúas_instancias…`;
procedencia que reconstrúe os bytes → A8 e a verificación dentro de
`verificar_lectura` (cada corredor compárase byte a byte contra
`rom[rom_offset..rom_offset+cpu_len]`).

**Por que A6/A7a/A8 levan imaxe de 4 MB.** Nunha imaxe de 2 MB,
`5 << 19 = 0x280000` recorta pola máscara a `0x80000`, que é **exactamente** a
identidade da xanela 1. O aceite escribiría un banco e lería o mesmo que sen
escribilo: un caso que non pode distinguir remapeo de identidade non gradúa
nada. A primeira versión deste ficheiro tiña ese defecto; detectouno a probe
escrita a man `as_dúas_instancias_non_comparten_estado`, e o control **R6** de
`MUTATION-CONTROLS.md` é a proba de que agora ten dente.

## 3. Comandos

```bash
cd scripts/rex_profiles/addressing_runtime/rex-addressing
export CARGO_TARGET_DIR=/tmp/rex-a2-target    # nunca o target do produto

cargo test --offline --test acceptance        # gradúa: produto vs JSON publicado (11/0/1)
sha256sum vectors/acceptance-v1.json          # → 54ba2b6e…a216 (pinado no test)

# Rexenerar é un acto explícito, nunca un efecto colateral:
REX_ACEITE_ESCRIBIR=1 cargo test --offline --test acceptance -- --ignored --nocapture
# → imprime o novo sha256; hai que actualialo en FICHEIRO_SHA256 na mesma rolda.
```

Para o harness do adaptador, un caso extraído do JSON xa é autocontido (non fai
falta o crate para montar a entrada):

```bash
python3 - <<'PY'
import json
d=json.load(open('vectors/acceptance-v1.json'))
c=[x for x in d['casos'] if x['id'].startswith('A2-')][0]
print(c['perfil'], c['cpu_address_hex'], c['length'], c['estado'], c['limites'])
print([(s['cpu_address_hex'], s['rom_offset_hex'], s['cpu_len'], s['rexion'])
       for s in c['esperado']['segmentos']])
print('sha256 dos bytes =', c['esperado']['bytes_sha256'])
PY
```

**Se un caso falla:** a norma desta crate (precedente en `CONTRATO.md` §12.6) é
nomear o culpábel, non axustar o número. Ou o oráculo ou o produto está
equivocado; `primeras_diferenzas` imprime a primeira liña do JSON que non
reproduce o xerador, e `un_vector_alterado_detectase` demostra que a fixture
discrimina un só byte de desprazamento.

## 4. O que o adaptador ten que engadir (a crate non o dá)

1. **O hash de contido.** A crate valida a forma do `sha256_hex` e que
   `byte_len` coincida coa imaxe; **non pode** verificar o contido, e o caso
   `A10` está publicado para que iso quede como contrato, non como sorpresa. O
   adaptador ten que computar o SHA-256 dos bytes que entrega e comparalo coa
   etiqueta de orixe antes de responder — ou declarar explicitamente que a
   etiqueta é unha referencia de manifesto, non unha verificación.
2. **Mapeco de erros.** `ResourceErrorCode` ten sete valores
   (`bad-attestation`, `invalid-range`, `limit-exceeded`, `bad-state`,
   `non-rom-region`, `ambiguous`, `incompatible-size`); os casos A4/A5a-e/A9
   pinan cales chegan por cada entrada. O adaptador ten que decidir os códigos
   de IPC e o texto de UI **sen perder** o código estruturado: `rexion` e
   `detido_en` son os campos que a interface necesita para explicar por que non
   leu, e van na recusa, non no detalle textual.
3. **Forma do DTO.** Entregar `bytes` **e** a lista de corredores
   (`indice`, `cpu_address`, `cpu_len`, `rom_offset`, `rexion`), co estado na
   cabeceira da lectura. **Non reenviar `segments[].state`:** cada corredor
   leva a súa copia do `{rom_size, banks}` (`max_segments = 4096` → 4096 copias
   nun mesmo resultado), que é irrelevante na pila e non o é serializado.
   A mutación **R4** do rexistro de mutacións amosou que un adaptador que devolva
   só `bytes` oculta por completo unha procedencia que mente.
4. **Límites por chamada.** `Limits::default()` é `max_bytes = 16 MiB` /
   `max_segments = 4096`. O bus pon o tope estrutural de saída (16 MiB), así
   que `Limits` non é unha canle de DoS de memoria, pero o adaptador si debe
   fixar `max_segments` segundo o que quepa na súa mensaxe IPC.
5. **Perfil e estado explícitos.** Os cinco perfís escóllense polo identificador
   (`md-linear`, `md-ssf2`, `snes-lorom`, `snes-hirom`, `snes-exhirom`) e o
   mapper vai como `MapperState` tipado á man; non hai autodetección nesta capa
   (`A9` é un caso negativo dese límite).

## 5. Que o aceite rexeita (non vacuo)

Cuatro mutacións de producción aplicadas unha por vez, cada unha revertida cun
`git checkout --` e coa suite completa volta a 138/0/10 (ver
`MUTATION-CONTROLS.md`, §"Rolda do aceite"):

|ID|Mutación|Probes que fallan|
|---|---|---|
|R5|`max_segments`: `>=` → `>`|`todos_os_vectores…` (A5d convértese en éxito)|
|R6|identidade da xanela SSF2 → `0`|`todos_os_vectores…` (A2), `as_dúas_instancias…` (A7b), `un_vector_alterado…`|
|R7|`OutOfRange` → `non-rom-region`|`todos_os_vectores…` (A5e)|
|R8|admitir maiúsculas no díxito|**só** `a_capa_non_pode_verificar_o_digesto` das 138 probes da suite|

R8 é o argumento de existencia deste binario: hai condutas que o resto da
batería do repositorio non mira, e o aceite é quen as gradúa.

## 6. Pendente do lado do integrador

* A **proposta do adaptador** (`ADAPTACION.md`) segue sen publicar pola súa parte:
  as cinco preguntas de sinatura de `ADAPTACION.md` §6 (nome do comando IPC,
  codificación de `MapperState` na petición, onde se pone o `Limits` real,
  que se fai cunha recusa con procedencia parcial, e se a resposta leva `bytes`
  ou `bytes_sha256` ou ambos) están **abertas**. Nada desta rolda asume unha
  resposta.
* A revisión da súa implementación, cando exista, graduarase contra este mesmo
  ficheiro de vectores; non se toca ningún ficheiro del.
* Qeda **pendente e registrado**: `cargo test --release --offline --test
  no_panic_sweep` (as gardas `run >= 1` son `debug_assert!` e non se emiten en
  release; ver `INVARIANTES.md`). É unha corrida pesada e a norma da rolda é
  unha soa á vez, coordinada co integrador.

Clasificación de todo o entregado: **Experimental**. Non se fixo merge, nin
release, nin promoción de madurez, nin cambio no checkout canónico.
