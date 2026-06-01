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
- Terminal runtime lives beside the group runtime by default.
- PM/dashboard may discover terminal endpoint metadata, but terminal exposure is
  still app/gateway-authorized.
- Terminal endpoint config is explicit and opt-in per group endpoint.
- Terminal transport is separate from normal control transport.
- Local child endpoint startup can launch terminal runtime when configured.
- Terminal gateway transport should be Effect RPC first. Effect HTTP API can be
  used for non-streaming metadata or deployment edges, but terminal sessions
  should not be hand-rolled HTTP routes.

## Open recipe steps

- V1 terminal session contract.
- Runtime placement and endpoint discovery.
- Effect RPC gateway/browser adapter contract.
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

## Step 3: Runtime placement and endpoint discovery

Recipe step: `Runtime placement and endpoint discovery`

What this decides:
Where terminal sessions are executed, how dashboard/PM code discovers terminal
capability, and how terminal access remains opt-in instead of accidentally
exposed with every control endpoint.

Recommended ingredients:
- Terminal runtime lives beside the group runtime — it needs host-local cwd, env,
  process, and future PTY access.
- Terminal capability is declared in endpoint config — groups opt in explicitly.
- PM/dashboard discovers terminal metadata from group endpoint config/run state —
  discovery does not grant browser access.
- Gateway owns user auth/RBAC and session creation — it decides whether a user can
  open a terminal for a group.
- Terminal endpoints are separate from command control endpoints — normal
  `ControlService` remains command/status; terminal streaming gets its own
  endpoint/service.
- Child module launcher can start terminal runtime when endpoint config enables
  it — local dev path stays automatic once configured.

Picture:

```txt
Group host
  ├─ ControlService        -> signed PM commands/status
  └─ TerminalService       -> terminal sessions, opt-in

Dashboard/app server
  ├─ authenticates user
  ├─ authorizes group terminal access
  ├─ discovers terminal endpoint
  └─ opens/relays session
```

```ts
class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
  "@app/Billing",
  [SyncInvoices, BillingQueue] as const,
  [
    Endpoint.local(Transport.http(3001), import.meta.url)
      .withTerminal({
        transport: Transport.http(3002),
        targets: {
          shell: TerminalTarget.shell({
            command: "bash",
            cwd: "project",
          }),
          pm: TerminalTarget.command({
            command: ["pnpm", "run", "demo:pm"],
            cwd: "project",
          }),
        },
      })
      .default,
  ],
) {}
```

```ts
export interface ProcessManagerTerminalEndpoint {
  readonly _tag: "ProcessManagerTerminalEndpoint";
  readonly transport: ProcessManagerTransport;
  readonly targets: ReadonlyArray<{
    readonly id: string;
    readonly label?: string;
  }>;
}
```

```ts
export interface ProcessManagerEndpointSelection {
  readonly label: string;
  readonly endpoint: ProcessManagerEndpointDefinition;
  readonly terminal?: ProcessManagerTerminalEndpoint;
  readonly isDefault: boolean;
}
```

```ts
// Gateway-side policy, app-owned.
const openTerminal = Effect.gen(function* () {
  const user = yield* requireUser(request);
  yield* authorize(user, {
    action: "terminal.open",
    groupId: "@app/Billing",
    target: "shell",
  });

  const terminal = yield* ProcessManager.Terminal.connect(BillingGroup, {
    target: "local",
  });

  return yield* terminal.open({
    groupId: BillingGroup.id,
    target: "shell",
    cols: 120,
    rows: 36,
  });
});
```

Why this recommendation is good:
- It matches the command-auth/dashboard security model: browser -> app gateway ->
  trusted backend -> group host.
- It avoids pretending a terminal is just another stateless control command.
- It keeps terminal host access local to the runtime machine.
- It lets PM/dashboards list terminal capability without automatically opening a
  terminal path to users.
- It keeps future CLI and dashboard clients aligned on the same endpoint metadata.

Alternatives:
1. Terminal inside `ControlService` only — fewer ports, but mixes stateless
   command API with long-lived interactive sessions.
2. Dashboard owns terminal runtime remotely — easier UI routing, but it cannot
   access group-local cwd/env/process state without another remote execution
   mechanism.
