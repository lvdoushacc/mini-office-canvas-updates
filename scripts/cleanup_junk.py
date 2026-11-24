# -*- coding: utf-8 -*-
"""Remove local junk only: __pycache__, *.pyc, *.log, *.tmp, *.temp, *.bak*, and .pytest_cache.
Does not touch data/, assets/, output/, workflows/, .env, or user configs.
"""
from __future__ import annotations

import argparse
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKIP_DIRS = {
    ".git",
    ".venv",
    "venv",
    "node_modules",
    "data",
    "assets",
    "output",
    "workflows",
    "backups",
    "python",
}


def should_skip(path: Path) -> bool:
    return bool(set(path.parts) & SKIP_DIRS)


def main() -> int:
    ap = argparse.ArgumentParser(description="XXPD junk cleanup")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    removed: list[Path] = []

    # Clean directories
    for pattern in ["__pycache__", ".pytest_cache"]:
        for p in ROOT.rglob(pattern):
            if should_skip(p):
                continue
            removed.append(p)
            if not args.dry_run:
                shutil.rmtree(p, ignore_errors=True)

    # Clean files
    for pattern in ["*.pyc", "*.pyo", "*.log", "*.tmp", "*.temp", "*.bak*"]:
        for p in ROOT.rglob(pattern):
            if should_skip(p):
                continue
            removed.append(p)
            if not args.dry_run:
                p.unlink(missing_ok=True)

    for p in removed:
        print(("DRY " if args.dry_run else "RM  ") + str(p.relative_to(ROOT)))
    print(f"Total: {len(removed)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
