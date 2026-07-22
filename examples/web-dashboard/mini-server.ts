/**
 * @module examples/web-dashboard/mini-server
 *
 * The **Mini** — a second machine (your home server). It nodes only `KeyRotation` (the
 * wnba key-rotation process), served over http on its own port. The dashboard reaches
 * it via `Resource.http(MiniNode, …)` and shows it under the same group tree as
 * the Droplet's queues — proving nested groups across separate nodes (the wow topology).
 * Run: `pnpm run example:mini-server` (alongside `example:queue-server`).
 */
import { Duration, Effect, Layer, Logger } from "effect";
import { createServer } from "node:http";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { serve as processEntry } from "../../src/Process";
import * as Process from "../../src/Process";
import * as Store from "../../src/Store";
import { HistoryStore } from "../../src/HistoryStore";
import { Polling } from "../../src/Polling";
import { KeyRotation, MiniNode } from "./fleet";
import * as Node from "../../src/Node";

const PORT = 7778;

class MiniStore extends Store.Service<MiniStore>("@examples/web-dashboard/MiniStore")(
  MiniNode.logs,
  Process.store(KeyRotation),
) {}

const serveLayer = Node.wsServer([
  processEntry(KeyRotation, {
    effect: Effect.logInfo("wnba: key-rotation check"),
    polling: Polling.spaced(Duration.seconds(5)),
  }),
]).pipe(
  Layer.provide(HistoryStore.layerMemory()),
  Layer.provide(MiniStore.layerMemory),
  Layer.provide(Logger.layer([], { mergeWithExisting: false })),
  Layer.provideMerge(NodeHttpServer.layer(() => createServer(), { port: PORT })),
);

const program = Effect.gen(function* () {
  yield* Effect.logInfo(`mini-server (KeyRotation) listening on :${PORT}`);
  return yield* Effect.never;
});

NodeRuntime.runMain(program.pipe(Effect.provide(serveLayer), Effect.scoped));
