//! Codecs REX v1 — decodificadores/codificadores canônicos do produto.
//!
//! Contrato: `docs/rex_profiles/CONTRACTS.md` seção 4. Erros são estruturados
//! (nunca panic, nunca offset 0), limites são explícitos e `bytes_consumed` é
//! exato. A identificação de um stream em uma ROM é capacidade separada e não
//! é alegada aqui.
//!
//! LZ4W: formato do SGDK (Stephane Dallongeville, licença MIT, pinado pelo
//! lock do host). Implementação independente a partir da semântica pública do
//! formato (`tools/lz4w/src/sgdk/lz4w/LZ4W.java` e `src/tools_a.s` do SGDK);
//! o oráculo é a ferramenta oficial `lz4w.jar` (pack e unpack) do toolchain
//! pinado, exercida nos testes quando disponível no host.
//!
//! Dois escopos convivem: `lz4w_decode`/`lz4w_encode` tratam streams
//! **autocontidas** (empacotadas com start=0); as variantes `_with_dictionary`
//! tratam streams prev-block (flag ROM source), que são o formato real do
//! ResComp. Sem dicionário declarado, uma referência externa é recusada com
//! `invalid_reference` — nunca decodificada por adivinhação.
//!
//! Codificador v1: guloso com tabela de candidatos por word (janela de
//! 0x4000 words, no máximo 128 candidatos por posição). Não é o parser
//! ótimo do compressor oficial; a recompressão pode exceder o espaço
//! original e o chamador deve tratar o erro de espaço (contrato §4).

/// Códigos de erro estruturados do contrato de codec (CONTRACTS.md §4).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodecError {
    pub code: &'static str,
    pub detail: String,
}

impl CodecError {
    pub(crate) fn new(code: &'static str, detail: impl Into<String>) -> Self {
        Self {
            code,
            detail: detail.into(),
        }
    }
}

impl std::fmt::Display for CodecError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "codec error [{}]: {}", self.code, self.detail)
    }
}

/// Limites de execução do codec. Validados antes de alocar.
#[derive(Debug, Clone, Copy)]
pub struct Lz4wLimits {
    /// Tamanho máximo de saída aceito (bytes).
    pub max_output: usize,
    /// Orçamento máximo de trabalho (operações de cópia/iteração).
    pub max_work: u64,
}

impl Default for Lz4wLimits {
    fn default() -> Self {
        // O alvo primário é recurso de sprite/tileset MD; 4 MiB de saída e
        // 64M de passos cobrem com folga os casos legítimos e cortam loops
        // patológicos antes de exaurir memória.
        Self {
            max_output: 4 * 1024 * 1024,
            max_work: 64 * 1024 * 1024,
        }
    }
}

/// Resultado de uma decodificação bem-sucedida.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Lz4wDecoded {
    pub data: Vec<u8>,
    /// Bytes do stream efetivamente consumidos (inclui o terminador e o
    /// word final de comprimento ímpar, quando presentes).
    pub bytes_consumed: usize,
}

const MATCH_MIN_SIZE: usize = 1;
const MATCH_LONG_MIN_SIZE: usize = 2;
/// Teto de offset longo não-ROM que o **desempacotador 68000 oficial** ainda lê
/// para trás (words). Derivado do asm e medido no hardware: `.long_match` faz
/// `move.w (a0)+,d0; add.w d0,d0; lea -2(a1,d0.w),a2`, isto é, o word de offset
/// é duplicado em 16 bits e usado como displacement com *sinal*. Com
/// `value = (-(off-1)) & 0x7FFF`, o displacement é negativo (para trás)
/// exatamente quando `value >= 0x4000`, ou seja `off <= 16385`; para
/// `1 <= value <= 0x3FFF` (`off >= 16386`) o 68000 leria PARA FRENTE e
/// aliassaria com a ROM — bytes errados silenciosos. `value == 0` é o caso
/// `off == 1` e é válido. Evidência: `docs/rex_profiles/LZ4W_68K_ORACLE.md`.
const MATCH_LONG_FORMAT_MAX_OFFSET_WORDS: usize = 0x4001;
/// Janela de busca que o **codificador** usa, por estratégia: a mesma do
/// compressor oficial (`0x3FFF + 1` words). É um word abaixo do teto do
/// formato de propósito — escolha de codificação, não limitação do decodificador.
const ENCODER_WINDOW_WORDS: usize = 0x4000;
/// Máscara de 15 bits do offset longo codificado (negação two's complement).
const MATCH_LONG_OFFSET_MASK: u16 = 0x7FFF;
const MATCH_LONG_OFFSET_ROM_SOURCE: u16 = 0x8000;
const LITERAL_MAX_WORDS: usize = 0xF;
const SHORT_MAX_OFFSET_WORDS: usize = 0x100;
const LONG_MAX_LENGTH_WORDS: usize = 0xFF + MATCH_LONG_MIN_SIZE;

fn read_word(stream: &[u8], pos: usize) -> Result<u16, CodecError> {
    if pos + 2 > stream.len() {
        return Err(CodecError::new(
            "truncated",
            format!("word em {pos} fora do stream"),
        ));
    }
    Ok(u16::from_be_bytes([stream[pos], stream[pos + 1]]))
}

/// Decodifica um stream LZ4W autocontido (SGDK, variante word-based).
///
/// O stream é uma sequência de tokens big-endian u16
/// `(literal_count<<12) | (match_count<<8) | match_byte`:
/// - `literal_count` words são copiados literalmente do stream;
/// - `match_count > 0`: match curto de `match_count + 1` words com offset
///   (para trás) de `match_byte + 1` words;
/// - `match_count == 0 && match_byte > 0`: match longo (comprimento mínimo 3
///   words); `match_byte` é o comprimento menos 2 (em words) e o próximo u16
///   após os literais codifica o offset negado (bit 0x8000 = referência ao
///   bloco anterior/dicionário);
/// - token `0x0000`: terminador, seguido do word final `0x8000|byte` quando a
///   saída tem comprimento ímpar (ou `0x0000` quando par).
pub fn lz4w_decode(stream: &[u8], limits: &Lz4wLimits) -> Result<Lz4wDecoded, CodecError> {
    lz4w_decode_with_dictionary(stream, None, limits)
}

