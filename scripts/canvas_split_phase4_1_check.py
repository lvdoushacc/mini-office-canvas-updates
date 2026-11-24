# -*- coding: utf-8 -*-
"""Verification for canvas split phase 4.1 (pure layout maths).

  A  global-access trap      -> scripts/canvas_split_phase4_1_harness.js
  B  old-vs-new equivalence   -> scripts/canvas_split_phase4_1_harness.js
  C  lossless reconstruction  -> here
  D  static consistency       -> here
  E  parse-time / TDZ hazard  -> here, implemented independently of phase 3's gate

Both sandboxes mirror the real page: each loads canvas-utils.js and canvas-state.js
plus the layout constants and `smartPendingTasks`/`settings` that deliberately stay
in smart-canvas.js. The new side additionally loads canvas-layout.js together with
the *actual* wrapper lines and the smartLayoutDeps helper taken from the post-split
smart-canvas.js, so the wrappers and the injection are themselves under test.

data/canvases/*.json are opened strictly read-only.
"""
from __future__ import annotations

import collections
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from canvas_split_phase3_check import (  # noqa: E402
    extract, find_block_end, load_real_nodes, phase2_alias_shim, read, strip_noise, write,
)
# The names smartLayoutDeps() injects are owned by the newest layout phase, so this
# regression reads them from there instead of keeping a second copy that can drift.
from canvas_split_phase4_2a_check import (  # noqa: E402
    GRAPH_STUBS as P42A_GRAPH_STUBS, PURE_CONSTS as P42A_CONSTS, PURE_FNS as P42A_FNS,
)
from canvas_layout_test_deps import GLOBALS_STUBS  # noqa: E402


ROOT = Path(__file__).resolve().parent.parent


def _flag(name: str):
    for i, a in enumerate(sys.argv):
        if a == name and i + 1 < len(sys.argv):
            return Path(sys.argv[i + 1]).resolve()
    return None


BACKUP = _flag("--backup") or Path(
    r"D:/压缩包/canvas_split_phase4_1_backup_2026-09-19/smart-canvas.js")
MAIN = _flag("--main") or (ROOT / "static" / "canvas" / "js" / "smart-canvas.js")
LAYOUT = _flag("--layout") or (ROOT / "static" / "canvas" / "js" / "modules" / "canvas-layout.js")
STATE = ROOT / "static" / "canvas" / "js" / "modules" / "canvas-state.js"
UTILS = ROOT / "static" / "canvas" / "js" / "modules" / "canvas-utils.js"
HTML = ROOT / "static" / "smart-canvas.html"
TMP = Path(tempfile.gettempdir()) / "xxpd_canvas_split_p41check"
HARNESS = ROOT / "scripts" / "canvas_split_phase4_1_harness.js"

MOVED = [
    "nodeScale", "emptyGenBoardSizeFromAspect", "smartGroupLayoutSize",
    "mediaLayoutSize", "standardImageFixedSize", "singleImageLayout",
    "groupImageGridLayout", "smartNodeInputThumbRows", "smartNodeInputThumbsHeight",
    "smartNodeLayoutImages",
]
# what stays in smart-canvas.js but must be visible to both sandboxes
CONSTS = [
    "MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE", "MEDIA_GROUP_DEFAULT_SCALE",
    "MEDIA_GROUP_MAX_VISIBLE_ROWS", "SMART_GROUP_DEFAULT_WIDTH", "SMART_GROUP_MIN_WIDTH",
    "SMART_GROUP_LEGACY_HEIGHT", "SMART_GROUP_DEFAULT_HEIGHT", "SMART_GROUP_MIN_HEIGHT",
]
ARRAY_CONSTS = ["STANDARD_ASPECT_RATIO_PRESETS"]
EXTRA_FNS = ["smartPendingTasks"]
DEPS_HELPER_START = "// canvas-layout.js 需要的布局常量与少量外部依赖仍属主文件"
WRAPPERS_ALL = MOVED  # every moved name has a main-file wrapper


