# Design: loud, eager transport failures

**Status (2026-07-21):** Loud-failure track **Eng’d** — topology (§8.1–8.2), serve assert (§8.3), `ProtocolMismatch` / `MissingClientProtocol` (§4.1–4.2a), tier-1 + deep `verifyConnection`, **default-on client verify (§8.6)**, **F4 `contractHash`**.
**Author intent:** kill the recurring "silent wiring failure" bug class at the library level.

---

## 9. Build status — locked decisions & what shipped

**Locked naming (Effect-perfect).** `type ProtocolKind = "http" | "socket"` — Effect's *client* vocabulary (`RpcClient.layerProtocolHttp` / `layerProtocolSocket`), consistent with the existing `socketClient`. Connect family: `connect` / `connectHttp` / `connectSocket` (NOT `connectWs`). Deferred alignment (separate pass, touches C's server surface): `protocolWebsocket → protocolSocket` (client helper) and `wsServer → websocketServer` (Effect server = `layerProtocolWebsocket`).

**SHIPPED on `feat/loud-failures`** (each step: full typecheck + effect-LSP 0/0 both configs + full 501-test suite green):
- **Step 1 — `ProtocolKind` on `Node.Tag`.** `kind` inferred `"socket"` from a `ws(s)://` url / `"http"` from a resolved http target, or explicit `{ url, kind }`. `AnyNode` gains `kind`; new `AddressedNode<HSelf>` type. The node is now SSOT for *where* + *how*.
- **Step 2 — dual `connect` + `connectHttp`/`connectSocket`.** `MyNode.pipe(Hyperlink.connect)` derives the transport from the node's `kind` → **F1 (http↔socket mismatch) is designed out on the client**; a node with no address fails loudly (`UnaddressedNode`, with a remediation message) at connect, not opaquely at first call. Full form set: bare/derived pipe, `connect(protocol)` data-last, `connect(node)`/`connect(node, protocol)` data-first, and the two kind shortcuts. Proven e2e streaming over a real **ws AND http** server; `Hyperlink.client(tag)` resolves the tag's bound node (so the HealthBoard-class "ambient protocol not threaded" wiring is handled too).

**Key implementation decisions:**
- **Overload order:** the node→Layer form is declared **last** in each dual, because TS selects the last overload for a function used as a bare value (`node.pipe(connect)`); direct calls resolve top-down. Documented in-code.
- **Loud fail is runtime, not compile-time.** `connect(node)` accepts any node and throws `UnaddressedNode` at call for a bare one, rather than a type-level `AddressedNode` gate. A compile-time gate would require overloading `makeNode` to return precise per-target url/kind types, which entangles the complex `store`/`logs` getter types — deferred as a possible refinement. Runtime throw is still eager + loud (at connect, not first RPC).

**SHIPPED — §8.3 serve-time `ProtocolKindMismatch`** — `assertProtocolKinds` on `httpServer` / `wsServer` / `ipcServer` (set-membership for multi-protocol).

**SHIPPED — §4.2a `ProtocolMismatch` remap** — `Hyperlink.client` / `forwardClient` maps Effect's "empty HTTP response" `RpcClientDefect` (http client → ws server) to tagged `ProtocolMismatch`.

**SHIPPED — §4.1 `MissingClientProtocol`** — nodeless `client(tag)` uses `serviceOption(RpcClient.Protocol)`; absent ambient protocol → tagged `MissingClientProtocol` with remediation (Layer still requires Protocol in `R`).

