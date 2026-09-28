//! ETAPA 3 — batería discriminante de fixtures para a capa de recursos.
//!
//! Tres fontes de verdade, e **ningunha** é a implementación baixo proba:
//!
//! 1. os segmentos esperados están escritos **a man** desde as especificacións
//!    pinadas (`docs/rex_profiles/addressing/*.md`) e as regras de corte que
//!    `CLASSIFICACION.md` documenta (borde do espello, porta da xanela, fim do
//!    banco, grupo contiguo de bancos completos);
//! 2. o **contido** de cada byte vén de `support::banked::byte_at`, función
//!    pechada do desprazamento físico;
//! 3. nun test aparte cada offset volve comprobarse contra
//!    `support::windows_engine`: o matcher declarativo de xanelas de bsnes e a
//!    táboa de páxinas de GPGX, unha terceira derivación que non comparte
//!    fórmula con `translate()`.
//!
//! `translate()` do produto non xera ningunha expectativa deste ficheiro: se o
//! produto e esta batería discordan, ten que haber un culpable nomeable.

mod support;

use rex_addressing::resource::{
    read_resource, read_sequence, ImageIdentity, Limits, PhysicalSegment, Profile,
    ResourceErrorCode, ResourceRead, ResourceRequest, SequenceRequest, Step,
};
use rex_addressing::{MapperState, Region, Value};
use support::{
    banked,
    sha256::sha256_hex,
    windows_engine::{self, Engine, Ssf2Engine},
};

// -------------------------------------------------------------------- axuda

fn imaxe(size: u32) -> Vec<u8> {
    banked::image(size as usize)
}

fn atestacion(origin: &str, rom: &[u8]) -> ImageIdentity {
    ImageIdentity {
        origin: origin.to_string(),
        sha256_hex: sha256_hex(rom),
        byte_len: rom.len() as u64,
    }
}

fn estado(perfil: Profile, size: u32, bancos: &[(u64, u64)]) -> MapperState {
    if perfil == Profile::MdSsf2 {
        MapperState::ssf2(u64::from(size), bancos)
    } else {
        MapperState::rom_size(u64::from(size))
    }
}

/// Invariantes comúns a **toda** lectura con éxito, comprobadas sobre a saída e
/// sobre o oráculo de contido (non sobre o que a biblioteca devolve de si).
fn verificar_procedencia(got: &ResourceRead, estado: &MapperState) {
    assert!(
        !got.segments.is_empty(),
        "unha lectura con éxito ten procedencia"
    );
    let mut cursor = got.cpu_address;
    let mut reconstruido: Vec<u8> = Vec::new();
    for (i, seg) in got.segments.iter().enumerate() {
        assert_eq!(seg.index, i as u32, "índices consecutivos desde 0");
        assert_eq!(
            seg.cpu_address, cursor,
            "os segmentos encadean no barramento sen ocos nin solapes"
        );
        assert_eq!(seg.region, Region::Rom);
        assert_eq!(&seg.state, estado, "cada segmento leva o estado vixente");
        reconstruido.extend(banked::expect(
            seg.rom_offset as usize,
            seg.cpu_len as usize,
        ));
        cursor += seg.cpu_len;
    }
    assert_eq!(
        cursor,
        got.cpu_address + got.length,
        "a suma dos corredores vale a lonxitude pedida"
    );
    assert_eq!(
        reconstruido, got.bytes,
        "a procedencia reconstrúe a saída byte a byte"
    );
    assert_eq!(reconstruido.len(), got.length as usize);
}

fn solicitar<'a>(
    perfil: Profile,
    estado: &'a MapperState,
    image: ImageIdentity,
    cpu: u32,
    lon: u32,
) -> ResourceRequest<'a> {
    ResourceRequest {
        profile: perfil,
        image,
        state: estado,
        cpu_address: cpu,
        length: lon,
        limits: Limits::DEFAULT,
    }
}

// ------------------------------------------------------------------ batería

/// Casos que teñen que ter **éxito**, coa súa lista de segmentos esperada:
/// `(enderezo_lóxico, lonxitude, offset_físico)`. Derivados a man.
struct CasoOk {
    id: &'static str,
    perfil: Profile,
    size: u32,
    bancos: &'static [(u64, u64)],
    cpu: u32,
    lon: u32,
    segmentos: &'static [(u32, u32, u32)],
    /// Que prova este caso, para que a batería sexa lexible como argumento.
    proba: &'static str,
}

