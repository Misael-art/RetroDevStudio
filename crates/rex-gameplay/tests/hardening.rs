//! Endurecimento do perfil (PR #84, 2a rodada):
//! proveniencia da regeneracao, localizacao ambigua/nula/quase-caso e auditoria
//! da chamada opaca. Fixture de ajuste: `goal_original_t6`.

use std::collections::{BTreeMap, BTreeSet};

use rex_gameplay::emit::{emit_region, with_threshold, Emitted};
use rex_gameplay::graph::{edit_threshold, open_graph, Hints};
use rex_gameplay::lift::GateRule;
use rex_gameplay::m68k::Insn;
use rex_gameplay::patch::{patch_threshold, regenerate_from_graph, regeneration_plan};
use rex_gameplay::sha256::sha256_hex;
use rex_gameplay::{locate, locate_unique, recover, Recovery};

fn image(name: &str) -> Vec<u8> {
    let path = format!("{}/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    let text = std::fs::read_to_string(path).expect("fixture");
    let mut image = Vec::new();
    for line in text.lines().filter(|l| !l.starts_with('#')) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        match parts[0] {
            "rom_size" => image = vec![0u8; parts[1].parse().unwrap()],
            "at" => {
                let at = usize::from_str_radix(parts[1].trim_start_matches("0x"), 16).unwrap();
                for i in (0..parts[2].len()).step_by(2) {
                    image[at + i / 2] = u8::from_str_radix(&parts[2][i..i + 2], 16).unwrap();
                }
            }
            _ => {}
        }
    }
    image
}

fn original() -> (Vec<u8>, Recovery) {
    let rom = image("goal_original_t6.hex");
    let rec = recover(&rom, 0x946, &[0x970], &Hints::default()).expect("recover");
    (rom, rec)
}

fn layout(rec: &Recovery) -> BTreeMap<u32, Insn> {
    rec.region
        .insns
        .iter()
        .map(|(at, d)| (*at, d.insn.clone()))
        .collect()
}

// ---------------------------------------------------------------- item 1

#[test]
fn regeneration_emits_every_region_byte_from_semantics() {
    let (rom, rec) = original();
    let opened = open_graph(&rec.graph_json).unwrap();
    let plan = regeneration_plan(&opened).unwrap();
    // Cobertura: cada byte das instrucoes mapeadas sai de exatamente uma emissao.
    let mut covered = BTreeSet::new();
    for e in &plan {
        assert!(
            !e.fields.is_empty(),
            "instrucao sem origem em 0x{:06X}",
            e.offset
        );
        for i in 0..e.bytes.len() {
            assert!(
                covered.insert(e.offset as usize + i),
                "byte emitido duas vezes"
            );
        }
    }
    let mapped: BTreeSet<usize> = opened
        .recorded_bytes
        .iter()
        .flat_map(|(s, b)| (*s as usize)..(*s as usize + b.len()))
        .collect();
    assert_eq!(covered, mapped);
    // Toda instrucao, exceto a limpeza fixa da pilha, depende de ao menos um campo semantico.
    for e in &plan {
        let semantic = e.fields.iter().any(|(_, src)| src.starts_with("semantic:"));
        assert!(
            semantic || matches!(e.insn, Insn::AddqLSp { q: 8 }),
            "0x{:06X} sem campo semantico",
            e.offset
        );
    }
    // Sem edicao, a emissao reproduz a regiao da ROM; fora dela nada muda.
    let sha = sha256_hex(&rom);
    let regen = regenerate_from_graph(&rom, &sha, &opened).unwrap();
    assert_eq!(regen.bytes, rom);
    assert_eq!(regen.method, "regenerate_region_from_semantics");
}

fn changed_offsets(a: &[Emitted], b: &[Emitted]) -> BTreeSet<u32> {
    a.iter()
        .zip(b)
        .inspect(|(x, y)| assert_eq!(x.offset, y.offset))
        .filter(|(x, y)| x.bytes != y.bytes)
        .map(|(x, _)| x.offset)
        .collect()
}

fn declared(plan: &[Emitted], source: &str, node: Option<&str>) -> BTreeSet<u32> {
    plan.iter()
        .filter(|e| node.map_or(true, |n| e.node == n))
        .filter(|e| e.fields.iter().any(|(_, s)| *s == source))
        .map(|e| e.offset)
        .collect()
}

