pub mod annotations;
pub mod audio;
pub mod code;
pub mod graphics;
pub mod loader;
pub mod manifest;
pub mod matching;
pub mod platform;
pub mod projection;
pub mod trace;
pub mod text;

use std::path::Path;

pub use manifest::{
    AudioCandidate, CallGraphEdge, CodeXref, DisassemblyResult, GraphicsCandidate,
    ReverseAnnotation, RomAnalysisManifest, TextCandidate,
};

pub fn analyze_rom(rom_path: &str) -> Result<RomAnalysisManifest, String> {
    let path = Path::new(rom_path);
    let loaded = loader::load_rom(path)?;
    let mut manifest = loader::base_manifest(&loaded);
    let (graphics_regions, compression_regions) = graphics::analyze_graphics(&loaded);
    let (text_regions, pointer_tables) = text::analyze_text(&loaded);
    let audio_regions = audio::analyze_audio(&loaded);
    let (code_regions, call_graph, mut logic_hints) = code::analyze_code(&loaded);

    logic_hints.push(manifest::LogicHint {
        id: "projection_guard".to_string(),
        category: "projection".to_string(),
        message: "A projecao para .rds permanece conservadora e deve preservar proveniencia; nenhuma conversao total de gameplay e assumida.".to_string(),
        start: None,
        end: None,
    });

    manifest.graphics_regions = graphics_regions;
    manifest.compression_regions = compression_regions;
    manifest.text_regions = text_regions;
    manifest.pointer_tables = pointer_tables;
    manifest.audio_regions = audio_regions;
    manifest.code_regions = code_regions;
    manifest.call_graph = call_graph;
    manifest.logic_hints = logic_hints;
    manifest.projection_status = projection::projection_status_for_manifest(&manifest);
    manifest.annotations = annotations::load_annotations(path, &manifest.hashes)?;

    Ok(manifest)
}

pub fn disassemble_rom(
    rom_path: &str,
    offset: usize,
    length: usize,
) -> Result<DisassemblyResult, String> {
    let loaded = loader::load_rom(Path::new(rom_path))?;
    Ok(code::disassemble_region(&loaded, offset, length))
}

pub fn get_xrefs(rom_path: &str) -> Result<Vec<manifest::CodeXref>, String> {
    let manifest = analyze_rom(rom_path)?;
    Ok(
        manifest
            .code_regions
            .iter()
            .flat_map(|region| region.xrefs.clone())
            .collect(),
    )
}

pub fn get_call_graph(rom_path: &str) -> Result<Vec<manifest::CallGraphEdge>, String> {
    let manifest = analyze_rom(rom_path)?;
    Ok(manifest.call_graph)
}

pub fn extract_graphics(rom_path: &str) -> Result<Vec<manifest::GraphicsCandidate>, String> {
    let manifest = analyze_rom(rom_path)?;
    Ok(manifest.graphics_regions)
}

pub fn extract_text(
    rom_path: &str,
) -> Result<(Vec<manifest::TextCandidate>, Vec<manifest::PointerTableCandidate>), String> {
    let manifest = analyze_rom(rom_path)?;
    Ok((manifest.text_regions, manifest.pointer_tables))
}

pub fn extract_audio(rom_path: &str) -> Result<Vec<manifest::AudioCandidate>, String> {
    let manifest = analyze_rom(rom_path)?;
    Ok(manifest.audio_regions)
}

