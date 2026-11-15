"""Mars climate extras for the card grid: solar energy for solar panels and mean near-surface wind.

Both are added at export time (scripts/export_mars_web.py) from data already in the grid plus two small
inputs, so the 18-minute grid build does not need to be rerun.

1. solar_kwh_m2_sol — mean daily solar energy on a HORIZONTAL panel, averaged over a Mars year
   [kWh m⁻² sol⁻¹]. Calculated, not measured: Appelbaum & Flood (1990) model (NASA TM-102299 and
   the 1991 update, TM-105216), the standard NASA model for photovoltaic arrays on Mars:
       G_h = G_ob · cos z · f(z, τ, albedo) / (1 − albedo)
       G_ob = 590 · (1 + e·cos(Ls − 248°))² / (1 − e²)²     beam irradiance at the top of the atmosphere
   f = normalised net flux (Table III of the 1991 update, albedo 0.1 and 0.4, interpolated linearly in
   albedo), τ = dust optical depth of the cell (TES MY26, visible, annual mean: column `dust_aod`),
   albedo from the NASA Ames MGCM surface map (2°). Integrated over a full year (time-weighted in Ls:
   dt ∝ r²) and over each sol. Assumptions: flat horizon, annual-mean dust (no dust storms; MY26 had
   none), no shading by terrain.

2. wind_mean_m_s — annual mean near-surface wind speed [m s⁻¹] from the NASA Ames FV3-based Mars
   Global Climate Model, Beta Output Release 1 (c48 reference simulation, 2° × 2°, year 6), file
   atmos_average_zstd.nc (5-sol averages interpolated to standard heights above the surface).
   Model output, not a measurement. Mean of |(u, v)| at the lowest model level of the 5-sol averages,
   so it is a LOWER BOUND of the mean instantaneous speed (winds that turn between day and night
   partly cancel in a 5-sol mean vector; gusts are averaged out).

3. wind_stress_mPa — annual mean surface wind stress [mPa] from the same file (`stress`, averaged as a
   magnitude, so no cancellation). τ = ρ·u*²: what lifts dust and loads structures. Mars air is ~60×
   thinner than Earth's, so the same speed pushes ~60× less; the stress already includes that, so it
   is the quantity to compare with Earth (speed alone would mislead).

Cross-check (2026-11-15): the MGCM's own surface solar flux (swdnflx_sfc) agrees with solar_kwh_m2_sol
within ~5–15 % at Jezero, Gale, Meridiani, Arcadia, Phoenix, Utopia and the south pole (the MGCM uses a
background dust climatology and includes the altitude; ours uses the cell's TES dust).
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from .paths import RAW

MGCM_DIR = RAW / "mars" / "ames_mgcm_fv3beta"
FLUX_DIR = RAW / "mars" / "appelbaum_flood"

# Mars orbit (Appelbaum & Flood 1990)
ECC = 0.093377
LS_PERIHELION = 248.0
G_MEAN = 590.0           # W m⁻², mean beam irradiance at the top of the Martian atmosphere
OBLIQUITY = 25.19        # deg
SOL_H = 24.6597          # hours in a sol


# --- 1. Solar energy ------------------------------------------------------------------------------
def _flux_table(albedo: str) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Normalised net flux table → (taus, zeniths 0..89° every 1°, f[tau, z])."""
    t = pd.read_csv(FLUX_DIR / f"netflux_al_{albedo}_table_iii_1991_update.csv")
    taus = t["tau"].to_numpy(float)
    z5 = np.array([float(c) for c in t.columns[1:]])
    f5 = t.iloc[:, 1:].to_numpy(float)
    if albedo == "0-1":
        # Typo in the transcribed table: tau 2.1, z 55° reads 0.339 between 0.431 and 0.364
        # (smooth everywhere else) → take the mean of its neighbours.
        i, j = int(np.where(taus == 2.1)[0][0]), int(np.where(z5 == 55)[0][0])
        if f5[i, j] < f5[i, j + 1]:
            f5[i, j] = 0.5 * (f5[i, j - 1] + f5[i, j + 1])
    z1 = np.arange(90.0)
    f1 = np.stack([np.interp(z1, z5, row) for row in f5])   # beyond 85°: the 85° value (tiny energy)
    return taus, z1, f1


