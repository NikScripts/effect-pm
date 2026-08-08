# Node addresses + update API — design notes

**Status:** **Design only** (owner 2026-08-07 → 2026-08-08). Not locked. Not Eng’d. Not SSOT.  
**Owner leans (so far):**
- Stable **main address** + **additional A/B** (often Unix); optional Http→Unix proxy
- Replace options-bag `restartSuccessor` with **`Update.plan` → `Update.execute`**
- **`Update` module separate from `Versioned`** (Versioned = schema chains; Update = fleet cutover)
- Plans are **fleet-wide**, ordered; declare contract/version from→to + audit
- **Simulate/mock** helper for test-run before real execute
- Deploy path: **Update node** (maybe → **Machine** that watches processes); reopen spine α
- Update packages / webhook / pull — later, design-docked

**Branch:** Agent 5 · `cursor/lifecycle-defer-start-929b`  
**Related:** [`multi-protocol-nodes.md`](./multi-protocol-nodes.md) · [`versioned-schema-decisions.md`](./versioned-schema-decisions.md)
· [`launcher-and-handoff-brief.md`](./launcher-and-handoff-brief.md) (spine α may be revisited — §9)
· dream recipe [`docs/examples/launcher/dream-redeploy.md`](../examples/launcher/dream-redeploy.md)
(**provisional**)

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

## 5. `Update` module — owner lean (2026-08-07/08)

### 5.1 Module home

| Choice | Owner |
|--------|--------|
| New public namespace `hyperlink-ts/Update` | **Yes lean** |
| Merge Update into `Versioned` (keep name Update) | Considered; **prefer separate** |
| Keep `Versioned` = schema upcast chains only | **Yes** — Update *uses* Versioned / `contractHash` for validation |

`Lookup.planUpdate` impact brain folds into or feeds `Update.plan`. Custody/spawn may stay
on today’s Launcher **or** move under Machine (§9) — Update orchestrates, doesn’t re-own
Node listen.

### 5.2 Compose plan → execute (middle path)

**Rejected poles:** raw verb salad · mega `restartSuccessor({…})` options bag.

```ts
// SKETCH — names TBD
const plan = yield* Update.plan({
  // fleet-wide — not a single A→B forgery
  steps: [/* ordered node updates */],
  contracts: [/* from→to version audit — §5.3 */],
})

// inspect / gate / audit
yield* Update.simulate(plan) // mock production-like run — §5.4
yield* Update.execute(plan)  // real cutover
```

Properties:

1. **Plan is a value** — inspectable, serializable enough for audit/CI, not hidden in execute.
2. **Execute is dumb-ish** — runs a validated plan; narrow overrides only if needed.
3. **One Node identity per step** + role/address — not forged `nodeA`/`nodeB` Tags.
4. Policy/Advice stay for dial/seam; not `prefer?: boolean` on execute.
5. Happy path still aims at main Http + Unix A/B (+ optional proxy).

### 5.3 Contracts / versions on the plan (optional but first-class)

Plans should be able to declare **which contracts change** and **from→to versions** so
execute can **validate** you’re updating the expected tips and emit an **audit** trail.

```ts
// SKETCH
Update.plan({
  contracts: [
    {
      tag: Jobs,                         // or wire key
      from: "jobs/payload@2",          // Versioned.schemaVersion / live Directory tip
      to: "jobs/payload@3",
      // contractHash from→to optional
    },
  ],
  steps: [/* … */],
})
```

- **Not required** on every plan (ops escape / same-tip binary bump with no schema move).
- When present: fail closed if live incumbent tip ≠ `from`, or successor won’t serve `to`,
  or Versioned has no path `from→to`.
- Audit: who planned, declared from/to, observed tips, step order, outcome — shape TBD
  (structured log / HistoryStore / Update journal).

Uses Eng’d `Versioned` + `contractHash` / status rows — does **not** absorb Versioned into
Update.

### 5.4 Simulate / mock test-run helper

Owner: provide a helper that **runs a full mock of the setup and runs the update on it** —
a test-run before production execute.

