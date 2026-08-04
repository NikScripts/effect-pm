/**
 * @module examples/hyperlink/tag-defaults
 *
 * Tag-baked defaults — {@link Hyperlink.default} (Spec leaf) and
 * {@link Hyperlink.defaults} (piped bag). Same value local and remote; no wire
 * round-trip. Layer overrides are provide-site only.
 *
 * ```bash
 * pnpm run example:hyperlink-tag-defaults
 * ```
 *
 * Docs: `docs/examples/hyperlink/tag-defaults.md` includes this file;
 * cut markers hide the module header and runner epilogue.
 */

// ---cut---
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Schema } from "effect";
import * as Hyperlink from "../../src/Hyperlink";

class Counter extends Hyperlink.Service<Counter>()(
  "default/Counter",
  {
    current: Hyperlink.effect(Schema.Number),
    add: Hyperlink.effectFn(Schema.Number, Schema.Number),
    /** Spec leaf — fully typed on `Service`. */
    label: Hyperlink.default((n: number) => `count=${n}`),
    unit: Hyperlink.default("count" as const),
  },
  {
    /** Factory sugar ≡ `.pipe(Hyperlink.defaults(…))` — widens `Service`. */
    defaults: {
      tags: ["demo", "defaults"] as const,
    },
  },
) {}

const program = Effect.gen(function* () {
  const c = yield* Counter;
  const n = yield* c.add(41);
  yield* Effect.log(`current after add: ${n}`);
  yield* Effect.log(`label: ${c.label(n)}`);
  yield* Effect.log(`unit: ${c.unit}`);
  yield* Effect.log(`tags: ${c.tags.join(", ")}`);
}).pipe(
  Effect.provide(
    Hyperlink.layer(Counter, {
      current: Effect.succeed(0),
      add: (by: number) => Effect.succeed(by + 1),
    }),
  ),
  Effect.scoped,
);

// ---cut-after---
NodeRuntime.runMain(program.pipe(Effect.provide(NodeServices.layer)));
