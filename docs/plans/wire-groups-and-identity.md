# Plan: wire groups, identity, and shared Spec

**Status:** W1–W3 Eng’d (W3 = shared `Tag(wireKey, spec)` factory; **no** `*Family*` APIs).  
**Agent:** 4 (`cursor/hyperservice-open-deps-5679`).  
**Supersedes:** casual use of public `groupId` as a second identity; doc/examples that teach `tagFor("queue", …)` as the WorkPool model; the 2026-07-14 “keep `groupId`” exception for RPC naming (see owner-decisions).  
**Incident:** premature public `Family` / `serveFamily` attempt was rejected — see [`../handoffs/agent-04-w3-incident-2026-07-27.md`](../handoffs/agent-04-w3-incident-2026-07-27.md).

---

## Two different “groups” (do not conflate)

### 1. Regular RPC group (dogfooded path — WorkPool, Daemon, Gate, …)

One Tag → one Effect `RpcGroup` → wire procedures prefixed by **that tag’s key**.

```ts
class Mail extends WorkPool.Tag<Mail>()("@app/Mail", { payload: Job }) {}
// RpcGroup / wire prefix = "@app/Mail"
// kindOf(Mail) = "hyperlink-ts/WorkPool"  (classification only — not the RpcGroup name)
```

- **Wire prefix = tag `.key`.**  
- **Kind** = toolkit / dashboard classify (`kindOf`), not the group name.  
- Public `.groupId` removed (W1); use `.key` / `wireKeyOf`.

### 2. Shared Spec (kind-keyed)

Several instances, **one identical wire Spec**, one RpcGroup, instances distinguished by routing (header `key` / instance table).

- **Wire prefix = factory wire key** (usually the kind id).  
- **Instance `.key`** = Context identity + routing.  
- Authors never set a `wireMode` flag — Effect style: **overload of `Tag`** stamps the behavior.

```ts
const Metrics = Hyperlink.Tag("hyperlink-ts/ApiMetrics", { /* shared Spec */ })
class Nwsl extends Metrics<Nwsl>()("@app/Nwsl/metrics") {}
class Mls extends Metrics<Mls>()("@app/Mls/metrics") {}

Layer.mergeAll(
  Hyperlink.serve(Nwsl, nwslImpl),
  Hyperlink.serve(Mls, mlsImpl),
)
// one RpcGroup prefixed by hyperlink-ts/ApiMetrics; route by header key
```

Demo (metrics-shaped, ApiMetrics **not** migrated): [`../../examples/forms/resource/shared-tag-wire.ts`](../../examples/forms/resource/shared-tag-wire.ts).

---

## What can share a Spec (kind-keyed)

Share only when every instance has the **same** procedure names and schemas.

| Can share (fixed Spec) | Kind / wire key | Notes |
|------------------------|-----------------|--------|
| ApiMetrics full Spec | `hyperlink-ts/ApiMetrics` | Candidate — **not migrated yet** (product shape open) |
| Daemon.Schedule full Spec | `hyperlink-ts/Daemon/Schedule` | Clean candidate |
| WorkPool **control only** | `hyperlink-ts/WorkPool` | `queueControlSpec` — no item type |
| Priority **control only** | `hyperlink-ts/WorkPool/priority` | `priorityControlSpec` |
| Daemon **control only** | `hyperlink-ts/Daemon` | `daemonControlSpec` — no typed `run`/`events` |
| Gate **observation only** | `hyperlink-ts/Gate` | refs only — not `run` |

| Cannot share **full** instance Spec | Why |
|-------------------------------------|-----|
| WorkPool.Tag / priority | Item-typed data plane (`add`, `events`, …); priority also lane schemas |
| Daemon.Tag with success/error | Typed `run` / `events` / optional `result` |
| Daemon + schedule graft | Spec **shape** differs from base |
| Gate.Tag | Typed `run` payload/success/error |
| Arbitrary author Spec (usually) | Prefer solo `Tag<Self>()(key, spec)` |

Never merge different kinds into one group (`WorkPool` ≠ `WorkPool/priority`, `Daemon` ≠ `Daemon/Schedule`).

---

## Author-facing API (hide the mechanism)

| Entry point | Meaning | Wire (internal) |
|-------------|---------|-----------------|
| `Hyperlink.Tag<Self>()(key, spec)` / toolkit `.Tag` | One resource | prefix = **tag key** |
| `Hyperlink.Tag(wireKey, spec)` → `Factory<Self>()(instanceKey)` | Related instances, same Spec | prefix = **wire key**; route by instance key |

No public `groupId`. No author-facing `wireMode`. **No** `Family` / `serveFamily` / `clientFamily` / `member`.  
Internal discriminant: `sharedTagSym`. Existing `serve` / `client` pick the path.  
`Hyperlink.wireKeyOf(tag)` → tag key or factory wire key.

---

## Cleanup vs current code

| Today / target | Status |
|----------------|--------|
| `.groupId` === `.key` on toolkit Tags | **Removed** (W1) |
| `tagFor` / `serveInstances` / `clientInstances` / `instance` | **Deleted** (W2) |
| Shared Spec mint via `Tag(wireKey, spec)` | **Eng’d** (W3) |
| ApiMetrics on shared Spec | **Deferred** — demo only; metrics vs Gate handle nest still open |
| `forwardClient` sends header `key` | Solo: instance key (= wire key); shared: required for routing |
| `ServedHyperlinks` keyed by wire key | One registry entry per shared wire key |

Spec-hash stays **`contractHash` / verify**, not the RpcGroup name.

---

## Eng slices

| Slice | Scope | Status |
|-------|--------|--------|
| **W0** | Plan + owner-decisions | done |
| **W1** | Solo path: drop public `groupId`; `wireKeyOf` | Eng’d |
| **W2** | Delete unused family path (`tagFor` / …) | Eng’d |
| **W3** | `Tag(wireKey, spec)` + serve merge + client via header `key` | Eng’d (this change) |
| **W4** | Prototype story (compose Spec + features) — later | open |
| **W5** | Optional WorkPool/Daemon control vs data-plane split | open |

**Paused / next (not this slice):** ApiMetrics migration; Gate reserved features nest. Tag-baked adornments Eng’d as `default` / `defaults` ([`service-shapes.md`](./service-shapes.md)).

---

## Non-goals

- Kind key as RpcGroup prefix for regular (per-instance Spec) Tags.  
- Forcing full WorkPool/Daemon/Gate Specs onto one kind-keyed group.  
- Spec-hash as human wire group name.  
- Public `wireMode` flag on every tag.  
- New serve/client verbs for shared Spec.

---

## References

- Claim / build: `src/Hyperlink.ts` (`Tag`, `buildInstanceTag`, `wireTag`, `forwardClient`, `sharedTagSym`).  
- Shareable fragments: `queueControlSpec` / `priorityControlSpec` (`WorkPool.ts`), `daemonControlSpec` / `scheduleHyperlinkSpec` (`Daemon.ts`), `apiMetricsSpec` (`ApiMetrics.ts`), Gate observation in `internal/gateSchema.ts`.  
- Demo: `examples/forms/resource/shared-tag-wire.ts`.  
- UI: `tagWireKey` in `src/ui/data.ts`.  
- Related: [`service-shapes.md`](./service-shapes.md) (handle taxonomy; orthogonal).