/// Decodifica um stream LZ4W possivelmente dependente do **bloco anterior**
/// (variante do ResComp: cada recurso é empacotado com os bytes emitidos
/// antes dele como dicionário). O dicionário é o prefixo da ROM que precede
/// o stream — determinístico e parte da identidade da observação
/// (CONTRATOS §4: "dicionário/contexto necessários").
///
/// Semântica do match longo com flag ROM source, portada do unpacker
/// oficial: offset bruto = ((-valor) & 0x7FFF) + 1, ajustado por `-offsetAdj`
/// onde offsetAdj acumula +1 por token, +1 pelo word de offset longo e
/// -comprimento por match. O offset ajustado mede words a partir do fim do
/// resultado (dicionário + saída); referências além do início do dicionário
/// são `invalid_reference`.
pub fn lz4w_decode_with_dictionary(
    stream: &[u8],
    dictionary: Option<&[u8]>,
    limits: &Lz4wLimits,
) -> Result<Lz4wDecoded, CodecError> {
    if stream.len() < 2 {
        return Err(CodecError::new(
            "truncated",
            "stream menor que o token mínimo de 2 bytes",
        ));
    }
    let dict = dictionary.unwrap_or(&[]);
    if !dict.len().is_multiple_of(2) {
        return Err(CodecError::new(
            "invalid_reference",
            "dicionário com comprimento ímpar não endereçável por words",
        ));
    }
    let dict_len = dict.len();
    let mut buf: Vec<u8> = Vec::with_capacity(dict_len + 4096);
    buf.extend_from_slice(dict);
    let mut offset_adj: i64 = 0;
    let mut work: u64 = 0;
    let mut ind = 0usize;
    loop {
        work += 1;
        if work > limits.max_work {
            return Err(CodecError::new(
                "work_limit",
                "orçamento de trabalho excedido no decode",
            ));
        }
        let token = read_word(stream, ind)?;
        offset_adj += 1;
        if token == 0 {
            // Terminador; o word final sempre existe no formato.
            let final_word = read_word(stream, ind + 2)?;
            let mut consumed = ind + 4;
            if final_word & MATCH_LONG_OFFSET_ROM_SOURCE != 0 {
                if buf.len() - dict_len + 1 > limits.max_output {
                    return Err(CodecError::new(
                        "excessive_output",
                        "byte final excederia o limite de saída",
                    ));
                }
                buf.push((final_word & 0xFF) as u8);
            } else if final_word != 0 {
                return Err(CodecError::new(
                    "invalid_reference",
                    format!("word final {final_word:#06x} sem flag de byte ímpar"),
                ));
            }
            if consumed > stream.len() {
                consumed = stream.len();
            }
            return Ok(Lz4wDecoded {
                data: buf.split_off(dict_len),
                bytes_consumed: consumed,
            });
        }
        let literal_words = ((token >> 12) & 0xF) as usize;
        let match_nibble = ((token >> 8) & 0xF) as usize;
        let match_byte = (token & 0xFF) as usize;
        ind += 2;
        // Literais são words LE copiadas verbatim (writeWordLE do formato):
        // os dois bytes do stream vão direto para a saída, sem troca.
        if ind + literal_words * 2 > stream.len() {
            return Err(CodecError::new(
                "truncated",
                format!("{literal_words} literais truncados em {ind}"),
            ));
        }
        if buf.len() - dict_len + literal_words * 2 > limits.max_output {
            return Err(CodecError::new(
                "excessive_output",
                "limite de saída excedido em literal",
            ));
        }
        buf.extend_from_slice(&stream[ind..ind + literal_words * 2]);
        work += literal_words as u64;
        ind += literal_words * 2;
        let (match_words, match_offset_words) = if match_nibble > 0 {
            (match_nibble + MATCH_MIN_SIZE, match_byte + 1)
        } else if match_byte > 0 {
            let encoded = read_word(stream, ind).map_err(|_| {
                CodecError::new("truncated", format!("offset longo truncado em {ind}"))
            })?;
            ind += 2;
            offset_adj += 1;
            // Negação de 15 bits, exatamente como o unpacker oficial:
            // offset bruto = ((-valor) & 0x7FFF) + 1 (bit 15 = flag ROM source).
            let raw_offset =
                (((-(encoded as i32)) as u32 as usize) & MATCH_LONG_OFFSET_MASK as usize) + 1;
            if encoded & MATCH_LONG_OFFSET_ROM_SOURCE != 0 {
                if dict_len == 0 {
                    return Err(CodecError::new(
                        "invalid_reference",
                        "stream depende de dicionário externo (ROM source); decode autônomo recusado",
                    ));
                }
                let adjusted = raw_offset as i64 - offset_adj;
                if adjusted < 1 || adjusted as usize > buf.len() / 2 {
                    return Err(CodecError::new(
                        "invalid_reference",
                        format!(
                            "referência ROM source {raw_offset} ajustada para {adjusted} words fora do resultado de {} words",
                            buf.len() / 2
                        ),
                    ));
                }
                (match_byte + MATCH_LONG_MIN_SIZE, adjusted as usize)
            } else {
                // O desempacotador 68000 oficial só consegue ler para trás
                // até 16385 words (ver MATCH_LONG_FORMAT_MAX_OFFSET_WORDS);
                // acima disso o stream é inválido para o alvo, não apenas
                // incomum — e o 68000 produziria bytes errados em silêncio.
                if raw_offset > MATCH_LONG_FORMAT_MAX_OFFSET_WORDS {
                    return Err(CodecError::new(
                        "invalid_reference",
                        format!(
                            "match longo não-ROM com offset {raw_offset} words excede o teto lido pelo 68000 ({MATCH_LONG_FORMAT_MAX_OFFSET_WORDS}) (v={encoded:#06x})"
                        ),
                    ));
                }
                (match_byte + MATCH_LONG_MIN_SIZE, raw_offset)
            }
        } else {
            (0, 0)
        };
        if match_words > 0 {
            let total_words = buf.len() / 2;
            if match_offset_words > total_words {
                return Err(CodecError::new(
                    "invalid_reference",
                    format!(
                        "offset de match {match_offset_words} words excede o histórico de {total_words} words"
                    ),
                ));
            }
            let mut src = buf.len() - match_offset_words * 2;
            for _ in 0..match_words {
                work += 1;
                if work > limits.max_work {
                    return Err(CodecError::new("work_limit", "orçamento excedido no match"));
                }
                if buf.len() - dict_len + 2 > limits.max_output {
                    return Err(CodecError::new(
                        "excessive_output",
                        "limite de saída excedido em match",
                    ));
                }
                let word = u16::from_le_bytes([buf[src], buf[src + 1]]);
                buf.extend_from_slice(&word.to_le_bytes());
                src += 2;
            }
            offset_adj -= match_words as i64;
        }
    }
}

