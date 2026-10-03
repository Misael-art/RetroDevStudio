//! Rodada 5, validación 1 e 2: os vectores diferenciais pinados consómense en
//! Rust sen Node, e cada resposta compárase tamén cunha segunda referencia
//! independente (motor de xanelas declarativas).

mod support;

use rex_addressing::{AddressingError, ErrorCode, MapperState, Region, Segment, Translate};
use support::conv;
use support::fixture;
use support::vectors::{self, ExpectInv, ExpectTx, ProfileVectors, RawState, RawValue};
use support::windows_engine::{self, Engine, Ssf2Engine};

/// Un perfil, visto polo runner: as tres operacións do contrato.
type TranslateFn = fn(u32, &MapperState) -> Translate;
type InvertFn = fn(u32, &MapperState) -> Result<Vec<u32>, AddressingError>;
type ReadFn = fn(u32, u32, &MapperState, &[u8]) -> Result<Vec<Segment>, AddressingError>;

struct ProfileImpl {
    id: &'static str,
    translate: TranslateFn,
    invert: InvertFn,
    read: ReadFn,
}

#[test]
fn md_linear_concorda_cos_vectores_pinados_e_co_motor_de_referencia() {
    run(&ProfileImpl {
        id: "md-linear",
        translate: rex_addressing::md_linear::translate,
        invert: rex_addressing::md_linear::invert,
        read: rex_addressing::md_linear::read,
    });
}

#[test]
fn md_ssf2_concorda_cos_vectores_pinados_e_co_motor_de_referencia() {
    run(&ProfileImpl {
        id: "md-ssf2",
        translate: rex_addressing::md_ssf2::translate,
        invert: rex_addressing::md_ssf2::invert,
        read: rex_addressing::md_ssf2::read,
    });
}

#[test]
fn snes_lorom_concorda_cos_vectores_pinados_e_co_motor_de_referencia() {
    run(&ProfileImpl {
        id: "snes-lorom",
        translate: rex_addressing::snes_lorom::translate,
        invert: rex_addressing::snes_lorom::invert,
        read: rex_addressing::snes_lorom::read,
    });
}

#[test]
fn snes_hirom_concorda_cos_vectores_pinados_e_co_motor_de_referencia() {
    run(&ProfileImpl {
        id: "snes-hirom",
        translate: rex_addressing::snes_hirom::translate,
        invert: rex_addressing::snes_hirom::invert,
        read: rex_addressing::snes_hirom::read,
    });
}

#[test]
fn snes_exhirom_concorda_cos_vectores_pinados_e_co_motor_de_referencia() {
    run(&ProfileImpl {
        id: "snes-exhirom",
        translate: rex_addressing::snes_exhirom::translate,
        invert: rex_addressing::snes_exhirom::invert,
        read: rex_addressing::snes_exhirom::read,
    });
}

/// As 12 secuencias pináronse contra `rom_size = 0x800000` **fixo** no xerador
/// (`export-vectors.mjs`), non contra o tamaño da fixture de `md-ssf2`, que é
/// 4MB. Polo tanto as sondas sobardan a imaxe de fixture e só se pode comparar
/// a tradución, nunca bytes. Artefacto rexistrado no informe da rodada.
const SSF2_SEQ_ROM_SIZE: u64 = 0x800000;

/// Secuencias aleatorias de escritas (12, pinadas): desde o estado identidade
/// aplícanse todas, e gradanse os bancos resultantes **e** a tradución de oito
/// sondas por secuencia.
#[test]
fn md_ssf2_secuencias_de_escrita_pinadas_remapean_e_traducen() {
    let set = vectors::load();
    let pv = set.profile("md-ssf2");
    assert_eq!(
        pv.ssf2_seqs.len(),
        12,
        "o reconto de secuencias pinadas cambiou"
    );
    for s in &pv.ssf2_seqs {
        let mut state = MapperState::ssf2(SSF2_SEQ_ROM_SIZE, &[]);
        for w in &s.writes {
            state = write(state, w, &format!("seq {}", s.seq));
        }
        assert_eq!(
            banks_of(&state),
            sorted_pairs(&s.expect_banks),
            "seq {}: bancos despois da secuencia",
            s.seq
        );
        for (addr, offset) in &s.probes {
            assert_eq!(
                rex_addressing::md_ssf2::translate(conv::u32(*addr), &state),
                Translate::Rom {
                    offset: conv::u32(*offset)
                },
                "seq {}: sonda {:#x}",
                s.seq,
                addr
            );
        }
    }
}

