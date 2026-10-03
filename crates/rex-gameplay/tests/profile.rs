//! Testes do perfil sobre trechos das ROMs autorais do `reference_platformer`.
//!
//! `goal_original_t6` e o conjunto de ajuste. `two_passages` (regras 1 e 2) e
//! `goal_edited_t12` sao variantes retidas: endereco de RAM, offsets, limiar,
//! polaridade do desvio e forma das saidas diferem.

use std::collections::BTreeMap;

use rex_gameplay::graph::{edit_threshold, open_graph, Hints};
use rex_gameplay::json::Json;
use rex_gameplay::lift::{evaluate, Operator, RuleEffect};
use rex_gameplay::m68k::{Ccr, Event, Machine};
use rex_gameplay::patch::{patch_threshold, regenerate_from_graph};
use rex_gameplay::sha256::sha256_hex;
use rex_gameplay::{execute_region, recover, Recovery};

struct Excerpt {
    full_sha256: String,
    image: Vec<u8>,
}

fn excerpt(name: &str) -> Excerpt {
    let path = format!("{}/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    let text = std::fs::read_to_string(&path).expect("fixture");
    let mut sha = String::new();
    let mut image = Vec::new();
    for line in text.lines().filter(|l| !l.starts_with('#')) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        match parts[0] {
            "rom_sha256" => sha = parts[1].to_string(),
            "rom_size" => image = vec![0u8; parts[1].parse().unwrap()],
            "at" => {
                let at = usize::from_str_radix(parts[1].trim_start_matches("0x"), 16).unwrap();
                let bytes: Vec<u8> = (0..parts[2].len())
                    .step_by(2)
                    .map(|i| u8::from_str_radix(&parts[2][i..i + 2], 16).unwrap())
                    .collect();
                image[at..at + bytes.len()].copy_from_slice(&bytes);
            }
            other => panic!("linha desconhecida {other}"),
        }
    }
    Excerpt {
        full_sha256: sha,
        image,
    }
}

fn recover_at(image: &[u8], entry: u32, exits: &[u32]) -> Recovery {
    recover(image, entry, exits, &Hints::default()).expect("recover")
}

/// Executa a regiao pela IR de instrucoes e converte os eventos no mesmo
/// formato do avaliador semantico.
fn run_insns(rec: &Recovery, input: u32, counter: u32, pointer: u32) -> (u32, RuleEffect) {
    let rule = &rec.rule;
    let mut mem = BTreeMap::new();
    mem.insert(rule.compare.counter_addr, counter);
    for call in [&rule.set.call, &rule.other.call].into_iter().flatten() {
        mem.insert(call.pointer_arg_addr, pointer);
    }
    let mut regs = [0x1111_1111u32; 8];
    if let Some(guard) = &rule.guard {
        regs[guard.reg as usize] = input;
    }
    let machine = Machine::new(regs, Ccr::default(), mem);
    let (exit, end) = execute_region(&rec.region, machine).expect("exec");
    let mut effect = RuleEffect {
        counter_write: None,
        state_write: None,
        call: None,
    };
    for event in &end.events {
        match event {
            Event::Write { addr, value, .. } if *addr == rule.compare.counter_addr => {
                effect.counter_write = Some(*value)
            }
            Event::Write { addr, value, .. } => {
                assert!(effect.state_write.is_none(), "duas escritas de estado");
                effect.state_write = Some((*addr, *value));
            }
            Event::Call { target, args, .. } => {
                assert_eq!(args.len(), 2);
                effect.call = Some((*target, args[1].unwrap() as i32 as i16, args[0].unwrap()));
            }
        }
    }
    (exit, effect)
}

const COUNTERS: [u32; 14] = [
    0,
    1,
    4,
    5,
    6,
    7,
    10,
    11,
    12,
    58,
    59,
    60,
    0x7FFF_FFFF,
    0x8000_0000,
];
const MORE_COUNTERS: [u32; 3] = [0xFFFF_FFFF, 0xFFFF_FFFE, 0x0001_0005];
const INPUTS: [u32; 4] = [0, 0x08, 0xFFFF, 0xFFF7];

