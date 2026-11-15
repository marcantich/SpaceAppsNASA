"""The EARTH card grid: every variable on H3 hexagons, SAME format as Mars.

    .venv\\Scripts\\python.exe scripts\\build_earth_grid.py            # H3 res 6 (default)
    .venv\\Scripts\\python.exe scripts\\build_earth_grid.py --res 5    # H3 res 5

It is the equivalent of src/analogs/mars_grid.py for Earth:
  - one row per H3 cell of the WHOLE planet (sea = NaN), column `h3` (text), `lat`, `lon` and one
    float32 column per variable → data/processed/earth_h3r<res>.parquet
  - same raster → cell method (ROADMAP 3.5): low-pass = area-weighted mean; high-pass
    (plane removed) ONLY for roughness; weighted median for the slope.
  - then scripts/build_earth_grid.py writes it in binary with analogs.export.write_grid_binary
    → app/data/tierra/ (docs/07_card_grid_binary_format.md), like app/data/marte/.

Cell size (H3 is an angular grid: the same level has a different size on each body):
  Mars res 5 ≈ 9.1 km across · Moon res 5 ≈ 4.7 km · Earth res 5 ≈ 17 km · Earth res 6 ≈ 6.5 km.
  Earth res 6 is the closest to the ~9 km of Mars (and lies between Mars and the Moon).

Per variable (source → cell):
  slope_deg, roughness_deg, elevation_m  relief at 15″ (~460 m, ETOPO 2022: same baseline as MOLA 128 px/°
                                         and LOLA ldem_64) if it is downloaded; otherwise 30″ (~0.93 km:
                                         SRTMGL30 + ETOPO 30″ at the poles) with a warning. Land pixels only.
  t_*, precip, dust, silica, snow,       0.05° mesh of src/analogs/earth.py (2019–2023 climatologies) →
  mask (in_mask, env, kept_frac)         mean weighted by AREA OF INTERSECTION (each pixel is split in
                                         3×3 sub-pixels, like TES on Mars)
  land_frac                              fraction of the cell that is land (MCD12C1)
  sun_elev_max_deg                       formula with the latitude of the centre (obliquity 23.44°)
"""
from __future__ import annotations

import time

import h3.api.basic_int as h3i
import numpy as np
import pandas as pd
from h3ronpy.vector import cells_to_coordinates, coordinates_to_cells

from .earth import (EARTH_OBLIQUITY_DEG, EARTH_RADIUS_M, LAT, LON, N_LAT, N_LON, RAW_EARTH, RES,
                    compute_fields, load_mask)
from .mars_grid import Grid, finish_topography, weighted_median_groups, wrap180
from .paths import PROCESSED


def log(msg: str) -> None:
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def to_cells(lat: np.ndarray, lon: np.ndarray, res: int) -> np.ndarray:
    """H3 cell of many points at once (h3ronpy, vectorised; same result as h3-py)."""
    return np.asarray(coordinates_to_cells(np.ascontiguousarray(lat, dtype=np.float64),
                                           np.ascontiguousarray(wrap180(lon), dtype=np.float64), res)).astype(np.uint64)


class EarthGrid(Grid):
    """The same accumulator class as mars_grid.Grid, at the resolution asked for."""

    def __init__(self, res: int) -> None:          # noqa: D107 (does not call Grid.__init__: another resolution)
        self.res = res
        cells = np.fromiter((c for r in h3i.get_res0_cells() for c in h3i.cell_to_children(r, res)), dtype=np.uint64)
        cells.sort()
        self.cells = cells
        coords = cells_to_coordinates(cells)
        self.lat = np.asarray(coords.column("lat")).astype(np.float64)
        self.lon = np.asarray(coords.column("lng")).astype(np.float64)
        self.n = len(cells)
        self.sums = {}
        self.median_parts = {}


# --------------------------------------------------------------------------------------
# Relief: slope (weighted median), roughness (high-pass), elevation
# --------------------------------------------------------------------------------------

