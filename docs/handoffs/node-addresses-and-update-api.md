# Node addresses + update API — design notes

**Status:** **Design only** (owner 2026-08-07). Not locked. Not Eng’d. Not SSOT.  
**Owner lean:** pivot cutover around a **stable main address** (+ optional additional /
A·B addresses), and **fix the current `Launcher.restartSuccessor` shape before** building
address plumbing on top of it.  
**Branch:** Agent 5 · `cursor/lifecycle-defer-start-929b`  
**Related:** [`multi-protocol-nodes.md`](./multi-protocol-nodes.md) (Eng’d — per-kind
`endpoints`, not multi-address) · [`versioned-schema-decisions.md`](./versioned-schema-decisions.md)
(Lookup single-address lock; app dial-replace) · [`launcher-and-handoff-brief.md`](./launcher-and-handoff-brief.md)
· dream recipe [`docs/examples/launcher/dream-redeploy.md`](../examples/launcher/dream-redeploy.md)
(**provisional** — documents today’s Eng’d surface, not the desired API)

---

## 1. Why we’re here

The dream redeploy example proved OS file-swap + sticky tip + WorkPool handoff **can** work
on tip. The **API that drives it is trash**: bag-of-options orchestration that is not
Effect-shaped, not SSOT with Node/Lookup/Policy, and not something we want apps to copy.

```ts
// TODAY (Eng’d) — do not treat as the dream API
const impact = yield* Launcher.restartSuccessor({
  target: WORKER_NODE_KEY,
  successor: {
    node: nodeB,
    process: child(portB),
    ready: { timeout: "25 seconds" },
  },
  tags: [Jobs, Probe],
  // prefer: true (default)
})
```

**Owner:** document the address ideas, then **discuss how we fix this API** before Enging
main/additional addresses on top of it.

---

## 2. What’s wrong with `restartSuccessor` today

Not a polish list — design failures:

| Failure | Detail |
|---------|--------|
| **Not SSOT** | Update story is split across `Lookup.planUpdate`, `Launcher.restartSuccessor`, `Advice.prefer`, Directory dial-replace, Policy sticky, and dream docs — no single declarative “this node updates like this.” |
| **Options bag** | `target` + nested `successor: SpawnSpec` + `tags` + `incumbent` + force/status/skip/prefer flags. Looks like a CLI struct, not a Hyperlink composition. |
| **Identity lie** | Apps mint `nodeA` / `nodeB` as separate `Node.Tag` values that share a `nodeKey` but different dials. The “same node” is reconstructed from Directory after the fact. |
| **Address is the cutover** | Cutover = invent a second dial and hope Directory + sticky + prefer stitch it. No first-class stable public address. |
| **Tags as plan input** | Caller re-lists what B will serve; easy to drift from the child’s actual `Node.http(…, [serve…])`. |
| **Prefer as a boolean** | Dual-serve / early-move is a Policy/Advice concern stuffed into a launcher flag. |
| **Dream recipe is a script** | File-swap + ports + active path + waitUntil Directory — proves mechanics, not a product API. |

**Standards it falls short of (owner):** Effect-true composition (layers/pipes over option
blobs), namespace SSOT (one place owns “how this node is addressed / updated”), and the
bar set by `Policy.make` / `Node.withProtocol` (typed fragments you compose, not a restart
RPC).

**What stays valuable from Eng’d work:** `Lookup.planUpdate` impact shape, Directory as
membership, Policy sticky + Advice early-move, WorkPool baked handoff, `Lookup.follow` for
**Lookup’s** single-address ownership gap. The **execution verb shape** and **address model
for app nodes** are what’s in the dock.

---

## 3. Desired address model (design — not locked)

### 3.1 Main address + additional addresses

A node has:

1. **Main address** — the public / durable dial clients and HyperServices care about.
2. **Additional addresses** — a list of extra dials (roles such as **A**, **B**, backend,
   internal) used for cutover, proxy backends, local IPC, etc.

```ts
// SKETCH ONLY — not Eng’d
Node.Tag()("fleet/Worker", {
  // main — what most of the world dials
  url: "http://workers.example/rpc",
  kind: "Http",
})
// …later pipe additional addresses (see §3.3)
```

