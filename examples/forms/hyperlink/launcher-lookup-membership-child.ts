/**
 * @module examples/forms/hyperlink/launcher-lookup-membership-child
 *
 * Child for {@link launcher-lookup-membership}: Track A custody (`assumeToken`) then
 * Track B membership (`Lookup.client` + Directory advertise).
 *
 * argv: `<port> <lookup-sock>` — assume token from `Node.assumeTokenConfig`
 * (`HYPERLINK_ASSUME_TOKEN`, injected by `Launcher.command`).
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer, Schema } from "effect";
import * as Hyperlink from "../../../src/Hyperlink";
import * as Lookup from "../../../src/Lookup";
import * as Node from "../../../src/Node";

class Jobs extends Hyperlink.Tag<Jobs>()("forms/launcher-membership/Jobs", {
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
    ? Effect.die(
        "launcher-lookup-membership-child: need <port> <lookup-sock>",
      )
    : Effect.gen(function* () {
        const token = yield* Node.assumeTokenConfig;
        const node = Node.Tag()("forms/launcher-membership/Worker", {
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
            // Membership plane: refuse directory-row steal while this demo holds the key.
            onConflict: "askIncumbent",
            onYield: Effect.succeed(false),
          },
        ).pipe(Layer.provide(Lookup.clientOptions({ path: lookupArg })));
        return yield* Layer.launch(live);
      }).pipe(Effect.provide(NodeServices.layer));

NodeRuntime.runMain(program);
