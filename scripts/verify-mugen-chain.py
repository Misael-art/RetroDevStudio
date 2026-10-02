#!/usr/bin/env python3
"""Independent reference for the original-chain pilot (`mugen.original_chain.v1`).

This is NOT the generator that produced the ROM: it reads the package's CMD/CNS/AIR itself
(own regex parser, own three-valued trigger evaluator, own tick loop written from the
documented CNS evaluation order) and re-simulates the chain from the pad stream that the
ROM itself sampled. It then compares, tick by tick, state/time/ctrl/animation/velocity.
Python is a QA prerequisite only, never an app dependency; nothing is written to Git.

Documented order of evaluation (Elecbyte cns.html, "state evaluation"):
  * once per tick: special states -3, -2, -1 (in this order), top to bottom, then the
    player's current state; a state change aborts the rest of the state being processed and
    processing continues from the beginning of the new state in the same tick;
  * Time starts at 0 at the start of a state and grows by one per tick;
  * triggerall first (any false => controller skipped), then trigger1, trigger2, ...
    (same number: AND; different numbers: OR);
  * AnimTime = animation time - action looptime (<= 0), 0 at the end of the action.
Limits (reported, never hidden): command buffer.time default and plain-button press edge are
not stated by the primary cmd.html reachable at registration time; state 0 lives in the
absent common1.cns so it is a declared stand-in; HitDef/PlaySnd/poweradd effects are
recorded as OPAQUE, not simulated.
"""
import argparse
import hashlib
import importlib.util
import json
import re
import sys
from pathlib import Path

MD = {"UP": 0x1, "DOWN": 0x2, "LEFT": 0x4, "RIGHT": 0x8, "B": 0x10, "C": 0x20, "A": 0x40, "START": 0x80}
# authored binding (input configuration, declared in the report): MUGEN x -> Mega Drive A
BINDING = {"x": MD["A"], "y": MD["B"], "z": MD["C"], "s": MD["START"]}
DIRBITS = {"U": MD["UP"], "D": MD["DOWN"], "B": MD["LEFT"], "F": MD["RIGHT"]}  # facing right


class Opaque(Exception):
    """A value the reference deliberately does not model."""


def sha(data):
    return hashlib.sha256(data).hexdigest()


# ---------------------------------------------------------------------------- parsing

def sections(path):
    out, cur = [], None
    for no, raw in enumerate(Path(path).read_text(encoding="latin1").splitlines(), 1):
        body = raw.split(";", 1)[0].strip()
        if not body:
            continue
        m = re.match(r"^\[(.*?)\]", body)
        if m:
            cur = {"header": m.group(1).strip(), "line": no, "params": [], "file": Path(path).name}
            out.append(cur)
        elif cur is not None and "=" in body:
            k, v = body.split("=", 1)
            cur["params"].append((k.strip().lower(), v.strip(), no))
    return out


def get(sec, key, default=None):
    return next((v for k, v, _ in sec["params"] if k == key), default)


def parse_air(path):
    acts, cur = {}, None
    for raw in Path(path).read_text(encoding="latin1").splitlines():
        body = raw.split(";", 1)[0].strip()
        m = re.fullmatch(r"\[\s*Begin\s+Action\s+(-?\d+)\s*\]", body, re.I)
        if m:
            cur = acts.setdefault(int(m.group(1)), [])
        elif cur is not None and re.match(r"^-?\d+\s*,", body):
            p = [x.strip() for x in body.split(",")]
            cur.append({"group": int(p[0]), "image": int(p[1]), "ticks": int(p[4])})
    return acts


def parse_commands(path):
    cmds = {}
    for s in sections(path):
        if s["header"].lower() == "command":
            name = get(s, "name", "").strip('"')
            cmds[name] = {"spec": get(s, "command", ""), "time": get(s, "time"), "line": s["line"]}
    return cmds


def parse_states(paths):
    states, special = {}, {-3: [], -2: [], -1: []}
    for path in paths:
        cur = None
        for s in sections(path):
            h = s["header"].lower()
            if h.startswith("statedef"):
                no = int(h.split()[1])
                cur = no
                if no >= 0:
                    states.setdefault(no, []).append({"def": s, "controllers": []})
            elif h.startswith("state ") and cur is not None:
                if cur < 0:
                    special[cur].append(s)
                else:
                    states[cur][-1]["controllers"].append(s)
    return states, special


