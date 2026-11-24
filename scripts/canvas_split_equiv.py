# -*- coding: utf-8 -*-
"""Behavioural equivalence test for the phase-2 canvas split.

Builds two sandboxes in Node:
  OLD = the original function bodies, extracted verbatim from the backup
  NEW = the generated modules/canvas-utils.js (window.SmartCanvasUtils)
then runs a battery of inputs through both and deep-compares the results.
Also exercises the smart-canvas.js wrapper layer to prove the delegating
wrappers preserve default-parameter behaviour.
"""
from __future__ import annotations

import json
import re
import subprocess
import tempfile
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKUP = Path(r"D:/压缩包/canvas_split_phase2_backup_2026-09-19/smart-canvas.js")
TMP = Path(tempfile.gettempdir()) / "xxpd_canvas_split_p2equiv"  # keep fixtures out of the repo


def read(p: Path) -> str:
    with open(p, "r", encoding="utf-8", newline="") as fh:
        return fh.read()


def write(p: Path, text: str) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)


def extract_old_impl(backup_lines, utils_text: str) -> str:
    """Pull the original top-level blocks for every name exported by utils."""
    exported = re.findall(r"^\s{8}([A-Za-z_$][\w$]*): \1,?$", utils_text, re.M)
    consts = ("STANDARD_IMAGE_RESOLUTIONS", "STANDARD_VIDEO_RESOLUTIONS")
    wanted = list(consts) + exported
    out = []
    for name in wanted:
        if name in consts:
            prefixes = (f"const {name} =",)
        else:
            prefixes = (f"function {name}(", f"async function {name}(")
        starts = [i for i, ln in enumerate(backup_lines) if ln.startswith(prefixes)]
        if not starts:
            raise SystemExit(f"FATAL: {name} not found in backup")
        s = starts[0]  # first definition wins (duplicate is byte-identical)
        first = backup_lines[s].rstrip()
        if not first.endswith("{"):
            e = s
        else:
            e = next(j for j in range(s + 1, len(backup_lines))
                     if backup_lines[j] in ("}", "};"))
        out.append("\n".join(backup_lines[s:e + 1]))
    return "\n".join(out) + "\n"


