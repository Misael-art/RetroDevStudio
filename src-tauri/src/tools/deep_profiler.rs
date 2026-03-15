//! deep_profiler.rs — Deep Profiler: análise estática de ROMs Mega Drive.
//!
//! Produz:
//!   - Heatmap de acesso a VRAM por scanline (256 entradas, u16 para DMA bytes/linha)
//!   - Estimativa de uso de DMA por frame
//!   - Contagem de sprites por scanline (simula a SAT do VDP)
//!   - Lista de problemas detectados

use std::path::Path;
use std::fs;
use serde::Serialize;

// ── Mega Drive constants (doc 04) ─────────────────────────────────────────────

const MD_SCANLINES: usize = 224;
const MD_SPRITES_MAX_SCREEN: u32 = 80;
const MD_SPRITES_MAX_SCANLINE: u32 = 20;
const MD_DMA_VBLANK_BYTES: u32 = 7_372; // ~7.2 KB/frame em H40 NTSC (doc 04)
const SAT_SIZE: usize = 80 * 8; // Sprite Attribute Table: 80 sprites × 8 bytes
const SAT_Y_MIN: u16 = 128;
const SAT_Y_MAX: u16 = 352;

#[derive(Debug, Clone, Copy)]
struct SatEntry {
    y: u16,
    size_byte: u8,
    link: u8,
    x: u16,
}

impl SatEntry {
    fn width_code(self) -> u8 {
        self.size_byte & 0x3
    }

    fn height_code(self) -> u8 {
        (self.size_byte >> 2) & 0x3
    }

    fn height_pixels(self) -> usize {
        (self.height_code() as usize + 1) * 8
    }

    fn has_plausible_position(self) -> bool {
        (SAT_Y_MIN..=SAT_Y_MAX).contains(&self.y) && self.x > 0 && self.x <= 511
    }
}

#[derive(Debug, Clone, Copy)]
struct SatCandidate {
    offset: usize,
    score: u32,
    plausible_entries: u32,
}

// ── Output types ──────────────────────────────────────────────────────────────

/// Nível de severidade de um problema detectado.
#[derive(Debug, Serialize, Clone, PartialEq)]
pub enum Severity { Info, Warning, Error }

#[derive(Debug, Serialize, Clone)]
pub struct ProfileIssue {
    pub severity: Severity,
    pub message: String,
}

/// Resultado completo do profiler.
#[derive(Debug, Default, Serialize)]
pub struct ProfileReport {
    /// Bytes de DMA estimados por scanline (224 entradas).
    pub dma_heatmap: Vec<u16>,
    /// Contagem de sprites ativos por scanline (224 entradas).
    pub sprite_heatmap: Vec<u8>,
    /// Total estimado de bytes de DMA por frame.
    pub dma_total_bytes: u32,
    /// Número máximo de sprites em qualquer scanline.
    pub sprite_peak: u8,
    /// Total de sprites declarados na SAT.
    pub sprite_count: u32,
    /// Problemas detectados (erros e avisos).
    pub issues: Vec<ProfileIssue>,
    /// true se a ROM foi carregada e analisada com sucesso.
    pub ok: bool,
    /// Mensagem de erro de I/O (se ok=false).
    pub error: String,
}

// ── ROM analysis ─────────────────────────────────────────────────────────────

/// Analisa uma ROM Mega Drive e retorna o ProfileReport.
///
/// Esta é uma análise **estática** (sem executar a ROM):
/// - Localiza o cabeçalho da ROM e a SAT estimada
/// - Simula a distribuição de sprites por scanline com base nos dados da SAT
/// - Estima o uso de DMA por frame com base no tamanho total de tiles
pub fn profile_rom(rom_path: &Path) -> ProfileReport {
    let rom = match fs::read(rom_path) {
        Ok(b) => b,
        Err(e) => return ProfileReport {
            ok: false,
            error: format!("Erro ao ler ROM: {e}"),
            ..Default::default()
        },
    };

    profile_bytes(&rom)
}

