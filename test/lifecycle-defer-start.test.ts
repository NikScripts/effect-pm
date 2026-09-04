import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Latch, Ref, Schema, Stream, SubscriptionRef } from "effect";
import { Daemon, Hyperlink, Lifecycle, WorkPool, methodMeta } from "../src/index";
import { daemonControlSpec } from "../src/Daemon";
import { queueControlSpec } from "../src/WorkPool";

describe("Lifecycle building blocks", () => {
  it("stamps PascalCase roles on WorkPool control verbs", () => {
    expect(methodMeta(queueControlSpec.lifecycle).lifecycle).toBe("State");
    expect(methodMeta(queueControlSpec.start).lifecycle).toBe("Start");
    expect(methodMeta(queueControlSpec.pause).lifecycle).toBe("Pause");
    expect(methodMeta(queueControlSpec.resume).lifecycle).toBe("Resume");
    expect(methodMeta(queueControlSpec.stop).lifecycle).toBe("Stop");
  });

  it("stamps PascalCase roles on Daemon control verbs", () => {
    expect(methodMeta(daemonControlSpec.lifecycle).lifecycle).toBe("State");
    expect(methodMeta(daemonControlSpec.start).lifecycle).toBe("Start");
    expect(methodMeta(daemonControlSpec.stop).lifecycle).toBe("Stop");
  });

  it("Lifecycle.State is a tagged wire schema", () => {
    expect(Schema.decodeUnknownSync(Lifecycle.State)({ _tag: "Idle" })).toEqual({
      _tag: "Idle",
    });
    expect(() => Schema.decodeUnknownSync(Lifecycle.State)("Idle")).toThrow();
  });

  it("stateRef / eventStream stamp Role State and carry schemas", () => {
    expect(methodMeta(Lifecycle.stateRef).lifecycle).toBe("State");
    expect(methodMeta(Lifecycle.spec().lifecycle).lifecycle).toBe("State");
    expect("lifecycleEvents" in Lifecycle.spec()).toBe(true);
  });

  it("Lifecycle.Event is a tagged wire schema", () => {
    expect(
      Schema.decodeUnknownSync(Lifecycle.Event)({
        _tag: "Stopped",
        to: { _tag: "Idle" },
      }),
    ).toEqual({ _tag: "Stopped", to: { _tag: "Idle" } });
  });
});