const CASOS_OK: &[CasoOk] = &[
    // ---- 1. lectura dentro dunha soa xanela (un segmento, sen invención)
    CasoOk {
        id: "md-linear-4mb-corredor",
        perfil: Profile::MdLinear,
        size: 0x40_0000,
        bancos: &[],
        cpu: 0x00_1000,
        lon: 0x400,
        segmentos: &[(0x00_1000, 0x400, 0x00_1000)],
        proba: "unha xanela, un segmento, lineal",
    },
    CasoOk {
        id: "md-ssf2-4mb-xanela1-banco5",
        perfil: Profile::MdSsf2,
        size: 0x40_0000,
        bancos: &[(1, 5)],
        cpu: 0x08_0000,
        lon: 0x1_0000,
        segmentos: &[(0x08_0000, 0x1_0000, 0x28_0000)],
        proba: "banco 5 na xanela 1 => base (5 and 7) shl 19",
    },
    CasoOk {
        id: "lorom-512kb-banco-80",
        perfil: Profile::SnesLorom,
        size: 0x8_0000,
        bancos: &[],
        cpu: 0x80_8100,
        lon: 0x40,
        segmentos: &[(0x80_8100, 0x40, 0x00_0100)],
        proba: "banco 80 comparte páxina con 00, e dentro da páxina tírase A15 (`a and 7FFF`)",
    },
    CasoOk {
        id: "hirom-2mb-banco-c0",
        perfil: Profile::SnesHirom,
        size: 0x20_0000,
        bancos: &[],
        cpu: 0xc0_8000,
        lon: 0x100,
        segmentos: &[(0xc0_8000, 0x100, 0x00_8000)],
        proba: "banco completo C0 espellado mod 2MB",
    },
    CasoOk {
        id: "exhirom-6mb-area1-c0",
        perfil: Profile::SnesExhirom,
        size: 0x60_0000,
        bancos: &[],
        cpu: 0xc0_0000,
        lon: 0x100,
        segmentos: &[(0xc0_0000, 0x100, 0x00_0000)],
        proba: "área 1: A22/A23 desconectados, offset = enderezo mod 4MB",
    },
    CasoOk {
        id: "exhirom-6mb-area2-00",
        perfil: Profile::SnesExhirom,
        size: 0x60_0000,
        bancos: &[],
        cpu: 0x00_8000,
        lon: 0x100,
        segmentos: &[(0x00_8000, 0x100, 0x40_8000)],
        proba: "área 2: base 4MB + enderezo mod half2 (2MB)",
    },
    // ---- 2. fronteiras: cortes que o perfil ten que producir, non a capa
    CasoOk {
        id: "md-linear-2mb-borde-espello",
        perfil: Profile::MdLinear,
        size: 0x20_0000,
        bancos: &[],
        cpu: 0x1f_ff00,
        lon: 0x200,
        segmentos: &[(0x1f_ff00, 0x100, 0x1f_ff00), (0x20_0000, 0x100, 0x00_0000)],
        proba: "corte no borde do espello: dous segmentos, o segundo plegado",
    },
    CasoOk {
        id: "md-ssf2-4mb-porta-xanela-0-1",
        perfil: Profile::MdSsf2,
        size: 0x40_0000,
        bancos: &[(1, 5)],
        cpu: 0x07_ff00,
        lon: 0x200,
        segmentos: &[(0x07_ff00, 0x100, 0x07_ff00), (0x08_0000, 0x100, 0x28_0000)],
        proba: "un segmento por xanela, aínda con bases contiguas",
    },
    CasoOk {
        id: "exhirom-6mb-fronteira-3f-40",
        perfil: Profile::SnesExhirom,
        size: 0x60_0000,
        bancos: &[],
        cpu: 0x3f_ff_f0,
        lon: 0x20,
        segmentos: &[(0x3f_ff_f0, 0x10, 0x5f_ff_f0), (0x40_0000, 0x10, 0x40_0000)],
        proba: "área 2 modular: o offset **baixa** ao pasar de 3F a 40, e iso son dous segmentos",
    },
    // ---- 3. alias e grupos contiguos
    CasoOk {
        id: "md-ssf2-512kb-banco7-espealla",
        perfil: Profile::MdSsf2,
        size: 0x8_0000,
        bancos: &[(3, 7)],
        cpu: 0x18_0000,
        lon: 0x100,
        segmentos: &[(0x18_0000, 0x100, 0x00_0000)],
        proba: "con 512KB a máscara non deixa bits de banco: toda xanela espella",
    },
    CasoOk {
        id: "hirom-4mb-grupo-40-7d",
        perfil: Profile::SnesHirom,
        size: 0x40_0000,
        bancos: &[],
        cpu: 0x40_0000,
        lon: 0x2_0000,
        segmentos: &[(0x40_0000, 0x2_0000, 0x00_0000)],
        proba: "bancos completos contiguos si emenden (40->41 sen corte)",
    },
];

/// Casos que teñen que ser **recusados**, co código, a rexión nomeada (se o
/// perfil a coñece), o enderezo onde se detivo o percorrido e o que xa se
/// percorreu.
struct CasoRecusa {
    id: &'static str,
    perfil: Profile,
    size: u32,
    bancos: &'static [(u64, u64)],
    cpu: u32,
    lon: u32,
    codigo: ResourceErrorCode,
    rexion: Option<Region>,
    detido_en: u32,
    percorridos: &'static [(u32, u32, u32)],
    proba: &'static str,
}

