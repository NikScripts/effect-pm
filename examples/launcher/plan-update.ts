/**
 * @module examples/launcher/plan-update
 *
 * **Plan blocked** — dry-run `Lookup.planUpdate`, ambient Layers, then
 * `Launcher.restartSuccessor` refuse before spawn when wires are removed.
 *
 * Live happy path: `pnpm run example:launcher-restart-successor`.
 *
 * ```bash
 * pnpm run example:launcher-plan-update
 * ```
 */

// ---cut---
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Clock, Context, Effect, Layer, Schema } from "effect";
import * as Directory from "../../src/Directory";
import * as Hyperlink from "../../src/Hyperlink";
import * as Launcher from "../../src/Launcher";
import * as Lookup from "../../src/Lookup";
import * as Node from "../../src/Node";

class Jobs extends Hyperlink.Tag<Jobs>()("examples/plan-update/Jobs", {
  run: Hyperlink.effect(Schema.Number),
  legacy: Hyperlink.effect(Schema.String),
}) {}

const jobsNext: Lookup.PlanUpdateTag = {
  key: "examples/plan-update/Jobs",
  [Hyperlink.wireKeySym]: "examples/plan-update/Jobs",
  [Hyperlink.specSym]: {
    run: Hyperlink.effect(Schema.Number),
  },
};

const program = Effect.gen(function* () {
  const now = yield* Clock.currentTimeMillis;
  const path = `/tmp/hyperlink-ts-plan-update-${String(now)}.sock`;
  const lookup = Node.Tag()("examples/plan-update/Lookup", { path }).pipe(
    Node.asLookup,
  );

  const serverCtx = yield* Layer.build(Lookup.layerNode(lookup));
  const clientCtx = yield* Layer.build(Lookup.client(lookup));
  const ctx = Context.merge(serverCtx, clientCtx);

  yield* Effect.gen(function* () {
    const dir = yield* Directory.Tag;
    yield* dir.advertise(
      new Lookup.AdvertiseRequest({
        nodeKey: "worker-a",
        kind: "IpcSocket",
        path: "/tmp/plan-update-worker-a.sock",
        serves: ["examples/plan-update/Jobs"],
      }),
    );

    yield* Effect.logInfo("1) planUpdate with wire removal → UpdateBlocked");
    const blocked = yield* Effect.exit(
      Lookup.planUpdate("worker-a", [jobsNext], { incumbent: [Jobs] }),
    );
    yield* Effect.logInfo(`   exit=${blocked._tag} (expect Failure)`);

    yield* Effect.logInfo("2) same plan with Lookup.planForce Layer");
    const impact = yield* Lookup.planUpdate("worker-a", [jobsNext], {
      incumbent: [Jobs],
    }).pipe(Effect.provide(Lookup.planForce));
    const removals = impact.wireRemovals
      .map((r) => `${r.serviceKey}#${r.method}`)
      .join(", ");
    yield* Effect.logInfo(
      `   blocked=${String(impact.blocked)} removals=[${removals}]`,
    );

    yield* Effect.logInfo(
      "3) restartSuccessor stops before spawn when plan blocks",
    );
    const successor = Node.Tag()("examples/plan-update/worker-b", {
      url: "http://127.0.0.1:1/rpc",
      kind: "Http",
    });
    const restart = yield* Effect.exit(
      Launcher.restartSuccessor({
        target: "worker-a",
        successor: {
          node: successor,
          process: Launcher.command("sleep", ["120"]),
        },
        tags: [jobsNext],
        incumbent: [Jobs],
      }).pipe(Effect.provide(Launcher.layer)),
    );
    yield* Effect.logInfo(`   exit=${restart._tag} (expect Failure / UpdateBlocked)`);
  }).pipe(
    Effect.provide(Lookup.planStatusOff),
    Effect.provide(ctx),
  );
}).pipe(Effect.scoped);

// ---cut-after---
NodeRuntime.runMain(program);
