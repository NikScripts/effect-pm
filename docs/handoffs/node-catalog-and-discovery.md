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
- Serve list lives on `httpServer` / `wsServer([...serve])`, **not** on the Node type.
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

- **`ROut`** = union of resource **handles** (service types), not a value bag of Tags at runtime unless we also materialize `serves: string[]` from the serve list.
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
  Resource.serve(Jobs, jobsImpl),
  Resource.serve(Emails, emailsImpl),
])
// Layer must provide Jobs | Emails (Worker’s ROut) — compile-time
```

Runtime `serves: ["app/Jobs", "app/Emails"]` should be **derived from the same serve list** so discovery can’t drift from `ROut`.

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

1. Each process: `listen(SelfNode, [serve…])` (+ publish to registry).  
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
| `listen(node, serveLayers[])` | Catalog mount; proves `ROut` (uses `serve` layers — C5) |
| `serve` / `serveRemote` | Core verbs (C5 LOCKED — no `expose`) |
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

**Out of Phase 1:** `ROut`, discovery, peersLayer changes, multi-protocol Node.

**Touches:** `ProtocolKind`, `makeNode` address parsing, `protocolForNode` / `connect*`, new `ipcServer` (or shared raw-socket server helper), tests. Coordinate with whoever owns `src/Resource.ts` node/client surface (Agent E reservation history).

### Phase 2 — Node catalog (`ROut`)

`Node<Self, ROut = never>` (names provisional), `listen` proves catalog, `clientsFor`, runtime `serves[]` from the serve list (C5: verb is `serve`). Tag↔Node is **C1 LOCKED**.

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

### Block Phase 2 (catalog)

| # | Decision | Status |
|---|----------|--------|
| **C1** | How Tags carry Nodes (set / bake / pipe / nodeless) | **LOCKED** (owner 2026-07-19) — see below |
| **C2** | `listen(node, serveLayers)` vs keep `httpServer`/`wsServer`/`ipcServer` as transport sugar | **LOCKED** — see below |
| **C3** | Partial catalogs (runtime subset of `ROut`)? | **LOCKED** — full `ROut` required |
| **C4** | Value-import Tags into node package allowed? | **LOCKED** — `import type` for `ROut` |
| **C5** | One name for the serve-list verb (`serve` / `expose` / …) | **LOCKED** — **`serve`** (see below) |

#### C2 — `listen` + keep `*Server` (**LOCKED** 2026-07-19)

| Decision | Lock |
|----------|------|
| Blessed catalog entry | **`Resource.listen(node, serveLayers)`** — proves `ROut`, then dispatches to `ipcServer` / `wsServer` / `httpServer` from `node.kind` |
| Transport servers | **Keep** `httpServer` / `wsServer` / `ipcServer` public (escape hatch; what `listen` calls) |
| Http / WebSocket bind | **Not** inferred from `node.url` alone — caller still provides `NodeHttpServer.layer` (bind ≠ dial). Ipc: `node.path` is bind+dial |
| Serve list | `Resource.serve` / engine `*.serve` layers only (C5) |
| Clients | **`Resource.clientsFor(node, …tags)`** — one bundled `connect`; tags must cover `ROut` |

**Eng (2026-07-19):** shipped — `Node<Self, ROut>`, `listen`, `clientsFor`; tests `resource-listen.test.ts` / `.test-d.ts`.

#### C3 — Full catalog (**LOCKED** 2026-07-19)

`listen` must provide **every** member of `ROut` (`ROut extends` merged serve `Layer.Success`). Partial omit is a type error. Optional features ⇒ different `ROut` / Node, not a hole. Extra serves beyond `ROut` allowed (wider Success).

Catalog `ROut` members must be **structurally distinct** types (different specs) — identical Tag shapes collapse in TypeScript, so C3 cannot prove a partial list.

#### C4 — `import type` for `ROut` (**LOCKED** 2026-07-19)

Prefer `import type` for contract handles in `Node<Self, ROut>`. Value-importing Tags into a node package is only for colocated packages — **not** when a Tag value-imports the Node (cycle). Cross-package Tag→Node stamps stay at the app composition root.

#### C5 — One name: `serve` (**LOCKED** 2026-07-19)

| Decision | Lock |
|----------|------|
| Blessed name | **`serve`** — `Resource.serve` / `QueueResource.serve` / `Process.serve` / … |
| Rejected | **`expose`** (alias or rename); inventing a third synonym |
| Why not `server` | Collides with transport `httpServer` / `wsServer` / `ipcServer` and Effect `RpcServer` |
| Why `serve` | Already the standards four-verb axis (`layer` / `serve` / `serveRemote` / `client`); list slots on `*Server` / future `listen` are those layers — one word, one job |
| Sibling | **`serveRemote`** stays (served-only) — different verb on the same axis, not a second name for `serve` |

**Eng:** none — keep shipped `serve`; scrub provisional `expose` from catalog sketches.

#### C1 — Tag Node sets (**LOCKED** 2026-07-19)

| Decision | Lock |
|----------|------|
| Model | **One set** on the handle (`nodesSym`). No privileged “home” Node. |
| `client(Tag)` | When set size is **exactly 1** (sync `nodeSym` to that Node). Size ≠ 1 → need `client(Tag, node)` or ambient Protocol. |
| API | `Resource.nodes([...])` **overwrites**; `Resource.andNode(node)` **appends one**. |
| Ctor sugar | `{ node: X }` ≡ `nodes([X])` (keep). |
| Alias | `distributedOf` ≡ `nodesOf`. **`distributed`** is the **discoverable** stamp only: bare `.pipe(Resource.distributed)` ≡ `nodes([])`. Fixed fleets use `Resource.nodes([…])` (list form is not on `distributed` — keeps `class extends … .pipe(Resource.distributed)` identity-shaped). |
| Identity | Multi-set **disabled** (`IdentityMultiNode`); overwrite to size ≤ 1 OK; `andNode` that would exceed 1 fails. |
| Dial-fail | Identity does **not** fall back across a node list (identity has no multi set). Multi-node try-next / LB = later bake. |
| Pipe | Mutate in place (same as today’s `distributed` / `withReadiness`). Copy-on-pipe deferred. |

**Eng:** shipped — `nodes` / `andNode` / `nodesOf`; `{ node }` set-of-one; bare `distributed` ≡ `nodes([])`; set-of-one syncs `nodeSym`. **D3:** empty stamped set ⇒ directory-backed `peersLayer`.

### Block Phase 3 (discovery / identity lookup)

| # | Decision | Status |
|---|----------|--------|
| **L1** | Tiered lookup bootstrap | **LOCKED** (owner 2026-07-18) — see below |
| **D1** | Registry: filesystem dir vs UDS bus vs parent-injected env | **Superseded in part by L1** — local default = well-known `IpcSocket` bind (OS exclusivity); cross-network = explicit `LookupNode` |
| **D2** | Discovery TTL / liveness | **LOCKED** (2026-07-19) — conflict ping = NodeStatus/`ping`; no v1 heartbeat tax |
| **D3** | `peersLayer` + empty / `distributed` membership | **LOCKED** (2026-07-19) — see below |
| **D4** | N instances of one Tag | **LOCKED** (2026-07-19) — opt-in `{ pick }` on `lookupClient`; see below |
| **D5** | Node directory vs `Identity.claim` | **LOCKED** (2026-07-19) — same Lookup server, separate advertise/list RPCs |
| **D6** | Duplicate `nodeKey` on advertise | **LOCKED** (2026-07-19) — default `livenessReplace`; unregister on clean close; `serves[]` from listen |
| **D7** | Prototypes / `NodeServer` / address-less Nodes | **LOCKED** (2026-07-19) — address-less + bootstrap + `lookupClient` + Prototype class `make`; see below |

#### L1 — Tiered lookup bootstrap (**LOCKED**)

| Topology | Policy |
|----------|--------|
| **Same machine** | Default OK — compete for a well-known local bind (`IpcSocket` path and/or localhost port). **OS bind exclusivity** resolves the race (`EADDRINUSE`); not gossip election. |
| **Across network** | **No self-elect.** Explicit `LookupNode` (address required). |

- Explicit required wherever local defaults are impossible (encode in layers/types as Eng progresses).
- Failover / re-elect = same race again — **not** in v1 scope; restart same slot / same explicit address; claimants re-claim on boot.
- Dial/claim failure when lookup unreachable: **needs more thought** — lean don’t serve Singleton by default; knobs later. **Not locked.**
- `LookupNode` constructor, nodeless clients, check-in map, manager LB streams — **Eng / further bake**; L1 only locks the tiered bootstrap rule.

#### Phase-3 bake — node directory, prototypes, handoff (2026-07-19)

> **LOCKED for Eng:** D2/D5/D6 (directory) + **D7 vertical** + **D3** + **D4** + **`Resource.Node.Prototype`**.  
> **Baking:** `askIncumbent` (see § below). Managers / X1 still OPEN.  
> App composition: **data-first** `Resource.listen(node, serves)` then `.pipe(Layer.provide…)` on Layers.

#### D3 — directory-backed peers (**LOCKED** 2026-07-19)

| Decision | Lock |
|----------|------|
| Bare stamp | `.pipe(Resource.distributed)` ≡ `nodes([])` — declares an **empty** Node set (discoverable). |
| List stamp | `Resource.nodes([A,B])` — fixed membership (**who**). |
| Undeclared | `nodesSym` absent → `peersLayer` keeps today’s empty static peers (not directory). |
| `peersLayer` empty set | Membership from Lookup **`Directory.nodesServing(tag.key)`** at layer build; exclude `self`; dial by entry `kind` (`IpcSocket`→path, else url + `peerProtocolRef`). |
| Directory absent | Soft empty peer map (same soft pattern as advertise) — provide `Lookup.client` / bootstrap for a real mesh. |
| Fixed set | Unchanged — `options.nodes` or non-empty stamped set; no directory read. |

**Two Lookup surfaces (do not conflate)**

| Surface | Status | Job |
|---------|--------|-----|
| **`Identity.claim`** | **Shipped** | First-wins exclusivity for a **resource key** (Tag `identity` / address-less Node keys). Loser policy today for Tags: client-of-winner. |
| **Node directory** (`advertise` / `unregister` / `nodesServing`) | **Eng (tip)** | Many rows: `{ nodeKey, kind, path\|url, serves[] }`. Fleets / dynamic prototypes / `peersLayer` membership. |

- **Same Lookup server process** as claim (one default ipc sock / dial-or-become). **Separate RPCs** — do not overload `claim` for fleets.
- v1 Lookup **default** remains **ipc only** (local http fleets: fixed `nodes` or explicit `LookupNode`).
- Directory **`serves[]`**: **derived** from the serve layers passed to `listen` / `NodeServer` (not a second hand list).
- **Unregister** directory row on clean `listen` scope close (if advertised). Crashes: stale row until conflict + liveness or Lookup restart.

**First-wins — what’s figured**

| Race | Figured? |
|------|----------|
| Who hosts Lookup | **Yes (L1)** — OS bind |
| Who owns identity key `K` | **Yes (shipped claim map)** |
| Who may advertise fleet `nodeKey`s | **Not claim** — many winners for dynamic `#suffix`; named keys use dupe policy below |

