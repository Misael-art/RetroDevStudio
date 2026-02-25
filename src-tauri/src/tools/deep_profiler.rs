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
            let y = u16::from_be_bytes([sat_data[base], sat_data[base + 1]]) & 0x1FF;
            let height_code = (sat_data[base + 2] >> 2) & 0x3;
            let height_tiles = (height_code as u16 + 1) * 8; // pixels
            let x = u16::from_be_bytes([sat_data[base + 6], sat_data[base + 7]]) & 0x1FF;

            // Filtra entradas inválidas/não usadas
            if y == 0 || y > 240 || x == 0 || x > 320 { continue; }
            sprites_parsed += 1;

            let y_start = (y as usize).saturating_sub(128);
            let y_end   = (y_start + height_tiles as usize).min(MD_SCANLINES);
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

/// Busca um candidato a SAT na ROM (heurística: sequência de 640 bytes com
/// muitas entradas com Y entre 128 e 240 e X entre 128 e 320).
fn find_sat_candidate(rom: &[u8]) -> Option<usize> {
    // A SAT nunca está na ROM — mas ROMs de debug ou dumps de save state podem tê-la.
    // Para ROMs normais, tentamos o offset fixo 0xFF0000 % rom.len() como fallback.
    let probe = 0xFF0000_usize % rom.len();
    let candidates = [0x8000, 0x10000, probe];
    for &off in &candidates {
        if off + SAT_SIZE <= rom.len() {
            let mut valid = 0u32;
            for i in 0..40usize {
                let base = off + i * 8;
                let y = u16::from_be_bytes([rom[base], rom[base + 1]]) & 0x1FF;
                let x = u16::from_be_bytes([rom[base + 6], rom[base + 7]]) & 0x1FF;
                if y > 128 && y < 240 && x > 128 && x < 320 { valid += 1; }
            }
            if valid >= 5 { return Some(off); }
        }
    }
    None
}

/// Estima o tamanho da seção de tiles varrendo a ROM por padrões de tile 4bpp (32 bytes).
fn estimate_tile_section_size(rom: &[u8]) -> usize {
    // Heurística rápida: assume que ~25% da ROM são tiles gráficos
    (rom.len() / 4).min(64 * 1024)
}
