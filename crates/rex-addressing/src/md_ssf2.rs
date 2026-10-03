//! Perfil `md-ssf2`: mapper de 512KB por xanela documentado por Bart
//! Trzynadlowski (`emu-docs.org/Genesis/ssf2.txt`) e descrito, como
//! especificación, por `mapper_512k_w`/`mapper_ssf2_w` de Genesis-Plus-GX
//! `939ce4f0…`. Reimplementación independente a partir de
//! `docs/rex_profiles/addressing/md-ssf2.md` (a licenza da fonte non permite
//! transplante de código).
//!
//! O estado do mapper **forma parte da observación**: dous enderezos co mesmo
//! `rom_size` e bancos distintos dan offsets distintos. Por iso
//! [`write_mapper_register`] é pura — devolver un estado novo en vez de mutar
//! o recibido é o que permite comparar antes/despois na evidencia.

use crate::error::{AddressingError, ErrorCode};
use crate::md_common;
use crate::{MapperState, Segment, Translate, Value};

pub const PROFILE_ID: &str = "md-ssf2";
pub const BUS_LIMIT: u32 = md_common::BUS_LIMIT;
pub const CART_WINDOW_END: u32 = md_common::CART_WINDOW_END;
/// 512KB por xanela: oito xanelas cubren os 4MB da xanela do cartucho.
pub const WINDOW_SIZE: u32 = 0x80000;
/// Dentro da xanela, os 19 bits baixos son lineais.
const WINDOW_OFFSET_MASK: u32 = WINDOW_SIZE - 1;
pub const MIN_ROM_SIZE: u32 = WINDOW_SIZE; // unha xanela
pub const MAX_ROM_SIZE: u32 = 0x800000; // 8MB
/// Páxina TIME rotada ao cartucho: alí escriben os rexistradores do mapper.
pub const REGISTER_PAGE_START: u32 = md_common::REG_PAGE_START;
pub const REGISTER_PAGE_END: u32 = md_common::REG_PAGE_END;
/// As xanelas remapeables son 1..=7; a 0 está fixada ao banco 0.
pub const FIRST_REMAPMABLE_WINDOW: u64 = 1;
pub const LAST_REMAPMABLE_WINDOW: u64 = 7;

fn err(code: ErrorCode, detail: impl Into<String>) -> AddressingError {
    AddressingError::new(code, detail)
}

/// Valida `{ rom_size, banks? }`.
///
/// `banks` é un obxecto `xanela -> byte`: claves fóra de `1..=7` ou valores que
/// non son enteiros `>= 0` rexeítanse **antes** de calquera conta. Unha clave
/// `"0"` rexeítase aínda que o hardware a ignore: un estado que pide remapear o
/// que non se pode remapear está mal formado, e a referencia auditada xa o
/// rexeitaba así.
pub fn validate_state(state: &MapperState) -> Result<(), AddressingError> {
    let size = state.checked_rom_size(PROFILE_ID)?;
    if !((MIN_ROM_SIZE..=MAX_ROM_SIZE).contains(&size)) {
        return Err(err(
            ErrorCode::Unsupported,
            format!(
                "mapper_state.rom_size {:#x} fóra do intervalo [{:#x}, {:#x}] do mapper SSF2",
                size, MIN_ROM_SIZE, MAX_ROM_SIZE
            ),
        ));
    }
    if !size.is_power_of_two() {
        return Err(err(
            ErrorCode::Unsupported,
            format!(
                "mapper_state.rom_size {:#x} non é potencia de 2: normalize (pad 0xFF) e registre na evidencia",
                size
            ),
        ));
    }
    if let Some(value) = state.get("banks") {
        let Value::Object(entries) = value else {
            return Err(err(
                ErrorCode::Unsupported,
                "mapper_state.banks debe ser un obxecto xanela->valor",
            ));
        };
        for (key, value) in entries {
            let Ok(window) = key.parse::<u64>() else {
                return Err(err(
                    ErrorCode::Unsupported,
                    format!("mapper_state.banks: chave de xanela '{key}' inválida"),
                ));
            };
            if !(FIRST_REMAPMABLE_WINDOW..=LAST_REMAPMABLE_WINDOW).contains(&window) {
                return Err(err(
                    ErrorCode::Unsupported,
                    format!(
                        "mapper_state.banks: xanela '{key}' inválida (só 1..7 son remapeables; a 0 é fixa)"
                    ),
                ));
            }
            if value.as_uint().is_none() {
                return Err(err(
                    ErrorCode::Unsupported,
                    format!(
                        "mapper_state.banks[{window}] debe ser un enteiro >= 0, atopado {value:?}"
                    ),
                ));
            }
        }
    }
    Ok(())
}

