"""Earth cards with every available variable, at two resolutions:

    .venv\\Scripts\\python.exe scripts\\build_earth_mask.py        # first (once)
    .venv\\Scripts\\python.exe scripts\\build_earth_features.py

Output (data/processed/):
  fichas_tierra_005deg.parquet   one row per 0.05° PIXEL (~5.6 km): the finest, for searching
  fichas_tierra_h3r5.parquet     one row per H3 res-5 hexagon (~17 km): lighter
It uses whatever is downloaded: if a product is missing, its column stays empty and a warning is shown.
"""
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from analogs.earth import build_earth_cells, build_earth_pixels, compute_fields, load_mask  # noqa: E402
from analogs.paths import PROCESSED  # noqa: E402


def report(df, name: str, unit: str) -> None:
    print(f"\n{PROCESSED / name}: {len(df):,} {unit}, {int(df.in_mask.sum()):,} inside the mask")
    num = df.select_dtypes("number").drop(columns=["env", "pixel"], errors="ignore")
    print(num.describe(percentiles=[0.05, 0.5, 0.95]).T[["count", "min", "5%", "50%", "95%", "max"]].round(1).to_string())


if __name__ == "__main__":
    m = load_mask()
    fields = compute_fields(m)
    report(build_earth_pixels(fields, m), "fichas_tierra_005deg.parquet", "pixels of 0.05°")
    report(build_earth_cells(fields, m), "fichas_tierra_h3r5.parquet", "H3 res-5 hexagons")
