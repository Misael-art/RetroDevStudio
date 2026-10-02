// Decoder aPLib raw (sen header "AP\\0") — porta JS do contrato do axente B
// calibrado contra apultra + APJ (REX-B docs/rex_profiles/codecs/aplib.md).
// Variante SGDK: byte 0 = primeiro literal; tokens MSB->LSB, byte de tag novo
// SO quando a mascara zera (os tokens poden atravessar tags); EOD = token 110
// + byte 0x00; LWM (nFollowsLiteral) = 3 tras literal/111, 2 tras match.
export class AplibError extends Error {
  constructor(kind, message) {
    super(message ?? `aplib: ${kind}`);
    this.name = "AplibError";
    this.kind = kind;
  }
}

const MINMATCH3_OFFSET = 1280;
const MINMATCH4_OFFSET = 32000;

export function aplibDecode(bytes, { offset = 0, maxSize = 1 << 22 } = {}) {
  const end = bytes.length;
  let pos = offset;
  let tag = 0;
  let mask = 0;
  let lastOffset = 0; // 0 = historial invalido
  let lwm = 3;
  const out = [];

  const nextByte = () => {
    if (pos >= end) throw new AplibError("truncated", "aplib: fluxo truncado (byte)");
    return bytes[pos++];
  };
  const bit = () => {
    if (mask === 0) {
      tag = nextByte();
      mask = 8;
    }
    return (tag >> --mask) & 1;
  };
  const gamma2 = () => {
    let v = 1;
    for (;;) {
      const d = bit();
      v = (v << 1) | d;
      if (!bit()) break;
    }
    return v;
  };
  const put = (b) => {
    if (out.length >= maxSize) throw new AplibError("overflow", `aplib: saída excede maxSize ${maxSize}`);
    out.push(b);
  };
  const rawCopy = (off, len) => {
    if (off < 1 || off > out.length)
      throw new AplibError("invalid-reference", `aplib: referencia invalida off=${off} len=${len} @${out.length}`);
    for (let i = 0; i < len; i++) put(out[out.length - off]);
  };
  const copy = (off, len) => {
    rawCopy(off, len);
    lastOffset = off;
  };

  put(nextByte()); // byte 0: literal directo

  for (;;) {
    if (bit() === 0) {
      // token 0: literal
      put(nextByte());
      lwm = 3;
      continue;
    }
    if (bit() === 0) {
      // token 10: match longo (ou rep-match se off_hi < 0)
      const offHi = gamma2() - lwm;
      let len;
      let off;
      if (offHi < 0) {
        if (lastOffset === 0)
          throw new AplibError("invalid-reference", "aplib: rep-match sen match previo");
        off = lastOffset;
        len = gamma2(); // sen axuste (asimetria confirmada en tools_a.s)
      } else {
        off = (offHi << 8) | nextByte();
        len = gamma2();
        if (off < 128 || off >= MINMATCH4_OFFSET) len += 2;
        else if (off >= MINMATCH3_OFFSET) len += 1;
      }
      copy(off, len);
      lwm = 2;
      continue;
    }
    if (bit() === 0) {
      // token 110: byte de comando; 0x00 = EOD
      const cmd = nextByte();
      if (cmd === 0) return { output: Uint8Array.from(out), bytesConsumed: pos - offset };
      copy(cmd >> 1, 2 + (cmd & 1));
      lwm = 2;
      continue;
    }
    // token 111: offset curto de 4 bits (NON actualiza o historial de offset)
    let off4 = 0;
    for (let i = 0; i < 4; i++) off4 = (off4 << 1) | bit();
    if (off4 === 0) put(0);
    else rawCopy(off4, 1);
    lwm = 3;
  }
}
