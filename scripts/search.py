"""Search tool in the terminal: type some conditions and it tells you which Earth sites resemble them most.

    .venv\\Scripts\\python.exe scripts\\search.py                  # 0.05° pixels (~5.6 km), the finest
    .venv\\Scripts\\python.exe scripts\\search.py --grid h3r5      # ~17 km hexagons, faster

Useful to check that the data are handled properly WITHOUT the app:
  [1] Type values by hand            (e.g. slope 3°, mean temperature 250 K, rain 0)
  [2] Similar to a point of Earth    (lat, lon) → do sites of the same kind come out?
  [3] Similar to a Moon or Mars site (when their cards exist)
  [4] Statistics of a variable
  [5] Which data there are (summary)

Formula: the engine's (src/analogs/similarity.py) with the tolerances of configs/variables.yaml.
Reads: data/processed/fichas_tierra_h3r5.parquet (scripts/build_earth_features.py)
       data/processed/fichas_objetivos_*.parquet   (Moon / Mars, if they exist)
"""
import datetime as dt
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from analogs.paths import CONFIGS, PROCESSED, VALIDATION  # noqa: E402
from analogs.similarity import analog_index, dimensions_of, variable_scores  # noqa: E402

GRIDS = {  # grid name → (file, what each row is called)
    "005deg": ("fichas_tierra_005deg.parquet", "pixels of 0.05° (~5.6 km)"),
    "h3r5": ("fichas_tierra_h3r5.parquet", "H3 res-5 hexagons (~17 km)"),
}
GRID = "005deg"
for flag in ("--grid", "--malla"):  # python scripts/search.py --grid h3r5  (--malla: old name)
    if flag in sys.argv:
        GRID = sys.argv[sys.argv.index(flag) + 1]
EARTH_FILE = PROCESSED / GRIDS[GRID][0]
UNIT_NAME = GRIDS[GRID][1]
ENVS = {"1": "polar ice", "2": "desert (bare ground)", "3": "arid open land (shrubland / steppe)"}


# ------------------------------------------------------------------ keyboard input
def ask(prompt: str, default: str = "") -> str:
    try:
        r = input(prompt).replace("﻿", "").strip()   # PowerShell adds a BOM when piping text
    except EOFError:
        print()
        raise SystemExit(0)
    return r or default


def ask_float(prompt: str, unit: str = "") -> float | None:
    while True:
        r = ask(prompt).replace(",", ".").lower()
        if r == "":
            return None
        try:
            if unit == "K" and r.endswith("c"):          # °C is accepted: "-20c"
                return float(r[:-1].replace("°", "")) + 273.15
            return float(r)
        except ValueError:
            print("   (type a number, or Enter to leave this variable out)")


# ------------------------------------------------------------------ data
def load() -> tuple[pd.DataFrame, dict, dict, pd.DataFrame]:
    if not EARTH_FILE.exists():
        raise SystemExit(f"{EARTH_FILE} does not exist.\nRun first (one line each):\n"
                         f"   .venv\\Scripts\\python.exe scripts\\build_earth_mask.py\n"
                         f"   .venv\\Scripts\\python.exe scripts\\build_earth_features.py")
    earth = pd.read_parquet(EARTH_FILE)
    variables = yaml.safe_load((CONFIGS / "variables.yaml").read_text(encoding="utf-8"))["variables"]
    pruebas = yaml.safe_load((CONFIGS / "pruebas.yaml").read_text(encoding="utf-8"))["pruebas"]
    targets = [pd.read_parquet(f) for f in sorted(PROCESSED.glob("fichas_objetivos_*.parquet"))]
    targets = pd.concat(targets, ignore_index=True) if targets else pd.DataFrame()
    return earth, variables, pruebas, targets


def usable_vars(earth: pd.DataFrame, variables: dict) -> list[str]:
    """Variables of variables.yaml that exist on Earth with some data."""
    return [v for v in variables if v in earth.columns and earth[v].notna().any()]


def summary(earth: pd.DataFrame, variables: dict, targets: pd.DataFrame) -> None:
    m = earth[earth.in_mask]
    print(f"\n=== DATA LOADED ===\nEarth: {len(earth):,} {UNIT_NAME} with land · "
          f"{len(m):,} inside the mask (deserts, ice, arid zones)")
    for k, name in ENVS.items():
        print(f"   {name:36s} {int((m.env == int(k)).sum()):>8,}")
    print(f"\n{'variable':18s} {'unit':7s} {'with data':>9s}   {'min':>8s} {'p5':>8s} {'median':>8s} {'p95':>8s} {'max':>8s}")
    for v in usable_vars(earth, variables):
        s = m[v].dropna()
        unit = variables[v].get("unit", "")
        print(f"{v:18s} {unit:7s} {100 * len(s) / max(len(m), 1):8.0f}%   "
              + " ".join(f"{x:8.1f}" for x in (s.min(), s.quantile(.05), s.median(), s.quantile(.95), s.max())))
    missing = [v for v in variables if v not in usable_vars(earth, variables)]
    print(f"\nNo data yet on Earth: {', '.join(missing)}")
    if len(targets):
        print(f"Target sites: {len(targets)} ({', '.join(f'{b}: {n}' for b, n in targets.body.value_counts().items())})")
    else:
        print("Target sites (Moon / Mars): none processed yet → build the Mars and Moon grids first")