fn cross_check(rec: &Recovery) -> usize {
    let threshold = rec.rule.compare.threshold;
    let mut n = 0;
    for counter in COUNTERS.iter().chain(MORE_COUNTERS.iter()) {
        for input in INPUTS {
            let (_, by_insn) = run_insns(rec, input, *counter, 0x00FF_1234);
            let by_rule = evaluate(&rec.rule, threshold, input, *counter, 0x00FF_1234);
            assert_eq!(by_insn, by_rule, "counter={counter:#x} input={input:#x}");
            n += 1;
        }
    }
    n
}

#[test]
fn training_rule_is_recovered_with_state_decision_and_mapping() {
    let ex = excerpt("goal_original_t6.hex");
    let rec = recover_at(&ex.image, 0x946, &[0x970]);
    let rule = &rec.rule;
    let guard = rule.guard.as_ref().expect("guard");
    assert_eq!((guard.reg, guard.bit, guard.skip_exit), (0, 3, 0x970));
    let add = rule.counter_add.as_ref().expect("counter add");
    assert_eq!((add.addr, add.step), (0xE0FF_0054, 1));
    assert_eq!(rule.compare.operator, Operator::Ge);
    assert_eq!(rule.compare.threshold, 6);
    assert_eq!(rule.compare.k_at, 0x960);
    assert!(rule.compare.set_is_taken);
    assert_eq!((rule.set.state_addr, rule.set.value), (0xE0FF_0062, 1));
    assert_eq!((rule.other.state_addr, rule.other.value), (0xE0FF_0062, 0));
    let call = rule.set.call.as_ref().expect("call");
    assert_eq!(
        (call.target, call.pointer_arg_addr, call.immediate_arg),
        (0xB10C, 0xE0FF_007A, 1)
    );
    assert!(rule.other.call.is_none());
    assert_eq!(rec.region.blocks, vec![(0x946, 0x970), (0xCAE, 0xCCC)]);
    assert!(rec.graph_json.contains("\"understood\": false"));
    assert!(cross_check(&rec) > 60);
}

#[test]
fn retained_variant_rule1_other_addresses_and_threshold() {
    let ex = excerpt("two_passages.hex");
    let rec = recover_at(&ex.image, 0xA4C, &[0xA76]);
    assert_eq!(rec.rule.counter_add.as_ref().unwrap().addr, 0xE0FF_0058);
    assert_eq!(rec.rule.compare.threshold, 12);
    assert_eq!(rec.rule.set.state_addr, 0xE0FF_006A);
    assert_eq!(rec.rule.set.call.as_ref().unwrap().target, 0xB55C);
    cross_check(&rec);
}

#[test]
fn retained_variant_rule2_inverted_polarity_and_distinct_exits() {
    let ex = excerpt("two_passages.hex");
    let rec = recover_at(&ex.image, 0xAA0, &[0xAC8, 0xC7A]);
    let rule = &rec.rule;
    assert!(rule.guard.is_none() && rule.counter_add.is_none());
    assert_eq!(rule.compare.counter_addr, 0xE0FF_0058);
    assert_eq!(
        (rule.compare.operator, rule.compare.threshold),
        (Operator::Ge, 60)
    );
    assert!(
        !rule.compare.set_is_taken,
        "o bloco set e o fall-through (BGE vai para o ramo 0)"
    );
    assert_eq!((rule.set.exit, rule.other.exit), (0xAC8, 0xC7A));
    cross_check(&rec);
}

