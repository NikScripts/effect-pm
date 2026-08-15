# Node addresses + update API — design notes

**Status:** **Partial Eng** (2026-08-09). `Update.plan` → `simulate` → `execute` shipped
(guide [`docs/guides/update.md`](../guides/update.md)). Address / Node.make / policy API
sketches from 2026-08-08–09 are **parked** — owner reset: catalogue **configuration
scenarios** before picking an API (§3). Piped vs declared addresses must be **equivalent**
when we return to surface design.

**Still true from Eng’d tip:**
- ~~options-bag as SSOT~~ — Update preferred over `restartSuccessor` for new code
- Update ≠ Versioned; fleet plan + contracts + simulate gate Eng’d
- `Node.shutdown` leave keeps prefer across dial-replace
- Update dream / backup-build simulate / deploy / locality — later

**Active design step:** §3.4 **core features + API** (scenarios catalogue kept above as
background; API sketch un-parked in slim form).

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
| **Identity lie** | Apps mint `nodeA` / `nodeB` as separate `Node.Service` values that share a `nodeKey` but different dials. The “same node” is reconstructed from Directory after the fact. |
| **Address is the cutover** | Cutover = invent a second dial and hope Directory + sticky + prefer stitch it. No first-class stable public address. |
| **Tags as plan input** | Caller re-lists what B will serve; easy to drift from the child’s actual `Node.http(…, [serve…])`. |
| **Prefer as a boolean** | Dual-serve / early-move is a Policy/Advice concern stuffed into a launcher flag. |
| **Dream recipe is a script** | File-swap + ports + active path + waitUntil Directory — proves mechanics, not a product API. |

**Standards it falls short of (owner):** Effect-true composition (layers/pipes over option
blobs), namespace SSOT (one place owns “how this node is addressed / updated”), and the
bar set by `LookupPolicy.make` / `Node.withProtocol` (typed fragments you compose, not a restart
RPC).

**What stays valuable from Eng’d work:** `Lookup.planUpdate` impact shape, Directory as
membership, Policy sticky + Advice early-move, WorkPool baked handoff, `Lookup.follow` for
**Lookup’s** single-address ownership gap. The **execution verb shape** and **address model
for app nodes** are what’s in the dock.

---

## 3. Node configuration scenarios (before API)

**Owner (2026-08-09): start over on address/policy API.** First list the **ways you want
to run a node**. Do not invent listen/advertise defaults or factory shapes until these
are shared. Constraint for later: whether an address was on `make` or piped on afterward,
the **result is the same**.

Each scenario is an outcome. Concrete dials are illustrative only — not an API proposal.

### 3.0 Catalogue

| # | Scenario | What you want |
|---|----------|---------------|
| S1 | Single dial | One process, one address (Http or Unix). Listen, advertise, dial that one thing. |
| S2 | Multi-protocol, one process | Same process speaks Http + WS + Unix (or any subset). Clients pick a protocol. |
| S3 | Several dials, same protocol | e.g. two Http ports both live on one process (or two Unix paths). |
| S4 | Public + private | Public edge dial for clients; private IPC only for siblings / proxy / ops. |
| S5 | Stable front, swappable back | Clients always hit the same dial; backends A/B take turns behind it (proxy or equivalent). |
| S6 | Dual public cutover (today) | Clients move from dial A to dial B (Directory replace + sticky/Advice). No stable URL. |
| S7 | Role-split processes | Same logical node identity; one OS process is “A”, another is “B” (or edge vs worker). |
| S8 | Local-only | Unix/IPC only — no public Http. Dev, sidecars, same-host mesh. |
| S9 | Key-derived local dial | Don’t hand-mint sock paths; identity (node key) implies the local dial. |
| S10 | Config-varying dials | Same Node class in dev/stage/prod; host/port/path from Config/env, not baked in source. |
| S11 | Listen ≠ advertise ≠ dial | Bind more than you publish; or publish a front clients dial while you also listen on backends. |
| S12 | Lookup-style single seat | One address for the control plane; ownership moves across processes (`Lookup.follow` today). |
| S13 | Co-located cohort | Several nodes on one host share cheap IPC + a local supervise/update plane (Host/Machine — later). |
| S14 | Multi-primary HA | More than one client-facing dial, all valid; client policy picks among them. |

### 3.1 Walkthrough (outcomes, not API)

**S1 — Single dial.** Simplest app node. One listen, one Directory row, clients dial that.

**S2 — Multi-protocol.** One process, several protocols at once. Connect selection picks
kind (today’s X1 instinct). No cutover story required.

**S3 — Same protocol, several dials.** Two Http ports or two socks on one process. Need a
rule for which clients prefer when several are public.

**S4 — Public + private.** Clients only ever learn the public dial. Private dials exist for
same-host peers, proxy backends, or admin — not for random fleet clients.

**S5 — Stable front, swappable back.** Interruption-free binary update lean: client URL
never changes; A/B (often Unix) swap behind a proxy or equivalent. Front may be Http;
backs another protocol.

**S6 — Dual public cutover.** What Eng’d dream/restart does today: new dial, Directory
replace, sticky/Advice. Works; no stable client URL across the cut.

**S7 — Role-split processes.** Not everything lives in one OS process. “A” and “B” (or
edge vs worker) may be separate processes sharing a node identity or a declared
relationship. Who listens on what is per-process.

**S8 — Local-only.** No public port. Path/IPC only.

**S9 — Key-derived local dial.** Ops doesn’t invent `/tmp/….sock` strings; the node’s
identity implies the local address (how is TBD after scenarios).

**S10 — Config-varying dials.** Source describes the node; runtime fills host/port/path
from Config so the same class runs in many environments.

**S11 — Listen ≠ advertise ≠ dial.** Deliberate split: e.g. listen on front+backs, advertise
only front, clients dial only front. Or listen on everything declared but advertise a
subset. This is why “policy knobs” exist — but we name the **outcomes** first.

**S12 — Lookup seat.** Already Eng’d pattern: one Lookup address, successive owners,
`follow` across the gap. App nodes may or may not mirror this.

**S13 — Co-located cohort.** Later (locality Host/Machine): many nodes on one box, cheap
IPC, shared update/supervise. Depends on S4/S5/S8 more than on factory syntax.

**S14 — Multi-primary HA.** Several client-facing dials all legitimate; ambiguity handled
by client Policy (sticky, prefer, fail-closed) — same family as multi-row Directory today.

### 3.2 Core features (slim)

| Feature | Meaning |
|---------|---------|
| **Address list** | A Node carries many addresses (any protocol mix). |
| **Primary vs labeled** | Unnamed = primary (client-facing). Labeled (A/B/…) = roles / backends. |
| **make ≡ pipe** | Same address set whether passed to `make` or piped on afterward. |
| **Listen** | Process binds the addresses it runs with (default: all declared — `NodePolicy` can narrow). |
| **Advertise** | Directory default = **primaries**; `NodePolicy` can widen. Clients dial what Directory publishes (+ client `Policy` pick). |
| **NodePolicy** | Node-side: listen / advertise / proxy / which labeled process this is. |
| **LookupPolicy** | Lookup / Directory participation (Eng’d `LookupPolicy`): sticky, verify, stream-gap, pick, conflict, yield. |
| **Key-derived Unix** | `Address.unixFromKey` — Unix primary from node key (no manual path helper). |
| **One list** | Replaces today’s `endpoints` / `withProtocol` for new code. |

Cutover shapes (stable front+A/B, dual-public replace, split A/B processes) are
**NodePolicy + deploy** on top of this list — not separate address models. Update API
stayed parked.

### 3.3 API (sketch)

Two policy modules — different jobs. **Locked (Agent 5 call):** rename Eng’d
`hyperlink-ts/LookupPolicy` → **`hyperlink-ts/LookupPolicy`** when `NodePolicy` Engs (same
change set — no long-lived ambiguous `Policy`). Not `ClientPolicy`: “client” is vague
and undersells Directory claim/yield.

