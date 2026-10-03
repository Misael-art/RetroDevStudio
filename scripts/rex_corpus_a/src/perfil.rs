//! O perfil reutilizable `rex-corpus-perfil/v1`.
//!
//! Un perfil **non descobre nada**: pinna unha imaxe polo seu SHA-256, declara
//! o perfil de enderezamento que se mediu nela, o códec co que decodifica, a
//! orientación detectada e os límites coos que se sondeou. Así o CLI pode
//! reutilizarse doutra ROM sen transplantar offsets a memory: se a imaxe
//! entregada non é a imaxe que o perfil describe, o perfil non se aplica.
//!
//! Lese co escáner plano de [`crate::spec`], non cun parser xeral: os perfis
//! son obxectos planos de claves escalares escritos por este mesmo CLI, e un
//! parser xeral sería máis superficie da que hai que verificar.

use crate::spec::campo_declarado;

pub const SCHEMA_PERFIL: &str = "rex-corpus-perfil/v1";

/// As tres orientaciones que [`crate::layout::detect`] pode medir. Un perfil
/// que declare outra cosa está a afirmar algo que a ferramenta non sabe medir.
pub const ORIENTACIONS: [&str; 3] = ["lineal", "interlazado-smd", "non-identificada"];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MotivoPerfil {
    SenEsquema,
    EsquemaIncorrecto,
    HashCoFormaInvalida,
    CampoObrigatorioAusente,
    NumeroInvalido,
    OrientacionDescoecida,
}

impl std::fmt::Display for MotivoPerfil {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            MotivoPerfil::SenEsquema => "sen-esquema",
            MotivoPerfil::EsquemaIncorrecto => "esquema-incorrecto",
            MotivoPerfil::HashCoFormaInvalida => "hash-co-forma-invalida",
            MotivoPerfil::CampoObrigatorioAusente => "campo-obrigatorio-ausente",
            MotivoPerfil::NumeroInvalido => "numero-invalido",
            MotivoPerfil::OrientacionDescoecida => "orientacion-descoecida",
        };
        f.write_str(s)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Perfil {
    pub perfil_id: String,
    pub imaxe_normalizada_sha256: String,
    pub orientacion: String,
    pub codec: String,
    pub variante: String,
    pub estado_revision: String,
    pub desde: usize,
    /// `None` = hasta o final da imaxe.
    pub ata: Option<usize>,
    pub stride: usize,
    pub min_saida: usize,
    pub max_saida: usize,
    pub orzamento: usize,
    pub ventanxa_chamada: usize,
    pub min_entradas: usize,
    pub limite_bytes: u64,
}

impl Perfil {
    pub fn parse(texto: &str) -> Result<Perfil, MotivoPerfil> {
        match campo_declarado(texto, "schema_version") {
            None => return Err(MotivoPerfil::SenEsquema),
            Some(v) if v != SCHEMA_PERFIL => return Err(MotivoPerfil::EsquemaIncorrecto),
            Some(_) => {}
        }

        let perfil_id = texto_obrigatorio(texto, "perfil_id")?;
        let codec = texto_obrigatorio(texto, "codec")?;
        let variante = texto_obrigatorio(texto, "variante")?;
        let estado_revision = texto_obrigatorio(texto, "estado_revision")?;

        let hash = esixir_clave(texto, "imaxe_normalizada_sha256")
            .ok_or(MotivoPerfil::HashCoFormaInvalida)?;
        if !forma_sha256(&hash) {
            return Err(MotivoPerfil::HashCoFormaInvalida);
        }

        let orientacion = texto_obrigatorio(texto, "orientacion")?;
        if !ORIENTACIONS.contains(&orientacion.as_str()) {
            return Err(MotivoPerfil::OrientacionDescoecida);
        }

        Ok(Perfil {
            limite_bytes: esixir_numero(texto, "limite_bytes")? as u64,
            desde: esixir_numero(texto, "desde")?,
            ata: numero_opcional(texto, "ata")?,
            stride: esixir_numero(texto, "stride")?,
            min_saida: esixir_numero(texto, "min_saida")?,
            max_saida: esixir_numero(texto, "max_saida")?,
            orzamento: esixir_numero(texto, "orzamento")?,
            ventanxa_chamada: esixir_numero(texto, "ventanxa_chamada")?,
            min_entradas: esixir_numero(texto, "min_entradas")?,
            perfil_id,
            imaxe_normalizada_sha256: hash,
            orientacion,
            codec,
            variante,
            estado_revision,
        })
    }

