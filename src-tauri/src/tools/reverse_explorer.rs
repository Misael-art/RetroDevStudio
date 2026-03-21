use std::fs;

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ReverseExplorerRow {
    pub offset: usize,
    pub bytes: Vec<u8>,
    pub ascii: String,
    pub annotation: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ReverseExplorerResult {
    pub ok: bool,
    pub error: String,
    pub total_size: usize,
    pub rows: Vec<ReverseExplorerRow>,
}

pub fn inspect_rom(
    rom_path: &str,
    target: &str,
    offset: usize,
    length: usize,
) -> ReverseExplorerResult {
    let rom = match fs::read(rom_path) {
        Ok(bytes) => bytes,
        Err(error) => {
            return ReverseExplorerResult {
                ok: false,
                error: format!("Falha ao ler ROM '{}': {}", rom_path, error),
                total_size: 0,
                rows: Vec::new(),
            }
        }
    };

    let total_size = rom.len();
    if offset >= total_size {
        return ReverseExplorerResult {
            ok: false,
            error: format!(
                "Offset 0x{:X} fora do tamanho da ROM ({} bytes).",
                offset, total_size
            ),
            total_size,
            rows: Vec::new(),
        };
    }

    let safe_length = length.max(16);
    let end = total_size.min(offset.saturating_add(safe_length));
    let chunk = &rom[offset..end];
    let rows = chunk
        .chunks(16)
        .enumerate()
        .map(|(index, row)| {
            let row_offset = offset + (index * 16);
            ReverseExplorerRow {
                offset: row_offset,
                bytes: row.to_vec(),
                ascii: row
                    .iter()
                    .map(|value| {
                        if (32..=126).contains(value) {
                            char::from(*value)
                        } else {
                            '.'
                        }
                    })
                    .collect(),
                annotation: annotate_row(row, target),
            }
        })
        .collect();

    ReverseExplorerResult {
        ok: true,
        error: String::new(),
        total_size,
        rows,
    }
}

fn annotate_row(bytes: &[u8], target: &str) -> String {
    let annotations = match target {
        "snes" => annotate_snes_row(bytes),
        _ => annotate_megadrive_row(bytes),
    };

    if annotations.is_empty() {
        "Sem opcode basico reconhecido neste bloco.".to_string()
    } else {
        annotations.join(" | ")
    }
}

fn annotate_megadrive_row(bytes: &[u8]) -> Vec<String> {
    let mut annotations = Vec::new();

    for index in (0..bytes.len().saturating_sub(1)).step_by(2) {
        let opcode = u16::from_be_bytes([bytes[index], bytes[index + 1]]);
        let name = match opcode {
            0x4E71 => Some("NOP"),
            0x4E75 => Some("RTS"),
            0x4EB9 => Some("JSR abs.l"),
            0x4EF9 => Some("JMP abs.l"),
            value if value & 0xFF00 == 0x6000 => Some("BRA"),
            value
                if (value & 0xF000) == 0x1000
                    || (value & 0xF000) == 0x2000
                    || (value & 0xF000) == 0x3000 =>
            {
                Some("MOVE")
            }
            _ => None,
        };

        if let Some(name) = name {
            annotations.push(format!("+0x{:02X}: {}", index, name));
        }
    }

    annotations
}

fn annotate_snes_row(bytes: &[u8]) -> Vec<String> {
    let mut annotations = Vec::new();

    for (index, opcode) in bytes.iter().enumerate() {
        let name = match opcode {
            0xA9 => Some("LDA #imm"),
            0x8D => Some("STA abs"),
            0x20 => Some("JSR abs"),
            0x4C => Some("JMP abs"),
            0x60 => Some("RTS"),
            0x80 => Some("BRA"),
            0xEA => Some("NOP"),
            _ => None,
        };

        if let Some(name) = name {
            annotations.push(format!("+0x{:02X}: {}", index, name));
        }
    }

    annotations
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_rom_path(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock drift")
            .as_nanos();
        std::env::temp_dir().join(format!("retrodev-{}-{}.bin", name, nanos))
    }

    #[test]
    fn inspect_rom_detects_megadrive_opcodes() {
        let rom_path = temp_rom_path("md-reverse");
        fs::write(&rom_path, [0x4E, 0x71, 0x4E, 0x75, 0x60, 0x00, 0x4E, 0xB9])
            .expect("write md rom");

        let result = inspect_rom(rom_path.to_string_lossy().as_ref(), "megadrive", 0, 16);

        assert!(result.ok, "result: {:?}", result);
        assert_eq!(result.rows.len(), 1);
        assert!(result.rows[0].annotation.contains("NOP"));
        assert!(result.rows[0].annotation.contains("RTS"));
        assert!(result.rows[0].annotation.contains("BRA"));
        assert!(result.rows[0].annotation.contains("JSR abs.l"));

        let _ = fs::remove_file(rom_path);
    }

    #[test]
    fn inspect_rom_detects_snes_opcodes() {
        let rom_path = temp_rom_path("snes-reverse");
        fs::write(&rom_path, [0xA9, 0x01, 0x8D, 0x00, 0x20, 0xEA, 0x60]).expect("write snes rom");

        let result = inspect_rom(rom_path.to_string_lossy().as_ref(), "snes", 0, 16);

        assert!(result.ok, "result: {:?}", result);
        assert_eq!(result.rows.len(), 1);
        assert!(result.rows[0].annotation.contains("LDA #imm"));
        assert!(result.rows[0].annotation.contains("STA abs"));
        assert!(result.rows[0].annotation.contains("JSR abs"));
        assert!(result.rows[0].annotation.contains("NOP"));
        assert!(result.rows[0].annotation.contains("RTS"));

        let _ = fs::remove_file(rom_path);
    }
}
