//! Decoder aPLib na variante SGDK (stream raw, sem header `"AP\0"`).
//!
//! Variante e regras de rejeição congeladas pela fixture da agente B
//! (`data/rex_profiles/integrator/aplib/vectors/`, hash agregado
//! `3a9d7e9e2312a7457003feb8d15214926f84354d3b19aa6039e2a3a3b66bec0d`) e pelo
//! contrato `scripts/rex_profiles/codecs/aplib/PRODUCT-CONTRACT.md`. As rejeições
//! são derivadas do contrato, não do oráculo: `apultra` e `apj.jar` não validam
//! entrada (leem além do EOF), então aceitar stream truncado **não** é
//! comportamento esperado do produto.
//!
//! Histórico de offset (o que o rep-match reusa): gravado por `10` e por `110`,
//! **não** gravado por `111`. A fixture de B não exercita `110`/`111` seguidos de
//! rep-match e a regra faltava no contrato dela; os dois casos estão pinados em
//! `data/rex_profiles/integrator/aplib/discriminating/` e foram decididos pelos
//! próprios decodificadores de referência.

use super::rex_codecs::CodecError;

/// Limites de execução do aPLib. Validados antes de alocar.
#[derive(Debug, Clone, Copy)]
pub struct AplibLimits {
    /// Tamanho máximo de saída aceito (bytes).
    pub max_output: usize,
    /// Orçamento máximo de trabalho (bits lidos, bytes consumidos, bytes copiados).
    pub max_work: u64,
}

impl Default for AplibLimits {
    fn default() -> Self {
        Self {
            max_output: 4 * 1024 * 1024,
            max_work: 64 * 1024 * 1024,
        }
    }
}

/// Resultado de uma decodificação aPLib bem-sucedida.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AplibDecoded {
    pub data: Vec<u8>,
    /// Posição imediatamente após o byte de comando do EOD. Bytes depois do EOD
    /// pertencem ao bloco vizinho da ROM, nunca a este stream.
    pub bytes_consumed: usize,
}

const MIN_MATCH3_OFFSET: usize = 1280;
const MIN_MATCH4_OFFSET: usize = 32000;
/// Acima disto o `gamma2` deixou de representar tamanho/offset plausível.
const GAMMA2_LIMIT: u64 = 1 << 31;

struct BitReader<'a> {
    stream: &'a [u8],
    pos: usize,
    tag: u8,
    mask: u8,
    work: u64,
    max_work: u64,
}

impl BitReader<'_> {
    fn spend(&mut self) -> Result<(), CodecError> {
        self.work += 1;
        if self.work > self.max_work {
            return Err(CodecError::new(
                "work_limit",
                format!(
                    "aPLib: {} operações excederam o orçamento de {}",
                    self.work, self.max_work
                ),
            ));
        }
        Ok(())
    }

    fn byte(&mut self) -> Result<u8, CodecError> {
        let byte = *self.stream.get(self.pos).ok_or_else(|| {
            CodecError::new(
                "truncated",
                format!(
                    "aPLib: EOF aos {} bytes, com token iniciado (stream de {} bytes)",
                    self.pos,
                    self.stream.len()
                ),
            )
        })?;
        self.pos += 1;
        self.spend()?;
        Ok(byte)
    }

    fn bit(&mut self) -> Result<u8, CodecError> {
        if self.mask == 0 {
            self.tag = self.byte()?;
            self.mask = 8;
        }
        self.mask -= 1;
        self.spend()?;
        Ok((self.tag >> self.mask) & 1)
    }

    /// `gamma2`: pares (dado, controle) com `v = (v << 1) | dado`, encerrando no
    /// controle 0. O menor valor legível é 2.
    fn gamma2(&mut self) -> Result<u64, CodecError> {
        let mut value: u64 = 1;
        loop {
            let data = self.bit()?;
            value = (value << 1) | u64::from(data);
            if value > GAMMA2_LIMIT {
                return Err(CodecError::new(
                    "overflow",
                    format!(
                        "aPLib: gamma2 acumulou {value} acima do teto de 2^31 sem fim de token"
                    ),
                ));
            }
            if self.bit()? == 0 {
                return Ok(value);
            }
        }
    }
}

