// Carga e verificación dos vectores diferenciais pinados.
//
// O ficheiro vai embebido no binario de tests (`include_str!`) e a súa
// SHA-256 compróbase antes de ler calquera caso: un ficheiro alterado ou
// ausente non pode producir un falso PASS. `contract_version` e o número de
// vectores por sección tamén están pinados, para que engadir/quitar casos no
// xerador sexa un cambio explícito nesta liña e non un silencio.
//
// Este módulo **non** importa o crate: só descrebe o esperado. A conversión do
// estado ao tipo do crate vive en `super::conv`.

use super::json::Json;

pub const VECTORS_SHA256: &str = "da09b5b2e84aeac4a95ee02fa6cc8fb6e77aa6a43ecce77a010d3082d741e048";
pub const CONTRACT_VERSION: u64 = 1;

/// Estado tal como o trae o vector, sen clasificar: os negativos inclúen
/// deliberadamente valores malformados (`"5"`, `-1`, `1.5`) que o perfil debe
/// rexeitar. Perder esa forma aquí sería perder o test.
#[derive(Clone, Debug, PartialEq)]
pub enum RawValue {
    Null,
    Bool(bool),
    Uint(u64),
    Neg(i64),
    NonInteger(String),
    Text(String),
    Structure,
}

#[derive(Clone, Debug, Default)]
pub struct RawState {
    /// `false` cando o vector trae `mapper_state: null` (estado ausente).
    pub present: bool,
    pub entries: Vec<(String, RawValue)>,
    /// `banks` separado porque a súa clave é un número en texto e o seu valor
    /// pode estar malformado a propósito.
    pub banks_raw: Option<Vec<(String, RawValue)>>,
}

