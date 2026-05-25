import { ProcessStorage } from "../src/ProcessStorage";
/**
 * Conformance suite for the {@link ProcessStoreRunResource} facet.
 *
 * Verifies (a) the no-op vs persist semantics of the static optional
 * emitters built by `ProcessStore.Service`, (b) the built-in
 * failure-isolation `catchCause + logWarning` wrap, (c) the `runs()`
 * projection pairing, (d) `byRun` filtering, and (e) `latestState`.
 */

import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Logger, Option } from "effect";
import { ProcessStoreRunResource } from "../src/store/runResource";
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

describe("ProcessStoreRunResource — static optional emitters", () => {
  it.live("no-ops silently when the facet layer is absent", () =>
    Effect.gen(function* () {
      const fact = started(
        "@test/Absent",
        "@test/Absent/run/1",
        1_700_000_000_000,
      );
      yield* ProcessStoreRunResource.recordRunStarted(fact);
      // No assertion required: the emit must not throw / fail.
      expect(true).toBe(true);
    }),
  );

  it.live("persists through the spine when the facet is provided", () =>
    Effect.gen(function* () {
      const resourceId = "@test/PresentFacet";
      const runId = `${resourceId}/run/1`;
      yield* ProcessStoreRunResource.recordRunStarted(
        started(resourceId, runId, 1_700_000_000_000),
      );
      yield* ProcessStoreRunResource.recordRunCompleted(
        completed(resourceId, runId, 1_700_000_000_010, 10),
      );
      const facet = yield* ProcessStoreRunResource;
      const facts = yield* facet.facts({ resourceId });
      expect(facts.map((fact: RunResourceFact) => fact.type).sort()).toEqual([
        "run-resource.run.completed",
        "run-resource.run.started",
      ]);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("isolates write failures behind a warning log", () => {
    const captured: string[] = [];
    const captureLogger = Logger.make<unknown, void>(({ message }) => {
      const text =
        typeof message === "string" ? message : JSON.stringify(message);
      captured.push(text);
    });
    const failingFacet: ProcessStoreRunResource.Type = {
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
    return ProcessStoreRunResource.recordRunStarted(
      started("@test/Failing", "@test/Failing/run/1", 1),
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(ProcessStoreRunResource, failingFacet),
          Logger.layer([captureLogger], { mergeWithExisting: false }),
        ),
      ),
      Effect.tap(() =>
        Effect.sync(() => {
          expect(
            captured.some((m) =>
              m.includes("write failed for recordRunStarted"),
            ),
          ).toBe(true);
        }),
      ),
    );
  });
});

describe("ProcessStoreRunResource — projections", () => {
  const resourceId = "@test/Projections";
  const t = (ms: number) => 1_700_000_000_000 + ms;
  const fixtures = Effect.gen(function* () {
    const facet = yield* ProcessStoreRunResource;
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
      const facet = yield* ProcessStoreRunResource;
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
      const facet = yield* ProcessStoreRunResource;
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
      const facet = yield* ProcessStoreRunResource;
      const latest = yield* facet.latestState(resourceId);
      const value = Option.getOrNull(latest);
      expect(value).not.toBeNull();
      expect(value?.completed).toBe(1);
      expect(value?.failed).toBe(1);
      expect(value?.resourceId).toBe(resourceId);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );
});

describe("ProcessStoreRunResource — phantom type accessors", () => {
  it.live(".Type and .EmitType expose the structural shapes", () =>
    Effect.gen(function* () {
      // Type-only smoke check: if these aliases ever drift, the file fails
      // to compile rather than the test failing at runtime.
      const fullShape: ProcessStoreRunResource.Type = {
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
      const emitShape: ProcessStoreRunResource.EmitType = {
        recordRunStarted: fullShape.recordRunStarted,
        recordRunCompleted: fullShape.recordRunCompleted,
        recordRunFailed: fullShape.recordRunFailed,
        recordStateChange: fullShape.recordStateChange,
        recordFactBatch: fullShape.recordFactBatch,
        recordStateChangeBatch: fullShape.recordStateChangeBatch,
      };
      expect(typeof fullShape.recordRunStarted).toBe("function");
      expect(typeof emitShape.recordStateChange).toBe("function");
    }),
  );
});
