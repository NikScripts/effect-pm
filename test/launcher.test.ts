/**
 * `Launcher` Track A — mintToken, Ready/handoff/kill phases, command/entry factories,
 * Config-at-spawn, multi-unit `up`, and live child handoff.
 */
import { describe, expect, it } from "@effect/vitest";
import {
  ConfigProvider,
  Duration,
  Effect,
  Fiber,
  Layer,
  Redacted,
} from "effect";
import { TestClock } from "effect/testing";
import { ChildProcess } from "effect/unstable/process";
import * as Launcher from "../src/Launcher";
import * as Node from "../src/Node";
import { expectTaggedFailure } from "./fixtures/expectTaggedFailure";
import {
  asStandard,
  ChildJobs,
  childArgvProcess,
  childEntryPaths,
  ephemeralPort,
  platform,
  reapLauncherChildren,
} from "./fixtures/launcherHarness";

const providePlatform = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
) => effect.pipe(Effect.scoped, Effect.provide(platform));

const provideTestClock = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
) =>
  effect.pipe(
    Effect.scoped,
    Effect.provide(Layer.mergeAll(TestClock.layer(), platform)),
  );

describe("Launcher.mintToken", () => {
  it.effect("mints a redacted 32-byte hex branded token (CSPRNG)", () =>
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

describe("Launcher.readyTimeoutConfig / readyPollConfig", () => {
  it.effect("defaults to 30s / 100ms when Config is unset", () =>
    Effect.gen(function* () {
      const timeout = yield* Launcher.readyTimeoutConfig;
      const poll = yield* Launcher.readyPollConfig;
      expect(Duration.toMillis(timeout)).toBe(30_000);
      expect(Duration.toMillis(poll)).toBe(100);
    }).pipe(
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown({}),
      ),
    ),
  );

  it.effect("reads HYPERLINK_LAUNCHER_READY_* from ConfigProvider", () =>
    Effect.gen(function* () {
      const timeout = yield* Launcher.readyTimeoutConfig;
      const poll = yield* Launcher.readyPollConfig;
      expect(Duration.toMillis(timeout)).toBe(5_000);
      expect(Duration.toMillis(poll)).toBe(250);
    }).pipe(
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown({
          HYPERLINK_LAUNCHER_READY_TIMEOUT: "5 seconds",
          HYPERLINK_LAUNCHER_READY_POLL: "250 millis",
        }),
      ),
    ),
  );
});

describe("Launcher.Handle.awaitReady", () => {
  it.effect(
    "fails ReadyTimedOut, kill-reaps the child, and spends the handle (TestClock)",
    () =>
      Effect.gen(function* () {
        const node = Node.Tag()("launcher/unreachable", {
          url: "http://127.0.0.1:1/rpc",
          kind: "Http",
        });
        // spawn probes already-up via Ready dial (2s Clock timeout) before custody.
        const spawnFiber = yield* Effect.forkChild(
          Launcher.spawn({
            node,
            process: ChildProcess.make("sleep", ["120"]),
            ready: {
              timeout: "30 seconds",
              services: ["missing/Service"],
            },
          }),
        );
        yield* Effect.yieldNow;
        yield* TestClock.adjust("2 seconds");
        const handle = yield* Fiber.join(spawnFiber);
        const fiber = yield* Effect.forkChild(
          handle.awaitReady().pipe(Effect.exit),
        );
        yield* Effect.yieldNow;
        yield* TestClock.adjust("30 seconds");
        const exit = yield* Fiber.join(fiber);
        const err = expectTaggedFailure(exit, "ReadyTimedOut");
        expect(
          typeof err === "object" &&
            err !== null &&
            "node" in err &&
            err.node === "launcher/unreachable" &&
            "services" in err &&
            Array.isArray(err.services) &&
            err.services[0] === "missing/Service",
        ).toBe(true);

        expectTaggedFailure(
          yield* Effect.exit(handle.awaitReady()),
          "HandleSpent",
        );
        expectTaggedFailure(yield* Effect.exit(handle.kill()), "HandleSpent");
        expectTaggedFailure(
          yield* Effect.exit(handle.handoff()),
          "HandleSpent",
        );
      }).pipe(provideTestClock),
  );

  it.effect("fails UnaddressedNode for a bare (unaddressed) dial target", () =>
    Effect.gen(function* () {
      const bare = Node.Tag()("launcher/bare");
      const handle = yield* Launcher.spawn({
        node: bare,
        process: ChildProcess.make("sleep", ["30"]),
        ready: { timeout: "5 seconds" },
      });
      const exit = yield* Effect.exit(handle.awaitReady());
      expectTaggedFailure(exit, "UnaddressedNode");
      yield* handle.kill();
    }).pipe(providePlatform),
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
      }).pipe(providePlatform),
    { timeout: 20_000 },
  );

  it.live(
    "spawn → awaitReady → handoff with Tag-typed ready.services",
    () =>
      Effect.gen(function* () {
        const { root, entry } = childEntryPaths();
        const tokenHex = Redacted.value(yield* Launcher.mintToken);
        const port = ephemeralPort(tokenHex);
        const node = Node.Tag()("launcher/child", {
          url: `http://127.0.0.1:${String(port)}/rpc`,
          kind: "Http",
        });

        const handle = yield* Launcher.spawn({
          node,
          process: childArgvProcess(root, entry, port),
          ready: {
            timeout: "25 seconds",
            poll: "50 millis",
            services: [ChildJobs],
          },
        });

        expect(Redacted.isRedacted(handle.token)).toBe(true);
        expect(handle.node.key).toBe("launcher/child");

        yield* handle.awaitReady();
        // Idempotent Ready re-check.
        yield* handle.awaitReady();
        yield* handle.handoff();
        yield* reapLauncherChildren;
      }).pipe(providePlatform),
    { timeout: 45_000 },
  );

  it.live(
    "ready.services accepts a wire-key string",
    () =>
      Effect.gen(function* () {
        const { root, entry } = childEntryPaths();
        const tokenHex = Redacted.value(yield* Launcher.mintToken);
        const port = ephemeralPort(tokenHex, 3);
        const node = Node.Tag()("launcher/child-wire", {
          url: `http://127.0.0.1:${String(port)}/rpc`,
          kind: "Http",
        });

        const handle = yield* Launcher.spawn({
          node,
          process: childArgvProcess(root, entry, port),
          ready: {
            timeout: "25 seconds",
            services: ["launcher-child/Jobs"],
          },
        });
        yield* handle.awaitReady();
        yield* handle.handoff();
        yield* reapLauncherChildren;
      }).pipe(providePlatform),
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
        expectTaggedFailure(
          yield* Effect.exit(handle.handoff()),
          "HandleNotReady",
        );
        yield* handle.kill();
      }).pipe(providePlatform),
    { timeout: 15_000 },
  );

  it.live(
    "fails HandleSpent after a successful handoff",
    () =>
      Effect.gen(function* () {
        const { root, entry } = childEntryPaths();
        const tokenHex = Redacted.value(yield* Launcher.mintToken);
        const port = ephemeralPort(tokenHex, 1);
        const node = Node.Tag()("launcher/spent", {
          url: `http://127.0.0.1:${String(port)}/rpc`,
          kind: "Http",
        });

        const handle = yield* Launcher.spawn({
          node,
          process: childArgvProcess(root, entry, port),
          ready: { timeout: "25 seconds" },
        });

        yield* handle.awaitReady();
        yield* handle.handoff();
        expectTaggedFailure(
          yield* Effect.exit(handle.handoff()),
          "HandleSpent",
        );
        expectTaggedFailure(
          yield* Effect.exit(handle.awaitReady()),
          "HandleSpent",
        );
        expectTaggedFailure(yield* Effect.exit(handle.kill()), "HandleSpent");
        yield* reapLauncherChildren;
      }).pipe(providePlatform),
    { timeout: 45_000 },
  );

  it.live(
    "fails AssumeTokenMismatch when handoff uses a wrong token",
    () =>
      Effect.gen(function* () {
        const { root, entry } = childEntryPaths();
        const tokenHex = Redacted.value(yield* Launcher.mintToken);
        const port = ephemeralPort(tokenHex, 4);
        const node = Node.Tag()("launcher/mismatch", {
          url: `http://127.0.0.1:${String(port)}/rpc`,
          kind: "Http",
        });

        // Spawn with a forged factory so the child gets token A, handle holds token B.
        const forged = (injected: string) =>
          ChildProcess.make(
            "pnpm",
            ["exec", "tsx", entry, String(port), injected],
            {
              cwd: root,
              stdout: "inherit",
              stderr: "inherit",
            },
          );

        const handle = yield* Launcher.spawn({
          node,
          process: (_ignored) => forged("not-the-handle-token"),
          ready: { timeout: "25 seconds" },
        });
        yield* handle.awaitReady();
        expectTaggedFailure(
          yield* Effect.exit(handle.handoff()),
          "AssumeTokenMismatch",
        );
        yield* handle.kill();
        yield* reapLauncherChildren;
      }).pipe(providePlatform),
    { timeout: 45_000 },
  );
});

