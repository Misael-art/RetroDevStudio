//! Pino de procedência das fixtures vendradas no pacote.
//!
//! A suíte normal lê fixtures de `crates/rex-kosinski/fixtures/` (caminho
//! derivado do próprio `CARGO_MANIFEST_DIR`), NÃO de `../../data`. Este teste
//! garante que o conjunto é EXATAMENTE o esperado e que cada arquivo é
//! byte-idêntico à origem que ele espelha (`data/rex_profiles/...`), sem
//! depender dessa árvore estar presente. É a prova não-vazia de que o pacote
//! é relocável e de que nenhuma fixture foi corrompida, adicionada ou
//! removida silenciosamente. Usa o SHA-256 próprio do pacote (sem deps).

use rex_kosinski::edit::sha256_hex;
use std::path::PathBuf;

/// (caminho relativo a `fixtures/`, SHA-256 do conteúdo). Fonte: os bytes
/// publicados em `data/rex_profiles/codec/kosinski` e
/// `data/rex_profiles/kosinski_runtime` (rodadas #79/#81), copiados byte a
/// byte e conferidos com `cmp` na vendorização.
const PINNED: &[(&str, &str)] = &[
    (
        "kosinski/golden/m01_literals.expected.bin",
        "e9c0f8b575cbfcb42ab3b78ecc87efa3b011d9a5d10b09fa4e96f240bf6a82f5",
    ),
    (
        "kosinski/golden/m01_literals.kos",
        "58073828b565aed42901501b207cee19ac4b5ae753c31766dfbda3c61ffa0d1f",
    ),
    (
        "kosinski/golden/m02_single_with_eod.kos",
        "07d9b4efd994f51eca95524f07aeb3490e44c757d2e689655e978188649e72c1",
    ),
    (
        "kosinski/golden/m03_inline_match.expected.bin",
        "919c3b8b8e08d48059486c8349c144e329cc3af41ce116cd1acf4b93738f84aa",
    ),
    (
        "kosinski/golden/m03_inline_match.kos",
        "eaaf528394431ed65cb6a96cc82b35bb3610619d3916457faf4d6f88f9597e56",
    ),
    (
        "kosinski/golden/m04_separate_short.expected.bin",
        "eed465696c9a50d1b891b262675d4dfa22e4baa8197c441a0f7cd20e543c3443",
    ),
    (
        "kosinski/golden/m04_separate_short.kos",
        "79673c053c6ac1f8118613a511128fb12d8ebc57296c76cd424eb66686935255",
    ),
    (
        "kosinski/golden/m05_separate_long_far.expected.bin",
        "f54f89287c12a3502182f246d4788a946194087381deab5dd4d7f8196b6955be",
    ),
    (
        "kosinski/golden/m05_separate_long_far.kos",
        "f27f9aff17c7e6451b2889bd0d132c8c76770ae98257f7422d9091fc7d76aa61",
    ),
    (
        "kosinski/golden/m06_continue_edge.expected.bin",
        "9578ecfd18dfe61d72b9b529f8798292a9303e7d2e902aa76be84327baf3e3db",
    ),
    (
        "kosinski/golden/m06_continue_edge.kos",
        "ab096a92d1af61dd08f048e19e4aeb129e352093489c8e583b565dddeae84acb",
    ),
    (
        "kosinski/golden/m07_inline_exact_history.expected.bin",
        "69dc6c3210e25e62c5938ff4e841e81ce3c7d2cde583553478a77d7fcb389f30",
    ),
    (
        "kosinski/golden/m07_inline_exact_history.kos",
        "242e1214f1efcf28cccb4a71bcec26b10a4cf4ed70fe6fd1472e38358a6ab7c2",
    ),
    (
        "kosinski/golden/m08_len10_three_byte.expected.bin",
        "208640a3c2363b44a4afd1c5df6f87720c9a75fb06042241e4b7f6a74e14fd5d",
    ),
    (
        "kosinski/golden/m08_len10_three_byte.kos",
        "b1eafaf441702fc804135e952c82c3efdfaca8bf826a5be7664b23af195b065e",
    ),
    (
        "kosinski/golden/m09_earlyfetch_boundary_literal.expected.bin",
        "ba22b7dc95f6cc8765757be4bccf37cd92ece6d4987dc26a31e274c9be236921",
    ),
    (
        "kosinski/golden/m09_earlyfetch_boundary_literal.kos",
        "da295741e656e16179974b318d79ad59f664b361d88991ad021f39434d5c5ba5",
    ),
    (
        "kosinski/golden/m10_earlyfetch_straddle_inline.expected.bin",
        "273a0c1be37f7d3634da356480cfcb41871593eeacd75e4a7fc970d8a5e7d4e8",
    ),
    (
        "kosinski/golden/m10_earlyfetch_straddle_inline.kos",
        "7a04a5dba91d343341bd2bc13c6c3ee6de8aed39575cdbd3e5e1b75e43e53fd2",
    ),
    (
        "kosinski/negative/k01_no_terminator_after_literal.kos",
        "462fd23668ae7d949fdc2539f1baabcaa73df4b2bee3604c95707c70b592cf5b",
    ),
    (
        "kosinski/negative/k02_separate_missing_high_byte.kos",
        "5d9a6337751e43555487e66f2dffd6c7398cf6a65ad0467b81f0165467b3f404",
    ),
    (
        "kosinski/negative/k03_separate_ref_before_history_start.kos",
        "6b6e3c07b4e9c7a2092cddfa5e12c9e2f11bd3841529594dbd5f84554974ab84",
    ),
    (
        "kosinski/negative/k04_inline_dist_beyond_history.kos",
        "8a2e8b8b1f162d9e63052f8dc19f0197df3c785b257ff82461f9d517397f5423",
    ),
    (
        "kosinski/negative/k05_excessive_output.kos",
        "160ac8922184d91518ba1c955903ea394c7c78461852703ed2f8ed206e796547",
    ),
    (
        "kosinski/plain/abcdef.bin",
        "e9c0f8b575cbfcb42ab3b78ecc87efa3b011d9a5d10b09fa4e96f240bf6a82f5",
    ),
    (
        "kosinski/plain/abcdef.kos",
        "fb9ed18d8b9cf505f256f927c8eca592cb3774aef38a9207a4d8db6de04a2666",
    ),
    (
        "kosinski/plain/ab_repeat.bin",
        "02d2ae23004e61922cbfd8aefc8ea757c2258a4ba1a305736ffc82659281ba98",
    ),
    (
        "kosinski/plain/ab_repeat.kos",
        "bbf6c3db7c8db07ee5104b05bc014c2ffebdc479cf49ed8a1a6be6361dcf44d9",
    ),
    (
        "kosinski/plain/empty.bin",
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    ),
    (
        "kosinski/plain/empty.kos",
        "a53f93baaf14a909460524eb4ea387bfb2acc412c48ec9d6f15dca1fe0d2a324",
    ),
    (
        "kosinski/plain/far_window_40k.bin",
        "f92af5b62398fae2e9545e4e1397158817541384c46bd5474b4bd70fba802b1d",
    ),
    (
        "kosinski/plain/far_window_40k.kos",
        "9db758b16e8733f5e1f18c31c846ad4c0c452e9b844d316cc1521e99c42859f7",
    ),
    (
        "kosinski/plain/near_window_2k.bin",
        "cb7457cc6481376f58e72562cfd8aae3d5425147b4ce0a3ca495ea29cd5764e5",
    ),
    (
        "kosinski/plain/near_window_2k.kos",
        "96783125ae7fff2d63327b97f3a50256b42f024318086ce40fa9141052ce733c",
    ),
    (
        "kosinski/plain/noisy_runs_16k.bin",
        "07b46dc6addbfb8546df1d15bc9d0b78a0881890f0b8dfee1009f17db9ebff62",
    ),
    (
        "kosinski/plain/noisy_runs_16k.kos",
        "db077c5dbc8ccaa5996e77dbcbfbb4ec36d6795c798bc035287cd5a27c613249",
    ),
    (
        "kosinski/plain/odd3.bin",
        "3733cd977ff8eb18b987357e22ced99f46097f31ecb239e878ae63760e83e4d5",
    ),
    (
        "kosinski/plain/odd3.kos",
        "94f14c61036bee71b4f9a8354566e20e18f15a4412a28ea41ad606309e821fcd",
    ),
    (
        "kosinski/plain/pseudo_random_8k.bin",
        "733a31fa3a683c9daffae365a456bbe5145fed1cedbae888a10edca09e7f5a6e",
    ),
    (
        "kosinski/plain/pseudo_random_8k.kos",
        "68c5c194db4060ba4a444f885c5244bec94d08bb31e9dfdfa21fb1f863b8c885",
    ),
    (
        "kosinski/plain/single.bin",
        "bbeebd879e1dff6918546dc0c179fdde505f2a21591c9a9c96e36b054ec5af83",
    ),
    (
        "kosinski/plain/single.kos",
        "c5605acf5bfdf10fbac2803dbb592b94a6eadae7fbb58fabb7577495f60363dc",
    ),
    (
        "kosinski/plain/text_rep.bin",
        "15748fc11716b4cc2bfd0245eaa5ec664e021eecc31ac1dff9c8045ec746b750",
    ),
    (
        "kosinski/plain/text_rep.kos",
        "261d149458ee1dc66a6ca2736a221e88f98acefd25ccf33390c558c4beb9355f",
    ),
    (
        "kosinski/plain/tile_like.bin",
        "b81313391be143a836534d3a4ef99c978db8e730170c0d207893f2d8b2b5a03f",
    ),
    (
        "kosinski/plain/tile_like.kos",
        "5c29d4c5c4e0148167e5ffdb2724a9751f471b2d1ea6c34c2a0db5a99a2aa109",
    ),
    (
        "kosinski/plain/zeros_64k.bin",
        "de2f256064a0af797747c2b97505dc0b9f3df0de4f489eac731c23ae9ca9cc31",
    ),
    (
        "kosinski/plain/zeros_64k.kos",
        "e887c360014a4ecc7f3010f7e1c433114ba9282661bc9a1f995af4c7b8455a3c",
    ),
    (
        "runtime/edit/base_plain.bin",
        "242aa3709ac72780db96b77384d1771695915f7a4bab4946634cb1823560db26",
    ),
    (
        "runtime/edit/edited_plain.bin",
        "324ecaa23fe3a8b35d1f3a2c1a2a4713a48b7652a61bd94a9bb0dbad6636273e",
    ),
    (
        "runtime/overlap_echo.expected.bin",
        "7b346904f63cc07f1d8cc2d88d7dae08a3f088a0e4159d5214c27a6571a51eb4",
    ),
    (
        "runtime/overlap_echo.kos",
        "ffde8de70ee9a51823cc9ce07a9062c684ab606a7e5aa4c237b98c582c2b7a53",
    ),
];

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures")
}

