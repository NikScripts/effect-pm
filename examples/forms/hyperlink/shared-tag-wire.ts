/**
 * @module examples/forms/hyperlink/shared-tag-wire
 *
 * **Shared Spec tags** — the wire shape ApiMetrics (and other fixed-Spec kinds) will use:
 * one Spec / RpcGroup, many instance keys, routed by the per-call `key` header.
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

/** Fixed Spec — every instance has the same procedures (metrics-shaped stand-in). */
const apiMetricsShape = {
  calls: Hyperlink.effect(Schema.Number),
  label: Hyperlink.effect(Schema.String),
};

/**
 * Shared factory: wire / kind key = `demo/ApiMetrics`.
 * Instances differ only by Context identity + routing header.
 */
const ApiMetrics = Hyperlink.Tag("demo/ApiMetrics", apiMetricsShape, {
  description: "Demo stand-in for a kind-keyed metrics Spec.",
});

class NwslMetrics extends ApiMetrics<NwslMetrics>()("@app/Nwsl/metrics") {}
class MlsMetrics extends ApiMetrics<MlsMetrics>()("@app/Mls/metrics") {}

class DemoNode extends Node.Tag<DemoNode, NwslMetrics | MlsMetrics>()(
  "forms/shared-tag/Demo",
  {
    path: `/tmp/hyperlink-ts-shared-tag-${process.pid}.sock`,
  },
) {}

const program = Effect.gen(function* () {
  const serverCtx = yield* Layer.build(
    Node.unix(DemoNode, [
      // Same serve verb as solo tags — merge shares one RpcGroup under demo/ApiMetrics.
      Hyperlink.serve(NwslMetrics, {
        calls: Effect.succeed(11),
        label: Effect.succeed("nwsl"),
      }),
      Hyperlink.serve(MlsMetrics, {
        calls: Effect.succeed(22),
        label: Effect.succeed("mls"),
      }),
    ]),
  );

  const clientCtx = yield* Layer.build(
    Node.clients(DemoNode, [NwslMetrics, MlsMetrics]),
  );

  const result = yield* Effect.gen(function* () {
    const nwsl = yield* NwslMetrics;
    const mls = yield* MlsMetrics;
    return {
      wireKey: Hyperlink.wireKeyOf(NwslMetrics),
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
      result.wireKey === "demo/ApiMetrics" &&
      result.nwsl[0] === "nwsl" &&
      result.nwsl[1] === 11 &&
      result.mls[0] === "mls" &&
      result.mls[1] === 22
        ? Effect.void
        : Effect.die(new Error(`unexpected ${JSON.stringify(result)}`)),
    ),
  ),
);