/// Decodifica um stream aPLib raw (variante SGDK) informando quantos bytes dele
/// foram realmente consumidos.
pub fn aplib_decode(stream: &[u8], limits: &AplibLimits) -> Result<AplibDecoded, CodecError> {
    if limits.max_output == 0 {
        return Err(CodecError::new(
            "excessive_output",
            "aPLib: max_output é 0; nenhum byte de saída é aceitável",
        ));
    }
    if stream.is_empty() {
        return Err(CodecError::new(
            "truncated",
            "aPLib: stream vazio; o formato não expressa saída vazia",
        ));
    }

    let mut reader = BitReader {
        stream,
        pos: 0,
        tag: 0,
        mask: 0,
        work: 0,
        max_work: limits.max_work,
    };
    let mut out: Vec<u8> = Vec::new();
    // 0 marca histórico inválido: rep-match antes de qualquer match é recusa.
    let mut last_offset: usize = 0;
    // LWM (`nFollowsLiteral`): 3 após literal/`111`, 2 após match.
    let mut lwm: u64 = 3;

    let primeiro_literal = reader.byte()?;
    push(&mut out, primeiro_literal, limits)?;

    loop {
        if reader.bit()? == 0 {
            let literal = reader.byte()?;
            push(&mut out, literal, limits)?;
            lwm = 3;
            continue;
        }
        if reader.bit()? == 0 {
            // token `10`: match longo, ou rep-match quando `gamma2 < lwm`.
            let acumulado = reader.gamma2()?;
            let (offset, length) = if acumulado < lwm {
                if last_offset == 0 {
                    return Err(CodecError::new(
                        "invalid_reference",
                        "aPLib: rep-match sem offset histórico",
                    ));
                }
                // Assimetria confirmada no desempacotador oficial: rep-match não
                // ajusta o comprimento.
                (last_offset, reader.gamma2()?)
            } else {
                let offset_high = acumulado - lwm;
                let offset_low = u64::from(reader.byte()?);
                let offset = usize::try_from((offset_high << 8) | offset_low)
                    .map_err(|_| CodecError::new("overflow", "aPLib: offset fora de usize"))?;
                let ajuste = if !(128..MIN_MATCH4_OFFSET).contains(&offset) {
                    2
                } else if offset >= MIN_MATCH3_OFFSET {
                    1
                } else {
                    0
                };
                let length = reader.gamma2()?.checked_add(ajuste).ok_or_else(|| {
                    CodecError::new("overflow", "aPLib: comprimento estourou u64")
                })?;
                (offset, length)
            };
            let length = usize::try_from(length)
                .map_err(|_| CodecError::new("overflow", "aPLib: comprimento fora de usize"))?;
            copy(&mut out, offset, length, limits)?;
            last_offset = offset;
            lwm = 2;
            continue;
        }
        if reader.bit()? == 0 {
            // token `110`: byte de comando; `0x00` é o EOD.
            let cmd = reader.byte()?;
            if cmd == 0 {
                return Ok(AplibDecoded {
                    data: out,
                    bytes_consumed: reader.pos,
                });
            }
            copy(
                &mut out,
                usize::from(cmd >> 1),
                2 + usize::from(cmd & 1),
                limits,
            )?;
            // O `110` é um match explícito: grava o histórico. Sem isso, o
            // rep-match seguinte reusa um offset obsoleto — medido em 703 bytes
            // do TileSet APLIB real (vetor `rep_after_cmd110`).
            last_offset = usize::from(cmd >> 1);
            lwm = 2;
            continue;
        }
        // token `111`: offset curto de 4 bits; não atualiza o histórico de offset.
        let mut curto: usize = 0;
        for _ in 0..4 {
            curto = (curto << 1) | usize::from(reader.bit()?);
        }
        if curto == 0 {
            push(&mut out, 0, limits)?;
        } else {
            copy(&mut out, curto, 1, limits)?;
        }
        lwm = 3;
    }
}

