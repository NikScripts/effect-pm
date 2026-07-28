# Identity coordinator — exclusive brain + many hands

**Status:** **M4–M6 Eng’d** (2026-07-21) — identity coordinator v1 complete.  
**Work branch:** `cursor/logs-store-followers-plan-906e` — sync tip with `integration`.  
**Related:** [`node-catalog-and-discovery.md`](./node-catalog-and-discovery.md) · [`owner-decisions.md`](./owner-decisions.md) · guide [`docs/guides/identity-coordinator.md`](../guides/identity-coordinator.md).

---

## The dream (product)

You never think “Manager” as a special library noun. You think **one brain, many hands**:

```text
                    LOOKUP (phone book + referee + placement board)
                   ┌────────────────────────────────────┐
                   │ Identity:  "Router" → node A       │
                   │ Directory: Worker#w1, w2, w3       │
                   │ Advice:    "prefer w2 right now"   │  ← Eng’d (M5)
                   └───────────────┬────────────────────┘
                                   │
           ┌───────────────────────┼───────────────────────┐
           ▼                       ▼                       ▼
        Router                  Worker                 Worker
     (identity —              (many —                 (many —
      only one)                advertise)              advertise)
```

Same `yield* Router` / `yield* Worker` everywhere. Winner serves; losers dial the winner; workers come and go; Lookup stays the truth.

**One-line pitch:** Identity becomes the exclusive brain (alive, teachable, handoff-capable). Lookup becomes the referee + phone book + placement board. Workers stay many. We never ship a second claim system named `Hyperlink.Manager` — we finish this one until it feels like the dream.

---

## Locked decisions (this bake)

| # | Decision | Lock |
|---|----------|------|
| **M1** | **Collapse** | No `Hyperlink.Manager` ctor / product surface. Exclusive HyperServices = `Hyperlink.identity` (S1, already Eng’d). |
| **M2** | **Dedupe** | Key-only (already S1). No required value-level `manages[]` Tag list. |
| **M3** | **Pattern** | One brain (identity) + many hands (directory / nameless / `Prototype` / `distributed`). Taught as the fleet recipe. |
| **M4** | **v1 Eng spine** | **Identity liveness** (dead winner → claim releasable / replaceable) + **coordinator+workers example**. |
| **M5** | **Placement advice** | **Eng’d** — `Lookup.Advice` last-write prefer; `lookupClient` honors live preferred `nodeKey` before D4 `pick`. Not a separate Manager type. |
| **M6** | **Sugar** | **Eng’d** — recipe guide + `Lookup.prefer` / `preferEntry`; clearer `IdentitySelfRequired`; Lookup stays pipe-only. |

**Rejected / deferred:**

- Inventing `Hyperlink.Manager` as a second first-wins system.
- Mandatory ctor bag of managed Tags (package-edge / import-type tax).
- Seamless cross-network elect for Lookup (L1 already: same-machine OS bind; remote = explicit).
- `contractHash` / default-on verify (loud-failures later track).

---

## What already ships (don’t rebuild)

| Piece | Status |
|-------|--------|
| `Hyperlink.identity` pipe; `layer` / `serve` claim → serve-or-client | **Eng’d** (S1) |
| Lookup `Identity.claim` first-wins / `DuplicateIdentity` + original endpoint | **Eng’d** |
| Directory advertise / `nodesServing` / `livenessReplace` / `askIncumbent` | **Eng’d** |
| `lookupClient` + D4 `{ pick }` | **Eng’d** |
| Nameless / Prototype / multi-protocol listen + clients | **Eng’d** |
| Loud-failures: `verifyConnection({ deep })`, `ProtocolMismatch`, `MissingClientProtocol` | **Eng’d** |
| Identity claim liveness (dead winner → replaceable) + same-dial refresh | **Eng’d** (M4 slice 1) |
| Coordinator+workers form (`node-identity-coordinator`) | **Eng’d** (M4 slice 2) |
| `Lookup.Advice` + `lookupClient` honors prefer | **Eng’d** (M5) |
| Recipe guide + `Lookup.prefer*` + IdentitySelfRequired clarity | **Eng’d** (M6) |