**Duplicate `nodeKey` on advertise**

| Preset | v1 |
|--------|-----|
| **`livenessReplace`** (default) | **SHIPPED** — ping incumbent via **NodeStatus.ping**; timeout/fail ⇒ replace row; alive ⇒ `IncumbentAlive` |
| **`askIncumbent`** | **LEAN / baking** — opt-in; ask live incumbent to yield before reject (see § askIncumbent) |
| **`reject`** | Strict never-steal (dead still replaceable? OPEN) |
| **`lastWins`** (orphan first) | **Not** the default |

#### `askIncumbent` advertise policy (**OPEN** — bake 2026-07-19)

**Shipped today (fact):**

```ts
// Same nodeKey + different dial target:
//   ping incumbent → alive → IncumbentAlive (layer/advertise fails)
//                 → dead/unreachable → replace directory row
Lookup.directoryAdvertiseLayer(node, serves) // always livenessReplace
```

**Gap:** rolling restart / takeover of a **named** Node (`Worker` / `Proto.make("East", …)`) while the old process is still up — today the newcomer is hard-rejected until the old process dies or unregisters.

**Not this bake:** manager LB streams; queue/work drain across processes; changing default away from `livenessReplace`.

##### Job (lean)

When policy is `askIncumbent` and the incumbent is **alive**, Lookup **asks it to yield** (cooperative). If it yields (unregisters / accepts), newcomer’s advertise succeeds. If it refuses or times out → same as today: `IncumbentAlive`. Dead incumbent still replaced (same as livenessReplace).

