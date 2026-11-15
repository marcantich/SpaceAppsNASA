"""Project paths. Import them from here instead of writing paths by hand.

Heavy data live OUTSIDE the repository (they do not fit in git and OneDrive locks them).
The data folder (DATA) is looked for in this order:
  1. environment variable ANALOGS_DATA_DIR
  2. (Windows) the same variable saved with `setx`, even if the terminal was opened before
  3. ~/SpaceAppsData   (C:\\Users\\<you>\\SpaceAppsData): just copy the folder there
  4. <repo>/data       (the old location, kept for compatibility)
Inside DATA, always: raw/<earth|moon|mars>/<folder>/, interim/, processed/, LEEME.md
"""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# --- Small inputs (in git) ---
CATALOGS = ROOT / "data" / "catalogs"   # target sites (Moon / Mars) and known analogs
CONFIGS = ROOT / "configs"              # variables.yaml (what is compared) and pruebas.yaml (weights)

# --- Heavy data (NOT in git) ---
def _data_dir() -> Path:
    """ANALOGS_DATA_DIR of the process; if it is not set (terminal opened before defining it with
    setx), the Windows user variable is read straight from the registry."""
    value = os.environ.get("ANALOGS_DATA_DIR")
    if not value and os.name == "nt":
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as key:
                value = winreg.QueryValueEx(key, "ANALOGS_DATA_DIR")[0]
        except OSError:
            value = None
    if value:
        return Path(value)
    home = Path.home() / "SpaceAppsData"
    return home if home.is_dir() else ROOT / "data"


DATA = _data_dir()
RAW = DATA / "raw"              # step 1: as downloaded  (earth/, moon/, mars/)
INTERIM = DATA / "interim"      # step 2: cropped and resampled
PROCESSED = DATA / "processed"  # step 3: cards (one row per site or hexagon)

# --- Output ---
APP_DATA = ROOT / "app" / "data"    # step 4: the index the app reads
OUTPUTS = ROOT / "outputs"          # for people: figures, maps, validation
FIGURES = OUTPUTS / "figures"
MAPS = OUTPUTS / "maps"
VALIDATION = OUTPUTS / "validation"
