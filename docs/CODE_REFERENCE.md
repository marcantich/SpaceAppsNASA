# Code reference

What each module does, its main functions and who calls it. The overall picture is in
[`ARCHITECTURE.md`](ARCHITECTURE.md); the formulas are in [`METHODOLOGY.md`](METHODOLOGY.md).

**Contents:** [1. Configuration](#1-configuration-configs) · [2. Python package](#2-python-package-srcanalogs) ·
[3. Scripts](#3-scripts-scripts) · [4. Web app](#4-web-app-appsrc) · [5. App data](#5-app-data-appdata) ·
[6. Tests](#6-tests-tests) · [7. Common tasks](#7-common-tasks)

---

## 1. Configuration (`configs/`)

| File | Content | Read by |
|---|---|---|
| `variables.yaml` | The single list of card variables. Per variable: `label`, `unit`, `type`, `dimension`, `half_diff` (tolerance of the soft note), `matrix` (similarity between classes), `tolerance` (old linear formula; also the rover margins), `criterion` (why that tolerance) and `sources` per body. Also the blocks `dimensions`, `scoring.area_weight`, `operability` and `bodies` (gravity, pressure, day length) | `config.py`, `earth_grid.match_scoring_meta` → `match.json` → the app |
| `pruebas.yaml` | The tests ("what do you want to test?"): `label`, `weights` over variables, `test_validity` (what Earth does not reproduce in that test) | Same |

After editing either file: `python scripts/export_scoring.py`, then reload the page.

---

## 2. Python package (`src/analogs/`)

### Infrastructure

| Module | What it does | Main names |
|---|---|---|
| `paths.py` | Where everything is. Finds the data folder (`ANALOGS_DATA_DIR` → `~/SpaceAppsData` → `<repo>/data`) | `ROOT`, `DATA`, `RAW`, `INTERIM`, `PROCESSED`, `CATALOGS`, `CONFIGS`, `APP_DATA`, `OUTPUTS` |
| `config.py` | Reads the two YAML files | `load_variables()`, `load_pruebas()` |
| `catalog.py` | Catalogue of the raw datasets: folder, product, variables it feeds, resolution, how time is treated, how to read it. Used to place imported files and to write the inventory | `DATASETS`, `by_body()`, `known_folders()` |

### Step 1 — download

| Module | What it does | Main names |
|---|---|---|
| `download.py` | Mars datasets: URLs and file lists (MOLA, TES, GRS, SWIM, TES atmosphere, MCS). Resumable; writes `MANIFEST.csv` | `DATASETS`, `download(keys)`, `mola128_tile(lat, lon)`, `MOLA128_ALL_TILES` |
| `mcs.py` | MRO MCS surface temperature: samples one Earth day in 10 of Mars Year 31 and keeps only the surface-temperature columns (30 GB → a few MB) | `download_mcs_tsurf()`, `extract_tsurf()` |

The Moon and Earth downloads are self-contained scripts (`scripts/download_moon.py`,
`scripts/download_earth.py`).

### Step 2 — card grids

| Module | What it does | Main names |
|---|---|---|
| `mars.py` | Readers of the raw PDS products (PDS3 images, GRS tables, TES atmosphere binning). Constants: Mars radius, obliquity, dust conversion factor 2.6 | `read_pds3_image()`, `read_grs_table()`, `bin_tes_atmosphere()`, `sun_elevation_max()` |
| `mars_grid.py` | **The Mars card grid** (H3 res 5). Also the generic raster → cell machinery reused by Earth | `Grid` (cells + mergeable weighted sums), `assign_cells()`, `weighted_median_groups()`, `process_mola_tile()`, `process_polar()`, `finish_topography()` (plane fit → roughness), `accumulate_fine_raster()` (3×3 sub-pixels), `process_tes_ti()`, `process_swim()`, `ice_depth_from_swim()`, `fill_ice_beyond_swim()`, `apply_polar_limits()`, `process_grs()`, `process_atmosphere()`, `build_mars_grid()`, `build_mars_targets()` |
| `moon.py` | **The Moon card grid** (H3 res 4): relief, temperatures, polar ice, permanent shadow, composition, rocks, pits. `COLUMNS` documents the unit, source and method of every column | `Grid`, `_relief()`, `_temperature()`, `_prp()`, `_psr()`, `_composition()`, `_rocks()`, `_pits()`, `build_moon_grid()`, `build_moon_targets()` |
| `earth.py` | Earth fields on the MODIS 0.05° mesh: temperature climatology, dust, silica, snow, Sun | `load_mask()`, `lst_climatology()`, `merra2_dust()`, `ecostress_silica()`, `snow_climatology()`, `compute_fields()` |
| `earth_grid.py` | **The Earth card grid** (H3 res 6), the permafrost / ice-depth model, the web column encoding and the **search table** with the scoring settings | `EarthGrid`, `process_relief()`, `accumulate_cmg()`, `ice_depth()`, `build_earth_grid()`, `EARTH_WEB_COLUMNS`, `MATCH_COLUMNS`, `match_scoring_meta()`, `write_match_table()` |

### Step 3 — web export

| Module | What it does | Main names |
|---|---|---|
| `export.py` | Writes `app/data/`: the compact binary grids, the site cards and the known analogs | `write_grid_binary()`, `_quantize()`, `ice_depth_class()`, `write_mars_targets()`, `write_body_targets()`, `write_known_analogs()` |
| `mars_climate.py` | Mars solar energy (Appelbaum & Flood) and winds (NASA Ames GCM), added at export time | `solar_kwh_m2_sol()`, `mgcm_wind()`, `mgcm_stress_mpa()`, `mgcm_albedo()`, `add_mars_climate()` |
| `mars_slope_tiles.py` | Pixel-level Mars slope tiles (64 px/°, one byte per pixel with a "measured by the laser" bit) | `build()` |

### Engine

| Module | What it does | Main names |
|---|---|---|
| `similarity.py` | The analog index in Python (the reference implementation, with the tests) | `note_numeric()`, `variable_scores()`, `analog_index()`, `dimensions_of()`, `rank()` |

---

## 3. Scripts (`scripts/`)

Run from the repository root: `.venv\Scripts\python.exe scripts\<name>.py` (Linux / macOS:
`.venv/bin/python scripts/<name>.py`). They are thin wrappers: the logic is in `src/analogs/`.

| Group | Script | What it does |
|---|---|---|
| Download | `download_data.py [keys] [--list]` | Mars datasets |
| | `download_moon.py [--list] [--extras]` | Moon kit |
| | `download_earth.py [mask dem dem15 temp dust silica snow]` | Earth, from Earthdata / NOAA (needs `~/.netrc`) |
| Build | `build_mars_grid.py` | Mars grid + the 12 site cards (~18 min) |
| | `build_moon_grid.py` | Moon grid + the 9 site cards (~3 min) |
| | `build_earth_mask.py` | Earth search mask + map |
| | `build_earth_features.py` | Earth fields on the 0.05° mesh (for `search.py`) |
| | `build_earth_grid.py [--res 6]` | Earth grid; also writes `app/data/tierra/` and the search table |
| Export | `export_mars_web.py` | `app/data/marte/` (adds solar energy and winds) |
| | `export_mars_slope_tiles.py` | `app/data/marte/slope64/` (~5 min) |
| | `export_moon_web.py` | `app/data/luna/` |
| | `export_scoring.py` | Rewrites the scoring block of `match.json` from the YAML files |
| | `make_intro_textures.py` | Small textures of the opening screen |
| Check | `check_grid_binary.py <body> <parquet>` | Export against its source: errors ≤ scale / 2, no-data cells |
| | `recode_grid_binary.py` | Rewrites a published grid with another column definition |
| Data folder | `inventory.py [--readme]` | What is present or missing; writes the data folder's read-me |
| | `import_data.py <zip or folder>` | Puts shared data in the right place |
| | `pack_data.py <body or tables>` | Zips to share data |
| | `list_data.py` | SHA-256 listing of a data folder |
| Tools | `search.py` | Search in the terminal |
| | `rover_route/` | Route replica study: `prep_route` → `fetch_dem` → `match_route` / `free_route` → `plot_*`; `make_presets.py` writes the real rover traverses used by the app |

---

## 4. Web app (`app/src/`)

### Core

| Module | What it does | Main exports |
|---|---|---|
| `main.js` | Wires the app: the two globes, body selectors, the flow click → card → search → cameras, the toolbar. Lines tagged `[rover]`, `[route]`, `[intro]` are the hooks of the other views | — |
| `globe.js` | One Cesium globe for one body: layers, click and hover, markers, hexagon layers, zone boxes, camera flights | `createGlobe(container, body)` |
| `bodies.js` | Per body: ellipsoid, imagery layers (base, detail, relief) with their credits, home view | `BODIES` |
| `coords.js` | Screen ↔ latitude / longitude; planetocentric on Mars and the Moon, geodetic on Earth | `pickLatLon()`, `cartesianToLatLon()`, `latLonToCartesian()`, `formatLatLon()` |
| `data.js` | Loads the target sites and the known analogs | `loadSites()` |
| `intro.js` | Opening screen | — |

### Data readers

| Module | What it does | Main exports |
|---|---|---|
| `grid.js` | Reads a card grid: finds the H3 cell of a point, downloads its region file once, decodes the row | `CardGrid` (`load()`, `cardAt(lat, lon)`) |
| `slopetiles.js` | Mars slope at the clicked point from the ~925 m tiles | `slopeAt(lat, lon)` |

### Comparator

| Module | What it does | Main exports |
|---|---|---|
| `scoring.js` | **The analog index** (pure functions, same formula as `similarity.py`) | `noteOf()`, `makePlan()` (what is compared and with which weights), `scoreCell()`, `areaIndex()`, `valueOn()`, `isZeroOn()` |
| `match.js` | Search tables (Earth: the 1.37 M search cells; Mars and Moon: every cell) and the ranking | `loadScoringMeta()`, `loadTable(body)`, `Matcher` (`plan()`, `scoreAll()`, `scoreOf()`, `neighbourMean()`, `rank()`), `rampColor()` |
| `zones.js` | Search zones: named regions per body and drawn boxes | `ZONES`, `ZONES_BY_BODY`, `zoneContains()`, `zoneSizeKm()`, `makeZone()` |

### Interface

| Module | What it does | Main exports |
|---|---|---|
| `card.js` | Card panel (values grouped by section, unit and source of each), results bar, score dock | `createCardPanel()`, `createResultsBar()`, `createScoreDock()`, `SHORT` |
| `places.js` | Place search box (names or coordinates) and zone menu | `createPlaceSearch()`, `createZoneMenu()`, `parseCoords()` |
| `countries.js` | Country of an Earth point (Natural Earth borders) | `countryAt()`, `preloadCountries()` |

### Rover test planner and Route replica

| Module | What it does | Main exports |
|---|---|---|
| `rover.js` | The planner: status of each part, sites, whole-rover cells, campaign; and its panel | `RoverPlanner` (`evaluate()`, `campaign()`), `createRover()`, `STATUS` |
| `rover-limits.js` | Explains in words what limits a part (physics cap, missing data or the worst variable) | `limitingFactor()` |
| `rover3d.js` | The 3D rover with clickable parts (three.js), loaded only when the view opens | `createRoverView()` |
| `route.js` | Route view: drawing, reading elevation along the route, calling the solver, charts | `createRoute()` |
| `routeSolver.js` | Dynamic-programming search of a path with the same slopes (pure functions) | `solveRoute()`, `compareProfiles()`, `HEADINGS` |

---

## 5. App data (`app/data/`)

| Path | Content | Written by |
|---|---|---|
| `marte/`, `luna/`, `tierra/` | `index.json` (columns, units, sources, regions) + `rNNN.bin.gz`, one per H3 base cell | `export_mars_web.py`, `export_moon_web.py`, `build_earth_grid.py` |
| `marte/objetivos.json`, `luna/objetivos.json` | Cards of the 12 Mars and 9 Moon target sites | Same |
| `tierra/match.json` | Scoring settings (variables, dimensions, tests, `zero_on_target`) + description of the search table | `build_earth_grid.py`, `export_scoring.py` |
| `tierra/match.bin.gz` | Earth search table: 1,374,390 cells × 11 columns | `build_earth_grid.py` |
| `marte/slope64/` | 648 slope tiles | `export_mars_slope_tiles.py` |
| `analogos_conocidos.json` | The 20 known Earth analogs | `export.write_known_analogs` |
| `rover.json`, `rover/` | Rover planner configuration (by hand) and the Perseverance model | By hand |
| `route/presets.json` | Real rover traverses | `rover_route/make_presets.py` |
| `intro/` | Textures of the opening screen | `make_intro_textures.py` |

Format: [`07_card_grid_binary_format.md`](07_card_grid_binary_format.md).

---

## 6. Tests (`tests/`)

| File | Runs with | Covers |
|---|---|---|
| `test_similarity.py` | `python -m pytest` (13 tests) | The index in Python: notes per variable, soft note, class matrix, dimensions, weights, missing data |
| `rover-limits.test.mjs` | `npm test` in `app/` (5 tests) | `limitingFactor()` of the rover planner |

Not covered by automated tests: `scoring.js` and `match.js` (that the JavaScript index equals the
Python one), the readers of the binary grids, `routeSolver.js`.

---

## 7. Common tasks

| I want to… | Do this |
|---|---|
| Change a tolerance or a test weight | Edit `configs/*.yaml` → `python scripts/export_scoring.py` → reload |
| Add a test | Add a block to `configs/pruebas.yaml` → same |
| Add a variable to the comparison | Add it to `configs/variables.yaml`; compute the column in each body's grid builder; add it to the web columns of that body and, for Earth, to `MATCH_COLUMNS` in `earth_grid.py`; rebuild and export |
| Add a target site | Add a row to `data/catalogs/target_sites.csv` → rebuild that body's site cards (`build_*_grid.py`, `export_*_web.py`) |
| Change a rover margin or part | Edit `app/data/rover.json` → reload |
| Change the formula | Change **both** `app/src/scoring.js` and `src/analogs/similarity.py`, and the tests |
| Check an export | `python scripts/check_grid_binary.py <body> <parquet>` |