# ---------------------------------------------------------------------------- commands

KEYS = {"x", "y", "z", "a", "b", "c", "s"}


def command_tokens(spec):
    return [e.strip() for e in spec.split(",")]


def satisfiable(spec, alphabet_buttons, alphabet_dirs):
    """Can this command ever be completed with only the buttons/directions the stream used?"""
    for element in command_tokens(spec):
        for key in element.replace(">", "").split("+"):
            key = key.strip().lstrip("~/$")
            key = re.sub(r"^\d+", "", key)
            if key in KEYS:
                if key not in alphabet_buttons:
                    return False
            elif key in ("U", "D", "B", "F"):
                if key not in alphabet_dirs:
                    return False
            else:  # UB DB UF DF or unknown: needs a combination the stream never produced
                return False
    return True


def evaluate_command(name, cmd, pad, prev, alphabet_buttons, alphabet_dirs):
    spec = cmd["spec"].replace(" ", "")
    if not satisfiable(cmd["spec"], alphabet_buttons, alphabet_dirs):
        return False
    elements = command_tokens(cmd["spec"])
    if len(elements) != 1 or "+" in spec or ">" in spec or cmd["time"] != "1":
        raise Opaque(f"command {name!r} is satisfiable by the stream but outside the reference ({cmd['spec']})")
    hold, release = spec.startswith("/"), spec.startswith("~")
    key = spec.lstrip("/~")
    anyd = key.startswith("$")
    key = key.lstrip("$")
    pressed, released = pad & ~prev, ~pad & prev
    if key in KEYS:
        bit = BINDING[key]
        return bool(pad & bit) if hold else bool(released & bit) if release else bool(pressed & bit)
    bit = DIRBITS[key]
    if not hold:
        raise Opaque(f"direction press {spec!r}")
    if anyd:
        return bool(pad & bit)
    return (pad & 0xF) == bit


# ---------------------------------------------------------------------------- expressions

TOKEN = re.compile(r'\s*(?:(\d+\.?\d*)|("[^"]*")|(!=|<=|>=|&&|\|\||[=<>!()+\-*/,\[\]])|([A-Za-z_][A-Za-z_0-9.]*))')


def tokenize(text):
    pos, out = 0, []
    while pos < len(text):
        m = TOKEN.match(text, pos)
        if not m or m.end() == pos:
            if text[pos:].strip() == "":
                break
            raise Opaque(f"cannot tokenize {text!r}")
        pos = m.end()
        num, string, op, ident = m.groups()
        out.append(("num", float(num)) if num else ("str", string[1:-1]) if string else ("op", op) if op else ("id", ident.lower()))
    return out


class Env:
    def __init__(self, st, commands_active):
        self.st = st
        self.cmds = commands_active

    def var(self, name, tokens, i):
        s = self.st
        if name == "stateno":
            return s["stateno"], i
        if name == "time":
            return s["time"], i
        if name == "ctrl":
            return int(s["ctrl"]), i
        if name == "anim":
            return s["anim"], i
        if name == "animtime":
            return s["animtime"], i
        if name == "statetype":
            return s["statetype"], i
        if name == "command":
            return ("command",), i
        if name == "pos" and i < len(tokens) and tokens[i] == ("id", "y"):
            return 0, i + 1  # no controller in the reference ever moves y
        raise Opaque(name)