- Node under test should run **like production** (real serve/listen/Directory/WorkPool
  handoff paths). If you write proper tests you already do that; Update should add
  **tools to simulate an update** so the extra work is small.
- `Update.simulate(plan)` (name TBD) ≈ execute against in-process or temp-address fleet:
  bring up incumbent tip → apply plan → assert Directory/tips/payloads/audit — then tear
  down. Not a second fake handoff engine.
- Live suite today (`test/launcher-dream-redeploy.test.ts`) is the spirit; productize as
  Update test utilities, not a one-off example script.

### 5.5 Fleet-wide plans + ordered handoffs

**An update plan is not “A→B for one node.”** It covers **every affected node**, with
**strategic ordering**.

```ts
// SKETCH
Update.plan({
  contracts: [/* Jobs @2→@3, … */],
  steps: [
    { node: LookupWorker, /* … */ },     // or omit if Lookup tip unchanged
    { node: MailWorker, order: 1 },
    { node: JobsWorker, order: 2 },      // after Mail if Jobs depends on Mail tip
    { node: EdgeProxy, order: 3 },
  ],
  // or explicit: order: [MailWorker, JobsWorker, EdgeProxy]
})
```

Open: parallel steps vs strict sequence; failure policy (stop / continue / rollback);
whether order is DAG or total list; co-update groups from today’s `planUpdate.coUpdate`.

Today’s single-target `Lookup.planUpdate` / `restartSuccessor` become **one step** inside
a fleet plan — not the whole API.

---

## 6. Deployable updates — Update node / packages (design dock)

Plan for **actual deployable updates**, not only local file-swap demos.

### 6.1 Update node

A long-lived **Update node** (name TBD) that:

- Listens for update signals (config-driven — e.g. GitHub webhook)
- Knows how to **pull** the new artifact (git origin, image, bundle, …)
- Participates in `Update.plan` / `execute` for nodes on that machine / cohort
- Is reachable via Lookup (Directory membership) like other nodes

Class-shaped like **HttpApi / Router rewrite** (Agent G): a **class that holds
configuration**, not necessarily a HyperService Tag you `yield*`. Job = listen + configure
pull/apply; implementations swap (webhook vs poll vs CLI push).

```ts
// SKETCH — HttpApi-like holder, not a Context.Tag service
class FleetUpdate extends Update.Node("fleet/Update") {
  // webhook route, pull strategy, which local nodeKeys it owns, …
}
```

Exact parallel to Router/HttpApi is a discussion fork (§10) — don’t Eng Node→HttpApi
conversion for all nodes in this dock; scope is **Update’s** declaration style first.

### 6.2 Update packages

Later: **update packages** — artifact (code/bundle) sent from CLI or TUI to every relevant
Update node, **directed via Lookup**. Push path complements pull/webhook.

```
CLI/TUI ──package──► Lookup ──direct──► Update nodes ──apply──► local workers
```

v1 can be pull-only; packages are a planned deploy surface.

### 6.3 Relation to addresses / proxy

Deployable update still wants **stable main** + backend A/B (or proxy flip). File-swap on
an active path is one local apply strategy; image replace / package extract are others —
plan steps name the strategy, execute/Update-node perform it.

---

## 7. Resident host agent + Launcher spine — reopen for discussion

**Locked today (launcher brief spine α):** Launcher is **dumb spawn-and-exit** — not a
long-lived fleet supervisor; nodes + Lookup own ongoing control.

**Owner (2026-08-08):** maybe wrong. If updates are automatic and processes need watching,
something **resident per host** should: watch processes, listen for update signals, run
plan execute locally, optionally wrap spawn. **Names `Machine` and `Update.Node` rejected** —
candidates in §7.1.

| Idea | Sketch |
|------|--------|
| **Resident host agent** (name TBD) | Per host: watch, listen, execute plans for local workers |
| **Merge Launcher into that agent** | e.g. `Host.spawn` wrapping today’s `Launcher.up` |
| **Launcher stays library helper** | Thin spawn used *by* the resident agent |

This **reopens spine α** — do not silently unlock. Lookup stays membership/advice; the
resident agent is a **host agent**, not a second Directory.