# ------------------------------------------------------------------ search
def haversine_km(lat1, lon1, lat2, lon2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    a = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(np.radians(lon2 - lon1) / 2) ** 2
    return 2 * 6371.0 * np.arcsin(np.sqrt(a))


def spread(df: pd.DataFrame, n: int, min_km: float) -> pd.DataFrame:
    """The n best, but at least min_km apart (otherwise 10 neighbouring hexagons of the same site come out)."""
    kept = []
    for idx, r in df.iterrows():
        if all(haversine_km(r.lat, r.lon, df.at[k, "lat"], df.at[k, "lon"]) >= min_km for k in kept):
            kept.append(idx)
            if len(kept) == n:
                break
    return df.loc[kept]


def ask_filters(earth: pd.DataFrame) -> pd.DataFrame:
    print("\n--- Filters (Enter = default value) ---")
    cells = earth
    if ask("Only inside the mask (deserts / ice / arid)? [Y/n]: ", "y").lower().startswith(("y", "s")):
        cells = cells[cells.in_mask]
    env = ask("Zone type: 1 polar ice · 2 desert · 3 arid open land · Enter = all: ")
    if env in ENVS:
        cells = cells[cells.env == int(env)]
    lat_min = ask_float("Minimum latitude (Enter = no limit): ")
    lat_max = ask_float("Maximum latitude (Enter = no limit): ")
    if lat_min is not None:
        cells = cells[cells.lat >= lat_min]
    if lat_max is not None:
        cells = cells[cells.lat <= lat_max]
    print(f"→ {len(cells):,} candidate cells")
    return cells


def ask_weights(vars_in_target: list[str], pruebas: dict) -> dict:
    names = ", ".join(pruebas)
    r = ask(f"\nWeights: Enter = every variable weighs the same · or type a test ({names}): ").lower()
    if r in pruebas:
        w = {k: v for k, v in pruebas[r]["weights"].items() if k in vars_in_target}
        if not w:
            print(f"   The test '{r}' uses variables we do not have yet → equal weights")
        else:
            print(f"   Test '{pruebas[r]['label']}': {w}\n   Validity: {pruebas[r]['test_validity']}")
            return w
    return {v: 1.0 for v in vars_in_target}


def run_search(target: dict, cells: pd.DataFrame, variables: dict, weights: dict, title: str,
               exclude_near: tuple[float, float] | None = None) -> None:
    scores = variable_scores(target, cells, {k: variables[k] for k in weights})
    idx = analog_index(scores, weights, dimensions_of(variables))
    res = cells.assign(score=idx).join(scores.add_prefix("note_"))
    res = res.dropna(subset=["score"]).sort_values("score", ascending=False)
    if exclude_near:
        d = haversine_km(exclude_near[0], exclude_near[1], res.lat.to_numpy(), res.lon.to_numpy())
        res = res[d >= 150]

    n = int(ask_float("How many results? (Enter = 10): ") or 10)
    sep = ask_float("Minimum distance between results in km (Enter = 100): ")
    top = spread(res.head(5000), n, 100 if sep is None else sep)

    print(f"\n=== {title} ===")
    print("Target: " + " · ".join(f"{k} = {target[k]:.1f} {variables[k].get('unit', '')}" for k in weights))
    print(f"Cells evaluated: {len(res):,} · index ≥ 90: {(res.score >= 90).sum():,} · "
          f"≥ 75: {(res.score >= 75).sum():,} · ≥ 50: {(res.score >= 50).sum():,}\n")
    for rank, (_, r) in enumerate(top.iterrows(), 1):
        print(f"{rank:2d}. index {r.score:5.1f}   lat {r.lat:7.2f}  lon {r.lon:8.2f}   {r.env_name}")
        print("      " + " · ".join(f"{k} {r[k]:.1f} (note {r['note_' + k]:.2f})" for k in weights if pd.notna(r[k])))
        print(f"      https://www.google.com/maps/@{r.lat:.4f},{r.lon:.4f},9z")
    VALIDATION.mkdir(parents=True, exist_ok=True)
    out = VALIDATION / f"search_{dt.datetime.now():%Y%m%d_%H%M%S}.csv"
    top.round(3).to_csv(out, index=False)
    print(f"\nSaved: {out}")


def mode_manual(earth, variables, pruebas):
    vs = usable_vars(earth, variables)
    m = earth[earth.in_mask]
    print("\n--- Type the value of each variable (Enter = leave it out). Temperatures in K or in °C with 'c' (e.g. -20c) ---")
    target = {}
    for v in vs:
        s = m[v].dropna()
        spec = variables[v]
        val = ask_float(f"{spec['label']} ({spec.get('unit', '')}) [Earth: {s.quantile(.05):.0f}–{s.quantile(.95):.0f}, "
                        f"median {s.median():.0f}; tolerance {spec['tolerance']}]: ", spec.get("unit", ""))
        if val is not None:
            target[v] = val
    if not target:
        print("You did not type any value.")
        return
    cells = ask_filters(earth)
    run_search(target, cells, variables, ask_weights(list(target), pruebas), "SITES MOST SIMILAR TO YOUR VALUES")


def mode_earth_point(earth, variables, pruebas):
    lat = ask_float("Latitude of the point (e.g. -24.1 for Atacama): ")
    lon = ask_float("Longitude of the point (e.g. -70.0): ")
    if lat is None or lon is None:
        return
    d = haversine_km(lat, lon, earth.lat.to_numpy(), earth.lon.to_numpy())
    ref = earth.iloc[int(np.argmin(d))]
    vs = [v for v in usable_vars(earth, variables) if pd.notna(ref[v])]
    print(f"\nNearest cell ({d.min():.0f} km): {ref.env_name}, inside the mask: {ref.in_mask}")
    for v in vs:
        print(f"   {variables[v]['label']:32s} {ref[v]:9.1f} {variables[v].get('unit', '')}")
    target = {v: float(ref[v]) for v in vs}
    cells = ask_filters(earth)
    run_search(target, cells, variables, ask_weights(vs, pruebas),
               f"SITES SIMILAR TO ({lat:.2f}, {lon:.2f}) — those closer than 150 km are excluded", exclude_near=(lat, lon))


def mode_target(earth, variables, pruebas, targets):
    if targets.empty:
        print("\nThere are no Moon or Mars cards in data/processed/ yet.\n"
              "Import the data: python scripts/import_data.py <zip or folder>\n"
              "and then: python scripts/build_mars_grid.py")
        return
    for k, r in targets.reset_index(drop=True).iterrows():
        print(f"  [{k}] {r['body']:5s} {r['name']}")
    k = ask_float("Number of the site: ")
    if k is None or not 0 <= int(k) < len(targets):
        return
    t = targets.reset_index(drop=True).iloc[int(k)]
    vs = [v for v in usable_vars(earth, variables) if v in t.index and pd.notna(t[v])]
    if "precip_mm_year" in usable_vars(earth, variables):
        t = t.copy()
        t["precip_mm_year"] = 0.0      # it does not rain on the Moon or Mars (variables.yaml)
        vs.append("precip_mm_year")
    if not vs:
        print("That site does not share any variable with Earth yet.")
        return
    target = {v: float(t[v]) for v in vs}
    cells = ask_filters(earth)
    run_search(target, cells, variables, ask_weights(vs, pruebas), f"EARTH ANALOGS OF {t['name']} ({t['body']})")


def mode_stats(earth, variables):
    vs = usable_vars(earth, variables)
    for k, v in enumerate(vs):
        print(f"  [{k}] {v}")
    k = ask_float("Number of the variable: ")
    if k is None or not 0 <= int(k) < len(vs):
        return
    v = vs[int(k)]
    m = earth[earth.in_mask]
    s = m[v].dropna()
    print(f"\n{variables[v]['label']} ({variables[v].get('unit', '')}) — {len(s):,} cells with data")
    counts, edges = np.histogram(s, bins=12)
    for c, a, b in zip(counts, edges[:-1], edges[1:]):
        print(f"  {a:9.1f} – {b:9.1f} │{'█' * int(50 * c / counts.max()):50s}│ {c:,}")
    print("\nMedian by zone type:")
    print(m.groupby("env_name")[v].describe(percentiles=[.5])[["count", "min", "50%", "max"]].round(1).to_string())


def main() -> None:
    earth, variables, pruebas, targets = load()
    summary(earth, variables, targets)
    menu = {"1": "Type values by hand", "2": "Similar to a point of Earth",
            "3": "Similar to a Moon or Mars site", "4": "Statistics of a variable",
            "5": "Summary of the data", "0": "Quit"}
    while True:
        print("\n" + " · ".join(f"[{k}] {v}" for k, v in menu.items()))
        op = ask("Option: ")
        if op == "1":
            mode_manual(earth, variables, pruebas)
        elif op == "2":
            mode_earth_point(earth, variables, pruebas)
        elif op == "3":
            mode_target(earth, variables, pruebas, targets)
        elif op == "4":
            mode_stats(earth, variables)
        elif op == "5":
            summary(earth, variables, targets)
        elif op in ("0", "q", "quit", "exit", "salir"):
            break


if __name__ == "__main__":
    main()
