"""SINGLE CATALOGUE of the project's data: which folder is what, where it comes from and how it is used.

Every dataset lives in  <DATA>/raw/<body>/<folder>/   (DATA = analogs.paths.DATA)
and this file is the only list of those folders. It is used by:
  scripts/importar_datos.py   to know where each file of a zip or USB stick goes
  scripts/inventario.py       to say what is present, what is missing and to write <DATA>/LEEME.md
If you add a dataset: add a line here (and its download in the script of its body).
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Dataset:
    body: str            # moon | mars | earth
    folder: str          # name of the folder inside raw/<body>/
    product: str         # official product
    what: str            # what it contains, in one sentence
    variables: str       # card columns that come from it
    resolution: str      # native spatial resolution
    time: str            # how time is treated (fixed / climatology / one year…)
    reading: str         # how to read it: format, scale, "no data" values
    source: str          # official site or service
    download: str        # how it is downloaded
    size: str            # approximate size
    processed_by: str    # code that turns it into cards


C = Dataset  # short name for the table

DATASETS: list[Dataset] = [
    # ================================================================== EARTH
    C("earth", "mcd12c1", "MODIS MCD12C1 v061 (2025)",
      "Land cover: % of each IGBP class (17 classes) in each cell",
      "mask: in_mask, env (polar ice / desert / arid open land)", "0.05° (~5.6 km)", "FIXED: one year (2025)",
      "HDF4. SDS 'Land_Cover_Type_1_Percent' (3600×7200×17, uint8, %); index = IGBP class (0 water, 7 open shrubland, "
      "10 grassland, 15 snow/ice, 16 barren)", "NASA LP DAAC (Earthdata)",
      "scripts/download_earth.py mask", "1.2 GB", "scripts/build_earth_mask.py"),
    C("earth", "imerg_monthly", "GPM IMERG Final monthly v07 (GPM_3IMERGM)",
      "Monthly rainfall", "precip_mm_year (+ the aridity condition of the mask)", "0.1° (~11 km)",
      "CLIMATOLOGY 2019–2023 (60 months): mean rate × hours in a year",
      "HDF5. 'Grid/precipitation' (1, 3600 lon, 1800 lat), mm/h, ascending lat; negative = no data",
      "NASA GES DISC (Earthdata)", "scripts/download_earth.py mask", "1.1 GB", "build_earth_mask.py → earth.py"),
    C("earth", "srtmgl30", "NASA SRTMGL30 v002",
      "Relief at 30″, from 60° N to 56° S (27 tiles in GTOPO30 format)", "elevation_m, slope_deg, roughness_deg",
      "30″ (~0.93 km)", "FIXED (year 2000)",
      "Zip with a headerless .DEM: int16 big-endian, 4800×6000; the name gives the NW corner (W020N40); 0 = sea",
      "NASA LP DAAC (Earthdata)", "scripts/download_earth.py dem", "0.26 GB", "src/analogs/earth.py"),
    C("earth", "etopo2022_30s", "NOAA ETOPO 2022 v1, 30″, surface",
      "Global relief (includes the Arctic and Antarctica): fills what SRTMGL30 does not cover",
      "elevation_m, slope_deg, roughness_deg (only where there is no SRTMGL30)", "30″ (~0.93 km)", "FIXED",
      "GeoTIFF float32 43200×21600; includes bathymetry (sea < 0): at the poles only values > 0 m are used",
      "NOAA NCEI (no account)", "scripts/download_earth.py dem", "1.6 GB", "src/analogs/earth.py"),
    C("earth", "etopo2022_15s", "NOAA ETOPO 2022 v1, 15″, surface (15°×15° tiles)",
      "Global relief at ~460 m: SAME baseline as MOLA 128 px/° (Mars) and LOLA ldem_64 (Moon)",
      "slope_deg, roughness_deg, elevation_m (H3 grid: earth_grid.py)", "15″ (~0.46 km)", "FIXED",
      "GeoTIFF float32 3600×3600 per tile; name = upper-left corner (N30E000); includes "
      "bathymetry: only the land pixels according to MCD12C1 are used", "NOAA NCEI (no account)",
      "scripts/download_earth.py dem15 (only the 226 tiles with land)", "4.6 GB", "src/analogs/earth_grid.py"),
    C("earth", "myd11c3", "MODIS Aqua MYD11C3 v061",
      "Surface temperature, monthly, by day (13:30) and by night (01:30)", "t_mean_K, t_max_K, t_min_K",
      "0.05° (~5.6 km)", "CLIMATOLOGY 2019–2023: 12 monthly means → mean, warmest month (day), coldest month (night)",
      "HDF4. 'LST_Day_CMG' and 'LST_Night_CMG' uint16 × 0.02 = K; 0 = no data",
      "NASA LP DAAC (Earthdata)", "scripts/download_earth.py temp", "4.2 GB", "src/analogs/earth.py"),
    C("earth", "merra2_dust", "NASA MERRA-2 M2TMNXAER v5.12.4 (OPeNDAP subset)",
      "Aerosol optical depth at 550 nm: dust only (DUEXTTAU) and total (TOTEXTTAU), monthly",
      "dust_aod, dust_aod_max, total_aod", "0.5° × 0.625° (~55 km)",
      "CLIMATOLOGY 2019–2023: annual mean and dustiest month",
      "netCDF4/HDF5 (subset to 4 variables). 'DUEXTTAU', 'TOTEXTTAU' (1, 361 lat, 576 lon); lat −90…90, lon −180…179.375",
      "NASA GES DISC, Earthdata OPeNDAP service", "scripts/download_earth.py polvo", "~90 MB", "src/analogs/earth.py"),
    C("earth", "ecostress_wps", "ECOSTRESS ECO_L3G_WPS v001",
      "Weight percent of silica (SiO₂) of exposed rock, sand and soil: first mineral map of the arid regions",
      "silica_wt_pct", "0.01° (~1.1 km), from 53° N to 53° S", "FIXED (mean 2023–2024)",
      "GeoTIFF; aggregated to 0.05° with a mean (rasterio.warp.reproject, Resampling.average)",
      "NASA LP DAAC (Earthdata)", "scripts/download_earth.py silice", "2.5 GB", "src/analogs/earth.py"),
    C("earth", "mod10cm", "MODIS Terra MOD10CM v061",
      "Monthly snow cover (% of the cell)", "snow_cover_pct, snow_months", "0.05° (~5.6 km)",
      "CLIMATOLOGY 2019–2023: mean annual % and number of months above 50 %",
      "HDF4. 'Snow_Cover_Monthly_CMG' uint8, 0–100 = %; > 100 = codes (night, cloud, water, no data)",
      "NASA NSIDC (Earthdata)", "scripts/download_earth.py nieve", "~120 MB", "src/analogs/earth.py"),

    # ================================================================== MOON (docs/06_datos_luna.md)
    C("moon", "diviner_gcp", "LRO Diviner GCP", "Temperature per tile and local time (whole Moon)",
      "t_mean_K, t_max_K, t_min_K", "0.5° (~15 km)", "MEAN OF THE WHOLE MISSION per local time (typical lunar day)",
      ".tab tables by 10° latitude bands; column tbol; −9999 = no data", "PDS Geosciences",
      "scripts/download_moon.py", "2.7 GB", "src/analogs/moon.py"),
    C("moon", "diviner_prp", "LRO Diviner PRP (south pole)", "Temperatures and ice depth, south of −76°",
      "t_mean_K, t_max_K, ice_depth_m", "~0.5 km", "MEAN OF THE WHOLE MISSION",
      ".tab table; ice_depth −999 = deeper than 2.87 m (NOT no data); 0 = ice at the surface", "PDS Geosciences",
      "scripts/download_moon.py", "0.6 GB", "src/analogs/moon.py"),
    C("moon", "lola_ldem64", "LRO LOLA LDEM 64 px/°", "Global relief", "slope_deg, roughness_deg (computed)",
      "1/64° (~0.47 km)", "FIXED", "PDS3 .img + .lbl", "PDS Geosciences", "scripts/download_moon.py", "0.5 GB",
      "src/analogs/moon.py"),
    C("moon", "pgda_south_pole", "NASA PGDA product 90", "Slope and roughness at several scales, permanent shadow, 80 m relief (80–90° S)",
      "psr_frac (permanent shadow); slope cross-check", "20 m – 1 km (polar stereographic)", "FIXED",
      "GeoTIFF (COG), polar stereographic projection in metres", "NASA Goddard PGDA", "scripts/download_moon.py",
      "0.35 GB", "src/analogs/moon.py"),
    C("moon", "lunar_prospector_grs", "Lunar Prospector GRS", "Composition: FeO, SiO₂, Al₂O₃, TiO₂, MgO, CaO, K, Th, U",
      "feo_wt_pct, tio2_wt_pct, silica_wt_pct, th_ppm…", "2° (~60 km)", "FIXED (mission 1998–99)",
      ".tab table + .fmt; units [verify]", "PDS Geosciences", "scripts/download_moon.py", "11 MB", "src/analogs/moon.py"),
    C("moon", "diviner_rocks", "LRO Diviner rock abundance", "Rocks at the surface, 60° N–60° S", "rock_abundance_pct",
      "1/32° (~0.95 km)", "FIXED", "PDS3 .img + .lbl", "PDS Geosciences", "scripts/download_moon.py", "85 MB",
      "src/analogs/moon.py"),
    C("moon", "usgs_geology", "USGS Unified Geologic Map of the Moon", "Geologic map (for detailed site cards)",
      "— (detail)", "1:5M", "FIXED", "GIS zip (shapefiles)", "USGS Astrogeology", "scripts/download_moon.py", "0.2 GB",
      "not used yet"),
    C("moon", "lroc_pits", "LROC Pits Atlas", "278 pits (possible lava tubes) with coordinates", "caves, pit_dist_km",
      "points", "FIXED", "CSV", "LROC (ASU)", "scripts/download_moon.py", "<1 MB", "src/analogs/moon.py"),

    # ================================================================== MARS (src/analogs/download.py)
    C("mars", "mola_megdr_16ppd", "MGS MOLA MEGDR 16 px/°", "Global relief", "slope_deg, roughness_deg, elevation_m",
      "1/16° (~3.7 km)", "FIXED", "PDS3 .img int16 big-endian 5760×2880 + .lbl", "PDS Geosciences",
      "scripts/download_data.py mola", "33 MB", "src/analogs/mars.py"),
    C("mars", "mola_megdr_128ppd", "MGS MOLA MEGDR 128 px/° (tiles)", "Fine relief of the whole planet between ±88°",
      "slope_deg, roughness_deg, elevation_m, mola_measured_frac",
      "1/128° (~0.46 km)", "FIXED", "PDS3 .img by tiles", "PDS Geosciences", "scripts/download_data.py mola128_all",
      "3.1 GB", "src/analogs/mars_grid.py"),
    C("mars", "mola_megdr_polar128", "MGS MOLA polar 128 px/°", "Relief of the poles", "slope_deg (poles)",
      "~0.46 km", "FIXED", "PDS3 .img", "PDS Geosciences", "scripts/download_data.py mola_polar", "0.6 GB",
      "src/analogs/mars_grid.py"),
    C("mars", "tes_thermal_inertia", "MGS TES thermal inertia", "Thermal inertia by day and by night + masks",
      "thermal_inertia_day_SI, thermal_inertia_night_SI", "1/20° (~3 km)", "FIXED",
      "PDS3 .img int16 big-endian 7200×3600; 0 = no data", "PDS Geosciences", "scripts/download_data.py tes", "~0.2 GB",
      "src/analogs/mars_grid.py"),
    C("mars", "grs_special", "Mars Odyssey GRS/NS", "Epithermal neutron flux (hydrogen)", "ns_epithermal_cps",
      "0.5°", "FIXED", ".tab table; −99.999 = no data", "PDS Geosciences", "scripts/download_data.py grs", "small",
      "src/analogs/mars_grid.py"),
    C("mars", "grs_elements", "Mars Odyssey GRS elements", "H₂O, Cl, Fe, Si, K, Th", "grs_*_wt_pct / ppm",
      "5° (~300 km)", "FIXED", ".tab table; 9999.999 = no data; no data north of ~45°", "PDS Geosciences",
      "scripts/download_data.py grs_elements", "small", "src/analogs/mars_grid.py"),
    C("mars", "tes_atmos_my26", "MGS TES atmosphere, Mars Year 26", "5.29 million retrievals: dust, ice, surface T and P",
      "dust_aod, t_max_K, t_mean_K (day part)", "single retrievals → 5° grid", "ONE MARS YEAR (MY26), ~14 h only",
      ".dat text; binned to a 5° grid (mars.py)", "PDS Atmospheres (NMSU)", "scripts/download_data.py tes_atmos",
      "0.5 GB", "src/analogs/mars_grid.py"),
    C("mars", "mcs_tsurf_my31", "MRO MCS surface temperature (MY31)", "Temperature by day (~15 h) and by night (~03 h)",
      "t_mean_K (night part), t_night_K", "profiles → 5° grid", "ONE MARS YEAR (MY31), sampled", "small CSV files (src/analogs/mcs.py)",
      "PDS Atmospheres (NMSU)", "scripts/download_data.py mcs_tsurf", "a few MB", "src/analogs/mars_grid.py"),
    C("mars", "swim2_ice", "SWIM 2.0 (shallow ice)", "Consistency with ice at 0–1 m, 1–5 m and > 5 m", "ice_depth_m",
      "~3 km, ±60°", "FIXED", "GeoTIFF (see src/analogs/download.py)", "Planetary Science Institute", "scripts/download_data.py swim",
      "small", "src/analogs/mars_grid.py"),
]

BODY_ALIASES = {"moon": "moon", "luna": "moon", "mars": "mars", "marte": "mars", "earth": "earth", "tierra": "earth"}


def by_body(body: str) -> list[Dataset]:
    return [d for d in DATASETS if d.body == body]


def known_folders() -> dict[str, str]:
    """folder → body (to place loose files of a zip)."""
    return {d.folder: d.body for d in DATASETS}