impl RawState {
    pub fn value(&self, key: &str) -> Option<&RawValue> {
        self.entries.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    pub fn rom_size(&self) -> Option<u64> {
        match self.value("rom_size") {
            Some(RawValue::Uint(n)) => Some(*n),
            _ => None,
        }
    }

    pub fn banks(&self) -> Option<&[(String, RawValue)]> {
        self.banks_raw.as_deref()
    }

    /// Estado dun perfil sen bancos: só `rom_size`.
    pub fn plain(size: u64) -> RawState {
        RawState {
            present: true,
            entries: vec![("rom_size".into(), RawValue::Uint(size))],
            banks_raw: None,
        }
    }

    /// Bancos **ben formados** (clave enteira, valor enteiro). Unha lista
    /// malformada devolve `None`: quen precisa rexeitala debe mirar
    /// [`RawState::entries`], non este atallo.
    pub fn bank_pairs(&self) -> Option<Vec<(u64, u64)>> {
        let items = self.banks_raw.as_ref()?;
        let mut out = Vec::with_capacity(items.len());
        for (k, v) in items {
            let key = k.parse::<u64>().ok()?;
            match v {
                RawValue::Uint(n) => out.push((key, *n)),
                _ => return None,
            }
        }
        Some(out)
    }
}

/// Totais auditados do ficheiro pinado: úsanse para que un caso que desaparece
/// ou aparece de máis sexa un fallo de test explícito.
pub const TRANSLATE_OK: usize = 101;
pub const NEGATIVES_TOTAL: usize = 50;
/// Negativos cuxa resposta depende só da **clasificación da rexión** (o motor
/// de referencia pode modelalos). Os restantes 28 son de validación de estado
/// e só se gradan contra o crate. Reparto comprobado á man por perfil:
/// `md-linear` 7, `md-ssf2` 4, `snes-lorom` 5, `snes-hirom` 3, `snes-exhirom` 3.
pub const NEGATIVES_REGION_GRADED: usize = 22;

#[derive(Clone, Debug)]
pub struct Fixture {
    pub sha256: String,
    pub rom_size: u64,
}

#[derive(Clone, Debug)]
pub enum ExpectTx {
    Ok { region: String, offset: u64 },
    Err(String),
}

#[derive(Clone, Debug)]
pub struct TranslateCase {
    pub name: String,
    pub cpu_address: u64,
    pub state: RawState,
    pub expect: ExpectTx,
    /// Concordancia do motor de `crosscheck/` co estado **da fixture**, non co
    /// do caso: un artefacto do xerador (ver `oracle_engine_agree`).
    pub engine_agree: Option<bool>,
}

#[derive(Clone, Debug)]
pub struct NegCase {
    pub name: String,
    pub cpu_address: u64,
    pub state: RawState,
    pub expect_error: String,
}

#[derive(Clone, Debug)]
pub enum ExpectInv {
    Aliases(Vec<u64>),
    Err(String),
}

#[derive(Clone, Debug)]
pub struct InvertCase {
    pub name: String,
    pub rom_offset: RawValue,
    pub state: RawState,
    pub expect: ExpectInv,
}

#[derive(Clone, Debug)]
pub struct InvertSample {
    pub rom_offset: u64,
    pub aliases: Vec<u64>,
}

#[derive(Clone, Debug)]
pub struct ReadSegExpect {
    pub region: Option<String>,
    pub offset: Option<u64>,
    pub bytes: Option<Vec<u8>>,
    pub error: Option<String>,
}

#[derive(Clone, Debug)]
pub struct ReadCase {
    pub name: String,
    pub cpu_address: u64,
    pub length: i64,
    pub state: RawState,
    pub rom_short_by: u64,
    pub segments: Vec<ReadSegExpect>,
    pub expect_error: Option<String>,
}

#[derive(Clone, Debug)]
pub struct BankWrite {
    pub cpu_address: u64,
    pub data: u64,
}

#[derive(Clone, Debug)]
pub struct Ssf2Seq {
    pub seq: u64,
    pub writes: Vec<BankWrite>,
    pub expect_banks: Vec<(u64, u64)>,
    pub probes: Vec<(u64, u64)>,
}

#[derive(Clone, Debug)]
pub struct Ssf2Pinned {
    pub name: String,
    pub writes: Vec<BankWrite>,
    pub state: RawState,
    pub expect_banks: Vec<(u64, u64)>,
    pub expect_translate: Vec<(u64, u64)>,
}

#[derive(Clone, Debug)]
pub struct ProfileVectors {
    pub name: String,
    pub fixture: Fixture,
    pub translate: Vec<TranslateCase>,
    pub negatives: Vec<NegCase>,
    pub invert: Vec<InvertCase>,
    pub invert_samples: Vec<InvertSample>,
    pub reads: Vec<ReadCase>,
    pub ssf2_seqs: Vec<Ssf2Seq>,
    pub ssf2_pinned: Vec<Ssf2Pinned>,
}

impl ProfileVectors {
    /// Casos de `invert` cuxo `rom_offset` é un token non enteiro: non son
    /// traducibles ao `u32` do contrato (a frontada do tipo xa os impide), así
    /// que o test déiveis contar en vez de simularos.
    pub fn invert_non_integer_offset_count(&self) -> usize {
        self.invert
            .iter()
            .filter(|c| matches!(c.rom_offset, RawValue::Text(_) | RawValue::NonInteger(_)))
            .count()
    }
}

pub struct VectorSet {
    pub contract_version: u64,
    pub profiles: Vec<ProfileVectors>,
    pub raw: &'static str,
}

impl VectorSet {
    pub fn profile(&self, name: &str) -> &ProfileVectors {
        self.profiles
            .iter()
            .find(|p| p.name == name)
            .unwrap_or_else(|| panic!("perfil {name} ausente nos vectores pinados"))
    }
}

/// Counts pinados por perfil: `{translate, negatives, invert, samples, reads,
/// seqs, pinned}`. Un desaxuste é un fallo de test, non un reconto adaptable.
pub const PINNED_COUNTS: &[(&str, [usize; 7])] = &[
    ("md-linear", [22, 11, 5, 60, 7, 0, 0]),
    ("md-ssf2", [18, 13, 9, 60, 11, 12, 10]),
    ("snes-lorom", [18, 10, 8, 60, 10, 0, 0]),
    ("snes-hirom", [18, 8, 7, 60, 10, 0, 0]),
    ("snes-exhirom", [25, 8, 13, 60, 12, 0, 0]),
];

/// Carga o texto embebido, verifica SHA-256 + versión + counts e devolve os
/// vectores clasificados.
pub fn load() -> VectorSet {
    load_from(embedded_src())
}

pub fn embedded_src() -> &'static str {
    include_str!("../../vectors/rust-vectors-v1.json")
}

