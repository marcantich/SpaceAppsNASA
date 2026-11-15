"""Makes the LIST of the data you have in a folder (to compare with a team mate).

    python scripts/list_data.py data/raw/moon --name marc

Writes data/raw/moon/LISTADO_marc.csv with: relative path, bytes and SHA-256 hash of each file.
That list DOES go to git (the data do not). If two people have the same file, the hash is identical.
It only uses the Python standard library.
"""
import argparse
import csv
import hashlib
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Windows consoles (cp1252)


def sha256(path: Path, chunk: int = 8 * 1024 * 1024) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while block := f.read(chunk):
            h.update(block)
    return h.hexdigest()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("folder", type=Path, help="folder to list")
    ap.add_argument("--name", "--nombre", dest="name", required=True, help="your name, for the file LISTADO_<name>.csv")
    args = ap.parse_args()

    files = sorted(p for p in args.folder.rglob("*")
                   if p.is_file() and not p.name.startswith(("LISTADO_", "MANIFEST", ".gitkeep"))
                   and not p.name.endswith(".part"))
    out = args.folder / f"LISTADO_{args.name}.csv"
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["ruta", "bytes", "sha256"])   # "ruta" = relative path (header kept: existing lists use it)
        for i, p in enumerate(files, 1):
            print(f"[{i}/{len(files)}] {p.relative_to(args.folder)}", flush=True)
            w.writerow([p.relative_to(args.folder).as_posix(), p.stat().st_size, sha256(p)])
    total = sum(p.stat().st_size for p in files) / 1e9
    print(f"\n{len(files)} files, {total:.2f} GB → {out}")


if __name__ == "__main__":
    main()
