# -*- coding: utf-8 -*-
"""Verification for canvas split phase 4.2b (smartGroupThumbLayout -> canvas-layout.js).

Gates A and B run through scripts/canvas_split_phase4_1_harness.js (shared with 4.1 and
4.2a); gates C, D, E are here.

Gate B is built so the *only* difference between the two sandboxes is which
smartGroupThumbLayout runs:
  * OLD  = the pre-split function copied verbatim out of the backup, plus the backup's
           main-file wrappers (i.e. exactly the page as of the end of phase 4.2a);
  * NEW  = the real post-split wrapper plus the module;
  * both share the same constants, the same genuinely-pure callees copied verbatim from
    the backup, and the same parameterised smartGroupImageRefs / smartGroupCompactMembers
    stubs (re-seeded three times), because those two resolve group membership from
    `nodes` and `nodeRect` and therefore must stay in the main file.
The stubs hand out `item = the real image object`, so the harvested data/canvases images
flow into singleImageLayout / groupImageGridLayout unchanged.

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
# smartLayoutDeps() is shared by every layout phase, so its name lists and the gate A
# trap stubs live in one module the newest phase appends to.
from canvas_layout_test_deps import (  # noqa: E402
    PURE_CONSTS, PURE_FNS, TRAP_CONST_NAMES, TRAP_STUB_FNS,
)

ROOT = Path(__file__).resolve().parent.parent


def _flag(name: str):
    for i, a in enumerate(sys.argv):
        if a == name and i + 1 < len(sys.argv):
            return Path(sys.argv[i + 1]).resolve()
    return None


BACKUP = _flag("--backup") or Path(
    r"D:/压缩包/canvas_split_phase4_2b_backup_2026-09-19/smart-canvas.js")
BACKUP_LAYOUT = Path(
    r"D:/压缩包/canvas_split_phase4_2b_backup_2026-09-19/canvas-layout.js")
MAIN = _flag("--main") or (ROOT / "static" / "canvas" / "js" / "smart-canvas.js")
LAYOUT = _flag("--layout") or (ROOT / "static" / "canvas" / "js" / "modules" / "canvas-layout.js")
STATE = ROOT / "static" / "canvas" / "js" / "modules" / "canvas-state.js"
UTILS = ROOT / "static" / "canvas" / "js" / "modules" / "canvas-utils.js"
HTML = ROOT / "static" / "smart-canvas.html"
PROJECT_MANAGER = ROOT / "scripts" / "home" / "managers" / "project-manager.js"
TMP = Path(tempfile.gettempdir()) / "xxpd_canvas_split_p42bcheck"
HARNESS = ROOT / "scripts" / "canvas_split_phase4_1_harness.js"

MOVED = ["smartGroupThumbLayout"]
EXPORTS = [
    "nodeScale", "emptyGenBoardSizeFromAspect", "smartGroupLayoutSize", "mediaLayoutSize",
    "standardImageFixedSize", "singleImageLayout", "groupImageGridLayout",
    "smartNodeInputThumbRows", "smartNodeInputThumbsHeight", "smartNodeLayoutImages",
    "imageLayout", "smartGroupThumbLayout",
]
# Functions that still must remain outside canvas-layout.js. nodeRect moved there in the
# later phase 4.4, so this older regression intentionally does not freeze that decision.
MUST_STAY = ["smartGroupImageRefs", "smartGroupCompactMembers", "smartGroupMembers",
             "smartGroupContainingNode", "arrangeSmartGroupMembers", "addNodeToSmartGroup",
             "absorbImageNodeIntoSmartGroup", "render", "renderConnections",
             "renderMinimap", "applyViewport", "promptNodeMinHeight",
             "promptNodeExpandedHeight", "saveCanvas"]

ORIG_SIG = "function smartGroupThumbLayout(node){"
WRAPPER_PREFIX = "function smartGroupThumbLayout(node){ return window.SmartCanvasLayout"

# The two node-graph callees of the moved function, parameterised and re-seeded so a
# match cannot be an artifact of one lucky member ordering, plus the three stragglers
# that smartLayoutDeps() still names (they are not reachable from smartGroupThumbLayout,
# but the object literal must resolve every identifier).
# Deliberately NOT imported from phase 4.2a: that file's stub set assigns a global
# smartGroupThumbLayout, and a later `globalThis.X = ...` in a concatenated script
# would clobber the hoisted real function on the OLD side.
GROUP_STUBS = """
globalThis.__SEED = 0;
globalThis.__MEMBERS = globalThis.__MEMBERS || {};
globalThis.smartGroupImageRefs = function(group){
  const refs = [];
  // deliberately NO url filter here: smartGroupThumbLayout does its own
  // .filter(ref => ref.item?.url), and refs must be able to contain url-less items or
  // that filter is never observable (a negative self-test proved the gap).
  ((group && group.images) || []).forEach((img, index) => {
    if(img && typeof img === 'object') refs.push({nodeId:group.id, index, source:img, item:img});
  });
  (globalThis.__MEMBERS[(group && group.id)] || []).forEach(node => {
    ((node && node.images) || []).forEach((img, index) => {
      if(img && typeof img === 'object') refs.push({nodeId:node.id, index, source:img, item:img});
    });
  });
  if(__SEED === 1) refs.reverse();
  return refs;
};
globalThis.smartGroupCompactMembers = function(node){
  const members = globalThis.__MEMBERS[(node && node.id)] || [];
  const compact = members.filter(m => m && (m.type === 'smart-prompt' || m.type === 'smart-loop'));
  return __SEED === 2 ? compact.concat(compact) : compact;
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
    old_helper_tail = ("        EMPTY_UPLOAD_NODE_WIDTH, EMPTY_UPLOAD_NODE_HEIGHT, "
                       "MEDIA_GROUP_THUMB_BASE\n    };")
    rebuilt, replaced, i = [], 0, 0
    while i < len(new):
        line = new[i]
        if line.startswith(WRAPPER_PREFIX):
            first = line.rstrip()
            expect = (ORIG_SIG[:-1] + "{ return window.SmartCanvasLayout"
                      ".smartGroupThumbLayout(node, smartLayoutDeps()); }")
            if first != expect:
                raise SystemExit(f"FAIL: unexpected smartGroupThumbLayout wrapper: {line[:110]!r}")
            rebuilt.extend(extract(backup, "smartGroupThumbLayout", "fn").split("\n"))
            replaced += 1
            i += 1
            continue
        rebuilt.append(line)
        i += 1
    joined = "\n".join(rebuilt)
    helper_new_re = re.compile(
        r"        EMPTY_UPLOAD_NODE_WIDTH, EMPTY_UPLOAD_NODE_HEIGHT, MEDIA_GROUP_THUMB_BASE,\n"
        r"(?:        [^\n]*\n)+?\s*\};")
    hits = helper_new_re.findall(joined)
    if len(hits) != 1:
        raise SystemExit(f"FAIL: smartLayoutDeps tail matched {len(hits)} times")
    joined = helper_new_re.sub(old_helper_tail, joined, count=1)
    rebuilt = joined.split("\n")

    print(f"   smartGroupThumbLayout wrapper restored : {replaced} (expected 1)")
    print(f"   smartLayoutDeps reverted               : yes")
    if replaced != 1:
        raise SystemExit("FAIL: smartGroupThumbLayout wrapper not found")
    if rebuilt == backup:
        print("   result                               : IDENTICAL to backup -> PASS")
        return
    print("   result                               : DIFFERS -> FAIL")
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
          f"(phase 4.2b requires {len(EXPORTS)}, later phases may add more)")
    missing_exports = sorted(set(EXPORTS) - set(exported))
    if missing_exports:
        failed.append(f"phase-4.2b exports missing={missing_exports}")
    if set(exported) - set(EXPORTS):
        print(f"   exports added later       : {sorted(set(exported) - set(EXPORTS))}")

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

    stray = [n for n in MUST_STAY
             if not re.search(r"^(?:async )?function " + re.escape(n) + r"\(", main_txt, re.M)
             or re.search(r"^    (?:async )?function " + re.escape(n) + r"\(", layout_txt, re.M)]
    print(f"   must-stay fns still in main / not in module : "
          + ("all OK" if not stray else f"PROBLEM {stray}"))
    if stray:
        failed.append(f"functions that must stay in smart-canvas.js moved or vanished: {stray}")

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
    dom_hit = sorted(set(re.findall(
        r"(?<![.\w$])(document|world|shell|querySelector|addEventListener|requestAnimationFrame)"
        r"\b", code_only)))
    state_hit = sorted(set(re.findall(
        r"(?<![.\w$])(nodes|viewport|canvas|pendingUndo|selectedId)\b(?!\s*:)", code_only)))
    print(f"   implicit DOM                          : {'none -> PASS' if not dom_hit else dom_hit}")
    print(f"   implicit nodes / canvas / viewport    : "
          + ("none -> PASS" if not state_hit else state_hit))
    if dom_hit:
        failed.append(f"canvas-layout.js references DOM: {dom_hit}")
    if state_hit:
        failed.append(f"canvas-layout.js references canvas state: {state_hit}")

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
        failed.append(f"window.* changed lost={sorted(set(wb) - set(wa))} "
                      f"gained={sorted(set(wa) - set(wb))}")

    for mod, path in (("SmartCanvasState", STATE), ("SmartCanvasUtils", UTILS),
                      ("SmartCanvasLayout", LAYOUT)):
        names = set(re.findall(r"^\s{8}([A-Za-z_$][\w$]*): \1,?$", read(path), re.M))
        used = set(re.findall(r"window\." + mod + r"\.([A-Za-z_$][\w$]*)", main_txt))
        print(f"   {mod:22} refs: {len(used):3}  unresolved={sorted(used - names) or 'none'}")
        if used - names:
            failed.append(f"{mod} exports regressed: {sorted(used - names)}")

    # every name smartLayoutDeps() injects must exist in main, a module, or canvas-utils
    helper = re.search(r"function smartLayoutDeps\(\)\{[\s\S]*?\n(\s*)\};", main_txt)
    if not helper:
        failed.append("smartLayoutDeps() not found in smart-canvas.js")
    else:
        body = helper.group(0)
        avail = (set(re.findall(r"^function ([A-Za-z_$][\w$]*)\(", main_txt, re.M))
                 | set(re.findall(r"^(?:const|let|var) ([A-Za-z_$][\w$]*)", main_txt, re.M))
                 | set(re.findall(r"^    function ([A-Za-z_$][\w$]*)\(", layout_txt, re.M))
                 | set(re.findall(r"^    function ([A-Za-z_$][\w$]*)\(", read(UTILS), re.M))
                 | set(re.findall(r"^    function ([A-Za-z_$][\w$]*)\(", read(STATE), re.M)))
        listed = re.sub(r"return\s*\{", "", body.split("{", 1)[1], count=1)
        listed = listed[:listed.rindex("}")].replace("\n", " ")
        names = [n for n in re.split(r"[,\s]+", listed) if n]
        unresolved = sorted(set(names) - avail)
        print(f"   smartLayoutDeps names   : {len(names)}  unresolved={unresolved or 'none'}")
        if unresolved:
            failed.append(f"smartLayoutDeps() injects unknown names: {unresolved}")

    seq = [m.group(1) for m in re.finditer(r'<script src="([^"]+)"', read(HTML))]
    toks = ("canvas-utils.js", "canvas-state.js", "canvas-layout.js", "smart-canvas.js")
    order = [next((i for i, u in enumerate(seq) if t in u), None) for t in toks]
    versioned = [re.search(r"[?&]v=([^\"&]+)", u).group(1)
                 for u in seq if any(t in u for t in toks)]
    frame = re.search(r"const CANVAS_FRAME_VERSION = '([^']+)'", read(PROJECT_MANAGER))
    preview_run = not str(LAYOUT).startswith(str(ROOT / "static"))
    print(f"   load order                : {list(zip(toks, order))}")
    print(f"   ?v= tokens / frame version: {sorted(set(versioned))} / {frame and frame.group(1)}")
    if any(v is None for v in order) or order != sorted(order):
        if preview_run:
            print("   load order check SKIPPED: validating a preview, HTML not updated yet")
        else:
            failed.append(f"load order must be utils->state->layout->main, got {order}")
    else:
        print("   utils -> state -> layout -> main : PASS")
    if preview_run:
        print("   token check SKIPPED: validating a preview")
    elif len(set(versioned)) != 1 or not frame or versioned[0] != frame.group(1):
        failed.append("the four canvas scripts and CANVAS_FRAME_VERSION must share one token")
    else:
        print("   all four scripts + frame version share one token: PASS")

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
    print(f"   parse-time calls to {MOVED[0]} : none -> PASS")


