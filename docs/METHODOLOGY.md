# Methodology: the mathematics behind the comparator

How a click on Mars becomes a ranked list of places on Earth. Every formula here is implemented in the
file named next to it; every parameter is in `configs/variables.yaml`, `configs/pruebas.yaml` or
`app/data/rover.json`. Values chosen by the team are described as such where they appear.

**Contents:** [1. Principles](#1-principles) · [2. The grid](#2-the-grid-h3-hexagons) ·
[3. From raw data to a card](#3-from-raw-data-to-a-card) · [4. The analog index](#4-the-analog-index) ·
[5. The ranking](#5-the-ranking) · [6. Worked example](#6-worked-example) ·
[7. Rover test planner](#7-rover-test-planner) · [8. Route replica](#8-route-replica) ·
[9. Storage precision](#9-storage-precision) · [References](#references)

---

## 1. Principles

1. **Physical similarity, not visual likeness.** Places are compared by their *card* (slope, roughness,
   temperatures, ice, dust, sunlight), not by how they look. It is the wind-tunnel idea: reproduce the
   parameters that control what you want to test.
2. **Physical units, not percentiles** (decision 003). Normalising each variable inside its own body
   would pair "typical on Mars" with "typical on Earth": Jezero's mean temperature is ordinary for Mars,
   so it would be matched with temperate Earth. Instead the difference is taken in K, degrees or metres
   and judged against a tolerance that has a written physical reason.
3. **Same scale on every body** (decision 006). Slope and roughness depend on the spacing of the
   elevation model: the same terrain looks steeper at 30 m than at 500 m. All three bodies use elevation
   pixels of ~460 m, and all variables are aggregated to cells of 6–12 km.
4. **Explainable.** The index is a closed formula. The app shows both values of every variable, the
   note each one got and the source of each number. It is an *analogy index*, not a probability: it is
   not calibrated against anything.
5. **What is missing is said, not hidden.** A variable without data on one side is not compared, and
   the results bar says how many were. What Earth cannot reproduce (gravity, pressure, radiation) is
   shown apart ([`LIMITATIONS.md`](LIMITATIONS.md)).

---

## 2. The grid: H3 hexagons

Each body is covered by [H3](https://h3geo.org) hexagons (Uber's hierarchical grid: 122 base cells, each
split in 7 at every resolution level). H3 is used on a sphere with each body's latitude and longitude,
so it works on any body.

Why hexagons: a latitude–longitude grid degenerates at the poles, where half of this project is; H3
cells have nearly equal area everywhere, tile without gaps, and every cell has 6 neighbours at the same
distance (12 cells per level are pentagons, with 5).

H3 cells are defined by **angle**, so the same level has a different size on each body. The level is
chosen so the three are comparable:

| Body | Radius | Level | Cell area | Width | Cells |
|---|---|---|---|---|---|
| Mars | 3,389.5 km | 5 | ~71.6 km² | ~9.1 km | 2,016,842 |
| Moon | 1,737.4 km | 4 | ~131.7 km² | ~12.3 km | 288,122 |
| Earth | 6,371.0 km | 6 | ~36 km² | ~6.5 km | 14,117,882 |

The number of cells at level $r$ is $2 + 120 \cdot 7^{r}$. Precision is the cell, not the pixel: two
clicks in the same hexagon give the same answer. That is the scale the data support (several inputs are
much coarser: see §3.3).

---

## 3. From raw data to a card

Code: `src/analogs/mars_grid.py`, `moon.py`, `earth.py`, `earth_grid.py`, `mars_climate.py`.

Going from fine pixels to a ~9 km cell is a **low-pass** operation (an area-weighted statistic of the
pixels inside the cell). A **high-pass** is used only for roughness. Every pixel is weighted by its
true area: $w = \cos\varphi$ on a latitude–longitude raster, $w = 1/k^2$ on a polar stereographic map
with scale factor $k$.

### 3.1 Slope

Elevation $z$ on pixels of ~460 m (Mars: MOLA 128 px/°, Moon: LOLA 64 px/°, Earth: ETOPO 2022 15″).
The gradient is taken by central differences with the true metric spacing at each latitude
($\Delta = R \cdot \Delta\varphi$ is the pixel size in metres):

$$
g_x = \frac{z_{i,j+1} - z_{i,j-1}}{2\thinspace \Delta\cos\varphi},\qquad
g_y = \frac{z_{i-1,j} - z_{i+1,j}}{2\thinspace \Delta},\qquad
\text{slope} = \arctan\sqrt{g_x^2 + g_y^2}
$$

so the baseline is two pixels, ≈ 0.9 km, on the three bodies. (On the Moon the east–west difference uses
$\pm k$ columns with $k = \mathrm{round}(1/\cos\varphi)$ to keep that baseline near the poles.)

The cell's **slope** is the **area-weighted median** of the pixel slopes inside it: the value $m$ for
which the pixels with slope $\le m$ hold half of the total weight. The median is used, not the mean,
because a few cliff pixels should not decide the slope of a plain.

### 3.2 Roughness

Roughness is the slope that is left after removing the regional tilt of the cell. A plane
$z = a + b\thinspace x + c\thinspace y$ is fitted to the cell's pixels by weighted least squares ($x$, $y$ in metres east
and north of the cell centre), solving the normal equations

$$
\begin{pmatrix} \sum w & \sum wx & \sum wy \cr \sum wx & \sum wx^2 & \sum wxy \cr \sum wy & \sum wxy & \sum wy^2 \end{pmatrix}
\begin{pmatrix} a \cr b \cr c \end{pmatrix} =
\begin{pmatrix} \sum wz \cr \sum wxz \cr \sum wyz \end{pmatrix}
$$

and the roughness is the weighted RMS of the residual gradient, as an angle:

$$
\text{roughness} = \arctan\sqrt{\frac{\sum w\thinspace \big[(g_x - b)^2 + (g_y - c)^2\big]}{\sum w}}
$$

Only running sums are needed, so a planet of ~10⁹ pixels is processed tile by tile and cells split
between tiles are merged exactly. On the Moon the mean gradient of the cell $(\bar g_x, \bar g_y)$ is
used instead of the fitted $(b, c)$, which is nearly the same. Roughness at several baselines on Mars:
Kreslavsky & Head (2000).

**Quality flag.** MOLA and LOLA measure along ground tracks; pixels between tracks are interpolated and
come out smoother than reality. Each cell stores the area fraction of pixels with at least one laser
shot (`mola_measured_frac`, `lola_measured_frac`; on Mars only 15–46 % near the equator, on the Moon a
median of 69 %), and the card shows it. Beyond ±87° on Mars no laser data exist (the orbit never went
there): slope and roughness are left empty.

**Check.** The Moon slope was compared with the independent PGDA 800 m slope product in 1,949 polar
cells: correlation 0.979, bias −0.4°.

### 3.3 Other variables

| Input is… | Method | Used for |
|---|---|---|
| Much finer than the cell (~0.5–1 km) | Area-weighted mean or median of the pixels inside | Elevation, slope, Moon rock abundance, Moon permanent shadow |
| A few pixels per cell (~3–6 km) | **Area of intersection**: each pixel is split in 3×3 sub-pixels, each assigned to the cell that contains its centre, then area-weighted mean | Mars thermal inertia, SWIM ice, all Earth 0.05° fields |
| Coarser than the cell (0.5°–5°) | Value of the coarse cell that contains the hexagon centre (regional context) | Mars GRS and neutrons, Mars temperatures and dust (5° bins), Moon temperatures (0.5°), Moon composition (2°) |
| Scattered measurements | Binned to a 5° grid (mean, or 95th percentile), then as above | Mars TES and MCS retrievals |

**Maximum Sun elevation** (`sun_elev_max_deg`) is geometry, not data. At noon the Sun stands at
$90^\circ - |\varphi - \delta|$, with the declination $\delta$ between $-\varepsilon$ and
$+\varepsilon$ over a year, so the highest value of the year is

$$
h_{\max} = 90^\circ - \max\big(0,\ |\varphi| - \varepsilon\big)
$$

with the obliquity $\varepsilon$ = 23.44° (Earth), 25.19° (Mars), 1.54° (Moon). Flat horizon, no
atmosphere. On the Moon beyond ±80° it is left empty: the Sun stays within a few degrees of the horizon
and relief decides the light, so the card shows the fraction of the cell in permanent shadow instead.

**Temperatures** are *typical conditions*, not records:

| | Mars | Moon | Earth |
|---|---|---|---|
| `t_mean_K` | (day + night) / 2: TES daytime mean (MY26) and MCS night mean (MY31), 5° bins | (mean of the day bins 6–18 h + mean of the night bins) / 2 of the Diviner mission-mean daily cycle | Mean of 12 monthly (day + night) / 2, MODIS Aqua 2019–2023 |
| `t_max_K` | 95th percentile of the TES afternoon values | Maximum of the mean daily cycle | Warmest month of the daytime (13:30) temperature |
| `t_min_K` | — | Minimum of the mean daily cycle | Coldest month of the night (01:30) temperature |
| `t_night_K` | MCS night mean (~03 h) | — | Annual mean of the night temperature |

**Airborne dust** (`dust_aod`) is the optical depth in visible light. Mars: TES measures absorption at
9.3 µm, converted to visible extinction by multiplying by 2.6 (Montabone et al. 2015). Earth:
MERRA-2 dust-only extinction at 550 nm, annual mean. Moon: 0 (no atmosphere).

**Ice depth** (`ice_depth_m`) is stored on the three bodies in the same four classes, because what
matters operationally is which instrument reaches the ice: **0.5** (within the first metre), **3**
(1–5 m), **5** (deeper than 5 m), **10** (none found). Each cell also stores where its value comes from
(`ice_depth_source`).

| Body | Rule |
|---|---|
| Mars, \|lat\| ≤ 60° | SWIM 2.0 ice-consistency maps (−1…+1) for 0–1 m, 1–5 m and > 5 m: the shallowest layer with consistency > 0.25, chosen by the team (with 0, 43 % of the "shallow ice" cells were equatorial; with 0.25, 1.6 %) |
| Mars, beyond 60° | Epithermal neutron flux ≤ 6.1 counts/s → ice within 1 m (threshold calibrated against SWIM in the 45–60° band, balanced accuracy 0.80). North of 70° N the 2002 map is masked by winter CO₂ frost: ice within 1 m is **assumed** |
| Moon, south of −80° | Diviner polar resource product: median depth at which water ice is stable |
| Moon, \|lat\| < 60° | No stable ice near the surface. Between 60° and 80°, and at the north pole: no data |
| Earth | Permanent snow/ice ≥ 50 % of the cell → 0 m. Mean surface temperature < 0 °C → permafrost, with the ice under the active layer, whose thickness follows the Stefan relation $z = E\sqrt{\mathrm{TDD}}$ (TDD = thawing degree-days per year, $E$ = 0.035 m/√(°C·day); Nelson et al. 1997). Otherwise none |

**Rainfall** (`precip_mm_year`) is 0 on Mars and the Moon by nature; on Earth it is the IMERG 2019–2023
mean. It measures how far an Earth place is from an environment without liquid water.

**Mars solar energy** (`solar_kwh_m2_sol`, shown on the card, not compared). Mean daily energy on a
horizontal panel over a Mars year, with the Appelbaum & Flood model:

$$
G_{ob} = 590\ \frac{\big(1 + e\cos(L_s - 248^\circ)\big)^2}{(1 - e^2)^2}\ \mathrm{W\thinspace m^{-2}},\qquad
\cos z = \sin\varphi\sin\delta + \cos\varphi\cos\delta\cos h,\qquad
\sin\delta = \sin\varepsilon\thinspace \sin L_s
$$

$$
G_h = G_{ob}\thinspace \cos z\ \frac{f(z, \tau, a)}{1 - a}
$$

with $e$ = 0.0934, $L_s$ the solar longitude, $h$ the hour angle, $z$ the zenith angle, $\tau$ the
cell's dust optical depth, $a$ its albedo and $f$ the normalised net flux tabulated by the authors.
$G_h$ is integrated over each sol and over the year, each step of $L_s$ weighted by the time the planet
spends in it ($dt \propto (1 + e\cos(L_s - 248^\circ))^{-2}$, Kepler's second law). Result:
0.8–4.1 kWh/m²/sol; it agrees within 5–15 % with the surface solar flux of NASA's Mars climate model.

**Mars wind** (`wind_mean_m_s`, `wind_stress_mPa`, shown, not compared) is model output (NASA Ames Mars
GCM, 2° grid, bilinear interpolation). The stress $\tau = \rho\thinspace u_*^2$ is the quantity to compare with
Earth: Mars air is ~60 times thinner, so the same speed pushes ~60 times less.

### 3.4 Where on Earth analogs are searched

Earth has 14.1 M land cells, but a forest or a city is not a useful analog. The search is limited to
1,374,390 cells (34.4 % of the land). For each 0.05° pixel, from the MODIS land-cover fractions and the
IMERG rainfall (`scripts/build_earth_mask.py`, thresholds chosen by the team):

- **polar ice**: permanent snow or ice ≥ 50 %;
- **desert**: barren ≥ 50 %;
- **arid open land**: barren + open shrubland + grassland ≥ 60 % **and** rain < 350 mm/year.

A hexagon is searched when at least 25 % of its land is in one of the three classes. 15 of the 20 known
analogs fall inside; the 5 outside are geology analogs in vegetated areas (Río Tinto, Ries, Sudbury,
Lonar) and Kilauea.

---

## 4. The analog index

Code: `app/src/scoring.js` (the app) and `src/analogs/similarity.py` (Python, with the tests). The two
implement the same formula.

Let $t$ be the card of the clicked cell and $c$ the card of a candidate cell on the other body.

### Step 1 — a note per variable

For a numeric variable $v$ with tolerance $h_v$ (`half_diff`):

$$
s_v = \frac{1}{1 + \left(\dfrac{|t_v - c_v|}{h_v}\right)^{2}}
$$

It never reaches 0:

| Difference / `half_diff` | 0 | 0.5 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|---|
| Note | 1.00 | 0.80 | 0.50 | 0.20 | 0.10 | 0.06 |

Why this curve and not a linear one that reaches 0: no place on Earth is as cold as Mars. With a hard
cut-off every Earth cell would score 0 in temperature and the variable would stop ranking them; with the
soft curve the Antarctic plateau still ranks ahead of the Sahara. The quadratic shape is flat near zero
(differences well inside the tolerance barely matter) and has a long tail.

For a variable stored by classes (ice depth) the note is read from a matrix,
$s_v = M_v[t_v][c_v]$:

| target ↓ · candidate → | ≤ 1 m | 1–5 m | > 5 m | none |
|---|---|---|---|---|
| **≤ 1 m** | 1.0 | 0.5 | 0.25 | 0.0 |
| **1–5 m** | 0.5 | 1.0 | 0.6 | 0.1 |
| **> 5 m** | 0.25 | 0.6 | 1.0 | 0.3 |
| **none** | 0.0 | 0.1 | 0.3 | 1.0 |

Tolerances, each with its written reason (all chosen by the team, to be validated: `LIMITATIONS.md` §4):

| Variable | Dimension | `half_diff` | Reason |
|---|---|---|---|
| Slope | Terrain | 3° | Separates the slope classes of a rover (0–3 flat, 3–8 gentle, 8–15 moderate); ~2× the error between ~460 m elevation models |
| Roughness | Terrain | 2° | Noise of the RMS roughness with ~460 m models |
| Mean temperature | Thermal | 15 K | Difference between neighbouring climate belts on Earth |
| Maximum temperature | Thermal | 20 K | Extremes vary more than the mean; also covers the different definitions (95th percentile on Mars, monthly mean on Earth) |
| Minimum temperature | Thermal | 20 K | Same |
| Night temperature | Thermal | 15 K | As the mean |
| Rainfall | Water & ice | 100 mm/year | Half the arid range (UNEP classes: hyper-arid < 25, arid 25–200) |
| Ice depth | Water & ice | matrix | Reach of the instruments (neutrons and short drills ≤ 1 m; deep drill 1–5 m) |
| Maximum Sun elevation | Sky & light | 10° | Changes the noon irradiance on a horizontal panel by ≲ 15 %; with 3° the search was tied to one latitude |
| Airborne dust | Sky & light | 0.15 | Difference between a clean and a dusty desert |

### Step 2 — a note per dimension

Variables are grouped in **dimensions** $D$ (Terrain, Thermal, Water & ice, Sky & light) so that three
temperatures do not count as three votes. The dimension note is the weighted mean of its variables that
have data on both sides, with the weights $w_v$ of the chosen test (1 without a test):

$$
S_D = \frac{\sum_{v \in D} w_v\thinspace  s_v}{\sum_{v \in D} w_v}
$$

### Step 3 — the index

$$
I = 100\ \frac{\sum_D W_D\thinspace  S_D}{\sum_D W_D},\qquad W_D = \max_{v \in D} w_v
$$

A dimension in which the candidate cell has no data at all contributes $S_D = 0$ but keeps its weight
in the denominator: what was not measured is not rewarded.

### Which variables are compared

Only variables with data on the clicked cell **and** on the search body:

| Pair | Compared | Not available |
|---|---|---|
| Mars ↔ Earth | Slope, roughness, mean / max / night temperature, rainfall, ice, Sun, dust (9) | Minimum temperature (Mars) |
| Moon ↔ Earth | Slope, roughness, mean / max / min temperature, rainfall, ice, Sun, dust (9) | Night temperature (Moon); Sun beyond ±80° and ice between 60° and 80° on the Moon |
| Mars ↔ Moon | Slope, roughness, mean / max temperature, rainfall, ice, Sun, dust (8) | Minimum and night temperature |

Two rules keep the index honest:

- **Zero by nature.** Rain on Mars and the Moon, and dust on the airless Moon, count as 0 even though
  those cards have no such column. This makes the index **symmetric**: A → B and B → A give the same
  number for the same pair of cells.
- **Tests.** A test (`configs/pruebas.yaml`) is a list of weights over variables, e.g. *Wheels*: slope 1,
  roughness 1, rock abundance 0.8. If only some of its variables have data, those are used and the
  results bar says "2 of 3 variables (no data: rock abundance)". If none has data, all available
  variables are compared and the bar says so.

| Test | Weights |
|---|---|
| Wheels / mobility | slope 1.0 · roughness 1.0 · rock abundance 0.8* |
| Autonomous navigation / cameras | Sun 1.0 · slope 0.5 · roughness 0.5 |
| Drilling / sampling | rock type 1.0* · ice 0.7 |
| Ice detection | ice 1.0 · mean temperature 0.5 |
| Solar power and thermal control | mean temperature 1.0 · Sun 0.8 · max temperature 0.6 |
| Dust, seals and mechanisms | dust 1.0 |
| Habitat / human operations | mean temperature 0.6 · caves 0.4* |
| Communications (line of sight) | roughness 1.0 · slope 0.5 |

\* Not in the Earth search table yet: the test runs on its other variables (`LIMITATIONS.md` §2).

---

## 5. The ranking

Code: `Matcher.rank` in `app/src/match.js`.

1. **Score every cell** of the search body (1.37 M on Earth). For 8-bit columns the note of each of the
   256 possible stored values is computed once, so the loop over cells is only table look-ups.
2. **Keep the best 6,000** for the map. A histogram of the index in bins of 0.1 is walked from 100
   downwards until 6,000 cells are reached; the bin that overflows is included whole and the list is cut
   after sorting.
3. **Break ties.** A test with few variables gives thousands of cells the same index. Cells whose index
   rounds to the same whole number count as tied, and among them the one most similar on *all* shared
   variables goes first.
4. **Mix with the surroundings.** For the 3,000 best cells, the index used for ranking is

$$
I_{\text{area}} = (1 - \alpha)\thinspace  I_{\text{cell}} + \alpha\thinspace  \frac{1}{6}\sum_{k=1}^{6} I_{k},\qquad \alpha = 0.4
$$

   where $I_k$ are the 6 neighbouring cells (a neighbour outside the search mask counts 0) and
   $\alpha$ is chosen by the team (`scoring.area_weight`). A hexagon
   and its ring span ~20 km on Earth: this puts first the homogeneous areas where a field campaign
   fits, not an isolated good cell.
5. **Spread the results.** Sites are taken in order, skipping any closer than $d_{\min}$ to one already
   chosen, until there are 6. $d_{\min}$ = 400 km on Earth, scaled by the radius on the other bodies
   (213 km on Mars, 109 km on the Moon), and reduced to a fifth of the zone's size when the search is
   limited to a zone (never below 5 km). If the best cells all lie in one region, the search continues
   down to 50,000 cells.

Checked on 6 body pairs × 9 test options × every catalogue site: no empty list, 6 sites in every case.

---

## 6. Worked example

Illustrative values (not a real pair of cells), computed with the real configuration by
`src/analogs/similarity.py`. Target: a Mars cell. Candidate: an Earth desert cell.

| Variable | Mars | Earth | Δ | `half_diff` | Note |
|---|---|---|---|---|---|
| Slope | 2.0° | 3.5° | 1.5 | 3 | 1 / (1 + 0.5²) = **0.800** |
| Roughness | 1.5° | 2.5° | 1.0 | 2 | **0.800** |
| Mean temperature | 215 K | 288 K | 73 | 15 | 1 / (1 + 4.87²) = **0.041** |
| Max temperature | 270 K | 310 K | 40 | 20 | **0.200** |
| Night temperature | 185 K | 278 K | 93 | 15 | **0.025** |
| Rainfall | 0 | 20 mm/yr | 20 | 100 | **0.962** |
| Ice | none | none | — | matrix | **1.000** |
| Max Sun elevation | 90° | 90° | 0 | 10 | **1.000** |
| Dust | 0.45 | 0.10 | 0.35 | 0.15 | **0.155** |

| Dimension | Mean of its notes |
|---|---|
| Terrain | (0.800 + 0.800) / 2 = 0.800 |
| Thermal | (0.041 + 0.200 + 0.025) / 3 = 0.089 |
| Water & ice | (0.962 + 1.000) / 2 = 0.981 |
| Sky & light | (1.000 + 0.155) / 2 = 0.578 |

**All shared variables:** $I = 100 \cdot (0.800 + 0.089 + 0.981 + 0.578) / 4 = 61.2$.

The same pair under three tests:

| Test | What counts | Index |
|---|---|---|
| Wheels | Terrain only (rocks have no data) | **80.0** |
| Solar power and thermal control | Thermal = (1.0·0.041 + 0.6·0.200) / 1.6 = 0.100 with weight 1.0; Sky = 1.000 (Sun) with weight 0.8 → 100·(0.100 + 0.8) / 1.8 | **50.0** |
| Dust | Dust only | **15.5** |

The place is a good analog to test wheels, a poor one for thermal control and a bad one for dust. This
is why the app asks what you want to test.

---

## 7. Rover test planner

Code: `app/src/rover.js`; parts, margins and caps in `app/data/rover.json` (all chosen by the team).

The question is different from the index: not "how similar on average", but "is there a place where
this part can be tested?". Each part of the rover depends on a few variables $k$, each with a margin
$m_k$ around the target value. A cell is valid for the part only when **every** variable is inside its
margin (the weakest link decides: the right slope with the wrong roughness is not a valid wheel test).
The distance of an Earth cell $c$ to the target $t$ for a part is therefore a maximum, not a mean:

$$
d = \max_k \frac{|c_k - t_k|}{m_k}
$$

| Status | Condition |
|---|---|
| ✔ Field test on Earth | Some Earth cell has $d \le 1$ |
| ◐ Field test with caveats | Only cells with $d \le 2$; or a variable of the part has no data; or physics caps it (gravity for wheels, no air to scatter light for cameras on the Moon) |
| ✖ Lab only | No cell with $d \le 2$; or the part needs vacuum |

| Part | Variables (margin = `tolerance` of `variables.yaml` unless given) | Physics cap |
|---|---|---|
| Wheels & suspension | Slope ±5°, roughness ±3° (rock abundance missing on Earth) | Gravity (Mars, Moon): caveats at best |
| Mast cameras & navigation | Max Sun elevation ±3°, roughness ±3° | Moon: no air to scatter light → caveats |
| Robotic arm & coring drill | Ice depth; silica ±8 wt % (not in the Earth search table yet, so it is reported as missing) | Moon: vacuum, no air to cool the bit → caveats |
| Power source & thermal control | Max ±30 K, min ±30 K and night ±20 K temperature | Mars: thin air → caveats. Moon: vacuum → lab only |
| Body, seals & optics (dust) | Airborne dust ±0.2 | Moon: dust in vacuum → lab only |

A variable the target body does not have is skipped (Mars has no minimum temperature, the Moon no night
temperature).

$$
\text{testability index} = 100\ \frac{n_{\text{field}} + \tfrac12\thinspace  n_{\text{caveats}}}{n_{\text{parts}}}
$$

Measured: Jezero 70 %, Shackleton 30 %, the Mars sites 60–70 %, the lunar sites 25–30 %.

Among cells equally good for one part, the one that is also closest for the rest of the rover goes
first: cells are ordered by $d + \tfrac12 (1 - G)$, where $G$ is the mean over the testable parts of
$\max(0,\ 1 - d/2)$. **Whole rover** paints the cells where most parts pass at once. The **campaign**
is the smallest set of sites that covers every testable part, built greedily: start at the best
all-in-one site, then add the nearest cell that covers the most parts still uncovered (a set-cover
heuristic).

"Field" means that at least one such cell exists in the search mask, not that the place is accessible.

---

## 8. Route replica

Code: `app/src/routeSolver.js` (same algorithm as `scripts/rover_route/free_route.py`).

A route on Mars or the Moon is turned into a list of slopes, one per step of length $L$:
$\theta_k = (z_{k+1} - z_k)/L$ for $k = 1 \dots N$ ($N \le 100$). The problem: find on an Earth
elevation grid (pixel $L/3$) a path whose slopes follow the same list in the same order.

It is solved exactly by **dynamic programming** over the state (cell $p$, heading $h$). The path
advances one step in one of 16 headings and may turn at most one heading (22.5°) per step. With
$\sigma(p, h)$ the Earth slope of the step that leaves $p$ with heading $h$, and $p + \delta_h$ the
cell it reaches:

$$
V_k(p, h) = \big|\sigma(p, h) - \theta_k\big| + \min_{h' \in \lbrace h-1,\ h,\ h+1\rbrace } V_{k+1}(p + \delta_h,\ h'),\qquad V_{N+1} = 0
$$

The best path starts at the state that minimises $V_1$ and is recovered by following the stored
choices. Steps steeper than the rover's limit, or over water, are not allowed. The cost is the mean
slope error per step; the app also reports the fraction of steps within the tolerance, the largest
error and the correlation between the two slope profiles. Only relief at the step length is compared
(≥ 200 m on Mars, ≥ 120 m on the Moon, 30 m for real rover traverses): rocks and sand are not seen.

---

## 9. Storage precision

Each column is stored as an integer $q = \mathrm{round}\big((x - \text{offset}) / \text{scale}\big)$, so
the value read by the app differs from the computed one by at most $\text{scale}/2$: 0.125° for slope
and roughness, 0.5 K for temperatures, 0.005 for dust. These steps are far below the tolerances of §4,
so quantisation does not change the ranking. `scripts/check_grid_binary.py` verifies it for every
export. Format: [`07_card_grid_binary_format.md`](07_card_grid_binary_format.md).

---

## References

- Appelbaum, J. & Flood, D. J. (1990). Solar radiation on Mars. *Solar Energy* 45(6), 353–363 (NASA
  TM-102299). Updates: NASA TM-103623 (1990) and TM-105216 (1991).
- Golombek, M. & Rapp, D. (1997). Size-frequency distributions of rocks on Mars and Earth analog sites.
  *JGR Planets* 102(E2), 4117–4129.
- Kreslavsky, M. A. & Head, J. W. (2000). Kilometer-scale roughness of Mars: results from MOLA data
  analysis. *JGR Planets* 105(E11), 26695–26711.
- Montabone, L. et al. (2015). Eight-year climatology of dust optical depth on Mars. *Icarus* 251, 65–95.
- Nelson, F. E. et al. (1997). Estimating active-layer thickness over a large region: Kuparuk River
  basin, Alaska. *Arctic and Alpine Research* 29(4), 367–378.
- Presley, M. A. & Christensen, P. R. (1997). Thermal conductivity measurements of particulate
  materials. *JGR Planets* 102(E3), 6551–6566.
- Uber Technologies. H3: hexagonal hierarchical geospatial indexing system. https://h3geo.org

Data products and their citations: [`DATA_SOURCES.md`](DATA_SOURCES.md).
