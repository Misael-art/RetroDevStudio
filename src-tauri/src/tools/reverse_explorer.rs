use serde::Serialize;
use std::path::Path;

use crate::tools::reverse;

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

fn ascii_preview(bytes: &[u8]) -> String {
    bytes.iter()
        .map(|value| {
            if (32..=126).contains(value) {
                char::from(*value)
            } else {
                '.'
            }
        })
        .collect()
}

pub fn inspect_rom(
    rom_path: &str,
    _target: &str,
    offset: usize,
    length: usize,
) -> ReverseExplorerResult {
    let loaded = match reverse::loader::load_rom(Path::new(rom_path)) {
        Ok(loaded) => loaded,
        Err(error) => {
            return ReverseExplorerResult {
                ok: false,
                error,
                total_size: 0,
                rows: Vec::new(),
            }
        }
    };

    let disassembly = reverse::code::disassemble_region(&loaded, offset, length);
    if !disassembly.ok {
        return ReverseExplorerResult {
            ok: false,
            error: disassembly.error,
            total_size: disassembly.total_size,
            rows: Vec::new(),
        };
    }

    ReverseExplorerResult {
        ok: true,
        error: String::new(),
        total_size: disassembly.total_size,
        rows: disassembly
            .rows
            .into_iter()
            .map(|row| ReverseExplorerRow {
                offset: row.offset as usize,
                ascii: ascii_preview(&row.bytes),
                bytes: row.bytes,
                annotation: row.text,
            })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_rom_path(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock drift")
            .as_nanos();
        std::env::temp_dir().join(format!("retrodev-reverse-{}-{}.bin", name, nanos))
    }

    #[test]
    fn inspect_rom_uses_canonical_disassembly_for_megadrive() {
        let rom_path = temp_rom_path("md");
        let mut rom = vec![0u8; 0x200];
        rom[0x100..0x110].copy_from_slice(b"SEGA GENESIS    ");
        rom[0..8].copy_from_slice(&[0, 0, 0, 0, 0, 0, 0x02, 0x00]);
        rom.extend_from_slice(&[0x4E, 0x71, 0x4E, 0x75]);
        fs::write(&rom_path, &rom).expect("write md rom");

        let result = inspect_rom(rom_path.to_string_lossy().as_ref(), "megadrive", 0x200, 8);

        assert!(result.ok, "result: {:?}", result);
        assert_eq!(result.rows.len(), 2);
        assert!(result.rows[0].annotation.contains("nop"));
        assert!(result.rows[1].annotation.contains("rts"));

        let _ = fs::remove_file(rom_path);
    }

    #[test]
    fn inspect_rom_uses_canonical_disassembly_for_snes() {
        let rom_path = temp_rom_path("snes");
        let mut rom = vec![0u8; 0x10000];
        rom[0x7FC0..0x7FD5].copy_from_slice(b"RETRODEV SNES TEST   ");
        rom[0x7FDC] = 0x00;
        rom[0x7FDD] = 0x80;
        rom[0..4].copy_from_slice(&[0xA9, 0x01, 0x60, 0xEA]);
        fs::write(&rom_path, &rom).expect("write snes rom");

        let result = inspect_rom(rom_path.to_string_lossy().as_ref(), "snes", 0, 8);

        assert!(result.ok, "result: {:?}", result);
        assert!(result.rows[0].annotation.contains("lda"));
        assert!(result.rows[1].annotation.contains("rts"));

        let _ = fs::remove_file(rom_path);
    }
}
