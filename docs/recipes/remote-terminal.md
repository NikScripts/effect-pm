# Remote terminal recipe

## Goal

Design a remote terminal feature for groups so dashboards and applications can
open terminal sessions near a group runtime without turning effect-pm into an SSH
replacement.

## Non-goals

- Replacing SSH.
- Browser-held PM signing keys.
- Shipping app-specific auth/RBAC.
- Shipping a styled terminal widget before the terminal session contract is
  stable.

## Mise en place findings

- Dashboard guidance already uses a gateway topology:
  `Browser -> same-origin gateway -> private ControlService`.
- React widgets consume semantic ports (`ControlPlanePort`) rather than raw PM
  URLs.
- Command authentication now gives trusted servers a machine-to-machine signing
  boundary for PM commands.
- Existing package boundaries keep browser-facing tags/adapters separate from
  Node runtime layers.

## Locked ingredients

- Start with a shared Terminal Session API.
- Dashboard/gateway is the first consumer.
- Future CLI is a thin client over the same API.
- SSH stays user/app-owned for v1.
- Browser widgets call app/dashboard servers first; they do not hold PM signing
  keys.
- Terminal access is opt-in per group/endpoint and higher privilege than normal
  PM commands.

## Open recipe steps

- V1 terminal session contract.
- Runtime placement and endpoint discovery.
- Gateway/browser adapter contract.
- Backend implementation: command streaming first vs PTY first.
- Audit/observability and safety limits.
- Test plan, docs, examples, and changeset.

## Step 1: Remote terminal entry point

Recipe step: `Remote terminal entry point`

What this decides:
Whether terminal work starts from dashboard, CLI, SSH, or a shared API.

Recommended ingredients:
- Shared terminal session API first — all consumers use the same lifecycle,
  stream, input, resize, and close semantics.
- Dashboard/gateway first consumer — matches the existing widget topology and
  user-auth boundary.
- Future CLI as thin client — useful later without biasing the core API toward
  local TTY quirks.
- SSH left alone — apps can bridge to SSH themselves when they want host login.

Picture:

```txt
Shared API:
  TerminalService.openSession(...)
  TerminalSession.input(...)
  TerminalSession.resize(...)
  TerminalSession.events
  TerminalSession.close(...)

Consumers:
  Dashboard widget -> app server -> terminal gateway -> TerminalService
  Future CLI      -> terminal gateway -> TerminalService
  SSH             -> external/user-owned alternative
```

Decision:
Option 1 is locked: build a shared Terminal Session API and prove it through the
dashboard/gateway path first.

Acceptance check:
The first implementation can open a group-scoped terminal session through a
gateway API without exposing raw group hosts or private signing keys to the
browser.

## Step 2: V1 terminal session contract

Recipe step: `V1 terminal session contract`

What this decides:
The semantic API every future transport and UI consumes: how sessions open,
receive input, resize, emit output, exit, and close.

Recommended ingredients:
- `TerminalSessionPort` as the semantic contract — analogous to
  `ControlPlanePort`, not tied to WebSocket, tRPC, or Effect RPC.
- Server-side `TerminalSessionService` as an Effect service — owns session
  lifecycle and runtime dependencies.
- Streamed events — output, exit, errors, and lifecycle messages flow one way
  from server to client.
- Commands are explicit — v1 opens either an allowed shell or a configured
  command; no arbitrary browser-provided command by default.
- Session IDs are gateway-issued — browser asks app server, app server
  authenticates/authorizes and creates/forwards the session.
- Structured terminal errors — auth denied, group unavailable, command denied,
  session missing, backend unavailable.

Picture:

```ts
export interface OpenTerminalSession {
  readonly groupId: string;
  readonly target?: "shell" | "pm-cli" | "custom";
  readonly command?: ReadonlyArray<string>;
  readonly cwd?: string;
  readonly cols?: number;
  readonly rows?: number;
}
```

```ts
export type TerminalEvent =
  | {
      readonly _tag: "Opened";
      readonly sessionId: string;
      readonly groupId: string;
    }
  | {
      readonly _tag: "Output";
      readonly sessionId: string;
      readonly chunk: Uint8Array;
    }
  | {
      readonly _tag: "Exit";
      readonly sessionId: string;
      readonly code: number;
    }
  | {
      readonly _tag: "Closed";
      readonly sessionId: string;
      readonly reason: string;
    };
```

```ts
export interface TerminalSessionPort {
  readonly open: (
    input: OpenTerminalSession,
  ) => Promise<{ readonly sessionId: string }>;

  readonly input: (
    sessionId: string,
    chunk: Uint8Array,
  ) => Promise<void>;

  readonly resize: (
    sessionId: string,
    size: { readonly cols: number; readonly rows: number },
  ) => Promise<void>;

  readonly close: (sessionId: string) => Promise<void>;

  readonly events: (
    sessionId: string,
  ) => AsyncIterable<TerminalEvent>;
}
```

```ts
export interface TerminalSessionService {
  readonly open: (
    input: OpenTerminalSession,
  ) => Effect.Effect<TerminalSessionHandle, TerminalSessionError>;
}
```

```ts
export interface TerminalSessionHandle {
  readonly sessionId: string;
  readonly input: (chunk: Uint8Array) => Effect.Effect<void, TerminalSessionError>;
  readonly resize: (
    size: { readonly cols: number; readonly rows: number },
  ) => Effect.Effect<void, TerminalSessionError>;
  readonly events: Stream.Stream<TerminalEvent, TerminalSessionError>;
  readonly close: Effect.Effect<void, TerminalSessionError>;
}
```

Why this recommendation is good:
- It matches existing headless React style: widgets depend on a port, not runtime
  details.
- It keeps Effect-heavy lifecycle in server/runtime code.
- It lets WebSocket, tRPC subscription, Effect RPC, or CLI all adapt to the same
  contract.
- It leaves real PTY support as a backend choice rather than a public API rewrite.

Alternatives:
1. WebSocket protocol first — practical, but leaks transport shape into the core
   design too early.
2. PTY API first — closer to a real terminal, but brings platform/dependency risk
   before the session contract is proven.
3. CLI-first TTY mirroring — useful for developers, but risks becoming a custom
   SSH clone.
4. Reuse `ControlPlanePort` — simpler namespace, but terminal sessions are
   stateful streams and deserve a separate port.

Decision steps:
1. Should v1 define a separate `TerminalSessionPort` instead of extending
   `ControlPlanePort`? — **Recommended answer:** Yes; terminal sessions are
   stateful streams, unlike normal control commands.
2. Should server-side terminal lifecycle be an Effect service? —
   **Recommended answer:** Yes; it owns runtime dependencies, streams, scopes,
   process handles, and cleanup.
3. Should v1 expose terminal events as a transport-neutral event stream? —
   **Recommended answer:** Yes; WebSocket/CLI/RPC adapters can all map to it.
4. Should arbitrary browser-provided commands be disallowed by default? —
   **Recommended answer:** Yes; allow configured shells/targets first.
5. Should session IDs be gateway-issued after app auth/RBAC? —
   **Recommended answer:** Yes; browser auth belongs to the app/dashboard server.

Ingredients:
Yes to all five. Terminal v1 should define a separate, transport-neutral session
contract with Effect-owned backend lifecycle and browser-safe gateway semantics.

Acceptance check:
The API can support a dashboard terminal widget, a future CLI client, and a
server-side command-stream backend without changing type names or event shapes.

## Cleanup status

Working recipe; promote final behavior into durable docs when the terminal
feature ships.