# ------------------------------------------------------------- fixtures ------
def build_groups(real_nodes):
    images = []
    for n in real_nodes:
        for img in (n.get("images") or []):
            if isinstance(img, dict):
                images.append(img)
    pairs = [[img.get("natural_w"), img.get("natural_h")] for img in images]
    pairs += [[0, 0], [-5, 10], [None, None], ["abc", 3], [1920, 1080], [1080, 1920],
              [1024, 1024], [4096, 2160], [7, 3], [3, 7], [480, 270], [202, 270],
              [152, 270], [405, 270], [360, 270], [270, 270], [1, 1000], [1000, 1],
              [0.5, 0.5], [1e9, 1], [1, 1e9]]

    seeds_nodes = [
        None, {}, [], "str", 0,
        {"id": "a"},
        {"id": "b", "scale": 1.6, "images": [{"url": "/a.png"}, {"url": "/b.png"}]},
        {"id": "c", "scale": 1.6, "images": [{"url": "/a.png"}]},
        {"id": "d", "scale": 0.8, "images": [{"url": "/a.png"}, {"url": "/b.png"}]},
        {"id": "e", "scale": 2, "images": [{"url": "/a.png"}, {"url": "/b.png"}]},
        {"id": "f", "scale": 0}, {"id": "g", "scale": -3}, {"id": "h", "scale": "2"},
        {"id": "i", "scale": "abc"}, {"id": "j", "scale": None},
        {"id": "k", "pending": 3, "images": [{"url": "/a.png"}]},
        {"id": "l", "pending": 2, "images": []},
        {"id": "m", "pendingTasks": [{"taskId": "t1"}, None, {"nope": 1}],
         "images": [{"url": "/a.png"}]},
        {"id": "n", "pending": 0, "images": [{"url": "/a.png"}, {"url": ""}, None]},
        {"id": "o", "w": 150, "h": 130},
        {"id": "p", "w": 149, "h": 129},
        {"id": "q", "w": 340, "h": 220},
        {"id": "r", "w": "400", "h": "300"},
        {"id": "s", "w": None, "h": None},
        {"id": "t", "w": 10000, "h": 9000},
        {"id": "u", "gridSplitChild": True, "w": 480, "h": 270},
        {"id": "v", "isCroppedVideo": True, "w": 500, "h": 300},
        {"id": "w", "gridSplitChild": True, "w": 20, "h": 30},
        {"id": "x", "type": "smart-group", "w": 100, "h": 100},
    ]
    node_inputs = real_nodes + seeds_nodes

    seed_images = [
        None, {}, "str", 5,
        {"natural_w": 800, "natural_h": 600},
        {"width": 640, "height": 480},
        {"w": 320, "h": 240},
        {"layout_w": 128, "layout_h": 128},
        {"preview_w": 64, "preview_h": 32},
        {"natural_w": 0, "natural_h": 100},
        {"natural_w": "abc", "natural_h": None},
        {"url": "/a.png"},
        {"natural_w": 1e9, "natural_h": 3},
    ]
    image_inputs = images + seed_images

    thumb_arrays = [None, [], [{}], [{"url": "/a.png"}]]
    thumb_arrays += [[{"url": f"/{i}.png"} for i in range(k)] for k in range(1, 26)]

    grids = []
    for count in [0, 1, 2, 3, 4, 5, 6, 9, 12, 25]:
        for w, h in [(480, 480), (200, 200), [120, 90], [1000, 200], [40, 40], [0, 0]]:
            grids.append([count, w, h, 224, None, None, None])
    grids += [[3, 480, 480, 96, 0, 0, 1], [3, 480, 480, 96, 32, 8, 4],
              [2, 100, 100, 96, 200, 200, 2], [4, 500, 500, 224, 32, 8, None]]

    aspects = [None, "", " ", 0, 1, "auto", "adaptive", "source", "custom",
               "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "9:21",
               "square", "wide", "story", "landscape43", "portrait43", "portrait",
               "landscape", "ultrawide", "ultratall", "16/9", " 16 : 9 ",
               "1000:3", "3:1000", "abc", "1:0", "0:1", "-1:-1", "2.5:1",
               1.7777, "1.7777", "16:9:2", "16:", ":9"]

    single = []
    for node in node_inputs[:220]:
        img = (node.get("images") or [None])[0] if isinstance(node, dict) else None
        for scale in (None, 1, 2):
            single.append({"image": img, "node": node, "scale": scale})
    single += [{"image": i, "node": n, "scale": s}
               for i in seed_images[:8] for n in seeds_nodes[5:22] for s in (None, 3)]

    return [
        dict(name="nodeScale", inputs=node_inputs, call="globalThis.nodeScale(x)"),
        dict(name="mediaLayoutSize", inputs=image_inputs, call="globalThis.mediaLayoutSize(x)"),
        dict(name="standardImageFixedSize", inputs=pairs,
             call="globalThis.standardImageFixedSize(x[0], x[1])"),
        dict(name="singleImageLayout", inputs=single,
             call="globalThis.singleImageLayout(x.image, x.node, x.scale)"),
        dict(name="groupImageGridLayout", inputs=grids,
             call="globalThis.groupImageGridLayout(x[0], x[1], x[2], x[3], x[4], x[5], x[6])"),
        dict(name="smartNodeInputThumbRows",
             inputs=[None, 0, 1, 2, 4, 5, 6, 10, 11, 25, -3, "abc", 1.5],
             call="globalThis.smartNodeInputThumbRows(x)"),
        dict(name="smartNodeInputThumbsHeight", inputs=thumb_arrays,
             call="globalThis.smartNodeInputThumbsHeight(x)"),
        dict(name="smartNodeLayoutImages", inputs=node_inputs,
             call="globalThis.smartNodeLayoutImages(x)"),
        dict(name="smartGroupLayoutSize", inputs=node_inputs,
             call="globalThis.smartGroupLayoutSize(x)"),
        dict(name="emptyGenBoardSizeFromAspect", inputs=aspects,
             call="globalThis.emptyGenBoardSizeFromAspect(x)"),
    ]