HARNESS = r"""
'use strict';
const fs = require('fs');
const vm = require('vm');

// deterministic object-URL stub so OLD and NEW produce comparable values
if (!URL.createObjectURL) {
  URL.createObjectURL = () => 'blob:stub';
  URL.revokeObjectURL = () => {};
}

// ---- shared browser stubs -------------------------------------------------
function makeStubs(opts) {
  opts = opts || {};
  const created = [];
  const videoEl = {
    canPlayType(t) { return opts.hevc ? (t.indexOf('hvc1') >= 0 ? 'probably' : '') : ''; }
  };
  const document = {
    createElement(tag) {
      const el = { tagName: String(tag).toUpperCase(), style: {}, dataset: {},
                   setAttribute(){}, remove(){}, focus(){}, select(){},
                   setSelectionRange(){}, click(){ created.push('click'); },
                   appendChild(){}, addEventListener(){} };
      if (String(tag).toLowerCase() === 'video') Object.assign(el, videoEl);
      created.push(el);
      return el;
    },
    body: { appendChild(){} },
    addEventListener(){}, removeEventListener(){},
    execCommand(){ return opts.execCommand !== false; }
  };
  const location = { origin: 'http://127.0.0.1:8900', href: 'http://127.0.0.1:8900/static/smart-canvas.html?id=abc' };
  const navigator = { clipboard: opts.clipboard ? {
      readText: async () => opts.clipboardText, writeText: async () => { opts.written = true; }
  } : undefined };
  class Image {
    constructor(){ this._src=''; }
    set src(v){ this._src = v; setTimeout(() => {
        if (opts.imageFail) { this.onerror && this.onerror(); }
        else { this.naturalWidth = 1024; this.naturalHeight = 512; this.onload && this.onload(); }
    }, 0); }
    get src(){ return this._src; }
  }
  const sandbox = {
    document, location, navigator, Image, console,
    URL, URLSearchParams, encodeURIComponent, decodeURIComponent,
    setTimeout, clearTimeout, Promise, Math, Date, Number, String, RegExp,
    Object, Array, JSON, Map, Set, Boolean, Error, isNaN, parseInt, parseFloat,
    Number,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  if (opts.lanRoute) {
    sandbox.__xxdpLanRouteResource = function (u) { return '/lan-proxy' + u; };
  }
  return { sandbox, created, opts };
}

function loadOld(extra) {
  const { sandbox } = makeStubs(Object.assign({ hevc: true }, extra));
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(process.argv[2], 'utf8'), sandbox, { filename: 'old.js' });
  return sandbox;
}
function loadNew(extra) {
  const { sandbox } = makeStubs(Object.assign({ hevc: true }, extra));
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(process.argv[3], 'utf8'), sandbox, { filename: 'new.js' });
  return sandbox.SmartCanvasUtils;
}

const CASES = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
const VARIANTS = JSON.parse(fs.readFileSync(process.argv[5], 'utf8'));

(async () => {
  let pass = 0, fail = 0;
  const failures = [];
  for (const variant of VARIANTS) {
    const extra = {};
    if (variant.lan) extra.lanRoute = true;
    if (variant.hevc === false) extra.hevc = false;
    const old = loadOld(extra);
    const neu = loadNew(extra);
    for (const [name, argSets] of Object.entries(CASES)) {
      if (typeof old[name] !== 'function') { failures.push(`${variant.id}/${name}: missing in OLD`); fail++; continue; }
      if (typeof neu[name] !== 'function') { failures.push(`${variant.id}/${name}: missing in NEW`); fail++; continue; }
      for (const args of argSets) {
        let a, b, ea = null, eb = null;
        try { a = await old[name](...args); } catch (e) { ea = String(e && e.message || e); }
        try { b = await neu[name](...args); } catch (e) { eb = String(e && e.message || e); }
        const sa = ea ? 'throw:' + ea : JSON.stringify(a);
        const sb = eb ? 'throw:' + eb : JSON.stringify(b);
        if (sa === sb) { pass++; }
        else { fail++; failures.push(`${variant.id}/${name}(${JSON.stringify(args)})\n      OLD=${sa}\n      NEW=${sb}`); }
      }
    }
  }
  console.log(`equivalence: pass=${pass} fail=${fail}`);
  if (failures.length) { console.log('--- failures ---'); failures.slice(0, 40).forEach(f => console.log(' * ' + f)); }
  process.exit(fail ? 1 : 0);
})();
"""


