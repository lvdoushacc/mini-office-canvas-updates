# -*- coding: utf-8 -*-
"""Verification for canvas split phase 4.2a (imageLayout moved into canvas-layout.js).

Gate A (global trap) and Gate B (old-vs-new equivalence) are payload-driven and
are reused from scripts/canvas_split_phase4_1_harness.js. Gates C/D/E are here.

Gate B is deliberately constructed so the *only* difference between the two
sandboxes is which imageLayout runs:
  * the OLD side uses the pre-split imageLayout taken verbatim from the backup,
    plus the phase-4.1 main-file wrappers (exactly the pre-4.2a page);
  * the NEW side uses the real post-split wrapper and the module;
  * both sides share the same extracted constants, the same genuinely-pure
    callees (mediaNodeDefaultScale, smartMinimaxLayoutSize, smartLoopWidth,
    isSmartUploadNode, isSmartVideoNode) copied verbatim from the backup, and the
    same parameterised stubs for the four node-graph callees.
Those four (smartGroupThumbLayout, promptNodeLayoutSize, isSmartGroupCompactMember,
smartLoopHeight) cannot be extracted faithfully because they resolve group
membership from `nodes`, so they are stubbed -- and the stubs are re-seeded three
times so equivalence cannot be an artifact of one lucky stub set.

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
    extract, load_real_nodes, phase2_alias_shim, read, strip_noise, write,
)
# Re-exported from the shared module so phase 4.1's regression keeps working from here.
from canvas_layout_test_deps import (  # noqa: E402,F401
    GLOBALS_STUBS, PURE_CONSTS, PURE_FNS, TRAP_CONST_NAMES, TRAP_STUB_FNS,
)

ROOT = Path(__file__).resolve().parent.parent


def _flag(name: str):
    for i, a in enumerate(sys.argv):
        if a == name and i + 1 < len(sys.argv):
            return Path(sys.argv[i + 1]).resolve()
    return None


BACKUP = _flag("--backup") or Path(
    r"D:/压缩包/canvas_split_phase4_2a_backup_2026-09-19/smart-canvas.js")
BACKUP_LAYOUT = Path(
    r"D:/压缩包/canvas_split_phase4_2a_backup_2026-09-19/canvas-layout.js")
MAIN = _flag("--main") or (ROOT / "static" / "canvas" / "js" / "smart-canvas.js")
LAYOUT = _flag("--layout") or (ROOT / "static" / "canvas" / "js" / "modules" / "canvas-layout.js")
STATE = ROOT / "static" / "canvas" / "js" / "modules" / "canvas-state.js"
UTILS = ROOT / "static" / "canvas" / "js" / "modules" / "canvas-utils.js"
HTML = ROOT / "static" / "smart-canvas.html"
DATA = ROOT / "data" / "canvases"
TMP = Path(tempfile.gettempdir()) / "xxpd_canvas_split_p42acheck"
HARNESS = ROOT / "scripts" / "canvas_split_phase4_1_harness.js"

MOVED = ["imageLayout"]
EXPORTS = [
    "nodeScale", "emptyGenBoardSizeFromAspect", "smartGroupLayoutSize", "mediaLayoutSize",
    "standardImageFixedSize", "singleImageLayout", "groupImageGridLayout",
    "smartNodeInputThumbRows", "smartNodeInputThumbsHeight", "smartNodeLayoutImages",
    "imageLayout",
]
ORIG_SIG = "function imageLayout(images, scale=1, node=null){"
WRAPPER_PREFIX = "function imageLayout(images, scale=1, node=null){ return window.SmartCanvasLayout.imageLayout("

# The shared constant / pure-callee lists live in canvas_layout_test_deps, because
# smartLayoutDeps() is one object literal used by every layout phase. The four
# node-graph callees are stubbed per phase instead -- see GRAPH_STUBS below.

# the four graph-dependent callees, seeded so the stub set cannot fluke a match
GRAPH_STUBS = """
globalThis.__SEED = 0;
globalThis.smartGroupThumbLayout = function(node){
  if (__SEED === 0) return null;
  if (__SEED === 1) return {cols:2, rows:2, visibleRows:2, width:500 + __SEED, height:500, thumb:96};
  return undefined;
};
globalThis.promptNodeLayoutSize = function(node){
  if (__SEED === 0) return {width:316, height:240};
  if (__SEED === 1) return {width:Number(node?.w) || 320, height:Number(node?.h) || 400};
  return {width:0, height:0};
};
globalThis.isSmartGroupCompactMember = function(node){
  if (__SEED === 0) return false;
  return Boolean(node && typeof node.id === 'string' && node.id.charCodeAt(0) % 2 === __SEED);
};
globalThis.smartLoopHeight = function(node){
  return __SEED === 0 ? 168 : (__SEED === 1 ? 320 : 96);
};
"""


def gate_c() -> None:
    print("\nC. lossless reconstruction")
    backup = read(BACKUP).split("\n")
    new = read(MAIN).split("\n")
    # the pre-4.2a smartLayoutDeps body, to put back
    old_helper = ("        settings, smartPendingTasks, normalizeImageRatio, isAudioMediaItem\n"
                  "    };")
    rebuilt, replaced, i = [], 0, 0
    while i < len(new):
        line = new[i]
        if line.startswith(WRAPPER_PREFIX):
            s = i
            first = line.rstrip()
            if first == ORIG_SIG.rstrip("{") + "{ return window.SmartCanvasLayout.imageLayout(images, scale, node, smartLayoutDeps()); }":
                # splice back the original function from the backup
                rebuilt.extend(extract(backup, "imageLayout", "fn").split("\n"))
                replaced += 1
                i += 1
                continue
            raise SystemExit(f"FAIL: unexpected imageLayout wrapper: {line[:110]!r}")
        rebuilt.append(line)
        i += 1
    joined = "\n".join(rebuilt)
    # revert the deps helper to its pre-4.2a form
    helper_new_re = re.compile(
        r"        settings, smartPendingTasks, normalizeImageRatio, isAudioMediaItem,\n"
        r"(?:        [^\n]*\n)+?\s*\};")
    hits = helper_new_re.findall(joined)
    if len(hits) != 1:
        raise SystemExit(f"FAIL: smartLayoutDeps block matched {len(hits)} times")
    joined = helper_new_re.sub(old_helper, joined, count=1)
    rebuilt = joined.split("\n")

    print(f"   imageLayout wrapper restored : {replaced} (expected 1)")
    print(f"   smartLayoutDeps reverted    : yes")
    if replaced != 1:
        raise SystemExit("FAIL: imageLayout wrapper not found")
    if rebuilt == backup:
        print("   result                      : IDENTICAL to backup -> PASS")
        return
    print("   result                      : DIFFERS -> FAIL")
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
          f"(phase 4.2a moved {len(EXPORTS)}, later phases may add more)")
    # Regression invariant: what THIS phase moved must still be exported. A later phase
    # adding an export (4.2b's smartGroupThumbLayout) is expected, not a failure.
    if set(EXPORTS) - set(exported):
        failed.append(f"phase-4.2a exports went missing: {sorted(set(EXPORTS) - set(exported))}")
    if set(exported) - set(EXPORTS):
        print(f"   exports added since 4.2a  : {sorted(set(exported) - set(EXPORTS))}")

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
    if bad:
        failed.append(f"wrapper/definition: {bad}")
    print(f"   wrapper<->definition      : {'OK' if not bad else 'see failures'}")

    top = re.findall(r"^(?:const|let|var|function|async function|class)\s+([A-Za-z_$][\w$]*)",
                     layout_txt, re.M)
    print(f"   module top-level globals  : {top or '[]'} (must be empty)")
    if top:
        failed.append(f"canvas-layout.js declares top-level globals: {top}")
    mstate = re.findall(r"^    (?:const|let|var)\s+([A-Za-z_$][\w$]*)", layout_txt, re.M)
    print(f"   module-level state vars   : {mstate or '[]'} (must be empty)")
    if mstate:
        failed.append(f"canvas-layout.js holds its own state: {mstate}")

    code_only = strip_noise(layout_txt)
    for pat, why in ((r"(?<![.\w$])(document|world|shell|querySelector|addEventListener|requestAnimationFrame)\b", "DOM"),
                     (r"(?<![.\w$])(nodes|viewport|canvas|pendingUndo|selectedId)\b(?!\s*:)", "画布状态")):
        found = sorted(set(re.findall(pat, code_only)))
        if found:
            failed.append(f"canvas-layout.js references {why}: {found}")
    print("   implicit DOM / nodes / canvas / viewport : "
          + ("none -> PASS" if not any("references" in f for f in failed) else "see failures"))

    names_new = re.findall(r"^function ([A-Za-z_$][\w$]*)\(", main_txt, re.M)
    dups = {k: v for k, v in collections.Counter(names_new).items() if v > 1}
    print(f"   duplicate fn names now    : {dups or 'none'}")
    if dups:
        failed.append(f"duplicate top-level function names: {dups}")
    names_old = re.findall(r"^function ([A-Za-z_$][\w$]*)\(", backup_txt, re.M)
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
        failed.append(f"window.* changed lost={sorted(set(wb) - set(wa))} gained={sorted(set(wa) - set(wb))}")

    for mod, path in (("SmartCanvasState", STATE), ("SmartCanvasUtils", UTILS),
                      ("SmartCanvasLayout", LAYOUT)):
        names = set(re.findall(r"^\s{8}([A-Za-z_$][\w$]*): \1,?$", read(path), re.M))
        used = set(re.findall(r"window\." + mod + r"\.([A-Za-z_$][\w$]*)", main_txt))
        print(f"   {mod:22} refs: {len(used):3}  unresolved={sorted(used - names) or 'none'}")
        if used - names:
            failed.append(f"{mod} exports regressed: {sorted(used - names)}")

    seq = [m.group(1) for m in re.finditer(r'<script src="([^"]+)"', read(HTML))]
    toks = ("canvas-utils.js", "canvas-state.js", "canvas-layout.js", "smart-canvas.js")
    order = [next((i for i, u in enumerate(seq) if t in u), None) for t in toks]
    print(f"   load order                : {list(zip(toks, order))}")
    preview_run = not str(LAYOUT).startswith(str(ROOT / "static"))
    if any(v is None for v in order) or order != sorted(order):
        if preview_run:
            print("   load order check SKIPPED: validating a preview, HTML not updated yet")
        else:
            failed.append(f"load order must be utils->state->layout->main, got {order}")
    else:
        print("   utils -> state -> layout -> main : PASS")

    if failed:
        print("   GATE D FAILURES:")
        for f in failed:
            print("     -", f)
        raise SystemExit(1)
    print("   gate D                    : PASS")


def gate_e() -> None:
    print("\nE. parse-time call / TDZ hazard")
    raw = read(MAIN)
    lines = raw.split("\n")
    clean = strip_noise(raw).split("\n")
    if len(clean) != len(lines):
        raise SystemExit("FAIL: strip_noise changed the line count")
    depths, d = [], 0
    for c in clean:
        depths.append(d)
        d = max(0, d + c.count("{") - c.count("}")
                + c.count("[") - c.count("]") + c.count("(") - c.count(")"))
    # depth counting with braces only, to match how the file nests
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
            if lines[i].startswith("function " + name) or lines[i].strip().startswith("//"):
                continue
            if depths[i] == 0 or any(a <= ln <= b for a, b in ranges):
                hits.append((ln, name))
    if hits:
        print("   GATE E FAILURES:")
        for ln, name in hits:
            print(f"     - line {ln}: parse-time call to {name}()")
        raise SystemExit(1)
    print("   parse-time calls to imageLayout : none -> PASS")


# Aspect hints that make emptyGenBoardSizeFromAspect() return null, so imageLayout
# falls back to its own 480x270 / 270x270 literals instead of a preset size.
NULL_HINTS = [{"videoAspect": v} for v in ("adaptive", "auto", "source", "custom",
                                           "nonsense", "0:0", "1:0", "3:", ":4")] \
    + [{"ratio": v} for v in ("adaptive", "auto", "source", "nonsense", "0:0")] \
    + [{"imageRatio": v} for v in ("adaptive", "custom", "nonsense")] \
    + [{}, {"ratio": None}, {"videoAspect": None}, {"videoAspect": ""}, {"ratio": ""}]


def build_inputs(real_nodes):
    inputs = []
    # real nodes driven by their own images, with several scale values
    for n in real_nodes:
        imgs = [i for i in (n.get("images") or []) if isinstance(i, dict)]
        for scale in (None, 1, 2, 0):
            inputs.append([imgs, scale, n])
    types = [None, "smart-image", "smart-upload", "smart-video", "smart-group",
             "smart-prompt", "smart-minimax", "smart-loop", "bogus"]
    imgsets = [[], [{"url": "/a.png", "natural_w": 800, "natural_h": 600}],
               [{"url": "/a.png"}, {"url": "/b.png"}],
               [{"url": f"/{i}.png"} for i in range(5)],
               [{"url": f"/{i}.png"} for i in range(12)],
               [{"url": "/a.png", "grid": {"type": "grid-split", "cols": 3, "rows": 2}}],
               [{"url": "/a.png", "grid": {"type": "grid-split", "cols": 9, "rows": 4}}],
               [None, {"url": ""}], "str"]
    whs = [{}, {"w": 480, "h": 270}, {"w": 20, "h": 20}, {"w": 1200, "h": 800},
           {"w": 340, "h": 220}, {"w": 280, "h": 76}, {"w": "500", "h": "400"},
           {"w": 150, "h": 130}, {"w": 149, "h": 129},
           # exact thresholds: explicitW > 24 (count===0) and > 40 (multi-image)
           {"w": 24, "h": 24}, {"w": 25, "h": 24}, {"w": 24, "h": 25},
           {"w": 40, "h": 40}, {"w": 41, "h": 40}, {"w": 40, "h": 41}]
    for t in types:
        for imgs in imgsets:
            for extra in whs:
                node = {"id": f"s{t}", "type": t}
                node.update(extra)
                if t == "smart-video":
                    node.setdefault("params", {})["videoAspect"] = "9:16"
                if t == "smart-image":
                    node.setdefault("params", {})["ratio"] = "4:3"
                if t == "smart-loop":
                    node["imageInput"] = True
                    node["showPrompt"] = True
                inputs.append([imgs, None, node])
    # multi-image WITHOUT usable explicit size and without grid metadata: this is
    # the `cols = Math.min(4, ...)` / `226*s` branch. Discovered missing because an
    # early negative self-test (cap 4 -> 5) was not caught by the first input set.
    for cnt in list(range(2, 26)) + [30, 40]:
        imgs = [{"url": f"/{i}.png"} for i in range(cnt)]
        for t in (None, "smart-image", "smart-video", "smart-group", "smart-loop"):
            for extra in ({}, {"w": 40, "h": 40}, {"w": 0, "h": 0}, {"w": None, "h": 300},
                         {"w": 100, "h": 41}, {"w": 41, "h": 100},
                         {"w": 40, "h": 41}, {"w": 41, "h": 40}):
                node = {"id": f"m{cnt}{t}"}
                node.update(extra)
                for scale in (None, 1, 2, 0.5):
                    inputs.append([imgs, scale, node])
    # same shape but with grid metadata, to cover the grid sub-branches
    for cnt in (4, 6, 9, 16):
        imgs = [{"url": f"/{i}.png", "grid": {"type": "grid-split", "cols": c, "rows": r}}
                for i in range(cnt) for c, r in [(2, 2), (5, 3), (1, 9), (0, 0)]]
        for extra in ({}, {"w": 900, "h": 700}, {"w": 39, "h": 39},
                      {"w": 40, "h": 40}, {"w": 40, "h": 41}):
            inputs.append([imgs, 1.5, {"id": "g", **extra}])
    # High scale. The grid width is Math.max(round(226*s), cols*(round(224*s)+8)+32),
    # so for cols>=2 the second term always wins and the 226*s term is dead. It only
    # decides the result for cols=1 and s>=20 (at s=20 the two terms tie). Found by a
    # negative self-test: mutating 226*s -> 227*s was NOT caught by the inputs above.
    # Untyped/smart-image nodes take their scale from node.scale, typed ones from the
    # scale argument, so both spellings are needed.
    for s in (12, 13, 13.5, 14, 15, 16, 18, 19, 20, 21, 25, 40, 64, 100):
        for cols, rows in ((1, 1), (1, 9), (1, 40), (2, 2), (3, 1)):
            imgs = [{"url": f"/{i}.png", "grid": {"type": "grid-split", "cols": cols, "rows": rows}}
                    for i in range(3)]
            for extra in ({}, {"w": 900, "h": 700}, {"w": 39, "h": 39}, {"w": 41, "h": 41}):
                inputs.append([imgs, s, {"id": "hs", "type": "smart-video", **extra}])
                inputs.append([imgs, None, {"id": "hs", "scale": s, **extra}])
                inputs.append([imgs, None, {"id": "hs", "type": "smart-image", "scale": s, **extra}])
        # and the same scales through the no-grid multi-image branch
        for cnt in (2, 3, 5, 9):
            imgs = [{"url": f"/{i}.png"} for i in range(cnt)]
            for extra in ({}, {"w": 900, "h": 700}, {"w": 39, "h": 39}):
                inputs.append([imgs, s, {"id": "hn", "type": "smart-video", **extra}])
                inputs.append([imgs, None, {"id": "hn", "scale": s, **extra}])
    # Empty board + null-returning aspect hint, so the 480x270 / 270x270 literals
    # decide the size. Found by a negative self-test: mutating 480 -> 481 was not
    # caught without these.
    for t in ("smart-video", "smart-image", "smart-upload", None, "bogus", "smart-loop"):
        for params in NULL_HINTS:
            for scale in (None, 1, 2):
                inputs.append([[], scale, {"id": f"h{t}", "type": t, "params": params}])
    inputs += [[[], 1, None], [[], 1, {}], [[], None, None],
               [[{"url": "/a.png"}], "abc", {"type": "smart-image"}],
               [[{"url": "/a.png"}], None, {"type": "smart-image", "scale": 1.6}],
               [[{"url": f"/{i}.png"} for i in range(4)], 0.8,
                {"type": "smart-image", "scale": 1.6, "w": 700, "h": 700}]]
    return inputs, build_nosettings_inputs()


def build_nosettings_inputs():
    """count===0 shapes only, evaluated with `settings` blanked (see main()).

    imageLayout's empty-board size falls back to settings.ratio / settings.imageRatio /
    settings.videoAspect before the '1:1' / '16:9' literals, and those literals are
    otherwise never observable -- the page always seeds settings with both keys. A
    negative self-test on the literals proved the gap, so this second group exists to
    keep them covered.
    """
    inputs = []
    for t in (None, "smart-image", "smart-video", "smart-upload", "smart-group",
              "smart-loop", "bogus"):
        for params in ({}, {"ratio": "4:3"}, {"imageRatio": "9:16"},
                       {"videoAspect": "9:16"}, {"ratio": "nonsense"},
                       {"ratio": None, "videoAspect": "21:9"}, {"ratio": "", "imageRatio": "1:1"},
                       {"ratio": "4:3", "videoAspect": "9:16"}) + tuple(NULL_HINTS):
            for extra in ({}, {"w": 40, "h": 40}, {"w": 24, "h": 24}, {"w": 300, "h": 200},
                          {"w": 25, "h": 24}, {"w": 41, "h": 40}):
                node = {"id": "n", "type": t, **extra}
                if params:
                    node["params"] = params
                for scale in (None, 1, 2):
                    inputs.append([[], scale, node])
    return inputs


def common_prelude(backup_lines, new_main_txt):
    parts = [read(UTILS), read(STATE), phase2_alias_shim(), ""]
    parts.append(extract(backup_lines, "settings", "let"))
    for c in PURE_CONSTS:
        parts.append(extract(backup_lines, c, "const"))
    for f in PURE_FNS:
        try:
            parts.append(extract(backup_lines, f, "fn"))
        except SystemExit:
            raise SystemExit(f"FATAL: pure callee {f} not found in the backup")
    parts.append(GRAPH_STUBS)
    # smartLayoutDeps() names these two since phase 4.2b; without them the
    # object literal itself throws ReferenceError in this sandbox.
    parts.append(GLOBALS_STUBS)
    parts.append("var window = globalThis;")
    # the post-split smartLayoutDeps, shared by both sides
    helper = re.search(re.escape("// canvas-layout.js 需要的布局常量与少量外部依赖仍属主文件")
                       + r"[\s\S]*?\n\}", new_main_txt)
    if not helper:
        raise SystemExit("FATAL: smartLayoutDeps helper not found in smart-canvas.js")
    parts.append(helper.group(0))
    return parts


def build_old_script(backup_lines, new_main_txt) -> str:
    parts = common_prelude(backup_lines, new_main_txt)
    layout_old = read(BACKUP_LAYOUT)
    parts.append(layout_old)
    # phase-4.1 wrappers as they stood in the backup
    for name in [e for e in EXPORTS if e != "imageLayout"]:
        m = re.search(r"^function " + re.escape(name) +
                      r"\([^)]*\)\{ return window\.SmartCanvasLayout\." + re.escape(name) +
                      r"\(.*\); \}$", "\n".join(backup_lines), re.M)
        if not m:
            raise SystemExit(f"FATAL: backup wrapper for {name} not found")
        parts.append(m.group(0).replace("window.SmartCanvasLayout.", "SmartCanvasLayout."))
    parts.append(extract(backup_lines, "imageLayout", "fn"))
    return "\n".join(parts) + "\n"


def build_new_script(backup_lines, new_main_txt) -> str:
    parts = common_prelude(backup_lines, new_main_txt)
    parts.append(read(LAYOUT))
    for name in EXPORTS:
        m = re.search(r"^function " + re.escape(name) +
                      r"\([^)]*\)\{ return window\.SmartCanvasLayout\." + re.escape(name) +
                      r"\(.*\); \}$", new_main_txt, re.M)
        if not m:
            raise SystemExit(f"FATAL: wrapper for {name} not found in smart-canvas.js")
        parts.append(m.group(0).replace("window.SmartCanvasLayout.", "SmartCanvasLayout."))
    return "\n".join(parts) + "\n"


def _rel(p: Path) -> str:
    """Path as printed in the header; mutated layouts live outside the repo."""
    try:
        return str(p.relative_to(ROOT))
    except ValueError:
        return str(p)


def main() -> int:
    print("targets:")
    print(f"  MAIN   = {_rel(MAIN)}")
    print(f"  LAYOUT = {_rel(LAYOUT)}")

    real_nodes, _ = load_real_nodes()
    if not real_nodes:
        raise SystemExit("FATAL: no real nodes loaded")

    # Gate C is a per-phase one-shot: it reconstructs THIS phase's starting backup, so
    # once a later phase (4.2b) has moved more code out of the same file it can no
    # longer match. The later phase's own gate C is then the valid reconstruction check.
    if "--skip-c" in sys.argv:
        print("\nC. lossless reconstruction: SKIPPED (--skip-c; superseded by the "
              "phase-4.2b gate C)")
    else:
        gate_c()
    gate_d()
    gate_e()

    inputs, nosettings_inputs = build_inputs(real_nodes)
    # Order matters: the second group blanks the shared `settings`, so it must run last.
    groups = [dict(name="imageLayout", inputs=inputs,
                   call="globalThis.imageLayout(x[0], x[1], x[2])"),
              dict(name="imageLayout-noSettings", inputs=nosettings_inputs,
                   call="globalThis.imageLayout((settings = {}, x[0]), x[1], x[2])")]
    total = len(inputs) + len(nosettings_inputs)
    print(f"comparisons={total} ({len(inputs)} + {len(nosettings_inputs)})"
          f" x 3 stub seeds = {total * 3}")

    backup_lines = read(BACKUP).split("\n")
    new_main_txt = read(MAIN)
    consts_src = "\n".join(extract(backup_lines, c, "const") for c in PURE_CONSTS)
    consts_expr = "{" + TRAP_CONST_NAMES + "}"
    payload = {
        "utilsFile": str(UTILS),
        "constsSrc": consts_src,
        "constsExpr": consts_expr,
        # self-contained stubs: see canvas_layout_test_deps, because the trap context has
        # none of the prelude's globals and `globalThis.X` here made gate A stop early
        "trapFnDepsExpr": "{ " + TRAP_STUB_FNS + " }",
        "trapArgSets": [[[], 1, {}], [[], 1, {"type": "smart-image"}],
                        [[{"url": "/a.png"}], 1, None],
                        [[{"url": "/a.png"}, {"url": "/b.png"}], 2, {"type": "smart-image"}],
                        [[{"url": "/a.png"}], 1, {"type": "smart-group"}],
                        [[], 1, {"type": "smart-loop", "imageInput": True}],
                        [[{"url": "/a.png", "grid": {"type": "grid-split", "cols": 2, "rows": 2}}],
                         1, {"w": 600, "h": 600}]],
        "groups": groups,
        "seeds": [0, 1, 2],
    }
    write(TMP / "old_impl.js", build_old_script(backup_lines, new_main_txt))
    write(TMP / "new_impl.js", build_new_script(backup_lines, new_main_txt))
    write(TMP / "payload.json", json.dumps(payload, ensure_ascii=False))

    rc = 0
    for seed in payload["seeds"]:
        write(TMP / "payload.json", json.dumps(dict(payload, seed=seed), ensure_ascii=False))
        r = subprocess.run(["node", str(HARNESS), str(LAYOUT), str(TMP / "old_impl.js"),
                            str(TMP / "new_impl.js"), str(TMP / "payload.json")],
                           capture_output=True, text=True, encoding="utf-8")
        print("\n--- stub seed %s ---" % seed)
        print("\n".join(l for l in r.stdout.splitlines()
                        if "GATE" in l or "TOTAL" in l or "cases=" in l
                        or "globals reached" in l) or r.stdout)
        if r.stderr.strip():
            print("STDERR:", r.stderr.strip()[:1200])
        if r.returncode != 0:
            rc = 1
            # surface the first concrete failure for diagnosis
            print("\n".join(r.stdout.splitlines()[-40:]))
            break
    print("\nRESULT:", "ALL PHASE-4.2a GATES PASSED" if rc == 0 else "FAILED")
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