/// Codifica dados em um stream LZ4W autocontido válido para o decodificador
/// oficial do SGDK (`lz4w_unpack`/`LZ4W.unpack`).
///
/// Nunca produz correspondências com dicionário externo (start=0). O
/// codificador é guloso (não-ótimo): ver comentário do módulo.
pub fn lz4w_encode(data: &[u8]) -> Result<Vec<u8>, CodecError> {
    lz4w_encode_with_dictionary(data, None)
}

/// Codifica dados com o **bloco anterior como dicionário** (variante do
/// ResComp: o prefixo precede o stream na ROM e é endereçável pelos matches
/// longos, pois o unpacker oficial copia o prefixo para o início do
/// resultado). Os matches longos são emitidos sem a flag ROM source, com o
/// offset medido em words a partir do fim do resultado (dicionário + saída)
/// — exatamente o que o unpacker resolve. O dicionário deve ter comprimento
/// par; o codificador limita-se a `ENCODER_WINDOW_WORDS` (0x4000) words —
/// escolha de estratégia, um word abaixo do teto que o 68000 lê para trás.
pub fn lz4w_encode_with_dictionary(
    data: &[u8],
    dictionary: Option<&[u8]>,
) -> Result<Vec<u8>, CodecError> {
    match dictionary {
        Some(dict) => {
            let index = Lz4wDictionaryIndex::build(dict)?;
            lz4w_encode_with_dictionary_index(data, Some(&index))
        }
        None => lz4w_encode_with_dictionary_index(data, None),
    }
}

/// Índice de dicionário pré-construído e REUTILIZÁVEL: a varredura de
/// edições codifica dezenas de variantes do MESMO recurso contra o MESMO
/// dicionário — reconstruir o índice (e recopiar os bytes) por candidato
/// é proibitivo para dicionários de centenas de KB.
pub struct Lz4wDictionaryIndex {
    dictionary: Vec<u8>,
    positions: std::collections::HashMap<u16, Vec<usize>>,
    words: usize,
}

impl Lz4wDictionaryIndex {
    pub fn build(dictionary: &[u8]) -> Result<Self, CodecError> {
        if !dictionary.len().is_multiple_of(2) {
            return Err(CodecError::new(
                "invalid_reference",
                "dicionário com comprimento ímpar não endereçável por words",
            ));
        }
        let words = dictionary.len() / 2;
        let mut positions: std::collections::HashMap<u16, Vec<usize>> =
            std::collections::HashMap::new();
        for j in 0..words {
            let word = u16::from_be_bytes([dictionary[j * 2], dictionary[j * 2 + 1]]);
            positions.entry(word).or_default().push(j);
        }
        Ok(Self {
            dictionary: dictionary.to_vec(),
            positions,
            words,
        })
    }

    pub fn word_count(&self) -> usize {
        self.words
    }
}

