# Multi-protocol nodes — decisions

**Status (2026-07-21):** **LOCKED + Eng’d** on `integration`. Core type model, connect selection, P3
set-membership, dual-serve proof, and `verifyConnection` deep RPC classification are on tip.

## Goal

One node = one identity (key) + one served-resource contract + a **set** of transports. Stop
duplicating a whole node declaration just to change its protocol. Reachable over Http and/or
WebSocket and/or IpcSocket, chosen at connect — not baked into a second copy.

## Locked decisions

1. **Declaration — the `{ http, ws }` shorthand** (owner's preferred form):
   ```ts
   class Droplet extends Node.Service<Droplet>()("droplet", {
     http: "http://droplet:7777/rpc",
     ws:   "ws://droplet:7777/rpc",
   }) {}
   ```
   Keys `http` / `ws` / `ipc` → per-kind endpoints. Single-endpoint nodes (`{ http }`, or the current
   port / `{ url, kind }` forms) keep working — they're just the one-element case.

2. **Extension — a single `Node.withProtocol({...})` pipe combinator (owner-chosen name), deriving
   same-identity handles via `class extends`:**
   ```ts
   class DropletWs extends Droplet.pipe(Node.withProtocol({ ws: "/rpc" })) {}
   //   → Node<Droplet, "Http" | "WebSocket">, key STILL "droplet"
   ```
   `Node.withProtocol(transports)` takes the **same `{ http?, ws?, ipc? }` record as the declaration**
   (one vocabulary for transports, whether declaring or extending — no separate `over*` trio; that idea
   was dropped). It adds the transports, **preserves the base key + Self**, and **widens** the type's
   `Kinds`. `url`/`path` values resolve like `protocolWebsocket` (bare → derive from host; path →
   same-origin; absolute → as-is). **Same-key identity is a hard rule** — peers/lookup/fleet see one
   node. Confirmed: node tags are `Pipeable`, so `Droplet.pipe(...)` works.

3. **Selection — `connect` auto-picks by runtime, explicit overrides win:**
   - `Droplet.pipe(connect)` → browser prefers **WebSocket** (past HTTP/1.1's ~6-conn cap, per P5),
     else **Http**; Ipc only if explicit; ties broken by declaration order.
   - `connectHttp` / `connectSocket` / `connectIpc` force one.

4. **DROPPED: the layer-level form.** No `Node.protocolLayer(...)` runtime-provided transports. All
   transports are declared or piped (static, type-tracked) so the guards stay statically verifiable.

## Type model (Eng’d)

- `Node<Self, Kinds extends ProtocolKind>` — the node carries an `endpoints` record
  `{ Http?; WebSocket?; IpcSocket? }`; `Kinds` is the union of present kinds.
- `KindsOf<{ http?; ws?; ipc? }>` maps the shorthand → the present-kinds union.
- `withProtocol` widens via shallow tag bound (TS2589-safe).

## Safety guards (set-membership)

- **P3** (`assertProtocolKinds`): `server transport ∈ node.kinds` instead of `== node.kind`.
  A node served over both http and ws advertises both; each server passes.
- **`verifyConnection`:** default remains cheap transport reachability against the
  `selectEndpoint` pick (or `{ all: true }` for every endpoint). `{ deep: true }` dials
  `NodeStatus` over that endpoint — `ProtocolUnanswered` / `ServiceNotServed` /
  `ServiceNotReady`. See [`verify-connection-classification.md`](./verify-connection-classification.md).

## Build order (all done)

1. Type model in `nodeCore` (`Node<Self, Kinds>`, endpoints record, `KindsOf`, shorthand `Tag`
   overload) → full `tsc` to measure ripple. **Done.**
2. `Node.withProtocol({...})` combinator (shallow-bound, TS2589-safe widening). **Done.**
3. `connect` auto-select over the set + explicit overrides. **Done.**
4. P3 → set-membership (`nodeKindsOf`). **Done.**
5. `verifyConnection` → RPC-ping over the selected protocol (`{ deep: true }`). **Done.**
6. Tests: shorthand + `withProtocol` widening (test-d), connect selection, P3 set-membership,
   dual-serve, verify deep. **Done.**
