"""Tests of the engine with the toy example of docs/01_como_funciona.md.

Target on Mars: slope 8°, rocks 15 %, temperature −50 °C (made-up numbers).
Tolerances: 10°, 20 %, 60 °C.

               slope   rocks  temperature   │  wheels  thermal  all
  A Sahara       2°      2 %     +25 °C     │   37.5     0.0    25.0
  B Iceland      7°     20 %       0 °C     │   82.5    16.7    60.6
  C Antarctica  10°     10 %     −20 °C     │   77.5    50.0    68.3
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
                     index=["A_sahara", "B_iceland", "C_antarctica"])


def test_notes_per_variable():
    s = variable_scores(TARGET, CELLS, VARIABLES)
    assert s.loc["A_sahara"].tolist() == pytest.approx([0.40, 0.35, 0.0])
    assert s.loc["B_iceland"].tolist() == pytest.approx([0.90, 0.75, 1 / 6])
    assert s.loc["C_antarctica"].tolist() == pytest.approx([0.80, 0.75, 0.50])


@pytest.mark.parametrize("weights, expected", [
    ({"slope": 1, "rocks": 1}, [37.5, 82.5, 77.5]),             # wheels → Iceland wins
    ({"temp": 1}, [0.0, 100 / 6, 50.0]),                        # thermal → Antarctica wins
    ({"slope": 1, "rocks": 1, "temp": 1}, [25.0, 60.556, 68.333]),  # all → Antarctica wins
])
def test_index_depends_on_what_you_want_to_test(weights, expected):
    idx = analog_index(variable_scores(TARGET, CELLS, VARIABLES), weights)
    assert idx.tolist() == pytest.approx(expected, abs=1e-3)


def test_ranking_wheels():
    top = rank(TARGET, CELLS, VARIABLES, {"slope": 1, "rocks": 1}, top=3)
    assert top.index.tolist() == ["B_iceland", "C_antarctica", "A_sahara"]


def test_missing_value_does_not_count():
    """If a cell lacks a variable, the weights are shared among the ones it has."""
    cells = CELLS.copy()
    cells.loc["B_iceland", "rocks"] = np.nan
    idx = analog_index(variable_scores(TARGET, cells, VARIABLES), {"slope": 1, "rocks": 1})
    assert idx["B_iceland"] == pytest.approx(90.0)   # only the slope counts (0.90)


def test_variable_missing_on_the_target():
    """E.g. dust on the Moon. That variable is ignored, it does not raise an error."""
    s = variable_scores({"slope": 8}, CELLS, VARIABLES)
    assert list(s.columns) == ["slope"]


def test_categorical():
    variables = {"rock": {"type": "categorical", "matrix": {"basalt": {"anorthosite": 0.3}}}}
    cells = pd.DataFrame({"rock": ["basalt", "anorthosite", "sedimentary", None]})
    s = variable_scores({"rock": "basalt"}, cells, variables)["rock"]
    assert s.iloc[:3].tolist() == [1.0, 0.3, 0.0]
    assert np.isnan(s.iloc[3])


# --- Soft note, class matrix and dimensions (configs/variables.yaml) -------------------------------

def test_soft_note_is_half_at_half_diff_and_never_zero():
    variables = {"t": {"type": "numeric", "half_diff": 15}}
    cells = pd.DataFrame({"t": [210, 225, 240, 300]})
    s = variable_scores({"t": 210}, cells, variables)["t"]
    assert s.tolist() == pytest.approx([1.0, 0.5, 0.2, 1 / (1 + 36)])
    assert s.iloc[2] > s.iloc[3] > 0          # far values are still ranked (closer = better)


def test_ice_class_matrix():
    m = {0.5: {0.5: 1.0, 3: 0.5, 5: 0.25, 10: 0.0}, 10: {0.5: 0.0, 3: 0.1, 5: 0.3, 10: 1.0}}
    variables = {"ice": {"type": "numeric", "matrix": m}}
    cells = pd.DataFrame({"ice": [0.5, 3.0, 5.0, 10.0, np.nan]})
    s = variable_scores({"ice": 0.5}, cells, variables)["ice"]
    assert s.iloc[:4].tolist() == [1.0, 0.5, 0.25, 0.0]
    assert np.isnan(s.iloc[4])


def test_dimensions_three_temperatures_count_as_one():
    scores = pd.DataFrame({"slope": [1.0], "t1": [0.0], "t2": [0.0], "t3": [0.0]})
    w = {"slope": 1, "t1": 1, "t2": 1, "t3": 1}
    assert analog_index(scores, w).iloc[0] == pytest.approx(25.0)          # without dimensions
    dims = {"slope": "terrain", "t1": "thermal", "t2": "thermal", "t3": "thermal"}
    assert analog_index(scores, w, dims).iloc[0] == pytest.approx(50.0)    # terrain 1 · thermal 0


def test_dimension_weight_is_its_largest_weight():
    scores = pd.DataFrame({"sun": [1.0], "tm": [0.5], "tx": [0.0]})
    w = {"sun": 0.8, "tm": 1.0, "tx": 0.6}
    dims = {"sun": "sky", "tm": "thermal", "tx": "thermal"}
    thermal = (1.0 * 0.5 + 0.6 * 0.0) / 1.6
    assert analog_index(scores, w, dims).iloc[0] == pytest.approx(100 * (0.8 * 1.0 + 1.0 * thermal) / 1.8)


def test_dimension_without_data_counts_zero():
    """With dimensions, a cell with no data at all in a dimension does not score higher for it."""
    scores = pd.DataFrame({"slope": [1.0, 1.0], "temp": [0.5, np.nan]})
    dims = {"slope": "terrain", "temp": "thermal"}
    idx = analog_index(scores, {"slope": 1, "temp": 1}, dims)
    assert idx.tolist() == pytest.approx([75.0, 50.0])    # the 2nd has no thermal: it counts 0, not 100