/// Codifica usando um índice pré-construído (ou nenhum dicionário).
pub fn lz4w_encode_with_dictionary_index(
    data: &[u8],
    index: Option<&Lz4wDictionaryIndex>,
) -> Result<Vec<u8>, CodecError> {
    const MAX_INPUT: usize = 2 * 1024 * 1024;
    if data.len() > MAX_INPUT {
        return Err(CodecError::new(
            "overflow",
            format!(
                "entrada de {} bytes excede o limite v1 de {MAX_INPUT}",
                data.len()
            ),
        ));
    }
    let dict_words = index.map_or(0, |i| i.words);
    let word_count = data.len() / 2;
    let total_words = dict_words + word_count;
    let dict_bytes = index.map(|i| i.dictionary.as_slice()).unwrap_or(&[]);
    // word lookup: dicionário (do índice) para j < dict_words; dados para o
    // resto. Match sources podem alcançar o dicionário (off > i).
    let word_at = |i: usize| -> u16 {
        if i < dict_words {
            u16::from_be_bytes([dict_bytes[i * 2], dict_bytes[i * 2 + 1]])
        } else {
            u16::from_be_bytes([data[(i - dict_words) * 2], data[(i - dict_words) * 2 + 1]])
        }
    };
    // Posições de SAÍDA (mutáveis, pequenas); as do dicionário ficam no
    // índice imutável compartilhado.
    let mut out_positions: std::collections::HashMap<u16, Vec<usize>> =
        std::collections::HashMap::new();
    let mut out: Vec<u8> = Vec::with_capacity(data.len() / 2 + 16);
    let mut literals: Vec<u16> = Vec::new();
    // Busca gulosa do melhor match representável na posição j (lazy: o
    // chamador compara com a posição seguinte antes de decidir).
    let find_best = |out_positions: &std::collections::HashMap<u16, Vec<usize>>,
                     j: usize|
     -> Option<(usize, usize)> {
        let cur = word_at(j);
        // Janela de busca do codificador (estratégia, 1 word abaixo do teto do
        // formato): manter o offset <= 0x4000 garante que todo stream emitido é
        // lido para trás pelo 68000 — ver MATCH_LONG_FORMAT_MAX_OFFSET_WORDS.
        let window_start = j.saturating_sub(ENCODER_WINDOW_WORDS);
        fn consider(
            pos: usize,
            j: usize,
            total_words: usize,
            word_at: &dyn Fn(usize) -> u16,
            best: &mut Option<(usize, usize)>,
            checked: &mut usize,
        ) -> bool {
            // retorna true para parar a busca
            let off = j - pos;
            let mut len = 1usize;
            while j + len < total_words
                && word_at(j + len) == word_at(j + len - off)
                && len < LONG_MAX_LENGTH_WORDS
            {
                len += 1;
            }
            let better = match *best {
                Some((blen, boff)) => len > blen || (len == blen && off < boff),
                None => true,
            };
            if better {
                *best = Some((len, off));
            }
            *checked += 1;
            *checked >= 128 || best.is_some_and(|(l, _)| l >= LONG_MAX_LENGTH_WORDS)
        }
        let mut best: Option<(usize, usize)> = None;
        let mut checked = 0usize;
        if let Some(index) = index {
            if let Some(list) = index.positions.get(&cur) {
                for &pos in list.iter().rev() {
                    if pos < window_start {
                        break;
                    }
                    if consider(pos, j, total_words, &word_at, &mut best, &mut checked) {
                        break;
                    }
                }
            }
        }
        if let Some(list) = out_positions.get(&cur) {
            for &pos in list.iter().rev() {
                if pos < window_start {
                    break;
                }
                if consider(pos, j, total_words, &word_at, &mut best, &mut checked) {
                    break;
                }
            }
        }
        best.filter(|&(len, off)| {
            (len > MATCH_LONG_MIN_SIZE && off <= ENCODER_WINDOW_WORDS)
                || ((MATCH_MIN_SIZE..=0xF + MATCH_MIN_SIZE).contains(&len)
                    && off <= SHORT_MAX_OFFSET_WORDS)
        })
    };
    let mut i = 0usize;
    while i < word_count {
        let j = dict_words + i;
        // Lazy matching: se a próxima posição tem match estritamente maior,
        // emite literal agora e aproveita o match maior adiante.
        let current = find_best(&out_positions, j);
        let take_match = match current {
            None => false,
            Some((len, _)) => {
                if i + 1 >= word_count {
                    true
                } else {
                    match find_best(&out_positions, j + 1) {
                        Some((next_len, _)) => next_len <= len,
                        None => true,
                    }
                }
            }
        };
        match current.filter(|_| take_match) {
            Some((len, off)) if len >= 2 => {
                emit_segment(&mut out, &mut literals, Some((len, off)))?;
                out_positions.entry(word_at(j)).or_default().push(j);
                i += len;
            }
            _ => {
                if literals.len() == LITERAL_MAX_WORDS {
                    emit_segment(&mut out, &mut literals, None)?;
                }
                literals.push(word_at(j));
                out_positions.entry(word_at(j)).or_default().push(j);
                i += 1;
            }
        }
    }
    emit_segment(&mut out, &mut literals, None)?;
    out.extend_from_slice(&[0x00, 0x00]);
    if data.len() % 2 == 1 {
        out.extend_from_slice(&[0x80, data[data.len() - 1]]);
    } else {
        out.extend_from_slice(&[0x00, 0x00]);
    }
    Ok(out)
}