# ------------------------------------------------------------- sandboxes -----
def _dedupe(names):
    return list(dict.fromkeys(names))


def common_prelude(lines):
    """Constants and helpers that stay in smart-canvas.js, needed by both sides."""
    parts = [read(UTILS), read(STATE), phase2_alias_shim(), ""]
    parts.append(extract(lines, "settings", "let"))
    # smartLayoutDeps() gained names in phase 4.2a. They are irrelevant to the ten
    # functions this phase moved, but both sides evaluate that one object literal, so
    # every bare identifier in it must resolve. The pure ones are extracted verbatim
    # from this phase's backup, using the same lists the phase-4.2a check maintains
    # (one source of truth); the four node-graph ones arrive as stubs, never reached.
    for c in _dedupe(ARRAY_CONSTS + CONSTS + P42A_CONSTS):
        parts.append(extract(lines, c, "const"))
    for f in _dedupe(EXTRA_FNS + P42A_FNS):
        parts.append(extract(lines, f, "fn"))
    parts.append(P42A_GRAPH_STUBS)
    parts.append(GLOBALS_STUBS)
    parts.append("")
    return parts


def build_old_script() -> str:
    lines = read(BACKUP).split("\n")
    parts = common_prelude(lines)
    for name in MOVED:
        parts.append(extract(lines, name, "fn"))
    return "\n".join(parts) + "\n"


