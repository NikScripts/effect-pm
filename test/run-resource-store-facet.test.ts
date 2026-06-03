import { ProcessStorage } from "../src/ProcessStorage";
/**
 * Conformance suite for the {@link RunResourceStore} facet.
 *
 * Verifies (a) the no-op vs persist semantics of the static optional
 * telemetry emitters, (b) the `runs()` projection pairing, (c) `byRun`
 * filtering, and (d) `latestState`.
 */

import { describe, expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { ProcessStore } from "../src/ProcessStore";
import { RunResourceScope, RunScope } from "../src/RunResourceScope";
import { RunResourceStore } from "../src/store/runResource";
import type {
  RunResourceFact,
  RunResourceRunCompletedFact,
  RunResourceRunFailedFact,
  RunResourceRunStartedFact,
  RunResourceState,
  RunResourceStateChange,
} from "../src/store/runResource";

const started = (
  resourceId: string,
  runId: string,
  occurredAt: number,
): RunResourceRunStartedFact => ({
  id: `${runId}/RunResource.Run.Started`,
  resourceId,
  runId,
  type: "RunResource.Run.Started",
  occurredAt,
  payload: { concurrency: 1 },
});

const completed = (
  resourceId: string,
  runId: string,
  occurredAt: number,
  durationMs: number,
): RunResourceRunCompletedFact => ({
  id: `${runId}/RunResource.Run.Completed`,
  resourceId,
  runId,
  type: "RunResource.Run.Completed",
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
  id: `${runId}/RunResource.Run.Failed`,
  resourceId,
  runId,
  type: "RunResource.Run.Failed",
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

const emitStartedFact = (fact: RunResourceRunStartedFact): Effect.Effect<void> =>
  RunResourceScope.run(
    { resourceId: fact.resourceId },
    RunScope.run({ runId: fact.runId }, RunResourceStore.Run.Started({
      payload: fact.payload,
    })),
  );

const emitCompletedFact = (fact: RunResourceRunCompletedFact): Effect.Effect<void> =>
  RunResourceScope.run(
    { resourceId: fact.resourceId },
    RunScope.run({ runId: fact.runId }, RunResourceStore.Run.Completed({
      payload: fact.payload,
    })),
  );

const emitFailedFact = (fact: RunResourceRunFailedFact): Effect.Effect<void> =>
  RunResourceScope.run(
    { resourceId: fact.resourceId },
    RunScope.run({ runId: fact.runId }, RunResourceStore.Run.Failed({
      payload: fact.payload,
    })),
  );

const emitStateChange = (change: RunResourceStateChange): Effect.Effect<void> =>
  RunResourceScope.run(
    { resourceId: change.resourceId },
    RunResourceStore.State.Changed({
      id: change.id,
      reason: change.reason,
      previous: change.previous,
      current: change.current,
    }),
  );

describe("RunResourceStore — static optional emitters", () => {
  it.live("no-ops silently when the facet layer is absent", () =>
    Effect.gen(function* () {
      const fact = started(
        "@test/Absent",
        "@test/Absent/run/1",
        1_700_000_000_000,
      );
      yield* emitStartedFact(fact);
      // No assertion required: the emit must not throw / fail.
      expect(true).toBe(true);
    }),
  );

  it.live("persists through the spine when the facet is provided", () =>
    Effect.gen(function* () {
      const resourceId = "@test/PresentFacet";
      const runId = `${resourceId}/run/1`;
      yield* emitStartedFact(
        started(resourceId, runId, 1_700_000_000_000),
      );
      yield* emitCompletedFact(
        completed(resourceId, runId, 1_700_000_000_010, 10),
      );
      const facet = yield* RunResourceStore;
      const facts = yield* facet.facts({ resourceId });
      expect(facts.map((fact: RunResourceFact) => fact.type).sort()).toEqual([
        "RunResource.Run.Completed",
        "RunResource.Run.Started",
      ]);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );
});

describe("RunResourceStore — projections", () => {
  const resourceId = "@test/Projections";
  const t = (ms: number) => 1_700_000_000_000 + ms;
  const fixtures = Effect.gen(function* () {
    // Run 1: started + completed.
    yield* emitStartedFact(started(resourceId, `${resourceId}/run/1`, t(0)));
    yield* emitCompletedFact(
      completed(resourceId, `${resourceId}/run/1`, t(50), 50),
    );
    // Run 2: started + failed.
    yield* emitStartedFact(started(resourceId, `${resourceId}/run/2`, t(100)));
    yield* emitFailedFact(
      failed(resourceId, `${resourceId}/run/2`, t(160), 60, "boom"),
    );
    // Run 3: started, never ended (in-flight).
    yield* emitStartedFact(started(resourceId, `${resourceId}/run/3`, t(200)));
    // State history.
    const previous = state(resourceId, t(0));
    const current = state(resourceId, t(160), {
      completed: 1,
      failed: 1,
      totalDurationMs: 110,
    });
    yield* emitStateChange({
      id: `${resourceId}/state/1`,
      resourceId,
      changedAt: t(160),
      reason: "RunResource.State.Failed",
      previous,
      current,
    } satisfies RunResourceStateChange);
  });

  it.live("runs() pairs started + completed/failed and surfaces in-flight runs", () =>
    Effect.gen(function* () {
      yield* fixtures;
      const facet = yield* RunResourceStore;
      const paired = yield* facet.runs({ resourceId });

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
      const onlyRun2 = yield* facet.byRun({ runId: `${resourceId}/run/2` });
      expect(onlyRun2.every((fact) => fact.runId === `${resourceId}/run/2`)).toBe(
        true,
      );
      expect(onlyRun2.map((fact) => fact.type).sort()).toEqual([
        "RunResource.Run.Failed",
        "RunResource.Run.Started",
      ]);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("latestState returns the most recent recorded state", () =>
    Effect.gen(function* () {
      yield* fixtures;
      const facet = yield* RunResourceStore;
      const latest = yield* facet.latestState({ resourceId });
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
      yield* emitStartedFact(
        started(resourceId, `${resourceId}/run/1`, t(0)),
      );
      yield* emitCompletedFact(
        completed(resourceId, `${resourceId}/run/1`, t(50), 50),
      );
      yield* emitStartedFact(
        started(otherId, `${otherId}/run/1`, t(0)),
      );

      const bound = yield* RunResourceStore.for(resourceId);
      const facts = yield* bound.facts({});
      const runs = yield* bound.runs({});
      expect(
        facts.every((fact: RunResourceFact) => fact.resourceId === resourceId),
      ).toBe(true);
      expect(runs.every((run) => run.resourceId === resourceId)).toBe(true);

      yield* emitStateChange({
        id: `${resourceId}/state/1`,
        resourceId,
        changedAt: t(60),
        reason: "RunResource.State.Completed",
        previous: state(resourceId, t(0)),
        current: state(resourceId, t(60), {
          completed: 1,
          totalDurationMs: 50,
        }),
      } satisfies RunResourceStateChange);
      const latest = yield* bound.latestState({});
      const value = Option.getOrNull(latest);
      expect(value?.resourceId).toBe(resourceId);
      expect(value?.completed).toBe(1);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("byRun() narrows to the bound scope and the requested runId", () =>
    Effect.gen(function* () {
      const runIdA = `${resourceId}/run/A`;
      yield* emitStartedFact(
        started(resourceId, runIdA, t(0)),
      );
      const bound = yield* RunResourceStore.for(resourceId);
      const onlyA = yield* bound.byRun({ runId: runIdA });
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
      yield* emitStartedFact(
        started(resourceId, `${resourceId}/run/types`, t(0)),
      );
      yield* emitCompletedFact(
        completed(resourceId, `${resourceId}/run/types`, t(10), 10),
      );
      const bound = yield* RunResourceStore.for(resourceId);
      const startedOnly = yield* bound.facts({
        types: ["RunResource.Run.Started"],
      });
      expect(
        startedOnly.every(
          (fact) => fact.type === "RunResource.Run.Started",
        ),
      ).toBe(true);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );
});

describe("RunResourceStore — type accessors", () => {
  it.live("ProcessStore.Type helpers expose the structural shapes", () =>
    Effect.gen(function* () {
      // Type-only smoke check: if these aliases ever drift, the file fails
      // to compile rather than the test failing at runtime.
      const started = Object.assign(() => Effect.void, {
        batch: () => Effect.void,
      });
      const completed = Object.assign(() => Effect.void, {
        batch: () => Effect.void,
      });
      const failed = Object.assign(() => Effect.void, {
        batch: () => Effect.void,
      });
      const changed = Object.assign(() => Effect.void, {
        batch: () => Effect.void,
      });
      const fullShape: ProcessStore.Type.Shape<typeof RunResourceStore> = {
        Run: {
          Started: started,
          Completed: completed,
          Failed: failed,
        },
        State: {
          Changed: changed,
        },
        facts: () => Effect.succeed([]),
        stateHistory: () => Effect.succeed([]),
        latestState: () => Effect.succeed(Option.none()),
        runs: () => Effect.succeed([]),
        byRun: () => Effect.succeed([]),
      };
      const emitShape: ProcessStore.Type.Emit<typeof RunResourceStore> = {
        Run: fullShape.Run,
        State: fullShape.State,
      };
      const boundShape: ProcessStore.Type.Identifier<typeof RunResourceStore> = {
        facts: () => Effect.succeed([]),
        stateHistory: () => Effect.succeed([]),
        latestState: () => Effect.succeed(Option.none()),
        runs: () => Effect.succeed([]),
        byRun: () => Effect.succeed([]),
      };
      expect(typeof fullShape.Run.Started).toBe("function");
      expect(typeof emitShape.State.Changed).toBe("function");
      expect(typeof boundShape.runs).toBe("function");
    }),
  );
});