# ---------------------------------------------------------------- fixtures ----
def image_pool(real_nodes):
    pool, seen = [], set()
    for n in real_nodes:
        for img in (n.get("images") or []):
            if isinstance(img, dict) and img.get("url") and img["url"] not in seen:
                seen.add(img["url"])
                pool.append(img)
    return pool


def build_inputs(real_nodes):
    """Group nodes plus the member map the stubbed smartGroupImageRefs reads."""
    pool = image_pool(real_nodes)
    if not pool:
        raise SystemExit("FATAL: no real images harvested from data/canvases")
    nodes, members, k = [], {}, 0

    def add(node, member_list):
        nonlocal k
        node["id"] = f"g{k}"
        members[node["id"]] = member_list
        nodes.append(node)
        k += 1

    def imgs(n, offset=0):
        return [dict(pool[(offset + i) % len(pool)]) for i in range(n)]

    def media_members(n, offset=0):
        return [{"id": f"m{offset}_{i}", "type": "smart-image", "images": imgs(1, offset + i)}
                for i in range(n)]

    def compact_members(np_=0, nl=0):
        out = [{"id": f"p{i}", "type": "smart-prompt", "text": "x"} for i in range(np_)]
        out += [{"id": f"l{i}", "type": "smart-loop", "count": 2} for i in range(nl)]
        return out

    sizes = [{}, {"w": 150, "h": 130}, {"w": 149, "h": 129}, {"w": 150, "h": 129},
             {"w": 149, "h": 130}, {"w": 340, "h": 286}, {"w": 900, "h": 700},
             {"w": 72, "h": 56}, {"w": 0, "h": 0}, {"w": -50, "h": -50},
             {"w": "400", "h": "300"}, {"w": None, "h": None}, {"w": 40, "h": 40},
             {"w": 151, "h": 131}, {"w": 1e308, "h": 200}, {"w": 150.6, "h": 130.4},
             # large enough that groupImageGridLayout's 100000 thumb cap binds
             {"w": 1e6, "h": 1e6}, {"w": 250000, "h": 250000}]
    scales = [{}, {"scale": 0}, {"scale": -1}, {"scale": "abc"}, {"scale": None},
              {"scale": 1}, {"scale": 0.5}, {"scale": 1.6}, {"scale": 2.5}, {"scale": 12}]
    flags = [{}, {"gridSplitGroup": True}, {"isFrameGroup": True},
             {"gridSplitGroup": True, "isFrameGroup": True},
             {"gridSplitChild": True}, {"type": "smart-group"},
             {"type": "smart-group", "isFrameGroup": True}, {"nodeKind": "upload"}]

    # 1. image-only groups across the count and size space (no members). Big counts get
    #    a shorter size list so the payload stays a sane size.
    for cnt in [0, 1, 2, 3, 4, 5, 6, 9, 12, 17, 25]:
        for size in (sizes if cnt <= 6 else sizes[:8]):
            for sc in scales[:5]:
                node = {"images": imgs(cnt)}
                node.update(size)
                node.update(sc)
                add(node, [])
    # 2. groups whose images come from members (the 素材组 / 分组 case)
    for mc in [0, 1, 2, 3, 5, 8]:
        for pc in [0, 1, 3]:
            for size in sizes[:8]:
                mem = media_members(mc) + compact_members(pc, 1 if pc else 0)
                node = {"images": [], "items": [m["id"] for m in mem]}
                node.update(size)
                add(node, mem)
    # 3. mixed: own images + media members + compact members
    for own in [0, 1, 3]:
        for mc in [0, 2, 4]:
            for pc in [0, 2]:
                for size in sizes[:6]:
                    mem = media_members(mc, offset=own) + compact_members(pc)
                    node = {"images": imgs(own), "items": [m["id"] for m in mem]}
                    node.update(size)
                    add(node, mem)
    # 4. structural flags / degenerate payloads
    for flag in flags:
        for cnt in [0, 1, 4]:
            for size in sizes[:6]:
                node = {"images": imgs(cnt)}
                node.update(flag)
                node.update(size)
                add(node, media_members(2) + compact_members(1))
    for odd in [{"images": [None, {"nope": 1}]},
                {"images": [{"url": ""}, {"url": ""}]},
                {"images": [{"url": "/a.png"}], "items": None},
                {"images": [{"url": "/a.png"}], "items": []},
                {"images": [{"url": "/a.png"}], "items": ["missing-member"]},
                {"images": [{"url": "/a.png", "natural_w": 0, "natural_h": 0}]},
                {"images": [{"url": "/a.png", "kind": "video", "natural_w": 1920,
                             "natural_h": 1080}]},
                {"images": [{"url": "/a.png"}], "items": [{"bad": 1}]},
                {"images": "str"}, {"items": "str"}, {"images": None},
                {"images": [{"url": "/a.png"}], "w": 150, "h": 130, "scale": 1e-9},
                {"images": [{"url": "/a.png"}], "w": 151, "h": 130}]:
        add(dict(odd), [])
    # 6. url-less / half-empty image sets, and groups whose `items` is not an array.
    #    Both families exist because a negative self-test showed the moved function's
    #    own `.filter(ref => ref.item?.url)` and its `Array.isArray(node?.items)` guard
    #    were unreachable with the earlier inputs.
    urlless = [[{"nope": 1}], [{"url": ""}], [{"nope": 1}, {"nope": 2}],
               [{"url": "/a.png"}, {"nope": 1}], [{"url": "/a.png"}, {"url": ""}],
               [{"natural_w": 800, "natural_h": 600}], [{"url": 0}], [{"url": None}],
               [{"url": "/a.png"}, {"url": "/b.png"}, {"nope": 1}],
               # natural-size-less images: this is where singleImageLayout starts to
               # care about the node argument, so "pass {}" vs "pass node" is visible
               [{"url": "/plain.png"}], [{"url": "/p2.png"}, {"url": "/p3.png"}]]
    for im in urlless:
        for extra in ({}, {"w": 340, "h": 286}, {"w": 150, "h": 130},
                      {"w": 149, "h": 129}, {"w": 300, "h": 300}):
            add({"images": list(im), **extra}, [])
            mem = [{"id": "mm", "type": "smart-image", "images": list(im)},
                   {"id": "pp", "type": "smart-prompt"}]
            add({"images": [], "items": ["mm", "pp"], **extra}, mem)
            add({"images": [], "items": "not-an-array", **extra}, mem)
            add({"images": [], "items": {"0": "mm"}, **extra}, mem)
            add({"images": [], "items": None, **extra}, mem)
    # 7. real group-shaped nodes built out of real canvas nodes
    for n in real_nodes[:60]:
        if not isinstance(n, dict) or not n.get("id"):
            continue
        base = {"images": imgs(1)}
        node = {"images": [dict(i) for i in (n.get("images") or []) if isinstance(i, dict)]}
        if node["images"]:
            add(node, [{"id": n["id"] + "-c", "type": "smart-prompt"}])
            add({**base, "w": n.get("w"), "h": n.get("h")}, media_members(2))
    return nodes, members


