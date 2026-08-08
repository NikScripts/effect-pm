/**
 * @module examples/launcher/ensure-lookup
 *
 * **Ensure-Lookup-first** — `Launcher.ensureLookup` then app `Launcher.up`.
 *
 * 1. If Lookup already answers at the path → adopt (no second spawn).
 * 2. Else spawn a Lookup-only child (no app HyperServices), awaitReady, handoff.
 * 3. Then spawn the app worker that dials Lookup via `Lookup.clientOptions`.
 *
 * Soft-bake is never used on the app node under Launcher.
 *
 * ```bash
 * pnpm run example:launcher-ensure-lookup
 * ```
 *
 * Docs: `docs/examples/launcher/ensure-lookup.md`.
 */

// ---cut---
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Clock, Effect, Layer } from "effect";
import { ChildProcess } from "effect/unstable/process";
import * as Launcher from "../../src/Launcher";
import * as Lookup from "../../src/Lookup";
import * as Node from "../../src/Node";

const program = Effect.gen(function* () {
  const root = new URL("../..", import.meta.url).pathname;
  const lookupEntry = `${root}/examples/launcher/ensure-lookup-child.ts`;
  const workerEntry = `${root}/examples/launcher/ensure-lookup-worker.ts`;
  const now = yield* Clock.currentTimeMillis;
  const lookupPath = `/tmp/hyperlink-ts-launcher-ensure-${String(now)}.sock`;
  const port = 28_900 + (now % 200);

  yield* Effect.logInfo(`1) ensureLookup at ${lookupPath}`);
  const lookup = yield* Launcher.ensureLookup({
    path: lookupPath,
    process: Launcher.command(
      "pnpm",
      ["exec", "tsx", lookupEntry, lookupPath],
      { cwd: root, stdout: "inherit", stderr: "inherit", token: "env" },
    ),
    ready: { timeout: "25 seconds" },
  });
  yield* Effect.logInfo(
    `2) Lookup ${lookup.spawned ? "spawned" : "adopted"} node=${lookup.node.key}`,
  );

  // Second ensure → adopt (no second Lookup process).
  const again = yield* Launcher.ensureLookup({ path: lookupPath });
  yield* Effect.logInfo(
    `3) Re-ensure spawned=${String(again.spawned)} (expect false)`,
  );

  const worker = Node.Service()("examples/launcher-ensure-lookup/Worker", {
    url: `http://127.0.0.1:${String(port)}/rpc`,
    kind: "Http",
  });

  yield* Effect.logInfo("4) Launcher.up app worker (pipes Lookup.client — no Soft-bake)");
  yield* Launcher.up({
    node: worker,
    process: Launcher.command(
      "pnpm",
      ["exec", "tsx", workerEntry, String(port), lookupPath],
      { cwd: root, stdout: "inherit", stderr: "inherit", token: "env" },
    ),
    ready: { timeout: "25 seconds" },
  });

  const lookupCtx = yield* Layer.build(Lookup.client(lookup.node));
  const rows = yield* Lookup.nodesServing(
    "examples/launcher-ensure-lookup/Jobs",
  ).pipe(Effect.provide(lookupCtx));
  yield* Effect.logInfo(
    `5) membership ok: ${String(rows.length)} row(s) (nodeKey=${rows[0]?.nodeKey ?? "?"})`,
  );

  yield* ChildProcess.make("pkill", [
    "-f",
    "ensure-lookup-worker.ts|ensure-lookup-child.ts",
  ]).pipe(
    Effect.flatMap((h) => h.exitCode),
    Effect.ignore,
  );
}).pipe(Effect.scoped, Effect.provide(Launcher.layer));

// ---cut-after---
NodeRuntime.runMain(program);
