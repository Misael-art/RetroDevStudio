//! Decodificador Kosinski (variante base, nao-modular) — contrato v1 em
//! `docs/rex_profiles/kosinski_runtime/CONTRACT.md`.
//!
//! Pacote autonomo da frente REX: sem dependencia de Tauri, sem dependencias
//! externas, sem leitura de filesystem na logica de decode.

pub mod edit;
pub mod encode;

pub use encode::{encode, EncError, KosEncoded};

#[derive(Debug, PartialEq, Eq)]
pub enum KosError {
    /// EOF no meio de descritor/token, ou fluxo exaurido sem terminator.
    Truncated,
    /// Referencia cai antes do historico ja escrito (ou fora dos intervalos do formato).
    InvalidReference,
    /// Saida excederia `max_output`.
    ExcessiveOutput,
    /// Orcamento deterministico de trabalho esgotado.
    WorkLimit,
    /// Entrada com zero bytes (caso degenerado, distinguido por diagnostico).
    EmptyInput,
}

#[derive(Debug, PartialEq, Eq)]
pub struct KosDecoded {
    pub output: Vec<u8>,
    /// Posicao imediatamente apos o byte terminator (`c == 0`); nunca inclui
    /// padding nem bytes posteriores (contrato v1, secao 3).
    pub bytes_consumed: usize,
}

struct Reader<'a> {
    st: &'a [u8],
    pos: usize,
    desc: u16,
    bits_left: u8,
    desc_eof: bool,
    work: usize,
    work_limit: usize,
}

impl<'a> Reader<'a> {
    fn spend(&mut self, cost: usize) -> Result<(), KosError> {
        self.work = self.work.checked_add(cost).ok_or(KosError::WorkLimit)?;
        if self.work > self.work_limit {
            return Err(KosError::WorkLimit);
        }
        Ok(())
    }

    /// Proximo bit do descritor, LSB->MSB da palavra de 16 bits em 2 bytes
    /// little-endian. EARLY FETCH: o pop do 16o bit le a palavra seguinte IME-
    /// DIATAMENTE, antes de qualquer byte de dados do token em curso (e o que
    /// os goldens m09/m10 discriminam: em m10 o `h` inline e o 16o bit, o
    /// placeholder cai entre `h` e `l`). Falha de fetch marca `desc_eof` sem
    /// consome byte: o token corrente ainda le seus bytes de dados; o proximo
    /// bit da erro (Truncated), fiel ao espelho strict do perfil.
    fn next_bit(&mut self) -> Result<u8, KosError> {
        if self.bits_left == 0 {
            if self.desc_eof {
                return Err(KosError::Truncated);
            }
            self.fetch_desc()?;
        }
        self.bits_left -= 1;
        let bit = (self.desc & 1) as u8;
        self.desc >>= 1;
        self.spend(1)?;
        if self.bits_left == 0 && !self.desc_eof {
            if self.pos + 2 > self.st.len() {
                self.desc_eof = true;
            } else {
                self.fetch_desc()?;
            }
        }
        Ok(bit)
    }

    fn fetch_desc(&mut self) -> Result<(), KosError> {
        if self.pos + 2 > self.st.len() {
            self.desc_eof = true;
            return Err(KosError::Truncated);
        }
        self.desc = u16::from_le_bytes([self.st[self.pos], self.st[self.pos + 1]]);
        self.pos += 2;
        self.spend(2)?;
        self.bits_left = 16;
        Ok(())
    }

    fn getbyte(&mut self) -> Result<u8, KosError> {
        if self.pos >= self.st.len() {
            return Err(KosError::Truncated);
        }
        let b = self.st[self.pos];
        self.pos += 1;
        self.spend(1)?;
        Ok(b)
    }
}

/// Decodifica uma stream Kosinski base com limites exigidos pelo chamador.
///
/// - `max_output`: teto absoluto da saida; toda alocação fica abaixo dele.
/// - `work_limit`: budget deterministico — 1 unidade por bit de descritor
///   consumido, 1 por byte de input lido, 1 por byte escrito.
pub fn decode(input: &[u8], max_output: usize, work_limit: usize) -> Result<KosDecoded, KosError> {
    if input.is_empty() {
        return Err(KosError::EmptyInput);
    }
    let mut r = Reader {
        st: input,
        pos: 0,
        desc: 0,
        bits_left: 0,
        desc_eof: false,
        work: 0,
        work_limit,
    };
    let mut out: Vec<u8> = Vec::new();

    loop {
        let b = r.next_bit()?;
        if b == 1 {
            let v = r.getbyte()?;
            push(&mut out, v, max_output)?;
            r.spend(1)?;
            continue;
        }
        let b = r.next_bit()?;
        let (len, dist);
        if b == 1 {
            // Match "separado": Low, High; Count3 = High & 7.
            let low = r.getbyte()?;
            let high = r.getbyte()?;
            let count3 = high & 7;
            if count3 != 0 {
                len = count3 as usize + 2;
            } else {
                let c = r.getbyte()?;
                match c {
                    0 => {
                        return Ok(KosDecoded {
                            output: out,
                            bytes_consumed: r.pos,
                        })
                    }
                    1 => continue, // quirk do formato (golden m06): consome o byte, nao copia
                    _ => len = c as usize + 1,
                }
            }
            dist = 0x2000usize - (((high & 0xF8) as usize) << 5 | low as usize);
        } else {
            // Match "inline": +2 bits de comprimento, 1 byte de distancia.
            let h = r.next_bit()?;
            let l = r.next_bit()?;
            len = ((h as usize) << 1 | l as usize) + 2;
            let d = r.getbyte()?;
            dist = 0x100usize - d as usize;
        }
        // dist >= 1 por aritmetica do formato; o contrato valida o historico.
        if dist == 0 || dist > out.len() {
            return Err(KosError::InvalidReference);
        }
        // Invariante: dist >= 1, logo na iteracao i a leitura out[start+i] esta
        // dentro do historico ja escrito (start+i <= len(out)-1 sempre).
        let start = out.len() - dist;
        for i in 0..len {
            let byte = out[start + i];
            push(&mut out, byte, max_output)?;
            r.spend(1)?;
        }
    }
}

fn push(out: &mut Vec<u8>, b: u8, max_output: usize) -> Result<(), KosError> {
    if out.len() >= max_output {
        return Err(KosError::ExcessiveOutput);
    }
    out.push(b);
    Ok(())
}