fn push(out: &mut Vec<u8>, byte: u8, limits: &AplibLimits) -> Result<(), CodecError> {
    if out.len() >= limits.max_output {
        return Err(CodecError::new(
            "excessive_output",
            format!(
                "aPLib: saída atingiu o teto de {} bytes antes do EOD",
                limits.max_output
            ),
        ));
    }
    out.push(byte);
    Ok(())
}

fn copy(
    out: &mut Vec<u8>,
    offset: usize,
    length: usize,
    limits: &AplibLimits,
) -> Result<(), CodecError> {
    if offset == 0 || offset > out.len() {
        return Err(CodecError::new(
            "invalid_reference",
            format!(
                "aPLib: referência off={offset} len={length} fora do histórico de {} bytes",
                out.len()
            ),
        ));
    }
    for _ in 0..length {
        let byte = out[out.len() - offset];
        push(out, byte, limits)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::rom_mastering::sha256_hex;
    use std::path::PathBuf;

    fn vetor(rel: &str) -> Vec<u8> {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../data/rex_profiles/integrator/aplib/vectors");
        let caminho = dir.join(rel);
        std::fs::read(&caminho)
            .unwrap_or_else(|e| panic!("vetor obrigatório ausente: {}: {e}", caminho.display()))
    }

    fn decodificar(stream: &[u8], limites: AplibLimits) -> AplibDecoded {
        aplib_decode(stream, &limites)
            .unwrap_or_else(|e| panic!("decode de stream válido foi recusado: {e}"))
    }

    fn linhas() -> Vec<Vec<String>> {
        let texto = String::from_utf8(vetor("manifest.tsv")).expect("manifest.tsv não é UTF-8");
        texto
            .lines()
            .skip(1)
            .map(|l| l.split('\t').map(str::to_string).collect::<Vec<_>>())
            .collect()
    }

    fn erro_de(resultado: Result<AplibDecoded, CodecError>, contexto: &str) -> CodecError {
        match resultado {
            Ok(decode) => panic!(
                "{contexto}: o produto ACEITOU o stream (decodificou {} bytes)",
                decode.data.len()
            ),
            Err(e) => e,
        }
    }

    #[test]
    fn aplib_decodifica_cada_golden_com_consumo_exato() {
        let mut casos = 0;
        for linha in linhas() {
            if linha[0] != "golden" {
                continue;
            }
            let nome = &linha[1];
            let stream = vetor(&format!("golden/{nome}.ap"));
            let esperado = vetor(&format!("golden/{nome}.expected.bin"));
            assert_eq!(
                sha256_hex(&esperado),
                linha[3],
                "{nome}: expected.bin diverge do hash pinado no manifest.tsv"
            );
            assert_eq!(
                sha256_hex(&stream),
                linha[5],
                "{nome}: stream diverge do hash pinado no manifest.tsv"
            );
            // O contrato fixa o consumo em `g08`: EOD válido + 5 bytes de lixo
            // que pertencem ao bloco vizinho, não ao stream.
            let consumo = if nome == "g08_eod_trailing" {
                6
            } else {
                stream.len()
            };
            let decode = decodificar(&stream, AplibLimits::default());
            assert_eq!(decode.data, esperado, "{nome}: plain divergente");
            assert_eq!(
                decode.bytes_consumed, consumo,
                "{nome}: bytes_consumed deveria ser {consumo}"
            );
            casos += 1;
        }
        assert_eq!(casos, 9, "esperava 9 goldens no manifest.tsv");
    }

    /// Cobertura do ramo que a fixture importada de B não exercita: um
    /// rep-match logo depois de `110` e logo depois de `111`. Os plains abaixo
    /// foram definidos pelos dois decodificadores de referência (procedência em
    /// `data/rex_profiles/integrator/aplib/discriminating/ORIGEM.md`). O decoder
    /// do produto passava nos 49 arquivos importados e errava aqui — 703 dos
    /// 16 000 bytes do TileSet APLIB real da ROM BYOR.
    #[test]
    fn aplib_rep_match_depois_de_110_e_de_111_usa_o_offset_correto() {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../data/rex_profiles/integrator/aplib/discriminating");
        let leia = |nome: &str| -> Vec<u8> {
            let caminho = dir.join(nome);
            std::fs::read(&caminho).unwrap_or_else(|e| {
                panic!("vetor discriminador ausente: {}: {e}", caminho.display())
            })
        };
        // (nome, plain correto, plain resultante de NÃO gravar o histórico)
        let casos: [(&str, &[u8], &[u8]); 2] = [
            (
                "rep_after_cmd110",
                b"ABCDEFDEFDFDEGDFDE",
                b"ABCDEFDEFDFDEGDEGD",
            ),
            ("rep_after_short111", b"ABCDEFDEFDDFDDF", b"ABCDEFDEFDDEFDD"),
        ];
        for (nome, correto, bug) in casos {
            assert_ne!(correto, bug, "{nome}: o caso deixou de discriminar");
            let stream = leia(&format!("{nome}.ap"));
            let esperado = leia(&format!("{nome}.expected.bin"));
            assert_eq!(
                esperado,
                correto.to_vec(),
                "{nome}: expectativa do teste divergiu do arquivo pinado"
            );
            let decode = decodificar(&stream, AplibLimits::default());
            assert_eq!(decode.data, correto.to_vec(), "{nome}: plain divergente");
            assert_eq!(
                decode.bytes_consumed,
                stream.len(),
                "{nome}: consumo deveria ser o stream inteiro"
            );
        }
    }

    #[test]
    fn aplib_decodifica_os_dois_oraculos_de_cada_plain_para_os_mesmos_bytes() {
        let mut casos = 0;
        for linha in linhas() {
            if linha[0] != "plain" {
                continue;
            }
            let nome = &linha[1];
            for (coluna, oraculo) in [(4, "apultra"), (6, "apj")] {
                let stream = vetor(&format!("plain/{nome}.{oraculo}.ap"));
                assert_eq!(
                    stream.len(),
                    linha[coluna].parse::<usize>().unwrap(),
                    "{nome}.{oraculo}: tamanho divergente do pino"
                );
                let decode = decodificar(&stream, AplibLimits::default());
                assert_eq!(
                    decode.data.len(),
                    linha[2].parse::<usize>().unwrap(),
                    "{nome}.{oraculo}: comprimento do plain"
                );
                assert_eq!(
                    sha256_hex(&decode.data),
                    linha[3],
                    "{nome}.{oraculo}: decode != plain pinado pelo oráculo"
                );
                assert_eq!(
                    decode.bytes_consumed,
                    stream.len(),
                    "{nome}.{oraculo}: consumo deveria ser o stream inteiro"
                );
                casos += 1;
            }
        }
        assert_eq!(casos, 16, "esperava 8 plains x 2 oráculos no manifest.tsv");
    }

    #[test]
    fn aplib_recusa_os_negativos_com_o_codigo_estruturado_exato() {
        let mut vistos = 0;
        for linha in linhas() {
            if linha[0] != "negative" {
                continue;
            }
            let nome = &linha[1];
            let stream = vetor(&format!("negative/{nome}.ap"));
            let json: serde_json::Value =
                serde_json::from_slice(&vetor(&format!("negative/{nome}.expected.json")))
                    .unwrap_or_else(|e| panic!("{nome}: expected.json ilegível: {e}"));
            let esperado = json["expected_error"]
                .as_str()
                .unwrap_or_else(|| panic!("{nome}: expected_error ausente"));
            let max_out = json
                .get("max_out")
                .and_then(serde_json::Value::as_u64)
                .map(|v| v as usize)
                .unwrap_or(1 << 22);
            let limites = AplibLimits {
                max_output: max_out,
                max_work: 64 * 1024 * 1024,
            };
            let esperado_codigo = esperado.replace('-', "_");
            let erro = erro_de(
                aplib_decode(&stream, &limites),
                &format!("{nome} (esperava {esperado_codigo})"),
            );
            assert_eq!(erro.code, esperado_codigo.as_str(), "{nome}: {erro}");
            assert!(
                !erro.detail.is_empty(),
                "{nome}: erro estruturado sem detalhe"
            );
            vistos += 1;
        }
        assert_eq!(vistos, 7, "esperava 7 negativos no manifest.tsv");
    }

    #[test]
    fn aplib_corta_no_orcamento_de_trabalho_antes_de_rodar_sem_limite() {
        let stream = vetor("golden/g07_far_offset.ap");
        let erro = erro_de(
            aplib_decode(
                &stream,
                &AplibLimits {
                    max_output: 1 << 22,
                    max_work: 3,
                },
            ),
            "g07 com max_work=3",
        );
        assert_eq!(erro.code, "work_limit", "{erro}");
    }

    #[test]
    fn aplib_declara_excessive_output_sem_estourar_a_saida() {
        let stream = vetor("golden/g03_short_match.ap");
        let esperado = vetor("golden/g03_short_match.expected.bin");
        assert!(
            esperado.len() > 4,
            "g03 precisa de saída maior que o teto para o teste não ser vazio"
        );
        let erro = erro_de(
            aplib_decode(
                &stream,
                &AplibLimits {
                    max_output: 4,
                    max_work: 64 * 1024 * 1024,
                },
            ),
            "g03 com teto de 4 bytes",
        );
        assert_eq!(erro.code, "excessive_output", "{erro}");
    }

    #[test]
    fn aplib_detecta_gamma2_sem_fim_como_overflow() {
        // Byte 0 é o literal; a partir daí o stream é `10` (match longo) seguido
        // de 31 pares (dado=1, controle=1), que acumulam acima de 2^31 sem
        // encerrar o token. Nenhum oráculo produziria isso, então o caso é
        // construído aqui — política de produto, declarada sem vetor externo.
        let mut stream = vec![0x00u8];
        let mut bits: Vec<u8> = vec![1, 0];
        for _ in 0..62 {
            bits.push(1);
        }
        for chunk in bits.chunks(8) {
            let mut byte = 0u8;
            for b in chunk {
                byte = (byte << 1) | b;
            }
            stream.push(byte << (8 - chunk.len()));
        }
        let erro = erro_de(
            aplib_decode(&stream, &AplibLimits::default()),
            "gamma2 sem fim",
        );
        assert_eq!(erro.code, "overflow", "{erro}");
    }

    #[test]
    fn aplib_recusa_rep_match_sem_offset_historico() {
        // `10` + gamma2 menor que o LWM (2 = par dado 0 / controle 0) pede
        // rep-match sem nenhum match anterior: recusa, não comportamento.
        let mut stream = vec![0x00u8];
        let mut bits: Vec<u8> = vec![1, 0, 0, 0];
        for _ in 0..60 {
            bits.push(0);
        }
        for chunk in bits.chunks(8) {
            let mut byte = 0u8;
            for b in chunk {
                byte = (byte << 1) | b;
            }
            stream.push(byte << (8 - chunk.len()));
        }
        let erro = erro_de(
            aplib_decode(&stream, &AplibLimits::default()),
            "rep-match sem histórico",
        );
        assert_eq!(erro.code, "invalid_reference", "{erro}");
    }

    #[test]
    fn aplib_nega_stream_vazio_e_max_output_zero() {
        assert_eq!(
            aplib_decode(&[], &AplibLimits::default())
                .err()
                .expect("stream vazio deve ser recusado")
                .code,
            "truncated"
        );
        assert_eq!(
            aplib_decode(
                &vetor("golden/g01b_single_byte.ap"),
                &AplibLimits {
                    max_output: 0,
                    max_work: 64 * 1024 * 1024,
                }
            )
            .err()
            .expect("max_output 0 deve recusar antes de qualquer byte")
            .code,
            "excessive_output"
        );
    }
}
