/**
 * @module examples/launcher/ensure-lookup-child
 *
 * Lookup-only child for {@link launcher-ensure-lookup} — no app HyperServices.
 * argv: `<lookup-sock>` — assume token from `HYPERLINK_ASSUME_TOKEN` (Launcher env injection).
 */

// ---cut---
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import * as Lookup from "../../src/Lookup";
import * as Node from "../../src/Node";

const pathArg = process.argv[2];

const program =
  pathArg === undefined || pathArg.length === 0
    ? Effect.die("ensure-lookup-child: need <lookup-sock>")
    : Effect.gen(function* () {
        const token = yield* Node.assumeTokenConfig;
        // Same key as Launcher.ensureLookup's default seed when path-only.
        const node = Node.Service()("hyperlink-ts/Launcher/Lookup", {
          path: pathArg,
        }).pipe(Node.asLookup);
        const live = Lookup.layerNode(node, {
          unlink: true,
          assumeToken: token,
        });
        return yield* Layer.launch(live);
      }).pipe(Effect.provide(NodeServices.layer));

// ---cut-after---
NodeRuntime.runMain(program);
