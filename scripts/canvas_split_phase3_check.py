# -*- coding: utf-8 -*-
"""Verification for the canvas data-contract split (phases 3 and 3.5).

Gates (letters match the printed output)
  A  global-access trap. canvas-utils.js + canvas-state.js are loaded on their
     own; any global the module reaches for must be one of the explicitly
     injected deps. Ideally none, and that is what is asserted.
  B  old-vs-new equivalence on REAL canvas data. data/canvases/*.json are opened
     strictly read-only; every node found there, plus hand-written edge cases and
     the seeded shapes that expose the save-time vs load-time contract divergence,
     is pushed through the pre-split implementation and through the new module.
     Both the return value and the post-call state of the argument are compared,
     because most of these functions mutate their argument in place.
  C  lossless reconstruction. Substituting every generated wrapper, cutting the
     injected-deps helper and splicing saveCanvas' original inline loop back in
     must reproduce the phase-3 backup byte-for-byte.
  D  static consistency: exports vs wrappers, load order, duplicate definitions,
     redeclared state, window public interface, no new top-level globals.
  E  parse-time / TDZ hazard: no wrapper may run at top level before the const it
     depends on is initialised.

The two sandboxes mirror the real page: both load canvas-utils.js and both get
the same helper blocks that deliberately stay in smart-canvas.js. The new side
additionally loads canvas-state.js and the *actual* wrapper lines taken from the
post-split smart-canvas.js, so the wrappers themselves are under test.

Writes nothing under data/, assets/, output/, workflows/ or runtime_core/.
"""
from __future__ import annotations

import collections
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def _flag(name: str):
    """Optional path override so a later phase can vet a generated preview."""
    for i, a in enumerate(sys.argv):
        if a == name and i + 1 < len(sys.argv):
            return Path(sys.argv[i + 1]).resolve()
        if a.startswith(name + "="):
            return Path(a.split("=", 1)[1]).resolve()
    return None


BACKUP = _flag("--backup") or Path(r"D:/压缩包/canvas_split_phase3_backup_2026-09-19/smart-canvas.js")
MAIN = _flag("--main") or (ROOT / "static" / "canvas" / "js" / "smart-canvas.js")
STATE = _flag("--state") or (ROOT / "static" / "canvas" / "js" / "modules" / "canvas-state.js")
UTILS = ROOT / "static" / "canvas" / "js" / "modules" / "canvas-utils.js"
HTML = ROOT / "static" / "smart-canvas.html"
DATA = ROOT / "data" / "canvases"
TMP = Path(tempfile.gettempdir()) / "xxpd_canvas_split_p3check"  # fixtures stay out of the repo
HARNESS = ROOT / "scripts" / "canvas_split_phase3_harness.js"

# the 18 functions lifted out of smart-canvas.js during phase 3
MOVED = [
    "cloneSmartSettings", "settingsForStorage", "stripOutpaintDisplaySettings",
    "mediaItemForStorage", "stripImageGenerationMeta", "applyNodeMetaToImage",
    "inheritNodeMetaFromImage", "mergeSmartImageLists", "countCanvasMediaItems",
    "collectOversizedInlineImages", "normalizeSmartImageMode",
    "normalizeLegacySmartNode", "clearSmartNodeTransientRunState",
    "serializableSmartNode", "canvasForStorage", "normalizeImportedSmartWorkflow",
    "pruneMediaItemForSnapshot", "pruneNodeForSnapshot",
]
# phase 3.5: saveCanvas' inline contract loop, lifted verbatim into the module.
# It has no counterpart in the phase-3 backup as a *function* -- there it is an
# inline forEach inside saveCanvas -- so it is tracked separately.
SAVE_LOOP = "normalizeSmartNodesForSave"
# every name canvas-state.js must export
EXPECTED = MOVED + [SAVE_LOOP]

# blocks that stay in smart-canvas.js but are needed to run the moved code
HELPERS = [
    ("tr", "fn"), ("isSmartUploadNode", "fn"), ("isSmartVideoNode", "fn"),
    ("isSmartImageGenNode", "fn"), ("isEmptyGenBoard", "fn"),
    ("emptyGenBoardSizeFromAspect", "fn"),
    ("STANDARD_ASPECT_RATIO_PRESETS", "const"), ("EMPTY_GEN_NODE_WIDTH", "const"),
    ("SMART_LOG_PREVIEW_NODE_ID", "const"), ("INLINE_MEDIA_MIGRATE_LIMIT", "const"),
]
DEPS_KEYS = ["tr", "isEmptyGenBoard", "isSmartVideoNode",
             "emptyGenBoardSizeFromAspect", "EMPTY_GEN_NODE_WIDTH", "mediaKindForItem"]
HELPER_BLOCK_START = "// normalizeLegacySmartNode / serializableSmartNode"

NODE_CAP = 400   # real nodes per fixture family (even-sampled when larger)
BIG_KEEP = 8     # how many oversized data: URLs to keep verbatim


# --- copied verbatim from canvas_split_phase2.py so this file stands alone ---
REGEX_PREV_CHARS = set("(,=:[!&|?{};+-*%^~<>")
REGEX_PREV_WORDS = {
    "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
    "case", "do", "else", "yield", "await", "throw",
}


def _last_word(text: str) -> str:
    j = len(text)
    while j > 0 and (text[j - 1].isalnum() or text[j - 1] in "_$"):
        j -= 1
    return text[j:]


