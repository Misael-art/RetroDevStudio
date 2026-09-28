//! Testes do contêiner de edição autoral (ENCODE-CONTRACT §9) — prova de
//! contrato, NÃO transação canônica de produção. Expectativas derivadas do
//! contrato numerado: 1 no-op byte-idêntico, 2 edição delimitada confirmada,
//! 3 geometria/sentinelas preservados e campos de identidade acompanhando o
//! conteúdo, 4 padding 0x00 explícito até slot_cap, 5 recusa SEM escrita,
//! 6 divergência de identidade recusada. Suite roda sem oráculo.

use rex_kosinski::edit::{build, open, reinsert, EditError, HEADER_LEN, SENTINEL_A, SENTINEL_B};

fn editdir() -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../data/rex_profiles/kosinski_runtime/edit")
}

fn fixture(nome: &str) -> Vec<u8> {
    std::fs::read(editdir().join(nome)).expect("fixture de edição")
}

const BIG: usize = 1 << 24;

/// P3/ geometria: sentinelas nas bordas e slot exatamente slot_cap.
fn geometria_ok(c: &[u8], slot_cap: usize) {
    assert_eq!(&c[0..8], SENTINEL_A, "sentinela A");
    assert_eq!(&c[c.len() - 8..], SENTINEL_B, "sentinela B");
    assert_eq!(c.len(), HEADER_LEN + slot_cap + 8, "geometria do contêiner");
}

