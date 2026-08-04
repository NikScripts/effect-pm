/**
 * @module examples/launcher/token-injection
 *
 * `Launcher.command` can inject the assume token through the environment
 * (default) or argv. Both modes reach the same Ready → handoff path; only the
 * child token read changes.
 *
 * Run: `pnpm run example:launcher-token-injection`
 *
 * Docs: `docs/examples/launcher/token-injection.md` includes this file;
 * cut markers hide the module header and runner epilogue.
 */

// ---cut---
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Clock, Effect } from "effect";
import * as Launcher from "../../src/Launcher";
import * as Node from "../../src/Node";

const launchOne = (options: {
  readonly label: string;
  readonly token: Launcher.TokenInjection;
  readonly childMode: "serve-env" | "serve-argv";
  readonly entry: string;
  readonly root: string;
  readonly basePort: number;
}) =>
  Effect.gen(function* () {
    const worker = Node.Service()(`examples/launcher-token/${options.label}`, {
      url: `http://127.0.0.1:${String(options.basePort)}/rpc`,
      kind: "Http",
    });

    yield* Launcher.up({
      node: worker,
      process: Launcher.command(
        "pnpm",
        [
          "exec",
          "tsx",
          options.entry,
          options.childMode,
          worker.key,
          String(options.basePort),
          "jobs",
        ],
        {
          cwd: options.root,
          stdout: "inherit",
          stderr: "inherit",
          token: options.token,
        },
      ),
      ready: { timeout: "20 seconds" },
    });

    yield* Effect.logInfo(`${options.label}: Ready and handed off`);
    yield* Node.shutdown(worker).pipe(Effect.ignore);
  });

const program = Effect.gen(function* () {
  const root = new URL("../..", import.meta.url).pathname;
  const entry = `${root}/examples/launcher/ready-worker-child.ts`;
  const now = yield* Clock.currentTimeMillis;
  const basePort = 29_300 + (now % 200);

  yield* launchOne({
    label: "env-token",
    token: "env",
    childMode: "serve-env",
    entry,
    root,
    basePort,
  });
  yield* launchOne({
    label: "argv-token",
    token: "argv",
    childMode: "serve-argv",
    entry,
    root,
    basePort: basePort + 1,
  });
});
// ---cut-after---

NodeRuntime.runMain(
  program.pipe(Effect.scoped, Effect.provide(Launcher.layer)),
);
