use crate::core::diagnostics::{DiagnosticArea, DiagnosticSeverity};
use crate::core::project_capability::{
    capability_axis, capability_diagnostic, evidence_ref, CapabilityAxisReport,
};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct AudioNumericStatus {
    pub value: f64,
    pub normalized_abs: f64,
    pub status: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct AudioStatus {
    pub status: String,
    pub detail: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct AudioClippingStatus {
    pub detected: bool,
    pub clipped_samples: usize,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct AudioEntryReport {
    pub path: String,
    pub kind: String,
    pub sample_rate: AudioStatus,
    pub clipping: AudioClippingStatus,
    pub dc_offset: AudioNumericStatus,
    pub padding: AudioStatus,
    pub sfx_priority: AudioStatus,
    pub channel_ownership: AudioStatus,
    pub memory_risks: Vec<String>,
    pub warnings: Vec<String>,
    pub next_actions: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct AudioPipelineReport {
    pub project_dir: String,
    pub axis: CapabilityAxisReport,
    pub entries: Vec<AudioEntryReport>,
}

pub fn inspect_audio_pipeline(project_dir: &Path) -> Result<AudioPipelineReport, String> {
    if !project_dir.exists() {
        return Err(format!(
            "O que quebrou: projeto nao encontrado para audio pipeline. Por que importa: audio precisa mapear assets/audio reais. Onde corrigir: '{}'. Proxima acao: abra um projeto valido.",
            project_dir.display()
        ));
    }
    let audio_dir = project_dir.join("assets").join("audio");
    let mut files = Vec::new();
    collect_audio_files(&audio_dir, &mut files);
    let mut entries = Vec::new();
    for path in files {
        let entry = inspect_audio_file(&path)?;
        entries.push(entry);
    }
    let warnings = entries
        .iter()
        .flat_map(|entry| entry.warnings.iter().cloned())
        .collect::<Vec<_>>();
    let diagnostics = warnings
        .iter()
        .map(|warning| {
            capability_diagnostic(
                DiagnosticArea::AudioPipeline,
                DiagnosticSeverity::Warn,
                "Audio pipeline encontrou risco tecnico.",
                warning.clone(),
                "Abra o painel de audio, ajuste sample rate/clipping/padding/canais e gere novo build.",
                false,
                Some(audio_dir.to_string_lossy().to_string()),
            )
        })
        .collect::<Vec<_>>();
    let axis = capability_axis(
        if entries.is_empty() {
            "not_applicable"
        } else {
            "partial"
        },
        entries
            .iter()
            .map(|entry| {
                evidence_ref(
                    "audio_asset",
                    &entry.path,
                    format!("{} inspecionado", entry.kind),
                )
            })
            .collect(),
        Vec::new(),
        warnings,
        if entries.is_empty() {
            vec!["Adicionar WAV/PCM/XGM em assets/audio quando o projeto exigir audio.".to_string()]
        } else {
            vec!["Corrigir warnings tecnicos antes de tratar audio como evidencia AAA.".to_string()]
        },
        Some("assets/audio".to_string()),
        Some("Debug/Inspector".to_string()),
        diagnostics,
    );
    Ok(AudioPipelineReport {
        project_dir: project_dir.to_string_lossy().to_string(),
        axis,
        entries,
    })
}

fn collect_audio_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_audio_files(&path, out);
            continue;
        }
        let ext = path
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if matches!(ext.as_str(), "wav" | "pcm" | "xgm" | "vgm") {
            out.push(path);
        }
    }
}

fn inspect_audio_file(path: &Path) -> Result<AudioEntryReport, String> {
    let bytes = fs::read(path).map_err(|error| {
        format!(
            "O que quebrou: falha ao ler audio. Por que importa: sem bytes reais nao da para detectar clipping/padding. Onde corrigir: '{}'. Proxima acao: restaure o asset ou remova a referencia. Detalhe: {}",
            path.display(),
            error
        )
    })?;
    let ext = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "wav" => inspect_wav(path, &bytes),
        "xgm" => Ok(inspect_container_audio(path, "xgm", bytes.len())),
        "vgm" => Ok(inspect_container_audio(path, "vgm", bytes.len())),
        "pcm" => Ok(inspect_raw_pcm(path, bytes.len())),
        _ => Ok(inspect_container_audio(path, "unknown", bytes.len())),
    }
}

