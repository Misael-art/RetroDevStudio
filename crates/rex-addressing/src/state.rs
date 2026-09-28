//! Estado do mapper tal e como o entrega a capa chamante.
//!
//! É deliberadamente **não** tipado forte: `MapperState` é o rexistro do que
//! viu a frontada (JSON dun manifest, TOML de axuste, entrada de UI), e o
//! contrato pide que cada perfil *rexeite* o que non coñeza con erros
//! estruturados, non que o parser adiviñe. Por iso un `rom_size` pode chegar
//! como texto, como número non enteiro ou como obxecto: eses son casos de test
//! reais dos vectores pinados.
//!
//! Os escalares si levan tipo (`cpu_address: u32`, `rom_offset: u32`,
//! `length: u32`): a frontada convérteos antes de chamar.

use std::collections::BTreeMap;

use crate::error::{AddressingError, ErrorCode};

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Value {
    Null,
    Bool(bool),
    /// Enteiro non negativo tal como vén da frontada.
    Uint(u64),
    /// Enteiro negativo: sempre inválido como tamaño, banco ou offset.
    Int(i64),
    /// Número con fracción ou expoñente (ex.: `1.5`). Non se convierte:
    /// calquera conversión sería inventar.
    NonInteger(String),
    Text(String),
    Object(Vec<(String, Value)>),
}

impl Value {
    /// Enteiro non negativo ou `None`.
    pub fn as_uint(&self) -> Option<u64> {
        match self {
            Value::Uint(n) => Some(*n),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MapperState {
    pub keys: BTreeMap<String, Value>,
}

impl MapperState {
    pub fn empty() -> MapperState {
        MapperState::default()
    }

    pub fn from_entries(entries: Vec<(String, Value)>) -> MapperState {
        MapperState {
            keys: entries.into_iter().collect(),
        }
    }

    /// O único estado que teñen os perfis sen mapper.
    pub fn rom_size(size: u64) -> MapperState {
        MapperState::from_entries(vec![("rom_size".to_string(), Value::Uint(size))])
    }

    /// Estado SSF2: `rom_size` máis bancos escritos (`1..=7`). As claves son
    /// texto, como na serie JSON do manifiesto.
    pub fn ssf2(size: u64, banks: &[(u64, u64)]) -> MapperState {
        MapperState::from_entries(vec![
            ("rom_size".to_string(), Value::Uint(size)),
            (
                "banks".to_string(),
                Value::Object(
                    banks
                        .iter()
                        .map(|(w, v)| (w.to_string(), Value::Uint(*v)))
                        .collect(),
                ),
            ),
        ])
    }

    pub fn get(&self, key: &str) -> Option<&Value> {
        self.keys.get(key)
    }

    pub fn keys(&self) -> impl Iterator<Item = &String> {
        self.keys.keys()
    }

    pub fn has(&self, key: &str) -> bool {
        self.keys.contains_key(key)
    }

    pub fn object(&self, key: &str) -> Option<&[(String, Value)]> {
        match self.get(key)? {
            Value::Object(entries) => Some(entries),
            _ => None,
        }
    }

    /// `rom_size` validado como `u32`, ou o erro estruturado do perfil.
    pub(crate) fn checked_rom_size(&self, profile: &str) -> Result<u32, AddressingError> {
        let Some(value) = self.get("rom_size") else {
            return Err(AddressingError::new(
                ErrorCode::Unsupported,
                format!("perfil {profile}: mapper_state sen rom_size (enteiro >= 0)"),
            ));
        };
        match value.as_uint() {
            Some(n) => u32::try_from(n).map_err(|_| {
                AddressingError::new(
                    ErrorCode::Unsupported,
                    format!("perfil {profile}: rom_size {n} fóra do rango de 32 bits"),
                )
            }),
            None => Err(AddressingError::new(
                ErrorCode::Unsupported,
                format!(
                    "perfil {profile}: mapper_state.rom_size debe ser un enteiro >= 0, atopado {value:?}"
                ),
            )),
        }
    }
}
