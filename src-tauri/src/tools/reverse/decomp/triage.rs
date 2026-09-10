//! Triagem estática de ROM Mega Drive (header SEGA + classificação heurística de tier).
//! Fase 0 / Sprint 1 — `docs/12_DECOMPILACAO_PAREADA_PLANO.md`.

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

/// Tiers do plano docs/12 (78-86): T0 = par (fonte, ROM) conhecido; T1 = homebrew com
/// assinatura SGDK/GCC sem fonte; T2 = comercial (só reconstrução funcional); T3 =
/// hostil/fora de escopo.
pub const TIER_T0_PAIR: &str = "tier0_pair";
pub const TIER_T1_HOMEBREW: &str = "tier1_homebrew";
pub const TIER_T2_COMMERCIAL: &str = "tier2_commercial";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RomTriageReport {
    pub size_bytes: u64,
    pub has_sega_header: bool,
    pub ssp: u32,
    pub entry_point: u32,
    pub copyright: String,
    pub domestic_name: String,
    pub intl_name: String,
    pub serial: String,
    pub device: String,
    pub checksum: u16,
    pub regions: String,
    pub rom_start: u32,
    pub rom_end_declared: u32,
    pub ram_start: u32,
    pub ram_end: u32,
    pub sgdk_signature: bool,
    pub size_matches_declaration: bool,
    pub tier: String,
    pub notes: Vec<String>,
}

fn read_ascii(bytes: &[u8], start: usize, len: usize) -> String {
    let end = (start + len).min(bytes.len());
    bytes[start..end]
        .iter()
        .map(|byte| {
            if byte.is_ascii_graphic() {
                *byte as char
            } else {
                ' '
            }
        })
        .collect::<String>()
        .trim_end()
        .to_string()
}

fn read_u32(bytes: &[u8], offset: usize) -> u32 {
    if offset + 4 > bytes.len() {
        return 0;
    }
    u32::from_be_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
    ])
}

fn read_u16(bytes: &[u8], offset: usize) -> u16 {
    if offset + 2 > bytes.len() {
        return 0;
    }
    u16::from_be_bytes([bytes[offset], bytes[offset + 1]])
}

/// Triagem determinística a partir dos bytes da ROM (mínimo 0x200 bytes de header).
pub fn triage_rom_bytes(rom: &[u8]) -> Result<RomTriageReport, String> {
    if rom.len() < 0x200 {
        return Err(format!(
            "ROM pequena demais para triagem: {} bytes (header SEGA precisa de 0x200)",
            rom.len()
        ));
    }

    let has_sega_header = read_ascii(rom, 0x100, 4) == "SEGA";
    let copyright = read_ascii(rom, 0x110, 16);
    let domestic_name = read_ascii(rom, 0x120, 48);
    let intl_name = read_ascii(rom, 0x150, 48);
    let serial = read_ascii(rom, 0x180, 14);
    let device = read_ascii(rom, 0x190, 16);
    let regions = read_ascii(rom, 0x1F0, 3);
    let rom_end_declared = read_u32(rom, 0x1A4);
    let sgdk_signature = copyright.to_ascii_uppercase().contains("SGDK");
    let mut notes = Vec::new();

    let size_matches_declaration =
        rom_end_declared != 0 && (rom_end_declared as u64 + 1) >= rom.len() as u64;
    if !size_matches_declaration {
        notes.push(format!(
            "rom_end declarado (0x{rom_end_declared:08X}) nao cobre o tamanho real ({} bytes); pad/checksum podem divergir do build original",
            rom.len()
        ));
    }
    if !has_sega_header {
        notes.push("header 'SEGA' ausente em 0x100; triagem segue com campos brutos".to_string());
    }

    // Tier heurístico: sem par conhecido, assinatura SGDK/GCC => T1; comercial sem fonte => T2.
    // O chamador que possui o par (fonte + ROM) sobe para T0 explicitamente no library.
    let tier = if sgdk_signature {
        TIER_T1_HOMEBREW.to_string()
    } else {
        TIER_T2_COMMERCIAL.to_string()
    };

    Ok(RomTriageReport {
        size_bytes: rom.len() as u64,
        has_sega_header,
        ssp: read_u32(rom, 0x0),
        entry_point: read_u32(rom, 0x4),
        copyright,
        domestic_name,
        intl_name,
        serial,
        device,
        checksum: read_u16(rom, 0x18E),
        regions,
        rom_start: read_u32(rom, 0x1A0),
        rom_end_declared,
        ram_start: read_u32(rom, 0x1A8),
        ram_end: read_u32(rom, 0x1AC),
        sgdk_signature,
        size_matches_declaration,
        tier,
        notes,
    })
}

