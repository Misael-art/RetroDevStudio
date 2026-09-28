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
| `md-linear` | potencia de 2 en [0x10000, 0x400000] | inexistente (**claves extras ígnoranse**, como na referencia auditada) |
| `md-ssf2` | potencia de 2 en [0x80000, 0x800000] | `banks: {1..7 → byte}`, xanela 0 fixa |
| `snes-lorom` | potencia de 2 en [0x8000, 0x400000] | inexistente (claves extras → `unsupported`) |
| `snes-hirom` | potencia de 2 en [0x10000, 0x400000] | inexistente (claves extras → `unsupported`) |
| `snes-exhirom` | (0x400000, 0x800000] **e** `rom_size − 0x400000` potencia de 2 → 5MB, 6MB, 8MB | inexistente (claves extras → `unsupported`) |

**Corrección do contrato (verificada na referencia e fixada con tests).** A
política de claves alleas **non é simétrica** entre familias: `md-linear` ignora
calquera clave que non sexa `rom_size` (`md_linear.mjs` non a mira), mentres que
os tres perfís SNES rexeitan calquera clave adicional. Un `rom_size` **ausente,
`null`, negativo, non enteiro ou fóra de 32 bits** é `unsupported` (non
`out-of-range`: o que falla é o estado, non o enderezo). Ambos as behaviors están
pinados: `tests/md_linear_rules.rs::clave_estraña_en_md_linear_comportase_como_na_referencia`
e `tests/snes_*_rules.rs::clave_estraña_en_*_e_rexeitada_non_ignorada`.

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
  `rom_offset >= rom_size` (ou fóra das áreas de ExHiROM) → `Vec` **baleiro**,
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

`read(cpu_address: u32, length: u32, mapper_state: &MapperState, rom: &[u8]) -> Result<Vec<Segment>, AddressingError>`

```rust
pub enum Segment {
    Bytes { region: Region, offset: u32, bytes: Vec<u8> },
    /// Rexión coñecida sen backing ROM: clasifícase, non se inventan bytes.
    DeviceNoBacking { region: Region, offset: u32, error_code: ErrorCode },
    /// Truncamento explícito (área sen dispositivo, ROM curta, fin do barramento).
    Invalid(AddressingError),
}
```

**Corrección do contrato.** `DeviceNoBacking` leva `error_code` na entrega real
(`ErrorCode::Unsupported` hoxe): sen el, o consumidor tería que adiviñar *por que*
non hai bytes, e o contrato existe para que un erro viaxe estruturado ata o
chamador. A imaxe transmitese como `&[u8]` (non un tipo `RomImage` novo): un
`Vec<u8>` de calquera cargador chega sen conversións nin dependencias.

- Un segmento por **corrida continua de offset**, non por byte. Corta en:
  fin de xanela/grupo de bancos, borde de espello (`rom_size`, e en ExHiROM
  borde de área `0x400000`/`rom_size`), fin do barramento, e fronteira
  ROM→non-ROM.
- HiROM/ExHiROM: bancos completos `40-7D`/`C0-FF` **emendan** (unha lectura pode
  cubrir varios bancos). LoROM **nunca** emenda (o byte seguinte a `$xxFFFF` é a
  metade baixa doutro dispositivo). MD: corta por xanela de 512KB (SSF2) ou por
  espello (linear).
- Fronteira do barramento: **os tres perfis SNES** rexeitan
  `cpu_address + length - 1 > 0xFFFFFF` con `Err(OutOfRange)` **antes** de
  calquera reserva. **Os dous perfis MD** comproban á porta só
  `cpu_address > 0xFFFFFF` e `length < 1`; se o percorrido sae da xanela do
  cartucho devolven `Ok(...)` pechada cun `Segment::Invalid(Unsupported)` (ou
  `DeviceNoBacking`). En ningún caso se reserva memoria proporcional ao
  `length` (§9), que era o que unía os dous comportamentos nunha soa frase.
  Fixado por `tests/read_semantics_audit.rs::a_fronteira_do_barramento_usa_dous_canais_distintos`
  e explicado en `CLASSIFICACION.md` §8.
- Imaxe ROM máis curta que `rom_size` declarado → segmento `Invalid(OutOfRange)`
  no trecho faltante, co prefixo válido devolto; **sen clamp**.