/// Valor escrito na xanela, ou identidade cando non hai escrita.
fn bank_value(window: u32, state: &MapperState) -> Option<u64> {
    let key = window.to_string();
    state
        .object("banks")?
        .iter()
        .find(|(k, _)| *k == key)
        .and_then(|(_, v)| v.as_uint())
}

/// Base da xanela: `mirror((raw << 19), rom_size)` como `mapper_512k_w`.
///
/// Calcúlase como `(raw & (mask >> 19)) << 19`, que é alxebricamente idéntico a
/// `(raw << 19) & mask` sen depender dunha envoltura de 32 bits (a referencia
/// en JavaScript si depende dela para valores absurdos; aquí un banco fóra da
/// ROM **espella por máscara, non é erro**, e isso si está na spec).
fn window_base(window: u32, state: &MapperState, size: u32) -> u32 {
    let mask = size - 1;
    let raw = bank_value(window, state).unwrap_or(u64::from(window));
    let keep = u64::from(mask >> 19);
    usize::try_from((raw & keep) << 19)
        .ok()
        .and_then(|n| u32::try_from(n).ok())
        .expect("a base filtrada está sempre dentro da máscara")
}

/// `translate(cpu_address, mapper_state)`.
pub fn translate(cpu_address: u32, state: &MapperState) -> Translate {
    if cpu_address > BUS_LIMIT {
        return Translate::invalid(
            ErrorCode::OutOfRange,
            format!(
                "enderezo {:#x} excede o barramento de 24 bits do 68000 (máx {:#x})",
                cpu_address, BUS_LIMIT
            ),
        );
    }
    let Err(e) = validate_state(state) else {
        let size = state
            .checked_rom_size(PROFILE_ID)
            .expect("validate_state xa aceptou o tamaño");
        return decode(cpu_address, size, state);
    };
    Translate::Invalid(e)
}

fn decode(cpu_address: u32, size: u32, state: &MapperState) -> Translate {
    if cpu_address <= CART_WINDOW_END {
        let window = cpu_address / WINDOW_SIZE; // 0..=7
        if window == 0 {
            // Xanela 0 fixa: lineal co espello por máscara.
            return Translate::Rom {
                offset: cpu_address & (size - 1),
            };
        }
        return Translate::Rom {
            offset: window_base(window, state, size) + (cpu_address & WINDOW_OFFSET_MASK),
        };
    }
    md_common::device_or_invalid(cpu_address, PROFILE_ID)
}

/// `invert(rom_offset, mapper_state)`: no **estado dado**, tódolos enderezos que
/// traducen a ese offset. Xanelas coa mesma base producen aliases distintos e
/// a lista pode estar baleira (offset inexistente), que é resposta válida.
pub fn invert(rom_offset: u32, state: &MapperState) -> Result<Vec<u32>, AddressingError> {
    validate_state(state)?;
    let size = state
        .checked_rom_size(PROFILE_ID)
        .expect("validate_state xa aceptou o tamaño");
    if rom_offset >= size {
        return Ok(Vec::new());
    }
    let mut aliases = Vec::new();
    for window in 0..8u32 {
        let base = if window == 0 {
            0
        } else {
            window_base(window, state, size)
        };
        let last = base + WINDOW_OFFSET_MASK;
        if rom_offset >= base && rom_offset <= last {
            aliases.push(window * WINDOW_SIZE + (rom_offset - base));
        }
    }
    aliases.sort_unstable();
    Ok(aliases)
}