#[test]
fn original_original_and_noop_controls() {
    let ex = excerpt("goal_original_t6.hex");
    let a = recover_at(&ex.image, 0x946, &[0x970]);
    let b = recover_at(&ex.image, 0x946, &[0x970]);
    assert_eq!(a.graph_json, b.graph_json);
    for counter in COUNTERS {
        assert_eq!(run_insns(&a, 8, counter, 7), run_insns(&b, 8, counter, 7));
    }
    let opened = open_graph(&a.graph_json).unwrap();
    let sha = sha256_hex(&ex.image);
    let noop_regen = regenerate_from_graph(&ex.image, &sha, &opened).unwrap();
    let noop_patch = patch_threshold(&ex.image, &sha, &opened).unwrap();
    assert_eq!(
        noop_regen.bytes, ex.image,
        "grafo sem edicao regenera a mesma ROM"
    );
    assert_eq!(noop_patch.bytes, ex.image);
    assert!(noop_regen.changed.is_empty());
}

#[test]
fn edit_matches_the_independent_compiler_rebuild_in_the_region() {
    let original = excerpt("goal_original_t6.hex");
    let edited_by_sgdk = excerpt("goal_edited_t12.hex");
    let rec = recover_at(&original.image, 0x946, &[0x970]);
    let sha = sha256_hex(&original.image);
    let graph = edit_threshold(&rec.graph_json, 12).unwrap();
    let opened = open_graph(&graph).unwrap();
    assert_eq!(opened.threshold, 12);
    let patched = patch_threshold(&original.image, &sha, &opened).unwrap();
    let regenerated = regenerate_from_graph(&original.image, &sha, &opened).unwrap();
    assert_eq!(patched.method, "patch_moveq_immediate");
    assert_eq!(regenerated.method, "regenerate_region_from_graph");
    assert_eq!(
        patched.bytes, regenerated.bytes,
        "os dois caminhos devem coincidir (verificado, nao assumido)"
    );
    assert_eq!(patched.changed, vec![0x961]);
    // Trechos: iguais aos do build SGDK com limiar 12 (o checksum do trecho nao e valido,
    // entao nao e reescrito aqui; a comparacao da ROM completa fica no teste ignorado).
    for at in (0x940..0x980).chain(0xCA0..0xCD0) {
        assert_eq!(patched.bytes[at], edited_by_sgdk.image[at], "0x{at:X}");
    }
    let re = recover_at(&patched.bytes, 0x946, &[0x970]);
    assert_eq!(re.rule.compare.threshold, 12);
    let before = evaluate(&rec.rule, 6, 8, 6, 0);
    let after = evaluate(&re.rule, 12, 8, 6, 0);
    assert_eq!(before.state_write, Some((0xE0FF_0062, 1)));
    assert_eq!(after.state_write, Some((0xE0FF_0062, 0)));
}

#[test]
fn save_reopen_preserves_operation_parameter_connections_and_mapping() {
    let ex = excerpt("two_passages.hex");
    let rec = recover_at(&ex.image, 0xAA0, &[0xAC8, 0xC7A]);
    let saved = edit_threshold(&rec.graph_json, 45).unwrap();
    let reopened = open_graph(&saved).unwrap();
    assert_eq!(reopened.threshold, 45);
    assert_eq!(reopened.rule, rec.rule);
    assert_eq!(reopened.region, rec.region);
    let graph = Json::parse(&saved).unwrap();
    let edges = graph.field("edges").unwrap().as_arr().unwrap();
    assert!(edges
        .iter()
        .any(|e| e.str_at("fromNode").unwrap() == "compare"
            && e.str_at("fromPort").unwrap() == "true"
            && e.str_at("toNode").unwrap() == "set_write"));
    // Rotulo do usuario e livre e nao altera semantica.
    let relabeled = saved.replacen("\"Counter threshold\"", "\"Pontos para abrir passagem\"", 1);
    assert_eq!(open_graph(&relabeled).unwrap().rule, rec.rule);
}

