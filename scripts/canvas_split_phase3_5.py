# -*- coding: utf-8 -*-
"""Canvas split phase 3.5: give the save-time node contract one authoritative home.

Finding that drove this phase
-----------------------------
`saveCanvas` carried a 41-line inline loop that back-fills the videoCrop /
genBoard contracts and cleans `images` / `runSettings` on the LIVE node objects.
It reads like `normalizeLegacySmartNode`, but it is NOT the same policy -- on the
real data plus seeded shapes it diverges in five ways (see
docs/canvas-split-plan.md, phase 3.5 record). The decisive one:
`normalizeLegacySmartNode` ends with `delete node.w; delete node.h;` for
single-image nodes, which is correct for a load-time clone but would collapse
live node layout if it ran on every save.

So the two implementations are deliberately kept separate. What this phase does
is minimal and behavioural-neutral:

  * lift the inline loop verbatim into canvas-state.js as
    `normalizeSmartNodesForSave(nodes, deps)`, so the data-contract module owns
    both contract policies side by side and the divergence is documented in code
    instead of being latent across a 31k-line file,
  * leave a same-named wrapper in smart-canvas.js, exactly like every other
    moved function,
  * change nothing about the save format, fields, versions or migration results.

Injection follows the phase-3 rule: the deps arrive as parameters named exactly
like the globals the block used to close over, so the body is copied untouched.
`nodes.forEach` stays as-is (no `|| []` guard added) so a null `nodes` still
throws at the same place.

Usage:  python scripts/canvas_split_phase3_5.py [--apply]
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAIN = ROOT / "static" / "canvas" / "js" / "smart-canvas.js"
STATE = ROOT / "static" / "canvas" / "js" / "modules" / "canvas-state.js"
PREVIEW_DIR = ROOT / "scripts"
APPLY = "--apply" in sys.argv

CALL_INDENT = " " * 8
CALL_LINE = CALL_INDENT + "normalizeSmartNodesForSave(nodes);"
LOOP_HEAD = CALL_INDENT + "nodes.forEach(node => {"

DEPS_PARAM = "{isEmptyGenBoard, isSmartVideoNode, emptyGenBoardSizeFromAspect}"

WRAPPER = ("function normalizeSmartNodesForSave(nodes){ return window.SmartCanvasState"
           ".normalizeSmartNodesForSave(nodes, smartNodeMigrationDeps()); }")

DOC = """    // ===== 保存期节点契约补齐（saveCanvas 专用）=====
    // 这段是就地改写实时 nodes，不是克隆后的快照。
    // 它和上面的 normalizeLegacySmartNode 是两套不同策略，故意不合并；差异共五类
    // （证据与复现见 docs/canvas-split-plan.md 第 3.5 阶段记录）：
    //   1. 这里不补 node.type；normalize 会把缺 type 的节点写成 'smart-image'。
    //   2. 裁剪分支只认 node.isCroppedVideo，并在 tOut <= tIn 时强制 tOut = tIn + 10；
    //      normalize 触发条件更宽（videoCropVersion / 首图 trim 也算），没有这条钳制，
    //      还会把 type/genKind 改写成 video。
    //   3. 空生成板分支只在 w/h 无效时补尺寸，不平移 x/y；normalize 会 resize 并重新居中。
    //   4. 裁剪元数据写每张 image；normalize 只写 images[0]。
    //   5. 这里绝不 delete node.w/h；normalize 对单图节点会删，落到实时节点上布局会塌。
