import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Ref, Schema } from "effect";
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

  it("Lifecycle.State is the shared wire schema", () => {
    expect(Schema.decodeUnknownSync(Lifecycle.State)("Idle")).toBe("Idle");
    expect(() => Schema.decodeUnknownSync(Lifecycle.State)("idle")).toThrow();
  });
});

describe("Lifecycle.make — implementation end", () => {
  it.effect("runs onStart when initial is Running", () =>
    Effect.gen(function* () {
      const started = yield* Ref.make(0);
      const lc = yield* Lifecycle.make({
        initial: "Running",
        onStart: Ref.update(started, (n) => n + 1),
        onStop: Effect.void,
        afterStop: "Idle",
      });
      expect(yield* lc.state.get).toBe("Running");
      expect(yield* Ref.get(started)).toBe(1);
    }),
  );

  it.effect("Idle until start; pause / resume; stop → Idle when restartable", () =>
    Effect.gen(function* () {
      const log = yield* Ref.make<ReadonlyArray<string>>([]);
      const note = (s: string) => Ref.update(log, (xs) => [...xs, s]);
      const lc = yield* Lifecycle.make({
        initial: "Idle",
        onStart: note("start"),
        onPause: note("pause"),
        onResume: note("resume"),
        onStop: note("stop"),
        afterStop: "Idle",
      });
      expect(yield* lc.state.get).toBe("Idle");
      yield* lc.start;
      expect(yield* lc.state.get).toBe("Running");
      yield* lc.pause;
      expect(yield* lc.state.get).toBe("Paused");
      yield* lc.resume;
      expect(yield* lc.state.get).toBe("Running");
      yield* lc.stop;
      expect(yield* lc.state.get).toBe("Idle");
      expect(yield* Ref.get(log)).toEqual(["start", "pause", "resume", "stop"]);
      yield* lc.start;
      expect(yield* lc.state.get).toBe("Running");
    }),
  );

  it.effect("pause without onPause fails Unsupported", () =>
    Effect.gen(function* () {
      const lc = yield* Lifecycle.make({
        initial: "Running",
        onStart: Effect.void,
        onStop: Effect.void,
      });
      const exit = yield* Effect.exit(lc.pause);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const err = exit.cause;
        expect(String(err)).toContain("LifecycleUnsupported");
      }
    }),
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
        expect(yield* lc.state.get).toBe("Idle");
        yield* lc.start;
        expect(yield* lc.state.get).toBe("Running");
        yield* lc.pause;
        expect(yield* lc.state.get).toBe("Paused");
        yield* lc.resume;
        expect(yield* lc.state.get).toBe("Running");
      }).pipe(Effect.provide(layer), Effect.scoped);
    }),
  );

  it.effect("of(handle) matches from(Tag)", () =>
    Effect.gen(function* () {
      const layer = WorkPool.layer(Jobs, {
        effect: () => Effect.void,
        autoStart: true,
      });

      yield* Effect.gen(function* () {
        const jobs = yield* Jobs;
        const lc = Lifecycle.of(jobs);
        expect(yield* lc.state.get).toBe("Running");
        expect(yield* jobs.lifecycle.get).toBe("Running");
      }).pipe(Effect.provide(layer), Effect.scoped);
    }),
  );
});

describe("Hyperlink.deferStart + Daemon make", () => {
  class Sweeper extends Daemon.Tag<Sweeper>()("test/LifecycleService/Sweeper") {}

  it.effect("Daemon layer uses Lifecycle.make (Idle → Running)", () =>
    Effect.gen(function* () {
      const layer = Daemon.layer(Sweeper, {
        effect: Effect.void,
      }).pipe(Hyperlink.deferStart);

      yield* Effect.gen(function* () {
        const lc = yield* Lifecycle.from(Sweeper);
        expect(yield* lc.state.get).toBe("Idle");
        yield* lc.start;
        expect(yield* lc.state.get).toBe("Running");
        yield* lc.stop;
        expect(yield* lc.state.get).toBe("Idle");
        // Pause unsupported on Daemon
        const pauseExit = yield* Effect.exit(lc.pause);
        expect(Exit.isFailure(pauseExit)).toBe(true);
      }).pipe(Effect.provide(layer), Effect.scoped);
    }),
  );
});
