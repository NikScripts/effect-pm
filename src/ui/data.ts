/**
 * @module ui/data
 *
 * Tag-driven data layer shared by `hyperlink-ts/web` and `hyperlink-ts/tui`. Each resource
 * **tag** is the source of truth; `queueBundle` / `daemonBundle` build the atom bundle the
 * widgets read (status / metrics+history / trend / logs + controls) straight from the tag's
 * live service over the consumer's reactive `runtime` (an `Atom.runtime(layer)` that provides
 * the tags — local engine or `Hyperlink.client` over http; the widgets don't care which).
 *
 * Prefer `Observe.use(tag, *View.pack)` at call sites. Builders are thin wraps over packs
 * (or shared scan helpers); composite scans live on the matching `*View` pack.
 *
 */
import { Effect, Option, Predicate, Stream, type Schema } from "effect";
import { Atom, type AsyncResult } from "effect/unstable/reactivity";
import * as Group from "../Group";
import {
  nodeOf,
  kindOf as hyperlinkKindOf,
  wireKeySym,
  type Subscribable,
} from "../Hyperlink";
import type { NodeKey, Status as NodeStatusSnapshot } from "../Node";
import {
  kind as queueKind,
  queueMetrics,
  queueStatus,
  priorityKind,
  type PriorityStatus,
} from "../WorkPool";
import { kind as fleetHealthKind, type FleetStatus, type NodeReport } from "../FleetHealth";
import { kind as telemetryKind, MetricsSnapshot, type MetricDatum } from "../Telemetry";
import { kind as shardMapKind } from "../ShardMap";
import {
  httpApiClientKind as apiKind,
  kind as gateKind,
  type Handle as GateHandle,
  type Status as GateStatus,
} from "../Gate";
import { kind as daemonKind, daemonScheduleEntry, daemonStatus } from "../Daemon";
import type { ApiUsageMetrics, ApiUsageSnapshot } from "../ApiUsageSchema";
import * as Observe from "../Observe";
import { serviceLogsAtom, type LogLine } from "./observeSupport";
import { pack as apiMetricsPack } from "./apiMetricsViewPack";
import { pack as daemonPack } from "./daemonViewPack";
import { pack as gatePack } from "./gateViewPack";
import { bind as nodeViewBind } from "./nodeViewPack";
import {
  fleetHealthPack,
  shardMapPack,
  telemetryPack,
} from "./pollViewPacks";
import { pack as priorityPack } from "./priorityViewPack";
import { pack as workPoolQueuePack } from "./workPoolViewPack";

/** Live queue status (from the contract schema). @public */
export type QueueStatus = Schema.Schema.Type<typeof queueStatus>;
/** A `WorkPool.priority` queue's live status — re-export of {@link PriorityStatus}. @public */
export type { PriorityStatus };
/** Live queue metrics (from the contract schema). @public */
export type QueueMetrics = Schema.Schema.Type<typeof queueMetrics>;
/** Live daemon status (from the contract schema). @public */
export type DaemonStatus = Schema.Schema.Type<typeof daemonStatus>;
/** One scheduled run window (from the contract schema): `{ id?, startAt, stopAt? }`. @public */
export type ScheduleEntry = Schema.Schema.Type<typeof daemonScheduleEntry>;

/** A captured log line for the log pane. @public */
export type { LogLine };
/** A windowed metrics sample for the chart. @public */
export interface MetricPoint {
  readonly t: number;
  readonly throughput: number;
  readonly latency: number;
}
/** A windowed API-usage sample for the API chart. @public */
export interface ApiPoint {
  readonly t: number;
  readonly throughput: number;
  readonly errors: number;
  readonly inFlight: number;
}

/** The structural shape of a queue's live service the widgets consume. `status`/`size`/`isEmpty` are
 *  reactive `ref`s (`Subscribable`: `.get` / `.changes`); `metrics`/`logs` are `{ stream, query }`. */
