//! Cabeco de cartucho Mega Drive.
//!
//! Layout fixado en SGDK `inc/sys.h` @ 2eac605a7744a6eb4f61824bb24ccab39b8bd8b8
//! (MIT): 18 campos entre 0x100 e 0x1FF, 256 bytes no total. A suma de
//! verificación é a que xa emprega o produto
//! (`src-tauri/src/core/rom_mastering.rs:268`): palabras de 16 bits en
//! big-endian dende 0x200 ata o final da imaxe, co último byte parellado con
//! cero se a lonxitude é impar.

/// Fin do rango que ocupa o cabeco (0x100..0x200).
pub const HEADER_END: usize = 0x200;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChecksumField {
    /// Valor declarado no cabeco.
    Value(u16),
    /// Os dous bytes do campo son espazos: o cabeco non inicializou o campo.
    /// Non se interpreta como «sen checksum», só como «campo en branco».
    Blank,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ChecksumStatus {
    pub field: ChecksumField,
    /// Suma observada na imaxe, sempre medida.
    pub observed: u16,
    /// `true` soamente se o campo ten valor e coincide coa suma observada.
    pub matching: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MdHeader {
    pub console: String,
    pub copyright: String,
    pub title_local: String,
    pub title_int: String,
    pub serial: String,
    pub io_support: String,
    pub sram_sig: String,
    pub sram_type: u16,
    pub sram_start: u32,
    pub sram_end: u32,
    pub modem_support: String,
    pub notes: String,
    pub region: String,
    pub rom_start: u32,
    pub rom_end: u32,
    pub ram_start: u32,
    pub ram_end: u32,
    pub checksum: u16,
    /// Algún campo de texto levaba bytes fóra do rango imprimible ASCII e
    /// devolveuse perdoando informacion. Marca o perdao, non o esconde.
    pub text_lossy: bool,
    /// Nomes dos campos de texto nos que se perdeu información, no ordine de
    /// lectura. Un flag xeral non localiza nada: o nome do campo e o que
    /// converte o dato nunha evidenciausable (p.ex. un título localizado).
    pub campos_perdidos: Vec<String>,
    /// Nomes dos campos numéricos cuxos bytes son espazos (`0x20`): o cabeco
    /// non os inicializou. Non se equivalen a cero.
    pub campos_branco: Vec<String>,
}

fn texto(bytes: &[u8], off: usize, len: usize) -> (String, bool) {
    let raw = &bytes[off..off + len];
    let fin = raw
        .iter()
        .rposition(|b| *b != 0x00 && *b != 0x20)
        .map(|i| i + 1)
        .unwrap_or(0);
    let corpo = &raw[..fin];
    let lossy = corpo.iter().any(|b| !(0x20..=0x7e).contains(b));
    (String::from_utf8_lossy(corpo).into_owned(), lossy)
}

fn be16(bytes: &[u8], off: usize) -> u16 {
    u16::from_be_bytes([bytes[off], bytes[off + 1]])
}

fn be32(bytes: &[u8], off: usize) -> u32 {
    u32::from_be_bytes([bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]])
}

/// `true` cando os `n` bytes do campo son todos espazo: un cabeco que non
/// inicializou o campo, non un valor que si o fixo.
fn branco(bytes: &[u8], off: usize, n: usize) -> bool {
    bytes[off..off + n].iter().all(|b| *b == 0x20)
}

impl MdHeader {
    /// `None` se a imaxe non chega a 0x200 bytes: sen cabeco non hai campos.
    pub fn parse(bytes: &[u8]) -> Option<MdHeader> {
        if bytes.len() < HEADER_END {
            return None;
        }
        let mut text_lossy = false;
        let mut campos_perdidos: Vec<String> = Vec::new();
        let mut campos_branco: Vec<String> = Vec::new();
        let mut campo = |off: usize, len: usize, nome: &str| {
            let (valor, l) = texto(bytes, off, len);
            if l {
                text_lossy = true;
                campos_perdidos.push(nome.to_string());
            }
            valor
        };
        let mut numeric = |off: usize, len: usize, nome: &str| {
            if branco(bytes, off, len) {
                campos_branco.push(nome.to_string());
            }
        };
        let sram_sig = campo(0x1B0, 2, "sram_sinatura");
        numeric(0x1B2, 2, "sram_tipo");
        let sram_type = be16(bytes, 0x1B2);
        numeric(0x1B4, 4, "sram_inicio");
        let sram_start = be32(bytes, 0x1B4);
        numeric(0x1B8, 4, "sram_fin");
        let sram_end = be32(bytes, 0x1B8);
        numeric(0x1A0, 4, "rom_inicio");
        let rom_start = be32(bytes, 0x1A0);
        numeric(0x1A4, 4, "rom_fin");
        let rom_end = be32(bytes, 0x1A4);
        numeric(0x1A8, 4, "ram_inicio");
        let ram_start = be32(bytes, 0x1A8);
        numeric(0x1AC, 4, "ram_fin");
        let ram_end = be32(bytes, 0x1AC);
        Some(MdHeader {
            console: campo(0x100, 16, "console"),
            copyright: campo(0x110, 16, "copyright"),
            title_local: campo(0x120, 48, "titulo_local"),
            title_int: campo(0x150, 48, "titulo_internacional"),
            serial: campo(0x180, 14, "serial"),
            io_support: campo(0x190, 16, "io_suporte"),
            sram_sig,
            sram_type,
            sram_start,
            sram_end,
            modem_support: campo(0x1BC, 12, "modem_suporte"),
            notes: campo(0x1C8, 40, "notas"),
            region: campo(0x1F0, 16, "rexion"),
            rom_start,
            rom_end,
            ram_start,
            ram_end,
            checksum: be16(bytes, 0x18E),
            text_lossy,
            campos_perdidos,
            campos_branco,
        })
    }

    pub fn checksum_status(&self, bytes: &[u8]) -> ChecksumStatus {
        let observed = checksum_sum(bytes);
        let field = if bytes[0x18E] == 0x20 && bytes[0x18F] == 0x20 {
            ChecksumField::Blank
        } else {
            ChecksumField::Value(self.checksum)
        };
        let matching = field == ChecksumField::Value(self.checksum) && self.checksum == observed;
        ChecksumStatus {
            field,
            observed,
            matching,
        }
    }

    /// Lonxitude de ROM que o propio cabeco declara (`rom_end - rom_start + 1`).
    /// `None` cando o rango é incoherente **ou** cando calquera dos dous campos
    /// está en branco: entón non hai nada que comparar.
    pub fn declared_len(&self) -> Option<u64> {
        if self
            .campos_branco
            .iter()
            .any(|c| c == "rom_inicio" || c == "rom_fin")
        {
            return None;
        }
        if self.rom_end < self.rom_start {
            return None;
        }
        Some(u64::from(self.rom_end - self.rom_start) + 1)
    }
}

/// Suma de palabras BE dende 0x200 ata o final da imaxe.
pub fn checksum_sum(bytes: &[u8]) -> u16 {
    let mut sum = 0u32;
    let mut off = 0x200usize;
    while off < bytes.len() {
        let lo = bytes.get(off + 1).copied().unwrap_or(0);
        sum = sum.wrapping_add(u16::from_be_bytes([bytes[off], lo]) as u32);
        off += 2;
    }
    sum as u16
}

/// Diferenza en bytes entre a lonxitude real do arquivo e a que declara o
/// cabeco. Positiva = o arquivo excede o span declarado.
pub fn declared_vs_real(header: &MdHeader, real_len: usize) -> Option<i64> {
    header.declared_len().map(|d| real_len as i64 - d as i64)
}
