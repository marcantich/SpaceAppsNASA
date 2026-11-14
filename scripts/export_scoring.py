"""Reescribe la parte de PUNTUACIÓN de app/data/tierra/match.json (notas, dimensiones, pruebas) desde
configs/variables.yaml y configs/pruebas.yaml, sin volver a construir la malla ni tocar match.bin.gz.

Úsalo después de cambiar un half_diff, una matriz, una dimensión o los pesos de una prueba:

    python scripts/export_scoring.py

La web (app/src/scoring.js) lee esos bloques al cargar: basta con recargar la página.
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
print(f"{path.relative_to(ROOT)}: {len(v)} variables en {len(meta['dimensions'])} dimensiones, "
      f"{len(meta['pruebas'])} pruebas, area_weight {meta['area_weight']}")
for k, s in v.items():
    how = "matriz de clases" if "matrix" in s else f"half_diff {s['half_diff']}" if "half_diff" in s else f"lineal {s['tolerance']}"
    print(f"  {k:18s} {s['dimension']:12s} {how}")
