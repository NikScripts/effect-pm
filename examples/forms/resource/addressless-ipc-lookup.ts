/**
 * @module examples/forms/resource/addressless-ipc-lookup
 *
 * **Address-less IPC Node — two OS processes find each other via Lookup.**
 *
 * `Worker` has **no path in source**. `Resource.listen` mints an ephemeral Unix
 * socket, claims `Worker.key` at Lookup, advertises `Jobs`. The client process
 * only dials Lookup — `lookupClient(Jobs)` resolves the minted endpoint.
 *
 * ```text
 * Process A (serve)                 Process B (call)
 * ─────────────────                 ────────────────
 * bootstrap Lookup ──┐
 * listen(Worker, …) ─┼─ ipc Lookup ─┤ bootstrap Lookup (dial)
 *   mint /tmp/….sock │              lookupClient(Jobs)
 *   claim Worker.key │              jobs.jobs → 42
 *   advertise Jobs   ┘
 * ```
 *
 * Run both roles:
 *   `pnpm run example:addressless-ipc-lookup`
 *
 * Or separately (same `LOOKUP_SOCK`):
 *   `tsx examples/forms/resource/addressless-ipc-lookup.ts serve`
 *   `tsx examples/forms/resource/addressless-ipc-lookup.ts call`
 */

import { fileURLToPath } from "node:url";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  Clock,
  Config,
  Context,
  Duration,
  Effect,
  Layer,
  Schema,
  Stream,
} from "effect";
import { ChildProcess } from "effect/unstable/process";
import * as Lookup from "../../../src/Lookup";
import * as Resource from "../../../src/Resource";

// ── shared contract (both processes import the same Tags) ──

class Jobs extends Resource.Tag<Jobs>()("demo/Jobs", {
  jobs: Resource.effect(Schema.Number),
}) {}

/** Address-less — no `{ path }` / url. listen mints ipc + claims this key. */
class Worker extends Resource.Node<Worker, Jobs>("demo/Worker") {}

const selfPath = fileURLToPath(import.meta.url);

const lookupSockConfig = Config.string("LOOKUP_SOCK").pipe(
  Config.withDefault("/tmp/effect-pm-addressless-demo.sock"),
);

// ── serve runtime ──

const serveProgram = Effect.gen(function* () {
  const lookupSock = yield* lookupSockConfig;
  const lookup = Lookup.bootstrapDefaultLocal({
    path: lookupSock,
    unlink: true,
  });

  const live = Resource.listen(Worker, [
    Resource.serve(Jobs, { jobs: Effect.succeed(42) }),
  ]).pipe(Layer.provide(lookup));

  const ctx = yield* Layer.build(live);
  const node = Context.get(ctx, Resource.ListenNode);

  yield* Effect.logInfo(
    `serve: Lookup=${lookupSock} ListenNode=${node.key} path=${String(node.path)}`,
  );
  yield* Effect.logInfo("serve: ready — holding until interrupt");
  return yield* Effect.never;
}).pipe(Effect.scoped);

// ── call runtime ──

const callProgram = Effect.gen(function* () {
  const lookupSock = yield* lookupSockConfig;
  const lookup = Lookup.bootstrapDefaultLocal({
    path: lookupSock,
    unlink: false,
  });

  yield* Effect.sleep(Duration.millis(300));

  const clientCtx = yield* Layer.build(
    Resource.lookupClient(Jobs).pipe(Layer.provide(lookup)),
  );

  const n = yield* Effect.gen(function* () {
    const jobs = yield* Jobs;
    return yield* jobs.jobs;
  }).pipe(Effect.provide(clientCtx));

  yield* Effect.logInfo(`call: jobs.jobs → ${String(n)} (via Lookup only)`);
  if (n !== 42) {
    return yield* Effect.die(`expected 42, got ${String(n)}`);
  }
}).pipe(Effect.scoped);

// ── demo: spawn serve, wait ready, spawn call, stop serve ──

const demoProgram = Effect.gen(function* () {
  const now = yield* Clock.currentTimeMillis;
  const lookupSock = `/tmp/effect-pm-addressless-demo-${String(now)}.sock`;
  const execPath = yield* Effect.sync(() => process.execPath);

  const serve = yield* ChildProcess.make(execPath, ["--import", "tsx", selfPath, "serve"], {
    env: { LOOKUP_SOCK: lookupSock },
    extendEnv: true,
  });

  // Wait until serve logs ready (stdout), then run call.
  yield* serve.stdout.pipe(
    Stream.decodeText(),
    Stream.tap((chunk) => Effect.logInfo(`[serve] ${chunk.trimEnd()}`)),
    Stream.takeUntil((chunk) => chunk.includes("serve: ready")),
    Stream.runDrain,
  );

  const callExit = yield* ChildProcess.make(
    execPath,
    ["--import", "tsx", selfPath, "call"],
    {
      env: { LOOKUP_SOCK: lookupSock },
      extendEnv: true,
    },
  ).pipe(
    Effect.flatMap((handle) =>
      Effect.gen(function* () {
        yield* handle.all.pipe(
          Stream.decodeText(),
          Stream.tap((chunk) => Effect.logInfo(`[call] ${chunk.trimEnd()}`)),
          Stream.runDrain,
        );
        return yield* handle.exitCode;
      }),
    ),
  );

  yield* serve.kill();
  if (Number(callExit) !== 0) {
    return yield* Effect.die(`call exited ${String(callExit)}`);
  }
  yield* Effect.logInfo(
    "demo: ok — address-less Worker served; client dialed via Lookup",
  );
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const role = process.argv[2] ?? "demo";

if (role === "serve") {
  NodeRuntime.runMain(serveProgram as Effect.Effect<void, unknown>);
} else if (role === "call") {
  NodeRuntime.runMain(callProgram as Effect.Effect<void, unknown>);
} else if (role === "demo") {
  NodeRuntime.runMain(demoProgram as Effect.Effect<void, unknown>);
} else {
  NodeRuntime.runMain(
    Effect.logError(`usage: ${selfPath} [demo|serve|call]`).pipe(
      Effect.andThen(Effect.fail("bad role")),
    ) as Effect.Effect<void, unknown>,
  );
}
