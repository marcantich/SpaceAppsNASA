# Credits and licences

The code written by the team is under the MIT licence ([`LICENSE`](LICENSE)). Everything below is
third-party work that the project uses, with the licence or terms it comes with and the credit it asks
for. Checked on 2026-11-15.

> This project uses public NASA, NOAA and ESA/Copernicus data. It is not endorsed by NASA or by any of
> the organisations listed here. The NASA name and insignia are not used as a logo.

## Imagery shown on the globes (loaded live, not stored in the repository)

| Layer | Provider | Licence / terms | Credit shown |
|---|---|---|---|
| Earth base: Blue Marble shaded relief and bathymetry | NASA Earth Observatory, served by NASA GIBS | NASA open data, no restrictions | GIBS acknowledgement (below) |
| Earth relief: ASTER GDEM colour shaded relief | NASA/METI/AIST/Japan Spacesystems, served by NASA GIBS | NASA open data | GIBS acknowledgement |
| **Earth detail: Sentinel-2 cloudless 2016** | EOX IT Services GmbH, from Copernicus Sentinel-2 data | **[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/): attribution required.** Only the **2016** edition is CC BY; 2018 and later editions are CC BY-NC-SA (non-commercial), so do not switch to them | "Sentinel-2 cloudless - https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016 & 2017)" |
| Mars base: Viking MDIM 2.1 colour mosaic | NASA/USGS, served by NASA Solar System Treks (Mars Trek) | NASA public data | "NASA Solar System Treks" |
| Mars relief: MGS MOLA colour shaded relief | NASA/JPL/GSFC, Mars Trek | NASA public data | "NASA Solar System Treks" |
| Mars detail: MRO CTX global mosaic V01 | Caltech Bruce Murray Laboratory for Planetary Visualization; tiles served by Esri | The Murray Lab "grants free use of the V01 version of the mosaic for all purposes"; citation and credit requested | "Data credit: NASA/JPL/MSSS/The Murray Lab". Cite: Dickson, J. L., Ehlmann, B. L., Kerber, L., Fassett, C. I. (2024), *Earth and Space Science*, doi:[10.1029/2024EA003555](https://doi.org/10.1029/2024EA003555) |
| Moon base: LRO WAC global mosaic | NASA/GSFC/Arizona State University, Moon Trek | NASA public data | "NASA Solar System Treks" |
| Moon relief: LRO LOLA colour shaded relief | NASA/GSFC, Moon Trek | NASA public data | "NASA Solar System Treks" |

GIBS acknowledgement (as GIBS asks applications to show it): *"We acknowledge the use of imagery
provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science
Data and Information System (ESDIS)."*

All these credits appear in the app under **Data attribution** (bottom-left of each globe).

## Scientific data behind the cards (processed offline, results in `app/data/`)

All are public data from NASA, NOAA or USGS archives. US Government works are not subject to copyright;
the archives ask for the products to be cited. Full list, versions and URLs: `data/raw/<body>/MANIFEST.csv`
and `configs/variables.yaml` (`sources`).

| Body | Products |
|---|---|
| Mars (climate extras) | NASA Ames Mars Climate Modeling Center, FV3-based Mars GCM Beta Output Release 1 (doi:[10.25966/rjgg-r639](https://doi.org/10.25966/rjgg-r639)): winds, wind stress, surface albedo. Solar energy model: Appelbaum & Flood, *Solar radiation on Mars*, NASA TM-102299 (1989) and updates TM-103623 / TM-105216 (net flux Table III as transcribed in the `marsrad` package, used as data only) |
| Mars | MGS MOLA MEGDR (128 px/° tiles and polar maps), MGS TES thermal inertia (Putzig & Mellon 2007), MGS TES atmospheric retrievals MY26 (Montabone et al.), MRO MCS DDR MY31, Mars Odyssey GRS element maps and NS/HEND neutron products, SWIM 2.0 ice consistency maps (Subsurface Water Ice Mapping project, swim.psi.edu) |
| Moon | LRO LOLA GDR (ldem_64 and shots per cell), LRO Diviner (global cumulative products, polar resource products), Lunar Prospector GRS, NASA PGDA south-pole products, LROC pits atlas |
| Earth | NOAA ETOPO 2022 (15″), MODIS Aqua MYD11C3 land surface temperature, MODIS MCD12C1 land cover, MODIS MOD10CM snow cover, GPM IMERG monthly v07, MERRA-2 M2TMNXAER aerosols, ECOSTRESS ECO_L3G_WPS |

Full list with references and citations: [`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md).

## Elevation read live by the Route replica view (not stored in the repository)

| Data | Provider | Terms | Credit shown |
|---|---|---|---|
| Mars HRSC + MOLA blended DEM, 200 m | USGS Astrogeology Science Center, DLR, ESA | USGS public data **[verify]** | "Mars HRSC+MOLA blended DEM 200 m (USGS Astrogeology, DLR)" |
| Moon LRO LOLA global DEM, 118 m | USGS Astrogeology Science Center, NASA GSFC | NASA / USGS public data | "LRO LOLA global DEM 118 m (USGS Astrogeology, NASA GSFC)" |
| Earth "Terrarium" terrain tiles | Mapzen terrain tiles on AWS Open Data (SRTM, USGS 3DEP and other sources) | Free to use; the providers ask for attribution of the underlying sources **[verify]** the exact wording | "Earth elevation: Terrarium tiles (SRTM / USGS 3DEP)" |
| Perseverance and Curiosity traverses (`app/data/route/presets.json`) | NASA/JPL-Caltech (mars.nasa.gov) | NASA public data | "rover telemetry (NASA/JPL-Caltech)" |

## 3D model

| Asset | Source | Terms |
|---|---|---|
| Mars 2020 Perseverance rover (`app/data/rover/perseverance.glb`) | NASA/JPL-Caltech, [NASA 3D Resources](https://github.com/nasa/NASA-3D-Resources) | Free to download and use under the [NASA Images and Media Usage Guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/); must not suggest NASA endorsement. Credit: "3D model: NASA/JPL-Caltech" (shown in the rover view) |

## Software libraries (bundled in the web app)

| Library | Licence |
|---|---|
| [CesiumJS](https://cesium.com/platform/cesiumjs/) 1.147 | Apache 2.0. The app uses **no Cesium ion service** (no token, no ion assets, no request to cesium.com), so the Cesium ion logo is not shown; CesiumJS is credited under *Data attribution* |
| [three.js](https://threejs.org) 0.170 | MIT |
| Draco 3D decoder (`app/data/rover/draco/`, from Google, shipped with three.js) | Apache 2.0 |
| [h3-js](https://github.com/uber/h3-js) (Uber H3) | Apache 2.0 |
| [d3-geo](https://github.com/d3/d3-geo), d3-array, internmap | ISC |
| [topojson-client](https://github.com/topojson/topojson-client) | ISC |
| [world-atlas](https://github.com/topojson/world-atlas) (country borders from [Natural Earth](https://www.naturalearthdata.com), public domain) | ISC |
| [Vite](https://vite.dev), vite-plugin-cesium (build only) | MIT |

Python tools used to build the data (not distributed with the app) keep their own open-source
licences: see `requirements.txt`.
