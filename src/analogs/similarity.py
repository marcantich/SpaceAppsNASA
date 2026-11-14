"""MOTOR: ¿cuánto se parece cada sitio de la Tierra a un sitio objetivo de la Luna o Marte?

Tres pasos (el ejemplo completo con números está en tests/test_similarity.py):

1. Nota por variable, de 0 a 1 (configs/variables.yaml):
       con half_diff (nota suave):  nota = 1 / (1 + (|x_objetivo − x_tierra| / half_diff)²)
                                    → 0,5 con una diferencia de half_diff; nunca llega a 0, así que
                                      sigue ordenando aunque la Tierra no alcance el valor objetivo
       con matrix (clases):         nota = matrix[objetivo][tierra]   (p. ej. clases de hielo)
       solo tolerance (antigua):    nota = max(0, 1 − |Δ| / tolerance)
       categórica:                  nota = matrix[objetivo][tierra]   (sin matriz: igual = 1, distinto = 0)
   Si falta el dato en la Tierra o en el objetivo, esa nota queda vacía (NaN).

2. Nota por DIMENSIÓN (terrain, thermal, water, sky…): media ponderada de las notas de sus
   variables disponibles. Así tres temperaturas cuentan como una dimensión, no como tres votos.
   Una dimensión sin NINGÚN dato en esa celda cuenta 0 (no se premia lo que no se ha medido).

3. Índice de 0 a 100 = media ponderada de las dimensiones disponibles. Peso de cada dimensión =
   el mayor peso que la prueba (configs/pruebas.yaml) da a sus variables (1 si no hay prueba).
   Sin dimensiones (variables sin `dimension`), cada variable es su propia dimensión: la fórmula
   antigua, media ponderada de las notas.

(La web añade un 4.º paso solo para ordenar: mezcla el índice de la celda con el de sus 6 vecinas,
`scoring.area_weight`, para premiar zonas homogéneas; ver app/src/scoring.js.)

El índice es un ÍNDICE DE ANALOGÍA, no una probabilidad (no está calibrado contra nada).
La app usa exactamente la misma fórmula (app/src/scoring.js) sobre las fichas de app/data/.
"""
import numpy as np
import pandas as pd


def _class_key(v) -> str:
    """0.5 → '0.5', 3.0 → '3', 10 → '10' (claves de las matrices de clases, igual que en la web)."""
    return format(float(v), "g")


def note_numeric(spec: dict, target: float, earth: pd.Series) -> pd.Series:
    """Nota (0–1) de una variable numérica: matriz de clases, nota suave o lineal antigua."""
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
    """Nota (0–1) de cada variable para cada celda de la Tierra.

    target:    ficha del objetivo, p. ej. {"slope_deg": 8, "rock_abundance_pct": 15, ...}
    cells:     una fila por celda de la Tierra, una columna por variable
    variables: el bloque "variables" de configs/variables.yaml
    """
    scores = {}
    for name, spec in variables.items():
        if name not in cells.columns:
            continue
        t = target.get(name)
        if t is None or (isinstance(t, float) and np.isnan(t)):
            continue  # el objetivo no tiene esta variable (p. ej. polvo en la Luna)

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
    """Índice de analogía (0–100).

    dimensions: {variable: dimensión} (de variables.yaml). Sin él, cada variable es su propia
    dimensión y el índice es la media ponderada de las notas disponibles (fórmula antigua).
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
        W = float(dw.max())                        # peso de la dimensión = su mayor peso
        num += np.where(has, W * d_num / d_den.where(has, 1.0), 0.0)
        # con dimensiones, una dimensión SIN NINGÚN dato en esa celda cuenta 0 (no se premia lo que no
        # se ha medido); sin dimensiones (fórmula antigua), la variable que falta no cuenta
        den += W if dimensions else np.where(has, W, 0.0)
        measured |= has
    idx = 100.0 * num / den.replace(0.0, np.nan)
    return idx.where(measured)                     # sin ningún dato comparable: NaN


def dimensions_of(variables: dict) -> dict:
    """{variable: dimensión} de configs/variables.yaml (solo las que la tienen)."""
    return {k: v["dimension"] for k, v in variables.items() if v.get("dimension")}


def rank(target: dict, cells: pd.DataFrame, variables: dict, weights: dict, top: int = 10) -> pd.DataFrame:
    """Las `top` celdas más parecidas, con su índice y la nota de cada variable."""
    scores = variable_scores(target, cells, variables)
    out = cells.join(scores.add_prefix("score_"))
    out["index"] = analog_index(scores, weights, dimensions_of(variables))
    return out.sort_values("index", ascending=False).head(top)
