# 03 · Approach: why the method is what it is

> Written by Marc on 2026-11-13 (night) as the team's proposal, before building anything. It explains the
> *why* of the method; the *how* is in [01_how_it_works.md](01_how_it_works.md). Most of it was applied;
> where the final product differs, it is said in a note (the final formula is in
> [09_selection_criteria.md](09_selection_criteria.md)).
> **[verify]** = not checked · **[hypothesis]** = a bet the engine has to confirm or reject ·
> **[assumption]** = a value chosen by us.

---

## 0. In 6 lines

1. **Product = tool + story.** A global, explainable analog search (the *method*) **and** a few new
   analogs characterised in depth (what *surprises*).
2. **Physical similarity, not visual likeness.** As in a wind tunnel: you do not reproduce the whole
   aircraft, you reproduce the parameters that control what you want to measure. For each thing to test:
   what controls it, and which part does Earth reproduce?
3. **Unit of comparison = a footprint the size of a landing ellipse (~10 km)**, with every variable
   computed at the **same resolution** on the three bodies.
4. **Score by dimension**, with what Earth *cannot* reproduce (gravity, pressure, radiation) always
   visible.
5. **Focus:** the lunar south pole (the challenge title is *Permanent Moon Base*) + Mars sites.
6. **"New" is measured:** high similarity × far from known analogs × accessible. Validate with known
   analogs **per profile** and **against a null model**.

---

## 1. What the full official text adds

The full challenge text ([`02_official_challenge.md`](02_official_challenge.md)) explicitly asks for:

| The statement says | Implication for us |
|---|---|
| *"The goal is not simply to rediscover well-known analog sites"*; Antarctica, Atacama, Iceland, Hawaii *"already widely studied"* | Known analogs only **validate**. They are never the headline result |
| *"Explain which characteristics… provide a strong analogy, where the analogy breaks down"* | Each card: what matches, **how much** (with values and units) and what does not |
| *"Think about processes as well as places"* | At least one **process** layer (dust, wind erosion, ice) |
| *"Consider scale"* (a crater, a valley… not a continent) | Global screening on a fine enough grid |
| *"Explore the whole Earth, including below its surface"* | A caves / lava tubes layer |
| *"Connect your analog to exploration"* | Each card: **what you would test here** (instrument, operation, risk reduced) |
| *"Remember Earth's limits"* (gravity, vacuum, thin atmosphere, radiation) | A fixed "not analog" block (§5) |
| *"Surprise us"* | §4 |

---

## 2. Problems in the first proposal (and how we fixed them)

### 2.1 ⚠️ Normalising by percentiles within each body is wrong for physical variables

The initial brief proposed *"normalising each variable within its body (percentiles or z-score)"*. That
compares **relative positions**, not conditions. Example: Jezero's mean temperature is a *typical* Mars
value → percentile ~50 → it would be paired with Earth's percentile 50, i.e. temperate places. Absurd.

**Rule:** variables with a common physical scale (slope in °, roughness at the same baseline, albedo, rock
abundance in %, temperature in K) are compared **in physical units** with a tolerance. The first version
was linear:

$$
s_k = \max\left(0,\enspace  1 - \frac{\left|x_k^{\text{target}} - x_k^{\text{Earth}}\right|}{\sigma_k}\right),
\qquad
S = 100\thinspace \frac{\sum_{k} w_k\thinspace  s_k}{\sum_{k} w_k}
$$

with $\sigma_k$ the tolerance of variable $k$ and $w_k$ the weight of the chosen test
([`configs/pruebas.yaml`](../configs/pruebas.yaml)). The sums only cover the variables available on both
bodies.

> **Applied with a change:** the final formula uses a **soft note** $s_k = 1/(1+(\Delta_k/h_k)^2)$, which
> never reaches 0, and averages by **dimension** (terrain, thermal, water & ice, sky & light):
> [09_selection_criteria.md](09_selection_criteria.md).

- **Categorical variables** (rock type): a similarity matrix between classes, $s_k = M[c^{\text{target}}, c^{\text{Earth}}]$.
- **Percentiles** only for indices without a common physical scale.
- If Earth **does not reach the range**, $s_k$ is low and the card shows it. Example: lunar permanently
  shadowed regions are at a few tens of K; Earth's satellite-measured minimum is ≈ 175 K on the Antarctic
  plateau [verify]. That is useful information, not a failure of the method.

### 2.2 ⚠️ Slope and roughness depend on the DEM resolution

MOLA ≈ 463 m/px, LOLA polar 5–80 m/px, Copernicus 30 m/px. On the same terrain, slope computed at 30 m
comes out larger than at 500 m. Comparing slopes from DEMs with different **baselines** is like comparing
two CFD solutions on different meshes without a convergence study.

**Fix:** one common baseline before deriving slope and roughness. **Applied:** ~460 m pixels on the three
bodies (MOLA 128 px/deg, LOLA `ldem_64`, ETOPO 2022 15″), decision 006. Reference method: MOLA roughness
at several baselines, Kreslavsky & Head (2000).

### 2.3 ⚠️ Thermal inertia cannot be compared directly between Earth and Mars

Thermal inertia $I = \sqrt{k \rho c}$ (with $k$ the conductivity, $\rho$ the density and $c$ the specific
heat of the soil). But in a granular soil $k$ depends on the gas pressure in the pores: ≈ 6 mbar on Mars
against 1 bar on Earth. **The same $I$ does not mean the same soil** (Presley & Christensen, 1997). On the
Moon (vacuum) the regime is different again, and Earth's satellite "apparent thermal inertia" is
contaminated by soil moisture.

