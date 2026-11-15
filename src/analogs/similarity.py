"""ENGINE: how much does each Earth site resemble a target site on the Moon or Mars?

Three steps (the full example with numbers is in tests/test_similarity.py):

1. Note per variable, from 0 to 1 (configs/variables.yaml):
       with half_diff (soft note):  note = 1 / (1 + (|x_target − x_earth| / half_diff)²)
                                    → 0.5 at a difference of half_diff; it never reaches 0, so it
                                      keeps ranking even when Earth cannot reach the target value
       with matrix (classes):       note = matrix[target][earth]   (e.g. ice classes)
       only tolerance (old):        note = max(0, 1 − |Δ| / tolerance)
       categorical:                 note = matrix[target][earth]   (no matrix: equal = 1, different = 0)
   If the value is missing on Earth or on the target, that note stays empty (NaN).

2. Note per DIMENSION (terrain, thermal, water, sky…): weighted mean of the notes of its
   available variables. This way three temperatures count as one dimension, not as three votes.
   A dimension with NO data at all in that cell counts 0 (what was not measured is not rewarded).

3. Index from 0 to 100 = weighted mean of the available dimensions. Weight of each dimension =
   the largest weight the test (configs/pruebas.yaml) gives to its variables (1 without a test).
   Without dimensions (variables with no `dimension`), each variable is its own dimension: the
   old formula, a weighted mean of the notes.

(The web app adds a 4th step only for ranking: it mixes the index of the cell with that of its 6
neighbours, `scoring.area_weight`, to reward homogeneous areas; see app/src/scoring.js.)

The index is an ANALOGY INDEX, not a probability (it is not calibrated against anything).
The app uses exactly the same formula (app/src/scoring.js) on the cards of app/data/.
"""
import numpy as np
import pandas as pd


def _class_key(v) -> str:
    """0.5 → '0.5', 3.0 → '3', 10 → '10' (keys of the class matrices, the same as in the web app)."""
    return format(float(v), "g")


def note_numeric(spec: dict, target: float, earth: pd.Series) -> pd.Series:
    """Note (0–1) of a numeric variable: class matrix, soft note or old linear note."""
    if spec.get("matrix"):
        matrix = {_class_key(k): {_class_key(c): float(v) for c, v in r.items()} for k, r in spec["matrix"].items()}
        row = matrix.get(_class_key(target), {})
        out = earth.map(lambda e: np.nan if pd.isna(e)
                        else row.get(_class_key(e), 1.0 if _class_key(e) == _class_key(target) else 0.0))
        return out.astype(float)
    d = (earth - target).abs()
    if spec.get("half_diff"):
        return 1.0 / (1.0 + (d / spec["half_diff"]) ** 2)
    return (1.0 - d / spec["tolerance"]).clip(lower=0.0)


def variable_scores(target: dict, cells: pd.DataFrame, variables: dict) -> pd.DataFrame:
    """Note (0–1) of each variable for each Earth cell.

    target:    card of the target, e.g. {"slope_deg": 8, "rock_abundance_pct": 15, ...}
    cells:     one row per Earth cell, one column per variable
    variables: the "variables" block of configs/variables.yaml
    """
    scores = {}
    for name, spec in variables.items():
        if name not in cells.columns:
            continue
        t = target.get(name)
        if t is None or (isinstance(t, float) and np.isnan(t)):
            continue  # the target does not have this variable (e.g. dust on the Moon)

        col = cells[name]
        if spec.get("type", "numeric") == "numeric":
            s = note_numeric(spec, t, col)
        else:
            row = (spec.get("matrix") or {}).get(t, {})
            s = col.map(lambda c: row.get(c, 1.0 if c == t else 0.0)).astype(float)
            s = s.where(col.notna())
        scores[name] = s
    return pd.DataFrame(scores, index=cells.index)


def analog_index(scores: pd.DataFrame, weights: dict, dimensions: dict | None = None) -> pd.Series:
    """Analog index (0–100).

    dimensions: {variable: dimension} (from variables.yaml). Without it, each variable is its own
    dimension and the index is the weighted mean of the available notes (old formula).
    """
    w = pd.Series({k: v for k, v in weights.items() if k in scores.columns and v > 0}, dtype=float)
    if w.empty:
        return pd.Series(np.nan, index=scores.index)
    dims = {k: (dimensions or {}).get(k) or k for k in w.index}
    num = pd.Series(0.0, index=scores.index)
    den = pd.Series(0.0, index=scores.index)
    measured = pd.Series(False, index=scores.index)
    for dim in dict.fromkeys(dims.values()):
        names = [k for k in w.index if dims[k] == dim]
        s = scores[names]
        dw = w[names]
        d_num = (s.fillna(0.0) * dw).sum(axis=1)
        d_den = (s.notna() * dw).sum(axis=1)
        has = d_den > 0
        W = float(dw.max())                        # weight of the dimension = its largest weight
        num += np.where(has, W * d_num / d_den.where(has, 1.0), 0.0)
        # with dimensions, a dimension with NO data at all in that cell counts 0 (what was not
        # measured is not rewarded); without dimensions (old formula), a missing variable does not count
        den += W if dimensions else np.where(has, W, 0.0)
        measured |= has
    idx = 100.0 * num / den.replace(0.0, np.nan)
    return idx.where(measured)                     # no comparable data at all: NaN


def dimensions_of(variables: dict) -> dict:
    """{variable: dimension} from configs/variables.yaml (only those that have one)."""
    return {k: v["dimension"] for k, v in variables.items() if v.get("dimension")}


def rank(target: dict, cells: pd.DataFrame, variables: dict, weights: dict, top: int = 10) -> pd.DataFrame:
    """The `top` most similar cells, with their index and the note of each variable."""
    scores = variable_scores(target, cells, variables)
    out = cells.join(scores.add_prefix("score_"))
    out["index"] = analog_index(scores, weights, dimensions_of(variables))
    return out.sort_values("index", ascending=False).head(top)
