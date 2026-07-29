/**
 * @module examples/forms/daemon-store/daemon-layer-store-auto-write
 *
 * Daemon.layer soft-defaults in-memory Storage (R fulfilled). Provide AppStore into the
 * layer to override Soft capture (journals + Logs). One AppStore — do not also wrap the
 * program in a second `DemoStore.layerMemory` (split journals).
 * Run: `pnpm run example:daemon-layer-store-auto-write`
 *
 * Docs: `docs/examples/daemon-store/daemon-layer-store-auto-write.md` includes this file;
 * cut markers hide the module header and demo harness from the page.
 */

import { runNodeProgramOrExit } from "../../shared/demo-harness";

// ---cut---
import { Duration, Effect, Layer, Option, Schema } from "effect";
import { TestClock } from "effect/testing";
import * as Daemon from "../../../src/Daemon";
import * as Store from "../../../src/Store";
import * as Polling from "../../../src/Polling";

const Price = Schema.Struct({ symbol: Schema.String, usd: Schema.Number });

class PricesDaemon extends Daemon.Tag<PricesDaemon>()("examples/Prices", { success: Price }) {}

class DemoStore extends Store.Service<DemoStore>("@examples/DemoStore")(
  Daemon.store(PricesDaemon),
) {}

const program = Effect.gen(function* () {
  yield* PricesDaemon;
  yield* TestClock.adjust(Duration.millis(200));

  const store = yield* DemoStore;
  const events = yield* store.events();
  const completed = events.find((row) => row._tag === "Completed");
  yield* Effect.log(`built-in store: ${String(events.length)} event(s)`);
  const price =
    completed !== undefined &&
    completed._tag === "Completed" &&
    "success" in completed &&
    completed.success !== undefined
      ? yield* Schema.decodeUnknownEffect(Price)(completed.success).pipe(Effect.option)
      : Option.none();
  yield* Option.match(price, {
    onNone: () => Effect.log("latest result: none"),
    onSome: (p) =>
      Effect.log(`latest result: ${p.symbol} @ ${String(p.usd)}`),
  });
}).pipe(
  Effect.provide(
    Layer.mergeAll(
      Daemon.layer(PricesDaemon, {
        effect: Effect.succeed({ symbol: "BTC", usd: 100_000 }),
        polling: Polling.spaced(Duration.millis(50)),
      }).pipe(Layer.provideMerge(DemoStore.layerMemory)),
      TestClock.layer(),
    ),
  ),
  Effect.scoped,
  Effect.orDie,
);
// ---cut-after---

runNodeProgramOrExit(program, "daemon-layer-store-auto-write finished");
