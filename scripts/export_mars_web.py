"""Export the Mars card grid for the web app (ROADMAP 3.16, Mars part).

    python scripts/build_mars_grid.py     # first, once (~18 min)
    python scripts/export_mars_web.py     # ~1 min

Reads data/processed/mars_h3r5.parquet and fichas_objetivos_mars.parquet and writes
app/data/marte/ (index.json + one compressed binary per H3 region + objetivos.json with the
real cards of the Mars target sites). Format: docs/07_card_grid_binary_format.md.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import pandas as pd  # noqa: E402

from analogs.config import load_variables  # noqa: E402
from analogs.export import (MARS_DISPLAY, MARS_SOURCES, MARS_WEB_COLUMNS,  # noqa: E402
                            write_grid_binary, write_mars_targets)
from analogs.mars_climate import CLIMATE_COLUMNS, add_mars_climate, cell_latlon  # noqa: E402
from analogs.paths import APP_DATA, PROCESSED  # noqa: E402


def main() -> None:
    from_grid = [c for c in MARS_WEB_COLUMNS if c not in CLIMATE_COLUMNS]
    df = pd.read_parquet(PROCESSED / "mars_h3r5.parquet", columns=["h3", *from_grid])
    # solar energy and mean wind: computed here (analogs.mars_climate), not stored in the grid
    lat, lon = cell_latlon(df["h3"])
    df = add_mars_climate(df, lat, lon)
    for c in CLIMATE_COLUMNS:
        v = df[c]
        print(f"  {c}: {v.notna().mean():.1%} of cells, {v.min():.2f}–{v.max():.2f} (median {v.median():.2f})")
    index = write_grid_binary(df, "marte", MARS_WEB_COLUMNS, MARS_SOURCES, MARS_DISPLAY,
                              extra={"cell_size_km": 9.1})       # H3 res 5 on Mars (~9.1 km across)
    sizes = [r["bytes"] for r in index["regions"].values()]
    print(f"app/data/marte/: {len(sizes)} regions, {index['n_cells']:,} cells, "
          f"{sum(sizes) / 1e6:.1f} MB total, {min(sizes) / 1e3:.0f}–{max(sizes) / 1e3:.0f} KB per region")
    targets = pd.read_parquet(PROCESSED / "fichas_objetivos_mars.parquet")
    targets = add_mars_climate(targets, targets["lat"].to_numpy(float), targets["lon"].to_numpy(float))
    write_mars_targets(targets, load_variables())
    print(f"{APP_DATA / 'marte' / 'objetivos.json'}: real cards of the Mars target sites")


if __name__ == "__main__":
    main()