const CASOS_RECUSA: &[CasoRecusa] = &[
    CasoRecusa {
        id: "md-linear-4mb-fora-da-ventan",
        perfil: Profile::MdLinear,
        size: 0x40_0000,
        bancos: &[],
        cpu: 0x3f_fff0,
        lon: 0x20,
        codigo: ResourceErrorCode::NonRomRegion,
        rexion: None,
        detido_en: 0x40_0000,
        percorridos: &[(0x3f_fff0, 0x10, 0x3f_fff0)],
        proba: "$400000 non ten dispositivo: recúsase tras 16 bytes reais",
    },
    CasoRecusa {
        id: "md-linear-1mb-rx-ssf2",
        perfil: Profile::MdLinear,
        size: 0x10_0000,
        bancos: &[],
        cpu: 0xa1_3000,
        lon: 0x10,
        codigo: ResourceErrorCode::NonRomRegion,
        rexion: Some(Region::CartIo),
        detido_en: 0xa1_3000,
        percorridos: &[],
        proba: "páxina de rexistradores: rexión coñecida, sen backing",
    },
    CasoRecusa {
        id: "md-linear-1mb-z80",
        perfil: Profile::MdLinear,
        size: 0x10_0000,
        bancos: &[],
        cpu: 0xa0_8000,
        lon: 0x10,
        codigo: ResourceErrorCode::NonRomRegion,
        rexion: Some(Region::Z80Ram),
        detido_en: 0xa0_8000,
        percorridos: &[],
        proba: "RAM do Z80 nunca sai da imaxe ROM",
    },
    CasoRecusa {
        id: "md-linear-1mb-work-ram",
        perfil: Profile::MdLinear,
        size: 0x10_0000,
        bancos: &[],
        cpu: 0xe0_0000,
        lon: 0x10,
        codigo: ResourceErrorCode::NonRomRegion,
        rexion: Some(Region::WorkRam),
        detido_en: 0xe0_0000,
        percorridos: &[],
        proba: "$E00000 é WorkRam do 68K, non cartucho",
    },
    CasoRecusa {
        id: "md-ssf2-4mb-xanela7-esouto",
        perfil: Profile::MdSsf2,
        size: 0x40_0000,
        bancos: &[(7, 3)],
        cpu: 0x3f_fff0,
        lon: 0x20,
        codigo: ResourceErrorCode::NonRomRegion,
        rexion: None,
        detido_en: 0x40_0000,
        percorridos: &[(0x3f_fff0, 0x10, 0x1f_fff0)],
        proba: "banco 3 na xanela 7: o percorrido que viaxa no erro xa está remapeado",
    },
    CasoRecusa {
        id: "lorom-512kb-io-00",
        perfil: Profile::SnesLorom,
        size: 0x8_0000,
        bancos: &[],
        cpu: 0x00_4000,
        lon: 0x10,
        codigo: ResourceErrorCode::NonRomRegion,
        rexion: Some(Region::Io),
        detido_en: 0x00_4000,
        percorridos: &[],
        proba: "$2000-$7FFF de 00-3D/80-BD é I/O do sistema, non ROM",
    },
    CasoRecusa {
        id: "lorom-512kb-reserva-3e",
        perfil: Profile::SnesLorom,
        size: 0x8_0000,
        bancos: &[],
        cpu: 0x3e_0000,
        lon: 0x10,
        codigo: ResourceErrorCode::NonRomRegion,
        rexion: None,
        detido_en: 0x3e_0000,
        percorridos: &[],
        proba: "banco 3E baixo: fóra do espello, do I/O e da discordancia A15",
    },
    CasoRecusa {
        id: "lorom-512kb-porta-wram",
        perfil: Profile::SnesLorom,
        size: 0x8_0000,
        bancos: &[],
        cpu: 0x00_8000,
        lon: 0x1_0000,
        codigo: ResourceErrorCode::NonRomRegion,
        rexion: Some(Region::WramMirror),
        detido_en: 0x01_0000,
        percorridos: &[(0x00_8000, 0x8000, 0x00_0000)],
        proba: "a páxina ROM de 32KB non emenda co banco seguinte",
    },
    CasoRecusa {
        id: "lorom-512kb-a15-ambiguo",
        perfil: Profile::SnesLorom,
        size: 0x8_0000,
        bancos: &[],
        cpu: 0x40_0000,
        lon: 0x10,
        codigo: ResourceErrorCode::Ambiguous,
        rexion: None,
        detido_en: 0x40_0000,
        percorridos: &[],
        proba: "A15 desconectado: dividen as fontes, o perfil non palpita",
    },
    CasoRecusa {
        id: "hirom-2mb-reserva-3e",
        perfil: Profile::SnesHirom,
        size: 0x20_0000,
        bancos: &[],
        cpu: 0x3e_0000,
        lon: 0x10,
        codigo: ResourceErrorCode::NonRomRegion,
        rexion: None,
        detido_en: 0x3e_0000,
        percorridos: &[],
        proba: "3E/3F baixos: sen dispositivo na fonte bsnes",
    },
    CasoRecusa {
        id: "hirom-2mb-espeello-00",
        perfil: Profile::SnesHirom,
        size: 0x20_0000,
        bancos: &[],
        cpu: 0x00_0000,
        lon: 0x10,
        codigo: ResourceErrorCode::NonRomRegion,
        rexion: Some(Region::WramMirror),
        detido_en: 0x00_0000,
        percorridos: &[],
        proba: "$0000-$1FFF de 00-3D é espello de WRAM, non ROM",
    },
    CasoRecusa {
        id: "exhirom-6mb-reserva-3f",
        perfil: Profile::SnesExhirom,
        size: 0x60_0000,
        bancos: &[],
        cpu: 0x3f_0000,
        lon: 0x10,
        codigo: ResourceErrorCode::NonRomRegion,
        rexion: None,
        detido_en: 0x3f_0000,
        percorridos: &[],
        proba: "área 2 só desde $8000: a metade baixa de 00-3F está reservada",
    },
];

