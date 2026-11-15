# 🌍🌕🔴 Earth Analogs for Moon & Mars — NASA Space Apps 2026

**Challenge:** *Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars.* Full
statement in [`docs/02_reto_oficial.md`](docs/02_reto_oficial.md).

**What we built:** a web app with 3D globes of Mars, the Moon and Earth. **Click any point** of Mars or the
Moon and the app finds the most similar places on Earth (or the other way round: any body against any
other). It paints the search globe by similarity, flies to the best analog and shows a **card** with
every variable, its value on both sides and its source, plus an **analog index from 0 to 100** broken
down by dimension (terrain, thermal, water & ice, sky & light). You can choose **what you want to
test** (wheels, navigation, ice detection, solar power…), restrict the search to a zone of Earth, and
open two more views: the **Rover test planner**, which says where on Earth each part of a rover could be
field-tested, and the **Route replica**, which finds on Earth a path with the slopes of a rover route.

## How it works

```
 1. DATA (Python, run once)              2. WEB DATA (in git)                 3. APP (browser, no server)
    NASA / NOAA archives  →  card grids  →  compact binary files       →  click → card → score every
    raw files, tens of GB    (H3 cells)     app/data/, ~160 MB             cell of the other body → fly
    outside git              data/processed                                 app/  (Vite + CesiumJS)
```

- Each body is covered by **hexagonal cells** (Uber H3) and each cell has a **card**: slope, roughness,
  temperatures, water ice, dust, Sun elevation… computed from NASA mission data at the **same scale on
  every body** (slope at a ~460 m baseline on all three), so the comparison is fair.
- The cards are pre-computed once and exported as small compressed binary files. All the matching happens
  **in the browser** (~0.1–0.6 s per search). The only live requests are the map imagery.
- The index compares values **in physical units**: each variable gets a soft note
  `1 / (1 + (difference / half_diff)²)` (1 when equal, 0.5 at `half_diff`), notes are averaged per
  dimension, dimensions are averaged with the weights of the chosen test, and the ranking mixes each cell
  with its 6 neighbours (homogeneous areas first). Only the variables with data on both sides are
  compared, and the app says how many. Details: [`docs/09_criterios_seleccion.md`](docs/09_criterios_seleccion.md)
  and the comments in [`app/src/scoring.js`](app/src/scoring.js).

| Body | Cells | Cell size | Main data |
|---|---|---|---|
| Mars | 2,016,842 (H3 res 5) | ~9.1 km | MGS MOLA, TES, Odyssey GRS, MRO MCS, SWIM 2.0, NASA Ames Mars GCM |
| Moon | 288,122 (H3 res 4) | ~12.3 km | LRO LOLA, Diviner, Lunar Prospector, NASA PGDA |
| Earth | 14,117,882 (H3 res 6), of which 1,374,390 searched (deserts, polar ice, arid open land) | ~6.5 km | NOAA ETOPO 2022, MODIS, GPM IMERG, MERRA-2, ECOSTRESS |

On Mars the card also shows the **slope at the clicked point** (~0.9 km pixel, read from data tiles), the
**solar energy for a horizontal panel** (NASA Appelbaum & Flood model) and the **mean wind and wind
stress** (NASA Ames Mars GCM). Full list of sources: [`CREDITS.md`](CREDITS.md).

## 🚀 Run it on your computer (from scratch)

The app runs **locally**: nothing to deploy and no account needed. Everything it needs is in this
repository (~170 MB with the data); only the map imagery is loaded from the internet while you use it.

**1. Install two programs** (once):

