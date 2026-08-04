/**
 * Lookup-only child for `Launcher.ensureLookup` tests.
 * argv: `<lookup-sock> <assume-token>` — no app HyperServices (Soft-bake forbidden path).
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer, Redacted } from "effect";
import * as Lookup from "../../src/Lookup";
import * as Node from "../../src/Node";

const pathArg = process.argv[2];
const tokenArg = process.argv[3];

const program =
  pathArg === undefined ||
  pathArg.length === 0 ||
  tokenArg === undefined ||
  tokenArg.length === 0
    ? Effect.die("launcher-lookup-child: need <lookup-sock> <assume-token>")
    : Effect.gen(function* () {
        const node = Node.Tag()("launcher/ensure-lookup", {
          path: pathArg,
        }).pipe(Node.asLookup);
        const live = Lookup.layerNode(node, {
          unlink: true,
          assumeToken: Redacted.make(tokenArg),
        });
        return yield* Layer.launch(live);
      }).pipe(Effect.provide(NodeServices.layer));

NodeRuntime.runMain(program);