##### Surface options

**A — Policy on advertise / listen (LEAN)**

```ts
// listen opts (or AdvertiseRequest field) — default stays livenessReplace
Resource.listen(East, [Resource.serve(Mail, impl)], {
  onConflict: "askIncumbent", // | "livenessReplace" | "reject"
})

// Lookup.advertise path mirrors the same tag when callers advertise by hand
```

**B — Lookup server global default (sketch)**

```ts
Lookup.layer(node, { onConflict: "askIncumbent" })
```

Forces one policy for all advertisers — less flexible for mixed fleets.

**C — Park (sketch)**

Keep only `livenessReplace` until managers own handoff. Named-Node rolling restart = kill old first / wait for unregister.

**Agent lean: A** — opt-in at the advertise/listen site; default unchanged.

##### Yield mechanism (after A)

| # | Question | Lean |
|---|----------|------|
| AI.1 | Surface = A / B / C? | **A** |
| AI.2 | Who dials the ask? | **Lookup server** (has incumbent endpoint; newcomer shouldn’t need to) |
| AI.3 | RPC | Add **`NodeStatus.yield`** (or `askYield`) — reserved resource every node already serves |
| AI.4 | Yield meaning v1 | Cooperative: incumbent **unregisters** its directory row (and may interrupt listen scope). **No** in-flight work drain |
| AI.5 | Refuse / timeout | → **`IncumbentAlive`** (fail-closed; no steal) |
| AI.6 | `reject` preset | Alive → always `IncumbentAlive`; dead → still replace (same liveness probe) — or strict never-replace? lean: dead still replace |

```ts
// Goal sketch after lock:
// NodeStatus gains:
yield: Resource.effect(Schema.Boolean) // true = accepted yield

// Lookup advertise when onConflict: "askIncumbent":
//   same dial → refresh serves (unchanged)
//   different dial + dead → replace
//   different dial + alive → client(NodeStatus).yield on incumbent
//     true → set newcomer row
//     false / timeout / error → IncumbentAlive
```

**Node kinds (D7 + dynamic instance — LOCKED)**

| Kind | Address | Multiplicity | Lookup |
|------|---------|--------------|--------|
| Concrete `Node(key, addr)` | In source | One binder per address | Not required for dial |
| Address-less **non-prototype** `Node(key)` | Minted at `listen` (ipc) | **One** per `Node.key` — **`claim`**; lose → fail Layer | Required |
| **Prototype** | None on proto | Template: catalog `ROut` | n/a until cloned |
| **Named clone** `class X extends Proto.make(name, addr) {}` | **Required** 2nd arg | One per name+address; wire key `prototypeKey#name` | Optional for dial |
| **Dynamic instance** `Proto.instance(suffix?)` | Minted at `listen` (ipc) | **Many** `prototypeKey#suffix` — **no claim**; advertise only | Directory for mesh / peers |

