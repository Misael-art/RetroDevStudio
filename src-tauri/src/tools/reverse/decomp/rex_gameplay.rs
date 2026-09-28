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

use super::inspection::InspectionError;
use crate::core::rom_mastering::sha256_hex;

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

// ---------------------------------------------------------------------------
// Capa IPC (integrador do produto): limites explicitos, identidade de ROM e
// erros estruturados. Nada se autodetecta: quen chama declara ROM, entrada,
// saidas e metodo. Un resultado antigo tras trocar a ROM recusase por
// identidade (SHA-256 da base vs. SHA registrado no grafo).
// ---------------------------------------------------------------------------

use rex_gameplay::graph::Hints as GameplayHints;
use rex_gameplay::scan_guarded_candidates;
use serde::Deserialize;

/// Techo de lectura de ROM: as imaxes Mega Drive deste produto non superan
/// 32 MiB; amosar a recusa antes de ler, non OOM.
pub const MAX_ROM_BYTES: u64 = 32 * 1024 * 1024;
/// Techo do grafo NodeGraph v1 que viaxa por IPC (8 MiB).
pub const MAX_GRAPH_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_EXITS: usize = 64;
pub const MAX_ADDRESS_LABELS: usize = 512;

fn fail_ipc(code: &str, message: impl Into<String>) -> InspectionError {
    InspectionError {
        code: code.to_string(),
        message: message.into(),
        retryable: false,
    }
}

/// Traducion dos erros de texto do paquete a codigos estables. O conxunto de
/// mensaxes do perfil e pechado (CONTRACT.md); as pruebas enumeratean a
/// clasificacion. Determinista: `retryable=false` en todas as recusas.
fn erro_de_perfil(e: String) -> InspectionError {
    let code = if e.contains("SHA-256 da base diverge")
        || e.contains("o grafo foi recuperado de")
        || e.contains("nao sao os registrados no grafo")
    {
        "identity_mismatch"
    } else if e.contains("fora de") && (e.contains("recusada") || e.contains("recusado")) {
        "range_refused"
    } else if e.contains("grafo inconsistente")
        || e.contains("versao de grafo")
        || e.starts_with("mapping 0x")
        || e.contains("mapeado por mais de um")
        || e.contains("fora do fluxo delimitado")
        || e.contains("semantic_origin")
    {
        "graph_tampered"
    } else if e.starts_with("falha ao ler") || e.starts_with("falha ao gravar") {
        "io_error"
    } else {
        "profile_refused"
    };
    InspectionError {
        code: code.to_string(),
        message: e,
        retryable: false,
    }
}

fn validar_request_id(id: &str) -> Result<(), InspectionError> {
    if id.is_empty() || id.len() > 128 {
        return Err(fail_ipc(
            "invalid_request",
            "request_id baleiro ou grande demais (maximo 128 caracteres)",
        ));
    }
    Ok(())
}

fn ler_rom_limitada(path: &str) -> Result<Vec<u8>, InspectionError> {
    if path.trim().is_empty() {
        return Err(fail_ipc("invalid_request", "rom_path baleiro"));
    }
    let meta = fs::metadata(path)
        .map_err(|e| fail_ipc("invalid_request", format!("ROM non accesible: {e}")))?;
    if !meta.is_file() {
        return Err(fail_ipc("invalid_request", "rom_path non e un ficheiro"));
    }
    if meta.len() > MAX_ROM_BYTES {
        return Err(fail_ipc(
            "invalid_request",
            format!(
                "ROM de {} bytes excede o limite de {MAX_ROM_BYTES}; recusado sen ler",
                meta.len()
            ),
        ));
    }
    fs::read(path).map_err(|e| fail_ipc("io_error", format!("falha ao ler ROM: {e}")))
}