def build_new_script() -> str:
    lines = read(BACKUP).split("\n")
    main_txt = read(MAIN)
    helper = re.search(re.escape(DEPS_HELPER_START) + r"[\s\S]*?\n\}", main_txt)
    if not helper:
        raise SystemExit("FATAL: smartLayoutDeps helper not found in smart-canvas.js")
    parts = common_prelude(lines)
    parts.append("var window = globalThis;  /* the wrappers call window.SmartCanvasLayout */")
    parts.append(read(LAYOUT))
    parts.append(helper.group(0))
    for name in WRAPPERS_ALL:
        pat = (r"^function " + re.escape(name) +
               r"\([^)]*\)\{ return window\.SmartCanvasLayout\." + re.escape(name) + r"\(.*\); \}$")
        m = re.search(pat, main_txt, re.M)
        if not m:
            raise SystemExit(f"FATAL: wrapper for {name} not found in smart-canvas.js")
        parts.append(m.group(0).replace("window.SmartCanvasLayout.", "SmartCanvasLayout."))
    return "\n".join(parts) + "\n"


# ---------------------------------------------------------------- gates ------
def gate_c() -> None:
    print("\nC. lossless reconstruction")
    backup = read(BACKUP).split("\n")
    new = read(MAIN).split("\n")
    rebuilt, replaced, helper_lines, i = [], 0, 0, 0
    wrapper_re = re.compile(
        r"^function ([A-Za-z_$][\w$]*)\([^)]*\)\{ return window\.SmartCanvasLayout\.\1\(")
    while i < len(new):
        line = new[i]
        m = wrapper_re.match(line)
        if m and m.group(1) in MOVED:
            rebuilt.extend(extract(backup, m.group(1), "fn").split("\n"))
            replaced += 1
            i += 1
            continue
        if line.startswith(DEPS_HELPER_START):
            j = i
            while j < len(new) and new[j] != "}":
                j += 1
            helper_lines = j - i + 1
            i = j + 1
            continue
        rebuilt.append(line)
        i += 1
    print(f"   wrappers substituted back : {replaced} (expected {len(MOVED)})")
    print(f"   deps-helper lines cut     : {helper_lines}")
    if replaced != len(MOVED) or not helper_lines:
        raise SystemExit("FAIL: not every wrapper / the deps helper were accounted for")
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
    main_txt, layout_txt, backup_txt = read(MAIN), read(LAYOUT), read(BACKUP)
    failed = []

    exported = re.findall(r"^\s{8}([A-Za-z_$][\w$]*): \1,?$", layout_txt, re.M)
    print(f"   SmartCanvasLayout exports : {len(exported)} "
          f"(phase 4.1 moved {len(MOVED)}, later phases may add more)")
    # Invariant for a regression run: the functions THIS phase moved must still be
    # exported. Additions by later phases (4.2a's imageLayout) are expected, not a
    # failure -- asserting exact equality here would make every later phase break it.
    if set(MOVED) - set(exported):
        failed.append(f"phase-4.1 exports went missing: {sorted(set(MOVED) - set(exported))}")
    if set(exported) - set(MOVED):
        print(f"   exports added since 4.1   : {sorted(set(exported) - set(MOVED))}")

    bad = []
    for name in exported:
        defs = re.findall(r"^function " + re.escape(name) + r"\(.*$", main_txt, re.M)
        if len(defs) != 1:
            bad.append(f"{name}: {len(defs)} top-level defs in smart-canvas.js")
        elif "window.SmartCanvasLayout." + name not in defs[0]:
            bad.append(f"{name}: not a wrapper -> {defs[0][:80]}")
        mdefs = re.findall(r"^    (?:async )?function " + re.escape(name) + r"\(", layout_txt, re.M)
        if len(mdefs) != 1:
            bad.append(f"{name}: {len(mdefs)} defs in canvas-layout.js")
    orphan = [w for w in re.findall(
        r"^function ([A-Za-z_$][\w$]*)\([^)]*\)\{ return window\.SmartCanvasLayout\.", main_txt, re.M)
        if w not in exported]
    if bad or orphan:
        failed.append(f"wrapper/definition: {bad} orphan={orphan}")
    print(f"   wrapper<->definition      : {'OK' if not (bad or orphan) else 'see failures'}")

    top = re.findall(r"^(?:const|let|var|function|async function|class)\s+([A-Za-z_$][\w$]*)",
                     layout_txt, re.M)
    print(f"   module top-level globals  : {top or '[]'} (must be empty)")
    if top:
        failed.append(f"canvas-layout.js declares top-level globals: {top}")
    mstate = re.findall(r"^    (?:const|let|var)\s+([A-Za-z_$][\w$]*)", layout_txt, re.M)
    print(f"   module-level state vars   : {mstate or '[]'} (must be empty)")
    if mstate:
        failed.append(f"canvas-layout.js holds its own state: {mstate}")

    # strip_noise blanks strings, comments (line *and* block) and regex literals,
    # so this cannot be tripped by the module's own doc comment
    code_only = strip_noise(layout_txt)
    for pat, why in ((r"(?<![.\w$])(document|world|shell|querySelector|addEventListener|requestAnimationFrame)\b",
                      "DOM"),
                     (r"(?<![.\w$])(nodes|viewport|canvas)\b(?!\s*:)", "画布状态")):
        found = sorted(set(re.findall(pat, code_only)))
        if found:
            failed.append(f"canvas-layout.js references {why}: {found}")
    print(f"   DOM / nodes / canvas / viewport refs : "
          + ("none -> PASS" if not any("references" in f for f in failed)
             else "see failures"))

    names_new = re.findall(r"^function ([A-Za-z_$][\w$]*)\(", main_txt, re.M)
    dups = {k: v for k, v in collections.Counter(names_new).items() if v > 1}
    names_old = re.findall(r"^function ([A-Za-z_$][\w$]*)\(", backup_txt, re.M)
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

    refs = set(re.findall(r"window\.SmartCanvasLayout\.([A-Za-z_$][\w$]*)", main_txt))
    if refs - set(exported):
        failed.append(f"unresolved SmartCanvasLayout refs: {sorted(refs - set(exported))}")
    for mod, path in (("SmartCanvasState", STATE), ("SmartCanvasUtils", UTILS)):
        names = set(re.findall(r"^\s{8}([A-Za-z_$][\w$]*): \1,?$", read(path), re.M))
        used = set(re.findall(r"window\." + mod + r"\.([A-Za-z_$][\w$]*)", main_txt))
        print(f"   {mod}.* refs           : {len(used)} unresolved={sorted(used - names) or 'none'}")
        if used - names:
            failed.append(f"{mod} exports regressed: {sorted(used - names)}")

    seq = [m.group(1) for m in re.finditer(r'<script src="([^"]+)"', read(HTML))]
    idx = {}
    for tok in ("canvas-utils.js", "canvas-state.js", "canvas-layout.js", "smart-canvas.js"):
        idx[tok] = next((i for i, u in enumerate(seq) if tok in u), None)
    order = [idx["canvas-utils.js"], idx["canvas-state.js"], idx["canvas-layout.js"],
             idx["smart-canvas.js"]]
    print(f"   load order                : {list(zip(idx, order))}")
    preview_run = not str(LAYOUT).startswith(str(ROOT / "static"))
    if any(v is None for v in order) or order != sorted(order):
        if preview_run:
            print("   load order check SKIPPED: validating a preview, HTML not updated yet")
        else:
            failed.append(f"canvas script load order must be utils->state->layout->main, got {order}")
    else:
        print("   utils -> state -> layout -> main : PASS")

    if failed:
        print("   GATE D FAILURES:")
        for f in failed:
            print("     -", f)
        raise SystemExit(1)
    print("   gate D                    : PASS")


