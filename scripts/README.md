# scripts/ — what is run

Run them **from the repository root** with the Python of the environment, one command per line
(PowerShell 5.1 has no `&&`): `.venv\Scripts\python.exe scripts\<script>.py`. The logic lives in
`src/analogs/`; the scripts only call it in order.

**Data:** everything is read from and written to the data folder (`src/analogs/paths.py`:
`ANALOGS_DATA_DIR`, else `~/SpaceAppsData`, else `<repo>/data`), with the structure
`raw/<earth|moon|mars>/<folder>/`, `interim/`, `processed/`. Which folder is what:
`src/analogs/catalog.py`. Full data guide: [`docs/08_data_folder_guide.md`](../docs/08_data_folder_guide.md).

## 0 · Manage the data

| Script | What it does |
|---|---|
| `inventory.py [--readme]` | Which datasets are present or missing, GB, rows of each table. `--readme` writes `<DATA>/LEEME.md` |
| `import_data.py <zip/folder> [--dry-run]` | Puts data from a USB stick or a zip in the right place |
| `pack_data.py <earth\|moon\|mars\|tables> --out <folder>` | Makes the zips to share data (`tables` = only the cards) |
| `list_data.py` | SHA-256 listing of a data folder → `LISTADO_<name>.csv` (to compare downloads) |

## 1 · Download → `raw/`

| Script | What it does |
|---|---|
| `download_data.py [mola tes grs …] [--list]` | **Mars** (datasets in `src/analogs/download.py`) |
| `download_moon.py [--list]` | **Moon** (`docs/06_moon_data.md`) |
| `download_earth.py [mask dem dem15 temp dust silica snow] [--list]` | **Earth** from Earthdata / NOAA (needs `~/.netrc`) |

Mars extras downloaded by hand (see `src/analogs/mars_climate.py`): NASA Ames Mars GCM output
(`raw/mars/ames_mgcm_fv3beta/`) and the Appelbaum & Flood net flux tables (`raw/mars/appelbaum_flood/`).

## 2 · Build the card grids → `processed/`

| Script | What it does |
|---|---|
| `build_mars_grid.py` | Mars grid, H3 res 5 (~18 min) + cards of the 12 Mars sites |
| `build_moon_grid.py` | Moon grid, H3 res 4 (~3 min) + cards of the 9 Moon sites |
| `build_earth_mask.py` | Earth search mask (deserts, polar ice, arid open land) + map |
| `build_earth_features.py` | Earth fields on the 0.05° mesh and H3 res 5 (used by `search.py`) |
| `build_earth_grid.py` | Earth grid, H3 res 6; also writes `app/data/tierra/` and the search table |

## 3 · Export to the web → `app/data/`

| Script | What it does |
|---|---|
| `export_mars_web.py` | `app/data/marte/` (adds solar energy and winds) |
| `export_mars_slope_tiles.py` | `app/data/marte/slope64/`: pixel-level slope tiles (~5 min, 121 MB) |
| `export_moon_web.py` | `app/data/luna/` |
| `export_scoring.py` | Rewrites the scoring block of `app/data/tierra/match.json` after changing `configs/*.yaml` |
| `check_grid_binary.py <body> <parquet>` | Checks an export against its source (errors ≤ scale/2, no-data cells) |
| `recode_grid_binary.py luna` | Rewrites a published grid with another column definition, without the parquet |
| `make_intro_textures.py <folder>` | Small textures of the three bodies for the opening screen (`app/data/intro/`) |

## 4 · Other tools

| Script | What it does |
|---|---|
| `search.py [--grid h3r5]` | Search in the terminal: by hand values, similar to a point of Earth or to a Moon / Mars site |
| `rover_route/` | "Route replica" study: find on Earth a path with the slopes of a rover traverse (`prep_route` → `fetch_dem` → `match_route` / `free_route` → `plot_*`; `make_presets.py` writes `app/data/route/presets.json`). Run from inside that folder |
