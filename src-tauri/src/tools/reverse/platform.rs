use std::path::Path;

use super::manifest::{RomHeader, RomSegment};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadedRom {
    pub target: String,
    pub source_path: String,
    pub bytes: Vec<u8>,
    pub detected_format: String,
    pub stripped_header_bytes: usize,
    pub header: RomHeader,
    pub mapper: String,
    pub special_chips: Vec<String>,
    pub segments: Vec<RomSegment>,
    pub entry_points: Vec<u32>,
    pub trace_note: String,
}

pub trait ReversePlatformAdapter {
    fn detect_score(&self, rom_path: &Path, raw_bytes: &[u8]) -> u8;
    fn load(&self, rom_path: &Path, raw_bytes: &[u8]) -> Result<LoadedRom, String>;
}

pub struct MegaDriveAdapter;
pub struct SnesAdapter;

impl MegaDriveAdapter {
    fn trim_ascii(bytes: &[u8]) -> String {
        String::from_utf8_lossy(bytes)
            .trim_matches(char::from(0))
            .trim()
            .to_string()
    }
}

impl ReversePlatformAdapter for MegaDriveAdapter {
    fn detect_score(&self, rom_path: &Path, raw_bytes: &[u8]) -> u8 {
        let mut score = 0u8;
        let ext = rom_path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if matches!(ext.as_str(), "bin" | "gen" | "md") {
            score = score.saturating_add(30);
        }
        if raw_bytes.len() >= 0x110 {
            let console = &raw_bytes[0x100..0x110];
            if String::from_utf8_lossy(console).contains("SEGA") {
                score = score.saturating_add(70);
            }
        }
        score
    }

    fn load(&self, rom_path: &Path, raw_bytes: &[u8]) -> Result<LoadedRom, String> {
        if raw_bytes.len() < 0x200 {
            return Err("ROM Mega Drive pequena demais para conter header canonico.".to_string());
        }

        let console_name = Self::trim_ascii(&raw_bytes[0x100..0x110]);
        let internal_title = Self::trim_ascii(&raw_bytes[0x150..0x180]);
        let version = Some(Self::trim_ascii(&raw_bytes[0x18C..0x18E]));
        let region = Some(Self::trim_ascii(&raw_bytes[0x1F0..0x1F3]));
        let entry_point =
            u32::from_be_bytes([raw_bytes[4], raw_bytes[5], raw_bytes[6], raw_bytes[7]]);

        let mut segments = vec![
            RomSegment {
                start: 0,
                end: 0x100,
                kind: "vectors".to_string(),
                label: "68k vectors".to_string(),
                bank_index: None,
                confidence: 100,
            },
            RomSegment {
                start: 0x100,
                end: 0x200,
                kind: "header".to_string(),
                label: "Mega Drive header".to_string(),
                bank_index: None,
                confidence: 100,
            },
        ];

        for (index, start) in (0..raw_bytes.len()).step_by(0x10000).enumerate() {
            let end = raw_bytes.len().min(start + 0x10000);
            segments.push(RomSegment {
                start: start as u32,
                end: end as u32,
                kind: "bank".to_string(),
                label: format!("ROM bank {:03}", index),
                bank_index: Some(index as u32),
                confidence: 90,
            });
        }

        Ok(LoadedRom {
            target: "megadrive".to_string(),
            source_path: rom_path.to_string_lossy().to_string(),
            bytes: raw_bytes.to_vec(),
            detected_format: rom_path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("bin")
                .to_ascii_lowercase(),
            stripped_header_bytes: 0,
            header: RomHeader {
                console_name,
                internal_title,
                region,
                version,
                publisher: None,
                entry_point: Some(entry_point),
            },
            mapper: "linear_rom".to_string(),
            special_chips: Vec::new(),
            segments,
            entry_points: vec![entry_point.min(raw_bytes.len().saturating_sub(1) as u32)],
            trace_note: "Trace Libretro ainda nao instrumentado para Mega Drive nesta wave; manifesto preparado para overlay futuro.".to_string(),
        })
    }
}

#[derive(Debug, Clone)]
struct SnesHeaderCandidate {
    offset: usize,
    mapper: String,
    title: String,
    region: Option<String>,
    version: Option<String>,
    reset_vector: u16,
    special_chips: Vec<String>,
    score: u8,
}