interface QueueService {
  readonly status: Subscribable<QueueStatus>;
  readonly lifecycle: Subscribable<{ readonly _tag: string }>;
  readonly size: Subscribable<number>;
  readonly isEmpty: Subscribable<boolean>;
  readonly metrics: {
    readonly stream: Stream.Stream<QueueMetrics>;
    readonly query: (o: { readonly limit: number }) => Effect.Effect<ReadonlyArray<QueueMetrics>>;
  };
  readonly logs: {
    readonly stream: Stream.Stream<{ readonly level: string; readonly message: string }>;
    readonly query: (o: {
      readonly limit: number;
    }) => Effect.Effect<ReadonlyArray<{ readonly level: string; readonly message: string }>>;
  };
  readonly pause: Effect.Effect<void>;
  readonly resume: Effect.Effect<void>;
  readonly clear: Effect.Effect<void>;
  readonly stop: Effect.Effect<void>;
}
/** A reactive `ref` field on the wire: read once (`get`) or subscribe (`changes`). */
interface RefLike<A> {
  readonly get: Effect.Effect<A>;
  readonly changes: Stream.Stream<A>;
}
/** The structural shape of a daemon's live service (the base `Daemon.Service` contract). The inline
 *  `schedule` verb group is present only on a daemon that owns an inline schedule
 *  (`Daemon.schedule([...])`), so it is optional here. */
interface DaemonService {
  readonly status: RefLike<DaemonStatus>;
  readonly logs: {
    readonly stream: Stream.Stream<{ readonly level: string; readonly message: string }>;
    readonly query: (o: { readonly limit: number }) => Effect.Effect<ReadonlyArray<{ readonly level: string; readonly message: string }>>;
  };
  readonly start: Effect.Effect<void>;
  readonly stop: Effect.Effect<void>;
  readonly run: Effect.Effect<void>;
  readonly schedule?: {
    readonly entries: RefLike<ReadonlyArray<ScheduleEntry>>;
    readonly set: (entries: ReadonlyArray<ScheduleEntry>) => Effect.Effect<void>;
    readonly add: (entry: ScheduleEntry) => Effect.Effect<void>;
    readonly clear: Effect.Effect<void>;
  };
}
/** HttpApiClient (and nest fixtures) expose limiter + usage under the `metrics` nest. */
interface ApiService {
  readonly metrics: {
    readonly remaining: Subscribable<number>;
    readonly resetAfter: Subscribable<number>;
    readonly exceeded: Subscribable<number>;
    readonly usage: Subscribable<ApiUsageSnapshot>;
    readonly windows: Stream.Stream<ApiUsageMetrics>;
  };
}

/** The structural shape of a `WorkPool.priority` queue's live service — like {@link QueueService}
 *  but with a named-lane `status`, an extra `levelSizes`, and a `start` command. Metrics/logs are
 *  identical. */
interface PriorityService {
  readonly status: Subscribable<PriorityStatus>;
  readonly lifecycle: Subscribable<{ readonly _tag: string }>;
  readonly size: Subscribable<number>;
  readonly isEmpty: Subscribable<boolean>;
  readonly levelSizes: Effect.Effect<ReadonlyArray<number>>;
  readonly metrics: {
    readonly stream: Stream.Stream<QueueMetrics>;
    readonly query: (o: { readonly limit: number }) => Effect.Effect<ReadonlyArray<QueueMetrics>>;
  };
  readonly logs: {
    readonly stream: Stream.Stream<{ readonly level: string; readonly message: string }>;
    readonly query: (o: {
      readonly limit: number;
    }) => Effect.Effect<ReadonlyArray<{ readonly level: string; readonly message: string }>>;
  };
  readonly start: Effect.Effect<void>;
  readonly pause: Effect.Effect<void>;
  readonly resume: Effect.Effect<void>;
  readonly clear: Effect.Effect<void>;
  readonly stop: Effect.Effect<void>;
}

/** A queue tag — yieldable for its live service. Requirement `R` is provided by the runtime. @public */
export type QueueTag<R = never> = Effect.Effect<QueueService, never, R> & { readonly key: string };
/** A `WorkPool.priority` tag — yieldable for its live service. @public */
export type PriorityTag<R = never> = Effect.Effect<PriorityService, never, R> & { readonly key: string };

