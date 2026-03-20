//! Helpers de desserialização tolerantes a tipos (ex: float em campo i32).

use serde::{Deserialize, Deserializer};

/// Desserializa número (i32 ou f64) para i32. Tolerante a JSON com floats (ex: 0.0) vindos
/// de importador SGDK ou edição manual. Trunca o valor para i32.
pub fn deserialize_f64_to_i32<'de, D>(deserializer: D) -> Result<i32, D::Error>
where
    D: Deserializer<'de>,
{
    use serde::de::Error;
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum IntOrFloat {
        Int(i32),
        Float(f64),
        Null,
    }
    match IntOrFloat::deserialize(deserializer)? {
        IntOrFloat::Int(v) => Ok(v),
        IntOrFloat::Null => Ok(0),
        IntOrFloat::Float(v) => {
            let truncated = v.trunc();
            if truncated >= i32::MIN as f64 && truncated <= i32::MAX as f64 {
                Ok(truncated as i32)
            } else {
                Err(D::Error::custom(format!(
                    "float {} fora do range i32",
                    v
                )))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[test]
    fn deserialize_f64_to_i32_accepts_int() {
        #[derive(Deserialize)]
        struct Wrapper {
            #[serde(deserialize_with = "deserialize_f64_to_i32")]
            value: i32,
        }
        let w: Wrapper = serde_json::from_str(r#"{"value": 42}"#).unwrap();
        assert_eq!(w.value, 42);
    }

    #[test]
    fn deserialize_f64_to_i32_accepts_float() {
        #[derive(Deserialize)]
        struct Wrapper {
            #[serde(deserialize_with = "deserialize_f64_to_i32")]
            value: i32,
        }
        let w: Wrapper = serde_json::from_str(r#"{"value": 0.0}"#).unwrap();
        assert_eq!(w.value, 0);
        let w2: Wrapper = serde_json::from_str(r#"{"value": 48.7}"#).unwrap();
        assert_eq!(w2.value, 48);
    }
}
