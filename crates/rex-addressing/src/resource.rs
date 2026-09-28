//! Capa de lectura de recursos: **que bytes** corresponde a un recurso, **por
//! onde** pasaron e **onde se recusou**.
//!
//! Non é un descubridor de mapas nin un identificador de recursos: quen chama
//! elixe o perfil, entrega o estado do mapper e di canto quer ler. Esta capa
//! só engade sobre os cinco perfis tres cousas que un perfil por si mesmo non
//! pode dar:
//!
//! 1. **Procedencia** ([`PhysicalSegment`]): cada corredor lido leva o seu
//!    enderezo lóxico, o seu offset físico, o seu tamaño e o **estado** vixente
//!    nese instante. `read()` do perfil dá offsets; a secuencia lóxica
//!    reconstrúese aquí por sumas parciais, o cal é exacto **só** cando a
//!    lectura consumiu `length` bytes enteiros — que é precisamente a condición
//!    que esta capa exige.
//! 2. **Recusa do parcial**: unha lectura que non cubre `length` byte a byte
//!    non é un éxito. Non se clampa, non se enche con bytes inventados e non se
//!    emenda a continuidade entre xanelas.
//! 3. **Fronteiras decididas antes de reservar**: tope de bytes e de segmentos,
//!    e a fronteira do barramento de 24 bits nun **só** canal de erro para os
//!    cinco perfis (a diverxencia entre familias, documentada en
//!    `CLASSIFICACION.md` §8, non se herda aquí).
//!
//! ## Que **non** fai
//!
//! - Non abre ficheiros nin coñece rutas: a imaxe entrase como `&[u8]`.
//! - Non compute o SHA-256 da imaxe. A identidade ([`ImageIdentity`]) é unha
//!   **atestación da frontada**: o núcleo valida a forma (orixe non baleiro, 64
//!   díxitos hex minúsculos, `byte_len` igual ao buffer entregado) e devolvena
//!   na saída. Comparar o digest contra o contido real é traballo do chamador,
//!   que é quen ten o arquivo; facelo en cada lectura pagaría un hash por cada
//!   recurso observado. Píñano os tests
//!   `a_verificacion_de_contido_e_perna_do_adaptador_non_do_nucleo`.
//! - Non adiviña bancos: a lectura que atravesa varias xanelas SSF2 usa **o
//!   estado fixo** que se lle entrega. Unha secuencia de cambios de banco é a
//!   operación distinta [`read_sequence`], e só existe nos perfis con
//!   rexistradores.
//!
//! ```
//! use rex_addressing::resource::{read_resource, ImageIdentity, Limits, Profile, ResourceRequest};
//! use rex_addressing::MapperState;
//!
//! let rom = vec![0xC4u8; 0x8_0000];
//! let image = ImageIdentity {
//!     origin: "fixture:demo".to_string(),
//!     // Digest real o adaptador; o núcleo comprobaba só a forma.
//!     sha256_hex: "0".repeat(64),
//!     byte_len: rom.len() as u64,
//! };
//! let state = MapperState::rom_size(0x8_0000);
//! let req = ResourceRequest {
//!     profile: Profile::MdLinear,
//!     image: image.clone(),
//!     state: &state,
//!     cpu_address: 0x00_1234,
//!     length: 8,
//!     limits: Limits::DEFAULT,
//! };
//! let got = read_resource(&req, &rom).expect("lectura dentro da xanela");
//! assert_eq!(got.bytes, vec![0xC4; 8]);
//! assert_eq!(got.segments.len(), 1);
//! assert_eq!(got.segments[0].rom_offset, 0x00_1234);
//! assert_eq!(got.image, image, "a identidade viaxa na saída");
//! ```

use std::fmt;

use crate::error::{AddressingError, ErrorCode};
use crate::{md_linear, md_ssf2, snes_exhirom, snes_hirom, snes_lorom};
use crate::{MapperState, Region, Segment};

/// Versión do contrato desta capa. Un consumidor debe rexeitar saída dunha
/// versión distinta antes de interpretar un só campo.
pub const CONTRACT_VERSION: u32 = 1;

/// Barramento de 24 bits, común aos cinco perfis (68000 e 65816).
pub const BUS_LIMIT: u32 = 0xff_ff_ff;

