"""Which data are on THIS computer? Per body and dataset: files, GB, what is missing from the catalogue,
and the tables already processed (how many rows each one has).

    .venv\\Scripts\\python.exe scripts\\inventory.py            # shows it on screen
    .venv\\Scripts\\python.exe scripts\\inventory.py --readme   # and also writes <DATA>/LEEME.md

LEEME.md (the read-me of the data folder) is docs/08_data_folder_guide.md (a guide for people and for
Claude) + this inventory. The list of datasets comes from the single catalogue: src/analogs/catalog.py.
"""
import argparse
import datetime as dt
import sys
from pathlib import Path

import pandas as pd

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from analogs.catalog import DATASETS  # noqa: E402
from analogs.paths import DATA, INTERIM, PROCESSED, RAW  # noqa: E402

BODY_LABEL = {"earth": "🌍 Earth", "moon": "🌕 Moon", "mars": "🔴 Mars"}
TEMPLATE = ROOT / "docs" / "08_data_folder_guide.md"


def folder_stats(p: Path) -> tuple[int, int]:
    files = [f for f in p.rglob("*") if f.is_file() and not f.name.startswith("partial_")]
    return len(files), sum(f.stat().st_size for f in files)


def gb(b: int) -> str:
    return f"{b / 1e9:.2f}" if b >= 1e7 else f"{b / 1e6:.1f} MB"


def build() -> tuple[str, list[str]]:
    """(markdown text of the inventory, lines for the screen)."""
    md, screen = [], [f"Data folder: {DATA}", ""]
    md.append(f"Generated on {dt.datetime.now():%Y-%m-%d %H:%M} in `{DATA}`.\n")
    grand_n = grand_b = 0
    for body in ("earth", "moon", "mars"):
        rows = []
        known = {d.folder for d in DATASETS if d.body == body}
        on_disk = sorted(d.name for d in (RAW / body).iterdir() if d.is_dir()) if (RAW / body).exists() else []
        screen.append(f"=== raw/{body} ===")
        body_n = body_b = 0
        for d in [d for d in DATASETS if d.body == body]:
            p = RAW / body / d.folder
            n, b = folder_stats(p) if p.exists() else (0, 0)
            body_n += n
            body_b += b
            state = f"✅ {n} files, {gb(b)} GB" if n else "❌ missing"
            rows.append(f"| `{d.folder}` | {d.product} | {d.what} | {d.variables} | {d.resolution} | {d.time} | "
                        f"{d.reading} | {d.download} | {state} |")
            screen.append(f"   {d.folder:24s} {'✅' if n else '❌'} {n:5d} files {b / 1e9:7.2f} GB   {d.product}")
        for extra in sorted(set(on_disk) - known):
            n, b = folder_stats(RAW / body / extra)
            body_n += n
            body_b += b
            rows.append(f"| `{extra}` | (not in the catalogue) | | | | | | | ⚠️ {n} files, {gb(b)} GB |")
            screen.append(f"   {extra:24s} ⚠️ {n:5d} files {b / 1e9:7.2f} GB   (not in src/analogs/catalog.py)")
        grand_n += body_n
        grand_b += body_b
        screen.append(f"   {'TOTAL':24s}    {body_n:5d} files {body_b / 1e9:7.2f} GB\n")
        md.append(f"### {BODY_LABEL[body]}: {body_n} files, {body_b / 1e9:.2f} GB in `raw/{body}/`\n")
        md.append("| Folder | Product | What it is | Card variables | Resolution | Time | How to read it | Download | On this computer |")
        md.append("|---|---|---|---|---|---|---|---|---|")
        md += rows
        md.append("")
    screen.append(f"TOTAL raw: {grand_n:,} files, {grand_b / 1e9:.2f} GB\n")
    md.insert(1, f"**Total in `raw/`: {grand_n:,} files, {grand_b / 1e9:.2f} GB.**\n")

    md.append("### Processed tables\n")
    md.append("| File | Rows | Columns | Size | Columns it has |")
    md.append("|---|---|---|---|---|")
    screen.append("=== Processed tables (what the search tool and the app use) ===")
    for f in sorted(list(PROCESSED.glob("*.parquet")) + list(INTERIM.glob("*.parquet"))):
        df = pd.read_parquet(f)
        rel = f"{f.parent.name}/{f.name}"
        md.append(f"| `{rel}` | {len(df):,} | {df.shape[1]} | {f.stat().st_size / 1e6:.1f} MB | {', '.join(df.columns)} |")
        screen.append(f"   {rel:42s} {len(df):>10,} rows × {df.shape[1]:3d} col.  {f.stat().st_size / 1e6:7.1f} MB")
    for f in sorted(INTERIM.glob("*.npz")):
        rel = f"{f.parent.name}/{f.name}"
        md.append(f"| `{rel}` | (mesh) | | {f.stat().st_size / 1e6:.1f} MB | |")
        screen.append(f"   {rel:42s} {'(mesh)':>10s}                {f.stat().st_size / 1e6:7.1f} MB")
    return "\n".join(md), screen


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--readme", "--leeme", dest="readme", action="store_true", help="also write <DATA>/LEEME.md (the data folder's read-me)")
    args = ap.parse_args()
    md, screen = build()
    print("\n".join(screen))
    if args.readme:
        text = TEMPLATE.read_text(encoding="utf-8").replace("<!-- INVENTARIO -->", md)
        (DATA / "LEEME.md").write_text(text, encoding="utf-8")
        print(f"\nWritten: {DATA / 'LEEME.md'}")


if __name__ == "__main__":
    main()
