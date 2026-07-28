/**
 * @module internal/launcher
 *
 * Spine-α spawn-and-exit launcher — mint token, spawn OS child, poll Ready, `Node.assume`, unref.
 * Node-platform only (`ChildProcessSpawner` + Scope). Wire-portable pieces stay on {@link Node}.
 *
 * Effect-first: `Schedule` + `TestClock`-friendly Ready poll, `Semaphore` single-flight on the
 * handle, `Config` auto-read for Ready timeout/poll, `command` token injection, Effect `Metric`s, `withSpan` /
 * `withLogSpan` on every phase, `_tag` predicates (never `instanceof`), `Effect.forEach` for `up`.
 */
import {
  Config,
  Data,
  Duration,
  Effect,
  Layer,
  Metric,
  Option,
  Predicate,
  Redacted,
  Ref,
  Schedule,
  Semaphore,
  type Scope,
} from "effect";
import type { ConfigError } from "effect/Config";
import type { PlatformError } from "effect/PlatformError";
import {
  ChildProcess,
  ChildProcessSpawner,
} from "effect/unstable/process";
import * as Hyperlink from "../Hyperlink";
import {
  AssumeNotReady,
  AssumeTokenMismatch,
  AssumeTokenReused,
} from "./nodeAssume";
import { ASSUME_TOKEN_ENV, assume as nodeAssume } from "./nodeAssumeClient";
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

/** Default Ready outer bound when `ready.timeout` is omitted and Config is unset. */
const DEFAULT_READY_TIMEOUT = Duration.seconds(30);

/** Default Ready poll spacing when `ready.poll` is omitted and Config is unset. */
const DEFAULT_READY_POLL = Duration.millis(100);

/** Per-dial bound so a hung connect cannot stall the outer Ready timeout. */
const READY_PROBE_TIMEOUT = Duration.seconds(2);

/**
 * Effect {@link Config} for the Ready wait bound (`HYPERLINK_LAUNCHER_READY_TIMEOUT`).
 * Read automatically when `ready.timeout` is omitted (default 30 seconds).
 *
 * @category config
 * @public
 */
export const readyTimeoutConfig: Config.Config<Duration.Duration> =
  Config.duration("HYPERLINK_LAUNCHER_READY_TIMEOUT").pipe(
    Config.withDefault(DEFAULT_READY_TIMEOUT),
  );

/**
 * Effect {@link Config} for Ready poll spacing (`HYPERLINK_LAUNCHER_READY_POLL`).
 * Read automatically when `ready.poll` is omitted (default 100 millis).
 *
 * @category config
 * @public
 */
export const readyPollConfig: Config.Config<Duration.Duration> =
  Config.duration("HYPERLINK_LAUNCHER_READY_POLL").pipe(
    Config.withDefault(DEFAULT_READY_POLL),
  );

/** How the assume token is injected into the child process. @public */
export type TokenInjection = "env" | "argv" | "both";

/**
 * Options for {@link command} — Effect `ChildProcess` options plus token injection mode.
 *
 * @category models
 * @public
 */
export interface CommandOptions extends ChildProcess.CommandOptions {
  /**
   * Where to put the minted assume token. Default `"env"` → `HYPERLINK_ASSUME_TOKEN`.
   * `"argv"` appends the token as the last argument; `"both"` does both.
   */
  readonly token?: TokenInjection;
}

/**
 * Ready-wait options on a spawn unit — omit `services` for allReady-shaped; omit `timeout` /
 * `poll` to read {@link readyTimeoutConfig} / {@link readyPollConfig}.
 *
 * @category models
 * @public
 */
export interface ReadyOptions {
  /** HyperService wire keys to wait on; omit ⇒ all served services Ready. */
  readonly services?: ReadonlyArray<string>;
  readonly timeout?: Duration.Input;
  /** Poll spacing while waiting for Ready; omit ⇒ {@link readyPollConfig}. */
  readonly poll?: Duration.Input;
}

/**
 * One spawn unit — dial target + Effect `ChildProcess` command (or a factory that receives the
 * minted cleartext token for open injection into env/argv). Prefer {@link command} for the
 * factory form.
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
 * Build a `SpawnSpec.process` factory that injects the assume token into env and/or argv.
 *
 * @example
 * ```ts
 * Launcher.up({
 *   node: worker,
 *   process: Launcher.command("node", ["./worker.js"], { token: "env" }),
 * })
 * ```
 *
 * @category constructors
 * @public
 */
