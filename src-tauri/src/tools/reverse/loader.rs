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

/// Desfaz a normalização passo a passo (ordem inversa). Valida a identidade
/// COMPLETA antes de produzir saída (REX-REV-03): os bytes de entrada devem
/// corresponder ao `normalized_sha256`/`normalized_size` gravados (mesmo com
/// zero passos — raw), cada inversão verifica o `input_sha256` do passo e o
/// resultado final deve restituir `original_sha256`/`original_size`. Passos
/// com nome desconhecido (ex.: manifests antigos com o interleave incorreto
/// de 512 bytes) são rejeitados — nunca reinterpretados silenciosamente.
pub fn rex_undo_normalization(
    identity: &RexRomIdentity,
    normalized: &[u8],
) -> Result<Vec<u8>, String> {
    let input_sha256 = crate::core::rom_mastering::sha256_hex(normalized);
    if input_sha256 != identity.normalized_sha256 {
        return Err(format!(
            "bytes de entrada nao correspondem a esta identidade: esperado \
             normalized_sha256 {}, observado {input_sha256}",
            identity.normalized_sha256
        ));
    }
    if normalized.len() != identity.normalized_size {
        return Err(format!(
            "tamanho de entrada divergente: esperado {}, observado {}",
            identity.normalized_size,
            normalized.len()
        ));
    }
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
            "deinterleave_smd_frame16k" => {
                if !bytes.len().is_multiple_of(0x4000) || bytes.is_empty() {
                    return Err(format!(
                        "impossivel reinterleave: tamanho {} nao e multiplo do frame de 0x4000",
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
                    "passo de normalizacao sem inverso registrado: '{other}'; manifesto \
                     produzido por versao anterior nao e reinterpretado silenciosamente"
                ))
            }
        };
        let inverted_sha256 = crate::core::rom_mastering::sha256_hex(&bytes);
        if inverted_sha256 != step.input_sha256 {
            return Err(format!(
                "cadeia de normalizacao inconsistente: resultado da inversao de '{}' nao \
                 corresponde a input_sha256 (esperado {}, observado {inverted_sha256})",
                step.name, step.input_sha256
            ));
        }
    }
    if crate::core::rom_mastering::sha256_hex(&bytes) != identity.original_sha256
        || bytes.len() != identity.original_size
    {
        return Err(
            "restauracao nao confere com o arquivo original registrado na identidade".to_string(),
        );
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

    // ----- REX-02: identificação e normalização reversível (formato SMD
    // padrão de 16 KiB conforme Genesis PlusGX loadrom.c) -----

    /// Fixture sintética BYOR-safe: ROM MD raw de 2 frames (32 KiB) com header
    /// canônico e fim de ROM declarado coerente com o tamanho.
    fn synthetic_md_rom() -> Vec<u8> {
        let mut rom = vec![0xA5u8; 0x8000];
        rom[4..8].copy_from_slice(&0x0000_0200u32.to_be_bytes());
        rom[0x100..0x110].copy_from_slice(b"SEGA GENESIS    ");
        rom[0x150..0x159].copy_from_slice(b"REX02TEST");
        let end = (rom.len() as u32 - 1).to_be_bytes();
        rom[0x1A4..0x1A8].copy_from_slice(&end);
        rom
    }

    /// Construtor INDEPENDENTE do formato SMD padrão (16 KiB): primeira
    /// metade de cada frame = bytes de posição ímpar, segunda = pares.
    /// Não usa `interleave_smd` — é o golden externo da regressão REX-REV-01.
    fn encode_standard_smd(original: &[u8]) -> Vec<u8> {
        let mut smd = vec![0u8; 512];
        for block in original.chunks_exact(0x4000) {
            smd.extend(block.iter().skip(1).step_by(2));
            smd.extend(block.iter().step_by(2));
        }
        smd
    }

    #[test]
    fn rex02_identifies_raw_by_content_and_ignores_extension() {
        let rom = synthetic_md_rom();
        let expected_sha = crate::core::rom_mastering::sha256_hex(&rom);
        let identity = rex_identify_bytes(&rom).expect("identificar raw");
        assert_eq!(identity.variant, "raw");
        assert_eq!(identity.original_sha256, expected_sha);
        assert_eq!(identity.normalized_sha256, expected_sha);
        assert!(identity.normalization.is_empty(), "raw não aplica passos");
        assert_eq!(identity.container.kind, "plain_file");
        assert_eq!(identity.header_console, "SEGA GENESIS");
    }

    /// Golden independente, mão-escrito: frame de 16 KiB cujo payload
    /// original conhecido é 0x00..0xFF repetido; verifica a fórmula byte a
    /// byte sem passar pelo nosso encoder.
    #[test]
    fn rex02_smd_deinterleave_matches_independent_golden() {
        // ROM original: bytes 0x00..0xFF repetidos até 16 KiB, com header
        // SEGA canônico em 0x100 (senão a identificação por conteúdo,
        // corretamente, rejeita).
        let mut original: Vec<u8> = (0..0x4000).map(|i| (i & 0xFF) as u8).collect();
        original[0x100..0x110].copy_from_slice(b"SEGA GENESIS    ");
        // Padrão SMD: frame[i] = original[2i+1]; frame[0x2000+i] = original[2i].
        let mut frame = vec![0u8; 0x4000];
        for i in 0..0x2000 {
            frame[i] = original[2 * i + 1];
            frame[0x2000 + i] = original[2 * i];
        }
        let mut file = vec![0u8; 512];
        file.extend_from_slice(&frame);

        let identity = rex_identify_bytes(&file).expect("golden SMD deve ser identificado");
        assert_eq!(identity.variant, "smd_interleaved_512");
        assert_eq!(
            identity.normalized_sha256,
            crate::core::rom_mastering::sha256_hex(&original),
            "normalização devolve o original do golden"
        );
        // Verificação byte a byte contra o golden escrito à mão.
        let payload =
            crate::tools::reverse::platform::deinterleave_smd(&file[512..]).expect("frames");
        assert_eq!(payload, original);
    }

    #[test]
    fn rex02_smd_interleaved_round_trip_restores_original_sha() {
        let rom = synthetic_md_rom();
        let original_sha = crate::core::rom_mastering::sha256_hex(&rom);
        // Golden independente (construtor externo), não o nosso encoder.
        let interleaved = encode_standard_smd(&rom);
        assert_ne!(
            interleaved, rom,
            "fixture precisa realmente estar intercalada"
        );

        let identity = rex_identify_bytes(&interleaved).expect("identificar smd");
        assert_eq!(identity.variant, "smd_interleaved_512");
        assert_eq!(
            identity.original_sha256,
            crate::core::rom_mastering::sha256_hex(&interleaved)
        );
        assert_eq!(
            identity.normalized_sha256, original_sha,
            "normalização devolve exatamente a ROM original"
        );
        assert_eq!(identity.normalization.len(), 2);
        assert_eq!(identity.normalization[0].name, "strip_smd_header");
        assert_eq!(identity.normalization[1].name, "deinterleave_smd_frame16k");
        assert_eq!(identity.normalization[1].parameters, "frame=0x4000");
        assert!(identity.normalization[1].reversible);

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

        // Nosso encoder (payload, sem header) deve coincidir com o payload
        // do golden independente.
        assert_eq!(
            crate::tools::reverse::platform::interleave_smd(&rom),
            interleaved[512..],
        );
    }

    #[test]
    fn rex02_smd_without_header_round_trip() {
        let rom = synthetic_md_rom();
        let file = encode_standard_smd(&rom)[512..].to_vec();
        let identity = rex_identify_bytes(&file).expect("identificar smd sem header");
        assert_eq!(identity.variant, "smd_interleaved");
        assert_eq!(
            identity.normalized_sha256,
            crate::core::rom_mastering::sha256_hex(&rom)
        );
        assert_eq!(identity.normalization.len(), 1);
        let restored = rex_undo_normalization(&identity, &rom).expect("desfazer");
        assert_eq!(restored, file);
    }

    #[test]
    fn rex02_byteswapped_round_trip_restores_original() {
        let rom = synthetic_md_rom();
        let swapped = crate::tools::reverse::platform::swap_bytes16(&rom).expect("tamanho par");
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
        let mut interleaved = encode_standard_smd(&rom);
        // 2 frames completos reconhecidos + último frame incompleto.
        interleaved.truncate(interleaved.len() - 100);
        let error = rex_identify_bytes(&interleaved).expect_err("truncado deve falhar");
        assert!(error.contains("truncada"), "mensagem acionável: {error}");
        assert!(error.contains("incompleto"), "detalhe do frame: {error}");
    }

    #[test]
    fn rex02_ambiguous_candidates_are_rejected_without_arbitrary_choice() {
        // Pathológico por construção: byteswapped contém "SEGA" em 0x100 E o
        // SMD com header de 512 deinterleava para "SEGA" em 0x100 — duas
        // variantes casam, seleção arbitrária recusada.
        let mut file = vec![0x41u8; 512 + 0x4000];
        // swapped[0x100+k] = file[0x101+k^1...]: plantar pares trocados.
        file[0x100] = b'E';
        file[0x101] = b'S';
        file[0x102] = b'A';
        file[0x103] = b'G';
        // deinterleave: out[2i] = payload[0x2000+i]; out[2i+1] = payload[i].
        // out[0x100..0x104] = S,E,G,A <- payload[0x2080],payload[0x80],
        // payload[0x2081],payload[0x81].
        let payload_base = 512;
        file[payload_base + 0x80] = b'E';
        file[payload_base + 0x81] = b'A';
        file[payload_base + 0x2000 + 0x80] = b'S';
        file[payload_base + 0x2000 + 0x81] = b'G';
        let error = rex_identify_bytes(&file).expect_err("ambíguo deve falhar");
        assert!(error.contains("ambigua"), "mensagem acionável: {error}");
        assert!(error.contains("byteswapped16") && error.contains("smd_interleaved_512"));
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

    /// Todas as fronteiras de tamanho retornam erro estruturado, sem panic
    /// (REX-REV-02) — inclusive com assinatura SEGA presente.
    #[test]
    fn rex02_short_inputs_return_structured_error_without_panic() {
        for len in [0x10F, 0x110, 0x11F, 0x1A8, 0x1FF] {
            let mut short = vec![0u8; len];
            if len >= 0x110 {
                short[0x100..0x110].copy_from_slice(b"SEGA GENESIS    ");
            }
            let result = std::panic::catch_unwind(|| rex_identify_bytes(&short));
            assert!(result.is_ok(), "panic em entrada de {len} bytes");
            let error = result.unwrap().expect_err("{len} bytes deve falhar");
            assert!(error.contains("pequena demais"), "{len}: {error}");
        }
        // 0x200 exatos com SEGA identificam como raw.
        let mut minimal = vec![0u8; 0x200];
        minimal[0x100..0x110].copy_from_slice(b"SEGA GENESIS    ");
        let identity = rex_identify_bytes(&minimal).expect("0x200 com header deve identificar");
        assert_eq!(identity.variant, "raw");
        // SMD de só-header (sem frames) e byteswap ímpar: sem panic, erro.
        let header_only = vec![0u8; 512];
        assert!(rex_identify_bytes(&header_only).is_err());
        let odd = vec![0u8; 0x201];
        assert!(rex_identify_bytes(&odd).is_err());
    }

    /// Manifestos antigos com o passo do interleave incorreto (512 bytes) são
    /// rejeitados — nunca reinterpretados silenciosamente (REX-REV-01/03).
    #[test]
    fn rex02_undo_rejects_legacy_step_name_without_silent_reinterpretation() {
        let rom = synthetic_md_rom();
        let mut identity = rex_identify_bytes(&encode_standard_smd(&rom)).expect("identificar");
        for step in identity.normalization.iter_mut() {
            if step.name == "deinterleave_smd_frame16k" {
                step.name = "deinterleave_smd_512".to_string();
            }
        }
        let error = rex_undo_normalization(&identity, &rom).expect_err("passo legado deve falhar");
        assert!(error.contains("sem inverso registrado"), "{error}");
    }

    #[test]
    fn rex02_load_rom_routes_smd_and_manifest_records_transform() {
        let rom = synthetic_md_rom();
        let path = temp_rom_path("rex02-smd", "smd");
        std::fs::write(&path, encode_standard_smd(&rom)).expect("write smd");

        let loaded = load_rom(&path).expect("carregar smd");
        assert_eq!(loaded.target, "megadrive");
        assert_eq!(loaded.stripped_header_bytes, 512);
        assert_eq!(
            crate::core::rom_mastering::sha256_hex(&loaded.bytes),
            crate::core::rom_mastering::sha256_hex(&rom),
            "bytes analisados são os normalizados"
        );

        let manifest = base_manifest(&loaded);
        let container = manifest.container.expect("container registrado");
        assert_eq!(container.kind, "plain_file");
        assert!(container.note.contains("smd_interleaved_512"));
        assert_eq!(manifest.normalization.len(), 2);
        assert_eq!(manifest.normalization[1].name, "deinterleave_smd_frame16k");
        // Hashes do manifesto cobrem os bytes normalizados (o que a análise vê).
        assert_eq!(manifest.hashes.sha1, compute_hashes(&rom).sha1);

        let _ = std::fs::remove_file(path);
    }

    // ----- Regressões da revisão independente (REX-REV-01/02/03, 2026-09-11)
    // Adotadas de /home/misael/RetroDevStudio/review-rex-2026-09-11/REVIEW.md
    // com asserções preservadas.
    mod independent_review {
        use super::*;

        fn raw() -> Vec<u8> {
            let mut b = vec![0u8; 0x8000];
            b[0x100..0x110].copy_from_slice(b"SEGA GENESIS    ");
            b
        }

        #[test]
        fn review_standard_smd_is_recognized() {
            let original = raw();
            let smd = encode_standard_smd(&original);
            let identity = rex_identify_bytes(&smd).expect("standard SMD must be identified");
            assert_eq!(
                identity.normalized_sha256,
                crate::core::rom_mastering::sha256_hex(&original)
            );
        }

        #[test]
        fn review_truncated_header_returns_error_without_panic() {
            let mut b = vec![0u8; 0x110];
            b[0x100..0x110].copy_from_slice(b"SEGA GENESIS    ");
            let result = std::panic::catch_unwind(|| rex_identify_bytes(&b));
            assert!(result.is_ok(), "parser panicked on truncated input");
            assert!(result.unwrap().is_err());
        }

        #[test]
        fn review_undo_rejects_wrong_raw_bytes() {
            let b = raw();
            let identity = rex_identify_bytes(&b).unwrap();
            let mut changed = b.clone();
            changed[700] = 1;
            assert!(
                rex_undo_normalization(&identity, &changed).is_err(),
                "undo accepted a different ROM"
            );
        }
    }
}
