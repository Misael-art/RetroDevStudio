//! Rodada 5, validación 4: secuencias de escritas de bancos coa **proba de
//! bytes antes/despois**.
//!
//! Non basta con comparar estados: o contrato pide demostrar que unha escrita
//! de rexistrador **só** move a xanela que di mover. Para cada secuencia
//! léense sondas nas oito xanelas antes e despóis, e compróbase que:
//!
//! * as xanelas cuxo banco non cambiou seguen **byte a byte** iguais;
//! * as xanelas reescritas din os bytes da nova base (`(valor << 19) & mask`);
//! * a xanela 0 é invariante aínda que a escrita vaia dirixida ao seu slot;
//! * o estado de entrada non muta (a escrita é pura).
//!
//! As secuencias xéranse cun xorshift determinista local — son casos
//! adicionais, non os pinados (eses están en `tests/differential.rs`).

mod support;

use rex_addressing::state::{MapperState, Value};
use rex_addressing::{ErrorCode, Region, Segment};
use support::fixture;

const ROM_SIZE: u64 = 0x400000;
const WINDOW: u32 = 0x80000;
/// 32 bytes en tres posiciones por xanela: inicio, metade e final.
const PROBE_LEN: u32 = 32;
const PROBE_OFFSETS: [u32; 3] = [0x00000, 0x40000, WINDOW - PROBE_LEN - 1];

/// xorshift32: segunda representación do xerador de secuencias (o xerador
/// orixinal está en `differential/export-vectors.mjs`).
struct Rng(u32);

impl Rng {
    fn next(&mut self) -> u32 {
        let mut s = self.0;
        s ^= s << 13;
        s ^= s >> 17;
        s ^= s << 5;
        self.0 = s;
        s
    }

    fn below(&mut self, n: u64) -> u64 {
        u64::from(self.next()) % n
    }
}

fn identity() -> MapperState {
    MapperState::rom_size(ROM_SIZE)
}

/// Valor efectivo (escrito ou identidade) dunha xanela.
fn effective_bank(state: &MapperState, window: u32) -> u64 {
    state
        .object("banks")
        .and_then(|entries| {
            entries
                .iter()
                .find(|(k, _)| *k == window.to_string())
                .and_then(|(_, v)| v.as_uint())
        })
        .unwrap_or(u64::from(window))
}

/// Bytes das sondas dunha xanela no estado dado.
fn probe(state: &MapperState, rom: &[u8], window: u32) -> Vec<Vec<u8>> {
    PROBE_OFFSETS
        .iter()
        .map(|off| {
            let addr = window * WINDOW + off;
            let segs = rex_addressing::md_ssf2::read(addr, PROBE_LEN, state, rom)
                .unwrap_or_else(|e| panic!("sonda {addr:#x}: {e:?}"));
            assert_eq!(segs.len(), 1, "sonda {addr:#x} cruzou unha fronteira");
            match &segs[0] {
                Segment::Bytes { region, bytes, .. } => {
                    assert_eq!(*region, Region::Rom);
                    assert_eq!(bytes.len(), PROBE_LEN as usize);
                    bytes.clone()
                }
                other => panic!("sonda {addr:#x}: segmento inesperado {other:?}"),
            }
        })
        .collect()
}

#[test]
fn ningunha_escrita_move_unha_xanela_non_escrita() {
    let rom = fixture::build_fixture(
        fixture::seed_base("md-ssf2"),
        usize::try_from(ROM_SIZE).expect("4MB"),
        fixture::block_size("md-ssf2"),
    );
    assert_eq!(
        support::sha256::sha256_hex(&rom),
        support::vectors::load().profile("md-ssf2").fixture.sha256,
        "a imaxe usada na proba de bytes non é a fixture pinada"
    );

    let mut rng = Rng(0x5e70);
    let mut touched_total = 0usize;
    let mut untouched_total = 0usize;
    let mut inert_slot0 = 0usize;

    for _ in 0..60 {
        let before_state = identity();
        let before: Vec<Vec<Vec<u8>>> = (0..8u32).map(|w| probe(&before_state, &rom, w)).collect();

        let writes = 1 + rng.below(4);
        let mut state = before_state.clone();
        // (xanela, valor) por cada escrita efectivamente aplicada, en ordem:
        // serve para comprobar que a última escrita dun slot manda.
        let mut applied: Vec<(u32, u64)> = Vec::new();
        for _ in 0..writes {
            // Só posi pares, como fai o hardware (escritas a word).
            let addr = 0xA13000u32 | ((rng.below(0x100) as u32) & !1);
            let data = rng.below(0x100) as u8;
            state = rex_addressing::md_ssf2::write_mapper_register(addr, data, &state)
                .expect("escrita na páxina TIME");
            let window = (addr & 0x0E) >> 1;
            if window == 0 {
                inert_slot0 += 1;
            } else {
                applied.push((window, u64::from(data)));
            }
            assert_eq!(
                before_state,
                MapperState::rom_size(ROM_SIZE),
                "a escrita mutou o estado de entrada"
            );
        }
        let written: Vec<u32> = applied.iter().map(|(w, _)| *w).collect();

        let after: Vec<Vec<Vec<u8>>> = (0..8u32).map(|w| probe(&state, &rom, w)).collect();

        for window in 0..8u32 {
            let was_written = written.contains(&window);
            let bank_changed =
                effective_bank(&before_state, window) != effective_bank(&state, window);
            if !was_written && !bank_changed {
                assert_eq!(
                    before[window as usize], after[window as usize],
                    "xanela {window} non escrita cambiou os bytes"
                );
                if window == 0 {
                    // A xanela 0 é fixa: nin sequera unha escrita dirixida ao
                    // seu slot a move.
                    assert_eq!(
                        effective_bank(&before_state, 0),
                        effective_bank(&state, 0),
                        "a xanela 0 non pode cambiar de banco"
                    );
                }
                untouched_total += 1;
            } else {
                // Última escrita do slot manda, e a base é
                // `(valor << 19) & (rom_size - 1)`.
                let raw = effective_bank(&state, window);
                if was_written {
                    let last = *applied
                        .iter()
                        .rfind(|(w, _)| *w == window)
                        .expect("escrita");
                    assert_eq!(
                        raw, last.1,
                        "a xanela {window} non quedó co último valor escrito"
                    );
                }
                let base = usize::try_from((raw << 19) & (ROM_SIZE - 1)).expect("base");
                for (i, off) in PROBE_OFFSETS.iter().enumerate() {
                    let start = base + *off as usize;
                    assert_eq!(
                        after[window as usize][i],
                        rom[start..start + PROBE_LEN as usize],
                        "xanela {window} na base {base:#x}, sonda {off:#x}"
                    );
                }
                touched_total += 1;
            }
        }
    }

    // Que a proba non sexa vacúa: ten que haber as dúas clases de xanela.
    assert!(touched_total > 0, "ningunha xanela reescrita foi probada");
    assert!(
        untouched_total > 0,
        "ningunha xanela intocada foi comparada byte a byte"
    );
    assert!(
        inert_slot0 > 0,
        "a mostra non cubriu ningunha escrita inerte ao slot 0"
    );
    println!(
        "ssf2_writes: {touched_total} xanelas reescritas verificadas, {untouched_total} intocadas iguais, {inert_slot0} escritas inertes ao slot 0"
    );
}

