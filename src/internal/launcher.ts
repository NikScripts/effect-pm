/**
 * @module internal/launcher
 *
 * Spine-α spawn-and-exit launcher — mint token, spawn OS child, poll Ready, `Node.assume`, unref.
 * Node-platform only (`ChildProcessSpawner` + Scope). Wire-portable pieces stay on {@link Node}.
 *
 * Effect-first: `Schedule` + `TestClock`-friendly Ready poll, `Semaphore` single-flight on the
 * handle, Config resolved at `spawn`, `command` / `entry` token injection, Effect `Metric`s,
 * `withSpan` / `withLogSpan` on every phase, fail-closed kill on Ready timeout, `_tag` predicates
 * (never `instanceof`), `Effect.forEach` for `up`.
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  Config,
  Context,
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
import * as Identity from "../Identity";
import * as Lookup from "../Lookup";
import * as Policy from "../Policy";
import {
  AssumeNotReady,
  AssumeTokenMismatch,
  AssumeTokenReused,
} from "./nodeAssume";
import { ASSUME_TOKEN_ENV, assume as nodeAssume } from "./nodeAssumeClient";
import {
  asLookup,
  isAddressedNode,
  NodeUnreachable,
  ProtocolUnanswered,
  ServiceNotReady,
  ServiceNotServed,
  Tag as makeNode,
  UnaddressedNode,
  type AnyNode,
} from "./nodeCore";
import type { NodeStatus } from "./nodeStatus";
import { mintAssumeToken, type Token } from "./launcherToken";

export type { Token } from "./launcherToken";

// =============================================================================
// Config + platform layer
// =============================================================================

/** Default Ready outer bound when `ready.timeout` is omitted and Config is unset. */
const DEFAULT_READY_TIMEOUT = Duration.seconds(30);

/** Default Ready poll spacing when `ready.poll` is omitted and Config is unset. */
const DEFAULT_READY_POLL = Duration.millis(100);

/** Per-dial bound so a hung connect cannot stall the outer Ready timeout. */
const READY_PROBE_TIMEOUT = Duration.seconds(2);

/**
 * Effect {@link Config} for the Ready wait bound (`HYPERLINK_LAUNCHER_READY_TIMEOUT`).
 * Read at {@link spawn} when `ready.timeout` is omitted (default 30 seconds).
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
 * Read at {@link spawn} when `ready.poll` is omitted (default 100 millis).
 *
 * @category config
 * @public
 */
export const readyPollConfig: Config.Config<Duration.Duration> =
  Config.duration("HYPERLINK_LAUNCHER_READY_POLL").pipe(
    Config.withDefault(DEFAULT_READY_POLL),
  );

/**
 * Node-platform Layer (`NodeServices` — includes `ChildProcessSpawner`).
 * Provide at the app edge instead of hand-rolling platform merges.
 *
 * @category layers
 * @public
 */
export const layer: Layer.Layer<NodeServices.NodeServices> =
  NodeServices.layer;

// =============================================================================
// Models
// =============================================================================

/** How the assume token is injected into the child process. @public */
export type TokenInjection = "env" | "argv" | "both";

/**
 * HyperService identity for {@link ReadyOptions.services} — wire-key string or Tag
 * (`{ key }` / Hyperlink tag; prefers {@link Hyperlink.wireKeyOf} when present).
 *
 * @category models
 * @public
 */
export type ServiceRef = string | { readonly key: string };

/**
 * Options for {@link command} — Effect `ChildProcess` options plus token injection mode.
 *
 * @category models
 * @public
 */
export interface CommandOptions extends ChildProcess.CommandOptions {
  /**
   * Where to put the minted assume token. Default `"env"` → `HYPERLINK_ASSUME_TOKEN`.
   * `"argv"` inserts the token into argv; `"both"` does both.
   */
  readonly token?: TokenInjection;
  /**
   * Index into `args` at which to insert the token when using `"argv"` / `"both"`.
   * Omit ⇒ append after `args`.
   */
  readonly tokenArgvAt?: number;
}

/**
 * Options for {@link entry} — {@link CommandOptions} plus exec / execArgs before the entry path.
 *
 * @category models
 * @public
 */
export interface EntryOptions extends CommandOptions {
  /** Executable. Default `"node"`. */
  readonly exec?: string;
  /** Args before the entry path (e.g. `["exec", "tsx"]` with `exec: "pnpm"`). */
  readonly execArgs?: ReadonlyArray<string>;
}

