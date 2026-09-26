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

/// Limites da **codificação** aPLib. Separados dos do decode porque orçam
/// objetos diferentes: aqui o orçamento é o tamanho do stream produzido (o
/// slot do recurso na ROM), não o da saída.
#[derive(Debug, Clone, Copy)]
pub struct AplibEncodeLimits {
    /// Espaço máximo aceitável para o stream (bytes). `usize::MAX` = sem
    /// orçamento (compressão de blob, não reinserção em slot).
    pub max_stream: usize,
    /// Orçamento de trabalho (bits emitidos, bytes emitidos, candidatos
    /// examinados). Nunca depende de relógio.
    pub max_work: u64,
}

impl Default for AplibEncodeLimits {
    fn default() -> Self {
        Self {
            max_stream: usize::MAX,
            max_work: 32 * 1024 * 1024,
        }
    }
}

/// Orçamento de trabalho do encode, compartilhado pelo emissor e pela busca por
/// repetições. Conta operações determinísticas — bit emitido, byte emitido,
/// candidato examinado, byte comparado — e nunca relógio: o mesmo `max_work`
/// responde igual em qualquer host, e estourar é recusa estruturada, não stream
/// parcial.
#[derive(Debug, Clone, Copy)]
struct Orcamento {
    gasto: u64,
    maximo: u64,
}

impl Orcamento {
    fn gastar(&mut self) -> Result<(), CodecError> {
        self.gasto += 1;
        if self.gasto > self.maximo {
            return Err(CodecError::new(
                "work_limit",
                format!(
                    "aPLib encode: {} operações excederam o orçamento de {}",
                    self.gasto, self.maximo
                ),
            ));
        }
        Ok(())
    }
}

/// Escritor na ordem de consumo do desempacotador: os 8 slots de cada tag são
/// preenchidos MSB→LSB e os bytes de dados entram fisicamente logo após o byte
/// de tag que os anuncia — inclusive quando um token atravessa a fronteira da
/// tag, porque o decodificador lê o byte de tag **inteiro** antes dos bits dele.
struct Emissor {
    stream: Vec<u8>,
    tag_idx: usize,
    /// Próximo slot da tag em uso (0..8); 8 significa "busca tag nova".
    slot: u8,
    orcamento: Orcamento,
}

impl Emissor {
    fn novo(max_work: u64) -> Self {
        Self {
            stream: Vec::new(),
            tag_idx: 0,
            slot: 8,
            orcamento: Orcamento {
                gasto: 0,
                maximo: max_work,
            },
        }
    }

    fn gasta(&mut self) -> Result<(), CodecError> {
        self.orcamento.gastar()
    }

    fn bit(&mut self, valor: u8) -> Result<(), CodecError> {
        if self.slot == 8 {
            self.stream.push(0);
            self.tag_idx = self.stream.len() - 1;
            self.slot = 0;
        }
        if valor == 1 {
            self.stream[self.tag_idx] |= 0x80 >> self.slot;
        }
        self.slot += 1;
        self.gasta()
    }

    fn byte(&mut self, valor: u8) -> Result<(), CodecError> {
        self.stream.push(valor);
        self.gasta()
    }

    /// Token `0`: literal.
    fn literal(&mut self, valor: u8) -> Result<(), CodecError> {
        self.bit(0)?;
        self.byte(valor)
    }

    /// Token `110` com byte de comando `0x00`: fim do stream.
    fn eod(&mut self) -> Result<(), CodecError> {
        self.bit(1)?;
        self.bit(1)?;
        self.bit(0)?;
        self.byte(0)
    }

    /// Token `110` com byte de comando não nulo: match de 2 ou 3 bytes com
    /// offset 1..=127 — exatamente o que o decodificador resolve como
    /// `off = cmd >> 1`, `len = 2 + (cmd & 1)`.
    fn cmd_110(&mut self, offset: usize, length: usize) -> Result<(), CodecError> {
        debug_assert!((1..=127).contains(&offset) && (2..=3).contains(&length));
        self.bit(1)?;
        self.bit(1)?;
        self.bit(0)?;
        self.byte(((offset << 1) | (length - 2)) as u8)
    }

    /// Escrivão de `gamma2`: os dígitos de `v` sem o `1` líder (MSB→LSB), cada
    /// um seguido de um bit de controle que só zera no último par. É o inverso
    /// exato do leitor do decodificador (`v = (v << 1) | dado`), e o menor
    /// valor legível/gravável é 2.
    fn gamma2(&mut self, valor: u64) -> Result<(), CodecError> {
        debug_assert!((2..=GAMMA2_LIMIT).contains(&valor));
        let digitos = 63 - valor.leading_zeros();
        for i in (0..digitos).rev() {
            self.bit(((valor >> i) & 1) as u8)?;
            self.bit(if i == 0 { 0 } else { 1 })?;
        }
        Ok(())
    }

