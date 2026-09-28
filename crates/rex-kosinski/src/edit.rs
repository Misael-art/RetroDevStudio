//! Contêiner de edição autoral (ENCODE-CONTRACT §9) — prova de contrato,
//! NÃO transação canônica de produção. Módulo puro sobre slices: sem Tauri,
//! sem filesystem, sem realocação/ponteiros; só o slot e os campos que
//! descrevem conteúdo mudam (política 3 retificada).
//!
//! Layout: `[8B "REXKOS0A"][plain_len u32 LE][stream_len u32 LE]
//! [slot_cap u32 LE][sha256(plain) 32B][slot: stream + padding 0x00 até
//! slot_cap][8B "REXKOS0B"]`.

use super::{decode, encode, EncError, KosError};

pub const SENTINEL_A: &[u8; 8] = b"REXKOS0A";
pub const SENTINEL_B: &[u8; 8] = b"REXKOS0B";
pub const HEADER_LEN: usize = 52;

#[derive(Debug, PartialEq, Eq)]
pub enum EditError {
    /// Sentinela, geometria ou consistência estrutural do contêiner.
    Malformed,
    /// Stream do plain excede `slot_cap` (ou `max_stream`): recusa SEM escrita (§9.5).
    StreamTooLarge,
    /// Slot não decodifica sob o contrato do decoder.
    DecodeFailed,
    /// Identidade declarada (plain_len/sha256) diverge do conteúdo decodificado (§9.6).
    IdentityMismatch,
    /// Orçamento determinístico de trabalho esgotado no encoder.
    WorkLimit,
}

#[derive(Debug)]
pub struct SlotInfo {
    pub plain_len: usize,
    pub stream_len: usize,
    pub slot_cap: usize,
    /// Plain reconstruído pelo decoder a partir do slot.
    pub plain: Vec<u8>,
}

fn u32_le(b: &[u8]) -> u32 {
    u32::from_le_bytes([b[0], b[1], b[2], b[3]])
}

fn assemble(plain: &[u8], stream: &[u8], slot_cap: usize) -> Result<Vec<u8>, EditError> {
    if stream.len() > slot_cap || plain.len() > u32::MAX as usize || slot_cap > u32::MAX as usize {
        return Err(EditError::StreamTooLarge);
    }
    let mut c = Vec::with_capacity(HEADER_LEN + slot_cap + 8);
    c.extend_from_slice(SENTINEL_A);
    c.extend_from_slice(&(plain.len() as u32).to_le_bytes());
    c.extend_from_slice(&(stream.len() as u32).to_le_bytes());
    c.extend_from_slice(&(slot_cap as u32).to_le_bytes());
    c.extend_from_slice(&sha256_bytes(plain));
    c.extend_from_slice(stream);
    c.resize(HEADER_LEN + slot_cap, 0x00); // padding explícito até slot_cap (§9.4)
    c.extend_from_slice(SENTINEL_B);
    Ok(c)
}

/// Constrói um contêiner com slot de `slot_cap` para `plain`. A stream é
/// produzida com teto `min(max_stream, slot_cap)`: se não couber, recusa sem
/// escrever (`StreamTooLarge`) — nunca há escrita parcial do contêiner.
pub fn build(
    plain: &[u8],
    slot_cap: usize,
    max_stream: usize,
    work_limit: usize,
) -> Result<Vec<u8>, EditError> {
    let teto = max_stream.min(slot_cap);
    match encode(plain, teto, work_limit) {
        Ok(e) => assemble(plain, &e.stream, slot_cap),
        Err(EncError::StreamLimit) => Err(EditError::StreamTooLarge),
        Err(EncError::WorkLimit) => Err(EditError::WorkLimit),
    }
}

