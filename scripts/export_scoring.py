"""Rewrites the SCORING part of app/data/tierra/match.json (notes, dimensions, tests) from
configs/variables.yaml and configs/pruebas.yaml, without rebuilding the grid or touching match.bin.gz.

Use it after changing a half_diff, a matrix, a dimension or the weights of a test:

    python scripts/export_scoring.py

The web app (app/src/scoring.js) reads those blocks when it loads: just reload the page.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from analogs.earth_grid import match_scoring_meta  # noqa: E402
from analogs.paths import APP_DATA  # noqa: E402

path = APP_DATA / "tierra" / "match.json"
meta = json.loads(path.read_text(encoding="utf-8"))
meta.update(match_scoring_meta())
path.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
v = meta["variables"]
print(f"{path.relative_to(ROOT)}: {len(v)} variables in {len(meta['dimensions'])} dimensions, "
      f"{len(meta['pruebas'])} tests, area_weight {meta['area_weight']}")
for k, s in v.items():
    how = "class matrix" if "matrix" in s else f"half_diff {s['half_diff']}" if "half_diff" in s else f"linear {s['tolerance']}"
    print(f"  {k:18s} {s['dimension']:12s} {how}")
