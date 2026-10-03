//! Codificador Kosinski (variante base, nao-modular) — contrato v1 em
//! `docs/rex_profiles/kosinski_runtime/ENCODE-CONTRACT.md`.
//!
//! Emite tokens que o `decode` deste pacote (e o oraculo externo) aceitam,
//! espelhando o EARLY FETCH do decodificador no lado do emissor: quando o
//! 16o bit de um descritor e emitido e qualquer byte se segue (dados do token
//! em curso, token posterior, ou os proprios bytes do terminador), a palavra
//! do proximo descritor e escrita imediatamente, ANTES desses bytes.
//!
//! Estrategia simples e correta (NAO otima): menor distancia em empate,
//! janela = capacidade do formato, cadeia de hash limitada por
//! `STRATEGY_CHAIN_LIMIT` (limite de ESTRATEGIA — mantido distinto da
//! capacidade do formato por exigerica da missao).

use std::collections::HashMap;

#[derive(Debug, PartialEq, Eq)]
pub enum EncError {
    /// Saida excederia `max_stream` (cortado no ponto de uso, byte a byte).
    StreamLimit,
    /// Orcamento deterministico de trabalho esgotado.
    WorkLimit,
}

#[derive(Debug, PartialEq, Eq)]
pub struct KosEncoded {
    pub stream: Vec<u8>,
    pub plain_len: usize,
}

// Capacidade do FORMATO (contrato §2).
const FORMAT_MAX_DIST: usize = 0x2000; // separado: dist 1..=8192
const FORMAT_INLINE_MAX_DIST: usize = 0x100; // inline: dist 1..=256
const FORMAT_MAX_LEN: usize = 256; // byte c = 0xFF -> len 256

// ESCOLHAS de estrategia (contrato §2/§5) — nao sao limites do formato.
const STRATEGY_WINDOW: usize = FORMAT_MAX_DIST;
const STRATEGY_CHAIN_LIMIT: usize = 64;
const STRATEGY_MIN_REF_LEN: usize = 3;

struct Writer {
    out: Vec<u8>,
    max_stream: usize,
    work: usize,
    work_limit: usize,
    /// Posicao da palavra de descritor em curso; bits escritos `slot_bit`/16.
    slot_off: usize,
    slot_bit: u8,
}

impl Writer {
    fn charge(&mut self, cost: usize) -> Result<(), EncError> {
        self.work = self.work.checked_add(cost).ok_or(EncError::WorkLimit)?;
        if self.work > self.work_limit {
            return Err(EncError::WorkLimit);
        }
        Ok(())
    }

    /// Escrita de byte de stream com corte no ponto de uso (disciplina do
    /// `push()` do decoder): nenhum byte alem de `max_stream` e jamais alocado.
    fn put(&mut self, b: u8) -> Result<(), EncError> {
        if self.out.len() >= self.max_stream {
            return Err(EncError::StreamLimit);
        }
        self.out.push(b);
        self.charge(1) // 1 por byte de stream escrito
    }

    fn reserve_slot(&mut self) -> Result<(), EncError> {
        self.put(0x00)?;
        self.put(0x00)?;
        self.slot_off = self.out.len() - 2;
        self.slot_bit = 0;
        Ok(())
    }

    /// Emite um bit do descritor (LSB->MSB). `cont` = o token ainda precisa de
    /// bits OU existem tokens posteriores; nesse caso o placeholder da
    /// proxima palavra e reservado Ja no pop do 16o bit (early-fetch).
    fn emit_bit(&mut self, v: bool, cont: bool) -> Result<(), EncError> {
        self.charge(1)?; // 1 por bit de descritor emitido
        if self.slot_bit == 16 {
            self.reserve_slot()?; // primeiro descritor da stream
        }
        if v {
            let byte = self.slot_off + (self.slot_bit >> 3) as usize;
            self.out[byte] |= 1 << (self.slot_bit & 7);
        }
        self.slot_bit += 1;
        if self.slot_bit == 16 && cont {
            self.reserve_slot()?;
        }
        Ok(())
    }
}