| Module | Owns |
|--------|------|
| **`hyperlink-ts/LookupPolicy`** | How Lookup / Directory participation behaves (Eng’d `LookupPolicy`): dial (`Sticky`, `Verify`, `StreamGap`, `Pick`, `ColdAmbiguous`) **and** claim / yield (`Conflict`, `Yield`) |
| **`hyperlink-ts/NodePolicy`** | **This process** vs its address list: bind, publish, proxy, which labeled side it is |

Pairs with modules: `Lookup`↔`LookupPolicy`, `Node`↔`NodePolicy`. `Conflict` / `Yield`
stay on `LookupPolicy` (advertise path / incumbent ask) — not address-list knobs.

Address = identity + dial target. **NodePolicy** = what this OS process does with that
list. Do **not** stuff node knobs into `LookupPolicy.make`.

```ts
import * as Address from "hyperlink-ts/Address"
import * as Node from "hyperlink-ts/Node"
import * as NodePolicy from "hyperlink-ts/NodePolicy"
import * as LookupPolicy from "hyperlink-ts/LookupPolicy"

// ── Address factories ──────────────────────────────────────────────
Address.http(":8080")
Address.unix("A", "/var/run/w.a.sock")
Address.ws([4000, 4001])
Address.http({ A: 3000, B: 3001 })
Address.unixFromKey                         // no ()

// ── NodePolicy — pipe onto Node (same style as Address.*) ──────────
NodePolicy.primaryAddress("AllUnlabeled")   // | "All" | ReadonlyArray<label>
NodePolicy.listen("All")                    // | "Primary" | ReadonlyArray<label>
NodePolicy.advertise("Primary")             // | "All" | ReadonlyArray<label>
NodePolicy.proxy("Prefer")                  // primary forwards → live labeled (Advice)
NodePolicy.as("A")                          // this OS process is the "A" side

NodePolicy.make({
  PrimaryAddress: "AllUnlabeled",
  Listen: "All",
  Advertise: "Primary",
  Proxy: "Prefer",
  As: "A",
})

// LookupPolicy — provide on lookupClient / follow / membership, not on Node.make
LookupPolicy.make({ Sticky: true, Verify: "reject" })

// Docs (full sources): docs/examples/node/forward-proxy.md
//                      docs/examples/launcher/dream-redeploy.md
// Run: pnpm run example:node-forward-proxy
//      pnpm run example:launcher-dream-redeploy
//
// ── ONE Node.make per identity — never make the same key twice ─────
// Public class = client-facing dials only (no A/B on construction).
class Worker extends Node.make("fleet/Worker", Address.http(":8080")) {}

// Private view = Public.pipe(Address…) — same key, HttpApi-shaped.
class WorkerPrivate extends Worker.pipe(
  Address.unix({ A: "/var/run/w.a.sock", B: "/var/run/w.b.sock" }),
  NodePolicy.proxy("Prefer"),
) {}

// Process roles = Node.config overlays (same key + address list)
const edge = Node.config(WorkerPrivate, {
  Listen: "Primary",
  Active: "A",
})
const backendA = Node.config(WorkerPrivate, { As: "A", Listen: ["A"] })

Node.http(edge, [Node.forward(edge, Probe)])
Node.unix(backendA, [Hyperlink.serve(Probe, { tip: Effect.succeed("v1") })])
Hyperlink.client(Probe, Worker) // public
yield* Node.activate(WorkerPrivate, "B")

class Local extends Node.make("fleet/Local", Address.unixFromKey) {}

class DualHttp extends Node.make("fleet/Edge", [
  Address.http(":8080"),
  Address.http(":8081"),
]).pipe(
  NodePolicy.advertise("All"),              // publish every declared address
) {}
// multi-primary pick → LookupPolicy.pick / ColdAmbiguous, not NodePolicy
```

**Defaults:** `PrimaryAddress` = `"AllUnlabeled"` (every unlabeled address — several
same-protocol OK); listen `"All"`; advertise `"Primary"` (that set); no proxy; no `as`.
Owned mode strings are PascalCase. Overlap = same concrete dial → reject.

| Knob | Meaning |
|------|---------|
| **PrimaryAddress** | Defines the primary **set** (`"AllUnlabeled"` / `"All"` / labels) |
| **Listen** | Which declared addresses this process **binds** |
| **Advertise** | Which land in **Directory** (`"Primary"` = the PrimaryAddress set) |
| **Proxy** | Primary **forwards** to the live labeled side (e.g. Advice prefer) |
| **As** | This OS process **is** labeled side `"A"` / `"B"` (not a vague “role”) |

**Why not `Role`:** “role” reads like RBAC / job title. The question is only: *which
labeled address side is this process?* → `NodePolicy.as("A")`.

**Why no Dial on Node config:** participants dial what Directory advertises; soft-pick /
sticky / wait-advice stay on **Lookup config / policy** (§3.3.1). One dial story, not two.

### 3.3.1 Policy vs config (locked 2026-08-12)

**Owner:** things that don’t need handlers are **not** policies — they are **config**.
Policy = pluggable behavior (handler Effect/fn + default Layer), HttpApi-ish.
Config = Schema’d dials the engine branches on.

| Kind | Module (target names) | Members |
|------|------------------------|---------|
| **Lookup config** | `LookupConfig` (today still on `LookupPolicy`) | Sticky, StreamGap, ColdAmbiguous, Verify, Conflict *modes* |
| **Node config** | `NodeConfig` (today `NodePolicy`) | PrimaryAddress, Listen, Advertise, Proxy, As, Active |
| **Lookup policy** | `LookupPolicy` (shrunk) | Yield, Pick — handlers; both-ways options (`yield("Refuse")` ≡ `yieldRefuse`) |

**Where config lives:** ambient `Context.Reference`s with `defaultValue` (same DX:
`yield*`, Layer overrides). **Not** a product options-bag on `lookupClient` /
`Node.make`. Call-site stamps stay rare overrides that win over ambient.

**Post-`Node.make` config / policy (locked 2026-08-12):** creating a node must
**not** freeze Node config or the address list. Apps must be able to **change**
values and **add** to list-shaped pieces afterward — same identity (`nodeKey`),
no second `make`.

| Path | When | Semantics (target) |
|------|------|--------------------|
| **`.pipe(Address.*)`** | Class hierarchy / type widen after `make` | Addresses **append** |
| **`Node.configure(MyNode, { …partial })`** | Process roles / knobs after the class exists | Partial `NodeConfig` bag — **camelCase keys**, PascalCase string values (D21); last-write merge. **Reject** `Node.config` / `withConfig` / `withPolicy` (D22) |
| **`Node.policy(MyNode, …fragments)`** | Handler-shaped policy overlays on a node | **Varargs merge**; policy only. Bag stays on `Node.configure` |
| **`LookupConfig.provide` on layers** | Client / peers / serve composition | Layer override of ambient Lookup config — not stamped into the Node forever |

```ts
// Target DX (not Eng’d)
const edge = Node.configure(WorkerPrivate, {
  listen: "Primary",
  active: "A",
  advertise: "Primary",
})
const backendA = Node.configure(WorkerPrivate, { as: "A", listen: ["A"] })
Node.policy(MyNode, LookupPolicy.yield("Refuse"))
Node.policy(MyNode, LookupPolicy.yield("Accept"))
```

`Node.activate` remains the live flip for Active (runtime retarget), separate from
stamping listen/as/advertise via `Node.configure`.

**Policy handlers (locked 2026-08-13):** **both forms for every option** — the
parameter helper **and** named sugar. Neither is second-class.

```ts
// helper + option (like streamGap("stall"))
LookupPolicy.yield("Accept" | "Refuse" | Effect<boolean>)
LookupPolicy.pick("First" | fn)

// named sugar (same Layer / same install)
LookupPolicy.yieldAccept
LookupPolicy.yieldRefuse
LookupPolicy.pickFirst

Node.policy(MyNode, LookupPolicy.yield("Refuse"))
Node.policy(MyNode, LookupPolicy.yieldRefuse) // equivalent
Node.policy(MyNode, LookupPolicy.yieldRefuse, LookupPolicy.pickFirst) // varargs merge
```