#[test]
fn sha256_bate_vetores_publicados() {
    // O contêiner declara sha256(plain); sem dependências externas, o
    // pacote implementa FIPS 180-4 — pinned contra vetores oficiais.
    assert_eq!(
        rex_kosinski::edit::sha256_hex(b""),
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    assert_eq!(
        rex_kosinski::edit::sha256_hex(b"abc"),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    assert_eq!(
        rex_kosinski::edit::sha256_hex(&[0x61u8; 1000]),
        "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3"
    );
}

#[test]
fn build_open_roundtrip_com_identidade() {
    let base = fixture("base_plain.bin");
    let c = build(&base, 4096, BIG, BIG).expect("build do plain autoral");
    geometria_ok(&c, 4096);
    let info = open(&c, BIG, BIG).expect("open do contêiner válido");
    assert_eq!(info.plain, base, "decoded do slot != plain base");
    assert_eq!(info.plain_len, base.len());
    // política 4: tudo após stream_len até slot_cap é padding 0x00.
    assert!(c[HEADER_LEN + info.stream_len..HEADER_LEN + 4096]
        .iter()
        .all(|&b| b == 0x00));
    // padding é política do EMISSOR do contêiner; bytes_consumed do slot
    // fecha exatamente em stream_len (P1 sobre o stream do slot).
    assert_eq!(
        rex_kosinski::decode(&c[HEADER_LEN..HEADER_LEN + info.stream_len], BIG, BIG)
            .unwrap()
            .bytes_consumed,
        info.stream_len
    );
}

#[test]
fn politica1_reinsercao_no_op_produz_contener_byte_identico() {
    let base = fixture("base_plain.bin");
    let c = build(&base, 4096, BIG, BIG).unwrap();
    let d = reinsert(&c, &base, BIG, BIG).expect("no-op deve aceitar");
    assert_eq!(c, d, "re-encode determinístico exige contêiner idêntico");
}

#[test]
fn politica2_edicao_delimitada_confirma_conteudo_editado() {
    let base = fixture("base_plain.bin");
    let novo = fixture("edited_plain.bin");
    assert_eq!(
        base.len(),
        novo.len(),
        "fixtures: mudança só na região BASE->MOD1"
    );
    let c = build(&base, 4096, BIG, BIG).unwrap();
    let d = reinsert(&c, &novo, BIG, BIG).expect("edição delimitada");
    let info = open(&d, BIG, BIG).expect("contêiner editado íntegro");
    assert_eq!(
        info.plain, novo,
        "decode interno do slot editado != conteúdo esperado"
    );
    geometria_ok(&d, 4096);
}

#[test]
fn politica3_geometria_preservada_campos_de_identidade_acompanham_conteudo() {
    let base = fixture("base_plain.bin");
    let novo = fixture("edited_plain.bin");
    let c = build(&base, 4096, BIG, BIG).unwrap();
    let d = reinsert(&c, &novo, BIG, BIG).unwrap();
    // sentinelas e slot_cap byte a byte; região do slot tem mesmo tamanho.
    assert_eq!(&c[0..8], &d[0..8]);
    assert_eq!(&c[c.len() - 8..], &d[d.len() - 8..]);
    let i0 = open(&c, BIG, BIG).unwrap();
    let i1 = open(&d, BIG, BIG).unwrap();
    assert_eq!(i0.slot_cap, i1.slot_cap, "slot_cap é imutável");
    assert_eq!(c.len(), d.len(), "geometria total imutável");
    // campos de identidade seguem o conteúdo (retificação §9 item 3).
    assert_eq!(i1.plain_len, novo.len());
    assert_eq!(
        &d[HEADER_LEN - 32..HEADER_LEN],
        &sha_bytes(&novo)[..],
        "campo sha256(plain) do cabeçalho deve ser o hash do NOVO conteúdo"
    );
}

fn sha_bytes(p: &[u8]) -> Vec<u8> {
    // helper de teste: sha binário a partir do hex publicado pela própria
    // função pinada em sha256_bate_vetores_publicados.
    (0..32)
        .map(|i| {
            u8::from_str_radix(&rex_kosinski::edit::sha256_hex(p)[i * 2..i * 2 + 2], 16).unwrap()
        })
        .collect()
}

#[test]
fn politica5_stream_maior_que_slot_recusa_sem_escrita() {
    let base = fixture("base_plain.bin");
    // slot apertado: cap = stream do base + 1 (cabe justo) — um plain maior
    // NÃO cabe e a recusa não escreve nada.
    let c0 = build(&base, 4096, BIG, BIG).unwrap();
    let cap = open(&c0, BIG, BIG).unwrap().stream_len + 1;
    let c = build(&base, cap, BIG, BIG).expect("base cabe no slot apertado");
    let aleatorio: Vec<u8> = (0..600u32)
        .map(|i| i.wrapping_mul(2654435761) as u8)
        .collect();
    assert_eq!(
        build(&aleatorio, 16, BIG, BIG).err(),
        Some(EditError::StreamTooLarge),
        "slot 16B < stream mínima do pseudo-aleatório"
    );
    assert_eq!(
        reinsert(&c, &aleatorio, BIG, BIG).err(),
        Some(EditError::StreamTooLarge),
        "plain maior que o slot deve recusar"
    );
    assert!(
        open(&c, BIG, BIG).is_ok(),
        "recusa não pode invalidar o contêiner base"
    );
    // e o contêiner de slot apertado segue íntegro e no-op-estável:
    assert_eq!(reinsert(&c, &base, BIG, BIG).unwrap(), c);
}

#[test]
fn politica6_identidade_divergente_recusada() {
    let base = fixture("base_plain.bin");
    let c = build(&base, 4096, BIG, BIG).unwrap();
    // (a) tamper do campo sha no cabeçalho
    let mut t = c.clone();
    t[HEADER_LEN - 1] ^= 0xFF;
    assert_eq!(open(&t, BIG, BIG).err(), Some(EditError::IdentityMismatch));
    // (b) tamper do plain_len declarado (u32 LE em 8..12)
    let mut t = c.clone();
    t[8] ^= 0x01;
    assert!(matches!(
        open(&t, BIG, BIG).err(),
        Some(EditError::IdentityMismatch) | Some(EditError::DecodeFailed)
    ));
    // (c) byte de dado do slot mutado (literal) -> decoded != identidade
    let mut t = c.clone();
    t[HEADER_LEN + 2] ^= 0xFF; // primeiro byte de dado após o descritor
    assert_eq!(open(&t, BIG, BIG).err(), Some(EditError::IdentityMismatch));
    // (d) reinsert sobre contêiner de identidade divergente recusa antes de re-codificar
    assert_eq!(
        reinsert(
            &{
                let mut t = c.clone();
                t[HEADER_LEN - 1] ^= 0xFF;
                t
            },
            b"X",
            BIG,
            BIG
        )
        .err(),
        Some(EditError::IdentityMismatch)
    );
}

#[test]
fn sentinela_e_truncamento_malformados_recusados_sem_panic() {
    let base = fixture("base_plain.bin");
    let c = build(&base, 4096, BIG, BIG).unwrap();
    let mut t = c.clone();
    t[3] = b'Z';
    assert_eq!(open(&t, BIG, BIG).err(), Some(EditError::Malformed));
    let mut t = c.clone();
    t.truncate(c.len() - 2);
    assert_eq!(open(&t, BIG, BIG).err(), Some(EditError::Malformed));
    // ruído arbitrário: nunca pânico, sempre erro estruturado
    let mut state = 0xC0FFEEu32;
    for n in [0usize, 1, 8, 52, 60, 100, 512] {
        let mut v = vec![0u8; n];
        for (i, x) in v.iter_mut().enumerate() {
            state = state.wrapping_mul(1103515245).wrapping_add(12345);
            *x = ((state >> 16) + i as u32) as u8;
        }
        if n >= 68 {
            // pode inclusive ter sentinelas por azar? não com este seed; o
            // contrato só exige: resultado é Ok ou Err, jamais panic.
            let _ = open(&v, BIG, BIG);
        } else {
            assert_eq!(open(&v, BIG, BIG).err(), Some(EditError::Malformed));
        }
    }
}