/// Os cinco perfis que esta capa sabe percorrer. Non hai "auto": escoller o
/// perfil é sempre decisión da chamante.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Profile {
    MdLinear,
    MdSsf2,
    SnesLorom,
    SnesHirom,
    SnesExhirom,
}

impl Profile {
    pub fn id(self) -> &'static str {
        match self {
            Profile::MdLinear => md_linear::PROFILE_ID,
            Profile::MdSsf2 => md_ssf2::PROFILE_ID,
            Profile::SnesLorom => snes_lorom::PROFILE_ID,
            Profile::SnesHirom => snes_hirom::PROFILE_ID,
            Profile::SnesExhirom => snes_exhirom::PROFILE_ID,
        }
    }

    pub fn all() -> [Profile; 5] {
        [
            Profile::MdLinear,
            Profile::MdSsf2,
            Profile::SnesLorom,
            Profile::SnesHirom,
            Profile::SnesExhirom,
        ]
    }

    /// Só `md-ssf2` ten rexistradores de mapper neste conxunto; os SNES son
    /// cartuchos fixos e `md-linear` non ten estado de banco ningún.
    pub fn has_mapper_registers(self) -> bool {
        matches!(self, Profile::MdSsf2)
    }

    fn validate_state(self, state: &MapperState) -> Result<(), AddressingError> {
        match self {
            Profile::MdLinear => md_linear::validate_state(state),
            Profile::MdSsf2 => md_ssf2::validate_state(state),
            Profile::SnesLorom => snes_lorom::validate_state(state),
            Profile::SnesHirom => snes_hirom::validate_state(state),
            Profile::SnesExhirom => snes_exhirom::validate_state(state),
        }
    }

    fn read(
        self,
        cpu_address: u32,
        length: u32,
        state: &MapperState,
        rom: &[u8],
    ) -> Result<Vec<Segment>, AddressingError> {
        match self {
            Profile::MdLinear => md_linear::read(cpu_address, length, state, rom),
            Profile::MdSsf2 => md_ssf2::read(cpu_address, length, state, rom),
            Profile::SnesLorom => snes_lorom::read(cpu_address, length, state, rom),
            Profile::SnesHirom => snes_hirom::read(cpu_address, length, state, rom),
            Profile::SnesExhirom => snes_exhirom::read(cpu_address, length, state, rom),
        }
    }

    fn write_register(
        self,
        cpu_address: u32,
        data: u8,
        state: &MapperState,
    ) -> Result<MapperState, AddressingError> {
        match self {
            Profile::MdSsf2 => md_ssf2::write_mapper_register(cpu_address, data, state),
            other => Err(AddressingError::new(
                ErrorCode::Unsupported,
                format!("o perfil {} non ten rexistradores de mapper", other.id()),
            )),
        }
    }
}

/// Identidade da imaxe que se lle entrega ao núcleo, **atestada pola frontada**.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ImageIdentity {
    /// Orixe inmutable do arquivo (ruta canónica, identificador de corpus,
    /// `fixture:<nome>`). Nunca baleiro: sen orixe non hai evidencia.
    pub origin: String,
    /// SHA-256 en minúsculas, 64 díxitos. Computado por quen chama.
    pub sha256_hex: String,
    /// Bytes da imaxe. Debe coincidir co `rom` entregado en cada chamada.
    pub byte_len: u64,
}

/// Topes da operación. Comprobanse **antes** de reservar nada proporcional a
/// `length`, así que un `length` absurdo non é un ataque de memoria.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Limits {
    pub max_bytes: u32,
    pub max_segments: u32,
}

impl Limits {
    /// 16 MB de bytes e 4096 corredores: holgado para calquera recurso de 16
    /// bits, estreito o bastante para que un `length` enloquecido non chegue a
    /// reservar.
    pub const DEFAULT: Limits = Limits {
        max_bytes: 0x100_0000,
        max_segments: 4096,
    };
}

