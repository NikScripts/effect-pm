/**
 * @module examples/launcher/handle-phases
 *
 * The explicit Launcher handle phases: `spawn`, `awaitReady`, `handoff`, and
 * `kill`. A handed-off handle is spent, so the kill phase uses a second child
 * that has not been handed off.
 *
 * Run: `pnpm run example:launcher-handle-phases`
 *
 * Docs: `docs/examples/launcher/handle-phases.md` includes this file;
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
  const readyPort = 29_100 + (now % 200);
  const killPort = readyPort + 1;

  const readyWorker = Node.Service()("examples/launcher-phases/ReadyWorker", {
    url: `http://127.0.0.1:${String(readyPort)}/rpc`,
    kind: "Http",
  });
  const killWorker = Node.Service()("examples/launcher-phases/KillWorker", {
    url: `http://127.0.0.1:${String(killPort)}/rpc`,
    kind: "Http",
  });

  const handle = yield* Launcher.spawn({
    node: readyWorker,
    process: Launcher.command(
      "pnpm",
      [
        "exec",
        "tsx",
        entry,
        "serve-env",
        readyWorker.key,
        String(readyPort),
        "jobs",
      ],
      { cwd: root, stdout: "inherit", stderr: "inherit" },
    ),
    ready: { timeout: "20 seconds" },
  });
  yield* Effect.logInfo("phase: spawned");

  yield* handle.awaitReady();
  yield* Effect.logInfo("phase: ready");

  yield* handle.handoff();
  yield* Effect.logInfo("phase: handed off");
  yield* Node.shutdown(readyWorker).pipe(Effect.ignore);

  const killHandle = yield* Launcher.spawn({
    node: killWorker,
    process: Launcher.command(
      "pnpm",
      ["exec", "tsx", entry, "never"],
      { cwd: root, stdout: "inherit", stderr: "inherit" },
    ),
    ready: { timeout: "5 seconds" },
  });
  yield* killHandle.kill();
  yield* Effect.logInfo("phase: killed");
});
// ---cut-after---

NodeRuntime.runMain(
  program.pipe(Effect.scoped, Effect.provide(Launcher.layer)),
);
