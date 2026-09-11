// Superfície REX-02 em construção: consumidores públicos hoje são provas
// `#[ignore]` e testes; comandos IPC chegam com REX-04+. Segue o precedente
// de `manifest.rs`/`equivalence.rs` sem afrouxar o gate global.
#![allow(dead_code)]

use std::fs;
use std::path::Path;

use super::manifest::{NormalizationStep, RomAnalysisManifest, RomContainerInfo, RomHashes};
use super::platform::{
    identify_md, interleave_smd, swap_bytes16, LoadedRom, MdVariant, MegaDriveAdapter,
    ReversePlatformAdapter, SnesAdapter,
};

/// REX-02: identidade de uma imagem MD com proveniência completa — bytes
/// originais, contêiner, variante física, passos de normalização (todos
/// reversíveis) e bytes normalizados por hash. `detached_prefix` preserva o
/// header removido do dump `.smd` para que desfazer restitua o original.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RexRomIdentity {
    pub original_sha256: String,
    pub original_size: usize,
    pub container: RomContainerInfo,
    pub variant: String,
    pub normalized_sha256: String,
    pub normalized_size: usize,
    /// Divergência header x tamanho real (comum em dumps reais); nunca erro.
    pub size_note: Option<String>,
    pub normalization: Vec<NormalizationStep>,
    pub detached_prefix: Vec<u8>,
    pub header_console: String,
    pub header_title: String,
    pub region: Option<String>,
    pub version: Option<String>,
}

/// Identifica e normaliza a partir dos bytes em memória.
pub fn rex_identify_bytes(raw: &[u8]) -> Result<RexRomIdentity, String> {
    let (variant, normalized) = identify_md(raw).map_err(|error| error.message())?;
    let original_sha256 = crate::core::rom_mastering::sha256_hex(raw);
    let normalized_sha256 = crate::core::rom_mastering::sha256_hex(&normalized);
    let normalization = super::platform::md_normalization_steps(
        &original_sha256,
        raw,
        variant.clone(),
        &normalized_sha256,
    );
    let detached_prefix = match &variant {
        MdVariant::SmdInterleaved { header_len } if *header_len > 0 => raw[..*header_len].to_vec(),
        _ => Vec::new(),
    };
    let trim = |bytes: &[u8]| {
        String::from_utf8_lossy(bytes)
            .trim_matches(char::from(0))
            .trim()
            .to_string()
    };
    let size_note = super::platform::md_size_note(&normalized);
    let mut container_note = format!(
        "variante fisica identificada por conteudo: {} (extensao ignorada)",
        variant.label()
    );
    if let Some(note) = &size_note {
        container_note.push_str("; ");
        container_note.push_str(note);
    }
    Ok(RexRomIdentity {
        original_sha256,
        original_size: raw.len(),
        container: RomContainerInfo {
            kind: "plain_file".to_string(),
            member: None,
            note: container_note,
        },
        variant: variant.label().to_string(),
        normalized_sha256,
        normalized_size: normalized.len(),
        size_note,
        normalization,
        detached_prefix,
        header_console: trim(&normalized[0x100..0x110]),
        header_title: trim(&normalized[0x150..0x180]),
        region: Some(trim(&normalized[0x1F0..0x1F3])),
        version: Some(trim(&normalized[0x18C..0x18E])),
    })
}

/// Identifica e normaliza a partir de um arquivo; contêineres não suportados
/// falham com erro acionável (nunca seleção arbitrária de membro).
pub fn rex_identify_rom(rom_path: &Path) -> Result<RexRomIdentity, String> {
    let raw = fs::read(rom_path)
        .map_err(|error| format!("Falha ao ler ROM '{}': {}", rom_path.display(), error))?;
    rex_identify_bytes(&raw)
}

