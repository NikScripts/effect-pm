---
"@nikscripts/effect-pm": minor
---

**Service-shape redesign (in progress) — shape-named builders + `constant`.** Spec builders are being
renamed for **what they resolve to in the service**, not the RPC verb, and the set is expanding beyond
Effects.

- **`Resource.effect`** (→ `Effect<A>`, was `query`) and **`Resource.effectFn`** (→ `(In) => Effect<A>`,
  was `mutate`) — the shape-named vocabulary. `query`/`mutate` still work.
- **`Resource.constant(S)`** — a value resolved **once at acquire** and surfaced as a **plain** property
  (`p.x: A`, no `yield*`), **identical local and remote**. Reuses the query wire; the impl supplies
  `Effect<A>` (use `Effect.succeed` for a literal).

Next (staged): `value` (plain, live via one background delta stream) → nesting → retiring `query`/`mutate`.
See `docs/handoffs/service-shape-redesign.md`.
