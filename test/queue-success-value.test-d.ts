import { Effect, Schema } from "effect";
import * as WorkPool from "../src/WorkPool";
import type { QueueStoreCompleted } from "../src/internal/store/queueStoreSpec";
import type { StoreHandleAtKey } from "../src/internal/store/defineStore";
import type { RegsOfStoreInput } from "../src/internal/store/registrationTypes";

// Phase 4 — the queue Tag's `success` schema slot drives the worker `effect` return type, and the
// typed success value `A` reaches `store.completed` / the analytics reads. No success schema → `void`.

// ── exact type-equality harness ──────────────────────────────────────────────
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const expectExact = <_Check extends true>(): void => {};

const jobSchema = Schema.Struct({ id: Schema.String });

// ── (a) declaring `success: Schema.Number` ──────────────────────────────────
class NumberQueue extends WorkPool.Tag<NumberQueue>()("@td/NumberQueue", {
  payload: jobSchema,
  success: Schema.Number,
}) {}

// the worker `effect` is REQUIRED to return `Effect<number, …>` (the success schema drives it)
const _numberLayer = WorkPool.layerMemory(NumberQueue, {
  effect: (job) => Effect.succeed(job.id.length),
});
void _numberLayer;

// returning the wrong success type is a type error
WorkPool.layerMemory(NumberQueue, {
  // @ts-expect-error worker must return `Effect<number, …>`, not `Effect<string, …>`
  effect: (_job) => Effect.succeed("nope"),
});

// a `void`-returning worker is rejected when a success schema is declared
WorkPool.layerMemory(NumberQueue, {
  // @ts-expect-error worker must return `Effect<number, …>`, not `Effect<void, …>`
  effect: (_job) => Effect.void,
});

// `Completed.success` on the analytics read is exactly `number`
type NumberCompleted = QueueStoreCompleted<typeof NumberQueue>;
expectExact<Equals<NumberCompleted["success"], number>>();

// `slowest()` carries the typed `Completed` (success = number)
type NumberRegs = RegsOfStoreInput<
  [ReturnType<typeof WorkPool.store<typeof NumberQueue>>]
>;
type NumberHandle = StoreHandleAtKey<NumberRegs, typeof NumberQueue>;
expectExact<
  Equals<
    NumberHandle["slowest"],
    (n: number) => Effect.Effect<ReadonlyArray<NumberCompleted>>
  >
>();

// ── (b) NO success schema → the worker stays `Effect<void, …>` ───────────────
class VoidQueue extends WorkPool.Tag<VoidQueue>()("@td/VoidQueue", { payload: jobSchema }) {}

// a `void`-returning worker compiles
const _voidLayer = WorkPool.layerMemory(VoidQueue, {
  effect: (_job) => Effect.void,
});
void _voidLayer;

// `Completed.success` on the analytics read is exactly `void`
type VoidCompleted = QueueStoreCompleted<typeof VoidQueue>;
expectExact<Equals<VoidCompleted["success"], void>>();