```ts
class MailWorker extends Resource.Node.Prototype<MailWorker, Mail>("app/MailWorker") {}
class East extends MailWorker.make("East", { path: "/tmp/east.sock" }) {}

// Dynamic — curry serves once; factory takes suffix (auto when omitted)
const mailWorker = MailWorker.listen([Resource.serve(Mail, impl)])
mailWorker().pipe(Layer.provide(Lookup.bootstrapDefaultLocal()))
mailWorker("w1").pipe(Layer.provide(Lookup.bootstrapDefaultLocal()))

class Worker extends Resource.Node<Worker, Mail>("app/Worker") {} // address-less (claim)
Resource.listen(Worker, [Resource.serve(Mail, impl)]).pipe(
  Layer.provide(Lookup.bootstrapDefaultLocal()),
)
Resource.lookupClient(Mail).pipe(Layer.provide(Lookup.bootstrapDefaultLocal()))
```

#### Dynamic `Node.Prototype.instance` (**LOCKED** 2026-07-19)

| Decision | Lock |
|----------|------|
| Nesting | Prototype is a **Node kind** — `Resource.Node.Prototype` (not a top-level `Resource.Prototype`). |
| API | `Proto.instance()` / `Proto.instance(suffix)` on a `Node.Prototype` — returns a Node value for `listen` (not a class ctor; unlike `make`). |
| Wire key | `prototypeKey#suffix`. Omitted suffix → minted at `listen` (`<millis>-<seq>`). |
| Address | Always ephemeral ipc path at `listen` (no address arg — fixed addresses stay on `make`). |
| Claim | **None** — many instances may run; directory `livenessReplace` still applies on duplicate `nodeKey`. |
| Catalog | Same `ROut` brand as the Prototype. |
| Clients | `lookupClient` stays fail-closed on 0/>1; multi-instance discovery → `peersLayer` + bare `distributed` / explicit Node (D4 OPEN). |
| Spawn ergonomics | **`Proto.listen(serves) → (suffix?) => Layer`** — curry serve list; sugar over `Resource.listen(instance(suffix), serves)`. Returns **Layer only** (`ListenNode` in built context). Keep **`instance()`** public. Named clones stay `Resource.listen(East, serves)` — no `East.listen`. |

#### `Prototype.listen` factory (**LOCKED** 2026-07-19)

| Decision | Lock |
|----------|------|
| API | `MailWorker.listen([serve…])` → `(suffix?: string) => Layer` |
| Semantics | Same as `Resource.listen(MailWorker.instance(suffix), serves)` — ephemeral ipc, `#suffix`, no claim, advertise |
| Return | **Layer only** — after `Layer.build`, instance Node is {@link ListenNode} in context |
| `instance()` | Stays **public** (peers `self`, escape hatch) |
| Named clones | Unchanged — `Resource.listen(East, serves)`; no per-clone `.listen` |

```ts
const mailWorker = MailWorker.listen([Resource.serve(Mail, impl)])
mailWorker()
mailWorker("w2")
```

#### `lookupClient` naming (**LOCKED** 2026-07-19)

| Decision | Lock |
|----------|------|
| Job | Nodeless client: **Lookup** picks the dial target (Identity resolve → directory `nodesServing`). |
| vs `client(Tag, node)` | Explicit Node — caller names where to dial. |
| Fail-closed | 0 or &gt;1 directory rows → `LookupClientError` — **no** silent multi-replica pick. |
| Name | Shipped **`Resource.lookupClient`**. Bake sketch `unsafeLookupClient` (“trust Lookup or die”) is the **same** contract — keep the non-`unsafe` name; TSDoc/handoff must say so. |
| Not D4 | Soft pick when N&gt;1 is a **separate** OPEN bake (not this API). |

- Identity: **no `{ self }`** — bound Node on Tag and/or listen Node.
- `NodeServer<N>` type alias — LEAN name OK; serve-list typing already via `listen` C3.
- Fleet fields ⇒ `distributed` / `nodes` before mesh APIs. Empty stamped set ⇒ directory (**D3 LOCKED**).
- `client(Tag)` stays **set-of-one** until D4 locks otherwise.

**Eng:** directory + D7 + D3 + `Node.Prototype` (`.make` / `.instance` / `.listen`) on tip.

#### D4 — soft pick when N>1 (**LOCKED** 2026-07-19)

| Decision | Lock |
|----------|------|
| Surface | Opt-in on **`lookupClient(Tag, { pick })`** — bare stays fail-closed. No separate `lookupClientAny`. |
| Built-ins | `"first"` + sync custom `(rows) => DirectoryEntry`. No `"random"` / Effect picker in v1. |
| Identity | Resolve hit → dial winner; **`pick` ignored**. |
| 0 / 1 row | Unchanged — missing error / dial sole row (`pick` unused when 1). |
| N>1, no pick | `LookupClientError({ reason: "ambiguous" })`. |
| `client(Tag)` | Stays **set-of-one**; multi-instance = lookup+pick / explicit Node / peers. |
| Out | Sticky affinity; manager/LB streams (later). |

