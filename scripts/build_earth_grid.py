"""Malla de fichas de la Tierra en H3 + binario para la web (equivalente a build_mars_grid.py +
export_mars_web.py de Marte).

    .venv\\Scripts\\python.exe scripts\\build_earth_grid.py               # res 6 (~6,5 km, la más parecida a Marte)
    .venv\\Scripts\\python.exe scripts\\build_earth_grid.py --res 5       # res 5 (~17 km, 7 veces menos celdas)
    .venv\\Scripts\\python.exe scripts\\build_earth_grid.py --no-web      # solo el parquet

Antes: download_earth.py (datos) y build_earth_mask.py (máscara).
Escribe:
  <DATA>/processed/earth_h3r<res>.parquet    una fila por celda H3 de todo el planeta (mar = NaN)
  app/data/tierra/index.json + rNNN.bin.gz    formato binario de docs/07_card_grid_binary_format.md
y comprueba el binario con scripts/check_grid_binary.py.
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
    ap.add_argument("--res", type=int, default=6, help="resolución H3 (6 ≈ 6,5 km; 5 ≈ 17 km)")
    ap.add_argument("--no-web", action="store_true", help="no escribir app/data/tierra/")
    ap.add_argument("--solo-permafrost", action="store_true",
                    help="no recalcula todo: añade ice_depth_m al parquet ya hecho y rehace el binario (~5 min)")
    ap.add_argument("--solo-web", action="store_true",
                    help="no recalcula nada: rehace app/data/tierra/ desde el parquet ya hecho (~3 min)")
    args = ap.parse_args()

    if args.solo_permafrost:
        df = add_permafrost(args.res)
        relief_source = RELIEF_15S
    elif args.solo_web:
        df = pd.read_parquet(PROCESSED / f"earth_h3r{args.res}.parquet")
        relief_source = RELIEF_15S
        if "ice_depth_source" not in df:          # parquets hechos antes de añadir la columna
            cont = df["ice_depth_cont_m"].to_numpy()
            src = np.where(cont >= 10, 3.0, 2.0)
            src[(cont == 0) & (df["env"].to_numpy() == 1)] = 1.0
            src[~np.isfinite(cont)] = np.nan
            df["ice_depth_source"] = src.astype("f4")
            df.to_parquet(PROCESSED / f"earth_h3r{args.res}.parquet", index=False)
    else:
        df, relief_source = build_earth_grid(args.res)
    land = df[df.land_frac > 0]
    print(f"\nCeldas: {len(df):,} en total · {len(land):,} con tierra · {int((land.in_mask == 1).sum()):,} en la máscara")
    print(land.drop(columns=["h3"]).describe(percentiles=[.05, .5, .95]).T[["count", "min", "5%", "50%", "95%", "max"]]
          .round(2).to_string())
    if args.no_web:
        return
    index = write_grid_binary(df, "tierra", EARTH_WEB_COLUMNS, earth_sources(relief_source), EARTH_DISPLAY,
                              extra={"cell_size_km": EARTH_CELL_SIZE_KM.get(args.res)})
    write_match_table(df)
    total = sum(r["bytes"] for r in index["regions"].values())
    print(f"\napp/data/tierra/: {len(index['regions'])} regiones, {total / 1e6:.1f} MB "
          f"(media {total / len(index['regions']) / 1e3:.0f} KB por región) → {APP_DATA / 'tierra'}")
    subprocess.run([sys.executable, str(ROOT / "scripts" / "check_grid_binary.py"), "tierra",
                    str(PROCESSED / f"earth_h3r{args.res}.parquet")], check=False)


if __name__ == "__main__":
    main()
