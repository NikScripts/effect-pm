/**
 * Conformance suite for the {@link ProcessStoreProcessLifecycle} facet.
 *
 * Verifies (a) the no-op vs persist semantics of the static optional
 * `lifecycleChanged` emitter, (b) the `lifecycle` /
 * `lifecycleForProcesses` / `latestLifecycleByProcess` projections,
 * (c) the identifier-bound `for(processId)` shape, and (d) the phantom
 * type accessors.
 */

import { describe, expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { ProcessStorage } from "../src/ProcessStorage";
import {
  ProcessStoreProcessLifecycle,
  type ProcessLifecycleRecordInput,
  type ProcessLifecycleTag,
} from "../src/store/processLifecycle";

const lifecycle = (
  processId: string,
  tag: ProcessLifecycleTag,
  occurredAt: number,
  overrides: Partial<ProcessLifecycleRecordInput> = {},
): ProcessLifecycleRecordInput => ({
  processId,
  tag,
  occurredAt,
  ...overrides,
});

describe("ProcessStoreProcessLifecycle — static optional emitter", () => {
  it.live("no-ops silently when the facet layer is absent", () =>
    Effect.gen(function* () {
      yield* ProcessStoreProcessLifecycle.lifecycleChanged(
        lifecycle("test/no-layer", "Started", 1_700_000_000_000),
      );
      expect(true).toBe(true);
    }),
  );

  it.live("persists through the spine when the facet is provided", () =>
    Effect.gen(function* () {
      const processId = "test/lifecycle/persist";
      yield* ProcessStoreProcessLifecycle.lifecycleChanged(
        lifecycle(processId, "Started", 1_700_000_000_000),
      );
      yield* ProcessStoreProcessLifecycle.lifecycleChanged(
        lifecycle(processId, "Stopped", 1_700_000_000_010),
      );
      const facet = yield* ProcessStoreProcessLifecycle;
      const rows = yield* facet.lifecycle(processId);
      expect(rows.map((row) => row.lifecycle.tag).sort()).toEqual([
        "Started",
        "Stopped",
      ]);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );
});

describe("ProcessStoreProcessLifecycle — projections", () => {
  const a = "test/lifecycle/a";
  const b = "test/lifecycle/b";

  it.live("lifecycleForProcesses returns rows for the requested ids", () =>
    Effect.gen(function* () {
      yield* ProcessStoreProcessLifecycle.lifecycleChanged(
        lifecycle(a, "Started", 1_700_000_000_000),
      );
      yield* ProcessStoreProcessLifecycle.lifecycleChanged(
        lifecycle(b, "Started", 1_700_000_000_010),
      );
      const facet = yield* ProcessStoreProcessLifecycle;
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
        yield* ProcessStoreProcessLifecycle.lifecycleChanged(
          lifecycle(a, "Started", 1_700_000_000_100),
        );
        yield* ProcessStoreProcessLifecycle.lifecycleChanged(
          lifecycle(a, "Stopped", 1_700_000_000_200),
        );
        const facet = yield* ProcessStoreProcessLifecycle;
        const latest = yield* facet.latestLifecycleByProcess([a]);
        expect(latest.get(a)).toBe("Stopped");
      }).pipe(Effect.provide(ProcessStorage.layer)),
  );
});

describe("ProcessStoreProcessLifecycle — for(processId) bound API", () => {
  const pid = "test/lifecycle/for/scope";

  it.live(
    "lifecycle() / latest() / recordTransition() narrow to the bound id",
    () =>
      Effect.gen(function* () {
        const bound = yield* ProcessStoreProcessLifecycle.for(pid);

        // Initially empty.
        expect(yield* bound.lifecycle()).toEqual([]);
        expect(Option.isNone(yield* bound.latest())).toBe(true);

        // recordTransition() infers processId from the binding.
        yield* bound.recordTransition({
          tag: "Started",
          occurredAt: 1_700_000_000_000,
        });
        yield* bound.recordTransition({
          tag: "Errored",
          error: "boom",
          occurredAt: 1_700_000_000_010,
        });

        const rows = yield* bound.lifecycle();
        expect(rows.every((row) => row.entityId === pid)).toBe(true);

        const latest = yield* bound.latest();
        expect(Option.getOrNull(latest)).toBe("Errored");

        // Other processes are excluded.
        const otherPid = "test/lifecycle/for/other";
        yield* ProcessStoreProcessLifecycle.lifecycleChanged(
          lifecycle(otherPid, "Started", 1_700_000_000_020),
        );
        const stillScoped = yield* bound.lifecycle();
        expect(stillScoped.every((row) => row.entityId === pid)).toBe(true);
      }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.live("withIdentifier({ id }) accepts an object identifier", () =>
    Effect.gen(function* () {
      const objPid = "test/lifecycle/for/object";
      const bound = yield* ProcessStoreProcessLifecycle.withIdentifier({
        id: objPid,
      });
      yield* bound.recordTransition({ tag: "Started" });
      const rows = yield* bound.lifecycle();
      expect(rows.every((row) => row.entityId === objPid)).toBe(true);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );
});

describe("ProcessStoreProcessLifecycle — phantom type accessors", () => {
  it.live(".Type / .EmitType / .IdentifierType expose structural shapes", () =>
    Effect.gen(function* () {
      const fullShape: ProcessStoreProcessLifecycle.Type = {
        lifecycleChanged: () => Effect.void,
        lifecycle: () => Effect.succeed([]),
        lifecycleForProcesses: () => Effect.succeed([]),
        latestLifecycleByProcess: () =>
          Effect.succeed(new Map<string, ProcessLifecycleTag>()),
      };
      const emitShape: ProcessStoreProcessLifecycle.EmitType = {
        lifecycleChanged: fullShape.lifecycleChanged,
      };
      const boundShape: ProcessStoreProcessLifecycle.IdentifierType = {
        lifecycle: () => Effect.succeed([]),
        latest: () => Effect.succeed(Option.none()),
        recordTransition: () => Effect.void,
      };
      expect(typeof fullShape.lifecycle).toBe("function");
      expect(typeof emitShape.lifecycleChanged).toBe("function");
      expect(typeof boundShape.recordTransition).toBe("function");
    }),
  );
});