// ------------------------------------------------------------------ tests

/// Probas 1, 2, 3 e 7 xuntas: cada caso esperado coincide en segmentos, e a
/// procedencia reconstrúe a saída byte a byte contra o oráculo de contido.
#[test]
fn a_bateria_de_lecturas_validas_coincide_co_derivado_a_man() {
    for caso in CASOS_OK {
        let rom = imaxe(caso.size);
        let state = estado(caso.perfil, caso.size, caso.bancos);
        let origin = format!("fixture:{}", caso.id);
        let got = read_resource(
            &solicitar(
                caso.perfil,
                &state,
                atestacion(&origin, &rom),
                caso.cpu,
                caso.lon,
            ),
            &rom,
        )
        .unwrap_or_else(|e| panic!("{}: {} => recusado {}", caso.id, caso.proba, e.detail));

        assert_eq!(got.profile, caso.perfil.id(), "{}", caso.id);
        assert_eq!(got.cpu_address, caso.cpu);
        assert_eq!(got.length, caso.lon);
        let esperado: Vec<(u32, u32, u32)> = caso.segmentos.to_vec();
        let obtido: Vec<(u32, u32, u32)> = got
            .segments
            .iter()
            .map(|s: &PhysicalSegment| (s.cpu_address, s.cpu_len, s.rom_offset))
            .collect();
        assert_eq!(obtido, esperado, "{}: {}", caso.id, caso.proba);

        // O contido non vén da biblioteca: vén do oráculo pechado.
        let mut manual: Vec<u8> = Vec::new();
        for (_, len, off) in caso.segmentos {
            manual.extend(banked::expect(*off as usize, *len as usize));
        }
        assert_eq!(got.bytes, manual, "{}: bytes do corredor", caso.id);
        verificar_procedencia(&got, &state);
    }
}

/// Probas 4 e "fronteiras": cada recusa devolve o código, a rexión (se existe),
/// o punto onde parou e **só** o que realmente se leu.
#[test]
fn a_bateria_de_recusas_devolve_codigo_rexion_e_procedencia() {
    for caso in CASOS_RECUSA {
        let rom = imaxe(caso.size);
        let state = estado(caso.perfil, caso.size, caso.bancos);
        let err = read_resource(
            &solicitar(
                caso.perfil,
                &state,
                atestacion(&format!("fixture:{}", caso.id), &rom),
                caso.cpu,
                caso.lon,
            ),
            &rom,
        )
        .expect_err(&format!("{}: {} => debía recusarse", caso.id, caso.proba));

        assert_eq!(err.code, caso.codigo, "{}", caso.id);
        assert_eq!(err.region, caso.rexion, "{}: rexión nomeada", caso.id);
        assert_eq!(err.address, Some(caso.detido_en), "{}", caso.id);
        let obtido: Vec<(u32, u32, u32)> = err
            .segments
            .iter()
            .map(|s| (s.cpu_address, s.cpu_len, s.rom_offset))
            .collect();
        assert_eq!(obtido, caso.percorridos, "{}: percorrido real", caso.id);
        assert!(
            !err.detail.is_empty(),
            "{}: un erro sen detalle non é auditable",
            caso.id
        );
    }
}

