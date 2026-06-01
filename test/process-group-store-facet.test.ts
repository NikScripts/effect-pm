import { ProcessStorage } from "../src/ProcessStorage";
/**
 * Conformance suite for {@link ProcessGroupStore}.
 */

import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { ProcessGroupMemberScope, ProcessGroupScope } from "../src/ProcessGroupScope";
import { ProcessGroupStore } from "../src/store/processGroup";
import { ProcessLifecycleStore } from "../src/store/processLifecycle";

const groupStoreLayer = ProcessGroupStore.layer;

const emitMember = (
  groupId: string,
  processId: string,
  emit: Effect.Effect<void>,
): Effect.Effect<void> =>
  ProcessGroupScope.run(
    { groupId },
    ProcessGroupMemberScope.run({ processId }, emit),
  );

const memberStarted = (groupId: string, processId: string) =>
  emitMember(groupId, processId, ProcessGroupStore.Lifecycle.Started);

const memberStopped = (groupId: string, processId: string) =>
  emitMember(groupId, processId, ProcessGroupStore.Lifecycle.Stopped);

const memberRestarted = (groupId: string, processId: string) =>
  emitMember(groupId, processId, ProcessGroupStore.Lifecycle.Restarted);

describe("ProcessGroupStore — static optional emitters", () => {
  it.live("no-ops silently when the facet layer is absent", () =>
    Effect.gen(function* () {
      yield* memberStarted("@test/G", "p1");
      expect(true).toBe(true);
    }),
  );

  it.effect("Lifecycle.Started stamps attributes.groupId", () =>
    Effect.gen(function* () {
      yield* memberStarted("@test/BillingGroup", "p-a");
      yield* memberStarted("@test/OtherGroup", "p-b");

      const group = yield* ProcessGroupStore;
      const billing = yield* group.lifecycleByGroup("@test/BillingGroup");
      expect(billing.map((row) => row.entityId)).toEqual(["p-a"]);
      expect(billing[0]?.attributes?.["groupId"]).toBe("@test/BillingGroup");
    }).pipe(Effect.provide(groupStoreLayer)),
  );

  it.effect("Lifecycle.Stopped and Lifecycle.Restarted round-trip", () =>
    Effect.gen(function* () {
      const groupId = "@test/Ops";
      const processId = "worker";
      yield* memberStarted(groupId, processId);
      yield* memberStopped(groupId, processId);
      yield* memberRestarted(groupId, processId);

      const group = yield* ProcessGroupStore;
      const rows = yield* group.lifecycleByGroup(groupId);
      expect(new Set(rows.map((row) => row.lifecycle.tag))).toEqual(
        new Set(["Started", "Stopped", "Restarted"]),
      );
    }).pipe(Effect.provide(groupStoreLayer)),
  );

  it.effect("binds group-scoped methods with for(identifier)", () =>
    Effect.gen(function* () {
      const billingGroup = { id: "@test/BillingGroup" };
      const billing = yield* ProcessGroupStore.for(billingGroup);

      yield* memberStarted(billingGroup.id, "worker-a");
      yield* memberStopped(billingGroup.id, "worker-a");
      yield* memberStarted("@test/OtherGroup", "worker-b");

      const rows = yield* billing.lifecycle();
      expect(rows.map((row) => row.entityId)).toEqual(["worker-a", "worker-a"]);
      expect(new Set(rows.map((row) => row.lifecycle.tag))).toEqual(
        new Set(["Started", "Stopped"]),
      );
    }).pipe(Effect.provide(groupStoreLayer)),
  );

  it.effect("ProcessStorage.layer provides both lifecycle and group facets", () =>
    Effect.gen(function* () {
      yield* memberStarted("@test/Full", "proc");
      const group = yield* ProcessGroupStore;
      const rows = yield* group.lifecycleByGroup("@test/Full");
      expect(rows).toHaveLength(1);

      const lifecycle = yield* ProcessLifecycleStore;
      const byProcess = yield* lifecycle.lifecycle("proc");
      expect(byProcess).toHaveLength(1);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );

  it.effect(
    "lifecycleByGroup applies opts.limit to the post-filter result",
    () =>
      Effect.gen(function* () {
        // Pre-fix this test failed because storage `limit=2` returned the two
        // most-recent lifecycle rows across *all* groups, which were all
        // "@test/Other", leaving zero rows for the requested group.
        yield* memberStarted(
          "@test/Target",
          "p-1",
        );
        yield* memberStopped(
          "@test/Target",
          "p-1",
        );
        for (let i = 0; i < 4; i++) {
          yield* memberStarted(
            "@test/Other",
            `q-${String(i)}`,
          );
        }
        const group = yield* ProcessGroupStore;
        const limited = yield* group.lifecycleByGroup("@test/Target", {
          limit: 2,
        });
        expect(limited).toHaveLength(2);
        expect(
          limited.every((row) => row.attributes?.["groupId"] === "@test/Target"),
        ).toBe(true);
      }).pipe(Effect.provide(groupStoreLayer)),
  );
});