---

## Gaps → Eng slices

### Slice 1 — Identity liveness (**M4 core**) — **Eng’d**

**Goal:** A dead winner does not own the key forever.

Shipped:

1. Lookup identity `claim` pings incumbent via `NodeStatus` (same primitive as directory).
2. Dead / unreachable → claim released; newcomer wins. Alive → `DuplicateIdentity`.
3. Same dial refreshes without error. Cooperative `askIncumbent` for identity keys left optional/later.
4. Tests: `test/lookup-identity.test.ts`, `test/hyperlink-identity.test.ts` (dead winner reclaim).

**Not in slice 1:** placement advice wire, Manager naming, changing S1 fail-closed-when-Lookup-down.

### Slice 2 — Teach the pattern (**M4 companion**) — **Eng’d**

**Goal:** One copy-paste fleet story.

- Form: [`examples/forms/hyperlink/node-identity-coordinator.ts`](../../examples/forms/hyperlink/node-identity-coordinator.ts) — identity **Router** + N **Worker**s + Lookup.
- README / catalog cross-link: “one brain, many hands.”
- Clearer `IdentitySelfRequired` message (Lookup + dialable self).

### Slice 3 — Placement advice (**M5**) — **Eng’d**

**Goal:** Smart dial without a Manager type.

**Bake locks (lean v1):**

| Topic | Lock |
|-------|------|
| Wire | `Lookup.Advice` — `advise` / `clear` / `preferred`; helpers `Lookup.advise` / `clearAdvice` / `preferred` |
| Key | `serviceKey` → preferred directory `nodeKey` |
| Retention | In-memory last-write-wins; stale prefer (not in `nodesServing`) ignored |
| Multi-advisor | Last write wins; no advisor ACL |
| Dial | `lookupClient` N>1: live prefer → dial; else D4 `pick` / ambiguous |
| Algorithms | App-owned (identity Router decides prefer) |

```ts
yield* Lookup.advise({ serviceKey: Worker.key, prefer: "fleet/Worker#w2" })
Hyperlink.lookupClient(Worker) // honors advice; pick only if absent/stale
```

### Slice 4 — Sugar (**M6**, last) — **Eng’d**

- Guide: [`docs/guides/identity-coordinator.md`](../guides/identity-coordinator.md)
- Helpers: `Lookup.prefer(tag\|key, nodeKey)`, `Lookup.preferEntry(tag|key, entry)`
- Clearer `IdentitySelfRequired` message (Lookup pipe + dialable self)
- Lookup stays pipe-only on listens (no magic in listen options)

---

## Dream app shape (illustrative)

```ts
class Router extends Hyperlink.Tag<Router>()("fleet/Router", {
  enqueue: Hyperlink.effectFn({ job: Job }, Schema.Void),
}).pipe(Hyperlink.identity) {}

class Worker extends Hyperlink.Tag<Worker>()("fleet/Worker", {
  run: Hyperlink.effectFn({ job: Job }, Schema.Void),
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
| 3 | Placement advice | **Eng’d** |
| 4 | Sugar | **Eng’d** |

**Agent:** work on `cursor/logs-store-followers-plan-906e`; sync so work branch and `integration` share the same tip. **No PRs** unless owner asks.

---

## Success criteria (v1 = slices 1–4) — **met**

- Kill winner process → next claimant can win the identity key without restarting Lookup by hand.
- Example runs: one Router, two Workers, enqueue reaches the **advised** worker.
- `Lookup.prefer` / `advise` + bare `lookupClient` dials prefer when live.
- Recipe guide + IdentitySelfRequired remediation; no `Hyperlink.Manager`.
- Typecheck + identity / lookup / advice tests green; changesets on tip.

---

## Catalog pointer

Managers row in [`node-catalog-and-discovery.md`](./node-catalog-and-discovery.md): **OPEN → LOCKED (collapse)**; Eng via this handoff. Old “Do not Eng managers until collapse locked” is **superseded**.
