# Agent C — Standards audit (local Claude, strict) — **PHASE 3**

**Agent:** Local Claude (**Agent C**)
**Branch:** `chore/standards-audit` from **`integration/storage`**

---

## Start here — PLAN FIRST, nothing without approval

**The first thing you send back is your plan. Then you stop.**

Everything you do is run by the owner before you do it. Do **not** cut a branch, scan-to-write,
implement a fix, write the report, or open a PR until the owner approves. Present, wait for an
explicit go, then act — one step at a time. No autonomous work.

Your opening message is the plan (see *The plan you present* below) — and only that.

---

## Mission

Audit `src/`, `test/`, `examples/`, `docs/` against the locked standards corpus. **Stricter than the
owner** — flag both `should` and `must`. Propose fixes; the owner rejects overreach.

Deliverables (each gated on approval): a violations catalog, an HTML report under `docs/audits/`, and
a draft PR with only the **top 5** clearest fixes.

---

## Inputs (all on `integration/storage`)

- **Corpus:** `docs/standards/*.md` — 9 chapters (Principles, Modules & Boundaries, Types & Naming,
  Effect Style, Error Handling & Correctness, Resource Factories, Storage & Persistence, Breaking
  Changes & Stability, Agent Rules).
- **Manifest:** `docs/standards/manifest.json` — **104 rules**, each with `id` (`chapter.rule`),
  `severity` (`must`/`should`/`may`), `appliesTo`, and its heading. This is the SSOT for what you
  audit against; it is derived from the chapters' `{#id .severity}` blocks.
- **Preview:** `pnpm run docs:serve` renders the corpus (each rule shows its severity chip).

---

## The plan you present (your first and only opening message)

1. **Rule → heuristic map** — for each of the 104 rules, how you'll detect a violation (grep, AST,
   type check, manual read), and which rules are *not* mechanically checkable (say so honestly).
2. **Scope & order** — which chapters/areas first, and what you'll skip and why.
3. **What each deliverable will look like** — the catalog format, the report, the top-5 PR.
4. **Open questions** — anything ambiguous in a rule before you rely on it.

Post it as prose + a table (not a diff). Then wait for the owner's go.

---

## Working rules

- **Owner chat is mandatory** — every finding and every fix as full Before/After blocks per
  [`supervisor-protocol.md`](./supervisor-protocol.md), not diff lists.
- **One step at a time, each approved first** — catalog → (go) → report → (go) → top-5 fixes → (go) →
  PR to `integration/storage`.
- **Follow the corpus itself** — including *Agent Rules* (branch `<type>/<description>`, commit &
  push continuously, no code without a go, green before commit).
- Update [`agent-status.md`](./agent-status.md) on every push.

---

## Status

- [x] **Ready** — corpus + manifest merged to `integration/storage` (Agent A, corpus complete: 9
  chapters / 104 rules). Cut `chore/standards-audit` and open with your plan.
