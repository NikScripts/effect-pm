/**
 * @module examples/forms/daemon-store/daemon-layer-typed-error-store
 *
 * `Daemon.layer` auto-writes typed `Failed.error` when the tag stamps an `error` schema.
 * Register the tag on an app `Store.Service` via `Daemon.store` and Soft-override with
 * `provideMerge`. Run: `pnpm run example:daemon-layer-typed-error-store`
 *
 * Docs: `docs/examples/daemon-store/daemon-layer-typed-error-store.md` includes this file;
 * cut markers hide the module header and demo harness from the page.
 */

import { runNodeProgramOrExit } from "../../shared/demo-harness";

// ---cut---
import { Duration, Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import * as Daemon from "../../../src/Daemon";
import * as Store from "../../../src/Store";
import * as Polling from "../../../src/Polling";

const FetchErr = Schema.TaggedStruct("FetchError", { status: Schema.Number });

class FailingPrices extends Daemon.Tag<FailingPrices>()("examples/FailingPrices", {
  error: FetchErr,
}) {}

class DemoStore extends Store.Service<DemoStore>("@examples/DemoStore")(
  Daemon.store(FailingPrices),
) {}

const program = Effect.gen(function* () {
  const fail = yield* Schema.decodeUnknownEffect(FetchErr)({
    _tag: "FetchError",
    status: 503,
  });
  yield* Effect.gen(function* () {
    yield* FailingPrices;
    yield* TestClock.adjust(Duration.millis(200));

    const store = yield* DemoStore;
    const events = yield* store.events();
    const failed = events.find((row) => row._tag === "Failed");
    yield* Effect.log(
      `failed row present: ${String(failed !== undefined && failed._tag === "Failed")}`,
    );
  }).pipe(
    Effect.provide(
      Daemon.layer(FailingPrices, {
        effect: Effect.fail(fail),
        polling: Polling.spaced(Duration.millis(50)),
      }).pipe(Layer.provideMerge(DemoStore.layerMemory)),
    ),
    Effect.scoped,
  );
}).pipe(Effect.provide(TestClock.layer()), Effect.scoped, Effect.orDie);
// ---cut-after---

runNodeProgramOrExit(program, "daemon-layer-typed-error-store finished");
