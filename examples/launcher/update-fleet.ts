/**
 * @module examples/launcher/update-fleet
 *
 * **Fleet plan dry-run** — compose a multi-node `Update.plan`, inspect
 * `coUpdate` / contract audit, `simulate` (no spawn). Live cutover stays on
 * dream-redeploy / restart-successor.
 *
 * ```bash
 * pnpm run example:launcher-update-fleet
 * ```
 *
 * Guide: `docs/guides/update.md`.
 */

// ---cut---
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Clock, Context, Effect, Layer, Schema } from "effect";
import * as Directory from "../../src/Directory";
import * as Hyperlink from "../../src/Hyperlink";
import * as Launcher from "../../src/Launcher";
import * as Lookup from "../../src/Lookup";
import * as Node from "../../src/Node";
import * as Update from "../../src/Update";

class Mail extends Hyperlink.Service<Mail>()("examples/update-fleet/Mail", {
  ping: Hyperlink.effect(Schema.String),
}) {}

class Jobs extends Hyperlink.Service<Jobs>()("examples/update-fleet/Jobs", {
  run: Hyperlink.effect(Schema.Number),
}) {}

const program = Effect.gen(function* () {
  const now = yield* Clock.currentTimeMillis;
  const path = `/tmp/hyperlink-ts-update-fleet-${String(now)}.sock`;
  const lookup = Node.Service()("examples/update-fleet/Lookup", { path }).pipe(
    Node.asLookup,
  );

  const serverCtx = yield* Layer.build(Lookup.layerNode(lookup));
  const clientCtx = yield* Layer.build(Lookup.client(lookup));

  yield* Effect.gen(function* () {
    const dir = yield* Directory.Service;
    yield* dir.advertise(
      new Directory.AdvertiseRequest({
        nodeKey: "fleet/Mail",
        kind: "IpcSocket",
        path: "/tmp/update-fleet-mail.sock",
        serves: [Mail.key],
      }),
    );
    yield* dir.advertise(
      new Directory.AdvertiseRequest({
        nodeKey: "fleet/Jobs",
        kind: "IpcSocket",
        path: "/tmp/update-fleet-jobs.sock",
        serves: [Jobs.key],
      }),
    );
    // Peer sharing Jobs — shows up on plan.uncoveredCoUpdate until scheduled.
    yield* dir.advertise(
      new Directory.AdvertiseRequest({
        nodeKey: "fleet/Jobs#spare",
        kind: "IpcSocket",
        path: "/tmp/update-fleet-jobs-spare.sock",
        serves: [Jobs.key],
      }),
    );

    const dummy = {
      node: Node.Service()("examples/update-fleet/B", {
        path: "/tmp/update-fleet-b.sock",
      }),
      process: Launcher.command("true", [], { token: "env" }),
    };

    yield* Effect.logInfo("1) Update.plan — ordered Mail then Jobs");
    const plan = yield* Update.plan({
      steps: [
        { target: "fleet/Mail", successor: dummy, tags: [Mail] },
        { target: "fleet/Jobs", successor: dummy, tags: [Jobs] },
      ],
    });

    yield* Effect.logInfo(
      `2) steps=${String(plan.steps.length)} blocked=${String(plan.blocked)} ` +
        `coUpdate=${JSON.stringify(plan.coUpdate)} ` +
        `uncovered=${JSON.stringify(plan.uncoveredCoUpdate)}`,
    );

    yield* Effect.logInfo("3) Update.simulate — validate without spawn");
    const report = yield* Update.simulate(plan);
    yield* Effect.logInfo(`4) simulate ok=${String(report.ok)}`);
  }).pipe(
    Effect.provide(Lookup.planStatusOff),
    Effect.provide(Context.merge(serverCtx, clientCtx)),
  );
}).pipe(Effect.scoped);

// ---cut-after---
NodeRuntime.runMain(program);
