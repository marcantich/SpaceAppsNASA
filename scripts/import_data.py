"""Copies the data from a USB STICK (zip or folder) to the right place on this computer.

    .venv\\Scripts\\python.exe scripts\\import_data.py E:\\data.zip --dry-run   # only shows what it would do
    .venv\\Scripts\\python.exe scripts\\import_data.py E:\\data.zip
    .venv\\Scripts\\python.exe scripts\\import_data.py E:\\folder_with_zips      # every .zip in the folder
    .venv\\Scripts\\python.exe scripts\\import_data.py E:\\folder_without_zips   # copies the folder as it is

Destination: <DATA>/raw/<moon|mars|earth>/<dataset>/…   (DATA: see src/analogs/paths.py; outside git and OneDrive)

How it decides where each file goes (from the path inside the zip or folder):
  1. If the path contains a folder moon / mars / earth (or luna / marte / tierra) → what follows is
     copied as it is inside raw/<body>/. It works with zips that start with raw/, data/raw/, etc.
     (it is the format of the zips of scripts/pack_data.py: mars/mola_megdr_16ppd/…)
  2. If not, but it contains a known dataset folder (e.g. lola_ldem64, mola_megdr_16ppd) →
     raw/<its body>/<dataset>/…
  3. If not, it goes to raw/_sin_clasificar/ ("unclassified") and a warning is shown.
Files that already exist with the same size are not copied again (it can be rerun).
"""
import argparse
import shutil
import sys
import zipfile
from pathlib import Path, PurePosixPath

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from analogs.catalog import BODY_ALIASES, known_folders  # noqa: E402
from analogs.paths import DATA, RAW  # noqa: E402

DATASET_BODY = known_folders()            # folder → body, from the single catalogue (src/analogs/catalog.py)
SKIP = {"__MACOSX", ".DS_Store", "Thumbs.db", "desktop.ini"}


def destination(rel: PurePosixPath) -> tuple[str, Path]:
    parts = [p for p in rel.parts if p not in ("", ".")]
    if parts == ["LEEME.md"]:
        return "tables", DATA / "LEEME.md"
    for k, p in enumerate(parts[:-1]):              # tables already processed (pack_data.py tables)
        if p.lower() in ("processed", "interim"):
            return "tables", DATA / p.lower() / Path(*parts[k + 1:])
    for k, p in enumerate(parts[:-1]):
        if p.lower() in BODY_ALIASES:
            body = BODY_ALIASES[p.lower()]
            return body, RAW / body / Path(*parts[k + 1:])
    for k, p in enumerate(parts[:-1]):
        if p.lower() in DATASET_BODY:
            body = DATASET_BODY[p.lower()]
            return body, RAW / body / Path(*parts[k:])
    return "_sin_clasificar", RAW / "_sin_clasificar" / Path(*parts)


def entries(src: Path):
    """(relative path, size, function that opens the file) of each file of the zip or folder."""
    if src.is_file() and zipfile.is_zipfile(src):
        z = zipfile.ZipFile(src)
        for info in z.infolist():
            if info.is_dir() or any(s in info.filename for s in SKIP):
                continue
            yield PurePosixPath(info.filename), info.file_size, (lambda i=info: z.open(i))
    elif src.is_dir() and list(src.glob("*.zip")):          # folder with zips (e.g. those of pack_data.py)
        for zp in sorted(src.glob("*.zip")):
            print(f"  · {zp.name}")
            yield from entries(zp)
    elif src.is_dir():
        for f in src.rglob("*"):
            if f.is_file() and f.name not in SKIP:
                yield PurePosixPath(f.relative_to(src).as_posix()), f.stat().st_size, (lambda f=f: f.open("rb"))
    else:
        raise SystemExit(f"{src} is neither a .zip nor a folder. (For .7z or .rar: extract it first and pass the folder)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("source", type=Path, help="zip or folder of the USB stick")
    ap.add_argument("--dry-run", action="store_true", help="only show what it would copy")
    args = ap.parse_args()

    print(f"Destination: {RAW}\n")
    stats: dict[str, list[int]] = {}
    datasets: dict[str, set] = {}
    for rel, size, opener in entries(args.source):
        body, dest = destination(rel)
        st = stats.setdefault(body, [0, 0, 0])
        st[0] += 1
        st[1] += size
        rel_dest = dest.relative_to(DATA if body == "tables" else RAW / body)
        if len(rel_dest.parts) > 1:
            datasets.setdefault(body, set()).add(rel_dest.parts[0])
        if dest.exists() and dest.stat().st_size == size:
            st[2] += 1
            continue
        if not args.dry_run:
            dest.parent.mkdir(parents=True, exist_ok=True)
            with opener() as fin, open(dest, "wb") as fout:
                shutil.copyfileobj(fin, fout, 16 << 20)

    print(f"{'body':16s} {'files':>9s} {'GB':>8s} {'already there':>13s}   folders")
    for body, (n, size, skipped) in sorted(stats.items()):
        print(f"{body:16s} {n:9,} {size / 1e9:8.2f} {skipped:13,}   {', '.join(sorted(datasets.get(body, [])))}")
    if "_sin_clasificar" in stats:
        print(f"\n⚠️  There are unclassified files in {RAW / '_sin_clasificar'}: move them by hand to raw/<body>/<dataset>/")
    print("\n(dry-run: nothing was copied)" if args.dry_run
          else "\nDone. Check with: .venv\\Scripts\\python.exe scripts\\inventory.py --readme")


if __name__ == "__main__":
    main()