def strip_noise(text: str) -> str:
    """Blank out strings / template literals / comments / regex literals."""
    out = []
    i = 0
    n = len(text)
    prev = ""
    while i < n:
        c = text[i]
        if c == "/" and text[i + 1:i + 2] == "/":
            j = text.find("\n", i)
            j = n if j < 0 else j
            out.append(" " * (j - i))
            i = j
            continue
        if c == "/" and text[i + 1:i + 2] == "*":
            j = text.find("*/", i + 2)
            j = n if j < 0 else j + 2
            chunk = text[i:j]
            out.append("".join(ch if ch == "\n" else " " for ch in chunk))
            i = j
            continue
        if c in "\"'`":
            quote = c
            out.append(" ")
            i += 1
            while i < n:
                ch = text[i]
                if ch == "\\":
                    nxt = text[i + 1:i + 2]
                    out.append("  " if nxt != "\n" else " \n")
                    i += 2
                    continue
                if ch == quote:
                    out.append(" ")
                    i += 1
                    break
                out.append("\n" if ch == "\n" else " ")
                i += 1
            prev = quote
            continue
        if c == "/":
            starts_regex = (not prev) or (prev[-1] in REGEX_PREV_CHARS) or (_last_word(prev) in REGEX_PREV_WORDS)
            if starts_regex:
                j = i + 1
                in_class = False
                closed = False
                while j < n:
                    ch = text[j]
                    if ch == "\\":
                        j += 2
                        continue
                    if ch == "\n":
                        break
                    if ch == "[":
                        in_class = True
                    elif ch == "]":
                        in_class = False
                    elif ch == "/" and not in_class:
                        j += 1
                        while j < n and text[j].isalpha():
                            j += 1
                        closed = True
                        break
                    j += 1
                if closed:
                    out.append(" " * (j - i))
                    i = j
                    prev = "/"
                    continue
        if not c.isspace():
            prev = (prev + c)[-32:]
        out.append(c)
        i += 1
    return "".join(out)


def read(p: Path) -> str:
    with open(p, "r", encoding="utf-8", newline="") as fh:
        return fh.read()


def write(p: Path, text: str) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)


def bal(line: str) -> int:
    c = strip_noise(line)
    return sum(c.count(x) for x in "{[(") - sum(c.count(x) for x in "}])")


def find_block_end(lines, start: int) -> int:
    depth = 0
    for j in range(start, min(len(lines), start + 4000)):
        depth += bal(lines[j])
        if depth == 0:
            return j
    raise SystemExit(f"FATAL: unterminated block at line {start + 1}: {lines[start][:70]}")


def extract(lines, name: str, kind: str) -> str:
    prefixes = {
        "fn": (f"function {name}(", f"async function {name}("),
        "const": (f"const {name} =", f"const {name}="),
        "let": (f"let {name} =", f"let {name}="),
    }[kind]
    starts = [i for i, ln in enumerate(lines) if ln.startswith(prefixes)]
    if not starts:
        raise SystemExit(f"FATAL: {name} ({kind}) not found")
    s = starts[0]
    return "\n".join(lines[s:find_block_end(lines, s) + 1])


def phase2_alias_shim() -> str:
    """Recreate the 52 window wrappers that the phase-2 split relies on."""
    utils = read(UTILS)
    names = re.findall(r"^\s{8}([A-Za-z_$][\w$]*): \1,?$", utils, re.M)
    body = [f"var {n} = SmartCanvasUtils.{n};" for n in names]
    return "\n".join(body)


def wrappers_from_main(main_txt: str) -> str:
    out = []
    for name in EXPECTED:
        pat = (r"^(?:async )?function " + re.escape(name) +
               r"\([^)]*\)\{ return window\.SmartCanvasState\." + re.escape(name) + r"\(.*\); \}$")
        m = re.search(pat, main_txt, re.M)
        if not m:
            raise SystemExit(f"FATAL: wrapper for {name} not found in smart-canvas.js")
        out.append(m.group(0).replace("window.SmartCanvasState.", "SmartCanvasState."))
    return "\n".join(out)


# --------------------------------------------------------------- fixtures ---
def load_real_nodes():
    """Read-only scan of data/canvases/*.json."""
    nodes, canvases = [], []
    files = sorted(DATA.glob("*.json"))
    for p in files:
        try:
            doc = json.loads(read(p))
        except Exception as e:
            print(f"  (skip {p.name}: {type(e).__name__})")
            continue
        canvas = doc.get("canvas") if isinstance(doc, dict) and "canvas" in doc else doc
        if not isinstance(canvas, dict):
            continue
        canvases.append(canvas)
        ns = canvas.get("nodes")
        if isinstance(ns, list):
            nodes.extend([n for n in ns if isinstance(n, dict)])
    print(f"  real data: {len(files)} files, {len(nodes)} nodes, {len(canvases)} canvases")
    return nodes, canvases


