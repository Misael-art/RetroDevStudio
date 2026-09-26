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
//! Codificador: parse por **custo explícito** (DP sobre o grafo
//! `posição × literais pendentes`) quando cabe nos orçamentos determinísticos
//! de `DP_MAX_*`; fora deles, ou para entradas acima da janela da DP, o
//! caminho é o guloso com tabela de candidatos por word (janela de 0x4000
//! words, no máximo 128 candidatos por posição) — histórico do v1. Os dois
//! emitem o mesmo formato; a estratégia é exposta por
//! `lz4w_encode_with_dictionary_index_explained` porque a medição publica o
//! antes/depois por recurso. Quem tem um espaço fixo para escrever usa
//! `lz4w_encode_with_dictionary_index_fitting`: ele prefere o guloso quando este
//! já cabe (pegada de escrita pequena — é ela que os dependentes de um recurso
//! vizinho sentem) e recorre à DP só quando não cabe. Nem um nem outro são o
//! parser ótimo do compressor oficial: com poda de candidatos a DP é um **teto**
//! do piso, e a recompressão ainda pode exceder o espaço original — o chamador
//! deve tratar o erro de espaço (contrato §4).

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
/// Nunca produz correspondências com dicionário externo (start=0). Estratégia:
/// ver comentário do módulo — DP de custo explícito com fallback guloso.
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
    Ok(lz4w_encode_with_dictionary_index_explained(data, index)?.0)
}

/// Como `lz4w_encode_with_dictionary_index`, expondo a estratégia efetivamente
/// usada. A medição de capacidade de edição publica um stream por recurso e
/// precisa dizer **por qual caminho** ele veio: DP e guloso podem deixar o
/// mesmo plain com comprimentos diferentes, e um número sem estratégia
/// associada não é reproduzível.
pub fn lz4w_encode_with_dictionary_index_explained(
    data: &[u8],
    index: Option<&Lz4wDictionaryIndex>,
) -> Result<(Vec<u8>, Lz4wEncodeStrategy), CodecError> {
    check_encode_input(data)?;
    if let Some(stream) = lz4w_encode_cost_dp(data, index)? {
        return Ok((stream, Lz4wEncodeStrategy::CostDp));
    }
    Ok((lz4w_encode_greedy(data, index)?, Lz4wEncodeStrategy::Greedy))
}

fn check_encode_input(data: &[u8]) -> Result<(), CodecError> {
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
    Ok(())
}

/// Codificação **com orçamento de espaço**: devolve o stream que cabe em
/// `max_output`, priorizando o guloso.
///
/// Por que não "sempre o mais curto"? Porque o guloso é um parse **local** e a
/// DP é um **re-parse global**: mudar um pixel pode reescrever tokens por todo o
/// recurso. O espaço logo antes de um recurso é o dicionário do vizinho
/// (`rom[..start]`), então uma pegada de escrita larga faz outro recurso
/// decodificar diferente e a transação rejeita com `dependent_modified`. Foi
/// exatamente isso que medimos no `0xc8cc8`: a edição de 1 pixel custa 1 byte no
/// guloso e reescreve a stream inteira na DP. Quem tem slot fixo quer o stream
/// que **cabe com a menor pegada**, não o mais curto.
pub fn lz4w_encode_with_dictionary_index_fitting(
    data: &[u8],
    index: Option<&Lz4wDictionaryIndex>,
    max_output: usize,
) -> Result<(Vec<u8>, Lz4wEncodeStrategy), CodecError> {
    check_encode_input(data)?;
    let greedy = lz4w_encode_greedy(data, index)?;
    if greedy.len() <= max_output {
        return Ok((greedy, Lz4wEncodeStrategy::Greedy));
    }
    lz4w_encode_with_dictionary_index_explained(data, index)
}

/// Estratégia de codificação LZ4W efetivamente usada num `Result` de encode.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lz4wEncodeStrategy {
    /// Parse por custo explícito dentro dos orçamentos determinísticos.
    CostDp,
    /// Guloso com lazy de 1 passo — o caminho do v1, e o fallback quando a DP
    /// estoura orçamento.
    Greedy,
}

