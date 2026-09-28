//! Ciclo de edição demonstrativo (ENCODE-CONTRACT §9, ETAPAS 4-5 da missão
//! de codificação): plain autoral -> stream -> decode -> alteração
//! delimitada -> recompressão -> contêiner re-inserido -> host com vizinhos.
//! Prova de contrato em slot AUTORAL simulado — não é transação canônica de
//! produção e não toca ROM real nem arquivos compartilhados.
//!
//! Uso: cargo run --release --example edit_cycle -- <dir-saida>
//! Artefatos: host_v0.bin, host_v1.bin, edited_slot.kos, edited_plain.expect
//! (o modo diferencial confirma o slot editado com `koscmp -x` e compara os
//! vizinhos byte a byte).

use rex_kosinski::edit::{build, open, reinsert, EditError, HEADER_LEN, SENTINEL_A, SENTINEL_B};

fn lcg_bytes(seed: u32, n: usize) -> Vec<u8> {
    let mut state = seed;
    (0..n)
        .map(|_| {
            state = state.wrapping_mul(1103515245).wrapping_add(12345);
            (state >> 16) as u8
        })
        .collect()
}

fn fixture(nome: &str) -> Vec<u8> {
    let p = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../data/rex_profiles/kosinski_runtime/edit")
        .join(nome);
    std::fs::read(&p).unwrap_or_else(|e| panic!("fixture {nome}: {e}"))
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 2 {
        eprintln!("uso: edit_cycle <dir-saida>");
        std::process::exit(2);
    }
    let out = std::path::PathBuf::from(&args[1]);
    std::fs::create_dir_all(&out).expect("dir de saida");
    let big = 1usize << 26;

    let base = fixture("base_plain.bin");
    let editado = fixture("edited_plain.bin");
    assert_eq!(base.len(), editado.len(), "edição delimitada mantém o tamanho");

    // 1) contêiner base num slot com orçamento declarado (folga ~50%).
    let st_base = rex_kosinski::encode(&base, big, big).expect("encode do base").stream;
    let slot_cap = st_base.len() + st_base.len() / 2 + 16;
    let c = build(&base, slot_cap, big, big).expect("contêiner base");
    let info = open(&c, big, big).expect("open do contêiner base");
    assert_eq!(info.plain, base, "decode interno do slot base");
    assert_eq!(info.stream_len, st_base.len(), "P1: slot fecha no terminator");

    // 2) host autoral: vizinhos fixos antes e depois do contêiner-slot.
    let pre = lcg_bytes(0x1111_2222, 4096);
    let post = lcg_bytes(0x3333_4444, 4096);
    let mut host0 = Vec::new();
    host0.extend_from_slice(&pre);
    host0.extend_from_slice(&c);
    host0.extend_from_slice(&post);
    std::fs::write(out.join("host_v0.bin"), &host0).expect("host_v0");

    // 3) recusa SEM escrita antes de qualquer mutação (política 5):
    //    um plain que não cabe no slot não altera nada.
    let grande = lcg_bytes(0xDEAD_BEEF, slot_cap * 4);
    assert_eq!(
        reinsert(&c, &grande, big, big).err(),
        Some(EditError::StreamTooLarge)
    );
    assert_eq!(open(&c, big, big).unwrap().plain, base, "base intacto após recusa");

    // 4) reinserção da edição delimitada (recompressão no MESMO slot).
    let d = reinsert(&c, &editado, big, big).expect("reinsert da edição");
    let info1 = open(&d, big, big).expect("contêiner editado íntegro");
    assert_eq!(info1.plain, editado, "decode interno do slot editado");
    assert_eq!(d.len(), c.len(), "geometria preservada (sem realocação)");
    assert_eq!(&d[..8], SENTINEL_A);
    assert_eq!(&d[d.len() - 8..], SENTINEL_B);
    assert_eq!(info1.slot_cap, info.slot_cap);

    // 5) host v1 e preservação integral dos vizinhos.
    let mut host1 = Vec::new();
    host1.extend_from_slice(&pre);
    host1.extend_from_slice(&d);
    host1.extend_from_slice(&post);
    std::fs::write(out.join("host_v1.bin"), &host1).expect("host_v1");
    assert_eq!(&host1[..pre.len()], &pre[..], "vizinho anterior alterado");
    assert_eq!(
        &host1[host1.len() - post.len()..],
        &post[..],
        "vizinho posterior alterado"
    );
    // nada fora do contêiner mudou entre as duas versões do host:
    assert_eq!(
        &host1[pre.len() + d.len()..],
        &host0[pre.len() + c.len()..],
        "bytes vizinhos ao contêiner divergem"
    );

    // 6) artefatos para confirmação EXTERNA (koscmp -x no modo diferencial).
    let slot_stream = &d[HEADER_LEN..HEADER_LEN + info1.stream_len];
    std::fs::write(out.join("edited_slot.kos"), slot_stream).expect("edited_slot");
    std::fs::write(out.join("edited_plain.expect"), &editado).expect("expect");

    println!(
        "edicoe-ciclo ok slot_cap={} stream_base={} stream_edit={} host={} bytes",
        info.slot_cap,
        info.stream_len,
        info1.stream_len,
        host1.len()
    );
}
