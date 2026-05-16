/**
 * @module examples/forms/process-store/process-store-memory
 *
 * ProcessStore in-memory storage + generic events query.
 * Run: `npx tsx examples/forms/process-store/process-store-memory.ts`
 */

import { Clock, Effect } from "effect";
import {
  ProcessStore,
  type AnalyticsEvent,
} from "../../../src/ProcessStore";
import { provideLayer } from "../../../src/provideLayer";

const processLifecycleTypes: ReadonlyArray<AnalyticsEvent["type"]> = [
  "process.lifecycle.changed",
];

const program = Effect.gen(function* () {
  const store = yield* ProcessStore;
  const occurredAt = yield* Clock.currentTimeMillis;

  yield* store.append({
    id: "memory-process-started",
    type: "process.lifecycle.changed",
    occurredAt,
    entityType: "process",
    entityId: "examples/MemoryProcess",
    lifecycle: { tag: "Started" },
  });

  const events = yield* store.events({
    entityType: "process",
    entityId: "examples/MemoryProcess",
    types: processLifecycleTypes,
  });

  yield* Effect.log(
    `memory events: ${events.map((event) => event.id).join(", ")}`,
  );
}).pipe(provideLayer(ProcessStore.layer));

void Effect.runPromise(program);
