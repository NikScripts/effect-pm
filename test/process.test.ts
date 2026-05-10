import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Layer, Option, Ref } from "effect";
import { TestClock } from "effect/testing";
import { Process, ProcessSchedule, Polling, ProcessStore } from "../src";

/** Polling cadence for most supervisor tests (must line up with TestClock steps). */
const tickSpacing = Duration.seconds(1);

/** Disarmed idle poll short enough for deterministic TestClock steps. */
const disarmedPoll = Duration.seconds(1);

const supervisorTestRuntime = (args: {
  readonly armed: Ref.Ref<boolean>;
  readonly nextScheduleTransition?: Ref.Ref<Option.Option<Date>>;
}) =>
  Layer.mergeAll(
    ProcessStore.layer,
    Polling.spaced(tickSpacing),
    args.nextScheduleTransition !== undefined
      ? ProcessSchedule.fromArmedRef({
          armed: args.armed,
          nextScheduleTransition: args.nextScheduleTransition,
        })
      : ProcessSchedule.fromArmedRef({ armed: args.armed }),
  );

describe("Process.make — ProcessStore integration", () => {
  it.live("records successful runImmediately executions when ProcessStore is provided", () => {
    const proc = Process.make({
      name: "test/process-store-success",
      effect: Effect.void,
      polling: Polling.spaced(Duration.seconds(60)),
      schedule: ProcessSchedule.alwaysArmed,
    });

    return Effect.gen(function* () {
      yield* proc.runImmediately();
      const store = yield* ProcessStore;
      const rows = yield* store.getProcessExecutions(proc.name);
      expect(rows.length).toBe(1);
      expect(rows[0]?.execution.status).toBe("completed");
    }).pipe(Effect.provide(ProcessStore.layer));
  });

  it.live("ProcessStore supports direct lifecycle and execution queries", () =>
    Effect.gen(function* () {
      const store = yield* ProcessStore;
      const now = new Date("2026-01-01T00:00:00.000Z");

      yield* store.append({
        id: "lifecycle-1",
        type: "process.lifecycle.changed",
        occurredAt: now,
        entityType: "process",
        entityId: "p-direct",
        lifecycle: { tag: "Started" },
      });
      yield* store.append({
        id: "execution-1",
        type: "process.execution.completed",
        occurredAt: now,
        entityType: "process",
        entityId: "p-direct",
        execution: {
          scheduleKey: null,
          startedAt: now,
          completedAt: now,
          durationMs: 0,
          status: "completed",
          isStartupRun: true,
        },
      });

      const lifecycle = yield* store.getProcessLifecycle("p-direct");
      const executions = yield* store.getProcessExecutions("p-direct");
      expect(lifecycle.map((row) => row.lifecycle.tag)).toEqual(["Started"]);
      expect(executions.map((row) => row.id)).toEqual(["execution-1"]);
    }).pipe(Effect.provide(ProcessStore.layer)),
  );
});

