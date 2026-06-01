import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { State } from "../src/State";

class QueueScope extends State.Scope<QueueScope>()({
  id: Schema.String,
  queueId: Schema.String,
})("@test/QueueScope") {}

class WorkerScope extends QueueScope.withLeaf<WorkerScope>()("Worker", {
  id: Schema.String,
  workerId: Schema.String,
})("@test/WorkerScope") {}

class EntryScope extends WorkerScope.withLeaf<EntryScope>()("Entry", {
  id: Schema.String,
  entryId: Schema.String,
})("@test/EntryScope") {}

describe("State.Scope", () => {
  it.effect("provides nested state through withLeaf scopes", () =>
    Effect.gen(function* () {
      const state = yield* EntryScope.run(
        { id: "entry", entryId: "entry-1" },
        EntryScope,
      ).pipe(
        Effect.provide(WorkerScope.layer({ id: "worker", workerId: "worker-1" })),
        Effect.provide(QueueScope.layer({ id: "queue", queueId: "queue-1" })),
      );

      expect(state).toEqual({
        id: "queue",
        queueId: "queue-1",
        Worker: {
          id: "worker",
          workerId: "worker-1",
          Entry: {
            id: "entry",
            entryId: "entry-1",
          },
        },
      });
    }),
  );

  it("exposes Leaf and nested State schema selectors", () => {
    const EntryLeaf = EntryScope.Schema.Leaf;
    const EntryState = EntryScope.Schema.State;

    expect(EntryLeaf.entryId).toBe(Schema.String);
    expect(EntryState.id).toBe(Schema.String);
    expect(EntryState.Worker.workerId).toBe(Schema.String);
    expect(EntryState.Worker.Entry.entryId).toBe(Schema.String);
  });

  it("exposes Leaf and State type helpers", () => {
    const leaf = {
      id: "entry",
      entryId: "entry-1",
    } satisfies State.Scope.Leaf<typeof EntryScope>;

    const state = {
      id: "queue",
      queueId: "queue-1",
      Worker: {
        id: "worker",
        workerId: "worker-1",
        Entry: leaf,
      },
    } satisfies State.Scope.State<typeof EntryScope>;

    expect(state.Worker.Entry.entryId).toBe("entry-1");
  });
});
