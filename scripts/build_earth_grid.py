"""Earth card grid on H3 + binary for the web (the equivalent of build_mars_grid.py +
export_mars_web.py for Mars).

    .venv\\Scripts\\python.exe scripts\\build_earth_grid.py               # res 6 (~6.5 km, the closest to Mars)
    .venv\\Scripts\\python.exe scripts\\build_earth_grid.py --res 5       # res 5 (~17 km, 7 times fewer cells)
    .venv\\Scripts\\python.exe scripts\\build_earth_grid.py --no-web      # only the parquet

First: download_earth.py (data) and build_earth_mask.py (mask).
Writes:
  <DATA>/processed/earth_h3r<res>.parquet    one row per H3 cell of the whole planet (sea = NaN)
  app/data/tierra/index.json + rNNN.bin.gz    binary format of docs/07_card_grid_binary_format.md
and checks the binary with scripts/check_grid_binary.py.
"""
import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from analogs.earth_grid import (EARTH_CELL_SIZE_KM, EARTH_DISPLAY, EARTH_WEB_COLUMNS, add_permafrost,  # noqa: E402
                                build_earth_grid, earth_sources, write_match_table)
from analogs.export import write_grid_binary  # noqa: E402
from analogs.paths import APP_DATA, PROCESSED  # noqa: E402

RELIEF_15S = "NOAA ETOPO 2022 15″ (~460 m pixels, same as MGS MOLA 128 px/deg and LRO LOLA ldem_64)"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--res", type=int, default=6, help="H3 resolution (6 ≈ 6.5 km; 5 ≈ 17 km)")
    ap.add_argument("--no-web", action="store_true", help="do not write app/data/tierra/")
    ap.add_argument("--permafrost-only", "--solo-permafrost", dest="permafrost_only", action="store_true",
                    help="permafrost only: adds ice_depth_m to the existing parquet and rewrites the binary (~5 min)")
    ap.add_argument("--web-only", "--solo-web", dest="web_only", action="store_true",
                    help="web only: rewrites app/data/tierra/ from the existing parquet (~3 min)")
    args = ap.parse_args()

    if args.permafrost_only:
        df = add_permafrost(args.res)
        relief_source = RELIEF_15S
    elif args.web_only:
        df = pd.read_parquet(PROCESSED / f"earth_h3r{args.res}.parquet")
        relief_source = RELIEF_15S
        if "ice_depth_source" not in df:          # parquets made before the column was added
            cont = df["ice_depth_cont_m"].to_numpy()
            src = np.where(cont >= 10, 3.0, 2.0)
            src[(cont == 0) & (df["env"].to_numpy() == 1)] = 1.0
            src[~np.isfinite(cont)] = np.nan
            df["ice_depth_source"] = src.astype("f4")
            df.to_parquet(PROCESSED / f"earth_h3r{args.res}.parquet", index=False)
    else:
        df, relief_source = build_earth_grid(args.res)
    land = df[df.land_frac > 0]
    print(f"\nCells: {len(df):,} in total · {len(land):,} with land · {int((land.in_mask == 1).sum()):,} in the mask")
    print(land.drop(columns=["h3"]).describe(percentiles=[.05, .5, .95]).T[["count", "min", "5%", "50%", "95%", "max"]]
          .round(2).to_string())
    if args.no_web:
        return
    index = write_grid_binary(df, "tierra", EARTH_WEB_COLUMNS, earth_sources(relief_source), EARTH_DISPLAY,
                              extra={"cell_size_km": EARTH_CELL_SIZE_KM.get(args.res)})
    write_match_table(df)
    total = sum(r["bytes"] for r in index["regions"].values())
    print(f"\napp/data/tierra/: {len(index['regions'])} regions, {total / 1e6:.1f} MB "
          f"(mean {total / len(index['regions']) / 1e3:.0f} KB per region) → {APP_DATA / 'tierra'}")
    subprocess.run([sys.executable, str(ROOT / "scripts" / "check_grid_binary.py"), "tierra",
                    str(PROCESSED / f"earth_h3r{args.res}.parquet")], check=False)


if __name__ == "__main__":
    main()
