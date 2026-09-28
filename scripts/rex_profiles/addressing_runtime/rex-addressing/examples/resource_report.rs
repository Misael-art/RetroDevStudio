//! Consumidor mínimo da capa de recursos: un executable **fora da app** que
//! entrega unha fixture, dille á biblioteca «le este recurso neste enderezo,
//! con este tamaño e este estado de mapper» e imprime un informe determinístico
//! con todo o que o integrador necesita para auditar a resposta: identificación
//! da imaxe, perfil, estado, cada corredor físico usado, o SHA-256 dos bytes
//! devoltos e o motivo exacto de cada recusa.
//!
//! ```text
//! CARGO_TARGET_DIR=/tmp/rex-a2-target cargo run --offline --example resource_report
//! ```
//!
//! Tres decisións que aquí importan:
//!
//! - **Só a API pública.** O exemplo non toca módulos internos nin abre
//!   ficheiros: a imaxe constrúese en memoria. Se o informe se puido xerar con
//!   isto, calquera frontada (Tauri, CLI, teste de integración) pode facelo.
//! - **Determinista.** Sen reloxos, sen rutas do host, sen aleatoriedade e sen
//!   dependencia da orde de un `HashMap`. A derradeira liña leva o SHA-256 do
//!   corpo do informe: dúas execucións que diverxan vense cunha comparación.
//! - **Autoverificable.** Cada caso declara o que espera (bytes, ou recusa cun
//!   código concreto) e as invariantes da capa compróbanse no propio percorrido:
//!   `bytes.len() == length`, segmentos contiguos, e procedencia recomposta byte
//!   a byte. Unha regresión aborta con código de erro; non imprime un informe
//!   mentira.

// Os dous oráculos compártense coa suite de tests: o exemplo é un consumidor máis,
// non unha segunda implementación.
#[allow(dead_code)] // o exemplo só precisa parte do oráculo de contido
#[path = "../tests/support/banked.rs"]
mod banked;
#[allow(dead_code)] // `hex_to_bytes` só a empregan os tests que comparan hex
#[path = "../tests/support/sha256.rs"]
mod sha256;

use rex_addressing::resource::{
    read_resource, read_sequence, ImageIdentity, Limits, Profile, ResourceError, ResourceErrorCode,
    ResourceRead, ResourceRequest, SequenceRequest, Step, CONTRACT_VERSION,
};
use rex_addressing::{MapperState, Value};

const MD_4MB: usize = 0x40_0000;
const MD_2MB: usize = 0x20_0000;
const MD_1MB: usize = 0x10_0000;
const SNES_512KB: usize = 0x8_0000;
const SNES_2MB: usize = 0x20_0000;
const SNES_6MB: usize = 0x60_0000;

/// Imaxe de fixture coa súa atestación calculada. `origin` usa o prefixo
/// `fixture:`, unha das orixes inmutables que o contrato da capa admite.
struct Fixura {
    rom: Vec<u8>,
    image: ImageIdentity,
}

impl Fixura {
    fn nova(nome: &str, bytes: usize) -> Fixura {
        let rom = banked::image(bytes);
        let image = ImageIdentity {
            origin: format!("fixture:{nome}"),
            sha256_hex: sha256::sha256_hex(&rom),
            byte_len: bytes as u64,
        };
        Fixura { rom, image }
    }
}

/// Estado dos perfis sen rexistradores.
fn lineal(bytes: usize) -> MapperState {
    MapperState::rom_size(bytes as u64)
}

fn ssf2(bytes: usize, bancos: &[(u64, u64)]) -> MapperState {
    MapperState::ssf2(bytes as u64, bancos)
}

/// Un caso do informe: que se pide e que ten que saír del.
struct Caso<'a> {
    /// Identificador que sae impreso, e co que se cita o caso na documentación.
    etiqueta: &'a str,
    /// Que queda demostrado se o caso se comporta así.
    proba: &'a str,
    perfil: Profile,
    estado: &'a MapperState,
    cpu: u32,
    lon: u32,
    limites: Limits,
    /// `Ok` esixe bytes; `Code` esixe esa recusa concreta e ningunha outra.
    espera: Espera,
}