/**
 * Ready-wait options on a spawn unit — omit `services` for allReady-shaped; omit `timeout` /
 * `poll` to read {@link readyTimeoutConfig} / {@link readyPollConfig} at {@link spawn}.
 *
 * @category models
 * @public
 */
export interface ReadyOptions {
  /** HyperService Tags or wire keys to wait on; omit ⇒ all served services Ready. */
  readonly services?: ReadonlyArray<ServiceRef>;
  readonly timeout?: Duration.Input;
  /** Poll spacing while waiting for Ready; omit ⇒ {@link readyPollConfig}. */
  readonly poll?: Duration.Input;
}

/** Ready options resolved at spawn (no further Config reads on the Handle). @internal */
interface ResolvedReady {
  readonly services: ReadonlyArray<string> | undefined;
  readonly timeout: Duration.Duration;
  readonly poll: Duration.Duration;
}

/**
 * When {@link SpawnSpec.node} is already Ready at its dial address.
 *
 * - `"fail"` (default) — {@link NodeAlreadyUp}; `spawn` / `up` stay create-shaped
 * - `"adopt"` — skip spawn for that unit (no Handle; not custody). Ready-proved only.
 *
 * Bare skip without a Ready probe is rejected. Never implies migration-handoff or
 * Directory replace — membership stays on Lookup.
 *
 * @category models
 * @public
 */
export type AlreadyUp = "fail" | "adopt";

/**
 * One spawn unit — dial target + Effect `ChildProcess` command (or a factory that receives the
 * minted cleartext token for open injection into env/argv). Prefer {@link command} / {@link entry}.
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
  /**
   * Already-up Policy for this unit (overrides {@link UpOptions.alreadyUp}).
   * {@link spawn} always treats already-Ready as {@link NodeAlreadyUp} (create-only).
   */
  readonly alreadyUp?: AlreadyUp;
}

/**
 * Options for {@link ensureLookup} — resolve an ipc Lookup address, adopt when
 * already up, otherwise spawn a Lookup-only child under launcher custody.
 *
 * @category models
 * @public
 */
export interface EnsureLookupOptions {
  /**
   * Unix socket path. Omit ⇒ {@link Lookup.defaultIpcPath} (safe same-machine default).
   */
  readonly path?: string;
  /**
   * Lookup node. When omitted, a Tag is minted at {@link path} and branded
   * `Node.asLookup`. Must be ipc-addressed (`path` set) when provided.
   */
  readonly node?: AnyNode & { readonly key: string; readonly path?: string };
  /**
   * Spawn factory when Lookup is not answering. Receives the minted cleartext
   * assume token (same as {@link SpawnSpec.process}). Omit ⇒ fail
   * {@link LookupNotRunning} when not already up.
   */
  readonly process?:
    | ChildProcess.Command
    | ((token: string) => ChildProcess.Command);
  readonly ready?: ReadyOptions;
}

/**
 * Result of {@link ensureLookup} — dial target for app units (`Lookup.client` /
 * `Lookup.follow` / child argv).
 *
 * @category models
 * @public
 */
export interface EnsureLookupResult {
  /** Addressed Lookup node (branded `asLookup`). */
  readonly node: AnyNode & { readonly path: string };
  readonly path: string;
  /** True when this call spawned + handed off a Lookup-only child. */
  readonly spawned: boolean;
}

/**
 * Options for {@link up} — concurrency across spawn units (default sequential).
 *
 * @category models
 * @public
 */
export interface UpOptions {
  /** `Effect.forEach` concurrency. Default `1` (ordered custody). */
  readonly concurrency?: number | "unbounded";
  /**
   * Ensure a Lookup is available **before** app units (ensure-Lookup-first).
   * Already answering at the path → adopt (no spawn). Otherwise spawn a
   * Lookup-only child via {@link EnsureLookupOptions.process}, or fail closed.
   * Does **not** Soft-bake Lookup onto app nodes.
   */
  readonly lookup?: EnsureLookupOptions;
  /**
   * Default {@link AlreadyUp} for units that omit {@link SpawnSpec.alreadyUp}.
   * Default `"fail"` — `up` stays create-shaped unless you opt into `"adopt"`.
   */
  readonly alreadyUp?: AlreadyUp;
}

// =============================================================================
// Errors
// =============================================================================