- Rexión non-ROM → `DeviceNoBacking` (clasifica, non inventa bytes de WRAM/IO).
  Propiedade probada nos cinco perfis: ningún segmento vai baleiro, ningún
  segmento clasificador vai no medio, e se a lectura devolve menos bytes dos
  pedidos o último segmento di por que
  (`tests/read_semantics_audit.rs::ningunha_rexion_non_rom_se_omite_en_silencio`).

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
- **Etiqueta da xanela `$FF0000-$FFFFFF` en Mega Drive.** A referencia auditada
  clasa todo `$E00000-$FFFFFF` como `work-ram` con `offset = addr & 0xffff`, e os
  vectores pinados herdan iso; `md-linear`/`md-ssf2` **nunca emiten `Sram`**
  (ese `Region` véxese nos perfís SNES). Non é un erro ROM/non-ROM — non se
  inventan bytes — pero a etiqueta é groseira para backup RAM con batería.
  Corrixila require re-exportar os vectores, fóra desta rolda. Fixado en
  `tests/byor.rs::a_sram_declarada_polo_header_non_e_rom`.
- **Prosa vs. aritmética en WRAM SNES.** A especificación de HiROM describe as
  bancos `7E/7F` como "128KB contiguos", mentres que as tres representacións
  (perfil Rust, referencia JS e motor de xanelas) dan `offset = a` por banco.
  Déixase como observación na rolda: o que se entrega é `offset = a`, e a
  diverxencia de texto queda rexistrada, non "corrixida" por simpatía coa prosa.

## 11. Validacións obrigatorias e onde viven

| # | Validación | Onde |
|---|---|---|
| 1 | Vectores diferenciais existentes, con versión e SHA, sen Node | `tests/differential.rs` (+ `tests/support/json.rs`, parser propio) |
| 2 | Referencia independente (motor de xanelas declarativas, táboa extraída do `boards.bml` crudo de bsnes, con SHA propia) | `tests/support/windows_engine.rs` (só tests; **non** reusa as fórmulas dos perfis), consumido en `tests/differential.rs::oracle_cross_check` (translate) e `::invert_oracle_cross_check` (invert) |
| 3 | Límites de xanela, aliases, tamaños irregulares, enderezos inválidos, rexións excluídas, lecturas fóra da ROM | `tests/md_linear_rules.rs`, `tests/md_ssf2_rules.rs`, `tests/snes_{lorom,hirom,exhirom}_rules.rs`, `tests/inversion.rs` |
| 4 | SSF2: escritas, bytes antes/despois, xanelas non afectadas iguais | `tests/ssf2_writes.rs` |
| 5 | Inversión: todo alias retradúcese ao offset pedido; completitude no dominio acotado | `tests/differential.rs` (rápido, mostras) + `tests/inversion.rs::cada_perfil_devolve_exactamente_o_preimage_do_motor` (`#[ignore]`, barrido completo 0x000000-0xffffff) |
| 6 | Controis discriminativos (mutación → FAIL → reverter → PASS) | `docs/rex_profiles/addressing_runtime/MUTATION-CONTROLS.md` con saída literal |
| 7 | BYOR separado, identidade exacta, ficheiro ausente ≠ PASS; ExHiROM só-fixture | `tests/byor.rs` (`#[ignore]`) |
| 8 | `fmt`, `clippy -D warnings`, tests rápidos separados dos caros | informe final (saída literal alí) |
| 9 | Semántica de `read` auditada perfil por perfil (tres conceptos separados, rexións non-ROM nunca omitidas) | `tests/read_semantics_audit.rs` (5 tests) |
| 10 | Clasificación **validado / política conservadora / non suportado** dos cinco perfis | `CLASSIFICACION.md` |
| 11 | Capa de recursos: procedencia, recusa do parcial, límites e frontira única | `tests/resource_reader.rs` (15 tests) sobre `src/resource.rs` |
| 12 | Oráculo independente da capa de recursos (contido que identifica banco e offset) | `tests/support/banked.rs` |

**Desviación rexistrada da propia táboa.** Este contrato anunciaba
`tests/oracle.rs`, `tests/limits.rs` e `tests/exhaustive.rs` como ficheiros. Non
existen con eses nomes: a comparación contra a referencia vive dentro de
`tests/differential.rs` (porque espera os mesmos vectores pinados), os límites
viven nos `*_rules.rs` de cada perfil (porque son expectativas derivadas a man da
sua propia especificación) e o barrido exaustivo vive en `tests/inversion.rs`
(porque comparte o oráculo de preimage coa proba rápida). Criar os tres
ficheiros co nomes previstos sería duplicar infrastructure de testes, así que se
documenta a correspondencia en vez de renomear.

## 12. Capa de lectura de recursos (`rex_addressing::resource`)

Responde a «le este recurso neste enderezo, con esta lonxitude e este estado de
mapper» dando **bytes, a serie física de segmentos que os produciron e onde se
recusou**. Non descobre mapas nin identifica recursos: o perfil e o estado os
entrega a chamante. `CONTRACT_VERSION = 1`; un consumidor debe rexeitar calquera
outra versión antes de interpretar un campo.

### 12.1 Entrada

