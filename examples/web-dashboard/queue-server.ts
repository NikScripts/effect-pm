/**
 * @module examples/web-dashboard/queue-server
 *
 * The node: runs the real queue engines and serves each over http (one path per
 * queue) so the browser can reach them with `Resource.client`. Drives live traffic
 * the sanctioned way — a **client** that enqueues over the wire (a loopback producer
 * here), not server-side `yield* tag` (a node doesn't expose its served service).
 * Run: `pnpm run example:queue-server`.
 */
import { Duration, Effect, Layer, Logger } from "effect";
import { createServer } from "node:http";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { serve as queueEntry } from "../../src/QueueResource";
import { HistoryStore } from "../../src/HistoryStore";
import * as Resource from "../../src/Resource";
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

const PORT = 7777;

// ── request-rate monitor ─────────────────────────────────────────────────────
// Streams are persistent connections (one open request the server pushes down), so the
// dashboard's steady-state NEW requests should be ~0/s and "open" = its live streams. A
// high rate would mean a poll/reconnect loop. The loopback producer tags its requests
// with `x-loopback` so we report the BROWSER's load separately from the demo's traffic.
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
const serveLayer = Resource.httpServer([
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
  // capture metrics + log history so the dashboard can backfill (query-then-tail).
  Layer.provide(HistoryStore.layerMemory()),
  // silence the served layer's console logging (per-request http access logs + the
  // captured worker logs) — they still reach the dashboard via captureLogs. The server's
  // own program logs (below) keep using the default logger so you can see them.
  Layer.provide(Logger.layer([], { mergeWithExisting: false })),
  Layer.provideMerge(NodeHttpServer.layer(makeServer, { port: PORT })),
);

// loopback client transport: ONE Droplet-node transport the producers share (the single
// /rpc endpoint, procedures group-prefixed). Tagged `x-loopback` so the rate monitor
// separates the demo's own traffic from the browser's.
const loopback = Resource.connect(
  Droplet,
  RpcClient.layerProtocolHttp({
    url: `http://localhost:${PORT}/rpc`,
    transformClient: (c) => HttpClient.mapRequest(c, HttpClientRequest.setHeader("x-loopback", "1")),
  }).pipe(Layer.provide(RpcSerialization.layerNdjson), Layer.provide(FetchHttpClient.layer)),
);
const clientLayer = Layer.mergeAll(
  Resource.client(Mail).pipe(Layer.provide(loopback)),
  Resource.client(Jobs).pipe(Layer.provide(loopback)),
  Resource.client(Billing).pipe(Layer.provide(loopback)),
  Resource.client(Notify).pipe(Layer.provide(loopback)),
  Resource.client(Worker1).pipe(Layer.provide(loopback)),
  Resource.client(Worker2).pipe(Layer.provide(loopback)),
  Resource.client(Worker3).pipe(Layer.provide(loopback)),
  Resource.client(RegionUS).pipe(Layer.provide(loopback)),
  Resource.client(RegionEU).pipe(Layer.provide(loopback)),
  Resource.client(Daily).pipe(Layer.provide(loopback)),
  Resource.client(Weekly).pipe(Layer.provide(loopback)),
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
