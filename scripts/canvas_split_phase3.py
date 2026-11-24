# -*- coding: utf-8 -*-
"""Canvas split phase 3: move the data-contract layer into modules/canvas-state.js.

Design rules (mirrors phase 2, plus two extra constraints specific to state):

* No `let` / `const` state moves. `nodes`, `canvas`, `viewport`, `settings`,
  `EMPTY_GEN_NODE_WIDTH`, `SMART_LOG_PREVIEW_NODE_ID`, `INLINE_MEDIA_MIGRATE_LIMIT`
  all stay in smart-canvas.js as the single source of truth.
* Where a moved function needs main-file state or main-file helpers, the value is
  injected as a parameter **with the same identifier name**, so the function body
  can be copied verbatim. Zero body rewriting => zero chance of changing the
  data contract by accident. The main file keeps a same-named wrapper that
  supplies the real values at call time.
* `EMPTY_GEN_NODE_WIDTH` must NOT move: lines ~18055/~18064 guard it with
  `typeof EMPTY_GEN_NODE_WIDTH !== "undefined" ? ... : 320`. Hiding it inside an
  IIFE would silently downgrade those two call sites from 340 to 320.
* `loadCanvas` / `saveCanvas` / `scheduleSave` stay: they are entangled with LAN
  mode, fetch, DOM, toast/tr and a dozen main-file state variables.

Usage:  python scripts/canvas_split_phase3.py [--apply]
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "static" / "canvas" / "js" / "smart-canvas.js"
OUT_DIR = ROOT / "static" / "canvas" / "js" / "modules"
OUT = OUT_DIR / "canvas-state.js"

APPLY = "--apply" in sys.argv
PREVIEW_DIR = ROOT / "scripts"

DEPS_HELPER = """// normalizeLegacySmartNode / serializableSmartNode 需要的节点分类函数与布局常量仍属主文件：
// EMPTY_GEN_NODE_WIDTH 在别处有 `typeof ... !== "undefined" ? ... : 320` 兜底，搬进 IIFE 会让
// 那两处静默退化成 320；isEmptyGenBoard / emptyGenBoardSizeFromAspect 属布局层（第 4 阶段）；
// mediaKindForItem 属 canvas-utils。因此这里按引用注入而不是复制第二份，也避免本文件在解析期
// 读任何主文件全局。函数声明会提升，取值发生在调用期，不会踩 TDZ。
function smartNodeMigrationDeps(){
    return { tr, isEmptyGenBoard, isSmartVideoNode, emptyGenBoardSizeFromAspect, EMPTY_GEN_NODE_WIDTH, mediaKindForItem };
}"""

# spec: name, section, orig_sig, module_sig, wrapper (may be multi-line), body_edits
SPECS = [
    dict(name="cloneSmartSettings", section="设置克隆与存储清洗",
         orig_sig="cloneSmartSettings(source=settings)",
         module_sig="cloneSmartSettings(source)",
         wrapper="function cloneSmartSettings(source=settings){ return window.SmartCanvasState.cloneSmartSettings(source); }"),
    dict(name="settingsForStorage", section="设置克隆与存储清洗",
         orig_sig="settingsForStorage(source=settings)",
         module_sig="settingsForStorage(source)",
         wrapper="function settingsForStorage(source=settings){ return window.SmartCanvasState.settingsForStorage(source); }"),
    dict(name="stripOutpaintDisplaySettings", section="设置克隆与存储清洗",
         orig_sig="stripOutpaintDisplaySettings(settingsObj, node=null)",
         module_sig=None,
         wrapper="function stripOutpaintDisplaySettings(settingsObj, node){ return window.SmartCanvasState.stripOutpaintDisplaySettings(settingsObj, node); }"),

    dict(name="mediaItemForStorage", section="节点媒体数据持久化",
         orig_sig="mediaItemForStorage(item)", module_sig=None,
         wrapper="function mediaItemForStorage(item){ return window.SmartCanvasState.mediaItemForStorage(item); }"),
    dict(name="stripImageGenerationMeta", section="节点媒体数据持久化",
         orig_sig="stripImageGenerationMeta(img)", module_sig=None,
         wrapper="function stripImageGenerationMeta(img){ return window.SmartCanvasState.stripImageGenerationMeta(img); }"),
    dict(name="applyNodeMetaToImage", section="节点媒体数据持久化",
         orig_sig="applyNodeMetaToImage(image, node)", module_sig=None,
         wrapper="function applyNodeMetaToImage(image, node){ return window.SmartCanvasState.applyNodeMetaToImage(image, node); }"),
    dict(name="inheritNodeMetaFromImage", section="节点媒体数据持久化",
         orig_sig="inheritNodeMetaFromImage(node)", module_sig=None,
         wrapper="function inheritNodeMetaFromImage(node){ return window.SmartCanvasState.inheritNodeMetaFromImage(node); }"),
    dict(name="mergeSmartImageLists", section="节点媒体数据持久化",
         orig_sig="mergeSmartImageLists(localImgs, remoteImgs)", module_sig=None,
         wrapper="function mergeSmartImageLists(localImgs, remoteImgs){ return window.SmartCanvasState.mergeSmartImageLists(localImgs, remoteImgs); }"),
    dict(name="countCanvasMediaItems", section="节点媒体数据持久化",
         orig_sig="countCanvasMediaItems(list)", module_sig=None,
         wrapper="function countCanvasMediaItems(list){ return window.SmartCanvasState.countCanvasMediaItems(list); }"),
    dict(name="collectOversizedInlineImages", section="节点媒体数据持久化",
         orig_sig="collectOversizedInlineImages(targetNodes)",
         module_sig="collectOversizedInlineImages(targetNodes, INLINE_MEDIA_MIGRATE_LIMIT)",
         wrapper="function collectOversizedInlineImages(targetNodes){ return window.SmartCanvasState.collectOversizedInlineImages(targetNodes, INLINE_MEDIA_MIGRATE_LIMIT); }"),

    dict(name="normalizeSmartImageMode", section="节点规范化与旧数据迁移",
         orig_sig="normalizeSmartImageMode(mode)", module_sig=None,
         wrapper="function normalizeSmartImageMode(mode){ return window.SmartCanvasState.normalizeSmartImageMode(mode); }"),
    dict(name="normalizeLegacySmartNode", section="节点规范化与旧数据迁移",
         orig_sig="normalizeLegacySmartNode(node)",
         module_sig=("normalizeLegacySmartNode(node, {tr, isEmptyGenBoard, isSmartVideoNode, "
                     "emptyGenBoardSizeFromAspect, EMPTY_GEN_NODE_WIDTH, mediaKindForItem})"),
         wrapper=("function normalizeLegacySmartNode(node){ return window.SmartCanvasState.normalizeLegacySmartNode(node, smartNodeMigrationDeps()); }"),
         insert_before=DEPS_HELPER),
    dict(name="clearSmartNodeTransientRunState", section="节点规范化与旧数据迁移",
         orig_sig="clearSmartNodeTransientRunState(node, options={})", module_sig=None,
         wrapper="function clearSmartNodeTransientRunState(node, options){ return window.SmartCanvasState.clearSmartNodeTransientRunState(node, options); }"),

    dict(name="serializableSmartNode", section="节点序列化与画布存储对象",
         orig_sig="serializableSmartNode(node)",
         module_sig="serializableSmartNode(node, deps)",
         wrapper="function serializableSmartNode(node){ return window.SmartCanvasState.serializableSmartNode(node, smartNodeMigrationDeps()); }",
         body_edits=[("normalizeLegacySmartNode(base)", "normalizeLegacySmartNode(base, deps)")]),
    dict(name="canvasForStorage", section="节点序列化与画布存储对象",
         orig_sig="canvasForStorage()",
         module_sig=("canvasForStorage(canvas, canvasDefaultSmartSettings, initialSmartSettings, "
                     "SMART_LOG_PREVIEW_NODE_ID)"),
         wrapper=("function canvasForStorage(){ return window.SmartCanvasState.canvasForStorage("
                  "canvas, canvasDefaultSmartSettings, initialSmartSettings, SMART_LOG_PREVIEW_NODE_ID); }")),

    dict(name="normalizeImportedSmartWorkflow", section="导入数据规范化",
         orig_sig="normalizeImportedSmartWorkflow(data)", module_sig=None,
         wrapper="function normalizeImportedSmartWorkflow(data){ return window.SmartCanvasState.normalizeImportedSmartWorkflow(data); }"),

    dict(name="pruneMediaItemForSnapshot", section="撤销快照的临时字段清理",
         orig_sig="pruneMediaItemForSnapshot(item)", module_sig=None,
         wrapper="function pruneMediaItemForSnapshot(item){ return window.SmartCanvasState.pruneMediaItemForSnapshot(item); }"),
    dict(name="pruneNodeForSnapshot", section="撤销快照的临时字段清理",
         orig_sig="pruneNodeForSnapshot(node)", module_sig=None,
         wrapper="function pruneNodeForSnapshot(node){ return window.SmartCanvasState.pruneNodeForSnapshot(node); }"),
]

# identifiers that must never be redeclared inside the module
FORBIDDEN_IN_MODULE = {
    "nodes", "canvas", "viewport", "settings", "world", "shell", "composer",
    "saveTimer", "currentDraftId", "canvasSyncInFlight", "canvasSyncDirty",
    "canvasPersistReady", "canvasTrustedAssetSig", "toast", "refreshIcons",
    "saveLocalDraft", "getDraftDB", "DRAFT_STORE_NAME", "smartLoopContext",
}

HEADER = """/**
 * canvas-state.js —— 智能画布数据契约层（画布拆分第 3 阶段）
 *
 * 只放「节点/画布数据 <-> 存储格式」之间的纯转换：设置克隆与清洗、媒体条目持久化、
 * 节点规范化与旧数据迁移、节点序列化、画布存储对象生成、导入数据规范化、
 * 撤销快照的临时字段清理。
 *
 * 三条硬约束：
 * 1. 本文件不持有任何画布状态。nodes / canvas / viewport / settings /
 *    EMPTY_GEN_NODE_WIDTH / SMART_LOG_PREVIEW_NODE_ID / INLINE_MEDIA_MIGRATE_LIMIT
 *    全部留在 smart-canvas.js，需要时由主文件的同名包装函数按引用注入，
 *    绝不复制第二份。注入参数与原全局同名，因此函数体逐字节保持原样。
 *    normalizeLegacySmartNode 额外注入 tr / isEmptyGenBoard / isSmartVideoNode /
 *    emptyGenBoardSizeFromAspect / mediaKindForItem（分属 i18n、布局层与 canvas-utils），
 *    由主文件的 smartNodeMigrationDeps() 统一提供。
 * 2. 不做任何 I/O：不 fetch、不碰 localStorage / indexedDB、不动 DOM。
 *    loadCanvas / saveCanvas / scheduleSave / saveLocalDraft 因此仍留在主文件。
 * 3. 加载顺序必须在 smart-canvas.js 之前。本文件解析期不读取主文件任何变量。
 *    注意主文件顶层有一处解析期调用：
 *      const initialSmartSettings = cloneSmartSettings(settings);
 *    所以本文件缺失会直接白屏，不能只靠运行期兜底。
 *
 * 对外只暴露 window.SmartCanvasState。
 */