/// Desfaz a normalização passo a passo (ordem inversa), verificando a cadeia
/// de hashes gravada antes de cada inversão. Restitui os bytes originais.
pub fn rex_undo_normalization(
    identity: &RexRomIdentity,
    normalized: &[u8],
) -> Result<Vec<u8>, String> {
    let mut bytes = normalized.to_vec();
    for step in identity.normalization.iter().rev() {
        let current_sha256 = crate::core::rom_mastering::sha256_hex(&bytes);
        if current_sha256 != step.output_sha256 {
            return Err(format!(
                "cadeia de normalizacao inconsistente: bytes atuais nao correspondem a \
                 '{}.output_sha256' (esperado {}, observado {})",
                step.name, step.output_sha256, current_sha256
            ));
        }
        bytes = match step.name.as_str() {
            "deinterleave_smd_512" => {
                if !bytes.len().is_multiple_of(512) || bytes.is_empty() {
                    return Err(format!(
                        "impossivel reinterleave: tamanho {} nao e multiplo de 512",
                        bytes.len()
                    ));
                }
                interleave_smd(&bytes)
            }
            "swap_bytes16" => swap_bytes16(&bytes)
                .ok_or_else(|| "impossivel desfazer byteswap: tamanho impar".to_string())?,
            "strip_smd_header" => {
                let mut restored = identity.detached_prefix.clone();
                restored.extend_from_slice(&bytes);
                restored
            }
            other => {
                return Err(format!(
                    "passo de normalizacao sem inverso registrado: '{other}'"
                ))
            }
        };
    }
    Ok(bytes)
}

fn crc32_simple(data: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for &byte in data {
        crc ^= byte as u32;
        for _ in 0..8 {
            if crc & 1 != 0 {
                crc = (crc >> 1) ^ 0xEDB8_8320;
            } else {
                crc >>= 1;
            }
        }
    }
    !crc
}

fn sha1_simple(data: &[u8]) -> [u8; 20] {
    let mut h0 = 0x6745_2301u32;
    let mut h1 = 0xEFCD_AB89u32;
    let mut h2 = 0x98BA_DCFEu32;
    let mut h3 = 0x1032_5476u32;
    let mut h4 = 0xC3D2_E1F0u32;

    let bit_len = (data.len() as u64) * 8;
    let mut padded = data.to_vec();
    padded.push(0x80);
    while !(padded.len() + 8).is_multiple_of(64) {
        padded.push(0);
    }
    padded.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in padded.chunks(64) {
        let mut w = [0u32; 80];
        for (index, word) in w.iter_mut().take(16).enumerate() {
            let base = index * 4;
            *word = u32::from_be_bytes([
                chunk[base],
                chunk[base + 1],
                chunk[base + 2],
                chunk[base + 3],
            ]);
        }
        for index in 16..80 {
            w[index] = (w[index - 3] ^ w[index - 8] ^ w[index - 14] ^ w[index - 16]).rotate_left(1);
        }

        let (mut a, mut b, mut c, mut d, mut e) = (h0, h1, h2, h3, h4);
        for (index, value) in w.iter().enumerate() {
            let (f, k) = match index {
                0..=19 => ((b & c) | ((!b) & d), 0x5A82_7999),
                20..=39 => (b ^ c ^ d, 0x6ED9_EBA1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1B_BCDC),
                _ => (b ^ c ^ d, 0xCA62_C1D6),
            };
            let temp = a
                .rotate_left(5)
                .wrapping_add(f)
                .wrapping_add(e)
                .wrapping_add(k)
                .wrapping_add(*value);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = temp;
        }

        h0 = h0.wrapping_add(a);
        h1 = h1.wrapping_add(b);
        h2 = h2.wrapping_add(c);
        h3 = h3.wrapping_add(d);
        h4 = h4.wrapping_add(e);
    }

    let mut out = [0u8; 20];
    out[..4].copy_from_slice(&h0.to_be_bytes());
    out[4..8].copy_from_slice(&h1.to_be_bytes());
    out[8..12].copy_from_slice(&h2.to_be_bytes());
    out[12..16].copy_from_slice(&h3.to_be_bytes());
    out[16..20].copy_from_slice(&h4.to_be_bytes());
    out
}

fn hex_lower(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        let _ = write!(&mut out, "{:02x}", byte);
    }
    out
}

pub fn load_rom(rom_path: &Path) -> Result<LoadedRom, String> {
    let raw_bytes = fs::read(rom_path)
        .map_err(|error| format!("Falha ao ler ROM '{}': {}", rom_path.display(), error))?;
    let adapters: [&dyn ReversePlatformAdapter; 2] = [&MegaDriveAdapter, &SnesAdapter];
    let best = adapters
        .iter()
        .map(|adapter| (adapter.detect_score(rom_path, &raw_bytes), *adapter))
        .max_by_key(|(score, _)| *score)
        .ok_or_else(|| "Nenhum adapter reverso registrado.".to_string())?;

    if best.0 == 0 {
        return Err(format!(
            "Nao foi possivel determinar a plataforma da ROM '{}'.",
            rom_path.display()
        ));
    }

    best.1.load(rom_path, &raw_bytes)
}

