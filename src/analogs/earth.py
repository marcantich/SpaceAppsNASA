"""Earth: from the downloaded products to CARDS (one row per 0.05° pixel and per H3 res-5 hexagon).

    scripts/build_earth_mask.py        # 1) mask (MCD12C1 + IMERG)  → interim/earth_mask_005deg.npz
    scripts/build_earth_features.py    # 2) this module             → processed/fichas_tierra_*.parquet

Everything is computed on the common MODIS mesh (0.05°, ~5.6 km, "CMG"); each product is read once.
The table per hexagon is the area-weighted (cos lat) mean of those pixels.
Input folders and what each one is: src/analogs/catalog.py.

Time:
  - FIXED       relief (SRTMGL30 + ETOPO 2022), silica (ECOSTRESS 2023–24), land cover (2025)
  - CLIMATE     2019–2023 → TYPICAL conditions, not records:
                    t_mean_K = mean of the 12 months of (day + night)/2   (night only when there is no day: polar night)
                    t_max_K  = warmest month of the daytime temperature (13:30)
                    t_min_K  = coldest month of the night temperature (01:30; the real minimum, at dawn, is a little lower)
                    precip_mm_year, dust_aod (annual mean) / dust_aod_max (dustiest month), snow_cover_pct
Scale of the relief: 30″ (~0.93 km) → slope at that baseline (the same as MOLA 64 px/°).
  slope_deg     = mean slope of the pixel / hexagon
  roughness_deg = RMS of the slope (same criterion as mars.py)
"""
from __future__ import annotations

import re
import warnings
import zipfile
from pathlib import Path

import h3
import numpy as np
import pandas as pd

from .paths import INTERIM, PROCESSED, RAW

EARTH_RADIUS_M = 6_371_008.8
EARTH_OBLIQUITY_DEG = 23.44
RES = 0.05
N_LAT, N_LON = 3600, 7200
LAT = 90 - RES / 2 - RES * np.arange(N_LAT)       # row centres, north to south
LON = -180 + RES / 2 + RES * np.arange(N_LON)
H3_RES = 5
DAYS_IN_MONTH = np.array([31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31])

RAW_EARTH = RAW / "earth"
MASK_NPZ = INTERIM / "earth_mask_005deg.npz"
CELLS_NPZ = INTERIM / f"earth_cmg_h3r{H3_RES}.npz"


# --------------------------------------------------------------------------------------
# Common mesh and pixel → hexagon mapping
# --------------------------------------------------------------------------------------

def load_mask() -> dict[str, np.ndarray]:
    if not MASK_NPZ.exists():
        raise FileNotFoundError(f"{MASK_NPZ} is missing. Run first: python scripts/build_earth_mask.py")
    with np.load(MASK_NPZ) as z:
        return {k: z[k] for k in z.files}


