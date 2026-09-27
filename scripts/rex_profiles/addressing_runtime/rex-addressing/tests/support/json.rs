// Parser JSON mínimo, só para tests. Sobe o subconxunto que aparece nos
// ficheiros de vectores: obxectos, arrays, strings con escapes, números e
// booleans/null. Os números enteiros dan `Num`/`NegNum`; un número non
// enteiro (fracción ou expoñente) dan `NonInteger(texto)`, porque as fixtures
// negativas os usan *deliberadamente* para probar que o perfil rexeita estados
// malformados. O parser nunca converte un non-enteiro en enteiro: iso si
// sería adiviñar.

#[derive(Clone, Debug, PartialEq)]
pub enum Json {
    Null,
    Bool(bool),
    Num(u64),
    NegNum(i64),
    NonInteger(String),
    Str(String),
    Arr(Vec<Json>),
    Obj(Vec<(String, Json)>),
}

impl Json {
    pub fn parse(src: &str) -> Result<Json, String> {
        let mut p = Parser {
            b: src.as_bytes(),
            i: 0,
        };
        p.ws();
        let v = p.value()?;
        p.ws();
        if p.i != p.b.len() {
            return Err(format!("trailing bytes at {}", p.i));
        }
        Ok(v)
    }

    pub fn get<'a>(&'a self, key: &str) -> Option<&'a Json> {
        match self {
            Json::Obj(entries) => entries.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }

    pub fn arr(&self) -> Option<&[Json]> {
        match self {
            Json::Arr(v) => Some(v),
            _ => None,
        }
    }

    pub fn obj(&self) -> Option<&[(String, Json)]> {
        match self {
            Json::Obj(v) => Some(v),
            _ => None,
        }
    }

    pub fn as_u64(&self) -> Option<u64> {
        match self {
            Json::Num(n) => Some(*n),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Json::Str(s) => Some(s.as_str()),
            _ => None,
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Json::Bool(b) => Some(*b),
            _ => None,
        }
    }

    /// `0x`-prefixed hex string, decimal string, or JSON number.
    pub fn as_int_value(&self) -> Option<u64> {
        match self {
            Json::Num(n) => Some(*n),
            Json::Str(s) => {
                if let Some(hex) = s.strip_prefix("0x").or_else(|| s.strip_prefix("0X")) {
                    u64::from_str_radix(hex, 16).ok()
                } else {
                    s.parse::<u64>().ok()
                }
            }
            _ => None,
        }
    }
}

struct Parser<'a> {
    b: &'a [u8],
    i: usize,
}

impl<'a> Parser<'a> {
    fn ws(&mut self) {
        while self.i < self.b.len() {
            match self.b[self.i] {
                b' ' | b'\t' | b'\n' | b'\r' => self.i += 1,
                _ => break,
            }
        }
    }

    fn peek(&self) -> Option<u8> {
        self.b.get(self.i).copied()
    }

    fn expect(&mut self, c: u8) -> Result<(), String> {
        if self.peek() == Some(c) {
            self.i += 1;
            Ok(())
        } else {
            Err(format!("expected '{}' at {}", c as char, self.i))
        }
    }

    fn value(&mut self) -> Result<Json, String> {
        match self.peek() {
            Some(b'{') => self.object(),
            Some(b'[') => self.array(),
            Some(b'"') => Ok(Json::Str(self.string()?)),
            Some(b't') | Some(b'f') => self.boolean(),
            Some(b'n') => self.null(),
            Some(c) if c.is_ascii_digit() || c == b'-' => self.number(),
            Some(c) => Err(format!("unexpected byte '{}' at {}", c as char, self.i)),
            None => Err(format!("unexpected end at {}", self.i)),
        }
    }

    fn object(&mut self) -> Result<Json, String> {
        self.expect(b'{')?;
        let mut entries = Vec::new();
        self.ws();
        if self.peek() == Some(b'}') {
            self.i += 1;
            return Ok(Json::Obj(entries));
        }
        loop {
            self.ws();
            let key = self.string()?;
            self.ws();
            self.expect(b':')?;
            self.ws();
            let value = self.value()?;
            entries.push((key, value));
            self.ws();
            match self.peek() {
                Some(b',') => {
                    self.i += 1;
                }
                Some(b'}') => {
                    self.i += 1;
                    return Ok(Json::Obj(entries));
                }
                _ => return Err(format!("expected ',' or '}}' at {}", self.i)),
            }
        }
    }

    fn array(&mut self) -> Result<Json, String> {
        self.expect(b'[')?;
        let mut items = Vec::new();
        self.ws();
        if self.peek() == Some(b']') {
            self.i += 1;
            return Ok(Json::Arr(items));
        }
        loop {
            self.ws();
            items.push(self.value()?);
            self.ws();
            match self.peek() {
                Some(b',') => {
                    self.i += 1;
                }
                Some(b']') => {
                    self.i += 1;
                    return Ok(Json::Arr(items));
                }
                _ => return Err(format!("expected ',' or ']' at {}", self.i)),
            }
        }
    }

