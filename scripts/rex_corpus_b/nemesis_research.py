#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""nemesis_research.py -- isolated RESEARCH decoder for the Mega Drive
"Nemesis" art compressor.

LICENCA / PROCEDENCIA (leia antes de usar):
  Este decoder foi escrito a partir da LEITURA da referencia LGPL-3.0
  mdcomp/src/lib/nemesis.cc (commit 72c6df405a75d322c5b3722da46c3abb864d3793),
  ou seja: e um DERIVADO DE LEITURA DE CODIGO LGPL-3.0. Consequencia honesta:
    * e ferramenta LOCAL DE PESQUISA/ANALISE;
    * NUNCA e candidato a produto: nada daqui pode ser transplantado, copiado,
      reempacotado ou ligado ao RetroDev Studio (regra da missao: mdcomp =
      somente ferramenta externa);
    * nenhuma linha foi copiada do C++; a semantica foi reconstruida e e
      validada byte a byte contra o oraculo externo nemcmp.

Contrato implementado: docs/rex_profiles/CONTRACTS.md v1 par. 4 (snapshot em
docs/rex_corpus_b/reference/docs_rex_profiles_CONTRACTS.md):
    decode(stream, limits) -> {data, bytes_consumed} | erro estruturado
com os codigos EXATOS truncated, invalid-reference, overflow, excessive-output,
work-limit, cancelled; bytes_consumed obrigatorio e exato; limites explicitos
(saida maxima, trabalho maximo, memoria maxima, cancelamento cooperativo);
validar antes de alocar; nenhum panic nem loop sem limite; erro jamais vira
offset 0 nem clamp silencioso.

O que este decoder DELIBERADAMENTE NAO replica do oraculo: o oraculo le alem do
fim do arquivo e continua ate rtiles*32, padeia entrada fora de dominio e aceita
stream truncada com tamanho pleno. Esses tres comportamentos sao FALHAS
registradas no negative-spec; aqui viram erros estruturados. Toda divergencia e
medida, nao presumida (ver scripts/rex_corpus_b/nemesis-validate.sh).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import namedtuple
from typing import Callable, Dict, List, Optional, Tuple

CODEC_NAME = "nemesis"
ORACLE_TOOL = "nemcmp"
ORACLE_SOURCE = "mdcomp src/lib/nemesis.cc"
ORACLE_COMMIT = "72c6df405a75d322c5b3722da46c3abb864d3793"
ORACLE_LICENSE = "LGPL-3.0-only"
TOOL_VERSION = "nemesis_research.py/0.1-research"

TILE_BYTES = 32          # Art Word 8x8 de planos de bit = 32 bytes
MAX_TILES = 0x7FFF       # campo de 15 bits do size word
INLINE_RLE_CODE = 0x3F   # padrao %111111
INLINE_RLE_LEN = 6
TABLE_TERMINATOR = 0xFF

# Codigos do contrato v1 par. 4 (exatamente estes; consumidor nao inventa outro)
CONTRACT_ERROR_CODES = (
    "truncated",
    "invalid-reference",
    "overflow",
    "excessive-output",
    "work-limit",
    "cancelled",
)
# Guarda de dominio exigida pelo negative-spec (n01/n02). NAO e codigo do
# par. 4: o par. 4 nao tem codigo para "entrada fora do dominio do formato";
# o negative-spec exige `input-not-in-domain`, entao ele e declarado aqui.
DOMAIN_ERROR_CODE = "input-not-in-domain"

DecodeResult = namedtuple("DecodeResult", ("data", "bytes_consumed"))


# ---------------------------------------------------------------------------
# erros estruturados
# ---------------------------------------------------------------------------
class NemesisError(Exception):
    """Base dos erros estruturados. `code` nunca e omitido nem 0."""

    code = "error"

    def __init__(self, message: str, **detail: object) -> None:
        super().__init__(message)
        self.message = message
        self.detail = detail

    def to_json(self) -> Dict[str, object]:
        return {"error": self.message, "error_code": self.code, **self.detail}


