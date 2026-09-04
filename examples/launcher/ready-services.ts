/**
 * @module examples/launcher/ready-services
 *
 * `ready.services` can wait on a named subset of served HyperServices. This
 * child serves `Jobs` and `Cache`; Launcher is configured with named Tags in
 * `ready.services` so the Ready wait is explicit about which services matter.
 *
 * Run: `pnpm run example:launcher-ready-services`
 *
 * Docs: `docs/examples/launcher/ready-services.md` includes this file;
 * cut markers hide the module header and runner epilogue.
 */

// ---cut---
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Clock, Effect, Schema } from "effect";
import * as Hyperlink from "../../src/Hyperlink";
import * as Launcher from "../../src/Launcher";
import * as Node from "../../src/Node";

class Jobs extends Hyperlink.Service<Jobs>()("examples/launcher-ready/Jobs", {
  ping: Hyperlink.effect(Schema.String),
}) {}

const program = Effect.gen(function* () {
  const root = new URL("../..", import.meta.url).pathname;
  const entry = `${root}/examples/launcher/ready-worker-child.ts`;
  const now = yield* Clock.currentTimeMillis;
  const port = 29_500 + (now % 200);
  const worker = Node.Service()("examples/launcher-ready-services/Worker", {
    url: `http://127.0.0.1:${String(port)}/rpc`,
    kind: "Http",
  });

  yield* Launcher.up({
    node: worker,
    process: Launcher.command(
      "pnpm",
      [
        "exec",
        "tsx",
        entry,
        "serve-env",
        worker.key,
        String(port),
        "jobs-cache",
      ],
      { cwd: root, stdout: "inherit", stderr: "inherit" },
    ),
    ready: {
      services: [Jobs],
      timeout: "20 seconds",
    },
  });

  yield* Effect.logInfo("handoff waited on named ready.services Tags");
  yield* Node.shutdown(worker).pipe(Effect.ignore);
});
// ---cut-after---

NodeRuntime.runMain(
  program.pipe(Effect.scoped, Effect.provide(Launcher.layer)),
);
