#!/usr/bin/env python3
"""Audita os candidatos de TileSet aPLib que o scanner do produto aceita numa ROM.

Existe porque o E2E do fixture autoral reprovou depois que `verify_resource_set`
passou a verificar os dois codecs: o painel anunciou **2** recursos numa ROM cujo
fonte planta **1** (LZ4W). Antes de mexer em asserção ou em verificação foi
preciso medir o candidato novo — "recurso real ou falso positivo do scanner" não
se decide por opinião.

O que ele reproduz:

* os mesmos candidatos do `parse_tileset_header` do produto (compression ∈
  {0,1,2}, `1 <= numTile <= 2048`, ponteiro par e dentro da ROM) sobre passo de 2
  bytes;
* o decoder aPLib raw com **um teto a mais**: para assim que a saída passa do
  tamanho declarado. Isso não approxima o veredito do produto — a saída de um
  decode aPLib só cresce, então quem já passou de `numTile * 32` nunca vai parar
  exatamente em `numTile * 32`.

Para a reimplementação não virar opinião, o script abre com um **controle**: ele
decodifica os 9 goldens pinados (`data/rex_profiles/integrator/aplib/vectors/`) e
exige plain byte a byte igual ao `.expected.bin` e `bytes_consumed` igual ao
tamanho do stream (com o discriminante `g08` = 6, não 11). Só depois, e só se o
controle fechar, ele audita a ROM.

Uso (ROM BYOR nunca vai para o git; a identidade é exigida, não presumida):
    python3 scripts/rex_profiles/integrator/aplib/audit_aplib_candidates.py \
        src-tauri/target-test/validation/rex-lz4w-fixture/project/out/rom.bin \
        --pin-sha256 159298eb1c9a437a6abc83c80becfe38c52d469d6284aeab4dc9dc06e9b2b9b5
    python3 scripts/rex_profiles/integrator/aplib/audit_aplib_candidates.py \
        "$RDS_HAMOOPIG_ROM" \
        --pin-sha256 558bea6c80c76ec3da23afd584d4b56ece7722847ab1efc8c2f23f43f8529be9
"""
import argparse
import collections
import hashlib
import sys
from pathlib import Path

MIN_MATCH3_OFFSET = 1280
MIN_MATCH4_OFFSET = 32000
MAX_TILES = 2048
BYTES_PER_TILE = 32
VETORES = Path(__file__).resolve().parents[4] / "data/rex_profiles/integrator/aplib/vectors"


class Recusa(Exception):
    def __init__(self, motivo: str):
        super().__init__(motivo)
        self.motivo = motivo


def ajusta(offset: int) -> int:
    """Ajuste de comprimento por faixa de offset, igual ao decoder do produto."""
    if not (128 <= offset < MIN_MATCH4_OFFSET):
        return 2
    return 1 if offset >= MIN_MATCH3_OFFSET else 0