3. Terminal endpoint always enabled when `ControlService` is enabled — easy, but
   unsafe; terminal access is too privileged to be implicit.
4. No discovery; app hardcodes terminal URLs — simplest, but makes multi-group
   dashboards and child endpoints harder.

Ingredients:
- Terminal runtime lives beside the group runtime.
- Terminal config is explicit via endpoint config.
- PM/dashboard can discover terminal capability and target names.
- App/dashboard gateway still authorizes session creation.
- Terminal transport is separate from normal control transport.
- Local child endpoint startup can launch terminal runtime when configured.

Decision:
Accepted: terminal runtime lives beside the group runtime, terminal config is
explicit in endpoint config, PM/dashboard can discover capability, the
app/dashboard gateway authorizes session creation, terminal transport is separate
from normal control transport, and local child endpoint startup can launch the
terminal runtime when configured.

Acceptance check:
A dashboard can show "terminal available" for configured groups, hide it for
groups without terminal config, and open a session only after gateway auth/RBAC
chooses a discovered terminal target.

## Step 4: Effect RPC gateway/browser adapter contract

Recipe step: `Effect RPC gateway/browser adapter contract`

What this decides:
Which Effect transport module owns the terminal gateway contract, and how browser
widgets talk to it without hand-rolled HTTP route design.

Recommended ingredients:
- Use `@effect/rpc` as the terminal gateway contract — it models Effect effects
  and streaming responses directly.
- Keep `TerminalSessionPort` as the browser/widget facade — it adapts an Effect
  RPC client to Promise/AsyncIterable for React.
- Define a `TerminalRpc` `RpcGroup` — `Open`, `Input`, `Resize`, `Close`, and
  `Events` procedures with schemas.
- Gateway authenticates user/session and authorizes terminal action before
  calling RPC handlers.
- Gateway signs or otherwise authenticates machine-to-machine calls to group
  terminal services; browser never sees PM command auth private keys.
- Use RPC streaming for terminal events — output/exit/closed are a streamed RPC
  success, not a custom SSE/WebSocket protocol invented by this package.
- App can route terminal commands either direct to group terminal service or via a
  dashboard relay, matching the command-auth gateway pattern.
- Use Effect HTTP API only for simple metadata/REST compatibility if needed; it
  is not the primary terminal session transport.

Picture:

```txt
Browser TerminalWidget
  -> TerminalSessionPort
    -> Effect RPC client adapter
      -> app/dashboard gateway
      -> authenticate user
      -> authorize terminal.open/input/resize/close
      -> TerminalRpc handlers
      -> group TerminalService
```

```ts
import { Rpc, RpcGroup } from "@effect/rpc";
import { Schema } from "effect";

const OpenTerminalSessionSchema = Schema.Struct({
  groupId: Schema.String,
  target: Schema.String,
  command: Schema.optional(Schema.Array(Schema.String)),
  cwd: Schema.optional(Schema.String),
  cols: Schema.optional(Schema.Number),
  rows: Schema.optional(Schema.Number),
});

const TerminalSessionIdSchema = Schema.Struct({
  sessionId: Schema.String,
});

const TerminalEventSchema = Schema.Union(
  Schema.TaggedStruct("Opened", {
    sessionId: Schema.String,
    groupId: Schema.String,
  }),
  Schema.TaggedStruct("Output", {
    sessionId: Schema.String,
    chunk: Schema.Uint8ArrayFromSelf,
  }),
  Schema.TaggedStruct("Exit", {
    sessionId: Schema.String,
    code: Schema.Number,
  }),
  Schema.TaggedStruct("Closed", {
    sessionId: Schema.String,
    reason: Schema.String,
  }),
);
```

