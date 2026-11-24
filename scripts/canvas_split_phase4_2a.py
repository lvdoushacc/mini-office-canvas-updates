# -*- coding: utf-8 -*-
"""Canvas split phase 4.2a: move imageLayout into modules/canvas-layout.js.

imageLayout is the layout dispatch hub (nodeRect/render both go through it).
This phase moves *that one function*; every helper it calls stays where it is and
arrives as a same-named injected parameter, so the body is copied verbatim.

Four of its calls target functions that already moved into canvas-layout.js in
phase 4.1, and those module functions require a deps argument. Calling them with
the old arity would hit the `needDeps` guard, so those call sites get `deps`
threaded through (and `groupImageGridLayout` gets its former default
`maxVisibleRows = MEDIA_GROUP_MAX_VISIBLE_ROWS` passed explicitly, exactly what
the main-file wrapper used to supply). No arithmetic is touched.

Injected deps fall into two kinds:
  * pure data / pure predicates that could move later  (settings,
    EMPTY_UPLOAD_NODE_*, MEDIA_GROUP_THUMB_BASE, mediaNodeDefaultScale,
    smartMinimaxLayoutSize, smartLoopWidth, isSmartUploadNode, isSmartVideoNode)
  * node-graph / group resolution that must NOT go into a pure layout module
    (smartGroupThumbLayout, promptNodeLayoutSize, isSmartGroupCompactMember,
     smartLoopHeight)

Usage:  python scripts/canvas_split_phase4_2a.py [--apply]
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

ORIG_SIG = "function imageLayout(images, scale=1, node=null){"
MODULE_SIG = "function imageLayout(images, scale, node, deps = needDeps('imageLayout')){"
PREAMBLE = ("const {smartGroupThumbLayout, promptNodeLayoutSize, smartMinimaxLayoutSize, "
            "isSmartGroupCompactMember, smartLoopWidth, smartLoopHeight, mediaNodeDefaultScale, "
            "isSmartUploadNode, isSmartVideoNode, settings, EMPTY_UPLOAD_NODE_WIDTH, "
            "EMPTY_UPLOAD_NODE_HEIGHT, MEDIA_GROUP_THUMB_BASE} = deps;")

# (old, new) applied to the moved body; each must occur exactly once
BODY_EDITS = [
    ("smartGroupLayoutSize(node)", "smartGroupLayoutSize(node, deps)"),
    ("emptyGenBoardSizeFromAspect(aspectHint)", "emptyGenBoardSizeFromAspect(aspectHint, deps)"),
    ("singleImageLayout(images[0], node, s)", "singleImageLayout(images[0], node, s, deps)"),
    ("groupImageGridLayout(count, explicitW, explicitH, thumb, PAD, 8)",
     "groupImageGridLayout(count, explicitW, explicitH, thumb, PAD, 8, "
     "MEDIA_GROUP_MAX_VISIBLE_ROWS, deps)"),
]

# extra keys appended to the main-file smartLayoutDeps() helper
NEW_DEPS = ("        mediaNodeDefaultScale, smartMinimaxLayoutSize, smartLoopWidth, "
            "isSmartUploadNode, isSmartVideoNode,\n"
            "        smartGroupThumbLayout, promptNodeLayoutSize, isSmartGroupCompactMember, "
            "smartLoopHeight,\n"
            "        EMPTY_UPLOAD_NODE_WIDTH, EMPTY_UPLOAD_NODE_HEIGHT, MEDIA_GROUP_THUMB_BASE")

WRAPPER = ("function imageLayout(images, scale=1, node=null){ return window.SmartCanvasLayout"
           ".imageLayout(images, scale, node, smartLayoutDeps()); }")

SECTION = """
    // ===== 布局分派枢纽 =====
    // imageLayout 是 nodeRect / render 都经过的分派函数。除下面四个已在
    // 本模块内的函数需要把 deps 继续传下去外，其余被调函数（含节点图与分组
    // 解析相关的 smartGroupThumbLayout / promptNodeLayoutSize /
    // isSmartGroupCompactMember / smartLoopHeight）全部按引用注入，
    // 本模块自身不碰 DOM / nodes / canvas / viewport。