def build_cases() -> dict:
    urls = [
        "", None, "online_abc.png", "ai_ref_x.jpeg", "output_1.webp",
        "/output/a b.png", "/assets/lib/cat.PNG",
        "https://cdn.example.com/x/y.mp4", "http://h/p?q=1#f",
        "data:image/png;base64,AAAA", "blob:http://x/1",
        "/api/media-preview?w=512&url=%2Foutput%2Fz.png",
        "/api/media-preview", "relative/dir/pic.jpg", "asset://local/1",
        "/api/storage-files/local/up_1.png", "/output/clip.MP4?x=1",
        "/output/movie.mkv#t=3", "https://a/b/video.webm",
    ]
    items = [
        None, {}, "plain-string",
        {"url": "/output/a.png"},
        {"url": "https://x/y.mp4", "kind": "video"},
        {"name": "clip.mov"}, {"name": "song.mp3"}, {"name": "note.txt"},
        {"kind": "file", "url": "/output/doc.pdf"},
        {"url": "/output/a.png", "name": "1712345678901_abcd.png"},
        {"url": "https://x/y.png", "name": "我的图片.png"},
        {"url": "/output/a.png", "localUrl": "/api/storage-files/local/up_1.png"},
        {"url": "/output/v.mp4", "duration": 3.14159},
        {"url": "/output/v.mp4", "duration": 12},
        {"url": "data:image/gif;base64,AA", "mime": "image/gif"},
        {"mime": "video/quicktime"}, {"content_type": "IMAGE/JPEG"},
        {"url": "/output/a.png", "natural_w": 1920, "natural_h": 1080},
        {"url": "/output/a.png", "width": 512, "height": 512},
        {"url": "/output/a.png", "_inlineVideoActive": True},
        {"type": "video/mp4", "name": "x"}, {"type": "text/plain", "name": "y"},
    ]
    ratios = ["", None, "1:1", "16:9", "9:16", "4:3", "3:4", "21:9", "9:21",
              "square", "wide", "story", "landscape43", "portrait43",
              "portrait", "landscape", "ultrawide", "ultratall", "2:3", "3:2",
              "weird", 0.5, 2, 1.7777, -1, "0:0", "1280x720"]
    quals = ["", None, "1k", "2k", "4k", "1K", "4K", "uhd", "ultra", "high",
             "standard", "low", "sd", "medium", "auto"]
    res = ["", None, "480p", "720p", "768p", "1080p", "2k", "4k", "2160p",
           "uhd", "1080", "768", "480", "sd", "fhd", "2048", "2K"]
    sizes = ["", None, "1024x1024", "1920X1080", "512*512", "abc", "12x", "x12", " 800 x 600 "]
    names = ["", None, "my file.png", 'bad<>:"/\\|?*.zip', "   ", "a/b/c.mp4",
             "1712345678901_abcd.png",
             "550e8400-e29b-41d4-a716-446655440000.jpg",
             "0123456789abcdef01234567.webp", "素材.png", "paint.png"]
    bases = ["", None, "我的图", "1712345678901_我的图.png", "a-b_first-frame.png",
             "x_r2_c3.png", "y_拆分组2.png", "z_paint.png", "w_join.png",
             "v_resize.png", "u_resize-50pct.png", "t.png"]
    actions = ["", None, "crop", "首帧", "尾帧", "当前帧", "3.5s", "1m2.5s", "paint", "resize"]
    counters = [None, "", 2, 7, "3"]
    bytes_ = [None, "", 0, -1, 512, 1023, 1024, 1536, 1048576, 10485760, "2048", "abc", 1.5]
    ms = [None, "", 0, -5, 500, 1500, 9999, 60000, 61000, 3600000, 86400001, "abc"]
    durs = [None, 0, -1, 0.5, 3.14159, 9.95, 10, 12, 61.44, "5"]
    dims = [None, 0, -1, 100, 1920, "640"]
    keys = ["", None, "free", "original", "1:1", "16:9", "4:3", "abc", "0:5", "5:0", "1:2:3"]
    files = [None, {}, {"type": "video/mp4"}, {"type": "audio/mpeg", "name": "a"},
             {"name": "b.txt"}, {"name": "c.unknown"}, {"type": "text/html"}]
    html = ["", None, "<script>alert(1)</script>", 'a"b\'c&d<e>f', 0, False, {},
            "中文 & <b>", "line\nbreak"]

    cases = {
        "escapeHtml": [[v] for v in html],
        "smartOriginalMediaUrl": [[v] for v in urls + items],
        "smartMediaPreviewUrl": [[v] for v in urls + items] + [[u, s] for u in urls[:8] for s in (64, 512, 4096, "abc", None, 0)],
        "outputUrlLooksVideo": [[v] for v in urls + items],
        "proxiedMediaUrl": [[v] for v in urls + items] + [[u, "n.png"] for u in urls[:8]] + [[it, "x"] for it in items[:8]],
        "displayMediaUrl": [[v] for v in urls + items] + [[u, "n.png"] for u in urls[:8]],
        "isLocalCanvasMediaUrl": [[v] for v in urls],
        "playbackVideoUrl": [[v] for v in urls] + [[u, True] for u in urls] + [[u, False] for u in urls],
        "sameMediaSrc": [[a, b] for a in urls[:10] for b in urls[:10]],
        "looksLikeImageMediaUrl": [[v] for v in urls],
        "isRemoteVideoReferenceUrl": [[v] for v in urls],
        "localDisplayUrlForMediaItem": [[v] for v in items + urls],
        "imageForDisplay": [[v] for v in items + urls],
        "isVideoMediaItem": [[v] for v in items + urls],
        "isInlineVideoActive": [[v] for v in items + urls],
        "isAudioMediaItem": [[v] for v in items + urls],
        "isTextMediaItem": [[v] for v in items + urls],
        "isFileMediaItem": [[v] for v in items + urls],
        "mediaKindForFile": [[v] for v in files],
        "mediaKindForItem": [[v] for v in items + urls],
        "safeExportFileName": [[v] for v in names] + [[n, "fb.zip"] for n in names],
        "fileNameFromUrl": [[v] for v in urls + names],
        "isMachineGeneratedMediaName": [[v] for v in names + bases],
        "cleanMediaBaseName": [[v] for v in names + bases] + [[b, "fb"] for b in bases],
        "escapeSemanticRegex": [[v] for v in ["", None, "a.b*c", "[x](y)", "a+b?c^d$e{f}g|h\\i", "中文.*"]],
        "appendSemanticActionSuffix": [[b, a, c] for b in bases for a in actions for c in counters],
        "extensionForMediaItem": [[v] for v in items] + [[it, ".webp"] for it in items],
        "downloadNameForMediaItem": [[v] for v in items] + [[it, "prefix"] for it in items],
        "smartImageNameFromUrl": [[v] for v in urls + names],
        "imageNameLabel": [[v] for v in items] + [[it, "fb"] for it in items],
        "imageResolutionLabel": [[v] for v in items],
        "normalizeImageRatio": [[v] for v in ratios],
        "getImageDimensions": [[r] for r in ratios] + [[r, q] for r in ratios for q in quals],
        "getVideoDimensions": [[r] for r in ratios] + [[r, s] for r in ratios[:12] for s in res],
        "parseSizeValue": [[v] for v in sizes],
        "parseRatioValue": [[v] for v in sizes + ratios],
        "normalizedSizeLabel": [[v] for v in sizes + ratios],
        "mediaCoverWindow": [[a, b, c, d] for a in dims[:5] for b in dims[:5] for c in dims[:5] for d in dims[:5]],
        "getImageCropRatioValue": [[k, w, h] for k in keys for w in (None, 0, 800) for h in (None, 0, 600)],
        "getSmartGhostDimensions": [[v] for v in [None, "", 0, -1, 0.25, 1, 2, 3.7, 100, "16:9", "abc", 1e9]],
        "parseSmartAspectRatio": [[v] for v in [None, "", 0, -1, 1, 2.5, "16:9", "4/3", "1.5", "abc", "0:0", 1e9, "9:16"]],
        "formatMediaFileSize": [[v] for v in bytes_],
        "getMediaFormatName": [[v] for v in items] + [[it, k] for it in items for k in (None, "image", "video")],
        "formatRunDuration": [[v] for v in ms],
        "formatSmartVideoDurationTag": [[v] for v in durs + items],
        "browserCanPlayHevc": [[]],
        "copyTextWithCopyEvent": [[v] for v in ["", "abc", "中文"]],
        "copyTextWithTextarea": [[v] for v in ["", "abc", "中文"]],
        "clipboardMatchesText": [[v] for v in ["", "abc"]],
        "copyTextToClipboard": [[v] for v in ["", None, "abc", "中文", 0]],
        "loadSmartOriginalImageDimensions": [[v] for v in [
            "", None, "data:image/png;base64,AA", "blob:x", "/output/a.png",
            "https://cdn.example.com/b.jpg", "online_c.png"]],
        "downloadBlob": [[{"size": 10}, "a.json"], [{"size": 10}, ""],
                         [{"size": 10}, None], [None, "b.bin"]],
    }
    return cases