describe("Launcher.Handle.kill", () => {
  it.live(
    "SIGTERMs the child and spends the handle",
    () =>
      Effect.gen(function* () {
        const node = Node.Tag()("launcher/kill", {
          url: "http://127.0.0.1:1/rpc",
          kind: "Http",
        });
        const handle = yield* Launcher.spawn({
          node,
          process: ChildProcess.make("sleep", ["120"]),
        });
        yield* handle.kill();
        expectTaggedFailure(
          yield* Effect.exit(handle.awaitReady()),
          "HandleSpent",
        );
        expectTaggedFailure(
          yield* Effect.exit(handle.handoff()),
          "HandleSpent",
        );
        expectTaggedFailure(yield* Effect.exit(handle.kill()), "HandleSpent");
      }).pipe(providePlatform),
    { timeout: 15_000 },
  );

  it.live(
    "kill after Ready (before handoff) spends the handle",
    () =>
      Effect.gen(function* () {
        const { root, entry } = childEntryPaths();
        const tokenHex = Redacted.value(yield* Launcher.mintToken);
        const port = ephemeralPort(tokenHex, 5);
        const node = Node.Tag()("launcher/kill-ready", {
          url: `http://127.0.0.1:${String(port)}/rpc`,
          kind: "Http",
        });
        const handle = yield* Launcher.spawn({
          node,
          process: childArgvProcess(root, entry, port),
          ready: { timeout: "25 seconds" },
        });
        yield* handle.awaitReady();
        yield* handle.kill();
        expectTaggedFailure(
          yield* Effect.exit(handle.handoff()),
          "HandleSpent",
        );
        yield* reapLauncherChildren;
      }).pipe(providePlatform),
    { timeout: 45_000 },
  );
});

