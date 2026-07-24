/**
 * @module examples/web-dashboard/queue-server
 *
 * The node: runs the real queue engines and serves each over http (one path per
 * queue) so the browser can reach them with `Hyperlink.client`. Drives live traffic
 * the sanctioned way — a **client** that enqueues over the wire (a loopback producer
 * here), not server-side `yield* tag` (a node doesn't expose its served service).
 * Run: `pnpm run example:queue-server`.
 */
import { Duration, Effect, Layer, Logger } from "effect";
import { createServer } from "node:http";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { serve as queueEntry } from "../../src/WorkPool";
import * as WorkPool from "../../src/WorkPool";
import { HistoryStore } from "../../src/HistoryStore";
import * as Hyperlink from "../../src/Hyperlink";
import * as Store from "../../src/Store";
import {
  Billing,
  Daily,
  Droplet,
  Jobs,
  Mail,
  Notify,
  RegionEU,
  RegionUS,
  Weekly,
  Worker1,
  Worker2,
  Worker3,
  cfg,
} from "./fleet";
import * as Node from "../../src/Node";

const PORT = 7777;

/** Node journal + per-queue log shapes — `layerMemory` bakes in Logs.layer + durable tails. */
class DropletStore extends Store.Service<DropletStore>("@examples/web-dashboard/DropletStore")(
  Droplet.logs,
  WorkPool.store(Mail),
  WorkPool.store(Jobs),
  WorkPool.store(Billing),
  WorkPool.store(Notify),
  WorkPool.store(Worker1),
  WorkPool.store(Worker2),
  WorkPool.store(Worker3),
  WorkPool.store(RegionUS),
  WorkPool.store(RegionEU),
  WorkPool.store(Daily),
  WorkPool.store(Weekly),
) {}

// ── request-rate monitor ─────────────────────────────────────────────────────
// Counts plain HTTP requests (e.g. `/health` polls). Both the browser and the loopback producer now
// speak WebSocket (one `upgrade` per client, not `request` events), so they don't show here — this is
// just a cheap "is something hammering plain HTTP?" check. The legacy `x-loopback` split is vestigial
// (the producer no longer sends tagged http requests), so `producer` stays 0.
let extReqs = 0;
let intReqs = 0;
let openExt = 0;
const makeServer = () => {
  const server = createServer();
  server.on("request", (req, res) => {
    if (req.headers["x-loopback"] === "1") {
      intReqs += 1;
      return;
    }
    extReqs += 1;
    openExt += 1;
    res.once("close", () => {
      openExt -= 1;
    });
  });
  return server;
};
let lastExt = 0;
setInterval(() => {
  const delta = extReqs - lastExt;
  lastExt = extReqs;
  console.log(
    `[browser] +${delta} req/5s (${(delta / 5).toFixed(1)}/s) · ${openExt} open streams · ${extReqs} total   (producer: ${intReqs})`,
  );
}, 5000);

// node every queue as ONE group on ONE port: `httpServer` mounts a single `/rpc`
// endpoint with group-id-prefixed procedures behind the Droplet node. (The wnba
// key-rotation process lives on the Mini — see mini-server.ts.)
const serveLayer = Node.wsServer([
  queueEntry(Mail, cfg),
  queueEntry(Jobs, cfg),
  queueEntry(Billing, cfg),
  queueEntry(Notify, cfg),
  queueEntry(Worker1, cfg),
  queueEntry(Worker2, cfg),
  queueEntry(Worker3, cfg),
  queueEntry(RegionUS, cfg),
  queueEntry(RegionEU, cfg),
  queueEntry(Daily, cfg),
  queueEntry(Weekly, cfg),
]).pipe(
  // capture metrics history so the dashboard can backfill (query-then-tail).
  Layer.provide(HistoryStore.layerMemory()),
  Layer.provide(DropletStore.layerMemory),
  // silence the served layer's console logging (per-request http access logs) — node logs
  // still reach the dashboard via node.logs + lineage filter.
  Layer.provide(Logger.layer([], { mergeWithExisting: false })),
  Layer.provideMerge(NodeHttpServer.layer(makeServer, { port: PORT })),
);

// loopback client transport: ONE Droplet-node transport the producers share (the single /rpc
// endpoint, procedures group-prefixed). It MUST match the server's protocol — the server is a
// `wsServer` above, so the producer dials WebSocket via `Hyperlink.protocolWebsocket`. (Dialing http
// against a ws server fails per-call — `q.add` → "empty HTTP response from RPC server" — and the
// producer's `Effect.ignore` swallows it, so nothing enqueues and the dashboard shows empty queues.
// That mismatch was this example's original "no live data" bug.)
const loopback = Node.connect(
  Droplet,
  Hyperlink.protocolWebsocket(`ws://localhost:${PORT}/rpc`),
);
const clientLayer = Layer.mergeAll(
  Hyperlink.client(Mail).pipe(Layer.provide(loopback)),
  Hyperlink.client(Jobs).pipe(Layer.provide(loopback)),
  Hyperlink.client(Billing).pipe(Layer.provide(loopback)),
  Hyperlink.client(Notify).pipe(Layer.provide(loopback)),
  Hyperlink.client(Worker1).pipe(Layer.provide(loopback)),
  Hyperlink.client(Worker2).pipe(Layer.provide(loopback)),
  Hyperlink.client(Worker3).pipe(Layer.provide(loopback)),
  Hyperlink.client(RegionUS).pipe(Layer.provide(loopback)),
  Hyperlink.client(RegionEU).pipe(Layer.provide(loopback)),
  Hyperlink.client(Daily).pipe(Layer.provide(loopback)),
  Hyperlink.client(Weekly).pipe(Layer.provide(loopback)),
);

let rngState = 0x9e3779b9;
const rng = (): number => {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 0x100000000;
};
const hexKey = (): string => Math.floor(rng() * 0xffff).toString(16).padStart(4, "0");

interface Producible {
  readonly add: (i: { readonly id: string }) => Effect.Effect<unknown, unknown, never>;
  readonly prioritize: (i: { readonly id: string }) => Effect.Effect<unknown, unknown, never>;
  readonly defer: (i: { readonly id: string }) => Effect.Effect<unknown, unknown, never>;
}

// a producer is just a client that enqueues — fork one per queue.
const produce = <R>(tag: Effect.Effect<Producible, never, R>): Effect.Effect<void, never, R> =>
  Effect.asVoid(
    Effect.flatMap(tag, (q) =>
      Effect.forkDetach(
        Effect.forever(
          Effect.gen(function* () {
            const r = rng();
            const item = { id: hexKey() };
            yield* (r < 0.2 ? q.prioritize(item) : r < 0.85 ? q.add(item) : q.defer(item)).pipe(
              Effect.ignore,
            );
            yield* Effect.sleep(Duration.millis(300 + Math.floor(rng() * 500)));
          }),
        ),
      ),
    ),
  );

const program = Effect.gen(function* () {
  yield* Effect.logInfo(`queue-server listening on :${PORT}`);
  yield* produce(Mail);
  yield* produce(Jobs);
  yield* produce(Billing);
  yield* produce(Notify);
  yield* produce(Worker1);
  yield* produce(Worker2);
  yield* produce(Worker3);
  yield* produce(RegionUS);
  yield* produce(RegionEU);
  yield* produce(Daily);
  yield* produce(Weekly);
  return yield* Effect.never;
});

NodeRuntime.runMain(
  program.pipe(Effect.provide(Layer.mergeAll(serveLayer, clientLayer)), Effect.scoped),
);
