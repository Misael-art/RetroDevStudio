//! Reproducao minima (sem SGDK) da divergencia de checksum do PR #84.
//!
//! O pipeline canonico grava em 0x18E o checksum SGDK/sizebnd: XOR de todas as
//! palavras da ROM exceto o proprio campo (`core::rom_mastering::sgdk_checksum`,
//! aplicado por `compiler::build_orch` apos o header do projeto). O patcher da
//! crate so conhece a soma MD aditiva (`patch::md_checksum`, mesmo algoritmo de
//! `rom_mastering::megadrive_checksum`) e so reescreve 0x18E quando ESSA soma bate
//! com o valor gravado. Numa base SGDK ela nao bate, entao o campo fica como estava
//! e deixa de valer para o XOR.

use rex_gameplay::graph::{edit_threshold, open_graph, Hints};
use rex_gameplay::patch::{md_checksum, patch_threshold, regenerate_from_graph};
use rex_gameplay::recover;
use rex_gameplay::sha256::sha256_hex;

/// Referencia independente do algoritmo SGDK (sizebnd 2.11), reescrita aqui.
fn sgdk_xor(rom: &[u8]) -> u16 {
    rom.chunks_exact(2)
        .enumerate()
        .filter(|(i, _)| *i != 0x18E / 2)
        .fold(0, |acc, (_, w)| acc ^ u16::from_be_bytes([w[0], w[1]]))
}

fn stored(rom: &[u8]) -> u16 {
    u16::from_be_bytes([rom[0x18E], rom[0x18F]])
}

fn base_with(checksum: impl Fn(&[u8]) -> u16) -> Vec<u8> {
    let path = format!(
        "{}/fixtures/goal_original_t6.hex",
        env!("CARGO_MANIFEST_DIR")
    );
    let text = std::fs::read_to_string(path).unwrap();
    let mut rom = Vec::new();
    for line in text.lines().filter(|l| !l.starts_with('#')) {
        let p: Vec<&str> = line.split_whitespace().collect();
        match p[0] {
            "rom_size" => rom = vec![0u8; p[1].parse().unwrap()],
            "at" => {
                let at = usize::from_str_radix(p[1].trim_start_matches("0x"), 16).unwrap();
                for i in (0..p[2].len()).step_by(2) {
                    rom[at + i / 2] = u8::from_str_radix(&p[2][i..i + 2], 16).unwrap();
                }
            }
            _ => {}
        }
    }
    let value = checksum(&rom);
    rom[0x18E..0x190].copy_from_slice(&value.to_be_bytes());
    rom
}

fn edit_to_12(base: &[u8]) -> (Vec<u8>, Vec<u8>, bool) {
    let rec = recover(base, 0x946, &[0x970], &Hints::default()).unwrap();
    let opened = open_graph(&edit_threshold(&rec.graph_json, 12).unwrap()).unwrap();
    let sha = sha256_hex(base);
    let patched = patch_threshold(base, &sha, &opened).unwrap();
    let regenerated = regenerate_from_graph(base, &sha, &opened).unwrap();
    assert_eq!(patched.bytes, regenerated.bytes);
    (
        patched.bytes,
        patched.changed.iter().map(|&i| i as u8).collect(),
        patched.checksum_updated,
    )
}

#[test]
fn sgdk_xor_base_keeps_a_stale_checksum_after_patch() {
    let base = base_with(sgdk_xor);
    assert_eq!(stored(&base), sgdk_xor(&base), "base valida pelo XOR SGDK");
    assert_ne!(
        Some(stored(&base)),
        md_checksum(&base),
        "e invalida pela soma MD"
    );
    let (out, _, updated) = edit_to_12(&base);
    // K = T - bias = 12 - 1 = 11: 0x961 vai de 0x05 a 0x0B.
    assert_eq!((base[0x961], out[0x961]), (0x05, 0x0B));
    assert!(
        !updated,
        "a condicao do patcher (soma MD valida na base) e falsa"
    );
    assert_eq!(stored(&out), stored(&base), "0x18E nao foi tocado");
    assert_eq!(
        sgdk_xor(&out),
        stored(&base) ^ (0x05 ^ 0x0B),
        "XOR muda so pelo byte editado"
    );
    assert_ne!(
        stored(&out),
        sgdk_xor(&out),
        "saida com checksum SGDK desatualizado"
    );
    println!(
        "base stored={:04X} xor={:04X} md={:04X?} | patch stored={:04X} xor={:04X} md={:04X?}",
        stored(&base),
        sgdk_xor(&base),
        md_checksum(&base),
        stored(&out),
        sgdk_xor(&out),
        md_checksum(&out)
    );
}

#[test]
fn md_sum_base_gets_its_checksum_updated() {
    // Controle: com base valida pela soma MD, o mesmo patch reescreve 0x18E.
    let base = base_with(|r| md_checksum(r).unwrap());
    let (out, _, updated) = edit_to_12(&base);
    assert!(updated);
    assert_eq!(Some(stored(&out)), md_checksum(&out));
}