/// Casos de escrita nomeados (10, pinados): cada un di que xanela remapea que
/// posición da páxina TIME, incluídos os espellos (`0xA130F3` → xanela 1).
#[test]
fn md_ssf2_casos_pinados_de_write_mapper_register() {
    let set = vectors::load();
    let pv = set.profile("md-ssf2");
    assert_eq!(
        pv.ssf2_pinned.len(),
        10,
        "o reconto de casos de escritura pinados cambiou"
    );
    for c in &pv.ssf2_pinned {
        let mut state = conv::to_mapper_state(&c.state);
        for w in &c.writes {
            state = write(state, w, &format!("{} /", c.name));
        }
        assert_eq!(
            banks_of(&state),
            sorted_pairs(&c.expect_banks),
            "{}: bancos",
            c.name
        );
        for (addr, offset) in &c.expect_translate {
            assert_eq!(
                rex_addressing::md_ssf2::translate(conv::u32(*addr), &state),
                Translate::Rom {
                    offset: conv::u32(*offset)
                },
                "{}: tradución despois da escrita",
                c.name
            );
        }
    }
}

/// Aplica unha escrita pinada. `data` é byte por construción nos vectores: o
/// tipo `u8` do contrato xa impide o resto (rexistrado no informe).
fn write(state: MapperState, w: &vectors::BankWrite, label: &str) -> MapperState {
    let addr = conv::u32(w.cpu_address);
    let data = u8::try_from(w.data).expect("un rexistro SSF2 escribe un byte");
    rex_addressing::md_ssf2::write_mapper_register(addr, data, &state)
        .unwrap_or_else(|e| panic!("{label}: escrita {addr:#x} = {data} rexeitada {e:?}"))
}

/// Bancos observables dun estado, como pares ordenados.
fn banks_of(state: &MapperState) -> Vec<(u64, u64)> {
    let mut out: Vec<(u64, u64)> = match state.object("banks") {
        Some(entries) => entries
            .iter()
            .filter_map(|(k, v)| k.parse::<u64>().ok().zip(v.as_uint()))
            .collect(),
        None => Vec::new(),
    };
    out.sort();
    out
}

fn sorted_pairs(pairs: &[(u64, u64)]) -> Vec<(u64, u64)> {
    let mut out = pairs.to_vec();
    out.sort();
    out
}

fn run(impl_: &ProfileImpl) {
    let set = vectors::load();
    let pv = set.profile(impl_.id);
    let stream = fixture_stream(pv);

    translate_cases(impl_, pv);
    negative_cases(impl_, pv);
    invert_cases(impl_, pv, &stream);
    read_cases(impl_, pv, &stream);
    oracle_cross_check(impl_, pv);
    invert_oracle_cross_check(impl_, pv);
}

fn fixture_stream(pv: &ProfileVectors) -> Vec<u8> {
    let size = usize::try_from(pv.fixture.rom_size).expect("rom_size razoable");
    let built = fixture::build_fixture(
        fixture::seed_base(&pv.name),
        size,
        fixture::block_size(&pv.name),
    );
    assert_eq!(
        support::sha256::sha256_hex(&built),
        pv.fixture.sha256,
        "fixture de {} non reproduce a SHA pinada",
        pv.name
    );
    built
}

fn translate_cases(impl_: &ProfileImpl, pv: &ProfileVectors) {
    for c in &pv.translate {
        let state = conv::to_mapper_state(&c.state);
        let ExpectTx::Ok { region, offset } = &c.expect else {
            panic!("{} / {}: translate positivo agardado", impl_.id, c.name);
        };
        let got = (impl_.translate)(c.cpu_address as u32, &state);
        let want = expect_translate(region, *offset);
        assert_eq!(got, want, "{} / {}", impl_.id, c.name);
    }
}

fn expect_translate(region: &str, offset: u64) -> Translate {
    let region: Region = conv::region(region);
    let offset = conv::u32(offset);
    if region == Region::Rom {
        Translate::Rom { offset }
    } else {
        Translate::Device { region, offset }
    }
}

