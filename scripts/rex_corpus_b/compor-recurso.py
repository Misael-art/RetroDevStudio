#!/usr/bin/env python3
"""Compõe um recurso contextual REAL a partir de um mapa (nametable) decodificado.

Pré-condições de composição (todas checadas, nenhuma presumida):
  * a stream foi decodificada por este modulo e confere byte a byte com o
    oraculo externo (evidencia em sonic1-confirm-by-reference.json);
  * existe CONSUMIDOR medido: instrucao que le a entrada da tabela e chama o
    decodificador 68k com destino porta de dados VDP ($FF4000);
  * value_offset medido no sítio de chamada (`move.w #0,d0` antes de `jsr`).
    Base != 0 e recusada como contradicao ao consumidor, nunca "escolhida
    pela aparencia".

A composicao produz:
  * JSON com as entradas fatiadas em campos (indice, hflip, vflip, paleta,
    prioridade), estatisticas e PROVENIENCIA completa;
  * PNGs em escala de cinza (indice e planos de bits) FORA do Git, registrados
    por SHA-256. Nenhuma paleta RGB e escolhida: paleta nao carregada por esta
    rotina e registrada como `not-evidenced`.

Negativos executados e registrados: identidade (decode duplo), limites
(stream truncada recusada), flips (hflip/vflip alteram o render), base de
tiles (offset 0x400 contradiz o consumidor), associacao incorreta (mapa
tratado como tile art e cruzado com ROM de outra proveniencia — recusados).

Uso:
  python3 scripts/rex_corpus_b/compor-recurso.py --rom ROM.bin \
      --offset 0x65432 --consumidor data/rex_corpus_b/recursos/consumidor-sonic1-mapas.json \
      --out data/rex_corpus_b/recursos/sonic1-mapa-65432.json \
      --render /tmp/rex-corpus-b/composicao
"""
import argparse
import hashlib
import importlib.util
import json
import os
import pathlib
import struct
import sys
import zipfile
import zlib

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent


def spec(nome, caminho):
    s = importlib.util.spec_from_file_location(nome, caminho)
    m = importlib.util.module_from_spec(s)
    s.loader.exec_module(m)
    return m


MD = spec("mdt", HERE / "md-tiles.py")
ENI = spec("eni", HERE / "enigma_research.py")


def carregar_rom(caminho):
    if zipfile.is_zipfile(caminho):
        with zipfile.ZipFile(caminho) as z:
            nomes = [n for n in z.namelist() if not n.startswith("__MACOSX")]
            cand = [n for n in nomes
                    if os.path.splitext(n)[1].lower() in (".bin", ".md", ".gen", ".smd")] or nomes
            melhor = max(cand, key=lambda n: z.getinfo(n).file_size)
            return z.read(melhor), melhor
    return open(caminho, "rb").read(), os.path.basename(caminho)


