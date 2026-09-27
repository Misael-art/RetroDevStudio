// Auto-comprobación do banco de pruebas ANTES de empregar para gradedar nada.
//
// Se o cargador de vectores, o SHA-256, o PRNG da fixture ou o motor de
// referencia estiveren mal, calquera comparison posterior daría falsos PASS.
// Este ficheiro non toca o crate: só verifica que o esperado é o esperado.

mod support;

use support::fixture;
use support::vectors::{
    self, ExpectTx, RawState, NEGATIVES_REGION_GRADED, NEGATIVES_TOTAL, TRANSLATE_OK,
};
use support::windows_engine::{self, Engine, Ssf2Engine, Table};

#[test]
fn vectores_embebidos_teñen_a_sha_e_a_version_pinadas() {
    let set = vectors::load();
    assert_eq!(set.profiles.len(), 5);
    assert_eq!(set.contract_version, 1);
    // `load()` comproba a SHA-256 con assert antes de devolver nada.
}

#[test]
fn cada_stream_de_fixture_reproduce_o_sha_pinado() {
    let set = vectors::load();
    for p in &set.profiles {
        let size = usize::try_from(p.fixture.rom_size).expect("rom_size razoable");
        let computed =
            fixture::fixture_sha(fixture::seed_base(&p.name), size, fixture::block_size(&p.name));
        assert_eq!(
            computed, p.fixture.sha256,
            "o PRNG reimplementado non reproduce a fixture pinada de {}",
            p.name
        );
    }
}

#[test]
fn as_amostras_de_inversion_estan_dentro_da_rom_pinada() {
    let set = vectors::load();
    for p in &set.profiles {
        for s in &p.invert_samples {
            assert!(
                s.rom_offset < p.fixture.rom_size,
                "{}: mostra de inversión fóra da ROM",
                p.name
            );
        }
    }
}

/// O motor de referencia debe dar **el só** os 101 `expect` positivos de
/// `translate`. É a comprobación de que a segunda referencia está ben antes de
/// usala para gradedar a implementación Rust.
#[test]
fn o_motor_de_referencia_reproduce_tódolos_translate_positivos() {
    let set = vectors::load();
    let mut checked = 0usize;
    for p in &set.profiles {
        for c in &p.translate {
            let ExpectTx::Ok { region, offset } = &c.expect else {
                panic!("{} / {}: translate con esperado de erro", p.name, c.name);
            };
            let got = Reference::for_case(&set, &p.name, &c.state).translate(c.cpu_address);
            assert_eq!(
                got,
                Engine::Ok {
                    region: region.clone(),
                    offset: *offset,
                },
                "{} / {}: o motor de referencia difire do esperado pinado",
                p.name,
                c.name
            );
            checked += 1;
        }
    }
    assert_eq!(checked, TRANSLATE_OK, "casos positivos perdidos");
}

/// Dos 50 negativos, os que son de **clasificación de rexión** compáranse co
/// motor de referencia; os que son de validación de estado non son modelables
/// por el (o motor non valida estados) e gradáanse só contra o crate. O
/// reparto está pinado: se calquera lado cambia, o reconto falla.
#[test]
fn o_motor_de_referencia_coincide_cos_negativos_de_rexiaon() {
    let set = vectors::load();
    let mut graded = 0usize;
    let mut state_only = 0usize;
    for p in &set.profiles {
        for c in &p.negatives {
            let engine = Reference::for_case(&set, &p.name, &c.state);
            match engine.translate(c.cpu_address) {
                Engine::Err(code) => {
                    assert_eq!(
                        code, c.expect_error,
                        "{} / {}: negativo de rexión difire do pinado",
                        p.name, c.name
                    );
                    graded += 1;
                }
                Engine::Ok { region, offset } => {
                    assert_eq!(
                        c.expect_error, "unsupported",
                        "{} / {}: o motor di {region}@{offset:x} e o esperado é {}",
                        p.name, c.name, c.expect_error
                    );
                    state_only += 1;
                }
            }
        }
    }
    assert_eq!(graded + state_only, NEGATIVES_TOTAL);
    assert_eq!(
        graded, NEGATIVES_REGION_GRADED,
        "reparto entre negativos de rexión e de estado cambiou ({graded} vs pinado)"
    );
}

/// Unha referencia, dúas formas: táboa declarativa (SNES/MD lineal) ou
/// simulación de táboa de páxinas (SSF2).
enum Reference {
    Table(Table),
    Ssf2(Ssf2Engine),
}

impl Reference {
    /// Constrúese **co estado do propio caso**. O xerador de vectores construíu
    /// o seu motor unha soa vez co estado da fixture, o que facía irrelevantes
    /// os campos `engine_agree` dos casos con estado propio (defecto rexistrado
    /// no informe da rodada 1-2); aquí corrixese sen alterar o ficheiro pinado.
    fn for_case(set: &vectors::VectorSet, profile: &str, state: &RawState) -> Reference {
        let rom_size = state
            .rom_size()
            .unwrap_or_else(|| set.profile(profile).fixture.rom_size);
        if profile == "md-ssf2" {
            let banks = state.bank_pairs().unwrap_or_default();
            return Reference::Ssf2(Ssf2Engine::new(rom_size, &banks));
        }
        Reference::Table(windows_engine::table_for(profile, rom_size))
    }

    fn translate(&self, addr: u64) -> Engine {
        match self {
            Reference::Table(t) => t.translate(addr),
            Reference::Ssf2(e) => e.translate(addr),
        }
    }
}
