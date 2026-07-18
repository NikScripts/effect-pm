# Design: Node catalog (`ROut`) + same-machine discovery

**Status:** **DESIGN** — living bake notes. Phase 1 IPC **LOCKED + SHIPPED**. Catalog / discovery / managers / lookup = mostly **thoughts** until explicitly locked in a bake row.  
**Thesis:** Make cross-runtime **seamless, easier, safer** — Node address + typed service catalog; optional discovery for same-machine (esp. Unix sockets).  
**Related:** [`transport-dependency-decisions.md`](./transport-dependency-decisions.md) · [`loud-failures-design.md`](./loud-failures-design.md) · [`docs/resources/fleets-and-peers.md`](../resources/fleets-and-peers.md)  
**Naming note:** This doc still says “Resource” for the shipped module. Product rename (e.g. Unbounded services) is **parked** — don’t block this design on it.

### How to read locks in this file

| Mark | Meaning |
|------|---------|
| **LOCKED** | Owner explicitly locked in bake / Eng shipped. Safe to Eng against. |
| **LEAN** | Package or agent recommendation — **not** an owner lock. |
| **THOUGHT** | Discussion idea / plan sketch. Must not be treated as decided. |
| **OPEN** | Named decision still needed before Eng of that slice. |

Agents: do **not** promote THOUGHT → LOCKED without owner. When in doubt, it is a thought.

---

## Why this is the next step

Today cross-runtime works but is **composition-heavy**:

- Node carries **one** `url` + **one** `ProtocolKind` → one `RpcClient.Protocol`.
- Tags optionally stamp `{ node }` or `.pipe(distributed([...]))`.
- Clients: `connect(Node)` once, then `client(Tag)` / `client(Tag, Node)` per contract.
- Serve list lives on `httpServer` / `wsServer([...expose])`, **not** on the Node type.
- Peers: **fixed** membership via `distributed` + `peersLayer` (no discovery).

The gap: **a Node does not type-declare what it serves**, and **peers don’t learn catalogs at runtime**. Same-machine multi-process feels like a lot of wiring for what should be “these runtimes find each other and offer Services.”

Cluster differentiation (keep sharp): Cluster = entity id → shard owner. We = **Node → reachable runtime + typed service catalog**; contracts stay ordinary Effect Services unbounded by runtime/network.

---

## What exists today (not a regression)

There was **no** shipped `Node<Self, ROut>` catalog API that got removed.

| Concern | Today |
|--------|--------|
| Address / kind | `Resource.Node("key", port \| url \| { url, kind })` |
| What a process exposes | `httpServer` / `wsServer([serve…])` list (value-level) |
| Tag → Node | optional `{ node }` on Tag, or `client(tag, node)`, or `distributed([...])` |
| Peers | static `distributed` set → `peersLayer` builds per-node clients |

So “add resources on the Node definition” is an **aspiration / next API**, not something to restore from git. The serve list on `httpServer` is the closest ancestor — move that catalog **onto the Node type** and prove it at `listen`.

---

## Proposal spine

### 1. `Node<Self, ROut = never>`

Two *uses*, one constructor:

```ts
// Address-only
class Worker extends Resource.Node<Worker>("app/Worker", { path: "/tmp/w.sock" }) {}

// Catalog (type-only imports — avoid bundling contract *impls* into the node module)
import type { Jobs } from "@app/jobs"
import type { Emails } from "@app/emails"

class Worker extends Resource.Node<Worker, Jobs | Emails>(
  "app/Worker",
  { path: "/tmp/w.sock" },
) {}
```

- **`ROut`** = union of resource **handles** (service types), not a value bag of Tags at runtime unless we also materialize `serves: string[]` from the expose list.
- **Optional bundling:** value-importing Tags into the node package is allowed when you want a single package that owns both catalog and contracts — not required. Prefer `import type` + contracts package for monorepos.

### 2. Break the circle

| Direction | Mechanism |
|-----------|-----------|
| Node → contracts in `ROut` | `import type` (erased; works cross-package one-way) |
| Contracts → Node | **THOUGHT / under bake (C1)** — earlier lean was “nodeless by default”; owner chat also wants Tags that **can** carry a node set when useful. Not locked. |
| Still allowed today | `{ node: Worker }` / `distributed([...])` / `client(Tag, Worker)` |

`import type` does **not** let Tags stamp Node without a value import. Monorepo: contracts package must not value-depend on node packages; node packages may type-depend on contracts.

