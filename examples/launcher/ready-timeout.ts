/**
 * @module examples/launcher/ready-timeout
 *
 * Launcher errors are typed. Assert on `_tag`, not message strings: a child
 * that never serves times out as `ReadyTimedOut`, and a child that exits while
 * Ready is pending fails as `ChildExited`.
 *
 * Run: `pnpm run example:launcher-ready-timeout`
 *
 * Docs: `docs/examples/launcher/ready-timeout.md` includes this file;
 * cut markers hide the module header and runner epilogue.
 */

// ---cut---
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Clock, Effect } from "effect";
import * as Launcher from "../../src/Launcher";
import * as Node from "../../src/Node";

const tagOf = (error: unknown): string =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  typeof error._tag === "string"
    ? error._tag
    : "Unknown";

const program = Effect.gen(function* () {
  const root = new URL("../..", import.meta.url).pathname;
  const entry = `${root}/examples/launcher/ready-worker-child.ts`;
  const now = yield* Clock.currentTimeMillis;
  const timeoutPort = 29_700 + (now % 200);
  const exitPort = timeoutPort + 1;

  const timeoutNode = Node.Tag()("examples/launcher-timeout/Timeout", {
    url: `http://127.0.0.1:${String(timeoutPort)}/rpc`,
    kind: "Http",
  });
  const timeoutTag = yield* Launcher.spawn({
    node: timeoutNode,
    process: Launcher.command(
      "pnpm",
      ["exec", "tsx", entry, "never"],
      { cwd: root, stdout: "inherit", stderr: "inherit" },
    ),
    ready: { timeout: "250 millis", poll: "50 millis" },
  }).pipe(
    Effect.flatMap((handle) => handle.awaitReady()),
    Effect.flip,
    Effect.map(tagOf),
  );

  const exitNode = Node.Tag()("examples/launcher-timeout/Exit", {
    url: `http://127.0.0.1:${String(exitPort)}/rpc`,
    kind: "Http",
  });
  const exitTag = yield* Launcher.spawn({
    node: exitNode,
    process: Launcher.command(
      "pnpm",
      ["exec", "tsx", entry, "exit"],
      { cwd: root, stdout: "inherit", stderr: "inherit" },
    ),
    ready: { timeout: "5 seconds", poll: "50 millis" },
  }).pipe(
    Effect.flatMap((handle) => handle.awaitReady()),
    Effect.flip,
    Effect.map(tagOf),
  );

  yield* Effect.logInfo(`timeout path: ${timeoutTag}`);
  yield* Effect.logInfo(`child-exit path: ${exitTag}`);
  if (timeoutTag !== "ReadyTimedOut" || exitTag !== "ChildExited") {
    return yield* Effect.die(
      new Error(`expected ReadyTimedOut/ChildExited, got ${timeoutTag}/${exitTag}`),
    );
  }
});
// ---cut-after---

NodeRuntime.runMain(
  program.pipe(Effect.scoped, Effect.provide(Launcher.layer)),
);
