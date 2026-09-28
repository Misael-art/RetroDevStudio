//! Adaptador REX — recuperacao delimitada de regra de gameplay (Experimental).
//!
//! A biblioteca `rex-gameplay` (`crates/rex-gameplay`) segue standalone. Este
//! modulo le/escreve arquivos para ela, sem nenhum comando Tauri: a exposicao
//! por IPC/UI e proposta ao integrador em
//! `docs/rex_profiles/gameplay_recovery/INTEGRATION_PROPOSAL.md`.
//!
//! Entradas declaradas: ROM, offset de entrada, offsets de saida e (opcional)
//! nomes de endereco vindos de metadados, usados so como rotulos.

use std::fs;
use std::path::Path;

use rex_gameplay::graph::{edit_threshold, open_graph, Hints};
use rex_gameplay::patch::{patch_threshold, regenerate_from_graph, Rebuilt};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct GameplayRecoveryDto {
    pub profile_id: String,
    pub rom_sha256: String,
    pub entry: u32,
    pub exits: Vec<u32>,
    pub blocks: Vec<(u32, u32)>,
    pub operator: String,
    pub threshold: i64,
    pub threshold_range: (i64, i64),
    pub graph_json: String,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GameplayRebuildDto {
    pub method: String,
    pub input_sha256: String,
    pub output_sha256: String,
    pub output_path: String,
    pub changed_offsets: Vec<usize>,
    pub authorized_ranges: Vec<(usize, usize)>,
    pub checksum_updated: bool,
}

pub fn recover_gameplay_gate(
    rom_path: &Path,
    entry: u32,
    exits: &[u32],
    hints: &Hints,
) -> Result<GameplayRecoveryDto, String> {
    let rom = fs::read(rom_path).map_err(|e| format!("falha ao ler ROM: {e}"))?;
    let recovery = rex_gameplay::recover(&rom, entry, exits, hints)?;
    Ok(GameplayRecoveryDto {
        profile_id: rex_gameplay::PROFILE_ID.to_string(),
        rom_sha256: recovery.rom_sha256,
        entry,
        exits: exits.to_vec(),
        blocks: recovery.region.blocks.clone(),
        operator: recovery.rule.compare.operator.symbol().to_string(),
        threshold: recovery.rule.compare.threshold,
        threshold_range: recovery.rule.compare.editable_range(),
        graph_json: recovery.graph_json,
        limitations: rex_gameplay::LIMITATIONS
            .iter()
            .map(|s| s.to_string())
            .collect(),
    })
}

pub fn edit_gameplay_threshold(graph_json: &str, threshold: i64) -> Result<String, String> {
    edit_threshold(graph_json, threshold)
}

/// `method`: `"patch"` (so o imediato do limiar) ou `"regenerate"` (remonta a regiao
/// a partir do grafo). A saida tem de ser um arquivo novo e distinto.
pub fn rebuild_gameplay_rom(
    base_path: &Path,
    expected_sha256: &str,
    graph_json: &str,
    output_path: &Path,
    method: &str,
) -> Result<GameplayRebuildDto, String> {
    if base_path == output_path {
        return Err("a saida deve ser distinta da base".to_string());
    }
    if output_path.exists() {
        return Err(format!(
            "saida ja existe; escolha outro caminho: {}",
            output_path.display()
        ));
    }
    let base = fs::read(base_path).map_err(|e| format!("falha ao ler base: {e}"))?;
    let opened = open_graph(graph_json)?;
    let rebuilt: Rebuilt = match method {
        "patch" => patch_threshold(&base, expected_sha256, &opened)?,
        "regenerate" => regenerate_from_graph(&base, expected_sha256, &opened)?,
        other => return Err(format!("metodo '{other}' desconhecido")),
    };
    fs::write(output_path, &rebuilt.bytes).map_err(|e| format!("falha ao gravar: {e}"))?;
    Ok(GameplayRebuildDto {
        method: rebuilt.method.to_string(),
        input_sha256: rebuilt.input_sha256,
        output_sha256: rebuilt.output_sha256,
        output_path: output_path.to_string_lossy().to_string(),
        changed_offsets: rebuilt.changed,
        authorized_ranges: rebuilt.authorized,
        checksum_updated: rebuilt.checksum_updated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use rex_gameplay::lift::evaluate;
    use serde_json::{json, Value};

    use crate::compiler::build_orch::{run_build_with_environment, BuildEnvironment};
    use crate::core::rom_mastering::sha256_hex;
    use crate::create_project_from_template;
    use crate::emulator::frame_buffer::framebuffer_to_rgba;
    use crate::emulator::libretro_ffi::{EmulatorCore, JoypadState};

    fn nonce() -> u128 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos()
    }

    #[test]
    fn adapter_refuses_overwrite_and_unknown_method() {
        let dir = std::env::temp_dir().join(format!("rex-gameplay-adapter-{}", nonce()));
        fs::create_dir_all(&dir).expect("dir");
        let base = dir.join("base.bin");
        fs::write(&base, [0u8; 16]).expect("base");
        assert!(rebuild_gameplay_rom(&base, "x", "{}", &base, "patch")
            .unwrap_err()
            .contains("distinta"));
        let out = dir.join("out.bin");
        fs::write(&out, [0u8; 1]).expect("out");
        assert!(rebuild_gameplay_rom(&base, "x", "{}", &out, "patch")
            .unwrap_err()
            .contains("ja existe"));
        assert!(recover_gameplay_gate(&base, 0, &[4], &Hints::default()).is_err());
        let _ = fs::remove_dir_all(dir);
    }

    // ------------------------------------------------------------------
    // Prova real (SGDK oficial + core Libretro oficial). Ignorada na suite
    // normal. Escreve o relatorio em target-test/validation/rex-gameplay/.
    //
    // cargo test --manifest-path src-tauri/Cargo.toml rex_gameplay_real_gate --lib -- --ignored --nocapture --test-threads=1
    // ------------------------------------------------------------------

    fn elf32_symbols(elf: &[u8]) -> HashMap<String, u32> {
        assert!(elf.len() >= 52 && &elf[0..4] == b"\x7fELF" && elf[4] == 1);
        let be = elf[5] == 2;
        let r16 = |o: usize| {
            let b = [elf[o], elf[o + 1]];
            if be {
                u16::from_be_bytes(b)
            } else {
                u16::from_le_bytes(b)
            }
        };
        let r32 = |o: usize| {
            let b = [elf[o], elf[o + 1], elf[o + 2], elf[o + 3]];
            if be {
                u32::from_be_bytes(b)
            } else {
                u32::from_le_bytes(b)
            }
        };
        let (sh_off, sh_size, sh_count) = (r32(32) as usize, r16(46) as usize, r16(48) as usize);
        let mut out = HashMap::new();
        for index in 0..sh_count {
            let section = sh_off + index * sh_size;
            if r32(section + 4) != 2 {
                continue;
            }
            let (table, size) = (r32(section + 16) as usize, r32(section + 20) as usize);
            let strtab = sh_off + r32(section + 24) as usize * sh_size;
            let strings = r32(strtab + 16) as usize;
            let mut cursor = table;
            while cursor + 16 <= table + size {
                let name = r32(cursor) as usize;
                if name > 0 {
                    let start = strings + name;
                    let len = elf[start..].iter().position(|b| *b == 0).unwrap_or(0);
                    out.insert(
                        String::from_utf8_lossy(&elf[start..start + len]).to_string(),
                        r32(cursor + 4),
                    );
                }
                cursor += 16;
            }
        }
        out
    }

    struct Built {
        rom: PathBuf,
        bytes: Vec<u8>,
        sha256: String,
        symbols: HashMap<String, u32>,
    }

    fn build_variant(base: &Path, name: &str, mutate: impl FnOnce(&mut Value)) -> Built {
        // Mesmo nome de projeto em diretorios distintos: o cabecalho da ROM (nome do jogo)
        // nao pode variar entre as variantes, so a logica.
        let dir = base.join(name);
        fs::create_dir_all(&dir).expect("variant dir");
        let created = create_project_from_template(
            "Rex Gate".to_string(),
            "megadrive".to_string(),
            dir.to_string_lossy().to_string(),
            "reference_platformer".to_string(),
            None,
        )
        .expect("create project");
        let project = PathBuf::from(&created.path);
        let graph_path = project.join("graphs/reference_platformer_logic.json");
        let mut graph: Value =
            serde_json::from_str(&fs::read_to_string(&graph_path).expect("graph")).expect("json");
        mutate(&mut graph);
        fs::write(&graph_path, serde_json::to_string_pretty(&graph).unwrap()).expect("write graph");
        let environment = BuildEnvironment::detect();
        assert!(
            environment
                .sgdk_root
                .as_ref()
                .is_some_and(|r| r.join("makefile.gen").is_file())
                && environment.sgdk_make_program.is_some(),
            "SGDK oficial nao detectado; esta prova nao aceita toolchain falso"
        );
        let build = run_build_with_environment(&project, &environment, |_| {});
        assert!(build.ok, "{name}: build falhou {:?}", build.log);
        let rom = PathBuf::from(&build.rom_path);
        let rom = if rom.is_absolute() {
            rom
        } else {
            project.join(rom)
        };
        let bytes = fs::read(&rom).expect("rom");
        let elf = fs::read(project.join("build/megadrive/out/rom.out")).expect("elf");
        Built {
            rom,
            sha256: sha256_hex(&bytes),
            bytes,
            symbols: elf32_symbols(&elf),
        }
    }

    fn set_node_param(graph: &mut Value, node: &str, key: &str, value: i64) {
        let nodes = graph["nodes"].as_array_mut().expect("nodes");
        let target = nodes
            .iter_mut()
            .find(|n| n["id"] == node)
            .unwrap_or_else(|| panic!("no {node}"));
        target["params"][key] = json!(value);
    }

    /// Variante retida deslocada: cadeia autoral extra antes de `update_score`, com
    /// variaveis `a_shift_*` (ordenadas antes de goal_open/reference_score). Desloca o
    /// codigo da rotina e os enderecos de RAM sem mudar a regra dentro do perfil.
    fn add_shift_chain(graph: &mut Value, prefix: &str) {
        let nodes = graph["nodes"].as_array_mut().expect("nodes");
        let at = nodes
            .iter()
            .position(|n| n["id"] == "update_score")
            .expect("update_score");
        let mut extra = vec![
            json!({"id": "shift_update", "type": "event_update", "label": "Shift Update", "x": 0, "y": 980, "params": {}}),
        ];
        for i in 0..6 {
            extra.push(json!({"id": format!("shift_set_{i}"), "type": "var_set", "label": format!("Shift {i}"), "x": 180 + 180 * i, "y": 980,
                "params": {"var_name": format!("{prefix}_shift_{i}"), "value": 17 + i}}));
        }
        for (k, node) in extra.into_iter().enumerate() {
            nodes.insert(at + k, node);
        }
        let edges = graph["edges"].as_array_mut().expect("edges");
        let mut from = "shift_update".to_string();
        for i in 0..6 {
            let to = format!("shift_set_{i}");
            edges.push(json!({"id": format!("shift_edge_{i}"), "fromNode": from, "fromPort": "exec", "toNode": to, "toPort": "exec"}));
            from = to;
        }
    }

    /// WRAM do core: palavras de 16 bits em ordem nativa (LE) -> big-endian 68K.
    fn read_long(emu: &EmulatorCore, addr: u32) -> u32 {
        let (data, _) = emu
            .read_memory(2, (addr & 0xFFFF) as usize, 4)
            .expect("read WRAM");
        let hi = u16::from_le_bytes([data[0], data[1]]) as u32;
        let lo = u16::from_le_bytes([data[2], data[3]]) as u32;
        (hi << 16) | lo
    }

    fn read_word(emu: &EmulatorCore, addr: u32) -> i16 {
        let (data, _) = emu
            .read_memory(2, (addr & 0xFFFF) as usize, 2)
            .expect("read WRAM");
        u16::from_le_bytes([data[0], data[1]]) as i16
    }

    fn put_long(wram: &mut [u8], addr: u32, value: u32) {
        let at = (addr & 0xFFFF) as usize;
        wram[at..at + 2].copy_from_slice(&((value >> 16) as u16).to_le_bytes());
        wram[at + 2..at + 4].copy_from_slice(&(value as u16).to_le_bytes());
    }

    /// Estado salvo e posicao da copia da WRAM dentro dele (localizada por
    /// igualdade exata com a regiao exposta pelo core; exige ocorrencia unica).
    struct Snapshot {
        state: Vec<u8>,
        wram_at: usize,
    }

    fn snapshot(emu: &EmulatorCore) -> Snapshot {
        let state = emu.capture_runtime_state_bytes().expect("state");
        let (wram, _) = emu.read_memory(2, 0, 0x10000).expect("wram");
        assert_eq!(wram.len(), 0x10000);
        let hits: Vec<usize> = state
            .windows(wram.len())
            .enumerate()
            .filter(|(_, w)| *w == wram.as_slice())
            .map(|(i, _)| i)
            .take(2)
            .collect();
        assert_eq!(hits.len(), 1, "WRAM deve aparecer uma unica vez no estado");
        Snapshot {
            state,
            wram_at: hits[0],
        }
    }

    fn restore_with(emu: &mut EmulatorCore, snap: &Snapshot, writes: &[(u32, u32)]) {
        let mut state = snap.state.clone();
        for (addr, value) in writes {
            put_long(
                &mut state[snap.wram_at..snap.wram_at + 0x10000],
                *addr,
                *value,
            );
        }
        emu.restore_runtime_state_bytes(&state).expect("restore");
        for (addr, value) in writes {
            assert_eq!(
                read_long(emu, *addr),
                *value,
                "injecao de estado nao aplicada"
            );
        }
    }

    fn boot(emu: &mut EmulatorCore, rom: &Path) {
        emu.load_rom(rom).expect("load");
        emu.set_joypad(JoypadState::default()).expect("neutral");
        for _ in 0..120 {
            emu.run_frame().expect("warmup");
        }
    }

    fn right() -> JoypadState {
        JoypadState {
            right: true,
            ..JoypadState::default()
        }
    }

    fn band_signature(emu: &EmulatorCore, x0: usize, x1: usize) -> (String, usize) {
        let (raw, size, format) = emu.get_framebuffer().expect("fb");
        let frame = framebuffer_to_rgba(&raw, size, format);
        let width = frame.width as usize;
        let mut band = Vec::new();
        for row in frame.rgba.chunks_exact(width * 4) {
            band.extend_from_slice(&row[x0 * 4..x1 * 4]);
        }
        let first = [band[0], band[1], band[2]];
        let distinct = band
            .chunks_exact(4)
            .filter(|p| [p[0], p[1], p[2]] != first)
            .count();
        (sha256_hex(&band), distinct)
    }

    #[ignore]
    #[test]
    fn rex_gameplay_real_gate_recovery_equivalence_and_effect() {
        let stamp = nonce();
        let base = std::env::temp_dir().join(format!("rex-gameplay-real-{stamp}"));
        fs::create_dir_all(&base).expect("base");
        let out = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target-test/validation/rex-gameplay")
            .join(format!("run-{stamp}"));
        fs::create_dir_all(&out).expect("out");
        let mut report = serde_json::Map::new();

        // 1. Builds autorais: ajuste (limiar 6), recompilacao SGDK com limiar 12
        //    (oraculo independente do patch) e variante cega (passo 3, limiar 37).
        let original = build_variant(&base, "gate-original", |_| {});
        let sgdk12 = build_variant(&base, "gate-sgdk-t12", |g| {
            set_node_param(g, "score_threshold", "b", 12)
        });
        let blind = build_variant(&base, "gate-blind", |g| {
            set_node_param(g, "score_add", "b", 3);
            set_node_param(g, "score_threshold", "b", 37);
        });
        // Variante retida deslocada (preparada DEPOIS do congelamento do reconhecedor,
        // ver data/rex_profiles/gameplay_recovery/evidence/2026-09-28-rodada2/FREEZE.md).
        let shifted = build_variant(&base, "gate-shifted", |g| {
            add_shift_chain(g, "a");
            set_node_param(g, "score_add", "b", 2);
            set_node_param(g, "score_threshold", "b", 20);
        });
        fs::copy(&shifted.rom, out.join("shifted-step2-t20.rom")).unwrap();
        // 2a variante deslocada (mesmo reconhecedor congelado): a 1a so deslocou codigo e
        // goal_open; o GCC alocou `a_shift_*` depois do contador. Nomes `z_shift_*`,
        // passo 4, limiar 30.
        let shifted_z = build_variant(&base, "gate-shifted-z", |g| {
            add_shift_chain(g, "z");
            set_node_param(g, "score_add", "b", 4);
            set_node_param(g, "score_threshold", "b", 30);
        });
        fs::copy(&shifted_z.rom, out.join("shifted-z-step4-t30.rom")).unwrap();
        fs::copy(&original.rom, out.join("original-t6.rom")).unwrap();
        fs::copy(&sgdk12.rom, out.join("sgdk-rebuilt-t12.rom")).unwrap();
        fs::copy(&blind.rom, out.join("blind-step3-t37.rom")).unwrap();
        report.insert(
            "builds".into(),
            json!({
                "original_t6": original.sha256,
                "sgdk_rebuilt_t12": sgdk12.sha256,
                "blind_step3_t37": blind.sha256,
                "shifted_step2_t20": shifted.sha256,
                "shifted_z_step4_t30": shifted_z.sha256,
            }),
        );

        // 2. Localizacao: varredura estrutural (sem simbolos), depois validada por simbolos.
        let score = original.symbols["logic_var_reference_score"];
        let open = original.symbols["logic_var_goal_open"];
        // O produto nunca escolhe a primeira ocorrencia: `locate_unique` recusa 0 ou >1.
        let cand = rex_gameplay::locate_unique(&original.bytes).expect("candidato unico");
        println!("candidato (original): {cand:?}");
        assert_eq!(cand.counter_addr, score, "contador validado pelo simbolo");
        let hints = Hints {
            address_names: [
                (score, "reference_score".to_string()),
                (open, "goal_open".to_string()),
            ]
            .into_iter()
            .collect(),
            origin: "elf-symbols (rotulo apenas)".to_string(),
        };
        let recovered = recover_gameplay_gate(&original.rom, cand.entry, &[cand.exit], &hints)
            .expect("recover");
        assert_eq!(
            (recovered.operator.as_str(), recovered.threshold),
            (">=", 6)
        );
        fs::write(out.join("recovered-graph.json"), &recovered.graph_json).unwrap();
        let rule =
            rex_gameplay::recover(&original.bytes, cand.entry, &[cand.exit], &Hints::default())
                .unwrap()
                .rule;
        assert_eq!(rule.set.state_addr, open, "estado validado pelo simbolo");
        // Escritores estruturais por endereco absoluto (MOVE.L/.W Dn,abs.L e CLR.L abs.L):
        // devem estar todos dentro da regiao. Escritas indiretas nao sao cobertas.
        let region =
            rex_gameplay::recover(&original.bytes, cand.entry, &[cand.exit], &Hints::default())
                .unwrap()
                .region;
        let mut writers = Vec::new();
        for addr in [score, open] {
            let needle = addr.to_be_bytes();
            for at in (0..original.bytes.len().saturating_sub(6)).step_by(2) {
                let op = u16::from_be_bytes([original.bytes[at], original.bytes[at + 1]]);
                let store = op & 0xFFF8 == 0x23C0 || op & 0xFFF8 == 0x33C0 || op == 0x42B9;
                if store && original.bytes[at + 2..at + 6] == needle {
                    writers.push((at, region.contains_byte(at as u32)));
                }
            }
        }
        println!("escritores absolutos de score/goal_open: {writers:x?}");
        assert!(
            writers.iter().all(|(_, inside)| *inside),
            "escritor fora da regiao"
        );
        report.insert(
            "absolute_writers".into(),
            json!(writers
                .iter()
                .map(|(at, inside)| json!({"at": format!("0x{at:06X}"), "inside_region": inside}))
                .collect::<Vec<_>>()),
        );
        report.insert(
            "localization".into(),
            json!({
                "method": "varredura estrutural da forma com guarda (sem simbolos); simbolos ELF so validam",
                "entry": format!("0x{:06X}", cand.entry),
                "exit": format!("0x{:06X}", cand.exit),
                "blocks": recovered.blocks,
                "counter_symbol": format!("logic_var_reference_score=0x{score:08X}"),
                "state_symbol": format!("logic_var_goal_open=0x{open:08X}"),
            }),
        );

        // 3. Variantes retidas: cega (constantes) e deslocada (codigo + RAM + constantes).
        //    Esperados vem da fonte/simbolos, so para validacao depois da recuperacao.
        let mut holdouts = serde_json::Map::new();
        let mut holdout_rules = Vec::new();
        for (label, built, step, threshold) in [
            ("blind_step3_t37", &blind, 3u8, 37i64),
            ("shifted_step2_t20", &shifted, 2u8, 20i64),
            ("shifted_z_step4_t30", &shifted_z, 4u8, 30i64),
        ] {
            let location = rex_gameplay::locate(&built.bytes);
            let cand = rex_gameplay::locate_unique(&built.bytes)
                .unwrap_or_else(|e| panic!("{label}: {e}"));
            let rec =
                rex_gameplay::recover(&built.bytes, cand.entry, &[cand.exit], &Hints::default())
                    .unwrap_or_else(|e| panic!("{label}: {e}"));
            let got_step = rec.rule.counter_add.as_ref().map(|a| a.step);
            let (score_sym, open_sym) = (
                built.symbols["logic_var_reference_score"],
                built.symbols["logic_var_goal_open"],
            );
            let ok = got_step == Some(step)
                && rec.rule.compare.threshold == threshold
                && rec.rule.compare.counter_addr == score_sym
                && rec.rule.set.state_addr == open_sym;
            holdouts.insert(label.into(), json!({
                "entry": format!("0x{:06X}", cand.entry), "exit": format!("0x{:06X}", cand.exit),
                "blocks": rec.region.blocks,
                "step": got_step, "threshold": rec.rule.compare.threshold,
                "operator": rec.rule.compare.operator.symbol(),
                "counter_addr": format!("0x{:08X}", rec.rule.compare.counter_addr),
                "state_addr": format!("0x{:08X}", rec.rule.set.state_addr),
                "rejected_near_misses": location.rejected.len(),
                "matches_source": ok,
            }));
            println!("{label}: {}", holdouts[label]);
            assert!(ok, "{label}: recuperacao diverge da fonte (validacao)");
            holdout_rules.push((label, built, rec.rule.clone()));
        }
        let displacement = |r: &rex_gameplay::lift::GateRule| {
            json!({
                "entry_delta": r.guard.as_ref().unwrap().at[0] as i64 - cand.entry as i64,
                "counter_addr_delta": r.compare.counter_addr as i64 - score as i64,
                "state_addr_delta": r.set.state_addr as i64 - open as i64,
            })
        };
        let (first, second) = (
            displacement(&holdout_rules[1].2),
            displacement(&holdout_rules[2].2),
        );
        println!("deslocamento a_: {first}; z_: {second}");
        holdouts.insert("displacement_shifted_a".into(), first.clone());
        holdouts.insert("displacement_shifted_z".into(), second.clone());
        assert_ne!(first["entry_delta"], json!(0), "a_: codigo nao deslocou");
        // Demonstrado as cegas: codigo e goal_open deslocados. O endereco do contador
        // NAO mudou em nenhuma das duas variantes (alocacao do GCC); essa alegacao fica
        // fora desta prova e registrada como nao demonstrada.
        for d in [&first, &second] {
            assert_ne!(d["entry_delta"], json!(0), "codigo nao deslocou");
            assert_ne!(d["state_addr_delta"], json!(0), "goal_open nao deslocou");
        }
        holdouts.insert(
            "counter_ram_displacement".into(),
            json!({"demonstrated_blind": first["counter_addr_delta"] != json!(0) || second["counter_addr_delta"] != json!(0),
                   "note": "as duas variantes deslocadas mantiveram logic_var_reference_score em 0xE0FF0054 (layout .bss do GCC); so a fixture nao cega two_passages cobre outro endereco de contador"}),
        );
        report.insert("holdouts".into(), Value::Object(holdouts));
        report.insert("recognizer_frozen".into(), json!({
            "commit": "4163c47d6621283937bd1f91c8a12f42a65a29c4",
            "src_tree": "9af241b325bb09d037a961da4620397680468020",
            "record": "data/rex_profiles/gameplay_recovery/evidence/2026-09-28-rodada2/FREEZE.md",
        }));

        let mut emu = EmulatorCore::new(None);

        // 4. Equivalencia contra o oraculo independente: a ROM original executada pelo core,
        //    com estado injetado. Latencia de input medida num controle.
        let mut equivalence = Vec::new();
        let mut equivalence_roms = vec![("original_t6", &original, rule.clone())];
        equivalence_roms.extend(holdout_rules.iter().cloned());
        for (label, built, recovery_rule) in equivalence_roms {
            let counter = recovery_rule.compare.counter_addr;
            let state = recovery_rule.set.state_addr;
            boot(&mut emu, &built.rom);
            let snap = snapshot(&emu);
            restore_with(&mut emu, &snap, &[(counter, 0)]);
            emu.set_joypad(right()).unwrap();
            let mut latency = 0;
            for frame in 1..=4 {
                emu.run_frame().unwrap();
                if read_long(&emu, counter) != 0 {
                    latency = frame;
                    break;
                }
            }
            assert!(latency > 0, "input nunca chegou ao contador");
            let threshold = recovery_rule.compare.threshold;
            let step = recovery_rule
                .counter_add
                .as_ref()
                .map(|a| a.step as i64)
                .unwrap_or(0);
            let mut counters: Vec<u32> =
                vec![0, 1, 0x7FFF_FFFF, 0x8000_0000, 0xFFFF_FFFF, 0xFFFF_FFF0];
            for delta in -2i64..=1 {
                counters.push((threshold - step + delta) as i32 as u32);
            }
            let mut passed = 0;
            for &c in &counters {
                for initial_state in [0u32, 1] {
                    for (input_label, pad, bits) in [
                        ("none", JoypadState::default(), 0u32),
                        ("right", right(), 0x08),
                    ] {
                        restore_with(&mut emu, &snap, &[(counter, c), (state, initial_state)]);
                        emu.set_joypad(pad).unwrap();
                        for _ in 0..latency {
                            emu.run_frame().unwrap();
                        }
                        let observed = (read_long(&emu, counter), read_long(&emu, state));
                        let effect = evaluate(&recovery_rule, threshold, bits, c, 0);
                        let predicted = (
                            effect.counter_write.unwrap_or(c),
                            effect.state_write.map(|(_, v)| v).unwrap_or(initial_state),
                        );
                        let ok = observed == predicted;
                        equivalence.push(json!({
                            "rom": label, "counter_in": format!("0x{c:08X}"), "state_in": initial_state,
                            "input": input_label, "observed": [format!("0x{:08X}", observed.0), observed.1],
                            "predicted_by_graph": [format!("0x{:08X}", predicted.0), predicted.1], "ok": ok,
                        }));
                        assert!(ok, "{label} c={c:#x} s={initial_state} {input_label}: core {observed:?} vs grafo {predicted:?}");
                        passed += 1;
                    }
                }
            }
            println!("{label}: latencia={latency} casos={passed}");
        }
        report.insert("equivalence_core_oracle".into(), Value::Array(equivalence));
        report.insert("equivalence_observation_point".into(), json!({
            "where": "WRAM lida apos `latencia` quadros completos de run_frame (nao na saida da regiao)",
            "includes": "todo o codigo do quadro: a regiao, o callee opaco (JSR) e o restante do jogo",
            "claim_limited_to": "valores de contador e goal_open; os unicos escritores absolutos desses enderecos estao dentro da regiao (absolute_writers); escritas indiretas nao sao cobertas",
            "not_claimed": "efeitos do callee, registradores e CCR na saida, VDP/som",
        }));

        // 5. Edicao -> dois caminhos -> comparacao com a recompilacao SGDK.
        let edited_graph = edit_gameplay_threshold(&recovered.graph_json, 12).expect("edit");
        let saved = out.join("edited-graph-t12.json");
        fs::write(&saved, &edited_graph).unwrap();
        let reopened_text = fs::read_to_string(&saved).unwrap();
        let reopened = open_graph(&reopened_text).expect("reopen");
        assert_eq!(reopened.threshold, 12);
        let patched = rebuild_gameplay_rom(
            &original.rom,
            &original.sha256,
            &reopened_text,
            &out.join("patched-t12.rom"),
            "patch",
        )
        .expect("patch");
        let regenerated = rebuild_gameplay_rom(
            &original.rom,
            &original.sha256,
            &reopened_text,
            &out.join("regenerated-t12.rom"),
            "regenerate",
        )
        .expect("regen");
        assert_eq!(
            patched.output_sha256, regenerated.output_sha256,
            "patch e regeneracao verificados iguais"
        );
        let identical_to_sgdk = patched.output_sha256 == sgdk12.sha256;
        // O SGDK grava em 0x18E um valor que nao e a soma padrao do Mega Drive; o
        // patcher so o atualiza se a base tiver checksum padrao valido (contrato).
        // Exige-se identidade fora desse campo, e a divergencia fica registrada.
        let patched_bytes = fs::read(out.join("patched-t12.rom")).unwrap();
        assert_eq!(patched_bytes.len(), sgdk12.bytes.len());
        let diff_vs_sgdk: Vec<usize> = (0..patched_bytes.len())
            .filter(|&i| patched_bytes[i] != sgdk12.bytes[i])
            .collect();
        let checksum_field_only = diff_vs_sgdk.iter().all(|&i| (0x18E..0x190).contains(&i));
        let standard_checksum_valid = rex_gameplay::patch::md_checksum(&original.bytes)
            == Some(u16::from_be_bytes([
                original.bytes[0x18E],
                original.bytes[0x18F],
            ]));
        // Item 5: checksum pelo pipeline real (masterizacao do build_orch usa sgdk_checksum).
        let stored = |b: &[u8]| u16::from_be_bytes([b[0x18E], b[0x18F]]);
        let sgdk = crate::core::rom_mastering::sgdk_checksum;
        let recomputed_equals_sgdk = {
            let mut fixed = patched_bytes.clone();
            if let Some(v) = sgdk(&fixed) {
                fixed[0x18E..0x190].copy_from_slice(&v.to_be_bytes());
            }
            fixed == sgdk12.bytes
        };
        let checksum_record = json!({
            "algorithm_pipeline": "SGDK sizebnd: XOR de todas as palavras da ROM exceto 0x18E (core::rom_mastering::sgdk_checksum, aplicado por build_orch apos o header do projeto)",
            "algorithm_patcher": "soma MD aditiva de 0x200 ao fim; so reescrita se a base a tiver valida (contrato atual)",
            "original": {"stored": format!("{:04X}", stored(&original.bytes)), "sgdk_xor": sgdk(&original.bytes).map(|v| format!("{v:04X}")), "md_sum": rex_gameplay::patch::md_checksum(&original.bytes).map(|v| format!("{v:04X}"))},
            "patched": {"stored": format!("{:04X}", stored(&patched_bytes)), "sgdk_xor": sgdk(&patched_bytes).map(|v| format!("{v:04X}")), "md_sum": rex_gameplay::patch::md_checksum(&patched_bytes).map(|v| format!("{v:04X}"))},
            "sgdk_rebuild_t12": {"stored": format!("{:04X}", stored(&sgdk12.bytes)), "sgdk_xor": sgdk(&sgdk12.bytes).map(|v| format!("{v:04X}"))},
            "patched_mastering_status": crate::core::rom_mastering::inspect_rom_mastering(&out.join("patched-t12.rom")).map(|r| r.checksum.status).unwrap_or_else(|e| e),
            "original_mastering_status": crate::core::rom_mastering::inspect_rom_mastering(&original.rom).map(|r| r.checksum.status).unwrap_or_else(|e| e),
            "patched_with_sgdk_xor_recomputed_equals_sgdk_rebuild": recomputed_equals_sgdk,
            "policy": "inalterada; atualizacao do checksum SGDK proposta ao integrador",
            "hardware_note": "o core Libretro nao valida este campo; execucao no core nao prova compatibilidade com hardware",
        });
        println!("checksum: {checksum_record}");
        report.insert("checksum".into(), checksum_record);
        let noop = rebuild_gameplay_rom(
            &original.rom,
            &original.sha256,
            &recovered.graph_json,
            &out.join("noop-t6.rom"),
            "regenerate",
        )
        .expect("noop");
        assert_eq!(
            noop.output_sha256, original.sha256,
            "controle no-op reproduz a base"
        );
        report.insert(
            "rebuild".into(),
            json!({
                "patch": patched, "regenerate": regenerated, "noop_regenerate": noop,
                "patch_equals_sgdk_rebuild_t12": identical_to_sgdk,
                "sgdk_rebuild_t12_sha256": sgdk12.sha256,
                "diff_vs_sgdk_offsets": diff_vs_sgdk.iter().map(|i| format!("0x{i:06X}")).collect::<Vec<_>>(),
                "diff_vs_sgdk_confined_to_header_checksum_0x18E": checksum_field_only,
                "base_has_standard_md_checksum": standard_checksum_valid,
            }),
        );
        assert!(
            identical_to_sgdk || (checksum_field_only && !standard_checksum_valid),
            "patch deve igualar a recompilacao SGDK com limiar 12 fora do campo de checksum nao padrao: {diff_vs_sgdk:x?}"
        );

        // 6. Efeito no jogo: mesmo estado salvo, mesma sequencia de input, tres ROMs.
        let prediction = json!({
            "variable": format!("logic_var_goal_open @0x{open:08X}"),
            "condition": "reference_score >= T; T=6 no original, T=12 na editada",
            "window": "segurando Right a partir de score 0: original abre no quadro de input em que score=6; editada so em score=12; entre esses quadros goal_open difere",
            "physical": "editada mantem o jogador parado antes da barreira (x+14<=50) enquanto 6<=score<12; original ja atravessa",
            "visual": "faixa x=50..74 da barreira muda um quadro apos a abertura; na editada permanece ate score 12",
        });
        report.insert("prediction_before_capture".into(), prediction);
        let player_x = original.symbols["spr_player_x"];
        boot(&mut emu, &original.rom);
        let snap = snapshot(&emu);
        let mut runs = serde_json::Map::new();
        for (label, path) in [
            ("original_t6", original.rom.clone()),
            ("patched_t12", out.join("patched-t12.rom")),
            ("noop_t6", out.join("noop-t6.rom")),
        ] {
            let loaded_sha = sha256_hex(&fs::read(&path).unwrap());
            emu.load_rom(&path).expect("load");
            restore_with(&mut emu, &snap, &[(score, 0), (open, 0)]);
            emu.set_joypad(right()).unwrap();
            let mut frames = Vec::new();
            for frame in 1..=30 {
                emu.run_frame().unwrap();
                let x = read_word(&emu, player_x);
                let (band_sha, band_px) = band_signature(&emu, 50, 74);
                frames.push(json!({
                    "frame": frame, "score": read_long(&emu, score) as i32,
                    "goal_open": read_long(&emu, open), "player_x": x,
                    "band_sha256": band_sha, "band_non_background_px": band_px,
                }));
            }
            runs.insert(
                label.into(),
                json!({"rom_sha256": loaded_sha, "frames": frames}),
            );
        }
        let first_open = |label: &str| -> Option<i64> {
            runs[label]["frames"]
                .as_array()
                .unwrap()
                .iter()
                .find(|f| f["goal_open"] == 1)
                .map(|f| f["score"].as_i64().unwrap())
        };
        let max_x_before = |label: &str, score_limit: i64| -> i64 {
            runs[label]["frames"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|f| f["score"].as_i64().unwrap() < score_limit)
                .map(|f| f["player_x"].as_i64().unwrap())
                .max()
                .unwrap()
        };
        let (o, p, n) = (
            first_open("original_t6"),
            first_open("patched_t12"),
            first_open("noop_t6"),
        );
        println!("abre em score: original={o:?} editada={p:?} noop={n:?}");
        assert_eq!(o, Some(6));
        assert_eq!(p, Some(12), "editada abre em 12");
        assert_eq!(n, Some(6), "controle no-op se comporta como original");
        // Controle "ROM antiga": a observacao da original falha a previsao da editada.
        assert_ne!(o, Some(12));
        assert_eq!(runs["noop_t6"]["frames"], runs["original_t6"]["frames"]);
        assert_ne!(
            runs["patched_t12"]["frames"], runs["original_t6"]["frames"],
            "resposta antiga reutilizada?"
        );
        let edited_blocked = max_x_before("patched_t12", 12);
        // Criterio fisico por quadro (revisado apos a 1a captura: o limiar numerico
        // "x>66 no quadro 21" era arbitrario e falhou com x=66; ver relatorio).
        let frames_of = |label: &str| runs[label]["frames"].as_array().unwrap().clone();
        let (orig_frames, edit_frames) = (frames_of("original_t6"), frames_of("patched_t12"));
        let diverging: Vec<i64> = orig_frames
            .iter()
            .zip(&edit_frames)
            .filter(|(o, e)| {
                o["player_x"].as_i64().unwrap() + 14 > 50
                    && e["player_x"].as_i64().unwrap() + 14 <= 50
            })
            .map(|(o, _)| o["frame"].as_i64().unwrap())
            .collect();
        println!("x max editada antes de 12: {edited_blocked}; quadros com original alem da barreira e editada bloqueada: {diverging:?}");
        assert!(
            edited_blocked + 14 <= 50,
            "editada deve ficar bloqueada antes da barreira"
        );
        assert!(
            !diverging.is_empty(),
            "no mesmo quadro, original deve passar a barreira enquanto editada esta bloqueada"
        );
        report.insert("physical_diverging_frames".into(), json!(diverging));
        // Item 6: controles planejados antes da 1a execucao (resultado registrado como
        // veio, inclusive o que falhou) x observacoes que surgiram no diagnostico.
        let original_x21 = orig_frames[20]["player_x"].as_i64().unwrap();
        report.insert("controls_planned_before_execution".into(), json!([
            {"id": "open_score_original", "expected": 6, "observed": o, "pass": o == Some(6)},
            {"id": "open_score_edited", "expected": 12, "observed": p, "pass": p == Some(12)},
            {"id": "noop_equals_original", "pass": runs["noop_t6"]["frames"] == runs["original_t6"]["frames"]},
            {"id": "edited_differs_from_original (resposta antiga)", "pass": runs["patched_t12"]["frames"] != runs["original_t6"]["frames"]},
            {"id": "edited_blocked_before_12 (x+14<=50)", "observed_max_x": edited_blocked, "pass": edited_blocked + 14 <= 50},
            {"id": "original_crossed_x_gt_66_at_frame_21", "observed_x": original_x21, "pass": original_x21 > 66,
             "note": "limiar numerico escolhido sem base na 1a execucao; falhou (x=66) e NAO e mais usado como gate"},
        ]));
        report.insert("diagnostic_observations".into(), json!([
            {"id": "per_frame_divergence", "criterion": "mesmo quadro: original x+14>50 e editada x+14<=50", "frames": diverging,
             "origin": "introduzido apos a 1a captura para substituir o limiar x>66; a previsao causal (limiar -> goal_open -> bloqueio) nao mudou"},
            {"id": "checksum_0x18F", "origin": "surgiu na 1a execucao; ver `checksum`"},
        ]));
        report.insert("effect_runs".into(), Value::Object(runs));
        report.insert(
            "layer".into(),
            json!("tecnica: chamadas diretas ao core (sem teclado/UI)"),
        );

        let path = out.join("report.json");
        fs::write(
            &path,
            serde_json::to_string_pretty(&Value::Object(report)).unwrap(),
        )
        .unwrap();
        println!("relatorio: {}", path.display());
        emu.stop().ok();
        let _ = fs::remove_dir_all(base);
    }
}