/// Triagem a partir do caminho da ROM (leitura BYOR, somente leitura).
pub fn triage_rom(rom_path: &Path) -> Result<RomTriageReport, String> {
    let rom = fs::read(rom_path)
        .map_err(|error| format!("falha ao ler ROM '{}': {error}", rom_path.display()))?;
    triage_rom_bytes(&rom)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn synthetic_header() -> Vec<u8> {
        let mut rom = vec![0u8; 0x400];
        rom[0x0..0x4].copy_from_slice(&0xE1_00_00_00u32.to_be_bytes());
        rom[0x4..0x8].copy_from_slice(&0x00_00_02_00u32.to_be_bytes());
        rom[0x100..0x104].copy_from_slice(b"SEGA");
        rom[0x110..0x11A].copy_from_slice(b"(C)SGDK 20");
        rom[0x120..0x12D].copy_from_slice(b"TRIAGE SAMPLE");
        rom[0x150..0x15D].copy_from_slice(b"TRIAGE SAMPLE");
        rom[0x180..0x18D].copy_from_slice(b"GM 00000000-0");
        rom[0x190..0x192].copy_from_slice(b"JD");
        rom[0x1A0..0x1A4].copy_from_slice(&0u32.to_be_bytes());
        rom[0x1A4..0x1A8].copy_from_slice(&0x000F_FFFFu32.to_be_bytes());
        rom[0x1A8..0x1AC].copy_from_slice(&0xE0_FF_00_00u32.to_be_bytes());
        rom[0x1AC..0x1B0].copy_from_slice(&0xE0_FF_FF_FFu32.to_be_bytes());
        rom[0x1F0..0x1F3].copy_from_slice(b"JUE");
        rom
    }

    #[test]
    fn triage_extracts_header_fields_and_sgdk_signature() {
        let rom = synthetic_header();
        let report = triage_rom_bytes(&rom).expect("triage");

        assert!(report.has_sega_header);
        assert_eq!(report.entry_point, 0x200);
        assert_eq!(report.ssp, 0xE100_0000);
        assert!(report.sgdk_signature);
        assert_eq!(report.domestic_name, "TRIAGE SAMPLE");
        assert_eq!(report.regions, "JUE");
        assert_eq!(report.rom_end_declared, 0xFFFFF);
        assert_eq!(report.tier, TIER_T1_HOMEBREW);
        assert!(
            report.size_matches_declaration,
            "rom_end declarado (1 MiB) cobre o arquivo sintetico de 0x400"
        );
    }

    #[test]
    fn triage_notes_size_divergence_and_missing_header() {
        let mut rom = vec![0u8; 0x200];
        rom[0x1A4..0x1A8].copy_from_slice(&0x0000_0100u32.to_be_bytes());
        let report = triage_rom_bytes(&rom).expect("triage");

        assert!(!report.has_sega_header);
        assert!(
            !report.size_matches_declaration,
            "rom_end 0x100 nao cobre arquivo de 0x200"
        );
        assert_eq!(report.tier, TIER_T2_COMMERCIAL);
        assert!(!report.notes.is_empty());
    }

    #[test]
    fn triage_rejects_tiny_rom() {
        assert!(triage_rom_bytes(&[0u8; 16]).is_err());
    }
}
