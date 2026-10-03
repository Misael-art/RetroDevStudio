//! Indice de contenedores ZIP lido **sen descomprimir nada**.
//!
//! Só se leen o final directorio central (EOCD) e os réxistres do directorio
//! central: nada do contenido se interpreta como ROM nin se materializa. Iso
//! mantén a lectura acotada e evita meter un inflador no paquete.
//!
//! Decisións que importan:
//! - Primeir comptase a contaxe declarada no EOCD; se excede `max_members`,
//!   recúsase **antes** de parsear o primeiro réxistro.
//! - ZIP64 recúsase explicitamente: anunciar 0xFFFFFFFF e non saber lelo
//!   produciría un tamaño falso, non un tamaño grande.
//! - Se a contaxe do EOCD non coincide co número de réxistres realmente
//!   percorridos, o índice é malformado; non se devolve un índice parcial.

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ZipMember {
    pub name: String,
    pub method: u16,
    pub crc32: u32,
    pub compressed: u64,
    pub uncompressed: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ZipIndex {
    pub members: Vec<ZipMember>,
    pub total_uncompressed: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ContainerError {
    NotAZip,
    MalformedCentralDirectory,
    Zip64Unsupported,
    MemberLimitExceeded { seen: usize, max: usize },
    NameTooLong { len: usize, max: usize },
}

const SIG_CENTRAL: u32 = 0x0201_4b50;
const SIG_EOCD: u32 = 0x0605_4b50;
const EOCD_LEN: usize = 22;
const MAX_COMMENT: usize = 0xFFFF;
const MAX_NAME: usize = 1024;

fn le16(b: &[u8], off: usize) -> usize {
    u16::from_le_bytes([b[off], b[off + 1]]) as usize
}

fn le32(b: &[u8], off: usize) -> u64 {
    u32::from_le_bytes([b[off], b[off + 1], b[off + 2], b[off + 3]]) as u64
}

/// Posición do EOCD, buscando cara atrás dende o final. Exixese que o
/// comentario declarado leve exactamente ata o byte final do arquivo: sen iso
/// calquera `0x06054b50` dentro dos datos parecería un contenedor.
fn eocd_offset(bytes: &[u8]) -> Option<usize> {
    if bytes.len() < EOCD_LEN {
        return None;
    }
    let inicio = bytes.len().saturating_sub(EOCD_LEN + MAX_COMMENT);
    (inicio..=bytes.len() - EOCD_LEN).rev().find(|&p| {
        le32(bytes, p) == SIG_EOCD as u64 && p + EOCD_LEN + le16(bytes, p + 20) == bytes.len()
    })
}

pub fn read_index(bytes: &[u8], max_members: usize) -> Result<ZipIndex, ContainerError> {
    let eocd = eocd_offset(bytes).ok_or(ContainerError::NotAZip)?;
    let declarados = le16(bytes, eocd + 10);
    if declarados > max_members {
        return Err(ContainerError::MemberLimitExceeded {
            seen: declarados,
            max: max_members,
        });
    }
    let tamano_cd = le32(bytes, eocd + 12) as usize;
    let inicio_cd = le32(bytes, eocd + 16) as usize;
    let fin_cd = inicio_cd
        .checked_add(tamano_cd)
        .ok_or(ContainerError::MalformedCentralDirectory)?;
    if inicio_cd >= bytes.len() || fin_cd > bytes.len() {
        return Err(ContainerError::MalformedCentralDirectory);
    }

    let mut members = Vec::new();
    let mut total_uncompressed = 0u64;
    let mut p = inicio_cd;
    while p < fin_cd {
        if p + 46 > fin_cd || le32(bytes, p) != SIG_CENTRAL as u64 {
            return Err(ContainerError::MalformedCentralDirectory);
        }
        let method = le16(bytes, p + 10);
        let crc = le32(bytes, p + 16) as u32;
        let compressed = le32(bytes, p + 20);
        let uncompressed = le32(bytes, p + 24);
        if compressed == u64::from(u32::MAX) || uncompressed == u64::from(u32::MAX) {
            return Err(ContainerError::Zip64Unsupported);
        }
        let nome_len = le16(bytes, p + 28);
        let extra_len = le16(bytes, p + 30);
        let comentario_len = le16(bytes, p + 32);
        if nome_len > MAX_NAME {
            return Err(ContainerError::NameTooLong {
                len: nome_len,
                max: MAX_NAME,
            });
        }
        let nome_ini = p + 46;
        let nome_fin = nome_ini + nome_len;
        if nome_fin > fin_cd {
            return Err(ContainerError::MalformedCentralDirectory);
        }
        let name = String::from_utf8_lossy(&bytes[nome_ini..nome_fin]).into_owned();
        total_uncompressed = total_uncompressed.saturating_add(uncompressed);
        members.push(ZipMember {
            name,
            method: method as u16,
            crc32: crc,
            compressed,
            uncompressed,
        });
        p = nome_fin + extra_len + comentario_len;
    }

    if members.len() != declarados {
        return Err(ContainerError::MalformedCentralDirectory);
    }
    Ok(ZipIndex {
        members,
        total_uncompressed,
    })
}