Reject boolean primary (`yield(true)`). Backing: `Context.Service` per policy +
default Layer.

**Override precedence (locked 2026-08-13):** call-site (`ListenOptions.onYield`,
lookupClient `{ pick }`, …) **>** `Node.policy` stamp on the node **>** ambient
Service default (`yield("Accept")` / unset Pick → coldAmbiguous path). Local
wins over stamped wins over package default.

Tip still has `withPolicy` + uneven sugar — `Node.policy` + full both-ways
surface when owner says Eng.

### 3.3.3 Agent 5 decision pack (2026-08-15) — owner may override any id

All open A/B / policy / dream calls **agent-decided** below. Change an id → we
revise. Until overridden, this is the dream SSOT (not yet Eng’d).

**Quality bar (owner 2026-08-15):** D1–D22 stand. On top of them — every Eng’d
surface must be **as easy to set up and as extendable as the best A/B / rollout
tools** (k8s Deployments + Services, Envoy/edge VIP flip, Nomad/systemd + LB).
If a step is harder than “declare identity → role overlays → plan/simulate/execute”
or less extendable than “new labeled backend / new policy handler / new plan step
without forging identities,” it fails the bar even if it matches a D#. Ease and
extension win tie-breaks when Enging.

| Easy (DX) | Extendable (growth) |
|-----------|---------------------|
| One `Node.make` + `configure` / `policy` — no forged A/B keys | New label (C) = another address + `configure({ as, listen })` |
| Stable client dial; cutover is `Update.plan`→`simulate`→`execute` | New policy = one Service + both-ways options + default Layer |
| Both-ways options + camelCase bags — readable, guessable | New config knob = Reference + camelCase bag field — not a new module |
| Ready/handoff/activate inside execute — not a script | S6 dual-public and S5 β share plan/simulate; execute strategy varies |
| Defaults work (Accept, Primary advertise, verify on) | Call-site → stamp → ambient precedence; Layer `provide` for clients |

**Fail the bar:** manual queue copy, `verifyOff` as the story, duplicated worker
files, options-bag `restartSuccessor` as SSOT, three `make`s for one key,
dream demos that need a novel to explain.

**Summary table**

| Id | Choice (short) |
|----|----------------|
| D1 | S5 Shape β is the product A/B bar |
| D2 | Update.execute grows β (up → handoff → activate → shutdown) |
| D3 | S14 filtered Directory rows for handoff peers |
| D4 | No manual queue copy — baked handoff only |
| D5 | Parity test = stable dial + exact pending + tip flip |
| D6 | Rollback = re-activate / re-up — no time travel |
| D7 | One make + pipe + Node.config roles |
| D8 | One worker entry; tip from Config/argv |
| D9 | Policy = handlers; rest = config modules |
| D10 | Node.config bag + Node.policy varargs |
| D11 | Both-ways options (`yield("Refuse")` ≡ `yieldRefuse`) |
| D12 | `yield(effect)` on the same helper |
| D13 | call-site > Node.policy > ambient |
| D14 | Layer provide for clients; Node.policy for nodes |
| D15 | Context.Service + default Layer per policy |
| D16 | Proxy Prefer = forward + Active; flip = activate |
| D17 | Stream/ref forward before default verify |
| D18 | Dream = Update compose; forward-proxy = substrate |
| D19 | Plan tags must match serve; infer later |
| D20 | Eng order: S14 → config/policy → stream/ref → Update β → dream |
| **D21** | **Bag keys camelCase**; option **strings** stay PascalCase; References stay PascalCase |
| **D22** | Stamp method = **`Node.configure`** (not `Node.config`) — avoid Effect `Config` collision |
| **D23** | **Auto address pool** for proxy cutover (not hard-coded A/B names); optional **key-derived range**; narrow by concrete address or explicit range |

#### D23 — Auto address pool for proxy cutover (revised 2026-08-15)

**Choice:** For Shape β, apps declare **protocols** + **proxy**, and get an
**available address pool** the runtime can use the way we use A/B today (bring
one up, activate/flip, drain the other) — **not** a requirement to name labels
`"A"` / `"B"`. Optional: a **standard range derived from the node key** (port
band / sock namespace) so two nodes don’t collide without hand-minting. Narrow
when needed with a concrete address or an explicit range.

```ts
// Intent (sketch) — protocols + proxy → pool of usable dials
Node.configure(Worker, { proxy: "Prefer" /*, protocols: ["Http", "Ipc"] */ })
// runtime: primary + N available backend dials from key-derived range (or defaults)

// Narrow
Node.configure(Worker, { /* range: … */ })
Address.unix("/explicit/path.sock") // pin / add concrete
```

**Not chosen:** “Auto mint `Address.unix({ A, B })` from key” as the story —
owner did not ask for key→A/B socks; A/B is the *usage pattern* (active/standby
slots), not the required label vocabulary. Labeled `"A"`/`"B"` remain valid when
apps want explicit names.

**Why:** Owner correction — available addresses used *like* A/B; key only as a
possible **range** seed, not as hard-wired A/B paths.

**Rejected:** Hard-coding product DX around labels `"A"`/`"B"`; requiring
hand-minted socks for the default proxy pool; random non-ranged `/tmp` UUIDs as
the only auto story (range-from-key preferred when auto).

**Implies:** `Node.activate` / Active config speak in **pool slot / address
identity** (label if present, else stable pool index / dial id). Dream examples
can still show `"A"`/`"B"` as one way to name slots, not the only way.
`unixFromKey` bind stays useful for **single** key-derived primary; pool range
is a separate mechanism (may share slug/root Config).

#### D24 — Type-catch conflicting addresses

**Choice:** Target **compile-time** overlap errors when dials are **literals** in
source. Keep **runtime** `AddressDialOverlap` for auto / `unixFromKey` /
Config-resolved dials (opaque until bind).

**Why:** Catch what types can see; don’t pretend types see resolved paths.

**Rejected:** Types-only for all conflicts; dropping runtime asserts.

**Implies:** Phantom unique dial brands on make/pipe lists for concrete literals.

#### D21 — camelCase keys (overrides prior PascalCase bag keys)

**Choice:** Product **object keys** are **camelCase** everywhere we stamp bags
(`Node.configure`, `LookupConfig.make`, plan-ish structs). **Owned string values**
stay **PascalCase** (`"Primary"`, `"Refuse"`, `"Accept"`, `"First"`). **Context
References / Services** stay **PascalCase** (`LookupPolicy.Sticky`,
`LookupPolicy.Yield`) — those are types/bindings, not bag keys.

```ts
Node.configure(MyNode, { listen: "Primary", active: "A", as: "A" })
LookupConfig.make({ sticky: true, verify: "Reject", streamGap: "Stall" })
LookupPolicy.yield("Refuse") // string option — PascalCase
yield* LookupPolicy.Sticky   // Reference — PascalCase
```

**Why:** Owner override 2026-08-15 — keys camelCase despite earlier PascalCase bag
locks. Matches normal TS/Effect option objects; keeps wire/mode literals loud.

**Rejected:** PascalCase bag keys (`{ Listen: "Primary" }`); camelCase option
strings (`"refuse"`).

**Implies:** Tip `LookupPolicy.make({ Sticky: true })` and dock sketches that used
PascalCase keys retarget on Eng. `_tag` on fragments: prefer PascalCase policy
name still (`{ _tag: "Sticky", value }`) as the sum tag — not the bag key.
Confirm fragment `_tag` casing if you want it camelCase too (default: leave
`_tag` PascalCase as the Reference identity).

#### D22 — `Node.configure`, not `Node.config`

**Choice:** The stamp function is **`Node.configure(node, partial)`**. Module name
for the knobs remains **`NodeConfig`** (types / References). Reject `Node.config`
as the method name.

