/**
 * @module examples/daemon/configure
 *
 * `Daemon.configure` contributes config patches that fold when the daemon layer
 * builds. This example replaces the base effect before a manual run.
 *
 * Run: `pnpm run example:daemon-configure`
 *
 * Docs: `docs/examples/daemon/configure.md` includes this file;
 * cut markers hide the module header and demo harness from the page.
 */

import { runNodeProgramOrExit } from "../shared/demo-harness";

// ---cut---
import { Effect, Layer, Schema } from "effect";
import * as Daemon from "../../src/Daemon";

class ConfiguredDaemon extends Daemon.Tag<ConfiguredDaemon>()(
  "examples/daemon/Configured",
  { success: Schema.String },
).pipe(Daemon.schedule([])) {}

const BaseLive = Daemon.layer(ConfiguredDaemon, {
  effect: Effect.succeed("base"),
});

const TunedLive = BaseLive.pipe(
  Layer.provideMerge(
    Daemon.configure(ConfiguredDaemon as never, {
      effect: Effect.succeed("configured"),
    }),
  ),
);

const program = Effect.gen(function* () {
  const daemon = yield* ConfiguredDaemon;
  const value = yield* daemon.run;
  yield* Effect.logInfo(`configured daemon result=${value}`);
  if (value !== "configured") {
    return yield* Effect.die(new Error(`expected configured, got ${value}`));
  }
}).pipe(Effect.provide(TunedLive), Effect.scoped, Effect.orDie);
// ---cut-after---

runNodeProgramOrExit(program, "example:daemon-configure finished OK");
