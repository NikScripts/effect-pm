/**
 * @module examples/web-dashboard/queue-server
 *
 * The host: runs the real queue engines and serves each over http (one path per
 * queue) so the browser can reach them with `Resource.client`. Drives live traffic
 * the sanctioned way — a **client** that enqueues over the wire (a loopback producer
 * here), not server-side `yield* tag` (a host doesn't expose its served service).
 * Run: `pnpm run example:queue-server`.
 */
import { EventEmitter } from "node:events";
import { Duration, Effect, Layer, Logger } from "effect";
import { createServer } from "node:http";

// We mount 12 resources (serveHttp) on one server, which stacks >10 per-request
// listeners → Node's MaxListeners warning floods stdout. Raise the limit. (The real fix
// is one shared router instead of N serveHttp — a follow-up.)
EventEmitter.defaultMaxListeners = 100;
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { serveHttp } from "../../src/QueueContract";
import { serveHttp as serveProcess } from "../../src/ProcessContract";
import { Polling } from "../../src/Polling";
import { Resource } from "../../src/Resource";
import {
  Billing,
  Daily,
  Jobs,
  KeyRotation,
  Mail,
  Notify,
  RegionEU,
  RegionUS,
  Weekly,
  Worker1,
  Worker2,
  Worker3,
  cfg,
  pathOf,
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

// host every queue at /rpc/<name> on one node server.
const serveLayer = Layer.mergeAll(
  serveHttp(Mail, cfg, { path: `/rpc/${pathOf(Mail.id)}` }),
  serveHttp(Jobs, cfg, { path: `/rpc/${pathOf(Jobs.id)}` }),
  serveHttp(Billing, cfg, { path: `/rpc/${pathOf(Billing.id)}` }),
  serveHttp(Notify, cfg, { path: `/rpc/${pathOf(Notify.id)}` }),
  serveHttp(Worker1, cfg, { path: `/rpc/${pathOf(Worker1.id)}` }),
  serveHttp(Worker2, cfg, { path: `/rpc/${pathOf(Worker2.id)}` }),
  serveHttp(Worker3, cfg, { path: `/rpc/${pathOf(Worker3.id)}` }),
  serveHttp(RegionUS, cfg, { path: `/rpc/${pathOf(RegionUS.id)}` }),
  serveHttp(RegionEU, cfg, { path: `/rpc/${pathOf(RegionEU.id)}` }),
  serveHttp(Daily, cfg, { path: `/rpc/${pathOf(Daily.id)}` }),
  serveHttp(Weekly, cfg, { path: `/rpc/${pathOf(Weekly.id)}` }),
  // the wnba key-rotation process (self-runs on a poll; no producer needed)
  serveProcess(
    KeyRotation,
    { effect: Effect.logInfo("wnba: key-rotation check"), polling: Polling.spaced(Duration.seconds(5)) },
    { path: `/rpc/${pathOf(KeyRotation.id)}` },
  ),
).pipe(
  // silence the served layer's console logging (per-request http access logs + the
  // captured worker logs) — they still reach the dashboard via captureLogs. The server's
  // own program logs (below) keep using the default logger so you can see them.
  Layer.provide(Logger.layer([], { mergeWithExisting: false })),
  Layer.provideMerge(NodeHttpServer.layer(makeServer, { port: PORT })),
);

// loopback client transport (the producer reaches the local server over http).
const remote = (id: string) =>
  RpcClient.layerProtocolHttp({
    url: `http://localhost:${PORT}/rpc/${pathOf(id)}`,
    transformClient: (c) => HttpClient.mapRequest(c, HttpClientRequest.setHeader("x-loopback", "1")),
  }).pipe(Layer.provide(RpcSerialization.layerNdjson), Layer.provide(FetchHttpClient.layer));
const clientLayer = Layer.mergeAll(
  Resource.client(Mail).pipe(Layer.provide(remote(Mail.id))),
  Resource.client(Jobs).pipe(Layer.provide(remote(Jobs.id))),
  Resource.client(Billing).pipe(Layer.provide(remote(Billing.id))),
  Resource.client(Notify).pipe(Layer.provide(remote(Notify.id))),
  Resource.client(Worker1).pipe(Layer.provide(remote(Worker1.id))),
  Resource.client(Worker2).pipe(Layer.provide(remote(Worker2.id))),
  Resource.client(Worker3).pipe(Layer.provide(remote(Worker3.id))),
  Resource.client(RegionUS).pipe(Layer.provide(remote(RegionUS.id))),
  Resource.client(RegionEU).pipe(Layer.provide(remote(RegionEU.id))),
  Resource.client(Daily).pipe(Layer.provide(remote(Daily.id))),
  Resource.client(Weekly).pipe(Layer.provide(remote(Weekly.id))),
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
