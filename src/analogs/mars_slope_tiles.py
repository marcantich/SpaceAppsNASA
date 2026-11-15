"""Pixel-level slope of Mars for the web app (ROADMAP 5.6): "data tiles" read on click.

The card grid gives one value per ~9 km H3 cell (the scale of the index). These tiles add the slope AT
THE CLICKED POINT, at ~0.93 km, so the card can show local detail without changing the index.

    python scripts/export_mars_slope_tiles.py      # ~5 min, writes app/data/marte/slope64/

Method (same as the grid, src/analogs/mars_grid.py):
  * MOLA MEGDR 128 px/deg tiles (~463 m), central differences with the true metric spacing per latitude
    → slope at every 128 ppd pixel (≈ 0.9 km baseline).
  * 2 × 2 blocks → 64 px/deg (~925 m): MEDIAN of the 4 slopes (mean of the middle two), and
    "measured" = at least one of the 4 pixels has a MOLA laser shot (megc > 0). Near the equator most
    128 ppd pixels are interpolated between ground tracks, so 64 ppd is close to the real detail of MOLA.
  * Beyond ±87° MGS never flew: no data (as in the grid). The 128 ppd tiles stop at ±88°.
Why not 128 ppd: ~384 MB compressed for the whole planet (measured), too much for the repository and
GitHub Pages; 64 ppd is 120.8 MB (648 tiles; 60 % of the pixels measured by the laser), and only the tile around the click is downloaded (~100–250 KB).

Web format (app/data/marte/slope64/):
  index.json                 ppd, tile size, encoding, source
  t{row:02d}_{col:02d}.bin.gz  10° × 10° tile, 640 × 640 bytes, row-major from the NORTH-WEST corner;
                             row = (80 − lat_top) / 10 → 0 for 80–90°N … 17 for 80–90°S;
                             col = (lon_west + 180) / 10 → 0 for 180–170°W … 35 for 170–180°E
  byte: bits 0–6 = slope / 0.5° (0–63.0°, 127 = no data), bit 7 = 1 if measured by the laser.
Planetocentric latitude, east longitude −180…180 (as the rest of the Mars data).
"""
from __future__ import annotations

import gzip
import json

import numpy as np

from .download import MOLA128_ALL_TILES
from .paths import APP_DATA, RAW

PPD_IN = 128
PPD = 64
TILE_DEG = 10
STEP = 0.5            # degrees of slope per stored unit
NODATA = 127
MAX_LAT = 87.0        # MGS ground tracks stop at ~87° (no laser beyond)
MARS_RADIUS_M = 3_396_190.0
OUT = APP_DATA / "marte" / "slope64"


def _label(path) -> dict:
    out = {}
    for line in path.read_text(errors="replace").splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"')
    return out


