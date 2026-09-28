//! Propiedade de inversión **exaustiva**: o conxunto de aliases que devolve o
//! perfil ten que ser exactamente o preimage que o motor de xanelas declara
//! para ese offset, enumerando **todo** o barramento de 24 bits.
//!
//! Por que fai falta e por que vai `#[ignore]`:
//! - `differential.rs` compara cada lista co vector pinado (derivada da
//!   referencia auditada) e gradúa os aliases contra o motor, pero alí a
//!   **completude** é mostral: 16 `a` por banco. Un alias *perdido* só se
//!   descobre contra un preimage exaustivo.
//! - Ese preimage custa 16.777.216 traducións do motor por caso. Non é custo de
//!   suite: é unha proba de unha vez por rodada, cuxa saída literal se rexistra
//!   no informe de `docs/rex_profiles/addressing_runtime/`.
//!
//! Ningún esperado usa a aritmética do perfil baixo proba: as xanelas ROM léense
//! de `vectors/windows-generated.json` (procedencia de bsnes verificada por SHA)
//! e as rexións internas son táboas declarativas de `support::windows_engine`.

mod support;

use rex_addressing::state::MapperState;
use rex_addressing::AddressingError;
use support::vectors;
use support::windows_engine::{self, Engine, Ssf2Engine};

/// Barramento de 24 bits completo.
const BUS_TOP: u64 = 0xff_ffff;

struct Case {
    profile: &'static str,
    /// Estado de bancos: baleiro = identidade (SSF2 sen remapear).
    banks: &'static [(u64, u64)],
    /// Tamaño do estado baixo proba: `None` = o da fixture pinada.
    rom_size: Option<u64>,
}

/// As dúas referencias comparten sinatura de tradución; un `enum` evita o
/// despacho dinámico nunha enumeración de 16,7M de pasos.
enum Ref {
    Table(windows_engine::Table),
    Ssf2(Box<Ssf2Engine>),
}

impl Ref {
    fn new(profile: &str, rom_size: u64, banks: &[(u64, u64)]) -> Ref {
        if profile == "md-ssf2" {
            Ref::Ssf2(Box::new(Ssf2Engine::new(rom_size, banks)))
        } else {
            Ref::Table(windows_engine::table_for(profile, rom_size))
        }
    }

    fn translate(&self, addr: u64) -> Engine {
        match self {
            Ref::Table(t) => t.translate(addr),
            Ref::Ssf2(e) => e.translate(addr),
        }
    }
}

/// Despacho por id: o test non pode ter unha fórmula propia de inversión,
/// porque entón estaría a compararse consigo mesmo.
fn invert_of(profile: &str, offset: u32, state: &MapperState) -> Result<Vec<u32>, AddressingError> {
    match profile {
        "md-linear" => rex_addressing::md_linear::invert(offset, state),
        "md-ssf2" => rex_addressing::md_ssf2::invert(offset, state),
        "snes-lorom" => rex_addressing::snes_lorom::invert(offset, state),
        "snes-hirom" => rex_addressing::snes_hirom::invert(offset, state),
        "snes-exhirom" => rex_addressing::snes_exhirom::invert(offset, state),
        other => panic!("perfil {other} sen implementación"),
    }
}

fn state_of(profile: &str, rom_size: u64, banks: &[(u64, u64)]) -> MapperState {
    if profile == "md-ssf2" {
        MapperState::ssf2(rom_size, banks)
    } else {
        MapperState::rom_size(rom_size)
    }
}

/// Preimage exaustivo do motor: **todos** os enderezos do barramento que o motor
/// clasifica como ROM dun dos offsets obxectivo. Devólvense ordenados por
/// offset, coa lista de aliases en orde ascendente de enderezo.
fn preimage(engine: &Ref, targets: &[u64]) -> Vec<(u64, Vec<u64>)> {
    assert!(
        targets.windows(2).all(|w| w[0] < w[1]),
        "targets debe estar ordenado e sen duplicados"
    );
    let mut hits: Vec<(u64, u32)> = Vec::new();
    for addr in 0..=BUS_TOP {
        if let Engine::Ok { region, offset } = engine.translate(addr) {
            if region == "rom" && targets.binary_search(&offset).is_ok() {
                hits.push((offset, addr as u32));
            }
        }
    }
    hits.sort_unstable();
    let mut out: Vec<(u64, Vec<u64>)> = Vec::new();
    for (offset, addr) in hits {
        if out.last().map(|(o, _)| *o) == Some(offset) {
            out.last_mut()
                .expect("acaba de comprobarse")
                .1
                .push(addr as u64);
        } else {
            out.push((offset, vec![addr as u64]));
        }
    }
    out
}

