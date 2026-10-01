//! Probas de `scan`, `consumer` e `rexistro` (Fase 2): evidencia estrutural
//! medida sobre bytes locais.
//!
//! Os fixtures son autorais. As secuencias Kosinski constrúense a man co
//! formato documentado en `crates/rex-kosinski` (descritor de 16 bits
//! little-endian consumido LSB->MSB, bit 1 = literal, `0,1` + low + high + 0
//! = terminator), polo que ningunha expectativa depende de bytes comerciais.

use rex_corpus::consumer::{call_sites, references_to, tables_for};
use rex_corpus::json::render;
use rex_corpus::resource::{Confidence, ResourceRecord};
use rex_corpus::scan::{scan, ScanLimits};
use rex_kosinski::edit::sha256_hex;

/// Descritor cuxos primeiros bits (LSB->MSB) son `bits`.
fn descritor(bits: &[u8]) -> [u8; 2] {
    let mut v = 0u16;
    for (i, b) in bits.iter().enumerate() {
        v |= (*b as u16) << i;
    }
    [v as u8, (v >> 8) as u8] // little-endian: o byte baixo vai primeiro
}

/// `ABCDE` en claro + terminator. Dez bytes de entrada, cinco de saida.
fn fluxo_literal() -> Vec<u8> {
    let d = descritor(&[1, 1, 1, 1, 1, 0, 1]);
    let mut v = vec![d[0], d[1]];
    v.extend_from_slice(b"ABCDE");
    v.extend_from_slice(&[0x00, 0x00, 0x00]); // low, high (count3=0), terminator
    v
}

/// `ABC` en claro + copia inline (len=4, dist=3) + terminator.
///
/// Bits: 1,1,1 literais; 0,0 -> copia inline; 1,0 -> h=1,l=0 => len=4; o byte
/// de distancia 0FD dá dist = 0x100-0xFD = 3; e despois 0,1 + low + high + 0.
fn fluxo_con_copia() -> Vec<u8> {
    let d = descritor(&[1, 1, 1, 0, 0, 1, 0, 0, 1]);
    let mut v = vec![d[0], d[1]];
    v.extend_from_slice(b"ABC");
    v.push(0xFD); // distancia
    v.extend_from_slice(&[0x00, 0x00, 0x00]); // low, high, terminator
    v
}

#[test]
fn fluxo_literal_decodifica_cos_cinco_bytes_e_dez_consumidos() {
    let f = fluxo_literal();
    let r = rex_kosinski::decode(&f, 0x1000, 4_000_000).expect("decodifica");
    assert_eq!(r.output, b"ABCDE");
    assert_eq!(r.bytes_consumed, f.len());
}

#[test]
fn copia_inline_reproduce_a_xanela_de_historico() {
    let f = fluxo_con_copia();
    let r = rex_kosinski::decode(&f, 0x1000, 4_000_000).expect("decodifica");
    // dist=3 sobre "ABC": a xanela comeza no indice 0, non no 1 => A,B,C,A.
    assert_eq!(r.output, b"ABCABCA");
    assert_eq!(r.bytes_consumed, f.len());
}

// ---------- scan ----------

/// Limites que aceptan saidas curtas: o fixture literal só produce cinco bytes.
fn limites_fluxos() -> ScanLimits {
    ScanLimits {
        min_output: 1,
        ..ScanLimits::DEFAULT
    }
}

#[test]
fn scan_atopa_un_fluxo_plantado_e_reporta_a_sua_medida() {
    let fluxo = fluxo_literal();
    let mut image = vec![0xFFu8; 0x40];
    image[0x20..0x20 + fluxo.len()].copy_from_slice(&fluxo);

    let rep = scan(&image, &limites_fluxos());
    let hit = rep
        .candidates
        .iter()
        .find(|c| c.offset == 0x20)
        .unwrap_or_else(|| {
            panic!(
                "non se atopou 0x20 entre {:?}",
                rep.candidates.iter().map(|c| c.offset).collect::<Vec<_>>()
            )
        });
    assert_eq!(hit.output_size, 5);
    assert_eq!(hit.bytes_consumed, fluxo.len());
    assert_eq!(hit.output_sha256, sha256_hex(b"ABCDE"));
}

