/**
 * @module internal/nodeStatus
 *
 * The reserved **node status** resource — every node that serves a group over
 * {@link Node.httpServer} automatically also serves this, so a client can ask any node
 * "are you up, how long, how many HyperServices, and what are your logs?" without the node author
 * wiring anything. It's a nodeless {@link Hyperlink.Tag} (one reserved group id); a client reaches
 * a specific node by pointing the ambient transport at that node's url.
 *
 * Kept internal so {@link Hyperlink} can dynamically import it from `httpServer` without a
 * static cycle (`Hyperlink` ⇄ this). The public face is the NODE HANDLE accessors (`yield* node`
 * -> ping/status/logs) wired in `internal/nodeConnect`; see `Node` for the light status types.
 */
import {
  Clock,
  Context,
  DateTime,
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
  Redacted,
  Ref,
  Schema,
  Stream,
} from "effect";
import type { ProtocolKind } from "./nodeCore";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { FetchHttpClient } from "effect/unstable/http";
import type { AddressedNode } from "./nodeCore";
import * as Hyperlink from "../Hyperlink";
import { NodeUnreachable, type NodeStatusAccessors } from "./nodeCore";
import { Relay as LogRelay } from "../Logs";
import { LogEntrySchema } from "../LogEntry";
import type { LogEntry } from "../LogEntry";
import { queryDurableNode } from "./logs/durableRead";
import {
  AssumeNotReady,
  AssumeTokenMismatch,
  AssumeTokenReused,
  assumeError,
  assumePayload,
  nodeOwnership,
  type NodeOwnership,
} from "./nodeAssume";

/** The reserved group id (wire prefix) for the node status resource. */
const NODE_STATUS_KEY = "hyperlink-ts/node-status";

/** How often the live {@link NodeStatusTag} `status` stream re-emits a snapshot. */
const STATUS_INTERVAL = Duration.seconds(2);

/**
 * One served HyperService's readiness, as the node reports it — its wire key, {@link Hyperlink.kindOf}
 * kind, optional F4 {@link contractHash}, whether it's ready, and (when not) why. The element of
 * {@link nodeStatus}'s `services`.
 *
 * @internal
 */
export const serviceReadiness = Schema.Struct({
  key: Schema.String,
  kind: Schema.String,
  ready: Schema.Boolean,
  detail: Schema.optionalKey(Schema.String),
  /** Wire-contract fingerprint (F4) — stamped at serve from the tag Spec. */
  contractHash: Schema.optionalKey(Schema.String),
});

/** A served HyperService's readiness as reported by its node. @internal */
export type ServiceReadiness = typeof serviceReadiness.Type;

/**
 * Node lifecycle phase — WorkPool-shaped (`running` | `draining`).
 * `draining` means intentional cutover drain: still reachable (≠ dead), Directory row held,
 * cooperative {@link NodeStatusTag}.`yield` refuses (fail-closed).
 *
 * @internal
 */
export const nodePhase = Schema.Literals(["running", "draining"]);

/** Node lifecycle phase. @internal */
export type NodePhase = typeof nodePhase.Type;

/**
 * A node's live status — whether it's up, its overall readiness rollup, when it started, how long
 * it's been up, how many HyperServices it serves, and each HyperService's readiness. `status` is `degraded`
 * (and `/health` returns 503) when any served resource is not ready.
 *
 * @internal
 */
export const nodeStatus = Schema.Struct({
  up: Schema.Boolean,
  status: Schema.Literals(["ok", "degraded"]),
  /**
   * Lifecycle phase — `draining` is intentional Track C cutover (reachable; yield refuse).
   * Distinct from readiness `status` (`ok` / `degraded`).
   */
  phase: nodePhase,
  startedAt: Schema.DateTimeUtc,
  uptimeMillis: Schema.Number,
  serviceCount: Schema.Number,
  services: Schema.Array(serviceReadiness),
  /**
   * Custody mirror when the node was started with an assume token (`"launcher"` until
   * {@link NodeStatusTag}.`assume` succeeds, then `"self"`). Omitted when no assume token.
   */
  ownership: Schema.optionalKey(nodeOwnership),
});

/** Live node status. @internal */
export type NodeStatus = typeof nodeStatus.Type;

/**
 * The reserved node status HyperService tag — nodeless, so a client queries it over whichever node
 * transport it points the ambient `RpcClient.Protocol` at.
 *
 * @internal
 */