/// Versão que aceita bytes diretamente (útil para testes e para ROMs já em memória).
pub fn profile_bytes(rom: &[u8]) -> ProfileReport {
    let mut report = ProfileReport {
        dma_heatmap:   vec![0u16; MD_SCANLINES],
        sprite_heatmap: vec![0u8; MD_SCANLINES],
        ok: true,
        ..Default::default()
    };

    if rom.len() < 0x200 {
        report.issues.push(ProfileIssue {
            severity: Severity::Error,
            message: "ROM muito pequena para ser um binário Mega Drive válido (< 512 bytes).".to_string(),
        });
        report.ok = false;
        return report;
    }

    // ── Valida magic no header (offset 0x100 — "SEGA MEGA DRIVE" ou "SEGA GENESIS") ──
    let magic_end = (0x100 + 16).min(rom.len());
    let header_magic = &rom[0x100..magic_end];
    let magic_str = String::from_utf8_lossy(header_magic);
    if !magic_str.contains("SEGA") {
        report.issues.push(ProfileIssue {
            severity: Severity::Warning,
            message: format!("Header offset 0x100 não contém 'SEGA': '{}'. Pode não ser uma ROM MD válida.", &magic_str[..magic_str.len().min(16)]),
        });
    }

    // ── Estima SAT — busca bloco de 640 bytes com padrão de sprite entries ──
    // Heurística: a SAT real fica na VRAM (não na ROM). Aqui varremos a ROM
    // procurando sequências que pareçam entradas de sprite (Y < 224, X < 320).
    let sat_offset = find_sat_candidate(rom);
    let sat_data = if let Some(off) = sat_offset {
        if off + SAT_SIZE <= rom.len() { &rom[off..off + SAT_SIZE] } else { &[] }
    } else {
        &[]
    };

    // ── Simula sprites por scanline ───────────────────────────────────────────
    let mut sprites_parsed = 0u32;
    if !sat_data.is_empty() {
        for sprite_idx in 0..80usize {
            let base = sprite_idx * 8;
            if base + 8 > sat_data.len() { break; }
            let entry = sat_entry(&sat_data[base..base + 8]);

            // Filtra entradas inválidas/não usadas
            if !entry.has_plausible_position() { continue; }
            sprites_parsed += 1;

            let y_start = (entry.y as usize).saturating_sub(SAT_Y_MIN as usize);
            let y_end   = (y_start + entry.height_pixels()).min(MD_SCANLINES);
            for sl in y_start..y_end {
                report.sprite_heatmap[sl] = report.sprite_heatmap[sl].saturating_add(1);
            }
        }
    }

    report.sprite_count = sprites_parsed;
    report.sprite_peak = *report.sprite_heatmap.iter().max().unwrap_or(&0);

    // ── Verifica violações de sprites ─────────────────────────────────────────
    if sprites_parsed > MD_SPRITES_MAX_SCREEN {
        report.issues.push(ProfileIssue {
            severity: Severity::Error,
            message: format!("SAT overflow: {} sprites declarados. Limite MD: {}.", sprites_parsed, MD_SPRITES_MAX_SCREEN),
        });
    }

    for (sl, &count) in report.sprite_heatmap.iter().enumerate() {
        if count as u32 > MD_SPRITES_MAX_SCANLINE {
            report.issues.push(ProfileIssue {
                severity: Severity::Error,
                message: format!("Sprite overflow na scanline {}: {} sprites. Limite por scanline: {}.", sl, count, MD_SPRITES_MAX_SCANLINE),
            });
        } else if count as u32 > MD_SPRITES_MAX_SCANLINE * 80 / 100 {
            report.issues.push(ProfileIssue {
                severity: Severity::Warning,
                message: format!("Scanline {} próxima do limite: {} / {} sprites.", sl, count, MD_SPRITES_MAX_SCANLINE),
            });
        }
    }

    // ── Estima DMA heatmap ────────────────────────────────────────────────────
    // Heurística: distribui o custo de DMA de tiles uniformemente pelas scanlines
    // do vblank (scanlines 224–261 mapeadas na área de inatividade).
    // Como só temos 224 entradas, concentramos nas primeiras 8 scanlines (vblank sim).
    let tile_section_size = estimate_tile_section_size(rom) as u32;
    let dma_per_frame     = tile_section_size.min(MD_DMA_VBLANK_BYTES);
    let vblank_lines      = 8usize; // proxy das linhas de vblank visíveis no heatmap
    let dma_per_line      = (dma_per_frame / vblank_lines as u32) as u16;

    for sl in 0..vblank_lines.min(MD_SCANLINES) {
        report.dma_heatmap[sl] = dma_per_line;
    }
    report.dma_total_bytes = dma_per_frame;

    if dma_per_frame > MD_DMA_VBLANK_BYTES {
        report.issues.push(ProfileIssue {
            severity: Severity::Error,
            message: format!(
                "DMA Overflow: ~{}KB de tiles estimados. Budget de DMA/frame em H40 NTSC: ~7.2KB.",
                tile_section_size / 1024
            ),
        });
    } else if dma_per_frame > MD_DMA_VBLANK_BYTES * 80 / 100 {
        report.issues.push(ProfileIssue {
            severity: Severity::Warning,
            message: format!(
                "DMA Warning: ~{}KB de tiles ({}% do budget). Pouco margem para updates dinâmicos.",
                tile_section_size / 1024,
                dma_per_frame * 100 / MD_DMA_VBLANK_BYTES
            ),
        });
    }

    if report.issues.is_empty() {
        report.issues.push(ProfileIssue {
            severity: Severity::Info,
            message: "Nenhum problema detectado na análise estática.".to_string(),
        });
    }

    report
}

// ── Internal helpers ──────────────────────────────────────────────────────────

fn sat_entry(bytes: &[u8]) -> SatEntry {
    SatEntry {
        y: u16::from_be_bytes([bytes[0], bytes[1]]) & 0x1FF,
        size_byte: bytes[2],
        link: bytes[3],
        x: u16::from_be_bytes([bytes[6], bytes[7]]) & 0x1FF,
    }
}