def _zenith_weights(lats: np.ndarray, n_ls: int = 360, n_hours: int = 96) -> np.ndarray:
    """For each latitude: energy weights per 1° zenith bin, W[lat, z] = Σ G_ob·cos z·dt over a year,
    normalised so that Σ_z W · f(z)/(1−al) gives the mean irradiance in W m⁻²."""
    ls = (np.arange(n_ls) + 0.5) * 360.0 / n_ls
    # time spent per Ls step ∝ r² ∝ 1 / (1 + e cos(Ls − Ls_p))²  (Kepler's second law)
    dt = 1.0 / (1 + ECC * np.cos(np.radians(ls - LS_PERIHELION))) ** 2
    dt /= dt.sum()
    gob = G_MEAN * (1 + ECC * np.cos(np.radians(ls - LS_PERIHELION))) ** 2 / (1 - ECC ** 2) ** 2
    dec = np.arcsin(np.sin(np.radians(OBLIQUITY)) * np.sin(np.radians(ls)))
    h = np.radians((np.arange(n_hours) + 0.5) * 360.0 / n_hours - 180.0)    # hour angle over a sol
    phi = np.radians(lats)[:, None, None]
    cosz = (np.sin(phi) * np.sin(dec)[None, :, None]
            + np.cos(phi) * np.cos(dec)[None, :, None] * np.cos(h)[None, None, :])
    day = cosz > 0
    zbin = np.clip(np.degrees(np.arccos(np.clip(cosz, -1, 1))).astype(int), 0, 89)
    w = np.where(day, gob[None, :, None] * cosz * dt[None, :, None] / n_hours, 0.0)
    out = np.zeros((len(lats), 90))
    for k in range(len(lats)):
        out[k] = np.bincount(zbin[k][day[k]], weights=w[k][day[k]], minlength=90)
    return out


def solar_kwh_m2_sol(lat: np.ndarray, tau: np.ndarray, albedo: np.ndarray, chunk: int = 200_000) -> np.ndarray:
    """Mean daily energy on a horizontal surface over a Mars year [kWh m⁻² sol⁻¹] (NaN where tau is NaN)."""
    lat = np.asarray(lat, float)
    tau = np.asarray(tau, float)
    al = np.clip(np.nan_to_num(np.asarray(albedo, float), nan=0.25), 0.1, 0.4)
    taus, _, f01 = _flux_table("0-1")
    taus4, _, f04 = _flux_table("0-4")
    assert np.allclose(taus, taus4)
    lat_grid = np.round(np.arange(-90, 90.01, 0.25), 2)
    W = _zenith_weights(lat_grid)                                     # [lat, z]
    li = np.clip(np.round((lat + 90) / 0.25).astype(int), 0, len(lat_grid) - 1)
    out = np.full(lat.shape, np.nan)
    ok = np.flatnonzero(np.isfinite(tau) & np.isfinite(lat))
    for a in range(0, len(ok), chunk):
        idx = ok[a:a + chunk]
        t = np.clip(tau[idx], taus[0], taus[-1])
        j = np.clip(np.searchsorted(taus, t) - 1, 0, len(taus) - 2)
        u = ((t - taus[j]) / (taus[j + 1] - taus[j]))[:, None]
        f_a = (1 - u) * f01[j] + u * f01[j + 1]                       # [cell, z] at albedo 0.1
        f_b = (1 - u) * f04[j] + u * f04[j + 1]                       # at albedo 0.4
        s = ((al[idx] - 0.1) / 0.3)[:, None]
        f = (1 - s) * f_a + s * f_b
        mean_w = (W[li[idx]] * f).sum(axis=1) / (1 - al[idx])         # W m⁻², mean over the year
        out[idx] = mean_w * SOL_H / 1000.0                            # kWh m⁻² per sol
    return out


# --- MGCM 2° fields: read and look up ---------------------------------------------------------------
def _nc(path: Path):
    from scipy.io import netcdf_file
    return netcdf_file(str(path), "r", mmap=True)


