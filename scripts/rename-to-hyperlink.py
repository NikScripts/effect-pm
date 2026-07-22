#!/usr/bin/env python3
"""Mechanical Resource → Hyperlink + @nikscripts/effect-pm → hyperlink-ts sweep.

Protects compound *Resource product names. Does not rename GitHub repo URLs
(owner will supply the new repo name later).
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Longer first so CustomQueueResource wins over QueueResource over Resource.
PROTECT = [
    "CustomQueueResource",
    "HttpApiResource",
    "QueueResource",
    "RunResource",
    "ResourceConfigure",
]

SYMBOLS = [
    ("DuplicateResourceKey", "DuplicateHyperlinkKey"),
    ("flattenResourceSpec", "flattenHyperlinkSpec"),
    ("servedResourcesLayer", "servedHyperlinksLayer"),
    ("ServedResources", "ServedHyperlinks"),
    ("ServedResource", "ServedHyperlink"),
    ("ResourceInstance", "HyperlinkInstance"),
    ("isBuiltResource", "isBuiltHyperlink"),
    ("builtResourceSym", "builtHyperlinkSym"),
    ("builtResource", "builtHyperlink"),
    ("BuiltResource", "BuiltHyperlink"),
    ("ResourceTag", "HyperlinkTag"),
    ("isResourceTagArg", "isHyperlinkTagArg"),
    ("ResourceProtocol", "HyperlinkProtocol"),
    ("ResourceServerError", "HyperlinkServerError"),
    ("withResources", "withHyperlinks"),
    ("toResourceLayer", "toHyperlinkLayer"),
]

SKIP_DIR_PARTS = {
    "node_modules",
    "dist",
    "repos",
    ".git",
    "archive",
}

SKIP_PATH_PREFIXES = (
    "docs/handoffs/",
    ".changeset/",
)

SKIP_FILES = {
    "CHANGELOG.md",
    "scripts/rename-to-hyperlink.py",
}


def should_skip(path: Path) -> bool:
    rel = path.relative_to(ROOT).as_posix()
    if path.name in SKIP_FILES or rel in SKIP_FILES:
        return True
    for prefix in SKIP_PATH_PREFIXES:
        if rel.startswith(prefix):
            return True
    parts = rel.split("/")
    for part in SKIP_DIR_PARTS:
        if part in parts:
            return True
    return False


def transform(text: str) -> str:
    # Protect GitHub repo URLs until owner names the new repo.
    url_map: list[tuple[str, str]] = []
    for i, m in enumerate(
        re.finditer(
            r"https?://github\.com/[Nn]ik[Ss]cripts/effect-pm[^\s)\"'`]*",
            text,
        )
    ):
        tok = f"__GHURL_{i}__"
        url_map.append((tok, m.group(0)))
    for tok, url in url_map:
        text = text.replace(url, tok, 1)

    protect_map: list[tuple[str, str]] = []
    for i, name in enumerate(PROTECT):
        tok = f"__PROTECT_{i}__"
        protect_map.append((tok, name))
        text = text.replace(name, tok)

    for old, new in SYMBOLS:
        text = text.replace(old, new)

    text = text.replace("@nikscripts/effect-pm", "hyperlink-ts")

    text = text.replace("/Resource\"", "/Hyperlink\"")
    text = text.replace("/Resource'", "/Hyperlink'")
    text = text.replace("/Resource`", "/Hyperlink`")
    text = text.replace("./Resource\"", "./Hyperlink\"")
    text = text.replace("./Resource'", "./Hyperlink'")
    text = text.replace("../Resource\"", "../Hyperlink\"")
    text = text.replace("../Resource'", "../Hyperlink'")
    text = text.replace("../src/Resource\"", "../src/Hyperlink\"")
    text = text.replace("../src/Resource'", "../src/Hyperlink'")
    text = text.replace("src/Resource.ts", "src/Hyperlink.ts")
    text = text.replace("dist/Resource.", "dist/Hyperlink.")

    text = text.replace("import * as Resource ", "import * as Hyperlink ")
    text = text.replace("import type * as Resource ", "import type * as Hyperlink ")
    text = text.replace("export * as Resource ", "export * as Hyperlink ")

    text = re.sub(r"\bResource\.", "Hyperlink.", text)
    text = re.sub(r"\bResource\b", "Hyperlink", text)

    text = text.replace("@pm/Resource", "@pm/Hyperlink")

    # Unscoped package id (GitHub URLs already protected).
    text = text.replace("effect-pm", "hyperlink-ts")
    text = text.replace("Effect-pm", "Effect Hyperlink")

    for tok, name in protect_map:
        text = text.replace(tok, name)
    for tok, url in url_map:
        text = text.replace(tok, url)

    return text


def main() -> None:
    src = ROOT / "src" / "Resource.ts"
    dst = ROOT / "src" / "Hyperlink.ts"
    if src.exists() and not dst.exists():
        subprocess.check_call(["git", "mv", str(src), str(dst)], cwd=ROOT)
        print("git mv src/Resource.ts → src/Hyperlink.ts")
    elif dst.exists():
        print("src/Hyperlink.ts already present")
    else:
        raise SystemExit("src/Resource.ts missing")

    pkg = ROOT / "package.json"
    pkg_text = pkg.read_text(encoding="utf-8")
    pkg_updated = transform(pkg_text)
    pkg_updated = re.sub(
        r'"name":\s*"[^"]+"',
        '"name": "hyperlink-ts"',
        pkg_updated,
        count=1,
    )
    if pkg_updated != pkg_text:
        pkg.write_text(pkg_updated, encoding="utf-8")
        print("updated package.json")

    exts = {".ts", ".tsx", ".md", ".json", ".mjs", ".cjs", ".html", ".css"}
    changed = 0
    for path in ROOT.rglob("*"):
        if not path.is_file() or path.suffix not in exts:
            continue
        if path == pkg:
            continue
        if should_skip(path):
            continue
        try:
            original = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        updated = transform(original)
        if updated != original:
            path.write_text(updated, encoding="utf-8")
            changed += 1
            print("updated", path.relative_to(ROOT))

    print(f"done — {changed} files rewritten (+ package.json)")


if __name__ == "__main__":
    main()