**Why:** In Effect, **`Config`** is already a first-class module (`effect/Config` —
env/file providers, `Config.string`, `Config.unwrap`, …). A method named `.config`
reads like “attach Effect Config” or collides in headspace with
`ConfigProvider` / `Node.assumeTokenConfig`. `configure` is the verb for “apply
this partial knob bag to this node” and sits next to `Node.policy` without
stealing Effect’s noun.

**Rejected:** `Node.config` (collision); `Node.withConfig` (already rejected);
reusing Effect `Config` as the Node knob carrier (wrong abstraction — these are
Context/Layer stamps, not env decode).

**Implies:** Dream sketches and D10 use `Node.configure`. Layer helpers stay
camelCase (`listen`, `active`). Docs say “Node config” in prose for the concept;
API symbol is `configure` + `NodeConfig`.

#### D1 — Product A/B bar = S5 (Shape β)

**Choice:** The thing we optimize demos, Update, and “up to par” against is
**stable primary + labeled backends + forward + activate**. Clients keep one
dial across a binary update.

**Why:** Peer tools (LB VIP, k8s Service, Envoy cluster) almost always keep the
client address stable. S6 (dual public dial + sticky/Advice) works on tip but
forces every client to rebind — that is a migration of *address*, not a
redeploy behind a front door. Owner lean in §4 was already β.

**Rejected:** Treating S6 / `restartSuccessor` as the dream. It stays a supported
fleet shape for dual-public cutovers, not the north star.

**Implies:** Dream example, parity tests, and Update β all assume a primary that
does not move.

#### D2 — Update.execute drives S5

**Choice:** `Update.plan` → `simulate` → `execute` becomes the SSOT cutover verb
for β: bring up B → baked WorkPool handoff on shutdown A → `Node.activate("B")`
→ finish retiring A. Execute re-runs the simulate gate (already Eng’d for S6).

**Why:** Without this, A/B is a shell script (file-swap, activate, manual moves)
and we fail the “one SSOT API” bar vs Deployments / rollouts. Plan-as-value +
dumb execute is already Eng’d; it just still calls S6 custody.

**Rejected:** A separate `Redeploy` module; leaving activate outside Update
forever; growing more flags on `restartSuccessor`.

**Implies:** Until β lands, tip Update still does dial-replace. Docs must not
claim execute does activate yet. `prefer?: boolean` on execute stays out of the
β story (Advice/Active own early-move).

#### D3 — Handoff peers via S14 filtered Directory

**Choice:** Directory **may store labeled backend rows** (A/B Unix) for peer and
ops use. **`lookupClient` / normal app dials only see the Advertise set**
(Primary by default). On shutdown, WorkPool handoff peer-picks the other live
**labeled row with the same `nodeKey` and a different dial** — never a second
forged node identity.

**Why:** Today Advertise Primary ⇒ B never appears in Directory ⇒ baked handoff
cannot find a peer ⇒ demos invent `release`/`add`. Explicit peer dials on
shutdown reintroduce options-bag identity lies. Edge-mediated handoff couples
queue semantics to the proxy. Filtered multi-row is the least-lie: membership
truth in Directory, client view filtered by Advertise.

**Rejected:** Manual peer URL on shutdown; handoff only through the edge;
forging `WorkerA`/`WorkerB` keys; leaving private backends invisible forever.

**Implies:** Advertise and “rows handoff can see” are different projections of
the same Directory. Client sticky/Advice still operate on the Primary set.

#### D4 — No manual queue copy

**Choice:** Product path is only WorkPool’s baked `releaseEnqueueHandoff` during
`Node.shutdown`. Scripted `release` then `add` is not documented as a recipe.

**Why:** That script was the rejected dream-redeploy β. Peers don’t ask apps to
copy their own queues mid-rollout. Baked handoff is already Locked #39.

**Rejected:** “Interim until S14” copy as SSOT (S14 is D3; interim dies).

**Implies:** Dream rewrite waits on D3. Until then keep the tip example marked
rejected, don’t polish it.

#### D5 — Parity test = stable dial + exact pending + tip flip

**Choice:** Conformance for “up to par with A/B tools”:

1. Public client dials **primary** only (never A/B socks).
2. Enqueue pending on Active A.
3. Up B (new tip/binary).
4. Shutdown A → baked handoff moves **exact** payloads to B.
5. `Node.activate("B")` (or execute β does it).
6. Same public client sees new Probe tip; releases exact jobs from B.

**Why:** That is the intersection of LB stability, readiness-before-flip, and
drain/migrate that k8s/Envoy-class tools claim. Tip-only or dial-replace-only
tests are weaker.

**Rejected:** Counting “Directory row moved” or “activate flipped” alone as
parity without pending integrity.

**Implies:** D17 (forward+verify) must land before this test drops `verifyOff`.

#### D6 — Rollback is explicit, not magical

**Choice:**

- **Before A shutdown:** `Node.activate("A")` and stop/kill B — traffic returns
  to A; pending still on A.
- **After A is gone:** a new plan step (or manual) ups A again from a known
  good artifact. No automatic “roll back the binary” inventing A’s process.

**Why:** Peer tools distinguish abort-during-rollout from restore-after-retire.
Implicit revive hides custody and Ready.

**Rejected:** Silent undo inside `Update.execute` after A has left Directory.

**Implies:** Simulate/execute report phases so ops know which rollback applies.

#### D7 — One identity, role overlays

**Choice:** Exactly one `Node.make` per `nodeKey` for client-facing construction.
Private dials = `Public.pipe(Address…)`. Edge vs backend A/B =
`Node.config(…, { Listen, As, Active, … })`. Never three `make`s with the same
key; never put A/B on the public make.

**Why:** Owner correction already locked this (HttpApi-shaped). Forged sibling
makes are the identity lie in §2.

**Rejected:** `Worker` / `WorkerA` / `WorkerB` all `make`’d with one key;
`makeDreamNodes` runtime class factories as the app pattern.

**Implies:** `Node.config` must exist (D10) before dream rewrite looks clean.

#### D8 — One worker entry

**Choice:** A single worker program; version/tip from Effect `Config` or argv.
File-swap (if used) replaces that one path. No `worker.v1.ts` / `worker.v2.ts`
twins that only differ by a string.

**Why:** Duplication was a top owner complaint. Real deploys swap an artifact or
image tag, not two near-copy sources in tree.

**Rejected:** Dual source files as the documented dream.

**Implies:** Examples pass `TIP=v1|v2` (or Config) into one entry; tests assert
the active artifact content or config, not which filename loaded.

#### D9 — Policy vs config split

**Choice:** **Policy** = pluggable handlers (Yield, Pick) with Services +
defaults. **Config** = Schema’d dials (`Sticky`, `Verify`, `StreamGap`,
`Conflict` modes, and all Node address knobs) under `LookupConfig` /
`NodeConfig` ambient References.

**Why:** Owner: things that don’t need handlers aren’t policies. HttpApi-ish
handlers only where behavior is invoked; mode enums stay config.

**Rejected:** Everything under `LookupPolicy`; calling Listen/Advertise “policy.”

**Implies:** Tip’s merged Policy bags rename on Eng; Conflict *mode* is config,
Yield *handler* is policy (askIncumbent config selects that Yield runs).

#### D10 — Node.configure + Node.policy

**Choice:**

```ts
Node.configure(MyNode, { listen: "Primary", active: "A" }) // camelCase keys (D21)
Node.policy(MyNode, LookupPolicy.yield("Refuse"), LookupPolicy.pickFirst)
```

Reject product names `withPolicy` / `withConfig` / **`Node.config`** (see D22).
Address widen stays `.pipe(Address.*)`.

**Why:** Owner gave bag + policy split; D21/D22 refine casing and Effect-safe naming.

**Rejected:** Policy as a partial bag of strings only; config as varargs Layers
only; keeping `withPolicy` / `Node.config` as the name.

