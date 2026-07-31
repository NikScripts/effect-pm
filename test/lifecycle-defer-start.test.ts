import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { Daemon, Hyperlink, Lifecycle, WorkPool, methodMeta } from "../src/index";
import { daemonControlSpec } from "../src/Daemon";
import { queueControlSpec } from "../src/WorkPool";

describe("Lifecycle building blocks", () => {
  it("stamps PascalCase roles on WorkPool control verbs", () => {
    expect(methodMeta(queueControlSpec.lifecycle).lifecycle).toBe("State");
    expect(methodMeta(queueControlSpec.start).lifecycle).toBe("Start");
    expect(methodMeta(queueControlSpec.pause).lifecycle).toBe("Pause");
    expect(methodMeta(queueControlSpec.resume).lifecycle).toBe("Resume");
    expect(methodMeta(queueControlSpec.shutdown).lifecycle).toBe("Stop");
    expect(methodMeta(queueControlSpec.status).lifecycle).toBeUndefined();
    expect(methodMeta(queueControlSpec.clear).lifecycle).toBeUndefined();
  });

  it("stamps PascalCase roles on Daemon control verbs", () => {
    expect(methodMeta(daemonControlSpec.lifecycle).lifecycle).toBe("State");
    expect(methodMeta(daemonControlSpec.start).lifecycle).toBe("Start");
    expect(methodMeta(daemonControlSpec.stop).lifecycle).toBe("Stop");
    expect(methodMeta(daemonControlSpec.status).lifecycle).toBeUndefined();
  });

  it("Lifecycle.State is the shared wire schema", () => {
    expect(Schema.decodeUnknownSync(Lifecycle.State)("Idle")).toBe("Idle");
    expect(Schema.decodeUnknownSync(Lifecycle.State)("Paused")).toBe("Paused");
    expect(() => Schema.decodeUnknownSync(Lifecycle.State)("idle")).toThrow();
  });

  it("accepts .pipe(Lifecycle.pause) on a Spec method", () => {
    const method = Hyperlink.effect(Schema.Void)
      .annotate({ description: "Hold." })
      .pipe(Lifecycle.pause);
    expect(methodMeta(method)).toMatchObject({
      description: "Hold.",
      lifecycle: "Pause",
    });
  });
});

describe("Hyperlink.deferStart", () => {
  class Jobs extends WorkPool.Tag<Jobs>()("test/LifecycleDefer/Jobs", {
    payload: Schema.Struct({ n: Schema.Number }),
  }) {}

  class Sweeper extends Daemon.Tag<Sweeper>()("test/LifecycleDefer/Sweeper") {}

  it.effect("WorkPool exposes Lifecycle.State Idle until start", () =>
    Effect.gen(function* () {
      const layer = WorkPool.layer(Jobs, {
        effect: () => Effect.void,
      }).pipe(Hyperlink.deferStart);

      yield* Effect.gen(function* () {
        const jobs = yield* Jobs;
        expect(yield* jobs.lifecycle.get).toBe("Idle");
        expect((yield* jobs.status.get).phase).toBe("idle");
        yield* jobs.start;
        expect(yield* jobs.lifecycle.get).toBe("Running");
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
        expect(yield* jobs.lifecycle.get).toBe("Running");
      }).pipe(Effect.provide(layer), Effect.scoped);
    }),
  );

  it.effect("Daemon exposes Lifecycle.State Idle when deferred", () =>
    Effect.gen(function* () {
      const layer = Daemon.layer(Sweeper, {
        effect: Effect.void,
      }).pipe(Hyperlink.deferStart);

      yield* Effect.gen(function* () {
        const sweeper = yield* Sweeper;
        expect(yield* sweeper.lifecycle.get).toBe("Idle");
        yield* sweeper.start;
        expect(yield* sweeper.lifecycle.get).toBe("Running");
      }).pipe(Effect.provide(layer), Effect.scoped);
    }),
  );
});