pub fn save_rom_annotations(
    rom_path: &str,
    annotations_to_save: &[manifest::ReverseAnnotation],
) -> Result<usize, String> {
    let manifest = analyze_rom(rom_path)?;
    annotations::save_annotations(Path::new(rom_path), &manifest.hashes, annotations_to_save)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_rom_path(name: &str, ext: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock drift")
            .as_nanos();
        std::env::temp_dir().join(format!("retrodev-reverse-manifest-{}-{}.{}", name, nonce, ext))
    }

    fn build_megadrive_fixture() -> Vec<u8> {
        let mut rom = vec![0u8; 0x2000];
        rom[4..8].copy_from_slice(&0x0000_0200u32.to_be_bytes());
        rom[0x100..0x110].copy_from_slice(b"SEGA GENESIS    ");
        rom[0x150..0x165].copy_from_slice(b"RETRODEV REVERSE MD  ");

        rom[0x200..0x208].copy_from_slice(&[0x4E, 0xB9, 0x00, 0x00, 0x02, 0x40, 0x4E, 0x75]);
        rom[0x240..0x244].copy_from_slice(&[0x4E, 0x71, 0x4E, 0x75]);

        let strings: &[(&[u8], usize)] = &[
            (b"HELLO WORLD!!", 0x500),
            (b"GAME OVER!!! ", 0x510),
            (b"PLAYER ONE!! ", 0x520),
            (b"CONTINUE?!!? ", 0x530),
        ];
        for &(text, offset) in strings {
            rom[offset..offset + text.len()].copy_from_slice(text);
        }
        for (index, &(_, offset)) in strings.iter().enumerate() {
            let base = 0x280 + index * 4;
            rom[base..base + 4].copy_from_slice(&(offset as u32).to_be_bytes());
        }

        rom[0x360..0x36B].copy_from_slice(b"....XGM....");

        for index in 0..(130 * 32) {
            rom[0x800 + index] = match index % 3 {
                0 => 0xAB,
                1 => 0xCD,
                _ => 0x12,
            };
        }

        rom
    }

    fn build_snes_fixture() -> Vec<u8> {
        let mut rom = vec![0u8; 512 + 0x20000];
        let base = 512;
        rom[base + 0x7FC0..base + 0x7FD5].copy_from_slice(b"RETRODEV SNES TEST   ");
        rom[base + 0x7FDC] = 0x00;
        rom[base + 0x7FDD] = 0x80;

        rom[base..base + 5].copy_from_slice(&[0x22, 0x00, 0x00, 0x01, 0x6B]);
        rom[base + 0x10000] = 0xEA;
        rom[base + 0x10001] = 0x6B;

        let strings: &[(&[u8], usize)] = &[
            (b"STAGE ONE!!!", 0x200),
            (b"STAGE TWO!!!", 0x210),
            (b"STAGE THREE!", 0x220),
            (b"FINAL BOSS!!", 0x230),
        ];
        for &(text, offset) in strings {
            let absolute = base + offset;
            rom[absolute..absolute + text.len()].copy_from_slice(text);
        }
        for (index, &(_, offset)) in strings.iter().enumerate() {
            let absolute = base + 0x80 + index * 2;
            rom[absolute..absolute + 2].copy_from_slice(&(offset as u16).to_le_bytes());
        }

        rom[base + 0x260..base + 0x26A].copy_from_slice(b"SPC700....");

        for index in 0..(130 * 32) {
            rom[base + 0x400 + index] = match index % 3 {
                0 => 0x22,
                1 => 0x44,
                _ => 0x66,
            };
        }

        rom
    }

    #[test]
    fn analyze_rom_builds_canonical_manifest_for_megadrive() {
        let path = temp_rom_path("md", "bin");
        let rom = build_megadrive_fixture();
        fs::write(&path, &rom).expect("write md rom");

        let manifest = analyze_rom(path.to_string_lossy().as_ref()).expect("analyze rom");

        assert_eq!(manifest.target, "megadrive");
        assert!(!manifest.graphics_regions.is_empty());
        assert!(!manifest.code_regions.is_empty());

        let _ = fs::remove_file(path);
    }

    #[test]
    fn analyze_rom_builds_canonical_manifest_for_snes() {
        let path = temp_rom_path("snes", "smc");
        let rom = build_snes_fixture();
        fs::write(&path, &rom).expect("write snes rom");

        let manifest = analyze_rom(path.to_string_lossy().as_ref()).expect("analyze rom");

        assert_eq!(manifest.target, "snes");
        assert_eq!(manifest.stripped_header_bytes, 512);
        assert!(!manifest.code_regions.is_empty());

        let _ = fs::remove_file(path);
    }

    #[test]
    fn analyze_rom_populates_all_extractors_for_megadrive() {
        let path = temp_rom_path("md-all", "bin");
        let rom = build_megadrive_fixture();
        fs::write(&path, &rom).expect("write md rom");

        let manifest = analyze_rom(path.to_string_lossy().as_ref()).expect("analyze rom");

        assert!(!manifest.graphics_regions.is_empty());
        assert!(!manifest.text_regions.is_empty());
        assert!(!manifest.audio_regions.is_empty());
        assert!(!manifest.code_regions.is_empty());
        assert!(!manifest.pointer_tables.is_empty());
        assert!(!manifest.call_graph.is_empty());
        assert!(!manifest.compression_regions.is_empty());

        let _ = fs::remove_file(path);
    }

    #[test]
    fn analyze_rom_populates_all_extractors_for_snes() {
        let path = temp_rom_path("snes-all", "smc");
        let rom = build_snes_fixture();
        fs::write(&path, &rom).expect("write snes rom");

        let manifest = analyze_rom(path.to_string_lossy().as_ref()).expect("analyze rom");

        assert!(!manifest.graphics_regions.is_empty());
        assert!(!manifest.text_regions.is_empty());
        assert!(!manifest.audio_regions.is_empty());
        assert!(!manifest.code_regions.is_empty());
        assert!(!manifest.pointer_tables.is_empty());
        assert!(!manifest.call_graph.is_empty());
        assert!(!manifest.compression_regions.is_empty());

        let _ = fs::remove_file(path);
    }
}