/// Un corredor continuo de offset físico, co seu enderezo lóxico e o estado
/// baixo o cal se leu.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PhysicalSegment {
    /// Posición na lista de segmentos (0, 1, 2…): a orde é parte da evidencia.
    pub index: u32,
    /// Primeiro enderezo do barramento que cubre este corredor.
    pub cpu_address: u32,
    /// Bytes que aporta á saída. `cpu_address + cpu_len` é o comezo do seguinte.
    pub cpu_len: u32,
    /// Desprazamento dentro da imaxe. **Non** é o enderezo do bus: son dous
    /// conceptos distintos e os perfis aliás/espello separenos.
    pub rom_offset: u32,
    /// Sempre `Rom` nunha lectura exitosa.
    pub region: Region,
    /// Estado do mapper con que se traduciu este corredor. Nunha secuencia,
    /// cada segmento leva o seu: así se ve o banco que estaba posto.
    pub state: MapperState,
}

/// Resultado dunha lectura integral.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResourceRead {
    pub profile: &'static str,
    pub contract_version: u32,
    /// A identidade que entrou, tal cal: para que a saída sexa autoexplicativa.
    pub image: ImageIdentity,
    /// Estado con que se fixo a lectura: copia propia, non unha referencia ao
    /// pedido.
    pub state: MapperState,
    pub cpu_address: u32,
    pub length: u32,
    pub segments: Vec<PhysicalSegment>,
    /// `bytes.len() == length` sempre. Se non, isto é un `Err`, non un éxito.
    pub bytes: Vec<u8>,
}

/// Motivo de recusa. Un só canal por clase, independentemente do perfil.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ResourceErrorCode {
    /// A atestación da imaxe non é verificable (orixe baleiro, digest mal
    /// formado, tamaño declarado que non coincide co buffer).
    BadAttestation,
    /// O perfil rexeitou o estado do mapper (falta `rom_size`, tamaño fóra do
    /// seu intervalo, claves alleas nun perfil sen mapper, escrita fóra da
    /// páxina de rexistradores).
    BadState,
    /// `length < 1` ou `cpu_address + length - 1` fóra do barramento de 24
    /// bits. Recúsase antes de percorrer: `segments` está baleiro.
    InvalidRange,
    /// A imaxe entregada non cubre o que o estado declara (`rom_size` maior que
    /// o buffer) ou o percorrido non puido completar `length`.
    IncompatibleSize,
    /// Superaba [`Limits::max_bytes`] ou [`Limits::max_segments`].
    LimitExceeded,
    /// O percorrido caiu nunha rexión que non é ROM deste perfil. Non se
    /// inventan bytes: `region` di cal é, ou `None` se é área sen dispositivo.
    NonRomRegion,
    /// As fontes pinadas diverxen nese enderezo (metade baixa A15 en LoROM).
    /// O cartucho real decide; esta capa non palpita.
    Ambiguous,
}

impl ResourceErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            ResourceErrorCode::BadAttestation => "bad-attestation",
            ResourceErrorCode::BadState => "bad-state",
            ResourceErrorCode::InvalidRange => "invalid-range",
            ResourceErrorCode::IncompatibleSize => "incompatible-size",
            ResourceErrorCode::LimitExceeded => "limit-exceeded",
            ResourceErrorCode::NonRomRegion => "non-rom-region",
            ResourceErrorCode::Ambiguous => "ambiguous",
        }
    }
}

/// Erro estruturado da capa, coa procedencia percorrida ata o punto da recusa.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResourceError {
    pub code: ResourceErrorCode,
    pub detail: String,
    /// Enderezo do bus onde a operación se detivo, se é que se detivo en algún.
    pub address: Option<u32>,
    /// Rexión non-ROM que bloqueou o avance (`None` = área sen dispositivo).
    pub region: Option<Region>,
    /// Corredores leídos **antes** de recusar, renumerados desde 0. Vacía se a
    /// recusa foi unha comprobación previa: ese é o punto — nunca se devolve
    /// un parcial disfrazado de éxito.
    pub segments: Vec<PhysicalSegment>,
}

impl ResourceError {
    fn new(code: ResourceErrorCode, detail: impl Into<String>) -> Self {
        ResourceError {
            code,
            detail: detail.into(),
            address: None,
            region: None,
            segments: Vec::new(),
        }
    }