(function attachSmartCanvasState(globalScope) {
"""

FOOTER = """
    globalScope.SmartCanvasState = {
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


def find_block(lines, start: int) -> int:
    first = lines[start].rstrip()
    if not first.endswith("{"):
        return start
    for j in range(start + 1, len(lines)):
        if lines[j] in ("}", "};"):
            return j
    raise SystemExit(f"FATAL: unterminated block at line {start + 1}")



def _guard_already_applied(text: str) -> None:
    """Refuse to run twice: the moved names are now delegating wrappers.

    Re-running would lift the generated wrapper bodies into canvas-state.js and
    destroy the real implementations, so stop instead.
    """
    hits = re.findall(r"\{ return window\.SmartCanvasState\.", text)
    if hits:
        raise SystemExit(
            f"FATAL: smart-canvas.js already delegates to window.SmartCanvasState "
            f"in {len(hits)} places - this transform has already been applied. "
            f"Restore the backup first if you meant to redo it.")


def main() -> int:
    raw = _read(SRC)
    assert "\r\n" not in raw, "unexpected CRLF"
    _guard_already_applied(raw)
    lines = raw.split("\n")

    located = []
    problems = []
    for spec in SPECS:
        name = spec["name"]
        sig = "function " + spec["orig_sig"]
        starts = [i for i, ln in enumerate(lines) if ln.startswith(sig)]
        if len(starts) != 1:
            problems.append(f"{name}: found {len(starts)} definitions matching {sig!r}")
            continue
        s = starts[0]
        e = find_block(lines, s)
        body_lines = lines[s:e + 1]
        first = body_lines[0]
        if not first.startswith("function " + name + "("):
            problems.append(f"{name}: unexpected first line {first[:70]!r}")
            continue
        # rewrite the signature on the first line, verbatim body otherwise
        new_first = first.replace("function " + spec["orig_sig"],
                                  "function " + (spec["module_sig"] or spec["orig_sig"]), 1)
        if new_first == first and spec["module_sig"]:
            problems.append(f"{name}: signature substitution had no effect")
            continue
        body_lines = [new_first] + body_lines[1:]
        for old, new in spec.get("body_edits", []):
            joined = "\n".join(body_lines)
            if joined.count(old) != 1:
                problems.append(f"{name}: body edit target {old!r} occurs {joined.count(old)} times")
                continue
            body_lines = (joined.replace(old, new, 1)).split("\n")
        located.append(dict(spec=spec, start=s, end=e, body="\n".join(body_lines),
                            original="\n".join(lines[s:e + 1])))

    if problems:
        print("=== ABORTING ===")
        for p in problems:
            print(" -", p)
        return 1

    # ---- module-level safety scan -----------------------------------------
    all_body = "\n".join(b["body"] for b in located)
    declared_in_module = set(re.findall(
        r"^(?:const|let|var|function|async function|class)\s+([A-Za-z_$][\w$]*)", all_body, re.M))
    leaked = declared_in_module & FORBIDDEN_IN_MODULE
    if leaked:
        print(f"=== ABORTING: module would redeclare main-file state: {sorted(leaked)}")
        return 1
    # any bare `window.`/`document.`/`fetch` usage means it is not a pure data layer
    for bad, why in (("fetch(", "network I/O"), ("localStorage", "browser storage"),
                     ("indexedDB", "browser storage"), ("document.", "DOM")):
        if bad in all_body:
            print(f"=== ABORTING: moved code contains {bad!r} ({why})")
            return 1

    # ---- build canvas-state.js --------------------------------------------
    sections = []
    for b in located:
        if b["spec"]["section"] not in sections:
            sections.append(b["spec"]["section"])
    out = [HEADER.rstrip("\n")]
    for sec in sections:
        out.append("")
        out.append(f"    // ===== {sec} =====")
        for b in located:
            if b["spec"]["section"] != sec:
                continue
            for bl in b["body"].split("\n"):
                out.append(("    " + bl) if bl.strip() else "")
    names = [b["spec"]["name"] for b in located]
    exports = ",\n".join(f"        {n}: {n}" for n in names)
    out.append(FOOTER % exports)
    state_text = "\n".join(out).rstrip("\n") + "\n"

    # ---- rewrite smart-canvas.js ------------------------------------------
    edits = []
    for b in located:
        spec = b["spec"]
        repl = []
        if spec.get("insert_before"):
            repl.extend(spec["insert_before"].split("\n"))
        repl.append(spec["wrapper"])
        edits.append((b["start"], b["end"], repl))
    edits.sort(key=lambda e: e[0], reverse=True)
    new_lines = list(lines)
    for s, e, repl in edits:
        new_lines[s:e + 1] = repl
    new_src = "\n".join(new_lines)

    print(f"smart-canvas.js: {len(lines)} -> {len(new_lines)} lines ({len(new_lines) - len(lines):+d})")
    print(f"canvas-state.js: {len(state_text.splitlines())} lines, {len(names)} functions")
    print("moved:", ", ".join(names))

    if not APPLY:
        _write(PREVIEW_DIR / "_p3_canvas-state.js", state_text)
        _write(PREVIEW_DIR / "_p3_smart-canvas.js", new_src)
        print("\nDRY RUN - previews at scripts/_p3_canvas-state.js and scripts/_p3_smart-canvas.js")
        return 0

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    _write(OUT, state_text)
    _write(SRC, new_src)
    print(f"\nAPPLIED: wrote {OUT.relative_to(ROOT)} and {SRC.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