export class NodeStatusTag extends Hyperlink.Tag<NodeStatusTag>()(
  NODE_STATUS_KEY,
  {
  status: Hyperlink.ref(nodeStatus).annotate({
    description:
      "Live node status (up / uptime / resource count / per-HyperService readiness) — " +
      "`status.get` for one-shot, `status.changes` re-emitted periodically.",
  }),
  ping: Hyperlink.effect(Schema.Number).annotate({
    description: "Server epoch milliseconds — a round-trip liveness probe.",
  }),
  /**
   * Cooperative handoff ask (Lookup `askIncumbent`) — `true` = step aside so a
   * newcomer may take this `nodeKey`. Not Effect `yield*`; wire RPC only.
   * While {@link nodeStatus}.`phase` is `"draining"`, always refuses (fail-closed).
   */
  yield: Hyperlink.effect(Schema.Boolean).annotate({
    description:
      "Cooperative handoff: true = accept yield (Lookup may replace the directory row). " +
      "Refuse with false. Always false while phase is draining. Distinct from Effect generator yield*.",
  }),
  /**
   * Enter intentional drain (Track C) — sets `phase: "draining"`. Idempotent.
   * Keeps the process reachable (ping/status stay up); does not unregister or exit.
   */
  drain: Hyperlink.effect(Schema.Void).annotate({
    description:
      "Enter draining phase (Directory row held; yield refuse). Idempotent; no process exit.",
  }),
  /**
   * Compose leave + exit listen scope (Track C #32): drain → clear Advice → Directory
   * unregister → close listen (finalizers unlink / etc.). Idempotent.
   */
  shutdown: Hyperlink.effect({
    success: Schema.Void,
    error: Hyperlink.HandoffDeferred,
  }).annotate({
    description:
      "Drain, run per-service handoffs, leave membership (Advice clear + Directory unregister), " +
      "then exit the listen scope. Fails with HandoffDeferred (node stays up) when a handoff defers.",
  }),
  /**
   * Launcher → node ownership ack — child assumes self-custody so the launcher may exit.
   * Rejects until Ready; token is single-use; mismatch / reuse / not-ready are loud tagged errors.
   */
  assume: Hyperlink.effectFn({
    payload: assumePayload,
    success: Schema.Void,
    error: assumeError,
  }).annotate({
    description:
      "Assume process ownership from the launcher (`{ token }`). Ready required; single-use token.",
  }),
  logs: {
    stream: Hyperlink.stream(LogEntrySchema).annotate({
      description:
        "Runtime-wide node log stream (recent tail, then live). Empty unless Logs.layer is provided.",
    }),
    query: Hyperlink.effectFn({ limit: Schema.Number }, Schema.Array(LogEntrySchema)).annotate({
      description:
        "Replay persisted node logs (newest `limit`) from `Hyperlink.store(Node)` / `Node.logs` " +
        "registration Storage. Empty when the node journal is not registered (or `nodeLogKey` unknown).",
    }),
  },
}) {}

/** Build the node status service implementation for a node that started at `startedAt` and serves
 *  `serviceCount` services. Logs/history are optional (read via `serviceOption`), so this adds no
 *  requirement to the server layer. When `assumeToken` is set, `assume` / ownership mirror are live.
 *  @internal */
