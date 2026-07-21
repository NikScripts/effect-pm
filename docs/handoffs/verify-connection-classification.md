# Design: `verifyConnection` failure classification

**Status:** DESIGN — awaiting owner sign-off before Eng.
**Thread:** loud-failures / impossible-states. Was deferred behind multi-protocol nodes (now shipped on `integration`), so it's unblocked.
**Related:** [`loud-failures-design.md`](./loud-failures-design.md) · multi-protocol nodes · `NodeStatus` (shipped RPC health resource).

## The gap (not "build it" — it exists)

`Resource.verifyConnection(node, opts?)` already ships as the **F3 reachability backstop**: it opens one bounded transport connection to the node's `url`/`kind` and fails `NodeUnreachable | UnaddressedNode`. Its own JSDoc admits the limit:

> "It does not distinguish a protocol *mismatch* on the http side (a socket server answers an http probe) — surfaces here as unreachable."

So **every failure collapses to `NodeUnreachable`.** A client can't tell apart:

| Reality | Today's result | What the operator should hear |
|---|---|---|
| Nothing listening | `NodeUnreachable` | "the Droplet is down" ✅ |
| Wrong protocol (ws node → http-only server) | `NodeUnreachable` | "served over Http, node declares WebSocket" ❌ |
| Right host, wrong/absent service | `NodeUnreachable` | "reachable, but doesn't serve `app/Emails`" ❌ |
| Right service, not ready | `NodeUnreachable` | "reachable, `app/Emails` is degraded" ❌ |

The last three are the *silent-wiring* failure class this whole thread exists to kill. verifyConnection is a TCP/HTTP liveness ping today; the work is **escalating it to an RPC-level classification** using the primitive that already exists.

## The primitive: `NodeStatus` (shipped)

`NodeStatus` is a zero-config resource every served node answers. `NodeStatus.clientHttp(url)` (and a socket equivalent) dials it; `status` returns:

```ts
{ up, status: "ok" | "degraded", startedAt, uptimeMillis, resourceCount,
  resources: Array<{ key: string; kind: string; ready: boolean; detail?: string }> }
```

That `resources` array is the whole classification key: it carries the **served resource keys + per-resource readiness** — so "right host / wrong service" and "not ready" are answerable with **no new wire surface and no contractHash**. (Lookup already uses `NodeStatus.ping` for incumbent liveness, so the transport path is proven.)

## Proposed classification — three tiers, escalating

```
verifyConnection(node)                         // reachability (today, unchanged default)
  └─ transport connect fails ........ NodeUnreachable        (tier 1)

verifyConnection(node, { deep: true })         // NEW: escalate through the tiers
  ├─ transport connects, protocol handshake fails ... ProtocolUnanswered   (tier 2)
  └─ transport + protocol OK → dial NodeStatus.status
       ├─ NodeStatus doesn't answer .............. NodeUnreachable (tier 1, refined cause)
       ├─ target key ∉ status.resources ......... ServiceNotServed  (tier 3a)
       └─ target key present but ready === false . ServiceNotReady  (tier 3b)   → success otherwise
```

Tier 1 stays the cheap default (no behaviour change for existing callers). `deep` opts into the RPC round-trip.

## Multi-protocol interaction (the reason it waited)

A multi-protocol node declares several endpoints (`{ http, ws }`). verifyConnection must pick which to probe. **Proposal: reuse `selectEndpoint(node)`** — the exact same selection `connect` uses (browser → WebSocket-first, else Http-first) — so "verify" checks the endpoint the client would actually dial. An `{ all: true }` option can probe every declared endpoint for a fleet-wide preflight. (Decision D3 below.)

## Ownership

- **Mine (harness / this thread):** the classification control flow, the new error types, the escalation-to-`NodeStatus` logic, tests.
- **Reused, shipped:** `NodeStatus` resource + its client, `selectEndpoint`, the existing `probeHttpReachable` / `probeSocketReachable`.
- **Agent C (runtime):** nothing new required — this composes existing transport + RpcClient; flag if a new probe shape is needed.

## Decisions to lock (my recommendation in **bold**)

- **D1 — Shape.** Escalate in-place via `verifyConnection(node, { deep })` **[recommended]**, or a separate `verifyContract`/`verifyReady`? In-place keeps one entry point; the tiers are a natural progression of the same question ("can I actually use this node?").
- **D2 — Error model.** Distinct tagged errors (`ProtocolUnanswered`, `ServiceNotServed`, `ServiceNotReady`) **[recommended]** vs one `VerifyFailed` with a `reason` discriminant. Distinct errors let callers `catchTag` precisely and match the package's existing per-failure-mode error style (`ProtocolKindMismatch`, `UnaddressedNode`, …).
- **D3 — Multi-protocol.** Verify the `selectEndpoint`-selected endpoint by default **[recommended]**, with `{ all: true }` to probe every declared transport.
- **D4 — contractHash.** **Out of scope** [recommended] — `NodeStatus.resources` gives served-key + readiness, which covers wrong/not-ready service. A true contract-*shape* digest is a separate future primitive; note and defer.
- **D5 — Default.** `deep` defaults **off** [recommended] — tier-1 reachability stays the cheap fast-start check; opt into the RPC round-trip explicitly.

## Not doing

- No new wire surface on served nodes (NodeStatus already carries what's needed).
- No contract-shape hashing (D4).
- No change to tier-1 default behaviour or existing callers.