/** The structural shape of a **fleet-health** HyperService's live service — a per-node health map + a
 *  rollup status, both `fleet` effect fields (read-once, polled — no reactive ref). */
interface FleetHealthService {
  readonly byNode: Effect.Effect<Record<string, NodeReport>>;
  readonly status: Effect.Effect<FleetStatus>;
}
/** A fleet-health tag — yieldable for its live service. @public */
export type FleetHealthTag<R = never> = Effect.Effect<FleetHealthService, never, R> & { readonly key: string };

/** The structural shape of a **telemetry** HyperService's live service — this node's metric `snapshot`
 *  (leaf) plus the fleet folds `inFlightByNode` / `fleetInFlight`. All effect fields (polled). */
interface TelemetryService {
  readonly snapshot: Effect.Effect<typeof MetricsSnapshot.Type>;
  readonly inFlightByNode: Effect.Effect<Record<string, number>>;
  readonly fleetInFlight: Effect.Effect<number>;
}
/** A telemetry tag — yieldable for its live service. @public */
export type TelemetryTag<R = never> = Effect.Effect<TelemetryService, never, R> & { readonly key: string };

/** The structural shape of a **shard-map** HyperService's live service — `sizeLocal` (this node's entry
 *  count, leaf) plus the fleet folds `sizeByNode` / `size`. All effect fields (polled). */
interface ShardMapService {
  readonly sizeLocal: Effect.Effect<number>;
  readonly sizeByNode: Effect.Effect<Readonly<Record<string, number>>>;
  readonly size: Effect.Effect<number>;
}
/** A shard-map tag — yieldable for its live service. @public */
export type ShardMapTag<R = never> = Effect.Effect<ShardMapService, never, R> & { readonly key: string };

/** Dashboard observe surface for a Gate — projected from {@link GateHandle} so it can't drift. */
type GateService = Pick<GateHandle<unknown, unknown, never>, "status">;
/** A Gate tag — yieldable for its live service. @public */
export type GateTag<R = never> = Effect.Effect<GateService, never, R> & { readonly key: string };
/** A daemon tag — yieldable for its live service. @public */
export type DaemonTag<R = never> = Effect.Effect<DaemonService, never, R> & { readonly key: string };
/** An API-metrics tag — yieldable for its live service. @public */
export type ApiTag<R = never> = Effect.Effect<ApiService, never, R> & { readonly key: string };

/**
 * Erased shape of a {@link Group.isGroup} value — one place in a `Group.Service` tree
 * (`key` + named `members`). **Not** a Hyperlink transport {@link Node} / `Node.Service`.
 *
 * Dashboard props use this when the concrete `Group.Service` class is irrelevant (walk, route, render).
 *
 * @public
 */
export type GroupNode = {
  readonly key: string;
  readonly members: Record<string, unknown>;
};

/** A read/stream value atom (error channel erased — widgets only read success). @public */
export type ValueAtom<A> = Atom.Atom<AsyncResult.AsyncResult<A, unknown>>;
/** A no-arg command trigger. @public */
export type CommandAtom = Atom.AtomResultFn<void, unknown, unknown>;

/** Any reactive runtime that provides the dashboard's tags. @public */
export type DashboardRuntime<R = never, ER = never> = Atom.AtomRuntime<R, ER>;

/** The atoms + controls one queue card needs — all derived from the tag. @public */
export interface QueueBundle {
  readonly status: ValueAtom<Option.Option<QueueStatus>>;
  readonly lifecycle: ValueAtom<{ readonly _tag: string }>;
  readonly metrics: ValueAtom<Option.Option<QueueMetrics>>;
  readonly history: ValueAtom<ReadonlyArray<MetricPoint>>;
  readonly trend: ValueAtom<ReadonlyArray<number>>;
  readonly logs: ValueAtom<ReadonlyArray<LogLine>>;
  readonly pause: CommandAtom;
  readonly resume: CommandAtom;
  readonly clear: CommandAtom;
  readonly stop: CommandAtom;
}
/** The atoms + controls one `WorkPool.priority` card needs — like {@link QueueBundle} (named-lane
 *  status) plus a `start` command. @public */
