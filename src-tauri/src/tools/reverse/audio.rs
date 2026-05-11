use super::manifest::AudioCandidate;
use super::platform::LoadedRom;

fn find_ascii_signature(bytes: &[u8], needle: &str) -> Option<usize> {
    let haystack = String::from_utf8_lossy(bytes).to_ascii_uppercase();
    haystack.find(&needle.to_ascii_uppercase())
}

pub fn analyze_audio(loaded: &LoadedRom) -> Vec<AudioCandidate> {
    let mut out = Vec::new();
    let signatures: &[(&str, &str, &str)] = if loaded.target == "megadrive" {
        &[
            ("SMPS", "sequence_driver", "SMPS"),
            ("GEMS", "sequence_driver", "GEMS"),
            ("XGM", "sequence_driver", "XGM"),
            ("YM2612", "hardware_marker", "YM2612"),
        ]
    } else {
        &[
            ("N-SPC", "sequence_driver", "N-SPC"),
            ("SPC700", "sequence_driver", "SPC700"),
            ("HAL", "sequence_driver", "HAL"),
            ("BRR", "sample_bank", "BRR"),
        ]
    };

    for (needle, format, driver) in signatures {
        if let Some(offset) = find_ascii_signature(&loaded.bytes, needle) {
            out.push(AudioCandidate {
                id: format!("aud_{:03}", out.len()),
                start: offset as u32,
                end: (offset + needle.len()).min(loaded.bytes.len()) as u32,
                format: (*format).to_string(),
                driver: Some((*driver).to_string()),
                confidence: 78,
                note: format!("Assinatura '{}'", needle),
            });
        }
    }

    if loaded.target == "snes" {
        let bytes = &loaded.bytes;
        let mut offset = 0usize;
        while offset + 9 <= bytes.len() && out.len() < 6 {
            let header = bytes[offset];
            if header & 0x0F <= 0x03 {
                let mut blocks = 0usize;
                let start = offset;
                while offset + 9 <= bytes.len() && bytes[offset] & 0x0F <= 0x03 && blocks < 128 {
                    blocks += 1;
                    let end_flag = bytes[offset] & 0x01 != 0;
                    offset += 9;
                    if end_flag {
                        break;
                    }
                }
                if blocks >= 4 {
                    out.push(AudioCandidate {
                        id: format!("aud_{:03}", out.len()),
                        start: start as u32,
                        end: offset as u32,
                        format: "sample_bank".to_string(),
                        driver: Some("BRR".to_string()),
                        confidence: 61,
                        note: format!("Sequencia candidata de {} blocos BRR.", blocks),
                    });
                }
            } else {
                offset += 1;
            }
        }
    }

    out
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
    fn analyze_audio_detects_megadrive_signatures() {
        let loaded = sample_loaded("megadrive", b"....XGM....".to_vec());
        let regions = analyze_audio(&loaded);
        assert!(regions.iter().any(|region| region.driver.as_deref() == Some("XGM")));
    }

    #[test]
    fn analyze_audio_detects_snes_brr_candidates() {
        let mut bytes = Vec::new();
        for _ in 0..4 {
            bytes.push(0x00);
            bytes.extend_from_slice(&[0u8; 8]);
        }
        let loaded = sample_loaded("snes", bytes);
        let regions = analyze_audio(&loaded);
        assert!(!regions.is_empty());
    }
}