/// Escrita dun rexistrador de banco (`$A13000-$A130FF`).
///
/// **Pura**: devolve un estado novo e nunca muta o recibido, así que quen
/// compare antes/despois pode facelo sobre dous estados reais.
///
/// Decodificación como `mapper_ssf2_w`: `w = (addr & 0x0E) >> 1` — os bits 1-3
/// do enderezo. `w == 0` non ten efecto (a xanela 0 é fixa), así que se devolve
/// o estado igual. `data` é `u8`: un rexistro escribe un byte, e o tipo xa
/// impide o `> 0xFF` que a referencia comprobaba a man.
pub fn write_mapper_register(
    cpu_address: u32,
    data: u8,
    state: &MapperState,
) -> Result<MapperState, AddressingError> {
    validate_state(state)?;
    if cpu_address > BUS_LIMIT {
        return Err(err(
            ErrorCode::OutOfRange,
            "cpu_address debe ser un enteiro dentro do barramento de 24 bits",
        ));
    }
    if !(REGISTER_PAGE_START..=REGISTER_PAGE_END).contains(&cpu_address) {
        return Err(err(
            ErrorCode::Unsupported,
            format!(
                "escrita en {:#x} non pertence á páxina de rexistradores SSF2 ($A13000-$A130FF)",
                cpu_address
            ),
        ));
    }
    let window = (cpu_address & 0x0E) >> 1;
    let mut banks: Vec<(String, Value)> = match state.object("banks") {
        Some(entries) => entries.to_vec(),
        None => Vec::new(),
    };
    if window > 0 {
        let key = window.to_string();
        let value = Value::Uint(u64::from(data));
        match banks.iter_mut().find(|(k, _)| *k == key) {
            Some(slot) => slot.1 = value,
            None => banks.push((key, value)),
        }
    }
    Ok(with_banks(state, banks))
}

/// Estado novo co obxecto `banks` substituído, conservando o resto das claves
/// (a referencia normalizaba a `{rom_size, banks}`; tirar claves da chamante
/// sería silencioso demais para unha biblioteca de evidencia).
fn with_banks(state: &MapperState, banks: Vec<(String, Value)>) -> MapperState {
    let mut entries: Vec<(String, Value)> = state
        .keys
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    if let Some(slot) = entries.iter_mut().find(|(k, _)| k == "banks") {
        slot.1 = Value::Object(banks);
    } else {
        entries.push(("banks".to_string(), Value::Object(banks)));
    }
    MapperState::from_entries(entries)
}

/// `read(cpu_address, length, mapper_state, rom)`: **un segmento por xanela**,
/// aínda que dúas xanelas apunten a bases contiguas na ROM. Non se emenda: a
/// identidade da xanela é parte do que se observa.
pub fn read(
    cpu_address: u32,
    length: u32,
    state: &MapperState,
    rom: &[u8],
) -> Result<Vec<Segment>, AddressingError> {
    if cpu_address > BUS_LIMIT {
        return Err(err(
            ErrorCode::OutOfRange,
            format!(
                "enderezo {:#x} excede o barramento de 24 bits do 68000",
                cpu_address
            ),
        ));
    }
    if length < 1 {
        return Err(err(
            ErrorCode::OutOfRange,
            "length debe ser un enteiro >= 1",
        ));
    }
    validate_state(state)?;

    let mut segments: Vec<Segment> = Vec::new();
    let mut cursor = u64::from(cpu_address);
    let end = u64::from(cpu_address) + u64::from(length);
    while cursor < end {
        let Ok(addr) = u32::try_from(cursor) else {
            segments.push(Segment::Invalid(err(
                ErrorCode::OutOfRange,
                "a lectura xa superou o barramento de 24 bits",
            )));
            break;
        };
        match translate(addr, state) {
            Translate::Invalid(e) => {
                segments.push(Segment::Invalid(e));
                break;
            }
            Translate::Device { region, offset } => {
                segments.push(Segment::DeviceNoBacking {
                    region,
                    offset,
                    error_code: ErrorCode::Unsupported,
                });
                break;
            }
            Translate::Rom { offset } => {
                let window = cursor / u64::from(WINDOW_SIZE);
                let left_in_window = (window + 1) * u64::from(WINDOW_SIZE) - cursor;
                let run = usize::try_from((end - cursor).min(left_in_window))
                    .expect("un corredor non pode superar a xanela de 4MB");
                debug_assert!(
                    run >= 1,
                    "corredor baleiro: a fórmula de offset e a anchura do espeillo non son consistentes"
                );
                let start = offset as usize;
                if start + run > rom.len() {
                    // Imaxe máis curta que o declarado: devólvese o prefixo
                    // válido e o faltante queda como erro explícito, sen clamp.
                    if start < rom.len() {
                        segments.push(Segment::Bytes {
                            region: crate::Region::Rom,
                            offset,
                            bytes: rom[start..].to_vec(),
                        });
                    }
                    segments.push(Segment::Invalid(err(
                        ErrorCode::OutOfRange,
                        format!(
                            "ROM ({} bytes) máis curta que rom_size declarado; trecho faltante a partir do offset {:#x}",
                            rom.len(),
                            offset
                        ),
                    )));
                    break;
                }
                segments.push(Segment::Bytes {
                    region: crate::Region::Rom,
                    offset,
                    bytes: rom[start..start + run].to_vec(),
                });
                cursor += run as u64;
            }
        }
    }
    Ok(segments)
}
