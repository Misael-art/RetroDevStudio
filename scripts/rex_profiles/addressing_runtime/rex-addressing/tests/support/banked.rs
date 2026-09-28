//! Fixture autoral cun contido **identificable por banco e por offset**.
//!
//! Existe para que a capa de recursos poida ser auditada sen chamala a ela:
//! `byte_at(i)` é unha función pechada do **desprazamento físico** que un test
//! calcula a man, e `translate()` do produto non interveñen nela. Así, unha
//! lectura que devolva bytes do banco equivocado, do offset equivocado ou dun
//! espello mal resolto produce un vector distinto, non un falso negativo.
//!
//! O deseño deliberado: cada byte mestura tres escalas (offset, bloques de
//! 256, bloques de 64 KB), así que **todos** os erros que a capa de recursos
//! pode cometer cambian cada byte do corredor: desprazarse un byte, desprazarse
//! 256, trocar o banco dunha xanela de 512 KB, saltar ao espello de `rom_size`
//! ou cruzar a fronteira de área de 4 MB. Unha soa das escalas sería eludible
//! por un erro que caia xusto no seu período.

/// Banco de 512 KB que contén o desprazamento `i` (a unidade que SSF2 remapea).
pub const BANK: usize = 0x8_0000;

/// Byte esperado na posición física `i` da imaxe. Oráculo: función pechada,
/// sen estado, sen enderezamento, sen chamada á biblioteca.
pub fn byte_at(i: usize) -> u8 {
    let i = i as u64;
    i.wrapping_mul(37)
        .wrapping_add((i >> 8).wrapping_mul(0x5B))
        .wrapping_add((i >> 16).wrapping_mul(0x2F)) as u8
}

/// Imaxe completa de `len` bytes co padrón de [`byte_at`].
pub fn image(len: usize) -> Vec<u8> {
    (0..len).map(byte_at).collect()
}

/// Vector de bytes esperado no corredor físico `[from, from + n)`.
pub fn expect(from: usize, n: usize) -> Vec<u8> {
    (from..from + n).map(byte_at).collect()
}

/// Duas posicións físicas distintas nunca poden dar o mesmo byte se caen dentro
/// dos primeiros 64 KB e difiren en menos de 256: comprobación de que a fixture
/// **non é degenerada** (un fixture que non discrimina invalida toda a
/// evidencia construída sobre el).
#[allow(dead_code)]
pub fn discrimina(from_a: usize, from_b: usize, n: usize) -> bool {
    expect(from_a, n) != expect(from_b, n)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fixture_non_e_degenerada_incluso_antes_de_lectura() {
        // Mesma posición en dous bancos distintos → bytes distintos.
        assert_ne!(byte_at(0x0_0100), byte_at(0x8_0100));
        // Dous offsets do mesmo banco → distintos mentres a posición cambie.
        assert_ne!(byte_at(0x0_0100), byte_at(0x0_0101));
        // Un espello de 512 KB (offset + rom_size) non coincide co orixinal.
        for base in [0usize, 0x8_0000, 0x10_0000, 0x28_0000] {
            assert!(discrimina(base + 0x1000, base + 0x9000, 32));
        }
        // …e tampouco un banco trocado por identidade.
        assert!(discrimina(0x0_0000, 0x28_0000, 64));
    }
}
