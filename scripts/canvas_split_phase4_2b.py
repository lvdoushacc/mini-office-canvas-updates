# -*- coding: utf-8 -*-
"""Canvas split phase 4.2b: move smartGroupThumbLayout into modules/canvas-layout.js.

smartGroupThumbLayout is the group thumbnail layout calculator. It is *not* group
membership resolution: it never touches `nodes`, `canvas`, connections or the DOM.
It delegates that part to two main-file functions (smartGroupImageRefs, which sorts
members by nodeRect, and smartGroupCompactMembers, which reads the member list) and
receives them as same-named injected parameters, so the body is copied verbatim.

Nothing else moves. smartGroupImageRefs / smartGroupCompactMembers / smartGroupMembers
/ smartGroupContainingNode / arrangeSmartGroupMembers / addNodeToSmartGroup /
absorbImageNodeIntoSmartGroup all stay in smart-canvas.js.

Callers keep working unchanged: the main file keeps `smartGroupThumbLayout(node)` with
the same single-argument signature, and imageLayout's injected dep of the same name now
resolves to that wrapper -- imageLayout itself is not edited, so the module calls back
out to the wrapper and the wrapper calls in. There is no recursion: the module's own
smartGroupThumbLayout never reads deps.smartGroupThumbLayout.

Two calls target functions that already live in canvas-layout.js (singleImageLayout,
groupImageGridLayout), so those get `deps` threaded through, exactly like phase 4.2a.

Usage:  python scripts/canvas_split_phase4_2b.py [--apply]
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAIN = ROOT / "static" / "canvas" / "js" / "smart-canvas.js"
LAYOUT = ROOT / "static" / "canvas" / "js" / "modules" / "canvas-layout.js"
PREVIEW_DIR = ROOT / "scripts"
APPLY = "--apply" in sys.argv

ORIG_SIG = "function smartGroupThumbLayout(node){"
MODULE_SIG = "function smartGroupThumbLayout(node, deps = needDeps('smartGroupThumbLayout')){"

# Names the body uses that are not already module-local. SMART_GROUP_DEFAULT_WIDTH /
# SMART_GROUP_DEFAULT_HEIGHT are deliberately absent: they appear in
# arrangeSmartGroupMembers, not in this function, and destructuring them here would be
# dead parameters.
PREAMBLE_NAMES = ["smartGroupImageRefs", "smartGroupCompactMembers", "mediaNodeDefaultScale",
                  "SMART_GROUP_MIN_WIDTH", "SMART_GROUP_MIN_HEIGHT",
                  "SMART_GROUP_MAX_VISIBLE_ROWS", "MEDIA_GROUP_THUMB_BASE"]
PREAMBLE = "const {" + ", ".join(PREAMBLE_NAMES) + "} = deps;"

# (old, new) applied to the moved body; each must occur exactly once
BODY_EDITS = [
    ("singleImageLayout(refs[0].item, {}, scale)",
     "singleImageLayout(refs[0].item, {}, scale, deps)"),
    ("groupImageGridLayout(count, Math.max(72, explicitW - outerPad), "
     "Math.max(56, explicitH - outerPad - summarySpace), 100000, 0, gap, maxVisibleRows)",
     "groupImageGridLayout(count, Math.max(72, explicitW - outerPad), "
     "Math.max(56, explicitH - outerPad - summarySpace), 100000, 0, gap, maxVisibleRows, deps)"),
]

# smartLayoutDeps() already supplies mediaNodeDefaultScale, the two SMART_GROUP_MIN_*
# consts, MEDIA_GROUP_THUMB_BASE and the transitive deps of singleImageLayout /
# groupImageGridLayout; these three names are genuinely new.
NEW_DEPS = "        smartGroupImageRefs, smartGroupCompactMembers, SMART_GROUP_MAX_VISIBLE_ROWS"
DEPS_ANCHOR = "        EMPTY_UPLOAD_NODE_WIDTH, EMPTY_UPLOAD_NODE_HEIGHT, MEDIA_GROUP_THUMB_BASE\n    };"

WRAPPER = ("function smartGroupThumbLayout(node){ return window.SmartCanvasLayout"
           ".smartGroupThumbLayout(node, smartLayoutDeps()); }")

SECTION = """
    // ===== 分组缩略图排布 =====
    // smartGroupThumbLayout 只算尺寸：成员是谁、怎么排、连线怎么改都留在主文件。
    // 它调用的 smartGroupImageRefs（按 nodeRect 给成员排序）与
    // smartGroupCompactMembers（读 nodes 取组内成员）按引用注入，
    // 单图与网格两个布局函数在本模块内，继续把 deps 传下去。
