/**
 * @module internal/launcher
 *
 * Spine-α spawn-and-exit launcher — mint token, spawn OS child, poll Ready, `Node.assume`, unref.
 * Node-platform only (`ChildProcessSpawner` + Scope). Wire-portable pieces stay on {@link Node}.
 */
import {
  Data,
  Duration,
  Effect,
  Layer,
  Random,
  Redacted,
  Ref,
  Schedule,
  type Scope,
} from "effect";
import type { PlatformError } from "effect/PlatformError";
import {
  type ChildProcess,
  ChildProcessSpawner,
} from "effect/unstable/process";
import * as Hyperlink from "../Hyperlink";
import {
  AssumeNotReady,
  AssumeTokenMismatch,
  AssumeTokenReused,
} from "./nodeAssume";
import { assume as nodeAssume } from "./nodeAssumeClient";
import {
  isAddressedNode,
  NodeUnreachable,
  ProtocolUnanswered,
  ServiceNotReady,
  ServiceNotServed,
  UnaddressedNode,
  type AnyNode,
} from "./nodeCore";

/** Opaque assume-token brand (thin sugar over a redacted string). @public */
export type Token = string & { readonly [LauncherTokenBrand]: unique symbol };
declare const LauncherTokenBrand: unique symbol;

/** Bytes minted into a hex assume token (Eng default — high-entropy opaque string). */
const TOKEN_BYTES = 32;

/** Default Ready poll bound when `ready.timeout` is omitted. */
const DEFAULT_READY_TIMEOUT = "30 seconds" as const;

/** How often `awaitReady` re-probes node status while waiting. */
const READY_POLL = "100 millis" as const;

/**
 * Ready-wait options on a spawn unit — omit `resources` for allReady-shaped; omit `timeout`
 * for the house default (`"30 seconds"`).
 *
 * @category models
 * @public
 */
export interface ReadyOptions {
  readonly resources?: ReadonlyArray<string>;
  readonly timeout?: Duration.Input;
}

/**
 * One spawn unit — dial target + Effect `ChildProcess` command (or a factory that receives the
 * minted cleartext token for open injection into env/argv).
 *
 * @category models
 * @public
 */
export interface SpawnSpec {
  readonly node: AnyNode;
  readonly process:
    | ChildProcess.Command
    | ((token: string) => ChildProcess.Command);
  readonly ready?: ReadyOptions;
}

/**
 * Ready poll expired before the child reported Ready.
 *
 * @category errors
 * @public
 */
export class ReadyTimedOut extends Data.TaggedError("ReadyTimedOut")<{
  readonly node: string;
  readonly resources?: ReadonlyArray<string>;
  readonly timeout: Duration.Input;
}> {}

/**
 * Child OS process exited while the launcher was waiting for Ready.
 *
 * @category errors
 * @public
 */
export class ChildExited extends Data.TaggedError("ChildExited")<{
  readonly node: string;
  readonly code?: number;
}> {}

/**
 * Custody handle used after handoff — `.awaitReady` / `.handoff` must not be called again.
 *
 * @category errors
 * @public
 */
export class HandleSpent extends Data.TaggedError("HandleSpent")<{
  readonly node: string;
  readonly phase: "awaitReady" | "handoff";
}> {}

type LauncherChildHandle = ChildProcessSpawner.ChildProcessHandle;

/**
 * Custody handle — only {@link spawn} / {@link up} construct these. After {@link Handle.handoff},
 * do not use the handle for control; the launcher may exit.
 *
 * @category models
 * @public
 */
export interface Handle {
  /** Minted assume token (redacted — never cleartext in logs). */
  readonly token: Redacted.Redacted<string>;
  /** Dial / verify / handoff target. */
  readonly node: AnyNode;
  /** Wait until Ready (allReady or `ready.resources`) is proven cross-process. */
  readonly awaitReady: () => Effect.Effect<
    Handle,
    | ReadyTimedOut
    | ChildExited
    | HandleSpent
    | UnaddressedNode
    | NodeUnreachable
    | ProtocolUnanswered
    | ServiceNotReady
    | ServiceNotServed
    | PlatformError
  >;
  /** Call {@link Node.assume}, then unref the child so the launcher scope may close. */
  readonly handoff: () => Effect.Effect<
    void,
    | AssumeTokenMismatch
    | AssumeTokenReused
    | AssumeNotReady
    | NodeUnreachable
    | UnaddressedNode
    | HandleSpent
    | PlatformError
  >;
}

