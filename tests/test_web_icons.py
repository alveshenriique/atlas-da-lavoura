"""The committed site icons must match what identity.py generates (drift check)."""

import importlib.util
import io
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "make_web_icons.py"
HINT = "run `uv run python scripts/make_web_icons.py`"


def load_generator():
    spec = importlib.util.spec_from_file_location("make_web_icons", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def pixels(data: bytes) -> np.ndarray:
    return np.asarray(Image.open(io.BytesIO(data)).convert("RGBA"))


def test_favicon_svg_matches_identity():
    generator = load_generator()
    assert generator.SVG_PATH.read_text(encoding="utf-8") == generator.render_svg(), (
        f"web/public/favicon.svg drifted; {HINT}"
    )


def test_bitmap_icons_match_identity():
    generator = load_generator()
    # Pixels, not bytes: the encoder's metadata may change between Pillow versions.
    for path, render, size in (
        (generator.ICO_PATH, generator.render_ico, 32),
        (generator.APPLE_PATH, generator.render_apple, 180),
    ):
        committed = pixels(path.read_bytes())
        assert committed.shape[:2] == (size, size), path.name
        assert np.array_equal(committed, pixels(render())), f"{path.name} drifted; {HINT}"


def test_svg_has_every_colour_of_both_variants():
    from atlas_da_lavoura.viz import identity

    svg = load_generator().render_svg()
    for colours in identity.ICON.values():
        for value in colours.values():
            assert value in svg, value
    assert "prefers-color-scheme:dark" in svg
