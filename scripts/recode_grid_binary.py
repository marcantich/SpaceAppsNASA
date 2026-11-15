"""Rewrites an ALREADY PUBLISHED web binary (app/data/<body>/) with another column definition, without
needing the original parquet (it rebuilds it by decoding the .bin.gz files themselves).

    .venv\\Scripts\\python.exe scripts\\recode_grid_binary.py luna

Current use: the Moon binary changes ice_depth_m from continuous metres to the SAME classes as Mars
and Earth (0.5 / 3 / 5 / 10, export.ice_depth_class) and keeps the metres in ice_depth_cont_m.
The other values are decoded and encoded again with the same scale: they stay identical.
"""
import gzip
import json
import sys
from pathlib import Path

import h3.api.basic_int as h3i
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from analogs.export import (MOON_DISPLAY, MOON_SOURCES, MOON_WEB_COLUMNS, ice_depth_class,  # noqa: E402
                            write_grid_binary)
from analogs.paths import APP_DATA  # noqa: E402


def decode(body: str) -> tuple[pd.DataFrame, dict]:
    folder = APP_DATA / body
    idx = json.loads((folder / "index.json").read_text(encoding="utf-8"))
    res0 = {h3i.get_base_cell_number(c): c for c in h3i.get_res0_cells()}
    parts = []
    for r, meta in idx["regions"].items():
        raw = gzip.decompress((folder / meta["file"]).read_bytes())
        cells = sorted(h3i.cell_to_children(res0[int(r)], idx["h3_resolution"]))
        n, off, cols = meta["n_cells"], 0, {}
        assert len(cells) == n
        for c in idx["columns"]:
            size = 1 if c["dtype"] == "u1" else 2
            q = np.frombuffer(raw[off:off + n * size], dtype="<u1" if size == 1 else "<u2").astype(float)
            off += n * size
            q[q == (255 if size == 1 else 65535)] = np.nan
            cols[c["name"]] = q * c["scale"] + c["offset"]
        parts.append(pd.DataFrame({"h3": [h3i.int_to_str(c) for c in cells], **cols}))
    return pd.concat(parts, ignore_index=True), idx


def main(body: str) -> None:
    if body != "luna":
        raise SystemExit("For now only: luna")
    df, idx = decode(body)
    if "ice_depth_cont_m" not in df:                     # still in metres → convert to classes
        df["ice_depth_cont_m"] = df["ice_depth_m"]
        df["ice_depth_m"] = ice_depth_class(df["ice_depth_cont_m"])
    extra = {k: idx[k] for k in ("cell_size_km",) if k in idx}
    write_grid_binary(df, body, MOON_WEB_COLUMNS, MOON_SOURCES, MOON_DISPLAY, extra=extra)
    land = df["ice_depth_m"].value_counts(dropna=False).sort_index()
    print(f"{body}: {len(df):,} cells rewritten · ice classes: {land.to_dict()}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "luna")
