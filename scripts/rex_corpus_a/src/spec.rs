//! Lectura das declaracións de vector (`negative/*.expected.json`) da
//! referencia Kosinski fixada.
//!
//! Non é un parser JSON xeral: os ficheiros da referencia son obxectos planos
//! nunha soa liña, e só nos interesan catro claves escalares. Un parser
//! xeral sería máis superficie da que esta misión necesita verificar, e un
//! `grep` en texto crudo aceptaría calquera mención dentro da nota de
//! procedencia. `campo_declarado` esixe que a clave vaia seguida de `:`, que
//! é o que fai que unha mención dentro dun valor non conte.

use std::fmt::Write as _;

/// O que a referencia declara sobre un fluxo negativo.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct NegativoDeclarado {
    /// `expected_error`: a razón pola que debe ser rexeitado.
    pub expected_error: Option<String>,
    /// `mirror_condition`: o token do espello Python independente. Regístrese
    /// como procedencia; non executamos o espello desde aquí.
    pub mirror_condition: Option<String>,
    /// `max_out`: límite de saída declarado, `null` significa «o por defecto».
    pub max_out: Option<usize>,
    /// `stream_len`: bytes que a referencia espera no ficheiro `.kos`.
    pub stream_len: Option<usize>,
}

/// Devolve o valor escalar declarado para `clave`, ou `Ningures` se a clave
/// non aparece como clave (unha mención dentro dun valor non conta).
pub fn campo_declarado(texto: &str, clave: &str) -> Option<String> {
    let busca = formato_clave(clave)?;
    let inicio = texto.find(&busca)? + busca.len();
    let resto = texto[inicio..].trim_start();
    let resto = resto.strip_prefix(':')?.trim_start();
    if let Some(cadea) = resto.strip_prefix('"') {
        let fin = atopar_peche(cadea)?;
        return Some(cadea[..fin].to_string());
    }
    let fin = resto.find([',', '}']).unwrap_or(resto.len());
    let token = resto[..fin].trim();
    if token.is_empty() {
        None
    } else {
        Some(token.to_string())
    }
}

/// `"clave"` — constrúese a man para que un erro de formato sexa un `None`,
/// nunca unha panzada.
fn formato_clave(clave: &str) -> Option<String> {
    if clave.is_empty() || clave.contains('"') || clave.contains('\\') {
        return None;
    }
    let mut s = String::with_capacity(clave.len() + 2);
    let _ = write!(s, "\"{clave}\"");
    Some(s)
}

/// Índice do `"` que pecha unha cadea, saltando os escapados con `\`.
fn atopar_peche(cadea: &str) -> Option<usize> {
    let bytes = cadea.as_bytes();
    let mut escapado = false;
    for (i, b) in bytes.iter().enumerate() {
        if escapado {
            escapado = false;
        } else if *b == b'\\' {
            escapado = true;
        } else if *b == b'"' {
            return Some(i);
        }
    }
    None
}

fn numero(texto: &str, clave: &str) -> Option<usize> {
    match campo_declarado(texto, clave)?.as_str() {
        "null" => None,
        outro => outro.parse::<usize>().ok(),
    }
}

pub fn negativo_de(texto: &str) -> NegativoDeclarado {
    NegativoDeclarado {
        expected_error: campo_declarado(texto, "expected_error").filter(|s| s != "null"),
        mirror_condition: campo_declarado(texto, "mirror_condition").filter(|s| s != "null"),
        max_out: numero(texto, "max_out"),
        stream_len: numero(texto, "stream_len"),
    }
}

/// Tradución da etiqueta do contrato ao token que produce este CLI. `None`
/// significa «a referencia declara algo que non sabemos comparar»: hai que
/// dicilo, non asumilo.
pub fn token_declarado(etiqueta: &str) -> Option<&'static str> {
    match etiqueta {
        "truncated" => Some("fluxo-truncado"),
        "invalid-reference" => Some("referencia-invalida"),
        "excessive-output" => Some("saida-excesiva"),
        "work-limit" => Some("orzamento-escosado"),
        "empty-input" => Some("entrada-baleira"),
        _ => None,
    }
}
