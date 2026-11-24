# -*- coding: utf-8 -*-
"""Verification for canvas split phase 4.3 (connection drawing into canvas-renderer.js).

Moved: renderConnections, updateConnectionSelection, connectionMidpoint.

Gates A and B reuse scripts/canvas_split_phase4_1_harness.js (payload-driven, module global
name comes from payload.moduleGlobal); gates C, D, E are here.

Gate B is built so the *only* difference between the two sandboxes is which implementation
of those three names runs:
  * OLD  = the three functions copied verbatim out of the phase-4.3 backup, i.e. the page
           as of the end of 4.2b;
  * NEW  = the real post-split wrappers + canvas-renderer.js;
  * both sides share the same plumbing: `nodes` / `canvas` / selection / cascade state as
    plain `var` bindings, nodeRect + selectedNodeIds + smartCascadeEdgeState +
    smartGroupScopeId (+ isSmartGroupNode / smartGroupContainingNode) extracted verbatim
    from the backup, the real canvas-layout module for geometry, and one seeded stub for
    cascadeConnectionKeys (whose real body walks the whole cascade graph machinery).
Each scenario is applied inside the sandbox by identical __run* helpers, so the compared
expression is the same text on both sides. updateConnectionSelection is DOM-mutating, so
its comparison covers the resulting class lists of every fake element, not just a return
value.

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
from canvas_layout_test_deps import (  # noqa: E402
    GLOBALS_STUBS, PURE_CONSTS, PURE_FNS, TRAP_CONST_NAMES, TRAP_STUB_FNS,
)

ROOT = Path(__file__).resolve().parent.parent


def _flag(name: str):
    for i, a in enumerate(sys.argv):
        if a == name and i + 1 < len(sys.argv):
            return Path(sys.argv[i + 1]).resolve()
    return None


BACKUP = _flag("--backup") or Path(
    r"D:/压缩包/canvas_split_phase4_3_backup_2026-09-19/smart-canvas.js")
MAIN = _flag("--main") or (ROOT / "static" / "canvas" / "js" / "smart-canvas.js")
RENDERER = _flag("--renderer") or (
    ROOT / "static" / "canvas" / "js" / "modules" / "canvas-renderer.js")
LAYOUT = ROOT / "static" / "canvas" / "js" / "modules" / "canvas-layout.js"
STATE = ROOT / "static" / "canvas" / "js" / "modules" / "canvas-state.js"
UTILS = ROOT / "static" / "canvas" / "js" / "modules" / "canvas-utils.js"
HTML = ROOT / "static" / "smart-canvas.html"
PROJECT_MANAGER = ROOT / "scripts" / "home" / "managers" / "project-manager.js"
TMP = Path(tempfile.gettempdir()) / "xxpd_canvas_split_p43check"
HARNESS = ROOT / "scripts" / "canvas_split_phase4_1_harness.js"

MOVED = ["renderConnections", "updateConnectionSelection", "connectionMidpoint"]
EXPORTS = MOVED
# must stay in smart-canvas.js for this phase (rendering core, minimap, events, saving)
MUST_STAY = ["render", "nodeRect", "applyViewport", "refreshConnectionLayer",
             "scheduleConnectionLayerRefresh", "scheduleInteractionLayerRefresh",
             "bindConnectionEvents", "renderMinimap", "renderMinimapDirect",
             "minimapEventToWorld", "initConnectionLinesToggle", "saveCanvas",
             "promptNodeMinHeight", "promptNodeExpandedHeight"]
# callees copied verbatim from the backup into BOTH sandboxes (real implementations)
SHARED_FNS = ["nodeRect", "selectedNodeIds", "smartCascadeEdgeState", "isSmartGroupNode",
              "smartGroupContainingNode", "smartGroupScopeId"] + PURE_FNS
DEPS_HELPER_START = "// canvas-layout.js 需要的布局常量与少量外部依赖仍属主文件"

# The sandbox's own copy of the state the drawing layer reads. `var` at the top level of a
# vm script really is a global, which is what the OLD (verbatim) functions need; the NEW
# side passes the same values in through rendererDeps().
STATE_DECL = """
var nodes = [];
var canvas = {connections: []};
var selectedId = null;
var selectedIds = [];
var smartCascadeRunPath = null;
var loopInsertPreview = null;
var smartCascadeRuns = new Map();
var world = null;
var viewport = {x: 0, y: 0, scale: 1};
var shell = {clientWidth: 1280, clientHeight: 720};
var SMART_CANVAS_RENDER_BUFFER = 600;
var SMART_CANVAS_ACTIVE_NODE_LIMIT = 24;
var activeComposerSubject = null;
var selectedImage = {nodeId:'', index:-1};
var dragState = null;
function safeScale(value){ return Number(value) > 0 ? Number(value) : 1; }
function nodeHasLiveToolSession(){ return false; }
const escapeAttr = SmartCanvasUtils.escapeHtml;   // same alias as smart-canvas.js:893
"""

# cascadeConnectionKeys walks smartCascadeGraphForTail / cascadeTailForLoop / the run Map,
# i.e. most of the cascade subsystem, so it stays a seeded stub on both sides. It must stay
# rich enough that the cascade class branch is exercised: seed 1 and 2 mark real keys active.
# The three trailing stubs are names smartLayoutDeps() injects but the drawing layer never
# calls; they only have to resolve, so the object literal does not throw.
CASCADE_STUB = """
globalThis.__SEED = 0;
globalThis.cascadeConnectionKeys = function(){
  const keys = new Set();
  if(__SEED === 0) return keys;
  const conns = (canvas && canvas.connections) || [];
  conns.forEach((c, i) => {
    if(__SEED === 1 && i % 2 === 0) keys.add(c.from + '->' + c.to);
    if(__SEED === 2 && (c.kind || 'flow') === 'input') keys.add(c.from + '->' + c.to);
  });
  return keys;
};
globalThis.promptNodeLayoutSize = function(node){ return {width:316, height:240}; };
globalThis.isSmartGroupCompactMember = function(){ return false; };
globalThis.smartLoopHeight = function(){ return 168; };
"""

# Shared plumbing: identical on both sides. Every scenario is applied inside the sandbox,
# then the function under test is called by its plain name.
RUNNER = r"""
globalThis.__apply = function(s){
  nodes = (s.nodes || []).map(n => n && typeof n === 'object' ? n : null).filter(Boolean);
  canvas = {connections: s.connections || [], title: 'sandbox'};
  selectedId = s.selectedId || null;
  selectedIds = (s.selectedIds || []).slice();
  smartCascadeRuns = new Map();
  (s.runs || []).forEach(r => smartCascadeRuns.set(r.id, r));
  smartCascadeRunPath = s.cascadePath || null;
  loopInsertPreview = s.preview || null;
  globalThis.__SEED = s.seed === undefined ? 0 : s.seed;
};
globalThis.__runConnections = function(s){ globalThis.__apply(s); return renderConnections(); };
globalThis.__runMidpoint = function(s){
  globalThis.__apply(s);
  return connectionMidpoint(s.conn === undefined ? s.connections[0] : s.conn);
};
// ---- minimal fake DOM good enough for updateConnectionSelection -----------------------
function El(tag, attrs){
  this.tagName = tag;
  this.dataset = {};
  this.className = attrs['class'] || '';
  Object.keys(attrs).forEach(k => {
    if(k.indexOf('data-') === 0) this.dataset[k.slice(5).replace(/-(\w)/g, (m, c) => c.toUpperCase())] = attrs[k];
  });
  const self = this;
  this.classList = {
    toggle: function(name, on){
      const has = self.className.split(/\s+/).filter(Boolean).indexOf(name) >= 0;
      const next = self.className.split(/\s+/).filter(Boolean).filter(c => c !== name);
      if(on === undefined ? !has : on) next.push(name);
      self.className = next.join(' ');
    }
  };
}
function parseAttrs(str){
  const out = {};
  const re = /([a-zA-Z-]+)="([^"]*)"/g;
  let m;
  while((m = re.exec(str))) out[m[1]] = m[2];
  return out;
}
globalThis.__buildWorld = function(html){
  const els = [];
  const re = /<(path|circle)\b([^>]*)>/g;
  let m;
  while((m = re.exec(html || ''))){
    const attrs = parseAttrs(m[2]);
    if(/conn-line|conn-hit|conn-end/.test(attrs['class'] || '')) els.push(new El(m[1], attrs));
  }
  const svg = {
    children: els,
    querySelector: function(sel){ return sel.indexOf('connection-layer') >= 0 ? svg : null; },
    querySelectorAll: function(sel){
      const wanted = sel.split(',').map(x => x.trim());
      return els.filter(el => wanted.some(w => {
        const tag = w.split('.')[0];
        const cls = (w.split('.')[1] || '').replace(/^\s+|\s+$/g, '');
        // honour the tag the way a real browser does; without this a mutation that breaks
        // a selector ('path.conn-line' -> 'circle.conn-line') looks harmless here
        if(tag && tag !== '*' && tag.toLowerCase() !== el.tagName.toLowerCase()) return false;
        return !cls || el.className.split(/\s+/).indexOf(cls) >= 0;
      }));
    }
  };
  return {world: {querySelector: () => svg}, svg: svg, els: els};
};
globalThis.__runSelection = function(s){
  globalThis.__apply(s);
  const built = s.world === null ? null : globalThis.__buildWorld(
    s.world !== undefined ? s.world : renderConnections());
  world = built ? built.world : null;
  updateConnectionSelection();
  return built ? built.els.map(el => ({t: el.tagName, c: el.className,
                                        i: el.dataset.connIndex || '', f: el.dataset.from || '',
                                        to: el.dataset.to || '', tg: el.dataset.targets || ''}))
               : 'no-world';
};
"""

# Gate A's deps object must be *rich*: if nodes/canvas are empty, renderConnections
# returns after two lines and an uninjected dependency further down the body would never
# surface -- the exact false green phase 4.2a shipped. Same for updateConnectionSelection,
# whose host element has to actually contain paths.
TRAP_DEPS = "{ " + TRAP_STUB_FNS + """
    nodes: [
      {id:'n1', type:'smart-image', x:0, y:0, w:260, h:200, images:[{url:'/a.png', natural_w:800, natural_h:600}]},
      {id:'n2', type:'smart-image', x:600, y:400, w:260, h:200, images:[{url:'/b.png'}], pending:2},
      {id:'n3', type:'smart-group', x:200, y:900, w:340, h:286, items:['n1','n2'], images:[]},
      {id:'n4', type:'smart-video', x:900, y:0, w:480, h:270, images:[{url:'/c.mp4', kind:'video'}]}
    ],
    canvas: {connections: [
      {from:'n1', to:'n2'}, {from:'n1', to:'n4', kind:'input'},
      {from:'n2', to:'n1', kind:'history'}, {from:'n1', to:'n3'},
      {from:'n1', to:'n1'}, {from:'n1', to:'gone'}
    ]},
    selectedNodeIds: function(){ return ['n2']; },
    nodeRect: function(n){
      return {x:Number(n && n.x) || 0, y:Number(n && n.y) || 0,
              width:Number(n && n.w) || 260, height:Number(n && n.h) || 200}; },
    smartGroupScopeId: function(id){ return id === 'n2' ? 'n3' : (id === 'n1' ? 'n3' : ''); },
    cascadeConnectionKeys: function(){ return new Set(['n1->n2', 'n4->n1']); },
    smartCascadeEdgeState: function(k){
      const states = {'n1->n2':'active', 'n4->n1':'done', 'n2->n1':'waiting'};
      return states[k] || ''; },
    smartCascadeRunPath: {states: {'n1->n2':'active', 'n4->n1':'done', 'x->y':'waiting'}},
    loopInsertPreview: {index: 0},
    safeScale: function(v){ return Number(v) > 0 ? Number(v) : 1; },
    viewport: {x:0, y:0, scale:1},
    shell: {clientWidth:1280, clientHeight:720},
    viewportWidth: 1280,
    viewportHeight: 720,
    SMART_CANVAS_RENDER_BUFFER: 600,
    nodeHasLiveToolSession: function(){ return false; },
    activeComposerSubject: null,
    selectedImage: {nodeId:'', index:-1},
    selectedId: null,
    dragState: null,
    escapeAttr: function(v){ return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
    world: {querySelector: function(s){
      if(s.indexOf('connection-layer') < 0) return null;
      return {querySelectorAll: function(){ return [
        {dataset:{from:'n1', to:'n2', targets:'n2', connIndex:'0'},
         className:'conn-line', classList:{toggle: function(){}}},
        {dataset:{connIndex:'0'}, className:'conn-hit', classList:{toggle: function(){}}},
        {dataset:{connIndex:'0'}, className:'conn-end', classList:{toggle: function(){}}}
      ]; }};
    }},
}"""


def gate_c() -> None:
    print("\nC. lossless reconstruction")
    backup = read(BACKUP).split("\n")
    new = read(MAIN).split("\n")
    helper_txt = ("// canvas-renderer.js 需要的数据与函数仍属主文件：全部按引用注入，本模块不持有第二份\n"
                  "// nodes / canvas / 选中状态。取值发生在调用期，函数声明会提升，不会踩 TDZ。\n"
                  "function rendererDeps(){\n    return {\n"
                  "        nodes, canvas, world, escapeAttr, nodeRect, selectedNodeIds,\n"
                  "        smartGroupScopeId, cascadeConnectionKeys, smartCascadeEdgeState,\n"
                  "        smartCascadeRunPath, loopInsertPreview\n    };\n}")
    rebuilt, replaced, i = [], 0, 0
    while i < len(new):
        line = new[i]
        if line.startswith("function ") and "){ return window.SmartCanvasRenderer." in line:
            name = line.split("(")[0][len("function "):]
            if name not in MOVED:
                raise SystemExit(f"FAIL: unexpected SmartCanvasRenderer wrapper: {line[:90]!r}")
            rebuilt.extend(extract(backup, name, "fn").split("\n"))
            replaced += 1
            i += 1
            continue
        rebuilt.append(line)
        i += 1
    joined = "\n".join(rebuilt).replace(helper_txt + "\n", "", 1)
    if joined.count("rendererDeps") != 0:
        raise SystemExit("FAIL: rendererDeps() did not disappear cleanly: "
                         f"{joined.count('rendererDeps')} reference(s) left")
    rebuilt = joined.split("\n")
    print(f"   wrappers restored           : {replaced} (expected {len(MOVED)})")
    print(f"   rendererDeps() removed      : yes")
    if replaced != len(MOVED):
        raise SystemExit("FAIL: wrapper count mismatch")
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
    main_txt, rend_txt, backup_txt = read(MAIN), read(RENDERER), read(BACKUP)
    failed = []

    exported = re.findall(r"^\s{8}([A-Za-z_$][\w$]*): \1,?$", rend_txt, re.M)
    print(f"   SmartCanvasRenderer exports : {exported} "
          f"(phase 4.3 requires {EXPORTS}, later phases may add more)")
    missing_exports = sorted(set(EXPORTS) - set(exported))
    if missing_exports:
        failed.append(f"phase-4.3 exports missing={missing_exports}")
    if set(exported) - set(EXPORTS):
        print(f"   exports added later        : {sorted(set(exported) - set(EXPORTS))}")

    bad = []
    for name in EXPORTS:
        defs = re.findall(r"^function " + re.escape(name) + r"\(.*$", main_txt, re.M)
        if len(defs) != 1:
            bad.append(f"{name}: {len(defs)} top-level defs in smart-canvas.js")
        elif "window.SmartCanvasRenderer." + name not in defs[0]:
            bad.append(f"{name}: not a wrapper -> {defs[0][:80]}")
        mdefs = re.findall(r"^    function " + re.escape(name) + r"\(", rend_txt, re.M)
        if len(mdefs) != 1:
            bad.append(f"{name}: {len(mdefs)} defs in canvas-renderer.js")
    if bad:
        failed.append(f"wrapper/definition: {bad}")
    print(f"   wrapper<->definition      : {'OK' if not bad else 'see failures'}")

    stray = [n for n in MUST_STAY
             if not re.search(r"^(?:async )?function " + re.escape(n) + r"\(", main_txt, re.M)
             or re.search(r"^    (?:async )?function " + re.escape(n) + r"\(", rend_txt, re.M)]
    print(f"   must-stay fns in main / not in module : "
          + ("all OK" if not stray else f"PROBLEM {stray}"))
    if stray:
        failed.append(f"functions that must stay in smart-canvas.js moved or vanished: {stray}")

    top = re.findall(r"^(?:const|let|var|function|async function|class)\s+([A-Za-z_$][\w$]*)",
                     rend_txt, re.M)
    print(f"   module top-level globals  : {top or '[]'} (must be empty)")
    if top:
        failed.append(f"canvas-renderer.js declares top-level globals: {top}")
    mstate = re.findall(r"^    (?:const|let|var)\s+([A-Za-z_$][\w$]*)", rend_txt, re.M)
    print(f"   module-level state vars   : {mstate or '[]'} (must be empty)")
    if mstate:
        failed.append(f"canvas-renderer.js holds its own state: {mstate}")

    code_only = strip_noise(rend_txt)
    # the IIFE's own attachment tail legitimately names globalThis/window
    code_only = re.sub(r"\}\)\(typeof globalThis[^;]*;", "", code_only)
    # Identifiers the drawing layer must never name at all: DOM entry points and main-file
    # state it has no business touching. `nodes` / `canvas` / `world` are deliberately NOT
    # listed here -- after the deps destructure the body references them as *local*
    # bindings, which static text cannot tell apart from a global read. Gate A (bare vm,
    # rich injected deps) is what actually proves nothing is reached for free.
    forbidden = (r"(?<![.\w$])(document|window|globalThis|localStorage|getElementById|"
                 r"querySelector|querySelectorAll|addEventListener|requestAnimationFrame|"
                 r"cancelAnimationFrame|smartCascadeRuns|"
                 r"connectionLayerRaf|interactionLayerRaf|minimapContent|"
                 r"pendingUndo|saveCanvas|scheduleSave)\b")
    # `world.querySelectorAll` etc. are property access on the injected handle, allowed;
    # the pattern's (?<![.\w$]) guard already excludes those.
    hits = sorted(set(re.findall(forbidden, code_only)))
    print(f"   forbidden free identifiers : {hits or 'none -> PASS'}")
    if hits:
        failed.append(f"canvas-renderer.js references forbidden identifiers: {hits}")

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
    allowed_later = {"rendererDeps", "interactionDeps", "minimapGeometry", "projectMinimapRect"}
    if set(gained) - allowed_later:
        failed.append(f"unexpected new top-level functions: {set(gained) - allowed_later}")

    wb = sorted(set(re.findall(r"^window\.([A-Za-z_$][\w$]*)\s*=", backup_txt, re.M)))
    wa = sorted(set(re.findall(r"^window\.([A-Za-z_$][\w$]*)\s*=", main_txt, re.M)))
    print(f"   window.* assignments same : {wb == wa} ({len(wa)} entries)")
    if wb != wa:
        failed.append(f"window.* changed lost={sorted(set(wb) - set(wa))} "
                      f"gained={sorted(set(wa) - set(wb))}")

    for mod, path in (("SmartCanvasState", STATE), ("SmartCanvasUtils", UTILS),
                      ("SmartCanvasLayout", LAYOUT), ("SmartCanvasRenderer", RENDERER)):
        names = set(re.findall(r"^\s{8}([A-Za-z_$][\w$]*): \1", read(path), re.M))
        used = set(re.findall(r"window\." + mod + r"\.([A-Za-z_$][\w$]*)", main_txt))
        print(f"   {mod:22} refs: {len(used):3}  unresolved={sorted(used - names) or 'none'}")
        if used - names:
            failed.append(f"{mod} exports regressed: {sorted(used - names)}")

    helper = re.search(r"function rendererDeps\(\)\{[\s\S]*?\n(\s*)\};", main_txt)
    if not helper:
        failed.append("rendererDeps() not found in smart-canvas.js")
    else:
        avail = (set(re.findall(r"^function ([A-Za-z_$][\w$]*)\(", main_txt, re.M))
                 | set(re.findall(r"^(?:const|let|var) ([A-Za-z_$][\w$]*)", main_txt, re.M))
                 | set(re.findall(r"^    function ([A-Za-z_$][\w$]*)\(", read(UTILS), re.M)))
        body = re.sub(r"return\s*\{", "", helper.group(0).split("{", 1)[1], count=1)
        listed = body[:body.rindex("}")].replace("\n", " ")
        dep_names = re.findall(r"(?:^|,)\s*([A-Za-z_$][\w$]*)\s*(?::[^,]+)?", listed)
        alias_names = set(re.findall(r"(?:^|,)\s*([A-Za-z_$][\w$]*)\s*:", listed))
        unresolved = sorted(set(dep_names) - alias_names - avail)
        print(f"   rendererDeps names        : {len(dep_names)}  unresolved={unresolved or 'none'}")
        if unresolved:
            failed.append(f"rendererDeps() injects unknown names: {unresolved}")

    seq = [m.group(1) for m in re.finditer(r'<script src="([^"]+)"', read(HTML))]
    toks = ("canvas-utils.js", "canvas-state.js", "canvas-layout.js",
            "canvas-renderer.js", "smart-canvas.js")
    order = [next((i for i, u in enumerate(seq) if t in u), None) for t in toks]
    versioned = [re.search(r"[?&]v=([^\"&]+)", u).group(1)
                 for u in seq if any(t in u for t in toks)]
    frame = re.search(r"const CANVAS_FRAME_VERSION = '([^']+)'", read(PROJECT_MANAGER))
    preview_run = not str(RENDERER).startswith(str(ROOT / "static"))
    print(f"   load order                : {list(zip(toks, order))}")
    print(f"   ?v= tokens / frame version: {sorted(set(versioned))} / {frame and frame.group(1)}")
    if any(v is None for v in order) or order != sorted(order):
        if preview_run:
            print("   load order check SKIPPED: validating a preview, HTML not updated yet")
        else:
            failed.append(f"load order must be utils->state->layout->renderer->main, got {order}")
    else:
        print("   " + " -> ".join(toks) + ": PASS")
    if preview_run:
        print("   token check SKIPPED: validating a preview")
    elif len(set(versioned)) != 1 or not frame or versioned[0] != frame.group(1):
        failed.append("the five canvas scripts and CANVAS_FRAME_VERSION must share one token")
    else:
        print(f"   all five scripts + frame version share one token: PASS")

    # Every name the module destructures must be supplied BOTH by rendererDeps() and by
    # the gate A trap's deps. A missing trap key is not neutral: the body then dies on a
    # TypeError before reaching the later dependencies, and "0 globals reached" becomes a
    # false green again -- the exact failure mode phase 4.2a shipped with.
    destructured = set()
    for line in rend_txt.split("\n"):
        s = line.strip()
        if s.startswith("const {") and s.endswith("} = deps;"):
            inner = s[len("const {"):s.rindex("}")].strip()
            destructured |= {n.strip() for n in inner.split(",") if n.strip()}
    trap_keys = set(re.findall(r"^    ([A-Za-z_$][\w$]*)\s*:", TRAP_DEPS, re.M))
    trap_keys |= {n.strip() for n in TRAP_CONST_NAMES.split(",")}
    helper_names2 = set()
    h2 = re.search(r"function rendererDeps\(\)\{[\s\S]*?\n(\s*)\};", main_txt)
    if h2:
        b2 = re.sub(r"return\s*\{", "", h2.group(0).split("{", 1)[1], count=1)
        helper_names2 = set(re.findall(
            r"(?:^|,)\s*([A-Za-z_$][\w$]*)\s*(?::[^,]+)?", b2[:b2.rindex("}")]))
    gaps = sorted(d for d in destructured
                  if d not in trap_keys or d not in helper_names2)
    print(f"   destructured deps         : {len(destructured)}  "
          f"missing from trap/rendererDeps: {gaps or 'none -> PASS'}")
    if gaps:
        failed.append(f"deps the module destructures but a supplier lacks: {gaps} "
                      "(gate A would silently stop early)")

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
        # a real parse-time block opens a brace that stays open past this line; a balanced
        # line such as `let x = {a:1};` must not be treated as an opener, otherwise its
        # "block" runs until the next stray `}` and swallows hundreds of function-body lines
        # (that artifact used to hide behind the 38 ranges and mis-flag line 3321).
        if depths[i] != 0 or c.count("{") <= c.count("}"):
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
    print(f"   parse-time calls to {MOVED} : none -> PASS")


# ---------------------------------------------------------------- fixtures ----
def scenario_pool(real_nodes, canvases):
    if not canvases:
        raise SystemExit("FATAL: no real canvases loaded")
    scenarios = []
    # 1. every real canvas, several selection sets, with and without cascade state
    for ci, canvas in enumerate(canvases):
        nodes = [n for n in (canvas.get("nodes") or []) if isinstance(n, dict)]
        conns = [c for c in ((canvas.get("connections") or [])) if isinstance(c, dict)]
        if not nodes:
            continue
        ids = [str(n.get("id")) for n in nodes if n.get("id")]
        sel_sets = [[], ids[:1], ids[:2], ids[-1:], ids]
        cascade_paths = [None, {"states": {}},
                         {"states": {f"{a}->{b}": "active" for a in ids[:3] for b in ids[:3]}}]
        for si, sel in enumerate(sel_sets):
            for pi, path in enumerate(cascade_paths):
                scenarios.append({
                    "nodes": nodes, "connections": conns, "selectedIds": sel,
                    "cascadePath": path, "seed": (si + pi) % 3,
                    "preview": None if si % 2 else ({"index": 0} if conns else None),
                    "runs": [] if pi == 0 else [{"id": "r1", "runPath": path or {"states": {}}}],
                })
    return scenarios


def synthetic_scenarios():
    out = []
    base_nodes = [
        {"id": "a", "type": "smart-image", "x": 0, "y": 0, "w": 260, "h": 200,
         "images": [{"url": "/a.png", "natural_w": 800, "natural_h": 600}]},
        {"id": "b", "type": "smart-image", "x": 500, "y": 300, "w": 260, "h": 200,
         "images": [{"url": "/b.png", "natural_w": 640, "natural_h": 480}]},
        {"id": "c", "type": "smart-video", "x": 1000, "y": 0, "w": 480, "h": 270,
         "images": [{"url": "/c.mp4", "kind": "video"}]},
        {"id": "g", "type": "smart-group", "x": 200, "y": 800, "w": 340, "h": 286,
         "items": ["a", "b"], "images": []},
        {"id": "d&<\"q\"", "type": "smart-image", "x": -400, "y": -400, "w": 10, "h": 10,
         "images": [{"url": "/q.png"}]},
    ]
    conns = [
        {"from": "a", "to": "b"}, {"from": "a", "to": "c", "kind": "input"},
        {"from": "b", "to": "a", "kind": "history"}, {"from": "a", "to": "a"},
        {"from": "a", "to": "missing"}, {"from": "a", "to": "g"},
        {"from": "d&<\"q\"", "to": "b"}, {"from": "a", "to": "d&<\"q\"", "kind": "input"},
    ]
    for sel in ([], ["a"], ["g"], ["a", "b"], ["missing"], ["d&<\"q\""]):
        for seed in (0, 1, 2):
            for extra in ({}, {"preview": {"index": 3}},
                          {"cascadePath": {"states": {"a->b": "running", "b->a": "done"}}},
                          {"cascadePath": {"states": {f"x{i}->y{i}": "active"
                                                     for i in range(30)}}}):
                out.append({"nodes": base_nodes, "connections": conns, "selectedIds": sel,
                            "seed": seed, **extra})
    out += [
        {"nodes": [], "connections": [], "selectedIds": []},
        {"nodes": base_nodes, "connections": [], "selectedIds": []},
        {"nodes": base_nodes[:1], "connections": conns, "selectedIds": []},
        {"nodes": [None, {}, "str"], "connections": [{"from": None, "to": None}],
         "selectedIds": []},
        {"nodes": base_nodes, "connections": [{"from": "a", "to": "b", "kind": "bogus"}],
         "selectedIds": ["b"]},
        # updateConnectionSelection paths: missing svg host, and an explicit hand-made world
        {"nodes": base_nodes, "connections": conns, "selectedIds": ["a"], "world": None},
        {"nodes": base_nodes, "connections": conns, "selectedIds": ["a"],
         "world": ('<path class="conn-line" data-from="a" data-to="b" data-conn-index="0" '
                   'data-targets="b"></path>'
                   '<path class="conn-hit" data-conn-index="0"></path>'
                   '<circle class="conn-end" data-conn-index="0"></circle>')},
        {"nodes": base_nodes, "connections": conns, "selectedIds": [],
         "world": ('<path class="conn-line" data-from="zz" data-to="yy" '
                   'data-conn-index="7"></path>')},
    ]
    mids = []
    for conn in conns + [{"from": "a", "to": "c", "kind": "history"}, {}, None,
                         {"from": "missing", "to": "a"}]:
        mids.append({"nodes": base_nodes, "connections": [conn] if conn else [],
                     "conn": conn, "selectedIds": []})
    return out, mids


def merge_scenarios():
    """Families the first pass could not reach (all found by the negative battery).

    * a source outside a group joining several members -> one merged bucket whose
      `indices` / `targets` hold 2+ entries, so join(',') and split(',') are load bearing
    * two connections from that source with different `kind` -> the merge key's kind part
    * a connection straight to the group itself -> `toScope !== conn.to` matters
    * a history connection between two members -> history is exempted from scope lookup
    * vertically aligned history endpoints -> Math.max(36, ...) floor binds (dy is only
      used by the history curve)
    * a pending target -> conn-pending class and its .82 opacity
    * exactly 25 active cascade states -> the `> 24` reduce-motion threshold, and an
      all-done cascade -> the conn-cascade-done class
    """
    grp = {"id": "g1", "type": "smart-group", "x": 0, "y": 1200, "w": 340, "h": 286,
           "items": ["m1", "m2"], "images": []}
    m1 = {"id": "m1", "type": "smart-image", "x": 100, "y": 1300, "w": 260, "h": 200,
          "images": [{"url": "/m1.png", "natural_w": 800, "natural_h": 600}]}
    m2 = {"id": "m2", "type": "smart-image", "x": 300, "y": 1500, "w": 260, "h": 200,
          "images": [{"url": "/m2.png", "natural_w": 800, "natural_h": 600}]}
    src = {"id": "src", "type": "smart-image", "x": 900, "y": 1300, "w": 260, "h": 200,
           "images": [{"url": "/s.png", "natural_w": 640, "natural_h": 480}]}
    pend = {"id": "pd", "type": "smart-image", "x": 900, "y": 1600, "w": 260, "h": 200,
            "pending": 2, "images": [{"url": "/p.png"}]}
    # history endpoints that line up vertically, so |ty - fy| is 0 and the 36 floor binds
    top = {"id": "top", "type": "smart-image", "x": 100, "y": 0, "w": 260, "h": 200,
           "images": [{"url": "/t.png", "natural_w": 800, "natural_h": 600}]}
    below = {"id": "bel", "type": "smart-image", "x": 100, "y": 200, "w": 260, "h": 200,
             "images": [{"url": "/b.png", "natural_w": 800, "natural_h": 600}]}
    nodes = [grp, m1, m2, src, pend, top, below]
    merged = [{"from": "src", "to": "m1"}, {"from": "src", "to": "m2"}]
    kinds = merged + [{"from": "src", "to": "m1", "kind": "input"}]
    out = []
    for conns in (merged, kinds, merged + [{"from": "src", "to": "g1"}],
                  merged + [{"from": "m1", "to": "m2", "kind": "history"}],
                  [{"from": "src", "to": "pd"}, {"from": "src", "to": "m1"}],
                  [{"from": "top", "to": "bel", "kind": "history"}],
                  [{"from": "bel", "to": "top", "kind": "history"}]):
        for sel in ([], ["src"], ["m1"], ["g1"], ["pd"]):
            out.append({"nodes": nodes, "connections": conns, "selectedIds": sel,
                        "seed": len(out) % 3})
    # exactly at the reduce-motion boundary, and an all-done cascade
    for n in (23, 24, 25, 26):
        states = {f"k{i}->v{i}": "active" for i in range(n)}
        out.append({"nodes": nodes, "connections": merged, "selectedIds": [],
                    "cascadePath": {"states": states}, "seed": 1})
    out.append({"nodes": nodes, "connections": merged, "selectedIds": [],
                "cascadePath": {"states": {"src->m1": "done", "src->m2": "done"}}, "seed": 1})
    out.append({"nodes": nodes, "connections": merged, "selectedIds": ["src"],
                "runs": [{"id": "r", "runPath": {"states": {"src->m1": "waiting"}}}],
                "seed": 2})
    # a hand-made SVG whose paths carry no data-conn-index at all
    out.append({"nodes": nodes, "connections": merged, "selectedIds": ["src"],
                "world": ('<path class="conn-line" data-from="src" data-to="m1" '
                          'data-targets="m1"></path>'
                          '<path class="conn-hit"></path>'
                          '<circle class="conn-end"></circle>')})
    # numeric node ids: the selection path maps ids through String(), and dataset values
    # are always strings, so losing that mapping is only visible with numeric ids
    num_nodes = [{"id": 7, "type": "smart-image", "x": 0, "y": 0, "w": 260, "h": 200,
                  "images": [{"url": "/7.png", "natural_w": 800, "natural_h": 600}]},
                 {"id": 8, "type": "smart-image", "x": 400, "y": 200, "w": 260, "h": 200,
                  "images": [{"url": "/8.png"}]}]
    for sel in ([7], [8], [7, 8], ["7"], []):
        out.append({"nodes": num_nodes, "connections": [{"from": 7, "to": 8}],
                    "selectedIds": sel, "seed": 0})
    return out


def common_prelude(backup_lines, new_main_txt):
    parts = [read(UTILS), read(STATE), phase2_alias_shim(), "", read(LAYOUT)]
    # `settings` is a main-file `let` that smartLayoutDeps() injects; without it every
    # nodeRect call throws, and gate B would compare two identically-broken sides.
    parts.append(extract(backup_lines, "settings", "let"))
    helper = re.search(re.escape(DEPS_HELPER_START) + r"[\s\S]*?\n\}", new_main_txt)
    if not helper:
        raise SystemExit("FATAL: smartLayoutDeps helper not found in smart-canvas.js")
    parts.append(helper.group(0))
    parts.append("var window = globalThis;")
    parts.append(STATE_DECL)
    parts.append(GLOBALS_STUBS)
    parts.append(CASCADE_STUB)
    # real callees, verbatim from the backup, identical on both sides
    for c in PURE_CONSTS:
        parts.append(extract(backup_lines, c, "const"))
    for f in SHARED_FNS:
        try:
            parts.append(extract(backup_lines, f, "fn"))
        except SystemExit:
            raise SystemExit(f"FATAL: shared callee {f} not found in the backup")
    # the 4.1/4.2 main-file wrappers, so nodeRect reaches the real layout module
    for name in ["imageLayout", "nodeScale", "smartNodeLayoutImages", "smartGroupLayoutSize",
                 "emptyGenBoardSizeFromAspect", "mediaLayoutSize", "standardImageFixedSize",
                 "singleImageLayout", "groupImageGridLayout", "smartNodeInputThumbRows",
                 "smartNodeInputThumbsHeight", "smartGroupThumbLayout"]:
        m = re.search(r"^function " + re.escape(name) +
                      r"\([^)]*\)\{ return window\.SmartCanvasLayout\." + re.escape(name) +
                      r"\(.*\); \}$", "\n".join(backup_lines), re.M)
        if not m:
            raise SystemExit(f"FATAL: backup wrapper for {name} not found")
        parts.append(m.group(0).replace("window.SmartCanvasLayout.", "SmartCanvasLayout."))
    return parts


def build_old_script(backup_lines, new_main_txt) -> str:
    parts = common_prelude(backup_lines, new_main_txt)
    for name in MOVED:
        parts.append(extract(backup_lines, name, "fn"))
    parts.append(RUNNER)
    return "\n".join(parts) + "\n"


def build_new_script(backup_lines, new_main_txt) -> str:
    parts = common_prelude(backup_lines, new_main_txt)
    parts.append(read(RENDERER))
    helper = re.search(r"function rendererDeps\(\)\{[\s\S]*?\n\}", new_main_txt)
    if not helper:
        raise SystemExit("FATAL: rendererDeps helper not found in smart-canvas.js")
    parts.append(helper.group(0))
    for name in MOVED:
        m = re.search(r"^function " + re.escape(name) +
                      r"\([^)]*\)\{ return window\.SmartCanvasRenderer\." + re.escape(name) +
                      r"\(.*\); \}$", new_main_txt, re.M)
        if not m:
            raise SystemExit(f"FATAL: wrapper for {name} not found in smart-canvas.js")
        parts.append(m.group(0).replace("window.SmartCanvasRenderer.", "SmartCanvasRenderer."))
    parts.append(RUNNER)
    return "\n".join(parts) + "\n"


def _rel(p: Path) -> str:
    try:
        return str(p.relative_to(ROOT))
    except ValueError:
        return str(p)


def main() -> int:
    print("targets:")
    print(f"  MAIN     = {_rel(MAIN)}")
    print(f"  RENDERER = {_rel(RENDERER)}")

    real_nodes, canvases = load_real_nodes()
    if not real_nodes:
        raise SystemExit("FATAL: no real nodes loaded")

    if "--skip-c" in sys.argv:
        print("\nC. lossless reconstruction: SKIPPED (--skip-c)")
    else:
        gate_c()
    gate_d()
    gate_e()

    synth, mids = synthetic_scenarios()
    merge = merge_scenarios()
    real = scenario_pool(real_nodes, canvases)
    groups = [
        dict(name="renderConnections", inputs=real + synth + merge,
             call="globalThis.__runConnections(x)",
             # a group is only meaningful if it really drew paths -- see the harness note
             pattern="<path ", minClean=0.97, minPat=0.55),
        dict(name="updateConnectionSelection", inputs=real[:40] + synth + merge,
             call="globalThis.__runSelection(x)",
             pattern="conn-selected", minClean=0.97, minPat=0.25),
        dict(name="connectionMidpoint", inputs=real[:60] + mids,
             call="globalThis.__runMidpoint(x)",
             # the harness envelope JSON-stringifies twice, so a returned {x:..} shows up
             # escaped as \"x\": -- match that form, not the raw one
             pattern='x\\":', minClean=0.97, minPat=0.4),
    ]
    total = sum(len(g["inputs"]) for g in groups)
    print(f"comparisons={total} (real canvases={len(real)}, synthetic={len(synth)}, "
          f"merge/edge families={len(merge)}, midpoints={len(mids)})")

    backup_lines = read(BACKUP).split("\n")
    new_main_txt = read(MAIN)
    consts_src = "\n".join(extract(backup_lines, c, "const") for c in PURE_CONSTS)
    payload = {
        "moduleGlobal": "SmartCanvasRenderer",
        "utilsFile": str(UTILS),
        "constsSrc": consts_src,
        "constsExpr": "{" + TRAP_CONST_NAMES + "}",
        "trapFnDepsExpr": TRAP_DEPS,
        "trapArgSets": [[], [{}], [{"connections": []}], [None]],
        "trapArgSetsByExport": {
            "renderConnections": [[]],
            "updateConnectionSelection": [[]],
            "connectionMidpoint": [[None], [{}], [{"from": "a", "to": "b"}],
                                   [{"from": "a", "to": "b", "kind": "history"}]],
        },
        "groups": groups,
        "seeds": [None],
    }
    write(TMP / "old_impl.js", build_old_script(backup_lines, new_main_txt))
    write(TMP / "new_impl.js", build_new_script(backup_lines, new_main_txt))
    write(TMP / "payload.json", json.dumps(payload, ensure_ascii=False))
    r = subprocess.run(["node", str(HARNESS), str(RENDERER), str(TMP / "old_impl.js"),
                        str(TMP / "new_impl.js"), str(TMP / "payload.json")],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    print("\n".join(l for l in r.stdout.splitlines()
                    if "GATE" in l or "TOTAL" in l or "cases=" in l
                    or "globals reached" in l or "ERROR" in l) or r.stdout)
    if r.stderr.strip():
        print("STDERR:", r.stderr.strip()[:1200])
    if r.returncode != 0:
        print("\n".join(r.stdout.splitlines()[-40:]))
        print("\nRESULT: FAILED")
        return 1
    print("\nRESULT: ALL PHASE-4.3 GATES PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
