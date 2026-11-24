#!/usr/bin/env python3
"""Read-only source text-integrity checks for the 小小办公 project.

This intentionally avoids decoding with replacement/ignore so a clean report
means every checked source file was decoded strictly as UTF-8.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path


TEXT_EXTENSIONS = {
    ".html", ".js", ".mjs", ".css", ".json", ".py", ".md", ".txt",
    ".bat", ".cmd", ".ps1", ".vbs", ".toml", ".yaml", ".yml", ".ini",
    ".cfg",
}
SKIP_DIRECTORY_NAMES = {
    ".git", "__pycache__", "node_modules", "output", "assets",
}
SENSITIVE_NAME_RE = re.compile(r"(?:key|token|secret|password|credential|auth)", re.I)
MOJIBAKE_RE = re.compile(r"\u951f|\u70eb\u70eb\u70eb|\u6d5c|\u9428|\u9359|\u93c2|\u95c1")
BROKEN_HTML_RE = re.compile(
    r"(?:\uFFFD\?/(?:span|div)|\u5de5\u4f5c\uFFFD\?/DIV|\?/(?:span|div|button|p|h[1-6])>|[^<]/(?:span|div)>)",
    re.I,
)
# 中文后紧跟半角问号，再接非中文、非空白字符：典型的编码损坏特征
# （合法中文问句应使用全角「？」，如 "？" 结尾）
TRUNCATED_QUESTION_RE = re.compile(r"[\u4e00-\u9fff]\?(?=[^\u4e00-\u9fff\s\uff1f]|$)")
TRUNCATED_QUESTION_EXTENSIONS = {".js", ".mjs", ".html", ".css", ".py"}


@dataclass(frozen=True)
class Finding:
    severity: str
    path: Path
    line: int | None
    kind: str


def display_path(root: Path, path: Path) -> str:
    return path.relative_to(root).as_posix()


def line_of_bytes(raw: bytes, offset: int) -> int:
    return raw.count(b"\n", 0, offset) + 1


def line_of_text(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def is_source_file(root: Path, path: Path) -> bool:
    relative = path.relative_to(root)
    if any(part in SKIP_DIRECTORY_NAMES for part in relative.parts[:-1]):
        return False
    if any(part.endswith(".bak") for part in relative.parts):
        return False
    return path.suffix.lower() in TEXT_EXTENSIONS


def iter_source_files(root: Path):
    for directory, directories, names in os.walk(root):
        directories[:] = [name for name in directories if name not in SKIP_DIRECTORY_NAMES]
        base = Path(directory)
        for name in names:
            path = base / name
            if is_source_file(root, path):
                yield path


def has_mixed_eol(text: str) -> bool:
    crlf = text.count("\r\n")
    lone_lf = len(re.findall(r"(?<!\r)\n", text))
    return crlf > 0 and lone_lf > 0


def check_text(root: Path, path: Path) -> tuple[str | None, list[Finding]]:
    raw = path.read_bytes()
    findings: list[Finding] = []
    if raw.startswith(b"\xef\xbb\xbf"):
        findings.append(Finding("ERROR", path, 1, "UTF8_BOM"))
    try:
        text = raw.decode("utf-8", "strict")
    except UnicodeDecodeError as exc:
        findings.append(Finding("ERROR", path, line_of_bytes(raw, exc.start), "INVALID_UTF8"))
        return None, findings

    if "\ufffd" in text:
        findings.append(Finding("ERROR", path, line_of_text(text, text.index("\ufffd")), "REPLACEMENT_CHARACTER"))
    for mojibake in MOJIBAKE_RE.finditer(text):
        findings.append(Finding("WARNING", path, line_of_text(text, mojibake.start()), "COMMON_MOJIBAKE_PATTERN"))
    for broken_html in BROKEN_HTML_RE.finditer(text):
        findings.append(Finding("ERROR", path, line_of_text(text, broken_html.start()), "BROKEN_HTML_FRAGMENT"))
    if path.suffix.lower() in TRUNCATED_QUESTION_EXTENSIONS:
        for truncated in TRUNCATED_QUESTION_RE.finditer(text):
            findings.append(Finding("WARNING", path, line_of_text(text, truncated.start()), "SUSPICIOUS_TRUNCATED_CHINESE"))
    if has_mixed_eol(text):
        findings.append(Finding("WARNING", path, None, "MIXED_EOL"))
    return text, findings


def check_json(path: Path, text: str) -> Finding | None:
    if path.suffix.lower() != ".json":
        return None
    try:
        json.loads(text)
    except json.JSONDecodeError as exc:
        return Finding("ERROR", path, exc.lineno, "INVALID_JSON")
    return None


def check_python(path: Path, text: str) -> Finding | None:
    if path.suffix.lower() != ".py":
        return None
    try:
        compile(text, str(path), "exec")
    except SyntaxError as exc:
        return Finding("ERROR", path, exc.lineno, "PYTHON_SYNTAX_ERROR")
    return None


def check_javascript(path: Path) -> Finding | None:
    if path.suffix.lower() not in {".js", ".mjs"}:
        return None
    try:
        result = subprocess.run(
            ["node", "--check", str(path)], capture_output=True, text=True,
            encoding="utf-8", errors="strict", check=False,
        )
    except (OSError, UnicodeError):
        return Finding("WARNING", path, None, "NODE_CHECK_UNAVAILABLE")
    if result.returncode:
        return Finding("ERROR", path, None, "JAVASCRIPT_SYNTAX_ERROR")
    return None


def check_inline_javascript(path: Path, text: str) -> list[Finding]:
    if path.suffix.lower() != ".html":
        return []
    findings: list[Finding] = []
    pattern = re.compile(r"<script\b(?![^>]*\bsrc\s*=)[^>]*>(.*?)</script\s*>", re.I | re.S)
    for match in pattern.finditer(text):
        opening = text[match.start():match.start(1)]
        if re.search(r"\btype\s*=\s*['\"](?:application/(?:json|ld\+json)|importmap)['\"]", opening, re.I):
            continue
        source = match.group(1)
        if not source.strip():
            continue
        temp_name = None
        try:
            with tempfile.NamedTemporaryFile("w", suffix=".js", encoding="utf-8", newline="", delete=False) as handle:
                handle.write(source)
                temp_name = handle.name
            result = subprocess.run(
                ["node", "--check", temp_name], capture_output=True, text=True,
                encoding="utf-8", errors="strict", check=False,
            )
            if result.returncode:
                findings.append(Finding("ERROR", path, line_of_text(text, match.start(1)), "INLINE_JAVASCRIPT_SYNTAX_ERROR"))
        except (OSError, UnicodeError):
            findings.append(Finding("WARNING", path, line_of_text(text, match.start(1)), "NODE_CHECK_UNAVAILABLE"))
        finally:
            if temp_name:
                try:
                    os.unlink(temp_name)
                except OSError:
                    pass
    return findings


def print_finding(root: Path, finding: Finding) -> None:
    line = "-" if finding.line is None else str(finding.line)
    print(f"{finding.severity}\t{display_path(root, finding.path)}:{line}\t{finding.kind}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Strict read-only source encoding and syntax audit")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--strict-warnings", action="store_true")
    args = parser.parse_args()
    root = args.root.resolve()
    findings: list[Finding] = []
    files = list(iter_source_files(root))
    js_count = 0
    py_count = 0
    json_count = 0

    for path in files:
        text, text_findings = check_text(root, path)
        findings.extend(text_findings)
        if text is None:
            continue
        json_finding = check_json(path, text)
        if json_finding:
            findings.append(json_finding)
        if path.suffix.lower() == ".json":
            json_count += 1
        python_finding = check_python(path, text)
        if python_finding:
            findings.append(python_finding)
        if path.suffix.lower() == ".py":
            py_count += 1
        javascript_finding = check_javascript(path)
        if javascript_finding:
            findings.append(javascript_finding)
        if path.suffix.lower() in {".js", ".mjs"}:
            js_count += 1
        findings.extend(check_inline_javascript(path, text))

    for finding in findings:
        print_finding(root, finding)
    errors = sum(item.severity == "ERROR" for item in findings)
    warnings = sum(item.severity == "WARNING" for item in findings)
    print(f"SUMMARY\tfiles={len(files)} js={js_count} py={py_count} json={json_count} errors={errors} warnings={warnings}")
    if errors:
        return 1
    return 2 if args.strict_warnings and warnings else 0


if __name__ == "__main__":
    raise SystemExit(main())
