"""Earth mask: where we DO search for analogs (deserts, poles, lava fields)
and where we do NOT (sea, forests, crops, cities, wetlands).

    python scripts/download_earth.py mask      # first: MCD12C1 + GPM IMERG monthly
    python scripts/build_earth_mask.py

Input (data/raw/earth/):
  mcd12c1/        MODIS MCD12C1 v061: % of each IGBP class in each 0.05° cell (~5.6 km)
  imerg_monthly/  GPM IMERG v07 monthly, 0.1°, 2019–2023 → mean annual rainfall (mm/year)

Rule (thresholds are [assumptions], set by Science):
  land           = 100 − %water ≥ 50
  polar ice      = %permanent snow/ice ≥ 50
  desert         = %barren ≥ 50                              (regardless of rain: lava, salt flats)
  arid open land = %(barren + open shrubland + grassland) ≥ 60  AND  rain < 350 mm/year
  KEPT           = land AND (polar ice OR desert OR arid open land)
  Everything else (forests, savannas, crops, cities, wetlands, wet grasslands) is dropped.

Output:
  data/interim/earth_mask_005deg.npz         the mask pixel by pixel (class 0–3) and the rainfall
  data/processed/earth_mask_h3r5.parquet     one row per H3 res-5 hexagon (~17 km) with land
  data/processed/earth_mask_h3r4.parquet     the same at res 4 (~45 km)
  outputs/maps/earth_mask.png                map to review, with the known analogs on top
  outputs/validation/earth_mask_known_analogs.csv   does each known analog fall inside?
"""
import sys
from pathlib import Path

import h3
import h5py
import numpy as np
import pandas as pd
from pyhdf.SD import SD, SDC

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from analogs.paths import CATALOGS, INTERIM, MAPS, PROCESSED, RAW, VALIDATION  # noqa: E402

# --- Thresholds [assumption] ---
MIN_LAND = 50          # % of land in the 0.05° cell
MIN_SNOW = 50          # % permanent snow/ice → polar ice
MIN_BARREN = 50        # % barren → desert (no rainfall condition)
MIN_DRY_OPEN = 60      # % barren + open shrubland + grassland …
MAX_PRECIP = 350       # … and mean rainfall < 350 mm/year → arid open land (with 250, SP Crater,
                       #     Meteor Crater and Pilbara were lost: they are at 300–320 mm)
MIN_CELL_FRAC = 0.25   # a hexagon is kept if ≥ 25 % of its land (by area) is in the mask
                       #     (with 50 %, small lava fields were lost: Teide, Mauna Kea, Craters of the Moon)

# IGBP classes (MCD12C1, Land_Cover_Type_1_Percent: index = class)
WATER, OPEN_SHRUB, GRASS, SNOW, BARREN = 0, 7, 10, 15, 16
FOREST = [1, 2, 3, 4, 5]
CLASS_NAMES = {0: "outside", 1: "polar ice", 2: "desert (bare ground)", 3: "arid open land (shrubland / steppe)"}

N_LAT, N_LON, RES = 3600, 7200, 0.05
LAT = 90 - RES / 2 - RES * np.arange(N_LAT)        # centres, north to south
LON = -180 + RES / 2 + RES * np.arange(N_LON)


def read_mcd12c1() -> np.ndarray:
    f = sorted((RAW / "earth" / "mcd12c1").glob("MCD12C1*.hdf"))[-1]
    print(f"MCD12C1: {f.name}")
    pct = SD(str(f), SDC.READ).select("Land_Cover_Type_1_Percent").get()  # (3600, 7200, 17) uint8
    assert pct.shape == (N_LAT, N_LON, 17), pct.shape
    return pct


