use crate::emulator::libretro_ffi::{FrameSize, PixelFormat};

#[derive(Debug, serde::Serialize, Clone)]
pub struct FramePayload {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

pub fn framebuffer_to_rgba(src: &[u8], size: FrameSize, pixel_format: PixelFormat) -> FramePayload {
    let pixel_count = (size.width * size.height) as usize;
    let mut rgba = vec![0u8; pixel_count * 4];

    match pixel_format {
        PixelFormat::Xrgb8888 => {
            for index in 0..pixel_count {
                let src_offset = index * 4;
                let pixel = u32::from_le_bytes([
                    src[src_offset],
                    src[src_offset + 1],
                    src[src_offset + 2],
                    src[src_offset + 3],
                ]);
                write_rgba(&mut rgba, index, expand_8((pixel >> 16) as u8), expand_8((pixel >> 8) as u8), expand_8(pixel as u8));
            }
        }
        PixelFormat::Rgb565 => {
            for index in 0..pixel_count {
                let src_offset = index * 2;
                let pixel = u16::from_le_bytes([src[src_offset], src[src_offset + 1]]);
                let red = ((pixel >> 11) & 0x1F) as u8;
                let green = ((pixel >> 5) & 0x3F) as u8;
                let blue = (pixel & 0x1F) as u8;
                write_rgba(
                    &mut rgba,
                    index,
                    expand_5(red),
                    expand_6(green),
                    expand_5(blue),
                );
            }
        }
        PixelFormat::Xrgb1555 => {
            for index in 0..pixel_count {
                let src_offset = index * 2;
                let pixel = u16::from_le_bytes([src[src_offset], src[src_offset + 1]]);
                let red = ((pixel >> 10) & 0x1F) as u8;
                let green = ((pixel >> 5) & 0x1F) as u8;
                let blue = (pixel & 0x1F) as u8;
                write_rgba(
                    &mut rgba,
                    index,
                    expand_5(red),
                    expand_5(green),
                    expand_5(blue),
                );
            }
        }
    }

    FramePayload {
        width: size.width,
        height: size.height,
        rgba,
    }
}

fn write_rgba(dst: &mut [u8], index: usize, red: u8, green: u8, blue: u8) {
    let dst_offset = index * 4;
    dst[dst_offset] = red;
    dst[dst_offset + 1] = green;
    dst[dst_offset + 2] = blue;
    dst[dst_offset + 3] = 0xFF;
}

fn expand_8(value: u8) -> u8 {
    value
}

fn expand_6(value: u8) -> u8 {
    (value << 2) | (value >> 4)
}

fn expand_5(value: u8) -> u8 {
    (value << 3) | (value >> 2)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_xrgb8888_to_rgba() {
        let src = 0x00123456u32.to_le_bytes();
        let payload = framebuffer_to_rgba(
            &src,
            FrameSize {
                width: 1,
                height: 1,
                pitch: 4,
            },
            PixelFormat::Xrgb8888,
        );

        assert_eq!(payload.rgba, vec![0x12, 0x34, 0x56, 0xFF]);
    }

    #[test]
    fn converts_rgb565_to_rgba() {
        let src = 0b11111_111111_00000u16.to_le_bytes();
        let payload = framebuffer_to_rgba(
            &src,
            FrameSize {
                width: 1,
                height: 1,
                pitch: 2,
            },
            PixelFormat::Rgb565,
        );

        assert_eq!(payload.rgba[0], 0xFF);
        assert_eq!(payload.rgba[1], 0xFF);
        assert_eq!(payload.rgba[2], 0x00);
        assert_eq!(payload.rgba[3], 0xFF);
    }
}