export interface PriorityBundle {
  readonly status: ValueAtom<Option.Option<PriorityStatus>>;
  readonly lifecycle: ValueAtom<{ readonly _tag: string }>;
  readonly metrics: ValueAtom<Option.Option<QueueMetrics>>;
  readonly history: ValueAtom<ReadonlyArray<MetricPoint>>;
  readonly trend: ValueAtom<ReadonlyArray<number>>;
  readonly logs: ValueAtom<ReadonlyArray<LogLine>>;
  readonly start: CommandAtom;
  readonly pause: CommandAtom;
  readonly resume: CommandAtom;
  readonly clear: CommandAtom;
  readonly stop: CommandAtom;
}
/** The atoms one **fleet-health** card needs — a polled per-node health map + rollup status. @public */
export interface FleetHealthBundle {
  readonly byNode: ValueAtom<Record<string, NodeReport>>;
  readonly status: ValueAtom<FleetStatus>;
}
/** The atoms one **telemetry** card needs — the polled fleet in-flight total + per-node map, plus this
 *  node's metric count (from the snapshot). Read-only. @public */
export interface TelemetryBundle {
  readonly metricCount: ValueAtom<number>;
  readonly inFlightByNode: ValueAtom<Record<string, number>>;
  readonly fleetInFlight: ValueAtom<number>;
  /** This node's full metric registry (id + kind + reading) — the detail page's per-metric list. */
  readonly metrics: ValueAtom<ReadonlyArray<MetricDatum>>;
}
/** The atoms one **shard-map** card needs — polled fleet size total + per-node entry map + this node's
 *  local count. Read-only. @public */
export interface ShardMapBundle {
  readonly size: ValueAtom<number>;
  readonly sizeByNode: ValueAtom<Record<string, number>>;
  readonly sizeLocal: ValueAtom<number>;
}
/** The atoms one **Gate** card needs — the live status (concurrency counters) streamed from the
 *  reactive `status` ref. Read-only. @public */
export interface GateBundle {
  readonly status: ValueAtom<GateStatus>;
}
/** The atoms + controls one daemon card needs — derived from the tag. @public */
export interface DaemonBundle {
  readonly status: ValueAtom<DaemonStatus>;
  readonly logs: ValueAtom<ReadonlyArray<LogLine>>;
  /** The current schedule entries (run windows), read once on open. */
  readonly schedule: ValueAtom<ReadonlyArray<ScheduleEntry>>;
  readonly start: CommandAtom;
  readonly stop: CommandAtom;
  readonly run: CommandAtom;
  /** Replace all schedule entries. */
  readonly setSchedule: Atom.AtomResultFn<ReadonlyArray<ScheduleEntry>, void, unknown>;
  /** Remove all schedule entries. */
  readonly clearSchedule: CommandAtom;
}
/** The atoms one node dot/detail needs — its live status (up, readiness rollup, per-HyperService).
 * @public
 *  Read-only. */
export interface NodeBundle {
  readonly id: string;
  readonly status: ValueAtom<NodeStatusSnapshot>;
  /** The node's runtime-wide log stream (recent tail, then live). */
  readonly logs: ValueAtom<ReadonlyArray<LogLine>>;
  /** Ready-resource count over time (one point per status tick) — a readiness sparkline that dips
   *  when a HyperService (or its dependency) degrades. */
  readonly health: ValueAtom<ReadonlyArray<number>>;
}
/** The atoms one HttpApiClient (API) card needs — read-only (no commands). @public */
export interface ApiBundle {
  /** Cumulative usage snapshot (totals + top endpoints), via `usage.changes`. */
  readonly status: ValueAtom<ApiUsageSnapshot>;
  /** The latest usage window. */
  readonly metrics: ValueAtom<Option.Option<ApiUsageMetrics>>;
  /** Accumulated chart points (throughput / errors / in-flight per window). */
  readonly history: ValueAtom<ReadonlyArray<ApiPoint>>;
  /** Tokens remaining in the rate-limit window (`metrics.remaining`). */
  readonly remaining: ValueAtom<number>;
  /** Ms until the rate-limit window resets (`metrics.resetAfter`). */
  readonly resetAfter: ValueAtom<number>;
  /** Count of rate-limit exceed events (`metrics.exceeded`). */
  readonly exceeded: ValueAtom<number>;
}