**Fix:** compare what matters to a rover, **grain size / rock abundance**. Thermal inertia is shown on the
Mars card but not compared with Earth.

### 2.4 ⚠️ Lunar south-pole lighting is not like Earth's poles (except in one window)

Obliquity: Moon 1.54°, Earth 23.44°. The lunar candidate regions are within 6° of the pole, so there the
Sun never rises more than ~7.5° and goes round the horizon once per synodic month (29.5 days). At an
Earth pole there are 6 months of daylight and the Sun reaches 23.4°.

Highest daily Sun elevation at latitude $\varphi$ with solar declination $\delta$ (no refraction):

$$
h_{\max} = 90^\circ - |\varphi - \delta|
$$

Near an **equinox** ($\delta \approx 0$), at $|\varphi| \approx 83$–$88^\circ$ Earth reproduces for a few
days the **Sun elevation range** of the lunar sites. But shadows sweep **~30× faster** (15 °/h on Earth
against ≈ 0.5 °/h on the Moon), and the atmosphere fills shadows with diffuse light; on the Moon they are
black except for light reflected by the terrain.

> **Applied** as `sun_elev_max_deg` (highest noon Sun elevation over a year, flat horizon). At the lunar
> poles the flat-horizon formula is not valid (relief decides): there it is not compared.

### 2.5 Grid size

A regular lat-lon grid degenerates at the poles, and half the project is at the poles. **Applied:** H3
equal-area hexagons on the three bodies (Earth res 6 ≈ 6.5 km, Mars res 5 ≈ 9.1 km, Moon res 4 ≈ 12.3 km)
with planet-wide card grids (decision 007).

### 2.6 Validation: "if Atacama comes out, it works" is almost circular

If aridity weighs a lot, **any** hyper-arid desert comes out on top by construction. The plan:
- Tag each known analog with **which dimension** it reproduces and validate **per profile**.
- Compare with a **null model**: random cells of the same mask. Metric, the enrichment factor
  $E = \text{hit rate}@N_{\text{engine}} / \text{hit rate}@N_{\text{random}}$. $E \gg 1$: the engine
  discriminates. $E \approx 1$: we only measure "it is a desert".
- Two strong specific checks: **Lake Salda (Turkey)**, used by NASA as an analog of Jezero's carbonates,
  and **Mistastin crater (Labrador, Canada)**, an impact on anorthosite used as an analog of the lunar
  highlands.

> **Not done yet** (ROADMAP 3.17, method in [09_selection_criteria.md](09_selection_criteria.md)).

### 2.7 Lunar target sites

The 9 south-pole regions in [`target_sites.csv`](../data/catalogs/target_sites.csv) come from NASA's
October 2024 update. Their coordinates must come from the official polygons, **not be placed by eye**:
still open.

### 2.8 The app receives cards (values, units and sources), not scores

A card saying "slope: 0.83" convinces nobody. One saying "Mars 12° · Earth 14° (MOLA / ETOPO)" does. So
`app/data/` stores **the value of each variable** with its unit and source, and the app computes the notes
on the fly: it can show both values on the card, recompute with any test, and show the "not analog" block.
**Applied.**

---

## 3. How it works

```
 TARGET (Moon / Mars cell)               EARTH (search cells)
        │   same variables, same baseline     │
        ▼                                     ▼
   x_target ───── note per variable s_k ─────► index per dimension → analog index
                                                    │
                                                    ▼
                                ranked sites, painted globe, card with both values
```

---

## 4. Bets for the story ("Surprise us") [hypothesis]

**A. Moon: "the base will go to the highlands, but we train on the maria".** The lunar south pole is
highland terrain (feldspathic / anorthositic, on the rim of the Aitken basin) [verify]. Many classic lunar
analogs are basaltic (Hawaii, Lanzarote, Craters of the Moon, SP Crater): they reproduce the **maria**, not
the highlands where the base will go. Likely result: **no single site matches everything**, which leads
to B.

**B. "Analog portfolio" (*set cover*).** Instead of looking for "the best site", find **the smallest set
of 2–3 sites** that together cover every dimension of a target. **Applied** in the rover test planner as
the "campaign" (fewest sites that cover every part of the rover).

**C. Mars: process, not only place.** E.g. the yardangs (wind erosion) of Medusae Fossae ↔ the Lut desert
(Iran), or Arcadia Planitia's shallow ice (SWIM) ↔ ice-rich permafrost.

---

## 5. What is NOT analog (always shown)

| | Moon | Mars | Earth |
|---|---|---|---|
| Gravity (m/s²) | 1.62 | 3.71 | 9.81 |
| Surface pressure (Pa) | ~0 (exosphere) | ≈ 610 (CO₂, varies with the season) | 101,325 |
| Solar day | 29.5 d | 24.66 h (1 sol) | 24 h |
| Surface radiation | no atmosphere, no magnetosphere | thin atmosphere, no global magnetosphere | shielded by both |

Saying it out loud gives credibility. Rover traction and sinkage scale with $g$, and so does crater
morphology: the simple-to-complex transition is at ~2–4 km on Earth, ~7 km on Mars and ~15–20 km on the
Moon [verify]. A crater "of the same size" is **not** an analog crater. In the app these limits appear as
the physics caps of the rover test planner.

---

## References

- Kreslavsky, M. A. & Head, J. W. (2000). Kilometer-scale roughness of Mars: results from MOLA data analysis. *JGR Planets*.
- Presley, M. A. & Christensen, P. R. (1997). Thermal conductivity measurements of particulate materials. *JGR Planets*.
- NASA (Oct 2024). Update on the candidate landing regions near the lunar south pole.
