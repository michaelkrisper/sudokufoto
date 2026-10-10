#!/usr/bin/env python3
"""Synthetic phone photos of printed sudokus, for training and tests.

Every case is a random puzzle printed in a random font and line style on paper
with some surrounding clutter, put into a photo with perspective, rotation,
uneven light, blur, noise and JPEG artefacts.

  tools/synth.py OUT --n 50 [--seed 1] [--fonts train|test|all] [--size 1200]

With OUT = "-" it streams instead (for tools/extract.mjs): per case one JSON
line, then the grayscale bytes.

Otherwise writes OUT/NNNN.pgm (grayscale, what the detector sees), optionally
OUT/NNNN.jpg (--jpeg), and OUT/cases.json with the givens (81 chars, 0 =
empty) and the grid corners (TL, TR, BR, BL) in photo pixels.
"""

import argparse
import hashlib
import io
import json
import math
import os
import random
import re
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

SKIP = re.compile(
    r"emoji|symbol|dingbat|z003|d050000l|jomolhari|cjk|nerd|awesome|math|music|"
    r"thin|hairline|extralight|braille|ornament|webdings|wingding|kacst|lohit|sign|fallback|paktype|vazirmatn",
    re.I,
)


def font_files(split):
    out = subprocess.run(
        ["fc-list", ":charset=31-39:lang=en", "file", "family"], capture_output=True, text=True, check=True
    ).stdout
    fam = {}
    for line in out.splitlines():
        if ":" in line:
            f, family = line.split(":", 1)
            fam[f.strip()] = family.strip().split(",")[0].lower()
    files = sorted(f for f in fam if not SKIP.search(os.path.basename(f) + fam[f]))
    if split == "all":
        return files

    # Split by family so test fonts are really unseen during training.
    def in_test(f):
        return hashlib.md5(fam[f].encode()).digest()[0] % 4 == 0

    return [f for f in files if in_test(f) == (split == "test")]