pub fn load_from(src: &'static str) -> VectorSet {
    let digest = super::sha256::sha256_hex(src.as_bytes());
    assert_eq!(
        digest, VECTORS_SHA256,
        "SHA-256 dos vectores non coincide coa pinada: consumirse-ían casos non auditados"
    );
    let doc = Json::parse(src).expect("vectores pinados non son JSON válido");
    assert_eq!(
        doc.get("contract_version").and_then(Json::as_u64),
        Some(CONTRACT_VERSION),
        "contract_version distinta da asumida polo contrato"
    );
    let profiles_node = doc.get("profiles").and_then(Json::obj).expect("profiles");
    let mut profiles = Vec::new();
    for (name, node) in profiles_node {
        profiles.push(load_profile(name, node));
    }
    assert_eq!(
        profiles.len(),
        PINNED_COUNTS.len(),
        "perfil de máis/menos nos vectores"
    );
    for p in &profiles {
        let (_, counts) = PINNED_COUNTS
            .iter()
            .find(|(n, _)| *n == p.name)
            .unwrap_or_else(|| panic!("perfil {} sen counts pinados", p.name));
        let got = [
            p.translate.len(),
            p.negatives.len(),
            p.invert.len(),
            p.invert_samples.len(),
            p.reads.len(),
            p.ssf2_seqs.len(),
            p.ssf2_pinned.len(),
        ];
        assert_eq!(
            got, *counts,
            "counts de vectores alterados en {}: pinado {:?}, atopado {:?}",
            p.name, counts, got
        );
    }
    VectorSet {
        contract_version: CONTRACT_VERSION,
        profiles,
        raw: src,
    }
}

