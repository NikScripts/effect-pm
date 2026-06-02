/**
 * Conformance suite for the {@link ProcessLifecycleStore} facet.
 *
 * Verifies (a) the no-op vs persist semantics of the static optional
 * `Lifecycle.*` emitters, (b) the `lifecycle` /
 * `lifecycleForProcesses` / `latestLifecycleByProcess` projections,
 * (c) the identifier-bound `for(processId)` shape, and (d) the phantom
 * type accessors.
 */

import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Option } from "effect";
import { ProcessStore } from "../src/ProcessStore";
import { ProcessStorage } from "../src/ProcessStorage";
import { ProcessLifecycleScope } from "../src/ProcessLifecycleScope";
import {
  ProcessLifecycleStore,
  type ProcessLifecycleTag,
} from "../src/store/processLifecycle";

const emitLifecycle = (
  processId: string,
  tag: ProcessLifecycleTag,
  error?: unknown,
): Effect.Effect<void> => {
  const emit = (() => {
    switch (tag) {
      case "Started":
        return ProcessLifecycleStore.Lifecycle.Started;
      case "Stopped":
        return ProcessLifecycleStore.Lifecycle.Stopped;
      case "Restarted":
        return ProcessLifecycleStore.Lifecycle.Restarted;
      case "Errored":
        return ProcessLifecycleStore.Lifecycle.Errored(error ?? "errored");
      case "Recovered":
        return ProcessLifecycleStore.Lifecycle.Recovered;
      case "Disabled":
        return ProcessLifecycleStore.Lifecycle.Disabled;
      case "Enabled":
        return ProcessLifecycleStore.Lifecycle.Enabled;
    }
  })();
  return ProcessLifecycleScope.run({ processId }, emit);
};

describe("ProcessLifecycleStore — static optional emitter", () => {
  it.live("no-ops silently when the facet layer is absent", () =>
    Effect.gen(function* () {
      yield* emitLifecycle("test/no-layer", "Started");
      expect(true).toBe(true);
    }),
  );

  it.live("persists through the spine when the facet is provided", () =>
    Effect.gen(function* () {
      const processId = "test/lifecycle/persist";
      yield* emitLifecycle(processId, "Started");
      yield* emitLifecycle(processId, "Stopped");
      const facet = yield* ProcessLifecycleStore;
      const rows = yield* facet.lifecycle(processId);
      expect(rows.map((row) => row.lifecycle.tag).sort()).toEqual([
        "Started",
        "Stopped",
      ]);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );
});

describe("ProcessLifecycleStore — projections", () => {
  const a = "test/lifecycle/a";
  const b = "test/lifecycle/b";

  it.live("lifecycleForProcesses returns rows for the requested ids", () =>
    Effect.gen(function* () {
      yield* emitLifecycle(a, "Started");
      yield* emitLifecycle(b, "Started");
      const facet = yield* ProcessLifecycleStore;
      const rows = yield* facet.lifecycleForProcesses([a, b]);
      const ids = new Set(rows.map((row) => row.entityId));
      expect(ids.has(a)).toBe(true);
      expect(ids.has(b)).toBe(true);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live(
    "latestLifecycleByProcess returns the latest tag per process id",
    () =>
      Effect.gen(function* () {
        yield* emitLifecycle(a, "Started");
        yield* Effect.sleep(Duration.millis(2));
        yield* emitLifecycle(a, "Stopped");
        const facet = yield* ProcessLifecycleStore;
        const latest = yield* facet.latestLifecycleByProcess([a]);
        expect(latest.get(a)).toBe("Stopped");
      }).pipe(Effect.provide(ProcessStorage.layer)),
  );
});

describe("ProcessLifecycleStore — for(processId) bound API", () => {
  const pid = "test/lifecycle/for/scope";

  it.live(
    "lifecycle() / latest() narrow to the bound id",
    () =>
      Effect.gen(function* () {
        const bound = yield* ProcessLifecycleStore.for(pid);

        // Initially empty.
        expect(yield* bound.lifecycle()).toEqual([]);
        expect(Option.isNone(yield* bound.latest())).toBe(true);

        yield* emitLifecycle(pid, "Started");
        yield* Effect.sleep(Duration.millis(2));
        yield* emitLifecycle(pid, "Errored", "boom");

        const rows = yield* bound.lifecycle();
        expect(rows.every((row) => row.entityId === pid)).toBe(true);

        const latest = yield* bound.latest();
        expect(Option.getOrNull(latest)).toBe("Errored");

        // Other processes are excluded.
        const otherPid = "test/lifecycle/for/other";
        yield* emitLifecycle(otherPid, "Started");
        const stillScoped = yield* bound.lifecycle();
        expect(stillScoped.every((row) => row.entityId === pid)).toBe(true);
      }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("for({ id }) accepts an object identifier", () =>
    Effect.gen(function* () {
      const objPid = "test/lifecycle/for/object";
      const bound = yield* ProcessLifecycleStore.for({
        id: objPid,
      });
      yield* emitLifecycle(objPid, "Started");
      const rows = yield* bound.lifecycle();
      expect(rows.every((row) => row.entityId === objPid)).toBe(true);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );
});

describe("ProcessLifecycleStore — type accessors", () => {
  it.live("ProcessStore.Type helpers expose structural shapes", () =>
    Effect.gen(function* () {
      const errored = Object.assign(() => Effect.void, {
        batch: () => Effect.void,
      });
      const fullShape: ProcessStore.Type.Shape<typeof ProcessLifecycleStore> = {
        Lifecycle: {
          Started: Effect.void,
          Stopped: Effect.void,
          Restarted: Effect.void,
          Errored: errored,
          Recovered: Effect.void,
          Disabled: Effect.void,
          Enabled: Effect.void,
        },
        lifecycle: () => Effect.succeed([]),
        lifecycleForProcesses: () => Effect.succeed([]),
        latestLifecycleByProcess: () =>
          Effect.succeed(new Map<string, ProcessLifecycleTag>()),
      };
      const emitShape: ProcessStore.Type.Emit<typeof ProcessLifecycleStore> = {
        Lifecycle: fullShape.Lifecycle,
      };
      const boundShape: ProcessStore.Type.Identifier<typeof ProcessLifecycleStore> = {
        lifecycle: () => Effect.succeed([]),
        latest: () => Effect.succeed(Option.none()),
      };
      expect(typeof fullShape.lifecycle).toBe("function");
      expect(typeof emitShape.Lifecycle.Started).toBe("object");
      expect(typeof boundShape.latest).toBe("function");
    }),
  );
});
