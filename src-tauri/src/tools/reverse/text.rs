use super::manifest::{PointerTableCandidate, TextCandidate};
use super::platform::LoadedRom;

fn is_ascii_printable(byte: u8) -> bool {
    matches!(byte, 9 | 10 | 13 | 32..=126)
}

fn is_shift_jis_lead(byte: u8) -> bool {
    matches!(byte, 0x81..=0x9F | 0xE0..=0xEF)
}

fn is_shift_jis_trail(byte: u8) -> bool {
    matches!(byte, 0x40..=0x7E | 0x80..=0xFC)
}

fn preview_ascii(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|value| {
            if is_ascii_printable(*value) {
                char::from(*value)
            } else {
                '.'
            }
        })
        .collect::<String>()
        .trim()
        .to_string()
}

fn preview_shift_jis(bytes: &[u8]) -> String {
    let mut out = String::new();
    let mut index = 0usize;
    while index < bytes.len() {
        if index + 1 < bytes.len()
            && is_shift_jis_lead(bytes[index])
            && is_shift_jis_trail(bytes[index + 1])
        {
            out.push('※');
            index += 2;
        } else if is_ascii_printable(bytes[index]) {
            out.push(char::from(bytes[index]));
            index += 1;
        } else {
            out.push('.');
            index += 1;
        }
    }
    out.trim().to_string()
}

fn scan_ascii(bytes: &[u8]) -> Vec<TextCandidate> {
    let mut out = Vec::new();
    let mut start = None;
    for (index, value) in bytes.iter().enumerate() {
        if is_ascii_printable(*value) {
            if start.is_none() {
                start = Some(index);
            }
        } else if let Some(current_start) = start.take() {
            if index.saturating_sub(current_start) >= 6 {
                let slice = &bytes[current_start..index];
                out.push(TextCandidate {
                    id: format!("txt_{:03}", out.len()),
                    start: current_start as u32,
                    end: index as u32,
                    encoding: "ascii-like".to_string(),
                    preview: preview_ascii(slice).chars().take(96).collect(),
                    confidence: 72,
                });
            }
        }
    }
    out
}

fn scan_shift_jis(bytes: &[u8]) -> Vec<TextCandidate> {
    let mut out = Vec::new();
    let mut index = 0usize;
    while index + 4 < bytes.len() {
        let start = index;
        let mut pairs = 0usize;
        while index + 1 < bytes.len()
            && is_shift_jis_lead(bytes[index])
            && is_shift_jis_trail(bytes[index + 1])
        {
            pairs += 1;
            index += 2;
        }
        if pairs >= 3 {
            let end = index;
            out.push(TextCandidate {
                id: format!("sjis_{:03}", out.len()),
                start: start as u32,
                end: end as u32,
                encoding: "shift-jis-like".to_string(),
                preview: preview_shift_jis(&bytes[start..end])
                    .chars()
                    .take(96)
                    .collect(),
                confidence: 58,
            });
        }
        index = index.max(start + 1);
    }
    out
}