def _accumulate_dem(grid: EarthGrid, ids, z, gx, gy, lat, lon, w) -> None:
    """Same as mars_grid._accumulate_topography, with the radius of Earth."""
    uniq, inv = np.unique(ids, return_inverse=True)
    gidx = grid.index(uniq)
    clat, clon = grid.lat[gidx][inv], grid.lon[gidx][inv]
    x = EARTH_RADIUS_M * np.cos(np.deg2rad(clat)) * np.deg2rad(wrap180(lon - clon))
    y = EARTH_RADIUS_M * np.deg2rad(lat - clat)
    gi = gidx[inv]
    for name, val in [("W", w), ("Sx", w * x), ("Sy", w * y), ("Sz", w * z), ("Sxx", w * x * x),
                      ("Syy", w * y * y), ("Sxy", w * x * y), ("Sxz", w * x * z), ("Syz", w * y * z),
                      ("Sgx", w * gx), ("Sgy", w * gy), ("Sgg", w * (gx * gx + gy * gy)),
                      ("Wmeas", w), ("Welev", w), ("Selev", w * z)]:
        grid.add(name, gi, val)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    med = weighted_median_groups(inv, slope, w, len(uniq))
    grid.add_median("slope", gidx, med, np.bincount(inv, weights=w, minlength=len(uniq)))


def _process_block(grid: EarthGrid, z: np.ndarray, lat_rows: np.ndarray, lon_cols: np.ndarray,
                   land_cmg: np.ndarray, halo_top: int, halo_bottom: int) -> None:
    """One block of relief (rows with a 1-row halo above / below) → sums of the grid."""
    dim = abs(lat_rows[1] - lat_rows[0])
    step = np.deg2rad(dim) * EARTH_RADIUS_M
    gy = -np.gradient(z, axis=0) / step                                            # d z / d north
    gx = np.gradient(z, axis=1) / (step * np.clip(np.cos(np.deg2rad(lat_rows)), 1e-3, None))[:, None]
    cut = slice(halo_top, z.shape[0] - halo_bottom)
    z, gx, gy, lat_rows = z[cut], gx[cut], gy[cut], lat_rows[cut]
    # LAND pixels only (MCD12C1 mask at 0.05°), with data in the pixel and its neighbours
    ri = np.clip(((90 - lat_rows) / RES).astype(int), 0, N_LAT - 1)
    ci = np.clip(((wrap180(lon_cols) + 180) / RES).astype(int), 0, N_LON - 1)
    keep = land_cmg[ri][:, ci] & np.isfinite(z) & np.isfinite(gx) & np.isfinite(gy)
    if not keep.any():
        return
    rr, cc = np.nonzero(keep)
    lat, lon = lat_rows[rr], lon_cols[cc]
    _accumulate_dem(grid, to_cells(lat, lon, grid.res), z[rr, cc].astype(np.float64), gx[rr, cc], gy[rr, cc],
                    lat, lon, np.cos(np.deg2rad(lat)))


