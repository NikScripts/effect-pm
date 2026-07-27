#!/usr/bin/env python3
"""Second-pass living-docs naming cleanup after incomplete intermediate renames."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

SKIP_DIR_PARTS = {"node_modules", "dist", "repos", ".git", "archive"}
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
TABLE_PROTECT = {
    "docs/handoffs/agent-d-named-handles.md",
    "docs/handoffs/queue-handle-convergence-decisions.md",
}


def should_touch(path: Path) -> bool:
    rel = path.relative_to(ROOT).as_posix()
    if any(p in rel.split("/") for p in SKIP_DIR_PARTS):
        return False
    if not path.is_file():
        return False
    if path.suffix.lower() not in {".md", ".mdc", ".mdx", ".tsx", ".ts", ".js", ".txt", ""} and path.name != "Dockerfile":
        return False
    for prefix in TOUCH_PREFIXES:
        if rel == prefix.rstrip("/") or rel.startswith(prefix):
            return True
    return rel in ("docs/index.md", "docs/README.md", "AGENTS.md", ".changeset/README.md")


def protect_gh(text: str) -> tuple[str, list[tuple[str, str]]]:
    spans: list[tuple[str, str]] = []

    def repl(m: re.Match[str]) -> str:
        tok = f"__GH_{len(spans)}__"
        spans.append((tok, m.group(0)))
        return tok

    text = re.sub(r"https?://github\.com/[^\s)\"'`]*effect-pm[^\s)\"'`]*", repl, text)
    return text, spans


def protect_tables(text: str, rel: str) -> tuple[str, list[tuple[str, str]]]:
    if rel not in TABLE_PROTECT:
        return text, []
    spans: list[tuple[str, str]] = []
    patterns = [
        r"(## Naming \(post-rebrand[\s\S]*?\n\|[^\n]*\|\n\|[-| :]+\|\n(?:\|[^\n]*\|\n)+)",
        r"(### Naming note[\s\S]*?\n\|[^\n]*\|\n\|[-| :]+\|\n(?:\|[^\n]*\|\n)+)",
    ]
    for i, pat in enumerate(patterns):
        m = re.search(pat, text)
        if m:
            tok = f"__TBL_{i}__"
            spans.append((tok, m.group(1)))
            text = text[: m.start(1)] + tok + text[m.end(1) :]
    return text, spans


def transform(text: str, rel: str) -> str:
    text, gh = protect_gh(text)
    text, tbl = protect_tables(text, rel)

    # Intermediate wrong product names from Resource→Hyperlink compound pass.
    replacements = [
        ("CustomQueueHyperlink", "WorkPool /* untyped .Service */"),
        ("QueueHyperlink", "WorkPool"),
        ("RunHyperlink", "Gate"),
        ("HttpApiHyperlink", "HttpApiClient"),
        ("CustomQueueContract", "WorkPool /* untyped */"),
        ("QueueContract", "WorkPool"),
        ("RunHyperlinkIsland", "GateIsland"),
        ("CustomQueue Soft", "untyped WorkPool Soft"),
        ("CustomQueue Soft", "untyped WorkPool Soft"),  # noop dup ok
        ("CustomQueue shares", "Untyped WorkPool shares"),
        ("CustomQueue inherits", "untyped WorkPool inherits"),
        ("CustomQueue's", "untyped WorkPool's"),
        ("CustomQueue Soft", "untyped WorkPool Soft"),
        ("/ CustomQueue", " / untyped WorkPool"),
        ("/CustomQueue", "/untyped-WorkPool"),
        ("CustomQueue/", "untyped-WorkPool/"),
        ("Daemon/Queue/Run/CustomQueue", "Daemon/WorkPool/Gate/untyped-WorkPool"),
        ("Daemon / WorkPool / CustomQueue / Gate", "Daemon / WorkPool / Gate / untyped WorkPool"),
        ("Daemon, WorkPool, Gate, CustomQueue", "Daemon, WorkPool, Gate, untyped WorkPool"),
        ("Daemon/Queue/CustomQueue/Run", "Daemon/WorkPool/untyped-WorkPool/Gate"),
        ("(Daemon/Queue/Run/CustomQueue)", "(Daemon/WorkPool/Gate/untyped WorkPool)"),
        ("Daemon, Queue, RunHyperlink, CustomQueue", "Daemon, WorkPool, Gate, untyped WorkPool"),
        ("Daemon, WorkPool, RunHyperlink, CustomQueue", "Daemon, WorkPool, Gate, untyped WorkPool"),
        ("Process, WorkPool, CustomQueueHyperlink, and Gate", "Daemon, WorkPool, untyped WorkPool, and Gate"),
        ("WorkPool + CustomQueue", "WorkPool + untyped WorkPool"),
        ("### Queue / CustomQueue", "### WorkPool / untyped WorkPool"),
        ("### WorkPool + CustomQueueHyperlink", "### WorkPool + untyped WorkPool"),
        ("### WorkPool + WorkPool /* untyped .Service */", "### WorkPool + untyped WorkPool"),
        ("CustomQueueHyperlink.store", "WorkPool.store /* untyped */"),
        ("buildCustomQueueImpl", "buildUntypedWorkPoolImpl"),
        ("src/CustomQueueHyperlink.ts", "src/WorkPool.ts /* untyped .Service path */"),
        ("hyperlink-ts/CustomQueueHyperlink", "hyperlink-ts/WorkPool"),
        ("CustomQueue", "untyped WorkPool"),  # leftover bare CustomQueue product noun
    ]
    for old, new in replacements:
        text = text.replace(old, new)

    # Clean doubled / awkward artifacts from layered replaces.
    text = text.replace("untyped untyped WorkPool", "untyped WorkPool")
    text = text.replace("WorkPool /* untyped .Service */ /* untyped .Service */", "WorkPool /* untyped .Service */")
    text = text.replace(
        "WorkPool /* untyped .Service */.Tag",
        "WorkPool.Tag /* untyped .Service / engine */",
    )
    text = text.replace(
        "WorkPool /* untyped .Service */.layer",
        "WorkPool.layer /* untyped .Service */",
    )
    text = text.replace(
        "WorkPool /* untyped .Service */.store",
        "WorkPool.store /* untyped .Service */",
    )
    text = text.replace(
        "WorkPool /* untyped .Service */.make",
        "WorkPool.make /* untyped .Service */",
    )
    text = text.replace("import { WorkPool /* untyped .Service */ }", "import { WorkPool }")
    text = text.replace(
        "import * as WorkPool /* untyped .Service */ from",
        "import * as WorkPool from",
    )
    text = text.replace(
        "import { WorkPool /* untyped .Service */ as CustomQueueEngine }",
        "import { WorkPool as UntypedWorkPoolEngine }",
    )
    text = text.replace("CustomQueueEngine", "UntypedWorkPoolEngine")
    text = text.replace("untyped-WorkPool", "untyped WorkPool")

    # Remaining Process.* → Daemon.* (any member).
    text = re.sub(r"\bProcess\.([A-Za-z_][A-Za-z0-9_]*)", r"Daemon.\1", text)
    # MyProcess.store style — only when clearly the toolkit example
    text = text.replace("MyProcess.store", "MyDaemon.store")
    text = text.replace("Process.Options", "Daemon.Options")
    text = text.replace("Process.Service", "Daemon.Service")
    text = text.replace("Process.spawn", "Daemon.spawn")
    text = text.replace("Process.effect", "Daemon.effect")
    text = text.replace("`Process<R>`", "`Daemon<R>`")
    text = text.replace("**`Process.serveRemote`**", "**`Daemon.serveRemote`**")

    # Resource.* product APIs → Hyperlink.* (careful with Resource.ts path).
    text = text.replace("`Resource.ts`", "`Hyperlink.ts`")
    text = text.replace("Resource.ts", "Hyperlink.ts")
    text = re.sub(r"\bResource\.([A-Za-z_][A-Za-z0-9_]*)", r"Hyperlink.\1", text)
    text = text.replace("Hyperlink.builtResource", "Hyperlink.builtHyperlink")
    text = text.replace("no Resource/Daemon", "no Hyperlink/Daemon")
    text = text.replace("Own module namespace, not Hyperlink/Daemon", "Own module namespace, not Hyperlink/Daemon")

    # Process leftover product nouns in mixed lists.
    text = text.replace("WorkPool, Process, Gate", "WorkPool, Daemon, Gate")
    text = text.replace("WorkPool / Process", "WorkPool / Daemon")
    text = text.replace("(QR)", "(WorkPool)")
    text = text.replace("QR/", "WorkPool/")
    text = text.replace("QR set", "WorkPool set")
    text = text.replace("QR ended", "WorkPool ended")
    text = text.replace("QR/Process", "WorkPool/Daemon")
    text = text.replace("the QR/Process checklist", "the WorkPool/Daemon checklist")
    text = text.replace("Process at 1", "Daemon at 1")
    text = text.replace("runresource-golden-standards", "gate-golden-standards")
    text = text.replace("MyRun", "MyGate")

    # effect-pm package (non-URL).
    text = re.sub(r"\beffect-pm\b", "hyperlink-ts", text)

    # Restore.
    for tok, orig in reversed(tbl + gh):
        text = text.replace(tok, orig)
    return text


def main() -> None:
    changed = []
    for path in sorted(ROOT.rglob("*")):
        if not should_touch(path):
            continue
        try:
            raw = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        rel = path.relative_to(ROOT).as_posix()
        # Skip heavy generated / node-only site build artifacts if any
        if "/node_modules/" in rel:
            continue
        new = transform(raw, rel)
        if new != raw:
            path.write_text(new, encoding="utf-8")
            changed.append(rel)
    print(f"Updated {len(changed)} files")
    for c in changed:
        print(c)


if __name__ == "__main__":
    main()
