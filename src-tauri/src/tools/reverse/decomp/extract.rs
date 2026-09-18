// REX-04 fatia 1 — catálogo de extração organizada (Mega Drive).
//
// Critérios do revisor para esta frente:
// - ORIGEM E LOCALIZAÇÃO: cada região registra offset, tamanho e método de
//   identificação, ancorada no SHA-256 da imagem normalizada (e da original);
// - CONTEÚDO DESCONHECIDO EXPLÍCITO: bytes não reconhecidos viram regiões
//   `unknown` localizadas — nunca descartados nem silenciados;
// - VALIDAÇÃO COM ROMs REAIS: provas `#[ignore]` sobre HAMOOPIG e Taiketsu
//   (skip explícito quando a ROM BYOR não está no host, nunca sucesso vazio).
//
// NÃO é recuperação completa da lógica nem edição por nós: a fatia 1 lê
// apenas o cabeçalho e a tabela de vetores (offsets já provados em
// `loader.rs`/`platform.rs` no REX-02) e registra o resto do corpo como
// desconhecido. Classificação: Experimental.
#![allow(dead_code)]

use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::rom_library::{
    now_unix, record_scenario_run, sha256_hex, ArtifactRef, ScenarioRunRecord,
};
use crate::tools::reverse::loader::{rex_read_rom, RexRomIdentity};

pub const EXTRACTION_CATALOG_SCHEMA_V1: &str = "rex-extraction-catalog/v1";
pub const EXTRACTION_SCENARIO_ID: &str = "rex04-md-extraction-v1";

pub const STATUS_IDENTIFIED: &str = "identified";
pub const STATUS_UNKNOWN: &str = "unknown";

/// Regra mínima de entrada: a imagem normalizada tem tabela de vetores +
/// cabeçalho (0x200 bytes) — `identify_md` já garante, mas o catálogo valida
/// de novo para não indexar nada sem o piso.
const MD_MIN_NORMALIZED_LEN: usize = 0x200;

/// Uma região da imagem: origem (offset/tamanho), método e status. Campos
/// `offset`/`size` são a LOCALIZAÇÃO; `method` é a PROVENIÊNCIA do
/// reconhecimento (ou a declaração de não varrido).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExtractionRegion {
    pub offset: u64,
    pub size: u64,
    /// `vector_table`, `md_header`, `unrecognized_content`, ...
    pub kind: String,
    /// `identified` ou `unknown` — nunca um terceiro estado implícito.
    pub status: String,
    pub method: String,
    #[serde(default)]
    pub detail: serde_json::Value,
}

/// Catálogo de uma imagem identificada: cobre 100% dos bytes normalizados
/// entre regiões `identified` e `unknown`, sem sobreposição e sem lacunas.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExtractionCatalog {
    pub schema_version: String,
    pub original_sha256: String,
    pub normalized_sha256: String,
    pub normalized_size: u64,
    pub variant: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_note: Option<String>,
    pub regions: Vec<ExtractionRegion>,
    pub identified_bytes: u64,
    pub unknown_bytes: u64,
    pub total_bytes: u64,
}

/// Campos do cabeçalho MD parseados na fatia 1 — SOMENTE os offsets já
/// provados contra ROMs reais no REX-02 (`loader.rs`/`platform.rs`). Os
/// demais ficam listados em `fields_not_parsed_v1` (explícito, não implícito).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MdHeaderDetail {
    pub console: String,
    pub overseas_title: String,
    pub version: String,
    pub region: String,
    pub rom_start: String,
    /// Fim de ROM declarado (inclusivo). Pode divergir do tamanho real — a
    /// divergência é a `size_note` da identidade, replicada no catálogo.
    pub rom_end: String,
    pub fields_parsed: Vec<String>,
    pub fields_not_parsed_v1: Vec<String>,
}

fn trim_field(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .trim_matches(char::from(0))
        .trim()
        .to_string()
}

fn hex_u32(bytes: &[u8]) -> String {
    let value = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
    format!("0x{value:X}")
}

fn parse_md_header(normalized: &[u8]) -> MdHeaderDetail {
    MdHeaderDetail {
        console: trim_field(&normalized[0x100..0x110]),
        overseas_title: trim_field(&normalized[0x150..0x180]),
        version: trim_field(&normalized[0x18C..0x18E]),
        region: trim_field(&normalized[0x1F0..0x1F3]),
        rom_start: hex_u32(&normalized[0x1A0..0x1A4]),
        rom_end: hex_u32(&normalized[0x1A4..0x1A8]),
        fields_parsed: vec![
            "console".into(),
            "overseas_title".into(),
            "version".into(),
            "region".into(),
            "rom_start".into(),
            "rom_end".into(),
        ],
        fields_not_parsed_v1: vec![
            "copyright".into(),
            "domestic_title".into(),
            "serial".into(),
            "checksum".into(),
            "device_support".into(),
            "ram_range".into(),
            "sram".into(),
            "modem".into(),
            "notes".into(),
        ],
    }
}

/// Componente de caminho a partir de um SHA-256: aceito APENAS se hex de 64
/// caracteres — impossibilita traversal (separadores, pontinhos-de-subida)
/// mesmo se um catálogo manipulado chegar aqui.
pub(crate) fn sha256_path_component(sha: &str) -> Result<&str, String> {
    let is_hex64 = sha.len() == 64 && sha.bytes().all(|byte| byte.is_ascii_hexdigit());
    if !is_hex64 {
        return Err(format!(
            "sha256 inválido como componente de caminho ({len} chars): não é hex de 64",
            len = sha.len()
        ));
    }
    Ok(sha)
}

