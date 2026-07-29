#!/usr/bin/env python3
"""Purge pre-rebrand product names from living documentation.

Skips archive/, CHANGELOG, repos/, node_modules/, dist/, and protects
GitHub effect-pm URLs plus intentional Old→New naming tables.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

NAMING_BANNER = (
    "> **Naming:** read as WorkPool / Daemon / Gate / Hyperlink / hyperlink-ts "
    "(pre-rebrand names purged from this file).\n"
)

# Living handoffs that are bake history — add banner if missing.
BAKE_HANDOFF_GLOBS = [
    "docs/handoffs/store-cutover-*.md",
    "docs/handoffs/agent-e-gate-golden-standards.md",
    "docs/handoffs/result-schema-and-rpc-validation.md",
    "docs/handoffs/queue-persistence-design.md",
    "docs/handoffs/store-and-logs-design.md",
    "docs/handoffs/store-transforms-fullcapture-decisions.md",
    "docs/handoffs/api-changes-2026-07-16.md",
    "docs/handoffs/agent-03-storage-cutover-followthrough.md",
    "docs/handoffs/agent-03-storage-correctness.md",
    "docs/handoffs/agent-03-logs-p1.md",
    "docs/handoffs/agent-03-byhyperlink-full-key.md",
    "docs/handoffs/agent-01-docs-corpus-phase1-plan.md",
    "docs/handoffs/rename-hyperlink-handoff.md",
]

SKIP_DIR_PARTS = {
    "node_modules",
    "dist",
    "repos",
    ".git",
    "archive",
}

SKIP_FILES = {
    "CHANGELOG.md",
    "scripts/scrub-living-docs-naming.py",
    "scripts/rename-to-hyperlink.py",
    "scripts/rename-resource-compounds.py",
}

# Files that MAY keep old names in intentional Old→New tables.
TABLE_PROTECT_FILES = {
    "docs/handoffs/agent-d-named-handles.md",
    "docs/handoffs/queue-handle-convergence-decisions.md",
}

TOUCH_PREFIXES = (
    "docs/standards/",
    "docs/guides/",
    "docs/plans/",
    "docs/getting-started/",
    "docs/handoffs/",
    "docs/legacy/",
    "docs/site/",
    "docs/index.md",
    "docs/README.md",
    "AGENTS.md",
    ".changeset/README.md",
    ".cursor/rules/",
)

# Domain types that must remain (protect during Queue* sweeps that are NOT these).
DOMAIN_KEEP = [
    "QueueEntry",
    "QueueStatus",
    "QueueEvent",
    "QueueMetrics",
    "QueueTag",
    "DurableWorkPoolStore",
]

# Link / filename renames (old basename → new).
FILE_LINK_MAP = [
    ("store-cutover-runresource.md", "store-cutover-gate.md"),
    ("store-cutover-process.md", "store-cutover-daemon.md"),
    ("store-cutover-customqueue.md", "store-cutover-workpool-untyped.md"),
    ("agent-e-runresource-golden-standards.md", "agent-e-gate-golden-standards.md"),
    # bare stems in tables / prose
    ("store-cutover-runresource", "store-cutover-gate"),
    ("store-cutover-customqueue", "store-cutover-workpool-untyped"),
    ("agent-e-runresource-golden-standards", "agent-e-gate-golden-standards"),
]

# Process.* / Resource.* members (word-boundary-ish via regex).
PROCESS_MEMBERS = (
    "Tag",
    "layer",
    "serve",
    "make",
    "store",
    "schedule",
    "Schedule",
    "events",
    "window",
    "result",
)
RESOURCE_MEMBERS = (
    "serve",
    "client",
    "connect",
    "logs",
    "Decoded",
    "distributed",
    "verifyConnection",
    "protocolWebsocket",
    "builtResource",
    "Tag",
    "layer",
    "make",
)


def should_touch(path: Path) -> bool:
    rel = path.relative_to(ROOT).as_posix()
    if path.name in SKIP_FILES or rel in SKIP_FILES:
        return False
    parts = rel.split("/")
    if any(p in SKIP_DIR_PARTS for p in parts):
        return False
    # handoffs/archive is under SKIP_DIR_PARTS via "archive"
    if not path.is_file():
        return False
    if path.suffix.lower() not in {".md", ".mdc", ".mdx", ".txt", ""} and path.name != "Dockerfile":
        # allow Dockerfile without suffix check
        if path.name != "Dockerfile":
            return False
    for prefix in TOUCH_PREFIXES:
        if rel == prefix.rstrip("/") or rel.startswith(prefix):
            return True
    if rel in ("docs/index.md", "docs/README.md", "AGENTS.md", ".changeset/README.md"):
        return True
    return False


def protect_spans(text: str, pattern: str, prefix: str) -> tuple[str, list[tuple[str, str]]]:
    spans: list[tuple[str, str]] = []
    out = text

    def repl(m: re.Match[str]) -> str:
        tok = f"__{prefix}_{len(spans)}__"
        spans.append((tok, m.group(0)))
        return tok

    out = re.sub(pattern, repl, out)
    return out, spans


def restore_spans(text: str, spans: list[tuple[str, str]]) -> str:
    for tok, original in reversed(spans):
        text = text.replace(tok, original)
    return text


def protect_naming_tables(text: str, rel: str) -> tuple[str, list[tuple[str, str]]]:
    """Protect Old-column naming tables in the two intentional exception files."""
    if rel not in TABLE_PROTECT_FILES:
        return text, []
    spans: list[tuple[str, str]] = []
    # Protect markdown tables that start near "Old" / "Bake-era" until blank line after table.
    patterns = [
        # agent-d: "## Naming (post-rebrand..." table through blank line after
        r"(## Naming \(post-rebrand[\s\S]*?\n\|[^\n]*\|\n\|[-| :]+\|\n(?:\|[^\n]*\|\n)+)",
        # queue-handle: "### Naming note" section table
        r"(### Naming note[\s\S]*?\n\|[^\n]*\|\n\|[-| :]+\|\n(?:\|[^\n]*\|\n)+)",
    ]
    for i, pat in enumerate(patterns):
        m = re.search(pat, text)
        if m:
            tok = f"__NAMING_TABLE_{i}__"
            spans.append((tok, m.group(1)))
            text = text[: m.start(1)] + tok + text[m.end(1) :]
    return text, spans


def transform(text: str, rel: str) -> str:
    all_spans: list[tuple[str, str]] = []

    # 1) Protect GitHub URLs containing effect-pm (any owner casing / path).
    text, spans = protect_spans(
        text,
        r"https?://github\.com/[^\s)\"'`]*effect-pm[^\s)\"'`]*",
        "GHURL",
    )
    all_spans.extend(spans)

    # Also protect markdown links that embed those URLs already tokenized — done.

    # 2) Protect intentional naming tables.
    text, spans = protect_naming_tables(text, rel)
    all_spans.extend(spans)

    # 3) Protect domain types that must remain.
    domain_spans: list[tuple[str, str]] = []
    for i, name in enumerate(DOMAIN_KEEP):
        tok = f"__DOMAIN_{i}__"
        if name in text:
            domain_spans.append((tok, name))
            text = text.replace(name, tok)
    all_spans.extend(domain_spans)

    # 4) Protect TEMP QueueHandle→EngineQueueHandle notes (keep QueueHandle word in those notes).
    text, spans = protect_spans(
        text,
        r"(TEMP[^\n]{0,120}QueueHandle[^\n]{0,120}EngineQueueHandle[^\n]*)",
        "TEMPQH",
    )
    all_spans.extend(spans)
    text, spans = protect_spans(
        text,
        r"(QueueHandle\s*TEMP[^\n]{0,80}EngineQueueHandle[^\n]*)",
        "TEMPQH2",
    )
    all_spans.extend(spans)
    text, spans = protect_spans(
        text,
        r"(`QueueHandle`[^\n]{0,100}TEMP[^\n]{0,100})",
        "TEMPQH3",
    )
    all_spans.extend(spans)
    text, spans = protect_spans(
        text,
        r"(Still a \*\*TEMP alias → `EngineQueueHandle`\*\*[^\n]*)",
        "TEMPQH4",
    )
    all_spans.extend(spans)
    text, spans = protect_spans(
        text,
        r"(Still \*\*TEMP → `EngineQueueHandle`\*\*[^\n]*)",
        "TEMPQH5",
    )
    all_spans.extend(spans)

    # 5) File link renames (before identifier renames that might touch stems oddly).
    # Special-case store-cutover-process → daemon, but not store-cutover-processStorage etc.
    for old, new in FILE_LINK_MAP:
        text = text.replace(old, new)
    # store-cutover-process as basename (after .md already mapped); avoid double-mapping daemon
    text = re.sub(r"store-cutover-process(?![\w-])", "store-cutover-daemon", text)

    # 6) Package import path.
    text = text.replace("@nikscripts/effect-pm", "hyperlink-ts")

    # 7) Path renames (longest first).
    path_map = [
        ("src/internal/queueResource.ts", "src/internal/workPool.ts"),
        ("src/internal/queueResource", "src/internal/workPool"),
        ("src/QueueResource.ts", "src/WorkPool.ts"),
        ("src/RunResource.ts", "src/Gate.ts"),
        ("src/Process.ts", "src/Daemon.ts"),
        ("src/Resource.ts", "src/Hyperlink.ts"),
        ("internal/queueResource.ts", "internal/workPool.ts"),
        ("internal/runResource.ts", "internal/gate.ts"),
        ("internal/runResourceStoreSpec.ts", "internal/store/gateStoreSpec.ts"),
        ("internal/runResourceStoreTap.ts", "internal/gateStoreTap.ts"),
        ("runResourceStoreSpec", "gateStoreSpec"),
        ("runResourceStoreTap", "gateStoreTap"),
        ("queueResource.ts", "workPool.ts"),
        ("QueueResource.ts", "WorkPool.ts"),
        ("RunResource.ts", "Gate.ts"),
        ("Process.ts", "Daemon.ts"),
        # only when clearly the public module path fragment
        ("/QueueResource", "/WorkPool"),
        ("/RunResource", "/Gate"),
        ("/CustomQueueResource", "/WorkPool"),
    ]
    for old, new in path_map:
        text = text.replace(old, new)

    # 8) Dockerfile comment.
    text = text.replace("effect-pm-docs", "hyperlink-docs")

    # 9) Process.* / Resource.* API members → Daemon.* / Hyperlink.*
    for mem in PROCESS_MEMBERS:
        text = re.sub(rf"\bProcess\.{mem}\b", f"Daemon.{mem}", text)
    for mem in RESOURCE_MEMBERS:
        if mem == "builtResource":
            text = re.sub(r"\bResource\.builtResource\b", "Hyperlink.builtHyperlink", text)
        else:
            text = re.sub(rf"\bResource\.{mem}\b", f"Hyperlink.{mem}", text)

    # ProcessTagOptions / ProcessLayerConfig / similar product compounds.
    compound_process = [
        ("ProcessTagOptions", "DaemonTagOptions"),
        ("ProcessLayerConfig", "DaemonLayerConfig"),
        ("ProcessSchedule", "DaemonSchedule"),
        ("builtInProcessStoreContract", "builtInDaemonStoreContract"),
        ("ProcessStorage", "DaemonStorage"),  # retired substrate — name in docs
        ("ProcessStore", "DaemonStore"),
        ("ScheduleResourceSpec", "ScheduleHyperlinkSpec"),
        ("scheduleResourceSpec", "scheduleHyperlinkSpec"),
        ("ProcessResource", "DaemonHyperlink"),
        ("RunResourceConfig", "GateConfig"),
        ("RunResourceHandle", "Gate"),
        ("RunResourceStore", "GateStore"),
        ("QueueResourceStore", "WorkPoolStore"),
        ("QueueLayerConfig", "WorkPoolLayerConfig"),
    ]
    for old, new in compound_process:
        text = text.replace(old, new)

    # 10) Product identifiers (longest first).
    # CustomQueueResource → natural untyped WorkPool.Service phrasing.
    text = text.replace(
        "CustomQueueResource.Tag",
        "WorkPool.Service /* untyped engine */.Tag",
    )
    # Clean awkward code if we produced that — prefer cleaner forms by context.
    text = text.replace(
        "WorkPool.Service /* untyped engine */.Tag",
        "/* untyped WorkPool.Service */ WorkPool.Tag",
    )
    text = re.sub(
        r"\bCustomQueueResource\b",
        "WorkPool.Service (untyped)",
        text,
    )
    # Fix doubled phrasing artifacts
    text = text.replace(
        "WorkPool.Service (untyped).Tag",
        "/* untyped WorkPool.Service */ WorkPool.Tag",
    )
    text = text.replace(
        "WorkPool.Service (untyped) Soft",
        "untyped WorkPool.Service Soft",
    )
    text = text.replace("CQR ", "untyped WorkPool ")
    text = text.replace("(CQR)", "(untyped WorkPool)")
    text = text.replace("CQR cutover", "untyped WorkPool cutover")

    text = text.replace("QueueResource", "WorkPool")
    text = text.replace("RunResource", "Gate")
    text = text.replace("ScheduledProcess", "Daemon")
    text = text.replace("ResourceTag", "HyperlinkTag")

    # Bake-era QueueHandle as Tag hover → WorkPool (not TEMP notes — protected).
    text = re.sub(
        r"\bQueueHandle<([^>\n]+)>",
        r"WorkPool<\1>",
        text,
    )
    # "named handle QueueHandle" / hover as QueueHandle
    text = re.sub(
        r"\bnamed handle `QueueHandle`",
        "named handle `WorkPool`",
        text,
    )
    text = re.sub(
        r"hover as `QueueHandle`",
        "hover as `WorkPool`",
        text,
    )
    text = re.sub(
        r"not a `QueueHandle`",
        "not a bake-era `QueueHandle`",
        text,
    )
    text = re.sub(
        r"\bQueueHandle\b(?!\s*(TEMP|→|alias|→))",
        "WorkPool",
        text,
    )
    # Undo over-eager QueueHandle→WorkPool inside engine-path notes we didn't protect:
    # "EngineQueueHandle" must stay; if we broke EngineWorkPool, fix:
    text = text.replace("EngineWorkPool", "EngineQueueHandle")
    text = text.replace("WorkPoolApi", "QueueHandleApi")  # domain/engine API name if mangled — actually QueueHandleApi is engine
    # Wait: QueueHandleApi should stay as engine type. If we replaced QueueHandle inside QueueHandleApi:
    text = text.replace("WorkPoolApi", "QueueHandleApi")

    # 11) Product noun pairs and standalone Process toolkit references.
    text = text.replace("Process / Queue / Gate", "Daemon / WorkPool / Gate")
    text = text.replace("Process / Queue", "Daemon / WorkPool")
    text = text.replace("Queue / Process", "WorkPool / Daemon")
    text = text.replace("Process, Queue, Gate", "Daemon, WorkPool, Gate")
    text = text.replace("Process, Queue,", "Daemon, WorkPool,")
    text = text.replace("Process / WorkPool", "Daemon / WorkPool")

    # Standalone **Process** / `Process` as toolkit module (careful).
    text = re.sub(r"\*\*Process\*\*", "**Daemon**", text)
    text = re.sub(r"`Process`", "`Daemon`", text)
    text = re.sub(r"\bProcess engine\b", "Daemon engine", text)
    text = re.sub(r"\bProcess cutover\b", "Daemon cutover", text)
    text = re.sub(r"\bProcess toolkit\b", "Daemon toolkit", text)
    text = re.sub(r"\bProcess store\b", "Daemon store", text)
    text = re.sub(r"\bProcess \(adopt", "Daemon (adopt", text)
    text = re.sub(r"\bthe Process\b", "the Daemon", text)
    text = re.sub(r"\bProcess uses\b", "Daemon uses", text)
    text = re.sub(r"\bProcess now\b", "Daemon now", text)
    text = re.sub(r"\bProcess meets\b", "Daemon meets", text)
    text = re.sub(r"\bProcess \(", "Daemon (", text)
    text = re.sub(r"\| Process \|", "| Daemon |", text)
    text = re.sub(r"\| Process\b", "| Daemon", text)
    text = re.sub(r"\bProcess →\b", "Daemon →", text)
    text = re.sub(r"\bProcess/\b", "Daemon/", text)
    text = re.sub(r"^# Store cutover — Process\b", "# Store cutover — Daemon", text, flags=re.M)
    text = re.sub(r"^# Store cutover — Gate\b", "# Store cutover — Gate", text, flags=re.M)
    text = re.sub(
        r"^# Store cutover — WorkPool\.Service \(untyped\)\b",
        "# Store cutover — WorkPool (untyped `.Service` / engine)",
        text,
        flags=re.M,
    )
    text = re.sub(
        r"^# Store cutover — Queue\b",
        "# Store cutover — WorkPool (typed queue)",
        text,
        flags=re.M,
    )
    text = re.sub(r"\bQR set\b", "WorkPool set", text)
    text = re.sub(r"\bQR\)\b", "WorkPool)", text)
    text = re.sub(r"\b\(QR\)\b", "(WorkPool)", text)

    # Resource module as product when clearly the toolkit.
    text = re.sub(r"`Resource`", "`Hyperlink`", text)
    text = re.sub(r"\*\*Resource\*\*", "**Hyperlink**", text)
    text = re.sub(r"\bResource module\b", "Hyperlink module", text)
    text = re.sub(r"\bper-resource\b", "per-hyperlink", text)
    text = re.sub(r"\bPer-resource\b", "Per-hyperlink", text)

    # 12) effect-pm as package/product (not inside protected URLs).
    text = re.sub(r"\beffect-pm maintainers\b", "hyperlink-ts maintainers", text)
    text = re.sub(r"\beffect-pm\b", "hyperlink-ts", text)

    # 13) Cleanup awkward artifacts from CustomQueue phrasing in titles/code fences.
    text = text.replace(
        "/* untyped WorkPool.Service */ WorkPool.Tag",
        "WorkPool.Tag /* untyped .Service / engine path */",
    )
    # "WorkPool.Service (untyped)" in headings
    text = text.replace(
        "# Store cutover — WorkPool.Service (untyped)",
        "# Store cutover — WorkPool (untyped `.Service` / engine)",
    )
    text = text.replace(
        "bring **`src/Gate.ts`** up to the same \"golden template\" bar that\n`WorkPool`",
        "bring **`src/Gate.ts`** up to the same \"golden template\" bar that\n`WorkPool`",
    )

    # Restore protected spans.
    text = restore_spans(text, all_spans)
    return text


def ensure_banner(text: str, rel: str) -> str:
    if "pre-rebrand names purged from this file" in text:
        return text
    # Only for bake-history handoffs we listed / store-cutover / agent-e-gate
    bake = False
    if rel.startswith("docs/handoffs/store-cutover-"):
        bake = True
    if rel in {
        "docs/handoffs/agent-e-gate-golden-standards.md",
        "docs/handoffs/result-schema-and-rpc-validation.md",
        "docs/handoffs/queue-persistence-design.md",
        "docs/handoffs/store-and-logs-design.md",
        "docs/handoffs/store-transforms-fullcapture-decisions.md",
        "docs/handoffs/api-changes-2026-07-16.md",
        "docs/handoffs/agent-03-storage-cutover-followthrough.md",
        "docs/handoffs/agent-03-storage-correctness.md",
        "docs/handoffs/agent-03-logs-p1.md",
        "docs/handoffs/agent-03-byhyperlink-full-key.md",
        "docs/handoffs/agent-01-docs-corpus-phase1-plan.md",
        "docs/handoffs/rename-hyperlink-handoff.md",
        "docs/handoffs/queue-handle-convergence-decisions.md",
        "docs/handoffs/agent-d-named-handles.md",
    }:
        bake = True
    if not bake:
        return text
    if not text.startswith("#"):
        # insert after any leading blank / HTML comment
        return NAMING_BANNER + "\n" + text
    # After first H1 line
    lines = text.splitlines(keepends=True)
    if not lines:
        return NAMING_BANNER + "\n"
    out = [lines[0]]
    i = 1
    # skip one blank after title if present
    if i < len(lines) and lines[i].strip() == "":
        out.append(lines[i])
        i += 1
    out.append(NAMING_BANNER)
    out.append("\n")
    out.extend(lines[i:])
    return "".join(out)


def main() -> None:
    changed: list[str] = []
    for path in sorted(ROOT.rglob("*")):
        if not should_touch(path):
            continue
        # skip binary-ish
        try:
            raw = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, IsADirectoryError, OSError):
            continue
        rel = path.relative_to(ROOT).as_posix()
        new = transform(raw, rel)
        new = ensure_banner(new, rel)
        if new != raw:
            path.write_text(new, encoding="utf-8")
            changed.append(rel)
    print(f"Updated {len(changed)} files")
    for c in changed:
        print(c)


if __name__ == "__main__":
    main()