/** A node that backs one or more of a group's resources — its id (the `Node.Service` key) plus the
 *  transport key itself. Read straight off the tags (`nodeOf`), so the dashboard's node list is the
 * @public
 *  distinct nodes its HyperServices are bound to — no separate registry. */
export interface NodeRef {
  readonly id: string;
  readonly node: NodeKey<unknown>;
}

/** Walk a group tree and collect the distinct nodes its HyperServices are bound to. A nodeless
 * @public
 *  (local/in-process) group yields `[]` — node dots appear only when HyperServices name a node. */
export const nodesOf = (group: unknown): ReadonlyArray<NodeRef> => {
  const seen = new Map<string, NodeRef>();
  const walk = (member: unknown): void => {
    if (Group.isGroup(member)) {
      for (const child of Object.values(Group.members(member))) walk(child);
      return;
    }
    const node = nodeOf(member);
    if (node !== undefined && !seen.has(node.key)) {
      seen.set(node.key, { id: node.key, node });
    }
  };
  walk(group);
  return [...seen.values()];
};

/** A tag's wire identity ({@link wireKeyOf}, falling back to `key`) — what a node's status
 * @public
 *  snapshot reports for each served resource. */
export const tagWireKey = (member: unknown): string | undefined => {
  if ((typeof member !== "object" && typeof member !== "function") || member === null) {
    return undefined;
  }
  if (Predicate.hasProperty(member, wireKeySym)) {
    const wk = member[wireKeySym];
    if (typeof wk === "string") return wk;
  }
  if ("key" in member && typeof member.key === "string") return member.key;
  return undefined;
};

/** The {@link NodeRef} a HyperService tag is bound to (its `Node.Service`), or `undefined` for a nodeless
 * @public
 *  tag — lets a HyperService page read its own readiness from its node's status handle. */
export const serviceNodeRef = (tag: unknown): NodeRef | undefined => {
  const node = nodeOf(tag);
  return node === undefined ? undefined : { id: node.key, node };
};

/** The leaf HyperService tag in a group tree whose wire key is `key` (as reported by a node's
 *  `Node.Status.services[].key`), or `undefined` if not found. Lets the node page open a served
 * @public
 *  HyperService's detail directly (without round-tripping through the group route). */
export const leafByKey = (group: unknown, key: string): unknown => {
  const walk = (node: unknown): unknown => {
    if (!Group.isGroup(node)) return undefined;
    for (const member of Object.values(Group.members(node))) {
      if (Group.isGroup(member)) {
        const found = walk(member);
        if (found !== undefined) return found;
      } else if (tagWireKey(member) === key) {
        return member;
      }
    }
    return undefined;
  };
  return walk(group);
};

/** Group-member type-guards — each keyed directly off the tag's **stamped** kind, the single
 *  source of truth (every tag carries one; no spec-sniffing, no second short vocabulary). @public */
export const isQueueTag = (m: unknown): m is QueueTag => hyperlinkKindOf(m) === queueKind;
/** @public */
export const isDaemonTag = (m: unknown): m is DaemonTag => hyperlinkKindOf(m) === daemonKind;
/** @public */
export const isApiTag = (m: unknown): m is ApiTag => hyperlinkKindOf(m) === apiKind;
/** `WorkPool.priority` guard — its own stamped kind (not folded into {@link kindOf}, which stays
 *  the four primary kinds; a priority queue dispatches by its exact kind key). @public */
export const isPriorityTag = (m: unknown): m is PriorityTag =>
  hyperlinkKindOf(m) === priorityKind;
/** Fleet-health guard — its own stamped kind (a mesh factory, dispatched by exact kind key). @public */
export const isFleetHealthTag = (m: unknown): m is FleetHealthTag =>
  hyperlinkKindOf(m) === fleetHealthKind;
/** Telemetry guard — its own stamped kind (a mesh factory, dispatched by exact kind key). @public */
export const isTelemetryTag = (m: unknown): m is TelemetryTag =>
  hyperlinkKindOf(m) === telemetryKind;