```ts
Resource.lookupClient(Mail) // fail-closed
Resource.lookupClient(Mail, { pick: "first" })
Resource.lookupClient(Mail, {
  pick: (rows) => rows.find((r) => r.nodeKey.endsWith("#w2")) ?? rows[0]!,
})
```

### Cross-cutting — **OPEN** / parked

| # | Decision | Status |
|---|----------|--------|
| **X1** | Multi-protocol Node (endpoint set) | **OPEN** — later; one kind per Node until discovery exists |
| **X2** | Product rename away from “Resource” | **Parked** |
| **X3** | Docs: handoff-only vs draft guide now | Handoff SSOT now |
| **X4** | `Protocol` as Node **type param** | **Rejected as idea** (owner): value-level `kind` + address is SSOT — typing protocol twice drifts. Not a formal bake-row lock; do not re-propose. |
| **X5** | Protocol kind strings → `_tag`-style names | **LOCKED** — `"Http" \| "WebSocket" \| "IpcSocket"` (multi-protocol Node still later / X1) |
| **S1** | Identity-claiming Resources (was “Singleton”) | **LOCKED** (owner: “good enough for now”) — see below |

#### S1 — Identity pipe (**LOCKED** 2026-07-18)

| Decision | Lock |
|----------|------|
| Surface | **`Resource.identity` pipe** on any Resource / Process / Queue Tag (same pattern as `withReadiness` / `distributed`). Optional `Resource.Singleton` sugar = Tag+pipe only — not required. |
| Name | Blessed: **`identity`**. (“singleton” avoided as primary — overloaded.) |
| Where stamped | **On the handle**, not layer-only. |
| Layer / serve | **`Resource.layer` / `serve` / `*Server` honor the stamp** — claim then local serve **or** client-of-winner. No separate `singletonLayer` as main API. |
| Self address | Dialable **bound Node** on Tag (`nodes` / `{ node }`) and/or **listen Node** (incl. minted address-less). **No `{ self }` bag.** |
| Lookup down | **Fail-closed** — do not serve locally; orphan-serve opt-in later if ever. |
| Node set | At most **one** Node on an identity handle; overwrite OK; **`andNode` disabled**. |

**Eng:** shipped — `Resource.identity` pipe; `layer` / `serve` claim then local or client-of-winner.

### Protocol tags (X5 — **LOCKED** 2026-07-18)

Owner: descriptive tags; follow Effect layers as best we can; **`IpcSocket`** for UDS; **`WebSocket`** spelling (not Effect’s `Websocket`).

```ts
export type ProtocolKind = "Http" | "WebSocket" | "IpcSocket";
```

Inference unchanged: `{ path }` → `IpcSocket`, `ws(s)://` → `WebSocket`, other url/port → `Http`.  
Multi-protocol Node (endpoint set / `_tag` ADT) remains **X1 later** — not this rename.

---

## Bake thoughts (2026-07-18) — Tags, managers, lookup

> Everything below is **THOUGHT** / plan sketch unless marked otherwise.  
> **Actually LOCKED in this program so far:** Phase 1 **I1–I5**, **L1**, **X5**, **S1** (see tables above).

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

**Owner lean (2026-07-19, not locked):** **Option B** — one set on the handle; `client(Tag)` when set size is 1. Confirmed: `nodes`/`distributed` multi-set **disabled** on identity (already `IdentityMultiNode`). Open: identity dial-fail → try other nodes? (agent note: identity handles have no multi set — failover belongs to multi-node `client(Tag)` / nodeless+lookup, not identity+fleet). API lean: `nodes([...])` overwrite; `andNode(Node)` add-one (prefer over `nodes([x])` when appending a single).

### Single-connect over a multi-node set (THOUGHT)

Gap: `distributed` + peers/ShardMap answer folds and sticky keys; nothing answers “ordinary `client(Tag)`, pick **one** replica.”

Early sketches (client-side random / RR / balancedClient) are **THOUGHTS only**. Owner pushed further: placement should be able to use **fleet-aware logic inside the mesh**, not only dumb client pick.

### Lookup as identity server + singletons (THOUGHT — active)

Owner direction consolidating (still **not locked**):

Lookup is not only “DNS for addresses” — it can be the **identity server**: register resource instances by **key**, reject duplicates, point losers at the winner.

```text
Process starts Resource with key K on Node A
  → claims at Lookup: "I am K at A"
  → first claim wins; Lookup records { key: K, node: A, address }

Later process starts same key K on Node B
  → Lookup: Duplicate { key: K, original: A (address) }
  → B's layer **swaps** to a **client** of the original (A)
```

**Who is the lookup node (THOUGHT — expanded 2026-07-18):**

Owner push: maybe `Resource.LookupNode` (own constructor). Address-less / “nodeless” clients check in with lookup only; serving Nodes register into a map; managers stream LB data into that map. Defaults only where protocol/topology allows (localhost port / well-known `IpcSocket`); **explicit required where defaults are impossible** (cross-network).

