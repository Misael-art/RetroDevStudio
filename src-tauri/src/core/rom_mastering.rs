use crate::core::diagnostics::{ActionableDiagnostic, DiagnosticArea, DiagnosticSeverity};
use crate::core::project_capability::capability_diagnostic;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct RomRegionReport {
    pub value: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct RomSramReport {
    pub present: bool,
    pub status: String,
    pub range: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct RomChecksumReport {
    pub expected: Option<String>,
    pub observed: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct RomMasteringReport {
    pub source_path: String,
    pub extension: String,
    pub size_bytes: u64,
    pub alignment: String,
    pub sha256: String,
    pub platform: Option<String>,
    pub header_signature: Option<String>,
    pub internal_title: Option<String>,
    pub region: RomRegionReport,
    pub sram: RomSramReport,
    pub checksum: RomChecksumReport,
    pub emulator_core: Option<String>,
    pub warnings: Vec<String>,
    pub blockers: Vec<ActionableDiagnostic>,
}

pub fn inspect_rom_mastering(rom_path: &Path) -> Result<RomMasteringReport, String> {
    if !rom_path.exists() {
        return Err(format!(
            "O que quebrou: ROM nao encontrada. Por que importa: o mastering report so pode inspecionar artefato real. Onde corrigir: '{}'. Proxima acao: rode Build & Run ou selecione uma ROM existente.",
            rom_path.display()
        ));
    }
    let bytes = fs::read(rom_path).map_err(|error| {
        format!(
            "O que quebrou: falha ao ler ROM. Por que importa: nao e seguro calcular header/checksum sem bytes reais. Onde corrigir: '{}'. Proxima acao: confira permissoes e gere a ROM novamente. Detalhe: {}",
            rom_path.display(),
            error
        )
    })?;
    let extension = rom_path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let mut report = RomMasteringReport {
        source_path: rom_path.to_string_lossy().to_string(),
        extension,
        size_bytes: bytes.len() as u64,
        alignment: rom_alignment(bytes.len()),
        sha256: sha256_hex(&bytes),
        platform: None,
        header_signature: None,
        internal_title: None,
        region: RomRegionReport {
            value: None,
            status: "unknown".to_string(),
        },
        sram: RomSramReport {
            present: false,
            status: "unknown".to_string(),
            range: None,
        },
        checksum: RomChecksumReport {
            expected: None,
            observed: None,
            status: "not_applicable".to_string(),
        },
        emulator_core: None,
        warnings: Vec::new(),
        blockers: Vec::new(),
    };

    if bytes.get(0x100..0x104) == Some(&b"SEGA"[..]) {
        apply_megadrive_header(&mut report, &bytes);
    } else if let Some(header_offset) = detect_snes_header(&bytes) {
        apply_snes_header(&mut report, &bytes, header_offset);
    } else {
        report.warnings.push(
            "Header SEGA/SNES nao detectado; arquivo tratado como ROM desconhecida.".to_string(),
        );
        report.blockers.push(capability_diagnostic(
            DiagnosticArea::RomMastering,
            DiagnosticSeverity::Error,
            "ROM sem header reconhecido para mastering.",
            "Assinatura SEGA em 0x100 e header SNES LoROM/HiROM nao foram detectados.",
            "Confirme o target, remova copier header quando aplicavel ou gere a ROM pelo Build canonico.",
            true,
            Some(report.source_path.clone()),
        ));
    }

    Ok(report)
}

fn apply_megadrive_header(report: &mut RomMasteringReport, bytes: &[u8]) {
    report.platform = Some("megadrive".to_string());
    report.header_signature = Some("SEGA".to_string());
    report.internal_title = ascii_field(bytes, 0x120, 48);

    let region = ascii_field(bytes, 0x1F0, 16).unwrap_or_default();
    let region_valid = !region.is_empty()
        && region.chars().all(|ch| {
            matches!(
                ch,
                'J' | 'U' | 'E' | 'W' | 'A' | 'B' | '4' | '1' | '0' | ' '
            )
        });
    report.region = RomRegionReport {
        value: (!region.is_empty()).then_some(region.clone()),
        status: if region_valid { "valid" } else { "invalid" }.to_string(),
    };
    if !region_valid {
        report.warnings.push(format!(
            "regiao Mega Drive invalida ou ausente: '{}'",
            region
        ));
    }

    let sram_present = bytes.get(0x1B0..0x1B2) == Some(&b"RA"[..]);
    let sram_range = if sram_present && bytes.len() >= 0x1BC {
        let start = u32::from_be_bytes([bytes[0x1B4], bytes[0x1B5], bytes[0x1B6], bytes[0x1B7]]);
        let end = u32::from_be_bytes([bytes[0x1B8], bytes[0x1B9], bytes[0x1BA], bytes[0x1BB]]);
        if start != 0 || end != 0 {
            Some(format!("0x{start:08X}-0x{end:08X}"))
        } else {
            None
        }
    } else {
        None
    };
    report.sram = RomSramReport {
        present: sram_present,
        status: if sram_present { "present" } else { "absent" }.to_string(),
        range: sram_range,
    };

    if bytes.len() >= 0x190 {
        let expected = u16::from_be_bytes([bytes[0x18E], bytes[0x18F]]);
        let observed = megadrive_checksum(bytes);
        let status = if expected == observed {
            "matching"
        } else {
            "mismatch"
        };
        report.checksum = RomChecksumReport {
            expected: Some(format!("{expected:04X}")),
            observed: Some(format!("{observed:04X}")),
            status: status.to_string(),
        };
        if status == "mismatch" {
            report.blockers.push(capability_diagnostic(
                DiagnosticArea::RomMastering,
                DiagnosticSeverity::Error,
                "ROM checksum divergente.",
                format!("Checksum esperado {expected:04X}, observado {observed:04X}."),
                "Recompile a ROM pelo fluxo canonico ou atualize o header pelo toolchain apropriado antes de publicar evidencia.",
                true,
                Some(report.source_path.clone()),
            ));
        }
    }
}

fn apply_snes_header(report: &mut RomMasteringReport, bytes: &[u8], header_offset: usize) {
    report.platform = Some("snes".to_string());
    report.header_signature = Some(format!("SNES@0x{header_offset:X}"));
    report.internal_title = ascii_field(bytes, header_offset, 21);
    let country = bytes.get(header_offset + 0x19).copied();
    report.region = RomRegionReport {
        value: country.map(|value| format!("0x{value:02X}")),
        status: match country {
            Some(0x00 | 0x01 | 0x02 | 0x03 | 0x0D) => "valid",
            Some(_) => "invalid",
            None => "unknown",
        }
        .to_string(),
    };
    report.sram = RomSramReport {
        present: bytes
            .get(header_offset + 0x18)
            .copied()
            .is_some_and(|ram_size| ram_size > 0),
        status: if bytes
            .get(header_offset + 0x18)
            .copied()
            .is_some_and(|ram_size| ram_size > 0)
        {
            "present"
        } else {
            "absent"
        }
        .to_string(),
        range: None,
    };
    if bytes.len() >= header_offset + 0x20 {
        let complement =
            u16::from_le_bytes([bytes[header_offset + 0x1C], bytes[header_offset + 0x1D]]);
        let expected =
            u16::from_le_bytes([bytes[header_offset + 0x1E], bytes[header_offset + 0x1F]]);
        let status = if expected ^ complement == 0xFFFF {
            "header_complement_ok"
        } else {
            "mismatch"
        };
        report.checksum = RomChecksumReport {
            expected: Some(format!("{expected:04X}")),
            observed: Some(format!("{:04X}", !complement)),
            status: status.to_string(),
        };
    }
}

fn ascii_field(bytes: &[u8], offset: usize, len: usize) -> Option<String> {
    let slice = bytes.get(offset..offset + len)?;
    let text = slice
        .iter()
        .map(|byte| {
            if byte.is_ascii_graphic() || *byte == b' ' {
                *byte as char
            } else {
                ' '
            }
        })
        .collect::<String>()
        .trim()
        .to_string();
    (!text.is_empty()).then_some(text)
}

fn rom_alignment(len: usize) -> String {
    if len == 0 {
        return "empty".to_string();
    }
    if len.is_multiple_of(0x8000) {
        "aligned_32kb".to_string()
    } else if len.is_multiple_of(0x200) {
        "aligned_512b".to_string()
    } else {
        "unaligned".to_string()
    }
}

fn megadrive_checksum(bytes: &[u8]) -> u16 {
    let mut sum = 0u32;
    let mut offset = 0x200usize;
    while offset < bytes.len() {
        let hi = bytes[offset];
        let lo = bytes.get(offset + 1).copied().unwrap_or(0);
        sum = sum.wrapping_add(u16::from_be_bytes([hi, lo]) as u32);
        offset += 2;
    }
    sum as u16
}

fn detect_snes_header(bytes: &[u8]) -> Option<usize> {
    [0x7FC0usize, 0xFFC0, 0x81C0, 0x101C0]
        .into_iter()
        .find(|offset| snes_header_score(bytes, *offset) >= 2)
}

fn snes_header_score(bytes: &[u8], offset: usize) -> u8 {
    if bytes.len() < offset + 0x20 {
        return 0;
    }
    let mut score = 0;
    if ascii_field(bytes, offset, 21).is_some() {
        score += 1;
    }
    let complement = u16::from_le_bytes([bytes[offset + 0x1C], bytes[offset + 0x1D]]);
    let checksum = u16::from_le_bytes([bytes[offset + 0x1E], bytes[offset + 0x1F]]);
    if complement ^ checksum == 0xFFFF {
        score += 2;
    }
    let map_mode = bytes[offset + 0x15];
    if matches!(map_mode, 0x20 | 0x21 | 0x30 | 0x31) {
        score += 1;
    }
    score
}

fn sha256_hex(data: &[u8]) -> String {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];
    let mut h = [
        0x6a09e667u32,
        0xbb67ae85,
        0x3c6ef372,
        0xa54ff53a,
        0x510e527f,
        0x9b05688c,
        0x1f83d9ab,
        0x5be0cd19,
    ];
    let bit_len = (data.len() as u64) * 8;
    let mut msg = data.to_vec();
    msg.push(0x80);
    while (msg.len() % 64) != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in msg.chunks(64) {
        let mut w = [0u32; 64];
        for (i, word) in w.iter_mut().take(16).enumerate() {
            let j = i * 4;
            *word = u32::from_be_bytes([chunk[j], chunk[j + 1], chunk[j + 2], chunk[j + 3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }
        let mut a = h[0];
        let mut b = h[1];
        let mut c = h[2];
        let mut d = h[3];
        let mut e = h[4];
        let mut f = h[5];
        let mut g = h[6];
        let mut hh = h[7];
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);
            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }
        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }
    h.iter()
        .map(|word| format!("{word:08x}"))
        .collect::<Vec<_>>()
        .join("")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("rds-rom-mastering-{name}-{stamp}"));
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn md_checksum(bytes: &[u8]) -> u16 {
        let mut sum = 0u32;
        let mut offset = 0x200usize;
        while offset < bytes.len() {
            let hi = bytes[offset] as u16;
            let lo = bytes.get(offset + 1).copied().unwrap_or(0) as u16;
            sum = sum.wrapping_add(u16::from_be_bytes([hi as u8, lo as u8]) as u32);
            offset += 2;
        }
        sum as u16
    }

    fn write_md_rom(
        name: &str,
        region: &[u8],
        sram: bool,
        expected_checksum: Option<u16>,
    ) -> PathBuf {
        let dir = temp_dir(name);
        let rom = dir.join("game.bin");
        let mut bytes = vec![0u8; 0x400];
        bytes[0x100..0x104].copy_from_slice(b"SEGA");
        bytes[0x120..0x120 + 10].copy_from_slice(b"RDS TEST  ");
        bytes[0x1F0..0x1F0 + region.len().min(16)].copy_from_slice(&region[..region.len().min(16)]);
        if sram {
            bytes[0x1B0..0x1B2].copy_from_slice(b"RA");
        }
        let checksum = expected_checksum.unwrap_or_else(|| md_checksum(&bytes));
        bytes[0x18E..0x190].copy_from_slice(&checksum.to_be_bytes());
        fs::write(&rom, bytes).expect("write rom");
        rom
    }

    #[test]
    fn rom_mastering_detects_valid_sega_header_and_matching_checksum() {
        let rom = write_md_rom("valid-md", b"JUE", true, None);

        let report = inspect_rom_mastering(&rom).expect("report");

        assert_eq!(report.platform.as_deref(), Some("megadrive"));
        assert_eq!(report.header_signature.as_deref(), Some("SEGA"));
        assert!(report.sram.present);
        assert_eq!(report.checksum.status, "matching");
        assert_eq!(report.region.status, "valid");
        assert_eq!(report.blockers.len(), 0);
        assert_eq!(report.sha256.len(), 64);
    }

    #[test]
    fn rom_mastering_reports_checksum_divergence_as_blocking() {
        let rom = write_md_rom("bad-checksum", b"JUE", true, Some(0x1234));

        let report = inspect_rom_mastering(&rom).expect("report");

        assert_eq!(report.checksum.status, "mismatch");
        assert!(report
            .blockers
            .iter()
            .any(|diagnostic| diagnostic.user_message.contains("checksum")));
    }

    #[test]
    fn rom_mastering_distinguishes_absent_sram() {
        let rom = write_md_rom("no-sram", b"JUE", false, None);

        let report = inspect_rom_mastering(&rom).expect("report");

        assert!(!report.sram.present);
        assert_eq!(report.sram.status, "absent");
    }

    #[test]
    fn rom_mastering_warns_on_invalid_region() {
        let rom = write_md_rom("bad-region", b"??", false, None);

        let report = inspect_rom_mastering(&rom).expect("report");

        assert_eq!(report.region.status, "invalid");
        assert!(report
            .warnings
            .iter()
            .any(|warning| warning.contains("regiao")));
    }

    #[test]
    fn rom_mastering_json_shape_is_stable() {
        let rom = write_md_rom("json", b"JUE", false, None);
        let report = inspect_rom_mastering(&rom).expect("report");

        let json = serde_json::to_string(&report).expect("json");

        assert!(json.starts_with("{\"source_path\""));
        assert!(json.contains("\"platform\":\"megadrive\""));
        assert!(json.contains("\"checksum\""));
        assert!(json.contains("\"blockers\""));
    }
}