/** Shard-map guard — its own stamped kind (a mesh factory, dispatched by exact kind key). @public */
export const isShardMapTag = (m: unknown): m is ShardMapTag =>
  hyperlinkKindOf(m) === shardMapKind;
/** Gate guard — its own stamped kind (dispatched by exact kind key). @public */
export const isGateTag = (m: unknown): m is GateTag =>
  hyperlinkKindOf(m) === gateKind;

export { serviceLogsAtom };

/** Build (once per runtime+tag) the atom bundle for a queue tag — thin wrap over WorkPoolView.pack. @public */
export const queueBundle = <R, ER>(
  runtime: DashboardRuntime<R, ER>,
  tag: QueueTag<R>,
): QueueBundle => Observe.bind(runtime)(tag, workPoolQueuePack);

/** Build (once per runtime+tag) the atom bundle for a `WorkPool.priority` tag — thin wrap. @public */
export const priorityBundle = <R, ER>(
  runtime: DashboardRuntime<R, ER>,
  tag: PriorityTag<R>,
): PriorityBundle => Observe.bind(runtime)(tag, priorityPack);

/** Build (once per runtime+tag) the atom bundle for a **fleet-health** tag — thin wrap. @public */
export const fleetHealthBundle = <R, ER>(
  runtime: DashboardRuntime<R, ER>,
  tag: FleetHealthTag<R>,
): FleetHealthBundle => Observe.bind(runtime)(tag, fleetHealthPack);

/** Build (once per runtime+tag) the atom bundle for a **telemetry** tag — thin wrap. @public */
export const telemetryBundle = <R, ER>(
  runtime: DashboardRuntime<R, ER>,
  tag: TelemetryTag<R>,
): TelemetryBundle => Observe.bind(runtime)(tag, telemetryPack);

/** Build (once per runtime+tag) the atom bundle for a **shard-map** tag — thin wrap. @public */
export const shardMapBundle = <R, ER>(
  runtime: DashboardRuntime<R, ER>,
  tag: ShardMapTag<R>,
): ShardMapBundle => Observe.bind(runtime)(tag, shardMapPack);

/** Build (once per runtime+tag) the atom bundle for a **Gate** tag — thin wrap. @public */
export const gateBundle = <R, ER>(
  runtime: DashboardRuntime<R, ER>,
  tag: GateTag<R>,
): GateBundle => Observe.bind(runtime)(tag, gatePack);

/** Build (once per runtime+tag) the atom bundle for a daemon tag — thin wrap. @public */
export const daemonBundle = <R, ER>(
  runtime: DashboardRuntime<R, ER>,
  tag: DaemonTag<R>,
): DaemonBundle => Observe.bind(runtime)(tag, daemonPack);

/** Build (once per runtime+tag) the atom bundle for an API-metrics tag — thin wrap. @public */
export const apiBundle = <R, ER>(
  runtime: DashboardRuntime<R, ER>,
  tag: ApiTag<R>,
): ApiBundle => Observe.bind(runtime)(tag, apiMetricsPack);

/** Build (once per runtime+node) the atom bundle for a node's live status — thin wrap over NodeView.bind. @public */
export const nodeStatusBundle = <R, ER>(
  runtime: DashboardRuntime<R, ER>,
  ref: NodeRef,
): NodeBundle => nodeViewBind(runtime)(ref);

/** Walk a `Group.Service` tree to its leaf resource tags (WorkPools + Daemons), raw. @public */
export const leafTags = (node: GroupNode): ReadonlyArray<unknown> =>
  Object.values(Group.members(node)).flatMap((m) => (Group.isGroup(m) ? leafTags(m) : [m]));

/** Only the queue leaves of a tree. @public */
export const queueLeaves = (node: GroupNode): ReadonlyArray<QueueTag> =>
  leafTags(node).filter(isQueueTag);

/** Only the daemon leaves of a tree. @public */
export const daemonLeaves = (node: GroupNode): ReadonlyArray<DaemonTag> =>
  leafTags(node).filter(isDaemonTag);
