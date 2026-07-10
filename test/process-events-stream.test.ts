import { describe, expect, it } from "@effect/vitest";
import { Data, Duration, Effect, Ref, Schema, Stream } from "effect";
import * as Process from "../src/Process";

class Tick extends Process.Tag<Tick>()("test/process-events/Tick").pipe(
  Process.schedule([]),
) {}

class PricedFailProc extends Process.Tag<PricedFailProc>()(
  "test/process-events/PricedFailProc",
  { error: Schema.TaggedStruct("FetchError", { status: Schema.Number }) },
).pipe(Process.schedule([])) {}

class FetchError extends Data.TaggedError("FetchError")<{
  readonly status: number;
}> {}

describe("Process — live events stream", () => {
  it.live("runImmediately publishes Started and Completed on events", () =>
    Effect.gen(function* () {
      const proc = yield* Tick;
      const tags = yield* Ref.make<ReadonlyArray<string>>([]);
      yield* Stream.runForEach(proc.events, (e) =>
        Ref.update(tags, (seen) => [...seen, e._tag]),
      ).pipe(Effect.forkScoped);
      yield* Effect.sleep(Duration.millis(20));
      yield* proc.runImmediately;
      yield* Effect.sleep(Duration.millis(80));
      const seen = yield* Ref.get(tags);
      expect(seen).toContain("Started");
      expect(seen).toContain("Completed");
    }).pipe(
      Effect.scoped,
      Effect.provide(Process.layer(Tick, { effect: Effect.void })),
    ),
  );

  it.live("Failed on events carries typed error when the tag stamps error", () =>
    Effect.gen(function* () {
      const proc = yield* PricedFailProc;
      const failed = yield* Ref.make<ReadonlyArray<{ readonly _tag: string; readonly status: number }>>([]);
      yield* Stream.runForEach(proc.events, (e) =>
        e._tag === "Failed"
          ? Ref.update(failed, (rows) => [
              ...rows,
              e.error as { readonly _tag: string; readonly status: number },
            ])
          : Effect.void,
      ).pipe(Effect.forkScoped);
      yield* Effect.sleep(Duration.millis(20));
      yield* proc.runImmediately;
      yield* Effect.sleep(Duration.millis(80));
      const rows = yield* Ref.get(failed);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ _tag: "FetchError", status: 503 });
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Process.layer(PricedFailProc, {
          effect: Effect.fail(new FetchError({ status: 503 })),
        }),
      ),
    ),
  );
});
