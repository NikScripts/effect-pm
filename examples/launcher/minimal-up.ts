/**
 * @module examples/launcher/minimal-up
 *
 * Minimal Launcher custody: spawn a child, wait for Ready, hand off ownership,
 * then let the launcher exit. The example shuts the child down afterward so the
 * smoke run leaves no process behind.
 *
 * Run: `pnpm run example:launcher-minimal-up`
 *
 * Docs: `docs/examples/launcher/minimal-up.md` includes this file;
 * cut markers hide the module header and runner epilogue.
 */

// ---cut---
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Clock, Effect } from "effect";
import * as Launcher from "../../src/Launcher";
import * as Node from "../../src/Node";

const program = Effect.gen(function* () {
  const root = new URL("../..", import.meta.url).pathname;
  const entry = `${root}/examples/launcher/ready-worker-child.ts`;
  const now = yield* Clock.currentTimeMillis;
  const port = 28_900 + (now % 200);
  const worker = Node.Service()("examples/launcher-minimal/Worker", {
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
        "jobs",
      ],
      { cwd: root, stdout: "inherit", stderr: "inherit" },
    ),
    ready: { timeout: "20 seconds" },
  });

  yield* Effect.logInfo("launcher spawned, observed Ready, handed off");
  yield* Node.shutdown(worker).pipe(Effect.ignore);
});
// ---cut-after---

NodeRuntime.runMain(
  program.pipe(Effect.scoped, Effect.provide(Launcher.layer)),
);
