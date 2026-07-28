/**
 * @module examples/forms/hyperlink/launcher-lookup-membership
 *
 * **Custody then membership** — Track A `Launcher.up` + Track B Lookup advertise.
 *
 * 1. Hold an IPC Lookup server (membership brain).
 * 2. `Launcher.up` spawns a child that listens HTTP with `assumeToken` and pipes Lookup.
 * 3. Parent verifies the child is in `Directory.nodesServing` after handoff.
 *
 * ```bash
 * pnpm exec tsx examples/forms/hyperlink/launcher-lookup-membership.ts
 * ```
 */
import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Clock, Context, Effect, Layer } from "effect";
import { ChildProcess } from "effect/unstable/process";
import * as Launcher from "../../../src/Launcher";
import * as Lookup from "../../../src/Lookup";
import * as Node from "../../../src/Node";

const program = Effect.gen(function* () {
  const root = new URL("../../..", import.meta.url).pathname;
  const entry = `${root}/examples/forms/hyperlink/launcher-lookup-membership-child.ts`;
  const now = yield* Clock.currentTimeMillis;
  const lookupPath = `/tmp/hyperlink-ts-launcher-membership-${String(now)}.sock`;
  const port = 28_700 + (now % 200);

  const lookupNode = Node.Tag()("forms/launcher-membership/Lookup", {
    path: lookupPath,
  }).pipe(Node.asLookup);
  const lookupServer = yield* Layer.build(
    Lookup.layerNode(lookupNode, { unlink: true }),
  );
  const lookupClient = yield* Layer.build(Lookup.client(lookupNode));
  const lookupCtx = Context.merge(lookupServer, lookupClient);

  const worker = Node.Tag()("forms/launcher-membership/Worker", {
    url: `http://127.0.0.1:${String(port)}/rpc`,
    kind: "Http",
  });

  yield* Launcher.up({
    node: worker,
    process: (token) =>
      ChildProcess.make(
        "pnpm",
        ["exec", "tsx", entry, String(port), token, lookupPath],
        { cwd: root, stdout: "inherit", stderr: "inherit" },
      ),
    ready: { timeout: "25 seconds" },
  });

  const rows = yield* Lookup.nodesServing(
    "forms/launcher-membership/Jobs",
  ).pipe(Effect.provide(lookupCtx));

  yield* Effect.logInfo(
    `membership ok: ${String(rows.length)} row(s) serving Jobs (nodeKey=${rows[0]?.nodeKey ?? "?"})`,
  );

  yield* ChildProcess.make("pkill", [
    "-f",
    "launcher-lookup-membership-child.ts",
  ]).pipe(
    Effect.flatMap((h) => h.exitCode),
    Effect.ignore,
  );
}).pipe(
  Effect.scoped,
  Effect.provide(
    Layer.provideMerge(NodeChildProcessSpawner.layer, NodeServices.layer),
  ),
);

NodeRuntime.runMain(program);
