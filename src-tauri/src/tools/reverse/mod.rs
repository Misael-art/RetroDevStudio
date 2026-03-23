pub mod annotations;
pub mod audio;
pub mod code;
pub mod graphics;
pub mod loader;
pub mod manifest;
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

    #[test]
    fn analyze_rom_builds_canonical_manifest_for_megadrive() {
        let path = temp_rom_path("md", "bin");
        let mut rom = vec![0u8; 0x600];
        rom[4..8].copy_from_slice(&0x0000_0200u32.to_be_bytes());
        rom[0x100..0x110].copy_from_slice(b"SEGA GENESIS    ");
        rom[0x150..0x163].copy_from_slice(b"RETRODEV REVERSE   ");
        for index in 0..(32 * 8) {
            rom[0x200 + index] = if index % 2 == 0 { 0x12 } else { 0x34 };
        }
        fs::write(&path, &rom).expect("write md rom");

        let manifest = analyze_rom(path.to_string_lossy().as_ref()).expect("analyze rom");

        assert_eq!(manifest.target, "megadrive");
        assert!(!manifest.graphics_regions.is_empty());
        assert!(!manifest.code_regions.is_empty());

        let _ = fs::remove_file(path);
    }
}