def _tile_to_global(stem: str, glob: np.ndarray, chunk: int = 512) -> None:
    """Slope of one 128 ppd MEGDR tile, reduced to 64 ppd, written into the global array
    glob[row from 90°N, col from 180°W]."""
    d = RAW / "mars" / "mola_megdr_128ppd"
    lab = _label(d / f"megt{stem}hb.lbl")
    lines, samples = int(lab["LINES"]), int(lab["LINE_SAMPLES"])
    max_lat = float(lab["MAXIMUM_LATITUDE"].split()[0])
    west = float(lab["WESTERNMOST_LONGITUDE"].split()[0])
    topo = np.memmap(d / f"megt{stem}hb.img", dtype=">i2", mode="r", shape=(lines, samples))
    counts = np.memmap(d / f"megc{stem}hb.img", dtype=">u1", mode="r", shape=(lines, samples))
    lat_rows = max_lat - (np.arange(lines) + 0.5) / PPD_IN
    step = np.deg2rad(1 / PPD_IN) * MARS_RADIUS_M

    # destination: 64 ppd rows from 90°N, cols from 180°W (east longitude 0–360 → −180…180)
    g_row0 = int(round((90 - max_lat) * PPD))
    lon_w = west if west < 180 else west - 360
    g_col0 = int(round((lon_w + 180) * PPD))
    for r0 in range(0, lines, chunk):
        r1 = min(lines, r0 + chunk)
        h0, h1 = max(0, r0 - 1), min(lines, r1 + 1)
        z = topo[h0:h1].astype(np.float64)
        lat_h = lat_rows[h0:h1]
        gy = -np.gradient(z, axis=0) / step
        gx = np.gradient(z, axis=1) / (step * np.cos(np.deg2rad(lat_h)))[:, None]
        cut = slice(r0 - h0, r0 - h0 + (r1 - r0))
        s = np.degrees(np.arctan(np.hypot(gx[cut], gy[cut])))            # [r1-r0, samples]
        m = np.asarray(counts[r0:r1]) > 0
        n_r, n_c = (r1 - r0) // 2, samples // 2
        blocks = s.reshape(n_r, 2, n_c, 2).transpose(0, 2, 1, 3).reshape(n_r, n_c, 4)
        blocks.sort(axis=2)
        med = 0.5 * (blocks[..., 1] + blocks[..., 2])
        meas = m.reshape(n_r, 2, n_c, 2).any(axis=(1, 3))
        q = np.clip(np.round(med / STEP), 0, NODATA - 1).astype(np.uint8)
        q |= (meas.astype(np.uint8) << 7)
        lat64 = max_lat - (r0 // 2 + np.arange(n_r) + 0.5) / PPD
        q[np.abs(lat64) > MAX_LAT] = NODATA
        glob[g_row0 + r0 // 2: g_row0 + r0 // 2 + n_r, g_col0: g_col0 + n_c] = q


def build(progress=print) -> dict:
    glob = np.full((180 * PPD, 360 * PPD), NODATA, dtype=np.uint8)
    for i, stem in enumerate(MOLA128_ALL_TILES, 1):
        progress(f"MOLA tile {stem} ({i}/{len(MOLA128_ALL_TILES)})")
        _tile_to_global(stem, glob)
    OUT.mkdir(parents=True, exist_ok=True)
    n = TILE_DEG * PPD
    total, files = 0, 0
    for row in range(180 // TILE_DEG):
        for col in range(360 // TILE_DEG):
            t = glob[row * n:(row + 1) * n, col * n:(col + 1) * n]
            if (t == NODATA).all():
                continue
            blob = gzip.compress(np.ascontiguousarray(t).tobytes(), compresslevel=9, mtime=0)
            (OUT / f"t{row:02d}_{col:02d}.bin.gz").write_bytes(blob)
            total += len(blob)
            files += 1
    valid = (glob & 0x7F) != NODATA
    index = {
        "body": "marte",
        "variable": "slope_deg",
        "ppd": PPD,
        "tile_deg": TILE_DEG,
        "tile_px": n,
        "file": "t{row:02d}_{col:02d}.bin.gz",
        "row": "floor((90 - lat) / tile_deg), 0 = 80–90°N",
        "col": "floor((lon + 180) / tile_deg), 0 = 180–170°W",
        "pixel": "row-major from the north-west corner of the tile, ppd pixels per degree",
        "encoding": "gzip; one byte per pixel: bits 0-6 = slope / 0.5 deg (127 = no data), "
                    "bit 7 = 1 if at least one of the 2x2 MOLA 128 ppd pixels has a laser shot",
        "step_deg": STEP,
        "nodata": NODATA,
        "source": "MGS MOLA MEGDR 128 px/deg (PDS Geosciences): slope by central differences "
                  "(~0.9 km baseline), median of 2x2 pixels → 64 px/deg (~925 m); no data beyond ±87°",
        "short_source": "MOLA",
        "n_files": files,
        "bytes": total,
        "measured_frac": float(((glob >> 7) & 1)[valid].mean()),
    }
    (OUT / "index.json").write_text(json.dumps(index, indent=1), encoding="utf-8")
    return index