Or config-first (same idea: main in the base declaration):

```ts
// SKETCH — main in Tag config
Node.Tag()("fleet/Worker", {
  main: { url: "http://workers.example/rpc", kind: "Http" },
  // addresses?: […]  — or only via pipe
})
```

**Contrast with today’s multi-protocol `endpoints`:** Eng’d X1 is **one dial per protocol
kind** (`http` / `ws` / `ipc`) for connect selection. That is **not** “many addresses of the
same kind” and **not** role-tagged A/B backends. Additional addresses are a **list**
(possibly same kind, role-labeled), orthogonal to per-kind endpoint sets — exact type merge
is an open design fork (§6).

### 3.2 Roles — A / B (and friends)

Additional addresses can carry a **role** (name TBD: `"a"` | `"b"` | `"backend"` | …) so
orchestration and proxy routing know which dial is incumbent vs successor without minting a
second `nodeKey`.

Owner sketch:

- **Main** = stable client-facing dial (often Http).
- **Additional A / B** = concrete process endpoints (often Unix) that take turns owning
  work behind the main address.

Directory today: **one row per `nodeKey`**. That may need to grow (advertise main vs
backend, or a proxy row + backend rows) — open.

### 3.3 Declare main first; pipe additional later

**Owner preference for best DX:**

1. Put the **main address on the original Node** (Tag config / first declaration).
2. **Pipe on** Unix (or other) additional addresses afterward.
3. The `Node` value passed into **HyperServices** (`Hyperlink.serve` / `WorkPool.serve` /
   clients that shouldn’t see backends) **only carries the main address**.

```ts
// SKETCH — composition shape, names TBD
const WorkerMain = Node.Tag()("fleet/Worker", {
  url: "http://127.0.0.1:8080/rpc",
  kind: "Http",
})

const WorkerWithBackends = WorkerMain.pipe(
  Node.withAddresses({
    a: { path: "/tmp/hyperlink-ts/fleet-Worker.a.sock" }, // or generated — §3.5
    b: { path: "/tmp/hyperlink-ts/fleet-Worker.b.sock" },
  }),
)

// HyperServices see WorkerMain (main only)
// Launcher / proxy / update plane see WorkerWithBackends
```

Rationale: serve/client layers stay simple; cutover plumbing doesn’t leak into every
`serve` call. Mirrors the mental model of `Node.withProtocol` (pipe widens capability)
without overloading protocol-kind sets as A/B slots.

### 3.4 How addresses are used (policy / config)

Addresses need **usage config**, not just presence. Owner direction for interruption-free
updates:

| Address | Typical kind | Role |
|---------|--------------|------|
| **Main** | Http (or WS) | Stable public dial — clients keep this forever when a proxy owns it |
| **Additional A/B** | Unix / IpcSocket | Process-local backends; swap which one is live behind main |

Usage knobs to design (names TBD):

- Which address Directory advertises by default (main vs backends).
- Which address `lookupClient` / peers dial.
- Which address Launcher binds / assumes / shuts down.
- Whether main is a **proxy** that forwards to A or B (see §4).
- Prefer / sticky / stream-gap still compose via **Policy** — not buried in restart options.

### 3.5 Generate addresses from `nodeKey`

**Owner want:** derive dials from the node key so ops don’t hand-mint `/tmp/….sock` strings.

| Kind | Feasibility (design) |
|------|----------------------|
| **IpcSocket / Unix** | Easy — e.g. `/tmp/hyperlink-ts/<slug(nodeKey)>.sock` or `.a.sock` / `.b.sock` |
| **Http / WS** | Harder — need host/port policy, conflict with exclusive bind, multi-tenant hosts |
| **Lookup default** | Already has `Lookup.defaultIpcPath`; app nodes have **no** key→path helper today |

Sketch:

```ts
// SKETCH
Node.addressFromKey(WORKER_NODE_KEY, { kind: "IpcSocket", role: "a" })
// → { path: "/tmp/hyperlink-ts/examples-dream-redeploy-Worker.a.sock", kind: "IpcSocket" }
```

Open: slug rules, directory root Config, collision policy, Windows named-pipe story.

---

## 4. Pivot lean — static main as proxy (owner leaning)

Two cutover shapes on the table:

### Shape α — dual public dials (today’s Eng’d trajectory)

Clients learn A’s Http, then B’s Http (same `nodeKey`, dial-replace + sticky + prefer).
**No stable URL** across the update. Dream file-swap still needs a second port/`nodeB`.

### Shape β — stable main + proxy to A/B (**owner lean**)

```
clients ──Http──►  main (proxy / stable address)
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
       A (Unix)                B (Unix)
```

- **Main address** stays fixed (Http). Clients never rebind for a binary update.
- **Proxy** (Lookup-adjacent, Launcher-owned, or a small Node role — TBD) directs traffic to
  the live backend (A or B).
- **Backend hop** may use a **different protocol** than main (Http out front, Unix to the
  real process) for cheap local forwarding and exclusive-bind clarity.
- Update = bring up B on its additional address → point proxy at B → drain/shutdown A.
  Clients keep dialing main.

This reopens / reframes “explicit Redirect SDK” (earlier rejected for v1 sticky+Advice): the
lean is **not** a client-side redirect API — it’s a **server-side stable address** with
backend selection. Sticky/Advice may still matter for non-proxy fleets.

**Lookup node** stays under the existing lock: **one Lookup address**, successive owners,
`Lookup.follow` for the gap — do **not** silently dual-address Lookup unless owner unlocks
that separately. This doc is about **app nodes** (and possibly a proxy role in front of them).

---

## 5. Implications for the update API (discussion fodder — not a proposal lock)

Whatever replaces `restartSuccessor` should probably:

1. Talk in terms of **one Node identity** + **which additional address / role** is coming up,
   not `nodeA` vs `nodeB` forgeries.
2. Keep **plan** on Lookup (`planUpdate` or successor) and **custody/spawn** on Launcher —
   but compose like layers/pipes, not one mega-options struct.
3. Leave **prefer / sticky / stream gap** on Policy/Advice.
4. Make the **happy path** for interruption-free updates: main Http + Unix A/B (+ optional
   proxy), file or image swap behind B’s address, flip main→B, handoff, stop A.
5. Stop requiring apps to re-pass `tags: [Jobs, Probe]` if the child’s serve set is already
   knowable (or make plan discover it).

**Explicit non-goal until discussion:** rewriting the dream example as SSOT. Mark it
provisional; fix the API design first.

---

## 6. Open forks (for the discussion — do not resolve in this doc alone)

1. **Fix `restartSuccessor` shape first** vs design addresses first then the verb — owner:
   fix the trash API in discussion before Enging addresses onto it.
2. **Proxy ownership:** Launcher? dedicated proxy Node? Lookup feature? per-service sidecar?
3. **Directory advertise:** main only vs main+backends vs proxy row separate from worker key.
4. **Type model:** extend `endpoints` vs new `addresses: ReadonlyArray<{ role, … }>` vs
   both (protocol set ∪ role list).
5. **HyperServices see main only** — enforced by types (strip additional) or by convention?
6. **Http/WS address-from-key** — in scope or Unix-only v1?
7. **Relation to `Node.withProtocol`** — pipe sibling (`withAddresses`) vs overload.
8. **Deprecation path** for Eng’d `restartSuccessor` + dream-redeploy docs/example.

---

## 7. Current Eng’d facts (do not confuse with §3–§5)

| Fact | Where |
|------|--------|
| One primary `(kind, url\|path)` + optional per-kind `endpoints` | `Node.Tag` / `withProtocol` |
| Directory: one dial row per `nodeKey` | `DirectoryEntry` |
| App A/B today = same key, new dial, sticky + prefer | `restartSuccessor`, Policy |
| Lookup A/B = one address, orchestrated ownership | `Lookup.follow` |
| No address-from-`nodeKey` helper | — |
| No role-tagged additional address list | — |
| No proxy-as-main-address | — |

---

## 8. Next

1. **Discuss** how to replace the `restartSuccessor` options-bag API (this thread).
2. Lock address model forks (§6) enough to sketch the new update composition.
3. Only then Eng: types → Directory/advertise → proxy or dual-dial path → migrate examples.
4. Demote / rewrite dream-redeploy once the new API exists; until then keep the banner:
   **provisional, not the desired SSOT.**