def process_relief(grid: EarthGrid, land_cmg: np.ndarray) -> str:
    """Relief → sums. Returns the description of the source used (for index.json)."""
    import rasterio
    from rasterio.windows import Window

    tiles15 = sorted((RAW_EARTH / "etopo2022_15s").glob("*.tif"))
    needed = 0                                    # 15°×15° tiles with land (those downloaded by download_earth.py dem15)
    for top in range(90, -90, -15):
        for west in range(-180, 180, 15):
            r0, c0 = int((90 - top) / RES), int((west + 180) / RES)
            needed += bool(land_cmg[r0:r0 + 300, c0:c0 + 300].any())
    if tiles15 and len(tiles15) < needed:
        log(f"⚠️  15″ relief incomplete ({len(tiles15)}/{needed} tiles): 30″ is used until the download ends")
        tiles15 = []
    if tiles15:
        log(f"15″ relief (~460 m): {len(tiles15)} ETOPO 2022 tiles")
        for k, t in enumerate(tiles15, 1):
            try:
                with rasterio.open(t) as src:
                    z = src.read(1).astype(np.float64)
                    tr = src.transform
            except Exception as e:  # noqa: BLE001 — unfinished tile
                log(f"  ✗ {t.name}: {type(e).__name__} (skipped)")
                continue
            lat_rows = tr.f + (np.arange(z.shape[0]) + 0.5) * tr.e
            lon_cols = tr.c + (np.arange(z.shape[1]) + 0.5) * tr.a
            # no halo between tiles: the gradient at the edge is one-sided (an error of 1 row, negligible)
            _process_block(grid, z, lat_rows, lon_cols, land_cmg, 0, 0)
            if k % 25 == 0:
                log(f"  {k}/{len(tiles15)}")
        return "NOAA ETOPO 2022 15″ (~460 m pixels, same as MGS MOLA 128 px/deg and LRO LOLA ldem_64)"

    log("⚠️  No 15″ relief (download_earth.py dem15): 30″ (~0.93 km) is used → slopes gentler than on Mars / the Moon")
    from .earth import _read_srtm30_tile
    for t in sorted((RAW_EARTH / "srtmgl30").glob("*.zip")):
        dem, g = _read_srtm30_tile(t)
        lat_rows = g["uly"] - g["dim"] * np.arange(dem.shape[0])
        lon_cols = g["ulx"] + g["dim"] * np.arange(dem.shape[1])
        _process_block(grid, dem.astype(np.float64), lat_rows, lon_cols, land_cmg, 0, 0)
    tif = next((RAW_EARTH / "etopo2022_30s").glob("*.tif"), None)
    if tif is not None:                                     # poles: what SRTMGL30 does not cover
        with rasterio.open(tif) as src:
            dim = src.transform.a
            for top, bottom in ((90.0, 60.0), (-56.0, -90.0)):
                r0, r1 = int(round((90 - top) / dim)), int(round((90 - bottom) / dim))
                z = src.read(1, window=Window(0, r0, src.width, r1 - r0)).astype(np.float64)
                z[z <= 0] = np.nan
                lat_rows = 90 - dim * (np.arange(r0, r1) + 0.5)
                lon_cols = -180 + dim * (np.arange(src.width) + 0.5)
                _process_block(grid, z, lat_rows, lon_cols, land_cmg, 0, 0)
    return "NASA SRTMGL30 + NOAA ETOPO 2022 30″ (~0.93 km baseline; Mars/Moon use ~460 m)"


# --------------------------------------------------------------------------------------
# 0.05° fields → cell (area of intersection with 3×3 sub-pixels)
# --------------------------------------------------------------------------------------

def accumulate_cmg(grid: EarthGrid, fields: dict[str, np.ndarray], land: np.ndarray, sub: int = 3,
                   chunk: int = 120) -> None:
    """Area-weighted mean of each 0.05° field inside each cell (like accumulate_fine_raster for Mars).
    It also accumulates the total area (W_all) and the land area (W_land) → land_frac."""
    offs = (np.arange(sub) + 0.5) / sub - 0.5
    for r0 in range(0, N_LAT, chunk):
        r1 = min(N_LAT, r0 + chunk)
        lat_s = (LAT[r0:r1, None] - offs[None, :] * RES).ravel()           # sub-rows
        lon_s = (LON[:, None] + offs[None, :] * RES).ravel()               # sub-columns
        LA, LO = np.meshgrid(lat_s, lon_s, indexing="ij")
        ids = to_cells(LA.ravel(), LO.ravel(), grid.res)
        uniq, inv = np.unique(ids, return_inverse=True)
        gidx = grid.index(uniq)
        w = np.cos(np.deg2rad(LA.ravel()))
        pix = lambda a: np.repeat(np.repeat(a[r0:r1], sub, axis=0), sub, axis=1).ravel()  # noqa: E731
        is_land = pix(land)
        for name, wv in (("W_all", w), ("W_land", w * is_land)):
            grid.sums[name] = grid.sums.get(name, 0) + np.bincount(gidx, np.bincount(inv, wv, len(uniq)), grid.n)
        for name, arr in fields.items():
            v = pix(arr).astype(np.float64)
            ok = is_land & np.isfinite(v)
            wsum = np.bincount(inv[ok], weights=w[ok], minlength=len(uniq))
            vsum = np.bincount(inv[ok], weights=w[ok] * v[ok], minlength=len(uniq))
            grid.sums[f"W_{name}"] = grid.sums.get(f"W_{name}", 0) + np.bincount(gidx, wsum, grid.n)
            grid.sums[f"S_{name}"] = grid.sums.get(f"S_{name}", 0) + np.bincount(gidx, vsum, grid.n)


