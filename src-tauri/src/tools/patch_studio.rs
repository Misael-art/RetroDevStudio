//! patch_studio.rs — ROM Patch Studio: criação e aplicação de patches IPS e BPS.
//!
//! Compliance legal: este módulo NUNCA distribui ROMs. Apenas gera/aplica patches
//! diferenciais (IPS/BPS) que requerem que o usuário forneça a ROM original.

use std::fs;
use std::path::Path;
use serde::Serialize;

// ── Resultado ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct PatchResult {
    pub ok: bool,
    pub message: String,
    pub bytes_changed: u32,
}

impl PatchResult {
    fn ok(msg: impl Into<String>, changed: u32) -> Self {
        Self { ok: true, message: msg.into(), bytes_changed: changed }
    }
    fn err(msg: impl Into<String>) -> Self {
        Self { ok: false, message: msg.into(), bytes_changed: 0 }
    }
}

// ── IPS ───────────────────────────────────────────────────────────────────────
// Formato IPS: https://zerosoft.zophar.net/ips.htm
// Header: "PATCH" (5 bytes)
// Records: offset (3 bytes BE) + size (2 bytes BE) + data
// EOF: "EOF" (3 bytes)

const IPS_HEADER: &[u8] = b"PATCH";
const IPS_EOF:    &[u8] = b"EOF";

/// Cria um patch IPS comparando `original` com `modified`.
/// Retorna os bytes do patch IPS (para salvar em arquivo).
pub fn create_ips(original: &[u8], modified: &[u8]) -> Result<Vec<u8>, String> {
    if original.len() > 0xFF_FFFF {
        return Err("IPS não suporta ROMs maiores que 16MB.".to_string());
    }

    let mut patch = IPS_HEADER.to_vec();
    let len = original.len().min(modified.len());
    let mut i = 0usize;

    while i < len {
        if original[i] == modified[i] {
            i += 1;
            continue;
        }
        // Encontrou diferença — colete run de bytes diferentes
        let start = i;
        while i < len && (i - start) < 0xFFFF && original[i] != modified[i] {
            i += 1;
        }
        let data = &modified[start..i];
        let offset = start as u32;
        // offset 3 bytes BE
        patch.push(((offset >> 16) & 0xFF) as u8);
        patch.push(((offset >>  8) & 0xFF) as u8);
        patch.push( (offset        & 0xFF) as u8);
        // size 2 bytes BE
        let size = data.len() as u16;
        patch.push((size >> 8) as u8);
        patch.push((size & 0xFF) as u8);
        patch.extend_from_slice(data);
    }

    patch.extend_from_slice(IPS_EOF);
    Ok(patch)
}

/// Aplica um patch IPS a `original` e retorna a ROM patcheada.
pub fn apply_ips(original: &[u8], patch: &[u8]) -> Result<Vec<u8>, String> {
    if !patch.starts_with(IPS_HEADER) {
        return Err("Patch inválido: header IPS 'PATCH' não encontrado.".to_string());
    }

    let mut rom = original.to_vec();
    let mut pos = IPS_HEADER.len();

    loop {
        if pos + 3 > patch.len() {
            return Err("Patch corrompido: truncado antes do EOF.".to_string());
        }
        if &patch[pos..pos + 3] == IPS_EOF {
            break;
        }
        let offset = ((patch[pos] as usize) << 16)
                   | ((patch[pos + 1] as usize) << 8)
                   |  (patch[pos + 2] as usize);
        pos += 3;

        if pos + 2 > patch.len() {
            return Err("Patch corrompido: size faltando.".to_string());
        }
        let size = ((patch[pos] as usize) << 8) | (patch[pos + 1] as usize);
        pos += 2;

        if size == 0 {
            // RLE record: 2 bytes length + 1 byte fill value
            if pos + 3 > patch.len() {
                return Err("Patch corrompido: RLE record incompleto.".to_string());
            }
            let rle_len  = ((patch[pos] as usize) << 8) | (patch[pos + 1] as usize);
            let rle_byte = patch[pos + 2];
            pos += 3;
            let end = offset + rle_len;
            if end > rom.len() { rom.resize(end, 0); }
            for b in &mut rom[offset..end] { *b = rle_byte; }
        } else {
            if pos + size > patch.len() {
                return Err("Patch corrompido: dados incompletos.".to_string());
            }
            let data = &patch[pos..pos + size];
            pos += size;
            let end = offset + size;
            if end > rom.len() { rom.resize(end, 0); }
            rom[offset..end].copy_from_slice(data);
        }
    }

    Ok(rom)
}

// ── BPS ───────────────────────────────────────────────────────────────────────
// Formato BPS simplificado (subset): header "BPS1" + source_size + target_size
// + metadata_size + actions + source_checksum + target_checksum + patch_checksum
// Esta implementação suporta apenas o tipo de ação SourceRead (copia da source).

const BPS_HEADER: &[u8] = b"BPS1";

fn encode_varint(mut value: u64, out: &mut Vec<u8>) {
    loop {
        let mut x = (value & 0x7F) as u8;
        value >>= 7;
        if value == 0 { x |= 0x80; }
        out.push(x);
        if x & 0x80 != 0 { break; }
    }
}

