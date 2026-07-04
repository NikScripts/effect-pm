import * as ProcessStorage from "../src/ProcessStorage";
/**
 * Conformance suite for the {@link RunResourceStore} facet.
 *
 * Verifies (a) the no-op vs persist semantics of the static optional
 * emitters built by `ProcessStore.Service`, (b) explicit
 * failure-isolation through `ProcessStore.catchErrorAndLog`, (c) the `runs()`
 * projection pairing, (d) `byRun` filtering, and (e) `latestState`.
 */

import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Logger, Option } from "effect";
import { ProcessStore } from "../src/ProcessStore";
import { RunResourceStore } from "../src/store/runResource";
import type {
  RunResourceFact,
  RunResourceRunCompletedFact,
  RunResourceRunFailedFact,
  RunResourceRunStartedFact,
  RunResourceState,
  RunResourceStateChange,
} from "../src/store/runResource";
import { ProcessStoreReadonlyRecordError } from "../src/ProcessStoreEvent";

const started = (
  resourceId: string,
  runId: string,
  occurredAt: number,
): RunResourceRunStartedFact => ({
  id: `${runId}/run-resource.run.started`,
  resourceId,
  runId,
  type: "run-resource.run.started",
  occurredAt,
  payload: { concurrency: 1 },
});

const completed = (
  resourceId: string,
  runId: string,
  occurredAt: number,
  durationMs: number,
): RunResourceRunCompletedFact => ({
  id: `${runId}/run-resource.run.completed`,
  resourceId,
  runId,
  type: "run-resource.run.completed",
  occurredAt,
  payload: { durationMs },
});

const failed = (
  resourceId: string,
  runId: string,
  occurredAt: number,
  durationMs: number,
  cause: string,
): RunResourceRunFailedFact => ({
  id: `${runId}/run-resource.run.failed`,
  resourceId,
  runId,
  type: "run-resource.run.failed",
  occurredAt,
  payload: { durationMs, cause },
});

const state = (
  resourceId: string,
  observedAt: number,
  overrides: Partial<RunResourceState> = {},
): RunResourceState => ({
  resourceId,
  observedAt,
  configVersion: 1,
  concurrency: 1,
  waiting: 0,
  inFlight: 0,
  completed: 0,
  failed: 0,
  interrupted: 0,
  totalDurationMs: 0,
  ...overrides,
});

