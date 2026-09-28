//! Erros estruturados do contrato de enderezamento.
//!
//! Un erro **nunca** se confunde cun resultado: `translate` non devolve `0`
//! cando non hai dispositivo, e `read` non clampa cando a imaxe é curta.

use std::fmt;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ErrorCode {
    /// Fóra do barramento de 24 bits, `length < 1`, ou un escalar non
    /// enteiro/ negativo onde o contrato pide un enteiro.
    OutOfRange,
    /// Rexión sen dispositivo no modelo, estado fóra do intervalo do perfil, ou
    /// claves alleas a un perfil sen estado de mapper.
    Unsupported,
    /// As fontes pinadas diverxen e ningún texto manda sobre o outro: o
    /// cartucho real decide, a biblioteca non palpita.
    Ambiguous,
}

impl ErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            ErrorCode::OutOfRange => "out-of-range",
            ErrorCode::Unsupported => "unsupported",
            ErrorCode::Ambiguous => "ambiguous",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AddressingError {
    pub code: ErrorCode,
    /// Legible para o humano que lea a evidencia. A comparación entre
    /// implementación e referencia é **por `code`**, non por texto.
    pub detail: String,
}

impl AddressingError {
    pub fn new(code: ErrorCode, detail: impl Into<String>) -> Self {
        AddressingError {
            code,
            detail: detail.into(),
        }
    }
}

impl fmt::Display for AddressingError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code.as_str(), self.detail)
    }
}

impl std::error::Error for AddressingError {}