/// Proba 3: enderezos lóxicos distintos que **teñen** que dar os mesmos bytes,
/// comprobados polo oráculo e non entre dúas saídas do produto.
#[test]
fn os_alias_acada_os_mesmos_bytes_por_dous_camiños_distintos() {
    // LoROM: banco 00 e banco 80 comparten páxina porque o desprazamento é
    // `(banco and 7F) * 32KB + (a and 7FFF)` — tíranse A23 e A15.
    let rom = imaxe(0x8_0000);
    let state = MapperState::rom_size(0x8_0000);
    let un = read_resource(
        &solicitar(
            Profile::SnesLorom,
            &state,
            atestacion("fixture:alias-lorom-00", &rom),
            0x00_8100,
            0x100,
        ),
        &rom,
    )
    .expect("banco 00 metade alta");
    let dous = read_resource(
        &solicitar(
            Profile::SnesLorom,
            &state,
            atestacion("fixture:alias-lorom-80", &rom),
            0x80_8100,
            0x100,
        ),
        &rom,
    )
    .expect("banco 80 metade alta");
    assert_eq!(un.segments[0].rom_offset, 0x00_0100);
    assert_eq!(un.segments[0].rom_offset, dous.segments[0].rom_offset);
    assert_eq!(un.bytes, dous.bytes);
    assert_ne!(un.cpu_address, dous.cpu_address);
    assert_eq!(un.bytes, banked::expect(0x100, 0x100));

    // SSF2 con 512KB: todas as 8 xanelas espellan na mesma base, así que os
    // bytes de calquera xanela son os dos primeiros 64KB da imaxe.
    let rom512 = imaxe(0x8_0000);
    let state512 = MapperState::ssf2(0x8_0000, &[(3, 7), (6, 5)]);
    for window in 0..8u32 {
        let addr = window * 0x8_0000;
        let got = read_resource(
            &solicitar(
                Profile::MdSsf2,
                &state512,
                atestacion("fixture:alias-ssf2-512k", &rom512),
                addr,
                0x20,
            ),
            &rom512,
        )
        .unwrap_or_else(|e| panic!("xanela {window}: {}", e.detail));
        assert_eq!(
            got.bytes,
            banked::expect(addr as usize & 0x7_ffff, 0x20),
            "xanela {window} debe espellar o mesmo desprazamento"
        );
    }

    // md-linear: 0x00_0000 e 0x20_0000 son o mesmo byte cando o espello é 2MB.
    let rom2 = imaxe(0x20_0000);
    let state2 = MapperState::rom_size(0x20_0000);
    let a = read_resource(
        &solicitar(
            Profile::MdLinear,
            &state2,
            atestacion("fixture:alias-md-0", &rom2),
            0x00_0000,
            0x40,
        ),
        &rom2,
    )
    .expect("inicio do espello");
    let b = read_resource(
        &solicitar(
            Profile::MdLinear,
            &state2,
            atestacion("fixture:alias-md-2m", &rom2),
            0x20_0000,
            0x40,
        ),
        &rom2,
    )
    .expect("volta do espello");
    assert_eq!(a.bytes, b.bytes);
    assert_eq!(a.segments[0].rom_offset, b.segments[0].rom_offset);
    assert_eq!(a.bytes, banked::expect(0, 0x40));
}

/// Proba 5: unha escrita de banco SSF2 só move a xanela escrita. As expectativas
/// son oito offsets literais, non unha comparación entre lecturas do produto.
#[test]
fn a_escrita_de_banco_ss2_non_move_as_xanelas_non_escritas() {
    let size = 0x40_0000u32;
    let rom = imaxe(size);
    let esperado_antes: [u32; 8] = [
        0x00_0000, 0x08_0000, 0x10_0000, 0x18_0000, 0x20_0000, 0x28_0000, 0x30_0000, 0x38_0000,
    ];
    // Banco 2 na xanela 3 => base (2 and 7) shl 19 = 0x100000. Só cambia a 3.
    let esperado_despois: [u32; 8] = [
        0x00_0000, 0x08_0000, 0x10_0000, 0x10_0000, 0x20_0000, 0x28_0000, 0x30_0000, 0x38_0000,
    ];

    let ler_odo = |state: &MapperState| -> Vec<(u32, u32)> {
        (0..8u32)
            .map(|w| {
                let addr = w * 0x8_0000;
                let got = read_resource(
                    &solicitar(
                        Profile::MdSsf2,
                        state,
                        atestacion("fixture:ssf2-illamento", &rom),
                        addr,
                        0x10,
                    ),
                    &rom,
                )
                .unwrap_or_else(|e| panic!("xanela {w}: {}", e.detail));
                (got.segments[0].rom_offset, w)
            })
            .map(|(o, _)| (o, 0u32))
            .collect()
    };

    let antes = estado(Profile::MdSsf2, size, &[]);
    let offsets_antes: Vec<u32> = ler_odo(&antes).iter().map(|(o, _)| *o).collect();
    assert_eq!(offsets_antes, esperado_antes.to_vec(), "estado identidade");

    let despois = MapperState::ssf2(u64::from(size), &[(3, 2)]);
    let offsets_despois: Vec<u32> = ler_odo(&despois).iter().map(|(o, _)| *o).collect();
    assert_eq!(
        offsets_despois,
        esperado_despois.to_vec(),
        "só a xanela 3 se remapea"
    );

    // E iso vese nos **bytes**, non só nos offsets: a xanela 3 pasa a dar os
    // bytes da xanela 2, e ningunha outra cambia.
    for w in 0..8u32 {
        let addr = w * 0x8_0000;
        let antes_bytes = read_resource(
            &solicitar(
                Profile::MdSsf2,
                &antes,
                atestacion("fixture:ssf2-illamento-a", &rom),
                addr,
                0x10,
            ),
            &rom,
        )
        .expect("lectura antes")
        .bytes;
        let despois_bytes = read_resource(
            &solicitar(
                Profile::MdSsf2,
                &despois,
                atestacion("fixture:ssf2-illamento-b", &rom),
                addr,
                0x10,
            ),
            &rom,
        )
        .expect("lectura despois")
        .bytes;
        let esperado = banked::expect(esperado_despois[w as usize] as usize, 0x10);
        assert_eq!(despois_bytes, esperado, "xanela {w}");
        if w == 3 {
            assert_ne!(antes_bytes, despois_bytes, "a 3 tiña que cambiar");
            assert_eq!(despois_bytes, banked::expect(0x10_0000, 0x10));
        } else {
            assert_eq!(antes_bytes, despois_bytes, "a {w} non tiña que cambiar");
        }
    }
    assert_eq!(antes, MapperState::ssf2(u64::from(size), &[]));
}

