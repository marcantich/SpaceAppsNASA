# 06 · Moon data: the kit (v1)

> Full review of the sources on 2026-11-14: PDS Geosciences (Diviner, LOLA, LEND, Mini-RF, Lunar
> Prospector), PGDA (NASA Goddard), USGS and LROC. Everything was checked by reading the file labels
> before downloading. **Coverage: the WHOLE Moon**, so that every mission (Apollo, Luna, Chang'e, SLIM,
> CLPS…), the lava tubes and the south-pole base regions are included.
> Built into the Moon card grid by `src/analogs/moon.py` (`scripts/build_moon_grid.py`).

## 1. The kit: each variable and where it comes from, outside and inside the polar zone

There are two zones because some products do not reach the pole. **Global zone** = 60° N to 60° S.
**Polar zone** = 60° to 90°.

| Card variable | Global zone | Polar zone | Notes |
|---|---|---|---|
| **Slope** (°) | LOLA `ldem_64.img` (relief, 531 MB, ~470 m) → **computed by us** | PGDA `LDRM_80S_1000MPP_ADJ_SLP_800M.TIF` (1.5 MB) | Same baseline on the Moon, Mars and Earth (~460 m pixels) |
| **Roughness** | same, computed | PGDA `…_ROUGH_800M.TIF` (1.5 MB) | |
| **Mean, max and min temperature** (K) | Diviner **GCP** (0.5° bins ≈ 15 km, temperature every 15 min of local time) | GCP + **Diviner PRP** (~0.5 km, south of −76°) | From the GCP: mean, max and min of the `tbol` column (−9999 = no data) |
| **Ice depth** (m) | Ice is not stable near the surface away from the poles → "deeper than 2.87 m" (physical assumption) | Diviner PRP `ice_depth` + PGDA `LPSR_80S_20MPP_ADJ.TIF` (permanent shadow, 148 MB) | ⚠️ In the PRP, `−999` = deeper than 2.87 m (NOT "no data"); `0` = ice at the surface; **`−1` (undocumented) = the coldest areas (max T 52–99 K) → also ice at the surface**  |
| **Composition: iron (FeO, %)** | Lunar Prospector GRS `lpgrs_high1_elem_abundance_2deg.tab` (9.9 MB, 2° bins, **global**) | same | Also has Al₂O₃, TiO₂, MgO, CaO, SiO₂, K, Th, U |
| **Rock type** (class) | From FeO: high iron → "mare" (basalt); low → "highlands" (anorthosite) | same | For detailed site cards: the USGS geologic map (224 MB) |
| **Rocks** (%) | Diviner `dgdr_ra_avg_cyl_032_img.img` (88.5 MB, ~950 m) | ❌ **does not exist** → empty | Only covers 60° N–60° S |
| **Caves** | LROC pits atlas list (278 pits with coordinates) | same | **0 pits south of −80°** (the closest, at −78°) |
| *Radar CPR* (extra, **not downloaded**) | Mini-RF `global_cpr_32ppd_simp_0c.img` (265 MB, ~950 m) | same (covers −90..90°) | Not a card variable: `python scripts/download_moon.py --extras` |
| **Sun elevation** | computed (geometry) | geometry + relief | |

**Downloaded on 2026-11-14: 88 files, 4.4 GB** (`python scripts/download_moon.py`; log in
`data/raw/moon/MANIFEST.csv`). Same day: the Mini-RF radar and the PGDA Hurst exponent were removed from
the kit because they give no card variable (still available with `--extras`).

## 2. Three ways of getting a value

1. **Download the whole file:** the small ones (PGDA 1.5 MB, Lunar Prospector, pits list) or those that
   have to be read entirely (Diviner PRP, GCP bands).
2. **Read only a piece:** every server answers `206` (checked), so only part of a file can be requested.
   - The PGDA TIFs are *Cloud-Optimized GeoTIFFs*: `rasterio` reads **only the window** of each site:
     ```python
     import rasterio
     from rasterio.windows import from_bounds
     url = "/vsicurl/https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LPSR_80S_20MPP_ADJ.TIF"
     with rasterio.open(url) as src:          # polar stereographic, in metres
         window = src.read(1, window=from_bounds(x0, y0, x1, y1, src.transform))
     ```
   - The cylindrical `.img` files (LOLA, Mini-RF, Diviner) store the image row by row, north to south:
     **only the rows at a site's latitude** can be requested.
3. **Read a web table:** the LROC pits list.

## 3. Reviewed and rejected (so nobody loses time)

| Product | Why not |
|---|---|
| Diviner GDR L3 **by date** (`…_2009…`, 1.9 GB) | One week per file; the equivalent cumulative products are in the kit |
| Diviner GDR L3 soil temperature / CF | Only 60° N–60° S and add nothing to the kit (CF: composition, already covered by Lunar Prospector) |
| Diviner GHRM | Only 70° S–70° N, 3.3 GB files |
| LEND (neutrons) | Only raw counts, no ready maps |
| LOLA `ldsm` / `ldrm` (ready slope and roughness) | Unclear baseline (the label says both 240 m and 30–120 m). Better computed by us or taken from PGDA |
| SLDEM2015 (59 m relief, 2.8 GB) | More detail than needed; `ldem_64` is enough at our scale |
| Radio Science | Gravity: not a card variable |
| PGDA 104 (5 m relief of the 13 regions of 2022) | Too much for the comparison; only useful for detailed site cards |

## 4. Still open

- **Coordinates of the 9 south-pole candidate regions (NASA 2024)**: they must come from the official
  polygons, not be placed by eye. Until then the app shows the 9 sites of `app/data/luna/objetivos.json`.
- Check the units of Lunar Prospector (fraction or %).

## Links

- Diviner (GCP, PRP, GDR): https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/
- LOLA, global relief: https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/
- PGDA, south pole (product 90): https://pgda.gsfc.nasa.gov/products/90 (files in `https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/`)
- Lunar Prospector, composition: https://pds-geosciences.wustl.edu/lunar/lp-l-grs-5-elem-abundance-v1/lp_9001/data/
- Mini-RF, global mosaic: https://pds-geosciences.wustl.edu/lro/lro-l-mrflro-5-global-mosaic-v1/lromrf_1001/data/32ppd/
- LROC, pits atlas: https://lroc.im-ldi.com/atlases/pits/list
- USGS, unified geologic map: https://astrogeology.usgs.gov/search/map/unified_geologic_map_of_the_moon_1_5m_2020
