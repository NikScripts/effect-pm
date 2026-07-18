# Design: Node catalog (`ROut`) + same-machine discovery

**Status:** **DESIGN** — owner direction 2026-07-18 (chat). Not Eng-unlocked.  
**Thesis:** Make cross-runtime **seamless, easier, safer** — Node-first address + typed service catalog; optional discovery so same-machine (esp. Unix sockets) peers don’t need Node stamped on every Tag.  
**Related:** [`transport-dependency-decisions.md`](./transport-dependency-decisions.md) · [`loud-failures-design.md`](./loud-failures-design.md) · [`docs/resources/fleets-and-peers.md`](../resources/fleets-and-peers.md)  
**Naming note:** This doc still says “Resource” for the shipped module. Product rename (e.g. Unbounded services) is **parked** — don’t block this design on it.

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
| Contracts → Node | **Avoid by default** — Tags stay nodeless |
| Still allowed | `{ node: Worker }` / `Tag.pipe(onNode(Worker))` / `client(Tag, Worker)` when you want Tag→Node |

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

`Node<Self, ROut = never>`, `listen` proves catalog, `clientsFor`, runtime `serves[]` from expose list. Tags nodeless-by-default only if Phase-0 lock says so.

### Phase 3 — Discovery + peers

Local registry, discover → connect → clients from `serves[]`, `peersLayer` accepts static **or** discovered topology. Pays off Phase 1 IPC.

### Phase 4 — Docs / rename hygiene

Managing Layers + Fleets & Peers; optional serve-family neutral names if locked.

---

## API decisions (lock by phase)

### Block Phase 1 (IPC) — lock these first

| # | Decision | Lean |
|---|----------|------|
| **I1** | Kind name: `"ipc"` vs reuse `"socket"` for raw UDS (keep `"socket"` = WebSocket only) | **`"ipc"`** — don’t overload browser WS |
| **I2** | Address shape on Node: `{ path }`, bare path string, or `unix:///…` url | **`{ path }`** (+ maybe bare string ending in `.sock`) |
| **I3** | Server helper name: `ipcServer` vs `unixServer` vs one `socketServer` for TCP+UDS | **`ipcServer`** — same-machine story; TCP localhost can wait |
| **I4** | Path lifecycle: auto-`unlink` before bind / on scope close? | **unlink on scope close + best-effort before bind** (document stale-file) |
| **I5** | Windows: named pipes now or Unix-only v1? | **Unix-only v1**; Windows follow-up |

### Block Phase 2 (catalog) — can wait until IPC is green

| # | Decision | Lean |
|---|----------|------|
| **C1** | Blessed default: Tags nodeless + Node-first? | **Yes** |
| **C2** | `listen(node, exposes)` vs keep `httpServer`/`wsServer`/`ipcServer` as transport sugar that *optionally* takes a catalog Node | **Keep transport servers; `listen` = catalog-aware wrap** |
| **C3** | Partial catalogs (runtime subset of `ROut`)? | **No** — `ROut` is a promise |
| **C4** | Value-import Tags into node package allowed? | **Yes as option; `import type` preferred** |
| **C5** | Serve-family rename (`expose` / `gateway`) in same program as catalog? | **Separate** — don’t block catalog on rename |

### Block Phase 3 (discovery) — after catalog shape exists

| # | Decision | Lean |
|---|----------|------|
| **D1** | Registry: filesystem dir vs UDS bus vs parent-injected env | **Filesystem dir** under runtime state (simplest, Effect `FileSystem`) |
| **D2** | Discovery TTL / liveness: sock exists vs heartbeat file vs RPC ping | **RPC ping / verify** once connected; registry file = claim |
| **D3** | `peersLayer`: discovery opt-in vs replace static `distributed` | **Opt-in** — static remains for fixed fleets / ShardMap v1 |
| **D4** | N instances of one Tag | **Still `client(Tag, node)`** — discovery doesn’t erase instance identity |

### Cross-cutting (schedule anytime, don’t block Phase 1)

| # | Decision | Lean |
|---|----------|------|
| **X1** | Multi-protocol Node (endpoint set) | **Later** — one kind per Node until discovery exists |
| **X2** | Product rename away from “Resource” | **Parked** |
| **X3** | Docs: handoff-only until Eng ships vs draft guide now | **Handoff SSOT now; guide when Phase 1–2 land** |

---

## Open questions (legacy list — superseded by phase table above)

Still open until owner ticks Phase-0 rows. Priority: **I1–I5**, then Eng Phase 1.

---

## Session log

- **2026-07-18** — Owner: Node `ROut` catalog, type-only imports to avoid bundling contracts, serve validates Node handle, discovery + UDS for seamless same-machine mesh; peers must be thought through; document ideas; “obviously the next step.” Clarified: shipped Node never had definition-time resource list — catalog is new. `import type` breaks Node→contract cycle only one way.
- **2026-07-18** — Owner: ignore Host history; make a plan/order; **Unix socket tested first** before complex catalog/discovery; many API decisions still to make. Eng order rewritten Phase 1 IPC → 2 catalog → 3 discovery → 4 docs; decisions split by what they block.