describe("Process supervisor — disarmed", () => {
  it.effect("does not run scheduled ticks; runImmediately still runs once", () =>
    Effect.gen(function* () {
      const armed = yield* Ref.make(false);
      const ticks = yield* Ref.make(0);

      const proc = Process.make({
        name: "test/disarmed",
        effect: Ref.update(ticks, (n) => n + 1),
        schedulePollWhileDisarmed: disarmedPoll,
      });

      const runtime = supervisorTestRuntime({ armed });

      yield* Effect.forkChild(proc.effect.pipe(Effect.provide(runtime)));
      yield* TestClock.adjust(Duration.seconds(5));
      expect(yield* Ref.get(ticks)).toBe(0);

      yield* proc.runImmediately().pipe(Effect.provide(runtime));
      expect(yield* Ref.get(ticks)).toBe(1);
    }),
  );

  it.effect("clamps schedulePollWhileDisarmed below internal floor (no tick spam)", () =>
    Effect.gen(function* () {
      const armed = yield* Ref.make(false);
      const ticks = yield* Ref.make(0);

      const proc = Process.make({
        name: "test/disarmed-floor",
        effect: Ref.update(ticks, (n) => n + 1),
        schedulePollWhileDisarmed: Duration.zero,
      });

      const runtime = supervisorTestRuntime({ armed });

      yield* Effect.forkChild(proc.effect.pipe(Effect.provide(runtime)));
      yield* TestClock.adjust(Duration.seconds(1));
      expect(yield* Ref.get(ticks)).toBe(0);
    }),
  );

  it.effect("prefers nextScheduleTransition over a long fallback while disarmed", () =>
    Effect.gen(function* () {
      const armed = yield* Ref.make(false);
      const ticks = yield* Ref.make(0);
      const transition = yield* Ref.make<Option.Option<Date>>(Option.some(new Date(2000)));

      const proc = Process.make({
        name: "test/hint-over-fallback",
        effect: Ref.update(ticks, (n) => n + 1),
        schedulePollWhileDisarmed: Duration.seconds(30),
      });

      const runtime = supervisorTestRuntime({ armed, nextScheduleTransition: transition });

      yield* Effect.forkChild(proc.effect.pipe(Effect.provide(runtime)));
      yield* TestClock.adjust(Duration.seconds(2));
      expect(yield* Ref.get(ticks)).toBe(0);

      yield* TestClock.adjust(Duration.seconds(1));
      yield* Ref.set(armed, true);
      yield* TestClock.adjust(Duration.seconds(2));
      expect(yield* Ref.get(ticks)).toBe(1);
    }),
  );
});

describe("Process supervisor — armed / re-arm", () => {
  it.effect("spaced polling: one tick per spacing interval while continuously armed", () =>
    Effect.gen(function* () {
      const ticks = yield* Ref.make(0);

      const proc = Process.make({
        name: "test/spaced-poll",
        effect: Ref.update(ticks, (n) => n + 1),
      });

      const runtime = Layer.mergeAll(
        ProcessStore.layer,
        Polling.spaced(tickSpacing),
        ProcessSchedule.alwaysArmed,
      );

      yield* Effect.forkChild(proc.effect.pipe(Effect.provide(runtime)));
      yield* TestClock.adjust(tickSpacing);
      expect(yield* Ref.get(ticks)).toBe(1);
      yield* TestClock.adjust(tickSpacing);
      expect(yield* Ref.get(ticks)).toBe(2);
      yield* TestClock.adjust(tickSpacing);
      expect(yield* Ref.get(ticks)).toBe(3);
    }),
  );

  it.effect("after disarm and re-arm, resumes exactly one tick per spacing interval", () =>
    Effect.gen(function* () {
      const ticks = yield* Ref.make(0);
      const armed = yield* Ref.make(true);

      const proc = Process.make({
        name: "test/re-arm",
        effect: Ref.update(ticks, (n) => n + 1),
        schedulePollWhileDisarmed: disarmedPoll,
      });

      const runtime = supervisorTestRuntime({ armed });

      yield* Effect.forkChild(proc.effect.pipe(Effect.provide(runtime)));
      yield* TestClock.adjust(tickSpacing);
      expect(yield* Ref.get(ticks)).toBe(1);

      yield* Ref.set(armed, false);
      yield* TestClock.adjust(Duration.seconds(2));
      const ticksWhileDisarmed = yield* Ref.get(ticks);

      yield* Ref.set(armed, true);
      yield* TestClock.adjust(Duration.seconds(2));
      const afterRearmFirstChunk = yield* Ref.get(ticks);
      expect(afterRearmFirstChunk).toBe(ticksWhileDisarmed + 1);

      yield* TestClock.adjust(tickSpacing);
      expect(yield* Ref.get(ticks)).toBe(afterRearmFirstChunk + 1);
    }),
  );

  it.effect("layers supplied only at fork time behave the same as inlined layers", () =>
    Effect.gen(function* () {
      const ticks = yield* Ref.make(0);
      const proc = Process.make({
        name: "test/external-layers",
        effect: Ref.update(ticks, (n) => n + 1),
      });

      const merged = Layer.mergeAll(
        ProcessStore.layer,
        Polling.spaced(tickSpacing),
        ProcessSchedule.alwaysArmed,
      );

      yield* Effect.forkChild(Effect.provide(proc.effect, merged));
      yield* TestClock.adjust(tickSpacing);
      expect(yield* Ref.get(ticks)).toBe(1);
    }),
  );
});