/// Codifica `plain` na variante base do formato. Limites exigidos (como no
/// decoder): `max_stream` teto absoluto de saida; `work_limit` orcamento
/// deterministico — 1 por byte de plain coberto, 1 por byte de stream,
/// 1 por bit de descritor, 1 por candidato de match examinado.
pub fn encode(plain: &[u8], max_stream: usize, work_limit: usize) -> Result<KosEncoded, EncError> {
    let n = plain.len();
    let mut w = Writer {
        out: Vec::new(),
        max_stream,
        work: 0,
        work_limit,
        slot_off: 0,
        slot_bit: 16, // sem descritor aberto ainda
    };
    let mut head: HashMap<[u8; 3], u32> = HashMap::new();
    let mut nxt: Vec<u32> = vec![u32::MAX; n];

    let mut pos: usize = 0;
    while pos < n {
        // — busca de match (cadeia de hash de prefixo exato de 3 bytes, mais
        // recente primeiro; empate de comprimento mantem o mais recente, ou
        // seja, a MENOR distancia).
        let mut best_len = 0usize;
        let mut best_dist = 0usize;
        if n - pos >= STRATEGY_MIN_REF_LEN {
            let key = [plain[pos], plain[pos + 1], plain[pos + 2]];
            let mut cand = head.get(&key).copied();
            let mut examined = 0usize;
            while let Some(c) = cand {
                let c = c as usize;
                let dist = pos - c; // inseridas sempre em posicao anterior
                if dist > STRATEGY_WINDOW {
                    break;
                }
                if examined >= STRATEGY_CHAIN_LIMIT {
                    break;
                }
                w.charge(1)?; // 1 por candidato examinado
                examined += 1;
                let cap = FORMAT_MAX_LEN.min(n - pos);
                let mut l = 0usize;
                while l < cap && plain[c + (l % dist)] == plain[pos + l] {
                    l += 1;
                }
                if l > best_len {
                    best_len = l;
                    best_dist = dist;
                }
                cand = if nxt[c] == u32::MAX {
                    None
                } else {
                    Some(nxt[c])
                };
            }
        }

        if best_len >= STRATEGY_MIN_REF_LEN {
            // Run > 256: referencias consecutivas de 256 com a MESMA dist
            // (contrato §5); o padrao e o bloco fonte [pos-dist, pos).
            let j = pos - best_dist;
            let mut cur = pos;
            loop {
                let off = cur - pos;
                let cap = FORMAT_MAX_LEN.min(n - cur);
                let mut l = 0usize;
                while l < cap && plain[j + ((off + l) % best_dist)] == plain[cur + l] {
                    l += 1;
                }
                if l < STRATEGY_MIN_REF_LEN {
                    break; // chunk residual curto demais: caminho normal
                }
                insert(&mut head, &mut nxt, plain, cur);
                emit_ref(&mut w, l, best_dist)?;
                cur += l;
                if l < FORMAT_MAX_LEN || cur >= n {
                    break;
                }
            }
            pos = cur;
        } else {
            insert(&mut head, &mut nxt, plain, pos);
            w.emit_bit(true, true)?; // literal nunca e o ultimo bit da stream
            w.put(plain[pos])?;
            w.charge(1)?; // byte de plain coberto
            pos += 1;
        }
    }

    // Terminator: bits 0,1 + Low=00 High=F0 c=00; nada depois (§3 retificado).
    // O segundo bit usa cont=true: se cair no 16.o bit, os 3 bytes de dados do
    // terminator seguem-se APOS a palavra-placeholder — o early-fetch do
    // decoder e incondicional no pop do 16.o bit (medido: plain de 14
    // literais dava Truncated sem o placeholder).
    w.emit_bit(false, true)?;
    w.emit_bit(true, true)?;
    w.put(0x00)?;
    w.put(0xF0)?;
    w.put(0x00)?;
    Ok(KosEncoded {
        stream: w.out,
        plain_len: n,
    })
}

fn insert(head: &mut HashMap<[u8; 3], u32>, nxt: &mut [u32], plain: &[u8], p: usize) {
    if p + 3 > plain.len() {
        return;
    }
    let key = [plain[p], plain[p + 1], plain[p + 2]];
    if let Some(&h) = head.get(&key) {
        nxt[p] = h;
    }
    head.insert(key, p as u32);
}

/// Emite uma referencia `len >= 3`, `dist in 1..=0x2000` conforme §5:
/// inline se len<=5 e dist<=256; separado count3 se len<=9; separado c acima.
fn emit_ref(w: &mut Writer, len: usize, dist: usize) -> Result<(), EncError> {
    w.charge(len)?; // bytes de plain cobertos pela referencia
    if len <= 5 && dist <= FORMAT_INLINE_MAX_DIST {
        let hl = (len - 2) as u8; // 1..=3 (len 2 nunca e emitido: STRATEGY_MIN_REF_LEN=3)
        w.emit_bit(false, true)?;
        w.emit_bit(false, true)?;
        w.emit_bit(hl & 2 != 0, true)?; // h
        w.emit_bit(hl & 1 != 0, true)?; // l
        w.put((0x100 - dist) as u8) // d
    } else {
        let x = 0x2000usize - dist; // 0..=0x1FFF (checked pela faixa do formato)
        let low = (x & 0xFF) as u8;
        let count3 = if (3..=9).contains(&len) {
            (len - 2) as u8
        } else {
            0
        };
        let high = (((x >> 8) << 3) as u8) | count3;
        w.emit_bit(false, true)?;
        w.emit_bit(true, true)?;
        w.put(low)?;
        w.put(high)?;
        if count3 == 0 {
            w.put((len - 1) as u8)?; // c: len 10..=256 -> c 9..=0xFF (c>=2 garantido)
        }
        Ok(())
    }
}