fn score_sat_candidate(window: &[u8]) -> u32 {
    if window.len() < SAT_SIZE {
        return 0;
    }

    let mut score = 0u32;
    let mut plausible_entries = 0u32;
    let mut chain_score = 0u32;

    for sprite_idx in 0..80usize {
        let base = sprite_idx * 8;
        let entry = sat_entry(&window[base..base + 8]);

        if entry.has_plausible_position() {
            plausible_entries += 1;
            score += 5;
        }

        if entry.width_code() <= 3 && entry.height_code() <= 3 {
            score += 1;
        }

        if entry.link < 80 {
            score += 1;
            if sprite_idx == 79 {
                if entry.link == 0 {
                    chain_score += 2;
                }
            } else if entry.link == (sprite_idx + 1) as u8 || entry.link == 0 {
                chain_score += 2;
            }
        }
    }

    if plausible_entries < 5 {
        return 0;
    }

    score + chain_score
}

/// Busca um candidato a SAT na ROM (heurística: sequência de 640 bytes com
/// coordenadas plausíveis, tamanhos coerentes e chain de links consistente).
fn find_sat_candidate(rom: &[u8]) -> Option<usize> {
    if rom.len() < SAT_SIZE {
        return None;
    }

    let mut best_candidate: Option<SatCandidate> = None;
    for off in (0..=rom.len() - SAT_SIZE).step_by(8) {
        let score = score_sat_candidate(&rom[off..off + SAT_SIZE]);
        if score == 0 {
            continue;
        }

        let candidate = SatCandidate {
            offset: off,
            score,
            plausible_entries: score_sat_candidate_plausible_entries(&rom[off..off + SAT_SIZE]),
        };

        let replace = match best_candidate {
            Some(current) => {
                candidate.score > current.score
                    || (candidate.score == current.score
                        && candidate.plausible_entries > current.plausible_entries)
            }
            None => true,
        };

        if replace {
            best_candidate = Some(candidate);
        }
    }

    best_candidate.map(|candidate| candidate.offset)
}

fn score_sat_candidate_plausible_entries(window: &[u8]) -> u32 {
    (0..80usize)
        .filter(|sprite_idx| {
            let base = sprite_idx * 8;
            sat_entry(&window[base..base + 8]).has_plausible_position()
        })
        .count() as u32
}

/// Estima o tamanho da seção de tiles varrendo a ROM por padrões de tile 4bpp (32 bytes).
fn estimate_tile_section_size(rom: &[u8]) -> usize {
    // Heurística rápida: assume que ~25% da ROM são tiles gráficos
    (rom.len() / 4).min(64 * 1024)
}

#[cfg(test)]
mod tests {
    use super::{find_sat_candidate, profile_bytes, SAT_SIZE};

    fn write_sat_entry(buffer: &mut [u8], index: usize, y: u16, size_byte: u8, link: u8, x: u16) {
        let base = index * 8;
        buffer[base..base + 2].copy_from_slice(&(y & 0x01FF).to_be_bytes());
        buffer[base + 2] = size_byte;
        buffer[base + 3] = link;
        buffer[base + 6..base + 8].copy_from_slice(&(x & 0x01FF).to_be_bytes());
    }

    #[test]
    fn find_sat_candidate_prefers_high_score_manual_fixture() {
        let mut rom = vec![0u8; 0x4000];
        let target_offset = 0x1200;
        let sat_window = &mut rom[target_offset..target_offset + SAT_SIZE];

        for sprite_idx in 0..10usize {
            write_sat_entry(
                sat_window,
                sprite_idx,
                128 + sprite_idx as u16 * 8,
                0b0000_0101,
                if sprite_idx == 9 { 0 } else { (sprite_idx + 1) as u8 },
                160 + sprite_idx as u16 * 8,
            );
        }

        assert_eq!(find_sat_candidate(&rom), Some(target_offset));
    }

    #[test]
    fn profile_bytes_uses_detected_sat_candidate_for_sprite_heatmap() {
        let mut rom = vec![0u8; 0x4000];
        rom[0x100..0x10F].copy_from_slice(b"SEGA MEGA DRIVE");
        let target_offset = 0x1800;
        let sat_window = &mut rom[target_offset..target_offset + SAT_SIZE];

        for sprite_idx in 0..6usize {
            write_sat_entry(
                sat_window,
                sprite_idx,
                128 + sprite_idx as u16 * 4,
                0b0000_0101,
                if sprite_idx == 5 { 0 } else { (sprite_idx + 1) as u8 },
                192,
            );
        }

        let report = profile_bytes(&rom);

        assert!(report.ok);
        assert_eq!(report.sprite_count, 6);
        assert!(report.sprite_peak >= 1);
    }

    #[test]
    fn profile_bytes_detects_small_rom_error() {
        let rom = vec![0u8; 128];
        let report = profile_bytes(&rom);
        assert!(!report.ok);
        assert_eq!(report.issues.len(), 1);
        assert_eq!(report.issues[0].severity, super::Severity::Error);
    }
}