describe("Process.providePolling / Process.provideSchedule", () => {
  it.effect("providePolling attaches cadence when base config omits polling", () =>
    Effect.gen(function* () {
      const ticks = yield* Ref.make(0);
      const proc = Process.providePolling(
        {
          name: "test/provide-polling",
          effect: Ref.update(ticks, (n) => n + 1),
        },
        Polling.spaced(tickSpacing),
      );

      const runtime = Layer.mergeAll(
        ProcessStore.layer,
        ProcessSchedule.alwaysArmed,
        Polling.spaced(tickSpacing),
      );

      yield* Effect.forkChild(proc.effect.pipe(Effect.provide(runtime)));
      yield* TestClock.adjust(tickSpacing);
      expect(yield* Ref.get(ticks)).toBe(1);
    }),
  );

  it.effect("provideSchedule forwards schedulePollWhileDisarmed and stops ticks when disarmed", () =>
    Effect.gen(function* () {
      const ticks = yield* Ref.make(0);
      const armed = yield* Ref.make(true);
      const proc = Process.provideSchedule(
        {
          name: "test/provide-schedule",
          effect: Ref.update(ticks, (n) => n + 1),
          schedulePollWhileDisarmed: disarmedPoll,
        },
        ProcessSchedule.fromArmedRef({ armed }),
      );

      const runtime = supervisorTestRuntime({ armed });

      yield* Effect.forkChild(proc.effect.pipe(Effect.provide(runtime)));
      yield* TestClock.adjust(tickSpacing);
      expect(yield* Ref.get(ticks)).toBe(1);

      yield* Ref.set(armed, false);
      yield* TestClock.adjust(Duration.seconds(5));
      const n = yield* Ref.get(ticks);
      yield* TestClock.adjust(Duration.seconds(5));
      expect(yield* Ref.get(ticks)).toBe(n);
    }),
  );
});

describe("Process.getStatus", () => {
  it.live("returns execution history and gate snapshot fields", () =>
    Effect.gen(function* () {
      const proc = Process.make({
        name: "test/status-fields",
        effect: Effect.void,
        polling: Polling.spaced(Duration.seconds(5)),
        schedule: ProcessSchedule.alwaysArmed,
      });

      yield* proc.runImmediately();
      const st = yield* proc.getStatus();
      expect(st.executions).toBe(1);
      expect(st.armed).toBe(false);
      expect(Option.isNone(st.nextPollCadence)).toBe(true);
    }).pipe(Effect.provide(ProcessStore.layer)),
  );

  it.effect("mirrors last observed gate and cadence hints from the supervisor", () =>
    Effect.gen(function* () {
      const armed = yield* Ref.make(false);
      const ticks = yield* Ref.make(0);

      const proc = Process.make({
        name: "test/status-mirror",
        effect: Ref.update(ticks, (n) => n + 1),
        schedulePollWhileDisarmed: disarmedPoll,
      });

      const runtime = supervisorTestRuntime({ armed });

      yield* Effect.forkChild(proc.effect.pipe(Effect.provide(runtime)));
      yield* TestClock.adjust(disarmedPoll);

      const whileDisarmed = yield* proc.getStatus().pipe(Effect.provide(ProcessStore.layer));
      expect(whileDisarmed.armed).toBe(false);
      expect(Option.isNone(whileDisarmed.nextPollCadence)).toBe(true);

      yield* Ref.set(armed, true);
      yield* TestClock.adjust(tickSpacing);

      const whileArmed = yield* proc.getStatus().pipe(Effect.provide(ProcessStore.layer));
      expect(whileArmed.armed).toBe(true);
      expect(Option.isSome(whileArmed.nextPollCadence)).toBe(true);
      expect(Duration.equals(Option.getOrThrow(whileArmed.nextPollCadence), tickSpacing)).toBe(
        true,
      );
    }),
  );
});