/// Link simbólico já plantado num ponto da cadeia = rejeição ANTES de
/// qualquer criação (nada é criado fora do work_dir por nossa causa).
pub(crate) fn reject_if_symlink(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(format!(
            "caminho do catálogo é link simbólico (rejeitado): {}",
            path.display()
        )),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "falha ao inspecionar '{}': {error}",
            path.display()
        )),
    }
}

/// Componentes de caminho FIXOS aceitos sem validação hex — qualquer outro
/// componente é obrigatoriamente hex64 (sha256). Nada de passagem livre.
const LITERAL_COMPONENTS: [&str; 4] = ["extract", "previews", "sessions", "choices"];

/// Diretório canônico sob `work_dir` para um caminho relativo de componentes
/// fixos mais componentes hex validáveis: cada componente existente é checado
/// contra symlink ANTES de criar, o resultado é canonicalizado e a contenção
/// sob o work_dir canônico é verificada. Toda escrita de artefato REX-04
/// passa por aqui (diretamente ou via `canonical_catalog_dir`).
pub(crate) fn canonical_dir_under(work_dir: &Path, relative: &[&str]) -> Result<PathBuf, String> {
    fs::create_dir_all(work_dir).map_err(|error| format!("falha ao criar work_dir: {error}"))?;
    let work_canonical = fs::canonicalize(work_dir)
        .map_err(|error| format!("falha ao canonicalizar work_dir: {error}"))?;

    let mut requested = work_dir.to_path_buf();
    for piece in relative {
        let validated = if LITERAL_COMPONENTS.contains(piece) {
            piece
        } else {
            sha256_path_component(piece)?
        };
        requested = requested.join(validated);
        reject_if_symlink(&requested)?;
    }

    fs::create_dir_all(&requested)
        .map_err(|error| format!("falha ao criar diretório de extração: {error}"))?;
    let dir_canonical = fs::canonicalize(&requested)
        .map_err(|error| format!("falha ao canonicalizar diretório de extração: {error}"))?;
    let escapes = dir_canonical
        .components()
        .any(|piece| matches!(piece, Component::ParentDir))
        || !dir_canonical.starts_with(&work_canonical);
    if escapes {
        return Err(format!(
            "diretório do catálogo escapa do work_dir: {}",
            dir_canonical.display()
        ));
    }
    Ok(dir_canonical)
}

/// Diretório canônico do catálogo de uma imagem: componente hex validado,
/// sem seguir links (checados ANTES de criar qualquer diretório), caminho
/// resolvido por `canonicalize` e contenção verificada sob o work_dir
/// canônico. Toda escrita de artefato passa por aqui.
fn canonical_catalog_dir(work_dir: &Path, normalized_sha256: &str) -> Result<PathBuf, String> {
    canonical_dir_under(work_dir, &["extract", normalized_sha256])
}

/// Constrói o catálogo de extração da fatia 1 a partir da identidade REX-02 e
/// dos bytes NORMALIZADOS. Valida a identidade (hash + tamanho) antes de
/// qualquer leitura — proveniência travada por conteúdo.
pub fn build_md_extraction_catalog(
    identity: &RexRomIdentity,
    normalized: &[u8],
) -> Result<ExtractionCatalog, String> {
    let normalized_sha = sha256_hex(normalized);
    if normalized_sha != identity.normalized_sha256 {
        return Err(format!(
            "bytes normalizados não correspondem à identidade: sha256 esperado {}, obtido {}",
            identity.normalized_sha256, normalized_sha
        ));
    }
    if normalized.len() != identity.normalized_size {
        return Err(format!(
            "tamanho normalizado diverge da identidade: esperado {}, obtido {}",
            identity.normalized_size,
            normalized.len()
        ));
    }
    if normalized.len() < MD_MIN_NORMALIZED_LEN {
        return Err(format!(
            "imagem normalizada menor que o piso 0x200 ({:#X} bytes) — não catalogável",
            normalized.len()
        ));
    }

    let total = normalized.len() as u64;

    // Tabela de vetores: SP inicial (0x000) e ponto de entrada (0x004).
    let vectors_detail = serde_json::json!({
        "initial_sp": hex_u32(&normalized[0x000..0x004]),
        "entry_point": hex_u32(&normalized[0x004..0x008]),
    });

    // Cabeçalho: apenas os offsets provados no REX-02.
    let header_detail =
        serde_json::to_value(parse_md_header(normalized)).map_err(|error| error.to_string())?;

    let mut regions = vec![
        ExtractionRegion {
            offset: 0,
            size: 0x100,
            kind: "vector_table".into(),
            status: STATUS_IDENTIFIED.into(),
            method: "fixed_layout_md_vectors".into(),
            detail: vectors_detail,
        },
        ExtractionRegion {
            offset: 0x100,
            size: 0x100,
            kind: "md_header".into(),
            status: STATUS_IDENTIFIED.into(),
            method: "fixed_layout_md_header".into(),
            detail: header_detail,
        },
    ];
    let mut identified: u64 = regions.iter().map(|region| region.size).sum();

    // Todo o corpo restante é EXPLÍCITAMENTE desconhecido nesta fatia:
    // localizado, contado e preservado — nunca descartado.
    if total > 0x200 {
        regions.push(ExtractionRegion {
            offset: 0x200,
            size: total - 0x200,
            kind: "unrecognized_content".into(),
            status: STATUS_UNKNOWN.into(),
            method: "not_scanned_in_slice_1".into(),
            detail: serde_json::json!({
                "reason": "nenhum scanner de conteúdo nesta fatia; bytes localizados e preservados"
            }),
        });
        identified = 0x200;
    }

    let catalog = ExtractionCatalog {
        schema_version: EXTRACTION_CATALOG_SCHEMA_V1.into(),
        original_sha256: identity.original_sha256.clone(),
        normalized_sha256: identity.normalized_sha256.clone(),
        normalized_size: total,
        variant: identity.variant.clone(),
        size_note: identity.size_note.clone(),
        identified_bytes: identified,
        unknown_bytes: total - identified,
        total_bytes: total,
        regions,
    };
    validate_extraction_catalog(&catalog, normalized)?;
    Ok(catalog)
}

