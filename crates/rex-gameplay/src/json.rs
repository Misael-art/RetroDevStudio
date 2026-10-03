//! JSON minimo (objetos, listas, strings, inteiros, booleanos, null) para
//! persistir o grafo no formato NodeGraph v1 sem dependencia externa.
//! Numeros fracionarios e expoentes sao recusados: o grafo so carrega inteiros.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Json {
    Null,
    Bool(bool),
    Int(i64),
    Str(String),
    Arr(Vec<Json>),
    Obj(Vec<(String, Json)>),
}

impl Json {
    pub fn obj(fields: Vec<(&str, Json)>) -> Json {
        Json::Obj(
            fields
                .into_iter()
                .map(|(k, v)| (k.to_string(), v))
                .collect(),
        )
    }

    pub fn str(value: impl Into<String>) -> Json {
        Json::Str(value.into())
    }

    pub fn get(&self, key: &str) -> Option<&Json> {
        match self {
            Json::Obj(fields) => fields.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }

    pub fn field(&self, key: &str) -> Result<&Json, String> {
        self.get(key)
            .ok_or_else(|| format!("campo '{key}' ausente"))
    }

    pub fn as_i64(&self) -> Result<i64, String> {
        match self {
            Json::Int(value) => Ok(*value),
            other => Err(format!("inteiro esperado, obtido {other:?}")),
        }
    }

    pub fn as_str(&self) -> Result<&str, String> {
        match self {
            Json::Str(value) => Ok(value),
            other => Err(format!("string esperada, obtido {other:?}")),
        }
    }

    pub fn as_bool(&self) -> Result<bool, String> {
        match self {
            Json::Bool(value) => Ok(*value),
            other => Err(format!("booleano esperado, obtido {other:?}")),
        }
    }

    pub fn as_arr(&self) -> Result<&[Json], String> {
        match self {
            Json::Arr(items) => Ok(items),
            other => Err(format!("lista esperada, obtido {other:?}")),
        }
    }

    pub fn i64_at(&self, key: &str) -> Result<i64, String> {
        self.field(key)?.as_i64().map_err(|e| format!("{key}: {e}"))
    }

    pub fn str_at(&self, key: &str) -> Result<&str, String> {
        self.field(key)?.as_str().map_err(|e| format!("{key}: {e}"))
    }

    /// Serializacao estavel com indentacao de 2 espacos.
    pub fn pretty(&self) -> String {
        let mut out = String::new();
        write_value(self, 0, &mut out);
        out.push('\n');
        out
    }

    pub fn parse(text: &str) -> Result<Json, String> {
        let mut parser = Parser {
            bytes: text.as_bytes(),
            pos: 0,
            depth: 0,
        };
        let value = parser.value()?;
        parser.ws();
        if parser.pos != parser.bytes.len() {
            return Err(format!("conteudo apos o JSON na posicao {}", parser.pos));
        }
        Ok(value)
    }
}

fn escape(text: &str, out: &mut String) {
    out.push('"');
    for ch in text.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

fn write_value(value: &Json, indent: usize, out: &mut String) {
    let pad = |n: usize| "  ".repeat(n);
    match value {
        Json::Null => out.push_str("null"),
        Json::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Json::Int(i) => out.push_str(&i.to_string()),
        Json::Str(s) => escape(s, out),
        Json::Arr(items) if items.is_empty() => out.push_str("[]"),
        Json::Obj(fields) if fields.is_empty() => out.push_str("{}"),
        Json::Arr(items) => {
            out.push_str("[\n");
            for (i, item) in items.iter().enumerate() {
                out.push_str(&pad(indent + 1));
                write_value(item, indent + 1, out);
                out.push_str(if i + 1 < items.len() { ",\n" } else { "\n" });
            }
            out.push_str(&pad(indent));
            out.push(']');
        }
        Json::Obj(fields) => {
            out.push_str("{\n");
            for (i, (key, item)) in fields.iter().enumerate() {
                out.push_str(&pad(indent + 1));
                escape(key, out);
                out.push_str(": ");
                write_value(item, indent + 1, out);
                out.push_str(if i + 1 < fields.len() { ",\n" } else { "\n" });
            }
            out.push_str(&pad(indent));
            out.push('}');
        }
    }
}

struct Parser<'a> {
    bytes: &'a [u8],
    pos: usize,
    depth: usize,
}

impl Parser<'_> {
    fn ws(&mut self) {
        while self.pos < self.bytes.len() && self.bytes[self.pos].is_ascii_whitespace() {
            self.pos += 1;
        }
    }

    fn expect(&mut self, byte: u8) -> Result<(), String> {
        self.ws();
        if self.bytes.get(self.pos) == Some(&byte) {
            self.pos += 1;
            Ok(())
        } else {
            Err(format!(
                "'{}' esperado na posicao {}",
                byte as char, self.pos
            ))
        }
    }

    fn value(&mut self) -> Result<Json, String> {
        self.ws();
        self.depth += 1;
        if self.depth > 64 {
            return Err("JSON aninhado demais".to_string());
        }
        let result = match self.bytes.get(self.pos) {
            Some(b'{') => self.object(),
            Some(b'[') => self.array(),
            Some(b'"') => self.string().map(Json::Str),
            Some(b't') => self.literal("true", Json::Bool(true)),
            Some(b'f') => self.literal("false", Json::Bool(false)),
            Some(b'n') => self.literal("null", Json::Null),
            Some(b'-' | b'0'..=b'9') => self.number(),
            _ => Err(format!("valor JSON invalido na posicao {}", self.pos)),
        };
        self.depth -= 1;
        result
    }

