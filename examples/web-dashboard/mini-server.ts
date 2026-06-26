/**
 * @module examples/web-dashboard/mini-server
 *
 * The **Mini** — a second machine (your home server). It hosts only `KeyRotation` (the
 * wnba key-rotation process), served over http on its own port. The dashboard reaches
 * it via `Resource.connectHttp(MiniHost, …)` and shows it under the same group tree as
 * the Droplet's queues — proving nested groups across separate hosts (the wow topology).
 * Run: `pnpm run example:mini-server` (alongside `example:queue-server`).
 */
import { Duration, Effect, Layer, Logger } from "effect";
import { createServer } from "node:http";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { serveHttp as serveProcess } from "../../src/ScheduledProcess";
import { HistoryStore } from "../../src/HistoryStore";
import { Polling } from "../../src/Polling";
import { KeyRotation } from "./fleet";

const PORT = 7778;

const serveLayer = serveProcess(KeyRotation, {
  effect: Effect.logInfo("wnba: key-rotation check"),
  polling: Polling.spaced(Duration.seconds(5)),
  captureLogs: true,
}).pipe(
  Layer.provide(HistoryStore.layerMemory()),
  Layer.provide(Logger.layer([], { mergeWithExisting: false })),
  Layer.provideMerge(NodeHttpServer.layer(() => createServer(), { port: PORT })),
);

const program = Effect.gen(function* () {
  yield* Effect.logInfo(`mini-server (KeyRotation) listening on :${PORT}`);
  return yield* Effect.never;
});

NodeRuntime.runMain(program.pipe(Effect.provide(serveLayer), Effect.scoped));
