# -*- coding: utf-8 -*-
"""Static-asset reachability check for the canvas page.

Do NOT boot server.py for this: its startup callbacks prune expired LAN snapshots
(deleting files under the data directory) and run update/connectivity probes,
which conflicts with "never touch user data". server.py mounts /static, /styles
and /scripts with starlette's StaticFiles over <root>/static etc, so this script
rebuilds those same mounts in a throwaway ASGI app and drives it in-process with
starlette's TestClient -- identical code path, zero side effects.

Asset URLs are scraped from the HTML itself, so new modules are covered
automatically by later phases instead of needing a hand-maintained list.
"""
from __future__ import annotations

import hashlib
import re
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.testclient import TestClient

ROOT = Path(__file__).resolve().parent.parent
PAGES = [
    ("smart-canvas.html", ROOT / "static" / "smart-canvas.html"),
]
# phase order requirement: modules must be parsed before the main canvas script
ORDER = ["canvas-utils.js", "canvas-state.js", "canvas-layout.js",
         "canvas-renderer.js", "canvas-interaction.js", "canvas-workflow.js",
         "canvas-assets.js", "canvas-generation.js", "canvas-media-editor.js",
         "canvas-collaboration.js", "smart-canvas.js"]
URL_RE = re.compile(r'(?:src|href)="((?:/static|/scripts|/styles)/[^"]+)"')


def build_app() -> FastAPI:
    app = FastAPI()
    app.mount("/static", StaticFiles(directory=str(ROOT / "static")), name="static")
    app.mount("/styles", StaticFiles(directory=str(ROOT / "styles")), name="styles")
    app.mount("/scripts", StaticFiles(directory=str(ROOT / "scripts")), name="scripts")
    return app


def disk_path(url: str) -> Path:
    bare = url.split("?", 1)[0].lstrip("/")
    return ROOT / bare


def main() -> int:
    client = TestClient(build_app())
    failures: list[str] = []

    for page_name, page_path in PAGES:
        print(f"=== {page_name} ===")
        if not page_path.exists():
            print(f"MISSING PAGE {page_path}")
            return 1
        html = page_path.read_text(encoding="utf-8")
        urls = []
        for u in URL_RE.findall(html):
            if u not in urls:
                urls.append(u)
        for url in urls:
            r = client.get(url)
            dp = disk_path(url)
            exists = dp.exists()
            size = dp.stat().st_size if exists else None
            same = exists and size == len(r.content)
            tag = "OK  " if (r.status_code == 200 and same) else "BAD "
            print(f"  {tag}{r.status_code} {url[:72]:72} bytes={len(r.content)}"
                  f"{'' if exists else ' [not on disk]'}{'' if same else ' [size mismatch]'}")
            if r.status_code != 200:
                failures.append(f"{url} -> HTTP {r.status_code}")
            elif not same:
                failures.append(f"{url} served {len(r.content)}B != disk {size}B")
            elif r.status_code == 200 and dp.suffix == ".js":
                served = hashlib.sha256(r.content).hexdigest()
                if served != hashlib.sha256(dp.read_bytes()).hexdigest():
                    failures.append(f"{url} content differs from disk")

        # load order of the canvas core scripts
        seq = re.findall(r'<script src="([^"]+)"', html)
        idx = {}
        for token in ORDER:
            idx[token] = next((i for i, u in enumerate(seq) if token in u), None)
        present = [(t, i) for t, i in idx.items() if i is not None]
        print(f"  script order: {present}")
        if len(present) == len(ORDER):
            ordered = [i for _, i in present]
            if ordered != sorted(ordered):
                failures.append(f"canvas core script order wrong: {present}")
            else:
                print("  " + " -> ".join(ORDER) + ": PASS")
        else:
            failures.append(f"a required canvas script tag is missing: "
                            f"{[t for t, i in idx.items() if i is None]}")

    print("\n=== canvas core cache-buster must be in sync ===")
    # A module can be re-fetched while the iframe still holds the old smart-canvas.js,
    # so all four canvas scripts must carry one token AND it must equal the frame
    # version the home page appends. Phase 2 shipped a stale iframe because of this.
    tokens = set()
    for src in re.findall(r'<script src="([^"]+)"', html):
        for token in ORDER:
            if token in src:
                m = re.search(r"[?&]v=([^\"&]+)", src)
                tokens.add(m.group(1) if m else None)
    frame_src = (ROOT / "scripts" / "home" / "managers" / "project-manager.js").read_text(
        encoding="utf-8")
    frame_m = re.search(r"const CANVAS_FRAME_VERSION = '([^']+)'", frame_src)
    frame_ver = frame_m.group(1) if frame_m else None
    print(f"  ?v= tokens across the {len(ORDER)} canvas scripts: {sorted(str(t) for t in tokens)}")
    print(f"  CANVAS_FRAME_VERSION               : {frame_ver}")
    if len(tokens) != 1 or None in tokens:
        failures.append(f"canvas scripts do not share one cache-buster: {tokens}")
    elif tokens != {frame_ver}:
        failures.append(f"script token {tokens} != CANVAS_FRAME_VERSION {frame_ver!r}")
    else:
        print(f"  all {len(ORDER)} scripts + frame version share {frame_ver}: PASS")

    print("\n=== directory listing must not be exposed ===")
    r = client.get("/static/canvas/js/modules/")
    print(f"  {r.status_code} /static/canvas/js/modules/ (expect 404)")
    if r.status_code == 200:
        failures.append("directory listing is exposed")

    print()
    if failures:
        print("=== FAILURES ===")
        for f in failures:
            print(" -", f)
        return 1
    print("ALL ASSET CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
