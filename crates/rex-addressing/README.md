# rex-addressing

Biblioteca de enderezamento de ROMs do REX: **MD linear**, **MD SSF2**, **SNES
LoROM**, **SNES HiROM**, **SNES ExHiROM**. Tradución CPU→arquivo, inversión con
lista de aliases, lecturas segmentadas e erros estruturados.

**Experimental / sen integrar.** Non detecta mapas, non deduce perfil por
tamaño nin por banner, non modela chips especiais (DSP/SA-1/Super FX/CX4/SVP),
non decodifica codecs, non ten UI, e **non afirma soporte a ningún xogo**. O
contrato formal e os límites están en
[`docs/rex_profiles/addressing_runtime/CONTRATO.md`](../../../../docs/rex_profiles/addressing_runtime/CONTRATO.md);
a evidencia da rolda, en
[`RELATORIO_ENDERAZAMENTO_RUST_2026-09-27.md`](../../../../docs/rex_profiles/addressing_runtime/RELATORIO_ENDERAZAMENTO_RUST_2026-09-27.md).

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

## Validacións

```bash
cd crates/rex-addressing
export CARGO_TARGET_DIR=/tmp/rex-a2-target   # nunca o target compartido do produto

cargo fmt -- --check
cargo clippy --offline --all-targets -- -D warnings
cargo test --offline                         # batería rápida: 72 + 4 doc-tests
```

As dúas baterías caras/dependentes do host van `#[ignore]` e **non** se executan
coa anterior:

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