##### Split brain — safest race handling (agent analysis, not locked)

Cross-network “two processes both elect” cannot be solved by politeness — without a shared exclusivity primitive you get two lookups. Safest policy is **tiered**:

| Topology | Elect / default? | Exclusivity |
|----------|------------------|-------------|
| **Same machine** (`IpcSocket` well-known path, or localhost port bind) | Default OK | **OS bind wins** — second `listen`/`bind` fails (`EADDRINUSE`). That *is* the race resolver; no gossip election. Stale sock file: reuse Phase-1 unlink-before-bind carefully so unlink→bind stays one critical section per process; still only one binder succeeds. |
| **Across network** | **No self-elect** | **Explicit LookupNode address required.** Two remote electors = split brain by definition unless we take on consensus (out of scope / Cluster-shaped). |

Detecting “two lookups both reachable” (misconfig: two explicit addresses, or local default + a second manual lookup) is a **verify/warn** problem, not something elect can fix. Clients should use one configured/default dial target.

**Failover:** re-electing after lookup death **reopens the same race** (and drops in-memory identity/LB until re-claim). Possible later; v1 lean = lookup restart is ops (same bind slot / same explicit address); Singletons re-claim on boot. Don’t pretend seamless leader failover without owning the race.

##### Bootstrap + “explicit when defaults impossible” (owner ask: can we?)

**Yes.** Encode as layers/types roughly:

- `Lookup.layerDefaultLocal` (name sketch) — only legal for local defaults (`IpcSocket` path and/or `127.0.0.1:port`); implements bind-exclusive serve **or** dial that slot.
- `LookupNode("…", { url | path })` / `Resource.LookupNode` — **address required** for non-default topologies.
- Starting a graph that needs lookup with **neither** a local default applicable **nor** an explicit LookupNode → **compile or layer-build error**, not silent elect across the LAN.

Protocol matters: http localhost port and `IpcSocket` path are defaultable; arbitrary remote http/ws is not.

##### Dial / claim failure when lookup unreachable (owner: needs more thought)

Sketch on the table (not locked):

- **Default:** do **not** serve the Singleton locally if claim can’t complete (avoid silent double-serve).
- **Config:** opt into “run locally anyway” and/or “error hard” — exact matrix still open.
- “Run locally by default” is the dangerous one if two partitions each serve K.

##### `LookupNode` + address-less / nodeless clients (owner)

```text
LookupNode (explicit or default-local bind)
  ↑ check-in / register          ↑ claim Singleton keys
Serving Nodes (may be address-less until advertised?)
  → lookup builds map: nodeKey → address, serves[], …
Managers (singletons?) stream LB advice into lookup
Nodeless client
  → only knows Lookup (default or explicit)
  → asks for nodes/addresses for resources it uses
  → dials winners
```

- **Address-less Nodes** (prior night): a Node need not bake a stable client-facing address at definition if lookup is how others find it — it checks in with address at runtime.
- **Nodeless client** (name TBD): no Node stamp on Tags; dependency is **Lookup** (+ defaults for local). This is the blessed same-machine story if default `IpcSocket`/localhost lookup exists.
- Replaces much of “stamp distributed on every Tag” for discovery-shaped apps; static `distributed` remains for fixed fleets / no lookup.

**Layer swap (THOUGHT):** yes, in principle — a serve/local layer that fails identity claim becomes `client(Tag, originalNode)` (or equivalent) so the process still `yield* Tag` against the winner. Needs Eng design: claim at layer build / scope init; typed error carrying original address; no silent double-serve.

**Identity-claiming Resources (THOUGHT — evolving):**

- Not only a separate `Resource.Singleton` ctor — prefer **`Resource.<pipe>` on any Resource/Process/Queue Tag** (like `withReadiness` / `distributed`), so identity applies to the whole toolkit surface.
- Optional `Resource.Singleton` sugar can remain as Tag+pipe if useful; not required.
- Name: “singleton” is overloaded — candidates `identity` / `unique` / `exclusive` (see bake recommendations below).
- If dupe at claim → layer becomes **client** of winner.
- Build/test identity-claim path **before** managers (managers may collapse into the same mechanism).

**Identity × node set (THOUGHT — owner):** Identity-stamped handles are **one Node at a time**. `Resource.nodes` (or equivalent) may **override** that single Node; **`andNode` is disabled** (compile and/or runtime). Multi-node fleets stay on ordinary Tags + `distributed` / `nodes` / `andNode`.

**Dedupe key (THOUGHT — owner):** dedupe by **resource key** only. Do **not** dedupe by “what you manage.” Multiple different manager Resources for the same fleet resource can coexist if they have **different keys**.

### Managers vs singletons (THOUGHT — collapsing?)

Earlier manager sketches:

- Managers are Resources; dev chooses which Nodes **expose** them.
- Lookup catches **duplicate managers**: first wins; duplicate gets error + address of original (same as singleton identity).
- Manager constructor sketch: require a **single Node** + the **resources (plural)** it manages.
- Managers may **stream** placement advice into lookup for client-facing LB.

