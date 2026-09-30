#!/usr/bin/env python3
"""Independent, offline BYOR oracle. Pillow decodes PCX; no RetroDev decoder.

Only the selected SFF v1/ACT/AIR pilot is supported by this verification tool.
Python/Pillow are QA prerequisites, never app dependencies. All pixel artifacts
are written to the supplied local evidence directory, not into Git.
"""
import argparse
import base64
import hashlib
import io
import json
import re
import struct
from pathlib import Path

from PIL import Image, ImageDraw


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_source(root):
    data = (root / "ken.sff").read_bytes()
    assert data[:12] == b"ElecbyteSpr\x00" and data[15] == 1
    count, pos = struct.unpack_from("<II", data, 20)
    sprites, ordered, palette = {}, [], bytes(768)
    for _ in range(count):
        nxt, length, ax, ay, group, number, link = struct.unpack_from("<IIhhHHH", data, pos)
        if length:
            blob = data[pos + 32:pos + 32 + length]
            if len(blob) >= 769 and blob[-769] == 12:
                palette = blob[-768:]
            else:
                blob += b"\x0c" + palette
            pcx = Image.open(io.BytesIO(blob))
            pcx.load()
            assert pcx.mode == "P"
            sprite = {"indices": pcx.tobytes(), "size": pcx.size, "embedded": palette}
        else:
            assert link < len(ordered)
            sprite = dict(ordered[link])
        sprite.update(axis=(ax, ay), offset=pos, key=(group, number))
        sprites[group, number] = sprite
        ordered.append(sprite)
        pos = nxt
    actions, current = {}, None
    for line_no, raw in enumerate((root / "ken.air").read_text(encoding="latin1").splitlines(), 1):
        line = raw.split(";", 1)[0].strip()
        match = re.fullmatch(r"\[\s*Begin\s+Action\s+(-?\d+)\s*\]", line, re.I)
        if match:
            current = int(match[1])
            actions[current] = []
        elif current is not None and re.match(r"^-?\d+\s*,", line):
            parts = [p.strip() for p in line.split(",")]
            actions[current].append({"values": list(map(int, parts[:5])), "flip": parts[5].upper() if len(parts) > 5 else "", "line": line_no})
    act = (root / "ken1.act").read_bytes()
    assert len(act) == 768
    palette = [tuple(act[(255-i)*3:(256-i)*3]) for i in range(256)]
    return sprites, actions, palette