    fn walked(mut self, segments: Vec<PhysicalSegment>, address: u32) -> Self {
        self.address = Some(address);
        self.segments = segments;
        self
    }
}

impl fmt::Display for ResourceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code.as_str(), self.detail)?;
        if let Some(addr) = self.address {
            write!(f, " (en {addr:#x})")?;
        }
        if let Some(region) = self.region {
            write!(f, " rexión {}", region.as_str())?;
        }
        Ok(())
    }
}

impl std::error::Error for ResourceError {}

fn map_code(code: ErrorCode) -> ResourceErrorCode {
    match code {
        ErrorCode::OutOfRange => ResourceErrorCode::InvalidRange,
        ErrorCode::Unsupported => ResourceErrorCode::BadState,
        ErrorCode::Ambiguous => ResourceErrorCode::Ambiguous,
    }
}

fn from_addressing(err: AddressingError) -> ResourceError {
    ResourceError::new(map_code(err.code), err.detail)
}

/// Un paso de [`read_sequence`]: escribir un rexistrador ou ler un corredor.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Step {
    /// Escrita dun byte na páxina de rexistradores do perfil.
    WriteRegister { cpu_address: u32, data: u8 },
    /// Lectura co estado vixente nese punto da secuencia.
    Read { cpu_address: u32, length: u32 },
}

/// Pedido dunha lectura integral dun recurso.
#[derive(Clone, Debug)]
pub struct ResourceRequest<'a> {
    pub profile: Profile,
    pub image: ImageIdentity,
    /// Estado prestado: a capa non o muta nunca, e cada segmento sae coa súa
    /// copia. Dous pedidos co mesmo enderezo e estados distintos dan bytes
    /// distintos, que é xusto o que a capa existe para poder demostrar.
    pub state: &'a MapperState,
    pub cpu_address: u32,
    pub length: u32,
    pub limits: Limits,
}

/// Resultado dunha secuencia de bancos.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SequenceRead {
    /// Estado despois da última escrita aplicada.
    pub final_state: MapperState,
    /// Unha entrada por cada `Step::Read`, na orde pedida.
    pub reads: Vec<ResourceRead>,
    pub writes_applied: u32,
}

/// Pedido dunha secuencia: un estado inicial e unha serie de escritas de
/// rexistrador intercaladas con lecturas.
#[derive(Clone, Debug)]
pub struct SequenceRequest<'a> {
    pub profile: Profile,
    pub image: ImageIdentity,
    pub initial_state: &'a MapperState,
    pub limits: Limits,
    pub steps: &'a [Step],
}

/// Comprobacións da atestación que pode facer un núcleo sen hash de imaxes.
fn check_attestation(image: &ImageIdentity, rom: &[u8]) -> Result<(), ResourceError> {
    if image.origin.trim().is_empty() {
        return Err(ResourceError::new(
            ResourceErrorCode::BadAttestation,
            "image.origin baleiro: sen orixe inmutable non hai evidencia que citar",
        ));
    }
    let digest = image.sha256_hex.as_bytes();
    if digest.len() != 64
        || !digest
            .iter()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
    {
        return Err(ResourceError::new(
            ResourceErrorCode::BadAttestation,
            format!(
                "image.sha256_hex debe ser SHA-256 en 64 díxitos hex minúsculos (atopado {:?})",
                image.sha256_hex
            ),
        ));
    }
    if image.byte_len != rom.len() as u64 {
        return Err(ResourceError::new(
            ResourceErrorCode::IncompatibleSize,
            format!(
                "a atestación declara {} bytes e entregáronse {}",
                image.byte_len,
                rom.len()
            ),
        ));
    }
    Ok(())
}

