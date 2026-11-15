# Documentation

Everything written about the project, in the order it is best read. The **reference documents** describe
the product as it is today; the **working notes** are the team's documents from the hackathon weekend,
kept because they show how each decision was reached.

## Reference documents (start here)

| # | Document | Read it to learn | Time |
|---|---|---|---|
| 1 | [`../README.md`](../README.md) | What the project is and how to run it | 3 min |
| 2 | [`ARCHITECTURE.md`](ARCHITECTURE.md) | How the repository works: the three stages (data → web data → app), what happens on a click, how the folders fit together, glossary | 10 min |
| 3 | [`METHODOLOGY.md`](METHODOLOGY.md) | The mathematics: the hexagonal grid, how each variable is computed from the raw data, the analog index, the ranking, the rover planner and the route replica | 25 min |
| 4 | [`DATA_SOURCES.md`](DATA_SOURCES.md) | Every dataset: mission, product, resolution, period, what it feeds, where it was downloaded from and how to cite it | 10 min |
| 5 | [`CODE_REFERENCE.md`](CODE_REFERENCE.md) | What each module, script and configuration file does and who calls it | 15 min |
| 6 | [`LIMITATIONS.md`](LIMITATIONS.md) | What the index does not measure, what Earth cannot reproduce and what is not validated yet | 5 min |
| 7 | [`07_card_grid_binary_format.md`](07_card_grid_binary_format.md) | The binary format of the files the app reads (`app/data/`) | 10 min |
| 8 | [`AI_USAGE.md`](AI_USAGE.md) | Where and how AI tools were used | 2 min |
| 9 | [`NEXT_STEPS.md`](NEXT_STEPS.md) | What we would build next | 5 min |

Related, outside this folder: [`../CREDITS.md`](../CREDITS.md) (licences and required credits),
[`../ROADMAP.md`](../ROADMAP.md) (task list with what was done and how it was checked),
[`../app/README.md`](../app/README.md), [`../scripts/README.md`](../scripts/README.md) and
[`../data/README.md`](../data/README.md).

## Working notes (history of the project)

| Document | What it is | Still current? |
|---|---|---|
| [`02_reto_oficial.md`](02_reto_oficial.md) | The official challenge statement | Yes |
| [`01_como_funciona.md`](01_como_funciona.md) | The team's starting guide: what satellite data are, the idea of comparing cards | Yes, as an introduction |
| [`03_enfoque.md`](03_enfoque.md) | The approach proposed before building: why physical units, why one baseline, what Earth cannot reproduce | Mostly; where the product differs it says so. The final method is in `METHODOLOGY.md` |
| [`09_criterios_seleccion.md`](09_criterios_seleccion.md) | The changes made to the scoring formula and the validation plan | Yes; summarised in `METHODOLOGY.md` §5 and `LIMITATIONS.md` §4 |
| [`06_datos_luna.md`](06_datos_luna.md) | The Moon data kit: what was downloaded, what was rejected and why | Yes |
| [`08_datos_LEEME.md`](08_datos_LEEME.md) | Guide of the data folder (outside git): processing order, reference numbers | Yes |
| [`decisions/README.md`](decisions/README.md) | Decision log (001–007) | Yes |
| [`10_session_handoff.md`](10_session_handoff.md) | Hand-off notes of one working session | Historical |

File names in Spanish (`como_funciona`, `enfoque`, `datos`, `criterios_seleccion`) are kept because code
comments and other documents link to them.