class TruncatedError(NemesisError):
    code = "truncated"


class InvalidReferenceError(NemesisError):
    code = "invalid-reference"


class OverflowError_(NemesisError):
    code = "overflow"


class ExcessiveOutputError(NemesisError):
    code = "excessive-output"


class WorkLimitError(NemesisError):
    code = "work-limit"


class CancelledError(NemesisError):
    code = "cancelled"


class InputNotInDomainError(NemesisError):
    code = DOMAIN_ERROR_CODE


# ---------------------------------------------------------------------------
# dominio do formato (lado plain / lado encode)
# ---------------------------------------------------------------------------
def check_plain_domain(plain: bytes) -> None:
    """Valida o dominio do formato para bytes PLAIN (Art Words 8x8).

    Dominio MEDIDO na rodada anterior: plain deve ser multiplo de 32 bytes E
    > 0. O oraculo padeia em silencio (6 B -> 32 B; 100 B -> 128 B) e SEGFAULTA
    no encode de plain vazio (rc=139). Recusar aqui e a obrigacao do produto
    declarada no negative-spec (n01, n02, defect_probes).
    """
    if len(plain) == 0:
        raise InputNotInDomainError(
            "plain vazio: fora do dominio (precisa ser > 0 e multiplo de 32); "
            "o oraculo SEGFAULTA neste caso (rc=139)",
            plain_len=0,
        )
    if len(plain) % TILE_BYTES != 0:
        raise InputNotInDomainError(
            "plain fora do dominio Art Word: len %% 32 == %d"
            % (len(plain) % TILE_BYTES),
            plain_len=len(plain),
        )


# ---------------------------------------------------------------------------
# cabecalho: size word + tabela de codigos
# ---------------------------------------------------------------------------
_HEADER_FIELDS = ("size_word", "modifier_byte", "mode_bit", "rtiles",
                  "declared_out", "table", "table_records",
                  "unreachable_records", "header_end")


class Header(namedtuple("Header", _HEADER_FIELDS)):
    """Cabecalho analisado.

    mode_bit / modifier_byte: o bit 15 do size word e o flag de VARIANTE do
    FORMATO. NAO existe variante 2B/4B/8B em nemesis.cc -- isso e convencao do
    consumidor sobre o layout dos plain bytes, nao do codec.
    """

    __slots__ = ()