/// Le `length` bytes de `cpu_address` devolvendoos coa súa procedencia física.
///
/// Faila con [`ResourceErrorCode::NonRomRegion`], [`ResourceErrorCode::Ambiguous`]
/// ou [`ResourceErrorCode::IncompatibleSize`] **antes** que calquera cousa, se o
/// percorrido non pode cubrir a lonxitude pedida; nunca devolve un prefixo como
/// éxito.
pub fn read_resource(req: &ResourceRequest<'_>, rom: &[u8]) -> Result<ResourceRead, ResourceError> {
    check_attestation(&req.image, rom)?;

    // Fronteira do barramento: un só canal para os cinco perfis. Os dous perfis
    // MD delegaban esa decisión no percorrido (CLASSIFICACION.md §8); aquí
    // resólvese antes de chamar a calquera perfil.
    if req.length < 1 {
        return Err(ResourceError::new(
            ResourceErrorCode::InvalidRange,
            "length debe ser >= 1: unha lectura de cero bytes non é un recurso",
        ));
    }
    let derradeiro = u64::from(req.cpu_address) + u64::from(req.length) - 1;
    if derradeiro > u64::from(BUS_LIMIT) {
        return Err(ResourceError::new(
            ResourceErrorCode::InvalidRange,
            format!(
                "lectura de {} bytes en {:#x} chega a {:#x}, fóra do barramento de 24 bits",
                req.length, req.cpu_address, derradeiro
            ),
        ));
    }
    if req.length > req.limits.max_bytes {
        return Err(ResourceError::new(
            ResourceErrorCode::LimitExceeded,
            format!(
                "length {} supera Limits::max_bytes {}",
                req.length, req.limits.max_bytes
            ),
        ));
    }
    if let Err(e) = req.profile.validate_state(req.state) {
        let mut err = from_addressing(e);
        err.code = ResourceErrorCode::BadState;
        err.detail = format!("{}: {}", req.profile.id(), err.detail);
        return Err(err);
    }

    let walked = req
        .profile
        .read(req.cpu_address, req.length, req.state, rom)
        .map_err(from_addressing)?;

    let mut segments: Vec<PhysicalSegment> = Vec::new();
    let mut bytes: Vec<u8> = Vec::new();
    let mut cursor = req.cpu_address;
    let fin = req.cpu_address + req.length; // sen desbordar: comprobado arriba
    for segment in walked {
        match segment {
            Segment::Bytes {
                region,
                offset,
                bytes: chunk,
            } => {
                if segments.len() as u32 >= req.limits.max_segments {
                    let err = ResourceError::new(
                        ResourceErrorCode::LimitExceeded,
                        format!(
                            "a lectura precisa máis de {} segmentos; parouse en {cursor:#x}",
                            req.limits.max_segments
                        ),
                    );
                    return Err(err.walked(segments, cursor));
                }
                let cpu_len = chunk.len() as u32;
                segments.push(PhysicalSegment {
                    index: segments.len() as u32,
                    cpu_address: cursor,
                    cpu_len,
                    rom_offset: offset,
                    region,
                    state: req.state.clone(),
                });
                bytes.extend_from_slice(&chunk);
                cursor += cpu_len;
            }
            Segment::DeviceNoBacking { region, offset, .. } => {
                let mut err = ResourceError::new(
                    ResourceErrorCode::NonRomRegion,
                    format!(
                        "{:#x} é {} do perfil {}: rexión coñecida sen backing na imaxe (offset interno {offset:#x})",
                        cursor,
                        region.as_str(),
                        req.profile.id()
                    ),
                );
                err.region = Some(region);
                return Err(err.walked(segments, cursor));
            }
            Segment::Invalid(e) => {
                let code = match e.code {
                    ErrorCode::Ambiguous => ResourceErrorCode::Ambiguous,
                    // `OutOfRange` aquí só pode vir dunha imaxe máis curta que
                    // `rom_size`: a fronteira do bus xa se comprobou arriba.
                    ErrorCode::OutOfRange => ResourceErrorCode::IncompatibleSize,
                    ErrorCode::Unsupported => ResourceErrorCode::NonRomRegion,
                };
                let err = ResourceError::new(
                    code,
                    format!("percorrido detido en {cursor:#x}: {}", e.detail),
                );
                return Err(err.walked(segments, cursor));
            }
        }
    }

    // Última garantía, non unha confianza no perfil: se o percorrido non cubriu
    // a lonxitude pedida, isto **non** é un éxito.
    if cursor != fin || bytes.len() as u64 != u64::from(req.length) {
        return Err(ResourceError::new(
            ResourceErrorCode::IncompatibleSize,
            format!(
                "o percorrido cubriu {} bytes dos {} pedidos para {}; non se devolve un parcial",
                cursor - req.cpu_address,
                req.length,
                req.profile.id()
            ),
        )
        .walked(segments, cursor));
    }

    Ok(ResourceRead {
        profile: req.profile.id(),
        contract_version: CONTRACT_VERSION,
        image: req.image.clone(),
        state: req.state.clone(),
        cpu_address: req.cpu_address,
        length: req.length,
        segments,
        bytes,
    })
}