def _mean(grid: EarthGrid, name: str) -> np.ndarray:
    with np.errstate(invalid="ignore", divide="ignore"):
        return grid.sums[f"S_{name}"] / grid.sums[f"W_{name}"]


# --------------------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------------------

MIN_CELL_FRAC = 0.25      # as in build_earth_mask.py: the cell is in the mask if ≥ 25 % of its land is

# --- Permafrost → ice depth (the equivalent of SWIM on Mars and Diviner PRP on the Moon) ---------------
# [assumption] Method (to be reviewed by Science):
#   1. ice at the surface: ≥ 50 % of the cell is permanent snow / ice (MCD12C1) → 0 m
#   2. permafrost: mean annual surface temperature < 0 °C → ice under the ACTIVE LAYER,
#      thickness from the Stefan formula  ALT = E·√(thawing degree-days)  (Nelson et al. 1997)
#   3. otherwise → no ice = NO_ICE_DEPTH_M (10 m, the same code as Mars, mars_grid.NO_ICE_DEPTH_M)
# ice_depth_m is stored in the SAME CLASSES as Mars (0.5 = first metre · 3 = 1–5 m · 5 = > 5 m · 10 = none);
# ice_depth_cont_m stores the estimated metres. Limitations: LST is the clear-sky surface and snow
# insulates the ground; Earth ice is under an atmosphere (partial analogy, variables.yaml).
STEFAN_E = 0.035          # m / √(°C·day) [assumption]: 0.02–0.05 depending on the soil
NO_ICE_DEPTH_M = 10.0