    /// Token `10` em forma de **rep-match**: `acumulado = 2` é o único valor
    /// que o decodificador lê como reuso de offset (ele exige `acumulado < lwm`,
    /// e 2 é o menor `gamma2` legível), e nesse ramo o comprimento sai cru — sem
    /// o ajuste de `+2`/`+1` do match explícito. Por isso só existe com LWM 3,
    /// ou seja, logo depois de um literal.
    fn rep_match(&mut self, length: usize, lwm: u64) -> Result<(), CodecError> {
        debug_assert!(lwm > REP_ACUMULADO, "rep-match exige LWM > 2");
        debug_assert!(length >= MATCH_MINIMO);
        self.bit(1)?;
        self.bit(0)?;
        self.gamma2(REP_ACUMULADO)?;
        self.gamma2(u64::try_from(length).map_err(|_| {
            CodecError::new("overflow", "aPLib encode: comprimento cru fora de u64")
        })?)
    }

    /// Token `10`: match explícito. `acumulado = off_hi + LWM` é o que o
    /// decodificador subtrai para recuperar `off_hi`, então o valor emitido
    /// depende do estado de LWM do momento — mesmo estado que o decode mantém.
    fn match_10(&mut self, offset: usize, length: usize, lwm: u64) -> Result<(), CodecError> {
        let ajuste = ajuste_de_comprimento(offset);
        debug_assert!(length >= ajuste + 2 && offset >= 1);
        self.bit(1)?;
        self.bit(0)?;
        self.gamma2(
            u64::try_from(offset >> 8)
                .map_err(|_| CodecError::new("overflow", "aPLib encode: offset fora de u64"))?
                + lwm,
        )?;
        self.byte((offset & 0xFF) as u8)?;
        self.gamma2(u64::try_from(length - ajuste).map_err(|_| {
            CodecError::new("overflow", "aPLib encode: comprimento cru fora de u64")
        })?)
    }
}

/// LWM (`nFollowsLiteral`) que o decodificador mantém depois de um literal.
const LWM_LITERAL: u64 = 3;
/// ... e depois de qualquer match, inclusive o rep-match.
const LWM_MATCH: u64 = 2;
/// O único `acumulado` que o decodificador interpreta como rep-match.
const REP_ACUMULADO: u64 = 2;

/// A expressão mais barata que o formato oferece para um byte (ou um match) em
/// `pos`. A ordem de preferência está centralizada aqui porque ela é a
/// explicação do tamanho do stream: `111` ainda não é emitido, e é por isso que
/// `noisy_runs_16k` fica 277 bytes acima do oráculo.
enum Expressao {
    /// Reuso do último offset, pagando só o comprimento.
    Rep { length: usize },
    /// Token `110`: match de 2 ou 3 bytes com offset ≤ 127.
    Curto { offset: usize, length: usize },
    /// Token `10`: match explícito com byte de offset.
    Longo { offset: usize, length: usize },
    /// Token `0`.
    Literal,
}

/// Escolhe a expressão do candidato. O rep-match ganha sempre que está
/// disponível — custa `2 + gamma2(comprimento)` bits contra os mesmos bits do
/// `10` **mais** 8 bits do byte de offset, e contra os 11 bits do `110` — mas
/// ele só existe com LWM 3 e sobre o offset do último match emitido, que é o
/// estado que o decodificador tem, não um estado que este encoder inventa.
fn expressao_para(candidato: Option<(usize, usize)>, lwm: u64, last_offset: usize) -> Expressao {
    if let Some((offset, length)) = candidato {
        if lwm > REP_ACUMULADO && last_offset != 0 && offset == last_offset {
            return Expressao::Rep { length };
        }
        if length <= CMD110_MAX_LEN && offset <= CMD110_MAX_OFFSET {
            return Expressao::Curto { offset, length };
        }
        if expressavel_pelo_10(offset, length) {
            return Expressao::Longo { offset, length };
        }
    }
    Expressao::Literal
}

/// Ajuste de comprimento do token `10`, espelhando o decodificador: `+2` fora
/// de `128..32000`, `+1` em `1280..32000`, `+0` em `128..1279`.
fn ajuste_de_comprimento(offset: usize) -> usize {
    if !(128..MIN_MATCH4_OFFSET).contains(&offset) {
        2
    } else if offset >= MIN_MATCH3_OFFSET {
        1
    } else {
        0
    }
}