def decodifica_ate(stream: bytes, limite: int):
    """`(plain, bytes_consumidos)` ou `Recusa`. Espelho do decoder do produto.

    O `limite` é o teto de saída: quem o ultrapassa já está recusado de fato,
    porque o veredito exige `len(plain) == declarado` e a saída é monotônica.
    """
    if not stream:
        raise Recusa("stream vazio")
    out = bytearray([stream[0]])
    pos, tag, slot = 1, 0, 8
    last_offset, lwm = 0, 3

    def byte_() -> int:
        nonlocal pos
        if pos >= len(stream):
            raise Recusa("truncado: EOF com token em curso")
        v = stream[pos]
        pos += 1
        return v

    def bit_() -> int:
        nonlocal tag, slot
        if slot == 8:
            tag = byte_()
            slot = 0
        v = (tag >> (7 - slot)) & 1
        slot += 1
        return v

    def gamma2() -> int:
        v = 1
        while True:
            v = (v << 1) | bit_()
            if bit_() == 0:
                return v

    def copia(offset: int, length: int) -> None:
        if offset == 0 or offset > len(out):
            raise Recusa(f"invalid_reference off={offset} len={length}")
        if len(out) + length > limite:
            raise Recusa(f"exceeded_declared (>{limite} B)")
        base = len(out) - offset
        for i in range(length):
            out.append(out[base + i])

    while True:
        if bit_() == 0:
            out.append(byte_())
            if len(out) > limite:
                raise Recusa(f"exceeded_declared (>{limite} B)")
            lwm = 3
            continue
        if bit_() == 0:
            acumulado = gamma2()
            if acumulado < lwm:
                if last_offset == 0:
                    raise Recusa("invalid_reference: rep-match sem offset histórico")
                copia(last_offset, gamma2())
            else:
                offset = ((acumulado - lwm) << 8) | byte_()
                copia(offset, gamma2() + ajusta(offset))
                last_offset = offset
            lwm = 2
            continue
        if bit_() == 0:
            cmd = byte_()
            if cmd == 0:
                return bytes(out), pos
            copia(cmd >> 1, 2 + (cmd & 1))
            last_offset = cmd >> 1
            lwm = 2
            continue
        curto = 0
        for _ in range(4):
            curto = (curto << 1) | bit_()
        if curto == 0:
            out.append(0)
            if len(out) > limite:
                raise Recusa(f"exceeded_declared (>{limite} B)")
        else:
            copia(curto, 1)
        lwm = 3  # `111` não toca em last_offset


def controle_goldens() -> list:
    """Exige que este espelho bata com os 9 goldens pinados antes de auditar ROM."""
    linhas = [l.split("\t") for l in (VETORES / "manifest.tsv").read_text().splitlines()[1:]
              if l.startswith("golden")]
    falhas = []
    for _, nome, plain_len, plain_sha, stream_len, _stream_sha, *_ in linhas:
        ap = (VETORES / "golden" / f"{nome}.ap").read_bytes()
        esperado = (VETORES / "golden" / f"{nome}.expected.bin").read_bytes()
        if nome == "g08_eod_trailing":
            declarado = 6  # EOD + 5 de lixo: bytes depois do EOD são do bloco vizinho
        else:
            declarado = len(ap)
        try:
            plain, consumidos = decodifica_ate(ap, max(len(esperado), int(plain_len)))
        except Recusa as exc:
            falhas.append(f"{nome}: recusado ({exc.motivo})")
            continue
        if plain != esperado:
            falhas.append(f"{nome}: plain divergente do .expected.bin")
        if hashlib.sha256(plain).hexdigest() != plain_sha:
            falhas.append(f"{nome}: sha do plain divergente do manifest")
        if consumidos != declarado:
            falhas.append(f"{nome}: bytes_consumed {consumidos} != {declarado}")
    return falhas


def cabeçalhos(rom: bytes):
    for header in range(0, len(rom) - 8, 2):
        compression = int.from_bytes(rom[header:header + 2], "big")
        if compression not in (0, 1, 2):
            continue
        num_tiles = int.from_bytes(rom[header + 2:header + 4], "big")
        ptr = int.from_bytes(rom[header + 4:header + 8], "big")
        if num_tiles == 0 or num_tiles > MAX_TILES:
            continue
        if ptr == 0 or ptr >= len(rom) or ptr % 2:
            continue
        yield {"header": header, "compression": compression, "num_tiles": num_tiles,
               "stream": ptr, "declarado": num_tiles * BYTES_PER_TILE}