def random_grid(rng):
    base = [[(3 * (r % 3) + r // 3 + c) % 9 + 1 for c in range(9)] for r in range(9)]
    bands = rng.sample(range(3), 3)
    rows = [b * 3 + r for b in bands for r in rng.sample(range(3), 3)]
    stacks = rng.sample(range(3), 3)
    cols = [s * 3 + c for s in stacks for c in rng.sample(range(3), 3)]
    digits = rng.sample(range(1, 10), 9)
    sol = [digits[base[r][c] - 1] for r in rows for c in cols]
    n = rng.randint(20, 40)
    keep = set(rng.sample(range(81), n))
    return [d if i in keep else 0 for i, d in enumerate(sol)]


def load_font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return None


def render_paper(rng, givens, fonts, cell=72):
    """Puzzle on paper, 4x supersampled. Returns image and grid corners."""
    s = 4
    c = cell * s
    g = 9 * c
    margin = int(rng.uniform(0.3, 1.2) * c)
    top = margin + int(rng.uniform(0.6, 1.8) * c)
    W, H = g + 2 * margin, g + top + margin
    paper = tuple(int(v) for v in np.array([245, 243, 236]) * rng.uniform(0.9, 1.04))
    paper = tuple(min(255, v) for v in paper)
    im = Image.new("L", (W, H), int(np.mean(paper)))
    d = ImageDraw.Draw(im)
    ink = rng.randint(0, 60)

    # clutter: a heading, some text and numbers around the grid
    font = None
    while font is None:
        fpath = rng.choice(fonts)
        font = load_font(fpath, int(rng.uniform(0.5, 0.78) * c))
    head = load_font(fpath, int(0.45 * c))
    if head:
        d.text((margin, margin * 0.4), rng.choice(["SUDOKU", "Sudoku Nr. 412", "Leicht", "Schwer ****"]),
               fill=ink, font=head)
        small = load_font(fpath, int(0.22 * c))
        for k in range(rng.randint(0, 4)):
            y = top + g + margin * 0.2 + k * 0.3 * c
            if y < H - 0.3 * c:
                d.text((margin, y), "".join(rng.choice("abcdefghij 0123456789") for _ in range(40)),
                       fill=ink + 40, font=small)

    x0, y0 = margin, top
    if rng.random() < 0.2:  # shaded alternate boxes
        shade = int(np.mean(paper)) - rng.randint(15, 45)
        for b in range(9):
            if b % 2 == 0:
                bx, by = x0 + (b % 3) * 3 * c, y0 + (b // 3) * 3 * c
                d.rectangle([bx, by, bx + 3 * c, by + 3 * c], fill=shade)
    thin = rng.uniform(0.8, 3.0) * s
    thick = thin if rng.random() < 0.1 else rng.uniform(max(thin, 2 * s), 7.5 * s)
    outer = thick * rng.uniform(1, 1.6)
    line_ink = rng.randint(0, 80) if rng.random() < 0.8 else rng.randint(80, 150)
    for k in range(10):
        w = outer if k in (0, 9) else thick if k % 3 == 0 else thin
        p = k * c
        d.rectangle([x0 + p - w / 2, y0 - outer / 2, x0 + p + w / 2, y0 + g + outer / 2], fill=line_ink)
        d.rectangle([x0 - outer / 2, y0 + p - w / 2, x0 + g + outer / 2, y0 + p + w / 2], fill=line_ink)

    jit = rng.uniform(0, 0.06)
    for i, v in enumerate(givens):
        if not v:
            continue
        cx = x0 + (i % 9 + 0.5 + rng.uniform(-jit, jit)) * c
        cy = y0 + (i // 9 + 0.5 + rng.uniform(-jit, jit)) * c
        d.text((cx, cy), str(v), fill=ink, font=font, anchor="mm")

    im = im.resize((W // s, H // s), Image.LANCZOS)
    corners = [(x0, y0), (x0 + g, y0), (x0 + g, y0 + g), (x0, y0 + g)]
    return im, [(x / s, y / s) for x, y in corners]


def homography(src, dst):
    a = []
    for (x, y), (u, v) in zip(src, dst):
        a.append([x, y, 1, 0, 0, 0, -u * x, -u * y, -u])
        a.append([0, 0, 0, x, y, 1, -v * x, -v * y, -v])
    _, _, vt = np.linalg.svd(np.array(a, float))
    h = vt[-1].reshape(3, 3)
    return h / h[2, 2]


def apply_h(h, pts):
    out = []
    for x, y in pts:
        u, v, w = h @ [x, y, 1]
        out.append((u / w, v / w))
    return out


def make_case(args):
    seed, fonts, size, jpeg, puzzle, turns = args
    rng = random.Random(seed)
    nrng = np.random.default_rng(seed)
    givens = random_grid(rng)
    if puzzle:
        givens = [int(ch) for ch in puzzle]
    paper, grid = render_paper(rng, givens, fonts, cell=rng.choice([48, 64, 80]))
    pw, ph = paper.size

    W, H = (size, size * 4 // 3) if rng.random() < 0.7 else (size * 4 // 3, size)
    side = rng.uniform(0.45, 0.92) * min(W, H)
    ang = math.radians(rng.uniform(-20, 20) if rng.random() < 0.85 else rng.uniform(-35, 35))
    cx = W / 2 + rng.uniform(-0.25, 0.25) * (W - side)
    cy = H / 2 + rng.uniform(-0.25, 0.25) * (H - side)
    quad = []
    for ux, uy in [(-1, -1), (1, -1), (1, 1), (-1, 1)]:
        x = ux * side / 2 + rng.uniform(-0.08, 0.08) * side
        y = uy * side / 2 + rng.uniform(-0.08, 0.08) * side
        quad.append((cx + x * math.cos(ang) - y * math.sin(ang), cy + x * math.sin(ang) + y * math.cos(ang)))
    # keep the grid inside the frame
    mx = min(min(p[0] for p in quad), min(p[1] for p in quad), W - max(p[0] for p in quad),
             H - max(p[1] for p in quad))
    if mx < 4:
        f = (side / 2 - (4 - mx)) / (side / 2)
        quad = [(cx + (x - cx) * f, cy + (y - cy) * f) for x, y in quad]

    h = homography(grid, quad)
    hinv = np.linalg.inv(h)
    hinv /= hinv[2, 2]
    warped = paper.transform((W, H), Image.PERSPECTIVE, tuple(hinv.flatten()[:8]), Image.BICUBIC)
    mask = Image.new("L", paper.size, 255).transform((W, H), Image.PERSPECTIVE, tuple(hinv.flatten()[:8]),
                                                   Image.BILINEAR)

    # background: gradient table with some blotches
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    b0, b1 = rng.uniform(30, 200), rng.uniform(30, 200)
    bg = b0 + (b1 - b0) * (xx * rng.uniform(-1, 1) + yy * rng.uniform(-1, 1)) / (W + H)
    bg = Image.fromarray(np.clip(bg, 0, 255).astype(np.uint8))
    bd = ImageDraw.Draw(bg)
    for _ in range(rng.randint(0, 6)):
        x, y = rng.uniform(0, W), rng.uniform(0, H)
        r = rng.uniform(10, 0.3 * W)
        bd.ellipse([x - r, y - r, x + r, y + r * rng.uniform(0.2, 1)], fill=rng.randint(10, 230))
    bg = bg.filter(ImageFilter.GaussianBlur(rng.uniform(2, 12)))
    img = Image.composite(warped, bg, mask)

    a = np.asarray(img, np.float32)
    # uneven light: linear gradient plus a soft shadow
    light = 1 + rng.uniform(-0.35, 0.15) * ((xx - W / 2) * math.cos(ang * 3) + (yy - H / 2) * math.sin(ang * 3)) / W
    if rng.random() < 0.5:
        sx, sy, sr = rng.uniform(0, W), rng.uniform(0, H), rng.uniform(0.2, 0.6) * W
        light *= 1 - rng.uniform(0.2, 0.55) * np.exp(-((xx - sx) ** 2 + (yy - sy) ** 2) / (2 * sr**2))
    a = a * light * rng.uniform(0.6, 1.1)
    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    blur = rng.uniform(0, 1.6) * size / 1200
    if blur > 0.3:
        img = img.filter(ImageFilter.GaussianBlur(blur))
    a = np.asarray(img, np.float32) + nrng.normal(0, rng.uniform(1, 7), (H, W))
    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "JPEG", quality=rng.randint(45, 92))
    data = buf.getvalue()
    gray = Image.open(io.BytesIO(data)).convert("L")
    if turns and rng.random() < 0.5:
        # photo taken sideways or upside down; the grid's top-left corner moves along
        k = rng.randint(1, 3)
        for _ in range(k):
            w0 = gray.width
            gray = gray.transpose(Image.ROTATE_90)
            quad = [(y, w0 - x) for x, y in quad]
        if jpeg:
            buf = io.BytesIO()
            Image.open(io.BytesIO(data)).rotate(90 * k, expand=True).save(buf, "JPEG", quality=90)
            data = buf.getvalue()
    return seed, givens, quad, gray, data if jpeg else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--n", type=int, default=50)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--fonts", default="test", choices=["train", "test", "all"])
    ap.add_argument("--size", type=int, default=1200)
    ap.add_argument("--jpeg", action="store_true")
    ap.add_argument("--puzzle", help="81 digits to print instead of random ones")
    ap.add_argument("--turns", action="store_true", help="turn half of the photos by 90, 180 or 270 degrees")
    a = ap.parse_args()
    stream = a.out == "-"
    if not stream:
        os.makedirs(a.out, exist_ok=True)
    fonts = font_files(a.fonts)
    if not fonts:
        raise SystemExit("no fonts found")
    cases = []
    jobs = [(a.seed * 100000 + k, fonts, a.size, a.jpeg, a.puzzle, a.turns) for k in range(a.n)]
    with ProcessPoolExecutor() as ex:
        for k, (seed, givens, quad, gray, jpg) in enumerate(ex.map(make_case, jobs, chunksize=4)):
            name = f"{k:04d}"
            w, h = gray.size
            case = {"name": name, "seed": seed, "givens": "".join(map(str, givens)),
                    "corners": [[round(x, 1), round(y, 1)] for x, y in quad]}
            if stream:
                sys.stdout.buffer.write((json.dumps({**case, "width": w, "height": h}) + "\n").encode())
                sys.stdout.buffer.write(gray.tobytes())
                continue
            with open(os.path.join(a.out, name + ".pgm"), "wb") as f:
                f.write(f"P5\n{w} {h}\n255\n".encode() + gray.tobytes())
            if jpg:
                with open(os.path.join(a.out, name + ".jpg"), "wb") as f:
                    f.write(jpg)
            cases.append(case)
    if stream:
        return
    with open(os.path.join(a.out, "cases.json"), "w") as f:
        json.dump(cases, f, indent=0)
    print(f"{len(cases)} cases, {len(fonts)} fonts -> {a.out}")


if __name__ == "__main__":
    main()
