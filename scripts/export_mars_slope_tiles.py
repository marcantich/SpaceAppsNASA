"""Pixel-level Mars slope tiles for the web app (ROADMAP 5.6): app/data/marte/slope64/.

    python scripts/export_mars_slope_tiles.py      # ~5 min; needs the 16 MOLA 128 ppd tiles

Method and format: src/analogs/mars_slope_tiles.py.
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from analogs.mars_slope_tiles import build  # noqa: E402

t0 = time.time()
idx = build(progress=lambda m: print(f"  [{time.time() - t0:5.0f} s] {m}", flush=True))
print(f"app/data/marte/slope64/: {idx['n_files']} tiles, {idx['bytes'] / 1e6:.1f} MB, "
      f"{idx['measured_frac']:.0%} of the pixels measured by the laser, {time.time() - t0:.0f} s")
