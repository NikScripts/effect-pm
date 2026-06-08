import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { getStateFieldSelectorMetadata, State } from "../src/State";

const QueueScope = State.Scope("@test/QueueScope")({
  id: Schema.String,
  queueId: Schema.String,
});

const WorkerScope = QueueScope.withLeaf("Worker", {
  id: Schema.String,
  workerId: Schema.String,
});

const EntryScope = WorkerScope.withLeaf("Entry", {
  id: Schema.String,
  entryId: Schema.String,
});

describe("State.Scope", () => {
  it.effect("provides nested state through withLeaf scopes", () =>
    Effect.gen(function* () {
      const state = yield* EntryScope.run(
        { id: "entry", entryId: "entry-1" },
        EntryScope,
      ).pipe(
        // WorkerScope is a withLeaf of QueueScope and requires it in context.
        // Layer.provideMerge threads QueueScope through WorkerScope while keeping
        // QueueScope in the final context — equivalent to the chained provides.
        Effect.provide(
          WorkerScope.layer({ id: "worker", workerId: "worker-1" }).pipe(
            Layer.provideMerge(QueueScope.layer({ id: "queue", queueId: "queue-1" })),
          ),
        ),
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

    expect(getStateFieldSelectorMetadata(EntryLeaf.entryId)).toEqual({
      path: ["Worker", "Entry", "entryId"],
    });
    expect(getStateFieldSelectorMetadata(EntryState.id)).toEqual({
      path: ["id"],
    });
    expect(getStateFieldSelectorMetadata(EntryState.Worker.workerId)).toEqual({
      path: ["Worker", "workerId"],
    });
    expect(getStateFieldSelectorMetadata(EntryState.Worker.Entry.entryId)).toEqual({
      path: ["Worker", "Entry", "entryId"],
    });
  });

  it("exposes Leaf and State type helpers", () => {
    const leaf = {
      id: "entry",
      entryId: "entry-1",
    } satisfies State.Type.Leaf<typeof EntryScope>;

    const state = {
      id: "queue",
      queueId: "queue-1",
      Worker: {
        id: "worker",
        workerId: "worker-1",
        Entry: leaf,
      },
    } satisfies State.Type.State<typeof EntryScope>;

    expect(state.Worker.Entry.entryId).toBe("entry-1");
  });
});
