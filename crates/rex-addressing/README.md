# rex-addressing

Biblioteca de enderezamento de ROMs do REX: **MD linear**, **MD SSF2**, **SNES
LoROM**, **SNES HiROM**, **SNES ExHiROM**. Tradución CPU→arquivo, inversión con
lista de aliases, lecturas segmentadas e erros estruturados.

**Experimental / sen integrar.** Non detecta mapas, non deduce perfil por
tamaño nin por banner, non modela chips especiais (DSP/SA-1/Super FX/CX4/SVP),
non decodifica codecs, non ten UI, e **non afirma soporte a ningún xogo**. O
contrato formal e os límites están en
[`docs/rex_profiles/addressing_runtime/CONTRATO.md`](../../docs/rex_profiles/addressing_runtime/CONTRATO.md);
a evidencia da rolda, en
[`RELATORIO_ENDERAZAMENTO_RUST_2026-09-27.md`](../../docs/rex_profiles/addressing_runtime/RELATORIO_ENDERAZAMENTO_RUST_2026-09-27.md).

## Localización: `crates/rex-addressing/`

Na entrega orixinal (PR #82) o paquete vivía en
`scripts/rex_profiles/addressing_runtime/rex-addressing/`, porque
`scripts/check-tree.cjs` aínda non permitía `crates/` na raíz e o contrato da
rola non deixaba ao agente alterar a árbore nin os scripts compartidos. A
promoción que o propio contrato pedía foi executada polo integrador o
2026-09-28: `crates/` formalizouse en `docs/08_TREE_ARCHITECTURE.md` cun
rexistro explícito (`crates/registry.json`) e o paquete moveuse para
`crates/rex-addressing/`. Nada do código depende da súa localización (cero
dependencias externas, ni sequera de dev).

## API

```rust
use rex_addressing::{md_linear, MapperState, Segment, Translate};

let state = MapperState::rom_size(0x80_000);
let offset = match md_linear::translate(0x00_0100, &state) {
    Translate::Rom { offset } => offset,
    Translate::Device { region, offset } => todo!("coñecido, sen bytes: {region:?}"),
    Translate::Invalid(e) => todo!("e.code: OutOfRange | Unsupported | Ambiguous"),
};
```

| Función | Perfil (`md_linear`, `md_ssf2`, `snes_lorom`, `snes_hirom`, `snes_exhirom`) |
|---|---|
| `validate_state(&MapperState) -> Result<(), AddressingError>` | os cinco |
| `translate(u32, &MapperState) -> Translate` | os cinco |
| `invert(u32, &MapperState) -> Result<Vec<u32>, AddressingError>` | os cinco |
| `read(u32, u32, &MapperState, &[u8]) -> Result<Vec<Segment>, AddressingError>` | os cinco |
| `write_mapper_register(u32, u8, &MapperState) -> Result<MapperState, AddressingError>` | **só `md_ssf2`** |

Tres regras que non se poden romper ao consumir a librería:

1. **Non existe "offset 0 = erro".** Un fallo devolve `Invalid`/`Err`, cun
   `code` e un `detail` lexíbeis.
2. **`invert` devolve uma lista.** Un mesmo offset de arquivo pódese alcanzar
   desde varios enderezos; calquera que devolva "o" enderezo está a escoller por
   ti.
3. **`read` non clampa.** Unha imaxe máis curta que `rom_size`, un fin de
   xanela ou unha rexión sen backing prodúcen segmentos distintos
   (`Invalid(OutOfRange)`, corte de corrida, `DeviceNoBacking`); nunca bytes
   inventados.

## Capa de lectura de recursos (`rex_addressing::resource`)

Dúas operacións, ambas puras (sen filesystem, sen hash, sen estado global):

```rust
use rex_addressing::resource::{
    read_resource, read_sequence, ImageIdentity, Limits, Profile, ResourceRequest,
    SequenceRequest, Step,
};
use rex_addressing::MapperState;

let rom: Vec<u8> = /* bytes normalizados da imaxe, verificados polo adaptador */;
let image = ImageIdentity {
    origin: "fixture:md-linear-1mb".to_string(),   // orixe inmutable, obrigatorio
    sha256_hex: "…64 hex minúsculas…".to_string(),  // hash DA imaxe entregada
    byte_len: rom.len() as u64,
};
let informe = read_resource(&ResourceRequest {
    profile: Profile::MdLinear,
    image,
    state: &MapperState::rom_size(0x10_0000),
    cpu_address: 0x00_0100,
    length: 16,
    limits: Limits::DEFAULT,
}, &rom)?;
// informe.bytes, informe.segments (cada un con cpu_address/cpu_len/rom_offset/
// region/state), informe.profile, informe.contract_version, informe.state
```

`read_sequence(&SequenceRequest { profile, image, initial_state, limits, steps }, &rom)`
é a **operación distinta** para lecturas que dependen de bancos: `Step::WriteRegister`
aplica a escrita sobre un estado novo (nunca muta o prestado) e o `Step::Read`
seguinte xa ve o banco novo. `SequenceRead { final_state, reads, writes_applied }`.

Erros: `ResourceError { code, detail, address, region, segments }` con `code` en
`bad-attestation | bad-state | invalid-range | incompatible-size | limit-exceeded |
non-rom-region | ambiguous`. `Display` imprime o código como primeiro token, así que
sobrevive a un `Result<T, String>`. Unha recusa nunca devolve datos parciais
disfrazados de éxito: os `segments` que veñen co erro son os percorridos **antes**
de deterse, renumerados desde 0.

Tres invariantes que un consumidor externo pode comprobar el mesmo:

1. `bytes` é a concatenación, en orde de `index`, do corredor físico
   `[rom_offset, rom_offset + cpu_len)` de cada segmento. A procedencia
   reconstrúe a saída byte a byte sen volver chamala.
2. `cpu_address`, secuencia lóxica e `rom_offset` son conceptos distintos: as
   xanelas **non** teñen continuidade inventada, e un enderezo non-ROM do bus
   recústase (`non-rom-region`), non se salta en silencio.
3. Dous `MapperState` distintos sobre o mesmo `cpu_address` dan bytes distintos;
   a capa non deduce mapas nin perfís — o chamador elíeos.

Exemplo executábel, con informe determinístico e autoverificación:

```bash
cargo run --offline --example resource_report          # 13 lecturas + 14 recusas
```

Saída literal, `sha256` do informe e como lelo:
[`docs/rex_profiles/addressing_runtime/EXEMPLO-CONSUMIDOR.md`](../../docs/rex_profiles/addressing_runtime/EXEMPLO-CONSUMIDOR.md).
A proposta de adaptación ao produto (ruta do `Cargo.toml`, adaptador, DTO, IPC,
límites) está en
[`ADAPTACION.md`](../../docs/rex_profiles/addressing_runtime/ADAPTACION.md)
e **agarda asinatura do integrador**: non está aplicada.

## Validacións

```bash
cd crates/rex-addressing
export CARGO_TARGET_DIR=/tmp/rex-a2-target   # nunca o target compartido do produto

cargo fmt -- --check
cargo clippy --offline --all-targets -- -D warnings
cargo test --offline                         # batería rápida: ver descomposición abaixo
cargo run --offline --example resource_report  # exemplo consumidor, determinístico
```

Reconto **medido** (non de memoria; recontable con
`cargo test --offline 2>&1 | grep 'test result'`) e **coa árbore na que se
tomou cada número**:

|Árbore medida|executados|fallos|`#[ignore]`|filas de resultado|
|---|---|---|---|---|
|`30cb311` (rolda dos recursos, entregada)|127|0|9|16 (15 targets + doc-tests)|
|árbore de traballo desta rolda: `30cb311` + `tests/acceptance.rs` + `vectors/acceptance-v1.json` + `src/snes_exhirom.rs` (mensaxe do `.expect()`)|**138**|**0**|**10**|17 (16 binarios + doc-tests)|

O delta é exacto: o aceite achega 11 probes executados e 1 `#[ignore]` (o seu
xerador). Descomposición por target da árbore actual, que suma 138 (doc-tests incluídos):

| target | executados |
|---|---|
| `unittests src/lib.rs` | 0 |
| `acceptance` | 11 (+1 `#[ignore]`) |
| `byor` | 1 (+8 `#[ignore]`) |
| `differential` | 8 |
| `harness_selfcheck` | 6 |
| `inversion` | 1 (+1 `#[ignore]`) |
| `md_linear_rules` | 7 |
| `md_ssf2_rules` | 14 |
| `no_panic_sweep` | 8 |
| `read_semantics_audit` | 6 |
| `resource_fixtures` | 11 |
| `resource_reader` | 15 |
| `snes_exhirom_rules` | 16 |
| `snes_hirom_rules` | 14 |
| `snes_lorom_rules` | 12 |
| `ssf2_writes` | 3 |
| doc-tests | 5 |

Os targets `resource_fixtures` (11) e `resource_reader` (15) son 10 e 14 tests
propios **máis** a autocomprobación da fixture compartida. Esa autocomprobación
(`tests/support/banked.rs`, `a_fixture_non_e_degenerada_incluso_antes_de_lectura`)
compílase en **14** dos 15 binarios de integración porque eses 14 inclúen
`mod support;`, así que os 138 contan a mesma comprobación 14 veces.
`no_panic_sweep` é o decimoquinto e **non** a inclúe: os seus 8 probes son propios
(varredura adversaria determinística; ver `docs/…/MUTATION-CONTROLS.md`, R1). Está
dito explicitamente en `docs/…/CLASSIFICACION.md` §9 para que o reconto non pareza
maior do que é.

O aceite engade **unha copia máis** desa autocomprobación (`acceptance` tamén
inclúe `mod support;`), e por iso a súa contribución real non son 11 probes
novos de código de produción senón 11 expectativas derivadas por un oráculo
independente; os seus vectores están pinados por SHA-256 en
`vectors/acceptance-v1.json` (`54ba2b6e…a216`).

As dúas baterías caras/dependentes do host van `#[ignore]` e **non** se executan
coa anterior. Executáronse aparte nesta rolda: o preimage exaustivo en 8.22 s
(release) e as 8 probes BYOR en 0.19 s, ambas verdes.

```bash
# Preimage exaustivo: 0x000000-0xffffff por perfil (7 casos), ~9 s en release.
cargo test --release --offline --test inversion -- --ignored --nocapture

# BYOR: unha soa ROM crua autorizada; se falta o ficheiro, FALLA (ausente != PASS).
cargo test --offline --test byor -- --ignored --nocapture
```

Que se comproba con que:

| Capa | Fonte de verdade | Onde |
|---|---|---|
| Vectores diferenciais pinados | `vectors/rust-vectors-v1.json` (SHA-256 `da09b5b2…e048`, `contract_version 1`, reconto por perfil) | `tests/differential.rs` |
| Segunda referencia executábel | motor de xanelas declarativas sobre `vectors/windows-generated.json` (táboa do `boards.bml` de bsnes, SHA `2de90492…`); **non** reutiliza as fórmulas dos perfis | `tests/support/windows_engine.rs`, `oracle_cross_check`, `invert_oracle_cross_check` |
| Expectativas derivadas a man da especificación de cada perfil | docs de perfil + fichas de hardware | `tests/*_rules.rs`, `tests/ssf2_writes.rs` |
| Propiedade de inversión sobre barrido completo | preimage calculado polo motor, non polo perfil | `tests/inversion.rs` |
| Imaxe real (BYOR) | bytes do ficheiro + hashes do caso real da fase 3 | `tests/byor.rs` |
| Que os tests detectan erros reais | 7 mutacións → FAIL → revert → PASS con saída literal | `docs/…/MUTATION-CONTROLS.md` |

## Procedencia e licenza

Reimplementación a partir das especificacións documentadas (`docs/rex_profiles/
addressing/*.md` do workspace `RDS-REX-A-addressing@dbdc122`), que á súa vez
describen Genesis-Plus-GX `939ce4f0…` e bsnes/higan `7d5aa1e…`. **Non hai
transplante de código** das fontes (a súa licenza non o permite). As fórmulas
fora verificadas contra a referencia JavaScript auditada e contra o motor de
xanelas, por camiños de derivación independentes.

`license = "UNLICENSED"`, `publish = false`: paquete interno do proxecto.