def parse_header(stream: bytes, offset: int = 0, *,
                 work_limit: int = 2 ** 63 - 1, strict: bool = True) -> Header:
    """Le o size word e a tabela adaptativa. Erros: truncated / invalid-reference.

    Semantica do formato (reconstruida da leitura da referencia):
      * size word BE16 = (flag_alt << 15) | rtiles
      * registros da tabela: byte b; b == 0xFF termina; se b & 0x80 o nibble
        corrente passa a ser b & 0x0F e le-se outro b; entao
        count = ((b & 0x70) >> 4) + 1 nibbles, len = b & 0x0F, e o byte
        seguinte e o codigo (1 byte,emitido MSB-first no bitstream).
      * o nibble corrente PERSISTE entre registros sem flag 0x80 (inicializado
        a 0). Isso e do formato, nao palpite: sem replica-lo streams validas
        decodificam errado.
      * a tabela e um map chaveado por (code, len); registro duplicado
        sobrescreve o anterior (comportamento medido do std::map da referencia).
    """
    n = len(stream)
    if offset < 0 or offset + 2 > n:
        avail = max(0, n - max(offset, 0))
        raise TruncatedError(
            "size word ausente: %d byte(s) disponiveis a partir do offset %d"
            % (avail, offset),
            needed=2, available=avail, offset=offset,
        )
    size_word = int.from_bytes(stream[offset:offset + 2], "big")
    modifier_byte = stream[offset]
    mode_bit = (size_word >> 15) & 1
    rtiles = size_word & MAX_TILES
    declared_out = rtiles * TILE_BYTES

    work = 0
    table: Dict[Tuple[int, int], Tuple[int, int]] = {}
    unreachable: List[Tuple[int, int, int]] = []
    records = 0
    pos = offset + 2
    nibble = 0
    while True:
        if pos >= n:
            raise TruncatedError(
                "tabela de codigos sem terminator 0xFF: EOF em %d/%d" % (pos, n),
                needed=1, position=pos, table_records=records,
            )
        b = stream[pos]
        pos += 1
        work += 1
        if b == TABLE_TERMINATOR:
            break
        if b & 0x80:
            nibble = b & 0x0F
            if pos >= n:
                raise TruncatedError(
                    "registro de tabela truncado apos seletor de nibble",
                    needed=1, position=pos, table_records=records,
                )
            b = stream[pos]
            pos += 1
            work += 1
        count = ((b & 0x70) >> 4) + 1
        length = b & 0x0F
        if pos >= n:
            raise TruncatedError(
                "registro de codigo sem byte de codigo",
                needed=1, position=pos, table_records=records,
            )
        code = stream[pos]
        pos += 1
        work += 1
        records += 1
        if length == 0:
            # Nenhum bitstream produz len == 0: o par (code, 0) e inatingivel
            # porque o acumulador comeca em len = 1. O oraculo o IGNORA em
            # silencio. O contrato v1 proibe erro silencioso -> strict.
            unreachable.append((code, length, nibble))
            if strict:
                raise InvalidReferenceError(
                    "registro de tabela com comprimento de codigo 0: referencia "
                    "inatingivel por qualquer bitstream",
                    code_declared=code, len_declared=length, nibble=nibble,
                    position=pos - 1,
                )
        table[(code, length)] = (nibble, count)
        if work > work_limit:
            raise WorkLimitError(
                "limite de trabalho atingido ao ler a tabela",
                limit_work=work_limit, work=work,
            )
    return Header(size_word, modifier_byte, mode_bit, rtiles, declared_out,
                  table, records, unreachable, pos)


# ---------------------------------------------------------------------------
# limite de trabalho + cancelamento cooperativo
# ---------------------------------------------------------------------------
class _WorkCounter:
    """Limite de trabalho e cancelamento cooperativo com passo fixo.

    O cancelamento e consultado a cada `_CANCEL_INTERVAL` unidades de trabalho:
    deterministico, nao depende de tempo nem de sorte.
    """

    _CANCEL_INTERVAL = 4096

    __slots__ = ("limit", "cancel", "work", "_next_cancel")

    def __init__(self, limit: int, cancel: Optional[Callable[[], bool]]) -> None:
        self.limit = limit
        self.cancel = cancel
        self.work = 0
        self._next_cancel = self._CANCEL_INTERVAL

    def add(self, count: int) -> None:
        self.work += count
        if self.work > self.limit:
            raise WorkLimitError(
                "limite de trabalho atingido: %d > %d" % (self.work, self.limit),
                limit_work=self.limit, work=self.work,
            )

    def checkpoint(self) -> None:
        if self.cancel is None:
            return
        if self.work >= self._next_cancel:
            self._next_cancel = self.work + self._CANCEL_INTERVAL
            if self.cancel():
                raise CancelledError(
                    "cancelamento cooperativo solicitado", work=self.work,
                )


def _emit(buf: bytearray, nib: int, cnt: int, work: _WorkCounter) -> None:
    buf.extend(bytes((nib,)) * cnt)
    work.add(cnt)


def variant_name(mode_bit: int) -> str:
    return "nemesis-raw" if mode_bit == 0 else "nemesis-alt-xor"