fn negative_cases(impl_: &ProfileImpl, pv: &ProfileVectors) {
    for c in &pv.negatives {
        let state = conv::to_mapper_state(&c.state);
        let got = (impl_.translate)(c.cpu_address as u32, &state);
        let want = conv::code(&c.expect_error);
        let Translate::Invalid(err) = got else {
            panic!(
                "{} / {}: agardábase {:?}, perfil devolve {got:?}",
                impl_.id, c.name, want
            );
        };
        assert_eq!(err.code, want, "{} / {}", impl_.id, c.name);
        assert!(
            !err.detail.is_empty(),
            "{} / {}: erro sen detalle legible",
            impl_.id,
            c.name
        );
    }
}

fn invert_cases(impl_: &ProfileImpl, pv: &ProfileVectors, stream: &[u8]) {
    let mut non_integer_skipped = 0usize;
    for c in &pv.invert {
        // `rom_offset` non enteiro só existe como token JSON: o tipo `u32` do
        // contrato xa o impide na frontada, así que o vector non é traducible.
        if matches!(c.rom_offset, RawValue::Text(_) | RawValue::NonInteger(_)) {
            non_integer_skipped += 1;
            continue;
        }
        let state = conv::to_mapper_state(&c.state);
        let offset = conv::u32(match &c.rom_offset {
            RawValue::Uint(n) => *n,
            other => panic!(
                "{} / {}: rom_offset non representable {other:?}",
                impl_.id, c.name
            ),
        });
        match &c.expect {
            ExpectInv::Aliases(list) => {
                let got = (impl_.invert)(offset, &state)
                    .unwrap_or_else(|e| panic!("{} / {}: invert fallou {e:?}", impl_.id, c.name));
                let want: Vec<u32> = list.iter().map(|n| conv::u32(*n)).collect();
                assert_eq!(got, want, "{} / {}", impl_.id, c.name);
                for alias in &got {
                    assert_eq!(
                        (impl_.translate)(*alias, &state),
                        Translate::Rom { offset },
                        "{} / {}: alias {alias:#x} non retraduce ao offset",
                        impl_.id,
                        c.name
                    );
                }
            }
            ExpectInv::Err(code) => {
                let got = (impl_.invert)(offset, &state);
                match got {
                    Err(e) => assert_eq!(e.code, conv::code(code), "{} / {}", impl_.id, c.name),
                    Ok(aliases) => panic!(
                        "{} / {}: agardábase erro {code}, invert devolve {} aliases",
                        impl_.id,
                        c.name,
                        aliases.len()
                    ),
                }
            }
        }
    }
    assert_eq!(
        non_integer_skipped,
        pv.invert_non_integer_offset_count(),
        "{}: o reconto de casos non traducibles ao tipo cambiou",
        impl_.id
    );

    // Mostras verificadas por enumeración exaustiva na rodada 1-2, co estado
    // da fixture.
    let fixture_state = conv::to_mapper_state(&RawState::plain(pv.fixture.rom_size));
    for s in &pv.invert_samples {
        let offset = conv::u32(s.rom_offset);
        let got = (impl_.invert)(offset, &fixture_state).expect("invert de mostra");
        let want: Vec<u32> = s.aliases.iter().map(|n| conv::u32(*n)).collect();
        assert_eq!(got, want, "{}: mostra de inversión {offset:#x}", impl_.id);
    }
    let _ = stream;
}

