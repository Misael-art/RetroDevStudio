//! Adaptador REX — superficie de codec Kosinski do produto.
//!
//! A biblioteca `rex-kosinski` (`crates/rex-kosinski`) segue standalone, sen
//! Tauri e sen dependencias externas: quen coñece o contrato de erros do
//! produto é este módulo. Aqui mapeamos `KosError`/`EncError` para o `CodecError
//! { code, detail }` que xa usa aPLib/LZ4W, preservando a distinción entre
//! **decodificar** e **codificar** como operacións separadas. A camada `ipc_*`
//! serve os comandos Tauri `rex_kosinski_decode`/`rex_kosinski_encode`.
//!
//! O **contêiner de edición** do paquete (`rex_kosinski::edit::reinsert`) é
//! proba de contrato — a propia doc do módulo di que NON e transación canónica
//! de produción — polo que **non se expón** por aqui: a reinserción no produto
//! segue polas transacións canónicas existentes, que aínda non consomen
//! Kosinski. Tampouco se alega descuberta de recursos nin lectura sobre xogos
//! reais: esta capa só transforma streams.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use rex_kosinski::{decode, encode, EncError, KosDecoded, KosError};
use serde::{Deserialize, Serialize};

use super::inspection::InspectionError;
use super::rex_codecs::CodecError;
use crate::core::rom_mastering::sha256_hex;

/// Limites de execución da decodificación (mesma forma que `AplibLimits`/
/// `Lz4wLimits`): tetos exixidos antes de alocar.
#[derive(Debug, Clone, Copy)]
pub struct KosinskiDecodeLimits {
    /// Tamanho máximo de saída aceptado (bytes).
    pub max_output: usize,
    /// Orzamento determinista de traballo (bits lidos, bytes lidos/escritos).
    pub max_work: usize,
}

impl Default for KosinskiDecodeLimits {
    fn default() -> Self {
        Self {
            max_output: 4 * 1024 * 1024,
            max_work: 64 * 1024 * 1024,
        }
    }
}

/// Limites de execución da codificación.
#[derive(Debug, Clone, Copy)]
pub struct KosinskiEncodeLimits {
    /// Tetos absoluto do stream comprimido (bytes).
    pub max_stream: usize,
    /// Orzamento determinista de traballo do emisor.
    pub max_work: usize,
}

impl Default for KosinskiEncodeLimits {
    fn default() -> Self {
        Self {
            max_stream: 4 * 1024 * 1024,
            max_work: 64 * 1024 * 1024,
        }
    }
}

/// Resultado dunha decodificación Kosinski ben sucedida.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KosinskiDecoded {
    pub data: Vec<u8>,
    /// Posición inmediatamente tras o terminator; o padding posterior non se
    /// consume (contrato v1 §3).
    pub bytes_consumed: usize,
}

/// Tradución 1:1 de `KosError` para os códigos estables do contrato de codecs.
/// O detalle do núcleo non se tira: sempre leva "Kosinski" e contexto.
fn erro_de_decodificacao(e: KosError) -> CodecError {
    let (code, contexto) = match e {
        KosError::Truncated => ("truncated", "fluxo exaurido sen terminator"),
        KosError::InvalidReference => (
            "invalid_reference",
            "referencia cae antes do historico ou fora do formato",
        ),
        KosError::ExcessiveOutput => ("excessive_output", "a saida excederia o max_output pedido"),
        KosError::WorkLimit => ("work_limit", "orzamento determinista de traballo esgotado"),
        KosError::EmptyInput => ("empty_input", "entrada de cero bytes"),
    };
    CodecError::new(code, format!("Kosinski decode: {contexto}"))
}

fn erro_de_codificacion(e: EncError) -> CodecError {
    let (code, contexto) = match e {
        EncError::StreamLimit => ("stream_limit", "a stream excederia o max_stream pedido"),
        EncError::WorkLimit => ("work_limit", "orzamento determinista de traballo esgotado"),
    };
    CodecError::new(code, format!("Kosinski encode: {contexto}"))
}

/// Decodifica un stream Kosinski base, aplicando os limites do chamador e
/// devolvendo canto do stream foi realmente consumido.
pub fn kosinski_decode(
    stream: &[u8],
    limits: &KosinskiDecodeLimits,
) -> Result<KosinskiDecoded, CodecError> {
    let KosDecoded {
        output,
        bytes_consumed,
    } = decode(stream, limits.max_output, limits.max_work).map_err(erro_de_decodificacao)?;
    Ok(KosinskiDecoded {
        data: output,
        bytes_consumed,
    })
}

/// Codifica un plain na variante base do formato. Operacion separada da
/// decodificación: non hai re-inserción nin escritura implicita aqui.
pub fn kosinski_encode(plain: &[u8], limits: &KosinskiEncodeLimits) -> Result<Vec<u8>, CodecError> {
    let encoded =
        encode(plain, limits.max_stream, limits.max_work).map_err(erro_de_codificacion)?;
    Ok(encoded.stream)
}

