/**
 * @module examples/daemon/result-ref
 *
 * A daemon tag with a `success` schema gets a reactive `result` ref. Manual
 * `run` writes the latest successful value to `result.get` and `result.changes`.
 *
 * Run: `pnpm run example:daemon-result-ref`
 *
 * Docs: `docs/examples/daemon/result-ref.md` includes this file;
 * cut markers hide the module header and demo harness from the page.
 */

import { runNodeProgramOrExit } from "../shared/demo-harness";

// ---cut---
import { Duration, Effect, Fiber, Option, Schema, Stream } from "effect";
import * as Daemon from "../../src/Daemon";

const Price = Schema.Struct({ symbol: Schema.String, usd: Schema.Number });

class Prices extends Daemon.Tag<Prices>()("examples/daemon/PricesResult", {
  success: Price,
}).pipe(Daemon.schedule([])) {}

const program = Effect.gen(function* () {
  const daemon = yield* Prices;
  const changed = yield* Effect.forkChild(
    Stream.runHead(Stream.filter(daemon.result.changes, Option.isSome)).pipe(
      Effect.timeout(Duration.seconds(2)),
    ),
  );

  yield* daemon.run;
  const latest = yield* daemon.result.get;
  const fromChanges = yield* Fiber.join(changed);

  const latestText = Option.match(latest, {
    onNone: () => "none",
    onSome: (price) => `${price.symbol} ${String(price.usd)}`,
  });
  const changesText = Option.match(fromChanges, {
    onNone: () => "none",
    onSome: (priceOption) =>
      Option.match(priceOption, {
        onNone: () => "none",
        onSome: (price) => `${price.symbol} ${String(price.usd)}`,
      }),
  });
  yield* Effect.logInfo(`result.get=${latestText}; changes=${changesText}`);
}).pipe(
  Effect.provide(
    Daemon.layer(Prices, {
      effect: Effect.succeed({ symbol: "BTC", usd: 100_000 }),
    }),
  ),
  Effect.scoped,
  Effect.orDie,
);
// ---cut-after---

runNodeProgramOrExit(program, "example:daemon-result-ref finished OK");
