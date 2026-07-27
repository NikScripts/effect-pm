# Owner decisions log

**Supervisor SSOT for architecture/scope steers from owner chat.** Agents append on the same push as the work that implements the decision.

Format: see [`supervisor-protocol.md`](./supervisor-protocol.md) § Owner decisions.

---

## 2026-07-22 — Rename: drop `@nikscripts` scope (publish `hyperlink-ts`)

- **Owner said:** “@nikscripts we don’t need to keep”
- **Chose (LOCKED):** npm package is bare **`hyperlink-ts`** — no `@nikscripts/` scope.
  Brand/module rename SSOT remains [`rename-hyperlink-handoff.md`](./rename-hyperlink-handoff.md)
  (`Hyperlink` → `Hyperlink`, brand “Effect Hyperlink”).
- **Still open:** `effect-hyperlink` signpost vs unpublish; GitHub repo rename; docs domain.
- **Supervisor impact:** Eng must retarget `package.json` name + imports + wire ids off
  `hyperlink-ts`.

## 2026-07-21 — Identity coordinator (managers collapse) LOCKED

- **Owner said:** Sell the dream; “Oooh yes. Let’s build it.” Handoff first as the major goal.
- **Chose (LOCKED — M1–M6):** No `Hyperlink.Manager`. Exclusive brain = `Hyperlink.identity` (S1). Pattern = one brain + many hands (directory / nameless / Prototype). v1 Eng = **identity liveness** (dead winner → claim replaceable) + **coordinator+workers example**. Placement advice streams into Lookup = later slice (still no Manager type). Sugar last.
- **Rejected / deferred:** Second first-wins product surface; required `manages[]` value list; advice wire before liveness.
- **Supervisor impact:** SSOT [`identity-coordinator.md`](./identity-coordinator.md). Work branch `cursor/logs-store-followers-plan-906e` synced with `integration`.

## 2026-07-21 — Placement advice (M5) LOCKED + Eng’d

- **Owner said:** “Let’s do it” (after M4 tip).
- **Chose (LOCKED + Eng):**
  - `Lookup.Advice` — `advise` / `clear` / `preferred`; helpers `Lookup.advise` / `clearAdvice` / `preferred`.
  - Key = `resourceKey` → preferred directory `nodeKey`; in-memory **last-write-wins**; no advisor ACL.
  - Stale prefer (not in `nodesServing`) ignored; `lookupClient` honors live prefer **before** D4 `{ pick }`.
  - Algorithms stay app-owned (identity Router decides prefer).
- **Supervisor impact:** Eng on tip. SSOT [`identity-coordinator.md`](./identity-coordinator.md).

## 2026-07-21 — Identity coordinator sugar (M6) Eng’d

- **Owner said:** “Keep it up” (after M5 tip).
- **Chose (Eng):** Recipe guide [`docs/guides/identity-coordinator.md`](../guides/identity-coordinator.md); lean helpers `Lookup.prefer` / `preferEntry`; clearer `IdentitySelfRequired` message; **no** magic baked into protocol listens (Lookup stays pipe-only).
- **Supervisor impact:** Identity coordinator v1 (M1–M6) complete on tip.

## 2026-07-21 — Unlock Soft fail-loud + default-on verify + contractHash + memo

- **Owner said:** “All of them in whatever order” (after unlock menu).
- **Chose:** Eng in order Soft fail-loud → default-on verify → F4 contractHash → store-layer lineId memo.
- **Supervisor impact:** Soft + default-on verify + F4 `contractHash` Eng’d; store-layer lineId memo next.

## 2026-07-21 — F4 contractHash Eng’d

- **Owner said:** “All of them” (unlock wave).
- **Chose (LOCKED + Eng’d):** `contractHash` on `NodeStatus.resources[]`; `Hyperlink.contractHash(tag)`; deep verify + tag-aware default-on client compare → `ContractMismatch`. Nested verify opted out for Lookup.client / identity ping / `clientLayerForEndpoint` (Layer.unwrap deadlock).
- **Supervisor impact:** loud-failures F4 closed; memo remains.

## 2026-07-21 — Store-layer `(scopeKey, lineId)` memo Eng’d

- **Owner said:** “All of them” (unlock wave).
- **Chose (LOCKED + Eng’d):** Durable tails seed the in-memory lineId claim from `_logs.read` at layer acquire; rematerialize/restart does not double-append. Unrelated to `memoizedAt` handle cache.
- **Supervisor impact:** Soft / verify / F4 / memo unlock wave complete.

## 2026-07-21 — Protocol listen siblings stay in sync

