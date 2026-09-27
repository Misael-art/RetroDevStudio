# Contrato do paquete `rex-addressing` (roda REX A, fase 5 — biblioteca Rust)

**Estado: Experimental.** Isto é unha biblioteca de enderezamento de ROMs preparada
para integración, non unha afirmación de soporte a xogo ningún. Non detecta
mapas automaticamente, non compila xogos, non decodifica codecs, non modela
chips especiais (DSP/SA1/SuperFX/CX4/SVP), e non ten UI.

## 0. Conflito de localización (rexistrado, non resolto unilateralmente)

- A directiva pide `crates/rex-addressing/`. O directriz tamén di: *se ese local
  xa ten dono ou contido en conflito, rexistre o conflito e combine outra
  localización antes de editar*.
- `crates/` **non existe** no árbore e **non está** en `docs/08_TREE_ARCHITECTURE.md`;
  `scripts/check-tree.cjs` (`allowedDirs`, liña 12) rexeita calquera directorio
  novo na raíz. Polo tanto un PR con `crates/` na raíz pone **vermello** o gate
  `npm run check:tree`, que é obrigatorio na barra mínima de entrega (AGENTS.md).
- Corrixir iso require editando ferramenta compartida (`scripts/check-tree.cjs`)
  ou `docs/08_TREE_ARCHITECTURE.md`, ambos fóra do meu dono (o directorio canónico
  pertence ao integrador).
- **Local escollido por agora:** `scripts/rex_profiles/addressing_runtime/rex-addressing/`
  (Paquete Cargo autónomo). `scripts/rex_profiles/**` é o perimetro de dono que o
  axente A xa tiña en PR #80; mantense `check:tree` verde; non se toca ningún
  manifest/lockfile compartido.
- **Promoción pendente para o integrador** (2 cambios compartidos, non aplicados aquí):
  1. `mv scripts/rex_profiles/addressing_runtime/rex-addressing crates/rex-addressing`
  2. engadir `"crates"` a `allowedDirs` en `scripts/check-tree.cjs` e unha liña en
     `docs/08_TREE_ARCHITECTURE.md`.
Se o integrador prefira outra localización, o paquete non ten dependencias de
ruta: mover e `cargo test` seguen sendo válidos.

## 1. Identidade e versión

| Concepto | Valor |
|---|---|
| `contract_version` | `1` (igual ao dos vectores diferenciais de fase 1-2) |
| Ids de perfil | `md-linear`, `md-ssf2`, `snes-lorom`, `snes-hirom`, `snes-exhirom` |
| Barramento | 24 bits. `BUS_LIMIT = 0xFFFFFF` nos cinco perfis |
| Fonte das specs | `docs/rex_profiles/addressing/*.md` (commits pinados: GPGX `939ce4f0…`, bsnes `7d5aa1e6…`, snes9x `1bcc369e…`) |
| Vectores | `data/rex_profiles/addressing/differential/rust-vectors-v1.json`, sha256 `da09b5b2e84aeac4a95ee02fa6cc8fb6e77aa6a43ecce77a010d3082d741e048`, xerado no commit `9ec21ac`, **posteriores** á corrección de inversión HiROM `b952329` |

Os vectores anteriores á corrección `b952329` **non se consomen**: a fórmula vella
inventaba aliases (`rel < 0x8000` + `0x8000`) e ningún caso pinado nela é válido.

## 2. Enderezo de barramento vs offset de arquivo (separación obrigatória)

- `cpu_address: u32` — enderezo do bus (0..=0xFFFFFF). Nunca é un índice de arquivo.
- `rom_offset: u32` — desprazamento dentro do dispositivo ROM **normalizado**
  (arquivo xa elevado a potencia de 2 con pad `0xFF` cando o perfil o exixe).
- Ningunha API acepta un `rom_offset` para traducir nin un `cpu_address` para
  indexar o buffer sen pasar pola clase de rexión.
- A normalización é **responsabilidade da capa chamante** e rexístrase na
  evidencia; o perfil nunca pad-exce, nunca clampa silenciosamente.

## 3. Estado válido do mapper (`MapperState`)

| Perfil | `rom_size` válido | Estado de bancos |
|---|---|---|
| `md-linear` | potencia de 2 en [0x10000, 0x400000] | inexistente (claves extras → `unsupported`) |
| `md-ssf2` | potencia de 2 en [0x80000, 0x800000] | `banks: {1..7 → byte}`, xanela 0 fixa |
| `snes-lorom` | potencia de 2 en [0x8000, 0x400000] | inexistente |
| `snes-hirom` | potencia de 2 en [0x10000, 0x400000] | inexistente |
| `snes-exhirom` | (0x400000, 0x800000] **e** `rom_size − 0x400000` potencia de 2 → 5MB, 6MB, 8MB | inexistente |