#[test]
fn scan_non_lee_fora_da_xanela_que_declara_a_rom() {
    let fluxo = fluxo_literal();
    let mut image = vec![0xFFu8; 0x100];
    image[0x80..0x80 + fluxo.len()].copy_from_slice(&fluxo);

    let l = ScanLimits {
        to: Some(0x40),
        ..limites_fluxos()
    };
    let rep = scan(&image, &l);
    assert!(
        rep.candidates.iter().all(|c| c.offset != 0x80),
        "escaneou fóra da xanela: {:?}",
        rep.candidates.iter().map(|c| c.offset).collect::<Vec<_>>()
    );
}

#[test]
fn scan_conta_un_intento_por_desprazamento_cos_stride_dous() {
    let image = vec![0u8; 0x22];
    let rep = scan(&image, &ScanLimits::DEFAULT);
    // 0x00, 0x02, ..., 0x20 = 17 intentos sobre 34 bytes.
    assert_eq!(rep.attempts, 17);
    let offsets: Vec<usize> = rep.candidates.iter().map(|c| c.offset).collect();
    let mut sen_duplicados = offsets.clone();
    sen_duplicados.sort_unstable();
    sen_duplicados.dedup();
    assert_eq!(
        sen_duplicados.len(),
        offsets.len(),
        "desprazamentos duplicados"
    );
}

#[test]
fn scan_rexistra_un_fluxo_truncado_co_motivo_exacto_non_como_candidate() {
    let mut f = fluxo_literal();
    f.pop(); // quita o terminator: o lector exaurese sen el
    let l = ScanLimits {
        to: Some(f.len()),
        ..limites_fluxos()
    };
    let rep = scan(&f, &l);
    assert_eq!(
        rex_kosinski::decode(&f, 0x1000, 4_000_000).err(),
        Some(rex_kosinski::KosError::Truncated)
    );
    assert!(
        rep.candidates.iter().all(|c| c.offset != 0),
        "{:?}",
        rep.candidates
    );
    assert!(rep.refusals.truncated > 0, "negativas: {:?}", rep.refusals);
}

#[test]
fn scan_unha_decodificacion_limpa_por_debaixo_do_minimo_non_e_un_negativo_do_formato() {
    // Dous literais -> saida de 2 bytes. Decodifica ben, pero é demasiado curta
    // para ser un recurso: queda en below_min_output, non nun motivo de erro.
    let d = descritor(&[1, 1, 0, 1]);
    let mut image = vec![d[0], d[1], b'A', b'B', 0x00, 0x00, 0x00];
    image.resize(0x20, 0xFF);
    let l = ScanLimits {
        min_output: 16,
        ..ScanLimits::DEFAULT
    };
    let rep = scan(&image, &l);
    assert!(rep.candidates.iter().all(|c| c.offset != 0));
    assert!(rep.refusals.below_min_output >= 1, "{:?}", rep.refusals);
}

#[test]
fn scan_detense_ao_acadar_o_tope_de_candidatos_e_marca_o_truncamento() {
    // Seis fluxos con período 16 (nove bytes + sete de recheo), todos en desprazamento par.
    let fluxo = fluxo_con_copia();
    let mut image = Vec::new();
    for _ in 0..6 {
        image.extend_from_slice(&fluxo);
        image.extend_from_slice(&[0xFFu8; 7]);
    }
    let l = ScanLimits {
        max_candidates: 2,
        min_output: 4,
        ..ScanLimits::DEFAULT
    };
    let rep = scan(&image, &l);
    assert_eq!(rep.candidates.len(), 2);
    assert!(rep.truncated_by_limit);
    assert!(
        rep.attempts < image.len() / 2,
        "seguiron escaneando: {}",
        rep.attempts
    );
}

#[test]
fn scan_non_promete_saída_por_ribia_do_teto_declarado() {
    let l = ScanLimits {
        max_output: 32,
        min_output: 1,
        ..ScanLimits::DEFAULT
    };
    let image = vec![0u8; 0x400];
    let rep = scan(&image, &l);
    assert!(
        rep.candidates.iter().all(|c| c.output_size <= 32),
        "{:?}",
        rep.candidates
    );
}

// ---------- consumer ----------

