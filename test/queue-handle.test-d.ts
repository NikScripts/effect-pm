import { DateTime, Effect, Schema, Stream } from "effect";
import * as QueueResource from "../src/QueueResource";
import { queueEncodedEntry } from "../src/QueueResource";
import * as Resource from "../src/Resource";
import type {
  QueueEnqueue,
  QueueEntry,
  QueueEntrySelector,
  QueueEvent,
  QueueMetrics,
  QueueReleaseEncodingError,
  QueueReleaseOptions,
  QueueRouteOptions,
  QueueStatus,
} from "../src/internal/queueResource";

// ── ground truth: the contract shape `yield* Emails` produces ────────────────
const EmailJob = Schema.Struct({ to: Schema.String });
class Emails extends QueueResource.Tag<Emails>()("test/queue-handle/Emails", {
  payload: EmailJob,
}) {}
type Contract = Resource.Shape<typeof Emails>;
type P = typeof EmailJob.Type;

// ── DRAFT handle (iterate to bidirectional equality with Contract) ───────────
interface QueueResourceDraft<
  Payload,
  Success = void,
  Error = unknown,
  Requirements = never,
> {
  readonly status: Resource.Subscribable<QueueStatus>;
  readonly size: Resource.Subscribable<number>;
  readonly isEmpty: Resource.Subscribable<boolean>;
  readonly start: Effect.Effect<void, never, Requirements>;
  readonly pause: Effect.Effect<void>;
  readonly resume: Effect.Effect<void>;
  readonly shutdown: Effect.Effect<void>;
  readonly clear: Effect.Effect<number, never, Requirements>;
  readonly metrics: {
    readonly stream: Stream.Stream<QueueMetrics>;
    readonly query: (input: {
      readonly limit?: number;
      readonly since?: DateTime.Utc;
      readonly until?: DateTime.Utc;
    }) => Effect.Effect<ReadonlyArray<QueueMetrics>, never, Requirements>;
  };
  readonly add: QueueEnqueue<Payload, never, Requirements>;
  readonly prioritize: QueueEnqueue<Payload, never, Requirements>;
  readonly defer: QueueEnqueue<Payload, never, Requirements>;
  readonly enqueue: (
    entries: ReadonlyArray<QueueEntry<Payload>>,
  ) => Effect.Effect<void, never, Requirements>;
  readonly release: (input: {
    readonly options?: QueueReleaseOptions;
  }) => Effect.Effect<ReadonlyArray<QueueEntry<Payload>>, never, Requirements>;
  readonly releaseEncoded: (input: {
    readonly options?: QueueReleaseOptions;
  }) => Effect.Effect<
    ReadonlyArray<Resource.Decoded<typeof queueEncodedEntry>>,
    QueueReleaseEncodingError,
    Requirements
  >;
  readonly deadLetter: (input: {
    readonly selector: QueueEntrySelector<Payload> | QueueEntry<Payload>;
    readonly options: QueueRouteOptions;
  }) => Effect.Effect<ReadonlyArray<QueueEntry<Payload>>, never, Requirements>;
  readonly drop: (input: {
    readonly selector: QueueEntrySelector<Payload> | QueueEntry<Payload>;
    readonly options: QueueRouteOptions;
  }) => Effect.Effect<ReadonlyArray<QueueEntry<Payload>>, never, Requirements>;
  readonly events: Stream.Stream<QueueEvent<Payload, Error, Success>>;
}

type DraftT = QueueResourceDraft<P, unknown, unknown, never>;
declare const contract: Contract;
declare const draft: DraftT;

// per-member bidirectional check
const status_a: DraftT["status"] = contract.status;
const status_b: Contract["status"] = draft.status;
const size_a: DraftT["size"] = contract.size;
const size_b: Contract["size"] = draft.size;
const start_a: DraftT["start"] = contract.start;
const start_b: Contract["start"] = draft.start;
const clear_a: DraftT["clear"] = contract.clear;
const clear_b: Contract["clear"] = draft.clear;
const metrics_a: DraftT["metrics"] = contract.metrics;
const metrics_b: Contract["metrics"] = draft.metrics;
const add_a: DraftT["add"] = contract.add;
const add_b: Contract["add"] = draft.add;
const enqueue_a: DraftT["enqueue"] = contract.enqueue;
const enqueue_b: Contract["enqueue"] = draft.enqueue;
const release_a: DraftT["release"] = contract.release;
const release_b: Contract["release"] = draft.release;
const relEnc_a: DraftT["releaseEncoded"] = contract.releaseEncoded;
const relEnc_b: Contract["releaseEncoded"] = draft.releaseEncoded;
const dead_a: DraftT["deadLetter"] = contract.deadLetter;
const dead_b: Contract["deadLetter"] = draft.deadLetter;
const events_a: DraftT["events"] = contract.events;
const events_b: Contract["events"] = draft.events;

void [
  status_a, status_b, size_a, size_b, start_a, start_b, clear_a, clear_b,
  metrics_a, metrics_b, add_a, add_b, enqueue_a, enqueue_b, release_a, release_b,
  relEnc_a, relEnc_b, dead_a, dead_b, events_a, events_b,
];

// key parity — a non-never here names members the draft is missing / has extra
declare const missing: Exclude<keyof Contract, keyof DraftT>;
declare const extra: Exclude<keyof DraftT, keyof Contract>;
const noMissing: never = missing;
const noExtra: never = extra;
void [noMissing, noExtra];
