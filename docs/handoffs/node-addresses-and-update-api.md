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
bar set by `Policy.make` / `Node.withProtocol` (typed fragments you compose, not a restart
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
| **LookupPolicy** | Lookup / Directory participation (today’s Eng’d `Policy`): sticky, verify, stream-gap, pick, conflict, yield. |
| **Key-derived Unix** | `Address.unixFromKey` — Unix primary from node key (no manual path helper). |
| **One list** | Replaces today’s `endpoints` / `withProtocol` for new code. |

Cutover shapes (stable front+A/B, dual-public replace, split A/B processes) are
**NodePolicy + deploy** on top of this list — not separate address models. Update API
stayed parked.

### 3.3 API (sketch)

Two policy modules — different jobs. **Locked (Agent 5 call):** rename Eng’d
`hyperlink-ts/Policy` → **`hyperlink-ts/LookupPolicy`** when `NodePolicy` Engs (same
change set — no long-lived ambiguous `Policy`). Not `ClientPolicy`: “client” is vague
and undersells Directory claim/yield.

| Module | Owns |
|--------|------|
| **`hyperlink-ts/LookupPolicy`** | How Lookup / Directory participation behaves (today’s Eng’d `Policy`): dial (`Sticky`, `Verify`, `StreamGap`, `Pick`, `ColdAmbiguous`) **and** claim / yield (`Conflict`, `Yield`) |
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
NodePolicy.listen("all")                    // | "primary" | ReadonlyArray<label>
NodePolicy.advertise("primary")             // | "all" | ReadonlyArray<label>
NodePolicy.proxy("prefer")                  // primary forwards → live labeled (Advice)
NodePolicy.as("A")                          // this OS process is the "A" side

NodePolicy.make({
  Listen: "all",
  Advertise: "primary",
  Proxy: "prefer",
  As: "A",
})

// LookupPolicy — provide on lookupClient / follow / membership, not on Node.make
LookupPolicy.make({ Sticky: true, Verify: "reject" })

// ── Node.make + pipe Address.* + pipe NodePolicy.* ─────────────────
class Worker extends Node.make("fleet/Worker", Address.http(":8080")).pipe(
  Address.unix("A", "/var/run/w.a.sock"),
  Address.unix("B", "/var/run/w.b.sock"),
  NodePolicy.proxy("prefer"),
) {}

// Split deploy: this box only runs the A addresses
class WorkerA extends Node.make("fleet/Worker", [
  Address.http(":8080"),
  Address.unix("A", "/var/run/w.a.sock"),
  Address.unix("B", "/var/run/w.b.sock"),
]).pipe(
  NodePolicy.as("A"),
  NodePolicy.listen(["A"]),
) {}

class Local extends Node.make("fleet/Local", Address.unixFromKey) {}

class DualHttp extends Node.make("fleet/Edge", [
  Address.http(":8080"),
  Address.http(":8081"),
]).pipe(
  NodePolicy.advertise("all"),              // publish both primaries
) {}
// multi-primary pick → LookupPolicy.pick / ColdAmbiguous, not NodePolicy
```

**Defaults (candidate):** listen **all** declared; advertise **primaries**; no proxy; no
`as`. Overlap = same concrete dial → reject.

| Knob | Meaning |
|------|---------|
| **Listen** | Which declared addresses this process **binds** |
| **Advertise** | Which land in **Directory** (what clients can discover) |
| **Proxy** | Primary **forwards** to the live labeled side (e.g. Advice prefer) |
| **As** | This OS process **is** labeled side `"A"` / `"B"` (not a vague “role”) |

**Why not `Role`:** “role” reads like RBAC / job title. The question is only: *which
labeled address side is this process?* → `NodePolicy.as("A")`.

**Why no Dial on NodePolicy:** participants dial what Directory advertises; soft-pick /
sticky / wait-advice stay on **`LookupPolicy`**. One dial story, not two.

### 3.3.1 PolicyBuilder — shared architecture (locked)

Both policy modules share one builder kernel — **`hyperlink-ts/PolicyBuilder`**.

**Defaults:** Policies **are** `Context.Reference`s. Ambient defaults are Reference
`defaultValue` — same system as before PolicyBuilder (`yield* Policy.Sticky` with no
Layer → `true`). Builder `.key(…, { defaultValue })` **is** that Reference option,
not a second defaults mechanism. Fragments / `make` override via Layer. Call-site /
node stamps still win for conflict / yield where they already did.

**Two layers:**

1. **Constructable** (private name, e.g. `Keys`) — declare **key name + Schema**
   (+ Reference `defaultValue` / optional `toRuntime`). HttpApi-shaped:
   `make(id).key(…).key(…)` then `class Keys extends`. Derives
   `Context.Reference` at `` `${id}/${name}` ``. **Do not** name the class the
   same as the public module namespace.
2. **Module** (`import * as LookupPolicy`) — re-export PascalCase References +
   recreate camelCase Layer helpers (`sticky`, `streamGap`, …) + mode presets
   (`verifyOff`, `askIncumbent`, …). Never a nested `Family` API.

```ts
import * as PolicyBuilder from "hyperlink-ts/PolicyBuilder"
import { Effect, Schema } from "effect"

// constructable ≠ module name
class Keys extends PolicyBuilder.make("hyperlink-ts/LookupPolicy")
  .key("Sticky", Schema.Boolean, { defaultValue: () => true })
  .key("Verify", verifySchema, { defaultValue: () => "reject" })
  .key("Yield", yieldSchema, {
    defaultValue: () => Effect.succeed(true),
    toRuntime: (input) =>
      typeof input === "boolean" ? Effect.succeed(input) : input,
  })
{}

export const Sticky = Keys.Sticky                              // Reference
export const sticky = Keys.succeed({ _tag: "Sticky", value: true }) // Layer
export const verifyOff = Keys.succeed({ _tag: "Verify", value: false })
export const make = Keys.make
```

| Piece | Role |
|-------|------|
| **`PolicyBuilder.make(id)`** | Empty constructable (HttpApi.`make`) |
| **`.key(name, schema, opts)`** | Adds PascalCase Reference on the Def |
| **`class Keys extends`** | Private constructable (≠ module namespace) |
| **`$is` / `$match` / `$fromConfig` / `$toConfig`** | Fragment data sum helpers on the Def |
| **`.make` / `layer` / `provide` / `succeed`** | Branded Layer override toolkit |
| **Module helpers** | camelCase Layers + mode presets — hand-written DX |

**Eng’d today:** private `Keys` inside `Policy` + PascalCase refs + camelCase
helpers. **Next:** Eng `NodePolicy` the same way; rename `Policy` → `LookupPolicy`.

Apps normally import **`LookupPolicy` / `NodePolicy`**, not the builder.

#### `_tag` — key vs value (Eng’d: **key**)

Effect uses `_tag` for **closed sums**. Context.References stay PascalCase field
identity (`Sticky`). Layer helpers stay camelCase (`sticky`). Fragment data uses
`_tag` on the key when you need the sum.

```ts
yield* Policy.Sticky
Policy.sticky
Policy.layer(Policy.sticky, Policy.streamGap("stall"))
Policy.make({ Sticky: true, StreamGap: "stall" })
Policy.$fromConfig({ Sticky: true })  // → Fragment[]
```

**Eng’d** on `PolicyBuilder` / `Policy` (refs + camelCase helpers + product bag).

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
// SKETCH — preferred pipe (still class extends)
class Worker extends Node.make("fleet/Worker", Address.http(":8080")).pipe(
  Address.unix("A", "/var/run/w.a.sock"),
  Address.unix("B", "/var/run/w.b.sock"),
) {}
```

`Address` values are pipeable fragments. A `withAddresses` bag remains optional sugar at
most — **not** the preferred DX.

`…rest` args for addresses were considered; owner expects we **still have uses for an
options arg**, so don’t make the signature rest-only.

### 3.4.5 Address policies — define knobs, then defaults (parked)

**API surface lives in §3.3** (`NodePolicy.listen` / `advertise` / `proxy` / `as` +
`NodePolicy.make`). Dial / claim / yield stay on **`LookupPolicy`** (rename of Eng’d
`Policy`). This subsection keeps rationale + example matrix.

Address marks **identity + primary (unnamed) vs labeled + dial**. That is description
only. **NodePolicy** decides what *this process* does with each address. Prefer /
sticky / stream-gap stay on **LookupPolicy** — not restart options, not NodePolicy.

**Owner (2026-08-09):** do **not** invent a default like “labeled sit idle” before the
policy surface exists. If an address is on the Node, the obvious assumption is you meant
to use it — especially for listen. Define the knobs first; pick defaults second.

**Owner (2026-08-10):** separate module **`NodePolicy`**; rename vague **Role** →
**`as`**. **Agent 5 call:** Eng’d `Policy` → **`LookupPolicy`** (not `ClientPolicy` —
names the Lookup/Directory job; pairs `Lookup`↔`LookupPolicy`, `Node`↔`NodePolicy`).

Primary vs labeled is an input to those knobs (advertise defaults toward primaries;
proxy often primary→labeled), not a hidden “don’t listen” flag.

#### Example configurations (not defaults yet)

| Intent | Listen | Advertise | Proxy / as | Client dial |
|--------|--------|-----------|------------|-------------|
| Serve everything declared | all | primaries | — | Directory primaries |
| Stable primary, A/B backends (§4 β) | primary + live side | primary | proxy prefer; as = A or B on backends | primary |
| This box is A only | `["A"]` | primary (and/or A) | `as("A")` | primary |
| Multi-primary edge | all primaries | all primaries | — | `LookupPolicy.pick` / ColdAmbiguous |

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
4. Eng Address + Node.make + `NodePolicy` **and** rename `Policy` → `LookupPolicy` (same cut).
5. Update dream / backup-build simulate — **later**.
6. Dream-redeploy stays **provisional** until address/make exists.