**Implies:** Merge = last-write per key; lists like `listen: ["A"]` replace, they
don’t union unless we later add explicit add APIs.

#### D11 — Both-ways options

**Choice:** Every mode option ships two equivalent installs:

```ts
LookupPolicy.yield("Refuse")  ≡  LookupPolicy.yieldRefuse
LookupPolicy.pick("First")    ≡  LookupPolicy.pickFirst
```

Reject **boolean** primary (`yield(true)` / `yield(false)`) as the documented API.

**Why:** Owner wanted one policy with options *and* named sugar for everything —
neither form second-class. Booleans are hard to read at call sites.

**Rejected:** Only nested `Yield.Refuse`; only flat sugar; only string helper.

**Implies:** Option strings are PascalCase owned names (`"Accept"`, `"Refuse"`,
`"First"`) to match other mode literals’ dignity; tip’s `"first"` lowercases
normalize on Eng.

#### D12 — Custom Yield on the same helper

**Choice:** `LookupPolicy.yield(myEffect: Effect<boolean>)` is an overload of
the same `yield` helper. No separate product export required; tip `onYield`
can deprecate into this.

**Why:** Keeps one create API (“the API shouldn’t change much”) while allowing
real handlers with `R`.

**Rejected:** A second `handlers.handle("Yield", …)` app surface for v1.

**Implies:** Sugar presets don’t cover custom; custom always goes through
`yield(effect)` (or `Node.policy` with that fragment).

#### D13 — Override precedence

**Choice:** **call-site** (`ListenOptions.onYield`, `lookupClient({ pick })`, …)
**>** **`Node.policy` stamp** **>** **ambient Service default** (Accept / unset
Pick → coldAmbiguous config path).

**Why:** Same ladder tip already uses for yield. Local intent beats node default
beats package default — predictable and loud.

**Rejected:** Ambient always wins; stamp ignores call-site.

**Implies:** Docs show call-site as escape hatch, not the normal way to configure
fleet-wide Yield.

#### D14 — Two install paths

**Choice:** `LookupConfig.provide` / `LookupPolicy.provide` on **layers**
(client, peers, serve composition). `Node.policy` / `Node.config` stamp **made
nodes**. Fragments are the same values; install site differs.

**Why:** Many clients never have a “this Node” to stamp. Forcing
`Node.policy` only would strand `lookupClient`.

**Rejected:** One true install path only on Node; deleting Layer provide.

**Implies:** Provide and stamp both feed the same Services/References; last
writer in the Layer graph still follows Effect Layer rules.

#### D15 — Service backing

**Choice:** Each policy key is a `Context.Service` with a **default Layer**.
Engines `yield* LookupPolicy.Yield` (or Pick) and invoke. Option helpers
`Layer.succeed` / replace that Service.

**Why:** Owner agreed; References-of-Effects don’t grow `R` cleanly. Defaults
mean apps aren’t forced to register handlers for Accept.

**Rejected:** Required HttpApi-style “must handle every policy” with no default;
storing bare Effects in References as the end state.

**Implies:** PolicyBuilder may gain a `.handler` key kind, or Yield/Pick move off
the old Reference builder onto Service factories — Eng detail under this lock.

#### D16 — Proxy Prefer = forward + Active

**Choice:** `NodeConfig.Proxy: "Prefer"` means primary listeners run
`Node.forward` / `forwardAll` toward the **Active** label. Live flip =
`Node.activate(node, label)` (and Update β calls that). Not a client Redirect
SDK; not Advice-as-the-only-flip for β.

**Why:** §4 owner lean. Advice/sticky remain for S6 and non-proxy fleets.

**Rejected:** Proxy as a separate process type with its own make key by default;
client-side redirect API.

**Implies:** Edge role listens Primary only; backends `As` + Listen labels;
Active is runtime state (seeded from config, flipped by activate).

#### D17 — Stream/ref forward before default verify

**Choice:** Public clients on a forwarding edge use **default verify** only after
stream/ref members forward correctly (or verify is taught to skip inert
forward stubs safely). Until then demos may use `verifyOff`, but that is
**not** the dream story or parity gate.

**Why:** Tip forward stubs caused hangs; `verifyOff` papered over it and made
the rejected demo look “done.”

**Rejected:** Shipping dream as verifyOff-forever; weakening global verify
defaults.

**Implies:** Eng stream/ref forward (or verify awareness of forward stubs)
before D5 can go green without verifyOff.

#### D18 — Dream example role

**Choice:** Dream redeploy example = thin composition of D7–D8 + Launcher +
Update β + D5 assertions. **forward-proxy** stays the small in-process substrate
test for forward/activate only. Current tip dream-redeploy stays **rejected**
until rewrite (last in D20).

**Why:** Owner: not clean, not handoff, duplicated. Don’t polish trash.

**Rejected:** Dream as a second forward-proxy with OS spawn bolted on; dream as
Update docs while execute is still S6-only without a β callout.

**Implies:** Docs hub keeps “rejected draft” until D20 step 5.

#### D19 — Plan tags vs serve list

**Choice:** Near term: `steps[].tags` remain but **simulate fails** if they
drift from what the successor process actually serves (when detectable).
Target: infer tags from successor serve registration / node declaration so
apps don’t re-list.

**Why:** §2 failure “tags as plan input.” Infer is right; detection is Eng-able
sooner than full infer.

**Rejected:** Trusting caller tags forever with no check; removing tags before
infer exists (breaks today’s Update).

**Implies:** Contract audit and tag drift are both simulate gates.

#### D20 — Eng order

**Choice:**

1. **D3** S14 filtered rows + handoff peer pick (unblocks D4/D5)
2. **D23** auto **address pool** + optional key-derived **range** + `unixFromKey`
   bind for single primary (unblocks easy β without hand-minted socks / forced A/B names)
3. **D9–D15** + **D21–D22** `LookupConfig` / `NodeConfig` + `Node.configure` /
   `Node.policy` + Service handlers + both-ways + camelCase keys
4. **D24** type-level literal dial overlap (can parallel with 3)
5. **D17** stream/ref forward (unblocks default verify)
6. **D2** Update.execute β (activate + shutdown order)
7. **D18** rewrite dream example last

**Why:** Handoff peer is correctness; auto IPC is the easy bar for β; renaming
before bind still leaves `UnixFromKeyBindPending`. Dream last.

**Rejected:** Dream rewrite first; Update β before handoff peers; big-bang Eng.

#### Dream version (target DX — not Eng’d)

```ts
import * as Address from "hyperlink-ts/Address"
import * as Hyperlink from "hyperlink-ts/Hyperlink"
import * as Launcher from "hyperlink-ts/Launcher"
import * as LookupConfig from "hyperlink-ts/LookupConfig"
import * as LookupPolicy from "hyperlink-ts/LookupPolicy"
import * as Node from "hyperlink-ts/Node"
import * as Update from "hyperlink-ts/Update"
import * as WorkPool from "hyperlink-ts/WorkPool"

class Worker extends Node.make("fleet/Worker", Address.http(":8080")) {}
class WorkerPrivate extends Worker.pipe(
  Address.unix({ A: "/var/run/w.a.sock", B: "/var/run/w.b.sock" }),
)

const edge = Node.configure(WorkerPrivate, {
  listen: "Primary",
  advertise: "Primary",
  proxy: "Prefer",
  active: "A",
})
const backendA = Node.configure(WorkerPrivate, { as: "A", listen: ["A"] })
const backendB = Node.configure(WorkerPrivate, { as: "B", listen: ["B"] })

Node.http(edge, [Node.forwardAll(edge, [Probe, Jobs])])

Node.unix(backendA, [
  WorkPool.serve(Jobs, { effect: () => Effect.void }),
  Hyperlink.serve(Probe, { tip: tipFromConfig }), // "v1" | "v2"
])

Hyperlink.client(Probe, Worker)
Hyperlink.client(Jobs, Worker).pipe(
  LookupConfig.provide(LookupConfig.make({ sticky: true })),
)

Node.policy(backendA, LookupPolicy.yield("Refuse"))

const plan = yield* Update.plan({
  steps: [{
    target: Worker.key,
    successor: { node: backendB, process: childFromActivePath },
  }],
})
yield* Update.simulate(plan)
yield* Update.execute(plan)
// execute β: Launcher.up(B) → Node.shutdown(A) [D3 handoff] → Node.activate(..., "B")
```

