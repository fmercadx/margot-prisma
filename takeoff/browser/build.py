#!/usr/bin/env python3
"""Assemble the click screen as a static site.

    python takeoff/browser/build.py --out dist/takeoff

Produces a directory any static host can serve, GitHub Pages included:

    index.html  app.js  worker.js
    pdfjs/         PDF.js, which draws the sheets, with its fonts and decoders
    pyodide/       CPython in WebAssembly, plus numpy, cryptography and
                   charset-normalizer wheels from the Pyodide distribution
    takeoff.zip    pdfminer.six, pdfplumber, openpyxl and the takeoff modules,
                   unpacked into the virtual filesystem at start

Everything is served from the page's own origin, as with the credit analyzer:
contractors' bid sets are confidential and copyrighted, and "the drawing never
leaves your computer" is only true if nothing is fetched from anywhere else.

Build inputs:
  node_modules/pyodide      the runtime (a devDependency; `npm ci` fetches it)
  node_modules/pdfjs-dist   PDF.js (likewise)
  Pyodide package wheels    numpy, cryptography, cffi, ... are not in the npm
                            package. Found in --cache, or downloaded once from
                            the Pyodide CDN and checked against the sha256 in
                            pyodide-lock.json.
  pure-Python wheels        pinned below; found in --cache or downloaded by pip.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
TAKEOFF = HERE.parent
REPO = TAKEOFF.parent

PAGE = ["index.html", "app.js", "worker.js"]
MODULES = [TAKEOFF / "drawings.py", TAKEOFF / "match.py", TAKEOFF / "report.py", HERE / "engine.py"]

# Loaded by worker.js with pyodide.loadPackage; their dependencies come along.
PYODIDE_PACKAGES = ["numpy", "cryptography", "charset-normalizer"]
PYODIDE_CORE = ["pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"]

# Pure-Python wheels unpacked into takeoff.zip. pdfplumber's Pillow and
# pypdfium2 are only used to render images, which the page does with PDF.js.
WHEELS = ["pdfminer.six==20260107", "pdfplumber==0.11.10", "openpyxl==3.1.5", "et-xmlfile==2.0.0"]

# The legacy build carries fallbacks for browsers a year or two old; the modern
# one needs features (Map.getOrInsertComputed) only the newest have, and an
# estimator's office machine is not always up to date.
PDFJS_FILES = ["legacy/build/pdf.min.mjs", "legacy/build/pdf.worker.min.mjs"]
PDFJS_DIRS = ["cmaps", "standard_fonts", "wasm", "iccs"]


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def closure(lock: dict, names: list[str]) -> list[str]:
    seen, stack = [], list(names)
    while stack:
        n = stack.pop()
        if n in seen:
            continue
        if n not in lock["packages"]:
            sys.exit(f"build.py: {n} is not in pyodide-lock.json")
        seen.append(n)
        stack += lock["packages"][n].get("depends", [])
    return seen


def pyodide_packages(pyodide_dir: Path, cache: Path, out: Path) -> None:
    lock = json.loads((pyodide_dir / "pyodide-lock.json").read_text())
    version = json.loads((pyodide_dir / "package.json").read_text())["version"]
    for name in closure(lock, PYODIDE_PACKAGES):
        entry = lock["packages"][name]
        fname, want = entry["file_name"], entry["sha256"]
        src = pyodide_dir / fname
        if not src.exists():
            src = cache / fname
            if not src.exists() or sha256(src) != want:
                url = f"https://cdn.jsdelivr.net/pyodide/v{version}/full/{fname}"
                print(f"  downloading {fname}")
                cache.mkdir(parents=True, exist_ok=True)
                with urllib.request.urlopen(url, timeout=120) as r, open(src, "wb") as f:
                    shutil.copyfileobj(r, f)
        got = sha256(src)
        if got != want:
            sys.exit(f"build.py: {fname} sha256 {got} does not match pyodide-lock.json ({want})")
        shutil.copy2(src, out / fname)


def pure_wheels(cache: Path) -> list[Path]:
    cache.mkdir(parents=True, exist_ok=True)
    found = []
    for spec in WHEELS:
        name, version = spec.split("==")
        stem = name.replace("-", "_").replace(".", "_").lower()
        hits = [w for w in cache.glob("*.whl")
                if w.name.lower().replace(".", "_").startswith(f"{stem}-{version}".replace(".", "_"))]
        if not hits:
            subprocess.run([sys.executable, "-m", "pip", "download", spec, "--no-deps", "--only-binary",
                            ":all:", "-d", str(cache), "-q"], check=True)
            hits = [w for w in cache.glob("*.whl")
                    if w.name.lower().replace(".", "_").startswith(f"{stem}-{version}".replace(".", "_"))]
        if not hits:
            sys.exit(f"build.py: no wheel for {spec}")
        found.append(hits[0])
    return found


def bundle(wheels: list[Path], out: Path) -> None:
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for whl in wheels:
            with zipfile.ZipFile(whl) as w:
                for info in w.infolist():
                    if ".dist-info/" in info.filename or info.filename.endswith(".pyc"):
                        continue
                    z.writestr(info.filename, w.read(info.filename))
        for m in MODULES:
            z.write(m, m.name)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default="dist/takeoff")
    ap.add_argument("--pyodide-dir", default=str(REPO / "node_modules" / "pyodide"))
    ap.add_argument("--pdfjs-dir", default=str(REPO / "node_modules" / "pdfjs-dist"))
    ap.add_argument("--cache", default=str(HERE / ".cache"), help="downloaded wheels, reused between builds")
    a = ap.parse_args(argv)

    out, pyodide_dir, pdfjs_dir, cache = Path(a.out), Path(a.pyodide_dir), Path(a.pdfjs_dir), Path(a.cache)
    for d, what in ((pyodide_dir, "pyodide"), (pdfjs_dir, "pdfjs-dist")):
        if not d.exists():
            sys.exit(f"build.py: {d} missing — run `npm ci` at the repo root ({what})")
    if out.exists():
        shutil.rmtree(out)
    (out / "pyodide").mkdir(parents=True)
    (out / "pdfjs").mkdir()

    for f in PAGE:
        shutil.copy2(HERE / f, out / f)
    for f in PYODIDE_CORE:
        shutil.copy2(pyodide_dir / f, out / "pyodide" / f)
    pyodide_packages(pyodide_dir, cache, out / "pyodide")
    for f in PDFJS_FILES:
        shutil.copy2(pdfjs_dir / f, out / "pdfjs" / Path(f).name)
    for d in PDFJS_DIRS:
        if (pdfjs_dir / d).exists():
            shutil.copytree(pdfjs_dir / d, out / "pdfjs" / d)
    bundle(pure_wheels(cache), out / "takeoff.zip")

    size = sum(p.stat().st_size for p in out.rglob("*") if p.is_file())
    print(f"built {out} ({size / 1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