def common_prelude(backup_lines, new_main_txt, members_json):
    parts = [read(UTILS), read(STATE), phase2_alias_shim(), ""]
    parts.append(f"globalThis.__MEMBERS = {members_json};")
    parts.append(extract(backup_lines, "settings", "let"))
    for c in PURE_CONSTS:
        parts.append(extract(backup_lines, c, "const"))
    for f in PURE_FNS:
        try:
            parts.append(extract(backup_lines, f, "fn"))
        except SystemExit:
            raise SystemExit(f"FATAL: pure callee {f} not found in the backup")
    parts.append(GROUP_STUBS)
    parts.append("var window = globalThis;")
    helper = re.search(re.escape("// canvas-layout.js 需要的布局常量与少量外部依赖仍属主文件")
                       + r"[\s\S]*?\n\}", new_main_txt)
    if not helper:
        raise SystemExit("FATAL: smartLayoutDeps helper not found in smart-canvas.js")
    parts.append(helper.group(0))
    return parts


def build_old_script(backup_lines, new_main_txt, members_json) -> str:
    parts = common_prelude(backup_lines, new_main_txt, members_json)
    parts.append(read(BACKUP_LAYOUT))
    for name in [e for e in EXPORTS if e not in MOVED]:
        m = re.search(r"^function " + re.escape(name) +
                      r"\([^)]*\)\{ return window\.SmartCanvasLayout\." + re.escape(name) +
                      r"\(.*\); \}$", "\n".join(backup_lines), re.M)
        if not m:
            raise SystemExit(f"FATAL: backup wrapper for {name} not found")
        parts.append(m.group(0).replace("window.SmartCanvasLayout.", "SmartCanvasLayout."))
    parts.append(extract(backup_lines, "smartGroupThumbLayout", "fn"))
    return "\n".join(parts) + "\n"


