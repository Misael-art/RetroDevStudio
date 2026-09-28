//! ETAPA 6 — paquete de aceite para o adaptador do integrador.
//!
//! Que é isto e para que serve: un ficheiro [`FICHEIRO`] con casos de
//! lectura/recusa e as **saídas esperadas en datos**, non en código. O
//! integrador pode facer circular eses casos pola fronteira real do backend
//! (IPC + adaptador + DTO) e comparar contra o mesmo JSON sen reimplementar
//! ningunha regra de enderezamento.
//!
//! De onde sae o esperado (e por que non está viciado polo produto):
//!
//! 1. **desprazamento físico** → `support::windows_engine`: o matcher
//!    declarativo de xanelas de bsnes (táboa `windows-generated.json`,
//!    extraída mecanicamente de `boards.bml`) e, para SSF2, a simulación da
//!    táboa de 64 páxinas de GPGX. Non comparte fórmula con `translate()`.
//! 2. **corte en corredores** → a política que `CONTRATO.md` §7 declara en
//!    texto: un segmento por corrida continua de offset, cortando en fin de
//!    xanela/grupo de bancos, borde do espello, fin do barramento e fronteira
//!    ROM→non-ROM; e «MD: corta por xanela de 512KB (SSF2) ou por espello
//!    (linear)». Re-implementase aquí **a man**, desde o documento, non desde
//!    `src/`.
//! 3. **contido dos bytes** → `support::banked::byte_at`, función pechada do
//!    desprazamento, e o seu SHA-256 con `support::sha256`.
//! 4. **códigos de recusa** → a táboa de `CONTRATO.md` §12.3, o mesmo texto que
//!    lle chega ao integrador.
//!
//! Ningunha chamada a `rex_addressing` entra na xeración de expectativas: se o
//! produto e este ficheiro discordan, hai un culpable nomeable. Por iso
//! [`o_xerador_reproduce_o_ficheiro_publicado`] é un test e non unha
//! ferramenta: o JSON publicado ten que saír byte a byte do oráculo.
//!
//! ## Como regenerar despois de cambiar un caso
//!
//! ```bash
//! REX_ACEITE_ESCRIBIR=1 cargo test --offline --test acceptance -- --ignored
//! cargo test --offline --test acceptance          # verde, e a SHA publicada vale
//! ```
//!
//! Despois hai que actualizar [`FICHEIRO_SHA256`] co que imprime o primeiro
//! comando: un ficheiro de aceite editado a man sen cambiar o xerador é
//! exactamente o que esta batería existe para impedir.

mod support;

use rex_addressing::resource::{
    read_resource, read_sequence, ImageIdentity, Limits, Profile, ResourceError, ResourceErrorCode,
    ResourceRead, ResourceRequest, SequenceRead, SequenceRequest, Step, CONTRACT_VERSION,
};
use rex_addressing::{MapperState, Region, Value};
use support::{
    banked,
    json::Json,
    sha256::sha256_hex,
    windows_engine::{self, Engine, Ssf2Engine},
};

/// O ficheiro publicado, compilado dentro do binario: así o aceite viaxa coa
/// crate e non depende de que a ruta exista en tempo de execución.
const FICHEIRO: &str = include_str!("../vectors/acceptance-v1.json");

/// SHA-256 do ficheiro publicado. Pinada aquí para que calquera cambio nas
/// expectativas teña que pasar por o xerador (ou por unha edición explícita
/// deste literal, que aparece na revisión).
const FICHEIRO_SHA256: &str = "54ba2b6e864c53ba69228b51d0a4cf079735182ad875ecb8e98b6dbbf257a216";

const BUS_LIMIT: u32 = 0xFF_FFFF;
/// 512 KB: a unidade que SSF2 remapea e á que `CONTRATO.md` §7 ata a política
/// de «un segmento por xanela» no perfil MD con rexistradores.
const SSF2_WINDOW: u32 = 0x8_0000;
/// $2000: a granularidade **máis pequena** na que as táboas declarativas pon
/// fronteiras (rangs `$0000-$1FFF`, `$2000-$7FFF`, `$8000-$FFFF` e máscaras de
/// bit ≥ 13). Dentro dun tramo aliñado a $2000 o desprazamento do motor é afin
/// de pendente +1, así que comprobar o último byte do tramo abonda; se inda así
/// o sondeo falla, vólvese a byte por byte dentro dese tramo.
const TRAMO: u64 = 0x2000;
/// Por riba deste tamaño non se imprime `bytes_hex`: un vector de aceite de
/// megabytes de hexadecimal non é lible nin diffable. O SHA-256 si vai sempre.
const HEX_TOPE: usize = 64;

// ------------------------------------------------------------------ casos

#[derive(Clone, Copy, PartialEq, Eq)]
enum Oper {
    Recurso,
    Secuencia,
}

/// Un caso de aceite: só a **entrada**. O esperado derivase con [`derivar`] e
/// escríbeo [`xerar`].
struct Caso {
    id: &'static str,
    que_proba: &'static str,
    oper: Oper,
    perfil: Profile,
    /// `rom_size` declarado no estado.
    size: u32,
    /// Bancos SSF2 (`xanela -> valor`); baleiro nos demais perfis.
    bancos: &'static [(u64, u64)],
    /// Bytes do buffer que se entrega. Pode ser menor que `size`: así se modela
    /// unha imaxe truncada sen tocar o estado.
    imaxe: usize,
    orixe: &'static str,
    cpu: u32,
    length: u32,
    max_bytes: u32,
    max_segments: u32,
    pasos: &'static [Step],
    /// `true` = o `sha256_hex` da atestación é o doutra imaxe (ver
    /// [`a_capa_non_pode_verificar_o_digesto`]).
    digito_minte: bool,
    /// Clave extra no estado, para casos de política (`bad-state`).
    clave_extra: Option<&'static str>,
    /// Subcadena que o `detail` dunha recusa ten que conter: é o que a UI do
    /// adaptador necesita para explicar a recusa sen adiviñar.
    detalle_menciona: Option<&'static str>,
}

const IMAXE_1M: usize = 0x10_0000;
const IMAXE_2M: usize = 0x20_0000;
/// 4 MB: a única imaxe onde o valor `5` escrito nunha xanela SSF2 é visible.
/// Nunha imaxe de 2 MB, `5 << 19 = 0x280000` recorta pola máscara a `0x80000`,
/// que é exactamente a identidade da xanela 1: o banco escribiríase e non se
/// lería. Un aceite que non pode distinguir remapeo de identidade non aceita
/// nada, así que os casos con bancos van con imaxe de 4 MB.
const IMAXE_4M: usize = 0x40_0000;

/// Pasos da secuencia A6: ler a xanela 1, remapeala ao banco 5, volvela ler e
/// ler unha xanela non afectada. `$A13003` → `w = (addr & 0x0E) >> 1 = 1`
/// (CONTRATO.md §8). A lectura anterior á escrita e a xanela 2 despois son a
/// evidencia que §8 esixe: `0x80000 → 0x280000` na afectada, `0x100000`
/// byte a byte igual na non afectada.
fn pasos_a6() -> &'static [Step] {
    &[
        Step::Read {
            cpu_address: 0x08_0000,
            length: 0x20,
        },
        Step::WriteRegister {
            cpu_address: 0x00A1_3003,
            data: 5,
        },
        Step::Read {
            cpu_address: 0x08_0000,
            length: 0x20,
        },
        Step::Read {
            cpu_address: 0x10_0000,
            length: 0x20,
        },
    ]
}