pub fn compute_hashes(bytes: &[u8]) -> RomHashes {
    RomHashes {
        crc32: format!("{:08x}", crc32_simple(bytes)),
        sha1: hex_lower(&sha1_simple(bytes)),
    }
}

pub fn base_manifest(loaded: &LoadedRom) -> RomAnalysisManifest {
    RomAnalysisManifest {
        ok: true,
        error: String::new(),
        target: loaded.target.clone(),
        source_path: loaded.source_path.clone(),
        detected_format: loaded.detected_format.clone(),
        stripped_header_bytes: loaded.stripped_header_bytes,
        total_size: loaded.bytes.len(),
        hashes: compute_hashes(&loaded.bytes),
        container: loaded.container.clone(),
        normalization: loaded.normalization.clone(),
        header: loaded.header.clone(),
        mapper: loaded.mapper.clone(),
        special_chips: loaded.special_chips.clone(),
        segments: loaded.segments.clone(),
        graphics_regions: Vec::new(),
        text_regions: Vec::new(),
        audio_regions: Vec::new(),
        code_regions: Vec::new(),
        pointer_tables: Vec::new(),
        compression_regions: Vec::new(),
        call_graph: Vec::new(),
        logic_hints: Vec::new(),
        annotations: Vec::new(),
        trace: super::trace::default_trace_status(loaded),
        save: Default::default(),
        projection_status: Default::default(),
    }
}

#[cfg(test)]
mod tests {
    use super::super::platform::{interleave_smd, swap_bytes16};
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_rom_path(name: &str, ext: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock drift")
            .as_nanos();
        std::env::temp_dir().join(format!("retrodev-loader-{}-{}.{}", name, nonce, ext))
    }

