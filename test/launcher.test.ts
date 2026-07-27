/**
 * `Launcher` Track A — mintToken, ReadyTimedOut (TestClock), custody handle phases,
 * spawn→awaitReady→handoff vs live child, and `up`.
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

const childEntry = () => {
  const root = new URL("..", import.meta.url).pathname;
  return {
    root,
    entry: `${root}/test/fixtures/launcher-child-serve.ts`,
  };
};

const ephemeralPort = (tokenHex: string): number =>
  20_000 + (Number.parseInt(tokenHex.slice(0, 4), 16) % 10_000);

const reapLauncherChildren = ChildProcess.make("pkill", [
  "-f",
  "test/fixtures/launcher-child-serve.ts",
]).pipe(
  Effect.flatMap((h) => h.exitCode),
  Effect.ignore,
);

describe("Launcher.mintToken", () => {
  it.effect("mints a redacted 32-byte hex token (CSPRNG)", () =>
    Effect.gen(function* () {
      const a = yield* Launcher.mintToken;
      const b = yield* Launcher.mintToken;
      expect(Redacted.isRedacted(a)).toBe(true);
      const clearA = Redacted.value(a);
      const clearB = Redacted.value(b);
      expect(clearA).toMatch(/^[0-9a-f]{64}$/);
      expect(clearB).toMatch(/^[0-9a-f]{64}$/);
      expect(clearA).not.toBe(clearB);
      expect(String(a)).not.toContain(clearA);
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
    "fails ChildExited when the OS child dies before Ready",
    () =>
      Effect.gen(function* () {
        const node = Node.Tag()("launcher/child-exits", {
          url: "http://127.0.0.1:1/rpc",
          kind: "Http",
        });
        const exit = yield* Launcher.spawn({
          node,
          process: ChildProcess.make("sh", ["-c", "exit 7"]),
          ready: { timeout: "25 seconds" },
        }).pipe(
          Effect.flatMap((handle) => handle.awaitReady()),
          Effect.exit,
        );
        const err = expectTaggedFailure(exit, "ChildExited");
        expect(
          typeof err === "object" &&
            err !== null &&
            "code" in err &&
            err.code === 7,
        ).toBe(true);
      }).pipe(Effect.scoped, Effect.provide(platform)),
    { timeout: 20_000 },
  );

  it.live(
    "spawn → awaitReady → handoff against a child that listens with assumeToken",
    () =>
      Effect.gen(function* () {
        const { root, entry } = childEntry();
        const tokenHex = Redacted.value(yield* Launcher.mintToken);
        const port = ephemeralPort(tokenHex);
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
          ready: {
            timeout: "25 seconds",
            resources: ["launcher-child/Jobs"],
          },
        });

        yield* handle.awaitReady();
        // Idempotent Ready re-check.
        yield* handle.awaitReady();
        yield* handle.handoff();
        yield* reapLauncherChildren;
      }).pipe(Effect.scoped, Effect.provide(platform)),
    { timeout: 45_000 },
  );
});

describe("Launcher.Handle.handoff", () => {
  it.live(
    "fails HandleNotReady before awaitReady",
    () =>
      Effect.gen(function* () {
        const node = Node.Tag()("launcher/not-ready-handoff", {
          url: "http://127.0.0.1:1/rpc",
          kind: "Http",
        });
        const handle = yield* Launcher.spawn({
          node,
          process: ChildProcess.make("sleep", ["30"]),
        });
        const exit = yield* Effect.exit(handle.handoff());
        expectTaggedFailure(exit, "HandleNotReady");
        // Kill the sleep child via Scope close (scoped).
      }).pipe(Effect.scoped, Effect.provide(platform)),
    { timeout: 15_000 },
  );

  it.live(
    "fails HandleSpent after a successful handoff",
    () =>
      Effect.gen(function* () {
        const { root, entry } = childEntry();
        const tokenHex = Redacted.value(yield* Launcher.mintToken);
        const port = ephemeralPort(tokenHex) + 1;
        const node = Node.Tag()("launcher/spent", {
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
        const spentHandoff = yield* Effect.exit(handle.handoff());
        expectTaggedFailure(spentHandoff, "HandleSpent");
        const spentReady = yield* Effect.exit(handle.awaitReady());
        expectTaggedFailure(spentReady, "HandleSpent");
        yield* reapLauncherChildren;
      }).pipe(Effect.scoped, Effect.provide(platform)),
    { timeout: 45_000 },
  );
});

describe("Launcher.up", () => {
  it.live(
    "spawn → awaitReady → handoff then exits (one-shot)",
    () =>
      Effect.gen(function* () {
        const { root, entry } = childEntry();
        const tokenHex = Redacted.value(yield* Launcher.mintToken);
        const port = ephemeralPort(tokenHex) + 2;
        const node = Node.Tag()("launcher/up", {
          url: `http://127.0.0.1:${String(port)}/rpc`,
          kind: "Http",
        });

        yield* Launcher.up({
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
        yield* reapLauncherChildren;
      }).pipe(Effect.scoped, Effect.provide(platform)),
    { timeout: 45_000 },
  );
});