**REMAINING (owner-gated):**
- **F4 `contractHash`** — **Eng’d:** stamped on `NodeStatus.resources[]` at serve; deep verify compares; tag-aware default-on client escalates to deep+hash.
- **§4.3/§8.4 historical note (F3 path Eng’d via transport probe + deep NodeStatus):** investigation RESOLVED (2026-07-16): **Effect's RPC already ships a transport-level handshake.** The wire (`RpcMessage`) carries `Ping`/`Pong` (client sends `constPing`; **every RpcServer auto-answers** — `RpcServer.js` `case "Ping": send(constPong)`), and the client exposes an **`onConnect: Effect<void>`** hook; `makeProtocolSocket` documents built-in "connection hooks, ping timeouts, retry policy." So:
  - **F1/F3 verify is free and self-contained** — await `onConnect` / send one `Ping`, bounded by a timeout → `NodeUnreachable` (no Pong) or `ProtocolMismatch` (transport opened but handshake rejected — http↔ws). **No server-side application verb, works against any Effect RPC server today.** This unblocks **default-on `verify` for remote tags** (no host-health prerequisite).
  - **Socket vs http nuance:** socket is persistent (built-in ping timeouts / `onConnect`, verify nearly passive); http is stateless, so http-verify is one explicit `Ping` round-trip at connect.
  - **F4 (`contractHash`)** rides the `initialMessage` channel (`RpcServer` exposes `initialMessage: Effect<Option<unknown>>` to read a client's connect payload). Server-read exists; client-send needs a bit more — **still deferred** to land with host-health, but the mechanism is confirmed real.
  - **Buildable shape:** `connect(node, { verify })` awaits `onConnect` / Pings the transport, times out → `NodeUnreachable`, classifies connected-but-rejected → `ProtocolMismatch`. All on primitives Effect already ships.

  **UPDATE (2026-07-16) — spiked, and the node-level shape above does NOT hold.** A throwaway spike driving `Protocol.run(0, …)` + `send(0, constPing)` against real ws + http servers **times out on both**: the Ping/Pong correlation (clientId allocation, receive-loop latches) lives in `RpcClient.make` (`RpcClient.js:277-348`), not the bare `Protocol`, so you can't Ping a node's raw transport. And that machinery is **per-hyperlink-group** (needs the RPC schema), not per-node — a node only carries the transport. `onConnect` is **socket-only** (stateless http has no connect event). So **node-level `verify(node)` via RPC primitives is architecturally awkward.** The realistic shapes are: (a) **resource-level** verify where a real client+group exists (`clientHttp(tag, …, { verify })` can make a genuine bounded call), or (b) a **transport-native probe** that bypasses RPC (raw ws-open / http `HEAD`), which reopens a separate connection and classifies mismatch only fuzzily. Both are real per-transport integration, not the "few lines on shipped primitives" the pre-spike note implied. **Recommendation:** the topology core (§8.1–8.2, shipped) already makes the mismatch un-expressible on the blessed path, so verify is a backstop; prioritize the §5 harness (higher-certainty CI value) and re-scope verify to the resource level as a deliberate follow-up once its true shape is chosen.

**SHIPPED (2026-07-16) — `Hyperlink.verifyConnection(node, { url?, timeout? })`, the F3 reachability slice.** After the Ping spike, verify landed as a **transport-native probe** (not RPC-level): socket = the ws stays open past a short window (`run` errors fast if it can't connect); http = the url answers at all. Fails with **`NodeUnreachable`** (remediation message) → a client fails fast at startup instead of hanging. Runtime `url` override handles bare browser nodes (kind inferred from scheme). Probes use `Layer.build` + `Effect.provide(context)` (strictEffectProvide-clean). Tested: reachable ws+http → ok, dead ports → `NodeUnreachable`; 506-suite green, LSP 0/0.

**SHIPPED (2026-07-21) — deep classification.** `{ deep: true }` escalates after tier-1: dials auto-served `NodeStatus` over the `selectEndpoint` pick (or `{ all: true }`). Transport up / RPC silent → `ProtocolUnanswered`; optional `resource` key → `ServiceNotServed` / `ServiceNotReady`. Tier-1 default unchanged. See [`verify-connection-classification.md`](./verify-connection-classification.md).

---

## 1. The problem: failures are late AND quiet

Two dashboard bugs fixed this cycle were the **same class**, not two incidents:

| Bug | What was misconfigured | How it failed | How long it hid |
|---|---|---|---|
| Producer "no live data" | http client dialing a `wsServer` | `q.add` → `RpcClientDefect: Received empty HTTP response from RPC server`, then swallowed by the example's `Effect.ignore` | weeks |
| HealthBoard / node-logs "connecting…" | nodeless `client(NodeStatus.Tag)` given a node **transport** instead of the ambient `RpcClient.Protocol` | runtime `Service not found: RpcClient/Protocol` → in the atom path, a silent **hang** | weeks |

Both share three properties that make them expensive:

1. **Late** — the misconfiguration is accepted at `connect`/layer-build and only fails on the *first RPC call*, far from the cause.
2. **Quiet** — it surfaces as an opaque *defect* or a *hang*, not a named failure that points at the fix.
3. **Swallowable** — an opaque defect is easy to `Effect.ignore` (or never observe), so it can live indefinitely.

The fix is not "write more careful examples." It's to make these misconfigurations **fail loudly and early**, the way a bad `resolveHttpTarget` / `clientHttp` target already fails the **Layer** with `InvalidHttpTarget` (Effect/Layer error channel — same shape as `UnaddressedNode`; catch via `Exit` / `CatchTag`). That precedent is the whole philosophy — this doc extends it from *config strings* to the *transport handshake*.

## 2. Current state (grounded in `src/Hyperlink.ts`)

Building blocks that already exist:

- Client protocols: `protocolHttp(url)` (Fetch + ndjson), `protocolWebsocket(url)` (one multiplexed ws + ndjson) — each returns `Layer<RpcClient.Protocol>`.
- Wiring: `connect(node, protocol)`, `client(tag)` (nodeless → requires ambient `RpcClient.Protocol`), `client(tag, node)`, `socketClient(node, {url})`, `clientHttp(tag, target)`.
- Servers: `httpServer([...])`, `wsServer([...])` → `serverProtocolHttp`/`serverProtocolWebsocket` internally.
- Eager-loud precedent: bad http target → `InvalidHttpTarget` on the Layer/Effect error channel (`clientHttp` / stamped positional `Node.Tag` → derived `connect`).

The gaps:

- **No cross-checkable protocol kind.** A client `Protocol` layer and a server carry no comparable `"http" | "websocket"` marker, and they live in different processes, so a mismatch can only be caught at a **runtime handshake**, not at compile time.
- **No connect-time reachability/handshake.** `connect` builds the transport but never exercises it, so "server down", "wrong protocol", and "wrong contract" all defer to the first call.
- **No typed error for "client has no ambient Protocol."** It's a generic `Service not found`.

Related deferred design worth folding in: the reserved-prefix **host-health** resource (ping / inventory / `contractHash`) — see `reference-resource-host-health` in the observability-tap notes. A connect-time handshake is the natural first consumer of that `contractHash`.

## 3. Failure taxonomy (the design core)

For each misconfiguration: where it surfaces today → where it *should* → the typed error → the message that names the fix.

| # | Misconfiguration | Today | Should surface | Typed error | Remediation in message |
|---|---|---|---|---|---|
| F1 | Client protocol ≠ server protocol (http↔ws) | first call, opaque defect ("empty HTTP response") | at `connect` handshake (or first call, but **named**) | `ProtocolMismatch { clientKind, serverKind, url }` | "client is http, server is websocket — use `Hyperlink.protocolWebsocket` / `socketClient`" |
| F2 | Nodeless `client(tag)` with no ambient `RpcClient.Protocol` | runtime `Service not found: RpcClient/Protocol`, or a hang | unchanged locus, but a **named, actionable** error | `MissingClientProtocol { tag }` | "this client isn't connected — wrap with `Hyperlink.connect(node, protocol)`, `clientHttp(tag, target)`, or `socketClient(node)`" |
| F3 | Server unreachable (down / wrong port/url) | first call, connection error | at `connect` handshake (opt-in verify) | `NodeUnreachable { url, cause }` | "no RPC server answered at `<url>` — is the node running / is the url/port right?" |
| F4 | Client/server **contract** drift (schema or key mismatch) | first call, decode error | at `connect` handshake (opt-in verify), via `contractHash` | `ContractMismatch { expected, actual }` | "client and server disagree on the resource contract — redeploy the stale side" |

F1 and F2 are the two proven bugs. F3/F4 are the natural extension once a handshake exists.

## 4. Proposed changes

### 4.1 F2 — `MissingClientProtocol` (smallest, highest ROI, do first)
`client(tag)` already surfaces `RpcClient.Protocol` in its `R` channel — the type story is fine. The gap is the *runtime* message when it's genuinely absent. Wrap the missing-service failure at the client boundary in a `MissingClientProtocol` `Data.TaggedError` whose message lists the three ways to connect. Low blast radius; no protocol handshake required.

### 4.2 F1 — `ProtocolMismatch` (kills bug #1)
Two tiers, ship either or both:
- **(a) Legible, cheap:** map the known first-call failure signature (empty/`426`/upgrade-required response against an http client; non-ws frame against a ws client) into a `ProtocolMismatch` tagged error with remediation. Doesn't prevent the late surfacing, but makes it un-mysterious and hard to ignore-by-accident.
- **(b) Eager:** attach a `"http" | "websocket"` **kind marker** to the layers `protocolHttp`/`protocolWebsocket` and to `httpServer`/`wsServer`, and have an opt-in connect handshake compare them (see 4.3). Prevents the late surfacing entirely, at the cost of a handshake round-trip.

### 4.3 F3/F4 — `connect(..., { verify: true })` handshake (opt-in)
A one-shot handshake at `connect` that pings the server and returns eagerly with `NodeUnreachable` (F3) or `ContractMismatch` (F4, via `contractHash`), and can also detect F1(b). **Opt-in** because it adds a round-trip and requires the server to expose a ping/health verb (the deferred host-health resource). Default stays zero-cost; `verify: true` (or a `Hyperlink.verifyConnection(node)` effect) is the loud path for entry points that want fail-fast.

**Sequencing:** 4.1 → 4.2(a) → (4.2(b) + 4.3 together, since both need the kind marker / host-health verb). 4.1 and 4.2(a) deliver most of the value and need no new server surface.

## 5. Verification harness

1. **Per-failure-mode matrix** — **SHIPPED for F1/F2/F3/F4:** `ProtocolMismatch`, `MissingClientProtocol`, `verifyConnection` deep classification + `ContractMismatch` via `contractHash`.
2. **Headless fleet smoke** — **SHIPPED:** `test/fleet-smoke.test.ts` (ws producer + NodeStatus).
3. **Transport conformance matrix** — **SHIPPED** for queue/process/run/shardmap × {http, ws} + http→ws mismatch → `ProtocolMismatch` (`test/transport-conformance.test.ts`, `test/shardmap-remote.test.ts`). **HttpApi row = N/A** — `HttpApiResource` is Effect `HttpApiClient` + concurrency gate, not RpcClient transport / `ProtocolMismatch`.

## 6. Success criteria

- Reproduce F1 and F2 as failing tests; after the fix, each produces its named `Data.TaggedError` with a remediation message, and F1/F2 surface at `connect` (F1 with verify) or with a legible error at first call (F1 without verify).
- The headless smoke test is green in CI and goes red if a producer/server protocol is mismatched.
- No new default-path cost: `connect` without `verify` adds zero round-trips.

## 7. Open questions for the owner

1. **Verify default:** opt-in (`{ verify: true }`) vs. default-on for `clientHttp`/`socketClient` (the batteries-included wrappers) where a round-trip is acceptable?
2. **`contractHash` home:** fold F4 into the deferred host-health resource, or a lighter standalone handshake verb?
3. **Scope for a first PR:** just 4.1 + 4.2(a) + §5.1–5.2 (all low-risk, mostly mine), deferring the handshake (4.3) to a C-owned follow-up? That's my recommendation — it ships the fail-loud story for the two *proven* bugs without new server surface.

---

## 8. Topology-driven verify — the SSOT reframe (supersedes the per-connect flag)

The framing in §4 treated `verify` as a per-*call* decision ("should this connect check?"). That's wrong. Whether a resource has a counterpart to shake with, who that counterpart is, and how to reach it are all **declared topology**, and the library already declares most of it:

- A tag binds to a node: `WorkPool.Tag(...)({ payload, node: Droplet })`.
- A node carries its address: `Node.Tag("droplet", 7777)` → `url` via `resolveHttpTarget` (fails loudly on a bad string — `makeNode`, `src/Hyperlink.ts:3346`).
- A fleet is declared: `.pipe(Hyperlink.distributed(NodeA, NodeB, …))`; `peers` reaches the rest.

The **one fact that's missing** is the node's *protocol kind* (http vs ws). Today the kind is chosen at `connect` time (`protocolHttp` vs `protocolWebsocket`), not recorded on the node — which is *exactly* why bug #1 was possible: nothing declared "Droplet speaks ws," so nothing could notice the producer dialed http. Add `kind` to the node and the topology becomes self-describing; verify becomes a *derived behavior* of it, not a flag.

### 8.1 Stamp `kind` on the `Node`
`Node.Tag("droplet", { url, kind: "websocket" })` (or inferred — see open question). The node becomes the single source of truth for *where* and *how* to reach it, mirroring how it already owns *where* (and already fails loudly on a bad url).

### 8.2 Design F1 out on the client (don't merely detect it)
Because the node declares its kind, `connect(node)` / `client(tag)` **derive** the transport from the node instead of the caller picking `protocolHttp`/`protocolWebsocket`. The producer bug becomes **impossible**: `connect(Droplet)` reads `kind: "websocket"` and dials ws. This is the same instinct as `warnHttpClientInBrowser` (the library already nudges on a likely-wrong transport) — promoted from "warn" to "can't express the wrong thing."

### 8.3 Assert F1 on the server at serve time
`wsServer([...])` / `httpServer([...])` assert every served tag's node declares the matching kind → a loud `ProtocolKindMismatch` at **serve startup** if someone serves an http-declared node over ws. Both sides now honor one SSOT fact and can't silently disagree — the mismatch fails at boot on whichever side is misconfigured.

### 8.4 What the runtime handshake (verify) is left to do
With F1 designed out by the topology, the handshake only covers what SSOT can't know statically:
- **F3 `NodeUnreachable`** — is the declared node actually answering?
- **F4 `ContractMismatch`** — is the *deployed* contract the one this tag expects? (`contractHash`, itself derivable from the tag = SSOT; a mismatch means one deploy is stale.)

### 8.5 Who handshakes / who to expect / who not — all derived
- Tag bound to a **remote node** (`{ node }`) or a **fleet** (`distributed`) → participates; its counterpart(s) are the declared node(s).
- **Local** tag (no node, engine in-process) → no counterpart, verify is a no-op / not offered.

No per-call guessing: the guest list *is* the declared topology.

### 8.6 Default, revisited
The strongest "don't default" argument was "we don't know who to ping / whether it has a verb." Once the counterpart is **declared**, that objection evaporates. Revised position: **the F3/F4 handshake is default-on for tags with a declared remote node, and a no-op for local tags** — with a per-connect override for the exceptions:
- `{ verify: "reject" }` — fail-fast entry point (server-to-server, CLI).
- `{ verify: "status" }` — resilient UI: connect succeeds, reason flows via `NodeStatus`.
- `{ verify: false }` — opt out (e.g. a test against a deliberately-absent server).

The per-connect flag from §4 is demoted to this *override*, not the primary surface. (The reactive remap of §4.1/4.2a stays unconditional regardless — free, always-on legibility.)

### 8.7 The API addition, restated
The core addition is **not** `{ verify }` on `connect`. It is:
1. **`kind`** (and later **`contractHash`**) on `Node.Tag` → the topology is self-describing.
2. **`connect`/`client` derive transport from the node** → F1 designed out on the client.
3. **`wsServer`/`httpServer` assert node kind at serve** → F1 loud on the server.
4. **verify = derived F3/F4 handshake** over the declared counterpart, default-on for remote tags, with a per-connect override.

### 8.8 New open question
**`kind`: explicit vs inferred.** Do you write `Node.Tag(..., { kind: "websocket" })` (simplest, explicit SSOT), or does binding a served group to `wsServer([...])` *infer* and stamp the node's kind (less to type, but needs the server and node co-declared, and the client — a separate deploy — must still read it explicitly)? Explicit-on-the-node is my lean: it's the one place both a remote client and the server can read the same fact without sharing server code.