"""


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
    if re.search(r"function imageLayout\(images, scale=1, node=null\)\{ return window", main_raw):
        raise SystemExit("FATAL: imageLayout already delegates to window.SmartCanvasLayout - "
                         "phase 4.2a has already been applied. Restore the backup to redo it.")
    if "function imageLayout(" in layout_raw:
        raise SystemExit("FATAL: canvas-layout.js already defines imageLayout")

    lines = main_raw.split("\n")
    starts = [i for i, ln in enumerate(lines) if ln == ORIG_SIG]
    if len(starts) != 1:
        raise SystemExit(f"FATAL: {len(starts)} exact matches for {ORIG_SIG!r}")
    s = starts[0]
    e = find_block_end(lines, s)
    body = lines[s:e + 1]
    print(f"imageLayout: lines {s + 1}-{e + 1} ({e - s + 1} lines)")

    body = [MODULE_SIG, "    " + PREAMBLE] + body[1:]
    joined = "\n".join(body)
    for old, new in BODY_EDITS:
        n = joined.count(old)
        if n != 1:
            raise SystemExit(f"FATAL: body edit target {old!r} occurs {n} times")
        joined = joined.replace(old, new, 1)
    body = joined.split("\n")
    # the body sits at main-file indent 4/8; the module uses the same indent for a
    # function body, so re-indent the signature/preamble lines only
    indented = []
    for i, ln in enumerate(body):
        indented.append(("    " + ln) if ln.strip() else "")
    module_block = "\n".join(indented)

    # --- canvas-layout.js -------------------------------------------------
    marker = "\n    globalScope.SmartCanvasLayout = {"
    if marker not in layout_raw:
        raise SystemExit("FATAL: export block not found in canvas-layout.js")
    new_layout = layout_raw.replace(
        marker, "\n" + SECTION.rstrip("\n") + "\n" + module_block + "\n" + marker, 1)
    new_layout = new_layout.replace(
        "        smartNodeLayoutImages: smartNodeLayoutImages\n    };",
        "        smartNodeLayoutImages: smartNodeLayoutImages,\n"
        "        imageLayout: imageLayout\n    };")
    if "imageLayout: imageLayout" not in new_layout:
        raise SystemExit("FATAL: failed to add imageLayout to the exports")

    # --- smart-canvas.js: wrapper + deps helper ---------------------------
    new_lines = list(lines)
    new_lines[s:e + 1] = [WRAPPER]
    new_main = "\n".join(new_lines)
    anchor = "        settings, smartPendingTasks, normalizeImageRatio, isAudioMediaItem\n    };"
    if new_main.count(anchor) != 1:
        raise SystemExit("FATAL: smartLayoutDeps return block not matched exactly once")
    new_main = new_main.replace(
        anchor,
        "        settings, smartPendingTasks, normalizeImageRatio, isAudioMediaItem,\n"
        + NEW_DEPS + "\n    };", 1)

    assert "function imageLayout(" in new_layout
    # structural guard: the signature must sit on its own line at module depth.
    # A missing newline here would silently turn it into a comment tail.
    sig_lines = [ln for ln in new_layout.split("\n") if "function imageLayout(" in ln]
    if sig_lines != ["    " + MODULE_SIG]:
        raise SystemExit(f"FATAL: imageLayout signature line malformed: {sig_lines!r}")
    if new_main.count("window.SmartCanvasLayout.imageLayout") != 1:
        raise SystemExit("FATAL: expected exactly one imageLayout wrapper")

    print(f"smart-canvas.js: {len(lines)} -> {len(new_lines)} lines "
          f"({len(new_lines) - len(lines):+d})")
    print(f"canvas-layout.js: {len(layout_raw.splitlines())} -> {len(new_layout.splitlines())} lines")

    if not APPLY:
        _write(PREVIEW_DIR / "_p42a_canvas-layout.js", new_layout)
        _write(PREVIEW_DIR / "_p42a_smart-canvas.js", new_main)
        print("\nDRY RUN - previews at scripts/_p42a_canvas-layout.js / _p42a_smart-canvas.js")
        return 0

    _write(LAYOUT, new_layout)
    _write(MAIN, new_main)
    print(f"\nAPPLIED: wrote {LAYOUT.relative_to(ROOT)} and {MAIN.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