- **Owner said:** Document the pattern and link it so `Prototype.listen` and `unix` / `http` / `ws` / `nPipe` stay aligned.
- **Chose:** SSOT section [Protocol listen siblings](./node-catalog-and-discovery.md#protocol-listen-siblings-keep-in-sync) — Lookup pipe-only, shared options, Prototype dispatches to the four protocol listens; Eng updates all siblings together.
- **Supervisor impact:** Cross-links from `Node` / Prototype TSDoc + examples README.

## 2026-07-21 — Lookup `layer` / `layerOptions` (Effect `layerAgent` shape)

- **Owner said:** Prefer Effect-consistent naming; avoid `local` / `bootstrap`; can `Lookup.layer` work with no `()`?; what would Effect do?
- **Chose (LOCKED + Eng):**
  - `Lookup.layer` — **Layer value** (bind-or-dial {@link defaultIpcPath}); `Layer.provide(Lookup.layer)`.
  - `Lookup.layerOptions({ path?, unlink? })` — options factory (Effect `layerAgentOptions`).
  - `Lookup.layerNode(node)` — exclusive serve on addressed asLookup-branded node (was `Lookup.layer(node)`).
  - `Lookup.clientOptions({ path? })` — dial default path (was `clientDefaultLocal`).
  - **Removed (no shim):** `bootstrapDefaultLocal`, `layerDefaultLocal`, `clientDefaultLocal`.
- **Not chosen:** Repo-wide rename of every `layer(…)` factory — Effect uses both value and function forms; only zero-config defaults become Layer values.
- **Supervisor impact:** Eng on tip. SSOT: [`node-catalog-and-discovery.md`](./node-catalog-and-discovery.md).

## 2026-07-20 — Node module extract LOCKED + Eng

- **Owner said:** Extract Node from Resource/Lookup on tip (`cursor/bake-catalog-thoughts-906e`); Effect-true `import * as Node`; no shims; forms replace spawn demo.
- **Chose (LOCKED):**
  - Public module **`hyperlink-ts/Node`** — flat `Tag` / `Prototype` / `Lookup` / `listen` / `connect*` / `*Server` / `clients` + catalog types.
  - **Removed:** `Hyperlink.Node`, `Lookup.LookupNode`, `Hyperlink.listen` / `connect*` / `httpServer` / `wsServer` / `ipcServer` / `clientsFor` (no shims).
  - **Stays Resource:** Tag/serve/layer/client, `lookupClient`, identity, nodes/andNode/distributed, peers, Spec builders; Tag Lookup dial is `Hyperlink.unix(tag)` (was `discoverClient`).
  - **Stays Lookup:** Identity, Directory, layer, client, `layerOptions`; sugar `Node.listenLocal`.
- **Supervisor impact:** Eng on tip. SSOT: [`node-catalog-and-discovery.md`](./node-catalog-and-discovery.md).

## 2026-07-19 — D4 soft pick LOCKED (`lookupClient` `{ pick }`)

- **Owner said:** “Good” (to lean A after D4 bake).
- **Chose (LOCKED):**
  - Opt-in **`Hyperlink.lookupClient(Tag, { pick })`** — `"first"` or sync `(rows) => DirectoryEntry`.
  - Bare `lookupClient(Tag)` stays **fail-closed** on 0 / >1.
  - Identity resolve hit ignores `pick`; `client(Tag)` stays set-of-one.
  - Out of v1: `"random"`, Effect picker, sticky affinity, manager LB.
- **Supervisor impact:** Eng on tip. SSOT: [`node-catalog-and-discovery.md`](./node-catalog-and-discovery.md).

## 2026-07-19 — `Prototype.listen(serves)` factory LOCKED

- **Owner said:** Rewrite `Hyperlink.listen(Proto.instance(…), serves)` into curried `Proto.listen(serves)` → `(suffix?) => Layer`; agreed lean (Layer-only, keep `instance()`, no named-clone `.listen`) — “Good.”
- **Chose (LOCKED):**
  - `Node.Prototype.listen(serves[, options])` → `(suffix?: string) => Layer` — sugar over `Hyperlink.listen(instance(suffix), serves)`.
  - Return **Layer only**; minted Node available as `ListenNode` after `Layer.build`.
  - **`instance()` stays public**; named clones keep `Hyperlink.listen(East, serves)`.
- **Supervisor impact:** Eng on tip. SSOT: [`node-catalog-and-discovery.md`](./node-catalog-and-discovery.md).

## 2026-07-19 — `lookupClient` name (= bake `unsafeLookupClient`)

- **Owner said:** The Lookup-or-die nodeless client was sketched as `unsafeLookupClient`; keep without `unsafe` if docs are clear — agent’s call.
- **Chose (LOCKED):** Keep **`Hyperlink.lookupClient`**. Same contract as the sketch: Lookup resolves the dial target; missing/ambiguous → fail (`LookupClientError`); not a silent N&gt;1 pick. TSDoc + handoff state the rename from `unsafeLookupClient`. Soft multi-replica pick remains **D4 OPEN**.
- **Supervisor impact:** Docs/TSDoc clarify on tip. SSOT: [`node-catalog-and-discovery.md`](./node-catalog-and-discovery.md).

## 2026-07-19 — `Hyperlink.Node.Prototype` (nest under Node)

- **Owner said:** Top-level `Hyperlink.Prototype` is wrong if it’s a Node — expected `Hyperlink.Node.Prototype`.
- **Chose:** Prototype is a **Node kind** — `Hyperlink.Node.Prototype` (+ `.make` / `.instance`). Top-level `Hyperlink.Prototype` removed (no shim).
- **Supervisor impact:** Rename on tip. SSOT: [`node-catalog-and-discovery.md`](./node-catalog-and-discovery.md).

## 2026-07-19 — Dynamic `Node.Prototype.instance` LOCKED

- **Owner said:** “Continue” (after D3).
- **Chose (LOCKED):**
  - `Node.Prototype.instance()` / `instance(suffix)` → Node for `listen` (value, not class ctor).
  - Wire key `prototypeKey#suffix`; omitted suffix minted at listen; always ephemeral ipc path.
  - **No** `Identity.claim` (many winners); directory advertise + `livenessReplace` on dupe `nodeKey`.
  - Multi-instance client picker stays **D4 OPEN** (`lookupClient` fail-closed on ambiguous).
- **Still LEAN / later:** ~~`askIncumbent`~~ → Eng’d; D4 picker/LB; ~~X1 multi-protocol~~ → Eng’d.
- **Supervisor impact:** Eng on tip. SSOT: [`node-catalog-and-discovery.md`](./node-catalog-and-discovery.md).

## 2026-07-19 — D3 LOCKED (bare `distributed` / directory-backed peers)

- **Owner said:** “Okay” (proceed with recommended next slice after D7).
- **Chose (LOCKED — D3):**
  - Bare `.pipe(Hyperlink.distributed)` ≡ `nodes([])` (discoverable empty membership); identity-shaped pipe (not a list dual).
  - Fixed fleets stay on `Hyperlink.nodes([…])` (former `distributed([…])` call sites migrated).
  - `peersLayer` with a **stamped empty** Node set reads Lookup `Directory.nodesServing(tag.key)` at build; exclude self; dial by directory entry kind (ipc path / url).
  - Undeclared tags (no `nodesSym`) stay empty static peers — not directory.
  - Directory absent → soft empty peer map (provide Lookup client for a real mesh).
- **Still LEAN / later:** `askIncumbent`; ~~dynamic `instance`~~ → **LOCKED**; D4 picker/LB.
- **Supervisor impact:** Eng on tip. SSOT: [`node-catalog-and-discovery.md`](./node-catalog-and-discovery.md).

## 2026-07-19 — D7 vertical LOCKED (address-less / bootstrap / lookupClient)

- **Owner said:** Nail goal APIs; drop `{ self }` (treat like any Node); `Prototype.make` → **class**; “if questions need context/code, else build.”
- **Chose (LOCKED — D7 vertical):**
  - Address-less `Node(key)` at `listen` → mint ephemeral **ipc** path; **claim `node.key`**; win → bind+advertise; lose → fail Layer (winner endpoint in error); no silent double-serve.
  - Identity claim endpoint = **Tag’s bound Node** (`nodes` / `{ node }`) or **listen’s Node** (minted) — **remove `{ self }` bag**.
  - `Lookup.layerOptions` — bind-or-dial default ipc (OS exclusivity).
  - `Hyperlink.lookupClient(Tag)` — fail-closed; `Identity.resolve` then `Directory.nodesServing`; 0 or >1 → typed error.
  - `Node.Prototype.make(name, addr)` returns a **constructible** (`class East extends Proto.make(...) {}`); wire key `prototypeKey#name`.
- **Still LEAN / later:** ~~bare `distributed` / D3~~ → **LOCKED** (see D3 entry); `askIncumbent`; ~~dynamic `instance`~~ → **LOCKED**; D4 picker/LB.
- **Supervisor impact:** Eng unlocked on tip for this vertical. SSOT: [`node-catalog-and-discovery.md`](./node-catalog-and-discovery.md).

## 2026-07-19 — Phase-3 directory slice LOCKED + Eng unlocked

- **Owner said:** “lol yes” to write leans then lock subset + unlock smallest Eng (advertise/list, unregister, `livenessReplace`).
- **Chose (LOCKED — directory slice):**
  - **D5:** Node directory on the **same Lookup server** as `Identity.claim`, **separate RPCs**.
  - **D6:** Duplicate `nodeKey` → default **`livenessReplace`**; **unregister** on clean listen close; **`serves[]` from listen** serve list.
  - **D2:** Conflict probe = existing **NodeStatus `ping`** (timeout ⇒ dead); no v1 heartbeats.
- **Still LEAN:** `askIncumbent` handoff preset; dynamic `instance` / `NodeServer` name sugar. (D3/D7 Eng’d — see later entries.)
- **Rejected / deferred:** Separate discovery process; default `lastWins` orphan; http default Lookup v1.
- **Supervisor impact:** Eng unlocked on tip for Lookup directory + listen advertise/unregister wiring. SSOT: [`node-catalog-and-discovery.md`](./node-catalog-and-discovery.md).

## 2026-07-19 — Phase-3 discovery / prototype bake (LEAN — owner agreed)

- **Owner said:** Bake Phase 3 with details/code; clarify claim vs directory; first-wins already shipped for identity; duplicate advertise / handoff presets; agree leans; write to handoff as LEAN.
- **Chose (LEAN):** Prototype / `make(name, addr)` / `NodeServer<N>`; bare `distributed` ≡ `nodes([])`; address-less non-proto via claim; ipc default only; etc. (see catalog handoff Phase-3 bake).
- **Supervisor impact:** Superseded in part by directory LOCKED entry above; prototype Eng still gated on LEAN.

## 2026-07-19 — Catalog C2 / C3 / C4 locked (continue bake)

- **Owner said:** Continue (after C5); prior steers — full `ROut`; `import type` to avoid Tag↔Node cycles; C2 lean keep `*Server` + `listen`.
- **Chose:** **C2** = `listen` proves catalog then dispatches to kept `httpServer`/`wsServer`/`ipcServer`; http/ws bind still caller-provided. **C3** = full `ROut` required. **C4** = `import type` for `ROut`.
- **Rejected / deferred:** Replacing `*Server`; partial catalogs; cross-package Tag value→Node for `ROut`.
- **Supervisor impact:** Eng shipped on tip — `Node<Self, ROut>`, `listen`, `clients` (was `clientsFor`).

## 2026-07-19 — Serve-list naming C5 (one name: `serve`)

- **Owner said:** Want one name — `server`, `expose`, or something else; choose well; follow v4 and standards.
- **Chose (C5 LOCKED):** **`serve`** only (`Hyperlink.serve` / engine `*.serve`). Reject `expose` (alias or rename). Reject using `server` as the verb (collides with `httpServer` / `wsServer` / `ipcServer` / Effect `RpcServer`). `serveRemote` remains the served-only sibling on the four-verb axis.
- **Rejected / deferred:** `expose`; dual spellings; renaming transport `*Server` helpers.
- **Supervisor impact:** Catalog/`listen` sketches use `serve` layers only; no rename Eng.

## 2026-07-19 — Tag Node sets C1 (Option B)

- **Owner said:** Lean B; identity/distributed multi disabled; asked what distributed buys; failover if identity unreachable; `andNode(Node)` vs `nodes([Node])`; then “Locked.”
- **Chose (C1 LOCKED):** One Node set on the handle; `nodes([...])` overwrite + `andNode(node)` append; `{ node }` ≡ set-of-one; `client(Tag)` when size === 1; `distributed` alias; identity multi-set forbidden; identity dial-fail does **not** try other nodes; pipe mutates (copy-on-pipe deferred). See [`node-catalog-and-discovery.md`](./node-catalog-and-discovery.md) C1.
- **Rejected / deferred:** Privileged home Node; identity→fleet failover; multi-node client try-next / LB (later); copy-on-pipe (later).
- **Supervisor impact:** C1 Eng unlocked on tip; C2–C5 still OPEN.

## 2026-07-18 — Identity pipe S1 (“good enough for now”)

- **Owner said:** Pipe on any resource/process constructor (don’t need Singleton ctor); maybe better name; layer vs handle footgun; agent recs; “Good enough for now.”
- **Chose (S1 LOCKED):** `Hyperlink.identity` pipe on toolkit Tags; stamp on handle; `layer`/`serve` honor claim→serve-or-client; no layer-only primary; fail-closed if Lookup down; self endpoint at layer v1; optional Singleton sugar only. See [`node-catalog-and-discovery.md`](./node-catalog-and-discovery.md) S1.
- **Rejected / deferred:** Layer-only identity flag as main API; always-lookup on every non-identity serve; Manager Eng before identity pipe; orphan-serve default.
- **Supervisor impact:** Identity Eng shipped on tip (`Hyperlink.identity` + layer/serve claim-or-client + `IdentityMultiNode` one-Node rule). Next bake: **C1**.

## 2026-07-21 — X1 multi-protocol Eng’d + verifyConnection deep classification

- **Owner said:** “Do it” (docs truth for X1 + `verifyConnection` RPC ping over `selectEndpoint`).
- **Chose (X1 LOCKED + Eng’d; verify D1–D5 LOCKED + Eng’d):** Multi-protocol endpoint set already on tip; catalog/handoff flipped OPEN → Eng’d. `verifyConnection({ deep: true })` dials `NodeStatus` after tier-1 reachability; errors `ProtocolUnanswered` / `ServiceNotServed` / `ServiceNotReady`; default endpoint = `selectEndpoint`; `{ all: true }` optional; `deep` defaults off; no `contractHash`.
- **Rejected / deferred:** Changing tier-1 default behaviour; contract-shape digest.
- **Supervisor impact:** SSOT [`multi-protocol-nodes.md`](./multi-protocol-nodes.md) + [`verify-connection-classification.md`](./verify-connection-classification.md).

## 2026-07-18 — ProtocolKind tag rename (X5)

- **Owner said:** Fix the kind strings; multi-protocol Nodes whenever it best fits later.
- **Chose (X5 LOCKED):** `ProtocolKind = "Http" | "WebSocket" | "IpcSocket"`. Eng rename on tip. Multi-protocol (X1) was deferred then — **now Eng’d** (see 2026-07-21).
- **Rejected / deferred:** Keeping lowercase `"http"|"socket"|"ipc"`; Effect’s `Websocket` spelling (owner: `WebSocket`); multi-protocol in this change.
- **Supervisor impact:** Breaking kind-string rename; apps that wrote explicit `kind: "socket"` etc. must update.

## 2026-07-18 — Lookup bootstrap L1 locked; identity Eng unlocked

- **Owner said:** Tiered lookup — safest split-brain = OS bind on-box; explicit where defaults impossible; “Let’s go.”
- **Chose (L1 LOCKED):** Same-machine default via well-known local bind (OS exclusivity); cross-network **no** self-elect — explicit `LookupNode`. Failover re-elect out of v1. Dial-fail serve policy still open. See [`node-catalog-and-discovery.md`](./node-catalog-and-discovery.md) L1.
- **Eng unlocked:** First slice — `Lookup` module (LookupNode, default-local ipc, identity claim first-wins / Duplicate + original). Singleton layer-swap / nodeless client / manager streams still bake or follow-on Eng.
- **Rejected / deferred:** Cross-network elect; seamless lookup failover in v1.
- **Supervisor impact:** Identity lookup Eng on tip; C* still OPEN.

## 2026-07-18 — Catalog bake in progress (thoughts, not locks)

- **Owner said:** One idea at a time; note discussions as thoughts; be careful what is actually locked. C1 chat: Tags can carry node sets; class-extends-pipe; overwrite/add helpers; no “home”; managers-as-Resources under rethink vs DNS/lookup self-election; `serve`→`expose` asked; no Protocol type param on Node (value is SSOT).
- **Chose:** At time of entry, nothing beyond I1–I5 locked. **Superseded same day by L1 lock** (above). C1 and most bake thoughts remain unlocked.
- **Rejected / deferred:** Treating manager / `nodes` API sketches as Eng-ready; Protocol as Node type param (do not re-propose).
- **Supervisor impact:** Was continue bake; now L1 Eng unlocked.

## 2026-07-18 — IPC Unix socket Phase 1 + bake sessions

- **Owner said:** Build IPC first; then lock plan/API details; bring back bake sessions.
- **Chose:** Ship `"ipc"` ProtocolKind + `{ path }` Node address + `ipcServer` / `connectIpc` / `protocolIpc` / `ipcClient` (Unix-only v1; unlink before bind + on close). Phase 1 decisions I1–I5 locked in [`node-catalog-and-discovery.md`](./node-catalog-and-discovery.md). Remaining catalog/discovery locks (C*/D*) via **bake sessions**.
- **Rejected / deferred:** Overloading `"socket"` for UDS; Windows named pipes in v1; catalog/`ROut`/discovery in this slice.
- **Supervisor impact:** IPC Eng on tip; next = bake C1–C5 before catalog Eng.

## 2026-07-18 — Node catalog (`ROut`) + discovery (design direction)

- **Owner said:** Node should take optional `ROut` (union of resource handles); serve/listen validates catalog at compile time; type-only imports avoid bundling contracts; same-machine discovery (esp. Unix sockets) so peers share catalogs without stamping Node on every Tag; document it; this is the next library step for seamless cross-runtime. Product rename away from “Resource” parked.
- **Chose (design only):** Living design [`node-catalog-and-discovery.md`](./node-catalog-and-discovery.md) — `Node<Self, ROut = never>`, nodeless Tags by default, `listen` / `clientsFor` / local discovery; peers = topology (static `distributed` **or** discovery) + per-Node catalog. Clarified: shipped Node never had definition-time resource list — catalog is new, not a restore. **Update:** Phase 1 IPC Eng unlocked/shipped same day.
- **Rejected / deferred:** multi-protocol Node endpoints; becoming Cluster membership/rebalance.
- **Supervisor impact:** Design handoff on bus; IPC first; catalog Eng after bake locks.

## 2026-07-16 — Impossible-states plan: assigned + area reserved (breaking OK)

- **Owner said:** "Make it impossible to do the wrong thing." Breaking changes are fine. "I want you working on it, keep the other agents away." (Later: unlock P4 + expand the reservation to the tag-config schema-input surface.)
- **Progress:** **P1 DONE** (node value wrapped → node↔protocol wiring bug is a compile error, cast-free — merged). **P5 DONE** (http client transport dies in a browser, not just warns — merged). **P2 SKIPPED** (a clean version needs a documented cast — the `makeNode` logs/address-type complexity, same wall as the reverted `connectFleet` — for a narrow win the runtime `UnaddressedNode` throw already covers). **P4 ALREADY ENFORCED** (loose-fields payload shorthand is already rejected — `{ payload: Schema.Struct }` required; proposal mis-scoped it as new work). **P3 friction** (serve-time mismatch): `serverImpl` sees opaque serve layers → coupled, deferred. **Program's achievable clean items = COMPLETE (P1 + P5).**
- **Reserved — hands off (all other agents, incl. C):** `src/Hyperlink.ts` node/client typing — `NodeKey`/`AnyNode`/`AddressedNode`/`makeNode`/`connect*`/`clientLayer`/`socketClient`/`verifyConnection`/`protocolHttp` + `NodeStatus` wiring, until the branches are all merged (done). **Tag-config reservation RELEASED** — P4 was already enforced, so Agent D's queue/run/process payload-config is unblocked again.
- **Rejected / deferred:** `connectFleet` (reverted — cast-free version not reachable given node-type complexity; not worth casts for sugar). P2 (cast). P3 (opaque serve layers). P4 (already done).
- **Supervisor impact:** impossible-states clean wins (P1, P5) merged. Agent D queue payload-config UNBLOCKED (P4 was moot).

## 2026-07-16 — No Em Dash + No AI Fingerprints; lean Creating a Resource

- **Owner said:** Research sounding less like AI (verbosity, em dashes); then do the small plan.
- **Chose:** Additive Documentation rules *No Em Dash* (must) and *No AI Fingerprints* (should). Rewrite Creating a Resource lean against them. Corpus-wide dash sweep later.
- **Rejected / deferred:** Full book voice pass; deleting older Narrative rules.
- **Supervisor impact:** Agent 1; sync to `integration`.

## 2026-07-15 — Tutorials & Documentation goals (add alongside, don't replace)

- **Owner said:** Integrate the nine narrative goals into standards; undo the earlier rewrite; talk first; start small — add rules, keep existing Narrative rules.
- **Chose:** Append *The Spine* … *Sharp Edges, In Place* under Narrative docs in [`documentation.md`](../standards/documentation.md). Keep Show don't tell / glossary / capitalize / verified / handoff. No narrative page rewrites in this step.
- **Rejected / deferred:** Replacing existing rules; upgrading Introduction / Creating a Resource until a later agreed pass.
- **Supervisor impact:** Agent 1; sync to `integration`.

## 2026-07-15 — Examples book priority (over legacy recipe ports)

- **Owner said:** Pair every example file with a near-identical Twoslash doc; hub page in sidebar only; example docs grouped by module with `#` anchors; Agent 1 chooses priority vs legacy.
- **Chose:** **Examples book first** ([`agent-01-examples-book.md`](./agent-01-examples-book.md)). Do **not** promote `toolkit-by-example` to Guides. Forms batch first; site glob + hide example docs from “More” = Agent B note.
- **Rejected / deferred:** Full own-page port of toolkit-by-example; pairing every tui/web file in E1; remaining legacy narrative ports as the headline track.
- **Supervisor impact:** Agent 1 executes E0/E1 on `cursor/docs-corpus-phase3-ce05`; B gets requirements note for content glob + More filter.

## 2026-07-15 — Task Agent 3: storage cutover follow-through

- **Owner said:** Task Agent 3 (after Soft edge-case pass on #62).
- **Chose:** Unlock [`agent-03-storage-cutover-followthrough.md`](./agent-03-storage-cutover-followthrough.md) slices **S1→S3** — inventory/TSDoc+plan ripple, example teachability, **untyped WorkPool Soft SQLite/sibling parity**. Queue/Run Soft guards already on #62 tip — do not redo. Plan-first first reply still required.
- **Rejected / deferred for Agent 3:** fail-loud Soft die on Node-logs-only / unregistered engine; reopen #62 API; memo; handles; docs-site.
- **Supervisor impact:** Agent 3 active; Manager/keeps #62 Eng.

---

## 2026-07-15 — Storage soft-default: bake Memory (R fulfilled); override via provide

- **Owner said:** Everything is supposed to have in-memory storage baked in; R is fulfilled but you can override and provide. Requiring Storage in R is unacceptable.
- **Chose:** `Store.withDefaultStorage` on toolkit `layer`/`serve`/`serveRemote` — Soft unwrap: no ambient `Storage` → `layerDefaultMemory` (**R fulfilled**); ambient AppStore via `Layer.provide`/`provideMerge` into the toolkit layer → capture that store (incl. SQLite). `*Memory` = aliases. Sibling `Layer.merge` does not override.
- **Rejected:** “require Storage in R / soft-default only via `*Memory`” (earlier #62 cut was wrong for DX).
- **Supervisor impact:** Correct #62 tip; Agent 3 follow-through still inventory/examples/Queue parity against bake+override guide.

---

## 2026-07-15 — Storage correctness: do it all (Effect-true Storage requirement)

- **Owner said:** Pick the order; do the whole storage-correctness plan; Effect way; show everything in chat.
- **Chose (superseded same day):** Toolkit `layer`/`serve`/`serveRemote` **require** `Store.Storage`; soft-default only via `*Memory`. Root cause of SQLite silence: shared in-memory `EventJournal` made memory "override" look real while SQLite stayed empty. **Superseded by** bake+override decision above.
- **Rejected / deferred:** store memo; Agent D handles; docs-site; Postgres.
- **Supervisor impact:** Manager Eng; Agent 3 free for follow-through when PR lands.

---

## 2026-07-14 — Storage correctness (can’t get Store wrong)

- **Owner said:** Focus on making sure you can’t get storage wrong (broader than child-runtime Logs alone). Build a plan.
- **Chose:** Living plan [`docs/plans/storage-correctness.md`](../plans/storage-correctness.md) + Agent 3 brief [`agent-03-storage-correctness.md`](./agent-03-storage-correctness.md). Thesis: fail-loud composition; silent empty / split-brain journals are the enemy. Phases A (stores guide + provideMerge recipe) → B (hard guards) → C (one bus/journal per Node) → D (query key hygiene). Child-runtime Logs inherit folded into Phase C.
- **Rejected / deferred this track:** store-layer lineId memo; assigning handles/site to Agent 3.
- **Supervisor impact:** Agent 3 plan-first on storage correctness; unlock Phase A and/or B before code.

---
## 2026-07-15 — Phase 3 unlock (legacy → live book + Draft)

- **Owner said:** “Go” on Phase 3 after FleetHealth landed; sync integration; ignore effect β98 fallout (Agent C).
- **Chose:** Content-side Draft convention (`status="draft"` + `{.draft}` callout; no site chrome); inventory in [`agent-01-docs-corpus-phase3-plan.md`](./agent-01-docs-corpus-phase3-plan.md); first port = fill `docs/guides/stores.md`; archive `beta-15-to-17` + `CODEBASE-INVENTORY`; keep `STORAGE.md` as agent SSOT with consumer pointer.
- **Rejected / deferred:** Batch Z deletes; STORAGE rewrite; site Draft badges; toolkit-by-example / processes ports (next batches).
- **Supervisor impact:** Branch `cursor/docs-corpus-phase3-ce05`.

## 2026-07-15 — FleetHealth landed on `integration`

- **Owner said:** Add any final improvements and sync with integration.
- **Chose:** Merge `cursor/fleet-health-ce05` (#60) onto `integration` (incl. type-shape tests, api-model regen after `api.json` → `api-model.json` rename, guide/example polish).
- **Rejected / deferred:** Phase 3 start until explicit unlock; Batch Z deletes; `layerNoop` until a concrete package ambient needs it; `docs/site` chrome.
- **Supervisor impact:** Agent 1 next = Phase 3 (owner unlock). FleetHealth guide + `hyperlink-ts/FleetHealth` are living SSOT.

## 2026-07-14 — FleetHealth (meshed stadium-board readiness)

- **Owner said:** Cost worth it if it fits Effect; then build. Fleet health product locked earlier (fleet board, not Host; auth stays README-only).
- **Chose:** `hyperlink-ts/FleetHealth` as Telemetry twin — leaf `local`, fleet `byNode` / `status`, Schema `Reachable` | `Unreachable` via `Exit.match`, `MultiNode.combineByNodeExit` keeps peer failures. Local `/health` / `withReadiness` unchanged (standards).
- **Rejected:** Folding peers inside `withReadiness`; silent omit of down peers (metric-style `fleetHealth` helper).
- **Supervisor impact:** Branch `cursor/fleet-health-ce05`; roadmap bullet marked shipped.
## 2026-07-14 — `Logs.byResource` full key; kill resource-identity `*Id`

- **Owner said:** Scope identity is **key** + **kind** (`Hyperlink.kindOf`); get rid of `processId`/`queueId` costumes; exception only for Effect RPC naming (`groupId`); no legacy storage to keep; do it now.
- **Chose:** `Logs.byResource(tag | key)` hard-break; remove log annotation `processId`/`queueId` + helpers; CLI match via `LogEntry.hasKey`; Daemon/Queue event + durable-queue resource identity fields → `key`; keep `groupId`.
- **Rejected / deferred:** store memo; Agent D handles; `docs/site`; Daemon.events further Eng.
- **Supervisor impact:** Agent 3 Eng on `cursor/logs-byresource-full-key-a009`.
- **Superseded (2026-07-27):** the “keep `groupId`” RPC exception — see next row.

## 2026-07-27 — Wire groups: tag key vs kind key; drop public `groupId`

- **Owner said:** Don’t conflate regular RPC groups with shared-Spec families. Regular group = tag key. Shared Spec family = kind key (hide via factory, Effect-style). Remove unused/redundant `groupId`. Never teach `"queue"` as a wire key. Only share Specs that are actually identical (control fragments / ApiMetrics / Schedule — not full WorkPool item plane).
- **Chose:** Plan [`wire-groups-and-identity.md`](../plans/wire-groups-and-identity.md) — W0 locked; Eng W1+ (solo drop `groupId`, delete unused family path after migrate, then real kind-keyed factory when needed).
- **Rejected:** Kind as RpcGroup prefix for regular Tags; spec-hash as group name; public `wireMode` on every tag; forcing full WorkPool/Daemon/Gate Specs onto one kind-group without a control/data split.
- **Supervisor impact:** Agent 4 owns W1+ on `cursor/hyperservice-open-deps-5679`.
- **Eng note (2026-07-27):** W1 landed — public `HyperlinkTag.groupId` removed; `wireKeySym` / `wireKeyOf`; solo wire = `.key`; `DuplicateWireKey`; `ServedHyperlink.wireKey`; contract descriptor field `wireKey`.
- **Eng note (2026-07-27, W2):** Unused shared-Spec family path **deleted** (`tagFor` / `serveInstances` / `clientInstances` / `instance` + factory types / family errors) after migrating tests/examples to solo `Tag`. No demotion/shim — migrate then delete.

## 2026-07-27 — W3 Family surface REJECTED; never push `integration` without authorization

- **Owner said:** Do not ship `Hyperlink.Family` / `serveFamily` / `serveFamilyRemote` / `clientFamily` / `member` (or any new serve/client surface invented for kind-keyed wire). Plan said factory **name TBD**. Never push `integration` without explicit owner authorization. Force-reset tip to pre-incident state.
- **Chose / done:** Agent 4 had Eng’d that surface (`90479552`) and tip-synced it to `integration` without authorization — **process failure**. Owner ordered full reverse: force-reset `cursor/hyperservice-open-deps-5679` and `integration` to **`5a0b42d5`** (W2 tip; Family never on tip). Incident write-up: [`agent-04-w3-incident-2026-07-27.md`](./agent-04-w3-incident-2026-07-27.md).
- **Rejected:** Public `*Family*` APIs; treating tip-sync language as blanket `integration` push rights; Eng’ing W3 before locking mint shape / ApiMetrics–Gate relationship.
- **Standing rule:** Agent 4 (and all agents) push **work branch only** unless owner explicitly authorizes an `integration` push.
- **Design (unlocked, discussion only):** Prefer shared Spec via `Hyperlink.Tag(wireKey, spec)` → `Factory<Self>()(instanceKey)` (class-only), not a new noun; no new serve/client verbs; explore API handle + reserved features nest (metrics) instead of sibling ApiMetrics tag / `httpApiClientService` product name. See incident handoff.

## 2026-07-27 — W3 Eng: shared Spec via `Tag(wireKey, spec)` (not Family)

- **Owner said:** Skip metrics for now. Document everything. Build the shared-Spec feature (the one metrics would use), demo it, tests/examples/docs — then stop and wait. Return to `.handle` rename later.
- **Chose / Eng’d:** `Hyperlink.Tag(wireKey, spec)` → `Factory<Self>()(instanceKey)` (class-only, Effect-shaped `()`). Internal `sharedTagSym`; ordinary `serve` / `serveRemote` / `client` merge by wire key and route on header `key`. Errors: `DuplicateSharedInstance`, `SharedRoutingError`. Demo: `examples/forms/hyperlink/shared-tag-wire.ts`. **ApiMetrics not migrated.**
- **Rejected (still):** `Family` / `serveFamily` / `clientFamily` / `member`; pushing `integration` without explicit OK.
- **Paused next:** ApiMetrics/Gate product shape. (`.handle` rename → Eng’d as `default`/`defaults`; see below.)
- **Supervisor impact:** Agent 4 on `cursor/hyperservice-open-deps-5679` only — wait for owner before metrics / `integration`.

## 2026-07-27 — Service shapes: `default` / `defaults` names LOCKED

- **Owner said (bake):** `default` = single fields in contracts; `defaults` = piped bag to add multiple. (Batteries/Effect-defaults vibe; reject `handle` as the noun.)
- **Chose / LOCKED:** `Hyperlink.default(…)` Spec leaf; `Hyperlink.defaults({…})` pipe adornment. Prior Jul 26 design (Spec builders-only, bag merge, Effect overrides, new key after construction, Prototype lean) still holds; only the public names change from placeholder `handle`.
- **Rejected:** Public `Hyperlink.handle` for this API.
- **Still open (at bake):** `default` payload shape vs shipped `pure`; Eng slice order; Prototype mint.

## 2026-07-27 — Fleet rate limiting before ApiMetrics / HttpApiClient reshape

- **Owner said:** Getting rid of ApiMetrics by combining into HttpApi Gate; all Gates should use rate limiting; fleet rate limiting is more important than an ApiMetrics migrate slice — bake limiter into the updated HttpApiClient.
- **Chose (direction):** Research Effect `RateLimiter` + proposal [`../plans/fleet-rate-limiting.md`](../plans/fleet-rate-limiting.md). Eng order lean: Gate `rateLimit` substrate (shared store) → observe nest → HttpApiClient Tag (local routes) → absorb ApiMetrics. Not a standalone ApiMetrics migration.
- **Chose (LOCKED — store wiring):** Presence-driven like WorkPool durability — `serviceOption(RateLimiterStore)` (layer is the switch). Soft **memory** when absent (single-node OK). Provide Redis (or later SQL) at the root for fleet; no config flag for “which store.”
- **Chose (R1 Eng lean):** Gate default `onExceeded: "delay"`; whole-gate key = resource id; nest name lean `observe` (R2).
- **Chose (R3 Eng):** WorkPool matches Gate presence-driven store (no auto Soft layer merge that blocked Redis). Fleet verified with shared memory store in CI; Redis recipe in guides. Soft + multi-node = docs warning (N× limit), not fail-loud.
- **Chose (bake 2026-07-27 — nest name):** Wire nest is **`metrics`** (not `observe` / `limit`). Covers absorbed ApiMetrics usage + rate-limit remaining/exceeded. WorkPool parity. Factory lean: `Gate.HttpApiClient` Tag + app-owned `static layer = Gate.httpApiClientLayer(Tag)` (no baked Service layer).
- **Chose (bake 2026-07-27 — nest shape):** v1 **flat siblings** under `metrics` (`usage`, window stream, `remaining`, `resetAfter`, `exceeded`, …). Limiter fields only when `rateLimit` is set. Optional static sugar (`Github.metrics…`) always available.
- **Chose (bake 2026-07-27 — collision escape):** **Rename** via const `metricsKey` (default `"metrics"`). Fail-loud if an HttpApi group id equals the chosen key. Cost is low when `metricsKey` is a const generic / const config literal (typed nest path); avoid free `string`. Static sugar optional and can follow the same key. No separate `metricsSurface: "static"` in v1.
- **Chose (bake 2026-07-27 — rateLimit keying):** v1 **whole-client only**. Service key (Tag id) and **rate-limit bucket key are separate fields**. `rateLimit.key` **optional — omit inherits service key**; set explicitly to share/split fleet budgets. Stable metadata exposes both (`key` / Tag id + resolved `rateLimitKey`) plus `metricsKey`. Nest holds live data only. Per-route keys later.
- **Chose (bake 2026-07-27 — adaptive 429):** **Opt-in in R4** (Effect `adaptiveConsume` / feedback). Default off / absent — fixed `rateLimit` policy alone is enough to ship the Tag reshape.
- **Chose (bake 2026-07-27 — R2 ordinary Gate):** Light **`metrics` nest on ordinary Gates when `rateLimit` is set** — limiter live fields (`remaining` / `resetAfter` / `exceeded`) + stable metadata (`rateLimitKey`, `metricsKey`). No HTTP usage registry on ordinary Gates. HttpApi R4 adds usage/windows on the same nest.
- **Chose (LOCKED + Eng’d — R3b live Redis):** Fleet store v1 = Effect **Redis only** (`NodeRedis.layer` + `RateLimiter.layerStoreRedis`). Live proof: Gate + WorkPool shared Redis budget, **child-process peer** consume, plus Effect `Persistence.layerRedis` / `PersistedQueue.layerStoreRedis` smokes (`test/rate-limit-redis.test.ts`, `test/effect-redis-stores.test.ts`). Optional peer `ioredis`. Compose: `docker-compose.redis.yml`. SQL RateLimiterStore deferred.
- **Chose (Eng’d — R2 ordinary Gate metrics):** Wire nest always present as **`metrics`** with limiter live fields (`remaining` / `resetAfter` / `exceeded`); updates when `rateLimit` set. Stable Tag metadata via `Gate.rateLimitKeyOf` / `Gate.metricsKeyOf` (not under nest path). No HTTP usage registry on ordinary Gates.
- **Chose (Eng’d — R4 HttpApiClient):** `Gate.HttpApiClient` Tag + app-owned `Gate.httpApiClientLayer(Tag, runtime)`; nest `metrics` with limiter fields + `usage` / `windows`; const `metricsKey` escape + `MetricsKeyCollision`; whole-client `rateLimit` (key inherits Tag id). Sibling `ApiMetrics` deprecated. Legacy `httpApiClient` / `httpApiClientService` / `httpApiClientLayerEffect` kept for migration (`httpApiClientLayer` now = Tag layer).
- **Chose (Eng’d — R4 adaptive 429):** Opt-in `adaptive: true | { key? }` on HttpApiClient mint; requires `rateLimit` (`AdaptiveRequiresRateLimit` otherwise). `adaptiveConsume` before round-trip + `adaptiveFeedback` on response; key default `upstream:{host}` from layer `baseUrl`; `Retry-After` delta-seconds only in v1.

## 2026-07-27 — Retire `Hyperlink.pure`; Eng `default` / `defaults`

- **Owner said:** Pure was never supposed to be the long-term API; if `default`/`defaults` exist that is the same job — retire `pure`, build it right (refinement + docs), ask only when blocked.
- **Chose / Eng’d:** `Hyperlink.default(value)` (literal or sync fn; Promise-returning fn type-errors) + `Hyperlink.defaults({…})` pipe (bag on Tag via `DefaultsOf`). **Follow-up Eng’d (construction adornments A1–A2):** `defaults` widens `Service` / `yield* Tag` with the bag via internal `remapTagService` (`as unknown as` + `Service`/`Effect` intersection — not a `HyperlinkTag` `Svc` rebuild through `.pipe`, which recurses on class `Self`); guarded by `test/defaults-handle.test-d.ts`; `WithDefaults` kept as escape/migration. Spec∩bag → `DuplicateDefaultKey`. Layer/serve accept `ImplWithDefaultOverrides`. `Hyperlink.pure` / `PureMethod` removed (major).
- **Rejected:** Keeping `pure` as an alias or shim; two-step Prototype mint as the product API.
- **Still open:** optional A3 `{ defaults }` factory sugar.
- **Supervisor impact:** Record in [`service-shapes.md`](../plans/service-shapes.md).

## 2026-07-27 — Park/reject live plain `cell`; tip-sync construction adornments

- **Owner said:** “Go” on tip-sync A1–A2 + park `cell` (lean: tip-sync → park `cell` → idle).
- **Chose / LOCKED:** No Spec builder for live plain `A` (`cell` / `live` / `state`). Dashboards use `ref` (Subscribable) + host adapters. Construction adornments A1–A2 tip-synced to `integration`.
- **Rejected:** Eng’ing a push-cell Spec leaf; keeping `cell` as an open bake item.
- **Still open:** optional A3 factory `{ defaults }` sugar; optional fleet R5.
- **Supervisor impact:** Agent 4 idle pending owner pick (A3 / R5 / new track).

---

## 2026-07-14 — Phase 2 execute (P1–P4) + roadmap locks

- **Owner said:** Scrub living cites of anything under `docs/legacy/**`. Confirm fleet health as the health roadmap item; Resource-RPC auth = README-only (A). Agree `docs/plans/` home, archive hybrid, refresh treeshaking.
- **Chose:** Create `docs/plans/` (README + treeshaking refresh + weighted-middle + non-serializable items). Delete `docs/legacy/plans/`. Archive hybrid RuntimeStorage design. Roadmap: **fleet health** (per-node shipped; fleet aggregate open); **auth** stays a bullet with no stub file.
- **Rejected:** Host health wording; rewriting hybrid under Store; auth stub file; leaving a “see legacy” stub.
- **Supervisor impact:** Branch `cursor/docs-corpus-phase2-plan-ce05`. Phase 3 still owner-gated.

---

## 2026-07-14 — Phase 1 Batch E design-lock + Phase 2 plan unlock

- **Owner said:** “Next” after #54/#55 land — continue corpus.
- **Chose (Batch E):** Keep `*-decisions.md` + store-cutover SSOTs **flat at handoffs root** (no `decisions/` folder). Archive closed Agent 3 followers/tail plans + not-approved `store-layer-query` under `archive/2026-07/`. `queue-persistence-design` stays as historical SSOT; `queue-nonserializable-items` waits for Phase 2 move to `docs/plans/`.
- **Chose (Phase 2):** Plan-first only — [`agent-01-docs-corpus-phase2-plan.md`](./agent-01-docs-corpus-phase2-plan.md). Proposed home = **`docs/plans/`**; no mass moves until owner unlocks P1–P4.
- **Rejected / deferred:** Batch Z deletes; relocating STORAGE-cited cutover files; implementing roadmap features.
- **Supervisor impact:** Branch `cursor/docs-corpus-phase2-plan-ce05`.

---

## 2026-07-14 — Storage correctness (can’t get Store wrong)

- **Owner said:** Focus on making sure you can’t get storage wrong (broader than child-runtime Logs alone). Build a plan.
- **Chose:** Living plan [`docs/plans/storage-correctness.md`](../plans/storage-correctness.md) + Agent 3 brief [`agent-03-storage-correctness.md`](./agent-03-storage-correctness.md). Thesis: fail-loud composition; silent empty / split-brain journals are the enemy. Phases A (stores guide + provideMerge recipe) → B (hard guards) → C (one bus/journal per Node) → D (query key hygiene). Child-runtime Logs inherit folded into Phase C.
- **Rejected / deferred this track:** store-layer lineId memo; assigning handles/site to Agent 3.
- **Supervisor impact:** Agent 3 plan-first on storage correctness; unlock Phase A and/or B before code.

---

## 2026-07-14 — Phase 1 handoffs archive batches A–D (“do it all”)

- **Owner said:** Unlock Phase 1 execution — do the archive batches (archive-first). Close what we can from open-asks in the same pass.
- **Chose:** `git mv` batches **B/C/D** → `docs/handoffs/archive/2026-07/{agents,features,reports}/`; keep `reports/README` as index; rewrite legacy/AGENTS/status ripples. Date stack **A** already closed (complete→delete); leftover beta22 handoff deleted. Type hygiene [#54](https://github.com/NikScripts/effect-pm/pull/54) landed with archive [#55](https://github.com/NikScripts/effect-pm/pull/55). Open-asks: widget seam closed (Agent C registry on `integration`); hoist docs shipped in `per-hyperlink-dependencies` + standards; `layerNoop` stays parked until a concrete package-owned ambient needs it.
- **Rejected / deferred:** Batch **E** (`decisions/` / moving store-cutover SSOTs); batch **Z** deletes; Phases 2–3.
- **Supervisor impact:** Both PRs on `integration`. Root handoffs ≈ live bus + SSOTs + deferred edge cases only.

---

## 2026-07-14 — Daemon live `events` + Agent 3 ready perfection (close-out)

- **Owner said:** Ship Daemon live `events` (persist == stream); then Logs lineage append; then remote proof; then “go once ready perfection.”
- **Chose:** Failure surface = store union on the live stream (`Started` | `Completed` | `Failed` | `Interrupted`); PubSub-then-store publish order; remote HTTP proof (#51) over lazy-PubSub / Effect-returning `Daemon.make`; close superseded plan/brief PRs (#35/#46).
- **Rejected / deferred:** named handles (Agent D); `docs/site` UI; store-layer `(scopeKey, lineId)` memo; wire-level persist==stream dual-reader tests; further Daemon.events Eng this track.
- **Supervisor impact:** Agent 3 Eng tracks closed on `integration` (#47/#48/#51). Optional docs merge: Logs guide #50. Handoff status: [`agent-status.md`](./agent-status.md).

---

## 2026-07-11 — Queue wire erase + Daemon live `events` (retroactive — from PR #19/#20 handoff)

*Logged by supervisor from Agent 2 session-4 handoff + owner relay. Agent should have written this before PRs opened.*

- **Owner said:** Fix Queue `events` stream typing (agent was copying Queue pattern for Daemon); align Daemon failure visibility with Queue's live stream model.
- **Chose (initial):** Phase 1 — type the **RPC wire** (`queueSpec` / `buildDaemonSpec` pass tag `success`/`error`); add Daemon **`events`** PubSub stream; failures on **`events` + store**, not void lifecycle RPC `error`.
- **Rejected:** Per-tag `processSpec` rebuild for `start`/`stop`/`runImmediately` RPC error channel (Session 2 stretch).
- **Supervisor impact (initial):** Merge **#19 → #20** — **withdrawn** see below.

---

## 2026-07-11 — Queue Phase 1a middle ground (owner + supervisor)

- **Owner said:** PR #19 approach **not OK** — seek safe middle ground; add validation to make boundary cast defensible.
- **Chose:** **Phase 1a** — mirror **WorkPool.Service (untyped)**: `queueSpec(payload, { success?, error? })`, runtime-correct `buildQueueEvent`, single **`assertQueueInstanceSpec`** boundary cast (not inner `as unknown as Success`). **Validation:** structural `flattenSpec` key/kind match + wire schema smoke; contract RPC round-trip test.
- **Rejected:** PR **#19** (generic `queueSpec` + inner casts), PR **#20** merge until Phase 1a lands; claiming `StreamElement<events>` typing in Phase 1a.
- **Deferred:** Daemon live `events` — separate session after Queue Phase 1a; owner still picks failure surface (`events` vs store-only vs RPC rebuild).
- **Supervisor impact:** Do **not** merge #19/#20. Agent 2 → [`agent-02-queue-wire-phase-1a.md`](archive/2026-07/agents/agent-02-queue-wire-phase-1a.md). #17 rebase after Queue wire settled.

---

## 2026-07-14 — Logs store followers: Agent 3 must repeat back (correction)

- **Owner said:** Agent 2’s job included stores **following** the log bus and persisting via
  registration-native followers. Leaving only `Logs.persistLayer` → standalone `LogStore` left
  Agent 3 clueless. Put a handoff on `integration` that states the locked intent and **requires
  Agent 3 to repeat it back** before code.
- **Chose:** Rewrite [`agent-03-logs-p1.md`](./agent-03-logs-p1.md) — supersede the “B1/B2/B3 menu”
  brief. End state = registration followers (`appendLog` / `logQuery` / shared follower factory);
  current `LogStore`+`persistLayer` is interim. Agent 3 first reply = repeat-back only.
- **Rejected:** Treating node-primary-only as the approved permanent design without an explicit
  unlock; Agent 3 coding before restating the model.
- **Supervisor impact:** Agent 3 blocked on owner accepting the repeat-back.

---

## 2026-07-14 — Build `Hyperlink.monitoredDependency`

- **Owner said:** Show the idea → agreed to build it; first merge with `integration` to get latest.
- **Chose:** Merge `origin/integration` into `cursor/docs-corpus-date-stack-ce05`, then add `Hyperlink.monitoredDependency` (`status` + `changes` + `readyWhen`/`detail` readiness). Still a plain Tag shape. Delete the emptied widgets date handoff.
- **Rejected:** Pre-abstracting a new resource kind; shipping without merge.
- **Supervisor impact:** Public API + changeset on Agent 1 branch; walk next unfinished handoff after green.

---

## 2026-07-14 — Open asks priority queue

- **Owner said:** For unfinished items like the dashboard widget plug-in seam — create a new doc that lists and organizes them; **priority at the top**. Walk one issue at a time in chat.
- **Chose:** [`open-asks.md`](./open-asks.md) — owner-ordered priority queue for unfinished product/DX/consumer asks. First entry = dashboard widget plug-in seam (moved out of the date-stamped widgets handoff).
- **Rejected:** Leaving open polish forever as date-stamped one-offs; burying the walk only in docs.
- **Supervisor impact:** Agent 1 migrates unfinished asks into `open-asks.md` as they are walked; complete/declined rows leave the queue.

---

## 2026-07-14 — Date-stamped handoffs: complete → delete

- **Owner said:** One stack at a time. If a doc is **implemented / complete → delete**; if not finished → **defer to owner**. Do the first stack, then bring back whatever was never finished.
- **Chose:** First stack = `docs/handoffs/2026-*.md`. Delete completed ones in-place (no archive for this batch). Leave unfinished four for owner call. Update inbound links in the same change.
- **Rejected:** Archive-first for this stack; continuing to next stacks before owner answers the deferred list.
- **Supervisor impact:** Agent 1 executes deletes on `cursor/docs-corpus-date-stack-ce05`; waits on deferred docs before next stack.

---

## 2026-07-14 — Agent 1 Phase 1 handoffs: thorough / archive-first / defer to owner

- **Owner said:** Yes (to the Phase 1 plan) — be **thorough and precautionary**, and **defer to** the owner on calls.
- **Chose:** Phase 1 execution posture:
  1. **Archive over delete** by default; **no deletes** unless owner ticks specific rows.
  2. **No ambiguous moves** without owner OK (SSOT docs, anything linked from `AGENTS.md` / legacy STORAGE/guides / `docs/site/README`, open agent briefs, Agent 3 plans, `store-layer-query`, `decisions/` layout).
  3. Live bus + historical SSOT stay at `handoffs/` root until owner unlocks a move.
  4. Execution only in **owner-approved batches** (Agent 1 proposes; owner green-lights).
- **Rejected:** Aggressive deletes; freelancing `decisions/` subdirectory or bulk root reshuffles; touching `docs/site` UI.
- **Supervisor impact:** Agent 1 updates plan locking these rules; waits for batch unlock before `git mv`.

---

## 2026-07-14 — Agent 1 → docs corpus (UI stays with lettered agents)

- **Owner said:** Save UI / Tailscale-facing site work for lettered (local) agents. Give Agent 1 the docs corpus instead: **handoffs cleanup first**, then plans refactor/migration, then port legacy docs with a **Draft** page label (owner will refine Draft UX after assign).
- **Chose:** [`agent-01-docs-corpus.md`](./agent-01-docs-corpus.md) — Phase 1 plan-first inventory of `docs/handoffs/`. No `docs/site` UI. Draft label = content-side proposal only until B/owner specify site chrome.
- **Rejected:** Agent 1 on dashboard/web/Tailscale UX; starting legacy port before handoffs/plans hygiene.
- **Supervisor impact:** Agent 1 docs track; lettered agents keep site/UI.

---

## 2026-07-14 — Logs P1 → Agent 3 (Agent 2 retired)

- **Owner said:** Handles are owned by other agents for now. Focus next engine work on **Logs P1** (former “option 2”): level pipes / store followers / remote per-hyperlink logs. Expand and clarify that brief for a **new Agent 3**.
- **Chose:** [`agent-03-logs-p1.md`](./agent-03-logs-p1.md) — **superseded by the correction entry above** (registration followers are the locked write model; repeat-back first).
- **Rejected:** Assigning named-handles work to Agent 3; treating Logs as closed without an explicit P1 park/unlock.
- **Supervisor impact:** Agent 2 retired after #33; Agent 3 owns Logs P1.

---

## 2026-07-13 — Next headlining resource research (Agent 1)

- **Owner said:** Agent 1 is free. Daemon + WorkPool are the top two; Gate is lackluster as a product headline. Explore leaning into **fleet / peer** features — ideally first resource with mesh from day one.
- **Chose:** Plan-first research only — [`agent-01-next-headlining-resource.md`](archive/2026-07/agents/agent-01-next-headlining-resource.md). Options: upgrade Run, productize WorkerPool, FleetStatus, Telemetry, or new work router. Owner picks direction before any implementation. **Base branch:** Agent 2’s `cursor/phase5-logs-migration-a3ad` (not bare `integration/storage`).
- **Rejected:** Immediate Gate polish without research; treating Run store cutover as “headlining done.”
- **Supervisor impact:** Agent 1 research session on Agent 2 tip; Agent 2 continues Logs PR #30.

---

## 2026-07-12 — Integration fold complete (`integration/storage` @ `4c543c8`)

- **Owner said:** Integration line is consolidated — merge docs group (A corpus, B intro, C manifest), Daemon run RPC (#26), queue ref fixes (#23–#25).
- **Chose:** `integration/storage` is the single go-forward branch; **`run`** verb locked for Daemon manual RPC; effect/effectFn vocabulary shipped.
- **Rejected:** Further integration branch sprawl; `integration/web-ui-refresh` (brief retracted).
- **Supervisor impact:** Next = Cursor Logs cutover; **`main` release deferred** until Logs lands.

---

## 2026-07-12 — Logs before release (owner)

- **Owner said:** Wait on `main` merge / version bump. Finish **Logs** store migration first. Use **Cursor** (3 Claude agents busy).
- **Chose:** [`agent-cursor-logs-store-cutover.md`](archive/2026-07/agents/agent-cursor-logs-store-cutover.md) on `cursor/logs-store-cutover-a009`.
- **Rejected:** `main` release before Logs; full platform-logs redesign in the same session.
- **Supervisor impact:** Agent 3 (Cursor) active.

---

## 2026-07-12 — Daemon manual run RPC vocabulary (owner correction)

- **Owner said:** Toolkit member stays **`run`**. `Hyperlink.effect` is **inputless** (`yield* proc.run`); `Hyperlink.effectFn` takes per-invocation input (`logs.query`, schedule `get`/`has`, …). No `payload` on `Hyperlink.effect`.
- **Chose:** `run: Hyperlink.effect(success, error)` with **no payload**; migrate all payload members to `effectFn`; remove `payload` from `Hyperlink.effect` API.
- **Rejected:** `payload` on `Hyperlink.effect`; renaming toolkit verb to `effect`; `yield* proc.run()` on stamped tags.
- **Supersedes:** conflicting 2026-07-11 entry below that chose `effect` as verb name.

---

## 2026-07-11 — Daemon manual run RPC (owner Slice 0 locked)

- **Owner said:** Remote Daemon clients need typed `error` (and `success` when stamped) on manual run — not store-only.
- **Chose:** Verb **`run`** (Gate parity); **no `payload`** on Daemon tag — worker stays nullary; manual RPC via inputless `Hyperlink.effect(success, error)` (not `effectFn`). Per-tag `buildDaemonSpec`; engine propagates failure on manual `run` RPC while still writing store rows.
- **Rejected:** `effect` verb name; optional tag `payload`; Session 3 RPC defer language; `runImmediately` void RPC.
- **Supervisor impact:** Branch `cursor/process-run-rpc-a009`; revoke defer text in legacy PROCESS-API / STORAGE docs.

---

## 2026-07-11 — Daemon manual run RPC vocabulary (superseded)

*Superseded by 2026-07-12 entries — verb is **`run`**, not `effect`.*

- **Owner said:** Remote Daemon RPC must use tag **`error`** / **`success`** on the manual run path. Replace **`runImmediately`** with spec member **`effect`** = **`Hyperlink.effect(success, { error })`** — **no input** (`Effect`, not `effectFn`). Failures must fail the RPC, not store-only.
- **Rejected:** Equating **`effect`** with **`query`**; putting **payload** on `Hyperlink.effect` (input → **`effectFn`** only). Session 3 RPC defer. `runImmediately` as void `effectFn`.
- **Toolkit rule (owner):** `Hyperlink.effect` → `Effect<S,E>` no args; `Hyperlink.effectFn` → `(In) => Effect<S,E>`; `query`/`mutate` = `MethodKind` for tools only — see [`agent-a-phase1-inventory.md`](archive/2026-07/agents/agent-a-phase1-inventory.md) C5.
- **Chose (withdrawn):** [`agent-02-process-run-rpc.md`](archive/2026-07/agents/agent-02-process-run-rpc.md) — member name **`effect`**, not `run` (Gate `run` is `effectFn`+payload).