"""

# --- phase 4.2a carry-over, closed here because the strengthened gate A found it -----
# imageLayout uses MEDIA_GROUP_MAX_VISIBLE_ROWS in three places but never destructures
# it, so the identifier silently resolves to smart-canvas.js's global lexical const.
# The page works today because classic scripts share that lexical environment, but the
# module breaks with `ReferenceError` the moment that const moves out of the main file,
# and every grid-split node's size would go red at once. smartLayoutDeps() already
# supplies the identical value, so adding the name to the existing destructure changes
# no number -- and phase 4.2a's own gate B (11,425 imageLayout inputs) is the proof.
IMAGE_LAYOUT_DEPS_TAIL = "EMPTY_UPLOAD_NODE_HEIGHT, MEDIA_GROUP_THUMB_BASE} = deps;"
IMAGE_LAYOUT_DEPS_TAIL_NEW = ("EMPTY_UPLOAD_NODE_HEIGHT, MEDIA_GROUP_THUMB_BASE, "
                              "MEDIA_GROUP_MAX_VISIBLE_ROWS} = deps;")


def _write(path: Path, text: str) -> None:
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)


def _read(path: Path) -> str:
    with open(path, "r", encoding="utf-8", newline="") as fh:
        return fh.read()


def find_block_end(lines, start):
    first = lines[start].rstrip()
    if not first.endswith("{"):
        return start
    for j in range(start + 1, len(lines)):
        if lines[j] in ("}", "};"):
            return j
    raise SystemExit(f"FATAL: unterminated block at line {start + 1}")


def main() -> int:
    main_raw = _read(MAIN)
    layout_raw = _read(LAYOUT)
    assert "\r\n" not in main_raw and "\r\n" not in layout_raw, "unexpected CRLF"
    if re.search(r"function smartGroupThumbLayout\(node\)\{ return window", main_raw):
        raise SystemExit("FATAL: smartGroupThumbLayout already delegates to "
                         "window.SmartCanvasLayout - phase 4.2b has already been applied. "
                         "Restore the backup to redo it.")
    if "function smartGroupThumbLayout(" in layout_raw:
        raise SystemExit("FATAL: canvas-layout.js already defines smartGroupThumbLayout")

    lines = main_raw.split("\n")
    starts = [i for i, ln in enumerate(lines) if ln == ORIG_SIG]
    if len(starts) != 1:
        raise SystemExit(f"FATAL: {len(starts)} exact matches for {ORIG_SIG!r}")
    s = starts[0]
    e = find_block_end(lines, s)
    body = lines[s:e + 1]
    print(f"smartGroupThumbLayout: lines {s + 1}-{e + 1} ({e - s + 1} lines)")

    body = [MODULE_SIG, "    " + PREAMBLE] + body[1:]
    joined = "\n".join(body)
    for old, new in BODY_EDITS:
        n = joined.count(old)
        if n != 1:
            raise SystemExit(f"FATAL: body edit target {old!r} occurs {n} times")
        joined = joined.replace(old, new, 1)
    body = joined.split("\n")
    module_block = "\n".join(("    " + ln) if ln.strip() else "" for ln in body)

    # --- canvas-layout.js -------------------------------------------------
    marker = "\n    globalScope.SmartCanvasLayout = {"
    if marker not in layout_raw:
        raise SystemExit("FATAL: export block not found in canvas-layout.js")
    new_layout = layout_raw.replace(
        marker, "\n" + SECTION.rstrip("\n") + "\n" + module_block + "\n" + marker, 1)
    new_layout = new_layout.replace(
        "        imageLayout: imageLayout\n    };",
        "        imageLayout: imageLayout,\n"
        "        smartGroupThumbLayout: smartGroupThumbLayout\n    };")
    if "smartGroupThumbLayout: smartGroupThumbLayout" not in new_layout:
        raise SystemExit("FATAL: failed to add smartGroupThumbLayout to the exports")

    # close the 4.2a dependency leak described above (exactly one occurrence)
    if new_layout.count(IMAGE_LAYOUT_DEPS_TAIL) != 1:
        raise SystemExit(f"FATAL: imageLayout deps tail occurs "
                         f"{new_layout.count(IMAGE_LAYOUT_DEPS_TAIL)} times, expected 1")
    new_layout = new_layout.replace(IMAGE_LAYOUT_DEPS_TAIL, IMAGE_LAYOUT_DEPS_TAIL_NEW, 1)

    # --- smart-canvas.js: wrapper + deps helper ---------------------------
    new_lines = list(lines)
    new_lines[s:e + 1] = [WRAPPER]
    new_main = "\n".join(new_lines)
    if new_main.count(DEPS_ANCHOR) != 1:
        raise SystemExit("FATAL: smartLayoutDeps return block not matched exactly once")
    new_main = new_main.replace(DEPS_ANCHOR,
                                DEPS_ANCHOR[:DEPS_ANCHOR.index("\n    };")] + ",\n"
                                + NEW_DEPS + "\n    };", 1)

    # --- structural assertions (a silent no-op replace() has bitten before) --
    sig_lines = [ln for ln in new_layout.split("\n")
                 if "function smartGroupThumbLayout(" in ln]
    if sig_lines != ["    " + MODULE_SIG]:
        raise SystemExit(f"FATAL: smartGroupThumbLayout signature line malformed: {sig_lines!r}")
    if new_main.count("window.SmartCanvasLayout.smartGroupThumbLayout") != 1:
        raise SystemExit("FATAL: expected exactly one smartGroupThumbLayout wrapper")
    helper = re.search(r"function smartLayoutDeps\(\)\{[\s\S]*?\n\}", new_main)
    if not helper:
        raise SystemExit("FATAL: smartLayoutDeps helper not found after the patch")
    missing = [n for n in PREAMBLE_NAMES
               if not re.search(r"\b" + re.escape(n) + r"\b", helper.group(0))]
    if missing:
        raise SystemExit(f"FATAL: deps not supplied by smartLayoutDeps(): {missing}")
    if "smartGroupThumbLayout(node, deps)" in module_block:
        raise SystemExit("FATAL: the module must not call itself through deps")

    print(f"smart-canvas.js: {len(lines)} -> {len(new_lines)} lines "
          f"({len(new_lines) - len(lines):+d})")
    print(f"canvas-layout.js: {len(layout_raw.splitlines())} -> {len(new_layout.splitlines())} lines")
    print(f"injected deps checked against smartLayoutDeps(): {', '.join(PREAMBLE_NAMES)}")

    if not APPLY:
        _write(PREVIEW_DIR / "_p42b_canvas-layout.js", new_layout)
        _write(PREVIEW_DIR / "_p42b_smart-canvas.js", new_main)
        print("\nDRY RUN - previews at scripts/_p42b_canvas-layout.js / _p42b_smart-canvas.js")
        return 0

    _write(LAYOUT, new_layout)
    _write(MAIN, new_main)
    print(f"\nAPPLIED: wrote {LAYOUT.relative_to(ROOT)} and {MAIN.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