fn read_cases(impl_: &ProfileImpl, pv: &ProfileVectors, stream: &[u8]) {
    for c in &pv.reads {
        let state = conv::to_mapper_state(&c.state);
        let short = usize::try_from(c.rom_short_by).expect("rom_short_by razoable");
        let rom = &stream[..stream.len() - short];
        let got = (impl_.read)(c.cpu_address as u32, c.length.max(0) as u32, &state, rom);
        if let Some(code) = &c.expect_error {
            match got {
                Err(e) => assert_eq!(e.code, conv::code(code), "{} / {}", impl_.id, c.name),
                Ok(segs) => panic!(
                    "{} / {}: agardábase erro {code}, read devolve {:?}",
                    impl_.id,
                    c.name,
                    segs.len()
                ),
            }
            continue;
        }
        let segs = match got {
            Ok(s) => s,
            Err(e) => panic!("{} / {}: read fallou {e:?}", impl_.id, c.name),
        };
        assert_eq!(
            segs.len(),
            c.segments.len(),
            "{} / {}: reconto de segmentos",
            impl_.id,
            c.name
        );
        for (got, want) in segs.iter().zip(c.segments.iter()) {
            let expected = match (want.error.as_deref(), &want.region) {
                (Some(_), None) => Segment::Invalid(AddressingError::new(
                    conv::code(want.error.as_deref().unwrap()),
                    "",
                )),
                (Some(code), Some(region)) => Segment::DeviceNoBacking {
                    region: conv::region(region),
                    offset: conv::u32(want.offset.expect("offset da rexión")),
                    error_code: conv::code(code),
                },
                (None, Some(region)) => Segment::Bytes {
                    region: conv::region(region),
                    offset: conv::u32(want.offset.expect("offset dos bytes")),
                    bytes: want.bytes.clone().expect("bytes_hex"),
                },
                _ => panic!("{} / {}: segmento sen forma", impl_.id, c.name),
            };
            match (&expected, got) {
                (Segment::Invalid(w), Segment::Invalid(g)) => {
                    assert_eq!(g.code, w.code, "{} / {}", impl_.id, c.name)
                }
                (
                    Segment::DeviceNoBacking {
                        region: wr,
                        offset: wo,
                        error_code: we,
                    },
                    Segment::DeviceNoBacking {
                        region: gr,
                        offset: go,
                        error_code: ge,
                    },
                ) => {
                    assert_eq!((gr, go, ge), (wr, wo, we), "{} / {}", impl_.id, c.name)
                }
                (
                    Segment::Bytes {
                        region: wr,
                        offset: wo,
                        bytes: wb,
                    },
                    Segment::Bytes {
                        region: gr,
                        offset: go,
                        bytes: gb,
                    },
                ) => {
                    assert_eq!((gr, go), (wr, wo), "{} / {}", impl_.id, c.name);
                    // O xerador só pinaba os 32 primeiros bytes de cada corredor
                    // (`bytes_hex`): a comparación é de prefixo, e o corredor
                    // devolto debe ser polo menos tan longo como o esperado.
                    assert!(
                        gb.len() >= wb.len(),
                        "{} / {}: corredor de {} bytes, esperado pinaba {} de prefixo",
                        impl_.id,
                        c.name,
                        gb.len(),
                        wb.len()
                    );
                    assert_eq!(&gb[..wb.len()], &wb[..], "{} / {}", impl_.id, c.name)
                }
                _ => panic!(
                    "{} / {}: clase de segmento esperada {expected:?}, atopada {got:?}",
                    impl_.id, c.name
                ),
            }
        }
    }
}