fn inspect_wav(path: &Path, bytes: &[u8]) -> Result<AudioEntryReport, String> {
    let wav = parse_wav(bytes).ok_or_else(|| {
        format!(
            "O que quebrou: WAV invalido. Por que importa: XGM/PCM precisa de PCM previsivel. Onde corrigir: '{}'. Proxima acao: exporte WAV PCM 16-bit mono com padding correto.",
            path.display()
        )
    })?;
    let clipped = wav
        .samples
        .iter()
        .filter(|sample| **sample == i16::MAX || **sample == i16::MIN)
        .count();
    let avg = if wav.samples.is_empty() {
        0.0
    } else {
        wav.samples.iter().map(|sample| *sample as f64).sum::<f64>() / wav.samples.len() as f64
    };
    let dc = (avg / 32768.0).abs();
    let mut warnings = Vec::new();
    if !valid_sample_rate(wav.sample_rate) {
        warnings.push(format!(
            "{}: sample rate {} invalido para pipeline XGM/PCM conservador",
            path.display(),
            wav.sample_rate
        ));
    }
    if clipped > 0 {
        warnings.push(format!(
            "{}: clipping detectado em {} sample(s)",
            path.display(),
            clipped
        ));
    }
    if dc > 0.10 {
        warnings.push(format!("{}: DC offset alto ({dc:.2})", path.display()));
    }
    if wav.padding_invalid {
        warnings.push(format!(
            "{}: padding/alinhamento PCM incorreto",
            path.display()
        ));
    }
    Ok(AudioEntryReport {
        path: path.to_string_lossy().to_string(),
        kind: "pcm_wav".to_string(),
        sample_rate: AudioStatus {
            status: if valid_sample_rate(wav.sample_rate) {
                "valid"
            } else {
                "invalid"
            }
            .to_string(),
            detail: wav.sample_rate.to_string(),
        },
        clipping: AudioClippingStatus {
            detected: clipped > 0,
            clipped_samples: clipped,
        },
        dc_offset: AudioNumericStatus {
            value: avg,
            normalized_abs: dc,
            status: if dc > 0.10 { "warning" } else { "ok" }.to_string(),
        },
        padding: AudioStatus {
            status: if wav.padding_invalid { "invalid" } else { "ok" }.to_string(),
            detail: format!("block_align={}", wav.block_align),
        },
        sfx_priority: AudioStatus {
            status: "not_declared".to_string(),
            detail: "Prioridade SFX nao declarada no asset.".to_string(),
        },
        channel_ownership: AudioStatus {
            status: "not_declared".to_string(),
            detail: "Ownership de canais nao declarado.".to_string(),
        },
        memory_risks: Vec::new(),
        warnings,
        next_actions: vec!["Normalizar WAV antes de converter para XGM/PCM final.".to_string()],
    })
}

fn inspect_container_audio(path: &Path, kind: &str, size: usize) -> AudioEntryReport {
    let mut risks = Vec::new();
    if size > 512 * 1024 {
        risks.push(format!(
            "{} pode pressionar memoria/canal no alvo 16-bit ({} bytes).",
            path.display(),
            size
        ));
    }
    AudioEntryReport {
        path: path.to_string_lossy().to_string(),
        kind: kind.to_string(),
        sample_rate: AudioStatus {
            status: "not_applicable".to_string(),
            detail: "Container preconvertido; sample rate nao inferido sem decoder dedicado."
                .to_string(),
        },
        clipping: AudioClippingStatus {
            detected: false,
            clipped_samples: 0,
        },
        dc_offset: AudioNumericStatus {
            value: 0.0,
            normalized_abs: 0.0,
            status: "not_applicable".to_string(),
        },
        padding: AudioStatus {
            status: "not_applicable".to_string(),
            detail: "Padding nao inferido para container.".to_string(),
        },
        sfx_priority: AudioStatus {
            status: "not_declared".to_string(),
            detail: "Prioridade SFX nao declarada.".to_string(),
        },
        channel_ownership: AudioStatus {
            status: "not_declared".to_string(),
            detail: "Ownership de canais nao declarado.".to_string(),
        },
        memory_risks: risks.clone(),
        warnings: risks,
        next_actions: vec!["Registrar prioridade/canais se o audio disputar PCM/SFX.".to_string()],
    }
}

fn inspect_raw_pcm(path: &Path, size: usize) -> AudioEntryReport {
    let mut entry = inspect_container_audio(path, "pcm_raw", size);
    entry.padding = AudioStatus {
        status: if size.is_multiple_of(2) {
            "ok"
        } else {
            "invalid"
        }
        .to_string(),
        detail: format!("{} bytes", size),
    };
    if !size.is_multiple_of(2) {
        entry
            .warnings
            .push(format!("{}: PCM raw com padding impar", path.display()));
    }
    entry
}