    #[test]
    fn load_rom_detects_megadrive_header_and_entrypoint() {
        let path = temp_rom_path("md", "bin");
        let mut rom = vec![0u8; 0x400];
        rom[4..8].copy_from_slice(&0x0000_0200u32.to_be_bytes());
        rom[0x100..0x110].copy_from_slice(b"SEGA GENESIS    ");
        rom[0x150..0x159].copy_from_slice(b"RETRODEV ");
        std::fs::write(&path, &rom).expect("write md rom");

        let loaded = load_rom(&path).expect("load md rom");

        assert_eq!(loaded.target, "megadrive");
        assert_eq!(loaded.header.entry_point, Some(0x200));
        assert!(loaded.header.console_name.contains("SEGA"));

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn load_rom_detects_snes_and_strips_copier_header() {
        let path = temp_rom_path("snes", "smc");
        let mut rom = vec![0u8; 512 + 0x10000];
        let base = 512;
        rom[base + 0x7FC0..base + 0x7FD5].copy_from_slice(b"RETRODEV SNES TEST   ");
        rom[base + 0x7FDC] = 0x00;
        rom[base + 0x7FDD] = 0x80;
        std::fs::write(&path, &rom).expect("write snes rom");

        let loaded = load_rom(&path).expect("load snes rom");

        assert_eq!(loaded.target, "snes");
        assert_eq!(loaded.stripped_header_bytes, 512);
        assert_eq!(loaded.header.entry_point, Some(0));

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn compute_hashes_returns_expected_lengths() {
        let hashes = compute_hashes(b"retrodev");
        assert_eq!(hashes.crc32.len(), 8);
        assert_eq!(hashes.sha1.len(), 40);
    }

    // ----- REX-02: identificação e normalização reversível -----

    /// Fixture sintética BYOR-safe: ROM MD raw com header canônico e fim de
    /// ROM declarado coerente com o tamanho.
    fn synthetic_md_rom() -> Vec<u8> {
        let mut rom = vec![0xA5u8; 0x4000];
        rom[4..8].copy_from_slice(&0x0000_0200u32.to_be_bytes());
        rom[0x100..0x110].copy_from_slice(b"SEGA GENESIS    ");
        rom[0x150..0x159].copy_from_slice(b"REX02TEST");
        let end = (rom.len() as u32 - 1).to_be_bytes();
        rom[0x1A4..0x1A8].copy_from_slice(&end);
        rom
    }

    #[test]
    fn rex02_identifies_raw_by_content_and_ignores_extension() {
        let rom = synthetic_md_rom();
        let expected_sha = crate::core::rom_mastering::sha256_hex(&rom);
        for ext in ["bin", "gen", "md", "smd", "tmp"] {
            let identity = rex_identify_bytes(&rom).expect("identificar raw");
            assert_eq!(
                identity.variant, "raw",
                "extensão .{ext} não muda a variante"
            );
            assert_eq!(identity.original_sha256, expected_sha);
            assert_eq!(identity.normalized_sha256, expected_sha);
            assert!(identity.normalization.is_empty(), "raw não aplica passos");
            assert_eq!(identity.container.kind, "plain_file");
            assert_eq!(identity.header_console, "SEGA GENESIS");
        }
    }

    #[test]
    fn rex02_smd_interleaved_round_trip_restores_original_sha() {
        let rom = synthetic_md_rom();
        let original_sha = crate::core::rom_mastering::sha256_hex(&rom);
        let interleaved = interleave_smd(&rom);
        assert_ne!(
            interleaved, rom,
            "fixture precisa realmente estar intercalada"
        );

        let identity = rex_identify_bytes(&interleaved).expect("identificar smd");
        assert_eq!(identity.variant, "smd_interleaved");
        assert_eq!(
            identity.original_sha256,
            crate::core::rom_mastering::sha256_hex(&interleaved)
        );
        assert_eq!(
            identity.normalized_sha256, original_sha,
            "normalização devolve exatamente a ROM original"
        );
        assert_eq!(identity.normalization.len(), 1);
        assert_eq!(identity.normalization[0].name, "deinterleave_smd_512");
        assert!(identity.normalization[0].reversible);

        let restored = rex_undo_normalization(&identity, &rom).expect("desfazer");
        assert_eq!(
            crate::core::rom_mastering::sha256_hex(&restored),
            identity.original_sha256,
            "desfazer restitui o SHA original"
        );
        assert_eq!(
            restored, interleaved,
            "undo é byte-exato contra o arquivo de origem"
        );
    }

    #[test]
    fn rex02_smd_with_512_header_round_trip_restores_full_file() {
        let rom = synthetic_md_rom();
        let mut file = vec![0x77u8; 512];
        file[8] = 0x03;
        file.extend_from_slice(&interleave_smd(&rom));
        let file_sha = crate::core::rom_mastering::sha256_hex(&file);

        let identity = rex_identify_bytes(&file).expect("identificar smd com header");
        assert_eq!(identity.variant, "smd_interleaved_512");
        assert_eq!(identity.original_sha256, file_sha);
        assert_eq!(
            identity.normalized_sha256,
            crate::core::rom_mastering::sha256_hex(&rom)
        );
        assert_eq!(identity.normalization.len(), 2);
        assert_eq!(identity.normalization[0].name, "strip_smd_header");
        assert_eq!(identity.normalization[1].name, "deinterleave_smd_512");
        assert_eq!(identity.detached_prefix.len(), 512);

        // Undo recebe os bytes NORMALIZADOS e restitui o arquivo original
        // (header de 512 bytes incluído).
        let restored = rex_undo_normalization(&identity, &rom).expect("desfazer");
        assert_eq!(
            restored, file,
            "undo byte-exato incluindo o header removido"
        );
    }

    #[test]
    fn rex02_byteswapped_round_trip_restores_original() {
        let rom = synthetic_md_rom();
        let swapped = swap_bytes16(&rom).expect("tamanho par");
        let identity = rex_identify_bytes(&swapped).expect("identificar byteswapped");
        assert_eq!(identity.variant, "byteswapped16");
        assert_eq!(
            identity.normalized_sha256,
            crate::core::rom_mastering::sha256_hex(&rom)
        );

        let restored = rex_undo_normalization(&identity, &rom).expect("desfazer");
        assert_eq!(restored, swapped);
    }

    #[test]
    fn rex02_header_size_divergence_is_a_note_not_an_error() {
        let mut rom = synthetic_md_rom();
        // Header declara fim de ROM além do arquivo: comum em dumps reais
        // (HAMOOPIG declara 0xFFFFF para 0xE0000 bytes) — nota, nunca erro.
        let declared_end = (rom.len() as u32 + 0x1FFFF).to_be_bytes();
        rom[0x1A4..0x1A8].copy_from_slice(&declared_end);
        let identity = rex_identify_bytes(&rom).expect("identificação não deve falhar");
        let note = identity.size_note.as_ref().expect("divergência registrada");
        assert!(note.contains("fim de ROM"));
        assert!(identity.container.note.contains("fim de ROM"));
    }

    #[test]
    fn rex02_probable_smd_truncation_is_rejected_with_provable_signal() {
        let rom = synthetic_md_rom();
        let mut interleaved = interleave_smd(&rom);
        // Conteúdo reconhecido (blocos completos deinterleavam para o header
        // SEGA) mas o último bloco está incompleto: truncamento provável.
        interleaved.truncate(interleaved.len() - 100);
        let error = rex_identify_bytes(&interleaved).expect_err("truncado deve falhar");
        assert!(error.contains("truncada"), "mensagem acionável: {error}");
        assert!(error.contains("bloco de 512"), "detalhe do bloco: {error}");
    }

    #[test]
    fn rex02_ambiguous_candidates_are_rejected_without_arbitrary_choice() {
        // Pathológico por construção: raw tem "SEGA" em 0x100 e o
        // deinterleave com header de 512 também produz "SEGA" em 0x100 —
        // duas variantes casam. out[0x100+k] do candidato com header lê
        // F[512 + 2k + 1]; offsets não colidem com o header raw.
        let mut file = vec![0x41u8; 0x4000];
        file[0x100..0x110].copy_from_slice(b"SEGA GENESIS    ");
        let word = b"SEGA GENESIS    ";
        for (k, byte) in word.iter().enumerate() {
            file[512 + 2 * k + 1] = *byte;
        }
        let error = rex_identify_bytes(&file).expect_err("ambíguo deve falhar");
        assert!(error.contains("ambigua"), "mensagem acionável: {error}");
        assert!(error.contains("raw") && error.contains("smd_interleaved_512"));
    }

    #[test]
    fn rex02_out_of_profile_is_rejected_with_actionable_error() {
        // Imagem SNES-like (fora do perfil MD desta identificação).
        let mut snes = vec![0u8; 0x10200];
        snes[512 + 0x7FC0..512 + 0x7FD0].copy_from_slice(b"REX02 SNES TEST!");
        let error = rex_identify_bytes(&snes).expect_err("fora de perfil deve falhar");
        assert!(
            error.contains("fora do perfil"),
            "mensagem acionável: {error}"
        );

        let tiny = vec![0u8; 0x20];
        let error = rex_identify_bytes(&tiny).expect_err("pequena demais deve falhar");
        assert!(
            error.contains("pequena demais"),
            "mensagem acionável: {error}"
        );
    }

    #[test]
    fn rex02_load_rom_routes_smd_and_manifest_records_transform() {
        let rom = synthetic_md_rom();
        let path = temp_rom_path("rex02-smd", "smd");
        std::fs::write(&path, interleave_smd(&rom)).expect("write smd");

        let loaded = load_rom(&path).expect("carregar smd");
        assert_eq!(loaded.target, "megadrive");
        assert_eq!(loaded.stripped_header_bytes, 0);
        assert_eq!(
            crate::core::rom_mastering::sha256_hex(&loaded.bytes),
            crate::core::rom_mastering::sha256_hex(&rom),
            "bytes analisados são os normalizados"
        );

        let manifest = base_manifest(&loaded);
        let container = manifest.container.expect("container registrado");
        assert_eq!(container.kind, "plain_file");
        assert!(container.note.contains("smd_interleaved"));
        assert_eq!(manifest.normalization.len(), 1);
        assert_eq!(manifest.normalization[0].name, "deinterleave_smd_512");
        // Hashes do manifesto cobrem os bytes normalizados (o que a análise vê).
        assert_eq!(manifest.hashes.sha1, compute_hashes(&rom).sha1);

        let _ = std::fs::remove_file(path);
    }
}
