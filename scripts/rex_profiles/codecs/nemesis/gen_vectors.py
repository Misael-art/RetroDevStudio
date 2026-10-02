#!/usr/bin/env python3
"""Gera plains determinísticos p/ o perfil Nemesis (fase 2 roundtrip-only).

Nemesis opera sobre dados no formato Art Word (tiles 8x8, plano de bit):
o oráculo mdcomp `nemcmp` medido em 2026-09-25 ACEITA QUALQUER entrada mas
silenciosamente PADRINHA decode() para múltiplo de 32 (6 bytes -> 32). Os
plains aqui são fixtures autorais com frontes relevantes p/ compressão de
planos de bit: 0x00/0xFF/0x55/0xAA (canal constante/invertido), rampas de
nibble, padrões tipo tile e pseudoaleatório semeado.

Goldens artesanais NÃO são publicados nesta fase: um stream .nem literal
exige espelhar a construção dinâmica da tabela de códigos de nibble
(nemesis.cc usa árvore adaptativa por passada), e a missão determina
registrar o bloqueio com motivo em vez de ajustar a referência. Ver
data/rex_profiles/codec/nemesis/manifest.json (golden-literal-streams).
"""
import sys
from pathlib import Path

OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("vectors")
(OUT / "plain").mkdir(parents=True, exist_ok=True)


def prng(seed: int):
    x = seed & 0x7FFFFFFF

    def nxt() -> int:
        nonlocal x
        x = (1103515245 * x + 12345) & 0x7FFFFFFF
        return x

    return nxt


def tile(pattern: bytes) -> bytes:
    # 8 bytes = 1 Art Word (linha de plano de bit não; aqui é só conteúdo)
    return pattern


plains = {
    "z32": b"\x00" * 32,
    "ff32": b"\xff" * 32,
    "alt_55_aa_96": (b"\x55\xaa" * 48),
    "tile_gradient_128": bytes((i % 16) * 17 for i in range(128)),
    "runs_160": b"\x00" * 64 + b"\xff" * 32 + b"\x0f" * 64,
    "nib_ramp_512": bytes(range(256)) + bytes(reversed(range(256))),
}
n = prng(0xBEEF)
plains["random_tile_like_1k"] = bytes(n() % 256 for _ in range(1024))
n = prng(0xC0FFEE)
block = bytes(n() % 256 for _ in range(1024))
plains["repeat_far_4k"] = block + b"\x00" * 2016 + block[:1024]
plains["planes_64k"] = bytes((i // 8) % 256 for i in range(65536))
# não-múltiplos de 32: domínio fora do formato — usados só nos NEGATIVOS
# do oráculo (padding silencioso), nunca como roundtrip positivo.
plains_neg = {
    "neg_tiny_6": b"ABCDEF",
    "neg_100": b"\x5a" * 100,
}

for name, data in plains.items():
    (OUT / "plain" / f"{name}.bin").write_bytes(data)
for name, data in plains_neg.items():
    (OUT / "plain" / f"{name}.bin").write_bytes(data)

print(f"plain={len(plains)} plain_neg={len(plains_neg)} em {OUT}")
