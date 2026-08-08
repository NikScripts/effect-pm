/**
 * App child for `Launcher.restartSuccessor` live suite.
 *
 * argv: `<port> <lookup-sock>` — assume token from `HYPERLINK_ASSUME_TOKEN`
 * (`Launcher.command` token: `"env"`). Serves `restart-successor/Jobs` and joins
 * Lookup via `Lookup.clientOptions` so Directory sees the worker before cutover.
 *
 * Same `nodeKey` (`restart/worker`) for A and B — dial-replace on B advertise;
 * `Node.launch` so remote `Node.shutdown` ends the process.
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer, Schema } from "effect";
import * as Hyperlink from "../../src/Hyperlink";
import * as Lookup from "../../src/Lookup";
import * as Node from "../../src/Node";

class Jobs extends Hyperlink.Service<Jobs>()("restart-successor/Jobs", {
  ping: Hyperlink.effect(Schema.String),
}) {}

const portArg = process.argv[2];
const lookupArg = process.argv[3];
const port = portArg !== undefined ? Number(portArg) : Number.NaN;

const program =
  !Number.isInteger(port) ||
  port <= 0 ||
  lookupArg === undefined ||
  lookupArg.length === 0
    ? Effect.die("launcher-restart-child: need <port> <lookup-sock>")
    : Effect.gen(function* () {
        const token = yield* Node.assumeTokenConfig;
        const node = Node.Service()("restart/worker", {
          url: `http://127.0.0.1:${String(port)}/rpc`,
          kind: "Http",
        });
        const live = Node.http(
          node,
          [
            Hyperlink.serve(Jobs, {
              ping: Effect.succeed("pong"),
            }),
          ],
          {
            assumeToken: token,
            // Same-nodeKey A→B: B asks; A yields so Directory dial can move
            // before restartSuccessor shuts A down.
            onConflict: "askIncumbent",
            onYield: Effect.succeed(true),
          },
        ).pipe(Layer.provide(Lookup.clientOptions({ path: lookupArg })));
        return yield* Node.launch(node, live);
      }).pipe(Effect.provide(NodeServices.layer));

NodeRuntime.runMain(program);