| Program | Where | Check it in a terminal |
|---|---|---|
| **Git** | [git-scm.com/downloads](https://git-scm.com/downloads) | `git --version` |
| **Node.js 20 or newer** (LTS) | [nodejs.org](https://nodejs.org) | `node --version` |

Default options in both installers are fine. On Windows, open a **new** terminal (PowerShell) after
installing so the commands are found.

**2. Download the project:**

```bash
git clone https://github.com/pablourioste/SpaceAppsNASA.git
```

```bash
cd SpaceAppsNASA/app
```

(No Git? On the GitHub page: **Code → Download ZIP**, unzip it, and open a terminal in the `app` folder.)

**3. Install the app's libraries** (once, ~1 minute):

```bash
npm install
```

**4. Start it:**

```bash
npm run dev
```

**5. Open [http://localhost:5173](http://localhost:5173)** in Chrome, Edge or Firefox. Press Enter on the
opening screen, pick the body to click on (Mars, Moon or Earth) and the body to search, and click any
point: the other globe is painted with its analogs. `Esc` clears the selection. The title menu (top
left) opens the **Rover test planner** and the **Route replica**.

To stop it: `Ctrl + C` in the terminal. Next time, only steps 4 and 5.

**If something goes wrong:**

| Problem | Fix |
|---|---|
| `npm` or `node` "not recognized" | Close the terminal and open a new one; if it persists, reinstall Node.js |
| A red error about a missing import (`d3-geo`, `three`…) | Run `npm install` again (do it after every `git pull`) |
| Port 5173 is busy | The terminal shows the address it used instead (5174, 5175…) |
| The globes stay black | It needs an internet connection for the imagery; reload the page |

Python is **not** needed to run the app, only to rebuild the data (next section).
## Regenerating the data (Python)

```bash
python -m venv .venv
.venv\Scripts\activate             # Windows   (Linux/Mac: source .venv/bin/activate)
pip install -r requirements.txt    # SSL errors: add --use-feature=truststore
python -m pytest                   # 19 passed
```

Raw data stay **outside git** (tens of GB): by default in `C:\Users\<you>\SpaceAppsData` (`raw/`,
`interim/`, `processed/`), or wherever `ANALOGS_DATA_DIR` points. The pipeline, per body:

| Step | Mars | Moon | Earth |
|---|---|---|---|
| 1. Download | `scripts/download_data.py` | `scripts/download_moon.py` | `scripts/download_earth.py` |
| 2. Card grid | `scripts/build_mars_grid.py` (~18 min) | `scripts/build_moon_grid.py` | `scripts/build_earth_mask.py` + `scripts/build_earth_grid.py` |
| 3. Web export | `scripts/export_mars_web.py`, `scripts/export_mars_slope_tiles.py` | `scripts/export_moon_web.py` | (written by `build_earth_grid.py`) |

After changing a tolerance, a weight or a test in `configs/`, run `python scripts/export_scoring.py` and
reload the page. Check any export with `scripts/check_grid_binary.py`. Web data format:
[`docs/07_card_grid_binary_format.md`](docs/07_card_grid_binary_format.md). Data guide:
[`docs/08_datos_LEEME.md`](docs/08_datos_LEEME.md). Script index:
[`scripts/README.md`](scripts/README.md).

## Repository map

```
SpaceAppsNASA/
├── README.md                ← you are here
├── ROADMAP.md               task list, with what was done and how it was checked
├── CREDITS.md, LICENSE      data / imagery / library credits and the code licence
├── app/                     THE APP (Vite + CesiumJS + three.js)
│   ├── src/                 globes, cards, scoring, search, rover planner, route replica (see app/README.md)
│   └── data/                what the app reads: marte/, luna/, tierra/ card grids, scoring settings,
│                            Mars slope tiles, rover config and 3D model
├── configs/                 WHAT IS COMPARED
│   ├── variables.yaml       variables, units, tolerances (half_diff) with their criterion, sources
│   └── pruebas.yaml         "what do you want to test?" = the weights of each test
├── src/analogs/             Python: from NASA data to the card grids (one module per body + export)
├── scripts/                 what is run (download, build, export, check)
├── data/catalogs/           target sites (Moon / Mars) and known Earth analogs   [in git]
├── docs/                    documentation (numbered in reading order; decisions/ = decision log;
│                            NEXT_STEPS.md = what we would do next)
├── presentation/            the pitch slides
├── outputs/                 figures, quick-look maps and validation outputs
└── tests/                   tests: Python (pytest) and JavaScript (npm test, from app/)
```

Folder and key names in Spanish are kept on purpose (renaming them would touch the data files):
`marte` = Mars, `luna` = Moon, `tierra` = Earth, `pruebas` = tests, `objetivos` = target sites,
`analogos_conocidos` = known analogs, `fichas` = cards.

## How we work

- Heavy data **outside git** (shared team drive, zips made with `scripts/pack_data.py`). In git: code,
  configs, catalogues and the web data.
- Important decisions in [`docs/decisions/`](docs/decisions/README.md).
- **[verify]** = not checked yet · **[assumption]** = a value chosen by us, to be reviewed (all tolerances
  and test weights are assumptions with a written criterion).

## Team

| Role | Person |
|---|---|
| Coordination and presentation | |
| Science and validation | |
| Moon and Mars data | |
| Earth data | |
| Engine | |
| App | |

## Pitch

The 7-slide pitch (PowerPoint, 127 MB) is attached to the GitHub release `pitch`:
[download `Earth_Analog_Presentation.pptx`](https://github.com/pablourioste/SpaceAppsNASA/releases/download/pitch/Earth_Analog_Presentation.pptx).

## Next steps

**Use Mars' Earth twins to learn when a rover's "no traces of past life found" really means something,
and when it only means our instruments can't see well enough.** How we would do it, and the next
parameters to add (radiation at the surface): [`docs/NEXT_STEPS.md`](docs/NEXT_STEPS.md).

## Use of AI

We used Claude (Anthropic), mostly through Claude Code, to help write and debug the code, process the
data and draft the documentation; the team chose the method, made the decisions and checked every
result. No data or images are AI-generated. Details: [`docs/AI_USAGE.md`](docs/AI_USAGE.md).

## Licence and credits

Code: [MIT](LICENSE). Data, imagery, the 3D model and the libraries keep their own licences and credits:
see [`CREDITS.md`](CREDITS.md). The Sentinel-2 cloudless imagery (EOX) is CC BY 4.0 and must be credited.
This project uses public NASA data but is not endorsed by NASA.