const isSpawnSpec = (value: unknown): value is SpawnSpec =>
  typeof value === "object" &&
  value !== null &&
  "node" in value &&
  "process" in value;

/**
 * Mint an opaque high-entropy assume token via Effect {@link Random} (hex) and wrap in
 * {@link Redacted}. No raw `crypto.randomUUID`.
 *
 * @category constructors
 * @public
 */
export const mintToken: Effect.Effect<Redacted.Redacted<string>> = Effect.gen(
  function* () {
    const hex: Array<string> = [];
    for (let i = 0; i < TOKEN_BYTES; i++) {
      const byte = yield* Random.nextIntBetween(0, 256, { halfOpen: true });
      hex.push(byte.toString(16).padStart(2, "0"));
    }
    return Redacted.make(hex.join(""));
  },
);

const nodeAddress = (node: AnyNode): string =>
  typeof node.url === "string"
    ? node.url
    : typeof node.path === "string"
      ? node.path
      : node.key;

const probeReady = (
  node: AnyNode,
  resources: ReadonlyArray<string> | undefined,
): Effect.Effect<
  void,
  | ServiceNotReady
  | ServiceNotServed
  | NodeUnreachable
  | ProtocolUnanswered
  | UnaddressedNode
> => {
  if (!isAddressedNode(node)) {
    return Effect.fail(new UnaddressedNode({ node: node.key }));
  }
  const address = nodeAddress(node);
  return Effect.gen(function* () {
    const { NodeStatusTag } = yield* Effect.promise(() => import("./nodeStatus"));
    const ctx = yield* Layer.build(
      Hyperlink.client(NodeStatusTag, node).pipe(
        Layer.provide(Hyperlink.clientVerify(false)),
      ),
    );
    const snap = yield* Effect.gen(function* () {
      const status = yield* NodeStatusTag;
      return yield* status.status.get;
    }).pipe(Effect.provide(ctx));
    if (resources !== undefined) {
      for (const key of resources) {
        const row = snap.resources.find((r) => r.key === key);
        if (row === undefined) {
          return yield* new ServiceNotServed({
            node: node.key,
            url: address,
            resource: key,
            served: snap.resources.map((r) => r.key),
          });
        }
        if (!row.ready) {
          return yield* new ServiceNotReady({
            node: node.key,
            url: address,
            resource: key,
            ...(row.detail !== undefined ? { detail: row.detail } : {}),
          });
        }
      }
      return;
    }
    if (snap.resources.length === 0) {
      return yield* new ServiceNotReady({
        node: node.key,
        url: address,
        resource: "*",
        detail: "no served resources yet",
      });
    }
    const blocked = snap.resources.find((r) => !r.ready);
    if (blocked !== undefined) {
      return yield* new ServiceNotReady({
        node: node.key,
        url: address,
        resource: blocked.key,
        ...(blocked.detail !== undefined ? { detail: blocked.detail } : {}),
      });
    }
  }).pipe(
    Effect.scoped,
    // Bound each dial — a hung connect must not stall the Ready poll until the outer timeout.
    Effect.timeout("2 seconds"),
    Effect.mapError((cause) => {
      if (
        cause instanceof ServiceNotReady ||
        cause instanceof ServiceNotServed ||
        cause instanceof UnaddressedNode ||
        cause instanceof NodeUnreachable ||
        cause instanceof ProtocolUnanswered
      ) {
        return cause;
      }
      return new NodeUnreachable({
        node: node.key,
        url: address,
        cause,
      });
    }),
  );
};

const isTransientReadyFailure = (error: unknown): boolean =>
  error instanceof ServiceNotReady ||
  error instanceof ServiceNotServed ||
  error instanceof NodeUnreachable ||
  error instanceof ProtocolUnanswered;

