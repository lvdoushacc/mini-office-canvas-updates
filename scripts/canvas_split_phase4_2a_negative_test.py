# -*- coding: utf-8 -*-
"""Negative self-test for phase 4.2a gate B.

Gate B only means something if it is *sensitive*: a changed layout number must
make it fail. This script mutates one number at a time inside the moved
imageLayout body on the NEW side only, re-runs the phase-4.2a check, and asserts
gate B reports a difference.

Each mutation declares what must happen:
  caught    -> gate B must FAIL (the inputs reach that term and it decides output)
  inert     -> gate B may PASS, but only with a written proof that no input can
               ever observe the change (those are the dead operands of Math.max)
An `inert` claim is checked mechanically: the script proves it by evaluating the
dominance inequality over the whole legal scale range, so it cannot quietly rot
into a coverage hole if someone later changes the neighbouring constant.

Usage:
    python scripts/canvas_split_phase4_2a_negative_test.py
It reads the live canvas-layout.js, writes mutated copies into the system temp dir
and points the phase-4.2a check at them, so nothing under static/ is ever modified.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TMP = Path(tempfile.gettempdir()) / "xxpd_canvas_split_p42a_neg"
CHECK = ROOT / "scripts" / "canvas_split_phase4_2a_check.py"

MAIN_FILE = ROOT / "static" / "canvas" / "js" / "smart-canvas.js"
LAYOUT_FILE = ROOT / "static" / "canvas" / "js" / "modules" / "canvas-layout.js"

# (label, exact source fragment, replacement, expected)
MUTATIONS = [
    ("count>1 no-grid col cap 4->5",
     "Math.min(4, Math.max(2, Math.ceil(Math.sqrt(count))))",
     "Math.min(5, Math.max(2, Math.ceil(Math.sqrt(count))))", "caught"),
    ("count===0 thumb 96*s->97*s",
     "thumb:Math.round(96*s),",
     "thumb:Math.round(97*s),", "caught"),
    ("grid width 226*s->227*s",
     "width:Math.max(Math.round(226*s), cols * cell + PAD)",
     "width:Math.max(Math.round(227*s), cols * cell + PAD)", "caught"),
    ("no-grid width 226*s->227*s",
     "const width = Math.max(Math.round(226*s), cols * cell + PAD);",
     "const width = Math.max(Math.round(227*s), cols * cell + PAD);", "inert"),
    ("grid height -8 -> -9",
     "height:visibleRows * cell - 8 + PAD",
     "height:visibleRows * cell - 9 + PAD", "caught"),
    ("cell gap 8 -> 9",
     "const cell = thumb + 8;",
     "const cell = thumb + 9;", "caught"),
    ("PAD 32 -> 33",
     "const PAD = 32;",
     "const PAD = 33;", "caught"),
    ("upload fallback W +1",
     "const fallbackW = isUpload ? EMPTY_UPLOAD_NODE_WIDTH : sizedFallback.w;",
     "const fallbackW = isUpload ? EMPTY_UPLOAD_NODE_WIDTH + 1 : sizedFallback.w;",
     "caught"),
    ("explicit-size gate >40 -> >=40 (grid)",
     "if(Number.isFinite(explicitW) && explicitW > 40 && Number.isFinite(explicitH) && explicitH > 40){\n"
     "                const fittedThumb",
     "if(Number.isFinite(explicitW) && explicitW >= 40 && Number.isFinite(explicitH) && explicitH > 40){\n"
     "                const fittedThumb",
     "caught"),
    ("count===0 explicit gate >24 -> >25",
     "width:Math.round(Number.isFinite(explicitW) && explicitW > 24 ? explicitW : fallbackW),",
     "width:Math.round(Number.isFinite(explicitW) && explicitW > 25 ? explicitW : fallbackW),",
     "caught"),
    ("fittedThumb floor 28 -> 29",
     "const fittedThumb = Math.max(28, Math.floor(",
     "const fittedThumb = Math.max(29, Math.floor(",
     "caught"),
    ("visibleRows cap +1 (grid)",
     "const visibleRows = Math.min(MEDIA_GROUP_MAX_VISIBLE_ROWS, rows);\n"
     "            if(Number.isFinite(explicitW)",
     "const visibleRows = Math.min(MEDIA_GROUP_MAX_VISIBLE_ROWS + 1, rows);\n"
     "            if(Number.isFinite(explicitW)",
     "caught"),
    ("video aspect default 16:9 -> 1:1",
     "settings?.videoAspect || '16:9'",
     "settings?.videoAspect || '1:1'",
     "caught"),
    ("image ratio default 1:1 -> 4:3",
     "settings?.imageRatio || '1:1'",
     "settings?.imageRatio || '4:3'",
     "caught"),
    ("empty-board video fallback 480x270 -> 481x270",
     "(isVid ? { w: 480, h: 270 } : { w: 270, h: 270 })",
     "(isVid ? { w: 481, h: 270 } : { w: 270, h: 270 })",
     "caught"),
    ("empty-board image fallback 270x270 -> 271x270",
     "? { w: 480, h: 270 } : { w: 270, h: 270 }",
     "? { w: 480, h: 270 } : { w: 271, h: 270 }",
     "caught"),
    ("scale source: typed node ignores scale arg",
     "const s = node?.type === 'smart-image' || !node?.type ? mediaNodeDefaultScale(node) : (Number.isFinite(scale) && scale > 0 ? scale : 1);",
     "const s = mediaNodeDefaultScale(node);",
     "caught"),
]


def prove_inert_no_grid_226() -> None:
    """`Math.max(round(226*s), cols*(round(224*s)+8)+32)` in the *no-grid* branch.

    There cols = min(4, max(2, ceil(sqrt(count)))) so cols >= 2. With
    thumb = round(224*s) the second operand is >= 2*(thumb+8)+32 = 2*thumb+48,
    and round(x) > x-0.5 gives 2*thumb+48 > 448*s - 1 + 48 = 448*s + 47 > 227*s
    for every s > 0. So the mutated operand can never win the Math.max.
    """
    base, alt = 224, 227
    bad = []
    for i in range(1, 200001):
        s = i / 1000.0
        second = 2 * (round(base * s) + 8) + 32
        if second <= alt * s:
            bad.append(s)
            break
    if bad:
        raise SystemExit(f"FATAL: 'inert' claim disproved at scale={bad[0]} -> "
                         "the no-grid 226*s operand IS observable, the mutation "
                         "must be reclassified as 'caught'")
    print(f"   inert proof: 2*(round(224*s)+8)+32 > 227*s for all s in "
          f"(0, 200] ({200000} samples) -> no-grid 226*s operand is dead")


def run_check(layout_src: str, main_path: Path, label: str):
    """Write a mutated layout to TMP and run the phase-4.2a check against it."""
    mutated = TMP / f"layout_{re.sub(r'[^a-z0-9]+', '_', label.lower())}.js"
    mutated.write_text(layout_src, encoding="utf-8", newline="\n")
    # the child prints Chinese, so pin its stdout to utf-8 instead of cp936
    env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
    r = subprocess.run([sys.executable, str(CHECK), "--main", str(main_path),
                        "--layout", str(mutated)],
                       capture_output=True, text=True, encoding="utf-8",
                       errors="replace", env=env, cwd=str(ROOT))
    out = (r.stdout or "") + (r.stderr or "")
    m = re.findall(r"^\s+(\S+)\s+cases=(\d+)\s+pass=(\d+)\s+fail=(\d+)$", out, re.M)
    fails = sum(int(f) for _, _, _, f in m)
    cases = sum(int(c) for _, c, _, _ in m)
    gate_b_fail = "GATE B: FAIL" in out
    # anything that is not gate B complaining: a broken load, a static-gate trip
    other = [l for l in out.splitlines()
             if any(k in l for k in ("GATE D FAILURES", "GATE E FAILURES", "Traceback",
                                     "FATAL", "ERROR:", "not defined"))]
    return gate_b_fail, cases, fails, other


def main() -> int:
    main_path, layout_path = MAIN_FILE, LAYOUT_FILE
    layout_src = layout_path.read_text(encoding="utf-8")
    print(f"targets (read-only): main={main_path.name} layout={layout_path.name}")
    TMP.mkdir(parents=True, exist_ok=True)

    prove_inert_no_grid_226()

    # baseline: the unmutated pair must pass
    ok, cases, fails, other = run_check(layout_src, main_path, "baseline")
    if ok or fails or other:
        print(f"   baseline run: gate_b_fail={ok} fails={fails} other={other[:3]}")
        raise SystemExit("FATAL: baseline (unmutated) run does not pass -> "
                         "fix the check before trusting any mutation result")
    print(f"   baseline (no mutation)      : gate B PASS over {cases} cases\n")

    problems = []
    for label, old, new, expect in MUTATIONS:
        n = layout_src.count(old)
        if n != 1:
            problems.append(f"{label}: fragment found {n} times (must be exactly 1)")
            print(f"  [{label:47}] -> SKIP, fragment not unique ({n})")
            continue
        ok, cases, fails, other = run_check(layout_src.replace(old, new, 1),
                                            main_path, label)
        if other:
            problems.append(f"{label}: non-gate-B failure {other[:2]}")
            print(f"  [{label:47}] -> GATE D/E PROBLEM {other[:1]}")
            continue
        if expect == "caught":
            verdict = "OK  (caught)" if ok and fails else "GATE B IS BLIND"
            if not (ok and fails):
                problems.append(f"{label}: mutation not caught (fail={fails})")
        else:
            verdict = "OK  (proved inert)" if not ok else "claimed inert but caught"
            if ok:
                problems.append(f"{label}: 'inert' claim wrong, gate caught it "
                                f"(fails={fails}) -- reclassify as 'caught'")
        print(f"  [{label:47}] -> gate_b_fail={str(ok):5} fails={fails:5} {verdict}")

    ok, cases, fails, other = run_check(layout_src, main_path, "restore")
    print(f"\n   restore check              : {'gate B PASS again' if not ok and not fails else 'STILL FAILING'}")
    if ok or fails:
        problems.append("restored files still fail gate B")

    print(f"\nchecked {len(MUTATIONS)} mutations, {cases // 3} inputs x 3 stub seeds")
    if problems:
        print("NEGATIVE SELF-TEST PROBLEMS:")
        for p in problems:
            print("  -", p)
        return 1
    print("RESULT: GATE B IS SENSITIVE TO EVERY LIVE NUMBER IN imageLayout")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
