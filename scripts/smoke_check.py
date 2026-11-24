# -*- coding: utf-8 -*-
"""Deploy-side smoke: py_compile + node --check + optional /api/health."""
from __future__ import annotations

import py_compile
import re
import subprocess
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PY_FILES = [
    "server.py",
    "launcher.pyw",
    "runtime_core/app/auth_service.py",
    "runtime_core/main.py",
    "runtime_core/app/services/lan_storage_service.py",
]
JS_FILES = [
    "scripts/common/api-client.js",
    "scripts/common/local-assets-sync.js",
    "scripts/home/app.js",
    "scripts/home/managers/base-manager.js",
    "scripts/settings/settings-manager.js",
    "scripts/collaboration/collab-manager.js",
    "scripts/home/managers/project-manager.js",
    "static/common/js/theme.js",
    "static/common/js/i18n-core.js",
    "static/common/js/i18n.js",
    "static/common/js/i18n/common.js",
    "static/common/js/i18n/studio.js",
    "static/common/js/i18n/api-settings.js",
    "static/common/js/i18n/canvas.js",
    "static/common/js/i18n/smart-canvas.js",
    "static/canvas/js/smart-canvas.js",
    "static/canvas/js/modules/canvas-utils.js",
    "static/canvas/js/modules/canvas-state.js",
    "static/canvas/js/modules/canvas-layout.js",
    "static/canvas/js/modules/canvas-renderer.js",
    "static/canvas/js/modules/canvas-interaction.js",
    "static/canvas/js/modules/canvas-workflow.js",
    "static/canvas/js/modules/canvas-assets.js",
    "static/canvas/js/modules/canvas-generation.js",
    "static/canvas/js/modules/canvas-media-editor.js",
    "static/canvas/js/modules/canvas-collaboration.js",
    "static/canvas/js/canvas-trash.js",
    "static/canvas/js/canvas-list.js",
    "static/canvas/js/touch-mouse.js",
    "static/collaboration/js/lan-sync-adapter.js",
    "static/settings/js/auth.js",
]


def main() -> int:
    failed = 0
    print("=== py_compile ===")
    for rel in PY_FILES:
        p = ROOT / rel
        try:
            py_compile.compile(str(p), doraise=True)
            print("OK", rel)
        except Exception as e:
            failed += 1
            print("FAIL", rel, e)
    print("=== node --check ===")
    for rel in JS_FILES:
        p = ROOT / rel
        if not p.exists():
            failed += 1
            print("MISS", rel)
            continue
        r = subprocess.run(["node", "--check", str(p)], capture_output=True, text=True)
        if r.returncode == 0:
            print("OK", rel)
        else:
            failed += 1
            print("FAIL", rel, (r.stderr or "")[:200])
    print("=== canvas page script coverage ===")
    # The canvas page loads its modules through plain <script> tags; a new module can
    # easily end up in the HTML but missing from JS_FILES above, which would leave it
    # syntax-unchecked. Derive the required list from the page instead of trusting the
    # hand-maintained one.
    html = ROOT / "static" / "smart-canvas.html"
    if html.exists():
        srcs = re.findall(r'<script src="(/(?:static|scripts)/[^"]+)"', html.read_text(encoding="utf-8"))
        wanted = sorted({s.lstrip("/").split("?", 1)[0] for s in srcs})
        # third-party bundles are deliberately out of scope: `node --check` parses them as
        # CommonJS scripts and would reject valid ESM (three.module.js) or minified UMD.
        vendor = [w for w in wanted if w.startswith("static/vendor/")]
        first_party = [w for w in wanted if w not in vendor]
        missing = [w for w in first_party if w not in set(JS_FILES)]
        print(f"  {len(wanted)} scripts referenced by smart-canvas.html "
              f"({len(vendor)} vendor bundles skipped: {vendor or 'none'})")
        print(f"  first-party scripts not covered by node --check: {missing or 'none'}")
        if missing:
            failed += 1
    else:
        print("  MISS static/smart-canvas.html")
        failed += 1
    print("=== /api/health ===")
    try:
        with urllib.request.urlopen("http://127.0.0.1:8900/api/health", timeout=3) as resp:
            body = resp.read().decode("utf-8", "replace")
            print("OK", resp.status, body[:200])
    except Exception as e:
        print("SKIP/DOWN", type(e).__name__, e)
    print("DONE failed=", failed)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