fn decode_varint(data: &[u8], pos: &mut usize) -> Result<u64, String> {
    let mut result = 0u64;
    let mut shift  = 0u32;
    loop {
        if *pos >= data.len() {
            return Err("BPS: varint truncado.".to_string());
        }
        let b = data[*pos];
        *pos += 1;
        result |= ((b & 0x7F) as u64) << shift;
        shift += 7;
        if b & 0x80 != 0 { break; }
    }
    Ok(result)
}

fn crc32_simple(data: &[u8]) -> u32 {
    let mut crc: u32 = 0xFFFF_FFFF;
    for &b in data {
        crc ^= b as u32;
        for _ in 0..8 {
            if crc & 1 != 0 { crc = (crc >> 1) ^ 0xEDB8_8320; }
            else             { crc >>= 1; }
        }
    }
    !crc
}

/// Cria um patch BPS (subset SourceRead/TargetRead) entre `original` e `modified`.
pub fn create_bps(original: &[u8], modified: &[u8]) -> Result<Vec<u8>, String> {
    let mut patch = BPS_HEADER.to_vec();

    encode_varint(original.len() as u64, &mut patch);
    encode_varint(modified.len() as u64, &mut patch);
    encode_varint(0, &mut patch); // metadata size = 0

    // Build actions: compare byte-by-byte, emit TargetRead for changed runs,
    // SourceRead for unchanged runs.
    let len = original.len().min(modified.len());
    let mut i = 0usize;

    while i < len {
        if original[i] == modified[i] {
            // SourceRead run
            let start = i;
            while i < len && original[i] == modified[i] { i += 1; }
            let run = (i - start) as u64;
            // action = (length - 1) << 2 | 0 (SourceRead)
            encode_varint((run - 1) << 2, &mut patch);
        } else {
            // TargetRead run
            let start = i;
            while i < len && original[i] != modified[i] { i += 1; }
            let data = &modified[start..i];
            let run = data.len() as u64;
            // action = (length - 1) << 2 | 1 (TargetRead)
            encode_varint(((run - 1) << 2) | 1, &mut patch);
            patch.extend_from_slice(data);
        }
    }

    // Append extra bytes if modified is longer
    if modified.len() > len {
        let extra = &modified[len..];
        let run = extra.len() as u64;
        encode_varint(((run - 1) << 2) | 1, &mut patch);
        patch.extend_from_slice(extra);
    }

    // Checksums (CRC32 LE)
    let src_crc = crc32_simple(original).to_le_bytes();
    let tgt_crc = crc32_simple(modified).to_le_bytes();
    patch.extend_from_slice(&src_crc);
    patch.extend_from_slice(&tgt_crc);
    let patch_crc = crc32_simple(&patch).to_le_bytes();
    patch.extend_from_slice(&patch_crc);

    Ok(patch)
}

/// Aplica um patch BPS a `original`.
pub fn apply_bps(original: &[u8], patch: &[u8]) -> Result<Vec<u8>, String> {
    if !patch.starts_with(BPS_HEADER) {
        return Err("Patch inválido: header BPS1 não encontrado.".to_string());
    }
    if patch.len() < BPS_HEADER.len() + 12 {
        return Err("Patch BPS corrompido: muito curto.".to_string());
    }

    // Verificar CRC32 do patch (últimos 4 bytes)
    let patch_body   = &patch[..patch.len() - 4];
    let stored_crc   = u32::from_le_bytes(patch[patch.len()-4..].try_into().unwrap());
    let computed_crc = crc32_simple(patch_body);
    if stored_crc != computed_crc {
        return Err(format!("Patch BPS corrompido: CRC32 inválido (esperado {:08X}, obtido {:08X}).", stored_crc, computed_crc));
    }

    let mut pos = BPS_HEADER.len();
    let _source_size = decode_varint(patch, &mut pos)?;
    let target_size  = decode_varint(patch, &mut pos)? as usize;
    let metadata_size = decode_varint(patch, &mut pos)? as usize;
    pos += metadata_size; // skip metadata

    let actions_end = patch.len() - 12; // 3× CRC32
    let mut output  = vec![0u8; target_size];
    let mut out_pos = 0usize;
    let mut src_pos = 0i64;
    let mut out_off = 0i64;

    while pos < actions_end && out_pos < target_size {
        let data = decode_varint(patch, &mut pos)?;
        let action = (data & 3) as u8;
        let length = ((data >> 2) + 1) as usize;

        match action {
            0 => {
                // SourceRead
                let src_end = (out_pos + length).min(original.len());
                if out_pos < src_end {
                    output[out_pos..src_end].copy_from_slice(&original[out_pos..src_end]);
                }
                out_pos += length;
            }
            1 => {
                // TargetRead
                if pos + length > actions_end {
                    return Err("BPS: TargetRead data truncada.".to_string());
                }
                let end = (out_pos + length).min(target_size);
                output[out_pos..end].copy_from_slice(&patch[pos..pos + (end - out_pos)]);
                pos += length;
                out_pos += length;
            }
            2 => {
                // SourceCopy
                let offset_data = decode_varint(patch, &mut pos)?;
                let sign: i64 = if offset_data & 1 != 0 { -1 } else { 1 };
                src_pos += sign * ((offset_data >> 1) as i64);
                for _ in 0..length {
                    if out_pos >= target_size { break; }
                    let s = src_pos as usize;
                    output[out_pos] = if s < original.len() { original[s] } else { 0 };
                    out_pos += 1;
                    src_pos += 1;
                }
            }
            3 => {
                // TargetCopy
                let offset_data = decode_varint(patch, &mut pos)?;
                let sign: i64 = if offset_data & 1 != 0 { -1 } else { 1 };
                out_off += sign * ((offset_data >> 1) as i64);
                for _ in 0..length {
                    if out_pos >= target_size { break; }
                    let o = out_off as usize;
                    output[out_pos] = if o < out_pos { output[o] } else { 0 };
                    out_pos += 1;
                    out_off += 1;
                }
            }
            _ => unreachable!(),
        }
    }

    Ok(output)
}

