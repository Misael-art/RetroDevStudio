//! Axudas de conversión entre o que din os vectores (JSON) e os tipos do crate.
//! Só para tests.

use rex_addressing::state::{MapperState, Value};
use rex_addressing::{ErrorCode, Region};

use super::vectors::{RawState, RawValue};

pub fn to_mapper_state(raw: &RawState) -> MapperState {
    let mut entries = Vec::with_capacity(raw.entries.len());
    for (key, value) in &raw.entries {
        let value = if key == "banks" && matches!(value, RawValue::Structure) {
            Value::Object(
                raw.banks_raw
                    .as_ref()
                    .map(|items| {
                        items
                            .iter()
                            .map(|(k, v)| (k.clone(), to_value(v)))
                            .collect()
                    })
                    .unwrap_or_default(),
            )
        } else {
            to_value(value)
        };
        entries.push((key.clone(), value));
    }
    MapperState::from_entries(entries)
}

pub fn to_value(value: &RawValue) -> Value {
    match value {
        RawValue::Null => Value::Null,
        RawValue::Bool(b) => Value::Bool(*b),
        RawValue::Uint(n) => Value::Uint(*n),
        RawValue::Neg(n) => Value::Int(*n),
        RawValue::NonInteger(s) => Value::NonInteger(s.clone()),
        RawValue::Text(s) => Value::Text(s.clone()),
        RawValue::Structure => Value::Object(Vec::new()),
    }
}

pub fn region(name: &str) -> Region {
    match name {
        "rom" => Region::Rom,
        "z80-ram" => Region::Z80Ram,
        "io" => Region::Io,
        "cart-io" => Region::CartIo,
        "work-ram" => Region::WorkRam,
        "wram" => Region::Wram,
        "wram-mirror" => Region::WramMirror,
        "sram" => Region::Sram,
        other => panic!("rexión non contractal: {other}"),
    }
}

pub fn code(name: &str) -> ErrorCode {
    match name {
        "out-of-range" => ErrorCode::OutOfRange,
        "unsupported" => ErrorCode::Unsupported,
        "ambiguous" => ErrorCode::Ambiguous,
        other => panic!("código de erro non contractal: {other}"),
    }
}

pub fn u32(n: u64) -> u32 {
    u32::try_from(n).unwrap_or_else(|_| panic!("valor {n} fóra de u32"))
}
