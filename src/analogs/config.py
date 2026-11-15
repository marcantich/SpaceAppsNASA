"""Reads configs/variables.yaml and configs/pruebas.yaml."""
import yaml

from .paths import CONFIGS


def load_variables() -> dict:
    """Returns the whole content of variables.yaml (variables, operability, bodies)."""
    with open(CONFIGS / "variables.yaml", encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_pruebas() -> dict:
    """Returns {test_id: {label, weights, test_validity}}."""
    with open(CONFIGS / "pruebas.yaml", encoding="utf-8") as f:
        return yaml.safe_load(f)["pruebas"]