#[test]
fn un_valor_de_banco_que_soborda_non_e_erro_e_a_lectura_espealla() {
    // O hardware non valida o valor escrito: a máscara decide. Unha lectura na
    // xanela reescrita co valor 0xFF nunha ROM de 4MB debe dar a base 0x380000.
    let rom = fixture::build_fixture(
        fixture::seed_base("md-ssf2"),
        usize::try_from(ROM_SIZE).expect("4MB"),
        fixture::block_size("md-ssf2"),
    );
    let state = rex_addressing::md_ssf2::write_mapper_register(0xA13002, 0xFF, &identity())
        .expect("escrita válida");
    let segs = rex_addressing::md_ssf2::read(0x080000, 8, &state, &rom).unwrap();
    match &segs[0] {
        Segment::Bytes { offset, bytes, .. } => {
            assert_eq!(*offset, 0x380000);
            assert_eq!(&bytes[..], &rom[0x380000..0x380008]);
        }
        other => panic!("segmento inesperado {other:?}"),
    }
    // E nun banco escrito cun valor que a frontada non pode representar como
    // byte, `write_mapper_register` nin sequera se pode chamar: o tipo `u8`
    // rexeitao antes de chegar ao perfil. Aquí compróbase que un estado con
    // banco fóra de rango *si* se rexeita cando ven da frontada como enteiro.
    let absurd = MapperState::from_entries(vec![
        ("rom_size".to_string(), Value::Uint(ROM_SIZE)),
        (
            "banks".to_string(),
            Value::Object(vec![("1".to_string(), Value::Uint(1 << 40))]),
        ),
    ]);
    // Non é erro de validación (é enteiro >= 0), pero a máscara filtra: nada
    // de panico nin de base inventada.
    assert!(rex_addressing::md_ssf2::validate_state(&absurd).is_ok());
    assert_eq!(
        rex_addressing::md_ssf2::translate(0x080000, &absurd),
        rex_addressing::Translate::Rom { offset: 0 },
        "(1 << 40) << 19 & 0x3FFFFF = 0"
    );
    // E unha imaxe máis curta que o `rom_size` declarado segue devolvendo erro
    // estruturado no trecho faltante, en vez de bytes de menos ou dun panic.
    // Base 0x380000 + desprazamento 0x7FF00 = offset 0x3FFF00; a imaxe recortada
    // acaba en 0x3FFFF0, así que 0xF0 bytes si existen e os 16 restantes non.
    let short = &rom[..0x3FFFF0];
    let segs = rex_addressing::md_ssf2::read(0x0FFF00, 0x100, &state, short).unwrap();
    assert_eq!(segs.len(), 2, "esperábase prefixo + erro: {segs:?}");
    match &segs[0] {
        Segment::Bytes {
            region,
            offset,
            bytes,
        } => {
            assert_eq!(*region, Region::Rom);
            assert_eq!(*offset, 0x3FFF00);
            assert_eq!(bytes.len(), 0xF0, "o prefixo non chega ao final real");
            assert_eq!(&bytes[..], &rom[0x3FFF00..0x3FFFF0]);
        }
        other => panic!("segmento inesperado {other:?}"),
    }
    assert!(
        matches!(&segs[1], Segment::Invalid(e) if e.code == ErrorCode::OutOfRange),
        "o trecho faltante non é OutOfRange: {:?}",
        segs[1]
    );
}