**Rejected dream (current tip example):** duplicated v1/v2 workers, `makeDreamNodes`,
manual queue move, `verifyOff` as the story, `withPolicy` fragment soup as SSOT.

### 3.3.2 PolicyBuilder — shared architecture (Eng’d substrate; rename pending)

Both *current* policy modules share one builder kernel — **`hyperlink-ts/PolicyBuilder`**.
Under the §3.3.1 lock, config keys move off “Policy” naming; the builder may stay
for config References and/or shrink to handler-shaped policies only.

**Defaults:** Keys **are** `Context.Reference`s. Ambient defaults are Reference
`defaultValue` — same system as before PolicyBuilder (`yield* LookupPolicy.Sticky` with no
Layer → `true`). Builder `.key(…, { defaultValue })` **is** that Reference option,
not a second defaults mechanism. Fragments / `make` override via Layer. Call-site /
node stamps still win for conflict / yield where they already did.

**Two layers:**

1. **Constructable** (plural) — e.g. `LookupPolicies` / `NodePolicies`. Declare
   **key name + Schema** (+ Reference `defaultValue` / optional `toRuntime`).
   HttpApi-shaped: `make(id).key(…).key(…)` then `class LookupPolicies extends`.
   Derives `Context.Reference` at `` `${id}/${name}` ``.
2. **Module** (singular) — `import * as LookupPolicy` / `NodePolicy`. Re-export
   PascalCase References + recreate camelCase Layer helpers (`sticky`,
   `streamGap`, …) + mode presets. Never a nested `Family` API.

```ts
import * as PolicyBuilder from "hyperlink-ts/PolicyBuilder"
import { Effect, Schema } from "effect"

class LookupPolicies extends PolicyBuilder.make("hyperlink-ts/LookupPolicy")
  .key("Sticky", Schema.Boolean, { defaultValue: () => true })
  .key("Verify", verifySchema, { defaultValue: () => "reject" })
  .key("Yield", yieldSchema, {
    defaultValue: () => Effect.succeed(true),
    toRuntime: (input) =>
      typeof input === "boolean" ? Effect.succeed(input) : input,
  })
{}

export const Sticky = LookupPolicies.Sticky // PascalCase Reference
export const sticky = LookupPolicies.sticky(true) // Uncapitalize("Sticky")
export const verifyOff = LookupPolicies.verify(false)
export const make = LookupPolicies.make
```

| Piece | Role |
|-------|------|
| **`PolicyBuilder.make(id)`** | Empty constructable (HttpApi.`make`) |
| **`.key(name, schema, opts)`** | PascalCase Reference + camelCase Layer method on the Def |
| **`class LookupPolicies` / `NodePolicies`** | Plural constructable (≠ singular module) |
| **`isFragment` / `matchFragment` / `fromConfig` / `toConfig`** | Fragment data sum helpers on the Def |
| **`.make` / `layer` / `provide` / `succeed`** | Branded Layer override toolkit |
| **Module helpers** | Re-export / mode presets over Def camelCase methods |

**Casing:** owned key / `_tag` strings are PascalCase (`"Sticky"`, `"StreamGap"`);
Layer methods are `Uncapitalize(key)` (`sticky`, `streamGap`). Classes / types /
References stay PascalCase.

**Eng’d:** `LookupPolicy` / `LookupPolicies` + `NodePolicy` / `NodePolicies`
+ `Address` factories + `Node.make` pipe + listen-set bind + advertise-set
Directory row + `Node.forward` / `NodePolicy.active` / `Node.activate` (Proxy
Prefer → labeled backend). Apps import singular modules / `Address`, not the
builder. **Update plan API parked.**

**Owner 2026-08-12 — dream-redeploy β rejected.** The rewrite onto
`forward`/`activate` is **not** the product API: duplicated v1/v2 workers +
runtime `makeDreamNodes`, manual A→B `release`/`add` instead of baked
WorkPool handoff, `verifyOff` / direct-Unix plumbing, twin of forward-proxy
rather than an easy compose recipe. Keep **forward-proxy** as the thin
Shape β substrate demo. **Do not** treat `examples/launcher/dream-redeploy*`
as SSOT until rewritten around: one public/private identity, Launcher
custody handoff, WorkPool `releaseEnqueueHandoff` (not a scripted queue
copy), and `Node.activate` — composition that reads like the §3.2 sketch.
Open design: how shutdown handoff finds peer B when Advertise is Primary-only
(S14 multi-row vs explicit peer vs edge-mediated). **Next after lock:** that
rewrite; stream/ref forward + verify; `unixFromKey`; locality Host/Machine.

#### `_tag` — key vs value (Eng’d: **key**)

Effect uses `_tag` for **closed sums**. Context.References stay PascalCase field
identity (`Sticky`). Layer helpers stay camelCase (`sticky` = `Uncapitalize("Sticky")`).
Fragment data uses `_tag` on the key when you need the sum.

```ts
yield* LookupPolicy.Sticky
LookupPolicy.sticky
LookupPolicy.layer(LookupPolicy.sticky, LookupPolicy.streamGap("stall"))
LookupPolicy.make({ Sticky: true, StreamGap: "stall" })
Policy.fromConfig({ Sticky: true })  // → Fragment[]
```

**Eng’d** on `PolicyBuilder` / `LookupPolicy` / `NodePolicy` (refs + camelCase methods + product bag).

### 3.4 Parked — prior long Address API notes

> Former detailed §3.1–3.5 pass. Prefer §3.2–3.3. Kept for reference.

### 3.4.1 `Address.*` factories (parked detail)

Consolidate dial construction under **`hyperlink-ts/Address`** (own subpath). Protocol
helpers + overloads:

```ts
// SKETCH — owner lean
Address.http(":3001")                    // nameless → primary; dial required
Address.unix("A", path)                  // labeled; dial required
Address.ws([4000, 4001])                 // nameless multiples (each primary)
Address.http({ A: 3000, B: 3001 })       // labeled object, same protocol

// Key-derived Unix primary — sentinel value, not a call (no args → no ())
Address.unixFromKey
```

Overload shapes (same idea per protocol — `http` / `ws` / `unix` / …):

| Form | Meaning |
|------|---------|
| Scalar (`":3001"`, port, path) | One **nameless** (= primary) address |
| `(label, dial)` | One **labeled** address (A/B/backend/…) |
| Array | Several **nameless** (= primary) addresses, same protocol |
| Object `{ Label: dial }` | Several **labeled** addresses, same protocol |
| `Address.unixFromKey` | Sentinel: Unix primary dial **from the node key** at bind |

Dial fragments are ports / `":port"` / paths as appropriate — not full `{ kind, url }`
blobs apps hand-assemble today.

**Rejected:**

- Manual `Node.addressFromKey(key, …)` app helper.
- `Address.unix("A")` with no dial (address-less Address).
- Calling `Address.unixFromKey()` — it is a **zero-arg sentinel**, written without `()`.

**Contrast with today’s multi-protocol `endpoints`:** Eng’d X1 is **one dial per protocol
kind** for connect selection. **Locked (2026-08-09):** `Address.*` is the **single**
address list on the Node for new code — it **replaces** `endpoints` / `withProtocol` as
the product surface (same kind, labeled or not, multiple primaries allowed).
`withProtocol` becomes sugar or a migration path onto piping `Address.*`. X1’s “one per
kind” becomes a **Policy default** for client pick, not a hard Node shape limit.

### 3.4.2 Primary vs labeled; no overlapping dials (parked)