Owner rethink: maybe **singletons and managers are the same thing** — identity-by-key at lookup. “Manager” might just be a singleton that *happens* to coordinate other resources (and maybe streams advice). Claiming ownership of other resources in the type/constructor may be unnecessary if we don’t dedupe on that axis.

| Idea | Status |
|------|--------|
| Identity / Singleton first | THOUGHT — preferred Eng order if this lands |
| Manager = Singleton + “manages[]” metadata | THOUGHT — maybe drop manages[] for dedupe |
| Manager streams → lookup LB | THOUGHT — optional later |
| `Node<…, Managing>` facet | Cooling — identity-by-key may replace it |

**Do we need value-level “resources it manages”? (THOUGHT — owner ask):**

- **Identity / dedupe:** no — by **key** only. Losers become clients of the winner for that key.
- **Constructor args:** a value list of managed Tags is **not required** for that. It would force value imports and package edges we were trying to avoid with `import type` on Node catalogs.
- **Type info is enough** for the interesting compile story: e.g. `Singleton` / manager typed with the `R`s it coordinates (`Manager<Self, Mail | Jobs>` or similar). Impl / layer build can **optionally** enforce (must have peers/clients for those `R`s) the same way `listen` may prove `ROut` — when we want that check, not because identity needs it.
- **Runtime advertisement** of “I advise on Mail” (for lookup LB streams) can come from what you **register/stream**, or from a type-driven serve helper — still not a mandatory ctor bag of Tag values.

Lean (agent, not lock): ctor = identity key (+ optional Node / lookup wiring); managed `R`s = **type params** (+ optional enforce at impl). Drop required value-level manages list unless a later Eng need appears.

**Do not Eng managers/singletons/lookup yet** — bake until the collapse (or split) is locked.

### `serve` naming (C5 — **LOCKED**)

One name: **`serve`**. No `expose`, no alias. Transport stays `httpServer` / `wsServer` / `ipcServer` (different axis). See C5 table above.

### Eng / bake process (owner)

- One idea at a time in bake; related questions OK when they share context.
- Prefer detailed options with context over bare question lists.
- Note discussions as thoughts; be careful what is actually locked.

---

## Bake sessions

Owner: lock API design in **bake sessions** — short owner↔agent passes; write **LOCKED** rows into this file + a careful `owner-decisions.md` entry only when truly locked; then Eng.

**In flight:** C1 (Tags + node sets) — thoughts captured; not locked.  
**Then:** C2–C5; discovery / **identity lookup** / Singleton (D* may widen).  
**Suggested Eng order if identity lands (THOUGHT only):** identity lookup + Singleton (claim / dupe→client) **before** any Manager sugar — Manager may collapse into Singleton.  
**Optional later:** `stdio` / `worker` first-class; manager streams for LB.

---

## Session log