fn casos() -> Vec<Caso> {
    let base = |perfil: Profile| Caso {
        id: "",
        que_proba: "",
        oper: Oper::Recurso,
        perfil,
        size: 0,
        bancos: &[],
        imaxe: 0,
        orixe: "",
        cpu: 0,
        length: 0,
        max_bytes: 0x100_0000,
        max_segments: 4096,
        pasos: &[],
        digito_minte: false,
        clave_extra: None,
        detalle_menciona: None,
    };

    vec![
        // 1. Lectura simple dentro da xanela do cartucho.
        Caso {
            id: "A1-lectura-simple-md-linear",
            que_proba: "unha lectura dentro da xanela do cartucho devolve os bytes do offset físico que declara a procedencia",
            perfil: Profile::MdLinear,
            size: IMAXE_1M as u32,
            imaxe: IMAXE_1M,
            orixe: "fixture:aceite-A1",
            cpu: 0x01_0000,
            length: 0x20,
            ..base(Profile::MdLinear)
        },
        // 2. Cruza a fronteira entre dúas xanelas SSF2 que son fisicamente
        // contiguas: dous corredores aínda que os bytes o estean.
        Caso {
            id: "A2-fronteira-de-xanela-ssf2",
            que_proba: "cruzar a fronteira de xanela de 512 KB abre un segmento novo coa súa base, non emende un corredor",
            perfil: Profile::MdSsf2,
            size: IMAXE_2M as u32,
            imaxe: IMAXE_2M,
            orixe: "fixture:aceite-A2",
            cpu: 0x07_FFF0,
            length: 0x20,
            ..base(Profile::MdSsf2)
        },
        // 3. Alias: outro enderezo do bus, mesma posición física que A1.
        Caso {
            id: "A3-alias-mesma-imaxe",
            que_proba: "dous enderezos que o espello por máscara identifica devolven bytes idénticos co mesmo rom_offset e cpu_address distintos",
            perfil: Profile::MdLinear,
            size: IMAXE_1M as u32,
            imaxe: IMAXE_1M,
            orixe: "fixture:aceite-A3",
            cpu: 0x11_0000,
            length: 0x20,
            ..base(Profile::MdLinear)
        },
        // 4. Rexión non-ROM no medio do percorrido: a recusa leva o que si se
        // leu antes de deterse.
        Caso {
            id: "A4-rexion-non-rom-tras-ROM",
            que_proba: "un percorrido que comeza en ROM e cai no espello WRAM recúsase con non-rom-region, rexión nomeada e o corredor xa lido na procedencia",
            perfil: Profile::SnesLorom,
            size: 0x8_0000,
            imaxe: 0x8_0000,
            orixe: "fixture:aceite-A4",
            cpu: 0x00_FFF0,
            length: 0x20,
            detalle_menciona: Some("wram-mirror"),
            ..base(Profile::SnesLorom)
        },
        // 5a. Lonxitude cero.
        Caso {
            id: "A5a-longitude-cero",
            que_proba: "length 0 é invalid-range antes de percorrer, con procedencia baleira",
            perfil: Profile::MdLinear,
            size: IMAXE_1M as u32,
            imaxe: IMAXE_1M,
            orixe: "fixture:aceite-A5a",
            cpu: 0x01_0000,
            length: 0,
            detalle_menciona: Some("length"),
            ..base(Profile::MdLinear)
        },
        // 5b. Rango que sae do barramento.
        Caso {
            id: "A5b-rango-fora-do-barramento",
            que_proba: "cpu_address + length - 1 fóra do barramento é invalid-range sen percorrer nada",
            perfil: Profile::MdLinear,
            size: IMAXE_1M as u32,
            imaxe: IMAXE_1M,
            orixe: "fixture:aceite-A5b",
            cpu: BUS_LIMIT - 0x0F,
            length: 0x20,
            detalle_menciona: Some("barramento"),
            ..base(Profile::MdLinear)
        },
        // 5c. Límite de bytes da chamada.
        Caso {
            id: "A5c-limite-de-bytes",
            que_proba: "un length por riba de Limits::max_bytes recúsase con limit-exceeded sen reservar",
            perfil: Profile::MdLinear,
            size: IMAXE_1M as u32,
            imaxe: IMAXE_1M,
            orixe: "fixture:aceite-A5c",
            cpu: 0x01_0000,
            length: 0x20,
            max_bytes: 0x10,
            detalle_menciona: Some("max_bytes"),
            ..base(Profile::MdLinear)
        },
        // 5d. Límite de corredores.
        Caso {
            id: "A5d-limite-de-segmentos",
            que_proba: "superar Limits::max_segments devolve limit-exceeded coa procedencia percorrida ata o tope",
            perfil: Profile::MdSsf2,
            size: IMAXE_2M as u32,
            imaxe: IMAXE_2M,
            orixe: "fixture:aceite-A5d",
            cpu: 0x00_0000,
            length: 0x10_0000,
            max_segments: 1,
            detalle_menciona: Some("segmentos"),
            ..base(Profile::MdSsf2)
        },
        // 5e. Imaxe máis curta que o declarado.
        Caso {
            id: "A5e-imaxe-curta",
            que_proba: "unha imaxe máis curta que rom_size devolve incompatible-size e o prefixo real na procedencia, nunca bytes inventados",
            perfil: Profile::SnesHirom,
            size: IMAXE_1M as u32,
            imaxe: 0x8010,
            orixe: "fixture:aceite-A5e",
            cpu: 0x40_8000,
            length: 0x20,
            detalle_menciona: Some("máis curta"),
            ..base(Profile::SnesHirom)
        },
        // 6. Secuencia con troca de bancos: antes/despois e unha xanela á que
        // a escrita non afecta.
        Caso {
            id: "A6-secuencia-ssf2-remapeo",
            que_proba: "unha escrita de rexistrador na secuencia cambia os bytes da súa xanela (0x80000 → 0x280000) sen tocar a xanela 2, e o estado final vai na resposta",
            perfil: Profile::MdSsf2,
            size: IMAXE_4M as u32,
            imaxe: IMAXE_4M,
            orixe: "fixture:aceite-A6",
            pasos: pasos_a6(),
            oper: Oper::Secuencia,
            ..base(Profile::MdSsf2)
        },
        // 7. Dous estados que non se toca entre si.
        Caso {
            id: "A7a-instancia-con-banco",
            que_proba: "o estado A co banco 5 na xanela 1 lé a base 0x280000",
            perfil: Profile::MdSsf2,
            size: IMAXE_4M as u32,
            bancos: &[(1, 5)],
            imaxe: IMAXE_4M,
            orixe: "fixture:aceite-A7a",
            cpu: 0x08_0000,
            length: 0x20,
            ..base(Profile::MdSsf2)
        },
        Caso {
            id: "A7b-instancia-sen-banco",
            que_proba: "o estado B sen escritas segue lendo a identidade 0x80000 despois de ler con A: as dúas instancias non comparten estado",
            perfil: Profile::MdSsf2,
            size: IMAXE_4M as u32,
            imaxe: IMAXE_4M,
            orixe: "fixture:aceite-A7b",
            cpu: 0x08_0000,
            length: 0x20,
            ..base(Profile::MdSsf2)
        },
        // 8. Procedencia que reconstrúe os bytes: tres xanelas, tres bases.
        Caso {
            id: "A8-procedencia-reconstrue",
            que_proba: "a lista de segmentos reconstrúe byte a byte a saída, con índices e cpu_address contiguos e bases distintas por banco",
            perfil: Profile::MdSsf2,
            size: IMAXE_4M as u32,
            bancos: &[(1, 5), (2, 3)],
            imaxe: IMAXE_4M,
            orixe: "fixture:aceite-A8",
            cpu: 0x00_0000,
            length: 0x18_0000,
            ..base(Profile::MdSsf2)
        },
        // 9. Política de estado: clave allea nun perfil sen rexistradores.
        Caso {
            id: "A9-estado-alleo-bad-state",
            que_proba: "unha clave de mapper nun perfil sen rexistradores é bad-state co nome do perfil no detalle, antes de percorrer",
            perfil: Profile::SnesHirom,
            size: IMAXE_1M as u32,
            imaxe: IMAXE_1M,
            orixe: "fixture:aceite-A9",
            cpu: 0x40_8000,
            length: 0x10,
            clave_extra: Some("banks"),
            detalle_menciona: Some("snes-hirom"),
            ..base(Profile::SnesHirom)
        },
        // 10. Capacidade que a capa NON ten: o digesto non se verifica.
        Caso {
            id: "A10-capacidade-digesto-non-verificado",
            que_proba: "a capa comproba a FORMA do digesto e o byte_len, non que sexa o SHA-256 deses bytes: quen hashear é o adaptador",
            perfil: Profile::MdLinear,
            size: IMAXE_1M as u32,
            imaxe: IMAXE_1M,
            orixe: "fixture:aceite-A10",
            cpu: 0x02_0000,
            length: 0x20,
            digito_minte: true,
            ..base(Profile::MdLinear)
        },
    ]
}

/// Os casos que teñen unha soa lectura (os de secuencia non).
fn casos_de_lectura() -> Vec<Caso> {
    casos()
        .into_iter()
        .filter(|c| c.oper == Oper::Recurso)
        .collect()
}

// ------------------------------------------------------------ oráculo

/// Un corredor da saída esperada.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Seg {
    indice: u32,
    cpu_address: u32,
    cpu_len: u32,
    rom_offset: u32,
}

