//! Probas do índice ZIP. Constrúense os bytes do contenedor á man: non se
//! empregan ROMs comerciais nin ferramentas de terceiros para as esperas.

use rex_corpus::container::{self, ContainerError, ZipMember};

fn le16(v: u16) -> [u8; 2] {
    v.to_le_bytes()
}
fn le32(v: u32) -> [u8; 4] {
    v.to_le_bytes()
}

struct MembroFix {
    nome: &'static str,
    method: u16,
    crc: u32,
    comp: u32,
    desp: u32,
}

/// Reconstrúe un ZIP minimal: só directorio central + EOCD, que é o que se le.
fn zip(membros: &[MembroFix], comentario: &str) -> Vec<u8> {
    let mut cd = Vec::new();
    let mut offset = 0u32;
    for m in membros {
        let nome = m.nome.as_bytes();
        cd.extend_from_slice(&le32(0x0201_4b50));
        cd.extend_from_slice(&le16(20)); // version feito por
        cd.extend_from_slice(&le16(20)); // version necesaria
        cd.extend_from_slice(&le16(0)); // flags
        cd.extend_from_slice(&le16(m.method));
        cd.extend_from_slice(&le16(0x4000)); // hora
        cd.extend_from_slice(&le16(0x3821)); // data
        cd.extend_from_slice(&le32(m.crc));
        cd.extend_from_slice(&le32(m.comp));
        cd.extend_from_slice(&le32(m.desp));
        cd.extend_from_slice(&le16(nome.len() as u16));
        cd.extend_from_slice(&le16(0)); // extra len
        cd.extend_from_slice(&le16(0)); // comentario len
        cd.extend_from_slice(&le16(0)); // disco inicial
        cd.extend_from_slice(&le16(0)); // atributos internos
        cd.extend_from_slice(&le32(0)); // atributos externos
        cd.extend_from_slice(&le32(offset)); // offset da cabecera local
        cd.extend_from_slice(nome);
        offset = offset
            .saturating_add(30 + nome.len() as u32)
            .saturating_add(m.comp);
    }
    let cd_off = 0u32; // sin cabeceras locais: o CD comeza no byte 0
    let mut out = cd;
    let fin = out.len() as u32;
    out.extend_from_slice(&le32(0x0605_4b50));
    out.extend_from_slice(&le16(0));
    out.extend_from_slice(&le16(0));
    out.extend_from_slice(&le16(membros.len() as u16));
    out.extend_from_slice(&le16(membros.len() as u16));
    out.extend_from_slice(&le32(fin));
    out.extend_from_slice(&le32(cd_off));
    out.extend_from_slice(&le16(comentario.len() as u16));
    out.extend_from_slice(comentario.as_bytes());
    out
}

fn m(nome: &'static str, method: u16, crc: u32, comp: u32, desp: u32) -> MembroFix {
    MembroFix {
        nome,
        method,
        crc,
        comp,
        desp,
    }
}

#[test]
fn dous_membros_reportanse_con_method_crc_e_tamaños() {
    let bytes = zip(
        &[
            m("rom.bin", 8, 0xDE_AD_BE_EF, 396_282, 531_577),
            m("lectura.txt", 0, 0x0000_0001, 12, 12),
        ],
        "",
    );
    let idx = container::read_index(&bytes, 8).expect("indice");
    assert_eq!(idx.members.len(), 2);
    assert_eq!(
        idx.members[0],
        ZipMember {
            name: "rom.bin".to_string(),
            method: 8,
            crc32: 0xDE_AD_BE_EF,
            compressed: 396_282,
            uncompressed: 531_577,
        }
    );
    assert_eq!(idx.members[1].name, "lectura.txt");
    assert_eq!(idx.total_uncompressed, 531_577 + 12);
}

#[test]
fn a_orde_do_indice_e_a_do_directorio_central_non_e_de_extraccion() {
    // O indice debe reflectir a orde do CD, sen reordenar por nome.
    let bytes = zip(
        &[m("zeta.md", 8, 1, 10, 20), m("alfa.md", 8, 2, 11, 21)],
        "",
    );
    let idx = container::read_index(&bytes, 8).expect("indice");
    assert_eq!(idx.members[0].name, "zeta.md");
    assert_eq!(idx.members[1].name, "alfa.md");
}

#[test]
fn mais_membros_cá_limite_recusanse_sin_parsear_nada_mas() {
    let bytes = zip(
        &[
            m("a.md", 0, 1, 1, 1),
            m("b.md", 0, 2, 2, 2),
            m("c.md", 0, 3, 3, 3),
        ],
        "",
    );
    assert_eq!(
        container::read_index(&bytes, 2),
        Err(ContainerError::MemberLimitExceeded { seen: 3, max: 2 })
    );
}

#[test]
fn bytes_aleatorios_non_son_un_contenedor() {
    let bytes = vec![0x55u8; 4096];
    assert_eq!(
        container::read_index(&bytes, 8),
        Err(ContainerError::NotAZip)
    );
}

#[test]
fn un_arquivo_baleiro_non_e_un_zip() {
    assert_eq!(container::read_index(&[], 8), Err(ContainerError::NotAZip));
}

#[test]
fn zip64_recusase_explicitamente_en_lugar_de_mislectuar_o_tamano() {
    let bytes = zip(&[m("grande.md", 8, 7, 0xFFFF_FFFF, 0xFFFF_FFFF)], "");
    assert_eq!(
        container::read_index(&bytes, 8),
        Err(ContainerError::Zip64Unsupported)
    );
}

#[test]
fn directorio_central_mas_longo_cá_imaxe_e_un_indice_malformado_non_un_indice_parcial() {
    let mut bytes = zip(&[m("a.md", 0, 1, 1, 1), m("b.md", 0, 2, 2, 2)], "");
    // O EOCD anuncia un directorio central de 0xFFFFF bytes que non existe.
    let eocd = bytes.len() - 22;
    bytes[eocd + 12..eocd + 16].copy_from_slice(&le32(0x000F_FFFF));
    assert_eq!(
        container::read_index(&bytes, 8),
        Err(ContainerError::MalformedCentralDirectory)
    );
}

#[test]
fn nomes_con_espadas_e_barra_invertida_conservanse_taless_como_estan() {
    let bytes = zip(
        &[m(
            "Sonic the Hedgehog (USA, Europe).bin",
            8,
            0x1de0_3238,
            396_282,
            531_577,
        )],
        "",
    );
    let idx = container::read_index(&bytes, 8).expect("indice");
    assert_eq!(idx.members[0].name, "Sonic the Hedgehog (USA, Europe).bin");
}

#[test]
fn un_nome_demasiado_longo_recusase_sin_devolver_membros_incompletos() {
    let nome_ekeso = "x".repeat(1025);
    let longo = MembroFix {
        nome: Box::leak(nome_ekeso.into_boxed_str()),
        method: 0,
        crc: 1,
        comp: 1,
        desp: 1,
    };
    let bytes = zip(&[longo], "");
    assert_eq!(
        container::read_index(&bytes, 8),
        Err(ContainerError::NameTooLong {
            len: 1025,
            max: 1024
        })
    );
}
