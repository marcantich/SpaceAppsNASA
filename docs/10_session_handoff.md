# 10 · Session handoff (for a new Claude conversation)

> Written 2026-11-15 at the end of a long session with Claude (Adrià, `adriasolaf`). It summarises what
> was built, **every decision and why**, the conventions, the pitfalls already hit and what is still
> open. Read it together with [`ROADMAP.md`](../ROADMAP.md) (task list, the detail of each task),
> [`docs/decisions/README.md`](decisions/README.md) (decision log), [`docs/07`](07_card_grid_binary_format.md)
> (web data format), [`docs/08`](08_datos_LEEME.md) (data guide, also written for Claude) and
> [`docs/09`](09_criterios_seleccion.md) (selection / scoring criteria).

## 1. The project in one paragraph

NASA Space Apps 2026 challenge *"Identify Earth locations that analog the permanent Moon base
locations and Mars"* (team repo `marcantich/SpaceAppsNASA`, team: Marc, Pablo, Ángel, Adrià…).
A web app with **3D globes (CesiumJS)**: click **any point** of Mars or the Moon → the app finds the
most similar places on Earth (and vice versa: any-to-any), paints Earth by similarity and flies to the
best analog, with a **card** of every variable and its source. A second view, the **Rover test
planner**, says where on Earth each part of a rover can be field-tested. All computing happens **in
the browser** from small pre-computed files; no server.

## 2. Where things are