| Campo | Contrato |
|---|---|
| `profile` | un dos cinco (`Profile::all()`); non existe modo «auto» |
| `image` | [`ImageIdentity`] **atestado pola frontada**: `origin` non baleiro, `sha256_hex` de 64 díxitos hex minúsculos, `byte_len` igual ao buffer entregado |
| `state` | `&MapperState` prestado: a capa **nunca** o muta; cada segmento sae coa súa copia |
| `cpu_address`, `length` | `length >= 1` e `cpu_address + length - 1 <= 0xFFFFFF` |
| `limits` | `max_bytes` e `max_segments`, comprobados **antes** de reservar nada proporcional a `length` |

### 12.2 Saída

`ResourceRead` leva `profile`, `contract_version`, a `image` tal como entrou, o
`state`, o par `(cpu_address, length)` pedido, `bytes` e `segments` ordenados.
Cada [`PhysicalSegment`] distingue os tres conceptos que §2 separa:

- `cpu_address` — enderezo do barramento onde empeza o corredor,
- `rom_offset` — desprazamento físico dentro da imaxe (espellos e aliases
  resoltos polo perfil),
- `cpu_len` — bytes que aporta, e `state` — o estado vixente nese corredor.

**Invariantes** (pinnados en `tests/resource_reader.rs`):

1. `bytes.len() == length` sempre. Se o percorrido non cubre a lonxitude, é
   `Err`, non un prefixo en `Ok`.
2. Os `segments` son contiguos e non se solapan no espazo lóxico:
   `segments[i].cpu_address == cpu_address + Σ cpu_len[0..i]`. A procedencia
   reconstrúe a saída byte a byte.
3. Dous segmentos poden compartir `rom_offset` (dous bancos remapeados á mesma
   base) sen que se emendan: o que os separa é o enderezo lóxico.
4. Non se inventa continuidade entre xanelas: a capa herda os cortes do perfil.

### 12.3 Erros (un só canal por clase, independentemente do perfil)

| `ResourceErrorCode` | Cando | `segments` |
|---|---|---|
| `BadAttestation` | orixe baleiro ou digest mal formado | vacío |
| `IncompatibleSize` | `byte_len` ≠ buffer, imaxe máis curta que `rom_size`, ou percorrido que non cubriu `length` | percorrido |
| `InvalidRange` | `length < 1` ou cruza `0xFFFFFF` | **vacío** |
| `LimitExceeded` | `length > max_bytes` (antes de percorrer) ou máis de `max_segments` corredores | os primeiros `max_segments` |
| `BadState` | o perfil rexeita o estado (falta `rom_size`, intervalo, claves alleas, escrita fóra da páxina) | percorrido |
| `NonRomRegion` | o percorrido cae nunha rexión coñecida sen backing (`region: Some`) ou nunha área sen dispositivo (`region: None`) | percorrido |
| `Ambiguous` | as fontes pinadas diverxen (metade baixa A15 en LoROM) | percorrido |

A fronteira do barramento resólvese aquí **antes** de chamar a calquera perfil:
§7 documenta que as dúas familias MD e SNES a decidían de xeito distinto, e esta
capa non herda esa ambigüidade — os cinco perfis saen por `InvalidRange` polo
mesmo camiño.

### 12.4 Secuencia de bancos: operación distinta

`read_sequence` acepta `Step::WriteRegister` e `Step::Read` intercalados, e só
existe nos perfis con rexistradores (`Profile::has_mapper_registers()`; neste
conxunto, `md-ssf2`). Sepárase de `read_resource` a propósito: unha lectura cun
estado fixo e unha serie de remapeos responden a preguntas diferentes.

- As escritas son as puras de §8: cada lectura ve o estado das escritas
  anteriores, e o `final_state` é un estado novo.
- A recusa é **total**: se un paso faila non se devolve ningunha lectura, o
  estado prestado queda intacto, e a procedencia dos pasos xa satisfados viaxa
  no erro (renumerada desde 0).
- Nun perfil sen rexistradores, a negativa é previa a calquera comprobación de
  datos: `BadState` con `segments` vacío.

### 12.5 O que **non** fai a capa

- Non abre ficheiros nin coñece rutas: a imaxe entra como `&[u8]`.
- **Non compute o SHA-256** da imaxe. Valida a forma da atestación e devólvena
  na saída; comparar o digest contra o contido real é traballo do adaptador, que
  é quen ten o arquivo. Facerlo no núcleo pagaría un hash por cada recurso
  observado, e fixar ese límite tamén é parte do contrato
  (`tests/resource_reader.rs::a_verificacion_de_contido_e_perna_do_adaptador_non_do_nucleo`).
- Non deduce bancos nin perfil, e non modela chips especiais: herda os límites
  de §10 tal cal.