Non se asume que todos os tamaños de ROM sexan potencias de 2: `snes-exhirom`
aceita 5MB e 6MB (totais non binarios cuxa **segunda** área si é binaria), e hai
tests que o exercitan. Os perfis que dependen dunha máscara de espello rexeitan
non-binarios con `unsupported` + nota de normalización — rexeitar, non adiviñar.

## 4. Resultado de `translate` — tres clases distintas

```rust
pub enum Region { Rom, Z80Ram, Io, CartIo, WorkRam, Wram, WramMirror, Sram }

pub enum Translate {
    Rom  { offset: u32 },              //ROM mapeada: offset de arquivo válido
    Device { region: Region, offset: u32 }, // rexión non-ROM coñecida (WRAM/SRAM/IO/…)
    Invalid(AddressingError),          // entrada inválida: sen offset, nunca 0
}
```

- `Invalid` **non** devolve offset. Un erro nunca se converte en `offset = 0`.
- Códigos de erro (`ErrorCode`): `OutOfRange` (foro do barramento, `length < 1`,
  `rom_offset` non enteiro, estado sen `rom_size`), `Unsupported` (rexión sen
  dispositivo no modelo, estado fóra do intervalo, claves alleas ao perfil),
  `Ambiguous` (as fontes pinadas diverxen — **só** `snes-lorom`: A15 desconectado
  nas metades baixas de bancos `40-7D`/`C0-FF`; snes9x di ROM, bsnes di open bus).
- `detail: String` legible para diagnóstico; a **comparación nos tests é por
  `code`, non por texto**.

## 5. `invert` — aliases, non un enderezo canónico

`invert(rom_offset, &MapperState) -> Result<Vec<u32>, AddressingError>`

- Devolve **todos** os `cpu_address` do barramento cuxa tradución no estado dado
  cae nese `rom_offset`, en **orde crecente**.
- Un offset con varios aliases non ten "enderezo canónico": calquera API que
  devolvese un só sería un invento. Exemplos pinados: `md-linear` 512KB → 8
  aliases; `snes-lorom` offset 0 → 8 aliases; `md-ssf2` 4MB con bancos en
  identidade → bijectivo (1 alias).
  `rom_offset` (ou fóra das áreas de ExHiROM) → `Vec` **baleiro**,
  que é resposta válida, non erro.
- Propiedade obrigatória (testada): para todo alias devolto,
  `translate(alias) == Rom{offset == rom_offset}`. E completitude no dominio
  acotado: barrindo o barramento enteiro, o conxunto de enderezos que mapean a
  `offset` é exactamente o que devolve `invert` (barrido do bus enteiro en
  `tests/exhaustive.rs`).

## 6. Espellamento: política por perfil (sen módulo xenerico inventado)

Cada perfil declara o seu; non existe un "mirror" común porque as causas físicas
son distintas:

| Perfil | Espellamento | Orixe |
|---|---|---|
| `md-linear` | `addr & (rom_size-1)` en toda `0x000000-0x3FFFFF` (máscara) | GPGX `cart.mask` |
| `md-ssf2` | base de xanela `(banco << 19) & (rom_size-1)`; dentro da xanela, lineal | GPGX `mapper_512k_w` |
| `snes-lorom` | `((b & 0x7F) * 0x8000 + (a & 0x7FFF)) & (rom_size-1)` | bsnes/snes9x |
| `snes-hirom` | `((b << 16) + a) & (rom_size-1)`, sen base | boards.bml HIROM |
| `snes-exhirom` | área 1: `A % 0x400000`; área 2: `0x400000 + (A % half2)` | bsnes `base/mask`, snes9x `map_hirom_offset` |

## 7. `read` — leituras que cruzan xanelas e frontiras

`read(cpu_address, length, &MapperState, &RomImage) -> Result<Vec<Segment>, AddressingError>`

```rust
pub enum Segment {
    Bytes { region: Region, offset: u32, bytes: Vec<u8> },
    DeviceNoBacking { region: Region, offset: u32 },   // coñecido, sen backing ROM
    Invalid(AddressingError),                          // truncamento explícito
}
```

- Un segmento por **corrida continua de offset**, non por byte. Corta en:
  fin de xanela/grupo de bancos, borde de espello (`rom_size`, e en ExHiROM
  borde de área `0x400000`/`rom_size`), fin do barramento, e fronteira
  ROM→non-ROM.
