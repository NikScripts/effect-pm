import { ProcessStorage } from "../src/ProcessStorage";
/**
 * Conformance suite for {@link ProcessStoreProcessGroup}.
 */

import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { RuntimeStorage } from "../src/RuntimeStorage";
import { ProcessStoreProcessGroup } from "../src/store/processGroup";
import { ProcessStoreProcessLifecycle } from "../src/store/processLifecycle";

const groupStoreLayer = Layer.provide(
  Layer.provide(
    ProcessStoreProcessGroup.layerRuntimeStorage,
    ProcessStoreProcessLifecycle.layerRuntimeStorage,
  ),
  RuntimeStorage.layer,
);

describe("ProcessStoreProcessGroup — static optional emitters", () => {
  it.live("no-ops silently when the facet layer is absent", () =>
    Effect.gen(function* () {
      yield* ProcessStoreProcessGroup.recordMemberStarted("@test/G", "p1");
      expect(true).toBe(true);
    }),
  );

  it.effect("recordMemberStarted stamps attributes.groupId", () =>
    Effect.gen(function* () {
      yield* ProcessStoreProcessGroup.recordMemberStarted("@test/BillingGroup", "p-a");
      yield* ProcessStoreProcessGroup.recordMemberStarted("@test/OtherGroup", "p-b");

      const group = yield* ProcessStoreProcessGroup;
      const billing = yield* group.lifecycleByGroup("@test/BillingGroup");
      expect(billing.map((row) => row.entityId)).toEqual(["p-a"]);
      expect(billing[0]?.attributes?.["groupId"]).toBe("@test/BillingGroup");
    }).pipe(Effect.provide(groupStoreLayer)),
  );

  it.effect("recordMemberStopped and recordMemberRestarted round-trip", () =>
    Effect.gen(function* () {
      const groupId = "@test/Ops";
      const processId = "worker";
      yield* ProcessStoreProcessGroup.recordMemberStarted(groupId, processId);
      yield* ProcessStoreProcessGroup.recordMemberStopped(groupId, processId);
      yield* ProcessStoreProcessGroup.recordMemberRestarted(groupId, processId);

      const group = yield* ProcessStoreProcessGroup;
      const rows = yield* group.lifecycleByGroup(groupId);
      expect(new Set(rows.map((row) => row.lifecycle.tag))).toEqual(
        new Set(["Started", "Stopped", "Restarted"]),
      );
    }).pipe(Effect.provide(groupStoreLayer)),
  );

  it.effect("binds group-scoped methods with for(identifier)", () =>
    Effect.gen(function* () {
      const billingGroup = { id: "@test/BillingGroup" };
      const billing = yield* ProcessStoreProcessGroup.for(billingGroup);

      yield* billing.recordMemberStarted("worker-a");
      yield* billing.recordMemberStopped("worker-a");
      yield* ProcessStoreProcessGroup.recordMemberStarted("@test/OtherGroup", "worker-b");

      const rows = yield* billing.lifecycle();
      expect(rows.map((row) => row.entityId)).toEqual(["worker-a", "worker-a"]);
      expect(new Set(rows.map((row) => row.lifecycle.tag))).toEqual(
        new Set(["Started", "Stopped"]),
      );
    }).pipe(Effect.provide(groupStoreLayer)),
  );

  it.effect("ProcessStorage.layer provides both lifecycle and group facets", () =>
    Effect.gen(function* () {
      yield* ProcessStoreProcessGroup.recordMemberStarted("@test/Full", "proc");
      const group = yield* ProcessStoreProcessGroup;
      const rows = yield* group.lifecycleByGroup("@test/Full");
      expect(rows).toHaveLength(1);

      const lifecycle = yield* ProcessStoreProcessLifecycle;
      const byProcess = yield* lifecycle.lifecycle("proc");
      expect(byProcess).toHaveLength(1);
    }).pipe(Effect.provide(ProcessStorage.layer)),
  );
});
