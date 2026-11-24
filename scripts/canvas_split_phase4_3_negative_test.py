# -*- coding: utf-8 -*-
"""Sensitivity battery for canvas split phase 4.3 (canvas-renderer.js).

Gate B compares rendered SVG strings and post-call class lists, so it only means
something if changing a stroke width, a colour, a class token or a curve constant makes
it fail. This script mutates one thing at a time inside the moved drawing code (NEW side
only) and requires gate B to report a difference.

Every mutation here is expected to be CAUGHT: unlike phase 4.2a's dead `Math.max`
operand, each of these literals reaches the output string or the toggled class, so there
is nothing to declare inert. If a run reports one as blind, the fix is a new scenario
family in canvas_split_phase4_3_check.py -- not an inert claim.

Also checks gate A: deleting a name from the module's deps destructure must make the
bare-vm trap name exactly that dependency.

Usage:
    python scripts/canvas_split_phase4_3_negative_test.py
    python scripts/canvas_split_phase4_3_negative_test.py --main F --renderer F

Mutated copies go to the system temp dir; nothing under static/ is modified.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHECK = ROOT / "scripts" / "canvas_split_phase4_3_check.py"
MAIN_FILE = ROOT / "static" / "canvas" / "js" / "smart-canvas.js"
RENDERER_FILE = ROOT / "static" / "canvas" / "js" / "modules" / "canvas-renderer.js"
TMP = Path(tempfile.gettempdir()) / "xxpd_canvas_split_p43_neg"

MUTATIONS = [
    # ---- curve geometry / stroke numbers -------------------------------------------
    ("curve dx floor 50 -> 51", "Math.max(50, Math.abs(tx - fx) * 0.45)",
     "Math.max(51, Math.abs(tx - fx) * 0.45)"),
    ("curve factor 0.45 -> 0.5 (dx)", "Math.max(50, Math.abs(tx - fx) * 0.45)",
     "Math.max(50, Math.abs(tx - fx) * 0.5)"),
    ("curve dy floor 36 -> 37", "Math.max(36, Math.abs(ty - fy) * 0.45)",
     "Math.max(37, Math.abs(ty - fy) * 0.45)"),
    ("control point tx-dx -> tx+dx", "${tx-dx} ${ty}", "${tx+dx} ${ty}"),
    ("stroke width input 1.4 -> 1.5", "kind === 'input' ? '1.4' : '1.2'",
     "kind === 'input' ? '1.5' : '1.2'"),
    ("stroke width base 1.2 -> 1.3", "kind === 'input' ? '1.4' : '1.2'",
     "kind === 'input' ? '1.4' : '1.3'"),
    ("hit stroke-width 16 -> 17", 'stroke-width="16"', 'stroke-width="17"'),
    ("end circle r 2.6 -> 2.7", 'r="2.6"', 'r="2.7"'),
    ("pending opacity .82 -> .83", "isPendingLine ? '.82' : '1'",
     "isPendingLine ? '.83' : '1'"),
    ("end circle opacity .66 -> .67", 'opacity=".66"', 'opacity=".67"'),
    ("cascade colour #16a34a -> …4b", "'#16a34a'", "'#16a34b'"),
    ("history colour 0.46 -> 0.47", "rgba(100,116,139,0.46)", "rgba(100,116,139,0.47)"),
    ("input colour 0.62 -> 0.63", "rgba(100,116,139,0.62)", "rgba(100,116,139,0.63)"),
    ("flow colour 0.62 -> 0.63", "rgba(148,163,184,0.62)", "rgba(148,163,184,0.63)"),
    ("hit stroke transparent -> black", 'stroke="transparent"', 'stroke="black"'),
    ("fill none -> fill", 'fill="none"></path>', 'fill></path>'),
    ("reduceMotion threshold 24 -> 25", "activeCascadeCount > 24",
     "activeCascadeCount > 25"),
    # ---- class tokens (选中 / 隐藏 / 动画状态) ---------------------------------------
    ("layer class connection-layer", 'class="connection-layer ', 'class="connection-laye '),
    ("reduce-motion class token", "conn-reduce-motion", "conn-reduce-motio"),
    ("pending class token", "'conn-pending'", "'conn-pending2'"),
    ("cascade class token", "? 'conn-cascade' : ''", "? 'conn-cascade2' : ''"),
    ("cascade done class token", "'conn-cascade-done'", "'conn-cascade-done2'"),
    ("cascade wait class token", "'conn-cascade-wait'", "'conn-cascade-wait2'"),
    ("cascade active class token", "'conn-cascade-active'", "'conn-cascade-active2'"),
    ("history class token", "? 'conn-history' : ''", "? 'conn-history2' : ''"),
    ("selected class in cls list", "isSelectedLine ? 'conn-selected' : ''",
     "isSelectedLine ? 'conn-selected2' : ''"),
    ("conn-line class token", 'class="${cls} conn-line"', 'class="${cls} conn-lin"'),
    ("conn-hit class token", 'class="conn-hit${selCls}"', 'class="conn-hi${selCls}"'),
    ("conn-end class token", 'class="conn-end${selCls}"', 'class="conn-en${selCls}"'),
    ("selCls suffix dropped", 'const selCls = isSelectedLine ? \' conn-selected\' : \'\';',
     'const selCls = \'\';'),
    # ---- data attributes and escaping ---------------------------------------------
    ("data-conn-index attribute",
     'class="${cls} conn-line" data-conn-index="${dataIndex}"',
     'class="${cls} conn-line" data-conn-indx="${dataIndex}"'),
    ("data-targets attribute", 'data-targets="${targetIds}"', 'data-target="${targetIds}"'),
    ("escapeAttr dropped on from", 'data-from="${escapeAttr(item.from)}"',
     'data-from="${item.from}"'),
    ("indices join ',' -> ';'", "item.indices.join(',')", "item.indices.join(';')"),
    # ---- merge / hide semantics ----------------------------------------------------
    ("intra-group hide dropped", "if(fromScope && fromScope === toScope) return;",
     "if(false) return;"),
    ("merge key drops kind", "`${conn.from}|${toScope}|${kind}`", "`${conn.from}|${toScope}`"),
    ("member-target test loosened", "toScope && toScope !== conn.to", "toScope"),
    ("history exempted from scope lookup (to side)",
     "const toScope = kind === 'history' ? '' : smartGroupScopeId(conn.to);",
     "const toScope = smartGroupScopeId(conn.to);"),
    ("pending target test dropped", "item.targets.some(t => nodeById.get(t)?.pending)", "false"),
    ("selected test ignores targets",
     "selectedConnIds.has(item.from) || selectedConnIds.has(item.toId) || item.targets.some(t => selectedConnIds.has(t))",
     "selectedConnIds.has(item.from) || selectedConnIds.has(item.toId)"),
    # ---- updateConnectionSelection --------------------------------------------------
    ("selection toggle class name", "path.classList.toggle('conn-selected', on)",
     "path.classList.toggle('conn-selected2', on)"),
    ("selection loses its String() mapping",
     "const selected = new Set(selectedNodeIds().map(String));",
     "const selected = new Set(selectedNodeIds());"),
    ("targets split ',' -> '|'", "String(path.dataset.targets || '').split(',')",
     "String(path.dataset.targets || '').split('|')"),
    ("connIndex guard dropped", "if(on && path.dataset.connIndex){", "if(on){"),
    ("hit/end selector narrowed", "svg.querySelectorAll('path.conn-hit, circle.conn-end')",
     "svg.querySelectorAll('path.conn-hit')"),
    ("line selector broken", "svg.querySelectorAll('path.conn-line')",
     "svg.querySelectorAll('circle.conn-line')"),
    # ---- connectionMidpoint --------------------------------------------------------
    ("history midpoint loses /2", "{x:(fr.x + fr.width / 2 + tr.x + tr.width / 2) / 2,",
     "{x:(fr.x + fr.width + tr.x + tr.width) / 2,"),
    ("history midpoint y formula", "y:(fr.y + fr.height + tr.y) / 2}",
     "y:(fr.y + fr.height + tr.y + tr.height) / 2}"),
    ("flow midpoint x formula", "return {x:(fr.x + fr.width + tr.x) / 2,",
     "return {x:(fr.x + tr.x) / 2,"),
    ("flow midpoint y formula", "y:(fr.y + fr.height / 2 + tr.y + tr.height / 2) / 2};",
     "y:(fr.y + fr.height + tr.y + tr.height) / 2};"),
    ("midpoint always takes history branch", "if((conn.kind || 'flow') === 'history'){",
     "if(true){"),
]

INJECTION_MUTATIONS = ["nodes", "canvas", "world", "escapeAttr", "nodeRect",
                       "selectedNodeIds", "smartGroupScopeId", "cascadeConnectionKeys",
                       "smartCascadeEdgeState", "smartCascadeRunPath", "loopInsertPreview"]

HISTORY_FROM = "const fromScope = kind === 'history' ? '' : smartGroupScopeId(conn.from);"
HISTORY_TO = "const toScope = kind === 'history' ? '' : smartGroupScopeId(conn.to);"
HIDE_TEST = "if(fromScope && fromScope === toScope) return;"


def prove_inert_history_from_guard(src: str) -> None:
    """Why dropping only the *from*-side history guard cannot change anything.

    The from scope is read in exactly one place, the intra-group hide test
    `if(fromScope && fromScope === toScope) return;`. For a history connection the to-side
    keeps its `kind === 'history' ? ''` guard, so toScope is '' there; the hide test then
    needs fromScope truthy AND equal to '' -- impossible. So the from-side exemption is
    redundant as long as these three source facts hold, which is re-checked on every run.
    The symmetric to-side mutation sits in MUTATIONS and must be caught, which is what
    shows the guard pair -- not a missing input family -- is what makes this one inert.
    """
    for name, frag in (("from-side guard", HISTORY_FROM), ("to-side guard", HISTORY_TO),
                       ("hide test", HIDE_TEST)):
        if src.count(frag) != 1:
            raise SystemExit(f"FATAL: the inert proof no longer holds, {name} occurs "
                             f"{src.count(frag)} times. Reclassify the from-side mutation "
                             "as 'caught' and add scenarios if needed.")
    print("   inert proof: toScope stays '' for kind==='history' and the hide test needs "
          "fromScope truthy AND === toScope -> the from-side exemption cannot bind")


# mutations that provably cannot change output, each with the proof it relies on
INERT_MUTATIONS = [(
    "history exempted from scope lookup (from side)",
    HISTORY_FROM, "const fromScope = smartGroupScopeId(conn.from);",
    prove_inert_history_from_guard,
)]


def run_check(main_path: Path, renderer_src: str, label: str) -> dict:
    mutated = TMP / f"renderer_{re.sub(r'[^a-z0-9]+', '_', label.lower())}.js"
    mutated.write_text(renderer_src, encoding="utf-8", newline="\n")
    env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
    r = subprocess.run([sys.executable, str(CHECK), "--main", str(main_path),
                        "--renderer", str(mutated), "--skip-c"],
                       capture_output=True, text=True, encoding="utf-8",
                       errors="replace", env=env, cwd=str(ROOT))
    out = (r.stdout or "") + (r.stderr or "")
    m = re.findall(r"^\s+(\S+)\s+cases=(\d+)\s+pass=(\d+)\s+fail=(\d+)", out, re.M)
    reached = re.search(r"globals reached for : \[(.*?)\]", out)
    return {
        "cases": sum(int(c) for _, c, _, _ in m),
        "fails": sum(int(f) for _, _, _, f in m),
        "gate_b_fail": "GATE B: FAIL" in out,
        "gate_a_fail": "GATE A: FAIL" in out,
        "reached": reached.group(1) if reached else "",
        "other": [l for l in out.splitlines()
                  if any(k in l for k in ("GATE D FAILURES", "GATE E FAILURES", "Traceback",
                                          "FATAL", "ERROR:"))],
    }


def drop_dep_from_preambles(src: str, drop: str):
    """Rebuild every `const {...} = deps;` line without `drop`.

    Rebuilding from the name list (instead of splicing text) avoids leaving a leading or
    trailing comma behind, and covers deps that appear in more than one preamble.
    """
    lines = src.split("\n")
    touched = 0
    for i, ln in enumerate(lines):
        s = ln.strip()
        if not (s.startswith("const {") and s.endswith("} = deps;")):
            continue
        inner = s[len("const {"):s.rindex("}")].strip()
        names = [n.strip() for n in inner.split(",") if n.strip()]
        if drop not in names:
            continue
        keep = [n for n in names if n != drop]
        if not keep:
            raise SystemExit(f"FATAL: dropping {drop} would empty a preamble")
        lines[i] = ln[:ln.index("const {")] + "const {" + ", ".join(keep) + "} = deps;"
        touched += 1
    return "\n".join(lines), touched


def main() -> int:
    argv = sys.argv

    def arg(name):
        i = argv.index(name) + 1 if name in argv else -1
        return Path(argv[i]).resolve() if i > 0 else None

    only = argv[argv.index("--only") + 1].lower() if "--only" in argv else None

    main_path = arg("--main") or MAIN_FILE
    renderer_path = arg("--renderer") or RENDERER_FILE
    src = renderer_path.read_text(encoding="utf-8")
    TMP.mkdir(parents=True, exist_ok=True)
    print(f"targets (read-only): main={main_path.name} renderer={renderer_path.name}")

    prove_inert_history_from_guard(src)
    base = run_check(main_path, src, "baseline")
    if base["gate_b_fail"] or base["fails"] or base["gate_a_fail"] or base["other"]:
        print(f"   baseline: {base}")
        raise SystemExit("FATAL: the unmutated pair does not pass -> fix the check first")
    print(f"   baseline (no mutation)   : gates A+B PASS over {base['cases']} comparisons\n")

    problems = []
    for label, old, new in MUTATIONS:
        if only and only not in label.lower():
            continue
        n = src.count(old)
        if n != 1:
            problems.append(f"{label}: fragment occurs {n} times (must be exactly 1)")
            print(f"  [{label:38}] -> SKIP, fragment not unique ({n})")
            continue
        res = run_check(main_path, src.replace(old, new, 1), label)
        if res["other"]:
            problems.append(f"{label}: non-equivalence failure {res['other'][:2]}")
            print(f"  [{label:38}] -> GATE D/E PROBLEM {res['other'][:1]}")
            continue
        ok = res["gate_b_fail"] and res["fails"]
        if not ok:
            problems.append(f"{label}: mutation not caught (fail={res['fails']})")
        print(f"  [{label:38}] -> gate_b_fail={str(res['gate_b_fail']):5} "
              f"fails={res['fails']:5} {'OK  (caught)' if ok else 'GATE B IS BLIND'}")

    for label, old, new, proof in INERT_MUTATIONS:
        if src.count(old) != 1:
            problems.append(f"inert {label}: fragment occurs {src.count(old)} times")
            print(f"  [{label:38}] -> SKIP, fragment not unique")
            continue
        proof(src)
        res = run_check(main_path, src.replace(old, new, 1), label)
        if res["other"]:
            problems.append(f"inert {label}: non-equivalence failure {res['other'][:2]}")
            continue
        ok = not res["gate_b_fail"] and not res["fails"]
        if not ok:
            problems.append(f"inert {label}: proof wrong, gate caught it "
                            f"(fails={res['fails']}) -- reclassify as 'caught'")
        print(f"  [{label:38}] -> gate_b_fail={str(res['gate_b_fail']):5} "
              f"fails={res['fails']:5} "
              f"{'OK  (proved inert)' if ok else 'claimed inert but caught'}")

    # gate A: dropping a dep from the destructure must be named by the bare-vm trap
    for drop in INJECTION_MUTATIONS:
        if only and only not in ("gate a", "all"):
            break
        mutated, touched = drop_dep_from_preambles(src, drop)
        if touched == 0:
            problems.append(f"gate A {drop}: no preamble declares it")
            print(f"  [gate A: drop {drop:25}] -> SKIP, not destructured")
            continue
        if mutated == src:
            problems.append(f"gate A {drop}: removal was a no-op")
            continue
        res = run_check(main_path, mutated, f"gateA-{drop}")
        if res["other"]:
            problems.append(f"gate A {drop}: non-gate-A failure {res['other'][:2]}")
            print(f"  [gate A: drop {drop:25}] -> GATE D/E PROBLEM {res['other'][:1]}")
            continue
        named = drop in res["reached"]
        ok = res["gate_a_fail"] and named
        if not ok:
            problems.append(f"gate A {drop}: not reported (gate_a_fail={res['gate_a_fail']}, "
                            f"reached={res['reached'][:120]})")
        print(f"  [gate A: drop {drop:25}] -> gate_a_fail={str(res['gate_a_fail']):5} "
              f"named={str(named):5} {'OK' if ok else 'GATE A IS BLIND'}")

    done = run_check(main_path, src, "restore")
    print(f"\n   restore check            : "
          f"{'gates A+B PASS again' if not (done['gate_a_fail'] or done['gate_b_fail']) else 'STILL FAILING'}")
    if done["gate_a_fail"] or done["gate_b_fail"] or done["fails"]:
        problems.append("restored files still fail")

    print(f"\nchecked {len(MUTATIONS)} drawing mutations + {len(INJECTION_MUTATIONS)} "
          f"injection mutations, {base['cases']} comparisons per run")
    if problems:
        print("NEGATIVE SELF-TEST PROBLEMS:")
        for p in problems:
            print("  -", p)
        return 1
    print("RESULT: GATE B IS SENSITIVE TO EVERY CLASS, COLOUR AND NUMBER IN THE DRAWING "
          "LAYER, AND GATE A NAMES EVERY MISSING INJECTION")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