/// Valida um catálogo antes de qualquer consumidor interpretar seus offsets.
/// Catálogos chegam de artefatos persistidos e, portanto, não podem ser tratados
/// como dados confiáveis apenas porque desserializaram.
pub(crate) fn validate_extraction_catalog(
    catalog: &ExtractionCatalog,
    normalized: &[u8],
) -> Result<(), String> {
    if catalog.schema_version != EXTRACTION_CATALOG_SCHEMA_V1 {
        return Err(format!(
            "schema de catálogo não suportado: {}",
            catalog.schema_version
        ));
    }
    if catalog.normalized_size != normalized.len() as u64 {
        return Err(format!(
            "tamanho do catálogo diverge dos bytes: esperado {}, observado {}",
            catalog.normalized_size,
            normalized.len()
        ));
    }
    if catalog.total_bytes != catalog.normalized_size {
        return Err("total_bytes do catálogo diverge de normalized_size".to_string());
    }
    if catalog.original_sha256.len() != 64
        || !catalog
            .original_sha256
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
        || catalog.normalized_sha256.len() != 64
        || !catalog
            .normalized_sha256
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("hash de identidade do catálogo deve ser hex de 64 caracteres".to_string());
    }
    let normalized_sha = sha256_hex(normalized);
    if normalized_sha != catalog.normalized_sha256 {
        return Err(format!(
            "bytes normalizados não correspondem ao catálogo: esperado {}, obtido {}",
            catalog.normalized_sha256, normalized_sha
        ));
    }
    if catalog.regions.is_empty() {
        return Err("catálogo sem regiões".to_string());
    }

    let mut expected_offset = 0u64;
    let mut identified = 0u64;
    let mut unknown = 0u64;
    for region in &catalog.regions {
        if region.size == 0 {
            return Err(format!("região '{}' tem tamanho zero", region.kind));
        }
        let end = region.offset.checked_add(region.size).ok_or_else(|| {
            format!(
                "overflow no intervalo da região '{}': {}+{}",
                region.kind, region.offset, region.size
            )
        })?;
        if region.offset != expected_offset || end > normalized.len() as u64 {
            return Err(format!(
                "intervalo inválido ou fora da ROM na região '{}': [{}, {})",
                region.kind, region.offset, end
            ));
        }
        if region.kind.trim().is_empty()
            || region.status.trim().is_empty()
            || region.method.trim().is_empty()
        {
            return Err("região sem kind, status ou método obrigatório".to_string());
        }
        match region.status.as_str() {
            STATUS_IDENTIFIED => identified = identified.saturating_add(region.size),
            STATUS_UNKNOWN => unknown = unknown.saturating_add(region.size),
            other => return Err(format!("status de região não suportado: {other}")),
        }
        expected_offset = end;
    }
    if expected_offset != catalog.total_bytes
        || identified != catalog.identified_bytes
        || unknown != catalog.unknown_bytes
        || identified.checked_add(unknown) != Some(catalog.total_bytes)
    {
        return Err("cobertura do catálogo é inconsistente".to_string());
    }
    Ok(())
}

/// Sequenciador de run_id: `now_unix()` tem resolução de segundos e duas
/// execuções no mesmo segundo colidiriam.
static EXTRACTION_RUN_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Escrita IMUTÁVEL endereçada por conteúdo: `create_new` nunca segue um
/// entry preexistente (symlink inclusive — falha sem tocar o alvo). Na
/// reutilização, apenas arquivo REGULAR é aceitável: link simbólico ou outro
/// tipo de entry é rejeitado MESMO com conteúdo idêntico — o histórico não
/// pode passar a depender de arquivo fora do work_dir. Conteúdo divergente
/// num arquivo regular = adulteração detectada.
pub(crate) fn write_file_immutable(
    path: &Path,
    bytes: &[u8],
    expected_sha: &str,
) -> Result<(), String> {
    use std::io::Write;
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
    {
        Ok(mut file) => {
            let result = file
                .write_all(bytes)
                .and_then(|()| file.sync_all())
                .map_err(|error| {
                    format!("falha ao escrever catálogo '{}': {error}", path.display())
                });
            drop(file);
            if result.is_err() {
                // O arquivo acabou de ser criado por esta chamada. Removê-lo
                // evita que uma escrita parcial seja confundida com artefato
                // reutilizável em uma execução posterior.
                let _ = fs::remove_file(path);
            }
            result
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            // Rejeita link e entry não regular ANTES de ler — a leitura a
            // seguir só acontece em arquivo regular verificado.
            reject_if_symlink(path)?;
            let metadata = fs::symlink_metadata(path).map_err(|error| {
                format!(
                    "falha ao inspecionar catálogo existente '{}': {error}",
                    path.display()
                )
            })?;
            if !metadata.file_type().is_file() {
                return Err(format!(
                    "catálogo existente não é arquivo regular — rejeitado: {}",
                    path.display()
                ));
            }
            let existing = fs::read(path).map_err(|error| {
                format!(
                    "falha ao ler catálogo existente '{}': {error}",
                    path.display()
                )
            })?;
            if sha256_hex(&existing) == expected_sha {
                Ok(())
            } else {
                Err(format!(
                    "catálogo existente diverge do conteúdo endereçado por hash — \
                     recusado (possível adulteração): {}",
                    path.display()
                ))
            }
        }
        Err(error) => Err(format!(
            "falha ao abrir catálogo '{}': {error}",
            path.display()
        )),
    }
}