fn validar_grafo_len(graph_json: &str) -> Result<(), InspectionError> {
    if graph_json.len() > MAX_GRAPH_BYTES {
        return Err(fail_ipc(
            "invalid_request",
            format!(
                "grafo de {} bytes excede o limite de {MAX_GRAPH_BYTES}; recusado",
                graph_json.len()
            ),
        ));
    }
    Ok(())
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct GameplayAddressLabel {
    pub offset: u32,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct GameplayScanRequest {
    pub request_id: String,
    pub rom_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct GameplayScanCandidate {
    pub entry: u32,
    pub exit: u32,
    pub counter_addr: u32,
    pub threshold: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct GameplayScanResponse {
    pub request_id: String,
    pub rom_sha256: String,
    pub candidates: Vec<GameplayScanCandidate>,
    /// Exactamente un candidato = non ambigua. Con 0 ou >1 a interface debe
    /// declarar entrada/saidas: a varredura non escolhe rotina por si.
    pub ambiguous: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct GameplayRecoverRequest {
    pub request_id: String,
    pub rom_path: String,
    pub entry: u32,
    pub exits: Vec<u32>,
    pub address_labels: Vec<GameplayAddressLabel>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct GameplayRecoverResponse {
    pub request_id: String,
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct GameplayEditRequest {
    pub request_id: String,
    pub graph_json: String,
    pub threshold: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct GameplayEditResponse {
    pub request_id: String,
    pub graph_json: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct GameplayRebuildRequest {
    pub request_id: String,
    pub base_path: String,
    pub expected_sha256: String,
    pub graph_json: String,
    pub output_path: String,
    /// "patch" (so o inmediato do limiar) ou "regenerate" (remonta a rexion).
    /// Non e unha compilacion de proxecto: iso segue o fluxo canónico de build.
    pub method: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct GameplayRebuildResponse {
    pub request_id: String,
    pub method: String,
    pub input_sha256: String,
    pub output_sha256: String,
    pub output_path: String,
    pub changed_offsets: Vec<usize>,
    pub authorized_ranges: Vec<(usize, usize)>,
    pub checksum_updated: bool,
}

/// Varredura estrutural de lectura: so candidatos, ningunha eleccion
/// automatica. Unha resposta non ambigu ten exactamente un candidato.
pub fn ipc_scan(req: &GameplayScanRequest) -> Result<GameplayScanResponse, InspectionError> {
    validar_request_id(&req.request_id)?;
    let rom = ler_rom_limitada(&req.rom_path)?;
    let candidates: Vec<GameplayScanCandidate> = scan_guarded_candidates(&rom)
        .into_iter()
        .map(|c| GameplayScanCandidate {
            entry: c.entry,
            exit: c.exit,
            counter_addr: c.counter_addr,
            threshold: c.threshold,
        })
        .collect();
    let ambiguous = candidates.len() != 1;
    Ok(GameplayScanResponse {
        request_id: req.request_id.clone(),
        rom_sha256: sha256_hex(&rom),
        candidates,
        ambiguous,
    })
}

/// Recuperacion delimitada: ROM + entrada + saidas declaradas. Os rotulos de
/// enderezo son presentacion e non entran na elevacion.
pub fn ipc_recover(
    req: &GameplayRecoverRequest,
) -> Result<GameplayRecoverResponse, InspectionError> {
    validar_request_id(&req.request_id)?;
    if req.exits.is_empty() {
        return Err(fail_ipc(
            "invalid_request",
            "ao menos unha saida declarada e obrigatoria; nada se autodetecta",
        ));
    }
    if req.exits.len() > MAX_EXITS {
        return Err(fail_ipc(
            "invalid_request",
            format!("{} saidas exceden o limite de {MAX_EXITS}", req.exits.len()),
        ));
    }
    if req.exits.contains(&req.entry) {
        return Err(fail_ipc(
            "invalid_request",
            "a entrada coincide cunha saida declarada",
        ));
    }
    if !req.entry.is_multiple_of(2) || req.exits.iter().any(|e| !e.is_multiple_of(2)) {
        return Err(fail_ipc(
            "invalid_request",
            "entrada e saidas deben estar aliñadas a palabra (par)",
        ));
    }
    if req.address_labels.len() > MAX_ADDRESS_LABELS {
        return Err(fail_ipc(
            "invalid_request",
            format!(
                "{} rotulos exceden o limite de {MAX_ADDRESS_LABELS}",
                req.address_labels.len()
            ),
        ));
    }
    let _ = ler_rom_limitada(&req.rom_path)?;
    let hints = GameplayHints {
        address_names: req
            .address_labels
            .iter()
            .map(|l| (l.offset, l.name.clone()))
            .collect(),
        origin: "tauri_ipc:rom_recover_gameplay_gate".to_string(),
    };
    let dto = recover_gameplay_gate(Path::new(&req.rom_path), req.entry, &req.exits, &hints)
        .map_err(erro_de_perfil)?;
    Ok(GameplayRecoverResponse {
        request_id: req.request_id.clone(),
        profile_id: dto.profile_id,
        rom_sha256: dto.rom_sha256,
        entry: dto.entry,
        exits: dto.exits,
        blocks: dto.blocks,
        operator: dto.operator,
        threshold: dto.threshold,
        threshold_range: dto.threshold_range,
        graph_json: dto.graph_json,
        limitations: dto.limitations,
    })
}

/// Unica edicion exposta: o limiar do no rom_counter_compare, na faixa que
/// devolve a recuperacion. Fora dela recúsase co motivo (range_refused).
pub fn ipc_edit(req: &GameplayEditRequest) -> Result<GameplayEditResponse, InspectionError> {
    validar_request_id(&req.request_id)?;
    validar_grafo_len(&req.graph_json)?;
    let graph_json =
        edit_gameplay_threshold(&req.graph_json, req.threshold).map_err(erro_de_perfil)?;
    Ok(GameplayEditResponse {
        request_id: req.request_id.clone(),
        graph_json,
    })
}

/// Xera unha copia nova: a base NON se toca (recúsase saída == base ou saída
/// existente) e a identidade revalidase (SHA esperado vs. base vs. grafo).
pub fn ipc_rebuild(
    req: &GameplayRebuildRequest,
) -> Result<GameplayRebuildResponse, InspectionError> {
    validar_request_id(&req.request_id)?;
    if req.method != "patch" && req.method != "regenerate" {
        return Err(fail_ipc(
            "invalid_request",
            format!(
                "metodo '{}' desconhecido; so 'patch' ou 'regenerate'",
                req.method
            ),
        ));
    }
    validar_grafo_len(&req.graph_json)?;
    if req.base_path.trim().is_empty() || req.output_path.trim().is_empty() {
        return Err(fail_ipc(
            "invalid_request",
            "base_path e output_path son obrigatorios",
        ));
    }
    if req.base_path == req.output_path {
        return Err(fail_ipc(
            "invalid_request",
            "a saida debe ser distinta da base: o orixinal presérvase sempre",
        ));
    }
    if Path::new(&req.output_path).exists() {
        return Err(fail_ipc(
            "invalid_request",
            format!(
                "a saida xa existe; escolla outro camiño: {}",
                req.output_path
            ),
        ));
    }
    let sha_ok = req.expected_sha256.len() == 64
        && req.expected_sha256.bytes().all(|b| b.is_ascii_hexdigit());
    if !sha_ok {
        return Err(fail_ipc(
            "invalid_request",
            "expected_sha256 debe ser SHA-256 hexadecimal de 64 digitos; nada se adiviña",
        ));
    }
    let dto = rebuild_gameplay_rom(
        Path::new(&req.base_path),
        &req.expected_sha256,
        &req.graph_json,
        Path::new(&req.output_path),
        &req.method,
    )
    .map_err(erro_de_perfil)?;
    Ok(GameplayRebuildResponse {
        request_id: req.request_id.clone(),
        method: dto.method,
        input_sha256: dto.input_sha256,
        output_sha256: dto.output_sha256,
        output_path: dto.output_path,
        changed_offsets: dto.changed_offsets,
        authorized_ranges: dto.authorized_ranges,
        checksum_updated: dto.checksum_updated,
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
    // Capa IPC (integrador): identidade, limites, erros estruturados.
    // ------------------------------------------------------------------

    fn fixture_image(name: &str) -> Vec<u8> {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../crates/rex-gameplay/fixtures")
            .join(name);
        let text = fs::read_to_string(&path).expect("fixture");
        let mut image = Vec::new();
        for line in text.lines().filter(|l| !l.starts_with('#')) {
            let parts: Vec<&str> = line.split_whitespace().collect();
            match parts[0] {
                "rom_size" => image = vec![0u8; parts[1].parse().unwrap()],
                "rom_sha256" => {}
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
        image
    }

    fn ipc_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("rex-gameplay-ipc-{tag}-{}", nonce()));
        fs::create_dir_all(&dir).expect("dir");
        dir
    }

    fn write_fixture_rom(dir: &Path, name: &str) -> (PathBuf, Vec<u8>) {
        let image = fixture_image(name);
        let p = dir.join(name);
        fs::write(&p, &image).expect("rom");
        (p, image)
    }

    fn recover_request(rom: &Path, entry: u32, exits: &[u32]) -> GameplayRecoverRequest {
        GameplayRecoverRequest {
            request_id: "test-recover-1".to_string(),
            rom_path: rom.to_string_lossy().to_string(),
            entry,
            exits: exits.to_vec(),
            address_labels: Vec::new(),
        }
    }

    #[test]
    fn ipc_recover_devolve_grafo_com_identidade_de_rom() {
        let dir = ipc_dir("ok");
        let (rom, image) = write_fixture_rom(&dir, "goal_original_t6.hex");
        let resp = ipc_recover(&recover_request(&rom, 0x946, &[0x970])).expect("recover");
        assert_eq!(resp.request_id, "test-recover-1");
        assert_eq!(resp.profile_id, "m68k.counter_threshold_state_gate.v1");
        assert_eq!(
            resp.rom_sha256,
            sha256_hex(&image),
            "identidade = SHA do arquivo lido"
        );
        assert_eq!((resp.operator.as_str(), resp.threshold), (">=", 6));
        assert!(
            resp.threshold_range.0 <= 12 && 12 <= resp.threshold_range.1,
            "12 debe ser editabel: {:?}",
            resp.threshold_range
        );
        assert!(resp.graph_json.contains("rom_counter_compare"));
        assert!(!resp.limitations.is_empty(), "limitaciones viaxan co grafo");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn ipc_recover_recusa_fronteira_por_motivo_estruturado() {
        let dir = ipc_dir("fronteira");
        let (rom, _) = write_fixture_rom(&dir, "goal_original_t6.hex");
        let base = recover_request(&rom, 0x946, &[0x970]);

        let mut sen_id = base.clone();
        sen_id.request_id = String::new();
        let e = ipc_recover(&sen_id).unwrap_err();
        assert_eq!(e.code, "invalid_request");

        let mut rom_vella = base.clone();
        rom_vella.rom_path = dir.join("non-existe.bin").to_string_lossy().to_string();
        let e = ipc_recover(&rom_vella).unwrap_err();
        assert_eq!(e.code, "invalid_request");

        let mut sen_saida = base.clone();
        sen_saida.exits = Vec::new();
        let e = ipc_recover(&sen_saida).unwrap_err();
        assert_eq!(e.code, "invalid_request");

        let mut entrada_como_saida = base.clone();
        entrada_como_saida.exits = vec![0x946];
        let e = ipc_recover(&entrada_como_saida).unwrap_err();
        assert_eq!(e.code, "invalid_request");

        let grande = dir.join("grande.bin");
        let f = fs::File::create(&grande).expect("sparse");
        f.set_len(MAX_ROM_BYTES + 1).expect("set_len");
        let mut enorme = base.clone();
        enorme.rom_path = grande.to_string_lossy().to_string();
        let e = ipc_recover(&enorme).unwrap_err();
        assert_eq!(e.code, "invalid_request");
        assert!(!e.retryable, "recusas deterministas non se reintentan");

        // ROM errada: ceros onde hai que recuperar a forma — recusa do perfil, non panic.
        let branca = dir.join("branca.bin");
        fs::write(&branca, vec![0u8; 65536]).expect("branca");
        let e = ipc_recover(&recover_request(&branca, 0x946, &[0x970])).unwrap_err();
        assert_eq!(e.code, "profile_refused");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn ipc_scan_devolve_candidatos_e_marca_a_ambiguidade() {
        let dir = ipc_dir("scan");
        let (rom1, _) = write_fixture_rom(&dir, "goal_original_t6.hex");
        let r = ipc_scan(&GameplayScanRequest {
            request_id: "test-scan-1".to_string(),
            rom_path: rom1.to_string_lossy().to_string(),
        })
        .expect("scan");
        assert_eq!(r.candidates.len(), 1);
        assert!(!r.ambiguous);
        assert_eq!(r.candidates[0].entry, 0x946);
        assert_eq!(r.request_id, "test-scan-1", "eco de identidade de chamada");
        assert_eq!(r.rom_sha256, sha256_hex(&fs::read(&rom1).unwrap()));

        // Ambiguidade real: a mesma rotina en dous enderezos dunha imaxe sen
        // simbolos. Duplicase o span completo da rexion (0x946..0xCCC, incluida
        // a segunda bloco ao que salta a rama de volta) porque copiar so o
        // primeiro bloque deixa o BLT fóra do código válido e non e candidato.
        let image = fixture_image("goal_original_t6.hex");
        let span = image[0x946..0xCCC].to_vec();
        let mut image2 = image;
        image2[0x4000..0x4000 + span.len()].copy_from_slice(&span);
        let rom_dup = dir.join("rotina_duplicada.bin");
        fs::write(&rom_dup, &image2).expect("dup");
        let r = ipc_scan(&GameplayScanRequest {
            request_id: "test-scan-2".to_string(),
            rom_path: rom_dup.to_string_lossy().to_string(),
        })
        .expect("scan ambigua");
        assert_eq!(
            r.candidates.len(),
            2,
            "as dúas formas com guarda son candidatas"
        );
        assert!(r.ambiguous, "rotina ambigua: a varredura non escolhe");
        let mut entries: Vec<u32> = r.candidates.iter().map(|c| c.entry).collect();
        entries.sort_unstable();
        assert_eq!(entries, vec![0x946, 0x4000]);
        // Un candidato duplicado é recuperable coas súas propias entradas/saidas:
        // a ambiguidade recúsase na varredura, non na recuperación declarada.
        let rec_dup = ipc_recover(&recover_request(&rom_dup, 0x4000, &[0x402A]))
            .expect("recuperar a copia declarada");
        assert_eq!(rec_dup.threshold, 6);
        assert_eq!(rec_dup.entry, 0x4000);

        // two_passages: a regra 2 non ten guarda; a varredura so ve a 1 e a
        // interface debe declarar entrada/saidas para a outra (recuperable).
        let (rom2, _) = write_fixture_rom(&dir, "two_passages.hex");
        let r = ipc_scan(&GameplayScanRequest {
            request_id: "test-scan-3".to_string(),
            rom_path: rom2.to_string_lossy().to_string(),
        })
        .expect("scan two_passages");
        assert_eq!(r.candidates.len(), 1);
        let rec2 = ipc_recover(&recover_request(&rom2, 0xAA0, &[0xAC8, 0xC7A]))
            .expect("regras sen guarda recuperables con entrada/saidas declaradas");
        assert_eq!(rec2.threshold, 60);
        let _ = fs::remove_dir_all(dir);
    }

    fn compare_threshold(graph_json: &str) -> i64 {
        let v: Value = serde_json::from_str(graph_json).expect("grafo JSON valido");
        v["nodes"]
            .as_array()
            .expect("nodes")
            .iter()
            .find(|n| n["type"].as_str() == Some("rom_counter_compare"))
            .expect("no rom_counter_compare")["params"]["threshold"]
            .as_i64()
            .expect("threshold i64")
    }

    #[test]
    fn ipc_edit_permite_so_o_limiar_na_faixa() {
        let dir = ipc_dir("edit");
        let (rom, _) = write_fixture_rom(&dir, "goal_original_t6.hex");
        let recovered = ipc_recover(&recover_request(&rom, 0x946, &[0x970])).expect("recover");
        assert_eq!(compare_threshold(&recovered.graph_json), 6);

        let editado = ipc_edit(&GameplayEditRequest {
            request_id: "test-edit-1".to_string(),
            graph_json: recovered.graph_json.clone(),
            threshold: 12,
        })
        .expect("12 na faixa");
        assert_eq!(compare_threshold(&editado.graph_json), 12);
        assert_eq!(
            editado.request_id, "test-edit-1",
            "eco de identidade de chamada"
        );

        let e = ipc_edit(&GameplayEditRequest {
            request_id: "test-edit-2".to_string(),
            graph_json: recovered.graph_json.clone(),
            threshold: 100_000,
        })
        .unwrap_err();
        assert_eq!(e.code, "range_refused", "fora da faixa: motivo previsto");

        let e = ipc_edit(&GameplayEditRequest {
            request_id: "test-edit-3".to_string(),
            graph_json: "x".repeat(MAX_GRAPH_BYTES + 1),
            threshold: 12,
        })
        .unwrap_err();
        assert_eq!(e.code, "invalid_request");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn ipc_reabertura_recusa_grafo_adulterado() {
        let dir = ipc_dir("adulterado");
        let (rom, _) = write_fixture_rom(&dir, "goal_original_t6.hex");
        let recovered = ipc_recover(&recover_request(&rom, 0x946, &[0x970])).expect("recover");
        let mut graph: Value = serde_json::from_str(&recovered.graph_json).expect("json");
        let nodes = graph["nodes"].as_array_mut().expect("nodes");
        let add = nodes
            .iter_mut()
            .find(|n| n["type"].as_str() == Some("rom_counter_add"))
            .expect("no rom_counter_add");
        let step = add["params"]["step"].as_i64().expect("step i64");
        add["params"]["step"] = json!(step + 1);
        let adulterado = serde_json::to_string(&graph).expect("serializar");

        let e = ipc_rebuild(&rebuild_request(
            &dir,
            &rom,
            &sha256_hex(&fs::read(&rom).unwrap()),
            &adulterado,
            "patch",
        ))
        .unwrap_err();
        assert_eq!(e.code, "graph_tampered");
        let _ = fs::remove_dir_all(dir);
    }

    fn rebuild_request(
        dir: &Path,
        base: &Path,
        expected_sha: &str,
        graph_json: &str,
        method: &str,
    ) -> GameplayRebuildRequest {
        GameplayRebuildRequest {
            request_id: "test-rebuild-1".to_string(),
            base_path: base.to_string_lossy().to_string(),
            expected_sha256: expected_sha.to_string(),
            graph_json: graph_json.to_string(),
            output_path: dir
                .join(format!("saida-{}.bin", nonce()))
                .to_string_lossy()
                .to_string(),
            method: method.to_string(),
        }
    }

    #[test]
    fn ipc_rebuild_patch_e_regeneracion_coinciden() {
        let dir = ipc_dir("rebuild");
        let (rom, image) = write_fixture_rom(&dir, "goal_original_t6.hex");
        let recovered = ipc_recover(&recover_request(&rom, 0x946, &[0x970])).expect("recover");
        let editado = ipc_edit(&GameplayEditRequest {
            request_id: "test-edit-r".to_string(),
            graph_json: recovered.graph_json.clone(),
            threshold: 12,
        })
        .expect("edit");
        let sha_base = sha256_hex(&image);

        let p = ipc_rebuild(&rebuild_request(
            &dir,
            &rom,
            &sha_base,
            &editado.graph_json,
            "patch",
        ))
        .expect("patch");
        assert_eq!(p.method, "patch_moveq_immediate");
        assert_eq!(
            p.request_id, "test-rebuild-1",
            "eco de identidade de chamada"
        );
        assert_eq!(p.input_sha256, sha_base);
        assert_eq!(p.changed_offsets, vec![0x961], "só o inmediato do MOVEQ");
        let g = ipc_rebuild(&rebuild_request(
            &dir,
            &rom,
            &sha_base,
            &editado.graph_json,
            "regenerate",
        ))
        .expect("regenerate");
        assert_eq!(g.method, "regenerate_region_from_graph");
        assert_eq!(
            g.output_sha256, p.output_sha256,
            "verificado, non presumido"
        );
        assert_ne!(p.output_sha256, sha_base, "a copia editada diste da base");
        assert_eq!(
            fs::read(&p.output_path)
                .map(|b| sha256_hex(&b))
                .ok()
                .as_deref(),
            Some(p.output_sha256.as_str())
        );

        // no-op: grafo sen editar rexenera a base idéntica
        let n = ipc_rebuild(&rebuild_request(
            &dir,
            &rom,
            &sha_base,
            &recovered.graph_json,
            "regenerate",
        ))
        .expect("no-op");
        assert_eq!(n.output_sha256, sha_base);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn ipc_rebuild_recusa_resultado_antigo_tras_trocar_a_rom() {
        let dir = ipc_dir("antiga");
        let (rom_a, image_a) = write_fixture_rom(&dir, "goal_original_t6.hex");
        let recovered = ipc_recover(&recover_request(&rom_a, 0x946, &[0x970])).expect("recover");
        let editado = ipc_edit(&GameplayEditRequest {
            request_id: "test-edit-antiga".to_string(),
            graph_json: recovered.graph_json,
            threshold: 12,
        })
        .expect("edit");

        // Sesión nova: outra ROM (a mesma imaxe cun byte fora da rexión mudado).
        let mut bytes_b = image_a.clone();
        bytes_b[0x1234] ^= 0xFF;
        let rom_b = dir.join("rom-b.bin");
        fs::write(&rom_b, &bytes_b).expect("rom b");
        let sha_b = sha256_hex(&bytes_b);

        // (a) grafo vello + base nova: o SHA esperado coincide coa base pero non co grafo.
        let e = ipc_rebuild(&rebuild_request(
            &dir,
            &rom_b,
            &sha_b,
            &editado.graph_json,
            "patch",
        ))
        .unwrap_err();
        assert_eq!(e.code, "identity_mismatch");

        // (b) grafo da sesion nova + base vella: o SHA esperado coincide coa base
        //     informada, pero o grafo procede da ROM B: identity_mismatch tamén aquí.
        let rec_b = ipc_recover(&recover_request(&rom_b, 0x946, &[0x970])).expect("recover b");
        let edit_b = ipc_edit(&GameplayEditRequest {
            request_id: "test-edit-antiga-b".to_string(),
            graph_json: rec_b.graph_json,
            threshold: 12,
        })
        .expect("edit b");
        let e = ipc_rebuild(&rebuild_request(
            &dir,
            &rom_a,
            &sha256_hex(&image_a),
            &edit_b.graph_json,
            "patch",
        ))
        .map(|_| unreachable!("base vella co grafo novo debe recusarse"))
        .unwrap_err();
        assert_eq!(e.code, "identity_mismatch");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn ipc_rebuild_recusa_limiar_fora_da_faixa_no_grafo() {
        // O limiar pode chegar fora da faixa sen pasar por ipc_edit (grafo
        // editado a man ou de antes dunha mudança de ROM). A reconstrución
        // recúsao co mesmo motivo estruturado que a edición.
        let dir = ipc_dir("rbfaixa");
        let (rom, image) = write_fixture_rom(&dir, "goal_original_t6.hex");
        let recovered = ipc_recover(&recover_request(&rom, 0x946, &[0x970])).expect("recover");
        let mut graph: Value = serde_json::from_str(&recovered.graph_json).expect("json");
        let nodes = graph["nodes"].as_array_mut().expect("nodes");
        let compare = nodes
            .iter_mut()
            .find(|n| n["type"].as_str() == Some("rom_counter_compare"))
            .expect("no rom_counter_compare");
        compare["params"]["threshold"] = json!(100_000);
        let adulterado = serde_json::to_string(&graph).expect("serializar");

        let e = ipc_rebuild(&rebuild_request(
            &dir,
            &rom,
            &sha256_hex(&image),
            &adulterado,
            "patch",
        ))
        .unwrap_err();
        assert_eq!(
            e.code, "range_refused",
            "limiar fóra da faixa: motivo previsto"
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn ipc_rebuild_recusa_fronteira_por_motivo_estruturado() {
        let dir = ipc_dir("rbfront");
        let (rom, image) = write_fixture_rom(&dir, "goal_original_t6.hex");
        let recovered = ipc_recover(&recover_request(&rom, 0x946, &[0x970])).expect("recover");
        let sha = sha256_hex(&image);

        let mut metodo = rebuild_request(&dir, &rom, &sha, &recovered.graph_json, "meter_prisa");
        let e = ipc_rebuild(&metodo).unwrap_err();
        assert_eq!(e.code, "invalid_request");

        metodo.method = "patch".to_string();
        metodo.output_path = rom.to_string_lossy().to_string();
        let e = ipc_rebuild(&metodo).unwrap_err();
        assert_eq!(
            e.code, "invalid_request",
            "a saída debe ser distinta (preserva o orixinal)"
        );

        let existente = dir.join("existente.bin");
        fs::write(&existente, [1u8]).expect("existente");
        metodo.output_path = existente.to_string_lossy().to_string();
        let e = ipc_rebuild(&metodo).unwrap_err();
        assert_eq!(e.code, "invalid_request");

        let mut sen_id = rebuild_request(&dir, &rom, &sha, &recovered.graph_json, "patch");
        sen_id.request_id = String::new();
        let e = ipc_rebuild(&sen_id).unwrap_err();
        assert_eq!(e.code, "invalid_request");

        let mut sha_malo = rebuild_request(&dir, &rom, &sha, &recovered.graph_json, "patch");
        sha_malo.expected_sha256 = "f".repeat(64);
        let e = ipc_rebuild(&sha_malo).unwrap_err();
        assert_eq!(e.code, "identity_mismatch");
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
        fs::copy(&original.rom, out.join("original-t6.rom")).unwrap();
        fs::copy(&sgdk12.rom, out.join("sgdk-rebuilt-t12.rom")).unwrap();
        fs::copy(&blind.rom, out.join("blind-step3-t37.rom")).unwrap();
        report.insert(
            "builds".into(),
            json!({
                "original_t6": original.sha256,
                "sgdk_rebuilt_t12": sgdk12.sha256,
                "blind_step3_t37": blind.sha256,
            }),
        );

        // 2. Localizacao: varredura estrutural (sem simbolos), depois validada por simbolos.
        let score = original.symbols["logic_var_reference_score"];
        let open = original.symbols["logic_var_goal_open"];
        let candidates = rex_gameplay::scan_guarded_candidates(&original.bytes);
        println!("candidatos (original): {candidates:?}");
        assert_eq!(candidates.len(), 1, "exatamente um candidato com guarda");
        let cand = candidates[0].clone();
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

        // 3. Variante cega.
        let blind_cands = rex_gameplay::scan_guarded_candidates(&blind.bytes);
        println!("candidatos (cega): {blind_cands:?}");
        assert_eq!(blind_cands.len(), 1);
        let blind_rec = rex_gameplay::recover(
            &blind.bytes,
            blind_cands[0].entry,
            &[blind_cands[0].exit],
            &Hints::default(),
        )
        .expect("blind recover");
        let blind_step = blind_rec.rule.counter_add.as_ref().map(|a| a.step);
        assert_eq!(
            (blind_step, blind_rec.rule.compare.threshold),
            (Some(3), 37),
            "variante cega: passo e limiar recuperados batem com a fonte (validacao)"
        );
        assert_eq!(
            blind_rec.rule.compare.counter_addr,
            blind.symbols["logic_var_reference_score"]
        );
        report.insert(
            "blind_holdout".into(),
            json!({
                "entry": format!("0x{:06X}", blind_cands[0].entry),
                "exit": format!("0x{:06X}", blind_cands[0].exit),
                "step": blind_step, "threshold": blind_rec.rule.compare.threshold,
                "operator": blind_rec.rule.compare.operator.symbol(),
            }),
        );

        let mut emu = EmulatorCore::new(None);

        // 4. Equivalencia contra o oraculo independente: a ROM original executada pelo core,
        //    com estado injetado. Latencia de input medida num controle.
        let mut equivalence = Vec::new();
        for (label, built, recovery_rule) in [
            ("original_t6", &original, rule.clone()),
            ("blind_step3_t37", &blind, blind_rec.rule.clone()),
        ] {
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