const makeHandle = (options: {
  readonly node: AnyNode;
  readonly token: Redacted.Redacted<string>;
  readonly child: LauncherChildHandle;
  readonly ready: ReadyOptions | undefined;
  readonly phase: Ref.Ref<"spawned" | "ready" | "handedOff">;
}): Handle => {
  const awaitReady = (): Effect.Effect<
    Handle,
    | ReadyTimedOut
    | ChildExited
    | HandleSpent
    | UnaddressedNode
    | NodeUnreachable
    | ProtocolUnanswered
    | ServiceNotReady
    | ServiceNotServed
    | PlatformError
  > =>
    Effect.gen(function* () {
      const phase = yield* Ref.get(options.phase);
      if (phase === "handedOff") {
        return yield* new HandleSpent({
          node: options.node.key,
          phase: "awaitReady",
        });
      }
      if (phase === "ready") {
        return makeHandle(options);
      }
      const timeout = options.ready?.timeout ?? DEFAULT_READY_TIMEOUT;
      const resources = options.ready?.resources;
      const wait = probeReady(options.node, resources).pipe(
        Effect.retry({
          while: isTransientReadyFailure,
          schedule: Schedule.spaced(READY_POLL),
        }),
        Effect.timeoutOrElse({
          duration: timeout,
          orElse: () =>
            Effect.fail(
              new ReadyTimedOut({
                node: options.node.key,
                ...(resources !== undefined ? { resources } : {}),
                timeout,
              }),
            ),
        }),
      );
      const childDied = options.child.exitCode.pipe(
        Effect.flatMap((code) =>
          Effect.fail(
            new ChildExited({
              node: options.node.key,
              code: Number(code),
            }),
          ),
        ),
      );
      yield* Effect.raceFirst(wait, childDied);
      yield* Ref.set(options.phase, "ready");
      return makeHandle(options);
    });

  const handoff = (): Effect.Effect<
    void,
    | AssumeTokenMismatch
    | AssumeTokenReused
    | AssumeNotReady
    | NodeUnreachable
    | UnaddressedNode
    | HandleSpent
    | PlatformError
  > =>
    Effect.gen(function* () {
      const phase = yield* Ref.get(options.phase);
      if (phase === "handedOff") {
        return yield* new HandleSpent({
          node: options.node.key,
          phase: "handoff",
        });
      }
      yield* nodeAssume(options.node, {
        token: Redacted.value(options.token),
      });
      // Drop reref — launcher exits; child keeps running under its own custody.
      const _reref = yield* options.child.unref;
      void _reref;
      yield* Ref.set(options.phase, "handedOff");
    });

  return {
    token: options.token,
    node: options.node,
    awaitReady,
    handoff,
  };
};

/**
 * Spawn one OS child under launcher custody — mints an assume token, runs `process`, returns
 * a {@link Handle}. Requires `ChildProcessSpawner` + `Scope` (provide `@effect/platform-node`
 * layers at the app edge).
 *
 * @category constructors
 * @public
 */
export const spawn = (
  spec: SpawnSpec,
): Effect.Effect<
  Handle,
  PlatformError,
  ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
> =>
  Effect.gen(function* () {
    const token = yield* mintToken;
    const clear = Redacted.value(token);
    const command =
      typeof spec.process === "function" ? spec.process(clear) : spec.process;
    const child = yield* command;
    const phase = yield* Ref.make<"spawned" | "ready" | "handedOff">("spawned");
    return makeHandle({
      node: spec.node,
      token,
      child,
      ready: spec.ready,
      phase,
    });
  });

/**
 * One-shot bring-up: spawn → awaitReady → handoff per unit, then the launcher may exit.
 * Accepts one {@link SpawnSpec} or a readonly array (not {@link Group}).
 *
 * @category constructors
 * @public
 */
export const up = (
  spec: SpawnSpec | ReadonlyArray<SpawnSpec>,
): Effect.Effect<
  void,
  | ReadyTimedOut
  | ChildExited
  | HandleSpent
  | AssumeTokenMismatch
  | AssumeTokenReused
  | AssumeNotReady
  | NodeUnreachable
  | ProtocolUnanswered
  | ServiceNotReady
  | ServiceNotServed
  | UnaddressedNode
  | PlatformError,
  ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
> =>
  Effect.gen(function* () {
    const units = isSpawnSpec(spec) ? [spec] : spec;
    for (const unit of units) {
      const handle = yield* spawn(unit);
      yield* handle.awaitReady();
      yield* handle.handoff();
    }
  });
