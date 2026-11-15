# 01 · Quick guide: how this works

> For anyone who has never worked with satellite data. Written by Marc on 2026-11-14 as the team's
> starting guide; the *why* of the method is in the [approach](03_approach.md). What was finally built is
> described in the [README](../README.md).

---

## 1. The idea in one sentence

**We do not compare pictures: we compare the "data sheet" (card) of each place** (slope, temperature,
ice, rock type, sunlight…) and look on Earth for the cards most similar to that of a place on the Moon or
Mars, **depending on what you want to test**.

---

## 2. What "satellite data" are

- **Raster:** an image where each pixel stores **a physical number** and knows its latitude and longitude.
  - A colour photo is 3 rasters: how much red, green and blue light the ground reflects.
  - A **DEM** is a raster of heights (m). An **LST** is a raster of surface temperature (K). A **radar**
    image is a raster of echo strength (dB).
- **Resolution:** the size of a pixel on the ground (30 m, 1 km…).
- **Formats:** GeoTIFF (the easiest), NetCDF / HDF5 (scientific: several variables and dates in one file)
  and tables (CSV / TAB, like Diviner's PRP).
- **Processing levels (NASA convention):**

  | Level | What it is | Do we use it? |
  |---|---|---|
  | L0 | Raw instrument signal | ❌ |
  | L1 | Calibrated (radiances) | ❌ |
  | L2 | Physical variable (e.g. temperature) in the geometry of each pass | Only if there is no L3 |
  | **L3** | **Physical variable on a regular grid**, often a global monthly mean | ✅ **The usual** |
  | **L4** | Models or derived products (e.g. Diviner PRP ice depth) | ✅ |

  **Rule:** we work with L3 / L4. L0 and L1 are where people drown.
- **Vectors:** points and polygons (sites, craters, volcanoes) in CSV or GeoJSON.
- **Projection (CRS):** how the sphere is flattened into a map. Lat/lon works for almost everything; polar
  stereographic is used at the poles. The Moon and Mars have their own systems and radii: **they are
  never mixed with Earth's**, each body is processed on its own.

> **CFD analogy:** each dataset is a scalar field on its own mesh. The work is to bring them all to a
> **common mesh** and compare cell by cell. As in CFD, ~70 % of the effort is **pre-processing** (finding,
> downloading, cropping and resampling), not the "solver".

---

## 3. The flow, from zero to the demo

```
 ① What do you want to test?  →  ② Which variables control it?  →  ③ Which dataset has each variable?
                                                                     (Moon, Mars and Earth)
            ↓
 ④ Download ONLY what is needed  →  ⑤ Read, crop, common mesh  →  ⑥ Derived fields (slope, roughness…)
            ↓
 ⑦ Card table (1 row = 1 cell or site)  →  ⑧ Weighted similarity  →  ⑨ Validate  →  ⑩ Web globe
```

**Why an index and not an API call on every click.** Google does not visit the whole web when you search:
it has it indexed. We do the same. NASA data are downloaded and processed **once** (steps ④–⑦, tens of GB
that never go into the app) and turned into a **card index** of a few MB per body (`app/data/`). The app
computes the matches on that index instantly, with any filter. The only live requests are the **maps and
imagery** when zooming. A new site or variable means rerunning a script; the app does not change.

---

## 4. "What about AI?"

- **Training an AI** means showing it many examples *with the right answer*. For "this pixel is a good
  place to test Mars wheels: yes / no" those answers do not exist: there are about 20–50 known analogs.
  A model would learn nothing reliable from that, and it could not explain why.
- **What we do:** a **similarity search**, i.e. finding the nearest neighbours in the space of variables.
  It is a classic unsupervised method: it needs no training and can be explained variable by variable.
  The challenge asks for exactly this: *"similarity metrics, machine learning"* and *"think beyond visual
  similarity"*.
- **Pictures are useful** for the cards and the demo (side by side, at the same scale), not for the
  calculation.
- **The index (0–100) is an analogy index, not a probability:** it is not calibrated against anything.

---

## 5. "What do you want to test?" → variables → data

The heart of the app. The weights are in [`configs/pruebas.yaml`](../configs/pruebas.yaml) and the
sources and tolerances in [`configs/variables.yaml`](../configs/variables.yaml).

| I want to test… | Controlled by | What Earth does NOT reproduce, and how to compensate |
|---|---|---|
| **Wheels / mobility** | slope, roughness, rocks, grain size | Wheel load ∝ m·g → lightened test vehicle (JPL did it with *Scarecrow* for Curiosity) |
| **Autonomous navigation / cameras** | low Sun, shadows, no vegetation, albedo | Shadows move ~30× faster; the sky fills shadows with diffuse light |
| **Drilling / sampling** | rock type, frozen and cemented ground | The material yes; the ground temperature no |
| **Ice detection** (radar, neutrons) | subsurface ice and its depth | Partial: lunar ice sits in vacuum |
| **Solar power and thermal control** | sunlight, extreme temperatures, cycles | Earth never drops below ≈ −90 °C nor reaches the lunar noon (≈ +120 °C) |
| **Dust, seals, mechanisms** (Mars) | airborne dust, wind | Mars air is ~60× thinner → dust is lifted differently |
| **Habitat / human operations** | isolation, cold, darkness, logistics | Neither radiation nor gravity |
| **Communications** | relief blocking the line of sight | The geometry is reproduced |

---

## 6. Glossary

| Term | What it is |
|---|---|
| Raster / pixel | An image of numbers; the pixel is one cell |
| Band | One of the "layers" of a raster (e.g. red, or an infrared channel) |
| DEM | Digital elevation model (heights) |
| LST | *Land Surface Temperature*, seen from the satellite |
| NDVI | Vegetation index (green = high) |
| Albedo | Fraction of light reflected |
| SAR | Synthetic aperture radar: sees day and night, through clouds |
| H3 | Uber's hexagonal grid of equal-area cells, used for the card grids of the three bodies |
| Card (*ficha*) | The values of every variable in one cell or site |
| Granule | One file or scene within an Earthdata collection |
| Tile / WMTS | Small map pieces loaded by the web app (base maps from GIBS and Trek) |
| L0–L4 | Processing levels (§2) |