### 3. `listen` proves the catalog

```ts
const WorkerLive = Resource.listen(Worker, [
  Resource.expose(Jobs, jobsImpl),
  Resource.expose(Emails, emailsImpl),
])
// Layer must provide Jobs | Emails (Worker’s ROut) — compile-time
```

Runtime `serves: ["app/Jobs", "app/Emails"]` should be **derived from the same expose list** so discovery can’t drift from `ROut`.

### 4. `clientsFor(Node)`

```ts
Resource.clientsFor(Worker)
// Layer<Jobs | Emails, …, Worker> — needs Worker connected
```

Dynamic provide: given runtime `serves` keys, install matching client layers (owner verified this is feasible). Static `ROut` types the happy path; discovery fills peers you didn’t hardcode.

### 5. Same-machine discovery (esp. UDS / IPC)

```text
Worker binds ephemeral path (or port 0)
publishes { nodeKey, address, kind, serves[] } to a local registry

Peer discovers → connect(address) → clientsFor / dynamic clients from serves[]
→ yield* Jobs   // no Jobs.pipe(onNode(Worker))
```

Discovery is a **Layer/source**, not Cluster membership: no rebalance, no entity routing — just **learn endpoints + catalogs**.

---

## How peers fit

Today `peers` answers: “given a **fixed** set of Nodes on this Tag, give me `Record<nodeKey, Leaf>`.”

With catalog + discovery, peers become a **two-layer** story:

| Layer | Role |
|-------|------|
| **Topology** | Which other runtimes exist? (static `distributed` **or** discovery registry) |
| **Catalog** | What Services does each runtime expose? (`ROut` / `serves[]`) |
| **Clients** | For each peer Node, `connect` + client layers for catalog ∩ what *this* Tag needs |
| **Folds** | Unchanged idea: `Resource.peers` / `fleet` / `MultiNode.*` over leaf shapes |

### Peers + nodeless Tags

Blessed same-machine path:

1. Each process: `listen(SelfNode, [expose…])` (+ publish to registry).  
2. Mesh: `discover` → map of peer Nodes (+ catalogs).  
3. `peersLayer` (evolved): build peer clients from **discovered Nodes**, not only from `distributed([...])` on each Tag.  
4. A Tag that needs a sibling leaf still marks `Resource.fleet` fields; membership comes from topology, not from stamping every Tag with every Node.

Static `distributed([A,B,C])` remains for **fixed fleets** (browser, known URLs, ShardMap v1 fixed membership). Discovery is the ergonomic default for **local multi-process**.

### Peers + ShardMap / Telemetry / FleetHealth

No change to *why* they fold — only *how membership is obtained*:

- **v1 (shipped):** `distributed` on the Tag.  
- **v2:** topology from discovery (or mix: seed Nodes + discovered).  
- Partition functions (`consistentHash`) still see a node-key set; remapping-on-membership-change stays an explicit policy (don’t silently become Cluster).

### Peers + multi-protocol Node (later)

If a Node advertises multiple endpoints (`http` / `socket` / `ipc`), peers need a **prefer** rule (`ipc > socket > http` on same machine). Out of scope for first catalog slice; keep one kind per Node until then.

---

## API sketch (names provisional)

| Piece | Intent |
|-------|--------|
| `Node<Self, ROut = never>(key, address?)` | Address + optional catalog type param |
| `listen(node, exposes[])` | Server mount; proves `ROut` |
| `expose` / rename of today’s serve-entry | Placement on a listen list (neutral name TBD with serve→expose pass) |
| `clientsFor(node)` | Layer providing clients for `ROut` |
| `discover` / `Discovery` layer | Local registry → peer Nodes + `serves[]` |
| `peersLayer` evolution | Static distributed **or** discovery-backed topology |
| `onNode(node)` pipe | Optional Tag→Node stamp (escape hatch) |

IPC / Unix socket protocol kind stays a **transport** add-on; discovery makes it pay off.

---

## Eng order (owner 2026-07-18: Unix socket first)

Ship **transport proof before catalog/discovery**. Complex API locks gate later slices only.

```text
Phase 0  API decisions that block each phase (below)
    │
Phase 1  IPC / Unix domain socket  ← first Eng
    │    ProtocolKind + address path + ipcServer/connectIpc + tests
    │
Phase 2  Node catalog types        ← after Phase-2 locks
    │    Node<Self, ROut>, listen proves ROut, clientsFor
    │
Phase 3  Local discovery           ← after Phase-3 locks
    │    registry + peersLayer discovery mode + same-machine example
    │
Phase 4  Docs polish + serve rename (if not done earlier)
```