**Unnamed addresses are primary addresses.** Primaries are what clients treat as the
default connect surface (Directory / `lookupClient` / advertise — exact wiring TBD).
Labeled addresses (A/B/…) are additional roles for cutover, backends, proxy targets, etc.

**Overlap** means the **same concrete dial** (same bind target: path / host:port / …) —
that is **forbidden**. Identity of an address for uniqueness is the resolved dial, not
the label alone.

**Allowed** (owner — flexibility):

- Two (or more) **primary** addresses of the **same protocol** (different dials) —
  e.g. `Address.http([3000, 3001])` or two nameless Http entries.
- Two addresses with the **same name and protocol** when dials differ — e.g. two
  `Address.http` both labeled `"A"` on different ports. Policy / config decides how
  that is used; the type surface does not collapse them.

```ts
// SKETCH — overlap = dial collision, not (protocol) or (name, protocol)
Address.http([8080, 8081])                 // two primaries, same protocol — OK
Address.http({ A: 3000 }) + Address.http({ A: 3001 }) // same name+protocol, different dials — OK
Address.unix("A", "/tmp/x.sock") twice       // same dial — REJECT
```

### 3.4.3 `Address.unixFromKey` — key-derived primary only (parked)

Owner: key→Unix dial is expressed as the sentinel **`Address.unixFromKey`** (no `()`),
not a missing field and not a function apps pass the key into. At bind, the Node’s key
fills the Unix path (slug / default root / … — implementation detail).

Scope: this is how you opt into a **Unix primary derived from the node key**. Labeled
A/B backends still take **explicit** dials (`Address.unix("A", path)`). Omitting all
addresses may still default somehow (TBD) — prefer making derivation **visible** via the
sentinel rather than silent magic.

```ts
class Worker extends Node.make("fleet/Worker", Address.unixFromKey) {}
// primary Unix path derived from "fleet/Worker"
```

Open: slug rules, directory root Config, Windows named-pipe story — behind bind.

### 3.4.4 `Node.make` — address / address array as second arg; keep pipe + options (parked)

**Arity locked (2026-08-09):** `Node.make(key, Address | Address[], options?)`.

```ts
// SKETCH — locked shape (class extends — not const)
class Worker extends Node.make("fleet/Worker", Address.http(":8080")) {}

class WorkerPorts extends Node.make("fleet/Worker", [
  Address.http(":8080"),
  Address.unix("A", "/var/run/w.a.sock"),
  Address.unix("B", "/var/run/w.b.sock"),
]) {}

class WorkerKey extends Node.make("fleet/Worker", Address.unixFromKey) {}

class WorkerOpts extends Node.make("fleet/Worker", Address.http(":8080"), {
  /* non-address options */
}) {}
```

**Keep the piped form** for widening after the fact. **Owner prefer: pipe `Address.*`
directly** onto the Node — not wrapped in `Node.withAddresses([…])`:

```ts
// Preferred — public class, then private dials via Public.pipe (HttpApi-shaped)
class Worker extends Node.make("fleet/Worker", Address.http(":8080")) {}
class WorkerPrivate extends Worker.pipe(
  Address.unix({ A: "/var/run/w.a.sock", B: "/var/run/w.b.sock" }),
) {}
```

Do **not** put A/B private addresses on the public `Node.make`. `Address` values are
pipeable fragments. A `withAddresses` bag remains optional sugar at most — **not** the
preferred DX.

`…rest` args for addresses were considered; owner expects we **still have uses for an
options arg**, so don’t make the signature rest-only.

### 3.4.5 Address policies — define knobs, then defaults (parked)

**API surface lives in §3.3** (`NodePolicy.primaryAddress` / `listen` / `advertise` /
`proxy` / `as` + `NodePolicy.make`). Dial / claim / yield stay on **`LookupPolicy`**.
This subsection keeps rationale + example matrix.

Address = identity + optional label + dial. **Unlabeled ≠ primary** until
`PrimaryAddress` says so (default `"AllUnlabeled"`). **NodePolicy** decides what
*this process* does with each address. Prefer / sticky / stream-gap stay on
**LookupPolicy** — not restart options, not NodePolicy.

**Owner (2026-08-09):** do **not** invent a default like “labeled sit idle” before the
policy surface exists. If an address is on the Node, the obvious assumption is you meant
to use it — especially for listen. Define the knobs first; pick defaults second.

**Owner (2026-08-10):** separate module **`NodePolicy`**; rename vague **Role** →
**`as`**. **Agent 5 call:** Eng’d `Policy` → **`LookupPolicy`** (not `ClientPolicy` —
names the Lookup/Directory job; pairs `Lookup`↔`LookupPolicy`, `Node`↔`NodePolicy`).

Owned mode strings are PascalCase. `"Primary"` on Listen/Advertise means the
`PrimaryAddress` set.

#### Example configurations

| Intent | PrimaryAddress | Listen | Advertise | Proxy / as |
|--------|----------------|--------|-----------|------------|
| Serve everything declared | `AllUnlabeled` | `All` | `Primary` | — |
| Stable front, A/B backends (§4 β) | `AllUnlabeled` | `All` | `Primary` | `Prefer`; `as("A"\|"B")` on backends |
| This box is A only | `AllUnlabeled` | `["A"]` | `Primary` | `as("A")` |
| Multi-primary edge (2× unlabeled Http) | `AllUnlabeled` | `All` | `Primary` | — |

Directory today: **one row per `nodeKey`**. May need to grow for proxy/backends — open.

---

## 4. Pivot lean — static main as proxy (owner leaning)

Two cutover shapes on the table:

### Shape α — dual public dials (today’s Eng’d trajectory)

Clients learn A’s Http, then B’s Http (same `nodeKey`, dial-replace + sticky + prefer).
**No stable URL** across the update. Dream file-swap still needs a second port/`nodeB`.

### Shape β — stable primary + proxy to A/B (**owner lean**)

```
clients ──Http──►  primary (proxy / stable address)
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
       A (Unix)                B (Unix)
```

- **Primary** address(es) stay fixed (often Http). Clients never rebind for a binary update.
- **Proxy** behavior is **Node policy** (§3.5): primaries forward to the live labeled
  backend (A or B). Other configs remain valid — Address does not force proxy-only.
- **Proxy owner** (Lookup-adjacent, Launcher-owned, or a small Node role — TBD).
- **Backend hop** may use a **different protocol** than primary (Http out front, Unix to
  the real process) for cheap local forwarding and exclusive-bind clarity.
- Update = bring up B on its labeled address → retarget policy/proxy to B → drain/shutdown A.
  Clients keep dialing primary.

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
// Eng'd — hyperlink-ts/Update
const plan = yield* Update.plan({
  // fleet-wide — not a single A→B forgery
  steps: [/* ordered node updates */],
  contracts: [/* from→to version audit — §5.3 */],
})

// inspect / gate / audit
yield* Update.simulate(plan) // plan-value gate — §5.4
yield* Update.execute(plan)  // real cutover (re-runs gate)
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

### 5.4 Simulate / mock test-run helper (+ backup builds)

Owner: provide a helper that **runs a full mock of the setup and runs the update on it** —
a test-run before production execute.

- Node under test should run **like production** (real serve/listen/Directory/WorkPool
  handoff paths). If you write proper tests you already do that; Update should add
  **tools to simulate an update** so the extra work is small.
- Today’s Eng’d `Update.simulate(plan)` is a **plan-value gate** (shape / contracts /
  blockers) — not the full mock. Productize the dream-redeploy spirit as Update test
  utilities, not a one-off example script.
- **Backup builds (owner 2026-08-09):** improve simulation with tools that **back up
  builds** so you keep a **real incumbent artifact** to run the upgrade against (not a
  hand-rolled fake binary). Upgrade simulation = boot backup build as A → apply plan to
  new build as B → assert — then tear down. Exact API (snapshot dir, content-addressed
  stash, CI cache hook) TBD; belongs with Update test/simulate tooling, not Address.

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

