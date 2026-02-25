//! Frame Buffer — converte framebuffer XRGB8888 para formato transferível via IPC.
//!
//! Formato do pixel XRGB8888: Byte 0=X(0xFF), 1=R, 2=G, 3=B.
//! Canvas ImageData espera: [R, G, B, A, ...].

use crate::emulator::libretro_ffi::FrameSize;

/// Payload serializado enviado ao frontend via evento `emulator://frame`.
#[derive(Debug, serde::Serialize, Clone)]
pub struct FramePayload {
    /// Largura do frame em pixels
    pub width: u32,
    /// Altura do frame em pixels
    pub height: u32,
    /// Pixels RGBA como array de bytes (width * height * 4).
    /// Formato: [R, G, B, A, R, G, B, A, ...]  (Canvas ImageData compatível)
    /// Transferido como array JSON de u8 — eficiente para frames 320x224 (~286KB JSON).
    pub rgba: Vec<u8>,
}

/// Converte um framebuffer XRGB8888 (Libretro) para RGBA (Canvas ImageData).
///
/// Libretro XRGB8888: [0xFF, R, G, B] por pixel
/// Canvas ImageData:  [R, G, B, 0xFF] por pixel
pub fn xrgb8888_to_rgba(src: &[u8], size: FrameSize) -> FramePayload {
    let pixel_count = (size.width * size.height) as usize;
    let mut rgba = vec![0u8; pixel_count * 4];

    for i in 0..pixel_count {
        let src_offset = i * 4;
        let dst_offset = i * 4;
        // Libretro: [X, R, G, B] → Canvas: [R, G, B, A=255]
        rgba[dst_offset]     = src[src_offset + 1]; // R
        rgba[dst_offset + 1] = src[src_offset + 2]; // G
        rgba[dst_offset + 2] = src[src_offset + 3]; // B
        rgba[dst_offset + 3] = 0xFF;                // A (opaco)
    }

    FramePayload {
        width: size.width,
        height: size.height,
        rgba,
    }
}
