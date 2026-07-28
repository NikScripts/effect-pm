/**
 * Child entry for Launcher integration — `argv[2]` = loopback port, `argv[3]` = assume token.
 * OS-edge script (argv is the injection channel for this fixture).
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer, Redacted, Schema } from "effect";
import * as Hyperlink from "../../src/Hyperlink";
import * as Node from "../../src/Node";

class Jobs extends Hyperlink.Tag<Jobs>()("launcher-child/Jobs", {
  ping: Hyperlink.effect(Schema.String),
}) {}

const portArg = process.argv[2];
const tokenArg = process.argv[3];
const port = portArg !== undefined ? Number(portArg) : Number.NaN;

const program =
  !Number.isInteger(port) ||
  port <= 0 ||
  tokenArg === undefined ||
  tokenArg.length === 0
    ? Effect.die("launcher-child-serve: need <port> <assume-token>")
    : Effect.gen(function* () {
        const node = Node.Tag()("launcher/child", {
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
            assumeToken: Redacted.make(tokenArg),
          },
        );
        return yield* Layer.launch(live);
      }).pipe(Effect.provide(NodeServices.layer));

NodeRuntime.runMain(program);