SYNTH_NODES = [
    None, {}, [], "str", 0,
    {"id": "n1"},
    {"id": "n2", "type": "smart-upload"},
    {"id": "n3", "nodeKind": "upload"},
    {"id": "n4", "title": "上传"},
    {"id": "n5", "title": "素材上传"},
    {"id": "n6", "title": "Upload"},
    {"id": "n7", "type": "smart-container"},
    {"id": "n8", "type": "smart-container",
     "inputImage": {"url": "/output/a.png", "name": "a.png", "natural_w": 800, "natural_h": 600}},
    {"id": "n9", "type": "smart-container",
     "images": [{"url": "/output/a.png"}, {"url": "/output/b.png"}]},
    {"id": "n10", "type": "smart-container", "inputImage": {"url": "data:image/png;base64,AAAA"}},
    {"id": "n11", "gridSplitGroup": True, "images": [{"url": "/x.png"}]},
    {"id": "n12", "gridSplitChild": True, "images": [{"url": "/x.png"}]},
    {"id": "n13", "gridSplitGroup": True, "gridSplitVersion": 3},
    {"id": "n14", "isCroppedVideo": True,
     "images": [{"url": "/output/v.mp4", "trimIn": 1.234, "trimOut": 5.678}]},
    {"id": "n15", "videoCropVersion": 2, "trimIn": 0, "trimOut": 9},
    {"id": "n16", "images": [{"url": "/output/v.mp4", "trimIn": 2, "trimOut": 1}]},
    {"id": "n17", "type": "smart-image", "imageMode": "multimodal"},
    {"id": "n18", "type": "smart-image", "imageMode": "bogus"},
    {"id": "n19", "type": "smart-image", "historyFor": "abc"},
    {"id": "n20", "type": "smart-image", "images": [{"url": "/output/v.mp4"}]},
    {"id": "n21", "type": "smart-image", "images": [{"url": "/output/a.png"}], "w": 340, "h": 220},
    {"id": "n22", "type": "smart-image", "images": [{"url": "/output/a.png"}], "w": 500, "h": 400},
    {"id": "n23", "type": "smart-video", "genKind": "video", "params": {"videoAspect": "9:16"}},
    {"id": "n24", "type": "smart-image", "params": {"ratio": "21:9"}},
    {"id": "n25", "type": "smart-image", "params": {"imageRatio": "custom"}},
    {"id": "n26", "type": "smart-image", "params": {}, "w": 50, "h": 900},
    {"id": "n27", "type": "smart-minimax", "timelinePlaying": True},
    {"id": "__smart_log_preview__", "images": [{"url": "/x.png"}]},
    {"id": "n28", "running": True, "pending": 3, "queued": True, "pendingTasks": [1],
     "_runMetaTargetId": "x", "_dom": {}, "runStartedAt": 1, "runFinishedAt": 2,
     "runElapsedMs": 3, "runTimerHidden": True},
    {"id": "n29", "images": [{
        "url": "data:image/png;base64," + "A" * 40000, "runPrompt": "p", "cloudUrl": "c",
        "uploadedUrl": "u", "originalRemoteUrl": "o", "tempCloudUrl": "t",
        "_inlineVideoActive": True, "promptDraftHtml": "<b>", "runModelPrompt": "m",
        "runSettings": {"a": 1}, "sourceNodeId": "s", "runAt": 5,
        "promptDraftText": "t", "kind": "image"}]},
    {"id": "n30", "inputImage": {"url": "data:image/png;base64," + "B" * 40000}},
    {"id": "n31", "segments": [
        {"refItems": [{"url": "/a.png", "_x": 1}],
         "results": [{"url": "/b.png", "cloudUrl": "c"}],
         "result": {"url": "/c.png", "_temp": 1}, "_temp": 2}],
     "materials": [{"url": "/m.png", "_p": 1}], "pendingTasks": [1, 2],
     "runningTasks": [3], "images": [{"url": "/i.png", "kind": "image"}]},
    {"id": "n32", "runSettings": {
        "videoTempShLinks": [{"manual": True}, {"manual": False}, {}],
        "outpaintResolutionLocked": True}},
    {"id": "n33", "images": "not-an-array"},
    {"id": "n34", "images": [None, {"url": ""}, {"src": "/s.png"}]},
    {"id": "n35", "type": "smart-video", "isHistoryGroup": True,
     "images": [{"url": "/v.mp4", "kind": "video"}], "w": 800, "h": 600},
    {"id": "n36", "type": "smart-image", "params": {"ratio": "1:1"}, "w": 340, "h": 220},
    {"id": "n37", "type": "smart-image", "images": [{"url": "/a.png"}], "gridSplitChild": True},
    {"id": "n38", "images": [{"url": "/a.png"}, {"url": "/b.png"}], "type": "smart-image",
     "w": 700, "h": 500},
]

BIG_DATA = "data:image/png;base64," + "A" * 40000
SYNTH_IMAGES = [
    None, {}, "str",
    {"url": "/output/a.png"},
    {"url": BIG_DATA, "runPrompt": "p", "cloudUrl": "c", "uploadedUrl": "u",
     "originalRemoteUrl": "o", "tempCloudUrl": "t", "_inlineVideoActive": True,
     "promptDraftHtml": "<b>", "promptDraftText": "t", "runModelPrompt": "m",
     "runSettings": {"a": 1}, "sourceNodeId": "s", "runAt": 5, "kind": "image"},
    {"url": "/output/v.mp4", "kind": "video", "trimIn": 1.234, "trimOut": 5.678,
     "duration": 4.444},
    {"url": BIG_DATA, "name": "keep-me"},
    {"_dom": {}, "url": "/x.png"},
]

SYNTH_SETTINGS = [
    None, {}, "s", 7, [],
    {"videoTempShLinks": [{"manual": True}, {"manual": False}, {}]},
    {"videoTempShLinks": None},
    {"videoTempShLinks": []},
    {"outpaintResolutionLocked": True, "ratio": "1:1"},
    {"a": 1, "b": {"c": [1, 2, {"d": None}]}},
    {"_dom": {}, "model": "x"},
]

SYNTH_MODES = [None, {}, [], "str", 0, "", "omni", "character", "style",
               "text_only", "multimodal", "bogus", 3.5]

SYNTH_IMPORTED = [
    None, {}, [], [{"id": "a"}],
    {"nodes": [{"id": "a"}], "connections": [{"from": "a", "to": "b"}]},
    {"nodes": "nope"}, {"workflow": {"nodes": [{"id": "w"}], "connections": 5}},
    {"workflow": {}}, {"nodes": [{"id": "a"}], "connections": None},
    [{"id": "x"}, {"id": "y"}],
]