# ---------------------------------------------------------------------------
# decode
# ---------------------------------------------------------------------------
def decode(stream: bytes, *, max_out: int, work_limit: int,
           cancel: Optional[Callable[[], bool]] = None,
           offset: int = 0, max_memory: Optional[int] = None,
           strict: bool = True,
           stats: Optional[Dict[str, object]] = None) -> DecodeResult:
    """Decodifica um stream Nemesis a partir de `offset`.

    Retorna `(data, bytes_consumed)`; `bytes_consumed` e EXATO e obrigatorio
    (size word + tabela + ceil(bits lidos / 8)). Falha = excecao estruturada com
    um dos codigos do contrato v1.

    Limites explicitos: `max_out`, `max_memory` (teto de alocacao),
    `work_limit` e `cancel` (callable cooperativo). Nada e alocado antes de
    validar os limites.

    Contabilidade de trabalho (deterministica, documentada): +1 por byte
    consumido no cabecalho (size word + tabela + terminator), +1 por BIT lido no
    bitstream, +1 por nibble emitido. A fase de tabela e limitada tambem pelo
    mesmo `work_limit` dentro de `parse_header`.
    """
    if max_out < 0 or work_limit < 0:
        raise ValueError("limites nao podem ser negativos")
    if stats is not None:
        stats.clear()

    # O orçamento de trabalho cobre a tabela tambem: a leitura dela e limitada
    # pelo mesmo `work_limit` (termina por EOF de qualquer forma, mas o contrato
    # exige limite explicito em toda fase de parse).
    hdr = parse_header(stream, offset, work_limit=work_limit, strict=strict)

    # ---- valida ANTES de alocar ----
    if hdr.rtiles == 0:
        raise InputNotInDomainError(
            "size word declara 0 tiles: saida esperada de 0 bytes esta fora do "
            "dominio Art Word (>0 e multiplo de 32); o oraculo devolve 0 bytes "
            "com rc=0 (falsa aceitacao)",
            declared_tiles=0, declared_out=0, modifier_byte=hdr.modifier_byte,
        )
    if hdr.declared_out > max_out:
        raise ExcessiveOutputError(
            "saida declarada excede max_out: %d > %d" % (hdr.declared_out, max_out),
            limit_max_out=max_out, limit_max_memory=max_memory,
            declared_out=hdr.declared_out, declared_tiles=hdr.rtiles,
            modifier_byte=hdr.modifier_byte, variant=variant_name(hdr.mode_bit),
        )
    if max_memory is not None and hdr.declared_out > max_memory:
        raise OverflowError_(
            "saida declarada excede o teto de memoria: %d > %d"
            % (hdr.declared_out, max_memory),
            limit_max_out=max_out, limit_max_memory=max_memory,
            declared_out=hdr.declared_out, declared_tiles=hdr.rtiles,
            modifier_byte=hdr.modifier_byte, variant=variant_name(hdr.mode_bit),
        )

    work = _WorkCounter(work_limit, cancel)
    work.add(hdr.header_end - offset)

    total_bits = hdr.rtiles << 8          # rtiles * 32 bytes * 8 bits
    bit_start = hdr.header_end
    avail_bits = (len(stream) - bit_start) * 8
    if avail_bits < 1:
        raise TruncatedError(
            "bitstream ausente apos o cabecalho",
            needed=1, available=0, position=bit_start,
        )

    nibbles = bytearray()                 # 1 byte por nibble: simples e exato
    state = {"bits_read": 0, "code": 0, "work": work}

    def get_bit() -> int:
        read = state["bits_read"]
        if read >= avail_bits:
            raise TruncatedError(
                "EOF no meio do bitstream: falta(m) bit(s) alem de %d" % avail_bits,
                needed=1, available_bits=avail_bits, bits_read=read,
                position=bit_start + (read >> 3),
            )
        byte = stream[bit_start + (read >> 3)]
        bit = (byte >> (7 - (read & 7))) & 1
        state["bits_read"] = read + 1
        state["work"].add(1)
        return bit

    inline_hits = 0
    table_hits = 0
    longest_len = 1

    code = get_bit()
    length = 1
    while len(nibbles) * 4 < total_bits:
        work.checkpoint()
        if code == INLINE_RLE_CODE and length == INLINE_RLE_LEN:
            inline_hits += 1
            cnt = 0
            for _ in range(3):
                cnt = (cnt << 1) | get_bit()
            nib = 0
            for _ in range(4):
                nib = (nib << 1) | get_bit()
            _emit(nibbles, nib, cnt + 1, work)
            if len(nibbles) * 4 >= total_bits:
                break
            code = get_bit()
            length = 1
            continue
        hit = hdr.table.get((code, length))
        if hit is not None:
            table_hits += 1
            if length > longest_len:
                longest_len = length
            nib, cnt = hit
            _emit(nibbles, nib, cnt, work)
            if len(nibbles) * 4 >= total_bits:
                break
            code = get_bit()
            length = 1
            continue
        # Nao e codigo: acumula mais um bit (MSB-first), sem teto de
        # comprimento, exatamente como o formato. O que impede loop sem fim e
        # `avail_bits` (EOF => truncated) mais `work_limit`.
        code = (code << 1) | get_bit()
        length += 1
        if length > longest_len:
            longest_len = length

    # ---- empacota nibbles MSB-first e corta na saida declarada ----
    out = bytearray()
    it = iter(nibbles)
    for hi in it:
        lo = next(it, 0)
        out.append((hi << 4) | lo)
    if len(out) < hdr.declared_out:
        # Inalcancavel pelo desenho do loop (para quando bits >= total_bits),
        # mantido como guarda explicita: jamais padeiar em silencio.
        raise TruncatedError(
            "bitstream terminou antes da saida declarada: %d < %d"
            % (len(out), hdr.declared_out),
            produced=len(out), declared_out=hdr.declared_out,
        )
    del out[hdr.declared_out:]

    if hdr.mode_bit:
        # variante "alternating"/XOR: palavra LE de 4 bytes com XOR incremental;
        # por bytes isso e exatamente out[j] ^= out[j-4], esquerda -> direita.
        for j in range(4, len(out)):
            out[j] ^= out[j - 4]

    bits_read = state["bits_read"]
    bytes_consumed = bit_start - offset + ((bits_read + 7) // 8)
    if stats is not None:
        stats.update({
            "modifier_byte": hdr.modifier_byte,
            "size_word": hdr.size_word,
            "mode_bit": hdr.mode_bit,
            "variant": variant_name(hdr.mode_bit),
            "declared_tiles": hdr.rtiles,
            "declared_out": hdr.declared_out,
            "header_bytes": hdr.header_end - offset,
            "table_records": hdr.table_records,
            "table_codes": len(hdr.table),
            "bitstream_bits": bits_read,
            "bitstream_bytes": (bits_read + 7) // 8,
            "inline_rle_hits": inline_hits,
            "table_hits": table_hits,
            "longest_len_matched": longest_len,
            "nibbles_emitted": len(nibbles),
            "work_units": work.work,
        })
    return DecodeResult(bytes(out), bytes_consumed)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def cmd_decode(args: argparse.Namespace) -> int:
    with open(args.infile, "rb") as fh:
        stream = fh.read()
    result: Dict[str, object] = {
        "codec": CODEC_NAME,
        "tool": TOOL_VERSION,
        "reference": {"source": ORACLE_SOURCE, "commit": ORACLE_COMMIT,
                      "license": ORACLE_LICENSE,
                      "role": "external-oracle-only; nada transplantado"},
        "input": args.infile,
        "input_size": len(stream),
        "offset": args.offset,
        "variant": None,
        "modifier_byte": None,
        "declared_tiles": None,
        "input_span": None,
        "bytes_consumed": None,
        "output_size": None,
        "output_sha256": None,
        "error": None,
        "error_code": None,
        "limits": {"max_out": args.max_out, "work_limit": args.work_limit,
                   "max_memory": args.max_memory, "cancel": None},
    }
    stats: Dict[str, object] = {}
    try:
        data, consumed = decode(stream, max_out=args.max_out,
                                work_limit=args.work_limit, offset=args.offset,
                                max_memory=args.max_memory,
                                strict=not args.lenient, stats=stats)
    except NemesisError as exc:
        result["error"] = exc.message
        result["error_code"] = exc.code
        for key, val in exc.detail.items():
            result[key] = val
        if stats:
            result["decode_stats"] = stats
        try:
            hdr = parse_header(stream, args.offset, strict=not args.lenient)
            result["variant"] = variant_name(hdr.mode_bit)
            result["modifier_byte"] = hdr.modifier_byte
            result["declared_tiles"] = hdr.rtiles
            result["input_span"] = {"start": args.offset,
                                    "header_end": hdr.header_end,
                                    "length_known": False}
        except NemesisError:
            pass
        print(json.dumps(result, indent=2, sort_keys=True))
        return 1
    result["variant"] = str(stats["variant"])
    result["modifier_byte"] = stats["modifier_byte"]
    result["declared_tiles"] = stats["declared_tiles"]
    result["bytes_consumed"] = consumed
    result["input_span"] = {"start": args.offset, "end": args.offset + consumed,
                            "length": consumed, "length_known": True}
    result["output_size"] = len(data)
    result["output_sha256"] = _sha(data)
    result["decode_stats"] = stats
    if args.out:
        with open(args.out, "wb") as fh:
            fh.write(data)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


def cmd_inspect(args: argparse.Namespace) -> int:
    with open(args.infile, "rb") as fh:
        stream = fh.read()
    out: Dict[str, object] = {"codec": CODEC_NAME, "input": args.infile,
                              "offset": args.offset}
    try:
        hdr = parse_header(stream, args.offset, strict=False)
    except NemesisError as exc:
        out.update(exc.to_json())
        print(json.dumps(out, indent=2, sort_keys=True))
        return 1
    by_len = sorted({length for (_c, length) in hdr.table})
    out.update({
        "size_word": hdr.size_word,
        "modifier_byte": hdr.modifier_byte,
        "mode_bit": hdr.mode_bit,
        "variant": variant_name(hdr.mode_bit),
        "declared_tiles": hdr.rtiles,
        "declared_out": hdr.declared_out,
        "header_bytes": hdr.header_end - args.offset,
        "table_records": hdr.table_records,
        "table_codes": len(hdr.table),
        "unreachable_records_len0": hdr.unreachable_records,
        "table_codes_by_len": {str(length): sum(
            1 for (_c, l) in hdr.table if l == length) for length in by_len},
    })
    print(json.dumps(out, indent=2, sort_keys=True))
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Nemesis research decoder (analysis-only, LGPL-derived)")
    sub = parser.add_subparsers(dest="cmd", required=True)
    dec = sub.add_parser("decode", help="decodifica stream Nemesis; JSON no stdout")
    dec.add_argument("--in", dest="infile", required=True)
    dec.add_argument("--out", dest="out", default=None)
    dec.add_argument("--offset", type=int, default=0)
    dec.add_argument("--max-out", type=int, default=1 << 20)
    dec.add_argument("--work-limit", type=int, default=1 << 24)
    dec.add_argument("--max-memory", type=int, default=None)
    dec.add_argument("--lenient", action="store_true",
                     help="nao rejeitar registros de tabela com len==0 "
                          "(replica o silencio do oraculo; so para analise)")
    dec.set_defaults(func=cmd_decode)
    ins = sub.add_parser("inspect", help="analisa cabecalho/variante sem decodificar")
    ins.add_argument("--in", dest="infile", required=True)
    ins.add_argument("--offset", type=int, default=0)
    ins.set_defaults(func=cmd_inspect)
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