/// Offsets obxectivo: bordos e cuartos do arquivo, máis todos os dos vectores
/// pinados. Para ExHiROM engaden un offset por área, que é onde a fórmula
/// modular da segunda área e a máscara da primeira se separan.
fn target_offsets(pv: &vectors::ProfileVectors, rom_size: u64, shift: u64) -> Vec<u64> {
    let mut v: Vec<u64> = vec![
        0,
        1,
        0x1234 % rom_size,
        (rom_size / 3) + shift,
        rom_size / 4,
        rom_size / 2,
        (rom_size / 4) * 3,
        rom_size - 1,
    ];
    for c in &pv.invert {
        if let vectors::RawValue::Uint(o) = &c.rom_offset {
            if *o < rom_size {
                v.push(*o);
            }
        }
    }
    for s in &pv.invert_samples {
        v.push(s.rom_offset % rom_size);
    }
    if pv.name == "snes-exhirom" {
        v.push(0x00_0abc);
        v.push(0x40_0000 + (shift * 0x1_0000) % (rom_size - 0x40_0000));
    }
    v.sort_unstable();
    v.dedup();
    v
}

fn run_case(case: &Case, shift: u64) -> (usize, usize) {
    let set = vectors::load();
    let pv = set.profile(case.profile);
    let rom_size = case.rom_size.unwrap_or(pv.fixture.rom_size);
    let banks: Vec<(u64, u64)> = case.banks.to_vec();
    let engine = Ref::new(case.profile, rom_size, &banks);
    let state = state_of(case.profile, rom_size, &banks);
    let targets = target_offsets(pv, rom_size, shift);
    let want = preimage(&engine, &targets);
    let mut aliases = 0usize;
    for (offset, list) in &want {
        let got = invert_of(case.profile, *offset as u32, &state)
            .unwrap_or_else(|e| panic!("{}: invert({offset:#x}) fallou {e:?}", case.profile));
        let got: Vec<u64> = got.iter().map(|a| u64::from(*a)).collect();
        assert_eq!(
            got, *list,
            "{} / rom_size {rom_size:#x}: o preimage do motor e o perfil difiren para o offset {offset:#x} (motor {}, perfil {})",
            case.profile,
            list.len(),
            got.len(),
        );
        // Sonancia: cada alias que o perfil devolve está no preimage do motor.
        for alias in &got {
            assert_eq!(
                engine.translate(*alias),
                Engine::Ok {
                    region: "rom".into(),
                    offset: *offset,
                },
                "{}: alias {alias:#x} do offset {offset:#x} non é ROM desas offset",
                case.profile,
            );
        }
        aliases += list.len();
    }
    // Un offset obxectivo sen preimage non é un fallo: é un offset que ese estado
    // non pode enderezar (`md-ssf2` en estado identidade deixa bloqueos fóra da
    // táboa de 64 páxinas, e calquera perfil ten offsets fóra do seu `rom_size`).
    // O que si é un fallo: que o perfil *si* lle devolve aliases.
    let alcanzados: Vec<u64> = want.iter().map(|(o, _)| *o).collect();
    let mut sen_preimage = 0usize;
    for offset in &targets {
        if alcanzados.contains(offset) {
            continue;
        }
        sen_preimage += 1;
        let got = invert_of(case.profile, *offset as u32, &state)
            .unwrap_or_else(|e| panic!("{}: invert({offset:#x}) fallou {e:?}", case.profile));
        assert!(
            got.is_empty(),
            "{}: o perfil devolve {} aliases ({got:?}) para o offset {offset:#x}, que o motor non \
             endereza en ningún dos {:#x} enderezos do barramento",
            case.profile,
            got.len(),
            BUS_TOP + 1,
        );
    }
    println!(
        "{} rom_size={rom_size:#x} bancos={banks:?}: {} offsets con preimage exacto, {} aliases, \
         {} offsets sen preimage (perfil devolve lista baleira)",
        case.profile,
        want.len(),
        aliases,
        sen_preimage,
    );
    (want.len(), aliases)
}

const CASES: &[Case] = &[
    Case {
        profile: "md-linear",
        banks: &[],
        rom_size: None,
    },
    Case {
        profile: "md-ssf2",
        banks: &[],
        rom_size: None,
    },
    Case {
        profile: "md-ssf2",
        banks: &[(1, 0x20), (5, 0x33)],
        rom_size: None,
    },
    Case {
        profile: "snes-lorom",
        banks: &[],
        rom_size: None,
    },
    Case {
        profile: "snes-hirom",
        banks: &[],
        rom_size: None,
    },
    Case {
        profile: "snes-exhirom",
        banks: &[],
        rom_size: None,
    },
    // 5MB: `half2 = 1MB`, outro espello modular na segunda área.
    Case {
        profile: "snes-exhirom",
        banks: &[],
        rom_size: Some(0x50_0000),
    },
];

#[test]
#[ignore = "preimage exaustivo: 16,7M de traducións do motor por caso"]
fn cada_perfil_devolve_exactamente_o_preimage_do_motor() {
    let mut offsets = 0usize;
    let mut aliases = 0usize;
    for (idx, case) in CASES.iter().enumerate() {
        let (o, a) = run_case(case, idx as u64 + 1);
        offsets += o;
        aliases += a;
    }
    assert!(
        offsets >= CASES.len() * 8 && aliases > 0,
        "proba vacua: {offsets} offsets / {aliases} aliases",
    );
    println!(
        "TOTAL exaustivo: {} casos, {offsets} offsets, {aliases} aliases de preimage exactos",
        CASES.len(),
    );
}
