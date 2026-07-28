/**
 * @module examples/forms/hyperlink/shared-tag-wire
 *
 * **Shared Spec tags** — one Spec / RpcGroup, many instance keys, routed by the
 * per-call `key` header. Same mint shape any fixed-Spec kind uses (counters here;
 * `Gate.HttpApiClient` owns API usage + limiter observation under nest `metrics`).
 *
 * Mint with `Hyperlink.Tag(wireKey, spec)` then `Factory<Self>()(instanceKey)`.
 * Serve and dial with ordinary {@link Hyperlink.serve} / {@link Hyperlink.client}
 * (no `*Family` verbs). Merging two `serve`s that share a wire key mounts one group.
 *
 * ```bash
 * pnpm exec tsx examples/forms/hyperlink/shared-tag-wire.ts
 * ```
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Context, Effect, Layer, Schema } from "effect";
import * as Hyperlink from "../../../src/Hyperlink";
import * as Node from "../../../src/Node";

/** Fixed Spec — every instance has the same procedures (shared-wire stand-in). */
const sharedCountersShape = {
  calls: Hyperlink.effect(Schema.Number),
  label: Hyperlink.effect(Schema.String),
};

/**
 * Shared factory: wire / kind key = `demo/SharedCounters`.
 * Instances differ only by Context identity + routing header.
 */
const SharedCounters = Hyperlink.Tag("demo/SharedCounters", sharedCountersShape, {
  description: "Demo stand-in for a kind-keyed shared Spec.",
});

class NwslCounters extends SharedCounters<NwslCounters>()("@app/Nwsl/counters") {}
class MlsCounters extends SharedCounters<MlsCounters>()("@app/Mls/counters") {}

class DemoNode extends Node.Tag<DemoNode, NwslCounters | MlsCounters>()(
  "forms/shared-tag/Demo",
  {
    path: `/tmp/hyperlink-ts-shared-tag-${process.pid}.sock`,
  },
) {}

const program = Effect.gen(function* () {
  const serverCtx = yield* Layer.build(
    Node.unix(DemoNode, [
      // Same serve verb as solo tags — merge shares one RpcGroup under demo/SharedCounters.
      Hyperlink.serve(NwslCounters, {
        calls: Effect.succeed(11),
        label: Effect.succeed("nwsl"),
      }),
      Hyperlink.serve(MlsCounters, {
        calls: Effect.succeed(22),
        label: Effect.succeed("mls"),
      }),
    ]),
  );

  const clientCtx = yield* Layer.build(
    Node.clients(DemoNode, [NwslCounters, MlsCounters]),
  );

  const result = yield* Effect.gen(function* () {
    const nwsl = yield* NwslCounters;
    const mls = yield* MlsCounters;
    return {
      wireKey: Hyperlink.wireKeyOf(NwslCounters),
      nwsl: [yield* nwsl.label, yield* nwsl.calls] as const,
      mls: [yield* mls.label, yield* mls.calls] as const,
    };
  }).pipe(Effect.provide(Context.merge(serverCtx, clientCtx)));

  yield* Effect.logInfo(
    `wire=${result.wireKey} nwsl=${result.nwsl[0]}:${result.nwsl[1]} mls=${result.mls[0]}:${result.mls[1]}`,
  );
  return result;
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

NodeRuntime.runMain(
  program.pipe(
    Effect.flatMap((result) =>
      result.wireKey === "demo/SharedCounters" &&
      result.nwsl[0] === "nwsl" &&
      result.nwsl[1] === 11 &&
      result.mls[0] === "mls" &&
      result.mls[1] === 22
        ? Effect.void
        : Effect.die(new Error(`unexpected ${JSON.stringify(result)}`)),
    ),
  ),
);