/// Cada campo semantico perturbado muda exatamente as instrucoes que declaram
/// depender dele: a emissao e funcao da semantica, nao copia de bytes.
#[test]
fn each_semantic_field_drives_exactly_its_declared_instructions() {
    let (_, rec) = original();
    let lay = layout(&rec);
    let base = emit_region(&rec.rule, &lay).unwrap();
    type Mutation = (&'static str, Option<&'static str>, fn(&mut GateRule));
    let cases: [Mutation; 8] = [
        ("semantic:input_guard.bit", None, |r| {
            r.guard.as_mut().unwrap().bit = 4
        }),
        ("semantic:counter_add.step", None, |r| {
            r.counter_add.as_mut().unwrap().step = 2
        }),
        ("semantic:counter.address", None, |r| {
            r.counter_add.as_mut().unwrap().addr = 0xE0FF_0100;
            r.compare.counter_addr = 0xE0FF_0100;
        }),
        ("semantic:compare.threshold", None, |r| {
            *r = with_threshold(r, 9)
        }),
        ("semantic:state_write.value", Some("state_write_set"), |r| {
            r.set.value = 2
        }),
        ("semantic:state_write.address", None, |r| {
            r.set.state_addr = 0xE0FF_0200;
            r.other.state_addr = 0xE0FF_0200;
        }),
        ("semantic:external_call.target", None, |r| {
            r.set.call.as_mut().unwrap().target = 0xB200
        }),
        ("semantic:external_call.immediate_arg", None, |r| {
            r.set.call.as_mut().unwrap().immediate_arg = 2
        }),
    ];
    for (source, node, mutate) in cases {
        let mut rule = rec.rule.clone();
        mutate(&mut rule);
        let emitted = emit_region(&rule, &lay).unwrap();
        let changed = changed_offsets(&base, &emitted);
        assert!(!changed.is_empty(), "{source}: nada mudou");
        assert_eq!(changed, declared(&base, source, node), "{source}");
    }
}

#[test]
fn regeneration_refuses_when_semantics_do_not_reproduce_the_mapping() {
    // O limiar editado fora do MOVEQ e recusado tanto na edicao quanto na emissao.
    let (_, rec) = original();
    assert!(edit_threshold(&rec.graph_json, 200).is_err());
    let lay = layout(&rec);
    assert!(emit_region(&with_threshold(&rec.rule, 200), &lay).is_err());
    // Layout que nao e desvio onde a regra espera desvio: recusa.
    let mut broken = lay.clone();
    broken.insert(0x964, Insn::Moveq { imm: 0, d: 0 });
    assert!(emit_region(&rec.rule, &broken).is_err());
}

// ---------------------------------------------------------------- item 3

#[test]
fn two_compatible_routines_are_listed_and_unique_location_refuses() {
    let (rom, _) = original();
    let mut two = rom.clone();
    let shift = 0x2_0000usize;
    for (s, e) in [(0x946usize, 0x970usize), (0xCAE, 0xCCC)] {
        let copy = rom[s..e].to_vec();
        two[s + shift..e + shift].copy_from_slice(&copy);
    }
    let found = locate(&two);
    let entries: Vec<u32> = found.candidates.iter().map(|c| c.entry).collect();
    assert_eq!(entries, vec![0x946, 0x946 + shift as u32]);
    let err = locate_unique(&two).unwrap_err();
    assert!(
        err.contains("ambigua") && err.contains("0x000946") && err.contains("0x020946"),
        "{err}"
    );
}

#[test]
fn no_compatible_routine_is_refused() {
    let err = locate_unique(&vec![0u8; 0x4000]).unwrap_err();
    assert!(err.contains("nenhuma regra"), "{err}");
}

