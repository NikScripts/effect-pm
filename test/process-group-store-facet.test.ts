import { ProcessStorage } from "../src/ProcessStorage";
/**
 * Conformance suite for {@link ProcessGroupStore}.
 */

import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { RuntimeStorage } from "../src/RuntimeStorage";
import { ProcessGroupStore } from "../src/store/processGroup";
import { ProcessLifecycleStore } from "../src/store/processLifecycle";

const groupStoreLayer = Layer.provide(
  Layer.provide(
    ProcessGroupStore.layerRuntimeStorage,
    ProcessLifecycleStore.layerRuntimeStorage,
  ),
  RuntimeStorage.layer,
);

describe("ProcessGroupStore — static optional emitters", () => {
  it.live("no-ops silently when the facet layer is absent", () =>
    Effect.gen(function* () {
      yield* ProcessGroupStore.recordMemberStarted("@test/G", "p1");
      expect(true).toBe(true);
    }),
  );

  it.effect("recordMemberStarted stamps attributes.groupId", () =>
    Effect.gen(function* () {
      yield* ProcessGroupStore.recordMemberStarted("@test/BillingGroup", "p-a");
      yield* ProcessGroupStore.recordMemberStarted("@test/OtherGroup", "p-b");

      const group = yield* ProcessGroupStore;
      const billing = yield* group.lifecycleByGroup("@test/BillingGroup");
      expect(billing.map((row) => row.entityId)).toEqual(["p-a"]);
      expect(billing[0]?.attributes?.["groupId"]).toBe("@test/BillingGroup");
    }).pipe(Effect.provide(groupStoreLayer)),
  );

  it.effect("recordMemberStopped and recordMemberRestarted round-trip", () =>
    Effect.gen(function* () {
      const groupId = "@test/Ops";
      const processId = "worker";
      yield* ProcessGroupStore.recordMemberStarted(groupId, processId);
      yield* ProcessGroupStore.recordMemberStopped(groupId, processId);
      yield* ProcessGroupStore.recordMemberRestarted(groupId, processId);

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

      yield* billing.recordMemberStarted("worker-a");
      yield* billing.recordMemberStopped("worker-a");
      yield* ProcessGroupStore.recordMemberStarted("@test/OtherGroup", "worker-b");

      const rows = yield* billing.lifecycle();
      expect(rows.map((row) => row.entityId)).toEqual(["worker-a", "worker-a"]);
      expect(new Set(rows.map((row) => row.lifecycle.tag))).toEqual(
        new Set(["Started", "Stopped"]),
      );
    }).pipe(Effect.provide(groupStoreLayer)),
  );

  it.effect("ProcessStorage.layer provides both lifecycle and group facets", () =>
    Effect.gen(function* () {
      yield* ProcessGroupStore.recordMemberStarted("@test/Full", "proc");
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
        yield* ProcessGroupStore.recordMemberStarted(
          "@test/Target",
          "p-1",
        );
        yield* ProcessGroupStore.recordMemberStopped(
          "@test/Target",
          "p-1",
        );
        for (let i = 0; i < 4; i++) {
          yield* ProcessGroupStore.recordMemberStarted(
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