fn load_profile(name: &str, node: &Json) -> ProfileVectors {
    let fixture_node = node.get("fixture").expect("fixture");
    let fixture = Fixture {
        sha256: text(fixture_node, "sha256"),
        rom_size: fixture_node
            .get("rom_size")
            .and_then(Json::as_u64)
            .expect("rom_size"),
    };

    let translate = seq(node, "translate")
        .iter()
        .map(|c| TranslateCase {
            name: text_of(c),
            cpu_address: addr(c),
            state: state_of(c),
            expect: expect_tx(c),
            engine_agree: c.get("engine_agree").and_then(Json::as_bool),
        })
        .collect();

    let negatives = seq(node, "translate_negatives")
        .iter()
        .map(|c| NegCase {
            name: text_of(c),
            cpu_address: addr(c),
            state: state_of(c),
            expect_error: c
                .get("expect_error")
                .and_then(Json::as_str)
                .expect("expect_error")
                .to_string(),
        })
        .collect();

    let invert = seq(node, "invert_cases")
        .iter()
        .map(|c| InvertCase {
            rom_offset: raw_value(c.get("rom_offset").expect("rom_offset")),
            name: text_of(c),
            state: state_of(c),
            expect: match c.get("expect") {
                Some(e) => match e.get("error").and_then(Json::as_str) {
                    Some(code) => ExpectInv::Err(code.to_string()),
                    None => ExpectInv::Aliases(
                        e.get("aliases")
                            .and_then(Json::arr)
                            .expect("aliases")
                            .iter()
                            .map(int_of)
                            .collect(),
                    ),
                },
                None => panic!("vector invert sen expect"),
            },
        })
        .collect();

    let invert_samples = seq(node, "invert_samples_exhaustive_verified")
        .iter()
        .map(|c| InvertSample {
            rom_offset: int_of(c.get("rom_offset").expect("rom_offset")),
            aliases: c
                .get("aliases")
                .and_then(Json::arr)
                .expect("aliases")
                .iter()
                .map(int_of)
                .collect(),
        })
        .collect();

    let reads = seq(node, "read_cases")
        .iter()
        .map(|c| {
            let segments = c
                .get("expect_segments")
                .and_then(Json::arr)
                .expect("expect_segments")
                .iter()
                .map(|s| ReadSegExpect {
                    region: s.get("region").and_then(Json::as_str).map(str::to_string),
                    offset: s.get("offset").and_then(Json::as_int_value),
                    bytes: s
                        .get("bytes_hex")
                        .and_then(Json::as_str)
                        .map(|h| super::sha256::hex_to_bytes(h).expect("bytes_hex hex par")),
                    error: s.get("error").and_then(Json::as_str).map(str::to_string),
                })
                .collect();
            ReadCase {
                name: text_of(c),
                cpu_address: addr(c),
                length: c
                    .get("length")
                    .and_then(|v| match v {
                        Json::NegNum(n) => Some(*n),
                        Json::Num(n) => Some(*n as i64),
                        _ => None,
                    })
                    .expect("length"),
                state: state_of(c),
                rom_short_by: c.get("rom_short_by").and_then(Json::as_u64).unwrap_or(0),
                segments,
                expect_error: c
                    .get("expect_error")
                    .and_then(Json::as_str)
                    .map(str::to_string),
            }
        })
        .collect();

    let ssf2_seqs = match node.get("ssf2_write_sequences") {
        Some(arr) => arr
            .arr()
            .expect("ssf2_write_sequences array")
            .iter()
            .map(|s| Ssf2Seq {
                seq: s.get("seq").and_then(Json::as_u64).expect("seq"),
                writes: s
                    .get("writes")
                    .and_then(Json::arr)
                    .expect("writes")
                    .iter()
                    .map(|w| BankWrite {
                        cpu_address: int_of(w.get("cpu_address").expect("write addr")),
                        data: w.get("data").and_then(Json::as_u64).expect("data"),
                    })
                    .collect(),
                expect_banks: pairs(s.get("expect_banks").expect("expect_banks")),
                probes: seq(s, "probes")
                    .iter()
                    .map(|p| {
                        (
                            int_of(p.get("cpu_address").expect("probe addr")),
                            int_of(p.get("offset").expect("probe offset")),
                        )
                    })
                    .collect(),
            })
            .collect(),
        None => Vec::new(),
    };

    let ssf2_pinned = match node.get("ssf2_pinned_write_register_cases") {
        Some(arr) => arr
            .arr()
            .expect("pinned array")
            .iter()
            .map(|s| Ssf2Pinned {
                name: text_of(s),
                writes: s
                    .get("writes")
                    .and_then(Json::arr)
                    .expect("writes")
                    .iter()
                    .map(|w| BankWrite {
                        cpu_address: int_of(w.get("cpu_address").expect("write addr")),
                        data: w.get("data").and_then(Json::as_u64).expect("data"),
                    })
                    .collect(),
                state: state_of(s),
                expect_banks: pairs(s.get("expect_banks").expect("expect_banks")),
                expect_translate: s
                    .get("expect_translate")
                    .and_then(Json::arr)
                    .expect("expect_translate")
                    .iter()
                    .map(|p| {
                        (
                            int_of(p.get("cpu_address").expect("addr")),
                            int_of(p.get("offset").expect("offset")),
                        )
                    })
                    .collect(),
            })
            .collect(),
        None => Vec::new(),
    };

    ProfileVectors {
        name: name.to_string(),
        fixture,
        translate,
        negatives,
        invert,
        invert_samples,
        reads,
        ssf2_seqs,
        ssf2_pinned,
    }
}

