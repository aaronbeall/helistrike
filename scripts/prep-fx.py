#!/usr/bin/env python3
"""Knock out black backgrounds and shrink generated FX sprites."""

from pathlib import Path

from PIL import Image

SRC = Path(
    "/Users/abeall/.cursor/projects/Users-abeall-Development-github-aaronbeall-abeall-com/assets"
)
DST = Path("/Users/abeall/Development/github/aaronbeall/helistrike/public/sprites")

JOBS = [
    ("helistrike-fx-spark.png", 0.55),
    ("helistrike-fx-flame.png", 0.5),
    ("helistrike-fx-smoke.png", 0.42),
    ("helistrike-fx-muzzle.png", 0.5),
    ("helistrike-fx-dirt.png", 0.48),
    ("helistrike-fx-splash.png", 0.52),
]


def knockout(im: Image.Image, gamma: float) -> Image.Image:
    im = im.convert("RGBA").resize((192, 192), Image.Resampling.LANCZOS)
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, _a = px[x, y]
            luma = 0.3 * r + 0.59 * g + 0.11 * b
            peak = max(r, g, b)
            val = max(luma, peak * 0.82)
            if val < 9:
                a = 0
            else:
                t = min(1.0, (val - 8.0) / 170.0)
                a = int(min(255, (t**gamma) * 255))
            if a < 8:
                px[x, y] = (0, 0, 0, 0)
            else:
                px[x, y] = (r, g, b, a)
    return trim(im)


def trim(im: Image.Image, pad: int = 6) -> Image.Image:
    bbox = im.getbbox()
    if not bbox:
        return im
    l, t, r, b = bbox
    l = max(0, l - pad)
    t = max(0, t - pad)
    r = min(im.width, r + pad)
    b = min(im.height, b + pad)
    return im.crop((l, t, r, b))


def main() -> None:
    DST.mkdir(parents=True, exist_ok=True)
    for name, gamma in JOBS:
        out = knockout(Image.open(SRC / name), gamma)
        dest = DST / name
        out.save(dest, "PNG", optimize=True)
        print(f"{name} -> {out.size} {dest.stat().st_size} bytes")


if __name__ == "__main__":
    main()