/// O que espera un caso.
#[derive(Clone, Copy)]
enum Espera {
    Ok,
    Code(ResourceErrorCode),
}

struct Informe {
    lineas: Vec<String>,
    lecturas: u32,
    recusas: u32,
    codigos: Vec<&'static str>,
}

impl Informe {
    fn novo() -> Informe {
        Informe {
            lineas: Vec::new(),
            lecturas: 0,
            recusas: 0,
            codigos: Vec::new(),
        }
    }

    fn push(&mut self, liña: impl Into<String>) {
        self.lineas.push(liña.into());
    }

    /// Unha chamada a [`read_resource`], coas invariantes da capa comprobadas
    /// antes de engadir unha soa liña ao informe.
    fn ler(&mut self, fx: &Fixura, caso: &Caso<'_>) {
        let req = ResourceRequest {
            profile: caso.perfil,
            image: fx.image.clone(),
            state: caso.estado,
            cpu_address: caso.cpu,
            length: caso.lon,
            limits: caso.limites,
        };
        match read_resource(&req, &fx.rom) {
            Ok(got) => {
                assert!(
                    matches!(caso.espera, Espera::Ok),
                    "{}: a capa devolveu bytes onde o exemplo esperaba recusa",
                    caso.etiqueta
                );
                self.lectura(caso, &got);
                verificar_lectura(caso.etiqueta, &got);
            }
            Err(e) => {
                match caso.espera {
                    Espera::Code(code) => assert_eq!(
                        e.code,
                        code,
                        "{}: recusa inesperada ({}: {})",
                        caso.etiqueta,
                        e.code.as_str(),
                        e.detail
                    ),
                    Espera::Ok => panic!("{}: a capa recusou {e}", caso.etiqueta),
                }
                self.recusa(caso.etiqueta, caso.proba, caso.perfil, &e);
                self.codigos.push(e.code.as_str());
            }
        }
    }

    fn lectura(&mut self, caso: &Caso<'_>, got: &ResourceRead) {
        self.lecturas += 1;
        self.push(format!(
            "LECTURA {} :: {} [perfil={} cpu={:#08x} lon={:#x}]",
            caso.etiqueta, caso.proba, got.profile, got.cpu_address, got.length
        ));
        self.push(format!(
            "  estado: {} imaxe={} sha256={}",
            describe_estado(&got.state),
            got.image.origin,
            got.image.sha256_hex
        ));
        for seg in &got.segments {
            self.push(format!(
                "  segmento {}: cpu={:#08x} lon={:#x} offset={:#08x} rexion={}",
                seg.index,
                seg.cpu_address,
                seg.cpu_len,
                seg.rom_offset,
                seg.region.as_str()
            ));
        }
        self.push(format!(
            "  bytes={} sha256={}",
            got.bytes.len(),
            sha256::sha256_hex(&got.bytes)
        ));
    }

    fn recusa(&mut self, etiqueta: &str, proba: &str, perfil: Profile, e: &ResourceError) {
        self.recusas += 1;
        self.push(format!(
            "RECUSA {etiqueta} :: {proba} [perfil={} codigo={} rexion={} detido_en={} percorridos={}]",
            perfil.id(),
            e.code.as_str(),
            e.region.map(|r| r.as_str()).unwrap_or("-"),
            e.address
                .map(|a| format!("{a:#08x}"))
                .unwrap_or_else(|| "-".to_string()),
            e.segments.len(),
        ));
        self.push(format!("  detalle={}", e.detail));
        for seg in &e.segments {
            self.push(format!(
                "  percorrido {}: cpu={:#08x} lon={:#x} offset={:#08x} rexion={}",
                seg.index,
                seg.cpu_address,
                seg.cpu_len,
                seg.rom_offset,
                seg.region.as_str()
            ));
        }
    }
}

