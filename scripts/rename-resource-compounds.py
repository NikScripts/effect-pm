#!/usr/bin/env python3
"""Wave 2: *Resource product names → *Hyperlink (QueueResource, RunResource, …).

Assumes wave 1 (Resource → Hyperlink package/module) already landed.
Does not rename GitHub repo URLs. Skips archive/handoffs/changesets/CHANGELOG.
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Public + internal file moves (old relative → new relative).
FILE_MOVES = [
    ("src/QueueResource.ts", "src/QueueHyperlink.ts"),
    ("src/CustomQueueResource.ts", "src/CustomQueueHyperlink.ts"),
    ("src/RunResource.ts", "src/RunHyperlink.ts"),
    ("src/HttpApiResource.ts", "src/HttpApiHyperlink.ts"),
    ("src/ResourceConfigure.ts", "src/HyperlinkConfigure.ts"),
    ("src/internal/queueResource.ts", "src/internal/queueHyperlink.ts"),
    ("src/internal/customQueueResource.ts", "src/internal/customQueueHyperlink.ts"),
    ("src/internal/runResource.ts", "src/internal/runHyperlink.ts"),
    ("src/internal/runResourceSchema.ts", "src/internal/runHyperlinkSchema.ts"),
    ("src/internal/runResourceStatus.ts", "src/internal/runHyperlinkStatus.ts"),
    ("src/internal/runResourceEvent.ts", "src/internal/runHyperlinkEvent.ts"),
    ("src/internal/runResourceFacts.ts", "src/internal/runHyperlinkFacts.ts"),
    ("src/internal/nodeStatusResource.ts", "src/internal/nodeStatusHyperlink.ts"),
    ("src/internal/logs/resourceLogs.ts", "src/internal/logs/hyperlinkLogs.ts"),
    ("src/internal/logs/resourceStreamLevel.ts", "src/internal/logs/hyperlinkStreamLevel.ts"),
    ("src/internal/store/runResourceStoreSpec.ts", "src/internal/store/runHyperlinkStoreSpec.ts"),
    ("docs/site/src/islands/RunResourceIsland.tsx", "docs/site/src/islands/RunHyperlinkIsland.tsx"),
    ("docs/site/src/islands/counter-resource.ts", "docs/site/src/islands/counter-hyperlink.ts"),
    ("docs/site/src/islands/double-resource.ts", "docs/site/src/islands/double-hyperlink.ts"),
    ("docs/getting-started/creating-a-resource.md", "docs/getting-started/creating-a-hyperlink.md"),
    ("docs/legacy/RESOURCE-API.md", "docs/legacy/HYPERLINK-API.md"),
    ("docs/legacy/guides/queue-resource.md", "docs/legacy/guides/queue-hyperlink.md"),
    ("docs/legacy/guides/resource-configure.md", "docs/legacy/guides/hyperlink-configure.md"),
    ("docs/legacy/guides/per-resource-dependencies.md", "docs/legacy/guides/per-hyperlink-dependencies.md"),
    ("docs/guides/run-resources.md", "docs/guides/run-hyperlinks.md"),
    ("docs/standards/resources.md", "docs/standards/hyperlinks.md"),
]

# Longest-first identifier renames (prefix families covered by stem replaces).
STEMS = [
    ("CustomQueueResource", "CustomQueueHyperlink"),
    ("HttpApiResource", "HttpApiHyperlink"),
    ("QueueResource", "QueueHyperlink"),
    ("RunResource", "RunHyperlink"),
    ("ResourceConfigure", "HyperlinkConfigure"),
    ("NodeStatusResource", "NodeStatusHyperlink"),
    ("ProcessScheduleResource", "ProcessScheduleHyperlink"),
    ("ScheduleResourceSpec", "ScheduleHyperlinkSpec"),
    ("scheduleResourceSpec", "scheduleHyperlinkSpec"),
    ("ProcessResource", "ProcessHyperlink"),
    ("NodeResourceReadiness", "NodeHyperlinkReadiness"),
    ("nodeResourceReadiness", "nodeHyperlinkReadiness"),
    ("ResourceReadinessBanner", "HyperlinkReadinessBanner"),
    ("ResourceLogKeySource", "HyperlinkLogKeySource"),
    ("ResourceLogKey", "HyperlinkLogKey"),
    ("resolveResourceLogKey", "resolveHyperlinkLogKey"),
    ("sourceResourceId", "sourceHyperlinkId"),
    ("toResourceState", "toHyperlinkState"),
    ("CounterForResourceType", "CounterForHyperlinkType"),
    ("makeResourceAtoms", "makeHyperlinkAtoms"),
    ("makeResourceTui", "makeHyperlinkTui"),
    ("makeResourceCli", "makeHyperlinkCli"),
    ("onOpenResource", "onOpenHyperlink"),
    ("openResource", "openHyperlink"),
    ("ResourceCard", "HyperlinkCard"),
    ("byResource", "byHyperlink"),
    ("ByResource", "ByHyperlink"),
    ("resourceKindOf", "hyperlinkKindOf"),
    ("resourceKind", "hyperlinkKind"),
    # camelCase internal module stems (path fragments + imports)
    ("customQueueResource", "customQueueHyperlink"),
    ("queueResource", "queueHyperlink"),
    ("runResourceStoreSpec", "runHyperlinkStoreSpec"),
    ("runResourceSchema", "runHyperlinkSchema"),
    ("runResourceStatus", "runHyperlinkStatus"),
    ("runResourceEvent", "runHyperlinkEvent"),
    ("runResourceFacts", "runHyperlinkFacts"),
    ("runResource", "runHyperlink"),
    ("nodeStatusResource", "nodeStatusHyperlink"),
    ("resourceStreamLevel", "hyperlinkStreamLevel"),
    ("resourceLogs", "hyperlinkLogs"),
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
    "scripts/rename-resource-compounds.py",
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
    # Protect GitHub URLs
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

    for old, new in STEMS:
        text = text.replace(old, new)

    # Path leftovers for moved docs / modules
    text = text.replace("creating-a-resource", "creating-a-hyperlink")
    text = text.replace("RESOURCE-API", "HYPERLINK-API")
    text = text.replace("queue-resource", "queue-hyperlink")
    text = text.replace("resource-configure", "hyperlink-configure")
    text = text.replace("per-resource-dependencies", "per-hyperlink-dependencies")
    text = text.replace("run-resources", "run-hyperlinks")
    text = text.replace("/resources.md", "/hyperlinks.md")
    text = text.replace("standards/resources", "standards/hyperlinks")
    text = text.replace("counter-resource", "counter-hyperlink")
    text = text.replace("double-resource", "double-hyperlink")
    text = text.replace("RunResourceIsland", "RunHyperlinkIsland")

    # Default wire kind for bare Hyperlink tags (+ journal scope kind)
    text = text.replace('kind ?? "resource"', 'kind ?? "hyperlink"')
    text = text.replace('?? "resource"', '?? "hyperlink"')
    text = text.replace('export const kind = "resource"', 'export const kind = "hyperlink"')
    text = text.replace('| "resource"', '| "hyperlink"')
    text = text.replace('"resource" |', '"hyperlink" |')
    text = text.replace('return "resource"', 'return "hyperlink"')
    text = text.replace('"resource")', '"hyperlink")')
    text = text.replace('=== "resource"', '=== "hyperlink"')
    text = text.replace('!== "resource"', '!== "hyperlink"')
    text = text.replace('StoreJournalKind = "resource"', 'StoreJournalKind = "hyperlink"')
    text = text.replace('"resource" (default)', '"hyperlink" (default)')

    for tok, url in url_map:
        text = text.replace(tok, url)
    return text


def git_mv(src: str, dst: str) -> None:
    s, d = ROOT / src, ROOT / dst
    if s.exists() and not d.exists():
        d.parent.mkdir(parents=True, exist_ok=True)
        subprocess.check_call(["git", "mv", str(s), str(d)], cwd=ROOT)
        print(f"git mv {src} → {dst}")
    elif d.exists():
        print(f"already moved: {dst}")
    else:
        print(f"skip missing: {src}")


def main() -> None:
    for src, dst in FILE_MOVES:
        git_mv(src, dst)

    exts = {".ts", ".tsx", ".md", ".json", ".mjs", ".cjs", ".html", ".css", ".dj"}
    changed = 0
    for path in ROOT.rglob("*"):
        if not path.is_file() or path.suffix not in exts:
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

    print(f"done — {changed} files rewritten")


if __name__ == "__main__":
    main()