Cutover API may keep or drop the name `Update` independently of the resident node’s name.

### 7.1 Naming candidates (not Machine, not Update.Node)

**None locked.** Module vs node may share a name or split (`Rollout.plan` + `Host` node).

**Host / runtime:** `Host`, `Runtime` (Effect clash), `Agent` (AI clash), `Daemon` (HyperService clash), `Supervisor`, `Watchman`/`Watcher`, `Keeper`, `Steward`, `Caretaker`, `Custodian` (Launcher custody overlap).

**Fleet / ops:** `Fleet`, `Ops`, `Control` (Lookup clash), `Bridge`, `Relay`, `Deck`.

**Deploy / release:** `Release`, `Deploy`, `Rollout`, `Ship`, `Stage`, `Cutover`, `Migrate` (Versioned clash).

**Hyperlink-flavored:** `Anchor`, `Mooring`, `Pier`, `Dock` (design-dock clash), `Harbor`/`Harbour`, `Port` (protocol clash), `Beacon`, `Signal`, `Pulse`. (`Link` historically rejected — POSIX.)

**Process / spawn lineage:** keep/`grow` `Launcher`, `Spawn`, `Process`, `Unit`/`ServiceUnit`, `Squad`, `Crew`, `Hive`, `Nest`. (`Cell` parked/rejected elsewhere.)

**Pairings (API + resident node):** `Rollout`+`Host`, `Fleet`+`Steward`, `Release`+`Keeper`, `Cutover`+`Anchor`, `Ship`+`Harbor`.

Pick metaphor first (host vs deploy vs fleet), then module/node split.

### 7.2 Shortlist — `Machine` vs `Host` (owner 2026-08-08)

Owner narrowed to these two for the **resident agent** (clarity undecided). Earlier veto of
`Machine` is soft-reopened for comparison only — **not locked**.

| | `Host` | `Machine` |
|---|--------|-----------|
| Means | The computer / OS environment where processes run | Same, slightly more “box we operate” |
| Clarity | Very plain; “host agent” is industry-normal | Plain; less overloaded in *this* repo than `Host`? |
| Clash risk | Mild — “host” also means HTTP Host header / hosting provider | Mild — OS/VM/K8s “machine”; not used as a Hyperlink module today |
| API taste | `Host.spawn`, `Host.Node`, `yield* Host` | `Machine.spawn`, `Machine.Node`, `yield* Machine` |
| Pair with cutover module | `Rollout`/`Update` + `Host` reads clean (“plan on Rollout, run on Host”) | `Rollout`/`Update` + `Machine` also fine |
| Vs Lookup | Clear: Lookup = fleet brain, Host = this box | Same split |
| Vs Node | “Host runs Nodes” is natural English | “Machine runs Nodes” also natural; “node on a machine” is ops-common |
| Risk | Sounds like *only* networking/bind, not update/supervise | Sounds like *only* hardware/VM, not update/supervise |

**Neither name carries “update”** — cutover API stays a separate module name (`Update` /
`Rollout` / …). The resident thing is “the box agent,” not the plan type.

**Agent lean (not owner lock):** prefer **`Host`**. Clearest English for “this machine’s
agent,” pairs cleanly with Lookup/Node, and `Host.spawn` reads better than `Machine.spawn`
for “start a process here.” Re-accept `Machine` only if you want distance from HTTP “host.”

### 7.3 Owner lean — keep `Launcher`, nest locality under `Node` (2026-08-08)

```
Launcher          → still spawn-and-exit (spine α may stay for the *library*)
Node.make(…)      → declare a node like HttpApi (config holder) — §7.5
Node.<Locality>   → “these processes/runtimes are local to each other” — §7.4
Update / Rollout  → plan → simulate → execute (separate)
```

Sketch (name of locality TBD — was `Machine`):

```ts
// SKETCH
class Worker extends Node.make("fleet/Worker", {
  main: { url: "http://127.0.0.1:8080/rpc", kind: "Http" },
}) {}

class ThisBox extends Node.Machine(/* or Host / Island / … */)("box-1", {
  nodes: [Worker, Mail, …],
  // watch, update listen, pull strategy, …
}) {}

yield* Launcher.up({ node: Worker, process: … }) // or Host/Machine asks Launcher
```

