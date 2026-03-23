use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::manifest::{ReverseAnnotation, RomHashes};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
struct ReverseAnnotationFile {
    pub source_hashes: RomHashes,
    pub annotations: Vec<ReverseAnnotation>,
}

fn sidecar_path(rom_path: &Path) -> PathBuf {
    let file_name = rom_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("rom");
    rom_path.with_file_name(format!("{file_name}.retrodev.reverse.json"))
}

pub fn load_annotations(
    rom_path: &Path,
    hashes: &RomHashes,
) -> Result<Vec<ReverseAnnotation>, String> {
    let sidecar = sidecar_path(rom_path);
    if !sidecar.exists() {
        return Ok(Vec::new());
    }
    let contents = fs::read_to_string(&sidecar)
        .map_err(|error| format!("Falha ao ler anotacoes '{}': {}", sidecar.display(), error))?;
    let parsed: ReverseAnnotationFile = serde_json::from_str(&contents)
        .map_err(|error| format!("Falha ao decodificar anotacoes '{}': {}", sidecar.display(), error))?;
    if parsed.source_hashes != *hashes {
        return Ok(Vec::new());
    }
    Ok(parsed.annotations)
}

pub fn save_annotations(
    rom_path: &Path,
    hashes: &RomHashes,
    annotations: &[ReverseAnnotation],
) -> Result<usize, String> {
    let sidecar = sidecar_path(rom_path);
    let payload = ReverseAnnotationFile {
        source_hashes: hashes.clone(),
        annotations: annotations.to_vec(),
    };
    let json = serde_json::to_string_pretty(&payload)
        .map_err(|error| format!("Falha ao serializar anotacoes: {}", error))?;
    fs::write(&sidecar, json)
        .map_err(|error| format!("Falha ao salvar anotacoes '{}': {}", sidecar.display(), error))?;
    Ok(annotations.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_rom_path(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock drift")
            .as_nanos();
        std::env::temp_dir().join(format!("retrodev-annotations-{}-{}.bin", name, nonce))
    }

    #[test]
    fn save_and_load_annotations_roundtrip() {
        let rom_path = temp_rom_path("roundtrip");
        fs::write(&rom_path, [0u8; 4]).expect("write temp rom");
        let hashes = RomHashes {
            crc32: "deadbeef".to_string(),
            sha1: "0123456789abcdef0123456789abcdef01234567".to_string(),
        };
        let annotations = vec![ReverseAnnotation {
            kind: "function".to_string(),
            start: 0x200,
            end: Some(0x220),
            label: "Init".to_string(),
            comment: "Boot routine".to_string(),
        }];

        save_annotations(&rom_path, &hashes, &annotations).expect("save annotations");
        let reloaded = load_annotations(&rom_path, &hashes).expect("load annotations");
        assert_eq!(reloaded, annotations);

        let sidecar = sidecar_path(&rom_path);
        let _ = fs::remove_file(sidecar);
        let _ = fs::remove_file(rom_path);
    }
}
