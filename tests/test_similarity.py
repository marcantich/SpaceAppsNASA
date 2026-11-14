"""Pruebas del motor con el ejemplo de juguete de docs/01_como_funciona.md.

Objetivo en Marte: pendiente 8°, rocas 15 %, temperatura −50 °C (números inventados).
Tolerancias: 10°, 20 %, 60 °C.

            pendiente  rocas  temperatura   │  ruedas  térmico  todo
  A Sáhara      2°       2 %     +25 °C     │   37.5     0.0    25.0
  B Islandia    7°      20 %       0 °C     │   82.5    16.7    60.6
  C Antártida  10°      10 %     −20 °C     │   77.5    50.0    68.3
"""
import numpy as np
import pandas as pd
import pytest

from analogs.similarity import analog_index, rank, variable_scores

VARIABLES = {
    "slope": {"type": "numeric", "tolerance": 10},
    "rocks": {"type": "numeric", "tolerance": 20},
    "temp": {"type": "numeric", "tolerance": 60},
}
TARGET = {"slope": 8, "rocks": 15, "temp": -50}
CELLS = pd.DataFrame({"slope": [2, 7, 10], "rocks": [2, 20, 10], "temp": [25, 0, -20]},
                     index=["A_sahara", "B_islandia", "C_antartida"])


def test_notas_por_variable():
    s = variable_scores(TARGET, CELLS, VARIABLES)
    assert s.loc["A_sahara"].tolist() == pytest.approx([0.40, 0.35, 0.0])
    assert s.loc["B_islandia"].tolist() == pytest.approx([0.90, 0.75, 1 / 6])
    assert s.loc["C_antartida"].tolist() == pytest.approx([0.80, 0.75, 0.50])


@pytest.mark.parametrize("weights, expected", [
    ({"slope": 1, "rocks": 1}, [37.5, 82.5, 77.5]),             # ruedas → gana Islandia
    ({"temp": 1}, [0.0, 100 / 6, 50.0]),                        # térmico → gana la Antártida
    ({"slope": 1, "rocks": 1, "temp": 1}, [25.0, 60.556, 68.333]),  # todo → gana la Antártida
])
def test_indice_segun_lo_que_quieres_probar(weights, expected):
    idx = analog_index(variable_scores(TARGET, CELLS, VARIABLES), weights)
    assert idx.tolist() == pytest.approx(expected, abs=1e-3)


def test_ranking_ruedas():
    top = rank(TARGET, CELLS, VARIABLES, {"slope": 1, "rocks": 1}, top=3)
    assert top.index.tolist() == ["B_islandia", "C_antartida", "A_sahara"]


def test_dato_que_falta_no_cuenta():
    """Si a una celda le falta una variable, los pesos se reparten entre las que tiene."""
    cells = CELLS.copy()
    cells.loc["B_islandia", "rocks"] = np.nan
    idx = analog_index(variable_scores(TARGET, cells, VARIABLES), {"slope": 1, "rocks": 1})
    assert idx["B_islandia"] == pytest.approx(90.0)   # solo cuenta la pendiente (0.90)


def test_variable_que_no_existe_en_el_objetivo():
    """Ej.: polvo en la Luna. Esa variable se ignora, no da error."""
    s = variable_scores({"slope": 8}, CELLS, VARIABLES)
    assert list(s.columns) == ["slope"]


def test_categorica():
    variables = {"rock": {"type": "categorical", "matrix": {"basalt": {"anorthosite": 0.3}}}}
    cells = pd.DataFrame({"rock": ["basalt", "anorthosite", "sedimentary", None]})
    s = variable_scores({"rock": "basalt"}, cells, variables)["rock"]
    assert s.iloc[:3].tolist() == [1.0, 0.3, 0.0]
    assert np.isnan(s.iloc[3])


# --- Nota suave, matriz de clases y dimensiones (configs/variables.yaml) ---------------------------

def test_nota_suave_vale_medio_en_half_diff_y_nunca_cero():
    variables = {"t": {"type": "numeric", "half_diff": 15}}
    cells = pd.DataFrame({"t": [210, 225, 240, 300]})
    s = variable_scores({"t": 210}, cells, variables)["t"]
    assert s.tolist() == pytest.approx([1.0, 0.5, 0.2, 1 / (1 + 36)])
    assert s.iloc[2] > s.iloc[3] > 0          # lo lejano sigue ordenado (más cerca = mejor)


def test_matriz_de_clases_de_hielo():
    m = {0.5: {0.5: 1.0, 3: 0.5, 5: 0.25, 10: 0.0}, 10: {0.5: 0.0, 3: 0.1, 5: 0.3, 10: 1.0}}
    variables = {"ice": {"type": "numeric", "matrix": m}}
    cells = pd.DataFrame({"ice": [0.5, 3.0, 5.0, 10.0, np.nan]})
    s = variable_scores({"ice": 0.5}, cells, variables)["ice"]
    assert s.iloc[:4].tolist() == [1.0, 0.5, 0.25, 0.0]
    assert np.isnan(s.iloc[4])


def test_dimensiones_tres_temperaturas_cuentan_como_una():
    scores = pd.DataFrame({"slope": [1.0], "t1": [0.0], "t2": [0.0], "t3": [0.0]})
    w = {"slope": 1, "t1": 1, "t2": 1, "t3": 1}
    assert analog_index(scores, w).iloc[0] == pytest.approx(25.0)          # sin dimensiones
    dims = {"slope": "terrain", "t1": "thermal", "t2": "thermal", "t3": "thermal"}
    assert analog_index(scores, w, dims).iloc[0] == pytest.approx(50.0)    # terreno 1 · térmica 0


def test_peso_de_la_dimension_es_su_mayor_peso():
    scores = pd.DataFrame({"sun": [1.0], "tm": [0.5], "tx": [0.0]})
    w = {"sun": 0.8, "tm": 1.0, "tx": 0.6}
    dims = {"sun": "sky", "tm": "thermal", "tx": "thermal"}
    thermal = (1.0 * 0.5 + 0.6 * 0.0) / 1.6
    assert analog_index(scores, w, dims).iloc[0] == pytest.approx(100 * (0.8 * 1.0 + 1.0 * thermal) / 1.8)