### 7.5 `Node.Service` → `Node.Service` — corrected sync (Agent 5, 2026-08-08)

**Earlier Agent 5 note was stale.** On current `integration` tip, the rename **did** land
via Agent G’s `a3831b5f` (*Effect v4 Tag→Service across last-ts and hyperlink-ts*), then
G tip-synced (`1b8ab7c6`). Public factory is **`Node.Service()`** — not `Node.Service()`.

| Surface | Tip now |
|---------|---------|
| `Node.Service()` | Public factory — class-extends declaration |
| Under the hood | Still **`Context.Service`** (node *is* a Context key; `yield* Worker`) |
| HyperService mints | Also `*.Service` after the same rename (was `*.Tag`) |
| Old baked `*.Service` (Tag+layer) | Renamed **`*.define`** in that refactor |
| Effect v4 | Context keys are `Context.Service` |

**Owner poke answered:** Tag **was** replaced with Service on tip — Agent 5’s branch had
just been behind G’s merge when we first checked.

**Still open with `Node.make`:** Service today still smashes **description + Context key**
together. HttpApi/`Router.make` keep those jobs split:

| Name | Role if we split cleanly |
|------|---------------------------|
| `Node.make` | Description / config holder (HttpApi-like) — **not** Context |
| `Node.Service` | Context projection you `yield*` / dial — **is** Context (today = both) |

### 7.6 Sync with Agent G — what Agent 5 sees (2026-08-08)

Pulled G’s run + tip. **No written reply** to §7.6 ask yet; mechanical tip-sync only.

| G fact | Detail |
|--------|--------|
| Status | IDLE · branch `cursor/file-router-prototype-125f` · tip-synced into `integration` |
| Tag→Service | Eng’d (`a3831b5f`) — includes `Node.Service`; on tip |
| Router | **HttpApi lock** — `Router.make` / `Router.group` / `RouterBuilder` ([`router-httpapi-lock.md`](./router-httpapi-lock.md)) |
| Page | `Page.static` / `Page.dynamic` / `Page.Request` / `Page.Document` — **not** `Page.Tag` / `Page.make` locked; `Page.build` owner-snapped earlier |
| View | Still `View.Service` (Context key + props); deeper redesign parked |
| Sync reply to A5 | **None** on Node.make vs Service split / Page naming |

**Still asking G (unchanged):** when Page gets a class mint, is it catalog `Page.make`
(HttpApi-like) or Context `Page.Service`? That should match Node’s make vs Service split.

### 7.7 `Node.make` — HttpApi-shaped declaration (design)

**Today:** `Node.Service()` is description **and** Context key — `yield* Worker` resolves
transport; address stamped via `assembleNode`.

```ts
// Eng'd on tip
class Worker extends Node.Service<Worker>()("fleet/Worker", {
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
// SKETCH — class extends Node.make; pipe Address.* (§3)
class Worker extends Node.make("fleet/Worker", Address.http(":8080")).pipe(
  Address.unix("A", "/var/run/w.a.sock"),
  Address.unix("B", "/var/run/w.b.sock"),
) {}

// runtime still needs a serve/listen/launch edge — Context bind may remain
// *derived* from the description, or a separate Node.service / launch binder
```

| | Today `Node.Service()` | Target `Node.make` (sketch) |
|--|----------------------|----------------------------|
| Kind | Context key + address blob | Config/description (HttpApi-like) |
| `class extends` | Yes | Yes (`makeProto` / constructable) |
| `yield* Worker` | Transport service | Keep via `Node.Service` bind, or only after install |
| Address | On the Service class | On the description; main vs additional |
| Locality | — | `Node.Host` / `Node.Machine` lists these makes |
| Prototype | `Node.Prototype` + `.make` for clones | Fold into `Node.make` / instance helpers? |

**Open forks inside this shift:**

1. Does `Node.make` become primary declaration with `Service` as Context projection only?
2. Keep `yield* Node` for transport after bind?
3. Catalog type param `ROut` — on make, `.serves(…)`, or elsewhere?
4. Align with Agent G `Router.make` / Page mint (§7.6) — G has not answered yet.

**Closest Eng’d cousin today:** `Node.Prototype` + `.make(instanceKey, address)` — instance
clones, not HttpApi catalog. `Router.make` (G) is the catalog precedent.

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
8. Directory advertise — primaries only vs primaries+backends vs proxy row.
9. ~~Type model — `Address.*` vs `endpoints` / `withProtocol`~~ — **locked: Address.*
   replaces** for new code; `withProtocol` → sugar/migrate; one-per-kind = Policy default.
10. ~~HyperServices “primary view” / labeled-idle default~~ — **rejected**. Policy knobs
    first (listen / advertise / dial / proxy / role), **then** defaults (§3.5).
11. ~~Manual `addressFromKey`~~ / ~~address-less Address~~ — **rejected**.
    **`Address.unixFromKey`** sentinel (no `()`) — **lean** (§3.3).
12. ~~Where `Address` lives~~ — **locked: `hyperlink-ts/Address`** (own subpath).
12b. ~~`Node.make` arity~~ — **locked: `(key, Address|Address[], options?)`** (§3.4).
12c. Multi-primary client pick — Policy default when several primaries exist.
12d. Same label+protocol, different dials — how Policy names/disambiguates them.
12e. ~~`withAddresses` wrapper~~ — **prefer pipe `Address.*` directly** (§3.4);
    `withAddresses` at most optional sugar.

### Deploy / locality / Node.make
13. **Locality name** — `Host` vs `Machine` vs `Locale` / `Island`; nest as `Node.*` (§7.3–7.4).
14. **Keep Launcher** + locality under Node vs merge spawn into locality agent (§7.3).
15. **`Node.make` vs today’s dual-duty `Node.Service`** — split description vs Context (§7.5–7.7).
16. Does `yield* Worker` survive make, or description-only until bind?
17. Webhook / pull / package push — first deployable slice.
18. Cutover module name (`Update` vs `Rollout` / …) vs locality name.
19. Deprecation path for Eng’d `restartSuccessor` + dream-redeploy; migrate examples off dual-duty Service if `make` lands.

---

## 9. Current Eng’d facts (do not confuse with desired)

| Fact | Where |
|------|--------|
| One primary `(kind, url\|path)` + optional per-kind `endpoints` | `Node.Service` / `withProtocol` |
| Directory: one dial row per `nodeKey` | `DirectoryEntry` |
| App A/B today = same key, new dial, sticky + prefer | `restartSuccessor`, Policy |
| Lookup A/B = one address, orchestrated ownership | `Lookup.follow` |
| Schema tips / upcast | `Versioned` |
| Impact dry-run (single target) | `Lookup.planUpdate` |
| Spine α spawn-and-exit | `Launcher` |
| `Update.plan` → simulate → execute Eng’d; dream A/B + proxy-as-main still design | `hyperlink-ts/Update` |
| No `Address.*` factories / role address list / proxy-as-main | — |
| Manual `addressFromKey` / address-less Address | **rejected** |
| `Address.unixFromKey` sentinel / primary=unnamed / dial-overlap rules | **design lean** (§3) |
| Backup-build simulate tooling | **design lean** (§5.4) — not Eng’d |

---

## 10. Next

1. Confirm **Address + NodePolicy API** (§3.3) — `as` / value spaces / defaults.
2. Locality word + `Node.make` vs `Service`.
3. ~~`PolicyBuilder` kernel + refactor Eng’d `Policy` onto it~~ — **Eng’d**.
4. ~~Address / NodePolicy / listen-set bind / forward+Active (β substrate)~~ **Eng’d**. Directory still one advertise row (correct for β primary-only).
5. Update plan API — **parked** (owner not sold); do not Eng until ready.
6. Dream-redeploy example → rewrite onto `Node.make` + `forward` + `activate` (no second public dial).
7. `unixFromKey` slug/root Config; multi-row Directory (S14); locality Host/Machine.