describe("Launcher.command / entry", () => {
  it("injects HYPERLINK_ASSUME_TOKEN into env by default", () => {
    const built = asStandard(
      Launcher.command("node", ["./worker.js"], { cwd: "/tmp" })(
        "secret-token",
      ),
    );
    expect(built.options.env?.["HYPERLINK_ASSUME_TOKEN"]).toBe("secret-token");
    expect(built.args).toEqual(["./worker.js"]);
  });

  it("appends token to argv when token: \"argv\" and leaves env alone", () => {
    const built = asStandard(
      Launcher.command("node", ["./worker.js"], { token: "argv" })(
        "secret-token",
      ),
    );
    expect(built.args.at(-1)).toBe("secret-token");
    expect(built.options.env?.["HYPERLINK_ASSUME_TOKEN"]).toBeUndefined();
  });

  it("injects both env and argv when token: \"both\"", () => {
    const built = asStandard(
      Launcher.command("node", ["./worker.js"], { token: "both" })(
        "secret-token",
      ),
    );
    expect(built.args.at(-1)).toBe("secret-token");
    expect(built.options.env?.["HYPERLINK_ASSUME_TOKEN"]).toBe("secret-token");
  });

  it("inserts token at tokenArgvAt", () => {
    const built = asStandard(
      Launcher.command("node", ["./worker.js", "--port", "1"], {
        token: "argv",
        tokenArgvAt: 1,
      })("secret-token"),
    );
    expect(built.args).toEqual([
      "./worker.js",
      "secret-token",
      "--port",
      "1",
    ]);
  });

  it("entry defaults to node + path", () => {
    const built = asStandard(Launcher.entry("./worker.js")("secret-token"));
    expect(built.command).toBe("node");
    expect(built.args).toEqual(["./worker.js"]);
    expect(built.options.env?.["HYPERLINK_ASSUME_TOKEN"]).toBe("secret-token");
  });

  it("entry builds exec + execArgs + path with argv token", () => {
    const built = asStandard(
      Launcher.entry("./worker.ts", {
        exec: "pnpm",
        execArgs: ["exec", "tsx"],
        token: "argv",
      })("secret-token"),
    );
    expect(built.command).toBe("pnpm");
    expect(built.args).toEqual([
      "exec",
      "tsx",
      "./worker.ts",
      "secret-token",
    ]);
  });
});