describe("RunResourceStore — static optional emitters", () => {
  it.live("no-ops silently when the facet layer is absent", () =>
    Effect.gen(function* () {
      const fact = started(
        "@test/Absent",
        "@test/Absent/run/1",
        1_700_000_000_000,
      );
      yield* RunResourceStore.recordRunStarted(fact);
      // No assertion required: the emit must not throw / fail.
      expect(true).toBe(true);
    }),
  );

  it.live("persists through the spine when the facet is provided", () =>
    Effect.gen(function* () {
      const resourceId = "@test/PresentFacet";
      const runId = `${resourceId}/run/1`;
      yield* RunResourceStore.recordRunStarted(
        started(resourceId, runId, 1_700_000_000_000),
      );
      yield* RunResourceStore.recordRunCompleted(
        completed(resourceId, runId, 1_700_000_000_010, 10),
      );
      const facet = yield* RunResourceStore;
      const facts = yield* facet.facts({ resourceId });
      expect(facts.map((fact: RunResourceFact) => fact.type).sort()).toEqual([
        "run-resource.run.completed",
        "run-resource.run.started",
      ]);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("surfaces write failures unless explicitly caught and logged", () => {
    const captured: string[] = [];
    const captureLogger = Logger.make<unknown, void>(({ message }) => {
      const text =
        typeof message === "string" ? message : JSON.stringify(message);
      captured.push(text);
    });
    const failingFacet: RunResourceStore.Type = {
      recordRunStarted: () =>
        Effect.fail(
          new ProcessStoreReadonlyRecordError({ id: "blocked-fact" }),
        ),
      recordRunCompleted: () =>
        Effect.fail(
          new ProcessStoreReadonlyRecordError({ id: "blocked-fact" }),
        ),
      recordRunFailed: () =>
        Effect.fail(
          new ProcessStoreReadonlyRecordError({ id: "blocked-fact" }),
        ),
      recordStateChange: () =>
        Effect.fail(
          new ProcessStoreReadonlyRecordError({ id: "blocked-state" }),
        ),
      recordFactBatch: () =>
        Effect.fail(
          new ProcessStoreReadonlyRecordError({ id: "blocked-batch" }),
        ),
      recordStateChangeBatch: () =>
        Effect.fail(
          new ProcessStoreReadonlyRecordError({ id: "blocked-batch" }),
        ),
      facts: () => Effect.succeed([]),
      stateHistory: () => Effect.succeed([]),
      latestState: () => Effect.succeed(Option.none()),
      runs: () => Effect.succeed([]),
      byRun: () => Effect.succeed([]),
    };
    const write = RunResourceStore.recordRunStarted(
      started("@test/Failing", "@test/Failing/run/1", 1),
    );
    return Effect.gen(function* () {
      const error = yield* Effect.flip(write);
      expect(error).toBeInstanceOf(ProcessStoreReadonlyRecordError);
      yield* write.pipe(
        ProcessStore.catchErrorAndLog({
          message: "test run-resource write failed",
          annotations: { test: "run-resource-static" },
        }),
      );
      expect(captured.some((m) => m.includes("test run-resource write failed"))).toBe(true);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(RunResourceStore, failingFacet),
          Logger.layer([captureLogger], { mergeWithExisting: false }),
        ),
      ),
    );
  });
});

describe("RunResourceStore — projections", () => {
  const resourceId = "@test/Projections";
  const t = (ms: number) => 1_700_000_000_000 + ms;
  const fixtures = Effect.gen(function* () {
    const facet = yield* RunResourceStore;
    // Run 1: started + completed.
    yield* facet.recordRunStarted(started(resourceId, `${resourceId}/run/1`, t(0)));
    yield* facet.recordRunCompleted(
      completed(resourceId, `${resourceId}/run/1`, t(50), 50),
    );
    // Run 2: started + failed.
    yield* facet.recordRunStarted(started(resourceId, `${resourceId}/run/2`, t(100)));
    yield* facet.recordRunFailed(
      failed(resourceId, `${resourceId}/run/2`, t(160), 60, "boom"),
    );
    // Run 3: started, never ended (in-flight).
    yield* facet.recordRunStarted(started(resourceId, `${resourceId}/run/3`, t(200)));
    // State history.
    const previous = state(resourceId, t(0));
    const current = state(resourceId, t(160), {
      completed: 1,
      failed: 1,
      totalDurationMs: 110,
    });
    yield* facet.recordStateChange({
      id: `${resourceId}/state/1`,
      resourceId,
      changedAt: t(160),
      reason: "run-resource.run.failed",
      previous,
      current,
    } satisfies RunResourceStateChange);
  });

  it.live("runs() pairs started + completed/failed and surfaces in-flight runs", () =>
    Effect.gen(function* () {
      yield* fixtures;
      const facet = yield* RunResourceStore;
      const paired = yield* facet.runs(resourceId);

      expect(paired).toHaveLength(3);
      const byId = new Map(paired.map((run) => [run.runId, run]));
      expect(byId.get(`${resourceId}/run/1`)?.outcome).toBe("completed");
      expect(byId.get(`${resourceId}/run/1`)?.durationMs).toBe(50);
      expect(byId.get(`${resourceId}/run/2`)?.outcome).toBe("failed");
      expect(byId.get(`${resourceId}/run/2`)?.cause).toBe("boom");
      expect(byId.get(`${resourceId}/run/3`)?.outcome).toBe("in-flight");
      expect(byId.get(`${resourceId}/run/3`)?.endedAt).toBe(null);
      // Ordered DESC by startedAt.
      expect(paired.map((run) => run.runId)).toEqual([
        `${resourceId}/run/3`,
        `${resourceId}/run/2`,
        `${resourceId}/run/1`,
      ]);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("byRun returns only facts for the requested run", () =>
    Effect.gen(function* () {
      yield* fixtures;
      const facet = yield* RunResourceStore;
      const onlyRun2 = yield* facet.byRun(`${resourceId}/run/2`);
      expect(onlyRun2.every((fact) => fact.runId === `${resourceId}/run/2`)).toBe(
        true,
      );
      expect(onlyRun2.map((fact) => fact.type).sort()).toEqual([
        "run-resource.run.failed",
        "run-resource.run.started",
      ]);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("latestState returns the most recent recorded state", () =>
    Effect.gen(function* () {
      yield* fixtures;
      const facet = yield* RunResourceStore;
      const latest = yield* facet.latestState(resourceId);
      const value = Option.getOrNull(latest);
      expect(value).not.toBeNull();
      expect(value?.completed).toBe(1);
      expect(value?.failed).toBe(1);
      expect(value?.resourceId).toBe(resourceId);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );
});

describe("RunResourceStore — for(resourceId) bound API", () => {
  const resourceId = "@test/Bound";
  const t = (ms: number) => 1_700_000_000_000 + ms;

  it.live("runs(), facts(), latestState() narrow to the bound scope", () =>
    Effect.gen(function* () {
      const otherId = "@test/BoundOther";
      yield* RunResourceStore.recordRunStarted(
        started(resourceId, `${resourceId}/run/1`, t(0)),
      );
      yield* RunResourceStore.recordRunCompleted(
        completed(resourceId, `${resourceId}/run/1`, t(50), 50),
      );
      yield* RunResourceStore.recordRunStarted(
        started(otherId, `${otherId}/run/1`, t(0)),
      );

      const bound = yield* RunResourceStore.for(resourceId);
      const facts = yield* bound.facts();
      const runs = yield* bound.runs();
      expect(
        facts.every((fact: RunResourceFact) => fact.resourceId === resourceId),
      ).toBe(true);
      expect(runs.every((run) => run.resourceId === resourceId)).toBe(true);

      yield* RunResourceStore.recordStateChange({
        id: `${resourceId}/state/1`,
        resourceId,
        changedAt: t(60),
        reason: "run-resource.run.completed",
        previous: state(resourceId, t(0)),
        current: state(resourceId, t(60), {
          completed: 1,
          totalDurationMs: 50,
        }),
      } satisfies RunResourceStateChange);
      const latest = yield* bound.latestState();
      const value = Option.getOrNull(latest);
      expect(value?.resourceId).toBe(resourceId);
      expect(value?.completed).toBe(1);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("byRun() narrows to the bound scope and the requested runId", () =>
    Effect.gen(function* () {
      const runIdA = `${resourceId}/run/A`;
      yield* RunResourceStore.recordRunStarted(
        started(resourceId, runIdA, t(0)),
      );
      const bound = yield* RunResourceStore.for(resourceId);
      const onlyA = yield* bound.byRun(runIdA);
      expect(
        onlyA.every(
          (fact) =>
            fact.resourceId === resourceId && fact.runId === runIdA,
        ),
      ).toBe(true);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("facts({ types }) filter still works through the bound API", () =>
    Effect.gen(function* () {
      yield* RunResourceStore.recordRunStarted(
        started(resourceId, `${resourceId}/run/types`, t(0)),
      );
      yield* RunResourceStore.recordRunCompleted(
        completed(resourceId, `${resourceId}/run/types`, t(10), 10),
      );
      const bound = yield* RunResourceStore.for(resourceId);
      const startedOnly = yield* bound.facts({
        types: ["run-resource.run.started"],
      });
      expect(
        startedOnly.every(
          (fact) => fact.type === "run-resource.run.started",
        ),
      ).toBe(true);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );
});

describe("RunResourceStore — phantom type accessors", () => {
  it.live(".Type and .EmitType expose the structural shapes", () =>
    Effect.gen(function* () {
      // Type-only smoke check: if these aliases ever drift, the file fails
      // to compile rather than the test failing at runtime.
      const fullShape: RunResourceStore.Type = {
        recordRunStarted: () => Effect.void,
        recordRunCompleted: () => Effect.void,
        recordRunFailed: () => Effect.void,
        recordStateChange: () => Effect.void,
        recordFactBatch: () => Effect.void,
        recordStateChangeBatch: () => Effect.void,
        facts: () => Effect.succeed([]),
        stateHistory: () => Effect.succeed([]),
        latestState: () => Effect.succeed(Option.none()),
        runs: () => Effect.succeed([]),
        byRun: () => Effect.succeed([]),
      };
      const emitShape: RunResourceStore.EmitType = {
        recordRunStarted: fullShape.recordRunStarted,
        recordRunCompleted: fullShape.recordRunCompleted,
        recordRunFailed: fullShape.recordRunFailed,
        recordStateChange: fullShape.recordStateChange,
        recordFactBatch: fullShape.recordFactBatch,
        recordStateChangeBatch: fullShape.recordStateChangeBatch,
      };
      const boundShape: RunResourceStore.IdentifierType = {
        facts: () => Effect.succeed([]),
        stateHistory: () => Effect.succeed([]),
        latestState: () => Effect.succeed(Option.none()),
        runs: () => Effect.succeed([]),
        byRun: () => Effect.succeed([]),
      };
      expect(typeof fullShape.recordRunStarted).toBe("function");
      expect(typeof emitShape.recordStateChange).toBe("function");
      expect(typeof boundShape.runs).toBe("function");
    }),
  );
});