def referências(rom: bytes, alvo: int, máximo: int = 4):
    """Onde um u32 big-endian word-aligned aponta para `alvo` na ROM.

    Em SGDK 2.11 um TileSet só é consumido se algum struct o alcança (TiledImage
    `{palette*|tileset*|tilemap*}`, tabela de recursos do driver, Sprite). Um
    header que ninguém aponta é estrutura órfã: pode decodificar por coincidência
    e não é recurso do jogo.
    """
    agulha = alvo.to_bytes(4, "big")
    achados = []
    for pos in range(0, len(rom) - 3, 2):
        if rom[pos:pos + 4] == agulha:
            achados.append(pos)
            if len(achados) >= máximo:
                break
    return achados


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("rom")
    ap.add_argument("--pin-sha256", required=True)
    ap.add_argument("--mostrar", type=int, default=40)
    ap.add_argument("--consultar-header", action="append", default=[],
                    help="endereço (0x..) de header adicional a ter as referências contadas")
    args = ap.parse_args()

    falhas = controle_goldens()
    if falhas:
        print("FALHA no controle dos goldens (o espelho deste script divergiu):", file=sys.stderr)
        for f in falhas:
            print(f"  - {f}", file=sys.stderr)
        return 1
    print("controle: 9/9 goldens batem com o espelho do decoder do produto")

    rom = Path(args.rom).read_bytes()
    sha = hashlib.sha256(rom).hexdigest()
    if sha != args.pin_sha256:
        print(f"FALHA: identidade divergente em {args.rom}: {sha}", file=sys.stderr)
        return 1
    print(f"ROM {args.rom}  {len(rom)} B  sha256 {sha}")

    nomes = {0: "NONE", 1: "APLIB", 2: "LZ4W"}
    contagem = collections.Counter()
    recusados = collections.Counter()
    verificados = []
    for cand in cabeçalhos(rom):
        contagem[cand["compression"]] += 1
        if cand["compression"] != 1:
            continue
        stream = rom[cand["stream"]:]
        try:
            plain, consumidos = decodifica_ate(stream, cand["declarado"])
        except Recusa as exc:
            recusados[exc.motivo.split(" (")[0]] += 1
            continue
        verificados.append({**cand, "plain": plain, "consumidos": consumidos})

    print(f"candidatos por codec: " +
          ", ".join(f"{nomes[k]}={contagem[k]}" for k in sorted(contagem)))
    print(f"candidatos aPLib verificados (decode == declarado): {len(verificados)}")
    for motivo, n in recusados.most_common(8):
        print(f"  recusa {motivo}: {n}")
    for v in verificados[:args.mostrar]:
        refs = referências(rom, v["header"])
        print(f"\n- header 0x{v['header']:x}  stream 0x{v['stream']:x}  "
              f"numTile {v['num_tiles']}  declarado {v['declarado']} B  "
              f"consumidos {v['consumidos']} B  termina em "
              f"0x{v['stream'] + v['consumidos']:x}  "
              f"header apontado por {len(refs)} u32")
        print(f"  censo do plain: zeros={v['plain'].count(0)}/{len(v['plain'])}  "
              f"distinct={len(set(v['plain']))}  "
              f"entropia={_entropia(v['plain']):.2f} bits/byte")
        print(f"  plain sha256 {hashlib.sha256(v['plain']).hexdigest()}")
        print(f"  primeiros 32 B: {v['plain'][:32].hex(' ')}")

    for item in args.consultar_header:
        alvo = int(item, 0)
        refs = referências(rom, alvo)
        compression = int.from_bytes(rom[alvo:alvo + 2], "big") if alvo + 2 <= len(rom) else -1
        num_tiles = int.from_bytes(rom[alvo + 2:alvo + 4], "big") if alvo + 4 <= len(rom) else -1
        ponteiro = int.from_bytes(rom[alvo + 4:alvo + 8], "big") if alvo + 8 <= len(rom) else -1
        print(f"\nheader consultado 0x{alvo:x}: compression={compression} numTile={num_tiles} "
              f"ponteiro=0x{ponteiro:x} — apontado por {len(refs)} u32 "
              f"{'(ex.: ' + ', '.join(f'0x{p:x}' for p in referências(rom, alvo, 6)) + ')' if refs else ''}")
    return 0


def _entropia(dados: bytes) -> float:
    cont = collections.Counter(dados)
    total = len(dados) or 1
    return -sum((n / total) * __import__("math").log2(n / total) for n in cont.values())


if __name__ == "__main__":
    raise SystemExit(main())
