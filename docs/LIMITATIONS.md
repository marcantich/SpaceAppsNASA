# Limitations

What the tool does not do, stated plainly. An analog is never a copy: it reproduces some conditions and
not others, and a test is only as good as the conditions it shares with the real site.

## 1. What Earth cannot reproduce

These never enter the index. They are fixed facts shown with each test and applied as caps in the rover
test planner.

| | Moon | Mars | Earth | Consequence |
|---|---|---|---|---|
| Gravity (m/s²) | 1.62 | 3.71 | 9.81 | Wheel load, sinkage and traction scale with it: mobility tests need a lightened vehicle |
| Surface pressure (Pa) | ~0 | ~610 | 101,325 | Heat leaves differently (no convection in vacuum), dust is lifted differently, drills are not cooled by air |
| Solar day | 29.5 days | 24.66 h | 24 h | Shadows move ~30 times faster on Earth than on the Moon; thermal cycles differ |
| Radiation | No atmosphere, no magnetosphere | Thin atmosphere, no global magnetosphere | Shielded by both | Cannot be field-tested |
| Temperature range | A few tens of K in permanent shadow to ≈ 390 K at noon | Mean ≈ 210 K | Coldest satellite-measured surface ≈ 175 K | No Earth cell reaches the mean cold of Mars: the best thermal notes stay low, and that is a result, not an error |

## 2. What the index does not compare yet

| Missing | Effect |
|---|---|
| **Geology and mineralogy** (rock type, clays, sulfates, carbonates) | Two cells can match in terrain and climate and be different rocks. The *Drilling* test compares only ice |
| **Rock abundance** on Earth | *Wheels* compares slope and roughness without rocks; ~285,000 Earth cells score 100 for a flat Mars site and are separated only by the tie-break |
| **Caves and lava tubes** on Earth and Mars | *Habitat* compares only the mean temperature |
| **Grain size, soil mechanics** | Not available globally on any body |
| **Wind and solar energy** on Earth | Computed for Mars and shown on its card, but not compared |
| **Accessibility** (distance to roads, protected areas) | A top-ranked cell may be unreachable. Planned as a filter (`operability` in `configs/variables.yaml`), not built |

Tests whose variables are partly missing say so in the results bar ("2 of 3 variables"). Hiding the two
tests that compare a single variable (*Drilling*, *Habitat*) is still pending (ROADMAP 4.13).

## 3. Limits of the data

- **Scale.** One value per cell of 6–12 km. A crater wall, a dune field or a lava tube inside a cell is
  averaged out. Only the Mars slope can be read at ~925 m, and only for display.
- **Interpolated relief.** MOLA and LOLA measure along orbital tracks. Near the Mars equator only
  15–46 % of the ~460 m pixels hold a real laser shot; the rest are interpolated and smoother than the
  real ground. The card shows the measured fraction of each cell.
- **Coarse inputs.** Mars temperatures and dust are 5° bins (~300 km), Mars GRS ~300 km, Earth dust
  ~55 km, Moon composition ~60 km. Neighbouring cells share these values.
- **Different definitions between bodies.** Mars maximum temperature is a 95th percentile, Earth's is a
  monthly mean. Moon polar temperature products refer to 2 cm depth, MODIS to the surface. Mars day and
  night temperatures come from two different Mars years and instruments.
- **Gaps.** No relief on Mars beyond ±87°. No ice information on the Moon between 60° and 80° (12.6 % of
  its cells) or at its north pole. The flat-horizon Sun formula is not used at the lunar poles.
- **Assumed values.** Ice north of 70° N on Mars, "no ice" away from the lunar poles, and the whole
  Earth ice depth (a permafrost model, not a measurement) are assumptions, labelled as such on the card.
- **Earth search mask.** Only deserts, polar ice and arid open land are searched (34 % of the land).
  Analogs of geology in vegetated regions (Río Tinto, Ries, Sudbury, Lonar, Kilauea) are outside it by
  construction.
- **Known biases.** IMERG overestimates rain in hyper-arid deserts; ECOSTRESS silica is unreliable under
  vegetation ([`DATA_SOURCES.md`](DATA_SOURCES.md) §8).

## 4. What is not validated

- **Tolerances and weights are the team's assumptions.** Every `half_diff` has a written reason, but
  none has been calibrated. The same holds for the neighbour weight (0.4), the SWIM threshold, the
  permafrost coefficient, the mask thresholds and every rover margin.
- **Only manual spot checks so far.** Searching from Apollo 15 (Hadley–Apennine), the team checked
  that the expected kind of zone came out (cold, dry open land: Patagonia first, then Mongolia and
  Canada). The systematic validation against known analogs (ROADMAP 3.17) is not run yet. The plan
  ([`09_selection_criteria.md`](09_selection_criteria.md)): for each known analog, its percentile in the
  ranking from the site it represents; enrichment of known analogs in the top 1 % against random cells of
  the same mask; leave-one-out tuning; sensitivity of the top 100 to ±50 % changes of each tolerance.
  With 20 known sites this can catch large errors, not calibrate the index.
- **The index is not a probability.** 80 does not mean "80 % likely to be a good analog"; it orders
  places for one target and one test.
- **The JavaScript and Python implementations of the formula are kept equal by hand.** Tests cover the
  Python one only.
- **Target sites.** The 9 lunar south-pole candidate regions announced by NASA in 2024 are not in the
  app: their coordinates must come from the official polygons.

## 5. Rover test planner and Route replica

- "Field test on Earth" means that **at least one cell** in the search mask is inside the margins, not
  that the place is accessible or that a test there would be sufficient.
- Margins and physics caps are hand-written assumptions (`app/data/rover.json`).
- The drill is judged on ice only; rock type is not in the Earth search table.
- The Route replica compares **relief at the step length** (≥ 200 m on Mars, ≥ 120 m on the Moon, 30 m
  for real traverses). Rocks, sand and anything smaller than a step are not seen.
