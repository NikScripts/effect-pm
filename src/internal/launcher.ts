/**
 * @module internal/launcher
 *
 * Spine-α spawn-and-exit launcher — mint token, spawn OS child, poll Ready, `Node.assume`, unref.
 * Node-platform only (`ChildProcessSpawner` + Scope). Wire-portable pieces stay on {@link Node}.
 *
 * Effect-first: `Schedule` + `TestClock`-friendly Ready poll, `Semaphore` single-flight on the
 * handle, `Config` for the Ready bound, `Effect.provide(Layer)` for status dials, `withSpan` /
 * `withLogSpan` on every phase, `_tag` predicates (never `instanceof`), `Effect.forEach` for `up`.
 */
import {
  Config,
  Data,
  Duration,
  Effect,
  Layer,
  Option,
  Predicate,
  Redacted,
  Ref,
  Schedule,
  Semaphore,
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
import type { NodeStatus } from "./nodeStatus";
import { mintAssumeToken } from "./launcherToken";

/** Opaque assume-token brand (thin sugar over a redacted string). @public */
export type Token = string & { readonly [LauncherTokenBrand]: unique symbol };
declare const LauncherTokenBrand: unique symbol;

/** Default Ready poll bound when `ready.timeout` is omitted and Config is unset. */
const DEFAULT_READY_TIMEOUT = Duration.seconds(30);

/** How often `awaitReady` re-probes node status while waiting. */
const READY_POLL = Duration.millis(100);

/** Per-dial bound so a hung connect cannot stall the outer Ready timeout. */
const READY_PROBE_TIMEOUT = Duration.seconds(2);

/**
 * Effect {@link Config} for the Ready wait bound (`HYPERLINK_LAUNCHER_READY_TIMEOUT`).
 * Falls back to 30 seconds when unset — same house default as {@link ReadyOptions.timeout}.
 *
 * @category config
 * @public
 */
export const readyTimeoutConfig: Config.Config<Duration.Duration> =
  Config.duration("HYPERLINK_LAUNCHER_READY_TIMEOUT").pipe(
    Config.withDefault(DEFAULT_READY_TIMEOUT),
  );

/**
 * Ready-wait options on a spawn unit — omit `services` for allReady-shaped; omit `timeout`
 * to read {@link readyTimeoutConfig} (default `"30 seconds"`).
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
type HandlePhase = "spawned" | "ready" | "handedOff";

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

const withLauncherPhase = <A, E, R>(
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
    Effect.withSpan(`launcher.${phase}`, {
      attributes: {
        "launcher.node": nodeKey,
        "launcher.phase": phase,
      },
    }),
  );

const isTransientReadyFailure = Predicate.or(
  Predicate.isTagged("ServiceNotReady"),
  Predicate.or(
    Predicate.isTagged("ServiceNotServed"),
    Predicate.or(
      Predicate.isTagged("NodeUnreachable"),
      Predicate.isTagged("ProtocolUnanswered"),
    ),
  ),
);

const assertServicesReady = (
  node: AnyNode,
  address: string,
  snap: NodeStatus,
  services: ReadonlyArray<string> | undefined,
): Effect.Effect<void, ServiceNotReady | ServiceNotServed> => {
  if (services !== undefined) {
    return Effect.forEach(
      services,
      (key): Effect.Effect<void, ServiceNotReady | ServiceNotServed> => {
        const row = Option.fromNullishOr(
          snap.services.find((r) => r.key === key),
        );
        return Option.match(row, {
          onNone: () =>
            Effect.fail(
              new ServiceNotServed({
                node: node.key,
                url: address,
                serviceKey: key,
                served: snap.services.map((r) => r.key),
              }),
            ),
          onSome: (r) =>
            r.ready
              ? Effect.void
              : Effect.fail(
                  new ServiceNotReady({
                    node: node.key,
                    url: address,
                    serviceKey: key,
                    ...(r.detail !== undefined ? { detail: r.detail } : {}),
                  }),
                ),
        });
      },
      { discard: true },
    );
  }
  if (snap.services.length === 0) {
    return Effect.fail(
      new ServiceNotReady({
        node: node.key,
        url: address,
        serviceKey: "*",
        detail: "no served HyperServices yet",
      }),
    );
  }
  return Option.match(
    Option.fromNullishOr(snap.services.find((r) => !r.ready)),
    {
      onNone: () => Effect.void,
      onSome: (blocked) =>
        Effect.fail(
          new ServiceNotReady({
            node: node.key,
            url: address,
            serviceKey: blocked.key,
            ...(blocked.detail !== undefined
              ? { detail: blocked.detail }
              : {}),
          }),
        ),
    },
  );
};

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
  // Dynamic import keeps Hyperlink⇄nodeStatus acyclic; Layer.build + Context provide
  // (not Effect.provide(Layer)) so R stays never for this internal dial.
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
    yield* assertServicesReady(node, address, snap, services);
  }).pipe(
    Effect.scoped,
    Effect.timeout(READY_PROBE_TIMEOUT),
    Effect.mapError((cause) => {
      if (
        Predicate.isTagged(cause, "ServiceNotReady") ||
        Predicate.isTagged(cause, "ServiceNotServed") ||
        Predicate.isTagged(cause, "UnaddressedNode") ||
        Predicate.isTagged(cause, "NodeUnreachable") ||
        Predicate.isTagged(cause, "ProtocolUnanswered")
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

/**
 * Resolve the Ready bound: explicit `ready.timeout`, else the house default.
 * Compose {@link readyTimeoutConfig} at the app edge for env override
 * (`ready: { timeout: yield* Launcher.readyTimeoutConfig }`).
 */
const resolveReadyTimeout = (
  ready: ReadyOptions | undefined,
): Duration.Duration =>
  ready?.timeout !== undefined
    ? Duration.fromInputUnsafe(ready.timeout)
    : DEFAULT_READY_TIMEOUT;

const makeHandle = (options: {
  readonly node: AnyNode;
  readonly token: Redacted.Redacted<string>;
  readonly child: LauncherChildHandle;
  readonly ready: ReadyOptions | undefined;
  readonly phase: Ref.Ref<HandlePhase>;
  readonly gate: Semaphore.Semaphore;
}): Handle => {
  const self = (): Handle => makeHandle(options);

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
    withLauncherPhase(
      options.node.key,
      "awaitReady",
      options.gate.withPermits(1)(
        Effect.gen(function* () {
          const phase = yield* Ref.get(options.phase);
          if (phase === "handedOff") {
            return yield* new HandleSpent({
              node: options.node.key,
              phase: "awaitReady",
            });
          }
          if (phase === "ready") {
            return self();
          }
          yield* Effect.logDebug("polling child Ready");
          const timeout = resolveReadyTimeout(options.ready);
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
          return self();
        }),
      ),
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
    withLauncherPhase(
      options.node.key,
      "handoff",
      options.gate.withPermits(1)(
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
          // Unref so Scope close does not kill the child; discard reref — launcher exits.
          yield* Effect.asVoid(options.child.unref);
          yield* Ref.set(options.phase, "handedOff");
          yield* Effect.logInfo("handoff complete; child unref'd");
        }),
      ),
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
  withLauncherPhase(
    spec.node.key,
    "spawn",
    Effect.gen(function* () {
      const token = yield* mintToken;
      const clear = Redacted.value(token);
      const command =
        typeof spec.process === "function" ? spec.process(clear) : spec.process;
      const child = yield* command;
      const phase = yield* Ref.make<HandlePhase>("spawned");
      const gate = yield* Semaphore.make(1);
      yield* Effect.logInfo("child spawned under launcher custody").pipe(
        Effect.annotateLogs({ "launcher.pid": String(child.pid) }),
      );
      return makeHandle({
        node: spec.node,
        token,
        child,
        ready: spec.ready,
        phase,
        gate,
      });
    }),
  );

/**
 * One-shot bring-up: spawn → awaitReady → handoff per unit, then the launcher may exit.
 * Accepts one {@link SpawnSpec} or a readonly array (not {@link Group}). Units run
 * sequentially (`Effect.forEach` concurrency 1) so custody stays ordered.
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
  withLauncherPhase(
    "up",
    "up",
    Effect.gen(function* () {
      const units = isSpawnSpec(spec) ? [spec] : spec;
      yield* Effect.logInfo("Launcher.up starting").pipe(
        Effect.annotateLogs({ "launcher.units": String(units.length) }),
      );
      yield* Effect.forEach(
        units,
        (unit) =>
          spawn(unit).pipe(
            Effect.flatMap((handle) => handle.awaitReady()),
            Effect.flatMap((handle) => handle.handoff()),
          ),
        { concurrency: 1 },
      );
      yield* Effect.logInfo("Launcher.up complete");
    }),
  );