def build_new_script(backup_lines, new_main_txt, members_json) -> str:
    parts = common_prelude(backup_lines, new_main_txt, members_json)
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

    if "--skip-c" in sys.argv:
        print("\nC. lossless reconstruction: SKIPPED (--skip-c; superseded by the "
              "latest phase's own gate C)")
    else:
        gate_c()
    gate_d()
    gate_e()

    nodes, members = build_inputs(real_nodes)
    groups = [dict(name="smartGroupThumbLayout", inputs=nodes,
                   call="globalThis.smartGroupThumbLayout(x)")]
    total = len(nodes)
    print(f"comparisons={total} x 3 stub seeds = {total * 3}")
    print(f"member maps={len(members)}, total member nodes="
          f"{sum(len(v) for v in members.values())}")

    backup_lines = read(BACKUP).split("\n")
    new_main_txt = read(MAIN)
    members_json = json.dumps(members, ensure_ascii=False)
    consts_src = "\n".join(extract(backup_lines, c, "const") for c in PURE_CONSTS)
    consts_expr = "{" + TRAP_CONST_NAMES + "}"
    fn_deps = "{ " + TRAP_STUB_FNS + " }"
    payload = {
        "utilsFile": str(UTILS),
        "constsSrc": consts_src,
        "constsExpr": consts_expr,
        "trapFnDepsExpr": fn_deps,
        "trapArgSets": [[[], 1, {}], [[], 1, {"type": "smart-image"}],
                        [[{"url": "/a.png"}], 1, None],
                        [[{"url": "/a.png"}, {"url": "/b.png"}], 2, {"type": "smart-image"}],
                        [[{"url": "/a.png"}], 1, {"type": "smart-group"}],
                        [[], 1, {"type": "smart-loop", "imageInput": True}],
                        [[{"url": "/a.png", "grid": {"type": "grid-split", "cols": 2, "rows": 2}}],
                         1, {"w": 600, "h": 600}]],
        "trapArgSetsByExport": {
            "smartGroupThumbLayout": [
                [{}],
                [{"images": []}],
                [{"id": "a", "images": [{"url": "/a.png", "natural_w": 800,
                                         "natural_h": 600}]}],
                [{"id": "b", "images": [{"url": "/a.png"}, {"url": "/b.png"}]}],
                [{"id": "c", "images": [{"url": "/a.png", "natural_w": 1024,
                                         "natural_h": 512}] * 3, "w": 340, "h": 286}],
                [{"id": "d", "images": [{"url": "/a.png"}, {"url": "/b.png"}],
                  "members": [{"id": "p", "type": "smart-prompt"}]}],
                [{"id": "e", "gridSplitGroup": True,
                  "images": [{"url": "/a.png"}]}],
                [None], ["str"],
            ],
        },
        "groups": groups,
        "seeds": [0, 1, 2],
    }
    write(TMP / "old_impl.js", build_old_script(backup_lines, new_main_txt, members_json))
    write(TMP / "new_impl.js", build_new_script(backup_lines, new_main_txt, members_json))

    rc = 0
    for seed in payload["seeds"]:
        write(TMP / "payload.json", json.dumps(dict(payload, seed=seed), ensure_ascii=False))
        r = subprocess.run(["node", str(HARNESS), str(LAYOUT), str(TMP / "old_impl.js"),
                            str(TMP / "new_impl.js"), str(TMP / "payload.json")],
                           capture_output=True, text=True, encoding="utf-8", errors="replace")
        print(f"\n--- stub seed {seed} ---")
        print("\n".join(l for l in r.stdout.splitlines()
                        if "GATE" in l or "TOTAL" in l or "cases=" in l
                        or "globals reached" in l) or r.stdout)
        if r.stderr.strip():
            print("STDERR:", r.stderr.strip()[:1200])
        if r.returncode != 0:
            rc = 1
            print("\n".join(r.stdout.splitlines()[-40:]))
            break

    print("\nRESULT:", "ALL PHASE-4.2b GATES PASSED" if rc == 0 else "FAILED")
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