    /// O perfil de enderezamento só se aplica á imaxe que pinna. `false` cando
    /// o hash medido non coincide: entón non hai trasplante, hai rexeito.
    pub fn encaza(&self, sha256_medido: &str) -> bool {
        self.imaxe_normalizada_sha256 == sha256_medido
    }

    /// Reconstrúe o JSON plano do perfil. As claves salen nunha orde fixa para
    /// que dous perfis coños mesmos bytes dean bytes iguais.
    pub fn to_json(&self) -> crate::json::Value {
        use crate::json::Value;
        let num = |n: usize| Value::Int(n as i64);
        Value::Object(vec![
            ("schema_version".into(), Value::Str(SCHEMA_PERFIL.into())),
            ("perfil_id".into(), Value::Str(self.perfil_id.clone())),
            (
                "imaxe_normalizada_sha256".into(),
                Value::Str(self.imaxe_normalizada_sha256.clone()),
            ),
            ("orientacion".into(), Value::Str(self.orientacion.clone())),
            ("codec".into(), Value::Str(self.codec.clone())),
            ("variante".into(), Value::Str(self.variante.clone())),
            (
                "estado_revision".into(),
                Value::Str(self.estado_revision.clone()),
            ),
            ("desde".into(), num(self.desde)),
            match self.ata {
                Some(n) => ("ata".into(), num(n)),
                None => ("ata".into(), Value::Null),
            },
            ("stride".into(), num(self.stride)),
            ("min_saida".into(), num(self.min_saida)),
            ("max_saida".into(), num(self.max_saida)),
            ("orzamento".into(), num(self.orzamento)),
            ("ventanxa_chamada".into(), num(self.ventanxa_chamada)),
            ("min_entradas".into(), num(self.min_entradas)),
            ("limite_bytes".into(), num(self.limite_bytes as usize)),
        ])
    }
}

/// `null` e o texto baleiro son «aquí non hai valor declarado»: dous modos de
/// dicir o mesmo, e ningún deles é un cero nin unha cadea vacía útil.
fn campo_inexistente(token: &str) -> bool {
    token.is_empty() || token == "null"
}

fn texto_obrigatorio(texto: &str, clave: &str) -> Result<String, MotivoPerfil> {
    campo_declarado(texto, clave)
        .filter(|s| !campo_inexistente(s))
        .ok_or(MotivoPerfil::CampoObrigatorioAusente)
}

/// Unha clave ausente **ou** `null` non é un número: `esixir_numero` devolve o
/// motivo correspondente en vez de estimalo.
fn esixir_clave(texto: &str, clave: &str) -> Option<String> {
    campo_declarado(texto, clave).filter(|t| !campo_inexistente(t))
}

/// Un número do perfil é decimal sen signo, ou `null` se é opcional. Calquera
/// outra forma (`-4`, `2.0`, un texto) devolve `NumeroInvalido`: un límite que
/// non se pode executar non é un límite.
fn esixir_numero(texto: &str, clave: &str) -> Result<usize, MotivoPerfil> {
    let token = esixir_clave(texto, clave).ok_or(MotivoPerfil::NumeroInvalido)?;
    decimal(&token).ok_or(MotivoPerfil::NumeroInvalido)
}

fn numero_opcional(texto: &str, clave: &str) -> Result<Option<usize>, MotivoPerfil> {
    match campo_declarado(texto, clave) {
        Some(token) if !campo_inexistente(&token) => decimal(&token)
            .map(Some)
            .ok_or(MotivoPerfil::NumeroInvalido),
        _ => Ok(None),
    }
}

fn decimal(token: &str) -> Option<usize> {
    if token.is_empty() || !token.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    token.parse::<usize>().ok()
}

/// 64 díxitos hexadecimais en minúsculas: a forma en que se publica un SHA-256.
fn forma_sha256(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}