/// Como o motor de xanelas declara que unha lectura se detén.
enum Motivo {
    /// O enderezo sae do barramento (o oráculo di `out-of-range`).
    Rango,
    /// As fontes pinadas diverxen (`ambiguous`).
    Ambiguo,
    /// Área sen dispositivo: recúsase sen nomear rexión.
    SenDispositivo,
    /// Rexión coñecida sen backing ROM.
    NonRom(String),
    /// O desprazamento cae fóra da imaxe realmente entregada.
    ImaxeCurta,
}

/// Recusa derivada polo oráculo, coa procedencia que xa leva.
#[derive(Clone, Debug)]
struct Fallo {
    codigo: &'static str,
    detido_en: Option<u32>,
    rexion: Option<String>,
    levados: Vec<Seg>,
}

impl Motivo {
    fn fallo(self, detido_en: u32, levados: Vec<Seg>) -> Fallo {
        let (codigo, rexion) = match self {
            Motivo::Rango => ("invalid-range", None),
            Motivo::Ambiguo => ("ambiguous", None),
            Motivo::SenDispositivo => ("non-rom-region", None),
            Motivo::NonRom(r) => ("non-rom-region", Some(r)),
            Motivo::ImaxeCurta => ("incompatible-size", None),
        };
        Fallo {
            codigo,
            detido_en: Some(detido_en),
            rexion,
            levados,
        }
    }

    /// Recusa de política da capa: anterior a calquera percorrido, logo sen
    /// enderezo e sen procedencia.
    fn sen_enderezo(self) -> Fallo {
        let mut f = self.fallo(0, Vec::new());
        f.detido_en = None;
        f
    }
}

/// Resultado de percorrer co oráculo.
enum Derivado {
    Ok { segmentos: Vec<Seg>, bytes: Vec<u8> },
    Err(Fallo),
}

struct Referencia {
    táboa: Option<windows_engine::Table>,
    ssf2: Option<Box<Ssf2Engine>>,
}

impl Referencia {
    fn nova(perfil: Profile, size: u32, bancos: &[(u64, u64)]) -> Referencia {
        if perfil == Profile::MdSsf2 {
            Referencia {
                táboa: None,
                ssf2: Some(Box::new(Ssf2Engine::new(u64::from(size), bancos))),
            }
        } else {
            Referencia {
                táboa: Some(windows_engine::table_for(perfil.id(), u64::from(size))),
                ssf2: None,
            }
        }
    }

    /// `Ssf2Engine::translate` xa resolve `$400000-$FFFFFF` coa súa propia
    /// táboa interna, así que os dous perfis MD e os tres SNES caben nunha
    /// soa chamada.
    fn translate(&self, addr: u32) -> Engine {
        match self {
            Referencia {
                táboa: Some(t),
                ssf2: None,
            } => t.translate(u64::from(addr)),
            Referencia {
                ssf2: Some(e),
                táboa: None,
            } => e.translate(u64::from(addr)),
            _ => panic!("referencia sen táboa nin motor SSF2"),
        }
    }
}

/// Desprazamento físico que o oráculo declara para `addr`, ou a razón de
/// deterse.
fn offset_rom(ref_: &Referencia, addr: u32, imaxe_len: usize) -> Result<u64, Motivo> {
    match ref_.translate(addr) {
        Engine::Ok { region, offset } => {
            if region != "rom" {
                return Err(Motivo::NonRom(region));
            }
            if usize::try_from(offset).map_or(true, |o| o >= imaxe_len) {
                return Err(Motivo::ImaxeCurta);
            }
            Ok(offset)
        }
        Engine::Err(codigo) => Err(match codigo.as_str() {
            "out-of-range" => Motivo::Rango,
            "ambiguous" => Motivo::Ambiguo,
            _ => Motivo::SenDispositivo,
        }),
    }
}

/// Entrada dunha soa lectura, sexa dun caso de `read_resource` sexa dun paso de
/// lectura dentro dunha secuencia. Vive en parámetros, non nun `Caso`, porque
/// os bancos dunha secuencia só se coñecen durante a percorrida.
struct Lectura<'a> {
    perfil: Profile,
    size: u32,
    bancos: &'a [(u64, u64)],
    cpu: u32,
    length: u32,
    imaxe_len: usize,
    max_bytes: u32,
    max_segments: u32,
    /// `true` cando o perfil rexeita o estado (clave allea nun perfil sen
    /// rexistradores): validación da capa, non do motor.
    estado_rexeitado: bool,
}

fn lectura_do_caso(caso: &Caso) -> Lectura<'_> {
    Lectura {
        perfil: caso.perfil,
        size: caso.size,
        bancos: caso.bancos,
        cpu: caso.cpu,
        length: caso.length,
        imaxe_len: caso.imaxe,
        max_bytes: caso.max_bytes,
        max_segments: caso.max_segments,
        estado_rexeitado: caso.clave_extra.is_some() && caso.perfil != Profile::MdSsf2,
    }
}

/// Percorrido completo: corredores maximais de offsets consecutivos, co corte
/// adicional de xanela en SSF2 (CONTRATO.md §7).
fn percorrer(d: &Lectura) -> Result<Vec<Seg>, Fallo> {
    let ref_ = Referencia::nova(d.perfil, d.size, d.bancos);
    let fin = u64::from(d.cpu) + u64::from(d.length);
    let mut segmentos: Vec<Seg> = Vec::new();
    let mut addr = u64::from(d.cpu);
    while addr < fin {
        let a = addr as u32;
        let inicio = match offset_rom(&ref_, a, d.imaxe_len) {
            Ok(offset) => offset,
            Err(motivo) => return Err(motivo.fallo(a, segmentos)),
        };
        let n = estender_corrida(d, &ref_, a, inicio, fin);
        segmentos.push(Seg {
            indice: segmentos.len() as u32,
            cpu_address: a,
            cpu_len: n as u32,
            rom_offset: inicio as u32,
        });
        addr += n;
    }
    Ok(segmentos)
}

/// Cantos bytes seguen a `a` nunha corrida continua de offsets, co corte de
/// xanela SSF2 aplicado.
///
/// Non se sonda byte a byte: o tope estrutural (borde da xanela de 512 KB en
/// SSF2) e os tramos de $2000 dan os únicos puntos onde calquera das táboas
/// declarativas pode cambiar de pendente. Se aínda así o sondeo do último byte
/// do tramo non casa, avanza byte a byte dentro del: a optimización é unha
/// aceleración, nunca un suposto de corrección.
fn estender_corrida(d: &Lectura, ref_: &Referencia, a: u32, inicio: u64, fin: u64) -> u64 {
    let mut tope = fin - u64::from(a);
    if d.perfil == Profile::MdSsf2 {
        let borde = (u64::from(a) / u64::from(SSF2_WINDOW) + 1) * u64::from(SSF2_WINDOW);
        tope = tope.min(borde - u64::from(a));
    }
    let mut n = 1u64;
    while n < tope {
        let actual = u64::from(a) + n;
        // O tramo ten que ser estritamente posterior a `actual`: redondear ao
        // múltiplo máis próximo devolve `actual` cando `actual` xa é múltiplo de
        // TRAMO, o paso sae 0 e o bucle non avanza nunca (A8 chega a $2000).
        let seguinte_tramo = (actual / TRAMO + 1) * TRAMO;
        let paso = (seguinte_tramo - actual).min(tope - n);
        let candidato = n + paso;
        let ultimo = (u64::from(a) + candidato - 1) as u32;
        match offset_rom(ref_, ultimo, d.imaxe_len) {
            Ok(o) if o == inicio + candidato - 1 => n = candidato,
            _ => {
                let mut m = n;
                while m < candidato {
                    let x = (u64::from(a) + m) as u32;
                    match offset_rom(ref_, x, d.imaxe_len) {
                        Ok(o) if o == inicio + m => m += 1,
                        _ => break,
                    }
                }
                return m;
            }
        }
    }
    n
}

/// Bytes que o oráculo declara para unhas procedencias: por cada corredor, o
/// cacho da imaxe na súa posición física.
fn bytes_dos_segmentos(segmentos: &[Seg]) -> Vec<u8> {
    let mut out = Vec::new();
    for s in segmentos {
        out.extend(banked::expect(s.rom_offset as usize, s.cpu_len as usize));
    }
    out
}

