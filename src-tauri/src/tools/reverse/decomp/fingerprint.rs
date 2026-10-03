//! Fingerprint de funções: SHA-256 dos bytes de `.text` por função do ground truth
//! (symbol table), formando um índice `hash -> identidade` no espírito do
//! `fingerprint_v2.sh` do spike, aqui embutido no núcleo da Fase 0.

use serde::{Deserialize, Serialize};

use super::symbols::FunctionRange;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FunctionFingerprint {
    pub addr: u32,
    pub size: u32,
    pub name: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FingerprintIndex {
    pub functions: Vec<FunctionFingerprint>,
    pub unique_hashes: usize,
    pub colliding_hashes: usize,
    /// Funções ignoradas (range fora da ROM ou tamanho zero).
    pub skipped: usize,
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    crate::core::rom_mastering::sha256_hex(bytes)
}

/// Indexa os bytes de cada função do ground truth dentro da ROM. Funções com range
/// vazio ou que ultrapassem o tamanho da ROM são contadas como `skipped` (nunca
/// silenciosamente truncadas).
pub fn build_fingerprint_index(rom: &[u8], ranges: &[FunctionRange]) -> FingerprintIndex {
    let mut functions = Vec::new();
    let mut skipped = 0usize;
    for range in ranges {
        if range.size == 0 {
            skipped += 1;
            continue;
        }
        let start = range.addr as usize;
        let end = match start.checked_add(range.size as usize) {
            Some(end) if end <= rom.len() => end,
            _ => {
                skipped += 1;
                continue;
            }
        };
        functions.push(FunctionFingerprint {
            addr: range.addr,
            size: range.size,
            name: range.name.clone(),
            sha256: sha256_hex(&rom[start..end]),
        });
    }

    let mut hashes: Vec<&str> = functions
        .iter()
        .map(|function| function.sha256.as_str())
        .collect();
    hashes.sort_unstable();
    let duplicate_count = hashes
        .windows(2)
        .filter(|window| window[0] == window[1])
        .count();
    let unique_hashes = hashes.len() - duplicate_count;
    let colliding_hashes = functions.len() - unique_hashes;

    FingerprintIndex {
        functions,
        unique_hashes,
        colliding_hashes,
        skipped,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_matches_known_vector() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn fingerprints_functions_and_counts_collisions() {
        let mut rom = vec![0u8; 0x40];
        rom[0x00..0x10].copy_from_slice(&[1u8; 16]);
        rom[0x10..0x20].copy_from_slice(&[2u8; 16]);
        rom[0x20..0x30].copy_from_slice(&[1u8; 16]); // identico à função 0 -> colisão
        let ranges = vec![
            FunctionRange {
                addr: 0x00,
                size: 0x10,
                name: "fna".to_string(),
            },
            FunctionRange {
                addr: 0x10,
                size: 0x10,
                name: "fnb".to_string(),
            },
            FunctionRange {
                addr: 0x20,
                size: 0x10,
                name: "fnc".to_string(),
            },
            FunctionRange {
                addr: 0x30,
                size: 0x40,
                name: "fn_out_of_rom".to_string(),
            }, // skipped
        ];
        let index = build_fingerprint_index(&rom, &ranges);
        assert_eq!(index.functions.len(), 3);
        assert_eq!(index.skipped, 1);
        assert_eq!(index.unique_hashes, 2);
        assert_eq!(index.colliding_hashes, 1);
        assert_ne!(index.functions[0].sha256, index.functions[1].sha256);
        assert_eq!(index.functions[0].sha256, index.functions[2].sha256);
    }

    #[test]
    fn zero_size_functions_are_skipped() {
        let index = build_fingerprint_index(
            &[0u8; 16],
            &[FunctionRange {
                addr: 0x10,
                size: 0,
                name: "empty".to_string(),
            }],
        );
        assert_eq!(index.functions.len(), 0);
        assert_eq!(index.skipped, 1);
    }
}