/// Proba 6: o mesmo enderezo lóxico, dous estados, bytes distintos — cada un
/// igual ao que predí o oráculo para o seu offset.
#[test]
fn o_mesmo_enderezo_loxico_dá_bytes_distintos_segundo_o_estado() {
    let rom = imaxe(0x40_0000);
    let cpu = 0x10_0000u32; // inicio da xanela 2
    let lon = 0x100u32;

    let identidade = estado(Profile::MdSsf2, 0x40_0000, &[]);
    let remapeado = estado(Profile::MdSsf2, 0x40_0000, &[(2, 5)]);

    let a = read_resource(
        &solicitar(
            Profile::MdSsf2,
            &identidade,
            atestacion("fixture:estado-a", &rom),
            cpu,
            lon,
        ),
        &rom,
    )
    .expect("estado identidade");
    let b = read_resource(
        &solicitar(
            Profile::MdSsf2,
            &remapeado,
            atestacion("fixture:estado-b", &rom),
            cpu,
            lon,
        ),
        &rom,
    )
    .expect("estado con banco 5 na xanela 2");

    assert_eq!(a.cpu_address, b.cpu_address);
    assert_eq!(a.segments[0].rom_offset, 0x10_0000);
    assert_eq!(b.segments[0].rom_offset, 0x28_0000);
    assert_ne!(a.bytes, b.bytes, "un remapeo que non cambia bytes é falso");
    assert_eq!(a.bytes, banked::expect(0x10_0000, lon as usize));
    assert_eq!(b.bytes, banked::expect(0x28_0000, lon as usize));
    // Cada saída leva o **seu** estado, non o do lector anterior.
    assert_eq!(a.state, identidade);
    assert_eq!(b.state, remapeado);
}

/// Proba 8: dúas instancias de estado non se inflúen, nin sequando cando unha
/// delas se usa nunha secuencia que escribe rexistradores.
#[test]
fn dous_instancias_de_estado_non_se_influen() {
    let rom = imaxe(0x40_0000);
    let s1 = estado(Profile::MdSsf2, 0x40_0000, &[]);
    let s2 = estado(Profile::MdSsf2, 0x40_0000, &[(1, 6)]);
    let (s1_original, s2_original) = (s1.clone(), s2.clone());

    let pasos = [
        Step::Read {
            cpu_address: 0x08_0000,
            length: 0x10,
        },
        Step::WriteRegister {
            cpu_address: 0xa1_3002,
            data: 5,
        },
        Step::Read {
            cpu_address: 0x08_0000,
            length: 0x10,
        },
    ];

    let executar = |inicial: &MapperState| {
        read_sequence(
            &SequenceRequest {
                profile: Profile::MdSsf2,
                image: atestacion("fixture:instancias", &rom),
                initial_state: inicial,
                limits: Limits::DEFAULT,
                steps: &pasos,
            },
            &rom,
        )
        .expect("secuencia válida")
    };

    let r1 = executar(&s1);
    let r2 = executar(&s2);

    // s1: identidade => 0x08_0000, despois banco 5 => 0x28_0000.
    assert_eq!(r1.reads[0].segments[0].rom_offset, 0x08_0000);
    assert_eq!(r1.reads[1].segments[0].rom_offset, 0x28_0000);
    // s2: xa empezaba en banco 6 => 0x30_0000; a escrita do paso 2 móvea a 5.
    assert_eq!(r2.reads[0].segments[0].rom_offset, 0x30_0000);
    assert_eq!(r2.reads[1].segments[0].rom_offset, 0x28_0000);

    assert_eq!(r1.writes_applied, 2 - 1);
    assert_eq!(r2.writes_applied, 1);

    // Os bytes da segunda lectura son os mesmos nos dous estados: o remapeo
    // converxe, e iso tamén é evidencia (non só que diverxa).
    assert_eq!(r1.reads[1].bytes, r2.reads[1].bytes);
    assert_eq!(r1.reads[1].bytes, banked::expect(0x28_0000, 0x10));
    assert_eq!(r1.reads[0].bytes, banked::expect(0x08_0000, 0x10));
    assert_eq!(r2.reads[0].bytes, banked::expect(0x30_0000, 0x10));

    // `final_state` é un estado **novo**: as instancias de entrada non se tocan.
    assert_eq!(r1.final_state, MapperState::ssf2(0x40_0000, &[(1, 5)]));
    assert_eq!(r2.final_state, MapperState::ssf2(0x40_0000, &[(1, 5)]));
    assert_eq!(s1, s1_original, "a lectura non muta o estado da chamante");
    assert_eq!(s2, s2_original, "a secuencia non muta o estado da chamante");
    // E os segmentos de cada lectura levan o estado do momento, non o final.
    assert_eq!(r1.reads[0].segments[0].state, s1_original);
    assert_eq!(r1.reads[1].segments[0].state, r1.final_state);
}

