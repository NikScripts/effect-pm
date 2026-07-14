# What's changed on the base — recap for all agents (2026-07-13)

The integration base is now the branch **`integration`** (formerly `integration/storage` — storage
work is done, so the branch is renamed to a general integration line). Everything below is already on
it. Rebase/merge your working branch onto `integration` before your next slice.

**Read the "Breaking — you must know" section even if you skip the rest.**

---

## Breaking — you must know

1. **`Method<…>` dropped its `Kind` type param.** It's now `Method<P, Su, E, Str, Ann, Client>`;
   `kind` ("query"/"mutate") is a runtime-only field. Any code that matched `Method<Kind, …>`
   positionally, or read the kind from the *type*, breaks. `getMethodMeta` still exposes it at runtime.
2. **A void query is now written `effect(Schema.Void)`.** The empty `effect()` is repurposed as the
   two-stage override entry.
3. **New client-type override API** on `Resource` — `effectFn<T>()(schema)` / `effect<Effect<T>>()(success)`
   (narrowing) and `unsafeEffectFn<T>()(schema)` / `unsafeEffect<…>()(success)` (free). Single-stage
   `effectFn(schema)` / `effect(success)` unchanged. `Resource.Decoded<S>` is public.
4. **Handle hovers changed** (cleaner, not breaking): `yield* Tag` resolves `Method<…>` → effects and
   `Schema.Struct.ReadonlySide<…>` → `{ to: string }` (internal `Simplify` + `PrettifyPayload`).
5. **Logs:** legacy `captureLogs` / spec `logs` **removed**. Use `Resource.logs` / `NodeStatus.logs`
   and `LogEntry.hasKey`. See [`../LOGS.md`](../LOGS.md). The public `NodeLogs` shim is **gone** —
   import `Logs` only.
6. **`ProcessStorage` / `RuntimeStorage` facet substrate retired** (with its tests).
7. **`Store.store` renamed to `scoped`** (+ `Resource.withStore`). Gitignored `scratchpad/store/*`
   experiments still call the old name.

---

## By agent — what landed

### Agent 2 — engine (queue wire · process RPC · logs platform)
The heaviest recent engine work.
- **Queue wire Phase 1a** (#21) — the Tag wire triplet; per-instance data verbs typed by `itemSchema`.
- **Process manual-run RPC** (#26) — typed `run` RPC with the `effect` / `effectFn` shape.
- **Logs platform, Phases 1–5** (#30) — one public logs module; `captureLogs` / spec `logs` removed;
  consumers on `Resource.logs` / `NodeStatus.logs` + `LogEntry.hasKey`; `ProcessStorage`/`RuntimeStorage`
  substrate retired; **`NodeLogs` shim removed** (closeout). `Logs.ts` is the single public logs module.

### Agent A — standards corpus + intro
- The **standards corpus** under `docs/standards/*` (principles, modules-and-boundaries, types-and-naming,
  effect-style, documentation, error-handling, resources, storage, no-backward-compat, working-agreement)
  — the owner's prioritized rulebook, plus a dedicated **Documentation** chapter and the **Djot**
  authoring-format prototype.
- The **rewritten intro** (`docs/index.md`) — the "two resources, two runtimes, one program" narrative,
  the peers beat, and the "build your own" walk. (Re-twoslash'd against current types this session.)

### Agent B — doc-site platform + dashboard type-safety
- The **doc site** (`docs/site/*`) — the Waku/RSC app that serves the docs (with twoslash hovers, copy
  button, line numbers) readable on the phone over Tailscale; content hot-reloads. **Don't edit
  `docs/site/` casually — it's B's.**
- **Dashboard type-safety** — initial `runtime.tsx` `@since` / type fixes landed; the full `src/web`
  `src/ui` remediation is **plan-first / owner-gated** (see [`agent-b-dashboard-typesafety.md`](./agent-b-dashboard-typesafety.md)).

### Agent C — standards tooling (older, foundational)
- The **generator-derived standards manifest** (Step 0) and **multi-scope `appliesTo`**, with the
  generator **self-enforcing** the standards it emits. The broader audit (Phase 3) is plan-first.

### Agent 1 — store cutover (older, foundational)
- The **store cutover close-out** — `Store` core (declared `Storage`, no `serviceOption`, tier model),
  CustomQueue + queue-engine stores, RunResource wire slots. Now plan-first on the next headlining
  resource (no new code yet).

### Type display & docs (current session)
- The handle-display cleanup (`Simplify` / `PrettifyPayload`), the `Client<T>` override API, the `Kind`
  drop, and doc-site polish (copy button, line numbers, inline-code link styling). Verified the
  **prettify-ts dual-view** and drafted the **named-handles** plan → [`agent-d-named-handles.md`](./agent-d-named-handles.md).

---

## Next up
- **Agent D** (+ peers) — named resource handles → [`agent-d-named-handles.md`](./agent-d-named-handles.md).
- **Agent 3** — Logs P1 (levels / store followers / remote) → [`agent-03-logs-p1.md`](./agent-03-logs-p1.md).
  Plan-first; owner unlocks slices. Do **not** mix with named-handles.
- Payload-prettify backlog → [`agent-a-type-display-cleanup.md`](./agent-a-type-display-cleanup.md).
