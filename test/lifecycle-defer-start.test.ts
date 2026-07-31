import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { Daemon, Hyperlink, Lifecycle, WorkPool, methodMeta } from "../src/index";
import { daemonControlSpec } from "../src/Daemon";
import { queueControlSpec } from "../src/WorkPool";

describe("Lifecycle method roles", () => {
  it("stamps WorkPool control verbs for generic tools", () => {
    expect(methodMeta(queueControlSpec.status).lifecycle).toBe("state");
    expect(methodMeta(queueControlSpec.start).lifecycle).toBe("start");
    expect(methodMeta(queueControlSpec.pause).lifecycle).toBe("pause");
    expect(methodMeta(queueControlSpec.resume).lifecycle).toBe("resume");
    expect(methodMeta(queueControlSpec.shutdown).lifecycle).toBe("stop");
    expect(methodMeta(queueControlSpec.clear).lifecycle).toBeUndefined();
  });

  it("stamps Daemon control verbs for generic tools", () => {
    expect(methodMeta(daemonControlSpec.status).lifecycle).toBe("state");
    expect(methodMeta(daemonControlSpec.start).lifecycle).toBe("start");
    expect(methodMeta(daemonControlSpec.stop).lifecycle).toBe("stop");
  });

  it("projects kind-native status into Lifecycle.State", () => {
    expect(
      Lifecycle.fromWorkPool({ phase: "idle", paused: false }),
    ).toBe("idle");
    expect(
      Lifecycle.fromWorkPool({ phase: "running", paused: true }),
    ).toBe("paused");
    expect(
      Lifecycle.fromWorkPool({ phase: "running", paused: false }),
    ).toBe("running");
    expect(Lifecycle.fromDaemon({ supervising: false })).toBe("idle");
    expect(Lifecycle.fromDaemon({ supervising: true })).toBe("running");
  });

  it("accepts .pipe(Lifecycle.pause) on a Spec method", () => {
    const method = Hyperlink.effect(Schema.Void)
      .annotate({ description: "Hold." })
      .pipe(Lifecycle.pause);
    expect(methodMeta(method)).toMatchObject({
      description: "Hold.",
      lifecycle: "pause",
    });
  });
});

describe("Hyperlink.deferStart", () => {
  class Jobs extends WorkPool.Tag<Jobs>()("test/LifecycleDefer/Jobs", {
    payload: Schema.Struct({ n: Schema.Number }),
  }) {}

  class Sweeper extends Daemon.Tag<Sweeper>()("test/LifecycleDefer/Sweeper") {}

  it.effect("WorkPool layer stays idle until start", () =>
    Effect.gen(function* () {
      const layer = WorkPool.layer(Jobs, {
        effect: () => Effect.void,
      }).pipe(Hyperlink.deferStart);

      yield* Effect.gen(function* () {
        const jobs = yield* Jobs;
        const before = yield* jobs.status.get;
        expect(before.phase).toBe("idle");
        expect(Lifecycle.fromWorkPool(before)).toBe("idle");
        yield* jobs.start;
        expect((yield* jobs.status.get).phase).toBe("running");
      }).pipe(Effect.provide(layer), Effect.scoped);
    }),
  );

  it.effect("WorkPool autoStart: true wins over deferStart", () =>
    Effect.gen(function* () {
      const layer = WorkPool.layer(Jobs, {
        effect: () => Effect.void,
        autoStart: true,
      }).pipe(Hyperlink.deferStart);

      yield* Effect.gen(function* () {
        const jobs = yield* Jobs;
        expect((yield* jobs.status.get).phase).toBe("running");
      }).pipe(Effect.provide(layer), Effect.scoped);
    }),
  );

  it.effect("Daemon layer waits for start when deferred", () =>
    Effect.gen(function* () {
      const layer = Daemon.layer(Sweeper, {
        effect: Effect.void,
      }).pipe(Hyperlink.deferStart);

      yield* Effect.gen(function* () {
        const sweeper = yield* Sweeper;
        const before = yield* sweeper.status.get;
        expect(before.supervising).toBe(false);
        expect(Lifecycle.fromDaemon(before)).toBe("idle");
        yield* sweeper.start;
        expect((yield* sweeper.status.get).supervising).toBe(true);
      }).pipe(Effect.provide(layer), Effect.scoped);
    }),
  );
});