struct ParsedWav {
    sample_rate: u32,
    block_align: u16,
    samples: Vec<i16>,
    padding_invalid: bool,
}

fn parse_wav(bytes: &[u8]) -> Option<ParsedWav> {
    if bytes.get(0..4)? != b"RIFF" || bytes.get(8..12)? != b"WAVE" {
        return None;
    }
    let mut offset = 12usize;
    let mut sample_rate = None;
    let mut block_align = 0u16;
    let mut bits_per_sample = 0u16;
    let mut data = None::<&[u8]>;
    while offset + 8 <= bytes.len() {
        let id = &bytes[offset..offset + 4];
        let len = u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().ok()?) as usize;
        offset += 8;
        let chunk = bytes.get(offset..offset.saturating_add(len))?;
        if id == b"fmt " && len >= 16 {
            let audio_format = u16::from_le_bytes(chunk[0..2].try_into().ok()?);
            sample_rate = Some(u32::from_le_bytes(chunk[4..8].try_into().ok()?));
            block_align = u16::from_le_bytes(chunk[12..14].try_into().ok()?);
            bits_per_sample = u16::from_le_bytes(chunk[14..16].try_into().ok()?);
            if audio_format != 1 {
                return None;
            }
        } else if id == b"data" {
            data = Some(chunk);
        }
        offset += len + (len % 2);
    }
    let sample_rate = sample_rate?;
    let data = data?;
    let padding_invalid = block_align == 0 || data.len() % block_align as usize != 0;
    let mut samples = Vec::new();
    if bits_per_sample == 16 {
        for chunk in data.chunks_exact(2) {
            samples.push(i16::from_le_bytes([chunk[0], chunk[1]]));
        }
    }
    Some(ParsedWav {
        sample_rate,
        block_align,
        samples,
        padding_invalid,
    })
}

fn valid_sample_rate(rate: u32) -> bool {
    matches!(rate, 8_000 | 11_025 | 16_000 | 22_050 | 32_000)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_project(name: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("rds-audio-pipeline-{name}-{stamp}"));
        fs::create_dir_all(dir.join("assets").join("audio")).expect("audio dir");
        dir
    }

    fn write_wav(
        path: PathBuf,
        sample_rate: u32,
        samples: &[i16],
        trailing_padding: &[u8],
    ) -> PathBuf {
        let mut bytes = Vec::new();
        let data_len = (samples.len() * 2) as u32 + trailing_padding.len() as u32;
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&sample_rate.to_le_bytes());
        bytes.extend_from_slice(&(sample_rate * 2).to_le_bytes());
        bytes.extend_from_slice(&2u16.to_le_bytes());
        bytes.extend_from_slice(&16u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&data_len.to_le_bytes());
        for sample in samples {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }
        bytes.extend_from_slice(trailing_padding);
        fs::write(&path, bytes).expect("wav");
        path
    }

    #[test]
    fn audio_pipeline_flags_clipping_dc_offset_bad_padding_and_sample_rate() {
        let project = temp_project("wav");
        write_wav(
            project.join("assets").join("audio").join("hot.wav"),
            44_100,
            &[32_767, 32_767, 30_000, 28_000],
            &[0x7f],
        );

        let report = inspect_audio_pipeline(&project).expect("audio");
        let entry = report
            .entries
            .iter()
            .find(|entry| entry.path.ends_with("hot.wav"))
            .expect("entry");

        assert_eq!(entry.kind, "pcm_wav");
        assert_eq!(entry.sample_rate.status, "invalid");
        assert!(entry.clipping.detected);
        assert_eq!(entry.padding.status, "invalid");
        assert!(entry.dc_offset.normalized_abs > 0.75);
        assert!(report
            .axis
            .warnings
            .iter()
            .any(|warning| warning.contains("clipping")));
    }

    #[test]
    fn audio_pipeline_reports_xgm_pcm_type_and_channel_ownership_risk() {
        let project = temp_project("xgm");
        fs::write(
            project.join("assets").join("audio").join("theme.xgm"),
            vec![0u8; 700_000],
        )
        .expect("xgm");

        let report = inspect_audio_pipeline(&project).expect("audio");
        let entry = report
            .entries
            .iter()
            .find(|entry| entry.path.ends_with("theme.xgm"))
            .expect("entry");

        assert_eq!(entry.kind, "xgm");
        assert!(entry.channel_ownership.status.contains("not_declared"));
        assert!(entry
            .memory_risks
            .iter()
            .any(|risk| risk.contains("memoria")));
    }
}
