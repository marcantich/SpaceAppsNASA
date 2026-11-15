# data/ — the data

```
data/
├── catalogs/    small, made by hand. IN git.
│   ├── target_sites.csv     TARGET sites on the Moon and Mars
│   └── known_analogs.csv    Earth analogs ALREADY known (to mark them and to validate)
├── raw/         STEP 1: as downloaded. Never modified.  NOT in git (only MANIFEST.csv and LISTADO_*.csv)
│   ├── earth/
│   ├── moon/
│   └── mars/
├── interim/     intermediate meshes. Can be deleted and rebuilt.  NOT in git.
└── processed/   STEP 2: the card grids, one row per H3 hexagon (+ the cards of the target sites).
                 mars_h3r5.parquet · luna_h3r4.parquet · Earth grid · fichas_objetivos_<body>.parquet
                 NOT in git (only small CSV summaries)
```

What the app reads (step 3) is not here: it is in [`app/data/`](../app/README.md).

By default the code looks for the data folder in `ANALOGS_DATA_DIR`, then `~/SpaceAppsData`, then this
`data/` folder (`src/analogs/paths.py`). Full guide to the data folder, processing order and reference
numbers: [`docs/08_datos_LEEME.md`](../docs/08_datos_LEEME.md).

## Rules

1. **Large files never go to git.** `.gitignore` already ignores `raw/`, `interim/` and `processed/`. They
   are shared through the team drive (zips made with `scripts/pack_data.py`).
2. If the repository is inside OneDrive / Dropbox, **do not put GBs inside the synced folder**: use a
   local folder outside it and set `ANALOGS_DATA_DIR`.
3. **Every downloaded dataset is listed** in a `MANIFEST.csv` (file, URL, bytes, date) inside its
   `raw/<body>/` folder. It is needed to reproduce the work and to cite the data.
4. SI units and column names **exactly** as in [`configs/variables.yaml`](../configs/variables.yaml).
5. Longitudes −180..180 east; latitudes planetocentric on Mars and the Moon, geodetic WGS84 on Earth.

## Catalogues

| File | Content |
|---|---|
| `target_sites.csv` | Target sites: Apollo landings, Chang'e 4, Chandrayaan-3, Shackleton, the NASA 2024 south-pole candidate regions (coordinates still missing) and 12 Mars sites |
| `known_analogs.csv` | 20 known Earth analogs with what they are analogs of |

## What was downloaded

| Body | Datasets | Record |
|---|---|---|
| Mars | MOLA MEGDR (all 16 tiles of 128 px/deg + polar maps, 16 px/deg), TES thermal inertia, Odyssey GRS element maps and neutron products, TES atmosphere MY26, MRO MCS surface temperature MY31, SWIM 2.0 ice; NASA Ames Mars GCM output and the Appelbaum & Flood tables (`src/analogs/mars_climate.py`). 4.4 GiB + 2.7 GB | [`raw/mars/MANIFEST.csv`](raw/mars/MANIFEST.csv) |
| Moon | LOLA, Diviner (GCP, PRP, rock abundance), Lunar Prospector, PGDA south pole, LROC pits. 88 files, 4.4 GB | [`raw/moon/MANIFEST.csv`](raw/moon/MANIFEST.csv), [`docs/06_datos_luna.md`](../docs/06_datos_luna.md) |
| Earth | NOAA ETOPO 2022, MODIS (MYD11C3, MCD12C1, MOD10CM), GPM IMERG, MERRA-2, ECOSTRESS | `scripts/download_earth.py --list` |

Full list of sources with licences and credits: [`CREDITS.md`](../CREDITS.md).

## Accounts (free, one each)

| Portal | Needed for | Account |
|---|---|---|
| NASA Earthdata | Earth data (MODIS, GPM, MERRA-2, ECOSTRESS…) | Earthdata Login (`~/.netrc`) |
| PDS (NASA) | Moon and Mars (MOLA, TES, GRS, LOLA, Diviner…) | **No** |
| NASA Ames MCMC data portal | Mars climate model output | **No** |

**Passwords never go in the code or in git.**
