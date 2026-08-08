/**
 * @module examples/launcher/ensure-lookup-worker
 *
 * App worker for {@link launcher-ensure-lookup} — pipes Lookup.client (no Soft-bake).
 * argv: `<port> <lookup-sock>` — assume token from `HYPERLINK_ASSUME_TOKEN`.
 */

// ---cut---
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer, Schema } from "effect";
import * as Hyperlink from "../../src/Hyperlink";
import * as Lookup from "../../src/Lookup";
import * as Node from "../../src/Node";

class Jobs extends Hyperlink.Tag<Jobs>()(
  "examples/launcher-ensure-lookup/Jobs",
  {
    ping: Hyperlink.effect(Schema.String),
  },
) {}

const portArg = process.argv[2];
const lookupArg = process.argv[3];
const port = portArg !== undefined ? Number(portArg) : Number.NaN;

const program =
  !Number.isInteger(port) ||
  port <= 0 ||
  lookupArg === undefined ||
  lookupArg.length === 0
    ? Effect.die("ensure-lookup-worker: need <port> <lookup-sock>")
    : Effect.gen(function* () {
        const token = yield* Node.assumeTokenConfig;
        const node = Node.Tag()("examples/launcher-ensure-lookup/Worker", {
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
          { assumeToken: token },
        ).pipe(Layer.provide(Lookup.clientOptions({ path: lookupArg })));
        return yield* Node.launch(node, live);
      }).pipe(Effect.provide(NodeServices.layer));

// ---cut-after---
NodeRuntime.runMain(program);
