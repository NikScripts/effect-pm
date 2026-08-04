/**
 * @module examples/readiness/with-readiness
 *
 * Attach a readiness derivation to a plain Hyperlink tag. The derivation reads
 * the materialized service and returns `{ ready, detail? }`.
 *
 * Run: `pnpm run example:readiness-with-readiness`
 *
 * Docs: `docs/examples/readiness/with-readiness.md` includes this file;
 * cut markers hide the module header and runner epilogue.
 */

import { runNodeProgramOrExit } from "../shared/demo-harness";

// ---cut---
import { Effect, Schema } from "effect";
import * as Hyperlink from "../../src/Hyperlink";

class Cache extends Hyperlink.Service<Cache>()("examples/readiness/Cache", {
  warm: Hyperlink.effect(Schema.Boolean),
}).pipe(
  Hyperlink.withReadiness((svc) =>
    Effect.map(svc.warm, (warm) =>
      warm ? { ready: true } : { ready: false, detail: "cache cold" },
    ),
  ),
) {}

const program = Effect.gen(function* () {
  const cache = yield* Cache;
  const readiness = yield* Hyperlink.readinessCheck(Cache, cache);
  yield* Effect.logInfo(
    `cache ready=${String(readiness.ready)} detail=${readiness.detail ?? "none"}`,
  );
}).pipe(
  Effect.provide(
    Hyperlink.layer(Cache, {
      warm: Effect.succeed(false),
    }),
  ),
);
// ---cut-after---

runNodeProgramOrExit(program, "example:readiness-with-readiness finished OK");