def read_precip_mm_year() -> np.ndarray:
    files = sorted((RAW / "earth" / "imerg_monthly").glob("3B-MO*.HDF5"))
    if not files:
        print("IMERG: no files → mask WITHOUT rainfall (provisional version, see classify)")
        return np.full((N_LAT, N_LON), np.nan)
    print(f"IMERG: {len(files)} months ({files[0].name[22:30]} … {files[-1].name[22:30]})")
    acc = np.zeros((N_LAT // 2, N_LON // 2))
    n = np.zeros_like(acc)
    for f in files:
        with h5py.File(f, "r") as h:
            p = h["Grid/precipitation"][0].astype("f8")          # (lon 3600, lat 1800), mm/h, ascending lat
        p = p.T[::-1]                                             # → (lat north to south, lon)
        ok = np.isfinite(p) & (p >= 0)
        acc[ok] += p[ok]
        n[ok] += 1
    with np.errstate(invalid="ignore", divide="ignore"):
        rate = np.where(n >= 0.8 * len(files), acc / n, np.nan)   # mm/h, mean of all the months
    mm_year = rate * 24 * 365.25
    return np.repeat(np.repeat(mm_year, 2, axis=0), 2, axis=1)    # 0.1° → 0.05°


def classify(pct: np.ndarray, precip: np.ndarray) -> np.ndarray:
    land = (100 - pct[..., WATER].astype(int)) >= MIN_LAND
    snow = pct[..., SNOW] >= MIN_SNOW
    barren = pct[..., BARREN] >= MIN_BARREN
    if np.isfinite(precip).any():
        dry_open = (pct[..., BARREN].astype(int) + pct[..., OPEN_SHRUB] + pct[..., GRASS]) >= MIN_DRY_OPEN
        arid = np.nan_to_num(precip, nan=np.inf) < MAX_PRECIP
    else:  # no rainfall: grassland does NOT enter (we cannot tell dry steppe from wet pasture)
        dry_open = (pct[..., BARREN].astype(int) + pct[..., OPEN_SHRUB]) >= MIN_DRY_OPEN
        arid = np.ones_like(dry_open)
    cls = np.zeros((N_LAT, N_LON), np.uint8)
    cls[land & dry_open & arid] = 3
    cls[land & barren] = 2
    cls[land & snow] = 1
    return cls, land


def to_h3(cls: np.ndarray, land: np.ndarray, precip: np.ndarray) -> tuple[pd.DataFrame, pd.DataFrame]:
    i, j = np.nonzero(land)
    lat, lon = LAT[i], LON[j]
    w = np.cos(np.radians(lat))                                   # pixel area ∝ cos(lat)
    print(f"Computing H3 res 5 for {len(i):,} land pixels…")
    cells = [h3.latlng_to_cell(a, b, 5) for a, b in zip(lat, lon)]
    c = cls[i, j]
    df = pd.DataFrame({"cell": cells, "w": w, "kept_w": w * (c > 0), "precip_w": w * np.nan_to_num(precip[i, j]),
                       "precip_ok_w": w * np.isfinite(precip[i, j])})
    for k in (1, 2, 3):
        df[f"c{k}"] = w * (c == k)

    def aggregate(d: pd.DataFrame) -> pd.DataFrame:
        g = d.groupby("cell").sum(numeric_only=True)
        out = pd.DataFrame(index=g.index)
        out["kept_frac"] = g.kept_w / g.w
        out["precip_mm_year"] = (g.precip_w / g.precip_ok_w).where(g.precip_ok_w > 0)
        out["env"] = g[["c1", "c2", "c3"]].to_numpy().argmax(1) + 1
        out.loc[out.kept_frac == 0, "env"] = 0
        out["env_name"] = out.env.map(CLASS_NAMES)
        out["in_mask"] = out.kept_frac >= MIN_CELL_FRAC
        latlon = np.array([h3.cell_to_latlng(x) for x in out.index])
        out["lat"], out["lon"] = latlon[:, 0], latlon[:, 1]
        return out.reset_index()

    r5 = aggregate(df)
    df["cell"] = [h3.cell_to_parent(x, 4) for x in df.cell]       # same calculation, one level up
    r4 = aggregate(df)
    return r5, r4


def validate(cls, pct, precip, r5, r4) -> pd.DataFrame:
    kn = pd.read_csv(CATALOGS / "known_analogs.csv")
    in5 = set(r5.cell[r5.in_mask])
    in4 = set(r4.cell[r4.in_mask])
    rows = []
    for _, a in kn.iterrows():
        i = int(np.clip((90 - a.lat) // RES, 0, N_LAT - 1))
        j = int(np.clip((a.lon + 180) // RES, 0, N_LON - 1))
        win = cls[max(i - 2, 0):i + 3, max(j - 2, 0):j + 3]        # ±2 pixels ≈ ±11 km
        p = pct[i, j]
        rows.append(dict(
            name=a["name"], lat=a.lat, lon=a.lon,
            pixel_class=CLASS_NAMES[int(cls[i, j])],
            inside_pixel=bool(cls[i, j] > 0),
            inside_11km=bool((win > 0).any()),
            inside_h3r5=h3.latlng_to_cell(a.lat, a.lon, 5) in in5,
            inside_h3r4=h3.latlng_to_cell(a.lat, a.lon, 4) in in4,
            pct_water=int(p[WATER]), pct_barren=int(p[BARREN]), pct_open_shrubland=int(p[OPEN_SHRUB]),
            pct_grassland=int(p[GRASS]), pct_snow_ice=int(p[SNOW]), pct_forest=int(p[FOREST].sum()),
            rain_mm_year=None if not np.isfinite(precip[i, j]) else round(float(precip[i, j])),
        ))
    return pd.DataFrame(rows)


def plot(cls, val: pd.DataFrame, path: Path) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import ListedColormap
    from matplotlib.patches import Patch

    colors = ["#dfe6ee", "#5aa9e6", "#e0a458", "#b5c97a"]
    fig, ax = plt.subplots(figsize=(16, 8.4), dpi=110)
    ax.imshow(cls[::3, ::3], cmap=ListedColormap(colors), vmin=0, vmax=3, extent=(-180, 180, -90, 90),
              interpolation="nearest")
    ok = val.inside_h3r5
    ax.scatter(val.lon[ok], val.lat[ok], s=36, c="#1b7f3b", edgecolors="white", linewidths=0.8, zorder=3)
    ax.scatter(val.lon[~ok], val.lat[~ok], s=46, marker="X", c="#c0262d", edgecolors="white", linewidths=0.8, zorder=3)
    for _, r in val.iterrows():
        ax.annotate(r["name"].split(" (")[0], (r.lon, r.lat), xytext=(4, 3), textcoords="offset points", fontsize=6.5)
    ax.legend(handles=[Patch(color=colors[k], label=CLASS_NAMES[k]) for k in (1, 2, 3)]
              + [Patch(color="#1b7f3b", label="known analog inside (H3 res 5)"),
                 Patch(color="#c0262d", label="known analog OUTSIDE")],
              loc="lower left", fontsize=8, framealpha=0.9)
    ax.set_title("Earth mask: zones where we search for analogs (MODIS MCD12C1 2025"
                 + (" + GPM IMERG 2019–2023)" if val.rain_mm_year.notna().any() else ", WITHOUT rainfall: provisional)"),
                 fontsize=11)
    ax.set_xlim(-180, 180); ax.set_ylim(-90, 90)
    ax.set_xlabel("longitude (°E)"); ax.set_ylabel("latitude (°N)")
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


def main() -> None:
    pct = read_mcd12c1()
    precip = read_precip_mm_year()
    cls, land = classify(pct, precip)

    w = np.cos(np.radians(LAT))[:, None]
    land_area = (w * land).sum()
    print("\n% of the land (by area) in each class:")
    for k in (1, 2, 3):
        print(f"  {CLASS_NAMES[k]:36s} {100 * (w * (cls == k)).sum() / land_area:5.1f} %")
    print(f"  {'TOTAL inside the mask':36s} {100 * (w * (cls > 0)).sum() / land_area:5.1f} %")

    INTERIM.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(INTERIM / "earth_mask_005deg.npz", cls=cls, land=land, precip_mm_year=precip.astype("f4"),
                        lat=LAT, lon=LON)

    r5, r4 = to_h3(cls, land, precip)
    PROCESSED.mkdir(parents=True, exist_ok=True)
    r5.to_parquet(PROCESSED / "earth_mask_h3r5.parquet", index=False)
    r4.to_parquet(PROCESSED / "earth_mask_h3r4.parquet", index=False)
    for name, r in (("res 5 (~17 km)", r5), ("res 4 (~45 km)", r4)):
        print(f"H3 {name}: {len(r):,} hexagons with land → {int(r.in_mask.sum()):,} inside the mask")
        print("   " + ", ".join(f"{k}: {v:,}" for k, v in r[r.in_mask].env_name.value_counts().items()))

    val = validate(cls, pct, precip, r5, r4)
    VALIDATION.mkdir(parents=True, exist_ok=True)
    val.to_csv(VALIDATION / "earth_mask_known_analogs.csv", index=False)
    print(f"\nKnown analogs inside: pixel {val.inside_pixel.sum()}/{len(val)} · "
          f"±11 km {val.inside_11km.sum()}/{len(val)} · H3 r5 {val.inside_h3r5.sum()}/{len(val)} · "
          f"H3 r4 {val.inside_h3r4.sum()}/{len(val)}")
    print(val[["name", "pixel_class", "inside_11km", "inside_h3r5", "pct_barren", "pct_open_shrubland",
               "pct_grassland", "pct_snow_ice", "pct_forest", "rain_mm_year"]].to_string(index=False))

    MAPS.mkdir(parents=True, exist_ok=True)
    plot(cls, val, MAPS / "earth_mask.png")
    print(f"\nMap: {MAPS / 'earth_mask.png'}")


if __name__ == "__main__":
    main()
