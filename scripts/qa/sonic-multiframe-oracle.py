#!/usr/bin/env python3
"""External visual QA, never a product decoder. Requires host Pillow.

Rebuilds each PNG from BYOR mappings and DPLC. Iterates hardware cells by
their ordinal (row = ordinal % height), independently of the Rust per-pixel
resolver. Commercial bytes and images stay in the ignored evidence directory.
"""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw

PIN = "c7da53a10c317f882f5bba93af31c3972fc1ded18d8507d4f3d5a06190c81ebb"


def decode(rom, frame, wrong_order=False):
    word = lambda p: int.from_bytes(rom[p:p + 2], "big")
    table = 0x211e2
    p = table + word(table + frame * 2)
    pieces = []
    for n in range(rom[p]):
        b = rom[p + 1 + n * 5:p + 6 + n * 5]
        pieces.append((int.from_bytes(b[4:], "big", signed=True),
                       int.from_bytes(b[:1], "big", signed=True),
                       (b[1] >> 2 & 3) + 1, (b[1] & 3) + 1,
                       int.from_bytes(b[2:4], "big")))
    d = 0x217fe + word(0x217fe + frame * 2)
    slots = []
    for n in range(rom[d]):
        c = word(d + 1 + n * 2)
        slots.extend(range(c & 4095, (c & 4095) + (c >> 12) + 1))
    left = min([0] + [p[0] for p in pieces])
    top = min([0] + [p[1] for p in pieces])
    width = max([0] + [p[0] + 8 * p[2] for p in pieces]) - left
    height = max([0] + [p[1] + 8 * p[3] for p in pieces]) - top
    colors = []
    for i in range(16):
        c = word(0x2388 + i * 2)
        colors.append(((c >> 1 & 7) * 36, (c >> 5 & 7) * 36,
                       (c >> 9 & 7) * 36, 0 if i == 0 else 255))
    image = Image.new("RGBA", (width, height), colors[0])
    for x, y, columns, rows, attr in pieces:
        assert attr & 0x6000 == 0, "unsupported palette bank"
        for ordinal in range(rows * columns):
            cx, cy = (ordinal % columns, ordinal // columns) if wrong_order else (ordinal // rows, ordinal % rows)
            tile = slots[(attr & 2047) + ordinal]
            raw = rom[0x21afe + 32 * tile:0x21afe + 32 * (tile + 1)]
            assert len(raw) == 32
            for row in range(8):
                for col in range(8):
                    value = raw[row * 4 + col // 2]
                    index = value >> 4 if col % 2 == 0 else value & 15
                    dx, dy = cx * 8 + col, cy * 8 + row
                    if attr & 0x800: dx = columns * 8 - 1 - dx
                    if attr & 0x1000: dy = rows * 8 - 1 - dy
                    image.putpixel((x - left + dx, y - top + dy), colors[index])
    return image


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--rom", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path)
    args = parser.parse_args()
    rom = args.rom.read_bytes()
    assert hashlib.sha256(rom).hexdigest() == PIN, "identity_mismatch"
    report = json.loads(args.report.read_text())
    assert report["base_sha256"] == PIN
    results = []
    sheet = Image.new("RGB", (640, 480), "#252536")
    draw = ImageDraw.Draw(sheet)
    for n, entry in enumerate(report["frames"]):
        expected = decode(rom, entry["context"]["mapping_index"])
        png = Path(entry["png"]["path"])
        assert hashlib.sha256(png.read_bytes()).hexdigest() == entry["png"]["sha256"]
        actual = Image.open(png).convert("RGBA")
        assert actual.size == expected.size
        assert actual.tobytes() == expected.tobytes(), entry["frame_id"]
        digest = hashlib.sha256(expected.tobytes()).hexdigest()
        assert digest == entry["pixels_sha256"]
        mutant = decode(rom, entry["context"]["mapping_index"], wrong_order=True)
        assert mutant.tobytes() != expected.tobytes(), "order control is vacuous"
        changed = bytearray(expected.tobytes()); changed[0] ^= 1
        assert bytes(changed) != actual.tobytes(), "pixel mutation accepted"
        results.append({"frame": entry["frame_id"], "rgba_sha256": digest,
                        "pixels": expected.width * expected.height, "order_mutation_rejected": True,
                        "pixel_mutation_rejected": True})
        x, y = (n % 5) * 128, (n // 5) * 240
        sheet.paste(expected.resize((expected.width * 3, expected.height * 3), Image.Resampling.NEAREST), (x, y + 28),
                    expected.resize((expected.width * 3, expected.height * 3), Image.Resampling.NEAREST))
        draw.text((x + 3, y + 4), entry["frame_id"].split("/")[1], fill="white")
    sheet.save(args.report.parent / "contact-sheet.png")
    output = {"base_sha256": PIN, "frames": results, "classification": "independent static decode; no runtime equivalence claim"}
    (args.report.parent / "independent-oracle.json").write_text(json.dumps(output, indent=2) + "\n")
    print(json.dumps({"frames_passed": len(results), "controls_rejected": len(results) * 2,
                      "contact_sheet": str(args.report.parent / "contact-sheet.png")}))


if __name__ == "__main__":
    main()