/// Imaxe sintética con código 68k: `jsr` e `jmp` absolutos longos, un `movea`
/// co mesmo operando (que non é jsr/jmp) e unha táboa ascendente de longwords
/// cuxos valores caen dentro da propia imaxe.
fn imaxe_con_codigo() -> Vec<u8> {
    let mut v = vec![0u8; 0x200];
    // @0x40: 4E B9 00 00 01 C0  (jsr    $1c0)
    v[0x40..0x46].copy_from_slice(&[0x4E, 0xB9, 0x00, 0x00, 0x01, 0xC0]);
    // @0x60: 4E FD 00 00 01 C0  (jmp    $1c0)
    v[0x60..0x66].copy_from_slice(&[0x4E, 0xFD, 0x00, 0x00, 0x01, 0xC0]);
    // @0x80: 22 7C 00 00 01 C0  (movea.l #$1c0,a1) — mesmo operando, outra codificación
    v[0x80..0x86].copy_from_slice(&[0x22, 0x7C, 0x00, 0x00, 0x01, 0xC0]);
    // @0xC0: táboa de catro longwords crecentes, todas in-range (< 0x200)
    for (i, val) in [0x100u32, 0x140, 0x180, 0x1C0].iter().enumerate() {
        v[0xC0 + i * 4..0xC4 + i * 4].copy_from_slice(&val.to_be_bytes());
    }
    v
}

#[test]
fn call_sites_recoece_jsr_e_jmp_absolutos_e_rexeita_outros_operandos() {
    let img = imaxe_con_codigo();
    let sitios = call_sites(&img, 0, img.len(), 64);
    let offsets: Vec<usize> = sitios.iter().map(|s| s.offset).collect();
    assert_eq!(offsets, vec![0x40, 0x60], "sitios: {sitios:?}");
    assert!(sitios.iter().all(|s| s.target == 0x1C0));
    assert!(
        !offsets.contains(&0x80),
        "o movea.l non é un sitio de chamada"
    );
}

#[test]
fn call_sites_acoutase_na_xanela_pedida() {
    let img = imaxe_con_codigo();
    let sitios = call_sites(&img, 0x50, 0x70, 64);
    assert_eq!(sitios.len(), 1);
    assert_eq!(sitios[0].offset, 0x60);
}

#[test]
fn references_to_atopa_o_operando_incluso_dentro_dunha_táboa_e_non_distingue_o_mecanismo() {
    let img = imaxe_con_codigo();
    let r = references_to(&img, 0x1C0, 64);
    // Os catro bytes do operando aparecen no jsr, no jmp, no movea e na táboa.
    let offsets: Vec<usize> = r.iter().map(|s| s.offset).collect();
    assert_eq!(offsets, vec![0x42, 0x62, 0x82, 0xCC]);
}

#[test]
fn references_to_non_inventa_unha_referencia_inexistente() {
    let img = imaxe_con_codigo();
    assert!(references_to(&img, 0x0001_0203, 64).is_empty());
}

#[test]
fn tables_for_topa_a_táboa_ascendente_que_contén_un_valor_busado() {
    let img = imaxe_con_codigo();
    let t = tables_for(&img, &[0x1C0u32], 4, 8);
    assert_eq!(t.len(), 1, "táboas: {t:?}");
    assert_eq!(t[0].base_offset, 0xC0);
    assert_eq!(t[0].entries, 4);
    assert_eq!(t[0].values, vec![0x100, 0x140, 0x180, 0x1C0]);
    assert!(t[0].ascending);
}

#[test]
fn tables_for_rexeita_unha_secuencia_de_menos_da_longitude_minima() {
    let img = imaxe_con_codigo();
    let t = tables_for(&img, &[0x1C0u32], 5, 8);
    assert!(t.is_empty(), "aceitou unha táboa de catro: {t:?}");
}

#[test]
fn tables_for_non_considera_táboa_unha_secuencia_descendente_in_range() {
    let mut v = vec![0u8; 0x100];
    for (i, val) in [0xC0u32, 0x80, 0x40].iter().enumerate() {
        v[i * 4..(i + 1) * 4].copy_from_slice(&val.to_be_bytes());
    }
    let t = tables_for(&v, &[0xC0u32], 3, 8);
    assert!(t.is_empty(), "aceitou descending: {t:?}");
}

