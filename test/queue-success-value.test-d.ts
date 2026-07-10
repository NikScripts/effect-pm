import { Effect, Schema, type Stream } from "effect";
import * as QueueResource from "../src/QueueResource";
import type { ServiceOf, SpecOf } from "../src/Resource";
import type { QueueStoreCompleted } from "../src/internal/store/queueStoreSpec";
import type { StoreHandleAtKey } from "../src/internal/store/defineStore";
import type { RegsOfStoreInput } from "../src/internal/store/registrationTypes";

// Phase 4 — the queue Tag's `success` schema slot drives the worker `effect` return type, the live
// `events` stream, and the typed success value `A` on store analytics reads. No success schema → `void`.

type StreamElement<S> = S extends Stream.Stream<infer E, infer _E, infer _R> ? E : never;

// ── exact type-equality harness ──────────────────────────────────────────────
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const expectExact = <_Check extends true>(): void => {};

const jobSchema = Schema.Struct({ id: Schema.String });

// ── (a) declaring `success: Schema.Number` ──────────────────────────────────
class NumberQueue extends QueueResource.Tag<NumberQueue>()("@td/NumberQueue", {
  payload: jobSchema,
  success: Schema.Number,
}) {}

// the worker `effect` is REQUIRED to return `Effect<number, …>` (the success schema drives it)
const _numberLayer = QueueResource.layer(NumberQueue, {
  effect: (job) => Effect.succeed(job.id.length),
});
void _numberLayer;

// returning the wrong success type is a type error
QueueResource.layer(NumberQueue, {
  // @ts-expect-error worker must return `Effect<number, …>`, not `Effect<string, …>`
  effect: (_job) => Effect.succeed("nope"),
});

// a `void`-returning worker is rejected when a success schema is declared
QueueResource.layer(NumberQueue, {
  // @ts-expect-error worker must return `Effect<number, …>`, not `Effect<void, …>`
  effect: (_job) => Effect.void,
});

// `Completed.success` on the live `events` stream is exactly `number`
type NumberCompletedEvent = Extract<
  StreamElement<ServiceOf<SpecOf<typeof NumberQueue>>["events"]>,
  { readonly _tag: "Completed" }
>;
expectExact<Equals<NumberCompletedEvent["success"], number>>();

// `Completed.success` on the analytics read is exactly `number`
type NumberCompleted = QueueStoreCompleted<typeof NumberQueue>;
expectExact<Equals<NumberCompleted["success"], number>>();

// `slowest()` carries the typed `Completed` (success = number)
type NumberRegs = RegsOfStoreInput<
  [ReturnType<typeof QueueResource.store<typeof NumberQueue>>]
>;
type NumberHandle = StoreHandleAtKey<NumberRegs, typeof NumberQueue>;
expectExact<
  Equals<
    NumberHandle["slowest"],
    (n: number) => Effect.Effect<ReadonlyArray<NumberCompleted>>
  >
>();

// ── (b) NO success schema → the worker stays `Effect<void, …>` ───────────────
class VoidQueue extends QueueResource.Tag<VoidQueue>()("@td/VoidQueue", { payload: jobSchema }) {}

// a `void`-returning worker compiles
const _voidLayer = QueueResource.layer(VoidQueue, {
  effect: (_job) => Effect.void,
});
void _voidLayer;

// `Completed.success` on the live `events` stream is exactly `void`
type VoidCompletedEvent = Extract<
  StreamElement<ServiceOf<SpecOf<typeof VoidQueue>>["events"]>,
  { readonly _tag: "Completed" }
>;
expectExact<Equals<VoidCompletedEvent["success"], void>>();

// `Completed.success` on the analytics read is exactly `void`
type VoidCompleted = QueueStoreCompleted<typeof VoidQueue>;
expectExact<Equals<VoidCompleted["success"], void>>();
