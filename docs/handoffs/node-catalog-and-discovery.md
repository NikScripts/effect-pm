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

## Open questions (don’t Eng until locked)

1. **Blessed default:** Tags nodeless + Node-first clients/discovery — yes/no?  
2. **`listen` vs keeping `httpServer`/`wsServer`:** sugar over transport, or replace?  
3. **Registry format** for same-machine: directory of JSON files vs length-prefixed UDS bus vs parent-injected?  
4. **Partial catalogs:** may a process expose a runtime subset of `ROut`? (lean: no — `ROut` = promise)  
5. **N instances of one Tag:** discovery gives Nodes; `client(Tag, whichNode)` still required for instance identity  
6. **Serve-family rename** (`expose` / `gateway`) — same program or separate?  
7. **Docs home:** living guide chapter vs handoff-only until Eng?

---

## Suggested Eng slices (when unlocked)

1. **Design lock** — this file + owner answers to open questions.  
2. **`Node<Self, ROut>` + `listen` prove** — types + tests; no discovery yet.  
3. **`clientsFor`** — static catalog clients.  
4. **IPC protocol kind** — UDS listen/connect helpers.  
5. **Local discovery** — registry + `peersLayer` discovery mode.  
6. **Docs** — Managing Layers / Fleets & Peers rewrite; examples (two processes, one machine, zero Tag `{ node }`).

---

## Session log

- **2026-07-18** — Owner: Node `ROut` catalog, type-only imports to avoid bundling contracts, serve validates Node handle, discovery + UDS for seamless same-machine mesh; peers must be thought through; document ideas; “obviously the next step.” Clarified: shipped Node never had definition-time resource list — catalog is new. `import type` breaks Node→contract cycle only one way.