export const command = (
  cmd: string,
  args: ReadonlyArray<string> = [],
  options?: CommandOptions,
): ((token: string) => ChildProcess.Command) => {
  const injection: TokenInjection = options?.token ?? "env";
  const {
    token: _tokenMode,
    env: baseEnv,
    extendEnv,
    ...rest
  } = options ?? {};
  return (clearToken: string) => {
    const argv =
      injection === "argv" || injection === "both"
        ? [...args, clearToken]
        : [...args];
    const env =
      injection === "env" || injection === "both"
        ? { ...(baseEnv ?? {}), [ASSUME_TOKEN_ENV]: clearToken }
        : baseEnv;
    return ChildProcess.make(cmd, argv, {
      ...rest,
      ...(env !== undefined ? { env } : {}),
      // Default merge with process env so PATH / etc. survive token injection.
      extendEnv: extendEnv ?? true,
    });
  };
};

// ─── OTEL metrics (Effect Metric → runtime metric reader) ───────────────────
const readyLatencyBoundaries = Metric.exponentialBoundaries({
  start: 1,
  factor: 2,
  count: 16,
});
const readyDurationMs = Metric.histogram("launcher_ready_duration_ms", {
  description: "Launcher awaitReady elapsed time in milliseconds",
  boundaries: readyLatencyBoundaries,
});
const readyTimeoutTotal = Metric.counter("launcher_ready_timeout_total", {
  incremental: true,
  description: "Launcher ReadyTimedOut count",
});
const childExitedTotal = Metric.counter("launcher_child_exited_total", {
  incremental: true,
  description: "Launcher ChildExited count during awaitReady",
});
const handoffTotal = Metric.counter("launcher_handoff_total", {
  incremental: true,
  description: "Launcher handoff attempts by outcome",
});

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
    | ConfigError
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

/** Explicit `ready.timeout`, else {@link readyTimeoutConfig}. */
const resolveReadyTimeout = (
  ready: ReadyOptions | undefined,
): Effect.Effect<Duration.Duration, ConfigError> =>
  ready?.timeout !== undefined
    ? Effect.succeed(Duration.fromInputUnsafe(ready.timeout))
    : readyTimeoutConfig;

/** Explicit `ready.poll`, else {@link readyPollConfig}. */
const resolveReadyPoll = (
  ready: ReadyOptions | undefined,
): Effect.Effect<Duration.Duration, ConfigError> =>
  ready?.poll !== undefined
    ? Effect.succeed(Duration.fromInputUnsafe(ready.poll))
    : readyPollConfig;

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
    | ConfigError
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
          const timeout = yield* resolveReadyTimeout(options.ready);
          const poll = yield* resolveReadyPoll(options.ready);
          const services = options.ready?.services;
          const nodeAttrs = { "launcher.node": options.node.key };
          const wait = probeReady(options.node, services).pipe(
            Effect.retry({
              while: isTransientReadyFailure,
              schedule: Schedule.spaced(poll),
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
          const [elapsed] = yield* Effect.timed(
            Effect.raceFirst(wait, childDied),
          ).pipe(
            Effect.tapError((err) => {
              if (Predicate.isTagged(err, "ReadyTimedOut")) {
                return Metric.update(
                  Metric.withAttributes(readyTimeoutTotal, nodeAttrs),
                  1,
                );
              }
              if (Predicate.isTagged(err, "ChildExited")) {
                return Metric.update(
                  Metric.withAttributes(childExitedTotal, nodeAttrs),
                  1,
                );
              }
              return Effect.void;
            }),
          );
          yield* Metric.update(
            Metric.withAttributes(readyDurationMs, nodeAttrs),
            Duration.toMillis(elapsed),
          );
          yield* Ref.set(options.phase, "ready");
          yield* Effect.logInfo("child Ready").pipe(
            Effect.annotateLogs({
              "launcher.ready_ms": String(Duration.toMillis(elapsed)),
            }),
          );
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
          const nodeAttrs = { "launcher.node": options.node.key };
          yield* nodeAssume(options.node, {
            token: Redacted.value(options.token),
          }).pipe(
            Effect.tap(() =>
              Metric.update(
                Metric.withAttributes(handoffTotal, {
                  ...nodeAttrs,
                  "launcher.outcome": "ok",
                }),
                1,
              ),
            ),
            Effect.tapError(() =>
              Metric.update(
                Metric.withAttributes(handoffTotal, {
                  ...nodeAttrs,
                  "launcher.outcome": "error",
                }),
                1,
              ),
            ),
          );
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
  | PlatformError
  | ConfigError,
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