describe("Launcher.up", () => {
  it.live(
    "spawn → awaitReady → handoff then exits (one-shot)",
    () =>
      Effect.gen(function* () {
        const { root, entry } = childEntryPaths();
        const tokenHex = Redacted.value(yield* Launcher.mintToken);
        const port = ephemeralPort(tokenHex, 2);
        const node = Node.Tag()("launcher/up", {
          url: `http://127.0.0.1:${String(port)}/rpc`,
          kind: "Http",
        });

        yield* Launcher.up({
          node,
          process: childArgvProcess(root, entry, port),
          ready: { timeout: "25 seconds" },
        });
        yield* reapLauncherChildren;
      }).pipe(providePlatform),
    { timeout: 45_000 },
  );

  it.effect("runs a multi-unit array sequentially by default (TestClock)", () =>
    Effect.gen(function* () {
      const a = Node.Tag()("launcher/up-a", {
        url: "http://127.0.0.1:1/rpc",
        kind: "Http",
      });
      const b = Node.Tag()("launcher/up-b", {
        url: "http://127.0.0.1:1/rpc",
        kind: "Http",
      });
      const fiber = yield* Effect.forkChild(
        Launcher.up(
          [
            {
              node: a,
              process: ChildProcess.make("sleep", ["120"]),
              ready: { timeout: "5 seconds" },
            },
            {
              node: b,
              process: ChildProcess.make("sleep", ["120"]),
              ready: { timeout: "5 seconds" },
            },
          ],
          { concurrency: 1 },
        ).pipe(Effect.exit),
      );
      yield* Effect.yieldNow;
      // already-up probe (2s) then Ready timeout on first unit (5s).
      yield* TestClock.adjust("2 seconds");
      yield* TestClock.adjust("5 seconds");
      const exit = yield* Fiber.join(fiber);
      // First unit times out; sequential so second never starts custody.
      expectTaggedFailure(exit, "ReadyTimedOut");
    }).pipe(provideTestClock),
  );

  it.effect("honors concurrency > 1 across independent units (TestClock)", () =>
    Effect.gen(function* () {
      const a = Node.Tag()("launcher/up-conc-a", {
        url: "http://127.0.0.1:1/rpc",
        kind: "Http",
      });
      const b = Node.Tag()("launcher/up-conc-b", {
        url: "http://127.0.0.1:1/rpc",
        kind: "Http",
      });
      const fiber = yield* Effect.forkChild(
        Launcher.up(
          [
            {
              node: a,
              process: ChildProcess.make("sleep", ["120"]),
              ready: { timeout: "5 seconds" },
            },
            {
              node: b,
              process: ChildProcess.make("sleep", ["120"]),
              ready: { timeout: "5 seconds" },
            },
          ],
          { concurrency: 2 },
        ).pipe(Effect.exit),
      );
      yield* Effect.yieldNow;
      // concurrent already-up probes (2s) then Ready timeouts (5s).
      yield* TestClock.adjust("2 seconds");
      yield* TestClock.adjust("5 seconds");
      const exit = yield* Fiber.join(fiber);
      expectTaggedFailure(exit, "ReadyTimedOut");
    }).pipe(provideTestClock),
  );
});

describe("Launcher.layer", () => {
  it.live(
    "provides ChildProcessSpawner for spawn",
    () =>
      Effect.gen(function* () {
        const node = Node.Tag()("launcher/layer", {
          url: "http://127.0.0.1:1/rpc",
          kind: "Http",
        });
        const handle = yield* Launcher.spawn({
          node,
          process: ChildProcess.make("sleep", ["5"]),
        });
        yield* handle.kill();
      }).pipe(Effect.scoped, Effect.provide(Launcher.layer)),
    { timeout: 15_000 },
  );
});