#[test]
fn tables_for_rexeita_valores_fóra_da_imaxe_anque_crecentes() {
    // Crecentes pero apuntan a 0x100000, que non existe nesta ROM de 0x100 bytes:
    // serían offsets transplantados, non medidos nesta imaxe.
    let mut v = vec![0u8; 0x100];
    for (i, val) in [0x10_0000u32, 0x10_0004, 0x10_0008].iter().enumerate() {
        v[i * 4..(i + 1) * 4].copy_from_slice(&val.to_be_bytes());
    }
    let t = tables_for(&v, &[0x10_0004u32], 3, 8);
    assert!(t.is_empty(), "aceitou offsets fóra da ROM: {t:?}");
}

// ---------- rexistro de recurso ----------

fn rexistro() -> ResourceRecord {
    ResourceRecord {
        rom_sha256: "aa".repeat(32),
        normalized_sha256: "bb".repeat(32),
        profile_id: "md-linear/v1".into(),
        offset: Some(0x12C40),
        input_span: Some(0x40),
        codec: "kosinski".into(),
        variant: "base".into(),
        bytes_consumed: Some(0x31),
        output_size: Some(0x800),
        output_sha256: Some("cc".repeat(32)),
        consumer_evidence: vec!["taboa@0x000C0/3/crecente".into()],
        confidence: Confidence::ConfirmadoEstaticamente,
        limitations: vec!["sen execución".into()],
        mapper_profile: Some("md-linear".into()),
        mapper_state: None,
    }
}

#[test]
fn rexistro_versiona_o_esquema_a_confianza_e_o_offset_medido() {
    let j = render(&rexistro().to_json());
    assert!(
        j.contains("\"schema_version\":\"rex-corpus-resource/v1\""),
        "{j}"
    );
    assert!(
        j.contains("\"confianza\":\"confirmado-estaticamente\""),
        "{j}"
    );
    assert!(j.contains("\"offset\":76864"), "{j}");
    assert!(
        j.contains("\"evidencia_consumidor\":[\"taboa@0x000C0/3/crecente\"]"),
        "{j}"
    );
    // A mostra desta crate tamén ten que cumprir o contrato de evidencia: un
    // rexistro que non pasa `validar()` non é un exemplo, é una falsa.
    rexistro().validar().expect("fixture fóra do contrato");
}

#[test]
fn rexistro_seralliza_o_non_medido_con_sentinela_non_cun_estimado() {
    let r = ResourceRecord {
        mapper_state: None,
        bytes_consumed: None,
        output_sha256: None,
        ..rexistro()
    };
    let j = render(&r.to_json());
    assert!(j.contains("\"estado_mapper\":\"not_measured\""), "{j}");
    assert!(j.contains("\"bytes_consumidos\":\"not_measured\""), "{j}");
    assert!(j.contains("\"saida_sha256\":\"not_measured\""), "{j}");
}

#[test]
fn rexistro_candidato_sin_evidencia_de_consumidor_non_se_presenta_como_confirmado() {
    let r = ResourceRecord {
        confidence: Confidence::Candidato,
        consumer_evidence: vec![],
        ..rexistro()
    };
    let j = render(&r.to_json());
    assert!(j.contains("\"confianza\":\"candidato\""), "{j}");
    assert!(j.contains("\"evidencia_consumidor\":[]"), "{j}");
}

// ---------------------------------------------------------------------------
// Fase 4 — carga de argumento absoluto longo (`lea abs.l,An`).
//
// A regra que se prova aquí nace dunha medida, non dunha suposición: na ROM
// reservada, 6 dos 383 `lea abs.l` teñen por operando un candidato do sondeo,
// os 6 caen no rexistro A0 e os 6 van seguidos de `jsr abs.l` ao mesmo destino
// (0x85A2). `call_sites` non detecta ningún deles porque a chamada apunta á
// rutina, non ao stream.
// ---------------------------------------------------------------------------

/// Imaxe de 64 bytes chea de ceros coa secuencia medida colocada en `de`.
fn imaxe_con(de: usize, bytes: &[u8]) -> Vec<u8> {
    let mut v = vec![0u8; 64];
    v[de..de + bytes.len()].copy_from_slice(bytes);
    v
}