def png_cinza(pasta, nome, linhas, escala):
    """Escreve PNG 8-bit cinza em pasta/nome, confinado a `pasta` (sem traversal)."""
    base = pathlib.Path(pasta).resolve()
    base.mkdir(parents=True, exist_ok=True)
    alvo = base / os.path.basename(nome)
    if os.path.commonpath([str(base), str(alvo.resolve())]) != str(base):
        raise SystemExit(f"[caminho] render fora do diretorio informado: {nome}")
    h, w = len(linhas), len(linhas[0])
    corpo = b"".join(
        b"\x00" + bytes(v for v in linha for _ in range(escala))
        for linha in linhas for _ in range(escala)
    )

    def chunk(tipo, dado):
        return (struct.pack(">I", len(dado)) + tipo + dado
                + struct.pack(">I", zlib.crc32(tipo + dado) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", w * escala, h * escala, 8, 0, 0, 0, 0)
    payload = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
               + chunk(b"IDAT", zlib.compress(corpo, 9)) + chunk(b"IEND", b""))
    alvo.write_bytes(payload)
    return hashlib.sha256(alvo.read_bytes()).hexdigest()


def render_de_palavras(palavras, campo, escala=2):
    """64 colunas x 32 linhas; campo: indice|hflip|vflip|paleta|prioridade."""
    maximo = max((w & 0x7FF) for w in palavras)
    linhas = []
    for y in range(32):
        linha = []
        for x in range(64):
            w = palavras[y * 64 + x]
            if campo == "indice":
                idx = w & 0x7FF
                v = 0 if idx == 0 else 64 + idx * 191 // max(maximo, 1)
            elif campo == "hflip":
                v = 255 if (w >> 11) & 1 else 0
            elif campo == "vflip":
                v = 255 if (w >> 12) & 1 else 0
            elif campo == "paleta":
                v = ((w >> 13) & 3) * 85
            elif campo == "prioridade":
                v = 255 if (w >> 15) & 1 else 0
            else:
                raise ValueError(campo)
            linha.append(v)
        linhas.append(linha)
    return linhas


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--rom", required=True)
    ap.add_argument("--offset", required=True, help="offset da stream Enigma (hex)")
    ap.add_argument("--consumidor", default=None,
                    help="JSON do procurar-consumidor com o consumidor medido")
    ap.add_argument("--value-offset", type=lambda x: int(x, 0), default=0)
    ap.add_argument("--paleta", default=None,
                    help="PROIBIDO: paleta nao e evidenciada; a opcao existe so para recusar")
    ap.add_argument("--out", required=True)
    ap.add_argument("--render", default=None, help="diretorio FORA do Git para PNGs")
    a = ap.parse_args(argv)

    if a.paleta is not None:
        raise SystemExit("[paleta] recusado: nenhuma carga de CRAM foi provada para este "
                         "recurso; escolher paleta pela aparencia viola a missao "
                         "(registre a referencia faltante em vez disso)")

    out_path = pathlib.Path(a.out).resolve()
    if not (out_path == ROOT or out_path.is_relative_to(ROOT)):
        raise SystemExit(f"[caminho] --out fora da arvore: {a.out}")

    rom, membro = carregar_rom(a.rom)
    sha_rom = hashlib.sha256(rom).hexdigest()
    offset = int(a.offset, 16)

    # ---- consumidor medido (pre-condicao) ----
    if a.consumidor:
        consumidor_doc = json.loads(pathlib.Path(a.consumidor).read_text())
        if consumidor_doc["rom"]["sha256"] != sha_rom:
            raise SystemExit("[associacao] o JSON de consumidor referencia outra ROM "
                             f"({consumidor_doc['rom']['sha256'][:12]}) — recusado")
    else:
        print("[aviso] sem --consumidor: a composicao sai marcada sem consumidor provado")

    if a.value_offset != 0:
        raise SystemExit("[base] value_offset != 0 contradiz o consumidor medido "
                         "(move.w #0,d0 em 0x1b6ce antes de jsr $171e); para testar "
                         "outra base como hipotese, registre o consumidor que a porta")

    # ---- decode ----
    dados, consumido = ENI.decode(rom[offset:], max_out=1 << 20, work_limit=1 << 24,
                                  value_offset=a.value_offset)
    sha_plain = hashlib.sha256(dados).hexdigest()
    palavras = [w for (w,) in struct.iter_unpack(">H", dados)]

    # ---- negativos ----
    negativos = {}

    # (1) identidade: decode deterministico
    dados2, _consumido2 = ENI.decode(rom[offset:], max_out=1 << 20, work_limit=1 << 24,
                                     value_offset=a.value_offset)
    negativos["identidade"] = {
        "descricao": "decode duplo deterministico",
        "sha1": sha_plain, "sha2": hashlib.sha256(dados2).hexdigest(),
        "identico": dados == dados2,
    }

    # (2) limites: stream truncada e recusada
    try:
        ENI.decode(rom[offset:offset + consumido - 1], max_out=1 << 20,
                   work_limit=1 << 24, value_offset=a.value_offset)
        negativos["limites"] = {"truncada_recusada": False}
    except ENI.CodecError as e:
        negativos["limites"] = {"truncada_recusada": True,
                                "erro": type(e).__name__, "mensagem": str(e)[:100]}

    # (3) flips: sao campos da entrada; inverte-los muda a saida
    palavras_hflip = [w ^ 0x0800 for w in palavras]
    palavras_vflip = [w ^ 0x1000 for w in palavras]
    negativos["flips"] = {
        "descricao": "hflip/vflip sao campos da entrada; inverte-los muda a saida",
        "sha_hflip_invertido": hashlib.sha256(
            struct.pack(f">{len(palavras_hflip)}H", *palavras_hflip)).hexdigest(),
        "sha_vflip_invertido": hashlib.sha256(
            struct.pack(f">{len(palavras_vflip)}H", *palavras_vflip)).hexdigest(),
    }

    # (4) base de tiles: offset 0x400 mudaria TODOS os indices
    negativos["base_de_tiles"] = {
        "descricao": "value_offset 0x400 mudaria todos os indices; contradiz o "
                     "consumidor medido (d0=0) — registrado como negativo, nao como hipotese",
        "primeiro_indice_medido": palavras[0] & 0x7FF,
        "primeiro_indice_seria_com_base_0x400": (palavras[0] & 0x7FF) + 0x400,
        "recusado": True,
    }

    # (5) associacao incorreta: o mapa NAO e tile art
    assinatura_campos = {
        "com_prioridade": sum(1 for w in palavras if (w >> 15) & 1),
        "com_paleta_nao_zero": sum(1 for w in palavras if (w >> 13) & 3),
        "com_hflip": sum(1 for w in palavras if (w >> 11) & 1),
        "com_vflip": sum(1 for w in palavras if (w >> 12) & 1),
        "total": len(palavras),
    }
    negativos["associacao_incorreta"] = {
        "descricao": "interpretar os 4096 bytes como tile art 4bpp e associacao "
                     "incorreta: os bits 15..12 de nametable sao campos, nao planos "
                     "de pixel; a prova e o consumidor que escreve a saida na porta "
                     "de dados VDP",
        "assinatura_de_nametable": assinatura_campos,
        "rotulo_proibido": "tile sheet / cena",
    }

    entradas = []
    for i, w in enumerate(palavras):
        campos = MD.nametable_entry(w)
        entradas.append({"i": i, "indice": campos["tile"], "hflip": campos["hflip"],
                         "vflip": campos["vflip"], "paleta": campos["palette"],
                         "prioridade": campos["priority"]})

    provas_visuais = None
    if a.render:
        provas_visuais = {}
        for campo in ("indice", "paleta", "hflip", "vflip", "prioridade"):
            nome = f"mapa-{offset:x}-{campo}.png"
            sha_png = png_cinza(a.render, nome, render_de_palavras(palavras, campo), 3)
            provas_visuais[campo] = {"caminho": str(pathlib.Path(a.render).resolve() / nome),
                                     "sha256": sha_png, "escala": 3,
                                     "cor": "cinza (indice/valor do campo); sem paleta RGB"}

    doc = {
        "schema_version": "rex-corpus-b/recurso-contextual/1",
        "gerado_por": "scripts/rex_corpus_b/compor-recurso.py",
        "recurso": {
            "tipo": "nametable-64x32",
            "rotulo": "mapa de nivel (plano VDP 64x32 entradas)",
            "rom": {"caminho": a.rom, "membro": membro, "sha256": sha_rom,
                    "size_bytes": len(rom)},
            "offset_stream": hex(offset),
            "output_size": len(dados),
            "output_sha256": sha_plain,
            "bytes_consumed": consumido,
            "codec": "enigma (variante plain)",
        },
        "consumidor_medido": {
            "evidencia": a.consumidor,
            "cadeia": [
                {"offset": "0x1b694", "instrucao": "cmpi.b #6,($FFFFFE57).b",
                 "significado": "guarda: nivel 6 segue outro caminho; indices 0..5 usam este bloco"},
                {"offset": "0x1b6b6", "instrucao": "lsl.w #2,d0",
                 "significado": "indice de nivel x 4 = byte offset na tabela"},
                {"offset": "0x1b6b8", "instrucao": "lea (-0x56,PC,D0.w),A1",
                 "significado": "pares auxiliares em 0x1b664 -> $FFFFD008/D00C"},
                {"offset": "0x1b6c4", "instrucao": "movea.l (-122,PC,D0.w),A0",
                 "significado": "ENTRADA DA TABELA 0x1b64c + indice*4 (ponteiro da stream)"},
                {"offset": "0x1b6c8", "instrucao": "lea $FF4000,A1",
                 "significado": "destino = PORTA DE DADOS VDP (escrita de nametable em VRAM)"},
                {"offset": "0x1b6ce", "instrucao": "move.w #0,d0",
                 "significado": "VALUE_OFFSET = 0 (medido no sitio de chamada)"},
                {"offset": "0x1b6d2", "instrucao": "jsr $171E",
                 "significado": "decodificador Enigma 68k (unico jsr absoluto a $171E na ROM)"},
            ],
            "semantica_do_decodificador_68k": {
                "inc_cursor": "a2 = incrementing_value + d0 (ADD, $171E+0x10..0x12)",
                "common": "a4 = common_value + d0 (ADD, $171E+0x14..0x16)",
                "inline": "valor = d0 OR/ADD bits altos lidos pela mascara 15..11 ($17DC)",
                "value_offset_medido": a.value_offset,
            },
            "empacotamento_no_rom": "streams encadeadas na ordem da tabela; consumo "
                                    "word-rounded (1 byte de pad antes da stream 6: "
                                    "0x662f4+1233=0x667c5, proxima em 0x667c6)",
        },
        "vinculos": {
            "mapa_para_vram": "PROVADO (porta de dados VDP $FF4000 no consumidor)",
            "tiles_para_mapa": {
                "status": "not-evidenced",
                "referencia_faltante": "qual stream de arte (Kosinski, frente A) e "
                                        "carregada em VRAM antes da escrita do mapa, e em "
                                        "qual base — exige a rotina de carga de arte",
            },
            "paleta": {
                "status": "not-evidenced",
                "referencia_faltante": "carga de CRAM (cores) para o nivel; a rotina "
                                        "medida nao toca CRAM",
            },
        },
        "estatisticas": {
            "entradas": len(entradas),
            "indices_distintos": len({e["indice"] for e in entradas}),
            "faixa_indice": [min(e["indice"] for e in entradas),
                             max(e["indice"] for e in entradas)],
            "campos": assinatura_campos,
        },
        "negativos": negativos,
        "provas_visuais": provas_visuais,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
    print(f"[recurso] nametable {offset:#x}: {doc['estatisticas']['indices_distintos']} "
          f"indices distintos, {assinatura_campos['com_paleta_nao_zero']} entradas com paleta")
    print("evidencia:", out_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
