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
- V1 uses a separate `TerminalSessionPort` instead of extending
  `ControlPlanePort`.
- Server-side terminal lifecycle is an Effect service.
- V1 exposes terminal events as a transport-neutral event stream.
- Session IDs are gateway-issued after app auth/RBAC.
- Command restrictions are configurable. The recommended default is a configured
  target list, but apps can opt into broad shell/custom-command control.

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
- Command policy is configurable — v1 can default to named targets, while apps
  that want close to full control can enable shell/custom-command execution.
- Session IDs are gateway-issued — browser asks app server, app server
  authenticates/authorizes and creates/forwards the session.
- Structured terminal errors — auth denied, group unavailable, command denied,
  session missing, backend unavailable.

Picture:

```ts
export interface OpenTerminalSession {
  readonly groupId: string;
  readonly target: string;
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

```ts
export type TerminalCommandPolicy =
  | {
      readonly _tag: "NamedTargetsOnly";
      readonly targets: Readonly<Record<string, TerminalTarget>>;
    }
  | {
      readonly _tag: "Shell";
      readonly shell: string;
      readonly cwd?: string;
    }
  | {
      readonly _tag: "CustomCommand";
      readonly allow: (
        input: OpenTerminalSession,
      ) => Effect.Effect<ReadonlyArray<string>, TerminalSessionError>;
    };
```

Why this recommendation is good:
- It matches existing headless React style: widgets depend on a port, not runtime
  details.
- It keeps Effect-heavy lifecycle in server/runtime code.
- It lets WebSocket, tRPC subscription, Effect RPC, or CLI all adapt to the same
  contract.
- It leaves command restrictions and real PTY support as backend choices rather
  than public API rewrites.

Alternatives:
1. WebSocket protocol first — practical, but leaks transport shape into the core
   design too early.
2. PTY API first — closer to a real terminal, but brings platform/dependency risk
   before the session contract is proven.
3. CLI-first TTY mirroring — useful for developers, but risks becoming a custom
   SSH clone.
4. Reuse `ControlPlanePort` — simpler namespace, but terminal sessions are
   stateful streams and deserve a separate port.

Ingredients:
- Use a separate `TerminalSessionPort`.
- Use an Effect service for server-side lifecycle.
- Use transport-neutral terminal events.
- Let the gateway issue session IDs after app auth/RBAC.
- Make command restrictions configurable. Recommend named targets as the safe
  default, but support broad shell/custom-command policies for apps that want
  close to full control.

Decision:
Accepted: separate port, Effect service, event stream, gateway-issued sessions.
Revised: command restrictions are configurable instead of fixed; permissive
control is an app-owned policy choice.

Acceptance check:
The API can support a dashboard terminal widget, a future CLI client, and a
server-side command-stream backend without changing type names or event shapes.

## Cleanup status

Working recipe; promote final behavior into durable docs when the terminal
feature ships.
