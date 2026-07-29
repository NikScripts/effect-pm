# Mission: node handoff (zero-downtime updates, cross-version migration)

> **Active agent entrypoint:** [`launcher-and-handoff-brief.md`](./launcher-and-handoff-brief.md).
> This file is **goal framing** — what “done” looks like for callers and fleets.
> Track C Locked **#27–34 + #39** are **Eng'd** on tip (drain → serve-site `{ handoff }` →
> leave; WorkPool baked `releaseEnqueueHandoff`; live suite `test/handoff-ab-cutover.test.ts`).
> Open problems below are still design/product territory (version negotiation, dual-serve,
> client redirect) — not a license to re-invent shipped verbs.

Owner directive, 2026-07-22. Updated 2026-07-29 after #39 land.

## The goal

**Handoff**: a served Hyperlink moves from one node to another without its callers noticing.

Two headline capabilities, in the owner's framing:

1. **Updates without downtime.** Stand up the replacement, hand the node's HyperServices over,
   retire the original. Callers keep calling the whole time.
2. **Migration across versions.** Handoff must work **between nodes running different versions of
   the library**. A fleet is never all on one version during a rollout, so version skew is the
   normal case, not the edge case.

## Why this is now natural to attempt

- Placement is already dynamic: peers model, Lookup two-stage Tag/Lookup, `onConflict` threading.
- Transports are injected and typed (protocol dependency + loud-failures).
- Contracts are schema-first everywhere: every value that crosses a boundary already has a codec,
  which is the raw material for cross-version compatibility.
- **Cutover substrate (Eng'd):** `Node.drain` / `shutdown`, Directory membership push,
  serve-site `handoff(from, to, ctx)` with `Done` | `Retry` | `Defer`, WorkPool peer transfer,
  `lookupClient` / `peersLayer` dial rebind.

## Solved for C v1 (do not re-open casually)

| Problem (was open) | Shipped answer |
|--------------------|----------------|
| Cutover drain | `phase: "draining"`; yield fail-closed; drain-then-cut on outgoing node |
| Opt-in per HyperService | `Hyperlink.serve(…, { handoff })` (#39); default off except WorkPool bake |
| WorkPool state | `WorkPool.releaseEnqueueHandoff` always on `serve` / `serveRemote` |
| Peer pick | Directory row, **exclude self by dial** (not `nodeKey`) |
| Defer / no peer / defect | Restore `running`, keep Directory row, surface `HandoffDeferred` |
| Membership during swap | Directory row held while draining; `askIncumbent` cannot steal |

## Still hard / open (bring to design; do not solve silently)

- **Dual-serve / client redirect** — Track D (C emits signals only: Directory.changes, Advice, status).
- **Version negotiation ranges** — #35 deferred; reuse binary `contractHash` / `ContractMismatch` for now.
- **Lookup-node handoff** — #36 deferred (not special-cased in C v1).
- **`restartSuccessor` / automated A/B launcher** — deferred; replacement addressing today =
  same `nodeKey` + new dial (manual / less-automated).

## House constraints that apply

- Design first for *new* surface: decisions doc, owner approval item by item
  ([working-agreement](../standards/working-agreement.md)).
- "What would Effect do" is the standing tiebreaker for API shape.
- Prefer existing nouns (`Node`, Lookup, `Hyperlink.serve`) — no `HandoffManager`.

## Where to look

| Doc / suite | Role |
|-------------|------|
| [`launcher-and-handoff-brief.md`](./launcher-and-handoff-brief.md) | Locked decisions + short prompt |
| [`../guides/identity-coordinator.md`](../guides/identity-coordinator.md) | Custody vs membership + A→B recipe |
| [`../guides/work-pools.md`](../guides/work-pools.md) | `release` / `enqueue` + baked handoff |
| `test/handoff-ab-cutover.test.ts` | Live A→B crown-jewel suite |
| `test/hyperlink-handoff.test.ts` | Outcomes + shutdown orchestration units |