```ts
export const TerminalRpc = RpcGroup.make(
  Rpc.make("Terminal.Open", {
    payload: OpenTerminalSessionSchema,
    success: TerminalSessionIdSchema,
    error: TerminalSessionErrorSchema,
  }),
  Rpc.make("Terminal.Input", {
    payload: Schema.Struct({
      sessionId: Schema.String,
      chunk: Schema.Uint8ArrayFromSelf,
    }),
    error: TerminalSessionErrorSchema,
  }),
  Rpc.make("Terminal.Resize", {
    payload: Schema.Struct({
      sessionId: Schema.String,
      cols: Schema.Number,
      rows: Schema.Number,
    }),
    error: TerminalSessionErrorSchema,
  }),
  Rpc.make("Terminal.Close", {
    payload: Schema.Struct({ sessionId: Schema.String }),
    error: TerminalSessionErrorSchema,
  }),
  Rpc.make("Terminal.Events", {
    payload: Schema.Struct({ sessionId: Schema.String }),
    success: TerminalEventSchema,
    error: TerminalSessionErrorSchema,
    stream: true,
  }),
);
```

```ts
export const TerminalRpcLive = TerminalRpc.toLayer({
  "Terminal.Open": (input, { headers }) =>
    Effect.gen(function* () {
      const user = yield* requireUser(headers);
      yield* authorize(user, {
        action: "terminal.open",
        groupId: input.groupId,
        target: input.target,
      });
      const terminal = yield* TerminalGateway.resolve(input.groupId);
      const session = yield* terminal.open(input);
      return { sessionId: session.sessionId };
    }),

  "Terminal.Events": ({ sessionId }, { headers }) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const user = yield* requireUser(headers);
        yield* authorize(user, {
          action: "terminal.events",
          sessionId,
        });
        return yield* TerminalGateway.events(sessionId);
      }),
    ),
});
```

```ts
export const createRpcTerminalSessionAdapter = (
  client: RpcClient.FromGroup<typeof TerminalRpc>,
): TerminalSessionPort => ({
  open: (input) => Effect.runPromise(client["Terminal.Open"](input)),
  input: (sessionId, chunk) =>
    Effect.runPromise(client["Terminal.Input"]({ sessionId, chunk })),
  resize: (sessionId, size) =>
    Effect.runPromise(client["Terminal.Resize"]({ sessionId, ...size })),
  close: (sessionId) =>
    Effect.runPromise(client["Terminal.Close"]({ sessionId })),
  events: (sessionId) =>
    streamToAsyncIterable(client["Terminal.Events"]({ sessionId })),
});
```

Why this recommendation is good:
- It uses Effect-native API/RPC tooling instead of custom route design.
- It matches terminal semantics: request/response for lifecycle commands and
  streamed responses for terminal output.
- It keeps app user auth and PM machine auth separate.
- It keeps React widgets decoupled behind `TerminalSessionPort`.
- It supports both direct-to-group and dashboard-relay deployments.
- It leaves Effect HTTP API available for simple REST metadata without making it
  the terminal stream protocol.

Alternatives:
1. Hand-rolled fetch/SSE/WebSocket routes — flexible, but violates the "use
   Effect" rule and creates custom protocol surface.
2. Effect HTTP API as primary terminal transport — good for typed REST, but less
   natural for bidirectional/streaming terminal sessions than Effect RPC.
3. Browser connects directly to group terminal service — lowest latency, but
   bypasses app auth/RBAC and exposes internal topology.
4. Reuse `ControlPlanePort` adapters — less surface, but terminal lifecycle and
   event streaming are different enough to deserve a separate port.
5. Gateway re-signs every terminal input frame — more uniform auth, but too heavy
   for interactive streams; authorize/open the session, then protect the session
   channel.

Ingredients:
- Browser uses `TerminalSessionPort`.
- Gateway API is modeled with `@effect/rpc`.
- Gateway owns user auth/RBAC.
- Gateway, PM, or relay owns machine-to-machine terminal auth.
- Terminal events use RPC streaming (`stream: true`).
- Support direct-to-group and dashboard-relay routing behind the gateway.
- Use Effect HTTP API only for non-streaming metadata/compatibility if needed.

Decision:
Use Effect RPC as the primary terminal gateway transport. Do not hand-roll HTTP
routes for terminal v1.

Acceptance check:
A browser widget can use a `TerminalSessionPort` backed by an Effect RPC client,
the gateway can implement terminal handlers as an `RpcGroup` layer, terminal
events stream through RPC, and no custom terminal HTTP route contract is invented.

## Cleanup status

Working recipe; promote final behavior into durable docs when the terminal
feature ships.