/// O `10` só expressa comprimento cru (`len − ajuste`) ≥ 2, que é o menor
/// `gamma2` legível. Há combinações que o formato simplesmente não endereça —
/// comprimento 2 com offset em `1280..31999` é a única faixa (2 − 1 = 1): o
/// encoder recusa o match e segue com literal em vez de emitir stream inválido.
fn expressavel_pelo_10(offset: usize, length: usize) -> bool {
    length >= ajuste_de_comprimento(offset) + 2
}

/// Teto de candidatos da cadeia examinados por posição (política de busca, não
/// do formato). Cada candidato custa uma comparação, então o custo por posição
/// tem teto absoluto e é debitado no orçamento de trabalho.
const CANDIDATOS_POR_POSICAO: usize = 1024;

/// Menor match que vale a pena codificar: 2 bytes. Abaixo disso só `111`
/// (1 byte, offset ≤ 15), que este encoder ainda não emite.
const MATCH_MINIMO: usize = 2;

/// Nenhuma posição indexada.
const SEM_POSICAO: u32 = u32::MAX;

/// Índice do próprio buffer para busca de repetições **a qualquer distância**.
/// `cabeca[c]` é a posição mais recente cujo par de bytes inicial vale `c` —
/// os 2 bytes são a chave exata, sem hash, então 65 536 entradas e zero
/// colisões — e `anterior[p]` é o próximo elo da mesma cadeia.
///
/// É isso que a janela de recência não dava: num TileSet de 16 KiB a referência
/// útil costuma estar no começo do blob, não nos últimos 1 024 bytes. O custo
/// não é varrer o histórico, e sim andar a cadeia até `CANDIDATOS_POR_POSICAO`,
/// com cada byte comparado debitado no orçamento.
struct BuscaRepeticoes<'a> {
    data: &'a [u8],
    cabeca: Vec<u32>,
    anterior: Vec<u32>,
    /// Marca d'água: toda posição `< inserido` já está na cadeia. A emissão
    /// pula os bytes cobertos por um match, mas essas posições também são
    /// candidatas legítimas para um match posterior, então entram aqui.
    inserido: usize,
}

impl<'a> BuscaRepeticoes<'a> {
    fn novo(data: &'a [u8]) -> Self {
        Self {
            data,
            cabeca: vec![SEM_POSICAO; 1 << 16],
            anterior: vec![SEM_POSICAO; data.len()],
            inserido: 0,
        }
    }

    fn chave(&self, pos: usize) -> usize {
        u16::from_be_bytes([self.data[pos], self.data[pos + 1]]) as usize
    }

    /// Indexa todas as posições ainda ausentes abaixo de `pos`, desde que
    /// tenham os 2 bytes da chave.
    fn ate(&mut self, pos: usize) {
        let limite = pos.min(self.data.len() - 1);
        while self.inserido < limite {
            let p = self.inserido;
            self.inserido += 1;
            let chave = self.chave(p);
            self.anterior[p] = self.cabeca[chave];
            self.cabeca[chave] = p as u32;
        }
    }

    /// Match mais longo a partir de `pos`, usando apenas posições já emitidas
    /// (offset ≥ 1, nunca referência para frente — o 68000 e o aPLib lêem o que
    /// vem depois do EOD como outro byte). Comprimentos além do próprio offset
    /// são válidos: é a repetição que o `copy` do decodificador produz byte a
    /// byte.
    fn mais_longo(
        &mut self,
        pos: usize,
        orcamento: &mut Orcamento,
    ) -> Result<Option<(usize, usize)>, CodecError> {
        self.ate(pos);
        let teto = self.data.len() - pos;
        let mut melhor: Option<(usize, usize)> = None;
        if teto >= MATCH_MINIMO {
            let mut atual = self.cabeca[self.chave(pos)];
            let mut examinados = 0;
            while atual != SEM_POSICAO && examinados < CANDIDATOS_POR_POSICAO {
                orcamento.gastar()?;
                examinados += 1;
                let candidato = atual as usize;
                atual = self.anterior[candidato];
                let maior = melhor.map_or(0, |(_, length)| length);
                // Filtro de rejeição: candidato que nem alcança o comprimento já
                // conhecido não serve. Ele NÃO autoriza assumir os `maior` bytes
                // iniciais como iguais — foram conferidos em outro candidato —,
                // então a extensão abaixo recomeça do zero; assumir o prefixo
                // produziria match inválido e o decoder divergiria (medido em
                // `noisy_runs_16k`, onde corredas longas escondem esse caso).
                if self.data[candidato + maior] != self.data[pos + maior] {
                    continue;
                }
                let mut length = 0;
                while length < teto {
                    orcamento.gastar()?;
                    if self.data[candidato + length] != self.data[pos + length] {
                        break;
                    }
                    length += 1;
                }
                if length > maior {
                    melhor = Some((pos - candidato, length));
                    if length == teto {
                        break;
                    }
                }
            }
        }
        Ok(melhor.filter(|(_, length)| *length >= MATCH_MINIMO))
    }
}

