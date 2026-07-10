# Agent A — Rules & documentation corpus

**Branch:** `integration/rules-and-documentation` (your base — cut `action/*` working branches from it).
**Role:** Author the effect-pm **standards corpus** — the owner's canonical, prioritized rules.
**Platform (ready):** Agent B's doc site is live. `pnpm run docs:serve` → readable on the phone over Tailscale; editing a chapter **and adding a new one** hot-reload. Content lives at the `docs/` root; `docs/site/` is the app (Agent B's — don't touch).

---

## The assignment — read it twice

Surface and codify **every rule, expectation, standard, convention, and "this is how we do it here" the OWNER holds**, and order them **by importance to the owner**.

This is **not** a generic best-practices doc. It is *the owner's* rulebook — extracted from everything they've written and how they work, prioritized by what matters most to **them**. Two things are easy to get wrong, so be explicit with yourself:

1. **"Importance to me" = the owner's priority order, not yours.** You *propose* an ordering with rationale; the **owner reorders**. The final sequence is theirs, not your inference.
2. **Completeness over tidiness.** "every rule, expectation, or anything of the sort" — capture more, then let the owner prune. A missed rule is worse than one extra.

If you finish and it reads like advice you'd give any TypeScript project, you've done the wrong thing. It should read like *this owner's* standards.

---

## Critical context

- **The current non-legacy content is EXAMPLE ONLY.** `docs/index.md`, `docs/guides/*.md`, and `docs/standards/meta.md` are banner-marked placeholders that demonstrate the platform. They are **not** the design — replace them.
- **`docs/legacy/` is the old documentation.** Mine it for rules; it gets re-evaluated/deleted afterward. Do **not** preserve its structure or treat it as canonical.
- **`docs/standards/meta.md`** is the authoring format (a working draft). Follow it; flag it if it constrains you.

---

## Phase 1 — Prioritized inventory (do this FIRST; write no corpus yet)

Produce **one prioritized inventory** of every rule/expectation/standard, ordered by your best inference of the owner's importance. For each entry: a one-line statement, a **severity** (`must`/`should`/`may`), **where it applies** (`src`/`test`/`examples`/`docs`), and its **source** (where you found it).

Mine, at minimum:

- **`.cursor/rules/*.mdc`** — the owner's editor-enforced rules (highest signal).
- **`AGENTS.md`, `CLAUDE.md`** (root + any) — contributor + assistant guidance.
- **`docs/legacy/**`** — the old corpus (`AGENTS`, `PACKAGE-GUIDE`, `STORAGE`, `PROCESS-API`, `RESOURCE-API`, `guides/`, `plans/`).
- **The codebase** — `src/` conventions (module layout, public-vs-internal, naming, Effect v4 patterns), `examples/`, `test/`.
- **The owner's expressed preferences and corrections.** Recurring themes to look for (illustrative, not exhaustive): no `as` casts (fix the root cause structurally), explicit `export interface` for public types (not schema-derived aliases), the `class extends X.Service<Self>()` service form, single-source-of-truth, prefer `.pipe(...)` over `Effect.gen`, payloads as a single Struct (not loose fields), PascalCase only for types/namespaces (values camelCase), use Effect platform packages (incl. `effect/unstable/*`).

**Deliver Phase 1 in the owner chat** as a table/list. **Wait for the owner to confirm and reorder** before Phase 2 — the order is the deliverable's whole point.

---

## Phase 2 — Write the corpus (only after the owner locks the order)

Write each rule as a chapter in `docs/standards/*.md`, **in the owner's priority order**, using the `docs/standards/meta.md` format:

- Page block `{#chapter-id title="…" appliesTo=…}` above the `# H1`.
- Each rule = a `##` section with `{#dotless-id .severity appliesTo=…}` on the line above it.
- Callouts via `{.note}`. Dotless ids. No manifest editing — it's derived from your `{#id .severity}` blocks.

Preview continuously with `pnpm run docs:serve` (phone-readable). Replace/remove the example placeholders as you go.

---

## Out of scope

- The doc platform / site (Agent B).
- Auditing violators (**Agent C** — runs after your corpus is locked).
- `docs/legacy/` cleanup beyond mining it.

## Done when

- [ ] Phase 1 prioritized inventory delivered **and owner-reordered**
- [ ] Every confirmed rule written as a `docs/standards/*.md` chapter in the `meta.md` format, in the owner's order
- [ ] Example placeholders (`index`, `guides/*`) replaced or removed
- [ ] Renders cleanly on `docs:serve`
