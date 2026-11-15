# 09 · Selection criteria: what was applied and how to validate it

State on 2026-11-15. Formula in `src/analogs/similarity.py` (Python) and `app/src/scoring.js` (web), with
the parameters in `configs/variables.yaml` (blocks `dimensions`, `scoring` and, per variable,
`dimension`, `half_diff`, `matrix`, `criterion`). After changing the YAML: `python scripts/export_scoring.py`
and reload the page.

## Applied

| # | Change | Before | Now |
|---|---|---|---|
| 1 | Soft note | `max(0, 1 − Δ/tol)`: beyond `tol` everything scores 0 and stops being ranked | `1 / (1 + (Δ/half_diff)²)`: 0.5 at `half_diff`, 0.2 at 2×, never 0. Antarctica ranks ahead of the Sahara in temperature although neither reaches Mars |
| 2 | Weights by dimension | 3 temperatures = 3 votes out of 9 | Terrain · Thermal · Water & ice · Sky & light (· Composition). Each dimension weighs 1 (or the largest weight the test gives to its variables); inside it, a weighted mean |
| 3 | Tolerances with a criterion | All `[assumption]` without justification; Sun at 3° tied the search to the same latitude; binary ice | `half_diff` with a written `criterion` (operational, measurement or climatic). Sun 10°. Ice with a matrix between classes (≤ 1 m ↔ 1–5 m = 0.5…) |
| 8 | Surroundings of the cell | Only the cell (6.5 km) | Ranking = 60 % the cell + 40 % the mean of its 6 neighbours (~20 km; neighbours outside the search zone count 0). Rewards homogeneous areas where a field campaign fits |
| 10 | Same index in both directions (2026-11-15) | Rain on Mars / the Moon was dropped when the *search* body was Mars or the Moon | Variables that are zero by nature (no rain on Mars or the Moon, no dust on the airless Moon) count as 0 in both directions |
| 11 | Only the variables with data (2026-11-15) | A test whose variables had no data silently used all variables | Each search compares the variables with data on both sides and the results bar says how many ("2 of 3 variables"); with none, all available variables, and it says so |

`tolerance` is kept for variables without `half_diff` and for the margins of the rover test planner.

## Point 9 (study, NOT applied): validate with known analogs

**Idea.** If the index makes sense, the places the community already uses as analogs should rank high
when searching from the Mars or Moon site they represent.

**Test set** (already in `app/data/analogos_conocidos.json`, 20 sites, with `analog_of`):

| Target | Expected analogs |
|---|---|
| Mars, icy mid-latitudes (Phoenix, Arcadia, Utopia) | McMurdo Dry Valleys, Devon Island (Haughton), Svalbard (Bockfjord) |
| Mars, dry equatorial (Jezero, Gale, Meridiani) | Atacama, MDRS (Utah), Pilbara, Dallol, Río Tinto |
| Volcanic Mars | Iceland (Askja), Mauna Kea, Kilauea, Teide, Lanzarote |
| Moon (maria, highlands) | Lanzarote, SP Crater, Craters of the Moon, Meteor Crater, Ries, Sudbury |
| Moon, south pole (Shackleton) | Antarctica (Transantarctic Mountains), Devon Island |

**Metrics** (for each target → analog pair):
- *Percentile of the analog*: the fraction of the 1.4 M search cells below the analog's index (100 = the
  best). Summary: median per group.
- *Top-1 % enrichment*: how many times more known analogs fall in the best 1 % than by chance.
- *Recall@N*: does the analog (within 50 km) appear among the N best separated sites?

**How to tune without cheating.**
1. Small parameter grid (`half_diff` ×0.5 / ×1 / ×2 per dimension, `area_weight` 0 / 0.2 / 0.4).
2. Choose with *leave-one-out*: tune with 19 sites and measure on the one left out, in turn.
3. Sensitivity: with the chosen parameters, vary each `half_diff` ±50 % and measure how much the top 100
   change (overlap or Kendall τ). A site that stays on top under every variant is robust.

**Caveats.**
- 20 sites is little: enough to catch big errors, not to "calibrate" in a statistical sense.
- Known analogs are biased towards accessible places (near roads, bases or universities): a good remote
  analog that is not in the list is not a failure of the index.
- Several sites in the list fall outside the search mask (Río Tinto, Teide, Kilauea: vegetation or
  towns nearby). They must be measured with their own card, not required to appear in the ranking.
- Some are analogs for a single property (Río Tinto: water chemistry; Ries: impact). No current variable
  measures that: they should count as a failure of a specific test, not of the general index.

**Estimated cost.** A script `scripts/validate_analogs.py` (reads the Mars and Moon cards and the Earth
search table, ~1 min per parameter combination) and a report in `docs/`. Half a day.
