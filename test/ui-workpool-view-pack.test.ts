/**
 * WorkPoolView observe pack exports + queueControls bind.
 */
import { Effect, Schema, SubscriptionRef } from "effect";
import { Atom, AtomRegistry, AsyncResult } from "effect/unstable/reactivity";
import { describe, expect, it } from "vitest";
import * as Hyperlink from "../src/Hyperlink";
import * as Observe from "../src/Observe";
import * as WorkPoolView from "../src/ui/WorkPoolView";

class ControlSvc extends Hyperlink.Tag<ControlSvc>()("observe-pack/ControlSvc", {
  pause: Hyperlink.effect(Schema.Void),
  resume: Hyperlink.effect(Schema.Void),
  clear: Hyperlink.effect(Schema.Void),
  stop: Hyperlink.effect(Schema.Void),
}) {}

const makeControlLayer = () =>
  Hyperlink.layer(
    ControlSvc,
    Effect.succeed({
      pause: Effect.void,
      resume: Effect.void,
      clear: Effect.void,
      stop: Effect.void,
    }),
  );

describe("WorkPoolView.pack", () => {
  it("exports a named pack and control / logs slices", () => {
    expect(WorkPoolView.pack.id).toBe("workpool/queue");
    expect(WorkPoolView.queueControls).toBeDefined();
    expect(WorkPoolView.queueMetricsHistory).toBeDefined();
    expect(WorkPoolView.queueLogs).toBeDefined();
  });
});

describe("WorkPoolView.queueControls", () => {
  it("binds memoized command atoms", () => {
    const rt = Atom.runtime(makeControlLayer());
    const a = Observe.bind(rt)(ControlSvc, WorkPoolView.queueControls);
    const b = Observe.bind(rt)(ControlSvc, WorkPoolView.queueControls);
    expect(a).toBe(b);
    expect(a.pause).toBe(b.pause);
    expect(a.resume).toBeDefined();
    expect(a.clear).toBeDefined();
    expect(a.stop).toBeDefined();
  });
});

describe("WorkPoolView.pack dual status/trend", () => {
  it("shares fold parent via Observe.map (same pattern as pack)", () => {
    const Status = Schema.Struct({
      sizes: Schema.Struct({
        high: Schema.Number,
        normal: Schema.Number,
        low: Schema.Number,
      }),
    });
    class StatusSvc extends Hyperlink.Tag<StatusSvc>()("observe-pack/StatusSvc", {
      status: Hyperlink.ref(Status),
    }) {}

    const layer = Hyperlink.layer(
      StatusSvc,
      Effect.gen(function* () {
        const cell = yield* SubscriptionRef.make({
          sizes: { high: 1, normal: 2, low: 3 },
        });
        return { status: Hyperlink.subscribable(cell) };
      }),
    );

    const statusTrend = Observe.fold(
      (q: StatusSvc["Service"]) => q.status,
      {
        initial: () => ({ pending: 0, trend: [] as Array<number> }),
        step: (acc, s) => {
          const pending = s.sizes.high + s.sizes.normal + s.sizes.low;
          return { pending, trend: [...acc.trend, pending].slice(-60) };
        },
        channel: (tag) => `${tag.key}/status-trend-test`,
      },
    );
    const pack = Observe.struct({
      pending: Observe.map(statusTrend, (a) => a.pending),
      trend: Observe.map(statusTrend, (a) => a.trend),
    });

    const rt = Atom.runtime(layer);
    const box = Observe.bind(rt)(StatusSvc, pack);
    const registry = AtomRegistry.make();
    registry.mount(box.pending);
    registry.mount(box.trend);

    return Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.sleep("50 millis");
        const pending = registry.get(box.pending);
        const trend = registry.get(box.trend);
        expect(AsyncResult.isSuccess(pending) ? pending.value : undefined).toBe(6);
        expect(AsyncResult.isSuccess(trend) ? trend.value : undefined).toEqual([6]);
      }),
    );
  });
});