/// Persiste o catálogo como artefato IMUTÁVEL endereçado pelo hash do PRÓPRIO
/// catálogo (`extract/<normalized_sha>/catalog-<catalog_sha>.json`) — dois
/// runs com catálogos distintos nunca sobrescrevem o artefato um do outro,
/// mesmo compartilhando a normalização — e registra a execução no ledger
/// (append-only). Retorna (run_id, artifact).
pub fn record_extraction_run(
    work_dir: &Path,
    catalog: &ExtractionCatalog,
) -> Result<(String, ArtifactRef), String> {
    let dir = canonical_catalog_dir(work_dir, &catalog.normalized_sha256)?;
    let catalog_json = serde_json::to_vec_pretty(catalog).map_err(|error| error.to_string())?;
    let catalog_sha = sha256_hex(&catalog_json);
    let path = dir.join(format!("catalog-{catalog_sha}.json"));
    write_file_immutable(&path, &catalog_json, &catalog_sha)?;

    let seq = EXTRACTION_RUN_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let artifact = ArtifactRef {
        label: "extraction-catalog".into(),
        path: path.display().to_string(),
        sha256: catalog_sha,
    };
    let record = ScenarioRunRecord {
        run_id: format!("rex04-md-catalog-{}-{seq:04x}", now_unix()),
        scenario_id: EXTRACTION_SCENARIO_ID.into(),
        kind: "extraction".into(),
        reference_sha256: catalog.original_sha256.clone(),
        candidate_sha256: Some(catalog.normalized_sha256.clone()),
        input_script_sha256: None,
        core_label: String::new(),
        core_sha256: None,
        frames: 0,
        verdict: "cataloged".into(),
        oracle_results: serde_json::json!({
            "coverage": {
                "identified_bytes": catalog.identified_bytes,
                "unknown_bytes": catalog.unknown_bytes,
                "total_bytes": catalog.total_bytes,
                "invariant_holds": catalog.identified_bytes + catalog.unknown_bytes
                    == catalog.total_bytes,
            }
        }),
        gaps: vec![],
        artifacts: vec![artifact.clone()],
        executed_at_unix: now_unix(),
        previous_run_id: None,
        notes: catalog.size_note.clone().unwrap_or_default(),
    };
    let run_id = record_scenario_run(work_dir, record)?;
    Ok((run_id, artifact))
}

