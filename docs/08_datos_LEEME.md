# README of the data folder · "Earth Analogs for Moon & Mars" (NASA Space Apps 2026)

> **This file goes inside the data folder** (`SpaceAppsData/LEEME.md`). It is written by
> `scripts/inventario.py --leeme` from `docs/08_datos_LEEME.md` in the repository, with the real
> inventory at the end. It is written for people **and for AI assistants**: section 1 is a set of rules
> to follow.

---

## 0. What this is, in 5 lines

1. The project finds **places on Earth that physically resemble** places on the **Moon** and **Mars**
   (bases, landing sites) to test wheels, drills, navigation, etc. there.
2. Satellite data (NASA, NOAA, USGS) are downloaded **once** into `raw/`, turned into **card grids**
   (tables with one row per H3 hexagon, plus the target-site cards) in `processed/`, and exported to the
   web app (`app/data/` in the repository).
3. Similarity is an **index from 0 to 100**: each variable is compared **in its physical units** with a
   soft note (`configs/variables.yaml`) and averaged by dimension with the weights of the chosen test
   (`configs/pruebas.yaml`).
4. The **code** is in the GitHub repository (`https://github.com/pablourioste/SpaceAppsNASA`). The **data**
   are in this folder, **outside git** (they weigh GB).
5. The three bodies are processed and exported (Mars H3 res 5, Moon H3 res 4, Earth H3 res 6).

---

## 1. Rules for anyone (or any assistant) working with this folder

1. **First**, find the repository (the folder with `src/analogs/` and `scripts/`) and this data folder.
   Check that the code sees this folder:
   ```powershell
   .venv\Scripts\python.exe -c "import sys; sys.path.insert(0,'src'); from analogs.paths import DATA; print(DATA)"
   ```
   It must print the path of this folder. If not, see section 2.2.
2. **Never modify or delete anything in `raw/`.** It is what was downloaded, as is. Everything derived
   goes to `interim/` or `processed/` and can be rebuilt.
