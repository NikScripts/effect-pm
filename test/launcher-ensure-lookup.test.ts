/**
 * Launcher.ensureLookup — adopt live Lookup, spawn Lookup-only, fail closed.
 */
import { describe, expect, it } from "@effect/vitest";
import {
  Clock,
  Context,
  Duration,
  Effect,
  Layer,
  Option,
} from "effect";
import { ChildProcess } from "effect/unstable/process";
import * as Launcher from "../src/Launcher";
import * as Lookup from "../src/Lookup";
import * as Identity from "../src/Identity";
import * as Node from "../src/Node";
import { expectTaggedFailure } from "./fixtures/expectTaggedFailure";
import { platform } from "./fixtures/launcherHarness";

const tmpSock = (label: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return `/tmp/hyperlink-ts-ensure-lookup-${label}-${process.pid}-${now}.sock`;
  });

const lookupChildProcess = (root: string, path: string) =>
  Launcher.command(
    "pnpm",
    [
      "exec",
      "tsx",
      `${root}/test/fixtures/launcher-lookup-child.ts`,
      path,
    ],
    {
      cwd: root,
      stdout: "inherit",
      stderr: "inherit",
      token: "argv",
    },
  );

const reapLookupChildren = ChildProcess.make("pkill", [
  "-f",
  "test/fixtures/launcher-lookup-child.ts",
]).pipe(
  Effect.flatMap((h) => h.exitCode),
  Effect.ignore,
);

describe("Launcher.ensureLookup", () => {
  it.live("adopts Lookup already answering at path (no spawn)", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("adopt");
      const lookupNode = Node.Tag()("launcher/ensure-adopt", { path }).pipe(
        Node.asLookup,
      );
      yield* Layer.build(Lookup.layerNode(lookupNode, { unlink: true }));

      const result = yield* Launcher.ensureLookup({ path });
      expect(result.spawned).toBe(false);
      expect(result.path).toBe(path);

      const ctx = yield* Layer.build(Lookup.client(result.node));
      const id = Context.get(ctx, Identity.Tag);
      const resolved = yield* id
        .resolve(
          new Lookup.ResolveRequest({
            key: "launcher/ensure-adopt/probe",
          }),
        )
        .pipe(Effect.provide(ctx));
      expect(Option.isNone(resolved)).toBe(true);
    }).pipe(
      Effect.scoped,
      Effect.provide(platform),
      Effect.timeout(Duration.seconds(30)),
    ),
    { timeout: 30_000 },
  );

  it.live("spawns Lookup-only child when nothing is answering", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("spawn");
      const root = new URL("..", import.meta.url).pathname;

      const result = yield* Launcher.ensureLookup({
        path,
        process: lookupChildProcess(root, path),
        ready: { timeout: "25 seconds", poll: "100 millis" },
      });
      expect(result.spawned).toBe(true);
      expect(result.path).toBe(path);

      const ctx = yield* Layer.build(Lookup.client(result.node));
      const id = Context.get(ctx, Identity.Tag);
      const resolved = yield* id
        .resolve(
          new Lookup.ResolveRequest({
            key: "launcher/ensure-spawn/probe",
          }),
        )
        .pipe(Effect.provide(ctx));
      expect(Option.isNone(resolved)).toBe(true);

      yield* reapLookupChildren;
    }).pipe(
      Effect.scoped,
      Effect.provide(platform),
      Effect.timeout(Duration.seconds(45)),
    ),
    { timeout: 45_000 },
  );

  it.live("fails LookupNotRunning when down and process omitted", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("fail-closed");
      const exit = yield* Effect.exit(Launcher.ensureLookup({ path }));
      const err = expectTaggedFailure(exit, "LookupNotRunning");
      expect(
        typeof err === "object" &&
          err !== null &&
          "path" in err &&
          err.path === path,
      ).toBe(true);
    }).pipe(
      Effect.scoped,
      Effect.provide(platform),
      Effect.timeout(Duration.seconds(15)),
    ),
    { timeout: 15_000 },
  );

  it.live("fails LookupAddressRequired for unaddressed node without path", () =>
    Effect.gen(function* () {
      const bare = Node.Tag()("launcher/ensure-bare");
      const exit = yield* Effect.exit(
        Launcher.ensureLookup({ node: bare }),
      );
      expectTaggedFailure(exit, "LookupAddressRequired");
    }).pipe(
      Effect.scoped,
      Effect.provide(platform),
      Effect.timeout(Duration.seconds(10)),
    ),
    { timeout: 10_000 },
  );

  it.live("UpOptions.lookup runs ensure before app units", () =>
    Effect.gen(function* () {
      const path = yield* tmpSock("up-lookup");
      const lookupNode = Node.Tag()("launcher/ensure-up", { path }).pipe(
        Node.asLookup,
      );
      // Already up — up({ lookup }) should adopt, then we skip real app spawn
      // by using an empty unit list via ensureLookup alone through up's option
      // with zero app units: call ensure via up with empty array.
      yield* Layer.build(Lookup.layerNode(lookupNode, { unlink: true }));

      yield* Launcher.up([], {
        lookup: { path },
      });

      // Still answering after up (adopt path — no kill).
      const ctx = yield* Layer.build(Lookup.client(lookupNode));
      const id = Context.get(ctx, Identity.Tag);
      expect(
        Option.isNone(
          yield* id
            .resolve(new Lookup.ResolveRequest({ key: "x" }))
            .pipe(Effect.provide(ctx)),
        ),
      ).toBe(true);
    }).pipe(
      Effect.scoped,
      Effect.provide(platform),
      Effect.timeout(Duration.seconds(30)),
    ),
    { timeout: 30_000 },
  );
});