def eval_expr(text, env):
    """Parse `lhs op rhs` with Kleene logic: Opaque propagates only if not decided."""
    tokens = tokenize(text)
    if tokens == [("num", 1.0)]:
        return True
    pos = [0]

    def peek():
        return tokens[pos[0]] if pos[0] < len(tokens) else None

    def atom():
        t = peek()
        if t is None:
            raise Opaque("unexpected end")
        pos[0] += 1
        if t[0] == "num":
            return t[1]
        if t[0] == "str":
            return t[1]
        if t[0] == "id":
            if t[1] in ("s", "c", "a", "l"):
                return t[1].upper()
            v, j = env.var(t[1], tokens, pos[0])
            pos[0] = j
            return v
        raise Opaque(f"token {t}")

    left = atom()
    op = peek()
    if op is None:
        raise Opaque(f"bare expression {text!r}")
    if op[0] != "op" or op[1] not in ("=", "!=", "<", ">", "<=", ">="):
        raise Opaque(f"operator {op}")
    pos[0] += 1
    right = atom()
    if pos[0] != len(tokens):
        raise Opaque(f"compound expression {text!r}")
    if isinstance(left, tuple) and left == ("command",):
        result = env.cmds(right)
        return result if op[1] == "=" else (not result) if op[1] == "!=" else (_ for _ in ()).throw(Opaque("command op"))
    if isinstance(left, str) or isinstance(right, str):
        eq = str(left).upper() == str(right).upper()
        return eq if op[1] == "=" else (not eq)
    return {"=": left == right, "!=": left != right, "<": left < right, ">": left > right,
            "<=": left <= right, ">=": left >= right}[op[1]]


def controller_fires(sec, env):
    """Kleene three-valued evaluation. Returns True/False or raises Opaque if undecidable."""
    params = sec["params"]
    all_terms = [v for k, v, _ in params if k == "triggerall"]
    groups = {}
    for k, v, _ in params:
        m = re.fullmatch(r"trigger(\d+)", k)
        if m:
            groups.setdefault(int(m.group(1)), []).append(v)

    def conj(terms):
        unknown, seen_false = None, False
        for t in terms:
            try:
                if not eval_expr(t, env):
                    seen_false = True
                    break
            except Opaque as e:
                unknown = unknown or e
        if seen_false:
            return False
        if unknown:
            raise unknown
        return True

    if all_terms and conj(all_terms) is False:
        return False
    unknown = None
    for n in sorted(groups):
        try:
            if conj(groups[n]):
                return True
        except Opaque as e:
            unknown = unknown or e
    if unknown:
        raise unknown
    return False


# ---------------------------------------------------------------------------- simulation