#[test]
fn similar_pattern_with_different_semantics_is_rejected_with_reason() {
    let (rom, _) = original();
    // (a) comparacao sem sinal: BLT.W -> BCS.W em 0x964.
    let mut unsigned = rom.clone();
    assert_eq!(unsigned[0x964], 0x6D);
    unsigned[0x964] = 0x65;
    // (b) os dois ramos escrevem 1: MOVEQ #0,D0 -> MOVEQ #1,D0 em 0x968.
    let mut same_value = rom.clone();
    assert_eq!(same_value[0x968..0x96A], [0x70, 0x00]);
    same_value[0x969] = 0x01;
    // (c) ramos escrevem enderecos de estado diferentes.
    let mut split_state = rom.clone();
    assert_eq!(split_state[0x96F], 0x62);
    split_state[0x96F] = 0x66;
    for (label, variant) in [
        ("sem sinal", unsigned),
        ("mesmo valor", same_value),
        ("estado dividido", split_state),
    ] {
        let found = locate(&variant);
        assert!(found.candidates.is_empty(), "{label}: aceito indevidamente");
        assert_eq!(
            found.rejected.len(),
            1,
            "{label}: quase-caso deve ser reportado"
        );
        assert_eq!(found.rejected[0].0, 0x946);
        println!("{label}: {}", found.rejected[0].1);
        assert!(locate_unique(&variant).is_err());
    }
}

// ---------------------------------------------------------------- item 4

#[test]
fn opaque_call_is_preserved_by_patch_and_not_attributed_to_the_rule() {
    let (rom, rec) = original();
    let call = rec.rule.set.call.clone().expect("chamada no bloco set");
    assert_eq!(call.target, 0xB10C);
    assert_eq!(call.at, vec![0xCB6, 0xCBA, 0xCC0, 0xCC6]);
    let call_bytes = rom[0xCB6..0xCC8].to_vec();
    let sha = sha256_hex(&rom);
    let opened = open_graph(&edit_threshold(&rec.graph_json, 12).unwrap()).unwrap();
    for rebuilt in [
        patch_threshold(&rom, &sha, &opened).unwrap(),
        regenerate_from_graph(&rom, &sha, &opened).unwrap(),
    ] {
        assert_eq!(
            rebuilt.bytes[0xCB6..0xCC8],
            call_bytes[..],
            "{}",
            rebuilt.method
        );
        assert_eq!(rebuilt.changed, vec![0x961], "{}", rebuilt.method);
        // O corpo do callee (fora da regiao) e identico ao da base.
        assert_eq!(rebuilt.bytes[0xB10C..0xB200], rom[0xB10C..0xB200]);
    }
    // O no do grafo declara a chamada como nao compreendida.
    assert!(rec.graph_json.contains("\"understood\": false"));
    // A regra so atribui a si as escritas de contador/estado; a chamada e um evento.
    let effect = rex_gameplay::lift::evaluate(&rec.rule, 6, 0x08, 5, 0);
    assert_eq!(effect.counter_write, Some(6));
    assert_eq!(effect.state_write, Some((0xE0FF_0062, 1)));
    assert_eq!(effect.call, Some((0xB10C, 1, 0)));
}

// ---------------------------------------------------------------- revisao (rodada 3)

/// `open_graph` valida so a consistencia INTERNA do grafo. Uma falsificacao coerente
/// (mapping + parametro alterados juntos) reabre; o vinculo com a ROM so e cobrado
/// na reconstrucao (SHA e bytes da base). Por isso a reabertura no produto deve
/// passar pela verificacao contra a base, nao so por `open_graph`.
#[test]
fn consistent_forgery_reopens_but_is_refused_against_the_base() {
    let (rom, rec) = original();
    let mut forged = rec.graph_json.clone();
    for (from, to) in [
        ("\"value\": 1,", "\"value\": 2,"),
        ("\"bytes\": \"7601\"", "\"bytes\": \"7602\""),
        (
            "\"mnemonic\": \"MOVEQ #1,D3\"",
            "\"mnemonic\": \"MOVEQ #2,D3\"",
        ),
    ] {
        assert_eq!(forged.matches(from).count(), 1, "{from}");
        forged = forged.replacen(from, to, 1);
    }
    let imm = forged.find("\"bytes\": \"7602\"").unwrap();
    let at = imm + forged[imm..].find("\"imm\": 1").unwrap();
    forged.replace_range(at..at + "\"imm\": 1".len(), "\"imm\": 2");
    let opened = open_graph(&forged).expect("falsificacao coerente reabre");
    assert_eq!(opened.rule.set.value, 2);
    let sha = sha256_hex(&rom);
    for err in [
        patch_threshold(&rom, &sha, &opened).unwrap_err(),
        regenerate_from_graph(&rom, &sha, &opened).unwrap_err(),
    ] {
        assert!(
            err.contains("0x000CAE") && err.contains("recusado"),
            "{err}"
        );
    }
}