impl SnesAdapter {
    fn score_header(bytes: &[u8], offset: usize, mapper: &str) -> Option<SnesHeaderCandidate> {
        if offset + 0x40 > bytes.len() {
            return None;
        }

        let title_bytes = &bytes[offset..offset + 21];
        let printable = title_bytes
            .iter()
            .filter(|value| matches!(**value, 32..=126))
            .count();
        let title = String::from_utf8_lossy(title_bytes)
            .trim_matches(char::from(0))
            .trim()
            .to_string();
        let country = bytes[offset + 0x19];
        let rom_type = bytes[offset + 0x16];
        let version = Some(format!("{:02X}", bytes[offset + 0x1B]));
        let reset_vector = u16::from_le_bytes([bytes[offset + 0x3C], bytes[offset + 0x3D]]);

        let mut score = printable as u8;
        if !title.is_empty() {
            score = score.saturating_add(20);
        }
        if reset_vector >= 0x8000 {
            score = score.saturating_add(25);
        }
        if mapper == "lorom" || mapper == "hirom" {
            score = score.saturating_add(10);
        }

        let mut special_chips = Vec::new();
        match rom_type {
            0x34 | 0x35 => special_chips.push("SA-1".to_string()),
            0x13..=0x15 => special_chips.push("SuperFX".to_string()),
            _ => {}
        }

        Some(SnesHeaderCandidate {
            offset,
            mapper: mapper.to_string(),
            title,
            region: Some(format!("{:02X}", country)),
            version,
            reset_vector,
            special_chips,
            score,
        })
    }

    fn reset_vector_to_offset(candidate: &SnesHeaderCandidate) -> u32 {
        match candidate.mapper.as_str() {
            "hirom" | "exhirom" => candidate.reset_vector as u32,
            _ => (candidate.reset_vector as u32) & 0x7FFF,
        }
    }
}

impl ReversePlatformAdapter for SnesAdapter {
    fn detect_score(&self, rom_path: &Path, raw_bytes: &[u8]) -> u8 {
        let ext = rom_path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        let mut score = if matches!(ext.as_str(), "smc" | "sfc" | "fig") {
            35
        } else {
            0
        };

        let stripped = if raw_bytes.len() % 0x8000 == 512 && raw_bytes.len() > 512 {
            &raw_bytes[512..]
        } else {
            raw_bytes
        };

        for (offset, mapper) in [
            (0x7FC0usize, "lorom"),
            (0xFFC0usize, "hirom"),
            (0x40FFC0usize, "exhirom"),
        ] {
            if let Some(candidate) = Self::score_header(stripped, offset, mapper) {
                score = score.max(candidate.score.saturating_add(25));
            }
        }

        score
    }

    fn load(&self, rom_path: &Path, raw_bytes: &[u8]) -> Result<LoadedRom, String> {
        let (bytes, stripped_header_bytes) =
            if raw_bytes.len() % 0x8000 == 512 && raw_bytes.len() > 512 {
                (raw_bytes[512..].to_vec(), 512usize)
            } else {
                (raw_bytes.to_vec(), 0usize)
            };

        let mut best = None;
        for (offset, mapper) in [
            (0x7FC0usize, "lorom"),
            (0xFFC0usize, "hirom"),
            (0x40FFC0usize, "exhirom"),
        ] {
            if let Some(candidate) = Self::score_header(&bytes, offset, mapper) {
                if best
                    .as_ref()
                    .map(|current: &SnesHeaderCandidate| candidate.score > current.score)
                    .unwrap_or(true)
                {
                    best = Some(candidate);
                }
            }
        }

        let header =
            best.ok_or_else(|| "Nao foi possivel reconhecer um header SNES valido.".to_string())?;
        let entry_point =
            Self::reset_vector_to_offset(&header).min(bytes.len().saturating_sub(1) as u32);
        let bank_size = if header.mapper == "lorom" {
            0x8000
        } else {
            0x10000
        };

        let mut segments = vec![RomSegment {
            start: header.offset as u32,
            end: (header.offset + 0x40) as u32,
            kind: "header".to_string(),
            label: format!("SNES header ({})", header.mapper),
            bank_index: None,
            confidence: 100,
        }];
        for (index, start) in (0..bytes.len()).step_by(bank_size).enumerate() {
            let end = bytes.len().min(start + bank_size);
            segments.push(RomSegment {
                start: start as u32,
                end: end as u32,
                kind: "bank".to_string(),
                label: format!("ROM bank {:03}", index),
                bank_index: Some(index as u32),
                confidence: 90,
            });
        }

        Ok(LoadedRom {
            target: "snes".to_string(),
            source_path: rom_path.to_string_lossy().to_string(),
            bytes,
            detected_format: rom_path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("sfc")
                .to_ascii_lowercase(),
            stripped_header_bytes,
            header: RomHeader {
                console_name: "SNES".to_string(),
                internal_title: header.title,
                region: header.region,
                version: header.version,
                publisher: None,
                entry_point: Some(entry_point),
            },
            mapper: header.mapper,
            special_chips: header.special_chips,
            segments,
            entry_points: vec![entry_point],
            trace_note: "Trace Libretro ainda nao instrumentado para SNES nesta wave; manifesto preparado para overlay futuro.".to_string(),
        })
    }
}