/// Exclusións explícitas: ningunha clave de chip especial abre un camiño de
/// lectura nos perfis SNES. A control anterior demostra que o enderezo si era
/// válido, así que a recusa só pode vir do estado.
#[test]
fn ningunha_chave_de_chip_especial_abre_un_camino_en_snes() {
    let casos = [
        (Profile::SnesLorom, 0x8_0000u32, 0x00_8000u32),
        (Profile::SnesHirom, 0x20_0000, 0x40_0000),
        (Profile::SnesExhirom, 0x60_0000, 0xc0_0000),
    ];
    for chips in [
        [("chip", "DSP1"), ("dsp", "1")],
        [("chip", "SA-1"), ("cx4", "1")],
        [("chip", "SuperFX"), ("bsx", "1")],
    ] {
        for (perfil, size, cpu) in casos {
            let rom = imaxe(size);
            let limpo = estado(perfil, size, &[]);
            let control = read_resource(
                &solicitar(
                    perfil,
                    &limpo,
                    atestacion("fixture:chip-control", &rom),
                    cpu,
                    0x10,
                ),
                &rom,
            );
            assert!(
                control.is_ok(),
                "{}: a control sen chip debe ler",
                perfil.id()
            );

            let mut entradas = vec![("rom_size".to_string(), Value::Uint(u64::from(size)))];
            entradas.extend(
                chips
                    .iter()
                    .map(|(k, v)| (k.to_string(), Value::Text(v.to_string()))),
            );
            let con_chip = MapperState::from_entries(entradas);
            let err = read_resource(
                &solicitar(
                    perfil,
                    &con_chip,
                    atestacion("fixture:chip-dsp1", &rom),
                    cpu,
                    0x10,
                ),
                &rom,
            )
            .expect_err(&format!(
                "{}: {chips:?} non está no contrato e non pode ignorarse",
                perfil.id()
            ));
            assert_eq!(err.code, ResourceErrorCode::BadState);
            assert!(
                err.detail.starts_with(perfil.id()),
                "o detalle di que perfil rexeitou: {}",
                err.detail
            );
            assert!(
                err.segments.is_empty(),
                "recusado antes de percorrer: sen procedencia inventada"
            );
        }
    }

    // `md-linear` é a outra cara da historia: ignora claves alleas (clase B de
    // CLASSIFICACION). Píñase para que ninguén venda iso por validación.
    let rom = imaxe(0x40_0000);
    let con_sobra = MapperState::from_entries(vec![
        ("rom_size".to_string(), Value::Uint(0x40_0000)),
        ("chip".to_string(), Value::Text("SSF2".to_string())),
    ]);
    let got = read_resource(
        &solicitar(
            Profile::MdLinear,
            &con_sobra,
            atestacion("fixture:md-ignora-alleo", &rom),
            0x00_1000,
            0x10,
        ),
        &rom,
    )
    .expect("md-linear ignora claves que non coñece (política, non validación)");
    assert_eq!(got.state, con_sobra);
}