def pixel_rgb(rgb, mode):
    if mode == "source":
        return rgb
    levels = [(c * 7 + 127) // 255 for c in rgb]
    if mode == "vdp":
        return tuple((v * 255 + 3) // 7 for v in levels)
    # Genesis Plus GX normal mode, RGB565 output; independently derived from
    # pinned upstream vdp_render.c MAKE_PIXEL and standard bit replication.
    r, g, b = [v * 2 for v in levels]
    r, g, b = (r << 1) | (r >> 3), (g << 2) | (g >> 2), (b << 1) | (b >> 3)
    return (r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)


def pose(sprite, frame, palette, mode, size, anchor):
    rgba = bytearray()
    for index in sprite["indices"]:
        rgba.extend((*pixel_rgb(palette[index], mode), 255) if index else (0, 0, 0, 0))
    image = Image.frombytes("RGBA", sprite["size"], bytes(rgba))
    ax, ay = sprite["axis"]
    _, _, dx, dy, _ = frame["values"]
    if "H" in frame["flip"]:
        image = image.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        ax = image.width - ax
    if "V" in frame["flip"]:
        image = image.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
        ay = image.height - ay
    canvas = Image.new("RGBA", size)
    canvas.paste(image, (anchor[0] + dx - ax, anchor[1] + dy - ay))
    return canvas


def decode_png(data):
    return Image.open(io.BytesIO(base64.b64decode(data.split(",", 1)[1]))).convert("RGBA")


def assert_pixels(a, b, label):
    assert a.size == b.size, (label, a.size, b.size)
    assert a.tobytes() == b.tobytes(), f"pixel divergence: {label}"


def identify_core(image, templates):
    rgb = image.convert("RGB").copy()
    # Generated project title is a separate plane at row 1. Exclude only those
    # first 24 scanlines; the complete framebuffer is still compared to canvas.
    ImageDraw.Draw(rgb).rectangle((0,0,rgb.width-1,23),fill="black")
    bbox = rgb.getbbox()
    assert bbox, "empty framebuffer"
    actual = rgb.crop(bbox)
    hits = []
    for (action, element), template in templates.items():
        expected = template.convert("RGB")
        eb = expected.getbbox()
        if expected.crop(eb).tobytes() == actual.tobytes() and expected.crop(eb).size == actual.size:
            hits.append({"action": action, "element": element, "anchor": [bbox[0]-eb[0]+128, bbox[1]-eb[1]+128]})
    assert hits, f"unrecognized real sprite: framebuffer bbox {bbox}"
    return hits


def compiled_resources(project, sprites, actions, palette, output):
    """Decode linked SGDK 2.11 structures and uncompressed VDP tiles from ROM.

    Layout is the official sprite_eng.h (M68K ABI: two-byte alignment), not
    the import report. Pixels are independently reconstructed per VDP piece.
    """
    folder = project / "build/megadrive/out"
    rom = (folder / "rom.bin").read_bytes()
    symbols = {}
    for line in (folder / "symbol.txt").read_text().splitlines():
        parts = line.split()
        if len(parts) >= 3:
            symbols[parts[2]] = int(parts[0], 16)
    w, h, palptr, count, animptr, max_tile, max_sprite = struct.unpack_from(">HHIHIHH", rom, symbols["kenmasters"])
    num_colors, paldata = struct.unpack_from(">HI", rom, palptr)
    cram = struct.unpack_from(">" + "H"*num_colors, rom, paldata)
    colors = [tuple((((word >> shift) & 7)*255+3)//7 for shift in (1,5,9)) for word in cram]
    scene = json.loads((project / "scenes/main.json").read_text())
    entity = next(e for e in scene["entities"] if e["entity_id"] == "kenmasters")
    animation_names = sorted(entity["components"]["sprite"]["animations"])
    assert len(animation_names) == count
    selected = {tuple(f["values"][:2]) for n in (0,20,21,200) for f in actions[n]}
    cell_anchor = (max(sprites[k]["axis"][0] for k in selected), max(sprites[k]["axis"][1] for k in selected))
    metrics = {"origin":"compiled_rom_structure", "cell":[w,h], "cell_anchor":cell_anchor, "max_tiles_allocated":max_tile, "vram_tile_bytes":max_tile*32, "max_vdp_sprites":max_sprite, "frames":[], "rom_sha256":sha(rom), "cpu_cycles":"not_measured", "dma_time":"not_measured"}
    for ai, name in enumerate(animation_names):
        ap = struct.unpack_from(">I",rom,animptr+ai*4)[0]
        frames, loop, fp = struct.unpack_from(">BBI",rom,ap)
        action = int(name.removeprefix("action_")) if name.startswith("action_") else 0
        assert frames == len(actions[action])
        for fi in range(frames):
            frameptr = struct.unpack_from(">I",rom,fp+fi*4)[0]
            ns, timer, tilesptr, _ = struct.unpack_from(">BBII",rom,frameptr)
            compression, tiles, data = struct.unpack_from(">HHI",rom,tilesptr)
            assert compression == 0, "oracle currently requires SGDK NONE (pilot contract)"
            pieces, tile_index, canvas = [], 0, Image.new("RGBA",(w,h))
            for si in range(ns & 127):
                oy, _, sz, ox, _, nt = struct.unpack_from(">6B",rom,frameptr+10+si*6)
                tw, th = ((sz >> 2) & 3)+1, (sz & 3)+1
                assert nt == tw*th
                for tx in range(tw):
                    for ty in range(th):
                        tile = rom[data+tile_index*32:data+(tile_index+1)*32]
                        tile_index += 1
                        for y in range(8):
                            for x in range(8):
                                index = (tile[y*4+x//2] >> (4 if x%2 == 0 else 0)) & 15
                                if index:
                                    canvas.putpixel((ox+tx*8+x,oy+ty*8+y),(*colors[index],255))
                pieces.append((ox,oy,tw*8,th*8))
            assert tile_index == tiles
            air = actions[action][fi]
            assert timer == air["values"][4]
            sprite = sprites[tuple(air["values"][:2])]
            expected = pose(sprite,{**air,"values":[*air["values"][:2],0,0,air["values"][4]],"flip":""},palette,"vdp",(w,h),cell_anchor)
            if canvas.tobytes() != expected.tobytes():
                canvas.save(output / "compiled-divergence.png")
                expected.save(output / "compiled-expected.png")
                print("compiled divergence",name,fi,pieces,"palette",colors,"tiles",tiles,"anchor",cell_anchor)
            assert_pixels(canvas,expected,f"compiled {name} {fi}")
            canvas.save(output / f"compiled-{name}-{fi}.png")
            scan_sprites = max(sum(y<=line<y+height for _,y,_,height in pieces) for line in range(h))
            scan_pixels = max(sum(width for _,y,width,height in pieces if y<=line<y+height) for line in range(h))
            metrics["frames"].append({"animation":name,"element":fi,"timer":timer,"vdp_sprites":ns&127,"tile_bytes":tiles*32,"scanline_sprite_peak":scan_sprites,"scanline_pixel_peak":scan_pixels,"rgba_sha256":sha(canvas.tobytes())})
    metrics["max_scanline_sprites"] = max(f["scanline_sprite_peak"] for f in metrics["frames"])
    metrics["max_scanline_pixels"] = max(f["scanline_pixel_peak"] for f in metrics["frames"])
    metrics["max_upload_bytes_per_changed_frame"] = max(f["tile_bytes"] for f in metrics["frames"])
    return metrics


def verify_timeline(samples, actions, velocity, attack_cycles=1):
    """Use visible poses, AIR order/timers and authored velocity, not RAM labels."""
    checks=[]
    for phase, action in [("idle",0),("walk",20),("stop",0),("back",21),("stop2",0),("attack",200),("idle2",0)]:
        group=[s for s in samples if s["phase"]==phase]
        visible=lambda s:any(h["action"]==action for h in s["independent_matches"])
        indices=[i for i,s in enumerate(group) if visible(s)]
        assert indices, (phase,"requested action never became visible")
        if phase == "idle":
            assert all(visible(s) for s in group), "action occurred before any input"
        if phase == "attack":
            bouts=[]
            for sample in group:
                if visible(sample):
                    if not bouts or not bouts[-1]:
                        bouts.append([sample])
                    else:
                        bouts[-1].append(sample)
                else:
                    assert all(h["action"]==0 for h in sample["independent_matches"]), "unexpected action between attacks"
                    if bouts and bouts[-1]:
                        bouts.append([])
            bouts=[b for b in bouts if b]
            pattern=[i for i,f in enumerate(actions[action]) for _ in range(f["values"][4])]
            assert len(bouts)==attack_cycles, ("unexpected attack cycle count",len(bouts),attack_cycles)
            for bout in bouts:
                assert len(bout)==len(pattern), ("incomplete attack cycle",len(bout))
                assert all(any(h["action"]==action and h["element"]==pattern[i] for h in s["independent_matches"]) for i,s in enumerate(bout)), "attack AIR order or duration diverged"
                anchors=[s["independent_matches"][0]["anchor"] for s in bout]
                assert all(p==anchors[0] for p in anchors), "attack moved unexpectedly"
            checks.append({"phase":phase,"action":action,"frames":sum(map(len,bouts)),"cycles":len(bouts),"ticks_per_cycle":len(pattern),"velocity_q8":0,"dx":0,"duration_and_order":"exact","geometry":"exact"})
            continue
        group=group[indices[0]:indices[-1]+1]
        assert all(visible(s) for s in group), (phase,"unexpected action inside stable interval")
        pattern=[i for i,f in enumerate(actions[action]) for _ in range(f["values"][4])]
        offsets=[offset for offset in range(len(pattern)) if all(any(h["action"]==action and h["element"]==pattern[(i+offset)%len(pattern)] for h in s["independent_matches"]) for i,s in enumerate(group))]
        assert offsets, (phase,"AIR order or duration diverged")
        anchors=[s["independent_matches"][0]["anchor"] for s in group]
        speed=velocity.get(phase,0)
        # Input/ack and screenshot boundaries are trimmed above. Unknown initial
        # fraction is tested against all Q8.8 phases, rather than read from RAM.
        fractions=[f for f in range(256) if all(p[0]-anchors[0][0] == (f+i*speed)//256 and p[1]==anchors[0][1] for i,p in enumerate(anchors))]
        assert fractions, (phase,"visible displacement diverged from Q8.8 contract")
        checks.append({"phase":phase,"action":action,"frames":len(group),"matching_air_phase_offsets":offsets,"velocity_q8":speed,"dx":anchors[-1][0]-anchors[0][0],"duration_and_order":"exact","geometry":"exact"})
    return checks


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--backend", type=Path, required=True)
    parser.add_argument("--ui", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    sprites, actions, palette = read_source(args.source)
    analysis = json.loads((args.backend / "analysis.json").read_text())
    visual = analysis["report"]["visual_review"]
    size, anchor = (visual["width"], visual["height"]), visual["anchor"]
    report = {"schema": "retrodev.mugen_real_independent/v1", "decoder": "Pillow PCX", "source_sha256": analysis["source_sha256"], "sprite_comparison_roi": "all pixels below scanline 24; generated title excluded", "preview": [], "core": [], "ui": [], "negative_controls": {}}
    report["compiled_resources"] = compiled_resources(args.backend / "project",sprites,actions,palette,args.output)
    templates, source_images, converted_images = {}, {}, {}
    for f in visual["frames"]:
        key = f["action"], f["element"]
        air = actions[key[0]][key[1]]
        sprite = sprites[tuple(air["values"][:2])]
        assert [f["group"], f["image"]] == air["values"][:2]
        assert f["sprite_axis"] == list(sprite["axis"])
        assert f["sprite_size"] == list(sprite["size"])
        assert f["offset"] == air["values"][2:4] and f["duration"] == air["values"][4]
        assert f["hflip"] == ("H" in air["flip"]) and f["vflip"] == ("V" in air["flip"])
        assert f["indices_sha256"] == sha(sprite["indices"])
        for mode, field in [("source", "original"), ("vdp", "converted")]:
            expected = pose(sprite, air, palette, mode, size, anchor)
            actual = decode_png(f[field + "_png"])
            assert_pixels(expected, actual, f"{key} {field}")
            assert sha(expected.tobytes()) == f[field + "_sha256"]
            expected.save(args.output / f"{field}-{key[0]}-{key[1]}.png")
            (source_images if field == "original" else converted_images)[key] = expected
        templates[key] = pose(sprite, air, palette, "core", (256, 256), (128, 128))
        report["preview"].append({"action": key[0], "element": key[1], "sprite": air["values"][:2], "line": air["line"], "indices_sha256": sha(sprite["indices"]), "original_sha256": f["original_sha256"], "converted_sha256": f["converted_sha256"]})
    xacc = 0
    cell_anchor = report["compiled_resources"]["cell_anchor"]
    for s in json.loads((args.backend / "core-capture.json").read_text())["samples"]:
        image = Image.open(args.backend / s["file"]).convert("RGBA")
        hits = identify_core(image, templates)
        # Framebuffer presents the prior main-loop state; movement is independently
        # predicted from the explicitly authored Q8.8 contract, never from RAM.
        expected_anchor = [96+xacc//256+cell_anchor[0],96+cell_anchor[1]]
        assert all(h["anchor"] == expected_anchor for h in hits), (s["tick"],"source anchor mismatch",hits,expected_anchor)
        xacc += {"walk":640,"back":-448}.get(s["phase"],0)
        assert s["x"] == 96+xacc//256 and s["y"] == 96, (s["tick"],"RAM geometry vs independent contract")
        report["core"].append({**s, "independent_matches": hits})
    assert {h["action"] for s in report["core"] for h in s["independent_matches"]} == {0, 20, 21, 200}
    report["core_timing_geometry"] = verify_timeline(report["core"],actions,{"walk":640,"back":-448})
    # Controls change bytes, not labels. Each must be rejected by the same exact
    # oracle used for the positive source/preview/core comparisons.
    air, sprite = actions[0][0], sprites[(0, 0)]
    baseline = source_images[0, 0]
    variants = {
        "wrong_palette": pose(sprite, air, [tuple(sprite["embedded"][i*3:i*3+3]) for i in range(256)], "source", size, anchor),
        "wrong_sprite": pose(sprites[(0, 2)], air, palette, "source", size, anchor),
        "shifted_axis": pose({**sprite, "axis": (sprite["axis"][0]+1, sprite["axis"][1])}, air, palette, "source", size, anchor),
        "wrong_flip": pose(sprite, {**air, "flip": "H"}, palette, "source", size, anchor),
        "stale_image": source_images[20, 0],
    }
    for name, wrong in variants.items():
        rejected = False
        try:
            assert_pixels(baseline, wrong, name)
        except AssertionError:
            rejected = True
        assert rejected, f"insensitive oracle: {name}"
        report["negative_controls"][name] = "rejected"
    if args.ui:
        ui = json.loads((args.ui / "ui-report.json").read_text())
        for f in ui["review_frames"]:
            key = f["action"], f["element"]
            assert_pixels(source_images[key], decode_png(f["original_png"]), f"UI original {key}")
            assert_pixels(converted_images[key], decode_png(f["converted_png"]), f"UI converted {key}")
        for s in ui["samples"]:
            image = Image.open(args.ui / s["file"]).convert("RGBA")
            report["ui"].append({**s, "independent_matches": identify_core(image, templates)})
        assert ui["core_canvas_equal"] and ui["rom_sha256"]
        assert {h["action"] for s in report["ui"] for h in s["independent_matches"]} == {0, 20, 21, 200}
        # Native input observations advance in ten-frame viewport batches. The
        # captured press lasted ten emulated frames and the explicitly authored
        # level command legitimately restarted after idle. Require two complete
        # six-tick cycles, then idle; never erase the intervening idle frame.
        attack_inputs=[i for i in ui["inputs"] if i["code"]=="KeyZ"]
        assert [(i["down"]) for i in attack_inputs]==[True,False]
        assert attack_inputs[1]["frame"]-attack_inputs[0]["frame"]==10
        report["ui_timing_geometry"] = verify_timeline(report["ui"],actions,{"walk":384,"back":-448},attack_cycles=2)
        report["ui_compiled_resources"] = compiled_resources(Path(ui["projectDir"]),sprites,actions,palette,args.output)
        report["ui_flow"] = ui["steps"]
        report["rom_sha256"] = ui["rom_sha256"]
    # Actual captured core/UI pixels, matched to the same AIR element. The
    # independently transformed template remains the oracle, never the gallery's
    # substitute for an executed image.
    keys = [(0, 0), (20, 0), (200, 1)]
    columns = 4 if report["ui"] else 3
    gallery = Image.new("RGB", (columns*240, 400), "#25252e")
    draw = ImageDraw.Draw(gallery)
    for row, key in enumerate(keys):
        images = [(f"Fonte {key}", source_images[key].crop(source_images[key].getbbox())),
                  ("Previa VDP", converted_images[key].crop(converted_images[key].getbbox()))]
        for label, samples, folder in [("Core oficial RGB565",report["core"],args.backend),("Canvas UI",report["ui"],args.ui)]:
            if not samples:
                continue
            sample = next(s for s in samples if any((h["action"],h["element"])==key for h in s["independent_matches"]))
            match = next(h for h in sample["independent_matches"] if (h["action"],h["element"])==key)
            b = templates[key].getbbox()
            ax, ay = match["anchor"]
            captured = Image.open(folder/sample["file"]).convert("RGBA").crop((ax+b[0]-128,ay+b[1]-128,ax+b[2]-128,ay+b[3]-128))
            images.append((label,captured))
        for col, (label, img) in enumerate(images):
            draw.text((col*240+6, row*132+4), label, fill="white")
            gallery.paste(img, (col*240+50, row*132+25), img)
    gallery.save(args.output / "gallery.png")
    capture = report["ui"] if report["ui"] else report["core"]
    folder = args.ui if report["ui"] else args.backend
    clip = [Image.open(folder / s["file"]).convert("RGB").resize((640, 448), Image.Resampling.NEAREST) for s in capture]
    # GIF stores centiseconds: distribute 10/20 ms deterministically to retain
    # average logical 1/60 s. This is a logical sequence, not host FPS telemetry.
    durations = [(round((i+1)*100/60)-round(i*100/60))*10 for i in range(len(clip))]
    clip[0].save(args.output / "ken-sequence.gif", save_all=True, append_images=clip[1:], duration=durations, loop=0)
    (args.output / "independent-report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps({"preview_frames": len(report["preview"]), "core_frames": len(report["core"]), "ui_frames": len(report["ui"]), "negative_controls": report["negative_controls"]}))


if __name__ == "__main__":
    main()