/// Expectativa completa dunha lectura: primeiro as validacións da capa, na orde
/// que `CONTRATO.md` §12.1 fixa, e despois o percorrido do motor.
fn derivar(d: &Lectura) -> Derivado {
    if d.length < 1 {
        return Derivado::Err(Motivo::Rango.sen_enderezo());
    }
    if u64::from(d.cpu) + u64::from(d.length) - 1 > u64::from(BUS_LIMIT) {
        return Derivado::Err(Motivo::Rango.sen_enderezo());
    }
    if d.length > d.max_bytes {
        return Derivado::Err(Fallo {
            codigo: "limit-exceeded",
            detido_en: None,
            rexion: None,
            levados: Vec::new(),
        });
    }
    if d.estado_rexeitado {
        return Derivado::Err(Fallo {
            codigo: "bad-state",
            detido_en: None,
            rexion: None,
            levados: Vec::new(),
        });
    }
    match percorrer(d) {
        Ok(segmentos) => {
            // `max_segments` é un tope do *resultado*: o oráculo corta onde o
            // contrato di que corta, e leva os primeiros `max_segments`.
            if segmentos.len() as u32 > d.max_segments {
                let levados = segmentos[..d.max_segments as usize].to_vec();
                let detido_en = levados
                    .last()
                    .map(|s| s.cpu_address + s.cpu_len)
                    .unwrap_or(d.cpu);
                return Derivado::Err(Fallo {
                    codigo: "limit-exceeded",
                    detido_en: Some(detido_en),
                    rexion: None,
                    levados,
                });
            }
            let bytes = bytes_dos_segmentos(&segmentos);
            Derivado::Ok { segmentos, bytes }
        }
        Err(fallo) => Derivado::Err(fallo),
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

// -------------------------------------------------- construción de entradas

fn imaxe_de(caso: &Caso) -> Vec<u8> {
    banked::image(caso.imaxe)
}

/// O estado que o caso declara.
fn estado_de(caso: &Caso) -> MapperState {
    if let Some(clave) = caso.clave_extra {
        // Caso de política: un perfil sen rexistradores recibe a clave dun que
        // si os ten. Constrúese á man para que a clave allea sexa literal.
        return MapperState::from_entries(vec![
            ("rom_size".to_string(), Value::Uint(u64::from(caso.size))),
            (clave.to_string(), Value::Uint(1)),
        ]);
    }
    if caso.perfil == Profile::MdSsf2 {
        return MapperState::ssf2(u64::from(caso.size), caso.bancos);
    }
    MapperState::rom_size(u64::from(caso.size))
}

/// `estado` tal e como vai publicado no JSON para un caso.
fn estado_json(caso: &Caso) -> String {
    if caso.perfil == Profile::MdSsf2 {
        format!(
            "{{\"rom_size\": {}, \"banks\": {{{}}}}}",
            caso.size,
            banks_json(caso.bancos)
        )
    } else if let Some(clave) = caso.clave_extra {
        format!("{{\"rom_size\": {}, \"{clave}\": 1}}", caso.size)
    } else {
        format!("{{\"rom_size\": {}}}", caso.size)
    }
}

fn banks_json(bancos: &[(u64, u64)]) -> String {
    let partes: Vec<String> = bancos
        .iter()
        .map(|(w, v)| format!("\"{w}\": {v}"))
        .collect();
    partes.join(", ")
}

fn atestacion_de(caso: &Caso, rom: &[u8]) -> ImageIdentity {
    let digesto = if caso.digito_minte {
        // SHA dunha imaxe DISTINTA: a capa non pode velo, e iso é o que o caso
        // declara. Segue tendo a forma dun SHA-256 — o mal formado si se
        // rexeita.
        let real = sha256_hex(rom);
        let mut letras: Vec<char> = real.chars().collect();
        let ultimo = letras.len() - 1;
        letras[ultimo] = if letras[ultimo] == '0' { '1' } else { '0' };
        letras.into_iter().collect()
    } else {
        sha256_hex(rom)
    };
    ImageIdentity {
        origin: caso.orixe.to_string(),
        sha256_hex: digesto,
        byte_len: rom.len() as u64,
    }
}

fn limites_de(caso: &Caso) -> Limits {
    Limits {
        max_bytes: caso.max_bytes,
        max_segments: caso.max_segments,
    }
}

fn le_recurso(caso: &Caso, rom: &[u8]) -> ResourceRead {
    let estado = estado_de(caso);
    let req = ResourceRequest {
        profile: caso.perfil,
        image: atestacion_de(caso, rom),
        state: &estado,
        cpu_address: caso.cpu,
        length: caso.length,
        limits: limites_de(caso),
    };
    read_resource(&req, rom).unwrap_or_else(|e| panic!("{}: {}", caso.id, e.detail))
}

fn recusa_de(caso: &Caso, rom: &[u8]) -> ResourceError {
    let estado = estado_de(caso);
    let req = ResourceRequest {
        profile: caso.perfil,
        image: atestacion_de(caso, rom),
        state: &estado,
        cpu_address: caso.cpu,
        length: caso.length,
        limits: limites_de(caso),
    };
    match read_resource(&req, rom) {
        Ok(_) => panic!("{}: esperaba recusa", caso.id),
        Err(err) => err,
    }
}

// ------------------------------------------------------------- xeración

/// Identidade que toda expectativa de lectura leva: o que a capa ten que
/// devolver tal como lle chegou.
struct Cabecera {
    perfil: &'static str,
    orixe: String,
    digesto: String,
    estado: String,
}

impl Cabecera {
    fn nova(caso: &Caso, rom: &[u8], estado: String) -> Cabecera {
        let imaxe = atestacion_de(caso, rom);
        Cabecera {
            perfil: caso.perfil.id(),
            orixe: imaxe.origin,
            digesto: imaxe.sha256_hex,
            estado,
        }
    }

    /// Para un paso de lectura dentro dunha secuencia: mesmos campos, estado
    /// do momento.
    fn na_secuencia(caso: &Caso, rom: &[u8], bancos: &[(u64, u64)]) -> Cabecera {
        let imaxe = atestacion_de(caso, rom);
        Cabecera {
            perfil: caso.perfil.id(),
            orixe: imaxe.origin,
            digesto: imaxe.sha256_hex,
            estado: format!(
                "{{\"rom_size\": {}, \"banks\": {{{}}}}}",
                caso.size,
                banks_json(bancos)
            ),
        }
    }
}

fn esperado_ok(cab: &Cabecera, segmentos: &[Seg], bytes: &[u8], cpu: u32, length: u32) -> String {
    let campo_hex = if bytes.len() <= HEX_TOPE {
        format!(", \"bytes_hex\": {:?}", hex(bytes))
    } else {
        String::new()
    };
    format!(
        "{{\"ok\": true, \"perfil\": {:?}, \"cpu_address\": {}, \"length\": {length}, \"ataestacion\": {{\"origin\": {:?}, \"sha256_hex\": {:?}}}, \"estado\": {}, \"segmentos\": {}, \"bytes_len\": {}{campo_hex}, \"bytes_sha256\": {:?}}}",
        cab.perfil,
        cpu,
        cab.orixe,
        cab.digesto,
        cab.estado,
        segmentos_json(segmentos),
        bytes.len(),
        sha256_hex(bytes),
    )
}

fn esperado_err(fallo: &Fallo, menciona: Option<&str>) -> String {
    let rexion = match &fallo.rexion {
        Some(r) => format!("{r:?}"),
        None => "null".to_string(),
    };
    let detido = match fallo.detido_en {
        Some(n) => format!("{{\"dec\": {n}, \"hex\": {:?}}}", format!("{n:#x}")),
        None => "null".to_string(),
    };
    let menciona = match menciona {
        Some(m) => format!(", \"detalle_menciona\": {m:?}"),
        None => String::new(),
    };
    format!(
        "{{\"ok\": false, \"codigo\": {:?}, \"detido_en\": {detido}, \"rexion\": {rexion}, \"segmentos_na_recusa\": {}{menciona}}}",
        fallo.codigo,
        segmentos_json(&fallo.levados),
    )
}

fn esperado_json(caso: &Caso, rom: &[u8]) -> String {
    match derivar(&lectura_do_caso(caso)) {
        Derivado::Ok { segmentos, bytes } => {
            let cab = Cabecera::nova(caso, rom, estado_json(caso));
            esperado_ok(&cab, &segmentos, &bytes, caso.cpu, caso.length)
        }
        Derivado::Err(fallo) => esperado_err(&fallo, caso.detalle_menciona),
    }
}

/// Expectativa dunha secuencia: cada paso de lectura grádase contra o estado
/// resultante das escritas anteriores, e o `estado_final` vai publicado.
fn esperado_secuencia(caso: &Caso, rom: &[u8]) -> String {
    let mut bancos: Vec<(u64, u64)> = caso.bancos.to_vec();
    let mut escritas = 0u32;
    let mut lecturas: Vec<String> = Vec::new();
    for paso in caso.pasos {
        match *paso {
            Step::WriteRegister { cpu_address, data } => {
                let xanela = u64::from((cpu_address & 0x0E) >> 1);
                assert!(xanela > 0, "{}: a xanela 0 é inerte", caso.id);
                bancos.retain(|(w, _)| *w != xanela);
                bancos.push((xanela, u64::from(data)));
                escritas += 1;
            }
            Step::Read {
                cpu_address,
                length,
            } => {
                let d = Lectura {
                    perfil: caso.perfil,
                    size: caso.size,
                    bancos: &bancos,
                    cpu: cpu_address,
                    length,
                    imaxe_len: caso.imaxe,
                    max_bytes: caso.max_bytes,
                    max_segments: caso.max_segments,
                    estado_rexeitado: false,
                };
                let cab = Cabecera::na_secuencia(caso, rom, &bancos);
                lecturas.push(match derivar(&d) {
                    Derivado::Ok { segmentos, bytes } => {
                        esperado_ok(&cab, &segmentos, &bytes, cpu_address, length)
                    }
                    Derivado::Err(fallo) => esperado_err(&fallo, None),
                });
            }
        }
    }
    let final_estado = format!(
        "{{\"rom_size\": {}, \"banks\": {{{}}}}}",
        caso.size,
        banks_json(&bancos)
    );
    format!(
        "{{\"lecturas\": [{}], \"escritas_aplicadas\": {escritas}, \"estado_final\": {final_estado}}}",
        lecturas.join(", "),
    )
}

fn segmentos_json(segmentos: &[Seg]) -> String {
    let partes: Vec<String> = segmentos
        .iter()
        .map(|s| {
            format!(
                "{{\"indice\": {}, \"cpu_address\": {}, \"cpu_address_hex\": {:?}, \"cpu_len\": {}, \"rom_offset\": {}, \"rom_offset_hex\": {:?}, \"rexion\": \"rom\"}}",
                s.indice,
                s.cpu_address,
                format!("{:#x}", s.cpu_address),
                s.cpu_len,
                s.rom_offset,
                format!("{:#x}", s.rom_offset),
            )
        })
        .collect();
    format!("[{}]", partes.join(", "))
}

fn xerar() -> String {
    let mut out = String::new();
    out.push_str("{\n");
    out.push_str("  \"formato\": \"rex-acceptance-v1\",\n");
    out.push_str(&format!("  \"contract_version\": {CONTRACT_VERSION},\n"));
    out.push_str("  \"nota\": \"Vectores de aceite da capa de lectura. O esperado deriva do motor de xanelas de bsnes/GPGX e da política de corredores de CONTRATO.md §7 e §12.3; nunca de translate() nin read_resource().\",\n");
    out.push_str("  \"regra_imaxe\": {\n");
    out.push_str("    \"id\": \"banked-byte-at-v1\",\n");
    out.push_str("    \"formula\": \"byte(i) = (i*37 + (i>>8)*91 + (i>>16)*47) mod 256\",\n");
    out.push_str("    \"uso\": \"reconstruír a imaxe que hai que entregar xunto co caso; `imaxe.byte_len` dá o tamaño\"\n");
    out.push_str("  },\n");
    out.push_str("  \"casos\": [\n");
    let lista = casos();
    for (i, caso) in lista.iter().enumerate() {
        let rom = imaxe_de(caso);
        let identidade = atestacion_de(caso, &rom);
        out.push_str("    {\n");
        out.push_str(&format!("      \"id\": {:?},\n", caso.id));
        out.push_str(&format!("      \"que_proba\": {:?},\n", caso.que_proba));
        out.push_str(&format!(
            "      \"operacion\": {:?},\n",
            match caso.oper {
                Oper::Recurso => "read_resource",
                Oper::Secuencia => "read_sequence",
            }
        ));
        out.push_str(&format!("      \"perfil\": {:?},\n", caso.perfil.id()));
        out.push_str("      \"imaxe\": {\n");
        out.push_str(&format!("        \"orixe\": {:?},\n", caso.orixe));
        out.push_str(&format!("        \"byte_len\": {},\n", identidade.byte_len));
        out.push_str(&format!(
            "        \"sha256\": {:?},\n",
            identidade.sha256_hex
        ));
        out.push_str(&format!(
            "        \"sha256_é_o_da_imaxe\": {}\n",
            !caso.digito_minte
        ));
        out.push_str("      },\n");
        out.push_str(&format!("      \"estado\": {},\n", estado_json(caso)));
        if caso.oper == Oper::Secuencia {
            out.push_str(&format!("      \"pasos\": {},\n", pasos_json(caso)));
            out.push_str(&format!(
                "      \"limites\": {{\"max_bytes\": {}, \"max_segments\": {}}},\n",
                caso.max_bytes, caso.max_segments
            ));
            out.push_str(&format!(
                "      \"esperado\": {}\n",
                esperado_secuencia(caso, &rom)
            ));
        } else {
            out.push_str(&format!(
                "      \"pedido\": {{\"cpu_address\": {}, \"cpu_address_hex\": {:?}, \"length\": {}}},\n",
                caso.cpu,
                format!("{:#x}", caso.cpu),
                caso.length
            ));
            out.push_str(&format!(
                "      \"limites\": {{\"max_bytes\": {}, \"max_segments\": {}}},\n",
                caso.max_bytes, caso.max_segments
            ));
            out.push_str(&format!(
                "      \"esperado\": {}\n",
                esperado_json(caso, &rom)
            ));
        }
        out.push_str("    }");
        if i + 1 < lista.len() {
            out.push(',');
        }
        out.push('\n');
    }
    out.push_str("  ]\n}\n");
    out
}

fn pasos_json(caso: &Caso) -> String {
    let partes: Vec<String> = caso
        .pasos
        .iter()
        .map(|p| match *p {
            Step::WriteRegister { cpu_address, data } => format!(
                "{{\"escribir\": {{\"cpu_address\": {cpu_address}, \"cpu_address_hex\": {:?}, \"data\": {data}}}}}",
                format!("{cpu_address:#x}")
            ),
            Step::Read { cpu_address, length } => format!(
                "{{\"ler\": {{\"cpu_address\": {cpu_address}, \"cpu_address_hex\": {:?}, \"length\": {length}}}}}",
                format!("{cpu_address:#x}")
            ),
        })
        .collect();
    format!("[{}]", partes.join(", "))
}

// --------------------------------------------------------------- tests

/// O ficheiro publicado non se puido editar a mans: a súa SHA é a pinada.
#[test]
fn o_ficheiro_publicado_ten_a_sha_pinada() {
    let got = sha256_hex(FICHEIRO.as_bytes());
    assert_eq!(
        got, FICHEIRO_SHA256,
        "vectors/acceptance-v1.json cambiou respecto do pinado; rexenerar con \
         REX_ACEITE_ESCRIBIR=1 e actualizar FICHEIRO_SHA256"
    );
}

/// E non só iso: o contido reproduce byte a byte o que derivan as funcións de
/// arriba. Se este test falla, o JSON e o oráculo levaron camiños distintos.
#[test]
fn o_xerador_reproduce_o_ficheiro_publicado() {
    let esperado = xerar();
    assert_eq!(
        FICHEIRO,
        esperado,
        "o ficheiro publicado non é o que produce o oráculo (primeiras \
         diferenzas abaixo):\n{}",
        primeiras_diferenzas(FICHEIRO, &esperado)
    );
}

/// Cada caso do JSON grádase contra a API pública, sen tocar funcións
/// internas: é o que o adaptador vai poder facer pola súa banda.
#[test]
fn todos_os_vectores_de_aceite_gradan_pola_api_publica() {
    let doc = Json::parse(FICHEIRO).expect("o ficheiro de aceite non é JSON válido");
    let publicados = doc.get("casos").and_then(Json::arr).expect("casos");
    let lista = casos();
    assert_eq!(
        publicados.len(),
        lista.len(),
        "o JSON e o xerador non teñen o mesmo número de casos"
    );
    for (xerado, publicado) in lista.iter().zip(publicados) {
        let id = publicado
            .get("id")
            .and_then(Json::as_str)
            .unwrap_or("<sen id>");
        assert_eq!(id, xerado.id, "a orde dos casos cambiou");
        graduar(xerado, publicado);
    }
}

fn graduar(caso: &Caso, publicado: &Json) {
    let rom = imaxe_de(caso);
    let estado = estado_de(caso);
    let imaxe = atestacion_de(caso, &rom);
    let esperado = publicado.get("esperado").expect("esperado");
    match caso.oper {
        Oper::Recurso => {
            let req = ResourceRequest {
                profile: caso.perfil,
                image: imaxe,
                state: &estado,
                cpu_address: caso.cpu,
                length: caso.length,
                limits: limites_de(caso),
            };
            match read_resource(&req, &rom) {
                Ok(got) => {
                    assert_eq!(
                        esperado.get("ok").and_then(Json::as_bool),
                        Some(true),
                        "{}: o aceite esperaba recusa",
                        caso.id
                    );
                    verificar_lectura(caso.id, &got, esperado, &rom);
                }
                Err(err) => {
                    assert_eq!(
                        esperado.get("ok").and_then(Json::as_bool),
                        Some(false),
                        "{}: o aceite esperaba éxito pero recúsase ({err})",
                        caso.id
                    );
                    verificar_recusa(caso, &err, esperado);
                }
            }
        }
        Oper::Secuencia => {
            let pasos = pasos_de(publicado);
            let req = SequenceRequest {
                profile: caso.perfil,
                image: imaxe,
                initial_state: &estado,
                limits: limites_de(caso),
                steps: &pasos,
            };
            let estado_antes = estado.clone();
            let got = match read_sequence(&req, &rom) {
                Ok(got) => got,
                Err(err) => panic!(
                    "{}: a secuencia recúsase ({}) cando o aceite esperaba éxito",
                    caso.id, err.detail
                ),
            };
            verificar_secuencia(caso, &got, esperado, &rom, &estado_antes);
        }
    }
}

/// Le os pasos do JSON (non do `caso`): o adaptador consume o ficheiro, así
/// que aquí tamén se grada que o que alí está escrito é executábel.
fn pasos_de(publicado: &Json) -> Vec<Step> {
    publicado
        .get("pasos")
        .and_then(Json::arr)
        .map(|arr| {
            arr.iter()
                .filter_map(|paso| {
                    if let Some(w) = paso.get("escribir") {
                        Some(Step::WriteRegister {
                            cpu_address: u32_de(w, "cpu_address"),
                            data: w.get("data").and_then(Json::as_u64)? as u8,
                        })
                    } else {
                        let r = paso.get("ler")?;
                        Some(Step::Read {
                            cpu_address: u32_de(r, "cpu_address"),
                            length: u32_de(r, "length"),
                        })
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

fn u32_de(obj: &Json, clave: &str) -> u32 {
    obj.get(clave)
        .and_then(Json::as_u64)
        .and_then(|n| u32::try_from(n).ok())
        .unwrap_or_else(|| panic!("campo {clave} ausente ou fóra de u32"))
}

fn verificar_lectura(id: &str, got: &ResourceRead, esperado: &Json, rom: &[u8]) {
    assert_eq!(
        esperado.get("perfil").and_then(Json::as_str),
        Some(got.profile),
        "{id}: perfil na saída"
    );
    assert_eq!(
        u32_de(esperado, "cpu_address"),
        got.cpu_address,
        "{id}: cpu_address na saída"
    );
    assert_eq!(
        u32_de(esperado, "length"),
        got.length,
        "{id}: length na saída"
    );
    assert_eq!(
        got.bytes.len() as u32,
        got.length,
        "{id}: bytes.len() != length (CONTRATO.md §12.2 inv. 1)"
    );
    let ata = esperado.get("ataestacion").expect("ataestacion");
    assert_eq!(
        got.image.origin,
        ata.get("origin").and_then(Json::as_str).expect("origin"),
        "{id}: a saída devolve a atestación recibida"
    );
    assert_eq!(
        got.image.sha256_hex,
        ata.get("sha256_hex")
            .and_then(Json::as_str)
            .expect("sha256_hex"),
        "{id}: a saída devolve o digesto recibido"
    );
    assert_eq!(got.image.byte_len, rom.len() as u64, "{id}: byte_len");
    assert_eq!(
        got.contract_version, CONTRACT_VERSION,
        "{id}: versión do contrato"
    );
    let estado_pub = esperado.get("estado").expect("estado");
    let segmentos = esperado
        .get("segmentos")
        .and_then(Json::arr)
        .expect("segmentos");
    assert_eq!(
        got.segments.len(),
        segmentos.len(),
        "{id}: nº de corredores"
    );
    for (i, publicado) in segmentos.iter().enumerate() {
        let s = &got.segments[i];
        assert_eq!(s.index, i as u32, "{id}: índice {i}");
        assert_eq!(
            u32_de(publicado, "cpu_address"),
            s.cpu_address,
            "{id}: cpu_address {i}"
        );
        assert_eq!(u32_de(publicado, "cpu_len"), s.cpu_len, "{id}: cpu_len {i}");
        assert_eq!(
            u32_de(publicado, "rom_offset"),
            s.rom_offset,
            "{id}: rom_offset {i}"
        );
        assert_eq!(
            publicado.get("rexion").and_then(Json::as_str),
            Some(s.region.as_str()),
            "{id}: rexión {i}"
        );
        // Continuidade lóxica: o corredor seguinte comeza onde acabou este.
        if i > 0 {
            let anterior = &got.segments[i - 1];
            assert_eq!(
                anterior.cpu_address + anterior.cpu_len,
                s.cpu_address,
                "{id}: o bus non é continuo entre {} e {}",
                i - 1,
                i
            );
        }
        // E a procedencia di a verdade sobre os bytes devoltos: cada corredor
        // ten que ser exactamente o cacho do seu desprazamento físico.
        let base: usize = got.segments[..i].iter().map(|x| x.cpu_len as usize).sum();
        let corredor = banked::expect(s.rom_offset as usize, s.cpu_len as usize);
        assert_eq!(
            &got.bytes[base..base + s.cpu_len as usize],
            corredor.as_slice(),
            "{id}: os bytes non son os que declara rom_offset {i}"
        );
        assert_eq!(
            &rom[s.rom_offset as usize..s.rom_offset as usize + s.cpu_len as usize],
            corredor.as_slice(),
            "{id}: rom_offset {i} non apunta aos bytes da imaxe"
        );
        // Cada corredor leva o estado vixente, non unha referencia compartida.
        verificar_estado(&s.state, estado_pub, id);
    }
    assert_eq!(
        sha256_hex(&got.bytes),
        esperado
            .get("bytes_sha256")
            .and_then(Json::as_str)
            .unwrap_or("<ausente>"),
        "{id}: SHA dos bytes"
    );
    if let Some(hex_publicado) = esperado.get("bytes_hex").and_then(Json::as_str) {
        assert_eq!(hex(&got.bytes), hex_publicado, "{id}: contido dos bytes");
    }
    assert_eq!(
        u32_de(esperado, "bytes_len"),
        got.bytes.len() as u32,
        "{id}: bytes_len"
    );
    verificar_estado(&got.state, estado_pub, id);
}

/// Compara un `MapperState` contra o obxecto `estado` do JSON, clave a clave e
/// **nos dous sentidos**: un estado que engada ou perda claves tamén falla.
fn verificar_estado(estado: &MapperState, publicado: &Json, id: &str) {
    assert_eq!(
        estado.get("rom_size").and_then(Value::as_uint),
        publicado.get("rom_size").and_then(Json::as_u64),
        "{id}: rom_size no estado devolto"
    );
    let publicado_bancos = publicado.get("banks").and_then(Json::obj);
    let estado_bancos = estado.object("banks");
    match (publicado_bancos, estado_bancos) {
        (None, atopados) => assert!(
            atopados.is_none_or(|b| b.is_empty()),
            "{id}: o estado devolve bancos que o aceite non declara"
        ),
        (Some(publi), atopados) => {
            let lista = atopados.unwrap_or(&[]);
            assert_eq!(lista.len(), publi.len(), "{id}: nº de bancos");
            for (k, v) in publi {
                let valor = lista
                    .iter()
                    .find(|(kk, _)| kk == k)
                    .map(|(_, vv)| vv.as_uint());
                assert_eq!(valor, Some(v.as_u64()), "{id}: banco {k} do estado devolto");
            }
            for (k, _) in lista {
                assert!(
                    publi.iter().any(|(kk, _)| kk == k),
                    "{id}: banco {k} extra no estado devolto"
                );
            }
        }
    }
}

fn verificar_recusa(caso: &Caso, err: &ResourceError, esperado: &Json) {
    let codigo = esperado
        .get("codigo")
        .and_then(Json::as_str)
        .expect("codigo");
    assert_eq!(
        err.code.as_str(),
        codigo,
        "{}: código de recusa (detalle: {})",
        caso.id,
        err.detail
    );
    match esperado.get("detido_en") {
        Some(v) if !matches!(v, Json::Null) => {
            assert_eq!(
                err.address,
                Some(u32_de(v, "dec")),
                "{}: enderezo da recusa",
                caso.id
            );
        }
        _ => assert_eq!(err.address, None, "{}: non debía haber enderezo", caso.id),
    }
    match esperado.get("rexion").and_then(Json::as_str) {
        Some(rexion) => {
            assert_eq!(
                err.region.map(|r| r.as_str().to_string()),
                Some(rexion.to_string()),
                "{}: rexión da recusa",
                caso.id
            );
            assert_eq!(
                err.code,
                ResourceErrorCode::NonRomRegion,
                "{}: só non-rom-region nomea rexión",
                caso.id
            );
        }
        None => assert_eq!(err.region, None, "{}: rexión debe ser None", caso.id),
    }
    let levados = esperado
        .get("segmentos_na_recusa")
        .and_then(Json::arr)
        .expect("segmentos_na_recusa");
    assert_eq!(
        err.segments.len(),
        levados.len(),
        "{}: procedencia levada na recusa",
        caso.id
    );
    for (i, publicado) in levados.iter().enumerate() {
        let s = &err.segments[i];
        assert_eq!(s.index, i as u32, "{}: índice renumerado {i}", caso.id);
        assert_eq!(
            u32_de(publicado, "cpu_address"),
            s.cpu_address,
            "{}: cpu_address {i}",
            caso.id
        );
        assert_eq!(
            u32_de(publicado, "cpu_len"),
            s.cpu_len,
            "{}: cpu_len {i}",
            caso.id
        );
        assert_eq!(
            u32_de(publicado, "rom_offset"),
            s.rom_offset,
            "{}: rom_offset {i}",
            caso.id
        );
    }
    // Toda recusa di que non houbo éxito parcial: os corredores levados xamais
    // cubren o pedido completo, e se non hai corredores non hai nada.
    let cubertos: u64 = err.segments.iter().map(|s| u64::from(s.cpu_len)).sum();
    if err.segments.is_empty() {
        assert_eq!(cubertos, 0, "{}: procedencia baleira", caso.id);
    } else {
        assert!(
            cubertos < u64::from(caso.length),
            "{}: unha recusa non pode cubrir o pedido completo ({cubertos}/{})",
            caso.id,
            caso.length
        );
    }
    if let Some(menciona) = esperado.get("detalle_menciona").and_then(Json::as_str) {
        assert!(
            err.detail.contains(menciona),
            "{}: o detalle ten que citar {menciona:?}: {}",
            caso.id,
            err.detail
        );
    }
}

fn verificar_secuencia(
    caso: &Caso,
    got: &SequenceRead,
    esperado: &Json,
    rom: &[u8],
    estado_antes: &MapperState,
) {
    let lecturas = esperado
        .get("lecturas")
        .and_then(Json::arr)
        .expect("lecturas");
    assert_eq!(
        got.reads.len(),
        lecturas.len(),
        "{}: número de lecturas da secuencia",
        caso.id
    );
    for (i, (publicado, lectura)) in lecturas.iter().zip(got.reads.iter()).enumerate() {
        assert_eq!(
            publicado.get("ok").and_then(Json::as_bool),
            Some(true),
            "{}: lectura {i} do aceite",
            caso.id
        );
        verificar_lectura(&format!("{}#{i}", caso.id), lectura, publicado, rom);
    }
    assert_eq!(
        got.writes_applied,
        u32_de(esperado, "escritas_aplicadas"),
        "{}: escritas aplicadas",
        caso.id
    );
    verificar_estado(
        &got.final_state,
        esperado.get("estado_final").expect("estado_final"),
        &format!("{} (final)", caso.id),
    );
    // O estado con que chegou a chamada non se muta: é o que permite ao
    // adaptador reutilizar a súa propia instantánea despois dunha secuencia.
    assert_eq!(
        &estado_de(caso),
        estado_antes,
        "{}: read_sequence mutou o estado da chamante",
        caso.id
    );
    assert_ne!(
        got.final_state, *estado_antes,
        "{}: unha secuencia cunha escrita ten que devolver un estado novo",
        caso.id
    );
}

// ------------------------------------------- probas de capacidade do aceite

/// A razón de ser do caso A3: dous enderezos, mesma posición física. Comprobado
/// entre casos, non só contra o JSON.
#[test]
fn os_alias_dous_enderezos_devolven_os_mesmos_bytes() {
    let lista = casos();
    let simple = lista.iter().find(|c| c.id.starts_with("A1-")).expect("A1");
    let alias = lista.iter().find(|c| c.id.starts_with("A3-")).expect("A3");
    let a = le_recurso(simple, &imaxe_de(simple));
    let b = le_recurso(alias, &imaxe_de(alias));
    assert_eq!(a.bytes, b.bytes, "o alias non devolve os mesmos bytes");
    assert_eq!(
        a.segments
            .iter()
            .map(|s| (s.rom_offset, s.cpu_len))
            .collect::<Vec<_>>(),
        b.segments
            .iter()
            .map(|s| (s.rom_offset, s.cpu_len))
            .collect::<Vec<_>>(),
        "o alias non declara o mesmo desprazamento físico"
    );
    assert_ne!(
        a.cpu_address, b.cpu_address,
        "A3 ten que ser outro enderezo"
    );
    assert_eq!(
        b.segments[0].cpu_address, alias.cpu,
        "a procedencia ten que dicir o enderezo pedido, non o canónico"
    );
}

/// A10 no claro: **esta capa non hashexa**. Se alguén lle engade un hash
/// interno, este test falla e o contrato ten que reescribirse; se alguén espera
/// que a capa detecte unha imaxe trocada, este test di que non é así.
#[test]
fn a_capa_non_pode_verificar_o_digesto() {
    let lista = casos();
    let caso = lista
        .iter()
        .find(|c| c.id.starts_with("A10-"))
        .expect("A10");
    let rom = imaxe_de(caso);
    let honesto = sha256_hex(&rom);
    let minteiro = atestacion_de(caso, &rom);
    assert_ne!(
        honesto, minteiro.sha256_hex,
        "o caso ten que levar un digesto que non é o da imaxe"
    );
    assert_eq!(
        minteiro.sha256_hex.len(),
        64,
        "e aínda así ten que ter a forma dun SHA-256"
    );
    let req = ResourceRequest {
        profile: caso.perfil,
        image: minteiro.clone(),
        state: &estado_de(caso),
        cpu_address: caso.cpu,
        length: caso.length,
        limits: limites_de(caso),
    };
    let got = read_resource(&req, &rom).expect("un digesto falso non é detectable sen hash");
    assert_eq!(
        got.image, minteiro,
        "a saída debe devolver a atestación recibida"
    );
    // E o que si se rexeita: a forma. Que isto falla si sería un falso positivo
    // na proba anterior.
    let mut malos: Vec<String> = vec![String::new()];
    malos.push("0".repeat(63));
    malos.push("A".repeat(64));
    malos.push("g".repeat(64));
    for malo in &malos {
        let req = ResourceRequest {
            image: ImageIdentity {
                sha256_hex: malo.clone(),
                ..minteiro.clone()
            },
            ..req.clone()
        };
        let err = read_resource(&req, &rom)
            .expect_err(&format!("digesto {malo:?} mal formado si debe recusarse"));
        assert_eq!(err.code, ResourceErrorCode::BadAttestation, "{malo:?}");
        assert!(
            err.segments.is_empty(),
            "{malo:?}: BadAttestation non percorre"
        );
    }
}

/// Dúas instancias de mapper: ler cun estado non pode cambiar o outro. Fai
/// explícito o que `read_sequence` garante por pureza.
#[test]
fn as_dúas_instancias_non_comparten_estado() {
    let lista = casos();
    let con_banco = lista.iter().find(|c| c.id.starts_with("A7a")).expect("A7a");
    let sen_banco = lista.iter().find(|c| c.id.starts_with("A7b")).expect("A7b");
    let rom = imaxe_de(con_banco);
    let estado_a = estado_de(con_banco);
    let estado_b = estado_de(sen_banco);

    let a = le_recurso(con_banco, &rom);
    let b = le_recurso(sen_banco, &rom);
    // Primeira a, despois b: b non ve o banco de a.
    let b2 = le_recurso(sen_banco, &rom);
    assert_eq!(
        b.segments[0].rom_offset, b2.segments[0].rom_offset,
        "ler dúas veces co mesmo estado deu bancos distintos"
    );
    assert_eq!(
        b.bytes, b2.bytes,
        "ler dúas veces co mesmo estado deu bytes distintos"
    );
    assert_ne!(
        a.segments[0].rom_offset, b.segments[0].rom_offset,
        "as dúas instancias leron o mesmo banco: non hai independencia"
    );
    // O esperado, derivado sen o produto: `5 << 19 = 0x280000` nunha imaxe de
    // 4 MB (a máscara non recorta) e identidade `1 << 19 = 0x80000` sen bancos.
    assert_eq!(
        a.segments[0].rom_offset, 0x0028_0000,
        "A7a non le o banco 5"
    );
    assert_eq!(
        b.segments[0].rom_offset, 0x0008_0000,
        "A7b non le a identidade"
    );
    assert_eq!(estado_a.keys().count(), 2, "o estado A é inmutable");
    assert_eq!(a.state, estado_a, "a saída de A mutou o estado");
    assert_eq!(b.state, estado_b, "a saída de B mutou o estado");
    // Cada corredor leva a súa copia, non unha referencia compartida.
    assert_eq!(a.segments[0].state, estado_a);
    assert_eq!(b.segments[0].state, estado_b);
}

/// Que o aceite tamén gradúa a **rexión** que a recusa nomea, non só o código:
/// é o campo que a UI necesita para explicar por que non leu.
#[test]
fn a_recusa_non_rom_nomea_a_rexion_y_non_inventa_bytes() {
    let lista = casos();
    let caso = lista.iter().find(|c| c.id.starts_with("A4-")).expect("A4");
    let rom = imaxe_de(caso);
    let err = recusa_de(caso, &rom);
    assert_eq!(err.code, ResourceErrorCode::NonRomRegion);
    assert_eq!(err.region, Some(Region::WramMirror), "rexión nomeada");
    assert_eq!(err.segments.len(), 1, "levaba un corredor de ROM");
    assert_eq!(err.segments[0].cpu_len, 0x10, "16 bytes antes de deterse");
    assert_eq!(err.address, Some(caso.cpu + 0x10), "detido no byte non-ROM");
    assert_eq!(
        err.segments[0].rom_offset, 0x7FF0,
        "desprazamento do prefixo"
    );
    assert!(
        err.detail.contains("wram-mirror"),
        "o detalle ten que citar a rexión: {}",
        err.detail
    );
    // E a procedencia da recusa é real: os bytes que declara existen na imaxe.
    for s in &err.segments {
        let fin = s.rom_offset as usize + s.cpu_len as usize;
        assert!(fin <= rom.len(), "procedencia fóra da imaxe");
        assert_eq!(
            banked::expect(s.rom_offset as usize, s.cpu_len as usize),
            rom[s.rom_offset as usize..fin].to_vec(),
            "a recusa non pode levar bytes inventados"
        );
    }
}

/// Un control negativo do propio aceite: se o oráculo e o produto discordasen
/// nun vector, este test ten que ser o que o diga. Comprébao con valores
/// alterados a man, non cun `assert!(true)`.
#[test]
fn un_vector_alterado_detectase() {
    let lista = casos();
    let caso = lista.iter().find(|c| c.id.starts_with("A1-")).expect("A1");
    let rom = imaxe_de(caso);
    let got = le_recurso(caso, &rom);
    // O oráculo di 0x10000: un valor distinto ten que ser visible.
    assert_ne!(got.segments[0].rom_offset, 0x1_0001);
    assert_eq!(got.segments[0].rom_offset, 0x1_0000);
    assert_eq!(got.bytes, banked::expect(0x1_0000, 0x20));
    // …e se a procedencia mentise, a batería tamén o ve.
    assert_ne!(
        got.bytes,
        banked::expect(0x1_0001, 0x20),
        "a fixture non discrimina un byte de desprazamento"
    );
    // E un corte de xanela que desaparecese tamén: A2 ten dous corredores, non
    // un de 32 bytes.
    let lista = casos();
    let a2 = lista.iter().find(|c| c.id.starts_with("A2-")).expect("A2");
    let rom2 = imaxe_de(a2);
    let cruzado = le_recurso(a2, &rom2);
    assert_eq!(
        cruzado.segments.len(),
        2,
        "a fronteira de xanela deixou de cortar"
    );
    assert_eq!(cruzado.bytes, banked::expect(0x7_FFF0, 0x20));
}

/// Non-degeneración do xerador: teñen que haber casos con éxito e casos de
/// recusa, e as recusas teñen que repartirse pola táboa de §12.3. Un xerador
/// que só producise un tipo non gradúa nada.
#[test]
fn a_bateria_non_e_degenerada() {
    let (mut ok, mut err) = (0usize, 0usize);
    for caso in casos_de_lectura().iter() {
        match derivar(&lectura_do_caso(caso)) {
            Derivado::Ok { .. } => ok += 1,
            Derivado::Err { .. } => err += 1,
        }
    }
    assert!(
        ok >= 6,
        "só {ok} casos con éxito; o aceite non cubre a lectura"
    );
    assert!(err >= 6, "só {err} recusas; o aceite non cubre a política");
    assert_eq!(
        casos().len(),
        15,
        "o número de casos cambiou: actualízano tamén os docs e o reconto"
    );
    let mut codigos: Vec<&str> = casos_de_lectura()
        .iter()
        .filter_map(|c| match derivar(&lectura_do_caso(c)) {
            Derivado::Err(f) => Some(f.codigo),
            Derivado::Ok { .. } => None,
        })
        .collect();
    codigos.sort();
    assert_eq!(
        codigos,
        vec![
            "bad-state",
            "incompatible-size",
            "invalid-range",
            "invalid-range",
            "limit-exceeded",
            "limit-exceeded",
            "non-rom-region",
        ],
        "a cobertura da táboa de códigos de §12.3 cambiou"
    );
    // E ningún caso de éxito é baleiro: todos teñen cando menos un corredor.
    for caso in casos_de_lectura().iter() {
        if let Derivado::Ok { segmentos, bytes } = derivar(&lectura_do_caso(caso)) {
            assert!(
                !segmentos.is_empty(),
                "{}: lectura sen procedencia",
                caso.id
            );
            assert_eq!(
                bytes.len(),
                caso.length as usize,
                "{}: o oráculo non cubre o pedido",
                caso.id
            );
        }
    }
}

/// O aceite ten que describir a imaxe que hai que construir, non deixala
/// implícita: a fórmula vai publicada e o seu SHA-256 reprodúcese aquí.
#[test]
fn a_regra_da_imaxe_publicada_reproduse() {
    let doc = Json::parse(FICHEIRO).expect("json válido");
    let regra = doc.get("regra_imaxe").expect("regra_imaxe");
    assert_eq!(
        regra.get("id").and_then(Json::as_str),
        Some("banked-byte-at-v1"),
        "id da regra de imaxe"
    );
    // A fórmula publicada, aplicada a man sobre 4 KB, ten que dar o mesmo que
    // `banked::byte_at`: o adaptador pode reconstruír a imaxe sen a crate.
    let bytes: Vec<u8> = (0..4096u64)
        .map(|i| (i * 37 + (i >> 8) * 91 + (i >> 16) * 47) as u8)
        .collect();
    assert_eq!(
        bytes,
        banked::image(4096),
        "a fórmula publicada diverxe da fixture"
    );
}

// --------------------------------------------------------- rexeneración

/// Escribe `vectors/acceptance-v1.json` desde o oráculo. Ignorado no gate
/// ordinario: a escritura ten que ser un acto explícito.
#[test]
#[ignore]
fn regenerar_o_ficheiro_de_aceite() {
    if std::env::var("REX_ACEITE_ESCRIBIR").is_err() {
        panic!(
            "rexenerar é explícito: REX_ACEITE_ESCRIBIR=1 cargo test --offline \
             --test acceptance -- --ignored"
        );
    }
    let contido = xerar();
    let ruta = concat!(env!("CARGO_MANIFEST_DIR"), "/vectors/acceptance-v1.json");
    std::fs::write(ruta, &contido).expect("escribir o ficheiro de aceite");
    println!("escrito {ruta}");
    println!("sha256={}", sha256_hex(contido.as_bytes()));
    println!("actualiza FICHEIRO_SHA256 con ese valor");
}

// ------------------------------------------------------------ utilidades

fn primeiras_diferenzas(a: &str, b: &str) -> String {
    let mut out = String::new();
    for (i, (la, lb)) in a.lines().zip(b.lines()).enumerate() {
        if la != lb {
            out.push_str(&format!(
                "liña {}\n  publicado: {la}\n  xerado:    {lb}\n",
                i + 1
            ));
            if out.lines().count() > 12 {
                break;
            }
        }
    }
    if out.is_empty() {
        out.push_str("(mesmas liñas; difire o número de liñas)\n");
    }
    out
}