/// Invariantes que a capa promete e que este exemplo vixía: nada parcial,
/// procedencia contigua, e bytes recomponibles desde os corredores declarados.
fn verificar_lectura(etiqueta: &str, got: &ResourceRead) {
    assert_eq!(
        got.bytes.len() as u32,
        got.length,
        "{etiqueta}: bytes devoltos distintos da lonxitude pedida"
    );
    let mut cursor = got.cpu_address;
    let mut total = 0usize;
    for (i, seg) in got.segments.iter().enumerate() {
        assert_eq!(seg.index as usize, i, "{etiqueta}: índices fora de orde");
        assert_eq!(
            seg.cpu_address, cursor,
            "{etiqueta}: o segmento {i} non continúa a {cursor:#08x}"
        );
        assert_eq!(
            seg.region.as_str(),
            "rom",
            "{etiqueta}: un éxito non pode traer rexión {}",
            seg.region.as_str()
        );
        assert_eq!(
            seg.state, got.state,
            "{etiqueta}: o segmento {i} non leva o estado co que se leu"
        );
        let esperado = banked::expect(seg.rom_offset as usize, seg.cpu_len as usize);
        let recortado = &got.bytes[total..total + seg.cpu_len as usize];
        assert_eq!(
            esperado, recortado,
            "{etiqueta}: a procedencia non recomponse byte a byte no segmento {i}"
        );
        cursor += seg.cpu_len;
        total += seg.cpu_len as usize;
    }
    assert_eq!(
        cursor,
        got.cpu_address + got.length,
        "{etiqueta}: os segmentos non cubren a lonxitude pedida"
    );
}

fn describe_estado(estado: &MapperState) -> String {
    if estado.keys.is_empty() {
        return "(vazio)".to_string();
    }
    estado
        .keys
        .iter()
        .map(|(k, v)| format!("{k}={}", describe_value(v)))
        .collect::<Vec<_>>()
        .join(" ")
}

fn describe_value(value: &Value) -> String {
    match value {
        Value::Uint(n) => format!("{n:#x}"),
        Value::Object(pares) => {
            let interior = pares
                .iter()
                .map(|(k, v)| format!("{k}:{}", describe_value(v)))
                .collect::<Vec<_>>()
                .join(",");
            format!("{{{interior}}}")
        }
        other => format!("{other:?}"),
    }
}

fn cabeceira(out: &mut Informe) {
    out.push("REX · capa de lectura de recursos · informe do exemplo consumidor");
    out.push(format!(
        "contract_version={CONTRACT_VERSION} crate_version={} profiles=5",
        env!("CARGO_PKG_VERSION")
    ));
    out.push(
        "fixture: contido autor = byte(i) = i*37 + (i>>8)*0x5B + (i>>16)*0x2F (u8), \
         ver tests/support/banked.rs",
    );
}

