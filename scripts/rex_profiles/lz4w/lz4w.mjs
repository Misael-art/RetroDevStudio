// Decodificador LZ4W (variante SGDK word-based, prev-block/dicionario).
// Port determinista do unpacker oficial coas constantes documentadas no
// Rust do produto (src-tauri/src/tools/reverse/decomp/rex_codecs.rs,
// verificado alí contra o oráculo lz4w.jar nas dúas direccións).
//
// Formato: secuencia de tokens u16 big-endian
//   (literal_count<<12) | (match_count<<8) | match_byte
//  - literal_count words LE copiadas verbatim do stream;
//  - match_count>0: match curto de match_count+1 words a offset
//    match_byte+1 words;
//  - match_count==0 e match_byte>0: match longo de match_byte+2 words; o
//    word seguinte tras os literais codifica o offset como negación de
//    15 bits (raw = ((-v)&0x7FFF)+1); bit 0x8000 = ROM source (dicionario
//    = bloque anterior), cuxo offset axústase por offset_adj
//    (+1/token, +1/word de offset longo, -lonxitude/match);
//  - token 0x0000: terminador + word final 0x8000|byte (saída ímpar) ou
//    0x0000 (par).
const MATCH_MIN_SIZE = 1;
const MATCH_LONG_MIN_SIZE = 2;
const MATCH_LONG_OFFSET_MASK = 0x7fff;
const MATCH_LONG_OFFSET_ROM_SOURCE = 0x8000;
const MAX_OUTPUT = 4 * 1024 * 1024;
const MAX_WORK = 64 * 1024 * 1024;

class CodecError extends Error {
  constructor(code, detail) {
    super(`codec error [${code}]: ${detail}`);
    this.code = code;
  }
}


/**
 * @param {Uint8Array} stream bytes do stream (desde o offset do stream ata o fim da ROM)
 * @param {Uint8Array|null} dictionary prefixo da ROM que precede o stream (prev-block) ou null
 */
export function lz4wDecode(stream, dictionary = null) {
  if (stream.length < 2) throw new CodecError("truncated", "stream menor que un token");
  const dict = dictionary ?? new Uint8Array(0);
  if (dict.length % 2 !== 0)
    throw new CodecError("invalid_reference", "dicionario con lonxitude impar non enderezable por words");
  const buf = Array.from(dict);
  const dictLen = dict.length;
  let offsetAdj = 0;
  let work = 0;
  let ind = 0;

  const readWord = (pos) => {
    if (pos + 2 > stream.length) throw new CodecError("truncated", `word en ${pos} fora do stream`);
    return ((stream[pos] << 8) | stream[pos + 1]) >>> 0;
  };

  for (;;) {
    if (++work > MAX_WORK) throw new CodecError("work_limit", "orzo de traballo excedido");
    const token = readWord(ind);
    offsetAdj += 1;
    if (token === 0) {
      const finalWord = readWord(ind + 2);
      let consumed = ind + 4;
      if ((finalWord & MATCH_LONG_OFFSET_ROM_SOURCE) !== 0) {
        if (buf.length - dictLen + 1 > MAX_OUTPUT)
          throw new CodecError("excessive_output", "byte final excedería o límite");
        buf.push(finalWord & 0xff);
      } else if (finalWord !== 0) {
        throw new CodecError("invalid_reference", `word final 0x${finalWord.toString(16)} sen flag de byte impar`);
      }
      if (consumed > stream.length) consumed = stream.length;
      return { data: Uint8Array.from(buf.slice(dictLen)), bytesConsumed: consumed };
    }
    const literalWords = (token >> 12) & 0xf;
    const matchNibble = (token >> 8) & 0xf;
    const matchByte = token & 0xff;
    ind += 2;
    if (ind + literalWords * 2 > stream.length)
      throw new CodecError("truncated", `${literalWords} literais truncados en ${ind}`);
    if (buf.length - dictLen + literalWords * 2 > MAX_OUTPUT)
      throw new CodecError("excessive_output", "límite de saída excedido en literal");
    for (let i = 0; i < literalWords * 2; i++) buf.push(stream[ind + i]);
    work += literalWords;
    ind += literalWords * 2;

    let matchWords = 0;
    let matchOffset = 0;
    if (matchNibble > 0) {
      matchWords = matchNibble + MATCH_MIN_SIZE;
      matchOffset = matchByte + 1;
    } else if (matchByte > 0) {
      const encoded = readWord(ind);
      ind += 2;
      offsetAdj += 1;
      const rawOffset = (((-encoded) & MATCH_LONG_OFFSET_MASK) >>> 0) + 1;
      if ((encoded & MATCH_LONG_OFFSET_ROM_SOURCE) !== 0) {
        if (dictLen === 0)
          throw new CodecError(
            "invalid_reference",
            "stream depende de dicionario externo (ROM source); decode autonomo recusado"
          );
        const adjusted = rawOffset - offsetAdj;
        if (adjusted < 1 || adjusted > Math.floor(buf.length / 2))
          throw new CodecError(
            "invalid_reference",
            `referencia ROM source ${rawOffset} axustada a ${adjusted} words fora das ${Math.floor(buf.length / 2)} do resultado`
          );
        matchWords = matchByte + MATCH_LONG_MIN_SIZE;
        matchOffset = adjusted;
      } else {
        matchWords = matchByte + MATCH_LONG_MIN_SIZE;
        matchOffset = rawOffset;
      }
    }
    if (matchWords > 0) {
      const totalWords = Math.floor(buf.length / 2);
      if (matchOffset > totalWords)
        throw new CodecError("invalid_reference", `offset ${matchOffset} excede o historial de ${totalWords} words`);
      let src = buf.length - matchOffset * 2;
      for (let i = 0; i < matchWords; i++) {
        if (++work > MAX_WORK) throw new CodecError("work_limit", "orzo excedido no match");
        if (buf.length - dictLen + 2 > MAX_OUTPUT)
          throw new CodecError("excessive_output", "límite de saída excedido en match");
        buf.push(buf[src], buf[src + 1]); // words verbatim (o buf almacena bytes na orde orixinal)
        src += 2;
      }
      offsetAdj -= matchWords;
    }
  }
}

export { CodecError };