### Phase 1 — IPC / UDS (do first)

**Goal:** two processes (or test parent+child) speak Effect RPC over a Unix socket path, same serve/client ergonomics as http/ws.

**Minimal surface (mirror existing):**

```ts
// conceptual — names TBD in Phase-0 locks for IPC only
class Worker extends Resource.Node<Worker>("app/Worker", {
  path: "/tmp/worker.sock",  // or path string overload
}) {}

Resource.ipcServer([Resource.serve(Jobs, jobsImpl)])  // listen on node path / options.path
Resource.connect(Worker)  // kind "ipc" → NodeSocket.layerNet({ path })
// or Resource.connectIpc(Worker) / connectIpc(path)
```

**Implementation sketch (Effect already has the bits):**

- Server: `RpcServer.layerProtocolSocketServer` + `NodeSocketServer.layer({ path })`
- Client: `RpcClient.layerProtocolSocket` + `NodeSocket.layerNet({ path })`
- Serialization: same ndjson default as http/ws
- Tests: e2e RPC (unary + stream) over a temp sock path; second bind → `EADDRINUSE`; stale sock file story documented

**Out of Phase 1:** `ROut`, discovery, peersLayer changes, serve→expose rename, multi-protocol Node.

**Touches:** `ProtocolKind`, `makeNode` address parsing, `protocolForNode` / `connect*`, new `ipcServer` (or shared raw-socket server helper), tests. Coordinate with whoever owns `src/Resource.ts` node/client surface (Agent E reservation history).

### Phase 2 — Node catalog (`ROut`)

`Node<Self, ROut = never>` (names provisional), `listen` proves catalog, `clientsFor`, runtime `serves[]` from expose/serve list. Tag↔Node default is **C1 OPEN** — see bake thoughts. Do not assume “nodeless by default” is locked.

### Phase 3 — Discovery + peers

Local registry, discover → connect → clients from `serves[]`, `peersLayer` accepts static **or** discovered topology. Pays off Phase 1 IPC.

### Phase 4 — Docs / rename hygiene

Managing Layers + Fleets & Peers; optional serve-family neutral names if locked.

---

## API decisions (lock by phase)

### Block Phase 1 (IPC) — **LOCKED + SHIPPED** (Eng 2026-07-18)

| # | Decision | Locked |
|---|----------|--------|
| **I1** | Kind name | **`"ipc"`** — `"socket"` stays WebSocket only |
| **I2** | Address shape on Node | **`{ path }`** → infers `kind: "ipc"`; `url` left undefined |
| **I3** | Server helper | **`Resource.ipcServer(serves, { path })`** |
| **I4** | Path lifecycle | **unlink before bind + on scope close** (`unlink: false` to opt out) |
| **I5** | Windows named pipes | **Unix-only v1**; same `ipc` kind later |

Shipped API:

```ts
class Worker extends Resource.Node<Worker>("worker", { path: "/tmp/worker.sock" }) {}
Resource.ipcServer([Resource.serve(Jobs, jobsImpl)], { path: Worker.path! })
Resource.connect(Worker)       // derives ipc
Resource.connectIpc(Worker)    // explicit
Resource.protocolIpc(path)
Resource.ipcClient(Worker)
```

Tests: `test/resource-ipc.test.ts`.

### Block Phase 2 (catalog) — **OPEN** (bake in progress; prior leans outdated)