**Not locked** — records the composition: Launcher stays; locality is a **Node-namespaced**
concept, not a top-level `Machine` module competing with Launcher.

### 7.4 What word means “processes/runtimes local to each other”?

Desired meaning (owner): **multiple processes/runtimes that share locality** — same OS
host, cheap IPC (Unix), shared update/supervise plane — **not** the whole fleet, **not**
one Node identity.

| Term | Fit | Notes |
|------|-----|-------|
| **Host** | Strong | Industry “same host”; clear vs fleet/Lookup |
| **Machine** | Strong | Ops “on this machine”; pairs as `Node.Machine` |
| **Box** | Informal | Very clear; maybe too slang for public API |
| **Locale** / **Locality** | Exact | Emphasizes *local-to-each-other*; a bit academic |
| **Site** | Medium | Often means datacenter/region — bigger than one OS |
| **Station** | Medium | Cute; unclear |
| **Island** | Medium | Co-located + bounded; “island of runtimes” |
| **Pod** | Weak here | K8s baggage (often multi-container one IP) |
| **Colony** / **Compound** | Weak | Obscure |
| **Yard** / **Depot** / **Base** | Weak | Stretch metaphors |
| **Siblings** / **SiblingSet** | Medium | “Sibling processes”; not a place |
| **Colo** / **Colocation** | Medium | Exact meaning; ugly as type name |
| **Vicinity** / **Neighborhood** | Weak | Soft |
| **Chassis** | Medium | Hardware-flavored “one box” |
| **Runtime** | Clash | Effect Runtime |
| **Cluster** | Wrong | Usually multi-machine |
| **Fleet** | Wrong | Whole mesh |
| **Group** | Wrong | Already Hyperlink handle-trees; not OS locality |
| **Cell** | Parked | Toolkit history |

**Best clarity for the definition you gave:**

1. **`Host`** — “runtimes on this host”
2. **`Machine`** — “runtimes on this machine” (esp. as `Node.Machine`)
3. **`Locale`** — if you want the word to mean *locality itself*, not the hardware
4. **`Island`** — if you want “bounded co-located set” without saying host/machine

**Agent lean:** **`Host`** for the concept; **`Node.Host`** or **`Node.Machine`** as the
API nest under Node (owner already floated `Node.Machine` + keep Launcher). If HTTP
“host” bothers you, `Node.Machine` is the clearer nested name.

### 7.5 `Node.make` — HttpApi-shaped declaration (design)

**Today:** `Node.Tag()` is a **Context.Service** — `yield* Worker` resolves transport;
address is stamped on the Tag class via `assembleNode`.

```ts
// Eng'd today
class Worker extends Node.Tag<Worker>()("fleet/Worker", {
  url: "http://127.0.0.1:8080/rpc",
  kind: "Http",
}) {}
```

**Effect HttpApi pattern** (`repos/effect/.../HttpApi.ts`): constructable config holder —
`class Api extends HttpApi.make("api").add(Groups) {}` — **not** a Context service.
Builders (`HttpApiBuilder`) turn description → layers. Same spirit as UI `Route.make`
(catalog); Router’s live tag is separate.

**Desired direction (owner):** same config ergonomics, but **`Node.make`**:

```ts
// SKETCH — description first (like HttpApi.make)
class Worker extends Node.make("fleet/Worker", {
  // main + later additional addresses / roles — §3
  url: "http://127.0.0.1:8080/rpc",
  kind: "Http",
}) {}

// pipe / methods widen like HttpApi.add
class WorkerFull extends Worker.pipe(
  Node.withAddresses({ a: { path: "…" }, b: { path: "…" } }),
) {}

// runtime still needs a serve/listen/launch edge — Tag-as-Context may remain
// *derived* from the description, or a separate Node.service / launch binder
```