/**
 * Ready poll expired before the child reported Ready. The OS child is kill-reaped
 * (fail-closed) before this error surfaces.
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
 * Custody handle used after handoff / kill — `.awaitReady` / `.handoff` / `.kill` must not run again.
 *
 * @category errors
 * @public
 */
export class HandleSpent extends Data.TaggedError("HandleSpent")<{
  readonly node: string;
  readonly phase: "awaitReady" | "handoff" | "kill";
}> {
  override get message() {
    return `Launcher.Handle for "${this.node}" is spent — cannot ${this.phase} after handoff/kill.`;
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

/**
 * {@link ensureLookup} found no answering Lookup and no {@link EnsureLookupOptions.process}
 * to spawn one — fail closed (do not Soft-bake onto an app node).
 *
 * @category errors
 * @public
 */
export class LookupNotRunning extends Data.TaggedError("LookupNotRunning")<{
  readonly path: string;
}> {
  override get message() {
    return (
      `Launcher.ensureLookup: nothing answering at "${this.path}" and no ` +
      `process to spawn a Lookup-only child.`
    );
  }
}

/**
 * {@link ensureLookup} has no dialable Lookup address (unaddressed node; no path and
 * no safe default applies).
 *
 * @category errors
 * @public
 */
export class LookupAddressRequired extends Data.TaggedError(
  "LookupAddressRequired",
)<{
  readonly node: string;
}> {
  override get message() {
    return (
      `Launcher.ensureLookup: node "${this.node}" has no ipc path — provide ` +
      `{ path } or an addressed Lookup node.`
    );
  }
}

/**
 * Dial target for a {@link SpawnSpec} is already Ready — create refused.
 * Opt into {@link AlreadyUp} `"adopt"` on {@link up} to skip spawn for that unit
 * (no Handle). Never means migration-handoff or Directory steal.
 *
 * @category errors
 * @public
 */
export class NodeAlreadyUp extends Data.TaggedError("NodeAlreadyUp")<{
  readonly node: string;
}> {
  override get message() {
    return (
      `Launcher: node "${this.node}" is already Ready at its dial address — ` +
      `spawn refused (use alreadyUp: "adopt" on up to ensure without custody).`
    );
  }
}

// =============================================================================
// Token injection helpers
// =============================================================================

/** Tag or wire key → status service key string. @internal */
const serviceKeyOf = (service: ServiceRef): string => {
  if (typeof service === "string") {
    return service;
  }
  if (Predicate.hasProperty(service, Hyperlink.wireKeySym)) {
    const wk = service[Hyperlink.wireKeySym];
    if (typeof wk === "string") {
      return wk;
    }
  }
  return service.key;
};

/** Insert `token` into a copy of `args` at `at` (default: append). @internal */
const insertTokenArgv = (
  args: ReadonlyArray<string>,
  token: string,
  at: number | undefined,
): Array<string> => {
  const next = [...args];
  next.splice(at === undefined ? next.length : at, 0, token);
  return next;
};

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
  const tokenArgvAt = options?.tokenArgvAt;
  const {
    token: _tokenMode,
    tokenArgvAt: _tokenArgvAt,
    env: baseEnv,
    extendEnv,
    ...rest
  } = options ?? {};
  return (clearToken: string) => {
    const argv =
      injection === "argv" || injection === "both"
        ? insertTokenArgv(args, clearToken, tokenArgvAt)
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

/**
 * Entry-path sugar over {@link command} — `exec` + `execArgs` + path, with the same token injection.
 *
 * @example
 * ```ts
 * Launcher.entry("./worker.js")
 * Launcher.entry("./worker.ts", { exec: "pnpm", execArgs: ["exec", "tsx"], token: "argv" })
 * ```
 *
 * @category constructors
 * @public
 */
export const entry = (
  path: string,
  options?: EntryOptions,
): ((token: string) => ChildProcess.Command) => {
  const exec = options?.exec ?? "node";
  const execArgs = options?.execArgs ?? [];
  const {
    exec: _exec,
    execArgs: _execArgs,
    ...commandOpts
  } = options ?? {};
  return command(exec, [...execArgs, path], commandOpts);
};

// =============================================================================
// Metrics
// =============================================================================

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

// =============================================================================
// Handle
// =============================================================================

type LauncherChildHandle = ChildProcessSpawner.ChildProcessHandle;
type HandlePhase = "spawned" | "ready" | "handedOff" | "killed";

const isSpentPhase = (
  phase: HandlePhase,
): phase is "handedOff" | "killed" =>
  phase === "handedOff" || phase === "killed";

/**
 * Custody handle — only {@link spawn} / {@link up} construct these. After {@link Handle.handoff}
 * or {@link Handle.kill}, do not use the handle for control; the launcher may exit.
 *
 * @category models
 * @public
 */
export interface Handle {
  /** Minted assume token (redacted brand — never cleartext in logs). */
  readonly token: Redacted.Redacted<Token>;
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
  /**
   * SIGTERM the OS child and spend the handle. Safe after spawn; fails {@link HandleSpent}
   * after handoff/kill. Ready timeout also kill-reaps automatically.
   */
  readonly kill: () => Effect.Effect<void, HandleSpent | PlatformError>;
}

const isSpawnSpec = (value: unknown): value is SpawnSpec =>
  typeof value === "object" &&
  value !== null &&
  "node" in value &&
  "process" in value;

/**
 * Mint an opaque high-entropy assume token (CSPRNG hex), brand as {@link Token}, wrap in {@link Redacted}.
 *
 * @category constructors
 * @public
 */
export const mintToken: Effect.Effect<Redacted.Redacted<Token>> =
  mintAssumeToken;

// =============================================================================
// Internals — Ready probe
// =============================================================================

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

const isTransientReadyFailure = (err: unknown): boolean =>
  Predicate.isTagged(err, "ServiceNotReady") ||
  Predicate.isTagged(err, "ServiceNotServed") ||
  Predicate.isTagged(err, "NodeUnreachable") ||
  Predicate.isTagged(err, "ProtocolUnanswered");

/** Best-effort SIGTERM — ignore fail/defect if the child is already gone. */
const reapChild = (
  child: LauncherChildHandle,
): Effect.Effect<void> =>
  child.kill().pipe(Effect.catchCause(() => Effect.void));

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
        Policy.provide(Policy.verifyOff),
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

/** Resolve Ready options once at spawn — Handle phases do not re-read Config. */
const resolveReady = (
  ready: ReadyOptions | undefined,
): Effect.Effect<ResolvedReady, ConfigError> =>
  Effect.gen(function* () {
    const timeout =
      ready?.timeout !== undefined
        ? Duration.fromInputUnsafe(ready.timeout)
        : yield* readyTimeoutConfig;
    const poll =
      ready?.poll !== undefined
        ? Duration.fromInputUnsafe(ready.poll)
        : yield* readyPollConfig;
    const services =
      ready?.services === undefined
        ? undefined
        : ready.services.map(serviceKeyOf);
    return { timeout, poll, services };
  });

const makeHandle = (options: {
  readonly node: AnyNode;
  readonly token: Redacted.Redacted<Token>;
  readonly child: LauncherChildHandle;
  readonly ready: ResolvedReady;
  readonly phase: Ref.Ref<HandlePhase>;
  readonly gate: Semaphore.Semaphore;
}): Handle => {
  const self = (): Handle => makeHandle(options);
  const nodeKey = options.node.key;
  const nodeAttrs = { "launcher.node": nodeKey };

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
      nodeKey,
      "awaitReady",
      options.gate.withPermits(1)(
        Effect.gen(function* () {
          const phase = yield* Ref.get(options.phase);
          if (isSpentPhase(phase)) {
            return yield* new HandleSpent({
              node: nodeKey,
              phase: "awaitReady",
            });
          }
          if (phase === "ready") {
            return self();
          }
          yield* Effect.logDebug("polling child Ready");
          const { timeout, poll, services } = options.ready;
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
                    node: nodeKey,
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
                  node: nodeKey,
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
                ).pipe(
                  Effect.andThen(
                    // Fail-closed: reap the child so a timed-out bring-up does not leak.
                    reapChild(options.child).pipe(
                      Effect.andThen(Ref.set(options.phase, "killed")),
                    ),
                  ),
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
      nodeKey,
      "handoff",
      options.gate.withPermits(1)(
        Effect.gen(function* () {
          const phase = yield* Ref.get(options.phase);
          if (isSpentPhase(phase)) {
            return yield* new HandleSpent({
              node: nodeKey,
              phase: "handoff",
            });
          }
          if (phase !== "ready") {
            return yield* new HandleNotReady({ node: nodeKey });
          }
          yield* Effect.logDebug("calling Node.assume");
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

  const kill = (): Effect.Effect<void, HandleSpent | PlatformError> =>
    withLauncherPhase(
      nodeKey,
      "kill",
      options.gate.withPermits(1)(
        Effect.gen(function* () {
          const phase = yield* Ref.get(options.phase);
          if (isSpentPhase(phase)) {
            return yield* new HandleSpent({
              node: nodeKey,
              phase: "kill",
            });
          }
          yield* Effect.logInfo("killing child under launcher custody");
          yield* options.child.kill();
          yield* Ref.set(options.phase, "killed");
        }),
      ),
    );

  return {
    token: options.token,
    node: options.node,
    awaitReady,
    handoff,
    kill,
  };
};

// =============================================================================
// Public constructors
// =============================================================================

/** True when node-status reports Ready for the unit's services. @internal */
const probePeerReady = (
  node: AnyNode,
  services: ReadonlyArray<string> | undefined,
): Effect.Effect<boolean> =>
  probeReady(node, services).pipe(
    Effect.as(true),
    Effect.catch(() => Effect.succeed(false)),
  );

/**
 * Spawn one OS child under launcher custody — mints an assume token, resolves Ready Config,
 * runs `process`, returns a {@link Handle}. Requires `ChildProcessSpawner` + `Scope`
 * (provide {@link layer} at the app edge).
 *
 * Create-only: if the dial target is already Ready, fails {@link NodeAlreadyUp}.
 * Ensure-with-adopt is on {@link up} via {@link AlreadyUp} `"adopt"` (no Handle).
 *
 * @category constructors
 * @public
 */
export const spawn = (
  spec: SpawnSpec,
): Effect.Effect<
  Handle,
  | NodeAlreadyUp
  | PlatformError
  | ConfigError,
  ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
> =>
  withLauncherPhase(
    spec.node.key,
    "spawn",
    Effect.gen(function* () {
      const ready = yield* resolveReady(spec.ready);
      if (yield* probePeerReady(spec.node, ready.services)) {
        return yield* new NodeAlreadyUp({ node: spec.node.key });
      }
      const token = yield* mintToken;
      const clear = Redacted.value(token);
      const processCommand =
        typeof spec.process === "function" ? spec.process(clear) : spec.process;
      const child = yield* processCommand;
      const phase = yield* Ref.make<HandlePhase>("spawned");
      const gate = yield* Semaphore.make(1);
      yield* Effect.logInfo("child spawned under launcher custody").pipe(
        Effect.annotateLogs({ "launcher.pid": String(child.pid) }),
      );
      return makeHandle({
        node: spec.node,
        token,
        child,
        ready,
        phase,
        gate,
      });
    }),
  );

/** Probe whether Identity answers at the Lookup address (scoped; no Soft-bake). @internal */
const probeLookupAnswering = (
  node: AnyNode & { readonly path: string },
): Effect.Effect<boolean> =>
  Effect.scoped(
    Effect.gen(function* () {
      const ctx = yield* Layer.build(
        Lookup.client(node).pipe(Policy.provide(Policy.verifyOff)),
      );
      const id = Context.get(ctx, Identity.Tag);
      yield* id
        .resolve(
          new Identity.ResolveRequest({
            key: "hyperlink-ts/Launcher/ensureLookup/probe",
          }),
        )
        .pipe(Effect.provide(ctx));
    }),
  ).pipe(
    Effect.timeout(Duration.seconds(1)),
    Effect.as(true),
    Effect.catch(() => Effect.succeed(false)),
  );

/**
 * Ensure a Lookup is available at an ipc path **before** app units (ensure-Lookup-first).
 *
 * | Situation | Behaviour |
 * |-----------|-----------|
 * | Lookup already answering | Adopt — no spawn, no migration-handoff |
 * | Not answering + {@link EnsureLookupOptions.process} | Spawn Lookup-only → awaitReady → handoff |
 * | Not answering + no process | {@link LookupNotRunning} (fail closed) |
 * | Unaddressed node / no path | {@link LookupAddressRequired} |
 *
 * Soft-bake stays for independent launch only — this never pipes `Lookup.layer` onto app nodes.
 *
 * ```ts
 * const lookup = yield* Launcher.ensureLookup({
 *   path: lookupSock,
 *   process: Launcher.command("pnpm", ["exec", "tsx", lookupEntry, lookupSock], {
 *     token: "argv",
 *   }),
 * })
 * yield* Launcher.up({ node: worker, process: … })
 * // children dial Lookup.clientOptions({ path: lookup.path })
 * ```
 *
 * Or compose via {@link UpOptions.lookup} on {@link up}.
 *
 * @category constructors
 * @public
 */
export const ensureLookup = (
  options?: EnsureLookupOptions,
): Effect.Effect<
  EnsureLookupResult,
  | LookupNotRunning
  | LookupAddressRequired
  | NodeAlreadyUp
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
    options?.node?.key ?? "lookup",
    "ensureLookup",
    Effect.gen(function* () {
      const path =
        options?.path ?? options?.node?.path ?? Lookup.defaultIpcPath;
      if (
        options?.node !== undefined &&
        options.node.path === undefined &&
        options.path === undefined
      ) {
        return yield* new LookupAddressRequired({ node: options.node.key });
      }
      const seed = (
        options?.node !== undefined
          ? makeNode()(options.node.key, { path }).pipe(asLookup)
          : makeNode()("hyperlink-ts/Launcher/Lookup", { path }).pipe(asLookup)
      ) as AnyNode & { readonly path: string };

      yield* Effect.logInfo("ensureLookup probing").pipe(
        Effect.annotateLogs({
          "launcher.lookup_path": seed.path,
          "launcher.lookup_node": seed.key,
        }),
      );

      if (yield* probeLookupAnswering(seed)) {
        yield* Effect.logInfo("ensureLookup adopted live Lookup (no spawn)");
        return {
          node: seed,
          path: seed.path,
          spawned: false,
        } satisfies EnsureLookupResult;
      }

      if (options?.process === undefined) {
        return yield* new LookupNotRunning({ path: seed.path });
      }

      yield* Effect.logInfo("ensureLookup spawning Lookup-only child");
      const handle = yield* spawn({
        node: seed,
        process: options.process,
        ready: options.ready,
      });
      yield* handle.awaitReady();
      yield* handle.handoff();
      yield* Effect.logInfo("ensureLookup Lookup-only child handed off");
      return {
        node: seed,
        path: seed.path,
        spawned: true,
      } satisfies EnsureLookupResult;
    }),
  );

/**
 * One-shot bring-up: optional {@link UpOptions.lookup} (ensure-Lookup-first), then
 * per unit either adopt an already-Ready peer ({@link AlreadyUp} `"adopt"`) or
 * spawn → awaitReady → handoff. Default already-up Policy is `"fail"`
 * ({@link NodeAlreadyUp}). Accepts one {@link SpawnSpec} or a readonly array
 * (not {@link Group}). Units run with {@link UpOptions.concurrency} (default `1`).
 *
 * @category constructors
 * @public
 */
export const up = (
  spec: SpawnSpec | ReadonlyArray<SpawnSpec>,
  options?: UpOptions,
): Effect.Effect<
  void,
  | LookupNotRunning
  | LookupAddressRequired
  | NodeAlreadyUp
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
      if (options?.lookup !== undefined) {
        yield* ensureLookup(options.lookup);
      }
      const units = isSpawnSpec(spec) ? [spec] : spec;
      const defaultAlreadyUp: AlreadyUp = options?.alreadyUp ?? "fail";
      yield* Effect.logInfo("Launcher.up starting").pipe(
        Effect.annotateLogs({
          "launcher.units": String(units.length),
          "launcher.already_up": defaultAlreadyUp,
        }),
      );
      yield* Effect.forEach(
        units,
        (unit) =>
          Effect.gen(function* () {
            const mode: AlreadyUp = unit.alreadyUp ?? defaultAlreadyUp;
            if (mode === "adopt") {
              const ready = yield* resolveReady(unit.ready);
              if (yield* probePeerReady(unit.node, ready.services)) {
                yield* Effect.logInfo(
                  "adopted already-up peer (no spawn / no Handle)",
                ).pipe(
                  Effect.annotateLogs({ "launcher.node": unit.node.key }),
                );
                return;
              }
            }
            yield* spawn(unit).pipe(
              Effect.flatMap((handle) => handle.awaitReady()),
              Effect.flatMap((handle) => handle.handoff()),
            );
          }),
        { concurrency: options?.concurrency ?? 1 },
      );
      yield* Effect.logInfo("Launcher.up complete");
    }),
  );
