/**
 * @module examples/web-dashboard/queue-server
 *
 * The host: runs the real queue engines and serves each over http (one path per
 * queue) so the browser can reach them with `Resource.client`. Serve-only for now —
 * see the note below on producers. Run: `pnpm run example:queue-server`.
 */
import { Effect, Layer } from "effect";
import { createServer } from "node:http";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { QueueResource } from "../../src/QueueContract";
import {
  Billing,
  Daily,
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
  pathOf,
} from "./fleet";

const PORT = 7777;

const serveLayer = Layer.mergeAll(
  QueueResource.serveHttp(Mail, cfg, { path: `/rpc/${pathOf(Mail.id)}` }),
  QueueResource.serveHttp(Jobs, cfg, { path: `/rpc/${pathOf(Jobs.id)}` }),
  QueueResource.serveHttp(Billing, cfg, { path: `/rpc/${pathOf(Billing.id)}` }),
  QueueResource.serveHttp(Notify, cfg, { path: `/rpc/${pathOf(Notify.id)}` }),
  QueueResource.serveHttp(Worker1, cfg, { path: `/rpc/${pathOf(Worker1.id)}` }),
  QueueResource.serveHttp(Worker2, cfg, { path: `/rpc/${pathOf(Worker2.id)}` }),
  QueueResource.serveHttp(Worker3, cfg, { path: `/rpc/${pathOf(Worker3.id)}` }),
  QueueResource.serveHttp(RegionUS, cfg, { path: `/rpc/${pathOf(RegionUS.id)}` }),
  QueueResource.serveHttp(RegionEU, cfg, { path: `/rpc/${pathOf(RegionEU.id)}` }),
  QueueResource.serveHttp(Daily, cfg, { path: `/rpc/${pathOf(Daily.id)}` }),
  QueueResource.serveHttp(Weekly, cfg, { path: `/rpc/${pathOf(Weekly.id)}` }),
).pipe(Layer.provideMerge(NodeHttpServer.layer(() => createServer(), { port: PORT })));

// NOTE: `serveHttp` builds + serves the engine internally; it does NOT expose the
// queue service to this runtime, so server-side producers (`yield* tag`) aren't
// possible here. The queues serve live (workers auto-start); drive traffic from a
// client once the browser path is unblocked. (Producer strategy: TODO.)
const program = Effect.gen(function* () {
  yield* Effect.logInfo(`queue-server listening on :${PORT}`);
  return yield* Effect.never;
});

NodeRuntime.runMain(program.pipe(Effect.provide(serveLayer), Effect.scoped));
