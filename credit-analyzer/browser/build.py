#!/usr/bin/env python3
"""Assemble the browser build.

    python credit-analyzer/browser/build.py --out dist/analyzer
    python credit-analyzer/browser/build.py --target mobile --out mobile/www

Produces a directory that can be served by any static host — GitHub Pages
included — with no server-side anything:

    index.html  app.js  shell.js
    pyodide/       CPython compiled to WebAssembly, plus the stdlib
    analyzer.zip   pypdf + the analyzer modules, unpacked into the VFS at boot

Everything is vendored on purpose. A page that reads consumer credit files
should not fetch its runtime from a third-party CDN, because that CDN then
learns who opens the tool and when. Same-origin only. In the mobile build the
same property is what lets the app work with the radio off, and is why the
store listing can honestly declare that it collects nothing.

Two targets, one analyzer. `shell.js` is the only file that differs: it is the
seam between the analyzer and whatever is hosting it, so `app.js` and every
Python module are byte-identical in both builds.

    web      shell-web.js     — blob downloads, no gate, nothing retained
    mobile   shell-native.js  — Files/share sheet, saved reports, licence gate

The Pyodide runtime comes from `node_modules/pyodide` (a devDependency, so
`npm ci` already fetched it) and pypdf from a wheel — either one found in
`--wheel-dir` or downloaded with pip. No other build inputs.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ANALYZER = HERE.parent
REPO = ANALYZER.parent
MOBILE = ANALYZER / "mobile"

# target -> (shell implementation, extra files copied alongside it)
TARGETS = {
    "web": (HERE / "shell-web.js", []),
    "mobile": (MOBILE / "shell-native.js", [MOBILE / "shell-native.css"]),
}

# The analyzer modules, imported unchanged. browser_api.py is the only glue.
MODULES = [
    "canonical.py",
    "parse_mismo.py",
    "parse_pdf.py",
    "rules.py",
    "report.py",
]

# What loadPyodide() actually reads. Copying the whole npm package would drag
# in 200KB of type definitions and two demo consoles for no reason.
PYODIDE_FILES = [
    "pyodide.mjs",
    "pyodide.asm.mjs",
    "pyodide.asm.wasm",
    "python_stdlib.zip",
    "pyodide-lock.json",
]


def die(msg: str) -> None:
    sys.exit(f"build.py: {msg}")


def find_pyodide(explicit: Path | None) -> Path:
    if explicit:
        if not (explicit / "pyodide.asm.wasm").exists():
            die(f"{explicit} does not look like a Pyodide distribution")
        return explicit
    candidate = REPO / "node_modules" / "pyodide"
    if not (candidate / "pyodide.asm.wasm").exists():
        die("node_modules/pyodide is missing — run `npm ci` first, "
            "or pass --pyodide-dir")
    return candidate


def find_pypdf_wheel(wheel_dir: Path) -> Path:
    wheel_dir.mkdir(parents=True, exist_ok=True)
    found = sorted(wheel_dir.glob("pypdf-*.whl"))
    if found:
        return found[-1]
    print("· downloading pypdf wheel")
    subprocess.run(
        [sys.executable, "-m", "pip", "download", "pypdf",
         "--no-deps", "--only-binary=:all:", "-q", "-d", str(wheel_dir)],
        check=True,
    )
    found = sorted(wheel_dir.glob("pypdf-*.whl"))
    if not found:
        die("pip download produced no pypdf wheel")
    return found[-1]


def build_bundle(dest: Path, wheel: Path) -> None:
    """analyzer.zip = pypdf's package tree + the analyzer modules.

    pypdf is pure Python with no dependencies, so unzipping the wheel is the
    whole install. That avoids micropip, which would otherwise reach out to
    PyPI from the user's browser at runtime — a network call this tool is
    supposed to not make.
    """
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as out:
        with zipfile.ZipFile(wheel) as whl:
            for name in whl.namelist():
                if name.endswith("/") or ".dist-info/" in name:
                    continue
                out.writestr(name, whl.read(name))

        for mod in MODULES:
            src = ANALYZER / mod
            if not src.exists():
                die(f"missing analyzer module {src}")
            out.write(src, mod)
        out.write(HERE / "browser_api.py", "browser_api.py")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(REPO / "dist" / "analyzer"),
                    help="output directory (default dist/analyzer)")
    ap.add_argument("--target", choices=sorted(TARGETS), default="web",
                    help="which host shell to bundle (default web)")
    ap.add_argument("--pyodide-dir", default=None,
                    help="Pyodide distribution (default node_modules/pyodide)")
    ap.add_argument("--wheel-dir", default=str(HERE / ".wheels"),
                    help="where to look for / cache the pypdf wheel")
    args = ap.parse_args(argv)

    shell_src, extras = TARGETS[args.target]
    if not shell_src.exists():
        die(f"missing shell for target {args.target}: {shell_src}")

    out = Path(args.out).resolve()
    pyo = find_pyodide(Path(args.pyodide_dir).resolve() if args.pyodide_dir else None)
    wheel = find_pypdf_wheel(Path(args.wheel_dir).resolve())

    if out.exists():
        shutil.rmtree(out)
    (out / "pyodide").mkdir(parents=True)

    for name in PYODIDE_FILES:
        src = pyo / name
        if not src.exists():
            die(f"Pyodide distribution is missing {name}")
        shutil.copy2(src, out / "pyodide" / name)

    shutil.copy2(HERE / "index.html", out / "index.html")
    shutil.copy2(HERE / "app.js", out / "app.js")
    # Always lands as shell.js — index.html loads one name, and which
    # implementation it got is a build-time fact rather than a runtime check.
    #
    # The mobile shell's deployment settings are prepended rather than kept in
    # a second file: one file to edit, one file to review before a store
    # build, and no way for the config and the shell to disagree about which
    # of them is authoritative.
    shell_js = shell_src.read_text()
    cfg_path = MOBILE / "app.config.json"
    if args.target == "mobile":
        if not cfg_path.exists():
            die(f"missing {cfg_path}")
        cfg = {k: v for k, v in json.loads(cfg_path.read_text()).items()
               if not k.startswith("_")}
        # Merged rather than assigned, so anything already set wins. In the
        # app nothing else can set it — every byte of content is local and
        # bundled — but it lets a test drive the shell against a stub.
        shell_js = (
            f"window.ANALYZER_CONFIG = Object.assign({json.dumps(cfg, indent=2)},"
            " window.ANALYZER_CONFIG || {});\n\n" + shell_js)
    (out / "shell.js").write_text(shell_js)
    for extra in extras:
        if not extra.exists():
            die(f"missing {extra}")
        shutil.copy2(extra, out / extra.name)
    build_bundle(out / "analyzer.zip", wheel)

    # Artifact-based Pages deploys skip Jekyll already, so this changes nothing
    # today. It is here so the directory stays correct if it is ever published
    # some other way — branch-based Pages does run Jekyll, and Jekyll silently
    # drops paths beginning with an underscore, which would break a future
    # Pyodide release that ships one.
    (out / ".nojekyll").write_text("")

    total = sum(p.stat().st_size for p in out.rglob("*") if p.is_file())
    print(f"· target       {args.target}  ({shell_src.name})")
    print(f"· pyodide      {pyo}")
    print(f"· pypdf        {wheel.name}")
    print(f"· built        {out}  ({total / 1024 / 1024:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
