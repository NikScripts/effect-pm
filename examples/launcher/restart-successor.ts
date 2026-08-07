/**
 * @module examples/launcher/restart-successor
 *
 * **Live A→B** — `Launcher.restartSuccessor` with real OS children.
 *
 * 1. Lookup in-process; `Launcher.up` brings A Ready + Directory-visible
 * 2. `planUpdate` is unblocked (same Spec)
 * 3. `restartSuccessor` ups B (same `nodeKey`, new dial) then shuts A down
 * 4. Directory dial points at B; B answers `ping`
 *
 * Same-`nodeKey` replace needs `askIncumbent` + yield on the child
 * (`restart-successor-child.ts`). Blocked-plan dry-run:
 * `pnpm run example:launcher-plan-update`.
 *
 * ```bash
 * pnpm run example:launcher-restart-successor
 * ```
 *
 * Docs: `docs/examples/launcher/restart-successor.md`.
 */

// ---cut---
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Clock, Context, Effect, Layer, Schema } from "effect";
import { ChildProcess } from "effect/unstable/process";
import * as Directory from "../../src/Directory";
import * as Hyperlink from "../../src/Hyperlink";
import * as Launcher from "../../src/Launcher";
import * as Lookup from "../../src/Lookup";
import * as Node from "../../src/Node";

class Jobs extends Hyperlink.Tag<Jobs>()(
  "examples/launcher-restart-successor/Jobs",
  {
    ping: Hyperlink.effect(Schema.String),
  },
) {}

const workerNode = (port: number) =>
  Node.Tag()("examples/launcher-restart-successor/Worker", {
    url: `http://127.0.0.1:${String(port)}/rpc`,
    kind: "Http",
  });

const program = Effect.gen(function* () {
  const root = new URL("../..", import.meta.url).pathname;
  const entry = `${root}/examples/launcher/restart-successor-child.ts`;
  const now = yield* Clock.currentTimeMillis;
  const lookupPath = `/tmp/hyperlink-ts-restart-successor-${String(now)}.sock`;
  const portA = 28_800 + (now % 100);
  const portB = portA + 1;

  const lookupNode = Node.Tag()("examples/launcher-restart-successor/Lookup", {
    path: lookupPath,
  }).pipe(Node.asLookup);
  const lookupServer = yield* Layer.build(
    Lookup.layerNode(lookupNode, { unlink: true }),
  );
  const lookupClient = yield* Layer.build(Lookup.client(lookupNode));
  const lookupCtx = Context.merge(lookupServer, lookupClient);

  const child = (port: number) =>
    Launcher.command(
      "pnpm",
      ["exec", "tsx", entry, String(port), lookupPath],
      { cwd: root, stdout: "inherit", stderr: "inherit", token: "env" },
    );

  yield* Effect.gen(function* () {
    const nodeA = workerNode(portA);
    const nodeB = workerNode(portB);

    yield* Effect.logInfo(`1) up A on :${String(portA)}`);
    yield* Launcher.up({
      node: nodeA,
      process: child(portA),
      ready: { timeout: "25 seconds" },
    });

    const before = yield* Directory.nodesServing(Jobs);
    yield* Effect.logInfo(
      `2) Directory A url=${before[0]?.url ?? "?"} (expect :${String(portA)})`,
    );

    yield* Effect.logInfo("3) restartSuccessor → up B, shutdown A");
    const impact = yield* Launcher.restartSuccessor({
      target: "examples/launcher-restart-successor/Worker",
      successor: {
        node: nodeB,
        process: child(portB),
        ready: { timeout: "25 seconds" },
      },
      tags: [Jobs],
    });
    yield* Effect.logInfo(
      `   plan blocked=${String(impact?.blocked ?? false)} target=${impact?.target ?? "?"}`,
    );

    const after = yield* Directory.nodesServing(Jobs);
    yield* Effect.logInfo(
      `4) Directory now url=${after[0]?.url ?? "?"} (expect :${String(portB)})`,
    );

    const ping = yield* Effect.gen(function* () {
      const jobs = yield* Jobs;
      return yield* jobs.ping;
    }).pipe(Effect.provide(Hyperlink.client(Jobs, nodeB)), Effect.scoped);
    yield* Effect.logInfo(`5) B ping=${ping}`);

    yield* ChildProcess.make("pkill", [
      "-f",
      "restart-successor-child.ts",
    ]).pipe(
      Effect.flatMap((h) => h.exitCode),
      Effect.ignore,
    );
  }).pipe(
    Effect.provide(Lookup.planStatusOff),
    Effect.provide(lookupCtx),
  );
}).pipe(Effect.scoped, Effect.provide(Launcher.layer));

// ---cut-after---
NodeRuntime.runMain(program);