"""


def _write(path: Path, text: str) -> None:
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)


def _read(path: Path) -> str:
    with open(path, "r", encoding="utf-8", newline="") as fh:
        return fh.read()


def guard(main: str) -> None:
    hits = main.count("normalizeSmartNodesForSave")
    if hits:
        raise SystemExit(
            f"FATAL: normalizeSmartNodesForSave already appears {hits} times in "
            f"smart-canvas.js - phase 3.5 has already been applied. Restore the "
            f"backup first if you meant to redo it.")


SAVE_FN = "async function saveCanvas(options = {}){"


def locate_loop(main: str):
    """Return (start_line_idx, end_line_idx, body) of saveCanvas' inline forEach.

    Both `savePromptDraftForCurrent();` and `nodes.forEach(node => {` occur many
    times in this file, so the search is narrowed to saveCanvas' own brace-matched
    body first, and the block is then confirmed by the tokens only the save-time
    contract loop contains.
    """
    lines = main.split("\n")
    if main.count(SAVE_FN) != 1:
        raise SystemExit(f"FATAL: expected exactly one `{SAVE_FN}`, found {main.count(SAVE_FN)}")
    fn_start = len(main[: main.index(SAVE_FN)].split("\n")) - 1
    depth = 0
    fn_end = None
    for j in range(fn_start, len(lines)):
        depth += lines[j].count("{") - lines[j].count("}")
        if depth == 0 and j > fn_start:
            fn_end = j
            break
    if fn_end is None:
        raise SystemExit("FATAL: saveCanvas is not brace-balanced")

    heads = [i for i in range(fn_start, fn_end + 1) if lines[i] == LOOP_HEAD]
    if len(heads) != 1:
        raise SystemExit(f"FATAL: expected exactly one `{LOOP_HEAD.strip()}` inside "
                         f"saveCanvas (lines {fn_start + 1}-{fn_end + 1}), found {len(heads)}")
    start = heads[0]
    prev = lines[start - 1].strip()
    if prev != "savePromptDraftForCurrent();":
        raise SystemExit(f"FATAL: unexpected statement before the loop: {prev!r}")
    depth = 0
    end = None
    for j in range(start, fn_end + 1):
        depth += lines[j].count("{") - lines[j].count("}")
        if depth == 0 and j > start:
            end = j
            break
    if end is None:
        raise SystemExit("FATAL: unterminated inline forEach inside saveCanvas")
    body = "\n".join(lines[start:end + 1])
    if not body.rstrip().endswith("});"):
        raise SystemExit(f"FATAL: unexpected end of inline loop: {lines[end]!r}")
    for token in ("node.isCroppedVideo", "videoCropVersion", "isEmptyGenBoard(node)",
                  "genBoardVersion", "emptyGenBoardSizeFromAspect",
                  "mediaItemForStorage(stripImageGenerationMeta(img))",
                  "settingsForStorage(node.runSettings)", "isSmartVideoNode(node)"):
        if token not in body:
            raise SystemExit(f"FATAL: inline loop is missing expected token {token!r}")
    if main.count(body) != 1:
        raise SystemExit("FATAL: the located loop body is not unique in the file")
    return start, end, body


def main_() -> int:
    main = _read(MAIN)
    guard(main)
    state = _read(STATE)
    assert "\r\n" not in main and "\r\n" not in state

    start, end, loop_body = locate_loop(main)
    main_lines = main.split("\n")
    print(f"inline save-time loop: lines {start + 1}-{end + 1} ({end - start + 1} lines)")

    # --- canvas-state.js: add the function and export it -------------------
    # re-indent the verbatim block from main-file depth (8) to module depth (8)
    # inside a function body: the loop already sits at 8 spaces, and inside the
    # module a function body starts at 8 too, so the text is reused untouched.
    fn = (DOC +
          "    function normalizeSmartNodesForSave(nodes, " + DEPS_PARAM + "){\n" +
          loop_body + "\n" +
          "    }\n")
    marker = "    // ===== 导入数据规范化 ====="
    if marker not in state:
        raise SystemExit("FATAL: could not find the 导入数据规范化 section in canvas-state.js")
    new_state = state.replace(marker, fn + "\n" + marker, 1)
    new_state = new_state.replace(
        "        pruneNodeForSnapshot: pruneNodeForSnapshot\n    };",
        "        pruneNodeForSnapshot: pruneNodeForSnapshot,\n"
        "        normalizeSmartNodesForSave: normalizeSmartNodesForSave\n    };")
    if "normalizeSmartNodesForSave: normalizeSmartNodesForSave" not in new_state:
        raise SystemExit("FATAL: failed to add the export entry")

    # --- smart-canvas.js: wrapper + call site ------------------------------
    anchor_wrapper = ("function smartNodeMigrationDeps(){")
    ai = next((i for i, ln in enumerate(main_lines) if ln.startswith(anchor_wrapper)), None)
    if ai is None:
        raise SystemExit("FATAL: smartNodeMigrationDeps helper not found")
    # find the helper's closing brace, insert the wrapper right after it
    j = ai
    while main_lines[j] != "}":
        j += 1
    new_main_lines = list(main_lines)
    new_main_lines[start:end + 1] = [CALL_LINE]                     # do the call site first
    new_main_lines.insert(j + 1, WRAPPER)                           # then the wrapper

    new_main = "\n".join(new_main_lines)
    referring = [ln for ln in new_main_lines if "normalizeSmartNodesForSave" in ln]
    if len(referring) != 2:
        raise SystemExit("FATAL: expected the wrapper line and the call line only, got "
                         + str(len(referring)) + ": " + repr(referring))
    assert loop_body not in new_main, "the inline loop is still present"

    print(f"smart-canvas.js: {len(main_lines)} -> {len(new_main_lines)} lines "
          f"({len(new_main_lines) - len(main_lines):+d})")
    print(f"canvas-state.js: {len(state.splitlines())} -> {len(new_state.splitlines())} lines")

    if not APPLY:
        _write(PREVIEW_DIR / "_p35_canvas-state.js", new_state)
        _write(PREVIEW_DIR / "_p35_smart-canvas.js", new_main)
        print("\nDRY RUN - previews at scripts/_p35_canvas-state.js and "
              "scripts/_p35_smart-canvas.js")
        return 0

    _write(STATE, new_state)
    _write(MAIN, new_main)
    print(f"\nAPPLIED: wrote {STATE.relative_to(ROOT)} and {MAIN.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main_())