| # | Decision | Status |
|---|----------|--------|
| **C1** | How Tags carry Nodes (set / bake / pipe / nodeless) | **OPEN** — see [Bake thoughts § Tags + node sets](#bake-thoughts-2026-07-18--tags-managers-lookup). Prior lean “nodeless by default” is **superseded as lean**; not replaced by a lock yet. |
| **C2** | `listen(node, exposes)` vs keep `httpServer`/`wsServer`/`ipcServer` as transport sugar | **OPEN** — old LEAN: keep transport servers; `listen` = catalog wrap |
| **C3** | Partial catalogs (runtime subset of `ROut`)? | **OPEN** — old LEAN: No |
| **C4** | Value-import Tags into node package allowed? | **OPEN** — old LEAN: yes as option; `import type` preferred |
| **C5** | Serve-family rename (`serve` → `expose`?) same program as catalog? | **OPEN** — owner asked; old LEAN was separate pass |

### Block Phase 3 (discovery) — **OPEN** (after catalog shape; may merge with lookup thoughts)

| # | Decision | Status |
|---|----------|--------|
| **D1** | Registry: filesystem dir vs UDS bus vs parent-injected env | **OPEN** — old LEAN: filesystem dir |
| **D2** | Discovery TTL / liveness | **OPEN** — old LEAN: RPC ping once connected |
| **D3** | `peersLayer`: discovery opt-in vs replace static `distributed` | **OPEN** — old LEAN: opt-in |
| **D4** | N instances of one Tag | **OPEN** — old LEAN: still `client(Tag, node)` |

### Cross-cutting — **OPEN** / parked

| # | Decision | Status |
|---|----------|--------|
| **X1** | Multi-protocol Node (endpoint set) | **OPEN** — later; one kind per Node until discovery exists |
| **X2** | Product rename away from “Resource” | **Parked** |
| **X3** | Docs: handoff-only vs draft guide now | Handoff SSOT now |
| **X4** | `Protocol` as Node **type param** | **Rejected as idea** (owner): value-level `kind` + address is SSOT — typing protocol twice drifts. Not a formal bake-row lock; do not re-propose. |

---

## Bake thoughts (2026-07-18) — Tags, managers, lookup

> Everything below is **THOUGHT** / plan sketch unless marked otherwise.  
> **Actually LOCKED in this program so far:** Phase 1 **I1–I5** only.

### Tags + node sets (C1 bake — unfinished)

**Shipped today (fact, not a new lock):**

- Optional single Node on Tag via `{ node }` (`nodeSym`) for `client(Tag)`.
- Multi-node **without** that stamp: `.pipe(Resource.distributed([...]))` — nodeless handle, equal peers; `peersLayer(Tag, self)` gets **self at runtime**.
- Examples already call this out (e.g. hub: “nodeless, every instance an equal peer”).

**Owner direction in chat (THOUGHTS — not stamped LOCKED):**

- When creating a Resource you **can** bake Node(s) into the tag; support multi-node; overwrite and add.
- Tag carrying nodes is valuable: handle has what you need for a client layer.
- Pristine base via pipe, preferring **class** handles for consistency:
  - `export class MyQueue extends MyQueueBase.pipe(Resource.nodes([...])) {}`
  - const camelCase pipe also works; same Context key / service — derived tag is extra metadata, not a different handle.
- API shape sketched: `Resource.nodes(...)` **overwrites** node-set metadata; separate **add** helper (name sketch `Resource.andNode`). Per-slot overrides later, not now.
- **No “home” Node** on the Tag. Agent briefly invented home vs fleet; owner rejected. Peers only know self / dial target **at runtime**. A Tag carries a **set** (or none) — not a privileged home.

**Still OPEN for C1:** exact API names (`nodes` vs keep `distributed`), copy-on-pipe vs today’s mutate-in-place `distributed`, whether definition `{ node }` is just set-of-one sugar, and the formal lock sentence.

### Single-connect over a multi-node set (THOUGHT)

Gap: `distributed` + peers/ShardMap answer folds and sticky keys; nothing answers “ordinary `client(Tag)`, pick **one** replica.”

Early sketches (client-side random / RR / balancedClient) are **THOUGHTS only**. Owner pushed further: placement should be able to use **fleet-aware logic inside the mesh**, not only dumb client pick.

### Resource managers (THOUGHT — under rethink)

Sketches discussed:

- Managers are **Resources**, with their own constructor (sketch: `Resource.Manager` instead of `Resource.Tag`) and maybe extra features later.
- A manager does **not** specially mean `leastWork` — it runs **whatever algorithm you coded** (least work, sticky, custom, …).
- Node typing sketch evolved then partially walked back:
  - Idea: `Node<Self, Served, Managing>` plus runtime `serves[]` / `manages[]`.
  - **No** `Protocol` type param (see X4).
  - Multiple managers: compile-time only helps **one build**; cross-runtime you need runtime ads / verification. Owner dislikes not catching duplicates at compile; may mean the concept is **mixing address lookup with resource managers**.

**Do not Eng managers yet.** Concept may be split or replaced by lookup (next).

### Lookup / “DNS” vs managers (THOUGHT — active rethink)

Owner concern: we may be mixing **where to dial** (address / membership lookup) with **resource managers** (app-level algorithms over a fleet).

Sketch:

- Something like a **DNS / lookup service**: tell the client which Node to use for a resource (or for a named fleet).
- Essentially discovery, but **don’t require** starting a separate dedicated server.
- Self-election sketch: each node looks; if **no lookup server** is present, **one node takes the lookup job**.

**Managers stream into lookup (THOUGHT — owner 2026-07-18):**

```text
Manager(s) on fleet nodes  --stream advice/metrics-->  Lookup
Client  --"where for Mail?"-->  Lookup  --picks Node using streams-->  Client dials that Node
```

- Managers stay ordinary Resources (algorithm is yours); they **push** “which node should get work” (or the inputs for that) to the lookup.
- Lookup owns **client-facing placement**: membership/address **plus** load balancing fed by those streams.
- Clients talk to **lookup**, not to managers, for “which Node.”
- Many managers become OK: they are producers into one lookup view; uniqueness pressure moves to **lookup** (one dial target for “where”), which matches the self-elected single lookup sketch better than “exactly one manager.”

Unresolved under this sketch:

- Stream payload: ready-made `{ prefer: nodeKey }` vs raw metrics lookup aggregates.
- Stale/dead manager streams — timeout, remove weight, fall back to round-robin / any serve.
- Lookup failover (self-elect next) — in-memory LB state is lost unless replayed from manager streams.
- Whether lookup is built-in vs a special Resource; whether discovery registry and lookup are the same process.
- Compile-time: prove at most one lookup in a **local** graph; cross-runtime still runtime ads (“who is lookup”).

### `serve` → `expose` (OPEN / C5)

Owner asked: should we rename `serve` to something like `expose`?  
Prior LEAN was “separate pass, don’t block catalog.” Still **OPEN** — not locked. Catalog API sketches in this doc already say `expose` provisionally.

### Eng / bake process (owner)

- One idea at a time in bake; related questions OK when they share context.
- Prefer detailed options with context over bare question lists.
- Note discussions as thoughts; be careful what is actually locked.

---

## Bake sessions

Owner: lock API design in **bake sessions** — short owner↔agent passes; write **LOCKED** rows into this file + a careful `owner-decisions.md` entry only when truly locked; then Eng.

**In flight:** C1 (Tags + node sets) — thoughts captured; not locked.  
**Then:** C2–C5, then D1–D4 (discovery may absorb lookup rethink).  
**Optional later:** `stdio` / `worker` first-class; manager / lookup design once split is clear.

---

## Session log

- **2026-07-18** — Owner: Node `ROut` catalog, type-only imports to avoid bundling contracts, serve validates Node handle, discovery + UDS for seamless same-machine mesh; peers must be thought through; document ideas; “obviously the next step.” Clarified: shipped Node never had definition-time resource list — catalog is new. `import type` breaks Node→contract cycle only one way.
- **2026-07-18** — Owner: ignore Host history; make a plan/order; **Unix socket tested first** before complex catalog/discovery; many API decisions still to make. Eng order rewritten Phase 1 IPC → 2 catalog → 3 discovery → 4 docs; decisions split by what they block.
- **2026-07-18** — Owner: **build IPC**, then lock plan/API; bring back bake sessions. Phase 1 Eng shipped (`ipc` kind, `{ path }`, `ipcServer` / `connectIpc` / `protocolIpc` / `ipcClient`, tests). I1–I5 locked. Bake sessions noted for C*/D*.
- **2026-07-18 (bake)** — Owner: one idea at a time (related Qs OK). C1 discussion: Tags may carry node sets; class-extends-pipe pristine base; `nodes` overwrite + `andNode` add; reject agent’s “home” framing; multi-node nodeless already shipped via `distributed`. Placement / LB → manager sketches → owner: managers = Resources (`Resource.Manager` sketch), algorithm is yours not a fixed `leastWork`; no Protocol type param on Node; multi-manager compile limits across runtimes hurt; possible mix-up of **lookup/DNS** vs managers; self-electing lookup node so no mandatory separate DNS process; ask about `serve`→`expose`. Owner: **note as thoughts; careful what is locked.** Doc marks updated: C*/D* OPEN; only I1–I5 LOCKED.
- **2026-07-18 (bake)** — Owner THOUGHT: managers **stream** to the lookup which node should get work; lookup does load balancing for clients. Still not locked.
