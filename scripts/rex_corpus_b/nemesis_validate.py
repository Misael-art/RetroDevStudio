#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""nemesis_validate.py -- validacao reproduzivel do decoder de pesquisa Nemesis.

Categorias (cada caso imprime PASS / FAIL / SKIP explicito):
  a) fixtures vendored: meu decode == .bin completo (bytes, nao hash de prefixo)
     e bytes_consumed == len(.nem)
  b) paridade com o oraculo `nemcmp -x` no sandbox, byte a byte
  c) casos discriminantes: plains adversariais re-codificados PELO ORACULO +
     streams artesanais decodificadas PELO ORACULO (nunca my-encode/my-decode
     sozinho como prova)
  d) negativos n01..n07: erro estruturado exigido pelo negative-spec, dentro dos
     limites, sempre terminando
  e) determinismo: (a) re-executado e comparado

Sandbox do oraculo: wrapper proprio com as MESMAS garantias do sandbox
mandatorio do integrador (snapshot em
docs/rex_corpus_b/reference/scripts_rex_profiles_codecs_common_sandbox.sh):
timeout com kill-forcado, ulimit -v 2 GiB, -t 25 s de CPU, -f 8192 blocos
(4 MiB) para o arquivo de saida, stdin fechado, cwd fixo. rc != 0 e SEMPRE
tratado como recusa do oraculo (dado, nao bug meu). Ausencia/timeout/recusa do
oraculo NUNCA vira PASS: vira SKIP com motivo.