/// Segunda referencia, con código distinto: o perfil é aritmética pechada; o
/// motor é un matcher de táboas declarativas (ou a táboa de páxinas de GPGX).
fn oracle_cross_check(impl_: &ProfileImpl, pv: &ProfileVectors) {
    let mut cases: Vec<RefCase> = pv
        .translate
        .iter()
        .map(|c| RefCase {
            name: c.name.clone(),
            cpu_address: c.cpu_address,
            state: c.state.clone(),
        })
        .chain(pv.negatives.iter().map(|c| RefCase {
            name: c.name.clone(),
            cpu_address: c.cpu_address,
            state: c.state.clone(),
        }))
        .collect();
    let todos = cases.clone();
    cases.retain(|c| {
        c.cpu_address > windows_engine::BUS_LIMIT || state_is_modelable(impl_.id, &c.state)
    });
    let sen_modelo: Vec<&RefCase> = todos
        .iter()
        .filter(|t| {
            !cases
                .iter()
                .any(|k| k.name == t.name && k.cpu_address == t.cpu_address)
        })
        .collect();
    let mut graded = 0usize;
    for c in &cases {
        let state = conv::to_mapper_state(&c.state);
        let got = (impl_.translate)(c.cpu_address as u32, &state);
        if c.cpu_address > windows_engine::BUS_LIMIT {
            assert!(
                matches!(&got, Translate::Invalid(e) if e.code == ErrorCode::OutOfRange),
                "{}: {} non rexeita un enderezo fóra do barramento",
                impl_.id,
                c.name
            );
            graded += 1;
            continue;
        }
        let rom_size = c.state.rom_size().unwrap_or(pv.fixture.rom_size);
        match reference(impl_.id, rom_size, &c.state).translate(c.cpu_address) {
            Engine::Ok { region, offset } => assert_eq!(
                got,
                expect_translate(&region, offset),
                "{}: perfil e referencia difiren en {:#x} ({})",
                impl_.id,
                c.cpu_address,
                c.name
            ),
            Engine::Err(code) => assert!(
                matches!(&got, Translate::Invalid(e) if e.code == conv::code(&code)),
                "{}: perfil {got:?} vs referencia {code} en {:#x} ({})",
                impl_.id,
                c.cpu_address,
                c.name
            ),
        }
        graded += 1;
    }
    assert!(
        graded >= pv.translate.len(),
        "{}: a referencia só cubriu {graded} dos {} translate",
        impl_.id,
        pv.translate.len()
    );
    println!(
        "{}: referencia independente — {graded} casos graduados, {} sen modelo ({} )",
        impl_.id,
        sen_modelo.len(),
        sen_modelo
            .iter()
            .map(|c| c.name.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    );
}

#[derive(Clone)]
struct RefCase {
    name: String,
    cpu_address: u64,
    state: RawState,
}

/// Mostras de `a` para o barrido de inversión: tocan os dous bordes de cada
/// metade e os limiares propios das xanelas (`0x6000`/`0x7FFF` de SRAM,
/// `0x8000` da metade alta), así que todo banco ve as súas clases de xanela.
const INVERT_SWEEP_A: [u64; 16] = [
    0x0000, 0x0001, 0x1fff, 0x2000, 0x5fff, 0x6000, 0x7fff, 0x8000, 0x8001, 0xa55a, 0xbfff, 0xc000,
    0xdfff, 0xe000, 0xfffe, 0xffff,
];

/// Segunda referencia para `invert`. `invert_cases` compara a lista co vector
/// pinado e **retraduce cada alias co propio perfil**, que é autofluxo: proba
/// coherencia interna, non corrección. Aquí o esperado derívase do motor de
/// xanelas, en dúas direccións:
/// - **sonancia**: cada alias que o perfil devolve ten que ser, segundo o motor,
///   unha ROM co offset pedido. Isto é o que rexeita a fórmula de HiROM anterior
///   a 2026-09-25, que inventaba aliases `start + 0x8000 + rel`.
/// - **completude en mostras**: para cada enderezo do barrido que o motor
///   clasifica como ROM, ese enderezo ten que estar na lista do perfil para o
///   offset que o motor calcula. Un alias perdido vese aquí, non na retradución.
///
/// A completude **exaustiva** (os 16,7M de enderezos) está en `tests/inversion.rs`.
fn invert_oracle_cross_check(impl_: &ProfileImpl, pv: &ProfileVectors) {
    let fixture_size = pv.fixture.rom_size;
    let mut pairs: Vec<(u64, RawState, String)> = Vec::new();
    for c in &pv.invert {
        if let (ExpectInv::Aliases(_), RawValue::Uint(offset)) = (&c.expect, &c.rom_offset) {
            if state_is_modelable(impl_.id, &c.state) {
                pairs.push((*offset, c.state.clone(), c.name.clone()));
            }
        }
    }
    for s in &pv.invert_samples {
        pairs.push((
            s.rom_offset,
            RawState::plain(fixture_size),
            format!("mostra {:#x}", s.rom_offset),
        ));
    }
    assert!(
        !pairs.is_empty(),
        "{}: sen pares (offset, estado) modelables a sonancia non se proba",
        impl_.id
    );

    let mut graded_aliases = 0usize;
    for (offset, state, label) in &pairs {
        let rom_size = state.rom_size().unwrap_or(fixture_size);
        let engine = reference(impl_.id, rom_size, state);
        let aliases = (impl_.invert)(conv::u32(*offset), &conv::to_mapper_state(state))
            .unwrap_or_else(|e| panic!("{} / {label}: invert fallou {e:?}", impl_.id));
        for alias in &aliases {
            assert_eq!(
                engine.translate(u64::from(*alias)),
                Engine::Ok {
                    region: "rom".into(),
                    offset: *offset,
                },
                "{}: {label}: o alias {alias:#x} non é ROM desas offset segundo o motor",
                impl_.id,
            );
            graded_aliases += 1;
        }
    }

    // Un barrido por estado distinto (os casos pinados comparten estados).
    let mut vistos: Vec<String> = Vec::new();
    let mut sweep_hits = 0usize;
    for (_, state, _) in &pairs {
        let key = format!("{state:?}");
        if vistos.contains(&key) {
            continue;
        }
        vistos.push(key);
        let rom_size = state.rom_size().unwrap_or(fixture_size);
        let engine = reference(impl_.id, rom_size, state);
        let mapper = conv::to_mapper_state(state);
        for bank in 0..=0xffu64 {
            for a in INVERT_SWEEP_A {
                let addr = (bank << 16) | a;
                let Engine::Ok { region, offset } = engine.translate(addr) else {
                    continue;
                };
                if region != "rom" {
                    continue;
                }
                let aliases = (impl_.invert)(conv::u32(offset), &mapper)
                    .unwrap_or_else(|e| panic!("{}: invert({offset:#x}) fallou {e:?}", impl_.id));
                assert!(
                    aliases.contains(&conv::u32(addr)),
                    "{}: enderezo {addr:#x} ({bank:#04x}:{a:#06x}) é ROM de offset {offset:#x} \
                     segundo o motor e o perfil non o lista ({} aliases: {aliases:?})",
                    impl_.id,
                    aliases.len(),
                );
                sweep_hits += 1;
            }
        }
    }
    assert!(
        sweep_hits >= 256,
        "{}: o barrido de inversión só tocou {sweep_hits} ROMs; agardábanse >= 256 (un por banco)",
        impl_.id,
    );
    assert!(
        graded_aliases >= pv.invert.len(),
        "{}: a sonancia só gradou {graded_aliases} aliases de {} casos",
        impl_.id,
        pv.invert.len(),
    );
}

fn reference(profile: &str, rom_size: u64, state: &RawState) -> Reference {
    if profile == "md-ssf2" {
        let banks = state.bank_pairs().unwrap_or_default();
        return Reference::Ssf2(Box::new(Ssf2Engine::new(rom_size, &banks)));
    }
    Reference::Table(windows_engine::table_for(profile, rom_size))
}

enum Reference {
    Table(windows_engine::Table),
    Ssf2(Box<Ssf2Engine>),
}

impl Reference {
    fn translate(&self, addr: u64) -> Engine {
        match self {
            Reference::Table(t) => t.translate(addr),
            Reference::Ssf2(e) => e.translate(addr),
        }
    }
}

/// `true` cando o motor de referencia pode modelar o estado (enteiro, dentro do
/// intervalo de tamaños do perfil, bancos ben formados). Os demais gradanse só
/// contra o perfil: son casos de *política* de estado, non de aritmética.
fn state_is_modelable(profile: &str, state: &RawState) -> bool {
    if !state.present {
        return false;
    }
    match state.rom_size() {
        Some(n) if windows_engine::models_size(profile, n) => {}
        _ => return false,
    }
    if let Some(banks) = &state.banks_raw {
        // O `Ssf2Engine` modela a táboa de páxinas do hardware, onde o slot 0
        // é inerte; o contrato, en cambio, **rexeita** un estado que pida
        // remapear a xanela fixa ou unha inexistente. Eses casos son de
        // política de estado e gradan só contra o perfil.
        let domain = match profile {
            "md-ssf2" => 1..=7u64,
            _ => 0..=u64::MAX,
        };
        if banks.iter().any(|(k, v)| {
            !matches!(k.parse::<u64>(), Ok(w) if domain.contains(&w))
                || !matches!(v, RawValue::Uint(_))
        }) {
            return false;
        }
    }
    // Só `md-ssf2` coñece `banks` como estado; nos demais perfis esa clave é un
    // rexeitamento de política que o motor de xanelas non modela.
    state
        .entries
        .iter()
        .all(|(k, _)| k == "rom_size" || (k == "banks" && profile == "md-ssf2"))
}
