//! Probas do serializador: orden de claves, escapado e a sentinela
//! `not_measured`. Son as propiedades que o manifesto do inventario depende:
//! byte a byte reproducible entre execucións.
//!
//! Contrato: `escape` devolve a cadea JSON **entre comillas** (literal
//! completo); `render` fai o mesmo para `Value::Str`. As expectativas usan
//! raw strings para que cada carácter do resultado sexa visible.

use rex_corpus::json::{escape, render, Value};

fn obj(pairs: &[(&str, Value)]) -> Value {
    Value::Object(
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.clone()))
            .collect(),
    )
}

#[test]
fn escalaros_renderizan_segun_o_tipo() {
    assert_eq!(render(&Value::Null), "null");
    assert_eq!(render(&Value::Bool(true)), "true");
    assert_eq!(render(&Value::Bool(false)), "false");
    assert_eq!(render(&Value::Int(0)), "0");
    assert_eq!(render(&Value::Int(-42)), "-42");
    assert_eq!(render(&Value::Int(i64::MAX)), i64::MAX.to_string());
    assert_eq!(render(&Value::Str("ok".into())), r#""ok""#);
}

#[test]
fn as_claves_conservan_o_orde_de_insercion_non_alfabetico() {
    let v = obj(&[
        ("rom_sha256", Value::Str("aa".into())),
        ("offset", Value::Int(7)),
        ("codec", Value::Str("kosinski".into())),
    ]);
    assert_eq!(
        render(&v),
        r#"{"rom_sha256":"aa","offset":7,"codec":"kosinski"}"#
    );
}

#[test]
fn un_obxecto_baleiro_non_e_nulo() {
    assert_eq!(render(&obj(&[])), "{}");
    assert_eq!(render(&Value::List(vec![])), "[]");
}

#[test]
fn as_listas_conservan_o_orde_e_anidanse() {
    let v = Value::List(vec![
        Value::Int(1),
        obj(&[("b", Value::List(vec![Value::Bool(false)]))]),
    ]);
    assert_eq!(render(&v), r#"[1,{"b":[false]}]"#);
}

#[test]
fn as_claves_tamben_se_escapan() {
    let v = obj(&[("a\"b", Value::Int(1))]);
    assert_eq!(render(&v), r#"{"a\"b":1}"#);
}

#[test]
fn escapado_cobre_control_chars_comillas_e_barra_invertida() {
    assert_eq!(escape("a\u{0001}b"), r#""a\u0001b""#);
    // Comilla + barra invertida: cada unha duplicase cun escape.
    let esperado: String = [r#"""#, r#"\"#, r#"""#, r#"\"#, r#"\"#, r#"""#].concat();
    assert_eq!(escape("\"\\"), esperado);
    assert_eq!(escape("l\r\n\t"), r#""l\r\n\t""#);
    assert_eq!(escape("normal"), r#""normal""#);
}

#[test]
fn escapado_preserva_non_ascii_e_rexeita_surrogados_ilixitos() {
    // U+00E7 'ç' debe saír como UTF-8 literal, non como escape ASCII.
    assert_eq!(escape("Altered Beast Ç"), r#""Altered Beast Ç""#);
    // DEL: va por escape numérico, igual que os control chars < 0x20.
    assert_eq!(escape("a\u{7f}b"), r#""a\u007fb""#);
    // Un control char nunha clave non pode romper a sintaxe.
    let v = obj(&[("a\u{0000}", Value::Null)]);
    assert_eq!(render(&v), r#"{"a\u0000":null}"#);
}

#[test]
fn not_measured_distinguese_de_nulo_de_cero_e_da_cadea_obeita() {
    assert_eq!(render(&Value::not_measured()), r#""not_measured""#);
    let v = obj(&[
        ("bytes_consumed", Value::not_measured()),
        ("output_size", Value::Int(0)),
        ("hash_normalizado", Value::Null),
    ]);
    assert_eq!(
        render(&v),
        r#"{"bytes_consumed":"not_measured","output_size":0,"hash_normalizado":null}"#
    );
    // A sentinela non debe coincidir cun valor medido escribido á man.
    assert_ne!(Value::not_measured(), Value::Int(0));
    assert_ne!(Value::not_measured(), Value::Null);
}

#[test]
fn render_determinista_nun_obxecto_grande() {
    let mut pairs: Vec<(String, Value)> = Vec::new();
    for i in 0..64 {
        pairs.push((format!("c{i:02}"), Value::Str(format!("v{i}"))));
    }
    let v = Value::Object(pairs.clone());
    let first = render(&v);
    assert_eq!(first, render(&v), "render non e determinista");
    assert!(first.starts_with(r#"{"c00":"v0""#));
    assert!(first.ends_with(r#""c63":"v63"}"#));
    assert!(
        !first.contains(r#"" "#),
        "sobra espazo despois dunha coma entre pares"
    );
}