#[test]
fn carga_abs_l_a0_devolve_operando_rexistro_e_offset() {
    // `41 F9 00 07 95 A2` = lea $795A2.l,A0 (medido en 0x10636 da ROM).
    let im = imaxe_con(8, &[0x41, 0xF9, 0x00, 0x07, 0x95, 0xA2]);
    let got = rex_corpus::consumer::cargas_abs_l(&im, 0, im.len(), 8);
    assert_eq!(got.len(), 1, "{got:?}");
    assert_eq!(got[0].offset, 8);
    assert_eq!(got[0].registro, 0);
    assert_eq!(got[0].operando, 0x795A2);
}

#[test]
fn carga_abs_l_cobre_os_oito_rexistros_coa_codificación_derivada_de_4eb9() {
    // O campo rexistro vale 0x200 por cada An: a A0 é 41F9 e a A7 é 4FF9.
    // Derivación: lea abs.l = 0100 ddd 111 111 001, co mesmo 111/001 (absL)
    // que confirma `4E B9` (jsr abs.l); ddd desprázase 9 bits acima.
    for n in 0..8u8 {
        let im = imaxe_con(4, &[0x41 + 2 * n, 0xF9, 0x00, 0x11, 0x22, 0x33]);
        let got = rex_corpus::consumer::cargas_abs_l(&im, 0, im.len(), 8);
        assert_eq!(
            got.len(),
            1,
            "A{n} non se reconoce ({:02X}F9)",
            0x41 + 2 * n
        );
        assert_eq!(got[0].registro, n, "A{n} etiketou outro rexistro");
        assert_eq!(got[0].operando, 0x0011_2233);
    }
}

#[test]
fn carga_abs_l_rexeita_palabras_que_non_son_carga_absoluta_longa() {
    // Control non vacuo tomado da ROM Rocket Knight: alí o word que precede os
    // bytes dun candidato é `31 FC` (móvese unha constante a (A0)) e `08 F8`.
    // Contalos como punteiros sería inferir estrutura polo aspecto dos datos.
    for (etiqueta, par) in [
        ("31FC", [0x31u8, 0xFC]),
        ("08F8", [0x08, 0xF8]),
        ("4EB9", [0x4E, 0xB9]), // chamada, non carga
        ("4EF9", [0x4E, 0xF9]),
        ("41F8", [0x41, 0xF8]), // recheo de datos, non carga
    ] {
        let im = imaxe_con(6, &[par[0], par[1], 0x00, 0x00, 0x10, 0x00]);
        let got = rex_corpus::consumer::cargas_abs_l(&im, 0, im.len(), 8);
        assert!(
            got.is_empty(),
            "{etiqueta} non é lea abs.l pero devolveu {got:?}"
        );
    }
}

#[test]
fn carga_abs_l_ignora_desprazamentos_impares() {
    // Mesma instrucción desprazada un byte: o opcode caería en desprazamento
    // impar, que en 68k non é código.
    let im = imaxe_con(9, &[0x41, 0xF9, 0x00, 0x00, 0x10, 0x00]);
    let got = rex_corpus::consumer::cargas_abs_l(&im, 0, im.len(), 8);
    assert!(got.is_empty(), "desprazamento impar non é código: {got:?}");
}

#[test]
fn carga_abs_l_respeta_a_xanela_e_o_tope() {
    let mut im = vec![0u8; 64];
    for de in [4usize, 20, 36] {
        im[de..de + 6].copy_from_slice(&[0x41, 0xF9, 0x00, 0x00, 0x10, 0x00]);
    }
    let ata_24 = rex_corpus::consumer::cargas_abs_l(&im, 0, 24, 8);
    assert_eq!(ata_24.len(), 1, "xanela 0..24: {ata_24:?}");
    let tope_2 = rex_corpus::consumer::cargas_abs_l(&im, 0, im.len(), 2);
    assert_eq!(tope_2.len(), 2, "tope 2: {tope_2:?}");
    // Non pode desbordar: a última carga empeza en 36 e necesita ata 42.
    let curto = rex_corpus::consumer::cargas_abs_l(&im, 0, 40, 8);
    assert_eq!(curto.len(), 2, "carga incompleta fóra da xanela: {curto:?}");
}