- **2026-07-18** — Owner: Node `ROut` catalog, type-only imports to avoid bundling contracts, serve validates Node handle, discovery + UDS for seamless same-machine mesh; peers must be thought through; document ideas; “obviously the next step.” Clarified: shipped Node never had definition-time resource list — catalog is new. `import type` breaks Node→contract cycle only one way.
- **2026-07-18** — Owner: ignore Host history; make a plan/order; **Unix socket tested first** before complex catalog/discovery; many API decisions still to make. Eng order rewritten Phase 1 IPC → 2 catalog → 3 discovery → 4 docs; decisions split by what they block.
- **2026-07-18** — Owner: **build IPC**, then lock plan/API; bring back bake sessions. Phase 1 Eng shipped (`ipc` kind, `{ path }`, `ipcServer` / `connectIpc` / `protocolIpc` / `ipcClient`, tests). I1–I5 locked. Bake sessions noted for C*/D*.
- **2026-07-18 (bake)** — Owner: one idea at a time (related Qs OK). C1 discussion: Tags may carry node sets; class-extends-pipe pristine base; `nodes` overwrite + `andNode` add; reject agent’s “home” framing; multi-node nodeless already shipped via `distributed`. Placement / LB → manager sketches → owner: managers = Resources (`Resource.Manager` sketch), algorithm is yours not a fixed `leastWork`; no Protocol type param on Node; multi-manager compile limits across runtimes hurt; possible mix-up of **lookup/DNS** vs managers; self-electing lookup node so no mandatory separate DNS process; ask about `serve`→`expose`. Owner: **note as thoughts; careful what is locked.** Doc marks updated: C*/D* OPEN; only I1–I5 LOCKED.
- **2026-07-18 (bake)** — Owner THOUGHT: managers **stream** to the lookup which node should get work; lookup does load balancing for clients. Still not locked.
- **2026-07-18 (bake)** — Owner THOUGHTS: lookup catches duplicate managers (first wins, error + original address); Manager ctor = single node + resources it manages; Node ctor `lookup` param (self or point at lookup node); layer swap dupe→client for original; generalize lookup as **identity server**; `Resource.Singleton` first (build/test before managers); maybe Singleton ≡ Manager; **dedupe by key only** (not by what you manage — multiple manager kinds OK). Still not locked.
- **2026-07-18 (bake)** — Owner ask: need value-level “resources it manages”, or type info only? THOUGHT lean: **types (+ optional impl enforce)**; identity stays key-only; no mandatory ctor Tag list. Still not locked.
- **2026-07-18 (bake)** — Owner: prefer `_tag`-style protocol names (e.g. `"WebSocket"`); follow Effect layer names as best we can; noted nobody types `ProtocolKind` out. X5 thought added — not locked / not Eng’d.
- **2026-07-18 (bake)** — Owner: UDS tag **`IpcSocket`** for clarity; Singleton: **`andNode` disabled**, override OK but **only one Node** at a time. Still not formal LOCKED rows / not Eng’d.
- **2026-07-18 (bake)** — Lookup race/bootstrap: owner asks safest split-brain handling; explicit required where defaults impossible; failover = race again; dial-fail serve policy needs thought; `LookupNode` ctor; address-less nodes check in; nodeless clients only need lookup (+ local defaults). Agent note: same-machine = OS bind exclusivity; cross-network = no elect. Still not locked.
- **2026-07-18** — Owner: “Let’s go.” **L1 LOCKED** (tiered bootstrap). Eng slice 1: `src/Lookup.ts` — LookupNode, layerDefaultLocal / layerIpc, Identity claim/resolve, DuplicateIdentity. Singleton swap / nodeless / managers still open.
- **2026-07-18** — Owner: fix kind strings; multi-protocol later. **X5 LOCKED + Eng:** `"Http" | "WebSocket" | "IpcSocket"`.
- **2026-07-18 (bake)** — Owner: don’t need `Resource.Singleton` ctor — pipe on any resource/process constructor; maybe better name; ask layer vs handle (footgun if layer-only). Agent lean; owner “good enough for now.” **S1 LOCKED.**
- **2026-07-18** — **S1 Eng shipped:** `Resource.identity` pipe; `layer`/`serve` claim→local-or-client; `IdentitySelfRequired` / `IdentityMultiNode`; tests over ipc Lookup. Next bake: **C1**.
- **2026-07-19 (bake)** — Owner lean B; questions on distributed purpose, identity failover, `andNode`; **“Locked.” C1 LOCKED** (one set, nodes/andNode, client set-of-one, no identity→fleet failover).
- **2026-07-19** — **C1 Eng shipped:** `Resource.nodes` / `andNode` / `nodesOf`; `{ node }` ≡ set-of-one; `distributed` alias; identity multi still `IdentityMultiNode`.
- **2026-07-19 (bake)** — Owner: one name for serve/expose/server — choose well. **C5 LOCKED:** keep **`serve`**; reject `expose` and verb-`server`.
- **2026-07-19 (bake)** — Owner: “Continue.” **C2/C3/C4 LOCKED** — `listen`+keep `*Server`; full `ROut`; `import type` for `ROut`. Eng next.
- **2026-07-19** — **C2–C4 Eng shipped:** `Node<Self, ROut>`, `Resource.listen`, `Resource.clientsFor`; ipc runtime + type tests.
- **2026-07-19 (bake)** — Phase-3 discovery/prototype/directory leans (owner agreed): same Lookup server + separate advertise RPCs; `livenessReplace` + NodeStatus ping; unregister on close; `serves[]` from listen; Prototype / `make(name,addr)` / `NodeServer<N>`; bare `distributed` ≡ `nodes([])`. Written as **LEAN** (not Eng’d). See Phase-3 bake section.
- **2026-07-19** — Owner “Okay” → **D3 LOCKED + Eng:** bare `Resource.distributed` ≡ `nodes([])`; empty stamped set → `peersLayer` reads `Directory.nodesServing`; fixed `nodes([…])` unchanged.
- **2026-07-19** — Owner “Continue” → **dynamic `Node.Prototype.instance` LOCKED + Eng:** ephemeral ipc + `#suffix`, no claim; `askIncumbent` / D4 still later.
- **2026-07-19** — Owner: Prototype must nest as `Resource.Node.Prototype` (not top-level). Rename Eng’d; top-level removed.
- **2026-07-19** — Owner: bake sketch `unsafeLookupClient` = shipped `lookupClient` (fail-closed); keep name without `unsafe` if docs are clear. Locked in handoff + TSDoc. D4 soft pick still separate/OPEN.
- **2026-07-19** — Owner “Good” → **`Prototype.listen(serves) → (suffix?) => Layer` LOCKED:** Layer-only return; keep `instance()`; no named-clone `.listen`.
- **2026-07-19** — Owner “Next” → **D4 bake opened** (soft pick when N>1). Lean **A:** opt-in `{ pick }` on `lookupClient`; bare stays fail-closed.
- **2026-07-19** — Owner “Good” → **D4 LOCKED:** `lookupClient(Tag, { pick: "first" \| fn })`; bare fail-closed; identity ignores pick; `client(Tag)` set-of-one unchanged.
- **2026-07-19** — Owner “Okay next” → **`askIncumbent` bake opened.** Lean **A:** `onConflict` on listen/advertise; Lookup asks `NodeStatus.yield`; timeout → `IncumbentAlive`. Awaiting owner lock.