def pixel_cells(land: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(row, column, hexagon as an integer) of each land pixel. Computed once and saved."""
    if CELLS_NPZ.exists():
        with np.load(CELLS_NPZ) as z:
            if len(z["i"]) == int(land.sum()):
                return z["i"], z["j"], z["cell"]
    i, j = np.nonzero(land)
    print(f"  H3 res {H3_RES} for {len(i):,} pixels (only once)…")
    cell = np.fromiter((h3.str_to_int(h3.latlng_to_cell(a, b, H3_RES)) for a, b in zip(LAT[i], LON[j])),
                       dtype=np.int64, count=len(i))
    INTERIM.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(CELLS_NPZ, i=i, j=j, cell=cell)
    return i, j, cell


def to_hexagons(i: np.ndarray, j: np.ndarray, cell: np.ndarray, fields: dict[str, np.ndarray]) -> pd.DataFrame:
    """Area-weighted (cos lat) mean of each 0.05° field inside each hexagon, ignoring NaN."""
    w = np.cos(np.radians(LAT[i]))
    df = pd.DataFrame({"cell": cell})
    for name, grid in fields.items():
        v = grid[i, j].astype("f8")
        ok = np.isfinite(v)
        df[name + "__s"] = np.where(ok, v * w, 0.0)
        df[name + "__w"] = np.where(ok, w, 0.0)
    g = df.groupby("cell").sum()
    out = pd.DataFrame(index=g.index)
    for name in fields:
        out[name] = (g[name + "__s"] / g[name + "__w"]).where(g[name + "__w"] > 0)
    return out


# --------------------------------------------------------------------------------------
# Temperature: MYD11C3 (Aqua), monthly climatology
# --------------------------------------------------------------------------------------

def lst_climatology(land: np.ndarray) -> dict[str, np.ndarray]:
    """t_mean_K, t_max_K, t_min_K and n_months on the 0.05° mesh (NaN outside land or without data)."""
    from pyhdf.SD import SD, SDC

    files = sorted((RAW_EARTH / "myd11c3").glob("MYD11C3.A*.hdf"))
    if not files:
        print("  [temperature] no MYD11C3 files → left empty")
        return {}
    i, j = np.nonzero(land)
    n = len(i)
    sums = {k: np.zeros((12, n), "f8") for k in ("day", "night")}
    cnts = {k: np.zeros((12, n), "u2") for k in ("day", "night")}
    years = set()
    for f in files:
        m = re.search(r"\.A(\d{4})(\d{3})\.", f.name)
        year, doy = int(m.group(1)), int(m.group(2))
        years.add(year)
        month = (pd.Timestamp(year=year, month=1, day=1) + pd.Timedelta(days=doy - 1)).month - 1
        sd = SD(str(f), SDC.READ)
        for key, sds in (("day", "LST_Day_CMG"), ("night", "LST_Night_CMG")):
            raw = sd.select(sds).get()[i, j]
            ok = raw > 0                                # 0 = no data
            sums[key][month, ok] += raw[ok] * 0.02      # scale factor → K
            cnts[key][month, ok] += 1
        sd.end()
    print(f"  [temperature] MYD11C3: {len(files)} months, years {min(years)}–{max(years)}")
    with np.errstate(invalid="ignore", divide="ignore"):
        day = np.where(cnts["day"] > 0, sums["day"] / cnts["day"], np.nan)        # (12, n) climatology
        night = np.where(cnts["night"] > 0, sums["night"] / cnts["night"], np.nan)
        both = np.where(np.isfinite(day) & np.isfinite(night), (day + night) / 2, np.where(np.isfinite(night), night, day))
        months_ok = np.isfinite(both).sum(0)
        warnings.simplefilter("ignore", RuntimeWarning)    # pixels without any month: mean of an empty slice
        res = {
            "t_mean_K": np.where(months_ok >= 6, np.nanmean(both, 0), np.nan),
            "t_max_K": np.nanmax(np.where(np.isfinite(day), day, -np.inf), 0),
            "t_min_K": np.nanmin(np.where(np.isfinite(night), night, np.inf), 0),
            # annual means of each overpass: equivalent to t_night_K (~03 h) / t_day_K (~14–15 h) of Mars
            "t_night_K": np.where(np.isfinite(night).sum(0) >= 6, np.nanmean(night, 0), np.nan),
            "t_day_K": np.where(np.isfinite(day).sum(0) >= 6, np.nanmean(day, 0), np.nan),
            "lst_months": months_ok.astype("f4"),
            # thawing degree-days (°C·day): Σ over months of max(0, monthly mean T − 0 °C) × days → active layer (Stefan)
            "thaw_dd": np.where(months_ok >= 6, np.nansum(np.clip(both - 273.15, 0, None) * DAYS_IN_MONTH[:, None], 0), np.nan),
        }
    res["t_max_K"][~np.isfinite(res["t_max_K"])] = np.nan
    res["t_min_K"][~np.isfinite(res["t_min_K"])] = np.nan
    out = {}
    for k, v in res.items():
        g = np.full((N_LAT, N_LON), np.nan, "f4")
        g[i, j] = v
        out[k] = g
    return out


# --------------------------------------------------------------------------------------
# Relief: SRTMGL30 → slope at ~0.93 km, aggregated to 0.05° (blocks of 6×6 pixels)
# --------------------------------------------------------------------------------------

def _read_srtm30_tile(zpath: Path) -> tuple[np.ndarray, dict]:
    """SRTMGL30 tile (GTOPO30 format): the zip only holds the .DEM, without a header.
    The name gives the upper-left corner (W020N40 = 20°W, 40°N); 30″ per pixel,
    4800 columns (40°) × 6000 rows (50°), 16-bit big-endian integer, 0 = sea."""
    m = re.match(r"([EW])(\d{3})([NS])(\d{2})", zpath.name.upper())
    west = int(m.group(2)) * (1 if m.group(1) == "E" else -1)
    north = int(m.group(4)) * (1 if m.group(3) == "N" else -1)
    with zipfile.ZipFile(zpath) as z:
        dem_name = next(n for n in z.namelist() if n.lower().endswith(".dem"))
        z16 = np.frombuffer(z.read(dem_name), dtype=">i2")
    cols = 4800
    z16 = z16.reshape(-1, cols)
    dem = z16.astype("f4")
    dem[(z16 == -9999) | (z16 == 0)] = np.nan     # the sea comes as 0 (checked); exactly 0 m on land: almost never
    dim = 1 / 120
    return dem, {"ulx": west + dim / 2, "uly": north - dim / 2, "dim": dim}


def srtm_relief() -> dict[str, np.ndarray]:
    """elevation_m, slope_deg (mean) and slope_sq (mean of slope², for the RMS) on the 0.05° mesh."""
    tiles = sorted((RAW_EARTH / "srtmgl30").glob("*.zip"))
    if not tiles:
        print("  [relief] no SRTMGL30 files → left empty")
        return {}
    out = {k: np.full((N_LAT, N_LON), np.nan, "f4") for k in ("elevation_m", "slope_deg", "slope_sq")}
    for t in tiles:
        dem, g = _read_srtm30_tile(t)
        rows, cols = dem.shape
        top = g["uly"] + g["dim"] / 2                       # top edge (ULYMAP is the pixel centre)
        lat = top - g["dim"] * (np.arange(rows) + 0.5)
        dy = np.radians(g["dim"]) * EARTH_RADIUS_M          # metres per pixel, north–south
        dx = dy * np.clip(np.cos(np.radians(lat)), 1e-3, None)[:, None]
        dzdy = np.gradient(dem, dy, axis=0)
        dzdx = np.gradient(dem, axis=1) / dx
        slope = np.degrees(np.arctan(np.hypot(dzdx, dzdy)))
        k = int(round(RES / g["dim"]))                      # 6 pixels of 30″ per 0.05° pixel
        r0 = int(round((90 - top) / RES))
        c0 = int(round((g["ulx"] - g["dim"] / 2 + 180) / RES))
        br, bc = rows // k, cols // k
        with np.errstate(invalid="ignore"), warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)       # sea blocks: mean of all NaN
            for name, field in (("elevation_m", dem), ("slope_deg", slope), ("slope_sq", slope ** 2)):
                blk = field[: br * k, : bc * k].reshape(br, k, bc, k)
                out[name][r0:r0 + br, c0:c0 + bc] = np.nanmean(blk, axis=(1, 3))
    n = int(np.isfinite(out["elevation_m"]).sum())
    print(f"  [relief] SRTMGL30: {len(tiles)} tiles → {n:,} pixels of 0.05° with data")
    return out


def _slope_deg(dem: np.ndarray, lat_rows: np.ndarray, dim_deg: float) -> np.ndarray:
    dy = np.radians(dim_deg) * EARTH_RADIUS_M
    dx = dy * np.clip(np.cos(np.radians(lat_rows)), 1e-3, None)[:, None]
    return np.degrees(np.arctan(np.hypot(np.gradient(dem, axis=1) / dx, np.gradient(dem, dy, axis=0))))


def etopo_fill(relief: dict[str, np.ndarray], land: np.ndarray) -> dict[str, np.ndarray]:
    """Fills with ETOPO 2022 (30″, global) the land pixels WITHOUT SRTMGL30: the Arctic (>60° N) and
    Antarctica / sub-Antarctic (<56° S). Same resolution (30″) and same slope calculation.
    ETOPO includes the sea floor: at those latitudes only what is above 0 m is used."""
    tif = next((RAW_EARTH / "etopo2022_30s").glob("*.tif"), None)
    if tif is None:
        print("  [relief] no ETOPO 2022 → the Arctic and Antarctica are left without slope")
        return relief
    import rasterio
    from rasterio.windows import Window

    try:
        with rasterio.open(tif) as src:
            src.read(1, window=Window(0, src.height - 1, src.width, 1))   # complete file? (reads the last row)
    except Exception as e:  # noqa: BLE001 — unfinished download or damaged file
        print(f"  [relief] ETOPO 2022 incomplete or unreadable ({type(e).__name__}) → skipped; rerun download_earth.py dem")
        return relief
    if not relief:
        relief = {k: np.full((N_LAT, N_LON), np.nan, "f4") for k in ("elevation_m", "slope_deg", "slope_sq")}
    need = land & ~np.isfinite(relief["elevation_m"])           # land without SRTMGL30 data
    rows_needed = np.nonzero(need.any(axis=1))[0]
    if not len(rows_needed):
        return relief
    filled = 0
    with rasterio.open(tif) as src:
        dim = src.transform.a                                    # 30″ = 1/120°
        k = int(round(RES / dim))                                # 6 pixels of 30″ per 0.05° pixel
        width = N_LON * k
        strip = 200                                              # rows of 0.05° per block (10°)
        for r0 in range(0, N_LAT, strip):
            r1 = min(r0 + strip, N_LAT)
            if not need[r0:r1].any():
                continue
            top, bottom = r0 * k, r1 * k                         # rows of 30″ (the half-pixel registration offset is ignored)
            h0, h1 = max(top - 1, 0), min(bottom + 1, src.height)
            z = src.read(1, window=Window(0, h0, width, h1 - h0)).astype("f4")
            z[z <= 0] = np.nan                                   # sea and ice shelves: dropped
            lat_rows = 90 - dim * (np.arange(h0, h1) + 0.5)
            slope = _slope_deg(z, lat_rows, dim)
            sl = slice(top - h0, top - h0 + (bottom - top))
            with np.errstate(invalid="ignore"), warnings.catch_warnings():
                warnings.simplefilter("ignore", RuntimeWarning)
                for name, field in (("elevation_m", z[sl]), ("slope_deg", slope[sl]), ("slope_sq", slope[sl] ** 2)):
                    blk = np.nanmean(field.reshape(r1 - r0, k, N_LON, k), axis=(1, 3))
                    tgt = relief[name][r0:r1]
                    m = need[r0:r1]
                    tgt[m] = blk[m]
            filled += int((need[r0:r1] & np.isfinite(relief["elevation_m"][r0:r1])).sum())
    print(f"  [relief] ETOPO 2022: {filled:,} pixels of 0.05° filled (poles)")
    return relief


# --------------------------------------------------------------------------------------
# Dust (MERRA-2), silica (ECOSTRESS), snow (MOD10CM)
# --------------------------------------------------------------------------------------

def merra2_dust() -> dict[str, np.ndarray]:
    """dust_aod (annual mean of the dust, 550 nm), dust_aod_max (dustiest month), total_aod.
    Climatology 2019–2023; brought to 0.05° with the nearest neighbour (the MERRA-2 mesh is ~55 km)."""
    import h5py

    files = sorted((RAW_EARTH / "merra2_dust").glob("*.nc4"))
    if not files:
        print("  [dust] no MERRA-2 files → left empty")
        return {}
    sums = {v: np.zeros((12, 361, 576)) for v in ("DUEXTTAU", "TOTEXTTAU")}
    n = np.zeros(12)
    for f in files:
        month = int(re.search(r"\.(\d{4})(\d{2})", f.name).group(2)) - 1
        with h5py.File(f, "r") as h:
            for v in sums:
                a = h[v][0].astype("f8")
                a[a > 1e10] = np.nan                             # _FillValue 1e15
                sums[v][month] += a
        n[month] += 1
    clim = {v: s / n[:, None, None] for v, s in sums.items()}
    li = np.clip(np.rint((LAT + 90) / 0.5).astype(int), 0, 360)
    lj = np.rint((LON + 180) / 0.625).astype(int) % 576
    out = {
        "dust_aod": clim["DUEXTTAU"].mean(0)[li[:, None], lj[None, :]].astype("f4"),
        "dust_aod_max": clim["DUEXTTAU"].max(0)[li[:, None], lj[None, :]].astype("f4"),
        "total_aod": clim["TOTEXTTAU"].mean(0)[li[:, None], lj[None, :]].astype("f4"),
    }
    print(f"  [dust] MERRA-2: {len(files)} months")
    return out


def ecostress_silica() -> dict[str, np.ndarray]:
    """silica_wt_pct: weight % of SiO₂, mean of the 0.01° pixels inside each 0.05° pixel (53° N – 53° S)."""
    tif = next((RAW_EARTH / "ecostress_wps").glob("*.tif"), None)
    if tif is None:
        print("  [silica] no ECOSTRESS → left empty")
        return {}
    import rasterio
    from rasterio.transform import from_origin
    from rasterio.warp import Resampling, reproject

    dst = np.full((N_LAT, N_LON), np.nan, "f4")
    with rasterio.open(tif) as src:
        reproject(source=rasterio.band(src, 1), destination=dst, src_nodata=src.nodata, dst_nodata=np.nan,
                  dst_transform=from_origin(-180, 90, RES, RES), dst_crs="EPSG:4326",
                  resampling=Resampling.average)
    dst[(dst <= 0) | (dst > 100)] = np.nan
    print(f"  [silica] ECOSTRESS: {int(np.isfinite(dst).sum()):,} pixels of 0.05° with data")
    return {"silica_wt_pct": dst}


def snow_climatology(land: np.ndarray) -> dict[str, np.ndarray]:
    """snow_cover_pct (annual mean of the monthly climatology) and snow_months (months with > 50 % snow)."""
    from pyhdf.SD import SD, SDC

    files = sorted((RAW_EARTH / "mod10cm").glob("MOD10CM.A*.hdf"))
    if not files:
        print("  [snow] no MOD10CM files → left empty")
        return {}
    i, j = np.nonzero(land)
    sums = np.zeros((12, len(i)), "f4")
    cnts = np.zeros((12, len(i)), "u2")
    for f in files:
        m = re.search(r"\.A(\d{4})(\d{3})\.", f.name)
        month = (pd.Timestamp(year=int(m.group(1)), month=1, day=1) + pd.Timedelta(days=int(m.group(2)) - 1)).month - 1
        sd = SD(str(f), SDC.READ)
        v = sd.select("Snow_Cover_Monthly_CMG").get()[i, j]
        sd.end()
        ok = v <= 100                                           # > 100: night, cloud, water, no data
        sums[month, ok] += v[ok]
        cnts[month, ok] += 1
    with np.errstate(invalid="ignore", divide="ignore"), warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        clim = np.where(cnts > 0, sums / cnts, np.nan)
        pct = np.nanmean(clim, 0)
        months = (clim >= 50).sum(0).astype("f4")
    out = {}
    for name, v in (("snow_cover_pct", pct), ("snow_months", months)):
        g = np.full((N_LAT, N_LON), np.nan, "f4")
        g[i, j] = v
        out[name] = g
    print(f"  [snow] MOD10CM: {len(files)} months")
    return out


# --------------------------------------------------------------------------------------
# Card per hexagon
# --------------------------------------------------------------------------------------

def sun_elevation_max(lat_deg: np.ndarray, obliquity_deg: float = EARTH_OBLIQUITY_DEG) -> np.ndarray:
    """Highest noon Sun elevation over a year (flat horizon)."""
    return 90.0 - np.maximum(0.0, np.abs(lat_deg) - obliquity_deg)


ENV_NAMES = {0: "outside", 1: "polar ice", 2: "desert (bare ground)", 3: "arid open land (shrubland / steppe)"}


def compute_fields(m: dict[str, np.ndarray], relief: bool = True) -> dict[str, np.ndarray]:
    """Every variable on the 0.05° mesh (the products are read only once).
    relief=False: without relief (the H3 grid computes it apart, at 15″, in earth_grid.py)."""
    fields: dict[str, np.ndarray] = {"precip_mm_year": m["precip_mm_year"]}
    if relief:
        fields.update(etopo_fill(srtm_relief(), m["land"]))
    fields.update(lst_climatology(m["land"]))
    fields.update(merra2_dust())
    fields.update(ecostress_silica())
    fields.update(snow_climatology(m["land"]))
    return fields


def build_earth_pixels(fields: dict[str, np.ndarray], m: dict[str, np.ndarray]) -> pd.DataFrame:
    """Card per 0.05° PIXEL (~5.6 km at the equator, less towards the poles): the native MODIS mesh.
    It is the finest resolution at which ALL the variables exist at once."""
    i, j = np.nonzero(m["land"])
    cls = m["cls"][i, j]
    out = pd.DataFrame({
        "pixel": (i.astype(np.int64) * N_LON + j).astype(np.int32),     # row·7200 + column
        "lat": LAT[i].astype("f4"), "lon": LON[j].astype("f4"),
        "in_mask": cls > 0, "env": cls.astype("i1"),
    })
    out["env_name"] = pd.Categorical(out["env"].map(ENV_NAMES))
    for name, grid in fields.items():
        if name != "slope_sq":
            out[name] = grid[i, j].astype("f4")
    if "slope_sq" in fields:
        out["roughness_deg"] = np.sqrt(fields["slope_sq"][i, j]).astype("f4")
    out["sun_elev_max_deg"] = sun_elevation_max(out["lat"].to_numpy()).astype("f4")
    PROCESSED.mkdir(parents=True, exist_ok=True)
    out.to_parquet(PROCESSED / "fichas_tierra_005deg.parquet", index=False)
    return out


def build_earth_cells(fields: dict[str, np.ndarray] | None = None, m: dict[str, np.ndarray] | None = None) -> pd.DataFrame:
    m = m or load_mask()
    land = m["land"]
    i, j, cell = pixel_cells(land)
    fields = fields or compute_fields(m)
    print("  Aggregating to hexagons…")
    hexes = to_hexagons(i, j, cell, fields)
    if "slope_sq" in hexes:
        hexes["roughness_deg"] = np.sqrt(hexes.pop("slope_sq"))

    mask = pd.read_parquet(PROCESSED / "earth_mask_h3r5.parquet")
    mask["cell_int"] = [h3.str_to_int(c) for c in mask["cell"]]
    mask = mask.drop(columns=[c for c in hexes.columns if c in mask.columns])
    out = mask.set_index("cell_int").join(hexes, how="left").reset_index(drop=True)
    out["sun_elev_max_deg"] = sun_elevation_max(out["lat"].to_numpy())
    first = ["cell", "lat", "lon", "in_mask", "kept_frac", "env", "env_name"]
    out = out[first + [c for c in out.columns if c not in first]]
    PROCESSED.mkdir(parents=True, exist_ok=True)
    out.to_parquet(PROCESSED / f"fichas_tierra_h3r{H3_RES}.parquet", index=False)
    return out