def gate_e() -> None:
    """None of the moved wrappers may run while smart-canvas.js is being evaluated.

    They all read constants declared around line 3400+, so a top-level call would
    hit the temporal dead zone and blank the page silently.
    """
    print("\nE. parse-time call / TDZ hazard")
    raw = read(MAIN)
    lines = raw.split("\n")
    clean = strip_noise(raw).split("\n")
    if len(clean) != len(lines):
        raise SystemExit("FAIL: strip_noise changed the line count")
    depths, d = [], 0
    for c in clean:
        depths.append(d)
        d = max(0, d + c.count("{") - c.count("}"))

    ranges = []
    for i, c in enumerate(clean):
        if depths[i] != 0 or "{" not in c:
            continue
        head = lines[i].strip()
        if head.startswith(("function ", "async function ", "class ")) or "function" in c or "=>" in c:
            continue
        dd = 0
        for j in range(i, len(clean)):
            dd += clean[j].count("{") - clean[j].count("}")
            if dd == 0 and j > i:
                ranges.append((i + 1, j + 1))
                break
    print(f"   parse-time block ranges  : {len(ranges)}")

    hits = []
    for name in MOVED:
        call_re = re.compile(r"(?<![.\w])" + re.escape(name) + r"\s*\(")
        for i, c in enumerate(clean):
            if not call_re.search(c):
                continue
            ln = i + 1
            if lines[i].startswith("function " + name):
                continue                      # the wrapper definition itself
            if lines[i].strip().startswith("//"):
                continue
            if depths[i] == 0 or any(a <= ln <= b for a, b in ranges):
                hits.append((ln, name))
    if hits:
        print("   GATE E FAILURES:")
        for ln, name in hits:
            print(f"     - line {ln}: parse-time call to {name}()")
        raise SystemExit(1)
    print("   parse-time calls to moved wrappers : none -> PASS")


