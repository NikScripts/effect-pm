---
"@nikscripts/effect-pm": minor
---

**Service-shape redesign (in progress) — shape-named builders + `constant`.** Spec builders are being
renamed for **what they resolve to in the service**, not the RPC verb, and the set is expanding beyond
Effects.

- **`Resource.effect`** (→ `Effect<A>`, was `query`) and **`Resource.effectFn`** (→ `(In) => Effect<A>`,
  was `mutate`) — the shape-named vocabulary. **`query`/`mutate` are retired** (renamed across the whole
  toolkit); update call sites `Resource.query` → `Resource.effect`, `Resource.mutate` → `Resource.effectFn`.
- **`Resource.constant(S)`** — a value resolved **once at acquire** and surfaced as a **plain** property
  (`p.x: A`, no `yield*`), **identical local and remote**. Reuses the query wire; the impl supplies
  `Effect<A>` (use `Effect.succeed` for a literal).
- **`Resource.value(S)`** — a **plain** property (`p.x: A`, no `yield*`) kept **live** by a background
  stream: the impl supplies a `SubscriptionRef`'s `.changes`; each acquire subscribes once, blocks for the
  initial value, then keeps the property current in place — so reads are free (`yield* Tag` never makes a
  request). Identical local and remote (remote is eventually-consistent). For fixed values use `constant`;
  on-demand reads use `effect`.

- **Nested specs (spec-tree).** A spec can now nest — groups of leaves — to arbitrary depth
  (`connections: { size: effect(Number), changes: stream(Number) }`). The tree flattens to **path-keyed**
  wire procedures (`"connections.size"`) and nests back in the service, so `p.connections.size` /
  `p.admin.ban({…})` work identically **local and remote**. Leaves may be any builder
  (`effect`/`effectFn`/`stream`/`constant`/`value`/local).

Next (staged): retiring the last of the old vocab → single merged value-stream + optional `initial`. See
`docs/handoffs/service-shape-redesign.md`.
