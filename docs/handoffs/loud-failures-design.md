# Design: loud, eager transport failures

**Status:** proposal, awaiting owner sign-off. No code yet.
**Author intent:** kill the recurring "silent wiring failure" bug class at the library level.
**Ownership note:** the runtime changes live in `src/Resource.ts` (the protocol/connect API — Agent C's zone), so §4.1–4.3 are a **spec to co-own with C**. The verification harness (§5) touches only `test/` + example smoke scripts and is **independently ownable** — it can land first and would have caught both motivating bugs on its own.

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

The fix is not "write more careful examples." It's to make these misconfigurations **fail loudly and early**, the way `resolveHttpTarget` already throws `InvalidHttpTarget` for a malformed target (`src/Resource.ts:3561`). That precedent is the whole philosophy — this doc extends it from *config strings* to the *transport handshake*.

## 2. Current state (grounded in `src/Resource.ts`)

Building blocks that already exist:

- Client protocols: `protocolHttp(url)` (Fetch + ndjson), `protocolWebsocket(url)` (one multiplexed ws + ndjson) — each returns `Layer<RpcClient.Protocol>`.
- Wiring: `connect(node, protocol)`, `client(tag)` (nodeless → requires ambient `RpcClient.Protocol`), `client(tag, node)`, `socketClient(node, {url})`, `clientHttp(tag, target)`.
- Servers: `httpServer([...])`, `wsServer([...])` → `serverProtocolHttp`/`serverProtocolWebsocket` internally.
- Eager-loud precedent: `resolveHttpTarget` **throws** `InvalidHttpTarget` on a bad target.

The gaps:

- **No cross-checkable protocol kind.** A client `Protocol` layer and a server carry no comparable `"http" | "websocket"` marker, and they live in different processes, so a mismatch can only be caught at a **runtime handshake**, not at compile time.
- **No connect-time reachability/handshake.** `connect` builds the transport but never exercises it, so "server down", "wrong protocol", and "wrong contract" all defer to the first call.
- **No typed error for "client has no ambient Protocol."** It's a generic `Service not found`.

Related deferred design worth folding in: the reserved-prefix **host-health** resource (ping / inventory / `contractHash`) — see `reference-resource-host-health` in the observability-tap notes. A connect-time handshake is the natural first consumer of that `contractHash`.

## 3. Failure taxonomy (the design core)

For each misconfiguration: where it surfaces today → where it *should* → the typed error → the message that names the fix.

| # | Misconfiguration | Today | Should surface | Typed error | Remediation in message |
|---|---|---|---|---|---|
| F1 | Client protocol ≠ server protocol (http↔ws) | first call, opaque defect ("empty HTTP response") | at `connect` handshake (or first call, but **named**) | `ProtocolMismatch { clientKind, serverKind, url }` | "client is http, server is websocket — use `Resource.protocolWebsocket` / `socketClient`" |
| F2 | Nodeless `client(tag)` with no ambient `RpcClient.Protocol` | runtime `Service not found: RpcClient/Protocol`, or a hang | unchanged locus, but a **named, actionable** error | `MissingClientProtocol { tag }` | "this client isn't connected — wrap with `Resource.connect(node, protocol)`, `clientHttp(tag, target)`, or `socketClient(node)`" |
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
A one-shot handshake at `connect` that pings the server and returns eagerly with `NodeUnreachable` (F3) or `ContractMismatch` (F4, via `contractHash`), and can also detect F1(b). **Opt-in** because it adds a round-trip and requires the server to expose a ping/health verb (the deferred host-health resource). Default stays zero-cost; `verify: true` (or a `Resource.verifyConnection(node)` effect) is the loud path for entry points that want fail-fast.

**Sequencing:** 4.1 → 4.2(a) → (4.2(b) + 4.3 together, since both need the kind marker / host-health verb). 4.1 and 4.2(a) deliver most of the value and need no new server surface.

## 5. Verification harness (independently ownable, land first)

This is the part that isn't in `Resource.ts` and doesn't collide with any active worktree. It also *reproduces* both motivating bugs, so it's worth building even before §4:

1. **A per-failure-mode test matrix** (`test/`): for each of F1–F4, assert the misconfiguration produces the **named** typed error **eagerly** (or, pre-fix, assert the current bad behavior so the fix is a visible diff). F1 already has partial coverage in `test/queue-remote-websocket.test.ts` (the mismatch test asserts a failure — extend it to assert the *tagged* error once F1 lands).
2. **A headless fleet smoke test** (example CI): boot Droplet + Mini, run one producer, assert (a) queues fill, (b) NodeStatus reaches ready, (c) a stream delivers frames — from node probes, no browser. Turns the manual "three servers + Playwright + eyeballs" ritual into a CI gate. This alone would have caught both bugs.
3. **A transport conformance matrix:** every resource type {queue, process, run, shardmap, httpapi} × {http, ws, mismatch}, generated once, so "streams over the wire, fails loudly on mismatch" becomes a proven invariant per type instead of a per-type surprise.

## 6. Success criteria

- Reproduce F1 and F2 as failing tests; after the fix, each produces its named `Data.TaggedError` with a remediation message, and F1/F2 surface at `connect` (F1 with verify) or with a legible error at first call (F1 without verify).
- The headless smoke test is green in CI and goes red if a producer/server protocol is mismatched.
- No new default-path cost: `connect` without `verify` adds zero round-trips.

## 7. Open questions for the owner

1. **Verify default:** opt-in (`{ verify: true }`) vs. default-on for `clientHttp`/`socketClient` (the batteries-included wrappers) where a round-trip is acceptable?
2. **`contractHash` home:** fold F4 into the deferred host-health resource, or a lighter standalone handshake verb?
3. **Scope for a first PR:** just 4.1 + 4.2(a) + §5.1–5.2 (all low-risk, mostly mine), deferring the handshake (4.3) to a C-owned follow-up? That's my recommendation — it ships the fail-loud story for the two *proven* bugs without new server surface.