def _lookup_2deg(field: np.ndarray, lat_c: np.ndarray, lon_c: np.ndarray,
                 lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    """Bilinear interpolation of a regular lat/lon field (cell centres, lon 0–360, periodic) at points."""
    lon360 = np.mod(lon, 360.0)
    dlat, dlon = lat_c[1] - lat_c[0], lon_c[1] - lon_c[0]
    fy = np.clip((lat - lat_c[0]) / dlat, 0, len(lat_c) - 1.000001)
    fx = (lon360 - lon_c[0]) / dlon
    y0 = np.floor(fy).astype(int)
    x0 = np.floor(fx).astype(int)
    wy, wx = fy - y0, fx - x0
    y1 = np.minimum(y0 + 1, len(lat_c) - 1)
    x0m, x1m = np.mod(x0, len(lon_c)), np.mod(x0 + 1, len(lon_c))
    return ((1 - wy) * (1 - wx) * field[y0, x0m] + (1 - wy) * wx * field[y0, x1m]
            + wy * (1 - wx) * field[y1, x0m] + wy * wx * field[y1, x1m])


CLIMATE_COLUMNS = ("solar_kwh_m2_sol", "wind_mean_m_s", "wind_stress_mPa")
WIND_FILE = MGCM_DIR / "03340.atmos_average_zstd.nc"   # netCDF-4 (HDF5): read with h5py


def _mgcm_annual(name_or_fn) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Time-weighted annual mean of a 2-D MGCM field (or of fn(file, t) for each 5-sol average).
    Returns (field[lat, lon], lat centres, lon centres 0–360)."""
    import h5py
    with h5py.File(WIND_FILE, "r") as f:
        dt = f["average_DT"][:].astype(float)
        acc = np.zeros((f["lat"].shape[0], f["lon"].shape[0]))
        for t in range(len(dt)):
            v = name_or_fn(f, t) if callable(name_or_fn) else f[name_or_fn][t].astype(float)
            acc += dt[t] * v
        return acc / dt.sum(), f["lat"][:].astype(float), f["lon"][:].astype(float)


def mgcm_wind(lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    """Annual mean near-surface wind speed [m/s]: mean of |(u, v)| at the lowest model level over the
    133 five-sol averages of the year (bilinear from the 2° grid)."""
    speed, la, lo = _mgcm_annual(lambda f, t: np.hypot(f["ucomp_bot"][t].astype(float), f["vcomp_bot"][t].astype(float)))
    return _lookup_2deg(speed, la, lo, np.asarray(lat, float), np.asarray(lon, float))


def mgcm_stress_mpa(lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    """Annual mean surface wind stress [mPa] (τ = ρ·u*², what lifts dust and loads structures; unlike
    the speed it does not depend on the air density, so it can be compared with Earth)."""
    st, la, lo = _mgcm_annual("stress")
    return _lookup_2deg(st, la, lo, np.asarray(lat, float), np.asarray(lon, float)) * 1000.0


def mgcm_surface_solar_kwh(lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    """Cross-check only: the MGCM's own annual-mean surface downward solar flux, in kWh m⁻² sol⁻¹
    (background dust climatology, two-stream radiative transfer)."""
    sw, la, lo = _mgcm_annual("swdnflx_sfc")
    return _lookup_2deg(sw, la, lo, np.asarray(lat, float), np.asarray(lon, float)) * SOL_H / 1000.0


def cell_latlon(h3_ids) -> tuple[np.ndarray, np.ndarray]:
    """Centre of each H3 cell (planetocentric lat/lon on Mars, as the grid uses)."""
    import h3
    ll = np.array([h3.cell_to_latlng(h) for h in h3_ids], dtype=float)
    return ll[:, 0], ll[:, 1]


def add_mars_climate(df: pd.DataFrame, lat: np.ndarray, lon: np.ndarray) -> pd.DataFrame:
    """Add solar_kwh_m2_sol and wind_mean_m_s to a Mars card table (needs column dust_aod)."""
    df = df.copy()
    df["solar_kwh_m2_sol"] = solar_kwh_m2_sol(lat, df["dust_aod"].to_numpy(float), mgcm_albedo(lat, lon))
    df["wind_mean_m_s"] = mgcm_wind(lat, lon)
    df["wind_stress_mPa"] = mgcm_stress_mpa(lat, lon)
    return df


def mgcm_albedo(lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    f = _nc(MGCM_DIR / "03340.fixed.nc")
    alb = np.array(f.variables["alb"][:], dtype=float)
    return _lookup_2deg(alb, np.array(f.variables["lat"][:], float), np.array(f.variables["lon"][:], float), lat, lon)