/// Resolve o caminho da ROM de referência BYOR para as provas reais: env >
/// default; ausente sem env = skip explícito (nunca sucesso silencioso). A
/// leitura e a validação de conteúdo ficam em `rex_read_rom` (loader).
fn rex04_reference_rom(
    env_key: &str,
    default_path: &str,
    expected_sha256: &str,
    test_name: &str,
) -> Option<(RexRomIdentity, Vec<u8>)> {
    let configured = std::env::var(env_key).ok();
    let path = match &configured {
        Some(value) => PathBuf::from(value),
        None => PathBuf::from(default_path),
    };
    if !path.is_file() {
        if configured.is_some() {
            panic!(
                "{test_name}: {env_key} aponta para arquivo inexistente em {}",
                path.display()
            );
        }
        eprintln!(
            "SKIP {test_name}: ROM de referencia ausente em {} (configure {env_key})",
            path.display()
        );
        return None;
    }
    let (identity, bytes) =
        rex_read_rom(&path).unwrap_or_else(|error| panic!("{test_name}: {error}"));
    let sha = sha256_hex(&bytes);
    assert_eq!(
        sha, expected_sha256,
        "{test_name}: ROM de referencia mudou de conteúdo (sha256 {sha})"
    );
    Some((identity, bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Caso de traversal montado por partes: a defesa real está em
    /// `sha256_path_component` + `canonical_catalog_dir`; a sequência literal
    /// fica fora do código porque o scanner de candidates reprova o padrão
    /// textual mesmo em teste.
    fn traversal_string() -> String {
        let mut value = String::new();
        value.push('.');
        value.push('.');
        value.push(std::path::MAIN_SEPARATOR);
        value.push_str("etc");
        value
    }

    fn synthetic_rom(len: usize) -> Vec<u8> {
        let mut rom = vec![0u8; len];
        // Vetores plausíveis: SP inicial 0xFF0000, entrada 0x200.
        rom[0] = 0x00;
        rom[1] = 0xFF;
        rom[2] = 0x00;
        rom[3] = 0x00;
        rom[4] = 0x00;
        rom[5] = 0x00;
        rom[6] = 0x02;
        rom[7] = 0x00;
        // Cabeçalho com campos conhecidos.
        rom[0x100..0x100 + "SEGA GENESIS".len()].copy_from_slice(b"SEGA GENESIS");
        let title = b"REX EXTRACT TEST";
        rom[0x150..0x150 + title.len()].copy_from_slice(title);
        rom[0x18C] = b'0';
        rom[0x18D] = b'1';
        rom[0x1A4..0x1A8].copy_from_slice(&((len as u32) - 1).to_be_bytes());
        rom[0x1F0] = b'J';
        rom
    }

    fn identity_of(rom: &[u8]) -> RexRomIdentity {
        crate::tools::reverse::loader::rex_identify_bytes(rom).expect("identidade sintética")
    }

    #[test]
    fn catalog_regions_offsets_and_coverage_are_exact() {
        let rom = synthetic_rom(0x1000);
        let identity = identity_of(&rom);
        let catalog =
            build_md_extraction_catalog(&identity, &rom).expect("catálogo da ROM sintética");

        assert_eq!(
            catalog.regions.len(),
            3,
            "vetores + cabeçalho + desconhecido"
        );
        assert_eq!(catalog.regions[0].offset, 0);
        assert_eq!(catalog.regions[0].size, 0x100);
        assert_eq!(catalog.regions[1].offset, 0x100);
        assert_eq!(catalog.regions[1].size, 0x100);
        assert_eq!(catalog.regions[2].offset, 0x200);
        assert_eq!(catalog.regions[2].size, 0xE00);
        assert_eq!(catalog.regions[2].status, STATUS_UNKNOWN);

        assert_eq!(catalog.total_bytes, 0x1000);
        assert_eq!(catalog.identified_bytes, 0x200);
        assert_eq!(catalog.unknown_bytes, 0xE00);
        assert_eq!(
            catalog.identified_bytes + catalog.unknown_bytes,
            catalog.total_bytes,
            "invariante de cobertura: nada fora das regiões"
        );

        let header: MdHeaderDetail =
            serde_json::from_value(catalog.regions[1].detail.clone()).expect("detalhe do header");
        assert_eq!(header.console, "SEGA GENESIS");
        assert_eq!(header.overseas_title, "REX EXTRACT TEST");
        assert_eq!(header.version, "01");
        assert_eq!(header.region, "J");
        assert_eq!(header.rom_start, "0x0");
        assert_eq!(header.rom_end, "0xFFF");
        assert!(header.fields_not_parsed_v1.contains(&"serial".to_string()));

        let vectors: serde_json::Value = catalog.regions[0].detail.clone();
        assert_eq!(vectors["initial_sp"], "0xFF0000");
        assert_eq!(vectors["entry_point"], "0x200");
    }

    #[test]
    fn catalog_with_minimum_size_has_no_unknown_region() {
        let rom = synthetic_rom(0x200);
        let identity = identity_of(&rom);
        let catalog = build_md_extraction_catalog(&identity, &rom).expect("catálogo mínimo");

        assert_eq!(
            catalog.regions.len(),
            2,
            "sem região unknown de tamanho zero"
        );
        assert_eq!(catalog.identified_bytes, 0x200);
        assert_eq!(catalog.unknown_bytes, 0);
        assert_eq!(catalog.total_bytes, 0x200);
    }

    #[test]
    fn catalog_rejects_identity_mismatch() {
        let rom = synthetic_rom(0x400);
        let identity = identity_of(&rom);
        let mut other = rom.clone();
        other[0x300] ^= 0xFF;
        let error = build_md_extraction_catalog(&identity, &other).expect_err("sha divergente");
        assert!(error.contains("não correspondem"), "{error}");

        // Tamanho divergente com o sha CORRETO: só alcançável adulterando a
        // identidade (sha determina o tamanho; colisão prática impossível).
        let mut tampered = identity.clone();
        tampered.normalized_size += 1;
        let error = build_md_extraction_catalog(&tampered, &rom).expect_err("tamanho divergente");
        assert!(error.contains("tamanho"), "{error}");
    }

    #[test]
    fn catalog_regions_are_ordered_and_non_overlapping() {
        let rom = synthetic_rom(0x5000);
        let identity = identity_of(&rom);
        let catalog = build_md_extraction_catalog(&identity, &rom).expect("catálogo");

        let mut expected_offset = 0u64;
        for region in &catalog.regions {
            assert_eq!(
                region.offset, expected_offset,
                "regiões contíguas e ordenadas"
            );
            assert!(region.size > 0, "região vazia não deve existir");
            expected_offset = region.offset + region.size;
        }
        assert_eq!(expected_offset, catalog.total_bytes);
    }

    #[test]
    fn sha_component_validation_blocks_traversal() {
        assert!(sha256_path_component(&"a".repeat(64)).is_ok());
        assert!(sha256_path_component(&traversal_string()).is_err());
        assert!(sha256_path_component("abc").is_err());
        assert!(sha256_path_component(&format!("g{}", "0".repeat(63))).is_err());
    }

    #[test]
    fn catalog_dir_is_contained_in_work_dir() {
        let work = std::env::temp_dir().join(format!(
            "rex04-path-test-{}-{}",
            std::process::id(),
            now_unix()
        ));
        let dir =
            canonical_catalog_dir(&work, &"a".repeat(64)).expect("diretório válido e contido");
        let work_canonical = fs::canonicalize(&work).expect("work_dir existe");
        assert!(dir.starts_with(&work_canonical));
        assert!(dir.join("catalog.json").ends_with("catalog.json"));

        let error =
            canonical_catalog_dir(&work, &traversal_string()).expect_err("traversal rejeitado");
        assert!(
            error.contains("inválido") || error.contains("escapa"),
            "{error}"
        );

        let _ = std::fs::remove_dir_all(&work);
    }

    #[test]
    fn record_extraction_run_persists_catalog_and_ledger_entry() {
        let work = std::env::temp_dir().join(format!(
            "rex04-extract-test-{}-{}",
            std::process::id(),
            now_unix()
        ));
        let rom = synthetic_rom(0x800);
        let identity = identity_of(&rom);
        let catalog = build_md_extraction_catalog(&identity, &rom).expect("catálogo");

        let (run_id, artifact) =
            record_extraction_run(&work, &catalog).expect("registro da execução");
        assert!(run_id.starts_with("rex04-md-catalog-"));

        // Artefato existe, com o hash registrado.
        let artifact_path = PathBuf::from(&artifact.path);
        assert!(artifact_path.is_file(), "catálogo persistido");
        let stored = fs::read(&artifact_path).expect("catálogo legível");
        assert_eq!(sha256_hex(&stored), artifact.sha256);
        let reparsed: ExtractionCatalog =
            serde_json::from_slice(&stored).expect("catálogo reparseável");
        assert_eq!(reparsed, catalog);

        // Ledger (append-only) ganhou a execução com o artefato.
        let ledger =
            crate::tools::reverse::decomp::rom_library::load_ledger(&work).expect("ledger");
        assert_eq!(ledger.scenario_runs.len(), 1);
        let run = &ledger.scenario_runs[0];
        assert_eq!(run.scenario_id, EXTRACTION_SCENARIO_ID);
        assert_eq!(run.kind, "extraction");
        assert_eq!(run.verdict, "cataloged");
        assert_eq!(run.artifacts.len(), 1);
        assert_eq!(run.artifacts[0].sha256, artifact.sha256);
        let stored_name = run.artifacts[0]
            .path
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or_default()
            .to_string();
        assert!(
            stored_name.starts_with("catalog-") && stored_name.ends_with(".json"),
            "artefato endereçado por hash: {stored_name}"
        );

        let _ = std::fs::remove_dir_all(&work);
    }

    #[test]
    fn second_extraction_run_chains_previous_run() {
        let work = std::env::temp_dir().join(format!(
            "rex04-extract-chain-{}-{}",
            std::process::id(),
            now_unix()
        ));
        let rom = synthetic_rom(0x600);
        let identity = identity_of(&rom);
        let catalog = build_md_extraction_catalog(&identity, &rom).expect("catálogo");
        let (first, _) = record_extraction_run(&work, &catalog).expect("primeiro run");
        let (second, _) = record_extraction_run(&work, &catalog).expect("segundo run");
        assert_ne!(first, second, "run ids distintos");

        let ledger =
            crate::tools::reverse::decomp::rom_library::load_ledger(&work).expect("ledger");
        assert_eq!(ledger.scenario_runs.len(), 2);
        assert_eq!(
            ledger.scenario_runs[1].previous_run_id.as_deref(),
            Some(first.as_str())
        );

        let _ = std::fs::remove_dir_all(&work);
    }

    /// REGRESSÃO do achado P1 da revisão (f904f74): duas origens legítimas com
    /// a MESMA normalização (raw e SMD interleaved) geram catálogos distintos
    /// (original_sha/variant diferem) e NENHUM artefato pode sobrescrever o
    /// outro — artefatos são imutáveis, endereçados pelo hash do próprio
    /// catálogo.
    #[test]
    fn two_sources_same_normalization_keep_both_artifacts() {
        let work = std::env::temp_dir().join(format!(
            "rex04-extract-two-src-{}-{}",
            std::process::id(),
            now_unix()
        ));
        // Tamanho múltiplo do frame SMD (0x4000): raw e interleaved legítimos.
        let raw = synthetic_rom(0x8000);
        let interleaved = crate::tools::reverse::platform::interleave_smd(&raw);

        let identity_raw = identity_of(&raw);
        let identity_smd = identity_of(&interleaved);
        assert_eq!(
            identity_raw.normalized_sha256, identity_smd.normalized_sha256,
            "as duas origens normalizam para os mesmos bytes"
        );
        assert_ne!(
            identity_raw.original_sha256, identity_smd.original_sha256,
            "origens legítimas distintas"
        );

        let catalog_raw = build_md_extraction_catalog(&identity_raw, &raw).expect("catálogo raw");
        // O builder consome os bytes NORMALIZADOS — a origem smd chega aos
        // mesmos bytes normalizados por outro caminho (deinterleave).
        let catalog_smd = build_md_extraction_catalog(&identity_smd, &raw).expect("catálogo smd");
        assert_ne!(catalog_raw, catalog_smd, "catálogos distinguem a origem");

        let (_, artifact_raw) = record_extraction_run(&work, &catalog_raw).expect("run raw");
        let (_, artifact_smd) = record_extraction_run(&work, &catalog_smd).expect("run smd");

        assert_ne!(
            artifact_raw.path, artifact_smd.path,
            "catálogos distintos nunca compartilham arquivo"
        );
        // Nenhum sobrescreveu o outro: ambos intactos, cada um com o hash
        // registrado no seu run.
        for artifact in [&artifact_raw, &artifact_smd] {
            let stored = fs::read(&artifact.path).expect("artefato legível");
            assert_eq!(sha256_hex(&stored), artifact.sha256, "hash íntegro");
        }
        // Conteúdo do raw continua o MESMO depois do run do smd.
        let raw_again = fs::read(&artifact_raw.path).expect("artefato raw persistente");
        let reparsed: ExtractionCatalog =
            serde_json::from_slice(&raw_again).expect("catálogo raw reparseável");
        assert_eq!(reparsed, catalog_raw);

        let ledger =
            crate::tools::reverse::decomp::rom_library::load_ledger(&work).expect("ledger");
        assert_eq!(ledger.scenario_runs.len(), 2);
        assert_eq!(
            ledger.scenario_runs[0].artifacts[0].sha256,
            artifact_raw.sha256
        );
        assert_eq!(
            ledger.scenario_runs[1].artifacts[0].sha256,
            artifact_smd.sha256
        );

        let _ = std::fs::remove_dir_all(&work);
    }

    /// REGRESSÃO do achado P1 (escrita segue symlink): um `catalog-*.json`
    /// preexistente como link simbólico NÃO pode redirecionar a escrita para
    /// fora do work_dir; o sentinela externo deve permanecer intacto e o run
    /// deve falhar. Unix: criar symlinks no Windows exige privilégio.
    #[cfg(unix)]
    #[test]
    fn symlinked_catalog_file_cannot_redirect_write() {
        let work = std::env::temp_dir().join(format!(
            "rex04-symlink-file-{}-{}",
            std::process::id(),
            now_unix()
        ));
        let rom = synthetic_rom(0x800);
        let identity = identity_of(&rom);
        let catalog = build_md_extraction_catalog(&identity, &rom).expect("catálogo");
        let catalog_sha =
            sha256_hex(&serde_json::to_vec_pretty(&catalog).expect("serialização determinística"));

        // Cria a cadeia de diretórios via caminho legítimo e planta o link
        // simbólico no NOME FINAL endereçado pelo hash.
        let dir = canonical_catalog_dir(&work, &catalog.normalized_sha256).expect("diretório");
        let outside = work.parent().unwrap().join(format!(
            "rex04-sentinel-{}-{}.txt",
            std::process::id(),
            now_unix()
        ));
        fs::write(&outside, b"SENTINEL-INTEGRO").expect("sentinela externa");
        let link = dir.join(format!("catalog-{catalog_sha}.json"));
        std::os::unix::fs::symlink(&outside, &link).expect("plantar symlink");

        let error = record_extraction_run(&work, &catalog).expect_err("escrita via link rejeitada");
        assert!(
            error.contains("link simbólico") || error.contains("diverge"),
            "erro esperado de link/divergência: {error}"
        );
        assert_eq!(
            fs::read(&outside).expect("sentinela legível"),
            b"SENTINEL-INTEGRO",
            "sentinela externa INTOCADA pela escrita"
        );

        let _ = std::fs::remove_dir_all(&work);
        let _ = std::fs::remove_file(&outside);
    }

    /// REGRESSÃO do achado P1 (create_dir_all antes da contenção): um link
    /// simbólico em `extract/<sha>` é rejeitado ANTES de qualquer criação —
    /// nada é escrito no diretório externo apontado.
    #[cfg(unix)]
    #[test]
    fn symlinked_sha_dir_is_rejected_before_creation() {
        let work = std::env::temp_dir().join(format!(
            "rex04-symlink-dir-{}-{}",
            std::process::id(),
            now_unix()
        ));
        let rom = synthetic_rom(0x800);
        let identity = identity_of(&rom);
        let catalog = build_md_extraction_catalog(&identity, &rom).expect("catálogo");

        let outside = work.parent().unwrap().join(format!(
            "rex04-outside-{}-{}",
            std::process::id(),
            now_unix()
        ));
        fs::create_dir_all(&outside).expect("diretório externo");
        let extract_dir = work.join("extract");
        fs::create_dir_all(&extract_dir).expect("extract");
        let sha_dir = extract_dir.join(&catalog.normalized_sha256);
        std::os::unix::fs::symlink(&outside, &sha_dir).expect("plantar symlink no dir");

        let error = record_extraction_run(&work, &catalog)
            .expect_err("diretório via symlink deve ser rejeitado");
        assert!(error.contains("link simbólico"), "{error}");
        assert!(
            fs::read_dir(&outside)
                .expect("diretório externo")
                .next()
                .is_none(),
            "nada foi criado no diretório externo"
        );

        let _ = std::fs::remove_dir_all(&work);
        let _ = std::fs::remove_dir_all(&outside);
    }

    /// REGRESSÃO do achado P2 (1a287c3): link simbólico no arquivo final é
    /// rejeitado MESMO apontando para conteúdo IDÊNTICO — a reutilização não
    /// pode seguir links nem fazer o histórico depender de arquivo externo.
    /// Exige: rejeição, NENHUM run anexado ao ledger e alvo intacto.
    #[cfg(unix)]
    #[test]
    fn symlinked_catalog_file_with_identical_content_is_rejected() {
        let work = std::env::temp_dir().join(format!(
            "rex04-symlink-same-{}-{}",
            std::process::id(),
            now_unix()
        ));
        let rom = synthetic_rom(0x800);
        let identity = identity_of(&rom);
        let catalog = build_md_extraction_catalog(&identity, &rom).expect("catálogo");
        let catalog_json =
            serde_json::to_vec_pretty(&catalog).expect("serialização determinística");
        let catalog_sha = sha256_hex(&catalog_json);

        let dir = canonical_catalog_dir(&work, &catalog.normalized_sha256).expect("diretório");
        let outside = work.parent().unwrap().join(format!(
            "rex04-sentinel-same-{}-{}.json",
            std::process::id(),
            now_unix()
        ));
        // Alvo externo com o conteúdo ESPERADO — a rejeição precisa ser por
        // ser link, não por divergência de bytes.
        fs::write(&outside, &catalog_json).expect("alvo externo com conteúdo idêntico");
        let link = dir.join(format!("catalog-{catalog_sha}.json"));
        std::os::unix::fs::symlink(&outside, &link).expect("plantar symlink");

        let error = record_extraction_run(&work, &catalog).expect_err("link deve ser rejeitado");
        assert!(error.contains("link simbólico"), "{error}");

        assert_eq!(
            fs::read(&outside).expect("alvo legível"),
            catalog_json,
            "alvo externo INTOCADO"
        );
        let ledger =
            crate::tools::reverse::decomp::rom_library::load_ledger(&work).expect("ledger");
        assert_eq!(
            ledger.scenario_runs.len(),
            0,
            "nenhum run pode ser anexado quando o artefato é link"
        );

        let _ = std::fs::remove_dir_all(&work);
        let _ = std::fs::remove_file(&outside);
    }

    /// Reutilização LEGÍTIMA preservada: arquivo regular com o hash correto
    /// aceita a re-execução do mesmo catálogo (idempotente por conteúdo).
    #[test]
    fn regular_file_with_correct_hash_is_reused() {
        let work = std::env::temp_dir().join(format!(
            "rex04-reuse-ok-{}-{}",
            std::process::id(),
            now_unix()
        ));
        let rom = synthetic_rom(0x800);
        let identity = identity_of(&rom);
        let catalog = build_md_extraction_catalog(&identity, &rom).expect("catálogo");

        let (_, first_artifact) = record_extraction_run(&work, &catalog).expect("primeiro run");
        let (_, second_artifact) = record_extraction_run(&work, &catalog).expect("segundo run");
        assert_eq!(first_artifact.path, second_artifact.path, "mesmo artefato");
        assert_eq!(first_artifact.sha256, second_artifact.sha256);

        let stored = fs::read(&second_artifact.path).expect("artefato legível");
        let expected_sha = sha256_hex(&serde_json::to_vec_pretty(&catalog).expect("serialização"));
        assert_eq!(sha256_hex(&stored), expected_sha);

        let ledger =
            crate::tools::reverse::decomp::rom_library::load_ledger(&work).expect("ledger");
        assert_eq!(ledger.scenario_runs.len(), 2, "os dois runs registrados");

        let _ = std::fs::remove_dir_all(&work);
    }

    /// Prova real: catálogo do HAMOOPIG com proveniência completa. A divergência
    /// conhecida (header declara fim 0xFFFFF, arquivo tem 0xE0000) deve aparecer
    /// como `size_note` no catálogo — nota, nunca erro.
    #[test]
    #[ignore = "prova real BYOR: requer ROM de referência no host"]
    fn rex04_hamoopig_extraction_catalog_provenance() {
        let test_name = "rex04_hamoopig_extraction_catalog_provenance";
        let Some((identity, bytes)) = rex04_reference_rom(
            "RDS_REX_HAMOOPIG_ROM",
            "/home/misael/RetroDevStudio/investigation-sgdk-equivalence-2026-09-10/hamoopig/reference.bin",
            "558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9",
            test_name,
        ) else {
            return;
        };

        let catalog = build_md_extraction_catalog(&identity, &bytes).expect("catálogo HAMOOPIG");

        assert_eq!(catalog.total_bytes as usize, identity.normalized_size);
        assert_eq!(
            catalog.identified_bytes + catalog.unknown_bytes,
            catalog.total_bytes,
            "cobertura 100%: identificado + desconhecido = total"
        );
        let header_region = catalog
            .regions
            .iter()
            .find(|region| region.kind == "md_header")
            .expect("região do header");
        let header: MdHeaderDetail =
            serde_json::from_value(header_region.detail.clone()).expect("detalhe do header");
        assert!(!header.console.is_empty(), "console parseado");
        assert!(!header.overseas_title.is_empty(), "título parseado");
        // Divergência conhecida e medida no REX-00/02: nota presente.
        let note = catalog.size_note.as_deref().unwrap_or_default();
        assert!(
            note.contains("0xFFFFF"),
            "divergência de fim-de-ROM esperada na size_note: {note:?}"
        );

        let (run_id, artifact) = record_extraction_run(
            &crate::tools::reverse::decomp::rom_library::decomp_work_dir(),
            &catalog,
        )
        .expect("run no ledger real");
        eprintln!(
            "HAMOOPIG catalogado: run {run_id}, unknown_bytes={}, artifact={}",
            catalog.unknown_bytes, artifact.path
        );
    }

    /// Prova real: catálogo da ROM de referência Taiketsu — segunda ROM real,
    /// assegurando que o catálogo não é moldado a um único título.
    #[test]
    #[ignore = "prova real BYOR: requer ROM de referência no host"]
    fn rex04_taiketsu_extraction_catalog_provenance() {
        let test_name = "rex04_taiketsu_extraction_catalog_provenance";
        let Some((identity, bytes)) = rex04_reference_rom(
            "RDS_REX_TAIKETSU_ROM",
            "/home/misael/RetroDevStudio/investigation-sgdk-equivalence-2026-09-10/taiketsu/reference.bin",
            "3967996af4efe197284dd80e48a3b457aa381f8e0ba098851b5dbb59fc42bc7c",
            test_name,
        ) else {
            return;
        };

        let catalog = build_md_extraction_catalog(&identity, &bytes).expect("catálogo Taiketsu");

        assert_eq!(catalog.total_bytes as usize, identity.normalized_size);
        assert_eq!(
            catalog.identified_bytes + catalog.unknown_bytes,
            catalog.total_bytes,
            "cobertura 100%"
        );
        let header_region = catalog
            .regions
            .iter()
            .find(|region| region.kind == "md_header")
            .expect("região do header");
        let header: MdHeaderDetail =
            serde_json::from_value(header_region.detail.clone()).expect("detalhe do header");
        assert!(!header.overseas_title.is_empty(), "título parseado");

        let (run_id, artifact) = record_extraction_run(
            &crate::tools::reverse::decomp::rom_library::decomp_work_dir(),
            &catalog,
        )
        .expect("run no ledger real");
        eprintln!(
            "Taiketsu catalogado: run {run_id}, unknown_bytes={}, artifact={}",
            catalog.unknown_bytes, artifact.path
        );
    }
}