3. **Never put data in git** or copy them into the repository. **Never read, copy or share `~/.netrc`**
   (it holds its owner's Earthdata password).
4. **Always run with the Python of the repository's environment**: `.venv\Scripts\python.exe` (Windows)
   or `.venv/bin/python`. In **Windows PowerShell 5.1 there is no `&&`**: one command per line.
5. **Follow the order of section 4.** If a step fails because a dataset is missing, check the catalogue
   (`src/analogs/catalog.py`); **never invent data or coordinates**.
6. **Do not change tolerances, weights or thresholds** (`configs/*.yaml`, constants of
   `scripts/build_earth_mask.py`) unless asked: they are the team's decisions, all marked as assumptions.
7. **Conventions**: temperatures in **K**; longitudes **−180 to 180 east**; **planetocentric** latitude on
   the Moon and Mars, **geodetic WGS84** on Earth; SI units unless the column says otherwise (`_pct`,
   `_mm_year`, `_deg`).
8. Mark anything not checked as **[verify]** and any value chosen by the team as **[assumption]**.
9. After processing, **check against the reference numbers of section 6**.
10. To **share data**, use `scripts/pack_data.py` (zips) and, on the other computer,
    `scripts/importar_datos.py` (section 7).

---

## 2. Map of the folder

```
SpaceAppsData/                      ← this folder (DATA)
├── LEEME.md                        ← this file
├── raw/                            STEP 1 · as downloaded. DO NOT TOUCH
│   ├── earth/<folder>/             one dataset per folder (list: section 8)
│   │   └── MANIFEST.csv            which file, from where, how many bytes, when
│   ├── moon/<folder>/  + MANIFEST.csv
│   └── mars/<folder>/  + MANIFEST.csv
├── interim/                        intermediate meshes (.npz): can be deleted and rebuilt
└── processed/                      STEP 2 · CARD GRIDS (.parquet)
    ├── mars_h3r5.parquet             Mars, one row per H3 res-5 hexagon (~9.1 km)
    ├── luna_h3r4.parquet             Moon, one row per H3 res-4 hexagon (~12.3 km)
    ├── Earth grid (H3 res 6, ~6.5 km) and fichas_tierra_*.parquet (0.05° mesh, used by buscar.py)
    ├── earth_mask_h3r*.parquet       Earth search mask per hexagon
    └── fichas_objetivos_<body>.parquet   one row per target site of the Moon / Mars
```

### 2.1 Where this folder must be

The code (`src/analogs/paths.py`) looks for it in this order:
1. Environment variable `ANALOGS_DATA_DIR`.
2. (Windows) the same variable saved with `setx`, even if the terminal was opened before.
3. **`C:\Users\<you>\SpaceAppsData`** (or `~/SpaceAppsData`). **Easiest: copy the folder there.**
4. `<repo>/data`.

### 2.2 If the code does not find it

```powershell
setx ANALOGS_DATA_DIR "D:\path\to\SpaceAppsData"     # then open a NEW terminal
```
**Do not put it inside OneDrive / Dropbox**: they lock the files while syncing.

---

## 3. Preparing the computer (once)

```powershell
git clone https://github.com/pablourioste/SpaceAppsNASA.git
cd SpaceAppsNASA
py -3.12 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe -m pytest -q          # everything must pass
```
Only to **download** from Earthdata (not to use these data): a free account at
https://urs.earthdata.nasa.gov, a `~/.netrc` file with
`machine urs.earthdata.nasa.gov login <user> password <password>` and, under *Applications → Authorized
Apps*, approve **NASA GESDISC DATA ARCHIVE**.

---

## 4. Processing order

| Step | Command | Reads | Writes | What it does |
|---|---|---|---|---|
| 0 | `scripts\inventario.py --leeme` | everything | `LEEME.md` | Says what is present and missing; rewrites this file |
| 1a | `scripts\download_earth.py [group…]` | Earthdata / NOAA | `raw/earth/` | Downloads Earth. Groups: `mask dem temp polvo silice nieve`. Can be rerun |
| 1b | `scripts\download_moon.py` · `scripts\download_data.py` | PDS, PGDA… | `raw/moon/` · `raw/mars/` | Download the Moon and Mars |
| 1c | `scripts\importar_datos.py <zip/folder>` | USB stick | `raw/`, `processed/` | Instead of downloading: puts in place what someone gives you (section 7) |
| 2 | `scripts\build_earth_mask.py` | `mcd12c1`, `imerg_monthly` | `interim/`, `processed/earth_mask_h3r*.parquet`, `outputs/maps/earth_mask.png` | Decides **where to search**: deserts, polar ice and arid land yes; sea, forests, crops, towns, wetlands no |
| 3 | `scripts\build_earth_features.py` | all `raw/earth/` + mask | `processed/fichas_tierra_005deg.parquet`, `_h3r5.parquet` | Earth variables on the 0.05° mesh (used by `buscar.py` and the Earth grid) |
| 4 | `scripts\build_earth_grid.py` | `raw/earth/` + step 3 | Earth grid + `app/data/tierra/` | Earth card grid, H3 res 6, and the search table of the app |
| 5 | `scripts\build_mars_grid.py` | `raw/mars/` | `processed/mars_h3r5.parquet`, `fichas_objetivos_mars.parquet` | Mars card grid (~18 min) and the Mars site cards |
| 6 | `scripts\build_moon_grid.py` | `raw/moon/` | `processed/luna_h3r4.parquet`, `fichas_objetivos_moon.csv` | Moon card grid (~3 min) and the Moon site cards |
| 7 | `scripts\export_mars_web.py`, `export_moon_web.py`, `export_mars_slope_tiles.py` | `processed/` | `app/data/` | Exports for the web app |
| 8 | `scripts\buscar.py [--malla h3r5]` | `processed/` | `outputs/validation/` | **Search in the terminal**: by hand values, similar to a point of Earth or to a Moon / Mars site |

All are run **from the root of the repository** with `.venv\Scripts\python.exe scripts\<script>.py`.

### 4.1 The Earth search mask (step 2), exactly
For each 0.05° cell (MCD12C1 gives the % of each land-cover class):
- **land** = 100 − %water ≥ 50
- **polar ice** = %permanent snow/ice ≥ 50
- **desert** = %barren ≥ 50 (regardless of rain: lava flows, salt flats)
- **arid open land** = %(barren + open shrubland + grassland) ≥ 60 **and** rain < 350 mm/year
- **kept** = land **and** (polar ice **or** desert **or** arid open land). A hexagon is kept if ≥ 25 % of
  its land is inside.

---

## 5. Time and scale: the rules

- **Same baseline on every body** (decision 006): slope and roughness from ~460 m pixels on Mars (MOLA
  128 px/deg), the Moon (LOLA `ldem_64`) and Earth (ETOPO 2022 15″).
- **Fixed** properties (relief, composition, land cover) are used as they are. **Climate** is reduced to
  **typical conditions** (not records): Earth 2019–2023 climatology (`t_mean_K` = mean of the 12 months of
  (day + night)/2, `t_max_K` = warmest month by day, `t_min_K` = coldest month by night); the Moon, the
  mission mean per local time; Mars, one Mars year.

---

## 6. Checks (reference numbers)

| What | Expected value |
|---|---|
| Earth land pixels (0.05°) | **8,510,253**, of which **4,301,556** inside the mask |
| Earth mask (area) | polar ice 10.1 % · desert 13.7 % · arid open land 10.7 % · **total 34.4 %** of the land |
| Earth search cells (H3 res 6) | **1,374,390** (of 14,117,882) |
| Mars cells (H3 res 5) | **2,016,842** |
| Moon cells (H3 res 4) | **288,122** |
| Known analogs inside the Earth mask (`outputs/validation/earth_mask_known_analogs.csv`) | **15 of 20**. Outside, as expected: Río Tinto, Ries, Sudbury, Lonar (geology analogs in vegetated areas) and Kilauea |
| `buscar.py` → [1] → t_mean −63 °C, t_max 270 K, rain 0 (Mars-like) | **none above ~61**: Earth does not reproduce that mean cold with those maxima (a result, not an error) |

---

## 7. Sharing data with the team

| What | How | Size |
|---|---|---|
| **Only the card tables** (enough for `buscar.py`) | `scripts\pack_data.py tables --out E:\` → `tables_processed.zip` | ~0.3 GB |
| Raw data of one body | `scripts\pack_data.py earth --out E:\` (or `moon`, `mars`) → one zip per group of datasets | see section 8 |
| On the receiving computer | `scripts\importar_datos.py E:\ --dry-run` and then without `--dry-run` (takes a zip, a folder of zips or a folder) | — |
| Code | `git pull` / `git push` | — |

**Never** share `~/.netrc` or `.venv` (it does not work on another computer: create it with section 3).
All data are public (NASA, NOAA, USGS): they can be shared within the team without restrictions.

---

## 8. Inventory of this folder (generated)

<!-- INVENTARIO -->

---

## 9. Known data-quality caveats

- IMERG rain overestimates in hyper-arid deserts (Atacama gives 80–260 mm/year; the real value is a few
  mm) [verify].
- ECOSTRESS silica is only reliable on bare rock / soil: in vegetated basaltic areas it comes out high
  (Kilauea ~76 %, while basalt has ~50 %) [verify]. Use it only inside the mask (deserts).
- MERRA-2 dust is a ~55 km reanalysis: regional context, not a way to tell nearby sites apart.
