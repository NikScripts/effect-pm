/**
 * Launcher already-up Policy — default fail (NodeAlreadyUp); opt-in adopt on up.
 */
import { describe, expect, it } from "@effect/vitest";
import { Effect, Redacted } from "effect";
import * as Launcher from "../src/Launcher";
import * as Node from "../src/Node";
import { expectTaggedFailure } from "./fixtures/expectTaggedFailure";
import {
  childArgvProcess,
  childEntryPaths,
  ephemeralPort,
  platform,
  reapLauncherChildren,
} from "./fixtures/launcherHarness";

const providePlatform = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.scoped, Effect.provide(platform));

describe("Launcher already-up Policy", () => {
  it.live(
    "spawn fails NodeAlreadyUp when dial target is already Ready",
    () =>
      Effect.gen(function* () {
        const { root, entry } = childEntryPaths();
        const tokenHex = Redacted.value(yield* Launcher.mintToken);
        const port = ephemeralPort(tokenHex, 11);
        const node = Node.Tag()("launcher/already-up-spawn", {
          url: `http://127.0.0.1:${String(port)}/rpc`,
          kind: "Http",
        });

        const first = yield* Launcher.spawn({
          node,
          process: childArgvProcess(root, entry, port),
          ready: { timeout: "25 seconds" },
        });
        yield* first.awaitReady();
        yield* first.handoff();

        const exit = yield* Effect.exit(
          Launcher.spawn({
            node,
            process: childArgvProcess(root, entry, port),
            ready: { timeout: "25 seconds" },
          }),
        );
        const err = expectTaggedFailure(exit, "NodeAlreadyUp");
        expect(
          typeof err === "object" &&
            err !== null &&
            "node" in err &&
            err.node === "launcher/already-up-spawn",
        ).toBe(true);

        yield* reapLauncherChildren;
      }).pipe(providePlatform),
    { timeout: 45_000 },
  );

  it.live(
    "up default fails NodeAlreadyUp when peer is Ready",
    () =>
      Effect.gen(function* () {
        const { root, entry } = childEntryPaths();
        const tokenHex = Redacted.value(yield* Launcher.mintToken);
        const port = ephemeralPort(tokenHex, 12);
        const node = Node.Tag()("launcher/already-up-fail", {
          url: `http://127.0.0.1:${String(port)}/rpc`,
          kind: "Http",
        });
        const unit = {
          node,
          process: childArgvProcess(root, entry, port),
          ready: { timeout: "25 seconds" as const },
        };

        yield* Launcher.up(unit);
        const exit = yield* Effect.exit(Launcher.up(unit));
        expectTaggedFailure(exit, "NodeAlreadyUp");

        yield* reapLauncherChildren;
      }).pipe(providePlatform),
    { timeout: 45_000 },
  );

  it.live(
    "up alreadyUp: adopt skips spawn when peer is Ready",
    () =>
      Effect.gen(function* () {
        const { root, entry } = childEntryPaths();
        const tokenHex = Redacted.value(yield* Launcher.mintToken);
        const port = ephemeralPort(tokenHex, 13);
        const node = Node.Tag()("launcher/already-up-adopt", {
          url: `http://127.0.0.1:${String(port)}/rpc`,
          kind: "Http",
        });
        const unit = {
          node,
          process: childArgvProcess(root, entry, port),
          ready: { timeout: "25 seconds" as const },
        };

        yield* Launcher.up(unit);
        // Second up adopts — no second child, no error.
        yield* Launcher.up(unit, { alreadyUp: "adopt" });

        yield* reapLauncherChildren;
      }).pipe(providePlatform),
    { timeout: 45_000 },
  );

  it.live(
    "SpawnSpec.alreadyUp adopt overrides UpOptions default fail",
    () =>
      Effect.gen(function* () {
        const { root, entry } = childEntryPaths();
        const tokenHex = Redacted.value(yield* Launcher.mintToken);
        const port = ephemeralPort(tokenHex, 14);
        const node = Node.Tag()("launcher/already-up-unit", {
          url: `http://127.0.0.1:${String(port)}/rpc`,
          kind: "Http",
        });

        yield* Launcher.up({
          node,
          process: childArgvProcess(root, entry, port),
          ready: { timeout: "25 seconds" },
        });

        yield* Launcher.up(
          {
            node,
            process: childArgvProcess(root, entry, port),
            ready: { timeout: "25 seconds" },
            alreadyUp: "adopt",
          },
          { alreadyUp: "fail" },
        );

        yield* reapLauncherChildren;
      }).pipe(providePlatform),
    { timeout: 45_000 },
  );
});