/// ExHiROM fóra do contrato: os totais que a especificación non admite falan
/// **por estado**, antes de calquera percorrido, e co nome do perfil no detalle.
#[test]
fn exhirom_fóra_do_contrato_falla_por_estado_non_por_rango() {
    let fora = [
        (0x40_0000u32, "4MB: o total ten que superar a primeira área"),
        (0x70_0000, "7MB: a segunda área (3MB) non é binaria"),
        (0x100_0000, "16MB: supera o barramento de 24 bits"),
        (0x50_1000, "5MB + 4KB: segunda área non binaria"),
    ];
    for (size, motivo) in fora {
        let rom = imaxe(0x60_0000); // imaxe válida: a recusa non pode vir del
        let state = MapperState::rom_size(u64::from(size));
        let err = read_resource(
            &solicitar(
                Profile::SnesExhirom,
                &state,
                atestacion("fixture:exhirom-fóra", &rom),
                0x00_8000,
                0x10,
            ),
            &rom,
        )
        .expect_err(&format!("tamaño {size:#x}: {motivo}"));
        assert_eq!(err.code, ResourceErrorCode::BadState, "{motivo}");
        assert!(err.detail.contains("snes-exhirom"), "{motivo}");
        assert!(err.segments.is_empty(), "{motivo}: sen procedencia");
    }

    // Control: os tres totais válidos (5MB, 6MB, 8MB) leron.
    for size in [0x50_0000u32, 0x60_0000, 0x80_0000] {
        let rom = imaxe(size);
        let state = estado(Profile::SnesExhirom, size, &[]);
        let got = read_resource(
            &solicitar(
                Profile::SnesExhirom,
                &state,
                atestacion("fixture:exhirom-control", &rom),
                0x00_8000,
                0x10,
            ),
            &rom,
        )
        .unwrap_or_else(|e| panic!("total {size:#x} é válido: {}", e.detail));
        // Área 2: base 4MB + (`enderezo mod half2`), e medio banco alto de $8000.
        assert_eq!(got.segments[0].rom_offset, 0x40_8000, "total {size:#x}");
        assert_eq!(got.bytes, banked::expect(0x40_8000, 0x10));
    }
}

/// O desprazamento físico de cada caso volve saír dun **segundo** camiño: o
/// matcher declarativo de xanelas (bsnes) e a táboa de páxinas (GPGX). Ningún
/// dos dous usa as fórmulas dos perfis.
#[test]
fn o_motor_de_xanelas_declarativas_confirma_los_offsets_da_bateria() {
    let oraculo = |perfil: Profile, size: u32, bancos: &[(u64, u64)], addr: u32| -> Engine {
        match perfil {
            Profile::MdSsf2 => Ssf2Engine::new(u64::from(size), bancos).translate(u64::from(addr)),
            other => {
                windows_engine::table_for(other.id(), u64::from(size)).translate(u64::from(addr))
            }
        }
    };

    for caso in CASOS_OK {
        for (cpu, _, offset) in caso.segmentos {
            assert_eq!(
                oraculo(caso.perfil, caso.size, caso.bancos, *cpu),
                Engine::Ok {
                    region: "rom".to_string(),
                    offset: u64::from(*offset),
                },
                "{}: o motor declarativo di outro",
                caso.id
            );
        }
    }

    for caso in CASOS_RECUSA {
        let got = oraculo(caso.perfil, caso.size, caso.bancos, caso.detido_en);
        match caso.rexion {
            Some(region) => assert_eq!(
                got,
                Engine::Ok {
                    region: region.as_str().to_string(),
                    offset: got_offset(&got),
                },
                "{}: rexión {} esperada polo motor",
                caso.id,
                region.as_str()
            ),
            None => assert!(
                matches!(got, Engine::Err(_)),
                "{}: o motor tampouco lle dá rexión ({got:?})",
                caso.id
            ),
        }
    }
}

fn got_offset(got: &Engine) -> u64 {
    match got {
        Engine::Ok { offset, .. } => *offset,
        Engine::Err(_) => 0,
    }
}

/// Non-degeneración: sen este control, calquera batería verde podería ser
/// un acorde de ceros. Comproba que cada caso discriminante **cambia** se o
/// desprazamento se despraza, e que a batería cubre os cinco perfis.
#[test]
fn a_bateria_non_e_vacia_e_discrimina() {
    let mut perfiles = Profile::all()
        .iter()
        .map(|p| (p.id(), 0usize, 0usize))
        .collect::<Vec<_>>();
    for caso in CASOS_OK {
        for (_, len, off) in caso.segmentos {
            let esperado = banked::expect(*off as usize, *len as usize);
            assert_eq!(esperado.len(), *len as usize);
            // Un erro de desprazamento dun byte ten que cambiar o vector: se non
            // o cambia, a fixture non discrimina ese erro neste caso.
            assert!(
                banked::discrimina(*off as usize, *off as usize + 1, *len as usize),
                "{}: caso non discriminante ante desprazamento de 1 byte",
                caso.id
            );
            // E un erro de banco de 512KB tamén.
            assert!(
                banked::discrimina(*off as usize, *off as usize + 0x8_0000, *len as usize),
                "{}: caso non discriminante ante banco equivocado",
                caso.id
            );
        }
        let alvo = perfiles
            .iter_mut()
            .find(|(id, _, _)| *id == caso.perfil.id())
            .expect("perfil da batería coñecido");
        alvo.1 += 1;
    }
    for caso in CASOS_RECUSA {
        let alvo = perfiles
            .iter_mut()
            .find(|(id, _, _)| *id == caso.perfil.id())
            .expect("perfil da batería coñecido");
        alvo.2 += 1;
    }
    for (perfil, ok, recusas) in &perfiles {
        assert!(
            *ok > 0 && *recusas > 0,
            "{perfil}: {ok} lecturas e {recusas} recusas — os cinco perfis teñen que estar representados"
        );
    }
}