// ---------------------------------------------------------------------------
// Camada IPC — as chamadas reais do backend.
// ---------------------------------------------------------------------------

/// Erro estruturado da fronteira: o `code`/`detail` do contrato de codecs
/// viaxa 1:1 (`code`→`code`, `detail`→`message`), sen inventar categorías novas
/// nin perder texto. `retryable=false`: un erro determinista de entrada non se
/// resolve reintentando.
fn erro_de_fronteira(e: CodecError) -> InspectionError {
    InspectionError {
        code: e.code.to_string(),
        message: e.detail,
        retryable: false,
    }
}

fn fail(code: &str, message: impl Into<String>) -> InspectionError {
    InspectionError {
        code: code.to_string(),
        message: message.into(),
        retryable: false,
    }
}

fn teto_saida(valor: Option<u32>, defecto: usize) -> usize {
    valor.map_or(defecto, |v| v as usize)
}

fn teto_traballo(
    valor: Option<u64>,
    defecto: usize,
    campo: &str,
) -> Result<usize, InspectionError> {
    match valor {
        None => Ok(defecto),
        Some(v) => usize::try_from(v).map_err(|_| {
            fail(
                "invalid_request",
                format!("{campo}: {v} non cabe neste plataforma"),
            )
        }),
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct KosinskiDecodeRequest {
    pub stream_base64: String,
    /// Techo de saída; sen el, o defecto do contrato (4 MiB). Explícito: nada
    /// se autodetecta.
    pub max_output: Option<u32>,
    pub max_work: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct KosinskiDecodeResponse {
    pub stream_len: u64,
    pub stream_sha256: String,
    /// Bytes do stream realmente consumidos (ata o terminator; o padding
    /// posterior non se consume).
    pub bytes_consumed: u64,
    pub data_base64: String,
    pub data_len: u64,
    pub data_sha256: String,
    /// Tetos efectivos co que se executou a chamada.
    pub max_output: u64,
    pub max_work: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct KosinskiEncodeRequest {
    pub plain_base64: String,
    pub max_stream: Option<u32>,
    pub max_work: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct KosinskiEncodeResponse {
    pub plain_len: u64,
    pub plain_sha256: String,
    pub stream_base64: String,
    pub stream_len: u64,
    pub stream_sha256: String,
    pub max_stream: u64,
    pub max_work: u64,
}

/// Decodificación servida polo backend: entrada base64, saída base64 +
/// SHA-256 laterais, erros do contrato de codecs preservados.
pub fn ipc_decode(req: &KosinskiDecodeRequest) -> Result<KosinskiDecodeResponse, InspectionError> {
    let stream = BASE64
        .decode(req.stream_base64.as_bytes())
        .map_err(|e| fail("invalid_request", format!("stream_base64: {e}")))?;
    let d = KosinskiDecodeLimits::default();
    let max_output = teto_saida(req.max_output, d.max_output);
    let max_work = teto_traballo(req.max_work, d.max_work, "max_work")?;
    let limits = KosinskiDecodeLimits {
        max_output,
        max_work,
    };
    let out = kosinski_decode(&stream, &limits).map_err(erro_de_fronteira)?;
    Ok(KosinskiDecodeResponse {
        stream_len: stream.len() as u64,
        stream_sha256: sha256_hex(&stream),
        bytes_consumed: out.bytes_consumed as u64,
        data_base64: BASE64.encode(&out.data),
        data_len: out.data.len() as u64,
        data_sha256: sha256_hex(&out.data),
        max_output: max_output as u64,
        max_work: max_work as u64,
    })
}

/// Codificación servida polo backend. Operación separada da decodificación:
/// non escribe en ningunh sitio nin toca ningunha ROM.
pub fn ipc_encode(req: &KosinskiEncodeRequest) -> Result<KosinskiEncodeResponse, InspectionError> {
    let plain = BASE64
        .decode(req.plain_base64.as_bytes())
        .map_err(|e| fail("invalid_request", format!("plain_base64: {e}")))?;
    let d = KosinskiEncodeLimits::default();
    let max_stream = teto_saida(req.max_stream, d.max_stream);
    let max_work = teto_traballo(req.max_work, d.max_work, "max_work")?;
    let limits = KosinskiEncodeLimits {
        max_stream,
        max_work,
    };
    let stream = kosinski_encode(&plain, &limits).map_err(erro_de_fronteira)?;
    Ok(KosinskiEncodeResponse {
        plain_len: plain.len() as u64,
        plain_sha256: sha256_hex(&plain),
        stream_base64: BASE64.encode(&stream),
        stream_len: stream.len() as u64,
        stream_sha256: sha256_hex(&stream),
        max_stream: max_stream as u64,
        max_work: max_work as u64,
    })
}

#[cfg(test)]
mod tests {

    use super::{kosinski_decode, kosinski_encode, KosinskiDecodeLimits, KosinskiEncodeLimits};
    use crate::tools::reverse::decomp::rex_codecs::CodecError;

    /// Stream autoral rexistrada pola fronte B (`fixtures/kosinski/plain/
    /// abcdef.kos`, 12 bytes, confirmada no oráculo koscmp e SHA-pinnada no
    /// gate do paquete): `bf 00 'ABCDEF' 00 f0 00 00`. A espera independenten
    /// rexistrada é `abcdef.bin` = b"ABCDEF" con `bytes_consumed = 11` (o
    /// padding posterior NON se consome; contrato v1 §3).
    const ABCDEF_KOS: [u8; 12] = [
        0xBF, 0x00, b'A', b'B', b'C', b'D', b'E', b'F', 0x00, 0xF0, 0x00, 0x00,
    ];

    fn erro<T>(de: Result<T, CodecError>) -> CodecError {
        de.err().expect("esperábase un erro estruturado")
    }

    #[test]
    fn decode_da_stream_rexistrada_devolve_o_plain_e_a_consumcion_oficiais() {
        let out = kosinski_decode(&ABCDEF_KOS, &KosinskiDecodeLimits::default()).expect("decode");
        assert_eq!(out.data, b"ABCDEF");
        assert_eq!(
            out.bytes_consumed, 11,
            "o padding post-terminator non se consume"
        );
    }

    #[test]
    fn limite_de_saida_estrito_recusa_excessive_output_con_detalle_util() {
        let limits = KosinskiDecodeLimits {
            max_output: 5,
            max_work: 65536,
        };
        let e = erro(kosinski_decode(&ABCDEF_KOS, &limits));
        assert_eq!(e.code, "excessive_output", "{e:?}");
        assert!(
            e.detail.contains("Kosinski"),
            "o detalle ten que nomear o codec: {e:?}"
        );
    }

    #[test]
    fn orzamento_de_traballo_estrito_recusa_work_limit() {
        let limits = KosinskiDecodeLimits {
            max_output: 4096,
            max_work: 3,
        };
        let e = erro(kosinski_decode(&ABCDEF_KOS, &limits));
        assert_eq!(e.code, "work_limit", "{e:?}");
    }

    #[test]
    fn entrada_espida_recusa_empty_input_non_texto_xeral() {
        let e = erro(kosinski_decode(&[], &KosinskiDecodeLimits::default()));
        assert_eq!(e.code, "empty_input", "{e:?}");
    }

    #[test]
    fn sonda_0200ffff_recusa_invalid_reference() {
        // Sonda rexistrada no contrato de B (mesma que `borda_referencia_antes_
        // do_historico_sonda_0200ffff` no gate do paquete).
        let e = erro(kosinski_decode(
            &[0x02, 0x00, 0xFF, 0xFF],
            &KosinskiDecodeLimits::default(),
        ));
        assert_eq!(e.code, "invalid_reference", "{e:?}");
    }

    #[test]
    fn descritor_incompleto_recusa_truncated() {
        let e = erro(kosinski_decode(&[0xFF], &KosinskiDecodeLimits::default()));
        assert_eq!(e.code, "truncated", "{e:?}");
    }

    #[test]
    fn encode_do_plain_espido_devolve_a_stream_minima_rexistrada() {
        // Espera derivada do ENCODE-CONTRACT §e publicada ANTES da
        // implementación (test `plain_vazio_produz_stream_minima_de_5_bytes`):
        // [0x02, 0x00, 0x00, 0xF0, 0x00].
        let st = kosinski_encode(b"", &KosinskiEncodeLimits::default()).expect("encode");
        assert_eq!(st, vec![0x02, 0x00, 0x00, 0xF0, 0x00]);
    }

    #[test]
    fn encode_decodo_pola_adaptadora_inverte_o_plain_autoral() {
        let plain: Vec<u8> = (0..4096u32).map(|i| (i % 251) as u8).collect();
        let st = kosinski_encode(&plain, &KosinskiEncodeLimits::default()).expect("encode");
        let back = kosinski_decode(
            &st,
            &KosinskiDecodeLimits {
                max_output: 1 << 20,
                max_work: 1 << 22,
            },
        )
        .expect("decode");
        assert_eq!(back.data, plain, "o ciclo polo backend ten que invertermse");
        assert_eq!(
            back.bytes_consumed,
            st.len(),
            "sen padding: consume todo o emitido"
        );
    }

    #[test]
    fn encode_respeita_o_limite_de_stream_con_erro_estruturado() {
        let e = erro(kosinski_encode(
            b"ABCDEF",
            &KosinskiEncodeLimits {
                max_stream: 1,
                max_work: 65536,
            },
        ));
        assert_eq!(e.code, "stream_limit", "{e:?}");
    }

    #[test]
    fn encode_respeita_o_orzamento_de_traballo() {
        let plain: Vec<u8> = vec![0x5A; 65536];
        let e = erro(kosinski_encode(
            &plain,
            &KosinskiEncodeLimits {
                max_stream: 1 << 20,
                max_work: 4,
            },
        ));
        assert_eq!(e.code, "work_limit", "{e:?}");
    }

    //Camada IPC: as chamadas reais do backend (comandos Tauri `rex_kosinski_*`)
    // serven estas funcións. O erro do contrato de codecs viaxa estruturado
    // (código + detalle), sen achatamento, e a saída leva base64 + SHA-256
    // laterais, como en `rex_addressing_read_snapshot`.

    use super::{ipc_decode, ipc_encode, KosinskiDecodeRequest, KosinskiEncodeRequest};
    use crate::core::rom_mastering::sha256_hex;
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine};

    #[test]
    fn ipc_decode_devolve_base64_sha_e_consumo_da_stream_rexistrada() {
        let req = KosinskiDecodeRequest {
            stream_base64: BASE64.encode(ABCDEF_KOS),
            max_output: None,
            max_work: None,
        };
        let out = ipc_decode(&req).expect("decode ipc");
        assert_eq!(out.stream_len, 12);
        assert_eq!(out.stream_sha256, sha256_hex(&ABCDEF_KOS));
        assert_eq!(
            out.bytes_consumed, 11,
            "o padding post-terminator non se consume"
        );
        let dados = BASE64.decode(&out.data_base64).expect("base64");
        assert_eq!(dados, b"ABCDEF");
        assert_eq!(out.data_sha256, sha256_hex(b"ABCDEF"));
    }

    #[test]
    fn ipc_decode_preserva_o_codigo_e_o_detalle_do_codec() {
        let req = KosinskiDecodeRequest {
            stream_base64: String::new(),
            max_output: None,
            max_work: None,
        };
        let e = ipc_decode(&req).expect_err("entrada vacia: empty_input");
        assert_eq!(e.code, "empty_input", "{e:?}");
        assert!(
            e.message.contains("Kosinski"),
            "o detalle nomea o codec: {e:?}"
        );
        assert!(
            !e.retryable,
            "erro determinista de entrada non se reintentaa"
        );
    }

    #[test]
    fn ipc_decode_recusa_base64_inxusto_con_codigo_propio_da_fronteira() {
        let req = KosinskiDecodeRequest {
            stream_base64: "n@@~!不是base64".to_string(),
            max_output: None,
            max_work: None,
        };
        let e = ipc_decode(&req).expect_err("base64 inválido");
        assert_eq!(e.code, "invalid_request", "{e:?}");
    }

    #[test]
    fn ipc_encode_devolve_a_stream_minima_cos_mesmos_hashes_que_a_chamada_directa() {
        let req = KosinskiEncodeRequest {
            plain_base64: String::new(),
            max_stream: None,
            max_work: None,
        };
        let out = ipc_encode(&req).expect("encode ipc");
        let crú = kosinski_encode(b"", &KosinskiEncodeLimits::default()).expect("encode directo");
        assert_eq!(out.stream_base64, BASE64.encode(&crú));
        assert_eq!(out.stream_sha256, sha256_hex(&crú));
        assert_eq!(out.stream_len, crú.len() as u64);
        assert_eq!(out.plain_len, 0);
        assert_eq!(out.plain_sha256, sha256_hex(b""));
    }

    #[test]
    fn ipc_encode_preserva_o_codigo_stream_limit() {
        let req = KosinskiEncodeRequest {
            plain_base64: BASE64.encode(b"ABCDEF"),
            max_stream: Some(1),
            max_work: None,
        };
        let e = ipc_encode(&req).expect_err("stream non cabe");
        assert_eq!(e.code, "stream_limit", "{e:?}");
    }

    #[test]
    fn ipc_encode_decodo_invertemse_pola_fronteira_do_backend() {
        let plain: Vec<u8> = (0..1000u32).map(|i| (i % 97) as u8).collect();
        let enc = ipc_encode(&KosinskiEncodeRequest {
            plain_base64: BASE64.encode(&plain),
            max_stream: None,
            max_work: None,
        })
        .expect("encode");
        let dec = ipc_decode(&KosinskiDecodeRequest {
            stream_base64: enc.stream_base64.clone(),
            max_output: Some(1 << 20),
            max_work: None,
        })
        .expect("decode");
        assert_eq!(BASE64.decode(&dec.data_base64).expect("b64"), plain);
        assert_eq!(
            dec.bytes_consumed, enc.stream_len,
            "sen padding: consómese todo"
        );
    }
}
