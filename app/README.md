# app/ — the web app

Static site (Vite 6 + CesiumJS + three.js): everything is computed in the browser from `app/data/`.
The only live requests are the map imagery (NASA GIBS, NASA Solar System Treks, CTX mosaic, Sentinel-2
cloudless: see [`CREDITS.md`](../CREDITS.md)).

```powershell
cd app
npm install      # first time, or when package.json changes
npm run dev      # http://localhost:5173
npm run build    # optional: static copy of the site in dist/
npm test         # unit tests of the pure JS modules
```

## Three views (title menu, top left)

| View | What it does | URL |
|---|---|---|
| **Analogs** | Click any point of Mars, the Moon or Earth → card of its cell → every cell of the other body is scored → painted globe, ranked sites, score dock | default |
| **Rover test planner** | Send a rover to the clicked Mars / Moon cell → where on Earth each part can be field-tested | `#rover` |
| **Route replica** | Draw a route on Mars or the Moon (or load a real rover traverse) → a path on Earth with the same slopes | view menu |

## `src/`

| File | What it is |
|---|---|
| `main.js` | Wires everything: the two globes, selection → card → search → camera. Lines marked `[rover]`, `[route]`, `[intro]` are the hooks of the other views |
| `intro.js`, `intro.css` | Opening screen |
| `globe.js` | One Cesium globe: layers, clicks, markers, hexagons, zones, camera |
| `bodies.js` | Per-body configuration: ellipsoid, imagery layers, home view |
| `coords.js` | Screen ↔ lat/lon (planetocentric on Mars and the Moon, geodetic on Earth) |
| `grid.js` | Reads the card grids (`data/<body>/`): `new CardGrid('marte').cardAt(lat, lon)` |
| `slopetiles.js` | Pixel-level Mars slope under the click (`data/marte/slope64/`) |
| `card.js` | Card panel, results bar and score dock |
| `scoring.js` | The analog index (same formula as `src/analogs/similarity.py`) |
| `match.js` | Search tables and the ranking of every cell of a body |
| `zones.js`, `places.js`, `countries.js` | Search zones, place search box, country names |
| `data.js` | Loads the target sites (`<body>/objetivos.json`) and the known analogs |
| `rover.js`, `rover3d.js`, `rover-limits.js`, `rover.css` | Rover test planner (config: `data/rover.json`) |
| `route.js`, `routeSolver.js`, `route.css` | Route replica |

## `data/` (what the app reads)

| Path | Content | Written by |
|---|---|---|
| `marte/`, `luna/`, `tierra/` | Card grids: `index.json` + one `rNNN.bin.gz` per H3 base cell; `objetivos.json` = real cards of the target sites. Format: [`docs/07`](../docs/07_card_grid_binary_format.md) | `scripts/export_mars_web.py`, `export_moon_web.py`, `build_earth_grid.py` |
| `tierra/match.json`, `match.bin.gz` | Scoring settings (variables, dimensions, tests) and the Earth search table | `build_earth_grid.py`, `export_scoring.py` |
| `marte/slope64/` | Pixel-level Mars slope tiles | `scripts/export_mars_slope_tiles.py` |
| `analogos_conocidos.json` | Known Earth analogs (from `data/catalogs/known_analogs.csv`) | `src/analogs/export.py` |
| `rover.json`, `rover/` | Rover planner configuration (hand-written, all margins are assumptions) and the Perseverance 3D model (NASA/JPL-Caltech) | by hand |
| `route/presets.json` | Real rover traverses for the Route view | `scripts/rover_route/make_presets.py` |
| `intro/` | Small textures of the opening screen | `scripts/make_intro_textures.py` |

## The index

```
note_v      = 1 / (1 + (|target − candidate| / half_diff)²)     1 when equal, 0.5 at half_diff, never 0
              matrix[target][candidate]                         for classes (water ice)
dimension_d = weighted mean of the notes of its variables with data
index       = 100 · Σ W_d · dimension_d / Σ W_d                 W_d from the chosen test
ranking     = 60 % the cell + 40 % the mean of its 6 neighbours
```

Only the variables with data on both sides are compared (the results bar says how many). Variables
that are zero by nature (no rain on Mars or the Moon, no dust on the Moon) count as 0, so A → B and
B → A give the same index. Settings: `configs/variables.yaml`, `configs/pruebas.yaml` →
`python scripts/export_scoring.py`.

## Rover test planner: the method

```
d = max_k |earth_k − target_k| / margin_k        (the weakest link decides)

✔ field     some Earth cell has d ≤ 1  (every variable of the part inside its margin)
◐ caveats   only cells with d ≤ 2, or a variable is missing, or physics caps it (gravity, thin air)
✖ lab only  no cell with d ≤ 2, or the part needs vacuum

testability index = 100 · (field + ½ · caveats) / parts
```

Margins and caps are our assumptions: edit `data/rover.json` and the app recomputes.
