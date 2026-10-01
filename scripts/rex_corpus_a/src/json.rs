//! Serializador JSON minimo, sen dependencias.
//!
//! As claves renderizanse no orden en que se engaden: o resultado é
//! determinista e comparable byte a byte entre execucións.
//!
//! Escapado: comilla, barra invertida, `\n`, `\r`, `\t` teen forma curta;
//! todo control char (< 0x20) e DEL (0x7F) van como `\u00XX` en hex minúscula.
//! Os demás puntos Unicode saen como UTF-8 literal, incluídos os acentos dos
//! títulos (`Ç`, `Ó`), para que o manifesto siga lexible.

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Value {
    Null,
    Bool(bool),
    Int(i64),
    Str(String),
    List(Vec<Value>),
    Object(Vec<(String, Value)>),
}

impl Value {
    /// Sentinela para un campo que **non se mediu**: distincto de `null`,
    /// de cero e de calquera estimación.
    pub fn not_measured() -> Value {
        Value::Str("not_measured".to_string())
    }
}

/// Devolve o literal JSON completo dunha cadea, **entre comillas**.
pub fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for ch in text.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 || c == '\u{7f}' => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

pub fn render(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(b) => (if *b { "true" } else { "false" }).to_string(),
        Value::Int(i) => i.to_string(),
        Value::Str(s) => escape(s),
        Value::List(items) => {
            let mut out = String::from("[");
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&render(item));
            }
            out.push(']');
            out
        }
        Value::Object(pairs) => {
            let mut out = String::from("{");
            for (i, (k, v)) in pairs.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&escape(k));
                out.push(':');
                out.push_str(&render(v));
            }
            out.push('}');
            out
        }
    }
}
