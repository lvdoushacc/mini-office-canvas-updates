# -*- coding: utf-8 -*-
"""Canvas split phase 4.1: lift the pure layout maths into modules/canvas-layout.js.

Scope discipline -- only functions whose result is a pure function of their
arguments plus a handful of immutable layout constants are moved. Everything
that walks the node graph, touches the DOM, or reads viewport is left alone.

Moved (10):
    mediaLayoutSize, standardImageFixedSize, emptyGenBoardSizeFromAspect,
    nodeScale, smartGroupLayoutSize, groupImageGridLayout,
    smartNodeInputThumbRows, smartNodeInputThumbsHeight, smartNodeLayoutImages,
    singleImageLayout

Deliberately NOT moved:
    promptNodeMinHeight / promptNodeExpandedHeight
        They need live graph accessors (promptNodeInputImages and
        promptNodeUpstreamPromptItems reach `nodes` and `canvas.connections` via
        inputNodesFor) plus a cluster of PROMPT_* geometry consts that other
        main-file code shares. That is a wide injected surface for ~9 lines of
        arithmetic, so they stay put.

Every layout constant (STANDARD_ASPECT_RATIO_PRESETS, MEDIA_GROUP_*,
SMART_GROUP_*) is used 2-22 times elsewhere in smart-canvas.js, so the consts
stay in the main file and arrive as same-named parameters. Bodies are copied
verbatim; only the first-line signature changes.

Missing deps fail loudly: each moved function defaults its deps parameter to
needDeps(name), because two of the originals guard their helpers with
`typeof X === 'function'` and would otherwise silently change their result
instead of throwing.

Usage:  python scripts/canvas_split_phase4_1.py [--apply]
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAIN = ROOT / "static" / "canvas" / "js" / "smart-canvas.js"
OUT = ROOT / "static" / "canvas" / "js" / "modules" / "canvas-layout.js"
PREVIEW_DIR = ROOT / "scripts"
APPLY = "--apply" in sys.argv

DEPS_HELPER = """// canvas-layout.js 需要的布局常量与少量外部依赖仍属主文件/其它模块：
// 这些常量在主文件另有 2-22 处引用，搬进 IIFE 会制造第二份真源，所以按引用注入；
// normalizeImageRatio 来自 canvas-utils，smartPendingTasks 与 settings 留在主文件。
// 取值发生在调用期，函数声明会提升，不会踩 TDZ。
function smartLayoutDeps(){
    return {
        STANDARD_ASPECT_RATIO_PRESETS, MEDIA_GROUP_MAX_VISIBLE_ROWS,
        MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE, MEDIA_GROUP_DEFAULT_SCALE,
        SMART_GROUP_DEFAULT_WIDTH, SMART_GROUP_MIN_WIDTH, SMART_GROUP_LEGACY_HEIGHT,
        SMART_GROUP_DEFAULT_HEIGHT, SMART_GROUP_MIN_HEIGHT,
        settings, smartPendingTasks, normalizeImageRatio, isAudioMediaItem
    };
}"""

SPECS = [
    dict(name="nodeScale", section="节点缩放",
         orig="nodeScale(node)",
         sig="nodeScale(node, {MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE, MEDIA_GROUP_DEFAULT_SCALE} = needDeps('nodeScale'))",
         wrapper="function nodeScale(node){ return window.SmartCanvasLayout.nodeScale(node, smartLayoutDeps()); }"),
    dict(name="emptyGenBoardSizeFromAspect", section="空生成板尺寸",
         orig="emptyGenBoardSizeFromAspect(aspect)",
         sig=("emptyGenBoardSizeFromAspect(aspect, {STANDARD_ASPECT_RATIO_PRESETS, normalizeImageRatio} "
              "= needDeps('emptyGenBoardSizeFromAspect'))"),
         wrapper="function emptyGenBoardSizeFromAspect(aspect){ "
                 "return window.SmartCanvasLayout.emptyGenBoardSizeFromAspect(aspect, smartLayoutDeps()); }"),
    dict(name="smartGroupLayoutSize", section="智能分组尺寸",
         orig="smartGroupLayoutSize(node)",
         sig=("smartGroupLayoutSize(node, {SMART_GROUP_DEFAULT_WIDTH, SMART_GROUP_MIN_WIDTH, "
              "SMART_GROUP_LEGACY_HEIGHT, SMART_GROUP_DEFAULT_HEIGHT, SMART_GROUP_MIN_HEIGHT} "
              "= needDeps('smartGroupLayoutSize'))"),
         wrapper="function smartGroupLayoutSize(node){ "
                 "return window.SmartCanvasLayout.smartGroupLayoutSize(node, smartLayoutDeps()); }"),
    dict(name="mediaLayoutSize", section="媒体与单图布局",
         orig="mediaLayoutSize(img)",
         sig=None,
         wrapper="function mediaLayoutSize(img){ return window.SmartCanvasLayout.mediaLayoutSize(img); }"),
    dict(name="standardImageFixedSize", section="媒体与单图布局",
         orig="standardImageFixedSize(naturalW, naturalH)",
         sig="standardImageFixedSize(naturalW, naturalH, {STANDARD_ASPECT_RATIO_PRESETS} = needDeps('standardImageFixedSize'))",
         wrapper="function standardImageFixedSize(naturalW, naturalH){ "
                 "return window.SmartCanvasLayout.standardImageFixedSize(naturalW, naturalH, smartLayoutDeps()); }"),
    dict(name="singleImageLayout", section="媒体与单图布局",
         orig="singleImageLayout(image, node, scale=1)",
         sig="singleImageLayout(image, node, scale, deps = needDeps('singleImageLayout'))",
         preamble="const {settings, isAudioMediaItem} = deps;",
         # 模块内部调用必须把 deps 传下去，否则会撞上 needDeps 的显式报错。
         # 原版里这两个被调函数是全局函数；现在它们是同模块的局部函数，
         # 但同样需要 deps 参数，所以只有调用处补一个实参，运算逻辑一字未改。
         body_edits=[("standardImageFixedSize(naturalW, naturalH)",
                      "standardImageFixedSize(naturalW, naturalH, deps)"),
                     ("emptyGenBoardSizeFromAspect(ratioHint)",
                      "emptyGenBoardSizeFromAspect(ratioHint, deps)")],
         wrapper="function singleImageLayout(image, node, scale=1){ "
                 "return window.SmartCanvasLayout.singleImageLayout(image, node, scale, smartLayoutDeps()); }"),
    dict(name="groupImageGridLayout", section="多图网格",
         orig="groupImageGridLayout(count, explicitW, explicitH, maxThumb, pad=32, gap=8, maxVisibleRows=MEDIA_GROUP_MAX_VISIBLE_ROWS)",
         sig=("groupImageGridLayout(count, explicitW, explicitH, maxThumb, pad, gap, maxVisibleRows, "
              "{MEDIA_GROUP_MAX_VISIBLE_ROWS} = needDeps('groupImageGridLayout'))"),
         wrapper="function groupImageGridLayout(count, explicitW, explicitH, maxThumb, pad=32, gap=8, maxVisibleRows=MEDIA_GROUP_MAX_VISIBLE_ROWS){ "
                 "return window.SmartCanvasLayout.groupImageGridLayout(count, explicitW, explicitH, maxThumb, pad, gap, maxVisibleRows, smartLayoutDeps()); }"),
    dict(name="smartNodeInputThumbRows", section="输入缩略图排布",
         orig="smartNodeInputThumbRows(count)",
         sig=None,
         wrapper="function smartNodeInputThumbRows(count){ return window.SmartCanvasLayout.smartNodeInputThumbRows(count); }"),
    dict(name="smartNodeInputThumbsHeight", section="输入缩略图排布",
         orig="smartNodeInputThumbsHeight(images)",
         sig=None,
         wrapper="function smartNodeInputThumbsHeight(images){ return window.SmartCanvasLayout.smartNodeInputThumbsHeight(images); }"),
    dict(name="smartNodeLayoutImages", section="输入缩略图排布",
         orig="smartNodeLayoutImages(node)",
         sig="smartNodeLayoutImages(node, {smartPendingTasks} = needDeps('smartNodeLayoutImages'))",
         wrapper="function smartNodeLayoutImages(node){ "
                 "return window.SmartCanvasLayout.smartNodeLayoutImages(node, smartLayoutDeps()); }"),
]

# identifiers the moved bodies are allowed to resolve from outside their own scope
JS_BUILTINS = {
    "Array", "Boolean", "Date", "Error", "Function", "JSON", "Map", "Math", "Number",
    "Object", "Promise", "RegExp", "Set", "String", "Symbol", "WeakMap", "WeakSet",
    "globalThis", "undefined", "NaN", "Infinity", "parseInt", "parseFloat", "isNaN",
    "isFinite", "encodeURIComponent", "decodeURIComponent", "arguments", "this",
    "typeof", "instanceof", "new", "delete", "void", "in", "of", "if", "else", "for",
    "while", "do", "switch", "case", "default", "break", "continue", "return",
    "function", "async", "await", "try", "catch", "finally", "throw", "const", "let",
    "var", "class", "extends", "static", "get", "set", "yield", "needDeps",
}

HEADER = '''/**
 * canvas-layout.js —— 智能画布纯布局计算层（画布拆分第 4.1 阶段）
 *
 * 只放「给定节点/图片数据 -> 尺寸/排布数字」的纯计算：节点缩放、媒体与单图布局、
 * 多图网格、智能分组尺寸、空生成板尺寸、输入缩略图排布。
 *
 * 三条硬约束：
 * 1. 不碰 DOM，不读写 nodes / canvas / viewport，不 render、不 save。
 *    所有布局常量（STANDARD_ASPECT_RATIO_PRESETS / MEDIA_GROUP_* / SMART_GROUP_*）
 *    在主文件另有 2-22 处引用，因此全部留在主文件，由同名包装函数按引用注入，
 *    参数名与原常量一致，函数体逐字节保持原样。
 *    singleImageLayout 会读 settings?.ratio 作为比例兜底，同样是注入而非复制。
 * 2. deps 缺失一律抛错（见 needDeps）。原代码里 normalizeImageRatio 与
 *    emptyGenBoardSizeFromAspect 都有 `typeof X === 'function'` 兜底，
 *    如果放任 deps 为空，结果会**静默**变化而不是报错。
 * 3. 加载顺序必须在 smart-canvas.js 之前；本文件解析期不读取任何外部全局。
 *    只暴露 window.SmartCanvasLayout。
 */
(function attachSmartCanvasLayout(globalScope) {

    function needDeps(name) {
        throw new Error('canvas-layout: ' + name +
            ' 需要调用方注入布局依赖，请通过 smart-canvas.js 的同名包装函数调用');
    }
'''

FOOTER_TMPL = '''
    globalScope.SmartCanvasLayout = {
%s
    };
})(typeof globalThis !== 'undefined' ? globalThis : window);
'''


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
    raw = _read(MAIN)
    assert "\r\n" not in raw, "unexpected CRLF"
    if "window.SmartCanvasLayout" in raw:
        raise SystemExit("FATAL: smart-canvas.js already delegates to window.SmartCanvasLayout - "
                         "phase 4.1 has already been applied. Restore the backup to redo it.")
    lines = raw.split("\n")

    located, problems = [], []
    for spec in SPECS:
        sig = "function " + spec["orig"] + "{"
        starts = [i for i, ln in enumerate(lines) if ln == sig]
        if len(starts) != 1:
            problems.append(f"{spec['name']}: {len(starts)} exact matches for {sig!r}")
            continue
        s = starts[0]
        e = find_block_end(lines, s)
        body = lines[s:e + 1]
        if spec["sig"]:
            head = "function " + spec["sig"] + "{"
            body = [head] + body[1:]
        if spec.get("preamble"):
            body = [body[0], "    " + spec["preamble"]] + body[1:]
        for old, new in spec.get("body_edits", []):
            joined = "\n".join(body)
            if joined.count(old) != 1:
                problems.append(f"{spec['name']}: body edit target {old!r} occurs "
                                f"{joined.count(old)} times")
                continue
            body = joined.replace(old, new, 1).split("\n")
        located.append(dict(spec=spec, start=s, end=e, text="\n".join(body)))

    if problems:
        print("=== ABORTING ===")
        for p in problems:
            print(" -", p)
        return 1

    # informational free-identifier scan (authoritative check is the runtime trap
    # in canvas_split_phase4_1_check.py, gate A)
    moved_names = {l["spec"]["name"] for l in located}
    injected = {"STANDARD_ASPECT_RATIO_PRESETS", "MEDIA_GROUP_MAX_VISIBLE_ROWS",
                "MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE", "MEDIA_GROUP_DEFAULT_SCALE",
                "SMART_GROUP_DEFAULT_WIDTH", "SMART_GROUP_MIN_WIDTH",
                "SMART_GROUP_LEGACY_HEIGHT", "SMART_GROUP_DEFAULT_HEIGHT",
                "SMART_GROUP_MIN_HEIGHT", "settings", "smartPendingTasks",
                "normalizeImageRatio", "isAudioMediaItem"}
    sys.path.insert(0, str(ROOT / "scripts"))
    from canvas_split_phase3_check import strip_noise  # noqa: E402

    print("=== free-identifier scan (informational) ===")
    for l in located:
        clean = strip_noise(l["text"])          # blanks strings, comments, regexes
        idents = set(re.findall(r"(?<![.\w$])([A-Za-z_$][\w$]*)\b(?!\s*:)", clean))
        declared = set()
        # const/let/var declarator lists, including multi-declarator statements
        for group in re.findall(r"\b(?:const|let|var)\s+([^;]{0,200}?)(?:;|\n)", clean):
            declared |= set(re.findall(r"[A-Za-z_$][\w$]*", group.split("=")[0]))
        declared |= set(re.findall(r"^\s*(?:async )?function\s+([A-Za-z_$][\w$]*)", clean, re.M))
        # every assignment target, arrow parameter and catch/for binding
        declared |= set(re.findall(r"([A-Za-z_$][\w$]*)\s*=(?!=|>)", clean))
        declared |= set(re.findall(r"([A-Za-z_$][\w$]*)\s*=>", clean))
        declared |= set(re.findall(r"\(([^()]*)\)\s*=>", clean) and
                        {n for grp in re.findall(r"\(([^()]*)\)\s*=>", clean)
                         for n in re.findall(r"[A-Za-z_$][\w$]*", grp)} or set())
        declared |= set(re.findall(r"\bcatch\s*\(\s*([A-Za-z_$][\w$]*)", clean))
        params = set(re.findall(r"[A-Za-z_$][\w$]*", l["spec"]["sig"] or l["spec"]["orig"]))
        free = sorted(idents - JS_BUILTINS - moved_names - injected - declared - params)
        print(f"  {l['spec']['name']:32} free={free}")

    # --- build canvas-layout.js -------------------------------------------
    sections = []
    for l in located:
        if l["spec"]["section"] not in sections:
            sections.append(l["spec"]["section"])
    out = [HEADER.rstrip("\n")]
    for sec in sections:
        out.append("")
        out.append(f"    // ===== {sec} =====")
        for l in located:
            if l["spec"]["section"] != sec:
                continue
            for bl in l["text"].split("\n"):
                out.append(("    " + bl) if bl.strip() else "")
    names = [l["spec"]["name"] for l in located]
    out.append(FOOTER_TMPL % ",\n".join(f"        {n}: {n}" for n in names))
    module_text = "\n".join(out).rstrip("\n") + "\n"

    # --- rewrite smart-canvas.js ------------------------------------------
    edits = [(l["start"], l["end"], [l["spec"]["wrapper"]]) for l in located]
    # hang the deps helper next to the first moved wrapper
    first = min(e[0] for e in edits)
    edits.append((first, first - 1, DEPS_HELPER.split("\n")))
    edits.sort(key=lambda x: x[0], reverse=True)
    new_lines = list(lines)
    for s, e, repl in edits:
        new_lines[s:e + 1] = repl
    new_main = "\n".join(new_lines)

    for name in names:
        if f"window.SmartCanvasLayout.{name}" not in new_main:
            raise SystemExit(f"FATAL: wrapper for {name} missing after rewrite")
    print(f"\nsmart-canvas.js: {len(lines)} -> {len(new_lines)} lines "
          f"({len(new_lines) - len(lines):+d})")
    print(f"canvas-layout.js: {len(module_text.splitlines())} lines, {len(names)} functions")
    print("moved:", ", ".join(names))

    if not APPLY:
        _write(PREVIEW_DIR / "_p41_canvas-layout.js", module_text)
        _write(PREVIEW_DIR / "_p41_smart-canvas.js", new_main)
        print("\nDRY RUN - previews at scripts/_p41_canvas-layout.js and scripts/_p41_smart-canvas.js")
        return 0

    OUT.parent.mkdir(parents=True, exist_ok=True)
    _write(OUT, module_text)
    _write(MAIN, new_main)
    print(f"\nAPPLIED: wrote {OUT.relative_to(ROOT)} and {MAIN.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