/// Caminho guloso histórico.
fn lz4w_encode_greedy(
    data: &[u8],
    index: Option<&Lz4wDictionaryIndex>,
) -> Result<Vec<u8>, CodecError> {
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
        // Percorre dicionário e saída MESCLADOS por proximidade: o orçamento de
        // candidatos é compartilhado, e em regiões densas o dicionário gastava
        // os 128 antes de a saída ser consultada. Medido em
        // `docs/rex_profiles/LZ4W_ENCODER_444_VS_448_2026-09-26.md`.
        let empty: &[usize] = &[];
        let dict_list: &[usize] = index
            .and_then(|index| index.positions.get(&cur))
            .map_or(empty, Vec::as_slice);
        let out_list: &[usize] = out_positions.get(&cur).map_or(empty, Vec::as_slice);
        let (mut di, mut oi) = (dict_list.len(), out_list.len());
        while di > 0 || oi > 0 {
            let take_dict = match (di > 0, oi > 0) {
                (true, true) => dict_list[di - 1] >= out_list[oi - 1],
                (true, false) => true,
                (false, true) => false,
                (false, false) => break,
            };
            let pos = if take_dict {
                di -= 1;
                dict_list[di]
            } else {
                oi -= 1;
                out_list[oi]
            };
            if pos < window_start {
                // Ordem mesclada descendente: se o mais próximo ficou fora da
                // janela, todos os restantes também ficaram.
                break;
            }
            if consider(pos, j, total_words, &word_at, &mut best, &mut checked) {
                break;
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
    finish_lz4w_stream(out, literals, data)
}

/// Orçamentos da DP de custo explícito. São **determinísticos** (dependem só
/// da entrada, nunca de relógio): um orçamento de tempo faria o mesmo plain
/// gerar streams diferentes em máquinas diferentes, o que quebraria o roundtrip
/// byte a byte das rodadas de benchmark e a evidência vinculada ao binário.
/// Estourou qualquer um → `None` → o chamador usa o guloso.
///
/// Plain máximo coberto: 0x8000 words (64 KiB). Acima disso a tabela `(n+1)×15`
/// deixaria de ser um custo previsível na thread do app.
const DP_MAX_PLAIN_WORDS: usize = 0x8000;
/// Mesmos 128 candidatos por posição do guloso: a DP **não alarga** a busca, só
/// escolhe melhor dentro dela. Com essa poda o resultado é um teto do piso do
/// formato, não o piso — vale enquanto o gap for positivo, e é assim que a
/// medição publica.
const DP_MAX_SOURCES_PER_POSITION: usize = 128;
/// Comparações de word permitidas na varredura de fontes da rodada inteira.
/// No pior caso cada comparação estende um match, então este é também o teto de
/// trabalho da fase de busca.
const DP_MAX_WORD_COMPARISONS: u64 = 24_000_000;

/// Transição escolhida pela DP num estado `(posição, literais pendentes)`.
#[derive(Debug, Clone, Copy)]
enum DpMove {
    /// Só literais, sem fechar match.
    Lit,
    /// 15 literais acumulados: o token não comporta mais nenhum.
    Flush,
    /// Match curto: `2..=16` words com `off <= 0x100` (cabe no descritor).
    Short { len: u16, off: u16 },
    /// Match longo: `3..=257` words + uma word de offset.
    Long { len: u16, off: u16 },
}

/// Parse por custo explícito do formato LZ4W: programação dinâmica sobre o
/// grafo `(posição i, literais pendentes p)`, com o custo real de cada token
/// (1 descritor + `lit` literais + 1 word de offset se o match é longo) e o
/// terminador de 2 words fora do modelo.
///
/// O estado `p` não é decorativo: um token carrega no máximo 15 literais, então
/// a pendência muda o custo do futuro. Um DP que omite `p` dá resposta errada —
/// foi o bug do port de `LZ4W.java`, que piorou o produto (382 B contra 380 B)
/// e foi revertido.
///
/// Exato sobre o grafo porque os comprimentos alcançáveis por uma classe de
/// fonte formam intervalos contíguos (`[2, max_curto]`, `[3, max_longo]`: um
/// prefixo de match também é match), e a base do token não depende de `p` —
/// basta o mínimo de `dp[i+k][0]` sobre o intervalo, e a testemunha do
/// comprimento máximo serve para qualquer `k` menor. **Matches não maximais
/// entram**: restringir o DP ao comprimento máximo por fonte foi refutado por
/// busca exaustiva em `scripts/rex_profiles/integrator/lz4w_recompress/dp_floor.py`
/// (26.ª entrada: 10 words contra 9), porque parar um match mais cedo muda a
/// posição seguinte e ali o próximo token pode gastar menos.
///
/// Retorna `Ok(None)` quando o orçamento determinístico não cabe.
fn lz4w_encode_cost_dp(
    data: &[u8],
    index: Option<&Lz4wDictionaryIndex>,
) -> Result<Option<Vec<u8>>, CodecError> {
    let word_count = data.len() / 2;
    if word_count > DP_MAX_PLAIN_WORDS {
        return Ok(None);
    }
    let dict_bytes = index
        .map(|i| i.dictionary.as_slice())
        .unwrap_or(&[] as &[u8]);
    let dict_words = index.map_or(0, |i| i.words);
    let total_words = dict_words + word_count;
    // Espaço combinado dicionário+plain, com offsets medidos a partir do FIM
    // dele e sem o bit 0x8000 — a mesma convenção que o desempacotador 68000
    // validou (docs/rex_profiles/LZ4W_68K_ORACLE.md).
    let word_at = |abs: usize| -> u16 {
        if abs < dict_words {
            u16::from_be_bytes([dict_bytes[abs * 2], dict_bytes[abs * 2 + 1]])
        } else {
            let rel = (abs - dict_words) * 2;
            u16::from_be_bytes([data[rel], data[rel + 1]])
        }
    };
    // Fontes do plain por valor de word (posições ABSOLUTAS, ordem crescente).
    // Diferente do guloso, a DP varre o grafo de trás para frente e precisa do
    // mapa completo antes de começar; o dicionário já vem mapeado no índice.
    let mut plain_sources: std::collections::HashMap<u16, Vec<usize>> =
        std::collections::HashMap::with_capacity(word_count);
    for i in 0..word_count {
        plain_sources
            .entry(word_at(dict_words + i))
            .or_default()
            .push(dict_words + i);
    }
    const SHORT_MAX_LEN: usize = 0xF + MATCH_MIN_SIZE;
    const LONG_MIN_LEN: usize = MATCH_LONG_MIN_SIZE + 1;
    let cells = (word_count + 1) * LITERAL_MAX_WORDS;
    let at = |i: usize, p: usize| -> usize { i * LITERAL_MAX_WORDS + p };
    let mut dp = vec![0u32; cells];
    let mut mv = vec![DpMove::Lit; cells];
    for p in 0..LITERAL_MAX_WORDS {
        dp[at(word_count, p)] = if p > 0 { 1 + p as u32 } else { 0 };
    }
    let mut comparisons: u64 = 0u64;
    for i in (0..word_count).rev() {
        let j = dict_words + i;
        let window_start = j.saturating_sub(ENCODER_WINDOW_WORDS);
        let cur = word_at(j);
        let empty: &[usize] = &[];
        let dict_all: &[usize] = index
            .and_then(|idx| idx.positions.get(&cur))
            .map_or(empty, Vec::as_slice);
        let plain_all: &[usize] = plain_sources.get(&cur).map_or(empty, Vec::as_slice);
        // A fonte tem de estar ANTES da posição corrente (o unpacker só lê para
        // trás) e dentro da janela. Listas crescentes => os recortes são por
        // bipartição e a varredura desce da mais próxima.
        let di_lo = dict_all.partition_point(|&s| s < window_start);
        let pi_hi = plain_all.partition_point(|&s| s < j);
        let (mut di, mut pi) = (dict_all.len(), pi_hi);
        let (mut max_short, mut src_short) = (0usize, 0usize);
        let (mut max_long, mut src_long) = (0usize, 0usize);
        let mut inspected = 0usize;
        while inspected < DP_MAX_SOURCES_PER_POSITION && (di > di_lo || pi > 0) {
            let take_dict = match (di > di_lo, pi > 0) {
                (true, true) => dict_all[di - 1] >= plain_all[pi - 1],
                (true, false) => true,
                (false, true) => false,
                (false, false) => break,
            };
            let src = if take_dict {
                di -= 1;
                dict_all[di]
            } else {
                pi -= 1;
                plain_all[pi]
            };
            if src < window_start {
                // Ordem descendente mesclada: se a mais próxima ficou fora, as
                // restantes também ficaram.
                break;
            }
            inspected += 1;
            let off = j - src;
            let mut len = 1usize;
            while j + len < total_words && len < LONG_MAX_LENGTH_WORDS {
                comparisons += 1;
                if word_at(j + len) != word_at(j + len - off) {
                    break;
                }
                len += 1;
            }
            if len > max_long {
                max_long = len;
                src_long = src;
            }
            if off <= SHORT_MAX_OFFSET_WORDS && len > max_short {
                max_short = len;
                src_short = src;
            }
            // Ninguém alcança mais que o teto do formato, e os que vêm depois
            // são mais distantes: a classe curta já foi coberta.
            if max_long >= LONG_MAX_LENGTH_WORDS {
                break;
            }
            if comparisons > DP_MAX_WORD_COMPARISONS {
                return Ok(None);
            }
        }
        // Melhor custo de FECHAR um match de k words em i, por classe. A base
        // independe de p, então o mínimo do intervalo é o mesmo p qualquer.
        let mut best_short: (u32, usize) = (u32::MAX, 0);
        if max_short >= 2 {
            for k in 2..=max_short.min(SHORT_MAX_LEN) {
                let cand = 1 + dp[at(i + k, 0)];
                if cand < best_short.0 {
                    best_short = (cand, k);
                }
            }
        }
        let mut best_long: (u32, usize) = (u32::MAX, 0);
        if max_long >= LONG_MIN_LEN {
            for k in LONG_MIN_LEN..=max_long.min(LONG_MAX_LENGTH_WORDS) {
                let cand = 2 + dp[at(i + k, 0)];
                if cand < best_long.0 {
                    best_long = (cand, k);
                }
            }
        }
        for p in (0..LITERAL_MAX_WORDS).rev() {
            let (mut cost, mut choice) = if p == LITERAL_MAX_WORDS - 1 {
                (
                    dp[at(i + 1, 0)] + 1 + LITERAL_MAX_WORDS as u32,
                    DpMove::Flush,
                )
            } else {
                (dp[at(i + 1, p + 1)], DpMove::Lit)
            };
            if best_short.1 != 0 {
                let cand = best_short.0 + p as u32;
                if cand < cost {
                    cost = cand;
                    choice = DpMove::Short {
                        len: best_short.1 as u16,
                        off: (j - src_short) as u16,
                    };
                }
            }
            if best_long.1 != 0 {
                let cand = best_long.0 + p as u32;
                if cand < cost {
                    cost = cand;
                    choice = DpMove::Long {
                        len: best_long.1 as u16,
                        off: (j - src_long) as u16,
                    };
                }
            }
            dp[at(i, p)] = cost;
            mv[at(i, p)] = choice;
        }
    }

    // Reconstrução: mesmo emissor do caminho guloso (`emit_segment`), para que
    // a codificação de tokens tenha UMA implementação no produto.
    let mut out: Vec<u8> = Vec::with_capacity(word_count + 16);
    let mut literals: Vec<u16> = Vec::new();
    let mut i = 0usize;
    while i < word_count {
        let j = dict_words + i;
        match mv[at(i, literals.len())] {
            DpMove::Lit => {
                literals.push(word_at(j));
                i += 1;
            }
            DpMove::Flush => {
                literals.push(word_at(j));
                debug_assert_eq!(literals.len(), LITERAL_MAX_WORDS, "flush fora de 15");
                emit_segment(&mut out, &mut literals, None)?;
                i += 1;
            }
            DpMove::Short { len, off } => {
                debug_assert!(
                    (2..=SHORT_MAX_LEN).contains(&(len as usize))
                        && off >= 1
                        && off as usize <= SHORT_MAX_OFFSET_WORDS,
                    "match curto irrepresentável: len={len} off={off}"
                );
                emit_segment(&mut out, &mut literals, Some((len as usize, off as usize)))?;
                i += len as usize;
            }
            DpMove::Long { len, off } => {
                debug_assert!(
                    (LONG_MIN_LEN..=LONG_MAX_LENGTH_WORDS).contains(&(len as usize))
                        && off >= 1
                        && off as usize <= ENCODER_WINDOW_WORDS,
                    "match longo irrepresentável: len={len} off={off}"
                );
                emit_segment(&mut out, &mut literals, Some((len as usize, off as usize)))?;
                i += len as usize;
            }
        }
    }
    Ok(Some(finish_lz4w_stream(out, literals, data)?))
}

/// Fecha o stream: flush do que restou de literais + terminador de duas words
/// (`0x0000` e o word final, que carrega o byte ímpar quando existe). Convenção
/// única para os dois caminhos do codificador.
fn finish_lz4w_stream(
    mut out: Vec<u8>,
    mut literals: Vec<u16>,
    data: &[u8],
) -> Result<Vec<u8>, CodecError> {
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

    // ---- DP de custo explícito: a palavra "ótima" tem de ter referência ----
    //
    // O port para Rust NÃO herda a validação do instrumento Python: foi
    // exatamente um port sem revalidação (`LZ4W.java`) que piorou o produto.
    // Estas barreiras comparam o DP do produto com uma busca exaustiva escrita
    // aqui mesmo (DFS sobre todas as fontes e todos os comprimentos
    // representáveis), e exigem que o stream emitido volte ao plain pelo decoder
    // do produto.

    const EXAUSTIVA_SHORT_MAX_LEN: usize = 0xF + MATCH_MIN_SIZE;
    const EXAUSTIVA_LONG_MIN_LEN: usize = MATCH_LONG_MIN_SIZE + 1;

    /// Custo ótimo em words (sem o terminador) por busca exaustiva com memo
    /// sobre o estado `(posição, literais pendentes)`.
    ///
    /// Enumera fonte por fonte e comprimento por comprimento: é a referência
    /// lenta, não um segundo modelo. Só roda em entradas pequenas.
    fn custo_exaustivo(
        total: &[u16],
        dict_words: usize,
        i: usize,
        p: usize,
        memo: &mut std::collections::HashMap<(usize, usize), u32>,
    ) -> u32 {
        let n = total.len() - dict_words;
        if i == n {
            return if p > 0 { 1 + p as u32 } else { 0 };
        }
        if let Some(&v) = memo.get(&(i, p)) {
            return v;
        }
        let j = dict_words + i;
        let mut best = if p == LITERAL_MAX_WORDS - 1 {
            1 + LITERAL_MAX_WORDS as u32 + custo_exaustivo(total, dict_words, i + 1, 0, memo)
        } else {
            custo_exaustivo(total, dict_words, i + 1, p + 1, memo)
        };
        for src in (j.saturating_sub(ENCODER_WINDOW_WORDS)..j).rev() {
            if total[src] != total[j] {
                continue;
            }
            let off = j - src;
            let mut len = 1usize;
            while j + len < total.len()
                && len < LONG_MAX_LENGTH_WORDS
                && total[j + len] == total[j + len - off]
            {
                len += 1;
            }
            if off <= SHORT_MAX_OFFSET_WORDS {
                for k in 2..=len.min(EXAUSTIVA_SHORT_MAX_LEN) {
                    let cand = 1 + p as u32 + custo_exaustivo(total, dict_words, i + k, 0, memo);
                    best = best.min(cand);
                }
            }
            for k in EXAUSTIVA_LONG_MIN_LEN..=len.min(LONG_MAX_LENGTH_WORDS) {
                let cand = 2 + p as u32 + custo_exaustivo(total, dict_words, i + k, 0, memo);
                best = best.min(cand);
            }
        }
        memo.insert((i, p), best);
        best
    }

    /// Caminha os tokens de um stream: `(literais, comprimento do match,
    /// offset, é forma longa?)`. `len = 0` é token de só literais.
    fn tokens_do_stream(stream: &[u8]) -> Vec<(usize, usize, usize, bool)> {
        let mut out = Vec::new();
        let mut i = 0usize;
        loop {
            assert!(i + 2 <= stream.len(), "token truncado em {i}");
            let token = u16::from_be_bytes([stream[i], stream[i + 1]]);
            i += 2;
            let lit = ((token >> 12) & 0xF) as usize;
            let nib = ((token >> 8) & 0xF) as usize;
            let byte = (token & 0xFF) as usize;
            i += lit * 2;
            if token == 0 {
                return out;
            }
            if nib == 0 && byte > 0 {
                assert!(i + 2 <= stream.len(), "offset truncado em {i}");
                let v = u16::from_be_bytes([stream[i], stream[i + 1]]);
                i += 2;
                assert_eq!(v & 0x8000, 0, "o produto não emite fonte ROM");
                let off = (((-(v as i32)) as u32 as usize) & 0x7FFF) + 1;
                out.push((lit, byte + 2, off, true));
            } else if nib > 0 {
                out.push((lit, nib + 1, byte + 1, false));
            } else {
                out.push((lit, 0, 0, false));
            }
        }
    }

    /// DP == busca exaustiva. Onde a poda de 128 candidatos por posição NÃO
    /// alcança a entrada, a igualdade é exigida; onde ela alcança, a DP é um
    /// **teto** do ótimo e só se exige `não pior que o guloso`.
    #[test]
    fn lz4w_encode_dp_iguala_busca_exaustiva_em_entradas_pequenas() {
        // (rótulo, tentativas, semente, n mín, n máx, dict mín, dict máx,
        //  alfabeto mín, alfabeto máx)
        let configs: [(&str, usize, u32, usize, usize, usize, usize, u32, u32); 5] = [
            ("aleatória pequena", 300, 777, 1, 10, 0, 6, 1, 4),
            ("semente histórica", 300, 20260926, 1, 10, 0, 6, 1, 4),
            ("flush de 15 literais", 90, 31337, 15, 34, 4, 40, 2, 8),
            ("repetição (tetos de 16 e 257)", 15, 6, 20, 40, 1, 6, 1, 1),
            (
                "fontes além de 0x100 (só a forma longa alcança)",
                120,
                90210,
                6,
                34,
                250,
                254,
                3,
                4,
            ),
        ];
        let mut iguais = 0usize;
        let mut podados = 0usize;
        let mut melhores_que_guloso = 0usize;
        let mut teve_match_longo = 0usize;
        let mut teve_match_curto = 0usize;
        for (rotulo, trials, seed, n_min, n_max, d_min, d_max, a_min, a_max) in configs {
            let mut x = seed;
            let mut rnd = move || {
                x = x.wrapping_mul(1664525).wrapping_add(1013904223);
                (x >> 16) as usize
            };
            for t in 0..trials {
                let span = |lo: usize, hi: usize, rnd: &mut dyn FnMut() -> usize| {
                    lo + (rnd() % (hi - lo + 1))
                };
                let n = span(n_min, n_max, &mut rnd);
                let d = span(d_min, d_max, &mut rnd);
                let alpha = span(a_min as usize, a_max as usize, &mut rnd) as u32;
                let total: Vec<u16> = (0..(d + n))
                    .map(|_| ((rnd() as u32 % alpha) as u16) + 0x100)
                    .collect();
                let dict_bytes: Vec<u8> = total[..d].iter().flat_map(|w| w.to_be_bytes()).collect();
                let data: Vec<u8> = total[d..].iter().flat_map(|w| w.to_be_bytes()).collect();
                let index = Lz4wDictionaryIndex::build(&dict_bytes).expect("índice");
                let dp = lz4w_encode_cost_dp(&data, Some(&index))
                    .expect("encode")
                    .unwrap_or_else(|| panic!("{rotulo} trial {t}: DP caiu no orçamento"));
                let guloso = lz4w_encode_greedy(&data, Some(&index)).expect("guloso");
                assert!(
                    dp.len() <= guloso.len(),
                    "{rotulo} trial {t}: DP ({} B) pior que o guloso ({} B) — o modelo \
                     não é uma restrição do mesmo grafo",
                    dp.len(),
                    guloso.len()
                );
                if dp.len() < guloso.len() {
                    melhores_que_guloso += 1;
                }
                // A poda de candidatos só liga se houver mais de
                // DP_MAX_SOURCES_PER_POSITION fontes iguais dentro da janela.
                let fontes_max = (0..n).fold(0usize, |acc, i| {
                    let j = d + i;
                    let iguais = (j.saturating_sub(ENCODER_WINDOW_WORDS)..j)
                        .filter(|&s| total[s] == total[j])
                        .count();
                    acc.max(iguais)
                });
                let mut memo = std::collections::HashMap::new();
                let otimo = custo_exaustivo(&total, d, 0, 0, &mut memo) + 2;
                if fontes_max <= DP_MAX_SOURCES_PER_POSITION {
                    assert_eq!(
                        dp.len() / 2,
                        otimo as usize,
                        "{rotulo} trial {t} (n={n} d={d} fontes_max={fontes_max}): DP {} \
                         words, busca exaustiva {otimo} — total={total:?}",
                        dp.len() / 2
                    );
                    iguais += 1;
                } else {
                    podados += 1;
                    assert!(
                        dp.len() / 2 >= otimo as usize,
                        "{rotulo} trial {t}: stream menor que o ótimo exaustivo — o modelo \
                         de custo está errado"
                    );
                }
                let back =
                    lz4w_decode_with_dictionary(&dp, Some(&dict_bytes), &Lz4wLimits::default())
                        .unwrap_or_else(|e| panic!("{rotulo} trial {t}: decode: {e}"));
                assert_eq!(back.data, data, "{rotulo} trial {t}: não reproduz o plain");
                assert_eq!(
                    back.bytes_consumed,
                    dp.len(),
                    "{rotulo} trial {t}: stream consumido parcialmente"
                );
                for (_lit, len, off, longo) in tokens_do_stream(&dp) {
                    if longo {
                        teve_match_longo += 1;
                        assert!(
                            (EXAUSTIVA_LONG_MIN_LEN..=LONG_MAX_LENGTH_WORDS).contains(&len)
                                && off >= 1
                                && off <= ENCODER_WINDOW_WORDS,
                            "match longo irrepresentável: len={len} off={off}"
                        );
                    } else if len > 0 {
                        teve_match_curto += 1;
                        assert!(
                            (2..=EXAUSTIVA_SHORT_MAX_LEN).contains(&len)
                                && off >= 1
                                && off <= SHORT_MAX_OFFSET_WORDS,
                            "match curto irrepresentável: len={len} off={off}"
                        );
                    }
                }
            }
        }
        assert_eq!(
            podados, 0,
            "configuração pequena acionou a poda de candidatos"
        );
        assert!(
            iguais >= 800,
            "só {iguais} casos comparados com a exaustiva"
        );
        // Non-vacuidade: sem estas contagens o teste não diria nada sobre os
        // caminhos do grafo.
        assert!(teve_match_longo > 0, "nenhum match longo emitido");
        assert!(teve_match_curto > 0, "nenhum match curto emitido");
        assert!(
            melhores_que_guloso > 0,
            "a DP nunca venceu o guloso nos {iguais} casos comparados — teste vazio"
        );
    }

    /// Fontes além de `0x100` words só são alcançáveis pela forma longa, e a
    /// repetição pura é o único caminho que encosta no teto de 257 words —
    /// ambos invisíveis em entradas pequenas aleatórias.
    #[test]
    fn lz4w_encode_dp_fontes_distantes_e_teto_de_comprimento() {
        // Três words distintos a 295 words de distância, e nenhum deles aparece
        // perto da posição corrente: a única forma de fechar o plain é o match
        // longo, e nenhum match curto empata. (Com `dict = [0xBEEF, 0, 0]` e
        // plain `BEEF,0,0` havia uma fonte curta a `off = 3` que empatava em
        // custo — o DP escolhia o caminho barato e o teste não provaria nada.)
        let mut dict_words = vec![0x1111u16; 300];
        dict_words[5..8].copy_from_slice(&[0xBEEF, 0xCAFE, 0xFACE]);
        let dict_bytes: Vec<u8> = dict_words.iter().flat_map(|w| w.to_be_bytes()).collect();
        let data: Vec<u8> = [0xBEEFu16, 0xCAFE, 0xFACE]
            .iter()
            .flat_map(|w| w.to_be_bytes())
            .collect();
        let index = Lz4wDictionaryIndex::build(&dict_bytes).expect("índice");
        let dp = lz4w_encode_cost_dp(&data, Some(&index))
            .expect("encode")
            .expect("no orçamento");
        let tokens = tokens_do_stream(&dp);
        assert_eq!(
            tokens.as_slice(),
            &[(0usize, 3usize, 295usize, true)][..],
            "a fonte além de 0x100 words tinha de sair como um único match longo \
             de 3 words (off = 300 - 5 = 295)"
        );
        assert!(tokens[0].2 > SHORT_MAX_OFFSET_WORDS);
        // tudo coberto por um token: 1 descritor + 1 offset + 2 de terminador.
        assert_eq!(dp.len(), 8, "8 B é o ótimo aqui; literais custariam 12 B");
        let back = lz4w_decode_with_dictionary(&dp, Some(&dict_bytes), &Lz4wLimits::default())
            .expect("decode");
        assert_eq!(back.data, data);
        assert_eq!(back.bytes_consumed, dp.len());

        // Repetição pura: 300 words idênticas com 1 de dicionário.
        let mut dict_bytes = Vec::new();
        dict_bytes.extend_from_slice(&0xAA55u16.to_be_bytes());
        let data: Vec<u8> = (0..300).flat_map(|_| 0xAA55u16.to_be_bytes()).collect();
        let index = Lz4wDictionaryIndex::build(&dict_bytes).expect("índice");
        let dp = lz4w_encode_cost_dp(&data, Some(&index))
            .expect("encode")
            .expect("no orçamento");
        let guloso = lz4w_encode_greedy(&data, Some(&index)).expect("guloso");
        assert!(dp.len() <= guloso.len(), "DP pior que o guloso em RLE");
        let longest = tokens_do_stream(&dp)
            .iter()
            .map(|(_, len, _, _)| *len)
            .max()
            .unwrap_or(0);
        assert_eq!(
            longest, LONG_MAX_LENGTH_WORDS,
            "nenhum match encostou no teto de 257 words"
        );
        let back = lz4w_decode_with_dictionary(&dp, Some(&dict_bytes), &Lz4wLimits::default())
            .expect("decode");
        assert_eq!(back.data, data);
    }

    /// O recorte de janela é o que impede o codificador de emitir um offset que
    /// o desempacotador não lê. Aqui a única fonte igual está a 20 000 words —
    /// além das 0x4000 do codificador. O que se exige é que esse prefixo longo
    /// **não mude nenhum byte** do stream: se a fonte vazasse, o dicionário
    /// produziria um stream menor que o mesmo plain sem dicionário. (A forma
    /// exata do stream não é a asserção: com `data = C0DE×4` a posição 0 vira
    /// literal e as três seguintes um match curto de `off = 1` por RLE, que é
    /// legal e mais barato do que qualquer coisa que o prefixo ofereceria.)
    #[test]
    fn lz4w_encode_dp_recorta_a_janela_do_codificador() {
        const DICT_WORDS: usize = 20_000;
        let mut dict_words = vec![0u16; DICT_WORDS];
        dict_words[0] = 0xC0DE;
        let dict_bytes: Vec<u8> = dict_words.iter().flat_map(|w| w.to_be_bytes()).collect();
        let data: Vec<u8> = (0..4u16)
            .map(|_| 0xC0DEu16)
            .flat_map(|w| w.to_be_bytes())
            .collect();
        let index = Lz4wDictionaryIndex::build(&dict_bytes).expect("índice");
        let dp = lz4w_encode_cost_dp(&data, Some(&index))
            .expect("encode")
            .expect("no orçamento");
        let sem_dict = lz4w_encode_cost_dp(&data, None)
            .expect("encode")
            .expect("no orçamento");
        let tokens = tokens_do_stream(&dp);
        assert!(
            tokens
                .iter()
                .all(|(_, _, off, _)| *off <= ENCODER_WINDOW_WORDS),
            "offset além da janela do codificador: {tokens:?}"
        );
        assert_eq!(
            dp,
            sem_dict,
            "o prefixo fora de janela alterou o stream (fonte proibida usada): \
             com dicionário {tokens:?} vs. sem dicionário {:?}",
            tokens_do_stream(&sem_dict)
        );
        let back = lz4w_decode_with_dictionary(&dp, Some(&dict_bytes), &Lz4wLimits::default())
            .expect("decode");
        assert_eq!(back.data, data);
        // e o mesmo stream decodifica sem dicionário: nenhuma referência sai do
        // histórico próprio.
        let back = lz4w_decode(&dp, &Lz4wLimits::default()).expect("decode");
        assert_eq!(back.data, data);
    }

    /// Quarenta words duas a duas distintas: nenhum match é possível, então o
    /// modelo é obrigado a fechar tokens com os 15 literais cheios — o caminho
    /// do `flush`, invisível nas configurações aleatórias do teste grande (onde
    /// a compressão sempre desfaz 16 literais seguidos).
    #[test]
    fn lz4w_encode_dp_emite_flush_de_15_literais() {
        let palavras: Vec<u16> = (0..40u16).map(|i| 0x4000 + i).collect();
        let data: Vec<u8> = palavras.iter().flat_map(|w| w.to_be_bytes()).collect();
        let dp = lz4w_encode_cost_dp(&data, None)
            .expect("encode")
            .expect("no orçamento");
        let tokens = tokens_do_stream(&dp);
        assert!(
            tokens
                .iter()
                .any(|(lit, len, _, _)| *lit == LITERAL_MAX_WORDS && *len == 0),
            "nenhum token com os 15 literais cheios: {tokens:?}"
        );
        assert_eq!(
            tokens
                .iter()
                .map(|(lit, len, _, _)| lit + len)
                .sum::<usize>(),
            palavras.len(),
            "os tokens não cobrem o plain inteiro: {tokens:?}"
        );
        let mut memo = std::collections::HashMap::new();
        let otimo = custo_exaustivo(&palavras, 0, 0, 0, &mut memo) + 2;
        assert_eq!(
            dp.len() / 2,
            otimo as usize,
            "3 descritores + 40 literais + 2 de terminador = 45 words"
        );
        assert_eq!(otimo, 45);
        let back = lz4w_decode(&dp, &Lz4wLimits::default()).expect("decode");
        assert_eq!(back.data, data);
        assert_eq!(back.bytes_consumed, dp.len());
    }

    /// Política com orçamento de espaço: quando o guloso já cabe no espaço, ele
    /// é o escolhido; a DP entra como resgate. Que existem entradas em que a DP
    /// vence o guloso é aferido aqui (varredura determinística), não presumido —
    /// sem um caso assim os dois caminhos seriam indistinguíveis pelo comprimento
    /// e o teste não diria nada.
    #[test]
    fn lz4w_encode_fitting_so_usa_o_resgate_de_dp_quando_o_guloso_nao_cabe() {
        // (tentativas, semente, n mín, n máx, dict mín, dict máx, alf mín, alf máx)
        let configs: [(usize, u32, usize, usize, usize, usize, u32, u32); 3] = [
            (300, 777, 1, 10, 0, 6, 1, 4),
            (300, 20260926, 1, 10, 0, 6, 1, 4),
            (300, 90210, 15, 34, 4, 40, 2, 8),
        ];
        let mut caso = None;
        let mut testados = 0usize;
        'procura: for (trials, seed, n_min, n_max, d_min, d_max, a_min, a_max) in configs {
            let mut x = seed;
            let mut rnd = move || {
                x = x.wrapping_mul(1664525).wrapping_add(1013904223);
                (x >> 16) as usize
            };
            for _t in 0..trials {
                let span = |lo: usize, hi: usize, rnd: &mut dyn FnMut() -> usize| {
                    lo + (rnd() % (hi - lo + 1))
                };
                let n = span(n_min, n_max, &mut rnd);
                let d = span(d_min, d_max, &mut rnd);
                let alpha = span(a_min as usize, a_max as usize, &mut rnd) as u32;
                let total: Vec<u16> = (0..(d + n))
                    .map(|_| ((rnd() as u32 % alpha) as u16) + 0x100)
                    .collect();
                let dict_bytes: Vec<u8> = total[..d].iter().flat_map(|w| w.to_be_bytes()).collect();
                let data: Vec<u8> = total[d..].iter().flat_map(|w| w.to_be_bytes()).collect();
                let index = Lz4wDictionaryIndex::build(&dict_bytes).expect("índice");
                let guloso = lz4w_encode_greedy(&data, Some(&index)).expect("guloso");
                let dp = lz4w_encode_cost_dp(&data, Some(&index))
                    .expect("dp")
                    .expect("no orçamento");
                testados += 1;
                if dp.len() < guloso.len() {
                    caso = Some((dict_bytes, data, guloso, dp));
                    break 'procura;
                }
            }
        }
        let (dict_bytes, data, guloso, dp) = match caso {
            Some(t) => {
                assert!(testados < 900, "varredura inteira percorrida: {testados}");
                t
            }
            None => panic!(
                "nenhuma das {testados} entradas varridas tem a DP estritamente menor que o \
                 guloso: a política não teria dois caminhos para distinguir"
            ),
        };
        let index = Lz4wDictionaryIndex::build(&dict_bytes).expect("índice");
        assert!(
            dp.len() < guloso.len(),
            "caso encontrado sem ganho: guloso {} B, dp {} B",
            guloso.len(),
            dp.len()
        );

        // (a) o guloso cabe => é ele que o produto escreve, byte a byte.
        let (stream, estrategia) =
            lz4w_encode_with_dictionary_index_fitting(&data, Some(&index), guloso.len())
                .expect("fitting");
        assert_eq!(estrategia, Lz4wEncodeStrategy::Greedy);
        assert_eq!(
            stream, guloso,
            "cabe: a pegada pequena tem de ser a escolhida"
        );

        // (b) o guloso não cabe => a DP resgata.
        let (stream, estrategia) =
            lz4w_encode_with_dictionary_index_fitting(&data, Some(&index), dp.len())
                .expect("fitting");
        assert_eq!(estrategia, Lz4wEncodeStrategy::CostDp);
        assert_eq!(stream, dp);

        // (c) nada cabe => devolve a MENOR tentativa e quem recusa é o chamador
        //     (contrato §4: o codec não conhece o slot).
        let (stream, estrategia) =
            lz4w_encode_with_dictionary_index_fitting(&data, Some(&index), dp.len() - 2)
                .expect("fitting");
        assert_eq!(estrategia, Lz4wEncodeStrategy::CostDp);
        assert_eq!(stream, dp);
        assert!(stream.len() > dp.len() - 2);

        // Os dois caminhos reproduzem o plain no contexto real de dicionário.
        for stream in [&guloso, &dp] {
            let back =
                lz4w_decode_with_dictionary(stream, Some(&dict_bytes), &Lz4wLimits::default())
                    .expect("decode");
            assert_eq!(back.data, data);
            assert_eq!(back.bytes_consumed, stream.len());
        }
    }

    /// O orçamento é determinístico e a saída é: acima dele o produto usa o
    /// caminho guloso, sem falha e sem stream inválido. Relógio não entra — um
    /// limite de tempo faria a mesma entrada gerar bytes diferentes em máquinas
    /// diferentes, quebrando a evidência vinculada ao binário.
    #[test]
    fn lz4w_encode_dp_acima_do_orcamento_usa_guloso_sem_falhar() {
        let data: Vec<u8> = (0..(DP_MAX_PLAIN_WORDS + 1))
            .flat_map(|i| (i as u16).to_be_bytes())
            .collect();
        assert!(
            lz4w_encode_cost_dp(&data, None).expect("encode").is_none(),
            "entrada acima de DP_MAX_PLAIN_WORDS deveria sair do orçamento da DP"
        );
        let (stream, estrategia) =
            lz4w_encode_with_dictionary_index_explained(&data, None).expect("encode");
        assert_eq!(estrategia, Lz4wEncodeStrategy::Greedy);
        let back = lz4w_decode(&stream, &Lz4wLimits::default()).expect("decode");
        assert_eq!(back.data, data);
        assert_eq!(back.bytes_consumed, stream.len());

        // E dentro do orçamento a estratégia reportada é a DP.
        let pequeno: Vec<u8> = (0..64u16)
            .flat_map(|i| (i.wrapping_mul(7)).to_be_bytes())
            .collect();
        let (stream, estrategia) =
            lz4w_encode_with_dictionary_index_explained(&pequeno, None).expect("encode");
        assert_eq!(estrategia, Lz4wEncodeStrategy::CostDp);
        let back = lz4w_decode(&stream, &Lz4wLimits::default()).expect("decode");
        assert_eq!(back.data, pequeno);
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