# ---------------------------------------------------------------- main -------
def main() -> int:
    print("targets:")
    print(f"  MAIN   = {MAIN.relative_to(ROOT)}")
    print(f"  LAYOUT = {LAYOUT.relative_to(ROOT)}")

    real_nodes, canvases = load_real_nodes()
    if not real_nodes:
        raise SystemExit("FATAL: no real nodes loaded")

    # Gate C is a per-phase one-shot: it reconstructs THIS phase's starting backup,
    # so once a later phase (4.2a) has moved more code out of the same file it can no
    # longer match. The later phase's own gate C is then the valid one.
    if "--skip-c" in sys.argv:
        print("\nC. lossless reconstruction: SKIPPED (--skip-c; superseded by the "
              "phase-4.2a gate C)")
    else:
        gate_c()
    gate_d()
    gate_e()

    groups = build_groups(real_nodes)
    total = sum(len(g["inputs"]) for g in groups)
    print(f"\ngroups={len(groups)} comparisons={total}")

    lines = read(BACKUP).split("\n")
    consts_src = "\n".join([extract(lines, c, "const") for c in ARRAY_CONSTS + CONSTS])
    consts_expr = ("{" + ", ".join(ARRAY_CONSTS + CONSTS) + "}")
    payload = {
        "utilsFile": str(UTILS),
        "constsSrc": consts_src,
        "constsExpr": consts_expr,
        "trapFnDepsExpr": ("{ normalizeImageRatio: SmartCanvasUtils.normalizeImageRatio, "
                           "isAudioMediaItem: SmartCanvasUtils.isAudioMediaItem, "
                           "smartPendingTasks: function(){ return []; }, "
                           "settings: {ratio: '1:1'} }"),
        "trapArgSets": [[[]], [[None]], [[{}]], [[[]]], [["16:9"]], [[0]], [[12, 480, 480, 96]],
                        [[{"url": "/a.png", "natural_w": 800, "natural_h": 600}]],
                        [[{"id": "n", "w": 340, "h": 220, "images": [{"url": "/a.png"}]}]]],
        "groups": groups,
    }
    write(TMP / "old_impl.js", build_old_script())
    write(TMP / "new_impl.js", build_new_script())
    write(TMP / "payload.json", json.dumps(payload, ensure_ascii=False))

    r = subprocess.run(["node", str(HARNESS), str(LAYOUT), str(TMP / "old_impl.js"),
                        str(TMP / "new_impl.js"), str(TMP / "payload.json")],
                       capture_output=True, text=True, encoding="utf-8")
    print(r.stdout)
    if r.stderr.strip():
        print("STDERR:", r.stderr.strip()[:2500])
    ok = r.returncode == 0
    print("RESULT:", "ALL PHASE-4.1 GATES PASSED" if ok else "FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