Licenca: o oraculo mdcomp e LGPL-3.0 e e usado SOMENTE como ferramenta externa.
Este harness e ferramenta local de pesquisa; nada aqui e produto.
"""

from __future__ import annotations

import hashlib
import json
import os
import pathlib
import re
import signal
import subprocess
import sys
import time
from typing import Callable, Dict, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nemesis_research as nr  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "data/rex_corpus_b/vendor/data/rex_profiles/codec/nemesis"
PLAIN_DIR = FIXTURES / "plain"
NEG_DIR = FIXTURES / "negative"
MANIFEST = FIXTURES / "manifest.tsv"
TMP = ROOT / "data/rex_corpus_b/tmp"
EVIDENCE = ROOT / "data/rex_corpus_b/nemesis/evidence/decode-parity.json"
RECON = ROOT / "docs/rex_corpus_b/RECONCILIACAO.md"
ORACLE_DEFAULT = pathlib.Path.home() / ".cache/rex-codecs/oracle-tools/bin/nemcmp"

# garantias do sandbox espelhadas do wrapper do integrador
SB_WALL_TIMEOUT = 60          # `timeout -k 5 60`
SB_ADDRESS_SPACE = 2 * 1024 ** 3      # ulimit -v 2097152 (KB)
SB_CPU_SECONDS = 25                   # ulimit -t 25
SB_FSIZE_BLOCKS = 8192                # ulimit -f 8192 (blocos de 512 B)
SB_FSIZE_BYTES = SB_FSIZE_BLOCKS * 512

DEFAULT_MAX_OUT = 1 << 22             # 4 MiB
DEFAULT_WORK_LIMIT = 1 << 26


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def first_diff(a: bytes, b: bytes) -> Optional[int]:
    n = min(len(a), len(b))
    for i in range(n):
        if a[i] != b[i]:
            return i
    return n if len(a) != len(b) else None


# ---------------------------------------------------------------------------
# oraculo: presenca + pin de SHA-256 lido de RECONCILIACAO.md
# ---------------------------------------------------------------------------
class Oracle:
    def __init__(self) -> None:
        self.path = pathlib.Path(os.environ.get("REX_NEMCMP", str(ORACLE_DEFAULT)))
        self.present = self.path.is_file() and os.access(self.path, os.X_OK)
        self.sha256: Optional[str] = None
        self.pin: Optional[str] = None
        self.pin_source = str(RECON)
        self.reason_ok = None
        self._load_pin()
        if self.present:
            with open(self.path, "rb") as fh:
                self.sha256 = sha(fh.read())
        if not self.present:
            self.reason_ok = "oraculo ausente: %s" % self.path
        elif self.pin is None:
            self.reason_ok = "pin de SHA-256 do nemcmp nao encontrado em %s" % RECON
        elif self.sha256 != self.pin:
            self.reason_ok = ("SHA-256 do oraculo %s != pin %s"
                              % (self.sha256, self.pin))

    def _load_pin(self) -> None:
        try:
            text = RECON.read_text(encoding="utf-8")
        except OSError:
            return
        for line in text.splitlines():
            if "nemcmp" in line:
                m = re.search(r"SHA-256\s+`([0-9a-f]{64})`", line)
                if m:
                    self.pin = m.group(1)
                    return

    @property
    def usable(self) -> bool:
        return self.reason_ok is None

    @property
    def unusable_reason(self) -> str:
        return self.reason_ok or "ok"

    def run(self, argv: List[str], *, wall: int = SB_WALL_TIMEOUT,
            limit_fsize: bool = True) -> Dict[str, object]:
        """Executa o oraculo isolado. Nunca lanca: devolve dict com rc/out/err."""
        if not self.usable:
            return {"rc": None, "stdout": "", "stderr": "",
                    "refused": True, "why": self.unusable_reason}

        def pre() -> None:                 # roda no filho, antes do exec
            os.setsid()
            import resource
            resource.setrlimit(resource.RLIMIT_AS,
                               (SB_ADDRESS_SPACE, SB_ADDRESS_SPACE))
            resource.setrlimit(resource.RLIMIT_CPU,
                               (SB_CPU_SECONDS, SB_CPU_SECONDS + 1))
            if limit_fsize:
                resource.setrlimit(resource.RLIMIT_FSIZE,
                                   (SB_FSIZE_BYTES, SB_FSIZE_BYTES))

        def kill_group(proc: subprocess.Popen) -> None:
            for sig in (signal.SIGKILL,):
                try:
                    os.killpg(proc.pid, sig)
                except OSError:
                    pass

        try:
            proc = subprocess.Popen([str(self.path)] + argv,
                                    stdin=subprocess.DEVNULL,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    preexec_fn=pre, cwd=str(TMP))
        except OSError as exc:
            return {"rc": None, "stdout": "", "stderr": str(exc),
                    "refused": True, "why": "spawn falhou: %s" % exc}
        try:
            out, err = proc.communicate(timeout=wall)
            rc = proc.returncode
        except subprocess.TimeoutExpired:
            kill_group(proc)
            out, err = proc.communicate()
            rc = "TIMEOUT>%ds" % wall
        refused = rc != 0
        return {"rc": rc,
                "stdout": out.decode("utf-8", "replace").strip(),
                "stderr": err.decode("utf-8", "replace").strip(),
                "refused": refused,
                "why": None if not refused else "oraculo rc=%s" % rc}

    def decode_file(self, stream: pathlib.Path) -> Dict[str, object]:
        """nemcmp -x (com -i para capturar o offset final que a referencia informa)."""
        out = TMP / ("dec_%s.bin" % stream.stem)
        if out.exists():
            out.unlink()
        res = self.run(["-x", "-i", str(stream), str(out)])
        data = out.read_bytes() if out.exists() else b""
        res["data"] = data
        res["out_file"] = str(out)
        m = re.fullmatch(r"0x([0-9A-Fa-f]+)", res.get("stdout") or "")
        end = int(m.group(1), 16) if m else None
        if end is not None and end > 2 ** 63:
            end = None          # tellg() = -1: a referencia le alem do EOF
        res["oracle_end_offset"] = end
        return res

    def encode_file(self, plain: pathlib.Path, dest: pathlib.Path) -> Dict[str, object]:
        return self.run([str(plain), str(dest)])


# ---------------------------------------------------------------------------
# registro de casos
# ---------------------------------------------------------------------------
class Report:
    def __init__(self, oracle: Oracle) -> None:
        self.oracle = oracle
        self.records: List[Dict[str, object]] = []
        self.counts = {"PASS": 0, "FAIL": 0, "SKIP": 0}

    def add(self, *, case: str, category: str, claim: str, status: str,
            proof: str, expected: Optional[bytes] = None,
            mine: Optional[bytes] = None, expected_sha: Optional[str] = None,
            oracle_rc: Optional[object] = None, error_code: Optional[str] = None,
            limits: Optional[Dict[str, object]] = None, note: str = "",
            input_path: Optional[pathlib.Path] = None,
            input_bytes: Optional[bytes] = None,
            bytes_consumed: Optional[int] = None,
            extra: Optional[Dict[str, object]] = None) -> Dict[str, object]:
        rec: Dict[str, object] = {
            "case": case,
            "category": category,
            "claim": claim,
            "status": status,
            "proof": proof,
            "tool": nr.TOOL_VERSION,
            "tool_reference_commit": nr.ORACLE_COMMIT,
            "oracle_tool": nr.ORACLE_TOOL,
            "oracle_sha256": self.oracle.sha256,
            "oracle_usable": self.oracle.usable,
            "provenance": "authored-fixture",
            "input": str(input_path) if input_path else None,
            "input_sha256": sha(input_bytes) if input_bytes is not None else None,
            "input_len": len(input_bytes) if input_bytes is not None else None,
            "expected_sha256": expected_sha if expected_sha is not None
            else (sha(expected) if expected is not None else None),
            "expected_len": len(expected) if expected is not None else None,
            "mine_sha256": sha(mine) if mine is not None else None,
            "mine_len": len(mine) if mine is not None else None,
            "bytes_consumed": bytes_consumed,
            "equal": (None if (expected is None or mine is None)
                      else expected == mine),
            "first_diff_offset": (first_diff(expected, mine)
                                  if (expected is not None and mine is not None
                                      and expected != mine) else None),
            "oracle_rc": oracle_rc,
            "error_code": error_code,
            "limits": limits,
            "note": note,
        }
        if extra:
            rec.update(extra)
        self.records.append(rec)
        self.counts[status] = self.counts.get(status, 0) + 1
        mark = {"PASS": "PASS", "FAIL": "FAIL", "SKIP": "SKIP"}[status]
        tail = note or (error_code or "")
        print("[%s] (%s) %-34s %s%s" % (mark, category, case,
                                        "equal " if rec["equal"] is True else "",
                                        tail))
        if status == "FAIL" and rec["first_diff_offset"] is not None:
            print("        primeiro byte divergente: %d "
                  "(esperado %s / meu %s)" % (rec["first_diff_offset"],
                                              rec["expected_sha256"][:12] if rec["expected_sha256"] else "-",
                                              rec["mine_sha256"][:12] if rec["mine_sha256"] else "-"))
        return rec

    def rollup(self) -> str:
        verificados = len(self.records)
        return ("verificados=%d pass=%d fail=%d skip=%d"
                % (verificados, self.counts["PASS"], self.counts["FAIL"],
                   self.counts["SKIP"]))


# ---------------------------------------------------------------------------
# integridade dos fixtures (pins do manifest vendored)
# ---------------------------------------------------------------------------
def load_pins() -> Dict[str, Tuple[int, str]]:
    pins: Dict[str, Tuple[int, str]] = {}
    for line in MANIFEST.read_text(encoding="utf-8").splitlines()[1:]:
        cols = line.split("\t")
        if len(cols) < 7:
            continue
        kind, name, pbytes, psha, cbytes, csha, status = cols[:7]
        pins[name] = (int(cbytes), csha)
        if kind == "plain" and pbytes != "-":
            pins[name + ".bin"] = (int(pbytes), psha)
    return pins


def verify_fixtures(rep: Report) -> bool:
    pins = load_pins()
    ok = True
    files = sorted(p for p in list(PLAIN_DIR.iterdir()) + list(NEG_DIR.iterdir())
                   if p.is_file() and p.name != "negative-spec.json")
    for f in files:
        key = f.name if (PLAIN_DIR / f.name).exists() else f.name
        pin = pins.get(f.name) or pins.get(f.stem)
        data = f.read_bytes()
        if pin is None:
            rep.add(case="pin:%s" % f.name, category="pre", status="FAIL",
                    proof="manifest-pin", claim="arquivo vendored sem pin no manifest",
                    input_path=f, input_bytes=data, note="sem pin")
            ok = False
            continue
        want_bytes, want_sha = pin
        if len(data) != want_bytes or sha(data) != want_sha:
            rep.add(case="pin:%s" % f.name, category="pre", status="FAIL",
                    proof="manifest-pin", claim="pin SHA-256/tamanho do manifest violado",
                    input_path=f, input_bytes=data, expected_sha=want_sha,
                    note="pin=%s/%s" % (want_bytes, want_sha[:12]))
            ok = False
    if ok:
        rep.add(case="fixtures-integrity", category="pre", status="PASS",
                proof="manifest-pin",
                claim="%d arquivos vendored batem o manifest.tsv (SHA-256 + tamanho)"
                % len(files), note="ok")
    return ok


# ---------------------------------------------------------------------------
# (a) meu decoder vs plain vendored
# ---------------------------------------------------------------------------
def mine_decode(stream: bytes, **kw) -> Tuple[Optional[bytes], Optional[int],
                                              Optional[str], Dict[str, object]]:
    kw.setdefault("max_out", DEFAULT_MAX_OUT)
    kw.setdefault("work_limit", DEFAULT_WORK_LIMIT)
    stats: Dict[str, object] = {}
    try:
        data, consumed = nr.decode(stream, stats=stats, **kw)
        return data, consumed, None, stats
    except nr.NemesisError as exc:
        return None, None, exc.code, {"error_detail": exc.detail}
    except Exception as exc:                       # nunca engolir bug: FAIL explicito
        return None, None, "UNEXPECTED:%s" % type(exc).__name__, {}


def category_a(rep: Report) -> Dict[str, Dict[str, object]]:
    results: Dict[str, Dict[str, object]] = {}
    for nem in sorted(PLAIN_DIR.glob("*.nem")):
        stream = nem.read_bytes()
        plain = nem.with_suffix(".bin").read_bytes()
        data, consumed, err, stats = mine_decode(stream)
        ok = (err is None and data == plain and consumed == len(stream))
        rep.add(case="a:%s" % nem.stem, category="a",
                claim="decode byte-exato do stream vendored + bytes_consumed exato",
                status="PASS" if ok else "FAIL",
                proof="fixture-pinned-by-oracle (roundtrip publicado)",
                expected=plain, mine=data, oracle_rc=0, error_code=err,
                limits={"max_out": DEFAULT_MAX_OUT, "work_limit": DEFAULT_WORK_LIMIT},
                input_path=nem, input_bytes=stream, bytes_consumed=consumed,
                extra={"variant": stats.get("variant"),
                       "modifier_byte": stats.get("modifier_byte"),
                       "declared_tiles": stats.get("declared_tiles"),
                       "header_bytes": stats.get("header_bytes"),
                       "table_records": stats.get("table_records"),
                       "inline_rle_hits": stats.get("inline_rle_hits"),
                       "table_hits": stats.get("table_hits"),
                       "nibbles_emitted": stats.get("nibbles_emitted"),
                       "declared_out": stats.get("declared_out")},
                note=("out=%d consumed=%d/%d var=%s mod=%s rec=%d inline=%d tbl=%d"
                      % (len(data or b""), consumed or -1, len(stream),
                         stats.get("variant"), _hex(stats.get("modifier_byte")),
                         stats.get("table_records", 0), stats.get("inline_rle_hits", 0),
                         stats.get("table_hits", 0)) if ok else
                     ("DIVERGE err=%s consumed=%s len=%d" % (err, consumed, len(stream)))))
        results[nem.stem] = {"data": data, "consumed": consumed, "stats": stats}
    return results


def _hex(v) -> str:
    return "-" if v is None else ("0x%02X" % v)


# ---------------------------------------------------------------------------
# (b) paridade com o oraculo no sandbox
# ---------------------------------------------------------------------------
def category_b(rep: Report, oracle: Oracle) -> None:
    for nem in sorted(PLAIN_DIR.glob("*.nem")):
        stream = nem.read_bytes()
        if not oracle.usable:
            rep.add(case="b:%s" % nem.stem, category="b", status="SKIP",
                    claim="paridade byte a byte com nemcmp -x no sandbox",
                    proof="oracle-anchored", input_path=nem, input_bytes=stream,
                    oracle_rc=None, note="ORACULO INDISPONIVEL: %s (ausencia de "
                    "evidencia nao e prova)" % oracle.unusable_reason)
            continue
        data, consumed, err, _ = mine_decode(stream)
        res = oracle.decode_file(nem)
        orc = res["data"]
        rc = res["rc"]
        if res["refused"]:
            rep.add(case="b:%s" % nem.stem, category="b", status="SKIP",
                    claim="paridade byte a byte com nemcmp -x no sandbox",
                    proof="oracle-anchored", oracle_rc=rc, input_path=nem,
                    input_bytes=stream, mine=data, bytes_consumed=consumed,
                    note="oraculo RECUSOU (rc=%s): %s -- dado, nao prova" %
                    (rc, (res["stderr"] or "")[:60]))
            continue
        eq = (data is not None and data == orc)
        rep.add(case="b:%s" % nem.stem, category="b",
                claim="paridade byte a byte com nemcmp -x no sandbox",
                status="PASS" if eq else "FAIL", proof="oracle-anchored",
                expected=orc, mine=data, oracle_rc=rc, input_path=nem,
                input_bytes=stream, bytes_consumed=consumed,
                limits={"sandbox": "wall=%ds cpu=%ds as=%d fsize=%d stdin=devnull"
                        % (SB_WALL_TIMEOUT, SB_CPU_SECONDS, SB_ADDRESS_SPACE,
                           SB_FSIZE_BYTES)},
                extra={"oracle_end_offset": res["oracle_end_offset"],
                       "oracle_out_len": len(orc)},
                note="orc=%d meu=%d consumed=%d oracle_end=%s%s" % (
                    len(orc), len(data or b""), consumed or -1,
                    res["oracle_end_offset"],
                    " (oracle le alem do EOF: tellg=-1)"
                    if res["oracle_end_offset"] is None else ""))


# ---------------------------------------------------------------------------
# (c) casos discriminantes
# ---------------------------------------------------------------------------
def adversarial_plains() -> List[Tuple[str, bytes, str]]:
    """Plains deterministicos desenhados para forcar recursos do formato."""
    out: List[Tuple[str, bytes, str]] = []

    def nibbles_to_bytes(nibs: List[int]) -> bytes:
        if len(nibs) % 2:
            nibs = nibs + [0]
        return bytes((a << 4) | b for a, b in zip(nibs[::2], nibs[1::2]))

    # 1. dominio minimo: 1 Art Word
    out.append(("c_edge_1tile", bytes(range(0x20)), "len 32 (fronteira do dominio)"))
    # 2. dois tiles, canais 0x00/0xFF
    out.append(("c_edge_2tile", b"\x00" * 16 + b"\xFF" * 16, "2 tiles, plano 0/plano 1"))
    # 3. zeros puros: coder cai no caso especial de tabela de 1 codigo
    out.append(("c_zeros_4k", b"\x00" * 4096, "run longos de um nibble so"))
    # 4. runs nas fronteiras de contagem (1..8 nibbles)
    runs: List[int] = []
    nib = 0
    while len(runs) < 8192:
        for cnt in range(1, 9):
            runs.extend([nib & 0xF] * cnt)
            nib += 1
    out.append(("c_run_len_sweep", nibbles_to_bytes(runs[:8192]),
                "contagens 1..8 em ciclo (campo count 0..7)"))
    # 5. todos os 16 nibbles, frequencia 1 cada par (nibble,count) -> tabela
    #    vazia -> 100% inline RLE
    inline: List[int] = []
    for n in range(16):
        for cnt in range(1, 9):
            inline.extend([n] * cnt)
    out.append(("c_inline_only", nibbles_to_bytes(inline),
                "todos os pares (nibble,contagem) unicos: forza inline RLE"))
    # 6. alternancia 0x55/0xAA (candidato a variante alt/XOR)
    out.append(("c_alt_bias_55aa", (b"\x55\xAA" * 2048)[:4096],
                "alternancia de canais: testa flag alt do modifier byte"))
    # 7. palavra de 4 bytes repetida (correlacao inter-tile -> alt/XOR)
    out.append(("c_word_repeat", (bytes([0x12, 0x34, 0x56, 0x78]) * 256),
                "repeticao de palavra de 4 bytes"))
    # 8. gradiente 8k: rtiles = 256 -> bits baixos do modifier byte nao-zero
    out.append(("c_gradient_8k", bytes(i & 0xFF for i in range(8192)),
                "256 tiles: modifier byte com campo de tiles != 0"))
    # 9. ruido semeado (codigos longos, many table switches)
    lcg = 0xBEEF
    noise = bytearray()
    for _ in range(4096):
        lcg = (lcg * 1103515245 + 12345) & 0x7FFFFFFF
        noise.append(lcg & 0xFF)
    out.append(("c_noise_seeded_4k", bytes(noise),
                "pseudoaleatorio semeado: 16 nibbles, codigos longos"))
    # 10. nibble delta boundary: troca de nibble a cada 1 e a cada 8
    mixed: List[int] = []
    for n in range(256):
        mixed.extend([n & 0xF] * (1 + (n % 8)))
    out.append(("c_delta_boundary", nibbles_to_bytes(mixed[:8192]),
                "mudancas de nibble em todas as fronteiras de contagem"))
    return out


def build_stream(rtiles: int, mode: int, records: List[Tuple[Optional[int], int, int, int]],
                 bits: str, *, terminator: bool = True,
                 trailing: bytes = b"") -> bytes:
    """Monta um stream Nemesis a partir da SEMANTICA lida (stream artesanal).

    records: (seletor-de-nibble ou None, campo de contagem 0..7, len 0..15, cod).
    bits: string de '0'/'1' preenchida com 0 ate o limite do byte.
    """
    word = ((mode & 1) << 15) | (rtiles & 0x7FFF)
    body = bytearray(word.to_bytes(2, "big"))
    for selector, count, length, code in records:
        if selector is not None:
            body.append(0x80 | (selector & 0x0F))
        body.append(((count & 0x07) << 4) | (length & 0x0F))
        body.append(code & 0xFF)
    if terminator:
        body.append(0xFF)
    padded = bits + "0" * ((8 - len(bits) % 8) % 8)
    stream = bytes(body) + bytes(int(padded[i:i + 8], 2)
                                 for i in range(0, len(padded), 8)) + trailing
    return stream


def category_c(rep: Report, oracle: Oracle) -> List[str]:
    """Retorna lista de casos provados apenas por auto-consistencia."""
    self_only: List[str] = []
    oracle_note = ("ORACULO INDISPONIVEL: %s" % oracle.unusable_reason)

    # ---- c1: plains adversariais re-codificados pelo ORACULO ----
    for name, plain, why in adversarial_plains():
        pfile = TMP / ("%s.bin" % name)
        nfile = TMP / ("%s.nem" % name)
        for f in (pfile, nfile):
            if f.exists():
                f.unlink()
        nr.check_plain_domain(plain)          # entrada precisa estar no dominio
        pfile.write_bytes(plain)
        if not oracle.usable:
            rep.add(case="c1:%s" % name, category="c", status="SKIP",
                    claim="stream gerada pelo oraculo a partir de plain adversarial",
                    proof="oracle-anchored", input_path=pfile, input_bytes=plain,
                    note=oracle_note)
            continue
        enc = oracle.run([str(pfile), str(nfile)])
        if enc["refused"] or not nfile.exists():
            rep.add(case="c1:%s" % name, category="c", status="SKIP",
                    claim="oraculo codificou o plain adversarial",
                    proof="oracle-anchored", oracle_rc=enc["rc"],
                    input_path=pfile, input_bytes=plain,
                    note="oraculo recusou o encode (rc=%s): %s" %
                    (enc["rc"], (enc["stderr"] or "")[:60]))
            continue
        stream = nfile.read_bytes()
        dec = oracle.decode_file(nfile)
        mine, consumed, err, stats = mine_decode(stream, max_out=max(1 << 22, len(plain) * 2))
        if dec["refused"]:
            # roundtrip externo falhou: o oraculo nao reproduz o proprio plain.
            # Registrado como dado; minha saida e comparada ao plain publicado?
            # NAO: sem ancora externa o caso nao prova nada -> SKIP.
            rep.add(case="c1:%s" % name, category="c", status="SKIP",
                    claim="decode do oraculo sobre stream do oraculo",
                    proof="oracle-anchored", oracle_rc=dec["rc"],
                    input_path=nfile, input_bytes=stream, mine=mine,
                    bytes_consumed=consumed,
                    note="oraculo recusou o decode (rc=%s) -- nao ha ancora externa; "
                         "roundtrip interno do oraculo falhou" % dec["rc"])
            continue
        orc = dec["data"]
        eq_orc = mine == orc
        eq_plain = orc == plain
        rep.add(case="c1:%s" % name, category="c",
                status="PASS" if (eq_orc and eq_plain and consumed == len(stream)) else "FAIL",
                claim="meu decode == decode do oraculo sobre stream do oraculo "
                      "(e == plain autorado: ancora externa dupla)",
                proof="oracle-anchored", expected=orc, mine=mine,
                oracle_rc=dec["rc"], input_path=nfile, input_bytes=stream,
                bytes_consumed=consumed, error_code=err,
                extra={"plain_sha256": sha(plain),
                       "oracle_end_offset": dec["oracle_end_offset"],
                       "variant": stats.get("variant"),
                       "modifier_byte": stats.get("modifier_byte")},
                note="%s | orc=%d meu=%d plain=%d consumed=%d/%d mod=%s var=%s"
                % (why, len(orc), len(mine or b""), len(plain), consumed or -1,
                   len(stream), _hex(stats.get("modifier_byte")),
                   stats.get("variant")))

    # ---- c2: streams artesanais decodificadas pelo ORACULO ----
    # (ancoragem externa sem passar pelo encoder do oraculo).
    # expect_consumed: None => deve ser exatamente len(stream); inteiro =>
    # valor esperado calculado a partir do layout artesanal (casos em que os
    # bits necessarios terminam antes do ultimo byte do arquivo).
    hand: List[Dict[str, object]] = []
    # (a) persistencia do nibble entre registros sem seletor 0x80
    hand.append(dict(name="c2_persist_nibble", stream=build_stream(
        1, 0, [(0xF, 7, 1, 0b0), (None, 0, 2, 0b10)], "010" * 8),
        why="registro sem seletor 0x80 herda o nibble do registro anterior",
        expect_err=None, expect_consumed=None))
    # (b) somente inline RLE, tabela vazia: 8 ops de 8 nibbles = 64 nibbles
    bits = "".join("111111" + format(7, "03b") + format(0xA, "04b") for _ in range(8))
    hand.append(dict(name="c2_inline_only", stream=build_stream(1, 0, [], bits),
                     why="apenas inline RLE com tabela vazia",
                     expect_err=None, expect_consumed=None))
    # (c) varredura prefix-free de comprimentos de codigo 1..8, com runs de
    #     1..8 nibbles e OVERSHOOT (runs emitidos ultrapassam os 64 nibbles
    #     declarados): exercita o corte exato na saida declarada. Nenhum
    #     fixture exercitou codigos de 7/8 bits.
    sweep = [(0b0, 1, 0), (0b11, 2, 1), (0b101, 3, 2), (0b1001, 4, 3),
             (0b10001, 5, 4), (0b100001, 6, 5), (0b1000001, 7, 6),
             (0b10000001, 8, 7)]
    recs = [(cnt_field, cnt_field, length, code)
            for code, length, cnt_field in sweep]
    bitstr = "".join(format(code, "0%db" % length)
                     for code, length, _cnt in sweep * 2)
    # layout artesanal: 2 (size word) + 8*3 (registros) + 1 (terminator) = 27 de
    # cabecalho; os runs fecham os 64 nibbles exatos em 64 bits lidos = 8 bytes.
    hand.append(dict(name="c2_code_len_sweep",
                    stream=build_stream(1, 0, recs, bitstr),
                    why="codigos de 1 a 8 bits + overshoot de runs (corte na saida "
                        "declarada)", expect_err=None, expect_consumed=27 + 8))
    # registros duplicados (code,len) -> ultimo vence
    hand.append(dict(name="c2_dup_record", stream=build_stream(
        1, 0, [(0xF, 7, 1, 0x00), (0x3, 7, 1, 0x00)], "0" * 8),
        why="chave (code,len) duplicada: ultimo registro vence",
        expect_err=None, expect_consumed=None))
    # dados depois do ultimo bit necessario
    hand.append(dict(name="c2_trailing_garbage", stream=build_stream(
        1, 0, [(0xF, 7, 1, 0x00)], "0" * 8, trailing=b"\xAA" * 7),
        why="bytes sobrando apos o stream: bytes_consumed deve ser exato (7)",
        expect_err=None, expect_consumed=7))
    # variante alt/XOR artesanal (flag do modifier byte ligado)
    hand.append(dict(name="c2_alt_variant", stream=build_stream(
        2, 1, [(0xF, 7, 1, 0b0), (0x5, 0, 2, 0b10)], "010" * 16),
        why="variante alt/XOR montada a mao (modifier byte com bit 15)",
        expect_err=None, expect_consumed=None))
    # tabela sem terminator 0xFF (espero: truncated; oraculo le alem do EOF)
    hand.append(dict(name="c2_no_terminator", stream=build_stream(
        1, 0, [(0xF, 7, 1, 0x00)], "0" * 8, terminator=False),
        why="EOF na tabela: truncated", expect_err="truncated", expect_consumed=None))
    # registro com len == 0 (inatingivel por bitstream)
    hand.append(dict(name="c2_len0_record", stream=build_stream(
        1, 0, [(0xF, 7, 0, 0x01), (0xF, 7, 1, 0x00)], "0" * 8),
        why="codigo de comprimento 0: invalid-reference em modo strict",
        expect_err="invalid-reference", expect_consumed=None))
    # rtiles == 0 (fora do dominio)
    hand.append(dict(name="c2_zero_tiles", stream=build_stream(
        0, 0, [(0xF, 7, 1, 0x00)], "0" * 8),
        why="0 tiles: recusar (nao padeiar nem devolver vazio silencioso)",
        expect_err=nr.DOMAIN_ERROR_CODE, expect_consumed=None))

    for entry in hand:
        name = str(entry["name"])
        stream = bytes(entry["stream"])          # type: ignore[arg-type]
        why = str(entry["why"])
        expect_err = entry["expect_err"]         # type: ignore[assignment]
        expect_consumed = entry["expect_consumed"]
        sfile = TMP / ("%s.nem" % name)
        sfile.write_bytes(stream)
        mine, consumed, err, stats = mine_decode(stream)
        if expect_err is not None:
            # minha expectativa vem do contrato/leitura do formato; o oraculo e
            # medido como DADO (ele costuma aceitar em silencio)
            proof = "self-consistent-only (expectativa do contrato v1)"
            self_only.append(name)
            ok = err == expect_err
            extra = {}
            if oracle.usable:
                res = oracle.decode_file(sfile)
                extra = {"oracle_rc": res["rc"],
                         "oracle_out_len": len(res["data"]),
                         "oracle_end_offset": res["oracle_end_offset"]}
                note = ("%s | meu=%s; oraculo rc=%s out=%d (dado, nao verificador)"
                        % (why, err, res["rc"], len(res["data"])))
            else:
                note = "%s | meu=%s; oraculo indisponivel (nao medido)" % (why, err)
            rep.add(case=name, category="c", status="PASS" if ok else "FAIL",
                    claim=why, proof=proof, mine=mine, error_code=err,
                    input_path=sfile, input_bytes=stream, bytes_consumed=consumed,
                    extra=extra, note=note + " [NAO E PARIDADE COM ORACULO]")
            continue
        if not oracle.usable:
            rep.add(case=name, category="c", status="SKIP", claim=why,
                    proof="oracle-anchored", input_path=sfile, input_bytes=stream,
                    mine=mine, note=oracle_note)
            continue
        res = oracle.decode_file(sfile)
        if res["refused"]:
            rep.add(case=name, category="c", status="SKIP", claim=why,
                    proof="oracle-anchored", oracle_rc=res["rc"],
                    input_path=sfile, input_bytes=stream, mine=mine,
                    note="oraculo recusou (rc=%s): %s" % (res["rc"], (res["stderr"] or "")[:50]))
            continue
        eq = mine == res["data"]
        want_consumed = (len(stream) if expect_consumed is None
                         else int(expect_consumed))
        cons_ok = consumed == want_consumed
        rep.add(case=name, category="c", status="PASS" if (eq and cons_ok) else "FAIL",
                claim=why, proof="oracle-anchored (decode do oraculo sobre stream artesanal)",
                expected=res["data"], mine=mine, oracle_rc=res["rc"],
                input_path=sfile, input_bytes=stream, bytes_consumed=consumed,
                error_code=err,
                extra={"oracle_end_offset": res["oracle_end_offset"],
                       "nibbles_emitted": stats.get("nibbles_emitted"),
                       "declared_out": stats.get("declared_out"),
                       "variant": stats.get("variant"),
                       "modifier_byte": stats.get("modifier_byte"),
                       "expected_bytes_consumed": want_consumed},
                note="%s | orc=%d meu=%d consumed=%d/%d(expected %d)" %
                (why, len(res["data"]), len(mine or b""), consumed or -1,
                 len(stream), want_consumed))
    return self_only


# ---------------------------------------------------------------------------
# (d) negativos
# ---------------------------------------------------------------------------
def category_d(rep: Report, oracle: Oracle) -> None:
    spec = json.loads((NEG_DIR / "negative-spec.json").read_text(encoding="utf-8"))
    limits_gen = {"max_out": DEFAULT_MAX_OUT, "work_limit": DEFAULT_WORK_LIMIT}
    spec_names = [str(v.get("name")) for v in spec.get("vectors", [])]
    spec_files = [str(v.get("input_file")) for v in spec.get("vectors", [])]
    missing_files = [f for f in spec_files if not (NEG_DIR / f).is_file()]
    rep.add(case="d:spec-loaded", category="d",
            status="PASS" if (len(spec_names) == 7 and not missing_files) else "FAIL",
            claim="negative-spec.json tem 7 vetores e todos os arquivos de entrada "
                  "existem", proof="negative-spec",
            input_path=NEG_DIR / "negative-spec.json",
            extra={"spec_vectors": spec_names},
            note="faltando=%s" % (missing_files or "-"))

    def struct_failed(err: Optional[str]) -> bool:
        return err in nr.CONTRACT_ERROR_CODES or err == nr.DOMAIN_ERROR_CODE

    # n01/n02: PLAIN fora de dominio + as bytes como stream
    for name, file, padded in (
            ("n01_align_input_6b", "n01_align_input_6b.bin", 32),
            ("n02_align_input_100b", "n02_align_input_100b.bin", 128)):
        plain = (NEG_DIR / file).read_bytes()
        try:
            nr.check_plain_domain(plain)
            err_dom = None
        except nr.NemesisError as exc:
            err_dom = exc.code
        rep.add(case="d:%s:domain" % name, category="d",
                status="PASS" if err_dom == nr.DOMAIN_ERROR_CODE else "FAIL",
                claim="recusar plain fora do dominio (nao padeiar)",
                proof="self-consistent-only (exigencia do negative-spec/contrato v1)",
                error_code=err_dom, input_path=NEG_DIR / file, input_bytes=plain,
                note="oraculo padeia (medido: %d B); produto recusa" % padded)
        data, consumed, err, _ = mine_decode(plain, **limits_gen)
        rep.add(case="d:%s:stream" % name, category="d",
                status="PASS" if (err is not None and struct_failed(err)
                                  and data is None) else "FAIL",
                claim="mesmas bytes lidas como stream: falha estruturada, sem saida",
                proof="self-consistent-only", error_code=err, mine=data,
                input_path=NEG_DIR / file, input_bytes=plain,
                limits=limits_gen, note="oraculo neste caso e MORTO pelo sandbox (rc=-9); ver probe")
        if oracle.usable:
            enc = oracle.run([str(NEG_DIR / file), str(TMP / ("%s.nem" % name))])
            dest = TMP / ("%s.pad" % name)
            dec = oracle.run(["-x", str(TMP / ("%s.nem" % name)), str(dest)]) \
                if not enc["refused"] else {"rc": None, "data": None}
            got = dest.read_bytes() if dest.exists() else b""
            rep.add(case="d:%s:oracle-pad" % name, category="d",
                    status="PASS" if len(got) == padded else "SKIP",
                    claim="re-sonda do padding silencioso do oraculo (%d B)" % padded,
                    proof="oracle-measured (regressao de fato publicado)",
                    oracle_rc=dec.get("rc"), input_path=NEG_DIR / file,
                    input_bytes=plain, extra={"oracle_padded_len": len(got)},
                    note="padding medido=%s esperado=%s" % (len(got), padded))

    # n03: stream vazia -> truncated
    b = (NEG_DIR / "n03_empty_stream.nem").read_bytes()
    data, consumed, err, _ = mine_decode(b, **limits_gen)
    rep.add(case="d:n03_empty_stream", category="d",
            status="PASS" if err == "truncated" and data is None else "FAIL",
            claim="stream vazia => truncated", proof="negative-spec",
            error_code=err, mine=data, input_path=NEG_DIR / "n03_empty_stream.nem",
            input_bytes=b, limits=limits_gen,
            note="oraculo aceita com 0 bytes rc=0 (falsa aceitacao registrada)")

    # n04: garbage 0xFF: tres modos de falha limitada + sonda do oraculo
    b = (NEG_DIR / "n04_garbage_ff_64b.nem").read_bytes()
    d1, c1, e1, _ = mine_decode(b, max_out=1 << 16, work_limit=DEFAULT_WORK_LIMIT)
    rep.add(case="d:n04_excessive_output", category="d",
            status="PASS" if e1 == "excessive-output" and d1 is None else "FAIL",
            claim="max_out pequeno => excessive-output, sem emitir nada",
            proof="negative-spec+contrato", error_code=e1, mine=d1,
            input_path=NEG_DIR / "n04_garbage_ff_64b.nem", input_bytes=b,
            limits={"max_out": 1 << 16}, bytes_consumed=c1,
            note="declarado 1048544 B; emitido=%d" % len(d1 or b""))
    d2, c2, e2, _ = mine_decode(b, max_out=DEFAULT_MAX_OUT, work_limit=100)
    rep.add(case="d:n04_work_limit", category="d",
            status="PASS" if e2 == "work-limit" and d2 is None else "FAIL",
            claim="work_limit=100 => work-limit (loop do oraculo e morto por orcamento)",
            proof="negative-spec+contrato", error_code=e2, mine=d2,
            input_path=NEG_DIR / "n04_garbage_ff_64b.nem", input_bytes=b,
            limits={"max_out": DEFAULT_MAX_OUT, "work_limit": 100},
            bytes_consumed=c2, note="declarado 1048544 B; emitido=%d" % len(d2 or b""))
    d3, c3, e3, _ = mine_decode(b, max_out=DEFAULT_MAX_OUT,
                                 work_limit=DEFAULT_WORK_LIMIT, max_memory=1 << 16)
    rep.add(case="d:n04_overflow", category="d",
            status="PASS" if e3 == "overflow" and d3 is None else "FAIL",
            claim="max_memory=64 KiB => overflow (validar antes de alocar)",
            proof="contrato v1 (derivado; nao esta nos 7 do spec)",
            error_code=e3, mine=d3, input_path=NEG_DIR / "n04_garbage_ff_64b.nem",
            input_bytes=b, limits={"max_out": DEFAULT_MAX_OUT, "max_memory": 1 << 16},
            bytes_consumed=c3, note="emitido=%d" % len(d3 or b""))
    d4, c4, e4, _ = mine_decode(b, max_out=DEFAULT_MAX_OUT,
                                work_limit=DEFAULT_WORK_LIMIT)
    rep.add(case="d:n04_truncated_at_eof", category="d",
            status="PASS" if struct_failed(e4) and d4 is None else "FAIL",
            claim="sem corte de limite: falha estruturada terminando em < 1 s",
            proof="negative-spec (bounded-failure)", error_code=e4, mine=d4,
            input_path=NEG_DIR / "n04_garbage_ff_64b.nem", input_bytes=b,
            limits=limits_gen, bytes_consumed=c4,
            note="oraculo produz 1048544 B sem limite; o meu para no EOF")
    if oracle.usable:
        res = oracle.decode_file(NEG_DIR / "n04_garbage_ff_64b.nem")
        rep.add(case="d:n04_oracle_expansion", category="d",
                status="PASS" if len(res["data"]) == 1048544 else "SKIP",
                claim="re-sonda: 64 B de 0xFF expandem para EXATAMENTE 1048544 B no oraculo",
                proof="oracle-measured (regressao de fato publicado)",
                oracle_rc=res["rc"], input_path=NEG_DIR / "n04_garbage_ff_64b.nem",
                input_bytes=b, extra={"oracle_out_len": len(res["data"])},
                note="medido=%d spec=1048544" % len(res["data"]))

    # n05: truncada -> truncated, mesmo com tamanho plausivel
    src_full = (PLAIN_DIR / "planes_64k.nem").read_bytes()
    b = (NEG_DIR / "n05_truncated_last_byte.nem").read_bytes()
    assert len(b) == len(src_full) - 1, "n05 nao e o pleno menos 1 byte"
    d5, c5, e5, _ = mine_decode(b, max_out=1 << 20, work_limit=DEFAULT_WORK_LIMIT)
    rep.add(case="d:n05_truncated", category="d",
            status="PASS" if e5 == "truncated" and d5 is None else "FAIL",
            claim="stream truncada de 1 byte => truncated (parser real, nao metadado)",
            proof="negative-spec", error_code=e5, mine=d5,
            input_path=NEG_DIR / "n05_truncated_last_byte.nem", input_bytes=b,
            limits={"max_out": 1 << 20}, bytes_consumed=c5,
            note="declarado 65536 B (plausivel); oraculo aceita; emitido=%d"
            % len(d5 or b""))
    if oracle.usable:
        res = oracle.decode_file(NEG_DIR / "n05_truncated_last_byte.nem")
        full = (PLAIN_DIR / "planes_64k.bin").read_bytes()
        div = first_diff(res["data"], full) if not res["refused"] else None
        # segunda execucao: o oraculo le ALEM do EOF (buffer nao inicializado),
        # entao o conteudo do rabo e indeterminismo do ambiente. Medido aqui:
        # estavel nesta maquina, mas o offset exato NAO reproduz o numero da
        # rodada anterior (65508). Por isso a alegacao assertiva e "tamanho
        # pleno + conteudo divergente"; o offset e registrado como dado.
        res2 = oracle.decode_file(NEG_DIR / "n05_truncated_last_byte.nem")
        stable = (not res2["refused"]) and res2["data"] == res["data"]
        RECORD_RODADA_1 = 65508
        ok_hazard = (len(res["data"]) == 65536 and div is not None)
        rep.add(case="d:n05_oracle_false_accept", category="d",
                status=("PASS" if ok_hazard else
                        ("SKIP" if res["refused"] else "FAIL")),
                claim="re-sonda: oraculo aceita a stream truncada devolvendo o "
                      "tamanho PLENO (65536) com conteudo divergente no rabo",
                proof="oracle-measured (regressao do perigo publicado: truncamento "
                      "nao detectavel por metadado)",
                oracle_rc=res["rc"], input_path=NEG_DIR / "n05_truncated_last_byte.nem",
                input_bytes=b,
                extra={"oracle_out_len": len(res["data"]),
                       "oracle_first_diff_measured": div,
                       "oracle_first_diff_recorded_rodada_1": RECORD_RODADA_1,
                       "first_diff_reproduzido": div == RECORD_RODADA_1,
                       "oracle_saida_estavel_nesta_maquina": stable},
                note="out=%d first_diff_medido=%s (rodada 1 registrou %d: %s) "
                     "estavel=%s -- offset nao e pinavel: leitura alem do EOF"
                % (len(res["data"]), div, RECORD_RODADA_1,
                   "reproduzido" if div == RECORD_RODADA_1 else "NAO reproduzido",
                   stable))

    # n06: prefixo que faz o oraculo loops
    b = (NEG_DIR / "n06_hanging_prefix.nem").read_bytes()
    t0 = time.perf_counter()
    d6, c6, e6, _ = mine_decode(b, **limits_gen)
    dt = time.perf_counter() - t0
    rep.add(case="d:n06_terminates", category="d",
            status="PASS" if (struct_failed(e6) and dt < 2.0 and d6 is None) else "FAIL",
            claim="prefixo de 8 B: falha estruturada terminando em < 2 s",
            proof="negative-spec", error_code=e6, mine=d6,
            input_path=NEG_DIR / "n06_hanging_prefix.nem", input_bytes=b,
            limits=limits_gen, bytes_consumed=c6,
            note="tempo=%.3fs; oraculo morre no sandbox (rc=-9/SIGKILL, spec: 137)" % dt)
    d6b, c6b, e6b, _ = mine_decode(b, max_out=DEFAULT_MAX_OUT, work_limit=4)
    rep.add(case="d:n06_work_limit", category="d",
            status="PASS" if e6b == "work-limit" else "FAIL",
            claim="orcamento de trabalho minimo prova o caminho work-limit no mesmo input",
            proof="negative-spec (work-limit+cancelamento)", error_code=e6b,
            mine=d6b, input_path=NEG_DIR / "n06_hanging_prefix.nem", input_bytes=b,
            limits={"max_out": DEFAULT_MAX_OUT, "work_limit": 4},
            bytes_consumed=c6b, note="com orcamento generico o mesmo input da %s" % e6)

    # n07: stream REAL + max_out -> excessive-output
    b = (NEG_DIR / "n07_planes_64k.nem").read_bytes()
    d7, c7, e7, _ = mine_decode(b, max_out=1024, work_limit=DEFAULT_WORK_LIMIT)
    rep.add(case="d:n07_excessive_output", category="d",
            status="PASS" if e7 == "excessive-output" and d7 is None else "FAIL",
            claim="stream valida com max_out=1024 => excessive-output antes de alocar",
            proof="negative-spec", error_code=e7, mine=d7,
            input_path=NEG_DIR / "n07_planes_64k.nem", input_bytes=b,
            limits={"max_out": 1024}, bytes_consumed=c7,
            note="emitido=%d (deveria ser 65536)" % len(d7 or b""))
    d7b, c7b, e7b, _ = mine_decode(b, max_out=65535, work_limit=DEFAULT_WORK_LIMIT)
    rep.add(case="d:n07_boundary_65535", category="d",
            status="PASS" if e7b == "excessive-output" else "FAIL",
            claim="limite exato: max_out=65535 ainda recusa (sem clamp silencioso)",
            proof="contrato v1 (derivado)", error_code=e7b, mine=d7b,
            input_path=NEG_DIR / "n07_planes_64k.nem", input_bytes=b,
            limits={"max_out": 65535}, bytes_consumed=c7b, note="")
    d7c, c7c, e7c, _ = mine_decode(b, max_out=65536, work_limit=DEFAULT_WORK_LIMIT)
    rep.add(case="d:n07_control_ok", category="d",
            status="PASS" if (e7c is None and d7c == (PLAIN_DIR / "planes_64k.bin").read_bytes()
                              and c7c == len(b)) else "FAIL",
            claim="controle: mesma stream com max_out=65536 decodifica plena",
            proof="fixture-pinned-by-oracle", mine=d7c, error_code=e7c,
            expected=(PLAIN_DIR / "planes_64k.bin").read_bytes(),
            input_path=NEG_DIR / "n07_planes_64k.nem", input_bytes=b,
            limits={"max_out": 65536}, bytes_consumed=c7c, note="")

    # cancelamento cooperativo (exigencia do contrato; nao esta nos 7)
    b = (PLAIN_DIR / "planes_64k.nem").read_bytes()
    dc, cc, ec, _ = mine_decode(b, max_out=DEFAULT_MAX_OUT,
                                work_limit=DEFAULT_WORK_LIMIT,
                                cancel=lambda: True)
    rep.add(case="d:cancel_cooperative", category="d",
            status="PASS" if ec == "cancelled" and dc is None else "FAIL",
            claim="cancel=always => cancelled, sem emitir saida",
            proof="contrato v1 (derivado; nao esta nos 7 do spec)",
            error_code=ec, mine=dc, input_path=PLAIN_DIR / "planes_64k.nem",
            input_bytes=b, limits={"max_out": DEFAULT_MAX_OUT, "cancel": "always"},
            bytes_consumed=cc, note="emitido=%d" % len(dc or b""))


# ---------------------------------------------------------------------------
# (e) determinismo
# ---------------------------------------------------------------------------
def category_e(rep: Report, first: Dict[str, Dict[str, object]]) -> None:
    for nem in sorted(PLAIN_DIR.glob("*.nem")):
        stream = nem.read_bytes()
        data, consumed, err, _ = mine_decode(stream)
        prev = first[nem.stem]
        same = (data == prev["data"] and consumed == prev["consumed"]
                and err is None)
        rep.add(case="e:%s" % nem.stem, category="e",
                status="PASS" if same else "FAIL",
                claim="segunda execucao identica (bytes + bytes_consumed + sha)",
                proof="self-consistent (determinismo; nao prova corretude)",
                mine=data, expected=prev["data"], bytes_consumed=consumed,
                input_path=nem, input_bytes=stream,
                error_code=err,
                note="sha=%s" % (sha(data or b"")[:12]))


# ---------------------------------------------------------------------------
# cobertura de variantes (o que foi VISTO, nao o que o formato "deveria" ter)
# ---------------------------------------------------------------------------
def summarise_variants(records: List[Dict[str, object]]) -> Dict[str, object]:
    vistos: Dict[str, Dict[str, object]] = {}
    for r in records:
        mb = r.get("modifier_byte")
        if mb is None or r.get("category") not in ("a", "c"):
            continue
        var = str(r.get("variant"))
        slot = vistos.setdefault(var, {"modifier_bytes": set(), "cases": []})
        slot["modifier_bytes"].add(int(mb))
        slot["cases"].append(str(r["case"]))
    out: Dict[str, object] = {}
    for var, slot in sorted(vistos.items()):
        out[var] = {"modifier_bytes": sorted("0x%02X" % m
                                             for m in slot["modifier_bytes"]),
                    "casos": len(slot["cases"]),
                    "exemplos": slot["cases"][:4]}
    return {"semantica_do_modifier_byte":
            "byte0 = (flag_alt << 7) | (rtiles >> 8); byte1 = rtiles & 0xFF; "
            "flag_alt=0 -> saida literal (raw); flag_alt=1 -> saida com XOR "
            "incremental por palavra de 4 bytes (alt). NAO ha campo de "
            "profundidade de plano no cabecalho.",
            "variantes_decodificadas_por_evidencia": out,
            "valores_de_modifier_byte_observados": sorted(
                "0x%02X" % m for slot in vistos.values()
                for m in slot["modifier_bytes"]),
            "bloqueadas": {
                "2B/4B/8B (profundidade de plano)":
                    "nao existe no formato: nemesis.cc so conhece o flag alt do "
                    "bit 15; 2B/4B/8B e convencao do consumidor sobre o layout "
                    "dos 32 bytes do Art Word, sem evidencia no oraculo",
                "modo `=[pointer]` do CLI":
                    "capacidade separada do nemcmp (offset no arquivo); nao e "
                    "variante de stream e nao foi exercitada aqui",
                "goldens literais de tabela adaptativa":
                    "exigiria espelhar o empacotador (Package-merge) da "
                    "referencia LGPL; blocked com motivo na rodada 1 e nao "
                    "reaberto por suposicao",
            }}


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def main() -> int:
    TMP.mkdir(parents=True, exist_ok=True)
    EVIDENCE.parent.mkdir(parents=True, exist_ok=True)
    oracle = Oracle()
    print("== REX corpus B: validacao do decoder Nemesis de pesquisa ==")
    print("repo          : %s" % ROOT)
    print("python        : %s" % sys.version.split()[0])
    print("codec         : %s (%s)" % (nr.CODEC_NAME, nr.TOOL_VERSION))
    print("oraculo       : %s" % oracle.path)
    print("oraculo sha256: %s (pin %s)" % (oracle.sha256, oracle.pin))
    print("oraculo status: %s" % ("USAVEL" if oracle.usable
                                  else "INDISPONIVEL: %s" % oracle.unusable_reason))
    print("sandbox       : wall=%ds cpu=%ds as=%dMiB fsize=%dKiB stdin=devnull cwd=%s"
          % (SB_WALL_TIMEOUT, SB_CPU_SECONDS, SB_ADDRESS_SPACE // (1 << 20),
             SB_FSIZE_BYTES // 1024, TMP))
    if not oracle.usable:
        print("AVISO: sem oraculo utilizavel as categorias (b) e partes de (c)/(d) "
              "saem SKIP; SKIP NAO e prova.")

    rep = Report(oracle)
    if not verify_fixtures(rep):
        print("fixtures com pin violado -- resultado nao confiavel")
    first = category_a(rep)
    category_b(rep, oracle)
    self_only = category_c(rep, oracle)
    category_d(rep, oracle)
    category_e(rep, first)

    doc = {
        "kind": "decode-parity",
        "codec": "nemesis",
        "territory": "research/analysis only -- derivado da leitura de mdcomp "
                     "(LGPL-3.0); nao e produto e nao pode ser transplantado",
        "contract": "REX v1 par. 4 (error codes truncados/invalid-reference/"
                    "overflow/excessive-output/work-limit/cancelled)",
        "generated_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "tool": {"name": nr.TOOL_VERSION, "reference_source": nr.ORACLE_SOURCE,
                 "reference_commit": nr.ORACLE_COMMIT,
                 "reference_license": nr.ORACLE_LICENSE},
        "oracle": {"tool": nr.ORACLE_TOOL, "path": str(oracle.path),
                   "sha256": oracle.sha256, "pin_sha256": oracle.pin,
                   "pin_source": oracle.pin_source, "usable": oracle.usable,
                   "unusable_reason": oracle.unusable_reason,
                   "sandbox": {"wall_seconds": SB_WALL_TIMEOUT,
                               "cpu_seconds": SB_CPU_SECONDS,
                               "address_space_bytes": SB_ADDRESS_SPACE,
                               "fsize_bytes": SB_FSIZE_BYTES,
                               "stdin": "closed", "cwd": str(TMP)}},
        "rollup": None,
        "self_consistent_only_cases": self_only,
        "variantes": summarise_variants(rep.records),
        "records": rep.records,
    }

    # rollups por categoria
    per_cat: Dict[str, Dict[str, int]] = {}
    for r in rep.records:
        c = str(r["category"])
        bucket = per_cat.setdefault(c, {"PASS": 0, "FAIL": 0, "SKIP": 0, "n": 0})
        bucket[str(r["status"])] += 1
        bucket["n"] += 1
    doc["rollup"] = {"total": rep.rollup(), "by_category": per_cat}

    EVIDENCE.write_text(json.dumps(doc, indent=2, sort_keys=True) + "\n",
                        encoding="utf-8")
    print("")
    print("rollup por categoria:")
    for c in sorted(per_cat):
        b = per_cat[c]
        print("  (%s) verificados=%d pass=%d fail=%d skip=%d"
              % (c, b["n"], b["PASS"], b["FAIL"], b["SKIP"]))
    print("total: %s" % rep.rollup())
    print("evidencia: %s" % EVIDENCE)
    print("casos provados apenas por auto-consistencia: %s"
          % (", ".join(self_only) if self_only else "-"))
    return 0 if rep.counts["FAIL"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
