//! Adaptador REX-05 — superfície de endereçamento do produto.
//!
//! A biblioteca `rex-addressing` (`crates/rex-addressing`) permanece sem Tauri e
//! sem serde: quem conhece o formato do produto é este módulo. A serialização,
//! a tradução de erros e a verificação de identidade na fronteira de acesso aos
//! bytes ficam aqui.

use serde::{Deserialize, Serialize};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use rex_addressing::resource::{
    read_resource, ImageIdentity, Limits, Profile, ResourceError, ResourceErrorCode,
    ResourceRequest,
};
use rex_addressing::state::{MapperState, Value};

use super::inspection::InspectionError;
use crate::core::rom_mastering::sha256_hex;
use crate::tools::reverse::loader::rex_read_rom;

/// Perfis que ESTA chamada expõe. `rex-addressing` implementa cinco; a fronteira
/// de identidade deste produto (`rex_read_rom` → `identify_md`) só atesta
/// imagens Mega Drive, então expor um perfil SNES por aqui seria alegar uma
/// verificação de identidade que não existe. Os demais ficam declarados como
/// não expostos — nunca selecionados em silêncio.
const PERFIS_EXPOSTOS: [Profile; 2] = [Profile::MdLinear, Profile::MdSsf2];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct SnapshotReadRequest {
    pub rom_path: String,
    pub expected_sha256: String,
    pub profile: String,
    pub mapper_state: serde_json::Value,
    pub cpu_address: u32,
    pub length: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct SnapshotReadResult {
    pub profile: String,
    pub contract_version: u32,
    /// Orixe inmutable da imaxe: caminho + digest. O núcleo recusa origem vazia.
    pub origin: String,
    pub image_sha256: String,
    pub image_len: u64,
    pub mapper_state: serde_json::Value,
    pub cpu_address: u32,
    pub length: u32,
    pub max_bytes: u32,
    pub max_segments: u32,
    pub segments: Vec<SegmentRead>,
    pub bytes_base64: String,
    pub bytes_sha256: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct SegmentRead {
    pub index: u32,
    pub cpu_address: u32,
    pub cpu_len: u32,
    pub rom_offset: u32,
    pub region: String,
    pub state: serde_json::Value,
}

fn fail(code: &str, message: impl Into<String>, retryable: bool) -> InspectionError {
    InspectionError {
        code: code.to_string(),
        message: message.into(),
        retryable,
    }
}

/// Tradução 1:1 dos códigos do núcleo para a convenção `snake_case` do produto.
/// O detalhe útil nunca se descarta: ver `erro_do_nucleo_preserva_codigo_e_detalle_util`.
fn codigo_de_nucleo(code: ResourceErrorCode) -> &'static str {
    match code {
        ResourceErrorCode::BadAttestation => "bad_attestation",
        ResourceErrorCode::BadState => "bad_state",
        ResourceErrorCode::InvalidRange => "invalid_range",
        ResourceErrorCode::IncompatibleSize => "incompatible_size",
        ResourceErrorCode::LimitExceeded => "limit_exceeded",
        ResourceErrorCode::NonRomRegion => "non_rom_region",
        ResourceErrorCode::Ambiguous => "ambiguous",
    }
}

fn erro_de_nucleo(perfil: &str, err: ResourceError) -> InspectionError {
    let mut message = err.detail;
    // O perfil declarado viaxa sempre no erro: os detalles do núcleo non o
    // citan todos (o de intervalo, por exemplo), e un erro sen perfil non se
    // pode atribuír a unha das súas regras.
    message.push_str(&format!(" — perfil '{perfil}'"));
    if let Some(address) = err.address {
        message.push_str(&format!(" (enderezo {address:#x})"));
    }
    if let Some(region) = err.region {
        message.push_str(&format!(" — rexión non-ROM: {}", region.as_str()));
    }
    if !err.segments.is_empty() {
        message.push_str(&format!(
            " — {} corredor(es) lidos antes da recusa",
            err.segments.len()
        ));
    }
    fail(codigo_de_nucleo(err.code), message, false)
}

/// O perfil é sempre escolha da chamante: nada aqui adivinha por tamanho,
/// banner ou endereçamento.
fn resolver_perfil(id: &str) -> Result<Profile, InspectionError> {
    let conhecidos = Profile::all();
    let Some(profile) = conhecidos.iter().copied().find(|p| p.id() == id) else {
        let expostos: Vec<&str> = PERFIS_EXPOSTOS.iter().copied().map(Profile::id).collect();
        return Err(fail(
            "profile_unknown",
            format!(
                "perfil '{id}' non existe en rex-addressing. expostos nesta chamada: {}",
                expostos.join(", ")
            ),
            false,
        ));
    };
    if !PERFIS_EXPOSTOS.contains(&profile) {
        return Err(fail(
            "profile_not_exposed",
            format!(
                "perfil '{id}' está implementado na biblioteca, pero aínda non o expón esta \
                 chamada: a fronteira de identidade deste produto só atesta imágenes Mega Drive. \
                 Expostos: {}",
                PERFIS_EXPOSTOS
                    .iter()
                    .copied()
                    .map(Profile::id)
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
            false,
        ));
    }
    Ok(profile)
}

/// JSON → estado do mapper. A capa non inventa conversións: un número escrito
/// con fracción ou expoñente chega como `NonInteger` co texto cru (que é o que o
/// núcleo rexeita, non o que o adaptador redondea), e un array non ten
/// representación no contrato, polo que se recusa en vez de aplanar.
fn estado_de_json(json: &serde_json::Value) -> Result<MapperState, InspectionError> {
    let serde_json::Value::Object(mapa) = json else {
        return Err(fail(
            "mapper_state_invalid",
            format!(
                "mapper_state debe ser un obxecto chave->valor explícito, atopado {}",
                nome_de_tipo(json)
            ),
            false,
        ));
    };
    Ok(MapperState::from_entries(entradas_de_objeto(mapa)?))
}

fn nome_de_tipo(valor: &serde_json::Value) -> &'static str {
    match valor {
        serde_json::Value::Null => "null",
        serde_json::Value::Bool(_) => "booleano",
        serde_json::Value::Number(_) => "número",
        serde_json::Value::String(_) => "texto",
        serde_json::Value::Array(_) => "array",
        serde_json::Value::Object(_) => "obxecto",
    }
}

fn entradas_de_objeto(
    mapa: &serde_json::Map<String, serde_json::Value>,
) -> Result<Vec<(String, Value)>, InspectionError> {
    let mut saida = Vec::with_capacity(mapa.len());
    for (chave, valor) in mapa {
        let convertido = match valor {
            serde_json::Value::Null => Value::Null,
            serde_json::Value::Bool(b) => Value::Bool(*b),
            serde_json::Value::Number(n) if n.is_u64() => {
                Value::Uint(n.as_u64().unwrap_or_default())
            }
            serde_json::Value::Number(n) if n.is_i64() => {
                Value::Int(n.as_i64().unwrap_or_default())
            }
            serde_json::Value::Number(n) => Value::NonInteger(n.to_string()),
            serde_json::Value::String(s) => Value::Text(s.clone()),
            serde_json::Value::Array(_) => {
                return Err(fail(
                    "mapper_state_invalid",
                    format!(
                        "mapper_state.{chave}: o contrato do núcleo non ten arrays; non se \
                         aplanan nin se lles inventa representación"
                    ),
                    false,
                ));
            }
            serde_json::Value::Object(o) => Value::Object(entradas_de_objeto(o)?),
        };
        saida.push((chave.clone(), convertido));
    }
    Ok(saida)
}

/// Estado do mapper → JSON, para devolver a procedência de cada corredor.
fn estado_a_json(state: &MapperState) -> serde_json::Value {
    let mut mapa = serde_json::Map::new();
    for chave in state.keys() {
        if let Some(valor) = state.get(chave) {
            mapa.insert(chave.clone(), valor_a_json(valor));
        }
    }
    serde_json::Value::Object(mapa)
}

fn valor_a_json(valor: &Value) -> serde_json::Value {
    match valor {
        Value::Null => serde_json::Value::Null,
        Value::Bool(b) => serde_json::Value::Bool(*b),
        Value::Uint(n) => serde_json::Value::Number((*n).into()),
        Value::Int(n) => serde_json::Value::Number((*n).into()),
        // Inalcançable nunha lectura exitosa (o núcleo rexeita este estado).
        // Devólvese como texto cru, sen converter, para non disfrazar no eco
        // un número non enteiro de enteiro.
        Value::NonInteger(texto) => serde_json::Value::String(texto.clone()),
        Value::Text(texto) => serde_json::Value::String(texto.clone()),
        Value::Object(entradas) => {
            let mut mapa = serde_json::Map::new();
            for (chave, valor) in entradas {
                mapa.insert(chave.clone(), valor_a_json(valor));
            }
            serde_json::Value::Object(mapa)
        }
    }
}

/// Leitura com estado fixo: um snapshot do mapper, nenhum passo de escrita.
/// As transições de banco (`read_sequence`) seguem sendo outra operação e **não
/// são expostas por esta chamada**.
pub fn read_fixed_snapshot(
    req: &SnapshotReadRequest,
) -> Result<SnapshotReadResult, InspectionError> {
    let profile = resolver_perfil(&req.profile)?;
    let state = estado_de_json(&req.mapper_state)?;

    // Fronteira de acceso aos bytes: nada se percorre antes de conferir que o
    // arquivo é a ROM que a chamante declara. A identidade é a ORIGINAL (a que
    // a UI pinha); a imaxe que se entrega ao núcleo é a normalizada, atestada
    // polo digest recalculado aquí sobre o buffer real.
    let (identity, raw) =
        rex_read_rom(std::path::Path::new(&req.rom_path)).map_err(|e| fail("rom_read", e, true))?;
    if identity.original_sha256 != req.expected_sha256 {
        return Err(fail(
            "rom_identity_mismatch",
            format!(
                "ROM base mudou: esperado {}, atual {}. Nada foi percorrido pola capa de \
                 enderezamento.",
                req.expected_sha256, identity.original_sha256
            ),
            false,
        ));
    }
    let (_, image_bytes) = crate::tools::reverse::platform::identify_md(&raw)
        .map_err(|e| fail("rom_identity", e.message(), false))?;
    let image_sha256 = sha256_hex(&image_bytes);
    let origin = format!("{}#sha256={image_sha256}", req.rom_path);
    let limits = Limits::DEFAULT;

    let pedido = ResourceRequest {
        profile,
        image: ImageIdentity {
            origin: origin.clone(),
            sha256_hex: image_sha256.clone(),
            byte_len: image_bytes.len() as u64,
        },
        state: &state,
        cpu_address: req.cpu_address,
        length: req.length,
        limits,
    };
    let lectura =
        read_resource(&pedido, &image_bytes).map_err(|e| erro_de_nucleo(profile.id(), e))?;

    Ok(SnapshotReadResult {
        profile: lectura.profile.to_string(),
        contract_version: lectura.contract_version,
        origin,
        image_sha256,
        image_len: image_bytes.len() as u64,
        mapper_state: estado_a_json(&state),
        cpu_address: lectura.cpu_address,
        length: lectura.length,
        max_bytes: limits.max_bytes,
        max_segments: limits.max_segments,
        segments: lectura
            .segments
            .into_iter()
            .map(|segmento| SegmentRead {
                index: segmento.index,
                cpu_address: segmento.cpu_address,
                cpu_len: segmento.cpu_len,
                rom_offset: segmento.rom_offset,
                region: segmento.region.as_str().to_string(),
                state: estado_a_json(&segmento.state),
            })
            .collect(),
        bytes_base64: BASE64.encode(&lectura.bytes),
        bytes_sha256: sha256_hex(&lectura.bytes),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine};

    const SSF2_SIZE: usize = 0x10_0000; // 1 MiB
    const LINEAR_SIZE: usize = 0x8_0000; // 512 KiB

    fn splitmix64(seed: u64) -> u64 {
        let mut z = seed;
        z = (z ^ (z >> 30)).wrapping_mul(0x9E37_79B9_7F4A_7C15);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Imagem autoral determinística (SplitMix64) com header SEGA no lugar
    /// canônico. Não é ROM comercial: o fixture é deste teste e só dele.
    fn rom_autoral(size: usize) -> Vec<u8> {
        assert!(size >= 0x200);
        let mut image: Vec<u8> = (0..size as u64)
            .map(|i| (splitmix64(i) & 0xFF) as u8)
            .collect();
        image[0x100..0x104].copy_from_slice(b"SEGA");
        image
    }

    fn sha256(bytes: &[u8]) -> String {
        crate::core::rom_mastering::sha256_hex(bytes)
    }

    fn dir_temporal(tag: &str, image: &[u8]) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("rds-rex-addressing-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("dir temporário");
        std::fs::write(dir.join("rom.bin"), image).expect("escrever ROM autoral");
        dir
    }

    /// Pedido con fixture temporal propia: ao saír do alcance (incluído o
    /// desenrollado dunha aserción fallida) bórrase o directorio, para que a
    /// suite non deixe 512 KiB–1 MiB por test en `/tmp`.
    struct RomTemp {
        req: SnapshotReadRequest,
        dir: std::path::PathBuf,
    }

    impl std::ops::Deref for RomTemp {
        type Target = SnapshotReadRequest;
        fn deref(&self) -> &Self::Target {
            &self.req
        }
    }

    impl std::ops::DerefMut for RomTemp {
        fn deref_mut(&mut self) -> &mut Self::Target {
            &mut self.req
        }
    }

    impl Drop for RomTemp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    fn pedido(
        tag: &str,
        image: &[u8],
        profile: &str,
        mapper_state: serde_json::Value,
        cpu_address: u32,
        length: u32,
    ) -> RomTemp {
        let dir = dir_temporal(tag, image);
        RomTemp {
            req: SnapshotReadRequest {
                rom_path: dir.join("rom.bin").to_str().expect("utf-8").to_string(),
                expected_sha256: sha256(image),
                profile: profile.to_string(),
                mapper_state,
                cpu_address,
                length,
            },
            dir,
        }
    }

    fn estado(size: u64, banks: Vec<(&str, u64)>) -> serde_json::Value {
        let mut map = serde_json::Map::new();
        map.insert("rom_size".to_string(), serde_json::json!(size));
        if !banks.is_empty() {
            let mut b = serde_json::Map::new();
            for (k, v) in banks {
                b.insert(k.to_string(), serde_json::json!(v));
            }
            map.insert("banks".to_string(), serde_json::Value::Object(b));
        }
        serde_json::Value::Object(map)
    }

    #[test]
    fn a_imaxe_autoral_congelase_no_digest_pinado() {
        // Congelar o fixture: se o construtor mudar em silêncio, as expectativas
        // de bytes abaixo deixam de ser a mesma observação. Os dois digestos
        // foram conferidos por uma implementação independente do construtor
        // (Node/`node:crypto` sobre o mesmo SplitMix64), não só pelo Rust.
        assert_eq!(
            sha256(&rom_autoral(SSF2_SIZE)),
            "949c4f01ad6cbbb2f9298b7c69fa735fcfd091943af942ef5cac0c4c5b480132",
            "fixture SSF2 mudou"
        );
        assert_eq!(
            sha256(&rom_autoral(LINEAR_SIZE)),
            "73cd2356f3054d8169810915d4c1aa4d17c1a97a86a1a606e834e50e14adb75f",
            "fixture linear mudou"
        );
    }

    #[test]
    fn leitura_autoral_devolve_os_bytes_e_a_procedencia_de_cada_segmento() {
        let image = rom_autoral(SSF2_SIZE);
        let req = pedido(
            "segmentos",
            &image,
            "md-ssf2",
            estado(SSF2_SIZE as u64, vec![("1", 0)]),
            0x00_7FFF0,
            32,
        );
        let out = read_fixed_snapshot(&req).expect("leitura");
        assert_eq!(out.profile, "md-ssf2");
        assert_eq!(out.cpu_address, 0x00_7FFF0);
        assert_eq!(out.length, 32);
        assert_eq!(out.image_len, SSF2_SIZE as u64);
        assert_eq!(out.image_sha256, sha256(&image));
        assert_eq!(out.segments.len(), 2, "a xanela 1 está remapeada: {out:?}");
        assert_eq!(
            (
                out.segments[0].index,
                out.segments[0].cpu_address,
                out.segments[0].cpu_len,
                out.segments[0].rom_offset,
                out.segments[0].region.as_str()
            ),
            (0, 0x00_7FFF0, 16, 0x00_7FFF0, "rom"),
            "segmento 0: {:#?}",
            out.segments[0]
        );
        assert_eq!(
            (
                out.segments[1].index,
                out.segments[1].cpu_address,
                out.segments[1].cpu_len,
                out.segments[1].rom_offset,
                out.segments[1].region.as_str()
            ),
            (1, 0x00_80000, 16, 0x00_00000, "rom"),
            "segmento 1: {:#?}",
            out.segments[1]
        );
        let bytes = BASE64.decode(&out.bytes_base64).expect("base64");
        assert_eq!(bytes.len(), 32);
        assert_eq!(&bytes[0..16], &image[0x00_7FFF0..0x00_80000]);
        assert_eq!(&bytes[16..32], &image[0x00_00000..0x00_00010]);
        assert_eq!(out.bytes_sha256, sha256(&bytes));
    }

    #[test]
    fn cada_segmento_leva_o_estado_com_que_foi_lido() {
        let image = rom_autoral(SSF2_SIZE);
        let estado_pedido = estado(SSF2_SIZE as u64, vec![("1", 0)]);
        let req = pedido(
            "estado-por-segmento",
            &image,
            "md-ssf2",
            estado_pedido.clone(),
            0x00_7FFF0,
            32,
        );
        let out = read_fixed_snapshot(&req).expect("leitura");
        assert_eq!(out.mapper_state, estado_pedido, "o estado vixente");
        for seg in &out.segments {
            assert_eq!(
                seg.state,
                estado(SSF2_SIZE as u64, vec![("1", 0)]),
                "segmento {} sem o estado que produziu o corredor",
                seg.index
            );
        }
    }

    #[test]
    fn cambiar_o_banco_move_a_xanela_esperada() {
        let image = rom_autoral(SSF2_SIZE);
        let identidade = estado(SSF2_SIZE as u64, vec![]);
        let remapeado = estado(SSF2_SIZE as u64, vec![("1", 0)]);
        let antes = read_fixed_snapshot(&pedido(
            "banco-antes",
            &image,
            "md-ssf2",
            identidade,
            0x00_80000,
            16,
        ))
        .expect("lectura");
        let depois = read_fixed_snapshot(&pedido(
            "banco-despois",
            &image,
            "md-ssf2",
            remapeado,
            0x00_80000,
            16,
        ))
        .expect("lectura");
        assert_eq!(antes.segments[0].rom_offset, 0x00_80000);
        assert_eq!(depois.segments[0].rom_offset, 0x00_00000);
        let a = BASE64.decode(&antes.bytes_base64).expect("base64");
        let d = BASE64.decode(&depois.bytes_base64).expect("base64");
        assert_eq!(&a[..], &image[0x00_80000..0x00_80010]);
        assert_eq!(&d[..], &image[0x00_00000..0x00_00010]);
        assert_ne!(
            a, d,
            "o mesmo enderezo con bancos distintos dá bytes distintos"
        );
    }

    #[test]
    fn rexion_non_rom_e_recusada_e_non_se_inventan_bytes() {
        let image = rom_autoral(LINEAR_SIZE);
        let err = read_fixed_snapshot(&pedido(
            "non-rom",
            &image,
            "md-linear",
            estado(LINEAR_SIZE as u64, vec![]),
            0xA0_0000,
            16,
        ))
        .expect_err("$A00000 é RAM do Z80, non ROM");
        assert_eq!(err.code, "non_rom_region", "{err:?}");
        assert!(
            err.message.contains("z80-ram"),
            "a rexión ten que nomearse: {err:?}"
        );
    }

    #[test]
    fn enderezo_fora_do_barramento_e_recusado() {
        let image = rom_autoral(LINEAR_SIZE);
        let err = read_fixed_snapshot(&pedido(
            "bus",
            &image,
            "md-linear",
            estado(LINEAR_SIZE as u64, vec![]),
            0x0100_0000,
            16,
        ))
        .expect_err("24 bits");
        assert_eq!(err.code, "invalid_range", "{err:?}");
    }

    #[test]
    fn lonxitude_cero_e_recusada_antes_de_percorrer() {
        let image = rom_autoral(LINEAR_SIZE);
        let err = read_fixed_snapshot(&pedido(
            "len0",
            &image,
            "md-linear",
            estado(LINEAR_SIZE as u64, vec![]),
            0x00_0100,
            0,
        ))
        .expect_err("length < 1");
        assert_eq!(err.code, "invalid_range", "{err:?}");
    }

    #[test]
    fn perfil_inexistente_e_recusado_con_a_lista_exposta() {
        let image = rom_autoral(LINEAR_SIZE);
        let err = read_fixed_snapshot(&pedido(
            "perfil-alleo",
            &image,
            "md-ssff",
            estado(LINEAR_SIZE as u64, vec![]),
            0x00_0100,
            16,
        ))
        .expect_err("sen autodetección");
        assert_eq!(err.code, "profile_unknown", "{err:?}");
        assert!(err.message.contains("md-linear"), "{err:?}");
        assert!(err.message.contains("md-ssf2"), "{err:?}");
    }

    #[test]
    fn perfil_implementado_na_biblioteca_e_non_expuesto_polo_adaptador_e_recusado() {
        let image = rom_autoral(LINEAR_SIZE);
        let err = read_fixed_snapshot(&pedido(
            "snes",
            &image,
            "snes-lorom",
            estado(LINEAR_SIZE as u64, vec![]),
            0x00_0100,
            16,
        ))
        .expect_err("o perfil existe no núcleo pero a fronteira de identidade é MD");
        assert_eq!(err.code, "profile_not_exposed", "{err:?}");
        assert!(err.message.contains("snes-lorom"), "{err:?}");
    }

    #[test]
    fn estado_sen_rom_size_e_recusado() {
        let image = rom_autoral(LINEAR_SIZE);
        let err = read_fixed_snapshot(&pedido(
            "sen-rom-size",
            &image,
            "md-linear",
            serde_json::json!({ "outro": 1 }),
            0x00_0100,
            16,
        ))
        .expect_err("rom_size é explícito");
        assert_eq!(err.code, "bad_state", "{err:?}");
    }

    #[test]
    fn rom_size_fora_do_intervalo_do_perfil_e_recusado() {
        let image = rom_autoral(LINEAR_SIZE);
        let err = read_fixed_snapshot(&pedido(
            "rom-size-menor",
            &image,
            "md-linear",
            estado(0x2000, vec![]),
            0x00_0100,
            16,
        ))
        .expect_err("64 KiB é o mínimo de md-linear");
        assert_eq!(err.code, "bad_state", "{err:?}");
    }

    #[test]
    fn chave_de_banco_non_remapable_e_recusada() {
        let image = rom_autoral(SSF2_SIZE);
        let err = read_fixed_snapshot(&pedido(
            "banco-8",
            &image,
            "md-ssf2",
            estado(SSF2_SIZE as u64, vec![("8", 1)]),
            0x00_80000,
            16,
        ))
        .expect_err("só 1..=7 son remapeables");
        assert_eq!(err.code, "bad_state", "{err:?}");
        assert!(err.message.contains("xanela '8'"), "{err:?}");
    }

    #[test]
    fn rom_size_que_a_imaxe_non_cobre_e_recusado() {
        // O estado declara 4 MiB nunha imaxe de 1 MiB. A xanela 7 traduce
        // dentro do `rom_size` declarado, pero o corredor cae fóra do buffer:
        // é a imaxe a que non cobre o estado, e iso recúsase, non se clampa.
        let image = rom_autoral(SSF2_SIZE);
        let err = read_fixed_snapshot(&pedido(
            "imaxe-curta",
            &image,
            "md-ssf2",
            estado(0x40_0000, vec![]),
            0x00_380000,
            16,
        ))
        .expect_err("o estado declara máis do que a imaxe contén");
        assert_eq!(err.code, "incompatible_size", "{err:?}");
    }

    #[test]
    fn identidade_divergente_e_recusada_antes_de_qualquer_enderezamento() {
        let image = rom_autoral(LINEAR_SIZE);
        let mut req = pedido(
            "identidade",
            &image,
            "md-linear",
            estado(LINEAR_SIZE as u64, vec![]),
            0x00_0100,
            16,
        );
        req.expected_sha256 = "0".repeat(64);
        let err = read_fixed_snapshot(&req).expect_err("a UI trae outra ROM");
        assert_eq!(err.code, "rom_identity_mismatch", "{err:?}");
        assert!(err.message.contains(&sha256(&image)), "{err:?}");
    }

    #[test]
    fn erro_interno_preserva_codigo_e_detalle_util() {
        let image = rom_autoral(LINEAR_SIZE);
        let err = read_fixed_snapshot(&pedido(
            "detalle",
            &image,
            "md-linear",
            estado(0x2000, vec![]),
            0x00_0100,
            16,
        ))
        .expect_err("detalle preservado");
        assert_eq!(err.code, "bad_state");
        assert!(
            err.message.contains("md-linear"),
            "o perfil ten que aparecer no detalle: {err:?}"
        );
        assert!(
            err.message.contains("fóra do intervalo"),
            "o detalle do núcleo non se pode substituír por texto xenérico: {err:?}"
        );
    }

    #[test]
    fn os_bytes_viaxan_en_base64_co_sha256_lateral() {
        let image = rom_autoral(LINEAR_SIZE);
        let out = read_fixed_snapshot(&pedido(
            "base64",
            &image,
            "md-linear",
            estado(LINEAR_SIZE as u64, vec![]),
            0x00_0100,
            256,
        ))
        .expect("leitura");
        assert_eq!(out.length, 256);
        let bytes = BASE64.decode(&out.bytes_base64).expect("base64");
        assert_eq!(bytes, &image[0x00_0100..0x00_0200]);
        assert_eq!(out.bytes_sha256, sha256(&bytes));
        assert_eq!(out.contract_version, 1);
        assert_eq!(
            (out.max_bytes, out.max_segments),
            (0x100_0000, 4096),
            "os límites aplicados son os do núcleo"
        );
    }

    #[test]
    fn a_fixture_temporal_se_descarta_ao_saír_do_alcance() {
        // Cada test escribe unha imaxe de 512 KiB ou 1 MiB en /tmp. Sen
        // descarte, unha carreira de gates deixa >100 MiB de ROMs autorais.
        let caminho = {
            let req = pedido(
                "descarte",
                &rom_autoral(LINEAR_SIZE),
                "md-linear",
                estado(LINEAR_SIZE as u64, vec![]),
                0x00_0100,
                16,
            );
            req.rom_path.clone()
        };
        assert!(
            !std::path::Path::new(&caminho).exists(),
            "a fixture temporal non se descartou: {caminho}"
        );
    }
}