    fn literal(&mut self, word: &str, value: Json) -> Result<Json, String> {
        if self.bytes[self.pos..].starts_with(word.as_bytes()) {
            self.pos += word.len();
            Ok(value)
        } else {
            Err(format!("literal invalido na posicao {}", self.pos))
        }
    }

    fn number(&mut self) -> Result<Json, String> {
        let start = self.pos;
        if self.bytes[self.pos] == b'-' {
            self.pos += 1;
        }
        while self.pos < self.bytes.len() && self.bytes[self.pos].is_ascii_digit() {
            self.pos += 1;
        }
        if matches!(self.bytes.get(self.pos), Some(b'.' | b'e' | b'E')) {
            return Err(format!("numero nao inteiro na posicao {start}; recusado"));
        }
        std::str::from_utf8(&self.bytes[start..self.pos])
            .ok()
            .and_then(|text| text.parse::<i64>().ok())
            .map(Json::Int)
            .ok_or_else(|| format!("inteiro invalido na posicao {start}"))
    }

    fn string(&mut self) -> Result<String, String> {
        self.expect(b'"')?;
        let mut out = String::new();
        loop {
            let rest = &self.bytes[self.pos..];
            let Some(&byte) = rest.first() else {
                return Err("string sem fechamento".to_string());
            };
            match byte {
                b'"' => {
                    self.pos += 1;
                    return Ok(out);
                }
                b'\\' => {
                    let esc = *rest.get(1).ok_or("escape truncado")?;
                    self.pos += 2;
                    match esc {
                        b'"' => out.push('"'),
                        b'\\' => out.push('\\'),
                        b'/' => out.push('/'),
                        b'n' => out.push('\n'),
                        b'r' => out.push('\r'),
                        b't' => out.push('\t'),
                        b'b' => out.push('\u{8}'),
                        b'f' => out.push('\u{c}'),
                        b'u' => {
                            let hex = self
                                .bytes
                                .get(self.pos..self.pos + 4)
                                .and_then(|h| std::str::from_utf8(h).ok())
                                .and_then(|h| u32::from_str_radix(h, 16).ok())
                                .ok_or("escape \\u invalido")?;
                            self.pos += 4;
                            out.push(char::from_u32(hex).ok_or("escape \\u fora de BMP simples")?);
                        }
                        _ => return Err("escape invalido".to_string()),
                    }
                }
                _ => {
                    let len = match byte {
                        0x00..=0x7F => 1,
                        0xC0..=0xDF => 2,
                        0xE0..=0xEF => 3,
                        _ => 4,
                    };
                    let chunk = rest.get(..len).ok_or("UTF-8 truncado")?;
                    out.push_str(std::str::from_utf8(chunk).map_err(|_| "UTF-8 invalido")?);
                    self.pos += len;
                }
            }
        }
    }

    fn array(&mut self) -> Result<Json, String> {
        self.expect(b'[')?;
        let mut items = Vec::new();
        self.ws();
        if self.bytes.get(self.pos) == Some(&b']') {
            self.pos += 1;
            return Ok(Json::Arr(items));
        }
        loop {
            items.push(self.value()?);
            self.ws();
            match self.bytes.get(self.pos) {
                Some(b',') => self.pos += 1,
                Some(b']') => {
                    self.pos += 1;
                    return Ok(Json::Arr(items));
                }
                _ => return Err(format!("',' ou ']' esperado na posicao {}", self.pos)),
            }
        }
    }

    fn object(&mut self) -> Result<Json, String> {
        self.expect(b'{')?;
        let mut fields: Vec<(String, Json)> = Vec::new();
        self.ws();
        if self.bytes.get(self.pos) == Some(&b'}') {
            self.pos += 1;
            return Ok(Json::Obj(fields));
        }
        loop {
            self.ws();
            let key = self.string()?;
            if fields.iter().any(|(k, _)| *k == key) {
                return Err(format!("chave duplicada '{key}'"));
            }
            self.expect(b':')?;
            let value = self.value()?;
            fields.push((key, value));
            self.ws();
            match self.bytes.get(self.pos) {
                Some(b',') => self.pos += 1,
                Some(b'}') => {
                    self.pos += 1;
                    return Ok(Json::Obj(fields));
                }
                _ => return Err(format!("',' ou '}}' esperado na posicao {}", self.pos)),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Json;

    #[test]
    fn round_trips_and_refuses_non_integers() {
        let value = Json::obj(vec![
            ("a", Json::Int(-5)),
            ("s", Json::str("x\"y\u{e7}")),
            ("l", Json::Arr(vec![Json::Bool(true), Json::Null])),
            ("o", Json::Obj(vec![])),
        ]);
        assert_eq!(Json::parse(&value.pretty()).unwrap(), value);
        assert!(Json::parse("1.5").is_err());
        assert!(Json::parse("{\"a\":1,\"a\":2}")
            .unwrap_err()
            .contains("duplicada"));
        assert!(Json::parse("[1,]").is_err());
    }
}