| What | Where |
|---|---|
| Repo (local) | `C:\Users\adria\OneDrive\Escritorio\NASASPACEAPP\SpaceAppsNASA` (inside OneDrive) |
| Web app | `app/` (Vite 6 + CesiumJS 1.147 + `h3-js`; `npm run dev` → http://localhost:5173) |
| Python engine | `src/analogs/` (+ `scripts/`), venv in `.venv` |
| Data folder | `src/analogs/paths.py`: `ANALOGS_DATA_DIR`, else `~/SpaceAppsData`, else `<repo>/data` (Adrià's machine: `<repo>/data`). Structure `raw/<earth|moon|mars>/…`, `interim/`, `processed/` — **not in git** |
| Data the web reads | `app/data/` (in git): `marte/`, `luna/`, `tierra/` card grids + `match*.json`, `objetivos.json`, `config.json`, `rover.json` … |
| Shared raw data | team Google Drive (zips made with `scripts/pack_data.py`); the Mars zips are in Adrià's `Downloads\spaceapps_mars_data` |
| Deploy | None: the project is run locally (the GitHub Pages workflow was removed on 2026-11-15) |

## 3. How the data flows (the core idea)

```
raw PDS / Earthdata files (GB, on one machine)
   └─ Python: build a CARD GRID = one row per H3 hexagon with every variable   (data/processed/*.parquet)
        └─ Python: export to compact binary, one gzip file per H3 base cell     (app/data/<body>/, MB, in git)
             └─ Browser: click → hexagon → card → similarity vs every cell of the other body → fly to best
```

Like CFD: the raw data are the full flow fields; the cards are the integrated coefficients. Only the
cards go to the web.

## 4. Decisions (and why)

Official log: `docs/decisions/README.md` (001–007). The ones taken in this session:

1. **Stack: CesiumJS** (multi-body globes with correct ellipsoids, real zoom, lat/lon picking).
   Vite **6** because Node is 20.18 (Vite 7 needs ≥ 20.19). Cesium ≥ 1.147 (1.129 broke on `@zip.js`).
2. **Imagery vs data resolution are separate (decision 006).** Imagery as fine as possible
   (Mars CTX ~5 m, Earth Sentinel-2 cloudless 2016 ~10 m, Moon LRO WAC ~100 m; relief: MOLA, LOLA v6
   PNG, ASTER GDEM). The **similarity index uses moderate data at the same scale on every body**
   (slope/roughness at ~460 m baseline on all three).
3. **Click any point (decision 007, proposal confirmed by the team's work):** planet-wide card grids,
   not only the 21 catalogue sites. H3 hexagons; Mars **res 5 (~9.1 km, 2.02 M cells)**, Moon res 4
   (~12.3 km), Earth res 6 (~6.5 km, 14.1 M cells). Precision is the cell, not the pixel: it is the
   scale the data support (GRS is ~300 km). Hexagons tile with no gaps (overlapping circles were
   discussed and rejected).
4. **Mars grid method (ROADMAP 3.5):** pixels → cell = low-pass (area-weighted); **high-pass only for
   roughness** (fit a plane per cell, RMS of the residual slope); slope = weighted median; ~3 km
   rasters (TES TI, SWIM) by area of intersection (3×3 sub-pixels); coarse products (GRS 5°, TES/MCS
   5° bins) = value of the containing coarse cell. Same method must be used for Earth.
5. **Web format = compact binary (docs/07):** quantized u1/u2 columns, `value = stored×scale+offset`,
   max of dtype = no data, column blocks, gzip, **cells in ascending H3 order so ids are not stored**.
   Mars = 11.4 MB for 2 M cells. Sources live in `index.json` (`source`, `short_source`,
   `short_unit`, per-cell `source_column` + `codes`); **nothing about sources is hard-coded in the app**.
   Check any export with `scripts/check_grid_binary.py`.
6. **Latitude conventions:** Mars and Moon **planetocentric** (as PDS), Earth geodetic WGS84; longitude
   −180…180 E. The camera must use the same convention as the cell (a geodetic/planetocentric mix-up
   moved the framing ~7 km on Mars).
7. **Comparison in physical units with tolerances (decision 003)**, not percentiles/z-scores. The team
   later moved to **soft notes and dimensions** (docs/09: note `1/(1+(d/half_diff)²)`, index weighted
   by dimensions terrain / thermal / water & ice / sky & light, neighbours mixed).
8. **Mars ice:** SWIM 2.0 consistency with threshold **0.25** (0 put 43 % of "shallow ice" at the
   equator); beyond ±60° the GRS epithermal neutrons (≤ 6.1 cps = ice within 1 m, calibrated on SWIM
   45–60°, balanced accuracy 0.80); **north of 70°N assumed** (2002 neutron map is masked by winter CO₂
   frost). Per-cell `ice_depth_source` 1 SWIM / 2 neutrons / 3 assumed. "No ice" stored as 10 m [assumption].
9. **Mars poles:** slope/roughness/laser coverage blanked beyond **87°** (MGS never flew there; MOLA is
   interpolated → fake 0°); NS neutron rows ±89.25/±89.75 are fill zeros → filled from ±88.75.
10. **Sun:** `sun_elev_max_deg = 90° − max(0, |lat| − obliquity)` (noon, whole year, flat horizon;
    Mars 25.19°, Earth 23.44°). **Not valid at the lunar poles** (obliquity 1.54°, relief decides:
    use an illumination map, e.g. PGDA LPSR). Written in `configs/variables.yaml` and docs/07.
11. **Data sharing:** raw data never in git (team rule); `MANIFEST.csv` + `LISTADO_<name>.csv` per body
    (same format as Marc's Moon kit); zips via `pack_data.py` to the team Drive.

## 5. Mars data actually used (all in `data/raw/mars/`, 351 files, 4.4 GiB, `python scripts/download_data.py`)

| Dataset | Gives | Notes |
|---|---|---|
| MOLA MEGDR 128 ppd, all 16 tiles + 2 polar maps (+16 ppd) | elevation, slope, roughness, laser QC | only 15–46 % of 128 ppd cells have a real shot (rest interpolated); polar maps: unsigned, `×0.25 − 8000`, sphere reference |
| TES thermal inertia (Putzig & Mellon 2007) | thermal inertia day/night | 20 ppd, 0 = no data, masks = interpolated pixels |
| GRS element maps 5° + NS/HEND special products 0.5° | H₂O, Cl, Fe, Si, K, Th (ppm), epithermal flux | elements only to ~±50° |
| TES IR retrievals MY26 (Montabone, PDS Atmospheres) | dust OD (×2.6 → visible), day T_surf (P95 = t_max), pressure | **daytime only** (~14 h); MY26 = no global dust storm |
| MCS DDR MY31 (sampled 1 day in 10, T_surf columns only) | night T_surf → t_mean = (TES day + MCS night)/2 | LTST is a fraction of a sol; −9999 = no data; MCS has no data 2012-08-07→09-07 |
| SWIM 2.0 composite (swim.psi.edu) | ice consistency 0–1 m, 1–5 m, >5 m | ±60° only |

Outputs: `data/processed/mars_h3r5.parquet` (`scripts/build_mars_grid.py`, ~18 min),
`app/data/marte/` (`scripts/export_mars_web.py`), quick-look maps `outputs/maps/mars_h3r5_quicklook.png`.

## 6. What exists in the app now (end of day 1)

Phases 0–2 (globes, layers, high-res imagery, click → lat/lon, markers, sites, `Esc`), card panel with
hexagon outline and **framing camera**, any-to-any comparator (Mars / Moon / Earth), dimension scores,
ranked analogs bar, Earth zone filter and drawn box, place search, **Rover test planner** view
(`#rover`, 3D Perseverance, testability index). Details: `app/README.md`, ROADMAP phase 4.

## 7. Conventions (how Adrià wants to work)

- **Replies in Catalan or Spanish (as he writes); every file, code comment and UI text in English.**
- One ROADMAP task at a time, in the order he names; tick it in `ROADMAP.md` with a short "Done" note.
- **Verify in the browser** (dev server) before saying something works; run `python -m pytest`
  (14 tests) and `npm run build`.
- (2026-11-15: the old comparator prototype and its mock package were removed; the note below no longer applies.)
- Never break the team's work: `scripts/build_comparator_data.py` + its tests require the mock package
  (`config.json` + `objetivos.json` + `tierra.json`) to be all-mock or all-real.
- Adrià does commits/merges himself (he is learning git): prepare, explain, don't push unasked.

## 8. Pitfalls already hit (save time)

- **PowerShell 5.1:** no `&&`; `Set-Content -Encoding utf8` adds a BOM and `Get-Content` reads
  cp1252 → mojibake ("â€”"). Use `[IO.File]::WriteAllText(p, t, UTF8Encoding($false))` or the Edit tool.
- Python output with `→`/`°` crashes in the console (cp1252): avoid non-ASCII in prints or use ASCII.
- `pip`/`requests` SSL errors → `truststore` (already in requirements; `pip --use-feature=truststore`).
- Long downloads: run them in a **terminal tab** (no timeout); Windows shows 0 MB for files being written.
- `requests`' `r.text` on multi-MB files runs charset detection for minutes → decode `r.content`.
- The Browser pane does not render while hidden: screenshots look black until something triggers a
  render (scroll/click); old console errors persist across reloads (check timestamps).
- Trek tile max levels: Mars 7, Moon 8 (beyond → 404, upsampled). Moon LOLA relief is **PNG**.

## 9. Open points / next steps

- **ROADMAP progress line is stale** (says 29/62): the team ticked tasks in their commits; recount.
- 0.8: owner enables GitHub Pages, then check the published site.
- Mars: site card = its H3 cell (not a footprint centred on the site); `t_mean_K` is blocky at 5°
  (few MCS night samples) → smoothing; the SWIM "3 m" class has 13.5 % equatorial cells (radar,
  Medusae Fossae?) → science review; "no ice" = 10 m is an assumption.
- Mars variables still without a source: `rock_abundance_pct`, `lithology` (USGS Tanaka 2014), `caves` (MGC³).
- Better north-polar ice: GRS neutron maps from northern summer (multi-year DND products).
- Moon poles: Sun from an illumination map, not the flat formula (docs/07 warning).
- Rover planner: drill compares only ice (rock type missing in the Earth search table).
- Phase 5–6: data layers on the globes, legends, polish, demo video, slides, submission.
