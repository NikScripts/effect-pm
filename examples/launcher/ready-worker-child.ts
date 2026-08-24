/**
 * @module examples/launcher/ready-worker-child
 *
 * Child helper for the Launcher teaching examples. It can serve a ready `Jobs`
 * service, an optional `Cache` service, sleep forever without serving, or exit
 * immediately.
 *
 * Standalone smoke: `pnpm run example:launcher-ready-worker-child`
 *
 * Docs: `docs/examples/launcher/ready-worker-child.md` includes this file;
 * cut markers hide the module header and runner epilogue.
 */

// ---cut---
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Schema } from "effect";
import * as Hyperlink from "../../src/Hyperlink";
import * as Node from "../../src/Node";

class Jobs extends Hyperlink.Service<Jobs>()("examples/launcher-ready/Jobs", {
  ping: Hyperlink.effect(Schema.String),
}) {}

class Cache extends Hyperlink.Service<Cache>()("examples/launcher-ready/Cache", {
  ping: Hyperlink.effect(Schema.String),
}).pipe(
  Hyperlink.withReadiness(() =>
    Effect.succeed({ ready: true }),
  ),
) {}

const usage =
  "ready-worker-child: exit | never | serve-env <node-key> <port> <jobs|jobs-cache> | serve-argv <node-key> <port> <jobs|jobs-cache> <token>";

const serve = (
  mode: "env" | "argv",
  nodeKey: string | undefined,
  portArg: string | undefined,
  services: string | undefined,
  argvToken: string | undefined,
) => {
  const port = portArg === undefined ? Number.NaN : Number(portArg);
  if (
    nodeKey === undefined ||
    !Number.isInteger(port) ||
    port <= 0 ||
    services === undefined ||
    (mode === "argv" && argvToken === undefined)
  ) {
    return Effect.die(usage);
  }

  const token =
    mode === "env" ? Node.assumeTokenConfig : Effect.succeed(argvToken);
  return Effect.gen(function* () {
    const assumeToken = yield* token;
    const worker = Node.Service()(nodeKey, {
      url: `http://127.0.0.1:${String(port)}/rpc`,
      kind: "Http",
    });
    const serves =
      services === "jobs-cache"
        ? ([
            Hyperlink.serve(Jobs, { ping: Effect.succeed("jobs-ready") }),
            Hyperlink.serve(Cache, { ping: Effect.succeed("cache-ready") }),
          ] as const)
        : ([
            Hyperlink.serve(Jobs, { ping: Effect.succeed("jobs-ready") }),
          ] as const);

    return yield* Node.launch(
      worker,
      Node.http(worker, serves, {
        assumeToken,
      }),
    );
  }).pipe(Effect.provide(NodeServices.layer));
};

const mode = process.argv[2];
const program =
  mode === "exit"
    ? Effect.logInfo("ready-worker-child exit mode")
    : mode === "never"
      ? Effect.never
      : mode === "serve-env"
        ? serve("env", process.argv[3], process.argv[4], process.argv[5], undefined)
        : mode === "serve-argv"
          ? serve(
              "argv",
              process.argv[3],
              process.argv[4],
              process.argv[5],
              process.argv[6],
            )
          : Effect.die(usage);
// ---cut-after---

NodeRuntime.runMain(program);
