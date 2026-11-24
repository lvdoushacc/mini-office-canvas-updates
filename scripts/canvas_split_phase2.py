# -*- coding: utf-8 -*-
"""Canvas split phase 2: move pure utility / media helpers into modules/canvas-utils.js.

Strategy
--------
* Every moved function keeps its original name in smart-canvas.js as a thin
  delegating wrapper, so all existing call sites, `window` globals and HTML
  `onclick` handlers keep working unchanged.
* Immutable lookup tables used only by moved functions move with them and are
  deleted from smart-canvas.js.
* The generated module is wrapped in an IIFE and exposed as
  `window.SmartCanvasUtils`; it reads nothing from smart-canvas.js at load time,
  so it is safe to load *before* the main file.

Usage:  python scripts/canvas_split_phase2.py [--apply]
Without --apply it only reports (dry run).
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "static" / "canvas" / "js" / "smart-canvas.js"
OUT_DIR = ROOT / "static" / "canvas" / "js" / "modules"
OUT = OUT_DIR / "canvas-utils.js"

APPLY = "--apply" in sys.argv

# (name, kind, section) -- kind: 'fn' function declaration, 'const' top-level const block
# 'drop' entries are removed from smart-canvas.js without a wrapper.
TARGETS = [
    ("escapeHtml", "fn", "HTML 转义"),

    ("smartOriginalMediaUrl", "fn", "媒体 URL 解析"),
    ("smartMediaPreviewUrl", "fn", "媒体 URL 解析"),
    ("outputUrlLooksVideo", "fn", "媒体 URL 解析"),
    ("proxiedMediaUrl", "fn", "媒体 URL 解析"),
    ("displayMediaUrl", "fn", "媒体 URL 解析"),
    ("browserCanPlayHevc", "fn", "媒体 URL 解析"),
    ("isLocalCanvasMediaUrl", "fn", "媒体 URL 解析"),
    ("playbackVideoUrl", "fn", "媒体 URL 解析"),
    ("sameMediaSrc", "fn", "媒体 URL 解析"),
    ("looksLikeImageMediaUrl", "fn", "媒体 URL 解析"),
    ("isRemoteVideoReferenceUrl", "fn", "媒体 URL 解析"),
    ("localDisplayUrlForMediaItem", "fn", "媒体 URL 解析"),
    ("imageForDisplay", "fn", "媒体 URL 解析"),

    ("loadSmartOriginalImageDimensions", "fn", "媒体尺寸缓存"),

    ("isVideoMediaItem", "fn", "媒体类型判定"),
    ("isInlineVideoActive", "fn", "媒体类型判定"),
    ("isAudioMediaItem", "fn", "媒体类型判定"),
    ("isTextMediaItem", "fn", "媒体类型判定"),
    ("isFileMediaItem", "fn", "媒体类型判定"),
    ("mediaKindForFile", "fn", "媒体类型判定"),
    ("mediaKindForItem", "fn", "媒体类型判定"),

    ("safeExportFileName", "fn", "文件名处理"),
    ("fileNameFromUrl", "fn", "文件名处理"),
    ("isMachineGeneratedMediaName", "fn", "文件名处理"),
    ("cleanMediaBaseName", "fn", "文件名处理"),
    ("escapeSemanticRegex", "fn", "文件名处理"),
    ("appendSemanticActionSuffix", "fn", "文件名处理"),
    ("extensionForMediaItem", "fn", "文件名处理"),
    ("downloadNameForMediaItem", "fn", "文件名处理"),
    ("smartImageNameFromUrl", "fn", "文件名处理"),
    ("imageNameLabel", "fn", "文件名处理"),
    ("imageResolutionLabel", "fn", "文件名处理"),

    ("copyTextWithCopyEvent", "fn", "剪贴板"),
    ("copyTextWithTextarea", "fn", "剪贴板"),
    ("clipboardMatchesText", "fn", "剪贴板"),
    ("copyTextToClipboard", "fn", "剪贴板"),

    ("downloadBlob", "fn", "下载工具"),

    ("STANDARD_IMAGE_RESOLUTIONS", "const", "尺寸/比例计算"),
    ("STANDARD_VIDEO_RESOLUTIONS", "const", "尺寸/比例计算"),
    ("normalizeImageRatio", "fn", "尺寸/比例计算"),
    ("getImageDimensions", "fn", "尺寸/比例计算"),
    ("getVideoDimensions", "fn", "尺寸/比例计算"),
    ("parseSizeValue", "fn", "尺寸/比例计算"),
    ("parseRatioValue", "fn", "尺寸/比例计算"),
    ("normalizedSizeLabel", "fn", "尺寸/比例计算"),
    ("mediaCoverWindow", "fn", "尺寸/比例计算"),
    ("getImageCropRatioValue", "fn", "尺寸/比例计算"),
    ("getSmartGhostDimensions", "fn", "尺寸/比例计算"),
    ("parseSmartAspectRatio", "fn", "尺寸/比例计算"),

    ("formatMediaFileSize", "fn", "格式化"),
    ("getMediaFormatName", "fn", "格式化"),
    ("formatRunDuration", "fn", "格式化"),
    ("formatSmartVideoDurationTag", "fn", "格式化"),
]

# entries removed from smart-canvas.js without leaving a wrapper
DROP_NAMES = {"STANDARD_IMAGE_RESOLUTIONS", "STANDARD_VIDEO_RESOLUTIONS"}
# duplicate definition that must simply disappear (byte-identical to the first one)
DROP_DUPLICATE = {"normalizeImageRatio"}

CONST_NOTE = (
    "// STANDARD_IMAGE_RESOLUTIONS / STANDARD_VIDEO_RESOLUTIONS 已移至 "
    "modules/canvas-utils.js（仅 getImageDimensions / getVideoDimensions 使用）"
)

# ---------------------------------------------------------------------------
# minimal JS lexer helpers
# ---------------------------------------------------------------------------

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


def balance(text: str) -> int:
    return text.count("{") - text.count("}")


def find_block(lines, start_idx: int) -> int:
    """Return inclusive end line index of the top-level block starting at start_idx."""
    first = lines[start_idx].rstrip()
    if not first.endswith("{"):
        # genuine one-liner such as: function escapeHtml(str){ return ...; }
        if balance(strip_noise(first)) == 0:
            return start_idx
        raise SystemExit(f"FATAL: cannot classify definition at line {start_idx + 1}: {first[:80]}")
    for j in range(start_idx + 1, len(lines)):
        if lines[j] in ("}", "};"):
            return j
    raise SystemExit(f"FATAL: unterminated block at line {start_idx + 1}")


def split_params(sig: str):
    """Split a parameter list on top-level commas."""
    parts, depth, quote, cur = [], 0, None, []
    for ch in sig:
        if quote:
            cur.append(ch)
            if ch == quote:
                quote = None
            continue
        if ch in "\"'`":
            quote = ch
            cur.append(ch)
            continue
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append("".join(cur))
            cur = []
            continue
        cur.append(ch)
    if "".join(cur).strip():
        parts.append("".join(cur))
    return [p.strip() for p in parts]


def extract_signature(block: str, name: str):
    """Return (is_async, [param_names], raw_signature)."""
    m = re.match(r"(async\s+)?function\s+" + re.escape(name) + r"\s*\(", block)
    if not m:
        raise SystemExit(f"FATAL: bad signature for {name}: {block[:80]}")
    is_async = bool(m.group(1))
    i = m.end() - 1  # at '('
    depth, quote, j = 0, None, i
    while j < len(block):
        ch = block[j]
        if quote:
            if ch == "\\":
                j += 2
                continue
            if ch == quote:
                quote = None
        elif ch in "\"'`":
            quote = ch
        elif ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                break
        j += 1
    raw = block[i + 1:j]
    names = []
    for p in split_params(raw):
        if not p:
            continue
        base = p.split("=", 1)[0].strip()
        if not re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", base):
            raise SystemExit(f"FATAL: unsupported parameter {p!r} in {name}")
        names.append(base)
    return is_async, names, raw


# ---------------------------------------------------------------------------

JS_BUILTINS = {
    "Array", "Boolean", "Date", "Error", "Function", "JSON", "Map", "Math",
    "Number", "Object", "Promise", "Proxy", "Reflect", "RegExp", "Set",
    "String", "Symbol", "WeakMap", "WeakSet", "BigInt", "globalThis",
    "undefined", "null", "true", "false", "NaN", "Infinity",
    "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURIComponent",
    "decodeURIComponent", "encodeURI", "decodeURI", "escape", "unescape",
    "setTimeout", "clearTimeout", "setInterval", "clearInterval",
    "queueMicrotask", "structuredClone", "fetch", "console", "arguments",
    "this", "super", "typeof", "instanceof", "new", "delete", "void", "in",
    "of", "if", "else", "for", "while", "do", "switch", "case", "default",
    "break", "continue", "return", "function", "async", "await", "try",
    "catch", "finally", "throw", "const", "let", "var", "class", "extends",
    "yield", "static", "get", "set",
}

BROWSER_GLOBALS = {
    "window", "document", "navigator", "location", "history", "screen",
    "Image", "URL", "URLSearchParams", "Blob", "File", "FileReader",
    "FormData", "Audio", "Video", "HTMLElement", "Element", "Node",
    "Event", "CustomEvent", "MouseEvent", "PointerEvent", "KeyboardEvent",
    "DragEvent", "DataTransfer", "AbortController", "AbortSignal",
    "requestAnimationFrame", "cancelAnimationFrame", "requestIdleCallback",
    "getComputedStyle", "matchMedia", "localStorage", "sessionStorage",
    "indexedDB", "crypto", "TextEncoder", "TextDecoder", "Worker",
    "MessageChannel", "WebSocket", "XMLHttpRequest", "performance",
    "CSS", "DOMParser", "Canvas", "ImageBitmap", "OffscreenCanvas",
    "alert", "confirm", "prompt", "atob", "btoa", "MutationObserver",
    "ResizeObserver", "IntersectionObserver", "Path2D", "Map",
}

FORBIDDEN_MAIN_GLOBALS = {
    "nodes", "canvas", "viewport", "settings", "world", "shell", "composer",
    "render", "renderConnections", "renderMinimap", "saveCanvas",
    "scheduleSave", "loadCanvas", "toast", "smartLoopContext",
    "previewNavState", "selectedImage", "activeImageCrop", "uid", "tr", "trf",
    "refreshIcons", "smartNodeFloatingMenu", "mediaFileSizeCache", "SIZE_MAP",
    "capturePendingUndo", "normalizeLegacySmartNode", "mediaItemForStorage",
    "stripImageGenerationMeta", "settingsForStorage", "mediaLayoutSize",
    "isSmartGroupNode", "smartGroupImageRefs", "updateToolbarInfoField",
    "isSmartUploadNode", "escapeAttr",
}


def _write(path: Path, text: str) -> None:
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)



def _guard_already_applied(text: str) -> None:
    """Refuse to run twice: the moved names are now delegating wrappers.

    Re-running would lift the generated wrapper bodies into the module and
    silently destroy the real implementations, so stop instead.
    """
    hits = re.findall(r"\{ return window\.SmartCanvasUtils\.", text)
    if hits:
        raise SystemExit(
            f"FATAL: smart-canvas.js already delegates to window.SmartCanvasUtils "
            f"in {len(hits)} places - this transform has already been applied. "
            f"Restore the backup first if you meant to redo it.")


def main() -> int:
    with open(SRC, "r", encoding="utf-8", newline="") as fh:
        raw = fh.read()
    assert "\r\n" not in raw, "unexpected CRLF line endings"
    _guard_already_applied(raw)
    lines = raw.split("\n")

    located = []
    for name, kind, section in TARGETS:
        if kind == "fn":
            prefixes = (f"function {name}(", f"async function {name}(")
        else:
            prefixes = (f"const {name} =", f"const {name}=", f"let {name} =")
        starts = [i for i, ln in enumerate(lines) if ln.startswith(prefixes)]
        if not starts:
            raise SystemExit(f"FATAL: {name} not found")
        for idx, s in enumerate(starts):
            e = find_block(lines, s)
            # include contiguous preceding // comments
            c = s
            while c - 1 >= 0 and lines[c - 1].strip().startswith("//"):
                c -= 1
            located.append({
                "name": name, "kind": kind, "section": section,
                "start": s, "end": e, "cstart": c,
                "duplicate": idx > 0,
                "body": "\n".join(lines[s:e + 1]),
                "comments": "\n".join(lines[c:s]),
            })

    located.sort(key=lambda b: b["start"])

    # ---- safety assertions -------------------------------------------------
    moved_names = {b["name"] for b in located if b["kind"] == "fn" and not b["duplicate"]}
    problems = []
    for b in located:
        if b["duplicate"]:
            continue
        body = b["body"]
        for bad in ("arguments", "eval(", "with("):
            if bad in strip_noise(body):
                problems.append(f"{b['name']}: uses {bad!r}")
        if re.search(r"(?<![.\w])this(?![\w])", strip_noise(body)):
            problems.append(f"{b['name']}: uses `this`")
        clean = strip_noise(body)
        used = set(re.findall(r"[A-Za-z_$][A-Za-z0-9_$]*", clean))
        # locals declared inside the body
        local = set(re.findall(r"\b(?:const|let|var|function|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)", clean))
        params = set()
        if b["kind"] == "fn":
            _, pnames, _ = extract_signature(body, b["name"])
            params = set(pnames)
        # function-expression / arrow params and catch bindings are hard to
        # enumerate; only report names that are NOT builtins/browser globals/
        # moved names/locals/params and ARE in the forbidden main-global set.
        leaked = (used - JS_BUILTINS - BROWSER_GLOBALS - moved_names - local - params) & FORBIDDEN_MAIN_GLOBALS
        if leaked:
            problems.append(f"{b['name']}: references main-file state {sorted(leaked)}")
        unknown = sorted(used - JS_BUILTINS - BROWSER_GLOBALS - moved_names - local - params)
        b["unknown"] = unknown

    if problems:
        print("=== UNSAFE, ABORTING ===")
        for p in problems:
            print(" -", p)
        return 1

    print("=== dependency audit: unresolved identifiers per moved block ===")
    for b in located:
        if b["duplicate"]:
            print(f"{b['name']:34} DUPLICATE (lines {b['start']+1}-{b['end']+1}) -> drop")
            continue
        unk = b.get("unknown", [])
        print(f"{b['name']:34} lines {b['start']+1:>5}-{b['end']+1:<5} unresolved={unk if unk else '[]'}")

    # ---- build canvas-utils.js --------------------------------------------
    sections = {}
    for b in located:
        if b["duplicate"]:
            continue
        sections.setdefault(b["section"], []).append(b)

    order = []
    for _, _, sec in TARGETS:
        if sec not in order:
            order.append(sec)

    out = []
    out.append("/**")
    out.append(" * canvas-utils.js —— 智能画布纯工具与媒体工具层（画布拆分第 2 阶段）")
    out.append(" *")
    out.append(" * 这里只放不触碰画布状态的函数：HTML 转义、媒体 URL 解析、媒体类型判定、")
    out.append(" * 文件名处理、剪贴板、下载、尺寸/比例计算与格式化。")
    out.append(" * 不读写 nodes / canvas / viewport / settings，不调用 render / saveCanvas。")
    out.append(" *")
    out.append(" * 加载顺序：必须在 smart-canvas.js 之前加载。本文件在解析期不读取主文件")
    out.append(" * 的任何全局，因此先加载是安全的；主文件保留同名兼容包装函数。")
    out.append(" * 对外只暴露 window.SmartCanvasUtils，不污染其它全局名。")
    out.append(" */")
    out.append("(function attachSmartCanvasUtils(globalScope) {")
    for sec in order:
        blocks = sections.get(sec)
        if not blocks:
            continue
        out.append("")
        out.append(f"    // ===== {sec} =====")
        for b in blocks:
            if b["comments"]:
                for cl in b["comments"].split("\n"):
                    out.append(("    " + cl) if cl.strip() else "")
            for bl in b["body"].split("\n"):
                out.append(("    " + bl) if bl.strip() else "")
    out.append("")
    out.append("    globalScope.SmartCanvasUtils = {")
    fn_names = [b["name"] for b in located if b["kind"] == "fn" and not b["duplicate"]]
    for i, nm in enumerate(fn_names):
        comma = "," if i < len(fn_names) - 1 else ""
        out.append(f"        {nm}: {nm}{comma}")
    out.append("    };")
    out.append("})(typeof globalThis !== 'undefined' ? globalThis : window);")
    out.append("")
    utils_text = "\n".join(out)

    # ---- rewrite smart-canvas.js ------------------------------------------
    # collect (cstart, end, replacement_lines)
    edits = []
    const_note_emitted = False
    for b in located:
        if b["duplicate"] and b["name"] in DROP_DUPLICATE:
            edits.append((b["start"], b["end"], []))
            continue
        if b["name"] in DROP_NAMES:
            if not const_note_emitted:
                edits.append((b["cstart"], b["end"], [CONST_NOTE]))
                const_note_emitted = True
            else:
                # also swallow the single blank separator line before this block
                s = b["cstart"]
                if s - 1 >= 0 and lines[s - 1].strip() == "":
                    s -= 1
                edits.append((s, b["end"], []))
            continue
        is_async, pnames, _ = extract_signature(b["body"], b["name"])
        prefix = "async function" if is_async else "function"
        sig = ", ".join(pnames)
        call = ", ".join(pnames)
        wrapper = f"{prefix} {b['name']}({sig}){{ return window.SmartCanvasUtils.{b['name']}({call}); }}"
        edits.append((b["cstart"], b["end"], [wrapper]))

    edits.sort(key=lambda e: e[0], reverse=True)
    new_lines = list(lines)
    for s, e, repl in edits:
        new_lines[s:e + 1] = repl
    new_src = "\n".join(new_lines)

    print()
    print(f"smart-canvas.js: {len(lines)} -> {len(new_lines)} lines "
          f"({len(new_lines) - len(lines):+d})")
    print(f"canvas-utils.js: {len(utils_text.splitlines())} lines, "
          f"{len(fn_names)} functions + 2 lookup tables")

    if not APPLY:
        print("\nDRY RUN - nothing written. Re-run with --apply.")
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        _write(ROOT / "scripts" / "_preview_canvas-utils.js", utils_text)
        _write(ROOT / "scripts" / "_preview_smart-canvas.js", new_src)
        print("previews written to scripts/_preview_canvas-utils.js and scripts/_preview_smart-canvas.js")
        return 0

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    OUT.write_text(utils_text, encoding="utf-8", newline="\n")
    SRC.write_text(new_src, encoding="utf-8", newline="\n")
    print(f"\nAPPLIED: wrote {OUT.relative_to(ROOT)} and {SRC.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