pub fn analyze_text(loaded: &LoadedRom) -> (Vec<TextCandidate>, Vec<PointerTableCandidate>) {
    let mut text_regions = scan_ascii(&loaded.bytes);
    if loaded.target == "snes" {
        text_regions.extend(scan_shift_jis(&loaded.bytes));
    }
    text_regions.sort_by_key(|candidate| candidate.start);
    text_regions.truncate(24);

    let mut pointer_tables = Vec::new();
    let starts: Vec<u32> = text_regions
        .iter()
        .map(|candidate| candidate.start)
        .collect();

    if loaded.target == "megadrive" {
        let bytes = &loaded.bytes;
        let mut offset = 0usize;
        while offset + 16 <= bytes.len() && pointer_tables.len() < 6 {
            let mut destinations = Vec::new();
            for entry_index in 0..4usize {
                let base = offset + entry_index * 4;
                let value = u32::from_be_bytes([
                    bytes[base],
                    bytes[base + 1],
                    bytes[base + 2],
                    bytes[base + 3],
                ]);
                if starts.iter().any(|start| value.abs_diff(*start) <= 4) {
                    destinations.push(value);
                }
            }
            if destinations.len() >= 3 {
                pointer_tables.push(PointerTableCandidate {
                    start: offset as u32,
                    end: (offset + 16) as u32,
                    entry_size: 4,
                    encoding: "be32".to_string(),
                    destinations,
                    confidence: 60,
                });
                offset += 16;
            } else {
                offset += 4;
            }
        }
    } else {
        let bytes = &loaded.bytes;
        let mut offset = 0usize;
        while offset + 8 <= bytes.len() && pointer_tables.len() < 6 {
            let mut destinations = Vec::new();
            for entry_index in 0..4usize {
                let base = offset + entry_index * 2;
                let value = u16::from_le_bytes([bytes[base], bytes[base + 1]]) as u32;
                if starts
                    .iter()
                    .any(|start| (start & 0xFFFF).abs_diff(value) <= 4)
                {
                    destinations.push(value);
                }
            }
            if destinations.len() >= 3 {
                pointer_tables.push(PointerTableCandidate {
                    start: offset as u32,
                    end: (offset + 8) as u32,
                    entry_size: 2,
                    encoding: "le16".to_string(),
                    destinations,
                    confidence: 56,
                });
                offset += 8;
            } else {
                offset += 2;
            }
        }
    }

    (text_regions, pointer_tables)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::reverse::manifest::RomHeader;
    use crate::tools::reverse::platform::LoadedRom;

    fn sample_loaded(target: &str, bytes: Vec<u8>) -> LoadedRom {
        LoadedRom {
            target: target.to_string(),
            source_path: "dummy.rom".to_string(),
            bytes,
            detected_format: "bin".to_string(),
            stripped_header_bytes: 0,
            header: RomHeader::default(),
            mapper: String::new(),
            special_chips: Vec::new(),
            segments: Vec::new(),
            entry_points: vec![0],
            trace_note: String::new(),
        }
    }

    #[test]
    fn analyze_text_finds_ascii_regions() {
        let loaded = sample_loaded("megadrive", b"\0HELLO WORLD!\0".to_vec());
        let (regions, _) = analyze_text(&loaded);
        assert!(!regions.is_empty());
        assert!(regions[0].preview.contains("HELLO"));
    }

    #[test]
    fn analyze_text_finds_shift_jis_like_regions() {
        let loaded = sample_loaded("snes", vec![0x82, 0xA0, 0x82, 0xA2, 0x82, 0xA4, 0x00]);
        let (regions, _) = analyze_text(&loaded);
        assert!(regions
            .iter()
            .any(|region| region.encoding == "shift-jis-like"));
    }

    #[test]
    fn analyze_text_finds_megadrive_be32_pointer_table() {
        let mut rom = vec![0u8; 0x200];
        // 4 ASCII strings (>=6 chars each) at known offsets
        let strings: &[(&[u8], usize)] = &[
            (b"HELLO WORLD!!", 0x100),
            (b"GAME OVER!!! ", 0x110),
            (b"PLAYER ONE!! ", 0x120),
            (b"CONTINUE?!!? ", 0x130),
        ];
        for &(text, offset) in strings {
            let end = offset + text.len().min(rom.len() - offset);
            rom[offset..end].copy_from_slice(&text[..end - offset]);
        }
        // BE32 pointer table at offset 0x00 pointing to text offsets
        for (index, &(_, offset)) in strings.iter().enumerate() {
            let base = index * 4;
            rom[base..base + 4].copy_from_slice(&(offset as u32).to_be_bytes());
        }

        let loaded = sample_loaded("megadrive", rom);
        let (text_regions, pointer_tables) = analyze_text(&loaded);

        assert!(!text_regions.is_empty(), "should find text regions");
        assert!(!pointer_tables.is_empty(), "should find pointer tables");

        let table = &pointer_tables[0];
        assert_eq!(table.encoding, "be32");
        assert_eq!(table.entry_size, 4);
        assert!(table.destinations.len() >= 3);
        // Verify destinations point near our string offsets
        for &(_, offset) in &strings[..3] {
            assert!(
                table
                    .destinations
                    .iter()
                    .any(|dest| dest.abs_diff(offset as u32) <= 4),
                "destination should point near offset 0x{:X}",
                offset
            );
        }
    }

    #[test]
    fn analyze_text_finds_snes_le16_pointer_table() {
        let mut rom = vec![0u8; 0x200];
        // 4 ASCII strings at known offsets
        let strings: &[(&[u8], usize)] = &[
            (b"STAGE ONE!!!", 0x100),
            (b"STAGE TWO!!!", 0x110),
            (b"STAGE THREE!", 0x120),
            (b"FINAL BOSS!!", 0x130),
        ];
        for &(text, offset) in strings {
            let end = offset + text.len().min(rom.len() - offset);
            rom[offset..end].copy_from_slice(&text[..end - offset]);
        }
        // LE16 pointer table at offset 0x00 pointing to text offsets (low 16 bits)
        for (index, &(_, offset)) in strings.iter().enumerate() {
            let base = index * 2;
            rom[base..base + 2].copy_from_slice(&(offset as u16).to_le_bytes());
        }

        let loaded = sample_loaded("snes", rom);
        let (text_regions, pointer_tables) = analyze_text(&loaded);

        assert!(!text_regions.is_empty(), "should find text regions");
        assert!(!pointer_tables.is_empty(), "should find pointer tables");

        let table = &pointer_tables[0];
        assert_eq!(table.encoding, "le16");
        assert_eq!(table.entry_size, 2);
        assert!(table.destinations.len() >= 3);
    }
}