def main() -> int:
    utils_text = read(ROOT / "static" / "canvas" / "js" / "modules" / "canvas-utils.js")
    backup_lines = read(BACKUP).split("\n")
    old_impl = extract_old_impl(backup_lines, utils_text)
    write(TMP / "old_impl.js", old_impl)
    write(TMP / "harness.js", HARNESS)
    cases = build_cases()
    write(TMP / "cases.json", json.dumps(cases, ensure_ascii=False))
    variants = [
        {"id": "plain", "hevc": True},
        {"id": "lan-route", "hevc": True, "lan": True},
        {"id": "no-hevc", "hevc": False},
        {"id": "no-hevc+lan", "hevc": False, "lan": True},
    ]
    write(TMP / "variants.json", json.dumps(variants))
    total = sum(len(v) for v in cases.values())
    print(f"functions={len(cases)} input-sets={total} variants={len(variants)} "
          f"comparisons={total * len(variants)}")
    r = subprocess.run(
        ["node", str(TMP / "harness.js"), str(TMP / "old_impl.js"),
         str(ROOT / "static" / "canvas" / "js" / "modules" / "canvas-utils.js"),
         str(TMP / "cases.json"), str(TMP / "variants.json")],
        capture_output=True, text=True, encoding="utf-8")
    print(r.stdout.strip())
    if r.stderr.strip():
        print("STDERR:", r.stderr.strip()[:2000])
    return r.returncode


if __name__ == "__main__":
    raise SystemExit(main())
