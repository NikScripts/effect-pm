/**
 * Dream-redeploy tip **v1** — copied onto the active worker path before `up(A)`.
 * argv: `<port> <lookup-sock>` · assume token from `HYPERLINK_ASSUME_TOKEN`.
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import * as Hyperlink from "../../src/Hyperlink";
import * as Lookup from "../../src/Lookup";
import * as Node from "../../src/Node";
import * as WorkPool from "../../src/WorkPool";
import {
  Jobs,
  Probe,
  WORKER_NODE_KEY,
} from "./dream-redeploy-shared";

const portArg = process.argv[2];
const lookupArg = process.argv[3];
const port = portArg !== undefined ? Number(portArg) : Number.NaN;

const program =
  !Number.isInteger(port) ||
  port <= 0 ||
  lookupArg === undefined ||
  lookupArg.length === 0
    ? Effect.die("dream-redeploy-worker.v1: need <port> <lookup-sock>")
    : Effect.gen(function* () {
        const token = yield* Node.assumeTokenConfig;
        const node = Node.Tag()(WORKER_NODE_KEY, {
          url: `http://127.0.0.1:${String(port)}/rpc`,
          kind: "Http",
        });
        const live = Node.http(
          node,
          [
            WorkPool.serve(Jobs, { effect: () => Effect.void }).pipe(
              Hyperlink.deferStart,
            ),
            Hyperlink.serve(Probe, {
              tip: Effect.succeed("v1"),
            }),
          ],
          {
            assumeToken: token,
            onConflict: "askIncumbent",
            onYield: Effect.succeed(true),
          },
        ).pipe(Layer.provide(Lookup.clientOptions({ path: lookupArg })));
        return yield* Node.launch(node, live);
      }).pipe(Effect.provide(NodeServices.layer));

NodeRuntime.runMain(program);
