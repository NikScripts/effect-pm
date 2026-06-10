/**
 * Step 5.4 (start) — optional emit hook on `State.transition`. When a
 * `StateChangedEmitter` is in context, each transition calls `onTransition` with
 * the new envelope; when absent, transitions are a no-op for emit (no telemetry
 * tax). The real materializer/scheduler lands in Step 6.
 */
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Ref, Schema } from "effect";
import { State, type StateEnvelope } from "../src/State";

class GateScope extends State.Scope("@test/HookGate", "Gate")({
  resourceId: Schema.String,
  concurrency: Schema.Number,
}) {}

const seed = GateScope.layer({ resourceId: "r1", concurrency: 4 });

describe("State.transition emit hook", () => {
  it("is a no-op when no emitter is provided", () => {
    const env = Effect.runSync(
      Effect.gen(function* () {
        yield* State.transition((c) => ({ ...c, concurrency: 7 }));
        return yield* State.Root;
      }).pipe(Effect.provide(seed)),
    );
    expect(env.current).toEqual({ resourceId: "r1", concurrency: 7 });
  });

  it("calls onTransition with the new envelope when an emitter is present", () => {
    const calls = Effect.runSync(
      Effect.gen(function* () {
        const log = yield* Ref.make<ReadonlyArray<StateEnvelope<Record<string, unknown>>>>([]);
        const emitterLayer = Layer.succeed(State.StateChangedEmitter, {
          onTransition: (envelope) => Ref.update(log, (xs) => [...xs, envelope]),
        });
        yield* State.transition((c) => ({ ...c, concurrency: 8 })).pipe(
          Effect.provide(emitterLayer),
        );
        yield* State.transition((c) => ({ ...c, concurrency: 9 })).pipe(
          Effect.provide(emitterLayer),
        );
        return yield* Ref.get(log);
      }).pipe(Effect.provide(seed)),
    );

    expect(calls).toHaveLength(2);
    expect(calls[0]?.current).toEqual({ resourceId: "r1", concurrency: 8 });
    expect(calls[1]?.previous).toEqual({ resourceId: "r1", concurrency: 8 });
    expect(calls[1]?.current).toEqual({ resourceId: "r1", concurrency: 9 });
  });
});