export const buildNodeStatusImpl = (options: {
  readonly startedAt: number;
  readonly serviceCount: number;
  /** Per-HyperService readiness aggregate (same one `/health` reads); absent ⇒ no HyperServices, `ok`. */
  readonly readiness?: Effect.Effect<ReadonlyArray<ServiceReadiness>>;
  /**
   * Node log key for durable `logs.query` via registration Storage (`Node.logs`).
   * When omitted, query returns `[]`.
   */
  readonly nodeLogKey?: string;
  /**
   * Cooperative handoff handler for {@link NodeStatusTag}.`yield`.
   * Default: accept (`true`) — Lookup then replaces the directory row.
   */
  readonly onYield?: Effect.Effect<boolean>;
  /**
   * Expected launcher handoff token. When set, ownership starts as `"launcher"` and
   * {@link NodeStatusTag}.`assume` is armed. Cleartext or {@link Redacted}.
   */
  readonly assumeToken?: string | Redacted.Redacted<string>;
  /** Node key stamped into assume errors (defaults to the reserved status key). */
  readonly assumeNodeKey?: string;
  /**
   * Directory / Advice leave identity for {@link NodeStatusTag}.`shutdown`.
   * Soft-skipped when Lookup client is not provided on the listen.
   */
  readonly membership?: {
    readonly nodeKey: string;
    readonly kind: ProtocolKind;
    readonly path?: string;
    readonly url?: string;
    readonly serves: ReadonlyArray<string>;
  };
  /**
   * Signal listen-scope exit after membership leave (wired to Deferred + Scope.close).
   * When omitted, shutdown only drains + leaves membership (no process/listen exit).
   */
  readonly closeListen?: Effect.Effect<void>;
  /**
   * Per-service opt-in handoffs (serve `{ handoff }`, Locked #39) — run on the OUTGOING node after
   * drain, before Lookup leave. On failure/defect (`ctx.defer`, no peer, retry-exhausted) the node
   * restores `phase: "running"`, clears the shutting-down latch, and refails (does NOT leave / close).
   */
  readonly handoff?: Effect.Effect<void, Hyperlink.HandoffDeferred>;
}): Effect.Effect<{
  readonly status: Hyperlink.Subscribable<NodeStatus>;
  readonly ping: Effect.Effect<number>;
  readonly yield: Effect.Effect<boolean>;
  readonly drain: Effect.Effect<void>;
  readonly shutdown: Effect.Effect<void, Hyperlink.HandoffDeferred>;
  readonly assume: (payload: {
    readonly token: string;
  }) => Effect.Effect<void, AssumeTokenMismatch | AssumeTokenReused | AssumeNotReady>;
  readonly logs: {
    readonly stream: Stream.Stream<LogEntry>;
    readonly query: (payload: {
      readonly limit: number;
    }) => Effect.Effect<ReadonlyArray<LogEntry>>;
  };
}> =>
  Effect.gen(function* () {
    const readiness = options.readiness ?? Effect.succeed([]);
    const expectedToken =
      options.assumeToken === undefined
        ? undefined
        : Redacted.isRedacted(options.assumeToken)
          ? Redacted.value(options.assumeToken)
          : options.assumeToken;
    const assumeNodeKey = options.assumeNodeKey ?? NODE_STATUS_KEY;
    const ownership = yield* Ref.make<NodeOwnership>(
      expectedToken !== undefined ? "launcher" : "self",
    );
    const assumed = yield* Ref.make(false);
    const phase = yield* Ref.make<NodePhase>("running");
    const shuttingDown = yield* Ref.make(false);
    const computeStatus: Effect.Effect<NodeStatus> = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const services = yield* readiness;
      const ok = services.every((r) => r.ready);
      const status: "ok" | "degraded" = ok ? "ok" : "degraded";
      const ownershipValue = yield* Ref.get(ownership);
      const phaseValue = yield* Ref.get(phase);
      return {
        up: true,
        status,
        phase: phaseValue,
        startedAt: DateTime.makeUnsafe(options.startedAt),
        uptimeMillis: now - options.startedAt,
        serviceCount: options.serviceCount,
        services,
        ...(expectedToken !== undefined ? { ownership: ownershipValue } : {}),
      };
    });
    const statusSub: Hyperlink.Subscribable<NodeStatus> = {
      get: computeStatus,
      changes: Stream.tick(STATUS_INTERVAL).pipe(Stream.mapEffect(() => computeStatus)),
    };
    const logsLive = Stream.unwrap(
      Effect.gen(function* () {
        const relay = yield* Effect.serviceOption(LogRelay);
        if (Option.isNone(relay)) return Stream.empty;
        const tail = yield* relay.value.snapshot;
        return Stream.concat(Stream.fromIterable(tail), relay.value.stream);
      }),
    );
    const assume = (payload: {
      readonly token: string;
    }): Effect.Effect<
      void,
      AssumeTokenMismatch | AssumeTokenReused | AssumeNotReady
    > =>
      Effect.gen(function* () {
        if (expectedToken === undefined || payload.token !== expectedToken) {
          yield* Effect.logWarning("assume rejected: token mismatch");
          return yield* new AssumeTokenMismatch({ node: assumeNodeKey });
        }
        if (yield* Ref.get(assumed)) {
          yield* Effect.logWarning("assume rejected: token already used");
          return yield* new AssumeTokenReused({ node: assumeNodeKey });
        }
        const services = yield* readiness;
        const blocked = services.find((r) => !r.ready);
        if (blocked !== undefined) {
          yield* Effect.logWarning("assume rejected: not Ready").pipe(
            Effect.annotateLogs({ "assume.service": blocked.key }),
          );
          return yield* new AssumeNotReady({
            node: assumeNodeKey,
            serviceKey: blocked.key,
            ...(blocked.detail !== undefined ? { detail: blocked.detail } : {}),
          });
        }
        yield* Ref.set(assumed, true);
        yield* Ref.set(ownership, "self");
        yield* Effect.logInfo("ownership assumed (self)").pipe(
          Effect.annotateLogs({ "assume.ownership": "self" }),
        );
      }).pipe(
        Effect.annotateLogs({ "assume.node": assumeNodeKey }),
        Effect.withLogSpan("node.assume.handle"),
      );
    const drain = Effect.gen(function* () {
      const previous = yield* Ref.getAndSet(phase, "draining");
      if (previous === "draining") return;
      yield* Effect.logInfo("node entered draining").pipe(
        Effect.annotateLogs({ "node.phase": "draining" }),
      );
    }).pipe(Effect.withLogSpan("node.drain.handle"));
    const leaveMembership = Effect.gen(function* () {
      const membership = options.membership;
      if (membership === undefined) return;
      const Advice = yield* Effect.promise(() => import("../Advice"));
      const Directory = yield* Effect.promise(() => import("../Directory"));
      const adviceOpt = yield* Effect.serviceOption(Advice.Tag);
      if (Option.isSome(adviceOpt)) {
        yield* Effect.forEach(
          membership.serves,
          (serviceKey) =>
            adviceOpt.value
              .clear(new Advice.ClearAdviceRequest({ serviceKey }))
              .pipe(Effect.ignore),
          { discard: true },
        );
      }
      const dirOpt = yield* Effect.serviceOption(Directory.Tag);
      if (Option.isSome(dirOpt)) {
        yield* dirOpt.value
          .unregister(
            new Directory.UnregisterRequest({
              nodeKey: membership.nodeKey,
              kind: membership.kind,
              ...(membership.path !== undefined
                ? { path: membership.path }
                : {}),
              ...(membership.url !== undefined ? { url: membership.url } : {}),
            }),
          )
          .pipe(Effect.ignore);
      }
    });
    const shutdown = Effect.gen(function* () {
      if (yield* Ref.getAndSet(shuttingDown, true)) return;
      yield* drain;
      if (options.handoff !== undefined) {
        // Locked #39 #8/#9: a deferred / failed / defected handoff must NOT leave membership or
        // close the listen. Restore `phase: "running"`, clear the shutting-down latch (so a later
        // shutdown can retry), and refail with the original cause (typed `HandoffDeferred` or defect).
        const exit = yield* Effect.exit(
          options.handoff.pipe(Effect.withLogSpan("node.shutdown.handoff")),
        );
        if (Exit.isFailure(exit)) {
          yield* Ref.set(phase, "running");
          yield* Ref.set(shuttingDown, false);
          yield* Effect.logWarning(
            "node shutdown deferred: handoff did not complete; staying up",
          ).pipe(Effect.annotateLogs({ "node.phase": "running" }));
          return yield* Effect.failCause(exit.cause);
        }
      }
      yield* leaveMembership;
      yield* Effect.logInfo("node shutdown leaving listen").pipe(
        Effect.annotateLogs({ "node.phase": "draining" }),
      );
      if (options.closeListen !== undefined) {
        yield* options.closeListen;
      }
    }).pipe(Effect.withLogSpan("node.shutdown.handle"));
    // While draining: always refuse (Locked #31). Otherwise ListenOptions.onYield / default accept.
    const yieldEffect = Effect.gen(function* () {
      if ((yield* Ref.get(phase)) === "draining") return false;
      return yield* (options.onYield ?? Effect.succeed(true));
    });
    return {
      status: statusSub,
      ping: Clock.currentTimeMillis,
      yield: yieldEffect,
      drain,
      shutdown,
      assume,
      logs: {
        stream: logsLive,
        query: (payload: { readonly limit: number }) =>
          options.nodeLogKey !== undefined
            ? queryDurableNode(options.nodeLogKey, { limit: payload.limit })
            : Effect.succeed([] as ReadonlyArray<LogEntry>),
      },
    };
  });