def permafrost_fields(m: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    from .earth import lst_climatology

    lst = lst_climatology(m["land"])
    return {"thaw_dd": lst["thaw_dd"], "ice_frac": (m["cls"] == 1).astype("f4")}


def ice_depth(t_mean_K: np.ndarray, thaw_dd: np.ndarray, ice_frac: np.ndarray
              ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(ice_depth_m in the Mars classes, ice_depth_cont_m in metres, ice_depth_source).
    ice_depth_source, as on Mars and the Moon: 1 = ice sheet / glacier (MCD12C1) · 2 = permafrost model
    (Stefan) · 3 = assumption (mean temperature ≥ 0 °C → no ground ice)."""
    t, tdd, ice = (np.asarray(a, dtype=float) for a in (t_mean_K, thaw_dd, ice_frac))
    cont = np.full(t.shape, np.nan)
    src = np.full(t.shape, np.nan)
    known = np.isfinite(t)
    cont[known], src[known] = NO_ICE_DEPTH_M, 3
    perma = known & (t < 273.15)
    cont[perma], src[perma] = STEFAN_E * np.sqrt(np.nan_to_num(tdd[perma])), 2
    sheet = known & (np.nan_to_num(ice) >= 0.5)
    cont[sheet], src[sheet] = 0.0, 1
    cls = np.full(t.shape, np.nan)
    cls[known] = NO_ICE_DEPTH_M
    cls[known & (cont <= 1.0)] = 0.5
    cls[known & (cont > 1.0) & (cont <= 5.0)] = 3.0
    cls[known & (cont > 5.0) & (cont < NO_ICE_DEPTH_M)] = 5.0
    return cls, cont, src


def add_permafrost(res: int = 6) -> pd.DataFrame:
    """Adds ice_depth_m / ice_depth_cont_m to an existing earth_h3r<res>.parquet (without redoing the relief)."""
    path = PROCESSED / f"earth_h3r{res}.parquet"
    df = pd.read_parquet(path)
    log(f"Permafrost → {path.name}")
    grid = EarthGrid(res)
    assert (np.array([h3i.str_to_int(h) for h in df["h3"].iloc[:1000]], dtype=np.uint64) == grid.cells[:1000]).all()
    m = load_mask()
    accumulate_cmg(grid, permafrost_fields(m), m["land"])
    df["thaw_dd"] = _mean(grid, "thaw_dd").astype("f4")
    cls, cont, src = ice_depth(df["t_mean_K"], df["thaw_dd"], _mean(grid, "ice_frac"))
    df["ice_depth_m"], df["ice_depth_cont_m"], df["ice_depth_source"] = cls.astype("f4"), cont.astype("f4"), src.astype("f4")
    df.to_parquet(path, index=False)
    land = df[df.land_frac > 0]
    log(f"  classes (cells with land): {land.ice_depth_m.value_counts().sort_index().to_dict()}")
    return df


def build_earth_grid(res: int = 6) -> tuple[pd.DataFrame, str]:
    t0 = time.time()
    log(f"H3 res-{res} grid of Earth…")
    grid = EarthGrid(res)
    log(f"  {grid.n:,} cells")

    m = load_mask()
    land, cls = m["land"], m["cls"]
    relief_source = process_relief(grid, land)
    topo = finish_topography(grid).drop(columns=["mola_measured_frac"])

    log("0.05° fields (temperature, rain, dust, silica, snow) …")
    fields = compute_fields(m, relief=False)                      # the relief is handled apart (above)
    fields["ice_frac"] = (cls == 1).astype("f4")                  # permafrost (ice_depth, abajo)
    fields["kept"] = (cls > 0).astype("f4")
    for k in (1, 2, 3):
        fields[f"env{k}"] = (cls == k).astype("f4")
    log("Aggregating to cells (3×3 sub-pixels per pixel) …")
    accumulate_cmg(grid, fields, land)

    with np.errstate(invalid="ignore", divide="ignore"):
        land_frac = grid.sums["W_land"] / grid.sums["W_all"]
    cols = {name: _mean(grid, name) for name in fields if not name.startswith("env") and name not in ("kept", "ice_frac")}
    cols["ice_depth_m"], cols["ice_depth_cont_m"], cols["ice_depth_source"] = ice_depth(
        cols["t_mean_K"], cols["thaw_dd"], _mean(grid, "ice_frac"))
    kept = _mean(grid, "kept")
    env = np.vstack([_mean(grid, f"env{k}") for k in (1, 2, 3)])
    env_cls = np.where(np.nan_to_num(kept) > 0, np.nanargmax(np.nan_to_num(env, nan=-1), axis=0) + 1, 0).astype("f4")
    env_cls[~(land_frac > 0)] = np.nan

    df = pd.concat([
        pd.DataFrame({"h3": [h3i.int_to_str(int(c)) for c in grid.cells], "lat": grid.lat, "lon": grid.lon}),
        pd.DataFrame({"land_frac": land_frac,
                      "in_mask": np.where(land_frac > 0, (np.nan_to_num(kept) >= MIN_CELL_FRAC).astype("f4"), np.nan),
                      "env": env_cls, "kept_frac": kept}),
        topo, pd.DataFrame(cols),
        pd.DataFrame({"sun_elev_max_deg": np.where(land_frac > 0,
                                                   90.0 - np.clip(np.abs(grid.lat) - EARTH_OBLIQUITY_DEG, 0, None), np.nan)}),
    ], axis=1)
    df.loc[~(land_frac > 0), [c for c in df.columns if c not in ("h3", "lat", "lon", "land_frac")]] = np.nan
    PROCESSED.mkdir(parents=True, exist_ok=True)
    out = PROCESSED / f"earth_h3r{res}.parquet"
    df = df.astype({c: "float32" for c in df.columns if c not in ("h3", "lat", "lon")})
    df.to_parquet(out, index=False)
    log(f"Done in {(time.time() - t0) / 60:.1f} min → {out} ({out.stat().st_size / 1e6:.0f} MB)")
    return df, relief_source


# Mean size of an H3 cell on Earth (width between sides, km), for index.json → "cell_size_km"
# (the app's card shows it; Mars res 5 ≈ 9.1 km, Moon res 4 ≈ 12.3 km)
EARTH_CELL_SIZE_KM = {4: 45.3, 5: 17.1, 6: 6.5}

# name → (dtype, scale, offset, unit, label). The variables SHARED with Mars and the Moon use the same
# name, unit and (when the range fits) the same encoding as Mars (src/analogs/export.py).
EARTH_WEB_COLUMNS: dict[str, tuple[str, float, float, str, str]] = {
    "slope_deg":        ("u1", 0.25, 0.0, "°", "Slope (median; ~460 m pixels, central differences ≈ 0.9 km baseline)"),
    "roughness_deg":    ("u1", 0.25, 0.0, "°", "Roughness (RMS slope after removing a plane)"),
    "t_mean_K":         ("u1", 1.0, 100.0, "K", "Mean surface temperature ((day + night) / 2, 12 monthly means)"),
    "t_max_K":          ("u1", 1.0, 100.0, "K", "Max surface temperature (warmest month, 13:30)"),
    "t_min_K":          ("u1", 1.0, 100.0, "K", "Min surface temperature (coldest month, 01:30)"),
    "t_night_K":        ("u1", 1.0, 100.0, "K", "Night surface temperature (annual mean, 01:30)"),
    "dust_aod":         ("u1", 0.01, 0.0, "", "Dust optical depth (visible, 550 nm, annual mean)"),
    "ice_depth_m":      ("u1", 0.5, 0.0, "m", "Depth to ground ice (class like Mars SWIM; 10 = no ice found)"),
    "ice_depth_cont_m": ("u1", 0.05, 0.0, "m", "Depth to ground ice, metres (0 = ice sheet; 10 = none found)"),
    "ice_depth_source": ("u1", 1.0, 0.0, "", "Source of ice_depth_m: 1 ice sheet, 2 permafrost model, 3 assumed"),
    "sun_elev_max_deg": ("u1", 0.5, 0.0, "°", "Highest noon Sun elevation over a year"),
    "elevation_m":      ("u2", 1.0, -10000.0, "m", "Elevation above sea level"),
    "precip_mm_year":   ("u1", 20.0, 0.0, "mm/year", "Rainfall (mean annual)"),
    "silica_wt_pct":    ("u1", 0.5, 0.0, "wt%", "Silica (SiO2) of exposed rock and soil (53N–53S)"),
    "snow_cover_pct":   ("u1", 0.5, 0.0, "%", "Mean annual snow cover"),
    "land_frac":        ("u1", 0.005, 0.0, "", "Fraction of the cell that is land"),
    "in_mask":          ("u1", 1.0, 0.0, "", "1 = analog search zone (desert, polar ice, arid open land)"),
    "env":              ("u1", 1.0, 0.0, "", "0 outside · 1 polar ice · 2 desert (bare) · 3 arid open"),
}


def earth_sources(relief_source: str) -> dict[str, str]:
    lst = "MODIS Aqua MYD11C3 v061, climatology 2019–2023 (NASA LP DAAC)"
    return {
        "slope_deg": relief_source, "roughness_deg": relief_source, "elevation_m": relief_source,
        "t_mean_K": lst, "t_max_K": lst, "t_min_K": lst, "t_night_K": lst,
        "dust_aod": "NASA MERRA-2 M2TMNXAER DUEXTTAU, climatology 2019–2023 (GES DISC)",
        "ice_depth_m": "Estimated: MODIS MCD12C1 permanent snow/ice → 0 m; permafrost where mean LST (MYD11C3) "
                       "< 0 °C → active-layer depth E·√(thaw degree-days), E = 0.035 (Stefan) [assumption]; "
                       "otherwise no ice; see ice_depth_source",
        "ice_depth_cont_m": "Same estimate as ice_depth_m, in metres (see its source)",
        "ice_depth_source": "1 = ice sheet / glacier (MODIS MCD12C1), 2 = permafrost model (Stefan, MYD11C3), "
                            "3 = assumption (mean surface temperature ≥ 0 °C)",
        "sun_elev_max_deg": "calculated, not measured: highest noon Sun elevation over a year, flat horizon: "
                            "90° − max(0, |lat| − 23.44°) (obliquity of Earth)",
        "precip_mm_year": "GPM IMERG Final monthly v07, 2019–2023 (GES DISC)",
        "silica_wt_pct": "ECOSTRESS ECO_L3G_WPS v001 (NASA LP DAAC)",
        "snow_cover_pct": "MODIS Terra MOD10CM v061, climatology 2019–2023 (NSIDC)",
        "land_frac": "MODIS MCD12C1 v061 2025 (NASA LP DAAC)",
        "in_mask": "MCD12C1 + IMERG (scripts/build_earth_mask.py)",
        "env": "MCD12C1 + IMERG (scripts/build_earth_mask.py)",
    }


# --------------------------------------------------------------------------------------
# Compact table to COMPARE in the browser (ROADMAP 4.9): only the cells of the mask
# --------------------------------------------------------------------------------------
# The app has to score the WHOLE Earth every time Mars or the Moon is clicked. Downloading the 14 M
# cells of the binary by regions would be slow, so a separate table is written with ONLY the search
# cells (in_mask = 1, ~1.4 M) and ONLY the compared columns, with the same encoding:
#   app/data/tierra/match.json     columns, number of cells, variables (tolerances) and tests (weights)
#   app/data/tierra/match.bin.gz   [h3 high u4][h3 low u4][column 1]…  little-endian, cells in ascending H3 order
MATCH_COLUMNS = ["slope_deg", "roughness_deg", "t_mean_K", "t_max_K", "t_min_K", "t_night_K", "dust_aod",
                 "ice_depth_m", "sun_elev_max_deg", "precip_mm_year", "env"]


def match_scoring_meta() -> dict:
    """Scoring blocks of match.json, read from configs/variables.yaml and configs/pruebas.yaml.

    Formula (src/analogs/similarity.py = app/src/scoring.js): soft note 1/(1+(Δ/half_diff)²), or class
    matrix (ice); note of each dimension = weighted mean of its variables; index = weighted mean of
    the dimensions (weight = the largest of its variables); the ranking mixes the cell with its 6
    neighbours. scripts/export_scoring.py rewrites it without touching match.bin.gz.
    """
    import yaml

    from .paths import CONFIGS

    cfg = yaml.safe_load((CONFIGS / "variables.yaml").read_text(encoding="utf-8"))
    pruebas = yaml.safe_load((CONFIGS / "pruebas.yaml").read_text(encoding="utf-8"))["pruebas"]
    key = lambda x: format(float(x), "g")  # noqa: E731  0.5 → "0.5", 3 → "3" (the same as String(n) in JS)
    variables = {}
    for k, v in cfg["variables"].items():
        if k not in MATCH_COLUMNS or v.get("type", "numeric") != "numeric":
            continue
        spec = {"label": v["label"], "unit": v.get("unit", ""), "tolerance": v["tolerance"],
                "dimension": v.get("dimension") or k, "criterion": v.get("criterion", "")}
        if v.get("half_diff"):
            spec["half_diff"] = v["half_diff"]
        if v.get("matrix"):
            spec["matrix"] = {key(a): {key(b): float(x) for b, x in row.items()} for a, row in v["matrix"].items()}
        variables[k] = spec
    return {
        "variables": variables,
        "dimensions": cfg.get("dimensions", {}),
        # names of every variable, also those not compared yet (rocks, lithology, caves), so the app
        # can say in words what a test could not compare
        "labels": {k: v["label"] for k, v in cfg["variables"].items()},
        "area_weight": float((cfg.get("scoring") or {}).get("area_weight", 0.0)),
        # zero by nature on that body, even when its card has no column (no rain on Mars or the Moon;
        # no airborne dust on the airless Moon): counted as 0 in both directions (app/src/scoring.js)
        "zero_on_target": {"precip_mm_year": ["mars", "moon"], "dust_aod": ["moon"]},
        "pruebas": {k: {"label": v["label"], "weights": v["weights"], "test_validity": v.get("test_validity", "")}
                    for k, v in pruebas.items()},
    }


def write_match_table(df: pd.DataFrame) -> dict:
    import gzip
    import json

    from .export import _quantize
    from .paths import APP_DATA

    sel = df[df["in_mask"] == 1].copy()
    ids = np.array([h3i.str_to_int(h) for h in sel["h3"]], dtype=np.uint64)
    order = np.argsort(ids)
    ids = ids[order]
    blobs = [(ids >> np.uint64(32)).astype("<u4").tobytes(), (ids & np.uint64(0xFFFFFFFF)).astype("<u4").tobytes()]
    cols = []
    for name in MATCH_COLUMNS:
        d, s, o, u, lab = EARTH_WEB_COLUMNS[name]
        blobs.append(_quantize(sel[name].to_numpy()[order], d, s, o).tobytes())
        cols.append({"name": name, "dtype": d, "scale": s, "offset": o, "unit": u, "label": lab})
    out = APP_DATA / "tierra"
    out.mkdir(parents=True, exist_ok=True)
    (out / "match.bin.gz").write_bytes(gzip.compress(b"".join(blobs), compresslevel=9, mtime=0))

    meta = {
        "_aviso": "",
        "n_cells": int(len(ids)),
        "h3_resolution": int(h3i.get_resolution(int(ids[0]))),
        "cells": "in_mask = 1 (analog search zone), ascending H3 index; ids as two u4 blocks (high, low 32 bits)",
        "encoding": "gzip; blocks: h3 high u4, h3 low u4, then one block per column; value = stored*scale + offset; "
                    "stored = max of dtype means no data",
        "columns": cols,
        **match_scoring_meta(),
    }
    (out / "match.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    log(f"match.bin.gz: {len(ids):,} search cells, {(out / 'match.bin.gz').stat().st_size / 1e6:.1f} MB")
    return meta


# Short labels for the app's card (same scheme as MARS_DISPLAY / MOON_DISPLAY in export.py)
EARTH_DISPLAY: dict[str, dict] = {
    "slope_deg": {"short_source": "ETOPO"},
    "roughness_deg": {"short_source": "ETOPO"},
    "elevation_m": {"short_source": "ETOPO"},
    "t_mean_K": {"short_source": "MODIS"},
    "t_max_K": {"short_source": "MODIS"},
    "t_min_K": {"short_source": "MODIS"},
    "t_night_K": {"short_source": "MODIS"},
    "dust_aod": {"short_source": "MERRA-2"},
    "sun_elev_max_deg": {"short_source": "calc."},
    "ice_depth_m": {"source_column": "ice_depth_source"},
    "ice_depth_cont_m": {"source_column": "ice_depth_source"},
    "ice_depth_source": {"codes": {"1": "ice sheet", "2": "permafrost model", "3": "assumed"}},
    "precip_mm_year": {"short_source": "IMERG"},
    "silica_wt_pct": {"short_source": "ECOSTRESS"},
    "snow_cover_pct": {"short_source": "MODIS"},
    "land_frac": {"short_source": "MODIS"},
    "in_mask": {"short_source": "mask"},
    "env": {"short_source": "mask", "codes": {"0": "outside", "1": "polar ice", "2": "desert", "3": "arid open"}},
}
