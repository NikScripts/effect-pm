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
import { mintAssumeToken } from "./launcherToken";

/** Opaque assume-token brand (thin sugar over a redacted string). @public */
export type Token = string & { readonly [LauncherTokenBrand]: unique symbol };
declare const LauncherTokenBrand: unique symbol;

/** Default Ready poll bound when `ready.timeout` is omitted. */
const DEFAULT_READY_TIMEOUT = "30 seconds" as const;

/** How often `awaitReady` re-probes node status while waiting. */
const READY_POLL = "100 millis" as const;

/** Per-dial bound so a hung connect cannot stall the outer Ready timeout. */
const READY_PROBE_TIMEOUT = "2 seconds" as const;

/**
 * Ready-wait options on a spawn unit — omit `services` for allReady-shaped; omit `timeout`
 * for the house default (`"30 seconds"`).
 *
 * @category models
 * @public
 */
export interface ReadyOptions {
  /** HyperService wire keys to wait on; omit ⇒ all served services Ready. */
  readonly services?: ReadonlyArray<string>;
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
  readonly services?: ReadonlyArray<string>;
  readonly timeout: Duration.Input;
}> {
  override get message() {
    const scope =
      this.services === undefined
        ? "all served HyperServices"
        : `services [${this.services.join(", ")}]`;
    return `Launcher ReadyTimedOut for "${this.node}" waiting on ${scope} (timeout ${String(this.timeout)}).`;
  }
}

/**
 * Child OS process exited while the launcher was waiting for Ready.
 *
 * @category errors
 * @public
 */
export class ChildExited extends Data.TaggedError("ChildExited")<{
  readonly node: string;
  readonly code?: number;
}> {
  override get message() {
    const code =
      this.code === undefined ? "unknown" : String(this.code);
    return `Launcher child for "${this.node}" exited during awaitReady (code ${code}).`;
  }
}

/**
 * Custody handle used after handoff — `.awaitReady` / `.handoff` must not be called again.
 *
 * @category errors
 * @public
 */
export class HandleSpent extends Data.TaggedError("HandleSpent")<{
  readonly node: string;
  readonly phase: "awaitReady" | "handoff";
}> {
  override get message() {
    return `Launcher.Handle for "${this.node}" is spent — cannot ${this.phase} after handoff.`;
  }
}

/**
 * {@link Handle.handoff} called before {@link Handle.awaitReady} succeeded.
 *
 * @category errors
 * @public
 */
export class HandleNotReady extends Data.TaggedError("HandleNotReady")<{
  readonly node: string;
}> {
  override get message() {
    return `Launcher.Handle for "${this.node}" is not Ready — call awaitReady() before handoff().`;
  }
}

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
  /** Wait until Ready (allReady or `ready.services`) is proven cross-process. */
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
    | HandleNotReady
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
 * Mint an opaque high-entropy assume token (CSPRNG hex) and wrap in {@link Redacted}.
 *
 * @category constructors
 * @public
 */
export const mintToken: Effect.Effect<Redacted.Redacted<string>> =
  mintAssumeToken;

const nodeAddress = (node: AnyNode): string =>
  typeof node.url === "string"
    ? node.url
    : typeof node.path === "string"
      ? node.path
      : node.key;

const withLauncherLogs = <A, E, R>(
  nodeKey: string,
  phase: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  effect.pipe(
    Effect.annotateLogs({
      "launcher.node": nodeKey,
      "launcher.phase": phase,
    }),
    Effect.withLogSpan(`launcher.${phase}`),
  );

const probeReady = (
  node: AnyNode,
  services: ReadonlyArray<string> | undefined,
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
    // Node status still exposes the readiness rollup as `.services` (status schema);
    // Launcher call sites use `ready.services` / HyperService keys.
    if (services !== undefined) {
      for (const key of services) {
        const row = snap.services.find((r) => r.key === key);
        if (row === undefined) {
          return yield* new ServiceNotServed({
            node: node.key,
            url: address,
            serviceKey: key,
            served: snap.services.map((r) => r.key),
          });
        }
        if (!row.ready) {
          return yield* new ServiceNotReady({
            node: node.key,
            url: address,
            serviceKey: key,
            ...(row.detail !== undefined ? { detail: row.detail } : {}),
          });
        }
      }
      return;
    }
    if (snap.services.length === 0) {
      return yield* new ServiceNotReady({
        node: node.key,
        url: address,
        serviceKey: "*",
        detail: "no served HyperServices yet",
      });
    }
    const blocked = snap.services.find((r) => !r.ready);
    if (blocked !== undefined) {
      return yield* new ServiceNotReady({
        node: node.key,
        url: address,
        serviceKey: blocked.key,
        ...(blocked.detail !== undefined ? { detail: blocked.detail } : {}),
      });
    }
  }).pipe(
    Effect.scoped,
    Effect.timeout(READY_PROBE_TIMEOUT),
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
    withLauncherLogs(
      options.node.key,
      "awaitReady",
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
        yield* Effect.logDebug("polling child Ready");
        const timeout = options.ready?.timeout ?? DEFAULT_READY_TIMEOUT;
        const services = options.ready?.services;
        const wait = probeReady(options.node, services).pipe(
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
                  ...(services !== undefined ? { services } : {}),
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
        yield* Effect.logInfo("child Ready");
        return makeHandle(options);
      }),
    );

  const handoff = (): Effect.Effect<
    void,
    | HandleNotReady
    | AssumeTokenMismatch
    | AssumeTokenReused
    | AssumeNotReady
    | NodeUnreachable
    | UnaddressedNode
    | HandleSpent
    | PlatformError
  > =>
    withLauncherLogs(
      options.node.key,
      "handoff",
      Effect.gen(function* () {
        const phase = yield* Ref.get(options.phase);
        if (phase === "handedOff") {
          return yield* new HandleSpent({
            node: options.node.key,
            phase: "handoff",
          });
        }
        if (phase !== "ready") {
          return yield* new HandleNotReady({ node: options.node.key });
        }
        yield* Effect.logDebug("calling Node.assume");
        yield* nodeAssume(options.node, {
          token: Redacted.value(options.token),
        });
        // Unref the child so Scope close does not kill it. Discard reref — the
        // launcher exits; custody is the child's after assume.
        const _reref = yield* options.child.unref;
        void _reref;
        yield* Ref.set(options.phase, "handedOff");
        yield* Effect.logInfo("handoff complete; child unref'd");
      }),
    );

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
  withLauncherLogs(
    spec.node.key,
    "spawn",
    Effect.gen(function* () {
      const token = yield* mintToken;
      const clear = Redacted.value(token);
      const command =
        typeof spec.process === "function" ? spec.process(clear) : spec.process;
      const child = yield* command;
      const phase = yield* Ref.make<"spawned" | "ready" | "handedOff">(
        "spawned",
      );
      yield* Effect.logInfo("child spawned under launcher custody").pipe(
        Effect.annotateLogs({ "launcher.pid": String(child.pid) }),
      );
      return makeHandle({
        node: spec.node,
        token,
        child,
        ready: spec.ready,
        phase,
      });
    }),
  );

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
  | HandleNotReady
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
    yield* Effect.logInfo("Launcher.up starting").pipe(
      Effect.annotateLogs({ "launcher.units": String(units.length) }),
    );
    for (const unit of units) {
      const handle = yield* spawn(unit);
      yield* handle.awaitReady();
      yield* handle.handoff();
    }
    yield* Effect.logInfo("Launcher.up complete");
  });
