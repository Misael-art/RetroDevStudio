//! Inventario de imaxes normalizadas (Obxectivo 1 da MISSAO A).
//!
//! Consumindo a folla de proveniancia que escribe `stage.sh` e os bytes xa
//! normalizados en `staged/`, cada imaxe pasa por comprobacións medidas —
//! lonxitude declarada, CRC do membro, hash do membro e layout, máis o cabeco
//! e a suma de verificación. Ningunha se inference: un campo non medido queda
//! como `not_measured` ou como `refusada` explícita.
//!
//! O manifesto serializa **metadatos** (hashes, lonxitudes, offsets, campos do
//! cabeco 0x100..0x1FF). Ningún byte do corpo da imaxe sae aquí: os bytes
//! comerciais quedan no directorio local non versionado.

use crate::json::{render, Value};
use crate::layout::{detect, Layout};
use crate::mdheader::{self, MdHeader};
use rex_kosinski::edit::sha256_hex;

/// Versión do manifesto do inventario.
pub const SCHEMA_INVENTARIO: &str = "rex-corpus-inventario/v1";

/// CRC-32/ISO-HDLC (polinomio refleto 0xEDB88320, init e xorout 0xFFFFFFF).
///
/// Non é un hash de integridade: serve como **segunda medición independente**
/// do contido do membro, xerada por `unzip` e polo noso propio lazo. Se os dous
/// CRC coinciden, a extracción non alterou bytes — sen depender de `unzip`.
pub fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for &b in bytes {
        crc ^= b as u32;
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xEDB8_8320 & mask);
        }
    }
    !crc
}

/// Unha fila de `proveniencia.tsv`: a procedencia dunha imaxe xa normalizada.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Provenance {
    pub staged_sha256: String,
    pub staged_len: u64,
    pub staged_path: String,
    pub container_rel: String,
    pub container_sha256: String,
    pub member: String,
    pub member_crc32: String,
    pub method: String,
    pub member_uncomp_len: u64,
    pub role: String,
}

const CAMPOS_PROVENIENCIA: usize = 10;

