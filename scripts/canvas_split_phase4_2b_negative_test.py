# -*- coding: utf-8 -*-
"""Sensitivity battery for canvas split phase 4.2b.

Gate B only means something if a changed number makes it fail, and gate A only means
something if a dependency that is *not* injected actually shows up. This script proves
both, mechanically, instead of trusting the gates to be green.

  * number mutations: change one literal inside the moved smartGroupThumbLayout on the
    NEW side only and require gate B to report a difference.
  * injection mutations: delete one name from the module's deps destructure preamble, so
    the body reaches for a bare identifier, and require gate A to name exactly that dep.

A mutation that is NOT caught must be justified as inert before it can be accepted (see
phase 4.2a's canvas_split_phase4_2a_negative_test.py for the pattern, where a dead
Math.max operand is proven by re-checking an inequality on every run). Nothing in
smartGroupThumbLayout is inert: every literal here reaches the returned width/height/
thumb, so every mutation below is declared "caught" and the run fails otherwise.

Usage:
    python scripts/canvas_split_phase4_2b_negative_test.py
    python scripts/canvas_split_phase4_2b_negative_test.py --main F --layout F

Mutated copies are written to the system temp dir; nothing under static/ is modified.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHECK = ROOT / "scripts" / "canvas_split_phase4_2b_check.py"
MAIN_FILE = ROOT / "static" / "canvas" / "js" / "smart-canvas.js"
LAYOUT_FILE = ROOT / "static" / "canvas" / "js" / "modules" / "canvas-layout.js"
TMP = Path(tempfile.gettempdir()) / "xxpd_canvas_split_p42b_neg"

# The moved function shares two exact lines with imageLayout, so these mutations carry
# the neighbouring line to stay unique (the script asserts exactly one occurrence).
GRID_COLS = "        const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(count))));\n" \
            "        const rows = Math.ceil(count / cols);\n" \
            "        const visibleRows = Math.min(maxVisibleRows, rows);"
HAS_EXPLICIT = ("        const hasExplicit = Number.isFinite(explicitW) "
                "&& explicitW >= SMART_GROUP_MIN_WIDTH\n"
                "            && Number.isFinite(explicitH) && explicitH >= SMART_GROUP_MIN_HEIGHT;")


GRID_COLS_BLOCK = (GRID_COLS, GRID_COLS.replace("Math.min(4,", "Math.min(5,"))
GRID_COLS_FLOOR_BLOCK = (GRID_COLS, GRID_COLS.replace("Math.max(2,", "Math.max(3,"))
HAS_EXPLICIT_W_BLOCK = (HAS_EXPLICIT, HAS_EXPLICIT.replace(">= SMART_GROUP_MIN_WIDTH",
                                                           "> SMART_GROUP_MIN_WIDTH"))
HAS_EXPLICIT_H_BLOCK = (HAS_EXPLICIT, HAS_EXPLICIT.replace(">= SMART_GROUP_MIN_HEIGHT",
                                                           "> SMART_GROUP_MIN_HEIGHT"))

# (label, fragment, replacement, expected: "caught" | "inert:<proof-name>")
MUTATIONS = [
    ("summarySpace 28 -> 29", "const summarySpace = 28;", "const summarySpace = 29;", "caught"),
    ("outerPad 32 -> 33", "const outerPad = 32;", "const outerPad = 33;", "caught"),
    ("single thumb 96*s -> 97*s", "thumb:Math.round(96 * scale),",
     "thumb:Math.round(97 * scale),", "caught"),
    ("innerW floor 24 -> 25", "innerW:Math.max(24, Math.round(explicitW - outerPad)),",
     "innerW:Math.max(25, Math.round(explicitW - outerPad)),", "inert:explicit-size-floors"),
    ("innerH floor 24 -> 25",
     "innerH:Math.max(24, Math.round(explicitH - outerPad - summarySpace))",
     "innerH:Math.max(25, Math.round(explicitH - outerPad - summarySpace))",
     "inert:explicit-size-floors"),
    ("gap 8 -> 9", "const gap = 8;", "const gap = 9;", "caught"),
    ("maxVisibleRows cap +1", "? count : SMART_GROUP_MAX_VISIBLE_ROWS;",
     "? count : SMART_GROUP_MAX_VISIBLE_ROWS + 1;", "caught"),
    ("fitted W floor 72 -> 73", "Math.max(72, explicitW - outerPad)",
     "Math.max(73, explicitW - outerPad)", "inert:explicit-size-floors"),
    ("fitted H floor 56 -> 57", "Math.max(56, explicitH - outerPad - summarySpace)",
     "Math.max(57, explicitH - outerPad - summarySpace)", "inert:explicit-size-floors"),
    ("grid thumb base +1", "Math.round(MEDIA_GROUP_THUMB_BASE * scale)",
     "Math.round((MEDIA_GROUP_THUMB_BASE + 1) * scale)", "caught"),
    ("grid cols cap 4 -> 5", GRID_COLS_BLOCK[0], GRID_COLS_BLOCK[1], "caught"),
    ("grid cols floor 2 -> 3", GRID_COLS_FLOOR_BLOCK[0], GRID_COLS_FLOOR_BLOCK[1], "caught"),
    ("gridH -gap -> -gap+1", "const gridH = visibleRows * cell - gap;",
     "const gridH = visibleRows * cell - gap + 1;", "caught"),
    ("gridW col gaps (cols-1) -> (cols-2)", "cols * thumb + (cols - 1) * gap",
     "cols * thumb + (cols - 2) * gap", "caught"),
    ("hasExplicit W >= -> >", HAS_EXPLICIT_W_BLOCK[0], HAS_EXPLICIT_W_BLOCK[1], "caught"),
    ("hasExplicit H >= -> >", HAS_EXPLICIT_H_BLOCK[0], HAS_EXPLICIT_H_BLOCK[1], "caught"),
    ("maxThumb 100000 -> 99999", "100000, 0, gap, maxVisibleRows",
     "99999, 0, gap, maxVisibleRows", "caught"),
    ("count===1 visibleRows 1 -> 2", "                visibleRows:1,\n",
     "                visibleRows:2,\n", "caught"),
    ("single height +1", "innerH:single.height", "innerH:single.height + 1", "caught"),
    ("frame guard dropped", "if(node?.gridSplitGroup || node?.isFrameGroup ||",
     "if(node?.gridSplitGroup || node?.bogusFrame ||", "caught"),
    ("items array guard dropped", "(!Array.isArray(node?.items) || !node.items.length)",
     "(!node.items || !node.items.length)", "caught"),
    ("refs url filter dropped",
     ".filter(ref => ref.item?.url);\n        if(!refs.length) return null;",
     ".filter(ref => ref.item !== undefined);\n        if(!refs.length) return null;", "caught"),
    ("singleImageLayout gets the group node, not {}",
     "singleImageLayout(refs[0].item, {}, scale, deps)",
     "singleImageLayout(refs[0].item, node, scale, deps)", "caught"),
]

# names whose absence from the deps destructure gate A must report
INJECTION_MUTATIONS = ["MEDIA_GROUP_THUMB_BASE", "smartGroupCompactMembers",
                       "SMART_GROUP_MAX_VISIBLE_ROWS", "mediaNodeDefaultScale"]


def prove_explicit_size_floors(layout_src: str, main_src: str) -> None:
    """Why four Math.max floors inside smartGroupThumbLayout can never bind.

    All four sit in an `if(hasExplicit)` branch, and hasExplicit requires
    explicitW >= SMART_GROUP_MIN_WIDTH and explicitH >= SMART_GROUP_MIN_HEIGHT. The
    guarded expressions are `explicitW - outerPad` and
    `explicitH - outerPad - summarySpace`, so their minima over the legal domain are
    MIN_WIDTH - outerPad and MIN_HEIGHT - outerPad - summarySpace. Both numbers are read
    out of the live files here, so if anyone changes a constant and a floor becomes
    reachable, this proof fails loudly and the four mutations have to be reclassified as
    "caught" (with inputs added) instead of rotting into a silent blind spot.
    """
    body = layout_src[layout_src.index("function smartGroupThumbLayout("):]
    outer = int(re.search(r"const outerPad = (\d+);", body).group(1))
    summary = int(re.search(r"const summarySpace = (\d+);", body).group(1))
    min_w = float(re.search(r"^const SMART_GROUP_MIN_WIDTH = ([\d.]+);", main_src, re.M).group(1))
    min_h = float(re.search(r"^const SMART_GROUP_MIN_HEIGHT = ([\d.]+);", main_src, re.M).group(1))
    w_min, h_min = min_w - outer, min_h - outer - summary
    # the largest value each mutated floor is ever tried against
    w_floors = (25, 73)     # innerW, groupImageGridLayout's width floor
    h_floors = (25, 57)     # innerH, groupImageGridLayout's height floor
    if not (w_min > max(w_floors) and h_min > max(h_floors)):
        raise SystemExit(
            f"FATAL: the 'inert' floor proof no longer holds (width floor min {w_min} vs "
            f"{max(w_floors)}, height floor min {h_min} vs {max(h_floors)}). Those four "
            "mutations are now observable: reclassify them as 'caught' and add inputs.")
    print(f"   inert proof: hasExplicit implies explicitW-outerPad >= {w_min} > "
          f"max{w_floors} and explicitH-outerPad-summarySpace >= {h_min} > max{h_floors} "
          f"-> 4 floors are dead code")


def run_check(main_path: Path, layout_src: str, label: str) -> dict:
    mutated = TMP / f"layout_{re.sub(r'[^a-z0-9]+', '_', label.lower())}.js"
    mutated.write_text(layout_src, encoding="utf-8", newline="\n")
    # the child prints Chinese, so pin its stdout to utf-8 instead of cp936
    env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
    r = subprocess.run([sys.executable, str(CHECK), "--main", str(main_path),
                        "--layout", str(mutated), "--skip-c"],
                       capture_output=True, text=True, encoding="utf-8",
                       errors="replace", env=env, cwd=str(ROOT))
    out = (r.stdout or "") + (r.stderr or "")
    m = re.findall(r"^\s+(\S+)\s+cases=(\d+)\s+pass=(\d+)\s+fail=(\d+)$", out, re.M)
    reached = re.search(r"globals reached for : \[(.*?)\]", out)
    return {
        "cases": sum(int(c) for _, c, _, _ in m),
        "fails": sum(int(f) for _, _, _, f in m),
        "gate_b_fail": "GATE B: FAIL" in out,
        "gate_a_fail": "GATE A: FAIL" in out,
        "reached": reached.group(1) if reached else "",
        "other": [l for l in out.splitlines()
                  if any(k in l for k in ("GATE D FAILURES", "GATE E FAILURES", "Traceback",
                                          "FATAL", "ERROR:", "not defined ->"))],
    }


def main() -> int:
    argv = sys.argv
    def arg(name):
        i = argv.index(name) + 1 if name in argv else -1
        return Path(argv[i]).resolve() if i > 0 else None

    main_path = arg("--main") or MAIN_FILE
    layout_path = arg("--layout") or LAYOUT_FILE
    layout_src = layout_path.read_text(encoding="utf-8")
    main_src = main_path.read_text(encoding="utf-8")
    TMP.mkdir(parents=True, exist_ok=True)
    print(f"targets (read-only): main={main_path.name} layout={layout_path.name}")

    prove_explicit_size_floors(layout_src, main_src)
    base = run_check(main_path, layout_src, "baseline")
    if base["gate_b_fail"] or base["fails"] or base["gate_a_fail"] or base["other"]:
        print(f"   baseline: {base}")
        raise SystemExit("FATAL: the unmutated pair does not pass -> fix the check first")
    print(f"   baseline (no mutation)   : gates A+B PASS over {base['cases']} comparisons\n")

    problems = []
    for label, old, new, expect in MUTATIONS:
        n = layout_src.count(old)
        if n != 1:
            problems.append(f"{label}: fragment occurs {n} times (must be exactly 1)")
            print(f"  [{label:38}] -> SKIP, fragment not unique ({n})")
            continue
        res = run_check(main_path, layout_src.replace(old, new, 1), label)
        if res["other"]:
            problems.append(f"{label}: non-equivalence failure {res['other'][:2]}")
            print(f"  [{label:38}] -> GATE D/E PROBLEM {res['other'][:1]}")
            continue
        if expect == "caught":
            ok = res["gate_b_fail"] and res["fails"]
            verdict = "OK  (caught)" if ok else "GATE B IS BLIND"
            if not ok:
                problems.append(f"{label}: mutation not caught (fail={res['fails']})")
        else:
            ok = not res["gate_b_fail"]
            verdict = "OK  (proved inert)" if ok else "claimed inert but caught"
            if not ok:
                problems.append(f"{label}: 'inert' claim wrong, gate caught it")
        print(f"  [{label:38}] -> gate_b_fail={str(res['gate_b_fail']):5} "
              f"fails={res['fails']:5} {verdict}")

    # isolate the moved function's deps preamble by anchoring on its unique next line
    preamble_re = re.compile(
        r"([ \t]*const \{)([^}]*)(\} = deps;\n)(?=[ \t]*if\(node\?\.gridSplitGroup)")
    hits = preamble_re.findall(layout_src)
    if len(hits) != 1:
        raise SystemExit(f"FATAL: could not isolate the smartGroupThumbLayout preamble "
                         f"({len(hits)} matches)")
    pre, names, post = hits[0]
    for drop in INJECTION_MUTATIONS:
        if re.search(r"\b" + re.escape(drop) + r"\b", names) is None:
            problems.append(f"gate A {drop}: not in the preamble, cannot test")
            print(f"  [gate A: drop {drop:25}] -> SKIP, name absent")
            continue
        cleaned = re.sub(r"[,\s]*" + re.escape(drop), "", names, count=1)
        if layout_src.count(pre + names + post) != 1:
            problems.append(f"gate A {drop}: preamble fragment not unique")
            continue
        mutated = layout_src.replace(pre + names + post, pre + cleaned + post, 1)
        if mutated == layout_src:
            problems.append(f"gate A {drop}: replacement was a no-op")
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

    done = run_check(main_path, layout_src, "restore")
    print(f"\n   restore check            : "
          f"{'gates A+B PASS again' if not (done['gate_a_fail'] or done['gate_b_fail']) else 'STILL FAILING'}")
    if done["gate_a_fail"] or done["gate_b_fail"] or done["fails"]:
        problems.append("restored files still fail")

    print(f"\nchecked {len(MUTATIONS)} number mutations + {len(INJECTION_MUTATIONS)} "
          f"injection mutations, {base['cases']} comparisons per run")
    if problems:
        print("NEGATIVE SELF-TEST PROBLEMS:")
        for p in problems:
            print("  -", p)
        return 1
    print("RESULT: GATE B IS SENSITIVE TO EVERY NUMBER IN smartGroupThumbLayout "
          "AND GATE A NAMES EVERY MISSING INJECTION")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
