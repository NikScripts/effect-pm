/**
 * Step 5.1 — `State.Root` envelope + `State.transition` (COW) + `State.previous`.
 * A root scope's `layer` seeds one envelope `{ previous, current }` (plus any
 * domain `static Root` spread); transitions are copy-on-write; `State.previous`
 * yields the process-filtered prior slice for any scope. `yield* Scope` live
 * views are a follow-up increment.
 */
import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Schema } from "effect";
import { State } from "../src/State";

class GateScope extends State.Scope("@test/Gate", "Gate")({
  resourceId: Schema.String,
  concurrency: Schema.Number,
}) {}

class GateRunScope extends GateScope.withLeaf("Run", {
  runId: Schema.String,
}) {}

// Domain tag with optional `static Root` — spread onto the envelope top level.
class StateRootDomain extends Context.Service<
  StateRootDomain,
  Record<string, never>
>()("@test/StateRootDomain") {
  static readonly Root = { version: "0.1.0", author: "tester" };
}

class DomainScope extends State.Scope(StateRootDomain)({
  resourceId: Schema.String,
  concurrency: Schema.Number,
}) {}

const seed = GateScope.layer({ resourceId: "r1", concurrency: 4 });

describe("State.Root envelope", () => {
  it("layer seeds envelope { previous: null, current }", () => {
    const env = Effect.runSync(State.Root.pipe(Effect.provide(seed)));
    expect(env.previous).toBeNull();
    expect(env.current).toEqual({ resourceId: "r1", concurrency: 4 });
  });

  it("transition is copy-on-write: previous <- old current, current <- update", () => {
    const env = Effect.runSync(
      Effect.gen(function* () {
        yield* State.transition((current) => ({ ...current, concurrency: 8 }));
        return yield* State.Root;
      }).pipe(Effect.provide(seed)),
    );
    expect(env.previous).toEqual({ resourceId: "r1", concurrency: 4 });
    expect(env.current).toEqual({ resourceId: "r1", concurrency: 8 });
  });

  it("State.previous(scope) is null before any transition", () => {
    const before = Effect.runSync(State.previous(GateScope).pipe(Effect.provide(seed)));
    expect(before).toBeNull();
  });

  it("State.previous(rootScope) returns the filtered prior root slice", () => {
    const after = Effect.runSync(
      Effect.gen(function* () {
        yield* State.transition((c) => ({ ...c, concurrency: 9 }));
        return yield* State.previous(GateScope);
      }).pipe(Effect.provide(seed)),
    );
    expect(after).toEqual({ resourceId: "r1", concurrency: 4 });
  });

  it("State.previous(leafScope) returns the leaf nest slice from previous", () => {
    const result = Effect.runSync(
      Effect.gen(function* () {
        yield* State.transition((c) => ({ ...c, Run: { runId: "run-1" } }));
        yield* State.transition((c) => ({ ...c, Run: { runId: "run-2" } }));
        return yield* State.previous(GateRunScope);
      }).pipe(Effect.provide(seed)),
    );
    expect(result).toEqual({ runId: "run-1" });
  });

  it("spreads the domain tag's static Root onto the envelope", () => {
    const env = Effect.runSync(
      State.Root.pipe(
        Effect.provide(DomainScope.layer({ resourceId: "r1", concurrency: 4 })),
      ),
    );
    expect(env["version"]).toBe("0.1.0");
    expect(env["author"]).toBe("tester");
    expect(env.current).toEqual({ resourceId: "r1", concurrency: 4 });
  });

  it("transition does not mutate the prior snapshot (structural COW)", () => {
    const env = Effect.runSync(
      Effect.gen(function* () {
        yield* State.transition((c) => ({ ...c, concurrency: 5 }));
        yield* State.transition((c) => ({ ...c, concurrency: 6 }));
        return yield* State.Root;
      }).pipe(Effect.provide(seed)),
    );
    // previous is the one-step-back snapshot, not a history stack
    expect(env.previous).toEqual({ resourceId: "r1", concurrency: 5 });
    expect(env.current).toEqual({ resourceId: "r1", concurrency: 6 });
  });
});
