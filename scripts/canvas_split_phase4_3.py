# -*- coding: utf-8 -*-
"""Canvas split phase 4.3: connection drawing into a new modules/canvas-renderer.js.

Moved (bodies copied byte-verbatim, dependencies injected as same-named parameters):
  * renderConnections        -- builds the whole <svg class="connection-layer"> string
  * updateConnectionSelection -- toggles conn-selected on the injected SVG host
  * connectionMidpoint       -- pure endpoint/midpoint geometry of one connection

Deliberately NOT moved, and why:
  * renderMinimap / renderMinimapDirect -- renderMinimapDirect owns five mutable
    `let`s in smart-canvas.js (smartMinimapRaf, smartMinimapState, smartMinimapNodeRects,
    smartMinimapNodeElements, smartMinimapGeometryDirty, 35 references across 8 functions,
    several of them written by node drag/resize handlers) plus minimapContent /
    minimapViewport / document. JS cannot inject a `let` by reference, so moving these
    would mean either a second copy of that state (forbidden) or boxing all five and
    rewriting every writer -- a large rewrite of the minimap, not a move.
  * refreshConnectionLayer / scheduleConnectionLayerRefresh / bindConnectionEvents --
    DOM insertion + rAF + event listeners (phase 5 territory).
  * cascadeConnectionKeys / outgoingConnectionsFor / hasHistoryConnection -- read
    `nodes` + `canvas.connections` as graph queries, not drawing; they belong with the
    data layer if they move at all.

The new module is an IIFE exposing only window.SmartCanvasRenderer, loads before
smart-canvas.js, declares no globals and touches no DOM of its own -- the SVG host
element reaches it as the injected `world` handle.

Usage:  python scripts/canvas_split_phase4_3.py [--apply]
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAIN = ROOT / "static" / "canvas" / "js" / "smart-canvas.js"
LAYOUT = ROOT / "static" / "canvas" / "js" / "modules" / "canvas-layout.js"
RENDERER = ROOT / "static" / "canvas" / "js" / "modules" / "canvas-renderer.js"
HTML = ROOT / "static" / "smart-canvas.html"
PREVIEW_DIR = ROOT / "scripts"
APPLY = "--apply" in sys.argv

# name -> (exact main-file signature line, module signature line, preamble)
MOVES = {
    "connectionMidpoint": (
        "function connectionMidpoint(conn){",
        "function connectionMidpoint(conn, deps = needDeps('connectionMidpoint')){",
        "const {nodes, nodeRect} = deps;",
    ),
    "renderConnections": (
        "function renderConnections(){",
        "function renderConnections(deps = needDeps('renderConnections')){",
        "const {nodes, canvas, selectedNodeIds, nodeRect, smartGroupScopeId, "
        "cascadeConnectionKeys, smartCascadeEdgeState, smartCascadeRunPath, "
        "loopInsertPreview, escapeAttr} = deps;",
    ),
    "updateConnectionSelection": (
        "function updateConnectionSelection(){",
        "function updateConnectionSelection(deps = needDeps('updateConnectionSelection')){",
        "const {world, selectedNodeIds} = deps;",
    ),
}
# order in the new module and in the exports block
ORDER = ["renderConnections", "updateConnectionSelection", "connectionMidpoint"]
WRAPPERS = {
    "connectionMidpoint": "function connectionMidpoint(conn){ return window.SmartCanvasRenderer"
                          ".connectionMidpoint(conn, rendererDeps()); }",
    "renderConnections": "function renderConnections(){ return window.SmartCanvasRenderer"
                         ".renderConnections(rendererDeps()); }",
    "updateConnectionSelection": "function updateConnectionSelection(){ return "
                                 "window.SmartCanvasRenderer.updateConnectionSelection("
                                 "rendererDeps()); }",
}
DEPS_HELPER = """// canvas-renderer.js 需要的数据与函数仍属主文件：全部按引用注入，本模块不持有第二份
// nodes / canvas / 选中状态。取值发生在调用期，函数声明会提升，不会踩 TDZ。
function rendererDeps(){
    return {
        nodes, canvas, world, escapeAttr, nodeRect, selectedNodeIds,
        smartGroupScopeId, cascadeConnectionKeys, smartCascadeEdgeState,
        smartCascadeRunPath, loopInsertPreview
    };
}"""

MODULE_HEAD = '''/**
 * canvas-renderer.js —— 智能画布连线绘制层（画布拆分第 4.3 阶段）
 *
 * 只放「读当前节点/连线数据 -> 产出连线 SVG 字符串或就地更新选中 class」的函数：
 * renderConnections、updateConnectionSelection、connectionMidpoint。
 *
 * 四条硬约束：
 * 1. 不声明全局、不持有可变状态。nodes / canvas / smartCascadeRunPath / loopInsertPreview
 *    等一律由 smart-canvas.js 的同名包装在调用期按引用注入（见 rendererDeps()），
 *    本模块不复制第二份真源。
 * 2. 不查 DOM。updateConnectionSelection 要改选中 class，宿主元素是注入进来的 `world`
 *    句柄；模块里没有 document / window / getElementById 这类自由标识符。
 * 3. deps 缺失一律抛错（见 needDeps）。原函数大量使用 `?.` 与 `|| []` 兜底，
 *    放任 deps 为空会**静默**少画连线，而不是报错。
 * 4. 必须在 smart-canvas.js 之前加载，解析期不读取任何外部全局；
 *    只暴露 window.SmartCanvasRenderer。
 *
 * 小地图（renderMinimap / renderMinimapDirect）没有搬进来：它持有五个主文件可变
 * `let` 状态（raf 句柄、投影几何、节点矩形表、元素 Map、dirty 标记）并直接建 DOM，
 * 搬动等于复制状态或大规模改写，理由记在 docs/canvas-split-plan.md 第 4.3 阶段。
 */
(function attachSmartCanvasRenderer(globalScope) {

    function needDeps(name) {
        throw new Error('canvas-renderer: ' + name +
            ' 需要调用方注入绘制依赖，请通过 smart-canvas.js 的同名包装函数调用');
    }

'''

SECTIONS = {
    "renderConnections": "    // ===== 连线层 SVG =====",
    "updateConnectionSelection": "    // ===== 连线选中状态 =====",
    "connectionMidpoint": "    // ===== 连线端点几何 =====",
}
MODULE_TAIL = """
    globalScope.SmartCanvasRenderer = {
%s
    };
})(typeof globalThis !== 'undefined' ? globalThis : window);
"""


def _write(path: Path, text: str) -> None:
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)


def _read(path: Path) -> str:
    with open(path, "r", encoding="utf-8", newline="") as fh:
        return fh.read()


def find_block_end(lines, start):
    if not lines[start].rstrip().endswith("{"):
        return start
    for j in range(start + 1, len(lines)):
        if lines[j] in ("}", "};"):
            return j
    raise SystemExit(f"FATAL: unterminated block at line {start + 1}")


def main() -> int:
    main_raw = _read(MAIN)
    assert "\r\n" not in main_raw, "unexpected CRLF"
    for name in ORDER:
        if re.search(r"function " + re.escape(name) + r"\([^)]*\)\{ return window"
                     r"\.SmartCanvasRenderer", main_raw):
            raise SystemExit(f"FATAL: {name} already delegates to window.SmartCanvasRenderer "
                             "- phase 4.3 has already been applied. Restore the backup to redo it.")
    if APPLY and RENDERER.exists():
        raise SystemExit(f"FATAL: {RENDERER} already exists - refusing to overwrite it")

    lines = main_raw.split("\n")
    blocks = {}
    for name, (sig, _, _) in MOVES.items():
        starts = [i for i, ln in enumerate(lines) if ln == sig]
        if len(starts) != 1:
            raise SystemExit(f"FATAL: {len(starts)} exact matches for {sig!r}")
        s = starts[0]
        e = find_block_end(lines, s)
        blocks[name] = (s, e, lines[s:e + 1])
        print(f"{name}: lines {s + 1}-{e + 1} ({e - s + 1} lines)")

    # --- build canvas-renderer.js ----------------------------------------
    parts = [MODULE_HEAD]
    for idx, name in enumerate(ORDER):
        sig, mod_sig, preamble = MOVES[name]
        body = blocks[name][2]
        joined = "\n".join([mod_sig, "    " + preamble] + body[1:])
        if len(re.findall(r"function " + re.escape(name) + r"\(", joined)) != 1:
            raise SystemExit(f"FATAL: {name} body unexpectedly re-defines itself")
        indented = "\n".join(("    " + ln) if ln.strip() else "" for ln in joined.split("\n"))
        if idx:
            parts.append("\n")
        parts.append(SECTIONS[name] + "\n" + indented + "\n")
    module_txt = "".join(parts) + (MODULE_TAIL %
                                   ",\n".join(f"        {n}: {n}" for n in ORDER))

    # --- rewrite smart-canvas.js -----------------------------------------
    new_lines = list(lines)
    for name in sorted(blocks, key=lambda k: blocks[k][0], reverse=True):
        s, e, _ = blocks[name]
        new_lines[s:e + 1] = [WRAPPERS[name]]
    new_main = "\n".join(new_lines)
    anchor = WRAPPERS["renderConnections"]
    if new_main.count(anchor) != 1:
        raise SystemExit("FATAL: renderConnections wrapper disappeared")
    new_main = new_main.replace(anchor, DEPS_HELPER + "\n" + anchor, 1)

    # --- structural assertions -------------------------------------------
    for name in ORDER:
        sig_lines = [ln for ln in module_txt.split("\n")
                     if "function " + name + "(" in ln]
        if sig_lines != ["    " + MOVES[name][1]]:
            raise SystemExit(f"FATAL: {name} signature line malformed: {sig_lines!r}")
        if new_main.count("window.SmartCanvasRenderer." + name) != 1:
            raise SystemExit(f"FATAL: expected exactly one {name} wrapper")
    helper = re.search(r"function rendererDeps\(\)\{[\s\S]*?\n\}", new_main)
    if not helper:
        raise SystemExit("FATAL: rendererDeps() not found after the patch")
    preamble_names = set()
    for name in ORDER:
        inner = MOVES[name][2].split("{", 1)[1].rsplit("}", 1)[0]
        preamble_names |= {p.strip() for p in inner.split(",") if p.strip()}
    missing = sorted(p for p in preamble_names
                     if not re.search(r"\b" + re.escape(p) + r"\b", helper.group(0)))
    if missing:
        raise SystemExit(f"FATAL: deps not supplied by rendererDeps(): {missing}")
    helper_names = {w for w in re.findall(r"\b[A-Za-z_$][\w$]*\b", helper.group(0))}
    extra = sorted(helper_names - preamble_names - {"function", "rendererDeps", "return"})
    if extra:
        raise SystemExit(f"FATAL: rendererDeps() injects names no moved function uses: {extra}")

    print(f"canvas-renderer.js: {len(module_txt.splitlines())} lines, exports {ORDER}")
    print(f"smart-canvas.js: {len(lines)} -> {len(new_main.splitlines()) + 1} lines "
          f"({len(new_main.splitlines()) + 1 - len(lines):+d})")
    print(f"injected deps ({len(preamble_names)}): {', '.join(sorted(preamble_names))}")

    if not APPLY:
        _write(PREVIEW_DIR / "_p43_canvas-renderer.js", module_txt)
        _write(PREVIEW_DIR / "_p43_smart-canvas.js", new_main)
        print("\nDRY RUN - previews at scripts/_p43_canvas-renderer.js / _p43_smart-canvas.js")
        return 0

    _write(RENDERER, module_txt)
    _write(MAIN, new_main)
    print(f"\nAPPLIED: wrote {RENDERER.relative_to(ROOT)} and {MAIN.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