- HiROM/ExHiROM: bancos completos `40-7D`/`C0-FF` **emendan** (unha lectura pode
  cubrir varios bancos). LoROM **nunca** emenda (o byte seguinte a `$xxFFFF` é a
  metade baixa doutro dispositivo). MD: corta por xanela de 512KB (SSF2) ou por
  espello (linear).
- `cpu_address + length - 1 > 0xFFFFFF` → `OutOfRange` **antes** de calquera
  reserva de memoria.
- Imaxe ROM máis curta que `rom_size` declarado → segmento `Invalid(OutOfRange)`
  no trecho faltante, co prefixo válido devolto; **sen clamp**.
- Rexión non-ROM → `DeviceNoBacking` (clasifica, non inventa bytes de WRAM/IO).

## 8. SSF2: estado inicial e transicións de rexistradores

- **Estado inicial (reset, sen escritas):** identidade — xanela `i` → valor `i`,
  `banks` baleiro. Xanela 0 é **fixa** ao banco 0 e non se pode remapear.
- **Páxina de rexistradores:** `0xA13000-0xA130FF` (páxina TIME roteada ao
  cartucho). Escritas fóra → `Unsupported`.
- **Decodificación da xanela:** `w = (addr & 0x0E) >> 1` (bits 1-3 do enderezo;
  espellos: `0xA13022` → xanela 1, `0xA130FF` → xanela 7). `w == 0` → **sen
  efecto** (estado idéntico devolto). `w >= 1` → `banks[w] = data` bruto
  (0..=0xFF), reescrita substitúe.
- **Tradución:** base `(data << 19) & (rom_size - 1)`; `offset = base + (addr & 0x7FFFF)`.
  Un valor escrito máis alá do fin da ROM **espella por máscara, non é erro**.
- `write_mapper_register` é **pura**: retorna un estado novo, nunca muta o recibido.
- Obrigatoriedade de evidencia (validación 4): para cada secuencia de escritas,
  comparar bytes **antes/despois** e probar que as **xanelas non afectadas seguen
  byte a byte iguais**.

## 9. Aritmética verificada e ausencia de panic

- Toda a aritmética en `u32`/`u64` con `checked_*`/`wrapping` **explícito**;
  ningún `unwrap!`/`expect`/índice sen validar en `src/`. `debug_assertions` con
  overflow checks activos nos tests.
- Validación **antes** de calquera `Vec::with_capacity` ou bucle proporcional ao
  enderezo ou ao `length`.
- Propiedade testada: a suite enteira (incluído o barreño exhaustivo de 16,7 M de
  enderezos) executan sen panic e sen `unwrap` alcanzado.

## 10. Límites explícitos (o que NON se entrega)

- SRAM real (tamaño, batería), TMSS, MegaCD, Everdrive, MegaSD, BS-Cart, Satox,
  WRAM ampliada, SDD-1/ExLoROM offset, `map_lorom_offset`.
- Detección universal de mapa: **ningún** perfil deduce o mapa por extensión,
  banner de header ou tamaño. `corpus-identification` segue `blocked` nos manifests.
- Decodificación de registros IO individuais (só se clasifica a xanela).
- Soporte a xogos, codecs ou descompilación: **ningunha** afirmación.

## 11. Validacións obrigatorias e onde viven

| # | Validación | Onde |
|---|---|---|
| 1 | Vectores diferenciais existentes, con versión e SHA, sen Node | `tests/differential.rs` (+ `tests/support/json.rs`, parser propio) |
| 2 | Referencia independente (motor de xanelas declarativas de `crosscheck/`, táboa extraída do `boards.bml` crudo de bsnes) | `tests/oracle.rs` + `tests/support/windows_engine.rs` (só tests; **non** reusa as fórmulas dos perfis) |
| 3 | Límites de xanela, aliases, tamaños irregulares, enderezos inválidos, rexións excluídas, lecturas fóra da ROM | `tests/limits.rs`, `tests/inversion.rs` |
| 4 | SSF2: escritas, bytes antes/despois, xanelas non afectadas iguais | `tests/ssf2_writes.rs` |
| 5 | Inversión: todo alias retradúcese ao offset pedido; completitude no dominio acotado | `tests/inversion.rs` (rápido) + `tests/exhaustive.rs` (`#[ignore]`) |
| 6 | Controis discriminativos (mutación → FAIL → reverter → PASS) | `docs/rex_profiles/addressing_runtime/MUTATION-CONTROLS.md` con saída literal |
| 7 | BYOR separado, identidade exacta, ficheiro ausente ≠ PASS; ExHiROM só-fixture | `tests/byor.rs` |
| 8 | `fmt`, `clippy -D warnings`, tests rápidos separados dos caros | `MUTATION-CONTROLS.md` / informe final |