    fn string(&mut self) -> Result<String, String> {
        self.expect(b'"')?;
        // Os ficheiros de vectores levan texto UTF-8 (galego/portugués).
        // Acumulamos bytes e convertemos ao final: ningún byte se perde.
        let mut raw: Vec<u8> = Vec::new();
        loop {
            let c = self
                .peek()
                .ok_or_else(|| format!("unterminated string at {}", self.i))?;
            self.i += 1;
            match c {
                b'"' => {
                    return String::from_utf8(raw)
                        .map_err(|_| format!("invalid utf-8 in string at {}", self.i));
                }
                b'\\' => {
                    let e = self
                        .peek()
                        .ok_or_else(|| format!("bad escape at {}", self.i))?;
                    self.i += 1;
                    match e {
                        b'"' => raw.push(b'"'),
                        b'\\' => raw.push(b'\\'),
                        b'/' => raw.push(b'/'),
                        b'n' => raw.push(b'\n'),
                        b't' => raw.push(b'\t'),
                        b'r' => raw.push(b'\r'),
                        b'b' => raw.push(0x08),
                        b'f' => raw.push(0x0c),
                        b'u' => {
                            let ch = self.unicode_escape()?;
                            let mut buf = [0u8; 4];
                            raw.extend_from_slice(ch.encode_utf8(&mut buf).as_bytes());
                        }
                        _ => {
                            return Err(format!(
                                "unsupported escape '\\{}' at {}",
                                e as char, self.i
                            ))
                        }
                    }
                }
                _ => raw.push(c),
            }
        }
    }

    fn unicode_escape(&mut self) -> Result<char, String> {
        let hi = self.hex4()?;
        // pares de surrogados: o subconxunto dos ficheiros non os usa, pero
        // resolvelos evita un erro silencioso se aparecen.
        if (0xd800..0xdc00).contains(&hi) {
            if self.peek() != Some(b'\\') {
                return Err(format!("lone surrogate at {}", self.i));
            }
            self.i += 1;
            self.expect(b'u')?;
            let lo = self.hex4()?;
            if !(0xdc00..0xe000).contains(&lo) {
                return Err(format!("bad surrogate pair at {}", self.i));
            }
            let cp = 0x10000 + ((hi - 0xd800) << 10) + (lo - 0xdc00);
            return char::from_u32(cp).ok_or_else(|| format!("invalid code point {cp:#x}"));
        }
        char::from_u32(hi).ok_or_else(|| format!("invalid code point {hi:#x}"))
    }

    fn hex4(&mut self) -> Result<u32, String> {
        if self.i + 4 > self.b.len() {
            return Err(format!("short \\u escape at {}", self.i));
        }
        let s = std::str::from_utf8(&self.b[self.i..self.i + 4])
            .map_err(|_| format!("non-ascii \\u escape at {}", self.i))?;
        let v = u32::from_str_radix(s, 16).map_err(|_| format!("bad \\u escape '{s}'"))?;
        self.i += 4;
        Ok(v)
    }

    fn boolean(&mut self) -> Result<Json, String> {
        if self.b[self.i..].starts_with(b"true") {
            self.i += 4;
            Ok(Json::Bool(true))
        } else if self.b[self.i..].starts_with(b"false") {
            self.i += 5;
            Ok(Json::Bool(false))
        } else {
            Err(format!("bad literal at {}", self.i))
        }
    }

    fn null(&mut self) -> Result<Json, String> {
        if self.b[self.i..].starts_with(b"null") {
            self.i += 4;
            Ok(Json::Null)
        } else {
            Err(format!("bad literal at {}", self.i))
        }
    }

    fn number(&mut self) -> Result<Json, String> {
        let start = self.i;
        if self.peek() == Some(b'-') {
            self.i += 1;
        }
        while self.i < self.b.len() && self.b[self.i].is_ascii_digit() {
            self.i += 1;
        }
        if self.i == start || (self.i == start + 1 && self.b[start] == b'-') {
            return Err(format!("bad number at {start}"));
        }
        let mut non_integer = false;
        if self.peek() == Some(b'.') {
            non_integer = true;
            self.i += 1;
            while self.i < self.b.len() && self.b[self.i].is_ascii_digit() {
                self.i += 1;
            }
        }
        if self.peek() == Some(b'e') || self.peek() == Some(b'E') {
            non_integer = true;
            self.i += 1;
            if self.peek() == Some(b'+') || self.peek() == Some(b'-') {
                self.i += 1;
            }
            while self.i < self.b.len() && self.b[self.i].is_ascii_digit() {
                self.i += 1;
            }
        }
        let s = std::str::from_utf8(&self.b[start..self.i])
            .map_err(|_| format!("non-ascii number at {start}"))?;
        if non_integer {
            // Preservamos o texto: o perfil debe rexeitalo como «non enteiro»,
            // e unha conversión a enteiro aquí sería unha adiviñanza.
            return Ok(Json::NonInteger(s.to_string()));
        }
        if s.starts_with('-') {
            let v = s
                .parse::<i64>()
                .map_err(|_| format!("negative number out of i64 range at {start}"))?;
            return Ok(Json::NegNum(v));
        }
        s.parse::<u64>()
            .map(Json::Num)
            .map_err(|_| format!("number out of range at {start}"))
    }
}