fn main() {
    let mut out = Informe::novo();
    cabeceira(&mut out);

    let md4 = Fixura::nova("md-4mb", MD_4MB);
    let md2 = Fixura::nova("md-2mb", MD_2MB);
    let lorom = Fixura::nova("snes-lorom-512kb", SNES_512KB);
    let hirom = Fixura::nova("snes-hirom-2mb", SNES_2MB);
    let exhirom = Fixura::nova("snes-exhirom-6mb", SNES_6MB);

    for fx in [&md4, &md2, &lorom, &hirom, &exhirom] {
        out.push(format!(
            "IMAXE {} bytes={} sha256={}",
            fx.image.origin, fx.image.byte_len, fx.image.sha256_hex
        ));
    }

    let linear4 = lineal(MD_4MB);
    let linear2 = lineal(MD_2MB);
    let linear_lorom = lineal(SNES_512KB);
    let linear_hirom = lineal(SNES_2MB);
    let linear_exhirom = lineal(SNES_6MB);

    // ── MD linear ────────────────────────────────────────────────────────────
    out.push("");
    out.push("· MD linear");
    out.ler(
        &md4,
        &Caso {
            etiqueta: "md-linear-corredor",
            proba: "unha xanela, un segmento, lineal",
            perfil: Profile::MdLinear,
            estado: &linear4,
            cpu: 0x00_1000,
            lon: 0x40,
            limites: Limits::DEFAULT,
            espera: Espera::Ok,
        },
    );
    out.ler(
        &md2,
        &Caso {
            etiqueta: "md-linear-alias-espello",
            proba: "$200000 é espello de $000000 co rom_size de 2 MB: mesmos \
                    bytes; o enderezo do bus non é o offset físico",
            perfil: Profile::MdLinear,
            estado: &linear2,
            cpu: 0x20_0000,
            lon: 0x20,
            limites: Limits::DEFAULT,
            espera: Espera::Ok,
        },
    );
    out.ler(
        &md2,
        &Caso {
            etiqueta: "md-linear-borde-espello",
            proba: "corte no borde do espello de 2 MB: dous segmentos, o segundo \
                    plegado no offset 0",
            perfil: Profile::MdLinear,
            estado: &linear2,
            cpu: 0x1f_ff00,
            lon: 0x200,
            limites: Limits::DEFAULT,
            espera: Espera::Ok,
        },
    );
    out.ler(
        &md4,
        &Caso {
            etiqueta: "md-linear-fora-da-xanela",
            proba: "$400000 non ten dispositivo: recúsase tras os 16 bytes \
                    reais, que viaxan no erro",
            perfil: Profile::MdLinear,
            estado: &linear4,
            cpu: 0x3f_fff0,
            lon: 0x20,
            limites: Limits::DEFAULT,
            espera: Espera::Code(ResourceErrorCode::NonRomRegion),
        },
    );
    out.ler(
        &md4,
        &Caso {
            etiqueta: "md-linear-z80",
            proba: "$A08000 é RAM do Z80: rexión coñecida que nunca sai da imaxe ROM",
            perfil: Profile::MdLinear,
            estado: &linear4,
            cpu: 0xa0_8000,
            lon: 0x10,
            limites: Limits::DEFAULT,
            espera: Espera::Code(ResourceErrorCode::NonRomRegion),
        },
    );
    out.ler(
        &md4,
        &Caso {
            etiqueta: "md-linear-work-ram",
            proba: "$E00000 é WorkRam do 68K, non cartucho",
            perfil: Profile::MdLinear,
            estado: &linear4,
            cpu: 0xe0_0000,
            lon: 0x10,
            limites: Limits::DEFAULT,
            espera: Espera::Code(ResourceErrorCode::NonRomRegion),
        },
    );

    // ── MD SSF2: aquí o estado é a pregunta ─────────────────────────────────
    out.push("");
    out.push("· MD SSF2 (o mesmo enderezo, dous estados)");
    let banco0 = ssf2(MD_4MB, &[(1, 0)]);
    let banco5 = ssf2(MD_4MB, &[(1, 5)]);
    let banco_outo = ssf2(MD_4MB, &[(7, 3)]);
    out.ler(
        &md4,
        &Caso {
            etiqueta: "ssf2-xanela1-banco0",
            proba: "banco 0 na xanela 1: $080000 é identidade",
            perfil: Profile::MdSsf2,
            estado: &banco0,
            cpu: 0x08_0000,
            lon: 0x20,
            limites: Limits::DEFAULT,
            espera: Espera::Ok,
        },
    );
    out.ler(
        &md4,
        &Caso {
            etiqueta: "ssf2-xanela1-banco5",
            proba: "o MESMO enderezo co banco 5: bytes distintos, offset $280000",
            perfil: Profile::MdSsf2,
            estado: &banco5,
            cpu: 0x08_0000,
            lon: 0x20,
            limites: Limits::DEFAULT,
            espera: Espera::Ok,
        },
    );
    out.ler(
        &md4,
        &Caso {
            etiqueta: "ssf2-porta-xanela-0-1",
            proba: "un segmento por xanela, aínda que as bases sexan contiguas",
            perfil: Profile::MdSsf2,
            estado: &banco5,
            cpu: 0x07_ff00,
            lon: 0x200,
            limites: Limits::DEFAULT,
            espera: Espera::Ok,
        },
    );
    out.ler(
        &md4,
        &Caso {
            etiqueta: "ssf2-xanela7-esouto",
            proba: "banco 3 na xanela 7: o percorrido que viaxa no erro xa está remapeado",
            perfil: Profile::MdSsf2,
            estado: &banco_outo,
            cpu: 0x3f_fff0,
            lon: 0x20,
            limites: Limits::DEFAULT,
            espera: Espera::Code(ResourceErrorCode::NonRomRegion),
        },
    );
    secuencia_bancos(&mut out, &md4, &ssf2(MD_4MB, &[]));

    // ── SNES: as tres familias, cos seus límites á vista ────────────────────
    out.push("");
    out.push("· SNES LoROM");
    out.ler(
        &lorom,
        &Caso {
            etiqueta: "lorom-paxina-a15",
            proba: "$808100: dentro da páxina tírase A15, offset $000100 (non $8100)",
            perfil: Profile::SnesLorom,
            estado: &linear_lorom,
            cpu: 0x80_8100,
            lon: 0x40,
            limites: Limits::DEFAULT,
            espera: Espera::Ok,
        },
    );
    out.ler(
        &lorom,
        &Caso {
            etiqueta: "lorom-io",
            proba: "$2000-$7FFF dos bancos 00-3D/80-BD é I/O do sistema, non ROM",
            perfil: Profile::SnesLorom,
            estado: &linear_lorom,
            cpu: 0x00_4000,
            lon: 0x10,
            limites: Limits::DEFAULT,
            espera: Espera::Code(ResourceErrorCode::NonRomRegion),
        },
    );
    out.ler(
        &lorom,
        &Caso {
            etiqueta: "lorom-ambiguo",
            proba: "metade baixa A15 do banco $40: as fontes pinadas diverxen, \
                    a capa non palpita",
            perfil: Profile::SnesLorom,
            estado: &linear_lorom,
            cpu: 0x40_0000,
            lon: 0x10,
            limites: Limits::DEFAULT,
            espera: Espera::Code(ResourceErrorCode::Ambiguous),
        },
    );

    out.push("");
    out.push("· SNES HiROM");
    out.ler(
        &hirom,
        &Caso {
            etiqueta: "hirom-banco-c0",
            proba: "$C08000: offset = (banco<<16)+A, sen tirar A15, espellado mod 2 MB",
            perfil: Profile::SnesHirom,
            estado: &linear_hirom,
            cpu: 0xc0_8000,
            lon: 0x100,
            limites: Limits::DEFAULT,
            espera: Espera::Ok,
        },
    );
    out.ler(
        &hirom,
        &Caso {
            etiqueta: "hirom-espello-wram",
            proba: "$0000-$1FFF de 00-3D é o espello de WRAM en HiROM, non ROM",
            perfil: Profile::SnesHirom,
            estado: &linear_hirom,
            cpu: 0x00_0000,
            lon: 0x10,
            limites: Limits::DEFAULT,
            espera: Espera::Code(ResourceErrorCode::NonRomRegion),
        },
    );

    out.push("");
    out.push("· SNES ExHiROM");
    out.ler(
        &exhirom,
        &Caso {
            etiqueta: "exhirom-area1-c0",
            proba: "área 1: A22/A23 desconectados, offset = enderezo mod 4 MB",
            perfil: Profile::SnesExhirom,
            estado: &linear_exhirom,
            cpu: 0xc0_0000,
            lon: 0x100,
            limites: Limits::DEFAULT,
            espera: Espera::Ok,
        },
    );
    out.ler(
        &exhirom,
        &Caso {
            etiqueta: "exhirom-fronteira-3f-40",
            proba: "área 2 modular: o offset BAIXA ao pasar de $3F a $40, e iso \
                    son dous segmentos, non un",
            perfil: Profile::SnesExhirom,
            estado: &linear_exhirom,
            cpu: 0x3f_ff_f0,
            lon: 0x20,
            limites: Limits::DEFAULT,
            espera: Espera::Ok,
        },
    );
    let exhirom_4mb = lineal(0x40_0000);
    out.ler(
        &exhirom,
        &Caso {
            etiqueta: "exhirom-tamanho-fóra-de-contrato",
            proba: "ExHiROM só admite 5/6/8 MB: 4 MB é estado inválido, non rango inválido",
            perfil: Profile::SnesExhirom,
            estado: &exhirom_4mb,
            cpu: 0x00_8000,
            lon: 0x20,
            limites: Limits::DEFAULT,
            espera: Espera::Code(ResourceErrorCode::BadState),
        },
    );

    // ── As recusas que son da propia capa, non do perfil ─────────────────────
    out.push("");
    out.push("· Fronteiras da capa (independentes do perfil)");
    out.ler(
        &md4,
        &Caso {
            etiqueta: "longitude-cero",
            proba: "unha lectura de cero bytes non é un recurso",
            perfil: Profile::MdLinear,
            estado: &linear4,
            cpu: 0x1000,
            lon: 0,
            limites: Limits::DEFAULT,
            espera: Espera::Code(ResourceErrorCode::InvalidRange),
        },
    );
    out.ler(
        &md4,
        &Caso {
            etiqueta: "fora-do-barramento",
            proba: "$FFFFF0 + 32 sae do barramento de 24 bits: recúsase antes de percorrer",
            perfil: Profile::MdLinear,
            estado: &linear4,
            cpu: 0xff_fff0,
            lon: 0x20,
            limites: Limits::DEFAULT,
            espera: Espera::Code(ResourceErrorCode::InvalidRange),
        },
    );
    out.ler(
        &md4,
        &Caso {
            etiqueta: "limite-de-bytes",
            proba: "Limits::max_bytes por debaixo do pedido: recúsase antes de reservar",
            perfil: Profile::MdLinear,
            estado: &linear4,
            cpu: 0x1000,
            lon: 0x1000,
            limites: Limits {
                max_bytes: 0x100,
                max_segments: 4096,
            },
            espera: Espera::Code(ResourceErrorCode::LimitExceeded),
        },
    );
    out.ler(
        &md2,
        &Caso {
            etiqueta: "limite-de-segmentos",
            proba: "unha lectura que precisa dous corredores con max_segments=1 \
                    devolve o primeiro dentro do erro",
            perfil: Profile::MdLinear,
            estado: &linear2,
            cpu: 0x1f_fff0,
            lon: 0x20,
            limites: Limits {
                max_bytes: 0x100_0000,
                max_segments: 1,
            },
            espera: Espera::Code(ResourceErrorCode::LimitExceeded),
        },
    );

    // Imaxe curta fronte a estado longo: a atestación é certa (di 1 MB) e aínda
    // así o percorrido se detén. É o caso que demuestra que a capa non clampa.
    let curto = Fixura::nova("md-imaxe-truncada", MD_1MB);
    out.push(format!(
        "IMAXE {} bytes={} sha256={} (o estado segue declarando rom_size de 4 MB)",
        curto.image.origin, curto.image.byte_len, curto.image.sha256_hex
    ));
    out.ler(
        &curto,
        &Caso {
            etiqueta: "imaxe-curta",
            proba: "$100000 cae fóra da imaxe de 1 MB: o percorrido detense e \
                    non se inventan bytes",
            perfil: Profile::MdLinear,
            estado: &linear4,
            cpu: 0x10_0000,
            lon: 0x20,
            limites: Limits::DEFAULT,
            espera: Espera::Code(ResourceErrorCode::IncompatibleSize),
        },
    );

    // Attestación non verificable: aquí si que a capa nega antes de tocar datos.
    let sen_sha = ImageIdentity {
        origin: "fixture:sen-identidade".to_string(),
        sha256_hex: "00".to_string(),
        byte_len: md4.rom.len() as u64,
    };
    let e = read_resource(
        &ResourceRequest {
            profile: Profile::MdLinear,
            image: sen_sha,
            state: &linear4,
            cpu_address: 0x1000,
            length: 0x20,
            limits: Limits::DEFAULT,
        },
        &md4.rom,
    )
    .expect_err("un digest de 2 díxitos non é unha atestación");
    assert_eq!(e.code, ResourceErrorCode::BadAttestation);
    assert!(
        e.segments.is_empty(),
        "unha atestación inválida non pode deixar percorrido detrás"
    );
    out.recusa(
        "atestacion-malformada",
        "sha256_hex de 2 díxitos: sen orixe verificable non hai lectura",
        Profile::MdLinear,
        &e,
    );
    out.codigos.push(e.code.as_str());

    // ── Peche ────────────────────────────────────────────────────────────────
    let mut vistos = out.codigos.clone();
    vistos.sort_unstable();
    vistos.dedup();
    out.push("");
    out.push(format!(
        "RESUMO lecturas={} recusas={} codigos_de_recusa[{}]",
        out.lecturas,
        out.recusas,
        vistos.join(",")
    ));
    assert!(
        out.lecturas >= 8,
        "o exemplo deixou de demostrar lecturas exitosas"
    );
    for code in [
        "ambiguous",
        "bad-attestation",
        "bad-state",
        "incompatible-size",
        "invalid-range",
        "limit-exceeded",
        "non-rom-region",
    ] {
        assert!(
            vistos.contains(&code),
            "o informe xa non amosa o motivo de recusa {code}"
        );
    }

    let corpo = out.lineas.join("\n");
    println!("{corpo}");
    println!("resumo sha256={}", sha256::sha256_hex(corpo.as_bytes()));
}