describe("Lifecycle.make — Effect-native dual ops", () => {
  it.effect("runs when not deferred; pause / resume via Latch; stop → Idle when afterStop Idle", () =>
    Effect.gen(function* () {
      const ticks = yield* Ref.make(0);
      const latch = yield* Latch.make(true);
      const lc = yield* Lifecycle.make({
        run: Effect.gen(function* () {
          yield* Ref.update(ticks, (n) => n + 1);
          return yield* Effect.never;
        }),
        latch,
        afterStop: Lifecycle.idle,
      }).pipe(Effect.provideService(Hyperlink.DeferStart, false));

      expect(yield* SubscriptionRef.get(lc.state)).toEqual({ _tag: "Running" });
      expect(yield* Ref.get(ticks)).toBe(1);

      yield* Lifecycle.pause(lc);
      expect(yield* SubscriptionRef.get(lc.state)).toEqual({ _tag: "Paused" });
      yield* Lifecycle.resume(lc);
      expect(yield* SubscriptionRef.get(lc.state)).toEqual({ _tag: "Running" });

      yield* Lifecycle.stop(lc);
      expect(yield* SubscriptionRef.get(lc.state)).toEqual({ _tag: "Idle" });

      yield* Lifecycle.start(lc);
      expect(yield* SubscriptionRef.get(lc.state)).toEqual({ _tag: "Running" });
    }).pipe(Effect.scoped),
  );

  it.effect("DeferStart keeps Idle until Lifecycle.start", () =>
    Effect.gen(function* () {
      const lc = yield* Lifecycle.make({
        run: Effect.never,
        afterStop: Lifecycle.idle,
      }).pipe(Effect.provideService(Hyperlink.DeferStart, true));

      expect(yield* SubscriptionRef.get(lc.state)).toEqual({ _tag: "Idle" });
      yield* Lifecycle.start(lc);
      expect(yield* SubscriptionRef.get(lc.state)).toEqual({ _tag: "Running" });
    }).pipe(Effect.scoped),
  );

  it.effect("pause without Latch — dual fails LifecycleUnsupported", () =>
    Effect.gen(function* () {
      const lc = yield* Lifecycle.make({
        run: Effect.never,
        afterStop: Lifecycle.off,
      }).pipe(Effect.provideService(Hyperlink.DeferStart, false));

      const role = yield* Lifecycle.pause(lc).pipe(
        Effect.catchTag("LifecycleUnsupported", (e) => Effect.succeed(e.role)),
      );
      expect(role).toBe("Pause");
    }).pipe(Effect.scoped),
  );

  it.effect("start from Off fails LifecycleIllegal — catchTag; from._tag", () =>
    Effect.gen(function* () {
      const lc = yield* Lifecycle.make({
        run: Effect.never,
        afterStop: Lifecycle.off,
      }).pipe(Effect.provideService(Hyperlink.DeferStart, false));

      yield* Lifecycle.stop(lc);
      expect(yield* SubscriptionRef.get(lc.state)).toEqual({ _tag: "Off" });

      const fromTag = yield* Lifecycle.start(lc).pipe(
        Effect.catchTag("LifecycleIllegal", (e) => Effect.succeed(e.from._tag)),
      );
      expect(fromTag).toBe("Off");
    }).pipe(Effect.scoped),
  );

  it.effect("events stream is derived from state changes (_tag)", () =>
    Effect.gen(function* () {
      const lc = yield* Lifecycle.make({
        run: Effect.never,
        latch: yield* Latch.make(true),
        afterStop: Lifecycle.idle,
      }).pipe(Effect.provideService(Hyperlink.DeferStart, true));

      const done = yield* Deferred.make<ReadonlyArray<string>>();
      yield* Lifecycle.events(lc).pipe(
        Stream.take(3),
        Stream.runCollect,
        Effect.flatMap((chunk) =>
          Deferred.succeed(
            done,
            [...chunk].map((e) => e._tag),
          ),
        ),
        Effect.forkScoped,
      );
      yield* Effect.yieldNow;

      yield* Lifecycle.start(lc);
      yield* Lifecycle.pause(lc);
      yield* Lifecycle.resume(lc);

      expect(yield* Deferred.await(done)).toEqual([
        "Started",
        "Paused",
        "Resumed",
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("state changes match on _tag via runForEachTag", () =>
    Effect.gen(function* () {
      const lc = yield* Lifecycle.make({
        run: Effect.never,
        afterStop: Lifecycle.idle,
      }).pipe(Effect.provideService(Hyperlink.DeferStart, true));

      const seen = yield* Ref.make<ReadonlyArray<string>>([]);
      yield* SubscriptionRef.changes(lc.state).pipe(
        Stream.take(2),
        Hyperlink.runForEachTag({
          Idle: () => Ref.update(seen, (xs) => [...xs, "Idle"]),
          Running: () => Ref.update(seen, (xs) => [...xs, "Running"]),
        }),
        Effect.forkScoped,
      );
      yield* Effect.yieldNow;

      yield* Lifecycle.start(lc);
      expect(yield* Ref.get(seen)).toEqual(["Idle", "Running"]);
    }).pipe(Effect.scoped),
  );

  it.effect("exposes real FiberHandle on fibers", () =>
    Effect.gen(function* () {
      const lc = yield* Lifecycle.make({
        run: Effect.never,
      }).pipe(Effect.provideService(Hyperlink.DeferStart, true));
      expect(lc.fibers._tag).toBe("Handle");
      expect(lc.latch).toBeUndefined();
    }).pipe(Effect.scoped),
  );
});

describe("Lifecycle duals on Participating (tools)", () => {
  class Jobs extends WorkPool.Service<Jobs>()("test/LifecycleService/Jobs", {
    payload: Schema.Struct({ n: Schema.Number }),
  }) {}

  it.effect("Lifecycle.start(Tag) / pause / resume on wire handle", () =>
    Effect.gen(function* () {
      const layer = WorkPool.layer(Jobs, {
        effect: () => Effect.void,
      }).pipe(Hyperlink.deferStart);

      yield* Effect.gen(function* () {
        const jobs = yield* Jobs;
        expect(yield* jobs.lifecycle.get).toEqual({ _tag: "Idle" });
        yield* Lifecycle.start(Jobs);
        expect(yield* jobs.lifecycle.get).toEqual({ _tag: "Running" });
        yield* Lifecycle.pause(jobs);
        expect(yield* jobs.lifecycle.get).toEqual({ _tag: "Paused" });
        yield* Lifecycle.resume(jobs);
        expect(yield* jobs.lifecycle.get).toEqual({ _tag: "Running" });
      }).pipe(Effect.provide(layer), Effect.scoped);
    }),
  );

  it.effect("Lifecycle.start(jobs) matches Lifecycle.start(Tag)", () =>
    Effect.gen(function* () {
      const layer = WorkPool.layer(Jobs, {
        effect: () => Effect.void,
      });

      yield* Effect.gen(function* () {
        const jobs = yield* Jobs;
        expect(yield* jobs.lifecycle.get).toEqual({ _tag: "Running" });
        yield* Lifecycle.start(jobs); // idempotent
        yield* Lifecycle.start(Jobs);
        expect(yield* jobs.lifecycle.get).toEqual({ _tag: "Running" });
      }).pipe(Effect.provide(layer), Effect.scoped);
    }),
  );

  it.effect("events(jobs) projects lifecycleEvents (_tag Started)", () =>
    Effect.gen(function* () {
      const layer = WorkPool.layer(Jobs, {
        effect: () => Effect.void,
      }).pipe(Hyperlink.deferStart);

      yield* Effect.gen(function* () {
        const jobs = yield* Jobs;
        const done = yield* Deferred.make<string>();
        yield* Lifecycle.events(jobs).pipe(
          Stream.take(1),
          Stream.runCollect,
          Effect.flatMap((chunk) =>
            Deferred.succeed(done, [...chunk][0]!._tag),
          ),
          Effect.forkScoped,
        );
        yield* Effect.yieldNow;
        yield* Lifecycle.start(jobs);
        expect(yield* Deferred.await(done)).toBe("Started");
      }).pipe(Effect.provide(layer), Effect.scoped);
    }),
  );

  it.effect("start(jobs) from Off fails LifecycleIllegal (handle swallows)", () =>
    Effect.gen(function* () {
      const layer = WorkPool.layer(Jobs, {
        effect: () => Effect.void,
      });

      yield* Effect.gen(function* () {
        const jobs = yield* Jobs;
        yield* jobs.stop;
        expect(yield* jobs.lifecycle.get).toEqual({ _tag: "Off" });

        const fromTag = yield* Lifecycle.start(jobs).pipe(
          Effect.catchTag("LifecycleIllegal", (e) => Effect.succeed(e.from._tag)),
        );
        expect(fromTag).toBe("Off");
      }).pipe(Effect.provide(layer), Effect.scoped);
    }),
  );
});

describe("Hyperlink.deferStart + Daemon make", () => {
  class Sweeper extends Daemon.Service<Sweeper>()("test/LifecycleService/Sweeper") {}

  it.effect("Daemon layer — start(Tag) / stop(Tag) (Idle → Running → Idle)", () =>
    Effect.gen(function* () {
      const layer = Daemon.layer(Sweeper, {
        effect: Effect.void,
      }).pipe(Hyperlink.deferStart);

      yield* Effect.gen(function* () {
        const sweeper = yield* Sweeper;
        expect(yield* sweeper.lifecycle.get).toEqual({ _tag: "Idle" });
        yield* Lifecycle.start(Sweeper);
        expect(yield* sweeper.lifecycle.get).toEqual({ _tag: "Running" });
        yield* Lifecycle.stop(Sweeper);
        expect(yield* sweeper.lifecycle.get).toEqual({ _tag: "Idle" });

        const role = yield* Lifecycle.pause(sweeper).pipe(
          Effect.catchTag("LifecycleUnsupported", (e) => Effect.succeed(e.role)),
        );
        expect(role).toBe("Pause");
      }).pipe(Effect.provide(layer), Effect.scoped);
    }),
  );
});

describe("Lifecycle.spec / impl", () => {
  it("spec(pausable) includes pause/resume roles + lifecycleEvents", () => {
    const s = Lifecycle.spec({ pausable: true });
    expect(methodMeta(s.lifecycle).lifecycle).toBe("State");
    expect(methodMeta(s.start).lifecycle).toBe("Start");
    expect(methodMeta(s.stop).lifecycle).toBe("Stop");
    expect("lifecycleEvents" in s).toBe(true);
    expect("pause" in s && "resume" in s).toBe(true);
    if ("pause" in s && "resume" in s) {
      expect(methodMeta(s.pause).lifecycle).toBe("Pause");
      expect(methodMeta(s.resume).lifecycle).toBe("Resume");
    }
  });

  it("spec() without pause omits pause/resume", () => {
    const s = Lifecycle.spec({ pausable: false });
    expect("pause" in s).toBe(false);
    expect("resume" in s).toBe(false);
    expect("lifecycleEvents" in s).toBe(true);
  });
});

describe("Lifecycle control Spec keys", () => {
  it("queueControlSpec includes lifecycleEvents", () => {
    expect("lifecycleEvents" in queueControlSpec).toBe(true);
  });

  it("daemonControlSpec includes lifecycleEvents", () => {
    expect("lifecycleEvents" in daemonControlSpec).toBe(true);
  });
});