/// `None` en cabazo, comentarios, filas incompletas ou números non parseables.
pub fn parse_provenance(liña: &str) -> Option<Provenance> {
    let liña = liña.trim_end_matches('\n');
    if liña.is_empty() || liña.starts_with('#') {
        return None;
    }
    let campos: Vec<&str> = liña.split('\t').collect();
    if campos.len() != CAMPOS_PROVENIENCIA {
        return None;
    }
    let staged_len = campos[1].parse::<u64>().ok()?;
    let member_uncomp_len = campos[8].parse::<u64>().ok()?;
    Some(Provenance {
        staged_sha256: campos[0].to_string(),
        staged_len,
        staged_path: campos[2].to_string(),
        container_rel: campos[3].to_string(),
        container_sha256: campos[4].to_string(),
        member: campos[5].to_string(),
        member_crc32: campos[6].to_string(),
        method: campos[7].to_string(),
        member_uncomp_len,
        role: campos[9].to_string(),
    })
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Check {
    pub nombre: String,
    pub ok: bool,
    pub detalle: String,
}

impl Check {
    fn novo(nombre: &str, ok: bool, detalle: String) -> Check {
        Check {
            nombre: nombre.to_string(),
            ok,
            detalle,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Item {
    pub prov: Provenance,
    pub checks: Vec<Check>,
    pub refusada: Option<String>,
    pub bytes: usize,
    pub sha256_medido: String,
    pub crc32_medido: u32,
    pub layout: Layout,
    pub formato_orixinal: String,
    pub formato_normalizado: String,
    pub transformacions: Vec<String>,
    pub limitaciones: Vec<String>,
    pub header: Option<MdHeader>,
    pub checksum_state: String,
    pub checksum_declarado: Option<u16>,
    pub checksum_observado: Option<u16>,
    pub checksum_matching: bool,
}

impl Item {
    /// Algún dos datos medidos non cuadra coa proveniancia, ou a imaxe non é
    /// traducible a direccións. É o criterio do código de saída do CLI.
    pub fn diverxe(&self) -> bool {
        self.refusada.is_some() || self.checks.iter().any(|c| !c.ok)
    }
}

fn extension(camiño: &str) -> String {
    match camiño.rfind('.') {
        Some(i) if i + 1 < camiño.len() => camiño[i + 1..].to_lowercase(),
        _ => "sen_extension".to_string(),
    }
}

/// Mide unha imaxe normalizada contra a súa proveniancia. Non aborta: as
/// diverxencias rexístranse e, se imposibilitan calquera afirmación, devolve
/// un `refusada` coa razón.
pub fn inspect(prov: &Provenance, bytes: &[u8]) -> Item {
    let sha_medido = sha256_hex(bytes);
    let crc_medido = crc32(bytes);
    let layout = detect(bytes);

    let hash_ok = sha_medido == prov.staged_sha256;
    let lon_ok = bytes.len() as u64 == prov.member_uncomp_len;
    let layout_ok = layout == Layout::Lineal;
    // Nunha copia directa de texto plano non hai CRC de membro: a comparacion
    // pertinente e que os bytes coincidan co hash do propio contedor.
    let copia_directa = prov.member == "-";

    let mut checks = vec![Check::novo(
        if copia_directa {
            "lonxitude_contedor"
        } else {
            "lonxitude_membro"
        },
        lon_ok,
        format!(
            "declarada={} medida={}",
            prov.member_uncomp_len,
            bytes.len()
        ),
    )];
    if copia_directa {
        checks.push(Check::novo(
            "hash_contedor",
            sha_medido == prov.container_sha256,
            format!("contedor={} medida={sha_medido}", prov.container_sha256),
        ));
    } else {
        checks.push(Check::novo(
            "crc32_membro",
            format!("{crc_medido:08x}") == prov.member_crc32,
            format!("declarado={} medido={:08x}", prov.member_crc32, crc_medido),
        ));
    }
    checks.push(Check::novo(
        "hash_membro",
        hash_ok,
        format!("proveniancia={} medida={sha_medido}", prov.staged_sha256),
    ));
    checks.push(Check::novo(
        "layout",
        layout_ok,
        format!("{:?} (cabeco en 0x{:03X})", layout, 0x100),
    ));

    let refusada = if !hash_ok {
        Some("hash_diverxente".to_string())
    } else if !layout_ok {
        Some("layout_non_lineal".to_string())
    } else {
        None
    };

    let formato_orixinal = if prov.member == "-" {
        extension(&prov.container_rel)
    } else {
        extension(&prov.member)
    };

    let mut transformacions = vec![if prov.method == "store" {
        "copia_byte_a_byte_do_contenedor".to_string()
    } else {
        format!("descompactacion_{}_do_membro", prov.method)
    }];
    if layout_ok {
        transformacions.push("sen_transformacion_de_bytes".to_string());
    }

    let mut limitaciones = vec![
        "non hai base de revisión fixada: `revision` queda en `desconhecida`".to_string(),
        "a suma de verificación compárase só coa imaxe local: non proba procedencia".to_string(),
    ];
    if formato_orixinal == "smd" && layout_ok {
        limitaciones.push(
            "extensión .smd pero o layout medido é lineal: non se aplicou desentrelazamento"
                .to_string(),
        );
    }
    if let Some(r) = &refusada {
        limitaciones.push(format!("inventario_incompleto: {r}"));
    }

    // O cabeco só se le cando o layout permite traducir direccións.
    let header = if layout_ok {
        MdHeader::parse(bytes)
    } else {
        None
    };

    let (checksum_state, checksum_declarado, checksum_observado, checksum_matching) = match &header
    {
        Some(h) => {
            let st = h.checksum_status(bytes);
            let declarado = match st.field {
                mdheader::ChecksumField::Value(v) => Some(v),
                mdheader::ChecksumField::Blank => None,
            };
            let estado = match st.field {
                mdheader::ChecksumField::Value(_) => "valor",
                mdheader::ChecksumField::Blank => "branco",
            };
            (
                estado.to_string(),
                declarado,
                Some(st.observed),
                st.matching,
            )
        }
        None => ("sen_cabeco".to_string(), None, None, false),
    };

    Item {
        prov: prov.clone(),
        checks,
        refusada,
        bytes: bytes.len(),
        sha256_medido: sha_medido,
        crc32_medido: crc_medido,
        layout,
        formato_orixinal,
        formato_normalizado: if layout_ok {
            "lineal".to_string()
        } else {
            "sen_normalizar".to_string()
        },
        transformacions,
        limitaciones,
        header,
        checksum_state,
        checksum_declarado,
        checksum_observado,
        checksum_matching,
    }
}

fn texto(v: &str) -> Value {
    Value::Str(v.to_string())
}

fn lista(v: &[String]) -> Value {
    Value::List(v.iter().map(|s| Value::Str(s.clone())).collect())
}

fn verificacions_json(item: &Item) -> Value {
    Value::List(
        item.checks
            .iter()
            .map(|c| {
                Value::Object(vec![
                    ("nombre".to_string(), texto(&c.nombre)),
                    ("ok".to_string(), Value::Bool(c.ok)),
                    ("detalle".to_string(), texto(&c.detalle)),
                ])
            })
            .collect(),
    )
}

fn cabeco_json(h: &MdHeader) -> Value {
    // Un campo cuxos bytes son espazos non ten valor: sai como `not_measured`,
    // nunca como 0 nin como o número que resulta de leer `0x2020…`.
    let branco = |nome: &str| h.campos_branco.iter().any(|c| c == nome);
    let numero = |nome: &str, v: i64| {
        if branco(nome) {
            Value::not_measured()
        } else {
            Value::Int(v)
        }
    };
    let direccion = |nome: &str, v: u32| {
        if branco(nome) {
            Value::not_measured()
        } else {
            Value::Str(format!("{:#010x}", v))
        }
    };
    Value::Object(vec![
        ("console".to_string(), texto(&h.console)),
        ("copyright".to_string(), texto(&h.copyright)),
        ("titulo_local".to_string(), texto(&h.title_local)),
        ("titulo_internacional".to_string(), texto(&h.title_int)),
        ("serial".to_string(), texto(&h.serial)),
        ("io_suporte".to_string(), texto(&h.io_support)),
        ("rexion".to_string(), texto(&h.region)),
        ("notas".to_string(), texto(&h.notes)),
        ("sram_sinatura".to_string(), texto(&h.sram_sig)),
        (
            "sram_tipo".to_string(),
            numero("sram_tipo", i64::from(h.sram_type)),
        ),
        (
            "sram_inicio".to_string(),
            direccion("sram_inicio", h.sram_start),
        ),
        ("sram_fin".to_string(), direccion("sram_fin", h.sram_end)),
        (
            "rom_inicio".to_string(),
            direccion("rom_inicio", h.rom_start),
        ),
        ("rom_fin".to_string(), direccion("rom_fin", h.rom_end)),
        (
            "ram_inicio".to_string(),
            direccion("ram_inicio", h.ram_start),
        ),
        ("ram_fin".to_string(), direccion("ram_fin", h.ram_end)),
        ("texto_perdido".to_string(), Value::Bool(h.text_lossy)),
        ("campos_perdidos".to_string(), lista(&h.campos_perdidos)),
        (
            "campos_branco".to_string(),
            Value::List(
                h.campos_branco
                    .iter()
                    .map(|c| Value::Str(c.clone()))
                    .collect(),
            ),
        ),
    ])
}

fn item_json(item: &Item, duplicado_de: &[String]) -> Value {
    let lonxitude = match &item.header {
        Some(h) => match h.declared_len() {
            Some(d) => match mdheader::declared_vs_real(h, item.bytes) {
                Some(delta) => Value::Object(vec![
                    ("arquivo".to_string(), Value::Int(item.bytes as i64)),
                    ("declarada_cabeco".to_string(), Value::Int(d as i64)),
                    ("diferenza".to_string(), Value::Int(delta)),
                ]),
                None => Value::Object(vec![
                    ("arquivo".to_string(), Value::Int(item.bytes as i64)),
                    ("declarada_cabeco".to_string(), Value::Int(d as i64)),
                    ("diferenza".to_string(), Value::not_measured()),
                ]),
            },
            None => Value::Object(vec![
                ("arquivo".to_string(), Value::Int(item.bytes as i64)),
                ("declarada_cabeco".to_string(), Value::not_measured()),
                ("diferenza".to_string(), Value::not_measured()),
            ]),
        },
        None => Value::Object(vec![
            ("arquivo".to_string(), Value::Int(item.bytes as i64)),
            ("declarada_cabeco".to_string(), Value::not_measured()),
            ("diferenza".to_string(), Value::not_measured()),
        ]),
    };

    let mut pares = vec![
        ("papel".to_string(), texto(&item.prov.role)),
        (
            "contenedor_rel".to_string(),
            texto(&item.prov.container_rel),
        ),
        (
            "contenedor_sha256".to_string(),
            texto(&item.prov.container_sha256),
        ),
        (
            "membro".to_string(),
            if item.prov.member == "-" {
                Value::Null
            } else {
                texto(&item.prov.member)
            },
        ),
        ("membro_sha256".to_string(), texto(&item.sha256_medido)),
        ("bytes".to_string(), Value::Int(item.bytes as i64)),
        (
            "formato_orixinal".to_string(),
            texto(&item.formato_orixinal),
        ),
        ("metodo_contenedor".to_string(), texto(&item.prov.method)),
        (
            "crc32_declarado".to_string(),
            if item.prov.member_crc32 == "-" {
                Value::Null
            } else {
                texto(&item.prov.member_crc32)
            },
        ),
        (
            "crc32_medido".to_string(),
            Value::Str(format!("{:08x}", item.crc32_medido)),
        ),
        (
            "formato_normalizado".to_string(),
            texto(&item.formato_normalizado),
        ),
        ("transformacions".to_string(), lista(&item.transformacions)),
        ("verificacions".to_string(), verificacions_json(item)),
        ("layout".to_string(), texto(&format!("{:?}", item.layout))),
        (
            "cabeco".to_string(),
            match &item.header {
                Some(h) => cabeco_json(h),
                None => Value::not_measured(),
            },
        ),
        (
            "checksum".to_string(),
            Value::Object(vec![
                ("estado".to_string(), texto(&item.checksum_state)),
                (
                    "declarado".to_string(),
                    match item.checksum_declarado {
                        Some(v) => Value::Int(i64::from(v)),
                        None => Value::not_measured(),
                    },
                ),
                (
                    "observado".to_string(),
                    match item.checksum_observado {
                        Some(v) => Value::Int(i64::from(v)),
                        None => Value::not_measured(),
                    },
                ),
                ("coincide".to_string(), Value::Bool(item.checksum_matching)),
            ]),
        ),
        ("lonxitude".to_string(), lonxitude),
        ("revision".to_string(), texto("desconhecida")),
        (
            "traducion".to_string(),
            texto(if duplicado_de.is_empty() {
                "non_determinable"
            } else {
                "sen_diferenza_de_bytes"
            }),
        ),
        (
            "traducion_evidencia".to_string(),
            if duplicado_de.is_empty() {
                Value::List(vec![texto(
                    "só a etiqueta do contenedor; non hai outra fonte co mesmo hash para comparar",
                )])
            } else {
                Value::List(vec![texto(&format!(
                    "imaxe idéntica byte a byte a {}",
                    duplicado_de.join(", ")
                ))])
            },
        ),
        ("limitaciones".to_string(), lista(&item.limitaciones)),
    ];
    if !duplicado_de.is_empty() {
        pares.push((
            "duplicado_de".to_string(),
            Value::List(duplicado_de.iter().map(|s| Value::Str(s.clone())).collect()),
        ));
    }
    if let Some(r) = &item.refusada {
        pares.push(("refusada".to_string(), texto(r)));
    }
    Value::Object(pares)
}

/// Manifesto versionable. `orixe` identifica de onde veñen os datos (un camiño
/// de `proveniencia.tsv` ou a súa descrición), non bytes.
pub fn inventory_json(items: &[Item], orixe: &str) -> Value {
    let refusadas = items.iter().filter(|i| i.diverxe()).count();
    let inventario = if refusadas == 0 {
        "completo"
    } else {
        "parcial"
    };

    // Duplicados: mesma imaxe normalizada vista desde outras fontes. A marca
    // recae na segunda e seguintes aparicións, nunca na primeira.
    let mut vistos: Vec<(String, String)> = Vec::new();
    let mut fontes = Vec::with_capacity(items.len());
    for item in items {
        let previos: Vec<String> = vistos
            .iter()
            .filter(|(sha, _)| *sha == item.sha256_medido)
            .map(|(_, fonte)| fonte.clone())
            .collect();
        fontes.push(item_json(item, &previos));
        vistos.push((item.sha256_medido.clone(), item.prov.container_rel.clone()));
    }

    Value::Object(vec![
        ("schema_version".to_string(), texto(SCHEMA_INVENTARIO)),
        ("orixe".to_string(), texto(orixe)),
        ("inventario".to_string(), texto(inventario)),
        ("total".to_string(), Value::Int(items.len() as i64)),
        (
            "inventariadas".to_string(),
            Value::Int((items.len() - refusadas) as i64),
        ),
        ("refusadas".to_string(), Value::Int(refusadas as i64)),
        ("fontes".to_string(), Value::List(fontes)),
    ])
}

/// Render do manifesto para escribilo tal cal.
pub fn manifesto_string(items: &[Item], orixe: &str) -> String {
    render(&inventory_json(items, orixe))
}
