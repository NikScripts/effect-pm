# Multi-protocol nodes — decisions

**Status (2026-07-20):** design LOCKED with the owner; core type model spike-proven cast-free. On
branch `feat/multi-protocol-nodes`. Build not started beyond the spike.

## Goal

One node = one identity (key) + one served-resource contract + a **set** of transports. Stop
duplicating a whole node declaration just to change its protocol. Reachable over Http and/or
WebSocket and/or IpcSocket, chosen at connect — not baked into a second copy.

## Locked decisions

1. **Declaration — the `{ http, ws }` shorthand** (owner's preferred form):
   ```ts
   class Droplet extends Node.Tag<Droplet>("droplet", {
     http: "http://droplet:7777/rpc",
     ws:   "ws://droplet:7777/rpc",
   }) {}
   ```
   Keys `http` / `ws` / `ipc` → per-kind endpoints. Single-endpoint nodes (`{ http }`, or the current
   port / `{ url, kind }` forms) keep working — they're just the one-element case.

2. **Extension — `over*` pipe combinators, deriving same-identity handles via `class extends`:**
   ```ts
   class DropletWs extends Droplet.pipe(Node.overSocket("/rpc")) {}
   //   → Node<Droplet, "Http" | "WebSocket">, key STILL "droplet"
   ```
   `Node.overHttp(url?)` / `Node.overSocket(url?)` / `Node.overIpc(path?)` add a transport, **preserve
   the base key + Self**, and **widen the type's `Kinds`**. `url?` resolves like `protocolWebsocket`
   already does (bare → derive from the node's host; path → same-origin/host-relative; absolute → used
   as-is). **Same-key identity is a hard rule** — peers/lookup/fleet must see one node.

3. **Selection — `connect` auto-picks by runtime, explicit overrides win:**
   - `Droplet.pipe(connect)` → browser prefers **WebSocket** (past HTTP/1.1's ~6-conn cap, per P5),
     else **Http**; Ipc only if explicit; ties broken by declaration order.
   - `connectHttp` / `connectSocket` / `connectIpc` force one.

4. **DROPPED: the layer-level form.** No `Node.protocolLayer(...)` runtime-provided transports. All
   transports are declared or piped (static, type-tracked) so the guards stay statically verifiable.

## Type model (spike-proven)

- `Node<Self, Kinds extends ProtocolKind>` — the node carries an `endpoints` record
  `{ Http?; WebSocket?; IpcSocket? }`; `Kinds` is the union of present kinds.
- `KindsOf<{ http?; ws?; ipc? }>` maps the shorthand → the present-kinds union.
- `over*` is `<Self, K>(n: Node<Self, K>) => Node<Self, K | "<Added>">` — union widening through
  `pipe`, chainable. Proven clean in `scratchpad/mp2.ts`.

## Safety guards move to set-membership (get *stronger*)

- **P3** (`assertProtocolKinds`, `internal/node.ts`): `server transport ∈ node.kinds` instead of
  `== node.kind`. `nodeKindOf` → `nodeKindsOf(tag): ReadonlySet<ProtocolKind>` (or a union). A node
  served over both http and ws advertises both; each server passes.
- **`verifyConnection`**: folded in LAST. Switch its raw-transport probe to a real RPC round-trip
  (ping the auto-served `NodeStatus` over the *selected* protocol) — kills today's known false-positive
  (http probe accepts any HTTP response) and, with a definite target protocol, can classify a mismatch
  cleanly. This is why it waits for this work: multi-protocol redefines "mismatch."

## Risks / watch-items

- **TS2589** with `class extends Base.pipe(over*)` — piping onto a class-based tag reopens the
  "excessively deep" blowups that bit `withReadiness`. `over*` MUST use a shallow tag bound (the
  `PipeableTag`-style pattern), never `NodeTag<Self, Kinds>` in the data-last position.
- **Integration ripple** — the single-kind `AddressedNode` + `connect` (`node.kind`/`node.url`) are
  woven through `nodeCore` / `nodeConnect`. Migrate to the endpoints record; keep single-kind
  consumers reading a resolved "primary" endpoint where a set isn't needed.

## Build order

1. Type model in `nodeCore` (`Node<Self, Kinds>`, endpoints record, `KindsOf`, shorthand `Tag`
   overload) → full `tsc` to measure ripple.
2. `over*` combinators (shallow-bound, TS2589-safe).
3. `connect` auto-select over the set + explicit overrides.
4. P3 → set-membership (`nodeKindsOf`).
5. `verifyConnection` → RPC-ping over the selected protocol.
6. Tests: shorthand + `over*` widening (test-d), connect selection, P3 set-membership, verify.