| | Today `Node.Tag()` | Target `Node.make` (sketch) |
|--|-------------------|----------------------------|
| Kind | Context key + address blob | Config/description (HttpApi-like) |
| `class extends` | Yes | Yes (`makeProto` / constructable) |
| `yield* Worker` | Transport service | Maybe **not** — or only after bind |
| Address | On the Tag | On the description; main vs additional |
| Locality | — | `Node.Host` / `Node.Machine` lists these makes |
| Prototype | `Node.Prototype` + `.make` for clones | Fold into `Node.make` / instance helpers? |

**Open forks inside this shift:**

1. Does `Node.make` **replace** `Node.Tag`, or does Tag become the Context projection of a
   make-description?
2. Keep `yield* Node` for transport, or only `Node.connect` / `Hyperlink.client(Tag, desc)`?
3. Catalog type param `ROut` (served Tags) — on make, on a `.serves(…)` method, or elsewhere?
4. Migration: `Tag()` as deprecated alias of `make` + service binder, or hard cut.

**Closest Eng’d cousin today:** `Node.Prototype` + `.make(instanceKey, address)` — instance
clones, not HttpApi catalog. `Node.make` would be the **primary declaration** for every
node, Prototype-shaped templates optional.

---

## 8. Open forks (discussion — do not resolve alone)

### Update API
1. ~~Compose vs bag~~ — **lean: plan → execute** (§5.2).
2. ~~Update vs Versioned merge~~ — **lean: separate modules** (§5.1).
3. Plan composition surface — fragments / pipes / object steps?
4. Execute overrides — only `plan`, or force/token narrow args?
5. Fleet order model — total order vs DAG; parallel steps; failure/rollback.
6. Contract declarations — required vs optional; audit sink.

### Addresses (still)
7. Proxy ownership — resident agent? dedicated proxy Node? Lookup feature?
8. Directory advertise — main only vs main+backends vs proxy row.
9. Type model — `endpoints` vs role address list vs both.
10. HyperServices see main only — types vs convention.
11. Address-from-`nodeKey` — Unix-only v1?
12. `withAddresses` vs overload `withProtocol`.

### Deploy / locality / Node.make
13. **Locality name** — `Host` vs `Machine` vs `Locale` / `Island`; nest as `Node.*` (§7.3–7.4).
14. **Keep Launcher** + locality under Node vs merge spawn into locality agent (§7.3).
15. **`Node.make` vs `Node.Tag`** — replace, dual, or Tag-as-projection of make (§7.5).
16. Does `yield* Worker` survive make, or description-only until bind?
17. Webhook / pull / package push — first deployable slice.
18. Cutover module name (`Update` vs `Rollout` / …) vs locality name.
19. Deprecation path for Eng’d `restartSuccessor` + dream-redeploy + `Node.Tag`.

---

## 9. Current Eng’d facts (do not confuse with desired)

| Fact | Where |
|------|--------|
| One primary `(kind, url\|path)` + optional per-kind `endpoints` | `Node.Tag` / `withProtocol` |
| Directory: one dial row per `nodeKey` | `DirectoryEntry` |
| App A/B today = same key, new dial, sticky + prefer | `restartSuccessor`, Policy |
| Lookup A/B = one address, orchestrated ownership | `Lookup.follow` |
| Schema tips / upcast | `Versioned` |
| Impact dry-run (single target) | `Lookup.planUpdate` |
| Spine α spawn-and-exit | `Launcher` |
| No `Update` module / fleet plan / simulate helper / Update node | — |
| No address-from-`nodeKey` / role address list / proxy-as-main | — |

---

## 10. Next

1. ~~plan → execute~~ · ~~Update ≠ Versioned~~ recorded.
2. Discuss **fleet plan ordering** + **contract audit** shape (§5.3–5.5).
3. Lock **locality word** (`Host` / `Machine` / …) + **keep Launcher** (§7.3–7.4).
4. Lock **`Node.make`** shape vs Tag (§7.5) — biggest Node API tension.
5. Lock address forks enough for make() config (roles, main, proxy).
6. Only then Eng — Node.make → locality → Update plan/simulate/execute → migrate examples.
7. Dream-redeploy stays **provisional** until the new API exists.
