#!/usr/bin/env python3
"""Gera plains determinísticos p/ o perfil Enigma (fase 2 roundtrip-only).

Enigma (mdcomp src/lib/enigma.cc) opera sobre ARRAYS DE int16 BE: modos
inline (cópia crua) e codificados (delta acumulativa + extensão de sinal +
códigos de comprimento variável, threshold de zeros, deslocamento de leitura).
O oráculo não declara domínio de tamanho; as fixtures cobrem as frentes que
exercitam os modos: zeros puros (threshold), constantes (delta 0), rampas
(deltas pequenos), ruído 16-bit (modo inline do encoder), bordas de sinal
(±0x7FFF/±0x8000) e arrays ímpares (último valor sob metade do word).

Goldens artesanais (stream .enbl literal montada à mão) ficam BLOQUEADOS
nesta fase com motivo: exigiriam espelhar bit-a-bit o empacotador de
códigos variáveis de enigma.cc ANTES de ter um decoder do produto contra
quem cruzar; a prova publicada é o roundtrip exato pelo oráculo, que fixa o
resultado do decode do produto para cada fixture. Ver manifest.json.
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


def be16(vals):
    out = bytearray()
    for v in vals:
        v &= 0xFFFF
        out.append(v >> 8)
        out.append(v & 0xFF)
    return bytes(out)


n = prng(0xE01A)
plains = {
    "empty": b"",
    "single_word": be16([0x1234]),
    "zeros_64": be16([0] * 64),
    "const_500": be16([500] * 200),
    "ramp_signed": be16(list(range(-100, 100))),
    "big_deltas": be16([0, 0x7FFF, -0x8000, 0x1234, -0x1234, 1] * 8),
    "noise_1k": be16([n() & 0xFFFF for _ in range(512)]),
    "alternating_runs": be16(([7] * 100 + [-9] * 100) * 3),
    "threshold_edge": be16([0] * 15 + [1] + [0] * 16),  # em volta do limiar
    "planes_4k": be16([(i * 37) % 65536 for i in range(2048)]),
}
# NEGATIVO de domínio (medido 2026-09-25): comprimento ímpar — o oráculo
# codifica mas o decode DEVOLVE UM BYTE A MENOS (5->4): a cauda órfã é
# descartada silenciosamente. Nunca publicado como roundtrip positivo.
plains_neg = {
    "odd_bytes_tail": be16([0x0100, 0x0200]) + b"\xAB",  # 5 bytes
}

for name, data in plains.items():
    (OUT / "plain" / f"{name}.bin").write_bytes(data)
for name, data in plains_neg.items():
    (OUT / "plain" / f"{name}.bin").write_bytes(data)

print(f"plain={len(plains)} plain_neg={len(plains_neg)} em {OUT}")