class Reference:
    def __init__(self, root, chain_state=200, stand_in_anim=0):
        root = Path(root)
        self.root = root
        self.commands = parse_commands(root / "ken.cmd")
        self.states, self.special = parse_states([root / "ken.cmd", root / "ken.cns"])
        for no, defs in self.states.items():
            if no == chain_state and len(defs) != 1:
                raise SystemExit(f"state {no} defined {len(defs)} times")
        self.air = parse_air(root / "ken.air")
        self.chain_state = chain_state
        self.stand_in_anim = stand_in_anim
        self.hashes = {n: sha((root / n).read_bytes()) for n in ("ken8.def", "ken.cmd", "ken.cns", "ken.air", "ken1.act")}

    def looptime(self, action):
        ticks = [e["ticks"] for e in self.air[action]]
        return None if any(t < 0 for t in ticks) else sum(ticks)

    def animtime(self, action, animtick):
        total = self.looptime(action)
        if total is None:
            return 0
        if action == 0:  # looping idle: AnimTime stays <= 0 (documented), never 0 mid-loop
            return (animtick % total) - total
        return animtick - total

    def enter(self, s, no):
        s["stateno"], s["time"] = no, 0
        if no == self.chain_state:
            d = self.states[no][0]["def"]
            params = {k: v for k, v, _ in d["params"]}
            s["statetype"] = params["type"].upper()
            s["ctrl"] = bool(int(params["ctrl"]))
            vx, _, vy = (params["velset"].partition(","))
            s["vx"], s["vy"] = float(vx), float(vy or 0)
            s["anim"], s["animtick"] = int(params["anim"]), 0
            s["effects"].append(("poweradd", int(params["poweradd"]), "opaque"))
        elif no == 0:  # declared stand-in: common1.cns is absent
            s["statetype"], s["ctrl"], s["anim"], s["animtick"] = "S", True, self.stand_in_anim, 0
        else:
            raise Opaque(f"state {no} outside the chain")

    def run(self, pads):
        alphabet_buttons = {k for k, bit in BINDING.items() if any(p & bit for p in pads)}
        alphabet_dirs = {d for d, bit in DIRBITS.items() if any(p & bit for p in pads)}
        s = {"stateno": None, "time": 0, "ctrl": True, "statetype": "S", "anim": 0, "animtick": 0,
             "animtime": 0, "vx": 0.0, "vy": 0.0, "effects": []}
        prev, trace, opaque_effects = 0, [], []
        for tick, pad in enumerate(pads):
            cache = {}

            def command_active(name, pad=pad, prev=prev, cache=cache):
                # lazy: a command outside the reference only matters if a trigger reads it
                if name not in cache:
                    cmd = self.commands.get(name)
                    cache[name] = False if cmd is None else evaluate_command(
                        name, cmd, pad, prev, alphabet_buttons, alphabet_dirs)
                return cache[name]

            if s["stateno"] is None:
                self.enter(s, 0)
            s["effects"].clear()

            def refresh():
                s["animtime"] = self.animtime(s["anim"], s["animtick"])

            env = Env(s, command_active)
            guard = 0
            changed = True
            for special_state in (-2, -1):  # -3 has no controller in this package
                if special_state == -1:
                    pass
                for sec in self.special[special_state]:
                    refresh()
                    if controller_fires(sec, env):
                        if (get(sec, "type") or "").lower() != "changestate":
                            continue  # -2 PlaySnd etc.: recorded below as opaque, not simulated
                        target = int(get(sec, "value"))
                        self.enter(s, target)
                        c = get(sec, "ctrl")
                        if c is not None:
                            s["ctrl"] = bool(int(c))
                        guard += 1
                        break
                if special_state == -1 and guard:
                    break
            while True:
                if self.chain_state == s["stateno"]:
                    ctrls = self.states[s["stateno"]][0]["controllers"]
                elif s["stateno"] == 0:
                    ctrls = []
                else:
                    raise Opaque("unknown state")
                moved = False
                for sec in ctrls:
                    refresh()
                    kind = (get(sec, "type") or "").lower()
                    if kind == "changestate":
                        if controller_fires(sec, env):
                            target = int(get(sec, "value"))
                            self.enter(s, target)
                            c = get(sec, "ctrl")
                            if c is not None:
                                s["ctrl"] = bool(int(c))
                            moved = True
                            guard += 1
                            break
                    else:
                        # HitDef (AnimElem = 2) and PlaySnd (time = 1): effects not simulated.
                        try:
                            if self.opaque_trigger(sec, s):
                                s["effects"].append((kind, get(sec, "damage") or get(sec, "value"), "opaque"))
                        except Opaque:
                            pass
                if not moved or guard >= 16:
                    break
            refresh()
            names = list(self.commands)
            trace.append({"tick": tick, "stateno": s["stateno"], "time": s["time"], "ctrl": int(s["ctrl"]),
                          "statetype": s["statetype"], "action": s["anim"], "animtick": s["animtick"],
                          "animtime": s["animtime"], "vx_q8": round(s["vx"] * 256), "pad": pad,
                          "commands": [n for n in names if n in ("x", "holddown") and command_active(n)],
                          "opaque_effects": list(s["effects"])})
            prev = pad
            s["time"] += 1
            s["animtick"] += 1
        return trace

    def opaque_trigger(self, sec, s):
        """Would this unconverted controller have fired? Only to LIST the opaque effect."""
        for k, v, _ in sec["params"]:
            if k.startswith("trigger") and k != "triggerall":
                m = re.fullmatch(r"animelem\s*=\s*(\d+)", v.strip(), re.I)
                if m:  # AnimElem = N: first tick of element N (1-based) of the current anim
                    elem, acc = int(m.group(1)), 0
                    for i, e in enumerate(self.air[s["anim"]]):
                        if i + 1 == elem:
                            return s["animtick"] == acc
                        acc += e["ticks"]
                    return False
                m = re.fullmatch(r"time\s*=\s*(\d+)", v.strip(), re.I)
                if m:
                    return s["time"] == int(m.group(1))
        return False

    def visible(self, action, animtick):
        """AIR element index shown at `animtick` of `action` (looping at the end)."""
        els = self.air[action]
        total = sum(e["ticks"] for e in els)
        t, acc = animtick % total, 0
        for i, e in enumerate(els):
            acc += e["ticks"]
            if t < acc:
                return i
        return len(els) - 1


# ---------------------------------------------------------------------------- comparison