fn listar(dir: &PathBuf, base: &PathBuf, out: &mut Vec<String>) {
    for e in std::fs::read_dir(dir).expect("dir de fixtures") {
        let p = e.expect("entrada").path();
        if p.is_dir() {
            listar(&p, base, out);
        } else if matches!(
            p.extension().and_then(|s| s.to_str()),
            Some("kos") | Some("bin")
        ) {
            out.push(
                p.strip_prefix(base)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/"),
            );
        }
    }
}

#[test]
fn conjunto_de_fixtures_exatamente_o_pinado() {
    let base = fixtures_dir();
    let mut achados = Vec::new();
    listar(&base, &base, &mut achados);
    achados.sort();
    let mut esperados: Vec<String> = PINNED.iter().map(|(p, _)| p.to_string()).collect();
    esperados.sort();
    assert_eq!(
        achados, esperados,
        "o diretório fixtures/ divergiu do conjunto pinado (arquivo faltando ou extra)"
    );
    assert_eq!(PINNED.len(), 52, "pino cobre 52 fixtures");
}

#[test]
fn cada_fixture_bate_o_sha_pinado() {
    let base = fixtures_dir();
    for (rel, want) in PINNED {
        let bytes = std::fs::read(base.join(rel)).unwrap_or_else(|e| panic!("fixture {rel}: {e}"));
        assert_eq!(sha256_hex(&bytes), *want, "SHA divergiu do pino: {rel}");
    }
}