/// Emite um segmento (literals + match opcional) conforme `addSegment` do
/// compressor oficial. Formas: curto `token|(len-1)<<8|(off-1)`; longo
/// `token|(len-2)` + literais + word de offset negado.
fn emit_segment(
    out: &mut Vec<u8>,
    literals: &mut Vec<u16>,
    match_info: Option<(usize, usize)>,
) -> Result<(), CodecError> {
    loop {
        let lit = literals.len().min(LITERAL_MAX_WORDS);
        if let Some((len, off)) = match_info {
            let short = (MATCH_MIN_SIZE..=0xF + MATCH_MIN_SIZE).contains(&len)
                && off <= SHORT_MAX_OFFSET_WORDS;
            if short {
                let token = ((lit as u16) << 12)
                    | (((len - MATCH_MIN_SIZE) as u16) << 8)
                    | ((off - 1) as u16);
                out.extend_from_slice(&token.to_be_bytes());
                for word in literals.drain(..lit) {
                    out.extend_from_slice(&word.to_be_bytes());
                }
                return Ok(());
            }
            // Forma longa: offset dentro da janela do codificador, medida a
            // partir do fim do resultado (dicionário + saída).
            if len > MATCH_LONG_MIN_SIZE
                && off <= ENCODER_WINDOW_WORDS
                && literals.len() <= LITERAL_MAX_WORDS
            {
                let token = ((lit as u16) << 12) | ((len - MATCH_LONG_MIN_SIZE) as u16);
                out.extend_from_slice(&token.to_be_bytes());
                for word in literals.drain(..lit) {
                    out.extend_from_slice(&word.to_be_bytes());
                }
                // Negação de 15 bits, exatamente como o addSegment oficial.
                let encoded = ((-((off as i32) - 1)) as u32 as u16) & MATCH_LONG_OFFSET_MASK;
                out.extend_from_slice(&encoded.to_be_bytes());
                return Ok(());
            }
        }
        if lit == 0 {
            if match_info.is_none() {
                return Ok(());
            }
            let (mlen, moff) = match_info.unwrap();
            return Err(CodecError::new(
                "invalid_reference",
                format!(
                    "segmento com match não representável e sem literais pendentes (len={mlen}, off={moff})"
                ),
            ));
        }
        let token = (lit as u16) << 12;
        out.extend_from_slice(&token.to_be_bytes());
        for word in literals.drain(..lit) {
            out.extend_from_slice(&word.to_be_bytes());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dec(stream: &[u8]) -> Result<Lz4wDecoded, CodecError> {
        lz4w_decode(stream, &Lz4wLimits::default())
    }

    #[test]
    fn lz4w_empty_stream_decodes_to_empty() {
        let decoded = dec(&[0x00, 0x00, 0x00, 0x00]).expect("stream vazio válido");
        assert_eq!(decoded.data, Vec::<u8>::new());
        assert_eq!(decoded.bytes_consumed, 4);
    }

    #[test]
    fn lz4w_odd_single_byte() {
        let decoded = dec(&[0x00, 0x00, 0x80, 0xAB]).expect("byte ímpar");
        assert_eq!(decoded.data, vec![0xAB]);
        assert_eq!(decoded.bytes_consumed, 4);
    }

    #[test]
    fn lz4w_truncated_stream_is_structured_error() {
        let err = dec(&[0x00]).expect_err("stream truncado");
        assert_eq!(err.code, "truncated");
        // Terminador sem o word final também é truncado.
        let err = dec(&[0x00, 0x00]).expect_err("sem word final");
        assert_eq!(err.code, "truncated");
    }

    #[test]
    fn lz4w_literals_only_roundtrip() {
        let data: Vec<u8> = vec![0x11, 0x22, 0x33, 0x44, 0x55, 0x66];
        let stream = lz4w_encode(&data).expect("encode");
        let decoded = dec(&stream).expect("decode");
        assert_eq!(decoded.data, data);
        assert_eq!(decoded.bytes_consumed, stream.len());
    }

    #[test]
    fn lz4w_repeated_words_roundtrip_and_shrink() {
        let mut data = Vec::new();
        for _ in 0..64 {
            data.extend_from_slice(&0xA5C3u16.to_be_bytes());
        }
        data.extend_from_slice(&0x1234u16.to_be_bytes());
        let stream = lz4w_encode(&data).expect("encode");
        let decoded = dec(&stream).expect("decode");
        assert_eq!(decoded.data, data);
        assert!(
            stream.len() < data.len(),
            "stream {} vs dados {}",
            stream.len(),
            data.len()
        );
    }

    #[test]
    fn lz4w_long_match_encoding_roundtrip() {
        // Período de 0x120 words (> 0x100) força a forma LONGA de match;
        // o padrão idêntico a cada repetição dá encolhimento real. Dados
        // incomprimíveis expandem no LZ4W (overhead por segmento), o que o
        // contrato trata como needs_space, não como defeito.
        let mut data = Vec::new();
        for _ in 0..8 {
            for i in 0..16u16 {
                data.extend_from_slice(&(0x3000 + i).to_be_bytes());
            }
            for i in 0..0x110u16 {
                data.extend_from_slice(&i.to_be_bytes());
            }
        }
        let stream = lz4w_encode(&data).expect("encode");
        let decoded = dec(&stream).expect("decode");
        assert_eq!(decoded.data, data);
        assert!(
            stream.len() < data.len() / 2,
            "stream {} vs dados {}",
            stream.len(),
            data.len()
        );
    }

    #[test]
    fn lz4w_match_reference_beyond_history_rejected() {
        // Token: 0 literais, match curto len=1 offset=2 (sem histórico).
        let err = dec(&[0x00, 0x01, 0x00, 0x00, 0x00, 0x00]).expect_err("offset sem histórico");
        assert_eq!(err.code, "invalid_reference");
    }

    #[test]
    fn lz4w_dictionary_stream_rejected() {
        // Token: 0 lit, match longo extra=1, word com flag ROM source.
        let err =
            dec(&[0x00, 0x01, 0x80, 0x02, 0x00, 0x00, 0x00, 0x00]).expect_err("dicionário externo");
        assert_eq!(err.code, "invalid_reference");
        assert!(err.detail.contains("dicionário"));
    }

    #[test]
    fn lz4w_dictionary_stream_decodes_with_dictionary() {
        // Dicionário: words 0x4141, 0x4242. Stream: match longo ROM source de
        // 3 words apontando para o word 0 do dicionário.
        // offsetAdj no momento do offset: +1 (token) +1 (word longo) = 2.
        // S (words até a origem) = 2 (word 0 de 2) -> written = -(S+adj-1) = -3
        // -> 0x7FFD | 0x8000 = 0xFFFD.
        let dict = vec![0x41, 0x41, 0x42, 0x42];
        let stream = [0x00, 0x01, 0xFF, 0xFD, 0x00, 0x00, 0x00, 0x00];
        let decoded = lz4w_decode_with_dictionary(&stream, Some(&dict), &Lz4wLimits::default())
            .expect("decode com dicionário");
        // Cópia contígua de 3 words a partir do word 0: 0x4141, 0x4242 e o
        // word recém-escrito 0x4141 (cópia sobreposta avança).
        assert_eq!(decoded.data, vec![0x41, 0x41, 0x42, 0x42, 0x41, 0x41]);
        // token + word de offset + terminador + word final = 8 bytes.
        assert_eq!(decoded.bytes_consumed, 8);
        // Sem dicionário o mesmo stream é recusado de forma estruturada.
        let err = lz4w_decode_with_dictionary(&stream, None, &Lz4wLimits::default())
            .expect_err("sem dicionário");
        assert_eq!(err.code, "invalid_reference");
    }

    /// Roundtrip imediato do encoder com índice reutilizável sobre dados
    /// com dicionário — pega divergências encode→decode no próprio formato.
    #[test]
    fn lz4w_encode_index_roundtrip_with_dictionary() {
        let mut data = Vec::new();
        let mut x: u32 = 0x9e3779b9;
        for _ in 0..144 {
            x = x.wrapping_mul(1664525).wrapping_add(1013904223);
            data.extend_from_slice(&((x >> 16) as u16).to_be_bytes());
        }
        let mut dictionary = Vec::new();
        let mut y: u32 = 0x12345678;
        for _ in 0..2048 {
            y = y.wrapping_mul(1664525).wrapping_add(1013904223);
            dictionary.extend_from_slice(&((y >> 16) as u16).to_be_bytes());
        }
        let index = Lz4wDictionaryIndex::build(&dictionary).expect("índice");
        let stream = lz4w_encode_with_dictionary_index(&data, Some(&index)).expect("encode");
        let decoded =
            lz4w_decode_with_dictionary(&stream, Some(&dictionary), &Lz4wLimits::default())
                .expect("decode");
        assert_eq!(decoded.data, data, "roundtrip com dicionário divergiu");
        assert_eq!(decoded.bytes_consumed, stream.len());
    }

    // ---- Fronteira da janela não-ROM (contrato medido no 68000) ------------
    //
    // Casos construídos À MÃO, com o valor de cada word de offset calculado na
    // mão (não pela fórmula do produto): dicionário de `dict_words` words
    // zerados com `0xBEEF` no word 2, e um único match longo de 3 words cuja
    // fonte é exatamente esse word — `off = dict_words - 2`. O stream resultante
    // é `[0x0001][value][0x0000][0x0000]` e a saída esperada são os três words
    // `BE EF 00 00 00 00`.

    fn zero_dict(dict_words: usize) -> Vec<u8> {
        let mut d = vec![0u8; dict_words * 2];
        d[4] = 0xBE;
        d[5] = 0xEF;
        d
    }

    fn deep_long_stream(value: u16) -> Vec<u8> {
        let mut s = vec![0x00, 0x01];
        s.extend_from_slice(&value.to_be_bytes());
        s.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]);
        s
    }

    const DEEP_LONG_EXPECTED: [u8; 6] = [0xBE, 0xEF, 0x00, 0x00, 0x00, 0x00];

    fn decode_deep_long(dict_words: usize, value: u16) -> Result<Lz4wDecoded, CodecError> {
        lz4w_decode_with_dictionary(
            &deep_long_stream(value),
            Some(&zero_dict(dict_words)),
            &Lz4wLimits::default(),
        )
    }

    #[test]
    fn lz4w_non_rom_long_offset_16384_words_decodes() {
        // off 16384 -> value = -(16383) & 0x7FFF = 0xC001 & 0x7FFF = 0x4001.
        let decoded = decode_deep_long(16386, 0x4001).expect("off 16384 deve decodificar");
        assert_eq!(decoded.data, DEEP_LONG_EXPECTED);
        assert_eq!(decoded.bytes_consumed, 8, "saída completa consumida");
    }

    /// Regressão da confusão de constantes: o teto que o 68000 lê para trás é
    /// 16385 words (`value == 0x4000`), um word além da janela de 0x4000 que o
    /// codificador escolhe. O decoder recusava como inválido um stream que o
    /// hardware desempacota corretamente.
    #[test]
    fn lz4w_non_rom_long_offset_16385_words_is_the_measured_ceiling() {
        // off 16385 -> value = -(16384) & 0x7FFF = 0xC000 & 0x7FFF = 0x4000.
        let decoded = decode_deep_long(16387, 0x4000).expect("off 16385 é o teto do formato");
        assert_eq!(decoded.data, DEEP_LONG_EXPECTED);
        assert_eq!(decoded.bytes_consumed, 8);
    }

    #[test]
    fn lz4w_non_rom_long_offset_16386_words_is_rejected() {
        // off 16386 -> value = -(16385) & 0x7FFF = 0xBFFF & 0x7FFF = 0x3FFF:
        // no 68000 o displacement duplicado fica POSITIVO (leitura para frente,
        // aliasando a ROM) — bytes errados em silêncio, então é stream inválido.
        let err = decode_deep_long(16388, 0x3FFF).expect_err("off 16386 fora do formato");
        assert_eq!(err.code, "invalid_reference");
        assert!(
            err.detail.contains("16385"),
            "erro deve citar o teto medido: {err}"
        );
    }

    #[test]
    fn lz4w_non_rom_long_offset_one_word_uses_value_zero() {
        // value 0x0000 não é terminador: é o offset de 1 word (cópia do último
        // word escrito). Aqui a fonte é o próprio dicionário, off = 1.
        let dict = vec![0xAA, 0xBB];
        let stream = [0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
        let decoded = lz4w_decode_with_dictionary(&stream, Some(&dict), &Lz4wLimits::default())
            .expect("off 1");
        // 3 words a partir do word 0 do dicionário, com cópia sobreposta.
        assert_eq!(decoded.data, vec![0xAA, 0xBB, 0xAA, 0xBB, 0xAA, 0xBB]);
        assert_eq!(decoded.bytes_consumed, 8);
    }

    /// O teto de 16385 words pertence à referência **não-ROM** (contada a
    /// partir do fim da saída). A referência ROM-source é contada a partir do
    /// ponteiro de origem e só é limitada pelo histórico disponível
    /// (dicionário + saída). Confundir as duas constantes foi o defeito que
    /// fez o decoder recusar streams que o 68000 desempacota corretamente.
    #[test]
    fn lz4w_rom_source_reference_above_non_rom_ceiling_decodes() {
        // Dicionário de 20000 words; match longo de 3 words com ROM-source.
        // value 0xB9AF -> raw = ((-0xB9AF) & 0x7FFF) + 1 = 18001 + 1 = 18002;
        // offsetAdj no momento do word = 2 -> ajustado = 18000 words (> 16385).
        // Fonte: word 20000 - 18000 = 2000 do dicionário.
        let mut dict = vec![0u8; 40000];
        dict[4000] = 0xC0;
        dict[4001] = 0xDE;
        let stream = [0x00, 0x01, 0xB9, 0xAF, 0x00, 0x00, 0x00, 0x00];
        let decoded = lz4w_decode_with_dictionary(&stream, Some(&dict), &Lz4wLimits::default())
            .expect("referência ROM-source de 18000 words é lida pelo 68000");
        assert_eq!(decoded.data, vec![0xC0, 0xDE, 0x00, 0x00, 0x00, 0x00]);
        assert_eq!(decoded.bytes_consumed, 8);
    }

    #[test]
    fn lz4w_rom_source_reference_beyond_history_is_rejected() {
        // value 0xFFFA -> raw = 7, ajustado = 7 - 2 = 5 words, mas só há
        // 4 words de dicionário e nenhum de saída.
        let dict = vec![0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88];
        let stream = [0x00, 0x01, 0xFF, 0xFA, 0x00, 0x00, 0x00, 0x00];
        let err = lz4w_decode_with_dictionary(&stream, Some(&dict), &Lz4wLimits::default())
            .expect_err("fonte além do dicionário");
        assert_eq!(err.code, "invalid_reference");
        assert!(err.detail.contains("ROM source"), "erro: {err}");
    }

    #[test]
    fn lz4w_truncations_inside_segments_are_structured() {
        // Literal declarada mas ausente no stream.
        let err = lz4w_decode(&[0x30, 0x00, 0x11, 0x22], &Lz4wLimits::default())
            .expect_err("3 words literais, só 1 presente");
        assert_eq!(err.code, "truncated");
        // Match longo sem o word de offset.
        let err = lz4w_decode(&[0x00, 0x05, 0x00], &Lz4wLimits::default()).expect_err("sem offset");
        assert_eq!(err.code, "truncated");
        // Terminador sem o word final.
        let err = lz4w_decode(&[0xF0, 0x0F, 0xAA, 0xBB], &Lz4wLimits::default())
            .expect_err("sem word final");
        assert_eq!(err.code, "truncated");
    }

    /// A janela de busca do codificador é estratégia (0x4000), mas todo word
    /// não-ROM que ele emite precisa estar dentro do que o 68000 lê para trás
    /// (<= 16385). Varre os tokens produzidos e exige o teto do formato —
    /// é a regressão direta do caso r10 (off 18555 emitido pelo encoder antigo).
    #[test]
    fn lz4w_encoder_never_emits_unreadable_non_rom_offsets() {
        fn long_offsets(stream: &[u8]) -> Vec<usize> {
            let mut out = Vec::new();
            let mut ind = 0usize;
            loop {
                assert!(ind + 2 <= stream.len(), "token truncado em {ind}");
                let token = u16::from_be_bytes([stream[ind], stream[ind + 1]]);
                ind += 2;
                if token == 0 {
                    return out;
                }
                let lit = ((token >> 12) & 0xF) as usize;
                let nib = ((token >> 8) & 0xF) as usize;
                let byte = (token & 0xFF) as usize;
                ind += lit * 2;
                if nib == 0 && byte > 0 {
                    let v = u16::from_be_bytes([stream[ind], stream[ind + 1]]);
                    ind += 2;
                    if v & 0x8000 == 0 {
                        out.push((((-(v as i32)) as u32 as usize) & 0x7FFF) + 1);
                    }
                }
            }
        }
        // Dicionário grande o bastante para a janela antiga (0x8000 words) ser
        // alcançável, com repetições profundas que convidam matches longos.
        let mut dictionary = Vec::new();
        let mut y: u32 = 0x2f6e2b1;
        for _ in 0..40000 {
            y = y.wrapping_mul(1664525).wrapping_add(1013904223);
            dictionary.extend_from_slice(&((y >> 16) as u16).to_be_bytes());
        }
        let mut data = Vec::new();
        let mut z: u32 = 0x853c49e9;
        for _ in 0..4096 {
            z = z.wrapping_mul(1664525).wrapping_add(1013904223);
            data.extend_from_slice(&((z >> 16) as u16).to_be_bytes());
        }
        // Insere repetições que apontam para o fundo do dicionário, incluindo
        // a distância máxima alcançável pela janela do codificador.
        for k in [27_713usize, 30_000, 35_000, 39_990] {
            let src = k * 2;
            let w = [dictionary[src], dictionary[src + 1]];
            for _ in 0..40 {
                data.extend_from_slice(&w);
            }
        }
        let index = Lz4wDictionaryIndex::build(&dictionary).expect("índice");
        let stream = lz4w_encode_with_dictionary_index(&data, Some(&index)).expect("encode");
        let decoded =
            lz4w_decode_with_dictionary(&stream, Some(&dictionary), &Lz4wLimits::default())
                .expect("decode");
        assert_eq!(decoded.data, data, "roundtrip divergiu");
        let offsets = long_offsets(&stream);
        assert!(
            !offsets.is_empty(),
            "fixture sem match longo não-ROM não exercita a fronteira"
        );
        for off in &offsets {
            assert!(
                *off <= MATCH_LONG_FORMAT_MAX_OFFSET_WORDS,
                "encoder emitiu offset não-ROM {off} > teto lido pelo 68000"
            );
        }
    }

    /// Aceite BYOR (executar explicitamente: `cargo test --lib -- --ignored
    /// rex_codecs`): identificação estrutural na ROM congelada do corpus
    /// (HAMOOPIG). Exige o arquivo com SHA-256 esperado; ausência FALHA
    /// (nunca termina como PASS silencioso).
    #[test]
    #[ignore = "aceite BYOR: requer ROM local com SHA esperado; rodar com --ignored"]
    fn lz4w_hamoopig_corpus_streams_decode_with_header_size() {
        let rom_path = std::env::var("RDS_HAMOOPIG_ROM").unwrap_or_else(|_| {
            "/home/misael/Projects/RetroDevStudio-CANONICAL-2026-09-21/data/canonical-local-2026-09-21/corpus/references/hamoopig-reference.bin"
                .to_string()
        });
        let rom = std::fs::read(&rom_path)
            .unwrap_or_else(|e| panic!("aceite BYOR exige a ROM local ({rom_path}): {e}"));
        assert_eq!(
            super::super::rom_library::sha256_hex(&rom),
            "558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9",
            "ROM inesperada: o aceite BYOR é válido apenas para o corpus congelado"
        );
        let mut verified = 0usize;
        let mut size_mismatch = 0usize;
        for header_off in (0..rom.len().saturating_sub(8)).step_by(2) {
            let comp = u16::from_be_bytes([rom[header_off], rom[header_off + 1]]);
            if comp != 2 {
                continue;
            }
            let num_tile = u16::from_be_bytes([rom[header_off + 2], rom[header_off + 3]]) as usize;
            let ptr = u32::from_be_bytes([
                rom[header_off + 4],
                rom[header_off + 5],
                rom[header_off + 6],
                rom[header_off + 7],
            ]) as usize;
            if num_tile == 0 || num_tile > 2048 || ptr >= rom.len() || !ptr.is_multiple_of(2) {
                continue;
            }
            let expected = num_tile * 32;
            let stream = &rom[ptr..(ptr + expected * 2 + 256).min(rom.len())];
            match lz4w_decode_with_dictionary(stream, Some(&rom[..ptr]), &Lz4wLimits::default()) {
                Ok(decoded) if decoded.data.len() == expected => verified += 1,
                Ok(_) => size_mismatch += 1,
                Err(_) => {}
            }
        }
        // A ROM congelada do corpus tem ~190 recursos LZ4W reais; exigir um
        // piso alto garante que a verificação não passou por acaso.
        assert!(
            verified >= 100,
            "esperava >=100 streams LZ4W com tamanho exato, obtive {verified} (mismatch {size_mismatch})"
        );
    }

    #[test]
    fn lz4w_excessive_output_limit() {
        let limits = Lz4wLimits {
            max_output: 1,
            max_work: 1 << 32,
        };
        let err = lz4w_decode(&[0x10, 0x00, 0x11, 0x22, 0x00, 0x00, 0x00, 0x00], &limits)
            .expect_err("limite de saída");
        assert_eq!(err.code, "excessive_output");
    }

    #[test]
    fn lz4w_work_limit() {
        let limits = Lz4wLimits {
            max_output: 1 << 20,
            max_work: 0,
        };
        let err = lz4w_decode(&[0x00, 0x00, 0x00, 0x00], &limits).expect_err("work limit");
        assert_eq!(err.code, "work_limit");
    }

    #[test]
    fn lz4w_encode_short_match_used_for_nearby_repeat() {
        let mut data = Vec::new();
        for _ in 0..3 {
            data.extend_from_slice(&[0xAA, 0xBB, 0xCC, 0xDD]);
        }
        let stream = lz4w_encode(&data).expect("encode");
        let decoded = dec(&stream).expect("decode");
        assert_eq!(decoded.data, data);
        assert!(stream.len() < data.len());
    }

    #[test]
    fn lz4w_encode_odd_length_roundtrip() {
        let data = vec![0xDE, 0xAD, 0xBE, 0xEF, 0x99];
        let stream = lz4w_encode(&data).expect("encode");
        let decoded = dec(&stream).expect("decode");
        assert_eq!(decoded.data, data);
    }

    #[test]
    fn lz4w_encode_pseudorandom_roundtrip() {
        // Dados sem repetição: só literais, ainda assim roundtrip exato.
        let mut data = Vec::new();
        let mut x: u32 = 0x12345678;
        for _ in 0..512 {
            x = x.wrapping_mul(1664525).wrapping_add(1013904223);
            data.extend_from_slice(&(x as u16).to_be_bytes());
        }
        let stream = lz4w_encode(&data).expect("encode");
        let decoded = dec(&stream).expect("decode");
        assert_eq!(decoded.data, data);
        assert_eq!(decoded.bytes_consumed, stream.len());
    }

    /// Oráculo externo condicional: quando o `lz4w.jar` do toolchain pinado
    /// está presente, exige as duas direções do contrato:
    /// `decode(produto, encode(ref, dados)) == dados` e
    /// `decode(ref, encode(produto, dados)) == dados`.
    /// Sem o jar (ex.: CI), o teste é ignorado — os golden vectors autoriais
    /// acima continuam valendo.
    #[test]
    fn lz4w_differential_vs_official_jar() {
        use std::process::Command;
        let candidates = [
            std::env::var("RDS_SGDK_HOME").ok().map(std::path::PathBuf::from),
            Some(std::path::PathBuf::from(
                "/home/misael/.cache/retrodevstudio/dd99a22faa05edc480ce06da3fe3651e7a79578a629959dcdbd8cd50ac011377/toolchains/sgdk",
            )),
        ];
        let Some(sgdk) = candidates
            .into_iter()
            .flatten()
            .find(|p| p.join("bin/lz4w.jar").exists())
        else {
            eprintln!("ignorado: lz4w.jar do SGDK não encontrado no host");
            return;
        };
        let jar = sgdk.join("bin/lz4w.jar");
        let dir = std::env::temp_dir().join(format!("rex-lz4w-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("tmp");
        // Dado autoral com tiles 4bpp plausíveis (padrões + repetições).
        let mut data = Vec::new();
        let mut x: u32 = 0x12345678;
        for i in 0..4096u32 {
            x = x.wrapping_mul(1664525).wrapping_add(1013904223);
            if i % 7 < 3 {
                data.push(0x00);
            } else {
                data.push((x >> 24) as u8 & 0x0F);
            }
        }
        let input = dir.join("in.bin");
        let packed_by_ref = dir.join("ref.lz4w");
        std::fs::write(&input, &data).expect("write in");
        let run = |args: &[&str]| {
            Command::new("java")
                .arg("-jar")
                .arg(&jar)
                .args(args)
                .status()
                .expect("java")
                .success()
        };
        assert!(
            run(&[
                "p",
                input.to_str().unwrap(),
                packed_by_ref.to_str().unwrap(),
                "silent"
            ]),
            "lz4w.jar falhou ao empacotar a fixture"
        );
        let ref_stream = std::fs::read(&packed_by_ref).expect("read ref stream");
        // Direção 1: decode do produto sobre encode da referência.
        let decoded = lz4w_decode(&ref_stream, &Lz4wLimits::default())
            .unwrap_or_else(|e| panic!("decode do stream oficial falhou: {e}"));
        assert_eq!(
            decoded.data, data,
            "decode do produto divergiu do encode oficial"
        );
        // Direção 2: encode do produto decodificado pela referência.
        let ours = lz4w_encode(&data).expect("encode próprio");
        let packed_by_us = dir.join("ours.lz4w");
        let unpacked_by_ref = dir.join("ours-unpacked.bin");
        std::fs::write(&packed_by_us, &ours).expect("write ours");
        let unpack_output = Command::new("java")
            .arg("-jar")
            .arg(&jar)
            .args([
                "u",
                packed_by_us.to_str().unwrap(),
                unpacked_by_ref.to_str().unwrap(),
            ])
            .output()
            .expect("java");
        if !unpack_output.status.success() {
            panic!(
                "lz4w.jar falhou ao desempacotar o stream do produto ({} bytes): {} / {}",
                ours.len(),
                String::from_utf8_lossy(&unpack_output.stderr),
                String::from_utf8_lossy(&unpack_output.stdout)
            );
        }
        let roundtrip = std::fs::read(&unpacked_by_ref).expect("read unpacked");
        assert_eq!(
            roundtrip, data,
            "decode oficial divergiu do encode do produto"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
