# Identity coordinator — exclusive brain + many hands

**Status:** **M4 Eng’d** (identity liveness + coordinator example, 2026-07-21). M5 placement advice still later.  
**Work branch:** `cursor/logs-store-followers-plan-906e` — sync tip with `integration`.  
**Related:** [`node-catalog-and-discovery.md`](./node-catalog-and-discovery.md) (S1 identity, Lookup, directory) · [`owner-decisions.md`](./owner-decisions.md) · shipped `Resource.identity` / `Lookup.Identity` / `Lookup.Directory`.

---

## The dream (product)

You never think “Manager” as a special library noun. You think **one brain, many hands**:

```text
                    LOOKUP (phone book + referee + placement board)
                   ┌────────────────────────────────────┐
                   │ Identity:  "Router" → node A       │
                   │ Directory: Worker#w1, w2, w3       │
                   │ Advice:    "prefer w2 right now"   │  ← later Eng
                   └───────────────┬────────────────────┘
                                   │
           ┌───────────────────────┼───────────────────────┐
           ▼                       ▼                       ▼
        Router                  Worker                 Worker
     (identity —              (many —                 (many —
      only one)                advertise)              advertise)
```

Same `yield* Router` / `yield* Worker` everywhere. Winner serves; losers dial the winner; workers come and go; Lookup stays the truth.

**One-line pitch:** Identity becomes the exclusive brain (alive, teachable, handoff-capable). Lookup becomes the referee + phone book + placement board. Workers stay many. We never ship a second claim system named `Resource.Manager` — we finish this one until it feels like the dream.

---

## Locked decisions (this bake)

| # | Decision | Lock |
|---|----------|------|
| **M1** | **Collapse** | No `Resource.Manager` ctor / product surface. Exclusive resources = `Resource.identity` (S1, already Eng’d). |
| **M2** | **Dedupe** | Key-only (already S1). No required value-level `manages[]` Tag list. |
| **M3** | **Pattern** | One brain (identity) + many hands (directory / nameless / `Prototype` / `distributed`). Taught as the fleet recipe. |
| **M4** | **v1 Eng spine** | **Identity liveness** (dead winner → claim releasable / replaceable) + **coordinator+workers example**. |
| **M5** | **Placement advice** | Later Eng — winning coordinator (or identity advisor) streams advice into Lookup; dial / `lookupClient` honor it. Not a separate Manager type. |
| **M6** | **Sugar** | After the pattern is proven — recipes / clearer `IdentitySelfRequired` remediation; no magic baked into every listen. |

**Rejected / deferred:**

- Inventing `Resource.Manager` as a second first-wins system.
- Mandatory ctor bag of managed Tags (package-edge / import-type tax).
- Seamless cross-network elect for Lookup (L1 already: same-machine OS bind; remote = explicit).
- `contractHash` / default-on verify (loud-failures later track).

---

## What already ships (don’t rebuild)

| Piece | Status |
|-------|--------|
| `Resource.identity` pipe; `layer` / `serve` claim → serve-or-client | **Eng’d** (S1) |
| Lookup `Identity.claim` first-wins / `DuplicateIdentity` + original endpoint | **Eng’d** |
| Directory advertise / `nodesServing` / `livenessReplace` / `askIncumbent` | **Eng’d** |
| `lookupClient` + D4 `{ pick }` | **Eng’d** |
| Nameless / Prototype / multi-protocol listen + clients | **Eng’d** |
| Loud-failures: `verifyConnection({ deep })`, `ProtocolMismatch`, `MissingClientProtocol` | **Eng’d** |
| Identity claim liveness (dead winner → replaceable) + same-dial refresh | **Eng’d** (M4 slice 1) |
| Coordinator+workers form (`node-identity-coordinator`) | **Eng’d** (M4 slice 2) |

---

## Gaps → Eng slices

### Slice 1 — Identity liveness (**M4 core**) — **Eng’d**

**Goal:** A dead winner does not own the key forever.

Shipped:

1. Lookup identity `claim` pings incumbent via `NodeStatus` (same primitive as directory).
2. Dead / unreachable → claim released; newcomer wins. Alive → `DuplicateIdentity`.
3. Same dial refreshes without error. Cooperative `askIncumbent` for identity keys left optional/later.
4. Tests: `test/lookup-identity.test.ts`, `test/resource-identity.test.ts` (dead winner reclaim).

**Not in slice 1:** placement advice wire, Manager naming, changing S1 fail-closed-when-Lookup-down.

### Slice 2 — Teach the pattern (**M4 companion**) — **Eng’d**

**Goal:** One copy-paste fleet story.

- Form: [`examples/forms/resource/node-identity-coordinator.ts`](../../examples/forms/resource/node-identity-coordinator.ts) — identity **Router** + N **Worker**s + Lookup.
- README / catalog cross-link: “one brain, many hands.”
- Clearer `IdentitySelfRequired` message (Lookup + dialable self).

### Slice 3 — Placement advice (**M5**, later bake/Eng)

**Goal:** Smart dial without a Manager type.

Sketch (not wire-final):

```ts
// Winner-only (identity Router impl)
yield* Lookup.advise({ resource: "fleet/Worker", prefer: "fleet/Worker#w2" })

// Clients / router dial
Resource.lookupClient(Worker, { pick: /* honor advice, else D4 */ })
```

Wire shape, retention, and multi-advisor conflicts = **separate bake** before Eng. Algorithms stay app-owned.

### Slice 4 — Sugar (**M6**, last)

Documented recipes; optional helpers only after slices 1–2 are green. Lookup stays pipe-only on listens (existing invariant).

---

## Dream app shape (illustrative)

```ts
class Router extends Resource.Tag<Router>()("fleet/Router", {
  enqueue: Resource.effectFn({ job: Job }, Schema.Void),
}).pipe(Resource.identity) {}

class Worker extends Resource.Tag<Worker>()("fleet/Worker", {
  run: Resource.effectFn({ job: Job }, Schema.Void),
}) {}

// Boot A: Lookup + identity Router (listen + claim)
// Boot B/C/D: Worker.listen([...]).pipe(Layer.provide(Lookup.layer))  // advertise
// Router impl: directory / advice → dial a Worker
```

---

## Eng ownership / order

| Order | Slice | Owner unlock |
|-------|-------|--------------|
| 1 | Identity liveness | **Eng’d** |
| 2 | Coordinator+workers example | **Eng’d** |
| 3 | Placement advice | Needs short wire bake, then Eng |
| 4 | Sugar | After 1–2 |

**Agent:** work on `cursor/logs-store-followers-plan-906e`; sync so work branch and `integration` share the same tip. **No PRs** unless owner asks.

---

## Success criteria (v1 = slices 1–2)

- Kill winner process → next claimant can win the identity key without restarting Lookup by hand.
- Example runs: one Router, two Workers, enqueue reaches a worker.
- No `Resource.Manager` API; docs say collapse + this handoff.
- Typecheck + identity / lookup tests green; changeset when public behavior ships.

---

## Catalog pointer

Managers row in [`node-catalog-and-discovery.md`](./node-catalog-and-discovery.md): **OPEN → LOCKED (collapse)**; Eng via this handoff. Old “Do not Eng managers until collapse locked” is **superseded**.