/// Unha secuencia de bancos: lectura, escrita, lectura. É a única forma de amosar
/// na práctica que dous estados viven na mesma chamada sen mesturarse.
fn secuencia_bancos(out: &mut Informe, fx: &Fixura, inicial: &MapperState) {
    let steps: [Step; 5] = [
        Step::Read {
            cpu_address: 0x08_0000,
            length: 8,
        },
        Step::WriteRegister {
            cpu_address: 0xa1_3002,
            data: 5,
        },
        Step::Read {
            cpu_address: 0x08_0000,
            length: 8,
        },
        Step::WriteRegister {
            cpu_address: 0xa1_3004,
            data: 6,
        },
        Step::Read {
            cpu_address: 0x10_0000,
            length: 8,
        },
    ];
    let informe = read_sequence(
        &SequenceRequest {
            profile: Profile::MdSsf2,
            image: fx.image.clone(),
            initial_state: inicial,
            limits: Limits::DEFAULT,
            steps: &steps,
        },
        &fx.rom,
    )
    .expect("secuencia SSF2 válida");

    out.push("");
    out.push(format!(
        "SECUENCIA ssf2-secuencia-bancos :: escritura de banco entre lecturas \
         [perfil=md-ssf2 writes_applied={}]",
        informe.writes_applied
    ));
    assert_eq!(informe.writes_applied, 2);
    assert_eq!(informe.reads.len(), 3);
    let offsets_esperados = [0x08_0000u32, 0x28_0000, 0x30_0000];
    for (i, got) in informe.reads.iter().enumerate() {
        let seg = got
            .segments
            .first()
            .unwrap_or_else(|| panic!("a lectura {i} da secuencia non trae procedencia"));
        assert_eq!(
            seg.state, got.state,
            "secuencia: a lectura {i} non leva o estado co que se leu"
        );
        assert_eq!(
            seg.rom_offset, offsets_esperados[i],
            "secuencia: a lectura {i} cae nun banco distinto do que se escreveu"
        );
        out.push(format!(
            "  paso {}: cpu={:#08x} lon={:#x} offset={:#08x} estado={} sha256={}",
            i,
            got.cpu_address,
            got.length,
            seg.rom_offset,
            describe_estado(&got.state),
            sha256::sha256_hex(&got.bytes)
        ));
        out.lecturas += 1;
        verificar_lectura("ssf2-secuencia-bancos", got);
    }
    out.push(format!(
        "  estado_final: {}",
        describe_estado(&informe.final_state)
    ));
    // O estado prestado non se muta: as escritas son puras.
    assert_eq!(
        *inicial,
        ssf2(MD_4MB, &[]),
        "read_sequence mutou o estado que lle prestaron"
    );
}