/**
 * The reserved node-status resource paired with its built impl — the `{ tag, impl }` that
 * {@link Node.httpServer} folds onto every node's `RpcServer` automatically, so every node
 * exposes its status + logs without the author wiring it.
 *
 * @internal
 */
export const nodeStatusServeEntry = (options: {
  readonly startedAt: number;
  readonly serviceCount: number;
  readonly readiness?: Effect.Effect<ReadonlyArray<ServiceReadiness>>;
  readonly nodeLogKey?: string;
  readonly assumeToken?: string | Redacted.Redacted<string>;
  readonly assumeNodeKey?: string;
  readonly onYield?: Effect.Effect<boolean>;
  readonly membership?: {
    readonly nodeKey: string;
    readonly kind: ProtocolKind;
    readonly path?: string;
    readonly url?: string;
    readonly serves: ReadonlyArray<string>;
  };
  readonly closeListen?: Effect.Effect<void>;
  readonly handoff?: Effect.Effect<void, Hyperlink.HandoffDeferred>;
}): {
  readonly tag: typeof NodeStatusTag;
  readonly impl: ReturnType<typeof buildNodeStatusImpl>;
} => ({
  tag: NodeStatusTag,
  impl: buildNodeStatusImpl(options),
});

/**
 * Build the {@link NodeStatusAccessors} for a connected node from its own transport `protocol` — the
 * real dial logic behind `yield* MyNode` → `n.ping` / `n.status` / `n.logs`. Verify is off (this IS
 * the health probe); every access dials the node's reserved status resource, scoped per read. Called
 * lazily from `connectLayer` via dynamic import so nodeConnect never statically pulls this engine.
 * @internal
 */