/// Lectura guiada por unha **secuencia** de cambios de banco: os pasos
/// intercalan escritas de rexistrador e lecturas, e cada lectura ve o estado
/// resultante das escritas anteriores.
///
/// É unha operación distinta de [`read_resource`] a propósito: unha lectura con
/// instantánea fixa e unha serie de remapeos responden a preguntas diferentes e
/// non poden confundirse nunha soa firma.
///
/// A recusa é **total**: se un paso faila, non se devolve ningunha lectura, e o
/// estado prestado queda intacto (as escritas son puras). A procedencia dos
/// pasos xa satisfados viaxa no erro, renumerada, para que se pida que se leu
/// antes de fallar.
pub fn read_sequence(req: &SequenceRequest<'_>, rom: &[u8]) -> Result<SequenceRead, ResourceError> {
    // Precondition da *operación*, antes que calquera comprobación de datos:
    // nun perfil sen rexistradores non hai secuencia que percorrer.
    if !req.profile.has_mapper_registers() {
        return Err(ResourceError::new(
            ResourceErrorCode::BadState,
            format!(
                "{} non ten rexistradores de mapper: a lectura por secuencia de bancos non existe para este perfil, use read_resource",
                req.profile.id()
            ),
        ));
    }
    check_attestation(&req.image, rom)?;

    let mut state = req.initial_state.clone();
    let mut reads: Vec<ResourceRead> = Vec::new();
    let mut walked: Vec<PhysicalSegment> = Vec::new();
    let mut writes_applied = 0u32;

    for step in req.steps.iter() {
        match *step {
            Step::Read {
                cpu_address,
                length,
            } => {
                let inner = ResourceRequest {
                    profile: req.profile,
                    image: req.image.clone(),
                    state: &state,
                    cpu_address,
                    length,
                    limits: req.limits,
                };
                match read_resource(&inner, rom) {
                    Ok(got) => {
                        for segment in got.segments.clone() {
                            walked.push(PhysicalSegment {
                                index: walked.len() as u32,
                                ..segment
                            });
                        }
                        reads.push(got);
                    }
                    Err(mut err) => {
                        err.segments = merge_provenance(walked, err.segments);
                        return Err(err);
                    }
                }
            }
            Step::WriteRegister { cpu_address, data } => {
                match req.profile.write_register(cpu_address, data, &state) {
                    Ok(novo) => {
                        state = novo;
                        writes_applied += 1;
                    }
                    Err(e) => {
                        // Un enderezo fóra do barramento é un erro de rango;
                        // todo o demais (páxina equivocada, perfil sen
                        // rexistradores) é estado que o perfil rexeita.
                        let code = if e.code == ErrorCode::OutOfRange {
                            ResourceErrorCode::InvalidRange
                        } else {
                            ResourceErrorCode::BadState
                        };
                        let mut err = ResourceError::new(
                            code,
                            format!("escrita de secuencia rexeitada: {}", e.detail),
                        );
                        err.address = Some(cpu_address);
                        err.segments = std::mem::take(&mut walked);
                        return Err(err);
                    }
                }
            }
        }
    }

    Ok(SequenceRead {
        final_state: state,
        reads,
        writes_applied,
    })
}

/// Une a procedencia acumulada da secuencia coa do paso que falou, renumerando
/// desde 0: nun erro, `segments` é sempre "o que se leu ata aí", nunha soa
/// orde continua.
fn merge_provenance(
    mut acumulado: Vec<PhysicalSegment>,
    do_paso: Vec<PhysicalSegment>,
) -> Vec<PhysicalSegment> {
    let base = acumulado.len() as u32;
    acumulado.extend(
        do_paso
            .into_iter()
            .enumerate()
            .map(|(i, s)| PhysicalSegment {
                index: base + i as u32,
                ..s
            }),
    );
    acumulado
}