fn seq<'a>(node: &'a Json, key: &str) -> &'a [Json] {
    node.get(key)
        .and_then(Json::arr)
        .unwrap_or_else(|| panic!("sección {key} ausente ou non array"))
}

fn text_of(node: &Json) -> String {
    node.get("name")
        .and_then(Json::as_str)
        .unwrap_or("?")
        .to_string()
}

fn text(node: &Json, key: &str) -> String {
    node.get(key)
        .and_then(Json::as_str)
        .unwrap_or_else(|| panic!("campo {key} ausente"))
        .to_string()
}

fn int_of(node: &Json) -> u64 {
    node.as_int_value()
        .unwrap_or_else(|| panic!("expected enteiro, atopado {node:?}"))
}

fn addr(case: &Json) -> u64 {
    int_of(case.get("cpu_address").expect("cpu_address"))
}

fn pairs(node: &Json) -> Vec<(u64, u64)> {
    node.obj()
        .expect("expect_banks obxecto")
        .iter()
        .map(|(k, v)| (int_of(&Json::Str(k.clone())), int_of(v)))
        .collect()
}

fn raw_value(node: &Json) -> RawValue {
    match node {
        Json::Null => RawValue::Null,
        Json::Bool(b) => RawValue::Bool(*b),
        Json::Num(n) => RawValue::Uint(*n),
        Json::NegNum(n) => RawValue::Neg(*n),
        Json::NonInteger(s) => RawValue::NonInteger(s.clone()),
        // Unha cadea `0x…` é a *codificación en transporte* dun enderezo (o
        // xerador imprime os enderezos así). Calquera outra cadea é un valor
        // string real, e debe chegar ao perfil como tal: `banks {"1":"5"}` e
        // `rom_offset "291.5"` son casos negativos precisely porque non son
        // números.
        Json::Str(s) => {
            let hex = s.strip_prefix("0x").or_else(|| s.strip_prefix("0X"));
            match hex.and_then(|h| u64::from_str_radix(h, 16).ok()) {
                Some(n) => RawValue::Uint(n),
                None => RawValue::Text(s.clone()),
            }
        }
        Json::Arr(_) | Json::Obj(_) => RawValue::Structure,
    }
}

/// Estado `mapper_state` do caso, conservando a forma malformada.
fn state_of(case: &Json) -> RawState {
    match case.get("mapper_state") {
        None | Some(Json::Null) => RawState::default(),
        Some(Json::Obj(entries)) => {
            let mut out = RawState {
                present: true,
                entries: Vec::new(),
                banks_raw: None,
            };
            for (k, v) in entries {
                if k == "banks" {
                    match v {
                        Json::Obj(items) => {
                            out.banks_raw = Some(
                                items
                                    .iter()
                                    .map(|(bk, bv)| (bk.clone(), raw_value(bv)))
                                    .collect(),
                            );
                            out.entries.push((k.clone(), RawValue::Structure));
                        }
                        other => out.entries.push((k.clone(), raw_value(other))),
                    }
                } else {
                    out.entries.push((k.clone(), raw_value(v)));
                }
            }
            out
        }
        Some(other) => RawState {
            present: true,
            entries: vec![("«non-obxecto»".to_string(), raw_value(other))],
            banks_raw: None,
        },
    }
}

fn expect_tx(case: &Json) -> ExpectTx {
    let e = case.get("expect").expect("expect");
    if let Some(code) = e.get("error").and_then(Json::as_str) {
        return ExpectTx::Err(code.to_string());
    }
    ExpectTx::Ok {
        region: text(e, "region"),
        offset: int_of(e.get("offset").expect("offset")),
    }
}
