import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Latch, Ref, Schema, Stream } from "effect";
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

  it("Lifecycle.Event is a tagged wire schema", () => {
    expect(
      Schema.decodeUnknownSync(Lifecycle.Event)({
        _tag: "Stopped",
        to: { _tag: "Idle" },
      }),
    ).toEqual({ _tag: "Stopped", to: { _tag: "Idle" } });
  });
});

describe("Lifecycle.make — Effect-shaped", () => {
  it.effect("runs when not deferred; pause / resume via Latch; stop → Idle when restartable", () =>
    Effect.gen(function* () {
      const ticks = yield* Ref.make(0);
      const latch = yield* Latch.make(true);
      const lc = yield* Lifecycle.make({
        run: Effect.gen(function* () {
          yield* Ref.update(ticks, (n) => n + 1);
          return yield* Effect.never;
        }),
        latch,
        restartable: true,
      }).pipe(Effect.provideService(Hyperlink.DeferStart, false));

      expect(yield* lc.state.get).toEqual({ _tag: "Running" });
      expect(yield* Ref.get(ticks)).toBe(1);

      yield* lc.pause;
      expect(yield* lc.state.get).toEqual({ _tag: "Paused" });
      yield* lc.resume;
      expect(yield* lc.state.get).toEqual({ _tag: "Running" });

      yield* lc.stop;
      expect(yield* lc.state.get).toEqual({ _tag: "Idle" });

      yield* lc.start;
      expect(yield* lc.state.get).toEqual({ _tag: "Running" });
    }).pipe(Effect.scoped),
  );

  it.effect("DeferStart keeps Idle until start", () =>
    Effect.gen(function* () {
      const lc = yield* Lifecycle.make({
        run: Effect.never,
        restartable: true,
      }).pipe(Effect.provideService(Hyperlink.DeferStart, true));

      expect(yield* lc.state.get).toEqual({ _tag: "Idle" });
      yield* lc.start;
      expect(yield* lc.state.get).toEqual({ _tag: "Running" });
    }).pipe(Effect.scoped),
  );

  it.effect("pause without Latch fails LifecycleUnsupported — catchTag on _tag", () =>
    Effect.gen(function* () {
      const lc = yield* Lifecycle.make({
        run: Effect.never,
        restartable: false,
      }).pipe(Effect.provideService(Hyperlink.DeferStart, false));

      const role = yield* lc.pause.pipe(
        Effect.catchTag("LifecycleUnsupported", (e) => Effect.succeed(e.role)),
      );
      expect(role).toBe("Pause");
    }).pipe(Effect.scoped),
  );

  it.effect("start from Off fails LifecycleIllegal — catchTag; from._tag", () =>
    Effect.gen(function* () {
      const lc = yield* Lifecycle.make({
        run: Effect.never,
        restartable: false,
      }).pipe(Effect.provideService(Hyperlink.DeferStart, false));

      yield* lc.stop;
      expect(yield* lc.state.get).toEqual({ _tag: "Off" });

      const fromTag = yield* lc.start.pipe(
        Effect.catchTag("LifecycleIllegal", (e) => Effect.succeed(e.from._tag)),
      );
      expect(fromTag).toBe("Off");
    }).pipe(Effect.scoped),
  );

  it.effect("events stream uses _tag; runForEachTag dispatches", () =>
    Effect.gen(function* () {
      const lc = yield* Lifecycle.make({
        run: Effect.never,
        latch: yield* Latch.make(true),
        restartable: true,
      }).pipe(Effect.provideService(Hyperlink.DeferStart, true));

      const done = yield* Deferred.make<ReadonlyArray<string>>();
      yield* lc.events.pipe(
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

      yield* lc.start;
      yield* lc.pause;
      yield* lc.resume;

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
        restartable: true,
      }).pipe(Effect.provideService(Hyperlink.DeferStart, true));

      const seen = yield* Ref.make<ReadonlyArray<string>>([]);
      yield* lc.changes.pipe(
        Stream.take(2),
        Hyperlink.runForEachTag({
          Idle: () => Ref.update(seen, (xs) => [...xs, "Idle"]),
          Running: () => Ref.update(seen, (xs) => [...xs, "Running"]),
        }),
        Effect.forkScoped,
      );
      yield* Effect.yieldNow;

      yield* lc.start;
      expect(yield* Ref.get(seen)).toEqual(["Idle", "Running"]);
    }).pipe(Effect.scoped),
  );
});

describe("Lifecycle.of / from — tool end", () => {
  class Jobs extends WorkPool.Tag<Jobs>()("test/LifecycleService/Jobs", {
    payload: Schema.Struct({ n: Schema.Number }),
  }) {}

  it.effect("from(Tag) projects the first-class Service", () =>
    Effect.gen(function* () {
      const layer = WorkPool.layer(Jobs, {
        effect: () => Effect.void,
      }).pipe(Hyperlink.deferStart);

      yield* Effect.gen(function* () {
        const lc = yield* Lifecycle.from(Jobs);
        expect(yield* lc.state.get).toEqual({ _tag: "Idle" });
        yield* lc.start;
        expect(yield* lc.state.get).toEqual({ _tag: "Running" });
        yield* lc.pause;
        expect(yield* lc.state.get).toEqual({ _tag: "Paused" });
        yield* lc.resume;
        expect(yield* lc.state.get).toEqual({ _tag: "Running" });
      }).pipe(Effect.provide(layer), Effect.scoped);
    }),
  );

  it.effect("of(handle) matches from(Tag)", () =>
    Effect.gen(function* () {
      const layer = WorkPool.layer(Jobs, {
        effect: () => Effect.void,
      });

      yield* Effect.gen(function* () {
        const jobs = yield* Jobs;
        const lc = Lifecycle.of(jobs);
        expect(yield* lc.state.get).toEqual({ _tag: "Running" });
        expect(yield* jobs.lifecycle.get).toEqual({ _tag: "Running" });
      }).pipe(Effect.provide(layer), Effect.scoped);
    }),
  );
});

describe("Hyperlink.deferStart + Daemon make", () => {
  class Sweeper extends Daemon.Tag<Sweeper>()("test/LifecycleService/Sweeper") {}

  it.effect("Daemon layer uses Lifecycle.make (Idle → Running → Idle)", () =>
    Effect.gen(function* () {
      const layer = Daemon.layer(Sweeper, {
        effect: Effect.void,
      }).pipe(Hyperlink.deferStart);

      yield* Effect.gen(function* () {
        const lc = yield* Lifecycle.from(Sweeper);
        expect(yield* lc.state.get).toEqual({ _tag: "Idle" });
        yield* lc.start;
        expect(yield* lc.state.get).toEqual({ _tag: "Running" });
        yield* lc.stop;
        expect(yield* lc.state.get).toEqual({ _tag: "Idle" });

        const role = yield* lc.pause.pipe(
          Effect.catchTag("LifecycleUnsupported", (e) => Effect.succeed(e.role)),
        );
        expect(role).toBe("Pause");
      }).pipe(Effect.provide(layer), Effect.scoped);
    }),
  );
});

describe("Lifecycle.spec / impl", () => {
  it("spec(pausable) includes pause/resume roles", () => {
    const s = Lifecycle.spec({ pausable: true });
    expect(methodMeta(s.lifecycle).lifecycle).toBe("State");
    expect(methodMeta(s.start).lifecycle).toBe("Start");
    expect(methodMeta(s.stop).lifecycle).toBe("Stop");
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
  });
});
