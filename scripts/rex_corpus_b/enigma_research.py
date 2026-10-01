#!/usr/bin/env python3
"""RESEARCH / ANALYSIS TOOL ONLY — never a product candidate.

Enigma (Mega Drive) decoder reconstructed from reading the LGPL-3.0 mdcomp
reference (src/lib/enigma.cc @ 72c6df405a75d322c5b3722da46c3abb864d3793).
This file is DERIVED BY READING that LGPL reference; mdcomp code is NOT
transplanted, and this implementation may NOT enter the RetroDev Studio
product. It exists solely to cross-check byte-exact behaviour against the
external `enicmp` oracle on authored fixtures (mission REX corpus B).

Contract: docs/rex_profiles/CONTRACTS.md v1 section 4 (see
docs/rex_corpus_b/reference/docs_rex_profiles_CONTRACTS.md).

Domain of the fixed variant (measured, see docs/rex_corpus_b/ENIGMA-RESEARCH.md):
  * output domain is an array of 16-bit big-endian words => output length is
    always even by construction; odd-length *plain* inputs are outside the
    encoder domain and are refused (never silently clamped like the oracle).
  * stream = 6-byte header + bit-packed tokens, MSB-first over 16-bit BE words.
      [0]   packet_length  : low-bit width of each value; variant domain 1..11
      [1]   mask byte      : bits 0..4 select which of value bits 11..15 are
                             read per value (1 stream bit each); domain 0..31
      [2:4] incrementing_value (BE u16)
      [4:6] common_value        (BE u16)
    then tokens:
      bit 0 -> sub-bit 0: incrementing run  cnt=read4+1 values incr,incr+1,..
               sub-bit 1: common run        cnt=read4+1 copies of common_value
      bit 1 -> mode=read2:
          0/1/2: repeat run cnt=read4+1, per-value = read(packet_length)
                 | getMask(); deltas 0, +1, -1 (mod 2**16)
          3    : cnt=read4; 0x0F => end-of-stream terminator; else
                 cnt+1 inline values, each read(packet_length) | getMask().
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from typing import Callable, Optional

CODEC = "enigma"
VARIANT = "mdcomp-plain-enigma (enicmp @ 72c6df405a75d322c5b3722da46c3abb864d3793)"
HEADER_LEN = 6
DEFAULT_MAX_OUT = 8 * 1024 * 1024
DEFAULT_WORK_LIMIT = 4_000_000  # decoded tokens

# v1 frozen error codes (CONTRACTS.md section 4).
V1_ERROR_CODES = (
    "truncated",
    "invalid-reference",
    "overflow",
    "excessive-output",
    "work-limit",
    "cancelled",
)
# Declared extension required by the negative-spec phase-3 mapping
# ("malformed-header"), documented as a v1 gap in ENIGMA-RESEARCH.md.
EXT_ERROR_CODES = ("malformed-header",)
ERROR_CODES = V1_ERROR_CODES + EXT_ERROR_CODES

MASK_BIT_VALUE_POS = 11  # mask bit j -> value bit j+11
PACKET_LENGTH_DOMAIN = (1, 11)  # bits 0..10; bits 11..15 belong to the mask


class CodecError(Exception):
    """Structured codec error with an exact v1 (or declared-extension) code."""

    def __init__(self, code: str, detail: str):
        assert code in ERROR_CODES, code
        super().__init__(f"{code}: {detail}")
        self.code = code
        self.detail = detail


class _BitReader:
    """MSB-first bit reader over a byte span. EOF is a structured `truncated`
    error — never a silent zero/refill like the oracle."""

    __slots__ = ("_data", "_pos", "_end")

    def __init__(self, data: bytes, start: int):
        self._data = data
        self._pos = start * 8
        self._end = len(data) * 8

    def pop(self) -> int:
        if self._pos >= self._end:
            raise CodecError("truncated", "bitstream ended mid-token (1 flag bit)")
        b = (self._data[self._pos >> 3] >> (7 - (self._pos & 7))) & 1
        self._pos += 1
        return b

    def read(self, cnt: int) -> int:
        if cnt == 0:
            return 0
        if self._pos + cnt > self._end:
            raise CodecError(
                "truncated", f"bitstream ended mid-token ({cnt} bits)"
            )
        v = 0
        for _ in range(cnt):
            v = (v << 1) | ((self._data[self._pos >> 3] >> (7 - (self._pos & 7))) & 1)
            self._pos += 1
        return v

    @property
    def bits_used(self) -> int:
        return self._pos - HEADER_LEN * 8  # bit count after the header


def decode(
    stream: bytes,
    *,
    max_out: int = DEFAULT_MAX_OUT,
    work_limit: int = DEFAULT_WORK_LIMIT,
    cancel: Optional[Callable[[], bool]] = None,
    value_offset: Optional[int] = None,
    stats: Optional[dict] = None,
) -> tuple[bytes, int]:
    """decode(stream, limits) -> (data, bytes_consumed) | raises CodecError.

    bytes_consumed = HEADER_LEN + ceil(bits_used/8); it is exact for streams
    ending on a byte boundary (all oracle-authored streams) and is the minimal
    span covering every bit actually read otherwise. mdcomp's own tellg-based
    span additionally prefetches a whole 16-bit word at word boundaries
    (EarlyRead) — divergence documented, never adopted.

    value_offset is an EXTERNAL parameter (tile/pattern base in real games).
    It is not part of the stream and is NOT evidenced by any fixture here:
    pass None (default). If an operator supplies it, it is applied as
    (word + offset) & 0xFFFF — an unverified convention, flagged in output.
    """
    if value_offset is not None:
        value_offset &= 0xFFFF
    n = len(stream)
    if n < HEADER_LEN:
        raise CodecError(
            "truncated", f"stream too short for {HEADER_LEN}-byte header (have {n})"
        )
    packet_length = stream[0]
    mask_byte = stream[1]
    if not (PACKET_LENGTH_DOMAIN[0] <= packet_length <= PACKET_LENGTH_DOMAIN[1]):
        raise CodecError(
            "malformed-header",
            f"packet_length {packet_length} outside variant domain "
            f"{PACKET_LENGTH_DOMAIN}",
        )
    if mask_byte > 31:
        raise CodecError(
            "malformed-header", f"mask byte {mask_byte} > 0x1F (undefined bits)"
        )
    incrementing_value = int.from_bytes(stream[2:4], "big")
    common_value = int.from_bytes(stream[4:6], "big")

    mask_positions = [j for j in range(4, -1, -1) if (mask_byte >> j) & 1]

    bits = _BitReader(stream, HEADER_LEN)
    out = bytearray()
    words = 0
    work = 0

    def emit(word: int) -> None:
        nonlocal words
        if len(out) + 2 > max_out:
            raise CodecError(
                "excessive-output",
                f"output would exceed max_out={max_out} at word {words}",
            )
        if value_offset is not None:
            word = (word + value_offset) & 0xFFFF
        out.extend(word.to_bytes(2, "big"))
        words += 1

    while True:
        work += 1
        if work > work_limit:
            raise CodecError("work-limit", f"exceeded {work_limit} tokens")
        if cancel is not None and cancel():
            raise CodecError("cancelled", "cooperative cancellation at token boundary")

        if bits.pop() == 1:
            mode = bits.read(2)
            if mode == 3:
                cnt = bits.read(4)
                if cnt == 0x0F:
                    if stats is not None:
                        stats["terminator"] = stats.get("terminator", 0) + 1
                    break
                if stats is not None:
                    stats["inline"] = stats.get("inline", 0) + (cnt + 1)
                for _ in range(cnt + 1):
                    flags = 0
                    for j in mask_positions:  # descending: bit 15 first
                        flags |= bits.pop() << (j + MASK_BIT_VALUE_POS)
                    emit(bits.read(packet_length) | flags)
            else:
                cnt = bits.read(4) + 1
                flags = 0
                for j in mask_positions:
                    flags |= bits.pop() << (j + MASK_BIT_VALUE_POS)
                val = bits.read(packet_length) | flags
                if stats is not None:
                    key = f"delta-run-mode{mode}"
                    stats[key] = stats.get(key, 0) + cnt
                delta = (0, 1, 0xFFFF)[mode]  # 0, +1, -1 mod 2**16
                for _ in range(cnt):
                    emit(val)
                    val = (val + delta) & 0xFFFF
        else:
            kind = bits.pop()
            cnt = bits.read(4) + 1
            if kind == 0:
                if stats is not None:
                    stats["incr-run"] = stats.get("incr-run", 0) + cnt
                val = incrementing_value
                for _ in range(cnt):
                    emit(val)
                    val = (val + 1) & 0xFFFF
                incrementing_value = val
            else:
                if stats is not None:
                    stats["common-run"] = stats.get("common-run", 0) + cnt
                for _ in range(cnt):
                    emit(common_value)

    bits_used = bits.bits_used
    min_span = HEADER_LEN + (bits_used + 7) // 8  # bit-exact consumed span
    word_rounded = HEADER_LEN + ((bits_used + 15) // 16) * 2  # mdcomp tellg span
    if min_span > n:
        # We read bits that the span cannot cover => the last byte was
        # incomplete for what the token demanded.
        raise CodecError("truncated", "final token extends past stream end")
    if stats is not None:
        stats["bits_used"] = bits_used
        stats["bytes_consumed_word_rounded"] = word_rounded
    return bytes(out), min_span


def cli_decode(args: argparse.Namespace) -> int:
    stream = open(args.file, "rb").read()
    result = {
        "codec": CODEC,
        "variant": VARIANT,
        "tool": "enigma_research.py (research-only; derived by reading LGPL mdcomp)",
        "input_span": args.file,
        "limits": {"max_out": args.max_out, "work_limit": args.work_limit},
        "external_parameters": {
            "value_offset": {
                "parameter": args.offset,
                "status": (
                    "not-evidenced" if args.offset is None else "operator-supplied-hypothesis"
                ),
            },
            "write_destination": {"parameter": None, "status": "not-evidenced"},
            "write_size": {"parameter": None, "status": "not-evidenced"},
        },
    }
    stats: dict = {}
    try:
        data, consumed = decode(
            stream,
            max_out=args.max_out,
            work_limit=args.work_limit,
            value_offset=args.offset,
            stats=stats,
        )
    except CodecError as e:
        result.update(
            {
                "bytes_consumed": None,
                "output_size": None,
                "output_sha256": None,
                "error": str(e),
                "error_code": e.code,
            }
        )
        print(json.dumps(result, sort_keys=True))
        return 1
    if args.out:
        with open(args.out, "wb") as f:
            f.write(data)
    result.update(
        {
            "bytes_consumed": consumed,
            "input_span_bytes": len(stream),
            "output_size": len(data),
            "output_sha256": hashlib.sha256(data).hexdigest(),
            "token_stats": stats,
            "error": None,
            "error_code": None,
        }
    )
    print(json.dumps(result, sort_keys=True))
    return 0


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("decode")
    d.add_argument("--in", dest="file", required=True)
    d.add_argument("--out", dest="out")
    d.add_argument("--offset", type=int, default=None,
                   help="EXTERNAL value/tile-base parameter; NOT evidenced by "
                        "fixtures — use only as an explicit operator hypothesis")
    d.add_argument("--max-out", type=int, default=DEFAULT_MAX_OUT)
    d.add_argument("--work-limit", type=int, default=DEFAULT_WORK_LIMIT)
    d.set_defaults(fn=cli_decode)
    args = p.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