SYNTH_PAIRS = [
    [[{"url": "/a.png"}], [{"url": "/a.png"}, {"url": "/b.mp4"}]],
    [[], [{"url": "/x"}]], [None, None],
    [[{"noUrl": 1}, {"noUrl": 2}], [{"url": "/y"}]],
    [[{"url": ""}], [{"url": ""}]],
    [[{"url": "a"}, {"url": "a"}], [{"url": "a"}]],
]

SYNTH_PRUNES = [
    {"a": 1, "_b": 2, "cloudUrl": "c", "tempCloudUrl": "t", "uploadedUrl": "u",
     "originalRemoteUrl": "o", "big": "data:" + "z" * 40000, "url": "data:" + "z" * 40000},
    {"_x": 1}, None, "s", 3, {}, {"url": "/a.png", "kind": "image"},
]

# One node per divergence class between saveCanvas' loop and normalizeLegacySmartNode,
# so the lifted loop is exercised on exactly the shapes where the two policies differ.
SAVE_LOOP_SEEDS = [
    # 1. no `type` at all -- normalize would stamp 'smart-image', the loop must not
    {"id": "d1"},
    # 2. cropped video with an inverted trim range -- only the loop clamps tOut=tIn+10
    {"id": "d2", "isCroppedVideo": True, "trimIn": 5, "trimOut": 2,
     "images": [{"url": "/output/v.mp4"}]},
    # 2b. same, but non-finite / missing bounds
    {"id": "d2b", "isCroppedVideo": True, "images": [{"url": "/output/v.mp4"}]},
    {"id": "d2c", "isCroppedVideo": True, "trimIn": "abc", "trimOut": None,
     "images": [{"url": "/output/v.mp4"}, {"url": "/output/w.mp4"}]},
    # 2c. crop markers that the loop ignores (no isCroppedVideo) but normalize honours
    {"id": "d2d", "videoCropVersion": 1, "images": [{"url": "/v.mp4", "trimIn": 1, "trimOut": 9}]},
    {"id": "d2e", "images": [{"url": "/v.mp4", "trimIn": 3, "trimOut": 7}]},
    # 3. empty generation board sized 340x220 -- normalize resizes and recentres x/y
    {"id": "d3", "type": "smart-image", "params": {"ratio": "1:1"}, "w": 340, "h": 220},
    {"id": "d3b", "type": "smart-video", "params": {"videoAspect": "9:16"}, "w": 20, "h": 10},
    {"id": "d3c", "type": "smart-image", "params": {"ratio": "custom"}, "w": 50, "h": 900,
     "x": 12.5, "y": -7.5},
    # 4. cropped video with several images -- the loop stamps trim on every image
    {"id": "d4", "isCroppedVideo": True, "trimIn": 1, "trimOut": 4.5,
     "images": [{"url": "/a.mp4"}, {"url": "/b.mp4"}, {"url": "/c.mp4"}]},
    # 5. single-image node -- normalize deletes w/h, the loop must keep them
    {"id": "d5", "type": "smart-image", "images": [{"url": "/a.png"}], "w": 500, "h": 400},
    {"id": "d5b", "type": "smart-upload", "nodeKind": "upload",
     "images": [{"url": "/a.png"}], "w": 280, "h": 76},
    # persistence fields the loop rewrites in place
    {"id": "d6", "type": "smart-image", "images": [{
        "url": "/a.png", "cloudUrl": "c", "uploadedUrl": "u", "originalRemoteUrl": "o",
        "tempCloudUrl": "t", "_inlineVideoActive": True, "runPrompt": "p",
        "runModelPrompt": "m", "runSettings": {"x": 1}, "sourceNodeId": "s", "runAt": 9,
        "promptDraftHtml": "h", "promptDraftText": "t"}],
     "runSettings": {"model": "gpt-image-2",
                     "videoTempShLinks": [{"manual": True}, {"manual": False}]}},
    {"id": "d7"},
]