FIELDS = ("stateno", "time", "ctrl", "action", "animtick")


def compare(rom_entries, ref_trace, command_bits):
    problems = []
    for rom, ref in zip(rom_entries, ref_trace):
        for f in FIELDS:
            if rom[f] != ref[f]:
                problems.append((rom["tick"], f, rom[f], ref[f]))
        if rom["statetype"] != ref["statetype"]:
            problems.append((rom["tick"], "statetype", rom["statetype"], ref["statetype"]))
        if rom["vx"] != ref["vx_q8"]:
            problems.append((rom["tick"], "vx", rom["vx"], ref["vx_q8"]))
        bits = [n for i, n in enumerate(command_bits) if rom["cmd"] & (1 << i)]
        if sorted(bits) != sorted(ref["commands"]):
            problems.append((rom["tick"], "commands", bits, ref["commands"]))
    if len(rom_entries) != len(ref_trace):
        problems.append((None, "length", len(rom_entries), len(ref_trace)))
    return problems


def segments(trace, state):
    out, start = [], None
    for i, t in enumerate(trace):
        if t["stateno"] == state and start is None:
            start = i
        elif t["stateno"] != state and start is not None:
            out.append((start, i - start))
            start = None
        elif t["stateno"] == state and t["time"] == 0 and start != i:
            out.append((start, i - start))  # re-entry without leaving
            start = i
    if start is not None:
        out.append((start, len(trace) - start))
    return out


def mutate_controls(rom_entries):
    import copy
    controls = {}
    for name, edit in {
        "attack_one_tick_late": lambda e: _shift(e),
        "ctrl_not_cleared": lambda e: _set(e, "stateno", 200, "ctrl", 1),
        "wrong_animation": lambda e: _set(e, "stateno", 200, "action", 0),
        "duration_changed": lambda e: _set(e, "stateno", 200, "animtick", 99, once=True),
        "extra_attack_on_hold": lambda e: _set(e, "stateno", 0, "stateno", 200, once=True),
        "velocity_leak": lambda e: _set(e, "stateno", 200, "vx", 640),
        "time_not_reset": lambda e: _set(e, "stateno", 200, "time", 7, once=True),
    }.items():
        cp = copy.deepcopy(rom_entries)
        edit(cp)
        controls[name] = cp
    return controls


def _set(entries, key, value, field, new, once=False):
    for e in entries:
        if e[key] == value and e.get("_mut") is None:
            if key == "stateno" and value == 0 and field == "stateno" and e["time"] < 5:
                continue
            e[field] = new
            if once:
                e["_mut"] = True
                break


def _shift(entries):
    for i, e in enumerate(entries):
        if e["stateno"] == 200:
            for j in range(i, len(entries)):
                if entries[j]["stateno"] == 200:
                    entries[j]["stateno"], entries[j]["time"] = 0, 0
                else:
                    break
            break



