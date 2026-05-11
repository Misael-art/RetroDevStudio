use std::fs;
use std::path::Path;

use super::manifest::{RomAnalysisManifest, RomHashes};
use super::platform::{LoadedRom, MegaDriveAdapter, ReversePlatformAdapter, SnesAdapter};

fn crc32_simple(data: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for &byte in data {
        crc ^= byte as u32;
        for _ in 0..8 {
            if crc & 1 != 0 {
                crc = (crc >> 1) ^ 0xEDB8_8320;
            } else {
                crc >>= 1;
            }
        }
    }
    !crc
}

fn sha1_simple(data: &[u8]) -> [u8; 20] {
    let mut h0 = 0x6745_2301u32;
    let mut h1 = 0xEFCD_AB89u32;
    let mut h2 = 0x98BA_DCFEu32;
    let mut h3 = 0x1032_5476u32;
    let mut h4 = 0xC3D2_E1F0u32;

    let bit_len = (data.len() as u64) * 8;
    let mut padded = data.to_vec();
    padded.push(0x80);
    while !(padded.len() + 8).is_multiple_of(64) {
        padded.push(0);
    }
    padded.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in padded.chunks(64) {
        let mut w = [0u32; 80];
        for (index, word) in w.iter_mut().take(16).enumerate() {
            let base = index * 4;
            *word = u32::from_be_bytes([
                chunk[base],
                chunk[base + 1],
                chunk[base + 2],
                chunk[base + 3],
            ]);
        }
        for index in 16..80 {
            w[index] =
                (w[index - 3] ^ w[index - 8] ^ w[index - 14] ^ w[index - 16]).rotate_left(1);
        }

        let (mut a, mut b, mut c, mut d, mut e) = (h0, h1, h2, h3, h4);
        for (index, value) in w.iter().enumerate() {
            let (f, k) = match index {
                0..=19 => ((b & c) | ((!b) & d), 0x5A82_7999),
                20..=39 => (b ^ c ^ d, 0x6ED9_EBA1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1B_BCDC),
                _ => (b ^ c ^ d, 0xCA62_C1D6),
            };
            let temp = a
                .rotate_left(5)
                .wrapping_add(f)
                .wrapping_add(e)
                .wrapping_add(k)
                .wrapping_add(*value);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = temp;
        }

        h0 = h0.wrapping_add(a);
        h1 = h1.wrapping_add(b);
        h2 = h2.wrapping_add(c);
        h3 = h3.wrapping_add(d);
        h4 = h4.wrapping_add(e);
    }

    let mut out = [0u8; 20];
    out[..4].copy_from_slice(&h0.to_be_bytes());
    out[4..8].copy_from_slice(&h1.to_be_bytes());
    out[8..12].copy_from_slice(&h2.to_be_bytes());
    out[12..16].copy_from_slice(&h3.to_be_bytes());
    out[16..20].copy_from_slice(&h4.to_be_bytes());
    out
}

fn hex_lower(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        let _ = write!(&mut out, "{:02x}", byte);
    }
    out
}

pub fn load_rom(rom_path: &Path) -> Result<LoadedRom, String> {
    let raw_bytes = fs::read(rom_path)
        .map_err(|error| format!("Falha ao ler ROM '{}': {}", rom_path.display(), error))?;
    let adapters: [&dyn ReversePlatformAdapter; 2] = [&MegaDriveAdapter, &SnesAdapter];
    let best = adapters
        .iter()
        .map(|adapter| (adapter.detect_score(rom_path, &raw_bytes), *adapter))
        .max_by_key(|(score, _)| *score)
        .ok_or_else(|| "Nenhum adapter reverso registrado.".to_string())?;

    if best.0 == 0 {
        return Err(format!(
            "Nao foi possivel determinar a plataforma da ROM '{}'.",
            rom_path.display()
        ));
    }

    best.1.load(rom_path, &raw_bytes)
}

pub fn compute_hashes(bytes: &[u8]) -> RomHashes {
    RomHashes {
        crc32: format!("{:08x}", crc32_simple(bytes)),
        sha1: hex_lower(&sha1_simple(bytes)),
    }
}

pub fn base_manifest(loaded: &LoadedRom) -> RomAnalysisManifest {
    RomAnalysisManifest {
        ok: true,
        error: String::new(),
        target: loaded.target.clone(),
        source_path: loaded.source_path.clone(),
        detected_format: loaded.detected_format.clone(),
        stripped_header_bytes: loaded.stripped_header_bytes,
        total_size: loaded.bytes.len(),
        hashes: compute_hashes(&loaded.bytes),
        header: loaded.header.clone(),
        mapper: loaded.mapper.clone(),
        special_chips: loaded.special_chips.clone(),
        segments: loaded.segments.clone(),
        graphics_regions: Vec::new(),
        text_regions: Vec::new(),
        audio_regions: Vec::new(),
        code_regions: Vec::new(),
        pointer_tables: Vec::new(),
        compression_regions: Vec::new(),
        call_graph: Vec::new(),
        logic_hints: Vec::new(),
        annotations: Vec::new(),
        trace: super::trace::default_trace_status(loaded),
        projection_status: Default::default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_rom_path(name: &str, ext: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock drift")
            .as_nanos();
        std::env::temp_dir().join(format!("retrodev-loader-{}-{}.{}", name, nonce, ext))
    }

    #[test]
    fn load_rom_detects_megadrive_header_and_entrypoint() {
        let path = temp_rom_path("md", "bin");
        let mut rom = vec![0u8; 0x400];
        rom[4..8].copy_from_slice(&0x0000_0200u32.to_be_bytes());
        rom[0x100..0x110].copy_from_slice(b"SEGA GENESIS    ");
        rom[0x150..0x159].copy_from_slice(b"RETRODEV ");
        std::fs::write(&path, &rom).expect("write md rom");

        let loaded = load_rom(&path).expect("load md rom");

        assert_eq!(loaded.target, "megadrive");
        assert_eq!(loaded.header.entry_point, Some(0x200));
        assert!(loaded.header.console_name.contains("SEGA"));

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn load_rom_detects_snes_and_strips_copier_header() {
        let path = temp_rom_path("snes", "smc");
        let mut rom = vec![0u8; 512 + 0x10000];
        let base = 512;
        rom[base + 0x7FC0..base + 0x7FD5].copy_from_slice(b"RETRODEV SNES TEST   ");
        rom[base + 0x7FDC] = 0x00;
        rom[base + 0x7FDD] = 0x80;
        std::fs::write(&path, &rom).expect("write snes rom");

        let loaded = load_rom(&path).expect("load snes rom");

        assert_eq!(loaded.target, "snes");
        assert_eq!(loaded.stripped_header_bytes, 512);
        assert_eq!(loaded.header.entry_point, Some(0));

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn compute_hashes_returns_expected_lengths() {
        let hashes = compute_hashes(b"retrodev");
        assert_eq!(hashes.crc32.len(), 8);
        assert_eq!(hashes.sha1.len(), 40);
    }
}
