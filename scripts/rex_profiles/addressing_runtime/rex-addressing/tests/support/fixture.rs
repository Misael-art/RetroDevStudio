// Reprodución do stream de bytes das fixtures autorais, a partir da
// especificación declarada no propio ficheiro de vectores
// (`fixture_prng_spec`): xorshift32 con semente por bloque.
//
// Non importa código de `build-fixtures.mjs`: reimplementación da fórmula
// publicada. A verificación de que o stream é o mesmo faese por SHA-256 do
// bloque xerado contra `fixture.sha256` (os dous camiños só comparten a
// especificación, non a implementación).

use super::sha256::sha256_hex;

pub const DEFAULT_BLOCK: usize = 65536;
pub const LOROM_BLOCK: usize = 32768;

/// Semente inicial dun bloque: `(seedBase ^ imul(i+1, 0x9e3779b9))`, con 0
/// substituído por 0x9e3779b9 (como publica o spec dos vectores).
fn block_seed(seed_base: u32, block_index: usize) -> u32 {
    let mixed = seed_base ^ (block_index as u32).wrapping_add(1).wrapping_mul(0x9e37_79b9);
    if mixed == 0 {
        0x9e37_79b9
    } else {
        mixed
    }
}

fn xorshift_next(s: &mut u32) -> u32 {
    let mut x = *s;
    x ^= x.wrapping_shl(13);
    x ^= x >> 17;
    x ^= x.wrapping_shl(5);
    *s = x;
    x >> 24
}

/// Stream completo dunha fixture: `size` bytes, PRNG reiniciado cada `block`.
pub fn build_fixture(seed_base: u32, size: usize, block: usize) -> Vec<u8> {
    let mut out = vec![0u8; size];
    let blocks = size.div_ceil(block);
    for b in 0..blocks {
        let mut state = block_seed(seed_base, b);
        let start = b * block;
        let end = usize::min(start + block, size);
        for slot in out.iter_mut().take(end).skip(start) {
            *slot = xorshift_next(&mut state) as u8;
        }
    }
    out
}

/// SHA-256 do stream, para comparar co `fixture.sha256` pinado.
pub fn fixture_sha(seed_base: u32, size: usize, block: usize) -> String {
    sha256_hex(&build_fixture(seed_base, size, block))
}

/// Bases de semente por perfil, tal como as declara `fixture_prng_spec`.
pub fn seed_base(profile: &str) -> u32 {
    match profile {
        "md-linear" => 0x4d44_4d44,
        "md-ssf2" => 0x5546_322d,
        "snes-lorom" => 0x4c4f_524d,
        "snes-hirom" => 0x4849_524d,
        "snes-exhirom" => 0x4558_4849,
        other => panic!("perfil sen base de semente publicada: {other}"),
    }
}

pub fn block_size(profile: &str) -> usize {
    match profile {
        "snes-lorom" => LOROM_BLOCK,
        _ => DEFAULT_BLOCK,
    }
}