export const nodeStatusAccessors = (
  protocol: Context.Service.Shape<typeof RpcClient.Protocol>,
): NodeStatusAccessors => {
  const clientLayer = Hyperlink.client(NodeStatusTag).pipe(
    Layer.provide(Layer.succeed(RpcClient.Protocol, protocol)),
    Layer.provide(Hyperlink.clientVerify(false)),
  );
  const toUnreachable = (cause: unknown) =>
    new NodeUnreachable({ node: NODE_STATUS_KEY, url: "node handle", cause });
  // One-shot read: build the per-node status client into a Context (scoped) and provide THAT — never
  // `Effect.provide(effect, Layer)` in a library internal (breaks scope lifetimes; strictEffectProvide).
  const oneShot = <A, E>(
    read: Effect.Effect<A, E, NodeStatusTag>,
  ): Effect.Effect<A, NodeUnreachable> =>
    Effect.scoped(
      Effect.flatMap(Layer.build(clientLayer), (ctx) => Effect.provide(read, ctx)),
    ).pipe(Effect.mapError(toUnreachable));
  return {
    ping: oneShot(Effect.flatMap(NodeStatusTag, (h) => h.ping)),
    status: {
      get: oneShot(Effect.flatMap(NodeStatusTag, (h) => h.status.get)),
      changes: Stream.unwrap(Effect.map(NodeStatusTag, (h) => h.status.changes)).pipe(
        Stream.provide(clientLayer),
        Stream.mapError(toUnreachable),
      ),
    },
    logs: {
      stream: Stream.unwrap(Effect.map(NodeStatusTag, (h) => h.logs.stream)).pipe(
        Stream.provide(clientLayer),
        Stream.mapError(toUnreachable),
      ),
      query: (options) =>
        oneShot(Effect.flatMap(NodeStatusTag, (h) => h.logs.query(options))),
    },
  };
};

/** A status client for a node's `/rpc` url (ndjson/http) — internal dial helper (tests, url probes). @internal */
export const httpClient = (url: string): Layer.Layer<NodeStatusTag> =>
  Hyperlink.client(NodeStatusTag).pipe(
    Layer.provide(
      RpcClient.layerProtocolHttp({ url }).pipe(
        Layer.provide(RpcSerialization.layerNdjson),
        Layer.provide(FetchHttpClient.layer),
      ),
    ),
  );

/** A status client for a specific addressed node (verify off — it IS the probe). @internal */
export const client = (node: AddressedNode<unknown>) =>
  Hyperlink.client(NodeStatusTag, node).pipe(
    Layer.provide(Hyperlink.clientVerify(false)),
  );