/// O token `110` só expressa comprimentos 2 e 3; em ambos custa 3 bits + 1
/// byte = 11 bits contra 18 (dois literais) ou 27 (três literais), então vale
/// sempre que o match cabe.
const CMD110_MAX_LEN: usize = 3;
/// O byte de comando tem 7 bits úteis para offset (`cmd >> 1`).
const CMD110_MAX_OFFSET: usize = 127;

/// Codifica dados no aPLib da variante SGDK (stream raw, sem header `"AP\0"`).
///
/// Erros do vocabulário declarado em CONTRACTS §4: `needs_space` quando o
/// orçamento de espaço não cabe, `work_limit` quando o orçamento de trabalho
/// estoura, `overflow` quando a entrada não é representável pelo formato
/// (saída vazia — a mesma razão pela qual o decode recusa stream vazio com
/// `truncated`). Nenhuma dessas é panic e nenhuma aloca antes de validar.
pub fn aplib_encode(data: &[u8], limits: &AplibEncodeLimits) -> Result<Vec<u8>, CodecError> {
    if data.is_empty() {
        return Err(CodecError::new(
            "overflow",
            "aPLib: o formato não expressa saída de 0 bytes; nenhum stream representa entrada vazia",
        ));
    }
    if limits.max_stream == 0 {
        return Err(CodecError::new(
            "needs_space",
            "aPLib encode: orçamento de 0 bytes; nenhum stream cabe, nem o menor possível (3 bytes)",
        ));
    }
    if data.len() > u32::MAX as usize {
        return Err(CodecError::new(
            "overflow",
            format!(
                "aPLib encode: {} bytes excedem as 2^32 posições endereçáveis do índice de busca",
                data.len()
            ),
        ));
    }
    let mut emissor = Emissor::novo(limits.max_work);
    let mut busca = BuscaRepeticoes::novo(data);
    // O byte 0 do stream raw É o primeiro literal, sem token e sem tag.
    emissor.byte(data[0])?;
    // LWM e histórico andam com o emissor porque o decodificador os usa para
    // interpretar o que for emitido: 3 após literal, 2 após match, e o
    // rep-match só endereça o offset que o decodificador tem no histórico.
    let mut lwm = LWM_LITERAL;
    let mut last_offset: usize = 0;
    let mut pos = 1;
    while pos < data.len() {
        let candidato = busca.mais_longo(pos, &mut emissor.orcamento)?;
        match expressao_para(candidato, lwm, last_offset) {
            Expressao::Rep { length } => {
                emissor.rep_match(length, lwm)?;
                // O rep-match reafirma o mesmo offset e, como qualquer match,
                // derruba LWM para 2: o próximo rep-match precisa de um literal
                // no meio, exatamente como o decodificador.
                lwm = LWM_MATCH;
                pos += length;
            }
            Expressao::Curto { offset, length } => {
                emissor.cmd_110(offset, length)?;
                last_offset = offset;
                lwm = LWM_MATCH;
                pos += length;
            }
            Expressao::Longo { offset, length } => {
                emissor.match_10(offset, length, lwm)?;
                last_offset = offset;
                lwm = LWM_MATCH;
                pos += length;
            }
            Expressao::Literal => {
                emissor.literal(data[pos])?;
                lwm = LWM_LITERAL;
                pos += 1;
            }
        }
    }
    emissor.eod()?;
    if emissor.stream.len() > limits.max_stream {
        return Err(CodecError::new(
            "needs_space",
            format!(
                "aPLib encode: {} bytes de plain precisam de {} bytes de stream, orçamento de {}",
                data.len(),
                emissor.stream.len(),
                limits.max_stream
            ),
        ));
    }
    Ok(emissor.stream)
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

    /// `g01b_single_byte` é o único golden cujo stream o encoder **não** tem
    /// escolha de produzir: 1 byte de saída é o literal físico do byte 0 e o
    /// resto tem que ser o EOD (`110` + `0x00`). O stream abaixo é o arquivo
    /// GOLDEN-CONFIRMED pelos dois oráculos (`4eb77c03…`).
    #[test]
    fn aplib_encode_de_um_byte_e_o_golden_byte_a_byte() {
        let stream = aplib_encode(&[0x5A], &AplibEncodeLimits::default()).expect("1 byte codifica");
        assert_eq!(
            stream,
            vetor("golden/g01b_single_byte.ap"),
            "encode([0x5A]) deveria ser literal + EOD, byte a byte como o golden"
        );
    }

    /// Primeira economia obrigatória do formato: um match de 2 ou 3 bytes com
    /// offset ≤ 127 sai pelo token `110` (3 bits + byte de comando), não por
    /// literais. O stream abaixo foi montado à mão na ordem de consumo — `41`
    /// literal físico, tag `36` (literais B e C, depois `110` cmd `06` = off 3
    /// len 2, depois `110` cmd `00` = EOD).
    #[test]
    fn aplib_encode_usa_o_token_110_para_match_curto_em_vez_de_literais() {
        let dados = b"ABCAB";
        let stream = aplib_encode(dados, &AplibEncodeLimits::default()).expect("codifica");
        assert_eq!(
            stream,
            vec![0x41, 0x36, 0x42, 0x43, 0x06, 0x00],
            "stream esperado montado à mão; saiu: {stream:02x?}"
        );
        let decode = decodificar(&stream, AplibLimits::default());
        assert_eq!(&decode.data, dados, "ida-e-volta");
        assert_eq!(
            decode.bytes_consumed,
            stream.len(),
            "o EOD tem que ser o último byte lido"
        );
    }

    /// Rep-match: o token `10` com `gamma2 < lwm` reusa o último offset pagando
    /// **só o comprimento**, sem byte de offset e sem ajuste de comprimento. É o
    /// token que falta para os plains `tile_like` (15 rep-match no oráculo) e
    /// `noisy_runs_16k` (210) — ver o resumo por tipo de token em
    /// `scripts/rex_profiles/integrator/aplib/token_dump.py`.
    ///
    /// O alvo não é estimativa minha: `apultra -c` sobre estes exatos 34 bytes
    /// produz **21 bytes** de stream, e o dump deles mostra um `match-10` de 10
    /// bytes seguido de um `rep-match` de 10. O produto pagava o byte de offset
    /// duas vezes.
    #[test]
    fn aplib_encode_reusa_o_ultimo_offset_por_rep_match() {
        let dados = b"0123456789AB0123456789CD0123456789";
        let stream = aplib_encode(dados, &AplibEncodeLimits::default()).expect("codifica");
        assert!(
            stream.len() <= 21,
            "o oráculo faz estes 34 bytes em 21 B usando um rep-match; o produto fez {} B \
             (stream: {stream:02x?})",
            stream.len()
        );
        let decode = decodificar(
            &stream,
            AplibLimits {
                max_output: dados.len() + 1,
                max_work: 64 * 1024 * 1024,
            },
        );
        assert_eq!(&decode.data, &dados[..], "ida-e-volta");
        assert_eq!(
            decode.bytes_consumed,
            stream.len(),
            "EOD no último byte lido"
        );
    }

    /// Match de comprimento 5 com offset 5: o `110` não expressa (só 2 ou 3),
    /// então sai pelo token `10`. Montado à mão na ordem de consumo —
    /// `41` literal físico; tag `0a` = literais B,C,D,E + `10` + gamma2(3)
    /// (off_hi = 5 − LWM 3 = 0 → acumulado 3); byte `05` = off_low; tag `b0` =
    /// gamma2(3) para o comprimento cru (ajuste `+2` porque off < 128 → 5−2=3)
    /// + EOD.
    #[test]
    fn aplib_encode_usa_o_token_10_para_match_longo() {
        let dados = b"ABCDEABCDE";
        let stream = aplib_encode(dados, &AplibEncodeLimits::default()).expect("codifica");
        assert_eq!(
            stream,
            vec![0x41, 0x0A, 0x42, 0x43, 0x44, 0x45, 0x05, 0xB0, 0x00],
            "stream esperado montado à mão; saiu: {stream:02x?}"
        );
        let decode = decodificar(&stream, AplibLimits::default());
        assert_eq!(&decode.data, dados, "ida-e-volta");
        assert_eq!(decode.bytes_consumed, stream.len(), "EOD no fim");
    }

    /// Os 8 plains da fixture atravessam as faixas de offset que mudam o ajuste
    /// de comprimento (`<128`, `128..1279`, `1280..31999`, `≥32000`) e os
    /// tamanhos reais de recurso (8 KB de tile chunky, 64 KB de zeros, janela de
    /// 40 KB). O pacote da agente B **não publica os bytes dos plains** — publica
    /// os streams dos oráculos e o SHA-256 de cada plain (`manifest.tsv`,
    /// coluna 3), então os dados de entrada são o decode do próprio stream
    /// pinado, conferido contra o hash. Ida-e-volta pelo decoder do produto é o
    /// contrato mínimo do encoder; a *qualidade* do stream é medida à parte, não
    /// afirmada aqui.
    #[test]
    fn aplib_encode_reproduz_cada_plain_da_fixture_pelo_decoder() {
        let mut casos = 0;
        for linha in linhas() {
            if linha[0] != "plain" {
                continue;
            }
            let nome = &linha[1];
            let esperado_bytes: usize = linha[2].parse().expect("plain_len numérico");
            let stream_oraculo = vetor(&format!("plain/{nome}.apultra.ap"));
            let dados = decodificar(&stream_oraculo, AplibLimits::default()).data;
            assert_eq!(dados.len(), esperado_bytes, "{nome}: plain lido do oráculo");
            assert_eq!(
                sha256_hex(&dados),
                linha[3],
                "{nome}: plain diverge do hash pinado no manifest.tsv"
            );

            let stream = aplib_encode(&dados, &AplibEncodeLimits::default())
                .unwrap_or_else(|e| panic!("{nome}: encode recusou: {e}"));
            let decode = decodificar(
                &stream,
                AplibLimits {
                    max_output: dados.len() + 1,
                    max_work: 64 * 1024 * 1024,
                },
            );
            assert_eq!(decode.data, dados, "{nome}: ida-e-volta");
            assert_eq!(
                decode.bytes_consumed,
                stream.len(),
                "{nome}: consumo deveria ser o stream inteiro"
            );
            casos += 1;
        }
        assert_eq!(casos, 8, "esperava 8 plains no manifest.tsv");
    }

    /// Gerador determinístico (LCG 64, semente fixa) de dados sem correspondência
    /// útil — o pior caso de um codec de dicionário.
    fn pseudo_aleatorio(n: usize) -> Vec<u8> {
        let mut estado: u64 = 0x2545_F491_4F6C_DD1D;
        (0..n)
            .map(|_| {
                estado = estado
                    .wrapping_mul(6364136223846793005)
                    .wrapping_add(1442695040888963407);
                (estado >> 33) as u8
            })
            .collect()
    }

    /// Orçamento de espaço é a razão de existir do encoder nesta rodada: um
    /// recurso só é editável sem expansão se a re-codificação couber no slot.
    /// Não cabendo, a recusa tem que ser estruturada (`needs_space`) e dizer os
    /// dois números — o que o stream exige e o que foi autorizado — em vez de
    /// devolver um stream estourado ou um erro vago.
    #[test]
    fn aplib_encode_declara_needs_space_com_os_dois_numeros_quando_nao_cabe() {
        let dados = pseudo_aleatorio(4096);
        let cheio = aplib_encode(&dados, &AplibEncodeLimits::default())
            .expect("sem orçamento de espaço o encode sempre responde");
        assert!(
            cheio.len() > dados.len(),
            "entrada sem correspondência deveria expandir; veio {} B para {} B de plain",
            cheio.len(),
            dados.len()
        );

        let orcamento = 64;
        let erro = aplib_encode(
            &dados,
            &AplibEncodeLimits {
                max_stream: orcamento,
                max_work: 32 * 1024 * 1024,
            },
        )
        .err()
        .expect("4096 bytes incompressíveis não cabem num slot de 64");
        assert_eq!(erro.code, "needs_space");
        assert!(
            erro.detail.contains(&cheio.len().to_string()) && erro.detail.contains("64"),
            "detail deveria citar o tamanho exigido e o orçamento; veio: {}",
            erro.detail
        );

        // Fronteira honesta: o tamanho exatamente produzido cabe, e um a menos
        // não. Um `needs_space` que recusa o próprio limite seria armadilha para
        // a transação, que decide por folga = slot − stream.
        assert!(aplib_encode(
            &dados,
            &AplibEncodeLimits {
                max_stream: cheio.len(),
                max_work: 32 * 1024 * 1024,
            }
        )
        .is_ok());
        assert_eq!(
            aplib_encode(
                &dados,
                &AplibEncodeLimits {
                    max_stream: cheio.len() - 1,
                    max_work: 32 * 1024 * 1024,
                }
            )
            .err()
            .expect("um byte a menos não cabe")
            .code,
            "needs_space"
        );

        assert_eq!(
            aplib_encode(
                &dados,
                &AplibEncodeLimits {
                    max_stream: 0,
                    max_work: 32 * 1024 * 1024,
                }
            )
            .err()
            .expect("orçamento zero recusa antes de alocar")
            .code,
            "needs_space",
            "max_stream 0 não pode produzir stream algum"
        );
    }

    /// O stream que um encoder **sem nenhum match** produziria: literal físico
    /// no byte 0, depois token `0` por byte, depois EOD. Serve de régua para
    /// medir cobertura de offset — e ele próprio tem que decodificar, senão a
    /// comparação de tamanho não quer dizer nada.
    fn stream_todos_literais(dados: &[u8]) -> Vec<u8> {
        let mut emissor = Emissor::novo(u64::MAX);
        emissor.byte(dados[0]).expect("sem teto de trabalho");
        for &byte in &dados[1..] {
            emissor.literal(byte).expect("sem teto de trabalho");
        }
        emissor.eod().expect("sem teto de trabalho");
        emissor.stream
    }

    /// Cobertura de offset distante. Em recursos reais a referência útil é o
    /// começo do blob (padrão de tiles, cabeçalho de mapa), dezenas de
    /// kilobytes antes do ponto de reinício — exatamente o que uma busca
    /// restrita aos offsets mais recentes nunca vê. A asserção não é "comprimiu
    /// bastante" (vaga): é `stream < régua-de-literais − 1000`, onde a régua é o
    /// resultado que o próprio formato produz para a mesma entrada sem match.
    /// As três cópias têm distâncias 39 900, 35 400 e 20 800 e comprimentos 400.
    #[test]
    fn aplib_encode_encontra_repeticoes_distantes_fora_da_janela_recente() {
        let dicionario = pseudo_aleatorio(40_000);
        let mut dados = dicionario.clone();
        for faixa in [100..500, 5_000..5_400, 20_000..20_400] {
            dados.extend_from_slice(&dicionario[faixa]);
        }
        assert_eq!(dados.len(), 41_200);

        let regua = stream_todos_literais(&dados);
        assert_eq!(
            decodificar(&regua, AplibLimits::default()).data,
            dados,
            "a régua precisa ser um stream válido do formato"
        );

        let stream =
            aplib_encode(&dados, &AplibEncodeLimits::default()).expect("codifica 41 200 bytes");
        assert!(
            stream.len() + 1000 <= regua.len(),
            "3 matches de 400 bytes a ≥ 20 000 de distância deveriam economizar mais de \
             1 000 bytes sobre a régua de literais; régua {} B, stream {} B",
            regua.len(),
            stream.len()
        );

        let decode = decodificar(
            &stream,
            AplibLimits {
                max_output: dados.len() + 1,
                max_work: 64 * 1024 * 1024,
            },
        );
        assert_eq!(
            decode.data, dados,
            "ida-e-volta do stream com matches distantes"
        );
        assert_eq!(
            decode.bytes_consumed,
            stream.len(),
            "EOD no último byte lido"
        );
    }

    /// O orçamento de trabalho tem que cobrir a **busca**, não só a escrita: um
    /// match de 8 191 bytes custa ~40 operações de emissão e ~8 000 comparações
    /// de byte. Sem debitá-las, `max_work` é um teto falso justamente no pior
    /// caso do encoder (entrada repetitiva), e a recusa `work_limit` que o
    /// decode já oferece não existiria no encode.
    #[test]
    fn aplib_encode_debita_a_busca_no_orcamento_de_trabalho() {
        let dados = vec![0x5Au8; 8192];
        aplib_encode(&dados, &AplibEncodeLimits::default())
            .expect("orçamento padrão comporta 8 KiB repetidos");
        let erro = aplib_encode(
            &dados,
            &AplibEncodeLimits {
                max_stream: usize::MAX,
                max_work: 2000,
            },
        )
        .err()
        .expect("2 000 operações não pagam ~8 000 comparações de busca");
        assert_eq!(erro.code, "work_limit");
        assert!(
            erro.detail.contains("2000"),
            "detail deveria citar o orçamento estourado; veio: {}",
            erro.detail
        );
    }

    /// Benchmark de capacidade congelado (medido em 2026-09-26, logo depois da
    /// cobertura de offsets distantes): o tamanho **exato** do stream que o
    /// encoder do produto produz para cada plain da fixture, contra o tamanho do
    /// stream que o `apultra` produziu para o mesmo plain. Congelo por igualdade
    /// e não por teto — do jeito do benchmark de recompressão do LZ4W: mexer na
    /// qualidade muda um pino, e mudar um pino é decisão registrada, não
    /// deriva.
    ///
    /// Pino ≠ alvo, e a diferença é estreita e medida mesa por mesa
    /// (`RDS_APLIB_DUMP=… cargo test --lib aplib_encode_dumpa` +
    /// `scripts/rex_profiles/integrator/aplib/token_dump.py`):
    ///
    /// - mesa de tokens idêntica à do oráculo: `ab_repeat`, `near_window_2k`,
    ///   `tile_like`, `zeros_64k`;
    /// - mesmo tamanho com um `111` do oráculo pago como literal:
    ///   `far_window_40k`, `pseudo_random_8k`;
    /// - 1 byte acima: `text_rep`, por 4 cópias de 1 byte (`111`) que o produto
    ///   ainda paga como literal (4 × 2 bits = 1 byte);
    /// - 160 bytes acima: `noisy_runs_16k`, e aqui a mesa mostra forma de parse,
    ///   não token faltante: o produto emite 305 `match-10` contra 179 do
    ///   oráculo, e 123 rep-match contra 210 — o guloso "match mais longo"
    ///   corta o stream de jeito diferente.
    #[test]
    fn aplib_encode_tem_a_capacidade_medida_congelada_por_plain() {
        const PINOS: [(&str, usize, usize); 8] = [
            // (nome, stream do produto, stream do oráculo = alvo)
            ("ab_repeat", 8, 8),
            ("far_window_40k", 305, 305),
            ("near_window_2k", 55, 55),
            ("noisy_runs_16k", 1365, 1205),
            ("pseudo_random_8k", 294, 294),
            ("text_rep", 29, 28),
            ("tile_like", 41, 41),
            ("zeros_64k", 8, 8),
        ];
        let mut desvios = Vec::new();
        for (nome, produto_esperado, alvo) in PINOS {
            let stream_oraculo = vetor(&format!("plain/{nome}.apultra.ap"));
            if stream_oraculo.len() != alvo {
                desvios.push(format!(
                    "{nome}: o stream do oráculo mudou ({}, tabela diz {alvo}); o alvo \
                     precisa ser re-medido",
                    stream_oraculo.len()
                ));
                continue;
            }
            let dados = decodificar(&stream_oraculo, AplibLimits::default()).data;
            let stream = aplib_encode(&dados, &AplibEncodeLimits::default())
                .unwrap_or_else(|e| panic!("{nome}: encode recusou: {e}"));
            if stream.len() != produto_esperado {
                desvios.push(format!(
                    "{nome}: produto {} B, congelado {produto_esperado} B, alvo do \
                     oráculo {alvo} B",
                    stream.len()
                ));
            }
        }
        assert!(
            desvios.is_empty(),
            "capacidade do encoder saiu do congelado:\n  {}",
            desvios.join("\n  ")
        );
    }

    /// Alimenta o instrumento de tokens com o stream do **produto**: se
    /// `RDS_APLIB_DUMP` apontar para um diretório, cada plain da fixture sai lá
    /// como `<nome>.produto.ap`, para
    /// `scripts/rex_profiles/integrator/aplib/token_dump.py` comparar mesa por
    /// mesa com o stream do oráculo. Sem a variável o teste não escreve nada (o
    /// conjunto verde não depende de dump nem publica bytes), e com ela um
    /// fracasso de escrita é fracasso de teste.
    ///
    /// Uso:
    ///   RDS_APLIB_DUMP=/tmp/aplib-dump cargo test --lib aplib_encode_dumpa
    #[test]
    fn aplib_encode_dumpa_os_streams_para_analise_se_pedido() {
        let dir = match std::env::var_os("RDS_APLIB_DUMP") {
            None => return,
            Some(v) => PathBuf::from(v),
        };
        std::fs::create_dir_all(&dir)
            .unwrap_or_else(|e| panic!("RDS_APLIB_DUMP={}: {e}", dir.display()));
        let mut casos = 0;
        for linha in linhas() {
            if linha[0] != "plain" {
                continue;
            }
            let nome = &linha[1];
            let dados = decodificar(
                &vetor(&format!("plain/{nome}.apultra.ap")),
                AplibLimits::default(),
            )
            .data;
            let stream = aplib_encode(&dados, &AplibEncodeLimits::default())
                .unwrap_or_else(|e| panic!("{nome}: encode recusou: {e}"));
            let caminho = dir.join(format!("{nome}.produto.ap"));
            std::fs::write(&caminho, &stream)
                .unwrap_or_else(|e| panic!("escrever {}: {e}", caminho.display()));
            casos += 1;
        }
        assert_eq!(casos, 8, "esperava 8 plains no manifest.tsv");
    }
}
