/**
 * `Launcher` Track A — mintToken, ReadyTimedOut (TestClock), spawn→awaitReady→handoff vs live child.
 */
import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Redacted } from "effect";
import { TestClock } from "effect/testing";
import { ChildProcess } from "effect/unstable/process";
import * as Launcher from "../src/Launcher";
import * as Node from "../src/Node";
import { expectTaggedFailure } from "./fixtures/expectTaggedFailure";

const platform = Layer.provideMerge(
  NodeChildProcessSpawner.layer,
  NodeServices.layer,
);

describe("Launcher.mintToken", () => {
  it.effect("mints a redacted 32-byte hex token", () =>
    Effect.gen(function* () {
      const token = yield* Launcher.mintToken;
      expect(Redacted.isRedacted(token)).toBe(true);
      const clear = Redacted.value(token);
      expect(clear).toMatch(/^[0-9a-f]{64}$/);
      expect(String(token)).not.toContain(clear);
    }),
  );
});

describe("Launcher.Handle.awaitReady", () => {
  it.effect("fails ReadyTimedOut when the peer never answers (TestClock)", () =>
    Effect.gen(function* () {
      const node = Node.Tag()("launcher/unreachable", {
        url: "http://127.0.0.1:1/rpc",
        kind: "Http",
      });
      const fiber = yield* Effect.forkChild(
        Launcher.spawn({
          node,
          process: ChildProcess.make("sleep", ["120"]),
          ready: { timeout: "30 seconds" },
        }).pipe(
          Effect.flatMap((handle) => handle.awaitReady()),
          Effect.exit,
        ),
      );
      yield* Effect.yieldNow;
      yield* TestClock.adjust("30 seconds");
      const exit = yield* Fiber.join(fiber);
      expectTaggedFailure(exit, "ReadyTimedOut");
    }).pipe(
      Effect.scoped,
      Effect.provide(Layer.mergeAll(TestClock.layer(), platform)),
    ),
  );

  it.live(
    "spawn → awaitReady → handoff against a child that listens with assumeToken",
    () =>
      Effect.gen(function* () {
        const root = new URL("..", import.meta.url).pathname;
        const entry = `${root}/test/fixtures/launcher-child-serve.ts`;
        // Ephemeral-ish high port from token bytes (avoid fixed-port collisions).
        const tokenHex = Redacted.value(yield* Launcher.mintToken);
        const port = 20_000 + (Number.parseInt(tokenHex.slice(0, 4), 16) % 10_000);
        const node = Node.Tag()("launcher/child", {
          url: `http://127.0.0.1:${String(port)}/rpc`,
          kind: "Http",
        });

        const handle = yield* Launcher.spawn({
          node,
          process: (token) =>
            ChildProcess.make(
              "pnpm",
              ["exec", "tsx", entry, String(port), token],
              {
                cwd: root,
                stdout: "inherit",
                stderr: "inherit",
              },
            ),
          ready: { timeout: "25 seconds" },
        });

        yield* handle.awaitReady();
        yield* handle.handoff();
        // Child is unref'd after handoff (by design); reap the fixture so vitest can exit.
        yield* ChildProcess.make("pkill", [
          "-f",
          "test/fixtures/launcher-child-serve.ts",
        ]).pipe(
          Effect.flatMap((h) => h.exitCode),
          Effect.ignore,
        );
      }).pipe(Effect.scoped, Effect.provide(platform)),
    { timeout: 45_000 },
  );
});