/// Abre e valida o contêiner integralmente: geometria, sentinelas, decodifica
/// o slot sob o contrato do decoder e confere a identidade declarada
/// (`plain_len` e `sha256(plain)`) contra o conteúdo (§9.6).
pub fn open(container: &[u8], max_output: usize, work_limit: usize) -> Result<SlotInfo, EditError> {
    if container.len() < HEADER_LEN + 8 {
        return Err(EditError::Malformed);
    }
    if &container[0..8] != SENTINEL_A || &container[container.len() - 8..] != SENTINEL_B {
        return Err(EditError::Malformed);
    }
    let plain_len = u32_le(&container[8..12]) as usize;
    let stream_len = u32_le(&container[12..16]) as usize;
    let slot_cap = u32_le(&container[16..20]) as usize;
    if container.len() != HEADER_LEN + slot_cap + 8 || stream_len > slot_cap {
        return Err(EditError::Malformed);
    }
    let stream = &container[HEADER_LEN..HEADER_LEN + stream_len];
    let d = decode(stream, max_output, work_limit).map_err(|e| match e {
        // conteúdo corrompido que ainda decodifica cai em IdentityMismatch
        // abaixo; erro de estrutura do slot é DecodeFailed.
        KosError::InvalidReference | KosError::Truncated | KosError::EmptyInput => {
            EditError::DecodeFailed
        }
        KosError::ExcessiveOutput | KosError::WorkLimit => EditError::Malformed,
    })?;
    if d.bytes_consumed != stream_len {
        return Err(EditError::Malformed); // stream_len não fecha no terminator
    }
    if d.output.len() != plain_len || sha256_bytes(&d.output) != container[20..52] {
        return Err(EditError::IdentityMismatch);
    }
    Ok(SlotInfo {
        plain_len,
        stream_len,
        slot_cap,
        plain: d.output,
    })
}

/// Simulação de reinserção: re-encode de `new_plain` no MESMO slot
/// (`slot_cap` e sentinelas preservados byte a byte; `plain_len`,
/// `stream_len` e o campo sha acompanham o novo conteúdo). Recusa sem
/// escrever quando a stream excede o slot; a entrada nunca é mutada
/// (função pura sobre `&[u8]`).
pub fn reinsert(
    container: &[u8],
    new_plain: &[u8],
    max_stream: usize,
    work_limit: usize,
) -> Result<Vec<u8>, EditError> {
    let info = open(container, max_output_for(container), work_limit)?;
    let teto = max_stream.min(info.slot_cap);
    match encode(new_plain, teto, work_limit) {
        Ok(e) => assemble(new_plain, &e.stream, info.slot_cap),
        Err(EncError::StreamLimit) => Err(EditError::StreamTooLarge),
        Err(EncError::WorkLimit) => Err(EditError::WorkLimit),
    }
}

/// Teto de saída usado por `reinsert` na verificação de identidade: o
/// declarado no cabeçalho tem folga de 1 byte para distinguir
/// ExcessiveOutput de divergência real.
fn max_output_for(container: &[u8]) -> usize {
    if container.len() < 12 {
        return 0;
    }
    u32_le(&container[8..12]) as usize + 1
}

// ————— SHA-256 (FIPS 180-4), implementação própria: o pacote é — e
// permanece — sem dependências externas.

const K: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/// SHA-256 (FIPS 180-4) em 32 bytes — implementação própria, o pacote
/// permanece sem dependências externas.
pub fn sha256_bytes(data: &[u8]) -> [u8; 32] {
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];
    // padding: 0x80, zeros até len ≡ 56 (mod 64), comprimento em bits u64 BE.
    let bits = (data.len() as u64) * 8;
    let pad = (56 + 64 - (data.len() + 1) % 64) % 64;
    let mut buf = Vec::with_capacity(data.len() + 1 + pad + 8);
    buf.extend_from_slice(data);
    buf.push(0x80);
    buf.resize(data.len() + 1 + pad, 0x00);
    buf.extend_from_slice(&bits.to_be_bytes());

    for block in buf.chunks_exact(64) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes(block[i * 4..i * 4 + 4].try_into().unwrap());
        }
        for i in 16..64 {
            // sigma0 = ROTR7 ^ ROTR18 ^ SHR3; sigma1 = ROTR17 ^ ROTR19 ^ SHR10.
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh] = h;
        for i in 0..64 {
            // Sigma1 = ROTR6 ^ ROTR11 ^ ROTR25; Sigma0 = ROTR2 ^ ROTR13 ^ ROTR22.
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let t1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let t2 = s0.wrapping_add(maj);
            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(t1);
            d = c;
            c = b;
            b = a;
            a = t1.wrapping_add(t2);
        }
        for (x, h) in [a, b, c, d, e, f, g, hh].iter().zip(h.iter_mut()) {
            *h = h.wrapping_add(*x);
        }
    }
    let mut out = [0u8; 32];
    for i in 0..8 {
        out[i * 4..i * 4 + 4].copy_from_slice(&h[i].to_be_bytes());
    }
    out
}

/// Hex minúsculo do SHA-256 (formato das esperas publicadas).
pub fn sha256_hex(data: &[u8]) -> String {
    let mut s = String::with_capacity(64);
    for b in sha256_bytes(data) {
        s.push_str(&format!("{b:02x}"));
    }
    s
}