// ── IPC-level helpers (chamados de lib.rs) ───────────────────────────────────

/// Cria um patch IPS a partir de dois arquivos e salva em `patch_path`.
pub fn create_ips_file(original_path: &Path, modified_path: &Path, patch_path: &Path) -> PatchResult {
    let orig = match fs::read(original_path) {
        Ok(b) => b,
        Err(e) => return PatchResult::err(format!("Erro ao ler ROM original: {e}")),
    };
    let modif = match fs::read(modified_path) {
        Ok(b) => b,
        Err(e) => return PatchResult::err(format!("Erro ao ler ROM modificada: {e}")),
    };
    let patch = match create_ips(&orig, &modif) {
        Ok(p) => p,
        Err(e) => return PatchResult::err(e),
    };
    let changed = patch.len() as u32;
    if let Err(e) = fs::write(patch_path, &patch) {
        return PatchResult::err(format!("Erro ao salvar patch: {e}"));
    }
    PatchResult::ok(format!("Patch IPS criado: {} bytes de diferença.", changed), changed)
}

/// Aplica um patch IPS a uma ROM e salva a ROM patcheada em `output_path`.
pub fn apply_ips_file(rom_path: &Path, patch_path: &Path, output_path: &Path) -> PatchResult {
    let rom = match fs::read(rom_path) {
        Ok(b) => b,
        Err(e) => return PatchResult::err(format!("Erro ao ler ROM: {e}")),
    };
    let patch = match fs::read(patch_path) {
        Ok(b) => b,
        Err(e) => return PatchResult::err(format!("Erro ao ler patch: {e}")),
    };
    let patched = match apply_ips(&rom, &patch) {
        Ok(r) => r,
        Err(e) => return PatchResult::err(e),
    };
    let changed = patched.iter().zip(rom.iter()).filter(|(a, b)| a != b).count() as u32;
    if let Err(e) = fs::write(output_path, &patched) {
        return PatchResult::err(format!("Erro ao salvar ROM patcheada: {e}"));
    }
    PatchResult::ok(format!("Patch IPS aplicado: {} bytes alterados.", changed), changed)
}

/// Cria um patch BPS a partir de dois arquivos e salva em `patch_path`.
pub fn create_bps_file(original_path: &Path, modified_path: &Path, patch_path: &Path) -> PatchResult {
    let orig = match fs::read(original_path) {
        Ok(b) => b,
        Err(e) => return PatchResult::err(format!("Erro ao ler ROM original: {e}")),
    };
    let modif = match fs::read(modified_path) {
        Ok(b) => b,
        Err(e) => return PatchResult::err(format!("Erro ao ler ROM modificada: {e}")),
    };
    let patch = match create_bps(&orig, &modif) {
        Ok(p) => p,
        Err(e) => return PatchResult::err(e),
    };
    let changed = patch.len() as u32;
    if let Err(e) = fs::write(patch_path, &patch) {
        return PatchResult::err(format!("Erro ao salvar patch: {e}"));
    }
    PatchResult::ok(format!("Patch BPS criado: {} bytes de patch.", changed), changed)
}

/// Aplica um patch BPS a uma ROM e salva a ROM patcheada em `output_path`.
pub fn apply_bps_file(rom_path: &Path, patch_path: &Path, output_path: &Path) -> PatchResult {
    let rom = match fs::read(rom_path) {
        Ok(b) => b,
        Err(e) => return PatchResult::err(format!("Erro ao ler ROM: {e}")),
    };
    let patch = match fs::read(patch_path) {
        Ok(b) => b,
        Err(e) => return PatchResult::err(format!("Erro ao ler patch: {e}")),
    };
    let patched = match apply_bps(&rom, &patch) {
        Ok(r) => r,
        Err(e) => return PatchResult::err(e),
    };
    let changed = patched.iter().zip(rom.iter()).filter(|(a, b)| a != b).count() as u32;
    if let Err(e) = fs::write(output_path, &patched) {
        return PatchResult::err(format!("Erro ao salvar ROM patcheada: {e}"));
    }
    PatchResult::ok(format!("Patch BPS aplicado: {} bytes alterados.", changed), changed)
}
