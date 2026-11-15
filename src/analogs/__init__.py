"""Earth analogs of the Moon and Mars: from the NASA / NOAA archives to the card grids the web app reads.

    paths.py             where everything is (data folder, configs, app/data)
    config.py            reads configs/variables.yaml and configs/pruebas.yaml
    catalog.py           single catalogue of the datasets: which folder is what and where it comes from

  Step 1 · download  →  data/raw/
    download.py          Mars datasets (MOLA, TES, GRS, SWIM…)     scripts/download_data.py
    mcs.py               MRO MCS night temperatures (used by download.py)
                         (Moon and Earth: scripts/download_moon.py, scripts/download_earth.py)

  Step 2 · card grids  →  data/processed/   (one row per H3 hexagon)
    mars.py              readers of the raw PDS products of Mars
    mars_grid.py         Mars grid (H3 res 5)                       scripts/build_mars_grid.py
    moon.py              Moon grid (H3 res 4)                       scripts/build_moon_grid.py
    earth.py             Earth fields on the 0.05° mesh             scripts/build_earth_features.py
    earth_grid.py        Earth grid (H3 res 6) + search table       scripts/build_earth_grid.py

  Step 3 · web export  →  app/data/
    export.py            compact binary grids (docs/07) and the site cards
    mars_climate.py      Mars solar energy and winds, added at export time
    mars_slope_tiles.py  pixel-level Mars slope tiles               scripts/export_mars_slope_tiles.py

  Engine
    similarity.py        the analog index (the app uses the same formula: app/src/scoring.js)
"""
