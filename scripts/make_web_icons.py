"""Generate the site icon ("abaixo da tendência") from the visual identity.

The drawing comes from the chart of the finding: bars around a baseline, the drought one
below it. It is laid out on a 64 × 64 grid with rounded corners (radius 14):
- the large version (from 32 px): four bars over a thin grey baseline, the third one, in the
  drought colour, going below it;
- the small version (16 px): three wider bars, the third one going below the middle, with no
  baseline.
Colours come from identity.ICON, one variant per browser theme (the dark one swaps them).

Writes:
- web/public/favicon.svg: both versions and both variants; CSS inside the SVG picks the small
  version at 24 px or less and the dark variant under prefers-color-scheme;
- web/public/favicon.ico: the large light version at 32 px, for browsers without SVG icons;
- web/public/apple-touch-icon.png: the large light version at 180 px, square (iOS rounds the
  corners itself).
The files are committed; tests/test_web_icons.py fails when they drift from identity.py.
Regenerate with:
    uv run python scripts/make_web_icons.py
"""

from __future__ import annotations

import io
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from atlas_da_lavoura.viz import identity as vi  # noqa: E402

PUBLIC = ROOT / "web" / "public"
SVG_PATH = PUBLIC / "favicon.svg"
ICO_PATH = PUBLIC / "favicon.ico"
APPLE_PATH = PUBLIC / "apple-touch-icon.png"

GRID = 64
RADIUS = 14
# Below this size (CSS px of the SVG's viewport) the small version is drawn.
SMALL_UP_TO_PX = 24

# Bars as (x, top, width, height, kind) on the grid; kind "bar" or "dry".
BASELINE_Y = 36
LARGE_BASELINE = (10, 54, 1.5)  # from x, to x, stroke width
LARGE_BARS = (
    (12, 22, 7, 14, "bar"),
    (23, 16, 7, 20, "bar"),
    (34, 36, 7, 14, "dry"),
    (45, 12, 7, 24, "bar"),
)
SMALL_BARS = (
    (6, 18, 14, 14, "bar"),
    (25, 10, 14, 22, "bar"),
    (44, 32, 14, 18, "dry"),
)


def _paths(bars: tuple) -> str:
    """One path per colour (fewer bytes than a rect per bar): "bar" (b) and "dry" (d)."""
    out = ""
    for kind, cls in (("bar", "b"), ("dry", "d")):
        d = "".join(f"M{x} {y}h{w}v{h}h-{w}z" for x, y, w, h, k in bars if k == kind)
        out += f'<path class="{cls}" d="{d}"/>'
    return out


def render_svg() -> str:
    """Classes: g background, b bars, d drought bar, l baseline, L large and S small version."""
    light, dark = vi.ICON["light"], vi.ICON["dark"]
    x0, x1, stroke = LARGE_BASELINE

    def colours(c: dict) -> str:
        return (
            f".g{{fill:{c['background']}}}.b{{fill:{c['bar']}}}"
            f".d{{fill:{c['dry']}}}.l{{stroke:{c['baseline']}}}"
        )

    style = (
        f"{colours(light)}.S{{display:none}}"
        f"@media (max-width:{SMALL_UP_TO_PX}px){{.L{{display:none}}.S{{display:inline}}}}"
        f"@media (prefers-color-scheme:dark){{{colours(dark)}}}"
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {GRID} {GRID}">'
        f"<style>{style}</style>"
        f'<rect class="g" width="{GRID}" height="{GRID}" rx="{RADIUS}"/>'
        f'<g class="L"><path class="l" d="M{x0} {BASELINE_Y}H{x1}" stroke-width="{stroke}"/>'
        f"{_paths(LARGE_BARS)}</g>"
        f'<g class="S">{_paths(SMALL_BARS)}</g>'
        "</svg>\n"
    )


def render_png(size: int, rounded: bool) -> Image.Image:
    """The large light version, drawn 8 times larger and scaled down (antialiased edges)."""
    colours = vi.ICON["light"]
    k = size * 8 / GRID
    big = Image.new("RGBA", (size * 8, size * 8), (0, 0, 0, 0))
    draw = ImageDraw.Draw(big)
    box = (0, 0, size * 8 - 1, size * 8 - 1)
    if rounded:
        draw.rounded_rectangle(box, radius=round(RADIUS * k), fill=colours["background"])
    else:
        draw.rectangle(box, fill=colours["background"])
    x0, x1, stroke = LARGE_BASELINE
    half = stroke * k / 2
    draw.rectangle(
        (x0 * k, BASELINE_Y * k - half, x1 * k, BASELINE_Y * k + half), fill=colours["baseline"]
    )
    for x, y, w, h, kind in LARGE_BARS:
        draw.rectangle((x * k, y * k, (x + w) * k - 1, (y + h) * k - 1), fill=colours[kind])
    return big.resize((size, size), Image.Resampling.LANCZOS)


def render_ico() -> bytes:
    out = io.BytesIO()
    render_png(32, rounded=True).save(out, format="ICO", sizes=[(32, 32)])
    return out.getvalue()


def render_apple() -> bytes:
    out = io.BytesIO()
    render_png(180, rounded=False).convert("RGB").save(out, format="PNG", optimize=True)
    return out.getvalue()


def main() -> None:
    SVG_PATH.write_text(render_svg(), encoding="utf-8")
    ICO_PATH.write_bytes(render_ico())
    APPLE_PATH.write_bytes(render_apple())
    for path in (SVG_PATH, ICO_PATH, APPLE_PATH):
        print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
