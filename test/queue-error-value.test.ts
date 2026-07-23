import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Option, Ref, Schema, Stream } from "effect";
import * as WorkPool from "../src/WorkPool";

// The error-side mirror of queue-success-value: the queue Tag's `error` schema slot drives the
// worker's failure channel (M2/M4), and that typed error flows onto the event `cause` (a
// `Cause<Error>`). A worker that fails only typechecks when the tag declares the matching `error`
// schema — otherwise the failure must defect. The *type* half (a payload-only tag's `Error` is
// exactly `never`) is proven in `queue-handle.test-d.ts`; here we prove the *runtime* half: a
// declared error's value reaches the event cause verbatim.

const jobSchema = Schema.Struct({ id: Schema.String });

// queue WITH an error schema — the worker may fail with the declared type
class Flaky extends WorkPool.Tag<Flaky>()("@test/Flaky", {
  payload: jobSchema,
  error: Schema.String,
}) {}

const flakyLayer = WorkPool.layerMemory(Flaky, {
  effect: (job) => Effect.fail(`boom:${job.id}`),
  attempts: 1, // no re-enqueue → a single terminal failure carrying the typed cause
  concurrency: 1,
});

describe("WorkPool — error-value channel", () => {
  it.live(
    "an error-schema worker records its typed failure value on the event cause",
    () =>
      Effect.gen(function* () {
        const q = yield* Flaky;
        const seen = yield* Ref.make<ReadonlyArray<string>>([]);
        yield* Stream.runForEach(q.events, (e) =>
          e._tag === "Failed" || e._tag === "RetryExhausted"
            ? Option.match(Cause.findErrorOption(e.cause), {
                onNone: () => Effect.void,
                onSome: (err) => Ref.update(seen, (a) => [...a, err]),
              })
            : Effect.void,
        ).pipe(Effect.forkScoped);
        yield* Effect.sleep("20 millis");
        yield* q.add({ id: "x" });
        yield* Effect.sleep("120 millis");
        // the declared `error: Schema.String` value flows through to the cause verbatim
        expect(yield* Ref.get(seen)).toContain("boom:x");
      }).pipe(Effect.scoped, Effect.provide(flakyLayer)),
  );
});