def save_loop_arrays(real_nodes):
    """Lists of nodes, as saveCanvas hands them to the loop."""
    budget = [BIG_KEEP]
    out = []
    step = max(1, len(real_nodes) // 40)
    for i in range(0, len(real_nodes), step):
        chunk = [_shrink(json.loads(json.dumps(n, ensure_ascii=False)), budget)
                 for n in real_nodes[i:i + step]]
        out.append(chunk)
    seeds = [_shrink(json.loads(json.dumps(s, ensure_ascii=False)), [BIG_KEEP])
             for s in SAVE_LOOP_SEEDS]
    out.append(seeds)
    for s in seeds:                       # each seed also alone, no cross-talk
        out.append([s])
    out.append([])
    return out


def _shrink(obj, budget):
    """Keep fixture volume sane: truncate long data: URLs (budget is a 1-item list)."""
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if isinstance(v, str) and v.startswith("data:") and len(v) > 64:
                if budget[0] > 0:
                    budget[0] -= 1
                    out[k] = v
                else:
                    out[k] = v[:40] + "...shrunk"
            else:
                out[k] = _shrink(v, budget)
        return out
    if isinstance(obj, list):
        return [_shrink(x, budget) for x in obj]
    return obj


def node_fixtures(real_nodes):
    nodes = real_nodes[:NODE_CAP] if len(real_nodes) > NODE_CAP else real_nodes
    if len(real_nodes) > NODE_CAP:
        step = len(real_nodes) / NODE_CAP
        nodes = [real_nodes[int(i * step)] for i in range(NODE_CAP)]
        print(f"  (real nodes even-sampled {len(real_nodes)} -> {NODE_CAP})")
    budget = [BIG_KEEP]
    out = [_shrink(json.loads(json.dumps(n, ensure_ascii=False)), budget) for n in nodes]
    out += SYNTH_NODES
    return out


def image_fixtures(real_nodes):
    out = []
    for n in real_nodes[:NODE_CAP]:
        for img in (n.get("images") or []):
            if isinstance(img, dict):
                out.append(json.loads(json.dumps(img, ensure_ascii=False)))
    out += SYNTH_IMAGES
    budget = [BIG_KEEP]
    return [_shrink(x, budget) for x in out]


def settings_fixtures(real_canvases, real_nodes):
    out = []
    for c in real_canvases:
        st = c.get("settings")
        if isinstance(st, dict):
            out.append(json.loads(json.dumps(st, ensure_ascii=False)))
    for n in real_nodes[:NODE_CAP]:
        rs = n.get("runSettings")
        if isinstance(rs, dict):
            out.append(json.loads(json.dumps(rs, ensure_ascii=False)))
    out += SYNTH_SETTINGS
    budget = [BIG_KEEP]
    return [_shrink(x, budget) for x in out]


# ------------------------------------------------------------------ gates ---
def backup_inline_loop() -> list[str]:
    """Recover saveCanvas' inline contract loop from the phase-3 backup.

    Deliberately located here independently of canvas_split_phase3_5.py: sharing
    the anchor logic would let one wrong assumption satisfy both the transform
    and its own verification.
    """
    lines = read(BACKUP).split("\n")
    head = "async function saveCanvas(options = {}){"
    if sum(1 for ln in lines if ln == head) != 1:
        raise SystemExit("FAIL: saveCanvas header not unique in the backup")
    s = next(i for i, ln in enumerate(lines) if ln == head)
    d, fn_end = 0, None
    for j in range(s, len(lines)):
        d += lines[j].count("{") - lines[j].count("}")
        if d == 0 and j > s:
            fn_end = j
            break
    heads = [i for i in range(s, fn_end + 1) if lines[i] == "        nodes.forEach(node => {"]
    if len(heads) != 1:
        raise SystemExit(f"FAIL: expected 1 inline forEach in backup saveCanvas, got {len(heads)}")
    st = heads[0]
    if lines[st - 1].strip() != "savePromptDraftForCurrent();":
        raise SystemExit("FAIL: backup inline loop is not where it should be")
    d, en = 0, None
    for j in range(st, fn_end + 1):
        d += lines[j].count("{") - lines[j].count("}")
        if d == 0 and j > st:
            en = j
            break
    if en is None:
        raise SystemExit("FAIL: unterminated backup inline loop")
    return lines[st:en + 1]


def gate_c() -> None:
    print("\nC. lossless reconstruction")
    backup = read(BACKUP).split("\n")
    new = read(MAIN).split("\n")
    inline_loop = backup_inline_loop()
    rebuilt, replaced, helper_lines, i = [], 0, 0, 0
    save_wrapper_cut = call_site_cut = 0
    wrapper_re = re.compile(
        r"^function ([A-Za-z_$][\w$]*)\([^)]*\)\{ return window\.SmartCanvasState\.\1\(")
    while i < len(new):
        line = new[i]
        m = wrapper_re.match(line)
        if m and m.group(1) in MOVED:
            rebuilt.extend(extract(backup, m.group(1), "fn").split("\n"))
            replaced += 1
            i += 1
            continue
        # phase 3.5: the wrapper for the lifted loop has no backup counterpart
        if m and m.group(1) == SAVE_LOOP:
            save_wrapper_cut += 1
            i += 1
            continue
        # ...nor does its call site: splice the original inline block back in
        if line.strip() == f"{SAVE_LOOP}(nodes);":
            rebuilt.extend(inline_loop)
            call_site_cut += 1
            i += 1
            continue
        if line.startswith(HELPER_BLOCK_START):
            j = i
            while j < len(new) and new[j] != "}":
                j += 1
            helper_lines = j - i + 1
            i = j + 1
            continue
        rebuilt.append(line)
        i += 1
    print(f"   wrappers substituted back : {replaced} (expected {len(MOVED)})")
    print(f"   injected-helper lines cut : {helper_lines}")
    print(f"   save-loop wrapper / call  : {save_wrapper_cut} / {call_site_cut}")
    if replaced != len(MOVED) or not helper_lines:
        raise SystemExit("FAIL: not every wrapper / the helper were accounted for")
    if save_wrapper_cut != 1 or call_site_cut != 1:
        raise SystemExit("FAIL: the phase-3.5 wrapper or its call site was not found "
                         f"({save_wrapper_cut}/{call_site_cut}, expected 1/1)")
    if rebuilt == backup:
        print("   result                    : IDENTICAL to backup -> PASS")
        return
    print("   result                    : DIFFERS -> FAIL")
    for k in range(max(len(rebuilt), len(backup))):
        a = rebuilt[k] if k < len(rebuilt) else "<EOF>"
        b = backup[k] if k < len(backup) else "<EOF>"
        if a != b:
            print(f"     first divergence at line {k + 1}")
            print(f"       rebuilt: {a[:150]!r}")
            print(f"       backup : {b[:150]!r}")
            break
    print(f"     length rebuilt={len(rebuilt)} backup={len(backup)}")
    raise SystemExit(1)


def gate_d() -> None:
    print("\nD. static consistency")
    main_txt, state_txt, backup_txt = read(MAIN), read(STATE), read(BACKUP)
    failed = []

    exported = re.findall(r"^\s{8}([A-Za-z_$][\w$]*): \1,?$", state_txt, re.M)
    print(f"   SmartCanvasState exports  : {len(exported)} (expected {len(EXPECTED)})")
    if sorted(exported) != sorted(EXPECTED):
        failed.append(f"export mismatch extra={sorted(set(exported) - set(EXPECTED))} "
                      f"missing={sorted(set(EXPECTED) - set(exported))}")

    bad = []
    for name in exported:
        defs = re.findall(r"^(?:async )?function " + re.escape(name) + r"\(.*$", main_txt, re.M)
        if len(defs) != 1:
            bad.append(f"{name}: {len(defs)} top-level defs in smart-canvas.js")
        elif "window.SmartCanvasState." + name not in defs[0]:
            bad.append(f"{name}: not a wrapper -> {defs[0][:80]}")
        mdefs = re.findall(r"^    (?:async )?function " + re.escape(name) + r"\(", state_txt, re.M)
        if len(mdefs) != 1:
            bad.append(f"{name}: {len(mdefs)} defs in canvas-state.js")
    orphan = [w for w in re.findall(
        r"^function ([A-Za-z_$][\w$]*)\([^)]*\)\{ return window\.SmartCanvasState\.", main_txt, re.M)
        if w not in exported]
    if bad or orphan:
        failed.append(f"wrapper/definition: {bad} orphan={orphan}")
    print(f"   wrapper<->definition      : {'OK' if not (bad or orphan) else 'see failures'}")

    top = re.findall(r"^(?:const|let|var|function|async function|class)\s+([A-Za-z_$][\w$]*)",
                     state_txt, re.M)
    print(f"   module top-level globals  : {top or '[]'} (must be empty)")
    if top:
        failed.append("canvas-state.js declares top-level globals")

    mstate = re.findall(r"^    (?:const|let|var)\s+([A-Za-z_$][\w$]*)", state_txt, re.M)
    print(f"   module-level state vars   : {mstate or '[]'} (must be empty)")
    if mstate:
        failed.append(f"canvas-state.js holds its own state: {mstate}")

    names_new = re.findall(r"^(?:async )?function ([A-Za-z_$][\w$]*)\(", main_txt, re.M)
    dups = {k: v for k, v in collections.Counter(names_new).items() if v > 1}
    names_old = re.findall(r"^(?:async )?function ([A-Za-z_$][\w$]*)\(", backup_txt, re.M)
    print(f"   duplicate fn names now    : {dups or 'none'}")
    if dups:
        failed.append(f"duplicate top-level function names: {dups}")

    lost = sorted(set(names_old) - set(names_new))
    gained = sorted(set(names_new) - set(names_old))
    print(f"   top-level fns lost        : {lost or 'none'}")
    print(f"   top-level fns added       : {gained or 'none'}")
    if lost:
        failed.append(f"top-level functions disappeared: {lost}")

    wb = sorted(set(re.findall(r"^window\.([A-Za-z_$][\w$]*)\s*=", backup_txt, re.M)))
    wa = sorted(set(re.findall(r"^window\.([A-Za-z_$][\w$]*)\s*=", main_txt, re.M)))
    print(f"   window.* assignments same : {wb == wa} ({len(wa)} entries)")
    if wb != wa:
        failed.append(f"window.* changed lost={sorted(set(wb) - set(wa))} "
                      f"gained={sorted(set(wa) - set(wb))}")

    refs = set(re.findall(r"window\.SmartCanvasState\.([A-Za-z_$][\w$]*)", main_txt))
    missing = sorted(refs - set(exported))
    print(f"   SmartCanvasState.* refs   : {len(refs)} unresolved={missing or 'none'}")
    if missing:
        failed.append(f"unresolved SmartCanvasState refs: {missing}")

    u_refs = set(re.findall(r"window\.SmartCanvasUtils\.([A-Za-z_$][\w$]*)", main_txt))
    u_names = set(re.findall(r"^\s{8}([A-Za-z_$][\w$]*): \1,?$", read(UTILS), re.M))
    print(f"   SmartCanvasUtils.* refs   : {len(u_refs)} unresolved={sorted(u_refs - u_names) or 'none'}")
    if u_refs - u_names:
        failed.append("phase-2 exports regressed")

    seq = [m.group(1) for m in re.finditer(r'<script src="([^"]+)"', read(HTML))]
    iu = next((i for i, u in enumerate(seq) if "canvas-utils.js" in u), None)
    ist = next((i for i, u in enumerate(seq) if "canvas-state.js" in u), None)
    im = next((i for i, u in enumerate(seq) if "smart-canvas.js" in u), None)
    print(f"   load order utils/state/main: {iu} / {ist} / {im}")
    if ist is None or im is None or ist > im:
        failed.append("canvas-state.js must load before smart-canvas.js")
    for u in seq:
        print(f"      {u}")

    if failed:
        print("   GATE D FAILURES:")
        for f in failed:
            print("     -", f)
        raise SystemExit(1)
    print("   gate D                    : PASS")


# ---------------------------------------------------------------- gate E -----
# Every wrapper below reads a const declared much further down smart-canvas.js.
# If such a wrapper ever ran while the file itself was being evaluated, the read
# would hit the temporal dead zone and the page would go blank with no console
# error -- the exact failure mode this project has already been burned by once.
# This gate walks the file with a brace tracker and proves none of them do.
LATE_CONST_DEPS = {
    "normalizeLegacySmartNode": ("EMPTY_GEN_NODE_WIDTH",),
    "serializableSmartNode": ("EMPTY_GEN_NODE_WIDTH",),
    "collectOversizedInlineImages": ("INLINE_MEDIA_MIGRATE_LIMIT",),
    "canvasForStorage": ("SMART_LOG_PREVIEW_NODE_ID",),
}


def _brace_depths(clean_lines):
    depths, d = [], 0
    for c in clean_lines:
        depths.append(d)
        d = max(0, d + c.count("{") - c.count("}"))
    return depths


def _parse_time_ranges(clean_lines, lines, depths):
    """Ranges of depth-0 blocks whose bodies run during evaluation.

    Blocks opened by a function/arrow literal are excluded: they only register a
    callback, and the body runs later. Plain `if {` / `try {` / `for {` blocks do
    run immediately, so they count.
    """
    out = []
    for i, c in enumerate(clean_lines):
        if depths[i] != 0 or "{" not in c:
            continue
        head = lines[i].strip()
        if head.startswith(("function ", "async function ", "class ")):
            continue
        if "function" in c or "=>" in c:
            continue
        d = 0
        for j in range(i, len(clean_lines)):
            d += clean_lines[j].count("{") - clean_lines[j].count("}")
            if d == 0 and j > i:
                out.append((i + 1, j + 1))
                break
    return out


def gate_e() -> None:
    print("\nE. parse-time call / TDZ hazard")
    raw = read(MAIN)
    lines = raw.split("\n")
    clean = strip_noise(raw).split("\n")
    if len(clean) != len(lines):
        raise SystemExit("FAIL: strip_noise changed the line count")
    depths = _brace_depths(clean)

    const_line = {}
    for consts in LATE_CONST_DEPS.values():
        for n in consts:
            hit = [i for i, ln in enumerate(lines)
                   if re.match(r"^(?:const|let|var)\s+" + re.escape(n) + r"\s*=", ln)]
            if not hit:
                raise SystemExit(f"FAIL: {n} is not a top-level declaration")
            const_line[n] = hit[0] + 1
    print("   guarded consts             : "
          + ", ".join(f"{k}@{v}" for k, v in sorted(const_line.items())))

    ranges = _parse_time_ranges(clean, lines, depths)
    total = sum(b - a + 1 for a, b in ranges)
    print(f"   parse-time block ranges   : {len(ranges)} ({total} lines)")

    hits = []
    for fn, consts in LATE_CONST_DEPS.items():
        call_re = re.compile(r"(?<![.\w])" + re.escape(fn) + r"\s*\(")
        for i, c in enumerate(clean):
            if not call_re.search(c):
                continue
            ln = i + 1
            if lines[i].strip().startswith("function " + fn):
                continue                                    # the wrapper itself
            if depths[i] != 0 and not any(a <= ln <= b for a, b in ranges):
                continue                                    # inside a real function
            for cname in consts:
                if ln < const_line[cname]:
                    hits.append((ln, fn, cname))
    if hits:
        print("   GATE E FAILURES:")
        for ln, fn, cname in sorted(set(hits)):
            print(f"     - line {ln}: parse-time call to {fn}() before {cname} "
                  f"(declared at {const_line[cname]}) -> TDZ white screen")
        raise SystemExit(1)
    print("   parse-time calls before their const : none -> PASS")


# ------------------------------------------------------------------ build ---
def build_old_script(canvas_json: str) -> str:
    lines = read(BACKUP).split("\n")
    parts = [read(UTILS), phase2_alias_shim(), "",
             "var window = globalThis;  /* same binding the real page provides */"]
    parts.append(extract(lines, "settings", "let"))
    for name, kind in HELPERS:
        parts.append(extract(lines, name, kind))
    parts.append("")
    for name in MOVED:
        parts.append(extract(lines, name, "fn"))
    parts.append("")
    parts.append("/* saveCanvas' contract loop, verbatim from the phase-3 backup; the")
    parts.append("   surrounding function only exists so both sides are callable the same way */")
    parts.append("function " + SAVE_LOOP + "(nodes){")
    parts.append("\n".join(backup_inline_loop()))
    parts.append("}")
    parts.append("")
    parts.append("const initialSmartSettings = cloneSmartSettings(settings);")
    parts.append("let canvasDefaultSmartSettings = cloneSmartSettings(settings);")
    parts.append("var canvas = " + canvas_json + ";")
    return "\n".join(parts) + "\n"


def build_new_script(canvas_json: str) -> str:
    lines = read(BACKUP).split("\n")
    main_txt = read(MAIN)
    helper_block = re.search(
        re.escape(HELPER_BLOCK_START) + r"[\s\S]*?\n\}", main_txt)
    if not helper_block:
        raise SystemExit("FATAL: smartNodeMigrationDeps helper not found in smart-canvas.js")
    parts = [read(UTILS), read(STATE), phase2_alias_shim(), "",
             "var window = globalThis;  /* the emitted wrappers call window.SmartCanvasState */"]
    parts.append(extract(lines, "settings", "let"))
    for name, kind in HELPERS:
        parts.append(extract(lines, name, kind))
    parts.append("")
    parts.append("/* the real wrapper lines taken from post-split smart-canvas.js */")
    parts.append(helper_block.group(0))
    parts.append(wrappers_from_main(main_txt))
    parts.append("")
    parts.append("const initialSmartSettings = cloneSmartSettings(settings);")
    parts.append("let canvasDefaultSmartSettings = cloneSmartSettings(settings);")
    parts.append("var canvas = " + canvas_json + ";")
    return "\n".join(parts) + "\n"


def main() -> int:
    print("targets:")
    print(f"  MAIN  = {MAIN.relative_to(ROOT)}")
    print(f"  STATE = {STATE.relative_to(ROOT)}")

    real_nodes, canvases = load_real_nodes()
    if not real_nodes:
        raise SystemExit("FATAL: no real nodes loaded")
    with_nodes = [c for c in canvases if isinstance(c.get("nodes"), list) and c["nodes"]]
    rep_canvas = max(with_nodes, key=lambda c: len(c["nodes"])) if with_nodes else None
    if rep_canvas is None:
        raise SystemExit("FATAL: no canvas sample with nodes")
    capped = dict(rep_canvas)
    capped["nodes"] = [_shrink(json.loads(json.dumps(n, ensure_ascii=False)), [BIG_KEEP])
                       for n in capped["nodes"][:60] if isinstance(n, dict)]
    canvas_json = json.dumps(capped, ensure_ascii=False, allow_nan=False)
    print(f"  sandbox canvas: keys={sorted(capped.keys())} nodes={len(capped['nodes'])}")

    # Gate C is a per-phase one-shot: it proves "this phase changed nothing beyond
    # its own wrappers" against THAT phase's starting backup. Once a later phase
    # has moved more code out of the same file, only the later phase's gate C is a
    # valid reconstruction check, so this one can be skipped deliberately.
    if "--skip-c" in sys.argv:
        print("\nC. lossless reconstruction: SKIPPED (--skip-c; superseded by the "
              "latest phase's own gate C)")
    else:
        gate_c()
    gate_d()
    gate_e()

    node_fx = node_fixtures(real_nodes)
    image_fx = image_fixtures(real_nodes)
    settings_fx = settings_fixtures(canvases, real_nodes)
    groups = [
        dict(name="normalizeLegacySmartNode", inputs=node_fx,
             call="globalThis.normalizeLegacySmartNode(x)"),
        dict(name="serializableSmartNode", inputs=node_fx,
             call="globalThis.serializableSmartNode(x)"),
        dict(name="pruneNodeForSnapshot", inputs=node_fx,
             call="globalThis.pruneNodeForSnapshot(x)"),
        dict(name="clearSmartNodeTransientRunState", inputs=node_fx,
             call="globalThis.clearSmartNodeTransientRunState(x)"),
        dict(name="clearSmartNodeTransientRunState+history", inputs=node_fx[:80],
             call="globalThis.clearSmartNodeTransientRunState(x, {clearRunHistory:true})"),
        dict(name="inheritNodeMetaFromImage", inputs=node_fx,
             call="globalThis.inheritNodeMetaFromImage(x)"),
        dict(name="countCanvasMediaItems", inputs=node_fx,
             call="globalThis.countCanvasMediaItems([x])"),
        dict(name="collectOversizedInlineImages", inputs=node_fx,
             call="globalThis.collectOversizedInlineImages([x])"),
        dict(name="mediaItemForStorage", inputs=image_fx,
             call="globalThis.mediaItemForStorage(x)"),
        dict(name="stripImageGenerationMeta", inputs=image_fx,
             call="globalThis.stripImageGenerationMeta(x)"),
        dict(name="applyNodeMetaToImage", inputs=image_fx,
             call="globalThis.applyNodeMetaToImage(x, null)"),
        dict(name="settingsForStorage", inputs=settings_fx,
             call="globalThis.settingsForStorage(x)"),
        dict(name="cloneSmartSettings", inputs=settings_fx,
             call="globalThis.cloneSmartSettings(x)"),
        dict(name="stripOutpaintDisplaySettings", inputs=settings_fx,
             call="globalThis.stripOutpaintDisplaySettings(x)"),
        dict(name="pruneMediaItemForSnapshot", inputs=SYNTH_PRUNES,
             call="globalThis.pruneMediaItemForSnapshot(x)"),
        dict(name="mergeSmartImageLists", inputs=SYNTH_PAIRS,
             call="globalThis.mergeSmartImageLists(x[0], x[1])"),
        dict(name="normalizeSmartImageMode", inputs=SYNTH_MODES,
             call="globalThis.normalizeSmartImageMode(x)"),
        dict(name="normalizeImportedSmartWorkflow", inputs=SYNTH_IMPORTED,
             call="globalThis.normalizeImportedSmartWorkflow(x)"),
        dict(name="canvasForStorage", inputs=[None],
             call="globalThis.canvasForStorage()"),
        # phase 3.5: the loop lifted out of saveCanvas, compared against the same
        # verbatim block re-wrapped from the backup. Inputs are node arrays, so the
        # in-place rewriting of the live nodes is part of what gets compared.
        dict(name="normalizeSmartNodesForSave", inputs=save_loop_arrays(real_nodes),
             call="globalThis.normalizeSmartNodesForSave(x)"),
    ]
    total = sum(len(g["inputs"]) for g in groups)
    print(f"\ngroups={len(groups)} comparisons={total}")

    write(TMP / "old_impl.js", build_old_script(canvas_json))
    write(TMP / "new_impl.js", build_new_script(canvas_json))
    write(TMP / "groups.json",
          json.dumps(groups, ensure_ascii=False, allow_nan=False))
    # canvas-state.js must reach for NO global at all: every value it needs from
    # smart-canvas.js is supposed to arrive as a parameter. An empty allow-list
    # makes the trap a hard assertion.
    write(TMP / "expected_globals.json", json.dumps([]))

    r = subprocess.run(
        ["node", str(HARNESS), str(TMP / "old_impl.js"), str(TMP / "new_impl.js"),
         str(TMP / "groups.json"), str(TMP / "expected_globals.json"),
         str(STATE), str(UTILS)],
        capture_output=True, text=True, encoding="utf-8")
    print(r.stdout)
    if r.stderr.strip():
        print("STDERR:", r.stderr.strip()[:2500])
    ok = r.returncode == 0
    print("\nRESULT:", "ALL PHASE-3 GATES PASSED" if ok else "FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