def input_path(ui_report, capture):
    """Separate presentation latency, frame advance, delivery to the core and command semantics.

    Everything is aligned on the page clock (performance.now): the i-th completed
    `emulator_run_frame` after recording started is tick `ticks_before + i`; the ROM's own pad
    sample per tick says what the game actually saw. Nothing here is inferred from the ack alone.
    """
    events = ui_report["input_path"]["events"]
    before = capture["ticks_before_recording"]
    runs = [e for e in events if e["cmd"] == "emulator_run_frame" and "end" in e]
    ticks = {before + i: e for i, e in enumerate(runs)}
    starts = [e["start"] for e in runs]
    period = sorted(b - a for a, b in zip(starts, starts[1:]))
    entries = {e["tick"]: e for e in capture["entries"]}
    A = MD["A"]
    # runs of A held, as the game sampled them
    pad_runs, cur = [], None
    for t in sorted(entries):
        held = bool(entries[t]["pad"] & A)
        if held and cur is None:
            cur = [t, t]
        elif held:
            cur[1] = t
        elif cur is not None:
            pad_runs.append(tuple(cur))
            cur = None
    if cur:
        pad_runs.append(tuple(cur))
    downs = [e for e in events if e["cmd"] == "keydown" and e["code"] == "KeyZ" and not e.get("repeat")]
    ups = [e for e in events if e["cmd"] == "keyup" and e["code"] == "KeyZ"]
    sends_a = [e for e in events if e["cmd"] == "emulator_send_input"]
    rows = []
    by_first = {r[0]: r for r in pad_runs}
    for i, d in enumerate(downs):
        up = next((u for u in ups if u["start"] >= d["start"]), None)
        send_down = next((e for e in sends_a if e["a"] and e["start"] >= d["start"]), None)
        send_up = next((e for e in sends_a if not e["a"] and up and e["start"] >= up["start"]), None)
        # The joypad level is written under its own lock (not the command mutex), so an input can
        # land inside the frame being executed. The game samples it either in that frame (when its
        # pad poll comes later) or in the next call: both are valid candidates for the first tick.
        def candidates(ev):
            if not ev or "end" not in ev:
                return []
            inflight = next((t for t in sorted(ticks) if ticks[t]["start"] <= ev["end"] <= ticks[t]["end"]), None)
            nxt = next((t for t in sorted(ticks) if ticks[t]["start"] >= ev["end"]), None)
            return [t for t in (inflight, nxt) if t is not None]
        first_c, release_c = candidates(send_down), candidates(send_up)
        sampled_at = next((t for t in first_c if entries.get(t, {}).get("pad", 0) & A), None)
        run = by_first.get(sampled_at) if sampled_at is not None else None
        # a run of A begins in `first_c` and ends (first tick without A) in `release_c`
        consistent = None
        if run is not None and release_c:
            consistent = run[0] in first_c and (run[1] + 1) in release_c
        rows.append({
            "tap": i, "keydown_ms": round(d["start"], 1), "page_hold_ms": round(up["start"] - d["start"], 1) if up else None,
            "ipc_down_ms": round(send_down["end"] - send_down["start"], 1) if send_down and "end" in send_down else None,
            "keydown_to_ipc_ack_ms": round(send_down["end"] - d["start"], 1) if send_down and "end" in send_down else None,
            "candidate_first_ticks": first_c, "candidate_release_ticks": release_c,
            "game_pad_run": run, "game_ticks_held": (run[1] - run[0] + 1) if run else 0,
            "midframe_delivery": bool(run and first_c and run[0] == first_c[0] and len(first_c) == 2 and ticks[first_c[0]]["start"] <= send_down["end"]),
            "delivery_consistent": consistent,
            "lost_before_game": run is None,
        })
    # attribute each ROM run to the closest preceding keydown to count how many were delivered
    delivered = [r for r in rows if not r["lost_before_game"]]
    return {
        "frame_period_ms": {"median": round(period[len(period)//2], 2) if period else None, "min": round(period[0], 2) if period else None,
                            "max": round(period[-1], 2) if period else None, "frames": len(runs)},
        "effective_fps": round(1000 / period[len(period)//2], 1) if period else None,
        "native_taps": rows, "game_a_runs": [{"first": a, "last": b, "ticks": b - a + 1} for a, b in pad_runs],
        "keydowns_seen_by_page": len(downs), "a_runs_seen_by_game": len(pad_runs), "taps_lost_before_game": len(rows) - len(delivered),
        "driver_requests": ui_report["input_path"]["requests"],
    }


def load_real_module():
    spec = importlib.util.spec_from_file_location("verify_mugen_real", Path(__file__).with_name("verify-mugen-real.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", type=Path, required=True, help="directory with ken8.def and siblings")
    ap.add_argument("--capture", type=Path, required=True, help="chain-capture.json")
    ap.add_argument("--analysis", type=Path, required=True, help="analysis.json (original_chain report)")
    ap.add_argument("--frames", type=Path, help="directory with core-XXXX.png (default: capture dir)")
    ap.add_argument("--output", type=Path, required=True)
    ap.add_argument("--no-pixels", action="store_true")
    ap.add_argument("--ui-report", type=Path, help="ui-report.json: also analyse the native input path")
    args = ap.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    capture = json.loads(args.capture.read_text())
    analysis = json.loads(args.analysis.read_text())
    entries = capture["entries"]
    command_bits = analysis["original_chain"]["command_bits"]
    ref = Reference(args.source)
    pads = [e["pad"] for e in entries]
    trace = ref.run(pads)
    problems = compare(entries, trace, command_bits)
    report = {"schema": "retrodev.mugen_chain_independent/v1", "reference": "scripts/verify-mugen-chain.py",
              "source_hashes": ref.hashes, "ticks": len(entries), "command_bits": command_bits,
              "rom_sha256": capture["rom_sha256"], "mismatches": problems[:20], "mismatch_count": len(problems),
              "attack_segments": [{"start_tick": a, "ticks": n} for a, n in segments(trace, 200)],
              "opaque_effects": [{"tick": t["tick"], "effects": t["opaque_effects"]} for t in trace if t["opaque_effects"]],
              "declared_limits": [
                  "state 0 is an authored stand-in (common1.cns absent)",
                  "command buffer.time default and plain-button press edge not verified in primary cmd.html",
                  "HitDef/PlaySnd/poweradd effects are opaque, not simulated",
                  "Pos y fixed at 0: no converted or referenced controller moves y"]}
    assert not problems, f"ROM trace diverges from the independent reference: {problems[:10]}"
    # the oracle must be sensitive: each deliberately wrong ROM trace must be rejected
    rejected = {}
    for name, bad in mutate_controls(entries).items():
        for e in bad:
            e.pop("_mut", None)
        rejected[name] = bool(compare(bad, trace, command_bits))
        assert rejected[name], f"insensitive oracle: {name}"
    report["negative_controls"] = {k: "rejected" for k in rejected}
    if not args.no_pixels:
        real = load_real_module()
        sprites, actions, palette = real.read_source(args.source)
        visual = analysis["report"]["visual_review"]
        templates = {}
        for f in visual["frames"]:
            key = f["action"], f["element"]
            air = actions[key[0]][key[1]]
            sprite = sprites[tuple(air["values"][:2])]
            templates[key] = real.pose(sprite, air, palette, "core", (256, 256), (128, 128))
        from PIL import Image
        frames_dir = args.frames or args.capture.parent
        # A game tick is NOT an emulated frame: the main loop sometimes takes two VBlanks.
        # Frames and ticks are therefore joined on SGDK's vblank counter (`vtimer`, low 16 bits,
        # recorded by the ROM at every tick), never on the frame index.
        vt0 = entries[0]["vt"]
        rel = lambda v: ((v - vt0 + 32768) & 0xFFFF) - 32768
        tick_vt = [rel(e["vt"]) for e in entries]
        spans = {}
        for a_, b_ in zip(tick_vt, tick_vt[1:]):
            spans[b_ - a_] = spans.get(b_ - a_, 0) + 1
        report["tick_span_vblanks"] = {str(k): v for k, v in sorted(spans.items())}
        lag_results = {}
        for lag in (-1, 0, 1, 2):
            bad = []
            for fr in capture["frames"]:
                v = rel(fr["vtimer_after"])
                cands = [t for t, tv in enumerate(tick_vt) if tv + 1 + lag <= v]
                if not cands:
                    continue
                r = trace[cands[-1]]
                expect = (r["action"], ref.visible(r["action"], r["animtick"]))
                hits = real.identify_core(Image.open(frames_dir / fr["file"]).convert("RGBA"), templates)
                if not any((h["action"], h["element"]) == expect for h in hits):
                    bad.append((fr["frame"], cands[-1], expect, [(h["action"], h["element"]) for h in hits]))
            lag_results[lag] = bad
        best = min(lag_results, key=lambda k: len(lag_results[k]))
        report["pixel_lag_vblanks"] = best
        report["pixel_mismatches_by_lag"] = {str(k): len(v) for k, v in lag_results.items()}
        assert not lag_results[best], f"pixels diverge from the reference at lag {best}: {lag_results[best][:5]}"
        report["pixels_checked"] = len(capture["frames"])
    if args.ui_report:
        report["input_path"] = input_path(json.loads(args.ui_report.read_text()), capture)
    (args.output / "chain-independent-report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps({k: report[k] for k in ("ticks", "mismatch_count", "attack_segments", "negative_controls", "tick_span_vblanks")
                      if k in report} | {"pixel_lag": report.get("pixel_lag_vblanks"),
                                         "pixels_checked": report.get("pixels_checked")}))


if __name__ == "__main__":
    sys.exit(main())
