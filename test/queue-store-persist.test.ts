import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Schema } from "effect";
import * as QueueResource from "../src/QueueResource";
import { StoreScopeBridgeTag } from "../src/internal/store/bridge";
import { builtInQueueStoreContract } from "../src/internal/store/queueStoreSpec";

// The observability store is baked into QueueResource.layer (layerDefaultMemory, exposed). The engine
// persists its lifecycle events there via a plain declared dependency (no serviceOption), and they
// read back through the exposed StoreScopeBridgeTag — no separate app Store.Service, and (the point)
// no deadlock, because a declared dependency is built in order and memoized. `it.live` = real clock.

const jobSchema = Schema.Struct({ id: Schema.String });

class EmailQueue extends QueueResource.Tag<EmailQueue>()("@app/EmailQueue", jobSchema) {}

describe("QueueResource → baked store persistence", () => {
  it.live("persists lifecycle events to the baked-in store, readable back", () =>
    Effect.gen(function* () {
      const queue = yield* EmailQueue;
      yield* queue.add([{ id: "j1" }, { id: "j2" }]);

      // Read via the SAME bridge the layer baked in + exposed.
      const bridge = yield* StoreScopeBridgeTag;
      const store = yield* bridge.at(
        "@app/EmailQueue",
        builtInQueueStoreContract(EmailQueue),
      );

      // processing + persistence are both async — poll until both completions land.
      yield* Effect.gen(function* () {
        while (
          (yield* store.events()).filter((e) => e._tag === "Completed").length < 2
        ) {
          yield* Effect.sleep(Duration.millis(20));
        }
      }).pipe(Effect.timeout(Duration.seconds(3)));

      const tags = (yield* store.events()).map((e) => e._tag);
      expect(tags).toContain("Enqueued");
      expect(tags).toContain("Started");
      expect(tags).toContain("Completed");
    }).pipe(
      // Only the queue layer — it bakes + exposes the store. No app Store.Service.
      Effect.provide(
        QueueResource.layer(EmailQueue, {
          effect: () => Effect.void,
          autoStart: true,
        }),
      ),
      Effect.scoped,
    ),
  );
});