#[test]
fn tampered_graphs_are_refused() {
    let ex = excerpt("goal_original_t6.hex");
    let rec = recover_at(&ex.image, 0x946, &[0x970]);
    let g = &rec.graph_json;
    let cases = [
        g.replacen("\"operator\": \">=\"", "\"operator\": \"<\"", 1),
        g.replacen(
            "\"fromPort\": \"true\",\n      \"toNode\": \"set_write\"",
            "\"fromPort\": \"true\",\n      \"toNode\": \"other_write\"",
            1,
        ),
        g.replacen("\"bytes\": \"7405\"", "\"bytes\": \"7406\"", 1),
        g.replacen("\"step\": 1", "\"step\": 2", 1),
        g.replacen("\"threshold\": 6", "\"threshold\": 200", 1),
        g.replacen(
            "\"semantic_origin\": \"recovered_from_rom\"",
            "\"semantic_origin\": \"user\"",
            1,
        ),
    ];
    for (i, tampered) in cases.iter().enumerate() {
        assert_ne!(tampered, g, "caso {i} nao alterou o texto");
        assert!(
            open_graph(tampered).is_err(),
            "caso {i} aceito indevidamente"
        );
    }
    assert!(edit_threshold(g, 129).unwrap_err().contains("crescimento"));
    assert!(edit_threshold(g, 128).is_ok());
    assert!(edit_threshold(g, -127).is_ok());
    assert!(edit_threshold(g, -128).is_err());
}

#[test]
fn base_identity_and_out_of_contract_regions_are_refused() {
    let ex = excerpt("goal_original_t6.hex");
    let rec = recover_at(&ex.image, 0x946, &[0x970]);
    let opened = open_graph(&rec.graph_json).unwrap();
    let mut other = ex.image.clone();
    other[0x960] ^= 0; // mesma base
    other[0x1000] = 1; // byte fora da regiao: outra base
    let sha_other = sha256_hex(&other);
    assert!(patch_threshold(&other, &sha_other, &opened)
        .unwrap_err()
        .contains("recuperado de"));
    assert!(patch_threshold(&ex.image, &sha_other, &opened)
        .unwrap_err()
        .contains("diverge"));
    // Entrada antes da regiao inclui JSR (A2) — fora do subconjunto.
    assert!(recover(&ex.image, 0x940, &[0x970], &Hints::default())
        .unwrap_err()
        .contains("fora do subconjunto"));
    // Saida nao declarada -> o caminho segue para codigo desconhecido e e recusado.
    assert!(recover(&ex.image, 0x946, &[0xCC8], &Hints::default()).is_err());
    // Saida inexistente no fluxo.
    assert!(
        recover(&ex.image, 0x946, &[0x970, 0x980], &Hints::default())
            .unwrap_err()
            .contains("nao e alcancada")
    );
    assert_ne!(
        ex.full_sha256,
        sha256_hex(&ex.image),
        "o trecho nao e a ROM completa"
    );
}

#[test]
fn recognition_does_not_depend_on_rom_hash_or_absolute_offsets() {
    let ex = excerpt("goal_original_t6.hex");
    let shift = 0x2_0000u32;
    let mut moved = vec![0u8; ex.image.len()];
    for (s, e) in [(0x946usize, 0x970usize), (0xCAE, 0xCCC)] {
        moved[s + shift as usize..e + shift as usize].copy_from_slice(&ex.image[s..e]);
    }
    let rec = recover_at(&moved, 0x946 + shift, &[0x970 + shift]);
    assert_eq!(rec.rule.compare.threshold, 6);
    assert_eq!(
        rec.region.blocks,
        vec![
            (0x946 + shift, 0x970 + shift),
            (0xCAE + shift, 0xCCC + shift)
        ]
    );
    cross_check(&rec);
}

#[test]
fn structural_scan_finds_only_the_guarded_rule() {
    let ex = excerpt("goal_original_t6.hex");
    let found = rex_gameplay::scan_guarded_candidates(&ex.image);
    assert_eq!(found.len(), 1);
    assert_eq!(
        (found[0].entry, found[0].exit, found[0].threshold),
        (0x946, 0x970, 6)
    );
    let ex = excerpt("two_passages.hex");
    let found = rex_gameplay::scan_guarded_candidates(&ex.image);
    assert_eq!(
        found.len(),
        1,
        "regra 2 nao tem guarda e nao e achada pela varredura"
    );
    assert_eq!((found[0].entry, found[0].threshold), (0xA4C, 12));
}
